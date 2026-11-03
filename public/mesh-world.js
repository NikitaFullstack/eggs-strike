/* Shared exact-triangle collisions for imported scenes, using the bundled Three.js Octree. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EggMeshWorld = api;
})(globalThis, function () {
  function collision(THREE, Octree, Capsule, data, arena) {
    const tree = new Octree(), shape = arena.playerCollision, materials = new WeakMap();
    for (let i = 0; i < data.indices.length; i += 3) {
      const [a, b, c] = data.indices.slice(i, i + 3).map(index => new THREE.Vector3().fromArray(data.positions, index * 3));
      const front = new THREE.Triangle(a, b, c), back = new THREE.Triangle(c.clone(), b.clone(), a.clone());
      tree.addTriangle(front); tree.addTriangle(back); // Source material is double-sided.
      if (data.materials?.[i / 3]) {
        materials.set(front, data.materials[i / 3]); materials.set(back, data.materials[i / 3]);
      }
    }
    // Bound subdivision so large floor triangles do not multiply across deep
    // Octree branches. Ray and capsule queries still use the original triangles.
    tree.maxLevel = 6;
    tree.trianglesPerLeaf = 32;
    tree.build();
    const ray = new THREE.Ray(), normal = new THREE.Vector3();
    const capsule = new Capsule(), contacts = [];
    const walkableNormal = Math.cos(shape.maxWalkableSlopeDegrees * Math.PI / 180);
    function cast(origin, direction) {
      ray.origin.set(origin.x, origin.y, origin.z); ray.direction.set(direction.x, direction.y, direction.z);
      const hit = tree.rayIntersect(ray);
      if (!hit) return null;
      hit.triangle.getNormal(normal);
      return { t: hit.distance, point: { ...hit.position }, normal: { ...normal }, material: materials.get(hit.triangle) || (Math.abs(normal.y) > .8 ? 'dirt' : 'metal') };
    }
    function placeCapsule(point) {
      capsule.start.set(point.x, point.y + shape.radius, point.z);
      capsule.end.set(point.x, point.y + shape.height - shape.radius, point.z);
      capsule.radius = shape.radius;
    }
    function obstruction(point) {
      placeCapsule(point);
      contacts.length = 0;
      tree.getCapsuleTriangles(capsule, contacts);
      let deepest = null;
      for (const triangle of contacts) {
        const hit = tree.triangleCapsuleIntersect(capsule, triangle);
        if (!hit || hit.depth <= .0001) continue;
        triangle.getNormal(normal);
        // Walkable support uses the existing feet-height convention. All steep
        // faces and undersides still resolve the complete capsule, including its
        // rounded head/foot; they must never be treated as an absent floor.
        if (normal.y >= walkableNormal && normal.dot(capsule.start) >= normal.dot(triangle.a) - .005) continue;
        if (!deepest || hit.depth > deepest.depth) deepest = hit;
      }
      return deepest;
    }
    function footSupport(point) {
      placeCapsule(point);
      capsule.radius += .003;
      contacts.length = 0;
      tree.getCapsuleTriangles(capsule, contacts);
      for (const triangle of contacts) {
        triangle.getNormal(normal);
        if (normal.y < walkableNormal || normal.dot(capsule.start) < normal.dot(triangle.a)) continue;
        const hit = tree.triangleCapsuleIntersect(capsule, triangle);
        if (hit && hit.normal.y >= walkableNormal) return true;
      }
      return false;
    }
    function moveVertical(position, deltaY) {
      const point = { x: position.x, y: position.y, z: position.z };
      const count = Math.max(1, Math.ceil(Math.abs(deltaY) / .05)), increment = deltaY / count;
      let grounded = false, ceiling = false, blocked = false;
      for (let step = 0; step < count; step++) {
        const previous = { ...point };
        point.y += increment;
        let floor = false;
        if (increment <= 0) {
          const support = cast({ x: point.x, y: previous.y + .001, z: point.z }, { x: 0, y: -1, z: 0 });
          if (support && support.normal.y >= walkableNormal && support.point.y <= previous.y + .005 && point.y <= support.point.y) {
            point.y = support.point.y;
            floor = true;
          }
        }
        // A small sweep followed by contact projection slides down a bottle's
        // shoulder instead of tunnelling through it. Re-query after each contact
        // so a correction cannot push the player through a neighbouring solid.
        let hit;
        for (let iteration = 0; iteration < 16 && (hit = obstruction(point)); iteration++) {
          const distance = hit.depth + .0002;
          point.x += hit.normal.x * distance;
          point.y += hit.normal.y * distance;
          point.z += hit.normal.z * distance;
          point.x = Math.max((arena.bounds.minX ?? -Infinity) + shape.radius, Math.min((arena.bounds.maxX ?? Infinity) - shape.radius, point.x));
          point.z = Math.max((arena.bounds.minZ ?? -Infinity) + shape.radius, Math.min((arena.bounds.maxZ ?? Infinity) - shape.radius, point.z));
          if (increment > 0 && hit.normal.y < -.05) ceiling = true;
        }
        if (obstruction(point)) {
          // Preserve the last non-penetrating position in an unresolved corner.
          Object.assign(point, previous);
          blocked = true;
          break;
        }
        if (floor) {
          const support = cast({ x: point.x, y: point.y + .005, z: point.z }, { x: 0, y: -1, z: 0 });
          grounded = !!support && support.normal.y >= walkableNormal && Math.abs(point.y - support.point.y) < .006;
          if (grounded) { point.y = support.point.y; break; }
        }
        // A rounded foot can rest on a deck edge while its centre ray misses
        // that deck. Require both a walkable face and upward capsule contact;
        // touching the steep side of a bottle must not grant walking or jumps.
        if (increment <= 0 && footSupport(point)) { grounded = true; break; }
        if (ceiling) break;
      }
      // Contact projection also removes vertical momentum. Otherwise a capsule
      // wedged between two curved faces would accumulate unlimited fall speed
      // while barely moving, making subsequent sweeps unnecessarily expensive.
      const velocityScale = deltaY === 0 ? 1 : Math.max(0, Math.min(1, (point.y - position.y) / deltaY));
      return { ...point, grounded, ceiling, blocked, velocityScale };
    }
    return {
      ray: cast,
      moveVertical,
      blocks(x, z, y, radius = shape.radius) {
        capsule.start.set(x, y + radius, z); capsule.end.set(x, y + shape.height - radius, z); capsule.radius = radius;
        // A combined floor/wall correction can point upwards on a slope, hiding
        // the wall. Classify every contact before accepting a walking position.
        contacts.length = 0;
        tree.getCapsuleTriangles(capsule, contacts);
        for (const triangle of contacts) {
          const hit = tree.triangleCapsuleIntersect(capsule, triangle);
          if (!hit || hit.depth <= .005) continue;
          // Internal triangle edges on an otherwise walkable plane can produce
          // a sideways contact normal. They are support, not invisible steps.
          triangle.getNormal(normal);
          if (normal.y >= walkableNormal && normal.dot(capsule.start) >= normal.dot(triangle.a) - .005) continue;
          if (hit.normal.y < walkableNormal) return true;
        }
        return false;
      },
      groundHeight(x, z, limit) {
        const hit = cast({ x, y: limit + .001, z }, { x: 0, y: -1, z: 0 });
        return hit && hit.normal.y >= walkableNormal ? hit.point.y : arena.bounds.floorY;
      },
      ceilingHeight(x, z, head) {
        let height = Infinity;
        for (const [dx, dz] of [[0, 0], [shape.radius * .8, 0], [-shape.radius * .8, 0], [0, shape.radius * .8], [0, -shape.radius * .8]]) {
          const hit = cast({ x: x + dx, y: head - .01, z: z + dz }, { x: 0, y: 1, z: 0 });
          if (hit) height = Math.min(height, hit.point.y);
        }
        return height;
      },
    };
  }
  function build(THREE, data, texture, group, targets, arena) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    geometry.setIndex(data.indices);
    // Keep the imported scene intact while making floors, walls and changes in
    // height readable against the original single blue texture.
    const colors = [], tint = new THREE.Color();
    const walkableNormal = Math.cos((arena?.playerCollision.maxWalkableSlopeDegrees ?? 35) * Math.PI / 180);
    for (let i = 0; i < data.normals.length; i += 3) {
      const walkable = data.normals[i + 1] >= walkableNormal;
      tint.setHex(walkable ? 0xffe4af : 0xc2dbef);
      if (walkable) tint.multiplyScalar(.92 + Math.min(1, Math.max(0, data.positions[i + 1] / 10)) * .08);
      colors.push(tint.r, tint.g, tint.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const map = texture.clone(); map.needsUpdate = true;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide }));
    mesh.name = 'imported-training-world'; mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh); targets.push(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: 0x183847, transparent: true, opacity: .28 }));
    edges.name = 'training-surface-edges'; group.add(edges);
    const markings = new THREE.Group(); markings.name = 'training-wayfinding'; markings.userData.collidable = false; group.add(markings);
    mesh.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(), upward = new THREE.Vector3(0, 1, 0);
    for (const spawn of arena?.spawns || []) {
      ray.set(new THREE.Vector3(spawn.x, spawn.y + .2, spawn.z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      if (!hit) continue;
      const normal = hit.face.normal.clone(); if (normal.y < 0) normal.negate();
      const ring = new THREE.Mesh(new THREE.RingGeometry(.60, .69, 32), new THREE.MeshBasicMaterial({ color: spawn.color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      ring.geometry.rotateX(-Math.PI / 2);
      ring.quaternion.setFromUnitVectors(upward, normal);
      ring.position.copy(hit.point).addScaledVector(normal, .012);
      ring.name = `training-spawn-${spawn.id}`; markings.add(ring);
    }
    return { toggleDebug() {}, inspect() { return { mode: 'imported', triangles: data.indices.length / 3, textureReady: !!map.image?.complete, surfaceEdges: true, spawnMarkers: markings.children.length }; } };
  }
  return { collision, build };
});
