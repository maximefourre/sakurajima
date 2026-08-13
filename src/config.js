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
    petals: Math.round(4800 * AREA_SOFT),
    fallenPetals: Math.round(7000 * AREA_SOFT),
    trees: Math.round(56 * AREA_SOFT),
    uniqueTrees: 10,
    rocks: Math.round(35 * AREA_SOFT),
    fireflies: Math.round(28.28 * AREA_SOFT),
    butterflies: Math.round(5 * AREA_SOFT),
    crabs: 10,             // laisse locale — pas AREA_SOFT
    bamboo: Math.round(10 * AREA_SOFT), // bosquet local, instances plus grosses
    moths: 0.5,            // mites par lanterne (1 toutes les deux)
    herons: 1,             // échassiers — N petit, pas AREA_SOFT
    dragonflies: Math.round(1.413936700 * AREA_SOFT), // ≈ 8
    gulls: 6,              // stacks + nuki — pas AREA_SOFT
    shadowMap: 1024,
    bloom: false,
    dprCap: 1.0,
    anisotropy: 1,
  },
  high: {
    label: 'high',
    grassBlades: Math.round(200000 * AREA_SOFT),
    grassRadius: Math.round(105 * LAND_SCALE),
    petals: Math.round(15000 * AREA_SOFT),
    fallenPetals: Math.round(21000 * AREA_SOFT),
    trees: Math.round(190 * AREA_SOFT),
    uniqueTrees: 18,
    rocks: Math.round(74 * AREA_SOFT),
    fireflies: Math.round(74.23 * AREA_SOFT),
    butterflies: Math.round(12 * AREA_SOFT),
    crabs: 18,
    bamboo: Math.round(20 * AREA_SOFT),
    moths: 1,              // une mite par lanterne
    herons: 2,
    dragonflies: Math.round(3.181357575 * AREA_SOFT), // ≈ 18
    gulls: 10,
    shadowMap: 2048,
    bloom: true,
    dprCap: 1.5,
    anisotropy: 4,
  },
  ultra: {
    label: 'ultra',
    grassBlades: Math.round(420000 * AREA_SOFT),
    grassRadius: Math.round(130 * LAND_SCALE),
    petals: Math.round(30000 * AREA_SOFT),
    // ~311k au sol au printemps, ×2.5 en automne (le tapis doit joncher
    // plus que le hanami). Chunks : loin de la caméra, un préfixe seulement.
    fallenPetals: Math.round(55000 * AREA_SOFT),
    trees: Math.round(330 * AREA_SOFT),
    uniqueTrees: 28,
    rocks: Math.round(110 * AREA_SOFT),
    fireflies: Math.round(141.40 * AREA_SOFT),
    butterflies: Math.round(24 * AREA_SOFT),
    crabs: 28,
    bamboo: Math.round(34 * AREA_SOFT),
    moths: 2,              // halo vivant autour de chaque cage à feu
    herons: 3,
    dragonflies: Math.round(5.655746800 * AREA_SOFT), // ≈ 32
    gulls: 16,
    shadowMap: 4096,
    bloom: true,
    dprCap: 2.0,
    anisotropy: 8,
  },
};

export const DEFAULT_QUALITY = 'ultra';

/**
 * Défaut des écrans tactiles (pointeur grossier) : le tier du milieu. L'ultra
 * est calibré pour la machine de développement — ~20 s de bake et ~2.6 M de
 * brins d'herbe tueraient un téléphone avant la première image. Décision
 * utilisateur du 08/08 (« ultra desktop, medium mobile ») ; `?q=` et le choix
 * persisté gardent la priorité.
 */
export const DEFAULT_QUALITY_MOBILE = 'high';

/** Valid seasons and their UI labels. Quality budgets stay out of this table. */
export const SEASONS = Object.freeze({ spring: 'printemps', autumn: 'automne' });
export const DEFAULT_SEASON = 'spring';

