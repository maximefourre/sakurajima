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
import { streamFor, R, clamp } from './noise.js';
import { NOISE_GLSL } from './noise.js';
import { WIND_GLSL } from './wind.js';
import {
  AUTUMN_PALETTES,
  dominantForIndex,
  isAutumnDominant,
  MAPLE_SHAPE_GLSL,
} from './seasonal-foliage.js';

/**
 * Silhouette partagée par les deux passes (air + tapis). Deux formes sur le
 * même quad : un pétale seul (shape 0) ou la COROLLE entière à cinq pétales
 * (shape 1) — la même rosette abs(cos(2.5·theta)) que les fleurs d'arbre de
 * sakura.js, pour que ce qui vole et ce qui jonche soit la même fleur que ce
 * qui est accroché aux branches.
 */
const SAKURA_SHAPE_GLSL = /* glsl */ `
  float sakuraAlpha(vec2 p, float shape) {
    if (shape < 0.5) {
      // Un petale seul. La largeur s'effile vers la base, maximale aux deux
      // tiers ; l'echancrure du bout est le detail qui lit sakura, pas feuille.
      float y = p.y * 0.5 + 0.5;
      float w = 0.92 * sqrt(max(0.0, 1.0 - pow(abs(p.y), 1.7)));
      w *= mix(0.55, 1.0, smoothstep(0.0, 0.45, y));
      float notch = smoothstep(0.62, 1.0, y) * 0.55 * (1.0 - smoothstep(0.0, 0.42, abs(p.x)));
      float d = abs(p.x) - (w - notch);
      return 1.0 - smoothstep(-0.06, 0.03, d);
    }
    // La corolle entiere : cinq lobes en abs(cos(2.5*theta)) — exactement la
    // math du fragment blossom de sakura.js, echancrure au sommet de chaque
    // lobe comprise. Le quad fait 0.5 x 0.72 : p.y est re-normalise pour que
    // la fleur soit RONDE (diametre = largeur du quad), pas etiree a l'aspect
    // du petale.
    vec2 q = vec2(p.x, p.y * 1.44);
    float r = length(q);
    float theta = atan(q.y, q.x);
    float lob = abs(cos(2.5 * theta));
    float R = 0.52 + 0.40 * pow(lob, 0.6);
    R -= 0.14 * smoothstep(0.90, 1.0, lob);
    return 1.0 - smoothstep(R - 0.06, R + 0.03, r);
  }
`;

const AUTUMN_CARPET_MULTIPLIER = 2.5;
const AUTUMN_CARPET_DISPERSED_FRACTION = 0.34;
const CARPET_CANOPY_SPREAD = 1.12;
/** Même plafond que grass.beachY (1.6) : WORLD.beachTop + bande de dune. */
const SAND_CEILING = WORLD.beachTop + 0.4;

/** Sable émergé : trop haut pour la mer, trop bas pour l'herbe. */
export function isPetalSand(h) {
  return h > WORLD.seaLevel && h < SAND_CEILING;
}

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

