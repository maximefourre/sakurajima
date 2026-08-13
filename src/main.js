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

import { SEED, WORLD, CAMERA, QUALITY, DEFAULT_QUALITY, DEFAULT_QUALITY_MOBILE, DAY_LENGTH, START_TIME, WIND, LAND_SCALE } from './config.js';
import { SEASON_QUERY_PARAM, SEASON_STORAGE_KEY, isSeason, resolveSeason } from './season.js';
import { seedNoise } from './noise.js';
import { createWind } from './wind.js';
import { createIsland, oceanSwellY } from './island.js';
import { createPonds } from './ponds.js';
import { createSakuraForest } from './sakura.js';
import { createGrass } from './grass.js';
import { createPetals } from './petals.js';
import { createSky } from './sky.js';
import { createBirds } from './birds.js';
import { createFireflies } from './fireflies.js';
import { createButterflies } from './butterflies.js';
import { createClouds } from './clouds.js';
import { createParticles } from './particles.js';
import { createShiba } from './shiba.js';
import { loadShibaBody } from './shiba-gltf.js';
import { createPOI } from './poi.js';
import { createCrabs } from './crabs.js';
import { createHerons } from './herons.js';
import { createDragonflies } from './dragonflies.js';
import { createTouchControls } from './touch.js';
// `flowerSpots` est un binding ES VIVANT : details.js le reassigne depuis
// createDetails, et l'import voit la nouvelle valeur. Meme mecanique que
// `lanternSpots`. D'ou l'ordre de construction imperatif plus bas.
import { createDetails, isOnPath, initPath, pathSurfaceLiftAt, flowerSpots } from './details.js';

/* ── DOM handles ─────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const veil = $('veil'), bar = $('bar').firstElementChild, status = $('status');
const hud = $('hud'), panel = $('panel');
const clockT = $('clock-t'), clockP = $('clock-p');
const perfFps = $('perf-fps'), perfDraw = $('perf-draw'), perfTri = $('perf-tri');
const coarsePointer = typeof matchMedia === 'function'
  && matchMedia('(pointer: coarse)').matches;
/**
 * `coarsePointer` ne décrit que le pointeur PRIMAIRE : un laptop tactile à
 * trackpad répond false et n'aurait jamais eu les commandes (review ADV). Le
 * tier de qualité reste sur le pointeur primaire — un hybride puissant garde
 * l'ultra — mais l'UI tactile, elle, s'active aussi à la volée au premier
 * doigt posé. La classe `touch` sur <html> pilote tout le layout (panneau
 * relogé, perf/hint masqués), y compris en paysage où les media queries en
 * largeur mentaient.
 */
let touchActive = coarsePointer;
if (touchActive) document.documentElement.classList.add('touch');

let loadStep = 0;
const LOAD_STEPS = 15;
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

