import assert from 'node:assert/strict';
import fs from 'node:fs';
import WebSocket from 'ws';
import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import Grenades from '../public/grenade-physics.js';
import Geometry from '../public/arena-geometry.js';
import Level from '../public/henhouse-level.js';
import MeshWorld from '../public/mesh-world.js';

const read = path => JSON.parse(fs.readFileSync(new URL(path,import.meta.url)));
const henhouse = Level.build(read('../public/henhouse_ffa_level.json'));
const training = read('../public/maps/training/map.json');
Geometry.registerMesh(training.id,MeshWorld.collision(THREE,Octree,Capsule,read('../public/maps/training/scene.json'),training));
const empty = {...henhouse,id:'grenade-fixture',crates:[],walls:[],ramps:[],rounds:[],stairs:[],platforms:[]};
const wall = {...empty,id:'grenade-wall',crates:[{x:0,y:0,z:0,w:.1,h:3,d:8}]};
const origin = {x:-2,y:1,z:0};
const fast = Grenades.create(wall,origin,{x:1,y:0,z:0},1,1,0);
fast.vx = 200; fast.vy = 0;
Grenades.advance(fast,wall,.05);
assert.ok(fast.x < -.05-Grenades.CONFIG.size,'Swept flight cannot tunnel through a 10 cm wall');
assert.ok(fast.vx < 0,'Wall contact reflects velocity');
const corner = {...wall,id:'grenade-corner',crates:[...wall.crates,{x:0,y:0,z:0,w:8,h:3,d:.1}]};
const cornerBall=Grenades.create(corner,{x:-.39,y:1,z:-.39},{x:Math.SQRT1_2,y:0,z:Math.SQRT1_2},4,1,0);
for(let i=0;i<12;i++) {
  assert.ok(cornerBall.x<-.05-Grenades.CONFIG.size && cornerBall.z<-.05-Grenades.CONFIG.size,'Throwing against a wall junction starts and stays on the near side');
  Grenades.advance(cornerBall,corner,1/120);
}
const bornMidTick=Grenades.create(empty,{x:-4,y:1,z:6},{x:1,y:0,z:0},5,1,1040),initialX=bornMidTick.x;
Grenades.advanceTo(bornMidTick,empty,1050);
assert.ok(Math.abs(bornMidTick.x-initialX-.12)<1e-9,'A throw ten milliseconds before a tick only flies for ten milliseconds');
const lateTick=Grenades.create(empty,{x:-4,y:1,z:6},{x:0,y:1,z:0},6,1,1000),onTime=structuredClone(lateTick);
Grenades.advance(onTime,empty,Grenades.CONFIG.fuse);
Grenades.advanceTo(lateTick,empty,5000);
for(const field of ['x','y','z','vx','vy','vz'])assert.equal(lateTick[field],onTime[field],'A delayed tick simulates all flight exactly up to the fuse');
const expired=structuredClone(lateTick);Grenades.advanceTo(lateTick,empty,6000);
assert.deepEqual(lateTick,expired,'Expired grenades cannot continue flying');
const floor = Grenades.create(empty,{x:-4,y:1,z:6},{x:0,y:-1,z:0},2,1,0);
for (let step=0;step<300;step++) Grenades.advance(floor,empty,1/120);
assert.ok(floor.y >= Grenades.CONFIG.size && floor.y < Grenades.CONFIG.size+.02,'A resting grenade stays on the floor');
const at = {x:-2,y:.15,z:0};
assert.ok(Grenades.damage(empty,at,{x:-1.8,y:0,z:0}) > Grenades.damage(empty,at,{x:1,y:0,z:0}),'Blast damage decreases with distance');
assert.equal(Grenades.damage(empty,at,{x:4,y:0,z:0}),0,'No damage beyond the blast radius');
assert.equal(Grenades.damage(wall,at,{x:1,y:0,z:0}),0,'A solid wall shields the whole body');
const meshBall = Grenades.create(training,{x:-20,y:3.2,z:-13},{x:0,y:0,z:-1},3,1,0);
for (let step=0;step<40;step++) {
  Grenades.advance(meshBall,training,1/120);
  assert.ok(meshBall.z > -14.8451+Grenades.CONFIG.size-.02,'The imported mesh wall blocks flight');
}
assert.ok(meshBall.vz > 0,'The imported mesh reflects a grenade');
const closeMesh=Grenades.create(training,{x:-20,y:3.2,z:-14.5},{x:0,y:0,z:-1},7,1,0);
assert.ok(closeMesh.z>-14.8451+Grenades.CONFIG.size-.02,'A throw next to a mesh wall cannot start through it');
assert.equal(Grenades.damage(training,{x:-20,y:3,z:-14},{x:-20,y:2.318366,z:-16}),0,'Imported mesh cover blocks the blast');
console.log('PASS: swept thin-wall and imported-mesh collision; floor rest; blast falloff, range and cover');
console.log('PASS: wall-adjacent and corner throws; per-projectile clock; delayed ticks stop exactly at the fuse');

