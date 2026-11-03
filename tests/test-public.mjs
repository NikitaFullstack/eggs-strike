import { chromium } from 'playwright';

const BASE = process.env.BASE;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(),
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p1 = await ctx.newPage();
const p2 = await ctx.newPage();
const errors = [];
for (const [n, p] of [['p1', p1], ['p2', p2]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n} console: ${m.text()}`); });
}

async function enter(page) {
  await page.waitForTimeout(800);
  const btn = page.getByRole('button', { name: /Enter\s*site/i });
  if (await btn.count()) {
    await btn.first().click().catch(() => {});
    await page.waitForTimeout(1200);
  }
}

await p1.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
await p1.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await enter(p1);
await p1.waitForSelector('#menu', { timeout: 90000 });
await p1.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 120000 });
await p1.waitForTimeout(300);
console.log('title:', await p1.title());
console.log('menu:', await p1.evaluate(() => !!document.getElementById('menu') && !document.getElementById('menu').classList.contains('hidden')));

await p1.fill('#name', 'Туннель1');
await p1.click('#btnPlay');
await p1.click('#btnCreate');
await p1.waitForSelector('#lobby:not(.hidden)', { timeout: 30000 });
const code = (await p1.textContent('#lobbyCode')).trim();
console.log('room:', code);

await p2.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
await p2.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await enter(p2);
await p2.waitForSelector('#menu', { timeout: 90000 });
await p2.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 120000 });
await p2.waitForTimeout(300);
await p2.fill('#name', 'Туннель2');
await p2.click('#btnPlay');
await p2.fill('#code', code);
await p2.click('#btnJoin');
await p2.waitForSelector('#lobby:not(.hidden)', { timeout: 30000 });
await p1.waitForTimeout(400);
console.log('players:', await p1.textContent('#playerCount'));

await p1.click('#btnStart');
try {
  await p1.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden'), { timeout: 20000 });
  console.log('game started: true');
} catch (e) {
  console.log('game start failed, screen =', await p1.evaluate(() => window.__egg ? window.__egg.S.screen : 'no __egg').catch(() => '?'));
  await p1.screenshot({ path: 'shot-public-fail.png' });
  throw e;
}
await p1.waitForTimeout(1200);
await p1.screenshot({ path: 'shot-public.png' });

console.log('errors:', errors.join(' | ') || '(none)');
await browser.close();
