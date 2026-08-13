/**
 * poi.js — authored landmarks.
 * Lot 1: kuromatsu + sitting rock past the beach-path terminus.
 * Lot 2: stepping stones on the big pond (stoneYAt).
 * Lot 3: jizō at the junction, tsukubai on the big-pond bank, iwakura
 *        (shimenawa + shide) on the largest ridge-reef block.
 * Lot 4: sea torii on the authored extra stack.
 * Lot 7: abandoned chashitsu on the etangs meadow edge (see chashitsu.js).
 *
 * Placement is a pure walk from PATHS / authored pond / reef (no WebGL)
 * so the invariant can fail the site without constructing a mesh.
 * Geometry is the lantern recipe: merged primitives, vertex colours.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PATHS, WORLD, POI, STONES, SEED, CAMERA, SEA_TORII } from './config.js';
import { streamFor, fbm2, R } from './noise.js';
import { springReefSite } from './island.js';
import { makeToriiGeometry } from './details.js';
import { makeWoodBump } from './detailtex.js';
import { computeChashitsuSite, createChashitsu, chashitsuKeepOut } from './chashitsu.js';

export { computeChashitsuSite, chashitsuKeepOut };

const BARK = 0x2a241c;
const BARK_DARK = 0x1a1612;
const NEEDLE = 0x24361c;
const NEEDLE_LIT = 0x3a5228;
const NEEDLE_DEEP = 0x1a2814;
const STONE = 0x8a8680;
const STONE_DARK = 0x716d69;
const STONE_MOSS = 0x5d6b33;
const STONE_LICHEN = 0xc8c2a2;

// Same formula as details.PATH_HALF — importing details would couple this
// module to the 2 k-line path/flower file for one constant.
const PATH_HALF = PATHS.width * 0.5 * 1.28;

/** Last slabs bound by createPOI. Tests pass an explicit list as the 3rd arg. */
let _slabs = [];

/**
 * Slab-top Y if (x,z) is on a stone disc, else 0.
 * Optional `slabs` keeps the query pure for the banc.
 */
export function stoneYAt(x, z, slabs = _slabs) {
  if (!slabs || !slabs.length) return 0;
  for (let i = 0; i < slabs.length; i++) {
    const s = slabs[i];
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return s.y;
  }
  return 0;
}

function plageRoute() {
  return PATHS.routes.find((r) => r.name === 'plage') || null;
}

/**
 * First dry-sand point off the ribbon, walking seaward from the plage end.
 * `yaw` faces inland so local +Z is the lean / wind-from-sea axis.
 */
export function computeShorePineSite({ heightAt, isOnPath, isInPond } = {}) {
  if (typeof heightAt !== 'function') return null;
  const route = plageRoute();
  if (!route || route.points.length < 2) return null;

  const pts = route.points;
  const [ax, az] = pts[pts.length - 2];
  const [bx, bz] = pts[pts.length - 1];
  let dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-6)) return null;
  dx /= len;
  dz /= len;

  const maxD = POI.pineSearch;
  const step = POI.pineStep;
  for (let d = 0; d <= maxD + 1e-6; d += step) {
    const x = bx + dx * d;
    const z = bz + dz * d;
    if (typeof isOnPath === 'function' && isOnPath(x, z, POI.pathClear)) continue;
    if (typeof isInPond === 'function' && isInPond(x, z)) continue;
    const h = heightAt(x, z);
    if (!(h > WORLD.seaLevel && h < POI.sandCeil)) continue;
    return { x, z, h, yaw: Math.atan2(-dx, -dz) };
  }
  return null;
}


/**
 * Sea gate on the authored extra stack, offset toward the beach-path
 * terminus so a walker on the sand sees the gate first, the islet behind.
 * Posts must still stand in open water. Pure: SEA_TORII + PATHS + heightAt.
 */
export function computeSeaToriiSite({ heightAt } = {}) {
  if (typeof heightAt !== 'function') return null;
  const st = SEA_TORII.stack;
  const route = plageRoute();
  const end = route && route.points.length
    ? route.points[route.points.length - 1]
    : [CAMERA.start.x, CAMERA.start.z];
  let dx = end[0] - st.x, dz = end[1] - st.z;
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-6)) return null;
  dx /= len;
  dz /= len;

  const x = st.x + dx * SEA_TORII.offset;
  const z = st.z + dz * SEA_TORII.offset;
  const yaw = Math.atan2(end[0] - st.x, end[1] - st.z);
  const scale = SEA_TORII.scale;
  const baseY = SEA_TORII.baseY;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const half = 1.9 * scale;
  const posts = [
    { x: x + half * c, z: z - half * s },
    { x: x - half * c, z: z + half * s },
  ];
  for (let i = 0; i < posts.length; i++) {
    const h = heightAt(posts[i].x, posts[i].z);
    if (!(h < 0)) return null;
    posts[i].h = h;
  }

  return {
    x, z,
    h: heightAt(x, z),
    yaw, scale, baseY,
    nukiY: baseY + 3.30 * scale,
    posts,
    stack: { x: st.x, z: st.z, h: heightAt(st.x, st.z) },
    extra: true,
  };
}

