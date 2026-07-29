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

import { SEED, WORLD, CAMERA, QUALITY, DEFAULT_QUALITY, DAY_LENGTH, START_TIME, WIND, LAND_SCALE } from './config.js';
import { SEASON_QUERY_PARAM, SEASON_STORAGE_KEY, isSeason, resolveSeason } from './season.js';
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
import { createShiba } from './shiba.js';
import { createDetails, isOnPath, initPath, pathProximity, PATH_SURFACE_LIFT } from './details.js';

/* ── DOM handles ─────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const veil = $('veil'), bar = $('bar').firstElementChild, status = $('status');
const hud = $('hud'), panel = $('panel');
const clockT = $('clock-t'), clockP = $('clock-p');
const perfFps = $('perf-fps'), perfDraw = $('perf-draw'), perfTri = $('perf-tri');

let loadStep = 0;
const LOAD_STEPS = 11;
/**
 * Advance the loading bar and yield so the browser can paint it.
 *
 * The yield races requestAnimationFrame against a timeout on purpose: Chrome
 * suspends rAF entirely in a backgrounded or occluded tab, so an rAF-only await
 * never resolves and the whole load stalls at whatever step it reached. The
 * timeout guarantees forward progress; the rAF gives a real paint when the tab
 * is actually visible.
 */
function yieldFrame() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 60);
  });
}

async function step(msg) {
  loadStep++;
  status.textContent = msg;
  bar.style.width = `${(loadStep / LOAD_STEPS) * 100}%`;
  await yieldFrame();
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

/**
 * Quality tier is resolved BEFORE anything builds: a weak machine must never
 * have to survive an ultra cold start just to reach the quality buttons.
 * Priority: explicit ?q= URL param, then the persisted last choice, then the
 * config default. Changing tier from the UI persists and RELOADS — a partial
 * hot-rebuild left the scene half-ultra and lied about being low.
 */
const initialTier = (() => {
  const requested = new URLSearchParams(location.search).get('q');
  if (requested && QUALITY[requested]) return requested;
  try {
    const stored = localStorage.getItem('sakurajima.quality');
    if (stored && QUALITY[stored]) return stored;
  } catch { /* private mode — fall through */ }
  return DEFAULT_QUALITY;
})();

/**
 * Season is resolved the same way as quality, before any construction: valid
 * ?season=, then the persisted choice, then spring. Switching seasons reloads —
 * forest, foliage, terrain palettes and atmosphere are build-time data.
 */
const initialSeason = resolveSeason({
  search: location.search,
  storage: typeof localStorage !== 'undefined' ? localStorage : null,
});

const world = {
  quality: initialTier,
  season: initialSeason,
  dayTime: START_TIME,
  daySpeed: 1,
  paused: false,
  wind: null,
  island: null, ponds: null, forest: null, grass: null,
  petals: null, sky: null, birds: null, clouds: null, shiba: null, details: null,
  /** 'orbit' = the contemplation camera, 'follow' = third person behind the dog. */
  camMode: 'orbit',
};

document.documentElement.dataset.season = world.season;

function applyDPR() {
  const cap = QUALITY[world.quality].dprCap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, cap));
}

/**
 * The forest's wind uniforms.
 *
 * sakura.js models wind direction as a Vector3 and names its uniforms its own
 * way; wind.js uses a Vector2 and a different set again. Handing the shared
 * object straight over compiles and then does nothing, because the tree shader
 * reads uWindDir as a vec3 and gets a vec2. Rather than fork either module,
 * OWN a small adapter here and refresh it from the shared gust train each frame:
 * sakura keeps this object by reference, so the trees end up leaning the same way
 * as the grass, going slack in the same lulls.
 */
const forestWind = {
  uWindDir: { value: new THREE.Vector3(1, 0, 0.38) },
  uWindStrength: { value: 1.0 },
};

/**
 * Spread a budget of unique tree meshes over the five archetypes. Weighted the
 * way the placement weights are, so the common Yoshino gets the most variants —
 * spending the budget evenly means every third tree on the island is visibly the
 * same tree.
 */
function sakuraPrototypes(total) {
  const w = { somei: 0.42, shidare: 0.18, windswept: 0.10, ancient: 0.16, young: 0.14 };
  const out = {};
  for (const k in w) out[k] = Math.max(2, Math.round(total * w[k]));
  return out;
}

