import { chromium } from '/Users/nikita/.nvm/versions/node/v24.14.0/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

const EXE = '/Users/nikita/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1280,800'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p1 = await ctx.newPage();
const p2 = await ctx.newPage();
const errors = [];
for (const [n, p] of [['p1', p1], ['p2', p2]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
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
await p1.waitForSelector('#hud:not(.hidden)');
await p1.waitForTimeout(9500);

const r1 = await p1.evaluate(() => ({
  resultsVisible: !document.getElementById('results').classList.contains('hidden'),
  winner: document.getElementById('winner').textContent,
  rows: [...document.querySelectorAll('#resultList li')].map((li) => li.textContent),
  againVisible: !document.getElementById('btnAgain').classList.contains('hidden'),
  againText: document.getElementById('againWait').classList.contains('hidden') ? '' : document.getElementById('againWait').textContent,
}));
console.log('p1 results:', JSON.stringify(r1));
await p1.screenshot({ path: 'shot-results.png' });

const r2 = await p2.evaluate(() => ({
  resultsVisible: !document.getElementById('results').classList.contains('hidden'),
  againVisible: !document.getElementById('btnAgain').classList.contains('hidden'),
}));
console.log('p2 results:', JSON.stringify(r2));

// реванш
await p1.click('#btnAgain');
await p1.waitForTimeout(1200);
const r3 = await p1.evaluate(() => ({
  hudVisible: !document.getElementById('hud').classList.contains('hidden'),
  resultsVisible: !document.getElementById('results').classList.contains('hidden'),
  timer: document.getElementById('timer').textContent,
}));
console.log('rematch:', JSON.stringify(r3));

console.log('errors:', errors.join(' | ') || '(none)');
await browser.close();
