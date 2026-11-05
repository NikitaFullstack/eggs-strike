'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const ArenaGeometry = require('./public/arena-geometry.js');
const Level = require('./public/henhouse-level.js');
const LEVEL_DATA = require('./public/henhouse_ffa_level.json');
const DEFAULT_MAP = Level.build(LEVEL_DATA);
const TRAINING_MAP = require('./public/maps/training/map.json');
const HouseholdMaps = require('./public/household-maps.js');
const HouseholdShapes = require('./public/household-shapes.js');
const MeshWorld = require('./public/mesh-world.js');
const Grenades = require('./public/grenade-physics.js');
const EggAppearance = require('./public/egg-appearance.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MATCH_TIME = Number(process.env.MATCH_TIME) || 300; // 5 минут
const RESPAWN_DELAY = 2.0;     // секунд до респавна
const MAX_PLAYERS = LEVEL_DATA.players.max;
const EYE_HEIGHT = DEFAULT_MAP.playerCollision.height * .85;
const MAX_REWIND_MS = 250;

const WEAPONS = {
  ak:     { id: 'ak',     name: 'AK-47',    short: 'AK',   dmg: 29, rpm: 400, mag: 30, reload: 2.4, spread: 0.012, pellets: 1, auto: true,  recoil: 0.15 },
  m4:     { id: 'm4',     name: 'M4A4-S',   short: 'M4',   dmg: 24, rpm: 444, mag: 30, reload: 2.2, spread: 0.008, pellets: 1, auto: true,  recoil: 0.11 },
  shot:   { id: 'shot',   name: 'Дробовик', short: 'ДРБ',  dmg: 12, rpm: 50,  mag: 8,  reload: 3.2, spread: 0.06,  pellets: 9, auto: false, recoil: 0.24 },
  awp:    { id: 'awp',    name: 'Снайперка',short: 'AWP',  dmg: 100,rpm: 28,  mag: 5,  reload: 3.4, spread: 0.001, pellets: 1, auto: false, recoil: 0.3, zoom: true },
  usp:    { id: 'usp',    name: 'USP-S',    short: 'USP',  dmg: 19, rpm: 233, mag: 12, reload: 1.9, spread: 0.006, pellets: 1, auto: false, recoil: 0.08 },
  deagle: { id: 'deagle', name: 'Дигл',     short: 'ДИГЛ', dmg: 52, rpm: 160, mag: 7,  reload: 2.3, spread: 0.01,  pellets: 1, auto: false, recoil: 0.2 },
  // Ближний бой: 55 урона за порез, бьёт в конус перед игроком на 2,2 м.
  knife:  { id: 'knife',  name: 'Нож',      short: 'НОЖ',  dmg: 55, rpm: 150, mag: 0,  reload: 0,   spread: 0,     pellets: 1, auto: false, recoil: 0.05, melee: true, range: 2.2 },
};

const KNIFE_CONE = Math.cos(40 * Math.PI / 180);
const BOT_NAMES = ['Бот Желток', 'Бот Скорлупа', 'Бот Омлет', 'Бот Глазунья', 'Бот Пашот'];
const BOT_WEAPONS = ['ak', 'm4', 'usp', 'deagle', 'shot'];
const BOT_SOCKET = { readyState: 3, send() {}, close() {} };

const COLORS = EggAppearance.COLORS.map(option => option.value);

const MAPS = Object.fromEntries([DEFAULT_MAP, TRAINING_MAP, ...HouseholdMaps.maps].map(map => [map.id, map]));

const mapCapacity = map => map.players?.max || MAX_PLAYERS;
const MAP_LIST = Object.values(MAPS).map(m => ({ id: m.id, name: m.name, maxPlayers: mapCapacity(m) }));

function impactMaterial(type, household) {
  if (household && ['metal', 'tin', 'plastic', 'tile', 'deck'].includes(type)) return 'metal';
  return type === 'hay' ? 'hay' : 'wood';
}

const colliderCache = new Map();

function mapColliders(map) {
  if (colliderCache.has(map.id)) return colliderCache.get(map.id);

  const list = [];
  for (const b of ArenaGeometry.boxes(map)) list.push({
    min:{x:b.x-b.w/2,y:b.y||0,z:b.z-b.d/2},
    max:{x:b.x+b.w/2,y:(b.y||0)+b.h,z:b.z+b.d/2},
    material: impactMaterial(b.type, map.household),
  });

  colliderCache.set(map.id, list);
  return list;
}

/* ---------- статика ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const gzipCache = new Map();
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.svg', '.txt']);

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400);
    return res.end('bad request');
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404');
    }
    const ext = path.extname(file);
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    };

    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (acceptsGzip && COMPRESSIBLE.has(ext)) {
      let entry = gzipCache.get(file);
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (!entry || entry.mtime !== mtime) {
          entry = { mtime, buf: zlib.gzipSync(data) };
          gzipCache.set(file, entry);
        }
      } catch {
        entry = { mtime: 0, buf: zlib.gzipSync(data) };
      }
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      res.writeHead(200, headers);
      return res.end(entry.buf);
    }

    res.writeHead(200, headers);
    res.end(data);
  });
});

/* ---------- комнаты ---------- */

const rooms = new Map(); // code -> room
let nextId = 1;
let nextGrenadeId = 1;

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[(Math.random() * chars.length) | 0]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = makeCode();
  const room = {
    code,
    players: new Map(),
    hostId: null,
    state: 'lobby', // lobby | playing | results
    mapId: DEFAULT_MAP.id,
    timeLeft: MATCH_TIME,
    round: 0,
    timer: null,
    startedAt: 0,
    lastSnapshot: 0,
    snapshots: [],
    grenades: [],
  };
  rooms.set(code, room);
  return room;
}

