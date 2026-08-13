/**
 * dragonflies.js — daytime insects over the three basins.
 *
 * Same GPU recipe as fireflies (instanced billboard, drift in the vertex
 * shader) but a day curve and a teal body instead of a night flash. Habitat
 * is the water disc, not the firefly meadow envelope.
 */

import * as THREE from 'three';
import { DRAGONFLIES } from './config.js';
import { streamFor, R } from './noise.js';

/**
 * Seed dragonflies over the pond discs. May return fewer than `count`.
 * Each spot stays inside habitatK of the basin it is assigned to.
 */
export function computeDragonflySpots({
  ponds, heightAt, isInPond, count, seed = 1,
} = {}) {
  const out = [];
  if (!ponds || ponds.length === 0 || !(count > 0)) return out;
  void heightAt;
  void isInPond;

  const rng = streamFor(seed, 'dragonflies.placement');
  const reach = ponds.map((p) => p.radius * DRAGONFLIES.habitatK);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < ponds.length; i++) {
    minX = Math.min(minX, ponds[i].x - reach[i]);
    maxX = Math.max(maxX, ponds[i].x + reach[i]);
    minZ = Math.min(minZ, ponds[i].z - reach[i]);
    maxZ = Math.max(maxZ, ponds[i].z + reach[i]);
  }

  const maxTries = count * 50;
  for (let tries = 0; tries < maxTries && out.length < count; tries++) {
    const x = R.range(rng, minX, maxX);
    const z = R.range(rng, minZ, maxZ);
    let pond = -1, bestD2 = Infinity;
    for (let i = 0; i < ponds.length; i++) {
      const dx = x - ponds[i].x, dz = z - ponds[i].z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; pond = i; }
    }
    if (pond < 0) continue;
    const r = Math.sqrt(bestD2);
    if (r > reach[pond]) continue;
    const waterY = ponds[pond].waterY ?? 0;
    const y = waterY + R.range(rng, DRAGONFLIES.minHeight, DRAGONFLIES.maxHeight);
    out.push({ x, y, z, pond });
  }
  return out;
}

/**
 * Day curve. Exported so the banc does not copy the formula.
 * Active by day: 1 - phase.night.
 */
export function dragonflyActivity(phase) {
  if (!phase) return 0;
  return Math.max(0, Math.min(1, 1 - (phase.night ?? 0)));
}

export function createDragonflies({
  seed = 1, quality, heightAt, ponds, isInPond,
} = {}) {
  const count = quality?.dragonflies ?? 0;
  const spots = computeDragonflySpots({ ponds, heightAt, isInPond, count, seed });
  const n = spots.length;

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  const aPos = new Float32Array(n * 3);
  const aSeed = new Float32Array(n * 4);

  const rng = streamFor(seed, 'dragonflies.attrs');
  for (let i = 0; i < n; i++) {
    const s = spots[i];
    aPos[i * 3] = s.x;
    aPos[i * 3 + 1] = s.y;
    aPos[i * 3 + 2] = s.z;
    aSeed[i * 4] = R.range(rng, 0, Math.PI * 2);
    aSeed[i * 4 + 1] = R.range(rng, DRAGONFLIES.driftRate[0], DRAGONFLIES.driftRate[1]);
    aSeed[i * 4 + 2] = R.range(rng, DRAGONFLIES.driftRadius[0], DRAGONFLIES.driftRadius[1]);
    aSeed[i * 4 + 3] = R.range(rng, DRAGONFLIES.size[0], DRAGONFLIES.size[1]);
  }

  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 4));
  geo.instanceCount = n;

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uActivity: { value: 0 },
      uLift: { value: DRAGONFLIES.driftLift },
      uColor: { value: new THREE.Color(DRAGONFLIES.color) },
      uWing: { value: new THREE.Color(DRAGONFLIES.wingColor) },
    },
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,

    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec4 aSeed;

      uniform float uTime;
      uniform float uActivity;
      uniform float uLift;

      varying vec2 vQuad;
      varying float vGlow;

      #include <fog_pars_vertex>

      void main() {
        float phase = aSeed.x;
        float rate = aSeed.y;
        float radius = aSeed.z;
        float size = aSeed.w;

        vec3 p = aPos;
        p.x += radius * sin(uTime * rate + phase);
        p.z += radius * 0.78 * sin(uTime * rate * 1.17 + phase * 1.4);
        p.y += radius * uLift * (0.5 + 0.5 * sin(uTime * rate * 0.63 + phase * 2.1));

        vGlow = uActivity;
        vQuad = position.xy * 2.0;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        mvPosition.xy += position.xy * size * vec2(1.85, 0.72);
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uWing;

      varying vec2 vQuad;
      varying float vGlow;

      #include <fog_pars_fragment>

      void main() {
        if (vGlow < 0.01) discard;
        vec2 q = vQuad;
        float body = exp(-q.y * q.y * 26.0) * exp(-q.x * q.x * 2.6);
        float wings = exp(-q.x * q.x * 16.0) * exp(-q.y * q.y * 3.2);
        float shape = max(body, wings * 0.55);
        if (shape < 0.04) discard;

        float shimmer = 0.72 + 0.28 * wings;
        vec3 col = mix(uColor, uWing, wings * 0.65) * shimmer;
        gl_FragColor = vec4(col, shape * vGlow * 0.92);

        #include <fog_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'dragonflies';
  mesh.renderOrder = 5;
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += aPos[i * 3]; cy += aPos[i * 3 + 1]; cz += aPos[i * 3 + 2];
    }
    const inv = 1 / Math.max(n, 1);
    cx *= inv; cy *= inv; cz *= inv;
    let r = 0;
    for (let i = 0; i < n; i++) {
      r = Math.max(r, Math.hypot(aPos[i * 3] - cx, aPos[i * 3 + 1] - cy, aPos[i * 3 + 2] - cz));
    }
    const AX = 1, AZ = 0.78, AY = DRAGONFLIES.driftLift;
    const enveloppe = DRAGONFLIES.driftRadius[1] * Math.sqrt(AX * AX + AZ * AZ + AY * AY);
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(cx, cy, cz),
      r + enveloppe + DRAGONFLIES.size[1] * Math.SQRT2 * 1.85
    );
  }

  function update(t, phase) {
    if (!phase) return;
    const activity = dragonflyActivity(phase);
    mesh.visible = activity > 0.02 && n > 0;
    if (!mesh.visible) return;
    uniforms.uTime.value = t;
    uniforms.uActivity.value = activity;
  }

  function dispose() {
    geo.dispose();
    material.dispose();
  }

  return { mesh, update, dispose, activity: dragonflyActivity };
}
