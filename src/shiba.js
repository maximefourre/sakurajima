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
import { streamFor, R, clamp, mix } from './noise.js';
import { WORLD, LAND_SCALE } from './config.js';
import { TAU, UP, SHIBA_BUILD, buildBody } from './shiba-geom.js';

export const SHIBA = {
  walkSpeed: 6.4,
  runSpeed: 14.8,
  accel: 14.0,
  brake: 18.0,
  turnRate: 7.0,          // rad/s the body swings toward its heading
  /** Above this terrain slope he refuses to climb — cliffs are not for dogs. */
  maxSlope: 0.72,
  /** He will paddle down to here below sea level and no further. */
  wadeDepth: 0.34,
  idleBeforeSit: 4.2,     // seconds of stillness before he sits down
  footprintLife: 26.0,    // seconds a paw print survives in the sand
  footprintCount: 96,
};

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
  geo.rotateX(-Math.PI / 2);
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
 * @param {Function} [opts.isInPond] (x, z) => bool — ponds and river both count
 * @param {Function} [opts.deckHeightAt] (x, z) => y|null — bridge deck walkable height
 * @param {Function} [opts.deckNormalAt] (x, z, out) => bool — deck normal into out
 * @param {object}   [opts.wind]     from createWind(); read for ear and tail flutter
 * @param {number}   [opts.seaLevel]
 */
