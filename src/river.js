/**
 * river.js — a watercourse across the island, and the bridge that crosses it.
 * One trunk from the ridge, splitting at an authored junction into a delta
 * that reaches the sea at three mouths (see RIVER.branches in config.js).
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
import { makeWoodBump } from './detailtex.js';

/* ────────────────────────────────────────────────────────────────
   Curve + spatial index
   ──────────────────────────────────────────────────────────────── */

/**
 * One entry per watercourse: index 0 is the trunk, the rest are the delta's
 * distributaries. Each keeps its own curve, sample tables, water profile and
 * mouth fade; the spatial index and the baked field below are min-combined
 * over all of them, so every consumer (terrain carve, rejection sampling)
 * sees one river system with three mouths.
 */
const BRANCHES = [
  { path: RIVER.path, samples: 420, widthK: 1 },
  ...(RIVER.branches || []).map((b) => ({ path: b.path, samples: 120, widthK: b.widthK })),
].map((spec) => {
  const curve = new THREE.CatmullRomCurve3(
    spec.path.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'catmullrom',
    0.5
  );
  const N = spec.samples;
  const pts = curve.getSpacedPoints(N);               // evenly spaced along arc length
  const sx = new Float32Array(N + 1);
  const sz = new Float32Array(N + 1);
  const st = new Float32Array(N + 1);                 // 0..1 along this branch
  for (let i = 0; i <= N; i++) {
    sx[i] = pts[i].x;
    sz[i] = pts[i].z;
    st[i] = i / N;
  }
  return { curve, N, sx, sz, st, widthK: spec.widthK, profile: null, fade: null };
});

const TRUNK = BRANCHES[0];
const curve = TRUNK.curve;   // the bridge and the exported waterYAt keep their trunk meaning

// Read-only test surface: test/invariants.html asserts profile monotonicity
// and mouth separation directly against the branch tables. Not for scene code.
export { BRANCHES };

/**
 * Effective width multiplier at (branch, t). A distributary is trunk-width
 * where its path still overlaps the trunk and narrows to its own share as it
 * diverges — so the carve has no step at the junction. The ramp starts at the
 * junction (the branch's second control point, t ≈ 0.2 of its own arc).
 * Exporté en LECTURE pour test/invariants.html : le check de contention doit
 * sonder les crêtes de digue sur EXACTEMENT les mêmes rayons que build().
 */
export function widthKAt(b, t) {
  // Vasque de naissance : à 0.35× la largeur, le chenal de la source était
  // plus étroit que le pas de la grille de terrain — le bake le lissait en
  // flaque de 3 cm (capture joueur). La source naît en vasque PLEINE largeur
  // (résoluble par la grille : eau profonde entre les rochers du récif), se
  // resserre en goulet, puis reprend sa largeur de croisière.
  if (b === 0) {
    const pool = 1 - smoothstep(0.015, 0.06, t);
    const neck = 0.55 + 0.45 * smoothstep(0.04, 0.12, t);
    return Math.max(pool, neck);
  }
  const k = BRANCHES[b].widthK;
  return 1 + (k - 1) * smoothstep(0.20, 0.55, t);
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

// Buckets hold a packed (branch << 12) | sampleIndex — sample counts stay
// well under 4096, and one flat integer per entry keeps the inner query loop
// allocation-free.
for (let b = 0; b < BRANCHES.length; b++) {
  const br = BRANCHES[b];
  for (let i = 0; i <= br.N; i++) {
    const c = cellOf(br.sx[i], br.sz[i]);
    (grid[c] ||= []).push((b << 12) | i);
  }
}

/* ── baked distance field ─────────────────────────────────────────
 * The exact bucket-walk query (roughly 135 distance tests), evaluated once
 * per cell at module load. Every hot-path caller (terrain vertices, tree
 * placement, grass rejection sampling) reads the baked field instead — prop
 * placement uses rejection sampling and would otherwise pay the exact query
 * millions of times, which is exactly the mistake that made the load time
 * balloon once already.
 */
const FIELD_CELL = 2.5;
const FIELD_N = Math.ceil((HALF * 2) / FIELD_CELL) + 1;

// One distance/t field PER BRANCH, min-combined at query time — not one
// pre-combined field. A combined field has to pick a single branch identity
// per texel while its distance is interpolated across texels, and near the
// Voronoi frontier between trunk and distributary that mismatch fed
// widthKAt() a (b, t) from one branch against a distance blended from both,
// stepping the carve width exactly where the delta must be smoothest.
// ~3 × FIELD_N² × 8 bytes ≈ 9.6 MB — cheap for what it buys.
const NB = BRANCHES.length;
const _fieldDistB = [];
const _fieldTB = [];
for (let b = 0; b < NB; b++) {
  // Clamp rather than store Infinity: NaNs propagate horribly through lerps.
  _fieldDistB.push(new Float32Array(FIELD_N * FIELD_N).fill(REACH * 4));
  _fieldTB.push(new Float32Array(FIELD_N * FIELD_N));
}

{
  // Single bake pass: per cell, walk the 3×3 buckets once and track the best
  // sample PER branch (buckets pack the branch id — see above).
  const bestD2 = new Float64Array(NB);
  const bestT = new Float64Array(NB);
  for (let j = 0; j < FIELD_N; j++) {
    const z = -HALF + j * FIELD_CELL;
    for (let i = 0; i < FIELD_N; i++) {
      const x = -HALF + i * FIELD_CELL;
      bestD2.fill(Infinity);
      const cx = clamp(Math.floor((x + HALF) / CELL), 0, GRID_N - 1);
      const cz = clamp(Math.floor((z + HALF) / CELL), 0, GRID_N - 1);
      for (let dz = -1; dz <= 1; dz++) {
        const rz = cz + dz;
        if (rz < 0 || rz >= GRID_N) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const rx = cx + dx;
          if (rx < 0 || rx >= GRID_N) continue;
          const bucket = grid[rz * GRID_N + rx];
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            const packed = bucket[k];
            const b = packed >> 12, si = packed & 0xfff;
            const br = BRANCHES[b];
            const ddx = x - br.sx[si], ddz = z - br.sz[si];
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 < bestD2[b]) { bestD2[b] = d2; bestT[b] = br.st[si]; }
          }
        }
      }
      const k = j * FIELD_N + i;
      for (let b = 0; b < NB; b++) {
        if (bestD2[b] < Infinity) {
          const d = Math.sqrt(bestD2[b]);
          if (d < REACH * 4) {
            _fieldDistB[b][k] = d;
            _fieldTB[b][k] = bestT[b];
          }
        }
      }
    }
  }
}