/* ── third-person camera rig ─────────────────────────────────────
 * Deliberately NOT OrbitControls re-targeted at the dog. A follow camera wants
 * lag, a ground clearance test and a heading that drifts back behind the subject
 * on its own; an orbit controller wants a fixed pivot and no opinions. Trying to
 * make one be the other is how third-person cameras end up inside hillsides. */
const follow = {
  distance: 7.5,
  minDistance: 2.8,
  maxDistance: 30,
  height: 2.3,
  pitch: 0.22,
  yaw: 0,        // trails the dog's heading
  yawOffset: 0,  // how far the player has dragged the view off centre
  pitchOffset: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
};
const _camWant = new THREE.Vector3();
const _lookAt = new THREE.Vector3();

function updateFollowCamera(dt) {
  const s = world.shiba;
  if (!s) return;

  // Swing round behind him quickly while he runs, barely at all while he stands
  // still — a camera that keeps correcting around a stationary subject is the
  // fastest way to make someone put the mouse down.
  let d = s.heading - follow.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  follow.yaw += d * Math.min(1, dt * (s.speed > 0.1 ? 2.4 : 0.35));

  if (!follow.dragging && s.speed > 0.4) {
    const decay = Math.max(0, 1 - dt * 0.8);
    follow.yawOffset *= decay;
    follow.pitchOffset *= decay;
  }

  const yaw = follow.yaw + follow.yawOffset;
  // Stop short of straight down and of ducking under the dog's feet.
  const pitch = Math.max(-0.22, Math.min(1.15, follow.pitch + follow.pitchOffset));
  const horiz = Math.cos(pitch) * follow.distance;
  _camWant.set(
    s.position.x - Math.sin(yaw) * horiz,
    s.position.y + follow.height + Math.sin(pitch) * follow.distance,
    s.position.z - Math.cos(yaw) * horiz
  );

  // Keep the lens out of the ground. Without this the camera spends every
  // downhill run buried in the terrain looking at the inside of the island.
  const floor = (world.groundAt || world.heightAt)(_camWant.x, _camWant.z) + 1.2;
  if (_camWant.y < floor) _camWant.y = floor;

  camera.position.lerp(_camWant, Math.min(1, dt * 4.5));
  _lookAt.set(s.position.x, s.position.y + 1.1, s.position.z);
  camera.lookAt(_lookAt);
}

function setCamMode(mode) {
  if (mode === world.camMode) return;
  world.camMode = mode;
  controls.enabled = mode === 'orbit';
  if (mode === 'orbit' && world.shiba) {
    // Hand the pivot over where the eye already is, so the switch back is a
    // change of control rather than a cut.
    controls.target.copy(world.shiba.position);
    controls.target.y += 1.0;
    controls.autoRotate = false;
    controls.update();
  } else if (mode === 'follow' && world.shiba) {
    follow.yaw = world.shiba.heading;
    follow.yawOffset = 0;
    follow.pitchOffset = 0;
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (world.camMode !== 'follow') return;
  follow.dragging = true;
  follow.lastX = e.clientX;
  follow.lastY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!follow.dragging) return;
  follow.yawOffset -= (e.clientX - follow.lastX) * 0.006;
  follow.pitchOffset += (e.clientY - follow.lastY) * 0.004;
  follow.lastX = e.clientX;
  follow.lastY = e.clientY;
});
const endDrag = () => { follow.dragging = false; };
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);
renderer.domElement.addEventListener('wheel', (e) => {
  if (world.camMode !== 'follow') return;
  e.preventDefault();
  follow.distance = Math.min(follow.maxDistance,
    Math.max(follow.minDistance, follow.distance * (1 + Math.sign(e.deltaY) * 0.12)));
}, { passive: false });

