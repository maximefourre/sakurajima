/**
 * herons.js — little egrets on the pond shallows.
 *
 * N is 1–3, so the state machine lives on the CPU (idle → peck → takeoff)
 * and the birds share two merged geometries (folded / spread). They do
 * not scale with AREA_SOFT: the habitat is three basins, not the island.
 *
 * The standing tell is the S-neck + black stilt legs + yellow feet; the
 * flying tell is the tucked neck and a real wingspan that BEATS. Same
 * origin (between the feet, nose +Z) so the instance matrix does not pop.
 * Flap is GPU (aSpan + shoulder hinge) — never rotate the merged mesh
 * around the feet, or the wings scythe the water.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HERONS, SEED } from './config.js';
import { streamFor, R } from './noise.js';

const IDLE = 0, PECK = 1, TAKEOFF = 2, FLY = 3, LAND = 4;
const TAU = Math.PI * 2;

function paint(geo, hex, vary = 0) {
  const tint = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    const j = vary ? 1 + vary * (pos.getY(i) * 0.08 + pos.getZ(i) * 0.04) : 1;
    c[i * 3] = tint.r * j;
    c[i * 3 + 1] = tint.g * j;
    c[i * 3 + 2] = tint.b * j;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  geo.deleteAttribute('uv');
  if (!geo.getAttribute('aSpan')) {
    geo.setAttribute('aSpan', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  }
  return geo;
}

function mergeParts(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  for (const g of flat) g.dispose();
  for (const g of parts) g.dispose();
  return merged;
}

const WHITE = 0xf4f6f0;
const DOWN = 0xe4e6dc;
const SHADE = 0xd2d6cc;
const BEAK = 0x1a1a18;
const LEG = 0x2a2a28;
const FOOT = 0xe8b42a;

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _qBone = new THREE.Quaternion();
const _mBone = new THREE.Matrix4();

/** Cylinder from joint A to tip B. Same basis as kuromatsu arms. */
function bone(ax, ay, az, bx, by, bz, r0, r1, segs, hex, vary = 0) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 1e-5;
  const g = new THREE.CylinderGeometry(r1, r0, len, segs);
  _dir.set(dx, dy, dz).normalize();
  _qBone.setFromUnitVectors(_up, _dir);
  _mBone.makeRotationFromQuaternion(_qBone);
  g.applyMatrix4(_mBone);
  g.translate((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  return paint(g, hex, vary);
}

function blob(sx, sy, sz, x, y, z, hex, vary = 0, sw = 8, sh = 6) {
  const g = new THREE.SphereGeometry(1, sw, sh);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return paint(g, hex, vary);
}

function slab(w, h, d, x, y, z, hex, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return paint(g, hex);
}

/**
 * Thin tapered wing panel. x0 is inboard (shoulder), x1 the tip.
 * Closed prism so the underside has a real -Y normal — a +Y plate is
 * black from the pond. aSpan 0 at the body, 1 at the tip; the flap
 * shader hinges around the shoulder, not the feet.
 */
function wingPlate({
  s, x0, x1, y0, y1, zL0, zT0, zL1, zT1, th0, th1, hex, span0, span1,
}) {
  const ht0 = th0 * 0.5, ht1 = th1 * 0.5;
  const P = [
    [s * x0, y0 + ht0, zL0],
    [s * x0, y0 + ht0, zT0],
    [s * x1, y1 + ht1, zL1],
    [s * x1, y1 + ht1, zT1],
    [s * x0, y0 - ht0, zL0],
    [s * x0, y0 - ht0, zT0],
    [s * x1, y1 - ht1, zL1],
    [s * x1, y1 - ht1, zT1],
  ];
  const Sp = [span0, span0, span1, span1, span0, span0, span1, span1];
  const faces = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
  ];
  const pos = [], spn = [];
  const emit = (i) => {
    pos.push(P[i][0], P[i][1], P[i][2]);
    spn.push(Sp[i]);
  };
  for (const f of faces) {
    const q = s < 0 ? [f[0], f[3], f[2], f[1]] : f;
    emit(q[0]); emit(q[1]); emit(q[2]);
    emit(q[0]); emit(q[2]); emit(q[3]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSpan', new THREE.Float32BufferAttribute(spn, 1));
  g.computeVertexNormals();
  return paint(g, hex);
}

function addToes(parts, ax, ay, az) {
  parts.push(bone(ax, ay, az, ax, ay, az + 0.062, 0.006, 0.004, 4, FOOT));
  parts.push(bone(ax, ay, az, ax + 0.028, ay, az + 0.050, 0.005, 0.003, 4, FOOT));
  parts.push(bone(ax, ay, az, ax - 0.028, ay, az + 0.050, 0.005, 0.003, 4, FOOT));
  parts.push(bone(ax, ay, az, ax, ay, az - 0.038, 0.005, 0.003, 4, FOOT));
}

function addHead(parts, x, y, z, beakLen) {
  parts.push(blob(0.036, 0.032, 0.046, x, y, z, WHITE, 0.03, 7, 6));
  parts.push(blob(0.012, 0.010, 0.014, x, y - 0.004, z + 0.036, 0x2e2e2c));
  const beak = new THREE.ConeGeometry(0.009, beakLen, 5);
  beak.rotateX(Math.PI * 0.5);
  beak.translate(x, y - 0.008, z + 0.034 + beakLen * 0.42);
  parts.push(paint(beak, BEAK));
  for (const s of [-1, 1]) {
    parts.push(blob(0.007, 0.007, 0.007, x + s * 0.022, y + 0.006, z + 0.012, BEAK));
  }
}

/** Standing little egret. Origin between the feet, nose +Z. */
export function makeHeronGeometry() {
  const parts = [];

  for (const s of [-1, 1]) {
    parts.push(bone(s * 0.038, 0.58, 0.00, s * 0.050, 0.33, 0.050, 0.015, 0.011, 5, LEG));
    parts.push(bone(s * 0.050, 0.33, 0.050, s * 0.042, 0.012, 0.00, 0.010, 0.006, 5, LEG));
    addToes(parts, s * 0.042, 0.010, 0.00);
  }

  parts.push(blob(0.088, 0.078, 0.22, 0, 0.70, -0.02, WHITE, 0.04));
  parts.push(blob(0.068, 0.062, 0.10, 0, 0.655, 0.13, WHITE, 0.03, 7, 5));
  parts.push(blob(0.048, 0.038, 0.08, 0, 0.675, -0.24, DOWN));
  const tail = new THREE.ConeGeometry(0.038, 0.13, 5);
  tail.rotateX(-Math.PI * 0.5);
  tail.translate(0, 0.665, -0.34);
  parts.push(paint(tail, SHADE));

  // Folded wings: a real lateral plate + primaries past the tail.
  // The old "wings" were spheres buried in the ribcage — they vanished.
  for (const s of [-1, 1]) {
    parts.push(blob(0.055, 0.062, 0.075, s * 0.092, 0.76, 0.04, WHITE, 0.03, 7, 5));
    parts.push(blob(0.048, 0.082, 0.20, s * 0.098, 0.715, -0.08, DOWN, 0.04));
    parts.push(slab(0.036, 0.050, 0.18, s * 0.082, 0.655, -0.32, SHADE, 0.18, 0, s * 0.08));
  }

  // S-neck: out, back, then forward to the dagger.
  parts.push(bone(0, 0.76, 0.14, 0, 0.90, 0.23, 0.030, 0.024, 6, WHITE, 0.03));
  parts.push(bone(0, 0.90, 0.23, 0, 1.07, 0.05, 0.024, 0.018, 6, WHITE, 0.03));
  parts.push(bone(0, 1.07, 0.05, 0, 1.165, 0.20, 0.018, 0.016, 6, WHITE, 0.02));
  addHead(parts, 0, 1.17, 0.24, 0.145);

  // Nuchal plumes — the aigrette that names the bird.
  parts.push(bone(0, 1.175, 0.18, 0.018, 1.205, -0.02, 0.005, 0.002, 4, WHITE));
  parts.push(bone(0, 1.175, 0.18, -0.016, 1.195, -0.05, 0.005, 0.002, 4, WHITE));
  parts.push(bone(0, 1.172, 0.17, 0.004, 1.168, -0.08, 0.004, 0.0015, 4, DOWN));

  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/** Spread-wing takeoff / cruise. Same origin as the standing bird. */
export function makeHeronFlyGeometry() {
  const parts = [];

  parts.push(blob(0.078, 0.055, 0.23, 0, 0.62, 0.02, WHITE, 0.04));
  parts.push(blob(0.055, 0.042, 0.08, 0, 0.60, 0.16, WHITE, 0.02, 6, 5));
  const tail = new THREE.ConeGeometry(0.036, 0.12, 5);
  tail.rotateX(-Math.PI * 0.5);
  tail.translate(0, 0.595, -0.26);
  parts.push(paint(tail, SHADE));

  // Neck tucked into the heron-crook, not a stork spear.
  parts.push(bone(0, 0.64, 0.16, 0, 0.78, 0.07, 0.026, 0.020, 6, WHITE, 0.03));
  parts.push(bone(0, 0.78, 0.07, 0, 0.70, 0.22, 0.020, 0.016, 6, WHITE, 0.02));
  addHead(parts, 0, 0.69, 0.28, 0.13);

  for (const s of [-1, 1]) {
    parts.push(bone(s * 0.030, 0.55, -0.04, s * 0.028, 0.44, -0.26, 0.012, 0.008, 5, LEG));
    parts.push(bone(s * 0.028, 0.44, -0.26, s * 0.026, 0.38, -0.50, 0.008, 0.005, 5, LEG));
    addToes(parts, s * 0.026, 0.375, -0.52);
  }

  // Three tapered panels, half-span ~1.08. aSpan drives the GPU flap.
  // Shoulder stays aSpan=0 so the hinge does not lift the ribcage.
  for (const s of [-1, 1]) {
    parts.push(blob(0.050, 0.044, 0.07, s * 0.11, 0.64, 0.04, WHITE, 0.03, 7, 5));
    parts.push(wingPlate({
      s, x0: 0.10, x1: 0.48, y0: 0.64, y1: 0.66,
      zL0: 0.16, zT0: -0.12, zL1: 0.13, zT1: -0.14,
      th0: 0.022, th1: 0.016, hex: WHITE, span0: 0.06, span1: 0.45,
    }));
    parts.push(wingPlate({
      s, x0: 0.48, x1: 0.90, y0: 0.66, y1: 0.70,
      zL0: 0.13, zT0: -0.14, zL1: 0.04, zT1: -0.16,
      th0: 0.016, th1: 0.010, hex: DOWN, span0: 0.45, span1: 0.86,
    }));
    parts.push(wingPlate({
      s, x0: 0.90, x1: 1.08, y0: 0.70, y1: 0.73,
      zL0: 0.04, zT0: -0.16, zL1: -0.05, zT1: -0.13,
      th0: 0.010, th1: 0.006, hex: SHADE, span0: 0.86, span1: 1.0,
    }));
  }

  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

function pondOf(ponds, x, z) {
  let best = -1, bestD2 = Infinity;
  for (let i = 0; i < ponds.length; i++) {
    const p = ponds[i];
    const d2 = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  return best;
}

function waterYOf(ponds, pondWaterYAt, x, z, fallbackPond) {
  if (typeof pondWaterYAt === 'function') {
    const y = pondWaterYAt(x, z);
    if (y != null) return y;
  }
  if (fallbackPond && Number.isFinite(fallbackPond.waterY)) return fallbackPond.waterY;
  const i = pondOf(ponds, x, z);
  return i >= 0 ? ponds[i].waterY : 0;
}

function isShallowStand({ x, z, heightAt, ponds, isInPond, pondWaterYAt }) {
  if (typeof heightAt !== 'function') return false;
  if (typeof isInPond === 'function' && !isInPond(x, z)) return false;
  const i = pondOf(ponds, x, z);
  if (i < 0) return false;
  const p = ponds[i];
  const r = Math.hypot(x - p.x, z - p.z);
  if (r < HERONS.koiClear * p.radius) return false;
  const wy = waterYOf(ponds, pondWaterYAt, x, z, p);
  const depth = wy - heightAt(x, z);
  return depth >= HERONS.shallowMin && depth <= HERONS.shallowMax;
}

function sampleShallow(rng, ponds, heightAt, isInPond, pondWaterYAt, prefer) {
  const order = [];
  if (prefer != null && ponds[prefer]) order.push(prefer);
  for (let i = 0; i < ponds.length; i++) if (i !== prefer) order.push(i);
  // Prefer the named pond, then the others; still one shared try budget.
  for (let tries = 0; tries < 90; tries++) {
    const pi = order[tries % order.length];
    const p = ponds[pi];
    const a = rng() * TAU;
    const u0 = HERONS.koiClear;
    const u = Math.sqrt(u0 * u0 + rng() * (1 - u0 * u0));
    const r = u * p.radius * 0.98;
    const x = p.x + Math.cos(a) * r;
    const z = p.z + Math.sin(a) * r;
    if (!isShallowStand({ x, z, heightAt, ponds, isInPond, pondWaterYAt })) continue;
    return {
      x, z,
      h: heightAt(x, z),
      yaw: Math.atan2(p.x - x, p.z - z),
      pond: pi,
    };
  }
  return null;
}

/**
 * Rejection-sample shallow stands. May return fewer than `count`; never more.
 */
export function computeHeronSpawns({
  seed = SEED, heightAt, ponds, isInPond, count, pondWaterYAt,
} = {}) {
  const out = [];
  if (!ponds || !ponds.length || typeof heightAt !== 'function' || !(count > 0)) {
    return out;
  }
  const rng = streamFor(seed, 'herons.spawn');
  const sep2 = HERONS.minSep * HERONS.minSep;
  const nPond = ponds.length;

  for (let i = 0; i < count; i++) {
    const prefer = i % nPond;
    let found = null;
    for (let attempt = 0; attempt < 6 && !found; attempt++) {
      const s = sampleShallow(rng, ponds, heightAt, isInPond, pondWaterYAt, prefer);
      if (!s) continue;
      let clash = false;
      for (let k = 0; k < out.length; k++) {
        const dx = s.x - out[k].x, dz = s.z - out[k].z;
        if (dx * dx + dz * dz < sep2) { clash = true; break; }
      }
      if (!clash) found = s;
    }
    if (found) out.push(found);
  }
  return out;
}

function patchFlyMaterial(mat) {
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
attribute float aSpan;
attribute vec2 aFlap;`
    ).replace(
      '#include <beginnormal_vertex>',
      /* glsl */ `
        #include <beginnormal_vertex>
        {
          float span = aSpan;
          if (span > 0.001) {
            float side = sign(position.x);
            float phase = aFlap.x;
            float amp = aFlap.y;
            float lag = span * 0.75;
            float a = sin(phase - lag) * amp * (0.18 + 0.82 * span);
            a += 0.08 * span;
            float ang = a * side;
            float c = cos(ang), sn = sin(ang);
            objectNormal = vec3(
              objectNormal.x * c - objectNormal.y * sn,
              objectNormal.x * sn + objectNormal.y * c,
              objectNormal.z);
            float tw = -cos(phase - lag) * amp * 0.22 * span;
            float ct = cos(tw), st = sin(tw);
            objectNormal = vec3(
              objectNormal.x,
              objectNormal.y * ct - objectNormal.z * st,
              objectNormal.y * st + objectNormal.z * ct);
          }
        }
      `
    ).replace(
      '#include <begin_vertex>',
      /* glsl */ `
        #include <begin_vertex>
        {
          float span = aSpan;
          if (span > 0.001) {
            float side = sign(transformed.x);
            float phase = aFlap.x;
            float amp = aFlap.y;
            float lag = span * 0.75;
            float a = sin(phase - lag) * amp * (0.18 + 0.82 * span);
            a += 0.08 * span;
            float ang = a * side;
            float c = cos(ang), sn = sin(ang);
            vec3 sh = vec3(side * 0.11, 0.64, 0.04);
            vec3 q = transformed - sh;
            transformed = vec3(q.x * c - q.y * sn, q.x * sn + q.y * c, q.z) + sh;
            float tw = -cos(phase - lag) * amp * 0.22 * span;
            float ct = cos(tw), st = sin(tw);
            q = transformed - sh;
            transformed = vec3(q.x, q.y * ct - q.z * st, q.y * st + q.z * ct) + sh;
          }
        }
      `
    );
  };
  mat.customProgramCacheKey = () => 'heron-fly-flap-v1';
  return mat;
}

export function createHerons({
  seed = SEED, quality, heightAt, ponds, isInPond, pondWaterYAt,
} = {}) {
  const count = quality?.herons ?? 0;
  const list = Array.isArray(ponds) ? ponds : [];
  const spawns = computeHeronSpawns({
    seed, heightAt, ponds: list, isInPond, count, pondWaterYAt,
  });
  const n = spawns.length;

  const standGeo = makeHeronGeometry();
  const flyGeo = makeHeronFlyGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.68, metalness: 0,
  });
  const flyMat = patchFlyMaterial(material.clone());
  const cap = Math.max(n, 1);
  const flapArr = new Float32Array(cap * 2);
  const aFlap = new THREE.InstancedBufferAttribute(flapArr, 2);
  flyGeo.setAttribute('aFlap', aFlap);
  const mesh = new THREE.InstancedMesh(standGeo, material, cap);
  mesh.name = 'herons';
  mesh.count = n;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const flyMesh = new THREE.InstancedMesh(flyGeo, flyMat, cap);
  flyMesh.name = 'herons-fly';
  flyMesh.count = n;
  flyMesh.castShadow = true;
  flyMesh.receiveShadow = false;
  flyMesh.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'herons';
  group.add(mesh);
  group.add(flyMesh);

  const rng = streamFor(seed, 'herons.sim');
  const alts = [];
  for (let k = 0; k < Math.max(n * 4, 4); k++) {
    const s = sampleShallow(rng, list, heightAt, isInPond, pondWaterYAt, k % Math.max(list.length, 1));
    if (s) alts.push(s);
  }

  const birds = spawns.map((s) => ({
    x: s.x, z: s.z, y: s.h,
    homeX: s.x, homeZ: s.z, homeY: s.h, homeYaw: s.yaw,
    destX: s.x, destZ: s.z, destY: s.h, destYaw: s.yaw,
    yaw: s.yaw,
    scale: R.range(rng, HERONS.size[0], HERONS.size[1]),
    state: IDLE,
    timer: R.range(rng, HERONS.idleSeconds[0], HERONS.idleSeconds[1]),
    peck: 0,
    flyY: 0,
    seed: R.range(rng, 0, 40),
    flapPhase: rng() * TAU,
    flapAmp: 0,
    bank: 0,
    prevYaw: s.yaw,
    glideT: R.range(rng, 0.6, 1.6),
    gliding: false,
  }));

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _off = new THREE.Matrix4();
  const _rot = new THREE.Matrix4();

  function write(i) {
    const b = birds[i];
    const hip = 0.55;
    const flying = b.state === TAKEOFF || b.state === FLY
      || (b.state === LAND && b.y - b.destY > 0.4);
    const bob = flying
      ? Math.sin(b.flapPhase) * 0.055 * b.flapAmp
      : 0.01 * Math.sin(b.seed);
    _e.set(
      flying ? -0.14 + Math.sin(b.flapPhase) * 0.035 * b.flapAmp : 0,
      b.yaw,
      b.bank,
    );
    _q.setFromEuler(_e);
    _p.set(b.x, b.y + bob, b.z);
    _s.set(b.scale, b.scale, b.scale);
    _m.compose(_p, _q, _s);
    if (!flying && b.peck > 0.01) {
      _off.makeTranslation(0, hip, 0);
      _rot.makeRotationX(b.peck * 0.85);
      _m.multiply(_off);
      _m.multiply(_rot);
      _off.makeTranslation(0, -hip, 0);
      _m.multiply(_off);
    }
    if (flying) {
      flyMesh.setMatrixAt(i, _m);
      _s.set(0, 0, 0);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
    } else {
      mesh.setMatrixAt(i, _m);
      _s.set(0, 0, 0);
      _m.compose(_p, _q, _s);
      flyMesh.setMatrixAt(i, _m);
    }
  }

  for (let i = 0; i < n; i++) write(i);
  if (n) {
    mesh.instanceMatrix.needsUpdate = true;
    flyMesh.instanceMatrix.needsUpdate = true;
  }

  const _rep = new THREE.Vector3();
  let repelActive = false;
  const flushR2 = HERONS.flushRadius * HERONS.flushRadius;

  function setRepeller(p) {
    if (!p) { repelActive = false; return; }
    _rep.set(p.x, p.y, p.z);
    repelActive = true;
  }

  function pickAlt(b) {
    let best = null, bestD = -1;
    for (let i = 0; i < alts.length; i++) {
      const a = alts[i];
      const dx = a.x - b.x, dz = a.z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 9) continue;
      const away = repelActive
        ? (a.x - _rep.x) ** 2 + (a.z - _rep.z) ** 2
        : d2;
      if (away > bestD) { bestD = away; best = a; }
    }
    if (!best && alts.length) best = alts[(rng() * alts.length) | 0];
    if (!best) {
      return {
        x: b.homeX, z: b.homeZ, h: b.homeY,
        yaw: b.homeYaw,
      };
    }
    return best;
  }

  let lastFlush = null;

  function flush(b) {
    const dest = pickAlt(b);
    b.state = TAKEOFF;
    b.timer = 0.45;
    b.destX = dest.x;
    b.destZ = dest.z;
    b.destY = dest.h;
    b.destYaw = dest.yaw;
    b.flyY = R.range(rng, HERONS.cruiseY[0], HERONS.cruiseY[1]);
    b.peck = 0;
    b.gliding = false;
    b.glideT = R.range(rng, 0.9, 1.6);
    lastFlush = { x: b.x, y: b.y, z: b.z };
    const fn = api.onFlush;
    if (typeof fn === 'function') fn(lastFlush);
  }

  function update(t, dt, shibaX, shibaZ) {
    if (!n) return;
    dt = Math.min(0.05, Math.max(0, dt || 0));
    if (Number.isFinite(shibaX) && Number.isFinite(shibaZ)) {
      _rep.set(shibaX, 0, shibaZ);
      repelActive = true;
    }

    for (let i = 0; i < n; i++) {
      const b = birds[i];
      const near = repelActive
        && (b.x - _rep.x) ** 2 + (b.z - _rep.z) ** 2 < flushR2;

      if (near && (b.state === IDLE || b.state === PECK || b.state === LAND)) {
        flush(b);
      }

      b.timer -= dt;

      if (b.state === IDLE) {
        b.peck += (0 - b.peck) * Math.min(1, dt * 6);
        b.yaw += Math.sin(t * 0.35 + b.seed) * dt * 0.08;
        if (b.timer <= 0) {
          b.state = PECK;
          b.timer = R.range(rng, HERONS.peckSeconds[0], HERONS.peckSeconds[1]);
        }
      } else if (b.state === PECK) {
        const u = 1 - Math.max(0, b.timer) / Math.max(HERONS.peckSeconds[0], 1e-3);
        b.peck = Math.sin(Math.min(1, u) * Math.PI);
        if (b.timer <= 0) {
          b.state = IDLE;
          b.timer = R.range(rng, HERONS.idleSeconds[0], HERONS.idleSeconds[1]);
          b.peck = 0;
        }
      } else if (b.state === TAKEOFF) {
        b.y += (b.flyY + (typeof heightAt === 'function' ? heightAt(b.x, b.z) : b.y) - b.y)
          * Math.min(1, dt * 3.2);
        if (b.timer <= 0) b.state = FLY;
      } else if (b.state === FLY) {
        const dx = b.destX - b.x, dz = b.destZ - b.z;
        const d = Math.hypot(dx, dz) || 1;
        const step = HERONS.flySpeed * dt;
        if (d < step + 0.8) {
          b.state = LAND;
          b.timer = 0.55;
        } else {
          b.x += (dx / d) * step;
          b.z += (dz / d) * step;
          b.yaw = Math.atan2(dx, dz);
          const floor = typeof heightAt === 'function' ? heightAt(b.x, b.z) : b.y;
          b.y += (floor + b.flyY - b.y) * Math.min(1, dt * 2.4);
        }
      } else if (b.state === LAND) {
        const floor = typeof heightAt === 'function' ? heightAt(b.destX, b.destZ) : b.destY;
        b.x += (b.destX - b.x) * Math.min(1, dt * 5);
        b.z += (b.destZ - b.z) * Math.min(1, dt * 5);
        b.y += (floor - b.y) * Math.min(1, dt * 4);
        b.yaw += (b.destYaw - b.yaw) * Math.min(1, dt * 3);
        if (b.timer <= 0) {
          b.x = b.destX; b.z = b.destZ; b.y = floor;
          b.homeX = b.x; b.homeZ = b.z; b.homeY = b.y; b.homeYaw = b.destYaw;
          b.state = IDLE;
          b.timer = R.range(rng, HERONS.idleSeconds[0], HERONS.idleSeconds[1]);
        }
      }

      const flying = b.state === TAKEOFF || b.state === FLY
        || (b.state === LAND && b.y - b.destY > 0.4);
      const turn = Math.atan2(Math.sin(b.yaw - b.prevYaw), Math.cos(b.yaw - b.prevYaw));
      b.prevYaw = b.yaw;
      if (flying) {
        const wantBank = Math.max(-0.42, Math.min(0.42, -turn / Math.max(dt, 1e-4) * 0.10));
        b.bank += (wantBank - b.bank) * Math.min(1, dt * 4);
        const takeoff = b.state === TAKEOFF;
        const landing = b.state === LAND;
        const hz = takeoff ? HERONS.flapHz[1] : landing ? HERONS.flapHz[0] * 0.75 : HERONS.flapHz[0];
        let ampT = takeoff ? 0.95 : landing ? 0.38 : 0.62;
        if (b.state === FLY) {
          b.glideT -= dt;
          if (b.glideT <= 0) {
            b.gliding = !b.gliding;
            b.glideT = b.gliding ? R.range(rng, 0.35, 0.85) : R.range(rng, 0.9, 1.9);
          }
          if (b.gliding) ampT = 0.10;
        }
        b.flapAmp += (ampT - b.flapAmp) * Math.min(1, dt * 5);
        b.flapPhase = (b.flapPhase + hz * TAU * dt) % TAU;
      } else {
        b.bank += (0 - b.bank) * Math.min(1, dt * 6);
        b.flapAmp += (0 - b.flapAmp) * Math.min(1, dt * 8);
      }
      flapArr[i * 2] = b.flapPhase;
      flapArr[i * 2 + 1] = b.flapAmp;

      write(i);
    }
    mesh.instanceMatrix.needsUpdate = true;
    flyMesh.instanceMatrix.needsUpdate = true;
    aFlap.needsUpdate = true;
  }

  function dispose() {
    standGeo.dispose();
    flyGeo.dispose();
    material.dispose();
    flyMat.dispose();
    mesh.removeFromParent();
    flyMesh.removeFromParent();
    group.removeFromParent();
  }

  function forEach(fn) {
    for (let i = 0; i < n; i++) fn(birds[i]);
  }

  const api = {
    group, mesh, update, setRepeller, dispose, forEach,
    /** Settable: ({x,y,z}) => void. Called on each takeoff. */
    onFlush: () => {},
    get lastFlush() { return lastFlush; },
  };
  return api;
}
