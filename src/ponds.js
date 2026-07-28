/**
 * ponds.js — still water, and the koi that live in it.
 *
 * One constraint shapes this whole module: the ponds exist BEFORE the terrain
 * does. main.js composes `carvePonds` into the island's heightfield, so the
 * basins are cut into the terrain mesh itself and every heightAt() query agrees
 * with what is drawn. The consequence is that neither the ground level nor the
 * water level can be known at construction time, so the work is split in two:
 *
 *   carvePonds()  cuts a bowl RELATIVE to whatever the local ground turns out
 *                 to be. Carving to an absolute level is impossible here, and
 *                 would trench straight through any high ground it crossed —
 *                 the same mistake the river's first elevation profile made.
 *   attach()      measures the basin that actually came out. It walks rays out
 *                 from each centre, takes the highest point along each ray as
 *                 that direction's barrier, and fills to just under the LOWEST
 *                 of those barriers. That is the spill level, and filling to it
 *                 is what guarantees the water can never sit above its own rim,
 *                 whatever the terrain underneath decides to do.
 *
 * The water surface is the deliberate opposite of the ocean in island.js: no
 * swell, no foam, a mirror at grazing angles and nearly clear looking straight
 * down. The asymmetry is the point — the koi are the subject, and a pond that
 * reflects the sky from directly overhead hides them completely.
 *
 * The koi themselves are one instanced draw call. Their path, depth and bank
 * are integrated on the CPU (nine fish is nothing, and the surface-break events
 * that spawn ripples have to be known CPU-side anyway); the S-curve of the body
 * and the fin flap happen in the vertex shader, where they belong.
 */

import * as THREE from 'three';
import { WORLD } from './config.js';
import { fbm2, smoothstep, clamp, streamFor, R } from './noise.js';

const TAU = Math.PI * 2;

/**
 * main.js hands `update()` the RAW sky phase, not the normalised copy it gives
 * the other hand-written shaders. keyIntensity is a physical DirectionalLight
 * intensity (~4.3 at noon); multiplying a colour by it directly burns the pond
 * to white by mid-morning.
 */
const SHADER_LIGHT_SCALE = 0.26;

/* ────────────────────────────────────────────────────────────────
   Siting
   ──────────────────────────────────────────────────────────────── */

/**
 * Pond centres, authored rather than scattered.
 *
 * These are not guesses. The island's heightfield was probed for flat ground
 * that stays well above sea level: a basin cut near the coast breaks through to
 * y<0 and the sea leaks inland, and a basin on a slope holds almost no water
 * because its spill level is set by the downhill rim. Flat, high ground on this
 * island means the meadow shelf around (14,-38) and the ground immediately
 * south of it — every other candidate was either the ridge flank (2.5+ units of
 * fall across a 16-unit disc) or coastal. Scattering the centres from noise
 * would have put most of them in one or the other.
 *
 * `radius` is the nominal waterline; the measured outline comes out 15-20%
 * wider because the rim blend eats into the fill level. All three finish
 * between 8 and 18 units across. All are 70+ units clear of the river.
 */
const SITES = [
  { x:  16, z: -42, radius: 7.2, depth: 2.90 },  // the big one, inside the grove
  { x:  -4, z: -73, radius: 5.2, depth: 2.60 },
  { x:  20, z: -70, radius: 4.0, depth: 3.10 },  // deeper carve: the ground here falls away
];

/** Bank width as a multiple of the waterline radius. */
const REACH_K = 1.62;
/** How far the outline is pushed in and out. Past ~0.22 the shore folds on itself. */
const OUTLINE_WARP = 0.17;
const OUTLINE_FREQ = 0.055;

const BASINS = SITES.map((s, i) => ({
  ...s,
  reach: s.radius * REACH_K,
  cull2: Math.pow(s.radius * REACH_K * (1 + OUTLINE_WARP) + 1, 2),
  // Decorrelate the outline noise per pond, or all three wobble in unison.
  wx: 11.3 + i * 37.7,
  wz: -4.7 - i * 21.1,
}));

/* ────────────────────────────────────────────────────────────────
   1. Terrain carving — pure, cheap, called once per terrain vertex
   ──────────────────────────────────────────────────────────────── */

export function carvePonds(x, z, h) {
  for (let i = 0; i < BASINS.length; i++) {
    const p = BASINS[i];
    const dx = x - p.x, dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > p.cull2) continue;

    // The outline noise is sampled in world space rather than by angle. An
    // angular warp scallops the shore evenly; sampling the field the point
    // actually sits in pushes the bank in and out along its length too, which
    // is what makes an inlet instead of a decorated circle.
    const wob = 1 + OUTLINE_WARP * fbm2(x * OUTLINE_FREQ + p.wx, z * OUTLINE_FREQ + p.wz, 3);
    const t = Math.sqrt(d2) / (p.reach * wob);
    if (t >= 1) continue;

    // smoothstep is tangent-flat at BOTH ends: a level floor through the middle
    // and no lip where the bank meets the meadow. A power curve gives one or
    // the other, never both, and the crater lip is the tell.
    h -= p.depth * (1 - smoothstep(0, 1, t));
  }
  return h;
}

/* ────────────────────────────────────────────────────────────────
   2. Water surface
   ──────────────────────────────────────────────────────────────── */

const SHORE_N = 96;          // rays used to measure and to tessellate the outline
const RIPPLE_SLOTS = 8;

