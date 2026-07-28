/**
 * shiba.js — the playable Shiba Inu.
 *
 * A procedural dog: no glTF, no rig, no textures, in keeping with the rest of the
 * scene. The whole animal is tapered tubes swept along hand-authored centrelines
 * and painted per-vertex, hung off a hierarchy of Object3Ds that a few sine waves
 * drive. That sounds crude for a character, but a shiba is carried almost entirely
 * by silhouette and by two colours — a curled tail on the back, small forward-set
 * triangular ears, a blunt muzzle, and the cream *urajiro* running under the jaw,
 * chest, belly and tail against a red coat. Get those and it is unmistakable at
 * fifty metres; miss them and no amount of skinning will save it.
 *
 * Scale is a deliberate lie. A real shiba stands 0.4 units at the withers in this
 * world, which is shorter than a blade of grass (0.55) and invisible from any
 * camera that also shows the island. He is built at roughly twice life size so he
 * reads as a character rather than as a speck, and still sits comfortably under a
 * 7-unit cherry tree.
 */

import * as THREE from 'three';
import { streamFor, R, clamp, mix, smoothstep } from './noise.js';
import { WORLD, LAND_SCALE } from './config.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/* ── art direction ───────────────────────────────────────────────
 * An *aka* (red) shiba. The coat is not one colour: the saddle over the back is
 * deeper than the flanks, and the whole underside is cream. That cream is the
 * urajiro marking and it is the single most recognisable thing about the breed
 * after the tail — a uniformly ginger dog reads as a fox or a corgi. */
const COAT = {
  red: new THREE.Color(0xd98b45),
  saddle: new THREE.Color(0xb96f2f),
  cream: new THREE.Color(0xf5ecdf),
  earIn: new THREE.Color(0xdca877),
  dark: new THREE.Color(0x2a2420),
  tongue: new THREE.Color(0xd4736f),
};

const SHIBA = {
  /**
   * Heroic scale. At 1.0 he is roughly life size against 7-unit cherry trees and
   * 0.55-unit grass, which is correct and useless: he vanishes into the meadow
   * from any camera that also frames the island.
   */
  scale: 1.35,

  /**
   * How far the body centreline sits above the paws. The rig is authored with
   * the torso at the origin because that is where the spine wants to be for
   * animation, so the whole animal has to be lifted by its own leg length or it
   * stands knee-deep in the terrain. It must stay in step with the leg chain in
   * buildBody(): hip 0.10 + thigh 0.26 + shin 0.23 + pad 0.07.
   */
  standHeight: 0.66,

  walkSpeed: 6.4,
  runSpeed: 14.8,
  accel: 14.0,
  brake: 18.0,
  turnRate: 7.0,          // rad/s the body swings toward its heading
  /** Above this terrain slope he refuses to climb — cliffs are not for dogs. */
  maxSlope: 0.72,
  /** He will paddle down to here below sea level and no further. */
  wadeDepth: 0.34,
  idleBeforeSit: 4.2,     // seconds of stillness before he sits down
  footprintLife: 26.0,    // seconds a paw print survives in the sand
  footprintCount: 96,
};

/* ────────────────────────────────────────────────────────────────
   Geometry: one tapered tube builder, used for every part
   ──────────────────────────────────────────────────────────────── */

const _t0 = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _qt = new THREE.Quaternion();
const _off = new THREE.Vector3();

/**
 * Sweep an elliptical cross-section along a polyline.
 *
 * Frames are parallel-transported rather than rebuilt from a fixed up-vector:
 * the tail curls back over itself through more than 270 degrees, and a naive
 * frame flips somewhere in the middle of that arc and puts a visible crease and
 * a twisted colour band right where the eye goes first.
 *
 * @param {THREE.Vector3[]} pts  centreline, at least 2 points
 * @param {object} o
 * @param {number}   [o.radial]  cross-section segments
 * @param {Function} o.radius    (u) => [halfWidth, halfHeight] at u in 0..1
 * @param {Function} o.color     (u, upness, out) => void, upness in -1..1
 */
