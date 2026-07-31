/**
 * details.js — the small things you only see once you are standing on the island.
 *
 * The scene was built from the outside in: an island, a sea, a sky, weather. All
 * of that reads from two hundred units away and none of it reads from two. Now
 * that there is a dog to walk, the ground is somewhere you actually go, and an
 * unbroken green field with trees standing in it looks like a golf course.
 *
 * Four passes, in the order they matter at eye level:
 *
 *   1. Wildflowers, in drifts rather than sprinkled. Real meadows are patchy —
 *      a species takes a hollow and holds it — and an even scatter is the single
 *      most reliable way to make procedural planting look procedural.
 *   2. A network of packed-earth paths (torii climb, pond loop, beach trail)
 *      with stone lanterns ONLY along those routes — never orphan lamps in a
 *      field. Their fire boxes come up as the sun goes down.
 *   3. Beach litter — pebbles and driftwood along the tideline, where the eye
 *      goes looking for scale and currently finds an unbroken sweep of sand.
 *   4. Torii gates on the climb to the west-cliff overlook terrace.
 *
 * Everything is instanced and everything is seeded. No textures, as elsewhere.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { streamFor, R, fbm2, clamp, smoothstep } from './noise.js';
import { makeWoodBump } from './detailtex.js';
import { WORLD, LAND_SCALE, AREA, PATHS } from './config.js';

const TAU = Math.PI * 2;

/* ────────────────────────────────────────────────────────────────
   Path network — curves + spatial index (all routes)
   ──────────────────────────────────────────────────────────────── */

const PATH_N = 240;
/** Per-route built geometry: { name, curve, pp, closed, toriiAt? }. */
let _routes = [];
/** Flat sample list for the bucket index (all routes). Each entry: {x, z}. */
let _samples = [];
let _pMinX = 0, _pMaxX = 0, _pMinZ = 0, _pMaxZ = 0;
let P_NX = 1, P_NZ = 1;
let _pGrid = null;
/** World {x, z} of the torii route's end (overlook terrace). */
let _pathEnd = null;

/**
 * Build one route's curve from authored points, with lateral fbm wander so the
 * ribbon, grass exclusion, lanterns and torii share the same line.
 *
 * - torii climb: dead zone near the end (t > 0.90) so the terrace arrival stays
 *   on the authored rim.
 * - pond loop (closed): no dead zone; ends get the SAME offset so the join
 *   does not step.
 * - beach trail: open, no dead zone (starts soft like the others).
 */
function buildRoute(route) {
  const pts = route.points;
  const closed = pts.length > 2
    && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-6
    && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-6;
  // Closed CatmullRom with a duplicated first/last point makes a zero-length
  // segment at the join — strip the trailing duplicate when closed.
  const ctrlIn = closed ? pts.slice(0, -1) : pts;
  let curve = new THREE.CatmullRomCurve3(
    ctrlIn.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    closed, 'catmullrom', 0.5
  );
  let pp = curve.getSpacedPoints(PATH_N);
  const nLast = pp.length - 1;
  const deadEnd = route.name === 'torii';
  const _tanP = new THREE.Vector3();

  if (closed) {
    // Perturb every sample (including the nominal ends) with full amp; then
    // force both ends onto the same displaced position so the loop seals.
    for (let i = 0; i <= nLast; i++) {
      const t = i / nLast;
      const amp = 2.5 * (i < 4 || i > nLast - 4
        ? Math.min(i, nLast - i, 4) / 4
        : 1);
      curve.getTangentAt(Math.min(t, 0.9999), _tanP);
      const nx = -_tanP.z, nz = _tanP.x;
      const l = Math.hypot(nx, nz) || 1;
      const off = fbm2(pp[i].x * 0.02 + 7.7, pp[i].z * 0.02 - 3.1, 3) * amp;
      pp[i].x += (nx / l) * off;
      pp[i].z += (nz / l) * off;
    }
    // Seal: first and last sample are the same world point.
    pp[nLast].x = pp[0].x;
    pp[nLast].z = pp[0].z;
  } else {
    for (let i = 1; i < nLast; i++) {
      const t = i / nLast;
      const endFade = deadEnd ? (1 - smoothstep(0.90, 0.97, t)) : 1;
      const amp = 2.5 * endFade * (i < 4 ? i / 4 : 1);
      curve.getTangentAt(t, _tanP);
      const nx = -_tanP.z, nz = _tanP.x;
      const l = Math.hypot(nx, nz) || 1;
      const off = fbm2(pp[i].x * 0.02 + 7.7, pp[i].z * 0.02 - 3.1, 3) * amp;
      pp[i].x += (nx / l) * off;
      pp[i].z += (nz / l) * off;
    }
  }

  const ctrl = [];
  for (let i = 0; i <= nLast; i += 4) ctrl.push(pp[Math.min(i, nLast)].clone());
  if ((nLast % 4) !== 0) ctrl.push(pp[nLast].clone());
  // Closed rebuild: if the polyline already seals (first≈last), keep open
  // Catmull with duplicated ends so getPointAt(0)===getPointAt(1) spatially.
  const rebuildClosed = closed
    && Math.hypot(ctrl[0].x - ctrl[ctrl.length - 1].x, ctrl[0].z - ctrl[ctrl.length - 1].z) < 0.5;
  if (rebuildClosed) {
    // Drop the last control if it duplicates the first for a true closed curve.
    const body = ctrl.slice(0, -1);
    curve = new THREE.CatmullRomCurve3(body, true, 'catmullrom', 0.5);
  } else {
    curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);
  }
  pp = curve.getSpacedPoints(PATH_N);
  if (closed) {
    const last = pp[pp.length - 1];
    last.x = pp[0].x;
    last.z = pp[0].z;
  }

  return {
    name: route.name,
    curve,
    pp,
    closed,
    toriiAt: route.toriiAt || null,
    points: route.points,
  };
}

/**
 * (Re)build every route curve and the shared bucket index. The index exists
 * because `isOnPath` is called for every one of the grass system's millions of
 * rejection samples — anything not standing near a route must pay four
 * comparisons and nothing more.
 */
function buildPathNetwork() {
  _routes = PATHS.routes.map(buildRoute);
  _samples = [];
  for (const r of _routes) {
    for (const p of r.pp) _samples.push({ x: p.x, z: p.z });
  }

  const torii = _routes.find((r) => r.name === 'torii');
  if (torii) {
    const end = torii.pp[torii.pp.length - 1];
    _pathEnd = { x: end.x, z: end.z };
  } else {
    _pathEnd = { x: 0, z: 0 };
  }

  // Pad for isOnPath(x,z,extra) with extra up to 6.
  const P_PAD = PATHS.width * 0.5 + 6;
  _pMinX = Infinity; _pMaxX = -Infinity; _pMinZ = Infinity; _pMaxZ = -Infinity;
  for (const p of _samples) {
    if (p.x < _pMinX) _pMinX = p.x; if (p.x > _pMaxX) _pMaxX = p.x;
    if (p.z < _pMinZ) _pMinZ = p.z; if (p.z > _pMaxZ) _pMaxZ = p.z;
  }
  _pMinX -= P_PAD; _pMaxX += P_PAD; _pMinZ -= P_PAD; _pMaxZ += P_PAD;
  P_NX = Math.max(1, Math.ceil((_pMaxX - _pMinX) / P_CELL));
  P_NZ = Math.max(1, Math.ceil((_pMaxZ - _pMinZ) / P_CELL));
  _pGrid = new Array(P_NX * P_NZ);
  for (let i = 0; i < _samples.length; i++) {
    const p = _samples[i];
    const cx = Math.min(P_NX - 1, Math.max(0, Math.floor((p.x - _pMinX) / P_CELL)));
    const cz = Math.min(P_NZ - 1, Math.max(0, Math.floor((p.z - _pMinZ) / P_CELL)));
    (_pGrid[cz * P_NX + cx] ||= []).push(i);
  }
}
const P_CELL = 12;
buildPathNetwork();

/**
 * Rebuild the full path-network index and return the end of the 'torii' route
 * (overlook terrace). Call before createGrass so exclusion follows the network.
 * No arguments — the network is fully authored in PATHS.
 * @returns {{x: number, z: number}}
 */
