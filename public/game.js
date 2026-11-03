const ArenaGeometry = globalThis.EggArenaGeometry;
const LEVEL_DATA = await fetch('./henhouse_ffa_level.json').then(r=>{if(!r.ok)throw Error('Level JSON unavailable');return r.json();});
const DEFAULT_ARENA = EggHenhouse.build(LEVEL_DATA);

// Imported geometry and collision helpers share one local Three.js instance.
const THREE = await import('./vendor/three.module.js');
const [{ Octree }, { Capsule }, TRAINING_MAP, TRAINING_SCENE] = await Promise.all([
  import('./vendor/Octree.js'), import('./vendor/Capsule.js'),
  fetch('./maps/training/map.json').then(r => { if (!r.ok) throw Error('Map unavailable'); return r.json(); }),
  fetch('./maps/training/scene.json').then(r => { if (!r.ok) throw Error('Map geometry unavailable'); return r.json(); }),
]);
const TRAINING_TEXTURE = await new THREE.TextureLoader().loadAsync(TRAINING_MAP.texture);
TRAINING_TEXTURE.colorSpace = THREE.SRGBColorSpace;
TRAINING_TEXTURE.flipY = false;
ArenaGeometry.registerMesh(TRAINING_MAP.id, EggMeshWorld.collision(THREE, Octree, Capsule, TRAINING_SCENE, TRAINING_MAP));

const $ = (id) => document.getElementById(id);
const canvas = $('game');

/* ============================ состояние ============================ */

const S = {
  screen: 'menu',
  id: null,
  code: null,
  hostId: null,
  arena: null,
  mapId: DEFAULT_ARENA.id,
  roomState: 'lobby',
  meta: new Map(),      // id -> {name, color}
  players: new Map(),   // id -> remote view
  lobbyPlayers: [],
  timeLeft: 300,
  snapshotAt: 0,
  snapshotReceived: 0,
  viewTime: 0,
  locked: false,
  keys: Object.create(null),
  me: {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vy: 0, onGround: true,
    hp: 100, alive: true, kills: 0, deaths: 0,
    energy: 100, sprinting: false, sprintExhausted: false,
    grenades: 2, grenadeReadyAt: 0, grenadeThrowAt: 0,
    ammo: {}, weapon: null, reloading: false, reloadEnd: 0, reloadWeapon: null,
    lastShot: 0, deadUntil: 0, deadAt: 0, zoom: false, aiming: false, respawnAsked: false,
    stepTimer: 0, wasAir: false,
  },
  weapons: null,
  slots: [],
  firing: false,
  results: null,
};

let ws = null;
let connectPromise = null;
let recoil = 0;
let jumpQueued = false;
let combat = null;
let grenadeEffects = null;
let muzzleUntil = 0;
const soundTimers = new Set();
let ambientAt = 0;
let aimBlend = 0;
let bobTime = 0;
let moving = false;
let clock = 0;

/* ============================ сеть ============================ */

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connectPromise) return connectPromise;

  connectPromise = new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let sock;
    try {
      sock = new WebSocket(`${proto}://${location.host}/ws`);
    } catch (e) {
      return reject(new Error('Не удалось открыть соединение'));
    }
    ws = sock;
    const timer = setTimeout(() => reject(new Error('Сервер не отвечает')), 8000);

    sock.onopen = () => { clearTimeout(timer); resolve(); };
    sock.onerror = () => { clearTimeout(timer); reject(new Error('Не удалось подключиться к серверу')); };
    sock.onclose = () => {
      clearTimeout(timer);
      ws = null;
      connectPromise = null;
      clearMenuBusy();
      if (S.screen === 'lobby' || S.screen === 'hud') {
        showMenu('Связь с сервером потеряна. Обнови страницу.');
      }
    };
    sock.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage(msg);
    };
  });

  connectPromise.catch(() => { connectPromise = null; });
  return connectPromise;
}

function onMessage(msg) {
  switch (msg.t) {
    case 'joined': {
      clearMenuBusy();
      S.id = msg.id;
      S.code = msg.code;
      S.hostId = msg.hostId;
      S.arena = msg.arena;
      S.mapId = msg.mapId || msg.arena.id;
      $('lobbyCode').textContent = msg.code;
      const linkInput = $('lobbyLink');
      if (linkInput) linkInput.value = `${location.origin}/?room=${msg.code}`;
      try {
        const url = new URL(location.href);
        url.searchParams.set('room', msg.code);
        history.replaceState(null, '', url);
      } catch { /* ignore */ }
      show('lobby');
      break;
    }
    case 'players': {
      S.hostId = msg.hostId;
      S.lobbyPlayers = msg.players;
      S.mapId = msg.mapId || S.mapId;
      S.roomState = msg.state;
      for (const p of msg.players) S.meta.set(p.i, { name: p.n, color: p.c });
      if (S.screen === 'lobby') renderLobbyPlayers();
      break;
    }
    case 'start': startGame(msg); break;
    case 's': onSnapshot(msg); break;
    case 'hit': if (S.screen === 'hud') onHit(msg); break;
    case 'kill': if (S.screen === 'hud') onKill(msg); break;
    case 'shot': if (S.screen === 'hud') onShot(msg); break;
    case 'grenade': if (S.screen === 'hud') onGrenade(msg); break;
    case 'explosion': if (S.screen === 'hud') onExplosion(msg); break;
    case 'respawn': onRespawn(msg); break;
    case 'end': onEnd(msg); break;
    case 'error': {
      if (S.screen === 'lobby') $('lobbyMsg').textContent = msg.msg;
      else showMenu(msg.msg);
      break;
    }
  }
}

/* ============================ интерфейс ============================ */

function show(screen) {
  if (screen !== 'hud') { clearCombat(); grenadeEffects?.clear(); }
  S.screen = screen;
  for (const id of ['menu', 'lobby', 'hud', 'results']) {
    $(id).classList.toggle('hidden', id !== screen);
  }
  $('lobbyShowcase').classList.toggle('hidden', screen !== 'menu' && screen !== 'lobby');
  $('menuMaps').classList.toggle('hidden', screen !== 'menu');
  $('roomMaps').classList.toggle('hidden', screen !== 'lobby');
  updateLobbyIdentity();
  renderMapSelection();
}

function showMenu(text) {
  show('menu');
  $('menuMsg').textContent = text || '';
  if (document.pointerLockElement) document.exitPointerLock();
}

function renderLobbyPlayers() {
  const list = $('playerList');
  list.innerHTML = '';
  for (const p of S.lobbyPlayers) {
    const li = document.createElement('li');

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.c;
    dot.style.color = p.c;

    const name = document.createElement('span');
    name.textContent = p.n;

    li.append(dot, name);

    if (p.i === S.id) {
      const you = document.createElement('span');
      you.className = 'you-tag';
      you.textContent = 'ты';
      li.append(you);
    }
    if (p.i === S.hostId) {
      const host = document.createElement('span');
      host.className = 'host-tag';
      host.textContent = 'хост';
      li.append(host);
    }
    list.append(li);
  }

  $('playerCount').textContent = `${S.lobbyPlayers.length}/${LEVEL_DATA.players.max}`;
  const isHost = S.id === S.hostId;
  const playing = S.roomState === 'playing';
  $('btnStart').classList.toggle('hidden', !isHost || playing);
  $('btnResumeMatch').classList.toggle('hidden', !playing);
  $('lobbyWait').classList.toggle('hidden', isHost || playing);
  $('btnStart').disabled = S.lobbyPlayers.length === 0;
  updateLobbyIdentity();
  renderMapSelection();
}

const MAP_OPTIONS = [{ id: LEVEL_DATA.mapId, name: LEVEL_DATA.displayName }, TRAINING_MAP];

function initMapSelection() {
  for (const containerId of ['menuMaps', 'roomMaps']) {
    for (const map of MAP_OPTIONS) {
      const button = document.createElement('button');
      button.className = 'map-card';
      button.dataset.map = map.id;
      button.setAttribute('aria-label', map.name);
      button.innerHTML = `<img src="${map.preview || 'data:image/svg+xml,'+encodeURIComponent(EggHenhouse.preview(LEVEL_DATA))}" alt="" /><span class="map-check" aria-hidden="true">✓</span><span class="map-card-copy"><strong>${map.name}</strong></span>`;
      button.addEventListener('click', () => {
        if (S.screen === 'menu') {
          S.mapId = map.id;
          renderMapSelection();
        } else if (S.id === S.hostId) {
          send({ t: 'map', id: map.id });
        }
      });
      $(containerId).append(button);
    }
  }
  renderMapSelection();
}

function renderMapSelection() {
  for (const button of document.querySelectorAll('.map-card')) {
    button.setAttribute('aria-pressed', String(button.dataset.map === S.mapId));
    button.disabled = S.screen === 'lobby' && (S.id !== S.hostId || S.roomState === 'playing');
  }
  $('mapHint').textContent = S.mapId === TRAINING_MAP.id ? '69 × 69 м' : '';
}

function updateLobbyIdentity() {
  const me = S.lobbyPlayers.find(p => p.i === S.id);
  $('characterName').textContent = S.screen === 'lobby' && me ? me.n : ($('name').value.trim() || 'Яйцо');
  if (lobbyEgg) {
    const body = lobbyEgg.children[0];
    body.material.color.set(S.screen === 'lobby' && me ? me.c : '#ffd23f');
  }
}

function readName() {
  const raw = $('name').value.trim();
  const name = raw || 'Яйцо';
  try { localStorage.setItem('egg-name', name); } catch { /* ignore */ }
  return name;
}

let busyTimer = null;

function setMenuBusy(btn, text) {
  if (!btn) return;
  btn.dataset.old = btn.textContent;
  btn.disabled = true;
  btn.textContent = text;
}

function clearMenuBusy() {
  clearTimeout(busyTimer);
  for (const id of ['btnCreate', 'btnJoin']) {
    const b = $(id);
    if (!b) continue;
    b.disabled = false;
    if (b.dataset.old) {
      b.textContent = b.dataset.old;
      delete b.dataset.old;
    }
  }
}

function startBusyTimeout() {
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => {
    clearMenuBusy();
    $('menuMsg').textContent = 'Сервер не отвечает. Проверь соединение и попробуй ещё раз.';
  }, 9000);
}

async function createRoom() {
  const name = readName();
  $('menuMsg').textContent = '';
  setMenuBusy($('btnCreate'), 'Создаём комнату…');
  startBusyTimeout();
  try {
    await connect();
    send({ t: 'create', name, mapId: S.mapId });
  } catch (e) {
    clearMenuBusy();
    $('menuMsg').textContent = e.message;
  }
}

async function joinRoom() {
  const name = readName();
  const code = $('code').value.trim().toUpperCase();
  $('menuMsg').textContent = '';
  if (code.length !== 4) {
    $('menuMsg').textContent = 'Код комнаты — 4 символа';
    return;
  }
  setMenuBusy($('btnJoin'), 'Входим…');
  startBusyTimeout();
  try {
    await connect();
    send({ t: 'join', name, code });
  } catch (e) {
    clearMenuBusy();
    $('menuMsg').textContent = e.message;
  }
}

/* ============================ three.js ============================ */

let renderer = null;
let scene = null;
let camera = null;
let vmScene = null;
let vmCamera = null;
let viewGun = null;
let muzzle = null;
let arenaGroup = null;
let levelView = null;
const worldMeshes = [];

