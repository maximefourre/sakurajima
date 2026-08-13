/**
 * gulls.js — seagulls perched on sea stacks and the sea-torii nuki.
 *
 * N is 6–16, so the state machine lives on the CPU (idle / preen / group
 * flush) and the mesh is one InstancedMesh. They do not scale with AREA_SOFT:
 * the habitat is a handful of rocks, not the island.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GULLS, SEED } from './config.js';
import { streamFor, R } from './noise.js';

const PERCH = 0, PREEN = 1, FLY = 2;
const TAU = Math.PI * 2;

function paint(geo, hex) {
  const tint = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = tint.r;
    c[i * 3 + 1] = tint.g;
    c[i * 3 + 2] = tint.b;
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

/** Body + head + beak + wings + tail. Nose is local +Z. */
export function makeGullGeometry() {
  const parts = [];

  const body = new THREE.SphereGeometry(1, 8, 6);
  body.scale(0.055, 0.042, 0.11);
  body.translate(0, 0.04, 0.01);
  paint(body, 0xf2f0ea);
  parts.push(body);

  const head = new THREE.SphereGeometry(1, 7, 5);
  head.scale(0.032, 0.030, 0.036);
  head.translate(0, 0.062, 0.105);
  paint(head, 0xf7f5f0);
  parts.push(head);

  const beak = new THREE.ConeGeometry(0.012, 0.038, 5);
  beak.rotateX(Math.PI * 0.5);
  beak.translate(0, 0.056, 0.148);
  paint(beak, 0xd4a03a);
  parts.push(beak);

  for (const s of [-1, 1]) {
    const wing = new THREE.BoxGeometry(0.16, 0.012, 0.055);
    wing.translate(s * 0.095, 0.048, -0.005);
    wing.rotateZ(s * -0.18);
    paint(wing, 0xc8c4bc);
    parts.push(wing);
  }

  const tail = new THREE.BoxGeometry(0.045, 0.008, 0.055);
  tail.translate(0, 0.038, -0.115);
  paint(tail, 0x9a968e);
  parts.push(tail);

  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

function collectPerches(stacks, torii) {
  const perches = [];
  if (Array.isArray(stacks)) {
    for (let i = 0; i < stacks.length; i++) {
      const s = stacks[i];
      if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
      const y = Number.isFinite(s.topY) ? s.topY : (s.h ?? 0) + 2.4;
      perches.push({ x: s.x, y, z: s.z, yaw: 0, kind: 'stack' });
    }
  }
  if (torii && Number.isFinite(torii.x) && Number.isFinite(torii.z)) {
    const c = Math.cos(torii.yaw), s = Math.sin(torii.yaw);
    const scale = torii.scale;
    const nukiY = torii.nukiY;
    const along = GULLS.nukiAlong;
    for (let i = 0; i < along.length; i++) {
      const ax = along[i] * scale;
      perches.push({
        x: torii.x + ax * c,
        y: nukiY + 0.13 * scale,
        z: torii.z - ax * s,
        yaw: torii.yaw,
        kind: 'nuki',
      });
    }
  }
  return perches;
}

/**
 * Seat `count` gulls on stack tops and the sea-torii nuki. Never more
 * than `count`; fewer only if there is nowhere to stand.
 */
export function computeGullSpawns({
  stacks = [], torii = null, count, seed = SEED,
} = {}) {
  const out = [];
  if (!(count > 0)) return out;
  const perches = collectPerches(stacks, torii);
  if (!perches.length) return out;

  const rng = streamFor(seed, 'gulls.spawn');
  const order = perches.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }

  for (let i = 0; i < count; i++) {
    const p = perches[order[i % order.length]];
    const extra = (i / order.length) | 0;
    let jx = 0, jz = 0;
    if (extra > 0) {
      const a = rng() * TAU;
      const r = GULLS.perchSep * (0.35 + 0.35 * extra);
      jx = Math.cos(a) * r;
      jz = Math.sin(a) * r;
    }
    out.push({
      x: p.x + jx,
      y: p.y,
      z: p.z + jz,
      yaw: p.yaw + (rng() - 0.5) * 0.7,
      kind: p.kind,
    });
  }
  return out;
}