const WATER_VERT = /* glsl */ `
  attribute float aDepth;
  varying float vDepth;
  varying vec3  vWorld;
  #include <fog_pars_vertex>
  void main() {
    vDepth = aDepth;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uWindStrength;
  uniform vec2  uWindDir;
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uSilt;
  uniform vec3  uKeyDir;
  uniform vec3  uKeyColor;
  uniform vec3  uAmbient;
  uniform vec3  uSkyColor;
  uniform vec3  uHorizon;
  uniform float uReflect;
  uniform vec4  uRipples[${RIPPLE_SLOTS}];

  varying float vDepth;
  varying vec3  vWorld;

  #include <fog_pars_fragment>

  float pk_h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.545); }
  float pk_vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(pk_h21(i), pk_h21(i + vec2(1, 0)), u.x),
               mix(pk_h21(i + vec2(0, 1)), pk_h21(i + vec2(1, 1)), u.x), u.y);
  }

  // Surface height in world units. Two contributions: a breeze chop whose
  // amplitude is driven by the shared gust train, so the pond roughens when a
  // squall crosses the island and goes glassy in the lulls; and expanding rings
  // left where a koi broke the surface.
  float pk_surface(vec2 p) {
    vec2 drift = uWindDir * uTime * 0.30;
    float chop = pk_vnoise(p * 1.6 - drift) * 0.62 + pk_vnoise(p * 4.1 + drift.yx * 0.6) * 0.38;
    float amp = 0.010 + 0.052 * min(uWindStrength, 1.7);
    float h = (chop - 0.5) * amp;

    for (int i = 0; i < ${RIPPLE_SLOTS}; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.z;
      float front = age * 1.15;
      float d = distance(p, r.xy);
      // The ring is a narrow band travelling outward; both the band and the
      // whole event fade, so a slot that is never refreshed simply dies.
      float env = r.w * step(0.0, age) * exp(-age * 0.55) * exp(-abs(d - front) * 1.4);
      h += sin((d - front) * 7.5) * env * 0.055;
    }
    return h;
  }

  void main() {
    float depth = max(vDepth, 0.0);

    // Analytic normal from the height field. The mesh itself stays dead flat —
    // a still pond that visibly undulates reads as a swimming pool in a breeze.
    float e = 0.09;
    float h0 = pk_surface(vWorld.xz);
    float hx = pk_surface(vWorld.xz + vec2(e, 0.0));
    float hz = pk_surface(vWorld.xz + vec2(0.0, e));
    vec3 N = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));

    // Depth-graded body colour: green water gets darker and less transparent
    // the more of it there is above the bed. The hue is pulled toward teal on
    // purpose — an olive pond sitting on an olive meadow disappears, and the
    // first version of this did exactly that.
    float td = 1.0 - exp(-depth * 1.15);
    vec3 body = mix(uShallow, uDeep, td);
    body = mix(uSilt, body, smoothstep(0.0, 0.40, depth));

    // The body colour is light scattered back out of the water and off the bed,
    // so it has to be lit. Leaving it as a flat authored colour makes the pond
    // glow like a lightbox at midnight while the meadow around it goes black.
    body *= uAmbient + uKeyColor * (max(dot(N, uKeyDir), 0.0) * 0.45 + 0.10);

    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = max(dot(N, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 3.6);
    // Killing the reflection in the shallows keeps the margin reading as wet
    // mud rather than as a chrome band around the pond.
    fres *= uReflect * smoothstep(0.02, 0.45, depth);

    vec3 sky = mix(uHorizon, uSkyColor, clamp(ndv * 1.4, 0.0, 1.0));
    vec3 col = mix(body, sky, fres);

    // One tight glint. Still water has a small, hard sun spot, not a sheen.
    vec3 Hv = normalize(uKeyDir + V);
    col += uKeyColor * pow(max(dot(N, Hv), 0.0), 220.0) * 1.7;
    col += uKeyColor * max(h0, 0.0) * 2.0;

    // Deep water has to be genuinely opaque or the bed reads straight through
    // it and the pond looks like a tinted window laid on the grass. The koi are
    // kept legible by drawing them OVER this and attenuating them by their own
    // submersion, not by leaving the water see-through.
    float alpha = mix(0.30, 0.88, td);
    alpha = mix(alpha, 0.97, fres);
    alpha *= smoothstep(0.0, 0.14, depth);

    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }
`;

/* ────────────────────────────────────────────────────────────────
   3. Koi
   ──────────────────────────────────────────────────────────────── */

/**
 * One koi, nose at local +Z, tail at -Z, length 1 so the instance matrix can
 * scale it. Body height exceeds body width by design: a carp is laterally
 * compressed, and from the shallow opening camera it is the width that draws
 * the silhouette, so getting the ratio wrong turns them into sausages.
 *
 * uv.x carries the body coordinate s (0 snout, 1 tail tip) and drives the
 * undulation; uv.y is the angle around the body, seamed at the belly where the
 * pale underside hides the join. aFin tags the parts: 0 body, 1 median fins
 * (they follow the body's wave), 2 pectorals (they flap on their own).
 */
function makeKoiGeometry() {
  const STATIONS = 18, RING = 8;
  const BODY_END = 0.88;            // where the body stops and the tail fin starts

  const pos = [], nrm = [], uvs = [], fin = [], idx = [];

  const halfH = (t) => {
    const shape = Math.pow(Math.sin(Math.PI * Math.pow(clamp(t, 0, 1), 0.78)), 0.85);
    const tail = smoothstep(0.68, 1.0, t);
    return 0.135 * shape * (1 - tail) + 0.030 * tail;
  };
  const halfW = (t) => halfH(t) * 0.60;

  const push = (x, y, z, nx, ny, nz, u, v, f) => {
    pos.push(x, y, z); nrm.push(nx, ny, nz); uvs.push(u, v); fin.push(f);
    return pos.length / 3 - 1;
  };

  // — body shell —
  const first = pos.length / 3;
  for (let i = 0; i < STATIONS; i++) {
    const t = i / (STATIONS - 1);
    const s = t * BODY_END;
    const z = 0.5 - s;                    // +0.5 snout .. -0.38 peduncle
    const hh = halfH(t), hw = halfW(t);
    const dh = (halfH(Math.min(1, t + 0.02)) - halfH(Math.max(0, t - 0.02))) / 0.04;
    for (let j = 0; j <= RING; j++) {
      const a = (j / RING) * TAU;         // a = 0 at the belly, PI at the back
      const cy = -Math.cos(a), cx = Math.sin(a);
      // Normal of a tapered tube: the lateral part from the ellipse, the
      // longitudinal part from how fast the profile is opening or closing.
      const nx = cx / 0.60, ny = cy, nz = dh * 0.55;
      const inv = 1 / Math.hypot(nx, ny, nz);
      push(cx * hw, cy * hh, z, nx * inv, ny * inv, nz * inv, s, j / RING, 0);
    }
  }
  for (let i = 0; i < STATIONS - 1; i++) {
    const a0 = first + i * (RING + 1), b0 = a0 + RING + 1;
    for (let j = 0; j < RING; j++) {
      idx.push(a0 + j, b0 + j, a0 + j + 1);
      idx.push(a0 + j + 1, b0 + j, b0 + j + 1);
    }
  }

  // — cap the peduncle so the tail root is not an open pipe —
  const zt = 0.5 - BODY_END;
  const capC = push(0, 0, zt, 0, 0, -1, BODY_END, 0.5, 0);
  const capRing = first + (STATIONS - 1) * (RING + 1);
  for (let j = 0; j < RING; j++) idx.push(capC, capRing + j + 1, capRing + j);

  // — caudal fin: a forked vertical sweep, the part that actually reads as
  //   movement when the fish turns —
  //
  // The median fins are sheets in the x=0 plane, so their normal is ±X. Giving
  // them +Z puts the normal IN the surface and every lighting term collapses to
  // the wrap constant, which is why they used to read as grey card. One winding
  // each: the material is DoubleSide and flips the normal on gl_FrontFacing, so
  // a mirrored copy only costs a second blend pass over the same pixels — which
  // on a transparent material darkens the fins relative to the body.
  const tailLen = 0.24, tailSpread = 0.145;
  const tRoot = push(0, 0, zt, 1, 0, 0, 1.0, 0.5, 1);
  const tNotch = push(0, 0, zt - tailLen * 0.52, 1, 0, 0, 1.0, 0.5, 1);
  for (const side of [1, -1]) {
    const mid = push(0, side * tailSpread * 0.55, zt - tailLen * 0.55, 1, 0, 0, 1.0, 0.5, 1);
    const tip = push(0, side * tailSpread, zt - tailLen, 1, 0, 0, 1.0, 0.5, 1);
    idx.push(tRoot, mid, tip, tRoot, tip, tNotch);
  }

  // — dorsal ridge —
  const dz0 = 0.5 - 0.34, dz1 = 0.5 - 0.76;
  const d0 = push(0, halfH(0.38) * 0.92, dz0, 1, 0, 0, 0.38, 0.5, 1);
  const d1 = push(0, halfH(0.55) * 0.92 + 0.052, (dz0 + dz1) * 0.5, 1, 0, 0, 0.55, 0.5, 1);
  const d2 = push(0, halfH(0.80) * 0.92, dz1, 1, 0, 0, 0.80, 0.5, 1);
  const d3 = push(0, halfH(0.38) * 0.55, dz0, 1, 0, 0, 0.38, 0.5, 1);
  const d4 = push(0, halfH(0.80) * 0.55, dz1, 1, 0, 0, 0.80, 0.5, 1);
  idx.push(d3, d0, d1, d3, d1, d4, d4, d1, d2);

  // — pectorals, splayed nearly flat so they show from above —
  for (const side of [1, -1]) {
    const s0 = 0.30, zr = 0.5 - s0;
    const w0 = halfW(s0 / BODY_END) * 0.9;
    const root = push(side * w0, -0.012, zr, 0, 1, 0, s0, 0.25, 2);
    const back = push(side * w0, -0.020, zr - 0.075, 0, 1, 0, s0, 0.25, 2);
    const tip = push(side * (w0 + 0.115), -0.045, zr - 0.10, 0, 1, 0, s0, 0.25, 2);
    idx.push(root, back, tip);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 1));
  g.setIndex(idx);
  return g;
}

