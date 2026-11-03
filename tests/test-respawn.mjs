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
const errors = [];
for (const [n, p] of [['p1', p1], ['p2', p2]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n} console: ${m.text()}`); });
}

await p1.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await p1.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p1.fill('#name', 'Стрелок');
await p1.click('#btnPlay');
await p1.click('#btnCreate');
await p1.waitForSelector('#lobby:not(.hidden)');
const code = (await p1.textContent('#lobbyCode')).trim();

await p2.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await p2.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p2.fill('#name', 'Мишень');
await p2.click('#btnPlay');
await p2.fill('#code', code);
await p2.click('#btnJoin');
await p2.waitForSelector('#lobby:not(.hidden)');
await p2.waitForTimeout(300);
await p1.click('#btnStart');
await p1.waitForTimeout(1200);

for (const p of [p1, p2]) {
  await p.evaluate(() => {
    window.__egg.S.locked = true;
    document.getElementById('pause').classList.add('hidden');
  });
}

await p2.evaluate(async () => {
  const { S } = window.__egg;
  S.me.x = 7; S.me.z = 0; S.me.y = 0; S.me.yaw = Math.PI; S.me.pitch = 0;
  await new Promise((r) => setTimeout(r, 300));
});

await p1.evaluate(async () => {
  const { S, fire } = window.__egg;
  S.me.x = 7; S.me.z = 4; S.me.y = 0; S.me.yaw = 0;
  S.me.pitch = -Math.atan2(0.3, 4);
  await new Promise((r) => setTimeout(r, 400));
  for (let i = 0; i < 4; i++) { fire(); await new Promise((r) => setTimeout(r, 170)); }
});

await p2.waitForTimeout(300);
const deadInfo = await p2.evaluate(() => ({
  alive: window.__egg.S.me.alive,
  deathVisible: !document.getElementById('death').classList.contains('hidden'),
  sub: document.getElementById('deathSub').textContent,
  x: window.__egg.S.me.x, z: window.__egg.S.me.z,
}));
console.log('after death:', JSON.stringify(deadInfo));

await p2.waitForTimeout(3800);

const aliveInfo = await p2.evaluate(() => ({
  alive: window.__egg.S.me.alive,
  deathVisible: !document.getElementById('death').classList.contains('hidden'),
  pauseVisible: !document.getElementById('pause').classList.contains('hidden'),
  hp: window.__egg.S.me.hp,
  x: window.__egg.S.me.x, z: window.__egg.S.me.z,
}));
console.log('after 4s:', JSON.stringify(aliveInfo));

const before = await p2.evaluate(() => ({ x: window.__egg.S.me.x, z: window.__egg.S.me.z }));
await p2.keyboard.down('w');
await p2.waitForTimeout(600);
await p2.keyboard.up('w');
const after = await p2.evaluate(() => ({ x: window.__egg.S.me.x, z: window.__egg.S.me.z }));
console.log('movement after respawn:', JSON.stringify({ before, after }));

const p1sees = await p1.evaluate(() => {
  const v = [...window.__egg.S.players.values()][0];
  return { alive: v && v.alive, visible: v && v.group.visible };
});
console.log('p1 sees victim:', JSON.stringify(p1sees));

await p2.screenshot({ path: 'shot-respawn.png' });
console.log('errors:', errors.join(' | ') || '(none)');
await browser.close();