/* ── build ───────────────────────────────────────────────────── */
async function boot() {
  seedNoise(SEED);
  applyDPR();
  const q = QUALITY[world.quality];

  await step('vent');
  world.wind = createWind();

  await step('relief de l’île');
  world.ponds = createPonds({ seed: SEED, wind: world.wind, quality: q, heightAt: null, season: world.season });
  // Only the pond basins are composed INTO the island's heightfield, so the
  // terrain mesh and every heightAt() query agree on where the ground is by
  // construction rather than by coincidence. Carving after the fact would
  // leave the water floating over higher ground.
  const carve = (x, z, h) => world.ponds.carvePonds(x, z, h);
  world.island = createIsland({ seed: SEED, quality: q, carve, season: world.season });
  scene.add(world.island.group);

  // island.js already bakes its heightfield onto a grid and interpolates it,
  // so heightAt is a cheap array lookup, not a noise evaluation. An extra cache
  // on top of it was caching a cache.
  world.heightAt = world.island.heightAt;
  world.slopeAt = world.island.slopeAt;

  // Authored path network. Call before grass placement so exclusion evaluates
  // isOnPath against every route.
  initPath();

  // groundAt is the mover surface (dog, follow camera): the terrain PLUS la
  // surface de terre battue de la sente — sans quoi les pattes du shiba
  // traversent le ruban (il marchait sur le terrain SOUS le chemin).
  world.groundAt = (x, z) => world.heightAt(x, z) + PATH_SURFACE_LIFT * pathProximity(x, z);

  await step('étangs et carpes');
  world.ponds.attach({ heightAt: world.heightAt });
  scene.add(world.ponds.group);

  /** Standing water (ponds). Every scatter system has to reject it. */
  world.inWater = (x, z) => world.ponds.isInPond(x, z);

  await step(world.season === 'autumn' ? 'momiji' : 'cerisiers');
  const foliageDensity = world.season === 'autumn'
    ? (q.label === 'ultra' ? 2.1 : q.label === 'high' ? 1.7 : 1.2)
    : (q.label === 'ultra' ? 7.2 : q.label === 'high' ? 5.6 : 3.8);
  world.forest = createSakuraForest({
    seed: SEED,
    // sakura.js was written against its own option names and silently falls back
    // to defaults for anything it does not recognise — 180 trees over a 120-unit
    // radius, no water rejection, and its own private wind. Feeding it `quality`
    // and `isInPond` looked right and did nothing at all.
    count: q.trees,
    radius: 104 * LAND_SCALE,        // the land's own half-extent, before LAND_SCALE
    quality: q.label === 'ultra' ? 1.25 : q.label === 'high' ? 0.9 : 0.6,
    season: world.season,
    // Spring: dense small flowers (validated 3.8/5.6/7.2). Autumn: maple crown
    // multipliers 1.2/1.7/2.1. Typed-array two-pass bake keeps ultra viable.
    foliageDensity,
    prototypeCounts: sakuraPrototypes(q.uniqueTrees),
    // Nothing calls getFoliageSamples (petals use forest.emitters) - keeping the
    // sample cloud held hundreds of MB of dead heap at high foliage counts.
    keepFoliageSamples: false,
    heightAt: world.heightAt,
    slopeAt: world.slopeAt,
    // Trees refuse the path corridor (half-width + 4 u ≈ 5.6 u from the axis).
    // Altitude > 2.6 keeps trees off the sand/dune band along the shore.
    isLand: (x, z) => !world.inWater(x, z) && !isOnPath(x, z, 4) && world.heightAt(x, z) > 2.6,
    windUniforms: forestWind,
  });
  scene.add(world.forest.group);

  await step('herbe');
  world.grass = createGrass({
    seed: SEED, quality: q,
    // createGrass does not read `quality`; these are the option names it
    // actually honours. Without them it silently falls back to its own
    // defaults — 96k blades over the wrong footprint, which on a 460-unit
    // island reads as no grass at all.
    count: q.grassBlades,
    // Bound to the LAND, not the whole tile. The island only spans about 210
    // units of the 460-unit world; spreading the blade budget across the full
    // tile wasted three quarters of it on open sea and quartered the density
    // where it actually shows.
    bounds: { size: 230 * LAND_SCALE },
    heightAt: world.heightAt,
    slopeAt: world.slopeAt,
    // `exclude`, not `isInPond`: grass.js has no notion of water. Ponds are
    // carved into the heightfield, so their beds pass every test grass does
    // apply. La sente n'est PLUS une exclusion dure : shortZone y garde une
    // herbe rase et clairsemée entre les passages (consigne joueur).
    exclude: (x, z) => world.inWater(x, z),
    shortZone: (x, z) => isOnPath(x, z, 0.25),
    wind: world.wind,
    season: world.season,
  });
  scene.add(world.grass.mesh);

  await step(world.season === 'autumn' ? 'feuilles' : 'pétales');
  // The forest exposes canopy positions as `emitters` ({position, radius, dominant});
  // the foliage-fall system wants flat {x,y,z,radius,dominant}. Without this the
  // spawn falls back to a uniform box and leaves/petals rain everywhere instead
  // of drifting off the crowns. Emitter y is the canopy CENTRE in world space
  // (sakura.js bakes canopyCenter through the placement transform).
  world.canopies = (world.forest.emitters ?? []).map((e) => ({
    x: e.position.x, y: e.position.y, z: e.position.z, radius: e.radius,
    dominant: e.dominant ?? null,
  }));
  world.petals = createPetals({
    seed: SEED, quality: q, season: world.season,
    canopies: world.canopies,
    wind: world.wind,
    // groundAt, pas heightAt : sur les chemins le ruban de terre est surélevé
    // (~0.13-0.20) — un pétale posé sur heightAt passerait SOUS le ruban.
    // Hors chemin les deux fonctions sont identiques.
    heightAt: world.groundAt,
    slopeAt: world.slopeAt,
    // Eau seulement : les pétales tombés ONT leur place sur la terre battue
    // (c'est là qu'on court dedans — consigne joueur).
    exclude: (x, z) => world.inWater(x, z),
    // Sur les chemins l'herbe est rase : le tapis s'y pose au sol, pas perché
    // à hauteur d'herbe de prairie.
    onPath: (x, z) => isOnPath(x, z, 0.5),
  });
  scene.add(world.petals.mesh);
  if (world.petals.carpet) scene.add(world.petals.carpet);

  await step('ciel');
  world.sky = createSky({ scene, renderer, camera, quality: q, season: world.season });

  await step('nuages');
  world.clouds = createClouds({ seed: SEED, wind: world.wind, quality: q });
  scene.add(world.clouds.group);

  await step('oiseaux');
  world.birds = createBirds({
    seed: SEED, quality: q,
    heightAt: world.heightAt,
    wind: world.wind,
    ponds: world.ponds.PONDS,
  });
  scene.add(world.birds.group);

  await step('fleurs et lanternes');
  world.details = createDetails({
    seed: SEED, quality: q,
    heightAt: world.heightAt,
    slopeAt: world.slopeAt,
    normalAt: world.island.normalAt,
    inWater: world.inWater,
    wind: world.wind,
    season: world.season,
  });
  scene.add(world.details.group);

  await step('shiba');
  world.shiba = createShiba({
    seed: SEED,
    heightAt: world.heightAt,
    slopeAt: world.slopeAt,
    normalAt: world.island.normalAt,
    isInPond: world.inWater,
    wind: world.wind,
    seaLevel: world.island.seaLevel,
  });
  scene.add(world.shiba.group);

  // Prime the cycle once before the first frame so we never flash a black scene.
  world.sky.update(world.dayTime, 0);

  veil.classList.add('gone');
  hud.classList.add('on');
  panel.classList.add('on');

  // The controls have to announce themselves. From the opening camera the dog is
  // a few pixels of orange on a 300-unit island, and a scene that looks like a
  // postcard gives you no reason to suspect there is anything to press.
  const hint = $('hint');
  setTimeout(() => hint.classList.add('on'), 1400);
  const dismissHint = () => hint.classList.add('gone');
  setTimeout(dismissHint, 13000);
  addEventListener('keydown', dismissHint, { once: true });

  // Handy for debugging from the console: window.__sk.world, etc.
  globalThis.__sk = { world, scene, camera, renderer, controls, THREE, frame, setCamMode, clock };

  renderer.setAnimationLoop(frame);
}

