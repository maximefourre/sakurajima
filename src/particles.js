/**
 * particles.js — brief ground reactions shared by dust, foliage and water.
 *
 * Both pools are ring buffers. Instance matrices hold immutable world-space
 * origins; velocity integration is entirely in the grain vertex shader, so a
 * frame only advances two uTime uniforms regardless of the number of grains.
 */

import * as THREE from 'three';
import { streamFor, R } from './noise.js';

export const PARTICLE_KIND = Object.freeze({
  DIRT: 'dirt',
  SAND: 'sand',
  MEADOW: 'meadow',
  WATER: 'water',
});

const KIND_INDEX = Object.freeze({
  [PARTICLE_KIND.DIRT]: 0,
  [PARTICLE_KIND.SAND]: 1,
  [PARTICLE_KIND.MEADOW]: 2,
  [PARTICLE_KIND.WATER]: 3,
});

const GRAIN_LIFE = 1.7;
const CROWN_LIFE = 1.05;
const CROWN_COUNT = 32;

function grainBudget(quality) {
  if (quality && quality.label === 'ultra') return 192;
  if (quality && quality.label === 'high') return 128;
  return 64;
}

function parkInstances(mesh, count) {
  const parked = new THREE.Matrix4().makeTranslation(0, -9999, 0);
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, parked);
  mesh.instanceMatrix.needsUpdate = true;
}

