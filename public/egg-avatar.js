(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EggAvatar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Native model: shell radius .5, feet y=0, top y=1.32, face towards -Z.
  // Hats are purely visual. The game scales this model to its existing collider.
  const FACES = new Set(['smile', 'fierce', 'sleepy', 'wink', 'surprised', 'cool']);
  const HATS = new Set(['none', 'cap', 'beanie', 'crown', 'cowboy', 'chef', 'wizard']);
  function clean(value) {
    if (globalThis.EggAppearance) return globalThis.EggAppearance.normalize(value);
    const source = value && typeof value === 'object' ? value : {};
    return {
      color: typeof source.color === 'string' && /^#[0-9a-f]{6}$/i.test(source.color) ? source.color : '#ffd23f',
      face: FACES.has(source.face) ? source.face : 'smile',
      hat: HATS.has(source.hat) ? source.hat : 'none',
    };
  }

  function material(THREE, color, shiny = false) {
    return new THREE.MeshPhongMaterial({ color, shininess: shiny ? 70 : 16, specular: shiny ? 0x777777 : 0x222222 });
  }

  function mesh(THREE, group, geometry, mat, position, scale) {
    const part = new THREE.Mesh(geometry, mat);
    if (position) part.position.set(...position);
    if (scale) part.scale.set(...scale);
    part.castShadow = false;
    group.add(part);
    return part;
  }

  function ball(THREE, group, mat, radius, position, scale) {
    return mesh(THREE, group, new THREE.SphereGeometry(radius, 20, 12), mat, position, scale);
  }

  function tube(THREE, group, mat, points, radius = .015, segments = 14, closed = false) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed);
    return mesh(THREE, group, new THREE.TubeGeometry(curve, segments, radius, 6, closed), mat);
  }

  function ring(THREE, group, mat, radius, thickness, y) {
    const part = mesh(THREE, group, new THREE.TorusGeometry(radius, thickness, 8, 32), mat, [0, y, 0]);
    part.rotation.x = Math.PI / 2;
    return part;
  }

  // Static cosmetics are merged by material: even the detailed hats need only
  // 2–5 draw calls. Every avatar owns its buffers and materials independently.
  function batch(THREE, group) {
    const batches = new Map(), oldGeometry = new Set();
    for (const part of group.children) {
      part.updateMatrix();
      let geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
      geometry.applyMatrix4(part.matrix);
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      if (!batches.has(part.material)) batches.set(part.material, { positions: [], normals: [] });
      const target = batches.get(part.material);
      target.positions.push(...geometry.attributes.position.array);
      target.normals.push(...geometry.attributes.normal.array);
      oldGeometry.add(part.geometry);
      geometry.dispose();
    }
    group.clear();
    for (const geometry of oldGeometry) geometry.dispose();
    for (const [mat, data] of batches) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      mesh(THREE, group, geometry, mat);
    }
    return group;
  }

  function disposeGroup(group) {
    const geometries = new Set(), materials = new Set();
    group.traverse(part => {
      if (part.geometry) geometries.add(part.geometry);
      if (part.material) {
        for (const mat of Array.isArray(part.material) ? part.material : [part.material]) materials.add(mat);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const mat of materials) mat.dispose();
    group.clear();
  }

  function frontZ(x, y, offset = .018) {
    const n = (y - .66) / .66;
    const radius = .5 * Math.sqrt(Math.max(.001, 1 - n * n)) * (1 - .14 * n);
    return -Math.sqrt(Math.max(.001, radius * radius - x * x)) - offset;
  }

  function makeFace(THREE, id) {
    const group = new THREE.Group();
    group.name = 'egg-face';
    group.userData.face = id;
    const ink = material(THREE, '#192335'), white = material(THREE, '#fffdf1', true);
    const blush = material(THREE, '#ef8b83');
    const stroke = (points, width = .015, mat = ink) => tube(THREE, group, mat, points.map(([x, y]) => [x, y, frontZ(x, y, .027)]), width);
    const eye = (x, wide = false) => {
      ball(THREE, group, white, .116, [x, .805, -.421], [1, wide ? 1.12 : 1, .67]);
      ball(THREE, group, ink, wide ? .044 : .052, [x + .008, .804, -.499], [1, 1.08, .52]);
      ball(THREE, group, white, .014, [x - .005, .825, -.526], [1, 1, .35]);
    };
    const cheeks = () => {
      for (const x of [-.27, .27]) {
        const cheek = ball(THREE, group, blush, .052, [x, .65, frontZ(x, .65, .012)], [1, .47, .16]);
        cheek.rotation.y = x < 0 ? -.5 : .5;
      }
    };
    if (id === 'cool') {
      const lens = material(THREE, '#132d42', true), glint = material(THREE, '#8ddce6', true);
      for (const x of [-.16, .16]) {
        const shape = new THREE.Shape();
        shape.moveTo(-.112, .078); shape.lineTo(.112, .078);
        shape.quadraticCurveTo(.145, .078, .142, .038); shape.lineTo(.121, -.05);
        shape.quadraticCurveTo(.113, -.078, .068, -.078); shape.lineTo(-.075, -.078);
        shape.quadraticCurveTo(-.122, -.078, -.135, -.035); shape.lineTo(-.147, .035);
        shape.quadraticCurveTo(-.15, .078, -.112, .078);
        const glass = mesh(THREE, group, new THREE.ExtrudeGeometry(shape, { depth: .027, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .009, bevelThickness: .008, curveSegments: 6 }), lens, [x, .804, -.51]);
        glass.rotation.y = x < 0 ? -.17 : .17;
        tube(THREE, group, glint, [[x - .072, .84, -.522], [x - .012, .84, -.53]], .009, 2);
      }
      tube(THREE, group, ink, [[-.04, .834, -.523], [0, .846, -.532], [.04, .834, -.523]], .019, 6);
      for (const sign of [-1, 1]) tube(THREE, group, ink, [[sign * .3, .84, -.465], [sign * .39, .84, -.34]], .017, 3);
      stroke([[-.12, .56], [-.025, .535], [.065, .56], [.12, .607]], .017);
    } else if (id === 'sleepy') {
      for (const x of [-.16, .16]) {
        stroke([[x - .08, .81], [x, .77], [x + .08, .81]], .021);
        stroke([[x - .075, .91], [x, .93], [x + .06, .91]], .011);
      }
      ball(THREE, group, ink, .035, [0, .555, frontZ(0, .555, .018)], [1, .75, .3]);
      cheeks();
    } else {
      eye(-.16, id === 'surprised');
      if (id === 'wink') stroke([[.08, .81], [.16, .765], [.245, .805]], .022);
      else eye(.16, id === 'surprised');
      if (id === 'fierce') {
        stroke([[-.29, .99], [-.17, .955], [-.065, .905]], .032);
        stroke([[.065, .905], [.17, .955], [.29, .99]], .032);
        stroke([[-.125, .515], [-.04, .55], [.045, .55], [.12, .515]], .018);
      } else if (id === 'surprised') {
        for (const x of [-.16, .16]) stroke([[x - .065, .99], [x, 1.018], [x + .065, .99]], .016);
        ball(THREE, group, ink, .067, [0, .55, frontZ(0, .55, .012)], [.78, 1, .3]);
        ball(THREE, group, blush, .029, [0, .519, frontZ(0, .55, .034)], [1, .5, .2]);
      } else {
        stroke([[-.15, .585], [-.09, .526], [0, .503], [.09, .526], [.15, .585]], .018);
        cheeks();
        if (id === 'wink') stroke([[-.235, .982], [-.16, 1.005], [-.09, .978]], .014);
      }
    }
    // Some expressions omit a palette material; release it before batching.
    for (const mat of [ink, white, blush]) if (!group.children.some(part => part.material === mat)) mat.dispose();
    return batch(THREE, group);
  }

  function crownGeometry(THREE) {
    const positions = [], indices = [], segments = 16;
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * Math.PI * 2;
      const height = i % 2 === 0 ? 1.56 : 1.36;
      for (const [radius, y] of [[.335, 1.18], [.335, height], [.285, 1.18], [.285, height]]) {
        positions.push(Math.sin(angle) * radius, y, -Math.cos(angle) * radius);
      }
      if (i < segments) {
        const a = i * 4, b = a + 4;
        indices.push(a, a + 1, b, b, a + 1, b + 1, a + 2, b + 2, a + 3, b + 2, b + 3, a + 3,
          a + 1, a + 3, b + 1, b + 1, a + 3, b + 3, a, b, a + 2, b, b + 2, a + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
  }

  function wizardGeometry(THREE) {
    const rings = [[0, 1.23, .335], [.015, 1.37, .28], [.025, 1.57, .22], [.005, 1.77, .15], [-.065, 1.94, .095], [-.17, 2.025, .047], [-.28, 2.025, .003]];
    const positions = [], indices = [], segments = 24;
    for (let i = 0; i < rings.length; i++) {
      const [x, y, radius] = rings[i];
      for (let j = 0; j <= segments; j++) {
        const angle = j / segments * Math.PI * 2;
        positions.push(x + Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        if (i < rings.length - 1 && j < segments) {
          const a = i * (segments + 1) + j, b = a + segments + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
  }

  function star(THREE, group, mat, size, position, rotation = 0) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const angle = Math.PI / 2 + i * Math.PI / 5, r = size * (i % 2 ? .45 : 1);
      if (i === 0) shape.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
      else shape.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    shape.closePath();
    const part = mesh(THREE, group, new THREE.ExtrudeGeometry(shape, { depth: .012, bevelEnabled: false }), mat, position);
    part.rotation.z = rotation;
    return part;
  }

  function makeHat(THREE, id) {
    const group = new THREE.Group(); group.name = 'egg-hat'; group.userData.hat = id;
    if (id === 'none') return group;
    if (id === 'cap') {
      const teal = material(THREE, '#187a78'), dark = material(THREE, '#105354'), trim = material(THREE, '#65c8b5'), logo = material(THREE, '#fff0c7');
      mesh(THREE, group, new THREE.SphereGeometry(.345, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), teal, [0, 1.205, 0]);
      mesh(THREE, group, new THREE.CylinderGeometry(.343, .35, .06, 28), dark, [0, 1.205, 0]);
      ball(THREE, group, teal, .32, [0, 1.205, -.30], [1.14, .10, 1.02]);
      ball(THREE, group, trim, .038, [0, 1.55, 0], [1, .65, 1]);
      for (const angle of [-Math.PI / 3, Math.PI / 3, Math.PI]) {
        const points = Array.from({ length: 7 }, (_, i) => {
          const a = .1 + i / 6 * 1.42;
          return [Math.sin(a) * Math.sin(angle) * .347, 1.205 + Math.cos(a) * .347, -Math.sin(a) * Math.cos(angle) * .347];
        });
        tube(THREE, group, trim, points, .005, 12);
      }
      ball(THREE, group, logo, .06, [0, 1.355, -.314], [.68, 1, .15]);
    } else if (id === 'beanie') {
      const wool = material(THREE, '#df7d38'), fold = material(THREE, '#f0a34d'), knit = material(THREE, '#c96c31'), tag = material(THREE, '#fff0ce');
      mesh(THREE, group, new THREE.SphereGeometry(.348, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), wool, [0, 1.245, 0], [1, 1.12, 1]);
      mesh(THREE, group, new THREE.CylinderGeometry(.361, .351, .15, 32), fold, [0, 1.24, 0]);
      for (let i = 0; i < 24; i++) {
        const angle = i / 24 * Math.PI * 2;
        tube(THREE, group, knit, [[Math.sin(angle) * .354, 1.185, Math.cos(angle) * .354], [Math.sin(angle) * .364, 1.305, Math.cos(angle) * .364]], .006, 2);
      }
      ball(THREE, group, fold, .105, [0, 1.69, 0]);
      for (let i = 0; i < 6; i++) ball(THREE, group, wool, .045, [Math.sin(i * Math.PI / 3) * .075, 1.705, Math.cos(i * Math.PI / 3) * .075]);
      mesh(THREE, group, new THREE.BoxGeometry(.075, .085, .012), tag, [.14, 1.245, -.335]).rotation.y = -.4;
    } else if (id === 'crown') {
      const gold = material(THREE, '#f6c64f', true), edge = material(THREE, '#fff0a8', true), ruby = material(THREE, '#e95070', true), sapphire = material(THREE, '#53c9da', true);
      mesh(THREE, group, crownGeometry(THREE), gold);
      ring(THREE, group, edge, .333, .024, 1.205);
      for (let i = 0; i < 8; i++) {
        const angle = i / 8 * Math.PI * 2;
        ball(THREE, group, edge, .026, [Math.sin(angle) * .335, 1.56, -Math.cos(angle) * .335]);
      }
      for (const [angle, mat] of [[0, ruby], [-Math.PI / 2, sapphire], [Math.PI / 2, sapphire], [Math.PI, ruby]]) {
        const gem = mesh(THREE, group, new THREE.OctahedronGeometry(.062), mat, [Math.sin(angle) * .342, 1.34, -Math.cos(angle) * .342], [.8, 1.1, .5]);
        gem.rotation.y = -angle;
      }
    } else if (id === 'cowboy') {
      const felt = material(THREE, '#b47744'), edge = material(THREE, '#dca36c'), band = material(THREE, '#5b352c'), buckle = material(THREE, '#edcc80', true);
      const positions = [], indices = [], segments = 48, rows = 5;
      const brimPoint = (angle, f) => {
        const r = .28 + f * .4;
        return [Math.cos(angle) * r, 1.215 + .15 * Math.pow(Math.abs(Math.cos(angle)), 4) * f * f - .035 * Math.abs(Math.sin(angle)) * f, Math.sin(angle) * r * .8];
      };
      for (let row = 0; row <= rows; row++) for (let i = 0; i <= segments; i++) {
        positions.push(...brimPoint(i / segments * Math.PI * 2, row / rows));
        if (row < rows && i < segments) {
          const a = row * (segments + 1) + i, b = a + segments + 1;
          indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
      felt.side = THREE.DoubleSide;
      mesh(THREE, group, geometry, felt);
      tube(THREE, group, edge, Array.from({ length: 48 }, (_, i) => brimPoint(i / 48 * Math.PI * 2, 1)), .014, 48, true);
      mesh(THREE, group, new THREE.CylinderGeometry(.275, .345, .265, 28), felt, [0, 1.355, 0], [1, 1, .86]);
      ball(THREE, group, felt, .278, [0, 1.487, 0], [1, .27, .86]);
      mesh(THREE, group, new THREE.CylinderGeometry(.325, .343, .085, 28), band, [0, 1.265, 0], [1, 1, .86]);
      const plate = mesh(THREE, group, new THREE.TorusGeometry(.043, .009, 6, 4), buckle, [0, 1.27, -.294]);
      plate.rotation.z = Math.PI / 4; plate.scale.x = 1.25;
    } else if (id === 'chef') {
      const cloth = material(THREE, '#fff9e9'), seam = material(THREE, '#d5dfdc');
      mesh(THREE, group, new THREE.CylinderGeometry(.315, .32, .24, 28), cloth, [0, 1.32, 0]);
      ring(THREE, group, seam, .318, .012, 1.21);
      for (let i = 0; i < 12; i++) {
        const angle = i / 12 * Math.PI * 2;
        tube(THREE, group, seam, [[Math.sin(angle) * .319, 1.24, Math.cos(angle) * .319], [Math.sin(angle) * .314, 1.4, Math.cos(angle) * .314]], .004, 2);
      }
      ball(THREE, group, cloth, .275, [0, 1.60, 0], [1, .85, 1]);
      for (let i = 0; i < 5; i++) {
        const angle = i / 5 * Math.PI * 2;
        ball(THREE, group, cloth, .195, [Math.sin(angle) * .20, 1.575 + (i % 2) * .035, Math.cos(angle) * .20], [1, 1.05, 1]);
      }
    } else if (id === 'wizard') {
      const velvet = material(THREE, '#6754a5'), band = material(THREE, '#352958'), trim = material(THREE, '#b199e2'), gold = material(THREE, '#f8d979', true);
      ball(THREE, group, velvet, .51, [0, 1.215, 0], [1, .095, .9]);
      mesh(THREE, group, wizardGeometry(THREE), velvet);
      mesh(THREE, group, new THREE.CylinderGeometry(.307, .332, .10, 28), band, [0, 1.29, 0]);
      ring(THREE, group, trim, .322, .013, 1.335);
      star(THREE, group, gold, .064, [-.08, 1.54, -.239], -.15);
      star(THREE, group, gold, .04, [.035, 1.79, -.147], .1);
      star(THREE, group, gold, .035, [.17, 1.43, -.231], .28);
    }
    return batch(THREE, group);
  }

  function create(THREE, value) {
    const appearance = clean(value), group = new THREE.Group();
    group.name = 'egg-avatar';
    const geometry = new THREE.SphereGeometry(.5, 32, 24), positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const taper = 1 - .14 * positions.getY(i) / .5;
      positions.setX(i, positions.getX(i) * taper);
      positions.setZ(i, positions.getZ(i) * taper);
    }
    geometry.computeVertexNormals();
    const body = mesh(THREE, group, geometry, material(THREE, appearance.color, true), [0, .66, 0], [1, 1.32, 1]);
    body.name = 'egg-shell';
    const face = makeFace(THREE, appearance.face), hat = makeHat(THREE, appearance.hat);
    group.add(face, hat);
    group.userData.appearance = { ...appearance };
    return { group, body, face, hat, appearance };
  }

  function apply(THREE, avatar, value) {
    const appearance = clean(value);
    avatar.body.material.color.set(appearance.color);
    if (appearance.face !== avatar.appearance.face) {
      avatar.group.remove(avatar.face); disposeGroup(avatar.face);
      avatar.face = makeFace(THREE, appearance.face); avatar.group.add(avatar.face);
    }
    if (appearance.hat !== avatar.appearance.hat) {
      avatar.group.remove(avatar.hat); disposeGroup(avatar.hat);
      avatar.hat = makeHat(THREE, appearance.hat); avatar.group.add(avatar.hat);
    }
    avatar.appearance = appearance;
    avatar.group.userData.appearance = { ...appearance };
    return avatar;
  }

  function dispose(avatar) { disposeGroup(avatar.group); }

  return { create, apply, dispose };
});
