/**
 * river.js — a watercourse across the island, and the bridge that crosses it.
 *
 * Three responsibilities, in dependency order:
 *
 *  1. `carveRiver(x, z, h)` — a pure height modifier composed into the island's
 *     heightfield. The channel has to be cut into the terrain itself, not laid
 *     on top of it; otherwise the water plane floats over the ground wherever
 *     the ground happens to be higher than the water.
 *  2. A water ribbon mesh generated along the same curve, so it sits exactly in
 *     the channel it carved.
 *  3. A wooden bridge — taiko-bashi, the humped garden bridge — placed at an
 *     authored point on the curve.
 *
 * The path is a hand-placed spline rather than a derived drainage network. A
 * real flow simulation wanders plausibly but arbitrarily; an authored curve can
 * be made to pass exactly where the bridge should stand, and to meet the coast
 * at an angle that reads well from the default camera.
 *
 * PERFORMANCE NOTE: `carveRiver` is called once per terrain vertex (160 000 of
 * them) and again for every tree, rock and blade of grass. A brute-force
 * closest-point-on-polyline search would be ~400 distance tests per call and
 * make the load unbearable. Instead the polyline is bucketed into a uniform
 * grid once, and each query only tests the samples in its own cell and the
 * eight around it.
 */

import * as THREE from 'three';
import { RIVER, WORLD } from './config.js';
import { fbm2, smoothstep, clamp } from './noise.js';

/* ────────────────────────────────────────────────────────────────
   Curve + spatial index
   ──────────────────────────────────────────────────────────────── */

const curve = new THREE.CatmullRomCurve3(
  RIVER.path.map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  'catmullrom',
  0.5
);

const SAMPLES = 420;
const _pts = curve.getSpacedPoints(SAMPLES);          // evenly spaced along arc length
const SAMPLE_X = new Float32Array(SAMPLES + 1);
const SAMPLE_Z = new Float32Array(SAMPLES + 1);
const SAMPLE_T = new Float32Array(SAMPLES + 1);       // 0..1 along the river
for (let i = 0; i <= SAMPLES; i++) {
  SAMPLE_X[i] = _pts[i].x;
  SAMPLE_Z[i] = _pts[i].z;
  SAMPLE_T[i] = i / SAMPLES;
}

// Uniform grid over the world, cell ≈ the influence radius, so a query only
// needs its own cell plus the ring around it.
const REACH = RIVER.bankWidth + 6;
const CELL = REACH;
const HALF = WORLD.size * 0.5 + 60;
const GRID_N = Math.ceil((HALF * 2) / CELL);
/** @type {Int32Array[]} */
const grid = new Array(GRID_N * GRID_N);

const cellOf = (x, z) => {
  const cx = clamp(Math.floor((x + HALF) / CELL), 0, GRID_N - 1);
  const cz = clamp(Math.floor((z + HALF) / CELL), 0, GRID_N - 1);
  return cz * GRID_N + cx;
};

for (let i = 0; i <= SAMPLES; i++) {
  const c = cellOf(SAMPLE_X[i], SAMPLE_Z[i]);
  (grid[c] ||= []).push(i);
}

/**
 * Distance from (x, z) to the river centreline, plus how far along it we are.
 *
 * This is the SLOW path — roughly 135 distance tests per call. It is used once
 * per cell to bake the field below, and never in a hot loop. Prop placement
 * uses rejection sampling and would otherwise call this millions of times,
 * which is exactly the mistake that made the load time balloon.
 */
function nearestOnRiverExact(x, z) {
  const cx = clamp(Math.floor((x + HALF) / CELL), 0, GRID_N - 1);
  const cz = clamp(Math.floor((z + HALF) / CELL), 0, GRID_N - 1);

  let best = Infinity, bestT = 0;
  for (let dz = -1; dz <= 1; dz++) {
    const rz = cz + dz;
    if (rz < 0 || rz >= GRID_N) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const rx = cx + dx;
      if (rx < 0 || rx >= GRID_N) continue;
      const bucket = grid[rz * GRID_N + rx];
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k];
        const ddx = x - SAMPLE_X[i], ddz = z - SAMPLE_Z[i];
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < best) { best = d2; bestT = SAMPLE_T[i]; }
      }
    }
  }
  return { dist: best === Infinity ? Infinity : Math.sqrt(best), t: bestT };
}

