import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:3170';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || chromium.executablePath(), headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
try {
  const errors=[];
  const hostContext=await browser.newContext({viewport:{width:1280,height:800}});
  const guestContext=await browser.newContext({viewport:{width:960,height:640}});
  for (const context of [hostContext,guestContext]) {
    context.setDefaultTimeout(15000);
    await context.route(/^https:\/\/(cdn.jsdelivr.net|esm.sh)\//,route=>route.abort());
  }
  const host=await hostContext.newPage(),guest=await guestContext.newPage();
  for (const page of [host,guest]) page.on('pageerror',e=>errors.push(e.message));
  await host.goto(base+'/?debug=1'); await host.waitForFunction(()=>!!window.__egg);
  assert.equal(await host.locator('#menuMaps [data-map]').count(),4,'All four arenas are available');
  assert.deepEqual(await host.locator('#menuMaps .map-card-copy strong').allTextContents(),['Курятник','Полигон','Холодильник','Кухня']);
  await host.fill('#name','Хост'); await host.click('#btnPlay'); await host.click('#btnCreate');
  await host.waitForSelector('#lobby:not(.hidden)');
  assert.equal(await host.locator('#roomMaps [data-map]').count(),4);
  const code=await host.locator('#lobbyCode').textContent();
  await guest.goto(`${base}/?room=${code}&autojoin=1&debug=1`);
  await guest.waitForSelector('#lobby:not(.hidden)');
  await host.click('#btnStart');
  for (const page of [host,guest]) {
    await page.waitForSelector('#hud:not(.hidden)');
    assert.deepEqual(await page.evaluate(()=>({id:window.__egg.S.arena.id,x:window.__egg.S.arena.halfX,z:window.__egg.S.arena.halfZ})),{id:'henhouse_ffa_01',x:10,z:8});
    assert.equal(await page.locator('#mapName').textContent(),'Курятник');
  }
  await host.click('#btnResumeGame'); await host.waitForFunction(()=>window.__egg.S.locked);
  await host.evaluate(()=>Object.assign(window.__egg.S.me,{x:-4,z:5.8,y:0,vy:0,yaw:0,pitch:.14,onGround:true}));
  await guest.evaluate(()=>Object.assign(window.__egg.S.me,{x:8.1,z:0,y:1.8,vy:0,yaw:Math.PI,pitch:0,onGround:true}));
  await host.waitForTimeout(400);
  await host.screenshot({path:'/tmp/egg-coop-courtyard.png'});
  // Walk up the left ramp onto the north balcony.
  await host.evaluate(()=>Object.assign(window.__egg.S.me,{x:-8.1,z:-6.15,y:0,vy:0,yaw:Math.PI,pitch:0,onGround:true}));
  await host.keyboard.down('KeyW');
  try { await host.waitForFunction(()=>window.__egg.S.me.z > -2.65 && window.__egg.S.me.y > 1.79,null,{timeout:7000}); }
  finally { await host.keyboard.up('KeyW'); }
  assert.ok(await host.evaluate(()=>Math.abs(window.__egg.S.me.y-1.8)<.05),'Balcony reached by walking up its ramp');
  await host.screenshot({path:'/tmp/egg-coop-balcony.png'});
  // The ground route underneath the west gallery must stay open.
  await host.evaluate(()=>Object.assign(window.__egg.S.me,{x:-8.1,z:1.8,y:0,vy:0,yaw:0,pitch:0,onGround:true}));
  await host.keyboard.down('KeyW');
  try { await host.waitForFunction(()=>window.__egg.S.me.z < .6,null,{timeout:5000}); }
  finally { await host.keyboard.up('KeyW'); }
  assert.equal(await host.evaluate(()=>window.__egg.S.me.y),0,'Walking below the deck does not teleport onto it');
  await host.keyboard.press('Space');
  const peak=await host.evaluate(async()=>{
    let peak=0;
    const end=performance.now()+800;
    while(performance.now()<end){peak=Math.max(peak,window.__egg.S.me.y);await new Promise(requestAnimationFrame);}
    return peak;
  });
  assert.ok(peak>.2 && peak<=.451,`The deck underside blocks a jump, got ${peak}`);
  await host.waitForFunction(()=>window.__egg.S.me.onGround);
  await host.screenshot({path:'/tmp/egg-coop-underpass.png'});
  // Central feeder is an actual opaque, solid landmark.
  await host.evaluate(()=>Object.assign(window.__egg.S.me,{x:0,z:3.4,y:0,vy:0,yaw:0,pitch:0,onGround:true}));
  await host.keyboard.down('KeyW'); await host.waitForTimeout(900); await host.keyboard.up('KeyW');
  const stopped=await host.evaluate(()=>window.__egg.S.me.z);
  assert.ok(stopped>1.88 && stopped<3.1,'Feeder stops the player without allowing camera clipping');
  await host.keyboard.press('Escape'); await host.click('#btnPauseLobby');
  await host.waitForSelector('#lobby:not(.hidden)');
  await host.screenshot({path:'/tmp/egg-coop-lobby.png'});
  await host.setViewportSize({width:390,height:844});
  for (const button of await host.locator('#roomMaps [data-map]').all()) {
    const card=await button.boundingBox();
    assert.ok(card && card.x>=0 && card.x+card.width<=390 && card.y+card.height<=844,'Each map card fits the mobile lobby');
  }
  await host.screenshot({path:'/tmp/egg-coop-lobby-mobile.png'});
  await host.click('#btnLeave'); await host.waitForSelector('#menu:not(.hidden)');
  assert.deepEqual(errors,[]);
  console.log('PASS: henhouse with four map options; two players; 20×16 bounds; climb; ground underpass; ceiling; solid feeder; exit');
} finally { await browser.close(); }
