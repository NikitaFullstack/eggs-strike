import assert from 'node:assert/strict';
import WebSocket from 'ws';
import Household from '../public/household-maps.js';
import G from '../public/arena-geometry.js';

const base = (process.env.BASE || 'http://127.0.0.1:3190').replace(/^http/, 'ws');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];
async function open() {
  const ws = new WebSocket(base + '/ws'), messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  const client = { ws, messages, send: message => ws.send(JSON.stringify(message)), async wait(predicate, label = 'message', timeout = 5000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      await sleep(10);
    }
    throw Error('Timed out waiting for ' + label);
  } };
  clients.push(client);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return client;
}
async function join(client, code, mapId) {
  client.send({ t: code ? 'join' : 'create', name: 'Map test', code, mapId });
  const joined = await client.wait(message => message.t === 'joined', 'joined');
  client.id = joined.id; client.code = joined.code;
  return joined;
}
async function position(client, p) {
  client.messages.length = 0;
  client.send({ t: 'input', x: p.x, y: p.y || 0, z: p.z, yaw: 0, pitch: 0 });
  await client.wait(message => message.t === 's' && message.p.some(player => player.i === client.id && Math.abs(player.x - p.x) < .01 && Math.abs(player.z - p.z) < .01), 'position');
}
function coverLane(map) {
  const eye = map.playerCollision.height * .85;
  for (const box of map.crates.filter(box => (box.y || 0) === 0 && box.h >= map.playerCollision.height)) {
    for (const axis of ['x', 'z']) {
      const extent = axis === 'x' ? box.w : box.d;
      if (extent + 1.2 > 4.5) continue;
      const from = { x: box.x, y: 0, z: box.z }, to = { ...from };
      from[axis] -= extent / 2 + .6; to[axis] += extent / 2 + .6;
      if (G.blocks(map, from.x, from.z, 0) || G.blocks(map, to.x, to.z, 0)) continue;
      const direction = { x: axis === 'x' ? 1 : 0, y: 0, z: axis === 'z' ? 1 : 0 };
      const origin = { ...from, y: eye };
      if (G.boxes(map).some(other => G.rayBox(origin, direction, other) < G.rayBox(origin, direction, box) - .001)) continue;
      const shootPoint = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dz]) => ({ x: from.x + dx, y: 0, z: from.z + dz }))
        .find(p => !G.blocks(map, p.x, p.z, 0) && G.visible(map, { ...p, y: eye }, { ...from, y: map.playerCollision.height / 2 }));
      if (shootPoint) return { from, to, direction, shootPoint, box, eye };
    }
  }
  throw Error(`${map.name}: no usable cover lane`);
}