function send(ws, obj) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }
}

function broadcast(room, obj, exceptId) {
  const raw = JSON.stringify(obj);
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === 1) {
      try { p.ws.send(raw); } catch { /* ignore */ }
    }
  }
}

function publicPlayer(p) {
  const pub = { i: p.id, n: p.name, c: p.appearance.color, appearance: p.appearance, k: p.kills, d: p.deaths, hp: p.hp, a: p.alive && !p.inLobby ? 1 : 0 };
  if (p.bot) pub.bot = 1;
  return pub;
}

const humans = room => [...room.players.values()].filter(p => !p.bot);

function lobbyState(room) {
  return {
    t: 'players',
    hostId: room.hostId,
    state: room.state,
    mapId: room.mapId,
    practice: room.practice ? 1 : 0,
    maxPlayers: mapCapacity(MAPS[room.mapId]),
    players: [...room.players.values()].map(publicPlayer),
  };
}

function broadcastLobby(room) {
  broadcast(room, lobbyState(room));
}


function spawnPose(s) {
  const [tx,ty,tz] = s.target;
  return {x:s.x,y:s.y,z:s.z,yaw:Math.atan2(s.x-tx,s.z-tz),pitch:Math.atan2(ty-s.y-EYE_HEIGHT,Math.hypot(tx-s.x,tz-s.z))};
}

function placeAtSpawn(room,p) {
  Object.assign(p,pickSpawn(room,p));
  p.hp=100;p.alive=true;p.respawnAt=0;
  p.spawnedAt=Date.now();
  p.immuneUntil=Date.now()+MAPS[room.mapId].spawnRules.initialImmunitySeconds*1000;
  p.grenades=Grenades.CONFIG.count;
  p.lastGrenade=0;
}

function respawnPlayer(room, p) {
  placeAtSpawn(room,p);
  send(p.ws,{t:'respawn',you:{x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,grenades:p.grenades,lifeId:p.spawnedAt}});
}

function pickSpawn(room, player) {
  const map=MAPS[room.mapId];
  const enemies=[...room.players.values()].filter(p=>p!==player&&p.alive&&!p.inLobby);
  const options=map.spawns.map(s=>{
    const distance=Math.min(Infinity,...enemies.map(p=>Math.hypot(p.x-s.x,p.z-s.z)));
    const visible=map.spawnRules.avoidEnemyLineOfSight&&enemies.some(p=>ArenaGeometry.visible(map,{x:s.x,y:s.y+EYE_HEIGHT,z:s.z},{x:p.x,y:p.y+EYE_HEIGHT,z:p.z}));
    return {s,distance,visible,safe:!visible&&distance>=map.spawnRules.minimumEnemyDistanceOnRespawn};
  }).filter(o=>o.distance>map.playerCollision.radius*2&&!ArenaGeometry.blocks(map,o.s.x,o.s.z,o.s.y));
  options.sort((a,b)=>Number(b.safe)-Number(a.safe)||Number(a.visible)-Number(b.visible)||b.distance-a.distance);
  // В тренировке боты появляются рядом с игроком (но не вплотную), чтобы не искать их по всей карте.
  if(room.practice&&player.bot&&enemies.some(p=>!p.bot)){
    const near=options.filter(o=>o.distance>=6).sort((a,b)=>a.distance-b.distance);
    if(near.length)return spawnPose(near[0].s);
  }
  if(!options.length)throw Error('No free JSON spawn');
  return spawnPose(options[0].s);
}

function freeColor(room) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[room.players.size % COLORS.length];
}

function resetPlayerForMatch(p) {
  p.inLobby = false;
  p.hp = 100;
  p.alive = true;
  p.kills = 0;
  p.deaths = 0;
  p.respawnAt = 0;
  p.lastShot = 0;
}

function startMatch(room) {
  if (room.players.size === 0) return;
  if (room.timer) clearInterval(room.timer);

  room.state = 'playing';
  room.timeLeft = MATCH_TIME;
  room.round += 1;
  room.startedAt = Date.now();
  room.lastSnapshot = 0;
  room.snapshots = [];
  room.grenades = [];

  const map = MAPS[room.mapId] || DEFAULT_MAP;
  const list = [...room.players.values()];
  for(const p of list)p.alive=false;

  list.forEach(p=>{resetPlayerForMatch(p);placeAtSpawn(room,p);});
  list.forEach((p) => {
    send(p.ws, {
      t: 'start',
      timeLeft: MATCH_TIME,
      round: room.round,
      you: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch:p.pitch, grenades:p.grenades, lifeId:p.spawnedAt },
      arena: map,
      mapName: map.name,
      weapons: WEAPONS,
      players: list.map(publicPlayer),
    });
  });

  broadcastLobby(room);

  room.timer = setInterval(() => tickRoom(room), 33);
}

function endMatch(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  room.state = 'results';
  room.grenades = [];
  const scores = [...room.players.values()]
    .map((p) => ({ i: p.id, n: p.name, c: p.color, k: p.kills, d: p.deaths }))
    .sort((a, b) => b.k - a.k || a.d - b.d);
  broadcast(room, { t: 'end', scores, round: room.round });
}

function tickRoom(room) {
  try {
    tickRoomInner(room);
  } catch (e) {
    console.error('tick error', e);
  }
}

