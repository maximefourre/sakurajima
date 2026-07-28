/**
 * sky.js — the day/night cycle: solar geometry, atmosphere, key light, stars, moon.
 *
 * This module is the scene's clock AND its colourist. Every other subsystem reads
 * the `phase` object it returns and tints itself accordingly, so the whole island
 * changes mood together instead of each module inventing its own idea of "dusk".
 *
 * ── Three decisions worth knowing about ────────────────────────────────────────
 *
 * 1. THE SUN RUNS REAL SPHERICAL ASTRONOMY, NOT A PIVOT.
 *    A light parented to a rotating empty gives you a sun that passes through the
 *    zenith and rises due east on the equinox forever. It looks wrong and, worse,
 *    it kills your shadows at noon (a sun straight overhead casts nothing you can
 *    read). Here the sun is placed by the standard hour-angle → horizon transform
 *    at latitude 31.6°N — Sakurajima — with a +12.5° declination (late April, when
 *    the sakura are actually out). That gets you, for free:
 *      · sunrise north of east, sunset north of west
 *      · a noon altitude of ~71°, not 90° — shadows always have a direction
 *      · a genuinely tilted arc, which is what makes the light feel like a place
 *
 * 2. EVERYTHING IS KEYFRAMED IN *SOLAR PHASE*, NOT IN dayTime.
 *    With the geometry above, the sun actually crosses the horizon at dayTime
 *    0.229 and 0.771 — not 0.25 / 0.75. If the tables below were authored against
 *    raw dayTime, the red sunrise would sit 30 minutes off, and would drift again
 *    the moment anyone touched LATITUDE. So dayTime is remapped into a phase `u`
 *    in which u = 0.25 is ALWAYS the sunrise crossing and u = 0.75 is ALWAYS
 *    sunset. Every table is authored in u. The art survives the geometry changing.
 *
 * 3. THE SKY, STARS AND MOON ARE PINNED TO THE FAR PLANE.
 *    Each celestial shader ends with `gl_Position.z = gl_Position.w * 0.999995`,
 *    which parks the fragment exactly at maximum depth. Consequence: none of them
 *    care what CAMERA.far is (2400 here), so we never have to push the far plane
 *    out to 100000 and wreck depth precision on a 240-unit island. Depth *test*
 *    stays on so the island still occludes them; depth *write* is off, and the
 *    layer order is decided by renderOrder.
 */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

import { SEED } from './config.js';
import { streamFor } from './noise.js';

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
/** NOTE the argument order: THREE's is smoothstep(x, min, max), not GLSL's. */
const smooth = THREE.MathUtils.smoothstep;
const DEG = THREE.MathUtils.DEG2RAD;

/* ══════════════════════════════════════════════════════════════════════════════
   TUNABLES — the dozen numbers an art director actually reaches for.
   ══════════════════════════════════════════════════════════════════════════════ */

export const SKY_TUNE = {
  /* — geometry — */
  latitude: 31.6,        // Sakurajima, Kagoshima. Sets how tilted the arc is.
  declination: 12.5,     // ~late April. Higher = longer day, higher noon sun.
  moonDeclination: -7.0, // deliberately NOT the exact anti-sun; the moon rides lower.
  moonPhaseAngle: 0.70,  // radians of terminator offset. 0 = full, ~1.2 = half.

  /* — key light — */
  sunDistance: 320,      // where the DirectionalLight sits. Only affects the shadow frustum.
  islandRadius: 125,     // WORLD.size(240)/2 + margin. Drives the ortho shadow camera.
  shadowMapSize: 2048,   // overridden by quality.shadowMap
  shadowBias: -0.00018,  // tiny. normalBias does the real work — see notes below.
  normalBiasHigh: 0.045, // sun overhead
  normalBiasLow: 0.30,   // sun grazing the horizon (grazing angles need far more)
  moonCastsShadow: false,// true = a second full shadow pass every frame. Gorgeous, not free.

  /* — atmosphere handover — */
  skyElevationFloor: 0.13, // soft floor on the Sky addon's sun elevation (~ -7.5°).
  nightDomeMaxOpacity: 0.92, // <1 on purpose: keeps a ghost of the addon's clouds at night.

  /* — stars — */
  starCount: 3200,
  starRadius: 2000,
  starSizeScale: 1.0,
  twinkleSpeed: 1.0,

  /* — moon — */
  moonDistance: 1600,
  moonAngularRadius: 0.0175, // ~2° across. About 4× life-size — this is a fairy tale.

  /* — fog — */
  createFogIfMissing: true,
};

/* ══════════════════════════════════════════════════════════════════════════════
   KEYFRAME MACHINERY
   Tracks are [phase, value] pairs sorted on phase, first key at 0, last at 1
   holding the same value so the cycle closes seamlessly. Smoothstep-eased.
   ══════════════════════════════════════════════════════════════════════════════ */

function spanIndex(keys, u) {
  for (let i = keys.length - 2; i >= 0; i--) if (u >= keys[i][0]) return i;
  return 0;
}