/* ── loop ────────────────────────────────────────────────────── */
const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0, hudAcc = 0;

/** Converts a physical light intensity into a shader multiplier. See frame(). */
const SHADER_LIGHT_SCALE = 0.26;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); // clamp so an alt-tab doesn't teleport the sun
  const t = clock.elapsedTime;

  if (!world.paused) {
    world.dayTime = (world.dayTime + (dt * world.daySpeed) / DAY_LENGTH) % 1;
  }

  world.wind.update(t, dt);
  const phase = world.sky.update(world.dayTime, dt);

  // Each subsystem was designed independently, so their update() signatures
  // differ. This block is the single place that adapts the sky's `phase` object
  // to what each one actually expects — keeping the translation here rather
  // than editing five modules to agree.
  //
  // `keyDir`/`keyColor`/`keyIntensity` are used in preference to the sun fields:
  // they resolve to whichever of sun or moon currently dominates, so vegetation
  // is lit by moonlight at night instead of by a sun that has set.
  // `keyIntensity` is a THREE.DirectionalLight intensity — physically scaled,
  // around 4.3 at noon. The hand-written shaders (blossom, grass, petals, water)
  // use it as a plain multiplier on an already-lit colour, so feeding them the
  // raw value overexposes everything to pure white. Normalise it once, here,
  // rather than letting each shader invent its own fudge factor.
  const shaderPhase = Object.create(phase);
  shaderPhase.keyIntensity = phase.keyIntensity * SHADER_LIGHT_SCALE;
  shaderPhase.sunIntensity = phase.sunIntensity * SHADER_LIGHT_SCALE;

  world.island.update(t, phase);
  world.ponds.update(t, dt, phase);

  // Trees take wind as their second argument, not the phase; the lighting
  // arrives separately through setEnvironment(). See forestWind for why this
  // goes through an adapter rather than the shared uniforms directly.
  const wu = world.wind.uniforms;
  forestWind.uWindDir.value.set(wu.uWindDir.value.x, 0, wu.uWindDir.value.y);
  // The shared envelope runs 0..gustPeak (~2.6); the tree shader expects roughly
  // 0..1.4 and looks broken at either extreme — dead still in a lull, thrashing
  // in a squall. Keep a floor so the canopies always breathe.
  forestWind.uWindStrength.value = Math.min(
    1.4, 0.28 + 0.62 * wu.uWindStrength.value * wu.uWindMaster.value
  );
  world.forest.update(t, forestWind);
  world.forest.setEnvironment?.({
    sunDirection: phase.keyDir,
    sunColor: phase.keyColor,
    sunIntensity: shaderPhase.keyIntensity,
    ambientSky: phase.skyColor,
    ambientGround: phase.groundColor,
    ambientIntensity: phase.ambient,
  });

  // grass.update's second argument is the CAMERA (it drives LOD ring selection).
  world.grass.update(t, camera);
  world.grass.setSun?.(phase.keyDir, phase.keyColor, shaderPhase.keyIntensity);

  world.petals.update(t, shaderPhase);
  world.clouds.update(t, dt, phase);
  world.birds.update(t, dt, phase);
  world.details.update(t, phase);

  // The dog reads the camera to work out which way "forward" is, so he updates
  // before the camera moves this frame. One frame of lag in the control frame is
  // imperceptible; the reverse order makes fast turns feel like ice.
  world.shiba.update(t, dt, { camera });
  world.birds.setRepeller?.(world.shiba.position);
  // The meadow parts around him. Placed after shiba.update so the uniform is
  // this frame's position, and unconditional: it applies in both camera modes —
  // in follow mode you swim through it, in orbit mode you watch him wade.
  world.grass.setPlayer?.(world.shiba.position, dt);
  // Le tapis de pétales frémit au passage : vitesse normalisée du shiba.
  world.petals.setPlayer?.(world.shiba.position.x, world.shiba.position.z,
    Math.min(1, world.shiba.speed / 14.8));

  if (world.camMode === 'follow') {
    updateFollowCamera(dt);
  } else {
    // Walking him is an interaction like any other: the idle drift should stop
    // the moment the player takes over, exactly as it does when you grab the view.
    if (world.shiba.state.moving) controls.autoRotate = false;
    controls.update();
  }

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

