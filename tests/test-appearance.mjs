import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import Appearance from '../public/egg-appearance.js';

const base = process.env.BASE || 'http://127.0.0.1:3190';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];

async function open(url = base) {
  const ws = new WebSocket(url.replace(/^http/, 'ws') + '/ws'), messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  const client = {
    ws, messages,
    send: message => ws.send(JSON.stringify(message)),
    async wait(predicate, label = 'message', timeout = 5000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(index, 1)[0];
        await sleep(10);
      }
      throw Error(`Timed out waiting for ${label}`);
    },
  };
  clients.push(client);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return client;
}

async function join(client, code, appearance) {
  client.send({ t: code ? 'join' : 'create', code, name: 'Appearance test', appearance });
  const joined = await client.wait(message => message.t === 'joined', 'joined');
  client.id = joined.id;
  client.code = joined.code;
  return joined;
}

function player(message, client) {
  const result = message.players.find(entry => entry.i === client.id);
  assert.ok(result, `Player ${client.id} is present`);
  assert.equal(result.c, result.appearance.color, 'Legacy color agrees with appearance');
  assert.deepEqual(Object.keys(result.appearance).sort(), ['color', 'face', 'hat']);
  return result;
}

function matchesAppearance(message, client, appearance) {
  return message.t === 'players' && message.players.some(entry => entry.i === client.id
    && Appearance.key(entry.appearance) === Appearance.key(appearance));
}

async function shortMatchServer() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port), MATCH_TIME: '.15' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await exited; } finally { clearTimeout(timeout); }
  };
  try {
    await new Promise((resolve, reject) => {
      let output = '', settled = false;
      const timeout = setTimeout(() => finish(Error(`Short-match server did not start:\n${output}`)), 15000);
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        error ? reject(error) : resolve();
      }
      function read(data) {
        output += data;
        if (output.includes('EGG STRIKE ready on')) finish();
      }
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.once('error', finish);
      child.once('exit', code => finish(Error(`Short-match server exited (${code}):\n${output}`)));
    });
    return { url: `http://127.0.0.1:${port}`, stop };
  } catch (error) { await stop(); throw error; }
}

