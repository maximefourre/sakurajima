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
 * it at the point where it is defined. Heights do NOT follow this knob: the
 * island is meant to be wide and low, and a taller island at this footprint
 * reads as a mountain in a bowl rather than as a landscape. They get their own,
 * much gentler knob — HEIGHT_SCALE below.
 *
 * Anything derived from noise scales for free — the coastline wobble and the
 * domain warp keep their absolute frequency, so a bigger island simply gets
 * proportionally finer coves, which is the right way round.
 */
export const LAND_SCALE = 1.42 * Math.sqrt(5); // ≈3.175 — the √5 multiplies the original footprint's AREA by exactly 5

/**
 * Partial relief raise. Heights deliberately do NOT follow LAND_SCALE (see
 * above — the island must stay wide and low), but at ×2.24 linear the original
 * 17-unit ridge on a 1120-unit island reads as a pancake (1:66 height:width vs
 * the authored 1:41). A partial raise keeps the "landscape, not mountain"
 * doctrine while giving the silhouette back its presence (1:47).
 */
export const HEIGHT_SCALE = 1.4;

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
  segments: 768,      // terrain mesh resolution (segments^2 quads) — keeps quads under ~2 units so the beach band stays resolved
  seaLevel: 0,        // y = 0 is the waterline
  maxHeight: Math.round(17 * HEIGHT_SCALE), // peak of the ridge above sea level — low, rolling
  beachTop: 1.2,      // above this height sand gives way to grass (absolute — the sand band doesn't grow with relief)
  grassTop: Math.round(13 * HEIGHT_SCALE),  // above this, upland rock takes over
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
export const AREA = LAND_SCALE * LAND_SCALE;

/**
 * At ×5 area, full AREA scaling of the expensive scatters (grass, trees,
 * petals, rocks) blows past what loads and renders comfortably (3M blades,
 * 3000+ trees). Those budgets scale by AREA^0.75 instead: density per square
 * unit drops a little, and the per-instance knobs (blade size, canopy
 * fullness) are raised to compensate — fewer, more magnificent things.
 * Cheap instanced dressing (wildflowers, pebbles in details.js) still uses
 * full AREA.
 */
export const AREA_SOFT = Math.pow(AREA, 0.75);

export const QUALITY = {
  low: {
    label: 'low',
    grassBlades: Math.round(45000 * AREA_SOFT),
    grassRadius: Math.round(70 * LAND_SCALE),
    petals: Math.round(1400 * AREA_SOFT),
    trees: Math.round(56 * AREA_SOFT),
    uniqueTrees: 10,
    rocks: Math.round(35 * AREA_SOFT),
    shadowMap: 1024,
    bloom: false,
    dprCap: 1.0,
    anisotropy: 1,
  },
  high: {
    label: 'high',
    grassBlades: Math.round(200000 * AREA_SOFT),
    grassRadius: Math.round(105 * LAND_SCALE),
    petals: Math.round(4200 * AREA_SOFT),
    trees: Math.round(150 * AREA_SOFT),
    uniqueTrees: 18,
    rocks: Math.round(74 * AREA_SOFT),
    shadowMap: 2048,
    bloom: true,
    dprCap: 1.5,
    anisotropy: 4,
  },
  ultra: {
    label: 'ultra',
    grassBlades: Math.round(470000 * AREA_SOFT),
    grassRadius: Math.round(130 * LAND_SCALE),
    petals: Math.round(8500 * AREA_SOFT),
    trees: Math.round(250 * AREA_SOFT),
    uniqueTrees: 28,
    rocks: Math.round(110 * AREA_SOFT),
    shadowMap: 4096,
    bloom: true,
    dprCap: 2.0,
    anisotropy: 8,
  },
};

export const DEFAULT_QUALITY = 'ultra';

/**
 * The pilgrim path: from the cliff-top overlook on the west coast, along the
 * ridge flank and the river's south bank, down to the west end of the bridge.
 * Authored in unit-island coordinates like everything else. Torii stand at
 * `toriiAt` fractions along the spline. The route deliberately keeps ≥ ~19
 * units from the river centreline until the abutment — closer and it falls
 * into the carved bank.
 */
