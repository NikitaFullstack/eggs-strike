/* Authored household models. The same curved surfaces feed rendering and physics. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EggHouseholdShapes = api;
})(globalThis, function () {
  'use strict';
  function build(THREE, arena) {
    const parts = [], vector = new THREE.Vector3();
    let prop, transform, sequence;
    function begin(p) {
      prop = p; sequence = 0;
      transform = new THREE.Matrix4().compose(new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotation || 0),
        new THREE.Vector3(p.w || 1, p.h || 1, p.d || 1));
    }
    function add(geometry, skin, x = 0, y = 0, z = 0, rotation = [0, 0, 0], scale = [1, 1, 1], collidable = true) {
      const local = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(transform, local));
      parts.push({ id: prop.id + ':' + sequence++, propId: prop.id, skin, geometry, collidable, castShadow: collidable,
        impact: prop.id === 'floor' ? (arena.household === 'fridge' ? 'metal' : 'wood') : undefined });
      return geometry;
    }
    // Project subdivided box corners onto a rounded cuboid, with analytic normals.
    function rounded(w, h, d, r = .06, segments = 4) {
      r = Math.min(r, w / 2 - .001, h / 2 - .001, d / 2 - .001);
      const g = new THREE.BoxGeometry(w, h, d, segments, segments, segments), p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const cx = Math.max(-w / 2 + r, Math.min(w / 2 - r, x));
        const cy = Math.max(-h / 2 + r, Math.min(h / 2 - r, y));
        const cz = Math.max(-d / 2 + r, Math.min(d / 2 - r, z));
        vector.set(x - cx, y - cy, z - cz).normalize();
        p.setXYZ(i, cx + vector.x * r, cy + vector.y * r, cz + vector.z * r);
        n.setXYZ(i, vector.x, vector.y, vector.z);
      }
      return g;
    }
    function body(w, h, d, skin, x, y, z, r = .06) { return add(rounded(w, h, d, r), skin, x, y, z); }
    function lathe(points, skin, x = 0, y = 0, z = 0, segments = 24) {
      return add(new THREE.LatheGeometry(points.map(([r, h]) => new THREE.Vector2(r, h)), segments), skin, x, y, z);
    }
    function cylinder(radius, height, skin, x, y, z, rotation = [0, 0, 0], collidable = true) {
      return add(new THREE.CylinderGeometry(radius, radius, height, 24), skin, x, y, z, rotation, [1, 1, 1], collidable);
    }
    function ellipsoid(skin, x, y, z, sx, sy, sz, collidable = true) {
      return add(new THREE.SphereGeometry(1, 24, 14), skin, x, y, z, [0, 0, 0], [sx, sy, sz], collidable);
    }
    function tube(points, radius, skin, collidable = true, segments = 12) {
      const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
      return add(new THREE.TubeGeometry(curve, segments, radius, 8, false), skin, 0, 0, 0, [0, 0, 0], [1, 1, 1], collidable);
    }
    function label(skin, width, height, x, y, z, rotation = [0, 0, 0]) {
      return add(new THREE.PlaneGeometry(width, height), skin, x, y, z, rotation, [1, 1, 1], false);
    }
    // Architecture uses metre-sized details, independent of each prop's footprint.
    // Thin slabs and individual supports keep the space underneath genuinely open.
    function worldPart(geometry, skin, x = 0, y = 0, z = 0) {
      return add(geometry, skin, x / prop.w, y / prop.h, z / prop.d, [0, 0, 0], [1 / prop.w, 1 / prop.h, 1 / prop.d]);
    }
    function worldSolid(w, h, d, skin, x, y, z, radius = .025) {
      return worldPart(rounded(w, h, d, radius, 2), skin, x, y, z);
    }
    function slab(thickness, skin, radius = .12) {
      const w = prop.w, d = prop.d, r = Math.min(radius, w / 5, d / 5);
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2 + r, -d / 2); shape.lineTo(w / 2 - r, -d / 2);
      shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r); shape.lineTo(w / 2, d / 2 - r);
      shape.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2); shape.lineTo(-w / 2 + r, d / 2);
      shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r); shape.lineTo(-w / 2, -d / 2 + r);
      shape.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2); shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1, curveSegments: 5 });
      geometry.rotateX(-Math.PI / 2);
      worldPart(geometry, skin, 0, prop.h - thickness, 0);
    }
    function furniture(p) {
      const shelf = p.model === 'shelf', island = p.model === 'island';
      const thickness = Math.min(p.h, shelf ? .18 : island ? .24 : .14);
      const upper = shelf ? 'shelfGlass' : p.type === 'metal' || p.type === 'plastic' ? p.type : 'wood';
      slab(thickness, upper, shelf ? .09 : island ? .18 : .06);

      if (shelf) {
        // A stainless frame hugs the glass edge, entirely below its walking plane.
        for (const z of [-p.d / 2 + .02, p.d / 2 - .02]) {
          worldSolid(p.w - .12, .09, .038, 'chrome', 0, p.h - .08, z, .012);
          worldSolid(p.w - .35, .09, .085, 'plastic', 0, p.h - thickness - .045, Math.sign(z) * (p.d / 2 - .055), .012);
        }
        for (const x of [-p.w / 2 + .02, p.w / 2 - .02]) worldSolid(.038, .09, p.d - .12, 'chrome', x, p.h - .08, 0, .012);
      } else if (island) {
        // Painted apron and shallow drawer fronts read as a kitchen worktable,
        // while leaving a full-height passage between the four turned legs.
        for (const z of [-p.d / 2 + .12, p.d / 2 - .12]) {
          worldSolid(p.w - .35, .10, .12, 'cabinet', 0, p.h - thickness - .05, z);
          for (const x of [-p.w * .23, p.w * .23]) {
            worldSolid(p.w * .34, .12, .045, 'cabinet', x, p.h - .275, z + Math.sign(z) * .065, .018);
            const handleZ = z + Math.sign(z) * .065, handleY = p.h - .275;
            const curve = new THREE.CatmullRomCurve3([
              new THREE.Vector3(x - .18, handleY, handleZ), new THREE.Vector3(x - .15, handleY, handleZ + Math.sign(z) * .025),
              new THREE.Vector3(x + .15, handleY, handleZ + Math.sign(z) * .025), new THREE.Vector3(x + .18, handleY, handleZ),
            ]);
            worldPart(new THREE.TubeGeometry(curve, 8, .014, 6, false), 'chrome');
          }
        }
        for (const x of [-p.w / 2 + .12, p.w / 2 - .12]) worldSolid(.12, .10, p.d - .35, 'cabinet', x, p.h - thickness - .05, 0);
      } else {
        // Narrow metal strips protect a cutting-board bridge's exposed edges.
        for (const z of [-p.d / 2 + .015, p.d / 2 - .015]) worldSolid(p.w - .08, .055, .025, 'metal', 0, p.h - .09, z, .008);
      }

      const legHeight = p.h - thickness;
      if (p.supports === false || legHeight < .4) return;
      const inset = island ? .28 : .24;
      const xs = [-p.w / 2 + inset, p.w / 2 - inset];
      if (shelf && p.w > 12) xs.splice(1, 0, 0);
      for (const x of xs) for (const z of [-p.d / 2 + inset, p.d / 2 - inset]) {
        if (island) {
          const profile = [[0, 0], [.13, 0], [.14, .08], [.10, .18], [.10, legHeight - .2], [.14, legHeight - .10], [.14, legHeight], [0, legHeight]];
          worldPart(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 12), 'cabinet', x, 0, z);
        } else worldPart(new THREE.CylinderGeometry(.10, .11, legHeight, 12), 'metal', x, legHeight / 2, z);
        worldSolid(.28, .055, .28, shelf ? 'plastic' : 'rubber', x, .0275, z, .025);
      }
    }
    function breadSlice(x, y, z) {
      const shape = new THREE.Shape();
      shape.moveTo(-.32, 0); shape.lineTo(.32, 0); shape.lineTo(.32, .18);
      shape.bezierCurveTo(.41, .32, .15, .37, 0, .31); shape.bezierCurveTo(-.15, .37, -.41, .32, -.32, .18); shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: .07, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .015, bevelThickness: .012, curveSegments: 5 });
      add(g, 'crust', x, y, z - .035);
      const crumb = new THREE.ShapeGeometry(shape, 5); add(crumb, 'crumb', x, y + .022, z + .049, [0, 0, 0], [.89, .86, 1], false);
      add(new THREE.ShapeGeometry(shape, 5), 'crumb', x, y + .022, z - .049, [0, Math.PI, 0], [.89, .86, 1], false);
    }
    function model(p) {
      begin(p);
      switch (p.model) {
        case 'shelf': case 'island': case 'bridge': furniture(p); break;
        case 'milkCarton': {
          body(.88, .72, .86, 'milk', 0, .36, 0, .025);
          const roof = new THREE.Shape(); roof.moveTo(-.44, .72); roof.lineTo(0, .93); roof.lineTo(.44, .72); roof.closePath();
          add(new THREE.ExtrudeGeometry(roof, { depth: .86, bevelEnabled: false, curveSegments: 1 }), 'milk', 0, 0, -.43);
          body(.035, .055, .86, 'milk', 0, .95, 0, .008);
          cylinder(.095, .06, 'plastic', .23, .84, .12, [0, 0, -.45]);
          cylinder(.115, .05, 'chrome', .249, .88, .12, [0, 0, -.45]);
          label('milkLabel', .65, .52, 0, .36, .432);
          label('milkLabel', .65, .52, 0, .36, -.432, [0, Math.PI, 0]);
          break;
        }
        case 'juiceBottle': {
          lathe([[0, .02], [.27, .02], [.37, .06], [.4, .13], [.4, .59], [.36, .7], [.23, .8], [.15, .84], [.15, .94], [0, .94]], 'juice');
          cylinder(.17, .08, 'plastic', 0, .96, 0);
          const g = new THREE.CylinderGeometry(.402, .402, .32, 16, 1, true, -.7, 1.4);
          add(g, 'juiceLabel', 0, .41, 0, [0, 0, 0], [1, 1, 1], false);
          for (const y of [.15, .66]) add(new THREE.TorusGeometry(.397, .009, 6, 24), 'glass', 0, y, 0, [Math.PI / 2, 0, 0], [1, 1, 1], false);
          break;
        }
        case 'butterDish': {
          body(.99, .12, .94, 'ceramic', 0, .06, 0, .04);
          body(.82, .12, .78, 'ceramic', 0, .16, 0, .045);
          body(.74, .7, .66, 'butter', 0, .53, 0, .16);
          for (const y of [.35, .56, .77]) label('butter', .72, .012, 0, y, .332);
          break;
        }
        case 'eggCarton': {
          body(.98, .2, .94, 'pulp', 0, .1, 0, .07);
          body(.98, .09, .94, 'pulp', 0, .22, 0, .025);
          for (const x of [-.30, 0, .30]) for (const z of [-.23, .23]) {
            const profile = [[0, 0], [.11, .035], [.135, .12], [.14, .2], [.125, .29], [.09, .37], [.04, .42], [0, .43]];
            lathe(profile, 'egg', x, .21, z, 16);
            add(new THREE.TorusGeometry(.144, .024, 6, 16), 'pulp', x, .30, z, [Math.PI / 2, 0, 0], [1, 1, 1], false);
          }
          add(rounded(.98, .67, .055, .025), 'pulp', 0, .62, -.43, [-.09, 0, 0]);
          label('eggLabel', .62, .20, 0, .73, -.392, [-.09, 0, 0]);
          break;
        }
        case 'jar': {
          lathe([[0, .02], [.35, .02], [.42, .07], [.43, .16], [.43, .69], [.39, .78], [.32, .83], [.32, .9], [0, .9]], 'glass');
          cylinder(.355, .1, 'metal', 0, .92, 0);
          for (const y of [.885, .96]) add(new THREE.TorusGeometry(.356, .012, 6, 24), 'chrome', 0, y, 0, [Math.PI / 2, 0, 0], [1, 1, 1], false);
          add(new THREE.CylinderGeometry(.432, .432, .29, 16, 1, true, -.7, 1.4), /COOKIE/.test(p.id) ? 'cookieLabel' : 'pickleLabel', 0, .45, 0, [0, 0, 0], [1, 1, 1], false);
          break;
        }
        case 'yogurt': {
          lathe([[0, .02], [.29, .02], [.32, .08], [.43, .83], [.45, .86], [.45, .92], [0, .92]], 'yogurt');
          add(new THREE.CylinderGeometry(.413, .345, .45, 16, 1, true, -.7, 1.4), 'yogurtLabel', 0, .5, 0, [0, 0, 0], [1, 1, 1], false);
          cylinder(.465, .028, 'chrome', 0, .938, 0);
          add(new THREE.TorusGeometry(.455, .018, 6, 24), 'plastic', 0, .925, 0, [Math.PI / 2, 0, 0], [1, 1, 1], false);
          label('yogurtLabel', .54, .54, 0, .955, 0, [-Math.PI / 2, 0, 0]);
          break;
        }
        case 'cheese': {
          const shape = new THREE.Shape(); shape.moveTo(-.46, .03); shape.lineTo(.46, .03); shape.lineTo(-.46, .9); shape.closePath();
          for (const [x, y, radius] of [[-.26, .22, .08], [-.26, .58, .07], [.1, .15, .06]]) {
            const hole = new THREE.Path(); hole.absarc(x, y, radius, 0, Math.PI * 2, true); shape.holes.push(hole);
          }
          const g = new THREE.ExtrudeGeometry(shape, { depth: .86, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .018, bevelThickness: .025, curveSegments: 10 });
          add(g, 'cheese', 0, 0, -.43);
          break;
        }
        case 'toaster': {
          body(.96, .09, .88, 'rubber', 0, .045, 0, .04);
          body(.94, .61, .87, 'metal', 0, .385, 0, .13);
          body(.88, .07, .81, 'chrome', 0, .70, 0, .03);
          for (const z of [-.21, .21]) {
            body(.76, .025, .13, 'dark', 0, .741, z, .012);
            breadSlice(0, .68, z);
          }
          cylinder(.085, .05, 'chrome', .25, .36, .45, [Math.PI / 2, 0, 0]);
          cylinder(.062, .056, 'rubber', .25, .36, .46, [Math.PI / 2, 0, 0]);
          body(.025, .29, .028, 'dark', -.25, .39, .442, .005);
          body(.15, .035, .08, 'rubber', -.25, .32, .468, .012);
          break;
        }
        case 'breadbox': {
          const s = new THREE.Shape(); s.moveTo(-.47, .04); s.lineTo(.47, .04); s.lineTo(.47, .43);
          s.bezierCurveTo(.47, .76, .29, .98, 0, .98); s.bezierCurveTo(-.29, .98, -.47, .76, -.47, .43); s.closePath();
          const g = new THREE.ExtrudeGeometry(s, { depth: .88, bevelEnabled: true, bevelSize: .015, bevelThickness: .015, bevelSegments: 2, steps: 1, curveSegments: 10 });
          add(g, 'wood', 0, 0, -.44);
          for (let y = .15; y < .91; y += .075) {
            const half = y < .43 ? .45 : Math.sqrt(Math.max(0, 1 - ((y - .43) / .55) ** 2)) * .45;
            tube([[-half, y, .458], [0, y, .459], [half, y, .458]], .004, 'dark', false, 2);
          }
          tube([[-.18, .35, .45], [-.18, .35, .51], [.18, .35, .51], [.18, .35, .45]], .022, 'chrome', true, 8);
          break;
        }
        case 'loaf': {
          const g = new THREE.SphereGeometry(1, 24, 14), p = g.attributes.position;
          for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * .49, Math.max(.015, p.getY(i) * .46 + .47), p.getZ(i) * .46);
          g.computeVertexNormals(); add(g, 'crust');
          for (const x of [-.24, 0, .24]) {
            const points = [];
            for (let i = 0; i <= 8; i++) {
              const z = -.27 + i * .54 / 8, px = x + z * .18;
              const y = .47 + .46 * Math.sqrt(Math.max(0, 1 - (px / .49) ** 2 - (z / .46) ** 2)) + .005;
              points.push([px, y, z]);
            }
            tube(points, .026, 'crumb', false, 10);
            tube(points.map(p => [p[0] + .022, p[1] - .002, p[2]]), .006, 'dark', false, 10);
          }
          break;
        }
        case 'mug': {
          lathe([[0, .025], [.28, .025], [.32, .08], [.35, .87], [.35, .93], [.30, .93], [.28, .18], [0, .18]], 'ceramic', -.11);
          add(new THREE.TorusGeometry(.21, .065, 8, 24), 'ceramic', .22, .52, 0);
          add(new THREE.TorusGeometry(.326, .018, 6, 24), 'ceramic', -.11, .931, 0, [Math.PI / 2, 0, 0]);
          break;
        }
        case 'kettle': {
          lathe([[0, .03], [.28, .03], [.38, .09], [.43, .29], [.40, .52], [.31, .66], [.23, .71], [0, .71]], 'metal');
          lathe([[0, 0], [.26, 0], [.27, .035], [.21, .085], [0, .10]], 'chrome', 0, .70);
          ellipsoid('rubber', 0, .84, 0, .065, .055, .065);
          add(new THREE.TorusGeometry(.35, .046, 8, 24, Math.PI), 'rubber', 0, .58, 0);
          tube([[.28, .35, 0], [.38, .45, 0], [.46, .68, 0]], .09, 'chrome', true, 10);
          cylinder(.083, .017, 'dark', .465, .693, 0, [0, 0, -.25], false);
          break;
        }
        case 'plate': {
          lathe([[0, .05], [.28, .05], [.38, .14], [.48, .52], [.5, .76], [.48, .94], [.44, .92], [.38, .61], [.28, .35], [0, .35]], 'ceramic', 0, 0, 0, 32);
          break;
        }
        case 'tomato': {
          const g = new THREE.SphereGeometry(1, 24, 14), p = g.attributes.position;
          for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), z = p.getZ(i), ripple = 1 + .025 * Math.cos(Math.atan2(z, x) * 5);
            p.setXYZ(i, x * .47 * ripple, p.getY(i) * .44 + .46, z * .47 * ripple);
          }
          g.computeVertexNormals(); add(g, 'tomato');
          for (let i = 0; i < 5; i++) {
            const angle = i * Math.PI * 2 / 5;
            add(new THREE.SphereGeometry(1, 8, 5), 'leaf', Math.sin(angle) * .12, .89, Math.cos(angle) * .12,
              [0, angle, .15], [.045, .018, .18], false);
          }
          tube([[0, .87, 0], [.025, .95, .01], [.04, .97, .025]], .018, 'leaf', false, 5);
          break;
        }
        case 'board': body(1, 1, 1, 'wood', 0, .5, 0, .02); break;
        default: add(new THREE.BoxGeometry(1, 1, 1), p.minimap === false ? 'ceiling' : p.type || 'plastic', 0, .5, 0);
      }
    }
    begin({ id: 'floor', x: 0, y: arena.bounds.floorY, z: 0, w: arena.bounds.widthX, h: 1, d: arena.bounds.depthZ });
    add(new THREE.PlaneGeometry(1, 1), 'floor', 0, 0, 0, [-Math.PI / 2, 0, 0]);
    for (const wall of arena.walls || []) { begin(wall); add(new THREE.BoxGeometry(1, 1, 1), arena.household === 'fridge' ? 'plastic' : 'wall', 0, .5, 0); }
    for (const p of arena.crates || []) model(p);
    for (const ramp of arena.ramps || []) {
      begin({ ...ramp, h: 1, y: 0 });
      const geo = new THREE.BoxGeometry(1, 1, 1), p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const alongX = ramp.dir.endsWith('x'), t0 = (alongX ? p.getX(i) : p.getZ(i)) + .5;
        const t = ramp.dir.startsWith('+') ? t0 : 1 - t0;
        const top = ramp.h0 + (ramp.h1 - ramp.h0) * t;
        p.setY(i, p.getY(i) > 0 ? top : Math.max(arena.bounds.floorY, top - .10));
      }
      geo.computeVertexNormals(); add(geo, ramp.type || (arena.household === 'fridge' ? 'plastic' : 'wood'));
    }
    // A ramp and a tabletop form one solid at their common edge. Leaving their
    // two closed end caps inside that solid catches the capsule's rounded toe.
    // Remove only the buried portions of those caps in BOTH the rendered and
    // collision meshes; the exposed lower lip, top and bottom remain intact.
    function trimTriangles(geometry, select, planes = []) {
      const source = geometry.index ? geometry.toNonIndexed() : geometry;
      const p = source.attributes.position, n = source.attributes.normal, u = source.attributes.uv;
      const positions = [], normals = [], uv = [];
      const read = i => ({ p: [p.getX(i), p.getY(i), p.getZ(i)], n: [n.getX(i), n.getY(i), n.getZ(i)], u: u ? [u.getX(i), u.getY(i)] : [0, 0] });
      const interpolate = (a, b, t) => ({ p: a.p.map((v, i) => v + (b.p[i] - v) * t), n: a.n.map((v, i) => v + (b.n[i] - v) * t), u: a.u.map((v, i) => v + (b.u[i] - v) * t) });
      function clip(polygon, plane, inside) {
        const result = [];
        if (!polygon.length) return result;
        let previous = polygon.at(-1), previousD = plane(previous.p) * (inside ? 1 : -1);
        for (const current of polygon) {
          const currentD = plane(current.p) * (inside ? 1 : -1);
          if ((previousD >= 0) !== (currentD >= 0)) result.push(interpolate(previous, current, previousD / (previousD - currentD)));
          if (currentD >= 0) result.push(current);
          previous = current; previousD = currentD;
        }
        return result;
      }
      function append(polygon) {
        for (let i = 1; i + 1 < polygon.length; i++) for (const vertex of [polygon[0], polygon[i], polygon[i + 1]]) {
          positions.push(...vertex.p); normals.push(...vertex.n); uv.push(...vertex.u);
        }
      }
      for (let i = 0; i < p.count; i += 3) {
        let polygon = [read(i), read(i + 1), read(i + 2)];
        if (!select(polygon)) { append(polygon); continue; }
        for (const plane of planes) {
          append(clip(polygon, plane, false));
          polygon = clip(polygon, plane, true);
          if (!polygon.length) break;
        }
      }
      if (source !== geometry) source.dispose();
      geometry.dispose();
      const result = new THREE.BufferGeometry();
      result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      result.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      return result;
    }
    for (const ramp of arena.ramps || []) for (const deck of arena.crates || []) {
      if (!['shelf', 'island', 'bridge'].includes(deck.model) || deck.rotation) continue;
      if (Math.abs((deck.y || 0) + deck.h - ramp.h1) > .002) continue;
      const axis = ramp.dir.endsWith('x') ? 'x' : 'z', cross = axis === 'x' ? 'z' : 'x';
      const size = axis === 'x' ? 'w' : 'd', width = axis === 'x' ? 'd' : 'w';
      const ai = axis === 'x' ? 0 : 2, ci = cross === 'x' ? 0 : 2, sign = ramp.dir.startsWith('+') ? 1 : -1;
      const edge = ramp[axis] + sign * ramp[size] / 2;
      if (Math.abs(edge - (deck[axis] - sign * deck[size] / 2)) > .002) continue;
      const lo = Math.max(ramp[cross] - ramp[width] / 2, deck[cross] - deck[width] / 2);
      const hi = Math.min(ramp[cross] + ramp[width] / 2, deck[cross] + deck[width] / 2);
      if (hi <= lo) continue;
      const bottom = Math.max(arena.bounds.floorY, ramp.h1 - .10);
      const opening = [point => point[ci] - lo, point => hi - point[ci], point => point[1] - bottom];
      for (const part of parts) {
        if (part.propId === ramp.id) {
          part.geometry = trimTriangles(part.geometry, triangle => triangle.every(v => Math.abs(v.p[ai] - edge) < .00001));
        } else if (part.propId === deck.id) {
          if (part.id === deck.id + ':0') {
            part.geometry = trimTriangles(part.geometry, triangle => triangle.every(v => Math.abs(v.p[ai] - edge) < .00001), opening);
          } else if (part.skin === 'chrome') {
            part.geometry.computeBoundingBox();
            const bounds = part.geometry.boundingBox;
            if (Math.max(Math.abs(bounds.min[axis] - edge), Math.abs(bounds.max[axis] - edge)) < .06) {
              part.geometry = trimTriangles(part.geometry, () => true, opening);
            }
          }
        }
      }
    }
    return parts;
  }
  function toCollision(parts) {
    const positions = [], indices = [], materials = [];
    for (const part of parts) {
      if (part.collidable === false) continue;
      const p = part.geometry.attributes.position, index = part.geometry.index;
      const offset = positions.length / 3;
      for (let i = 0; i < p.count; i++) positions.push(p.getX(i), p.getY(i), p.getZ(i));
      for (let i = 0; i < (index ? index.count : p.count); i += 3) {
        const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
        const abx = p.getX(b) - p.getX(a), aby = p.getY(b) - p.getY(a), abz = p.getZ(b) - p.getZ(a);
        const acx = p.getX(c) - p.getX(a), acy = p.getY(c) - p.getY(a), acz = p.getZ(c) - p.getZ(a);
        if (Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx) < 1e-9) continue;
        indices.push(offset + a, offset + b, offset + c);
        materials.push(part.impact || (['metal', 'chrome', 'glass', 'shelfGlass', 'ceramic', 'plastic', 'wall', 'ceiling', 'floor', 'rubber'].includes(part.skin)
          ? 'metal' : ['wood', 'milk', 'cabinet'].includes(part.skin) ? 'wood' : 'hay'));
      }
    }
    return { positions, indices, materials };
  }
  return { build, toCollision };
});