/**
 * Le réseau de chemins de terre. Quatre routes partant d'un carrefour en
 * lisière de la prairie : la MONTÉE AUX TORII (reprend les lacets éprouvés
 * de l'ancienne montée, jusqu'à la terrasse belvédère de la falaise ouest),
 * la BOUCLE DES ÉTANGS (fermée, elle longe les trois bassins à koi sans
 * jamais entrer dans leurs berges creusées), le CHEMIN DE LA PLAGE vers
 * le sable du sud-est, et le SENTIER EST vers la bosse (56,-10) et le
 * bosquet de bambous. Coordonnées authorées, montées en LAND_SCALE comme
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
      // Le sentier s'arrete a la LISIERE herbe/sable, pas dans le sable : le
      // dernier point est a h = 1.48, juste au-dessus de WORLD.beachTop = 1.2
      // (mesure sur le heightfield). Il descendait auparavant jusqu'a h = -0.43,
      // ce qui tracait un long ruban de terre battue en travers de la plage —
      // rejete par l'utilisateur. La plage se traverse librement, sans sentier.
      points: [
        [6, -30], [18, -18], [30, -4], [38, 10], [44, 26], [46, 40],
        [49, 62], [50.5, 71.9],
      ] },
    { name: 'bambous',
      // Carrefour → bosse est (56,-10). NNE puis est : au nord de la
      // chashitsu / des étangs, au sud de la plage, hors berges carvées.
      // Assez de stations pour que le Catmull ne coupe ni falaise ni bassin.
      points: [
        [6, -30], [11, -27], [18, -24], [26, -21], [34, -18],
        [42, -15], [49, -12], [56, -10],
      ] },
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

/**
 * Lucioles — hotaru.
 *
 * BUDGET EN AREA_SOFT, corrigé le 01/08 (ADV-2026-08-01-FIREFLY). La version
 * d'origine était en ABSOLU, justifiée par des « bassins de taille fixe » — et
 * c'était FAUX : `SITES` dans ponds.js multiplie les rayons par LAND_SCALE, donc
 * l'habitat couvre une aire en LAND_SCALE². Un budget fixe aurait dilué la
 * densité au premier tour du bouton d'échelle, contre la doctrine du fichier.
 * Les bases sont calibrées pour rendre exactement 160/420/800 au LAND_SCALE
 * courant : la correction ne change rien à ce qu'on voit aujourd'hui.
 *
 * Le clignotement est SYNCHRONISÉ PAR BASSIN, ce qui est à la fois le
 * comportement réel des genji-botaru et le plus beau des trois choix possibles :
 * tout synchroniser fait pulser l'île d'un bloc, tout randomiser fait du bruit.
 */
