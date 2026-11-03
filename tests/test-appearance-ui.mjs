import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import WebSocket from 'ws';

const base = process.env.BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(), headless: true,
  args: ['--no-sandbox', ...(process.env.EGG_BROWSER_GPU === 'hardware' ? [] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']), '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
let guest;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(base + '/?debug=1');
  await page.waitForFunction(() => !!window.__egg);
  await page.click('#btnCustomize');
  await page.waitForSelector('#wardrobe[open]');
  const option = (field, value) => page.locator(`[data-appearance="${field}"][data-value="${value}"]`);
  await option('color', '#65d6b0').click();
  await option('face', 'wink').click();
  await option('hat', 'crown').click();
  const selected = { color: '#65d6b0', face: 'wink', hat: 'crown' };
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('egg-appearance'))), selected);
  assert.deepEqual(await page.evaluate(() => window.__egg.S.appearance), selected);
  await page.screenshot({ path: '/tmp/egg-wardrobe-desktop.png' });

  // Every rendered hat/face is selectable, including keyboard rotation and dismissal.
  for (const hat of ['none', 'cap', 'beanie', 'crown', 'cowboy', 'chef', 'wizard']) {
    await option('hat', hat).click();
    assert.equal(await option('hat', hat).getAttribute('aria-pressed'), 'true');
  }
  for (const face of ['smile', 'fierce', 'sleepy', 'wink', 'surprised', 'cool']) await option('face', face).click();
  await page.locator('#avatarPreview').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#wardrobe').evaluate(dialog => dialog.open), false);
  assert.equal(await page.locator('#btnCustomize').evaluate(button => document.activeElement === button), true);
  await page.reload(); await page.waitForFunction(() => !!window.__egg);
  assert.deepEqual(await page.evaluate(() => window.__egg.S.appearance), { color: selected.color, face: 'cool', hat: 'wizard' });
  await page.click('#btnCustomize');
  await option('hat', 'chef').click(); await option('face', 'smile').click();
  await page.screenshot({ path: '/tmp/egg-wardrobe-chef.png' });
  await page.setViewportSize({ width: 390, height: 667 });
  await option('hat', 'cowboy').click();
  const modal = await page.locator('#wardrobe').boundingBox();
  assert.ok(modal.x >= 0 && modal.x + modal.width <= 390 && modal.y >= 0 && modal.y + modal.height <= 667, 'Wardrobe fits a phone');
  assert.equal(await page.locator('#wardrobe').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true, 'No horizontal overflow');
  await page.locator('#wardrobe').evaluate(dialog => { dialog.scrollTop = 0; });
  await page.screenshot({ path: '/tmp/egg-wardrobe-mobile.png' });
  await page.click('#btnWardrobeDone');
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.fill('#name', 'Модник'); await page.click('#btnPlay'); await page.click('#btnCreate');
  await page.waitForSelector('#lobby:not(.hidden)');
  await page.waitForFunction(() => window.__egg.S.meta.get(window.__egg.S.id)?.appearance?.hat === 'cowboy');
  const code = await page.locator('#lobbyCode').textContent();
  guest = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
  await new Promise((resolve, reject) => { guest.once('open', resolve); guest.once('error', reject); });
  const messages = [];
  guest.on('message', raw => messages.push(JSON.parse(raw)));
  guest.send(JSON.stringify({ t: 'join', code, name: 'Маг', appearance: { color: '#b69cff', face: 'fierce', hat: 'wizard' } }));
  await page.waitForFunction(() => window.__egg.S.lobbyPlayers.length === 2);
  await page.click('#btnCustomize');
  await option('hat', 'cap').click(); await option('color', '#ff88b0').click();
  await page.click('#btnWardrobeDone');
  await page.waitForFunction(() => window.__egg.S.meta.get(window.__egg.S.id).appearance.hat === 'cap');
  const hostId = await page.evaluate(() => window.__egg.S.id);
  const deadline = Date.now() + 5000;
  while (!messages.some(message => message.t === 'players' && message.players.find(p => p.i === hostId)?.appearance?.color === '#ff88b0')) {
    assert.ok(Date.now() < deadline, 'Room update reaches the other player');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await page.click('#btnStart'); await page.waitForSelector('#hud:not(.hidden)');
  await page.waitForFunction(() => window.__egg.S.players.size === 1);
  assert.deepEqual(await page.evaluate(() => [...window.__egg.S.players.values()][0].avatar.appearance), { color: '#b69cff', face: 'fierce', hat: 'wizard' });
  const remote = await page.evaluate(() => {
    const view = [...window.__egg.S.players.values()][0];
    return { hatParts: view.avatar.hat.children.length, color: '#' + view.body.material.color.getHexString(), scale: view.group.scale.toArray(), collision: window.__egg.S.arena.playerCollision };
  });
  assert.ok(remote.hatParts > 0, 'The network appearance creates a real 3D hat');
  assert.equal(remote.color, '#b69cff');
  assert.deepEqual(remote.scale, [remote.collision.radius / .5, remote.collision.height / 1.32, remote.collision.radius / .5], 'Cosmetics keep the combat body scale');
  await page.click('#btnPauseLobby'); await page.waitForSelector('#lobby:not(.hidden)');
  await page.click('#btnCustomize'); await option('hat', 'crown').click(); await page.click('#btnWardrobeDone');
  await page.click('#btnResumeMatch'); await page.waitForSelector('#hud:not(.hidden)');
  await page.waitForFunction(() => window.__egg.S.meta.get(window.__egg.S.id).appearance.hat === 'crown');
  guest.close();
  await page.waitForFunction(() => window.__egg.S.players.size === 0);
  assert.deepEqual(errors, []);
  console.log('PASS: appearance UI, live 3D preview, saved choices, keyboard, mobile, peer sync, match model and room/resume');
  await page.close();

  // Privacy settings can deny even reading the localStorage property. The full
  // game must still boot, keep a costume in memory and join a real match.
  const blocked = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  blocked.on('pageerror', error => errors.push(error.message));
  await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', {
    configurable: true, get() { throw new DOMException('Storage is disabled', 'SecurityError'); },
  }));
  await blocked.goto(base + '/?debug=1');
  await blocked.waitForFunction(() => !!window.__egg);
  assert.equal(await blocked.evaluate(() => window.__egg.settings.sens), 1);
  await blocked.click('#btnCustomize');
  await blocked.click('[data-appearance="hat"][data-value="chef"]');
  await blocked.click('#btnWardrobeDone');
  assert.equal(await blocked.evaluate(() => window.__egg.S.appearance.hat), 'chef');
  await blocked.fill('#name', 'Без сохранения');
  await blocked.click('#btnPlay'); await blocked.click('#btnCreate');
  await blocked.waitForSelector('#lobby:not(.hidden)');
  await blocked.click('#btnStart'); await blocked.waitForSelector('#hud:not(.hidden)');
  assert.equal(await blocked.evaluate(() => window.__egg.S.meta.get(window.__egg.S.id).appearance.hat), 'chef');
  assert.deepEqual(errors, []);
  console.log('PASS: blocked browser storage still permits boot, in-memory customization and a real match');
} finally { guest?.terminate(); await browser.close(); }
