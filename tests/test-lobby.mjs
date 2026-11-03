import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:3100';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(),
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
const link = await p1.inputValue('#lobbyLink');
console.log('code:', code, 'link:', link);

// второй игрок: сохраняем имя и заходим по ссылке — должен попасть сразу в лобби
const p2 = await ctx.newPage();
p2.on('pageerror', (e) => errors.push(e.message));
await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p2.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p2.evaluate(() => localStorage.setItem('egg-name', 'Гость'));
await p2.goto(`${BASE}/?room=${code}`, { waitUntil: 'networkidle' });
await p2.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p2.waitForSelector('#lobby:not(.hidden)', { timeout: 10000 });
console.log('autojoin lobby:', await p2.evaluate(() => document.getElementById('lobbyCode').textContent.trim()));
console.log('p2 player count:', await p1.textContent('#playerCount'));

await p1.waitForTimeout(300);
await p1.click('#btnStart');
await p1.waitForSelector('#hud:not(.hidden)');
console.log('match running');
await p1.waitForTimeout(8600);

const results = await p1.evaluate(() => !document.getElementById('results').classList.contains('hidden'));
console.log('results visible:', results);

await p1.click('#btnToLobby');
await p1.waitForTimeout(600);
const back = await p1.evaluate(() => ({
  lobby: !document.getElementById('lobby').classList.contains('hidden'),
  code: document.getElementById('lobbyCode').textContent.trim(),
  players: document.getElementById('playerCount').textContent,
  startVisible: !document.getElementById('btnStart').classList.contains('hidden'),
}));
console.log('back to lobby:', JSON.stringify(back));

await p1.click('#btnStart');
await p1.waitForTimeout(1200);
const restarted = await p1.evaluate(() => ({
  hud: !document.getElementById('hud').classList.contains('hidden'),
  timer: document.getElementById('timer').textContent,
}));
console.log('restart from lobby:', JSON.stringify(restarted));

console.log('errors:', errors.join(' | ') || '(none)');
await browser.close();