function readNum(key, fallback, min, max) {
  const v = parseFloat(localStorage.getItem(key));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

const SETTINGS = {
  sens: readNum('egg-sens', 1, 0.2, 3),
  ads: readNum('egg-ads', 0.55, 0.2, 1.5),
};

const QUALITY = {
  maxDpr: 1,
  scale: 1,
};

let fpsFrames = 0;
let fpsTime = 0;
let fpsSamples = 0;
let fpsValue = 0;
let lowStreak = 0;
let highStreak = 0;
let fpsVisible = localStorage.getItem('egg-fps') !== '0';

function initRenderer() {
  if (renderer) return;
  initGunTextures();
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  applyResolution();
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
}

function initThree(arena) {
  initRenderer();

  scene = new THREE.Scene();
  combat = EggCombat.create(THREE, scene);
  grenadeEffects = EggGrenadeEffects.create(THREE, scene);
  scene.background = new THREE.Color(arena.theme.sky);
  scene.fog = new THREE.Fog(arena.theme.fog, arena.half * 2, arena.half * 6);

  camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 240);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  vmScene = new THREE.Scene();
  vmCamera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 10);
  vmScene.add(vmCamera);
  vmScene.add(new THREE.HemisphereLight(0xfff3dd, 0x675846, 1.7));
  const vmLight = new THREE.DirectionalLight(0xffecd2, 1.5);
  vmLight.position.set(0.6, 1.2, 0.9);
  vmScene.add(vmLight);

  const hemi = new THREE.HemisphereLight(0xfff4df, 0x7a6749, 1.2);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe1a0, 1.85);
  sun.position.set(arena.half * .9, arena.half * 1.8, arena.half * .7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -arena.half * 1.8;
  sun.shadow.camera.right = arena.half * 1.8;
  sun.shadow.camera.top = arena.half * 1.8;
  sun.shadow.camera.bottom = -arena.half * 1.8;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = arena.half * 6;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = .025;
  sun.shadow.radius = 2;
  scene.add(sun);

  arenaGroup = new THREE.Group();
  scene.add(arenaGroup);
  buildArena(arena || S.arena);
  buildViewmodel();

  // тени считаем один раз: арена статична, яйца получат дешёвые блобы
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  // Resize is registered once for both the lobby and arena below.
}

let lobbyScene = null;
let lobbyCamera = null;
let lobbyEgg = null;
let lobbyTime = 0;

function initLobby() {
  initRenderer();
  if (!renderer || lobbyScene) return;
  initGunTextures();

  lobbyScene = new THREE.Scene();
  lobbyScene.background = new THREE.Color(0x101b1e);
  lobbyScene.fog = new THREE.Fog(0x101b1e, 12, 32);
  lobbyCamera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 70);
  lobbyScene.add(new THREE.HemisphereLight(0xd9ede6, 0x152825, 2.1));

  const key = new THREE.DirectionalLight(0xffedc3, 3.1);
  key.position.set(2, 5, 5);
  lobbyScene.add(key);
  const rim = new THREE.DirectionalLight(0x91c8ca, 2.3);
  rim.position.set(-4, 3, -3);
  lobbyScene.add(rim);

  const metal = new THREE.MeshStandardMaterial({ color: 0x243234, roughness: 0.6, metalness: 0.5 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x172628 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xd9ff56 });
  const box = (w, h, d, x, y, z, mat = metal) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    lobbyScene.add(m);
    return m;
  };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), metal);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.36;
  lobbyScene.add(floor);
  const grid = new THREE.GridHelper(60, 30, 0x405552, 0x293b3b);
  grid.position.y = -0.35;
  lobbyScene.add(grid);
  box(24, 8, .3, 0, 3, -7, dark);
  for (let x = -12; x <= 12; x += 3) {
    box(.08, 8, .12, x, 3, -6.8);
    box(1.8, .045, .04, x, 3.8, -6.6, glow);
  }
  for (const x of [-6, 6]) {
    box(.25, 9, .3, x, 3, -4);
    box(.045, 4.5, .04, x + .15, 2.5, -3.82, glow);
  }
  for (const [x,z,w,h] of [[-4,-3,1.7,1.3],[-5.6,-4.5,1.5,2.1],[4,-4,2,1.2]]) {
    box(w,h,1.4,x,h/2-.35,z,dark);
    box(w+.03,.06,1.43,x,h-.4,z,metal);
  }
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, .3, 64), metal);
  platform.position.y = -.16;
  lobbyScene.add(platform);
  for (const [radius, opacity] of [[1.6, 1], [1.82, .3], [2.25, .12]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .018, 8, 96), new THREE.MeshBasicMaterial({ color: 0xd9ff56, transparent: true, opacity }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = radius === 1.6 ? .005 : -.32;
    lobbyScene.add(ring);
  }
  const blob = makeBlobShadow();
  blob.scale.set(1.8, 1.8, 1);
  blob.position.y = .012;
  lobbyScene.add(blob);

  lobbyEgg = makeEgg('#ffd23f').group;
  lobbyEgg.scale.setScalar(1.6);
  lobbyEgg.rotation.y = Math.PI - .25;
  lobbyScene.add(lobbyEgg);
  onResize();
}

function renderLobby(dt) {
  if (!renderer || !lobbyScene || !lobbyCamera) return;
  lobbyTime += dt;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (lobbyEgg) {
    lobbyEgg.position.y = reduced ? 0 : Math.sin(lobbyTime * 1.7) * .015;
    lobbyEgg.rotation.y = Math.PI - .25 + (reduced ? 0 : Math.sin(lobbyTime * .5) * .12);
  }
  const mobile = window.innerWidth <= 760;
  if (mobile) {
    lobbyCamera.position.set(.6, 2.3, 14);
    lobbyCamera.lookAt(0, -1.8, 0);
  } else {
    lobbyCamera.position.set(3.5, 2.8, 8.0);
    lobbyCamera.lookAt(1.1, .6, 0);
  }
  renderer.render(lobbyScene, lobbyCamera);
}

function onResize() {
  if (!renderer) return;
  if (camera) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  if (vmCamera) {
    vmCamera.aspect = window.innerWidth / window.innerHeight;
    vmCamera.updateProjectionMatrix();
  }
  if (lobbyCamera) {
    lobbyCamera.aspect = window.innerWidth / window.innerHeight;
    lobbyCamera.updateProjectionMatrix();
  }
  applyResolution();
}

function applyResolution() {
  if (!renderer) return;
  const dpr = Math.min(window.devicePixelRatio || 1, QUALITY.maxDpr) * QUALITY.scale;
  renderer.setPixelRatio(Math.max(0.5, dpr));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

window.addEventListener('resize', onResize);

function makeSky(theme) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  const sky = new THREE.Color(theme.sky);
  grad.addColorStop(0, '#' + sky.clone().multiplyScalar(.6).getHexString());
  grad.addColorStop(.5, '#' + sky.getHexString());
  grad.addColorStop(1, '#' + sky.clone().lerp(new THREE.Color(0xffffff), .3).getHexString());
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const skip = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skip);
  mesh.position.y = -6;
  return mesh;
}

function makeClouds() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false });
  for (let i = 0; i < 8; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + ((Math.random() * 2) | 0);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(5 + Math.random() * 4, 12, 8), mat);
      puff.position.set((j - puffs / 2) * 8, Math.random() * 3, Math.random() * 5);
      puff.scale.y = 0.5;
      cloud.add(puff);
    }
    const a = Math.random() * Math.PI * 2;
    const r = 75 + Math.random() * 55;
    cloud.position.set(Math.cos(a) * r, 24 + Math.random() * 20, Math.sin(a) * r);
    group.add(cloud);
  }
  return group;
}

function buildArena(arena) {
  arenaGroup.add(makeSky(arena.theme));
  arenaGroup.add(makeClouds());
  levelView = arena.mesh
    ? EggMeshWorld.build(THREE, TRAINING_SCENE, TRAINING_TEXTURE, arenaGroup, worldMeshes, arena)
    : globalThis.EggCoopWorld.build(THREE, arena, arenaGroup, worldMeshes);
}

const DEFAULT_WEAPON_IDS = ['ak', 'm4', 'shot', 'awp', 'usp', 'deagle'];
const gunModels = {};
let muzzleZ = -0.6;


let GUN_TEX = null;

function makeMetalTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');

  g.fillStyle = '#b9bec9';
  g.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 200; i++) {
    const y = Math.random() * 256;
    g.strokeStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y + Math.random() * 2 - 1);
    g.stroke();
  }

  for (let i = 0; i < 100; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    g.strokeStyle = `rgba(28,32,42,${0.05 + Math.random() * 0.13})`;
    g.lineWidth = Math.random() < 0.8 ? 1 : 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.random() * 44 - 22, y + Math.random() * 6 - 3);
    g.stroke();
  }

  for (let i = 0; i < 55; i++) {
    g.fillStyle = `rgba(18,22,30,${0.04 + Math.random() * 0.09})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 24, 1 + Math.random() * 2);
  }

  for (let i = 0; i < 12; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath(); g.arc(x + 0.8, y + 0.8, 1.3, 0, Math.PI * 2); g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeWoodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');

  g.fillStyle = '#8a5326';
  g.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 70; i++) {
    const baseY = i * 4 + Math.random() * 2;
    g.strokeStyle = `rgba(${45 + Math.random() * 30},${24 + Math.random() * 16},8,${0.12 + Math.random() * 0.22})`;
    g.lineWidth = 0.8 + Math.random() * 1.4;
    g.beginPath();
    for (let x = 0; x <= 256; x += 12) {
      const y = baseY + Math.sin(x * 0.045 + i * 1.7) * 2.4 + Math.sin(x * 0.13 + i) * 0.8;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  for (let i = 0; i < 3; i++) {
    const x = 30 + Math.random() * 190;
    const y = 30 + Math.random() * 190;
    g.strokeStyle = 'rgba(40,20,6,0.4)';
    g.lineWidth = 2;
    for (let r = 3; r < 14; r += 3) {
      g.beginPath(); g.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2); g.stroke();
    }
  }

  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(255,220,170,${0.03 + Math.random() * 0.05})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 30, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeGoldTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');

  g.fillStyle = '#c9a24a';
  g.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 46; i++) {
    g.strokeStyle = `rgba(${90 + Math.random() * 40},${65 + Math.random() * 30},20,${0.12 + Math.random() * 0.18})`;
    g.lineWidth = 1;
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 6 + Math.random() * 18;
    g.beginPath();
    g.arc(x, y, r, Math.random() * 3, Math.random() * 3 + 2);
    g.stroke();
  }

  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,240,190,${0.04 + Math.random() * 0.08})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 26, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function initGunTextures() {
  if (GUN_TEX) return;
  GUN_TEX = {
    metal: makeMetalTexture(),
    wood: makeWoodTexture(),
    gold: makeGoldTexture(),
  };
}

function gunMat(color, roughness, metalness, tex) {
  const m = new THREE.MeshPhongMaterial({color, shininess:12+(1-roughness)*65, specular:metalness>.5?0x9aabaf:0x4e483b});
  if (tex) { m.map=tex;m.bumpMap=tex;m.bumpScale=.003; }
  return m;
}

function gunBox(group, w, h, d, x, y, z, mat, rx = 0) {
  const radius = Math.min(w,h,d) * .12;
  const shape = new THREE.Shape();
  shape.moveTo(-w/2+radius,-h/2+radius);
  shape.lineTo(w/2-radius,-h/2+radius);shape.lineTo(w/2-radius,h/2-radius);
  shape.lineTo(-w/2+radius,h/2-radius);shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape,{depth:d-radius*2,bevelEnabled:true,bevelSize:radius,bevelThickness:radius,bevelSegments:1,steps:1});
  geometry.translate(0,0,-d/2+radius);
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);m.rotation.x = rx;group.add(m);return m;
}

function gunCyl(group, r, len, x, y, z, mat, axis = 'z') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  else m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

function makeGunModel(id) {
  const g = new THREE.Group();

  const dark = gunMat(0x232a3b, 0.38, 0.65, GUN_TEX.metal);
  const mid = gunMat(0x4c5674, 0.34, 0.6, GUN_TEX.metal);
  const steel = gunMat(0x9aa2b4, 0.26, 0.75, GUN_TEX.metal);
  const wood = gunMat(0xffffff, 0.78, 0.05, GUN_TEX.wood);
  const olive = gunMat(0x5d6b45, 0.62, 0.15, GUN_TEX.metal);
  const gold = gunMat(0xffffff, 0.32, 0.7, GUN_TEX.gold);
  const accent = gunMat(0xffd23f, 0.45, 0.25, GUN_TEX.metal);
  const white = gunMat(0xf7f3e8, 0.55, 0.05, null);

  let mz = -0.7;

  if (id === 'ak') {
    gunBox(g, 0.13, 0.14, 0.42, 0, 0, -0.12, dark);
    gunBox(g, 0.11, 0.11, 0.26, 0, 0.01, -0.42, wood);
    gunCyl(g, 0.024, 0.3, 0, 0.035, -0.63, steel);
    gunBox(g, 0.09, 0.19, 0.12, 0, -0.13, -0.1, dark, 0.35);
    gunBox(g, 0.1, 0.1, 0.24, 0, -0.01, 0.19, wood);
    gunBox(g, 0.032, 0.035, 0.045, 0, 0.09, -0.33, dark);
    gunBox(g, 0.024, 0.055, 0.03, 0, 0.1, -0.62, steel);
    gunCyl(g, 0.018, 0.26, 0, 0.078, -0.42, steel);
    gunBox(g, 0.055, 0.022, 0.04, -0.06, 0.07, -0.2, steel);
    gunBox(g, 0.135, 0.03, 0.1, 0, 0.05, -0.02, accent);
    mz = -0.8;
  } else if (id === 'm4') {
    gunBox(g, 0.12, 0.13, 0.4, 0, 0, -0.12, mid);
    gunBox(g, 0.1, 0.1, 0.3, 0, 0.01, -0.38, dark);
    gunCyl(g, 0.034, 0.34, 0, 0.02, -0.62, dark);
    gunBox(g, 0.08, 0.18, 0.1, 0, -0.12, -0.08, dark);
    gunBox(g, 0.042, 0.03, 0.34, 0, 0.1, -0.2, dark);
    gunBox(g, 0.03, 0.06, 0.03, 0, 0.11, -0.52, steel);
    gunBox(g, 0.012, 0.045, 0.1, -0.068, 0.01, -0.16, steel);
    gunBox(g, 0.1, 0.1, 0.22, 0, -0.01, 0.17, mid);
    gunBox(g, 0.125, 0.03, 0.1, 0, 0.05, -0.02, accent);
    mz = -0.8;
  } else if (id === 'shot') {
    gunBox(g, 0.13, 0.13, 0.34, 0, 0, -0.1, dark);
    gunCyl(g, 0.045, 0.52, 0, 0.03, -0.52, steel);
    gunBox(g, 0.12, 0.1, 0.2, 0, -0.03, -0.48, wood);
    gunBox(g, 0.11, 0.13, 0.3, 0, -0.03, 0.22, wood, -0.08);
    gunBox(g, 0.026, 0.012, 0.5, 0, 0.087, -0.52, dark);
    gunBox(g, 0.02, 0.03, 0.02, 0, 0.1, -0.76, accent);
    gunBox(g, 0.135, 0.03, 0.1, 0, 0.05, 0.02, accent);
    mz = -0.8;
  } else if (id === 'awp') {
    gunBox(g, 0.12, 0.14, 0.62, 0, 0, -0.12, olive);
    gunCyl(g, 0.026, 0.44, 0, 0.02, -0.63, dark);
    gunCyl(g, 0.05, 0.24, 0, 0.15, -0.1, dark);
    gunCyl(g, 0.058, 0.03, 0, 0.15, -0.21, steel);
    gunCyl(g, 0.058, 0.03, 0, 0.15, 0.0, steel);
    gunBox(g, 0.08, 0.16, 0.1, 0, -0.12, -0.06, olive);
    gunBox(g, 0.1, 0.1, 0.24, 0, -0.02, 0.24, olive);
    gunCyl(g, 0.014, 0.1, -0.08, 0.05, -0.02, steel, 'x');
    gunBox(g, 0.115, 0.03, 0.12, 0, 0.05, -0.02, accent);
    mz = -0.88;
  } else if (id === 'usp') {
    gunBox(g, 0.1, 0.1, 0.32, 0, 0.02, -0.1, dark);
    gunBox(g, 0.09, 0.17, 0.1, 0, -0.12, 0.02, mid, 0.25);
    gunCyl(g, 0.032, 0.24, 0, 0.02, -0.38, dark);
    gunBox(g, 0.02, 0.025, 0.03, 0, 0.08, -0.24, steel);
    gunBox(g, 0.02, 0.025, 0.03, 0, 0.08, 0.03, steel);
    gunBox(g, 0.105, 0.02, 0.08, 0, 0.06, -0.02, accent);
    mz = -0.52;
  } else if (id === 'deagle') {
    gunBox(g, 0.11, 0.11, 0.34, 0, 0.02, -0.1, gold);
    gunBox(g, 0.09, 0.18, 0.1, 0, -0.12, 0.02, dark, 0.22);
    gunCyl(g, 0.036, 0.2, 0, 0.03, -0.36, gold);
    gunBox(g, 0.02, 0.025, 0.03, 0, 0.09, -0.24, dark);
    gunBox(g, 0.02, 0.03, 0.03, 0, 0.09, 0.02, dark);
    gunBox(g, 0.115, 0.025, 0.1, 0, 0.06, -0.02, dark);
    mz = -0.48;
  } else {
    gunBox(g, 0.12, 0.13, 0.4, 0, 0, -0.1, dark);
    mz = -0.6;
  }

  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), white);
  hand.position.set(0.02, -0.15, 0.08);
  g.add(hand);

  g.userData.muzzleZ = mz;
  return g;
}

function buildViewmodel() {
  viewGun = new THREE.Group();

  const ids = S.slots.length ? S.slots : DEFAULT_WEAPON_IDS;
  for (const id of ids) {
    const model = makeGunModel(id);
    model.visible = false;
    viewGun.add(model);
    gunModels[id] = model;
  }

  muzzle = new THREE.Group();
  const flame = new THREE.Mesh(new THREE.ConeGeometry(.045,.2,5),new THREE.MeshBasicMaterial({color:0xffb84c}));
  flame.rotation.x=-Math.PI/2;flame.position.z=-.055;muzzle.add(flame);
  const core = new THREE.Mesh(new THREE.SphereGeometry(.028,6,5),new THREE.MeshBasicMaterial({color:0xfff2ba}));
  muzzle.add(core);
  muzzle.visible = false;
  viewGun.add(muzzle);

  viewGun.position.set(0.476, -0.27, -0.72);
  viewGun.scale.setScalar(0.806);
  viewGun.rotation.y = -0.05;
  vmScene.add(viewGun);

  applyWeaponModel();
}

function applyWeaponModel() {
  const active = S.me.weapon;
  let z = -0.6;
  for (const [id, model] of Object.entries(gunModels)) {
    const on = id === active;
    model.visible = on;
    if (on) z = model.userData.muzzleZ ?? z;
  }
  muzzleZ = z;
  if (muzzle) muzzle.position.set(0, 0.01, z);
}

/* ============================ яйца ============================ */

function makeBlobShadow() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
  grad.addColorStop(0.65, 'rgba(0, 0, 0, 0.2)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  return mesh;
}

function makeEgg(colorHex) {
  const group = new THREE.Group();
  const color = new THREE.Color(colorHex);

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 24, 20),
    new THREE.MeshPhongMaterial({ color, shininess: 45, specular: 0x555555 }),
  );
  body.scale.set(1, 1.32, 1);
  body.position.y = 0.66;
  body.castShadow = false;
  group.add(body);

  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const black = new THREE.MeshLambertMaterial({ color: 0x151824 });

  for (const sx of [-0.16, 0.16]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 12), white);
    eye.position.set(sx, 0.8, -0.4);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), black);
    pupil.position.set(sx, 0.8, -0.49);
    group.add(pupil);
  }

  const gun = new THREE.Group();
  const gunMat = new THREE.MeshPhongMaterial({ color: 0x46505b, shininess:32, specular:0x89948d, map: GUN_TEX ? GUN_TEX.metal : null });
  const gb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.5), gunMat);
  gb.position.set(0, 0, -0.15);
  gun.add(gb);
  const gbarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 8), gunMat);
  gbarrel.rotation.x = Math.PI / 2;
  gbarrel.position.set(0, 0.02, -0.48);
  gun.add(gbarrel);
  gun.position.set(0.5, 0.55, -0.28);
  gun.rotation.y = -0.25;
  group.add(gun);

  const hand = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xf7f3e8 }),
  );
  hand.position.set(0.47, 0.45, -0.05);
  group.add(hand);

  const shield=new THREE.Mesh(new THREE.SphereGeometry(.54,16,12),new THREE.MeshBasicMaterial({color:0x80dbe9,transparent:true,opacity:.14,depthWrite:false,wireframe:true}));
  shield.position.y=.66;shield.scale.y=1.35;shield.visible=false;group.add(shield);
  if(S.arena)group.scale.set(S.arena.playerCollision.radius/.5,S.arena.playerCollision.height/1.32,S.arena.playerCollision.radius/.5);
  return { group, body, gun, shield };
}

function addRemote(p) {
  const meta = S.meta.get(p.i) || { name: 'Яйцо', color: '#ffd23f' };
  const { group, body, gun, shield } = makeEgg(meta.color);
  group.userData.playerId = p.i;
  group.position.set(p.x, p.y, p.z);
  group.rotation.y = p.yaw || 0;
  group.add(makeBlobShadow());
  scene.add(group);

  const view = {
    id: p.i,
    group,
    body,
    gun,
    shield,
    target: { x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0 },
    samples: [],
    hp: p.hp,
    alive: !!p.a,
    kills: p.k,
    deaths: p.d,
  };
  group.visible = view.alive;
  S.players.set(p.i, view);
  return view;
}

function clearRemotes() {
  for (const v of S.players.values()) {
    scene.remove(v.group);
    v.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (o.material.map) o.material.map.dispose?.();
        o.material.dispose?.();
      }
    });
  }
  S.players.clear();
}

/* ============================ игровой цикл ============================ */

function startGame(msg) {
  clearCombat();
  grenadeEffects?.clear();
  S.roomState = 'playing';
  S.keys = Object.create(null);
  S.firing = false;
  jumpQueued = false;
  S.timeLeft = msg.timeLeft;
  S.snapshotAt = S.snapshotReceived = S.viewTime = 0;
  const me = S.me;
  me.x = msg.you.x; me.y = msg.you.y; me.z = msg.you.z; me.yaw = msg.you.yaw; me.pitch = msg.you.pitch || 0;
  me.vy = 0;
  me.onGround = true;
  me.hp = 100;
  me.energy = 100;
  me.grenades = msg.you.grenades ?? 2;
  me.grenadeReadyAt = me.grenadeThrowAt = 0;
  me.sprinting = me.sprintExhausted = false;
  me.alive = true;
  me.kills = 0;
  me.deaths = 0;
  me.reloading = false;
  me.lastShot = 0;
  me.deadUntil = 0;
  me.deadAt = 0;
  me.zoom = false;
  me.firing = false;

  if (msg.weapons) {
    S.weapons = msg.weapons;
    S.slots = Object.keys(msg.weapons);
  }
  if (S.slots.length) {
    me.weapon = S.slots[0];
    me.ammo = {};
    for (const id of S.slots) me.ammo[id] = S.weapons[id].mag;
    renderWeaponBar();
  }
  resetZoom();

  if (msg.players) {
    S.lobbyPlayers = msg.players;
    for (const p of msg.players) S.meta.set(p.i, { name: p.n, color: p.c });
  }

  const arena = msg.arena || S.arena;
  if (scene) clearRemotes();
  if (!scene) {
    initThree(arena);
  } else if (S.arena.id !== arena.id) {
    const textures = new Set();
    arenaGroup.traverse(o => {
      o.geometry?.dispose();
      if (o.material) {
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
          if (mat.map) textures.add(mat.map);
          mat.dispose();
        }
      }
    });
    for (const texture of textures) texture.dispose();
    combat?.clear();
    worldMeshes.length = 0;
    scene.remove(arenaGroup);
    arenaGroup = new THREE.Group();
    scene.add(arenaGroup);
    scene.background.set(arena.theme.sky);
    scene.fog.color.set(arena.theme.fog);
    scene.fog.near = arena.half * 2;
    scene.fog.far = arena.half * 6;
    const sun = scene.children.find(o => o.isDirectionalLight);
    sun.color.set(0xffe1a0);
    sun.intensity = 1.85;
    sun.position.set(arena.half * .9, arena.half * 1.8, arena.half * .7);
    for (const key of ['left','bottom']) sun.shadow.camera[key] = -arena.half * 1.8;
    for (const key of ['right','top']) sun.shadow.camera[key] = arena.half * 1.8;
    sun.shadow.camera.far = arena.half * 6;
    sun.shadow.camera.updateProjectionMatrix();
    buildArena(arena);
    renderer.shadowMap.needsUpdate = true;
  }
  S.arena = arena;
  S.mapId = arena.id;
  $('mapName').textContent = arena.name;

  $('death').classList.add('hidden');
  $('pause').classList.toggle('hidden', S.locked);
  $('reloadHint').classList.add('hidden');
  $('vignette').classList.remove('hit');
  $('killfeed').innerHTML = '';
  $('results').classList.add('hidden');
  $('scorePanel').classList.add('hidden');

  lastScoreSig = '';
  lastHud = { timer: '', hp: -1, ammo: -1, reload: null, cross: null };
  show('hud');
  updateHud();
  applyWeaponModel();
  updateFpsLabel();
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
}

let running = false;
let lastFrame = 0;
let hudAcc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const visualDt = lastFrame ? (now - lastFrame) / 1000 : .016;
  const dt = Math.min(.05, visualDt);
  lastFrame = now;

  if (!renderer) return;

  if (S.screen === 'hud' && scene && camera) {
    clock += dt;
    tickFps(visualDt);
    updateMe(dt, visualDt);
    updateRemotes(dt);
    updateEffects(dt);

    hudAcc += dt;
    if (hudAcc > 0.1) {
      hudAcc = 0;
      updateHud();
      updateScoreboard();
    }

    renderer.render(scene, camera);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
    renderer.autoClear = true;
    return;
  }

  if (S.screen === 'results' && scene && camera) {
    renderer.render(scene, camera);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
    renderer.autoClear = true;
    return;
  }

  renderLobby(dt);
}

function surfaceHeight(x, z, limit = S.me.y + S.arena.playerCollision.maxStepHeight) {
  return S.arena ? ArenaGeometry.groundHeight(S.arena, x, z, limit) : 0;
}

function isBlocked(x, z, y = S.me.y) {
  return S.arena ? ArenaGeometry.blocks(S.arena, x, z, y) : false;
}

function updateMe(dt, visualDt = dt) {
  const me = S.me;
  const sprintHeld = !!(S.keys.ShiftLeft || S.keys.ShiftRight);
  if (!sprintHeld) me.sprintExhausted = false;
  me.sprinting = false;

  if (me.alive && S.locked) {
    const f = (S.keys['KeyW'] ? 1 : 0) - (S.keys['KeyS'] ? 1 : 0);
    const r = (S.keys['KeyD'] ? 1 : 0) - (S.keys['KeyA'] ? 1 : 0);
    moving = !!(f || r);

    if (moving) {
      const len = Math.hypot(f, r);
      const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
      const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
      const dx = (fx * f + rx * r) / len;
      const dz = (fz * f + rz * r) / len;
      const sprint = sprintHeld && !me.sprintExhausted && me.energy > 0;
      const speed = S.arena.playerCollision.walkSpeedMetersPerSecond * (me.aiming ? .7 : 1) * (sprint ? 2 : 1);
      const beforeX = me.x, beforeZ = me.z;
      // Sprinting must not skip a walkable ramp step when a frame takes 50 ms.
      const steps = Math.ceil(speed * dt / S.arena.playerCollision.maxStepHeight);
      for (let step = 0; step < steps; step++) {
        const nx = me.x + dx * speed * dt / steps;
        const nz = me.z + dz * speed * dt / steps;
        const floorX = surfaceHeight(nx, me.z);
        const feetX = me.onGround ? Math.max(me.y, floorX) : me.y;
        if (!isBlocked(nx, me.z, feetX) && floorX <= me.y + S.arena.playerCollision.maxStepHeight) me.x = nx;
        const floorZ = surfaceHeight(me.x, nz);
        const feetZ = me.onGround ? Math.max(me.y, floorZ) : me.y;
        if (!isBlocked(me.x, nz, feetZ) && floorZ <= me.y + S.arena.playerCollision.maxStepHeight) me.z = nz;
        if (me.onGround) {
          const support = surfaceHeight(me.x, me.z);
          // Follow small downward steps as well as uphill slopes. A real drop
          // stays airborne, while a ramp keeps jumps and footsteps responsive.
          if (support >= me.y - S.arena.playerCollision.maxStepHeight && !isBlocked(me.x, me.z, support)) me.y = support;
        }
      }
      me.sprinting = sprint && (me.x !== beforeX || me.z !== beforeZ);
      bobTime += dt * 9;
    }

    if (jumpQueued && me.onGround) {
      me.vy = 8.8;
      me.onGround = false;
    }
  } else {
    moving = false;
  }

  jumpQueued = false;

  if (me.alive) {
    if (me.sprinting) {
      me.energy = Math.max(0, me.energy - 25 * dt); // Four seconds of continuous sprint.
      if (me.energy === 0) {
        me.sprintExhausted = true;
        me.sprinting = false;
      }
    } else {
      me.energy = Math.min(100, me.energy + 20 * dt); // Five seconds from empty to full.
    }
  }

  const groundNow = surfaceHeight(me.x, me.z);
  if (me.onGround && groundNow > me.y) me.y = groundNow;

  const previousY = me.y;
  me.vy -= 24 * dt;
  me.y += me.vy * dt;
  if (me.vy > 0) {
    const ceiling = ArenaGeometry.ceilingHeight(S.arena, me.x, me.z, previousY + S.arena.playerCollision.height);
    if (me.y + S.arena.playerCollision.height > ceiling) { me.y = ceiling - S.arena.playerCollision.height; me.vy = 0; }
  }

  const ground = surfaceHeight(me.x, me.z, Math.max(previousY + S.arena.playerCollision.maxStepHeight, me.y));
  if (me.y <= ground) {
    if (!me.onGround) playFootstep(0.22, 0, 0.82, 0, footMaterial(me.x, me.y, me.z));
    me.y = ground;
    me.vy = 0;
    me.onGround = true;
  } else {
    me.onGround = false;
  }

  if (me.alive && me.onGround && moving && S.locked) {
    const stepInterval = (me.aiming ? 0.4 : 0.277) / (me.sprinting ? 2 : 1);
    me.stepTimer += dt;
    if (me.stepTimer >= stepInterval) {
      me.stepTimer = 0;
      playFootstep(0.12, 0, 1, 0, footMaterial(me.x, me.y, me.z));
    }
  } else {
    me.stepTimer = 0;
  }

  camera.position.set(me.x, me.y + S.arena.playerCollision.height * .85, me.z);
  camera.rotation.set(me.pitch, me.yaw, 0);


  const wNow = currentWeapon();
  const targetFov = me.aiming ? (wNow && wNow.zoom ? 30 : 62) : 78;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 22);
    camera.updateProjectionMatrix();
  }

  const aimTarget = me.aiming && !me.zoom ? 1 : 0;
  aimBlend += (aimTarget - aimBlend) * Math.min(1, dt * 22);

  const profile = EggCombat.profiles[me.weapon] || EggCombat.profiles.ak;
  recoil *= Math.exp(-profile.recovery * visualDt);
  if (viewGun) {
    viewGun.visible = !me.zoom;
    const bx = 0.476 + (0.05 - 0.476) * aimBlend;
    const by = -0.27 + (-0.14 + 0.27) * aimBlend;
    const bz = -0.72 + (-0.62 + 0.72) * aimBlend;
    viewGun.position.z = bz + recoil * 0.5;
    viewGun.position.y = by - recoil * 0.08;
    viewGun.position.x = bx + Math.sin(clock * 2.1) * 0.004 * (1 - aimBlend)
      + (moving ? Math.sin(bobTime * 0.5) * 0.012 * (1 - aimBlend) : 0);
    const reloadProgress = me.reloading ? 1 - (me.reloadEnd - performance.now()) / (S.weapons[me.reloadWeapon].reload * 1000) : 0;
    const reloadPose = Math.sin(Math.max(0, Math.min(1, reloadProgress)) * Math.PI);
    viewGun.position.y -= reloadPose * .13;
    viewGun.rotation.x = recoil * profile.lift - reloadPose * .28;
    viewGun.rotation.z = -reloadPose * .35;
    const throwProgress = (performance.now() - me.grenadeThrowAt) / 400;
    if (me.grenadeThrowAt && throwProgress >= 0 && throwProgress < 1) {
      const throwPose = Math.sin(throwProgress * Math.PI);
      viewGun.position.y -= throwPose * .25;
      viewGun.rotation.x -= throwPose * .35;
    }
    if (muzzle) muzzle.visible = performance.now() < muzzleUntil && me.alive;

  }

  if (S.firing && S.locked && me.alive) {
    const w = currentWeapon();
    if (w && w.auto) tryFire();
  }

  if (me.reloading && performance.now() >= me.reloadEnd) {
    const w = S.weapons && S.weapons[me.reloadWeapon];
    if (w) me.ammo[me.reloadWeapon] = w.mag;
    me.reloading = false;
    me.reloadWeapon = null;
    $('reloadHint').classList.add('hidden');
    updateWeaponBar();
  }

  if (!me.alive && me.deadUntil && performance.now() > me.deadUntil + 500 && !me.respawnAsked) {
    me.respawnAsked = true;
    send({ t: 'respawn' });
  }
}

function tickFps(dt) {
  fpsFrames += 1;
  fpsTime += dt;
  if (fpsTime < 1) return;

  fpsValue = Math.round(fpsFrames / fpsTime);
  fpsFrames = 0;
  fpsTime = 0;
  fpsSamples += 1;
  updateFpsLabel();

  // разрешение меняется только вручную в настройках — без рывков на ходу
}

function updateFpsLabel() {
  const el = $('fps');
  if (!el) return;
  const dpr = Math.min(window.devicePixelRatio || 1, QUALITY.maxDpr) * QUALITY.scale;
  el.textContent = `${fpsValue} FPS · ${dpr.toFixed(2)}x`;
  el.classList.toggle('hidden', !fpsVisible);
}

function updateRemotes(dt) {
  const k = Math.min(1, dt * 15);
  if (S.snapshotAt) {
    // Render a known point between authoritative snapshots; shots refer to this same time.
    S.viewTime = Math.max(S.viewTime, Math.min(S.snapshotAt, S.snapshotAt + performance.now() - S.snapshotReceived - 75));
  }
  for (const v of S.players.values()) {
    const t = v.target;
    if (!t) continue;

    const px = v.group.position.x;
    const pz = v.group.position.z;

    if (v.samples.length) {
      while (v.samples.length > 1 && v.samples[1].at <= S.viewTime) v.samples.shift();
      const a = v.samples[0], b = v.samples[1] || a;
      const blend = b.at > a.at ? Math.max(0, Math.min(1, (S.viewTime - a.at) / (b.at - a.at))) : 0;
      v.group.position.set(a.x + (b.x - a.x) * blend, a.y + (b.y - a.y) * blend, a.z + (b.z - a.z) * blend);
      v.group.rotation.y = lerpAngle(a.yaw, b.yaw, blend);
    } else {
      v.group.position.x += (t.x - v.group.position.x) * k;
      v.group.position.y += (t.y - v.group.position.y) * k;
      v.group.position.z += (t.z - v.group.position.z) * k;
      v.group.rotation.y = lerpAngle(v.group.rotation.y, t.yaw, k);
    }
    v.hitReaction = Math.max(0, (v.hitReaction || 0) - dt);
    const hitPose = Math.sin(Math.min(1, v.hitReaction / .35) * Math.PI);
    v.body.scale.set(1 + hitPose * .12, 1.32 - hitPose * .16, 1 + hitPose * .12);
    v.body.material.emissive.setHex(v.hitReaction > .25 ? 0x382412 : 0x000000);

    const moved = Math.hypot(v.group.position.x - px, v.group.position.z - pz);
    if (moved < 1.2) {
      const speed = moved / Math.max(dt, 0.0001);
      v.speed = v.speed ? v.speed * 0.8 + speed * 0.2 : speed;
    } else {
      v.speed = 0; // телепорт/респавн
      v.stepTimer = 0;
    }

    const floor = ArenaGeometry.groundHeight(S.arena, t.x, t.z, t.y + .15);
    if (v.alive && Math.abs(t.y - floor) < .15 && v.speed > 1.2) {
      const interval = Math.max(0.22, Math.min(0.5, 1.54 / Math.max(v.speed, 1)));
      v.stepTimer = (v.stepTimer || 0) + dt;
      if (v.stepTimer >= interval) {
        v.stepTimer = 0;
        playRemoteStep(v);
      }
    } else {
      v.stepTimer = 0;
    }
  }
}

function playRemoteStep(v) {
  const dx = v.group.position.x - S.me.x;
  const dz = v.group.position.z - S.me.z;
  const horizontal = Math.hypot(dx,dz);
  const dist = Math.hypot(horizontal, v.group.position.y - S.me.y);
  if (dist > 28) return;

  const volume = Math.max(0.03, Math.min(0.45, 0.5 / (1 + dist / 7)));
  let pan = 0;
  if (horizontal > 0.05) {
    pan = ((dx / horizontal) * Math.cos(S.me.yaw) + (dz / horizontal) * -Math.sin(S.me.yaw)) * 0.8;
  }
  const lowpass = dist > 8 ? Math.max(650, 2200 - dist * 60) : 0;
  playFootstep(volume, pan, 1, lowpass, footMaterial(v.target.x, v.target.y, v.target.z));
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/* ============================ стрельба ============================ */

function muzzleWorld() {
  const v = new THREE.Vector3(0, 0.01, muzzleZ);
  viewGun.updateWorldMatrix(true, false);
  viewGun.localToWorld(v);
  // Match the viewmodel camera's screen position to a point in the world camera.
  vmCamera.updateMatrixWorld();
  const screen = v.project(vmCamera);
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
  return ray.ray.origin.clone().addScaledVector(ray.ray.direction, .7);
}

function currentWeapon() {
  return S.weapons && S.me.weapon ? S.weapons[S.me.weapon] : null;
}

function renderWeaponBar() {
  const bar = $('weaponBar');
  if (!bar || !S.weapons) return;
  bar.innerHTML = '';
  S.slots.forEach((id, i) => {
    const w = S.weapons[id];
    const el = document.createElement('div');
    el.className = 'weapon-slot';
    el.dataset.id = id;
    const k = document.createElement('span');
    k.className = 'wk';
    k.textContent = String(i + 1);
    const n = document.createElement('span');
    n.className = 'wn';
    n.textContent = w.short;
    const a = document.createElement('span');
    a.className = 'wa';
    a.textContent = String(w.mag);
    el.append(k, n, a);
    bar.append(el);
  });
  updateWeaponBar();
}

function updateWeaponBar() {
  const bar = $('weaponBar');
  if (!bar || !S.weapons) return;
  for (const el of bar.children) {
    const id = el.dataset.id;
    const ammo = S.me.ammo[id] ?? 0;
    const active = id === S.me.weapon;
    if (el.classList.contains('active') !== active) el.classList.toggle('active', active);
    const empty = ammo === 0;
    if (el.classList.contains('empty') !== empty) el.classList.toggle('empty', empty);
    const a = el.querySelector('.wa');
    const text = String(ammo);
    if (a && a.textContent !== text) a.textContent = text;
  }
}

function switchWeapon(id) {
  if (!S.weapons || !S.weapons[id] || S.me.weapon === id) return;
  if (!S.me.alive) return;
  cancelWeaponFeedback();
  S.me.weapon = id;
  S.me.reloading = false;
  S.me.reloadWeapon = null;
  $('reloadHint').classList.add('hidden');
  stopAim();
  Sound.play('click', { volume: 0.22, rate: 1.35 });
  applyWeaponModel();
  showWeaponToast(S.weapons[id].name);
  updateWeaponBar();
  updateHud();
}

function showWeaponToast(text) {
  const el = document.getElementById('weaponToast');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(showWeaponToast.timer);
  showWeaponToast.timer = setTimeout(() => el.classList.remove('show'), 1100);
}

function cycleWeapon(dir) {
  if (!S.slots.length) return;
  const i = S.slots.indexOf(S.me.weapon);
  const next = (i + dir + S.slots.length) % S.slots.length;
  switchWeapon(S.slots[next]);
}

function startAim() {
  const me = S.me;
  const w = currentWeapon();
  if (!w || !me.alive || S.screen !== 'hud') return;
  me.aiming = true;
  me.zoom = !!w.zoom;
  $('scope').classList.toggle('hidden', !w.zoom);
  $('crosshair').classList.toggle('aiming', !w.zoom);
  if (viewGun) viewGun.visible = !w.zoom;
}

function stopAim() {
  const me = S.me;
  me.aiming = false;
  me.zoom = false;
  $('scope').classList.add('hidden');
  $('crosshair').classList.remove('aiming');
  if (viewGun) viewGun.visible = true;
}

function setZoom(on) {
  if (on) startAim();
  else stopAim();
}

function resetZoom() {
  stopAim();
  if (camera) {
    camera.fov = 78;
    camera.updateProjectionMatrix();
  }
}

function refillAll() {
  if (!S.weapons) return;
  for (const id of S.slots) S.me.ammo[id] = S.weapons[id].mag;
}

function playWeaponSound(w, options = {}) {
  Sound.resume();
  const p = EggCombat.profiles[w.id] || EggCombat.profiles.ak;
  const {volume = 1, pan = 0, lowpass = 0} = options;
  if (!Sound.play(p.sound, {volume:p.volume * volume, rate:p.rate, pan, lowpass})) {
    tone(150, .08, 'sawtooth', .04 * volume, 60);
  }
  if (p.sound === 'shot-b') Sound.thump(p.volume * volume * .18, pan);
}

function tryFire() {
  const me = S.me;
  if (S.screen !== 'hud' || !me.alive || !S.locked) return;

  const w = currentWeapon();
  if (!w || me.reloading) return;

  const now = performance.now();
  const cooldown = Math.max(60, (60000 / w.rpm) * 0.9);
  if (now - me.lastShot < cooldown) return;

  if ((me.ammo[me.weapon] || 0) <= 0) {
    Sound.play('click', { volume: 0.35, rate: 0.9 });
    startReload();
    return;
  }

  me.lastShot = now;
  me.ammo[me.weapon] -= 1;
  const profile = EggCombat.profiles[w.id];
  recoil = Math.min(.42, recoil + profile.kick);
  flashMuzzle();
  playWeaponSound(w);

  // Mouse events can arrive between frames; never shoot using the previous frame's aim.
  camera.rotation.set(me.pitch, me.yaw, 0);
  camera.updateMatrixWorld(true);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  sendInput();
  send({ t: 'shoot', dx: dir.x, dy: dir.y, dz: dir.z, w: w.id, aim: me.aiming ? 1 : 0, viewTime: S.viewTime || undefined });

  const right = new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
  combat.muzzle(muzzleWorld(), right, w.id, true);

  if (me.ammo[me.weapon] <= 0) startReload();
  updateWeaponBar();
  updateHud();
}

function flashMuzzle() {
  if (!muzzle) return;
  const profile = EggCombat.profiles[S.me.weapon];
  muzzle.visible = true;
  muzzle.scale.set(.7 * profile.flash, .7 * profile.flash, 1.8 * profile.flash);
  muzzleUntil = performance.now() + 45;
}

function updateEffects(dt) {
  combat?.update(dt);
  grenadeEffects?.update(dt);
  if (S.me.alive && S.locked) updateAmbience();
}

function cancelWeaponFeedback() {
  recoil = muzzleUntil = 0;
  if (muzzle) muzzle.visible = false;
  for (const timer of soundTimers) clearTimeout(timer);
  soundTimers.clear();
  Sound.stop('reload');
}

function clearCombat({ keepExplosions = false } = {}) {
  cancelWeaponFeedback();
  combat?.clear();
  Sound.stop(undefined, keepExplosions ? 'explosion' : undefined);
  ambientAt = 0;
  if ($('hitmarker')) { $('hitmarker').classList.remove('show'); delete $('hitmarker').dataset.kind; }
}

function laterSound(fn, ms) {
  const timer = setTimeout(() => {
    soundTimers.delete(timer);
    if (S.screen === 'hud' && S.me.alive && S.me.reloading) fn();
  }, ms);
  soundTimers.add(timer);
}

function startReload() {
  const me = S.me;
  const w = currentWeapon();
  if (!w || me.reloading || !me.alive) return;
  if ((me.ammo[me.weapon] || 0) >= w.mag) return;

  me.reloading = true;
  me.reloadWeapon = me.weapon;
  me.reloadEnd = performance.now() + w.reload * 1000;
  $('reloadHint').classList.remove('hidden');
  $('reloadHint').textContent = `Перезарядка ${w.name}…`;
  playReloadSound();
  updateHud();
}

function playReloadSound() {
  const w = currentWeapon();
  const ms = w ? w.reload * 1000 : 1400;
  Sound.resume();
  if (!Sound.play('reload-in', { volume: 0.5, channel:'reload' })) tone(320, 0.05, 'square', 0.03, 240);
  laterSound(() => Sound.play('reload-out', { volume: 0.45, channel:'reload' }), Math.max(300, ms - 520));
  laterSound(() => Sound.play('reload-in', { volume: 0.3, rate: 1.18, channel:'reload' }), Math.max(500, ms - 220));
}

/* ============================ события матча ============================ */

function throwGrenade() {
  const me = S.me, now = performance.now();
  if (S.screen !== 'hud' || !S.locked || !me.alive || now < me.grenadeReadyAt) return;
  if (me.grenades <= 0) { showWeaponToast('Гранаты закончились'); return; }
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  camera.rotation.set(me.pitch, me.yaw, 0);
  camera.updateMatrixWorld(true);
  const direction = camera.getWorldDirection(new THREE.Vector3());
  sendInput();
  send({ t: 'grenade', dx: direction.x, dy: direction.y, dz: direction.z });
  // Inventory changes only after the server acknowledges the throw.
  me.grenadeReadyAt = now + 650;
}

function onGrenade(msg) {
  grenadeEffects?.upsert(msg);
  if (msg.owner === S.id) {
    S.me.grenades = msg.remaining;
    S.me.grenadeThrowAt = performance.now();
    stopAim();
    Sound.play('click', { volume: .4, rate: .8 });
    updateHud();
  }
}

function onExplosion(msg) {
  grenadeEffects?.explosion(msg);
  const spatial = soundPosition(msg);
  Sound.play('grenade-explosion', { ...spatial, volume: spatial.volume * .9, channel: 'explosion' });
  Sound.thump(spatial.volume * .25, spatial.pan, 'explosion');
}

function onSnapshot(msg) {
  if (S.screen !== 'hud') return;
  S.timeLeft = msg.tl;
  grenadeEffects?.sync(msg.g || []);
  if (Number.isFinite(msg.at)) {
    S.snapshotAt = msg.at;
    S.snapshotReceived = performance.now();
  }

  const seen = new Set();
  for (const p of msg.p) {
    seen.add(p.i);
    if (p.i === S.id) {
      const me = S.me;
      const wasDead = !me.alive;
      me.serverX = p.x;
      me.serverZ = p.z;
      me.serverY = p.y;
      me.hp = p.hp;
      me.grenades = p.grenades ?? me.grenades;
      me.immune = !!p.im;
      me.kills = p.k;
      me.deaths = p.d;
      if (!p.a) {
        if (me.alive) me.deadAt = performance.now();
        me.alive = false;
      } else if (wasDead) {
        // возрождение, даже если сообщение по дороге потерялось
        me.x = p.x;
        me.y = p.y;
        me.z = p.z;
        me.vy = 0;
        me.onGround = true;
        me.hp = 100;
        me.energy = 100;
        me.grenadeReadyAt = me.grenadeThrowAt = 0;
        me.sprinting = me.sprintExhausted = false;
        refillAll();
        me.reloading = false;
        me.reloadWeapon = null;
        me.deadUntil = 0;
        me.killedBy = null;
        me.respawnAsked = false;
        me.alive = true;
        resetZoom();
        $('death').classList.add('hidden');
        $('reloadHint').classList.add('hidden');
        if (!S.locked) $('pause').classList.remove('hidden');
      }
    } else {
      let v = S.players.get(p.i);
      if (!v) v = addRemote(p);
      if (!v.alive || !p.a) v.samples.length = 0;
      if (Number.isFinite(msg.at)) {
        v.samples.push({ at: msg.at, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
        if (v.samples.length > 8) v.samples.shift();
      }
      v.target = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
      v.hp = p.hp;
      v.alive = !!p.a;
      v.shield.visible=!!p.im;
      v.kills = p.k;
      v.deaths = p.d;
      v.group.visible = v.alive;
    }
  }

  for (const id of [...S.players.keys()]) {
    if (!seen.has(id)) {
      const v = S.players.get(id);
      scene.remove(v.group);
      S.players.delete(id);
    }
  }
}

function onHit(msg) {
  const victim = S.players.get(msg.to);
  if (victim) victim.hitReaction = .35;
  if (msg.to === S.id) {
    const v = $('vignette');
    v.classList.remove('hit');
    void v.offsetWidth;
    v.classList.add('hit');
    setTimeout(() => v.classList.remove('hit'), 130);
    playHurt();
  }
  if (msg.from === S.id && msg.to !== S.id) {
    const hm = $('hitmarker');
    hm.classList.remove('show');
    void hm.offsetWidth;
    hm.classList.add('show');
    hm.dataset.kind = 'hit';
    playHit();
  }
}

function onKill(msg) {
  addKillFeed(msg);

  if (msg.victim === S.id) {
    const me = S.me;
    clearCombat({ keepExplosions: true });
    me.alive = false;
    me.deadUntil = performance.now() + 2200;
    me.deadAt = performance.now();
    me.respawnAsked = false;
    me.firing = false;
    if (me.aiming) stopAim();
    me.reloading = false;
    $('reloadHint').classList.add('hidden');
    me.killedBy = msg.killer === msg.victim ? 'Своя граната' : msg.kn;
    $('deathTitle').textContent = 'Вы погибли';
    $('deathSub').textContent = msg.killer === msg.victim ? 'Своя граната' : `Убил: ${msg.kn}`;
    $('death').classList.remove('hidden');
    playDeath();
  }
  const victim = S.players.get(msg.victim);
  if (victim) combat?.death({x:victim.group.position.x,y:victim.group.position.y+.7,z:victim.group.position.z});
  if (msg.killer === S.id && msg.victim !== S.id) {
    const hm = $('hitmarker');
    hm.dataset.kind = 'kill';hm.classList.remove('show');void hm.offsetWidth;hm.classList.add('show');
    playKill();
  }
}

function onRespawn(msg) {
  clearCombat();
  if (S.screen !== 'hud') return;
  const me = S.me;
  me.x = msg.you.x;
  me.y = msg.you.y;
  me.z = msg.you.z;
  me.yaw = msg.you.yaw;
  me.pitch = msg.you.pitch || 0;
  me.vy = 0;
  me.onGround = true;
  me.hp = 100;
  me.energy = 100;
  me.grenades = msg.you.grenades ?? 2;
  me.grenadeReadyAt = me.grenadeThrowAt = 0;
  me.sprinting = me.sprintExhausted = false;
  me.alive = true;
  refillAll();
  me.reloading = false;
  me.reloadWeapon = null;
  me.deadUntil = 0;
  me.killedBy = null;
  me.respawnAsked = false;
  resetZoom();
  $('death').classList.add('hidden');
  $('reloadHint').classList.add('hidden');
  if (!S.locked) $('pause').classList.remove('hidden');
}

function onEnd(msg) {
  S.results = msg.scores;
  S.roomState = 'results';
  if (S.screen === 'lobby') {
    renderLobbyPlayers();
    return;
  }
  $('scorePanel').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();

  const list = $('resultList');
  list.innerHTML = '';
  msg.scores.forEach((p, i) => {
    const li = document.createElement('li');
    if (i === 0) li.classList.add('first');

    const place = document.createElement('span');
    place.className = 'place';
    place.textContent = `${i + 1}`;

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.c;
    dot.style.color = p.c;

    const name = document.createElement('span');
    name.className = 'r-name';
    name.textContent = p.n + (p.i === S.id ? ' (ты)' : '');

    const stats = document.createElement('span');
    stats.className = 'r-stats';
    stats.textContent = `${p.k} убийств · ${p.d} смертей`;

    li.append(place, dot, name, stats);
    list.append(li);
  });

  $('winner').textContent = msg.scores[0]
    ? `Победитель: ${msg.scores[0].n}`
    : '';

  const isHost = S.id === S.hostId;
  $('btnAgain').classList.toggle('hidden', !isHost);
  $('againWait').classList.toggle('hidden', isHost);

  show('results');
}

/* ============================ HUD ============================ */

let lastHud = { timer: '', hp: -1, ammo: -1, reload: null, cross: null };

function setHudText(el, value) {
  if (el && el.textContent !== value) el.textContent = value;
}

function updateHud() {
  const me = S.me;

  const t = Math.max(0, Math.ceil(S.timeLeft));
  const m = Math.floor(t / 60);
  const sec = String(t % 60).padStart(2, '0');
  const timeText = `${m}:${sec}`;
  if (lastHud.timer !== timeText) {
    lastHud.timer = timeText;
    $('timer').textContent = timeText;
    $('timer').style.color = S.timeLeft < 30 ? '#ff5d6c' : '';
  }

  const hp = Math.max(0, Math.round(me.hp));
  if (lastHud.hp !== hp) {
    lastHud.hp = hp;
    $('healthFill').style.width = `${hp}%`;
    $('healthFill').classList.toggle('low', hp <= 35);
    $('healthNum').textContent = hp;
  }

  const energy = Math.max(0, Math.min(100, Math.round(me.energy)));
  if (lastHud.energy !== energy) {
    lastHud.energy = energy;
    $('stamina').setAttribute('aria-valuenow', energy);
    $('staminaFill').style.width = `${energy}%`;
    $('staminaNum').textContent = `${energy}%`;
  }
  $('stamina').classList.toggle('sprinting', me.sprinting);
  $('stamina').classList.toggle('exhausted', me.sprintExhausted);
  setHudText($('sprintStatus'), me.sprintExhausted ? 'Отпусти Shift' : me.sprinting ? 'Спринт' : 'Shift · Спринт');

  const grenadeReady = performance.now() >= me.grenadeReadyAt;
  setHudText($('grenadeCount'), String(me.grenades));
  setHudText($('grenadeStatus'), me.grenades === 0 ? 'До возрождения' : grenadeReady ? 'Граната' : 'Бросок…');
  $('grenadeSlot').classList.toggle('empty', me.grenades === 0);
  $('grenadeSlot').classList.toggle('cooldown', !grenadeReady);
  const danger = me.alive ? grenadeEffects?.nearby(me) : null;
  $('grenadeWarning').classList.toggle('hidden', !danger);
  if (danger) setHudText($('grenadeWarning'), `Граната рядом · ${danger.fuse.toFixed(1)} с`);

  const w = currentWeapon();
  const ammo = w ? (me.ammo[me.weapon] ?? 0) : 0;
  const ammoText = me.reloading ? '—' : String(ammo);
  if (lastHud.ammo !== ammoText) {
    lastHud.ammo = ammoText;
    $('ammo').textContent = ammoText;
    $('ammo').classList.toggle('empty', ammo === 0 && !me.reloading);
  }
  updateWeaponBar();

  if (lastHud.reload !== me.reloading) {
    lastHud.reload = me.reloading;
    if (me.reloading) $('reloadHint').classList.remove('hidden');
    else $('reloadHint').classList.add('hidden');
  }

  const cross = me.aiming && w && w.zoom ? '0' : (me.alive && S.locked ? '1' : '0.2');
  if (lastHud.cross !== cross) {
    lastHud.cross = cross;
    $('crosshair').style.opacity = cross;
  }

  const stuck = $('btnStuck');
  if (stuck) {
    const deadFor = me.alive ? 0 : performance.now() - (me.deadAt || performance.now());
    stuck.classList.toggle('hidden', me.alive || deadFor < 4500);
  }

  drawMinimap();

  if (!me.alive) {
    const left = Math.max(0, (me.deadUntil - performance.now()) / 1000);
    const who = me.killedBy ? `Убил: ${me.killedBy} · ` : '';
    $('deathSub').textContent = `${who}Возрождение: ${left.toFixed(1)} с`;
    const pct = Math.max(0, Math.min(100, (1 - left / 2.2) * 100));
    const fill = $('deathFill');
    if (fill) fill.style.width = `${pct}%`;
  }
}

let lastScoreSig = '';

function drawMinimap() {
  const c = $('minimapCanvas');
  if (!c || !S.arena) return;
  const g = c.getContext('2d');
  const size = c.width;
  const halfX = S.arena.halfX, halfZ = S.arena.halfZ;
  const pad = 18;
  const span = size - pad * 2;
  const scale = span / (Math.max(halfX, halfZ) * 2);
  const px = (x) => size / 2 + x * scale;
  const pz = (z) => size / 2 + z * scale;

  g.clearRect(0, 0, size, size);
  g.fillStyle = 'rgba(6, 10, 16, 0.55)';
  g.fillRect(0, 0, size, size);

  g.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  g.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const t = pad + (span / 6) * i;
    g.beginPath(); g.moveTo(t, pad); g.lineTo(t, pad + span); g.stroke();
    g.beginPath(); g.moveTo(pad, t); g.lineTo(pad + span, t); g.stroke();
  }

  g.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  g.lineWidth = 2;
  g.strokeRect(px(-halfX), pz(-halfZ), halfX*2*scale, halfZ*2*scale);

  if (S.arena.mesh) {
    const preview = document.querySelector(`#menuMaps [data-map="${S.arena.id}"] img`);
    if (preview?.complete && preview.naturalWidth) g.drawImage(preview, pad, pad, span, span);
  }

  for (const cr of [...S.arena.crates, ...S.arena.platforms || [], ...S.arena.ramps || [], ...S.arena.stairs || []]) {
    if (cr.type === 'beam') continue;
    g.fillStyle = cr.type === 'hay' ? '#d8b45f' : cr.type === 'barn' ? '#a05b48' : 'rgba(192, 155, 100, .5)';
    g.fillRect(
      px(cr.x - cr.w / 2),
      pz(cr.z - cr.d / 2),
      Math.max(2, cr.w * scale),
      Math.max(2, cr.d * scale),
    );
  }

  for (const solid of S.arena.rounds) {
    const radius = Math.max(...solid.parts.map(p => Math.max(p.bottom,p.top)));
    g.fillStyle = solid.type === 'feeder' ? '#c3c6bb' : '#926942';
    g.beginPath(); g.arc(px(solid.x),pz(solid.z),radius*scale,0,Math.PI*2); g.fill();
  }

  for (const v of S.players.values()) {
    if (!v.alive) continue;
    const meta = S.meta.get(v.id) || {};
    g.fillStyle = meta.color || '#ffffff';
    g.beginPath();
    g.arc(px(v.group.position.x), pz(v.group.position.z), 8, 0, Math.PI * 2);
    g.fill();
  }

  const me = S.me;
  g.save();
  g.translate(px(me.x), pz(me.z));
  g.rotate(-me.yaw);
  g.fillStyle = '#ffd23f';
  g.strokeStyle = 'rgba(0, 0, 0, 0.65)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, -18);
  g.lineTo(11, 13);
  g.lineTo(0, 6);
  g.lineTo(-11, 13);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

