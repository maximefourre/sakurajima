/**
 * clouds.js — near cumulus, with parallax and volume.
 *
 * sky.js already paints a cloud layer onto the Preetham dome. That layer is at
 * infinity: it has no parallax, so it cannot tell you how far away anything is,
 * and no volume, so it cannot be lit. It is scenery. This module is the other
 * half — actual masses of air sitting between the camera and the horizon, close
 * enough that orbiting the island slides them across the dome behind them.
 *
 * The division of labour is deliberate and the two layers are tuned to meet:
 * this field fades out a little past the camera's own orbit envelope (see
 * FADE_FAR below — derived from CAMERA.maxDistance), which is exactly the band
 * of sky where the painted layer takes over. You never see the seam because
 * the near field is thinning into haze right where the far one begins.
 *
 * WHY BILLBOARD CLUSTERS AND NOT A RAYMARCH. A raymarched density field is the
 * obvious modern answer and it is the wrong one here. To read as cumulus at this
 * scale it needs enough steps that the cost lands in the hundreds of millions of
 * texture-free noise evaluations per frame, and the whole module has a budget of
 * about 8 draw calls. Clusters of camera-facing impostor spheres get the same
 * three things a raymarch gets you — a lit top, a dark flat base, and a silvered
 * rim — for ~700 quads and one draw call. What makes them read as solid rather
 * than as stickers is not the silhouette, it is that each fragment reconstructs a
 * SPHERE normal from its position in the quad and then blends that with the
 * puff's outward direction inside its cluster. The billboard shades like a lump,
 * and the cluster shades like a mass.
 *
 * The other half of the volume illusion is multiple scattering: light entering a
 * cloud is absorbed on the way in, so the buried centre of a cluster is much
 * darker than its shell. Puffs carry a baked "how buried am I" weight and darken
 * by it. Without that, a cluster is uniformly bright and looks like foam.
 *
 * DRIFT. Clouds ride the shared wind, but they have enormous inertia — a squall
 * that veers 120 degrees in two seconds must not spin the sky. So the heading is
 * integrated on the CPU through a 45-second time constant and the accumulated
 * offset goes to the GPU as a single vec2. That also makes recycling free: the
 * shader wraps each CLUSTER (never the individual puff, which would tear a cloud
 * in half at the seam) into the field, so a cloud leaving downwind reappears
 * upwind with no allocation and no bookkeeping.
 */

import * as THREE from 'three';
import { CAMERA } from './config.js';
import { streamFor, R, noise2, clamp } from './noise.js';

/* Field extent, DERIVED from the camera envelope: the radial fade (measured
 * from the world origin) must complete beyond the farthest orbit position, or
 * a fully zoomed-out camera sits at the edge of a field that has already faded
 * to nothing around it. The old constants equalled maxDistance exactly — a
 * margin that existed only in the comment. */
const FIELD_HALF = Math.round(CAMERA.maxDistance * 1.18);
const FADE_NEAR = Math.round(CAMERA.maxDistance * 0.82);
const FADE_FAR = Math.round(CAMERA.maxDistance * 1.08);
export { FIELD_HALF }; // asserted by test/invariants.html

/* Cumulus condensation level: most of the deck shares a base height, because
 * real cumulus do — they all condense at the same altitude. A quarter of the
 * population is parked much higher purely to give the sky depth. Raised with
 * the bigger island so the deck doesn't sit on the ridge like a lid. */
const DECK_LOW = [150, 230];
const DECK_HIGH = [280, 420];

const CLUSTER_W = [80, 190]; // horizontal half-span of a cluster
const CLUSTER_H = [30, 72];  // vertical extent above its base

/* Drift, world units per second. The low end is a lull, the high end a squall.
 * At 7 u/s a cloud crosses the visible field in about four minutes, which is
 * fast enough to see and slow enough not to look like weather on fast-forward. */
const SPEED_CALM = 2.6;
const SPEED_GUST = 9.0;
const HEADING_TAU = 45;  // seconds — clouds must not snap around when wind veers
const SPEED_TAU = 12;

/* Shape morph rate. Everything downstream is a multiple of this, so one number
 * takes the whole sky from "rigid props sliding by" to "boiling". */