/* ── baked distance field ─────────────────────────────────────────
 * The exact query above, evaluated once onto a grid. Every hot-path caller
 * (terrain vertices, tree placement, grass rejection sampling) reads this
 * instead. Distance is bilinearly interpolated so the banks stay smooth;
 * `t` is nearest-neighbour, which is fine because it only selects a station
 * along the river and never appears in a continuous quantity.
 */
const FIELD_CELL = 2.5;
const FIELD_N = Math.ceil((HALF * 2) / FIELD_CELL) + 1;
const _fieldDist = new Float32Array(FIELD_N * FIELD_N);
const _fieldT = new Float32Array(FIELD_N * FIELD_N);

for (let j = 0; j < FIELD_N; j++) {
  const z = -HALF + j * FIELD_CELL;
  for (let i = 0; i < FIELD_N; i++) {
    const x = -HALF + i * FIELD_CELL;
    const r = nearestOnRiverExact(x, z);
    const k = j * FIELD_N + i;
    // Clamp rather than store Infinity: NaNs propagate horribly through lerps.
    _fieldDist[k] = r.dist === Infinity ? REACH * 4 : r.dist;
    _fieldT[k] = r.t;
  }
}

const _result = { dist: 0, t: 0 };   // reused; never allocate in a hot loop

function nearestOnRiver(x, z) {
  let fx = (x + HALF) / FIELD_CELL;
  let fz = (z + HALF) / FIELD_CELL;
  const last = FIELD_N - 1;
  if (fx < 0) fx = 0; else if (fx > last) fx = last;
  if (fz < 0) fz = 0; else if (fz > last) fz = last;

  const i = fx | 0, j = fz | 0;
  const i1 = i < last ? i + 1 : i;
  const j1 = j < last ? j + 1 : j;
  const tx = fx - i, tz = fz - j;

  const r0 = j * FIELD_N, r1 = j1 * FIELD_N;
  const d = (_fieldDist[r0 + i] * (1 - tx) + _fieldDist[r0 + i1] * tx) * (1 - tz)
          + (_fieldDist[r1 + i] * (1 - tx) + _fieldDist[r1 + i1] * tx) * tz;

  _result.dist = d;
  _result.t = _fieldT[(tz < 0.5 ? r0 : r1) + (tx < 0.5 ? i : i1)];
  return _result;
}

/**
 * Longitudinal water profile, filled in once the terrain exists.
 *
 * The first version of this used an ABSOLUTE elevation curve from source to
 * sea, which was wrong in an instructive way: where the path crossed high
 * ground the carve dug all the way down to that absolute level, gouging a
 * canyon through the ridge. A river does not do that — it sits a little below
 * its own banks, whatever height those banks happen to be.
 *
 * So the channel is now carved RELATIVE to the local terrain, and the water
 * surface is sampled from the resulting bed afterwards.
 */
let _profile = null;   // Float32Array of water Y, indexed like SAMPLE_*

function waterYAt(t) {
  if (!_profile) {
    // Fallback before build(): a plain descent, only used if something queries
    // the river before the terrain exists.
    return WORLD.seaLevel + Math.pow(1 - t, 1.55) * RIVER.depth + 0.12;
  }
  const f = clamp(t, 0, 1) * SAMPLES;
  const i = Math.min(SAMPLES, f | 0);
  const i1 = Math.min(SAMPLES, i + 1);
  const a = f - i;
  return _profile[i] * (1 - a) + _profile[i1] * a;
}

/* ────────────────────────────────────────────────────────────────
   1. Terrain carving
   ──────────────────────────────────────────────────────────────── */

