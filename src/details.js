/**
 * details.js — the small things you only see once you are standing on the island.
 *
 * The scene was built from the outside in: an island, a sea, a sky, weather. All
 * of that reads from two hundred units away and none of it reads from two. Now
 * that there is a dog to walk, the ground is somewhere you actually go, and an
 * unbroken green field with trees standing in it looks like a golf course.
 *
 * Three passes, in the order they matter at eye level:
 *
 *   1. Wildflowers, in drifts rather than sprinkled. Real meadows are patchy —
 *      a species takes a hollow and holds it — and an even scatter is the single
 *      most reliable way to make procedural planting look procedural.
 *   2. Stone lanterns, which are the only man-made thing on the island besides
 *      the bridge. They also give the night cycle something to do at ground
 *      level: their fire boxes come up as the sun goes down.
 *   3. Beach litter — pebbles and driftwood along the tideline, where the eye
 *      goes looking for scale and currently finds an unbroken sweep of sand.
 *
 * Everything is instanced and everything is seeded. No textures, as elsewhere.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { streamFor, R, fbm2, clamp, smoothstep } from './noise.js';
import { makeWoodBump } from './detailtex.js';
import { WORLD, LAND_SCALE, AREA, RIVER, PATH } from './config.js';
import { riverBedFactor, waterSurfaceYAt } from './river.js';

const TAU = Math.PI * 2;

/* ────────────────────────────────────────────────────────────────
   The pilgrim path — spatial index
   ──────────────────────────────────────────────────────────────── */

const PATH_N = 240;
let PATH_CURVE = null;
let _pp = null;
let _pMinX = 0, _pMaxX = 0, _pMinZ = 0, _pMaxZ = 0;
let P_NX = 1, P_NZ = 1;
let _pGrid = null;
let _pathEnd = null;   // world {x, z} of the built path's last point

/**
 * (Re)build the path curve + its bucket index from a point list. The index
 * exists because `isOnPath` is called for every one of the grass system's
 * millions of rejection samples — anything not standing near the route must
 * pay four comparisons and nothing more.
 */
function buildPathIndex(points) {
  PATH_CURVE = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.5
  );
  _pp = PATH_CURVE.getSpacedPoints(PATH_N);

  // Organic wander: push every sample sideways with low-frequency fbm, then
  // REBUILD the curve from the perturbed samples and resample — so the ribbon,
  // the grass exclusion and the torii all follow the same wandering line. The
  // last stretch (t > 0.90) stays authored: initPath snaps it onto the real
  // bridge abutment and the invariants assert on it.
  {
    const _tanP = new THREE.Vector3();
    for (let i = 1; i < PATH_N; i++) {
      const t = i / PATH_N;
      const amp = 2.5 * (1 - smoothstep(0.90, 0.97, t)) * (i < 4 ? i / 4 : 1);
      PATH_CURVE.getTangentAt(t, _tanP);
      const nx = -_tanP.z, nz = _tanP.x;
      const l = Math.hypot(nx, nz) || 1;
      const off = fbm2(_pp[i].x * 0.02 + 7.7, _pp[i].z * 0.02 - 3.1, 3) * amp;
      _pp[i].x += (nx / l) * off;
      _pp[i].z += (nz / l) * off;
    }
    const ctrl = [];
    for (let i = 0; i <= PATH_N; i += 4) ctrl.push(_pp[Math.min(i, PATH_N)].clone());
    if ((PATH_N % 4) !== 0) ctrl.push(_pp[PATH_N].clone());
    PATH_CURVE = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);
    _pp = PATH_CURVE.getSpacedPoints(PATH_N);
  }
  _pathEnd = { x: _pp[PATH_N].x, z: _pp[PATH_N].z };

  const P_PAD = PATH.width * 0.5 + 1.4;
  _pMinX = Infinity; _pMaxX = -Infinity; _pMinZ = Infinity; _pMaxZ = -Infinity;
  for (const p of _pp) {
    if (p.x < _pMinX) _pMinX = p.x; if (p.x > _pMaxX) _pMaxX = p.x;
    if (p.z < _pMinZ) _pMinZ = p.z; if (p.z > _pMaxZ) _pMaxZ = p.z;
  }
  _pMinX -= P_PAD; _pMaxX += P_PAD; _pMinZ -= P_PAD; _pMaxZ += P_PAD;
  P_NX = Math.max(1, Math.ceil((_pMaxX - _pMinX) / P_CELL));
  P_NZ = Math.max(1, Math.ceil((_pMaxZ - _pMinZ) / P_CELL));
  _pGrid = new Array(P_NX * P_NZ);
  for (let i = 0; i <= PATH_N; i++) {
    const cx = Math.min(P_NX - 1, Math.max(0, Math.floor((_pp[i].x - _pMinX) / P_CELL)));
    const cz = Math.min(P_NZ - 1, Math.max(0, Math.floor((_pp[i].z - _pMinZ) / P_CELL)));
    (_pGrid[cz * P_NX + cx] ||= []).push(i);
  }
}
const P_CELL = 12;
// Fallback index from the authored points, so isOnPath works before initPath
// (and in standalone test pages that never build a bridge).
buildPathIndex(PATH.points);

