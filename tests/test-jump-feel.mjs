import assert from 'node:assert/strict';
import { chromium } from '/Users/nikita/.nvm/versions/node/v24.14.0/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

const base = process.env.BASE || 'http://127.0.0.1:3191';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/Users/nikita/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
try {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await context.route(/^https:\/\/(cdn.jsdelivr.net|esm.sh)\//, route => route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/?debug=1');
  await page.waitForFunction(() => !!window.__egg);
  await page.fill('#name', 'Прыжок'); await page.click('#btnPlay'); await page.click('#btnCreate');
  await page.waitForSelector('#lobby:not(.hidden)'); await page.click('#btnStart');
  await page.waitForSelector('#hud:not(.hidden)'); await page.click('#btnResumeGame');
  await page.waitForFunction(() => window.__egg.S.locked);
  await page.evaluate(() => Object.assign(window.__egg.S.me, { x: -4, y: 0, z: 6.8, yaw: 0, pitch: 0, vy: 0, onGround: true }));
  await page.keyboard.down('KeyD'); await page.keyboard.press('Space');
  const jump = await page.evaluate(async () => {
    const me = window.__egg.S.me, start = me.x;
    let peak = me.y, airborne = !me.onGround;
    const deadline = performance.now() + 7000;
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      peak = Math.max(peak, me.y); airborne ||= !me.onGround;
      if (airborne && me.onGround) return { peak, distance: me.x - start };
    }
    throw Error('Jump never landed');
  });
  await page.keyboard.up('KeyD');
  // A distinct Space press immediately after landing must launch another jump.
  await page.keyboard.press('Space');
  const repeated = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return window.__egg.S.me.y;
  });
  console.log('jump:', JSON.stringify({ ...jump, repeated }));
  assert.ok(jump.peak >= 1.3 && jump.peak <= 1.7, `Restore the original jump height: ${jump.peak}`);
  assert.ok(jump.distance >= 2.6, `Restore full air movement: ${jump.distance}`);
  assert.ok(repeated > .05, 'Jumping again after landing has no artificial cooldown');
  assert.deepEqual(errors, []);
  console.log('PASS: original jump height, full air movement and immediate repeat jump through real keyboard input');
} finally { await browser.close(); }