function updateScoreboard() {
  const rows = [...S.players.values()].map((v) => {
    const meta = S.meta.get(v.id) || { name: 'Яйцо', color: '#ffffff' };
    return { id: v.id, name: meta.name, color: meta.color, kills: v.kills, deaths: v.deaths };
  });
  rows.push({ id: S.id, name: (S.meta.get(S.id) || {}).name || 'Ты', color: (S.meta.get(S.id) || {}).color || '#ffd23f', kills: S.me.kills, deaths: S.me.deaths });
  rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

  const sig = rows.map((r) => `${r.id}:${r.name}:${r.kills}:${r.deaths}`).join('|');
  if (sig === lastScoreSig) return;
  lastScoreSig = sig;

  const el = $('scoreboard');
  el.innerHTML = '';
  for (const r of rows) {
    const li = document.createElement('li');
    if (r.id === S.id) li.classList.add('me');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = r.color;
    dot.style.color = r.color;
    const name = document.createElement('span');
    name.className = 'sb-name';
    name.textContent = r.name;
    const kills = document.createElement('span');
    kills.className = 'sb-kills';
    kills.textContent = r.kills;

    const deaths = document.createElement('span');
    deaths.className = 'sb-deaths';
    deaths.textContent = r.deaths;

    li.append(dot, name, kills, deaths);
    el.append(li);
  }
}

