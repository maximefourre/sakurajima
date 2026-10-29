/**
 * treasures.js — omamori cachés et flair.
 *
 * Douze sachets de tissu, posés une fois pour toutes par le flux
 * `streamFor(seed, 'treasures')`. Terre ferme, hors sentier, hors étang,
 * hors cour du chashitsu, à douze unités au moins les uns des autres.
 *
 * Heading, la même que shiba.js : le chien avance de (sin θ, cos θ)
 * avec θ = atan2(dx, dz). θ = 0 regarde +Z, θ = π/2 regarde +X.
 * `sniff().dir` est ce θ — pas un yaw de caméra en −Z.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TREASURES, WORLD } from './config.js';
import { streamFor } from './noise.js';

const TAU = Math.PI * 2;
/** Plan : espacement minimum, en unités monde. */
const MIN_SEP = 12;
/** Plan : sur terre, au-dessus du clapotis. */
const MIN_H = 0.3;
/** island.js pose ISLAND_R = WORLD.size * 0.385. On reste dans ce disque. */
const ISLAND_FRAC = 0.385;
const MAX_TRIES_PER = 500;

/** Teintures de tissu. Le sommet reste blanc : instanceColor les teinte. */
const CLOTH = Object.freeze([
  0xc8372d, 0x243f78, 0xd4a24a, 0xf4efe4,
  0x2c6b48, 0x6b3a68, 0xc46a78, 0x3c7ea8,
  0x8c3a2a, 0x1f6a62, 0xe8d7a8, 0x4a3d72,
]);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _col = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };

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
  return geo;
}

function mergeParts(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  for (const g of flat) g.dispose();
  for (const g of parts) g.dispose();
  return merged;
}

/**
 * Sachet arrondi + cordon, base en y = 0, hauteur 1.
 * L'échelle d'instance (`TREASURES.size`) en fait la taille monde.
 * Sommets du tissu à blanc : pieges.md #2, instanceColor multiplie.
 * Le cordon est un peu plus sombre, pour qu'il se lise sous la teinture.
 */
function makeOmamoriGeometry() {
  const pouch = new THREE.SphereGeometry(0.5, 12, 9);
  pouch.scale(0.78, 0.86, 0.30);
  pouch.translate(0, 0.43, 0);
  paint(pouch, 0xffffff);

  const neck = new THREE.SphereGeometry(0.5, 8, 6);
  neck.scale(0.20, 0.09, 0.13);
  neck.translate(0, 0.84, 0);
  paint(neck, 0xffffff);

  const knot = new THREE.SphereGeometry(0.042, 7, 5);
  knot.translate(0, 0.90, 0);
  paint(knot, 0xf7f1e6);

  const strand = new THREE.CylinderGeometry(0.012, 0.012, 0.09, 6);
  strand.translate(0, 0.96, 0);
  paint(strand, 0xc4b49a);

  const loop = new THREE.TorusGeometry(0.055, 0.010, 6, 12);
  loop.translate(0, 1.045, 0);
  paint(loop, 0xb7a78e);

  const geo = mergeParts([pouch, neck, knot, strand, loop]);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const h = Math.max(1e-6, bb.max.y - bb.min.y);
  const cx = (bb.max.x + bb.min.x) * 0.5;
  const cz = (bb.max.z + bb.min.z) * 0.5;
  geo.translate(-cx, -bb.min.y, -cz);
  geo.scale(1 / h, 1 / h, 1 / h);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Léger scintillement, une phase par amulette. L'uniforme existe
 * déjà : update() n'écrit qu'un float.
 */
function patchGlint(mat, uTime) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlint;\nvarying float vGlint;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGlint = aGlint;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nvarying float vGlint;'
      )
      .replace(
        '#include <opaque_fragment>',
        'outgoingLight += vec3(0.09, 0.065, 0.03) * (0.5 + 0.5 * sin(uTime * 2.2 + vGlint));\n#include <opaque_fragment>'
      );
  };
}

/**
 * @param {object} opts
 * @param {number} opts.seed
 * @param {Function} opts.heightAt
 * @param {Function} [opts.isOnPath]
 * @param {Function} [opts.isInPond]
 * @param {Function} [opts.keepOut]
 * @param {number} [opts.count]
 * @returns {{id:string, x:number, y:number, z:number}[]}
 */
export function placeTreasures({
  seed, heightAt, isOnPath, isInPond, keepOut, count = TREASURES.count,
} = {}) {
  const n = count | 0;
  if (n <= 0 || typeof heightAt !== 'function') return [];

  const rng = streamFor(seed, 'treasures');
  const radius = WORLD.size * ISLAND_FRAC;
  const sep2 = MIN_SEP * MIN_SEP;
  const onPath = typeof isOnPath === 'function' ? isOnPath : null;
  const inPond = typeof isInPond === 'function' ? isInPond : null;
  const yard = typeof keepOut === 'function' ? keepOut : null;
  const out = [];
  const maxTries = n * MAX_TRIES_PER;

  for (let tries = 0; tries < maxTries && out.length < n; tries++) {
    const ang = rng() * TAU;
    const rad = Math.sqrt(rng()) * radius;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    const y = heightAt(x, z);
    if (!(y > MIN_H)) continue;
    if (onPath && onPath(x, z)) continue;
    if (inPond && inPond(x, z)) continue;
    if (yard && yard(x, z)) continue;

    let crowded = false;
    for (let i = 0; i < out.length; i++) {
      const dx = x - out[i].x;
      const dz = z - out[i].z;
      // Marge infime : hypot(d) doit rester ≥ 12 malgré l'arrondi.
      if (dx * dx + dz * dz < sep2 + 0.05) { crowded = true; break; }
    }
    if (crowded) continue;

    out.push({ id: `omamori-${out.length}`, x, y, z });
  }
  return out;
}