function paint(geo, hex, vary = 0) {
  const tint = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    const j = vary
      ? 1 + vary * fbm2(pos.getX(i) * 3.1 + 2.2, pos.getY(i) * 2.4 - 1.7, 3)
      : 1;
    c[i * 3] = tint.r * j;
    c[i * 3 + 1] = tint.g * j;
    c[i * 3 + 2] = tint.b * j;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/**
 * Grain + moss + rare lichen, echoing the hokora motif in vertex colours
 * so we do not lift the shrine shader out of details.js.
 */
function paintStone(geo, hex, mossAmt = 0.45) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const n = pos.count;
  const c = new Float32Array(n * 3);
  const base = new THREE.Color(hex);
  const moss = new THREE.Color(STONE_MOSS);
  const lichen = new THREE.Color(STONE_LICHEN);
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const grain = 0.82 + 0.28 * (0.60 * fbm2(x * 1.15 + 2.2, z * 1.15 - 1.4, 3)
      + 0.40 * fbm2(x * 4.10 + 11.3, y * 4.10 + 5.9, 2));
    tmp.copy(base).multiplyScalar(grain);
    const up = Math.max(0, nrm.getY(i));
    const low = Math.max(0, 1 - y * 0.55);
    const blotch = Math.max(0, fbm2(x * 2.35 + 9.2, z * 2.35 + 5.7, 3));
    const w = mossAmt * Math.min(0.82, low * (0.35 + 0.65 * blotch) * 0.85
      + up * 0.22);
    tmp.lerp(moss, w);
    tmp.multiplyScalar(1 - w * 0.16);
    const lichenN = fbm2(x * 7.20 + 6.8, y * 7.20 + 1.3, 2);
    if (lichenN > 0.42 && y > 0.28) {
      tmp.lerp(lichen, (lichenN - 0.42) * 0.28);
    }
    c[i * 3] = tmp.r;
    c[i * 3 + 1] = tmp.g;
    c[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function mergeParts(parts) {
  // Icosahedra and cylinders disagree on `index`; merge refuses a mix.
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  for (const g of flat) g.dispose();
  for (const g of parts) g.dispose();
  return merged;
}

/**
 * One black pine: a crooked trunk leaning inland (local +Z), branches
 * reaching sideways, foliage as irregular clouds at the branch tips —
 * not a stack of discs on a pole.
 */
export function makeKuromatsuGeometry() {
  const parts = [];
  const segs = [
    { h: 1.15, r0: 0.42, r1: 0.34, w: 0.04 },
    { h: 1.25, r0: 0.33, r1: 0.26, w: 0.06 },
    { h: 1.20, r0: 0.25, r1: 0.18, w: 0.08 },
    { h: 1.05, r0: 0.17, r1: 0.11, w: 0.07 },
    { h: 0.85, r0: 0.10, r1: 0.045, w: 0.05 },
  ];
  const wSum = segs.reduce((s, g) => s + g.w, 0);
  for (const s of segs) s.dA = POI.pineLean * (s.w / wSum);

  let y = -0.42, z = 0, angle = 0.08;
  const joints = [{ y, z, angle }];

  for (const s of segs) {
    const a0 = angle;
    const a1 = angle + s.dA;
    const mid = (a0 + a1) * 0.5;
    const cyl = new THREE.CylinderGeometry(s.r1, s.r0, s.h, 8);
    cyl.rotateX(mid);
    cyl.translate(0, y + Math.cos(mid) * s.h * 0.5, z + Math.sin(mid) * s.h * 0.5);
    paint(cyl, BARK, 0.10);
    parts.push(cyl);
    y += Math.cos(a1) * s.h;
    z += Math.sin(a1) * s.h;
    angle = a1;
    joints.push({ y, z, angle });
  }

  const flare = new THREE.CylinderGeometry(0.36, 0.52, 0.48, 8);
  flare.translate(0, -0.28, 0.03);
  paint(flare, BARK_DARK, 0.06);
  parts.push(flare);

  const cloud = (cx, cy, cz, sx, sy, sz, tilt, spin, col) => {
    const leaf = new THREE.IcosahedronGeometry(1, 1);
    leaf.scale(sx, sy, sz);
    leaf.rotateZ(tilt);
    leaf.rotateY(spin);
    leaf.rotateX(0.22);
    leaf.translate(cx, cy, cz);
    paint(leaf, col, 0.16);
    parts.push(leaf);
  };

  const arm = (jy, jz, ja, yaw, pitch, len, r) => {
    const wood = new THREE.CylinderGeometry(r * 0.42, r, len, 6);
    wood.rotateZ(yaw);
    wood.rotateX(pitch + ja * 0.25);
    const hx = Math.sin(yaw) * Math.cos(pitch) * len * 0.5;
    const hy = Math.cos(yaw) * Math.cos(pitch) * len * 0.5;
    const hz = Math.sin(pitch) * len * 0.5;
    wood.translate(hx, jy + hy * 0.15, jz + hz);
    paint(wood, BARK, 0.08);
    parts.push(wood);
    return { x: hx * 2, y: jy + hy * 0.35, z: jz + hz * 2 };
  };

  const b0 = arm(joints[1].y, joints[1].z, joints[1].angle, -1.15, 0.15, 1.55, 0.07);
  const b1 = arm(joints[2].y, joints[2].z, joints[2].angle, 1.05, 0.05, 1.85, 0.065);
  const b2 = arm(joints[2].y + 0.15, joints[2].z, joints[2].angle, -0.85, 0.35, 1.35, 0.05);
  const b3 = arm(joints[3].y, joints[3].z, joints[3].angle, 0.95, 0.28, 1.45, 0.048);
  const b4 = arm(joints[3].y, joints[3].z, joints[3].angle, -1.25, -0.05, 1.20, 0.042);
  const tip = joints[joints.length - 1];

  cloud(b0.x, b0.y + 0.15, b0.z, 1.15, 0.55, 0.95, -0.25, 0.4, NEEDLE);
  cloud(b0.x * 0.55, b0.y + 0.35, b0.z * 0.7, 0.85, 0.42, 0.70, -0.1, 1.1, NEEDLE_DEEP);
  cloud(b1.x, b1.y + 0.20, b1.z, 1.45, 0.62, 1.15, 0.20, -0.3, NEEDLE_LIT);
  cloud(b1.x * 0.6, b1.y + 0.45, b1.z * 0.55, 1.05, 0.48, 0.88, 0.12, 0.8, NEEDLE);
  cloud(b2.x, b2.y + 0.10, b2.z, 0.95, 0.44, 0.78, -0.18, 0.2, NEEDLE);
  cloud(b3.x, b3.y + 0.12, b3.z, 1.10, 0.50, 0.90, 0.15, -0.6, NEEDLE_LIT);
  cloud(b4.x, b4.y + 0.08, b4.z, 0.88, 0.40, 0.72, -0.22, 0.5, NEEDLE_DEEP);
  cloud(0.05, tip.y + 0.15, tip.z + 0.25, 0.95, 0.48, 0.80, 0.05, 0.15, NEEDLE_LIT);
  cloud(-0.35, tip.y - 0.05, tip.z - 0.05, 0.70, 0.36, 0.58, -0.3, 1.4, NEEDLE);

  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Noised icosahedron with the top clamped to a sit-able plateau (~1.4 u).
 */
export function makeSittingRockGeometry(seed = SEED) {
  const rng = streamFor(seed, 'poi.sit-rock');
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position;
  const ox = rng() * 20, oz = rng() * 20;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = fbm2(x * 2.2 + ox, z * 2.2 + oz, 4);
    const n2 = fbm2(y * 3.1 + ox * 0.5, x * 1.7 - oz, 3);
    const r = 1 + 0.16 * n + 0.07 * n2;
    let vx = x * r, vy = y * r * 0.62, vz = z * r * 0.92;
    if (vy > 0.20) vy = 0.20 + (vy - 0.20) * 0.08;
    if (vy < -0.32) vy = -0.32 + (vy + 0.32) * 0.35;
    pos.setXYZ(i, vx, vy, vz);
  }

  let platR = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0.16) continue;
    platR = Math.max(platR, Math.hypot(pos.getX(i), pos.getZ(i)));
  }
  const k = platR > 1e-4 ? (POI.rockPlateau * 0.5) / platR : 1;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i), pos.getZ(i) * k);
  }
  pos.needsUpdate = true;

  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const moss = new THREE.Color(STONE_MOSS);
  const base = new THREE.Color(STONE);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const grain = 0.88 + 0.18 * fbm2(pos.getX(i) * 4.2, pos.getZ(i) * 4.2 + 3.1, 3);
    c.copy(base).multiplyScalar(grain);
    const up = Math.max(0, (y - 0.04) / 0.20);
    c.lerp(moss, up * 0.45);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function inSandBand(heightAt, isOnPath, isInPond, x, z) {
  if (typeof isOnPath === 'function' && isOnPath(x, z, POI.pathClear)) return false;
  if (typeof isInPond === 'function' && isInPond(x, z)) return false;
  const h = heightAt(x, z);
  return h > WORLD.seaLevel && h < POI.sandCeil;
}

