import * as THREE from 'three';
import { smoothstep } from './noise.js';
import { makeGrainBump } from './detailtex.js';

export const TAU = Math.PI * 2;
export const UP = new THREE.Vector3(0, 1, 0);

/* ── art direction ───────────────────────────────────────────────
 * An *aka* (red) shiba. The coat is not one colour: the saddle over the back is
 * deeper than the flanks, and the whole underside is cream. That cream is the
 * urajiro marking and it is the single most recognisable thing about the breed
 * after the tail — a uniformly ginger dog reads as a fox or a corgi. */
export const COAT = {
  red: new THREE.Color(0xd98b45),
  saddle: new THREE.Color(0xb96f2f),
  cream: new THREE.Color(0xf5ecdf),
  earIn: new THREE.Color(0xdca877),
  dark: new THREE.Color(0x2a2420),
  tongue: new THREE.Color(0xd4736f),
};

// Le gabarit de construction. standHeight n'est PAS un réglage libre : c'est la
// somme de la chaîne de patte (hipDrop + thigh + shin + pad). Raccourcir un
// segment sans corriger standHeight enfonce le chien dans le sol ou le fait
// flotter. Les deux vivent ici pour qu'on ne puisse plus les désynchroniser.
export const SHIBA_BUILD = { scale: 1.35, standHeight: 0.66, hipDrop: 0.10, thigh: 0.26, shin: 0.23, pad: 0.07 };

/** Generated coat grain for the shared material's bumpMap (bumpScale ≈ 0.02). */
export function makeCoatBump(seed) {
  const bump = makeGrainBump(seed);
  bump.repeat.set(6, 14);
  return bump;
}

/* ────────────────────────────────────────────────────────────────
   Geometry: one tapered tube builder, used for every part
   ──────────────────────────────────────────────────────────────── */

const _t0 = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _qt = new THREE.Quaternion();
const _off = new THREE.Vector3();
const _surface = new THREE.Vector3();

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
 * @param {Function} [o.profile] (u, angle) => scalar radius multiplier
 * @param {Function} o.color     (u, upness, out, point) => void, upness in -1..1
 */
export function sweep(pts, o) {
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
      const k = o.profile ? o.profile(u, a) : 1;
      _off.copy(normals[i]).multiplyScalar(ca * rx * k)
        .addScaledVector(binormals[i], sa * ry * k);
      const p = _surface.copy(pts[i]).add(_off);
      const v = w * 3;
      position[v] = p.x;
      position[v + 1] = p.y;
      position[v + 2] = p.z;
      // upness comes from the piece's local transported frame, not world space.
      // That happens to agree for axis-aligned build pivots only; a rotated-pivot
      // piece (the ears already are one) must paint from p instead of upness.
      const len = Math.max(1e-5, _off.length());
      o.color(u, _off.y / len, c, p);
      color[v] = c.r; color[v + 1] = c.g; color[v + 2] = c.b;
      uv[w * 2] = s / radial;
      uv[w * 2 + 1] = u;
      w++;
    }
  }

  const capA = w, capB = w + 1;
  for (const [idx, i] of [[capA, 0], [capB, n - 1]]) {
    const p = idx * 3;
    position[p] = pts[i].x; position[p + 1] = pts[i].y; position[p + 2] = pts[i].z;
    o.color(i === 0 ? 0 : 1, 0, c, _surface.copy(pts[i]));
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
  const normal = g.getAttribute('normal');
  for (let i = 0; i < n; i++) {
    const seam = i * (radial + 1);
    _t0.fromBufferAttribute(normal, seam).add(_t1.fromBufferAttribute(normal, seam + radial)).normalize();
    normal.setXYZ(seam, _t0.x, _t0.y, _t0.z); normal.setXYZ(seam + radial, _t0.x, _t0.y, _t0.z);
  }
  return g;
}

