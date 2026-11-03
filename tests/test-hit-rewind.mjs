import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base = (process.env.BASE || 'http://127.0.0.1:3191').replace(/^http/, 'ws');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function client() {
  const ws = new WebSocket(base + '/ws'), messages = [], snapshots = [];
  ws.on('message', raw => { const message = JSON.parse(raw); messages.push(message); if (message.t === 's') snapshots.push(message); });
  return { ws, messages, snapshots, send: message => ws.send(JSON.stringify(message)), async wait(predicate) {
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      await sleep(10);
    }
    throw Error('Expected server message not received');
  } };
}
const host = client(), guest = client(), failures = [];
async function test(name, fn) {
  try { await fn(); console.log('PASS:', name); }
  catch (error) { failures.push(name); console.error('FAIL:', name, error.message); }
}
try {
  await Promise.all([host, guest].map(client => new Promise((resolve, reject) => {
    client.ws.once('open', resolve); client.ws.once('error', reject);
  })));
  host.send({ t: 'create', name: 'Rewind host' });
  const joined = await host.wait(message => message.t === 'joined');
  guest.send({ t: 'join', code: joined.code, name: 'Rewind target' });
  const target = await guest.wait(message => message.t === 'joined');
  host.send({ t: 'start' }); await guest.wait(message => message.t === 'start'); await sleep(1600);
  async function place(from, to) {
    host.messages.length = 0;
    host.send({ t: 'input', y: 0, yaw: 0, pitch: 0, ...from });
    guest.send({ t: 'input', y: 0, yaw: 0, pitch: 0, ...to });
    return host.wait(message => message.t === 's' && message.p.some(p => p.i === joined.id && p.x === from.x && p.z === from.z)
      && message.p.some(p => p.i === target.id && p.x === to.x && p.z === to.z));
  }
  async function shoot(viewTime, direction = { dx: 0, dy: -.4025, dz: -2.1 }) {
    host.messages.length = 0;
    host.send({ t: 'shoot', w: 'usp', viewTime, ...direction });
    const result = await host.wait(message => message.t === 'shot');
    await sleep(300);
    return result;
  }
  const from = { x: -4, z: 6.8 }, to = { x: -4, z: 4.7 };
  await test('The visible recent snapshot remains hittable after the target moves', async () => {
    const visible = await place(from, to);
    await sleep(70);
    await place(from, { x: -2.8, z: 4.7 });
    const result = await shoot(visible.at);
    assert.equal(result.rays[0].target, target.id, 'Hit the displayed position within the 250 ms reconciliation window');
    const hit = await host.wait(message => message.t === 'hit');
    assert.equal(hit.dmg, 19);
  });
  await test('Hits use the interpolated position between snapshots, not either endpoint', async () => {
    await place(from, { x: -4.8, z: 4.7 });
    await sleep(60);
    const b = await place(from, { x: -3.2, z: 4.7 });
    const a = host.snapshots[host.snapshots.indexOf(b) - 1];
    assert.equal((await shoot((a.at + b.at) / 2)).rays[0].target, target.id);
  });
  await test('Expired and future snapshot times cannot resurrect an old target position', async () => {
    const old = await place(from, to);
    await place(from, { x: -2.8, z: 4.7 }); await sleep(300);
    for (const time of [old.at, Date.now() + 1000, null, 'invalid']) {
      assert.equal((await shoot(time)).rays[0].target, null);
    }
  });
  await test('Reconciliation still stops bullets at real cover', async () => {
    const snapshot = await place({ x: 0, z: 3.4 }, { x: 0, z: -3.4 });
    const result = await shoot(snapshot.at, { dx: 0, dy: 0, dz: -1 });
    assert.equal(result.rays[0].material, 'metal');
    assert.equal(result.rays[0].target, null);
    assert.ok(Math.abs(result.rays[0].point.z - 1.55) < .02);
  });
  await test('Legacy clients without a snapshot time still hit the current position', async () => {
    await place(from, to);
    assert.equal((await shoot(undefined)).rays[0].target, target.id);
  });
  await test('Rewinding cannot hit a new life using a snapshot taken before respawn', async () => {
    await place(from, to);
    await sleep(1900); // Respect the sniper's server-side fire interval when switching from the pistol.
    host.send({ t: 'shoot', w: 'awp', dx: 0, dy: -.4025, dz: -2.1 });
    await host.wait(message => message.t === 'kill' && message.victim === target.id);
    await sleep(1850);
    host.messages.length = 0;
    const dead = await host.wait(message => message.t === 's' && message.p.some(p => p.i === target.id && !p.a));
    await guest.wait(message => message.t === 'respawn');
    await place(from, to);
    assert.equal((await shoot(dead.at)).rays[0].target, null, 'Pre-respawn history cannot be used against the new life');
  });
  assert.deepEqual(failures, []);
} finally { host.ws.close(); guest.ws.close(); }