export function placeRock(pine, heightAt, isOnPath, isInPond) {
  const ix = Math.sin(pine.yaw), iz = Math.cos(pine.yaw);
  const scales = [1, 0.78, 0.58, 1.12];
  const laterals = [0, 0.40, -0.40, 0.75, -0.75];
  for (const k of scales) {
    for (const lat of laterals) {
      const x = pine.x - ix * POI.rockOffset * k + iz * lat;
      const z = pine.z - iz * POI.rockOffset * k - ix * lat;
      if (!inSandBand(heightAt, isOnPath, isInPond, x, z)) continue;
      return { x, z, h: heightAt(x, z), yaw: pine.yaw + Math.PI };
    }
  }
  return null;
}

function dryOffPath(heightAt, isOnPath, isInPond, x, z, extra, minH) {
  if (typeof isOnPath === 'function' && isOnPath(x, z, extra)) return false;
  if (typeof isInPond === 'function' && isInPond(x, z)) return false;
  const h = heightAt(x, z);
  return h > minH;
}

/** Undirected road axes at the junction, then the bisector of the widest gap. */
function junctionGapHeading() {
  const axes = [];
  const pushAxis = (dx, dz) => {
    if (!(Math.hypot(dx, dz) > 1e-6)) return;
    let a = Math.atan2(dz, dx);
    if (a < 0) a += Math.PI;
    if (a >= Math.PI) a -= Math.PI;
    axes.push(a);
  };
  for (const route of PATHS.routes) {
    const pts = route.points;
    if (pts.length < 2) continue;
    pushAxis(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    const last = pts[pts.length - 1];
    const closed = pts.length > 2
      && Math.abs(last[0] - pts[0][0]) < 1e-6
      && Math.abs(last[1] - pts[0][1]) < 1e-6;
    if (closed) {
      const prev = pts[pts.length - 2];
      pushAxis(pts[0][0] - prev[0], pts[0][1] - prev[1]);
    }
  }
  if (axes.length === 0) return 0.18;
  axes.sort((a, b) => a - b);
  let bestMid = axes[0] + Math.PI * 0.5, bestGap = -1;
  for (let i = 0; i < axes.length; i++) {
    const a0 = axes[i];
    const a1 = i + 1 < axes.length ? axes[i + 1] : axes[0] + Math.PI;
    const gap = a1 - a0;
    if (gap > bestGap) {
      bestGap = gap;
      bestMid = a0 + gap * 0.5;
    }
  }
  return bestMid;
}

/**
 * First dry point beside PATHS.routes[0].points[0], off the ribbon by
 * ≥ PATH_HALF + 1.2. Yaw faces the junction (local +Z).
 */
export function computeJizoSite({ heightAt, isOnPath, isInPond } = {}) {
  if (typeof heightAt !== 'function') return null;
  const route = PATHS.routes[0];
  if (!route || !route.points.length) return null;
  const [jx, jz] = route.points[0];
  const extra = POI.jizoPathExtra;
  const minD = PATH_HALF + extra;
  const maxD = minD + POI.jizoSearch;
  const step = POI.jizoStep;
  const prefer = junctionGapHeading();
  const turns = 16;
  for (let d = minD; d <= maxD + 1e-6; d += step) {
    for (let k = 0; k < turns; k++) {
      const half = (k + 1) >> 1;
      const sign = (k & 1) ? -1 : 1;
      const a = prefer + sign * half * ((Math.PI * 2) / turns);
      const x = jx + Math.cos(a) * d;
      const z = jz + Math.sin(a) * d;
      if (!dryOffPath(heightAt, isOnPath, isInPond, x, z, extra, WORLD.seaLevel + 0.4)) {
        continue;
      }
      return { x, z, h: heightAt(x, z), yaw: Math.atan2(jx - x, jz - z) };
    }
  }
  return null;
}

/**
 * First dry bank of PONDS[0], off the wet margin and off the ribbon.
 * Yaw faces the pond (local +Z).
 */
export function computeTsukubaiSite({ heightAt, isOnPath, isInPond } = {}) {
  if (typeof heightAt !== 'function') return null;
  const [px, pz] = POI.pondBig;
  const [jx, jz] = PATHS.routes[0].points[0];
  const prefer = Math.atan2(jz - pz, jx - px);
  const extra = POI.tsukubaiPathExtra;
  const rMin = POI.pondBigR * 0.70;
  const rMax = POI.pondBigR + POI.tsukubaiSearch;
  const step = POI.tsukubaiStep;
  const turns = 20;
  for (let d = rMin; d <= rMax + 1e-6; d += step) {
    for (let k = 0; k < turns; k++) {
      const half = (k + 1) >> 1;
      const sign = (k & 1) ? -1 : 1;
      const a = prefer + sign * half * ((Math.PI * 2) / turns);
      const x = px + Math.cos(a) * d;
      const z = pz + Math.sin(a) * d;
      if (!dryOffPath(heightAt, isOnPath, isInPond, x, z, extra, WORLD.seaLevel + 0.2)) {
        continue;
      }
      return { x, z, h: heightAt(x, z), yaw: Math.atan2(px - x, pz - z) };
    }
  }
  return null;
}

/** Shimenawa sits on the largest reef block — no new rock. */
export function computeIwakuraSite() {
  const reef = springReefSite();
  return {
    x: reef.x,
    z: reef.z,
    s: reef.s,
    ky: reef.ky,
    yaw: reef.yaw,
    sink: reef.sink,
  };
}

/**
 * Standing roadside jizō: pedestal, robe, bald head, faded bib.
 * Without the bib it reads as a cairn.
 */
export function makeJizoGeometry() {
  const parts = [];
  const add = (geo, hex, moss) => {
    paintStone(geo, hex, moss);
    parts.push(geo);
  };

  const pedestal = new THREE.CylinderGeometry(0.28, 0.32, 0.15, 10);
  pedestal.translate(0, 0.05, 0);
  add(pedestal, STONE_DARK, 0.62);

  const body = new THREE.CylinderGeometry(0.155, 0.205, 0.46, 10);
  body.translate(0, 0.35, 0);
  add(body, STONE, 0.42);

  const robe = new THREE.SphereGeometry(0.20, 8, 6);
  robe.scale(1.05, 0.72, 0.95);
  robe.translate(0, 0.36, 0.02);
  add(robe, STONE, 0.38);

  const head = new THREE.SphereGeometry(0.135, 10, 8);
  head.translate(0, 0.74, 0.015);
  add(head, STONE, 0.12);

  const bun = new THREE.SphereGeometry(0.042, 6, 5);
  bun.translate(0, 0.87, 0);
  add(bun, STONE, 0.08);

  const hands = new THREE.BoxGeometry(0.13, 0.065, 0.075);
  hands.translate(0, 0.42, 0.155);
  add(hands, STONE, 0.18);

  // Faded cloth, not vermilion — weathered, still names the figure.
  const bib = new THREE.BoxGeometry(0.11, 0.14, 0.02);
  bib.translate(0, 0.50, 0.175);
  paint(bib, 0x7a3c34, 0.04);
  parts.push(bib);

  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.016, 6, 4);
    eye.translate(s * 0.042, 0.755, 0.118);
    paint(eye, 0x3a3834, 0);
    parts.push(eye);
  }

  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/** Stone basin + bamboo ladle. The stagnant disc is a separate mesh. */