export function initPath() {
  buildPathNetwork();
  return _pathEnd;
}

/**
 * True if (x,z) lies within (PATHS.width/2 + extra) of any route axis.
 * Buckets are sized for extra up to 6 (tree exclusion uses 4; lanterns use ~3.2).
 * Default extra=0.25: grass grows right up to the ribbon's edge — the old
 * 1.3-unit verge read as a band of bald green « vide » flanking the dirt
 * (player complaint). Blades slightly overhanging the edge hide the seam.
 */
export function isOnPath(x, z, extra = 0.25) {
  if (x < _pMinX || x > _pMaxX || z < _pMinZ || z > _pMaxZ) return false;
  const cx = Math.min(P_NX - 1, Math.max(0, Math.floor((x - _pMinX) / P_CELL)));
  const cz = Math.min(P_NZ - 1, Math.max(0, Math.floor((z - _pMinZ) / P_CELL)));
  const r2 = (PATHS.width * 0.5 + extra) ** 2;
  for (let dz = -1; dz <= 1; dz++) {
    const rz = cz + dz;
    if (rz < 0 || rz >= P_NZ) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const rx = cx + dx;
      if (rx < 0 || rx >= P_NX) continue;
      const bucket = _pGrid[rz * P_NX + rx];
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const p = _samples[bucket[k]];
        const ddx = x - p.x, ddz = z - p.z;
        if (ddx * ddx + ddz * ddz < r2) return true;
      }
    }
  }
  return false;
}

/**
 * Proximité à l'axe d'une route, 0 (hors sente) → 1 (au coeur). Sert au sol
 * composite des MOVERS : le shiba marche SUR la surface de terre battue
 * (terrain + ~pathSurfaceLift·proximité), pas sur le terrain en dessous —
 * sinon ses pattes traversent le ruban (capture joueur). Lisse au bord.
 */
export const PATH_SURFACE_LIFT = 0.13;
export function pathProximity(x, z) {
  if (x < _pMinX || x > _pMaxX || z < _pMinZ || z > _pMaxZ) return 0;
  const cx = Math.min(P_NX - 1, Math.max(0, Math.floor((x - _pMinX) / P_CELL)));
  const cz = Math.min(P_NZ - 1, Math.max(0, Math.floor((z - _pMinZ) / P_CELL)));
  let best2 = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    const rz = cz + dz;
    if (rz < 0 || rz >= P_NZ) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const rx = cx + dx;
      if (rx < 0 || rx >= P_NX) continue;
      const bucket = _pGrid[rz * P_NX + rx];
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const p = _samples[bucket[k]];
        const ddx = x - p.x, ddz = z - p.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < best2) best2 = d2;
      }
    }
  }
  if (best2 === Infinity) return 0;
  const halfW = PATHS.width * 0.5;
  return clamp(1 - (Math.sqrt(best2) - halfW * 0.5) / (halfW * 0.7), 0, 1);
}

/**
 * Lantern feet along every route (plus the overlook terrace pair). Pure so the
 * invariant bench can re-run the same placement without building meshes.
 *
 * One lantern every PATHS.lanternEvery world units of arc, alternating sides,
 * offset by (width/2 + 1.3). Skipped under water (h < seaLevel+0.3) or on a
 * cliff face (local slope > 0.9).
 *
 * @param {Function} heightAt
 * @param {Function} [slopeAt]
 * @returns {{x: number, z: number}[]}
 */
export function computeLanternSpots(heightAt, slopeAt = null) {
  const spots = [];
  const halfW = PATHS.width * 0.5;
  const sideOff = halfW + 1.3;
  const every = PATHS.lanternEvery;
  const p = new THREE.Vector3();
  const tn = new THREE.Vector3();

  for (const route of _routes) {
    const len = route.curve.getLength();
    // Start a half-step in so the junction is not stacked with three lanterns.
    let side = 1;
    let s = every * 0.5;
    let n = 0;
    while (s < len - every * 0.25) {
      const t = Math.min(0.999, s / len);
      route.curve.getPointAt(t, p);
      route.curve.getTangentAt(t, tn);
      const l = Math.hypot(tn.x, tn.z) || 1;
      const nx = -tn.z / l, nz = tn.x / l;
      const x = p.x + nx * sideOff * side;
      const z = p.z + nz * sideOff * side;
      const h = heightAt(x, z);
      const sl = slopeAt ? slopeAt(x, z) : 0;
      if (h >= WORLD.seaLevel + 0.3 && sl <= 0.9) {
        spots.push({ x, z });
      }
      side = -side;
      n++;
      s = every * 0.5 + n * every;
    }
  }

  // Terrace pair flanking the overlook at the west rim (arrival of the torii
  // climb). Same side offset as the rest of the network so they sit on the
  // path verge — authored [-91,-2]/[-86,5] land ~11 u off-axis after
  // LAND_SCALE and would fail the orphan invariant even at marge 5.
  const torii = _routes.find((r) => r.name === 'torii');
  if (torii) {
    const tEnd = 0.999;
    torii.curve.getPointAt(tEnd, p);
    torii.curve.getTangentAt(tEnd, tn);
    const l = Math.hypot(tn.x, tn.z) || 1;
    const nx = -tn.z / l, nz = tn.x / l;
    for (const side of [1, -1]) {
      const x = p.x + nx * sideOff * side;
      const z = p.z + nz * sideOff * side;
      const h = heightAt(x, z);
      const sl = slopeAt ? slopeAt(x, z) : 0;
      if (h >= WORLD.seaLevel + 0.3 && sl <= 0.9) spots.push({ x, z });
    }
  }
  return spots;
}

/** Filled by createDetails — last lantern feet placed (read-only snapshot). */
export let lanternSpots = [];

/* ────────────────────────────────────────────────────────────────
   Packed-earth surfaces — PURE builders, shared with the invariant
   bench (test/invariants.html) so the test proves the exact geometry
   the game renders, not a reimplementation of it.
   ──────────────────────────────────────────────────────────────── */

const RIBBON_CLEARANCE_MARGIN = 0.02;
const RIBBON_CLEARANCE_SB = 5;
const RIBBON_CLEARANCE_MAX_PASSES = 6;
const RIBBON_CLEARANCE_EPSILON = 1e-4;

/**
 * Lift triangle planes monotonically until their barycentric samples clear the
 * real baked terrain. Raising all three vertices by the same deficit translates
 * the whole plane without changing its slope; later triangles can only raise a
 * shared vertex, so an already-safe sample never moves down.
 */