export const FIREFLIES = Object.freeze({
  // Rayon d'habitat, en multiples du rayon MESURÉ du bassin (32.5 / 19.3 / 13.6
  // après ponds.attach(), soit des habitats de 78 / 46 / 33 unités).
  habitatK: 2.4,

  // Champ de densité : exp(-densityFalloff * (r/habitat)^2), coupé au plancher.
  //
  // LES DEUX CONSTANTES SONT LIÉES, NE PAS EN BOUGER UNE SEULE :
  //   densityFalloff = -ln(densityFloor)
  // Avec un exp(-u^2) nu, la densité vaut encore 0.368 au rayon d'habitat, où le
  // placement coupe net : la population serait TRANCHÉE à 37 % de densité et
  // dessinerait un cercle visible autour de chaque étang. En calant la
  // décroissance pour qu'elle atteigne le plancher exactement à la coupure, les
  // deux mécanismes disent la même chose au lieu de se contredire.
  // ADV-2026-08-01-FIREFLY : densityFalloff valait 2.81 codé en dur, soit une
  // COPIE de -ln(densityFloor). Rien n'imposait la relation : un commentaire ne
  // la maintient pas, et Object.freeze non plus. Une seule constante source,
  // l'autre dérivée.
  densityFloor: 0.06,
  get densityFalloff() { return -Math.log(this.densityFloor); },

  minHeight: 0.4,        // au-dessus de la surface locale (sol OU plan d'eau)
  maxHeight: 2.2,        // une hotaru traîne, elle ne monte pas

  perchedFraction: 0.25, // posées dans l'herbe, immobiles, clignotant sur place

  driftRadius: [0.5, 2.6],   // amplitude de dérive, unités monde
  driftRate:   [0.10, 0.32], // rad/s ; lent — c'est un vol traînant
  driftLift:   0.18,         // part verticale de la dérive : quasi horizontale

  // 2 s = le rythme de l'OUEST du Japon. L'est bat à 4 s ; 2 s est plus vivant.
  flashPeriod: 2.0,
  flashJitter: 0.25,     // écart individuel autour de la phase du bassin, en secondes
  flashRise: 0.04,       // fraction du cycle : 80 ms à 2 s. Un éclair, pas un sinus.
  flashDecay: 6.0,       // décroissance exponentielle, en unités de cycle

  /*
   * VARIÉTÉ INDIVIDUELLE — sans elle la population bat comme un métronome.
   *
   * Le premier jet donnait à TOUTES les lucioles la même période et le même
   * éclat, portés par des uniformes globaux ; seule la phase changeait. C'est
   * exactement le défaut que la synchronie par bassin devait éviter, réintroduit
   * un cran plus bas : trois groupes qui pulsent, mais chaque groupe rigide.
   *
   * La difficulté est qu'on ne peut pas simplement randomiser la période : la
   * synchronie par bassin est le comportement réel des genji-botaru, et des
   * périodes toutes différentes la dissoudraient en quelques dizaines de
   * secondes. La sortie est de garder le CHOEUR sur une période commune et de
   * faire varier tout le reste — plus une minorité de solitaires.
   */
  brightness: [0.30, 1.0],   // éclat individuel : une luciole proche n'a pas l'éclat d'une lointaine
  decayJitter: [0.62, 1.55], // durée du flash ; toutes identiques = des flashes tamponnés
  // Part qui NE rejoint PAS le choeur de son bassin, avec sa période propre.
  // Biologiquement vrai : tous les mâles ne se joignent pas au chant, et ce sont
  // ces traînards qui empêchent l'ensemble de lire comme une horloge.
  loneFraction: 0.22,
  lonePeriod: [1.25, 3.60],

  size: [0.13, 0.20],    // demi-côté du quad, unités monde

  color: 0x9dff6a,       // jaune-vert, ~560 nm

  // Surtension pour passer le seuil de bloom. ATTENTION : le seuil n'est PAS le
  // 0.85 du constructeur — K_BLOOM_THRESHOLD (sky.js) l'écrase chaque frame et
  // vaut 0.42 en pleine nuit. Étalons de la scène : fire box de lanterne 2.6
  // (sphère r 0.185), flamme de bougie du hokora 1.55 (r 0.019). Une luciole
  // doit sortir entre 1.5 et 1.8.
  overdrive: 1.6,

  // Pic d'activité après le crépuscule, en `phase.solar` : les vraies culminent
  // dans les deux heures qui suivent le coucher, pas toute la nuit à plat.
  peakSolar: 0.82,
  peakWidth: 0.16,
  peakFloor: 0.45,       // activité résiduelle au cœur de la nuit
});

/**
 * Papillons — le versant diurne de la faune, dont les lucioles sont le nocturne.
 *
 * Deux espèces, parce qu'une seule lit comme un clone dupliqué. Au printemps la
 * petite blanche (Pieris rapae) et le machaon asiatique (Papilio xuthus) ; à
 * l'automne la blanche cède la place au tateha roux (Vanessa indica), qui
 * HIVERNE À L'ÉTAT ADULTE — c'est précisément pourquoi on la voit encore voler
 * en novembre quand les autres espèces sont à l'état d'oeuf ou de chrysalide.
 *
 * Le vol est la signature : les Pieris de printemps volent LENTEMENT et à FORTE
 * COURBURE de trajectoire. Ce n'est pas l'arc lisse d'un boid — c'est un zigzag.
 */