/**
 * Height modifier. Compose into the island's heightAt so mesh and sampler agree.
 * Cuts a channel with soft banks and a slightly meandering, noisy edge.
 */
export function carveRiver(x, z, h) {
  const { dist } = nearestOnRiver(x, z);
  if (dist > REACH) return h;

  // Wobble the effective width so the banks are never parallel lines.
  const wob = fbm2(x * 0.035, z * 0.035, 3) * 0.35 + 1;
  const halfW = RIVER.width * 0.5 * wob;
  const bank = RIVER.bankWidth * wob;

  const inChannel = 1 - smoothstep(halfW, halfW + bank, dist);
  if (inChannel <= 0) return h;

  // Cut RELATIVE to the local ground: the bed sits `depth` below whatever the
  // surrounding terrain is here, so the channel follows the landscape down
  // instead of trenching through it.
  const bedY = h - RIVER.depth;

  // A bowl-shaped cross-section rather than a square trench.
  const u = clamp(dist / (halfW + bank), 0, 1);
  const profile = bedY + (h - bedY) * Math.pow(u, 1.7);

  return h * (1 - inChannel) + profile * inChannel;
}

/** True inside the wetted channel — used to keep grass and trees out of the water. */
export function isInRiver(x, z) {
  const { dist } = nearestOnRiver(x, z);
  return dist < RIVER.width * 0.5 + 1.5;
}

/* ────────────────────────────────────────────────────────────────
   2. Water ribbon
   ──────────────────────────────────────────────────────────────── */

function buildWaterRibbon() {
  const N = 240, W = RIVER.width * 0.5;
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector3(), tan = new THREE.Vector3();

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tan);
    // Left-hand normal in the XZ plane.
    const nx = -tan.z, nz = tan.x;
    const len = Math.hypot(nx, nz) || 1;
    const wob = fbm2(p.x * 0.03, p.z * 0.03, 2) * 0.28 + 1;
    const w = W * wob;
    const y = waterYAt(t);

    pos.push(p.x + (nx / len) * w, y, p.z + (nz / len) * w);
    pos.push(p.x - (nx / len) * w, y, p.z - (nz / len) * w);
    uv.push(0, t * 26);
    uv.push(1, t * 26);

    if (i < N) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const RIVER_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const RIVER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform vec3  uSkyColor;
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.545); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(h21(i), h21(i+vec2(1,0)), u.x),
               mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y);
  }

  void main() {
    // Two ripple layers scrolling downstream at different rates. Flowing water
    // reads as motion along ONE axis; using symmetric noise makes it look like
    // a lake with a current, which is wrong.
    float s = vUv.y - uTime * uFlow;
    float r1 = vnoise(vec2(vUv.x * 7.0, s * 3.0));
    float r2 = vnoise(vec2(vUv.x * 15.0 + 4.7, s * 6.5));
    float ripple = r1 * 0.65 + r2 * 0.35;

    // Faster, brighter water at the banks where it runs shallow over stones.
    float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float shallow = smoothstep(0.55, 0.0, edge);

    vec3 col = mix(uDeep, uShallow, shallow * 0.55 + ripple * 0.18);

    // Cheap specular: perturb a flat-up normal by the ripple gradient.
    vec3 n = normalize(vec3((r2 - r1) * 0.9, 1.0, (r1 - r2) * 0.9));
    float spec = pow(max(dot(reflect(-uSunDir, n), normalize(cameraPosition - vWorld)), 0.0), 48.0);
    col += uSunColor * spec * 0.55;

    // Sky reflection, but only at grazing angles — a fresnel term. Adding a flat
    // fraction of the sky colour everywhere is what turned this into a pale
    // ribbon that read as a paved road rather than as water.
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    col = mix(col, uSkyColor, fres * 0.38);

    // Foam only where ripples peak against the shallow margins.
    float foam = smoothstep(0.80, 0.97, ripple) * shallow;
    col = mix(col, vec3(0.90, 0.94, 0.95), foam * 0.30);

    gl_FragColor = vec4(col, 0.90);
    #include <fog_fragment>
  }
