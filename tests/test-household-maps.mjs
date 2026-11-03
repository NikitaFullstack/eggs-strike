import assert from 'node:assert/strict';
import Household from '../public/household-maps.js';
import G from '../public/arena-geometry.js';
import Grenades from '../public/grenade-physics.js';
import { householdFixture } from './household-fixture.mjs';

const close = (a, b) => Math.abs(a - b) < 1e-5;
assert.deepEqual(Household.maps.map(map => map.id).sort(), ['kitchen', 'refrigerator']);

for (const map of Household.maps) {
  const fixture = householdFixture(map);
  const { bounds, playerCollision: capsule } = map;
  const label = message => `${map.name}: ${message}`;
  assert.deepEqual([bounds.widthX, bounds.depthZ], map.id === 'refrigerator' ? [24, 20] : [28, 22], label('larger arenas keep their three-player limit'));
  assert.ok(map.mesh, label('gameplay uses the visible curved geometry'));
  assert.equal(map.players.max, 3);
  assert.equal(map.spawns.length, 3);
  assert.equal(new Set(map.spawns.map(spawn => `${spawn.x},${spawn.z}`)).size, 3);
  for (const spawn of map.spawns) {
    assert.equal(G.blocks(map, spawn.x, spawn.z, spawn.y), false, label(`${spawn.id} fits the player capsule`));
    assert.ok(close(G.groundHeight(map, spawn.x, spawn.z, spawn.y + capsule.maxStepHeight), spawn.y));
  }
  for (let i = 0; i < map.spawns.length; i++) for (let j = i + 1; j < map.spawns.length; j++) {
    const a = map.spawns[i], b = map.spawns[j];
    assert.equal(G.visible(map, { ...a, y: a.y + capsule.height * .85 }, { ...b, y: b.y + capsule.height * .85 }), false,
      label(`${a.id} and ${b.id} cannot shoot each other immediately after spawning`));
  }

  // Flood the actual capsule-clear floor, not a designer-supplied navigation graph.
  const step = .25, w = Math.round(bounds.widthX / step) + 1, d = Math.round(bounds.depthZ / step) + 1;
  const key = (i, j) => j * w + i;
  const point = (i, j) => ({ x: bounds.minX + i * step, z: bounds.minZ + j * step });
  const cell = ({ x, z }) => [Math.round((x - bounds.minX) / step), Math.round((z - bounds.minZ) / step)];
  const clear = new Set();
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const { x, z } = point(i, j);
    if (!G.blocks(map, x, z, bounds.floorY) && close(G.groundHeight(map, x, z, bounds.floorY + capsule.maxStepHeight), bounds.floorY) && !fixture.insideProp(x, bounds.floorY, z)) clear.add(key(i, j));
  }
  const start = cell(map.spawns[0]), reached = new Set([key(...start)]), queue = [start];
  assert.ok(clear.has(key(...start)), label('spawn connects to the sampled walkable floor'));
  for (let q = 0; q < queue.length; q++) {
    const [i, j] = queue[q];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + dx, nj = j + dz, next = key(ni, nj);
      if (ni < 0 || nj < 0 || ni >= w || nj >= d || !clear.has(next) || reached.has(next)) continue;
      reached.add(next); queue.push([ni, nj]);
    }
  }
  assert.ok(reached.size / clear.size > .98, label('ground routes do not contain isolated playable pockets'));
  for (const spawn of map.spawns) assert.ok(reached.has(key(...cell(spawn))), label(`walk to ${spawn.id} without jumping`));

  assert.ok(map.ramps.length >= 2, label('elevated route has more than one entrance'));
  for (const ramp of map.ramps) {
    const axis = ramp.dir.endsWith('x') ? 'x' : 'z', length = axis === 'x' ? ramp.w : ramp.d;
    const sign = ramp.dir.startsWith('+') ? 1 : -1;
    const at = t => ({ x: ramp.x + (axis === 'x' ? (t - .5) * sign * length : 0), z: ramp.z + (axis === 'z' ? (t - .5) * sign * length : 0) });
    assert.ok(Math.atan2(Math.abs(ramp.h1 - ramp.h0), length) * 180 / Math.PI <= capsule.maxWalkableSlopeDegrees, label(`${ramp.id} is a walkable slope`));
    assert.ok((axis === 'x' ? ramp.d : ramp.w) >= capsule.radius * 2 + .7, label(`${ramp.id} has comfortable width`));
    const lowT = ramp.h0 <= ramp.h1 ? -.5 / length : 1 + .5 / length;
    assert.ok(reached.has(key(...cell(at(lowT)))), label(`${ramp.id} lower approach connects to the floor`));
    // Match movement's support-height rule in small real steps, including each landing.
    for (const direction of [1, -1]) {
      const from = direction === 1 ? -.4 / length : 1 + .4 / length;
      const to = direction === 1 ? 1 + .4 / length : -.4 / length;
      const count = Math.ceil((length + .8) / .04), initial = at(from);
      let feet = G.groundHeight(map, initial.x, initial.z, Math.max(ramp.h0, ramp.h1) + capsule.maxStepHeight);
      for (let i = 0; i <= count; i++) {
        const t = from + (to - from) * i / count, p = at(t);
        assert.equal(G.blocks(map, p.x, p.z, feet), false, label(`${ramp.id} does not snag ${direction > 0 ? 'forward' : 'backward'} at ${t.toFixed(2)}`));
        const support = G.groundHeight(map, p.x, p.z, feet + capsule.maxStepHeight);
        assert.ok(Math.abs(support - feet) <= capsule.maxStepHeight + .001, label(`${ramp.id} has a continuous landing`));
        feet = support;
        if (t >= 0 && t <= 1) assert.ok(close(feet, ramp.h0 + (ramp.h1 - ramp.h0) * t), label(`${ramp.id} follows the visible slope`));
      }
    }
  }

  // Independent Three.js raycasts must agree with the shared Octree across
  // curved sides, tapered necks and the upper/lower parts of every prop.
  let rays = 0;
  for (const prop of map.crates.filter(prop => prop.model && prop.model !== 'box')) {
    for (const fraction of [.2, .55, .9]) for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, distance = Math.max(prop.w, prop.d) + 1;
      const from = { x: prop.x + Math.sin(angle) * distance, y: (prop.y || 0) + prop.h * fraction, z: prop.z + Math.cos(angle) * distance };
      if (from.x < bounds.minX + capsule.radius || from.x > bounds.maxX - capsule.radius || from.z < bounds.minZ + capsule.radius || from.z > bounds.maxZ - capsule.radius) continue;
      const direction = { x: -Math.sin(angle), y: 0, z: -Math.cos(angle) };
      const rendered = fixture.renderRay(from, direction), hit = G.rayMesh(map, from, direction);
      assert.equal(!!hit, !!rendered, label(`${prop.id}: visible and collision ray existence agree`));
      if (hit) assert.ok(Math.abs(hit.t - rendered.distance) < 1e-4, label(`${prop.id}: bullets follow the visible curved surface`));
      rays++;
    }
  }
  assert.ok(rays >= 120, label('ray samples cover many distinct prop shapes'));

  let roundedPassages = 0;
  for (const prop of map.crates.filter(prop => ['juiceBottle', 'jar', 'yogurt', 'loaf', 'mug', 'kettle', 'tomato'].includes(prop.model) && (prop.y || 0) === 0)) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = prop.x + sx * (prop.w / 2 - .03), z = prop.z + sz * (prop.d / 2 - .03);
      if (!G.blocks(map, x, z, 0) && !fixture.insideProp(x, 0, z) && close(G.groundHeight(map, x, z, .23), 0)) roundedPassages++;
    }
  }
  assert.ok(roundedPassages > 0, label('players can pass beside curved silhouettes inside their enclosing rectangle'));

  const mug = map.crates.find(prop => prop.model === 'mug');
  if (mug) {
    const angle = mug.rotation || 0;
    const world = (x, y, z) => ({ x: mug.x + Math.cos(angle) * x * mug.w + Math.sin(angle) * z * mug.d,
      y: (mug.y || 0) + y * mug.h, z: mug.z - Math.sin(angle) * x * mug.w + Math.cos(angle) * z * mug.d });
    const bottom = G.rayMesh(map, world(-.11, 1.3, 0), { x: 0, y: -1, z: 0 });
    assert.ok(bottom && Math.abs(bottom.point.y - ((mug.y || 0) + mug.h * .18)) < .01, label('the open mug has a real interior floor, not an invisible lid'));
    const direction = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
    const opening = G.rayMesh(map, world(.34, .52, -1), direction);
    assert.ok(!opening || opening.t > mug.d * 2, label('bullets pass through the handle opening'));
  }

  // Tall cover really shields players and stops a swept grenade.
  let testedCovers = 0;
  for (const box of map.crates.filter(box => (box.y || 0) === 0 && box.h >= capsule.height)) {
    for (const axis of ['x', 'z']) {
      const extent = axis === 'x' ? box.w : box.d;
      const from = { x: box.x, y: capsule.height * .85, z: box.z }, to = { x: box.x, y: 0, z: box.z };
      from[axis] -= extent / 2 + .6; to[axis] += extent / 2 + .6;
      if (G.blocks(map, from.x, from.z, 0) || G.blocks(map, to.x, to.z, 0)) continue;
      if (G.visible(map, from, { ...to, y: from.y })) continue;
      assert.equal(Grenades.damage(map, { ...from, y: .15 }, to), 0, label(`${box.id} shields blasts`));
      const direction = { x: axis === 'x' ? 1 : 0, y: 0, z: axis === 'z' ? 1 : 0 };
      const hit = Grenades.sweep(map, from, direction, extent + 1.2);
      assert.ok(hit && hit.t < extent + 1.2, label(`${box.id} stops grenade flight`));
      testedCovers++;
    }
  }
  assert.ok(testedCovers >= 2, label('test several usable pieces of cover'));
  fixture.dispose();
  console.log(`PASS: ${map.name}; 3 protected spawns; ${reached.size} connected floor samples; ${map.ramps.length} bidirectional ramps; ${rays} independent shape rays; ${roundedPassages} curved clearances; ${testedCovers} cover checks`);
}