const _result = { dist: 0, t: 0, b: 0 };   // reused; never allocate in a hot loop

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

  // Bilinear distance per branch, THEN the min — so dist, t and b all come
  // from the same branch and the returned triplet is coherent. t stays
  // nearest-neighbour within the winning branch (it only selects a station).
  let best = Infinity, bestB = 0;
  for (let b = 0; b < NB; b++) {
    const F = _fieldDistB[b];
    const d = (F[r0 + i] * (1 - tx) + F[r0 + i1] * tx) * (1 - tz)
            + (F[r1 + i] * (1 - tx) + F[r1 + i1] * tx) * tz;
    if (d < best) { best = d; bestB = b; }
  }

  _result.dist = best;
  const kNear = (tz < 0.5 ? r0 : r1) + (tx < 0.5 ? i : i1);
  _result.t = _fieldTB[bestB][kNear];
  _result.b = bestB;
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
/** How much river there still is at (branch, t). 1 upstream, 0 once the banks are sea. */
function fadeAtB(b, t) {
  const br = BRANCHES[b];
  if (!br.fade) return 1;
  const f = clamp(t, 0, 1) * br.N;
  const i = Math.min(br.N, f | 0);
  const i1 = Math.min(br.N, i + 1);
  const a = f - i;
  return br.fade[i] * (1 - a) + br.fade[i1] * a;
}

function waterYAtB(b, t) {
  const br = BRANCHES[b];
  if (!br.profile) {
    // Fallback before build(): a plain descent, only used if something queries
    // the river before the terrain exists.
    return WORLD.seaLevel + Math.pow(1 - t, 1.55) * RIVER.depth + 0.12;
  }
  const f = clamp(t, 0, 1) * br.N;
  const i = Math.min(br.N, f | 0);
  const i1 = Math.min(br.N, i + 1);
  const a = f - i;
  return br.profile[i] * (1 - a) + br.profile[i1] * a;
}

/** Trunk-only views — the bridge and external callers keep their old meaning. */
const fadeAt = (t) => fadeAtB(0, t);
const waterYAt = (t) => waterYAtB(0, t);

/* ────────────────────────────────────────────────────────────────
   1. Terrain carving
   ──────────────────────────────────────────────────────────────── */

/**
 * Height modifier. Compose into the island's heightAt so mesh and sampler agree.
 * Cuts a channel with soft banks and a slightly meandering, noisy edge.
 */
export function carveRiver(x, z, h) {
  const { dist, t, b } = nearestOnRiver(x, z);
  if (dist > REACH) return h;

  // Wobble the effective width so the banks are never parallel lines, and
  // narrow a distributary to its share of the flow once it leaves the trunk.
  const wk = widthKAt(b, t);
  const wob = fbm2(x * 0.035, z * 0.035, 3) * 0.35 + 1;
  const halfW = RIVER.width * 0.5 * wob * wk;
  const bank = RIVER.bankWidth * wob * wk;

  let inChannel = 1 - smoothstep(halfW, halfW + bank, dist);
  if (inChannel <= 0) return h;

  // A river carves LAND, not seabed. Once the surrounding ground has dropped
  // well below the waterline there is nothing left to cut, and cutting anyway
  // drags the trench on out under the sea as a dark groove aimed at the
  // horizon. But the fade must reach a little BELOW sea level: the delta
  // crosses a wide sand flat that sits barely above the waterline, and with
  // the cut dying at +2.2 the three arms had no bed there — the water sank
  // under the sand and the delta read as damp stains instead of channels. A
  // channel that stays carved through the flat and only dissolves once the
  // ground is genuinely seabed is exactly what a real river mouth scours.
  // Bord haut 1.2 -> 0.45 : à 1.2, toute la traversée de la plaine basse
  // (sol entre +0.5 et +1.2) ne creusait qu'à moitié — bol large et plat,
  // crêtes de digue à 20 cm, eau réduite à un film de « sable mouillé ».
  // Une rivière INCISE la plaine : pleine profondeur dès que le sol est
  // franchement au-dessus de la mer, la dissolution sous la mer ne bouge pas.
  inChannel *= smoothstep(WORLD.seaLevel - 0.5, WORLD.seaLevel + 0.45, h);
  if (inChannel <= 0) return h;

  // Cut RELATIVE to the local ground: the bed sits `depth` below whatever the
  // surrounding terrain is here, so the channel follows the landscape down
  // instead of trenching through it.
  const bedY = h - RIVER.depth;

  // Section COMPOSÉE : un chenal net (lèvre à ~1.15·halfW) qui tient l'eau,
  // dans un évasement doux qui devient la berge de sable. L'ancien bol unique
  // pow(u,1.7) étalait tout le creux sur tout le couloir — jusqu'à 40 u de
  // large sur les plats : une soucoupe sans chenal ni berges, où l'eau calée
  // sous la crête du bord s'étalait en lavis de 15 cm. La lèvre donne au
  // profil d'eau (crête échantillonnée juste après halfW) un vrai niveau à
  // tenir, et à la ligne d'eau un vrai sol qui remonte.
  const u = clamp(dist / (halfW + bank), 0, 1);
  const lip = smoothstep(0.55 * halfW, 1.15 * halfW, dist);
  const profile = bedY + (h - bedY) * (0.30 * Math.pow(u, 1.7) + 0.70 * lip);

  return h * (1 - inChannel) + profile * inChannel;
}

/** True inside the wetted channel — used to keep grass and trees out of the water. */
export function isInRiver(x, z) {
  const { dist, t, b } = nearestOnRiver(x, z);
  return dist < RIVER.width * 0.5 * widthKAt(b, t) + 1.5;
}

/**
 * How much of the carved riverbed lives at (x, z): 1 in the wetted channel,
 * fading to 0 across the inner bank. island.js colours the bed with it -
 * the water is transparent now, the bed is ON SCREEN.
 */
