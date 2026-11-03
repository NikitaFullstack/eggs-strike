/* Surface detail and non-solid decoration, anchored only to JSON objects. */
globalThis.EggHenhouseDressing = function(THREE,arena,group,materials) {
  const source=arena.source,colors=source.visualDirection.colors;
  let seed=1741;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  function texture(kind) {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d');
    c.fillStyle=kind==='dirt'?colors.ground:kind==='hay'?colors.hay:kind==='deck'?colors.walkway:kind==='metal'?colors.metal:colors.wood;c.fillRect(0,0,512,512);
    for(let i=0;i<(kind==='dirt'?3500:1400);i++) {
      const x=random()*512,y=random()*512;
      c.strokeStyle=random()<.5?'rgba(255,238,186,.20)':'rgba(40,27,14,.15)';c.lineWidth=kind==='hay'?1.6:1;
      c.beginPath();c.moveTo(x,y);c.lineTo(x+(kind==='dirt'?random()*6:kind==='hay'?10+random()*35:25+random()*100),y+(kind==='hay'?random()*14-7:random()*2));c.stroke();
    }
    if(['wood','crate','beam','wall','deck'].includes(kind)) {
      for(let y=0;y<512;y+=64){
        c.fillStyle='#34271988';c.fillRect(0,y,512,3);c.fillStyle='#f8d69842';c.fillRect(0,y+3,512,2);
        for(const x of [15,497]){c.fillStyle='#332b25';c.beginPath();c.arc(x,y+14,2,0,Math.PI*2);c.arc(x,y+50,2,0,Math.PI*2);c.fill();}
      }
      if(kind==='crate'){
        c.strokeStyle='#593d28';c.lineWidth=26;c.strokeRect(13,13,486,486);c.lineWidth=22;c.beginPath();c.moveTo(28,28);c.lineTo(484,484);c.moveTo(484,28);c.lineTo(28,484);c.stroke();
        c.strokeStyle='#d4af76';c.lineWidth=4;c.strokeRect(29,29,454,454);
      }
      if(kind==='wall'){
        c.fillStyle='#b2543b';c.fillRect(0,0,512,20);c.fillRect(0,492,512,20);
        c.fillStyle='#f2dcaa';c.beginPath();c.ellipse(256,230,64,48,0,0,Math.PI*2);c.arc(312,180,25,0,Math.PI*2);c.fill();c.fillRect(294,178,35,68);
        c.beginPath();c.moveTo(202,226);c.lineTo(160,162);c.lineTo(166,249);c.fill();c.beginPath();c.moveTo(330,182);c.lineTo(355,194);c.lineTo(330,201);c.fill();
        c.fillRect(234,267,8,35);c.fillRect(278,267,8,35);
      }
    }
    if(kind==='hay'){c.strokeStyle='#8e6934';c.lineWidth=8;for(const x of [110,402]){c.beginPath();c.moveTo(x,0);c.lineTo(x+7,512);c.stroke();}}
    if(kind==='metal') {
      for(const y of [46,442]){c.fillStyle='#4b5c64';c.fillRect(0,y,512,8);c.fillStyle='#d9e0d6';c.fillRect(0,y+8,512,3);}
      for(let x=20;x<512;x+=52)for(const y of [55,434]){c.fillStyle='#384b56';c.beginPath();c.arc(x,y,3,0,Math.PI*2);c.fill();}
      c.fillStyle='#293d47';c.beginPath();c.ellipse(256,270,54,38,0,0,Math.PI*2);c.arc(298,226,21,0,Math.PI*2);c.fill();c.fillRect(281,228,31,43);
      c.beginPath();c.moveTo(211,261);c.lineTo(174,208);c.lineTo(179,278);c.fill();c.beginPath();c.moveTo(316,223);c.lineTo(340,235);c.lineTo(316,241);c.fill();
      c.fillRect(238,300,6,28);c.fillRect(273,300,6,28);
    }
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
  }
  for(const key of Object.keys(materials)){materials[key].color.setHex(0xffffff);materials[key].map=texture(key);materials[key].needsUpdate=true;}
  materials.wall.map.repeat.x=source.arena.widthX/4;
  materials.metal.map.repeat.x=2;
  materials.dirt.map.repeat.set(source.arena.widthX/4,source.arena.depthZ/4);
  const oldMetal=materials.metal;
  materials.metal=new THREE.MeshPhongMaterial({map:oldMetal.map,color:0xffffff,shininess:45,specular:0xa9bbc1,side:THREE.DoubleSide});
  group.traverse(o=>{if(o.isMesh&&o.material===oldMetal)o.material=materials.metal;});oldMetal.dispose();
  const decor=new THREE.Group();decor.name='henhouse-dressing';decor.userData.collidable=false;group.add(decor);
  // Painted guides follow the actual ramp planes and deck tops. They add no
  // obstacles, and make entrances and drop edges legible from player height.
  const paintPositions=[],paintColors=[],paintTint=new THREE.Color();
  function paintQuad(points,color){
    paintTint.set(color);
    for(const i of [0,1,2,0,2,3]){paintPositions.push(...points[i]);paintColors.push(paintTint.r,paintTint.g,paintTint.b);}
  }
  for(const ramp of source.ramps){
    const y=z=>ramp.startY+(ramp.endY-ramp.startY)*(z-ramp.startZ)/(ramp.endZ-ramp.startZ)+.014;
    for(const sign of [-1,1]){
      const x=ramp.centerX+sign*(ramp.widthX/2-.17),z0=ramp.startZ,z1=ramp.endZ;
      paintQuad([[x-.035,y(z0),z0],[x+.035,y(z0),z0],[x+.035,y(z1),z1],[x-.035,y(z1),z1]],'#f9df9b');
    }
    // Cross strips at both transitions distinguish the flat deck from the slope.
    for(const z of [ramp.startZ+.12,ramp.endZ-.20]){
      const left=ramp.centerX-ramp.widthX/2+.18,right=ramp.centerX+ramp.widthX/2-.18;
      paintQuad([[left,y(z),z],[right,y(z),z],[right,y(z+.08),z+.08],[left,y(z+.08),z+.08]],'#f9df9b');
    }
  }
  for(const platform of source.elevatedPlatforms)for(const sign of [-1,1]){
    const x=platform.position[0]+sign*(platform.size[0]/2-.17),z0=platform.position[2]-platform.size[2]/2,z1=platform.position[2]+platform.size[2]/2,y=platform.topY+.014;
    paintQuad([[x-.035,y,z0],[x+.035,y,z0],[x+.035,y,z1],[x-.035,y,z1]],'#f9df9b');
  }
  for(const spawn of source.spawns){
    const [x,y,z]=spawn.position;
    for(let i=0;i<32;i++){
      const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
      paintQuad([[x+Math.cos(a)*.60,y+.014,z+Math.sin(a)*.60],[x+Math.cos(a)*.68,y+.014,z+Math.sin(a)*.68],[x+Math.cos(b)*.68,y+.014,z+Math.sin(b)*.68],[x+Math.cos(b)*.60,y+.014,z+Math.sin(b)*.60]],spawn.color);
    }
  }
  const paintGeometry=new THREE.BufferGeometry();
  paintGeometry.setAttribute('position',new THREE.Float32BufferAttribute(paintPositions,3));
  paintGeometry.setAttribute('color',new THREE.Float32BufferAttribute(paintColors,3));
  paintGeometry.computeVertexNormals();
  const paint=new THREE.Mesh(paintGeometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  paint.name='henhouse-route-markings';decor.add(paint);
  const straw=[];
  for(const b of source.obstacles.filter(b=>b.asset==='hay_bale'))for(let i=0;i<100;i++){
    const x=b.position[0]+(random()-.5)*b.size[0],y=b.position[1]+random()*b.size[1],z=b.position[2]+b.size[2]/2+.002;
    straw.push(x,y,z,x+(random()-.5)*.14,y+(random()-.5)*.06,z);
  }
  const strawGeo=new THREE.BufferGeometry();strawGeo.setAttribute('position',new THREE.Float32BufferAttribute(straw,3));decor.add(new THREE.LineSegments(strawGeo,new THREE.LineBasicMaterial({color:0xffd989})));
  // Hens perch on existing boundary walls, above every playable route.
  const white=new THREE.MeshLambertMaterial({color:0xffedd4}),red=new THREE.MeshLambertMaterial({color:0xb84333}),yellow=new THREE.MeshLambertMaterial({color:0xe6ac3a}),black=new THREE.MeshLambertMaterial({color:0x29343b});
  const a=source.arena;
  for(const s of source.spawns.filter(s=>s.position[2]<0)) {
    const bird=new THREE.Group();bird.position.set(s.position[0],a.floorY+a.boundaryWalls.height,a.minZ+a.boundaryWalls.thickness/2);decor.add(bird);
    function part(radius,x,y,z,mat,sx=1,sy=1,sz=1){const m=new THREE.Mesh(new THREE.SphereGeometry(radius,10,8),mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;bird.add(m);}
    part(.22,0,.25,0,white,1,1.1,1.25);part(.13,0,.46,.16,white);
    part(.07,0,.44,.3,yellow,1,.6,1.2);part(.055,0,.59,.13,red,.6,1.2,1.4);
    for(const sign of [-1,1]){part(.11,sign*.18,.25,-.02,white,.4,1,1.5);part(.022,sign*.075,.49,.255,black);part(.025,sign*.08,.05,.04,yellow,1,2,1);}
  }
  return decor;
};
