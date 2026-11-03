/* Household surfaces and lighting. Curved object meshes come from the same
 * authored geometry that the server uses for movement, bullets and grenades. */
globalThis.EggHouseholdWorld = {
  environment: null,
  build(THREE, arena, group, targets) {
    const fridge = arena.household === 'fridge', a = arena.bounds;
    const mode = new URLSearchParams(location.search).has('blockout') ? 'blockout' : 'dressed';
    const dressed = mode === 'dressed', mats = new Map(), batches = new Map();
    const parts = EggHouseholdShapes.build(THREE, arena), solids = new Map(), partInfo = [];
    let triangles = 0, seed = 55231;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const colors = {
      plastic:'#e8eeeb', wall:fridge?'#e0eceb':'#ebe8d9', floor:fridge?'#d8e5df':'#bd946a', ceiling:fridge?'#eff5ef':'#f1e9d7',
      metal:'#a7b9bc', chrome:'#d7e2df', rubber:'#3b4947', dark:'#283632', wood:'#c89f6c', board:'#c89f6c',
      ceramic:'#d4e4db', glass:'#9cba9b', milk:'#f4eed8', juice:'#e1a643', cheese:'#edc55e',
      crust:'#b87537', crumb:'#e7c99b', bread:'#b87537', egg:'#f0dfbf', pulp:'#b4aa8b', yogurt:'#ede3d3',
      butter:'#f2d38a', tomato:'#c44431', leaf:'#617b40', tile:'#e5e5d8', white:'#f4f0df',
    };
    const aliases = { tin:'metal', carton:'pulp', red:'tomato', green:'leaf', deck:'wood', loaf:'crust' };
    function canvas(w = 512, h = w) { const c = document.createElement('canvas'); c.width=w;c.height=h;return c; }
    function texture(kind) {
      const c = canvas(), ctx = c.getContext('2d');
      const fill=(color,x=0,y=0,w=512,h=512)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
      const line=(color,width,x,y,x2,y2)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.stroke();};
      const oval=(x,y,rx,ry,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();};
      const text=(value,y,size,color)=>{ctx.fillStyle=color;ctx.font=`600 ${size}px sans-serif`;ctx.textAlign='center';ctx.fillText(value,256,y);};
      fill(colors[kind]||'#eee9d8');
      if (/Label$/.test(kind)) {
        const milk=kind==='milkLabel', juice=kind==='juiceLabel', yogurt=kind==='yogurtLabel';
        const eggs=kind==='eggLabel', pickles=kind==='pickleLabel', cookies=kind==='cookieLabel';
        const ink=milk?'#477f89':juice?'#a75c2b':yogurt?'#a05c73':cookies?'#8d5d37':'#537451';
        fill('#faf2db');fill(ink,0,0,512,22);fill(ink,0,472,512,40);
        ctx.strokeStyle=ink;ctx.lineWidth=2;ctx.strokeRect(26,40,460,412);
        text('THE LITTLE PANTRY',85,19,ink);
        text(milk?'MILK':juice?'ORANGE':yogurt?'YOGURT':eggs?'FARM EGGS':pickles?'PICKLES':cookies?'COOKIES':'GREEN TEA',164,57,ink);
        if(milk) { oval(256,270,49,62,'#87bdc1');oval(249,264,37,48,'#f9f3dc'); }
        else if(juice) {
          oval(256,270,68,68,'#e8a53b');oval(256,270,55,55,'#f7d27b');
          for(let i=0;i<8;i++){const t=i*Math.PI/4;line('#fff0b9',3,256,270,256+Math.cos(t)*54,270+Math.sin(t)*54);}
          ctx.save();ctx.translate(286,202);ctx.rotate(-.5);oval(0,0,29,11,'#6b864b');ctx.restore();
        } else if(yogurt) {
          oval(256,275,55,60,'#bd687a');
          for(let i=0;i<21;i++)oval(220+random()*70,232+random()*80,2,3,'#f2c59c');
          ctx.fillStyle='#7b8f55';ctx.beginPath();ctx.moveTo(210,225);ctx.lineTo(250,235);ctx.lineTo(256,204);ctx.lineTo(267,235);ctx.lineTo(298,220);ctx.lineTo(278,248);ctx.lineTo(227,245);ctx.fill();
        } else if(eggs) {
          for(const x of [185,256,327]){oval(x,277,32,45,'#c7b78e');oval(x-3,273,27,40,'#ecdfb9');}
        } else if(pickles) {
          for(const x of [201,256,311]){ctx.save();ctx.translate(x,271);ctx.rotate((x-256)/220);oval(0,0,22,66,'#7e9561');for(let i=0;i<9;i++)oval(-12+random()*24,-44+random()*88,2,3,'#c6c990');ctx.restore();}
        } else if(cookies) {
          oval(256,270,66,62,'#c99153');oval(253,266,57,53,'#dfb775');
          for(let i=0;i<18;i++)oval(216+random()*80,230+random()*78,3+random()*3,3+random()*2,'#795634');
        } else {ctx.save();ctx.translate(256,265);ctx.rotate(-.35);oval(0,0,38,69,'#799961');line('#e7e8b9',3,0,-50,0,55);ctx.restore();}
        text(milk?'FRESH WHOLE MILK':juice?'PRESSED WITH SUNSHINE':yogurt?'STRAWBERRY & CREAM':eggs?'FREE RANGE · HANDLE WITH CARE':pickles?'DILL & GARLIC':cookies?'BAKED WITH BUTTER':'SLOW MORNING BLEND',389,19,ink);
        text(milk?'1 L   ·   3.2%':juice?'100% JUICE':yogurt?'NATURAL CULTURES':eggs?'SIX GOOD EGGS':pickles?'CRUNCHY GARDEN PICKLES':cookies?'A LITTLE TEATIME TREAT':'20 LEAF BAGS',431,18,ink);
        text('EST. 2026',498,13,'#fff4dc');
      } else {
        // Grain is quiet enough that the geometry, not a printed motif, defines each object.
        for(let i=0;i<3500;i++){ctx.fillStyle=random()<.5?'#ffffff09':'#283d2e08';ctx.fillRect(random()*512,random()*512,1+random(),1+random());}
        if(['wood','board'].includes(kind)||(kind==='floor'&&!fridge)) {
          for(let i=0;i<180;i++) {
            const y=random()*512;ctx.strokeStyle=i%2?'#62391f15':'#fff5d51a';ctx.lineWidth=.6+random();
            ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(160,y+random()*9-4,350,y+random()*11-5,512,y);ctx.stroke();
          }
          if(kind==='floor')for(const y of [0,128,256,384]){line('#76533522',1,0,y,512,y);line('#ffe8bd20',1,0,y+2,512,y+2);}
        }
        if(kind==='crust'||kind==='crumb')for(let i=0;i<600;i++)oval(random()*512,random()*512,.5+random()*2,.5+random()*1.5,random()<.5?'#72482625':'#ffe6ad30');
        if(kind==='pulp')for(let i=0;i<1000;i++){const x=random()*512,y=random()*512;line('#6d665421',.7,x,y,x+random()*7,y+random()*4);}
        if(kind==='metal'||kind==='chrome')for(let i=0;i<180;i++){const y=random()*512;line(i%2?'#fff8e512':'#3a535d0b',.5,0,y,512,y);}
        if(kind==='wall'&&!fridge||kind==='tile') {
          // Warm plaster above a subway-tile backsplash, with fine grout rather than a checkerboard room.
          const start=kind==='tile'?0:288;
          fill('#aabcb1',0,start,512,512-start);
          for(let row=0;row<4;row++)for(let col=-1;col<5;col++) {
            const x=col*128+(row%2?64:0),y=start+row*56;
            fill((row+col)%3===0?'#cbdad0':'#e4e9dc',x+2,y+2,124,52);
            line('#ffffff80',1,x+4,y+4,x+122,y+4);
          }
          line('#eff1df',4,0,start-3,512,start-3);line('#758f7c',2,0,start-8,512,start-8);
        }
        if(kind==='glass') {
          const g=ctx.createLinearGradient(0,0,512,0);g.addColorStop(0,'#e8f5d515');g.addColorStop(.18,'#f3fff159');g.addColorStop(.28,'#e8f5d500');g.addColorStop(.76,'#24452b0d');g.addColorStop(1,'#f1fff236');ctx.fillStyle=g;ctx.fillRect(0,0,512,512);
        }
      }
      const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
      map.wrapS=map.wrapT=THREE.RepeatWrapping;
      return map;
    }
    // Tiny authored studio cubemap gives curved enamel and steel readable highlights.
    // The arena owns this texture; map switching disposes it with its materials.
    {
      const images=[];
      for(let i=0;i<6;i++) {
        const c=canvas(128),ctx=c.getContext('2d'),g=ctx.createLinearGradient(0,0,0,128);
        g.addColorStop(0,'#dbe9e4');g.addColorStop(.44,'#aabeb8');g.addColorStop(.46,'#718b84');g.addColorStop(1,'#65726a');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
        if(i!==3){ctx.fillStyle='#f9f7e7';ctx.fillRect(i%2?74:20,10,15,90);ctx.fillStyle='#e6efe9';ctx.fillRect(106,12,7,84);}
        images.push(c);
      }
      this.environment=new THREE.CubeTexture(images);this.environment.colorSpace=THREE.SRGBColorSpace;this.environment.needsUpdate=true;
    }
    function material(raw) {
      const kind=aliases[raw]||raw;
      if(mats.has(kind))return mats.get(kind);
      const shiny=['metal','chrome','ceramic','plastic','glass','tomato','juice'].includes(kind);
      const mat=new THREE.MeshPhongMaterial({
        color:dressed?0xffffff:(colors[kind]||'#d6dbcf'),
        map:dressed?texture(kind):null, side:THREE.DoubleSide,
        shininess:kind==='chrome'?110:kind==='metal'?65:shiny?48:kind==='egg'?18:8,
        specular:shiny?0x9baea0:0x424638,
        envMap:dressed&&shiny?globalThis.EggHouseholdWorld.environment:null,
        reflectivity:kind==='chrome'?.38:kind==='metal'?.23:kind==='glass'?.13:.045,
        combine:THREE.MixOperation,
      });
      mats.set(kind,mat);return mat;
    }
    function enqueue(geometry,mat,castShadow=true,receiveShadow=true) {
      const key=mat.uuid+':'+castShadow+':'+receiveShadow;
      if(!batches.has(key))batches.set(key,{mat,castShadow,receiveShadow,geometries:[]});
      batches.get(key).geometries.push(geometry);
    }
    function worldUV(part) {
      const geometry=part.geometry,p=geometry.attributes.position,uv=geometry.attributes.uv;
      if(!uv)return;
      if(part.propId==='floor'||part.skin==='floor')for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i)/4,p.getZ(i)/4);
      else if(arena.walls.some(w=>w.id===part.propId)) {
        const wall=arena.walls.find(w=>w.id===part.propId),alongX=wall.w>wall.d;
        for(let i=0;i<p.count;i++)uv.setXY(i,(alongX?p.getX(i):p.getZ(i))/3,p.getY(i)/wall.h);
      }
    }
    for(const part of parts) {
      worldUV(part);part.geometry.computeBoundingBox();
      const box=part.geometry.boundingBox;
      if(!solids.has(part.propId))solids.set(part.propId,new THREE.Box3());
      solids.get(part.propId).union(box);
      const count=(part.geometry.index?.count||part.geometry.attributes.position.count)/3;triangles+=count;
      partInfo.push({id:part.id,propId:part.propId,skin:part.skin,collidable:part.collidable!==false,triangles:count,min:box.min.toArray(),max:box.max.toArray()});
      enqueue(part.geometry,material(part.skin),part.castShadow!==false,part.receiveShadow!==false);
    }
    const decor=new THREE.Group();decor.name='household-environment';decor.userData.collidable=false;group.add(decor);
    function deco(geometry,mat,x,y,z,rx=0,ry=0,rz=0) {
      const matrix=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(1,1,1));
      geometry.applyMatrix4(matrix);enqueue(geometry,mat,false,true);
    }
    const surface=(color,shininess=20)=>new THREE.MeshPhongMaterial({color,shininess,specular:0x64786b,side:THREE.DoubleSide});
    function box(w,h,d,x,y,z,mat){deco(new THREE.BoxGeometry(w,h,d),mat,x,y,z);}
    function graphic(name,w,h,x,y,z,draw,rotation=0) {
      const c=canvas(1024,Math.max(64,Math.round(1024*h/w))),ctx=c.getContext('2d');draw(ctx,c.width,c.height);
      const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
      const mat=new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);mesh.position.set(x,y,z);mesh.rotation.y=rotation;mesh.name=name;decor.add(mesh);
    }
    if(dressed) {
      const north=a.minZ+.308, west=a.minX+.308, east=a.maxX-.308;
      const ceiling=arena.crates.find(p=>/CEILING/.test(p.id))?.y||arena.boundaryHeight;
      const trim=surface(fridge?0x9db7b4:0x97aa95),cream=surface(0xececd9),dark=surface(0x526a63),wood=material('wood');
      if(fridge) {
        // Flush ribs, gasket and lighting sit against the appliance casing.
        for(const x of [west,east]) {
          for(const y of [.16,4.9,5.16])box(.045,.07,a.depthZ-.75,x,y,0,trim);
          for(let z=a.minZ+1.4;z<a.maxZ;z+=1.25)box(.032,.32,.09,x,4.55,z,cream);
        }
        for(const x of [a.minX+.5,a.maxX-.5])box(.11,ceiling-.7,.035,x,(ceiling-.7)/2+.2,north,cream);
        box(a.widthX-1,.1,.035,0,.2,north,trim);
        graphic('fridge-temperature',4,.8,0,5.35,north+.01,(ctx,w,h)=>{
          ctx.fillStyle='#4d6b65';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#d6e5d2';ctx.lineWidth=7;ctx.strokeRect(10,10,w-20,h-20);
          ctx.fillStyle='#f0f5dd';ctx.font='600 43px sans-serif';ctx.textAlign='left';ctx.fillText('FRESH STORAGE',44,h*.42);ctx.fillStyle='#b4cebd';ctx.font='22px sans-serif';ctx.fillText('COOL AIR CIRCULATION',44,h*.71);
          ctx.fillStyle='#e0f0b8';ctx.font='78px monospace';ctx.textAlign='right';ctx.fillText('+4°',w-40,h*.65);
        });
        graphic('fridge-vent',7,.45,0,6.2,north+.01,(ctx,w,h)=>{
          ctx.fillStyle='#b5c8be';ctx.fillRect(0,0,w,h);for(let x=18;x<w-12;x+=25){ctx.fillStyle='#637f76';ctx.fillRect(x,12,6,h-24);ctx.fillStyle='#e9f0df';ctx.fillRect(x+6,12,3,h-24);}
        });
        const lamp=new THREE.MeshBasicMaterial({color:0xfff9dc});
        for(const x of [-a.widthX*.27,a.widthX*.27]) {
          box(.58,.055,a.depthZ*.48,x,ceiling-.075,0,trim);
          box(.4,.018,a.depthZ*.46,x,ceiling-.11,0,lamp);
        }
      } else {
        // The window and cupboards are shallow relief on the real boundary wall.
        const sage=surface(0x839b83),panel=surface(0x9baf92),brass=surface(0xbd9c60,70);
        graphic('kitchen-window',6,3.2,-4.6,5.1,north+.01,(ctx,w,h)=>{
          const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#a7cbd1');g.addColorStop(1,'#f2e8c8');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
          ctx.fillStyle='#89a48b';ctx.beginPath();ctx.moveTo(0,h*.8);for(let x=0;x<=w;x+=20)ctx.lineTo(x,h*(.69+.11*Math.sin(x/130)));ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.fill();
          ctx.strokeStyle='#f5efd8';ctx.lineWidth=28;ctx.strokeRect(8,8,w-16,h-16);ctx.beginPath();ctx.moveTo(w/2,0);ctx.lineTo(w/2,h);ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();
          ctx.fillStyle='#fff8d320';ctx.fillRect(w*.08,h*.08,w*.32,h*.35);
        });
        for(const x of [2.2,5.2,8.2,11.2].filter(x=>x<a.maxX-1)) {
          box(2.75,2.8,.075,x,5.05,north+.012,sage);
          box(2.42,2.45,.035,x,5.05,north+.062,panel);
          box(.06,.55,.075,x-1,4.65,north+.11,brass);
        }
        box(a.widthX-.6,.08,.08,0,3.15,north+.03,wood);
        graphic('kitchen-recipe',1.65,1.1,0,2.1,north+.055,(ctx,w,h)=>{
          ctx.fillStyle='#f9efd6';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#b29d74';ctx.lineWidth=8;ctx.strokeRect(8,8,w-16,h-16);ctx.fillStyle='#5b755d';ctx.textAlign='center';ctx.font='600 80px serif';ctx.fillText('Good morning',w/2,h*.33);ctx.font='42px serif';ctx.fillText('flour · milk · three eggs',w/2,h*.61);ctx.font='28px sans-serif';ctx.fillText('A LITTLE HOMEMADE CHAOS',w/2,h*.83);
        });
        for(const x of [west,east])box(.035,.13,a.depthZ-.6,x,.12,0,sage);
        // A ceiling rose and pendant are well above any reachable route.
        const lamp=new THREE.MeshBasicMaterial({color:0xffedc6});
        deco(new THREE.CylinderGeometry(.62,.92,.42,32),cream,0,ceiling-.47,-2);
        deco(new THREE.CylinderGeometry(.83,.83,.018,32),lamp,0,ceiling-.69,-2);
        box(.04,.3,.04,0,ceiling-.15,-2,dark);
      }
      // Contact shadows anchor the rounded props without adding collision volumes.
      const shadowCanvas=canvas(128),sc=shadowCanvas.getContext('2d'),radial=sc.createRadialGradient(64,64,5,64,64,64);
      radial.addColorStop(0,'#23382955');radial.addColorStop(.45,'#23382932');radial.addColorStop(1,'#23382900');sc.fillStyle=radial;sc.fillRect(0,0,128,128);
      const shadowMap=new THREE.CanvasTexture(shadowCanvas),shadowMat=new THREE.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1});
      for(const prop of arena.crates)if(prop.model&&prop.model!=='box'&&prop.y<2&&prop.minimap!==false) {
        const shadow=new THREE.PlaneGeometry(prop.w*1.3,prop.d*1.3);deco(shadow,shadowMat,prop.x,(prop.y||0)+.012,prop.z,-Math.PI/2,0,-(prop.rotation||0));
      }
      for(const spawn of arena.spawns) {
        const marker=new THREE.MeshBasicMaterial({color:spawn.color,transparent:true,opacity:.42,depthWrite:false,side:THREE.DoubleSide});
        deco(new THREE.RingGeometry(.47,.50,32),marker,spawn.x,spawn.y+.012,spawn.z,-Math.PI/2);
      }
      // Two large soft sources; their neutral highlights reveal the actual curves.
      const key=new THREE.PointLight(fridge?0xf3ffe9:0xffecd2,fridge?105:130,42,2);
      key.position.set(-a.widthX*.23,ceiling-.8,-1);decor.add(key);
      const fill=new THREE.PointLight(fridge?0xdbeae7:0xe0eadc,fridge?70:75,40,2);
      fill.position.set(a.widthX*.27,ceiling-1.2,a.minZ*.48);decor.add(fill);
    }
    // Batch by material so richer silhouettes do not mean hundreds of draw calls.
    for(const batch of batches.values()) {
      const position=[],normal=[],uv=[];
      for(const source of batch.geometries) {
        const geo=source.index?source.toNonIndexed():source;
        const p=geo.attributes.position,n=geo.attributes.normal,u=geo.attributes.uv;
        for(let i=0;i<p.count;i++){position.push(p.getX(i),p.getY(i),p.getZ(i));normal.push(n?n.getX(i):0,n?n.getY(i):1,n?n.getZ(i):0);uv.push(u?u.getX(i):0,u?u.getY(i):0);}
        if(geo!==source)geo.dispose();source.dispose();
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
      const mesh=new THREE.Mesh(geometry,batch.mat);mesh.name='household-'+(batch.mat.name||'surface');mesh.castShadow=batch.castShadow;mesh.receiveShadow=batch.receiveShadow;group.add(mesh);
      if(batch.castShadow)targets.push(mesh);
    }
    let diagnostics=null;
    if(new URLSearchParams(location.search).has('mapdebug')) {
      diagnostics=new THREE.GridHelper(Math.max(a.widthX,a.depthZ),Math.max(a.widthX,a.depthZ),0x395b65,0x395b65);diagnostics.position.y=.018;diagnostics.material.transparent=true;diagnostics.material.opacity=.15;group.add(diagnostics);
    }
    const round=n=>Math.round(n*1e6)/1e6;
    return {
      toggleDebug(){if(diagnostics)diagnostics.visible=!diagnostics.visible;},
      inspect(){return {mode,household:arena.household,materials:mats.size,triangles,models:arena.crates.filter(p=>p.model&&p.model!=='box').length,debug:{visible:!!diagnostics?.visible},
        parts:partInfo.map(p=>({...p,min:p.min.map(round),max:p.max.map(round)})),
        solids:[...solids].map(([id,b])=>({id,min:b.min.toArray().map(round),max:b.max.toArray().map(round)})),
      };},
    };
  },
};
