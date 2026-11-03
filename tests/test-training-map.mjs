import assert from 'node:assert/strict';
import { chromium } from '/Users/nikita/.nvm/versions/node/v24.14.0/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
const base = process.env.BASE || 'http://127.0.0.1:3191';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/Users/nikita/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 750 } });
  await context.route(/^https:\/\/(cdn.jsdelivr.net|esm.sh)\//, route => route.abort());
  const host = await context.newPage(), guest = await context.newPage(), errors = [], assets = [];
  for (const page of [host, guest]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.url().includes('/maps/training/')) assets.push([response.url(), response.status()]); });
  }
  await host.goto(base + '/?debug=1'); await host.waitForFunction(() => !!window.__egg);
  const choice = host.locator('#menuMaps').getByRole('button', { name: 'Полигон', exact: true });
  assert.equal(await choice.count(), 1, 'A large ready-made map must be selectable alongside the henhouse');
  await choice.click(); assert.equal(await choice.getAttribute('aria-pressed'), 'true');
  await host.fill('#name', 'Полигон1'); await host.click('#btnPlay'); await host.click('#btnCreate');
  await host.waitForSelector('#lobby:not(.hidden)');
  const code = await host.locator('#lobbyCode').textContent();
  await guest.goto(`${base}/?room=${code}&autojoin=1&debug=1`); await guest.waitForSelector('#lobby:not(.hidden)');
  assert.equal(await guest.locator('#roomMaps [aria-pressed="true"]').getAttribute('data-map'), 'training_grounds');
  await host.click('#btnStart');
  for (const page of [host, guest]) {
    await page.waitForSelector('#hud:not(.hidden)');
    assert.equal(await page.locator('#mapName').textContent(), 'Полигон');
    const info = await page.evaluate(() => ({ arena: window.__egg.S.arena, view: window.__egg.getLevelView() }));
    assert.ok(info.arena.halfX * 2 >= 60 && info.arena.halfZ * 2 >= 60, 'At least a 60 × 60 metre playable world');
    assert.equal(info.view.mode, 'imported');
    assert.equal(info.view.triangles, 1754, 'Render the original ready-made scene geometry');
    assert.equal(info.view.textureReady, true, 'The original embedded texture is loaded locally');
    assert.ok(info.arena.spawns.length >= 4);
  }
  await host.bringToFront();
  await host.click('#btnResumeGame'); await host.waitForFunction(() => window.__egg.S.locked);
  const before = await host.evaluate(() => ({ ...window.__egg.S.me }));
  await host.keyboard.down('KeyW');
  try { await host.waitForFunction(({ x, z }) => Math.hypot(window.__egg.S.me.x - x, window.__egg.S.me.z - z) > .5, before, { timeout: 5000 }); }
  finally { await host.keyboard.up('KeyW'); }
  const after = await host.evaluate(() => ({ ...window.__egg.S.me }));
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > .5, 'The imported map is playable, not just a backdrop');
  await host.evaluate(() => Object.assign(window.__egg.S.me, { x: -20, y: 2.318366, z: -13.8, yaw: 0, pitch: 0, vy: 0, onGround: true }));
  await host.keyboard.down('KeyW');
  try {
    await host.waitForFunction(() => window.__egg.S.me.z < -14.4, null, { timeout: 5000 });
    await host.evaluate(async () => { for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame); });
    assert.ok(await host.evaluate(() => window.__egg.S.me.z) >= -14.55, 'The original wall at Z=-14.845 stops the player capsule');
  } finally { await host.keyboard.up('KeyW'); }
  await host.evaluate(() => Object.assign(window.__egg.S.me, { x: -28, y: 2.487673, z: 0, yaw: Math.PI / 2, pitch: 0, vy: 0, onGround: true }));
  await host.keyboard.down('ShiftLeft'); await host.keyboard.down('KeyW');
  try { await host.waitForFunction(() => window.__egg.S.me.x < -30 && window.__egg.S.me.y > 3.2, null, { timeout: 5000 }); }
  finally { await host.keyboard.up('KeyW'); await host.keyboard.up('ShiftLeft'); }
  await host.screenshot({ path: '/tmp/egg-training-map.png' });
  await host.keyboard.press('Escape'); await host.click('#btnPauseLobby');
  await host.waitForSelector('#lobby:not(.hidden)'); await host.click('#btnLeave');
  await host.waitForSelector('#menu:not(.hidden)');
  // Leaving a room intentionally reloads the public URL without diagnostic parameters.
  await host.goto(base + '/?debug=1'); await host.waitForFunction(() => !!window.__egg);
  await host.locator('#menuMaps').getByRole('button', { name: 'Курятник', exact: true }).click();
  await host.click('#btnPlay'); await host.click('#btnCreate'); await host.waitForSelector('#lobby:not(.hidden)');
  await host.click('#btnStart'); await host.waitForSelector('#hud:not(.hidden)');
  assert.equal(await host.locator('#mapName').textContent(), 'Курятник');
  assert.equal(await host.evaluate(() => window.__egg.getLevelView().mode), 'dressed');
  assert.ok(assets.some(([url, status]) => url.includes('scene.json') && status === 200));
  assert.ok(assets.every(([, status]) => status === 200), 'All map assets load without external services');
  assert.deepEqual(errors, []);
  console.log('PASS: ready-made 69 m map; original geometry and texture; two players; movement, wall and sprint up ramp; return to henhouse; local assets');
} finally { await browser.close(); }
