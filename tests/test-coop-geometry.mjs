import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import G from '../public/arena-geometry.js';
const level=JSON.parse(readFileSync(new URL('../public/henhouse_ffa_level.json',import.meta.url)));
const {default: Level}=await import('../public/henhouse-level.js');
const map=Level.build(level);
let cases=0;
for(const solid of map.rounds){
  const meshes=G.roundParts(solid).map(p=>{
    const m=new THREE.Mesh(new THREE.CylinderGeometry(p.top,p.bottom,p.h,G.ROUND_SEGMENTS),new THREE.MeshBasicMaterial());
    m.position.set(p.x,p.y+p.h/2,p.z);m.updateMatrixWorld();return m;
  });
  for(const y of [.1,.5,1.15,1.8,2.3,2.7,3.1])for(const offset of [0,.3,.7,1,1.5,2])for(const dx of [-.15,0,.15]){
    const o=new THREE.Vector3(solid.x+offset,y,solid.z+4),d=new THREE.Vector3(dx,0,-1).normalize();
    const expected=new THREE.Raycaster(o,d).intersectObjects(meshes,false)[0]?.distance??Infinity;
    const actual=G.rayRound(o,d,solid);
    assert.ok(expected===actual||Math.abs(expected-actual)<1e-5,`${solid.type}: geometry/hit mismatch ${actual} vs ${expected}`);cases++;
  }
  for(const offset of [0,.3,.7,1,1.5,2])for(const [y,dy]of [[6,-1],[-1,1]]){
    const o=new THREE.Vector3(solid.x+offset,y,solid.z),d=new THREE.Vector3(0,dy,0);
    const expected=new THREE.Raycaster(o,d).intersectObjects(meshes,false)[0]?.distance??Infinity;
    const actual=G.rayRound(o,d,solid);
    assert.ok(expected===actual||Math.abs(expected-actual)<1e-5,`${solid.type}: closed top/bottom cap mismatch`);cases++;
  }
  for(const m of meshes){m.geometry.dispose();m.material.dispose();}
}
console.log(`PASS: ${cases} feeder hit rays match actual rendered faces`);