/** A polyline through the given [x,y,z] triples, resampled to `n` points. */
export function spine(triples, n) {
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
export function paintSolid(geo, col) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

/** Blend the coat colours by how much a surface faces up. */
export function coatAt(upness, out, creamBias = 0) {
  const k = smoothstep(-0.55 + creamBias, 0.15 + creamBias, upness);
  out.copy(COAT.cream).lerp(COAT.red, k);
  // The saddle over the spine is a shade deeper than the flanks.
  if (upness > 0.45) out.lerp(COAT.saddle, smoothstep(0.45, 0.95, upness) * 0.55);
  return out;
}

/** Low-relief tufts: periodic around the ring, tapered only along the piece. */
function tuftProfile(ampAt) {
  return (u, a) => 1 + ampAt(u) * (
    0.55 * Math.cos(6 * a) + 0.45 * Math.cos(11 * a + 3 * u)
  );
}

/* ────────────────────────────────────────────────────────────────
   The animal
   ──────────────────────────────────────────────────────────────── */

/**
 * Assemble the whole dog. Returns the root plus every node the animation needs
 * to reach, so `update()` never has to search the graph by name.
 */
export function buildBody(material) {
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
  tilt.position.y = SHIBA_BUILD.standHeight;
  const body = new THREE.Object3D(); tilt.add(body);

  /* — torso —
   * Deep chest at the shoulder, tucked waist, and a slight rise over the croup.
   * Bounding the swept surface (not just its author points) keeps the breed's
   * measured withers-height : body-length ratio at 10:11. */
  const torso = spine([
    [0, 0.00, -0.547], [0, 0.05, -0.298], [0, 0.07, 0.00],
    [0, 0.08, 0.239], [0, 0.04, 0.447],
  ], 22);
  mesh(sweep(torso, {
    radial: 16,
    // Narrow and deep rather than round. A tube with equal radii reads as a
    // sausage; the 0.80 / 1.12 split is what gives him a keel-shaped chest and a
    // profile you can recognise from the side.
    radius: (u) => {
      const chest = 0.205 * (0.72 + 0.44 * Math.sin(Math.PI * Math.min(1, (u + 0.12) * 0.95)));
      const waist = 1 - 0.22 * Math.exp(-((u - 0.42) ** 2) / 0.02);
      return [chest * waist * 0.80, chest * waist * 1.12];
    },
    // Culotte over the rear thighs, plus the smaller chest bib at the front.
    profile: tuftProfile((u) => Math.max(
      0.05 * smoothstep(0.02, 0.12, u) * (1 - smoothstep(0.28, 0.45, u)),
      0.04 * smoothstep(0.62, 0.78, u) * (1 - smoothstep(0.92, 1.00, u))
    )),
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
    profile: tuftProfile((u) => 0.06
      * smoothstep(0.00, 0.20, u) * (1 - smoothstep(0.78, 1.00, u))),
    color: (u, up, out) => coatAt(up, out, -0.05),
  }), neck, 'neck');

  const head = new THREE.Object3D();
  head.position.set(0, 0.15, 0.18);
  neck.add(head);

  /* Skull and muzzle stay in one sweep, but a short radial break now marks the
   * stop at 60% of the occiput-to-truffle length: skull:muzzle = 3:2. The cream
   * mask biases the urajiro threshold hard toward cream over the front third —
   * that is the blunt pale muzzle and the cheek flashes, and it is doing more
   * work for recognisability than the geometry under it. */
  mesh(sweep(spine([
    [0, 0.00, -0.17], [0, 0.035, -0.03], [0, 0.02, 0.10],
    [0, -0.025, 0.19], [0, -0.04, 0.25],
  ], 14), {
    radial: 14,
    // A narrow transition replaces the old head-long chamfer; the nearly
    // constant front radius gives the short muzzle a square, blunt silhouette.
    radius: (u) => {
      const r = 0.235 * (1 - 0.48 * smoothstep(0.60, 0.66, u));
      return [r * (1 - 0.05 * u), r * (1 - 0.10 * u)];
    },
    // The transported head frame's dorsal direction is -sin(a): compressing it
    // broadens and flattens the forehead while leaving the muzzle untouched.
    profile: (u, a) => 1 - 0.12 * (1 - smoothstep(0.55, 0.65, u))
      * Math.max(0, -Math.sin(a)),
    color: (u, up, out) => coatAt(up, out, -0.15 + 1.05 * smoothstep(0.38, 0.82, u)),
  }), head, 'skull');

  const nose = mesh(paintSolid(new THREE.SphereGeometry(0.055, 10, 8), COAT.dark), head, 'nose');
  nose.position.set(0, -0.04, 0.28);
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
    pivot.position.set(side * 0.145, 0.155, -0.035);
    pivot.rotation.set(-0.46, side * 0.34, side * 0.20);
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
      const r = 0.075 + 0.100 * Math.sin(Math.PI * Math.min(1, u * 1.15));
      return [r, r];
    },
    profile: tuftProfile((u) => 0.07
      * smoothstep(0.00, 0.15, u) * (1 - smoothstep(0.82, 1.00, u))),
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
    hip.position.set(s.x, s.front ? -SHIBA_BUILD.hipDrop : -0.06, s.z);
    body.add(hip);

    const upperLen = s.front ? SHIBA_BUILD.thigh : 0.28;
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

    const lowerLen = s.front ? SHIBA_BUILD.shin : 0.25;
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
