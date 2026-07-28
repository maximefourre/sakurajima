/**
 * config.js — art-direction constants and quality presets.
 *
 * Everything a human would want to tweak lives here, not buried in a module.
 * The budgets below are calibrated for an Apple M4 Max (32-core GPU); `ultra`
 * is the default because that is the target machine. `low` exists so the scene
 * degrades gracefully rather than dying on weaker hardware.
 */

export const SEED = 20260727;

/**
 * Island footprint multiplier.
 *
 * Every hand-authored coordinate in this project — the ridge spine, the meadow
 * shelf, the secondary bumps, the pond basins, the river's path, the lantern
 * line — was laid out against one particular island size. Growing the island by
 * editing `ISLAND_R` alone leaves all of it huddled in the middle of a bigger
 * landmass with the river ending nowhere near the sea.
 *
 * So the footprint is ONE knob and every authored XZ coordinate is multiplied by
 * it at the point where it is defined. Heights are deliberately NOT scaled: the
 * island is meant to be wide and low, and a taller island at this footprint
 * reads as a mountain in a bowl rather than as a landscape.
 *
 * Anything derived from noise scales for free — the coastline wobble and the
 * domain warp keep their absolute frequency, so a bigger island simply gets
 * proportionally finer coves, which is the right way round.
 */
export const LAND_SCALE = 1.42;

/**
 * World extent.
 *
 * The island is deliberately WIDE and LOW rather than tall: a 240-unit island
 * with a 34-unit peak reads as a dome — you see the whole thing at once and it
 * looks like a hill in a bowl. Widening the footprint while flattening the
 * relief turns it into a landscape you could walk across, with the ridge as a
 * feature on it rather than the whole subject.
 *
 * Segment count is raised far less than the size, so triangle density per unit
 * drops. That is intentional — terrain build time is already the slowest step
 * of the load, and at this scale the extra resolution buys nothing visible.
 */
export const WORLD = {
  // The TILE, not the island. It has to stay comfortably wider than the land so
  // there is seabed on every side; the ocean disc reads its depth from this
  // tile's baked heightfield and clamps to the edge value beyond it.
  size: Math.round(460 * LAND_SCALE),
  segments: 460,      // terrain mesh resolution (segments^2 quads)
  seaLevel: 0,        // y = 0 is the waterline
  maxHeight: 17,      // peak of the ridge above sea level — low, rolling
  beachTop: 1.2,      // above this height sand gives way to grass
  grassTop: 13,       // above this, upland rock takes over
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

/**
 * Scatter budgets are quoted for a unit island and multiplied by LAND_SCALE^2,
 * because they cover an AREA. Growing the island without growing these is what
 * turns a grove into an orchard and a meadow into a lawn — the counts stay
 * impressive in the profiler and the density on screen quietly halves.
 */
const AREA = LAND_SCALE * LAND_SCALE;

export const QUALITY = {
  low: {
    label: 'low',
    grassBlades: Math.round(45000 * AREA),
    grassRadius: Math.round(70 * LAND_SCALE),
    petals: Math.round(2500 * AREA),
    trees: Math.round(90 * AREA),
    uniqueTrees: 10,
    rocks: Math.round(60 * AREA),
    shadowMap: 1024,
    bloom: false,
    dprCap: 1.0,
    anisotropy: 1,
  },
  high: {
    label: 'high',
    grassBlades: Math.round(150000 * AREA),
    grassRadius: Math.round(105 * LAND_SCALE),
    petals: Math.round(7000 * AREA),
    trees: Math.round(215 * AREA),
    uniqueTrees: 16,
    rocks: Math.round(100 * AREA),
    shadowMap: 2048,
    bloom: true,
    dprCap: 1.5,
    anisotropy: 4,
  },
  ultra: {
    label: 'ultra',
    grassBlades: Math.round(300000 * AREA),
    grassRadius: Math.round(130 * LAND_SCALE),
    petals: Math.round(12000 * AREA),
    trees: Math.round(310 * AREA),
    uniqueTrees: 24,
    rocks: Math.round(140 * AREA),
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
  far: 3200,
  // Framed to read as an island: far enough out that the coastline and the
  // surrounding sea are both in shot, high enough to see the river's whole run.
  start: { x: 215 * LAND_SCALE * 0.86, y: 112 * LAND_SCALE * 0.86, z: 250 * LAND_SCALE * 0.86 },
  target: { x: 0, y: 4, z: 10 * LAND_SCALE },
  minDistance: 14,
  maxDistance: 620 * LAND_SCALE,
  maxPolar: Math.PI * 0.495, // stop just above the horizon so you can't go under the island
};

/**
 * The river. A single watercourse from the ridge to the sea, crossed by a
 * wooden bridge. Its path is a hand-placed spline rather than something derived
 * from the terrain: a real drainage simulation would wander plausibly but boringly,
 * whereas an authored curve can be made to pass exactly where the bridge should be.
 */
export const RIVER = {
  // Control points in world XZ, source (up on the ridge) to mouth (the sea).
  //
  // These are not guesses: the terrain was probed for its actual land extent
  // (x ∈ [-102, 102], z ∈ [-110, 94], summit at (-60, 0) ≈ 20.6) and the line
  // was then chosen to descend monotonically from the ridge shoulder to the
  // south-east coast — roughly 19 → 17 → 13 → 8 → 0.6 → sea. An authored path
  // that climbs anywhere makes the water surface either flow uphill or, once
  // the descent constraint kicks in, flatten out entirely.
  // Sinuous rather than a straight diagonal: a river drawn as a smooth line
  // between two points reads unmistakably as a road. The lateral wander is what
  // makes it look like water found this route rather than an engineer choosing it.
  //
  // Scaled by LAND_SCALE, like every other authored coordinate: the path's whole
  // point is where it meets the coast, and left unscaled on a larger island it
  // would stop in open meadow.
  path: [
    [-48,  -4],
    [-42,  10],
    [-28,  18],
    [-22,  32],
    [ -6,  38],
    [  2,  52],
    [ 16,  58],
    [ 24,  72],
    [ 40,  80],
    [ 50,  94],
    [ 64, 106],
  ].map(([x, z]) => [x * LAND_SCALE, z * LAND_SCALE]),
  // The channel widens with the island, but only partly — a river is sized by
  // its catchment, not by the map, and at full scale it starts to read as an
  // estuary all the way up.
  width: 6.0 * (1 + (LAND_SCALE - 1) * 0.6),
  bankWidth: 6.5 * (1 + (LAND_SCALE - 1) * 0.6),
  depth: 3.4,         // how deep the channel cuts below the surrounding ground
  flowSpeed: 0.55,    // surface scroll rate

  // Where along the path (0..1) the bridge sits. 0.46 puts it on the middle
  // reach, where the banks are widest and the crossing reads best.
  bridgeAt: 0.46,
  bridgeSpan: 26 * (1 + (LAND_SCALE - 1) * 0.6),  // must still span the widened channel
  bridgeWidth: 4.2,
  bridgeRise: 3.1,    // camber of the arch — taiko-bashi are steeply humped
};