export function riverBedFactor(x, z) {
  const { dist, t, b } = nearestOnRiver(x, z);
  const wk = widthKAt(b, t);
  const halfW = RIVER.width * 0.5 * wk;
  // Tablier resserré (0.45 -> 0.26·bank) : dans les références (rivières
  // Ghibli), l'herbe descend presque jusqu'à la ligne d'eau — un lit de
  // sable large de tout le couloir noyait la rivière dans un oued beige.
  return 1 - smoothstep(halfW * 0.9, halfW + RIVER.bankWidth * wk * 0.26, dist);
}

/**
 * Water surface height over (x, z), or null outside the wetted channel (or
 * where the estuary has dissolved into sea). The dog uses it to refuse
 * walking UNDER the water sheet - the sea-level wade rule never fires for a
 * river bed sitting 8 units up the hillside.
 */
export function waterSurfaceYAt(x, z) {
  const { dist, t, b } = nearestOnRiver(x, z);
  if (dist > RIVER.width * 0.5 * widthKAt(b, t) + 1.0) return null;
  const br = BRANCHES[b];
  if (!br.profile) return null;
  if (fadeAtB(b, t) < 0.15) return null;
  return waterYAtB(b, t);
}

/* ────────────────────────────────────────────────────────────────
   2. Water ribbon
   ──────────────────────────────────────────────────────────────── */

/**
 * One ribbon per branch. `startT` lets a distributary's ribbon begin only once
 * it has slid out from under the trunk's — both are transparent with
 * depthWrite off, so overlapping them would double-blend into a dark patch at
 * the junction. The first few segments after startT ramp their fade in from 0
 * so the branch surface slides out from under the trunk instead of starting
 * on a hard edge.
 *
 * @param {number} b       branch index into BRANCHES
 * @param {number} startT  0..1 along the branch where the ribbon starts
 * @param {boolean} faded  whether mouth fade is available yet (post-build)
 */
