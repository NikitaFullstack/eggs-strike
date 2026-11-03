// Reproducible import of the original Three.js FPS example scene; no hand-built level geometry.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as THREE from 'three';
const directory = path.resolve('public/maps/training');
const bytes = fs.readFileSync(path.join(directory, 'collision-world.glb'));
let document, binary;
for (let offset = 12; offset < bytes.length;) {
  const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
  const chunk = bytes.subarray(offset + 8, offset + 8 + length);
  if (type === 0x4e4f534a) document = JSON.parse(chunk.toString());
  if (type === 0x004e4942) binary = chunk;
  offset += 8 + length;
}
if (document.nodes.length !== 1 || document.meshes.length !== 1) throw Error('Unexpected source scene');
function accessor(index) {
  const a = document.accessors[index], view = document.bufferViews[a.bufferView];
  const width = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type];
  const size = a.componentType === 5126 ? 4 : 2, values = [];
  for (let item = 0; item < a.count; item++) for (let component = 0; component < width; component++) {
    const offset = (view.byteOffset || 0) + (a.byteOffset || 0) + item * (view.byteStride || size * width) + component * size;
    values.push(a.componentType === 5126 ? binary.readFloatLE(offset) : binary.readUInt16LE(offset));
  }
  return values;
}
const primitive = document.meshes[0].primitives[0], node = document.nodes[0];
const positions = accessor(primitive.attributes.POSITION);
const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...node.translation), new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])), new THREE.Vector3(...node.scale));
const bounds = new THREE.Box3(), vector = new THREE.Vector3();
for (let i = 0; i < positions.length; i += 3) bounds.expandByPoint(vector.fromArray(positions, i).applyMatrix4(matrix));
const center = bounds.getCenter(new THREE.Vector3());
const transform = new THREE.Matrix4().makeScale(2, 2, 2).multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z)).multiply(matrix);
for (let i = 0; i < positions.length; i += 3) vector.fromArray(positions, i).applyMatrix4(transform).toArray(positions, i);
const scene = {
  source: 'https://github.com/mrdoob/three.js/blob/87948e3fb1d14ad5c8e27b67def8e479780b0292/examples/models/gltf/collision-world.glb',
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'), scale: 2,
  positions: positions.map(value => +value.toFixed(6)), normals: accessor(primitive.attributes.NORMAL),
  uv: accessor(primitive.attributes.TEXCOORD_0), indices: accessor(primitive.indices),
};
fs.writeFileSync(path.join(directory, 'scene.json'), JSON.stringify(scene));
const image = document.bufferViews[document.images[0].bufferView];
fs.writeFileSync(path.join(directory, 'texture.png'), binary.subarray(image.byteOffset, image.byteOffset + image.byteLength));
const triangles = [];
for (let i = 0; i < scene.indices.length; i += 3) {
  const points = scene.indices.slice(i, i + 3).map(index => new THREE.Vector3().fromArray(scene.positions, index * 3));
  const triangle = new THREE.Triangle(...points), normal = triangle.getNormal(new THREE.Vector3());
  if (normal.y > .7) triangles.push(points);
}
triangles.sort((a, b) => a.reduce((sum, p) => sum + p.y, 0) - b.reduce((sum, p) => sum + p.y, 0));
const half = (bounds.max.x - bounds.min.x), depth = (bounds.max.z - bounds.min.z);
const polygons = triangles.map(points => `<polygon points="${points.map(p => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(' ')}" fill="hsl(200 20% ${35 + points[0].y * 2}%)" stroke="#263b47" stroke-width=".07"/>`);
fs.writeFileSync(path.join(directory, 'preview.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-depth} ${half * 2} ${depth * 2}"><rect x="${-half}" y="${-depth}" width="${half * 2}" height="${depth * 2}" fill="#192c38"/>${polygons.join('')}</svg>`);
console.log(`Imported ${scene.indices.length / 3} triangles; ${half * 2} × ${depth * 2} m; original embedded texture`);