function clearRibbonTriangles(heightAt, pos, idx) {
  for (let pass = 0; pass < RIBBON_CLEARANCE_MAX_PASSES; pass++) {
    let moved = false;
    for (let t3 = 0; t3 < idx.length; t3 += 3) {
      const iA = idx[t3], iB = idx[t3 + 1], iC = idx[t3 + 2];
      const a3 = iA * 3, b3 = iB * 3, c3 = iC * 3;
      const ax = pos[a3], ay = pos[a3 + 1], az = pos[a3 + 2];
      const bx = pos[b3], by = pos[b3 + 1], bz = pos[b3 + 2];
      const cx = pos[c3], cy = pos[c3 + 1], cz = pos[c3 + 2];
      let deficit = 0;
      for (let i = 0; i <= RIBBON_CLEARANCE_SB; i++) {
        for (let j = 0; j <= RIBBON_CLEARANCE_SB - i; j++) {
          const l1 = i / RIBBON_CLEARANCE_SB;
          const l2 = j / RIBBON_CLEARANCE_SB;
          const l0 = 1 - l1 - l2;
          const x = l0 * ax + l1 * bx + l2 * cx;
          const z = l0 * az + l1 * bz + l2 * cz;
          const y = l0 * ay + l1 * by + l2 * cy;
          deficit = Math.max(deficit,
            heightAt(x, z) + RIBBON_CLEARANCE_MARGIN - y);
        }
      }
      if (deficit > RIBBON_CLEARANCE_EPSILON) {
        pos[a3 + 1] += deficit;
        pos[b3 + 1] += deficit;
        pos[c3 + 1] += deficit;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Surface de MARCHE de la terre battue, en hauteur AU-DESSUS de heightAt(x,z).
 *
 * Approximation ponctuelle volontaire : le degagement iteratif appartient aux
 * triangles et ne peut pas etre rejoue ici. On suit donc le bombe pur (0.06
 * bord -> 0.12 axe) ou le patin (0.04), avec le meme fondu vers la berge.
 */
export function pathSurfaceLiftAt(heightAt, x, z) {
  const prox = pathProximity(x, z);
  const [jx, jz] = PATHS.routes[0].points[0];
  const dx = x - jx, dz = z - jz;
  const padR = PATHS.width * 1.6;
  const d2 = dx * dx + dz * dz;
  let padProx = 0;
  if (d2 < padR * padR) {
    padProx = clamp(1 - (Math.sqrt(d2) - padR * 0.55) / (padR * 0.40), 0, 1);
  }
  if (prox <= 0 && padProx <= 0) return 0;
  const ribbon = prox > 0 ? prox * (0.04 + 0.08 * prox) : 0;
  const pad = padProx > 0 ? padProx * 0.04 : 0;
  return Math.max(ribbon, pad);
}

/** Columns across the ribbon. f runs +1 (left edge) -> -1 (right). */
export const RIBBON_COLS = 9;

/**
 * Ribbon vertex/index data for every route. Deterministic (seeded fbm only).
 *
 * - 9 colonnes et pas axial <= 0.5 u : tessellation conservee car le prototype
 *   Chrome mesure 0.232 u d'elevation max en ultra pour 65 ms de degagement.
 * - Pose initiale collee: y = heightAt + lift, lift 0.06 (bord) -> 0.12
 *   (axe), puis chaque triangle est degage contre le terrain reel.
 * - liftBias par route resserre encore (0/0.02/0.04, avant 0/0.03/0.06) : les
 *   etages du carrefour lisaient comme des marches.
 *
 * @param {Function} heightAt
 * @returns {{name:string, cols:number, rows:number, pos:number[],
 *            edge:number[], edgeRaw:number[], idx:number[]}[]}
 */
export function computeRibbonMeshes(heightAt) {
  const out = [];
  const p = new THREE.Vector3(), tn = new THREE.Vector3();
  for (const route of _routes) {
    const len = route.curve.getLength();
    const N = Math.max(260, Math.ceil(len / 0.5));
    const pos = [], edge = [], edgeRaw = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // Closed curves: t=1 wraps to the start. Open: getPointAt(1) is fine.
      if (route.closed) {
        route.curve.getPointAt(t >= 1 ? 0 : t, p);
        route.curve.getTangentAt(t >= 1 ? 0 : Math.min(t, 0.9999), tn);
      } else {
        route.curve.getPointAt(t, p);
        route.curve.getTangentAt(Math.min(t, 0.9999), tn);
      }
      const l = Math.hypot(tn.x, tn.z) || 1;
      const nx = -tn.z / l, nz = tn.x / l;
      // FUSELAGE : seule la FIN de la plage meurt en pointe dans le sable.
      // Le DEPART des routes ouvertes garde sa PLEINE largeur — il est au
      // carrefour, pas en pleine nature, et le pincement de depart y lisait
      // comme un coup de pinceau leve pose sur l'herbe (capture joueur).
      // La fusion des trois routes est faite par le patin de carrefour.
      let tap = 1;
      if (!route.closed && route.name === 'plage') {
        tap = 1 - smoothstep(0.94, 1, t);
      }
      // Etages du carrefour : chaque route garde son etage (empilement
      // deterministe, pas de z-fight), resserres pour ne plus lire comme des
      // marches. Le patin de carrefour est SOUS le plus bas (0.04 < 0.06+0).
      const liftBias = route.name === 'etangs' ? 0 : route.name === 'torii' ? 0.02 : 0.04;
      // Liseres (verdissement + effilochage) neutralises pres du depart :
      // sinon chaque ruban dessine sa frange verte par-dessus la terre de
      // l'autre et du patin.
      const edgeK = route.closed ? 1 : smoothstep(0.015, 0.06, t);
      const wk = 0.02 + 0.98 * tap;
      // INDEPENDENT widths per side — one symmetric width is what read as a
      // ruled band with two straight edges. Plancher 0.78 : plus bas, le
      // ruban s'amincissait a la moitie de sa largeur nominale.
      const wL = wk * PATHS.width * 0.5 * (0.78 + 0.50 * fbm2(p.x * 0.11 + 3.1, p.z * 0.11, 2));
      const wR = wk * PATHS.width * 0.5 * (0.78 + 0.50 * fbm2(p.x * 0.11 - 9.4, p.z * 0.11 + 5.2, 2));
      for (let c = 0; c < RIBBON_COLS; c++) {
        const f = 1 - (2 * c) / (RIBBON_COLS - 1);
        const w = f >= 0 ? wL : wR;
        const cx = p.x + nx * w * f, cz = p.z + nz * w * f;
        const edg = Math.abs(f);
        const lift = 0.06 + 0.06 * (1 - edg);   // camber: 0.06 bord -> 0.12 axe
        edgeRaw.push(edg);
        edge.push(edg * edgeK);
        pos.push(cx, heightAt(cx, cz) + lift + liftBias, cz);
      }
      if (i < N) {
        // Winding chosen so the faces point UP — the trap that has now bitten
        // this project four times (ocean disc, corolla, bird wings, and this
        // ribbon): with the default FrontSide material a downward-wound strip
        // simply does not render, silently.
        const a = i * RIBBON_COLS, b = a + RIBBON_COLS;
        for (let c = 0; c < RIBBON_COLS - 1; c++) {
          idx.push(a + c, b + c, a + c + 1, a + c + 1, b + c, b + c + 1);
        }
      }
    }
    clearRibbonTriangles(heightAt, pos, idx);
    out.push({ name: route.name, cols: RIBBON_COLS, rows: N + 1, pos, edge, edgeRaw, idx });
  }
  return out;
}

/**
 * Le PATIN DE CARREFOUR : un disque irregulier de terre battue centre sur le
 * premier point du reseau (les trois routes y naissent), meme recette de
 * contour fbm que la terrasse des torii, aPathEdge -> 1 au pourtour pour
 * l'effilochage. Pose a l'etage LE PLUS BAS (lift 0.04, sous le bord de ruban
 * 0.06) : les trois rubans pleine largeur le recouvrent sans marche. Tesselle
 * en anneaux 10x72, pose collee puis degage chaque vrai triangle contre le
 * terrain. Aucune lanterne n'y est generee.
 *
 * @param {Function} heightAt
 * @returns {{name:string, pos:number[], edge:number[], edgeRaw:number[], idx:number[]}}
 */
export function computeJunctionPad(heightAt) {
  const [jx, jz] = PATHS.routes[0].points[0];
  const RINGS = 10, SEGS = 72;
  const R0 = PATHS.width * 1.6;
  const pos = [], edge = [], edgeRaw = [], idx = [];
  pos.push(jx, heightAt(jx, jz) + 0.04, jz);
  edge.push(0); edgeRaw.push(0);
  for (let k = 1; k <= RINGS; k++) {
    for (let s = 0; s < SEGS; s++) {
      const a = (s / SEGS) * TAU;
      const rr = R0 * (0.82 + 0.28 * fbm2(Math.cos(a) * 2.1 + 5.0, Math.sin(a) * 2.1, 2));
      const r = rr * (k / RINGS);
      const px = jx + Math.cos(a) * r, pz = jz + Math.sin(a) * r;
      pos.push(px, heightAt(px, pz) + 0.04, pz);
      edge.push(k / RINGS); edgeRaw.push(k / RINGS);
    }
  }
  const id = (k, s) => 1 + (k - 1) * SEGS + ((s % SEGS + SEGS) % SEGS);
  // Fan: same proven up winding as the ocean disc / overlook terrace
  // (centre, next, current).
  for (let s = 0; s < SEGS; s++) idx.push(0, id(1, s + 1), id(1, s));
  // Rings: (i0, i1, o0) / (i1, o1, o0) — cross(tangential, radial) points UP.
  for (let k = 1; k < RINGS; k++) {
    for (let s = 0; s < SEGS; s++) {
      const i0 = id(k, s), i1 = id(k, s + 1);
      const o0 = id(k + 1, s), o1 = id(k + 1, s + 1);
      idx.push(i0, i1, o0, i1, o1, o0);
    }
  }
  clearRibbonTriangles(heightAt, pos, idx);
  return { name: 'carrefour', pos, edge, edgeRaw, idx };
}

/* ── art direction ───────────────────────────────────────────────
 * Four species, weighted. The white daisy is the workhorse and reads at the
 * longest range; the others are accents. Deep violet is only 8% of the mix —
 * it is there to be found, not to be seen.
 * Spring stays in hanami tones (white/pink/mauve, warm-cream hearts).
 * Autumn swaps only petal/heart/stem pigments; weights and geometry stay put. */
// Sizes are frankly larger than life. A real daisy is 3 cm across, which at this
// world scale is four millimetres of corolla hidden among 55 cm grass blades —
// present in the buffer, invisible on screen. Blown up to roughly the size of a
// small poppy they read as flowers from where the dog actually walks.
const FLOWER_BASE = [
  { name: 'daisy',   weight: 0.44, petals: 8, size: 0.155, height: [0.42, 0.66] },
  { name: 'buttercup', weight: 0.27, petals: 5, size: 0.130, height: [0.34, 0.54] },
  { name: 'clover',  weight: 0.21, petals: 6, size: 0.118, height: [0.28, 0.46] },
  { name: 'harebell', weight: 0.08, petals: 5, size: 0.140, height: [0.46, 0.72] },
];

const FLOWER_PROFILES = {
  spring: {
    stem: 0x5f8a42,
    daisy:    { petal: 0xfbf7ee, heart: 0xf2e3cf },
    buttercup:{ petal: 0xf2cfdd, heart: 0xdd9db8 },
    clover:   { petal: 0xe9b6cd, heart: 0xf0d7e2 },
    harebell: { petal: 0x8f7fd0, heart: 0xcfc6f0 },
  },
  autumn: {
    stem: 0x596333,
    daisy:    { petal: 0xe8dfc5, heart: 0xb58a32 },
    buttercup:{ petal: 0xd6a43b, heart: 0x8a5e24 },
    clover:   { petal: 0xa85a3c, heart: 0x6f392b },
    harebell: { petal: 0x786683, heart: 0xb6a3b5 },
  },
};

const STONE = 0x9a9691;
const STONE_DARK = 0x716d69;
const LANTERN_LIGHT = 0xffc978;

/* ────────────────────────────────────────────────────────────────
   Flower geometry
   ──────────────────────────────────────────────────────────────── */

/**
 * One flower: a stem of two crossed quads and a corolla of flat petals around a
 * disc. Modelled rather than billboarded because these are walked past at half a
 * metre, where a camera-facing quad spins in a way nothing in a meadow does.
 *
 * `aBase` carries the local height of each vertex up the stem, 0 at the root and
 * 1 at the corolla. The wind bend in the vertex shader is proportional to its
 * square, which is what makes the stem arc instead of shear.
 */
function makeFlowerGeometry(spec, rng, stemHex = 0x5f8a42) {
  const pos = [], nrm = [], col = [], base = [], idx = [];
  const petal = new THREE.Color(spec.petal);
  const heart = new THREE.Color(spec.heart);
  const stemCol = new THREE.Color(stemHex);
  const h = R.range(rng, spec.height[0], spec.height[1]);

  const push = (x, y, z, nx, ny, nz, c, b) => {
    pos.push(x, y, z); nrm.push(nx, ny, nz);
    col.push(c.r, c.g, c.b); base.push(b);
    return pos.length / 3 - 1;
  };

  // — stem: two quads at right angles, so it has a silhouette from any side —
  const sw = 0.011;
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI * 0.5;
    const dx = Math.cos(a) * sw, dz = Math.sin(a) * sw;
    const nx = -Math.sin(a), nz = Math.cos(a);
    const a0 = push(-dx, 0, -dz, nx, 0.15, nz, stemCol, 0);
    const a1 = push(dx, 0, dz, nx, 0.15, nz, stemCol, 0);
    const a2 = push(-dx * 0.55, h, -dz * 0.55, nx, 0.15, nz, stemCol, 1);
    const a3 = push(dx * 0.55, h, dz * 0.55, nx, 0.15, nz, stemCol, 1);
    idx.push(a0, a1, a2, a1, a3, a2);
  }

  // — corolla: a fan of petals about a small centre disc —
  const n = spec.petals;
  const r = spec.size;
  // Petals lift well out of the plane. A flat corolla is edge-on from the height
  // a dog's camera sits at, and edge-on it is one dark pixel.
  const tilt = 0.42;
  const centre = push(0, h, 0, 0, 1, 0, heart, 1);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU;
    const a1 = ((i + 0.5) / n) * TAU;
    const a2 = ((i + 1) / n) * TAU;
    const inner = r * 0.26;
    const b0 = push(Math.cos(a0) * inner, h + 0.004, Math.sin(a0) * inner, 0, 1, 0, heart, 1);
    const b2 = push(Math.cos(a2) * inner, h + 0.004, Math.sin(a2) * inner, 0, 1, 0, heart, 1);
    const tip = push(Math.cos(a1) * r, h + tilt * r, Math.sin(a1) * r, 0, 1, 0, petal, 1);
    // Wound so the GEOMETRIC front face points up, agreeing with the (0,1,0)
    // normal above. Listing the ring in increasing-angle order reads naturally
    // and produces the opposite: on a DoubleSide material three then flips the
    // shading normal for the back face you are actually looking at, aims it at
    // the ground, and every flower in the meadow comes out a dead brown star.
    idx.push(centre, b2, b0);
    idx.push(b0, b2, tip);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 1));
  g.setIndex(idx);
  return g;
}