function tickRoomInner(room) {
  const now = Date.now();
  const deadline = room.startedAt + MATCH_TIME * 1000;
  room.timeLeft = Math.max(0, Math.min(MATCH_TIME, (deadline - now) / 1000));

  tickGrenades(room, Math.min(now, deadline));
  if (room.timeLeft <= 0) { endMatch(room); return; }

  if (room.practice) tickBots(room, now);

  // респавны
  for (const p of room.players.values()) {
    const map = MAPS[room.mapId];
    if (p.alive && !p.inLobby && Number.isFinite(map.killY) && p.y < map.killY) respawnPlayer(room, p);
    if (!p.alive && !p.inLobby && now >= p.respawnAt) respawnPlayer(room, p);
  }

  if (now - room.lastSnapshot >= 33) {
    room.lastSnapshot = now;
    const snapshot = {
      t: 's',
      at: now,
      tl: Math.round(room.timeLeft * 10) / 10,
      g: room.grenades.map(grenade => publicGrenade(grenade, now)),
      p: [...room.players.values()].map((p) => ({
        i: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), p: r2(p.pitch),
        hp: Math.round(p.hp), a: p.alive && !p.inLobby ? 1 : 0, im:p.immuneUntil>now?1:0, k: p.kills, d: p.deaths,
        grenades: p.grenades, ...(p.bot ? { bot: 1 } : {}),
      })),
    };
    room.snapshots.push(snapshot);
    // Retain one preceding sample so positions between snapshots can be interpolated.
    while (room.snapshots.length > 2 && room.snapshots[1].at < now - MAX_REWIND_MS) room.snapshots.shift();
    broadcast(room, snapshot);
  }

}

const r2 = (n) => Math.round(n * 100) / 100;

/* ---------- гранаты ---------- */

function publicGrenade(grenade, now = Date.now()) {
  return { id: grenade.id, owner: grenade.owner, x: r2(grenade.x), y: r2(grenade.y), z: r2(grenade.z), fuse: Math.max(0, r2((grenade.expiresAt-now)/1000)) };
}

function handleGrenade(room, player, message) {
  if (room.state !== 'playing' || !player.alive || player.inLobby || player.grenades <= 0) return;
  const now = Date.now();
  if (now-player.lastGrenade < Grenades.CONFIG.cooldown) return;
  if (![message.dx,message.dy,message.dz].every(value => typeof value === 'number' && Number.isFinite(value))) return;
  const length = Math.hypot(message.dx,message.dy,message.dz);
  if (!Number.isFinite(length) || length < .001) return;
  const direction = {x:message.dx/length,y:message.dy/length,z:message.dz/length};
  const origin = {x:player.x,y:player.y+EYE_HEIGHT-.1,z:player.z};
  const grenade = Grenades.create(MAPS[room.mapId],origin,direction,nextGrenadeId++,player.id,now);
  player.lastGrenade = now;
  player.grenades--;
  room.grenades.push(grenade);
  broadcast(room,{t:'grenade',...publicGrenade(grenade,now),remaining:player.grenades});
}

function tickGrenades(room, now) {
  for (let index = room.grenades.length-1; index >= 0; index--) {
    const grenade = room.grenades[index];
    const map = MAPS[room.mapId];
    Grenades.advanceTo(grenade,map,now);
    if (now < grenade.expiresAt) continue;
    room.grenades.splice(index,1);
    broadcast(room,{t:'explosion',id:grenade.id,owner:grenade.owner,x:r2(grenade.x),y:r2(grenade.y),z:r2(grenade.z),radius:Grenades.CONFIG.radius});
    const owner = room.players.get(grenade.owner);
    if (!owner) continue;
    for (const victim of room.players.values()) {
      if (!victim.alive || victim.inLobby || grenade.expiresAt < victim.spawnedAt || grenade.expiresAt < victim.immuneUntil) continue;
      const damage = Grenades.damage(map,grenade,victim);
      if (damage) damagePlayer(room,owner,victim,damage,'grenade',now);
    }
  }
}

function damagePlayer(room, attacker, victim, damage, weapon, now) {
  if (!victim.alive) return;
  victim.hp = Math.max(0,victim.hp-damage);
  broadcast(room,{t:'hit',from:attacker.id,to:victim.id,dmg:damage,hp:Math.round(victim.hp),w:weapon});
  if (victim.hp > 0) return;
  victim.alive = false;
  victim.deaths++;
  victim.respawnAt = now+RESPAWN_DELAY*1000;
  if (attacker.id !== victim.id) attacker.kills++;
  broadcast(room,{t:'kill',killer:attacker.id,victim:victim.id,kn:attacker.name,kc:attacker.color,vn:victim.name,vc:victim.color,w:weapon});
}

/* ---------- столкновения луча ---------- */

function raySphere(o, d, c, rad) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - rad * rad;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc), near = -b - root, far = -b + root;
  // Players can overlap in narrow passages. A ray starting inside an endcap
  // still intersects its exit surface, just like the capsule's cylinder does.
  return near >= 0 ? near : far >= 0 ? far : Infinity;
}

function rayAABB(o, d, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(d[ax]) < 1e-8) {
      if (o[ax] < min[ax] || o[ax] > max[ax]) return Infinity;
    } else {
      let t1 = (min[ax] - o[ax]) / d[ax];
      let t2 = (max[ax] - o[ax]) / d[ax];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  if (tmax < 0) return Infinity;
  return tmin >= 0 ? tmin : 0;
}

