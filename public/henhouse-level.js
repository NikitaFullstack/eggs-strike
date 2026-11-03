/* The JSON is the sole source of level dimensions, positions and player settings. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EggHenhouse=api;})(globalThis,function(){
  function build(level) {
    const a=level.arena,t=a.boundaryWalls.thickness,h=a.boundaryWalls.height;
    const skin={hay_bale:'hay',wood_crate:'crate',wood_barricade:'wood',spawn_barrier:'wood',wood_support:'beam'};
    const box=b=>({id:b.id,x:b.position[0],y:b.position[1],z:b.position[2],w:b.size[0],h:b.size[1],d:b.size[2],type:skin[b.asset]||'wood',collidable:b.collidable});
    const crates=[...level.obstacles.filter(b=>b.type==='box'),...level.supports].map(box);
    const platforms=level.elevatedPlatforms.map(p=>({id:p.id,x:p.position[0],z:p.position[2],w:p.size[0],d:p.size[2],h:p.topY,thickness:p.size[1],collidable:p.collidable}));
    const rails=level.rails;
    for(const p of platforms)for(const sign of [-1,1]) {
      const x=p.x+sign*(p.w/2-rails.thickness/2);
      crates.push({id:p.id+'_rail_'+sign,x,y:p.h+rails.heightAboveDeck-rails.thickness,z:p.z,w:rails.thickness,h:rails.thickness,d:p.d,type:'beam',collidable:rails.collidable});
      for(const fraction of [-.5,0,.5])crates.push({id:p.id+'_post_'+sign+'_'+fraction,x,y:p.h,z:p.z+fraction*(p.d-rails.thickness),w:rails.thickness,h:rails.heightAboveDeck,d:rails.thickness,type:'beam',collidable:rails.collidable});
    }
    const walls=[
      {id:'W_N',x:(a.minX+a.maxX)/2,z:a.minZ+t/2,w:a.widthX,d:t},
      {id:'W_S',x:(a.minX+a.maxX)/2,z:a.maxZ-t/2,w:a.widthX,d:t},
      {id:'W_W',x:a.minX+t/2,z:(a.minZ+a.maxZ)/2,w:t,d:a.depthZ},
      {id:'W_E',x:a.maxX-t/2,z:(a.minZ+a.maxZ)/2,w:t,d:a.depthZ},
    ].map(w=>({...w,y:a.floorY,h,type:'wall',collidable:a.boundaryWalls.collidable}));
    return {
      id:level.mapId,name:level.displayName,source:level,
      half:Math.max(a.widthX,a.depthZ)/2,halfX:a.widthX/2,halfZ:a.depthZ/2,bounds:a,boundaryHeight:h,
      playerCollision:level.playerCollision,spawnRules:level.spawnRules,players:level.players,
      theme:{sky:0xb9d7e8,fog:0xe3dcc1,floor:level.visualDirection.colors.ground,wall:0x936341,accent:0xe7b75b},
      crates,walls,platforms,
      ramps:level.ramps.map(r=>({id:r.id,x:r.centerX,z:(r.startZ+r.endZ)/2,w:r.widthX,d:r.endZ-r.startZ,dir:'+z',h0:r.startY,h1:r.endY,collidable:r.collidable})),
      stairs:[],decor:[],
      rounds:level.obstacles.filter(b=>b.type==='cylinder').map(b=>({id:b.id,x:b.position[0],y:b.position[1],z:b.position[2],type:'feeder',collidable:b.collidable,parts:[{y:0,h:b.height,bottom:b.radius,top:b.radius,skin:'metal'}]})),
      spawns:level.spawns.map(s=>({id:s.id,x:s.position[0],y:s.position[1],z:s.position[2],target:s.facingTarget,color:s.color})),
    };
  }
  function preview(level) {
    const a=level.arena,c=level.visualDirection.colors,t=a.boundaryWalls.thickness;
    const rect=(x,z,w,d,fill,extra='')=>`<rect x="${x-w/2}" y="${z-d/2}" width="${w}" height="${d}" fill="${fill}" ${extra}/>`;
    const parts=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${a.minX-1} ${a.minZ-1} ${a.widthX+2} ${a.depthZ+2}">`,rect(0,0,a.widthX+2,a.depthZ+2,'#29332b'),rect(0,0,a.widthX,a.depthZ,c.wood),rect(0,0,a.widthX-t*2,a.depthZ-t*2,c.ground)];
    for(const p of level.elevatedPlatforms)parts.push(rect(p.position[0],p.position[2],p.size[0],p.size[2],c.walkway));
    for(const r of level.ramps){parts.push(rect(r.centerX,(r.startZ+r.endZ)/2,r.widthX,r.endZ-r.startZ,c.walkway,'opacity=".65"'));for(let i=1;i<8;i++)parts.push(`<path d="M${r.centerX-r.widthX/2} ${r.startZ+(r.endZ-r.startZ)*i/8}h${r.widthX}" stroke="#384d52" stroke-width=".035"/>`);}
    for(const b of [...level.obstacles,...level.supports]) {
      if(b.type==='cylinder')parts.push(`<circle cx="${b.position[0]}" cy="${b.position[2]}" r="${b.radius}" fill="${c.metal}" stroke="#36464c" stroke-width=".08"/>`);
      else parts.push(rect(b.position[0],b.position[2],b.size[0],b.size[2],b.asset==='hay_bale'?c.hay:c.wood,'stroke="#583e2a" stroke-width=".045"'));
    }
    for(const s of level.spawns)parts.push(`<circle cx="${s.position[0]}" cy="${s.position[2]}" r="${level.playerCollision.radius*1.6}" fill="${s.color}" stroke="#fff2ce" stroke-width=".09"/>`);
    return parts.join('')+'</svg>';
  }
  return {build,preview};
});
