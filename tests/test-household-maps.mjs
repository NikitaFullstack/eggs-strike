import assert from 'node:assert/strict';
import Household from '../public/household-maps.js';
import G from '../public/arena-geometry.js';
import Grenades from '../public/grenade-physics.js';

const close = (a, b) => Math.abs(a - b) < 1e-5;
assert.deepEqual(Household.maps.map(map => map.id).sort(), ['kitchen', 'refrigerator']);

for (const map of Household.maps) {
  const { bounds, playerCollision: capsule } = map;
  const label = message => `${map.name}: ${message}`;
  assert.ok(bounds.widthX <= 20 && bounds.depthZ <= 16, label('compact footprint'));
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
  const step = .2, w = Math.round(bounds.widthX / step) + 1, d = Math.round(bounds.depthZ / step) + 1;
  const key = (i, j) => j * w + i;
  const point = (i, j) => ({ x: bounds.minX + i * step, z: bounds.minZ + j * step });
  const cell = ({ x, z }) => [Math.round((x - bounds.minX) / step), Math.round((z - bounds.minZ) / step)];
  const clear = new Set();
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const { x, z } = point(i, j);
    if (!G.blocks(map, x, z, bounds.floorY) && close(G.groundHeight(map, x, z, bounds.floorY + capsule.maxStepHeight), bounds.floorY)) clear.add(key(i, j));
  }
  const start = cell(map.spawns[0]), reached = new Set([key(...start)]), queue = [start];
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

  // Every advertised tall cover really shields players and stops a swept grenade.
  let testedCovers = 0;
  for (const box of map.crates.filter(box => (box.y || 0) === 0 && box.h >= capsule.height)) {
    for (const axis of ['x', 'z']) {
      const extent = axis === 'x' ? box.w : box.d;
      const from = { x: box.x, y: capsule.height * .85, z: box.z }, to = { x: box.x, y: 0, z: box.z };
      from[axis] -= extent / 2 + .6; to[axis] += extent / 2 + .6;
      if (G.blocks(map, from.x, from.z, 0) || G.blocks(map, to.x, to.z, 0)) continue;
      assert.equal(G.visible(map, from, { ...to, y: from.y }), false, label(`${box.id} blocks bullets`));
      assert.equal(Grenades.damage(map, { ...from, y: .15 }, to), 0, label(`${box.id} shields blasts`));
      const direction = { x: axis === 'x' ? 1 : 0, y: 0, z: axis === 'z' ? 1 : 0 };
      const hit = Grenades.sweep(map, from, direction, extent + 1.2);
      assert.ok(hit && hit.t < extent + 1.2, label(`${box.id} stops grenade flight`));
      testedCovers++;
    }
  }
  assert.ok(testedCovers >= 2, label('test several usable pieces of cover'));
  for (const round of map.rounds) {
    const part = G.roundParts(round)[0], radius = Math.max(part.bottom, part.top);
    const from = { x: part.x - radius - .5, y: part.y + part.h / 2, z: part.z };
    assert.ok(Number.isFinite(G.rayRound(from, { x: 1, y: 0, z: 0 }, round)), label(`${round.id} has solid round cover`));
  }
  console.log(`PASS: ${map.name}; 3 protected spawns; ${reached.size} connected floor samples; ${map.ramps.length} bidirectional ramps; ${testedCovers} cover checks`);
}