function spreadDirection(d, amount) {
  if (!amount || amount <= 0) return d;
  const up = Math.abs(d.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  let rx = up.y * d.z - up.z * d.y;
  let ry = up.z * d.x - up.x * d.z;
  let rz = up.x * d.y - up.y * d.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const ux = d.y * rz - d.z * ry;
  const uy = d.z * rx - d.x * rz;
  const uz = d.x * ry - d.y * rx;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * amount;
  const nx = d.x + (rx * Math.cos(a) + ux * Math.sin(a)) * r;
  const ny = d.y + (ry * Math.cos(a) + uy * Math.sin(a)) * r;
  const nz = d.z + (rz * Math.cos(a) + uz * Math.sin(a)) * r;
  const l = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / l, y: ny / l, z: nz / l };
}

// Intersect a solid ramp with its six half-spaces, including the sloped top.
function rayRamp(o, d, r) {
  const axis = r.dir.endsWith('x') ? 'x' : 'z';
  const slope = (r.h1 - r.h0) / (axis === 'x' ? r.w : r.d) * (r.dir.startsWith('+') ? 1 : -1);
  const top = (r.h0 + r.h1) / 2 - slope * r[axis];
  const planes = [
    [1, 0, 0, r.x + r.w / 2], [-1, 0, 0, -r.x + r.w / 2],
    [0, 0, 1, r.z + r.d / 2], [0, 0, -1, -r.z + r.d / 2],
    [0, -1, 0, 0], [axis === 'x' ? -slope : 0, 1, axis === 'z' ? -slope : 0, top],
  ];
  let near = 0, far = Infinity, normal = {x:-d.x,y:-d.y,z:-d.z};
  for (const [x, y, z, bound] of planes) {
    const distance = bound - (x * o.x + y * o.y + z * o.z);
    const speed = x * d.x + y * d.y + z * d.z;
    if (Math.abs(speed) < 1e-8) {
      if (distance < 0) return {t:Infinity};
    } else if (speed < 0) {
      const t = distance / speed;
      if (t > near) { near = t; const len = Math.hypot(x,y,z); normal = {x:x/len,y:y/len,z:z/len}; }
    }
    else far = Math.min(far, distance / speed);
    if (near > far) return {t:Infinity};
  }
  return {t:near,normal};
}

function roundNormal(solid, point) {
  let closest = Infinity, normal = {x:0,y:1,z:0};
  for (const p of ArenaGeometry.roundParts(solid)) {
    const apothem = Math.cos(Math.PI / ArenaGeometry.ROUND_SEGMENTS);
    const slope = (p.top-p.bottom)/p.h;
    const planes = [[0,1,0,p.y+p.h],[0,-1,0,-p.y]];
    for (let i=0;i<ArenaGeometry.ROUND_SEGMENTS;i++) {
      const angle=(i+.5)*Math.PI*2/ArenaGeometry.ROUND_SEGMENTS;
      const x=Math.sin(angle),z=Math.cos(angle),y=-slope*apothem;
      planes.push([x,y,z,x*p.x+y*p.y+z*p.z+p.bottom*apothem]);
    }
    if (planes.some(([x,y,z,b])=>x*point.x+y*point.y+z*point.z>b+.001)) continue;
    for (const [x,y,z,b] of planes) {
      const len=Math.hypot(x,y,z),distance=Math.abs(b-x*point.x-y*point.y-z*point.z)/len;
      if (distance<closest) { closest=distance;normal={x:x/len,y:y/len,z:z/len}; }
    }
  }
  return normal;
}

function rayPlayer(o,d,p,shape) {
  const r=shape.radius,low=p.y+r,high=p.y+shape.height-r;
  let nearest=Math.min(raySphere(o,d,{x:p.x,y:low,z:p.z},r),raySphere(o,d,{x:p.x,y:high,z:p.z},r));
  const x=o.x-p.x,z=o.z-p.z,a=d.x*d.x+d.z*d.z,b=x*d.x+z*d.z,c=x*x+z*z-r*r;
  const disc=b*b-a*c;
  if(a>1e-9&&disc>=0)for(const t of [(-b-Math.sqrt(disc))/a,(-b+Math.sqrt(disc))/a])if(t>=0&&o.y+d.y*t>=low&&o.y+d.y*t<=high)nearest=Math.min(nearest,t);
  return nearest;
}

function viewedPlayer(room, player, at, now) {
  if (!Number.isFinite(at) || at < now - MAX_REWIND_MS || at > now) return player;
  if (at < player.spawnedAt) return null;
  let before, after;
  for (const snapshot of room.snapshots) {
    if (snapshot.at <= at) before = snapshot;
    else { after = snapshot; break; }
  }
  const a = before?.p.find(p => p.i === player.id);
  if (!a?.a || before.at < player.spawnedAt) return null;
  const b = after?.p.find(p => p.i === player.id);
  const blend = b?.a ? (at - before.at) / (after.at - before.at) : 0;
  return { x: a.x + ((b?.x ?? a.x) - a.x) * blend,
    y: a.y + ((b?.y ?? a.y) - a.y) * blend,
    z: a.z + ((b?.z ?? a.z) - a.z) * blend };
}

