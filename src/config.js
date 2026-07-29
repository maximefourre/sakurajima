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
 * shelf, the secondary bumps, the pond basins, the paths, the lantern
 * line — was laid out against one particular island size. Growing the island by
 * editing `ISLAND_R` alone leaves all of it huddled in the middle of a bigger
 * landmass with the coastline nowhere near where it was authored.
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
    petals: Math.round(1800 * AREA_SOFT),
    fallenPetals: Math.round(900 * AREA_SOFT),
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
    petals: Math.round(5600 * AREA_SOFT),
    fallenPetals: Math.round(2600 * AREA_SOFT),
    trees: Math.round(190 * AREA_SOFT),
    uniqueTrees: 18,
    rocks: Math.round(74 * AREA_SOFT),
    shadowMap: 2048,
    bloom: true,
    dprCap: 1.5,
    anisotropy: 4,
  },
  ultra: {
    label: 'ultra',
    grassBlades: Math.round(560000 * AREA_SOFT),
    grassRadius: Math.round(130 * LAND_SCALE),
    petals: Math.round(11500 * AREA_SOFT),
    fallenPetals: Math.round(7000 * AREA_SOFT),
    trees: Math.round(330 * AREA_SOFT),
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
 * Le réseau de chemins de terre. Trois routes partant d'un carrefour en
 * lisière de la prairie : la MONTÉE AUX TORII (reprend les lacets éprouvés
 * de l'ancienne montée, jusqu'à la terrasse belvédère de la falaise ouest),
 * la BOUCLE DES ÉTANGS (fermée, elle longe les trois bassins à koi sans
 * jamais entrer dans leurs berges creusées), et le CHEMIN DE LA PLAGE vers
 * le sable du sud-est. Coordonnées authorées, montées en LAND_SCALE comme
 * toute la géographie.
 */
export const PATHS = {
  width: 4.8,         // élargi 3.2 → 4.8 (consigne joueur : chemin trop maigre)
  lanternEvery: 30,   // unités monde d'arc entre deux lanternes
  routes: [
    { name: 'torii',
      points: [
        [6, -30], [-4, -26], [-18, -18], [-30, -8], [-42, 4], [-54, 12],
        [-61, 19], [-70, 23], [-79, 18], [-72, 12], [-77, 4], [-84, 7],
        [-88, 0],
      ],
      toriiAt: [0.30, 0.48, 0.64, 0.80, 0.94] },
    { name: 'etangs',
      points: [
        [6, -30], [26, -38], [18, -56], [4, -68], [-12, -58], [-10, -42],
        [6, -30],
      ] },
    { name: 'plage',
      points: [[6, -30], [18, -18], [30, -4], [38, 10], [44, 26], [46, 40]] },
  ].map((r) => ({ ...r, points: r.points.map(([x, z]) => [x * LAND_SCALE, z * LAND_SCALE]) })),
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
  // surrounding sea are both in shot, high enough to take in the whole landmass.
  start: { x: 215 * LAND_SCALE * 0.86, y: 112 * LAND_SCALE * 0.86, z: 250 * LAND_SCALE * 0.86 },
  target: { x: 0, y: 4, z: 10 * LAND_SCALE },
  minDistance: 14,
  maxDistance: 620 * LAND_SCALE,
  maxPolar: Math.PI * 0.495, // stop just above the horizon so you can't go under the island
};