export function createPetals({ seed, quality, season = 'spring', canopies = [], wind, heightAt, slopeAt = null, exclude = null, onPath = null }) {
  const mode = season === 'autumn' ? 'autumn' : 'spring';
  const autumn = mode === 'autumn';
  const COUNT = quality.petals;
  const rng = streamFor(seed, 'petals');

  // Preconvert autumn palettes once; air/carpet both sample linear triplets.
  const autumnLin = {};
  if (autumn) {
    const tmpC = new THREE.Color();
    for (const name of Object.keys(AUTUMN_PALETTES)) {
      const p = AUTUMN_PALETTES[name];
      tmpC.set(p.shadow); const sh = [tmpC.r, tmpC.g, tmpC.b];
      tmpC.set(p.mid);    const md = [tmpC.r, tmpC.g, tmpC.b];
      tmpC.set(p.sun);    const sn = [tmpC.r, tmpC.g, tmpC.b];
      autumnLin[name] = { shadow: sh, mid: md, sun: sn };
    }
  }
  function autumnColor(dominant, t, out, o) {
    const selected = isAutumnDominant(dominant) ? dominant : dominantForIndex(0, seed);
    // A fallen or airborne autumn leaf has already turned: keep green in the
    // crowns, but remap it locally for both petal passes.
    const fallenDominant = selected === 'green' ? 'yellow' : selected;
    const pal = autumnLin[fallenDominant];
    let a, b, u;
    if (t < 0.5) {
      a = pal.shadow; b = pal.mid;
      u = THREE.MathUtils.smoothstep(t, 0, 0.5);
    } else {
      a = pal.mid; b = pal.sun;
      u = THREE.MathUtils.smoothstep(t, 0.5, 1);
    }
    out[o] = a[0] + (b[0] - a[0]) * u;
    out[o + 1] = a[1] + (b[1] - a[1]) * u;
    out[o + 2] = a[2] + (b[2] - a[2]) * u;
  }

  const geo = makePetalGeometry();

  // Per-instance data, packed to keep the attribute count low.
  const aOrigin = new Float32Array(COUNT * 4); // spawn column (x, groundY, z, spawnHeight)
  const aSeedA  = new Float32Array(COUNT * 4); // phase, tumbleRate, size, lifeOffset
  const aSeedB  = new Float32Array(COUNT * 4); // spiralR, spiralRate, axisTilt, tint
  const aMode   = new Float32Array(COUNT);     // 0 = airborne, 1 = settled on ground
  const aShape  = new Float32Array(COUNT);     // 0 petal, 1 corolla, 2 maple
  const aColor  = new Float32Array(COUNT * 3); // instanced RGB (autumn maple; spring unused in frag)

  const half = WORLD.size * 0.5;
  const SETTLED_FRACTION = 0.09;

  for (let i = 0; i < COUNT; i++) {
    // Bias spawn positions toward tree canopies — petals should come FROM the
    // trees, not rain uniformly out of an invisible box.
    let x, z, canopy = null;
    if (canopies.length && rng() < 0.85) {
      canopy = canopies[(rng() * canopies.length) | 0];
      const a = rng() * Math.PI * 2;
      // Tighter than the old 1.9× spread: the horizontal launch now carries
      // petals OFF the crown, so they no longer need to be born outside it.
      const r = Math.sqrt(rng()) * (canopy.radius || 6) * 1.25;
      x = canopy.x + Math.cos(a) * r;
      z = canopy.z + Math.sin(a) * r;
    } else {
      x = R.range(rng, -half, half);
      z = R.range(rng, -half, half);
    }
    x = Math.max(-half, Math.min(half, x));
    z = Math.max(-half, Math.min(half, z));

    const groundY = heightAt ? heightAt(x, z) : 0;

    // Spawn height ABOVE this ground column, per petal. Canopy spawns start
    // inside the upper half of THEIR OWN crown (emitter y = canopy centre in
    // world space); the old global uFallHeight of 46 units is what made every
    // petal read as falling out of the sky. Ambient spawns fill the air
    // between groves at a modest height.
    let spawnH;
    if (canopy) {
      const topY = (canopy.y ?? groundY + 9) + (canopy.radius || 6) * R.range(rng, 0.1, 0.55);
      spawnH = Math.max(3.5, topY - groundY);
    } else {
      spawnH = R.range(rng, 16, 30);
    }

    aOrigin[i * 4 + 0] = x;
    aOrigin[i * 4 + 1] = groundY;
    aOrigin[i * 4 + 2] = z;
    aOrigin[i * 4 + 3] = spawnH;

    // Consume the shape draw in the same RNG order every season. Spring keeps
    // the 12 % corolla rate; autumn forces kind 2 without an extra draw.
    const flowerRoll = rng() < 0.12 ? 1 : 0;
    const flower = autumn ? 0 : flowerRoll;
    aShape[i] = autumn ? 2 : flower;

    aSeedA[i * 4 + 0] = rng() * Math.PI * 2;          // phase
    // 0.22-0.85 lisait ENCORE trop vite en jeu (trois plaintes joueur) : un
    // pétale de cerisier plane, il tourne à peine. Divisé par ~2.3.
    aSeedA[i * 4 + 1] = R.range(rng, 0.10, 0.36) * (flower ? 0.65 : 1); // tumble rate
    // Size: spring uses the validated petal/corolla skew; autumn maple leaves
    // are larger but still consume exactly one skew draw.
    if (autumn) {
      aSeedA[i * 4 + 2] = R.skew(rng, 0.18, 0.40, 1.8);
    } else {
      aSeedA[i * 4 + 2] = R.skew(rng, 0.12, 0.34, 2.0) * (flower ? 1.5 : 1);
    }
    aSeedA[i * 4 + 3] = rng();                        // lifetime offset

    aSeedB[i * 4 + 0] = R.range(rng, 0.4, 2.6);       // spiral radius
    // Divisé par 2 : l'orbite serrée à 1.1 rad/s lisait comme un tourbillon.
    aSeedB[i * 4 + 1] = R.range(rng, 0.12, 0.55);     // spiral rate
    aSeedB[i * 4 + 2] = R.range(rng, 0.15, 1.0);      // tumble axis tilt
    // Tint heavily biased to the pale end: somei yoshino blossom is nearly
    // white, with only a blush of pink. A uniform distribution reads as plastic.
    // Autumn reuses this draw as the two-segment palette phase (no extra RNG).
    aSeedB[i * 4 + 3] = R.skew(rng, 0, 1, 2.4);

    if (autumn) {
      let dom = null;
      if (canopy && isAutumnDominant(canopy.dominant)) dom = canopy.dominant;
      else dom = dominantForIndex(i, seed);
      autumnColor(dom, aSeedB[i * 4 + 3], aColor, i * 3);
    } else {
      aColor[i * 3] = 1; aColor[i * 3 + 1] = 1; aColor[i * 3 + 2] = 1;
    }

    aMode[i] = rng() < SETTLED_FRACTION ? 1 : 0;
  }

  geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(aOrigin, 4));
  geo.setAttribute('aSeedA',  new THREE.InstancedBufferAttribute(aSeedA, 4));
  geo.setAttribute('aSeedB',  new THREE.InstancedBufferAttribute(aSeedB, 4));
  geo.setAttribute('aMode',   new THREE.InstancedBufferAttribute(aMode, 1));
  geo.setAttribute('aShape',  new THREE.InstancedBufferAttribute(aShape, 1));
  geo.setAttribute('aColor',  new THREE.InstancedBufferAttribute(aColor, 3));

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uFallSpeed:   { value: 0.052 },
      uDrift:       { value: 5.2 },
      uLaunch:      { value: 6.5 },  // horizontal detach glide, world units
      uSunDir:      { value: new THREE.Vector3(0, 1, 0) },
      uSunColor:    { value: new THREE.Color(1, 1, 1) },
      uAmbient:     { value: new THREE.Color(0.4, 0.42, 0.5) },
      uGlow:        { value: 0 },   // emissive lift, peaks at golden hour
      uPaleColor:   { value: new THREE.Color('#fffafc') },
      uDeepColor:   { value: new THREE.Color('#f8ccda') },
      uAutumn:      { value: autumn ? 1 : 0 },
      uAgeColor:    { value: new THREE.Color('#6b4a2d') },
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
      attribute vec4  aOrigin;   // x, groundY, z, spawnHeight
      attribute vec4  aSeedA;   // phase, tumbleRate, size, lifeOffset
      attribute vec4  aSeedB;   // spiralR, spiralRate, axisTilt, tint
      attribute float aMode;    // 0 airborne, 1 settled
      attribute float aShape;   // 0 petal, 1 corolla, 2 maple
      attribute vec3  aColor;

      uniform float uFallSpeed;
      uniform float uDrift;
      uniform float uLaunch;

      varying vec2  vUv;
      varying vec3  vNormalW;
      varying float vTint;
      varying float vEdge;      // 1 when broadside to camera, 0 when edge-on
      varying float vShape;
      varying vec3  vColor;

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
        vShape = aShape;
        vColor = aColor;

        float phase   = aSeedA.x;
        float tumbleR = aSeedA.y;
        float size    = aSeedA.z;
        float lifeOff = aSeedA.w;
        float spiralR = aSeedB.x;
        float spiralS = aSeedB.y;
        float tilt    = aSeedB.z;

        // ── where is this petal right now ────────────────────────
        vec3 base = aOrigin.xyz;
        float spawnH = aOrigin.w;
        float gust = windGust(base);

        vec3 worldPos;
        float airborne;

        if (aMode > 0.5) {
          // SETTLED: lies on the ground until a gust lifts it, then resettles.
          // Seuil abaisse : une vraie bourrasque (gust > ~1) souleve un TAPIS
          // de petales d'un coup (consigne joueur : de temps en temps, une
          // grosse bourrasque qui remplit l'air).
          float lift = smoothstep(0.40, 1.15, gust);
          float hop  = lift * (0.6 + 1.8 * sk_noise3(vec3(base.xz * 0.3, uTime * 0.35 + phase)));
          worldPos = base + vec3(0.0, max(0.04, hop), 0.0);
          worldPos += windForce(base, uTime) * lift * (1.4 + 1.6 * smoothstep(1.0, 2.2, gust));
          airborne = lift;
        } else {
          // AIRBORNE: detach and GLIDE. A petal does not rain straight down
          // out of a tree: it leaves the crown sideways, caught by the wind,
          // and only later does gravity win. Two changes from the naive fall:
          // the vertical drop is eased (pow > 1: nearly level at first, fast
          // late), and an impulsive horizontal launch along the wind heading,
          // jittered per petal, decays over the early life.
          float life = fract(uTime * uFallSpeed + lifeOff);

          // Vertical: from THIS petal's own canopy top (aOrigin.w).
          float fallY = base.y + spawnH * (1.0 - pow(life, 1.7));

          // Launch: heading = wind rotated by a per-petal jitter of +-37 deg.
          // Displacement 1-(1-life)^3 is the integral of a decaying initial
          // velocity: fastest at the instant of detachment, spent by mid-life.
          float ja = (fract(phase * 0.6366) - 0.5) * 1.3;
          float cj = cos(ja), sj = sin(ja);
          vec2 ld = vec2(uWindDir.x * cj - uWindDir.y * sj,
                         uWindDir.x * sj + uWindDir.y * cj);
          float launch = uLaunch * (0.55 + 0.35 * spiralR) * (0.6 + 0.4 * gust)
                       * (1.0 - pow(1.0 - life, 3.0));

          // Wind carry still accumulates over the whole life on top of the
          // launch, so long-lived petals end far downwind.
          vec3 w = windForce(vec3(base.x, fallY, base.z), uTime);
          vec3 drift = vec3(ld.x, 0.0, ld.y) * launch + w * uDrift * life * (1.0 + 0.9 * smoothstep(1.0, 2.2, gust));

          // Spiral and wander fade IN over the first quarter of the life, so
          // the crown sheds a coherent stream instead of a pre-scattered cloud.
          float grow = smoothstep(0.04, 0.30, life);
          float sa = uTime * spiralS + phase;
          vec3 spiral = vec3(cos(sa) * spiralR, 0.0, sin(sa) * spiralR) * grow;
          vec3 wander = vec3(
            sk_noise3(vec3(base.xz * 0.05, uTime * 0.25 + phase)),
            0.0,
            sk_noise3(vec3(base.zx * 0.05, uTime * 0.25 + phase + 9.1))
          ) * 2.4 * grow;

          worldPos = vec3(base.x, fallY, base.z) + drift + spiral + wander;
          airborne = 1.0;
        }

        // ── tumble ───────────────────────────────────────────────
        // A precessing axis, so the petal does not spin about a fixed line.
        // The gust factor is CLAMPED: gust rides uWindStrength whose squall
        // peak is 2.6 (times the UI wind slider) — unclamped it tripled the
        // tumble in every squall and the petals spun like tops again. A gust
        // may hurry a petal a little; it must never spin it.
        float ta = uTime * tumbleR * (0.6 + min(gust, 1.0) * 0.45) + phase;
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
      uniform float uAutumn;
      uniform vec3  uAgeColor;

      varying vec2  vUv;
      varying vec3  vNormalW;
      varying float vTint;
      varying float vEdge;
      varying float vShape;
      varying vec3  vColor;

      ${SAKURA_SHAPE_GLSL}
      ${MAPLE_SHAPE_GLSL}

      #include <fog_pars_fragment>

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float alpha;
        vec3 base;

        if (uAutumn > 0.5) {
          alpha = mapleAlpha(p, vTint);
          if (alpha < 0.02) discard;
          float vein = mapleVeins(p, vTint);
          base = vColor;
          base = mix(base, base * 0.72, vein * 0.55);
          // age toward dry brown, max 45 %
          base = mix(base, uAgeColor, vTint * 0.45);
        } else {
          alpha = sakuraAlpha(p, vShape);
          if (alpha < 0.02) discard;
          base = mix(uPaleColor, uDeepColor, vTint);
          if (vShape < 0.5) {
            base = mix(base * 0.88, base, smoothstep(0.0, 0.7, p.y * 0.5 + 0.5));
          } else {
            float r = length(vec2(p.x, p.y * 1.44));
            base = mix(uDeepColor * vec3(0.98, 0.72, 0.80), base, smoothstep(0.10, 0.38, r));
          }
        }

        vec3 n = normalize(vNormalW);
        float wrap  = dot(n, uSunDir) * 0.5 + 0.5;
        float trans = pow(max(dot(-n, uSunDir), 0.0), 2.2);

        vec3 col = base * (uAmbient + uSunColor * (wrap * 0.62 + trans * 0.55));
        col += uSunColor * uGlow * 0.22 * base;

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

  /* ── fallen-petal carpet ─────────────────────────────────────────
   * A second, STATIC InstancedMesh: blossom already shed, pooled under the
   * canopies. It lives here (not details.js) because it shares the petal
   * geometry, the procedural silhouette, and the day/night lighting uniforms
   * — shared BY REFERENCE, so the one update() below lights both meshes.
   * Placement is baked once; per-frame cost is a single opaque draw call.
   * Opaque cut-out (discard, depth-write) on purpose: 40k ground quads must
   * never enter the transparent sort against the airborne pass.
   */
  let carpet = null, carpetGeo = null, carpetMat = null;
  const baseCarpetCount = (quality.fallenPetals | 0) || 0;
  const CARPET_COUNT = autumn
    ? Math.round(baseCarpetCount * AUTUMN_CARPET_MULTIPLIER)
    : baseCarpetCount;
  if (CARPET_COUNT > 0 && canopies.length) {
    const crng = streamFor(seed, 'petals.carpet');

    carpetGeo = makePetalGeometry();
    // Lay the petal flat: length into -Z, the cupped face turned UP, so a
    // slight instance tilt catches the light on the convex side.
    carpetGeo.rotateX(-Math.PI / 2);

    // Per instance: x = pink tint (same axis as airborne), y = age 0..1,
    // z = part de soleil 0..1 (0 = sous la couronne — voir le fragment).
    const aTintAge = new Float32Array(CARPET_COUNT * 3);
    carpetGeo.setAttribute('aTintAge', new THREE.InstancedBufferAttribute(aTintAge, 3));
    // 0 = pétale seul, 1 = corolle entière, 2 = maple.
    const aShapeC = new Float32Array(CARPET_COUNT);
    carpetGeo.setAttribute('aShape', new THREE.InstancedBufferAttribute(aShapeC, 1));
    const aColorC = new Float32Array(CARPET_COUNT * 3);
    carpetGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColorC, 3));

    const carpetUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
    carpetUniforms.uTime = { value: 0 };
    // (x, z, vitesse 0..1) du shiba : les petales tombes fremissent et
    // s'envolent un peu quand il passe en courant (consigne joueur).
    carpetUniforms.uPlayer = { value: new THREE.Vector3(0, 0, 0) };
    // Lighting slots shared BY REFERENCE with the airborne material.
    carpetUniforms.uSunDir   = uniforms.uSunDir;
    carpetUniforms.uSunColor = uniforms.uSunColor;
    carpetUniforms.uAmbient  = uniforms.uAmbient;
    carpetUniforms.uGlow     = uniforms.uGlow;
    // Plus rosé que les pâles aériens : au sol, sans le contre-jour qui fait
    // flasher les pétales en vol, un quasi-blanc lisait « paillettes », pas
    // « hanami » (constat écran du 29/07).
    carpetUniforms.uPaleColor = { value: new THREE.Color('#f5dfe4') };
    carpetUniforms.uDeepColor = { value: new THREE.Color('#efb3c4') };
    carpetUniforms.uAutumn = { value: autumn ? 1 : 0 };
    carpetUniforms.uAgeColor = { value: new THREE.Color('#6b4a2d') };

    carpetMat = new THREE.ShaderMaterial({
      uniforms: carpetUniforms,
      fog: true,
      side: THREE.DoubleSide,

      vertexShader: /* glsl */ `
        attribute vec3 aTintAge;
        attribute float aShape;
        attribute vec3 aColor;

        uniform float uTime;
        uniform vec3  uPlayer;

        varying vec2  vUv;
        varying vec3  vNormalW;
        varying float vTint;
        varying float vAge;
        varying float vShade;
        varying float vShape;
        varying vec3  vColor;

        #include <fog_pars_vertex>

        void main() {
          vUv   = uv;
          vTint = aTintAge.x;
          vAge  = aTintAge.y;
          vShade = aTintAge.z;
          vShape = aShape;
          vColor = aColor;

          // instanceMatrix is declared by three's prefix on any InstancedMesh.
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vNormalW = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * normal));

          // REMOUS : pres du shiba lance, les petales se soulevent et
          // s'ecartent — un sillage de course dans le tapis. uPlayer.z est la
          // vitesse normalisee : a l'arret, rien ne bouge.
          float pd = distance(wp.xz, uPlayer.xy);
          float stir = (1.0 - smoothstep(0.3, 2.8, pd)) * uPlayer.z;
          if (stir > 0.001) {
            float flut = 0.5 + 0.5 * sin(uTime * 8.0 + wp.x * 3.7 + wp.z * 2.9);
            wp.y += stir * flut * 0.85;
            vec2 away = wp.xz - uPlayer.xy;
            float al = max(length(away), 0.001);
            wp.xz += (away / al) * stir * 0.55;
          }

          // NOTE: must be named mvPosition -- the fog_vertex chunk reads it.
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;

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
        uniform float uAutumn;
        uniform vec3  uAgeColor;

        varying vec2  vUv;
        varying vec3  vNormalW;
        varying float vTint;
        varying float vAge;
        varying float vShade;
        varying float vShape;
        varying vec3  vColor;

        ${SAKURA_SHAPE_GLSL}
        ${MAPLE_SHAPE_GLSL}

        #include <fog_pars_fragment>

        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float alpha;
          vec3 base;

          if (uAutumn > 0.5) {
            alpha = mapleAlpha(p, vTint);
            // Keep the pointed lobe tips: at ground scale a 0.45 cutoff made
            // the shared maple silhouette read as an undifferentiated spot.
            if (alpha < 0.35) discard;
            float vein = mapleVeins(p, vTint);
            base = vColor;
            base = mix(base, base * 0.72, vein * 0.55);
            base = mix(base, uAgeColor, vAge * 0.45);
          } else {
            alpha = sakuraAlpha(p, vShape);
            if (alpha < 0.45) discard;
            base = mix(uPaleColor, uDeepColor, vTint);
            if (vShape < 0.5) {
              base = mix(base * 0.90, base, smoothstep(0.0, 0.7, p.y * 0.5 + 0.5));
            } else {
              float r = length(vec2(p.x, p.y * 1.44));
              base = mix(uDeepColor * vec3(0.98, 0.72, 0.80), base, smoothstep(0.10, 0.38, r));
            }
            // Age: bruise toward ivory-brown, the pink going first.
            base = mix(base, vec3(0.87, 0.80, 0.72) * (0.75 + 0.25 * base.r), vAge * 0.55);
          }

          vec3 n = normalize(vNormalW);
          float wrap = dot(n, uSunDir) * 0.5 + 0.5;
          vec3 col = base * (uAmbient * (0.75 + 0.25 * vShade)
                           + uSunColor * wrap * 0.55 * mix(0.15, 1.0, vShade));
          col += uSunColor * uGlow * 0.10 * base * vShade;

          gl_FragColor = vec4(col, 1.0);

          #include <fog_fragment>
        }
      `,
    });

    // Big crowns shed more: canopy choice weighted by crown AREA.
    const cum = new Float64Array(canopies.length);
    const carpetRadii = new Float64Array(canopies.length);
    let acc = 0;
    let maxCarpetRadius = 0;
    for (let ci = 0; ci < canopies.length; ci++) {
      const crownRadius = canopies[ci].radius || 6;
      const r = crownRadius * CARPET_CANOPY_SPREAD;
      carpetRadii[ci] = r;
      maxCarpetRadius = Math.max(maxCarpetRadius, r);
      // Preserve the established crown-area weighting exactly.
      acc += crownRadius * crownRadius;
      cum[ci] = acc;
    }
    const pickCanopyIndex = () => {
      const t = crng() * acc;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < t) lo = mid + 1; else hi = mid; }
      return lo;
    };

    // Spatial buckets make the strict "outside every crown disc" test cheap
    // even on ultra. Canopies are inserted in every cell touched by their
    // carpet disc, so a lookup of the candidate's single cell is exhaustive.
    const canopyCellSize = Math.max(1, maxCarpetRadius);
    const canopyBuckets = new Map();
    const canopyBucketKey = (ix, iz) => `${ix}:${iz}`;
    if (autumn) {
      for (let ci = 0; ci < canopies.length; ci++) {
        const c = canopies[ci];
        const r = carpetRadii[ci];
        const minX = Math.floor((c.x - r) / canopyCellSize);
        const maxX = Math.floor((c.x + r) / canopyCellSize);
        const minZ = Math.floor((c.z - r) / canopyCellSize);
        const maxZ = Math.floor((c.z + r) / canopyCellSize);
        for (let iz = minZ; iz <= maxZ; iz++) {
          for (let ix = minX; ix <= maxX; ix++) {
            const key = canopyBucketKey(ix, iz);
            let bucket = canopyBuckets.get(key);
            if (!bucket) canopyBuckets.set(key, bucket = []);
            bucket.push(ci);
          }
        }
      }
    }
    const outsideCanopyDiscs = (x, z) => {
      const ix = Math.floor(x / canopyCellSize);
      const iz = Math.floor(z / canopyCellSize);
      const bucket = canopyBuckets.get(canopyBucketKey(ix, iz));
      if (!bucket) return true;
      for (let bi = 0; bi < bucket.length; bi++) {
        const ci = bucket[bi];
        const c = canopies[ci];
        const dx = x - c.x;
        const dz = z - c.z;
        const r = carpetRadii[ci];
        if (dx * dx + dz * dz < r * r) return false;
      }
      return true;
    };

    const cMesh = new THREE.InstancedMesh(carpetGeo, carpetMat, CARPET_COUNT);
    cMesh.name = 'petal-carpet';
    cMesh.castShadow = false;
    cMesh.receiveShadow = false;   // ShaderMaterial: no shadow chunks, same as airborne
    cMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const UPV = new THREE.Vector3(0, 1, 0);
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _tq = new THREE.Quaternion();
    const _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

    let placed = 0, attempts = 0;
    let dispersedLeft = autumn
      ? Math.round(CARPET_COUNT * AUTUMN_CARPET_DISPERSED_FRACTION)
      : 0;
    while (placed < CARPET_COUNT && attempts < CARPET_COUNT * 30) {
      // One seeded decision per final instance. The shrinking quota keeps the
      // accepted carpet at exactly 34 % dispersed while randomising the order.
      // A rejected candidate retries the SAME branch and never redraws it.
      const dispersionRoll = autumn ? crng() : 1;
      const dispersed = autumn
        && dispersionRoll < dispersedLeft / (CARPET_COUNT - placed);

      let c = null, rad = 1, rr = 1, x = 0, z = 0, h = 0;
      let accepted = false;
      while (!accepted && attempts < CARPET_COUNT * 30) {
        attempts++;
        if (dispersed) {
          x = R.range(crng, -half, half);
          z = R.range(crng, -half, half);
          if (!outsideCanopyDiscs(x, z)) continue;
        } else {
          const ci = pickCanopyIndex();
          c = canopies[ci];
          rad = carpetRadii[ci];
          // pow 0.7 biases toward the trunk: dense centre thinning to a fringe.
          rr = Math.pow(crng(), 0.7) * rad;
          const a = crng() * Math.PI * 2;
          x = c.x + Math.cos(a) * rr;
          z = c.z + Math.sin(a) * rr;
        }
        if (exclude && exclude(x, z)) continue;
        h = heightAt ? heightAt(x, z) : 0;
        // Uniform candidates span the full terrain tile; sea-level rejection
        // restricts that branch to the island while exclude handles pond water.
        if (dispersed && heightAt && h <= WORLD.seaLevel) continue;
        // Plage : pas de tapis. Le perch 0.25–0.70 est calé sur l'herbe ;
        // sur le sable nu ça flotte (constat écran 12/08).
        if (isPetalSand(h)) continue;
        if (slopeAt && slopeAt(x, z) > 0.55) continue;
        accepted = true;
      }
      if (!accepted) break;

      // Random yaw, then a small tilt off the ground plane so faces vary
      // against the light instead of forming one specular sheet.
      _e.set(R.range(crng, -0.35, 0.35), 0, R.range(crng, -0.35, 0.35));
      _q.setFromAxisAngle(UPV, crng() * Math.PI * 2).multiply(_tq.setFromEuler(_e));
      // Consume the shape draw every season; autumn forces maple kind 2.
      const flowerRoll = crng() < 0.40 ? 1 : 0;
      const flower = autumn ? 0 : flowerRoll;
      // Spring: petal/corolla skew. Autumn: maple ground size, one skew draw.
      const s = autumn
        ? R.skew(crng, 0.34, 0.62, 1.6)
        : R.skew(crng, 0.18, 0.40, 1.6) * (flower ? 1.4 : 1);
      // Perchés sur le HAUT de l'herbe (~1.2 de haut) : à 0.06-0.42 ils
      // lisaient « coincés DANS l'herbe » (consigne joueur). Sur la terre
      // battue des chemins, herbe rase : posés au sol.
      const perch = (onPath && onPath(x, z)) ? R.range(crng, 0.02, 0.10)
                                             : R.range(crng, 0.25, 0.70);
      // The source petal quad is taller than it is wide. Widen autumn only so
      // the five maple lobes retain their recognisable fan on the ground.
      _m.compose(_p.set(x, h + perch, z), _q, _s.set(autumn ? s * 1.28 : s, s, s));
      cMesh.setMatrixAt(placed, _m);
      aShapeC[placed] = autumn ? 2 : flower;

      // The fringe fell first: older (browner, duller) toward the disc edge.
      // Skew 1.7 (était 2.4) : plus de roses moyens, moins de quasi-blancs.
      // Autumn reuses aTintAge.x as the palette phase (no extra RNG).
      const edge = dispersed ? 1 : rr / rad;
      aTintAge[placed * 3 + 0] = R.skew(crng, 0, 1, 1.7);
      aTintAge[placed * 3 + 1] = clamp(edge * 0.6 + crng() * 0.45, 0, 1);
      // Part de soleil : l'intérieur du disque est sous la couronne, la
      // lisière au soleil ; le jitter fait la lumière tachetée des trouées.
      const st = clamp((edge - 0.72) / 0.30, 0, 1);
      aTintAge[placed * 3 + 2] = clamp(st * st * (3 - 2 * st) + (crng() - 0.5) * 0.3, 0, 1);

      if (autumn) {
        let dom = null;
        if (c && isAutumnDominant(c.dominant)) dom = c.dominant;
        else dom = dominantForIndex(placed, seed);
        autumnColor(dom, aTintAge[placed * 3 + 0], aColorC, placed * 3);
      } else {
        aColorC[placed * 3] = 1;
        aColorC[placed * 3 + 1] = 1;
        aColorC[placed * 3 + 2] = 1;
      }
      if (dispersed) dispersedLeft--;
      placed++;
    }
    cMesh.count = placed;
    cMesh.instanceMatrix.needsUpdate = true;
    cMesh.computeBoundingSphere();   // InstancedMesh version unions instances
    carpet = cMesh;
  }

  const _sun = new THREE.Vector3();

  function setPlayer(x, z, speedN) {
    if (carpetMat) carpetMat.uniforms.uPlayer.value.set(x, z, speedN);
  }

  function update(t, phase) {
    if (carpetMat) carpetMat.uniforms.uTime.value = t;
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
    carpetGeo?.dispose();
    carpetMat?.dispose();
    carpet?.dispose();
  }

  return {
    mesh, carpet, update, setPlayer, dispose,
    count: COUNT,
    carpetCount: carpet ? carpet.count : 0,
    season: mode,
    kind: autumn ? 'maple' : 'sakura',
  };
}
