/**
 * main.js — scene assembly and the render loop.
 *
 * Each subsystem is a self-contained module exposing a `create*` factory that
 * returns { group, update(...) }. main.js owns only: the renderer, the camera,
 * the clock, the quality presets, and the order things update in. No art logic
 * lives here.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { SEED, WORLD, CAMERA, QUALITY, DEFAULT_QUALITY, DAY_LENGTH, START_TIME, WIND } from './config.js';
import { seedNoise } from './noise.js';
import { createWind } from './wind.js';
import { createIsland } from './island.js';
import { createPonds } from './ponds.js';
import { createSakuraForest } from './sakura.js';
import { createGrass } from './grass.js';
import { createPetals } from './petals.js';
import { createSky } from './sky.js';
import { createBirds } from './birds.js';
import { createClouds } from './clouds.js';

/* ── DOM handles ─────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const veil = $('veil'), bar = $('bar').firstElementChild, status = $('status');
const hud = $('hud'), panel = $('panel');
const clockT = $('clock-t'), clockP = $('clock-p');
const perfFps = $('perf-fps'), perfDraw = $('perf-draw'), perfTri = $('perf-tri');

let loadStep = 0;
const LOAD_STEPS = 9;
/** Advance the loading bar and yield a frame so the browser can actually paint it. */
async function step(msg) {
  loadStep++;
  status.textContent = msg;
  bar.style.width = `${(loadStep / LOAD_STEPS) * 100}%`;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/* ── renderer / scene / camera ───────────────────────────────── */
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, CAMERA.near, CAMERA.far);
camera.position.set(CAMERA.start.x, CAMERA.start.y, CAMERA.start.z);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(CAMERA.target.x, CAMERA.target.y, CAMERA.target.z);
controls.enableDamping = true;
controls.dampingFactor = 0.045;
controls.minDistance = CAMERA.minDistance;
controls.maxDistance = CAMERA.maxDistance;
controls.maxPolarAngle = CAMERA.maxPolar;
controls.enablePan = false;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.16; // barely-there drift; stops the moment you touch it
controls.addEventListener('start', () => { controls.autoRotate = false; });
controls.update();

/* ── scene state ─────────────────────────────────────────────── */
const world = {
  quality: DEFAULT_QUALITY,
  dayTime: START_TIME,
  daySpeed: 1,
  paused: false,
  wind: null,
  island: null, ponds: null, forest: null, grass: null,
  petals: null, sky: null, birds: null, clouds: null,
};

function applyDPR() {
  const cap = QUALITY[world.quality].dprCap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, cap));
}

/* ── build ───────────────────────────────────────────────────── */
async function boot() {
  seedNoise(SEED);
  applyDPR();
  const q = QUALITY[world.quality];

  await step('vent');
  world.wind = createWind();

  await step('relief de l’île');
  world.ponds = createPonds({ seed: SEED, wind: world.wind, quality: q, heightAt: null });
  // The island composes the pond basins into its own heightfield, so the two
  // agree on where the ground is by construction rather than by coincidence.
  world.island = createIsland({ seed: SEED, quality: q, carve: world.ponds.carvePonds });
  scene.add(world.island.group);

  await step('étangs et carpes');
  world.ponds.attach({ heightAt: world.island.heightAt });
  scene.add(world.ponds.group);

  await step('cerisiers');
  world.forest = createSakuraForest({
    seed: SEED, quality: q,
    heightAt: world.island.heightAt,
    slopeAt: world.island.slopeAt,
    isInPond: world.ponds.isInPond,
    wind: world.wind,
  });
  scene.add(world.forest.group);

  await step('herbe');
  world.grass = createGrass({
    seed: SEED, quality: q,
    heightAt: world.island.heightAt,
    slopeAt: world.island.slopeAt,
    isInPond: world.ponds.isInPond,
    wind: world.wind,
  });
  scene.add(world.grass.mesh);

  await step('pétales');
  world.petals = createPetals({
    seed: SEED, quality: q,
    canopies: world.forest.canopies,
    wind: world.wind,
    heightAt: world.island.heightAt,
  });
  scene.add(world.petals.mesh);

  await step('ciel');
  world.sky = createSky({ scene, renderer, camera, quality: q });

  await step('nuages');
  world.clouds = createClouds({ seed: SEED, wind: world.wind, quality: q });
  scene.add(world.clouds.group);

  await step('oiseaux');
  world.birds = createBirds({
    seed: SEED, quality: q,
    heightAt: world.island.heightAt,
    wind: world.wind,
    ponds: world.ponds.PONDS,
  });
  scene.add(world.birds.group);

  // Prime the cycle once before the first frame so we never flash a black scene.
  world.sky.update(world.dayTime, 0);

  veil.classList.add('gone');
  hud.classList.add('on');
  panel.classList.add('on');

  renderer.setAnimationLoop(frame);
}

