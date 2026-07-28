/**
 * noise.js — the single source of truth for all randomness in the scene.
 *
 * Two hard rules that everything else depends on:
 *
 *  1. NOTHING calls Math.random(). Every random value comes from a seeded
 *     mulberry32 stream, so the island is byte-identical on every reload.
 *     (You cannot art-direct a world that reshuffles itself every refresh.)
 *
 *  2. Terrain height is computed by exactly ONE function, `fbm2`, used both
 *     to build the terrain mesh and to answer `heightAt(x, z)` for placing
 *     trees / grass / rocks. If those two ever diverge, props float above the
 *     ground or sink into it. There is deliberately no second implementation.
 *
 * CPU noise here is gradient (Perlin-style) noise over a seeded permutation
 * table — stable, no `sin()`-hash precision games, and identical across
 * machines because it only uses integer indexing and float64 lerps.
 *
 * The GLSL exported at the bottom is intentionally a *different*, cheaper
 * hash-based noise: it only drives wind motion, where the GPU is the
 * authority and nothing needs to agree with the CPU to sub-pixel accuracy.
 * Trying to bit-match float64 CPU noise against float32 GPU noise is a trap.
 */

/* ────────────────────────────────────────────────────────────────
   Seeded PRNG
   ──────────────────────────────────────────────────────────────── */

/** mulberry32 — small, fast, statistically fine for scattering props. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive an independent stream from a seed + a string tag.
 * Lets each subsystem own its own stream, so adding one rock does not
 * reshuffle every tree on the island.
 */
export function streamFor(seed, tag) {
  let h = seed >>> 0;
  for (let i = 0; i < tag.length; i++) {
    h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193) >>> 0;
  }
  return mulberry32(h);
}

/** Convenience helpers built on a raw rng(). */
export const R = {
  range: (rng, lo, hi) => lo + (hi - lo) * rng(),
  int: (rng, lo, hi) => Math.floor(lo + (hi - lo + 1) * rng()),
  pick: (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length],
  sign: (rng) => (rng() < 0.5 ? -1 : 1),
  /** Bias toward the low end when k>1, toward the high end when k<1. */
  skew: (rng, lo, hi, k) => lo + (hi - lo) * Math.pow(rng(), k),
  /** Roughly gaussian via the central limit theorem — nicer than uniform for scale jitter. */
  gauss: (rng, mean = 0, dev = 1) =>
    mean + dev * ((rng() + rng() + rng() + rng() + rng() + rng() - 3) / 1.5),
};

/* ────────────────────────────────────────────────────────────────
   Gradient noise (CPU, authoritative for terrain)
   ──────────────────────────────────────────────────────────────── */

const PERM = new Uint8Array(512);
const GRAD2 = new Float32Array(512 * 2);

/** Rebuild the permutation table. Called once at module load, re-callable per seed. */
export function seedNoise(seed) {
  const rng = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher–Yates with the seeded stream.
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
    const ang = (PERM[i] / 256) * Math.PI * 2;
    GRAD2[i * 2] = Math.cos(ang);
    GRAD2[i * 2 + 1] = Math.sin(ang);
  }
}
seedNoise(1337);

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** 2D gradient noise, output in roughly [-1, 1]. */
export function noise2(x, y) {
  const X = Math.floor(x), Y = Math.floor(y);
  const xf = x - X, yf = y - Y;
  const xi = X & 255, yi = Y & 255;

  const g = (ix, iy, dx, dy) => {
    const h = (PERM[(ix + PERM[iy & 511]) & 511]) << 1;
    return GRAD2[h] * dx + GRAD2[h + 1] * dy;
  };

  const u = fade(xf), v = fade(yf);
  const n00 = g(xi,     yi,     xf,     yf);
  const n10 = g(xi + 1, yi,     xf - 1, yf);
  const n01 = g(xi,     yi + 1, xf,     yf - 1);
  const n11 = g(xi + 1, yi + 1, xf - 1, yf - 1);

  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4142;
}

/** Fractal Brownian motion. `oct` octaves, each half amplitude and ~double frequency. */
export function fbm2(x, y, oct = 5, lac = 2.03, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise2(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

/**
 * Ridged multifractal — sharp crests instead of rolling blobs.
 * Used for the island's spine so the high ground reads as a ridge, not a dome.
 */
export function ridged2(x, y, oct = 4, lac = 2.07, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise2(x * freq, y * freq));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

/**
 * Domain warp: feed the coordinates through noise before sampling.
 * This is what turns a circular blob coastline into bays and headlands.
 */
export function warp2(x, y, strength = 1, scale = 1) {
  const wx = fbm2(x * scale + 17.3, y * scale - 4.1, 3);
  const wy = fbm2(x * scale - 9.7, y * scale + 23.5, 3);
  return [x + wx * strength, y + wy * strength];
}

/** Smootherstep, matching GLSL smoothstep's shape. */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a, b, t) => a + (b - a) * t;

/* ────────────────────────────────────────────────────────────────
   GLSL — cheap hash noise, for wind only
   ──────────────────────────────────────────────────────────────── */

/**
 * Injected into every vertex shader that needs to move with the wind.
 * Deliberately independent of the CPU noise above: this only has to look
 * like turbulent air, not agree with a heightfield.
 */
export const NOISE_GLSL = /* glsl */ `
#ifndef SK_NOISE_GLSL
#define SK_NOISE_GLSL 1
  vec3 sk_hash33(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
  }

  float sk_hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // Gradient noise, 3D. Range roughly [-1, 1].
  float sk_noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(mix(dot(sk_hash33(i + vec3(0,0,0)), f - vec3(0,0,0)),
              dot(sk_hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
          mix(dot(sk_hash33(i + vec3(0,1,0)), f - vec3(0,1,0)),
              dot(sk_hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
      mix(mix(dot(sk_hash33(i + vec3(0,0,1)), f - vec3(0,0,1)),
              dot(sk_hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
          mix(dot(sk_hash33(i + vec3(0,1,1)), f - vec3(0,1,1)),
              dot(sk_hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y),
      u.z);
  }

  float sk_fbm3(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * sk_noise3(p); p *= 2.02; a *= 0.5; }
    return s;
  }
#endif
`;