function addKillFeed(msg) {
  const feed = $('killfeed');
  const li = document.createElement('li');

  const k = document.createElement('span');
  k.textContent = msg.kn;
  k.style.color = msg.kc;
  k.style.fontWeight = '800';

  const skull = document.createElement('span');
  skull.className = 'skull';
  skull.textContent = msg.w === 'grenade' ? '◉' : '💥';
  skull.title = msg.w === 'grenade' ? 'Граната' : 'Выстрел';

  const v = document.createElement('span');
  v.textContent = msg.vn;
  v.style.color = msg.vc;
  v.style.fontWeight = '800';

  li.append(k, skull, v);
  feed.append(li);
  while (feed.children.length > 5) feed.firstChild.remove();
  setTimeout(() => li.remove(), 5000);
}

/* ============================ звук ============================ */

const Sound = {
  ctx: null,
  master: null,
  buffers: {},
  ready: false,
  initPromise: null,
  voices: new Set(),
  events: [],

  init() {
    if (this.initPromise) return this.initPromise;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.initPromise = Promise.resolve();
      return this.initPromise;
    }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(this.ctx.destination);

    this.buildFarmSounds();
    const files = ['shot-a', 'shot-b', 'click', 'reload-in', 'reload-out', 'step-a', 'step-b', 'step-c'];
    this.initPromise = Promise.all(files.map(async (name) => {
      try {
        const res = await fetch(`sounds/${name}.wav`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.arrayBuffer();
        this.buffers[name] = await this.ctx.decodeAudioData(data);
      } catch (e) {
        console.warn('sound', name, e.message);
      }
    })).then(() => {
      this.ready = Object.keys(this.buffers).length > 0;
    });
    return this.initPromise;
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },

  buildFarmSounds() {
    // Short material sounds are synthesized once, then played as cached buffers.
    const make = (name, duration, sample) => {
      const buffer=this.ctx.createBuffer(1,Math.ceil(this.ctx.sampleRate*duration),this.ctx.sampleRate);
      const data=buffer.getChannelData(0);let noise=0;
      for(let i=0;i<data.length;i++) {
        noise=noise*.65+(Math.random()*2-1)*.35;
        data[i]=Math.max(-1,Math.min(1,sample(i/this.ctx.sampleRate,noise)));
      }
      this.buffers[name]=buffer;
    };
    const ring=(t,f)=>Math.sin(t*f*Math.PI*2);
    make('step-wood',.22,(t,n)=>(ring(t,145)*.5+ring(t,330)*.18+n*.3)*Math.exp(-t*28));
    make('step-dirt',.2,(t,n)=>(n*.95+ring(t,72)*.13)*Math.exp(-t*23));
    make('impact-wood',.16,(t,n)=>(n*.7+ring(t,240)*.35)*Math.exp(-t*36));
    make('impact-hay',.14,(t,n)=>n*.6*Math.exp(-t*30));
    make('impact-dirt',.18,(t,n)=>n*.9*Math.exp(-t*24));
    make('impact-metal',.32,(t,n)=>(ring(t,1350)*.35+ring(t,2180)*.23+n*.15)*Math.exp(-t*14));
    make('grenade-explosion',.8,(t,n)=>(n*.9+ring(t,60)*.5)*Math.exp(-t*8)*(1-Math.exp(-t*180)));
    make('farm-wind',3,(t,n)=>n*.18*(.65+.35*Math.sin(t*Math.PI*2/3))*Math.sin(t*Math.PI/3)**2);
    make('farm-hen',.7,(t,n)=>{
      const pulse=Math.max(0,Math.sin(t*31));
      return (ring(t,430+Math.sin(t*31)*70)*.32+n*.15)*pulse**5*Math.sin(t*Math.PI/.7);
    });
    make('farm-creak',.65,(t,n)=>(ring(t,180+Math.sin(t*8)*60)*.18+n*.12)*Math.sin(t*Math.PI/.65));
  },

  play(name, { volume = .5, rate = 1, pan = 0, lowpass = 0, loop = false, channel = 'combat' } = {}) {
    if (!this.ctx || !this.buffers[name] || volume <= 0) return false;
    const src=this.ctx.createBufferSource();src.buffer=this.buffers[name];src.loop=loop;
    src.playbackRate.value=Math.max(.5,Math.min(2,rate));
    const gain=this.ctx.createGain();gain.gain.value=Math.max(0,Math.min(1,volume));
    const nodes=[src,gain];let node=src;
    if(lowpass){const f=this.ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=lowpass;node.connect(f);node=f;nodes.push(f);}
    if(this.ctx.createStereoPanner){const p=this.ctx.createStereoPanner();p.pan.value=Math.max(-1,Math.min(1,pan));node.connect(p);node=p;nodes.push(p);}
    node.connect(gain).connect(this.master);
    const voice={src,channel};
    src.onended=()=>{this.voices.delete(voice);for(const n of nodes)n.disconnect();};
    if(this.voices.size>=48){const oldest=[...this.voices].find(v=>v.channel!=='ambient');if(oldest){oldest.src.stop();this.voices.delete(oldest);}}
    this.voices.add(voice);src.start();
    if(new URLSearchParams(location.search).has('debug')) {
      this.events.push({name,volume:gain.gain.value,pan,rate,channel});
      if(this.events.length>512)this.events.shift();
    }
    return true;
  },

  stop(channel, exceptChannel) {
    for(const voice of this.voices)if((!channel||voice.channel===channel)&&voice.channel!==exceptChannel){voice.src.stop();this.voices.delete(voice);}
  },

  thump(volume = 0.15, pan = 0, channel = 'combat') {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.11);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    osc.connect(gain).connect(this.master);
    const voice={src:osc,channel};this.voices.add(voice);
    osc.onended=()=>{this.voices.delete(voice);osc.disconnect();gain.disconnect();};
    osc.start(t0);
    osc.stop(t0 + 0.15);
  },
};

