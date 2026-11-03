import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import MeshWorld from '../public/mesh-world.js';

const arena = {
  bounds: { floorY: -20 },
  playerCollision: { radius: .34, height: 1.15, maxWalkableSlopeDegrees: 35, maxStepHeight: .23 },
};
// A 26.6° ramp meeting a vertical wall. The old aggregate Octree correction
// became mostly vertical, accepting a capsule that had entered the wall.
const ramp = {
  positions: [-2,-1,-2, 2,1,-2, 2,1,2, -2,-1,2],
  indices: [0,2,1, 0,3,2],
};
const rampWithWall = {
  positions: [...ramp.positions, .5,-1,-2, .5,3,-2, .5,3,2, .5,-1,2],
  indices: [...ramp.indices, 4,5,6, 4,6,7],
};
const open = MeshWorld.collision(THREE, Octree, Capsule, ramp, arena);
const walled = MeshWorld.collision(THREE, Octree, Capsule, rampWithWall, arena);
for (const z of [-1, -.2, 0, .2, 1]) {
  assert.equal(walled.blocks(.14, z, .07), false, 'Leave a clear route beside the wall');
  for (const x of [.17, .18, .25, .4]) {
    assert.equal(walled.blocks(x, z, x / 2), true, 'A slope must never disguise wall penetration');
  }
}
for (let x = -1.5; x <= 1.5; x += .05) {
  assert.equal(open.blocks(x, .15, x / 2), false, 'Walk smoothly across both ramp triangles and their seam');
  assert.ok(Math.abs(open.groundHeight(x, .15, x / 2 + .23) - x / 2) < 1e-6, 'Ground stays on the rendered slope');
}

// A thin upper deck should support feet from above while preserving the route
// beneath it; the capsule must not clip into its underside while jumping.
const bridge = {
  positions: [-2,0,-2, 2,0,-2, 2,0,2, -2,0,2, -1,1.6,-1, 1,1.6,-1, 1,1.6,1, -1,1.6,1],
  indices: [0,2,1,0,3,2,4,6,5,4,7,6],
};
const underpass = MeshWorld.collision(THREE, Octree, Capsule, bridge, arena);
assert.equal(underpass.blocks(0,0,0), false);
assert.equal(underpass.groundHeight(0,0,.23), 0);
assert.equal(underpass.groundHeight(0,0,1.83), 1.6);
assert.ok(Math.abs(underpass.ceilingHeight(0,0,1.15)-1.6) < 1e-6);
assert.equal(underpass.blocks(0,0,.6), true, 'The underside blocks the player body');

console.log('PASS: shallow wall contacts on ramps; seamless slopes; upper deck support and underpass clearance');