// Premier doigt hybride : monter l'UI AVANT qu'OrbitControls ne capture.
// En bubble, OC (créé juste après) mangeait le geste (ADV D2).
let mountTouchControls = () => {};
const onFirstTouchCapture = (e) => {
  if (e.pointerType !== 'touch' || touchActive) return;
  e.stopImmediatePropagation();
  mountTouchControls();
};
renderer.domElement.addEventListener('pointerdown', onFirstTouchCapture, { capture: true });

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
  // Object.hasOwn, pas un lookup nu : `?q=constructor` remonterait la chaine
  // de prototypes, passerait la garde, et tous les budgets vaudraient
  // undefined — scene morte au lieu du repli sur le defaut.
  const requested = new URLSearchParams(location.search).get('q');
  if (requested && Object.hasOwn(QUALITY, requested)) return requested;
  try {
    const stored = localStorage.getItem('sakurajima.quality');
    if (stored && Object.hasOwn(QUALITY, stored)) return stored;
  } catch { /* private mode — fall through */ }
  // Dernier repli seulement : un écran tactile n'a rien demandé, il ne doit
  // pas payer le bake ultra calibré pour la machine de développement.
  return coarsePointer ? DEFAULT_QUALITY_MOBILE : DEFAULT_QUALITY;
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
  poi: null, crabs: null, herons: null, dragonflies: null,
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
  pinching: false,
  dragPointer: null,
  lastX: 0,
  lastY: 0,
};
const followPointers = new Map();
let pinchStartGap = 0;
let pinchStartDistance = follow.distance;
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

  if (!follow.dragging && !follow.pinching && s.speed > 0.4) {
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

  // Plancher = max(sol, eau plate). La houle ne doit pas pomper la caméra.
  // Même prédicat que water.isPond : pondWaterYAt, sinon mer à seaLevel.
  const gx = _camWant.x, gz = _camWant.z;
  const ground = (world.groundAt || world.heightAt)(gx, gz);
  const pondY = world.ponds ? world.ponds.pondWaterYAt(gx, gz) : null;
  const stillSea = world.heightAt && world.island
    && world.heightAt(gx, gz) < world.island.seaLevel
    ? world.island.seaLevel
    : null;
  const waterY = pondY !== null ? pondY : stillSea;
  const floor = Math.max(ground, waterY ?? -Infinity) + 1.2;
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
    if (touchActive) {
      followPointers.clear();
      follow.dragging = false;
      follow.pinching = false;
      follow.dragPointer = null;
    }
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

const clampFollowDistance = (distance) => Math.min(
  follow.maxDistance,
  Math.max(follow.minDistance, distance)
);

function pointerGap() {
  const points = [...followPointers.values()];
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function beginPinch() {
  pinchStartGap = pointerGap();
  pinchStartDistance = follow.distance;
  follow.dragging = false;
  follow.pinching = true;
  follow.dragPointer = null;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (world.camMode !== 'follow') return;
  if (touchActive) {
    followPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    renderer.domElement.setPointerCapture(e.pointerId);
    if (followPointers.size === 1) {
      follow.dragging = true;
      follow.pinching = false;
      follow.dragPointer = e.pointerId;
      follow.lastX = e.clientX;
      follow.lastY = e.clientY;
    } else {
      beginPinch();
    }
    return;
  }
  follow.dragging = true;
  follow.lastX = e.clientX;
  follow.lastY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (touchActive) {
    if (world.camMode !== 'follow' || !followPointers.has(e.pointerId)) return;
    followPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (followPointers.size >= 2) {
      const gap = pointerGap();
      if (pinchStartGap > 0 && gap > 0) {
        follow.distance = clampFollowDistance(
          pinchStartDistance * pinchStartGap / gap
        );
      }
      return;
    }
    if (e.pointerId !== follow.dragPointer) return;
  }
  if (!follow.dragging) return;
  follow.yawOffset -= (e.clientX - follow.lastX) * 0.006;
  follow.pitchOffset += (e.clientY - follow.lastY) * 0.004;
  follow.lastX = e.clientX;
  follow.lastY = e.clientY;
});
const endDrag = (e) => {
  if (!touchActive) {
    follow.dragging = false;
    return;
  }
  if (!followPointers.delete(e.pointerId)) {
    follow.dragging = false;
    return;
  }
  if (followPointers.size >= 2) {
    beginPinch();
  } else if (followPointers.size === 1) {
    const [pointerId, point] = followPointers.entries().next().value;
    follow.pinching = false;
    follow.dragging = true;
    follow.dragPointer = pointerId;
    follow.lastX = point.x;
    follow.lastY = point.y;
  } else {
    follow.dragging = false;
    follow.pinching = false;
    follow.dragPointer = null;
  }
};
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);
renderer.domElement.addEventListener('wheel', (e) => {
  if (world.camMode !== 'follow') return;
  e.preventDefault();
  follow.distance = clampFollowDistance(
    follow.distance * (1 + Math.sign(e.deltaY) * 0.12)
  );
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
  initPath({
    heightAt: world.heightAt,
    heightGrid: world.island.heightGrid,
    slopeAt: world.slopeAt,
  });

  // groundAt is the mover surface (dog, follow camera): the terrain PLUS la
  // surface de terre battue de la sente — sans quoi les pattes du shiba
  // traversent le ruban (il marchait sur le terrain SOUS le chemin).
  // pathSurfaceLiftAt est le bombé pur du ruban : le dégagement anti-perforation
  // appartient aux triangles et ne se rejoue pas par requête ponctuelle. Son
  // écart à la surface visible est borné par un invariant (≤ 0.25, mesuré 0.098).
  // stoneYAt returns the slab top (or 0). Added-as-lift would fly the dog.
  world.groundAt = (x, z) => {
    const base = world.heightAt(x, z) + pathSurfaceLiftAt(world.heightAt, x, z);
    const stone = world.poi ? world.poi.stoneYAt(x, z) : 0;
    return stone !== 0 ? stone : base;
  };

  await step('étangs et carpes');
  world.ponds.attach({ heightAt: world.heightAt });
  scene.add(world.ponds.group);

  /** Standing water (ponds). Every scatter system has to reject it. */
  world.inWater = (x, z) => world.ponds.isInPond(x, z);

  await step('côte');
  // Après initPath + ponds.attach, avant le shiba : blocked lit hitsSolid.
  world.poi = createPOI({
    seed: SEED,
    heightAt: world.heightAt,
    isOnPath,
    isInPond: world.inWater,
    slopeAt: world.slopeAt,
    season: world.season,
    pondWaterYAt: (x, z) => world.ponds.pondWaterYAt(x, z),
    ponds: world.ponds.PONDS,
  });
  scene.add(world.poi.group);
  world.crabs = createCrabs({
    seed: SEED, quality: q,
    heightAt: world.heightAt,
    isInPond: world.inWater,
  });
  scene.add(world.crabs.mesh);

  await step('étangs jour');
  world.herons = createHerons({
    seed: SEED, quality: q,
    heightAt: world.heightAt,
    ponds: world.ponds.PONDS,
    isInPond: world.inWater,
    pondWaterYAt: (x, z) => world.ponds.pondWaterYAt(x, z),
  });
  scene.add(world.herons.group);
  world.dragonflies = createDragonflies({
    seed: SEED, quality: q,
    heightAt: world.heightAt,
    ponds: world.ponds.PONDS,
    isInPond: world.inWater,
  });
  scene.add(world.dragonflies.mesh);

  await step(world.season === 'autumn' ? 'momiji' : 'cerisiers');
  const foliageDensity = world.season === 'autumn'
    ? (q.label === 'ultra' ? 3.6 : q.label === 'high' ? 2.8 : 2.0)
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
    // multipliers 2.0/2.8/3.6. Typed-array two-pass bake keeps ultra viable.
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
    bounds: { radius: world.island.radius * 1.12 },
    heightAt: world.heightAt,
    slopeAt: world.slopeAt,
    // `exclude`, not `isInPond`: grass.js has no notion of water. Ponds are
    // carved into the heightfield, so their beds pass every test grass does
    // apply. La sente n'est PLUS une exclusion dure : shortZone y garde une
    // herbe rase et clairsemée entre les passages (consigne joueur).
    exclude: (x, z) => world.inWater(x, z)
      || (world.poi && world.poi.stoneYAt(x, z) !== 0),
    shortZone: (x, z) => isOnPath(x, z, 0.25),
    pathLiftAt: (x, z) => pathSurfaceLiftAt(world.heightAt, x, z),
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
    // Mer et intérieur de rocher : pas de tapis. Les étangs SONT voulus
    // (feuille à la surface) — waterYAt pose sur le plan d'eau, pas le lit.
    exclude: (x, z) => {
      if (world.island.hitsRock(x, z, 0)) return true;
      if (world.ponds.pondWaterYAt(x, z) !== null) return false;
      return world.heightAt(x, z) < world.island.seaLevel;
    },
    waterYAt: (x, z) => world.ponds.pondWaterYAt(x, z),
    onPath: (x, z) => isOnPath(x, z, 0.5),
  });
  scene.add(world.petals.mesh);
  if (world.petals.carpet) scene.add(world.petals.carpet);

  await step('ciel');
  world.sky = createSky({
    scene, renderer, camera, quality: q, season: world.season,
    islandRadius: world.island.radius * 1.30 + 10,
  });

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

  await step('lucioles');
  // APRES ponds.attach() (l.312) : PONDS ne porte les rayons et le plan d'eau
  // REELLEMENT creuses qu'une fois attach passe. Construire avant donnerait un
  // habitat calcule sur des rayons nominaux que rien d'autre n'utilise.
  //
  // PIEGE, paye pendant le chantier : passer `q`, l'OBJET de qualite, et surtout
  // PAS `world.quality` — qui est la CHAINE 'low'/'high'/'ultra'. Avec la chaine,
  // `quality?.fireflies` vaut undefined, le `?? 0` de createFireflies donne un
  // compte de zero, et on obtient une population VIDE sans la moindre erreur.
  world.fireflies = createFireflies({
    seed: SEED, quality: q,
    heightAt: world.heightAt,
    ponds: world.ponds.PONDS,
    isInPond: world.inWater,
  });
  scene.add(world.fireflies.mesh);

  await step('fleurs et lanternes');
  world.details = createDetails({
    seed: SEED, quality: q,
    heightAt: world.heightAt,
    heightGrid: world.island.heightGrid,
    slopeAt: world.slopeAt,
    normalAt: world.island.normalAt,
    inWater: world.inWater,
    wind: world.wind,
    season: world.season,
  });
  scene.add(world.details.group);

  await step('papillons');
  // APRES createDetails, et l'ordre n'est pas negociable : `flowerSpots` est
  // REMPLI par createDetails et vaut un Float32Array VIDE avant lui. Construire
  // les papillons plus haut — a cote des lucioles, ou l'envie est forte — donne
  // une population de zero sans la moindre erreur.
  //
  // Meme piege que pour les lucioles : `q`, l'OBJET de qualite, jamais
  // `world.quality` qui est la CHAINE du tier.
  world.butterflies = createButterflies({
    seed: SEED, quality: q, season: world.season,
    heightAt: world.heightAt,
    flowerSpots,
  });
  scene.add(world.butterflies.mesh);

  await step('shiba');
  // Une seule question posée à l'eau. Le chien ne connaît plus ni les étangs ni
  // le niveau de la mer : il connaît une hauteur d'eau, ou rien. Les trois règles
  // contradictoires d'avant (seaLevel - wadeDepth, isInPond && h < seaLevel+0.1,
  // waterSurfaceAt) sont ce qui produisait le bug "eau dessous / eau dessus".
  const water = {
    surfaceAt: (x, z, t) => {
      const p = world.ponds.pondWaterYAt(x, z);
      if (p !== null) return p;
      return world.heightAt(x, z) < world.island.seaLevel
        ? world.island.seaLevel + oceanSwellY(x, z, t)
        : null;
    },
    isPond: (x, z) => world.ponds.pondWaterYAt(x, z) !== null,
    // uTime is the shared object read by the pond shader and was updated at the
    // start of this same frame, so an impact cannot be born a frame early/late.
    impact: (x, z, strength) => world.ponds.spawnDogRipple(
      x, z, world.wind.uniforms.uTime.value, strength
    ),
    setSwimmer: (x, z, active, amp, dt) => world.ponds.setSwimmer(x, z, active, amp, dt),
  };
  world.particles = createParticles({ quality: q, seed: SEED, season: world.season });
  scene.add(world.particles.group);
  // Le chien glTF est le chien normal ; le procédural est le repli. Un asset
  // absent ou cassé doit dégrader EN SILENCE pour l'utilisateur et bruyamment
  // en console — pas faire disparaître le chien. C'est le dernier système
  // construit, rien avant lui ne lit world.shiba, et le voile ne tombe qu'à la
  // ligne 509 : cet await se déroule sous l'écran de chargement.
  let dogBody = null;
  try {
    dogBody = await loadShibaBody();
  } catch (err) {
    console.warn('[main] shiba glTF indisponible, repli procédural :', err);
  }
  world.shiba = createShiba({
    body: dogBody,
    seed: SEED,
    // groundAt, pas heightAt : le chien marche SUR la terre battue des sentes
    // (le commentaire de groundAt le promettait, le câblage passait le terrain
    // nu — invisible tant que le ruban collait au sol, enfouissement d'~1 u en
    // pente quand les rubans se sont mis à flotter).
    heightAt: world.groundAt,
    slopeAt: world.slopeAt,
    normalAt: world.island.normalAt,
    water,
    blocked: (x, z) => world.island.hitsRock(x, z, 0.35)
      || world.poi.hitsSolid(x, z, 0.35),
    particles: world.particles,
    wind: world.wind,
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

  let touchMounted = false;
  mountTouchControls = () => {
    if (touchMounted) return;
    touchMounted = true;
    touchActive = true;
    document.documentElement.classList.add('touch');
    createTouchControls({
      shiba: world.shiba,
      onJump: () => world.shiba?.jump?.(),
      onCamera: () => {
        setCamMode(world.camMode === 'follow' ? 'orbit' : 'follow');
        return world.camMode === 'follow';
      },
      onPause: () => {
        world.paused = !world.paused;
        return world.paused;
      },
    });
    // Le mini-hint tactile et le bandeau clavier partagent le même geste de
    // sortie : dès que le joueur essaie le joystick, l'explication a servi.
    $('touch-stick').addEventListener('pointerdown', dismissHint, { once: true });
  };
  if (touchActive) {
    mountTouchControls();
  } else {
    // Hybride : le pointeur primaire est une souris, mais un doigt peut se
    // poser quand même — l'UI tactile se monte alors à la volée (review ADV).
    const onFirstTouch = (e) => {
      if (e.pointerType !== 'touch') return;
      removeEventListener('pointerdown', onFirstTouch);
      mountTouchControls();
    };
    addEventListener('pointerdown', onFirstTouch);
  }

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

  world.petals.update(t, shaderPhase, camera);
  world.clouds.update(t, dt, phase);
  world.birds.update(t, dt, phase);
  world.details.update(t, phase);
  // `phase` brut et non `shaderPhase` : le materiau est additif et non eclaire,
  // il n'a aucun usage de keyIntensity normalise.
  world.fireflies.update(t, phase);
  // `shaderPhase` et NON `phase` : contrairement aux lucioles (additives, non
  // eclairees), les ailes sont eclairees par la cle. keyIntensity brut vaut
  // ~4.3 a midi — l'echelle d'une DirectionalLight — et brulerait les ailes en
  // blanc pur. main.js le normalise une fois, ici.
  world.butterflies.update(t, dt, shaderPhase);

  // The dog reads the camera to work out which way "forward" is, so he updates
  // before the camera moves this frame. One frame of lag in the control frame is
  // imperceptible; the reverse order makes fast turns feel like ice.
  world.particles.update(t);
  world.shiba.update(t, dt, { camera });

  // Fragment wake: keep the expensive shader work inside a 15-unit disc, with
  // a short segment trailing the dog's actual heading. The pond surface is
  // deliberately rejected here; ponds own their separate ripple budget.
  const wakeU = world.island.waterUniforms;
  const dog = world.shiba;
  const dogX = dog.position.x, dogZ = dog.position.z;
  world.crabs?.update(t, dogX, dogZ);
  world.herons?.update(t, dt, dogX, dogZ);
  world.dragonflies?.update(t, phase);
  const inSea = world.ponds.pondWaterYAt(dogX, dogZ) === null
    && world.heightAt(dogX, dogZ) < world.island.seaLevel;
  if (inSea) {
    const speedN = dog.speedN;
    const contact = Math.min(1, dog.state.depth / 0.35);
    const trailLength = 4 + 10 * speedN;
    wakeU.uWake.value.set(dogX, dogZ, (0.32 + 0.68 * speedN) * contact, 15 * 15);
    wakeU.uWakeTrail.value.set(
      dogX - Math.sin(dog.heading) * trailLength,
      dogZ - Math.cos(dog.heading) * trailLength
    );
  } else {
    wakeU.uWake.value.w = 0;
  }

  world.birds.setRepeller?.(world.shiba.position);
  world.herons?.setRepeller?.(world.shiba.position);
  // Meme repulseur, rayon dix fois plus court (4 u contre 26) : on approche un
  // papillon de tres pres avant qu'il ne parte, et un papillon qui decolle a
  // 26 u lit comme un oiseau.
  world.butterflies.setRepeller?.(world.shiba.position);
  // The meadow parts around him. Placed after shiba.update so the uniform is
  // this frame's position, and unconditional: it applies in both camera modes —
  // in follow mode you swim through it, in orbit mode you watch him wade.
  world.grass.setPlayer?.(world.shiba.position, dt);
  // Le tapis de pétales frémit au passage : vitesse normalisée du shiba.
  world.petals.setPlayer?.(world.shiba.position.x, world.shiba.position.z,
    world.shiba.speedN);

  if (world.camMode === 'follow') {
    updateFollowCamera(dt);
  } else {
    // Walking him is an interaction like any other: the idle drift should stop
    // the moment the player takes over, exactly as it does when you grab the view.
    if (world.shiba.state.moving) controls.autoRotate = false;
    controls.update();
  }

  // EffectComposer runs several renderer.render passes; with autoReset the HUD
  // only sees the last fullscreen blit (1 draw / ~0 tris). Reset once per frame.
  renderer.info.autoReset = false;
  renderer.info.reset();
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
// iOS expose encore son geste propriétaire même avec un viewport verrouillé ;
// sans cette garde, un double-tap sur la tête peut pousser le panneau hors vue.
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

$('panel-head').onclick = () => {
  panel.classList.toggle('folded');
  // Miroir de l'etat sur <html> : en layout tactile, reglages ouverts =
  // commandes masquees (elles partagent le bord droit). Sans effet au clavier.
  document.documentElement.classList.toggle('panel-open', !panel.classList.contains('folded'));
};

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
  if (!Object.hasOwn(QUALITY, q) || q === world.quality) return;
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
  if (e.repeat) return;
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
