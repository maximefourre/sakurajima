/**
 * shiba.js — the playable Shiba Inu.
 *
 * A procedural dog: no glTF, no rig, no textures, in keeping with the rest of the
 * scene. The whole animal is tapered tubes swept along hand-authored centrelines
 * and painted per-vertex, hung off a hierarchy of Object3Ds that a few sine waves
 * drive. That sounds crude for a character, but a shiba is carried almost entirely
 * by silhouette and by two colours — a curled tail on the back, small forward-set
 * triangular ears, a blunt muzzle, and the cream *urajiro* running under the jaw,
 * chest, belly and tail against a red coat. Get those and it is unmistakable at
 * fifty metres; miss them and no amount of skinning will save it.
 *
 * Scale is a deliberate lie. A real shiba stands 0.4 units at the withers in this
 * world, which is shorter than a blade of grass (0.55) and invisible from any
 * camera that also shows the island. He is built at roughly twice life size so he
 * reads as a character rather than as a speck, and still sits comfortably under a
 * 7-unit cherry tree.
 */

import * as THREE from 'three';
import { streamFor, R, clamp, mix, smoothstep } from './noise.js';
import { WORLD, LAND_SCALE } from './config.js';
import { isOnPath } from './details.js';
import { PARTICLE_KIND } from './particles.js';
import { TAU, UP, SHIBA_BUILD, buildBody } from './shiba-geom.js';

export const SHIBA = {
  walkSpeed: 6.4,
  runSpeed: 14.8,
  accel: 14.0,
  brake: 18.0,
  turnRate: 7.0,          // rad/s the body swings toward its heading
  /** Above this terrain slope he refuses to climb — cliffs are not for dogs. */
  maxSlope: 0.72,
  swimDepth: 0.85,     // deeper than this under the surface: he loses his footing
  swimFloat: 0.85,     // paws this far under the surface while swimming
  swimReach: 3.0,      // sea: refuse once the seabed falls below -3
  swimSpeed: 4.6,      // an energetic paddle, slower than walkSpeed
  wadeSlow: 0.55,      // speed factor at half swimDepth
  idleBeforeSit: 4.2,     // seconds of stillness before he sits down
  idleBeforeBark: 9.5,    // long sit before a spontaneous woof
  wetBeforeShake: 1.2,    // swim/wade seconds before a dry-land shake
  lookHeron: 18,          // look at a heron inside this XZ radius
  lookPoi: 10,            // hokora / jizō / pin
  lookPetal: 6,           // pétale / feuille réellement en l'air
  lookYawMax: 0.95,       // posed look yaw clamp
  lookTrack: 2.2,         // max XZ jump that still counts as the same target
  lookYawTau: 0.18,       // exp smooth on posed look yaw / pitch
  footprintLife: 26.0,    // seconds a paw print survives in the sand
  footprintCount: 96,
  /** Molette : amplitude du creux de sillage en nage. Se regle A CHAUD via
   *  (await import('/src/shiba.js')).SHIBA.wakeAmp = x — a 0.08 le sillage
   *  passe sous le clapot de brise, a 0.22 il devient un halo lumineux. */
  wakeAmp: 0.13,
};

const GAITS = {
  walk: {
    ph: [0, Math.PI, Math.PI * 0.5, Math.PI * 1.5],
    amp: 0.30,
    knee: 1.20,
    bob: 0.5,
  },
  trot: {
    ph: [0, Math.PI, Math.PI, 0],
    amp: 0.62,
    knee: 1.35,
    bob: 1.0,
  },
  gallop: {
    ph: [0, 0.35, Math.PI, Math.PI + 0.35],
    amp: 0.95,
    knee: 1.55,
    bob: 1.6,
  },
};

const SHAKE_DURATION = 0.9;
const SHAKE_FAILSAFE = 1.4;
const SHAKE_DROPLETS = 6;
const BARK_DURATION = 0.38;
const BLINK_DURATION = 0.09;

// Ground-reaction tuning: these two formulas are deliberately the only knobs.
// If the gait ever reads as permanent fog, lower their floors (1 and 0.6), not
// the event structure or the progressive response from walk through run.
const PAW_BURST_COUNT = (speedN) => 1 + Math.round(2 * speedN);
const PAW_BURST_SIZE = (speedN) => 0.6 + 0.8 * speedN;

// Hard flotation invariant: 0.66 * 1.35 = 0.891 > 0.85. The back therefore
// clears the water by 0.041 u and the muzzle by about 0.36 u. At swimFloat 0.55
// he looked as if he walked on water; without flotation he was a submarine.
if (SHIBA_BUILD.standHeight * SHIBA_BUILD.scale <= SHIBA.swimFloat) {
  throw new Error('[shiba] swimFloat submerges the back; update SHIBA_BUILD or flotation');
}

/* ────────────────────────────────────────────────────────────────
   Footprints
   ──────────────────────────────────────────────────────────────── */

/**
 * A ring buffer of paw prints stamped into wet sand, fading out over half a
 * minute. Instanced with a per-instance birth time so the fade costs one
 * subtraction in the fragment stage instead of a CPU pass over the buffer.
 */