try {
  // Existing four-player rooms keep their capacity. A host cannot silently evict
  // a fourth player by selecting a smaller arena, but may switch after they leave.
  const legacyHost = await open();
  const legacy = await join(legacyHost, null, 'henhouse_ffa_01');
  assert.equal(legacy.maxPlayers, 4);
  assert.deepEqual(legacy.maps.map(map => map.id).sort(), ['henhouse_ffa_01', 'kitchen', 'refrigerator', 'training_grounds']);
  const legacyGuests = [];
  for (let i = 0; i < 3; i++) { const guest = await open(); await join(guest, legacy.code); legacyGuests.push(guest); }
  for (const map of Household.maps) {
    legacyHost.messages.length = 0;
    legacyHost.send({ t: 'map', id: map.id });
    assert.match((await legacyHost.wait(message => message.t === 'error', 'capacity rejection')).msg, /3/);
  }
  legacyGuests[2].ws.close();
  await legacyHost.wait(message => message.t === 'players' && message.players.length === 3, 'fourth player left');
  for (const map of Household.maps) {
    legacyHost.send({ t: 'map', id: map.id });
    const changed = await legacyHost.wait(message => message.t === 'players' && message.mapId === map.id, 'map selection');
    assert.equal(changed.maxPlayers, 3);
  }
  legacyHost.send({ t: 'map', id: 'training_grounds' });
  assert.equal((await legacyHost.wait(message => message.t === 'players' && message.mapId === 'training_grounds')).maxPlayers, 4);
  for (const client of [legacyHost, ...legacyGuests]) client.ws.close();

  for (const map of Household.maps) {
    const host = await open(), joined = await join(host, null, map.id);
    assert.equal(joined.mapId, map.id);
    assert.equal(joined.maxPlayers, 3);
    const shielded = await open(), exposed = await open();
    await join(shielded, joined.code); await join(exposed, joined.code);
    const fourth = await open();
    fourth.send({ t: 'join', code: joined.code, name: 'Fourth' });
    assert.equal((await fourth.wait(message => message.t === 'error', 'fourth player rejection')).msg, 'Комната заполнена');
    host.send({ t: 'start' });
    const starts = await Promise.all([host, shielded, exposed].map(client => client.wait(message => message.t === 'start', 'round start')));
    assert.equal(new Set(starts.map(message => [message.you.x, message.you.y, message.you.z].join(','))).size, 3);
    for (const started of starts) {
      assert.equal(started.arena.id, map.id);
      assert.equal(started.you.grenades, 2);
      assert.ok(map.spawns.some(spawn => spawn.x === started.you.x && spawn.z === started.you.z));
      assert.equal(G.blocks(map, started.you.x, started.you.z, started.you.y), false);
    }
    fourth.messages.length = 0;
    fourth.send({ t: 'join', code: joined.code, name: 'Fourth' });
    assert.equal((await fourth.wait(message => message.t === 'error', 'in-match capacity')).msg, 'Комната заполнена');
    fourth.ws.close();
    await sleep(1600);

    const lane = coverLane(map);
    const distant = [...map.spawns].sort((a, b) => Math.hypot(b.x - lane.from.x, b.z - lane.from.z) - Math.hypot(a.x - lane.from.x, a.z - lane.from.z))[0];
    assert.ok(Math.hypot(distant.x - lane.from.x, distant.z - lane.from.z) > 5);
    await position(exposed, distant);
    await position(host, lane.from); await position(shielded, lane.to);
    host.send({ t: 'shoot', w: 'usp', dx: lane.direction.x, dy: 0, dz: lane.direction.z });
    const blocked = await host.wait(message => message.t === 'shot' && message.i === host.id, 'cover shot');
    assert.equal(blocked.rays[0].target, null, `${map.name}: real cover blocks bullets`);
    const expectedDistance = (lane.direction.x ? lane.box.w : lane.box.d) / 2;
    assert.ok(Math.abs((lane.direction.x ? blocked.rays[0].point.x - lane.box.x : blocked.rays[0].point.z - lane.box.z) + expectedDistance) < .001, `${map.name}: bullet impact matches the visible cover face`);
    await position(host, lane.shootPoint); await position(exposed, lane.from);
    await sleep(300);
    host.send({ t: 'shoot', w: 'usp', dx: lane.from.x - lane.shootPoint.x, dy: map.playerCollision.height / 2 - lane.eye, dz: lane.from.z - lane.shootPoint.z });
    assert.equal((await host.wait(message => message.t === 'hit' && message.to === exposed.id, 'open shot')).dmg, 19);

    // Same real cover must shield the other player from a replicated detonation.
    await position(host, lane.from);
    host.send({ t: 'grenade', dx: 0, dy: -1, dz: 0 });
    const thrown = await host.wait(message => message.t === 'grenade', 'throw');
    assert.equal(thrown.remaining, 1);
    await shielded.wait(message => message.t === 'grenade' && message.id === thrown.id, 'replicated throw');
    await position(host, distant);
    const explosion = await host.wait(message => message.t === 'explosion' && message.id === thrown.id, 'detonation');
    assert.ok(Math.hypot(explosion.x - lane.from.x, explosion.z - lane.from.z) < .05);
    const kill = await host.wait(message => message.t === 'kill' && message.victim === exposed.id, 'grenade damage');
    assert.equal(kill.killer, host.id); assert.equal(kill.w, 'grenade');
    const after = await host.wait(message => message.t === 's' && message.p.some(player => player.i === exposed.id && !player.a), 'blast state');
    assert.equal(after.p.find(player => player.i === shielded.id).hp, 100, `${map.name}: cover protects against grenade damage`);
    assert.equal(after.p.find(player => player.i === host.id).k, 1);
    assert.ok(!after.g.some(grenade => grenade.id === thrown.id));
    for (const client of [host, shielded, exposed]) client.ws.close();
    console.log(`PASS: ${map.name}; 3-player capacity; unique safe spawns; real cover and bullet damage; replicated grenade kill and protected opponent`);
  }
  console.log('PASS: full-room map switch rejected; capacity changes to 3 and back to 4 after a player leaves');
} finally { for (const client of clients) client.ws.close(); }