export function createShiba({
  seed = 1337,
  heightAt,
  slopeAt = null,
  normalAt = null,
  isInPond = null,
  deckHeightAt = null,
  deckNormalAt = null,
  waterSurfaceAt = null,
  wind = null,
  seaLevel = WORLD.seaLevel,
} = {}) {
  if (typeof heightAt !== 'function') {
    throw new Error('[shiba] createShiba requires heightAt(x, z) -> y');
  }

  const rng = streamFor(seed, 'shiba');

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
    flatShading: false,
  });

  const rig = buildBody(material);
  const group = new THREE.Group();
  group.name = 'shiba-rig';
  group.add(rig.root);
  rig.root.scale.setScalar(SHIBA_BUILD.scale);

  const prints = createFootprints(SHIBA.footprintCount, SHIBA.footprintLife);
  group.add(prints.mesh);

  /* ── state ─────────────────────────────────────────────────── */
  // Apparition SUR le chemin : le carrefour du réseau (config PATHS, point
  // commun des trois routes), museau tourné vers la montée aux torii.
  const position = new THREE.Vector3(6 * LAND_SCALE, 0, -30 * LAND_SCALE);
  position.y = heightAt(position.x, position.z);

  const state = {
    heading: -1.2,
    speed: 0,
    moving: false,
    running: false,
    wading: false,
    swimming: false,   // il a perdu pied dans la rivière — il flotte
    sitting: 0,        // 0..1 blend, not a boolean — he folds down over ~0.8 s
    excitement: 0,     // decays after a run; drives the tail
    tailPhase: 0,      // integrated wag phase — sin(t*rate) with a moving rate whips
    vy: 0,             // vertical velocity while airborne
    airborne: false,
    idleTime: 0,
    gait: 0,           // accumulated stride phase in radians
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
  const _printQ = new THREE.Quaternion();
  const _printSpin = new THREE.Quaternion();
  const _printS = new THREE.Vector3(1, 1, 1);

  const legPlanted = [true, true, true, true];
  let printClock = 0;

  /** Head-up idle beat: he looks up at the falling petals now and then. */
  let lookUpTimer = R.range(rng, 3, 9);
  let lookUp = 0;

  /* ── terrain queries ───────────────────────────────────────── */

  /** Can he stand here? Deep water and cliffs say no; the bridge deck says yes. */
  function passable(x, z) {
    if (deckHeightAt) {
      const d = deckHeightAt(x, z);
      if (d !== null && position.y > d - 2.0) {
        // At deck level the planks are always standable. This must short-circuit
        // the water and slope tests: the river below the deck and the carved
        // channel's bank slopes would otherwise both refuse the crossing.
        // The y-gate keeps a dog WADING UNDER the bridge on the terrain rules.
        return true;
      }
      if (d === null) {
        const dHere = deckHeightAt(position.x, position.z);
        if (dHere !== null && position.y > dHere - 2.0 && heightAt(x, z) < dHere - 1.2) {
          // Stepping sideways off the deck mid-span: the handrails contain him.
          // tryMove's axis-slide turns this refusal into gliding along the rail.
          return false;
        }
      }
    }
        const h = heightAt(x, z);
    if (h < seaLevel - SHIBA.wadeDepth) return false;
    if (isInPond && isInPond(x, z) && h < seaLevel + 0.1) return false;
    if (slopeAt && slopeAt(x, z) > SHIBA.maxSlope) return false;
    return true;
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

  /* ── animation ─────────────────────────────────────────────── */

  const legPhase = [0, Math.PI, Math.PI, 0]; // FL FR BL BR — a diagonal trot

  function animate(t, dt, speedN) {
    const sit = state.sitting;
    const stride = 5.2 + speedN * 7.5;
    state.gait += dt * stride * (0.25 + speedN);

    const swingAmp = 0.30 + 0.62 * speedN;
    const bounce = 1 - sit;

    for (let i = 0; i < 4; i++) {
      const leg = rig.legs[i];
      const ph = state.gait + legPhase[i];
      const s = Math.sin(ph);
      const lift = Math.max(0, -Math.cos(ph));

      if (sit > 0.02 && !leg.front) {
        // Sitting. Sign convention matters more than the magnitudes here: a
        // positive rotation.x swings a limb BACKWARD and pitches the nose DOWN,
        // because the model faces +Z. So the femur goes forward-and-down on a
        // negative angle and the tibia folds back under it on a positive one,
        // dropping the hock to the ground — which is what a dog actually sits on.
        leg.hip.rotation.x = mix(s * swingAmp * bounce, -0.85, sit);
        leg.knee.rotation.x = mix(-lift * swingAmp * 1.35 * bounce, 1.95, sit);
      } else if (sit > 0.02 && leg.front) {
        leg.hip.rotation.x = mix(s * swingAmp * bounce, 0.04, sit);
        leg.knee.rotation.x = mix(-lift * swingAmp * 1.35 * bounce, -0.04, sit);
      } else {
        leg.hip.rotation.x = s * swingAmp;
        leg.knee.rotation.x = -lift * swingAmp * 1.35;
      }

      // A paw plants on the downstroke. Used for footprints; also the moment the
      // body should take weight, which the bob below is phased against.
      const down = s < 0 && Math.cos(ph) > 0;
      if (down && !legPlanted[i]) {
        legPlanted[i] = true;
        if (state.moving) stampPrint(leg);
      } else if (!down) {
        legPlanted[i] = false;
      }
    }

    // Body carriage: bob at twice the stride, roll at once, and pitch up as he
    // sits so the chest lifts and the front legs straighten under him.
    rig.body.position.y = Math.sin(state.gait * 2) * 0.028 * speedN * bounce - 0.20 * sit;
    rig.body.rotation.z = Math.sin(state.gait) * 0.055 * speedN * bounce;
    rig.body.rotation.x = mix(-0.05 * speedN, -0.30, sit) + (state.airborne ? state.vy * 0.025 : 0);

    // Head. It leads the turn while moving, scans slowly when idle, and lifts
    // when something drifts past — the scene is full of falling petals and a dog
    // that never looks at them reads as furniture.
    lookUpTimer -= dt;
    if (lookUpTimer <= 0 && speedN < 0.05) {
      lookUp = 1;
      lookUpTimer = R.range(rng, 6, 15);
    }
    lookUp = Math.max(0, lookUp - dt * 0.55);
    const scan = Math.sin(t * 0.42) * 0.30 * (1 - speedN) * (0.4 + 0.6 * sit);
    rig.head.rotation.y = scan;
    rig.head.rotation.x = mix(-0.06 * speedN, -0.05, sit) - lookUp * 0.62;
    rig.neck.rotation.x = mix(0.0, -0.28, sit);

    // Tail. Wag rate tracks excitement, which spikes after a run and decays, so
    // he arrives somewhere still buzzing and settles down a few seconds later.
    // Integrate the phase: sin(t * wag) with a time-varying wag sweeps the
    // phase at wag + t * dwag/dt — at t in the hundreds of seconds the decay
    // after a run whipped the tail dozens of times too fast.
    const wag = 2.0 + state.excitement * 9.0;
    state.tailPhase += wag * dt;
    rig.tailBase.rotation.y = Math.sin(state.tailPhase) * (0.10 + 0.28 * state.excitement);
    rig.tailBase.rotation.x = -0.10 * speedN + 0.26 * sit; // the curl flattens onto the croup

    // Ears: laid back at speed, pricked at rest, and flicked by the gusts. The
    // wind is shared with the grass and the petals, so an ear twitch lands on the
    // same beat as the meadow going over.
    const gust = wind && wind.state ? wind.state.gust : 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const flick = Math.sin(t * 7.3 + i * 2.1) * gust * 0.16;
      rig.ears[i].rotation.x = -0.30 + 0.34 * speedN + flick;
      rig.ears[i].rotation.z = side * (0.20 + 0.10 * gust);
    }
  }

  /* ── footprints ────────────────────────────────────────────── */

  function stampPrint(leg) {
    leg.paw.getWorldPosition(_pawWorld);
    // No paw prints in the bridge planks (and none stamped on the riverbed
    // 4 units below the paw while he crosses).
    if (deckHeightAt) {
      const d = deckHeightAt(_pawWorld.x, _pawWorld.z);
      if (d !== null && position.y > d - 2.0) return;
    }
    const h = heightAt(_pawWorld.x, _pawWorld.z);
    // Sand only. Prints in grass are invisible and prints on rock are wrong.
    if (h > WORLD.beachTop || h < seaLevel - 0.05) return;

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
    }
    state.running = held.has('ShiftLeft') || held.has('ShiftRight');

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
    // Wading through the river: passable, but water is thick. The sea-level
    // wade rule never sees a bed 8 units up the hillside, so ask the river.
    if (waterSurfaceAt && !state.airborne) {
      const wS = waterSurfaceAt(position.x, position.z);
      if (wS !== null && position.y < wS - 0.05) { top *= 0.55; state.wading = true; }
    }
    const target = wants ? top : 0;
    const rate = target > state.speed ? SHIBA.accel : SHIBA.brake;
    state.speed += clamp(target - state.speed, -rate * dt, rate * dt);
    if (state.speed < 0.02) state.speed = 0;
    state.moving = state.speed > 0.05;

    /* — heading — */
    if (wants) {
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
      const step = state.speed * dt * (state.wading ? 0.45 : 1);
      if (!tryMove(Math.sin(state.heading) * step, Math.cos(state.heading) * step)) {
        state.speed *= 0.4;
      }
    }

    const dHere = deckHeightAt ? deckHeightAt(position.x, position.z) : null;
    const onDeck = dHere !== null && position.y > dHere - 2.0;
    let ground = onDeck ? dHere : heightAt(position.x, position.z);
    state.wading = ground < seaLevel + 0.06;
    // NAGE : quand le chenal est plus profond que ses pattes, le shiba perd
    // pied et flotte juste sous la surface au lieu de marcher au fond en
    // scaphandrier invisible — c'est la nage qui rend la profondeur lisible.
    state.swimming = false;
    if (!onDeck && waterSurfaceAt && !state.airborne) {
      const wSw = waterSurfaceAt(position.x, position.z);
      if (wSw !== null && ground < wSw - 0.85) {
        // Immergé au poitrail, tête hors de l'eau — à −0.55 il semblait
        // MARCHER sur l'eau.
        ground = wSw - 0.85;
        state.swimming = true;
        state.wading = true;
      }
    }
    if (state.airborne) {
      // Ballistic: gravity only, land when the arc meets the ground (deck
      // included - you can hop onto the bridge planks).
      state.vy -= 26 * dt;
      position.y += state.vy * dt;
      if (position.y <= ground) { position.y = ground; state.vy = 0; state.airborne = false; }
    } else {
      // Settle onto the ground rather than snapping: a hard clamp to heightAt makes
      // him judder over the terrain's triangle edges at speed.
      position.y += (ground - position.y) * Math.min(1, dt * 18);
    }

    /* — sit / stand — */
    state.idleTime = state.moving ? 0 : state.idleTime + dt;
    const wantSit = state.idleTime > SHIBA.idleBeforeSit ? 1 : 0;
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

    if (!(onDeck && deckNormalAt && deckNormalAt(position.x, position.z, _n))) {
      if (normalAt) normalAt(position.x, position.z, _n); else _n.copy(UP);
    }
    // Only partly conform to the slope. A quadruped standing on a hillside keeps
    // its body far closer to level than the ground under it; aligning fully makes
    // him look magnetised to the terrain.
    _n.lerp(UP, 0.42).normalize();
    _qAlign.setFromUnitVectors(UP, _n);
    _qYaw.setFromAxisAngle(UP, state.heading);
    _qWant.copy(_qAlign).multiply(_qYaw);
    rig.root.quaternion.slerp(_qWant, Math.min(1, dt * 12));

    animate(t, dt, speedN);
  }

  function dispose() {
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('blur', onBlur);
    for (const g of rig.parts) g.dispose();
    material.dispose();
    prints.geo.dispose();
    prints.material.dispose();
    prints.mesh.dispose();
  }

  return {
    group,
    position,          // live — read by the follow camera and by the birds
    state,
    update,
    dispose,
    jump() {
      if (!state.airborne && state.sitting < 0.3) { state.vy = 9.5; state.airborne = true; }
    },
    /** Suspend the controls without unmounting him — used by the free camera. */
    setEnabled(v) { enabled = !!v; if (!v) held.clear(); },
    get heading() { return state.heading; },
    get speed() { return state.speed; },
    get speedN() { return Math.min(1, Math.max(0, state.speed / SHIBA.runSpeed)); },
  };
}

export default createShiba;