export function makeTsukubaiGeometry() {
  const parts = [];
  const add = (geo, hex, moss) => {
    paintStone(geo, hex, moss);
    parts.push(geo);
  };

  const foot = new THREE.CylinderGeometry(0.36, 0.40, 0.14, 10);
  foot.translate(0, 0.03, 0);
  add(foot, STONE_DARK, 0.62);

  const bowl = new THREE.CylinderGeometry(0.34, 0.38, 0.26, 12);
  bowl.translate(0, 0.22, 0);
  add(bowl, STONE, 0.44);

  const rim = new THREE.TorusGeometry(0.325, 0.042, 8, 16);
  rim.rotateX(Math.PI * 0.5);
  rim.translate(0, 0.35, 0);
  add(rim, STONE, 0.22);

  const well = new THREE.CylinderGeometry(0.245, 0.225, 0.09, 12);
  well.translate(0, 0.28, 0);
  add(well, 0x4a4842, 0.12);

  const BAMBOO = 0xc4b07a;
  const handle = new THREE.CylinderGeometry(0.012, 0.016, 0.52, 6);
  handle.rotateZ(Math.PI * 0.5);
  handle.rotateY(0.32);
  handle.translate(0.04, 0.405, 0.02);
  paint(handle, BAMBOO, 0.08);
  parts.push(handle);

  const cup = new THREE.CylinderGeometry(0.034, 0.026, 0.052, 8);
  cup.rotateZ(0.95);
  cup.translate(-0.21, 0.385, -0.07);
  paint(cup, BAMBOO, 0.06);
  parts.push(cup);

  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

function makeTsukubaiWaterGeometry() {
  // CircleGeometry faces +Z; rotate so FrontSide looks at the sky.
  const g = new THREE.CircleGeometry(0.22, 16);
  g.rotateX(-Math.PI * 0.5);
  g.translate(0, 0.305, 0);
  return g;
}

/** Shimenawa + shide sized to SPRING_ROCKS[0]. No boulder. */
export function makeIwakuraGeometry(site = {}) {
  const s = site.s ?? 4.6;
  const ky = site.ky ?? 1.15;
  const sink = site.sink ?? 0.34;
  const y = s * ky * (1 - sink) * 0.38;
  const r = s * 0.46;
  const straw = 0xd9cba6;
  const paper = 0xeee9dc;
  const parts = [];

  const rope = new THREE.TorusGeometry(r, 0.068, 6, 28);
  rope.rotateX(Math.PI * 0.5);
  rope.translate(0, y, 0);
  paint(rope, straw, 0.10);
  parts.push(rope);

  const nShide = 5;
  for (let i = 0; i < nShide; i++) {
    const a = (i / nShide) * Math.PI * 2 + 0.18;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    for (let segment = 0; segment < 4; segment++) {
      const outward = segment % 2 === 0 ? 0 : 0.04;
      const strip = new THREE.BoxGeometry(0.09, 0.125, 0.016);
      strip.translate(
        bx + Math.cos(a) * outward,
        y - 0.07 - segment * 0.125,
        bz + Math.sin(a) * outward,
      );
      paint(strip, paper, 0);
      parts.push(strip);
    }
  }

  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

function countForSpan(span) {
  const lo = STONES.radius[0] * 2 + 0.35;
  const hi = STONES.radius[1] * 2 + STONES.maxGap;
  let bestN = STONES.count, bestErr = Infinity;
  for (let n = STONES.countMin; n <= STONES.countMax; n++) {
    const c2c = span / Math.max(n - 1, 1);
    if (c2c < lo * 0.92 || c2c > hi) continue;
    const err = Math.abs(n - STONES.count);
    if (err < bestErr) { bestErr = err; bestN = n; }
  }
  return bestN;
}

/**
 * 5–7 tobi-ishi across a sliver of PONDS[0], bank to bank, outside the
 * koi disc. Pure: no mesh, no module state. Y = pondWaterYAt + lift.
 */
export function computeSteppingStones({
  pond, pondWaterYAt, heightAt, seed = SEED,
} = {}) {
  const out = [];
  if (!pond || typeof pondWaterYAt !== 'function') return out;
  void heightAt;

  const rng = streamFor(seed, 'poi.stones');
  const koiR = STONES.koiClear * pond.radius;
  const STEP = 0.28;
  const scan = pond.radius * 1.25;
  let best = null;
  let bestScore = -Infinity;

  for (let hi = 0; hi < 28; hi++) {
    const ang = STONES.heading + (hi * 0.5) * ((hi & 1) ? 1 : -1) * (Math.PI / 14);
    const tx = Math.cos(ang), tz = Math.sin(ang);
    const nx = -tz, nz = tx;
    for (let ok = 0; ok < 8; ok++) {
      const offK = 0.52 + ok * 0.055;
      const offset = offK * pond.radius;
      if (offset < koiR + 0.2) continue;
      const ox = pond.x + nx * offset;
      const oz = pond.z + nz * offset;
      const samples = [];
      for (let t = -scan; t <= scan + 1e-6; t += STEP) {
        const x = ox + tx * t, z = oz + tz * t;
        const rp = Math.hypot(x - pond.x, z - pond.z);
        const wy = pondWaterYAt(x, z);
        samples.push({
          x, z, t, wy,
          ok: wy != null && rp >= koiR && rp <= pond.radius * 1.08,
        });
      }
      let run0 = -1;
      const flushRun = (a, b) => {
        if (a < 0 || b - a < 2) return;
        const t0 = samples[a].t, t1 = samples[b].t;
        const span = t1 - t0;
        const n = countForSpan(span);
        const c2c = span / Math.max(n - 1, 1);
        const maxC2c = STONES.radius[1] * 2 + STONES.maxGap;
        const minC2c = STONES.radius[0] * 2 * 0.85;
        if (c2c > maxC2c || c2c < minC2c) return;
        const before = samples[Math.max(0, a - 1)];
        const after = samples[Math.min(samples.length - 1, b + 1)];
        const banks = (before && !before.ok ? 1 : 0) + (after && !after.ok ? 1 : 0);
        const score = banks * 8 - Math.abs(n - STONES.count) * 0.6 - Math.abs(span - 8) * 0.15;
        if (score > bestScore) {
          bestScore = score;
          best = { samples, a, b, n, tx, tz, nx, nz, ang };
        }
      };
      for (let i = 0; i < samples.length; i++) {
        if (samples[i].ok) {
          if (run0 < 0) run0 = i;
        } else {
          flushRun(run0, i - 1);
          run0 = -1;
        }
      }
      flushRun(run0, samples.length - 1);
    }
  }

  if (!best) {
    // Last resort: short chord just inside the waterline, outside the koi disc.
    const n = STONES.count;
    const gap = 0.55;
    const radii = [];
    let span = 0;
    for (let i = 0; i < n; i++) {
      radii.push(0.5 * (STONES.radius[0] + STONES.radius[1]));
      if (i) span += radii[i - 1] + radii[i] + gap;
    }
    const half = span * 0.5;
    if (half < pond.radius * 0.98) {
      const offset = Math.sqrt(Math.max(0, pond.radius * pond.radius - half * half)) * 0.97;
      if (offset >= koiR + 0.15) {
        const ang = STONES.heading;
        const hx = Math.cos(ang), hz = Math.sin(ang);
        const nx = -hz, nz = hx;
        const cx = pond.x + nx * offset, cz = pond.z + nz * offset;
        for (let i = 0; i < n; i++) {
          const t = (i / (n - 1) - 0.5) * span;
          let x = cx + hx * t, z = cz + hz * t;
          let wy = pondWaterYAt(x, z);
          for (let s = 0; s < 12 && wy == null; s++) {
            x += (pond.x - x) * 0.08;
            z += (pond.z - z) * 0.08;
            wy = pondWaterYAt(x, z);
          }
          const rp = Math.hypot(x - pond.x, z - pond.z);
          if (wy == null || rp < koiR) continue;
          out.push({
            x, z, y: wy + STONES.lift, r: radii[i],
            yaw: ang + R.range(rng, -0.3, 0.3),
          });
        }
      }
    }
    return out;
  }

  const { samples, a, b, n, nx, nz, ang } = best;
  const t0 = samples[a].t, t1 = samples[b].t;
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    const t = t0 + (t1 - t0) * u;
    const zig = (i % 2 === 0 ? 1 : -1) * STONES.zigzag * (i === 0 || i === n - 1 ? 0.25 : 1);
    const mid = samples[(a + b) >> 1];
    const hx = Math.cos(ang), hz = Math.sin(ang);
    let x = mid.x + hx * (t - mid.t) + nx * zig;
    let z = mid.z + hz * (t - mid.t) + nz * zig;
    let wy = pondWaterYAt(x, z);
    for (let s = 0; s < 10 && wy == null; s++) {
      x += (pond.x - x) * 0.08;
      z += (pond.z - z) * 0.08;
      wy = pondWaterYAt(x, z);
    }
    const rp = Math.hypot(x - pond.x, z - pond.z);
    if (wy == null || rp < koiR) continue;
    out.push({
      x, z,
      y: wy + STONES.lift,
      r: R.range(rng, STONES.radius[0], STONES.radius[1]),
      yaw: ang + R.range(rng, -0.45, 0.45),
    });
  }

  // Drop a stone that would open a gap the dog cannot step.
  if (out.length >= STONES.countMin) {
    const kept = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const prev = kept[kept.length - 1];
      const d = Math.hypot(out[i].x - prev.x, out[i].z - prev.z);
      const gap = d - out[i].r - prev.r;
      if (gap > STONES.maxGap && kept.length + (out.length - i) > STONES.countMin) {
        // skip this one only if we can still reach the minimum
        continue;
      }
      kept.push(out[i]);
    }
    if (kept.length >= STONES.countMin && kept.length <= STONES.countMax) {
      out.length = 0;
      for (let i = 0; i < kept.length; i++) out.push(kept[i]);
    }
  }

  return out;
}

