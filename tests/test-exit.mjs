import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:3140';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(),
  headless: true, args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'],
});
let guest;
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  context.setDefaultTimeout(15000);
  await context.route(/^https:\/\/(cdn.jsdelivr.net|esm.sh)\//, route => route.abort());
  const page = await context.newPage(), errors = [], sent = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('websocket', socket => socket.on('framesent', frame => sent.push(JSON.parse(frame.payload))));
  await page.goto(base + '/?debug=1');
  await page.waitForFunction(() => !!window.__egg);
  await page.fill('#name', 'Выход');
  await page.click('#btnPlay'); await page.click('#btnCreate');
  await page.waitForSelector('#lobby:not(.hidden)');
  const code = await page.locator('#lobbyCode').textContent();
  const hostId = await page.evaluate(() => window.__egg.S.id);
  guest = new WebSocket(base.replace(/^http/,'ws') + '/ws');
  const messages = [];
  guest.on('message', raw => messages.push(JSON.parse(raw)));
  const wait = async predicate => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index,1)[0];
      await new Promise(resolve => setTimeout(resolve,20));
    }
    throw new Error('Expected server state was not received');
  };
  await new Promise((resolve,reject) => { guest.once('open',resolve); guest.once('error',reject); });
  guest.send(JSON.stringify({t:'join', code, name:'Друг'}));
  const joined = await wait(m => m.t === 'joined');
  await page.click('#btnStart');
  await page.waitForSelector('#hud:not(.hidden)');
  assert.equal(await page.getByRole('button', { name: 'Выйти из игры', exact: true }).isVisible(), true, 'Battle pause offers a real game-exit action');
  await page.click('#btnResumeGame');
  await page.waitForFunction(() => window.__egg.S.locked);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause:not(.hidden)');
  await page.click('#btnPauseLobby');
  await page.waitForSelector('#lobby:not(.hidden)');
  assert.equal(await page.locator('#lobbyCode').textContent(),code,'Back to room preserves membership');
  if (process.env.SCENARIO === 'round-end') {
    await page.waitForFunction(() => window.__egg.S.roomState === 'results', null, { timeout: 30000 });
    assert.equal(await page.locator('#lobby').isVisible(), true, 'Round ending keeps a waiting player in the room');
    assert.equal(await page.locator('#btnResumeMatch').isVisible(), false);
    assert.equal(await page.locator('#btnStart').isVisible(), true, 'Host can start the next round');
    await page.click('#btnStart');
    await page.waitForSelector('#hud:not(.hidden)');
    await page.click('#btnPauseLeave');
    await page.waitForSelector('#menu:not(.hidden)');
    assert.deepEqual(errors, []);
    console.log('PASS: round ends while waiting in room; next round starts; room exit works');
  } else {
    assert.ok(sent.some(m => m.t === 'lobby'));
    await wait(m => m.t === 's' && m.p.some(p => p.i === hostId && !p.a));
    messages.length = 0;
    await page.evaluate(() => window.__egg.send({ t: 'respawn' }));
    await new Promise(resolve => setTimeout(resolve,2300));
    const state = await wait(m => m.t === 's');
    assert.equal(state.p.find(p => p.i === hostId).a,0,'A player who returned to the room stays out of combat and does not auto-respawn');
    assert.equal(state.p.find(p => p.i === joined.id).a,1,'The other player continues the match');
    assert.equal(await page.locator('#btnStart').isVisible(),false,'Returning host cannot accidentally restart a running match');
    await page.click('#btnResumeMatch');
    await page.waitForSelector('#hud:not(.hidden)');
    assert.ok(sent.some(m => m.t === 'resume'));
    const resumed = await wait(m => m.t === 's' && m.p.some(p => p.i === hostId && p.a));
    assert.equal(resumed.p.find(p => p.i === hostId).hp,100);
    await page.click('#btnResumeGame');
    await page.waitForFunction(() => window.__egg.S.locked);
    await page.evaluate(() => Object.assign(window.__egg.S.me,{x:-4,y:0,z:6,yaw:0,pitch:0}));
    guest.send(JSON.stringify({t:'input',x:-4,y:0,z:3.6,yaw:0,pitch:0}));
    await wait(m => m.t === 's' && m.p.some(p => p.i === hostId && p.x === -4 && p.z === 6));
    await new Promise(resolve=>setTimeout(resolve,2000));
    guest.send(JSON.stringify({t:'shoot',w:'awp',dx:0,dy:-.3,dz:2.4}));
    await page.waitForSelector('#death:not(.hidden)');
    assert.equal(await page.locator('#btnGameMenu').isVisible(),true,'Game menu remains accessible during death');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__egg.S.locked);
    await page.waitForSelector('#pause:not(.hidden)');
    await page.click('#btnGameMenu');
    await page.waitForSelector('#pause:not(.hidden)');
    await page.screenshot({path:'/tmp/egg-exit-menu.png'});
    await page.setViewportSize({width:390,height:844});
    const exitBox = await page.locator('#btnPauseLeave').boundingBox();
    assert.ok(exitBox && exitBox.x >= 0 && exitBox.y >= 0 && exitBox.x + exitBox.width <= 390 && exitBox.y + exitBox.height <= 844, 'Mobile exit button fits the visible menu');
    await page.screenshot({path:'/tmp/egg-exit-mobile.png'});
    await page.click('#btnPauseLeave');
    await page.waitForSelector('#menu:not(.hidden)');
    await page.waitForFunction(() => document.documentElement.dataset.gameReady === '1');
    assert.equal(new URL(page.url()).searchParams.has('room'),false,'Leaving removes the invite/autojoin URL');
    assert.ok(sent.some(m => m.t === 'leave'),'Exit explicitly notifies the server');
    const remaining = await wait(m => m.t === 'players' && m.players.length === 1);
    assert.equal(remaining.hostId,joined.id,'Leaving host transfers ownership');
    assert.equal(remaining.players[0].i,joined.id,'Player is actually removed from the server room');
    assert.equal(await page.locator('#menuMsg').textContent(),'','Intentional exit is not reported as a connection failure');
    await page.click('#btnPlay'); await page.click('#btnCreate');
    await page.waitForSelector('#lobby:not(.hidden)');
    assert.notEqual(await page.locator('#lobbyCode').textContent(),code,'Can create a new room after leaving');
    await page.click('#btnLeave');
    await page.waitForSelector('#menu:not(.hidden)');
    assert.equal(new URL(page.url()).searchParams.has('room'),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: pause via Esc; return to room; no ghost respawn; resume; exit during death; disconnect; host transfer; create and leave another room');
  }
} finally {
  guest?.close();
  await browser.close();
}