function createFootprints(count, life) {
  const geo = new THREE.PlaneGeometry(0.30, 0.34);
  // rotateX(-PI/2) couche le plan, mais envoie son bord v=1 — celui ou le
  // fragment dessine les DOIGTS — vers -Z, alors que le modele regarde +Z et
  // que stampPrint applique le lacet du chien. Les empreintes pointaient donc
  // vers l'arriere (constate en jeu). Le demi-tour remet les doigts devant ;
  // il conserve la normale vers le haut et ne fait que miroiter u, ce que la
  // disposition symetrique des quatre orteils rend sans effet.
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI);
  const born = new Float32Array(count).fill(-1e9);
  geo.setAttribute('aBorn', new THREE.InstancedBufferAttribute(born, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLife: { value: life },
      uColor: { value: new THREE.Color(0x6a5540) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aBorn;
      varying vec2 vUv;
      varying float vBorn;
      // instanceMatrix is declared for us by three whenever the material is used
      // on an InstancedMesh. The matrices stamped into it are WORLD space, which
      // is only equivalent to this because the mesh hangs off an untransformed
      // group — the prints stay where they were left rather than following the
      // dog around, which is rather the point of a footprint.
      void main() {
        vUv = uv;
        vBorn = aBorn;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uLife;
      uniform vec3  uColor;
      varying vec2 vUv;
      varying float vBorn;

      float pad(vec2 p, vec2 c, vec2 r) {
        vec2 d = (p - c) / r;
        return 1.0 - smoothstep(0.62, 1.0, length(d));
      }

      void main() {
        float age = uTime - vBorn;
        if (age < 0.0 || age > uLife) discard;
        vec2 p = vUv;
        // One metacarpal pad and four toes. Drawn rather than modelled because a
        // print is a stain, not a surface: geometry this small z-fights the
        // terrain at any distance where you could actually see the shape.
        float m = pad(p, vec2(0.50, 0.34), vec2(0.20, 0.17));
        m = max(m, pad(p, vec2(0.34, 0.62), vec2(0.085, 0.10)));
        m = max(m, pad(p, vec2(0.45, 0.72), vec2(0.085, 0.10)));
        m = max(m, pad(p, vec2(0.57, 0.72), vec2(0.085, 0.10)));
        m = max(m, pad(p, vec2(0.68, 0.60), vec2(0.085, 0.10)));
        float fade = 1.0 - age / uLife;
        float a = m * fade * fade * 0.55;
        if (a < 0.005) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.name = 'shiba-footprints';
  mesh.frustumCulled = false;   // instances move; the baked bounds go stale
  mesh.renderOrder = 2;         // over the terrain, under the ocean's blend
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Park every instance far below the seabed until it is first used, so the
  // untouched half of the buffer never draws over anything.
  const m4 = new THREE.Matrix4().makeTranslation(0, -9999, 0);
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, m4);
  mesh.instanceMatrix.needsUpdate = true;

  return { mesh, born, cursor: 0, material, geo };
}

/* ────────────────────────────────────────────────────────────────
   Factory
   ──────────────────────────────────────────────────────────────── */

/**
 * @param {object}   opts
 * @param {number}   [opts.seed]
 * @param {Function} opts.heightAt   (x, z) => y
 * @param {Function} [opts.slopeAt]  (x, z) => 0..1
 * @param {Function} [opts.normalAt] (x, z, out) => Vector3
 * @param {object}   opts.water      REQUIRES surfaceAt(x, z, t) => y|null.
 *   impact(x, z, strength) and setSwimmer(x, z, active, amp, dt) are OPTIONAL
 *   presentation hooks, normalised to no-ops below: locomotion must not depend
 *   on whether anything is listening for ripples.
 * @param {object}   [opts.wind]     from createWind(); read for ear and tail flutter
 * @param {object}   [opts.particles] exposes burst(kind, x, y, z, count,
 *                                      strength, crownCount, driftX, driftZ)
 */
export function createShiba({
  seed = 1337,
  heightAt,
  slopeAt = null,
  normalAt = null,
  water = null,
  wind = null,
  particles = null,
  /** (x, z) => true si un rocher bloque. Absent = pas de collision roche. */
  blocked = null,
  /**
   * (x, z) => {x, z} — dépénétration d'un solide occupé (rocher).
   * Absent : recherche en spirale. Sans l'un ou l'autre, un saut
   * au-dessus d'un mur puis la chute laisse le chien prisonnier.
   */
  unstick = null,
  /** Corps préconstruit, au contrat de buildBody() — le rig glTF de
   *  shiba-gltf.js. `null` construit le chien procédural, qui est le repli. */
  body = null,
} = {}) {
  if (typeof heightAt !== 'function') {
    throw new Error('[shiba] createShiba requires heightAt(x, z) -> y');
  }
  if (!water || typeof water.surfaceAt !== 'function') {
    throw new Error('[shiba] createShiba requires water.surfaceAt(x, z, t) -> y|null');
  }
  // Only surfaceAt is a contract; impact and setSwimmer are effects. A caller
  // that honours the documented interface with { surfaceAt } alone used to die
  // on its first update with "water.setSwimmer is not a function", ON DRY
  // GROUND — the call is unconditional. Normalising here keeps the dog's
  // locomotion independent of whether any water is listening.
  const noop = () => {};
  const waterImpact = typeof water.impact === 'function' ? water.impact : noop;
  const waterSetSwimmer = typeof water.setSwimmer === 'function' ? water.setSwimmer : noop;
  if (particles && typeof particles.burst !== 'function') {
    throw new Error('[shiba] particles must expose burst(kind, x, y, z, count, strength)');
  }

  // Imported world datum, not a second water rule: only passable() uses it to
  // distinguish the open sea's depth leash from elevated pond surfaces.
  const seaLevelLocal = WORLD.seaLevel;

  const rng = streamFor(seed, 'shiba');
  const shakeRng = streamFor(seed, 'shiba:shake-droplets');
  const blinkRng = streamFor(seed, 'shiba:blink');
  const barkRng = streamFor(seed, 'shiba:bark');
  const lookRng = streamFor(seed, 'shiba:look');

  // Le corps peut être fourni tout fait (`body`) : c'est le rig glTF de
  // shiba-gltf.js. Sinon on construit le chien procédural, qui reste le repli.
  // Le matériau n'est créé QUE dans cette branche-là : le rig glTF apporte le
  // sien, et lui imposer `vertexColors: true` sans attribut `color` rendrait le
  // chien NOIR, silencieusement — piège n°2 d'AGENTS.md.
  const rig = body ?? buildBody(new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
    flatShading: false,
  }));
  const group = new THREE.Group();
  group.name = 'shiba-rig';
  group.add(rig.root);
  rig.root.scale.setScalar(SHIBA_BUILD.scale);

  const prints = createFootprints(SHIBA.footprintCount, SHIBA.footprintLife);
  group.add(prints.mesh);

  /* ── state ─────────────────────────────────────────────────── */
  // Apparition SUR le chemin : le carrefour du réseau (config PATHS, point
  // commun des trois routes), museau tourné vers la montée aux torii.
  const SPAWN = { x: 6 * LAND_SCALE, z: -30 * LAND_SCALE, heading: -1.2 };
  const position = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
  position.y = heightAt(position.x, position.z);

  const state = {
    heading: SPAWN.heading,
    speed: 0,
    moving: false,
    running: false,
    wading: false,
    swimming: false,   // hysteretic contact state; swimBlend softens the pose
    swimBlend: 0,      // 0..1 animation blend, deliberately not another state
    depth: 0,          // one surface query per frame; 0 means dry
    sitting: 0,        // 0..1 blend, not a boolean — he folds down over ~0.8 s
    excitement: 0,     // decays after a run; drives the tail
    tailPhase: 0,      // integrated wag phase — sin(t*rate) with a moving rate whips
    vy: 0,             // vertical velocity while airborne
    airborne: false,
    idleTime: 0,
    gait: 0,           // accumulated stride phase in radians
    swimGait: 0,       // forced paddle cadence, independent of forward speed
    wetness: 0,        // retained water; filled while wading/swimming
    wetTime: 0,        // seconds of this immersion (wade or swim)
    shake: 0,          // 0..1 final pose-stack weight, like sitting/swimBlend
    shakeElapsed: 0,   // local shake clock; also drives the hard failsafe
    shakeCrossing: 0,  // last emitted sin(s * 34) zero-crossing index
    bark: 0,           // 0..1 one-shot woof weight
    barkElapsed: 0,
    look: 0,           // 0..1 head-look blend; never yaws the body
    lookKind: null,
  };

  /* ── input ─────────────────────────────────────────────────── */
  // Keyed off event.code, not event.key: code is the PHYSICAL key, so the same
  // three lines give WASD on QWERTY and ZQSD on AZERTY without a layout table.
  const MOVE_CODES = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ]);
  const held = new Set();
  let enabled = true;
  let stickFwd = 0;
  let stickSide = 0;
  let stickRunning = false;
  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    held.add(e.code);
    if (MOVE_CODES.has(e.code)) e.preventDefault();
  };
  const onKeyUp = (e) => held.delete(e.code);
  const onBlur = () => held.clear();
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', onBlur);

  /* ── scratch ───────────────────────────────────────────────── */
  const _n = new THREE.Vector3();
  const _qAlign = new THREE.Quaternion();
  const _qYaw = new THREE.Quaternion();
  const _qWant = new THREE.Quaternion();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _wish = new THREE.Vector3();
  const _probe = new THREE.Vector3();
  const _m4 = new THREE.Matrix4();
  const _pawWorld = new THREE.Vector3();
  const _torsoWorld = new THREE.Vector3();
  const _printQ = new THREE.Quaternion();
  const _printSpin = new THREE.Quaternion();
  const _printS = new THREE.Vector3(1, 1, 1);

  const legPlanted = [true, true, true, true];
  let printClock = 0;
  let nowT = 0;

  /** Head-up idle beat: he looks up at the falling petals now and then. */
  let lookUpTimer = R.range(rng, 3, 9);
  let lookUp = 0;

  /** Seeded irregular blink, separated from the idle-look random stream. */
  let blinkTimer = R.range(blinkRng, 2.4, 6.8);
  let blinkElapsed = -1;

  let lookTargets = [];
  let lookAim = null;
  let lookHold = 0;
  let lookCool = 0;
  let lookHeadYaw = 0;
  let lookHeadPitch = 0;
  let nextIdleBark = R.range(barkRng, SHIBA.idleBeforeBark, SHIBA.idleBeforeBark + 4);
  const _evPos = new THREE.Vector3();
  const api = { onEvent: () => {} };

  function emit(name) {
    const fn = api.onEvent;
    if (typeof fn === 'function') fn(name, _evPos.copy(position));
  }

  function startBark() {
    if (state.shake > 0) return false;
    state.bark = 1;
    state.barkElapsed = 0;
    emit('bark');
    return true;
  }

  function lookRadius(kind) {
    return kind === 'heron' ? SHIBA.lookHeron
      : kind === 'petal' ? SHIBA.lookPetal
      : SHIBA.lookPoi;
  }

  function inLookRange(t) {
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.z)) return false;
    return Math.hypot(t.x - position.x, t.z - position.z) < lookRadius(t.kind);
  }

  function pickLook() {
    let best = null, bestD = Infinity;
    for (let i = 0; i < lookTargets.length; i++) {
      const t = lookTargets[i];
      if (!inLookRange(t)) continue;
      const d = Math.hypot(t.x - position.x, t.z - position.z);
      if (d < bestD) { best = t; bestD = d; }
    }
    return best;
  }

  /**
   * Hold the current look. Nearest-of-all would teleport the skull whenever a
   * falling petal (or a second heron) briefly wins the distance race — that
   * reads as a frame swap, not a glance. Track the same object; freeze the
   * last aim if it merely vanished.
   */
  function trackLook(prev) {
    if (!prev) return pickLook();
    if (prev.id != null) {
      for (let i = 0; i < lookTargets.length; i++) {
        const t = lookTargets[i];
        if (t && t.id === prev.id && inLookRange(t)) return t;
      }
    }
    let best = null, bestD = SHIBA.lookTrack;
    for (let i = 0; i < lookTargets.length; i++) {
      const t = lookTargets[i];
      if (!t || t.kind !== prev.kind || !inLookRange(t)) continue;
      const d = Math.hypot(t.x - prev.x, t.z - prev.z);
      if (d < bestD) { best = t; bestD = d; }
    }
    if (best) return best;
    return inLookRange(prev) ? prev : null;
  }

  function aimYaw(target) {
    const az = Math.atan2(target.x - position.x, target.z - position.z);
    let dYaw = az - state.heading;
    while (dYaw > Math.PI) dYaw -= TAU;
    while (dYaw < -Math.PI) dYaw += TAU;
    return dYaw;
  }

  /* ── terrain queries ───────────────────────────────────────── */

  /** Can he move here? Water and dry ground each have one coherent rule. */
  function passable(x, z) {
    if (typeof blocked === 'function' && blocked(x, z)) return false;
    const h = heightAt(x, z);
    const s = water.surfaceAt(x, z, nowT);
    if (s !== null) {
      // Classification étang/mer : water.isPond, JAMAIS la hauteur de surface.
      // La houle (amp 1.15) dépasse 0.5 et ouvrait la laisse (audit C1).
      if (typeof water.isPond === 'function' && water.isPond(x, z)) return true;
      return h > seaLevelLocal - SHIBA.swimReach;
    }
    return !(slopeAt && slopeAt(x, z) > SHIBA.maxSlope);
  }

  /**
   * Move toward `_wish`, sliding along whatever blocks it rather than stopping
   * dead. Walking a dog into a lake and having him stick to an invisible wall
   * looks broken; having him trot along the waterline looks like he decided not
   * to get wet.
   */
  function tryMove(dx, dz) {
    if (passable(position.x + dx, position.z + dz)) {
      position.x += dx; position.z += dz;
      return true;
    }
    if (passable(position.x + dx, position.z)) { position.x += dx; return true; }
    if (passable(position.x, position.z + dz)) { position.z += dz; return true; }
    return false;
  }

  /**
   * `tryMove` refuse d'ENTRER dans un solide ; il ne sort pas d'un
   * volume déjà occupé. Cas réel : saut au-dessus de `topY`, chute
   * au centre, plus aucun pas XZ n'est passable.
   */
  function freeFromSolid() {
    if (typeof blocked !== 'function') return;
    if (!blocked(position.x, position.z)) return;
    if (typeof unstick === 'function') {
      const p = unstick(position.x, position.z);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && passable(p.x, p.z)) {
        position.x = p.x;
        position.z = p.z;
        return;
      }
    }
    for (let r = 0.35; r <= 16; r += 0.35) {
      const n = 8 + ((r * 6) | 0);
      for (let i = 0; i < n; i++) {
        const a = state.heading + (i / n) * TAU;
        const x = position.x + Math.sin(a) * r;
        const z = position.z + Math.cos(a) * r;
        if (passable(x, z)) {
          position.x = x;
          position.z = z;
          return;
        }
      }
    }
  }

  /**
   * Emit one material-aware event at the visible support surface.
   *
   * The dust is thrown BEHIND him, not straight up from the paw. A symmetric
   * puff at the contact point spawns under the belly, where his own silhouette
   * hides it — measured in game by toggling the depth test, and it is also what
   * really happens: a running animal kicks material backwards.
   */
  function emitSurfaceBurst(x, z, count, strength, crownCount = 1, knownWaterY = undefined) {
    if (!particles) return;
    const back = state.moving ? 1.15 * (0.35 + 0.65 * clamp(state.speed / SHIBA.runSpeed, 0, 1)) : 0;
    const dx = -Math.sin(state.heading) * back;
    const dz = -Math.cos(state.heading) * back;

    const waterY = knownWaterY === undefined ? water.surfaceAt(x, z, nowT) : knownWaterY;
    if (waterY !== null) {
      particles.burst(PARTICLE_KIND.WATER, x, waterY, z, count, strength, crownCount, dx, dz);
      return;
    }

    const h = heightAt(x, z);
    const kind = isOnPath(x, z)
      ? PARTICLE_KIND.DIRT
      : h < WORLD.beachTop ? PARTICLE_KIND.SAND : PARTICLE_KIND.MEADOW;
    particles.burst(kind, x, h, z, count, strength, 0, dx, dz);
  }

  /* ── animation ─────────────────────────────────────────────── */

  /**
   * Periodic power stroke: -1 -> +1 takes 34% of the cycle, the return takes
   * the remaining 66%. The 2*x-1 remap turns the brief's 0 -> 1 -> 0 sine arch
   * into a reusable signed limb angle without losing the asymmetric timing.
   */
  function swimStroke(phase) {
    const k = 0.34;
    const p = ((phase / TAU) % 1 + 1) % 1;
    const warped = p < k
      ? 0.5 * p / k
      : 0.5 + 0.5 * (p - k) / (1 - k);
    return 2 * Math.sin(Math.PI * warped) - 1;
  }

  function animate(t, dt, speedN) {
    const swim = state.swimBlend;
    const sit = state.sitting;
    const shake = state.shake;
    const stride = 5.2 + speedN * 7.5;
    // One integrated land phase feeds every gait output. In particular, never
    // turn this into sin(t * rate): a changing rate would inject t * dRate/dt.
    if (shake <= 0) state.gait += dt * stride * (0.25 + speedN);
    // A swimming dog keeps paddling even while the player releases the stick.
    state.swimGait += dt * 10.5;

    // The transition bands do not overlap. Defining trot as the remainder makes
    // the three scalar weights sum to exactly one, including at the endpoints.
    const trotGate = smoothstep(0.26, 0.42, speedN);
    const gallopGate = smoothstep(0.64, 0.80, speedN);
    const walkW = 1 - trotGate;
    const gallopW = gallopGate;
    const trotW = 1 - walkW - gallopW;
    let dominantGait = GAITS.walk;
    if (trotW > walkW && trotW >= gallopW) dominantGait = GAITS.trot;
    else if (gallopW > walkW) dominantGait = GAITS.gallop;

    for (let i = 0; i < 4; i++) {
      const leg = rig.legs[i];
      // Blend complete curve OUTPUTS. Blending the phase offsets themselves
      // makes legs synchronise and de-synchronise through impossible mid-poses.
      const walkPh = state.gait + GAITS.walk.ph[i];
      const trotPh = state.gait + GAITS.trot.ph[i];
      const gallopPh = state.gait + GAITS.gallop.ph[i];
      const walkSwing = Math.sin(walkPh);
      const trotSwing = Math.sin(trotPh);
      const gallopSwing = Math.sin(gallopPh);
      const walkCos = Math.cos(walkPh);
      const trotCos = Math.cos(trotPh);
      const gallopCos = Math.cos(gallopPh);
      const locomotionHip =
        walkW * walkSwing * GAITS.walk.amp
        + trotW * trotSwing * GAITS.trot.amp
        + gallopW * gallopSwing * GAITS.gallop.amp;
      const locomotionKnee = -(
        walkW * Math.max(0, -walkCos) * GAITS.walk.amp * GAITS.walk.knee
        + trotW * Math.max(0, -trotCos) * GAITS.trot.amp * GAITS.trot.knee
        + gallopW * Math.max(0, -gallopCos) * GAITS.gallop.amp * GAITS.gallop.knee
      );

      // Dog paddle is a stereotyped diagonal trot. Its range deliberately
      // exceeds the land gait: 1.34 rad in front, 1.34/1.4 behind. Forelimbs
      // provide propulsion and steering; hind limbs mostly stabilise.
      const paddle = swimStroke(state.swimGait + GAITS.trot.ph[i]);
      const swimAmp = leg.front ? 1.34 : 1.34 / 1.4;
      const swimHip = paddle * swimAmp;
      const swimKnee = -0.42 - Math.max(0, -paddle) * (leg.front ? 0.78 : 0.56);
      // Sitting. Sign convention matters more than the magnitudes here: a
      // positive rotation.x swings a limb BACKWARD and pitches the nose DOWN,
      // because the model faces +Z. The shake pose is a neutral braced stance.
      const sitHip = leg.front ? 0.04 : -0.85;
      const sitKnee = leg.front ? -0.04 : 1.95;
      let hip = mix(locomotionHip, swimHip, swim);
      let knee = mix(locomotionKnee, swimKnee, swim);
      hip = mix(hip, sitHip, sit);
      knee = mix(knee, sitKnee, sit);
      // Le mélange de secouage est appliqué ICI, en amont du hook : si chaque
      // rig devait y penser, l'oubli ferait régresser le chien procédural. Le
      // hook reçoit donc les angles FINAUX ; les poids ne sont passés qu'à
      // titre indicatif, pour qu'un rig puisse traiter l'assise à part.
      const hipF = mix(hip, 0, shake);
      const kneeF = mix(knee, 0, shake);
      if (rig.poseLeg) {
        rig.poseLeg(leg, hipF, kneeF, { swim, sit, shake, speedN });
      } else {
        leg.hip.rotation.x = hipF;
        leg.knee.rotation.x = kneeF;
      }

      // Every ground-reaction consumer keys off one coherent contact curve: the
      // phase of the gait with the largest visual weight for this frame.
      let contactSwing = walkSwing;
      let contactCos = walkCos;
      if (dominantGait === GAITS.trot) {
        contactSwing = trotSwing;
        contactCos = trotCos;
      } else if (dominantGait === GAITS.gallop) {
        contactSwing = gallopSwing;
        contactCos = gallopCos;
      }
      const down = contactSwing < 0 && contactCos > 0;
      if (down && !legPlanted[i]) {
        legPlanted[i] = true;
        if (state.moving) {
          leg.paw.getWorldPosition(_pawWorld);
          emitSurfaceBurst(
            _pawWorld.x,
            _pawWorld.z,
            PAW_BURST_COUNT(speedN),
            PAW_BURST_SIZE(speedN)
          );
          if (!state.swimming) stampPrint(leg);
        }
        if (state.depth > 0.10 && leg.front) {
          leg.paw.getWorldPosition(_pawWorld);
          waterImpact(_pawWorld.x, _pawWorld.z, 0.6 + 0.5 * speedN);
        }
      } else if (!down) {
        legPlanted[i] = false;
      }
    }

    // Body carriage: bob at twice the stride, with each gait contributing its
    // own output amplitude. Gallop also flexes the spine once per stride.
    const gaitBob =
      walkW * GAITS.walk.bob
      + trotW * GAITS.trot.bob
      + gallopW * GAITS.gallop.bob;
    const locomotionBodyY = Math.sin(state.gait * 2) * 0.056 * speedN * gaitBob;
    const locomotionRoll = Math.sin(state.gait) * 0.055 * speedN;
    const locomotionPitch = -0.05 * speedN
      + Math.sin(state.gait) * 0.09 * gallopW
      + (state.airborne ? state.vy * 0.025 : 0);
    const shakeS = clamp(state.shakeElapsed / SHAKE_DURATION, 0, 1);
    const shakeEnvelope = Math.sin(Math.PI * shakeS);
    const shakeWave = Math.sin(shakeS * 34) * shakeEnvelope;
    const shakeTailWave = Math.sin((shakeS - 0.14) * 34) * shakeEnvelope;

    let bodyY = mix(locomotionBodyY, Math.sin(state.swimGait * 2) * 0.018, swim);
    bodyY = mix(bodyY, -0.20, sit);
    let bodyRoll = mix(locomotionRoll, Math.sin(state.swimGait) * 0.035, swim);
    bodyRoll = mix(bodyRoll, 0, sit);
    // Negative X lifts the +Z nose and sinks the croup: a slight, stable trim.
    let bodyPitch = mix(locomotionPitch, -0.18, swim);
    bodyPitch = mix(bodyPitch, -0.30, sit);
    // Même contrat que poseLeg : les trois valeurs sont FINALES. Un rig dont
    // l'anatomie diffère les réinterprète — l'affaissement d'assise vaut -0.20
    // pour une chaîne de patte de 0.52, il enterrerait un chien à moignons.
    // Surtout, ce n'est PAS un facteur multiplicatif : bodyY a déjà absorbé
    // l'assise ci-dessus, un facteur l'amplifierait avec le rebond.
    const bodyYF = mix(bodyY, 0, shake);
    const bodyRollF = mix(bodyRoll, shakeWave * 0.42, shake);
    const bodyPitchF = mix(bodyPitch, 0, shake);
    if (rig.poseBody) {
      rig.poseBody(bodyYF, bodyPitchF, bodyRollF, { swim, sit, shake, speedN });
    } else {
      rig.body.position.y = bodyYF;
      rig.body.rotation.z = bodyRollF;
      rig.body.rotation.x = bodyPitchF;
    }

    // Emit six airborne droplets at every internal zero-crossing. Particle
    // grains already fan radially; a seeded drift rotates each successive fan.
    if (shake > 0 && particles) {
      const crossed = Math.floor(shakeS * 34 / Math.PI);
      while (state.shakeCrossing < crossed) {
        state.shakeCrossing++;
        rig.body.getWorldPosition(_torsoWorld);
        const angle = R.range(shakeRng, 0, TAU);
        particles.burst(
          PARTICLE_KIND.WATER,
          _torsoWorld.x,
          _torsoWorld.y,
          _torsoWorld.z,
          SHAKE_DROPLETS,
          0.95,
          0,
          Math.cos(angle) * 0.8,
          Math.sin(angle) * 0.8
        );
      }
    }

    // Head. It leads the turn while moving, scans slowly when idle, and lifts
    // when something drifts past — the scene is full of falling petals and a dog
    // that never looks at them reads as furniture.
    lookUpTimer -= dt;
    const gustOnset = !!(wind && wind.state && wind.state.gustOnset);
    const looking = state.look > 0.05;
    if ((lookUpTimer <= 0 || gustOnset) && speedN < 0.05 && shake < 0.05 && !looking) {
      lookUp = 1;
      lookUpTimer = R.range(rng, 6, 15);
    }
    lookUp = Math.max(0, lookUp - dt * 0.55);
    const fullScan = Math.sin(t * 0.42) * 0.30 * (1 - speedN);
    let headYaw = mix(fullScan * 0.4, 0, swim);
    headYaw = mix(headYaw, fullScan, sit);
    let headPitch = mix(-0.06 * speedN - lookUp * 0.62, -0.24, swim);
    headPitch = mix(headPitch, -0.05 - lookUp * 0.62, sit);
    headYaw = mix(headYaw, lookHeadYaw, state.look);
    headPitch = mix(headPitch, lookHeadPitch, state.look);
    let neckPitch = mix(0, -0.12, swim);
    neckPitch = mix(neckPitch, -0.28, sit);
    const barkS = state.bark > 0 ? clamp(state.barkElapsed / BARK_DURATION, 0, 1) : 0;
    const barkEnv = state.bark > 0 ? Math.sin(Math.PI * barkS) : 0;
    headPitch += barkEnv * 0.22;
    // Même contrat que poseLeg et poseBody : les cinq valeurs sont FINALES,
    // secouage compris. Un rig dont la tête est démesurée par rapport au cou
    // les réinterprète — lookUp lève le museau de 0.62 rad, ce qui lit comme un
    // à-coup sur un crâne de chibi.
    const pose = {
      dt,
      headYaw: mix(headYaw, 0, shake),
      headPitch: mix(headPitch, 0, shake),
      headRoll: mix(0, -shakeWave * 0.38, shake),
      neckPitch: mix(neckPitch, 0, shake),
      neckRoll: mix(0, shakeWave * 0.55, shake),
    };
    if (rig.poseHead) {
      rig.poseHead(pose);
    } else {
      rig.head.rotation.y = pose.headYaw;
      rig.head.rotation.x = pose.headPitch;
      rig.head.rotation.z = pose.headRoll;
      rig.neck.rotation.x = pose.neckPitch;
      rig.neck.rotation.z = pose.neckRoll;
    }

    // Tail. Wag rate tracks excitement, which spikes after a run and decays, so
    // he arrives somewhere still buzzing and settles down a few seconds later.
    // Integrate the phase: sin(t * wag) with a time-varying wag sweeps the
    // phase at wag + t * dwag/dt — at t in the hundreds of seconds the decay
    // after a run whipped the tail dozens of times too fast.
    const wag = 2.0 + state.excitement * 9.0;
    state.tailPhase += wag * dt;
    const locomotionTailY = Math.sin(state.tailPhase) * (0.10 + 0.28 * state.excitement);
    const locomotionTailX = -0.10 * speedN;
    // Rotate the curled plume onto the surface and sweep it gently as a rudder.
    let tailY = mix(locomotionTailY, Math.sin(state.swimGait * 0.5) * 0.13, swim);
    tailY = mix(tailY, locomotionTailY, sit);
    let tailX = mix(locomotionTailX, 0.68, swim);
    tailX = mix(tailX, 0.26, sit);
    // Valeurs FINALES, comme les autres hooks. L'amplitude de battement (0.10
    // rad au repos) a été réglée pour un plumet long et fin ; sur un macaron
    // compact elle ne se voit pas.
    const tailXF = mix(tailX, 0, shake);
    const tailYF = mix(tailY, 0, shake);
    const tailZF = mix(0, shakeTailWave * 0.5, shake);
    if (rig.poseTail) {
      rig.poseTail(tailXF, tailYF, tailZF);
    } else {
      rig.tailBase.rotation.x = tailXF;
      rig.tailBase.rotation.y = tailYF;
      rig.tailBase.rotation.z = tailZF;
    }

    // Ears: laid back at speed, pricked at rest, and flicked by the gusts. The
    // wind is shared with the grass and the petals, so an ear twitch lands on the
    // same beat as the meadow going over.
    const gust = wind && wind.state ? wind.state.gust : 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const flick = Math.sin(t * 7.3 + i * 2.1) * gust * 0.16;
      const landEarX = -0.30 + 0.34 * speedN + flick;
      const landEarZ = side * (0.20 + 0.10 * gust);
      rig.ears[i].rotation.x = mix(landEarX, 0.46, swim);
      rig.ears[i].rotation.z = mix(landEarZ, side * 0.08, swim);
    }

    // A high-excitement pant is continuous and readable without audio. The jaw
    // closes during the shake so it cannot fight the final pose-stack layer.
    const pant = smoothstep(0.48, 0.82, state.excitement) * (1 - swim);
    const jawOpen = pant * (0.14 + 0.06 * (0.5 + 0.5 * Math.sin(t * 6.4)))
      + barkEnv * 0.34;
    rig.jaw.rotation.x = mix(jawOpen, 0, shake);
    if (barkEnv > 0) rig.head.rotation.x += barkEnv * 0.06;

    blinkTimer -= dt;
    if (blinkTimer <= 0 && blinkElapsed < 0) {
      blinkElapsed = 0;
      blinkTimer = R.range(blinkRng, 2.4, 6.8);
    }
    let blink = 0;
    if (blinkElapsed >= 0) {
      blinkElapsed += dt;
      const blinkS = clamp(blinkElapsed / BLINK_DURATION, 0, 1);
      blink = Math.sin(Math.PI * blinkS);
      if (blinkElapsed >= BLINK_DURATION) blinkElapsed = -1;
    }
    for (const lid of rig.lids) lid.rotation.x = mix(-0.32, 0.58, blink);
  }

  /* ── footprints ────────────────────────────────────────────── */

  function stampPrint(leg) {
    leg.paw.getWorldPosition(_pawWorld);
    const h = heightAt(_pawWorld.x, _pawWorld.z);
    // Sand only. Prints in grass are invisible and prints on rock are wrong.
    if (h > WORLD.beachTop || h < seaLevelLocal - 0.05) return;

    if (normalAt) normalAt(_pawWorld.x, _pawWorld.z, _n); else _n.copy(UP);
    _printQ.setFromUnitVectors(UP, _n);
    _printSpin.setFromAxisAngle(UP, state.heading);
    _m4.compose(
      _probe.set(_pawWorld.x, h + 0.015, _pawWorld.z),
      _printQ.multiply(_printSpin),
      _printS
    );

    const i = prints.cursor;
    prints.mesh.setMatrixAt(i, _m4);
    prints.born[i] = printClock;
    prints.cursor = (i + 1) % SHIBA.footprintCount;
    prints.mesh.instanceMatrix.needsUpdate = true;
    prints.mesh.geometry.attributes.aBorn.needsUpdate = true;
  }

  /* ── frame ─────────────────────────────────────────────────── */

  /**
   * @param {number} t            elapsed seconds
   * @param {number} dt
   * @param {object} [ctx]
   * @param {THREE.Camera} [ctx.camera]  movement is camera-relative; without one
   *                                     the controls fall back to world axes
   */
  function update(t, dt, ctx = null) {
    nowT = t;
    printClock = t;
    prints.material.uniforms.uTime.value = t;

    const camera = ctx && ctx.camera ? ctx.camera : null;

    /* — read the sticks — */
    let fwdIn = 0, sideIn = 0;
    if (enabled) {
      if (held.has('KeyW') || held.has('ArrowUp')) fwdIn += 1;
      if (held.has('KeyS') || held.has('ArrowDown')) fwdIn -= 1;
      if (held.has('KeyA') || held.has('ArrowLeft')) sideIn -= 1;
      if (held.has('KeyD') || held.has('ArrowRight')) sideIn += 1;
      // Le stick reste une intention brute : le repère caméra et la
      // normalisation ci-dessous sont ainsi exactement les mêmes qu'au clavier.
      fwdIn += stickFwd;
      sideIn += stickSide;
    }
    state.running = enabled && (
      held.has('ShiftLeft') || held.has('ShiftRight') || stickRunning
    );
    const shaking = state.shake > 0;

    /* — desired direction, in the camera's frame — */
    if (camera) {
      camera.getWorldDirection(_fwd);
      _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
      _fwd.normalize();
      _right.crossVectors(_fwd, UP).normalize();
    } else {
      _fwd.set(0, 0, 1);
      _right.set(1, 0, 0);
    }
    _wish.set(0, 0, 0)
      .addScaledVector(_fwd, fwdIn)
      .addScaledVector(_right, sideIn);

    const wants = _wish.lengthSq() > 1e-6;
    if (wants) _wish.normalize();

    /* — speed — */
    let top = state.running ? SHIBA.runSpeed : SHIBA.walkSpeed;
    if (state.swimming) {
      top = SHIBA.swimSpeed;
    } else if (state.depth > 0) {
      // Progressive mud-and-water drag. At half swimDepth the requested 0.55
      // factor is fully reached; shallower water interpolates continuously.
      const wadeN = clamp(state.depth / (SHIBA.swimDepth * 0.5), 0, 1);
      top *= mix(1, SHIBA.wadeSlow, wadeN);
    }
    const target = wants ? top : 0;
    if (shaking) {
      // A shake is planted in place. Cancel vertical motion as well so a key
      // press cannot turn its failsafe into a frozen hop at the waterline.
      state.speed = 0;
      state.vy = 0;
      state.airborne = false;
    } else {
      const rate = target > state.speed ? SHIBA.accel : SHIBA.brake;
      state.speed += clamp(target - state.speed, -rate * dt, rate * dt);
    }
    if (state.speed < 0.02) state.speed = 0;
    state.moving = state.speed > 0.05;

    /* — heading — */
    if (wants && !shaking) {
      const want = Math.atan2(_wish.x, _wish.z);
      let d = want - state.heading;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      // Turn faster from a standstill than at a gallop: a dog pivots on the spot
      // but has to bank through a corner at speed.
      const agility = SHIBA.turnRate * (1.6 - 0.75 * (state.speed / SHIBA.runSpeed));
      state.heading += clamp(d, -agility * dt, agility * dt);
    }

    /* — translate — */
    if (state.moving) {
      const step = state.speed * dt;
      if (!tryMove(Math.sin(state.heading) * step, Math.cos(state.heading) * step)) {
        state.speed *= 0.4;
      }
    }
    freeFromSolid();

    const ground = heightAt(position.x, position.z);
    // LA question, posée une fois par frame. profondeur = 0 signifie sec.
    const s = water.surfaceAt(position.x, position.z, t);
    const depth = s === null ? 0 : Math.max(0, s - ground);
    const still = s === null ? null
      : (typeof water.isPond === 'function' && water.isPond(position.x, position.z)
        ? s
        : seaLevelLocal);
    const depthStill = still === null ? 0 : Math.max(0, still - ground);
    const wasWading = state.wading;
    state.depth = depth;
    state.wading = depth > 0.04;
    if (state.wading && !wasWading) {
      // Rising edge only: one large entry event, never a per-frame fountain.
      emitSurfaceBurst(position.x, position.z, 12, 1.35, 1, s);
      waterImpact(position.x, position.z, 1.35);
    }

    // Hystérésis sur la profondeur PLATE : la houle (amp 1.15) dépasse
    // la bande 0.12 et faisait pomper nage/sol à chaque creux.
    if (state.swimming) {
      if (depthStill < SHIBA.swimDepth - 0.12) state.swimming = false;
    } else if (depthStill > SHIBA.swimDepth) {
      state.swimming = true;
    }
    state.swimBlend += clamp((state.swimming ? 1 : 0) - state.swimBlend, -dt * 3.5, dt * 4.5);
    state.swimBlend = clamp(state.swimBlend, 0, 1);

    const inPondNow = typeof water.isPond === 'function' && water.isPond(position.x, position.z);
    const inSeaNow = s !== null && !inPondNow;
    const feetWet = state.wading || state.swimming;
    if (feetWet) {
      state.wetTime += dt;
      state.wetness = clamp(state.wetness + dt * 0.6, 0, 1);
    }
    // Shake only after a real immersion, and only once the dog is fully dry.
    // wetTime is the swim/wade clock; a puddle dip under 1.2 s is ignored.
    if (!inPondNow && !inSeaNow) {
      if (!state.shake && state.wetTime >= SHIBA.wetBeforeShake) {
        state.shake = 1;
        state.shakeElapsed = 0;
        state.shakeCrossing = 0;
        state.speed = 0;
        state.moving = false;
        state.vy = 0;
        state.airborne = false;
        state.wetTime = 0;
      } else if (!state.shake) {
        state.wetTime = 0;
      }
    }

    if (state.shake > 0) {
      state.shakeElapsed += Math.max(0, dt);
      state.shake = Math.max(0, state.shake - Math.max(0, dt) / SHAKE_DURATION);
      // Independent of the normal 0.9 s decay: if that weight is ever kept
      // alive by an edge case, never leave the character permanently frozen.
      const shakeDone = state.shake <= 0 || state.shakeElapsed >= SHAKE_FAILSAFE;
      if (shakeDone) {
        state.shake = 0;
        state.shakeElapsed = 0;
        state.shakeCrossing = 0;
        state.wetness = 0;
      }
    }

    // La flottaison appartient au rig, parce qu'elle dépend de la hauteur de
    // son dos : 0.85 laisse le chien procédural émerger de 0.486, et le chibi
    // glTF de 0.080 seulement — il nagerait quasi submergé. La garde de la
    // l.84, elle, reste sur les constantes : elle protège le rig procédural et
    // s'évalue avant qu'aucun rig n'existe.
    const targetY = state.swimming ? s - (rig.swimFloat ?? SHIBA.swimFloat) : ground;
    let landed = false;
    if (state.airborne) {
      // Ballistic: gravity only, land when the arc meets the current support.
      state.vy -= 26 * dt;
      position.y += state.vy * dt;
      if (position.y <= targetY) {
        position.y = targetY;
        state.vy = 0;
        state.airborne = false;
        landed = true;
      }
    } else {
      // Settle onto the ground rather than snapping: a hard clamp to heightAt makes
      // him judder over the terrain's triangle edges at speed.
      position.y += (targetY - position.y) * Math.min(1, dt * 18);
    }
    if (landed) {
      if (s !== null) {
        emitSurfaceBurst(position.x, position.z, 20, 1.7, 2, s);
        waterImpact(position.x, position.z, 1.8);
      } else {
        emitSurfaceBurst(position.x, position.z, 20, 1.8, 0, null);
      }
    }

    /* — sit / stand — */
    state.idleTime = state.moving ? 0 : state.idleTime + dt;
    if (state.sitting > 0.7 && state.bark <= 0 && state.shake <= 0 && !state.swimming
      && state.idleTime >= nextIdleBark) {
      if (startBark()) nextIdleBark = state.idleTime + R.range(barkRng, 10, 16);
    } else if (state.moving || state.sitting < 0.5) {
      nextIdleBark = Math.max(nextIdleBark, SHIBA.idleBeforeBark);
    }

    if (state.bark > 0) {
      state.barkElapsed += Math.max(0, dt);
      if (state.barkElapsed >= BARK_DURATION) {
        state.bark = 0;
        state.barkElapsed = 0;
      }
    }

    // Look is head-only. Running must never inherit this as body yaw.
    // The hold tracks ONE target: swapping to whoever is nearest each frame
    // teleports the skull left/right (a falling petal winning the race).
    const canLook = !state.moving && !state.swimming && state.shake <= 0;
    if (!canLook) {
      lookHold = 0;
    } else if (lookHold > 0) {
      lookHold -= dt;
      lookAim = trackLook(lookAim);
      if (!lookAim) lookHold = 0;
      if (lookHold <= 0) lookCool = R.range(lookRng, 1.2, 2.6);
    } else if (lookCool > 0) {
      lookCool -= dt;
    } else {
      const picked = pickLook();
      if (picked) {
        lookAim = picked;
        lookHold = R.range(lookRng, 2, 4);
        state.lookKind = picked.kind || null;
      }
    }
    const wantLook = canLook && lookHold > 0 && lookAim ? 1 : 0;
    state.look += clamp(wantLook - state.look, -dt * 4, dt * 5);
    if (state.look < 0.01 && wantLook === 0) {
      state.look = 0;
      state.lookKind = null;
      lookAim = null;
    }
    let yawWant = 0, pitchWant = 0;
    if (lookAim && state.look > 0) {
      yawWant = clamp(aimYaw(lookAim), -SHIBA.lookYawMax, SHIBA.lookYawMax);
      const dy = (Number.isFinite(lookAim.y) ? lookAim.y : position.y + 1)
        - (position.y + 0.85);
      const horiz = Math.hypot(lookAim.x - position.x, lookAim.z - position.z) || 1;
      pitchWant = clamp(-Math.atan2(dy, horiz), -0.55, 0.35);
    }
    const kLook = dt > 0 ? 1 - Math.exp(-dt / SHIBA.lookYawTau) : 1;
    lookHeadYaw += (yawWant - lookHeadYaw) * kLook;
    lookHeadPitch += (pitchWant - lookHeadPitch) * kLook;

    const wantSit = !state.wading && state.idleTime > SHIBA.idleBeforeSit ? 1 : 0;
    state.sitting += clamp(wantSit - state.sitting, -dt * 3.0, dt * 1.35);
    state.sitting = clamp(state.sitting, 0, 1);

    /* — excitement — */
    const speedN = clamp(state.speed / SHIBA.runSpeed, 0, 1);
    state.excitement = clamp(
      state.excitement + (speedN > 0.55 ? dt * 0.9 : -dt * 0.22), 0, 1
    );

    /* — place and align — */
    rig.root.position.copy(position);
    rig.root.position.y -= 0.04 * state.sitting;

    // A swimmer is supported by the surface, not aligned to the invisible bed.
    if (state.swimming) _n.copy(UP);
    else if (normalAt) normalAt(position.x, position.z, _n);
    else _n.copy(UP);
    // Only partly conform to the slope. A quadruped standing on a hillside keeps
    // its body far closer to level than the ground under it; aligning fully makes
    // him look magnetised to the terrain.
    _n.lerp(UP, 0.42).normalize();
    _qAlign.setFromUnitVectors(UP, _n);
    _qYaw.setFromAxisAngle(UP, state.heading);
    _qWant.copy(_qAlign).multiply(_qYaw);
    rig.root.quaternion.slerp(_qWant, Math.min(1, dt * 12));

    // Keep dog ripples enabled while wading as well as swimming; the analytic
    // hull depression itself fades in only with the swimming pose.
    // Histoire de ce nombre, en deux corrections opposees. A 0.08 le sillage
    // passait SOUS le clapot de brise (qui culmine a 0.098) et ne se voyait
    // pas ; a 0.22 il devenait un halo lumineux, parce que le fragment convertit
    // toute hauteur positive en crete claire. 0.13 est le point ou l'on lit un
    // creux d'eau et pas un cerne. Les deux bouts ont ete constates en jeu.
    waterSetSwimmer(position.x, position.z, state.depth > 0.10, SHIBA.wakeAmp * state.swimBlend, dt);
    animate(t, dt, speedN);
  }

  function dispose() {
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('blur', onBlur);
    for (const g of rig.parts) g.dispose();
    // Le rig POSSÈDE son matériau, quelle que soit sa provenance. La texture du
    // rig glTF est partagée avec le MeshBasicMaterial que le loader avait rendu
    // et que shiba-gltf.js a déjà libéré : dispose() d'un matériau ne touche
    // pas à sa map, donc c'est bien ici qu'elle se libère, une seule fois.
    rig.material.map?.dispose();
    rig.material.dispose();
    prints.geo.dispose();
    prints.material.dispose();
    prints.mesh.dispose();
  }

  Object.assign(api, {
    group,
    position,          // live — read by the follow camera and by the birds
    state,
    update,
    dispose,
    /** (name) — 'heron-flush' | 'bark' starts the woof. Shake is water-gated. */
    notify(name) {
      if (name === 'heron-flush' || name === 'bark') startBark();
    },
    setLookTargets(list) {
      lookTargets = Array.isArray(list) ? list : [];
    },
    jump() {
      if (!state.airborne && state.sitting < 0.3 && state.shake <= 0) {
        state.vy = 9.5;
        state.airborne = true;
      }
    },
    /** Carrefour, museau aux torii, plus aucune pose en cours. */
    reset() {
      position.set(SPAWN.x, 0, SPAWN.z);
      position.y = heightAt(position.x, position.z);
      state.heading = SPAWN.heading;
      state.speed = 0;
      state.moving = false;
      state.running = false;
      state.wading = false;
      state.swimming = false;
      state.swimBlend = 0;
      state.depth = 0;
      state.sitting = 0;
      state.excitement = 0;
      state.vy = 0;
      state.airborne = false;
      state.idleTime = 0;
      state.gait = 0;
      state.swimGait = 0;
      state.wetness = 0;
      state.wetTime = 0;
      state.shake = 0;
      state.shakeElapsed = 0;
      state.shakeCrossing = 0;
      state.bark = 0;
      state.barkElapsed = 0;
      state.look = 0;
      state.lookKind = null;
      lookHold = 0;
      lookCool = 0;
      lookAim = null;
      lookHeadYaw = 0;
      lookHeadPitch = 0;
      waterSetSwimmer(position.x, position.z, false, 0, 0);
      rig.root.position.copy(position);
      if (normalAt) normalAt(position.x, position.z, _n);
      else _n.copy(UP);
      _n.lerp(UP, 0.42).normalize();
      _qAlign.setFromUnitVectors(UP, _n);
      _qYaw.setFromAxisAngle(UP, state.heading);
      rig.root.quaternion.copy(_qAlign).multiply(_qYaw);
    },
    /** Entrée analogique caméra-relative, fournie par l'UI tactile. */
    setStick(fwd, side, running) {
      if (!enabled) {
        stickFwd = stickSide = 0;
        stickRunning = false;
        return;
      }
      stickFwd = clamp(Number.isFinite(fwd) ? fwd : 0, -1, 1);
      stickSide = clamp(Number.isFinite(side) ? side : 0, -1, 1);
      stickRunning = !!running;
    },
    /** Suspend the controls without unmounting him — used by the free camera. */
    setEnabled(v) {
      enabled = !!v;
      if (!enabled) {
        held.clear();
        stickFwd = stickSide = 0;
        stickRunning = false;
      }
    },
    /** Les quatre semelles, en coordonnées MONDE, dans l'ordre FL FR BL BR.
     *  Ouvert pour l'invariant 12, qui doit mesurer la garde au sol sur les
     *  DEUX corps possibles : le procédural la tire de son mesh nommé 'paw', le
     *  glTF de sa géométrie skinnée, et le banc n'a pas à savoir lequel il a.
     *  Appeler group.updateMatrixWorld(true) avant. */
    soles: () => rig.legs.map((leg) => rig.sole(leg)),
    /** Banc seulement : pose nowT puis évalue la laisse live. */
    passableAt(x, z, t) { nowT = t; return passable(x, z); },
  });
  // Object.assign copies getters by VALUE. heading/speed must stay live.
  Object.defineProperties(api, {
    heading: { get() { return state.heading; }, enumerable: true },
    speed: { get() { return state.speed; }, enumerable: true },
    speedN: {
      get() { return Math.min(1, Math.max(0, state.speed / SHIBA.runSpeed)); },
      enumerable: true,
    },
  });
  return api;
}

export default createShiba;
