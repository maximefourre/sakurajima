/**
 * midges.js — essaims de moucherons du crépuscule au-dessus des berges.
 *
 * Même recette GPU que dragonflies.js (billboard instancié, danse dans le
 * vertex shader), mais : N FIXE par tier (pas AREA_SOFT), regroupés en
 * colonnes (un essaim = une ancre de berge), actifs à l'heure dorée et au
 * crépuscule seulement, et lisibles en CONTRE-JOUR — un point sombre qui
 * s'allume quand le regard file vers le soleil bas.
 */

import * as THREE from 'three';
import { MIDGES, qualityCount } from './config.js';
import { streamFor, R } from './noise.js';

/** Plus haut sol sous un disque (centre + 8 points), eau des étangs comprise. */
function groundMax(x, z, rad, heightAt, waterYAt) {
  let g = -Infinity;
  const probe = (px, pz) => {
    const h = heightAt(px, pz);
    const w = waterYAt ? waterYAt(px, pz) : null;
    g = Math.max(g, h, w ?? -Infinity);
  };
  probe(x, z);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    probe(x + Math.cos(a) * rad, z + Math.sin(a) * rad);
  }
  return g;
}

/**
 * Essaims ancrés sur les berges. Pur. Retourne `{ swarms, spots }` :
 * chaque spot porte son essaim. Le Y de chaque moucheron est relevé pour
 * que sa danse (≤ MIDGES.jitter dans tous les axes) garde MIDGES.minClear
 * au-dessus du plus haut sol voisin — la leçon des lucioles (garde calculée
 * au semis, dérive GPU ensuite) est payée ici, pas dans un invariant vert.
 */
export function computeMidgeSpots({
  ponds, heightAt, pondWaterYAt = null, count, seed = 1,
} = {}) {
  const swarms = [];
  const spots = [];
  if (!ponds || ponds.length === 0 || !(count > 0) || typeof heightAt !== 'function') {
    return { swarms, spots };
  }
  const nSwarms = Math.max(1, Math.floor(count / MIDGES.perSwarm));
  const rng = streamFor(seed, 'midges.placement');

  // répartition au prorata du rayon mesuré, tour de rôle déterministe
  const total = ponds.reduce((s, p) => s + p.radius, 0);
  const quota = ponds.map((p) => (p.radius / total) * nSwarms);
  const given = ponds.map(() => 0);
  for (let s = 0; s < nSwarms; s++) {
    let best = 0, bestNeed = -Infinity;
    for (let i = 0; i < ponds.length; i++) {
      const need = quota[i] - given[i];
      if (need > bestNeed) { bestNeed = need; best = i; }
    }
    given[best]++;
    const p = ponds[best];
    const a = R.range(rng, 0, Math.PI * 2);
    const r = p.radius * R.range(rng, MIDGES.shoreK[0], MIDGES.shoreK[1]);
    const cx = p.x + Math.cos(a) * r;
    const cz = p.z + Math.sin(a) * r;
    const g = groundMax(cx, cz, MIDGES.swarmR + MIDGES.jitter, heightAt, pondWaterYAt);
    const cy = Math.max(g, p.waterY ?? -Infinity) + R.range(rng, MIDGES.centreClear[0], MIDGES.centreClear[1]);
    swarms.push({ x: cx, y: cy, z: cz, pond: best });
  }

  const per = Math.floor(count / nSwarms);
  for (let s = 0; s < swarms.length; s++) {
    const sw = swarms[s];
    for (let k = 0; k < per; k++) {
      const a = R.range(rng, 0, Math.PI * 2);
      const rr = MIDGES.swarmR * Math.sqrt(R.range(rng, 0, 1));
      const x = sw.x + Math.cos(a) * rr;
      const z = sw.z + Math.sin(a) * rr;
      let y = sw.y + R.range(rng, -MIDGES.swarmH, MIDGES.swarmH);
      const floor = groundMax(x, z, MIDGES.jitter, heightAt, pondWaterYAt) + MIDGES.minClear + MIDGES.jitter;
      if (y < floor) y = floor;
      spots.push({ x, y, z, swarm: s, pond: sw.pond });
    }
  }
  return { swarms, spots };
}

/**
 * Courbe d'activité : heure dorée + crépuscule, zéro à midi et la nuit.
 * Exportée pour que le banc ne recopie pas la formule.
 */
