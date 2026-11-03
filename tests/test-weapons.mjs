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

// ставим в открытое место
await p2.evaluate(async () => {
  const { S } = window.__egg;
  S.me.x = 7; S.me.z = 0; S.me.y = 0; S.me.yaw = Math.PI; S.me.pitch = 0;
  await new Promise((r) => setTimeout(r, 300));
});
await p1.evaluate(async () => {
  const { S } = window.__egg;
  S.me.x = 7; S.me.z = 4; S.me.y = 0; S.me.yaw = 0;
  S.me.pitch = -Math.atan2(0.3, 4);
  await new Promise((r) => setTimeout(r, 400));
});
await p1.waitForTimeout(300);

const initial = await p1.evaluate(() => {
  const { S } = window.__egg;
  return {
    weapons: Object.keys(S.weapons || {}),
    slots: S.slots,
    weapon: S.me.weapon,
    ammo: S.me.ammo,
    slotCount: document.querySelectorAll('.weapon-slot').length,
    activeShort: document.querySelector('.weapon-slot.active .wn')?.textContent,
    hpBar: [...S.players.values()][0]?.hpBar?.userData.hp,
  };
});
console.log('initial:', JSON.stringify(initial));
await p1.screenshot({ path: 'shot-weapons.png' });

// дробовик
const shotgun = await p1.evaluate(async () => {
  const { S, switchWeapon, fire } = window.__egg;
  switchWeapon('shot');
  await new Promise((r) => setTimeout(r, 250));
  const ammoBefore = S.me.ammo.shot;
  fire();
  await new Promise((r) => setTimeout(r, 500));
  return {
    weapon: S.me.weapon,
    ammoBefore,
    ammoAfter: S.me.ammo.shot,
    remoteHp: [...S.players.values()][0]?.hp,
    hpBar: [...S.players.values()][0]?.hpBar?.userData.hp,
    active: document.querySelector('.weapon-slot.active .wn')?.textContent,
  };
});
console.log('shotgun:', JSON.stringify(shotgun));

// снайперка
const sniper = await p1.evaluate(async () => {
  const { S, switchWeapon, fire, setZoom } = window.__egg;
  switchWeapon('awp');
  setZoom(true);
  await new Promise((r) => setTimeout(r, 300));
  const zoomFov = S.me.zoom;
  for (let i = 0; i < 4; i++) { fire(); await new Promise((r) => setTimeout(r, 600)); }
  await new Promise((r) => setTimeout(r, 400));
  setZoom(false);
  return {
    weapon: S.me.weapon,
    ammo: S.me.ammo.awp,
    remoteAlive: [...S.players.values()][0]?.alive,
    zoomWas: zoomFov,
    feed: [...document.querySelectorAll('#killfeed li')].map((li) => li.textContent),
  };
});
console.log('sniper:', JSON.stringify(sniper));

// ручная перезарядка
const reload = await p1.evaluate(async () => {
  const { S, switchWeapon, fire, startReload } = window.__egg;
  switchWeapon('usp');
  await new Promise((r) => setTimeout(r, 200));
  for (let i = 0; i < 3; i++) { fire(); await new Promise((r) => setTimeout(r, 220)); }
  const afterShots = S.me.ammo.usp;
  startReload();
  const reloading = S.me.reloading;
  await new Promise((r) => setTimeout(r, 2200));
  return {
    afterShots,
    reloading,
    reloaded: S.me.ammo.usp,
    stillReloading: S.me.reloading,
  };
});
console.log('reload:', JSON.stringify(reload));

await p1.waitForTimeout(500);
await p1.screenshot({ path: 'shot-sniper.png' });
console.log('errors:', errors.join(' | ') || '(none)');
await browser.close();
