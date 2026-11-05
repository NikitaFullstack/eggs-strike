import assert from 'node:assert/strict';
import Household from '../public/household-maps.js';
import G from '../public/arena-geometry.js';
import Grenades from '../public/grenade-physics.js';
import { householdFixture, layeredNavigation } from './household-fixture.mjs';

const close = (a, b) => Math.abs(a - b) < 1e-5;
assert.deepEqual(Household.maps.map(map => map.id).sort(), ['kitchen', 'refrigerator']);

for (const map of Household.maps) {
  const fixture = householdFixture(map);
  const { bounds, playerCollision: capsule } = map;
  const label = message => `${map.name}: ${message}`;
  assert.deepEqual([bounds.widthX, bounds.depthZ], map.id === 'refrigerator' ? [30, 26] : [34, 28], label('larger arenas keep their three-player limit'));
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

  // Sample separate supports at the same X/Z, then flood only bidirectionally
  // walkable capsule sweeps. A floor cell cannot teleport onto the shelf above.
  const navigation = layeredNavigation(map, fixture);
  const { nodes, reached } = navigation;
  assert.equal(map.layoutRevision, 3, label('persistent rooms can recognize the changed layout'));
  assert.ok(nodes.length > 1000, label('navigation samples the actual geometry'));
  assert.ok(reached.size / nodes.length > .98, label(`routes do not contain isolated playable pockets (${reached.size}/${nodes.length})`));
  for (const spawn of map.spawns) {
    const node = navigation.nearest(spawn);
    assert.ok(node && close(node.y, spawn.y) && reached.has(node.id), label(`walk to ${spawn.id} without jumping`));
  }
  const upperChecks = map.id === 'refrigerator'
    ? [{x:-7.7,y:2.8,z:-2}, {x:0,y:2.8,z:-4.9}, {x:7.7,y:2.8,z:-2}]
    : [{x:-3.2,y:2.1,z:1.2}, {x:2.25,y:2.1,z:-1}, {x:5.2,y:2.1,z:-4.8}];
  for (const point of upperChecks) {
    const node = navigation.nearest(point);
    assert.ok(node && close(node.y, point.y) && reached.has(node.id), label(`upper route at ${point.x},${point.z} is connected to the floor`));
  }
  assert.ok(nodes.filter(node => node.y > 1.8 && reached.has(node.id)).length > 300, label('a substantial upper route is genuinely accessible'));

  assert.ok(map.ramps.length >= 2, label('elevated route has more than one entrance'));
  for (const ramp of map.ramps) {
    const axis = ramp.dir.endsWith('x') ? 'x' : 'z', length = axis === 'x' ? ramp.w : ramp.d;
    const sign = ramp.dir.startsWith('+') ? 1 : -1;
    const at = t => ({ x: ramp.x + (axis === 'x' ? (t - .5) * sign * length : 0), z: ramp.z + (axis === 'z' ? (t - .5) * sign * length : 0) });
    assert.ok(Math.atan2(Math.abs(ramp.h1 - ramp.h0), length) * 180 / Math.PI <= capsule.maxWalkableSlopeDegrees, label(`${ramp.id} is a walkable slope`));
    assert.ok((axis === 'x' ? ramp.d : ramp.w) >= capsule.radius * 2 + .7, label(`${ramp.id} has comfortable width`));
    const lowT = ramp.h0 <= ramp.h1 ? -.5 / length : 1 + .5 / length;
    const approach = navigation.nearest({ ...at(lowT), y: Math.min(ramp.h0, ramp.h1) });
    assert.ok(approach && reached.has(approach.id), label(`${ramp.id} lower approach connects to the layered routes`));
    // Match movement's support-height rule in small real steps, including each landing.
    for (const lateral of [-.55, 0, .55]) for (const direction of [1, -1]) {
      const atLine = t => { const point = at(t); point[axis === 'x' ? 'z' : 'x'] += lateral; return point; };
      const from = direction === 1 ? -.4 / length : 1 + .4 / length;
      const to = direction === 1 ? 1 + .4 / length : -.4 / length;
      const count = Math.ceil((length + .8) / .04), initial = atLine(from);
      let feet = G.groundHeight(map, initial.x, initial.z, Math.max(ramp.h0, ramp.h1) + capsule.maxStepHeight);
      for (let i = 0; i <= count; i++) {
        const t = from + (to - from) * i / count, p = atLine(t);
        assert.equal(G.blocks(map, p.x, p.z, feet), false, label(`${ramp.id} does not snag ${direction > 0 ? 'forward' : 'backward'} at ${t.toFixed(2)}, offset ${lateral}`));
        const support = G.groundHeight(map, p.x, p.z, feet + capsule.maxStepHeight);
        assert.ok(Math.abs(support - feet) <= capsule.maxStepHeight + .001, label(`${ramp.id} has a continuous landing`));
        feet = support;
        if (t >= 0 && t <= 1) assert.ok(close(feet, ramp.h0 + (ramp.h1 - ramp.h0) * t), label(`${ramp.id} follows the visible slope`));
      }
    }
  }

  const upperPaths = map.id === 'refrigerator' ? [
    [[-7.7,5.8],[-7.7,-4.9],[7.7,-4.9],[7.7,5.8]],
  ] : [
    [[-11.8,1.2],[-6.1,1.2],[-6.1,.6],[-3.2,.6],[-3.2,-1],[5.2,-1],[5.2,-5.2],[6.6,-5.6],[6.6,-10.7]],
    [[-1.8,7.7],[-1.8,2.6],[-3.2,2.6],[-3.2,.6],[-6.1,.6],[-6.1,1.2],[-11.8,1.2]],
  ];
  for (const path of upperPaths) for (const direction of [1, -1]) {
    const route = direction === 1 ? path : [...path].reverse();
    let feet = 0, climbed = 0;
    for (let segment = 1; segment < route.length; segment++) {
      const [ax,az] = route[segment-1], [bx,bz] = route[segment];
      const count = Math.ceil(Math.hypot(bx-ax,bz-az)/.04);
      for (let i = 1; i <= count; i++) {
        const t = i/count, x = ax+(bx-ax)*t, z = az+(bz-az)*t;
        const support = G.groundHeight(map,x,z,feet+capsule.maxStepHeight);
        assert.ok(Math.abs(support-feet)<=capsule.maxStepHeight+.001, label(`upper circuit has a continuous support at ${x.toFixed(2)},${z.toFixed(2)}`));
        assert.equal(G.blocks(map,x,z,Math.max(feet,support)),false,label(`upper circuit remains capsule-clear at ${x.toFixed(2)},${z.toFixed(2)}`));
        feet=support; climbed=Math.max(climbed,feet);
      }
    }
    assert.ok(climbed>=2, label('continuous circuit reaches the upper floor'));
    assert.ok(close(feet,0),label('continuous circuit returns to the ground through another entrance'));
  }

  const tunnel = map.id === 'refrigerator'
    ? { x:-4, z:-5.6, top:2.8, from:{x:-4,y:0,z:-7.9}, to:{x:-4,y:0,z:-3.3} }
    : { x:2.25, z:-1, top:2.1, from:{x:2.25,y:0,z:-3}, to:{x:2.25,y:0,z:1} };
  assert.ok(close(G.groundHeight(map, tunnel.x, tunnel.z, .23), 0), label('lower support remains the floor below the deck'));
  assert.ok(close(G.groundHeight(map, tunnel.x, tunnel.z, tunnel.top + .23), tunnel.top), label('upper support is a separate real deck'));
  assert.equal(G.blocks(map, tunnel.x, tunnel.z, 0), false, label('a complete standing capsule fits underneath'));
  assert.equal(G.blocks(map, tunnel.x, tunnel.z, tunnel.top), false, label('a complete standing capsule fits on top'));
  const ceiling = G.ceilingHeight(map, tunnel.x, tunnel.z, capsule.height);
  assert.ok(ceiling > capsule.height + .3 && ceiling < tunnel.top, label('the lower path has headroom and a real overhead slab'));
  const up = G.rayMesh(map, {x:tunnel.x,y:.5,z:tunnel.z}, {x:0,y:1,z:0});
  const down = G.rayMesh(map, {x:tunnel.x,y:tunnel.top+1,z:tunnel.z}, {x:0,y:-1,z:0});
  assert.ok(up && up.point.y < tunnel.top && up.point.y > capsule.height, label('upward fire hits the underside'));
  assert.ok(down && close(down.point.y, tunnel.top), label('downward fire hits the deck surface'));
  assert.equal(G.visible(map, {x:tunnel.x,y:.6,z:tunnel.z}, {x:tunnel.x,y:tunnel.top+.6,z:tunnel.z}), false, label('players on different floors cannot shoot through the slab'));
  assert.equal(G.visible(map, {...tunnel.from,y:.7}, {...tunnel.to,y:.7}), true, label('a horizontal shot passes through the open tunnel'));
  assert.ok(Grenades.sweep(map, {x:tunnel.x,y:.6,z:tunnel.z}, {x:0,y:1,z:0}, tunnel.top), label('the underside also stops a swept grenade'));
  for (let i = 0; i <= 100; i++) {
    const t = i / 100, x = tunnel.from.x + (tunnel.to.x-tunnel.from.x)*t, z = tunnel.from.z + (tunnel.to.z-tunnel.from.z)*t;
    assert.equal(G.blocks(map,x,z,0), false, label('the lower route stays clear across the complete underpass'));
    assert.ok(close(G.groundHeight(map,x,z,.23),0), label('walking underneath cannot snap up to the deck'));
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
  console.log(`PASS: ${map.name}; 3 protected spawns; ${reached.size} connected layered samples; ${map.ramps.length} bidirectional ramps; ${rays} independent shape rays; ${roundedPassages} curved clearances; ${testedCovers} cover checks`);
}
