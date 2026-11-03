/* Original compact arenas. Coordinates are shared by rendering, movement and hits. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EggHouseholdMaps = api;
})(globalThis, function () {
  'use strict';

  const box = (id, type, x, z, w, d, h, y = 0) => ({ id, type, x, y, z, w, d, h });
  const jar = (id, skin, x, z, radius, height) => ({
    id, type: skin, x, y: 0, z,
    parts: [{ y: 0, h: height, bottom: radius, top: radius, skin }],
  });
  const spawn = (id, x, z, color) => ({ id, x, y: 0, z, target: [0, .75, 0], color });

  function base(id, name, household, width, depth, wallHeight, wallType, theme) {
    const t = .3;
    return {
      id, name, household,
      half: Math.max(width, depth) / 2, halfX: width / 2, halfZ: depth / 2,
      bounds: { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2,
        widthX: width, depthZ: depth, floorY: 0 },
      boundaryHeight: wallHeight,
      players: { min: 1, max: 3 },
      playerCollision: { radius: .34, height: 1.15, maxWalkableSlopeDegrees: 35,
        maxStepHeight: .23, walkSpeedMetersPerSecond: 4.5 },
      spawnRules: { initialImmunitySeconds: 1.5, minimumEnemyDistanceOnRespawn: 5,
        avoidEnemyLineOfSight: true, fallback: 'pick furthest free spawn' },
      theme,
      walls: [
        box(id + '_N', wallType, 0, -depth / 2 + t / 2, width, t, wallHeight),
        box(id + '_S', wallType, 0, depth / 2 - t / 2, width, t, wallHeight),
        box(id + '_W', wallType, -width / 2 + t / 2, 0, t, depth, wallHeight),
        box(id + '_E', wallType, width / 2 - t / 2, 0, t, depth, wallHeight),
      ],
      crates: [], rounds: [], platforms: [], ramps: [], stairs: [], decor: [], spawns: [],
    };
  }

  const fridge = base('refrigerator', 'Холодильник', 'fridge', 16, 14, 5.2, 'plastic', {
    sky: 0xb9dce2, fog: 0xd1e8eb, floor: 0xc5e1e2, wall: 0xf0f6eb, accent: 0x5bbabd,
  });
  fridge.description = '16 × 14 м · 3 игрока · полка и обходы';
  fridge.crates = [
    // Cartons break the three spawn-to-spawn sightlines without closing the ring.
    box('FR_MILK', 'milk', -4.25, -2.4, 1.9, 1.9, 2.7),
    box('FR_JUICE', 'juice', 4.25, -2.4, 1.9, 1.9, 2.7),
    box('FR_BUTTER_STACK', 'butter', 0, -4.8, 2.2, 1.55, 1.8),
    // A low cheese board is traversable from both ends; no ladder or jump needed.
    box('FR_CHEESE_BOARD', 'cheese', 0, 1, 3.2, 2.1, 1.2),
    box('FR_EGG_BOX', 'plastic', -5.05, 3.65, 1.8, 1.6, 1.25),
    { ...box('FR_CEILING', 'plastic', 0, 0, 16, 14, .18, 5.2), minimap: false },
  ];
  fridge.rounds = [
    jar('FR_PICKLES', 'tin', 0, -1.8, .7, 1.7),
    jar('FR_YOGURT', 'plastic', 5.05, 3.65, .9, 1.5),
  ];
  fridge.ramps = [
    { id: 'FR_RAMP_W', type: 'cheese', x: -2.9, z: 1, w: 2.6, d: 2.1, dir: '+x', h0: 0, h1: 1.2 },
    { id: 'FR_RAMP_E', type: 'cheese', x: 2.9, z: 1, w: 2.6, d: 2.1, dir: '-x', h0: 0, h1: 1.2 },
  ];
  fridge.spawns = [
    spawn('FR_NW', -5.8, -4.9, '#e87763'),
    spawn('FR_NE', 5.8, -4.9, '#62a5de'),
    spawn('FR_S', 0, 5.1, '#e2ba53'),
  ];

  const kitchen = base('kitchen', 'Кухня', 'kitchen', 18, 14, 3.6, 'tile', {
    sky: 0xd5e5dd, fog: 0xf2dfbd, floor: 0xc3aa80, wall: 0xd8e8df, accent: 0xc15e40,
  });
  kitchen.description = '18 × 14 м · 3 игрока · столешница и доска';
  kitchen.crates = [
    box('KT_TOASTER', 'metal', -4.8, -2, 2.7, 2.2, 1.85),
    box('KT_BREAD_BOX', 'wood', 4.5, -1.7, 2.1, 3.2, 1.8),
    box('KT_CHOPPING_BOARD', 'wood', 0, 0, 3.2, 2.4, .85),
    box('KT_BREAD', 'bread', -4.9, 3.7, 2.1, 1.4, 1.2),
    box('KT_TEA_BOX', 'juice', 4.75, 3.65, 1.75, 1.6, 1.55),
  ];
  kitchen.rounds = [jar('KT_COOKIE_TIN', 'tin', 0, -5.1, .75, 2.05)];
  kitchen.ramps = [
    { id: 'KT_RAMP_N', type: 'wood', x: 0, z: -2.4, w: 2, d: 2.4, dir: '+z', h0: 0, h1: .85 },
    { id: 'KT_RAMP_S', type: 'wood', x: 0, z: 2.4, w: 2, d: 2.4, dir: '-z', h0: 0, h1: .85 },
  ];
  kitchen.spawns = [
    spawn('KT_NW', -6.6, -4.8, '#e87763'),
    spawn('KT_NE', 6.6, -4.8, '#62a5de'),
    spawn('KT_S', 0, 5.2, '#e2ba53'),
  ];

  const colors = {
    plastic: '#e5eee4', metal: '#91aaa7', tile: '#a5c5bb', wood: '#b38254',
    milk: '#91bbd4', juice: '#db9462', cheese: '#edc564', butter: '#dfc981',
    tin: '#74a395', bread: '#b97943',
  };
  function preview(arena) {
    const a = arena.bounds;
    const rect = (b, fill, extra = '') => `<rect x="${b.x - b.w / 2}" y="${b.z - b.d / 2}" width="${b.w}" height="${b.d}" fill="${fill}" ${extra}/>`;
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${a.minX - 1} ${a.minZ - 1} ${a.widthX + 2} ${a.depthZ + 2}">`,
      `<rect x="${a.minX - 1}" y="${a.minZ - 1}" width="${a.widthX + 2}" height="${a.depthZ + 2}" fill="${arena.household === 'fridge' ? '#4d747b' : '#4b6258'}"/>`,
      rect({ x: 0, z: 0, w: a.widthX, d: a.depthZ }, arena.household === 'fridge' ? '#d5e7e4' : '#d9bd8f', 'rx=".4"'),
    ];
    for (let z = a.minZ + 1; z < a.maxZ; z += 1.5) {
      parts.push(`<path d="M${a.minX + .3} ${z}H${a.maxX - .3}" stroke="${arena.household === 'fridge' ? '#b7d2cf' : '#c6a87b'}" stroke-width=".035"/>`);
    }
    for (const r of arena.ramps) {
      parts.push(rect(r, colors[r.type], 'stroke="#806d45" stroke-width=".06"'));
      for (let i = 1; i < 8; i++) {
        const xAxis = r.dir.endsWith('x');
        const x = r.x - r.w / 2 + r.w * i / 8, z = r.z - r.d / 2 + r.d * i / 8;
        parts.push(xAxis
          ? `<path d="M${x} ${r.z - r.d / 2}v${r.d}" stroke="#fff6d4" stroke-width=".05"/>`
          : `<path d="M${r.x - r.w / 2} ${z}h${r.w}" stroke="#fff6d4" stroke-width=".05"/>`);
      }
    }
    for (const b of [...arena.walls, ...arena.crates]) {
      if (b.minimap === false) continue;
      parts.push(rect(b, colors[b.type] || colors.plastic, 'stroke="#54645a" stroke-width=".075" rx=".08"'));
      if (b.type === 'milk' || b.type === 'juice') parts.push(rect({ ...b, w: b.w * .7, d: b.d * .33 }, '#fff6da'));
    }
    for (const r of arena.rounds) parts.push(`<circle cx="${r.x}" cy="${r.z}" r="${r.parts[0].bottom}" fill="${colors[r.type]}" stroke="#52685d" stroke-width=".09"/>`);
    for (const s of arena.spawns) parts.push(`<circle cx="${s.x}" cy="${s.z}" r=".48" fill="${s.color}" stroke="#ffffff" stroke-width=".12"/>`);
    return parts.join('') + '</svg>';
  }

  return { maps: [fridge, kitchen], preview };
});
