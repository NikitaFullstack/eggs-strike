import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(),
  headless: true, args: ['--no-sandbox',...(process.env.EGG_BROWSER_GPU === 'hardware' ? [] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'])],
});
const base = process.env.BASE || 'http://127.0.0.1:3160';
try {
  const context = await browser.newContext({viewport:{width:1280,height:800}});
  await context.route(/^https:\/\/(cdn.jsdelivr.net|esm.sh)\//, route => route.abort());
  const page = await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const removed = ['МАЛЕНЬКИЕ ЯЙЦА','БОЛЬШОЙ ХАОС','ТВОЙ СЛЕДУЮЩИЙ РАУНД','Скорлупа крепче','Ставки выше','Устрой переполох','БЫСТРЫЙ СТАРТ','В бой с друзьями','СОБИРАЕМ ОТРЯД','Все свои','Все против всех','выбери место встречи','ОРИГИНАЛЬНЫЙ РЕЦЕПТ','НЕ ДАЙ СЕБЯ РАЗБИТЬ','ВЫБЕРИ СВОЮ АРЕНУ'];
  async function checkCopy() {
    const text=await page.locator('body').innerText();
    assert.deepEqual(removed.filter(phrase=>text.includes(phrase)),[],'Decorative slogans are absent from the visible game');
  }
  await page.goto(base+'/?debug=1');
  await page.waitForFunction(()=>!!window.__egg);
  await checkCopy();
  await page.fill('#name','Игрок');
  assert.equal(await page.locator('#characterLabel').innerText(),'Игрок','Character label contains only the player name');
  assert.deepEqual(await page.locator('#menuMaps .map-card-copy strong').allTextContents(),['Курятник','Полигон','Холодильник','Кухня'],'All four maps are available with clear names');
  await page.screenshot({path:'/tmp/egg-copy-menu.png'});
  await page.click('#btnPlay'); await page.click('#btnCreate');
  await page.waitForSelector('#lobby:not(.hidden)');
  await checkCopy();
  assert.match(await page.locator('#lobbyCode').textContent(),/^[A-Z0-9]{4}$/);
  assert.equal(await page.locator('#btnLeave').isVisible(),true);
  await page.screenshot({path:'/tmp/egg-copy-room.png'});
  await page.click('#btnStart');
  await page.waitForSelector('#hud:not(.hidden)');
  assert.equal(await page.getByRole('button',{name:'Выйти из игры',exact:true}).isVisible(),true);
  await page.click('#btnPauseLobby');
  await page.waitForSelector('#lobby:not(.hidden)');
  await page.setViewportSize({width:800,height:600});
  await page.locator('#btnResumeMatch').click({trial:true,timeout:3000});
  await page.setViewportSize({width:390,height:844});
  await checkCopy();
  const maps=await page.locator('#roomMaps').boundingBox(),controls=await page.locator('.room-controls').boundingBox();
  assert.ok(maps.y>=controls.y+controls.height,'Four map cards must not cover the room controls on mobile');
  await page.screenshot({path:'/tmp/egg-copy-mobile.png'});
  await page.click('#btnLeave');
  await page.waitForSelector('#menu:not(.hidden)');
  await page.waitForFunction(()=>document.documentElement.dataset.gameReady==='1');
  assert.equal(new URL(page.url()).searchParams.has('room'),false);
  await checkCopy();
  assert.deepEqual(errors,[]);
  console.log('PASS: concise menu and room, player name, four maps, create/start/return/exit, mobile layout');
} finally { await browser.close(); }