function sweep(pts, o) {
  const radial = o.radial ?? 10;
  const n = pts.length;

  const tangents = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    tangents.push(new THREE.Vector3().subVectors(b, a).normalize());
  }

  const normals = [];
  const binormals = [];
  const seed0 = Math.abs(tangents[0].y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  normals.push(new THREE.Vector3().crossVectors(tangents[0], seed0).normalize());
  binormals.push(new THREE.Vector3().crossVectors(tangents[0], normals[0]).normalize());
  for (let i = 1; i < n; i++) {
    _qt.setFromUnitVectors(tangents[i - 1], tangents[i]);
    const nrm = normals[i - 1].clone().applyQuaternion(_qt).normalize();
    normals.push(nrm);
    binormals.push(new THREE.Vector3().crossVectors(tangents[i], nrm).normalize());
  }

  const vCount = n * (radial + 1) + 2; // +2 for the end cap centres
  const position = new Float32Array(vCount * 3);
  const color = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const c = new THREE.Color();
  let w = 0;

  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);
    const r = o.radius(u);
    const rx = r[0], ry = r[1];
    for (let s = 0; s <= radial; s++) {
      const a = (s / radial) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      _off.copy(normals[i]).multiplyScalar(ca * rx)
        .addScaledVector(binormals[i], sa * ry);
      const p = w * 3;
      position[p] = pts[i].x + _off.x;
      position[p + 1] = pts[i].y + _off.y;
      position[p + 2] = pts[i].z + _off.z;
      // How much this ring vertex faces the sky. This is what the urajiro is
      // painted from, so it has to be the WORLD up and not the local frame.
      const len = Math.max(1e-5, _off.length());
      o.color(u, _off.y / len, c);
      color[p] = c.r; color[p + 1] = c.g; color[p + 2] = c.b;
      uv[w * 2] = s / radial;
      uv[w * 2 + 1] = u;
      w++;
    }
  }

  const capA = w, capB = w + 1;
  for (const [idx, i] of [[capA, 0], [capB, n - 1]]) {
    const p = idx * 3;
    position[p] = pts[i].x; position[p + 1] = pts[i].y; position[p + 2] = pts[i].z;
    o.color(i === 0 ? 0 : 1, 0, c);
    color[p] = c.r; color[p + 1] = c.g; color[p + 2] = c.b;
  }
  w += 2;

  // Winding: the ring runs anticlockwise about the tangent, so listing a quad in
  // ring-order-then-forward gives INWARD faces. computeVertexNormals() follows
  // the winding, so getting this backwards does not produce a visible seam — it
  // produces a dog lit from the inside out, which is much harder to diagnose.
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a0 = i * (radial + 1);
    const b0 = (i + 1) * (radial + 1);
    for (let s = 0; s < radial; s++) {
      idx.push(a0 + s, a0 + s + 1, b0 + s);
      idx.push(a0 + s + 1, b0 + s + 1, b0 + s);
    }
  }
  for (let s = 0; s < radial; s++) {
    idx.push(capA, s + 1, s);
    const last = (n - 1) * (radial + 1);
    idx.push(capB, last + s, last + s + 1);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A polyline through the given [x,y,z] triples, resampled to `n` points. */
function spine(triples, n) {
  const curve = new THREE.CatmullRomCurve3(
    triples.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'catmullrom', 0.4
  );
  return curve.getSpacedPoints(n - 1);
}

/**
 * Give a primitive geometry a flat vertex colour. The whole animal shares one
 * `vertexColors: true` material, and a geometry with no `color` attribute reads
 * black through it — which happens to look right on a nose and very wrong on a
 * paw, so it is not something to leave to luck.
 */
function paintSolid(geo, col) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

/** Blend the coat colours by how much a surface faces up. */
function coatAt(upness, out, creamBias = 0) {
  const k = smoothstep(-0.55 + creamBias, 0.15 + creamBias, upness);
  out.copy(COAT.cream).lerp(COAT.red, k);
  // The saddle over the spine is a shade deeper than the flanks.
  if (upness > 0.45) out.lerp(COAT.saddle, smoothstep(0.45, 0.95, upness) * 0.55);
  return out;
}

/* ────────────────────────────────────────────────────────────────
   The animal
   ──────────────────────────────────────────────────────────────── */

/**
 * Assemble the whole dog. Returns the root plus every node the animation needs
 * to reach, so `update()` never has to search the graph by name.
 */
function buildBody(material) {
  const parts = [];
  const mesh = (geo, parent, name) => {
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    parts.push(geo);
    return m;
  };

  const root = new THREE.Group();
  root.name = 'shiba';

  /* The nodes the gait drives. Keeping tilt / bob / body separate means terrain
   * alignment, the walk bounce and the lean into a turn compose instead of
   * fighting over one transform. */
  const tilt = new THREE.Object3D(); root.add(tilt);
  tilt.position.y = SHIBA.standHeight;
  const body = new THREE.Object3D(); tilt.add(body);

  /* — torso —
   * Deep chest at the shoulder, tucked waist, and a slight rise over the croup.
   * A shiba is squarely built: as tall at the withers as it is long in the back,
   * which is what keeps it from reading as a fox. */
  const torso = spine([
    [0, 0.00, -0.55], [0, 0.05, -0.30], [0, 0.07, 0.00],
    [0, 0.08, 0.24], [0, 0.04, 0.45],
  ], 22);
  mesh(sweep(torso, {
    radial: 14,
    // Narrow and deep rather than round. A tube with equal radii reads as a
    // sausage; the 0.80 / 1.12 split is what gives him a keel-shaped chest and a
    // profile you can recognise from the side.
    radius: (u) => {
      const chest = 0.205 * (0.72 + 0.44 * Math.sin(Math.PI * Math.min(1, (u + 0.12) * 0.95)));
      const waist = 1 - 0.22 * Math.exp(-((u - 0.42) ** 2) / 0.02);
      return [chest * waist * 0.80, chest * waist * 1.12];
    },
    color: (u, up, out) => coatAt(up, out, -0.10 + 0.30 * smoothstep(0.55, 1.0, u)),
  }), body, 'torso');

  /* — neck and head —
   * The neck is short and thick and carried high; the head sits forward of the
   * chest rather than on top of it. */
  const neck = new THREE.Object3D();
  neck.position.set(0, 0.09, 0.38);
  body.add(neck);

  mesh(sweep(spine([
    [0, -0.04, -0.08], [0, 0.06, 0.05], [0, 0.14, 0.17],
  ], 8), {
    radial: 12,
    // Short and thick, and it overlaps the shoulder rather than meeting it — the
    // ruff around a shiba's neck is dense enough that there is no visible join.
    radius: (u) => { const r = 0.215 - 0.045 * u; return [r * 0.90, r]; },
    color: (u, up, out) => coatAt(up, out, -0.05),
  }), neck, 'neck');

  const head = new THREE.Object3D();
  head.position.set(0, 0.15, 0.18);
  neck.add(head);

  /* Skull and muzzle in one sweep so the stop between them is a smooth
   * narrowing rather than a seam. The cream mask is painted by biasing the
   * urajiro threshold hard toward cream over the front third — that is the
   * blunt pale muzzle and the cheek flashes, and it is doing more work for
   * recognisability than the geometry under it. */
  mesh(sweep(spine([
    [0, 0.00, -0.17], [0, 0.035, -0.03], [0, 0.02, 0.10],
    [0, -0.025, 0.20], [0, -0.04, 0.27],
  ], 14), {
    radial: 14,
    // The muzzle is SHORT and stops blunt. Taper it much past this and the whole
    // animal turns into a fox, which is the failure mode every stylised shiba
    // falls into.
    radius: (u) => {
      const r = 0.235 * (1 - 0.50 * smoothstep(0.28, 0.92, u));
      return [r * (1 - 0.12 * u), r * (1 - 0.20 * u)];
    },
    color: (u, up, out) => coatAt(up, out, -0.15 + 1.05 * smoothstep(0.38, 0.82, u)),
  }), head, 'skull');

  const nose = mesh(paintSolid(new THREE.SphereGeometry(0.055, 10, 8), COAT.dark), head, 'nose');
  nose.position.set(0, -0.04, 0.30);
  nose.scale.set(1.15, 0.85, 0.9);

  for (const side of [-1, 1]) {
    // The skull sweep's surface at eye height sits at |x| ≈ 0.114 — anything
    // inboard of that is buried inside the head. Proud by ~half the sphere.
    const eye = mesh(paintSolid(new THREE.SphereGeometry(0.038, 10, 8), COAT.dark), head, 'eye');
    eye.position.set(side * 0.120, 0.058, 0.148);
    eye.scale.set(0.72, 1.0, 0.62);
    // A pin of light: without it a dark eye on a dark mask reads as fur.
    const glint = mesh(paintSolid(new THREE.SphereGeometry(0.010, 6, 5), new THREE.Color(0xf6f2ea)), head, 'eye-glint');
    glint.position.set(side * 0.127, 0.070, 0.162);
  }

  /* — ears —
   * Small, thick, triangular, and tipped FORWARD. Ears that stand straight up
   * make an akita or a husky; the forward set is the shiba. */
  const ears = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Object3D();
    pivot.position.set(side * 0.125, 0.155, -0.035);
    pivot.rotation.set(-0.32, side * 0.34, side * 0.20);
    head.add(pivot);
    mesh(sweep(spine([
      [0, 0.00, 0], [0, 0.10, 0.014], [0, 0.20, 0.024],
    ], 6), {
      radial: 3,
      radius: (u) => { const r = 0.125 * (1 - u * 0.92); return [r, r * 0.45]; },
      color: (u, up, out) => {
        out.copy(up < -0.1 ? COAT.earIn : COAT.red);
        out.lerp(COAT.dark, smoothstep(0.62, 1.0, u) * 0.45);
      },
    }), pivot, 'ear');
    ears.push(pivot);
  }

  /* — tail —
   * The signature. It leaves the croup, sweeps up and forward, and curls back on
   * itself so the tip points down at the flank. It has to sit ON the back, not
   * float above it, or the whole silhouette collapses into "generic dog". */
  const tailBase = new THREE.Object3D();
  tailBase.position.set(0, 0.11, -0.51);
  body.add(tailBase);
  mesh(sweep(spine([
    [0.00, 0.02, 0.00], [0.02, 0.20, 0.06], [0.05, 0.34, 0.22],
    [0.04, 0.36, 0.40], [-0.03, 0.28, 0.48], [-0.10, 0.18, 0.42],
    [-0.13, 0.12, 0.30],
  ], 20), {
    radial: 10,
    // Plumed: thin at the root, thickest through the curl, tapering at the tip.
    radius: (u) => {
      const r = 0.075 + 0.075 * Math.sin(Math.PI * Math.min(1, u * 1.15));
      return [r, r];
    },
    color: (u, up, out) => coatAt(up, out, -0.30),
  }), tailBase, 'tail');

  /* — legs —
   * Straight column in front, angulated behind. Cream socks: the urajiro runs
   * down the inside of the leg and over the foot, which is why the feet catch
   * the eye when he trots. */
  const legs = [];
  const legSpec = [
    { key: 'FL', x: -0.150, z: 0.29, front: true },
    { key: 'FR', x: 0.150, z: 0.29, front: true },
    { key: 'BL', x: -0.155, z: -0.35, front: false },
    { key: 'BR', x: 0.155, z: -0.35, front: false },
  ];

  for (const s of legSpec) {
    const hip = new THREE.Object3D();
    hip.position.set(s.x, s.front ? -0.10 : -0.06, s.z);
    body.add(hip);

    const upperLen = s.front ? 0.26 : 0.28;
    mesh(sweep(spine(
      s.front
        ? [[0, 0, 0], [0, -upperLen * 0.5, 0.01], [0, -upperLen, 0.0]]
        : [[0, 0, 0], [0, -upperLen * 0.5, -0.055], [0, -upperLen, -0.07]],
      7), {
      radial: 8,
      radius: (u) => { const r = 0.130 - 0.045 * u; return [r * 0.85, r]; },
      color: (u, up, out) => coatAt(up, out, 0.15 + 0.40 * u),
    }), hip, 'thigh');

    const knee = new THREE.Object3D();
    knee.position.set(0, -upperLen, s.front ? 0 : -0.07);
    hip.add(knee);

    const lowerLen = s.front ? 0.23 : 0.25;
    mesh(sweep(spine(
      s.front
        ? [[0, 0, 0], [0, -lowerLen, 0.0]]
        : [[0, 0, 0], [0, -lowerLen * 0.55, 0.045], [0, -lowerLen, 0.055]],
      6), {
      radial: 7,
      // Starts a hair WIDER than the thigh ends (0.085), so the knee reads as a
      // joint rather than as a step down onto a thinner pipe.
      radius: (u) => { const r = 0.092 - 0.032 * u; return [r * 0.85, r]; },
      // Socks, not stockings. The cream starts low on the cannon bone; running
      // it all the way up the leg turns him into a beagle.
      color: (u, up, out) => { out.copy(COAT.red).lerp(COAT.cream, smoothstep(0.30, 0.80, u)); },
    }), knee, 'shin');

    const paw = mesh(paintSolid(new THREE.SphereGeometry(0.082, 8, 6), COAT.cream), knee, 'paw');
    paw.position.set(0, -lowerLen - 0.005, s.front ? 0.02 : 0.06);
    paw.scale.set(0.95, 0.66, 1.20);

    legs.push({ key: s.key, front: s.front, hip, knee, paw });
  }

  return { root, tilt, body, neck, head, ears, tailBase, legs, parts };
}

