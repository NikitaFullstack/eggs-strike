import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base = (process.env.BASE || 'http://127.0.0.1:3191').replace(/^http/, 'ws');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function client() {
  const ws = new WebSocket(base + '/ws'), messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  return { ws, send: message => ws.send(JSON.stringify(message)), async wait(predicate) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      await sleep(10);
    }
    throw Error('Expected map message was not received');
  } };
}
const clients = Array.from({ length: 4 }, client);
try {
  await Promise.all(clients.map(client => new Promise((resolve, reject) => { client.ws.once('open', resolve); client.ws.once('error', reject); })));
  const [host, ...guests] = clients;
  host.send({ t: 'create', name: 'Map host', mapId: 'training_grounds' });
  const joined = await host.wait(message => message.t === 'joined');
  assert.equal(joined.mapId, 'training_grounds', 'The server must register the imported map');
  assert.deepEqual(joined.maps.map(map => map.id).sort(), ['henhouse_ffa_01', 'kitchen', 'refrigerator', 'training_grounds']);
  for (const guest of guests) { guest.send({ t: 'join', code: joined.code, name: 'Map guest' }); guest.id = (await guest.wait(message => message.t === 'joined')).id; }
  host.send({ t: 'start' });
  const starts = await Promise.all(clients.map(client => client.wait(message => message.t === 'start')));
  assert.equal(new Set(starts.map(message => JSON.stringify(message.you))).size, 4, 'Four players spawn separately');
  for (const message of starts) assert.equal(message.arena.id, 'training_grounds');
  await sleep(1600);
  const target = guests[0];
  async function lane(fromZ, toZ) {
    host.send({ t: 'input', x: -20, y: 2.318366, z: fromZ, yaw: 0, pitch: 0 });
    target.send({ t: 'input', x: -20, y: 2.318366, z: toZ, yaw: 0, pitch: 0 });
    await host.wait(message => message.t === 's' && message.p.some(p => p.i === joined.id && p.z === fromZ) && message.p.some(p => p.i === target.id && p.z === toZ));
  }
  await lane(-13, -16);
  host.send({ t: 'shoot', w: 'usp', dx: 0, dy: 0, dz: -1 });
  const cover = await host.wait(message => message.t === 'shot' && message.i === joined.id);
  assert.equal(cover.rays[0].target, null, 'The imported wall blocks damage');
  assert.equal(cover.rays[0].material, 'metal');
  assert.ok(Math.abs(cover.rays[0].point.z + 14.8451) < .001, 'Server impact lies on the source wall');
  await sleep(300); await lane(-10, -12);
  host.send({ t: 'shoot', w: 'usp', dx: 0, dy: -.4025, dz: -2 });
  const hit = await host.wait(message => message.t === 'hit' && message.to === target.id);
  assert.equal(hit.dmg, 19);
  host.send({ t: 'input', x: -20, y: 12, z: -10, yaw: 0, pitch: 0 });
  await host.wait(message => message.t === 's' && message.p.some(p => p.i === joined.id && p.y === 12));
  host.send({ t: 'input', x: -20, y: -5, z: -10, yaw: 0, pitch: 0 });
  const respawn = await host.wait(message => message.t === 'respawn');
  assert.ok(starts[0].arena.spawns.some(spawn => Math.hypot(respawn.you.x - spawn.x, respawn.you.y - spawn.y, respawn.you.z - spawn.z) < .001));
  console.log('PASS: imported map selection; four distinct spawns; real mesh cover and damage; vertical range; recovery after falling');
} finally { for (const client of clients) client.ws.close(); }