function handleShoot(room, p, msg) {
  if (room.state !== 'playing' || !p.alive || p.inLobby) return;

  const w = WEAPONS[msg.w] || WEAPONS.ak;
  const now = Date.now();
  const cooldown = Math.max(45, (60000 / w.rpm) * 0.85);
  if (now - p.lastShot < cooldown) return;
  const o = { x: Number(p.x), y: Number(p.y) + EYE_HEIGHT, z: Number(p.z) };
  let d = { x: Number(msg.dx), y: Number(msg.dy), z: Number(msg.dz) };
  const len = Math.hypot(d.x, d.y, d.z);
  if (!Number.isFinite(len) || len < 0.001) return;
  d = { x: d.x / len, y: d.y / len, z: d.z / len };
  p.lastShot = now;

  if (w.melee) return handleMelee(room, p, w, o, d, msg, now);

  const rays = [];
  const map = MAPS[room.mapId];
  const damage = new Map();

  for (let pellet = 0; pellet < w.pellets; pellet++) {
    const dir = w.pellets > 1 ? spreadDirection(d, w.spread * (msg.aim ? 0.45 : 1)) : d;

    let blockT = Infinity, material = null;
    let normal = {x:-dir.x,y:-dir.y,z:-dir.z};
    if (map.mesh) {
      const hit = ArenaGeometry.rayMesh(map, o, dir);
      if (hit) { blockT = hit.t; material = hit.material; normal = hit.normal; }
    }
    for (const c of map.mesh ? [] : mapColliders(map)) {
      const t = rayAABB(o, dir, c.min, c.max);
      if (t < blockT) {
        blockT = t; material = c.material || 'wood';
        const point = {x:o.x+dir.x*t,y:o.y+dir.y*t,z:o.z+dir.z*t};
        const faces = [];
        for (const axis of ['x','y','z']) for (const side of ['min','max']) {
          const n = {x:0,y:0,z:0}; n[axis] = side === 'min' ? -1 : 1;
          faces.push({distance:Math.abs(point[axis]-c[side][axis]),normal:n});
        }
        normal = faces.sort((a,b)=>a.distance-b.distance)[0].normal;
      }
    }

    for (const r of map.mesh ? [] : map.ramps || []) {
      const hit = rayRamp(o, dir, r);
      if (hit.t < blockT) { blockT = hit.t; material = map.household === 'fridge' ? 'metal' : 'wood'; normal = hit.normal; }
    }

    for (const solid of map.mesh ? [] : map.rounds) {
      const t = ArenaGeometry.rayRound(o, dir, solid);
      if (t < blockT) { blockT = t; material = solid.type === 'feeder' ? 'metal' : impactMaterial(solid.type, map.household); normal = roundNormal(solid,{x:o.x+dir.x*t,y:o.y+dir.y*t,z:o.z+dir.z*t}); }
    }

    if (dir.y < 0 && !map.mesh) {
      const t = -o.y / dir.y;
      if (t >= 0 && t < blockT && Math.abs(o.x+dir.x*t)<=map.halfX && Math.abs(o.z+dir.z*t)<=map.halfZ) {
        blockT = t; material = map.household ? (map.household === 'fridge' ? 'metal' : 'wood') : 'dirt'; normal = {x:0,y:1,z:0};
      }
    }

    let best = null;
    let bestPose = null;
    let bestT = Infinity;
    for (const other of room.players.values()) {
      if (other.id === p.id || !other.alive || other.inLobby) continue;
      const pose = viewedPlayer(room, other, msg.viewTime, now);
      if (!pose) continue;
      const t = rayPlayer(o,dir,pose,map.playerCollision);
      if (t < bestT && t < blockT) { bestT = t; best = other; bestPose = pose; }
    }

    if (best) {
      if(now>=best.immuneUntil)damage.set(best, (damage.get(best) || 0) + w.dmg);
      const x=o.x+dir.x*bestT-bestPose.x,y=o.y+dir.y*bestT-bestPose.y-map.playerCollision.height/2,z=o.z+dir.z*bestT-bestPose.z;
      const len=Math.hypot(x,y,z)||1;normal={x:x/len,y:y/len,z:z/len};
    }
    const distance = Math.min(best ? bestT : blockT, 90);
    rays.push({
      point:{x:o.x+dir.x*distance,y:o.y+dir.y*distance,z:o.z+dir.z*distance},
      normal, material:best ? now<best.immuneUntil?null:'egg' : blockT <= 90 ? material : null, target:best ? best.id : null,
    });
  }

  broadcast(room, {t:'shot',i:p.id,w:w.id,origin:o,rays});

  for (const [victim, dmg] of damage) {
    damagePlayer(room,p,victim,dmg,w.id,now);
  }
}

/* Нож: попадает в ближайшее яйцо в горизонтальном конусе перед игроком. Наклон
 * камеры не важен — порез по низкому или высокому сопернику засчитывается. */
