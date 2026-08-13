/**
 * crabs.js — strand crabs on the same tideline as the pebbles.
 *
 * N is 10–28, so the state machine lives on the CPU (idle → flee → bury)
 * and the mesh is one InstancedMesh. They do not scale with AREA_SOFT:
 * the habitat is a thin band, not the island.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CRABS, SEED } from './config.js';
import { streamFor, R } from './noise.js';

const IDLE = 0, FLEE = 1, BURY = 2, HIDDEN = 3;
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

/** Carapace + two claws + six legs. Nose is local +Z. */
export function makeCrabGeometry() {
  const parts = [];

  const shell = new THREE.SphereGeometry(1, 8, 6);
  shell.scale(0.16, 0.055, 0.125);
  shell.translate(0, 0.055, 0.01);
  paint(shell, 0x8f4a30);
  parts.push(shell);

  const apron = new THREE.SphereGeometry(1, 6, 4);
  apron.scale(0.07, 0.028, 0.05);
  apron.translate(0, 0.03, -0.10);
  paint(apron, 0x6e3824);
  parts.push(apron);

  for (const s of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.014, 0.018, 0.09, 5);
    arm.rotateZ(s * 0.85);
    arm.translate(s * 0.13, 0.055, 0.10);
    paint(arm, 0x7a3d28);
    parts.push(arm);

    const claw = new THREE.SphereGeometry(1, 6, 4);
    claw.scale(0.038, 0.028, 0.050);
    claw.translate(s * 0.175, 0.062, 0.155);
    paint(claw, 0xb05032);
    parts.push(claw);

    const pincer = new THREE.BoxGeometry(0.018, 0.014, 0.040);
    pincer.translate(s * 0.175, 0.062, 0.195);
    paint(pincer, 0xc45a36);
    parts.push(pincer);
  }

  const zLegs = [0.06, -0.01, -0.08];
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const leg = new THREE.CylinderGeometry(0.008, 0.012, 0.15, 4);
      leg.rotateZ(s * 1.15);
      leg.rotateX((k - 1) * 0.28);
      leg.translate(s * 0.155, 0.02, zLegs[k]);
      paint(leg, 0x5c3222);
      parts.push(leg);
    }
  }

  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

function onStrand(heightAt, isInPond, x, z) {
  if (typeof isInPond === 'function' && isInPond(x, z)) return false;
  const h = heightAt(x, z);
  return h >= CRABS.strandLo && h <= CRABS.strandHi;
}

/**
 * Rejection-sample the pebble tideline. May return fewer than `count`
 * if the band is thin; never more.
 */
export function computeCrabSpawns({ heightAt, isInPond, count, seed = SEED } = {}) {
  const out = [];
  if (typeof heightAt !== 'function' || !(count > 0)) return out;

  const rng = streamFor(seed, 'crabs.spawn');
  const maxTries = count * 80;
  const sep2 = CRABS.minSep * CRABS.minSep;

  for (let tries = 0; tries < maxTries && out.length < count; tries++) {
    const x = R.range(rng, -CRABS.sampleHalfX, CRABS.sampleHalfX);
    const z = R.range(rng, CRABS.sampleMinZ, CRABS.sampleMaxZ);
    if (!onStrand(heightAt, isInPond, x, z)) continue;
    let clash = false;
    for (let i = 0; i < out.length; i++) {
      const dx = x - out[i].x, dz = z - out[i].z;
      if (dx * dx + dz * dz < sep2) { clash = true; break; }
    }
    if (clash) continue;
    out.push({
      x, z,
      h: heightAt(x, z),
      yaw: rng() * TAU,
    });
  }
  return out;
}

