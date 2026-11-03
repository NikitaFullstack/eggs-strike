import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base=(process.env.BASE||'http://127.0.0.1:3180').replace(/^http/,'ws');
function client(){const ws=new WebSocket(base+'/ws'),messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));return {ws,messages,send:m=>ws.send(JSON.stringify(m)),async wait(f){const end=Date.now()+3500;while(Date.now()<end){const i=messages.findIndex(f);if(i>=0)return messages.splice(i,1)[0];await new Promise(r=>setTimeout(r,15));}throw Error('Expected authoritative shot result was not received');}};}
const host=client(),guest=client();
try {
 await Promise.all([host,guest].map(c=>new Promise((r,j)=>{c.ws.once('open',r);c.ws.once('error',j);})));
 host.send({t:'create',name:'Shot host'});const joined=await host.wait(m=>m.t==='joined');
 guest.send({t:'join',code:joined.code,name:'Shot target'});const other=await guest.wait(m=>m.t==='joined');
 host.send({t:'start'});await guest.wait(m=>m.t==='start');await new Promise(r=>setTimeout(r,1600));
 async function shot(from,to,dir,w='usp'){
  host.send({t:'input',...from,yaw:0,pitch:0});guest.send({t:'input',...to,yaw:0,pitch:0});
  await host.wait(m=>m.t==='s'&&m.p.some(p=>p.i===joined.id&&p.x===from.x&&p.z===from.z));
  host.messages.length=guest.messages.length=0;
  if(w==='shot')await new Promise(r=>setTimeout(r,1250));
  host.send({t:'shoot',w,...dir});
  const result=await host.wait(m=>m.t==='shot'&&m.i===joined.id);
  const remote=await guest.wait(m=>m.t==='shot'&&m.i===joined.id);
  assert.deepEqual(remote.rays,result.rays,'Both players receive identical authoritative endpoints');
  assert.ok(result.origin&&result.rays?.length,'The shooter receives resolved endpoints, not just a sound event');
  await new Promise(r=>setTimeout(r,w==='shot'?1250:300));return result;
 }
 const metal=await shot({x:0,y:0,z:3.4},{x:0,y:0,z:-3.4},{dx:0,dy:0,dz:-1});
 assert.equal(metal.rays[0].material,'metal');assert.ok(Math.abs(metal.rays[0].point.z-1.55)<.02);assert.equal(metal.rays[0].target,null);
 const wood=await shot({x:3.3,y:0,z:.8},{x:7,y:0,z:6},{dx:0,dy:0,dz:-1});
 assert.equal(wood.rays[0].material,'wood');assert.ok(Math.abs(wood.rays[0].point.z+1.6)<.02);
 const dirt=await shot({x:0,y:0,z:5},{x:7,y:0,z:6},{dx:0,dy:-1,dz:0});
 assert.equal(dirt.rays[0].material,'dirt');assert.equal(dirt.rays[0].point.y,0);
 const hit=await shot({x:-4,y:0,z:6},{x:-4,y:0,z:3.6},{dx:0,dy:-.3,dz:-2.4});
 assert.equal(hit.rays[0].target,other.id);assert.equal(hit.rays[0].material,'egg');
 const pellets=await shot({x:-4,y:0,z:6},{x:8,y:0,z:6},{dx:0,dy:-.4,dz:-1},'shot');
 assert.equal(pellets.rays.length,9,'All nine server-calculated pellets are rendered');
 assert.ok(new Set(pellets.rays.map(p=>JSON.stringify(p.point))).size>1,'Pellets have real spread');
 assert.ok(pellets.rays.every(r=>Object.values(r.point).every(Number.isFinite)));
 host.send({t:'shoot',w:'ak',dx:null,dy:null,dz:null});await new Promise(r=>setTimeout(r,150));
 assert.equal(host.messages.filter(m=>m.t==='shot').length,0,'Invalid shot has no effects');
 console.log('PASS: server endpoints for metal/wood/dirt/egg; identical nine pellets; invalid input rejected');
}finally{host.ws.close();guest.ws.close();}
