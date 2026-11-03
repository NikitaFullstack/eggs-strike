import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import WebSocket from 'ws';
import Household from '../public/household-maps.js';
import * as THREE from 'three';
import Shapes from '../public/household-shapes.js';
import { householdFixture } from './household-fixture.mjs';

const base = process.env.BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(), headless: true,
  args: ['--no-sandbox', ...(process.env.EGG_BROWSER_GPU === 'hardware' ? [] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']), '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
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
  async function walkTo(point, label) {
    const start = await page.evaluate(() => ({ x: window.__egg.S.me.x, z: window.__egg.S.me.z }));
    const dx = point.x - start.x, dz = point.z - start.z, length = Math.hypot(dx, dz);
    await page.evaluate(({ yaw, y }) => {
      window.__egg.S.me.yaw = yaw;
      window.__walkHeightError = Math.abs(window.__egg.S.me.y - y);
    }, { yaw: Math.atan2(-dx, -dz), y: point.y });
    await page.keyboard.down('KeyW');
    try {
      await page.waitForFunction(({ start, dx, dz, length, y }) => {
        const me = window.__egg.S.me;
        window.__walkHeightError = Math.max(window.__walkHeightError, Math.abs(me.y - y));
        return ((me.x - start.x) * dx + (me.z - start.z) * dz) / length >= length - .08;
      }, { start, dx, dz, length, y: point.y }, { timeout: Math.max(9000, length * 2000) });
    } catch (error) {
      console.error(label, await page.evaluate(() => ({ x: window.__egg.S.me.x, y: window.__egg.S.me.y, z: window.__egg.S.me.z, heightError: window.__walkHeightError })));
      await page.screenshot({ path: '/tmp/egg-household-walk-error.png' });
      throw error;
    } finally { await page.keyboard.up('KeyW'); }
    const result = await page.evaluate(() => ({ ...window.__egg.S.me, heightError: window.__walkHeightError }));
    assert.ok(Math.hypot(result.x - point.x, result.z - point.z) < .6, `${label}: stays on the intended route`);
    assert.ok(result.heightError < .08 && result.onGround, `${label}: keeps its floor throughout the crossing`);
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
    // Shared curved models, not their broad footprint boxes, define the world.
    const parts = Shapes.build(THREE, map), bounds = new Map();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      if (!bounds.has(part.propId)) bounds.set(part.propId, new THREE.Box3());
      bounds.get(part.propId).union(part.geometry.boundingBox);
    }
    for (const [id, box] of bounds) {
      const rendered = view.solids.find(solid => solid.id === id);
      assert.ok(rendered, `${map.name}: render ${id}`);
      const expected = [...box.min.toArray(), ...box.max.toArray()];
      [...rendered.min, ...rendered.max].forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < .00001, `${id}: rendered shape follows the shared model`));
    }
    for (const part of parts) part.geometry.dispose();
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
        } catch (error) {
          console.error(`${map.id} ${ramp.id} direction ${direction}`, await page.evaluate(() => ({ x: window.__egg.S.me.x, y: window.__egg.S.me.y, z: window.__egg.S.me.z, locked: window.__egg.S.locked, alive: window.__egg.S.me.alive, ground: window.__egg.S.me.onGround })));
          await page.screenshot({ path: `/tmp/egg-${map.id}-route-error.png` });
          throw error;
        } finally { await page.keyboard.up('KeyW'); }
        const feet = await page.evaluate(() => ({ y: window.__egg.S.me.y, ground: window.__egg.S.me.onGround }));
        assert.ok(Math.abs(feet.y - (direction === 1 ? ramp.h1 : ramp.h0)) < .02 && feet.ground, `${ramp.id}: real keyboard movement crosses slope and landing ${direction}`);
      }
    }
    const upper = map.id === 'refrigerator'
      ? [[-7.7, -.4], [-7.7, -4.9], [7.7, -4.9], [7.7, -.4]].map(([x, z]) => ({ x, y: 2.8, z }))
      : [[-6.1, 1.2], [-6.1, .6], [-3.2, .6], [-3.2, -1], [5.2, -1], [5.2, -5.2], [6.6, -5.6]].map(([x, z]) => ({ x, y: 2.1, z }));
    await place(upper[0]);
    for (const point of upper.slice(1)) await walkTo(point, `${map.id}: continuous upper route`);
    const underpass = map.id === 'refrigerator'
      ? [{ x: -4, y: 0, z: -7.8 }, { x: -4, y: 0, z: -3.4 }]
      : [{ x: 2.25, y: 0, z: -3 }, { x: 2.25, y: 0, z: 1 }];
    for (const path of [underpass, [...underpass].reverse()]) {
      await place(path[0]);
      await walkTo(path[1], `${map.id}: lower route remains open below the deck`);
    }
    if (map.id === 'refrigerator') {
      // A shelf jump can land on the steep bottle shoulder. The actual client
      // must slide outside its body, never fall through to an internal surface.
      await place({ x: 5.6, y: 4.4, z: .1, vy: 0, onGround: false });
      await page.waitForFunction(() => window.__egg.S.me.onGround, null, { timeout: 12000 });
      const landed = await page.evaluate(() => ({ x: window.__egg.S.me.x, y: window.__egg.S.me.y, z: window.__egg.S.me.z }));
      const fixture = householdFixture(map);
      assert.equal(fixture.insideProp(landed.x, landed.y, landed.z), false, 'Shelf jump cannot put the player inside the juice bottle');
      fixture.dispose();
    } else {
      await place({ x: 2.25, y: 6, z: -1, vy: -20, onGround: false });
      await page.waitForFunction(() => window.__egg.S.me.onGround, null, { timeout: 12000 });
      assert.ok(Math.abs(await page.evaluate(() => window.__egg.S.me.y) - 2.1) < .02, 'Fast fall lands on the thin bridge');
      await place({ x: 2.25, y: 0, z: -1 });
      await page.evaluate(() => { window.__jumpHeightMax = 0; });
      await page.keyboard.press('Space');
      await page.waitForFunction(() => {
        const me = window.__egg.S.me;
        window.__jumpHeightMax = Math.max(window.__jumpHeightMax, me.y);
        return window.__jumpHeightMax > .2 && me.onGround;
      }, null, { timeout: 12000 });
      assert.ok(await page.evaluate(() => window.__jumpHeightMax) < .83, 'The capsule head stops below the bridge and falls back down');
    }
    // The same column supports two players on different levels.
    const upperGuest = map.id === 'refrigerator' ? { x: 0, y: 2.8, z: -4.9 } : { x: 2.25, y: 2.1, z: -1 };
    a.send(JSON.stringify({ t: 'input', ...upperGuest, yaw: 0, pitch: 0 }));
    b.send(JSON.stringify({ t: 'input', ...upperGuest, y: 0, yaw: -.7, pitch: 0 }));
    await place(map.showcaseUpper);
    await page.evaluate(async () => { for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame); });
    await page.screenshot({ path: `/tmp/egg-${map.id}-upper.png` });
    await place(map.showcase);
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
    console.log(`PASS: ${map.name}; three clients, exact geometry, bidirectional ramps, continuous upper routes, lower passages, live G and gun, indoor ambience, clean exit`);
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
