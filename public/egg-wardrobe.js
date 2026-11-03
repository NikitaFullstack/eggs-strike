/* Menu-only customization UI. The preview uses the same model as the match. */
(function (root) {
  'use strict';
  const paths = {
    smile: '<circle cx="13" cy="11" r="2"/><circle cx="27" cy="11" r="2"/><path d="M12 20 Q20 29 28 20"/>',
    fierce: '<path d="m9 7 8 4m14-4-8 4M12 23q8-5 16 0"/><circle cx="13" cy="14" r="2"/><circle cx="27" cy="14" r="2"/>',
    sleepy: '<path d="M9 13q4 4 8 0m6 0q4 4 8 0M17 23h6"/>',
    wink: '<circle cx="13" cy="11" r="2"/><path d="m24 10 6 3-6 2M12 21q8 7 16-1"/>',
    surprised: '<circle cx="13" cy="10" r="2"/><circle cx="27" cy="10" r="2"/><ellipse cx="20" cy="23" rx="4" ry="5"/>',
    cool: '<path d="M6 9h28M17 11h6"/><path d="M8 10h9v7H8zm15 0h9v7h-9z" fill="currentColor"/><path d="m15 24 11-2"/>',
    none: '<ellipse cx="20" cy="17" rx="10" ry="13"/><path d="M13 21q7 5 14 0"/>',
    cap: '<path d="M9 22v-5a11 11 0 0 1 22 0v5H9Zm0 0-6 4h28v-4M20 7v15"/>',
    beanie: '<path d="M9 21v-5a11 11 0 0 1 22 0v5M8 21h24v7H8ZM15 10v10m10-10v10"/><circle cx="20" cy="5" r="3"/>',
    crown: '<path d="m7 9 7 7 6-12 6 12 7-7-3 19H10ZM10 24h20"/><circle cx="20" cy="21" r="2"/>',
    cowboy: '<path d="m12 23 2-17 6 4 6-4 2 17M12 19h16M4 20q-1 10 16 10t16-10q-16 11-32 0"/>',
    chef: '<path d="M11 19C0 16 7 3 15 7c1-8 15-8 16 1 9-1 9 13-2 12v10H11ZM11 25h18"/>',
    wizard: '<path d="m10 25 9-23 5 6 6 17M4 26q16 8 32 0L30 24H10ZM20 12l-2 5 5-2"/>',
  };
  function icon(kind, id) {
    return `<svg viewBox="0 0 40 34" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[id] || paths[kind === 'face' ? 'smile' : 'none']}</svg>`;
  }

  function create(THREE, { getAppearance, onChange }) {
    const $ = id => document.getElementById(id);
    const dialog = $('wardrobe'), canvas = $('avatarPreview');
    let renderer, scene, camera, avatar, angle = -.22, dragX = null;
    let previousFocus = null, width = 0, height = 0;

    function refresh() {
      const appearance = getAppearance();
      for (const button of dialog.querySelectorAll('[data-appearance]')) {
        button.setAttribute('aria-pressed', String(appearance[button.dataset.appearance] === button.dataset.value));
      }
      const color = EggAppearance.COLORS.find(option => option.value === appearance.color);
      const hat = EggAppearance.HATS.find(option => option.id === appearance.hat);
      $('appearanceName').textContent = `${color.name} · ${hat.name}`;
      if (avatar) EggAvatar.apply(THREE, avatar, appearance);
    }

    function choose(value) {
      const saved = onChange(EggAppearance.normalize(value, getAppearance()));
      $('appearanceStatus').textContent = saved ? 'Образ сохранён' : 'Образ выбран на эту сессию';
      refresh();
    }

    for (const [field, options, container] of [
      ['color', EggAppearance.COLORS, 'appearanceColors'],
      ['face', EggAppearance.FACES, 'appearanceFaces'],
      ['hat', EggAppearance.HATS, 'appearanceHats'],
    ]) {
      for (const option of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.appearance = field;
        button.dataset.value = field === 'color' ? option.value : option.id;
        button.setAttribute('aria-label', option.name);
        button.title = option.name;
        button.className = field === 'color' ? 'appearance-color' : 'appearance-option';
        if (field === 'color') {
          button.style.setProperty('--shell-color', option.value);
          button.innerHTML = '<i aria-hidden="true"></i>';
        } else {
          button.innerHTML = icon(field, option.id);
          const label = document.createElement('span');
          label.textContent = option.name;
          button.append(label);
        }
        button.addEventListener('click', () => choose({ [field]: button.dataset.value }));
        $(container).append(button);
      }
    }

    function initPreview() {
      if (renderer) return;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(36, 1, .1, 20);
      camera.position.set(0, 1.3, -4.3);
      camera.lookAt(0, .94, 0);
      scene.add(new THREE.HemisphereLight(0xe3fff1, 0x324036, 2.1));
      const key = new THREE.DirectionalLight(0xfff1dc, 3.2);
      key.position.set(-3, 4, -4); scene.add(key);
      const rim = new THREE.DirectionalLight(0x8ddfc1, 2.4);
      rim.position.set(3, 2, 2); scene.add(rim);
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.77, .84, .12, 48), new THREE.MeshPhongMaterial({ color: 0x314c3c, shininess: 35 }));
      plinth.position.y = -.075; scene.add(plinth);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.77, .012, 8, 64), new THREE.MeshBasicMaterial({ color: 0xd9ff56 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = -.008; scene.add(ring);
      avatar = EggAvatar.create(THREE, getAppearance());
      scene.add(avatar.group);
    }

    function render() {
      if (!dialog.open || !renderer) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (width !== rect.width || height !== rect.height) {
        width = rect.width; height = rect.height;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        // Keep the full wizard hat and plinth in view in the shorter mobile preview.
        camera.position.z = -Math.max(4.3, 3.2 / camera.aspect);
        camera.updateProjectionMatrix();
      }
      avatar.group.rotation.y = angle;
      renderer.render(scene, camera);
    }

    function open() {
      if (dialog.open) return;
      previousFocus = document.activeElement;
      initPreview();
      refresh();
      dialog.showModal();
      render();
      $('btnWardrobeClose').focus();
    }
    function close() { if (dialog.open) dialog.close(); }
    dialog.addEventListener('close', () => { dragX = null; previousFocus?.focus(); });
    $('btnCustomize').addEventListener('click', open);
    $('btnWardrobeClose').addEventListener('click', close);
    $('btnWardrobeDone').addEventListener('click', close);
    $('btnAppearanceRandom').addEventListener('click', () => {
      const random = items => items[Math.floor(Math.random() * items.length)];
      choose({ color: random(EggAppearance.COLORS).value, face: random(EggAppearance.FACES).id, hat: random(EggAppearance.HATS).id });
    });
    canvas.addEventListener('pointerdown', event => { dragX = event.clientX; canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', event => {
      if (dragX === null) return;
      angle -= (event.clientX - dragX) * .012;
      dragX = event.clientX;
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { dragX = null; });
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); angle += event.key === 'ArrowLeft' ? .2 : -.2;
    });
    refresh();
    return { open, close, render, refresh };
  }
  root.EggWardrobe = { create, icon };
})(globalThis);