export function midgeActivity(phase) {
  if (!phase) return 0;
  const g = (phase.golden ?? 0) * 0.7 + (phase.twilight ?? 0);
  return Math.max(0, Math.min(1, g)) * (1 - Math.max(0, Math.min(1, phase.night ?? 0)));
}

export function createMidges({
  seed = 1, quality, heightAt, ponds, pondWaterYAt = null,
} = {}) {
  const count = qualityCount(quality, 'midges');
  const { spots } = computeMidgeSpots({ ponds, heightAt, pondWaterYAt, count, seed });
  const n = spots.length;

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  const aPos = new Float32Array(n * 3);
  const aSeed = new Float32Array(n * 4);
  const rng = streamFor(seed, 'midges.attrs');
  for (let i = 0; i < n; i++) {
    const s = spots[i];
    aPos[i * 3] = s.x; aPos[i * 3 + 1] = s.y; aPos[i * 3 + 2] = s.z;
    aSeed[i * 4] = R.range(rng, 0, Math.PI * 2);
    aSeed[i * 4 + 1] = R.range(rng, 2.2, 4.6);   // battement rapide : un moucheron, pas une libellule
    aSeed[i * 4 + 2] = R.range(rng, 0.55, 1.0);  // part de l'amplitude max
    aSeed[i * 4 + 3] = R.range(rng, MIDGES.size[0], MIDGES.size[1]);
  }
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 4));
  geo.instanceCount = n;

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uActivity: { value: 0 },
      uJitter: { value: MIDGES.jitter },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uColor: { value: new THREE.Color(MIDGES.color) },
      uGlint: { value: new THREE.Color(MIDGES.glint) },
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
      uniform float uJitter;
      uniform vec3  uSunDir;

      varying vec2 vQuad;
      varying float vBack;
      varying float vAct;

      #include <fog_pars_vertex>

      void main() {
        float ph = aSeed.x;
        float rate = aSeed.y;
        float amp = aSeed.z * uJitter;

        // Danse bornée : |dx|, |dz| <= 0.55 amp, |dy| <= amp <= uJitter.
        vec3 p = aPos;
        p.x += amp * 0.55 * sin(uTime * rate + ph);
        p.z += amp * 0.55 * sin(uTime * rate * 1.31 + ph * 1.7);
        p.y += amp * sin(uTime * rate * 2.07 + ph * 0.6);

        vec3 toP = normalize(p - cameraPosition);
        vBack = pow(max(dot(toP, normalize(uSunDir)), 0.0), 5.0);
        vAct = uActivity;
        vQuad = position.xy * 2.0;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        mvPosition.xy += position.xy * aSeed.w;
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uGlint;

      varying vec2 vQuad;
      varying float vBack;
      varying float vAct;

      #include <fog_pars_fragment>

      void main() {
        if (vAct < 0.01) discard;
        float d2 = dot(vQuad, vQuad);
        float shape = exp(-d2 * 3.2);
        if (shape < 0.05) discard;
        vec3 col = mix(uColor, uGlint * 1.6, vBack);
        gl_FragColor = vec4(col, shape * vAct * (0.45 + 0.55 * vBack));

        #include <fog_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'midges';
  mesh.renderOrder = 5;
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += aPos[i * 3]; cy += aPos[i * 3 + 1]; cz += aPos[i * 3 + 2]; }
    const inv = 1 / Math.max(n, 1);
    cx *= inv; cy *= inv; cz *= inv;
    let r = 0;
    for (let i = 0; i < n; i++) {
      r = Math.max(r, Math.hypot(aPos[i * 3] - cx, aPos[i * 3 + 1] - cy, aPos[i * 3 + 2] - cz));
    }
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(cx, cy, cz), r + MIDGES.jitter * 1.2 + MIDGES.size[1] * Math.SQRT2
    );
  }

  function update(t, phase) {
    if (!phase) return;
    const activity = midgeActivity(phase);
    mesh.visible = activity > 0.02 && n > 0;
    if (!mesh.visible) return;
    uniforms.uTime.value = t;
    uniforms.uActivity.value = activity;
    const d = phase.sunDirection || phase.keyDir;
    if (d) uniforms.uSunDir.value.copy(d);
  }

  function dispose() {
    geo.dispose();
    material.dispose();
  }

  return { mesh, update, dispose, count: n, activity: midgeActivity };
}
