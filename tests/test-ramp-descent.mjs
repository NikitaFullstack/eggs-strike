import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:3191';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(),
  headless: true,
  args: ['--no-sandbox', ...(process.env.EGG_BROWSER_GPU === 'hardware' ? [] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']), '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 650 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?debug=1`);
  await page.waitForFunction(() => !!window.__egg);
  await page.fill('#name', 'Спуск'); await page.click('#btnPlay'); await page.click('#btnCreate');
  await page.waitForSelector('#lobby:not(.hidden)'); await page.click('#btnStart');
  await page.waitForSelector('#hud:not(.hidden)'); await page.click('#btnResumeGame');
  await page.waitForFunction(() => window.__egg.S.locked);

  async function release() {
    await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  }
  async function place(pose) {
    await release();
    await page.evaluate(pose => Object.assign(window.__egg.S.me, {
      x: -8.1, y: 1.8, z: 0, yaw: 0, pitch: 0, vy: 0, onGround: true,
      energy: 100, sprintExhausted: false, aiming: false, ...pose,
    }), pose);
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); });
  }

  // Travel from the flat deck through both slope directions, at both speeds.
  // Sample every rendered physics frame so a short airborne flicker is caught.
  for (const direction of [-1, 1]) for (const sprint of [false, true]) {
    await place({ z: direction * 2.4, yaw: direction < 0 ? 0 : Math.PI });
    if (sprint) await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    let samples;
    try {
      samples = await page.evaluate(async direction => {
        const result = [], me = window.__egg.S.me, deadline = performance.now() + 8000;
        while (performance.now() < deadline) {
          await new Promise(requestAnimationFrame);
          result.push({ y: me.y, z: me.z, grounded: me.onGround });
          if (me.z * direction > 6.15) return result;
        }
        throw Error('The player got stuck while descending a ramp');
      }, direction);
    } finally { await release(); }
    const slope = samples.filter(sample => Math.abs(sample.z) > 2.9 && Math.abs(sample.z) < 5.9);
    assert.ok(slope.length >= 3, 'Observe the entire slope, including intermediate heights');
    assert.ok(slope.every(sample => sample.grounded), `Stay grounded descending ${direction < 0 ? 'north' : 'south'} at ${sprint ? 'sprint' : 'walk'} speed`);
    for (const sample of slope) {
      const renderedHeight = (6 - Math.abs(sample.z)) * 1.8 / 3.2;
      assert.ok(Math.abs(sample.y - renderedHeight) < .015, `Feet follow the rendered ramp: ${JSON.stringify(sample)}`);
    }
    assert.equal(samples.at(-1).y, 0, 'The ramp meets the ground without a drop');
    assert.equal(samples.at(-1).grounded, true);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !window.__egg.S.me.onGround && window.__egg.S.me.y > .2, null, { timeout: 3000 });
  }

  // The catwalk has a rail, so start on its real top surface and walk off its
  // outer edge. A downward ground snap must not teleport over this 2.35 m drop.
  await place({ x: -7.06, y: 2.35, z: .8, yaw: -Math.PI / 2 });
  await page.keyboard.down('KeyW');
  let fall;
  try {
    fall = await page.evaluate(async () => {
      const samples = [], me = window.__egg.S.me, deadline = performance.now() + 6000;
      while (performance.now() < deadline) {
        await new Promise(requestAnimationFrame);
        samples.push({ x: me.x, y: me.y, grounded: me.onGround });
        if (me.y === 0 && me.onGround) return samples;
      }
      throw Error('The player did not land after leaving the catwalk');
    });
  } finally { await release(); }
  assert.ok(fall.some(sample => sample.x > -6.9 && sample.y > .3 && sample.y < 2.2 && !sample.grounded), 'A large ledge produces a visible airborne fall');
  assert.ok(fall.every((sample, index) => !index || fall[index - 1].y - sample.y < .8), 'No single-frame teleport to the lower floor');
  assert.equal(fall.at(-1).y, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: both ramp descents at walk/sprint speed stay grounded; immediate jump at the base; large catwalk drop still falls naturally');
} finally { await browser.close(); }