/*
 * ÉCHELLE — les insectes de ce projet sont volontairement surdimensionnés d'un
 * ordre de grandeur, et c'est un CHOIX, pas une dérive.
 *
 * Étalonnage du monde sur deux objets connus : le shiba (garrot 0.66 u pour
 * ~40 cm réels) donne 1 u ≈ 0.61 m, la lanterne de pierre (2.0 u pour ~1.8 m)
 * donne 0.90 m. En prenant 0.9 m :
 *
 *   machaon        rendu 65 cm  · réel 7-9 cm    · ×8.1
 *   petite blanche rendu 31 cm  · réel 3.2-4.7 cm · ×7.7
 *   luciole        rendu 18 cm  · réel ~1.5 cm    · ×12
 *
 * À l'échelle vraie une blanche ferait 0.044 u : sous le pixel à toute distance
 * de jeu, donc invisible — l'exact contraire de ce que ces chantiers visent.
 * Ce qui EST tenu, en revanche, c'est le rapport entre les deux espèces :
 * 0.72/0.34 = 2.12 contre 2.0 dans la nature, à 6 % près.
 */
export const BUTTERFLIES = Object.freeze({
  bigFraction: 0.30,      // part de machaons : les grands sont plus rares

  // — petite espèce (blanche au printemps, tateha roux à l'automne) —
  small: {
    span: 0.34,           // envergure, unités monde
    speed: [1.4, 2.4],
    cruiseY: [0.3, 1.5],  // au-dessus du sol : elle butine bas
    flapRate: [9.0, 13.0],// battements/s — rapide et irrégulier
    veerChance: 0.16,     // probabilité d'embardée sèche par seconde
    veerAmount: 1.5,      // radians
    bob: 0.16,            // tangage vertical calé sur le battement
    glideChance: 0.0,     // une blanche ne plane pas
  },
  // — machaon : plus grand, plus rapide, plus haut, il PLANE —
  big: {
    span: 0.72,
    speed: [2.2, 3.4],
    cruiseY: [1.6, 4.0],
    flapRate: [4.5, 7.0],
    veerChance: 0.06,
    veerAmount: 0.9,
    bob: 0.10,
    glideChance: 0.35,    // fraction du temps ailes tendues, sans battre
  },

  turnRate: 2.6,          // rad/s max — au-delà le vol lit comme un missile

  // — butinage —
  perchChance: 0.5,       // probabilité de viser une fleur en fin d'errance
  perchSeconds: [1.5, 5.0],
  approachRadius: 14,     // rayon de recherche d'une fleur cible
  arriveDist: 0.35,

  // — fuite —
  // 4 u, pas les 26 u des oiseaux : on approche un papillon de TRÈS près avant
  // qu'il ne parte, et un papillon qui décolle à 26 u lit comme un oiseau.
  fleeRadius: 4.0,
  fleeSeconds: [2.0, 4.0],
  fleeSpeed: 5.0,

  // — domaine —
  // Rappel SOUPLE, et vers l'ANCRE PROPRE À CHAQUE INDIVIDU (sa fleur
  // d'éclosion), surtout pas vers le barycentre global du champ.
  //
  // Le champ de fleurs fait 633 × 637 unités : un rappel vers son centre
  // ramènerait toute la population au même endroit et viderait la périphérie.
  // Et c'est aussi ce que font les vrais Pieris — la littérature parle de vol
  // exploratoire sur leur « natal patch », pas de transhumance insulaire.
  //
  // Souple, jamais un mur : un papillon qui rebondit sur une frontière
  // invisible se dénonce immédiatement.
  homeRadius: 70,         // autour de l'ancre individuelle
  homePull: 1.8,

  // — jour —
  // Miroir de fireflyActivity : allumés en plein jour, éteints la nuit.
  duskFade: 0.35,         // part du crépuscule où ils volent encore
});

/**
 * Landmarks authorés de la côte (lot 1) et prises pour les lots suivants.
 *
 * N est un, donc rien ici ne scale en AREA. Les rayons de collision sont
 * légèrement plus larges que le mesh : le chien ne doit pas s'enfoncer
 * dans le fût ni le plateau.
 */
