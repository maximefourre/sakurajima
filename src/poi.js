/**
 * poi.js — authored landmarks. Lot 1: kuromatsu + sitting rock past the
 * beach-path terminus. Lot 4: sea torii on the authored extra stack.
 *
 * Placement is a pure walk from PATHS / SEA_TORII (no WebGL) so the
 * invariant can fail the site without constructing a mesh. Geometry is
 * the lantern recipe: merged primitives, vertex colours, one draw per family.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PATHS, WORLD, POI, SEED, CAMERA, SEA_TORII } from './config.js';
import { streamFor, fbm2 } from './noise.js';
import { makeToriiGeometry } from './details.js';
import { makeWoodBump } from './detailtex.js';

const BARK = 0x2a241c;
const BARK_DARK = 0x1a1612;
const NEEDLE = 0x1a2814;
const NEEDLE_LIT = 0x24351a;
const STONE = 0x8a8680;
const STONE_MOSS = 0x5a6240;

/** Lot 2 (stepping stones) fills this in. Movers stay on heightAt + path. */
export function stoneYAt(_x, _z) {
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
 * Sea gate on the authored extra stack, offset toward CAMERA.start so the
 * posts stand in open water. Pure: only SEA_TORII + heightAt.
 */
export function computeSeaToriiSite({ heightAt } = {}) {
  if (typeof heightAt !== 'function') return null;
  const st = SEA_TORII.stack;
  const cam = CAMERA.start;
  let dx = cam.x - st.x, dz = cam.z - st.z;
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-6)) return null;
  dx /= len;
  dz /= len;

  const x = st.x + dx * SEA_TORII.offset;
  const z = st.z + dz * SEA_TORII.offset;
  const yaw = Math.atan2(cam.x - st.x, cam.z - st.z);
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

function mergeParts(parts) {
  // Icosahedra and cylinders disagree on `index`; merge refuses a mix.
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  for (const g of flat) g.dispose();
  for (const g of parts) g.dispose();
  return merged;
}

/**
 * One black pine: stacked cylinders leaning toward local +Z, foliage as
 * squashed icosahedra — plates, not sakura balls.
 */
export function makeKuromatsuGeometry() {
  const parts = [];
  const segs = [
    { h: 1.35, r0: 0.34, r1: 0.28, w: 0.045 },
    { h: 1.45, r0: 0.27, r1: 0.21, w: 0.055 },
    { h: 1.50, r0: 0.20, r1: 0.145, w: 0.060 },
    { h: 1.35, r0: 0.14, r1: 0.085, w: 0.055 },
    { h: 1.15, r0: 0.08, r1: 0.042, w: 0.050 },
  ];
  const wSum = segs.reduce((s, g) => s + g.w, 0);
  for (const s of segs) s.dA = POI.pineLean * (s.w / wSum);

  let y = -0.42, z = 0, angle = 0.05;
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

  // Buried flare so the trunk reads planted, not perched.
  const flare = new THREE.CylinderGeometry(0.30, 0.42, 0.38, 8);
  flare.translate(0, -0.28, 0.02);
  paint(flare, BARK_DARK, 0.06);
  parts.push(flare);

  const branch = (jy, jz, ja, side, len, r) => {
    const arm = new THREE.CylinderGeometry(r * 0.45, r, len, 6);
    const tilt = 1.05;
    arm.rotateZ(side * tilt);
    arm.rotateX(ja * 0.4);
    const ox = Math.sin(side * tilt) * len * 0.5;
    arm.translate(ox, jy + 0.08, jz + Math.sin(ja) * 0.15);
    paint(arm, BARK, 0.08);
    parts.push(arm);
  };
  branch(joints[2].y, joints[2].z, joints[2].angle, -1, 0.95, 0.055);
  branch(joints[3].y, joints[3].z, joints[3].angle, 1, 0.80, 0.045);

  const plates = [
    { j: 2, x: 0.05, up: 0.15, out: 0.35, sx: 1.55, sy: 0.30, sz: 1.25 },
    { j: 3, x: -0.15, up: 0.10, out: 0.45, sx: 1.70, sy: 0.28, sz: 1.40 },
    { j: 3, x: 0.55, up: 0.05, out: 0.15, sx: 1.15, sy: 0.24, sz: 0.95 },
    { j: 4, x: 0.10, up: 0.05, out: 0.35, sx: 1.45, sy: 0.26, sz: 1.20 },
    { j: 4, x: -0.50, up: -0.05, out: 0.20, sx: 1.10, sy: 0.22, sz: 0.90 },
    { j: 5, x: 0.00, up: 0.05, out: 0.20, sx: 1.05, sy: 0.22, sz: 0.88 },
    { j: 2, x: -0.45, up: 0.20, out: 0.10, sx: 1.05, sy: 0.22, sz: 0.85 },
  ];
  for (const p of plates) {
    const j = joints[Math.min(p.j, joints.length - 1)];
    const leaf = new THREE.IcosahedronGeometry(1, 1);
    leaf.scale(p.sx, p.sy, p.sz);
    leaf.rotateZ(p.x * 0.15);
    leaf.rotateX(0.18);
    leaf.translate(p.x, j.y + p.up, j.z + p.out);
    paint(leaf, p.j >= 4 ? NEEDLE_LIT : NEEDLE, 0.14);
    parts.push(leaf);
  }

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

export function createPOI({
  seed = SEED, heightAt, isOnPath, isInPond, slopeAt, season = 'spring',
} = {}) {
  void slopeAt;
  void season;

  const group = new THREE.Group();
  group.name = 'poi';

  const pine = typeof heightAt === 'function'
    ? computeShorePineSite({ heightAt, isOnPath, isInPond })
    : null;
  const rock = pine ? placeRock(pine, heightAt, isOnPath, isInPond) : null;
  const seaTorii = typeof heightAt === 'function'
    ? computeSeaToriiSite({ heightAt })
    : null;

  const solids = [];
  if (pine) solids.push({ x: pine.x, z: pine.z, r: POI.pineTrunkR });
  if (rock) solids.push({ x: rock.x, z: rock.z, r: POI.rockR });

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

  return {
    group,
    stoneYAt,
    hitsSolid,
    sites: { pine, rock, seaTorii },
    dispose,
  };
}
