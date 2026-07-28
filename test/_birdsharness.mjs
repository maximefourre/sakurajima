import * as THREE from 'three';
import { createBirds } from '../src/birds.js';
import { createWind } from '../src/wind.js';

const HX=-4, HZ=-8;
let hCalls=0;
function heightAt(x,z){
  hCalls++;
  const r = Math.hypot(x-HX, z-HZ)/104;
  return Math.max(-2, 16*(1-r*r));
}
const PONDS=[{x:16,z:-42,radius:7.2,waterY:0},{x:-4,z:-73,radius:5.2,waterY:0},{x:20,z:-70,radius:4.0,waterY:0}];
const wind = createWind();

const phase = { day:1,night:0,twilight:0,golden:0, keyDir:new THREE.Vector3(0.3,0.6,0.7).normalize(),
  keyColor:new THREE.Color(1,0.95,0.9), keyIntensity:4.3, skyColor:new THREE.Color(0.4,0.55,0.8),
  groundColor:new THREE.Color(0.2,0.22,0.15), ambient:0.6 };

function setPhase(dayT){
  // crude sun altitude
  const sunY = Math.sin((dayT-0.25)*Math.PI*2);
  const sm=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
  phase.day = sm(-0.02,0.25,sunY);
  phase.night = 1-sm(-0.10,0.06,sunY);
  phase.twilight = sm(-0.18,0.0,sunY)*(1-sm(0.0,0.12,sunY));
  phase.golden = sm(0.0,0.06,sunY)*(1-sm(0.06,0.22,sunY));
}

const birds = createBirds({ seed:1337, quality:{label:'ultra'}, heightAt, wind, ponds:PONDS });
const events=[];
birds.onEvent=(n,p)=>events.push([n,p.x.toFixed(1),p.y.toFixed(1),p.z.toFixed(1)]);

const internal = birds; // api
const dt=1/60;
let t=0;
const stats={nan:0, maxY:-1e9, minY:1e9, maxSpeed:0, below:0};
const m=new THREE.Matrix4(), v=new THREE.Vector3();

const dayLen = 240; // seconds per simulated day
let repeller=null;

function step(n, opts={}){
  for(let k=0;k<n;k++){
    t+=dt;
    wind.update(t,dt);
    setPhase(((t/dayLen)+ (opts.t0??0)) % 1);
    if (opts.repeller) birds.setRepeller(opts.repeller);
    birds.update(t,dt,phase);
    for(let i=0;i<birds.count;i++){
      birds.mesh.getMatrixAt(i,m);
      v.setFromMatrixPosition(m);
      if(!Number.isFinite(v.x)||!Number.isFinite(v.y)||!Number.isFinite(v.z)) stats.nan++;
      stats.maxY=Math.max(stats.maxY,v.y); stats.minY=Math.min(stats.minY,v.y);
      const g=heightAt(v.x,v.z);
      if(v.y < Math.max(g,0)-0.5) stats.below++;
    }
  }
}

// ---- run a full simulated day
setPhase(0.4);
step(60*60*4, {t0:0.4});
console.log('after 4 min sim:', JSON.stringify(stats), 'events', events.length);

// state census helper via matrix Y relative to ground
function census(){
  const c={air:0,ground:0};
  for(let i=0;i<birds.count;i++){
    birds.mesh.getMatrixAt(i,m); v.setFromMatrixPosition(m);
    const g=Math.max(heightAt(v.x,v.z),0);
    if(v.y-g<1.0) c.ground++; else c.air++;
  }
  return c;
}
console.log('census now', JSON.stringify(census()), 'phase night', phase.night.toFixed(2));