export const POI = Object.freeze({
  pineSearch: 12 * LAND_SCALE, // marche max depuis le terminus `plage`
  pineStep: 0.25,
  pathClear: 0.25,             // extra isOnPath — même marge que l'herbe rase
  sandCeil: WORLD.beachTop + 0.6,
  pineLean: 0.22,              // radians, vers l'intérieur (vent de mer)
  pineTrunkR: 0.45,
  rockR: 0.9,
  rockOffset: 1.85,            // vers le large, depuis le fût
  rockPlateau: 1.4,
  rockSink: 0.14,

  // Lot 3 — signes sacrés. N=1, pas d'AREA. Décalage jizō = PATH_HALF + extra.
  jizoPathExtra: 1.2,
  jizoSearch: 5.0,
  jizoStep: 0.35,
  jizoR: 0.38,
  // PONDS[0] déjà LAND_SCALEd — ne pas remultiplier.
  pondBig: [16 * LAND_SCALE, -42 * LAND_SCALE],
  pondBigR: 7.2 * LAND_SCALE,
  tsukubaiPathExtra: 0.55,
  tsukubaiSearch: 18,
  tsukubaiStep: 0.45,
  tsukubaiR: 0.48,
  iwakuraMax: 2,

  // Lot 7 — chashitsu. Pond centres already LAND_SCALEd (ponds.js SITES).
  ponds: Object.freeze([
    Object.freeze({ x: 16 * LAND_SCALE, z: -42 * LAND_SCALE, r: 7.2 * LAND_SCALE }),
    Object.freeze({ x: -4 * LAND_SCALE, z: -73 * LAND_SCALE, r: 5.2 * LAND_SCALE }),
    Object.freeze({ x: 20 * LAND_SCALE, z: -70 * LAND_SCALE, r: 4.0 * LAND_SCALE }),
  ]),
  chashitsuPathExtra: 4,         // same corridor the forest already refuses
  chashitsuSlopeMax: 0.25,
  chashitsuHMin: 3.0,            // prairie, above the sand/dune band
  chashitsuHMax: 10.5,           // meadow shelf sits ~7.6; below the west rim
  chashitsuHTarget: 5.4 * HEIGHT_SCALE,
  chashitsuKeepOut: 6,
  chashitsuPostR: 0.20,
  chashitsuOffsetMin: 9,
  chashitsuOffsetMax: 22,
  chashitsuStep: 0.55,
  chashitsuBankClear: 5.5,       // stay off the tsukubai / wet berm
  chashitsuFoot: 2.05,
  chashitsuMaxTilt: 0.42,
  chashitsuJuncClear: 14,
});

/**
 * Crabes de laisse. Même bande que les galets de details.js.
 * N vit sur QUALITY.crabs (10 / 18 / 28) — trop peu et trop local pour AREA_SOFT.
 */
export const CRABS = Object.freeze({
  fleeRadius: 6.0,
  fleeSpeed: 2.8,
  fleeSeconds: [0.85, 1.55],
  burySeconds: 1.1,
  strandLo: -0.55,
  strandHi: WORLD.beachTop * 0.85,
  minSep: 1.15,
  homeRadius: 2.2,
  shuffleSpeed: 0.55,
  size: [0.88, 1.18],
  sampleHalfX: 112 * LAND_SCALE,
  sampleMinZ: -120 * LAND_SCALE,
  sampleMaxZ: 104 * LAND_SCALE,
});

/**
 * Mites autour des lanternes de route (lot 5).
 *
 * N = lanternes × QUALITY.moths (0.5 / 1 / 2). Pas AREA_SOFT : l'habitat
 * est le réseau de lanternes, pas l'île. Les bougies du hokora n'en ont
 * pas — lanternSpots ne les porte déjà pas.
 */
export const MOTHS = Object.freeze({
  perLantern: { low: 0.5, high: 1, ultra: 2 },
  maxSpawnDist: 2.6,         // invariant : chaque spawn ≤ cette distance d'une lanterne
  spawnRadius: 0.55,         // disque autour du pied, largement sous 2.6
  hoverHeight: [1.35, 1.85], // autour de la cage à feu (glow à h+1.56)
  driftRadius: [1.4, 2.2],   // halo serré, pas le vol traînant des hotaru
  driftRate:   [0.35, 0.90], // plus vif qu'une luciole
  driftLift:   0.20,         // quasi horizontal autour de la flamme
  size: [0.10, 0.16],
  color: 0xffc878,           // chaud — disjoint du jaune-vert des lucioles
  overdrive: 1.40,
  brightness: [0.45, 1.0],
  flickerRate: [1.8, 3.6],
});