const KOI_VERT = /* glsl */ `
  attribute float aFin;
  attribute vec3  aColA;
  attribute vec3  aColB;
  attribute vec4  aPat;      // patch scale, seed, patch threshold, pond water level
  attribute vec4  aMotion;   // phase, tail beat, sway amplitude, variety

  uniform float uTime;

  varying vec3  vNormalW;
  varying vec3  vWorld;
  varying vec3  vLocal;
  varying float vFin;
  varying vec3  vColA;
  varying vec3  vColB;
  varying vec4  vPat;
  varying float vVariety;

  #include <fog_pars_vertex>

  void main() {
    vFin = aFin; vColA = aColA; vColB = aColB;
    vPat = aPat; vVariety = aMotion.w;
    vLocal = position;

    float s = uv.x;
    float phase = aMotion.x, beat = aMotion.y, amp = aMotion.z;

    // Travelling wave down the body. The head barely moves and the tail sweeps
    // hardest — a uniform sine makes the whole fish shimmy sideways like a
    // ribbon, which is the single most common way this goes wrong.
    float w = smoothstep(0.10, 1.0, s);
    float wave = 5.6 * s - uTime * beat + phase;
    float sway = sin(wave) * w * w * amp;
    float dsway = cos(wave) * 5.6 * w * w * amp;   // d(sway)/ds, for the normal

    vec3 p = position;
    vec3 n = normal;

    p.x += sway * (1.0 + aFin * 0.35);

    // Pectorals row rather than follow the wave: they sweep about the body
    // axis, both fins together, which is what a hovering carp actually does.
    if (aFin > 1.5) {
      float flap = sin(uTime * beat * 1.6 + phase + 1.1) * 0.30 * sign(position.x);
      float cf = cos(flap), sf = sin(flap);
      p.xy = vec2(p.x * cf - p.y * sf, p.x * sf + p.y * cf);
      n.xy = vec2(n.x * cf - n.y * sf, n.x * sf + n.y * cf);
    }

    // Yaw the normal by the local slope of the wave, or the fish lights as if
    // it were rigid while its body visibly bends.
    float ang = dsway;
    float ca = cos(ang), sa = sin(ang);
    n = vec3(n.x * ca - n.z * sa, n.y, n.x * sa + n.z * ca);

    vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);

    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const KOI_FRAG = /* glsl */ `
  uniform vec3  uKeyDir;
  uniform vec3  uKeyColor;
  uniform vec3  uAmbient;
  uniform vec3  uBelly;
  uniform vec3  uWaterTint;

  varying vec3  vNormalW;
  varying vec3  vWorld;
  varying vec3  vLocal;
  varying float vFin;
  varying vec3  vColA;
  varying vec3  vColB;
  varying vec4  vPat;
  varying float vVariety;

  #include <fog_pars_fragment>

  float pk_h21(vec2 p) { return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.545); }
  float pk_vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(pk_h21(i), pk_h21(i + vec2(1, 0)), u.x),
               mix(pk_h21(i + vec2(0, 1)), pk_h21(i + vec2(1, 1)), u.x), u.y);
  }
  float pk_fbm(vec2 p) {
    return pk_vnoise(p) * 0.62 + pk_vnoise(p * 2.07 + 4.3) * 0.38;
  }

  void main() {
    // Patches are sampled in BODY space, not in uv: uv wraps and would seam a
    // patch in half down the belly, and a real kohaku marking pours over the
    // back and down both flanks as one shape.
    // hi is the breeder's word for the red marking, and it is also NOT a GLSL
    // reserved word — which "patch" is, in ES 3.00, and three transpiles this
    // shader to ES 3.00 on WebGL2. That one costs you a silently missing mesh.
    vec2 seed = vec2(vPat.y, vPat.y * 1.63 + 7.1);
    vec2 q = vec2(vLocal.z * vPat.x, (vLocal.x * 3.4 + vLocal.y * 1.7) * vPat.x) + seed;
    float n = pk_fbm(q);
    float hi = smoothstep(vPat.z - 0.055, vPat.z + 0.055, n);

    vec3 col = mix(vColA, vColB, hi);

    // Showa carries a third tone: white breaking through the black ground.
    if (vVariety > 1.5) {
      float n2 = pk_fbm(q * 0.78 + vec2(19.7, 5.1));
      col = mix(col, vec3(0.94, 0.93, 0.90), smoothstep(0.62, 0.74, n2) * (1.0 - hi * 0.6));
    }

    // Pale underside. vLocal.y is the body-space height, so this follows the
    // taper without needing a separate mask.
    float ventral = smoothstep(0.02, -0.06, vLocal.y);
    col = mix(col, mix(col * 0.45, uBelly, 0.78), ventral * 0.8);

    // Fins are thin, unpigmented tissue: paler and warmer than the flank.
    col = mix(col, mix(col, vec3(0.95, 0.86, 0.80), 0.55), step(0.5, vFin));

    vec3 n3 = normalize(vNormalW);
    if (!gl_FrontFacing) n3 = -n3;

    // Wrapped diffuse, lifted. These are 3-pixel flecks seen through green water
    // from 350 units away; a physically honest terminator turns half of every
    // fish to mud and they stop reading as fish at all. The lift rides on the
    // ambient rather than being a constant, or they glow after dark.
    float wrap = dot(n3, uKeyDir) * 0.5 + 0.5;
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 Hv = normalize(uKeyDir + V);
    float spec = pow(max(dot(n3, Hv), 0.0), 46.0);

    vec3 lit = col * (uAmbient * 1.35 + uKeyColor * (wrap * 0.9 + 0.20));
    lit += uKeyColor * spec * 0.35;

    // The koi are drawn OVER the water rather than under it, so the water has
    // to be applied to them here: green attenuation with how deep the fish is
    // (roughly 1.6x the vertical drop, for a slanted view path), and an alpha
    // that lets the already-drawn surface reflection sit on top of them. Doing
    // it this way is what allows the pond itself to be properly opaque.
    float sub = max(vPat.w - vWorld.y, 0.0) * 1.6;
    lit = mix(lit, uWaterTint, clamp(1.0 - exp(-sub * 0.95), 0.0, 0.72));

    vec3 up = normalize(cameraPosition - vWorld);
    float mirror = pow(1.0 - min(abs(up.y), 1.0), 4.0) * 0.65;

    gl_FragColor = vec4(lit, 1.0 - mirror);
    #include <fog_fragment>
  }