function buildWaterRibbon(b = 0, startT = 0, faded = false, heightAt = null) {
  const br = BRANCHES[b];
  const N = b === 0 ? 240 : 90;
  const W = RIVER.width * 0.5;
  const RAMP = 8; // segments over which a distributary fades in at the junction
  const pos = [], uv = [], idx = [], fade = [], skirt = [];
  const p = new THREE.Vector3(), tan = new THREE.Vector3();

  // Find the WATERLINE on one side of a station: march outward, bisect the
  // exact spot where the carved ground breaks the surface, then push the edge
  // a little PAST it so it sits inside the rising bank. Returns [dist, breach].
  // breach=false means the ground NEVER rises back over the water along the
  // whole corridor — the sheet is hanging over lower terrain (the delta fan,
  // where three channels carve one shared trough and the « bank » of one arm
  // is the trench of the next ; or a coastal shelf lip). The caller then
  // DRAPES that edge onto the ground instead of leaving a flying table.
  const wettedHalfWidth = (x, z, dx, dz, wMax, waterY) => {
    if (!heightAt) return [wMax, true];
    const gAt = (d) => heightAt(x + dx * d, z + dz * d);
    let lo = 0, hi = wMax, found = false;
    for (let k = 1; k <= 12; k++) {
      const d = wMax * (k / 12);
      if (gAt(d) > waterY - 0.04) { lo = wMax * ((k - 1) / 12); hi = d; found = true; break; }
    }
    if (!found) return [wMax, false];
    for (let k = 0; k < 3; k++) {
      const mid = (lo + hi) * 0.5;
      if (gAt(mid) > waterY - 0.04) hi = mid; else lo = mid;
    }
    return [Math.max((lo + hi) * 0.5 + 0.30, wMax * 0.14), true];
  };

  for (let i = 0; i <= N; i++) {
    const t = startT + (i / N) * (1 - startT);
    br.curve.getPointAt(t, p);
    br.curve.getTangentAt(t, tan);
    // Left-hand normal in the XZ plane.
    const nx = -tan.z, nz = tan.x;
    const len = Math.hypot(nx, nz) || 1;
    // L'EMPREINTE de la nappe reste celle du chenal : largeur wobbulée,
    // plafonnée à width/2 + 0.45·bank — chercher la ligne d'eau sur tout le
    // couloir creusé (0.9·bank) faisait s'étaler la nappe en cellophane sur
    // le sable et l'herbe dès que la berge ne remontait pas (captures du
    // joueur : films de verre sur les plats du delta, herbe à travers l'eau —
    // l'exclusion d'herbe suit la largeur de chenal, pas le couloir). Si la
    // berge ne remonte pas DANS cette borne, le bord se drape au sol À LA
    // frontière du chenal : la petite erreur de ligne d'eau est invisible,
    // l'écume de rive la couvre.
    const wob = fbm2(p.x * 0.03, p.z * 0.03, 2) * 0.28 + 1;
    const flare = faded ? 1 + 0.6 * (1 - fadeAtB(b, t)) : 1;
    const wCorr = Math.min(W * wob * flare, W + RIVER.bankWidth * 0.45) * widthKAt(b, t);
    const y = waterYAtB(b, t);
    const ux = nx / len, uz = nz / len;
    const [wL, brchL] = wettedHalfWidth(p.x, p.z, ux, uz, wCorr, y);
    const [wR, brchR] = wettedHalfWidth(p.x, p.z, -ux, -uz, wCorr, y);
    let f = faded ? fadeAtB(b, t) : 1;
    // Squared so that, combined with the concave alpha curve in the fragment
    // shader (pow 0.55), the junction overlap stays as dim as before — two
    // transparent surfaces over each other double-blend into a dark patch.
    if (b > 0) f *= Math.pow(Math.min(1, i / RAMP), 2.0);
    else f *= smoothstep(0.0, 0.06, t);   // the trunk seeps in from between the spring rocks

    // 4 colonnes par station : [jupe G, bord G, bord D, jupe D].
    // Bord : à la ligne d'eau quand la berge remonte (breach) ; DRAPÉ sur le
    // sol (sol + 0.08) quand elle ne remonte jamais — l'eau verse alors le
    // long de la pente dans le bras voisin ou vers la mer au lieu de rester
    // une table de verre en l'air (l'éventail du delta, capture du joueur).
    // Jupe : plonge sous le SOL LOCAL (et pas d'une profondeur fixe — sur une
    // tranchée voisine profonde, 1.35 u ne suffisait pas), pour combler tout
    // jour d'interpolation entre stations. Enterrée = masquée par le terrain
    // opaque. Le matériau est DoubleSide : pas de piège de winding.
    const exL = p.x + ux * wL, ezL = p.z + uz * wL;
    const exR = p.x - ux * wR, ezR = p.z - uz * wR;
    const eyL = (!brchL && heightAt) ? heightAt(exL, ezL) + 0.08 : y;
    const eyR = (!brchR && heightAt) ? heightAt(exR, ezR) + 0.08 : y;
    const skx = 0.45;
    const gSkL = heightAt ? heightAt(exL + ux * skx, ezL + uz * skx) : eyL - 0.75;
    const gSkR = heightAt ? heightAt(exR - ux * skx, ezR - uz * skx) : eyR - 0.75;
    const syL = Math.max(Math.min(eyL - 0.8, gSkL - 0.6), eyL - 6.0);
    const syR = Math.max(Math.min(eyR - 0.8, gSkR - 0.6), eyR - 6.0);
    pos.push(exL + ux * skx, syL, ezL + uz * skx);
    pos.push(exL, eyL, ezL);
    pos.push(exR, eyR, ezR);
    pos.push(exR - ux * skx, syR, ezR - uz * skx);
    uv.push(0, t * 26);
    uv.push(0, t * 26);
    uv.push(1, t * 26);
    uv.push(1, t * 26);
    fade.push(f, f, f, f);
    // La jupe est marquée : le fragment y coupe écume et brillance. Une face
    // quasi verticale déclenche l'écume cascade (fwidth), et dans l'éventail
    // du delta les jupes d'un bras pendent DANS le chenal mouillé du voisin —
    // sans ce flag elles dessinaient des lignes blanches géométriques à
    // travers l'eau. La jupe bouche un jour, elle ne joue pas l'eau vive.
    // Un bord DRAPÉ est marqué aussi, mais modérément (0.5) : posé à
    // sol+0.08 au fond de la tranchée d'un autre bras, sa profondeur ≈ 0 le
    // peignait en « eau peu profonde » pâle sous l'eau du voisin — une
    // couture claire. Le flag s'interpole jusqu'à l'autre bord (2 colonnes
    // intérieures seulement) : le garder bas limite la casse au centre.
    skirt.push(1, brchL ? 0 : 0.5, brchR ? 0 : 0.5, 1);

    if (i < N) {
      const a = i * 4;
      for (let c = 0; c < 3; c++) {
        idx.push(a + c, a + c + 1, a + c + 4, a + c + 1, a + c + 5, a + c + 4);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
  g.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirt, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const RIVER_VERT = /* glsl */ `
  attribute float aFade;
  attribute float aSkirt;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vFade;
  varying float vSkirt;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vFade = aFade;
    vSkirt = aSkirt;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // A living surface: two travelling micro-swells plus fine chop. The edges
    // are tucked into the banks and skirted, so the bob never opens a gap;
    // vWorld.y feeds the fragment depth, so colour, alpha and the waterline
    // foam all breathe with it.
    wp.y += (sin(wp.x * 0.55 + uTime * 1.7) + sin(wp.z * 0.47 - uTime * 2.3)) * 0.045
          + sin((wp.x + wp.z) * 1.3 + uTime * 3.1) * 0.02;
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
  uniform vec3  uMouthCol;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform vec3  uSkyColor;
  // Baked terrain heightfield - same contract as island.js WATER_COMMON,
  // duplicated here on purpose: importing it from island.js would create an
  // ESM cycle (island imports riverBedFactor from this module).
  uniform sampler2D uHeightMap;
  uniform vec2  uMapMin;
  uniform float uMapStep;
  uniform float uMapRes;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vFade;
  varying float vSkirt;
  #include <fog_pars_fragment>

  float terrainH(vec2 p) {
    vec2 gi = (p - uMapMin) / uMapStep;
    vec2 uv2 = clamp((gi + 0.5) / uMapRes, vec2(0.0), vec2(1.0));
    return texture2D(uHeightMap, uv2).r;
  }

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
    float r1 = vnoise(vec2(vUv.x * 22.0, s * 5.5));
    float r2 = vnoise(vec2(vUv.x * 44.0 + 4.7, s * 11.0));
    // Clapot en ESPACE MONDE : les rides en UV de spline s'étirent sur toute
    // la longueur du chenal et disparaissent en incidence rasante — vue à
    // hauteur de chien, la surface était une cellophane sans matière. Cette
    // couche a une densité constante partout et anime les normales, donc les
    // reflets accrochent à ras de l'eau.
    float chop = vnoise(vWorld.xz * 1.5 + vec2(uTime * 0.4, -uTime * 0.6));
    float ripple = r1 * 0.5 + r2 * 0.25 + chop * 0.25;

    // REAL depth: surface height minus the carved bed under this fragment,
    // read from the same baked heightfield the ocean uses. This is what turns
    // the ribbon from a painted sprite into water you look INTO - colour,
    // transparency, foam and the waterline all key off it.
    float depth = vWorld.y - terrainH(vWorld.xz);
    // Rampe courte (2.6 -> 1.2) : la heightmap lisse la tranchée étroite et
    // sous-estime la profondeur réelle — les biefs de 30-80 cm perçus doivent
    // déjà tirer vers le teal profond, sinon la traversée du plat delta lit
    // comme du sable mouillé, pas comme une rivière.
    float depthN = smoothstep(0.03, 1.2, depth);

    vec3 col = mix(uShallow, uDeep, depthN * (0.75 + 0.25 * ripple));

    // Elongated pale filaments drifting downstream - the current made visible,
    // strongest over the shallows.
    float streak = vnoise(vec2(vUv.x * 6.0, s * 2.5));
    col += vec3(0.05, 0.07, 0.07) * smoothstep(0.62, 0.90, streak) * (1.0 - depthN * 0.6);

    // Cheap specular: perturb a flat-up normal by the ripple gradient.
    vec3 n = normalize(vec3((r2 - r1) * 0.9 + (chop - 0.5) * 0.8, 1.0,
                            (r1 - r2) * 0.9 - (chop - 0.5) * 0.8));
    float spec = pow(max(dot(reflect(-uSunDir, n), normalize(cameraPosition - vWorld)), 0.0), 48.0);
    col += uSunColor * spec * 0.55 * (1.0 - vSkirt);

    // Sky reflection at grazing angles only - a flat sky fraction everywhere
    // is what reads as a paved road instead of water.
    vec3 viewDir = normalize(cameraPosition - vWorld);
    // Miroir plafonné à 0.12 : sans reflets détaillés (arbres, berges), le
    // fresnel vers un ciel clair délave toute la surface en cellophane pâle
    // dès que la caméra est à hauteur d'eau — la couleur du corps d'eau doit
    // dominer, c'est le choix des eaux stylisées.
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    col = mix(col, uSkyColor, fres * 0.12 * (1.0 - vSkirt));

    // Mouth zone: as the banks fade the river is becoming SEA.
    float mouth = 1.0 - smoothstep(0.12, 0.55, vFade);
    col = mix(col, uMouthCol, mouth * 0.5);

    // Foam at the WATERLINE: the shallow rim where the surface meets the bed,
    // plus cresting ripples at the mouth. The rim line is what anchors the
    // surface to its banks instead of floating over them.
    float rim = 1.0 - smoothstep(0.0, 0.55, depth);
    float foam = max(smoothstep(0.72, 0.95, ripple) * rim,
                     smoothstep(0.80 - 0.22 * mouth, 0.97 - 0.12 * mouth, ripple) * mouth * 0.65);
    // Rapids: where the surface FALLS relative to its horizontal run the
    // river is dropping down a bed step - churn it white instead of letting a
    // smooth tilted slab of water read as a glass ramp. The derivative RATIO
    // is view-invariant; raw fwidth would foam all distant water at grazing.
    float cascade = fwidth(vWorld.y) / max(fwidth(vWorld.x) + fwidth(vWorld.z), 1e-4);
    foam = max(foam, smoothstep(0.10, 0.30, cascade) * (0.55 + 0.35 * ripple));
    // La JUPE ne mousse pas et ne brille pas : c'est un rabat qui bouche les
    // jours sous les bords, pas de l'eau vive. Quasi verticale, elle sature
    // l'écume cascade et le fresnel, et dans l'éventail du delta elle pend
    // dans le chenal du bras voisin — laissée brillante, elle raye l'eau de
    // lignes blanches géométriques.
    foam *= 1.0 - vSkirt;
    col = mix(col, uDeep, vSkirt * 0.55);
    col = mix(col, vec3(0.92, 0.95, 0.96), foam * 0.62);

    if (vFade < 0.004) discard;
    // Transparency follows depth: thin water is glass over the sandy bed, the
    // channel heart stays opaque enough to read as a river; vFade still
    // dissolves the estuary tips. The dark-arms complaint at the delta dies
    // here - centimetres of water over sand render nearly clear.
    // Plancher relevé : à 0.26 l'eau de moins d'un demi-mètre était du verre
    // invisible et les biefs peu profonds lisaient comme des oueds à sec —
    // la rivière doit se LIRE comme une rivière, style féérique assumé. Le
    // bord reste doux (0.30) pour que la ligne d'eau fonde dans la berge.
    // 0.92 au coeur : une eau « profonde » dont on voit le lit n'est pas
    // profonde — le fond doit disparaître là où le chien perd pied.
    // PAS de réduction d'alpha par vSkirt : avec 2 colonnes intérieures, le
    // flag d'un bord drapé s'interpole à travers TOUTE la nappe — chaque
    // bief à bord drapé perdait un tiers d'alpha sur la moitié de sa largeur
    // et rendait laiteux (le « délavé » qui a survécu à trois réglages de
    // couleur). Le flag ne coupe que écume/spéculaire/fresnel.
    float alpha = mix(0.34, 0.92, depthN);
    alpha = max(alpha, foam * 0.75);
    gl_FragColor = vec4(col, alpha * pow(vFade, 0.55));
    #include <fog_fragment>
  }
`;

/* ────────────────────────────────────────────────────────────────
   3. The bridge — taiko-bashi
   ──────────────────────────────────────────────────────────────── */

let _woodBump = null;   // shared, lazily created — see note in buildBridge

/**
 * A humped wooden garden bridge. Built from primitives rather than a mesh file:
 * an arched deck of transverse planks, two curved handrails on posts, and piles
 * driven into the bed. The steep camber is the whole character of the form —
 * a flat plank across a stream reads as a boardwalk, not as a garden bridge.
 */
function buildBridge(group, heightAt = null) {
  const span = RIVER.bridgeSpan;
  const halfW = RIVER.bridgeWidth * 0.5;
  const rise = RIVER.bridgeRise;

  // Generated wood grain (streaks along U — see detailtex.js). One texture
  // shared by the three timber materials; box/cylinder UVs carry it. Created
  // once at module scope: build() may run more than once, and material
  // disposal does not dispose textures — recreating it here would leak.
  if (!_woodBump) { _woodBump = makeWoodBump(20260727); _woodBump.repeat.set(2, 1); }
  const woodBump = _woodBump;
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.82, metalness: 0.0, bumpMap: woodBump, bumpScale: 0.35 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x5f3b26, roughness: 0.88, metalness: 0.0, bumpMap: woodBump, bumpScale: 0.35 });
  const rail = new THREE.MeshStandardMaterial({ color: 0x7d4a30, roughness: 0.8, metalness: 0.0, bumpMap: woodBump, bumpScale: 0.28 });

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

  // — piles into the riverbed (long enough to reach the deeper carve) —
  for (const u of [-0.62, 0.62]) {
    for (const side of [-1, 1]) {
      const pile = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.2, 8.5, 8),
        woodDark
      );
      pile.position.set(u * span * 0.5, arch(u) - 4.2, side * (halfW - 0.5));
      pile.castShadow = true;
      bridge.add(pile);
    }
  }

  // — place and orient it across the river —
  const p = curve.getPointAt(RIVER.bridgeAt);
  const tan = curve.getTangentAt(RIVER.bridgeAt);
  // The deck's long axis (+X) must lie ACROSS the flow, i.e. along the normal.
  const ry = Math.atan2(tan.x, tan.z);
  // Local +X expressed in world space for this yaw — used to find where the
  // two abutments actually land on the banks.
  const ax = Math.cos(ry), az = -Math.sin(ry);

  // Seat the bridge on the BANKS, not on the water: with a fixed water-relative
  // height the deck ends either bury themselves in a high bank or hang in the
  // air over a low one. The river runs along a hillside, so first slide the
  // deck along its own axis to the position where the two abutments land most
  // level with each other; then float the arch so the higher bank meets its
  // deck end flush, and close the remaining gap with low stone footings.
  const wy = waterYAt(RIVER.bridgeAt) + 0.55;
  let shift = 0, gA = wy, gB = wy;
  if (heightAt) {
    let best = Infinity;
    for (let s = -12; s <= 12; s += 1) {
      const a = heightAt(p.x + ax * (s + span * 0.5), p.z + az * (s + span * 0.5));
      const b = heightAt(p.x + ax * (s - span * 0.5), p.z + az * (s - span * 0.5));
      const cost = Math.abs(a - b) + Math.abs(s) * 0.08; // stay near the water unless it pays
      if (cost < best) { best = cost; shift = s; gA = a; gB = b; }
    }
  }
  const cx2 = p.x + ax * shift, cz2 = p.z + az * shift;
  const baseY = Math.max(wy, Math.max(gA, gB) + 0.10);

  const stone = new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.95, metalness: 0.0 });
  for (const [side, g] of [[1, gA], [-1, gB]]) {
    const hF = Math.min(4.0, Math.max(0.6, baseY - g + 0.5));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(2.8, hF, RIVER.bridgeWidth * 1.06), stone);
    foot.position.set(side * span * 0.5, 0.10 - hF * 0.5, 0);
    foot.castShadow = foot.receiveShadow = true;
    bridge.add(foot);
  }

  bridge.position.set(cx2, baseY, cz2);
  bridge.rotation.y = ry;

  group.add(bridge);

  // The FINAL placement, shift included, as shared data. The pilgrim path and
  // the abutment lanterns must derive from this — recomputing the nominal
  // position from RIVER elsewhere lands them up to 12 units off the real deck.
  const info = {
    center: { x: cx2, z: cz2 },
    axis: { x: ax, z: az },        // local +X (deck long axis) in world space
    yaw: ry,
    baseY,
    shift,
    span,
    ends: [
      { x: cx2 + ax * span * 0.5, z: cz2 + az * span * 0.5, ground: gA },
      { x: cx2 - ax * span * 0.5, z: cz2 - az * span * 0.5, ground: gB },
    ],
  };
  return { bridge, info };
}

