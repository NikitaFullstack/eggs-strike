import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(),
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1280,800'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p1 = await ctx.newPage();
const p2 = await ctx.newPage();
const p3 = await ctx.newPage();
const errors = [];
for (const [n, p] of [['p1', p1], ['p2', p2], ['p3', p3]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n} console: ${m.text()}`); });
}

await p1.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await p1.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p1.fill('#name', 'Первый');
await p1.click('#btnPlay');
await p1.click('#btnCreate');
await p1.waitForSelector('#lobby:not(.hidden)');
const code = (await p1.textContent('#lobbyCode')).trim();

await p2.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await p2.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p2.fill('#name', 'Второй');
await p2.click('#btnPlay');
await p2.fill('#code', code);
await p2.click('#btnJoin');
await p2.waitForSelector('#lobby:not(.hidden)');
await p2.waitForTimeout(300);

await p1.click('#btnStart');
await p1.waitForTimeout(1500);
console.log('match started, joining third player mid-match...');

// третий заходит в идущий матч
await p3.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await p3.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p3.fill('#name', 'Третий');
await p3.click('#btnPlay');
await p3.fill('#code', code);
await p3.click('#btnJoin');

try {
  await p3.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden'), { timeout: 15000 });
} catch (e) {
  console.log('p3 did not enter match; screen =', await p3.evaluate(() => window.__egg ? window.__egg.S.screen : '?').catch(() => '?'));
  console.log('p3 menu msg:', await p3.evaluate(() => document.getElementById('menuMsg').textContent).catch(() => '?'));
  throw e;
}

await p3.waitForTimeout(1200);
const p3state = await p3.evaluate(() => ({
  screen: window.__egg.S.screen,
  alive: window.__egg.S.me.alive,
  hp: window.__egg.S.me.hp,
  remotes: window.__egg.S.players.size,
  timer: document.getElementById('timer').textContent,
  soundBuffers: Object.keys(window.__egg.Sound.buffers),
}));
console.log('p3:', JSON.stringify(p3state));

const p1state = await p1.evaluate(() => ({
  remotes: window.__egg.S.players.size,
  scoreboardRows: document.querySelectorAll('#scoreboard li').length,
  names: [...document.querySelectorAll('#scoreboard .sb-name')].map((e) => e.textContent),
}));
console.log('p1 sees:', JSON.stringify(p1state));

await p3.screenshot({ path: 'shot-midjoin.png' });

console.log('errors:', errors.join(' | ') || '(none)');
await browser.close();
