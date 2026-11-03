import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import WebSocket from 'ws';
import Household from '../public/household-maps.js';
import G from '../public/arena-geometry.js';

const base = process.env.BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(), headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const guests = [];
async function guest(code, name) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
  guests.push(ws);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const joined = new Promise(resolve => ws.on('message', raw => { if (JSON.parse(raw).t === 'joined') resolve(); }));
  ws.send(JSON.stringify({ t: 'join', code, name }));
  await joined;
  return ws;
}
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });

  async function place(pose) {
    await page.keyboard.up('KeyW');
    await page.evaluate(pose => Object.assign(window.__egg.S.me, { vy: 0, onGround: true, pitch: 0, yaw: 0, ...pose }), pose);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  for (const map of Household.maps) {
    await page.goto(base + '/?debug=1');
    await page.waitForFunction(() => !!window.__egg);
    await page.locator(`#menuMaps [data-map="${map.id}"]`).click();
    assert.match(await page.locator('#matchDescription').textContent(), /3 игроков/);
    assert.equal(await page.locator(`#menuMaps [data-map="${map.id}"] img`).evaluate(img => img.complete && img.naturalWidth > 0), true);
    await page.fill('#name', 'Картограф');
    await page.click('#btnPlay'); await page.click('#btnCreate');
    await page.waitForSelector('#lobby:not(.hidden)');
    const code = await page.locator('#lobbyCode').textContent();
    const a = await guest(code, 'Дружок'), b = await guest(code, 'Желток');
    await page.waitForFunction(() => document.getElementById('playerCount').textContent === '3/3');
    if (map.id === 'refrigerator') {
      for (const viewport of [{ width: 1120, height: 600 }, { width: 390, height: 667 }]) {
        await page.setViewportSize(viewport);
        const controls = await page.locator('.room-controls').boundingBox();
        for (const card of await page.locator('#roomMaps .map-card').all()) {
          const box = await card.boundingBox();
          assert.ok(box.x + box.width <= controls.x || box.x >= controls.x + controls.width || box.y >= controls.y + controls.height || box.y + box.height <= controls.y, 'All map cards stay separate from the three-player room controls');
        }
        await page.locator('#btnStart').click({ trial: true });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await page.click('#btnStart'); await page.waitForSelector('#hud:not(.hidden)');
    await page.waitForFunction(() => window.__egg.S.players.size === 2);
    assert.equal(await page.locator('#mapName').textContent(), map.name);
    const view = await page.evaluate(() => window.__egg.getLevelView());
    // Rendered cover must exactly match what the server and capsule collide with.
    for (const box of G.boxes(map)) {
      const rendered = view.solids.find(solid => solid.id === box.id);
      assert.ok(rendered, `${map.name}: render ${box.id}`);
      const expected = [box.x - box.w / 2, box.y || 0, box.z - box.d / 2, box.x + box.w / 2, (box.y || 0) + box.h, box.z + box.d / 2];
      [...rendered.min, ...rendered.max].forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < .00001, `${box.id}: collider and mesh bounds agree`));
    }
    await page.click('#btnResumeGame'); await page.waitForFunction(() => window.__egg.S.locked);
    for (const ramp of map.ramps) {
      const axis = ramp.dir.endsWith('x') ? 'x' : 'z', sign = ramp.dir.startsWith('+') ? 1 : -1;
      const length = axis === 'x' ? ramp.w : ramp.d;
      for (const direction of [1, -1]) {
        const start = ramp[axis] - sign * direction * (length / 2 + .15);
        const end = ramp[axis] + sign * direction * (length / 2 + .12);
        const yaw = axis === 'x' ? -sign * direction * Math.PI / 2 : (sign * direction > 0 ? Math.PI : 0);
        await place({ x: ramp.x, z: ramp.z, [axis]: start, y: direction === 1 ? ramp.h0 : ramp.h1, yaw });
        await page.keyboard.down('KeyW');
        try {
          await page.waitForFunction(({ axis, end, movement }) => window.__egg.S.me[axis] * movement >= end * movement,
            { axis, end, movement: sign * direction }, { timeout: 9000 });
        } finally { await page.keyboard.up('KeyW'); }
        const feet = await page.evaluate(() => ({ y: window.__egg.S.me.y, ground: window.__egg.S.me.onGround }));
        assert.ok(Math.abs(feet.y - (direction === 1 ? ramp.h1 : ramp.h0)) < .02 && feet.ground, `${ramp.id}: real keyboard movement crosses slope and landing ${direction}`);
      }
    }
    // Capture a playable view from the south approach, with two remote players.
    const cover = map.crates.find(box => box.id.endsWith('BOARD'));
    a.send(JSON.stringify({ t: 'input', x: 0, y: cover.h, z: cover.z, yaw: 0, pitch: 0 }));
    b.send(JSON.stringify({ t: 'input', x: 3, y: 0, z: 4.8, yaw: -.7, pitch: 0 }));
    const x = -.8, z = 5.4;
    await place({ x, z, y: 0, yaw: Math.atan2(x, z), pitch: -.08 });
    await page.evaluate(async () => { for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame); });
    await page.screenshot({ path: `/tmp/egg-${map.id}.png` });
    await page.mouse.click(640, 400);
    await page.waitForFunction(() => window.__egg.S.me.ammo.ak === 29);
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => window.__egg.S.me.grenades === 1);
    await page.waitForFunction(() => window.__egg.Sound.events.some(event => event.name === 'grenade-explosion'), null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.__egg.Sound.events.some(event => event.name === 'farm-hen' || event.name === 'farm-wind')), false, 'Indoor arenas have indoor ambience');
    await page.keyboard.press('Escape');
    await page.click('#btnPauseLobby'); await page.waitForSelector('#lobby:not(.hidden)');
    assert.equal(await page.evaluate(() => window.__egg.getGrenades().active), 0);
    for (const ws of [a, b]) ws.close();
    await page.click('#btnLeave'); await page.waitForSelector('#menu:not(.hidden)');
    console.log(`PASS: ${map.name}; three clients, exact geometry, both ramp directions, live G and gun, indoor ambience, clean exit`);
  }
  // All four choices fit on a phone and remain separate from controls at small sizes.
  await page.goto(base + '/?debug=1'); await page.waitForFunction(() => !!window.__egg);
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1120, height: 600 }, { width: 800, height: 600 }, { width: 390, height: 844 }, { width: 390, height: 667 }]) {
    await page.setViewportSize(viewport);
    const controls = await page.locator('.menu-bottom').boundingBox();
    for (const card of await page.locator('#menuMaps .map-card').all()) {
      const box = await card.boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, 'Every map is onscreen');
      assert.ok(box.x + box.width <= controls.x || box.x >= controls.x + controls.width || box.y >= controls.y + controls.height || box.y + box.height <= controls.y, 'Map choices do not overlap controls');
    }
  }
  await page.screenshot({ path: '/tmp/egg-household-mobile.png' });
  assert.deepEqual(errors, []);
} finally { for (const ws of guests) ws.close(); await browser.close(); }
