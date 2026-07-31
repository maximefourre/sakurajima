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

// Urajiro is a set of anatomical markings, not a global underside gradient.
// Every mask is evaluated in the piece's authoring space, except for the tail:
// its transported section normal remains meaningful throughout the 270° curl.
const URAJIRO = {
  torso: (p) => smoothstep(-0.02, -0.10, p.y)
    * smoothstep(0.19, 0.10, Math.abs(p.x)),
  head: (p, u) => {
    const x = Math.abs(p.x);
    const underJaw = smoothstep(-0.025, -0.085, p.y)
      * smoothstep(0.14, 0.09, x);
    // Mesuré en jeu : avec une fenêtre en p.y ouverte jusqu'à 0.060, TOUT le
    // museau (dont l'axe vit entre -0.008 et -0.040) tombait du côté crème et
    // le chien lisait comme un masque blanc. Le crème ne monte que sur le BAS
    // des flancs ; le dessus du chanfrein reste roux, c'est la moitié du
    // masque de la race.
    const muzzleFlanks = smoothstep(0.055, 0.098, x)
      * smoothstep(-0.030, -0.080, p.y)
      * smoothstep(-0.020, 0.035, p.z);
    const cheeks = smoothstep(0.075, 0.135, x)
      * smoothstep(0.095, 0.025, p.y)
      * smoothstep(0.18, 0.45, u);
    return Math.max(underJaw, muzzleFlanks, cheeks);
  },
  leg: (p, side) => smoothstep(0.02, -0.04, p.x * side),
  ear: (p) => smoothstep(0.0, -0.02, p.z),
  tail: (upness) => smoothstep(-0.15, -0.55, upness),
};

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
    color: (u, up, out, p) => {
      coatAt(up, out, -0.15);
      out.lerp(COAT.cream, URAJIRO.torso(p));
    },
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

  /* — skull and muzzle —
   * A stop is a break in both radius derivative and centreline direction, so a
   * single continuous sweep necessarily sands it away. The skull therefore
   * ends on the stop and the straight muzzle starts 0.04 u behind it. As with
   * the neck overlapping the shoulder above, the hidden overlap masks the join
   * without asking two sampled rings to meet exactly. */
  const OCCIPUT_Z = -0.170;
  const STOP_Z = 0.082;
  const TRUFFLE_Z = 0.250;
  const MUZZLE_OVERLAP = 0.040;
  const MUZZLE_START_Z = STOP_Z - MUZZLE_OVERLAP;
  const EYE_X = 0.182;
  const EYE_Y = 0.060;
  const EYE_Z = 0.030;

  mesh(sweep(spine([
    [0, 0.000, OCCIPUT_Z], [0, 0.032, -0.085],
    [0, 0.048, 0.010], [0, 0.040, STOP_Z],
  ], 8), {
    radial: 14,
    radius: (u) => [
      0.218 - 0.055 * smoothstep(0.28, 1.00, u),
      0.225 - 0.052 * smoothstep(0.22, 1.00, u),
    ],
    profile: (u, a) => {
      // For a +Z sweep the transported dorsal direction is -sin(a), while the
      // two cheeks lie at |cos(a)|. Flatten the crown (with a shallow median
      // furrow) and add volume laterally only through the cheek stations.
      const dorsal = Math.max(0, -Math.sin(a));
      const cheek = smoothstep(0.22, 0.52, u) * (1 - smoothstep(0.86, 1.00, u));
      const flatCrown = 0.12 * dorsal + 0.018 * dorsal ** 8;
      return (1 - flatCrown) * (1 + 0.10 * Math.abs(Math.cos(a)) * cheek);
    },
    color: (u, up, out, p) => {
      coatAt(up, out, -0.15);
      out.lerp(COAT.cream, URAJIRO.head(p, u));

      // The periocular mask belongs to the skull surface: an outer urajiro
      // ellipse is painted first, then the smaller dark surround leaves a fine
      // cream rim. Using p makes this independent of the transported ring.
      const dx = (Math.abs(p.x) - EYE_X) / 0.050;
      const dy = (p.y - EYE_Y) / 0.060;
      const dz = (p.z - EYE_Z) / 0.070;
      const eyeD = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const creamRing = 1 - smoothstep(0.90, 1.22, eyeD);
      const darkSurround = 1 - smoothstep(0.48, 0.88, eyeD);
      out.lerp(COAT.cream, creamRing * 0.92);
      out.lerp(COAT.dark, darkSurround * 0.72);
    },
  }), head, 'skull');

  const muzzleSpan = TRUFFLE_Z - MUZZLE_START_Z;
  const overlapU = MUZZLE_OVERLAP / muzzleSpan;
  const muzzleAxis = Array.from({ length: 6 }, (_, i) => {
    const u = i / 5;
    // Deliberately linear: any curve here would soften the straight chamfer.
    return new THREE.Vector3(0, -0.008 - 0.032 * u, MUZZLE_START_Z + muzzleSpan * u);
  });
  mesh(sweep(muzzleAxis, {
    radial: 14,
    radius: (u) => {
      const visibleU = Math.max(0, (u - overlapU) / (1 - overlapU));
      const taper = 1 - 0.12 * visibleU;
      return [0.132 * taper, 0.116 * taper];
    },
    profile: (u, a) => 1 + 0.14 * Math.max(0, Math.sin(a))
      * smoothstep(overlapU, 0.62, u),
    color: (u, up, out, p) => {
      coatAt(up, out, -0.15);
      out.lerp(COAT.cream, URAJIRO.head(p, u));
    },
  }), head, 'muzzle');

  const nose = mesh(paintSolid(new THREE.SphereGeometry(0.055, 10, 8), COAT.dark), head, 'nose');
  nose.position.set(0, -0.04, 0.28);
  nose.scale.set(1.15, 0.85, 0.9);

  const lids = [];
  for (const side of [-1, 1]) {
    // Keep the existing spherical eye: at its on-screen size the lid/surface
    // intersection carries the almond silhouette more reliably than geometry.
    const eye = mesh(paintSolid(new THREE.SphereGeometry(0.038, 10, 8), COAT.dark), head, 'eye');
    eye.position.set(side * EYE_X, EYE_Y, EYE_Z);
    eye.scale.set(0.72, 1.0, 0.62);

    const lid = new THREE.Object3D();
    lid.name = 'lid';
    lid.position.copy(eye.position);
    lid.rotation.x = -0.32;
    head.add(lid);
    const lidShell = mesh(paintSolid(new THREE.SphereGeometry(
      0.040, 8, 5, 0, TAU, 0, Math.PI * 0.5
    ), COAT.red), lid, 'eyelid');
    // The pivot stays exactly on the eye for blinking; lifting only the shell
    // leaves roughly the upper third covered in the resting pose.
    lidShell.position.y = 0.018;
    lidShell.scale.set(0.74, 1.03, 0.64);
    lids.push(lid);

    // A pin of light: without it a dark eye on a dark mask reads as fur.
    const glint = mesh(paintSolid(new THREE.SphereGeometry(0.010, 6, 5), new THREE.Color(0xf6f2ea)), head, 'eye-glint');
    glint.position.set(side * (EYE_X + 0.007), EYE_Y + 0.012, EYE_Z + 0.014);
  }

  /* — mouth —
   * The lower jaw overlaps the muzzle in the closed pose, so no sampled seam is
   * exposed. Positive rotation.x drops its tip from the commissure. */
  const jaw = new THREE.Object3D();
  jaw.name = 'jaw';
  jaw.position.set(0, -0.122, 0.095);
  head.add(jaw);
  mesh(sweep([
    new THREE.Vector3(0, 0.000, 0.000),
    new THREE.Vector3(0, -0.004, 0.050),
    new THREE.Vector3(0, -0.002, 0.104),
    new THREE.Vector3(0, 0.004, 0.150),
  ], {
    radial: 10,
    radius: (u) => [0.112 - 0.020 * u, 0.044 - 0.008 * u],
    // upness is local to sweep(), not world space. A jaw is the first dog part
    // (outside the ears) whose pivot will rotate after build, so painting from
    // upness would put russet underneath and cream on top. p keeps the lower
    // surface cream in the jaw's own geometry throughout the rotation.
    color: (u, up, out, p) => {
      out.copy(COAT.cream).lerp(COAT.red, smoothstep(-0.026, 0.020, p.y));
    },
  }), jaw, 'mandible');

  // The cavity is a volume tucked wholly inside the closed muzzle. Its surfaces
  // are never coplanar with the coat: muzzle/jaw win the depth test when closed,
  // and the dark volume is revealed only in the opening between them.
  const mouth = mesh(paintSolid(new THREE.SphereGeometry(0.075, 8, 6), COAT.dark), head, 'mouth-cavity');
  mouth.position.set(0, -0.105, 0.180);
  mouth.scale.set(0.82, 0.55, 0.78);

  const tongue = mesh(sweep([
    new THREE.Vector3(0, 0, 0.025),
    new THREE.Vector3(0, 0, 0.082),
    new THREE.Vector3(0, 0, 0.135),
  ], {
    radial: 8,
    radius: (u) => [0.057 - 0.010 * u, 0.024 - 0.006 * u],
    profile: (u, a) => 1 + 0.05 * Math.sin(Math.PI * u) * Math.cos(2 * a),
    color: (u, up, out) => out.copy(COAT.tongue),
  }), jaw, 'tongue');
  tongue.position.y = 0.024;
  tongue.scale.y = 0.35;

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
      color: (u, up, out, p) => {
        out.copy(COAT.red).lerp(COAT.cream, URAJIRO.ear(p));
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
    color: (u, up, out) => {
      coatAt(up, out, -0.30);
      out.lerp(COAT.cream, URAJIRO.tail(up));
    },
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
    // The inner face reverses between left and right legs. Capture that side
    // here; sweep's callback contract stays identical for every other piece.
    const legUrajiro = (p) => URAJIRO.leg(p, Math.sign(s.x));
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
      color: (u, up, out, p) => {
        coatAt(up, out, -0.15);
        out.lerp(COAT.cream, legUrajiro(p));
      },
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
      // Urajiro follows only the inner cannon; a full cream stocking reads as
      // a beagle rather than a shiba.
      color: (u, up, out, p) => {
        coatAt(up, out, -0.15);
        out.lerp(COAT.cream, legUrajiro(p));
      },
    }), knee, 'shin');

    const paw = mesh(paintSolid(new THREE.SphereGeometry(0.082, 8, 6), COAT.cream), knee, 'paw');
    paw.position.set(0, -lowerLen - 0.005, s.front ? 0.02 : 0.06);
    paw.scale.set(0.95, 0.66, 1.20);

    legs.push({ key: s.key, front: s.front, hip, knee, paw });
  }

  return { root, tilt, body, neck, head, jaw, lids, ears, tailBase, legs, parts };
}
