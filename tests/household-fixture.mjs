import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import Shapes from '../public/household-shapes.js';
import G from '../public/arena-geometry.js';
import MeshWorld from '../public/mesh-world.js';

export function householdFixture(map) {
  const parts = Shapes.build(THREE, map);
  const data = Shapes.toCollision(parts);
  const collision = MeshWorld.collision(THREE, Octree, Capsule, data, map);
  G.registerMesh(map.id, collision);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes = parts.filter(part => part.collidable !== false).map(part => {
    const mesh = new THREE.Mesh(part.geometry, material);
    mesh.userData.propId = part.propId;
    mesh.updateMatrixWorld(true);
    return mesh;
  });
  const raycaster = new THREE.Raycaster();
  const groundProps = new Set(map.crates.filter(prop => (prop.y || 0) === 0).map(prop => prop.id));
  const volumes = meshes.filter(mesh => groundProps.has(mesh.userData.propId)).map(mesh => {
    mesh.geometry.computeBoundingBox();
    return { mesh, bounds: mesh.geometry.boundingBox };
  });
  function renderRay(origin, direction, targets = meshes) {
    raycaster.set(new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(direction.x, direction.y, direction.z).normalize());
    return raycaster.intersectObjects(targets, false)[0] || null;
  }
  function insideProp(x, y, z) {
    // A capsule placed deep inside a closed body touches no surface. Such cells
    // are not walkable floor; classify them independently of movement collision.
    for (const { mesh, bounds } of volumes) {
      if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) continue;
      for (const offset of [.08, .35, .7]) {
        if (y + offset < bounds.min.y || y + offset > bounds.max.y) continue;
        const hit = renderRay({ x, y: y + offset, z }, { x: 0, y: 1, z: 0 }, [mesh]);
        if (hit && hit.face.normal.y > .001) return true;
      }
    }
    return false;
  }
  return { parts, data, collision, meshes, renderRay, insideProp, dispose() {
    for (const part of parts) part.geometry.dispose();
    material.dispose();
  } };
}
