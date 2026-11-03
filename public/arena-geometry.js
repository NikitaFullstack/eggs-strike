/* Shared solid geometry for browser movement/rendering and server hit tests. */
(function (root, factory) {
  const geometry = factory();
  if (typeof module === 'object' && module.exports) module.exports = geometry;
  else root.EggArenaGeometry = geometry;
})(globalThis, function () {
  'use strict';
  const ROUND_SEGMENTS = 20;
  const cache = new WeakMap();
  const meshWorlds = new Map();
  function registerMesh(id, collision) { meshWorlds.set(id, collision); }
  function rayMesh(arena, origin, direction) { return meshWorlds.get(arena.id)?.ray(origin, direction) || null; }
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

  function stairBoxes(r) {
    const alongX = r.dir.endsWith('x');
    const sign = r.dir.startsWith('+') ? 1 : -1;
    return Array.from({ length: r.steps }, (_, i) => {
      const offset = ((i + .5) / r.steps - .5) * sign;
      return {
        x: r.x + (alongX ? offset * r.w : 0),
        z: r.z + (alongX ? 0 : offset * r.d),
        w: alongX ? r.w / r.steps : r.w,
        d: alongX ? r.d : r.d / r.steps,
        h: r.h0 + (r.h1 - r.h0) * (i + 1) / r.steps,
        y: 0,
      };
    });
  }

  function boxes(arena) {
    if (!cache.has(arena)) {
      cache.set(arena, [
        ...arena.crates,
        ...(arena.walls || []),
        ...arena.platforms.map(p => ({
          ...p, y: p.h - (p.thickness || p.h), h: p.thickness || p.h, type: 'deck',
        })),
        ...arena.stairs.flatMap(stairBoxes),
      ].filter(b=>b.collidable!==false));
    }
    return cache.get(arena);
  }

  function rampT(r, x, z) {
    const axis = r.dir.endsWith('x') ? 'x' : 'z';
    const length = axis === 'x' ? r.w : r.d;
    const t = ((axis === 'x' ? x : z) - r[axis]) / length + .5;
    return clamp(r.dir.startsWith('+') ? t : 1 - t, 0, 1);
  }

  function overlaps(b, x, z, radius) {
    const dx = x - clamp(x, b.x - b.w / 2, b.x + b.w / 2);
    const dz = z - clamp(z, b.z - b.d / 2, b.z + b.d / 2);
    return dx * dx + dz * dz < radius * radius;
  }

  function roundParts(solid) {
    return solid.parts.map(p => ({ ...p, x: solid.x, z: solid.z, y: (solid.y || 0) + p.y }));
  }

  function blocks(arena, x, z, feet, radius = arena.playerCollision.radius) {
    const {height,maxStepHeight:step}=arena.playerCollision;
    const b=arena.bounds;
    if(x-radius<b.minX||x+radius>b.maxX||z-radius<b.minZ||z+radius>b.maxZ)return true;
    if (arena.mesh) return meshWorlds.get(arena.id).blocks(x, z, feet, radius);
    for (const b of boxes(arena)) {
      if (overlaps(b, x, z, radius) && (b.y || 0) + b.h > feet + step && (b.y || 0) < feet + height - .001) return true;
    }
    for (const solid of arena.rounds) {
      for (const p of roundParts(solid)) {
        const low = Math.max(feet + step, p.y);
        const high = Math.min(feet + height, p.y + p.h);
        if (low > high) continue;
        const at = y => p.bottom + (p.top - p.bottom) * (y - p.y) / p.h;
        if (Math.hypot(x - p.x, z - p.z) < Math.max(at(low), at(high)) + radius) return true;
      }
    }
    for (const r of arena.ramps) {
      const px = clamp(x, r.x - r.w / 2, r.x + r.w / 2);
      const pz = clamp(z, r.z - r.d / 2, r.z + r.d / 2);
      if (Math.hypot(x - px, z - pz) < radius && r.h0 + (r.h1 - r.h0) * rampT(r, px, pz) > feet + step) return true;
    }
    return false;
  }

  function groundHeight(arena, x, z, limit) {
    if (arena.mesh) return meshWorlds.get(arena.id).groundHeight(x, z, limit);
    let height = arena.bounds.floorY;
    for (const b of boxes(arena)) {
      const top = (b.y || 0) + b.h;
      if (Math.abs(x - b.x) <= b.w / 2 + 1e-8 && Math.abs(z - b.z) <= b.d / 2 + 1e-8 && top <= limit + .001) height = Math.max(height, top);
    }
    for (const r of arena.ramps) {
      const top = r.h0 + (r.h1 - r.h0) * rampT(r, x, z);
      if (Math.abs(x - r.x) <= r.w / 2 + 1e-8 && Math.abs(z - r.z) <= r.d / 2 + 1e-8 && top <= limit + .001) height = Math.max(height, top);
    }
    for (const solid of arena.rounds) {
      for (const p of roundParts(solid)) {
        const radius = Math.hypot(x - p.x, z - p.z);
        if (radius > Math.max(p.bottom, p.top)) continue;
        const t = radius <= Math.min(p.bottom, p.top) ? 1 : clamp((radius - p.bottom) / (p.top - p.bottom), 0, 1);
        const top = p.y + p.h * t;
        if (top <= limit + .001) height = Math.max(height, top);
      }
    }
    return height;
  }

  function ceilingHeight(arena, x, z, head) {
    if (arena.mesh) return meshWorlds.get(arena.id).ceilingHeight(x, z, head);
    let height = Infinity;
    for (const b of boxes(arena)) {
      if ((b.y || 0) >= head - .01 && overlaps(b, x, z, arena.playerCollision.radius)) height = Math.min(height, b.y || 0);
    }
    return height;
  }

  function moveVertical(arena, position, deltaY) {
    return arena.mesh ? meshWorlds.get(arena.id).moveVertical(position, deltaY) : null;
  }

  // Exact convex polygon faces, matching CylinderGeometry/ConeGeometry.
  function rayRound(origin, direction, solid) {
    let nearest = Infinity;
    for (const p of roundParts(solid)) {
      const slope = (p.top - p.bottom) / p.h;
      const apothem = Math.cos(Math.PI / ROUND_SEGMENTS);
      const planes = [[0, 1, 0, p.y + p.h], [0, -1, 0, -p.y]];
      for (let i = 0; i < ROUND_SEGMENTS; i++) {
        const angle = (i + .5) * Math.PI * 2 / ROUND_SEGMENTS;
        const x = Math.sin(angle), z = Math.cos(angle), y = -slope * apothem;
        planes.push([x, y, z, x * p.x + y * p.y + z * p.z + p.bottom * apothem]);
      }
      let near = 0, far = Infinity;
      for (const [x, y, z, bound] of planes) {
        const distance = bound - x * origin.x - y * origin.y - z * origin.z;
        const speed = x * direction.x + y * direction.y + z * direction.z;
        if (Math.abs(speed) < 1e-8) {
          if (distance < 0) { far = -1; break; }
        } else if (speed < 0) near = Math.max(near, distance / speed);
        else far = Math.min(far, distance / speed);
        if (near > far) break;
      }
      if (near <= far) nearest = Math.min(nearest, near);
    }
    return nearest;
  }


  function rayBox(o,d,b) {
    let near=0,far=Infinity;
    for(const [axis,extent] of [['x',b.w],['y',b.h],['z',b.d]]) {
      const min=axis==='y'?(b.y||0):b[axis]-extent/2,max=min+extent;
      if(Math.abs(d[axis])<1e-9){if(o[axis]<min||o[axis]>max)return Infinity;continue;}
      const a=(min-o[axis])/d[axis],c=(max-o[axis])/d[axis];near=Math.max(near,Math.min(a,c));far=Math.min(far,Math.max(a,c));
      if(near>far)return Infinity;
    }
    return near;
  }

  function rayRamp(o,d,r) {
    const axis=r.dir.endsWith('x')?'x':'z';
    const slope=(r.h1-r.h0)/(axis==='x'?r.w:r.d)*(r.dir.startsWith('+')?1:-1);
    const top=(r.h0+r.h1)/2-slope*r[axis];
    const planes=[[1,0,0,r.x+r.w/2],[-1,0,0,-r.x+r.w/2],[0,0,1,r.z+r.d/2],[0,0,-1,-r.z+r.d/2],[0,-1,0,0],[axis==='x'?-slope:0,1,axis==='z'?-slope:0,top]];
    let near=0,far=Infinity;
    for(const [x,y,z,b]of planes){const gap=b-x*o.x-y*o.y-z*o.z,speed=x*d.x+y*d.y+z*d.z;if(Math.abs(speed)<1e-9){if(gap<0)return Infinity;}else if(speed<0)near=Math.max(near,gap/speed);else far=Math.min(far,gap/speed);if(near>far)return Infinity;}
    return near;
  }

  function visible(arena,from,to) {
    const length=Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z);
    if(length<1e-8)return true;
    const d={x:(to.x-from.x)/length,y:(to.y-from.y)/length,z:(to.z-from.z)/length};
    if (arena.mesh) { const hit = rayMesh(arena, from, d); return !hit || hit.t >= length - .001; }
    if(boxes(arena).some(b=>rayBox(from,d,b)<length-.001))return false;
    return !arena.rounds.some(r=>rayRound(from,d,r)<length-.001)&&!arena.ramps.some(r=>rayRamp(from,d,r)<length-.001);
  }

  return { registerMesh, rayMesh, rayRamp, rayBox, visible, ROUND_SEGMENTS, stairBoxes, boxes, rampT, blocks, groundHeight, ceilingHeight, moveVertical, roundParts, rayRound };
});
