/**
 * petals.js — falling cherry blossom petals.
 *
 * All motion happens in the vertex shader. The CPU sets one uniform per frame
 * (the time) and touches nothing else, so 12 000 petals cost one draw call and
 * essentially zero JS.
 *
 * What separates petals from snow — the four things that had to be right:
 *
 *  1. TUMBLE. A petal is a thin curved membrane. It spins about a slowly
 *     precessing axis, so it repeatedly turns edge-on and momentarily almost
 *     vanishes, then flashes broadside and catches the light. That flicker is
 *     the single most recognisable thing about falling blossom. Snow does not
 *     do it, and neither does a billboarded sprite.
 *  2. NON-VERTICAL FALL. Terminal velocity is low and lateral drift dominates,
 *     so petals travel much further sideways than down.
 *  3. PHASE DECORRELATION. Every petal gets its own tumble rate, axis, spiral
 *     radius and lifetime offset. Any shared frequency reads instantly as a
 *     particle system.
 *  4. GUST RESPONSE. Petals ride the same gust train as the grass, so when a
 *     squall crosses the island you see the blossom surge with it, and during
 *     a lull they drift almost straight down.
 *
 * A fraction of the population is SETTLED on the ground and only lifts when a
 * gust passes overhead, then resettles. That reciprocity — ground going airborne
 * and back — is what makes the island feel windy rather than merely animated.
 */

import * as THREE from 'three';
import { WORLD } from './config.js';
import { streamFor, R } from './noise.js';
import { NOISE_GLSL } from './noise.js';
import { WIND_GLSL } from './wind.js';

/** One petal: a small quad, bent along its length so it is never perfectly flat. */
function makePetalGeometry() {
  const W = 0.5, H = 0.72, SEG = 3;
  const g = new THREE.PlaneGeometry(W, H, SEG, SEG);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Cup the petal: curl the long edges toward the viewer and lift the tip.
    const curl = (v.x / (W * 0.5)) ** 2 * 0.11;
    const arch = Math.cos((v.y / (H * 0.5)) * 0.9) * 0.06;
    pos.setZ(i, curl + arch);
  }
  g.computeVertexNormals();
  return g;
}

