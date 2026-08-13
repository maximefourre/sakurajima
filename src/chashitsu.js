/**
 * chashitsu.js — abandoned one-room tea house at the etangs meadow edge.
 *
 * Placement is a pure walk off the `etangs` loop (no WebGL) so the banc can
 * fail the site without building a mesh. Geometry echoes the hokora recipe
 * (merged primitives, vertex colours, FrontSide) without lifting the shrine.
 * No inhabitant, no smoke, no lantern — the loop already lights the night.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PATHS, POI, SEED } from './config.js';
import { streamFor, fbm2, R } from './noise.js';
import { makeWoodBump } from './detailtex.js';

const WOOD = 0x5a4634;
const WOOD_DARK = 0x3a2c20;
const WOOD_PALE = 0x6e5d48;
const THATCH = 0x7a6a40;
const THATCH_DARK = 0x53482c;
const STONE = 0x716d69;
const MOSS = 0x5d6b33;

// Local half-extent of the frame. Collision posts must match these.
const HALF_X = 1.62;
const HALF_Z = 1.70;
const POST_R = 0.085;
const DECK_Y = 0.14;
const LINTEL_Y = 2.14;
const RIDGE_Y = 3.28;
const ROOF_TILT = 0.48;
const ROOF_OVER = 0.46;

/** Corner + side-mid posts. Front stays open (no mid on +Z). */
export const CHASHITSU_POSTS = Object.freeze([
  [-HALF_X, HALF_Z],
  [HALF_X, HALF_Z],
  [-HALF_X, -HALF_Z],
  [HALF_X, -HALF_Z],
  [-HALF_X, 0],
  [HALF_X, 0],
]);

function etangsRoute() {
  return PATHS.routes.find((r) => r.name === 'etangs') || null;
}

function pondView() {
  const ps = POI.ponds;
  let x = 0, z = 0;
  for (let i = 0; i < ps.length; i++) {
    x += ps[i].x;
    z += ps[i].z;
  }
  const n = Math.max(ps.length, 1);
  return { x: x / n, z: z / n };
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function worldOf(x, z, yaw, lx, lz) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {
    x: x + lx * c + lz * s,
    z: z - lx * s + lz * c,
  };
}

function validFootprint(heightAt, isOnPath, isInPond, slopeAt, x, z, yaw) {
  const extra = POI.chashitsuPathExtra;
  const half = POI.chashitsuFoot;
  const samples = [
    [0, 0],
    [-half, -half], [half, -half], [-half, half], [half, half],
    [-half, 0], [half, 0], [0, -half], [0, half],
  ];
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const p = worldOf(x, z, yaw, samples[i][0], samples[i][1]);
    if (typeof isOnPath === 'function' && isOnPath(p.x, p.z, extra)) return false;
    if (typeof isInPond === 'function' && isInPond(p.x, p.z)) return false;
    const h = heightAt(p.x, p.z);
    if (!(h >= POI.chashitsuHMin && h <= POI.chashitsuHMax)) return false;
    if (typeof slopeAt === 'function' && slopeAt(p.x, p.z) >= POI.chashitsuSlopeMax) {
      return false;
    }
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  if (hMax - hMin > POI.chashitsuMaxTilt) return false;
  const ponds = POI.ponds;
  for (let i = 0; i < ponds.length; i++) {
    const p = ponds[i];
    if (Math.hypot(x - p.x, z - p.z) < p.r + POI.chashitsuBankClear) return false;
  }
  return true;
}

function scoreSite(heightAt, slopeAt, x, z, yaw) {
  const h = heightAt(x, z);
  const sl = typeof slopeAt === 'function' ? slopeAt(x, z) : 0;
  const ponds = POI.ponds;
  let viewS = 0;
  for (let i = 0; i < ponds.length; i++) {
    const p = ponds[i];
    const a = wrapAngle(Math.atan2(p.x - x, p.z - z) - yaw);
    if (Math.abs(a) < 1.05) viewS += 1 - Math.abs(a) / 1.05;
  }
  const [jx, jz] = PATHS.routes[0].points[0];
  const junc = Math.hypot(x - jx, z - jz);
  return viewS * 3.2
    - sl * 18
    - Math.abs(h - POI.chashitsuHTarget) * 0.28
    - (junc < POI.chashitsuJuncClear ? 8 : 0);
}

/**
 * First gentle prairie pad off the `etangs` loop, facing the three ponds.
 * `yaw` sends local +Z at the pond centroid (open gable = framed view).
 */