/**
 * Snap the path's final approach onto the bridge's REAL west abutment.
 *
 * The bridge slides up to ±12 units along its own axis to find level footing
 * (river.js buildBridge), so the authored endpoint is only nominal. Call this
 * after river.build() and BEFORE createGrass — the grass exclusion evaluates
 * isOnPath at placement time and must follow the corrected route.
 * Returns the corrected end point {x, z} (the invariants test asserts on it).
 */
export function initPath(bridgeInfo) {
  if (!bridgeInfo || !bridgeInfo.ends) return _pathEnd;
  const pts = PATH.points.map(([x, z]) => [x, z]);
  const [lx, lz] = pts[pts.length - 1];
  // The abutment nearest the authored end IS the path's end of the deck —
  // don't assume an index in `ends`.
  let end = bridgeInfo.ends[0];
  for (const e of bridgeInfo.ends) {
    if ((e.x - lx) ** 2 + (e.z - lz) ** 2 < (end.x - lx) ** 2 + (end.z - lz) ** 2) end = e;
  }
  // Stop a couple of units OUTSIDE the abutment along the deck axis, so the
  // earth ribbon meets the stone footing instead of running under the deck.
  const ox = end.x - bridgeInfo.center.x, oz = end.z - bridgeInfo.center.z;
  const ol = Math.hypot(ox, oz) || 1;
  pts[pts.length - 1] = [end.x + (ox / ol) * 2.5, end.z + (oz / ol) * 2.5];
  buildPathIndex(pts);
  return _pathEnd;
}

/** True on the packed earth of the pilgrim path — keeps the grass off it. */
export function isOnPath(x, z) {
  if (x < _pMinX || x > _pMaxX || z < _pMinZ || z > _pMaxZ) return false;
  const cx = Math.min(P_NX - 1, Math.max(0, Math.floor((x - _pMinX) / P_CELL)));
  const cz = Math.min(P_NZ - 1, Math.max(0, Math.floor((z - _pMinZ) / P_CELL)));
  const r2 = (PATH.width * 0.5 + 1.3) ** 2;
  for (let dz = -1; dz <= 1; dz++) {
    const rz = cz + dz;
    if (rz < 0 || rz >= P_NZ) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const rx = cx + dx;
      if (rx < 0 || rx >= P_NX) continue;
      const bucket = _pGrid[rz * P_NX + rx];
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const p = _pp[bucket[k]];
        const ddx = x - p.x, ddz = z - p.z;
        if (ddx * ddx + ddz * ddz < r2) return true;
      }
    }
  }
  return false;
}

/* ── art direction ───────────────────────────────────────────────
 * Four species, weighted. The white daisy is the workhorse and reads at the
 * longest range; the others are accents. Deep violet is only 8% of the mix —
 * it is there to be found, not to be seen. */