const MORPH = 0.06;

/**
 * main.js hands the clouds the RAW phase, not the normalised copy the other
 * hand-written shaders get, so the DirectionalLight intensity has to be brought
 * down to a shader multiplier here. Must match SHADER_LIGHT_SCALE in main.js.
 */
const SHADER_LIGHT_SCALE = 0.26;

/* Coverage across the day. A clear noon and a heavy evening: the sky should have
 * something for the low sun to set fire to by the time it gets there. */
const K_COVERAGE = [
  [0.00, 0.42], [0.20, 0.55], [0.25, 0.62], [0.34, 0.44], [0.46, 0.30],
  [0.58, 0.42], [0.68, 0.66], [0.75, 0.78], [0.85, 0.62], [1.00, 0.42],
];

/* Indexed rather than destructured on purpose: `const [a, va] = keys[i]` runs the
 * array iterator protocol, which allocates, and this is called from update(). */
function track(keys, u) {
  let i = 0;
  while (i < keys.length - 2 && u >= keys[i + 1][0]) i++;
  const ka = keys[i], kb = keys[i + 1];
  const a = ka[0], va = ka[1], b = kb[0], vb = kb[1];
  const t = b === a ? 0 : (u - a) / (b - a);
  return va + (vb - va) * clamp(t, 0, 1);
}

const TAU = Math.PI * 2;
const wrap = (v, span) => v - span * Math.floor(v / span);

/* The layout grid is given explicitly rather than derived from a count, because
 * a partly-filled last row leaves a bald stripe of sky that the drift then
 * parades past the camera. Even the ultra tier is only ~700 quads: the module's
 * real cost is fill rate, not geometry, so the count is set by how full the sky
 * should look and not by the triangle budget. */
// Counts sized against the DERIVED field above: its area grew ~1.4x when the
// margin became real, so each tier gained a row/column to hold the density.
const TIERS = {
  low:   { cols: 5, rows: 3, puffs: 9 },
  high:  { cols: 5, rows: 5, puffs: 14 },
  ultra: { cols: 8, rows: 7, puffs: 18 },
};

/**
 * One cumulus: a flat base row of wide, squashed puffs with a cauliflower dome
 * stacked on top. Building the base separately from the dome is what gives the
 * cloud a defined underside — a cloud grown as an isotropic blob of spheres has
 * no bottom and reads as a cotton ball.
 */
function buildCluster(rng, puffTarget) {
  const w = R.range(rng, CLUSTER_W[0], CLUSTER_W[1]);
  const h = R.range(rng, CLUSTER_H[0], CLUSTER_H[1]);
  const squash = R.range(rng, 0.62, 1.0); // elongate the mass along one axis
  const n = Math.max(5, Math.round(puffTarget * (0.62 + 0.7 * (w - CLUSTER_W[0]) / (CLUSTER_W[1] - CLUSTER_W[0]))));

  const puffs = [];
  const baseN = R.int(rng, 3, 5);
  for (let i = 0; i < baseN; i++) {
    const a = (i / baseN) * TAU + R.range(rng, -0.45, 0.45);
    const rr = R.range(rng, 0.18, 0.72) * w;
    puffs.push({
      x: Math.cos(a) * rr,
      y: R.range(rng, -2.5, 3.5),
      z: Math.sin(a) * rr * squash,
      r: R.range(rng, 0.34, 0.50) * w,
      aspect: R.range(rng, 0.50, 0.68),
    });
  }
  for (let i = baseN; i < n; i++) {
    // Bias the dome toward the lower half: a cumulus is widest well below its
    // top, and sampling the ellipsoid uniformly gives a mushroom instead.
    const t = Math.pow(rng(), 1.35);
    const y = t * h;
    const shell = Math.sqrt(Math.max(0, 1 - t * t));
    const a = rng() * TAU;
    const rr = Math.sqrt(rng()) * w * shell * 0.95;
    puffs.push({
      x: Math.cos(a) * rr,
      y: y + R.range(rng, -2, 2),
      z: Math.sin(a) * rr * squash,
      r: R.range(rng, 0.17, 0.34) * w * (0.55 + 0.65 * shell),
      aspect: R.range(rng, 0.76, 1.0),
    });
  }

  // Give the whole mass a yaw so the squash axis is not the same on every cloud.
  const yaw = rng() * TAU, cy = Math.cos(yaw), sy = Math.sin(yaw);
  let lo = Infinity, hi = -Infinity;
  for (const p of puffs) {
    const px = p.x * cy - p.z * sy;
    p.z = p.x * sy + p.z * cy;
    p.x = px;
    lo = Math.min(lo, p.y);
    hi = Math.max(hi, p.y);
  }

  // How buried is each puff? Central AND low is the darkest place in a cumulus,
  // because that is where the light path through the mass is longest.
  const span = Math.max(1e-3, hi - lo);
  for (const p of puffs) {
    const d = Math.hypot(p.x, p.z) / w;
    p.vert = clamp((p.y - lo) / span, 0, 1);
    p.core = clamp(1 - d, 0, 1) * (1 - 0.45 * p.vert);
  }

  return { w, h, puffs };
}

