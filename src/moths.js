/**
 * moths.js — mites autour des lanternes de route.
 *
 * Le versant nocturne des CHEMINS, dont fireflies.js est celui des étangs.
 * Même recette GPU : un quad instancié, additif, non éclairé. Habitat = les
 * lanternes des quatre routes plus la paire de terrasse. Pas de mites au
 * hokora : les bougies suffisent, et lanternSpots ne les porte déjà pas.
 *
 * Dérive SERRÉE autour de chaque cage à feu (1.4–2.2 u), pas le vol traînant
 * des hotaru. Actives sur phase.emissive — la même courbe qui allume les
 * lanternes — pour qu'elles apparaissent avec le halo, pas avant.
 */

import * as THREE from 'three';
import { MOTHS } from './config.js';
import { streamFor, R } from './noise.js';

const TAU = Math.PI * 2;

/** Les bougies du sanctuaire suffisent : on refuse un spot de hokora s'il fuit. */
function isShrineLantern(s) {
  return !!(s && (s.hokora || s.shrine || s.kind === 'hokora' || s.kind === 'shrine'));
}

function habitatOf(lanternSpots) {
  if (!lanternSpots || lanternSpots.length === 0) return [];
  const out = [];
  for (let i = 0; i < lanternSpots.length; i++) {
    const s = lanternSpots[i];
    if (s && !isShrineLantern(s)) out.push(s);
  }
  return out;
}

/**
 * Sème les mites autour des lanternes réellement posées.
 *
 * Chaque individu est ancré sur UNE lanterne, à moins de MOTHS.maxSpawnDist
 * (2.6 u) de son pied. Compte 0 si lanternSpots est vide — y compris si
 * `count` est positif : sans habitat il n'y a rien à habiter.
 *
 * En low (0.5 / lanterne) on pose une mite une lanterne sur deux, pour que
 * la population maigre reste LUE comme des halos, pas comme une bruine.
 */
export function computeMothSpots({ lanternSpots, count, seed = 1, heightAt } = {}) {
  const out = [];
  const habitat = habitatOf(lanternSpots);
  if (habitat.length === 0 || !(count > 0)) return out;

  const rng = streamFor(seed, 'moths.placement');
  const nWant = Math.floor(count);
  const nLan = habitat.length;

  for (let i = 0; i < nWant; i++) {
    // Budget < lanternes : étaler sur tout le réseau (low = une sur deux).
    // Budget ≥ lanternes : tourne, deux par cage en ultra.
    const li = nWant <= nLan
      ? Math.round(i * (nLan - 1) / Math.max(nWant - 1, 1))
      : i % nLan;
    const L = habitat[li];
    const ang = R.range(rng, 0, TAU);
    // Disque uniforme, rayon borné : l'invariant mesure le spawn, pas la dérive.
    const r = Math.sqrt(rng()) * MOTHS.spawnRadius;
    const x = L.x + Math.cos(ang) * r;
    const z = L.z + Math.sin(ang) * r;
    const hover = R.range(rng, MOTHS.hoverHeight[0], MOTHS.hoverHeight[1]);
    const y = (heightAt ? heightAt(x, z) : 0) + hover;
    out.push({ x, y, z, lantern: li });
  }
  return out;
}

/**
 * Quelle part de la population vole, entre 0 et 1.
 *
 * `phase.emissive` est la courbe des lanternes (nuit + crépuscules). Les mites
 * n'ont pas de pic propre : elles sont là parce que la cage à feu est allumée.
 */
export function mothActivity(phase) {
  if (!phase) return 0;
  return Math.max(0, Math.min(1, phase.emissive ?? 0));
}

/**
 * Construit la population. Mesh jamais reconstruit — qualité = reload.
 */
