import assert from 'node:assert/strict';
import WebSocket from 'ws';

const base = (process.env.BASE || 'http://127.0.0.1:3190').replace(/^http/, 'ws');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];

function client() {
  const ws = new WebSocket(base + '/ws'), messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  const api = {
    ws, messages,
    send: message => ws.send(JSON.stringify(message)),
    async wait(predicate, label = 'message', timeout = 8000) {
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
  return api;
}

try {
  const host = client();
  await new Promise((resolve, reject) => { host.ws.once('open', resolve); host.ws.once('error', reject); });
  host.send({ t: 'create', name: 'Тренер', mapId: 'henhouse_ffa_01', practice: true, bots: 2 });
  const joined = await host.wait(message => message.t === 'joined', 'practice room');
  assert.equal(joined.mapId, 'henhouse_ffa_01');
  const start = await host.wait(message => message.t === 'start', 'practice start');
  const bots = start.players.filter(player => player.bot);
  assert.equal(bots.length, 2, 'Practice room starts with two bots');
  assert.equal(start.players.length, 3, 'Host and two bots are in the match');

  host.send({ t: 'input', x: 0, y: 0, z: 4, yaw: Math.PI, pitch: 0 });
  const first = await host.wait(message => message.t === 's' && message.p.length === 3, 'first snapshot');
  const firstBots = first.p.filter(player => player.i !== joined.id);
  assert.ok(firstBots.length === 2);
  await sleep(1500);
  const later = await host.wait(message => message.t === 's' && message.at > first.at + 1200 && message.p.some(player => player.bot));
  const laterBots = later.p.filter(player => player.i !== joined.id);
  assert.ok(laterBots.some((bot, index) => Math.hypot(bot.x - firstBots[index].x, bot.z - firstBots[index].z) > .4), 'Bots move around the arena');

  const shot = await host.wait(message => message.t === 'shot' && message.i !== joined.id, 'bot shot', 12000);
  assert.ok(shot.rays?.length, 'A bot resolves a real shot');

  // The host can be hit by a bot (or by another bot) during practice.
  const wounded = await host.wait(message => (message.t === 'hit' && message.to === joined.id) || (message.t === 's' && message.p.some(p => p.i === joined.id && p.hp < 100)), 'bot damage', 12000);
  assert.ok(wounded);
  console.log('PASS: practice room auto-starts with bots, bots move and shoot, and humans can be damaged');
} finally {
  for (const api of clients) api.ws.close();
}
