/* Shared, whitelisted egg customization for the browser and game server. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EggAppearance = api;
})(globalThis, function () {
  'use strict';

  const freezeOptions = options => Object.freeze(options.map(option => Object.freeze(option)));
  const COLORS = freezeOptions([
    { id: 'yolk', name: 'Желток', value: '#ffd23f' },
    { id: 'cream', name: 'Сливочный', value: '#fff1d2' },
    { id: 'pink', name: 'Розовый', value: '#ff88b0' },
    { id: 'coral', name: 'Коралловый', value: '#ff765e' },
    { id: 'mint', name: 'Мятный', value: '#65d6b0' },
    { id: 'sky', name: 'Небесный', value: '#70b7ff' },
    { id: 'lavender', name: 'Лавандовый', value: '#b69cff' },
    { id: 'graphite', name: 'Графитовый', value: '#52616b' },
  ]);
  const FACES = freezeOptions([
    { id: 'smile', name: 'Улыбка' },
    { id: 'fierce', name: 'Боевой' },
    { id: 'sleepy', name: 'Сонный' },
    { id: 'wink', name: 'Подмигивание' },
    { id: 'surprised', name: 'Удивление' },
    { id: 'cool', name: 'Крутой' },
  ]);
  const HATS = freezeOptions([
    { id: 'none', name: 'Без шапки' },
    { id: 'cap', name: 'Кепка' },
    { id: 'beanie', name: 'Шапка' },
    { id: 'crown', name: 'Корона' },
    { id: 'cowboy', name: 'Ковбойская' },
    { id: 'chef', name: 'Колпак повара' },
    { id: 'wizard', name: 'Волшебник' },
  ]);
  const DEFAULT = Object.freeze({ color: COLORS[0].value, face: FACES[0].id, hat: HATS[0].id });
  const allowed = {
    color: new Set(COLORS.map(option => option.value)),
    face: new Set(FACES.map(option => option.id)),
    hat: new Set(HATS.map(option => option.id)),
  };

  function field(source, name) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || !Object.hasOwn(source, name)) return undefined;
    const value = source[name];
    return name === 'color' && typeof value === 'string' ? value.toLowerCase() : value;
  }

  function normalize(value, fallback = DEFAULT) {
    const appearance = {};
    for (const name of ['color', 'face', 'hat']) {
      const preferred = field(value, name), inherited = field(fallback, name);
      appearance[name] = allowed[name].has(preferred) ? preferred : allowed[name].has(inherited) ? inherited : DEFAULT[name];
    }
    return appearance;
  }

  function key(value) {
    const appearance = normalize(value);
    return `${appearance.color}|${appearance.face}|${appearance.hat}`;
  }

  return Object.freeze({ COLORS, FACES, HATS, DEFAULT, normalize, key });
});