/* ── loop ────────────────────────────────────────────────────── */
const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0, hudAcc = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); // clamp so an alt-tab doesn't teleport the sun
  const t = clock.elapsedTime;

  if (!world.paused) {
    world.dayTime = (world.dayTime + (dt * world.daySpeed) / DAY_LENGTH) % 1;
  }

  world.wind.update(t, dt);
  const phase = world.sky.update(world.dayTime, dt);

  world.island.update(t, phase);
  world.ponds.update(t, dt, phase);
  world.forest.update(t, phase);
  // grass.update's second argument is the CAMERA (it drives LOD ring selection),
  // not the day/night phase. Sun colour reaches it through setSun() instead.
  world.grass.update(t, camera);
  if (phase?.sunDirection) {
    world.grass.setSun?.(phase.sunDirection, phase.sunColor, phase.sunIntensity);
  }
  world.petals.update(t, phase);
  world.clouds.update(t, dt, phase);
  world.birds.update(t, dt, phase);

  controls.update();

  if (world.sky.composer) world.sky.composer.render();
  else renderer.render(scene, camera);

  // ── HUD, refreshed a few times a second rather than every frame ──
  fpsAcc += dt; fpsFrames++; hudAcc += dt;
  if (hudAcc > 0.4) {
    const fps = fpsFrames / fpsAcc;
    perfFps.textContent = `${fps.toFixed(0)} fps`;
    perfDraw.textContent = `${renderer.info.render.calls} draw calls`;
    perfTri.textContent = `${(renderer.info.render.triangles / 1e6).toFixed(2)}M tris`;
    updateClock();
    fpsAcc = 0; fpsFrames = 0; hudAcc = 0;
  }
}

const PHASES = [
  [0.00, 'nuit'],   [0.20, 'aube'],       [0.27, 'lever du soleil'],
  [0.34, 'matin'],  [0.46, 'midi'],       [0.60, 'après-midi'],
  [0.72, 'heure dorée'], [0.79, 'coucher du soleil'],
  [0.85, 'crépuscule'], [0.92, 'nuit'],
];

function timeLabel(dayTime) {
  const mins = Math.floor(dayTime * 1440);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function updateClock() {
  clockT.textContent = timeLabel(world.dayTime);
  let name = 'nuit';
  for (const [at, label] of PHASES) if (world.dayTime >= at) name = label;
  clockP.textContent = name;
  $('v-time').textContent = timeLabel(world.dayTime);
  $('s-time').value = world.dayTime;
}

/* ── UI ──────────────────────────────────────────────────────── */
$('panel-head').onclick = () => panel.classList.toggle('folded');

$('s-time').oninput = (e) => {
  world.dayTime = parseFloat(e.target.value);
  $('v-time').textContent = timeLabel(world.dayTime);
};
$('s-speed').oninput = (e) => {
  world.daySpeed = parseFloat(e.target.value);
  $('v-speed').textContent = `${world.daySpeed.toFixed(1)}×`;
};
$('s-wind').oninput = (e) => {
  const v = parseFloat(e.target.value);
  world.wind.setMaster(v);
  $('v-wind').textContent = `${v.toFixed(1)}×`;
};

$('s-quality').onclick = async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const q = btn.dataset.q;
  if (q === world.quality) return;
  for (const b of $('s-quality').children) b.setAttribute('aria-pressed', String(b === btn));
  world.quality = q;
  await rebuildForQuality();
};

/** Only the instance-count-heavy systems need rebuilding on a quality change. */
async function rebuildForQuality() {
  const q = QUALITY[world.quality];
  applyDPR();

  for (const [key, prop, parent] of [['grass', 'mesh', scene], ['petals', 'mesh', scene]]) {
    const sys = world[key];
    if (!sys) continue;
    parent.remove(sys[prop]);
    sys.dispose?.();
  }

  world.grass = createGrass({
    seed: SEED, quality: q,
    heightAt: world.island.heightAt,
    slopeAt: world.island.slopeAt,
    isInPond: world.ponds.isInPond,
    wind: world.wind,
  });
  scene.add(world.grass.mesh);

  world.petals = createPetals({
    seed: SEED, quality: q,
    canopies: world.forest.canopies,
    wind: world.wind,
    heightAt: world.island.heightAt,
  });
  scene.add(world.petals.mesh);

  world.sky.setQuality?.(q);
}

addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); world.paused = !world.paused; }
  if (e.key === 'h' || e.key === 'H') {
    const hidden = hud.style.opacity === '0';
    hud.style.opacity = panel.style.opacity = hidden ? '' : '0';
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  world.sky?.resize?.(innerWidth, innerHeight);
});

boot();