export function createCrabs({ seed = SEED, quality, heightAt, isInPond } = {}) {
  const count = quality?.crabs ?? 0;
  const spawns = computeCrabSpawns({ heightAt, isInPond, count, seed });
  const n = spawns.length;

  const geo = makeCrabGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.86, metalness: 0,
  });
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(n, 1));
  mesh.name = 'crabs';
  mesh.count = n;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  // They walk; a baked sphere around spawn would clip mid-flee.
  mesh.frustumCulled = false;

  const rng = streamFor(seed, 'crabs.sim');
  const bugs = spawns.map((s) => ({
    x: s.x,
    z: s.z,
    y: s.h,
    homeX: s.x,
    homeZ: s.z,
    yaw: s.yaw,
    scale: R.range(rng, CRABS.size[0], CRABS.size[1]),
    bury: 1,
    state: IDLE,
    timer: R.range(rng, 0.6, 3.2),
    side: R.sign(rng),
  }));

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();

  function write(i) {
    const b = bugs[i];
    const sy = b.scale * b.bury;
    _e.set(0, b.yaw, 0);
    _q.setFromEuler(_e);
    _p.set(b.x, b.y + 0.03 * b.bury, b.z);
    _s.set(b.scale, sy, b.scale);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }

  for (let i = 0; i < n; i++) write(i);
  if (n) mesh.instanceMatrix.needsUpdate = true;

  let lastT = null;

  function tryStep(b, nx, nz) {
    if (typeof heightAt !== 'function') return false;
    if (!onStrand(heightAt, isInPond, nx, nz)) return false;
    b.x = nx;
    b.z = nz;
    b.y = heightAt(nx, nz);
    return true;
  }

  function update(t, shibaX, shibaZ) {
    if (!n) return;
    const dt = lastT == null ? 0 : Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;
    const fleeR2 = CRABS.fleeRadius * CRABS.fleeRadius;

    for (let i = 0; i < n; i++) {
      const b = bugs[i];
      if (b.state === HIDDEN) continue;

      if (b.state !== BURY && Number.isFinite(shibaX) && Number.isFinite(shibaZ)) {
        const dx = b.x - shibaX, dz = b.z - shibaZ;
        if (dx * dx + dz * dz < fleeR2) {
          if (b.state !== FLEE) {
            b.state = FLEE;
            b.timer = R.range(rng, CRABS.fleeSeconds[0], CRABS.fleeSeconds[1]);
          }
          // Face the dog; the flee step then scurries backward along -Z.
          b.yaw = Math.atan2(-dx, -dz);
        }
      }

      b.timer -= dt;

      if (b.state === FLEE) {
        const awayX = b.x - shibaX, awayZ = b.z - shibaZ;
        const al = Math.hypot(awayX, awayZ) || 1;
        const step = CRABS.fleeSpeed * dt;
        if (!tryStep(b, b.x + (awayX / al) * step, b.z + (awayZ / al) * step)) {
          b.state = BURY;
          b.timer = CRABS.burySeconds;
        } else if (b.timer <= 0) {
          b.state = BURY;
          b.timer = CRABS.burySeconds;
        }
      } else if (b.state === BURY) {
        const u = CRABS.burySeconds > 1e-6
          ? 1 - Math.max(0, b.timer) / CRABS.burySeconds
          : 1;
        b.bury = Math.max(0, 1 - u);
        if (b.timer <= 0) {
          b.bury = 0;
          b.y = (typeof heightAt === 'function' ? heightAt(b.x, b.z) : b.y) - 0.45;
          b.state = HIDDEN;
        }
      } else {
        // IDLE — occasional sideways shuffle, recalled to the spawn.
        if (b.timer <= 0) {
          b.side = R.sign(rng);
          b.timer = R.range(rng, 0.8, 2.8);
        }
        const hx = b.x - b.homeX, hz = b.z - b.homeZ;
        const hd = Math.hypot(hx, hz);
        let mx, mz;
        if (hd > CRABS.homeRadius) {
          mx = -hx / hd;
          mz = -hz / hd;
          b.yaw = Math.atan2(-mx, -mz);
        } else {
          mx = Math.cos(b.yaw) * b.side;
          mz = -Math.sin(b.yaw) * b.side;
        }
        tryStep(b, b.x + mx * CRABS.shuffleSpeed * dt, b.z + mz * CRABS.shuffleSpeed * dt);
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

  return { mesh, update, dispose };
}