`;

/** The varieties, as colour pairs. Values are sRGB and get linearised on read. */
const VARIETIES = [
  // kohaku — white ground, vermilion patches. The classic, and the one that
  // reads best at distance because the contrast is highest.
  { base: 0xf6f2ea, blotch: 0xe23c11, variety: 0, thr: 0.50, weight: 3 },
  // yamabuki ogon — solid metallic gold. No patches; the threshold is pushed
  // past anything the noise reaches.
  { base: 0xffa61c, blotch: 0xff8a00, variety: 1, thr: 0.92, weight: 2 },
  // showa — black ground broken by red and white.
  { base: 0x181410, blotch: 0xd8380e, variety: 2, thr: 0.46, weight: 1 },
  // orange-red ogon, for pure legibility under the water
  { base: 0xff6a12, blotch: 0xffd06a, variety: 1, thr: 0.60, weight: 2 },
];

/* ────────────────────────────────────────────────────────────────
   4. Margins — lily pads and reeds
   ──────────────────────────────────────────────────────────────── */

function makeLilyPadGeometry() {
  const SEG = 14, NOTCH = 0.42;      // radians of missing wedge
  const pos = [], nrm = [], uvs = [], kind = [], idx = [];
  pos.push(0, 0, 0); nrm.push(0, 1, 0); uvs.push(0, 0); kind.push(0);
  for (let i = 0; i <= SEG; i++) {
    const a = NOTCH * 0.5 + (i / SEG) * (TAU - NOTCH);
    // Rim lifted a little: a lily pad curls up at the edge and that curl is
    // what catches the light and separates it from the water it sits on.
    pos.push(Math.cos(a), 0.055, Math.sin(a));
    nrm.push(Math.cos(a) * 0.22, 1, Math.sin(a) * 0.22);
    uvs.push(1, i / SEG); kind.push(0);
  }
  for (let i = 1; i <= SEG; i++) idx.push(0, i + 1, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(idx);
  return g;
}

function makeReedTuftGeometry(rng) {
  const BLADES = 5, LEVELS = 4;
  const pos = [], nrm = [], uvs = [], kind = [], idx = [];
  for (let b = 0; b < BLADES; b++) {
    const a = R.range(rng, 0, TAU);
    const lean = R.range(rng, 0.10, 0.30);
    const hgt = R.range(rng, 0.62, 1.0);
    const wid = R.range(rng, 0.022, 0.036);
    const ox = Math.cos(a) * R.range(rng, 0, 0.11);
    const oz = Math.sin(a) * R.range(rng, 0, 0.11);
    const dx = Math.cos(a) * lean, dz = Math.sin(a) * lean;
    const base = pos.length / 3;
    for (let l = 0; l <= LEVELS; l++) {
      const t = l / LEVELS;
      const w = wid * (1 - t * 0.92);
      const y = hgt * t;
      const bend = t * t;
      // Blade cross-section is a flat strip; the pair of vertices straddles the
      // stem along the direction perpendicular to its lean.
      const px = ox + dx * bend, pz = oz + dz * bend;
      pos.push(px - Math.sin(a) * w, y, pz + Math.cos(a) * w);
      nrm.push(Math.cos(a), 0.35, Math.sin(a));
      uvs.push(0, t); kind.push(1);
      pos.push(px + Math.sin(a) * w, y, pz - Math.cos(a) * w);
      nrm.push(Math.cos(a), 0.35, Math.sin(a));
      uvs.push(1, t); kind.push(1);
    }
    // One winding: marginMat is DoubleSide, so the mirrored copy only rasterised
    // the same strip twice.
    for (let l = 0; l < LEVELS; l++) {
      const i0 = base + l * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(idx);
  return g;
}

const MARGIN_FRAG = /* glsl */ `
  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uAmbient;

  varying vec3  vNormalW;
  varying vec2  vUv;
  varying float vKind;
  varying vec3  vTint;

  #include <fog_pars_fragment>

  void main() {
    vec3 col = vTint;
    if (vKind < 0.5) {
      // Pads darken toward the centre and redden at the rim, like Nymphaea.
      col = mix(col * 0.72, mix(col, vec3(0.48, 0.20, 0.14), 0.35), smoothstep(0.55, 1.0, vUv.x));
    } else {
      col = mix(col * 0.55, col, vUv.y);          // reeds pale toward the tip
    }
    vec3 n = normalize(vNormalW);
    if (!gl_FrontFacing) n = -n;
    float wrap = dot(n, uKeyDir) * 0.5 + 0.5;
    float trans = pow(max(dot(-n, uKeyDir), 0.0), 2.0) * step(0.5, vKind);
    vec3 lit = col * (uAmbient + uKeyColor * (wrap * 0.78 + trans * 0.45));
    gl_FragColor = vec4(lit, 1.0);
    #include <fog_fragment>
  }