/** Flat pebble, top at local y = 0 so the instance Y is the walkable top. */
export function makeSteppingStoneGeometry(seed = SEED) {
  const rng = streamFor(seed, 'poi.step-stone');
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position;
  const ox = rng() * 20, oz = rng() * 20;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = fbm2(x * 2.4 + ox, z * 2.4 + oz, 3);
    const r = 1 + 0.14 * n;
    let vx = x * r, vy = y * r * 0.22, vz = z * r * 0.86;
    if (vy > 0.02) vy = 0.02 + (vy - 0.02) * 0.05;
    if (vy < -STONES.thickness) vy = -STONES.thickness;
    pos.setXYZ(i, vx, vy, vz);
  }
  let yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) yMax = Math.max(yMax, pos.getY(i));
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i), pos.getY(i) - yMax, pos.getZ(i));
  }
  pos.needsUpdate = true;

  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const moss = new THREE.Color(STONE_MOSS);
  const base = new THREE.Color(STONE);
  for (let i = 0; i < pos.count; i++) {
    const grain = 0.86 + 0.20 * fbm2(pos.getX(i) * 5.1, pos.getZ(i) * 5.1 + 2.2, 3);
    c.copy(base).multiplyScalar(grain);
    c.lerp(moss, Math.max(0, -pos.getY(i) / STONES.thickness) * 0.25);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function createPOI({
  seed = SEED, heightAt, isOnPath, isInPond, slopeAt, season = 'spring',
  pondWaterYAt, ponds,
} = {}) {
  void season;

  const group = new THREE.Group();
  group.name = 'poi';

  const pine = typeof heightAt === 'function'
    ? computeShorePineSite({ heightAt, isOnPath, isInPond })
    : null;
  const rock = pine ? placeRock(pine, heightAt, isOnPath, isInPond) : null;
  const jizo = typeof heightAt === 'function'
    ? computeJizoSite({ heightAt, isOnPath, isInPond })
    : null;
  const tsukubai = typeof heightAt === 'function'
    ? computeTsukubaiSite({ heightAt, isOnPath, isInPond })
    : null;
  const iwakura = computeIwakuraSite();
  const seaTorii = typeof heightAt === 'function'
    ? computeSeaToriiSite({ heightAt })
    : null;
  const chashitsu = typeof heightAt === 'function'
    ? computeChashitsuSite({ heightAt, isOnPath, isInPond, slopeAt })
    : null;

  const pondList = Array.isArray(ponds) ? ponds : (ponds?.PONDS ?? []);
  const big = pondList[0] || null;
  const stones = big && typeof pondWaterYAt === 'function'
    ? computeSteppingStones({ pond: big, pondWaterYAt, heightAt, seed })
    : [];
  _slabs = stones;

  const solids = [];
  if (pine) solids.push({ x: pine.x, z: pine.z, r: POI.pineTrunkR });
  const sitTop = rock
    ? rock.h - POI.rockSink + 0.22
    : 0;
  const sitR = POI.rockPlateau * 0.5;
  if (jizo) solids.push({ x: jizo.x, z: jizo.z, r: POI.jizoR });
  if (tsukubai) solids.push({ x: tsukubai.x, z: tsukubai.z, r: POI.tsukubaiR });
  const tea = chashitsu ? createChashitsu({ seed, site: chashitsu }) : null;
  if (tea) {
    for (let i = 0; i < tea.posts.length; i++) {
      const p = tea.posts[i];
      solids.push({ x: p.x, z: p.z, r: POI.chashitsuPostR });
    }
    group.add(tea.group);
  }

  if (pine) {
    const geo = makeKuromatsuGeometry();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.90, metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'kuromatsu';
    mesh.position.set(pine.x, pine.h, pine.z);
    mesh.rotation.y = pine.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (rock) {
    const geo = makeSittingRockGeometry(seed);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sitting-rock';
    mesh.position.set(rock.x, rock.h - POI.rockSink, rock.z);
    mesh.rotation.y = rock.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (jizo) {
    const geo = makeJizoGeometry();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.94, metalness: 0, flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'jizo';
    mesh.position.set(jizo.x, jizo.h - 0.03, jizo.z);
    mesh.rotation.y = jizo.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (tsukubai) {
    const geo = makeTsukubaiGeometry();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.94, metalness: 0, flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'tsukubai';
    mesh.position.set(tsukubai.x, tsukubai.h - 0.04, tsukubai.z);
    mesh.rotation.y = tsukubai.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Stagnant bowl water — a disc, not a 4th PONDS.
    const waterGeo = makeTsukubaiWaterGeometry();
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x2c3a32, roughness: 0.22, metalness: 0.08,
      transparent: true, opacity: 0.82, depthWrite: false,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.name = 'tsukubai-water';
    water.position.copy(mesh.position);
    water.rotation.y = tsukubai.yaw;
    water.receiveShadow = true;
    group.add(water);
  }

  if (iwakura && typeof heightAt === 'function') {
    const geo = makeIwakuraGeometry(iwakura);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.88, metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'iwakura';
    mesh.position.set(iwakura.x, heightAt(iwakura.x, iwakura.z), iwakura.z);
    mesh.rotation.y = iwakura.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (seaTorii) {
    const geo = makeToriiGeometry();
    const bump = makeWoodBump(seed);
    bump.repeat.set(1.5, 1);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.72, metalness: 0,
      bumpMap: bump, bumpScale: 0.22,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sea-torii';
    mesh.position.set(seaTorii.x, seaTorii.baseY, seaTorii.z);
    mesh.rotation.y = seaTorii.yaw;
    mesh.scale.setScalar(seaTorii.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (stones.length) {
    const geo = makeSteppingStoneGeometry(seed);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0, flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, stones.length);
    mesh.name = 'stepping-stones';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler();
    const _p = new THREE.Vector3();
    const _s = new THREE.Vector3();
    for (let i = 0; i < stones.length; i++) {
      const s = stones[i];
      _e.set(0, s.yaw, 0);
      _q.setFromEuler(_e);
      _p.set(s.x, s.y, s.z);
      _s.set(s.r, 1, s.r);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  function hitsSolid(x, z, pad = 0) {
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      const dx = x - s.x, dz = z - s.z;
      const rad = s.r + pad;
      if (dx * dx + dz * dz < rad * rad) return true;
    }
    return false;
  }

  function dispose() {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m.bumpMap?.dispose();
          m.dispose();
        }
      }
    });
    group.removeFromParent();
  }

  function sitYAt(x, z) {
    if (!rock) return 0;
    const dx = x - rock.x, dz = z - rock.z;
    if (dx * dx + dz * dz <= sitR * sitR) return sitTop;
    return 0;
  }

  function surfaceYAt(x, z) {
    const slab = stoneYAt(x, z, stones);
    if (slab !== 0) return slab;
    return sitYAt(x, z);
  }

  function onStone(x, z) {
    return surfaceYAt(x, z) !== 0;
  }

  function keepOut(x, z) {
    return chashitsuKeepOut(chashitsu, x, z);
  }

  return {
    group,
    stoneYAt: (x, z) => surfaceYAt(x, z),
    onStone,
    hitsSolid,
    keepOut,
    hitsFootprint: keepOut,
    sites: { pine, rock, jizo, tsukubai, iwakura, stones, seaTorii, chashitsu },
    dispose,
  };
}
