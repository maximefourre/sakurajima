import * as THREE from 'three';
import { createBirds } from '../src/birds.js';
import { createWind } from '../src/wind.js';
import { noise2 } from '../src/noise.js';
const heightAt=(x,z)=>{const r=Math.hypot(x+4,z+8)/104;return Math.max(-2,16*(1-r*r));};
const wind=createWind();
const phase={day:1,night:0,twilight:0,golden:0.5,keyDir:new THREE.Vector3(0.3,0.6,0.7).normalize(),
 keyColor:new THREE.Color(1,0.95,0.9),keyIntensity:4.3,skyColor:new THREE.Color(0.4,0.55,0.8),
 groundColor:new THREE.Color(0.2,0.22,0.15),ambient:0.6};
const birds=createBirds({seed:1337,quality:{label:'ultra'},heightAt,wind,ponds:[]});
let t=0;const dt=1/60;
for(let k=0;k<600;k++){t+=dt;wind.update(t,dt);birds.update(t,dt,phase);}
function probe(fn,n){global.gc();global.gc();const b=process.memoryUsage().heapUsed;fn(n);global.gc();global.gc();const a=process.memoryUsage().heapUsed;return (a-b)/n;}
console.log('birds.update only :', probe((n)=>{for(let k=0;k<n;k++){t+=dt;birds.update(t,dt,phase);}},2000).toFixed(1),'B/frame');
console.log('wind.update only  :', probe((n)=>{for(let k=0;k<n;k++){t+=dt;wind.update(t,dt);}},2000).toFixed(1),'B/frame');
console.log('noise2 x261       :', probe((n)=>{let s=0;for(let k=0;k<n;k++){for(let j=0;j<261;j++)s+=noise2(j*0.1,k*0.01);}return s;},2000).toFixed(1),'B/frame');