function handleMelee(room, p, w, o, d, msg, now) {
  const map = MAPS[room.mapId];
  const shape = map.playerCollision;
  const flat = Math.hypot(d.x, d.z) || 1;
  const fx = d.x / flat, fz = d.z / flat;
  let best = null, bestPose = null, bestDistance = Infinity;
  for (const other of room.players.values()) {
    if (other.id === p.id || !other.alive || other.inLobby) continue;
    const pose = viewedPlayer(room, other, msg.viewTime, now);
    if (!pose) continue;
    const dx = pose.x - o.x, dz = pose.z - o.z;
    const horizontal = Math.hypot(dx, dz);
    const reach = horizontal - shape.radius;
    if (reach > w.range) continue;
    const top = pose.y + shape.height, bottom = pose.y;
    if (o.y < bottom - .6 || o.y > top + .9) continue;
    if (horizontal > shape.radius && (dx * fx + dz * fz) / horizontal < KNIFE_CONE) continue;
    const chest = { x: pose.x, y: Math.max(bottom + .2, Math.min(top - .2, o.y)), z: pose.z };
    if (!ArenaGeometry.visible(map, o, chest)) continue;
    if (horizontal < bestDistance) { bestDistance = horizontal; best = other; bestPose = chest; }
  }

  let ray;
  if (best) {
    const len = Math.hypot(o.x - bestPose.x, o.z - bestPose.z) || 1;
    const normal = { x: (o.x - bestPose.x) / len, y: 0, z: (o.z - bestPose.z) / len };
    const immune = now < best.immuneUntil;
    ray = { point: { x: bestPose.x + normal.x * shape.radius, y: bestPose.y, z: bestPose.z + normal.z * shape.radius },
      normal, material: immune ? null : 'egg', target: best.id };
  } else {
    // Взмах в воздух: если рядом стена — короткий звук удара по материалу.
    const hit = map.mesh ? ArenaGeometry.rayMesh(map, o, d) : null;
    const t = hit && hit.t <= w.range ? hit.t : w.range;
    ray = { point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t },
      normal: hit && hit.t <= w.range ? hit.normal : { x: -d.x, y: -d.y, z: -d.z },
      material: hit && hit.t <= w.range ? hit.material : null, target: null };
  }

  broadcast(room, { t: 'shot', i: p.id, w: w.id, origin: o, melee: 1, rays: [ray] });
  if (best && now >= best.immuneUntil) damagePlayer(room, p, best, w.dmg, w.id, now);
}

/* ---------- боты (тренировка) ---------- */

function addBot(room, index) {
  const id = nextId++;
  const appearance = EggAppearance.normalize({ color: freeColor(room) }, { color: freeColor(room) });
  const bot = {
    id, name: BOT_NAMES[index % BOT_NAMES.length], color: appearance.color, appearance, ws: BOT_SOCKET, bot: true,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    hp: 100, alive: true, inLobby: false, kills: 0, deaths: 0,
    respawnAt: 0, lastShot: 0, grenades: 0, lastGrenade: 0,
    ai: { waypoint: null, target: null, seenAt: 0, nextShot: 0, ammo: 0, weapon: 'ak', strafe: Math.random() < .5 ? 1 : -1, strafeUntil: 0, stuck: 0, lifeId: 0 },
  };
  room.players.set(id, bot);
  return bot;
}

function botLoadout(bot) {
  bot.ai.weapon = BOT_WEAPONS[(Math.random() * BOT_WEAPONS.length) | 0];
  bot.ai.ammo = WEAPONS[bot.ai.weapon].mag;
  bot.ai.lifeId = bot.spawnedAt;
  bot.ai.target = null;
  bot.ai.waypoint = null;
}

function botStep(map, bot, dx, dz) {
  const shape = map.playerCollision;
  const tryMove = (x, z) => {
    x = Math.max(map.bounds.minX + shape.radius, Math.min(map.bounds.maxX - shape.radius, x));
    z = Math.max(map.bounds.minZ + shape.radius, Math.min(map.bounds.maxZ - shape.radius, z));
    const ground = ArenaGeometry.groundHeight(map, x, z, bot.y + shape.maxStepHeight);
    if (!Number.isFinite(ground)) return false;
    // Не прыгаем в пропасть глубже 1,6 м — бот обходит обрывы.
    if (bot.y - ground > 1.6) return false;
    if (ArenaGeometry.blocks(map, x, z, Math.max(ground, bot.y))) return false;
    bot.x = x; bot.z = z; bot.y = Math.max(map.bounds.floorY, ground);
    return true;
  };
  return tryMove(bot.x + dx, bot.z + dz) || tryMove(bot.x + dx, bot.z) || tryMove(bot.x, bot.z + dz);
}