`;

/* ────────────────────────────────────────────────────────────────
   3. The bridge — taiko-bashi
   ──────────────────────────────────────────────────────────────── */

/**
 * A humped wooden garden bridge. Built from primitives rather than a mesh file:
 * an arched deck of transverse planks, two curved handrails on posts, and piles
 * driven into the bed. The steep camber is the whole character of the form —
 * a flat plank across a stream reads as a boardwalk, not as a garden bridge.
 */
function buildBridge(group) {
  const span = RIVER.bridgeSpan;
  const halfW = RIVER.bridgeWidth * 0.5;
  const rise = RIVER.bridgeRise;

  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.82, metalness: 0.0 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x5f3b26, roughness: 0.88, metalness: 0.0 });
  const rail = new THREE.MeshStandardMaterial({ color: 0x7d4a30, roughness: 0.8, metalness: 0.0 });

  /** Height of the arch at normalised position u ∈ [-1, 1] across the span. */
  const arch = (u) => rise * (1 - u * u);

  const bridge = new THREE.Group();

  // — deck planks, each tilted to follow the arch —
  const PLANKS = 34;
  for (let i = 0; i < PLANKS; i++) {
    const u = (i / (PLANKS - 1)) * 2 - 1;
    const uNext = ((i + 0.5) / (PLANKS - 1)) * 2 - 1;
    const x = u * span * 0.5;
    const y = arch(u);
    const slope = Math.atan2(arch(uNext) - y, (uNext - u) * span * 0.5);

    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(span / PLANKS * 1.06, 0.16, RIVER.bridgeWidth),
      i % 2 === 0 ? wood : woodDark
    );
    plank.position.set(x, y, 0);
    plank.rotation.z = slope;
    plank.castShadow = plank.receiveShadow = true;
    bridge.add(plank);
  }

  // — two longitudinal stringers under the deck —
  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const u = (i / 20) * 2 - 1;
      pts.push(new THREE.Vector3(u * span * 0.5, arch(u) - 0.22, side * (halfW - 0.25)));
    }
    const beam = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.17, 6, false),
      woodDark
    );
    beam.castShadow = true;
    bridge.add(beam);
  }

  // — railings: curved handrail + uprights with giboshi finials —
  const POSTS = 9;
  for (const side of [-1, 1]) {
    const railPts = [];
    for (let i = 0; i <= 20; i++) {
      const u = (i / 20) * 2 - 1;
      railPts.push(new THREE.Vector3(u * span * 0.5, arch(u) + 1.02, side * halfW));
    }
    const handrail = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), 26, 0.09, 6, false),
      rail
    );
    handrail.castShadow = true;
    bridge.add(handrail);

    for (let i = 0; i < POSTS; i++) {
      const u = (i / (POSTS - 1)) * 2 - 1;
      const x = u * span * 0.5;
      const yDeck = arch(u);

      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.02, 0.14), rail);
      post.position.set(x, yDeck + 0.51, side * halfW);
      post.castShadow = true;
      bridge.add(post);

      // giboshi — the onion-shaped bronze finial on a Japanese bridge post
      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), woodDark);
      finial.position.set(x, yDeck + 1.09, side * halfW);
      finial.scale.set(1, 1.35, 1);
      bridge.add(finial);
    }
  }

  // — piles into the riverbed —
  for (const u of [-0.62, 0.62]) {
    for (const side of [-1, 1]) {
      const pile = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.2, 5.5, 8),
        woodDark
      );
      pile.position.set(u * span * 0.5, arch(u) - 2.8, side * (halfW - 0.5));
      pile.castShadow = true;
      bridge.add(pile);
    }
  }

  // — place and orient it across the river —
  const p = curve.getPointAt(RIVER.bridgeAt);
  const tan = curve.getTangentAt(RIVER.bridgeAt);
  bridge.position.set(p.x, waterYAt(RIVER.bridgeAt) + 0.55, p.z);
  // The deck's long axis (+X) must lie ACROSS the flow, i.e. along the normal.
  bridge.rotation.y = Math.atan2(tan.x, tan.z);

  group.add(bridge);
  return bridge;
}

/* ────────────────────────────────────────────────────────────────
   Factory
   ──────────────────────────────────────────────────────────────── */

export function createRiver({ wind } = {}) {
  const group = new THREE.Group();
  group.name = 'river';

  /**
   * Called once the terrain exists. Samples the carved bed along the
   * centreline, forces the result to be monotonically descending (a river never
   * flows uphill, but a noisy heightfield sampled along a curve will happily
   * suggest it does), then builds the water surface and the bridge on top.
   */
  function build(heightAt) {
    _profile = new Float32Array(SAMPLES + 1);

    // Bed height at each station, lifted to a water surface just below the banks.
    const bed = new Float32Array(SAMPLES + 1);
    for (let i = 0; i <= SAMPLES; i++) {
      bed[i] = heightAt(SAMPLE_X[i], SAMPLE_Z[i]);
      _profile[i] = bed[i] + RIVER.depth * 0.72;
    }

    // Enforce monotonic descent from source to mouth.
    //
    // Guard against a badly-placed source: if the path happens to begin lower
    // than points downstream (because it starts offshore, say), a naive
    // "never rise" pass propagates that low value along the whole river and
    // flattens it into a single submerged plane. Seed the descent from the
    // HIGHEST station instead, and leave anything upstream of it clamped to
    // its own bed.
    let src = 0;
    for (let i = 1; i <= SAMPLES; i++) if (_profile[i] > _profile[src]) src = i;
    for (let i = src + 1; i <= SAMPLES; i++) {
      if (_profile[i] > _profile[i - 1]) _profile[i] = _profile[i - 1];
    }
    for (let i = src - 1; i >= 0; i--) {
      _profile[i] = Math.min(_profile[i], bed[i] + RIVER.depth * 0.72);
    }
    // Smooth the steps out so the surface does not read as a staircase.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < SAMPLES; i++) {
        _profile[i] = (_profile[i - 1] + _profile[i] * 2 + _profile[i + 1]) * 0.25;
      }
    }
    // The mouth must meet the sea.
    for (let i = SAMPLES - 24; i <= SAMPLES; i++) {
      const a = (i - (SAMPLES - 24)) / 24;
      _profile[i] = _profile[i] * (1 - a) + (WORLD.seaLevel + 0.05) * a;
    }

    water.geometry.dispose();
    water.geometry = buildWaterRibbon();
    buildBridge(group);
  }

  const uniforms = {
    uTime:     { value: 0 },
    uFlow:     { value: RIVER.flowSpeed },
    uShallow:  { value: new THREE.Color(0x4d7f7c) },
    uDeep:     { value: new THREE.Color(0x14343c) },
    uSunDir:   { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSkyColor: { value: new THREE.Color(0.4, 0.5, 0.62) },
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
  };

  const water = new THREE.Mesh(
    buildWaterRibbon(),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: RIVER_VERT,
      fragmentShader: RIVER_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    })
  );
  water.renderOrder = 2;
  group.add(water);

  function update(t, phase) {
    uniforms.uTime.value = t;
    if (!phase) return;
    const dir = phase.keyDir || phase.sunDirection;
    const col = phase.keyColor || phase.sunColor;
    if (dir) uniforms.uSunDir.value.copy(dir);
    if (col) {
      const k = phase.keyIntensity ?? 1;
      uniforms.uSunColor.value.setRGB(col.r * k, col.g * k, col.b * k);
    }
    if (phase.skyColor) uniforms.uSkyColor.value.copy(phase.skyColor);
  }

  return { group, update, build, water, carveRiver, isInRiver, curve, waterYAt };
}
