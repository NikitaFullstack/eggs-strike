import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import Household from '../public/household-maps.js';
import G from '../public/arena-geometry.js';
import MeshWorld from '../public/mesh-world.js';
import { householdFixture } from './household-fixture.mjs';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < .001, `${message}: ${actual} vs ${expected}`);
function fall(map, start, inspect = () => {}, frames = 180, dt = 1 / 60) {
  let point = { ...start }, velocity = 0;
  for (let frame = 0; frame < frames; frame++) {
    velocity -= 24 * dt;
    point = G.moveVertical(map, point, velocity * dt);
    velocity *= point.velocityScale;
    assert.ok([point.x, point.y, point.z].every(Number.isFinite), 'contact resolution stays finite');
    inspect(point, frame);
    if (point.grounded || point.ceiling || point.blocked) velocity = 0;
  }
  return point;
}

const fridge = Household.maps.find(map => map.id === 'refrigerator');
const refrigerator = householdFixture(fridge);
// A shelf jump can reach 4.4m. These positions used to pass through the juice
// bottle's steep shoulder and settle deep inside its closed body at floor level.
for (const dx of [.5, .6, .7, .8, 1]) {
  let supported = false;
  const final = fall(fridge, { x: 5.1 + dx, y: 4.4, z: .1 }, point => {
    supported ||= point.grounded;
    assert.equal(refrigerator.insideProp(point.x, point.y, point.z), false, `falling on juice shoulder at offset ${dx} cannot enter a solid`);
    assert.equal(point.blocked, false, 'ordinary curved contacts resolve without freezing');
  });
  assert.ok(final.x > 6.2, 'a steep shoulder moves the capsule sideways while it falls');
  assert.ok(supported, 'a reachable rounded-foot support permits jumping out of a narrow edge contact');
  if (dx === 1) assert.equal(final.grounded, true, 'the shelf edge supports the foot even when the centre ray misses it');
}
const floor = fall(fridge, { x: 0, y: 5, z: 8.8 }, undefined, 60, .05);
near(floor.y, 0, 'fast falling still lands on the floor');
assert.equal(floor.grounded, true);
const shelf = G.moveVertical(fridge, { x: -4, y: 5, z: -5.6 }, -6);
near(shelf.y, 2.8, 'a large vertical sweep lands on the upper shelf');
assert.equal(shelf.grounded, true);
refrigerator.dispose();

const kitchen = Household.maps.find(map => map.id === 'kitchen');
const kitchenFixture = householdFixture(kitchen);
const bridge = G.moveVertical(kitchen, { x: 2.25, y: 5, z: -1 }, -6);
near(bridge.y, 2.1, 'the rounded foot cannot tunnel through a 14cm bridge');
assert.equal(bridge.grounded, true);
const edge = G.moveVertical(kitchen, { x: 2.25, y: 3, z: .05 }, -3);
assert.equal(edge.grounded, true, 'a rounded foot resting on the bridge edge can walk away or jump');
assert.ok(edge.y > 2.05 && edge.y <= 2.1, 'edge support is at the real deck height');
const head = G.moveVertical(kitchen, { x: 2.25, y: 0, z: -1 }, 3);
assert.equal(head.ceiling, true, 'a jump hits the underside with the rounded head');
assert.equal(head.grounded, false, 'an underside is never a floor');
assert.ok(head.y + kitchen.playerCollision.height <= 1.9601);
assert.ok(head.y > .79, 'head contact stops at the real underside');
near(fall(kitchen, head, undefined, 60).y, 0, 'the player falls back below the bridge after a head impact');
assert.equal(kitchenFixture.insideProp(head.x, head.y, head.z), false);
kitchenFixture.dispose();

// A steep face remains non-walkable; vertical resolution must slide down it,
// rather than changing the walking slope limit to make the tunnelling disappear.
const steep = { id: 'vertical-steep-test', mesh: true, playerCollision: fridge.playerCollision,
  bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10, floorY: 0 } };
const data = { positions: [-10,0,-10, 10,0,-10, 10,0,10, -10,0,10, 0,0,-2, 2,3,-2, 2,3,2, 0,0,2],
  indices: [0,2,1, 0,3,2, 4,6,5, 4,7,6] };
G.registerMesh(steep.id, MeshWorld.collision(THREE, Octree, Capsule, data, steep));
assert.equal(G.blocks(steep, 1, 0, 1.5), true, 'walking is blocked on a 56 degree slope');
near(G.groundHeight(steep, 1, 0, 4), 0, 'the steep face does not become walkable support');
let contacts = 0;
const bottom = fall(steep, { x: 1, y: 4, z: 0 }, point => {
  if (point.x >= 0 && point.x <= 2) {
    assert.ok(point.y >= 1.5 * point.x - .001, 'the capsule never crosses the steep plane');
    assert.equal(point.grounded, false, 'a steep contact does not grant jumping or walking support');
    if (point.x < .99) contacts++;
  }
}, 90, .05);
assert.ok(contacts > 0, 'the fall exercised steep-face sliding');
assert.ok(bottom.x < 0, 'sliding reaches the bottom of the steep face');
near(bottom.y, 0, 'sliding ends on the actual floor');
assert.equal(bottom.grounded, true);
console.log('PASS: curved-shoulder falls stay outside solids, steep faces slide without becoming walkable, floor/deck foot landing and bridge head impacts');