function tickBots(room, now) {
  const map = MAPS[room.mapId];
  const dt = Math.min(.1, (now - (room.lastBotTick || now)) / 1000) || .05;
  room.lastBotTick = now;
  const eye = EYE_HEIGHT;
  for (const bot of room.players.values()) {
    if (!bot.bot || !bot.alive || bot.inLobby) continue;
    const ai = bot.ai;
    if (ai.lifeId !== bot.spawnedAt) botLoadout(bot);

    // Ближайший видимый соперник.
    let target = null, targetDistance = Infinity;
    const from = { x: bot.x, y: bot.y + eye, z: bot.z };
    for (const other of room.players.values()) {
      if (other === bot || !other.alive || other.inLobby) continue;
      const distance = Math.hypot(other.x - bot.x, other.z - bot.z, other.y - bot.y);
      if (distance > 45 || distance >= targetDistance) continue;
      if (!ArenaGeometry.visible(map, from, { x: other.x, y: other.y + eye * .8, z: other.z })) continue;
      target = other; targetDistance = distance;
    }
    if (target !== ai.target) { ai.target = target; ai.seenAt = now; }

    // Движение: к цели/вокруг неё либо патруль по точкам спавна.
    const speed = 3.2 * dt;
    let mx = 0, mz = 0;
    if (target) {
      const dx = target.x - bot.x, dz = target.z - bot.z, len = Math.hypot(dx, dz) || 1;
      if (now > ai.strafeUntil) { ai.strafe = Math.random() < .5 ? 1 : -1; ai.strafeUntil = now + 600 + Math.random() * 900; }
      const want = ai.weapon === 'shot' ? 4 : 9;
      const forward = targetDistance > want + 2 ? 1 : targetDistance < want - 3 ? -.6 : 0;
      mx = (dx / len) * forward + (-dz / len) * ai.strafe * .8;
      mz = (dz / len) * forward + (dx / len) * ai.strafe * .8;
    } else {
      if (!ai.waypoint || Math.hypot(ai.waypoint.x - bot.x, ai.waypoint.z - bot.z) < 1.2 || ai.stuck > 1.2) {
        const humansFirst = [...room.players.values()].filter(p => p !== bot && p.alive && !p.inLobby);
        const chase = humansFirst.length && Math.random() < .55 ? humansFirst[(Math.random() * humansFirst.length) | 0] : null;
        const spot = chase || map.spawns[(Math.random() * map.spawns.length) | 0];
        ai.waypoint = { x: spot.x, z: spot.z };
        ai.stuck = 0;
      }
      const dx = ai.waypoint.x - bot.x, dz = ai.waypoint.z - bot.z, len = Math.hypot(dx, dz) || 1;
      mx = dx / len; mz = dz / len;
    }
    const mlen = Math.hypot(mx, mz);
    if (mlen > .01) {
      const moved = botStep(map, bot, mx / mlen * speed, mz / mlen * speed);
      if (!moved) { ai.stuck += dt; ai.strafe *= -1; } else ai.stuck = Math.max(0, ai.stuck - dt);
      if (!target) bot.yaw = Math.atan2(-mx, -mz);
    }

    if (!target) continue;
    // Прицел: смотрим на соперника, стреляем с задержкой реакции и разбросом.
    const aim = { x: target.x - bot.x, y: target.y + eye * .75 - (bot.y + eye), z: target.z - bot.z };
    bot.yaw = Math.atan2(-aim.x, -aim.z);
    bot.pitch = Math.atan2(aim.y, Math.hypot(aim.x, aim.z));
    if (now - ai.seenAt < 900 || now < ai.nextShot || now < target.immuneUntil) continue;

    const weaponId = targetDistance < 2.4 ? 'knife' : ai.weapon;
    const w = WEAPONS[weaponId];
    const length = Math.hypot(aim.x, aim.y, aim.z) || 1;
    const error = .07 + Math.min(.07, targetDistance * .003);
    const dir = { x: aim.x / length + (Math.random() - .5) * error * 2, y: aim.y / length + (Math.random() - .5) * error * 2, z: aim.z / length + (Math.random() - .5) * error * 2 };
    bot.lastShot = 0;
    handleShoot(room, bot, { w: weaponId, dx: dir.x, dy: dir.y, dz: dir.z });
    const pause = 60000 / w.rpm * (w.auto ? 2.2 : 1.6) + 150 + Math.random() * 350;
    ai.nextShot = now + pause;
    if (!w.melee && --ai.ammo <= 0) { ai.ammo = w.mag; ai.nextShot = now + w.reload * 1000; }
  }
}

/* ---------- websocket ---------- */

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.playerId = null;
  ws.roomCode = null;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { onMessage(ws, msg); } catch (e) { console.error('msg error', e); }
  });

  ws.on('close', () => {
    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
    if (!room) return;
    const p = room.players.get(ws.playerId);
    if (!p) return;
    room.players.delete(p.id);
    room.grenades = room.grenades.filter(grenade => grenade.owner !== p.id);

    if (humans(room).length === 0) {
      if (room.timer) clearInterval(room.timer);
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === p.id) {
      room.hostId = humans(room)[0].id;
    }
    if (room.state === 'playing' && room.players.size < 1) {
      endMatch(room);
    }
    broadcastLobby(room);
  });
});

