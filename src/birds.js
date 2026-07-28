/**
 * birds.js — the flock over the island, and the kite that circles above it.
 *
 * Four things carry the whole illusion, and each of them is somewhere slightly
 * unexpected:
 *
 *  1. BANK. Roll proportional to lateral acceleration. A boid that turns without
 *     rolling reads as a paper dart on a string; the same boid rolled into its
 *     turns reads as a bird, at any distance, even as three dark pixels. It is
 *     the cheapest and most load-bearing detail in this file.
 *  2. THE FLAP IS ON THE GPU, THE PHASE IS ON THE CPU. Wing deformation happens
 *     entirely in the vertex shader. The phase ANGLE is integrated per bird on
 *     the CPU and uploaded, rather than derived from a shared clock, because
 *     flap frequency changes with climb rate — and `sin(uTime * freq)` jumps
 *     discontinuously the instant `freq` changes. Integrating d(phase) keeps the
 *     wingbeat continuous while its rate varies.
 *  3. WORK RATE. Frequency and amplitude rise when climbing or fighting a
 *     headwind and fall to a dead glide on descent. A flock beating at a
 *     constant rate is a screensaver.
 *  4. THE ROOST. At dusk they converge on a few groves, commit to a landing
 *     approach, flare, and fold their wings; at dawn they leave in ones and twos
 *     over about half a minute rather than all at once.
 *
 * Everything — flock, kite, roosted and airborne — is one InstancedMesh, so the
 * whole population costs a single draw call and about a thousand triangles.
 *
 * There is no wind uniform here on purpose: the wind response is a force on the
 * CPU side (drift, advection, extra effort into a headwind), so the shader never
 * needs uTime and cannot collide with the shared wind block.
 */

import * as THREE from 'three';
import { WORLD, RIVER } from './config.js';
import { streamFor, R, noise2, clamp, mix } from './noise.js';

const TAU = Math.PI * 2;

/* Soft home volume. Land runs x in [-102,102], z in [-110,94]; this sits just
 * inside it so excursions cross the coastline instead of the open sea. */
const HOME_X = -4, HOME_Z = -8, HOME_RX = 90, HOME_RZ = 92;

/* Boids. Neighbourhood is generous relative to the 0.7-unit bird because the
 * flock has to read as a flock from 250 units away, where a tight cluster is a
 * single smudge. */
const NEIGH2 = 16 * 16;
const SEP = 5.0, SEP2 = SEP * SEP;
const W_SEP = 2.2, W_ALI = 0.95, W_COH = 0.8, W_WANDER = 4.6;

const MIN_CLEAR = 4.5;      // never fly closer than this to ground or water
const CEILING = 98;

/* The repeller — the dog. Deliberately violent: the whole point of the feature
 * is birds exploding off the grass as something runs at them. */
const REP_R = 26, REP_R2 = REP_R * REP_R, REP_PUSH = 62, REP_LIFT = 48;
const FLUSH_R2 = 15 * 15;   // a roosted bird inside this bolts

const FLY = 0, LAND = 1, ROOST = 2, LAUNCH = 3;

/* main.js hands the shaders a normalised copy of keyIntensity but gives birds
 * the raw `phase`. keyIntensity is a physical DirectionalLight value (~4.3 at
 * noon); multiplying a colour by it directly clips everything to white. Same
 * constant main.js uses, so the flock is lit on the same scale as the petals. */
const KEY_SCALE = 0.26;

/* ────────────────────────────────────────────────────────────────
   Geometry — one bird, 12 triangles
   ──────────────────────────────────────────────────────────────── */

/**
 * Nose along +z, wings along ±x, half-span 0.5 so the instance scale IS the
 * wingspan. Everything is a flat plate with a (0,1,0) normal: the shader rotates
 * both position and normal by the flap, so no normal recomputation is needed and
 * a folded wing still shades correctly.
 *
 * `aSpan` is 0 on the body and tail, 0..1 outboard along a wing. It drives the
 * flap arc, the phase lag toward the tip, the twist and the fold, so the whole
 * wing articulation is one attribute.
 */
