import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(),
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const base = process.env.BASE || 'http://127.0.0.1:3000';
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await context.newPage(), guest = await context.newPage(), errors = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  await host.goto(base + '/?debug=1');
  await host.waitForFunction(() => !!window.__egg);
  await host.fill('#name', '');
  await host.locator('#name').pressSequentially('Egg G Player');
  assert.equal(await host.inputValue('#name'), 'Egg G Player', 'Game shortcuts do not swallow spaces or G in the name field');
  await host.click('#btnPlay');
  await host.click('#btnCreate');
  await host.waitForSelector('#lobby:not(.hidden)');
  const code = await host.locator('#lobbyCode').textContent();
  await guest.goto(`${base}/?room=${code}&autojoin=1&debug=1`);
  await guest.waitForSelector('#lobby:not(.hidden)');
  await host.click('#btnStart');
  for (const page of [host, guest]) await page.waitForSelector('#hud:not(.hidden)');
  await host.bringToFront();
  await host.keyboard.press('KeyG');
  assert.equal(await host.evaluate(() => window.__egg.S.me.grenades), 2, 'G cannot throw through the pause menu');
  await host.click('#btnResumeGame');
  await host.waitForFunction(() => window.__egg.S.locked);
  await host.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyU', key: 'г', bubbles: true })));
  assert.equal(await host.evaluate(() => window.__egg.S.me.grenades), 2, 'Russian Г on U is not a grenade binding');
  await host.keyboard.press('KeyG');
  await host.waitForFunction(() => window.__egg.S.me.grenades === 1 && window.__egg.getGrenades().active === 1);
  await guest.waitForFunction(() => window.__egg.getGrenades().active === 1);
  const own = await host.evaluate(() => window.__egg.getGrenades().projectiles[0].id);
  assert.equal(await guest.evaluate(() => window.__egg.getGrenades().projectiles[0].id), own, 'Both players see the same server grenade');
  await host.evaluate(async () => {
    // Allow the cooldown to expire, then send OS-style key repeats.
    await new Promise(resolve => setTimeout(resolve, 700));
    for (let i = 0; i < 3; i++) document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', key: 'g', repeat: true, bubbles: true }));
  });
  assert.equal(await host.evaluate(() => window.__egg.S.me.grenades), 1, 'Holding G never auto-throws the second grenade');
  // Physical G also works with the Russian layout, where its key text is п.
  await host.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', key: 'п', bubbles: true })));
  await host.waitForFunction(() => window.__egg.S.me.grenades === 0);
  await host.waitForFunction(() => document.getElementById('grenadeCount').textContent === '0');
  await host.screenshot({ path: '/tmp/egg-grenades.png' });
  await host.keyboard.press('KeyG');
  assert.equal(await host.evaluate(() => window.__egg.S.me.grenades), 0, 'Empty inventory cannot throw again');
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__egg.Sound.events.filter(event => event.name === 'grenade-explosion').length >= 2, null, { timeout: 10000 });
    await page.waitForFunction(() => window.__egg.getGrenades().active === 0 && window.__egg.getGrenades().explosions === 0);
  }
  await host.evaluate(() => window.__egg.send({ t: 'start' }));
  await host.waitForFunction(() => window.__egg.S.me.grenades === 2 && window.__egg.S.me.alive);
  // A round reset keeps pointer lock when the browser still owns it.
  if (!(await host.evaluate(() => window.__egg.S.locked))) await host.click('#btnResumeGame');
  await host.keyboard.press('KeyG');
  await host.waitForFunction(() => window.__egg.getGrenades().active === 1);
  await host.keyboard.press('Escape');
  await host.click('#btnPauseLobby');
  await host.waitForSelector('#lobby:not(.hidden)');
  assert.equal(await host.evaluate(() => window.__egg.getGrenades().active), 0, 'Leaving combat clears grenade visuals');
  await guest.waitForFunction(() => window.__egg.getGrenades().active === 0);
  assert.deepEqual(errors, []);
  console.log('PASS: G only, Cyrillic layout, no U binding, text input, pause/repeat guards, inventory, two-client flight and explosion, round reset and room cleanup');
} finally {
  await browser.close();
}
