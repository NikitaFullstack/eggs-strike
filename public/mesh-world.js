/* Shared exact-triangle collisions for imported scenes, using the bundled Three.js Octree. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EggMeshWorld = api;
})(globalThis, function () {
  function collision(THREE, Octree, Capsule, data, arena) {
    const tree = new Octree(), shape = arena.playerCollision;
    for (let i = 0; i < data.indices.length; i += 3) {
      const [a, b, c] = data.indices.slice(i, i + 3).map(index => new THREE.Vector3().fromArray(data.positions, index * 3));
      tree.addTriangle(new THREE.Triangle(a, b, c));
      tree.addTriangle(new THREE.Triangle(c.clone(), b.clone(), a.clone())); // Source material is double-sided.
    }
    tree.build();
    const ray = new THREE.Ray(), normal = new THREE.Vector3();
    const capsule = new Capsule(), contacts = [];
    const walkableNormal = Math.cos(shape.maxWalkableSlopeDegrees * Math.PI / 180);
    function cast(origin, direction) {
      ray.origin.set(origin.x, origin.y, origin.z); ray.direction.set(direction.x, direction.y, direction.z);
      const hit = tree.rayIntersect(ray);
      if (!hit) return null;
      hit.triangle.getNormal(normal);
      return { t: hit.distance, point: { ...hit.position }, normal: { ...normal }, material: Math.abs(normal.y) > .8 ? 'dirt' : 'metal' };
    }
    return {
      ray: cast,
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
        return hit && Math.abs(hit.normal.y) >= Math.cos(shape.maxWalkableSlopeDegrees * Math.PI / 180) ? hit.point.y : arena.bounds.floorY;
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