const base = (process.env.BASE || 'http://127.0.0.1:3196').replace(/^http/,'ws');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const clients = [];
async function open(name,code,mapId) {
  const ws = new WebSocket(base+'/ws');
  const messages = [];
  const client = {ws,messages,send:message=>ws.send(JSON.stringify(message)),async wait(predicate,label='message',timeout=5000) {
    const until=Date.now()+timeout;
    while(Date.now()<until) {
      const index=messages.findIndex(predicate);
      if(index>=0)return messages.splice(index,1)[0];
      await sleep(10);
    }
    throw Error('Timed out waiting for '+label);
  }};
  ws.on('message',raw=>messages.push(JSON.parse(raw)));
  clients.push(client);
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  client.send({t:code?'join':'create',name,code,mapId});
  const joined=await client.wait(m=>m.t==='joined','joined');
  client.id=joined.id; client.code=joined.code;
  return client;
}
async function position(client,x,z,y=0) {
  client.messages.length=0;
  client.send({t:'input',x,y,z,yaw:0,pitch:0});
  await client.wait(m=>m.t==='s'&&m.p.some(p=>p.i===client.id&&Math.abs(p.x-x)<.02&&Math.abs(p.z-z)<.02),'position');
}
async function start(host,peers=[]) {
  for(const client of [host,...peers])client.messages.length=0;
  host.send({t:'start'});
  for(const client of [host,...peers]) {
    const begun=await client.wait(m=>m.t==='start','start');
    assert.equal(begun.you.grenades,2,'Each new life starts with two grenades');
  }
}
const toss = client => client.send({t:'grenade',dx:0,dy:-1,dz:0});
try {
  const host=await open('Grenadier'),guest=await open('Observer',host.code);
  await start(host,[guest]);
  await position(host,-4,6);
  for(const direction of [{dx:0,dy:0,dz:0},{dx:'1',dy:0,dz:0},{dx:null,dy:0,dz:0},{dx:Number.MAX_VALUE,dy:Number.MAX_VALUE,dz:Number.MAX_VALUE}])host.send({t:'grenade',...direction});
  await sleep(80);
  assert.equal(host.messages.filter(m=>m.t==='grenade').length,0,'Invalid directions cannot consume inventory or create a projectile');
  toss(host);
  const first=await host.wait(m=>m.t==='grenade','first throw');
  assert.equal(first.owner,host.id);assert.equal(first.remaining,1);assert.equal(first.fuse,2.5);
  assert.equal((await guest.wait(m=>m.t==='grenade'&&m.id===first.id,'replicated throw')).id,first.id);
  toss(host);toss(host);
  await sleep(120);
  assert.equal(host.messages.filter(m=>m.t==='grenade').length,0,'Repeated input respects the server cooldown');
  const newcomer=await open('Late observer',host.code);
  await newcomer.wait(m=>m.t==='start','late start');
  const inFlight=await newcomer.wait(m=>m.t==='s'&&m.g.some(g=>g.id===first.id),'late join projectile');
  assert.equal(inFlight.p.find(p=>p.i===host.id).grenades,1);
  await position(host,4,6);
  await sleep(650);
  toss(host);const second=await host.wait(m=>m.t==='grenade'&&m.id!==first.id,'second throw');
  assert.equal(second.remaining,0);
  await position(host,4,-6);
  await sleep(650);toss(host);await sleep(100);
  assert.equal(host.messages.filter(m=>m.t==='grenade').length,0,'An empty inventory cannot throw');
  const explosion=await host.wait(m=>m.t==='explosion'&&m.id===first.id,'fuse explosion');
  assert.equal(explosion.radius,5);
  await guest.wait(m=>m.t==='explosion'&&m.id===second.id,'second explosion');
  await host.wait(m=>m.t==='s'&&m.g.length===0,'all projectiles removed');

  // Restarting the round cancels in-flight projectiles and restores the inventory.
  await start(host,[guest,newcomer]);await position(host,-4,6);toss(host);
  const abandoned=await host.wait(m=>m.t==='grenade','cancelled throw');
  await start(host,[guest,newcomer]);
  assert.equal((await host.wait(m=>m.t==='s','new round state')).g.length,0);
  await sleep(2600);
  assert.ok(!host.messages.some(m=>m.t==='explosion'&&m.id===abandoned.id),'An old round never explodes in a new round');

  // A grenade at the thrower’s feet can kill them; suicides do not award a frag.
  await position(host,-4,6);await position(guest,4,-6);await position(newcomer,4,6);
  toss(host);const self=await host.wait(m=>m.t==='grenade','self throw');
  const selfKill=await host.wait(m=>m.t==='kill'&&m.victim===host.id,'self damage');
  assert.equal(selfKill.w,'grenade');assert.equal(selfKill.killer,host.id);
  const dead=await host.wait(m=>m.t==='s'&&m.p.some(p=>p.i===host.id&&!p.a),'death snapshot');
  assert.equal(dead.p.find(p=>p.i===host.id).k,0);assert.equal(dead.p.find(p=>p.i===host.id).d,1);
  assert.ok(!dead.g.some(g=>g.id===self.id));
  const respawn=await host.wait(m=>m.t==='respawn','respawn');assert.equal(respawn.you.grenades,2);

  // Victim damage, attribution and immunity use authoritative room state.
  await start(host,[guest,newcomer]);
  await position(host,-4,6);await position(guest,-4.4,6);await position(newcomer,4,-6);
  await sleep(1550);toss(host);await host.wait(m=>m.t==='grenade','damage throw');
  await position(host,4,6);
  // The late respawn's protection overlaps the detonation, while the exposed player has none.
  await sleep(1400);
  newcomer.send({t:'lobby'});await newcomer.wait(m=>m.t==='players','lobby');
  newcomer.send({t:'resume'});const protectedStart=await newcomer.wait(m=>m.t==='start','protected resume');
  assert.equal(protectedStart.you.grenades,2);await position(newcomer,-4,6);
  await host.wait(m=>m.t==='kill'&&m.victim===guest.id&&m.killer===host.id&&m.w==='grenade','enemy grenade kill');
  const protectedState=await host.wait(m=>m.t==='s'&&m.p.some(p=>p.i===guest.id&&!p.a),'blast snapshot');
  assert.equal(protectedState.p.find(p=>p.i===newcomer.id).hp,100,'Spawn immunity blocks blast damage');
  assert.equal(protectedState.p.find(p=>p.i===host.id).k,1,'A grenade kill awards one frag');

  // Leaving combat cancels the owner's remaining grenades and blocks further throws.
  toss(host);const leaving=await host.wait(m=>m.t==='grenade','throw before lobby');
  host.send({t:'lobby'});toss(host);
  const lobby=await guest.wait(m=>m.t==='s'&&m.p.some(p=>p.i===host.id&&!p.a),'lobby snapshot');
  assert.ok(!lobby.g.some(g=>g.id===leaving.id),'Returning to the lobby cleans up owned projectiles');
  await sleep(100);assert.ok(!host.messages.some(m=>m.t==='grenade'&&m.id!==leaving.id),'A player in the lobby cannot throw');

  const meshHost=await open('Mesh grenadier',null,'training_grounds'),meshGuest=await open('Mesh observer',meshHost.code);
  await start(meshHost,[meshGuest]);await position(meshHost,-20,-13,2.318366);
  meshHost.send({t:'grenade',dx:0,dy:0,dz:-1});
  const meshThrow=await meshHost.wait(m=>m.t==='grenade','mesh throw');
  const meshFlight=await meshGuest.wait(m=>m.t==='s'&&m.g.some(g=>g.id===meshThrow.id&&g.fuse<2.2),'mesh bounce snapshot');
  assert.ok(meshFlight.g.find(g=>g.id===meshThrow.id).z > -14.8451+Grenades.CONFIG.size-.02,'Server flight respects the imported wall');
  await meshGuest.wait(m=>m.t==='explosion'&&m.id===meshThrow.id,'mesh explosion');
  await meshGuest.wait(m=>m.t==='s'&&m.g.length===0,'mesh cleanup');
  toss(meshHost);const disconnected=await meshHost.wait(m=>m.t==='grenade','throw before disconnect');
  meshHost.ws.close();
  const afterDisconnect=await meshGuest.wait(m=>m.t==='s'&&!m.p.some(p=>p.i===meshHost.id),'disconnect cleanup');
  assert.ok(!afterDisconnect.g.some(g=>g.id===disconnected.id),'Disconnecting removes owned projectiles');
  console.log('PASS: authoritative inventory/cooldown; invalid input; replication and late join; fuse; round/lobby cleanup; self and enemy kills; immunity; respawn refill');
  console.log('PASS: imported-map server flight and explosion; owner disconnect cleanup');
} finally { for(const client of clients)client.ws.close(); }