Sound.init();

function tone(freq, dur, type = 'square', vol = 0.04, slideTo = null) {
  const ctx = Sound.ctx;
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(Sound.master);
  const voice={src:osc,channel:'combat'};Sound.voices.add(voice);
  osc.onended=()=>{Sound.voices.delete(voice);osc.disconnect();gain.disconnect();};
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function onShot(msg) {
  if (!msg.rays || !combat) return;
  const own = msg.i === S.id;
  const v = S.players.get(msg.i);
  const origin = msg.origin;
  if (!origin) return;
  const right = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), v?.target?.yaw || 0);
  const start = own ? muzzleWorld() : v?.gun ? v.gun.localToWorld(new THREE.Vector3(0,.02,-.61)) : new THREE.Vector3(origin.x, origin.y-.15, origin.z);
  if (!own) {
    combat.muzzle(start, right, msg.w, false);
    const spatial = soundPosition(origin);
    if (spatial.volume > 0) playWeaponSound({id:msg.w}, spatial);
  }
  let audible = false;
  for (const ray of msg.rays) {
    combat.tracer(start, ray.point);
    combat.impact(ray);
    if (!audible && ray.material && ray.material !== 'egg') {
      const spatial = soundPosition(ray.point);
      Sound.play('impact-'+ray.material, {...spatial,volume:spatial.volume*.28});
      audible = true;
    }
  }
}