$('s-quality').onclick = (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const q = btn.dataset.q;
  if (q === world.quality) return;
  // Persist and reload: every system sizes itself at construction, so the only
  // honest way to change tier is a cold start of that tier. The URL's ?q= is
  // rewritten too, so an explicit link doesn't override the click after reload.
  try { localStorage.setItem('sakurajima.quality', q); } catch { /* private mode */ }
  const url = new URL(location.href);
  url.searchParams.set('q', q);
  location.assign(url);
};
// Reflect the ACTUAL tier in the buttons — index.html hardcoded ultra once,
// which silently desynced from any other resolved tier.
for (const b of $('s-quality').children) {
  b.setAttribute('aria-pressed', String(b.dataset.q === world.quality));
}

$('s-season').onclick = (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const value = btn.dataset.season;
  if (!isSeason(value) || value === world.season) return;
  try { localStorage.setItem(SEASON_STORAGE_KEY, value); } catch { /* private mode */ }
  const url = new URL(location.href);
  url.searchParams.set(SEASON_QUERY_PARAM, value);
  location.assign(url);
};
for (const b of $('s-season').children) {
  b.setAttribute('aria-pressed', String(b.dataset.season === world.season));
}

addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); world.shiba?.jump?.(); }
  if (e.code === 'KeyP') world.paused = !world.paused;
  if (e.code === 'KeyC') setCamMode(world.camMode === 'follow' ? 'orbit' : 'follow');
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
