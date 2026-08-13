/**
 * herons.js — egrets on the pond shallows.
 *
 * N is 1–3, so the state machine lives on the CPU (idle → peck → takeoff)
 * and every bird shares one merged geometry. They do not scale with
 * AREA_SOFT: the habitat is three basins, not the island.
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
  return geo;
}

function mergeParts(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  for (const g of flat) g.dispose();
  for (const g of parts) g.dispose();
  return merged;
}

/** Standing egret. Origin between the feet, nose +Z. */
export function makeHeronGeometry() {
  const parts = [];

  for (const s of [-1, 1]) {
    const thigh = new THREE.CylinderGeometry(0.012, 0.018, 0.28, 5);
    thigh.translate(s * 0.045, 0.36, 0.01);
    paint(thigh, 0xc4a04a);
    parts.push(thigh);

    const shin = new THREE.CylinderGeometry(0.008, 0.012, 0.30, 5);
    shin.translate(s * 0.045, 0.12, 0.02);
    paint(shin, 0xb89038);
    parts.push(shin);

    const toe = new THREE.CylinderGeometry(0.006, 0.005, 0.055, 4);
    toe.rotateX(Math.PI * 0.5);
    toe.translate(s * 0.045, 0.008, 0.028);
    paint(toe, 0xa87828);
    parts.push(toe);
  }

  const body = new THREE.SphereGeometry(1, 8, 6);
  body.scale(0.11, 0.095, 0.20);
  body.translate(0, 0.72, -0.02);
  paint(body, 0xe8ece8, 0.04);
  parts.push(body);

  const breast = new THREE.SphereGeometry(1, 6, 5);
  breast.scale(0.08, 0.07, 0.10);
  breast.translate(0, 0.66, 0.10);
  paint(breast, 0xf2f4f0);
  parts.push(breast);

  const tail = new THREE.ConeGeometry(0.055, 0.16, 5);
  tail.rotateX(-Math.PI * 0.5);
  tail.translate(0, 0.70, -0.24);
  paint(tail, 0xd4d8d0);
  parts.push(tail);

  const n0 = new THREE.CylinderGeometry(0.028, 0.036, 0.16, 6);
  n0.rotateX(0.55);
  n0.translate(0, 0.82, 0.10);
  paint(n0, 0xe4e6e0);
  parts.push(n0);

  const n1 = new THREE.CylinderGeometry(0.020, 0.028, 0.18, 6);
  n1.rotateX(-0.85);
  n1.translate(0, 0.96, 0.04);
  paint(n1, 0xeeeee8);
  parts.push(n1);

  const n2 = new THREE.CylinderGeometry(0.016, 0.020, 0.14, 6);
  n2.rotateX(0.70);
  n2.translate(0, 1.08, 0.12);
  paint(n2, 0xf0f0ea);
  parts.push(n2);

  const head = new THREE.SphereGeometry(1, 6, 5);
  head.scale(0.038, 0.034, 0.048);
  head.translate(0, 1.16, 0.20);
  paint(head, 0xf4f4ee);
  parts.push(head);

  const beak = new THREE.ConeGeometry(0.012, 0.13, 5);
  beak.rotateX(Math.PI * 0.5);
  beak.translate(0, 1.145, 0.28);
  paint(beak, 0xd8a020);
  parts.push(beak);

  for (const s of [-1, 1]) {
    const wing = new THREE.SphereGeometry(1, 6, 5);
    wing.scale(0.045, 0.07, 0.16);
    wing.translate(s * 0.10, 0.74, -0.02);
    paint(wing, 0xd0d4cc);
    parts.push(wing);
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

export function createHerons({
  seed = SEED, quality, heightAt, ponds, isInPond, pondWaterYAt,
} = {}) {
  const count = quality?.herons ?? 0;
  const list = Array.isArray(ponds) ? ponds : [];
  const spawns = computeHeronSpawns({
    seed, heightAt, ponds: list, isInPond, count, pondWaterYAt,
  });
  const n = spawns.length;

  const geo = makeHeronGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.72, metalness: 0,
  });
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(n, 1));
  mesh.name = 'herons';
  mesh.count = n;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'herons';
  group.add(mesh);

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
    _e.set(0, b.yaw, 0);
    _q.setFromEuler(_e);
    _p.set(b.x, b.y + 0.01 * Math.sin(b.seed), b.z);
    _s.set(b.scale, b.scale, b.scale);
    _m.compose(_p, _q, _s);
    if (b.peck > 0.01) {
      _off.makeTranslation(0, hip, 0);
      _rot.makeRotationX(b.peck * 0.85);
      _m.multiply(_off);
      _m.multiply(_rot);
      _off.makeTranslation(0, -hip, 0);
      _m.multiply(_off);
    }
    mesh.setMatrixAt(i, _m);
  }

  for (let i = 0; i < n; i++) write(i);
  if (n) mesh.instanceMatrix.needsUpdate = true;

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

      write(i);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    geo.dispose();
    material.dispose();
    mesh.removeFromParent();
    group.removeFromParent();
  }

  return { group, mesh, update, setRepeller, dispose };
}