// Sizes are frankly larger than life. A real daisy is 3 cm across, which at this
// world scale is four millimetres of corolla hidden among 55 cm grass blades —
// present in the buffer, invisible on screen. Blown up to roughly the size of a
// small poppy they read as flowers from where the dog actually walks.
const FLOWERS = [
  { name: 'daisy',   weight: 0.44, petal: 0xfbf7ee, heart: 0xe8c25c, petals: 8, size: 0.155, height: [0.42, 0.66] },
  { name: 'buttercup', weight: 0.27, petal: 0xf5c93f, heart: 0xd99a1e, petals: 5, size: 0.130, height: [0.34, 0.54] },
  { name: 'clover',  weight: 0.21, petal: 0xe9b6cd, heart: 0xf0d7e2, petals: 6, size: 0.118, height: [0.28, 0.46] },
  { name: 'harebell', weight: 0.08, petal: 0x8f7fd0, heart: 0xcfc6f0, petals: 5, size: 0.140, height: [0.46, 0.72] },
];

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
function makeFlowerGeometry(spec, rng) {
  const pos = [], nrm = [], col = [], base = [], idx = [];
  const petal = new THREE.Color(spec.petal);
  const heart = new THREE.Color(spec.heart);
  const stemCol = new THREE.Color(0x5f8a42);
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

  part(new THREE.CylinderGeometry(0.20, 0.25, 4.5, 10), VERMILION, 2.25, -1.9);
  part(new THREE.CylinderGeometry(0.20, 0.25, 4.5, 10), VERMILION, 2.25, 1.9);
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
 * @param {Function} [opts.inWater]  (x, z) => bool — ponds and river
 * @param {object}   [opts.wind]     from createWind(); shared BY REFERENCE
 */
export function createDetails({
  seed = 1337,
  quality = null,
  heightAt,
  slopeAt = null,
  normalAt = null,
  inWater = null,
  wind = null,
  bridgeInfo = null,   // river.bridgeInfo — the bridge's FINAL placement
} = {}) {
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

    for (let f = 0; f < FLOWERS.length; f++) {
      const spec = FLOWERS[f];
      const want = Math.max(1, Math.round(total * spec.weight));
      const geo = makeFlowerGeometry(spec, rng);
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
    // Hand-placed rather than scattered. Lanterns mark a route — one standing on
    // its own in the middle of a field reads as set dressing nobody put there.
    const spots = [
      [-14, 26], [4, 40], [22, 54], [40, 66],   // the approach to the bridge
      [-79, 12.5], [-59, 27.5], [-37, 44],      // beside the pilgrim path, cliff to bridge
      [-91, -2], [-86, 5],                      // flanking the overlook terrace at the rim
    ].map(([x, z]) => [x * LAND_SCALE, z * LAND_SCALE]);

    // A pair of lanterns flanking each end of the bridge. The bridge slides
    // along its own axis to find level footing, so its REAL placement comes
    // from river.bridgeInfo — the nominal curve position can be up to 12
    // units off the actual abutments. The nominal computation remains only
    // as a fallback for standalone use without a built river.
    if (bridgeInfo && bridgeInfo.ends) {
      const fx = -bridgeInfo.axis.z, fz = bridgeInfo.axis.x;   // flow axis
      for (const end of bridgeInfo.ends) {
        const ox = end.x - bridgeInfo.center.x, oz = end.z - bridgeInfo.center.z;
        const ol = Math.hypot(ox, oz) || 1;
        for (const along of [-1, 1]) {
          spots.push([
            end.x + (ox / ol) * 2.0 + fx * 2.6 * along,
            end.z + (oz / ol) * 2.0 + fz * 2.6 * along,
          ]);
        }
      }
    } else {
      const c = new THREE.CatmullRomCurve3(
        RIVER.path.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.5
      );
      const p = c.getPointAt(RIVER.bridgeAt);
      const tn = c.getTangentAt(RIVER.bridgeAt);
      const l = Math.hypot(tn.x, tn.z) || 1;
      const nx = -tn.z / l, nz = tn.x / l;      // deck axis
      const tx = tn.x / l, tz = tn.z / l;       // flow axis
      const end = RIVER.bridgeSpan * 0.5 + 2.0;
      for (const side of [-1, 1]) {
        for (const along of [-1, 1]) {
          spots.push([p.x + nx * end * side + tx * 2.6 * along, p.z + nz * end * side + tz * 2.6 * along]);
        }
      }
    }
    const usable = spots.filter(([x, z]) => heightAt(x, z) >= WORLD.beachTop && !wet(x, z));
    lanternCount = usable.length;

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

      // Additive blending plus a per-instance colour is how six lanterns get six
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
        const [x, z] = usable[i];
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

    // — river gravel: pebbles strewn along the carved beds, seen through the
    // now-transparent water. Sampled by jittering along the authored paths
    // instead of island-wide rejection (the channels are a sliver of the map).
    {
      const wantR = Math.round(420 * budget);
      const meshR = new THREE.InstancedMesh(pebbleGeo, pebbleMat, wantR);
      meshR.name = 'river-pebbles';
      meshR.castShadow = false;
      meshR.receiveShadow = true;
      const paths = [RIVER.path, ...(RIVER.branches || []).map((b) => b.path)];
      let placedR = 0, attemptsR = 0;
      while (placedR < wantR && attemptsR < wantR * 30) {
        attemptsR++;
        const path = paths[(rng() * paths.length) | 0];
        const a = path[(rng() * (path.length - 1)) | 0];
        const b2 = path[Math.min(path.length - 1, ((rng() * (path.length - 1)) | 0) + 1)];
        const tt = rng();
        const x = a[0] + (b2[0] - a[0]) * tt + R.range(rng, -9, 9);
        const z = a[1] + (b2[1] - a[1]) * tt + R.range(rng, -9, 9);
        if (riverBedFactor(x, z) < 0.45) continue;
        const h = heightAt(x, z);
        const w = waterSurfaceYAt(x, z);
        if (w === null || h > w - 0.08) continue;   // only the wetted bed
        _e.set(rng() * TAU, rng() * TAU, rng() * TAU);
        _q.setFromEuler(_e);
        const sc = R.skew(rng, 0.4, 1.9, 1.6);
        _m.compose(_p.set(x, h - 0.03 * sc, z), _q, _s.set(sc, sc * 0.6, sc * 1.2));
        meshR.setMatrixAt(placedR++, _m);
      }
      meshR.count = placedR;
      meshR.instanceMatrix.needsUpdate = true;
      meshR.computeBoundingSphere();
      group.add(meshR);
    }
  }

  /* ── 4. the pilgrim path and its torii ───────────────────────── */

  {
    // — packed-earth ribbon, draped on the terrain column by column. Three
    // columns (left edge, crown, right edge) so the surface twists with a
    // cross-slope and crowns slightly instead of sagging between quads.
    const N = 260;
    const pos = [], col = [], idx = [], edge = [];
    const p = new THREE.Vector3(), tn = new THREE.Vector3();
    const base = new THREE.Color(0xb59d76);   // dry packed earth, light enough to read against the grass
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      PATH_CURVE.getPointAt(t, p);
      PATH_CURVE.getTangentAt(t, tn);
      const l = Math.hypot(tn.x, tn.z) || 1;
      const nx = -tn.z / l, nz = tn.x / l;
      // INDEPENDENT widths per side - one symmetric width is what read as a
      // ruled band with two straight edges.
      const wL = PATH.width * 0.5 * (0.55 + 0.80 * fbm2(p.x * 0.11 + 3.1, p.z * 0.11, 2));
      const wR = PATH.width * 0.5 * (0.55 + 0.80 * fbm2(p.x * 0.11 - 9.4, p.z * 0.11 + 5.2, 2));
      const cols = [
        [p.x + nx * wL, p.z + nz * wL, 0.08, 1],
        [p.x, p.z, 0.16, 0],                 // the crown rides a touch higher
        [p.x - nx * wR, p.z - nz * wR, 0.08, 1],
      ];
      for (let c = 0; c < 3; c++) {
        const [cx, cz, lift, edg] = cols[c];
        edge.push(edg);
        pos.push(cx, heightAt(cx, cz) + lift, cz);
        // worn lighter along the crown, darker at the verges
        const v = (c === 1 ? 1.06 : 0.86) * (0.92 + 0.16 * fbm2(cx * 0.21, cz * 0.21, 2));
        col.push(base.r * v, base.g * v, base.b * v);
      }
      if (i < N) {
        // Winding chosen so the faces point UP — the trap that has now bitten
        // this project four times (ocean disc, corolla, bird wings, and this
        // ribbon): with the default FrontSide material a downward-wound strip
        // simply does not render, silently.
        const a = i * 3, b = a + 3;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
        idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      }
    }
    const pathGeo = new THREE.BufferGeometry();
    pathGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    pathGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    pathGeo.setAttribute('aPathEdge', new THREE.Float32BufferAttribute(edge, 1));
    pathGeo.setIndex(idx);
    pathGeo.computeVertexNormals();
    const pathMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1.0, metalness: 0,
      // Wins the depth fight against the terrain it hugs on steeper ground.
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    // Gritty speckle so the packed earth reads as trodden grit, not paint.
    // World-position keyed — the ribbon has no UVs.
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
          diffuseColor.rgb *= 0.90 + 0.20 * grit;
          // Ragged border: the outer rim is EATEN by world-position noise -
          // opaque cutout, so depth still writes and nothing needs sorting.
          float bite = pvn(q * 3.4) * 0.6 + pvn(q * 11.0) * 0.4;
          if (vPathEdge > 0.55 + bite * 0.45) discard;
        }`
      );
    };
    pathMat.customProgramCacheKey = () => 'sakurajima-path-v3';
    disposables.push(pathGeo, pathMat);
    const path = new THREE.Mesh(pathGeo, pathMat);
    path.name = 'pilgrim-path';
    path.receiveShadow = true;
    group.add(path);

    // — the overlook terrace at the cliff rim: the path has a destination —
    {
      const SEG2 = 28;
      const tp = [], tc = [], ti = [];
      const [cx0, cz0] = PATH.points[0];
      const cy0 = heightAt(cx0, cz0);
      tp.push(cx0, cy0 + 0.14, cz0);
      tc.push(base.r * 1.05, base.g * 1.05, base.b * 1.05);
      for (let s2 = 0; s2 <= SEG2; s2++) {
        const a2 = (s2 / SEG2) * Math.PI * 2;
        const rr = 3.6 * (0.80 + 0.35 * fbm2(Math.cos(a2) * 2.1 + 5.0, Math.sin(a2) * 2.1, 2));
        const px2 = cx0 + Math.cos(a2) * rr, pz2 = cz0 + Math.sin(a2) * rr;
        tp.push(px2, heightAt(px2, pz2) + 0.08, pz2);
        const v2 = 0.86 * (0.92 + 0.16 * fbm2(px2 * 0.21, pz2 * 0.21, 2));
        tc.push(base.r * v2, base.g * v2, base.b * v2);
        // Winding matches the ocean disc's proven fan (centre, next, current):
        // faces point UP. The winding trap has bitten this repo four times.
        if (s2 < SEG2) ti.push(0, s2 + 2, s2 + 1);
      }
      const terrGeo = new THREE.BufferGeometry();
      terrGeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      terrGeo.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3));
      terrGeo.setIndex(ti);
      terrGeo.computeVertexNormals();
      disposables.push(terrGeo);
      const terrace = new THREE.Mesh(terrGeo, pathMat);   // aPathEdge absent -> reads 0, no cutout
      terrace.name = 'overlook-terrace';
      terrace.receiveShadow = true;
      group.add(terrace);
    }

    // — the torii along the route —
    const toriiGeo = makeToriiGeometry();
    const toriiBump = makeWoodBump(seed);
    toriiBump.repeat.set(1.5, 1);
    const toriiMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.72, metalness: 0,
      bumpMap: toriiBump, bumpScale: 0.22,
    });
    disposables.push(toriiBump);
    disposables.push(toriiGeo, toriiMat);
    const torii = new THREE.InstancedMesh(toriiGeo, toriiMat, PATH.toriiAt.length);
    torii.name = 'torii';
    torii.castShadow = true;
    torii.receiveShadow = true;
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler();
    const _p = new THREE.Vector3();
    const _s = new THREE.Vector3(1, 1, 1);
    PATH.toriiAt.forEach((t, i) => {
      PATH_CURVE.getPointAt(t, p);
      PATH_CURVE.getTangentAt(t, tn);
      // Local +X across the walking direction — the posts flank the path.
      _e.set(0, Math.atan2(tn.x, tn.z), 0);
      _q.setFromEuler(_e);
      _m.compose(_p.set(p.x, heightAt(p.x, p.z) - 0.06, p.z), _q, _s);
      torii.setMatrixAt(i, _m);
    });
    torii.instanceMatrix.needsUpdate = true;
    torii.computeBoundingSphere();
    group.add(torii);
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
