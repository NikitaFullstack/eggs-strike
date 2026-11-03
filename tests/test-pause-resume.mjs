import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function definition(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `server defines ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
let now = 10000, unsafe = false;
const ws = { playerId: 1, roomCode: 'PAUS' }, messages = [], events = [];
const p = { id:1, ws, name:'Pause', appearance:{color:'#ffd23f'}, kills:0, deaths:0,
  x:1, y:0, z:1, yaw:.4, pitch:.1, hp:37, alive:true, inLobby:false, grenades:1,
  spawnedAt:1000, immuneUntil:2500, respawnAt:0, lastShot:9000, lastGrenade:9000 };
const projectile = { id:1, owner:1 };
const room = { code:'PAUS', state:'playing', mapId:'test', timeLeft:200, round:1,
  players:new Map([[1,p]]), grenades:[projectile] };
const map = { name:'Test', rounds:[], ramps:[], bounds:{floorY:0,minX:-10,maxX:10,minZ:-10,maxZ:10},
  playerCollision:{radius:.34,height:1.15}, spawnRules:{initialImmunitySeconds:1.5} };
const context = { Date:{now:()=>now}, rooms:new Map([['PAUS',room]]), MAPS:{test:map},
  WEAPONS:{ak:{id:'ak',rpm:600,pellets:1,dmg:20}}, EYE_HEIGHT:.9775,
  Grenades:{CONFIG:{count:2}}, ArenaGeometry:{blocks:()=>unsafe},
  pickSpawn:()=>({x:5,y:0,z:5,yaw:0,pitch:0}), mapColliders:()=>[],
  send:(_ws,message)=>messages.push(message), broadcast:(_room,message)=>events.push(message),
  broadcastLobby:()=>{}, handleGrenade:()=>assert.fail('unexpected throw'),
};
const api = vm.runInNewContext(`${['publicPlayer','placeAtSpawn','handleShoot','onMessage'].map(definition).join('\n')}\n({onMessage,publicPlayer})`,context);
const send = message => api.onMessage(ws,message);
const life = () => JSON.stringify(Object.fromEntries(['hp','alive','grenades','spawnedAt','immuneUntil','respawnAt','lastShot','lastGrenade','x','y','z','yaw','pitch'].map(key=>[key,p[key]])));
const before = life();
send({t:'lobby'});send({t:'lobby'});
assert.equal(p.inLobby,true);
assert.equal(life(),before,'pausing preserves all combat state and repeated pause is idempotent');
assert.equal(api.publicPlayer(p).a,0,'paused living player is hidden from peers');
assert.equal(room.grenades[0],projectile,'pausing cannot cancel a thrown grenade');
send({t:'input',x:7,y:0,z:7,yaw:0,pitch:0});
assert.equal(life(),before,'paused players cannot move through input packets');
send({t:'resume'});
assert.equal(life(),before,'resuming a life grants no healing, ammo, immunity or cooldown reset');
assert.equal(p.inLobby,false);
assert.equal(messages.at(-1).resume,true);
assert.equal(messages.at(-1).you.hp,37);
assert.equal(messages.at(-1).you.alive,true);
assert.equal(messages.at(-1).you.lifeId,1000);
assert.equal(messages.at(-1).you.respawned,false);

// Previously each lobby/resume reset lastShot, allowing repeated same-tick shots.
send({t:'shoot',w:'ak',dx:1,dy:0,dz:0});
send({t:'lobby'});send({t:'resume'});send({t:'shoot',w:'ak',dx:1,dy:0,dz:0});
assert.equal(events.filter(event=>event.t==='shot').length,1,'pause/resume cannot bypass the actual weapon cooldown');

unsafe=true;send({t:'lobby'});send({t:'resume'});
assert.equal(p.x,5,'an unsafe pose can be relocated');
assert.equal(p.hp,37,'relocation is not a new life');
assert.equal(p.grenades,1);
assert.equal(p.immuneUntil,2500);
unsafe=false;

p.alive=false;p.hp=0;p.respawnAt=12000;p.grenades=0;
send({t:'lobby'});send({t:'resume'});
assert.equal(p.alive,false,'returning before the respawn deadline stays dead');
assert.equal(p.hp,0);
assert.equal(p.grenades,0);
assert.equal(messages.at(-1).you.respawnIn,2,'remaining respawn countdown is in seconds');
assert.equal(messages.at(-1).you.respawned,false);
assert.equal(messages.at(-1).you.lifeId,1000);
send({t:'lobby'});now=12000;send({t:'resume'});
assert.equal(p.alive,true,'an expired death uses the normal spawn reset exactly once');
assert.equal(p.hp,100);assert.equal(p.grenades,2);
assert.equal(messages.at(-1).you.respawned,true);
assert.equal(messages.at(-1).you.lifeId,12000);
assert.equal(p.immuneUntil,13500);
const freshLife=life();send({t:'lobby'});send({t:'resume'});
assert.equal(life(),freshLife,'repeated resume does not refresh the newly spawned life');
assert.equal(messages.at(-1).you.respawned,false);
console.log('PASS: pause preserves life/resources/projectiles, hides player, blocks input and cooldown exploit; dead resume respects its original deadline');