/* ────────────────────────────────────────────────────────────────
   Footprints
   ──────────────────────────────────────────────────────────────── */

/**
 * A ring buffer of paw prints stamped into wet sand, fading out over half a
 * minute. Instanced with a per-instance birth time so the fade costs one
 * subtraction in the fragment stage instead of a CPU pass over the buffer.
 */
function createFootprints(count, life) {
  const geo = new THREE.PlaneGeometry(0.30, 0.34);
  geo.rotateX(-Math.PI / 2);
  const born = new Float32Array(count).fill(-1e9);
  geo.setAttribute('aBorn', new THREE.InstancedBufferAttribute(born, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLife: { value: life },
      uColor: { value: new THREE.Color(0x6a5540) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aBorn;
      varying vec2 vUv;
      varying float vBorn;
      // instanceMatrix is declared for us by three whenever the material is used
      // on an InstancedMesh. The matrices stamped into it are WORLD space, which
      // is only equivalent to this because the mesh hangs off an untransformed
      // group — the prints stay where they were left rather than following the
      // dog around, which is rather the point of a footprint.
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
      uniform vec3  uColor;
      varying vec2 vUv;
      varying float vBorn;

      float pad(vec2 p, vec2 c, vec2 r) {
        vec2 d = (p - c) / r;
        return 1.0 - smoothstep(0.62, 1.0, length(d));
      }

      void main() {
        float age = uTime - vBorn;
        if (age < 0.0 || age > uLife) discard;
        vec2 p = vUv;
        // One metacarpal pad and four toes. Drawn rather than modelled because a
        // print is a stain, not a surface: geometry this small z-fights the
        // terrain at any distance where you could actually see the shape.
        float m = pad(p, vec2(0.50, 0.34), vec2(0.20, 0.17));
        m = max(m, pad(p, vec2(0.34, 0.62), vec2(0.085, 0.10)));
        m = max(m, pad(p, vec2(0.45, 0.72), vec2(0.085, 0.10)));
        m = max(m, pad(p, vec2(0.57, 0.72), vec2(0.085, 0.10)));
        m = max(m, pad(p, vec2(0.68, 0.60), vec2(0.085, 0.10)));
        float fade = 1.0 - age / uLife;
        float a = m * fade * fade * 0.55;
        if (a < 0.005) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.name = 'shiba-footprints';
  mesh.frustumCulled = false;   // instances move; the baked bounds go stale
  mesh.renderOrder = 2;         // over the terrain, under the ocean's blend
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Park every instance far below the seabed until it is first used, so the
  // untouched half of the buffer never draws over anything.
  const m4 = new THREE.Matrix4().makeTranslation(0, -9999, 0);
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, m4);
  mesh.instanceMatrix.needsUpdate = true;

  return { mesh, born, cursor: 0, material, geo };
}

/* ────────────────────────────────────────────────────────────────
   Factory
   ──────────────────────────────────────────────────────────────── */

/**
 * @param {object}   opts
 * @param {number}   [opts.seed]
 * @param {Function} opts.heightAt   (x, z) => y
 * @param {Function} [opts.slopeAt]  (x, z) => 0..1
 * @param {Function} [opts.normalAt] (x, z, out) => Vector3
 * @param {Function} [opts.isInPond] (x, z) => bool — ponds and river both count
 * @param {Function} [opts.deckHeightAt] (x, z) => y|null — bridge deck walkable height
 * @param {Function} [opts.deckNormalAt] (x, z, out) => bool — deck normal into out
 * @param {object}   [opts.wind]     from createWind(); read for ear and tail flutter
 * @param {number}   [opts.seaLevel]
 */
export function createShiba({
  seed = 1337,
  heightAt,
  slopeAt = null,
  normalAt = null,
  isInPond = null,
  deckHeightAt = null,
  deckNormalAt = null,
  waterSurfaceAt = null,
  wind = null,
  seaLevel = WORLD.seaLevel,
} = {}) {
  if (typeof heightAt !== 'function') {
    throw new Error('[shiba] createShiba requires heightAt(x, z) -> y');
  }

  const rng = streamFor(seed, 'shiba');

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
    flatShading: false,
  });

  const rig = buildBody(material);
  const group = new THREE.Group();
  group.name = 'shiba-rig';
  group.add(rig.root);
  rig.root.scale.setScalar(SHIBA.scale);

  const prints = createFootprints(SHIBA.footprintCount, SHIBA.footprintLife);
  group.add(prints.mesh);

  /* ── state ─────────────────────────────────────────────────── */
  const position = new THREE.Vector3(18 * LAND_SCALE, 0, 44 * LAND_SCALE);
  position.y = heightAt(position.x, position.z);

  const state = {
    heading: Math.PI * 0.9,
    speed: 0,
    moving: false,
    running: false,
    wading: false,
    sitting: 0,        // 0..1 blend, not a boolean — he folds down over ~0.8 s
    excitement: 0,     // decays after a run; drives the tail
    tailPhase: 0,      // integrated wag phase — sin(t*rate) with a moving rate whips
    vy: 0,             // vertical velocity while airborne
    airborne: false,
    idleTime: 0,
    gait: 0,           // accumulated stride phase in radians
  };

  /* ── input ─────────────────────────────────────────────────── */
  // Keyed off event.code, not event.key: code is the PHYSICAL key, so the same
  // three lines give WASD on QWERTY and ZQSD on AZERTY without a layout table.
  const MOVE_CODES = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ]);
  const held = new Set();
  let enabled = true;
  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    held.add(e.code);
    if (MOVE_CODES.has(e.code)) e.preventDefault();
  };
  const onKeyUp = (e) => held.delete(e.code);
  const onBlur = () => held.clear();
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', onBlur);

  /* ── scratch ───────────────────────────────────────────────── */
  const _n = new THREE.Vector3();
  const _qAlign = new THREE.Quaternion();
  const _qYaw = new THREE.Quaternion();
  const _qWant = new THREE.Quaternion();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _wish = new THREE.Vector3();
  const _probe = new THREE.Vector3();
  const _m4 = new THREE.Matrix4();
  const _pawWorld = new THREE.Vector3();
  const _printQ = new THREE.Quaternion();
  const _printSpin = new THREE.Quaternion();
  const _printS = new THREE.Vector3(1, 1, 1);

  const legPlanted = [true, true, true, true];
  let printClock = 0;

  /** Head-up idle beat: he looks up at the falling petals now and then. */
  let lookUpTimer = R.range(rng, 3, 9);
  let lookUp = 0;

  /* ── terrain queries ───────────────────────────────────────── */

  /** Can he stand here? Deep water and cliffs say no; the bridge deck says yes. */
  function passable(x, z) {
    if (deckHeightAt) {
      const d = deckHeightAt(x, z);
      if (d !== null && position.y > d - 2.0) {
        // At deck level the planks are always standable. This must short-circuit
        // the water and slope tests: the river below the deck and the carved
        // channel's bank slopes would otherwise both refuse the crossing.
        // The y-gate keeps a dog WADING UNDER the bridge on the terrain rules.
        return true;
      }
      if (d === null) {
        const dHere = deckHeightAt(position.x, position.z);
        if (dHere !== null && position.y > dHere - 2.0 && heightAt(x, z) < dHere - 1.2) {
          // Stepping sideways off the deck mid-span: the handrails contain him.
          // tryMove's axis-slide turns this refusal into gliding along the rail.
          return false;
        }
      }
    }
    // A mid-island river bed sits far above sea level, so the sea-level wade
    // rule never sees it: refuse any column where the ground lies under the
    // river's own water sheet (the bridge short-circuit above already let a
    // deck crossing through).
    if (waterSurfaceAt) {
      const w = waterSurfaceAt(x, z);
      if (w !== null && heightAt(x, z) < w - 0.18) return false;
    }
    const h = heightAt(x, z);
    if (h < seaLevel - SHIBA.wadeDepth) return false;
    if (isInPond && isInPond(x, z) && h < seaLevel + 0.1) return false;
    if (slopeAt && slopeAt(x, z) > SHIBA.maxSlope) return false;
    return true;
  }

  /**
   * Move toward `_wish`, sliding along whatever blocks it rather than stopping
   * dead. Walking a dog into a lake and having him stick to an invisible wall
   * looks broken; having him trot along the waterline looks like he decided not
   * to get wet.
   */
  function tryMove(dx, dz) {
    if (passable(position.x + dx, position.z + dz)) {
      position.x += dx; position.z += dz;
      return true;
    }
    if (passable(position.x + dx, position.z)) { position.x += dx; return true; }
    if (passable(position.x, position.z + dz)) { position.z += dz; return true; }
    return false;
  }

  /* ── animation ─────────────────────────────────────────────── */

  const legPhase = [0, Math.PI, Math.PI, 0]; // FL FR BL BR — a diagonal trot

  function animate(t, dt, speedN) {
    const sit = state.sitting;
    const stride = 5.2 + speedN * 7.5;
    state.gait += dt * stride * (0.25 + speedN);

    const swingAmp = 0.30 + 0.62 * speedN;
    const bounce = 1 - sit;

    for (let i = 0; i < 4; i++) {
      const leg = rig.legs[i];
      const ph = state.gait + legPhase[i];
      const s = Math.sin(ph);
      const lift = Math.max(0, -Math.cos(ph));

      if (sit > 0.02 && !leg.front) {
        // Sitting. Sign convention matters more than the magnitudes here: a
        // positive rotation.x swings a limb BACKWARD and pitches the nose DOWN,
        // because the model faces +Z. So the femur goes forward-and-down on a
        // negative angle and the tibia folds back under it on a positive one,
        // dropping the hock to the ground — which is what a dog actually sits on.
        leg.hip.rotation.x = mix(s * swingAmp * bounce, -0.85, sit);
        leg.knee.rotation.x = mix(-lift * swingAmp * 1.35 * bounce, 1.95, sit);
      } else if (sit > 0.02 && leg.front) {
        leg.hip.rotation.x = mix(s * swingAmp * bounce, 0.04, sit);
        leg.knee.rotation.x = mix(-lift * swingAmp * 1.35 * bounce, -0.04, sit);
      } else {
        leg.hip.rotation.x = s * swingAmp;
        leg.knee.rotation.x = -lift * swingAmp * 1.35;
      }

      // A paw plants on the downstroke. Used for footprints; also the moment the
      // body should take weight, which the bob below is phased against.
      const down = s < 0 && Math.cos(ph) > 0;
      if (down && !legPlanted[i]) {
        legPlanted[i] = true;
        if (state.moving) stampPrint(leg);
      } else if (!down) {
        legPlanted[i] = false;
      }
    }

    // Body carriage: bob at twice the stride, roll at once, and pitch up as he
    // sits so the chest lifts and the front legs straighten under him.
    rig.body.position.y = Math.sin(state.gait * 2) * 0.028 * speedN * bounce - 0.20 * sit;
    rig.body.rotation.z = Math.sin(state.gait) * 0.055 * speedN * bounce;
    rig.body.rotation.x = mix(-0.05 * speedN, -0.30, sit) + (state.airborne ? state.vy * 0.025 : 0);

    // Head. It leads the turn while moving, scans slowly when idle, and lifts
    // when something drifts past — the scene is full of falling petals and a dog
    // that never looks at them reads as furniture.
    lookUpTimer -= dt;
    if (lookUpTimer <= 0 && speedN < 0.05) {
      lookUp = 1;
      lookUpTimer = R.range(rng, 6, 15);
    }
    lookUp = Math.max(0, lookUp - dt * 0.55);
    const scan = Math.sin(t * 0.42) * 0.30 * (1 - speedN) * (0.4 + 0.6 * sit);
    rig.head.rotation.y = scan;
    rig.head.rotation.x = mix(-0.06 * speedN, -0.05, sit) - lookUp * 0.62;
    rig.neck.rotation.x = mix(0.0, -0.28, sit);

    // Tail. Wag rate tracks excitement, which spikes after a run and decays, so
    // he arrives somewhere still buzzing and settles down a few seconds later.
    // Integrate the phase: sin(t * wag) with a time-varying wag sweeps the
    // phase at wag + t * dwag/dt — at t in the hundreds of seconds the decay
    // after a run whipped the tail dozens of times too fast.
    const wag = 2.0 + state.excitement * 9.0;
    state.tailPhase += wag * dt;
    rig.tailBase.rotation.y = Math.sin(state.tailPhase) * (0.10 + 0.28 * state.excitement);
    rig.tailBase.rotation.x = -0.10 * speedN + 0.26 * sit; // the curl flattens onto the croup

    // Ears: laid back at speed, pricked at rest, and flicked by the gusts. The
    // wind is shared with the grass and the petals, so an ear twitch lands on the
    // same beat as the meadow going over.
    const gust = wind && wind.state ? wind.state.gust : 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const flick = Math.sin(t * 7.3 + i * 2.1) * gust * 0.16;
      rig.ears[i].rotation.x = -0.30 + 0.34 * speedN + flick;
      rig.ears[i].rotation.z = side * (0.20 + 0.10 * gust);
    }
  }

  /* ── footprints ────────────────────────────────────────────── */

  function stampPrint(leg) {
    leg.paw.getWorldPosition(_pawWorld);
    // No paw prints in the bridge planks (and none stamped on the riverbed
    // 4 units below the paw while he crosses).
    if (deckHeightAt) {
      const d = deckHeightAt(_pawWorld.x, _pawWorld.z);
      if (d !== null && position.y > d - 2.0) return;
    }
    const h = heightAt(_pawWorld.x, _pawWorld.z);
    // Sand only. Prints in grass are invisible and prints on rock are wrong.
    if (h > WORLD.beachTop || h < seaLevel - 0.05) return;

    if (normalAt) normalAt(_pawWorld.x, _pawWorld.z, _n); else _n.copy(UP);
    _printQ.setFromUnitVectors(UP, _n);
    _printSpin.setFromAxisAngle(UP, state.heading);
    _m4.compose(
      _probe.set(_pawWorld.x, h + 0.015, _pawWorld.z),
      _printQ.multiply(_printSpin),
      _printS
    );

    const i = prints.cursor;
    prints.mesh.setMatrixAt(i, _m4);
    prints.born[i] = printClock;
    prints.cursor = (i + 1) % SHIBA.footprintCount;
    prints.mesh.instanceMatrix.needsUpdate = true;
    prints.mesh.geometry.attributes.aBorn.needsUpdate = true;
  }

  /* ── frame ─────────────────────────────────────────────────── */

  /**
   * @param {number} t            elapsed seconds
   * @param {number} dt
   * @param {object} [ctx]
   * @param {THREE.Camera} [ctx.camera]  movement is camera-relative; without one
   *                                     the controls fall back to world axes
   */
  function update(t, dt, ctx = null) {
    printClock = t;
    prints.material.uniforms.uTime.value = t;

    const camera = ctx && ctx.camera ? ctx.camera : null;

    /* — read the sticks — */
    let fwdIn = 0, sideIn = 0;
    if (enabled) {
      if (held.has('KeyW') || held.has('ArrowUp')) fwdIn += 1;
      if (held.has('KeyS') || held.has('ArrowDown')) fwdIn -= 1;
      if (held.has('KeyA') || held.has('ArrowLeft')) sideIn -= 1;
      if (held.has('KeyD') || held.has('ArrowRight')) sideIn += 1;
    }
    state.running = held.has('ShiftLeft') || held.has('ShiftRight');

    /* — desired direction, in the camera's frame — */
    if (camera) {
      camera.getWorldDirection(_fwd);
      _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
      _fwd.normalize();
      _right.crossVectors(_fwd, UP).normalize();
    } else {
      _fwd.set(0, 0, 1);
      _right.set(1, 0, 0);
    }
    _wish.set(0, 0, 0)
      .addScaledVector(_fwd, fwdIn)
      .addScaledVector(_right, sideIn);

    const wants = _wish.lengthSq() > 1e-6;
    if (wants) _wish.normalize();

    /* — speed — */
    const top = state.running ? SHIBA.runSpeed : SHIBA.walkSpeed;
    const target = wants ? top : 0;
    const rate = target > state.speed ? SHIBA.accel : SHIBA.brake;
    state.speed += clamp(target - state.speed, -rate * dt, rate * dt);
    if (state.speed < 0.02) state.speed = 0;
    state.moving = state.speed > 0.05;

    /* — heading — */
    if (wants) {
      const want = Math.atan2(_wish.x, _wish.z);
      let d = want - state.heading;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      // Turn faster from a standstill than at a gallop: a dog pivots on the spot
      // but has to bank through a corner at speed.
      const agility = SHIBA.turnRate * (1.6 - 0.75 * (state.speed / SHIBA.runSpeed));
      state.heading += clamp(d, -agility * dt, agility * dt);
    }

    /* — translate — */
    if (state.moving) {
      const step = state.speed * dt * (state.wading ? 0.45 : 1);
      if (!tryMove(Math.sin(state.heading) * step, Math.cos(state.heading) * step)) {
        state.speed *= 0.4;
      }
    }

    const dHere = deckHeightAt ? deckHeightAt(position.x, position.z) : null;
    const onDeck = dHere !== null && position.y > dHere - 2.0;
    const ground = onDeck ? dHere : heightAt(position.x, position.z);
    state.wading = ground < seaLevel + 0.06;
    if (state.airborne) {
      // Ballistic: gravity only, land when the arc meets the ground (deck
      // included - you can hop onto the bridge planks).
      state.vy -= 26 * dt;
      position.y += state.vy * dt;
      if (position.y <= ground) { position.y = ground; state.vy = 0; state.airborne = false; }
    } else {
      // Settle onto the ground rather than snapping: a hard clamp to heightAt makes
      // him judder over the terrain's triangle edges at speed.
      position.y += (ground - position.y) * Math.min(1, dt * 18);
    }

    /* — sit / stand — */
    state.idleTime = state.moving ? 0 : state.idleTime + dt;
    const wantSit = state.idleTime > SHIBA.idleBeforeSit ? 1 : 0;
    state.sitting += clamp(wantSit - state.sitting, -dt * 3.0, dt * 1.35);
    state.sitting = clamp(state.sitting, 0, 1);

    /* — excitement — */
    const speedN = clamp(state.speed / SHIBA.runSpeed, 0, 1);
    state.excitement = clamp(
      state.excitement + (speedN > 0.55 ? dt * 0.9 : -dt * 0.22), 0, 1
    );

    /* — place and align — */
    rig.root.position.copy(position);
    rig.root.position.y -= 0.04 * state.sitting;

    if (!(onDeck && deckNormalAt && deckNormalAt(position.x, position.z, _n))) {
      if (normalAt) normalAt(position.x, position.z, _n); else _n.copy(UP);
    }
    // Only partly conform to the slope. A quadruped standing on a hillside keeps
    // its body far closer to level than the ground under it; aligning fully makes
    // him look magnetised to the terrain.
    _n.lerp(UP, 0.42).normalize();
    _qAlign.setFromUnitVectors(UP, _n);
    _qYaw.setFromAxisAngle(UP, state.heading);
    _qWant.copy(_qAlign).multiply(_qYaw);
    rig.root.quaternion.slerp(_qWant, Math.min(1, dt * 12));

    animate(t, dt, speedN);
  }

  function dispose() {
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('blur', onBlur);
    for (const g of rig.parts) g.dispose();
    material.dispose();
    prints.geo.dispose();
    prints.material.dispose();
    prints.mesh.dispose();
  }

  return {
    group,
    position,          // live — read by the follow camera and by the birds
    state,
    update,
    dispose,
    jump() {
      if (!state.airborne && state.sitting < 0.3) { state.vy = 9.5; state.airborne = true; }
    },
    /** Suspend the controls without unmounting him — used by the free camera. */
    setEnabled(v) { enabled = !!v; if (!v) held.clear(); },
    get heading() { return state.heading; },
    get speed() { return state.speed; },
  };
}

export default createShiba;
