import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import Shapes from '../public/household-shapes.js';
import G from '../public/arena-geometry.js';
import MeshWorld from '../public/mesh-world.js';

export function householdFixture(map) {
  const parts = Shapes.build(THREE, map);
  const data = Shapes.toCollision(parts);
  const collision = MeshWorld.collision(THREE, Octree, Capsule, data, map);
  G.registerMesh(map.id, collision);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes = parts.filter(part => part.collidable !== false).map(part => {
    const mesh = new THREE.Mesh(part.geometry, material);
    mesh.userData.propId = part.propId;
    mesh.updateMatrixWorld(true);
    return mesh;
  });
  const raycaster = new THREE.Raycaster();
  // Check every solid at its real height, including upper slabs, supports and
  // ramp undersides. Looking only at ground-level crates misclassifies cells
  // inside a raised deck as usable navigation nodes.
  const volumes = meshes.filter(mesh => mesh.userData.propId !== 'floor').map(mesh => {
    mesh.geometry.computeBoundingBox();
    return { mesh, bounds: mesh.geometry.boundingBox };
  });
  function renderRay(origin, direction, targets = meshes) {
    raycaster.set(new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(direction.x, direction.y, direction.z).normalize());
    return raycaster.intersectObjects(targets, false)[0] || null;
  }
  function insideProp(x, y, z) {
    // A capsule placed deep inside a closed body touches no surface. Such cells
    // are not walkable floor; classify them independently of movement collision.
    for (const { mesh, bounds } of volumes) {
      if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) continue;
      for (const offset of [.08, .35, .7]) {
        if (y + offset < bounds.min.y || y + offset > bounds.max.y) continue;
        const hit = renderRay({ x, y: y + offset, z }, { x: 0, y: 1, z: 0 }, [mesh]);
        if (hit && hit.face.normal.y > .001) return true;
      }
    }
    return false;
  }
  return { parts, data, collision, meshes, renderRay, insideProp, dispose() {
    for (const part of parts) part.geometry.dispose();
    material.dispose();
  } };
}

export function layeredNavigation(map, fixture, spacing = .25) {
  const { bounds, playerCollision: capsule } = map;
  const width = Math.round(bounds.widthX / spacing) + 1, depth = Math.round(bounds.depthZ / spacing) + 1;
  const columns = new Map(), nodes = [];
  const columnKey = (i, j) => j * width + i;
  const cell = point => [Math.round((point.x - bounds.minX) / spacing), Math.round((point.z - bounds.minZ) / spacing)];
  const decks = map.crates.filter(prop => ['shelf', 'island', 'bridge'].includes(prop.model));
  for (let j = 0; j < depth; j++) for (let i = 0; i < width; i++) {
    const x = bounds.minX + i * spacing, z = bounds.minZ + j * spacing;
    const limits = [{ limit: bounds.floorY + capsule.maxStepHeight, floor: true }];
    for (const deck of decks) if (Math.abs(x - deck.x) <= deck.w / 2 + .01 && Math.abs(z - deck.z) <= deck.d / 2 + .01) limits.push({limit:(deck.y || 0) + deck.h + capsule.maxStepHeight});
    for (const ramp of map.ramps) if (Math.abs(x - ramp.x) <= ramp.w / 2 + .01 && Math.abs(z - ramp.z) <= ramp.d / 2 + .01) {
      const axis = ramp.dir.endsWith('x') ? 'x' : 'z', length = axis === 'x' ? ramp.w : ramp.d;
      const t = .5 + ((axis === 'x' ? x : z) - ramp[axis]) / length * (ramp.dir.startsWith('+') ? 1 : -1);
      limits.push({limit:ramp.h0 + (ramp.h1 - ramp.h0) * t + capsule.maxStepHeight});
    }
    const column = [];
    for (const { limit, floor } of limits) {
      const y = G.groundHeight(map, x, z, limit);
      // Decorative food/plate tops are cover, not additional playable floors.
      // Slabs and ramps are sampled independently even where the floor exists below.
      if (floor && Math.abs(y - bounds.floorY) > .005) continue;
      if (column.some(node => Math.abs(node.y - y) < .005) || G.blocks(map, x, z, y) || fixture.insideProp(x, y, z)) continue;
      if (G.ceilingHeight(map, x, z, y + capsule.height) < y + capsule.height - .005) continue;
      const node = { id: nodes.length, i, j, x, y, z };
      column.push(node); nodes.push(node);
    }
    if (column.length) columns.set(columnKey(i, j), column);
  }
  function walk(a, b) {
    if (Math.abs(a.y - b.y) > capsule.maxStepHeight + .001) return false;
    const samples = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .1);
    let feet = a.y;
    for (let sample = 1; sample <= samples; sample++) {
      const t = sample / samples, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const support = G.groundHeight(map, x, z, feet + capsule.maxStepHeight);
      if (Math.abs(support - feet) > capsule.maxStepHeight + .001 || G.blocks(map, x, z, support)) return false;
      feet = support;
    }
    return Math.abs(feet - b.y) < .005;
  }
  function nearest(point) {
    const [i, j] = cell(point);
    return (columns.get(columnKey(i, j)) || []).reduce((best, node) => !best || Math.abs(node.y - point.y) < Math.abs(best.y - point.y) ? node : best, null);
  }
  const start = nearest(map.spawns[0]), reached = new Set(start ? [start.id] : []), queue = start ? [start] : [];
  for (let q = 0; q < queue.length; q++) {
    const node = queue[q];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = node.i + dx, j = node.j + dz;
      if (i < 0 || j < 0 || i >= width || j >= depth) continue;
      for (const other of columns.get(columnKey(i, j)) || []) {
        if (!reached.has(other.id) && walk(node, other) && walk(other, node)) { reached.add(other.id); queue.push(other); }
      }
    }
  }
  return { nodes, reached, nearest, walk, spacing, columns };
}