function makeBirdGeometry() {
  const pos = [];
  const nrm = [];
  const spn = [];

  const v = (x, y, z, s) => { pos.push(x, y, z); nrm.push(0, 1, 0); spn.push(s); };

  /* `flip` reverses the vertex order. Mirroring a quad across x reverses its
   * winding, and the fragment stage flips the normal for back faces (the plates
   * are drawn DoubleSide) — so without this the left wing presents its back face
   * to a camera above the bird and shades as a belly while the right wing shades
   * as a back. The flock ends up with one bright wing and one dark one. */
  const quad = (a, b, c, d, flip) => {
    if (flip) { const t = a; a = d; d = t; const u = b; b = c; c = u; }
    v(...a); v(...b); v(...c); v(...a); v(...c); v(...d);
  };

  // Body: a slim lozenge from beak to tail root.
  quad([0, 0, 0.34, 0], [0.055, 0, 0.02, 0], [0, 0, -0.16, 0], [-0.055, 0, 0.02, 0]);

  // Tail: widens behind the body. Reads as the rudder that makes a silhouette
  // point somewhere rather than just hang there.
  quad([0.045, 0, -0.13, 0], [0.085, 0, -0.34, 0], [-0.085, 0, -0.34, 0], [-0.045, 0, -0.13, 0]);

  // Wings, two spanwise panels each so the flap can curve them instead of
  // hinging them as rigid planks.
  for (const s of [1, -1]) {
    quad(
      [0.05 * s, 0, 0.13, 0.0], [0.27 * s, 0, 0.10, 0.5],
      [0.27 * s, 0, -0.045, 0.5], [0.05 * s, 0, -0.05, 0.0], s < 0
    );
    quad(
      [0.27 * s, 0, 0.10, 0.5], [0.50 * s, 0, 0.005, 1.0],
      [0.46 * s, 0, -0.075, 1.0], [0.27 * s, 0, -0.045, 0.5], s < 0
    );
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aSpan', new THREE.Float32BufferAttribute(spn, 1));
  return g;
}

/* ────────────────────────────────────────────────────────────────
   Module-scope scratch — nothing in update() allocates
   ──────────────────────────────────────────────────────────────── */

const UP = new THREE.Vector3(0, 1, 0);
let _sx = 0, _sy = 0, _sz = 0;   // output of steer()

/** Reynolds steering: desired velocity minus current, clamped to a force limit. */
function steer(dx, dy, dz, speed, vx, vy, vz, maxF) {
  const l2 = dx * dx + dy * dy + dz * dz;
  if (l2 < 1e-8) { _sx = 0; _sy = 0; _sz = 0; return; }
  const k = speed / Math.sqrt(l2);
  let fx = dx * k - vx, fy = dy * k - vy, fz = dz * k - vz;
  const f2 = fx * fx + fy * fy + fz * fz;
  if (f2 > maxF * maxF) {
    const s = maxF / Math.sqrt(f2);
    fx *= s; fy *= s; fz *= s;
  }
  _sx = fx; _sy = fy; _sz = fz;
}

export function createBirds({ seed, quality, heightAt, wind, ponds, canopies = [] } = {}) {
  const rng = streamFor(seed ?? 0, 'birds');
  const label = quality?.label ?? 'high';
  const FLOCK = label === 'low' ? 26 : label === 'high' ? 54 : 84;
  const KITES = label === 'low' ? 1 : label === 'high' ? 2 : 3;
  const N = FLOCK + KITES;

  const ground = typeof heightAt === 'function' ? heightAt : () => 0;

  /* ── where a bird is allowed to stand ─────────────────────────
   * Birds have to sleep somewhere SPECIFIC. A flock that lands on whatever
   * ground it happens to be over at dusk reads as a crash, not a roost, so
   * sites are clustered into a few groves and the flock converges on them.
   *
   * Sites sit on the ground unless canopy tops are supplied. main.js does not
   * pass them today, and a bird perched at a GUESSED treetop height is a bird
   * hovering in mid-air — worse than a bird standing in the grass.
   */
  const pondList = (Array.isArray(ponds) ? ponds : []).filter(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.radius)
  );

  // river.js exposes no point query at construction time and main.js passes
  // none, so the channel is re-sampled here from the authored path. 160 points,
  // build-time only.
  const riverPts = new THREE.CatmullRomCurve3(
    RIVER.path.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.5
  ).getSpacedPoints(160);
  const RIVER_CLEAR2 = (RIVER.width * 0.5 + RIVER.bankWidth * 0.5 + 2) ** 2;

  function blocked(x, z) {
    for (let i = 0; i < riverPts.length; i++) {
      const dx = x - riverPts[i].x, dz = z - riverPts[i].z;
      if (dx * dx + dz * dz < RIVER_CLEAR2) return true;
    }
    for (let i = 0; i < pondList.length; i++) {
      const p = pondList[i];
      const dx = x - p.x, dz = z - p.z;
      const r = p.radius + 2.5;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  let _siteX = 0, _siteY = 0, _siteZ = 0;

  /** Dry, flat, above the beach, clear of water. Writes _siteX/_siteY/_siteZ. */
  function findSite(cx, cz, spread) {
    for (let tries = 0; tries < 90; tries++) {
      const a = rng() * TAU;
      const r = Math.sqrt(rng()) * spread;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const h = ground(x, z);
      if (h < WORLD.beachTop + 0.5 || h > WORLD.grassTop) continue;
      if (Math.abs(ground(x + 2, z) - h) + Math.abs(ground(x, z + 2) - h) > 1.6) continue;
      if (blocked(x, z)) continue;
      _siteX = x; _siteY = h; _siteZ = z;
      return true;
    }
    return false;
  }

  const groves = [];
  // A pond shore is the best roost on the island, so claim one first if ponds
  // exist. Falls through harmlessly when the pond module produced nothing.
  if (pondList.length) {
    const p = pondList[(rng() * pondList.length) | 0];
    const a = rng() * TAU;
    if (findSite(p.x + Math.cos(a) * (p.radius + 7), p.z + Math.sin(a) * (p.radius + 7), 9)) {
      groves.push({ x: _siteX, y: _siteY, z: _siteZ });
    }
  }
  for (let i = groves.length; i < 4; i++) {
    if (findSite(HOME_X, HOME_Z, 74)) groves.push({ x: _siteX, y: _siteY, z: _siteZ });
  }
  if (!groves.length) groves.push({ x: HOME_X, y: Math.max(ground(HOME_X, HOME_Z), 0), z: HOME_Z });

  // Canopy tops, if a caller ever supplies them: a third of the flock then
  // roosts in the trees instead of on the ground.
  const perches = canopies
    .filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.z))
    .map((c) => ({ x: c.x, z: c.z, y: c.top ?? c.y ?? (ground(c.x, c.z) + 6.5) }));

  /* ── population ───────────────────────────────────────────────
   * Plain objects, built once with a fixed shape. The boids loop reads them a
   * few thousand times a frame and V8 keeps them monomorphic; nothing here
   * allocates after construction.
   */
  const birds = [];
  for (let i = 0; i < N; i++) {
    const kite = i >= FLOCK;

    // Two sites, in different groves. Something standing in the roost is a
    // reason to sleep somewhere else, not a reason to circle all night — and
    // main.js drives the repeller off a dog that can simply park there.
    const gi = (rng() * groves.length) | 0;
    const gj = groves.length > 1
      ? (gi + 1 + ((rng() * (groves.length - 1)) | 0)) % groves.length
      : gi;

    let rx, ry, rz, rx2, ry2, rz2;
    if (!kite && perches.length && rng() < 0.34) {
      const p = perches[(rng() * perches.length) | 0];
      rx = p.x; ry = p.y; rz = p.z;
    } else if (findSite(groves[gi].x, groves[gi].z, kite ? 16 : 11)) {
      rx = _siteX; ry = _siteY; rz = _siteZ;
    } else {
      rx = groves[gi].x; ry = groves[gi].y; rz = groves[gi].z;
    }
    if (findSite(groves[gj].x, groves[gj].z, kite ? 16 : 11)) {
      rx2 = _siteX; ry2 = _siteY; rz2 = _siteZ;
    } else {
      rx2 = groves[gj].x; ry2 = groves[gj].y; rz2 = groves[gj].z;
    }

    const sleep = R.range(rng, 0.16, 0.52);
    const a0 = rng() * TAU;
    const px = HOME_X + Math.cos(a0) * R.range(rng, 4, 30);
    const pz = HOME_Z + Math.sin(a0) * R.range(rng, 4, 30);
    const head = rng() * TAU;

    birds.push({
      kite: kite ? 1 : 0,
      size: kite ? R.range(rng, 2.2, 2.9) : R.range(rng, 0.52, 0.88),
      tint: rng(),
      seed: R.range(rng, 0, 400),

      px, py: Math.max(ground(px, pz), 0) + R.range(rng, 14, 30) + (kite ? 34 : 0), pz,
      vx: Math.cos(head) * 9, vy: 0, vz: Math.sin(head) * 9,
      fx: Math.cos(head), fy: 0, fz: Math.sin(head),
      groundY: Math.max(ground(px, pz), 0),

      roll: 0,
      alarm: 0,
      flapPhase: rng() * TAU,          // decorrelated, or the flock beats as one animal
      flapAmp: 0.6,
      freqScale: R.range(rng, 0.86, 1.18),
      tuck: 0,

      // Personal altitude preference — a flock stacked on one plane looks printed.
      altBias: rng(),

      state: FLY,
      stateT: 0,
      homeT: 0,
      // Wake is DERIVED from sleep so it is always the lower threshold. Two
      // independent draws let a bird end up with wake above sleep, and it then
      // lands and relaunches forever at any night weight between the two.
      sleepAt: sleep,
      wakeAt: sleep * R.range(rng, 0.35, 0.8),
      wakeT: 0,
      // The threshold alone staggers nothing: the sky's night weight collapses
      // in about two seconds, so every bird crosses its wake point at the same
      // moment. This delay is what makes dawn a departure and not a jump cut.
      wakeDelay: R.range(rng, 0.4, 22),

      rx, ry: ry + 0.10 * (kite ? 2.4 : 0.7), rz,
      rx2, ry2: ry2 + 0.10 * (kite ? 2.4 : 0.7), rz2,
      // landing arc (start + control point of a quadratic bezier)
      lax: 0, lay: 0, laz: 0, lcx: 0, lcy: 0, lcz: 0, landT: 0, landDur: 2,

      shuffleT: R.range(rng, 1, 8),
      shuffle: 0,

      // Kite only: a thermal to circle on.
      orbit: rng() * TAU,
      orbitR: R.range(rng, 24, 42),
      thermalX: HOME_X + R.range(rng, -55, 55),
      thermalZ: HOME_Z + R.range(rng, -55, 55),
      thermalY: R.range(rng, 44, 72),
      burstT: R.range(rng, 3, 12),
      burst: 0,
    });
  }

  /* ── mesh ─────────────────────────────────────────────────────── */
  const geo = makeBirdGeometry();

  const animArr = new Float32Array(N * 4);   // phase, amplitude, tuck, species
  const tintArr = new Float32Array(N);
  for (let i = 0; i < N; i++) tintArr[i] = birds[i].tint;

  const aAnim = new THREE.InstancedBufferAttribute(animArr, 4);
  aAnim.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAnim', aAnim);
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tintArr, 1));

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uKeyDir:      { value: new THREE.Vector3(0, 1, 0) },
      uKeyColor:    { value: new THREE.Color(1, 1, 1) },
      uSkyColor:    { value: new THREE.Color(0.5, 0.6, 0.75) },
      uGroundColor: { value: new THREE.Color(0.2, 0.22, 0.18) },
      uAmbient:     { value: 0.5 },
      uBodyColor:   { value: new THREE.Color('#0d1015') },
      uKiteColor:   { value: new THREE.Color('#221a15') },
    },
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    side: THREE.DoubleSide,

    vertexShader: /* glsl */ `
      attribute float aSpan;    // 0 body/tail, 0..1 outboard along a wing
      attribute vec4  aAnim;    // flapPhase, amplitude, tuck, species
      attribute float aTint;

      varying vec3  vNormalW;
      varying vec3  vViewW;
      varying float vSpan;
      varying float vTint;
      varying float vSpecies;

      #include <fog_pars_vertex>

      void main() {
        float span    = aSpan;
        float side    = sign(position.x);
        float phase   = aAnim.x;
        float amp     = aAnim.y;
        float tuck    = clamp(aAnim.z, 0.0, 1.0);
        float species = aAnim.w;

        vec3 p = position;
        vec3 n = normal;

        // The kite is not just a bigger sparrow: broad, deep, barely tapered
        // wings. Chord widens outboard instead of narrowing to a point.
        p.z *= 1.0 + species * span * 0.55;
        p.x *= 1.0 + species * span * 0.10;

        // Fold: at roost the wings close in over the tail.
        float wing = step(0.001, span);
        p.x *= mix(1.0, 0.14, tuck * wing);
        p.z -= tuck * span * 0.10;
        p.y += tuck * span * 0.03;

        // Flap. The tip LAGS the shoulder — rotating each vertex by its own
        // phase-shifted angle is what bends the wing into an arc instead of
        // hinging it like a plank, and the lag is most of what reads as a
        // wingbeat rather than a scissor.
        float lag = span * 0.9;
        float a = sin(phase - lag) * amp * (0.25 + 0.9 * span);
        a += (0.03 + 0.14 * species) * span;     // resting dihedral, a shallow V
        a *= 1.0 - tuck * 0.85;

        float ang = a * side;                    // both wings rise together
        float c = cos(ang), s = sin(ang);
        p = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
        n = vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z);

        // Twist: the wing pitches leading-edge-down through the downstroke.
        // This is the pass that makes a flap look like it is pushing air rather
        // than waving. Same sign on both wings, since both chords face +z.
        float tw = -cos(phase - lag) * amp * 0.30 * span * (1.0 - tuck);
        float ct = cos(tw), st = sin(tw);
        p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
        n = vec3(n.x, n.y * ct - n.z * st, n.y * st + n.z * ct);

        vec4 worldPos = modelMatrix * instanceMatrix * vec4(p, 1.0);

        // NOTE: this MUST be named mvPosition -- three's <fog_vertex> chunk
        // references that exact identifier, so renaming it breaks compilation.
        vec4 mvPosition = viewMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;

        vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
        vViewW   = cameraPosition - worldPos.xyz;
        vSpan    = span;
        vTint    = aTint;
        vSpecies = species;

        #include <fog_vertex>
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3  uKeyDir;
      uniform vec3  uKeyColor;
      uniform vec3  uSkyColor;
      uniform vec3  uGroundColor;
      uniform float uAmbient;
      uniform vec3  uBodyColor;
      uniform vec3  uKiteColor;

      varying vec3  vNormalW;
      varying vec3  vViewW;
      varying float vSpan;
      varying float vTint;
      varying float vSpecies;

      #include <fog_pars_fragment>

      void main() {
        // Wings are single-sided plates drawn DoubleSide, so the normal has to
        // be flipped for back faces or half of every wingbeat shades inverted.
        vec3 n = normalize(vNormalW);
        if (!gl_FrontFacing) n = -n;
        vec3 v = normalize(vViewW);

        vec3 base = mix(uBodyColor, uKiteColor, vSpecies) * (0.75 + 0.55 * vTint);

        // Hemisphere fill: a bird's back takes the sky, its belly takes the
        // ground and the water. Against a bright sky it stays a silhouette
        // either way, which is the entire point — detail at this scale reads as
        // noise, and a dark shape reads as a bird.
        vec3 fill = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5) * uAmbient;

        float lam = max(dot(n, uKeyDir), 0.0);

        // Backlit primaries. At dawn and dusk the key is behind the flock and
        // the outer wing goes translucent — the one moment birds are not black.
        float trans = pow(max(dot(-n, uKeyDir), 0.0), 3.0) * vSpan;

        float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);

        vec3 col = base * (fill + uKeyColor * (lam * 0.55 + 0.06));
        col += uKeyColor * base * trans * 2.2;
        col += mix(uGroundColor, uSkyColor, 0.8) * fres * 0.10;

        gl_FragColor = vec4(col, 1.0);

        // main.js renders through sky.js's composer once it has loaded, and the
        // OutputPass tone-maps there — but the composer arrives asynchronously
        // and never at all when the preset disables bloom, so on those frames
        // this material writes straight to the canvas. Both chunks are no-ops
        // when the target is the composer's linear buffer, so including them is
        // free; omitting them leaves the flock un-encoded and crushed to black
        // exactly when the backlit wing is supposed to glow.
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geo, material, N);
  mesh.frustumCulled = false;          // instances move; the baked bounds lie
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = false;             // a custom depth material would be needed
  mesh.receiveShadow = false;
  mesh.name = 'birds';

  const group = new THREE.Group();
  group.name = 'birds';
  group.add(mesh);

  /* ── runtime scratch ──────────────────────────────────────────── */
  const _m = new THREE.Matrix4();
  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
  const _wind = new THREE.Vector3();
  const _rep = new THREE.Vector3();
  const _evPos = new THREE.Vector3();

  let repelActive = false;
  let flushCool = 0;
  let callTimer = 1.5;
  let frames = 0;
  let primed = false;
  let cenX = HOME_X, cenY = 24, cenZ = HOME_Z;   // flock centroid, one frame stale

  const api = {
    group, mesh, update, setRepeller, dispose,
    /** Settable hook: (name, position) => void. The position is REUSED — copy it. */
    onEvent: () => {},
    count: N,
  };

  function emit(name, x, y, z) {
    const fn = api.onEvent;
    if (typeof fn === 'function') fn(name, _evPos.set(x, y, z));
  }

  function launch(b, urgency) {
    b.state = LAUNCH;
    b.stateT = 0;
    b.homeT = 0;
    b.vx = b.fx * 3.5;
    b.vz = b.fz * 3.5;
    b.vy = 3.4 + 3.6 * urgency;
    b.flapAmp = 1.25;
    b.alarm = Math.max(b.alarm, urgency);
  }

  function startLanding(b) {
    const dx = b.rx - b.px, dy = b.ry - b.py, dz = b.rz - b.pz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    b.state = LAND;
    b.landT = 0;
    b.landDur = clamp(d / 9 + 1.1, 1.2, 7.0);
    b.lax = b.px; b.lay = b.py; b.laz = b.pz;
    // Control point continues the current heading at height, so the approach
    // reads as a committed glide that bends down, not a dive at a waypoint.
    b.lcx = b.px + b.fx * d * 0.45;
    b.lcy = b.py - (b.py - b.ry) * 0.10;
    b.lcz = b.pz + b.fz * d * 0.45;
  }

  /** Everything with wings leaves the ground at once. Point-of-origin matters. */
  function triggerFlush(ox, oy, oz) {
    if (flushCool > 0) return;
    flushCool = 1.3;
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (let i = 0; i < N; i++) {
      const b = birds[i];
      if (b.kite) continue;              // the kite is above all this
      if (b.state === ROOST || b.state === LAND) launch(b, 1);
      b.alarm = 1;
      let dx = b.px - ox, dz = b.pz - oz;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      b.vx += (dx / d) * 5.5;
      b.vz += (dz / d) * 5.5;
      b.vy += 3.8;
      cx += b.px; cy += b.py; cz += b.pz; n++;
    }
    if (n) emit('flush', cx / n, cy / n, cz / n);
  }

  function setRepeller(p) {
    if (!p) { repelActive = false; return; }
    _rep.set(p.x, p.y, p.z);
    repelActive = true;
  }

  /* ── update ───────────────────────────────────────────────────── */
  function update(t, dt, phase) {
    dt = clamp(dt || 0, 0, 0.05);
    frames++;

    const night    = phase?.night ?? 0;
    const day      = phase?.day ?? 1;
    const twilight = phase?.twilight ?? 0;
    const golden   = phase?.golden ?? 0;

    // Dawn and dusk are when birds actually fly. Noon is a lazy high circle,
    // which is a real behaviour and also the only way the flock stops competing
    // with the blossom for attention in the middle of the day.
    const energy = clamp(0.26 + 0.9 * Math.max(twilight, golden), 0, 1);
    const cruise = 7.0 + 7.0 * energy;
    const maxF   = 16 + 22 * energy;
    const bandLo = 9 + 15 * (1 - energy);
    const bandHi = 20 + 22 * (1 - energy);
    const swirl  = (1 - energy) * day * 3.2;   // noon circulation

    const gust = wind?.state?.gust ?? 0;
    const windHeading = wind?.state?.heading ?? 0;
    const wdx = Math.cos(windHeading), wdz = Math.sin(windHeading);

    if (flushCool > 0) flushCool -= dt;

    // A squall breaking is the natural moment for the flock to come apart. Not
    // every gust — a flock that panics on schedule stops being startling.
    if (wind?.state?.gustOnset && gust > 0.45 && rng() < 0.6) {
      triggerFlush(cenX - wdx * 12, cenY, cenZ - wdz * 12);
    }

    let sumX = 0, sumY = 0, sumZ = 0, sumN = 0;

    /* ── forces ───────────────────────────────────────────────── */
    for (let i = 0; i < N; i++) {
      const b = birds[i];

      // heightAt is a grid lookup but not free, and a bird moves a fraction of
      // a unit per frame — a quarter of the population per frame is plenty.
      if ((frames + i) % 4 === 0) b.groundY = ground(b.px, b.pz);
      const floorY = Math.max(b.groundY, 0) + MIN_CLEAR;

      b.alarm -= b.alarm * Math.min(1, dt * 1.7);

      /* daily rhythm */
      if (!primed && night > b.sleepAt) {
        // First frame of a scene that opens at night: snap to the roost rather
        // than dropping the whole flock out of the sky as the user watches.
        b.state = ROOST;
        b.px = b.rx; b.py = b.ry; b.pz = b.rz;
        b.vx = b.vy = b.vz = 0;
        b.tuck = 1; b.flapAmp = 0; b.roll = 0;
      } else if (b.state === ROOST) {
        if (night < b.wakeAt) {
          b.wakeT += dt;
          if (b.wakeT > b.wakeDelay) launch(b, 0.15);
        } else {
          b.wakeT = 0;
        }
      } else if (b.state === FLY) {
        if (night > b.sleepAt) {
          b.homeT += dt;
          const rr = b.kite ? 32 : 22;
          const dx = b.rx - b.px, dz = b.rz - b.pz;
          // The timer is deliberately NOT gated on alarm. A repeller parked in
          // the roost holds alarm high indefinitely, and without a commitment
          // the bird circles until sunrise; with it, it goes to bed.
          if (b.homeT > 24 || (b.alarm < 0.2 && dx * dx + dz * dz < rr * rr)) startLanding(b);
        } else {
          b.homeT = 0;
        }
      }

      // Swap to the backup site while the repeller occupies this one. Only the
      // safer of the two ever wins, so a repeller sitting between them cannot
      // make the bird oscillate.
      if (repelActive && (b.state === FLY || b.state === LAUNCH)) {
        const d1 = (b.rx - _rep.x) ** 2 + (b.rz - _rep.z) ** 2;
        if (d1 < 22 * 22) {
          const d2 = (b.rx2 - _rep.x) ** 2 + (b.rz2 - _rep.z) ** 2;
          if (d2 > d1) {
            const tx = b.rx, ty = b.ry, tz = b.rz;
            b.rx = b.rx2; b.ry = b.ry2; b.rz = b.rz2;
            b.rx2 = tx; b.ry2 = ty; b.rz2 = tz;
          }
        }
      }

      const homing = night > b.sleepAt && b.alarm < 0.2;
      let ax = 0, ay = 0, az = 0;
      let headwind = 0;

      if (b.state === ROOST) {
        // Perched: a slow breathing bob and the occasional wing shuffle.
        b.px = b.rx; b.pz = b.rz;
        b.py = b.ry + 0.02 * Math.sin(t * 1.3 + b.seed);
        b.vx = b.vy = b.vz = 0;
        b.roll -= b.roll * Math.min(1, dt * 4);

        b.shuffleT -= dt;
        if (b.shuffleT <= 0) { b.shuffleT = R.range(rng, 2.5, 9); b.shuffle = 1; }
        b.shuffle -= b.shuffle * Math.min(1, dt * 1.7);

        if (repelActive) {
          const dx = b.px - _rep.x, dy = b.py - _rep.y, dz = b.pz - _rep.z;
          if (dx * dx + dy * dy + dz * dz < FLUSH_R2) triggerFlush(_rep.x, _rep.y, _rep.z);
        }
      } else if (b.state === LAND) {
        b.landT += dt;
        const u = clamp(b.landT / b.landDur, 0, 1);
        const s = u * u * (3 - 2 * u);
        const iv = 1 - s;
        const nx = iv * iv * b.lax + 2 * iv * s * b.lcx + s * s * b.rx;
        const ny = iv * iv * b.lay + 2 * iv * s * b.lcy + s * s * b.ry;
        const nz = iv * iv * b.laz + 2 * iv * s * b.lcz + s * s * b.rz;
        const inv = dt > 1e-5 ? 1 / dt : 0;
        b.vx = (nx - b.px) * inv; b.vy = (ny - b.py) * inv; b.vz = (nz - b.pz) * inv;
        b.px = nx; b.py = ny; b.pz = nz;
        b.roll -= b.roll * Math.min(1, dt * 5);

        if (repelActive) {
          const dx = b.px - _rep.x, dy = b.py - _rep.y, dz = b.pz - _rep.z;
          if (dx * dx + dy * dy + dz * dz < REP_R2) launch(b, 1);
        }
        if (u >= 1) {
          b.state = ROOST;
          b.px = b.rx; b.py = b.ry; b.pz = b.rz;
          b.vx = b.vy = b.vz = 0;
        }
      } else if (b.kite) {
        /* A single large bird riding a thermal. One flock alone reads as a
         * particle effect; a solitary silhouette turning on a slow circle
         * overhead is what gives the sky a sense of scale. */
        b.orbit += (6.4 / b.orbitR) * dt * (0.7 + 0.4 * energy);
        // A thermal is a column of air, and air moves: the circle drifts
        // downwind through a gust, which is why real raptors slide sideways
        // across the sky while apparently doing nothing.
        b.thermalX = clamp(b.thermalX + wdx * gust * dt * 1.2, HOME_X - 70, HOME_X + 70);
        b.thermalZ = clamp(b.thermalZ + wdz * gust * dt * 1.2, HOME_Z - 70, HOME_Z + 70);

        if (homing) {
          // Coming down off the thermal to roost; without this it would circle
          // forever, since the flock's homing term lives in the boids branch.
          steer(b.rx - b.px, b.ry + 16 - b.py, b.rz - b.pz, 6.0, b.vx, b.vy, b.vz, 9);
        } else {
          const tx = b.thermalX + Math.cos(b.orbit) * b.orbitR;
          const tz = b.thermalZ + Math.sin(b.orbit) * b.orbitR;
          const ty = b.thermalY + Math.sin(t * 0.07 + b.seed) * 8;
          steer(tx - b.px, ty - b.py, tz - b.pz, 6.6, b.vx, b.vy, b.vz, 9);
        }
        ax += _sx; ay += _sy; az += _sz;

        if (repelActive) {
          const dx = b.px - _rep.x, dz = b.pz - _rep.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < REP_R2) {
            const d = Math.sqrt(d2) || 1;
            const k = 1 - d / REP_R;
            ay += REP_LIFT * 0.4 * k * k;
          }
        }
      } else {
        /* ── boids ─────────────────────────────────────────────── */
        let spx = 0, spy = 0, spz = 0;
        let alx = 0, aly = 0, alz = 0;
        let cox = 0, coy = 0, coz = 0, nc = 0;

        for (let j = 0; j < FLOCK; j++) {
          if (j === i) continue;
          const o = birds[j];
          if (o.state === ROOST || o.state === LAND) continue;
          const dx = b.px - o.px, dy = b.py - o.py, dz = b.pz - o.pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > NEIGH2 || d2 < 1e-6) continue;

          cox += o.px; coy += o.py; coz += o.pz;
          alx += o.vx; aly += o.vy; alz += o.vz;
          nc++;

          if (d2 < SEP2) {
            const d = Math.sqrt(d2);
            const w = (1 - d / SEP) / d;
            spx += dx * w; spy += dy * w; spz += dz * w;
          }
        }

        if (nc > 0) {
          const inv = 1 / nc;
          steer(cox * inv - b.px, coy * inv - b.py, coz * inv - b.pz, cruise, b.vx, b.vy, b.vz, maxF);
          const cw = W_COH * (1 - b.alarm * 0.85);
          ax += _sx * cw; ay += _sy * cw; az += _sz * cw;

          steer(alx * inv, aly * inv, alz * inv, cruise, b.vx, b.vy, b.vz, maxF);
          ax += _sx * W_ALI; ay += _sy * W_ALI; az += _sz * W_ALI;
        }
        if (spx || spy || spz) {
          steer(spx, spy, spz, cruise, b.vx, b.vy, b.vz, maxF);
          const sw = W_SEP * (1 + b.alarm);
          ax += _sx * sw; ay += _sy * sw; az += _sz * sw;
        }

        // Wander. Gradient noise rather than a random walk: it is smooth in
        // time, so it curves the path instead of jittering it, and it is the
        // only thing stopping the flock from crystallising into a lattice.
        const wt = t * 0.5;
        ax += noise2(b.seed, wt) * W_WANDER;
        ay += noise2(b.seed + 71.3, wt * 0.7) * W_WANDER * 0.45;
        az += noise2(b.seed + 137.9, wt) * W_WANDER;

        // Noon: a wide lazy circulation about the island rather than commuting.
        if (swirl > 0.01) {
          const dx = b.px - HOME_X, dz = b.pz - HOME_Z;
          const d = Math.sqrt(dx * dx + dz * dz) || 1;
          ax += (-dz / d) * swirl;
          az += (dx / d) * swirl;
        }

        // Home volume — soft until they leave it, then firm. Birds that wander
        // out to sea and never come back are birds you stop seeing.
        const hx = (b.px - HOME_X) / HOME_RX, hz = (b.pz - HOME_Z) / HOME_RZ;
        const hr = Math.sqrt(hx * hx + hz * hz);
        if (hr > 1) {
          const pull = Math.min((hr - 1) * 26, 34);
          const dx = HOME_X - b.px, dz = HOME_Z - b.pz;
          const d = Math.sqrt(dx * dx + dz * dz) || 1;
          ax += (dx / d) * pull; az += (dz / d) * pull;
        }

        // Heading home to roost: the flock converges before it lands.
        if (homing) {
          steer(b.rx - b.px, b.ry + 12 - b.py, b.rz - b.pz, cruise, b.vx, b.vy, b.vz, maxF);
          ax += _sx * 1.4; ay += _sy * 1.4; az += _sz * 1.4;
        }

        if (repelActive) {
          const dx = b.px - _rep.x, dy = b.py - _rep.y, dz = b.pz - _rep.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < REP_R2) {
            const d = Math.sqrt(d2) || 1;
            const k = 1 - d / REP_R;
            const kk = k * k;
            ax += (dx / d) * REP_PUSH * kk;
            az += (dz / d) * REP_PUSH * kk;
            ay += REP_LIFT * kk;                    // scatter UP, not just aside
            if (kk > b.alarm) b.alarm = Math.min(1, kk * 1.4);
            if (d2 < FLUSH_R2) triggerFlush(_rep.x, _rep.y, _rep.z);
          }
        }
      }

      /* ── shared airborne integration ─────────────────────────── */
      if (b.state === FLY || b.state === LAUNCH) {
        if (b.state === LAUNCH) {
          b.stateT += dt;
          ay += 22;                                  // claw for height
          if (b.stateT > 0.55) { b.state = FLY; b.stateT = 0; }
        }

        // Wind. Two separate effects, and both are needed: a force the bird can
        // partly fight, and a bodily advection it cannot. Without the advection
        // a squall just makes them lean; with it, the whole flock gets carried.
        if (wind?.windAt) {
          wind.windAt(b.px, b.pz, t, _wind);
          const push = b.kite ? 1.1 : 1.9;
          ax += _wind.x * push;
          ay += _wind.y * push * 0.6;
          az += _wind.z * push;
          b.px += _wind.x * dt * 0.85;
          b.pz += _wind.z * dt * 0.85;
          // Flying into it costs beats; running before it is free.
          headwind = -(b.fx * _wind.x + b.fz * _wind.z);
        }

        // Altitude band, as a spring with damping so they settle rather than
        // porpoise. Tracks the terrain, so the flock lifts over the ridge.
        const want = floorY + mix(bandLo, bandHi, b.altBias) + (b.kite ? 34 : 0);
        ay += (want - b.py) * 1.1 - b.vy * 0.9;

        if (b.py < floorY) ay += (floorY - b.py) * 16;
        // The kite's ceiling has to be the reference for its own restoring
        // force too: testing the raised threshold and then pushing back toward
        // the flock's puts a 60-unit step in the acceleration at the crossing.
        const roof = CEILING + (b.kite ? 30 : 0);
        if (b.py > roof) ay -= (b.py - roof) * 2.0;

        b.vx += ax * dt; b.vy += ay * dt; b.vz += az * dt;

        // Speed envelope. A bird has a stall speed and a top speed; letting the
        // integrator choose gives you either drifting balloons or missiles.
        let sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
        const lo = cruise * 0.5, hi = cruise * 1.5 + b.alarm * 10;
        if (sp < 1e-4) { b.vx = b.fx * lo; b.vy = 0; b.vz = b.fz * lo; sp = lo; }
        else if (sp > hi) { const k = hi / sp; b.vx *= k; b.vy *= k; b.vz *= k; sp = hi; }
        else if (sp < lo) { const k = lo / sp; b.vx *= k; b.vy *= k; b.vz *= k; sp = lo; }

        // Cap the climb angle. This also keeps the forward vector away from
        // vertical, where the up-reference for the orientation basis degenerates.
        const vyMax = sp * 0.55;
        if (b.vy > vyMax) b.vy = vyMax; else if (b.vy < -vyMax) b.vy = -vyMax;

        b.px += b.vx * dt; b.py += b.vy * dt; b.pz += b.vz * dt;

        /* BANK. Lateral acceleration in the bird's own frame, rolled into.
         * Inside wing down. Remove this line and the flock turns into paper. */
        const hl = Math.sqrt(b.fx * b.fx + b.fz * b.fz) || 1;
        const rgx = b.fz / hl, rgz = -b.fx / hl;
        const lat = ax * rgx + az * rgz;
        const rollT = clamp(-lat / 17, -1, 1) * (b.kite ? 0.75 : 1.2);
        b.roll += (rollT - b.roll) * Math.min(1, dt * 6);
      }

      /* ── orientation ───────────────────────────────────────────
       * The forward vector is smoothed and PERSISTENT rather than taken raw
       * from the velocity: at the end of a landing the velocity goes to zero
       * and a normalize() there would spin the bird. A perched bird keeps
       * facing the way it came in. */
      const sp2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
      if (sp2 > 0.12) {
        const inv = 1 / Math.sqrt(sp2);
        let dfx = b.vx * inv, dfy = b.vy * inv, dfz = b.vz * inv;
        if (b.state === LAND) {
          // Flare: the nose comes up in the last moment before the feet touch.
          const u = clamp(b.landT / b.landDur, 0, 1);
          if (u > 0.78) dfy = mix(dfy, 0.16, (u - 0.78) / 0.22);
        }
        const k = Math.min(1, dt * 9);
        b.fx += (dfx - b.fx) * k; b.fy += (dfy - b.fy) * k; b.fz += (dfz - b.fz) * k;
        const fl = Math.sqrt(b.fx * b.fx + b.fy * b.fy + b.fz * b.fz) || 1;
        b.fx /= fl; b.fy /= fl; b.fz /= fl;
      }

      /* ── wingbeat ──────────────────────────────────────────────
       * Frequency and amplitude both track effort. Climbing and headwind cost
       * beats; descending buys a glide. */
      const speed = Math.sqrt(sp2);
      const climb = speed > 0.05 ? b.vy / speed : 0;

      let ampT, freq;
      if (b.state === ROOST) {
        ampT = 0.30 * b.shuffle;
        freq = 1.6;
      } else if (b.kite) {
        b.burstT -= dt;
        if (b.burstT <= 0) { b.burstT = R.range(rng, 7, 17); b.burst = 1; }
        b.burst -= b.burst * Math.min(1, dt * 0.85);
        ampT = 0.10 + 0.85 * b.burst + Math.max(0, climb) * 0.4;
        freq = 1.0 + 1.4 * b.burst;
      } else {
        ampT = clamp(
          0.34 + climb * 1.5 + Math.max(0, headwind) * 0.10 + b.alarm * 1.1 +
          (b.state === LAUNCH ? 1.0 : 0) +
          (b.state === LAND && b.landT / b.landDur > 0.72 ? 0.9 : 0),
          0.03, 1.3
        );
        freq = Math.max(0.7,
          (2.3 + 2.4 * energy + climb * 2.6 + b.alarm * 2.6 + Math.max(0, headwind) * 0.3) * b.freqScale
        );
      }
      b.flapAmp += (ampT - b.flapAmp) * Math.min(1, dt * 6);
      b.flapPhase = (b.flapPhase + freq * TAU * dt) % TAU;

      const tuckT = b.state === ROOST ? 1 - 0.45 * b.shuffle : 0;
      b.tuck += (tuckT - b.tuck) * Math.min(1, dt * (tuckT > b.tuck ? 3 : 9));

      if (!b.kite && b.state !== ROOST) { sumX += b.px; sumY += b.py; sumZ += b.pz; sumN++; }

      /* ── instance transform ───────────────────────────────────── */
      _f.set(b.fx, b.fy, b.fz);
      _r.crossVectors(UP, _f);
      const rl = _r.length();
      if (rl < 1e-4) _r.set(1, 0, 0); else _r.multiplyScalar(1 / rl);
      _u.crossVectors(_f, _r);

      const cr = Math.cos(b.roll), sr = Math.sin(b.roll);
      const rx2 = _r.x * cr + _u.x * sr, ry2 = _r.y * cr + _u.y * sr, rz2 = _r.z * cr + _u.z * sr;
      const ux2 = _u.x * cr - _r.x * sr, uy2 = _u.y * cr - _r.y * sr, uz2 = _u.z * cr - _r.z * sr;

      const sc = b.size;
      _r.set(rx2 * sc, ry2 * sc, rz2 * sc);
      _u.set(ux2 * sc, uy2 * sc, uz2 * sc);
      _f.multiplyScalar(sc);
      _m.makeBasis(_r, _u, _f);
      _m.setPosition(b.px, b.py, b.pz);
      mesh.setMatrixAt(i, _m);

      const o4 = i * 4;
      animArr[o4] = b.flapPhase;
      animArr[o4 + 1] = b.flapAmp;
      animArr[o4 + 2] = b.tuck;
      animArr[o4 + 3] = b.kite;
    }

    primed = true;
    if (sumN > 0) { cenX = sumX / sumN; cenY = sumY / sumN; cenZ = sumZ / sumN; }

    mesh.instanceMatrix.needsUpdate = true;
    aAnim.needsUpdate = true;

    /* ── calls ────────────────────────────────────────────────── */
    callTimer -= dt;
    if (callTimer <= 0) {
      callTimer = R.range(rng, 0.6, 3.2) / (0.3 + energy) + night * 4;
      // Dawn chorus, quiet at night. Nothing consumes this yet; audio will.
      if (rng() > night * 0.85) {
        const b = birds[(rng() * N) | 0];
        if (b.state !== ROOST || rng() < 0.35) emit('call', b.px, b.py, b.pz);
      }
    }

    /* ── lighting ─────────────────────────────────────────────── */
    if (phase) {
      const dir = phase.keyDir || phase.sunDirection;
      const col = phase.keyColor || phase.sunColor;
      if (dir) uniforms.uKeyDir.value.copy(dir);
      if (col) {
        const k = (phase.keyIntensity ?? 1) * KEY_SCALE;
        uniforms.uKeyColor.value.setRGB(col.r * k, col.g * k, col.b * k);
      }
      if (phase.skyColor) uniforms.uSkyColor.value.copy(phase.skyColor);
      if (phase.groundColor) uniforms.uGroundColor.value.copy(phase.groundColor);
      uniforms.uAmbient.value = phase.ambient ?? 0.5;
    }
  }

  function dispose() {
    group.remove(mesh);
    geo.dispose();
    material.dispose();
    mesh.dispose();
  }

  return api;
}
