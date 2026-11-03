import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base = (process.env.BASE || 'http://127.0.0.1:3170').replace(/^http/, 'ws');
function client() {
  const ws = new WebSocket(base + '/ws');
  const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  return {
    ws, messages,
    send: msg => ws.send(JSON.stringify(msg)),
    async wait(predicate) {
      const end = Date.now() + 4000;
      while (Date.now() < end) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Timed out waiting for game response');
    },
  };
}
const host = client(), guest = client();
try {
  await Promise.all([host, guest].map(c => new Promise(resolve => c.ws.once('open', resolve))));
  host.send({ t: 'create', name: 'Cover host' });
  const joined = await host.wait(m => m.t === 'joined');
  assert.deepEqual(joined.maps.map(m => m.id), ['henhouse_ffa_01', 'training_grounds', 'refrigerator', 'kitchen'], 'Server exposes all four maps');
  guest.send({ t: 'join', code: joined.code, name: 'Cover guest' });
  const other = await guest.wait(m => m.t === 'joined');
  host.send({ t: 'start' });
  await guest.wait(m => m.t === 'start');
  await new Promise(resolve=>setTimeout(resolve,1600));
  async function place(from, to) {
    host.send({ t: 'input', ...from, yaw: 0, pitch: 0 });
    guest.send({ t: 'input', ...to, yaw: 0, pitch: 0 });
    await host.wait(m => m.t === 's' && m.p.some(p => p.i === other.id && p.x === to.x && p.y === to.y && p.z === to.z));
    host.messages.length = 0;
  }
  async function blocked(direction, description) {
    host.send({ t: 'shoot', w: 'awp', ...direction });
    await new Promise(resolve => setTimeout(resolve, 250));
    const p = host.messages.filter(m => m.t === 's').at(-1).p.find(p => p.i === other.id);
    assert.equal(p.hp, 100, description);
    await new Promise(resolve => setTimeout(resolve, 1900));
  }
  await place({x:-8.1,y:0,z:2},{x:-8.1,y:1.8,z:2});
  await blocked({dx:0,dy:1,dz:0}, 'Balcony floor blocks shots from below');
  await place({x:0,y:0,z:3.4},{x:0,y:0,z:-3.4});
  await blocked({dx:0,dy:0,dz:-1}, 'Central metal feeder blocks shots');
  await place({x:-3,y:0,z:-.8},{x:-3,y:0,z:-4.2});
  await blocked({dx:0,dy:0,dz:-1}, 'Hay and crates provide solid cover');
  await place({x:-8.1,y:0,z:1.8},{x:-8.1,y:0,z:-1.8});
  host.send({t:'shoot',w:'awp',dx:0,dy:0,dz:-1});
  const hit = await host.wait(m => m.t === 'hit' && m.to === other.id);
  assert.equal(hit.dmg,100,'Open route under the gallery allows shots without an invisible wall');
  console.log('PASS: deck, feeder and hay block bullets; ground underpass stays open');
} finally {
  host.ws.close(); guest.ws.close();
}