export function computeChashitsuSite({ heightAt, isOnPath, isInPond, slopeAt } = {}) {
  if (typeof heightAt !== 'function') return null;
  const route = etangsRoute();
  if (!route || route.points.length < 2) return null;
  const view = pondView();
  const pts = route.points;

  let best = null;
  let bestScore = -Infinity;

  const consider = (x, z, pathDist) => {
    const yaw = Math.atan2(view.x - x, view.z - z);
    if (!validFootprint(heightAt, isOnPath, isInPond, slopeAt, x, z, yaw)) return;
    const score = scoreSite(heightAt, slopeAt, x, z, yaw)
      - (pathDist - POI.chashitsuOffsetMin) * 0.07;
    if (score > bestScore) {
      bestScore = score;
      best = { x, z, h: heightAt(x, z), yaw };
    }
  };

  const STEP = 2.0;
  const angs = [0, 0.38, -0.38, 0.72, -0.72];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const seg = Math.hypot(bx - ax, bz - az);
    if (!(seg > 1e-6)) continue;
    const n = Math.max(1, Math.ceil(seg / STEP));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      let ox = px - view.x, oz = pz - view.z;
      const ol = Math.hypot(ox, oz);
      if (!(ol > 1e-6)) continue;
      ox /= ol;
      oz /= ol;
      for (let ai = 0; ai < angs.length; ai++) {
        const ca = Math.cos(angs[ai]), sa = Math.sin(angs[ai]);
        const dx = ox * ca - oz * sa;
        const dz = ox * sa + oz * ca;
        for (let d = POI.chashitsuOffsetMin; d <= POI.chashitsuOffsetMax + 1e-6; d += POI.chashitsuStep) {
          consider(px + dx * d, pz + dz * d, d);
        }
      }
    }
  }

  if (!best) {
    for (let r = 22; r <= 58; r += 2.4) {
      const turns = Math.max(14, Math.round(r * 0.5));
      for (let k = 0; k < turns; k++) {
        const a = (k / turns) * Math.PI * 2;
        consider(view.x + Math.cos(a) * r, view.z + Math.sin(a) * r, r);
      }
    }
  }
  return best;
}

export function chashitsuPosts(site) {
  const out = [];
  for (let i = 0; i < CHASHITSU_POSTS.length; i++) {
    const [lx, lz] = CHASHITSU_POSTS[i];
    const p = worldOf(site.x, site.z, site.yaw, lx, lz);
    out.push(p);
  }
  return out;
}

export function chashitsuKeepOut(site, x, z, r = POI.chashitsuKeepOut) {
  if (!site) return false;
  const dx = x - site.x, dz = z - site.z;
  return dx * dx + dz * dz < r * r;
}

function paintWood(geo, hex, mossAmt = 0.28) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const n = pos.count;
  const c = new Float32Array(n * 3);
  const base = new THREE.Color(hex);
  const moss = new THREE.Color(MOSS);
  const grey = new THREE.Color(0x6c6558);
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const grain = 0.80 + 0.26 * (
      0.55 * fbm2(x * 2.6 + 1.2, y * 0.42 + 4.1, 3)
      + 0.45 * fbm2(x * 0.35 + 8.2, y * 3.6 - 2.4, 2)
    );
    tmp.copy(base).multiplyScalar(grain);
    const up = Math.max(0, nrm.getY(i));
    const weather = Math.max(0, fbm2(x * 1.7 + 3.3, z * 1.7 - 5.1, 3));
    tmp.lerp(grey, weather * 0.24 * (0.35 + 0.65 * up));
    const low = Math.max(0, 1 - y * 0.38);
    const blotch = Math.max(0, fbm2(x * 2.2 + 9.2, z * 2.2 + 2.7, 3));
    const w = mossAmt * Math.min(0.78, low * (0.28 + 0.72 * blotch) + up * 0.16);
    tmp.lerp(moss, w);
    c[i * 3] = tmp.r;
    c[i * 3 + 1] = tmp.g;
    c[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return geo;
}