/**
 * Pas japonais — grand étang seulement (PONDS[0], déjà LAND_SCALEd).
 * N petit, dalles en unités monde. Ne pas remultiplier par LAND_SCALE.
 */
export const STONES = Object.freeze({
  countMin: 5,
  countMax: 7,
  count: 6,
  lift: 0.04,              // dessus = pondWaterYAt + lift
  koiClear: 0.35,          // hors disque central des koi
  maxGap: 1.1,             // écart bord-à-bord, le shiba peut poser
  radius: [0.42, 0.56],
  thickness: 0.11,
  heading: 0.45,           // azimut de recherche initial
  zigzag: 0.14,
});

/**
 * Hérons / aigrettes. N = QUALITY.herons (1 / 2 / 3). Pas AREA_SOFT.
 * Pattes dans les bas-fonds, hors le disque koi ; envol si shiba < flushRadius.
 */
export const HERONS = Object.freeze({
  flushRadius: 14,
  flySpeed: 7.2,
  cruiseY: [2.4, 4.2],
  shallowMin: 0.06,
  shallowMax: 0.48,
  koiClear: 0.35,
  minSep: 4.2,
  peckSeconds: [0.55, 0.85],
  idleSeconds: [1.8, 5.5],
  size: [0.92, 1.12],
});

/**
 * Libellules — nappe GPU au-dessus des bassins, patron lucioles.
 * Actives le jour (`1 - phase.night`). Budget AREA_SOFT petit (≈ 8 / 18 / 32).
 */
export const DRAGONFLIES = Object.freeze({
  habitatK: 0.88,          // fraction du rayon mesuré — sur l'eau, pas la prairie
  minHeight: 0.3,          // au-dessus de waterY
  maxHeight: 1.4,
  driftRadius: [0.18, 0.70],
  driftRate:   [0.85, 1.85],
  driftLift:   0.22,
  size: [0.20, 0.32],
  color: 0x2ec4a0,
  wingColor: 0xa8ffe6,
});

/**
 * Torii marin (lot 4). Un stack AUTHORÉ — les cinq stacks tirés au rng
 * `island:rocks` bougent avec ROCK_TOTAL et le pas du bake, donc aucun
 * n'est une silhouette stable depuis CAMERA.start ET le pin de la plage.
 * Même leçon que SPRING_ROCKS : zéro tirage rng, les autres rochers
 * restent où ils étaient.
 */
export const SEA_TORII = Object.freeze({
  stack: Object.freeze({
    x: 56 * LAND_SCALE,
    z: 108 * LAND_SCALE,
    s: 3.2,
    ky: 1.25,
    shape: 4,
    yaw: 0.65,
    sink: 0.28,
  }),
  offset: 7.2,   // vers le terminus `plage` : le portail se lit depuis le sable
  scale: 1.55,   // la montée terrestre est à 1.35
  baseY: 0.05,
});

/**
 * Goélands. N vit sur QUALITY.gulls (6 / 10 / 16) — habitat local (stacks
 * + nuki), pas AREA_SOFT.
 */
export const GULLS = Object.freeze({
  flushRadius: 20,
  cameraFlush: 8,
  flySeconds: [8.5, 14],
  preenSeconds: [1.1, 1.8],
  idleSeconds: [2.4, 5.5],
  size: [0.92, 1.18],
  nukiAlong: Object.freeze([-1.35, 0, 1.35]),
  perchSep: 0.55,
  orbitRadius: 11,
  flyHeight: 7.5,
});

/**
 * Bosquet de bambous (lot 8). Local — la bosse est déjà LAND_SCALEd
 * (`island.js` BUMPS[0]). Compte en AREA_SOFT via QUALITY.bamboo ;
 * instances un peu plus grandes. Ne pas remultiplier le centre.
 */
export const BAMBOO = Object.freeze({
  cx: 56 * LAND_SCALE,
  cz: -10 * LAND_SCALE,
  radius: 13 * LAND_SCALE,
  pathClear: 0.8,            // extra isOnPath — hors ruban, pas hors bosquet
  slopeMax: 0.32,
  hMin: 2.4,
  hMax: 34,                 // la bosse est culmine ~24–28 u
  minSep: 1.65,
  scale: Object.freeze([1.18, 1.58]),
});