/* ────────────────────────────────────────────────────────────────
   Stone lantern
   ──────────────────────────────────────────────────────────────── */

/**
 * A kasuga-doro: pedestal, shaft, platform, fire box, roof, finial.
 *
 * Returned as ONE merged geometry rather than a group of seven meshes. Seven
 * meshes times six lanterns is forty-two draw calls for something that occupies
 * a few hundred pixels; merged and instanced it is one. The parts are painted
 * into a vertex colour attribute before merging so the pedestal can still be a
 * darker stone than the shaft.
 */
function makeLanternGeometry() {
  const parts = [];
  const tint = new THREE.Color();

  const part = (geo, hex, y, ry = 0, x = 0, z = 0) => {
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    tint.setHex(hex);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = tint.r; c[i * 3 + 1] = tint.g; c[i * 3 + 2] = tint.b; }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    geo.deleteAttribute('uv');   // merge refuses to combine a set with mismatched attributes
    parts.push(geo);
  };

  part(new THREE.CylinderGeometry(0.40, 0.46, 0.20, 12), STONE_DARK, 0.10);
  part(new THREE.CylinderGeometry(0.15, 0.19, 1.05, 10), STONE, 0.72);
  part(new THREE.CylinderGeometry(0.36, 0.24, 0.16, 12), STONE, 1.32);

  // The fire box is OPEN: two hexagonal slabs and six corner posts. It was a
  // solid drum first, which hid the light inside it — the glow sphere failed the
  // depth test against the near wall and the lanterns stayed dark all night with
  // every uniform reading correctly. Openings are also simply what the object is:
  // a kasuga-doro is a stone frame around a flame, not a barrel.
  part(new THREE.CylinderGeometry(0.30, 0.31, 0.055, 6), STONE, 1.42);
  part(new THREE.CylinderGeometry(0.33, 0.31, 0.070, 6), STONE, 1.80);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6;
    part(new THREE.BoxGeometry(0.062, 0.34, 0.062), STONE, 1.61, a,
      Math.cos(a) * 0.265, Math.sin(a) * 0.265);
  }

  // A six-sided roof with a pronounced flare, and a finial.
  part(new THREE.ConeGeometry(0.56, 0.34, 6, 1), STONE, 2.01, Math.PI / 6);
  part(new THREE.SphereGeometry(0.10, 8, 6), STONE, 2.22);

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/* ────────────────────────────────────────────────────────────────
   Cliff-top hokora and canine guardians
   ──────────────────────────────────────────────────────────────── */