function paintThatch(geo, hex, mossAmt = 0.55) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const n = pos.count;
  const c = new Float32Array(n * 3);
  const base = new THREE.Color(hex);
  const moss = new THREE.Color(MOSS);
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const grain = 0.78 + 0.30 * fbm2(x * 3.4 + 2.1, z * 1.6 - 4.4, 3);
    tmp.copy(base).multiplyScalar(grain);
    const up = Math.max(0, nrm.getY(i));
    const blotch = Math.max(0, fbm2(x * 1.9 + 6.2, z * 1.9 + 1.4, 3));
    tmp.lerp(moss, mossAmt * up * (0.25 + 0.75 * blotch));
    c[i * 3] = tmp.r;
    c[i * 3 + 1] = tmp.g;
    c[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function mergeParts(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  for (const g of flat) g.dispose();
  for (const g of parts) g.dispose();
  return merged;
}

function addWood(parts, geo, hex, x, y, z, rz = 0, rx = 0, moss = 0.26) {
  if (rz) geo.rotateZ(rz);
  if (rx) geo.rotateX(rx);
  geo.translate(x, y, z);
  paintWood(geo, hex, moss);
  if (!geo.attributes.uv) {
    const n = geo.attributes.position.count;
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  parts.push(geo);
}

/**
 * Frame + deck + open partitions. Local +Z is the pond-facing gable.
 */
export function makeChashitsuFrameGeometry(seed = SEED) {
  const parts = [];
  void seed;

  addWood(parts, new THREE.BoxGeometry(HALF_X * 2 + 0.38, 0.09, HALF_Z * 2 + 0.38),
    WOOD_DARK, 0, DECK_Y - 0.02, 0, 0, 0, 0.42);
  // One board missing on purpose — abandoned, not a finished interior.
  for (let i = 0; i < 7; i++) {
    if (i === 4) continue;
    const z = -HALF_Z + 0.28 + i * 0.46;
    addWood(parts, new THREE.BoxGeometry(HALF_X * 2 - 0.16, 0.035, 0.38),
      i % 2 ? WOOD : WOOD_PALE, 0, DECK_Y + 0.04, z, 0, 0, 0.18);
  }

  const postH = LINTEL_Y + 0.22;
  for (let i = 0; i < CHASHITSU_POSTS.length; i++) {
    const [lx, lz] = CHASHITSU_POSTS[i];
    const cyl = new THREE.CylinderGeometry(POST_R * 0.82, POST_R, postH, 7);
    addWood(parts, cyl, WOOD_DARK, lx, postH * 0.5 - 0.16, lz, 0, 0, 0.38);
  }

  const beam = (len, x, y, z, alongZ) => {
    const box = alongZ
      ? new THREE.BoxGeometry(0.12, 0.13, len)
      : new THREE.BoxGeometry(len, 0.13, 0.12);
    addWood(parts, box, WOOD, x, y, z, 0, 0, 0.16);
  };
  beam(HALF_X * 2 + 0.18, 0, LINTEL_Y, HALF_Z, false);
  beam(HALF_X * 2 + 0.18, 0, LINTEL_Y, -HALF_Z, false);
  beam(HALF_Z * 2 + 0.18, -HALF_X, LINTEL_Y, 0, true);
  beam(HALF_Z * 2 + 0.18, HALF_X, LINTEL_Y, 0, true);
  beam(HALF_X * 2 - 0.2, 0, LINTEL_Y + 0.22, 0, false);

  // Back slats with gaps — a wall that is no longer a wall.
  for (const x of [-0.72, 0.08, 0.78]) {
    addWood(parts, new THREE.BoxGeometry(0.055, 1.42, 0.04),
      WOOD_PALE, x, DECK_Y + 0.78, -HALF_Z - 0.02, 0, 0, 0.22);
  }
  // One leftover slat on the +X side; the −X side stays a nijiri frame.
  addWood(parts, new THREE.BoxGeometry(0.04, 1.18, 0.055),
    WOOD, HALF_X + 0.02, DECK_Y + 0.72, 0.55, 0, 0, 0.20);

  addWood(parts, new THREE.BoxGeometry(0.07, 0.78, 0.07),
    WOOD_DARK, -HALF_X - 0.01, DECK_Y + 0.48, -0.42, 0, 0, 0.24);
  addWood(parts, new THREE.BoxGeometry(0.07, 0.78, 0.07),
    WOOD_DARK, -HALF_X - 0.01, DECK_Y + 0.48, 0.22, 0, 0, 0.24);
  addWood(parts, new THREE.BoxGeometry(0.07, 0.07, 0.72),
    WOOD_DARK, -HALF_X - 0.01, DECK_Y + 0.88, -0.10, 0, 0, 0.16);

  const fallen = new THREE.BoxGeometry(0.05, 0.04, 1.15);
  fallen.rotateY(0.55);
  fallen.rotateZ(0.08);
  addWood(parts, fallen, WOOD_PALE, 0.35, DECK_Y + 0.08, 0.45, 0, 0, 0.12);

  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

export function makeChashitsuRoofGeometry(seed = SEED) {
  const parts = [];
  const rng = streamFor(seed, 'poi.chashitsu.roof');
  const tilt = ROOF_TILT;
  const planeW = (HALF_X + ROOF_OVER) / Math.cos(tilt);
  const depth = HALF_Z * 2 + ROOF_OVER * 2;
  const sag = 0.045;

  const placePlane = (sign, extraTilt) => {
    const a = sign * (tilt + extraTilt);
    const geo = new THREE.BoxGeometry(planeW, 0.15, depth);
    geo.rotateZ(a);
    const hx = sign * Math.cos(tilt) * planeW * 0.5;
    const hy = RIDGE_Y - Math.sin(tilt) * planeW * 0.5;
    geo.translate(-hx, hy, 0);
    paintThatch(geo, THATCH, 0.58);
    parts.push(geo);
    const cap = new THREE.BoxGeometry(planeW * 0.92, 0.07, depth * 0.96);
    cap.rotateZ(a);
    cap.translate(-hx, hy + 0.08, 0);
    paintThatch(cap, THATCH_DARK, 0.70);
    parts.push(cap);
  };
  placePlane(-1, 0);
  placePlane(1, sag);

  const ridge = new THREE.CylinderGeometry(0.09, 0.10, depth + 0.12, 8);
  ridge.rotateX(Math.PI * 0.5);
  ridge.translate(0.04, RIDGE_Y + 0.02, 0);
  paintThatch(ridge, THATCH_DARK, 0.35);
  parts.push(ridge);

  const eaveY = RIDGE_Y - Math.sin(tilt) * planeW;
  const eaveX = Math.cos(tilt) * planeW;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const z = (i / 7 - 0.5) * (depth - 0.3);
      const tuft = new THREE.BoxGeometry(
        0.36 + R.range(rng, 0, 0.10),
        0.09 + R.range(rng, 0, 0.04),
        0.26,
      );
      tuft.rotateZ(side * tilt);
      tuft.translate(
        side * (eaveX - 0.12) + R.range(rng, -0.05, 0.05),
        eaveY + 0.04,
        z,
      );
      paintThatch(tuft, rng() > 0.45 ? THATCH : THATCH_DARK, 0.62);
      parts.push(tuft);
    }
  }

  // Back gable only — the front stays open so the ponds read from inside.
  {
    const ex = Math.cos(tilt) * planeW * 0.92;
    const ey = RIDGE_Y - 0.04;
    const by = eaveY + 0.12;
    const z = -HALF_Z - 0.02;
    const gable = new THREE.BufferGeometry();
    gable.setAttribute('position', new THREE.Float32BufferAttribute([
      -ex, by, z,
      ex, by, z,
      0.04, ey, z,
    ], 3));
    gable.setIndex([0, 2, 1]);
    gable.computeVertexNormals();
    paintThatch(gable, WOOD_DARK, 0.20);
    parts.push(gable);
  }

  for (const [x, z, s] of [
    [-0.8, -0.4, 0.22],
    [0.55, 0.7, 0.18],
    [0.1, -1.1, 0.16],
    [-0.2, 1.15, 0.14],
  ]) {
    const clump = new THREE.IcosahedronGeometry(s, 1);
    clump.scale(1.15, 0.42, 1.0);
    const hy = RIDGE_Y - Math.abs(x) * Math.tan(tilt) - 0.02;
    clump.translate(x, hy, z);
    paintThatch(clump, MOSS, 0.15);
    parts.push(clump);
  }

  for (const [lx, lz] of [[-HALF_X, HALF_Z], [HALF_X, HALF_Z], [-HALF_X, -HALF_Z], [HALF_X, -HALF_Z]]) {
    const foot = new THREE.CylinderGeometry(0.16, 0.19, 0.18, 7);
    foot.translate(lx, 0.02, lz);
    paintThatch(foot, STONE, 0.55);
    parts.push(foot);
    const moss = new THREE.IcosahedronGeometry(0.14, 1);
    moss.scale(1.2, 0.45, 1.05);
    moss.translate(lx * 0.92, 0.08, lz * 0.92);
    paintThatch(moss, MOSS, 0.10);
    parts.push(moss);
  }

  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

export function createChashitsu({ seed = SEED, site } = {}) {
  const group = new THREE.Group();
  group.name = 'chashitsu';
  if (!site) return { group, posts: [], dispose() {} };

  const frameGeo = makeChashitsuFrameGeometry(seed);
  const roofGeo = makeChashitsuRoofGeometry(seed);
  const bump = makeWoodBump(seed);
  bump.repeat.set(2.2, 1);

  const frameMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.90, metalness: 0,
    bumpMap: bump, bumpScale: 0.16,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0, flatShading: true,
  });

  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.name = 'chashitsu-frame';
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.name = 'chashitsu-roof';
  for (const mesh of [frame, roof]) {
    mesh.position.set(site.x, site.h, site.z);
    mesh.rotation.y = site.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
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

  return { group, posts: chashitsuPosts(site), dispose };
}
