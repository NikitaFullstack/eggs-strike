import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
const level=JSON.parse(fs.readFileSync(new URL('../public/henhouse_ffa_level.json',import.meta.url))),base=process.env.BASE||'http://127.0.0.1:3190';
const mode=process.env.MODE||'blockout';
const browser=await chromium.launch({executablePath: process.env.CHROMIUM || chromium.executablePath(),headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try {
 const context=await browser.newContext({viewport:{width:1100,height:750}});context.setDefaultTimeout(15000);await context.route(/^https:\/\/(cdn.jsdelivr.net|esm.sh)\//,r=>r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/?debug=1&mapdebug=1${mode==='blockout'?'&blockout=1':''}`);await page.waitForFunction(()=>!!window.__egg);
 await page.fill('#name','Маршрут');await page.click('#btnPlay');await page.click('#btnCreate');await page.waitForSelector('#lobby:not(.hidden)');await page.click('#btnStart');await page.waitForSelector('#hud:not(.hidden)');
 assert.equal(await page.evaluate(()=>window.__egg.S.arena.id),level.mapId);
 const view=await page.evaluate(()=>window.__egg.getLevelView());assert.equal(view.mode,mode);assert.ok(view.debug.grid&&view.debug.spawns===4&&view.debug.labels>=25&&view.debug.underpasses===2);
 for(const p of level.elevatedPlatforms){const b=view.solids.find(b=>b.id===p.id);assert.deepEqual(b.min,[p.position[0]-1.1,1.6,-2.8]);assert.deepEqual(b.max,[p.position[0]+1.1,1.8,2.8]);}
 await page.click('#btnResumeGame');await page.waitForFunction(()=>window.__egg.S.locked);
 async function place(p){await page.evaluate(p=>Object.assign(window.__egg.S.me,{x:0,y:0,z:0,pitch:0,yaw:0,vy:0,onGround:true,...p}),p);await page.waitForTimeout(100);}
 for(const r of level.ramps){
  const fromNorth=r.startY===0,z=fromNorth?r.startZ-.15:r.endZ+.15,yaw=fromNorth?Math.PI:0;
  await place({x:r.centerX,z,yaw});
  await page.evaluate(()=>{window.__egg.heightSamples=[];window.__egg.watch=()=>{if(!window.__egg.heightSamples)return;window.__egg.heightSamples.push(window.__egg.S.me.y);requestAnimationFrame(window.__egg.watch);};requestAnimationFrame(window.__egg.watch);});
  await page.keyboard.down('KeyW');
  try{await page.waitForFunction(({north})=>window.__egg.S.me.y>1.79&&(north?window.__egg.S.me.z>-2.65:window.__egg.S.me.z<2.65),{north:fromNorth},{timeout:9000});}
  finally{await page.keyboard.up('KeyW');}
  const samples=await page.evaluate(()=>{const a=window.__egg.heightSamples;window.__egg.heightSamples=null;return a;});
  assert.ok(samples.some(y=>y>.3&&y<1.5),`${r.id}: climb is continuous`);
  assert.ok(Math.abs(await page.evaluate(()=>window.__egg.S.me.y)-1.8)<.01);
 }
 await place({x:-8.1,z:0,y:1.8,yaw:-Math.PI/2});await page.keyboard.press('Space');await page.keyboard.down('KeyW');
 try{await page.waitForFunction(()=>window.__egg.S.me.x>-6.4,null,{timeout:7000});}finally{await page.keyboard.up('KeyW');}
 await page.waitForFunction(()=>window.__egg.S.me.onGround);assert.equal(await page.evaluate(()=>window.__egg.S.me.y),0,'Player can jump over the side rail from the walkway');
 await place({x:-8.1,z:-1.8,y:0,yaw:Math.PI});await page.keyboard.down('KeyW');
 try{await page.waitForFunction(()=>window.__egg.S.me.z>1.5,null,{timeout:7000});}finally{await page.keyboard.up('KeyW');}
 assert.equal(await page.evaluate(()=>window.__egg.S.me.y),0,'Pass underneath without snapping to the deck');
 await page.keyboard.press('Space');const peak=await page.evaluate(async()=>{let peak=0;const end=performance.now()+700;while(performance.now()<end){peak=Math.max(peak,window.__egg.S.me.y);await new Promise(requestAnimationFrame);}return peak;});
 assert.ok(peak>.15&&peak<=.451,`Ceiling stops the 1.15 m body: ${peak}`);
 await place({x:0,z:3.6});await page.keyboard.down('KeyW');await page.waitForTimeout(900);await page.keyboard.up('KeyW');
 assert.ok(await page.evaluate(()=>window.__egg.S.me.z)>=1.88,'Solid 1.55 m feeder stops the .34 m radius body');
 await place({x:4.7,z:6.5,yaw:-Math.PI/2});await page.keyboard.down('KeyW');await page.waitForTimeout(1600);await page.keyboard.up('KeyW');
 assert.ok(await page.evaluate(()=>window.__egg.S.me.x)<=9.361,'Perimeter is closed');
 await page.keyboard.press('F2');assert.equal(await page.evaluate(()=>window.__egg.getLevelView().debug.visible),false);
 await place({x:-8.1,y:1.8,z:0,yaw:-Math.PI/2,pitch:-.12});await page.waitForTimeout(200);await page.screenshot({path:`/tmp/henhouse-${mode}.png`});
 await page.keyboard.press('Escape');await page.click('#btnPauseLobby');await page.waitForSelector('#lobby:not(.hidden)');await page.click('#btnLeave');await page.waitForSelector('#menu:not(.hidden)');
 assert.deepEqual(errors,[]);console.log(`PASS: ${mode}; exact rendered deck bounds; four ramp walks; underpass; ceiling; feeder; walls; debug; exit`);
}finally{await browser.close();}
