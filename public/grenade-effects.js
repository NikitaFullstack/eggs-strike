/* Grenades are simulated by the server; these meshes only interpolate snapshots. */
globalThis.EggGrenadeEffects = {
  create(THREE, scene) {
    const root = new THREE.Group();
    root.name = 'grenade-effects';
    scene.add(root);
    const active = new Map(), blasts = [];
    const bodyGeometry = new THREE.IcosahedronGeometry(.115, 1);
    const capGeometry = new THREE.CylinderGeometry(.04, .04, .06, 6);
    const ringGeometry = new THREE.TorusGeometry(.19, .018, 4, 20);
    const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x536940 });
    const capMaterial = new THREE.MeshLambertMaterial({ color: 0x252c28 });
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xff704b });
    const blastGeometry = new THREE.IcosahedronGeometry(1, 1);
    const shockGeometry = new THREE.RingGeometry(.85, 1, 32);

    function upsert(data) {
      let view = active.get(data.id);
      if (!view) {
        const mesh = new THREE.Group();
        mesh.add(new THREE.Mesh(bodyGeometry, bodyMaterial));
        const cap = new THREE.Mesh(capGeometry, capMaterial);
        cap.position.y = .12;
        mesh.add(cap);
        const ring = new THREE.Mesh(ringGeometry, glowMaterial);
        ring.rotation.x = Math.PI / 2;
        mesh.add(ring);
        mesh.position.set(data.x, data.y, data.z);
        root.add(mesh);
        view = { mesh, ring, from: mesh.position.clone(), target: mesh.position.clone() };
        active.set(data.id, view);
      }
      view.from.copy(view.mesh.position);
      view.target.set(data.x, data.y, data.z);
      view.received = performance.now();
      view.fuse = data.fuse;
      view.owner = data.owner;
    }

    function remove(id) {
      const view = active.get(id);
      if (view) root.remove(view.mesh);
      active.delete(id);
    }

    function sync(list) {
      const seen = new Set(list.map(data => data.id));
      for (const id of active.keys()) if (!seen.has(id)) remove(id);
      for (const data of list) upsert(data);
    }

    function explosion(data) {
      remove(data.id);
      // At most eight concurrent explosions, even after a busy room reconnects.
      if (blasts.length >= 8) disposeBlast(blasts.shift());
      const material = new THREE.MeshBasicMaterial({ color: 0xffb34d, transparent: true, opacity: .65, depthWrite: false });
      const flash = new THREE.Mesh(blastGeometry, material);
      flash.position.set(data.x, data.y, data.z);
      const ring = new THREE.Mesh(shockGeometry, material.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(data.x, data.y + .02, data.z);
      root.add(flash, ring);
      blasts.push({ flash, ring, born: performance.now(), radius: data.radius });
    }

    function disposeBlast(blast) {
      root.remove(blast.flash, blast.ring);
      blast.flash.material.dispose();
      blast.ring.material.dispose();
    }

    function update(dt) {
      const now = performance.now();
      for (const view of active.values()) {
        view.mesh.position.lerpVectors(view.from, view.target, Math.min(1, (now - view.received) / 50));
        view.mesh.rotation.x += dt * 4;
        view.mesh.rotation.z += dt * 2;
        const left = Math.max(0, view.fuse - (now - view.received) / 1000);
        view.ring.scale.setScalar(1 + .25 * Math.sin(now / (left < 1 ? 45 : 100)));
      }
      for (let i = blasts.length - 1; i >= 0; i--) {
        const blast = blasts[i], age = (now - blast.born) / 1000;
        if (age >= .5) { disposeBlast(blast); blasts.splice(i, 1); continue; }
        const t = age / .5;
        blast.flash.scale.setScalar(.2 + Math.min(1, t * 3) * blast.radius * .3);
        blast.flash.material.opacity = .65 * (1 - t) ** 3;
        blast.ring.scale.setScalar(.2 + t * blast.radius);
        blast.ring.material.opacity = .5 * (1 - t) ** 2;
      }
    }

    function nearby(point) {
      let closest = null;
      for (const view of active.values()) {
        const distance = Math.hypot(view.target.x - point.x, view.target.y - point.y, view.target.z - point.z);
        const fuse = Math.max(0, view.fuse - (performance.now() - view.received) / 1000);
        if (distance < 6 && (!closest || fuse < closest.fuse)) closest = { distance, fuse };
      }
      return closest;
    }

    function clear() {
      for (const id of active.keys()) remove(id);
      for (const blast of blasts) disposeBlast(blast);
      blasts.length = 0;
    }
    function stats() {
      return { active: active.size, explosions: blasts.length, projectiles: [...active].map(([id, v]) => ({ id, owner: v.owner, x: v.target.x, y: v.target.y, z: v.target.z, fuse: v.fuse })) };
    }
    return { upsert, sync, explosion, update, nearby, clear, stats };
  },
};