export function createPetals({ seed, quality, canopies = [], wind, heightAt }) {
  const COUNT = quality.petals;
  const rng = streamFor(seed, 'petals');

  const geo = makePetalGeometry();

  // Per-instance data, packed to keep the attribute count low.
  const aOrigin = new Float32Array(COUNT * 3); // spawn column (x, groundY, z)
  const aSeedA  = new Float32Array(COUNT * 4); // phase, tumbleRate, size, lifeOffset
  const aSeedB  = new Float32Array(COUNT * 4); // spiralR, spiralRate, axisTilt, tint
  const aMode   = new Float32Array(COUNT);     // 0 = airborne, 1 = settled on ground

  const half = WORLD.size * 0.5;
  const SETTLED_FRACTION = 0.09;

  for (let i = 0; i < COUNT; i++) {
    // Bias spawn positions toward tree canopies — petals should come FROM the
    // trees, not rain uniformly out of an invisible box.
    let x, z;
    if (canopies.length && rng() < 0.78) {
      const c = canopies[(rng() * canopies.length) | 0];
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * (c.radius || 6) * 1.9;
      x = c.x + Math.cos(a) * r;
      z = c.z + Math.sin(a) * r;
    } else {
      x = R.range(rng, -half, half);
      z = R.range(rng, -half, half);
    }
    x = Math.max(-half, Math.min(half, x));
    z = Math.max(-half, Math.min(half, z));

    const groundY = heightAt ? heightAt(x, z) : 0;

    aOrigin[i * 3 + 0] = x;
    aOrigin[i * 3 + 1] = groundY;
    aOrigin[i * 3 + 2] = z;

    aSeedA[i * 4 + 0] = rng() * Math.PI * 2;          // phase
    aSeedA[i * 4 + 1] = R.range(rng, 0.7, 2.4);       // tumble rate
    // Size: a real petal is ~1.5cm. Rendering it at true scale makes it
    // invisible past a few metres, so this is deliberately exaggerated — but
    // only to roughly 10-25cm. Any larger and they read as confetti, not blossom.
    aSeedA[i * 4 + 2] = R.skew(rng, 0.18, 0.5, 2.0);
    aSeedA[i * 4 + 3] = rng();                        // lifetime offset

    aSeedB[i * 4 + 0] = R.range(rng, 0.4, 2.6);       // spiral radius
    aSeedB[i * 4 + 1] = R.range(rng, 0.25, 1.1);      // spiral rate
    aSeedB[i * 4 + 2] = R.range(rng, 0.15, 1.0);      // tumble axis tilt
    // Tint heavily biased to the pale end: somei yoshino blossom is nearly
    // white, with only a blush of pink. A uniform distribution reads as plastic.
    aSeedB[i * 4 + 3] = R.skew(rng, 0, 1, 2.4);

    aMode[i] = rng() < SETTLED_FRACTION ? 1 : 0;
  }

  geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(aOrigin, 3));
  geo.setAttribute('aSeedA',  new THREE.InstancedBufferAttribute(aSeedA, 4));
  geo.setAttribute('aSeedB',  new THREE.InstancedBufferAttribute(aSeedB, 4));
  geo.setAttribute('aMode',   new THREE.InstancedBufferAttribute(aMode, 1));

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uFallHeight:  { value: 46 },
      uFallSpeed:   { value: 0.052 },
      uDrift:       { value: 5.2 },
      uSunDir:      { value: new THREE.Vector3(0, 1, 0) },
      uSunColor:    { value: new THREE.Color(1, 1, 1) },
      uAmbient:     { value: new THREE.Color(0.4, 0.42, 0.5) },
      uGlow:        { value: 0 },   // emissive lift, peaks at golden hour
      uPaleColor:   { value: new THREE.Color('#fffafc') },
      uDeepColor:   { value: new THREE.Color('#f8ccda') },
    },
  ]);
  // UniformsUtils.merge clones values, so re-attach the shared wind uniforms BY
  // REFERENCE — that is what keeps every material in the scene on one wind.
  Object.assign(uniforms, wind.uniforms);

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,

    vertexShader: /* glsl */ `
      attribute vec3  aOrigin;
      attribute vec4  aSeedA;   // phase, tumbleRate, size, lifeOffset
      attribute vec4  aSeedB;   // spiralR, spiralRate, axisTilt, tint
      attribute float aMode;    // 0 airborne, 1 settled

      uniform float uFallHeight;
      uniform float uFallSpeed;
      uniform float uDrift;

      varying vec2  vUv;
      varying vec3  vNormalW;
      varying float vTint;
      varying float vEdge;      // 1 when broadside to camera, 0 when edge-on

      ${NOISE_GLSL}
      ${WIND_GLSL}

      #include <fog_pars_vertex>

      mat3 axisAngle(vec3 axis, float a) {
        float c = cos(a), s = sin(a), t = 1.0 - c;
        axis = normalize(axis);
        return mat3(
          t*axis.x*axis.x + c,        t*axis.x*axis.y - s*axis.z, t*axis.x*axis.z + s*axis.y,
          t*axis.x*axis.y + s*axis.z, t*axis.y*axis.y + c,        t*axis.y*axis.z - s*axis.x,
          t*axis.x*axis.z - s*axis.y, t*axis.y*axis.z + s*axis.x, t*axis.z*axis.z + c
        );
      }

      void main() {
        vUv   = uv;
        vTint = aSeedB.w;

        float phase   = aSeedA.x;
        float tumbleR = aSeedA.y;
        float size    = aSeedA.z;
        float lifeOff = aSeedA.w;
        float spiralR = aSeedB.x;
        float spiralS = aSeedB.y;
        float tilt    = aSeedB.z;

        // ── where is this petal right now ────────────────────────
        vec3 base = aOrigin;
        float gust = windGust(base);

        vec3 worldPos;
        float airborne;

        if (aMode > 0.5) {
          // SETTLED: lies on the ground until a gust lifts it, then resettles.
          float lift = smoothstep(0.55, 1.6, gust);
          float hop  = lift * (0.6 + 1.8 * sk_noise3(vec3(base.xz * 0.3, uTime * 0.7 + phase)));
          worldPos = base + vec3(0.0, max(0.04, hop), 0.0);
          worldPos += windForce(base, uTime) * lift * 1.4;
          airborne = lift;
        } else {
          // AIRBORNE: fall on a looping lifetime, drifting with the wind.
          float life = fract(uTime * uFallSpeed + lifeOff);
          float fallY = base.y + uFallHeight * (1.0 - life);

          // Lateral travel accumulates over the petal's life — a petal that has
          // been falling longer has been carried further downwind.
          vec3 w = windForce(vec3(base.x, fallY, base.z), uTime);
          vec3 drift = w * uDrift * life;

          // Lazy spiral, decorrelated per petal.
          float sa = uTime * spiralS + phase;
          vec3 spiral = vec3(cos(sa) * spiralR, 0.0, sin(sa) * spiralR);

          // Gentle wander so the column never reads as a straight line.
          vec3 wander = vec3(
            sk_noise3(vec3(base.xz * 0.05, uTime * 0.25 + phase)),
            0.0,
            sk_noise3(vec3(base.zx * 0.05, uTime * 0.25 + phase + 9.1))
          ) * 2.4;

          worldPos = vec3(base.x, fallY, base.z) + drift + spiral + wander;
          airborne = 1.0;
        }

        // ── tumble ───────────────────────────────────────────────
        // A precessing axis, so the petal does not spin about a fixed line.
        float ta = uTime * tumbleR * (0.6 + gust * 0.9) + phase;
        vec3 axis = normalize(vec3(
          sin(ta * 0.37 + phase) * tilt,
          1.0,
          cos(ta * 0.29 + phase * 1.7) * tilt
        ));
        mat3 rot = axisAngle(axis, ta);

        vec3 local = rot * (position * size * mix(0.55, 1.0, airborne));
        vec3 nrm   = rot * normal;

        // NOTE: this MUST be named mvPosition -- three's <fog_vertex> chunk
        // references that exact identifier, so renaming it breaks compilation.
        // (And no backticks in this comment: we are inside a JS template literal.)
        vec4 mvPosition = modelViewMatrix * vec4(worldPos + local, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        vNormalW = normalize(mat3(modelMatrix) * nrm);

        // How broadside are we? Drives the edge-on near-disappearance.
        vec3 toCam = normalize((viewMatrix * vec4(worldPos, 1.0)).xyz * -1.0);
        vEdge = abs(dot(normalize((viewMatrix * vec4(vNormalW, 0.0)).xyz), toCam));

        #include <fog_vertex>
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3  uSunDir;
      uniform vec3  uSunColor;
      uniform vec3  uAmbient;
      uniform float uGlow;
      uniform vec3  uPaleColor;
      uniform vec3  uDeepColor;

      varying vec2  vUv;
      varying vec3  vNormalW;
      varying float vTint;
      varying float vEdge;

      #include <fog_pars_fragment>

      void main() {
        // ── petal silhouette, drawn procedurally: no texture, crisp at any zoom ──
        vec2 p = vUv * 2.0 - 1.0;

        // Width tapers toward the base, widest about two thirds up.
        float y = p.y * 0.5 + 0.5;                       // 0 base -> 1 tip
        float w = 0.92 * sqrt(max(0.0, 1.0 - pow(abs(p.y), 1.7)));
        w *= mix(0.55, 1.0, smoothstep(0.0, 0.45, y));

        // The notch at the tip — the detail that reads as "sakura" and not "leaf".
        float notch = smoothstep(0.62, 1.0, y) * 0.55 * (1.0 - smoothstep(0.0, 0.42, abs(p.x)));
        float d = abs(p.x) - (w - notch);
        float alpha = 1.0 - smoothstep(-0.06, 0.03, d);
        if (alpha < 0.02) discard;

        // ── colour ────────────────────────────────────────────────
        vec3 base = mix(uPaleColor, uDeepColor, vTint);
        // Slightly deeper toward the base of the petal, like the real flower.
        base = mix(base * 0.88, base, smoothstep(0.0, 0.7, y));

        // A petal is a thin membrane, not an opaque solid. Straight Lambert is
        // wrong for it: the shadowed side of a real petal stays pale because
        // light scatters through, whereas Lambert drives it to brown mud.
        // Half-Lambert (wrap lighting) keeps the terminator soft and the dark
        // side luminous, which is what actually reads as "petal".
        vec3 n = normalize(vNormalW);
        float wrap  = dot(n, uSunDir) * 0.5 + 0.5;
        float trans = pow(max(dot(-n, uSunDir), 0.0), 2.2);

        vec3 col = base * (uAmbient + uSunColor * (wrap * 0.62 + trans * 0.55));
        col += uSunColor * uGlow * 0.22 * base;

        // Edge-on petals nearly vanish; broadside petals catch the light.
        // The overall alpha stays under 1 so they read as translucent tissue.
        alpha *= mix(0.10, 0.88, pow(vEdge, 0.55));

        gl_FragColor = vec4(col, alpha);

        #include <fog_fragment>
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geo, material, COUNT);
  mesh.frustumCulled = false;           // instances span the whole island
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.renderOrder = 5;

  // Every instance sits at the origin; the vertex shader does the placing.
  const identity = new THREE.Matrix4();
  for (let i = 0; i < COUNT; i++) mesh.setMatrixAt(i, identity);
  mesh.instanceMatrix.needsUpdate = true;

  const _sun = new THREE.Vector3();

  function update(t, phase) {
    // Wind uniforms are shared by reference and already updated by wind.update().
    if (!phase) return;
    // keyDir/keyColor resolve to sun by day and moon by night, so petals stay
    // lit after sunset instead of going flat black.
    const dir = phase.keyDir || phase.sunDirection;
    const col = phase.keyColor || phase.sunColor;
    if (dir) uniforms.uSunDir.value.copy(dir);
    if (col) {
      const k = phase.keyIntensity ?? 1;
      uniforms.uSunColor.value.setRGB(col.r * k, col.g * k, col.b * k);
    }
    const amb = phase.skyColor || phase.ambientColor;
    if (amb) {
      const a = phase.ambient ?? 1;
      uniforms.uAmbient.value.setRGB(amb.r * a, amb.g * a, amb.b * a);
    }
    // `emissive` is the sky module's own "how much should things glow" weight,
    // which peaks through golden hour and night.
    uniforms.uGlow.value = phase.emissive ?? phase.golden ?? 0;
  }

  function dispose() {
    geo.dispose();
    material.dispose();
    mesh.dispose();
  }

  return { mesh, update, dispose, count: COUNT };
}
