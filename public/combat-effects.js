/* Lightweight, bounded combat visuals. Shared meshes are reused for every shot. */
globalThis.EggCombat = {
  profiles: {
    ak:     {kick:.15, recovery:8,  lift:1.3, camera:.012, flash:1,   sound:'shot-a', volume:.55, rate:1},
    m4:     {kick:.085,recovery:11, lift:1.0, camera:.007, flash:.65, sound:'shot-a', volume:.34, rate:1.22},
    shot:   {kick:.27, recovery:6.5,lift:1.6, camera:.019, flash:1.4, sound:'shot-b', volume:.8,  rate:.78},
    awp:    {kick:.32, recovery:6,  lift:1.4, camera:.022, flash:1.5, sound:'shot-b', volume:.9,  rate:.55},
    usp:    {kick:.05, recovery:13, lift:.9,  camera:.004, flash:.45, sound:'shot-a', volume:.27, rate:1.3},
    deagle: {kick:.21, recovery:7.5,lift:1.7, camera:.016, flash:1.1, sound:'shot-b', volume:.7,  rate:.95},
  },
  create(THREE, scene) {
    const particles=[], cases=[], marks=[], tracers=[], impacts=[];
    const root=new THREE.Group();root.name='combat-effects';scene.add(root);
    const object=new THREE.Object3D(), color=new THREE.Color(), up=new THREE.Vector3(0,1,0);
    const batches={};
    for(const kind of ['smoke','chip','spark','dust','shell','case','mark','tracer']) {
      const geometry=kind==='smoke'||kind==='dust'?new THREE.IcosahedronGeometry(1,1):kind==='case'?new THREE.CylinderGeometry(.33,.33,1,6):kind==='mark'?new THREE.CircleGeometry(1,8):new THREE.BoxGeometry(1,1,1);
      const material=kind==='spark'||kind==='tracer'?new THREE.MeshBasicMaterial({color:0xffffff}):new THREE.MeshLambertMaterial({color:0xffffff,side:THREE.DoubleSide,transparent:kind==='smoke'||kind==='dust',opacity:kind==='smoke'?.18:kind==='dust'?.4:1,depthWrite:kind!=='smoke'&&kind!=='dust'});
      const mesh=new THREE.InstancedMesh(geometry,material,kind==='mark'?36:kind==='tracer'?32:kind==='case'?20:60);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.setColorAt(0,color);mesh.count=0;mesh.frustumCulled=false;
      root.add(mesh);batches[kind]=mesh;
    }
    function push(list, item, max) {
      if(list.length>=max)list.shift();
      const now=performance.now();list.push({...item,born:now,end:now+item.ttl*1000});
    }
    function particle(kind, point, normal, tint, size, ttl) {
      const position=new THREE.Vector3(point.x,point.y,point.z).addScaledVector(new THREE.Vector3(normal.x,normal.y,normal.z),.035);
      const velocity=new THREE.Vector3(normal.x,normal.y,normal.z).multiplyScalar(.6+Math.random()*1.2).add(new THREE.Vector3((Math.random()-.5)*1.5,Math.random(),(Math.random()-.5)*1.5));
      push(particles,{kind,position,velocity,tint,size,ttl,spin:Math.random()*6},60);
    }
    function muzzle(point, right, id, local) {
      const normal={x:0,y:1,z:0};
      for(let i=0;i<2;i++)particle('smoke',point,normal,0xbfc0a9,.022+i*.008,.3+i*.06);
      if(!local)particle('spark',point,normal,0xffd675,.1,.05);
      const p=new THREE.Vector3(point.x,point.y,point.z).addScaledVector(right,.12);
      const velocity=right.clone().multiplyScalar(1.3).add(new THREE.Vector3(0,1.2,0));
      push(cases,{kind:'case',position:p,velocity,tint:id==='shot'?0xb95132:0xc8a24f,size:.035,ttl:.85,spin:Math.random()*6},20);
    }
    function impact(ray) {
      if(!ray.material)return;
      impacts.push({material:ray.material,point:{...ray.point}});if(impacts.length>48)impacts.shift();
      const kind={wood:'chip',hay:'chip',metal:'spark',dirt:'dust',egg:'shell'}[ray.material];
      const tint={wood:0xbc8952,hay:0xe8bd58,metal:0xffd16a,dirt:0xbc9563,egg:0xffecd0}[ray.material];
      for(let i=0;i<4;i++)particle(kind,ray.point,ray.normal,tint,kind==='dust'?.08:.035,kind==='spark'?.16:.4);
      if(ray.material!=='egg')push(marks,{kind:'mark',position:new THREE.Vector3(ray.point.x,ray.point.y,ray.point.z).addScaledVector(new THREE.Vector3(ray.normal.x,ray.normal.y,ray.normal.z),.012),normal:new THREE.Vector3(ray.normal.x,ray.normal.y,ray.normal.z).normalize(),tint:ray.material==='metal'?0x5b5e51:0x53422e,size:.045,ttl:5},36);
    }
    function death(point) {
      for(let i=0;i<12;i++)particle('shell',point,{x:(Math.random()-.5)*2,y:.8,z:(Math.random()-.5)*2},0xffefd1,.1,.9);
    }
    function tracer(from,to) {
      const start=new THREE.Vector3(from.x,from.y,from.z),end=new THREE.Vector3(to.x,to.y,to.z),delta=end.clone().sub(start),length=delta.length();
      push(tracers,{kind:'tracer',position:start.add(end).multiplyScalar(.5),direction:delta.normalize(),length,tint:0xffdc8b,size:.008,ttl:.065},32);
    }
    function draw(now) {
      const counts={};for(const key in batches)counts[key]=0;
      for(const item of [...particles,...cases,...marks,...tracers]) {
        const mesh=batches[item.kind],index=counts[item.kind]++;
        const remaining=Math.max(0,(item.end-now)/(item.ttl*1000));
        object.position.copy(item.position);object.rotation.set(0,0,0);
        if(item.kind==='mark') {
          object.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),item.normal);
          object.scale.setScalar(item.size*Math.min(1,remaining*5));
        } else if(item.kind==='tracer') {
          object.quaternion.setFromUnitVectors(up,item.direction);object.scale.set(item.size,item.length,item.size);
        } else {
          object.rotation.set(item.spin,item.spin*.7,item.spin*.4);
          const size=item.size*Math.min(1,remaining*5)*(item.kind==='smoke'||item.kind==='dust'?1+(1-remaining)*3:1);
          object.scale.set(size,item.kind==='case'?size*2:item.kind==='chip'?size*.3:size,item.kind==='chip'?size*.4:size);
        }
        object.updateMatrix();mesh.setMatrixAt(index,object.matrix);mesh.setColorAt(index,color.setHex(item.tint));
      }
      for(const key in batches){const b=batches[key];b.count=counts[key];b.instanceMatrix.needsUpdate=true;if(b.instanceColor)b.instanceColor.needsUpdate=true;}
    }
    function update(dt) {
      const now=performance.now();
      for(const list of [particles,cases,marks,tracers])for(let i=list.length-1;i>=0;i--) {
        const p=list[i];if(p.end<=now){list.splice(i,1);continue;}
        if(p.velocity){p.position.addScaledVector(p.velocity,dt);p.velocity.y-=(p.kind==='smoke'?-1:6)*dt;p.spin+=dt*7;}
      }
      draw(now);
    }
    function clear(){particles.length=cases.length=marks.length=tracers.length=impacts.length=0;draw(performance.now());}
    function stats(){return {particles:particles.length,cases:cases.length,marks:marks.length,tracers:tracers.length,smoke:particles.filter(p=>p.kind==='smoke').length,shells:particles.filter(p=>p.kind==='shell').length,impacts:impacts.slice(),drawCalls:root.children.filter(m=>m.count>0).length};}
    return {muzzle,impact,death,tracer,update,clear,stats};
  },
};
