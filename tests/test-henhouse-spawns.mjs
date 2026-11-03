import assert from 'node:assert/strict';
import fs from 'node:fs';
import WebSocket from 'ws';
const level=JSON.parse(fs.readFileSync(new URL('../public/henhouse_ffa_level.json',import.meta.url))),base=(process.env.BASE||'http://127.0.0.1:3190').replace(/^http/,'ws');
function client(){const ws=new WebSocket(base+'/ws'),messages=[];ws.on('message',r=>messages.push(JSON.parse(r)));return {ws,messages,send:m=>ws.send(JSON.stringify(m)),async wait(f){const end=Date.now()+5000;while(Date.now()<end){const i=messages.findIndex(f);if(i>=0)return messages.splice(i,1)[0];await new Promise(r=>setTimeout(r,15));}throw Error('Expected spawn state not received');}};}
const clients=[];
async function open(){const c=client();clients.push(c);await new Promise((r,j)=>{c.ws.once('open',r);c.ws.once('error',j);});return c;}
try{
 const host=await open();host.send({t:'create',name:'S1'});const joined=await host.wait(m=>m.t==='joined');assert.equal(joined.maxPlayers,4);
 const others=[];for(let i=0;i<2;i++){const c=await open();c.send({t:'join',code:joined.code,name:'S'+(i+2)});c.id=(await c.wait(m=>m.t==='joined')).id;others.push(c);}host.id=joined.id;
 host.send({t:'start'});const starts=await Promise.all([host,...others].map(c=>c.wait(m=>m.t==='start')));
 const initial=starts.map(m=>[m.you.x,m.you.y,m.you.z]);assert.equal(new Set(initial.map(JSON.stringify)).size,3);
 for(const m of starts){assert.ok(level.spawns.some(s=>JSON.stringify(s.position)===JSON.stringify([m.you.x,m.you.y,m.you.z])));assert.ok(Math.abs(m.you.yaw-Math.atan2(m.you.x,m.you.z))<1e-8);}
 const fourth=await open();fourth.send({t:'join',code:joined.code,name:'S4'});fourth.id=(await fourth.wait(m=>m.t==='joined')).id;const late=await fourth.wait(m=>m.t==='start');
 assert.ok(!initial.some(p=>JSON.stringify(p)===JSON.stringify([late.you.x,late.you.y,late.you.z])),'Late join uses the remaining free spawn');
 const fifth=await open();fifth.send({t:'join',code:joined.code,name:'Fifth'});assert.equal((await fifth.wait(m=>m.t==='error')).msg,'Комната заполнена');
 const victim=others[0];
 async function lane(){host.send({t:'input',x:-4,y:0,z:6,yaw:0,pitch:0});victim.send({t:'input',x:-4,y:0,z:3.6,yaw:0,pitch:0});await host.wait(m=>m.t==='s'&&m.p.some(p=>p.i===victim.id&&p.z===3.6));host.messages.length=0;}
 await lane();host.send({t:'shoot',w:'usp',dx:0,dy:0,dz:-1});await host.wait(m=>m.t==='shot');
 const protectedState=await host.wait(m=>m.t==='s');assert.equal(protectedState.p.find(p=>p.i===victim.id).hp,100,'Initial 1.5 second immunity prevents damage');assert.equal(protectedState.p.find(p=>p.i===victim.id).im,1);
 await new Promise(r=>setTimeout(r,2100));host.send({t:'shoot',w:'awp',dx:0,dy:0,dz:-1});await host.wait(m=>m.t==='kill'&&m.victim===victim.id);
 for(const [c,s] of [[host,level.spawns[0]],[others[1],level.spawns[1]],[fourth,level.spawns[3]]])c.send({t:'input',x:s.position[0],y:0,z:s.position[2],yaw:0,pitch:0});
 const respawn=await victim.wait(m=>m.t==='respawn');assert.deepEqual([respawn.you.x,respawn.you.y,respawn.you.z],level.spawns[2].position,'Respawn selects the unoccupied safe spawn');
 await lane();host.send({t:'shoot',w:'usp',dx:0,dy:0,dz:-1});await host.wait(m=>m.t==='shot');const state=await host.wait(m=>m.t==='s');assert.equal(state.p.find(p=>p.i===victim.id).hp,100,'Respawn grants immunity again');
 console.log('PASS: three unique ground spawns; fourth joins a free spawn; fifth rejected; initial/respawn immunity; free safe respawn');
}finally{for(const c of clients)c.ws.close();}
