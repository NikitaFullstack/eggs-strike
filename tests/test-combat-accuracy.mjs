import assert from 'node:assert/strict';
import { chromium } from '/Users/nikita/.nvm/versions/node/v24.14.0/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

const base = process.env.BASE || 'http://127.0.0.1:3191';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/Users/nikita/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const failures = [];
async function test(name, fn) {
  try { await fn(); console.log('PASS:', name); }
  catch (error) { failures.push(name); console.error('FAIL:', name, error.message); }
}
try {
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ viewport: { width: 800, height: 600 } })));
  for (const context of contexts) {
    context.setDefaultTimeout(15000);
    await context.route(/^https:\/\/(cdn.jsdelivr.net|esm.sh)\//, route => route.abort());
  }
  // Transport latency only: the real server, movement, hit tests and renderer remain active.
  await contexts[0].routeWebSocket('**/ws', socket => {
    const server = socket.connectToServer();
    let closed = false;
    socket.onClose(() => { closed = true; server.close(); });
    server.onClose(() => { closed = true; socket.close(); });
    server.onMessage(data => {
      if (JSON.parse(String(data)).t === 's') setTimeout(() => { if (!closed) socket.send(data); }, 120);
      else socket.send(data);
    });
    socket.onMessage(data => server.send(data));
  });
  const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
  const sent = [], received = [], errors = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  host.on('websocket', socket => {
    socket.on('framesent', frame => sent.push(JSON.parse(frame.payload)));
    socket.on('framereceived', frame => received.push(JSON.parse(frame.payload)));
  });
  await host.goto(base + '/?debug=1');
  await host.waitForFunction(() => !!window.__egg);
  await host.fill('#name', 'Точность'); await host.click('#btnPlay'); await host.click('#btnCreate');
  await host.waitForSelector('#lobby:not(.hidden)');
  const code = await host.locator('#lobbyCode').textContent();
  await guest.goto(`${base}/?room=${code}&autojoin=1&debug=1`);
  await guest.waitForSelector('#lobby:not(.hidden)'); await host.click('#btnStart');
  for (const page of [host, guest]) await page.waitForSelector('#hud:not(.hidden)');
  await host.click('#btnResumeGame'); await host.waitForFunction(() => window.__egg.S.locked);
  await host.waitForTimeout(1700); // Spawn protection must not hide hit registration.
  const guestId = await guest.evaluate(() => window.__egg.S.id);
  async function place(page, pose) {
    await page.evaluate(pose => Object.assign(window.__egg.S.me, {
      x: -4, y: 0, z: 6.8, yaw: 0, pitch: 0, vy: 0, onGround: true, ...pose,
    }), pose);
    await page.waitForTimeout(400);
  }
  await test('Visible opponents have no overhead name or HP, including after damage', async () => {
    await place(guest, { x: -4, z: 4.7 });
    await place(host, { pitch: Math.atan2(.575 - .9775, 2.1) });
    const inspect = () => host.evaluate(id => {
      const view = window.__egg.S.players.get(id);
      let overlays = 0;
      view.group.traverse(object => { if (object.isSprite && object.visible) overlays++; });
      return { overlays, visible: view.group.visible && view.body.visible };
    }, guestId);
    assert.deepEqual(await inspect(), { overlays: 0, visible: true }, 'The visible egg has no name/health billboards');
    await host.evaluate(() => window.__egg.switchWeapon('usp'));
    await host.mouse.click(400, 300);
    await host.waitForFunction(id => window.__egg.S.players.get(id).hp === 81, guestId);
    assert.deepEqual(await inspect(), { overlays: 0, visible: true }, 'Damage does not recreate an overhead health bar');
    assert.equal(await host.locator('#hitmarker').getAttribute('data-kind'), 'hit');
    await host.screenshot({ path: '/tmp/egg-no-overhead.png' });
  });
  await test('A shot uses the current mouse aim even before the next rendered frame', async () => {
    await place(guest, { x: 8, z: 6 }); await place(host, {});
    const before = sent.length;
    const aim = await host.evaluate(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: 100, movementY: -30 }));
      document.getElementById('game').dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      return { yaw: window.__egg.S.me.yaw, pitch: window.__egg.S.me.pitch };
    });
    await host.waitForTimeout(200);
    const shot = sent.slice(before).find(message => message.t === 'shoot');
    assert.ok(shot, 'Mouse click sends a real shot');
    assert.ok(Math.abs(shot.dx + Math.sin(aim.yaw) * Math.cos(aim.pitch)) < 1e-6, 'Shot follows the latest horizontal aim');
    assert.ok(Math.abs(shot.dy - Math.sin(aim.pitch)) < 1e-6, 'Shot follows the latest vertical aim');
  });

  await test('Shooting while moving uses the current origin rather than the previous 50 ms input', async () => {
    await place(host, {});
    const before = received.length;
    const pose = await host.evaluate(() => {
      const me = window.__egg.S.me;
      me.x += .18; me.y = .12; me.onGround = false;
      document.getElementById('game').dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      return { x: me.x, y: me.y + window.__egg.S.arena.playerCollision.height * .85, z: me.z };
    });
    await host.waitForTimeout(200);
    const shot = received.slice(before).find(message => message.t === 'shot');
    assert.ok(shot, 'Server resolves the shot');
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(shot.origin[axis] - pose[axis]) < 1e-6, `Stale ${axis} origin: ${shot.origin[axis]} instead of ${pose[axis]}`);
  });

  await test('Aiming at the rendered moving egg registers damage with 120 ms snapshot latency', async () => {
    await place(host, {}); await place(guest, { x: -4, z: 4.7 });
    await guest.evaluate(() => { window.__egg.S.locked = true; });
    await guest.keyboard.down('KeyD');
    try {
      await guest.waitForFunction(() => window.__egg.S.me.x > -2.6);
      const actual = await guest.evaluate(() => window.__egg.S.me.x);
      const before = received.length;
      const visible = await host.evaluate(id => {
        const e = window.__egg, me = e.S.me, target = e.S.players.get(id).group.position;
        const dx = target.x - me.x, dz = target.z - me.z;
        me.yaw = Math.atan2(-dx, -dz);
        me.pitch = Math.atan2(target.y + .575 - me.y - .9775, Math.hypot(dx, dz));
        e.switchWeapon('usp');
        // Aim and click at the displayed pose in one task: software rendering must not
        // insert an extra frame of target movement between the test's aim and click.
        document.getElementById('game').dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
        document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
        return target.x;
      }, guestId);
      assert.ok(actual - visible > .34, `Fixture needs visible network lag: actual=${actual}, visible=${visible}`);
      await host.waitForTimeout(300);
      const hit = received.slice(before).find(message => message.t === 'hit' && message.to === guestId);
      assert.ok(hit, 'The server must hit the egg the shooter actually sees under the crosshair');
      assert.equal(hit.dmg, 19);
      assert.equal(await host.locator('#hitmarker').getAttribute('data-kind'), 'hit');
    } finally { await guest.keyboard.up('KeyD'); }
  });

  await test('Holding an automatic weapon on a close stationary egg produces consecutive hits', async () => {
    // The preceding hit test must not leave this independent four-bullet scenario at 81 HP.
    await host.evaluate(() => window.__egg.send({ t: 'start' }));
    await guest.waitForFunction(() => window.__egg.S.me.hp === 100);
    await host.click('#btnResumeGame'); await host.waitForFunction(() => window.__egg.S.locked);
    await host.waitForTimeout(1700);
    await place(guest, { x: -4, z: 4.7 }); await place(host, { pitch: Math.atan2(.575 - .9775, 2.1) });
    await host.keyboard.press('Digit1');
    const before = received.length, sentBefore = sent.length;
    await host.mouse.down();
    try { await guest.waitForSelector('#death:not(.hidden)', { timeout: 4000 }); }
    finally { await host.mouse.up(); }
    const shots = received.slice(before).filter(message => message.t === 'shot');
    const kill = received.slice(before).findIndex(message => message.t === 'kill' && message.victim === guestId);
    assert.ok(kill >= 0);
    assert.ok(shots.slice(0, 4).every(shot => shot.rays[0].target === guestId), 'First four bullets at point blank must hit');
    const directions = sent.slice(sentBefore).filter(message => message.t === 'shoot').slice(0, 4);
    assert.equal(directions.length, 4);
    assert.ok(directions.every(shot => Math.abs(shot.dy - directions[0].dy) < 1e-6), 'Holding fire does not push subsequent bullets away from a fixed aim');
    assert.equal(await host.locator('#hitmarker').getAttribute('data-kind'), 'kill');
  });
  assert.deepEqual(errors, [], 'No client exceptions');
  assert.deepEqual(failures, []);
} finally { await browser.close(); }