/**
 * A modest stone hokora: two shallow steps, a single-cell shrine, dark
 * opening, projecting gable roof and ridge cap. Local +Z is the facade.
 */
function makeHokoraGeometry() {
  const parts = [];
  const tint = new THREE.Color();

  const part = (geo, hex, x, y, z, rz = 0, rx = 0) => {
    if (rz) geo.rotateZ(rz);
    if (rx) geo.rotateX(rx);
    geo.translate(x, y, z);
    tint.setHex(hex);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = tint.r;
      c[i * 3 + 1] = tint.g;
      c[i * 3 + 2] = tint.b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    geo.deleteAttribute('uv');
    parts.push(geo);
  };

  part(new THREE.BoxGeometry(1.52, 0.20, 1.18), STONE_DARK, 0, 0.10, 0);
  part(new THREE.BoxGeometry(1.30, 0.18, 1.00), STONE, 0, 0.29, 0);
  part(new THREE.BoxGeometry(1.10, 1.20, 0.84), STONE, 0, 0.98, 0);

  // Front gable closes the triangular wall under the two roof planes.
  {
    const gable = new THREE.BufferGeometry();
    gable.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.55, 1.58, 0.425,
       0.55, 1.58, 0.425,
       0.00, 2.00, 0.425,
    ], 3));
    // Seen from the approach, this order points toward local +Z.
    gable.setIndex([0, 1, 2]);
    gable.computeVertexNormals();
    part(gable, STONE, 0, 0, 0);
  }

  // The opening is a deliberately shallow dark inset rather than a painted
  // mark, so the facade keeps a readable recess in hard daylight.
  part(new THREE.BoxGeometry(0.54, 0.68, 0.055), TORII_DARK, 0, 1.08, 0.455);
  part(new THREE.BoxGeometry(0.68, 0.10, 0.16), STONE_DARK, 0, 0.70, 0.49);

  const roofTilt = 0.48;
  part(new THREE.BoxGeometry(0.88, 0.12, 1.28), STONE_DARK,
    -0.36, 1.82, 0, roofTilt);
  part(new THREE.BoxGeometry(0.88, 0.12, 1.28), STONE_DARK,
     0.36, 1.82, 0, -roofTilt);
  part(new THREE.CylinderGeometry(0.075, 0.075, 1.36, 8), STONE_DARK,
    0, 2.05, 0, 0, Math.PI * 0.5);

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * One seated low-poly canine guardian. Local +Z is the direction it watches.
 * The vermilion collar and bib echo the torii without turning the statue into
 * a painted figure.
 */
function makeCanineGuardianGeometry() {
  const parts = [];
  const tint = new THREE.Color();

  const part = (geo, hex, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => {
    geo.scale(sx, sy, sz);
    if (rx) geo.rotateX(rx);
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    tint.setHex(hex);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = tint.r;
      c[i * 3 + 1] = tint.g;
      c[i * 3 + 2] = tint.b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    geo.deleteAttribute('uv');
    parts.push(geo);
  };

  part(new THREE.CylinderGeometry(0.27, 0.30, 0.12, 8), STONE_DARK,
    0, 0.06, 0);
  part(new THREE.SphereGeometry(0.28, 7, 5), STONE,
    0, 0.39, -0.04, 0.78, 1.18, 0.82);
  part(new THREE.SphereGeometry(0.25, 7, 5), STONE,
    0, 0.70, 0.07, 0.92, 0.96, 0.90);
  part(new THREE.BoxGeometry(0.22, 0.16, 0.20), STONE,
    0, 0.66, 0.27);
  part(new THREE.SphereGeometry(0.055, 6, 4), STONE_DARK,
    0, 0.68, 0.385);

  // Tall ears and compact forepaws make the dog/fox silhouette legible from
  // the path even at this deliberately small scale.
  part(new THREE.ConeGeometry(0.095, 0.27, 5), STONE,
    -0.13, 0.94, 0.06, 1, 1, 1, 0, 0.10);
  part(new THREE.ConeGeometry(0.095, 0.27, 5), STONE,
     0.13, 0.94, 0.06, 1, 1, 1, 0, -0.10);
  part(new THREE.BoxGeometry(0.12, 0.30, 0.13), STONE,
    -0.12, 0.24, 0.17);
  part(new THREE.BoxGeometry(0.12, 0.30, 0.13), STONE,
     0.12, 0.24, 0.17);

  // A raised tapered tail is kept clear of the back so it reads in silhouette.
  part(new THREE.ConeGeometry(0.13, 0.48, 6), STONE,
    0.20, 0.42, -0.27, 1, 1, 1, -0.76, 0.18);
  part(new THREE.TorusGeometry(0.205, 0.032, 5, 10), VERMILION,
    0, 0.58, 0.04, 1, 1, 1, Math.PI * 0.5);

  {
    const bib = new THREE.BufferGeometry();
    bib.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.16, 0.57, 0.285,
       0.16, 0.57, 0.285,
       0.00, 0.35, 0.315,
    ], 3));
    // Front face toward local +Z, matching the gable and the approach view.
    bib.setIndex([0, 2, 1]);
    bib.computeVertexNormals();
    part(bib, VERMILION, 0, 0, 0);
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/* ────────────────────────────────────────────────────────────────
   Torii
   ──────────────────────────────────────────────────────────────── */

const VERMILION = 0xc73e2a;
const TORII_DARK = 0x30261e;

/**
 * A myōjin-style torii: two posts, the tie beam (nuki), the strut (gakuzuka),
 * and the double lintel (shimaki under a dark kasagi). Merged into one
 * geometry with painted vertex colours, same trick as the lantern, so three
 * gates are one instanced draw call.
 */
function makeToriiGeometry() {
  const parts = [];
  const tint = new THREE.Color();
  const part = (geo, hex, y, x = 0) => {
    geo.translate(x, y, 0);
    tint.setHex(hex);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = tint.r; c[i * 3 + 1] = tint.g; c[i * 3 + 2] = tint.b; }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    // UVs are KEPT (cylinders and boxes both have them, so the merge is
    // consistent) — the torii material carries a generated wood-grain bumpMap.
    parts.push(geo);
  };

  // Piliers ALLONGÉS sous le niveau 0 (span −1.8..4.5) : c'est le fût qui
  // s'enterre dans la pente, pas le portique qui s'enfonce — enfoncer tout
  // le torii posait la traverse basse au ras du sol (capture joueur).
  part(new THREE.CylinderGeometry(0.20, 0.27, 6.3, 10), VERMILION, 1.35, -1.9);
  part(new THREE.CylinderGeometry(0.20, 0.27, 6.3, 10), VERMILION, 1.35, 1.9);
  part(new THREE.BoxGeometry(5.0, 0.26, 0.22), VERMILION, 3.30);
  part(new THREE.BoxGeometry(0.22, 0.92, 0.20), VERMILION, 3.88);
  part(new THREE.BoxGeometry(5.3, 0.24, 0.32), VERMILION, 4.44);
  part(new THREE.BoxGeometry(6.1, 0.32, 0.40), TORII_DARK, 4.72);

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/* ────────────────────────────────────────────────────────────────
   Factory
   ──────────────────────────────────────────────────────────────── */

/**
 * @param {object}   opts
 * @param {number}   [opts.seed]
 * @param {object}   opts.quality   one of config.QUALITY
 * @param {Function} opts.heightAt
 * @param {Function} [opts.slopeAt]
 * @param {Function} [opts.normalAt]
 * @param {Function} [opts.inWater]  (x, z) => bool — ponds
 * @param {object}   [opts.wind]     from createWind(); shared BY REFERENCE
 * @param {string}   [opts.season]   'spring' | 'autumn' — construction-time palette
 */