function soundPosition(point) {
  const dx=point.x-S.me.x,dz=point.z-S.me.z;
  const distance=Math.hypot(dx,dz,(point.y||0)-S.me.y);
  const pan=distance>.05 ? (dx*Math.cos(S.me.yaw)-dz*Math.sin(S.me.yaw))/distance*.85 : 0;
  return {volume:distance>45?0:1/(1+distance/7),pan,lowpass:distance>8?Math.max(800,5000-distance*90):0};
}

function footMaterial(x,y,z) {
  if (!S.arena || y < .2) return 'dirt';
  const floor = ArenaGeometry.groundHeight(S.arena,x,z,y+.15);
  return Math.abs(floor-y)<.2 && floor>.2 ? 'wood' : 'dirt';
}

function updateAmbience() {
  if (performance.now() < ambientAt || !Sound.ready) return;
  if (!ambientAt) Sound.play('farm-wind', {volume:.035,loop:true,channel:'ambient'});
  else Sound.play(Math.random()<.6?'farm-hen':'farm-creak',{volume:.055,pan:(Math.random()-.5)*1.4,channel:'ambient'});
  ambientAt = performance.now() + 9000 + Math.random()*6000;
}

let footstepCount = 0;

function playFootstep(volume, pan = 0, rate = 1, lowpass = 0, material = 'dirt') {
  footstepCount += 1;
  Sound.resume();
  Sound.play('step-'+material, {volume,pan,rate:rate*(.94+Math.random()*.12),lowpass});
}