try {
  const defaults = { color: '#ffd23f', face: 'smile', hat: 'none' };
  assert.deepEqual(Appearance.DEFAULT, defaults);
  assert.equal(Appearance.COLORS.length, 8);
  assert.equal(Appearance.FACES.length, 6);
  assert.equal(Appearance.HATS.length, 7);
  const custom = { color: '#65d6b0', face: 'wink', hat: 'chef' };
  for (const invalid of [null, undefined, false, 123, 'pink', [], { color: 'red', face: [], hat: {} }]) {
    assert.deepEqual(Appearance.normalize(invalid), defaults);
    assert.deepEqual(Appearance.normalize(invalid, custom), custom);
  }
  assert.deepEqual(Appearance.normalize({ color: '#70B7FF', face: 'cool', hat: 'wizard', hp: 999 }), { color: '#70b7ff', face: 'cool', hat: 'wizard' });
  assert.deepEqual(Appearance.normalize({ face: 'sleepy' }, custom), { ...custom, face: 'sleepy' });
  assert.deepEqual(Appearance.normalize(null, { color: 'invalid', face: null, hat: 'cape' }), defaults);
  assert.deepEqual(Appearance.normalize(Object.create(custom)), defaults, 'Inherited fields are ignored');
  assert.equal(Appearance.key({ hat: 'chef', color: '#65D6B0', face: 'wink' }), Appearance.key(custom));
  const normalized = Appearance.normalize();
  normalized.color = '#000000';
  assert.deepEqual(Appearance.normalize(), defaults, 'Normalization does not mutate shared defaults');
  const browser = {};
  runInNewContext(await readFile(new URL('../public/egg-appearance.js', import.meta.url), 'utf8'), browser);
  assert.equal(browser.EggAppearance.key(custom), Appearance.key(custom), 'Browser global and CommonJS use the same contract');
  console.log('PASS: appearance palettes, browser/CommonJS contract, safe fallback, canonical key and input sanitization');

  const host = await open(), guest = await open(), legacy = await open(), invalid = await open();
  const hostLook = { color: '#65d6b0', face: 'wink', hat: 'chef' };
  const guestLook = { color: '#70b7ff', face: 'fierce', hat: 'cap' };
  const created = await join(host, null, hostLook);
  assert.deepEqual(player(await host.wait(message => message.t === 'players'), host).appearance, hostLook);
  await join(guest, created.code, { ...guestLook, hp: 999, id: host.id });
  const shared = await host.wait(message => message.t === 'players' && message.players.length === 2);
  assert.deepEqual(player(shared, guest).appearance, guestLook);
  assert.deepEqual(player(shared, host).appearance, hostLook);
  await join(legacy, created.code);
  await join(invalid, created.code, { color: 'url(javascript:bad)', face: '<img>', hat: { id: 'crown' }, hp: 999 });
  const full = await host.wait(message => message.t === 'players' && message.players.length === 4);
  assert.deepEqual(player(full, legacy).appearance, defaults);
  const invalidLook = { ...defaults, color: '#fff1d2' };
  assert.deepEqual(player(full, invalid).appearance, invalidLook, 'Invalid values use an unused legacy color');
  assert.equal(new Set(full.players.map(entry => entry.c)).size, 4);
  console.log('PASS: create/join appearance reaches peers; legacy and invalid clients receive safe distinct defaults');

  const updated = { color: '#ff88b0', face: 'cool', hat: 'crown' };
  host.send({ t: 'appearance', id: guest.id, appearance: { ...updated, arbitrary: 'ignored' } });
  const changed = await guest.wait(message => matchesAppearance(message, host, updated), 'lobby customization');
  assert.deepEqual(player(changed, host).appearance, updated);
  assert.deepEqual(player(changed, guest).appearance, guestLook, 'A supplied ID cannot change another player');
  host.send({ t: 'appearance', appearance: { color: 'invalid', face: {}, hat: 'wizard' } });
  const finalHostLook = { ...updated, hat: 'wizard' };
  assert.deepEqual(player(await guest.wait(message => matchesAppearance(message, host, finalHostLook)), host).appearance, finalHostLook);
  host.messages.length = 0;
  host.send({ t: 'appearance', appearance: null });
  host.send({ t: 'map', id: created.mapId }); // Ordered barrier returns the unchanged public state.
  assert.deepEqual(player(await host.wait(message => message.t === 'players'), host).appearance, finalHostLook);
  console.log('PASS: lobby updates are shared, restricted to their sender and normalized against the current appearance');

  host.send({ t: 'start' });
  for (const client of [host, guest, legacy, invalid]) {
    const start = await client.wait(message => message.t === 'start', 'first round');
    assert.deepEqual(player(start, host).appearance, finalHostLook);
    assert.deepEqual(player(start, guest).appearance, guestLook);
  }
  host.messages.length = 0;
  host.send({ t: 'appearance', appearance: { color: '#52616b', face: 'surprised', hat: 'cowboy' } });
  host.send({ t: 'input', x: 1.123, y: 0, z: 3, yaw: 0, pitch: 0 });
  await host.wait(message => message.t === 's' && message.p.some(entry => entry.i === host.id && entry.x === 1.12), 'active-update barrier');
  for (const client of clients) client.messages.length = 0;
  invalid.send({ t: 'lobby' });
  const active = await host.wait(message => message.t === 'players', 'player returning to lobby');
  assert.deepEqual(player(active, host).appearance, finalHostLook, 'Active players cannot change their appearance');
  const waitingLook = { ...invalidLook, face: 'sleepy', hat: 'beanie' };
  invalid.send({ t: 'appearance', appearance: { face: 'sleepy', hat: 'beanie' } });
  assert.deepEqual(player(await guest.wait(message => matchesAppearance(message, invalid, waitingLook)), invalid).appearance, waitingLook);
  invalid.send({ t: 'resume' });
  assert.deepEqual(player(await invalid.wait(message => message.t === 'start'), invalid).appearance, waitingLook);

  for (const client of clients) client.messages.length = 0;
  legacy.ws.close();
  await host.wait(message => message.t === 'players' && message.players.length === 3, 'free slot');
  const late = await open(), lateLook = { color: '#b69cff', face: 'surprised', hat: 'cowboy' };
  await join(late, created.code, lateLook);
  const lateStart = await late.wait(message => message.t === 'start', 'late join');
  for (const [client, look] of [[host, finalHostLook], [guest, guestLook], [invalid, waitingLook], [late, lateLook]]) {
    assert.deepEqual(player(lateStart, client).appearance, look);
  }
  host.send({ t: 'start' });
  for (const client of [host, guest, invalid, late]) {
    const start = await client.wait(message => message.t === 'start' && message.round === 2, 'next round');
    assert.deepEqual(player(start, host).appearance, finalHostLook);
    assert.deepEqual(player(start, late).appearance, lateLook);
  }
  for (const client of clients) client.ws.close();
  console.log('PASS: active changes rejected; lobby/resume, late join and new rounds preserve everybody’s appearance');

  const short = await shortMatchServer();
  try {
    const winner = await open(short.url), peer = await open(short.url);
    await join(winner, null, hostLook);
    await join(peer, winner.code, guestLook);
    winner.send({ t: 'start' });
    await peer.wait(message => message.t === 'end', 'short round ending');
    winner.send({ t: 'appearance', appearance: updated });
    const result = await peer.wait(message => matchesAppearance(message, winner, updated) && message.state === 'results', 'results customization');
    assert.deepEqual(player(result, winner).appearance, updated);
    winner.send({ t: 'start' });
    const rematch = await peer.wait(message => message.t === 'start' && message.round === 2, 'results rematch');
    assert.deepEqual(player(rematch, winner).appearance, updated);
    assert.deepEqual(player(rematch, peer).appearance, guestLook);
    console.log('PASS: results allow customization and retain it in the rematch');
  } finally { await short.stop(); }
} finally { for (const client of clients) client.ws.close(); }