/**
 * @param {object} opts mêmes champs que placeTreasures
 * @returns {{
 *   mesh: THREE.InstancedMesh,
 *   ids: string[],
 *   spots: {id:string, x:number, y:number, z:number}[],
 *   update: (t:number, x:number, z:number) => void,
 *   sniff: (x:number, z:number) => {dir:number, strength:number, id:string|null},
 *   markFound: (ids:Iterable<string>) => void,
 *   onFound: (id:string) => void,
 *   dispose: () => void,
 * }}
 */
export function createTreasures({
  seed, heightAt, isOnPath, isInPond, keepOut, count = TREASURES.count,
} = {}) {
  const spots = placeTreasures({ seed, heightAt, isOnPath, isInPond, keepOut, count });
  const n = spots.length;
  const cap = Math.max(n, 1);
  const ids = spots.map((s) => s.id);

  const geo = makeOmamoriGeometry();
  const glint = new Float32Array(cap);
  for (let i = 0; i < cap; i++) glint[i] = i * 1.7;
  geo.setAttribute('aGlint', new THREE.InstancedBufferAttribute(glint, 1));

  const uTime = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.02,
    emissive: 0x2a1c12,
    emissiveIntensity: 0.18,
  });
  patchGlint(mat, uTime);

  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.name = 'omamori';
  mesh.count = n;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const qx = new Float64Array(cap);
  const qy = new Float64Array(cap);
  const qz = new Float64Array(cap);
  const qw = new Float64Array(cap);
  const hidden = new Uint8Array(cap);
  const pose = streamFor(seed, 'treasures:pose');
  const sc0 = TREASURES.size;

  for (let i = 0; i < n; i++) {
    _e.set(0, pose() * TAU, 0);
    _q.setFromEuler(_e);
    qx[i] = _q.x; qy[i] = _q.y; qz[i] = _q.z; qw[i] = _q.w;
    _p.set(spots[i].x, spots[i].y, spots[i].z);
    _s.set(sc0, sc0, sc0);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);

    _col.setHex(CLOTH[i % CLOTH.length]);
    _col.getHSL(_hsl);
    const l = Math.min(0.74, Math.max(0.28, _hsl.l + (pose() - 0.5) * 0.05));
    _col.setHSL(_hsl.h, _hsl.s, l);
    mesh.setColorAt(i, _col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (n > 0) mesh.computeBoundingSphere();

  const pickR2 = TREASURES.pickRadius * TREASURES.pickRadius;
  const sniffRange = TREASURES.sniffRange;

  function write(i, scale) {
    _q.set(qx[i], qy[i], qz[i], qw[i]);
    _p.set(spots[i].x, spots[i].y, spots[i].z);
    _s.set(scale, scale, scale);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }

  function hide(i) {
    if (hidden[i]) return false;
    hidden[i] = 1;
    write(i, 0);
    mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  const api = {
    mesh,
    ids,
    spots,
    /**
     * Ramasse au contact. Aucune allocation : grattage module,
     * un float écrit dans le uniforme du scintillement.
     * onFound ne part qu'une fois par id.
     */
    update(t, x, z) {
      uTime.value = t;
      for (let i = 0; i < n; i++) {
        if (hidden[i]) continue;
        const s = spots[i];
        const dx = s.x - x;
        const dz = s.z - z;
        if (dx * dx + dz * dz > pickR2) continue;
        hide(i);
        if (typeof api.onFound === 'function') api.onFound(s.id);
      }
    },
    /**
     * La plus proche encore en place.
     * strength = 1 au contact, 0 à sniffRange et au-delà.
     * id null si tout est déjà trouvé.
     */
    sniff(x, z) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (hidden[i]) continue;
        const dx = spots[i].x - x;
        const dz = spots[i].z - z;
        const d = Math.hypot(dx, dz);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return { dir: 0, strength: 0, id: null };
      const dx = spots[best].x - x;
      const dz = spots[best].z - z;
      const dir = Math.atan2(dx, dz);
      const strength = bestD >= sniffRange ? 0 : 1 - bestD / sniffRange;
      return { dir, strength, id: spots[best].id };
    },
    /** Retrait au boot, depuis la sauvegarde. N'émet pas onFound. */
    markFound(list) {
      if (list == null) return;
      for (const id of list) {
        for (let i = 0; i < n; i++) {
          if (spots[i].id !== id) continue;
          hide(i);
          break;
        }
      }
    },
    onFound(_id) {},
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
    /** Reset de la progression : tous les omamori reviennent en place. N'émet pas onFound. */
    unmarkAll() {
      for (let i = 0; i < n; i++) {
        if (!hidden[i]) continue;
        hidden[i] = 0;
        write(i, sc0);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
  return api;
}