function ease(a, b, u) {
  const span = b - a;
  if (span <= 1e-9) return 0;
  const t = clamp((u - a) / span, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Sample a scalar track at phase u. */
function trackScalar(keys, u) {
  const i = spanIndex(keys, u);
  const a = keys[i], b = keys[i + 1];
  return lerp(a[1], b[1], ease(a[0], b[0], u));
}

/** Sample a colour track into `out`. lerpColors works in linear working space. */
function trackColor(keys, u, out) {
  const i = spanIndex(keys, u);
  const a = keys[i], b = keys[i + 1];
  return out.lerpColors(a[1], b[1], ease(a[0], b[0], u));
}

/** Turn a table of [phase, 0xRRGGBB] into Colors once, at module load. */
function colorKeys(keys) {
  return keys.map(([u, hex]) => [u, new THREE.Color().setHex(hex)]);
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE TABLES.  All phases are SOLAR PHASE u:
     0.00 midnight · 0.25 sunrise (horizon crossing) · 0.50 noon
     0.75 sunset (horizon crossing) · 1.00 midnight
   ══════════════════════════════════════════════════════════════════════════════ */

/*  ── Preetham atmosphere ────────────────────────────────────────────────────
 *
 *  rayleigh is the star of the show. Blue sky at noon comes from a MODERATE
 *  rayleigh; the red sunrise comes from spiking it as the sun crosses the
 *  horizon, because that lengthens the optical path enough that the blue end is
 *  scattered clean out and only the long wavelengths survive to your eye.
 *  turbidity rides with it (haze), and mieDirectionalG is pushed toward 0.91 at
 *  the crossings, which is what swells the forward-scattered halo around the disc.
 *
 *  Sunset is authored HOTTER than sunrise (rayleigh 5.6 vs 5.2, turbidity 10.2 vs
 *  9.6). That is not a mistake: an evening atmosphere has a day's worth of dust
 *  and thermals in it, and the sunset is the shot people screenshot.
 *
 *      u      name              turbidity  rayleigh  mieCoef   mieG
 *      0.000  midnight             1.10      0.22     0.0007   0.680
 *      0.150  astronomical dawn    1.60      0.55     0.0011   0.700
 *      0.205  blue hour            3.20      2.10     0.0030   0.760
 *      0.235  civil dawn           6.20      3.90     0.0075   0.840
 *      0.250  SUNRISE  ← spike     9.60      5.20     0.0125   0.905
 *      0.272  first light          6.80      3.60     0.0085   0.870
 *      0.310  golden morning       4.40      2.60     0.0050   0.820
 *      0.380  mid-morning          3.10      2.00     0.0032   0.780
 *      0.500  NOON                 2.20      1.55     0.0022   0.755
 *      0.620  afternoon            3.00      1.95     0.0031   0.780
 *      0.700  golden hour          4.60      2.75     0.0055   0.830
 *      0.735  low sun              7.00      3.80     0.0092   0.878
 *      0.750  SUNSET   ← spike    10.20      5.60     0.0140   0.915
 *      0.768  afterglow            6.60      4.00     0.0080   0.870
 *      0.795  dusk / blue hour     3.40      2.40     0.0034   0.780
 *      0.850  nautical dusk        1.70      0.75     0.0013   0.710
 *      1.000  midnight             1.10      0.22     0.0007   0.680
 */
const K_TURBIDITY = [
  [0.000, 1.10], [0.150, 1.60], [0.205, 3.20], [0.235, 6.20], [0.250, 9.60],
  [0.272, 6.80], [0.310, 4.40], [0.380, 3.10], [0.500, 2.20], [0.620, 3.00],
  [0.700, 4.60], [0.735, 7.00], [0.750, 10.20], [0.768, 6.60], [0.795, 3.40],
  [0.850, 1.70], [1.000, 1.10],
];
const K_RAYLEIGH = [
  [0.000, 0.22], [0.150, 0.55], [0.205, 2.10], [0.235, 3.90], [0.250, 5.20],
  [0.272, 3.60], [0.310, 2.60], [0.380, 2.00], [0.500, 1.55], [0.620, 1.95],
  [0.700, 2.75], [0.735, 3.80], [0.750, 5.60], [0.768, 4.00], [0.795, 2.40],
  [0.850, 0.75], [1.000, 0.22],
];
const K_MIE_COEF = [
  [0.000, 0.0007], [0.150, 0.0011], [0.205, 0.0030], [0.235, 0.0075], [0.250, 0.0125],
  [0.272, 0.0085], [0.310, 0.0050], [0.380, 0.0032], [0.500, 0.0022], [0.620, 0.0031],
  [0.700, 0.0055], [0.735, 0.0092], [0.750, 0.0140], [0.768, 0.0080], [0.795, 0.0034],
  [0.850, 0.0013], [1.000, 0.0007],
];
const K_MIE_G = [
  [0.000, 0.680], [0.150, 0.700], [0.205, 0.760], [0.235, 0.840], [0.250, 0.905],
  [0.272, 0.870], [0.310, 0.820], [0.380, 0.780], [0.500, 0.755], [0.620, 0.780],
  [0.700, 0.830], [0.735, 0.878], [0.750, 0.915], [0.768, 0.870], [0.795, 0.780],
  [0.850, 0.710], [1.000, 0.680],
];

/*  ── the Sky addon's built-in clouds (new in this version) ──────────────────
 *  Coverage and density climb at the horizon crossings so there is something for
 *  the low sun to set fire to — a clear sunrise is a boring sunrise. Clouds also
 *  sit LOWER at dawn/dusk (elevation 820–860 vs 1150 at noon), which reads as the
 *  morning inversion layer and gets them into the warm light.
 */
const K_CLOUD_SCALE = [
  [0.000, 2.20], [0.205, 2.30], [0.250, 2.60], [0.310, 2.50], [0.500, 2.00],
  [0.700, 2.40], [0.750, 2.80], [0.795, 2.50], [0.850, 2.30], [1.000, 2.20],
];
const K_CLOUD_SPEED = [
  [0.000, 0.010], [0.205, 0.012], [0.250, 0.016], [0.310, 0.020], [0.500, 0.028],
  [0.700, 0.020], [0.750, 0.016], [0.795, 0.013], [0.850, 0.011], [1.000, 0.010],
];
const K_CLOUD_COVERAGE = [
  [0.000, 0.28], [0.205, 0.36], [0.250, 0.46], [0.310, 0.42], [0.500, 0.30],
  [0.700, 0.46], [0.750, 0.55], [0.795, 0.44], [0.850, 0.34], [1.000, 0.28],
];
const K_CLOUD_DENSITY = [
  [0.000, 0.55], [0.205, 0.62], [0.250, 0.80], [0.310, 0.70], [0.500, 0.50],
  [0.700, 0.72], [0.750, 0.88], [0.795, 0.72], [0.850, 0.60], [1.000, 0.55],
];
const K_CLOUD_ELEVATION = [
  [0.000, 900], [0.205, 860], [0.250, 820], [0.310, 900], [0.500, 1150],
  [0.700, 920], [0.750, 840], [0.795, 860], [0.850, 880], [1.000, 900],
];

/*  ── sun colour + intensity ─────────────────────────────────────────────────
 *  Deep orange-red and dim at the horizon → neutral, faintly warm white at noon.
 *  The intensity table is further gated by actual sun altitude (see update), so
 *  the key light can never illuminate the island from below the waterline.
 *
 *      u      colour     intensity   note
 *      0.250  #ff5f28      0.95      SUNRISE — the rim-light frame
 *      0.500  #fff4e8      4.30      NOON
 *      0.750  #ff4d1c      0.85      SUNSET
 */
const K_SUN_COLOR = colorKeys([
  [0.000, 0x1a2547], [0.190, 0x2a3260], [0.228, 0x7a3f3a], [0.250, 0xff5f28],
  [0.266, 0xff8038], [0.290, 0xffab63], [0.340, 0xffd2a0], [0.400, 0xffe8c8],
  [0.500, 0xfff4e8], [0.600, 0xffe6c0], [0.680, 0xffc07a], [0.715, 0xff9a4e],
  [0.740, 0xff7030], [0.750, 0xff4d1c], [0.762, 0xb03a1c], [0.790, 0x3d3a63],
  [1.000, 0x1a2547],
]);
const K_SUN_INTENSITY = [
  [0.000, 0.00], [0.230, 0.00], [0.243, 0.35], [0.250, 0.95], [0.262, 1.70],
  [0.285, 2.45], [0.330, 3.15], [0.400, 3.75], [0.500, 4.30], [0.600, 3.85],
  [0.680, 3.05], [0.720, 2.20], [0.742, 1.35], [0.750, 0.85], [0.760, 0.20],
  [0.772, 0.00], [1.000, 0.00],
];

/* Moonlight: cold blue-silver. Not physically true (moonlight is warm-white) but
 * the Purkinje shift means we *perceive* night as blue, and cinema agrees. */
const MOON_COLOR_HIGH = new THREE.Color().setHex(0x8ea9dc);
const MOON_COLOR_LOW = new THREE.Color().setHex(0xd6b493); // moon on the horizon goes amber
const K_MOON_INTENSITY = [
  [0.000, 0.30], [0.150, 0.26], [0.230, 0.10], [0.260, 0.00],
  [0.740, 0.00], [0.780, 0.10], [0.850, 0.26], [1.000, 0.30],
];

/* ── hemisphere bounce ────────────────────────────────────────────────────────
 * Sky colour and ground colour both animate. The ground colour matters more than
 * people expect: it is the only thing lighting the underside of the canopy, and
 * a warm brown at dawn vs an olive at noon is most of what sells the hour. */
const K_HEMI_SKY = colorKeys([
  [0.000, 0x0d1630], [0.205, 0x24345f], [0.250, 0x6d7fa8], [0.290, 0x9fbbe4],
  [0.400, 0xb3d1f5], [0.500, 0xc0dcff], [0.620, 0xb6d0f2], [0.700, 0xd3b593],
  [0.750, 0xb8836a], [0.790, 0x4a5988], [0.850, 0x1c2848], [1.000, 0x0d1630],
]);
const K_HEMI_GROUND = colorKeys([
  [0.000, 0x05070f], [0.205, 0x14161f], [0.250, 0x4a3328], [0.290, 0x6a5a3e],
  [0.400, 0x77804f], [0.500, 0x7e8a58], [0.620, 0x767f4e], [0.700, 0x6d4f33],
  [0.750, 0x4a3024], [0.790, 0x24222f], [0.850, 0x0c0f18], [1.000, 0x05070f],
]);
const K_HEMI_INTENSITY = [
  [0.000, 0.28], [0.205, 0.45], [0.250, 0.80], [0.320, 1.05], [0.500, 1.25],
  [0.680, 1.05], [0.750, 0.75], [0.790, 0.52], [0.850, 0.36], [1.000, 0.28],
];

/* ── fog ──────────────────────────────────────────────────────────────────────
 * Fog colour MUST track the sky or the horizon shows a hard seam where the ocean
 * meets the atmosphere. Density also rises at dawn/dusk: that is morning mist,
 * and it is free atmosphere. */
const K_FOG_COLOR = colorKeys([
  [0.000, 0x070c1c], [0.160, 0x101a36], [0.210, 0x2b3f6e], [0.250, 0xd97f52],
  [0.280, 0xeeb287], [0.330, 0xd9dff0], [0.400, 0xcfe0f4], [0.500, 0xd3e6fa],
  [0.620, 0xcfdcef], [0.700, 0xe8bb8b], [0.750, 0xe26f42], [0.775, 0xa05a58],
  [0.800, 0x4f5c8c], [0.860, 0x1a2648], [1.000, 0x070c1c],
]);
// These were calibrated against a 240-unit island. On the current 460-unit
// one the camera sits ~260 units out, and exponential fog at the old densities
// buries the whole scene in white haze at noon. Scaled down accordingly —
// enough atmosphere to give the horizon depth, not enough to eat the island.
const FOG_SCALE = 0.16;
const K_FOG_DENSITY = [
  [0.000, 0.00105], [0.210, 0.00165], [0.250, 0.00230], [0.300, 0.00185],
  [0.450, 0.00110], [0.500, 0.00095], [0.700, 0.00120], [0.750, 0.00190],
  [0.800, 0.00165], [0.900, 0.00120], [1.000, 0.00105],
].map(([t, d]) => [t, d * FOG_SCALE]);

/* ── camera response ──────────────────────────────────────────────────────────
 * Exposure is pulled DOWN at noon (0.72) and pushed UP at the crossings (~1.0).
 * That is what a real camera operator does, and it is why the golden hour glows
 * instead of just being orange. */
const K_EXPOSURE = [
  [0.000, 0.55], [0.190, 0.62], [0.230, 0.80], [0.250, 0.98], [0.290, 0.92],
  [0.380, 0.80], [0.500, 0.72], [0.640, 0.80], [0.700, 0.92], [0.750, 1.02],
  [0.780, 0.88], [0.840, 0.68], [1.000, 0.55],
];

/* ── bloom ────────────────────────────────────────────────────────────────────
 * Near zero at noon (bloom at midday reads as a smeared lens, not as light),
 * strong at the crossings and at night so the moon and the brightest stars halo. */
const K_BLOOM_STRENGTH = [
  [0.000, 0.90], [0.200, 0.80], [0.250, 1.10], [0.300, 0.55], [0.400, 0.24],
  [0.500, 0.12], [0.620, 0.28], [0.700, 0.72], [0.750, 1.20], [0.790, 1.00],
  [0.860, 0.92], [1.000, 0.90],
];
const K_BLOOM_RADIUS = [
  [0.000, 0.78], [0.250, 0.68], [0.500, 0.55], [0.750, 0.70], [0.820, 0.78], [1.000, 0.78],
];
const K_BLOOM_THRESHOLD = [
  [0.000, 0.55], [0.230, 0.62], [0.250, 0.78], [0.400, 0.88], [0.500, 0.95],
  [0.640, 0.88], [0.750, 0.78], [0.800, 0.66], [0.870, 0.56], [1.000, 0.55],
];

/* Golden-hour weight — exported through phase so petals/grass can warm their
 * subsurface tint exactly when the light does. */
const K_GOLDEN = [
  [0.000, 0.00], [0.220, 0.00], [0.250, 0.85], [0.300, 1.00], [0.360, 0.35],
  [0.450, 0.00], [0.620, 0.00], [0.680, 0.45], [0.710, 1.00], [0.750, 0.90],
  [0.780, 0.25], [0.820, 0.00], [1.000, 0.00],
];

const PHASE_NAMES = [
  [0.000, 'night'], [0.185, 'dawn'], [0.238, 'sunrise'], [0.285, 'morning'],
  [0.440, 'noon'], [0.580, 'afternoon'], [0.680, 'goldenHour'], [0.742, 'sunset'],
  [0.775, 'dusk'], [0.865, 'night'],
];

/* ══════════════════════════════════════════════════════════════════════════════
   GLSL — shared helpers for the hand-rolled celestial layers.
   ══════════════════════════════════════════════════════════════════════════════ */

/** Pins a vertex to the far plane. Frees every celestial layer from CAMERA.far. */
const FAR_PLANE_GLSL = /* glsl */ `
  #define PIN_TO_FAR_PLANE  gl_Position.z = gl_Position.w * 0.999995;
`;

const HASH_GLSL = /* glsl */ `
  float sky_hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float sky_hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float sky_vnoise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(sky_hash13(i + vec3(0.0, 0.0, 0.0)), sky_hash13(i + vec3(1.0, 0.0, 0.0)), f.x);
    float b = mix(sky_hash13(i + vec3(0.0, 1.0, 0.0)), sky_hash13(i + vec3(1.0, 1.0, 0.0)), f.x);
    float c = mix(sky_hash13(i + vec3(0.0, 0.0, 1.0)), sky_hash13(i + vec3(1.0, 0.0, 1.0)), f.x);
    float d = mix(sky_hash13(i + vec3(0.0, 1.0, 1.0)), sky_hash13(i + vec3(1.0, 1.0, 1.0)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
  }
  float sky_fbm3(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { s += a * sky_vnoise3(p); p *= 2.03; a *= 0.5; }
    return s / 0.875;
  }
  float sky_vnoise2(vec2 x) {
    vec2 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sky_hash12(i), sky_hash12(i + vec2(1.0, 0.0)), f.x),
               mix(sky_hash12(i + vec2(0.0, 1.0)), sky_hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float sky_fbm2(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * sky_vnoise2(p); p *= 2.07; a *= 0.5; }
    return s / 0.9375;
  }
`;

/* ══════════════════════════════════════════════════════════════════════════════
   FACTORY
   ══════════════════════════════════════════════════════════════════════════════ */

export function createSky({ scene, renderer, camera, quality = {} }) {
  const rng = streamFor(SEED, 'sky:stars');

  const LAT = SKY_TUNE.latitude * DEG;
  const DECL = SKY_TUNE.declination * DEG;
  const MOON_DECL = SKY_TUNE.moonDeclination * DEG;
  const sinLat = Math.sin(LAT), cosLat = Math.cos(LAT);

  /* Hour angle at sunrise: cos H0 = -tan(lat) tan(decl). Clamped so the tables
   * still work inside the polar circles even though we will never go there. */
  const H0 = Math.acos(clamp(-Math.tan(LAT) * Math.tan(DECL), -1, 1));
  const SUNRISE_T = 0.5 - H0 / (Math.PI * 2);
  const SUNSET_T = 0.5 + H0 / (Math.PI * 2);

  /* Celestial north pole in world space — the axis the stars wheel around. */
  const POLE = new THREE.Vector3(0, sinLat, -cosLat).normalize();

  /* ── renderer setup ─────────────────────────────────────────────────────── */
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (renderer.toneMapping === THREE.NoToneMapping) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  /* ── the celestial group: everything in here rides with the camera ──────── */
  const celestial = new THREE.Group();
  celestial.name = 'celestial';
  celestial.matrixAutoUpdate = true;
  scene.add(celestial);

  /* ── 1. the Sky addon ───────────────────────────────────────────────────── */
  const sky = new Sky();
  sky.scale.setScalar(10000);
  sky.frustumCulled = false;
  sky.renderOrder = -20;
  celestial.add(sky);

  /*
   * Tame the Preetham dome.
   *
   * The addon's shader ends with `texColor = ( Lin + L0 ) * 0.04`, where Lin is
   * driven by a solar irradiance constant of 1000. Near the horizon that lands
   * around 30-40 in linear HDR, so ACES clips it to flat white — and because
   * this scene's camera sits above the island looking slightly down, the ONLY
   * sky it ever shows is that bright grazing band. Dropping the renderer
   * exposure far enough to recover a blue sky (~0.1) would take the island down
   * to a silhouette with it.
   *
   * Nothing in the addon exposes a brightness control, so add one: a single
   * gain applied to the final colour. This scales the dome without touching the
   * scene's exposure, and leaves the shape of the atmospheric model — the
   * gradient, the sunrise reds, the sun disc — completely intact.
   */
  sky.material.uniforms.uSkyGain = { value: 0.55 };
  sky.material.uniforms.uSkyCompress = { value: 0.42 };
  // NOTE: a ShaderMaterial does not auto-declare its uniforms in GLSL the way
  // MeshStandardMaterial does — adding the entry to `uniforms` alone leaves the
  // identifier undeclared, the shader fails to compile, and the dome renders
  // black with no obvious clue as to why. The declaration has to go in too.
  //
  // A plain multiplier is not enough here. The dome's linear output spans
  // roughly 40 at midday down to ~2 at dawn, so any single gain either clips
  // noon to white or crushes dawn to black — both of which this scene did in
  // turn. A Reinhard curve compresses the bright end hard while leaving the
  // dim end almost untouched, which is exactly the asymmetry the day needs.
  sky.material.fragmentShader =
    'uniform float uSkyGain;\nuniform float uSkyCompress;\n' +
    sky.material.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      `vec3 skyLin = texColor * uSkyGain;
       skyLin = skyLin / ( 1.0 + skyLin * uSkyCompress );
       gl_FragColor = vec4( skyLin, 1.0 );`
    );
  sky.material.needsUpdate = true;

  const skyU = sky.material.uniforms;
  /** Guarded uniform write — the addon's uniform set has grown over versions. */
  function setU(name, value) {
    const slot = skyU[name];
    if (!slot) return false;
    if (slot.value && slot.value.isVector3 && value && value.isVector3) slot.value.copy(value);
    else slot.value = value;
    return true;
  }
  setU('up', new THREE.Vector3(0, 1, 0));

  /* ── 2. the night dome ──────────────────────────────────────────────────── */
  /* Cross-fades in over the Sky addon once the sun goes under. Carries the
   * zenith→horizon gradient, the Milky Way, the residual twilight glow on the
   * horizon where the sun just went down, and the moon's halo. */
  const nightUniforms = {
    uZenith: { value: new THREE.Color().setHex(0x050a1c) },
    uHorizon: { value: new THREE.Color().setHex(0x14203c) },
    uOpacity: { value: 0 },
    uTime: { value: 0 },
    uSkyRot: { value: new THREE.Matrix3() },
    uMwPole: { value: new THREE.Vector3(0.30, 0.55, -0.78).normalize() },
    uMwColor: { value: new THREE.Color().setHex(0x9fb0e8) },
    uSunGlowDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunGlowColor: { value: new THREE.Color().setHex(0xff7a33) },
    uTwilight: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonHaloColor: { value: new THREE.Color().setHex(0xa8c0f0) },
    uMoonGlow: { value: 0 },
  };

  const nightDome = new THREE.Mesh(
    new THREE.SphereGeometry(2200, 40, 28),
    new THREE.ShaderMaterial({
      uniforms: nightUniforms,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        ${FAR_PLANE_GLSL}
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDir = normalize(wp.xyz - cameraPosition);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          PIN_TO_FAR_PLANE
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vDir;

        uniform vec3  uZenith;
        uniform vec3  uHorizon;
        uniform float uOpacity;
        uniform float uTime;
        uniform mat3  uSkyRot;
        uniform vec3  uMwPole;
        uniform vec3  uMwColor;
        uniform vec3  uSunGlowDir;
        uniform vec3  uSunGlowColor;
        uniform float uTwilight;
        uniform vec3  uMoonDir;
        uniform vec3  uMoonHaloColor;
        uniform float uMoonGlow;

        ${HASH_GLSL}

        void main() {
          float h = vDir.y;

          // Vertical gradient, double-eased so the horizon band stays thin.
          float t = smoothstep(-0.06, 0.85, h);
          t = t * t * (3.0 - 2.0 * t);
          vec3 col = mix(uHorizon, uZenith, t);

          // ── Milky Way ───────────────────────────────────────────────────
          // Sampled through the INVERSE star rotation, so the band wheels with
          // the constellations while the gradient above stays world-locked.
          vec3 sd = uSkyRot * vDir;
          float band = 1.0 - abs(dot(sd, uMwPole));
          float mask = smoothstep(0.80, 1.0, band);
          if (mask > 0.002) {
            float cloud = sky_fbm3(sd * 3.0);
            float lanes = sky_fbm3(sd * 9.0 + 11.0);
            float dust  = smoothstep(0.32, 0.78, cloud);
            float dark  = smoothstep(0.62, 0.28, lanes);   // the dust lanes
            float glow  = mask * mask * (0.30 + 0.70 * dust) * mix(0.30, 1.0, dark);
            col += uMwColor * glow * 0.55;
          }

          // ── residual twilight on the horizon where the sun just set ──────
          float sd0 = max(0.0, dot(vDir, uSunGlowDir));
          float wide = pow(sd0, 5.0);
          float tight = pow(sd0, 42.0);
          float horizonMask = smoothstep(-0.13, 0.10, h) * (1.0 - smoothstep(0.05, 0.45, h));
          col += uSunGlowColor * (wide * 0.45 + tight * 1.5) * uTwilight * horizonMask;

          // ── moon halo, so the moon sits IN the sky rather than on it ─────
          float md = max(0.0, dot(vDir, uMoonDir));
          col += uMoonHaloColor * (pow(md, 110.0) * 0.9 + pow(md, 11.0) * 0.16) * uMoonGlow;

          // Ordered-ish dither. A dark near-flat gradient bands horribly at 8-bit;
          // a sub-LSB jitter costs nothing and removes it completely.
          float d = (sky_hash12(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5) * (1.6 / 255.0);
          col += d;

          gl_FragColor = vec4(col, uOpacity);
        }
      `,
    })
  );
  nightDome.frustumCulled = false;
  nightDome.renderOrder = -12;
  nightDome.visible = false;
  celestial.add(nightDome);

  /* ── 3. stars ───────────────────────────────────────────────────────────── */
  const starField = new THREE.Group();   // rotates about POLE — the sky wheels
  starField.name = 'starField';
  celestial.add(starField);

  const STAR_N = Math.max(256, quality.stars || SKY_TUNE.starCount);
  const starGeo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(STAR_N * 3);
    const col = new Float32Array(STAR_N * 3);
    const siz = new Float32Array(STAR_N);
    const mag = new Float32Array(STAR_N);
    const pha = new Float32Array(STAR_N);
    const spd = new Float32Array(STAR_N);

    // Stellar colour ladder: mostly white, a blue-white minority, a warm tail.
    const cBlue = new THREE.Color().setHex(0xb4caff);
    const cWhite = new THREE.Color().setHex(0xffffff);
    const cWarm = new THREE.Color().setHex(0xffcf9a);
    const cDeep = new THREE.Color().setHex(0xff9a6a);
    const tmp = new THREE.Color();

    const R = SKY_TUNE.starRadius;
    for (let i = 0; i < STAR_N; i++) {
      // Uniform on the sphere — the naive lat/long version clumps at the poles.
      const z = 2 * rng() - 1;
      const th = 2 * Math.PI * rng();
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      pos[i * 3 + 0] = Math.cos(th) * r * R;
      pos[i * 3 + 1] = z * R;
      pos[i * 3 + 2] = Math.sin(th) * r * R;

      // Magnitude: heavily skewed, so a handful of stars carry the composition.
      const m = Math.pow(rng(), 3.2);
      mag[i] = m;
      siz[i] = 1.05 + m * 4.6;

      const ct = rng();
      if (ct < 0.16) tmp.copy(cBlue);
      else if (ct < 0.80) tmp.lerpColors(cBlue, cWhite, (ct - 0.16) / 0.64);
      else if (ct < 0.96) tmp.lerpColors(cWhite, cWarm, (ct - 0.80) / 0.16);
      else tmp.lerpColors(cWarm, cDeep, (ct - 0.96) / 0.04);
      col[i * 3 + 0] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;

      pha[i] = rng() * Math.PI * 2;
      spd[i] = 0.65 + rng() * 2.5;
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    starGeo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
    starGeo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    starGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.05);
  }

  const starUniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uSizeScale: { value: SKY_TUNE.starSizeScale },
    uTwinkle: { value: SKY_TUNE.twinkleSpeed },
  };

  const starMat = new THREE.ShaderMaterial({
    uniforms: starUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      attribute vec3  aColor;
      attribute float aSize;
      attribute float aMag;
      attribute float aPhase;
      attribute float aSpeed;

      uniform float uTime;
      uniform float uOpacity;
      uniform float uPixelRatio;
      uniform float uSizeScale;
      uniform float uTwinkle;

      varying vec3  vColor;
      varying float vAlpha;
      varying float vMag;

      ${FAR_PLANE_GLSL}

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 dir = normalize(wp.xyz - cameraPosition);

        // Atmospheric extinction: stars dim AND redden as they approach the
        // horizon. Also conveniently hides anything that has set.
        float horizon = smoothstep(-0.015, 0.17, dir.y);

        // Two incommensurate frequencies -> scintillation that never loops.
        float s = uTime * uTwinkle;
        float tw = 0.70 + 0.30 * sin(s * aSpeed + aPhase) * sin(s * aSpeed * 0.41 + aPhase * 2.7);

        vColor = mix(aColor * vec3(1.30, 0.80, 0.55), aColor, horizon);
        vMag   = aMag;
        vAlpha = uOpacity * horizon * mix(0.55, 1.0, tw) * (0.22 + 0.78 * aMag);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        PIN_TO_FAR_PLANE

        // gl_PointSize is in DEVICE pixels, hence the pixel-ratio factor.
        gl_PointSize = aSize * uPixelRatio * uSizeScale * mix(0.86, 1.14, tw);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      varying vec3  vColor;
      varying float vAlpha;
      varying float vMag;

      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float r = sqrt(r2);

        float core  = exp(-r2 * 9.0);
        float halo  = exp(-r * 3.2) * 0.30;
        // Diffraction spikes, weighted by magnitude^2 so only the bright ones
        // get them. This is the single detail that stops a Points cloud reading
        // as "dots" and starts it reading as "stars".
        float spike = (exp(-abs(p.x) * 13.0) + exp(-abs(p.y) * 13.0))
                    * exp(-r * 2.2) * 0.30 * vMag * vMag;

        float a = (core + halo + spike) * vAlpha;
        if (a <= 0.0015) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `,
  });

  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -11;
  stars.visible = false;
  starField.add(stars);

  /* ── 4. the moon ────────────────────────────────────────────────────────── */
  const moonUniforms = {
    uDiskColor: { value: new THREE.Color().setHex(0xf2f0e6) },
    uGlowColor: { value: new THREE.Color().setHex(0xa9c2f2) },
    uOpacity: { value: 0 },
    uPhaseAngle: { value: SKY_TUNE.moonPhaseAngle },
    uGlow: { value: 1.0 },
  };

  const moon = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: moonUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        ${FAR_PLANE_GLSL}
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          PIN_TO_FAR_PLANE
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;

        uniform vec3  uDiskColor;
        uniform vec3  uGlowColor;
        uniform float uOpacity;
        uniform float uPhaseAngle;
        uniform float uGlow;

        ${HASH_GLSL}

        void main() {
          // Quad is 4x the disc, so the halo has room. r = 1 at the limb.
          vec2 p = (vUv - 0.5) * 4.0;
          float r = length(p);

          float glow = exp(-max(r - 1.0, 0.0) * 2.4) * 0.35
                     + exp(-r * r * 0.5) * 0.22;
          vec3 col = uGlowColor * glow * uGlow;

          if (r < 1.02) {
            // Reconstruct the sphere normal from the disc coordinate.
            float z = sqrt(max(0.0, 1.0 - min(r * r, 1.0)));
            vec3 n = vec3(p, z);
            vec3 L = normalize(vec3(sin(uPhaseAngle), 0.16, cos(uPhaseAngle)));
            float lit = smoothstep(-0.10, 0.16, dot(n, L));

            float limb  = pow(max(z, 0.0), 0.32);              // limb darkening
            float maria = sky_fbm2(p * 2.3 + 7.3);             // the seas
            float crat  = sky_fbm2(p * 9.0 - 3.1);             // fine mottling
            float shade = mix(0.66, 1.0, smoothstep(0.34, 0.74, maria))
                        * mix(0.94, 1.0, crat);

            float edge = smoothstep(1.0, 0.982, r);
            // Earthshine: the unlit limb is not black, it is very faintly blue.
            vec3 surf = uDiskColor * limb * shade * (0.045 + 0.955 * lit);
            col += surf * edge * 1.35;
          }

          gl_FragColor = vec4(col * uOpacity, 1.0);
        }
      `,
    })
  );
  {
    const discDiameter = 2 * SKY_TUNE.moonAngularRadius * SKY_TUNE.moonDistance;
    moon.scale.setScalar(discDiameter * 2);
  }
  moon.frustumCulled = false;
  moon.renderOrder = -10;
  moon.visible = false;
  celestial.add(moon);

  /* ── 5. lights ──────────────────────────────────────────────────────────── */

  const sunLight = new THREE.DirectionalLight(0xffffff, 0);
  sunLight.name = 'sunLight';
  sunLight.castShadow = true;
  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight);
  scene.add(sunLight.target);

  /*  SHADOW CAMERA
   *
   *  Static ortho box centred on the island. Static is deliberate: a shadow
   *  camera that chases the view camera makes the shadow texels slide under
   *  static geometry every frame, and on 300k grass blades that shimmer is
   *  instantly visible. A fixed box costs a little resolution and buys total
   *  temporal stability.
   *
   *  Extent: ±125 covers WORLD.size 240 with margin. At quality.shadowMap 2048
   *  that is 250/2048 = 0.122 world units per texel; at 4096, 0.061.
   *
   *  Near/far are wrapped tight around the island as seen from the light. Loose
   *  near/far is the #1 cause of acne, because `bias` is expressed in the shadow
   *  camera's normalised depth — a 640-unit range makes bias -0.00018 worth
   *  0.115 world units. Widen far and you silently multiply your bias.
   *
   *  ACNE vs PETER-PANNING:
   *    · bias is kept tiny (-0.00018) precisely because bias is what detaches a
   *      shadow from its caster's feet. A grass blade whose shadow floats is
   *      worse than a little acne.
   *    · normalBias does the real work. It offsets the *sample position* along
   *      the receiving surface normal, so it scales naturally with how obliquely
   *      the surface faces the light and it never detaches contact shadows.
   *    · normalBias is ramped 0.045 → 0.30 as the sun drops to the horizon,
   *      because at grazing incidence the depth gradient across one texel
   *      explodes and a fixed bias cannot cover both cases.
   *    · Do NOT set material.shadowSide = BackSide on the grass. It is the usual
   *      acne cure, and it does not work on single-quad blades — there is no
   *      back face to push the depth onto.
   */
  const shadowSize = quality.shadowMap || SKY_TUNE.shadowMapSize;
  const R_ISLAND = SKY_TUNE.islandRadius;
  const D_SUN = SKY_TUNE.sunDistance;
  sunLight.shadow.mapSize.set(shadowSize, shadowSize);
  sunLight.shadow.camera.left = -R_ISLAND;
  sunLight.shadow.camera.right = R_ISLAND;
  sunLight.shadow.camera.top = R_ISLAND;
  sunLight.shadow.camera.bottom = -R_ISLAND;
  sunLight.shadow.camera.near = D_SUN - R_ISLAND - 80;   // 115
  sunLight.shadow.camera.far = D_SUN + R_ISLAND + 80;    // 525
  sunLight.shadow.bias = SKY_TUNE.shadowBias;
  sunLight.shadow.normalBias = SKY_TUNE.normalBiasHigh;
  sunLight.shadow.radius = 2;   // only meaningful for VSM; harmless under PCFSoft
  sunLight.shadow.camera.updateProjectionMatrix();

  const moonLight = new THREE.DirectionalLight(0x8ea9dc, 0);
  moonLight.name = 'moonLight';
  moonLight.target.position.set(0, 0, 0);
  moonLight.castShadow = !!SKY_TUNE.moonCastsShadow;
  if (moonLight.castShadow) {
    moonLight.shadow.mapSize.set(Math.min(1024, shadowSize), Math.min(1024, shadowSize));
    moonLight.shadow.camera.left = -R_ISLAND;
    moonLight.shadow.camera.right = R_ISLAND;
    moonLight.shadow.camera.top = R_ISLAND;
    moonLight.shadow.camera.bottom = -R_ISLAND;
    moonLight.shadow.camera.near = D_SUN - R_ISLAND - 80;
    moonLight.shadow.camera.far = D_SUN + R_ISLAND + 80;
    moonLight.shadow.bias = -0.0004;
    moonLight.shadow.normalBias = 0.12;
    moonLight.shadow.camera.updateProjectionMatrix();
  }
  scene.add(moonLight);
  scene.add(moonLight.target);

  const hemiLight = new THREE.HemisphereLight(0xc0dcff, 0x7e8a58, 1.0);
  hemiLight.name = 'skyBounce';
  scene.add(hemiLight);

  /* ── 6. fog ─────────────────────────────────────────────────────────────── */
  let ownsFog = false;
  if (!scene.fog && SKY_TUNE.createFogIfMissing) {
    scene.fog = new THREE.FogExp2(0xcfe0f4, 0.0011);
    ownsFog = true;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     STATE — every vector below is hoisted. update() allocates nothing.
     ══════════════════════════════════════════════════════════════════════════ */

  const sunDirection = new THREE.Vector3(0, 1, 0);
  const moonDirection = new THREE.Vector3(0, -1, 0);
  const _skySunDir = new THREE.Vector3();
  const _sunGlowDir = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _qInv = new THREE.Quaternion();
  const _m4 = new THREE.Matrix4();

  const _sunColor = new THREE.Color();
  const _moonColor = new THREE.Color();
  const _hemiSky = new THREE.Color();
  const _hemiGround = new THREE.Color();
  const _fogColor = new THREE.Color();

  let elapsed = 0;

  const phase = {
    /* time */
    dayTime: 0,
    solar: 0,               // remapped phase; 0.25 = sunrise, 0.75 = sunset, always
    name: 'night',
    sunriseAt: SUNRISE_T,
    sunsetAt: SUNSET_T,

    /* geometry */
    sunDirection,
    sunDir: sunDirection,   // alias, both spellings are used across the codebase
    moonDirection,
    moonDir: moonDirection,
    sunAltitude: 0,
    sunAzimuth: 0,

    /* weights, 0..1 — this is what other subsystems should branch on */
    day: 0,
    night: 0,
    twilight: 0,
    golden: 0,
    stars: 0,
    emissive: 0,            // petals / lanterns / fireflies glow amount

    /* colour, for tinting */
    sunColor: _sunColor,
    moonColor: _moonColor,
    skyColor: _hemiSky,
    groundColor: _hemiGround,
    fogColor: _fogColor,
    keyColor: new THREE.Color(),   // whichever of sun/moon currently dominates
    keyDir: new THREE.Vector3(0, 1, 0),
    keyIntensity: 0,

    /* levels */
    sunIntensity: 0,
    moonIntensity: 0,
    ambient: 0,
    exposure: 1,
    bloom: 0,
  };

  /* ══════════════════════════════════════════════════════════════════════════
     SOLAR GEOMETRY
     ══════════════════════════════════════════════════════════════════════════ */

  /**
   * Hour angle + declination → world direction.
   *
   *   up    =  sin(lat) sin(dec) + cos(lat) cos(dec) cos(H)
   *   north =  cos(lat) sin(dec) - sin(lat) cos(dec) cos(H)
   *   east  = -cos(dec) sin(H)
   *
   * World frame: +X east, +Y up, -Z north. The transform is orthonormal, so the
   * result is already unit length.
   */
  function celestialDir(H, dec, out) {
    const sd = Math.sin(dec), cd = Math.cos(dec);
    const cH = Math.cos(H), sH = Math.sin(H);
    const up = sinLat * sd + cosLat * cd * cH;
    const north = cosLat * sd - sinLat * cd * cH;
    const east = -cd * sH;
    return out.set(east, up, -north);
  }

  /**
   * dayTime → solar phase. Piecewise-linear, anchored on the four events, so
   * u = 0.25 is the sunrise crossing whatever the latitude happens to be.
   */
  function solarPhase(d) {
    if (d < SUNRISE_T) return 0.25 * (d / SUNRISE_T);
    if (d < 0.5) return 0.25 + 0.25 * ((d - SUNRISE_T) / (0.5 - SUNRISE_T));
    if (d < SUNSET_T) return 0.50 + 0.25 * ((d - 0.5) / (SUNSET_T - 0.5));
    return 0.75 + 0.25 * ((d - SUNSET_T) / (1 - SUNSET_T));
  }

  /**
   * Soft floor on the sun's elevation for the Sky addon only.
   *
   * The Preetham model degenerates the instant the sun goes under: the sky
   * snaps to near-black and twilight simply does not happen. A hard clamp fixes
   * that but then the sky never gets dark. This is an exponential approach to
   * a floor — identity at y = 0, C1-continuous there, asymptotic to -floor.
   * Twilight lingers and decays; the night dome takes over from there.
   */
  function softFloor(y, floor) {
    if (y >= 0) return y;
    return -floor * (1 - Math.exp(y / floor));
  }

  function phaseName(u) {
    let name = 'night';
    for (let i = 0; i < PHASE_NAMES.length; i++) {
      if (u >= PHASE_NAMES[i][0]) name = PHASE_NAMES[i][1];
    }
    return name;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     BLOOM — loaded lazily so a 404 on any post-processing addon degrades to
     "no bloom" instead of taking the whole scene down with it.
     ══════════════════════════════════════════════════════════════════════════ */

  const api = {
    update,
    render,
    resize,
    setQuality,
    dispose,
    sunLight,
    moonLight,
    hemiLight,
    composer: null,
    phase,
    sunDirection,
    moonDirection,
    group: celestial,
    sky,
    stars,
    moon,
    nightDome,
  };

  let bloomPass = null;
  let bloomPending = false;

  function initBloom() {
    if (api.composer || bloomPending) return;
    bloomPending = true;
    Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
    ]).then(([ec, rp, ub, op]) => {
      const size = renderer.getSize(new THREE.Vector2());
      const composer = new ec.EffectComposer(renderer);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(size.x, size.y);
      composer.addPass(new rp.RenderPass(scene, camera));
      // signature: (resolution: Vector2, strength, radius, threshold)
      bloomPass = new ub.UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.4, 0.6, 0.85);
      composer.addPass(bloomPass);
      // OutputPass applies tone mapping + sRGB conversion at the END of the
      // chain, which is the whole reason bloom looks right here: the glow is
      // accumulated in linear HDR, not on top of already-tonemapped pixels.
      composer.addPass(new op.OutputPass());
      api.composer = composer;
      bloomPending = false;
    }).catch((err) => {
      bloomPending = false;
      console.warn('[sky] post-processing unavailable, running without bloom:', err);
    });
  }

  function disposeComposer() {
    if (!api.composer) return;
    api.composer.renderTarget1?.dispose();
    api.composer.renderTarget2?.dispose();
    for (const p of api.composer.passes) p.dispose?.();
    api.composer = null;
    bloomPass = null;
  }

  if (quality.bloom !== false) initBloom();

  /* ══════════════════════════════════════════════════════════════════════════
     UPDATE — called once per frame, allocates nothing.
     ══════════════════════════════════════════════════════════════════════════ */

  function update(dayTime, dt = 0) {
    const d = dayTime - Math.floor(dayTime);      // wrap, tolerate negatives
    elapsed += dt;

    const u = solarPhase(d);
    const H = (d - 0.5) * Math.PI * 2;            // hour angle, 0 at local noon

    /* ── geometry ────────────────────────────────────────────────────────── */
    celestialDir(H, DECL, sunDirection);
    celestialDir(H + Math.PI, MOON_DECL, moonDirection);

    const sunY = sunDirection.y;
    const moonY = moonDirection.y;

    /* ── master weights ──────────────────────────────────────────────────── */
    const dayW = smooth(sunY, -0.05, 0.12);
    const nightW = 1 - smooth(sunY, -0.10, 0.06);
    const starW = 1 - smooth(sunY, -0.155, -0.015);
    const twilightW = Math.max(0, 1 - Math.abs(sunY) / 0.185);
    const goldenW = trackScalar(K_GOLDEN, u);

    /* ── Sky addon ───────────────────────────────────────────────────────── */
    {
      const yy = softFloor(sunY, SKY_TUNE.skyElevationFloor);
      const hz = Math.sqrt(Math.max(1e-6, 1 - yy * yy));
      const h0 = Math.max(1e-6, Math.hypot(sunDirection.x, sunDirection.z));
      _skySunDir.set((sunDirection.x / h0) * hz, yy, (sunDirection.z / h0) * hz);
      setU('sunPosition', _skySunDir);

      skyU.turbidity && (skyU.turbidity.value = trackScalar(K_TURBIDITY, u));
      skyU.rayleigh && (skyU.rayleigh.value = trackScalar(K_RAYLEIGH, u));
      skyU.mieCoefficient && (skyU.mieCoefficient.value = trackScalar(K_MIE_COEF, u));
      skyU.mieDirectionalG && (skyU.mieDirectionalG.value = trackScalar(K_MIE_G, u));

      skyU.cloudScale && (skyU.cloudScale.value = trackScalar(K_CLOUD_SCALE, u));
      skyU.cloudSpeed && (skyU.cloudSpeed.value = trackScalar(K_CLOUD_SPEED, u));
      skyU.cloudCoverage && (skyU.cloudCoverage.value = trackScalar(K_CLOUD_COVERAGE, u));
      skyU.cloudDensity && (skyU.cloudDensity.value = trackScalar(K_CLOUD_DENSITY, u));
      skyU.cloudElevation && (skyU.cloudElevation.value = trackScalar(K_CLOUD_ELEVATION, u));
      skyU.showSunDisc && (skyU.showSunDisc.value = smooth(sunY, -0.025, 0.02));
      skyU.time && (skyU.time.value = elapsed);
    }

    /* ── sun light ───────────────────────────────────────────────────────── */
    trackColor(K_SUN_COLOR, u, _sunColor);
    // The keyframed intensity is gated by real altitude. Without this gate the
    // key light briefly rakes UP through the island from below the waterline at
    // the crossings, and the terrain lights from underneath. Very hard to debug
    // by eye, instantly wrong once you see it.
    const sunGate = smooth(sunY, -0.02, 0.06);
    const sunI = trackScalar(K_SUN_INTENSITY, u) * sunGate;

    sunLight.color.copy(_sunColor);
    sunLight.intensity = sunI;
    sunLight.position.copy(sunDirection).multiplyScalar(D_SUN);
    // Grazing light needs far more normal bias than overhead light.
    sunLight.shadow.normalBias = lerp(
      SKY_TUNE.normalBiasLow, SKY_TUNE.normalBiasHigh, smooth(sunY, 0.02, 0.45)
    );
    if (sunLight.shadow.intensity !== undefined) {
      sunLight.shadow.intensity = smooth(sunY, 0.0, 0.10);
    }

    /* ── moon light ──────────────────────────────────────────────────────── */
    const moonGate = smooth(moonY, -0.02, 0.09);
    const moonI = trackScalar(K_MOON_INTENSITY, u) * moonGate;
    _moonColor.lerpColors(MOON_COLOR_LOW, MOON_COLOR_HIGH, smooth(moonY, 0.02, 0.30));
    moonLight.color.copy(_moonColor);
    moonLight.intensity = moonI;
    moonLight.position.copy(moonDirection).multiplyScalar(D_SUN);
    if (moonLight.castShadow && moonLight.shadow.intensity !== undefined) {
      moonLight.shadow.intensity = 0.55 * moonGate * nightW;
    }

    // Deep at night nothing casts. Skipping the shadow pass entirely is a real
    // saving at 4096², and costs nothing visually because the sun contributes 0.
    // NOTE: this is a renderer-global flag. If another module ever wants shadow
    // maps at night, it has to coordinate here.
    renderer.shadowMap.autoUpdate = sunI > 0.001 || (moonLight.castShadow && moonI > 0.001);

    /* ── hemisphere bounce ───────────────────────────────────────────────── */
    trackColor(K_HEMI_SKY, u, _hemiSky);
    trackColor(K_HEMI_GROUND, u, _hemiGround);
    const hemiI = trackScalar(K_HEMI_INTENSITY, u);
    hemiLight.color.copy(_hemiSky);
    hemiLight.groundColor.copy(_hemiGround);
    hemiLight.intensity = hemiI;

    /* ── fog ─────────────────────────────────────────────────────────────── */
    trackColor(K_FOG_COLOR, u, _fogColor);
    if (scene.fog) {
      scene.fog.color.copy(_fogColor);
      if (scene.fog.isFogExp2) {
        scene.fog.density = trackScalar(K_FOG_DENSITY, u);
      } else if (scene.fog.isFog) {
        // Linear fog: convert the density curve into a far distance so the same
        // table drives either fog type.
        const dens = trackScalar(K_FOG_DENSITY, u);
        scene.fog.near = 40;
        scene.fog.far = clamp(2.2 / Math.max(dens, 1e-5), 260, 2200);
      }
    }

    /* ── celestial layers ────────────────────────────────────────────────── */
    celestial.position.copy(camera.position);

    // The stars wheel about the celestial pole. The horizon transform has
    // determinant -1 (azimuth runs east-from-north, which is left-handed), so
    // conjugating a rotation through it reverses the sense — hence -H, not +H.
    _q.setFromAxisAngle(POLE, -H);
    starField.quaternion.copy(_q);

    const domeOp = nightW * SKY_TUNE.nightDomeMaxOpacity;
    nightDome.visible = domeOp > 0.003;
    if (nightDome.visible) {
      nightUniforms.uOpacity.value = domeOp;
      nightUniforms.uTime.value = elapsed;
      _qInv.copy(_q).invert();
      _m4.makeRotationFromQuaternion(_qInv);
      nightUniforms.uSkyRot.value.setFromMatrix4(_m4);

      // Glow anchored on the horizon at the sun's azimuth: this is the band of
      // light that hangs in the west for twenty minutes after the sun is gone.
      const h0 = Math.max(1e-6, Math.hypot(sunDirection.x, sunDirection.z));
      _sunGlowDir.set(sunDirection.x / h0, 0.055, sunDirection.z / h0).normalize();
      nightUniforms.uSunGlowDir.value.copy(_sunGlowDir);
      nightUniforms.uSunGlowColor.value.setHex(0xff7a33);
      nightUniforms.uTwilight.value = Math.max(0, 1 - Math.abs(sunY) / 0.32);
      nightUniforms.uMoonDir.value.copy(moonDirection);
      nightUniforms.uMoonGlow.value = moonGate * nightW * 0.9;
    }

    stars.visible = starW > 0.004;
    if (stars.visible) {
      starUniforms.uOpacity.value = starW;
      starUniforms.uTime.value = elapsed;
      starUniforms.uPixelRatio.value = renderer.getPixelRatio();
    }

    const moonVis = moonGate * (0.16 + 0.84 * nightW);
    moon.visible = moonVis > 0.006;
    if (moon.visible) {
      moon.position.copy(moonDirection).multiplyScalar(SKY_TUNE.moonDistance);
      moon.quaternion.copy(camera.quaternion);      // billboard
      moonUniforms.uOpacity.value = moonVis;
      moonUniforms.uGlow.value = 0.35 + 0.65 * nightW;
      // A moon low on the horizon reddens exactly like the sun does.
      moonUniforms.uDiskColor.value.lerpColors(
        MOON_COLOR_LOW, new THREE.Color().setHex(0xf6f2e4), smooth(moonY, 0.02, 0.28)
      );
    }

    /* ── camera response ─────────────────────────────────────────────────── */
    renderer.toneMappingExposure = trackScalar(K_EXPOSURE, u);

    const bloomS = trackScalar(K_BLOOM_STRENGTH, u);
    if (bloomPass) {
      bloomPass.strength = bloomS;
      bloomPass.radius = trackScalar(K_BLOOM_RADIUS, u);
      bloomPass.threshold = trackScalar(K_BLOOM_THRESHOLD, u);
    }

    /* ── publish phase ───────────────────────────────────────────────────── */
    phase.dayTime = d;
    phase.solar = u;
    phase.name = phaseName(u);
    phase.sunAltitude = Math.asin(clamp(sunY, -1, 1));
    phase.sunAzimuth = Math.atan2(sunDirection.x, -sunDirection.z);
    phase.day = dayW;
    phase.night = nightW;
    phase.twilight = twilightW;
    phase.golden = goldenW;
    phase.stars = starW;
    // What "petals glow at dusk" should read: strongest deep at night, with a
    // real bump through the two twilights.
    phase.emissive = clamp(nightW * 0.85 + twilightW * 0.55, 0, 1);
    phase.sunIntensity = sunI;
    phase.moonIntensity = moonI;
    phase.ambient = hemiI;
    phase.exposure = renderer.toneMappingExposure;
    phase.bloom = bloomS;

    // keyColor / keyDir: whichever light is actually shaping the scene right
    // now. Lets grass, petals and birds tint from one value without each of
    // them re-deriving "is it night".
    if (sunI >= moonI) {
      phase.keyColor.copy(_sunColor);
      phase.keyDir.copy(sunDirection);
      phase.keyIntensity = sunI;
    } else {
      phase.keyColor.copy(_moonColor);
      phase.keyDir.copy(moonDirection);
      phase.keyIntensity = moonI;
    }

    return phase;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     PLUMBING
     ══════════════════════════════════════════════════════════════════════════ */

  function render() {
    if (api.composer) api.composer.render();
    else renderer.render(scene, camera);
  }

  function resize(width, height) {
    if (api.composer) {
      api.composer.setPixelRatio(renderer.getPixelRatio());
      api.composer.setSize(width, height);   // this also resizes every pass
    }
    starUniforms.uPixelRatio.value = renderer.getPixelRatio();
  }

  function setQuality(q = {}) {
    const size = q.shadowMap || SKY_TUNE.shadowMapSize;
    if (size !== sunLight.shadow.mapSize.width) {
      sunLight.shadow.mapSize.set(size, size);
      // The map is only reallocated if the old one is thrown away first.
      if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
    }
    if (q.bloom === false) disposeComposer();
    else initBloom();
    starUniforms.uPixelRatio.value = renderer.getPixelRatio();
  }

  function dispose() {
    disposeComposer();
    celestial.removeFromParent();
    scene.remove(sunLight, sunLight.target, moonLight, moonLight.target, hemiLight);
    starGeo.dispose();
    starMat.dispose();
    moon.geometry.dispose();
    moon.material.dispose();
    nightDome.geometry.dispose();
    nightDome.material.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    if (sunLight.shadow.map) sunLight.shadow.map.dispose();
    if (moonLight.shadow.map) moonLight.shadow.map.dispose();
    if (ownsFog) scene.fog = null;
    renderer.shadowMap.autoUpdate = true;
  }

  // Prime once so nothing ever sees an uninitialised sky, even on frame 0.
  update(0.25, 0);

  return api;
}