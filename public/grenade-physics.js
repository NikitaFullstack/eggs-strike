/* Server-authoritative grenade flight; shared constants are also available to the UI. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./arena-geometry.js') : root.EggArenaGeometry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EggGrenades = api;
})(globalThis, function (geometry) {
  'use strict';
  const CONFIG = Object.freeze({ count: 2, cooldown: 600, fuse: 2.5, radius: 5, damage: 120, size: .12, speed: 12, gravity: 14 });
  const EPSILON = .002;

  function convex(origin, direction, planes) {
    let near = 0, far = Infinity, normal = { x: -direction.x, y: -direction.y, z: -direction.z };
    for (const [x, y, z, bound] of planes) {
      const length = Math.hypot(x, y, z);
      const gap = bound + CONFIG.size * length - x * origin.x - y * origin.y - z * origin.z;
      const speed = x * direction.x + y * direction.y + z * direction.z;
      if (Math.abs(speed) < 1e-9) {
        if (gap < 0) return null;
      } else if (speed < 0) {
        const time = gap / speed;
        if (time >= near) { near = time; normal = { x: x / length, y: y / length, z: z / length }; }
      } else far = Math.min(far, gap / speed);
      if (near > far) return null;
    }
    return far >= 0 ? { t: near, normal } : null;
  }

  function sweep(arena, origin, direction, distance) {
    let nearest = null;
    function consider(hit) {
      if (hit && hit.t >= 0 && hit.t <= distance && (!nearest || hit.t < nearest.t)) nearest = hit;
    }
    if (arena.mesh) {
      // Offset rays sweep the small body as well as its centre through thin source triangles.
      for (const [x, y, z] of [[0,0,0], [CONFIG.size,0,0], [-CONFIG.size,0,0], [0,CONFIG.size,0], [0,-CONFIG.size,0], [0,0,CONFIG.size], [0,0,-CONFIG.size]]) {
        const hit = geometry.rayMesh(arena, { x: origin.x + x, y: origin.y + y, z: origin.z + z }, direction);
        if (hit) {
          let normal = hit.normal;
          if (normal.x * direction.x + normal.y * direction.y + normal.z * direction.z > 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
          consider({ t: hit.t, normal });
        }
      }
    } else {
      for (const box of geometry.boxes(arena)) {
        consider(convex(origin, direction, [[1,0,0,box.x+box.w/2],[-1,0,0,-box.x+box.w/2], [0,1,0,(box.y||0)+box.h],[0,-1,0,-(box.y||0)], [0,0,1,box.z+box.d/2],[0,0,-1,-box.z+box.d/2]]));
      }
      for (const ramp of arena.ramps || []) {
        const axis = ramp.dir.endsWith('x') ? 'x' : 'z';
        const slope = (ramp.h1-ramp.h0)/(axis === 'x' ? ramp.w : ramp.d)*(ramp.dir.startsWith('+') ? 1 : -1);
        const top = (ramp.h0+ramp.h1)/2-slope*ramp[axis];
        consider(convex(origin, direction, [[1,0,0,ramp.x+ramp.w/2],[-1,0,0,-ramp.x+ramp.w/2], [0,0,1,ramp.z+ramp.d/2],[0,0,-1,-ramp.z+ramp.d/2], [0,-1,0,0],[axis==='x' ? -slope : 0,1,axis==='z' ? -slope : 0,top]]));
      }
      for (const solid of arena.rounds || []) for (const part of geometry.roundParts(solid)) {
        const slope = (part.top-part.bottom)/part.h, apothem = Math.cos(Math.PI/geometry.ROUND_SEGMENTS);
        const planes = [[0,1,0,part.y+part.h],[0,-1,0,-part.y]];
        for (let i = 0; i < geometry.ROUND_SEGMENTS; i++) {
          const angle = (i+.5)*Math.PI*2/geometry.ROUND_SEGMENTS;
          const x = Math.sin(angle), z = Math.cos(angle), y = -slope*apothem;
          planes.push([x,y,z,x*part.x+y*part.y+z*part.z+part.bottom*apothem]);
        }
        consider(convex(origin, direction, planes));
      }
      if (direction.y < 0) consider({ t: (arena.bounds.floorY + CONFIG.size - origin.y)/direction.y, normal: {x:0,y:1,z:0} });
    }
    // Keep grenades in the playable world, including lobs above the perimeter walls.
    for (const axis of ['x','z']) {
      if (Math.abs(direction[axis]) < 1e-9) continue;
      const upper = direction[axis] > 0;
      const bound = arena.bounds[(upper ? 'max' : 'min') + axis.toUpperCase()] + (upper ? -CONFIG.size : CONFIG.size);
      const normal = {x:0,y:0,z:0}; normal[axis] = upper ? -1 : 1;
      consider({ t: (bound-origin[axis])/direction[axis], normal });
    }
    return nearest;
  }

  function create(arena, origin, direction, id, owner, now) {
    const offset = .35;
    const obstruction = sweep(arena, origin, direction, offset);
    const distance = obstruction ? Math.max(0, obstruction.t-EPSILON) : offset;
    return {
      id, owner, x: origin.x+direction.x*distance, y: origin.y+direction.y*distance, z: origin.z+direction.z*distance,
      vx: direction.x*CONFIG.speed, vy: direction.y*CONFIG.speed+3.5, vz: direction.z*CONFIG.speed,
      updatedAt: now, expiresAt: now+CONFIG.fuse*1000,
    };
  }

  function advance(grenade, arena, dt) {
    const steps = Math.max(1, Math.ceil(dt/(1/120))), step = dt/steps;
    for (let i = 0; i < steps; i++) {
      grenade.vy -= CONFIG.gravity*step;
      let remaining = step;
      // Resolve multiple contacts in corners without advancing through the wall.
      for (let contact = 0; contact < 3 && remaining > .00001; contact++) {
        const speed = Math.hypot(grenade.vx,grenade.vy,grenade.vz);
        if (speed < .00001) break;
        const direction = {x:grenade.vx/speed,y:grenade.vy/speed,z:grenade.vz/speed};
        const distance = speed*remaining, hit = sweep(arena,grenade,direction,distance);
        const travel = hit ? Math.max(0,hit.t-EPSILON) : distance;
        grenade.x += direction.x*travel; grenade.y += direction.y*travel; grenade.z += direction.z*travel;
        if (!hit) break;
        const n = hit.normal, inward = grenade.vx*n.x+grenade.vy*n.y+grenade.vz*n.z;
        if (inward < 0) {
          grenade.vx -= 1.42*inward*n.x; grenade.vy -= 1.42*inward*n.y; grenade.vz -= 1.42*inward*n.z;
          grenade.vx *= .78; grenade.vy *= .78; grenade.vz *= .78;
        }
        grenade.x += n.x*EPSILON; grenade.y += n.y*EPSILON; grenade.z += n.z*EPSILON;
        if (n.y > .7 && Math.abs(grenade.vy) < .6) grenade.vy = 0;
        remaining *= 1-Math.min(1,hit.t/Math.max(distance,EPSILON));
      }
    }
  }

  function damage(arena, explosion, player) {
    const centre = {x:player.x,y:player.y+arena.playerCollision.height/2,z:player.z};
    const distance = Math.hypot(centre.x-explosion.x,centre.y-explosion.y,centre.z-explosion.z);
    if (distance >= CONFIG.radius) return 0;
    // Cover blocks the blast; sample the body so a low railing is not a full shield.
    const visible = [.2,.55,.85].some(fraction => geometry.visible(arena,explosion,{x:player.x,y:player.y+arena.playerCollision.height*fraction,z:player.z}));
    return visible ? Math.max(1,Math.round(CONFIG.damage*(1-distance/CONFIG.radius))) : 0;
  }

  function advanceTo(grenade, arena, now) {
    // A projectile owns its clock: never simulate time before the throw or after its fuse.
    // Even a stalled server catches up at most one fuse (300 small collision steps).
    const until = Math.max(grenade.updatedAt,Math.min(now,grenade.expiresAt));
    if (until > grenade.updatedAt) advance(grenade,arena,(until-grenade.updatedAt)/1000);
    grenade.updatedAt = until;
  }

  return { CONFIG, create, advance, advanceTo, sweep, damage };
});
