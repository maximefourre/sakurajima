/**
 * config.js — art-direction constants and quality presets.
 *
 * Everything a human would want to tweak lives here, not buried in a module.
 * The budgets below are calibrated for an Apple M4 Max (32-core GPU); `ultra`
 * is the default because that is the target machine. `low` exists so the scene
 * degrades gracefully rather than dying on weaker hardware.
 */

export const SEED = 20260727;

/** World extent. The island lives inside this square; ocean fills the rest. */
export const WORLD = {
  size: 240,          // island tile is SIZE x SIZE world units
  segments: 320,      // terrain mesh resolution (segments^2 quads)
  seaLevel: 0,        // y = 0 is the waterline
  maxHeight: 34,      // peak of the ridge above sea level
  beachTop: 1.5,      // above this height sand gives way to grass
  grassTop: 22,       // above this, upland rock takes over
  grassMaxSlope: 0.62,// grass refuses to grow on slopes steeper than this
};

/**
 * Wind — modelled as a GUST TRAIN, not a steady breeze.
 *
 * The default in most 3D scenes is a continuous wind with a sine envelope, which
 * reads as a wind tunnel: everything wobbles forever at the same rate. Real wind
 * on an island does something else — it goes genuinely SLACK for long stretches,
 * then a squall arrives, sweeps across, and dies. And each squall arrives from a
 * somewhat different quarter.
 *
 * So strength is built as: fbm noise -> subtract a threshold -> raise to a power.
 * Everything below `lullFloor` clamps to near-zero calm, and only the peaks
 * survive as gusts. `gustSharpness` controls how abruptly they hit.
 *
 * Direction is a random walk with occasional large jumps, not a slow rotation,
 * so successive gusts genuinely come from different directions.
 */
export const WIND = {
  baseDir: 0.9,        // radians, initial heading

  // — direction wander —
  dirNoiseRate: 0.055, // how fast the heading random-walks
  dirRange: Math.PI,   // ± swing around baseDir; PI = a gust can come from anywhere
  veerChance: 0.12,    // probability per gust that the direction jumps sharply
  veerAmount: 2.1,     // radians of a sharp veer

  // — gust train (this is what kills the wind-tunnel look) —
  strength: 1.0,       // master multiplier, driven by the UI slider
  lullFloor: 0.34,     // noise below this is flattened to dead calm
  gustSharpness: 2.4,  // >1 = gusts spike and decay fast; 1 = soft swells
  gustRate: 0.085,     // temporal frequency of gust arrivals (lower = rarer, longer calms)
  gustPeak: 2.6,       // multiplier at the height of a squall
  calmDrift: 0.07,     // residual air movement during a lull — never truly zero

  // — spatial structure: you should SEE the gust front cross the island —
  gustScale: 0.011,    // spatial frequency of gust cells (lower = broader fronts)
  gustSpeed: 11.0,     // how fast a gust front sweeps across the ground
  frontSharpness: 1.7, // how defined the leading edge of a gust is

  turbulence: 0.9,     // high-frequency chop riding on top
  turbScale: 0.09,
  turbRate: 1.6,
};

/** How long a full day takes, in real seconds, at speed 1x. */
export const DAY_LENGTH = 180;

/** Time of day the scene opens on. 0 = midnight, 0.25 = 06:00, 0.5 = noon. */
export const START_TIME = 0.235; // just before sunrise — best first impression

export const QUALITY = {
  low: {
    label: 'low',
    grassBlades: 45000,
    grassRadius: 70,
    petals: 2500,
    trees: 90,
    uniqueTrees: 10,
    rocks: 60,
    shadowMap: 1024,
    bloom: false,
    dprCap: 1.0,
    anisotropy: 1,
  },
  high: {
    label: 'high',
    grassBlades: 150000,
    grassRadius: 105,
    petals: 7000,
    trees: 165,
    uniqueTrees: 16,
    rocks: 100,
    shadowMap: 2048,
    bloom: true,
    dprCap: 1.5,
    anisotropy: 4,
  },
  ultra: {
    label: 'ultra',
    grassBlades: 300000,
    grassRadius: 130,
    petals: 12000,
    trees: 230,
    uniqueTrees: 24,
    rocks: 140,
    shadowMap: 4096,
    bloom: true,
    dprCap: 2.0,
    anisotropy: 8,
  },
};

export const DEFAULT_QUALITY = 'ultra';

/** Camera framing. Chosen so the opening shot reads as a postcard, not a debug view. */
export const CAMERA = {
  fov: 42,
  near: 0.5,
  far: 2400,
  start: { x: 96, y: 38, z: 104 },
  target: { x: -6, y: 10, z: -4 },
  minDistance: 12,
  maxDistance: 340,
  maxPolar: Math.PI * 0.495, // stop just above the horizon so you can't go under the island
};
