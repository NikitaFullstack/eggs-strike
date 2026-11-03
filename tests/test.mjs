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
const p2 = await ctx.newPage();
const logs = [];
for (const [name, page] of [['p1', p1], ['p2', p2]]) {
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`[${name} console] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[${name} pageerror] ${e.message}`));
}

await p1.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await p1.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p1.fill('#name', 'Желток');
await p1.click('#btnPlay');
await p1.click('#btnCreate');
await p1.waitForSelector('#lobby:not(.hidden)');
const code = (await p1.textContent('#lobbyCode')).trim();
console.log('room:', code);

const btn = await p1.evaluate(() => {
  const b = document.getElementById('btnStart');
  const cs = getComputedStyle(b);
  return { disabled: b.disabled, bg: cs.backgroundImage.slice(0, 60), opacity: cs.opacity };
});
console.log('start button:', JSON.stringify(btn));

await p2.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await p2.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p2.fill('#name', 'Белок');
await p2.click('#btnPlay');
await p2.fill('#code', code);
await p2.click('#btnJoin');
await p2.waitForSelector('#lobby:not(.hidden)');
await p1.waitForTimeout(300);
console.log('players p1:', await p1.textContent('#playerCount'));
await p1.screenshot({ path: 'shot-lobby2.png' });

await p1.click('#btnStart');
await p1.waitForTimeout(1200);
await p1.evaluate(() => {
  window.__egg.S.locked = true;
  document.getElementById('pause').classList.add('hidden');
});
await p2.evaluate(() => {
  window.__egg.S.locked = true;
  document.getElementById('pause').classList.add('hidden');
});
await p1.waitForTimeout(300);

// проверка движения
const before = await p1.evaluate(() => ({ x: window.__egg.S.me.x, z: window.__egg.S.me.z }));
await p1.keyboard.down('w');
await p1.waitForTimeout(500);
await p1.keyboard.up('w');
const after = await p1.evaluate(() => ({ x: window.__egg.S.me.x, z: window.__egg.S.me.z }));
console.log('movement:', JSON.stringify({ before, after }));
await p1.waitForTimeout(300);

await p1.screenshot({ path: 'shot-p1.png' });
await p2.screenshot({ path: 'shot-p2.png' });

// ставим обоих в известное открытое место и стреляем
await p2.evaluate(async () => {
  const { S } = window.__egg;
  S.me.x = 7; S.me.z = 0; S.me.y = 0;
  S.me.yaw = Math.PI;
  S.me.pitch = 0;
  await new Promise((r) => setTimeout(r, 300));
});

const shootRes = await p1.evaluate(async () => {
  const { S, fire } = window.__egg;
  const me = S.me;
  me.x = 7;
  me.z = 4;
  me.y = 0;
  me.yaw = 0;
  me.pitch = -Math.atan2(1.15 - 0.85, 4);
  await new Promise((r) => setTimeout(r, 400));
  const before = [...S.players.values()].map((v) => ({ hp: v.hp, alive: v.alive }));
  for (let i = 0; i < 6; i++) {
    fire();
    await new Promise((r) => setTimeout(r, 170));
  }
  await new Promise((r) => setTimeout(r, 400));
  return {
    before,
    after: [...S.players.values()].map((v) => ({ hp: v.hp, alive: v.alive })),
    myAmmo: me.ammo,
    feed: [...document.querySelectorAll('#killfeed li')].map((li) => li.textContent),
  };
});
console.log('shoot:', JSON.stringify(shootRes));

await p1.screenshot({ path: 'shot-p1-fight.png' });
await p2.waitForTimeout(300);
await p2.screenshot({ path: 'shot-p2-hit.png' });

const p2state = await p2.evaluate(() => {
  const { S } = window.__egg;
  return {
    hp: S.me.hp,
    alive: S.me.alive,
    deathVisible: !document.getElementById('death').classList.contains('hidden'),
    deathSub: document.getElementById('deathSub').textContent,
  };
});
console.log('p2 state:', JSON.stringify(p2state));

console.log('--- errors ---');
console.log(logs.join('\n') || '(none)');

await browser.close();
