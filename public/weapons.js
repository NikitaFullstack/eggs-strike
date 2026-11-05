/* Shared weapon catalogue for the browser HUD, the arsenal table and the server.
 * Damage values are per pellet. Range is the distance with full damage; past it
 * the damage falls off smoothly down to 55%. Melee weapons only work in reach. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EggWeapons = api;
})(globalThis, function () {
  'use strict';

  const LIST = [
    {
      id: 'ak', slot: 1, name: 'AK-47', short: 'AK', category: 'Автомат', level: 4,
      dmg: 29, pellets: 1, rpm: 400, mag: 30, reload: 2.4, range: 38, velocity: 715,
      spread: 0.012, recoil: 0.15, auto: true, zoom: false, melee: false,
      moveSpeed: 1, note: 'Четыре попадания, универсал',
    },
    {
      id: 'm4', slot: 2, name: 'M4A4-S', short: 'M4', category: 'Автомат', level: 4,
      dmg: 24, pellets: 1, rpm: 444, mag: 30, reload: 2.2, range: 42, velocity: 880,
      spread: 0.008, recoil: 0.11, auto: true, zoom: false, melee: false,
      moveSpeed: 1.02, note: 'Быстрее и точнее AK, слабее урон',
    },
    {
      id: 'shot', slot: 3, name: 'Дробовик', short: 'ДРБ', category: 'Дробовик', level: 3,
      dmg: 12, pellets: 9, rpm: 50, mag: 8, reload: 3.2, range: 14, velocity: 400,
      spread: 0.06, recoil: 0.24, auto: false, zoom: false, melee: false,
      moveSpeed: 0.96, note: '9 дробин, смерть в упор',
    },
    {
      id: 'awp', slot: 4, name: 'Снайперка', short: 'AWP', category: 'Снайперка', level: 5,
      dmg: 100, pellets: 1, rpm: 28, mag: 5, reload: 3.4, range: 90, velocity: 900,
      spread: 0.001, recoil: 0.3, auto: false, zoom: true, melee: false,
      moveSpeed: 0.9, note: 'Один выстрел — одно убийство',
    },
    {
      id: 'usp', slot: 5, name: 'USP-S', short: 'USP', category: 'Пистолет', level: 2,
      dmg: 19, pellets: 1, rpm: 233, mag: 12, reload: 1.9, range: 22, velocity: 380,
      spread: 0.006, recoil: 0.08, auto: false, zoom: false, melee: false,
      moveSpeed: 1.04, note: 'Точный стартовый пистолет',
    },
    {
      id: 'deagle', slot: 6, name: 'Дигл', short: 'ДИГЛ', category: 'Пистолет', level: 3,
      dmg: 52, pellets: 1, rpm: 160, mag: 7, reload: 2.3, range: 30, velocity: 430,
      spread: 0.01, recoil: 0.2, auto: false, zoom: false, melee: false,
      moveSpeed: 1, note: 'Два попадания, сильная отдача',
    },
    {
      id: 'knife', slot: 7, name: 'Нож', short: 'НОЖ', category: 'Ближний бой', level: 1,
      dmg: 55, pellets: 1, rpm: 150, mag: 0, reload: 0, range: 2.2, velocity: 0,
      spread: 0, recoil: 0.05, auto: false, zoom: false, melee: true,
      moveSpeed: 1.08, note: 'Два удара вблизи, очень быстрый',
    },
  ];

  for (const weapon of LIST) {
    const hit = weapon.dmg * weapon.pellets;
    weapon.shotsToKill = Math.max(1, Math.ceil(100 / hit));
    weapon.dps = Math.round(hit * weapon.rpm / 60);
    weapon.ttk = Math.round((weapon.shotsToKill - 1) * 60 / weapon.rpm * 100) / 100;
    weapon.rangeLabel = weapon.melee ? `${weapon.range.toFixed(1)} м` : `${weapon.range} м`;
    weapon.speedLabel = weapon.melee ? 'взмах' : `${weapon.velocity} м/с`;
    weapon.fireLabel = `${weapon.rpm} выстр./мин`;
    Object.freeze(weapon);
  }
  Object.freeze(LIST);

  const BY_ID = Object.fromEntries(LIST.map(weapon => [weapon.id, weapon]));
  Object.freeze(BY_ID);

  function damageAtRange(weapon, distance) {
    if (weapon.melee) return distance <= weapon.range ? weapon.dmg : 0;
    if (distance <= weapon.range) return weapon.dmg;
    const falloff = weapon.range * 0.75;
    const t = Math.min(1, (distance - weapon.range) / falloff);
    return weapon.dmg * (1 - 0.45 * t);
  }

  function summary() {
    return LIST.map(weapon => ({
      id: weapon.id, slot: weapon.slot, name: weapon.name, category: weapon.category,
      level: weapon.level, dmg: weapon.dmg, pellets: weapon.pellets, dps: weapon.dps,
      rpm: weapon.rpm, mag: weapon.mag, reload: weapon.reload, range: weapon.range,
      velocity: weapon.velocity, spread: weapon.spread, recoil: weapon.recoil,
      ttk: weapon.ttk, melee: weapon.melee,
    }));
  }

  return Object.freeze({ LIST, BY_ID, damageAtRange, summary });
});
