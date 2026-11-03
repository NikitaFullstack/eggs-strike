import assert from 'node:assert/strict';
import { chromium } from '/Users/nikita/.nvm/versions/node/v24.14.0/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
const base=process.env.BASE||'http://127.0.0.1:3180';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/Users/nikita/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const failures=[];
async function test(name,fn){try{await fn();console.log('PASS:',name);}catch(e){failures.push(name+': '+e.message);console.error('FAIL:',name,e.message);}}
try {
 const contexts=await Promise.all([1,2].map(()=>browser.newContext({viewport:{width:1000,height:700}})));
 for(const c of contexts){c.setDefaultTimeout(12000);await c.route(/^https:\/\/(cdn.jsdelivr.net|esm.sh)\//,r=>r.abort());}
 const [host,guest]=await Promise.all(contexts.map(c=>c.newPage())),errors=[],received=[];
 for(const p of [host,guest])p.on('pageerror',e=>errors.push(e.message));
 host.on('websocket',s=>s.on('framereceived',f=>received.push(JSON.parse(f.payload))));
 await host.goto(base+'/?debug=1');await host.waitForFunction(()=>!!window.__egg);await host.fill('#name','Стрелок');await host.click('#btnPlay');await host.click('#btnCreate');await host.waitForSelector('#lobby:not(.hidden)');
 const code=await host.locator('#lobbyCode').textContent();
 await guest.goto(`${base}/?room=${code}&autojoin=1&debug=1`);await guest.waitForSelector('#lobby:not(.hidden)');await host.click('#btnStart');
 for(const p of [host,guest])await p.waitForSelector('#hud:not(.hidden)');
 await guest.keyboard.press('Shift');await guest.waitForFunction(()=>window.__egg.Sound.ctx.state==='running');
 await host.click('#btnResumeGame');await host.waitForFunction(()=>window.__egg.S.locked);
 async function place(page,pose){await page.evaluate(p=>Object.assign(window.__egg.S.me,{vy:0,onGround:true,pitch:0,yaw:0,...p}),pose);await page.waitForTimeout(220);}
 await test('Remote footsteps sound on the wooden balcony',async()=>{
  await place(host,{x:-4,y:0,z:6});await place(guest,{x:-8.1,y:1.8,z:1.8});
  const before=await host.evaluate(()=>window.__egg.getFootsteps());
  await guest.evaluate(()=>{window.__egg.S.locked=true;window.__egg.S.keys.KeyW=true;});
  try { await host.waitForFunction(n=>window.__egg.getFootsteps()>n,before,{timeout:7000}); } finally { await guest.evaluate(()=>window.__egg.S.keys.KeyW=false); }
  assert.ok(await host.evaluate(()=>window.__egg.getFootsteps())>before,'A moving enemy on the balcony produces steps');
  const audio=await host.evaluate(()=>window.__egg.getCombat().audio);
  assert.ok(audio.some(e=>e.name==='step-wood'&&e.pan<0),'Wooden steps reach the listener from the left');
 });
 await test('Each weapon has its own kick and returns to rest',async()=>{
  await place(host,{x:-4,y:0,z:6});const peaks={};
  for(const id of ['ak','m4','shot','awp','usp','deagle']){
   peaks[id]=await host.evaluate(id=>{const e=window.__egg;e.switchWeapon(id);e.S.me.lastShot=-10000;e.fire();return e.getCombat().kick;},id);
   await host.waitForTimeout(1250);
   // Observe the rendered pose after its next frame, not a state left before a GPU stall.
   await host.evaluate(()=>new Promise(requestAnimationFrame));
   const settled=await host.evaluate(()=>Math.abs(window.__egg.getCombat().kick));
   assert.ok(settled<.005,`Recoil returns to a stable pose: ${id}=${settled}`);
  }
  assert.ok(peaks.ak>peaks.m4&&peaks.deagle>peaks.usp&&peaks.awp>peaks.ak&&peaks.shot>peaks.ak);
 });
 await test('Mouse and keyboard fire one real shot',async()=>{
  await place(host,{x:0,y:0,z:3.4});await place(guest,{x:8.4,y:0,z:6});
  await host.keyboard.press('Digit1');
  const ammo=await host.evaluate(()=>window.__egg.S.me.ammo.ak),before=received.filter(m=>m.t==='shot').length;
  await host.mouse.click(500,350);
  await host.waitForFunction(n=>window.__egg.S.me.ammo.ak===n-1,ammo);
  await host.waitForTimeout(200);
  assert.ok(received.filter(m=>m.t==='shot').length>before,'Actual input receives a server shot result');
  assert.ok(!await host.locator('#hitmarker').evaluate(el=>el.dataset.kind==='hit'),'Shooting cover does not invent a damage confirmation');
 });
 await test('Immediate muzzle/case/smoke; confirmed material impacts for both players',async()=>{
  await place(guest,{x:8.4,y:0,z:6});await place(host,{x:0,y:0,z:3.4});
  const effect=await host.evaluate(()=>{const e=window.__egg;e.switchWeapon('ak');e.S.me.lastShot=-10000;e.fire();return e.getCombat();});
  assert.ok(effect.muzzle&&effect.cases>0&&effect.smoke>0,'Immediate local shot feedback');
  await host.waitForFunction(()=>window.__egg.getCombat().impacts.some(i=>i.material==='metal'));
  await guest.waitForFunction(()=>window.__egg.getCombat().impacts.some(i=>i.material==='metal'));
  assert.ok(received.some(m=>m.t==='shot'&&m.rays?.[0]?.material==='metal'));
  await host.screenshot({path:'/tmp/egg-gunfeel-metal.png'});
  await place(host,{x:-4,y:0,z:6});await place(guest,{x:-4,y:0,z:3.6});
  await host.evaluate(()=>{const e=window.__egg;e.S.me.pitch=-Math.atan2(.3,2.2);e.S.me.lastShot=-10000;});
  await host.waitForTimeout(300);
  await host.evaluate(()=>window.__egg.fire());
  await host.waitForFunction(()=>document.getElementById('hitmarker').dataset.kind==='hit');
  assert.ok(await host.evaluate(()=>window.__egg.getCombat().hitReaction)>0,'Confirmed hit animates the remote egg');
  await host.waitForTimeout(2100);
  await guest.evaluate(()=>{const e=window.__egg;e.S.me.ammo.ak=29;e.startReload();});
  await host.evaluate(()=>{const e=window.__egg;e.switchWeapon('awp');e.S.me.lastShot=-10000;e.fire();});
  await host.waitForFunction(()=>document.getElementById('hitmarker').dataset.kind==='kill');
  assert.ok(await host.evaluate(()=>window.__egg.getCombat().shells)>0,'Death emits shell fragments');
  await guest.waitForSelector('#death:not(.hidden)');
  const dead=await guest.evaluate(()=>window.__egg.getCombat());
  assert.equal(dead.pendingSounds,0,'Death cancels delayed reload audio');
  assert.equal(dead.particles+dead.cases+dead.tracers+dead.marks,0,'Death clears the victim combat effects');
 });
 await test('Different dirt/wood steps, finite effects and cleanup when switching/returning',async()=>{
  await place(host,{x:-4,y:0,z:6.3});await host.keyboard.down('KeyD');
  try { await host.waitForFunction(()=>window.__egg.getCombat().audio.some(e=>e.name==='step-dirt'),null,{timeout:7000}); }
  finally { await host.keyboard.up('KeyD'); }
  assert.ok(await host.evaluate(()=>window.__egg.getCombat().audio.some(e=>e.name==='step-dirt')));
  await host.evaluate(()=>{const e=window.__egg;e.switchWeapon('ak');for(let i=0;i<50;i++){e.S.me.ammo.ak=30;e.S.me.lastShot=-10000;e.fire();}});
  const burst=await host.evaluate(()=>window.__egg.getCombat());
  assert.ok(burst.particles<=60&&burst.cases<=20&&burst.marks<=36&&burst.tracers<=32,'Burst effects stay bounded');
  await host.waitForTimeout(2200);
  const idle=await host.evaluate(()=>window.__egg.getCombat());assert.equal(idle.particles,0);assert.equal(idle.cases,0);
  await host.evaluate(()=>{const e=window.__egg;e.switchWeapon('ak');e.S.me.ammo.ak=29;});
  await host.keyboard.press('KeyR');await host.keyboard.press('KeyR');
  assert.equal(await host.evaluate(()=>window.__egg.getCombat().pendingSounds),2,'Repeated R does not schedule duplicate reload sounds');
  await host.evaluate(()=>window.__egg.switchWeapon('usp'));
  const after=await host.evaluate(()=>window.__egg.getCombat().audio.length);await host.waitForTimeout(2500);
  const audio=await host.evaluate(n=>window.__egg.getCombat().audio.slice(n),after);
  assert.ok(!audio.some(e=>e.name==='reload-out'),'Switching cancels delayed reload sounds');
  await host.evaluate(()=>{const e=window.__egg;e.S.me.lastShot=-10000;e.fire();});
  await host.keyboard.press('Escape');await host.click('#btnPauseLobby');await host.waitForSelector('#lobby:not(.hidden)');
  const cleared=await host.evaluate(()=>window.__egg.getCombat());
  assert.equal(cleared.particles+cleared.cases+cleared.tracers+cleared.marks,0,'Returning clears all combat effects');assert.equal(cleared.pendingSounds,0);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);console.log('PASS: two real clients, six weapons, material audio, feedback, cleanup');
}finally{await browser.close();}
