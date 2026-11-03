/* JSON-driven blockout. Dressing is applied only after traversal has been verified. */
globalThis.EggCoopWorld = {
  build(THREE, arena, group, targets) {
    const G=globalThis.EggArenaGeometry,source=arena.source;
    const colors=source.visualDirection.colors;
    const solids=[],debug={grid:false,spawns:0,labels:0,underpasses:0};
    const mode=new URLSearchParams(location.search).has('blockout')?'blockout':'dressed';
    let diagnostics=null;
    const material={};
    for(const [type,color] of Object.entries({wood:colors.wood,crate:colors.wood,beam:colors.wood,wall:colors.wood,hay:colors.hay,deck:colors.walkway,metal:colors.metal,dirt:colors.ground}))material[type]=new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide});
    function solid(id,geometry,skin,x,y,z) {
      const mesh=new THREE.Mesh(geometry,material[skin]);mesh.name=id;mesh.position.set(x,y,z);
      mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);targets.push(mesh);solids.push({id,mesh});return mesh;
    }
    const a=source.arena;
    const floor=solid('floor',new THREE.PlaneGeometry(a.widthX,a.depthZ),'dirt',(a.minX+a.maxX)/2,a.floorY,(a.minZ+a.maxZ)/2);floor.rotation.x=-Math.PI/2;floor.castShadow=false;
    for(const b of G.boxes(arena))solid(b.id,new THREE.BoxGeometry(b.w,b.h,b.d),b.type,b.x,(b.y||0)+b.h/2,b.z);
    for(const r of arena.ramps){
      const geo=new THREE.BoxGeometry(r.w,1,r.d),p=geo.attributes.position;
      for(let i=0;i<p.count;i++){const x=p.getX(i)+r.x,z=p.getZ(i)+r.z;const top=r.h0+(r.h1-r.h0)*G.rampT(r,x,z);p.setY(i,p.getY(i)>0?top:a.floorY);}
      geo.computeVertexNormals();solid(r.id,geo,'deck',r.x,0,r.z);
    }
    for(const r of arena.rounds)for(const part of G.roundParts(r))solid(r.id,new THREE.CylinderGeometry(part.top,part.bottom,part.h,G.ROUND_SEGMENTS),'metal',part.x,part.y+part.h/2,part.z);

    if(mode==='dressed')EggHenhouseDressing(THREE,arena,group,material);

    if(new URLSearchParams(location.search).has('mapdebug')) {
      diagnostics=new THREE.Group();diagnostics.name='level-debug';group.add(diagnostics);
      const points=[];
      for(let x=a.minX;x<=a.maxX;x++)points.push(x,a.floorY+.008,a.minZ,x,a.floorY+.008,a.maxZ);
      for(let z=a.minZ;z<=a.maxZ;z++)points.push(a.minX,a.floorY+.008,z,a.maxX,a.floorY+.008,z);
      const grid=new THREE.BufferGeometry();grid.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
      diagnostics.add(new THREE.LineSegments(grid,new THREE.LineBasicMaterial({color:0xdce8ed,transparent:true,opacity:.45})));debug.grid=true;
      function label(text,x,y,z,color='#ffffff'){
        const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const c=canvas.getContext('2d');c.fillStyle='#16232bd9';c.fillRect(0,0,256,64);c.fillStyle=color;c.font='bold 26px monospace';c.textAlign='center';c.fillText(text,128,42);
        const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
        const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));sprite.position.set(x,y,z);sprite.scale.set(1.6,.4,1);diagnostics.add(sprite);debug.labels++;
      }
      for(const {id,mesh} of solids){
        if(id==='floor')continue;mesh.updateWorldMatrix(true,false);
        const wire=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:0xffb957}));
        wire.matrix.copy(mesh.matrixWorld);wire.matrixAutoUpdate=false;diagnostics.add(wire);
        const box=new THREE.Box3().setFromObject(mesh),center=box.getCenter(new THREE.Vector3());
        label(id,center.x,box.max.y+.18,center.z);
      }
      for(const s of arena.spawns){
        const ring=new THREE.Mesh(new THREE.RingGeometry(arena.playerCollision.radius,arena.playerCollision.radius*2,24),new THREE.MeshBasicMaterial({color:s.color,side:THREE.DoubleSide,transparent:true,opacity:.8}));ring.rotation.x=-Math.PI/2;ring.position.set(s.x,s.y+.02,s.z);diagnostics.add(ring);
        label(s.id,s.x,s.y+.5,s.z,s.color);debug.spawns++;
      }
      for(const p of arena.platforms){
        const passage=new THREE.Mesh(new THREE.BoxGeometry(p.w,p.h-p.thickness,p.d),new THREE.MeshBasicMaterial({color:0x3cdecc,wireframe:true,transparent:true,opacity:.6}));passage.position.set(p.x,(p.h-p.thickness)/2,p.z);diagnostics.add(passage);debug.underpasses++;
        label('Y='+p.h,p.x,p.h+.65,p.z);label('clear '+(p.h-p.thickness).toFixed(2)+'m',p.x,(p.h-p.thickness)/2,p.z,'#6affde');
      }
    }
    return {toggleDebug(){if(diagnostics)diagnostics.visible=!diagnostics.visible;},inspect(){
      group.updateWorldMatrix(true,true);
      const round=n=>Math.round(n*1e6)/1e6;
      return {mode,debug:{...debug,visible:!!diagnostics?.visible},solids:solids.map(({id,mesh})=>{const b=new THREE.Box3().setFromObject(mesh);return {id,min:b.min.toArray().map(round),max:b.max.toArray().map(round)};})};
    }};
  },
};
