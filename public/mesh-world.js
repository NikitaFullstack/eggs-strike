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
    const capsule = new Capsule();
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
        const hit = tree.capsuleIntersect(capsule);
        return !!hit && hit.depth > .005 && hit.normal.y < Math.cos(shape.maxWalkableSlopeDegrees * Math.PI / 180);
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
  function build(THREE, data, texture, group, targets) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    geometry.setIndex(data.indices);
    const map = texture.clone(); map.needsUpdate = true;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide }));
    mesh.name = 'imported-training-world'; mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh); targets.push(mesh);
    return { toggleDebug() {}, inspect() { return { mode: 'imported', triangles: data.indices.length / 3, textureReady: !!map.image?.complete }; } };
  }
  return { collision, build };
});
