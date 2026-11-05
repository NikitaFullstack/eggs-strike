import assert from 'node:assert/strict';
import WebSocket from 'ws';

const base = (process.env.BASE || 'http://127.0.0.1:3190').replace(/^http/, 'ws');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];

async function open() {
  const ws = new WebSocket(base + '/ws'), messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  const api = {
    ws, messages, send: message => ws.send(JSON.stringify(message)),
    async wait(predicate, label, timeout = 6000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(index, 1)[0];
        await sleep(10);
      }
      throw Error(`Timed out waiting for ${label}`);
    },
  };
  clients.push(api);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return api;
}

async function place(api, pose) {
  api.messages.length = 0;
  api.send({ t: 'input', y: 0, yaw: 0, pitch: 0, ...pose });
  await api.wait(m => m.t === 's' && m.p.some(p => Math.abs(p.x - pose.x) < .011 && Math.abs(p.z - pose.z) < .011), 'position');
}

try {
  const host = await open(), guest = await open();
  host.send({ t: 'create', name: 'Хост' });
  const joined = await host.wait(m => m.t === 'joined', 'joined');
  guest.send({ t: 'join', code: joined.code, name: 'Гость' });
  const guestJoined = await guest.wait(m => m.t === 'joined', 'guest joined');
  host.send({ t: 'start' });
  const start = await host.wait(m => m.t === 'start', 'start');
  assert.equal(start.weapons.knife.dmg, 55);
  await sleep(1800);

  await place(host, { x: -4, z: 6 });
  await place(guest, { x: -4, z: 4.5 });
  host.messages.length = 0;
  host.send({ t: 'shoot', w: 'knife', dx: 0, dy: -.35, dz: -1 });
  const slash = await host.wait(m => m.t === 'shot' && m.w === 'knife', 'knife shot');
  assert.equal(slash.rays[0].target, guestJoined.id);
  assert.equal(slash.rays[0].material, 'egg');
  const hit = await host.wait(m => m.t === 'hit' && m.to === guestJoined.id, 'knife hit');
  assert.equal(hit.dmg, 55);
  await sleep(450);
  host.send({ t: 'shoot', w: 'knife', dx: 0, dy: -.35, dz: -1 });
  const kill = await host.wait(m => m.t === 'kill' && m.victim === guestJoined.id, 'knife kill');
  assert.equal(kill.w, 'knife');

  await guest.wait(m => m.t === 'respawn', 'respawn');
  await sleep(1800);
  await place(host, { x: -4, z: 6 });
  await place(guest, { x: -4, z: 2 });
  host.messages.length = 0;
  host.send({ t: 'shoot', w: 'knife', dx: 0, dy: 0, dz: -1 });
  const far = await host.wait(m => m.t === 'shot' && m.w === 'knife', 'far knife');
  assert.equal(far.rays[0].target, null, 'Knife is short range');
  console.log('PASS: knife deals 55 per slash, kills in two, misses beyond 2.2 m');
} finally {
  for (const api of clients) api.ws.close();
}

