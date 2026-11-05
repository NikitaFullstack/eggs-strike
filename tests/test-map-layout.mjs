import assert from 'node:assert/strict';
import fs from 'node:fs';
import G from '../public/arena-geometry.js';
import Level from '../public/henhouse-level.js';
const source=JSON.parse(fs.readFileSync(new URL('../public/henhouse_ffa_level.json',import.meta.url)));
const map=Level.build(source);
assert.equal(map.id,'henhouse_ffa_01');assert.equal(map.halfX,12);assert.equal(map.halfZ,10);assert.equal(map.spawns.length,4);
for(const s of map.spawns){assert.equal(s.y,0);assert.equal(G.blocks(map,s.x,s.z,s.y),false);assert.equal(G.groundHeight(map,s.x,s.z,.23),0);}
for(const x of [-8.1,8.1]){
 assert.equal(G.blocks(map,x,0,0),false);assert.equal(G.groundHeight(map,x,0,.23),0);
 assert.equal(G.groundHeight(map,x,0,1.81),1.8);assert.equal(G.ceilingHeight(map,x,0,1.15),1.6);
}
assert.equal(G.blocks(map,0,0,0),true);assert.equal(G.blocks(map,11.6,0,0),true);assert.equal(G.blocks(map,0,9.6,0),true);
console.log('PASS: JSON map; four clear ground spawns; underpass floor/ceiling; feeder; boundaries');