export function createClouds({ seed, wind, quality }) {
  const tier = TIERS[quality?.label] ?? TIERS.ultra;
  const rng = streamFor(seed, 'clouds');

  /* ── layout ───────────────────────────────────────────────────
   * Cluster centres go on a jittered grid rather than pure rejection sampling:
   * a handful of clouds scattered by uniform random reliably produces one bare
   * quadrant and one clump, and both read as a bug. */
  const cols = tier.cols, rows = tier.rows;
  const NC = cols * rows;
  const cellX = (FIELD_HALF * 2) / cols;
  const cellZ = (FIELD_HALF * 2) / rows;

  const clusters = [];
  for (let i = 0; i < NC; i++) {
    const gx = i % cols, gz = (i / cols) | 0;
    const c = buildCluster(rng, tier.puffs);
    c.x = -FIELD_HALF + (gx + 0.5) * cellX + R.range(rng, -0.42, 0.42) * cellX;
    c.z = -FIELD_HALF + (gz + 0.5) * cellZ + R.range(rng, -0.42, 0.42) * cellZ;
    const deck = rng() < 0.74 ? DECK_LOW : DECK_HIGH;
    c.y = R.range(rng, deck[0], deck[1]);
    // Rank decides the order clouds appear as coverage rises, and it is
    // correlated with size on purpose: noon gets a few small fair-weather
    // puffs, evening gets the towering masses.
    const sizeN = (c.w - CLUSTER_W[0]) / (CLUSTER_W[1] - CLUSTER_W[0]);
    c.rank = clamp(0.62 * sizeN + 0.38 * rng(), 0.02, 0.98);
    clusters.push(c);
  }

  let QUADS = 0;
  for (const c of clusters) QUADS += c.puffs.length;
  const VERTS = QUADS * 4;

  /* ── geometry ─────────────────────────────────────────────────
   * Not an InstancedMesh: instances cannot be reordered, and these quads have to
   * be re-sorted back-to-front every frame or the darkened cores composite over
   * their own shells and the clusters strobe as the camera orbits. Four verts
   * per quad plus a dynamic index buffer buys that sort for one draw call. */
  const positions = new Float32Array(VERTS * 3);
  const aCloud = new Float32Array(VERTS * 4); // baseX, baseZ, baseY, rank
  const aPuff  = new Float32Array(VERTS * 4); // offX, offY, offZ, radius
  const aShade = new Float32Array(VERTS * 4); // core, vert, seed, aspect

  // CPU twins of the per-quad data, for the depth sort.
  const qCloud = new Int32Array(QUADS);
  const qOffX = new Float32Array(QUADS);
  const qOffY = new Float32Array(QUADS);
  const qOffZ = new Float32Array(QUADS);
  const qSeed = new Float32Array(QUADS);
  const cBaseX = new Float32Array(NC);
  const cBaseZ = new Float32Array(NC);
  const cBaseY = new Float32Array(NC);
  const cRank = new Float32Array(NC);

  const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];

  let q = 0;
  for (let ci = 0; ci < NC; ci++) {
    const c = clusters[ci];
    cBaseX[ci] = c.x; cBaseZ[ci] = c.z; cBaseY[ci] = c.y; cRank[ci] = c.rank;
    for (const p of c.puffs) {
      const s = rng();
      qCloud[q] = ci; qOffX[q] = p.x; qOffY[q] = p.y; qOffZ[q] = p.z; qSeed[q] = s;
      for (let v = 0; v < 4; v++) {
        const i = q * 4 + v;
        positions[i * 3 + 0] = CORNERS[v * 2];
        positions[i * 3 + 1] = CORNERS[v * 2 + 1];
        positions[i * 3 + 2] = 0;
        aCloud[i * 4 + 0] = c.x; aCloud[i * 4 + 1] = c.z;
        aCloud[i * 4 + 2] = c.y; aCloud[i * 4 + 3] = c.rank;
        aPuff[i * 4 + 0] = p.x; aPuff[i * 4 + 1] = p.y;
        aPuff[i * 4 + 2] = p.z; aPuff[i * 4 + 3] = p.r;
        aShade[i * 4 + 0] = p.core; aShade[i * 4 + 1] = p.vert;
        aShade[i * 4 + 2] = s; aShade[i * 4 + 3] = p.aspect;
      }
      q++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aCloud', new THREE.BufferAttribute(aCloud, 4));
  geo.setAttribute('aPuff', new THREE.BufferAttribute(aPuff, 4));
  geo.setAttribute('aShade', new THREE.BufferAttribute(aShade, 4));

  const indices = new Uint32Array(QUADS * 6);
  const indexAttr = new THREE.BufferAttribute(indices, 1);
  indexAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setIndex(indexAttr);

  /* ── material ─────────────────────────────────────────────── */
  const uniforms = {
    uDrift:     { value: new THREE.Vector2() },
    uFieldHalf: { value: FIELD_HALF },
    uFadeNear:  { value: FADE_NEAR },
    uFadeFar:   { value: FADE_FAR },
    uCoverage:  { value: 0.45 },
    uMorph:     { value: MORPH },
    uOpacity:   { value: 0.94 },

    uKeyDir:    { value: new THREE.Vector3(0, 1, 0) },
    uKeyColor:  { value: new THREE.Color(1, 1, 1) },
    uAmbSky:    { value: new THREE.Color(0.45, 0.58, 0.8) },
    uAmbGround: { value: new THREE.Color(0.2, 0.22, 0.14) },
    uMoonColor: { value: new THREE.Color(0.56, 0.66, 0.86) },
    uFogColor:  { value: new THREE.Color(0.8, 0.86, 0.95) },
    uHaze:      { value: 0.00040 },
    uNight:     { value: 0 },
    uGolden:    { value: 0 },
    uTwilight:  { value: 0 },
  };
  // Share the clock BY REFERENCE with wind.js. The drift itself is integrated on
  // the CPU (inertia needs history, which a stateless noise field cannot give
  // you), so this is the only wind uniform the shader wants — but it has to be
  // the same one, or the clouds morph on a clock of their own.
  uniforms.uTime = wind.uniforms.uTime;

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    // Without this three renders every transparent DoubleSide object TWICE (a
    // BackSide pass then a FrontSide pass) and flips material.needsUpdate before
    // each one, so the program parameters are recomputed every single frame. The
    // quads are flat and always face the camera, so the second pass draws
    // nothing anyway: it is a wasted draw call and a wasted recompile.
    forceSinglePass: true,
    blending: THREE.NormalBlending,

    vertexShader: /* glsl */ `
      attribute vec4 aCloud;   // baseX, baseZ, baseY, rank
      attribute vec4 aPuff;    // offX, offY, offZ, radius
      attribute vec4 aShade;   // core, vert, seed, aspect

      uniform float uTime;
      uniform vec2  uDrift;
      uniform float uFieldHalf;
      uniform float uFadeNear;
      uniform float uFadeFar;
      uniform float uCoverage;
      uniform float uMorph;

      varying vec2 vP;
      varying vec3 vWorld;
      varying vec3 vClusterN;
      varying vec4 vShade;     // core, vert, seed, alphaScale

      void main() {
        float span = uFieldHalf * 2.0;
        // Wrap the CLUSTER, never the puff. Wrapping per puff tears a cloud in
        // half the instant its centre crosses the seam.
        vec2 c = mod(aCloud.xy + uDrift + uFieldHalf, span) - uFieldHalf;

        // Coverage gate. Clouds shrink as they dissolve rather than only fading,
        // because a cloud that fades at full size reads as a broken alpha value.
        // The scale has to hit the puff OFFSETS as well as the radii: shrinking
        // radii alone leaves the cluster at full extent and it falls apart into
        // a constellation of separate dots on its way out.
        float vis  = 1.0 - smoothstep(uCoverage - 0.08, uCoverage + 0.08, aCloud.w);
        float grow = vis * vis * (3.0 - 2.0 * vis);

        float ph = aShade.z * 6.2831853;
        float tt = uTime * uMorph;

        // The mass turns slowly on its own axis while individual puffs breathe
        // and bob out of phase. That decorrelation is the entire shape-change
        // budget, and it costs four sines per vertex.
        float ang = tt * 0.55 + aCloud.w * 3.1;
        float ca = cos(ang), sa = sin(ang);
        vec3 off = aPuff.xyz;
        off.xz = vec2(off.x * ca - off.z * sa, off.x * sa + off.z * ca);
        off *= (1.0 + 0.13 * sin(tt * 2.7 + ph)) * grow;
        off.y += 2.4 * sin(tt * 1.9 + ph * 1.7);

        float radius = aPuff.w * (1.0 + 0.20 * sin(tt * 3.3 + ph * 2.3)) * grow;

        vec3 centre = vec3(c.x, aCloud.z, c.y);
        vec3 wp = centre + off;

        // Outward direction inside the cluster, biased upward so a puff sitting
        // dead centre still presents a lit top instead of shading flat.
        vClusterN = normalize(off + vec3(0.0, aPuff.w * 0.45, 0.0) + 1e-4);

        // Camera basis, read out of the view matrix rows (its transpose maps
        // view space back to world). transpose() is GLSL ES 3.00 only, so it is
        // unpacked by hand.
        vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

        vec3 world = wp
          + camR * (position.x * radius)
          + camU * (position.y * radius * aShade.w);

        // Thin the field out toward its edge so nothing pops at the wrap seam.
        // This is also the handover to the painted dome layer in sky.js.
        float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, length(centre.xz));

        // The field is a square but the fade is radial, so the corners of the
        // wrap region are always fully transparent -- about a quarter of the
        // clusters. Left alone they still rasterise full-size quads that the
        // fragment stage discards one pixel at a time, and at 1440p that is the
        // single biggest fill-rate cost in the module. Clip them in the vertex
        // stage instead (z > w is outside the clip volume).
        if (fade <= 0.0) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          return;
        }

        vP = position.xy;
        vWorld = world;
        vShade = vec4(aShade.x, aShade.y, aShade.z, fade * (0.38 + 0.62 * vis));

        gl_Position = projectionMatrix * (viewMatrix * vec4(world, 1.0));
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3  uKeyDir;
      uniform vec3  uKeyColor;
      uniform vec3  uAmbSky;
      uniform vec3  uAmbGround;
      uniform vec3  uMoonColor;
      uniform vec3  uFogColor;
      uniform float uHaze;
      uniform float uNight;
      uniform float uGolden;
      uniform float uTwilight;
      uniform float uOpacity;
      uniform float uTime;

      varying vec2 vP;
      varying vec3 vWorld;
      varying vec3 vClusterN;
      varying vec4 vShade;

      float cl_hash(vec2 p) {
        return fract(sin(dot(p, vec2(41.71, 289.33))) * 43758.5453);
      }

      float cl_vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = cl_hash(i);
        float b = cl_hash(i + vec2(1.0, 0.0));
        float c = cl_hash(i + vec2(0.0, 1.0));
        float d = cl_hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      // Three octaves, value noise, four hashes each. The scene-wide sk_noise3 is
      // gradient noise with a 3-sine hash per corner -- eight times the
      // transcendentals, and this runs over a large fraction of the sky.
      float cl_fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 3; i++) { s += a * cl_vnoise(p); p = p * 2.07 + 13.1; a *= 0.5; }
        return s;
      }

      void main() {
        float r2 = dot(vP, vP);
        if (r2 > 1.0) discard;
        float r = sqrt(r2);

        // Erode the disc into cauliflower. Analytic rather than a baked noise
        // texture so it stays crisp when a puff fills the frame.
        float wob = cl_fbm(vP * 2.1 + vec2(vShade.z * 53.0, vShade.z * 91.0) + uTime * 0.010) - 0.44;
        float d = r + wob * (0.20 + 0.34 * r);
        float density = 1.0 - clamp(d, 0.0, 1.0);
        density = density * density * (3.0 - 2.0 * density);
        // The erosion can still leave density around 0.2 where the disc is cut
        // off at r = 1, which reads as a hard-edged grey circle -- exactly the
        // sticker look the impostor shading exists to avoid. Force it to zero at
        // the rim without touching the interior.
        density *= 1.0 - smoothstep(0.90, 1.0, r);

        float alpha = density * uOpacity * vShade.w;
        if (alpha < 0.004) discard;

        // ── impostor normal ───────────────────────────────────────
        // Reconstruct the normal of a sphere from the fragment's place in the
        // quad, then lean it toward the puff's outward direction in the cluster.
        // The first term makes a billboard shade like a lump; the second makes
        // the cluster shade like one mass instead of a sheet of identical lumps.
        float nz = sqrt(max(0.0, 1.0 - r2));
        vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 camB = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec3 nS = camR * vP.x + camU * vP.y + camB * nz;
        vec3 n = normalize(mix(nS, vClusterN, 0.40) + 1e-5);

        float core = vShade.x;
        float vert = vShade.y;
        float ndl  = dot(n, uKeyDir);
        float up   = n.y * 0.5 + 0.5;

        // Cumulus have a flat, markedly darker underside -- that top-to-bottom
        // contrast is most of what separates a cloud from a smudge. Golden hour
        // lifts the floor, because once the sun is low enough to reach under the
        // base, the base becomes the brightest part of the cloud.
        float lowSun = clamp(uGolden + uTwilight, 0.0, 1.0);
        float baseFloor = mix(0.26, 0.60, lowSun);
        float baseDark = mix(baseFloor, 1.0, smoothstep(0.14, 0.70, up));
        baseDark *= mix(0.66, 1.0, smoothstep(0.0, 0.60, vert));

        // Multiple scattering, faked: the deeper a puff sits inside its cluster,
        // the longer the light path into it and the less arrives.
        float msA = mix(1.0, 0.46, core);
        float msD = mix(1.0, 0.62, core);

        // Wrap lighting, not Lambert. A cloud is a dense forward scatterer; its
        // shadow side is grey-blue, never black, and Lambert cannot express that.
        float wrapLit = pow(ndl * 0.5 + 0.5, 1.30);

        // Silvered rim: optically thin edges facing the sun.
        float thin = smoothstep(0.42, 1.0, r);
        float rim = thin * smoothstep(-0.18, 0.72, ndl);

        // Forward scattering. When the cloud is between camera and sun the light
        // punches through the thin parts and the whole edge lights up warm.
        vec3 V = normalize(vWorld - cameraPosition);
        float fwd = max(dot(V, uKeyDir), 0.0);
        float glow = pow(fwd, 5.0) * mix(0.18, 1.0, thin) * mix(1.0, 0.30, core);

        float underlit = (1.0 - smoothstep(0.0, 0.52, up)) * smoothstep(-0.30, 0.35, ndl) * lowSun;

        vec3 amb = (uAmbSky * 0.38 + uAmbGround * 0.13) * (0.66 + 0.34 * baseDark) * msA;
        vec3 col = amb;
        col += uKeyColor * (wrapLit * 0.86 * baseDark + rim * 0.72 + glow * 1.35 + underlit * 0.85) * msD;

        // At night the key light is far too dim to shape anything, so the clouds
        // work as occluders of the star field. This floor keeps them reading as
        // masses lit by a faint moon rather than as holes cut in the sky.
        col += uMoonColor * uNight * (0.018 + 0.055 * wrapLit) * msD;

        // Aerial perspective, done by hand instead of through scene.fog: FogExp2
        // at the island's density buries the far half of the field in horizon
        // colour, and that band of sky belongs to the painted dome layer.
        float dist = length(vWorld - cameraPosition);
        float haze = 1.0 - exp(-dist * dist * uHaze * uHaze);
        col = mix(col, uFogColor, haze * 0.75);

        // Never slam a billboard into the lens as a full-screen white wall.
        alpha *= smoothstep(4.0, 34.0, dist);

        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'clouds';
  // The quads are built in the vertex shader from a unit corner, so the geometry
  // bounds describe a 2-unit box at the origin and mean nothing. Culling has to
  // be off or the whole field vanishes the moment the origin leaves the frustum.
  mesh.frustumCulled = false;
  // BEFORE the ocean (renderOrder 1), and this is not a detail. The ocean is
  // transparent and does not write depth, so over open water the depth buffer is
  // empty and anything drawn after it wins unconditionally. The low puffs of a
  // distant cloud dip below the camera's horizon, and at renderOrder 3 they were
  // painted straight over the sea as fog banks lying on the water. Drawing first
  // lets the ocean composite over them, which is what the geometry actually says.
  mesh.renderOrder = 0;

  const group = new THREE.Group();
  group.name = 'clouds';
  group.add(mesh);

  /* ── drift state (hoisted; update() allocates nothing) ─────── */
  const SPAN = FIELD_HALF * 2;
  let _heading = wind.state.heading;
  let _speed = SPEED_CALM;
  let _driftX = 0, _driftZ = 0;
  let _coverage = track(K_COVERAGE, 0.25);

  const _camPos = new THREE.Vector3();
  const order = new Int32Array(QUADS);
  const key = new Float32Array(QUADS);
  const cx = new Float32Array(NC);
  const cz = new Float32Array(NC);
  const cCos = new Float32Array(NC);
  const cSin = new Float32Array(NC);
  for (let i = 0; i < QUADS; i++) order[i] = i;

  /**
   * Back-to-front sort of every quad, run from onBeforeRender because that is
   * the only hook that hands us the camera actually being rendered — update()
   * never sees one.
   *
   * The positions here mirror the shader's wrap and its per-cluster ROTATION,
   * which is not optional: the shader turns each cluster over a three-minute
   * period, and a sort against unrotated offsets is wrong for most of that
   * cycle. The coverage shrink is deliberately not mirrored — it is a uniform
   * scale about the cluster centre, and uniform scaling cannot reorder puffs
   * along the view axis.
   *
   * Insertion sort is deliberate. The array is almost sorted every frame — the
   * camera and the clouds both move slowly — so this is O(n) in practice, and
   * unlike a comparator sort it allocates nothing.
   */
  function sortQuads(camera) {
    camera.getWorldPosition(_camPos);
    const tt = uniforms.uTime.value * MORPH;

    for (let i = 0; i < NC; i++) {
      cx[i] = wrap(cBaseX[i] + _driftX + FIELD_HALF, SPAN) - FIELD_HALF;
      cz[i] = wrap(cBaseZ[i] + _driftZ + FIELD_HALF, SPAN) - FIELD_HALF;
      const ang = tt * 0.55 + cRank[i] * 3.1;
      cCos[i] = Math.cos(ang);
      cSin[i] = Math.sin(ang);
    }

    for (let i = 0; i < QUADS; i++) {
      const c = qCloud[i];
      const ph = qSeed[i] * TAU;
      const s = 1 + 0.13 * Math.sin(tt * 2.7 + ph);
      const ox = qOffX[i], oz = qOffZ[i];
      const px = cx[c] + (ox * cCos[c] - oz * cSin[c]) * s;
      const pz = cz[c] + (ox * cSin[c] + oz * cCos[c]) * s;
      const py = cBaseY[c] + qOffY[i] * s + 2.4 * Math.sin(tt * 1.9 + ph * 1.7);
      const dx = px - _camPos.x, dy = py - _camPos.y, dz = pz - _camPos.z;
      key[i] = dx * dx + dy * dy + dz * dz;
    }

    for (let i = 1; i < QUADS; i++) {
      const v = order[i], kv = key[v];
      let j = i - 1;
      while (j >= 0 && key[order[j]] < kv) { order[j + 1] = order[j]; j--; }
      order[j + 1] = v;
    }

    for (let s = 0; s < QUADS; s++) {
      const base = order[s] * 4, o = s * 6;
      indices[o] = base; indices[o + 1] = base + 1; indices[o + 2] = base + 2;
      indices[o + 3] = base; indices[o + 4] = base + 2; indices[o + 5] = base + 3;
    }
    indexAttr.needsUpdate = true;
  }

  mesh.onBeforeRender = (renderer, scene, camera) => sortQuads(camera);

  /* ── frame ────────────────────────────────────────────────── */
  function update(t, dt, phase) {
    // Heading: shortest-angle chase through a long time constant. wind.state
    // .heading accumulates veers without bound, so the delta must be wrapped
    // into [-PI, PI] or a squall that veers past the branch cut sends the whole
    // sky the long way round.
    const delta = Math.atan2(
      Math.sin(wind.state.heading - _heading),
      Math.cos(wind.state.heading - _heading)
    );
    _heading += delta * (1 - Math.exp(-dt / HEADING_TAU));

    const master = wind.uniforms.uWindMaster.value;
    const target = (SPEED_CALM + (SPEED_GUST - SPEED_CALM) * wind.state.gust) * master;
    _speed += (target - _speed) * (1 - Math.exp(-dt / SPEED_TAU));

    // Keep the accumulator inside one field span. The shader wraps by exactly
    // this period, so it is a no-op visually and it stops float precision from
    // rotting the cloud positions after an hour of drift.
    _driftX = wrap(_driftX + Math.cos(_heading) * _speed * dt, SPAN);
    _driftZ = wrap(_driftZ + Math.sin(_heading) * _speed * dt, SPAN);
    uniforms.uDrift.value.set(_driftX, _driftZ);

    if (!phase) return;

    // Coverage breathes on two clocks: the daily keyframe, plus a slow noise
    // with a period of a couple of minutes so two consecutive noons are not
    // identical. Damped, so dragging the time slider does not pop the sky.
    const covTarget = clamp(
      track(K_COVERAGE, phase.dayTime ?? 0) + 0.10 * noise2(t * 0.011, 4.7),
      0.04, 1
    );
    _coverage += (covTarget - _coverage) * (1 - Math.exp(-dt / 6));
    uniforms.uCoverage.value = _coverage;

    const dir = phase.keyDir || phase.sunDirection;
    if (dir) uniforms.uKeyDir.value.copy(dir);

    const kc = phase.keyColor || phase.sunColor;
    if (kc) {
      const k = (phase.keyIntensity ?? 1) * SHADER_LIGHT_SCALE;
      uniforms.uKeyColor.value.setRGB(kc.r * k, kc.g * k, kc.b * k);
    }

    const a = phase.ambient ?? 1;
    if (phase.skyColor) {
      uniforms.uAmbSky.value.setRGB(
        phase.skyColor.r * a, phase.skyColor.g * a, phase.skyColor.b * a
      );
    }
    if (phase.groundColor) {
      uniforms.uAmbGround.value.setRGB(
        phase.groundColor.r * a, phase.groundColor.g * a, phase.groundColor.b * a
      );
    }
    if (phase.moonColor) uniforms.uMoonColor.value.copy(phase.moonColor);
    if (phase.fogColor) uniforms.uFogColor.value.copy(phase.fogColor);

    uniforms.uNight.value = phase.night ?? 0;
    uniforms.uGolden.value = phase.golden ?? 0;
    uniforms.uTwilight.value = phase.twilight ?? 0;

    // Dawn and dusk haze is real and it is free depth: distant clouds should
    // dissolve into the horizon hardest at exactly the hours the sky is busiest.
    uniforms.uHaze.value = 0.00040 * (1 + 0.55 * (phase.twilight ?? 0));
  }

  function dispose() {
    mesh.onBeforeRender = () => {};
    group.remove(mesh);
    geo.dispose();
    material.dispose();
  }

  return { group, mesh, update, dispose, count: QUADS };
}