`;

/* ────────────────────────────────────────────────────────────────
   Factory
   ──────────────────────────────────────────────────────────────── */

export function createPonds({ seed = 1337, wind, quality, heightAt = null } = {}) {
  const group = new THREE.Group();
  group.name = 'ponds';

  const rng = streamFor(seed, 'ponds');
  const label = quality?.label ?? 'ultra';
  const propBudget = quality?.rocks ?? 100;

  /**
   * Read by birds.js to know where to land and drink. `radius` and `waterY` are
   * nominal until attach() measures the basins that were actually carved.
   */
  const PONDS = BASINS.map((p) => ({
    x: p.x, z: p.z, radius: p.radius, waterY: WORLD.seaLevel, depth: 0,
  }));

  // Per-pond measurements, filled by attach(). `shore` is a table of waterline
  // radii indexed by angle; isInPond interpolates it, so grass and trees follow
  // the real irregular outline instead of a circle drawn around it.
  const basins = BASINS.map((p) => ({ ...p, shore: null, shoreMin: p.radius, waterY: 0, cullR2: p.cull2 }));

  let sampleHeight = heightAt;

  /* ── isInPond ─────────────────────────────────────────────────
   * Called by grass and tree placement hundreds of thousands of times, so it
   * early-outs on a squared distance before touching the contour table.
   */
  function isInPond(x, z) {
    for (let i = 0; i < basins.length; i++) {
      const b = basins[i];
      const dx = x - b.x, dz = z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > b.cullR2) continue;
      let r;
      if (b.shore) {
        const f = ((Math.atan2(dz, dx) + Math.PI) / TAU) * SHORE_N;
        const i0 = f | 0;
        const t = f - i0;
        const a = b.shore[i0 % SHORE_N], c = b.shore[(i0 + 1) % SHORE_N];
        r = a + (c - a) * t;
      } else {
        r = b.radius * 1.3;
      }
      // The extra unit keeps grass out of the wet margin, which is mud and reeds.
      if (d2 < (r + 1.0) * (r + 1.0)) return true;
    }
    return false;
  }

  /* ── materials ────────────────────────────────────────────────
   * uTime, uWindDir and uWindStrength are the SHARED wind uniform objects,
   * assigned by reference so the single wind.update() in main.js drives the
   * pond surface too. Cloning them here would freeze the water at t=0.
   */
  const waterUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
  Object.assign(waterUniforms, {
    uShallow: { value: new THREE.Color(0x3f6b52) },
    uDeep: { value: new THREE.Color(0x0a2019) },
    uSilt: { value: new THREE.Color(0x5f5336) },
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uKeyColor: { value: new THREE.Color(1, 1, 1) },
    uAmbient: { value: new THREE.Color(0.42, 0.44, 0.46) },
    uSkyColor: { value: new THREE.Color(0x7fb0e8) },
    uHorizon: { value: new THREE.Color(0xcfe2f2) },
    uReflect: { value: 0.66 },   // update() drives this; see the note there
    uRipples: { value: Array.from({ length: RIPPLE_SLOTS }, () => new THREE.Vector4(0, 0, -999, 0)) },
    uTime: wind.uniforms.uTime,
    uWindDir: wind.uniforms.uWindDir,
    uWindStrength: wind.uniforms.uWindStrength,
  });

  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });

  const koiUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
  Object.assign(koiUniforms, {
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uKeyColor: { value: new THREE.Color(1, 1, 1) },
    uAmbient: { value: new THREE.Color(0.42, 0.44, 0.46) },
    uBelly: { value: new THREE.Color(0xf3ead8) },
    uWaterTint: { value: new THREE.Color(0x14352a) },
    uTime: wind.uniforms.uTime,
  });
  const koiMat = new THREE.ShaderMaterial({
    uniforms: koiUniforms,
    vertexShader: KOI_VERT,
    fragmentShader: KOI_FRAG,
    fog: true,
    // Solid fish, but blended: the alpha carries the surface reflection that
    // was drawn underneath them. depthWrite stays on so they occlude each other.
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,   // the fins are single sheets
  });

  const marginUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
  Object.assign(marginUniforms, {
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uKeyColor: { value: new THREE.Color(1, 1, 1) },
    uAmbient: { value: new THREE.Color(0.42, 0.44, 0.46) },
  });
  // Everything WIND_GLSL needs, by reference — see the note above.
  Object.assign(marginUniforms, wind.uniforms);

  const marginMat = new THREE.ShaderMaterial({
    uniforms: marginUniforms,
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aKind;
      attribute vec4  aInst;    // world x, y, z, scale
      attribute vec4  aTrim;    // yaw, phase, tint index, sway scale

      varying vec3  vNormalW;
      varying vec2  vUv;
      varying float vKind;
      varying vec3  vTint;

      ${wind.WIND_GLSL}

      #include <fog_pars_vertex>

      void main() {
        vUv = uv; vKind = aKind;

        float c = cos(aTrim.x), s = sin(aTrim.x);
        vec3 p = position * aInst.w;
        p.xz = vec2(p.x * c - p.z * s, p.x * s + p.z * c);
        vec3 base = aInst.xyz;
        vec3 world = base + p;

        vec3 w = windForce(base, uTime);
        if (aKind < 0.5) {
          // Pads float: they ride the surface rather than bending, so the gust
          // shows as a slow heave and a small drift, not as a bend.
          world.y += sin(uTime * 0.8 + aTrim.y) * 0.014 + w.y * 0.05;
          world.xz += w.xz * 0.05 * aTrim.w;
        } else {
          float t = uv.y * uv.y;
          world.xz += w.xz * 0.42 * t * aTrim.w;
          world.y -= length(w.xz) * 0.10 * t * aTrim.w;
        }

        vec3 n = normalize(vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c));
        vNormalW = normalize(mat3(modelMatrix) * n);

        // Reeds run olive to straw, pads a deeper green; aTrim.z decorrelates them.
        vec3 green = mix(vec3(0.24, 0.36, 0.16), vec3(0.42, 0.50, 0.20), aTrim.z);
        vec3 pad = mix(vec3(0.18, 0.34, 0.19), vec3(0.30, 0.44, 0.20), aTrim.z);
        vTint = mix(pad, green, aKind);

        vec4 mvPosition = viewMatrix * modelMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: MARGIN_FRAG,
  });

  /* ── meshes, created by attach() ──────────────────────────── */
  let waterMesh = null, koiMesh = null, padMesh = null, reedMesh = null;
  let koiGeo = null, padGeo = null, reedGeo = null;

  /** @type {{pond:number,ox:number,oz:number,a:number,b:number,h1:number,h2:number,
   *          f1:number,f2:number,f3:number,f4:number,rot:number,rate:number,
   *          theta:number,cruise:number,riseRate:number,risePhase:number,
   *          scale:number,heading:number,bank:number,prevY:number,rise:number,
   *          x:number,y:number,z:number}[]} */
  const koi = [];

  /* ── ripple ring buffer ──────────────────────────────────── */
  let rippleNext = 0;
  function spawnRipple(x, z, t, strength) {
    const slot = waterUniforms.uRipples.value[rippleNext];
    slot.set(x, z, t, strength);
    rippleNext = (rippleNext + 1) % RIPPLE_SLOTS;
  }

  /**
   * Fill level for one basin.
   *
   * Along each ray out from the centre the highest point is the barrier the
   * water would have to climb to escape in that direction; the lowest barrier
   * over all directions is the spill level. Filling to just under it is what
   * makes the water surface provably contained by the ground that was carved,
   * rather than by an assumption about how the carve turned out.
   */
  function measure(b) {
    const outR = b.reach * (1 + OUTLINE_WARP) + 0.6;
    const STEPS = 56;
    const prof = new Float32Array(SHORE_N * (STEPS + 1));

    let spill = Infinity;
    for (let a = 0; a < SHORE_N; a++) {
      const ang = (a / SHORE_N) * TAU - Math.PI;   // matches isInPond's indexing
      const cx = Math.cos(ang), cz = Math.sin(ang);
      let barrier = -Infinity;
      for (let i = 0; i <= STEPS; i++) {
        const r = (i / STEPS) * outR;
        const h = sampleHeight(b.x + cx * r, b.z + cz * r);
        prof[a * (STEPS + 1) + i] = h;
        if (h > barrier) barrier = h;
      }
      if (barrier < spill) spill = barrier;
    }

    const waterY = spill - 0.08;
    const shore = new Float32Array(SHORE_N);
    let sum = 0, min = Infinity, bed = Infinity;

    for (let a = 0; a < SHORE_N; a++) {
      const row = a * (STEPS + 1);
      let rw = outR;
      for (let i = 0; i <= STEPS; i++) {
        const h = prof[row + i];
        if (h >= waterY) {
          // Interpolate the crossing so the outline is smooth rather than
          // quantised to the sampling step.
          const hPrev = i > 0 ? prof[row + i - 1] : h;
          const f = h > hPrev ? clamp((waterY - hPrev) / (h - hPrev), 0, 1) : 0;
          rw = ((i - 1 + f) / STEPS) * outR;
          break;
        }
        if (h < bed) bed = h;
      }
      shore[a] = Math.max(rw, 0.5);
      sum += shore[a];
      if (shore[a] < min) min = shore[a];
    }

    b.shore = shore;
    b.shoreMin = min;
    b.waterY = waterY;
    b.maxDepth = waterY - bed;
    b.meanR = sum / SHORE_N;
    b.cullR2 = Math.pow(Math.max(...shore) + 2, 2);
    return b;
  }

  /* ── water geometry ─────────────────────────────────────── */
  const RINGS = 15;
  /**
   * The disc runs 15% past the measured waterline on purpose. The bank rises
   * above the water plane out there, so the depth buffer hides the overshoot
   * and the visible waterline becomes the exact intersection of the flat water
   * with the carved ground — no seam to line up, and no gap when the terrain
   * rolls. The alpha fade only has to soften it.
   */
  const OVER = 1.15;

  function buildWater() {
    const pos = [], depths = [], idx = [];
    for (const b of basins) {
      const base = pos.length / 3;
      pos.push(b.x, b.waterY, b.z);
      depths.push(b.waterY - sampleHeight(b.x, b.z));

      for (let k = 1; k <= RINGS; k++) {
        // Rings crowd toward the shore, where the alpha gradient lives.
        const t = Math.pow(k / RINGS, 0.82);
        for (let a = 0; a < SHORE_N; a++) {
          const ang = (a / SHORE_N) * TAU - Math.PI;
          const r = b.shore[a] * OVER * t;
          const x = b.x + Math.cos(ang) * r;
          const z = b.z + Math.sin(ang) * r;
          pos.push(x, b.waterY, z);
          depths.push(b.waterY - sampleHeight(x, z));
        }
      }

      // Winding: spokes advance with increasing angle, which seen from above is
      // anticlockwise, so a face whose normal points at the sky lists its
      // vertices the other way round. Getting this backwards points the whole
      // surface at the bed.
      for (let a = 0; a < SHORE_N; a++) {
        const a1 = (a + 1) % SHORE_N;
        idx.push(base, base + 1 + a1, base + 1 + a);
      }
      for (let k = 0; k < RINGS - 1; k++) {
        const r0 = base + 1 + k * SHORE_N, r1 = r0 + SHORE_N;
        for (let a = 0; a < SHORE_N; a++) {
          const a1 = (a + 1) % SHORE_N;
          idx.push(r0 + a, r0 + a1, r1 + a);
          idx.push(r0 + a1, r1 + a1, r1 + a);
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  /* ── koi ─────────────────────────────────────────────────── */
  function pickVariety() {
    let total = 0;
    for (const v of VARIETIES) total += v.weight;
    let r = rng() * total;
    for (const v of VARIETIES) { r -= v.weight; if (r <= 0) return v; }
    return VARIETIES[0];
  }

  function buildKoi() {
    const perPond = label === 'low' ? 2 : 3;
    for (let pi = 0; pi < basins.length; pi++) {
      const b = basins[pi];
      // A fish needs water over its back; a basin that came out as a puddle
      // gets lilies and no koi rather than fish grounded on the mud.
      if (b.maxDepth < 0.55) continue;
      for (let k = 0; k < perPond; k++) {
        // Every term of the path is budgeted out of the pond's TIGHTEST radius,
        // so a fish can never swim out through a narrow part of the outline.
        const budget = b.shoreMin * 0.66;
        const h1 = R.range(rng, 0.05, 0.15) * budget;
        const h2 = R.range(rng, 0.03, 0.10) * budget;
        const offR = R.range(rng, 0, 0.10) * budget;
        const offA = R.range(rng, 0, TAU);
        const rest = budget - h1 - h2 - offR;
        koi.push({
          pond: pi,
          ox: Math.cos(offA) * offR,
          oz: Math.sin(offA) * offR,
          a: R.range(rng, 0.62, 1.0) * rest,
          b: R.range(rng, 0.48, 0.88) * rest,
          h1, h2,
          f1: R.range(rng, 0, TAU), f2: R.range(rng, 0, TAU),
          f3: R.range(rng, 0, TAU), f4: R.range(rng, 0, TAU),
          rot: R.range(rng, 0, TAU),
          rate: R.range(rng, 0.072, 0.132) * (rng() < 0.5 ? -1 : 1),
          theta: R.range(rng, 0, TAU),
          cruise: R.range(rng, 0.34, Math.min(0.95, b.maxDepth * 0.55)),
          riseRate: R.range(rng, 0.10, 0.21),
          risePhase: R.range(rng, 0, TAU),
          // Big fish. A metre-long koi is real, and at 350 units from the
          // opening camera anything smaller stops being a fleck of orange and
          // becomes nothing at all.
          scale: R.skew(rng, 0.85, 1.50, 1.4),
          heading: 0, bank: 0, prevY: b.waterY - 0.5, rise: 0,
          x: b.x, y: b.waterY - 0.5, z: b.z,
        });
      }
    }
    if (!koi.length) return;

    koiGeo = makeKoiGeometry();
    const n = koi.length;
    const colA = new Float32Array(n * 3);
    const colB = new Float32Array(n * 3);
    const pat = new Float32Array(n * 4);
    const mot = new Float32Array(n * 4);
    const c = new THREE.Color();

    for (let i = 0; i < n; i++) {
      const v = pickVariety();
      c.setHex(v.base).toArray(colA, i * 3);
      c.setHex(v.blotch).toArray(colB, i * 3);
      pat[i * 4 + 0] = R.range(rng, 3.4, 5.6);      // patch scale
      pat[i * 4 + 1] = rng() * 60;                  // pattern seed
      pat[i * 4 + 2] = v.thr;
      pat[i * 4 + 3] = basins[koi[i].pond].waterY;  // for the submersion tint
      mot[i * 4 + 0] = R.range(rng, 0, TAU);        // phase
      mot[i * 4 + 1] = R.range(rng, 4.6, 7.4);      // tail beat
      mot[i * 4 + 2] = R.range(rng, 0.030, 0.055);  // sway amplitude
      mot[i * 4 + 3] = v.variety;
    }

    koiGeo.setAttribute('aColA', new THREE.InstancedBufferAttribute(colA, 3));
    koiGeo.setAttribute('aColB', new THREE.InstancedBufferAttribute(colB, 3));
    koiGeo.setAttribute('aPat', new THREE.InstancedBufferAttribute(pat, 4));
    koiGeo.setAttribute('aMotion', new THREE.InstancedBufferAttribute(mot, 4));

    koiMesh = new THREE.InstancedMesh(koiGeo, koiMat, n);
    koiMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Nine fish in three known basins: culling them costs more bookkeeping than
    // it saves, and a stale instance bounding sphere pops them out of frame.
    koiMesh.frustumCulled = false;
    koiMesh.name = 'koi';
    koiMesh.renderOrder = 5;   // after the water: see the submersion tint above
    group.add(koiMesh);
  }

  /* ── margins ─────────────────────────────────────────────── */
  function buildMargins() {
    const padInst = [], padTrim = [], reedInst = [], reedTrim = [];

    for (const b of basins) {
      const padCount = Math.round(propBudget * 0.10 * (b.meanR / 6));
      const reedCount = Math.round(propBudget * 0.16);

      for (let i = 0; i < padCount; i++) {
        const ang = R.range(rng, 0, TAU);
        const sh = shoreAt(b, ang);
        const r = sh * R.range(rng, 0.30, 0.86);
        const x = b.x + Math.cos(ang) * r;
        const z = b.z + Math.sin(ang) * r;
        // Lilies root in the shallows and float; skip anywhere the bed is dry.
        if (b.waterY - sampleHeight(x, z) < 0.25) continue;
        padInst.push(x, b.waterY + 0.012, z, R.range(rng, 0.34, 0.72));
        padTrim.push(R.range(rng, 0, TAU), R.range(rng, 0, TAU), rng(), R.range(rng, 0.5, 1.2));
      }

      for (let i = 0; i < reedCount; i++) {
        const ang = R.range(rng, 0, TAU);
        // Reeds grow in stands, not as a fringe: a low-frequency band around the
        // shore decides where they take, so most of the bank stays open.
        const stand = fbm2(Math.cos(ang) * 2.2 + b.x * 0.05, Math.sin(ang) * 2.2 + b.z * 0.05, 2);
        if (stand < 0.02) continue;
        const sh = shoreAt(b, ang);
        const r = sh + R.range(rng, -0.9, 0.7);
        const x = b.x + Math.cos(ang) * r;
        const z = b.z + Math.sin(ang) * r;
        // Rooted in the GROUND, not at the waterline. Clamping the base to
        // waterY buried every stand on the dry bank: the bank climbs 0.15-0.45
        // over the half-metre outside the shore, which is most of a reed.
        const g = sampleHeight(x, z);
        reedInst.push(x, g - 0.06, z, R.range(rng, 0.7, 1.35));
        reedTrim.push(R.range(rng, 0, TAU), R.range(rng, 0, TAU), rng(), R.range(rng, 0.6, 1.0));
      }
    }

    if (padInst.length) {
      padGeo = makeLilyPadGeometry();
      padGeo.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(padInst), 4));
      padGeo.setAttribute('aTrim', new THREE.InstancedBufferAttribute(new Float32Array(padTrim), 4));
      padMesh = new THREE.InstancedMesh(padGeo, marginMat, padInst.length / 4);
      padMesh.frustumCulled = false;
      padMesh.name = 'lily-pads';
      // Pads and reeds are opaque, so they draw before the water whatever the
      // render order says. They come out right anyway because the water writes
      // no depth: a pad floating above the surface wins the depth test and the
      // water never tints it, while the drowned half of a reed correctly loses.
      group.add(padMesh);
    }
    if (reedInst.length) {
      reedGeo = makeReedTuftGeometry(rng);
      reedGeo.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(reedInst), 4));
      reedGeo.setAttribute('aTrim', new THREE.InstancedBufferAttribute(new Float32Array(reedTrim), 4));
      reedMesh = new THREE.InstancedMesh(reedGeo, marginMat, reedInst.length / 4);
      reedMesh.frustumCulled = false;
      reedMesh.name = 'reeds';
      group.add(reedMesh);
    }

    // Every instance sits at the origin; aInst does the placing.
    const identity = new THREE.Matrix4();
    for (const m of [padMesh, reedMesh]) {
      if (!m) continue;
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, identity);
      m.instanceMatrix.needsUpdate = true;
    }
  }

  function shoreAt(b, ang) {
    const f = ((ang + Math.PI) / TAU) * SHORE_N;
    const i0 = ((f | 0) % SHORE_N + SHORE_N) % SHORE_N;
    const t = f - Math.floor(f);
    const a = b.shore[i0], c = b.shore[(i0 + 1) % SHORE_N];
    return a + (c - a) * t;
  }

  /* ── attach ──────────────────────────────────────────────── */
  function attach(opts = {}) {
    if (opts.heightAt) sampleHeight = opts.heightAt;
    if (!sampleHeight) return;

    for (let i = 0; i < basins.length; i++) {
      const b = measure(basins[i]);
      PONDS[i].radius = b.meanR;
      PONDS[i].waterY = b.waterY;
      PONDS[i].depth = b.maxDepth;
    }

    waterMesh = new THREE.Mesh(buildWater(), waterMat);
    waterMesh.name = 'pond-water';
    waterMesh.renderOrder = 3;
    group.add(waterMesh);

    buildKoi();
    buildMargins();
  }

  /* ── per-frame ───────────────────────────────────────────── */
  const _pos = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _upW = new THREE.Vector3(0, 1, 0);
  const _scale = new THREE.Vector3();
  const _mat = new THREE.Matrix4();

  /** Path point for a koi at parameter theta, written into out.x / out.z. */
  function pathAt(k, theta, out) {
    const px = k.ox + k.a * Math.cos(theta) + k.h1 * Math.cos(2 * theta + k.f1) + k.h2 * Math.cos(3 * theta + k.f2);
    const pz = k.oz + k.b * Math.sin(theta) + k.h1 * Math.sin(2 * theta + k.f3) + k.h2 * Math.sin(3 * theta + k.f4);
    const c = Math.cos(k.rot), s = Math.sin(k.rot);
    out.x = px * c - pz * s;
    out.z = px * s + pz * c;
  }

  function update(t, dt, phase) {
    if (phase) {
      const dir = phase.keyDir || phase.sunDirection;
      const col = phase.keyColor || phase.sunColor;
      const k = (phase.keyIntensity ?? 1) * SHADER_LIGHT_SCALE;

      if (dir) {
        waterUniforms.uKeyDir.value.copy(dir);
        koiUniforms.uKeyDir.value.copy(dir);
        marginUniforms.uKeyDir.value.copy(dir);
      }
      if (col) {
        waterUniforms.uKeyColor.value.setRGB(col.r * k, col.g * k, col.b * k);
        koiUniforms.uKeyColor.value.setRGB(col.r * k, col.g * k, col.b * k);
        marginUniforms.uKeyColor.value.setRGB(col.r * k, col.g * k, col.b * k);
      }
      if (phase.skyColor) {
        waterUniforms.uSkyColor.value.copy(phase.skyColor);
        const a = phase.ambient ?? 1;
        const ar = phase.skyColor.r * a, ag = phase.skyColor.g * a, ab = phase.skyColor.b * a;
        // The koi keep a small floor on top of the sky term: moonlit fish should
        // be dim, not absent, and nothing else in the pond is worth seeing then.
        koiUniforms.uAmbient.value.setRGB(ar * 0.9 + 0.06, ag * 0.9 + 0.06, ab * 0.9 + 0.06);
        waterUniforms.uAmbient.value.setRGB(ar, ag, ab);
        marginUniforms.uAmbient.value.setRGB(ar, ag, ab);
      }
      if (phase.fogColor) waterUniforms.uHorizon.value.copy(phase.fogColor);
      // Straight down the pond is a window; at grazing angles it is a mirror.
      // Night pushes the mirror harder: there is nothing to see in the water.
      waterUniforms.uReflect.value = 0.66 + 0.22 * (phase.night ?? 0);
    }

    if (!koiMesh) return;

    for (let i = 0; i < koi.length; i++) {
      const k = koi[i];
      const b = basins[k.pond];

      k.theta += dt * k.rate * (1 + 0.4 * Math.sin(t * 0.23 + k.f1));
      pathAt(k, k.theta, _pos);
      const x = b.x + _pos.x, z = b.z + _pos.z;

      // A long calm with occasional rises: the eighth power leaves the fish deep
      // most of the time and brings it up in short, distinct events.
      const prevRise = k.rise;
      k.rise = Math.pow(0.5 + 0.5 * Math.sin(t * k.riseRate * TAU + k.risePhase), 8);
      let y = b.waterY - k.cruise * (1 - k.rise) + 0.03 * k.rise;
      const bed = sampleHeight(x, z) + 0.16;
      if (y < bed) y = bed;

      if (k.rise > 0.62 && prevRise <= 0.62) spawnRipple(x, z, t, 0.7 + 0.5 * k.scale);

      // Forward from the path derivative, with the vertical rate folded in so a
      // rising fish noses up instead of sliding sideways at a constant pitch.
      pathAt(k, k.theta + 0.05 * Math.sign(k.rate), _fwd);
      let fx = b.x + _fwd.x - x, fz = b.z + _fwd.z - z;
      const flen = Math.hypot(fx, fz) || 1;
      fx /= flen; fz /= flen;

      const heading = Math.atan2(fx, fz);
      let dHead = heading - k.heading;
      while (dHead > Math.PI) dHead -= TAU;
      while (dHead < -Math.PI) dHead += TAU;
      k.heading = heading;

      // Bank into the turn, eased so the roll lags the yaw the way a body does.
      const targetBank = clamp(-dHead / Math.max(dt, 1e-3) * 0.55, -0.55, 0.55);
      k.bank += (targetBank - k.bank) * Math.min(1, dt * 3.2);

      const climb = clamp((y - k.prevY) / Math.max(dt, 1e-3) * 0.5, -0.7, 0.7);
      k.prevY = y;
      k.x = x; k.y = y; k.z = z;

      _fwd.set(fx, climb, fz).normalize();
      _right.crossVectors(_upW, _fwd).normalize();
      _up.crossVectors(_fwd, _right);

      const cb = Math.cos(k.bank), sb = Math.sin(k.bank);
      _right.multiplyScalar(cb).addScaledVector(_up, sb).normalize();
      _up.crossVectors(_fwd, _right).normalize();

      _mat.makeBasis(_right, _up, _fwd);
      _scale.set(k.scale, k.scale, k.scale);
      _mat.scale(_scale);
      _mat.setPosition(x, y, z);
      koiMesh.setMatrixAt(i, _mat);
    }
    koiMesh.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    for (const g of [koiGeo, padGeo, reedGeo]) g?.dispose();
    waterMesh?.geometry.dispose();
    waterMat.dispose();
    koiMat.dispose();
    marginMat.dispose();
    for (const m of [koiMesh, padMesh, reedMesh]) m?.dispose();
    group.clear();
  }

  return { group, PONDS, carvePonds, isInPond, attach, update, dispose };
}
