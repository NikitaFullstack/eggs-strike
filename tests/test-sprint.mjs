import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:3191';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(),
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const failures = [];
async function test(name, fn) {
  try { await fn(); console.log('PASS:', name); }
  catch (error) { failures.push(name); console.error('FAIL:', name, error.message); }
}
let bot;
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await context.route(/^https:\/\/(cdn.jsdelivr.net|esm.sh)\//, route => route.abort());
  const page = await context.newPage(), errors = [], sent = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framesent', frame => sent.push(JSON.parse(frame.payload))));
  await page.goto(base + '/?debug=1'); await page.waitForFunction(() => !!window.__egg);
  await page.fill('#name', 'Спринтер'); await page.click('#btnPlay'); await page.click('#btnCreate');
  await page.waitForSelector('#lobby:not(.hidden)');
  const code = await page.locator('#lobbyCode').textContent();
  await page.click('#btnStart'); await page.waitForSelector('#hud:not(.hidden)');
  await page.click('#btnResumeGame'); await page.waitForFunction(() => window.__egg.S.locked);

  async function release() {
    for (const key of ['KeyD', 'KeyW', 'ShiftLeft', 'ShiftRight']) await page.keyboard.up(key);
  }
  async function place(energy = 100, x = -7.5) {
    await release();
    await page.evaluate(({ energy, x }) => Object.assign(window.__egg.S.me, { x, y: 0, z: 6.8, yaw: 0, pitch: 0, vy: 0, onGround: true, energy }), { energy, x });
  }
  // Observe positions over real rendered physics frames. The engine caps a frame's
  // simulation step at 50 ms; expected speeds/rates below come from the requirements.
  async function sample(frames = 6) {
    return page.evaluate(async frames => {
      let previous = await new Promise(requestAnimationFrame), elapsed = 0;
      const me = window.__egg.S.me, x = me.x, energy = me.energy;
      for (let i = 0; i < frames; i++) {
        const now = await new Promise(requestAnimationFrame);
        elapsed += Math.min(.05, (now - previous) / 1000); previous = now;
      }
      return { speed: (me.x - x) / elapsed, energyRate: (me.energy - energy) / elapsed, energy: me.energy };
    }, frames);
  }

  await test('HUD shows full energy and Shift alone does not spend it', async () => {
    const meter = page.getByRole('progressbar', { name: 'Энергия спринта' });
    assert.equal(await meter.count(), 1, 'A visible energy meter is required');
    assert.ok(await meter.isVisible());
    assert.equal(await meter.getAttribute('aria-valuenow'), '100');
    await page.keyboard.down('ShiftLeft');
    try { assert.equal((await sample()).energy, 100); }
    finally { await release(); }
  });
  await test('Both Shift keys double speed to 9 m/s and spend 25 energy/s', async () => {
    await place(); await page.keyboard.down('KeyD');
    try { assert.ok(Math.abs((await sample()).speed - 4.5) < .05, 'Ordinary movement remains 4.5 m/s'); }
    finally { await release(); }
    for (const shift of ['ShiftLeft', 'ShiftRight']) {
      await place(); const before = sent.length;
      await page.keyboard.down(shift); await page.keyboard.down('KeyD');
      let result;
      try { result = await sample(); } finally { await release(); }
      assert.ok(Math.abs(result.speed - 9) < .05, `${shift} speed: ${result.speed}`);
      assert.ok(Math.abs(result.energyRate + 25) < .05, `Drain rate: ${result.energyRate}`);
      assert.ok(sent.slice(before).some(message => message.t === 'input' && message.x > -7.5), 'Sprinting uses real movement updates');
      await page.waitForFunction(() => Number(document.getElementById('stamina').getAttribute('aria-valuenow')) < 100);
      assert.ok(parseFloat(await page.locator('#staminaFill').evaluate(element => element.style.width)) < 100, 'The visible energy bar drains');
    }
  });
  await test('Empty energy stops sprinting without frame-by-frame speed flicker; releasing Shift rearms it', async () => {
    await place(8);
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyD');
    try {
      await page.waitForFunction(() => window.__egg.S.me.energy === 0, null, { timeout: 3000 });
      const empty = await sample();
      assert.ok(Math.abs(empty.speed - 4.5) < .05, `Exhausted movement: ${empty.speed}`);
      assert.ok(empty.energy > 0 && empty.energy <= 100, 'Energy recovers while walking after exhaustion');
      await page.keyboard.up('ShiftLeft'); await sample(2); await page.keyboard.down('ShiftRight');
      assert.ok(Math.abs((await sample(2)).speed - 9) < .05, 'A fresh Shift press can sprint with recovered energy');
    } finally { await release(); }
  });
  await test('Energy recovers at 20/s, stays within 0..100 and is not spent against a wall', async () => {
    await place(35);
    assert.ok(Math.abs((await sample()).energyRate - 20) < .05);
    await place(99); assert.equal((await sample()).energy, 100);
    await place(70, 9.36); await page.keyboard.down('ShiftRight'); await page.keyboard.down('KeyD');
    try {
      const wall = await sample();
      assert.ok(wall.speed < .01, 'The wall still blocks sprinting');
      assert.ok(wall.energy >= 70, 'No energy drain without actual displacement');
    } finally { await release(); }
    await page.waitForFunction(() => window.__egg.S.me.energy === 100);
    const meter = page.getByRole('progressbar', { name: 'Энергия спринта' });
    await page.waitForFunction(() => document.getElementById('stamina').getAttribute('aria-valuenow') === '100');
    assert.equal(await meter.getAttribute('aria-valuenow'), '100');
    await page.screenshot({ path: '/tmp/egg-sprint-hud.png' });
  });
  await test('Sprinting climbs a ramp even when frame time reaches the physics cap', async () => {
    await place(100, 8.1);
    await page.evaluate(() => {
      window.__egg.S.me.z = 6.2;
      window.__egg.slowFrames = true;
      const slowFrame = () => {
        if (!window.__egg.slowFrames) return;
        // Reproduce low FPS without replacing movement or collision detection.
        const end = performance.now() + 65;
        while (performance.now() < end) {}
        requestAnimationFrame(slowFrame);
      };
      requestAnimationFrame(slowFrame);
    });
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
    try {
      await page.waitForFunction(() => window.__egg.S.me.y > 1.79 && window.__egg.S.me.z < 2.65, null, { timeout: 3000 });
      assert.ok(await page.evaluate(() => window.__egg.S.me.energy) < 100, 'Actual sprinting carries the player up the ramp');
    } catch (error) {
      const state = await page.evaluate(() => {
        const { me, keys, locked } = window.__egg.S;
        return { x: me.x, y: me.y, z: me.z, energy: me.energy, ground: me.onGround, locked, keys };
      });
      throw Error(`${error.message}; ramp state: ${JSON.stringify(state)}`);
    } finally {
      await release(); await page.evaluate(() => { window.__egg.slowFrames = false; });
    }
  });
  await test('Respawn and a new round restore full energy', async () => {
    const messages = [];
    bot = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
    bot.on('message', raw => messages.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => { bot.once('open', resolve); bot.once('error', reject); });
    const send = message => bot.send(JSON.stringify(message));
    send({ t: 'join', code, name: 'Проверка респавна' });
    const deadline = Date.now() + 4000;
    while (!messages.some(message => message.t === 'start') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(messages.some(message => message.t === 'start'), 'Real second client joins the match');
    await place(10, -4);
    await page.waitForFunction(() => window.__egg.S.me.serverX === -4 && window.__egg.S.me.serverZ === 6.8);
    send({ t: 'input', x: -4, y: 0, z: 4.7, yaw: 0, pitch: 0 });
    await page.waitForTimeout(300);
    send({ t: 'shoot', w: 'awp', dx: 0, dy: -.4025, dz: 2.1 });
    const shotDeadline = Date.now() + 3000;
    while (!messages.some(message => message.t === 'shot') && Date.now() < shotDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    const shot = messages.find(message => message.t === 'shot');
    assert.equal(shot?.rays[0].target, await page.evaluate(() => window.__egg.S.id), `Respawn fixture shot: ${JSON.stringify(shot)}`);
    await page.waitForSelector('#death:not(.hidden)');
    const deadEnergy = await page.evaluate(() => window.__egg.S.me.energy);
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyD');
    await sample(2);
    assert.equal(await page.evaluate(() => window.__egg.S.me.energy), deadEnergy, 'Death neither drains nor refills energy');
    await release();
    await page.waitForFunction(() => window.__egg.S.me.alive && document.getElementById('death').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => window.__egg.S.me.energy), 100, 'Respawn replenishes energy');
    await page.evaluate(() => { window.__egg.S.me.energy = 5; window.__egg.send({ t: 'start' }); });
    await page.waitForFunction(() => window.__egg.S.me.energy === 100);
    assert.equal(await page.evaluate(() => window.__egg.S.me.sprinting), false);
  });
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
} finally { bot?.close(); await browser.close(); }
