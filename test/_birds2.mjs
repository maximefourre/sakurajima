import * as THREE from 'three';
import { createBirds } from '../src/birds.js';
import { createWind } from '../src/wind.js';
const HX=-4,HZ=-8;
let hCalls=0;
const heightAt=(x,z)=>{hCalls++;const r=Math.hypot(x-HX,z-HZ)/104;return Math.max(-2,16*(1-r*r));};
const PONDS=[{x:16,z:-42,radius:7.2,waterY:0}];
const wind=createWind();
const phase={day:1,night:0,twilight:0,golden:0,keyDir:new THREE.Vector3(0.3,0.6,0.7).normalize(),
 keyColor:new THREE.Color(1,0.95,0.9),keyIntensity:4.3,skyColor:new THREE.Color(0.4,0.55,0.8),
 groundColor:new THREE.Color(0.2,0.22,0.15),ambient:0.6};
const sm=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
function setPhase(dayT){const sunY=Math.sin((dayT-0.25)*Math.PI*2);
 phase.day=sm(-0.02,0.25,sunY);phase.night=1-sm(-0.10,0.06,sunY);
 phase.twilight=sm(-0.18,0.0,sunY)*(1-sm(0.0,0.12,sunY));
 phase.golden=sm(0.0,0.06,sunY)*(1-sm(0.06,0.22,sunY));}
const birds=createBirds({seed:1337,quality:{label:'ultra'},heightAt,wind,ponds:PONDS});
let flushes=0,calls=0;
birds.onEvent=(n)=>{if(n==='flush')flushes++;else calls++;};
const m=new THREE.Matrix4(),v=new THREE.Vector3();
function census(){let ground=0;for(let i=0;i<birds.count;i++){birds.mesh.getMatrixAt(i,m);v.setFromMatrixPosition(m);
 const g=Math.max(heightAt(v.x,v.z),0);if(v.y-g<1.0)ground++;}return ground;}
const dt=1/60;let t=0;const dayLen=600;
let rep=null;
function step(n){for(let k=0;k<n;k++){t+=dt;wind.update(t,dt);setPhase((0.30+t/dayLen)%1);
 birds.setRepeller(rep);birds.update(t,dt,phase);}}
const log=[];
for(let mm=0;mm<20;mm++){step(60*30);log.push(`t=${t.toFixed(0)} dayT=${((0.30+t/dayLen)%1).toFixed(2)} night=${phase.night.toFixed(2)} grounded=${census()}`);}
console.log(log.join('\n'));
console.log('flushes',flushes,'calls',calls);
// heightAt budget
hCalls=0; step(60); console.log('heightAt calls/frame', (hCalls/60).toFixed(1));
// repeller test at night
console.log('--- repeller ---');
console.log('grounded before', census(), 'night', phase.night.toFixed(2));
if (phase.night<0.6) { while(phase.night<0.9) step(60); console.log('waited to night, grounded', census()); }
rep=new THREE.Vector3(0,2,0);
// place repeller at a roost
birds.setRepeller(rep);
// find a grounded bird pos
for(let i=0;i<birds.count;i++){birds.mesh.getMatrixAt(i,m);v.setFromMatrixPosition(m);
 const g=Math.max(heightAt(v.x,v.z),0); if(v.y-g<1.0){rep.set(v.x,v.y,v.z);break;}}
step(30); console.log('0.5s after dog arrives, grounded', census());
step(180); console.log('3s after, grounded', census());
rep=null; birds.setRepeller(null);
step(60*40); console.log('40s after dog leaves, grounded', census(), 'night', phase.night.toFixed(2));
// allocation probe
global.gc && global.gc();
const before=process.memoryUsage().heapUsed;
step(600);
const after=process.memoryUsage().heapUsed;
console.log('heap delta over 600 frames (bytes/frame):', ((after-before)/600).toFixed(0));