function onMessage(ws, msg) {
  if (msg.t === 'create' || msg.t === 'join') {
    if (ws.roomCode) return;

    const name = String(msg.name || 'Яйцо').slice(0, 12).trim() || 'Яйцо';
    let room;
    let code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

    if (msg.t === 'create') {
      room = createRoom();
      if (Object.hasOwn(MAPS, msg.mapId)) room.mapId = msg.mapId;
    } else {
      room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: 'Комната не найдена' });
      if (room.practice) return send(ws, { t: 'error', msg: 'Это тренировка с ботами — в неё нельзя войти' });
      if (room.players.size >= mapCapacity(MAPS[room.mapId])) return send(ws, { t: 'error', msg: 'Комната заполнена' });
    }

    const id = nextId++;
    const appearance = EggAppearance.normalize(msg.appearance, { color: freeColor(room) });
    const player = {
      id, name, color: appearance.color, appearance, ws,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
      hp: 100, alive: true, inLobby: false, kills: 0, deaths: 0,
      respawnAt: 0, lastShot: 0,
      grenades: Grenades.CONFIG.count, lastGrenade: 0,
    };
    room.players.set(id, player);
    if (!room.hostId) room.hostId = id;

    ws.playerId = id;
    ws.roomCode = room.code;

    // если матч уже идёт — сразу кидаем новичка в бой
    const map = MAPS[room.mapId] || DEFAULT_MAP;
    if (room.state === 'playing') {
      placeAtSpawn(room,player);
    }

    send(ws, {
      t: 'joined',
      id,
      code: room.code,
      hostId: room.hostId,
      state: room.state,
      timeLeft: room.timeLeft,
      arena: map,
      maps: MAP_LIST,
      mapId: room.mapId,
      weapons: WEAPONS,
      maxPlayers: mapCapacity(map),
    });

    if (room.state === 'playing') {
      send(ws, {
        t: 'start',
        timeLeft: room.timeLeft,
        round: room.round,
        you: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch:player.pitch, grenades:player.grenades, lifeId:player.spawnedAt },
        arena: map,
        mapName: map.name,
        weapons: WEAPONS,
        players: [...room.players.values()].map(publicPlayer),
      });
    }

    broadcastLobby(room);

    // Тренировка: добавляем ботов и сразу начинаем бой.
    if (msg.t === 'create' && msg.practice) {
      room.practice = true;
      const count = Math.max(1, Math.min(mapCapacity(map) - 1, Number(msg.bots) || 2));
      for (let i = 0; i < count; i++) addBot(room, i);
      startMatch(room);
    }
    return;
  }

  const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
  const p = room && room.players.get(ws.playerId);
  if (!room || !p) return;

  switch (msg.t) {
    case 'appearance': {
      if (room.state === 'playing' && !p.inLobby) return;
      const appearance = EggAppearance.normalize(msg.appearance, p.appearance);
      if (EggAppearance.key(appearance) === EggAppearance.key(p.appearance)) return;
      p.appearance = appearance;
      p.color = appearance.color;
      broadcastLobby(room);
      break;
    }
    case 'start': {
      if (p.id !== room.hostId) return;
      startMatch(room);
      break;
    }
    case 'input': {
      if (room.state !== 'playing' || !p.alive || p.inLobby) return;
      const x = Number(msg.x), y = Number(msg.y), z = Number(msg.z);
      const yaw = Number(msg.yaw), pitch = Number(msg.pitch);
      if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
      const map = MAPS[room.mapId];
      p.x = Math.max(map.bounds.minX+map.playerCollision.radius, Math.min(map.bounds.maxX-map.playerCollision.radius, x));
      p.y = Math.max(map.bounds.floorY, Math.min(map.bounds.maxY ?? 10, y));
      p.z = Math.max(map.bounds.minZ+map.playerCollision.radius, Math.min(map.bounds.maxZ-map.playerCollision.radius, z));
      p.yaw = yaw;
      p.pitch = Math.max(-1.5, Math.min(1.5, pitch));
      break;
    }
    case 'shoot': {
      handleShoot(room, p, msg);
      break;
    }
    case 'grenade': {
      handleGrenade(room,p,msg);
      break;
    }
    case 'lobby': {
      if (room.state === 'playing') {
        // Pausing hides the player; it does not end their life, cancel a thrown
        // grenade or grant a fresh loadout and immunity when they return.
        p.inLobby = true;
      }
      broadcastLobby(room);
      break;
    }
    case 'resume': {
      if (room.state !== 'playing' || !p.inLobby) return;
      p.inLobby = false;
      const map = MAPS[room.mapId];
      const now = Date.now(), respawned = !p.alive && now >= p.respawnAt;
      if (respawned) placeAtSpawn(room, p);
      else if (p.alive && (ArenaGeometry.blocks(map, p.x, p.z, p.y) || (Number.isFinite(map.killY) && p.y < map.killY))) Object.assign(p, pickSpawn(room, p));
      const you = { x:p.x, y:p.y, z:p.z, yaw:p.yaw, pitch:p.pitch, grenades:p.grenades,
        hp:p.hp, alive:p.alive, lifeId:p.spawnedAt, respawned, respawnIn:p.alive ? 0 : Math.max(0, (p.respawnAt - now) / 1000) };
      send(ws, {
        t: 'start', resume: true, timeLeft: room.timeLeft, round: room.round,
        you, arena: map, mapName: map.name, weapons: WEAPONS,
        players: [...room.players.values()].map(publicPlayer),
      });
      broadcastLobby(room);
      break;
    }
    case 'map': {
      if (p.id !== room.hostId) return;
      if (room.state === 'playing') return;
      if (!Object.hasOwn(MAPS, msg.id)) return;
      if (room.players.size > mapCapacity(MAPS[msg.id])) return send(ws, { t: 'error', msg: `Карта «${MAPS[msg.id].name}» рассчитана на ${mapCapacity(MAPS[msg.id])} игроков. Сейчас в комнате ${room.players.size}.` });
      room.mapId = msg.id;
      broadcastLobby(room);
      break;
    }
    case 'respawn': {
      if (room.state !== 'playing' || p.alive || p.inLobby) return;
      if (Date.now() < p.respawnAt - 400) return;
      respawnPlayer(room, p);
      break;
    }
    case 'leave': {
      ws.close();
      break;
    }
  }
}

// heartbeat
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

async function startServer() {
  const THREE = await import('three');
  const { Octree } = await import('three/addons/math/Octree.js');
  const { Capsule } = await import('three/addons/math/Capsule.js');
  const data = require('./public/maps/training/scene.json');
  ArenaGeometry.registerMesh(TRAINING_MAP.id, MeshWorld.collision(THREE, Octree, Capsule, data, TRAINING_MAP));
  for (const arena of HouseholdMaps.maps) {
    const parts = HouseholdShapes.build(THREE, arena);
    ArenaGeometry.registerMesh(arena.id, MeshWorld.collision(THREE, Octree, Capsule, HouseholdShapes.toCollision(parts), arena));
    for (const part of parts) part.geometry.dispose();
  }
  server.listen(PORT, () => console.log(`EGG STRIKE ready on http://localhost:${PORT}`));
}
startServer().catch(error => { console.error('Map initialization failed:', error); clearInterval(heartbeat); process.exitCode = 1; });