export function createGulls({
  seed = SEED, quality, stacks = [], torii = null,
} = {}) {
  const count = quality?.gulls ?? 0;
  const spawns = computeGullSpawns({ stacks, torii, count, seed });
  const n = spawns.length;

  const geo = makeGullGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.78, metalness: 0,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(n, 1));
  mesh.name = 'gulls';
  mesh.count = n;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  const rng = streamFor(seed, 'gulls.sim');
  const homeX = torii?.x ?? (stacks[0]?.x ?? 0);
  const homeZ = torii?.z ?? (stacks[0]?.z ?? 0);

  const birds = spawns.map((s) => ({
    x: s.x, y: s.y, z: s.z,
    homeX: s.x, homeY: s.y, homeZ: s.z,
    yaw: s.yaw,
    pitch: 0,
    roll: 0,
    scale: R.range(rng, GULLS.size[0], GULLS.size[1]),
    state: PERCH,
    timer: R.range(rng, GULLS.idleSeconds[0], GULLS.idleSeconds[1]),
    orbit: rng() * TAU,
    kind: s.kind,
  }));

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();

  function write(i) {
    const b = birds[i];
    _e.set(b.pitch, b.yaw, b.roll);
    _q.setFromEuler(_e);
    _p.set(b.x, b.y, b.z);
    _s.set(b.scale, b.scale, b.scale);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }

  for (let i = 0; i < n; i++) write(i);
  if (n) mesh.instanceMatrix.needsUpdate = true;

  function threatNear(shiba, camera) {
    const flush2 = GULLS.flushRadius * GULLS.flushRadius;
    const cam2 = GULLS.cameraFlush * GULLS.cameraFlush;
    const sx = shiba?.position?.x, sz = shiba?.position?.z;
    const cx = camera?.position?.x, cy = camera?.position?.y, cz = camera?.position?.z;
    const shibaOk = Number.isFinite(sx) && Number.isFinite(sz);
    const camOk = Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(cz);
    for (let i = 0; i < n; i++) {
      const b = birds[i];
      if (shibaOk) {
        const dx = b.homeX - sx, dz = b.homeZ - sz;
        if (dx * dx + dz * dz < flush2) return true;
      }
      if (camOk) {
        const dx = b.x - cx, dy = b.y - cy, dz = b.z - cz;
        if (dx * dx + dy * dy + dz * dz < cam2) return true;
      }
    }
    return false;
  }

  function flushAll() {
    for (let i = 0; i < n; i++) {
      const b = birds[i];
      if (b.state === FLY) continue;
      b.state = FLY;
      b.timer = R.range(rng, GULLS.flySeconds[0], GULLS.flySeconds[1]);
      b.orbit = rng() * TAU;
    }
  }

  function update(t, dt, shiba, camera) {
    if (!n) return;
    const step = Number.isFinite(dt) ? Math.min(0.05, Math.max(0, dt)) : 0;

    if (threatNear(shiba, camera)) flushAll();

    for (let i = 0; i < n; i++) {
      const b = birds[i];
      b.timer -= step;

      if (b.state === FLY) {
        b.orbit += step * 0.85;
        const r = GULLS.orbitRadius * (0.85 + 0.2 * (i % 3));
        const tx = homeX + Math.cos(b.orbit) * r;
        const tz = homeZ + Math.sin(b.orbit) * r;
        const ty = b.homeY + GULLS.flyHeight + Math.sin(b.orbit * 2 + i) * 1.1;
        const vx = tx - b.x, vz = tz - b.z;
        b.x = tx;
        b.z = tz;
        b.y = ty;
        if (vx * vx + vz * vz > 1e-6) b.yaw = Math.atan2(vx, vz);
        b.pitch = -0.18;
        b.roll = Math.sin(b.orbit) * 0.28;

        if (b.timer <= 0 && !threatNear(shiba, camera)) {
          b.state = PERCH;
          b.x = b.homeX;
          b.y = b.homeY;
          b.z = b.homeZ;
          b.pitch = 0;
          b.roll = 0;
          b.timer = R.range(rng, GULLS.idleSeconds[0], GULLS.idleSeconds[1]);
        }
      } else if (b.state === PREEN) {
        b.pitch = 0.35;
        b.roll = Math.sin(t * 7 + i) * 0.18;
        if (b.timer <= 0) {
          b.state = PERCH;
          b.pitch = 0;
          b.roll = 0;
          b.timer = R.range(rng, GULLS.idleSeconds[0], GULLS.idleSeconds[1]);
        }
      } else {
        b.pitch = 0;
        b.roll = 0;
        b.yaw += Math.sin(t * 0.6 + i * 1.7) * 0.08 * step;
        if (b.timer <= 0) {
          b.state = PREEN;
          b.timer = R.range(rng, GULLS.preenSeconds[0], GULLS.preenSeconds[1]);
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
  }

  return { mesh, update, dispose, spawns };
}
