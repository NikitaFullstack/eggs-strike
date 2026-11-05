import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(), headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/?debug=1');
  await page.waitForFunction(() => !!window.__egg);
  assert.equal(await page.getByLabel('Соперники').inputValue(), '2');
  await page.getByLabel('Соперники').selectOption('1');
  assert.equal(await page.getByLabel('Соперники').inputValue(), '1');
  await page.getByLabel('Соперники').selectOption('2');
  await page.click('#btnPlay');
  assert.equal(await page.locator('.practice-row').isVisible(), false, 'Practice controls do not crowd the room menu');
  await page.click('#btnPlayBack');
  await page.locator('#menuMaps [data-map="training_grounds"]').click();
  await page.fill('#name', 'Тренировка');
  await page.click('#btnPractice');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 20000 });
  await page.waitForFunction(() => window.__egg.S.players.size === 2, null, { timeout: 10000 });
  const state = await page.evaluate(() => ({
    map: window.__egg.S.arena.id,
    name: document.getElementById('mapName').textContent,
    remotes: [...window.__egg.S.players.values()].map(view => window.__egg.S.meta.get(view.id)?.name),
    lobby: window.__egg.S.lobbyPlayers.filter(player => player.bot).length,
  }));
  assert.equal(state.map, 'training_grounds');
  assert.equal(state.name, 'Полигон');
  assert.equal(state.remotes.length, 2, 'Two bot views are rendered');
  assert.ok(state.remotes.every(name => name?.startsWith('Бот')));
  assert.equal(state.lobby, 2, 'Both bots are in the match roster');
  assert.match(await page.locator('#practiceBadge').textContent(), /2 бота/);
  assert.equal(await page.locator('#practiceBadge').isVisible(), true, 'Practice badge explains why bots are present');
  const nearest = await page.evaluate(() => Math.min(...[...window.__egg.S.players.values()].map(view => Math.hypot(view.group.position.x - window.__egg.S.me.x, view.group.position.z - window.__egg.S.me.z))));
  assert.ok(nearest < 16, `Bots spawn near the player, nearest ${nearest.toFixed(1)} m`);
  await page.click('#btnResumeGame');
  await page.waitForFunction(() => window.__egg.S.locked);
  const ammo = await page.evaluate(() => window.__egg.S.me.ammo[window.__egg.S.me.weapon]);
  await page.mouse.move(640, 400);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => window.__egg.S.me.ammo[window.__egg.S.me.weapon]), ammo - 1, 'A quick click produces only one shot');
  await page.mouse.down();
  await page.waitForFunction(initial => window.__egg.S.me.ammo[window.__egg.S.me.weapon] < initial - 2, ammo, {timeout: 6000});
  await page.mouse.up();
  const afterHold = await page.evaluate(() => window.__egg.S.me.ammo[window.__egg.S.me.weapon]);
  assert.ok(afterHold < ammo - 2, 'Holding an automatic weapon fires a burst');
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => window.__egg.S.me.ammo[window.__egg.S.me.weapon]), afterHold, 'Firing stops when the button is released');
  await page.screenshot({ path: '/tmp/egg-practice-ui.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: practice button starts the selected map with two server bots rendered in the HUD');
} finally { await browser.close(); }
