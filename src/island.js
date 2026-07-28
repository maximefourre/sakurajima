/**
 * island.js — the ground, the sea around it, and the boulders on it.
 *
 * This module owns THE heightfield. Everything else in the scene (trees, grass,
 * rocks, birds, ponds) asks it where the ground is via `heightAt(x, z)`, so
 * there is deliberately exactly one implementation and no second opinion.
 *
 * Three decisions worth explaining, because they are the difference between an
 * island and "a Perlin plane with a circle mask":
 *
 *  1. COASTLINE. The island mask is a radial falloff, but the coordinates are
 *     domain-warped twice — once coarsely (headlands and bays) and once finely
 *     (coves). A plain radial falloff always reads as a disc no matter how much
 *     noise you pile on top of the height.
 *
 *  2. RELIEF IS AUTHORED. The dominant massif is an explicit 4-point ridge
 *     polyline placed off-centre, not a symmetric cone. Secondary bumps and a
 *     flat meadow shelf are placed by hand too. fBm alone gives you rolling
 *     sameness with no silhouette and nowhere for the eye to rest.
 *
 *  3. THE BEACH IS A CURVE. `y -= S*y*exp(-y^2/W^2)` compresses the terrain
 *     around sea level, which widens the near-waterline band into real sand on
 *     the land side and a shallow shelf on the sea side. One smooth analytic
 *     line, no special-casing, no visible seam.
 *
 * Sampling is grid-exact: heights are baked once into a Float32Array and
 * `heightAt` interpolates the SAME triangles PlaneGeometry actually builds, so
 * props sit on the rendered surface rather than on the ideal surface.
 */

import * as THREE from 'three';
import { WORLD } from './config.js';
import {
  noise2, fbm2, ridged2,
  streamFor, smoothstep as sstep, clamp, mix,
} from './noise.js';

const TAU = Math.PI * 2;

/* ────────────────────────────────────────────────────────────────
   Art direction — the knobs a human actually wants
   ──────────────────────────────────────────────────────────────── */

/** Curved spine of the dominant massif, in world XZ. Off-centre on purpose. */
const RIDGE_PTS = [[-58, -4], [-26, 14], [8, 24], [36, 12]];
const RIDGE_H = 17.5;   // crest height above the surrounding land
const RIDGE_W = 22.0;   // gaussian half-width of the spine

/** Secondary relief. Keep these clear of the ridge or the island reads as one lump. */
const BUMPS = [
  { x:  56, z: -10, h: 9.0, r: 24 },
  { x: -36, z: -48, h: 7.5, r: 26 },
  { x: -50, z:  44, h: 6.0, r: 20 },
  { x:  28, z:  52, h: 4.5, r: 18 },
];

/** The flat shelf where the cherry grove will read best. */
const MEADOW = { x: 14, z: -38, r: 34, y: 5.4, strength: 0.82 };

const BEACH_SOFT   = 0.58;  // 0..1 — how hard heights are compressed toward sea level
const BEACH_WIDTH  = 2.8;   // world units of the compression band

/** Terrain palette. Authored as sRGB hex; ColorManagement converts on read. */
const PAL = {
  seabed:    0x4a5648,
  sandWet:   0x9d8e72,
  sandDry:   0xdccaa4,
  grassLow:  0x93ab5c,
  grassMid:  0x6d8f47,
  grassHigh: 0x4b6a3a,
  rock:      0x8c8377,
  rockDark:  0x615a50,
};

/** Water, day and night. The caller lerps between them via `phase`. */
const WATER_DAY   = { deep: 0x0d3c55, shallow: 0x37a7ab, foam: 0xf2f8f6 };
const WATER_NIGHT = { deep: 0x050c1a, shallow: 0x123a48, foam: 0x8fa6b8 };

/* ────────────────────────────────────────────────────────────────
   Small helpers
   ──────────────────────────────────────────────────────────────── */

const clampI = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Squared distance from (x,z) to a polyline, without the sqrt until the end. */
function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1];
    const bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx - x, pz = az + t * dz - z;
    const d = px * px + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * Seeded 3D gradient noise, local to this module.
 * Only used to sculpt boulders — it never has to agree with the heightfield,
 * so it does not belong in noise.js.
 */
function makeNoise3(rng) {
  const P = new Uint8Array(512);
  const q = new Uint8Array(256);
  for (let i = 0; i < 256; i++) q[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = q[i]; q[i] = q[j]; q[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = q[i & 255];

  const GR = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  ];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lp = (a, b, t) => a + (b - a) * t;
  const g = (h, x, y, z) => {
    const v = GR[h % 12];
    return v[0] * x + v[1] * y + v[2] * z;
  };

  return function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const X = xi & 255, Y = yi & 255, Z = zi & 255;
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);

    const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
    const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;

    const x1 = lp(g(P[AA], xf, yf, zf), g(P[BA], xf - 1, yf, zf), u);
    const x2 = lp(g(P[AB], xf, yf - 1, zf), g(P[BB], xf - 1, yf - 1, zf), u);
    const x3 = lp(g(P[AA + 1], xf, yf, zf - 1), g(P[BA + 1], xf - 1, yf, zf - 1), u);
    const x4 = lp(g(P[AB + 1], xf, yf - 1, zf - 1), g(P[BB + 1], xf - 1, yf - 1, zf - 1), u);

    return lp(lp(x1, x2, v), lp(x3, x4, v), w) * 1.15;
  };
}

