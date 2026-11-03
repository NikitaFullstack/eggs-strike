import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import MeshWorld from '../public/mesh-world.js';
import G from '../public/arena-geometry.js';
const data = JSON.parse(fs.readFileSync(new URL('../public/maps/training/scene.json', import.meta.url)));
const map = JSON.parse(fs.readFileSync(new URL('../public/maps/training/map.json', import.meta.url)));
const original = fs.readFileSync(new URL('../public/maps/training/collision-world.glb', import.meta.url));
assert.equal(crypto.createHash('sha256').update(original).digest('hex'), data.sha256);
assert.equal(data.sha256, map.attribution.sha256);
assert.equal(data.indices.length / 3, 1754);
assert.ok(map.halfX * map.halfZ * 4 > 4500);
const collider = MeshWorld.collision(THREE, Octree, Capsule, data, map);
G.registerMesh(map.id, collider);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3)); geometry.setIndex(data.indices);
const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld();
const reference = new THREE.Raycaster();
let rays = 0;
for (const spawn of map.spawns) {
  assert.ok(Math.abs(G.groundHeight(map, spawn.x, spawn.z, spawn.y + .23) - spawn.y) < .001);
  assert.equal(G.blocks(map, spawn.x, spawn.z, spawn.y), false, `${spawn.id} must fit the player capsule`);
  for (const direction of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
    const origin = new THREE.Vector3(spawn.x, spawn.y + .9775, spawn.z), vector = new THREE.Vector3(...direction);
    reference.set(origin, vector);
    const expected = reference.intersectObject(mesh)[0], actual = G.rayMesh(map, origin, vector);
    assert.equal(!!actual, !!expected);
    if (expected) assert.ok(Math.abs(actual.t - expected.distance) < .0001, 'Shared collision ray agrees with the rendered original triangles');
    rays++;
  }
}
assert.equal(G.blocks(map, -20, -14.6, 2.318366), true, 'The source wall blocks player movement');
assert.equal(G.blocks(map, -20, -13.8, 2.318366), false, 'The source corridor stays open');
assert.ok(G.ceilingHeight(map, -20, 0, 3.468366) > 3.46, 'The spawn has headroom');
console.log(`PASS: original GLB provenance, ${rays} independent renderer/collider rays, eight grounded spawns, wall and passage`);