function playHit() { tone(1080, 0.05, 'sine', 0.045, 820); }
function playKill() { tone(1320, 0.11, 'sine', 0.045, 720); }
function playHurt() { tone(150, 0.18, 'triangle', 0.06, 70); }
function playDeath() { tone(180, 0.5, 'sawtooth', 0.045, 40); }

/* ============================ ввод ============================ */

document.addEventListener('mousemove', (e) => {
  if (!S.locked || S.screen !== 'hud') return;
  const w = currentWeapon();
  const aimMult = S.me.aiming ? (w && w.zoom ? 0.32 : SETTINGS.ads) : 1;
  const sens = 0.0022 * SETTINGS.sens * aimMult;
  S.me.yaw -= e.movementX * sens;
  S.me.pitch -= e.movementY * sens;
  S.me.pitch = Math.max(-1.45, Math.min(1.45, S.me.pitch));
});

document.addEventListener('keydown', (e) => {
  Sound.resume();
  if (e.code === 'Escape' && !$('settings').classList.contains('hidden')) {
    closeSettings();
    return;
  }
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (e.code === 'Tab') {
    if (S.screen === 'hud') { e.preventDefault(); $('scorePanel').classList.remove('hidden'); }
    return;
  }
  if (e.code === 'Space' && S.screen === 'hud' && S.locked) {
    e.preventDefault();
    if (!e.repeat) jumpQueued = true;
  }
  if (S.screen === 'hud' && S.locked) S.keys[e.code] = true;
  if (e.code === 'Escape' && S.screen === 'hud') openPause();

  if (e.code === 'F2') { e.preventDefault();levelView?.toggleDebug(); }

  if (e.code === 'F3') {
    e.preventDefault();
    fpsVisible = !fpsVisible;
    localStorage.setItem('egg-fps', fpsVisible ? '1' : '0');
    updateFpsLabel();
  }

  if (S.screen === 'hud' && S.locked) {
    if (e.code === 'KeyG') { e.preventDefault(); if (!e.repeat) throwGrenade(); }
    if (e.code === 'KeyR') startReload();
    const m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
    if (m) {
      const id = S.slots[Number(m[1]) - 1];
      if (id) switchWeapon(id);
    }
  }
});

document.addEventListener('keyup', (e) => {
  S.keys[e.code] = false;
  if (e.code === 'Tab') $('scorePanel').classList.add('hidden');
});

window.addEventListener('blur', () => { S.keys = Object.create(null); S.firing = false; jumpQueued = false; stopAim(); });

canvas.addEventListener('mousedown', () => Sound.resume());

canvas.addEventListener('mousedown', (e) => {
  if (S.screen !== 'hud') return;

  if (e.button === 2) {
    if (!S.locked) return;
    startAim();
    return;
  }

  if (e.button !== 0) return;
  if (!S.locked) {
    canvas.requestPointerLock?.();
    return;
  }

  S.firing = true;
  tryFire();
});

document.addEventListener('mouseup', (e) => {
  if (e.button === 0) S.firing = false;
  if (e.button === 2) stopAim();
});

document.addEventListener('wheel', (e) => {
  if (S.screen !== 'hud' || !S.locked) return;
  e.preventDefault();
  cycleWeapon(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

document.addEventListener('pointerlockchange', () => {
  S.locked = document.pointerLockElement === canvas;
  if (S.screen === 'hud') {
    const showPause = !S.locked;
    $('pause').classList.toggle('hidden', !showPause);
    if (!S.locked) {
      S.keys = Object.create(null);
      S.firing = false;
      jumpQueued = false;
      if (S.me.aiming) stopAim();
    }
  }
});

document.addEventListener('pointerlockerror', () => {
  S.locked = false;
});

document.addEventListener('contextmenu', (e) => e.preventDefault());

function sendInput() {
  if (S.screen === 'hud' && S.me.alive) {
    send({
      t: 'input',
      x: S.me.x, y: S.me.y, z: S.me.z,
      yaw: S.me.yaw, pitch: S.me.pitch,
    });
  }
}
setInterval(sendInput, 50);

/* ============================ кнопки ============================ */

function openPause() {
  if (S.screen !== 'hud') return;
  S.keys = Object.create(null);
  S.firing = false;
  stopAim();
  if (document.pointerLockElement) document.exitPointerLock();
  $('pause').classList.remove('hidden');
}

function returnToRoom() {
  if (!S.code) return;
  S.keys = Object.create(null);
  S.firing = false;
  jumpQueued = false;
  resetZoom();
  closeSettings();
  $('scorePanel').classList.add('hidden');
  $('lobbyCode').textContent = S.code;
  $('lobbyLink').value = `${location.origin}/?room=${S.code}`;
  show('lobby');
  if (document.pointerLockElement) document.exitPointerLock();
  renderLobbyPlayers();
  send({ t: 'lobby' });
}

function leaveRoom() {
  S.keys = Object.create(null);
  S.firing = false;
  send({ t: 'leave' });
  showMenu();
  location.href = location.origin;
}

$('btnGameMenu').addEventListener('click', openPause);
$('btnResumeGame').addEventListener('click', async () => {
  try { await canvas.requestPointerLock?.(); } catch { /* keep the menu available */ }
});
$('btnPauseLobby').addEventListener('click', returnToRoom);
$('btnPauseLeave').addEventListener('click', leaveRoom);
$('btnResumeMatch').addEventListener('click', () => send({ t: 'resume' }));

function openSettings() {
  $('settings').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

function closeSettings() {
  $('settings').classList.add('hidden');
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (e) {
    /* браузер может запретить без жеста */
  }
}

function updateFullscreenLabels() {
  const label = document.fullscreenElement ? '⛶ Выйти из полноэкранного' : '⛶ На весь экран';
  for (const id of ['btnFullscreen', 'btnPauseFullscreen']) {
    const b = $(id);
    if (b) b.textContent = label;
  }
}

$('btnFullscreen').addEventListener('click', toggleFullscreen);
$('btnPauseFullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenLabels);

$('btnSettings').addEventListener('click', openSettings);
$('btnPauseSettings').addEventListener('click', openSettings);
$('btnSettingsClose').addEventListener('click', closeSettings);

$('sensRange').value = String(SETTINGS.sens);
$('sensVal').textContent = SETTINGS.sens.toFixed(2);
$('sensRange').addEventListener('input', (e) => {
  SETTINGS.sens = parseFloat(e.target.value);
  $('sensVal').textContent = SETTINGS.sens.toFixed(2);
  localStorage.setItem('egg-sens', String(SETTINGS.sens));
});

$('adsSensRange').value = String(SETTINGS.ads);
$('adsSensVal').textContent = SETTINGS.ads.toFixed(2);
$('adsSensRange').addEventListener('input', (e) => {
  SETTINGS.ads = parseFloat(e.target.value);
  $('adsSensVal').textContent = SETTINGS.ads.toFixed(2);
  localStorage.setItem('egg-ads', String(SETTINGS.ads));
});

$('fpsCheck').checked = fpsVisible;
$('fpsCheck').addEventListener('change', (e) => {
  fpsVisible = e.target.checked;
  localStorage.setItem('egg-fps', fpsVisible ? '1' : '0');
  updateFpsLabel();
});

function openPlayMenu() {
  $('btnPlay').classList.add('hidden');
  $('playMenu').classList.remove('hidden');
  document.querySelector('.menu-controls').classList.add('play-open');
  if ($('name').value.trim()) $('code').focus();
  else $('name').focus();
}

$('name').addEventListener('input', updateLobbyIdentity);
$('btnPlay').addEventListener('click', openPlayMenu);

$('btnPlayBack').addEventListener('click', () => {
  $('playMenu').classList.add('hidden');
  $('btnPlay').classList.remove('hidden');
  document.querySelector('.menu-controls').classList.remove('play-open');
});

$('btnCreate').addEventListener('click', createRoom);
$('btnJoin').addEventListener('click', joinRoom);

$('code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});
$('name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') openPlayMenu();
});

$('btnStart').addEventListener('click', () => send({ t: 'start' }));
$('btnAgain').addEventListener('click', () => send({ t: 'start' }));

async function copyInvite(btn) {
  const link = `${location.origin}/?room=${S.code}`;
  try {
    await navigator.clipboard.writeText(link);
    const old = btn.textContent;
    btn.textContent = 'Скопировано!';
    setTimeout(() => { btn.textContent = old; }, 1600);
  } catch {
    const input = $('lobbyLink');
    if (input) {
      input.value = link;
      input.select();
      input.setSelectionRange(0, link.length);
    }
  }
}

$('btnCopy').addEventListener('click', () => copyInvite($('btnCopy')));
$('btnCopy2').addEventListener('click', () => copyInvite($('btnCopy2')));

$('lobbyLink').addEventListener('focus', (e) => e.target.select());

$('btnToLobby').addEventListener('click', returnToRoom);

$('btnStuck').addEventListener('click', () => {
  const code = encodeURIComponent(S.code || '');
  location.href = `${location.origin}/?room=${code}&autojoin=1`;
});

$('btnLeave').addEventListener('click', leaveRoom);
$('btnMenu').addEventListener('click', leaveRoom);

/* ============================ старт ============================ */

document.documentElement.dataset.gameReady = '1';
$('boot')?.classList.add('hidden');

(function boot() {
  try {
    initMapSelection();
    initLobby();
  } catch (e) {
    console.error('lobby init failed', e);
  }

  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }

  const saved = localStorage.getItem('egg-name');
  if (saved) $('name').value = saved;
  updateLobbyIdentity();

  const params = new URLSearchParams(location.search);
  const room = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (room) $('code').value = room;

  if (room) $('code').value = room;

  const savedName = localStorage.getItem('egg-name');

  if (room && (params.get('autojoin') === '1' || savedName)) {
    setTimeout(() => joinRoom(), 250);
  } else if (room) {
    $('menuMsg').textContent = `Тебя пригласили в комнату ${room}`;
    openPlayMenu();
    $('name').focus();
  } else {
    $('name').focus();
  }
})();

/* ============================ отладка ============================ */

if (new URLSearchParams(location.search).has('debug')) {
  window.__egg = { S, fire: tryFire, tryFire, throwGrenade, getGrenades: () => grenadeEffects?.stats(), send, Sound, switchWeapon, startReload, setZoom, cycleWeapon, updateHud, settings: SETTINGS, getFootsteps: () => footstepCount, getLevelView: () => levelView?.inspect(), getCombat: () => ({...combat?.stats(), kick:recoil, muzzle:!!muzzle?.visible, pendingSounds:soundTimers.size, audio:Sound.events.slice(), hitReaction:Math.max(0,...[...S.players.values()].map(v=>v.hitReaction||0))}), quality: QUALITY, getFov: () => camera ? camera.fov : null, applyResolution, getInfo: () => renderer ? { ...renderer.info.render } : null };
}
