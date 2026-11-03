/* Original, locally generated surface art. Geometry follows the shared arena
 * solids exactly; the dressing is paint, labels and trims on those surfaces. */
globalThis.EggHouseholdWorld = {
  build(THREE, arena, group, targets) {
    const G = globalThis.EggArenaGeometry;
    const fridge = arena.household === 'fridge';
    const bounds = arena.bounds;
    const floorY = bounds.floorY;
    const mode = new URLSearchParams(location.search).has('blockout') ? 'blockout' : 'dressed';
    const solids = [], materials = new Map();
    const decor = new THREE.Group();
    decor.name = 'household-surface-detail';
    decor.userData.collidable = false;
    group.add(decor);
    let seed = 7419;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const colors = {
      plastic:'#d9eced', metal:'#9eaeb1', tile:'#e8e1ce', wood:'#d7a96b',
      milk:'#eef3df', juice:'#e59840', cheese:'#efc454', butter:'#e3c47d',
      tin:'#86a49b', bread:'#c78f4b', deck:fridge?'#dcebed':'#c89d62',
      floor:fridge?'#c1dee1':'#c99962', ceiling:'#e8f3f1', toaster:'#a4b3b4',
      toastTop:'#9eafb0', breadBox:'#d7a96b', yogurt:'#f3ecdb', eggBox:'#d5ceaa', tea:'#879d70',
      white:'#ecf4ed', dark:'#3c5c60', rubber:'#53777c',
    };
    function texture(kind) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const c = canvas.getContext('2d');
      const fill = (color,x,y,w,h) => { c.fillStyle=color; c.fillRect(x,y,w,h); };
      const line = (color,width,x0,y0,x1,y1) => {
        c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();
      };
      const text = (value,y,size,color='#294b50') => {
        c.fillStyle=color;c.font=`800 ${size}px sans-serif`;c.textAlign='center';c.fillText(value,256,y);
      };
      const oval = (x,y,rx,ry,color) => {
        c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();
      };
      fill(colors[kind] || colors.plastic,0,0,512,512);
      // Fine deterministic grain softens broad flat faces without image assets.
      for(let i=0;i<1800;i++) {
        c.fillStyle=random()<.5?'rgba(255,255,255,.055)':'rgba(40,55,50,.035)';
        c.fillRect(random()*512,random()*512,1+random()*2,1+random()*2);
      }
      if(kind==='wood'||kind==='breadBox'||(kind==='floor'&&!fridge)||kind==='bread') {
        for(let i=0;i<140;i++) {
          const y=random()*512;
          c.strokeStyle=i%2?'#82532a20':'#fff2cf25';c.lineWidth=.5+random()*2;
          c.beginPath();c.moveTo(0,y);c.bezierCurveTo(130,y-5,380,y+6,512,y+random()*4);c.stroke();
        }
        if(kind!=='bread') for(const y of [0,128,256,384]) {
          line('#91683760',2,0,y,512,y);line('#ffe5ad5c',1,0,y+3,512,y+3);
        }
        else {
          const gradient=c.createRadialGradient(256,230,50,256,230,340);
          gradient.addColorStop(0,'#e5b87055');gradient.addColorStop(1,'#6f401080');c.fillStyle=gradient;c.fillRect(0,0,512,512);
          for(const x of [108,254,400]){c.save();c.translate(x,256);c.rotate(.2);oval(0,0,18,155,'#9d632f');oval(-4,-3,9,143,'#f1d79b');c.restore();}
        }
      }
      if(kind==='breadBox') {
        c.strokeStyle='#7a5838';c.lineWidth=18;c.strokeRect(10,10,492,492);
        for(let y=55;y<450;y+=24){line('#87613d99',2,32,y,480,y);line('#f6d79d77',2,32,y+3,480,y+3);}
        fill('#76573e',165,315,182,36);fill('#dfc68f',177,319,158,21);
        fill('#e8d2a1',145,135,222,72);text('BREAD',186,39,'#836139');
      }
      if(kind==='plastic'||kind==='ceiling'||(kind==='floor'&&fridge)) {
        const gradient=c.createLinearGradient(0,0,512,512);
        gradient.addColorStop(0,'#ffffff35');gradient.addColorStop(1,'#64a2aa18');
        c.fillStyle=gradient;c.fillRect(0,0,512,512);
        if(kind==='floor') {
          for(let x=16;x<512;x+=32){line('#87b7c024',2,x,0,x,512);line('#f5ffff38',2,x+3,0,x+3,512);}
        } else {
          c.strokeStyle='#94b9c044';c.lineWidth=3;c.strokeRect(14,14,484,484);
          c.strokeStyle='#ffffff66';c.lineWidth=2;c.strokeRect(20,20,472,472);
        }
        // Condensation is printed on the enamel rather than floating particles.
        if(kind==='plastic')for(let i=0;i<22;i++){
          const x=25+random()*462,y=25+random()*462,r=2+random()*3;
          oval(x,y,r,r*1.5,'#86aeba30');oval(x-1,y-2,r*.4,r*.6,'#ffffff7a');
        }
      }
      if(kind==='tile') {
        fill('#a4b8ad',0,0,512,512);
        const palette=['#ede8d9','#e2e5d8','#c2d6cb','#eee9d8'];
        for(let y=0;y<4;y++)for(let x=0;x<4;x++) {
          fill(palette[(x+y*3)%4],x*128+3,y*128+3,122,122);
          line('#ffffff9c',2,x*128+6,y*128+7,x*128+122,y*128+7);
          line('#587f6c20',2,x*128+122,y*128+7,x*128+122,y*128+122);
        }
      }
      if(kind==='metal'||kind==='toaster'||kind==='toastTop') {
        const gradient=c.createLinearGradient(0,0,512,0);
        gradient.addColorStop(0,'#5d797b35');gradient.addColorStop(.24,'#ffffff60');gradient.addColorStop(.65,'#ffffff00');gradient.addColorStop(1,'#445e6035');
        c.fillStyle=gradient;c.fillRect(0,0,512,512);
        for(let i=0;i<180;i++)line(i%2?'#ffffff15':'#203c3b12',1,0,random()*512,512,random()*512);
        for(const y of [16,480]){line('#4a6267',5,0,y,512,y);line('#dbe8e6',2,0,y+6,512,y+6);}
        if(kind==='toaster') {
          fill('#536e70',34,156,444,8);fill('#dfefeb88',34,166,444,3);
          oval(256,315,48,48,'#5e7778');oval(256,315,33,33,'#cbd6cb');
          line('#314a4e',7,256,291,256,307);text('CRISP',107,42);text('1   2   3   4   5',416,20);
        }
        if(kind==='toastTop')for(const y of [178,334]){
          oval(256,y,191,47,'#dbebe6');oval(256,y+3,180,36,'#33484a');oval(256,y+7,160,22,'#273c3d');
          for(let x=120;x<420;x+=34)line('#8d76613d',2,x,y-13,x,y+23);
        }
      }
      if(kind==='yogurt'||kind==='eggBox'||kind==='tea') {
        const accent=kind==='yogurt'?'#b96e82':kind==='eggBox'?'#70886b':'#526c52';
        fill(accent,0,15,512,54);fill(accent,0,442,512,55);
        text('EGG & CO.',113,25,accent);
        text(kind==='yogurt'?'YOGURT':kind==='eggBox'?'FARM EGGS':'GREEN TEA',192,49,accent);
        if(kind==='yogurt') {
          oval(256,282,60,58,'#c77985');
          for(let i=0;i<20;i++){const x=220+random()*72,y=244+random()*76;oval(x,y,2,4,'#f8d3ac');}
          c.fillStyle='#819360';c.beginPath();c.moveTo(213,231);c.lineTo(248,240);c.lineTo(255,207);c.lineTo(267,238);c.lineTo(299,224);c.lineTo(284,253);c.lineTo(228,254);c.closePath();c.fill();
        } else if(kind==='eggBox')for(const x of [172,256,340])oval(x,280,31,44,'#f5e7c7');
        else {c.save();c.translate(256,276);c.rotate(-.45);oval(0,0,38,69,'#90a77a');line('#d8dfaf',4,0,-48,0,60);c.restore();}
        text(kind==='yogurt'?'STRAWBERRY':kind==='eggBox'?'HANDLE WITH CARE':'A MOMENT OF CALM',386,24,accent);
      }
      if(kind==='milk'||kind==='juice'||kind==='butter'||kind==='tin') {
        const accent=kind==='milk'?'#4c9aa8':kind==='juice'?'#d66b33':kind==='butter'?'#ae6152':'#567e74';
        fill(accent,0,0,512,48);fill(accent,0,428,512,84);
        fill('#fff6de',25,68,462,338);
        c.strokeStyle=accent;c.lineWidth=3;c.strokeRect(36,79,440,316);
        text('EGG & CO.',118,23,accent);
        text(kind==='milk'?'MILK':kind==='juice'?'ORANGE':kind==='butter'?'BUTTER':'PANTRY',188,53,accent);
        if(kind==='milk') {
          oval(256,271,59,64,'#8ac2c7');oval(249,263,44,51,'#f8f9e9');
          c.fillStyle='#f8f9e9';c.beginPath();c.moveTo(215,245);c.lineTo(256,199);c.lineTo(296,245);c.fill();
          text('FRESH DAILY',369,24,accent);
        } else if(kind==='juice') {
          oval(256,276,68,68,'#ed9e36');oval(256,276,56,56,'#ffd778');
          for(let i=0;i<8;i++){const a=i*Math.PI/4;line('#fff0ad',4,256,276,256+Math.cos(a)*54,276+Math.sin(a)*54);}
          c.save();c.translate(286,213);c.rotate(-.5);oval(0,0,30,10,'#7c9a54');c.restore();text('SUNNY SIDE UP',369,23,accent);
        } else if(kind==='butter') {
          fill('#e8bc60',177,240,158,63);fill('#f7d887',177,240,158,15);text('SWEET CREAM',369,23,accent);
        } else {
          oval(256,277,59,50,'#c88763');oval(238,256,21,8,'#e5b795');text('GOOD THINGS INSIDE',369,21,accent);
        }
        text(kind==='milk'?'1 L  /  3.2%':kind==='juice'?'100% JUICE':kind==='butter'?'250 g':'EST. 2026',478,22,'#fff7df');
      }
      if(kind==='cheese') {
        const holes=[[67,84,28],[253,52,22],[423,133,36],[180,244,42],[360,341,28],[65,422,33],[264,477,17]];
        for(const [x,y,r]of holes){oval(x,y,r,r*.77,'#b787334f');oval(x,y+3,r*.78,r*.52,'#d69d3f');c.strokeStyle='#ffe28b99';c.lineWidth=3;c.beginPath();c.ellipse(x,y,r,r*.77,0,0,Math.PI);c.stroke();}
      }
      const map=new THREE.CanvasTexture(canvas);
      map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=4;
      return map;
    }
    function material(kind) {
      if(!colors[kind])kind='plastic';
      if(materials.has(kind))return materials.get(kind);
      const metallic=['metal','toaster','toastTop','tin'].includes(kind);
      const m=new THREE.MeshPhongMaterial({
        color:mode==='dressed'?0xffffff:colors[kind],
        map:mode==='dressed'?texture(kind):null,
        shininess:metallic?55:kind==='plastic'?28:10,
        specular:metallic?0x718e90:0x384943,
        emissive:fridge?0x26434a:0x000000,emissiveIntensity:fridge?.16:0,
        side:THREE.DoubleSide,
      });
      materials.set(kind,m);return m;
    }
    const packages=new Set(['milk','juice','butter','tin','tea','eggBox']);
    function boxMaterial(kind) {
      if(kind==='toaster')return [material('metal'),material('metal'),material('toastTop'),material('metal'),material('toaster'),material('metal')];
      if(kind==='breadBox')return [material('wood'),material('wood'),material('wood'),material('wood'),material('breadBox'),material('wood')];
      if(!packages.has(kind))return material(kind);
      const side=material(kind),cap=material(kind==='tin'?'metal':kind==='butter'?'cheese':'white');
      return [side,side,cap,cap,side,side];
    }
    function solid(id,geometry,mat,x,y,z) {
      const mesh=new THREE.Mesh(geometry,mat);mesh.name=id;mesh.position.set(x,y,z);
      mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);targets.push(mesh);solids.push({id,mesh});return mesh;
    }
    function repeatBoxUV(geometry,w,h,d,unit) {
      const uv=geometry.attributes.uv;
      for(let i=0;i<uv.count;i++) {
        const face=Math.floor(i/4),u=face<2?d:w,v=face===2||face===3?d:h;
        uv.setXY(i,uv.getX(i)*u/unit,uv.getY(i)*v/unit);
      }
    }
    const floorGeo=new THREE.PlaneGeometry(bounds.widthX,bounds.depthZ);
    const floorUV=floorGeo.attributes.uv;
    for(let i=0;i<floorUV.count;i++)floorUV.setXY(i,floorUV.getX(i)*bounds.widthX/4,floorUV.getY(i)*bounds.depthZ/4);
    const floor=solid('floor',floorGeo,material('floor'),(bounds.minX+bounds.maxX)/2,floorY,(bounds.minZ+bounds.maxZ)/2);
    floor.rotation.x=-Math.PI/2;floor.castShadow=false;
    const ceilingId=arena.crates.find(b=>b.id==='FR_CEILING')?.id;
    const platformTypes=new Map(arena.platforms.map(p=>[p.id,p.type]));
    for(const b of G.boxes(arena)) {
      let kind=b.id===ceilingId?'ceiling':platformTypes.get(b.id)||b.type;
      if(!fridge&&b.type==='metal'&&/toast/i.test(b.id))kind='toaster';
      if(b.id==='KT_BREAD_BOX')kind='breadBox';
      if(b.id==='KT_TEA_BOX')kind='tea';
      if(b.id==='FR_EGG_BOX')kind='eggBox';
      if(kind==='wall')kind=fridge?'plastic':'tile';
      const geo=new THREE.BoxGeometry(b.w,b.h,b.d);
      if(['wood','tile'].includes(kind)||arena.walls.includes(b))repeatBoxUV(geo,b.w,b.h,b.d,kind==='tile'?3:4);
      solid(b.id,geo,boxMaterial(kind),b.x,(b.y||0)+b.h/2,b.z);
    }
    for(const r of arena.ramps) {
      const geo=new THREE.BoxGeometry(r.w,1,r.d),p=geo.attributes.position;
      for(let i=0;i<p.count;i++){
        const x=p.getX(i)+r.x,z=p.getZ(i)+r.z;
        p.setY(i,p.getY(i)>0?r.h0+(r.h1-r.h0)*G.rampT(r,x,z):floorY);
      }
      geo.computeVertexNormals();solid(r.id,geo,material(r.type||'deck'),r.x,0,r.z);
    }
    for(const r of arena.rounds)for(const part of G.roundParts(r)) {
      const kind=r.id==='FR_YOGURT'?'yogurt':part.skin||r.type||'metal';
      const side=material(kind),cap=material(['tin','metal'].includes(kind)?'metal':kind);
      solid(r.id,new THREE.CylinderGeometry(part.top,part.bottom,part.h,G.ROUND_SEGMENTS),[side,cap,cap],part.x,part.y+part.h/2,part.z);
    }
    if(mode==='dressed') {
      const positions=[],tints=[],color=new THREE.Color();
      function paint(points,tint) {
        color.set(tint);
        for(const i of [0,1,2,0,2,3]){positions.push(...points[i]);tints.push(color.r,color.g,color.b);}
      }
      const accent=fridge?'#f5ffed':'#fff0bd';
      for(const r of arena.ramps) {
        const alongX=r.dir.endsWith('x');
        const y=(x,z)=>r.h0+(r.h1-r.h0)*G.rampT(r,x,z)+.012;
        for(const sign of [-1,1]) {
          const low=(alongX?r.x-r.w/2:r.z-r.d/2)+.10,high=(alongX?r.x+r.w/2:r.z+r.d/2)-.10;
          const side=(alongX?r.z:r.x)+sign*((alongX?r.d:r.w)/2-.12);
          const p=alongX?[[low,side-.025],[high,side-.025],[high,side+.025],[low,side+.025]]:[[side-.025,low],[side+.025,low],[side+.025,high],[side-.025,high]];
          paint(p.map(([x,z])=>[x,y(x,z),z]),accent);
        }
      }
      for(const s of arena.spawns)for(let i=0;i<32;i++) {
        const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
        paint([[s.x+Math.cos(a)*.48,s.y+.012,s.z+Math.sin(a)*.48],[s.x+Math.cos(a)*.53,s.y+.012,s.z+Math.sin(a)*.53],[s.x+Math.cos(b)*.53,s.y+.012,s.z+Math.sin(b)*.53],[s.x+Math.cos(b)*.48,s.y+.012,s.z+Math.sin(b)*.48]],s.color);
      }
      const paintGeo=new THREE.BufferGeometry();
      paintGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      paintGeo.setAttribute('color',new THREE.Float32BufferAttribute(tints,3));paintGeo.computeVertexNormals();
      const markings=new THREE.Mesh(paintGeo,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}));
      markings.name='household-route-markings';decor.add(markings);

      // Every label is flush with a real wall. No cosmetic objects occupy routes.
      function wallGraphic(name,w,h,x,y,z,draw,rotation=0) {
        const c=document.createElement('canvas');c.width=1024;c.height=Math.round(1024*h/w);
        const ctx=c.getContext('2d');draw(ctx,c.width,c.height);
        const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
        const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
        mesh.name=name;mesh.position.set(x,y,z);mesh.rotation.y=rotation;decor.add(mesh);return mesh;
      }
      const north=arena.walls.find(w=>Math.abs(w.z-bounds.minZ)<.7&&w.w>w.d);
      const nz=north?north.z+north.d/2+.008:bounds.minZ+.2;
      if(fridge) {
        wallGraphic('fridge-temperature-panel',3.2,.75,0,3.85,nz,(c,w,h)=>{
          c.fillStyle='#436c73';c.fillRect(0,0,w,h);c.strokeStyle='#c0e1db';c.lineWidth=6;c.strokeRect(8,8,w-16,h-16);
          c.fillStyle='#e7fff0';c.textAlign='left';c.font='600 54px sans-serif';c.fillText('FRESH BOX',45,h*.42);
          c.font='23px monospace';c.fillStyle='#b5d9d8';c.fillText('KEEP COOL / PLAY FAIR',45,h*.73);
          c.font='70px monospace';c.textAlign='right';c.fillStyle='#c9f5b5';c.fillText('+4°',w-46,h*.63);
        });
        wallGraphic('fridge-air-vent',5.8,.45,0,4.65,nz,(c,w,h)=>{
          c.fillStyle='#a5c8ce';c.fillRect(0,0,w,h);
          for(let x=24;x<w-12;x+=29){c.fillStyle='#567d8a';c.fillRect(x,15,8,h-30);c.fillStyle='#e6f5ec';c.fillRect(x+8,15,3,h-30);}
        });
        const light=new THREE.Mesh(new THREE.PlaneGeometry(6.8,.55),new THREE.MeshBasicMaterial({color:0xf3ffe7,side:THREE.DoubleSide}));
        light.name='fridge-ceiling-light';light.rotation.x=Math.PI/2;light.position.set(0,5.188,0);decor.add(light);
        // The solid roof correctly shades the room from the outdoor sun. A
        // single shadowless bulb gives the interior its own light and depth.
        const bulb=new THREE.PointLight(0xf3fff3,32,26,2);
        bulb.name='fridge-interior-light';bulb.position.set(0,4.55,0);decor.add(bulb);
      } else {
        wallGraphic('kitchen-tile-frieze',bounds.widthX-.7,.35,0,2.8,nz,(c,w,h)=>{
          c.fillStyle='#6b9387';c.fillRect(0,0,w,h);c.strokeStyle='#eae6c9';c.lineWidth=3;
          for(let x=25;x<w;x+=42){c.beginPath();c.moveTo(x,h*.2);c.lineTo(x+11,h*.5);c.lineTo(x,h*.8);c.lineTo(x-11,h*.5);c.closePath();c.stroke();}
        });
        wallGraphic('kitchen-recipe-card',2.3,1.15,0,2.02,nz,(c,w,h)=>{
          c.fillStyle='#fff2ce';c.fillRect(0,0,w,h);c.strokeStyle='#9c6d45';c.lineWidth=9;c.strokeRect(14,14,w-28,h-28);
          c.fillStyle='#547a6c';c.textAlign='center';c.font='800 70px sans-serif';c.fillText('GOOD MORNING',w/2,h*.34);
          c.fillStyle='#936a43';c.font='42px serif';c.fillText('3 eggs · a little chaos',w/2,h*.60);
          c.font='26px monospace';c.fillText('THE COUNTERTOP CLUB',w/2,h*.83);
        });
      }
      // Shallow seams are one batched line object, not extra collision volumes.
      const edgePositions=[];
      for(const {id,mesh} of solids) {
        if(id==='floor'||id===ceilingId)continue;
        mesh.updateMatrix();const edges=new THREE.EdgesGeometry(mesh.geometry,25),p=edges.attributes.position;
        const v=new THREE.Vector3();
        for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrix);edgePositions.push(v.x,v.y,v.z);}
        edges.dispose();
      }
      const edgeGeo=new THREE.BufferGeometry();edgeGeo.setAttribute('position',new THREE.Float32BufferAttribute(edgePositions,3));
      const edges=new THREE.LineSegments(edgeGeo,new THREE.LineBasicMaterial({color:fridge?0x628e98:0x826c4e,transparent:true,opacity:.2}));
      edges.name='household-seams';decor.add(edges);
    }
    let diagnostics=null;
    if(new URLSearchParams(location.search).has('mapdebug')) {
      diagnostics=new THREE.Group();diagnostics.name='household-debug';group.add(diagnostics);
      const grid=new THREE.GridHelper(Math.max(bounds.widthX,bounds.depthZ),Math.max(bounds.widthX,bounds.depthZ),0x395b65,0x395b65);
      grid.position.y=floorY+.018;grid.material.transparent=true;grid.material.opacity=.2;diagnostics.add(grid);
    }
    return {
      toggleDebug(){if(diagnostics)diagnostics.visible=!diagnostics.visible;},
      inspect(){
        group.updateWorldMatrix(true,true);
        const round=n=>Math.round(n*1e6)/1e6;
        return {mode,household:arena.household,materials:materials.size,debug:{visible:!!diagnostics?.visible},solids:solids.map(({id,mesh})=>{
          const box=new THREE.Box3().setFromObject(mesh);return {id,min:box.min.toArray().map(round),max:box.max.toArray().map(round)};
        })};
      },
    };
  },
};