export function createMoths({ seed = 1, quality, heightAt, lanternSpots } = {}) {
  // Binding ES vivant rempli par createDetails. Construire avant lui, ou
  // passer world.quality (la CHAINE) au lieu de q, donne un compte zéro
  // sans erreur — le même piège que fireflies / butterflies.
  if (!lanternSpots || lanternSpots.length === 0) {
    throw new Error(
      'createMoths : lanternSpots est vide. Il faut construire APRÈS '
      + 'createDetails, seul à le remplir (binding ES vivant, cf. main.js).'
    );
  }

  const habitat = habitatOf(lanternSpots);
  const rate = quality?.moths ?? MOTHS.perLantern[quality?.label] ?? 0;
  const count = Math.round(habitat.length * rate);
  const spots = computeMothSpots({ lanternSpots: habitat, count, seed, heightAt });
  const n = spots.length;

  const geo = new THREE.InstancedBufferGeometry();
  {
    // Quad unité écrit à la main : cf. fireflies.js — ne pas emprunter une
    // PlaneGeometry qu'on disposerait ensuite.
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,   0.5, -0.5, 0,   0.5, 0.5, 0,   -0.5, 0.5, 0,
    ], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
  }

  const aPos  = new Float32Array(n * 3);
  const aSeed = new Float32Array(n * 4); // phase, driftRate, driftRadius, size
  const aGlow = new Float32Array(n * 2); // éclat, vitesse de papillotement

  const rng = streamFor(seed, 'moths.attrs');
  for (let i = 0; i < n; i++) {
    const s = spots[i];
    aPos[i * 3] = s.x; aPos[i * 3 + 1] = s.y; aPos[i * 3 + 2] = s.z;

    aSeed[i * 4]     = R.range(rng, 0, TAU);
    aSeed[i * 4 + 1] = R.range(rng, MOTHS.driftRate[0], MOTHS.driftRate[1]);
    aSeed[i * 4 + 2] = R.range(rng, MOTHS.driftRadius[0], MOTHS.driftRadius[1]);
    aSeed[i * 4 + 3] = R.range(rng, MOTHS.size[0], MOTHS.size[1]);

    aGlow[i * 2]     = R.range(rng, MOTHS.brightness[0], MOTHS.brightness[1]);
    aGlow[i * 2 + 1] = R.range(rng, MOTHS.flickerRate[0], MOTHS.flickerRate[1]);
  }

  geo.setAttribute('aPos',  new THREE.InstancedBufferAttribute(aPos, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 4));
  geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(aGlow, 2));
  geo.instanceCount = n;

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime:      { value: 0 },
      uActivity:  { value: 0 },
      uColor:     { value: new THREE.Color(MOTHS.color) },
      uOverdrive: { value: MOTHS.overdrive },
      uLift:      { value: MOTHS.driftLift },
    },
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,

    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec4 aSeed;
      attribute vec2 aGlow;

      uniform float uTime;
      uniform float uActivity;
      uniform float uLift;

      varying float vGlow;
      varying vec2  vQuad;

      #include <fog_pars_vertex>

      void main() {
        float phase  = aSeed.x;
        float rate   = aSeed.y;
        float radius = aSeed.z;
        float size   = aSeed.w;

        vec3 p = aPos;
        p.x += radius * sin(uTime * rate + phase);
        p.z += radius * 0.82 * sin(uTime * rate * 0.71 + phase * 1.7);
        // Unilaterale : le semis (hauteur de la cage a feu) est un plancher.
        p.y += radius * uLift * (0.5 + 0.5 * sin(uTime * rate * 0.53 + phase * 2.3));

        // Papillotement, pas un eclair de luciole : une mite dans la lumiere
        // tremble, elle ne pulse pas au rythme d'un choeur.
        float flick = 0.62 + 0.38 * sin(uTime * aGlow.y + phase);
        vGlow = uActivity * aGlow.x * flick;

        vQuad = position.xy * 2.0;

        // Le nom mvPosition est OBLIGATOIRE : fog_vertex le lit litteralement.
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        mvPosition.xy += position.xy * size;
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3  uColor;
      uniform float uOverdrive;

      varying float vGlow;
      varying vec2  vQuad;

      #include <fog_pars_fragment>

      void main() {
        float r2 = dot(vQuad, vQuad);
        if (r2 > 1.0) discard;

        // exp, pas un smoothstep : sans bloom (tier low) un bord franc lirait
        // comme une pastille. Meme recette que fireflies.js.
        float core = exp(-r2 * 7.0);

        vec3 col = uColor * core * vGlow * uOverdrive;

        // Brouillard ADDITIF : attenuer, ne pas mixer vers fogColor.
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float fogF = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          col *= 1.0 - clamp(fogF, 0.0, 1.0);
        #endif

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'moths';
  mesh.renderOrder = 6;
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  // Sphere englobante a la main : `position` n'est qu'un quad unite a l'origine.
  // Sans elle le culling ne voit que l'origine et les mites disparaissent.
  {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += aPos[i * 3]; cy += aPos[i * 3 + 1]; cz += aPos[i * 3 + 2]; }
    const inv = 1 / Math.max(n, 1);
    cx *= inv; cy *= inv; cz *= inv;
    let r = 0;
    for (let i = 0; i < n; i++) {
      r = Math.max(r, Math.hypot(aPos[i * 3] - cx, aPos[i * 3 + 1] - cy, aPos[i * 3 + 2] - cz));
    }
    const AX = 1, AZ = 0.82, AY = MOTHS.driftLift;
    const enveloppe = MOTHS.driftRadius[1] * Math.sqrt(AX * AX + AZ * AZ + AY * AY);
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(cx, cy, cz),
      r + enveloppe + MOTHS.size[1] * Math.SQRT2
    );
  }

  function update(t, phase) {
    if (!phase) return;
    const activity = mothActivity(phase);
    mesh.visible = activity > 0.01 && n > 0;
    if (!mesh.visible) return;
    uniforms.uTime.value = t;
    uniforms.uActivity.value = activity;
  }

  function dispose() {
    geo.dispose();
    material.dispose();
  }

  return { mesh, update, dispose };
}