function createGrainPool(count, life, season) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const born = new Float32Array(count).fill(-1e9);
  const vel = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const kind = new Float32Array(count);
  geo.setAttribute('aBorn', new THREE.InstancedBufferAttribute(born, 1));
  geo.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
  for (const name of ['aBorn', 'aVel', 'aSize', 'aKind']) {
    geo.attributes[name].setUsage(THREE.DynamicDrawUsage);
  }

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLife: { value: life },
      // Deliberately PALER than the ground each kind rises from. The first
      // version used the path's own colour (0xb77b48) and the puff was
      // invisible against it — measured in game, not guessed. Airborne dust
      // scatters light and always reads lighter than the surface it left.
      uDirtColor: { value: new THREE.Color(0xdcbb92) },
      uSandColor: { value: new THREE.Color(0xf6ead2) },
      uMeadowColor: {
        value: new THREE.Color(season === 'autumn' ? 0xd98b4a : 0xb9cf92),
      },
      uWaterColor: { value: new THREE.Color(0xc7efff) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aBorn;
      attribute vec3  aVel;
      attribute float aSize;
      attribute float aKind;
      uniform float uTime;
      uniform float uLife;
      varying vec2 vUv;
      varying float vBorn;
      varying float vKind;

      void main() {
        float age = max(0.0, uTime - aBorn);
        // Dirt and sand hang in the air; foliage falls faster and droplets snap
        // back down. All integration stays here, never in a per-frame JS loop.
        float g = aKind > 2.5 ? -13.0 : (aKind > 1.5 ? -8.0 : -4.8);
        vec3 ballistic = aVel * age + vec3(0.0, 0.5 * g * age * age, 0.0);
        vec4 worldOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 mvPosition = viewMatrix * vec4(worldOrigin.xyz + ballistic, 1.0);

        // Dust puffs expand as they lose opacity. Blades, leaves and droplets
        // keep their emitted size.
        float dust = 1.0 - step(1.5, aKind);
        float grow = mix(1.0, 1.0 + 0.72 * age / uLife, dust);
        mvPosition.xy += position.xy * aSize * grow;

        vUv = uv;
        vBorn = aBorn;
        vKind = aKind;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uLife;
      uniform vec3 uDirtColor;
      uniform vec3 uSandColor;
      uniform vec3 uMeadowColor;
      uniform vec3 uWaterColor;
      varying vec2 vUv;
      varying float vBorn;
      varying float vKind;

      void main() {
        float age = uTime - vBorn;
        if (age < 0.0 || age > uLife) discard;

        vec2 p = vUv * 2.0 - 1.0;
        float disc = 1.0 - smoothstep(0.52, 1.0, length(p));
        float fade = 1.0 - age / uLife;
        vec3 color = uDirtColor;
        if (vKind > 0.5) color = uSandColor;
        if (vKind > 1.5) color = uMeadowColor;
        if (vKind > 2.5) color = uWaterColor;
        float opacity = vKind > 2.5 ? 0.84 : 0.64;
        float alpha = disc * fade * opacity;
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.name = 'shiba-ground-grains';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  parkInstances(mesh, count);

  return { mesh, geo, material, born, vel, size, kind, cursor: 0, count };
}

function createCrownPool(count, life) {
  const geo = new THREE.PlaneGeometry(6, 6);
  geo.rotateX(-Math.PI / 2);
  const born = new Float32Array(count).fill(-1e9);
  geo.setAttribute('aBorn', new THREE.InstancedBufferAttribute(born, 1));
  geo.attributes.aBorn.setUsage(THREE.DynamicDrawUsage);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLife: { value: life },
      uColor: { value: new THREE.Color(0xd5f4ff) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aBorn;
      varying vec2 vUv;
      varying float vBorn;

      void main() {
        vUv = uv;
        vBorn = aBorn;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uLife;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vBorn;

      float annulus(vec2 p, float radius, float width) {
        float d = abs(length(p) - radius);
        return 1.0 - smoothstep(width * 0.42, width, d);
      }

      void main() {
        float age = uTime - vBorn;
        if (age < 0.0 || age > uLife) discard;
        vec2 p = (vUv - 0.5) * 6.0;
        float r = age * 2.4;
        float fade = 1.0 - age / uLife;
        float alpha = annulus(p, r, 0.18) * fade * fade * 0.74;
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.name = 'shiba-water-crowns';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  parkInstances(mesh, count);

  return { mesh, geo, material, born, cursor: 0, count };
}

/**
 * @param {object} [opts]
 * @param {object} [opts.quality] one of config.QUALITY
 * @param {number} [opts.seed]
 * @param {string} [opts.season] construction-time meadow palette
 */
export function createParticles({ quality = null, seed = 1337, season = 'spring' } = {}) {
  const rng = streamFor(seed, 'shiba:splash');
  const grains = createGrainPool(grainBudget(quality), GRAIN_LIFE, season);
  const crowns = createCrownPool(CROWN_COUNT, CROWN_LIFE);
  const group = new THREE.Group();
  group.name = 'shiba-ground-particles';
  group.add(grains.mesh, crowns.mesh);

  const origin = new THREE.Matrix4();
  const crownScale = new THREE.Vector3();
  const crownPosition = new THREE.Vector3();
  const crownRotation = new THREE.Quaternion();
  let clock = 0;

  /**
   * @param {number} [driftX] @param {number} [driftZ] world-space bias added to
   *   every grain's horizontal velocity. Callers pass the direction the dust
   *   should be thrown — for a running dog, BEHIND him. Emitting a symmetric
   *   puff at the paw put it under the belly, where the dog's own silhouette
   *   hid it: verified in game with the depth test toggled.
   */
  function emitGrain(kindIndex, x, y, z, strength, driftX = 0, driftZ = 0) {
    const i = grains.cursor;
    const angle = R.range(rng, 0, Math.PI * 2);
    let radial;
    let rise;
    let loSize;
    let hiSize;

    if (kindIndex === KIND_INDEX[PARTICLE_KIND.WATER]) {
      radial = R.range(rng, 1.15, 3.2) * strength;
      rise = R.range(rng, 2.7, 5.2) * strength;
      loSize = 0.075; hiSize = 0.16;
    } else if (kindIndex === KIND_INDEX[PARTICLE_KIND.DIRT]) {
      radial = R.range(rng, 0.25, 1.05) * strength;
      rise = R.range(rng, 0.65, 1.65) * strength;
      loSize = 0.30; hiSize = 0.58;
    } else if (kindIndex === KIND_INDEX[PARTICLE_KIND.SAND]) {
      radial = R.range(rng, 0.45, 1.45) * strength;
      rise = R.range(rng, 0.75, 1.9) * strength;
      loSize = 0.24; hiSize = 0.46;
    } else {
      radial = R.range(rng, 0.55, 1.75) * strength;
      rise = R.range(rng, 1.0, 2.55) * strength;
      loSize = 0.16; hiSize = 0.34;
    }

    const v = i * 3;
    grains.vel[v] = Math.cos(angle) * radial + driftX;
    grains.vel[v + 1] = rise;
    grains.vel[v + 2] = Math.sin(angle) * radial + driftZ;
    grains.size[i] = R.range(rng, loSize, hiSize) * strength;
    grains.kind[i] = kindIndex;
    grains.born[i] = clock;
    // Offset along the same drift, so the puff is already clear of the body on
    // its first frame instead of having to escape from under it.
    const lead = 0.22;
    origin.makeTranslation(
      x + driftX * lead + R.range(rng, -0.10, 0.10),
      y + R.range(rng, 0.025, 0.085),
      z + driftZ * lead + R.range(rng, -0.10, 0.10)
    );
    grains.mesh.setMatrixAt(i, origin);
    grains.cursor = (i + 1) % grains.count;
  }

  function emitCrown(x, waterY, z, strength, delay) {
    const i = crowns.cursor;
    crownPosition.set(x, waterY + 0.02, z);
    crownScale.setScalar(strength);
    origin.compose(crownPosition, crownRotation, crownScale);
    crowns.mesh.setMatrixAt(i, origin);
    crowns.born[i] = clock + delay;
    crowns.cursor = (i + 1) % crowns.count;
  }

  /**
   * Emit any ground reaction from an arbitrary world position.
   * `crowns` is only read for water; two gives a staggered double crown.
   */
  function burst(kind, x, y, z, count, strength = 1, crownCount = 1, driftX = 0, driftZ = 0) {
    const kindIndex = KIND_INDEX[kind];
    if (kindIndex === undefined) {
      throw new Error(`[particles] unknown burst kind: ${kind}`);
    }

    const n = Math.max(0, Math.min(grains.count, Math.round(count)));
    const power = Math.max(0.1, Number.isFinite(strength) ? strength : 1);
    for (let j = 0; j < n; j++) emitGrain(kindIndex, x, y, z, power, driftX, driftZ);

    if (kindIndex === KIND_INDEX[PARTICLE_KIND.WATER]) {
      const rings = Math.max(0, Math.min(crowns.count, Math.round(crownCount)));
      for (let j = 0; j < rings; j++) {
        emitCrown(x, y, z, power * (1 - j * 0.16), j * 0.075);
      }
    }

    if (n > 0) {
      grains.mesh.instanceMatrix.needsUpdate = true;
      grains.geo.attributes.aBorn.needsUpdate = true;
      grains.geo.attributes.aVel.needsUpdate = true;
      grains.geo.attributes.aSize.needsUpdate = true;
      grains.geo.attributes.aKind.needsUpdate = true;
    }
    if (kindIndex === KIND_INDEX[PARTICLE_KIND.WATER] && crownCount > 0) {
      crowns.mesh.instanceMatrix.needsUpdate = true;
      crowns.geo.attributes.aBorn.needsUpdate = true;
    }
  }

  function update(t) {
    clock = t;
    grains.material.uniforms.uTime.value = t;
    crowns.material.uniforms.uTime.value = t;
  }

  function dispose() {
    grains.geo.dispose();
    grains.material.dispose();
    grains.mesh.dispose();
    crowns.geo.dispose();
    crowns.material.dispose();
    crowns.mesh.dispose();
  }

  return { group, burst, update, dispose };
}

export default createParticles;
