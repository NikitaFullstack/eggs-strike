import { chromium } from '/Users/nikita/.nvm/versions/node/v24.14.0/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

const EXE = '/Users/nikita/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = 'http://127.0.0.1:3000';

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1280,800'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p1 = await ctx.newPage();
const p2 = await ctx.newPage();

await p1.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await p1.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p1.fill('#name', 'Желток');
await p1.click('#btnPlay');
await p1.click('#btnCreate');
await p1.waitForSelector('#lobby:not(.hidden)');
const code = (await p1.textContent('#lobbyCode')).trim();

await p2.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await p2.waitForFunction(() => document.documentElement.dataset.gameReady === '1', { timeout: 60000 });await p2.fill('#name', 'Белок');
await p2.click('#btnPlay');
await p2.fill('#code', code);
await p2.click('#btnJoin');
await p2.waitForSelector('#lobby:not(.hidden)');
await p1.waitForTimeout(300);
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

await p2.evaluate(async () => {
  const { S } = window.__egg;
  S.me.x = 7; S.me.z = 0; S.me.y = 0;
  S.me.yaw = Math.PI;
  S.me.pitch = 0;
  await new Promise((r) => setTimeout(r, 400));
});

await p1.evaluate(async () => {
  const { S } = window.__egg;
  S.me.x = 7; S.me.z = 4; S.me.y = 0;
  S.me.yaw = 0;
  S.me.pitch = -0.09;
  await new Promise((r) => setTimeout(r, 500));
});
await p1.waitForTimeout(500);
await p1.screenshot({ path: 'shot-egg.png' });

// стреляем, ловим смерть второго
await p1.evaluate(async () => {
  const { fire } = window.__egg;
  for (let i = 0; i < 4; i++) {
    fire();
    await new Promise((r) => setTimeout(r, 160));
  }
});
await p2.waitForTimeout(250);
await p2.bringToFront();
await p2.screenshot({ path: 'shot-death.png' });

await browser.close();
