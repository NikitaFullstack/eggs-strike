/* Household arenas: footprints for the map, shared model meshes for the actual world. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EggHouseholdMaps = api;
})(globalThis, function () {
  'use strict';

  const box = (id, type, x, z, w, d, h, y = 0) => ({ id, type, x, y, z, w, d, h });
  const prop = (id, model, type, x, z, w, d, h, y = 0, rotation = 0) => ({...box(id,type,x,z,w,d,h,y),model,rotation});
  const spawn = (id, x, z, color) => ({ id, x, y: 0, z, target: [0, .75, 0], color });

  function base(id, name, household, width, depth, wallHeight, wallType, theme) {
    const t = .3;
    return {
      id, name, household, mesh: true,
      half: Math.max(width, depth) / 2, halfX: width / 2, halfZ: depth / 2,
      bounds: { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2,
        widthX: width, depthZ: depth, floorY: 0, maxY: wallHeight },
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

  const fridge = base('refrigerator', 'Холодильник', 'fridge', 26, 22, 7, 'plastic', {
    sky: 0xcddfe0, fog: 0xe2eeee, floor: 0xd9e9e8, wall: 0xf0f6eb, accent: 0x5bbabd,
  });
  fridge.layoutRevision = 2;
  fridge.description = '26 × 22 м · 3 игрока · верхняя полка и проходы под ней';
  fridge.crates = [
    prop('FR_SHELF_BACK','shelf','plastic',0,-5.6,18,3.4,2.8),
    prop('FR_SHELF_W','shelf','plastic',-7.7,-1.9,2.6,4,2.8),
    prop('FR_SHELF_E','shelf','plastic',7.7,-1.9,2.6,4,2.8),
    prop('FR_MILK','milkCarton','milk',-5.2,-.2,2.7,2.4,3.6,0,-.06),
    prop('FR_JUICE','juiceBottle','juice',5.1,.1,2.8,2.8,4.2),
    prop('FR_BUTTER_STACK','butterDish','butter',0,-9,3.3,1.8,1.9),
    prop('FR_UPPER_MILK','milkCarton','milk',-2.2,-6.35,2.5,1.5,2,2.8),
    prop('FR_UPPER_YOGURT','yogurt','plastic',3.1,-6.3,1.7,1.5,1.8,2.8),
    prop('FR_CHEESE_BOARD','board','wood',0,1.8,4.6,3.6,.18),
    prop('FR_CHEESE','cheese','cheese',.2,1.8,2.2,1.6,1.4,.18,.2),
    prop('FR_EGG_BOX','eggCarton','plastic',-4.5,5.8,3.6,2.6,1.5,0,.12),
    prop('FR_PICKLES','jar','tin',0,-2.3,2.2,2.2,3.1),
    prop('FR_YOGURT','yogurt','plastic',4.5,6.2,2.5,2.5,2.4),
    prop('FR_TOMATO','tomato','tomato',0,6.4,1.7,1.7,1.6),
    { ...prop('FR_CEILING','box','plastic',0,0,26,22,.18,7), minimap:false },
  ];
  fridge.ramps = [
    { id:'FR_RAMP_W',type:'plastic',x:-7.7,z:2.7,w:2.6,d:5.2,dir:'-z',h0:0,h1:2.8 },
    { id:'FR_RAMP_E',type:'plastic',x:7.7,z:2.7,w:2.6,d:5.2,dir:'-z',h0:0,h1:2.8 },
  ];
  fridge.spawns = [
    spawn('FR_NW',-10.8,-8.8,'#e87763'),
    spawn('FR_NE',10.8,-8.8,'#62a5de'),
    spawn('FR_S',0,8.8,'#e2ba53'),
  ];
  fridge.showcase = {x:-9.8,y:0,z:8.4,yaw:-.48,pitch:.13};
  fridge.showcaseUpper = {x:-7.7,y:2.8,z:-4.9,yaw:-1.1,pitch:-.08};

  const kitchen = base('kitchen', 'Кухня', 'kitchen', 30, 24, 7.5, 'tile', {
    sky: 0xd5e5dd, fog: 0xf2dfbd, floor: 0xc3aa80, wall: 0xd8e8df, accent: 0xc15e40,
  });
  kitchen.layoutRevision = 2;
  kitchen.description = '30 × 24 м · 3 игрока · остров, мостик и нижние проходы';
  kitchen.crates = [
    prop('KT_ISLAND','island','wood',-3,.5,7,5,2.1),
    prop('KT_SIDE_COUNTER','island','wood',6.6,-3,5.2,6,2.1),
    { ...prop('KT_BRIDGE','bridge','wood',2.25,-1,3.5,2,.14,1.96), supports:false },
    prop('KT_TOASTER','toaster','metal',-7.4,-3,3.6,2.8,2.7,0,-.08),
    prop('KT_BREAD_BOX','breadbox','wood',-9.4,6.4,3.8,3.2,2.8,0,.07),
    prop('KT_SLICED_BREAD','loaf','bread',-4.8,-1.1,2.1,1.3,.9,2.1,.1),
    prop('KT_UPPER_MUG','mug','plastic',-4.7,2,1.8,1.5,1.5,2.1,-.3),
    prop('KT_TOMATO','tomato','tomato',-1.5,1.5,1,1,.9,2.1),
    prop('KT_BREAD','loaf','bread',3.8,7.1,3.3,1.85,1.7,0,.2),
    prop('KT_MUG','mug','plastic',6.3,2.6,3.1,2.5,2.8,0,-.3),
    prop('KT_KETTLE','kettle','metal',7.7,-3.2,2.4,2.2,2.4,2.1,-.6),
    prop('KT_COOKIE_TIN','jar','tin',0,-9.1,2.4,2.4,3.1),
    prop('KT_PLATE','plate','plastic',11.6,1.2,3.2,3.2,.28),
    { ...prop('KT_CEILING','box','plastic',0,0,30,24,.18,7.5), minimap:false },
  ];
  kitchen.ramps = [
    {id:'KT_RAMP_W',type:'wood',x:-8.9,z:1.2,w:4.8,d:2.4,dir:'+x',h0:0,h1:2.1},
    {id:'KT_RAMP_N',type:'wood',x:6.6,z:-8.1,w:2.4,d:4.2,dir:'+z',h0:0,h1:2.1},
    {id:'KT_RAMP_S',type:'wood',x:-1.8,z:5.1,w:2.4,d:4.2,dir:'-z',h0:0,h1:2.1},
  ];
  kitchen.spawns = [
    spawn('KT_NW',-12.3,-9.5,'#e87763'),
    spawn('KT_NE',12.3,-8.7,'#62a5de'),
    spawn('KT_S',2,9.8,'#e2ba53'),
  ];
  kitchen.showcase = {x:0,y:0,z:8.4,yaw:-.10,pitch:.12};
  kitchen.showcaseUpper = {x:-3.1,y:2.1,z:.4,yaw:-1.25,pitch:-.05};

  const colors = {
    plastic: '#e5eee4', metal: '#91aaa7', tile: '#a5c5bb', wood: '#b38254',
    milk: '#91bbd4', juice: '#db9462', cheese: '#edc564', butter: '#dfc981',
    tin: '#74a395', bread: '#b97943', tomato:'#cd6650',
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
      const raised = ['shelf','island','bridge'].includes(b.model);
      const round = ['juiceBottle','jar','yogurt','tomato','plate','mug','kettle'].includes(b.model);
      parts.push(`<g transform="rotate(${-(b.rotation||0)*180/Math.PI} ${b.x} ${b.z})">`);
      if (round) {
        parts.push(`<ellipse cx="${b.x}" cy="${b.z}" rx="${b.w*.42}" ry="${b.d*.42}" fill="${colors[b.type]||colors.plastic}" stroke="#54645a" stroke-width=".075"/>`);
        if (b.model === 'mug') parts.push(`<ellipse cx="${b.x}" cy="${b.z}" rx="${b.w*.29}" ry="${b.d*.29}" fill="#72877b"/>`);
      } else if (raised) {
        parts.push(rect(b, b.model === 'shelf' ? '#83c9cb' : b.model === 'bridge' ? '#f2d191' : '#c4945d', `fill-opacity=".67" stroke="#324f51" stroke-width=".12" rx=".12"`));
        parts.push(`<path d="M${b.x-b.w/2+.2} ${b.z-b.d/2+.2}h${b.w-.4}" stroke="#fff8db" stroke-width=".11"/>`);
        if (b.model !== 'bridge') parts.push(`<text x="${b.x}" y="${b.z+.13}" text-anchor="middle" fill="#244649" font-family="sans-serif" font-size=".42">↑ ${b.y+b.h} м</text>`);
      } else parts.push(rect(b, colors[b.type] || colors.plastic, `stroke="#54645a" stroke-width=".075" rx="${b.model==='loaf'?b.d*.45:.22}"`));
      if (b.type === 'milk') parts.push(rect({ ...b, w: b.w * .7, d: b.d * .33 }, '#fff6da'));
      if (b.model === 'eggCarton') for (const x of [-.29,0,.29]) for (const z of [-.22,.22]) parts.push(`<ellipse cx="${b.x+x*b.w}" cy="${b.z+z*b.d}" rx="${b.w*.1}" ry="${b.d*.16}" fill="#fff0cc" stroke="#927e5c" stroke-width=".03"/>`);
      parts.push('</g>');
    }
    for (const r of arena.rounds) parts.push(`<circle cx="${r.x}" cy="${r.z}" r="${r.parts[0].bottom}" fill="${colors[r.type]}" stroke="#52685d" stroke-width=".09"/>`);
    for (const s of arena.spawns) parts.push(`<circle cx="${s.x}" cy="${s.z}" r=".48" fill="${s.color}" stroke="#ffffff" stroke-width=".12"/>`);
    return parts.join('') + '</svg>';
  }

  return { maps: [fridge, kitchen], preview };
});
