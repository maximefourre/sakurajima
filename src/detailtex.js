/**
 * detailtex.js — tiny GENERATED bump textures. No image files: the project's
 * doctrine is procedural-everything, and these are DataTextures computed at
 * load from seeded periodic value noise.
 *
 * Why textures at all, when the terrain already has a shader grain? Because a
 * bumpMap is the one cheap way to get MICRO-RELIEF — light actually raking
 * across small bumps — without hand-rolling view-space normal perturbation in
 * every material's onBeforeCompile. three's bump path does the derivative
 * work, mipmaps stop it shimmering at distance, and RepeatWrapping needs the
 * noise to be PERIODIC — which library fbm is not. Hence the little lattice
 * generator below instead of noise.js.
 */

import * as THREE from 'three';
import { streamFor } from './noise.js';

/** Periodic value noise on a wrapped lattice — tiles seamlessly. */
function periodicNoise(size, cells, rng) {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  const out = new Float32Array(size * size);
  const fade = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * cells;
    const y0 = gy | 0, fy = fade(gy - y0);
    const y1 = (y0 + 1) % cells;
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const x0 = gx | 0, fx = fade(gx - x0);
      const x1 = (x0 + 1) % cells;
      const a = lat[y0 * cells + x0], b = lat[y0 * cells + x1];
      const c = lat[y1 * cells + x0], d = lat[y1 * cells + x1];
      out[y * size + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

function toTexture(data, w, h) {
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = Math.max(0, Math.min(255, data[i] * 255)) | 0;
  const tex = new THREE.DataTexture(bytes, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Isotropic 3-octave grain — ground, stone, packed earth. */
export function makeGrainBump(seed, size = 256) {
  const rng = streamFor(seed, 'detailtex:grain');
  const o1 = periodicNoise(size, 6, rng);
  const o2 = periodicNoise(size, 17, rng);
  const o3 = periodicNoise(size, 47, rng);
  const data = new Float32Array(size * size);
  for (let i = 0; i < data.length; i++) data[i] = o1[i] * 0.5 + o2[i] * 0.32 + o3[i] * 0.18;
  return toTexture(data, size, size);
}

/** Anisotropic grain — long streaks along U. Bridge wood, torii. */
export function makeWoodBump(seed, w = 256, h = 64) {
  const rng = streamFor(seed, 'detailtex:wood');
  // Coarse along the grain, fine across it: sample an anisotropic lattice by
  // generating at square resolution and stretching the V axis 6x.
  const oA = periodicNoise(w, 5, rng);
  const oB = periodicNoise(w, 23, rng);
  const data = new Float32Array(w * h);
  // Stretch factor must be exactly w/h so row h wraps onto row 0 — anything
  // else breaks the V periodicity and prints a seam across every plank.
  const stretch = w / h;
  for (let y = 0; y < h; y++) {
    const sy = (y * stretch) % w;
    for (let x = 0; x < w; x++) {
      const k = sy * w + x;
      data[y * w + x] = oA[k] * 0.6 + oB[k] * 0.4;
    }
  }
  return toTexture(data, w, h);
}