/** Separable box blur over a square grid. Used for the cheap curvature/AO term. */
function blurGrid(src, w, radius) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const n = radius * 2 + 1;

  for (let j = 0; j < w; j++) {
    const row = j * w;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += src[row + clampI(i, 0, w - 1)];
    for (let i = 0; i < w; i++) {
      tmp[row + i] = sum / n;
      sum += src[row + clampI(i + radius + 1, 0, w - 1)] - src[row + clampI(i - radius, 0, w - 1)];
    }
  }
  for (let i = 0; i < w; i++) {
    let sum = 0;
    for (let j = -radius; j <= radius; j++) sum += tmp[clampI(j, 0, w - 1) * w + i];
    for (let j = 0; j < w; j++) {
      out[j * w + i] = sum / n;
      sum += tmp[clampI(j + radius + 1, 0, w - 1) * w + i] - tmp[clampI(j - radius, 0, w - 1) * w + i];
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────
   Water shaders
   ──────────────────────────────────────────────────────────────── */

const WATER_COMMON = /* glsl */ `
  uniform sampler2D uHeightMap;
  uniform vec2  uMapMin;
  uniform float uMapStep;
  uniform float uMapRes;
  uniform float uSeaLevel;

  // Terrain height under a world-space XZ point, from the baked heightfield.
  // Outside the terrain tile the texture clamps to its edge, which is open sea.
  float terrainH(vec2 p) {
    vec2 gi = (p - uMapMin) / uMapStep;
    vec2 uv = clamp((gi + 0.5) / uMapRes, vec2(0.0), vec2(1.0));
    return texture2D(uHeightMap, uv).r;
  }
`;

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uWaveAmp;
  uniform float uWaveScale;

  varying vec3 vWorld;
  varying vec2 vSwell;

  #include <fog_pars_vertex>
` + WATER_COMMON + /* glsl */ `
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);

    // Swell dies in the shallows (water cannot be 40cm deep and 40cm tall) and
    // dies again far out, so the coarse horizon triangles stay flat.
    float depth = uSeaLevel - terrainH(wp.xz);
    float shore = smoothstep(0.15, 4.0, depth);
    float far   = 1.0 - smoothstep(240.0, 340.0, length(wp.xz));
    float amp   = uWaveAmp * shore * far;

    vec2 d1 = vec2( 0.860,  0.510);
    vec2 d2 = vec2(-0.420,  0.907);
    vec2 d3 = vec2( 0.150, -0.989);

    float k1 = 6.2831853 / (46.0 * uWaveScale);
    float k2 = 6.2831853 / (27.0 * uWaveScale);
    float k3 = 6.2831853 / (15.0 * uWaveScale);

    float p1 = dot(wp.xz, d1) * k1 - uTime * 1.05;
    float p2 = dot(wp.xz, d2) * k2 - uTime * 1.45;
    float p3 = dot(wp.xz, d3) * k3 - uTime * 1.95;

    float a1 = amp, a2 = amp * 0.55, a3 = amp * 0.26;

    wp.y += a1 * sin(p1) + a2 * sin(p2) + a3 * sin(p3);

    // Gerstner lateral pinch — crests sharpen, troughs broaden.
    wp.xz -= (a1 * cos(p1) * d1 * 0.45 + a2 * cos(p2) * d2 * 0.32);

    // Analytic slope of the swell, handed to the fragment stage so the big
    // waves shade correctly without needing geometric normals.
    vSwell = a1 * cos(p1) * k1 * d1
           + a2 * cos(p2) * k2 * d2
           + a3 * cos(p3) * k3 * d3;

    vWorld = wp.xyz;

    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3  uDeep;
  uniform vec3  uShallow;
  uniform vec3  uFoam;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform vec3  uSkyColor;
  uniform vec3  uHorizonColor;
  uniform float uRipple;
  uniform float uFoamWidth;
  uniform float uFoamAmt;
  uniform float uSunSpec;
  uniform float uReflect;
  uniform float uOpacityMin;

  varying vec3 vWorld;
  varying vec2 vSwell;

  #include <fog_pars_fragment>
` + WATER_COMMON + /* glsl */ `
  float wh21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float wvn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = wh21(i);
    float b = wh21(i + vec2(1.0, 0.0));
    float c = wh21(i + vec2(0.0, 1.0));
    float d = wh21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  /**
   * Fine ripples as a sum of six domain-rotated sines with analytic gradients.
   * Cheaper than noise-based normals and, because amplitude*frequency is held
   * roughly constant per octave, it does not degenerate into sparkle soup.
   */
  vec3 rippleNormal(vec2 p, float t, float strength) {
    vec2 grad = vec2(0.0);
    float amp = 1.0;
    float freq = 0.085;
    float ang = 0.9;
    vec2 q = p;
    for (int i = 0; i < 6; i++) {
      vec2 dir = vec2(cos(ang), sin(ang));
      float ph = dot(q, dir) * freq + t * (0.6 + float(i) * 0.35);
      grad += amp * cos(ph) * freq * dir;
      q += dir * sin(ph) * 0.7;
      amp *= 0.52;
      freq *= 1.85;
      ang += 2.3999632;
    }
    return normalize(vec3(-grad.x * strength, 1.0, -grad.y * strength));
  }

  void main() {
    float depth = max(uSeaLevel - terrainH(vWorld.xz), 0.0);

    vec3  toCam  = cameraPosition - vWorld;
    float camDst = length(toCam);
    vec3  V      = toCam / max(camDst, 1e-4);

    // Fade the ripple normal with distance or the horizon turns into aliasing.
    float rip = 1.0 - smoothstep(40.0, 260.0, camDst);
    vec3 N = rippleNormal(vWorld.xz, uTime * 0.55, uRipple * (0.22 + 0.78 * rip));
    N = normalize(vec3(N.x - vSwell.x * 1.4, N.y, N.z - vSwell.y * 1.4));

    float ndv  = max(dot(N, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

    float d01 = smoothstep(0.15, 7.0, depth);
    vec3  body = mix(uShallow, uDeep, d01);

    vec3 R = reflect(-V, N);
    vec3 sky = mix(uHorizonColor, uSkyColor, smoothstep(0.0, 0.45, R.y));

    vec3  L = normalize(uSunDir);
    vec3  H = normalize(L + V);
    float ndh = max(dot(N, H), 0.0);
    float sunUp = smoothstep(-0.14, 0.10, L.y);
    float spec  = pow(ndh, 140.0) * 0.55 + pow(ndh, 900.0) * 2.2;

    // The body colour is a PIGMENT, not a radiance, so it has to be lit. Without
    // this the sea keeps its tropical-noon turquoise straight through golden hour
    // and into the night, glowing next to an island that has gone dark — the
    // day/night lerp on uDeep/uShallow only changes the hue, never the exposure.
    // Weighted so the product lands near 1.0 with a high sun, which leaves the
    // midday sea exactly where it was.
    vec3 lit = body * (uSkyColor * 0.55 + uSunColor * (0.12 + 0.55 * sunUp * max(L.y, 0.0)));

    vec3 col = mix(lit, sky, clamp(fres * uReflect, 0.0, 1.0));
    col += uSunColor * spec * uSunSpec * sunUp;

    // Shallow-water forward scatter: the sea glows when you look toward the sun.
    col += uShallow * uSunColor * 0.22 * (1.0 - d01) * max(dot(V, -L), 0.0) * sunUp;

    // ── shoreline foam ──────────────────────────────────────────
    // The band breathes in and out so the surf advances and retreats.
    float tide = 0.34 * sin(uTime * 0.55) + 0.16 * sin(uTime * 0.21 + 1.7);
    float band = 1.0 - smoothstep(0.0, uFoamWidth, depth + tide);
    float n1 = wvn(vWorld.xz * 0.55 + vec2(uTime * 0.12, -uTime * 0.08));
    float n2 = wvn(vWorld.xz * 1.70 - vec2(uTime * 0.30,  uTime * 0.22));
    float foam = smoothstep(0.42, 0.86, band * (0.62 + 0.55 * n1 + 0.28 * n2));
    float lip  = (1.0 - smoothstep(0.0, 0.40, depth)) * (0.45 + 0.55 * n2);
    foam = clamp(max(foam, lip), 0.0, 1.0) * uFoamAmt;

    col = mix(col, uFoam, foam);

    // Nearly clear over wet sand, opaque once there is water to look through.
    float alpha = mix(uOpacityMin, 1.0, smoothstep(0.05, 2.6, depth));
    alpha = clamp(max(alpha, foam * 0.95), 0.0, 1.0);

    gl_FragColor = vec4(col, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/* ────────────────────────────────────────────────────────────────
   Factory
   ──────────────────────────────────────────────────────────────── */

/**
 * @param {object}   opts
 * @param {number}   opts.seed
 * @param {object}   opts.quality   one of config.QUALITY
 * @param {Function} [opts.carve]   (x, z, y) => y — ponds carve their basins in here
 * @param {Function} [opts.isInPond](x, z) => bool  — keeps boulders out of the ponds
 */
export function createIsland({ seed = 1337, quality = null, carve = null, isInPond = null } = {}) {
  const SIZE = WORLD.size;
  const HALF = SIZE * 0.5;
  const SEG = quality && quality.label === 'low' ? 224
            : quality && quality.label === 'high' ? 288
            : WORLD.segments;
  const W = SEG + 1;
  const STEP = SIZE / SEG;
  const SEA = WORLD.seaLevel;
  const ISLAND_R = SIZE * 0.385;

  const rngRock = streamFor(seed, 'island:rocks');
  const rngShape = streamFor(seed, 'island:rockshapes');
  const noise3 = makeNoise3(streamFor(seed, 'island:boulder-noise'));

  const hasCarve = typeof carve === 'function';

  /* ── 1. the heightfield, as one analytic function ──────────── */

  function analyticHeight(x, z) {
    // Coarse domain warp -> headlands and bays instead of a disc.
    const wf = 0.0090;
    const wx = x + 19.0 * noise2(x * wf + 41.7, z * wf - 12.3);
    const wz = z + 19.0 * noise2(x * wf - 27.1, z * wf + 63.9);

    // Slightly elliptical so the island has a long axis.
    let d = Math.sqrt(wx * wx * 1.06 + wz * wz * 0.88) / ISLAND_R;
    // Fine wobble on the radius itself -> coves.
    d += 0.075 * fbm2(x * 0.0165 + 5.5, z * 0.0165 - 9.1, 3);

    const mask = sstep(1.10, 0.35, d); // 1 inland .. 0 open sea

    let land = 0;
    if (mask > 0.002) {
      const b = fbm2(x * 0.0070 + 1.7, z * 0.0070 - 3.1, 5) * 0.5 + 0.5;
      land = 9.5 * Math.pow(b, 1.35);
      land += 3.0 * fbm2(x * 0.0210 - 8.4, z * 0.0210 + 2.2, 4);
      land += 0.85 * fbm2(x * 0.0720 + 6.1, z * 0.0720 + 4.3, 3);

      // Dominant ridge, as a curved spine rather than a cone.
      const dr = distToPolyline(x, z, RIDGE_PTS);
      if (dr < RIDGE_W * 3.0) {
        const g = Math.exp(-(dr * dr) / (2 * RIDGE_W * RIDGE_W));
        const along = 0.55 + 0.45 * (fbm2(x * 0.0125 + 11.0, z * 0.0125 - 5.0, 3) * 0.5 + 0.5);
        land += RIDGE_H * Math.pow(g, 1.25) * along;
        land += 2.4 * g * ridged2(x * 0.055, z * 0.055, 3);
      }

      // Secondary hills.
      for (let i = 0; i < BUMPS.length; i++) {
        const B = BUMPS[i];
        const dx = x - B.x, dz = z - B.z;
        const dd = dx * dx + dz * dz;
        const s = B.r * 0.55;
        if (dd < B.r * B.r * 6.0) land += B.h * Math.exp(-dd / (2 * s * s));
      }
    }

    // Land above water, seabed below, with the mask driving the transition.
    let y = land * Math.pow(mask, 1.30) - 9.0 * (1 - mask);
    if (mask < 0.985) {
      y += (1 - mask) * 1.7 * fbm2(x * 0.026 + 3.3, z * 0.026 - 7.7, 3);
    }

    // Flat shelf for the grove. Multiplied by the mask so it never cuts the coast.
    const mdx = x - MEADOW.x, mdz = z - MEADOW.z;
    const md = Math.sqrt(mdx * mdx + mdz * mdz);
    if (md < MEADOW.r) {
      const w = sstep(MEADOW.r, MEADOW.r * 0.40, md) * MEADOW.strength * mask;
      const flat = MEADOW.y + 1.1 * fbm2(x * 0.035 - 14.2, z * 0.035 + 6.6, 3);
      y = mix(y, flat, w);
    }

    // Beach: compress heights toward sea level so sand and shelf get room.
    y -= BEACH_SOFT * y * Math.exp(-(y * y) / (BEACH_WIDTH * BEACH_WIDTH));

    // A little dune texture, only in the sand band.
    if (y > -3.2 && y < 3.2) {
      y += Math.exp(-(y * y) / 9.0) * 0.34 * fbm2(x * 0.090 + 30.1, z * 0.090 - 17.4, 2);
    }

    // Ponds carve their basins into the same field, by construction.
    if (hasCarve) {
      const c = carve(x, z, y);
      if (Number.isFinite(c)) y = c;
    }

    return y;
  }

  /* ── 2. bake the grid ──────────────────────────────────────── */

  const grid = new Float32Array(W * W);
  for (let j = 0; j < W; j++) {
    const z = -HALF + j * STEP;
    const row = j * W;
    for (let i = 0; i < W; i++) {
      grid[row + i] = analyticHeight(-HALF + i * STEP, z);
    }
  }

  /**
   * Ground height at a world point.
   * Inside the tile this interpolates the exact triangles PlaneGeometry builds
   * (its diagonal runs from (col, row+1) to (col+1, row)), so props sit on the
   * rendered surface, not on the ideal one. Outside, it falls back to analytic.
   */
  function heightAt(x, z) {
    const gx = (x + HALF) / STEP;
    const gz = (z + HALF) / STEP;
    if (gx < 0 || gz < 0 || gx > SEG || gz > SEG) return analyticHeight(x, z);

    const c = Math.min(SEG - 1, gx | 0);
    const r = Math.min(SEG - 1, gz | 0);
    const fx = gx - c, fz = gz - r;

    const i00 = r * W + c;
    const h00 = grid[i00];
    const h10 = grid[i00 + 1];
    const h01 = grid[i00 + W];
    const h11 = grid[i00 + W + 1];

    if (fx + fz <= 1.0) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1.0 - fx) + (h10 - h11) * (1.0 - fz);
  }

  const _n = new THREE.Vector3();

  /** Surface normal at a world point. */
  function normalAt(x, z, out = _n) {
    const e = STEP;
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }

  /** 0 = dead flat, 1 = vertical. Same convention as WORLD.grassMaxSlope. */
  function slopeAt(x, z) {
    const e = STEP;
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return 1 - 1 / Math.sqrt(dx * dx + dz * dz + 1);
  }

  /* ── 3. terrain mesh ───────────────────────────────────────── */

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  // Cheap curvature term: height minus a wide blur of itself. Hollows darken,
  // ridges catch light. This single line is what stops vertex-coloured terrain
  // from looking like flat paper.
  const blurred = blurGrid(grid, W, Math.max(3, Math.round(7 / STEP)));

  const cA = new THREE.Color();
  const cB = new THREE.Color();
  const cRock = new THREE.Color();

  const C_SEABED = new THREE.Color(PAL.seabed);
  const C_WET = new THREE.Color(PAL.sandWet);
  const C_DRY = new THREE.Color(PAL.sandDry);
  const C_G1 = new THREE.Color(PAL.grassLow);
  const C_G2 = new THREE.Color(PAL.grassMid);
  const C_G3 = new THREE.Color(PAL.grassHigh);
  const C_ROCK = new THREE.Color(PAL.rock);
  const C_ROCKD = new THREE.Color(PAL.rockDark);

  for (let v = 0; v < count; v++) {
    const x = pos.getX(v);
    const z = pos.getZ(v);
    const i = clampI(Math.round((x + HALF) / STEP), 0, SEG);
    const j = clampI(Math.round((z + HALF) / STEP), 0, SEG);
    const k = j * W + i;
    const h = grid[k];

    pos.setY(v, h);

    // Slope straight from the grid — cheaper and exactly consistent.
    const hl = grid[j * W + clampI(i - 1, 0, SEG)];
    const hr = grid[j * W + clampI(i + 1, 0, SEG)];
    const hd = grid[clampI(j - 1, 0, SEG) * W + i];
    const hu = grid[clampI(j + 1, 0, SEG) * W + i];
    const dx = (hr - hl) / (2 * STEP);
    const dz = (hu - hd) / (2 * STEP);
    const slope = 1 - 1 / Math.sqrt(dx * dx + dz * dz + 1);

    // Break the bands so they never read as contour lines.
    const cn = fbm2(x * 0.062 + 71.3, z * 0.062 - 22.9, 3);
    const cn2 = fbm2(x * 0.011 - 4.4, z * 0.011 + 9.8, 2);
    const hj = h + cn * 0.55;

    // wet sand -> dry sand
    cA.copy(C_WET).lerp(C_DRY, sstep(-1.1, 0.95, hj));
    // sand -> meadow grass, keyed to where grass is actually allowed to grow
    cA.lerp(C_G1, sstep(WORLD.beachTop * 0.55, WORLD.beachTop + 1.35, hj));
    // meadow -> mid grass -> upland grass
    cA.lerp(C_G2, sstep(4.5, 12.0, hj + cn2 * 1.6));
    cA.lerp(C_G3, sstep(WORLD.grassTop * 0.62, WORLD.grassTop + 4.0, hj));
    // seabed, so shallow water reads turquoise over sand and dark further out
    cA.lerp(C_SEABED, sstep(-1.2, -6.5, h));

    // Rock takes over on slopes, exactly where grass gives up.
    cRock.copy(C_ROCK).lerp(C_ROCKD, sstep(0.55, 0.92, slope + cn * 0.05));
    cA.lerp(cRock, sstep(WORLD.grassMaxSlope - 0.16, WORLD.grassMaxSlope + 0.12, slope + cn * 0.06));

    // Curvature shading + grain.
    const ao = sstep(-2.6, 2.0, h - blurred[k]);
    const shade = mix(0.74, 1.08, ao) * (1 + 0.075 * cn);

    const o = v * 3;
    colors[o] = cA.r * shade;
    colors[o + 1] = cA.g * shade;
    colors[o + 2] = cA.b * shade;
  }

  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.0,
  });

  // Sub-vertex grain. Vertex colours alone are ~0.75m resolution, which reads as
  // soft blobs up close; this puts texture back without a single fetched image.
  terrainMat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vTerrW;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\tvTerrW = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    );
    shader.fragmentShader = /* glsl */ `
      varying vec3 vTerrW;
      float th21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float tvn(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(th21(i), th21(i + vec2(1.0, 0.0)), f.x),
                   mix(th21(i + vec2(0.0, 1.0)), th21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
    ` + shader.fragmentShader.replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
      {
        vec2 q = vTerrW.xz;
        float g = tvn(q * 0.85) * 0.5 + tvn(q * 2.7) * 0.3 + tvn(q * 7.6) * 0.2;
        diffuseColor.rgb *= 0.88 + 0.26 * g;
        float warm = tvn(q * 0.11);
        diffuseColor.rgb *= mix(vec3(0.96, 0.99, 1.02), vec3(1.06, 1.02, 0.92), warm);
      }`
    );
  };
  terrainMat.customProgramCacheKey = () => 'sakurajima-terrain-v1';

  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.name = 'terrain';
  terrain.receiveShadow = true;
  terrain.castShadow = true; // long ridge shadows at sunrise/sunset are the point
  terrain.matrixAutoUpdate = false;
  terrain.updateMatrix();

  /* ── 4. heightfield as a texture, for the water shader ─────── */

  const hData = new Uint16Array(W * W);
  for (let k = 0; k < W * W; k++) hData[k] = THREE.DataUtils.toHalfFloat(grid[k]);

  const heightTex = new THREE.DataTexture(hData, W, W, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.wrapS = THREE.ClampToEdgeWrapping;
  heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.generateMipmaps = false;
  heightTex.unpackAlignment = 2; // 2 bytes per texel; W is odd, so 4 would misalign rows
  heightTex.needsUpdate = true;

  /* ── 5. ocean ──────────────────────────────────────────────── */

  /**
   * A polar disc, not a square plane: ~2m tessellation at the shoreline where
   * the swell silhouette matters, stretching to 2.5km for the horizon, in one
   * draw call with no overlapping seam to double-blend.
   */
  function makeOceanDisc(rings, spokes, nearR, farR) {
    const vCount = 1 + rings * spokes;
    const verts = new Float32Array(vCount * 3);
    for (let k = 1; k <= rings; k++) {
      const t = k / rings;
      const r = nearR * t + farR * Math.pow(t, 5);
      for (let s = 0; s < spokes; s++) {
        const a = (s / spokes) * TAU;
        const o = (1 + (k - 1) * spokes + s) * 3;
        verts[o] = Math.cos(a) * r;
        verts[o + 1] = 0;
        verts[o + 2] = Math.sin(a) * r;
      }
    }
    // Winding matters here and is easy to get backwards. Spokes advance with
    // increasing angle, i.e. +x towards +z, and for a surface whose normal must
    // point at the sky that traversal has to be listed CLOCKWISE seen from above
    // — the opposite of what reads naturally when you write the loop. Getting it
    // wrong points every face at the seabed, and with `side: FrontSide` the whole
    // ocean is back-face culled: the sea silently vanishes and you are left
    // looking at the bare seabed wondering why the shader draws nothing.
    const idx = [];
    for (let s = 0; s < spokes; s++) {
      idx.push(0, 1 + ((s + 1) % spokes), 1 + s);
    }
    for (let k = 0; k < rings - 1; k++) {
      const a0 = 1 + k * spokes;
      const b0 = 1 + (k + 1) * spokes;
      for (let s = 0; s < spokes; s++) {
        const s1 = (s + 1) % spokes;
        idx.push(a0 + s, a0 + s1, b0 + s);
        idx.push(a0 + s1, b0 + s1, b0 + s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    g.computeBoundingSphere();
    return g;
  }

  const waterUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
  Object.assign(waterUniforms, {
    uTime: { value: 0 },
    uHeightMap: { value: heightTex },
    uMapMin: { value: new THREE.Vector2(-HALF, -HALF) },
    uMapStep: { value: STEP },
    uMapRes: { value: W },
    uSeaLevel: { value: SEA },
    uWaveAmp: { value: 0.42 },
    uWaveScale: { value: 1.0 },
    uRipple: { value: 1.05 },
    uFoamWidth: { value: 1.9 },
    uFoamAmt: { value: 0.85 },
    uSunSpec: { value: 1.0 },
    uReflect: { value: 1.0 },
    uOpacityMin: { value: 0.14 },
    uDeep: { value: new THREE.Color(WATER_DAY.deep) },
    uShallow: { value: new THREE.Color(WATER_DAY.shallow) },
    uFoam: { value: new THREE.Color(WATER_DAY.foam) },
    uSunDir: { value: new THREE.Vector3(0.45, 0.62, 0.35).normalize() },
    uSunColor: { value: new THREE.Color(0xfff0d8) },
    uSkyColor: { value: new THREE.Color(0x7fb0e8) },
    uHorizonColor: { value: new THREE.Color(0xcfe2f2) },
  });

  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.FrontSide,
  });

  const waterGeo = makeOceanDisc(180, 256, 300, 2200);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.name = 'ocean';
  water.position.y = SEA;
  water.renderOrder = 1;
  water.frustumCulled = false; // it surrounds the camera; culling it is always wrong
  water.matrixAutoUpdate = false;
  water.updateMatrix();

  /* ── 6. boulders ───────────────────────────────────────────── */

  /** One believable boulder: an icosahedron beaten up by 3 octaves of 3D noise. */
  function makeBoulder(detail, rng) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.attributes.position;
    const n = p.count;
    const cols = new Float32Array(n * 3);

    const ox = rng() * 100, oy = rng() * 100, oz = rng() * 100;
    const squashY = 0.52 + rng() * 0.46;
    const squashZ = 0.80 + rng() * 0.48;
    const lean = (rng() - 0.5) * 0.34;
    const rough = 0.22 + rng() * 0.20;

    const v = new THREE.Vector3();
    const c = new THREE.Color();
    const moss = new THREE.Color(0.60, 0.86, 0.44);

    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p, i);
      const nx = v.x, ny = v.y, nz = v.z; // unit sphere already

      let r = 1.0;
      r += rough * noise3(nx * 1.7 + ox, ny * 1.7 + oy, nz * 1.7 + oz);
      r += rough * 0.52 * noise3(nx * 3.9 + ox * 2, ny * 3.9 + oy * 2, nz * 3.9 + oz * 2);
      r += rough * 0.22 * noise3(nx * 8.6 + ox * 3, ny * 8.6 + oy * 3, nz * 8.6 + oz * 3);

      v.set(nx * r, ny * r * squashY, nz * r * squashZ);
      // Flattish base so it beds into the ground instead of balancing on a point.
      if (v.y < -0.30) v.y = -0.30 + (v.y + 0.30) * 0.40;
      v.x += v.y * lean;
      p.setXYZ(i, v.x, v.y, v.z);

      // Baked lighting cues: strata, crevice darkening, moss on upward faces.
      const strata = 0.5 + 0.5 * noise3(v.x * 1.2 + 4.0, v.y * 6.0, v.z * 1.2 - 2.0);
      const cav = clamp((r - 0.90) / 0.32, 0, 1);
      let s = mix(0.88, 1.07, strata) * mix(0.70, 1.06, cav);

      const up = clamp((ny * r) / Math.max(r, 1e-4), -1, 1);
      const mossAmt = sstep(0.34, 0.86, up) * (0.35 + 0.65 * (0.5 + 0.5 *
        noise3(v.x * 2.2 - 9.0, v.y * 2.2, v.z * 2.2 + 5.0)));

      c.setRGB(s, s, s).lerp(moss, mossAmt * 0.5 * s);
      const o = i * 3;
      cols[o] = c.r; cols[o + 1] = c.g; cols[o + 2] = c.b;
    }

    p.needsUpdate = true;
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  const SHAPE_DETAIL = [1, 2, 1, 2, 2, 1];
  const shapes = SHAPE_DETAIL.map((d) => makeBoulder(d, rngShape));

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.93,
    metalness: 0.0,
    flatShading: true,
  });

  const ROCK_TOTAL = quality && quality.rocks ? quality.rocks : 100;
  const SEA_STACKS = 5;

  /** Rejection-sample positions biased to the shoreline and to steep ground. */
  const placed = [];
  const maxR = ISLAND_R * 1.30;

  function tooClose(x, z, minD) {
    for (let i = 0; i < placed.length; i++) {
      const dx = placed[i].x - x, dz = placed[i].z - z;
      if (dx * dx + dz * dz < minD * minD) return true;
    }
    return false;
  }

  let guard = 0;
  while (placed.length < ROCK_TOTAL - SEA_STACKS && guard < ROCK_TOTAL * 600) {
    guard++;
    const a = rngRock() * TAU;
    const rr = Math.sqrt(rngRock()) * maxR;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;

    const h = heightAt(x, z);
    if (h < -3.4 || h > WORLD.maxHeight * 0.78) continue;
    if (isInPond && isInPond(x, z)) continue;

    const s = slopeAt(x, z);
    const dh = h - 0.4;
    const shoreW = Math.exp(-(dh * dh) / (2 * 2.2 * 2.2)); // surf line
    const slopeW = sstep(0.30, 0.66, s);                    // scree on cliffs
    const w = clamp(shoreW * 0.85 + slopeW * 0.90 + 0.06, 0, 1);
    if (rngRock() > w) continue;

    // Mostly spaced out, occasionally clustered — clusters read as fallen scree.
    const minD = rngRock() < 0.22 ? 1.6 : 4.2;
    if (tooClose(x, z, minD)) continue;

    placed.push({ x, z, h, slope: s, stack: false });
  }

  // A handful of sea stacks just offshore. Pure silhouette value at sunset.
  let sguard = 0;
  while (placed.filter((p) => p.stack).length < SEA_STACKS && sguard < 6000) {
    sguard++;
    const a = rngRock() * TAU;
    const rr = ISLAND_R * (0.72 + rngRock() * 0.42);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const h = heightAt(x, z);
    if (h < -3.0 || h > -0.15) continue;
    if (tooClose(x, z, 22)) continue;
    placed.push({ x, z, h, slope: slopeAt(x, z), stack: true });
  }

  // Split the placements across the distinct shapes.
  const buckets = shapes.map(() => []);
  for (const p of placed) {
    const idx = p.stack
      ? (rngRock() < 0.5 ? 1 : 4)                       // the beefier silhouettes
      : Math.floor(rngRock() * shapes.length) % shapes.length;
    buckets[idx].push(p);
  }

  const rockMeshes = [];
  const rockKeepOut = [];

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _qy = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _nrm = new THREE.Vector3();
  const _col = new THREE.Color();

  for (let b = 0; b < buckets.length; b++) {
    const list = buckets[b];
    if (list.length === 0) continue;

    const im = new THREE.InstancedMesh(shapes[b], rockMat, list.length);
    im.name = `boulders-${b}`;
    im.castShadow = true;
    im.receiveShadow = true;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];

      let base = p.stack
        ? 3.2 + rngRock() * 2.8
        : mix(0.45, 2.5, Math.pow(rngRock(), 2.0));
      if (!p.stack && rngRock() < 0.07) base *= 1.9; // the occasional hero rock

      const sx = base * (0.86 + rngRock() * 0.30);
      const sy = base * (p.stack ? 1.25 + rngRock() * 0.9 : 0.72 + rngRock() * 0.42);
      const sz = base * (0.86 + rngRock() * 0.30);

      // Tilt partly with the ground so rocks bed in rather than stand to attention.
      normalAt(p.x, p.z, _nrm);
      _nrm.lerp(_up, 0.45).normalize();
      _q.setFromUnitVectors(_up, _nrm);
      _qy.setFromAxisAngle(_up, rngRock() * TAU);
      _q.multiply(_qy);

      const sink = p.stack ? 0.18 + rngRock() * 0.12 : 0.26 + rngRock() * 0.30;
      _p.set(p.x, p.h - sy * sink, p.z);
      _s.set(sx, sy, sz);

      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);

      // Wet rock below the tideline is markedly darker; that contrast sells the surf.
      _col.setHSL(0.085 + (rngRock() - 0.5) * 0.05, 0.05 + rngRock() * 0.08, 0.40 + rngRock() * 0.15);
      if (p.h < 0.9) _col.multiplyScalar(mix(0.55, 1.0, clamp((p.h + 1.2) / 2.1, 0, 1)));
      im.setColorAt(i, _col);

      rockKeepOut.push({ x: p.x, z: p.z, r: Math.max(sx, sz) * 1.15 });
    }

    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    rockMeshes.push(im);
  }

  /* ── 7. assembly ───────────────────────────────────────────── */

  const group = new THREE.Group();
  group.name = 'island';
  group.add(terrain, water, ...rockMeshes);

  /* ── 8. day/night wiring ───────────────────────────────────── */

  const DEEP_D = new THREE.Color(WATER_DAY.deep);
  const SHAL_D = new THREE.Color(WATER_DAY.shallow);
  const FOAM_D = new THREE.Color(WATER_DAY.foam);
  const DEEP_N = new THREE.Color(WATER_NIGHT.deep);
  const SHAL_N = new THREE.Color(WATER_NIGHT.shallow);
  const FOAM_N = new THREE.Color(WATER_NIGHT.foam);

  const _sun = new THREE.Vector3(0.45, 0.62, 0.35).normalize();

  /**
   * @param {number} t      elapsed seconds
   * @param {object} phase  from sky.update(). Every field is optional:
   *   { sunDirection|sunDir|sunPosition, sunColor, skyColor|zenithColor,
   *     horizonColor|fogColor, daylight|dayFactor, dayTime }
   */
  function update(t, phase) {
    const u = waterUniforms;
    u.uTime.value = t;

    if (!phase) return;

    const dir = phase.sunDirection || phase.sunDir || phase.sunPosition || null;
    if (dir && Number.isFinite(dir.x)) {
      _sun.set(dir.x, dir.y, dir.z);
      if (_sun.lengthSq() > 1e-6) u.uSunDir.value.copy(_sun.normalize());
    } else if (Number.isFinite(phase.dayTime)) {
      // Fallback so the water still reads correctly if sky reports only a clock.
      const a = (phase.dayTime - 0.25) * TAU;
      u.uSunDir.value.set(Math.cos(a) * 0.6, Math.sin(a), 0.36).normalize();
    }

    if (phase.sunColor) u.uSunColor.value.copy(phase.sunColor);
    if (phase.skyColor || phase.zenithColor) u.uSkyColor.value.copy(phase.skyColor || phase.zenithColor);
    if (phase.horizonColor || phase.fogColor) u.uHorizonColor.value.copy(phase.horizonColor || phase.fogColor);

    const day = Number.isFinite(phase.daylight) ? phase.daylight
              : Number.isFinite(phase.dayFactor) ? phase.dayFactor
              : sstep(-0.14, 0.16, u.uSunDir.value.y);

    u.uDeep.value.copy(DEEP_N).lerp(DEEP_D, day);
    u.uShallow.value.copy(SHAL_N).lerp(SHAL_D, day);
    u.uFoam.value.copy(FOAM_N).lerp(FOAM_D, day);

    // At night the sea is a mirror; at noon you see into it.
    u.uReflect.value = mix(1.25, 0.92, day);
    u.uSunSpec.value = mix(0.35, 1.0, day);

    // `uOpacityMin` is the alpha at the very waterline, where the sheet is a
    // centimetre deep; the shader ramps it to fully opaque by ~2.6 units down.
    // It used to bottom out near 0.14, which around a small island reads as wet
    // sand stretching to the horizon rather than as sea — you see the seabed
    // through everything and the shallow tint never gets a chance to register.
    // Keep just enough transparency at the edge for the surf to sit on damp
    // sand. This curve is the ocean's only opacity control: anything set on the
    // uniform from outside is overwritten here on the next frame.
    u.uOpacityMin.value = mix(0.86, 0.68, day);
  }

  function dispose() {
    geo.dispose();
    terrainMat.dispose();
    waterGeo.dispose();
    waterMat.dispose();
    heightTex.dispose();
    rockMat.dispose();
    shapes.forEach((s) => s.dispose());
    rockMeshes.forEach((m) => m.dispose());
  }

  /** Nearest baked ground colour — grass and fallen petals can tint to match. */
  function colorAt(x, z, target = new THREE.Color()) {
    const i = clampI(Math.round((x + HALF) / STEP), 0, SEG);
    const j = clampI(Math.round((z + HALF) / STEP), 0, SEG);
    const v = (j * W + i) * 3;
    return target.setRGB(colors[v], colors[v + 1], colors[v + 2]);
  }

  return {
    group,
    terrain,
    water,
    heightAt,
    slopeAt,
    normalAt,
    colorAt,
    update,
    dispose,
    /** Useful to the scatter systems. */
    seaLevel: SEA,
    radius: ISLAND_R,
    extent: HALF,
    meadow: { ...MEADOW },
    rockKeepOut,
    waterUniforms,
  };
}

export default createIsland;