export function createDetails({
  seed = 1337,
  quality = null,
  heightAt,
  slopeAt = null,
  normalAt = null,
  inWater = null,
  wind = null,
  season = 'spring',
} = {}) {
  if (typeof heightAt !== 'function') {
    throw new Error('[details] createDetails requires heightAt(x, z) -> y');
  }

  const mode = season === 'autumn' ? 'autumn' : 'spring';
  const profile = FLOWER_PROFILES[mode] || FLOWER_PROFILES.spring;
  if (typeof heightAt !== 'function') {
    throw new Error('[details] createDetails requires heightAt(x, z) -> y');
  }

  const group = new THREE.Group();
  group.name = 'details';
  const disposables = [];
  const label = quality?.label ?? 'high';
  const budget = label === 'ultra' ? 1.0 : label === 'high' ? 0.62 : 0.3;

  const wet = (x, z) => (inWater ? inWater(x, z) : false);

  /* ── 1. wildflowers ──────────────────────────────────────────── */

  const flowerMeshes = [];
  {
    const rng = streamFor(seed, 'details.flowers');
    // Quoted per unit island and multiplied by AREA — flowers cover ground, and
    // instanced quads are cheap enough to afford full-density coverage.
    const total = Math.round(2500 * budget * AREA);

    // Species are laid out as separate drifts, each with its own low-frequency
    // mask offset, so they clump apart from each other instead of every patch
    // being a uniform mixture of all four.
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _p = new THREE.Vector3();
    const _s = new THREE.Vector3();
    const _n = new THREE.Vector3();

    for (let f = 0; f < FLOWER_BASE.length; f++) {
      const base = FLOWER_BASE[f];
      const colors = profile[base.name] || FLOWER_PROFILES.spring[base.name];
      const spec = { ...base, petal: colors.petal, heart: colors.heart };
      const want = Math.max(1, Math.round(total * spec.weight));
      const geo = makeFlowerGeometry(spec, rng, profile.stem);
      disposables.push(geo);

      const mat = makeFoliageMaterial(wind);
      disposables.push(mat);

      const mesh = new THREE.InstancedMesh(geo, mat, want);
      mesh.name = `flowers-${spec.name}`;
      mesh.castShadow = false;      // 9k shadow casters for 8cm of geometry is not a trade
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

      const driftX = f * 137.7, driftZ = f * 91.3;
      let placed = 0, attempts = 0;
      const maxAttempts = want * 40;

      while (placed < want && attempts < maxAttempts) {
        attempts++;
        const x = R.range(rng, -104 * LAND_SCALE, 104 * LAND_SCALE);
        const z = R.range(rng, -112 * LAND_SCALE, 96 * LAND_SCALE);

        // Drift mask first — it rejects most candidates for the price of one
        // noise lookup, which is what keeps the attempt loop affordable.
        //
        // noise.js's fbm2 is GRADIENT noise: it is centred on zero and runs
        // roughly -0.7..0.7, not 0..1. Thresholding it as if it were unit-range
        // passes only the top few percent, which here meant asking for four
        // thousand daisies and planting fourteen.
        const drift = fbm2((x + driftX) * 0.026, (z + driftZ) * 0.026, 3) * 0.5 + 0.5;
        const p = smoothstep(0.42, 0.62, drift);
        if (p <= 0.02 || rng() > p) continue;

        const h = heightAt(x, z);
        if (h < WORLD.beachTop + 0.5 || h > WORLD.grassTop - 1.5) continue;
        if (slopeAt && slopeAt(x, z) > 0.34) continue;
        if (wet(x, z)) continue;
        // Pas de fleurs sur la terre battue — la sente porte une herbe rase
        // (grass.js shortZone), pas des corolles intactes en plein passage.
        if (isOnPath(x, z, 0.4)) continue;

        if (normalAt) normalAt(x, z, _n); else _n.set(0, 1, 0);
        _n.lerp(UP, 0.45).normalize();
        _q.setFromUnitVectors(UP, _n);
        _q.multiply(_spinQ.setFromAxisAngle(UP, rng() * TAU));
        const sc = R.range(rng, 0.78, 1.35);
        _m.compose(_p.set(x, h - 0.02, z), _q, _s.set(sc, sc, sc));
        mesh.setMatrixAt(placed++, _m);
      }

      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      flowerMeshes.push(mesh);
    }
  }

  /* ── 2. stone lanterns ───────────────────────────────────────── */

  let glowMesh = null;
  let lanternCount = 0;
  {
    const rng = streamFor(seed, 'details.lanterns');
    // Generated ONLY along the path network (+ terrace pair). No orphan lamps.
    const spots = computeLanternSpots(heightAt, slopeAt);
    lanternSpots = spots.map((s) => ({ x: s.x, z: s.z }));
    lanternCount = spots.length;

    if (lanternCount > 0) {
      const geo = makeLanternGeometry();
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.94, metalness: 0,
      });
      disposables.push(geo, mat);

      const stones = new THREE.InstancedMesh(geo, mat, lanternCount);
      stones.name = 'lanterns';
      stones.castShadow = true;
      stones.receiveShadow = true;

      // Additive blending plus a per-instance colour is how many lanterns get
      // independent brightnesses out of one draw call: InstancedMesh has no
      // per-instance alpha, but an additive black instance contributes nothing.
      // Sized to sit inside the fire box's frame (slabs at 1.42 and 1.80) and
      // show between the corner posts, not through them.
      const glowGeo = new THREE.SphereGeometry(0.185, 10, 8);
      // `vertexColors: true` and a white colour attribute are BOTH required, and
      // neither is optional: three's color_fragment chunk is guarded on USE_COLOR
      // alone, so an instanceColor on a material without vertexColors is uploaded,
      // multiplied into vColor in the vertex stage, and then never read — the
      // fragment does not even declare the varying. And with vertexColors on but
      // no `color` attribute, the missing attribute reads as black.
      {
        const n = glowGeo.attributes.position.count;
        glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      }
      const glowMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      disposables.push(glowGeo, glowMat);
      glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, lanternCount);
      glowMesh.name = 'lantern-glows';
      glowMesh.renderOrder = 3;
      glowMesh.frustumCulled = false;

      const _m = new THREE.Matrix4();
      const _q = new THREE.Quaternion();
      const _e = new THREE.Euler();
      const _p = new THREE.Vector3();
      const _s = new THREE.Vector3(1, 1, 1);

      for (let i = 0; i < lanternCount; i++) {
        const { x, z } = spots[i];
        const h = heightAt(x, z);
        // A stone lantern that has stood in a meadow for a century is not plumb.
        _e.set(R.range(rng, -0.045, 0.045), rng() * TAU, R.range(rng, -0.045, 0.045));
        _q.setFromEuler(_e);
        _m.compose(_p.set(x, h - 0.05, z), _q, _s);
        stones.setMatrixAt(i, _m);
        _m.compose(_p.set(x, h - 0.05 + 1.61, z), _q, _s);
        glowMesh.setMatrixAt(i, _m);
        glowMesh.setColorAt(i, _glowCol.setRGB(0, 0, 0));
      }
      stones.instanceMatrix.needsUpdate = true;
      glowMesh.instanceMatrix.needsUpdate = true;
      glowMesh.instanceColor.needsUpdate = true;
      stones.computeBoundingSphere();
      group.add(stones, glowMesh);
    }
  }

  /* ── 3. tideline ─────────────────────────────────────────────── */

  {
    const rng = streamFor(seed, 'details.shore');
    const pebbleGeo = new THREE.IcosahedronGeometry(0.16, 0);
    const pebbleMat = new THREE.MeshStandardMaterial({
      color: 0xa8a096, roughness: 0.92, metalness: 0, vertexColors: true,
    });
    // Vertex-tint each pebble face so a hundred copies of one icosahedron do not
    // all catch the light identically.
    {
      const n = pebbleGeo.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const t = 0.78 + rng() * 0.42;
        c[i * 3] = t; c[i * 3 + 1] = t * 0.98; c[i * 3 + 2] = t * 0.93;
      }
      pebbleGeo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    }
    disposables.push(pebbleGeo, pebbleMat);

    const want = Math.round(120 * budget * AREA);
    const mesh = new THREE.InstancedMesh(pebbleGeo, pebbleMat, want);
    mesh.name = 'shore-pebbles';
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler();
    const _p = new THREE.Vector3();
    const _s = new THREE.Vector3();

    let placed = 0, attempts = 0;
    while (placed < want && attempts < want * 60) {
      attempts++;
      const x = R.range(rng, -112 * LAND_SCALE, 112 * LAND_SCALE);
      const z = R.range(rng, -120 * LAND_SCALE, 104 * LAND_SCALE);
      const h = heightAt(x, z);
      // The tideline proper: damp sand just above the water, and a little below
      // it where the pebbles show through the shallows.
      if (h < -0.55 || h > WORLD.beachTop * 0.85) continue;
      if (wet(x, z)) continue;
      _e.set(rng() * TAU, rng() * TAU, rng() * TAU);
      _q.setFromEuler(_e);
      const sc = R.skew(rng, 0.35, 1.5, 1.8);
      _m.compose(_p.set(x, h - 0.04 * sc, z), _q, _s.set(sc, sc * 0.62, sc * 1.15));
      mesh.setMatrixAt(placed++, _m);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  /* ── 4. path network ribbons, overlook terrace, torii ────────── */

  {
    // Shared material + grit shader for every packed-earth ribbon.
    const base = new THREE.Color(0xb59d76);   // dry packed earth, light enough to read against the grass
    const pathMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1.0, metalness: 0,
      // Wins the depth fight against the terrain it hugs on steeper ground.
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    // Gritty speckle so the packed earth reads as trodden grit, not paint.
    // World-position keyed — the ribbons have no UVs.
    pathMat.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute float aPathEdge;\nvarying float vPathEdge;\nvarying vec3 vPathW;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvPathW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n\tvPathEdge = aPathEdge;'
      );
      shader.fragmentShader = /* glsl */ `
        varying vec3 vPathW;
        varying float vPathEdge;
        float ph21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float pvn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(ph21(i), ph21(i + vec2(1.0, 0.0)), f.x),
                     mix(ph21(i + vec2(0.0, 1.0)), ph21(i + vec2(1.0, 1.0)), f.x), f.y);
        }
      ` + shader.fragmentShader.replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec2 q = vPathW.xz;
          float grit = pvn(q * 6.5) * 0.55 + pvn(q * 21.0) * 0.45;
          float mottle = pvn(q * 1.9 + 7.3);
          // SENTE FOULEE, pas ruban decoupe (consigne joueur : un chemin trace
          // par des passages repetes). Trois etages :
          // 1. le grain et la marbrure de terre battue, partout ;
          diffuseColor.rgb *= 0.80 + 0.30 * grit;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.88, 0.80, 0.62), mottle * 0.35);
          // 2. le coeur COMPACTE par les pas, un peu plus clair et lisse ;
          diffuseColor.rgb *= 1.0 + 0.10 * smoothstep(0.5, 0.0, vPathEdge);
          // 3. un LISERE de bord seulement : verdissement doux et effilochage
          //    FIN, confines au dernier quart du demi-ruban. Les versions
          //    larges (amplitude 0.5, frequences basses) envoyaient des
          //    langues vertes jusqu'au coeur — lues comme des trous.
          float fray = pvn(q * 7.0) * 0.5 + pvn(q * 18.0) * 0.5;
          float verge = smoothstep(0.66, 0.97, vPathEdge + (fray - 0.5) * 0.20);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.80, 0.86, 0.62), verge * 0.6);
          float cut = vPathEdge + (fray - 0.5) * 0.26;
          if (cut > 0.90) discard;
        }`
      );
    };
    pathMat.customProgramCacheKey = () => 'sakurajima-path-v5';
    disposables.push(pathMat);

    const p = new THREE.Vector3(), tn = new THREE.Vector3();

    // One ribbon geometry per route + le patin de carrefour, tous produits
    // par les builders PURS partages avec test/invariants.html (invariant 8 :
    // la surface interpolee des rubans reste au-dessus de heightAt partout).
    // La geometrie testee est EXACTEMENT celle rendue.
    const surfaces = computeRibbonMeshes(heightAt);
    surfaces.push(computeJunctionPad(heightAt));
    for (const surf of surfaces) {
      const col = [];
      for (let vi = 0; vi < surf.edgeRaw.length; vi++) {
        const cx = surf.pos[vi * 3], cz = surf.pos[vi * 3 + 2];
        const edg = surf.edgeRaw[vi];
        // worn lighter along the crown, darker at the verges
        const v = (edg < 0.25 ? 1.06 : 0.86 + 0.14 * (1 - edg)) * (0.92 + 0.16 * fbm2(cx * 0.21, cz * 0.21, 2));
        col.push(base.r * v, base.g * v, base.b * v);
      }
      const pathGeo = new THREE.BufferGeometry();
      pathGeo.setAttribute('position', new THREE.Float32BufferAttribute(surf.pos, 3));
      pathGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      pathGeo.setAttribute('aPathEdge', new THREE.Float32BufferAttribute(surf.edge, 1));
      pathGeo.setIndex(surf.idx);
      pathGeo.computeVertexNormals();
      disposables.push(pathGeo);
      const path = new THREE.Mesh(pathGeo, pathMat);
      path.name = `path-${surf.name}`;
      path.receiveShadow = true;
      group.add(path);
    }

    // — the overlook terrace at the cliff rim: the torii climb's destination —
    {
      const SEG2 = 28;
      const tp = [], tc = [], ti = [];
      // Terrace centres on the END of the torii route (west rim).
      const toriiRoute = _routes.find((r) => r.name === 'torii');
      const [cx0, cz0] = toriiRoute
        ? [toriiRoute.points[toriiRoute.points.length - 1][0],
           toriiRoute.points[toriiRoute.points.length - 1][1]]
        : [-88 * LAND_SCALE, 0];
      const cy0 = heightAt(cx0, cz0);
      const te = [];
      tp.push(cx0, cy0 + 0.22, cz0);
      tc.push(base.r * 1.05, base.g * 1.05, base.b * 1.05);
      te.push(0);
      for (let s2 = 0; s2 <= SEG2; s2++) {
        const a2 = (s2 / SEG2) * Math.PI * 2;
        const rr = 3.6 * (0.80 + 0.35 * fbm2(Math.cos(a2) * 2.1 + 5.0, Math.sin(a2) * 2.1, 2));
        const px2 = cx0 + Math.cos(a2) * rr, pz2 = cz0 + Math.sin(a2) * rr;
        tp.push(px2, heightAt(px2, pz2) + 0.14, pz2);
        const v2 = 0.86 * (0.92 + 0.16 * fbm2(px2 * 0.21, pz2 * 0.21, 2));
        tc.push(base.r * v2, base.g * v2, base.b * v2);
        // Le pourtour porte aPathEdge = 1 : le shader effiloche et verdit le
        // rebord de la terrasse comme un bord de sente — un disque net posé
        // dans l'herbe lisait comme une dalle (« le chemin s'arrête net »).
        te.push(1);
        // Winding matches the ocean disc's proven fan (centre, next, current):
        // faces point UP. The winding trap has bitten this repo four times.
        if (s2 < SEG2) ti.push(0, s2 + 2, s2 + 1);
      }
      const terrGeo = new THREE.BufferGeometry();
      terrGeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      terrGeo.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3));
      terrGeo.setAttribute('aPathEdge', new THREE.Float32BufferAttribute(te, 1));
      terrGeo.setIndex(ti);
      terrGeo.computeVertexNormals();
      disposables.push(terrGeo);
      const terrace = new THREE.Mesh(terrGeo, pathMat);
      terrace.name = 'overlook-terrace';
      terrace.receiveShadow = true;
      group.add(terrace);
    }

    // — a canine deity's hokora at the cliff side of the terrace —
    {
      const shrineRoute = _routes.find((r) => r.name === 'torii');
      if (shrineRoute) {
        const end = shrineRoute.points[shrineRoute.points.length - 1];
        shrineRoute.curve.getTangentAt(0.9999, tn);
        const tl = Math.hypot(tn.x, tn.z) || 1;
        const tx = tn.x / tl, tz = tn.z / tl;
        const nx = -tz, nz = tx;

        // Local +Z faces back down the final path tangent, toward the player.
        const facing = Math.atan2(-tx, -tz);
        const shrineGeo = makeHokoraGeometry();
        const guardianGeo = makeCanineGuardianGeometry();
        const shrineMat = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.94, metalness: 0, flatShading: true,
        });
        disposables.push(shrineGeo, guardianGeo, shrineMat);

        // The shrine sits beyond the route end, on the west/cliff half of the
        // pad. Its broad bottom step is sunk slightly into the raised earth.
        const shrineX = end[0] + tx * 1.40;
        const shrineZ = end[1] + tz * 1.40;
        const hokora = new THREE.Mesh(shrineGeo, shrineMat);
        hokora.name = 'cliff-hokora';
        hokora.position.set(shrineX, heightAt(shrineX, shrineZ) + 0.10, shrineZ);
        hokora.rotation.y = facing;
        hokora.castShadow = true;
        hokora.receiveShadow = true;

        // Guardians frame a central 1.5 u opening. They remain well inside the
        // terrace pair of lanterns (offset about 3.7 u) and do not overlap them.
        const guardians = new THREE.Group();
        guardians.name = 'cliff-hokora-guardians';
        for (const side of [-1, 1]) {
          const forward = 0.34;
          const lateral = 1.02 * side;
          const gx = end[0] + tx * forward + nx * lateral;
          const gz = end[1] + tz * forward + nz * lateral;
          const statue = new THREE.Mesh(guardianGeo, shrineMat);
          statue.name = side < 0 ? 'guardian-canine-left' : 'guardian-canine-right';
          statue.position.set(gx, heightAt(gx, gz) + 0.11, gz);
          statue.rotation.y = facing + side * 0.08;
          statue.castShadow = true;
          statue.receiveShadow = true;
          guardians.add(statue);
        }

        group.add(hokora, guardians);
      }
    }

    // — torii only on the 'torii' climb, oriented across the path —
    const toriiRoute = _routes.find((r) => r.name === 'torii');
    const toriiFracs = toriiRoute?.toriiAt || [];
    if (toriiRoute && toriiFracs.length > 0) {
      const toriiGeo = makeToriiGeometry();
      const toriiBump = makeWoodBump(seed);
      toriiBump.repeat.set(1.5, 1);
      const toriiMat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.72, metalness: 0,
        bumpMap: toriiBump, bumpScale: 0.22,
      });
      disposables.push(toriiBump);
      disposables.push(toriiGeo, toriiMat);
      const torii = new THREE.InstancedMesh(toriiGeo, toriiMat, toriiFracs.length);
      torii.name = 'torii';
      torii.castShadow = true;
      torii.receiveShadow = true;
      const _m = new THREE.Matrix4();
      const _q = new THREE.Quaternion();
      const _e = new THREE.Euler();
      const _p = new THREE.Vector3();
      const _s = new THREE.Vector3(1, 1, 1);
      toriiFracs.forEach((t, i) => {
        const tt = Math.min(Math.max(t, 0), 0.9999);
        toriiRoute.curve.getPointAt(tt, p);
        toriiRoute.curve.getTangentAt(tt, tn);
        // Local +X across the walking direction — posts flank the path so you
        // walk UNDER the gate (perpendicular to the local tangent).
        _e.set(0, Math.atan2(tn.x, tn.z), 0);
        _q.setFromEuler(_e);
        // Base calée sur le CHEMIN AU CENTRE : la caler sur le pied le plus
        // bas enterrait le portique côté amont (encore « trop bas », capture
        // joueur). Les piliers descendent 1.8·s sous la base — c'est EUX qui
        // rattrapent le dévers côté aval. Et le portique est grandi ×1.35 :
        // un torii se traverse tête haute, il domine le marcheur.
        const sT = 1.35;
        const baseY = heightAt(p.x, p.z) - 0.10;
        _s.set(sT, sT, sT);
        _m.compose(_p.set(p.x, baseY, p.z), _q, _s);
        torii.setMatrixAt(i, _m);
      });
      torii.instanceMatrix.needsUpdate = true;
      torii.computeBoundingSphere();
      group.add(torii);
    }
  }

  /* ── update ──────────────────────────────────────────────────── */

  /**
   * The flowers ride the shared wind uniforms, so they need nothing per frame.
   * Only the lanterns do: their fire boxes come up at dusk and go out at dawn.
   */
  function update(t, phase) {
    if (!phase || !glowMesh) return;
    // Lit through the night and through both twilights.
    const lit = clamp(phase.night + phase.twilight * 0.75, 0, 1);
    glowMesh.visible = lit > 0.01;
    if (!glowMesh.visible) return;

    glowMesh.material.opacity = 1;
    for (let i = 0; i < lanternCount; i++) {
      // Stagger the flicker per lantern, or six lamps read as one lamp seen six
      // times. The phase offset is the index, so it costs nothing to keep.
      const f = 0.80 + 0.20 * Math.sin(t * 2.9 + i * 2.1 + Math.cos(t * 1.3 + i) * 1.6);
      // Deliberately over 1. The composer's render target is half-float, and the
      // bloom pass thresholds at 0.85 luminance — a glow clamped to 1 sits under
      // that and reads as a flat lit slab seen through the frame rather than as
      // a light. Overdriving it is what buys the halo.
      const v = clamp(lit, 0, 1) * f * 2.6;
      glowMesh.setColorAt(i, _glowCol.setHex(LANTERN_LIGHT).multiplyScalar(v));
    }
    glowMesh.instanceColor.needsUpdate = true;
  }

  function dispose() {
    for (const d of disposables) d.dispose?.();
    for (const m of flowerMeshes) m.dispose?.();
    glowMesh?.dispose?.();
  }

  return { group, update, dispose };
}

/* ── shared scratch, hoisted out of the placement and frame loops ── */
const UP = new THREE.Vector3(0, 1, 0);
const _spinQ = new THREE.Quaternion();
const _glowCol = new THREE.Color();

/**
 * A MeshStandardMaterial that bends with the shared wind.
 *
 * onBeforeCompile rather than a hand-written shader, for the same reason
 * grass.js does it: shadows, fog, the hemisphere bounce and the day/night light
 * rig all keep working, and there is no second lighting model to keep in step
 * with the first. The bend is an arc about the root — proportional to the SQUARE
 * of the height up the stem — not a shear, so the base stays planted.
 */
function makeFoliageMaterial(wind) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  mat.onBeforeCompile = (shader) => {
    if (wind && wind.uniforms) {
      // BY REFERENCE. One wind.update() drives the meadow, the canopies, the
      // petals and these; cloning the slots here would leave the flowers
      // waving on a clock of their own.
      for (const k in wind.uniforms) shader.uniforms[k] = wind.uniforms[k];
    }

    const windBlock = wind && wind.WIND_GLSL ? wind.WIND_GLSL : `
      vec3 windForce(vec3 p) { return vec3(0.0); }
      vec3 windForce(vec3 p, float t) { return vec3(0.0); }
    `;

    // After <common>, not at the top of the file: three's prefix and defines have
    // to be in scope before the wind block declares its uniforms, and grass.js
    // already injects at exactly this anchor.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\nattribute float aBase;\n${windBlock}`
    ).replace(
      '#include <begin_vertex>',
      /* glsl */ `
        #include <begin_vertex>
        {
          // Instance origin in world space — the wind field has to be sampled
          // per PLANT, not per vertex, or the flower shears as the field varies
          // across its own eight centimetres.
          vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 w = windForce(root);
          float bend = aBase * aBase;
          // Back into instance-local space: the instance matrix carries a
          // rotation, so a world-space push applied directly would lean every
          // flower on a slope the wrong way.
          vec3 wLocal = (transpose(mat3(modelMatrix * instanceMatrix)) * w);
          transformed.xz += wLocal.xz * bend * 0.42;
          transformed.y -= length(wLocal.xz) * bend * 0.10;
        }
      `
    );
  };

  // Materials that share a program key would otherwise reuse a cached program
  // compiled without the patch above.
  mat.customProgramCacheKey = () => 'sk-foliage-wind';
  return mat;
}

export default createDetails;
