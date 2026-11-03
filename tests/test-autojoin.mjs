import { chromium } from '/Users/nikita/.nvm/versions/node/v24.14.0/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

const EXE = '/Users/nikita/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = process.env.BASE || 'http://127.0.0.1:3000';

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1280,800'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p1 = await ctx.newPage();
const errors = [];
p1.on('pageerror', (e) => errors.push(e.message));

await p1.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await p1.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p1.fill('#name', 'Хост');
await p1.click('#btnPlay');
await p1.click('#btnCreate');
await p1.waitForSelector('#lobby:not(.hidden)');
const code = (await p1.textContent('#lobbyCode')).trim();

await p1.click('#btnStart');
await p1.waitForTimeout(1500);
console.log('match started');

// второй игрок заходит по ссылке с autojoin прямо в идущий бой
const p2 = await ctx.newPage();
p2.on('pageerror', (e) => errors.push(e.message));
await p2.goto(`${BASE}/?room=${code}&autojoin=1&debug=1`, { waitUntil: 'networkidle' });
await p2.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p2.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden'), { timeout: 15000 });
await p2.waitForTimeout(800);
const joined = await p2.evaluate(() => ({
  screen: window.__egg.S.screen,
  alive: window.__egg.S.me.alive,
  remotes: window.__egg.S.players.size,
  weapon: window.__egg.S.me.weapon,
}));
console.log('autojoin:', JSON.stringify(joined));

// кнопка "застрял" появляется, если смерть затянулась
const stuck = await p2.evaluate(() => {
  const { S, updateHud } = window.__egg;
  S.me.alive = false;
  S.me.deadAt = performance.now() - 6000;
  updateHud();
  return !document.getElementById('btnStuck').classList.contains('hidden');
});
console.log('stuck button visible:', stuck);

console.log('errors:', errors.join(' | ') || '(none)');
await browser.close();
