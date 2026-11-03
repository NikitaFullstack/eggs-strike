import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function definition(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `server defines ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const hit = vm.runInNewContext(`${definition('raySphere')}\n${definition('rayPlayer')}\nrayPlayer`);
const shape = { radius: .34, height: 1.15 }, player = { x: 0, y: 0, z: 0 };
const direction = { x: 1, y: 0, z: 0 };
for (const eye of [.17, .34, .575, .81, .9775]) {
  const distance = hit({ x: 0, y: eye, z: 0 }, direction, player, shape);
  assert.ok(Number.isFinite(distance) && distance > 0 && distance <= shape.radius, 'overlapping capsule remains hittable at feet, body and head');
}
const outside = hit({ x: -1, y: .9775, z: 0 }, direction, player, shape);
assert.ok(outside > .7 && outside < .71, 'ordinary outside-capsule hit distance is unchanged');
assert.equal(hit({ x: 1, y: .9775, z: 0 }, direction, player, shape), Infinity, 'a capsule behind the ray remains a miss');

let now = 1000, ended = 0;
const grenadeTimes = [], snapshots = [];
const context = { Date: { now: () => now }, MATCH_TIME: 300, MAX_REWIND_MS: 250,
  MAPS: { test: {} }, tickGrenades: (_room, at) => grenadeTimes.push(at),
  endMatch: room => { ended++; room.state = 'results'; },
  publicGrenade: value => value, r2: value => value,
  respawnPlayer: () => assert.fail('empty room has no respawns'), broadcast: (_room, message) => snapshots.push(message) };
const tick = vm.runInNewContext(`${definition('tickRoomInner')}\ntickRoomInner`, context);
const room = { startedAt: 1000, state: 'playing', timeLeft: 300, mapId: 'test', players: new Map(), grenades: [], lastSnapshot: 1000, snapshots: [] };
now = 91000; tick(room);
assert.equal(room.timeLeft, 210, 'a stalled callback catches up to elapsed wall time');
assert.equal(snapshots.at(-1).tl, 210);
assert.equal(ended, 0);
now = 401000; tick(room);
assert.equal(room.timeLeft, 0, 'a callback after the deadline ends the round immediately');
assert.equal(room.state, 'results');
assert.equal(ended, 1);
assert.equal(grenadeTimes.at(-1), 301000, 'grenades cannot damage players after the match deadline');
console.log('PASS: point-blank capsule endcaps, normal hit/miss, stalled match clock and grenade deadline');