/* ────────────────────────────────────────────────────────────────
   Factory
   ──────────────────────────────────────────────────────────────── */

export function createRiver({ wind } = {}) {
  const group = new THREE.Group();
  group.name = 'river';

  // Scene objects owned by build(), replaced (not stacked) on a rebuild.
  const branchMeshes = [];
  let bridgeMesh = null;

  // Captured by build() so the deck's approach aprons can blend onto the banks.
  let _groundAt = null;

  const DECK_APRON = 2.6;  // metres past each abutment the approach ramp blends
  const DECK_TOP = 0.08;   // planks are 0.16 thick, centred on the arch curve

  /**
   * Walkable height of the bridge deck at (x, z), or null when the column is
   * not on the deck (or the bridge is not built yet). Inside the span this is
   * the plank top; over each abutment it blends down onto the bank over
   * DECK_APRON so a walker is lifted smoothly instead of stepping up a ledge.
   * O(1), allocation-free — safe to call several times per frame.
   */
  function bridgeDeckHeightAt(x, z) {
    const info = api.bridgeInfo;
    if (!info) return null;
    const dx = x - info.center.x, dz = z - info.center.z;
    const ax = info.axis.x, az = info.axis.z;
    const s = dx * ax + dz * az;                 // along the deck's long axis
    const halfS = info.span * 0.5;
    const as = Math.abs(s);
    if (as > halfS + DECK_APRON) return null;
    const q = -dx * az + dz * ax;                // across the deck
    if (Math.abs(q) > RIVER.bridgeWidth * 0.5) return null;
    const u = clamp(s / halfS, -1, 1);
    const deckY = info.baseY + RIVER.bridgeRise * (1 - u * u) + DECK_TOP;
    if (as <= halfS) return deckY;
    // Approach apron: past the abutment, ease the deck-end height onto the bank.
    const k = smoothstep(0, 1, (as - halfS) / DECK_APRON);
    const g = _groundAt ? _groundAt(x, z) : deckY;
    return deckY + (g - deckY) * k;
  }

  /**
   * Upward surface normal of the deck at (x, z) into `out` (a Vector3).
   * Returns false (out untouched) off the strict span — callers fall back to
   * the terrain normal there.
   */
  function bridgeDeckNormalAt(x, z, out) {
    const info = api.bridgeInfo;
    if (!info) return false;
    const dx = x - info.center.x, dz = z - info.center.z;
    const ax = info.axis.x, az = info.axis.z;
    const s = dx * ax + dz * az;
    const halfS = info.span * 0.5;
    if (Math.abs(s) > halfS) return false;
    const q = -dx * az + dz * ax;
    if (Math.abs(q) > RIVER.bridgeWidth * 0.5) return false;
    // Deck is y = baseY + rise*(1 - (s/halfS)^2), so dy/ds = -2*rise*s/halfS^2.
    const dyds = -2 * RIVER.bridgeRise * s / (halfS * halfS);
    out.set(-dyds * ax, 1, -dyds * az).normalize();
    return true;
  }

  /**
   * Called once the terrain exists. Samples the carved bed along the
   * centreline and lifts a water surface that FOLLOWS it — smoothed along the
   * flow, locally capped under each levee crest — then builds the ribbons and
   * the bridge on top.
   */
  /**
   * Nearest sample on the TRUNK only. Used to pin a distributary's water level
   * to the trunk's through the junction, and to find where its ribbon can
   * start. Brute force over 421 stations — build-time only, a few hundred
   * calls total.
   */
  function nearestOnTrunk(x, z) {
    let best = Infinity, bt = 0;
    for (let i = 0; i <= TRUNK.N; i++) {
      const dx = x - TRUNK.sx[i], dz = z - TRUNK.sz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bt = TRUNK.st[i]; }
    }
    return { dist: Math.sqrt(best), t: bt };
  }

  function build(heightAt, terrainU = null) {
    // Borrow the island's baked-heightfield uniform OBJECTS by reference, so
    // the fragment's terrainH sees exactly the carved bed. Added after the
    // material was created: fine - the program compiles at first render,
    // long after boot wires this up.
    if (terrainU) {
      uniforms.uHeightMap = terrainU.uHeightMap;
      uniforms.uMapMin = terrainU.uMapMin;
      uniforms.uMapStep = terrainU.uMapStep;
      uniforms.uMapRes = terrainU.uMapRes;
    }
    // Trunk first: a distributary pins its junction water to the trunk's.
    //
    // v4 — l'eau ÉPOUSE le terrain (modèle Waterways/Godot), par station et
    // LOCALEMENT ; il n'y a PLUS de profil monotone global. Les v1–v3
    // clampaient un « jamais-remonter » : toute selle basse propageait son
    // niveau vers l'aval — dès que le lit remontait, l'eau passait DESSOUS
    // (tronçon de sable sec) ; et le plafond de crête, propagé, drainait des
    // biefs entiers en flaques. Un profil monotone au-dessus d'un lit qui
    // ondule est insoluble. Politique v4, par station, sans propagation :
    //   surface = lit + 0.72·depth, plafonnée à (crête de digue la plus
    //   basse − 0.10), PLANCHER lit + 0.14 — le plancher gagne : la
    //   continuité du fil d'eau prime, et là où la crête est dégénérée le
    //   ruban se rétrécit à la vraie ligne d'eau (marche dans
    //   buildWaterRibbon) avec une jupe enterrée.
    // Les descentes raides restent (cascades — l'écume fwidth les blanchit) ;
    // les remontées résiduelles sont adoucies par le lissage 1-2-1, pas
    // interdites par un clamp global.
    for (let b = 0; b < BRANCHES.length; b++) {
      const br = BRANCHES[b];
      const N = br.N;
      br.profile = new Float32Array(N + 1);

      const bed = new Float32Array(N + 1);
      const lvCeil = new Float32Array(N + 1);
      const _tanC = new THREE.Vector3();
      for (let i = 0; i <= N; i++) {
        bed[i] = heightAt(br.sx[i], br.sz[i]);
        // Crête de digue PAR CÔTÉ : le max du sol le long du rayon de berge.
        // Sur un travers de pente c'est le rebord du bol creusé avant que le
        // versant ne retombe — c'est lui qui contient la nappe, pas le sol à
        // un offset unique.
        br.curve.getTangentAt(i / N, _tanC);
        const nx = -_tanC.z, nz = _tanC.x;
        const l = Math.hypot(nx, nz) || 1;
        const wHalf = RIVER.width * 0.5 * widthKAt(b, i / N);
        // Une digue est du sol SEC : un rayon qui tombe dans le chenal mouillé
        // d'un autre bras (l'éventail du delta creuse une auge commune) mesure
        // la tranchée du voisin, pas une berge — le prendre en compte écrasait
        // l'eau de tout l'éventail en film invisible (« oued à sec » vu du
        // ciel). Un côté sans AUCUN échantillon sec n'impose pas de plafond :
        // l'eau peut y rejoindre l'eau.
        // Rayon calé sur la LÈVRE du chenal (halfW+0.5 → halfW+3, cf. la
        // section composée de carveRiver) : c'est elle qui tient l'eau. Un
        // rayon plus long (0.85·bank) attrapait des crêtes au-delà du bord du
        // ruban (tentes drapées) ; l'empreinte entière du ruban, des crêtes de
        // soucoupe trop basses (lavis de 15 cm).
        let crestL = -Infinity, crestR = -Infinity;
        for (let k2 = 0; k2 < 5; k2++) {
          const d = wHalf + 0.5 + 2.5 * (k2 / 4);
          const xl = br.sx[i] + (nx / l) * d, zl = br.sz[i] + (nz / l) * d;
          const xr = br.sx[i] - (nx / l) * d, zr = br.sz[i] - (nz / l) * d;
          if (!isInRiver(xl, zl)) { const g2 = heightAt(xl, zl); if (g2 > crestL) crestL = g2; }
          if (!isInRiver(xr, zr)) { const g2 = heightAt(xr, zr); if (g2 > crestR) crestR = g2; }
        }
        const cL = crestL === -Infinity ? Infinity : crestL;
        const cR = crestR === -Infinity ? Infinity : crestR;
        lvCeil[i] = Math.max(Math.min(cL, cR) - 0.10, WORLD.seaLevel + 0.03);
        br.profile[i] = Math.max(Math.min(bed[i] + RIVER.depth * 0.72, lvCeil[i]), bed[i] + 0.14);
      }

      // Jonction : tant que la branche court dans le chenal du tronc, sa
      // surface EST celle du tronc, station par station — tout autre choix
      // met une marche visible dans l'eau au split du delta.
      let pinnedTo = -1;
      if (b > 0) {
        for (let i = 0; i <= N; i++) {
          const nt = nearestOnTrunk(br.sx[i], br.sz[i]);
          if (nt.dist < RIVER.width * 0.9) {
            br.profile[i] = waterYAt(nt.t);
            pinnedTo = i;
          } else break;
        }
      }

      // Lissage le long du flux (re-épinglage jonction à chaque passe), puis
      // re-clamp LOCAL : le lissage peut relever une station au-dessus de sa
      // crête ou l'enfoncer sous son lit.
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 1; i < N; i++) {
          br.profile[i] = (br.profile[i - 1] + br.profile[i] * 2 + br.profile[i + 1]) * 0.25;
        }
        for (let i = 0; i <= pinnedTo; i++) {
          const nt = nearestOnTrunk(br.sx[i], br.sz[i]);
          br.profile[i] = waterYAt(nt.t);
        }
      }
      for (let i = pinnedTo + 1; i <= N; i++) {
        br.profile[i] = Math.max(Math.min(br.profile[i], lvCeil[i]), bed[i] + 0.12);
      }

      // Remontée bornée : une nappe PROFONDE qui monte vers l'aval est une
      // fuite visible (l'eau ne coule pas vers le haut) — on borne la montée
      // à 0.12/station EN GARDANT le plancher : là où le lit grimpe plus
      // vite, le filet reste collé au lit (film de rapide, blanchi par
      // l'écume cascade) au lieu de passer dessous. Le plancher casse toute
      // propagation vers l'aval : le désastre v1–v3 (eau sous le sable) ne
      // peut pas revenir.
      for (let i = Math.max(1, pinnedTo + 1); i <= N; i++) {
        br.profile[i] = Math.max(Math.min(br.profile[i], br.profile[i - 1] + 0.12), bed[i] + 0.12);
      }

      // L'embouchure rejoint la mer.
      const M = b === 0 ? 24 : 14;
      for (let i = N - M; i <= N; i++) {
        const a = (i - (N - M)) / M;
        br.profile[i] = br.profile[i] * (1 - a) + (WORLD.seaLevel + 0.05) * a;
      }

      // Where does the river stop being a river?
      //
      // Not at the end of the curve — every path deliberately runs on past the
      // coast so the mouth is not a special case to author. The honest test is
      // the BANKS: sample the ground either side of the corridor, outside the
      // carve, and ask how far above the waterline it still is. Once the banks
      // are gone there is only sea, and both the channel and the ribbon have
      // to dissolve rather than run on as a trench with a lid.
      const bank = new Float32Array(N + 1);
      const off = (RIVER.width * 0.5 + RIVER.bankWidth) * br.widthK + 3;
      const _tan = new THREE.Vector3();
      for (let i = 0; i <= N; i++) {
        br.curve.getTangentAt(i / N, _tan);
        const nx = -_tan.z, nz = _tan.x;
        const l = Math.hypot(nx, nz) || 1;
        bank[i] = Math.max(
          heightAt(br.sx[i] + (nx / l) * off, br.sz[i] + (nz / l) * off),
          heightAt(br.sx[i] - (nx / l) * off, br.sz[i] - (nz / l) * off)
        );
      }
      br.fade = new Float32Array(N + 1);
      for (let i = 0; i <= N; i++) {
        // Thresholds are soft (fully faded only once the banks are truly awash)
        // because the delta crosses a wide, barely-above-sea sand flat: with
        // the old 2.4-unit ceiling all three arms dissolved at the flat's
        // inner edge and the delta read as one lagoon instead of three
        // channels reaching the surf.
        br.fade[i] = smoothstep(WORLD.seaLevel + 0.05, WORLD.seaLevel + 1.4, bank[i]);
      }
      // Monotonic downstream: a sandbar mid-estuary must not make the river
      // reappear beyond it.
      for (let i = N - 1; i >= 0; i--) br.fade[i] = Math.max(br.fade[i], br.fade[i + 1]);
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 1; i < N; i++) {
          br.fade[i] = (br.fade[i - 1] + br.fade[i] * 2 + br.fade[i + 1]) * 0.25;
        }
      }
    }

    // build() owns its scene objects: a second call must replace, not stack.
    // Previous branch ribbons share the trunk's material, so only their
    // geometries are disposed; the bridge creates fresh materials every call,
    // so it is disposed all the way down.
    for (const m of branchMeshes) { group.remove(m); m.geometry.dispose(); }
    branchMeshes.length = 0;
    if (bridgeMesh) {
      group.remove(bridgeMesh);
      bridgeMesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      bridgeMesh = null;
    }

    // One ribbon per branch, all sharing the trunk's material (and therefore
    // its uniforms — update() touches all three surfaces at once). Each
    // distributary's ribbon starts only once its centreline has slid out from
    // under the trunk's, so the two transparent surfaces never double-blend.
    water.geometry.dispose();
    water.geometry = buildWaterRibbon(0, 0, true, heightAt);
    for (let b = 1; b < BRANCHES.length; b++) {
      const br = BRANCHES[b];
      let i0 = 0;
      for (let i = 0; i <= br.N; i++) {
        if (nearestOnTrunk(br.sx[i], br.sz[i]).dist > RIVER.width * 0.55) { i0 = i; break; }
      }
      const mesh = new THREE.Mesh(buildWaterRibbon(b, i0 / br.N, true, heightAt), water.material);
      mesh.name = `river-branch-${b}`;
      mesh.renderOrder = 2;
      group.add(mesh);
      branchMeshes.push(mesh);
    }
    const built = buildBridge(group, heightAt);
    bridgeMesh = built.bridge;
    api.bridgeInfo = built.info;
    _groundAt = heightAt;
  }

  const uniforms = {
    uTime:     { value: 0 },
    uFlow:     { value: RIVER.flowSpeed },
    // Saturated on purpose: at the grazing angles a walker sees the river
    // from, the fresnel sky mix bleaches whatever it is given — a desaturated
    // deep colour washed out to lifeless grey.
    // Étalonné sur les rivières Ghibli (consigne : comparer aux références
    // en ligne) : leur eau est un BLEU saturé quasi opaque, plus foncé que
    // les berges — le teal-gris translucide lisait « sable mouillé ». La
    // heightmap (texel 2-3 u) sous-estime en plus la profondeur des
    // tranchées étroites : la couleur doit chanter dès la mi-rampe.
    uShallow:  { value: new THREE.Color(0x4fc4c4) },
    uDeep:     { value: new THREE.Color(0x1e6f97) },
    uMouthCol: { value: new THREE.Color(0x2f9aa0) },
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

  function dispose() {
    for (const m of branchMeshes) { group.remove(m); m.geometry.dispose(); }
    branchMeshes.length = 0;
    if (bridgeMesh) {
      group.remove(bridgeMesh);
      bridgeMesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      bridgeMesh = null;
    }
    group.remove(water);
    water.geometry.dispose();
    water.material.dispose();
  }

  const api = {
    group, update, build, dispose, water, carveRiver, isInRiver, waterSurfaceYAt, curve, waterYAt,
    bridgeDeckHeightAt, bridgeDeckNormalAt,
    // Set by build(): the bridge's FINAL placement (shift included) — the
    // single source of truth for the path's last segment and the abutment
    // lanterns. Null until the terrain exists.
    bridgeInfo: null,
  };
  return api;
}
