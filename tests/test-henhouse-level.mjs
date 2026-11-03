import assert from 'node:assert/strict';
import fs from 'node:fs';
import WebSocket from 'ws';
import G from '../public/arena-geometry.js';
const level=JSON.parse(fs.readFileSync(new URL('../public/henhouse_ffa_level.json',import.meta.url)));
const base=(process.env.BASE||'http://127.0.0.1:3190').replace(/^http/,'ws');
const ws=new WebSocket(base+'/ws');const queue=[];ws.on('message',raw=>queue.push(JSON.parse(raw)));
const wait=async f=>{const end=Date.now()+4000;while(Date.now()<end){const i=queue.findIndex(f);if(i>=0)return queue.splice(i,1)[0];await new Promise(r=>setTimeout(r,15));}throw Error('Expected room response not received');};
try {
 await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});ws.send(JSON.stringify({t:'create',name:'Geometry'}));
 const joined=await wait(m=>m.t==='joined'),map=joined.arena;
 assert.equal(map.id,level.mapId,'Runtime map is loaded from the supplied JSON');
 assert.equal(joined.maxPlayers,4);assert.deepEqual(map.playerCollision,level.playerCollision);
 const boxes=G.boxes(map);
 for(const b of [...level.obstacles.filter(b=>b.type==='box'),...level.supports]){
  const actual=boxes.find(x=>x.id===b.id);assert.ok(actual,`Solid ${b.id} exists`);
  assert.deepEqual([actual.x,actual.y,actual.z],[...b.position]);assert.deepEqual([actual.w,actual.h,actual.d],b.size);
 }
 assert.equal(map.platforms.length,2);assert.equal(map.ramps.length,4);assert.equal(map.spawns.length,4);
 const feeder=map.rounds.find(r=>r.id==='C0');assert.deepEqual([feeder.x,feeder.y,feeder.z],[0,0,0]);
 assert.deepEqual([feeder.parts[0].bottom,feeder.parts[0].h],[1.55,2.2]);
 for(const p of level.elevatedPlatforms){
  const deck=boxes.find(b=>b.id===p.id);assert.deepEqual([deck.x,deck.y,deck.z,deck.w,deck.h,deck.d],[p.position[0],1.6,p.position[2],2.2,.2,5.6]);
  assert.equal(G.groundHeight(map,p.position[0],0,.23),0);
  assert.equal(G.ceilingHeight(map,p.position[0],0,1.15),1.6);
  assert.equal(G.blocks(map,p.position[0],0,0),false,'1.6 m underpass fits JSON capsule');
  assert.equal(G.blocks(map,p.position[0],0,.5),true,'The underside blocks a capsule that is too high');
 }
 for(const r of level.ramps){
  const ramp=map.ramps.find(p=>p.id===r.id);assert.ok(ramp);
  for(let i=0;i<=16;i++){
   const t=i/16,z=r.startZ+(r.endZ-r.startZ)*t,expected=r.startY+(r.endY-r.startY)*t;
   assert.ok(Math.abs(ramp.h0+(ramp.h1-ramp.h0)*G.rampT(ramp,r.centerX,z)-expected)<1e-9,'Continuous slope matches JSON');
  }
 }
 for(const spawn of map.spawns)assert.equal(G.blocks(map,spawn.x,spawn.z,spawn.y),false);
 for(let i=0;i<map.spawns.length;i++)for(let j=i+1;j<map.spawns.length;j++){
  const a=map.spawns[i],b=map.spawns[j];assert.equal(G.visible(map,{x:a.x,y:.98,z:a.z},{x:b.x,y:.98,z:b.z}),false,'All six spawn pairs are occluded');
 }
 // Independently explore the actual walkable ground with a 0.2 m grid, including routes around obstacles.
 const step=.2,minX=-9.4,minZ=-7.4,w=95,d=75,open=new Set(),key=(i,j)=>i+','+j;
 const first=map.spawns[0],start=[Math.round((first.x-minX)/step),Math.round((first.z-minZ)/step)];
 const queueGrid=[start];open.add(key(...start));
 for(let q=0;q<queueGrid.length;q++){
  const [i,j]=queueGrid[q];for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const ni=i+dx,nj=j+dz;if(ni<0||nj<0||ni>=w||nj>=d||open.has(key(ni,nj)))continue;
   const x=minX+ni*step,z=minZ+nj*step;
   if(G.blocks(map,x,z,0)||G.groundHeight(map,x,z,.23)>.23)continue;
   open.add(key(ni,nj));queueGrid.push([ni,nj]);
  }
 }
 const goals=[...level.spawns.map(s=>[s.position[0],s.position[2]]),...level.ramps.map(r=>[r.centerX,(r.startY===0?r.startZ-.2:r.endZ+.2)]),[0,2.2]];
 for(const [x,z] of goals)assert.ok(open.has(key(Math.round((x-minX)/step),Math.round((z-minZ)/step))),`Reachable route to ${x},${z}`);
 assert.equal(G.blocks(map,9.6,0,0),true,'Boundary walls stop the capsule');
 console.log('PASS: exact JSON solids; two 1.8 m decks; four slopes; 1.6 m underpasses; six occluded spawn pairs; all ground routes');
}finally{ws.close();}