export const PATH = {
  points: [
    [-88, 0], [-80, 10], [-70, 18], [-60, 25], [-50, 33],
    [-38, 42], [-26, 48], [-16, 52], [-9, 54],
  ].map(([x, z]) => [x * LAND_SCALE, z * LAND_SCALE]),
  width: 3.2,
  toriiAt: [0.06, 0.5, 0.93],
};

/** Camera framing. Chosen so the opening shot reads as a postcard, not a debug view. */
export const CAMERA = {
  fov: 42,
  near: 0.5,
  // The far plane is a distance from the CAMERA, not from the origin. Worst
  // case: the camera at maxDistance (620·L) on one side, looking across at the
  // ocean rim (SIZE·3.37 = 460·L·3.37) on the far side — their SUM, plus a
  // margin. makeOceanDisc's outer ring lands exactly at its farR argument.
  // Depth precision is governed by `near`, not this value: going 5557→7091
  // changes far/(far-near) by <0.01%.
  far: Math.round((620 + 460 * 3.37) * LAND_SCALE) + 200,
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

  // Distributaries of the delta — the river reaches the sea at three mouths.
  // Each path BEGINS with the two trunk control points around the junction
  // ([24,72] then [40,80], t ≈ 0.80 on the trunk, downstream of the bridge) so
  // the Catmull-Rom tangent at the split matches the trunk's flow direction,
  // then diverges to its own mouth. Mouths are 60+ world units apart with land
  // tongues between them; all end past the coast so the bank-based mouth
  // detection in river.js finds each estuary on its own. `widthK` is the share
  // of the flow a distributary carries — the carve blends from full trunk
  // width at the junction down to this.
  // The junction sits where the trunk's water is already near sea level
  // (probed: waterY ≈ 0.9 at [40,80]) — splitting higher upstream pins the
  // branches to a water level ABOVE the low coastal flat they then cross,
  // which reads as a floating sheet. The whole south-east quadrant is a low
  // braided plain, so the arms fan out WIDE: mouths are 135–165 world units
  // apart, each meeting its own stretch of surf.
  branches: [
    { path: [[24, 72], [40, 80], [56, 84], [72, 84], [86, 82], [98, 80]],  widthK: 0.55 }, // east mouth
    { path: [[24, 72], [40, 80], [38, 92], [32, 104], [24, 116], [16, 126]], widthK: 0.50 }, // south-west mouth
  ].map((b) => ({ ...b, path: b.path.map(([x, z]) => [x * LAND_SCALE, z * LAND_SCALE]) })),

  // The channel widens with the island, but only partly — a river is sized by
  // its catchment, not by the map, and at full scale it starts to read as an
  // estuary all the way up.
  width: 6.0 * (1 + (LAND_SCALE - 1) * 0.6),
  bankWidth: 6.5 * (1 + (LAND_SCALE - 1) * 0.6),
  // Depth follows the relief raise, capped — a deeper cut than ~4.3 starts to
  // read as a gorge at this channel width.
  depth: 3.4 * Math.min(HEIGHT_SCALE, 1.25),
  flowSpeed: 0.55,    // surface scroll rate

  // Where along the path (0..1) the bridge sits. 0.46 puts it on the middle
  // reach, where the banks are widest and the crossing reads best.
  bridgeAt: 0.46,
  // Spans the wetted channel plus a margin, NOT the full carve: the river runs
  // along the ridge flank here, so the west bank climbs forever — a longer
  // deck just drives its west end into the hillside and leaves the east end
  // on a stone tower. buildBridge() also slides the deck a few units along its
  // own axis to find the most level pair of abutments.
  bridgeSpan: 16 * (1 + (LAND_SCALE - 1) * 0.6),
  bridgeWidth: 5.5,
  bridgeRise: 4.6,    // camber of the arch — taiko-bashi are steeply humped
};
