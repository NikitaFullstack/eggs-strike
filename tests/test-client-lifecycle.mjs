import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import Appearance from '../public/egg-appearance.js';

// Execute the shipped handlers, with only their browser dependencies replaced.
// This catches lifecycle regressions without duplicating connect/result logic.
const source = await readFile(new URL('../public/game.js', import.meta.url), 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Source section exists: ${start}`);
  return source.slice(first, last);
}
const connectSource = section('function connect() {', '\nfunction onMessage(msg)');

function network() {
  const sockets = [], timers = new Map(), messages = [], notices = [];
  let nextTimer = 0, failConstruction = false;
  class Socket {
    static OPEN = 1;
    constructor() {
      if (failConstruction) throw new Error('WebSocket unavailable');
      this.readyState = 0; this.closeCalls = 0; sockets.push(this);
    }
    close() { this.closeCalls++; this.readyState = 3; this.onclose?.(); }
  }
  const state = { screen: 'menu' };
  const context = vm.createContext({
    WebSocket: Socket, location: { protocol: 'https:', host: 'game.example' }, S: state,
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    clearMenuBusy() {}, showMenu(text) { notices.push(text); state.screen = 'menu'; },
    onMessage(message) { messages.push(message); },
  });
  vm.runInContext(`let ws = null, connectPromise = null;\n${connectSource}\nglobalThis.api = { connect, socket: () => ws, promise: () => connectPromise };`, context);
  return { ...context.api, sockets, timers, messages, notices, state, failConstruction(value) { failConstruction = value; } };
}

{
  const h = network();
  const first = h.connect();
  assert.equal(h.connect(), first, 'Simultaneous callers share one pending connection');
  assert.equal(h.sockets.length, 1);
  const old = h.sockets[0], stale = { open: old.onopen, close: old.onclose, message: old.onmessage, error: old.onerror };
  const failed = assert.rejects(first, /Не удалось подключиться/);
  old.onerror(); await failed;
  assert.equal(old.closeCalls, 1, 'Failed connection is actually closed');
  assert.equal(h.socket(), null); assert.equal(h.promise(), null);
  const second = h.connect(), current = h.sockets[1];
  current.readyState = 1; current.onopen(); await second;
  h.state.screen = 'hud';
  stale.open(); stale.close(); stale.error(); stale.message({ data: '{"t":"end"}' });
  assert.equal(h.socket(), current, 'Late old callbacks cannot clear a replacement socket');
  assert.equal(h.state.screen, 'hud'); assert.deepEqual(h.notices, []);
  assert.deepEqual(h.messages, [], 'Messages from retired connections are ignored');
  current.onmessage({ data: '{"t":"players"}' });
  assert.equal(h.messages.length, 1);
  assert.equal(h.timers.size, 0);
  await h.connect(); assert.equal(h.sockets.length, 2, 'An open connection is reused');
}

{
  const h = network(), attempt = h.connect(), socket = h.sockets[0];
  const failed = assert.rejects(attempt, /Сервер не отвечает/);
  [...h.timers.values()][0](); await failed;
  assert.equal(socket.closeCalls, 1, 'Timeout does not leave a connecting socket alive');
  assert.equal(h.socket(), null); assert.equal(h.promise(), null); assert.equal(h.timers.size, 0);
  const next = h.connect(); h.sockets[1].readyState = 1; h.sockets[1].onopen(); await next;
  assert.equal(h.socket(), h.sockets[1]);
}

{
  const h = network(), attempt = h.connect();
  const failed = assert.rejects(attempt, /Соединение закрыто/);
  h.sockets[0].readyState = 3; h.sockets[0].onclose(); await failed;
  assert.equal(h.promise(), null, 'Close before open rejects instead of hanging forever');
  assert.equal(h.timers.size, 0);
  h.failConstruction(true); await assert.rejects(h.connect(), /Не удалось открыть/);
  assert.equal(h.promise(), null);
}

{
  const h = network(), attempt = h.connect(), socket = h.sockets[0];
  socket.readyState = 1; socket.onopen(); await attempt;
  h.state.screen = 'results'; socket.readyState = 3; socket.onclose();
  assert.equal(h.state.screen, 'menu', 'Disconnected results do not advertise unusable restart controls');
  assert.equal(h.notices.length, 1);
}

{
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { textContent: '', innerHTML: '', classList: {
        add(name) { classes.add(name); },
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      } });
    }
    return elements.get(id);
  };
  const S = { screen: 'hud', id: 2, hostId: 1 };
  const context = vm.createContext({ S, $, document: { pointerLockElement: null }, show(screen) { S.screen = screen; }, rememberPlayer() {}, renderLobbyPlayers() {} });
  const handlers = section('function onMessage(msg) {', '/* ============================ интерфейс');
  const results = section('function updateResultActions() {', '/* ============================ HUD');
  vm.runInContext(handlers + results + '\nglobalThis.api = { onMessage, onEnd };', context);
  context.api.onEnd({ scores: [] });
  assert.equal($('btnAgain').classList.contains('hidden'), true);
  context.api.onMessage({ t: 'players', hostId: 2, state: 'results', players: [] });
  assert.equal($('btnAgain').classList.contains('hidden'), false, 'Promoted host can restart directly from results');
  assert.equal($('againWait').classList.contains('hidden'), true);
  context.api.onMessage({ t: 'players', hostId: 3, state: 'results', players: [] });
  assert.equal($('btnAgain').classList.contains('hidden'), true, 'Controls also follow a later host change');
  assert.equal($('againWait').classList.contains('hidden'), false);
}

{
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  const S = { screen: 'lobby', code: 'TEST', appearance: Appearance.normalize() }, sent = [];
  const context = vm.createContext({ localStorage: blocked, EggAppearance: Appearance, S, send: message => sent.push(message), updateLobbyIdentity() {} });
  const storage = section('function readStored(key) {', '\nfunction rememberPlayer(p)');
  const number = section('function readNum(key, fallback, min, max) {', '\nconst SETTINGS');
  vm.runInContext(storage + number + '\nglobalThis.api = { readStored, writeStored, readAppearance, selectAppearance, readNum };', context);
  assert.equal(context.api.readNum('egg-sens', 1, .2, 3), 1);
  assert.equal(context.api.writeStored('egg-fps', '0'), false);
  assert.deepEqual(context.api.readAppearance(), Appearance.DEFAULT);
  const selected = { color: '#65d6b0', face: 'wink', hat: 'crown' };
  assert.equal(context.api.selectAppearance(selected), false);
  assert.deepEqual(S.appearance, selected, 'Storage failure keeps the current in-memory selection');
  assert.deepEqual(sent[0].appearance, selected, 'Storage failure does not prevent multiplayer sync');

  const values = new Map();
  context.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  for (const invalid of ['', ' ', 'garbage', '1.2junk', 'NaN', 'Infinity']) {
    values.set('egg-sens', invalid);
    assert.equal(context.api.readNum('egg-sens', 1, .2, 3), 1, `Invalid setting falls back: ${invalid}`);
  }
  for (const [value, expected] of [['1.25', 1.25], ['-5', .2], ['99', 3]]) {
    values.set('egg-sens', value);
    assert.equal(context.api.readNum('egg-sens', 1, .2, 3), expected);
  }
  values.set('egg-appearance', '{broken'); assert.deepEqual(context.api.readAppearance(), Appearance.DEFAULT);
  values.set('egg-appearance', '{"color":"url(x)","face":"unknown","hat":[]}'); assert.deepEqual(context.api.readAppearance(), Appearance.DEFAULT);
  assert.equal(context.api.writeStored('egg-sens', 1.5), true); assert.equal(values.get('egg-sens'), '1.5');
  Object.defineProperty(context, 'localStorage', { get() { throw new Error('SecurityError on property access'); } });
  assert.equal(context.api.readStored('egg-name'), null); assert.equal(context.api.writeStored('egg-name', 'Яйцо'), false);
}

{
  let now = 1000;
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { textContent: '', innerHTML: '', classList: {
        add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      } });
    }
    return elements.get(id);
  };
  const arena = { id: 'test_arena', name: 'Test' };
  const weapons = { ak: { name: 'AK', mag: 30 }, m4: { name: 'M4', mag: 30 } };
  const S = { screen: 'lobby', id: 7, arena, round: 2, slots: ['ak', 'm4'], weapons, locked: false,
    me: { lifeId: 10, alive: true, hp: 40, energy: 35, ammo: { ak: 3, m4: 4 }, weapon: 'm4',
      grenades: 1, grenadeReadyAt: 1600, grenadeThrowAt: 950, lastShot: 950,
      reloading: true, reloadWeapon: 'm4', reloadEnd: 2200, kills: 4, deaths: 2, vy: -2, onGround: false } };
  const noop = () => {};
  const context = vm.createContext({ S, $, performance: { now: () => now }, scene: {}, arenaGroup: { userData: { mapId: arena.id } },
    grenadeEffects: null, jumpQueued: false, running: true, lastScoreSig: '', lastHud: {},
    clearCombat: noop, clearRemotes: noop, renderWeaponBar: noop, resetZoom: noop, rememberPlayer: noop,
    updateHud: noop, updateWeaponBar: noop, applyWeaponModel: noop, updateFpsLabel: noop, show: screen => { S.screen = screen; } });
  const start = section('function startGame(msg) {', '\nlet running');
  const respawn = section('function onRespawn(msg) {', '\nfunction updateResultActions');
  const refill = section('function refillAll() {', '\nfunction playWeaponSound');
  const reloadTick = section('  if (me.reloading && performance.now() >= me.reloadEnd)', '  if (!me.alive && me.deadUntil');
  vm.runInContext(start + respawn + refill + `\nglobalThis.api = { startGame, onRespawn, tickReload() { const me = S.me; ${reloadTick} } };`, context);
  const packet = (you = {}, extra = {}) => ({ resume: true, round: 2, timeLeft: 180, arena, weapons,
    you: { x: 1, y: 2, z: 3, yaw: .5, pitch: .1, hp: 40, alive: true, grenades: 1, lifeId: 10, respawned: false, ...you },
    players: [{ i: 7, k: 4, d: 2 }], ...extra });

  context.api.startGame(packet());
  assert.equal(S.me.hp, 40); assert.equal(S.me.energy, 35); assert.equal(S.me.weapon, 'm4');
  assert.deepEqual(S.me.ammo, { ak: 3, m4: 4 }); assert.equal(S.me.lastShot, 950);
  assert.equal(S.me.grenadeReadyAt, 1600); assert.equal(S.me.reloadEnd, 2200);
  assert.equal(S.me.reloading, true); assert.equal(S.me.reloadWeapon, 'm4');
  assert.equal(S.me.kills, 4); assert.equal(S.me.deaths, 2);
  assert.equal($('reloadHint').classList.contains('hidden'), false);
  assert.equal(S.me.vy, -2, 'Same-life resume also preserves the paused falling velocity');
  now = 2199; context.api.tickReload(); assert.equal(S.me.ammo.m4, 4);
  now = 2200; context.api.tickReload(); assert.equal(S.me.ammo.m4, 30);
  assert.equal(S.me.ammo.ak, 3, 'Only the original reload completes on its original deadline');

  S.me.ammo.ak = 2;
  context.api.startGame(packet()); assert.equal(S.me.ammo.ak, 2, 'Same-life cursor recovery cannot refill the magazine');
  context.api.startGame(packet({ lifeId: 11, hp: 100 }));
  assert.equal(S.me.ammo.ak, 30, 'Recovery after a missed respawn recognizes the new life');
  assert.equal(S.me.weapon, 'm4', 'A respawn retains the selected weapon just like an ordinary respawn event');
  assert.equal(S.me.energy, 100); assert.equal(S.me.lastShot, 0); assert.equal(S.me.lifeId, 11);
  S.me.ammo.ak = 27;
  context.api.startGame(packet({ lifeId: 11, hp: 100 }));
  assert.equal(S.me.ammo.ak, 27, 'New-life recovery resets resources only once');
  context.api.onRespawn({ you: { x: 1, y: 2, z: 3, lifeId: 11, grenades: 2 } });
  assert.equal(S.me.ammo.ak, 27, 'A repeated respawn for the already live identity cannot refill ammo');

  now = 2400; S.me.energy = 22; S.me.lastShot = 2350;
  context.api.startGame(packet({ lifeId: 11, alive: false, hp: 0, respawnIn: .7 }));
  assert.equal(S.me.alive, false); assert.equal(S.me.hp, 0); assert.equal(S.me.deadUntil, 3100);
  assert.equal(S.me.ammo.ak, 27); assert.equal(S.me.energy, 22); assert.equal(S.me.lastShot, 2350);
  assert.equal($('death').classList.contains('hidden'), false);
  now = 3100;
  context.api.onRespawn({ you: { x: 5, y: 0, z: 6, yaw: 0, lifeId: 12, grenades: 2 } });
  assert.equal(S.me.alive, true); assert.equal(S.me.hp, 100); assert.equal(S.me.lifeId, 12);
  assert.equal(S.me.ammo.ak, 30); assert.equal(S.me.energy, 100); assert.equal(S.me.lastShot, 0);
  assert.equal($('death').classList.contains('hidden'), true);
  S.me.ammo.ak = 1;
  context.api.startGame(packet({ lifeId: 13, hp: 100, respawned: true }));
  assert.equal(S.me.ammo.ak, 30, 'Expired dead wait in the lobby performs a normal respawn');
  S.me.ammo.ak = 1;
  context.api.startGame(packet({ lifeId: 14, hp: 100 }, { resume: false, round: 3 }));
  assert.equal(S.me.ammo.ak, 30, 'A genuinely new round starts with a new inventory');
}

{
  const runner = await readFile(new URL('../scripts/test.mjs', import.meta.url), 'utf8');
  const helper = runner.slice(runner.indexOf('function readTimeoutEnv('), runner.indexOf('const testTimeoutMs'));
  const context = vm.createContext({ process: { env: {} } });
  vm.runInContext(helper + '\nglobalThis.readTimeout = readTimeoutEnv;', context);
  assert.equal(context.readTimeout('EGG_TEST_TIMEOUT_MS', 120000, 3600000), 120000);
  assert.equal(context.readTimeout('EGG_TEST_START_TIMEOUT_MS', 15000, 300000), 15000);
  for (const value of ['0', '-1', '999', '1500.5', 'NaN', 'Infinity', '300001']) {
    context.process.env.EGG_TEST_START_TIMEOUT_MS = value;
    assert.throws(() => context.readTimeout('EGG_TEST_START_TIMEOUT_MS', 15000, 300000), /must be an integer/);
  }
  context.process.env.EGG_TEST_TIMEOUT_MS = '300000';
  assert.equal(context.readTimeout('EGG_TEST_TIMEOUT_MS', 120000, 3600000), 300000);
}

console.log('PASS: connection lifecycle, result host transfer, safe storage, same-life resume/recovery, reload timing, dead wait/respawn, bounded test timeouts');
