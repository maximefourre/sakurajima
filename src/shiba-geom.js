import * as THREE from 'three';
import { smoothstep, mix, noise2 } from './noise.js';
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
// Le partage thigh / shin n'est pas libre non plus, et ce n'est pas qu'une
// affaire de somme. Il place le COUDE. À 0.26 / 0.23 le coude tombait 0.24 u
// sous le sternum : le bras entier pendait à nu dans le vide et la patte lisait
// comme un tuyau vissé. Chez un chien le coude est SUR la ligne du poitrail.
// La somme est inchangée (0.49), donc `standHeight` et la garde au sol aussi ;
// seul l'étage du coude remonte.
export const SHIBA_BUILD = { scale: 1.35, standHeight: 0.66, hipDrop: 0.10, thigh: 0.17, shin: 0.32, pad: 0.07 };

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

/* Une limite de robe géométriquement nette lit comme de la PEINTURE, pas comme
 * du poil : c'est la moitié de ce qui faisait « assemblage », l'autre moitié
 * étant les marches de silhouette. On décale donc le seuil par un bruit de
 * haute fréquence, échantillonné sur la POSITION et non sur `u` ni sur
 * `upness` — indexée sur l'anneau, la perturbation tournerait avec lui et
 * ferait des rayures régulières au lieu de mèches. */
export function furEdge(p, amp = 0.10) {
  return amp * noise2(p.x * 43.0 + p.z * 11.0, p.y * 47.0 - p.z * 23.0);
}

/**
 * Paint an arbitrary geometry per-vertex from its own local positions. Same
 * job as `paintSolid` but with a gradient, for the primitives that cannot go
 * through `sweep`.
 */
export function paintBy(geo, fn) {
  const pos = geo.attributes.position;
  const c = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    fn(p, col);
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

/** Blend the coat colours by how much a surface faces up. */
export function coatAt(upness, out, creamBias = 0, jitter = 0) {
  const k = smoothstep(-0.55 + creamBias + jitter, 0.15 + creamBias + jitter, upness);
  out.copy(COAT.cream).lerp(COAT.red, k);
  // The saddle over the spine is a shade deeper than the flanks.
  if (upness > 0.45) out.lerp(COAT.saddle, smoothstep(0.45, 0.95, upness) * 0.55);
  return out;
}

// Urajiro is a set of anatomical markings, not a global underside gradient.
// Every mask is evaluated in the piece's authoring space, except for the tail:
// its transported section normal remains meaningful throughout the 270° curl.
const URAJIRO = {
  torso: (p) => {
    const n = furEdge(p, 0.030);
    return smoothstep(-0.02 + n, -0.10 + n, p.y)
      * smoothstep(0.19 + n, 0.10 + n, Math.abs(p.x));
  },
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
  // Le membre était coupé en deux dans sa longueur par un seuil de 0.06 u :
  // moitié rousse, moitié crème, arête au rasoir. À la distance de jeu ça ne
  // lit pas comme une marque de race mais comme deux plastiques emboîtés.
  // La bande est élargie, décentrée vers l'intérieur (le crème ne prend pas la
  // moitié du membre) et cassée par le bruit de poil.
  leg: (p, side) => {
    const n = furEdge(p, 0.022);
    return smoothstep(-0.008 + n, -0.070 + n, p.x * side);
  },
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
  // Culotte over the rear thighs, plus the smaller chest bib at the front.
  const torsoTufts = tuftProfile((u) => Math.max(
    0.05 * smoothstep(0.02, 0.12, u) * (1 - smoothstep(0.28, 0.45, u)),
    0.04 * smoothstep(0.62, 0.78, u) * (1 - smoothstep(0.92, 1.00, u))
  ));
  mesh(sweep(torso, {
    radial: 20,
    // Narrow and deep rather than round. A tube with equal radii reads as a
    // sausage; the 0.80 / 1.12 split is what gives him a keel-shaped chest and a
    // profile you can recognise from the side.
    radius: (u) => {
      const chest = 0.205 * (0.72 + 0.44 * Math.sin(Math.PI * Math.min(1, (u + 0.12) * 0.95)));
      return [chest * 0.80, chest * 1.12];
    },
    profile: (u, a) => {
      // Repère transporté d'une sweep vers +Z, le même que celui déjà démontré
      // pour le crâne : le dorsal est -sin(a), donc le ventral +sin(a) et le
      // latéral |cos(a)|.
      const lateral = Math.abs(Math.cos(a));
      const ventral = Math.max(0, Math.sin(a));
      // Épaule et hanche. Sans ces deux masses LATÉRALES les membres sortent
      // d'un tube lisse — c'est le premier de ce qui faisait lire « assemblage ».
      const shoulder = 0.13 * lateral * Math.exp(-((u - 0.80) ** 2) / 0.012);
      const haunch = 0.11 * lateral * Math.exp(-((u - 0.17) ** 2) / 0.016);
      // Poitrail : le sternum doit descendre au niveau du coude. Extension
      // purement VENTRALE — grossir ry ferait bien descendre le sternum, mais
      // monterait d'autant la ligne de dos, qui doit rester droite.
      // 0.26 était trop : le poitrail devenait une besace pâle sous le chien.
      const brisket = 0.11 * ventral
        * smoothstep(0.46, 0.80, u) * (1 - smoothstep(0.90, 1.00, u));
      // Tuck-up. L'ancien creux de taille était un gaussien appliqué aux DEUX
      // rayons : il pinçait aussi le dos, alors que le flanc d'un chien ne
      // remonte que par en dessous.
      const tuck = -0.13 * ventral * Math.exp(-((u - 0.38) ** 2) / 0.024);
      return Math.max(0.2, torsoTufts(u, a) + shoulder + haunch + brisket + tuck);
    },
    color: (u, up, out, p) => {
      coatAt(up, out, -0.15, furEdge(p, 0.05));
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
      const lateral = Math.abs(Math.cos(a));
      // Arcade zygomatique : la joue est DERRIÈRE l'œil, pas devant, et c'est
      // elle qui, par contraste, affine le museau. L'ancien 0.10 centré trop en
      // avant élargissait le chanfrein au lieu de la joue.
      const cheek = smoothstep(0.16, 0.44, u) * (1 - smoothstep(0.72, 0.98, u));
      const flatCrown = 0.12 * dorsal + 0.018 * dorsal ** 8;
      // Arcade sourcilière. Un stop, c'est une OMBRE portée par un bourrelet
      // au-dessus de l'œil. Sans elle, la rupture de rayon crâne/museau se lit
      // comme une tablette et le museau comme un bloc rapporté.
      const brow = 0.075 * dorsal ** 0.7 * Math.exp(-((u - 0.80) ** 2) / 0.020);
      return (1 - flatCrown) * (1 + 0.17 * lateral * cheek + brow);
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
    radial: 16,
    /* Le museau était un PAVÉ : il démarrait à 0.132 quand le crâne finissait à
     * 0.163 (marche franche = la tablette au stop) et ne s'affinait que de
     * 12 % sur toute sa longueur. C'est le cône qui fait la tête de shiba.
     * Il repart donc quasiment au rayon du crâne et perd 42 % jusqu'à la
     * truffe, en section de COIN : large à la base, se refermant vers l'avant. */
    radius: (u) => {
      const visibleU = Math.max(0, (u - overlapU) / (1 - overlapU));
      const taper = 1 - 0.42 * smoothstep(0.02, 1.00, visibleU);
      const wedge = 1 - 0.16 * visibleU; // la largeur tombe plus vite que la hauteur
      return [0.152 * taper * wedge, 0.126 * taper];
    },
    profile: (u, a) => {
      // Sweep vers +Z : dorsal = -sin(a), ventral = +sin(a).
      const ventral = Math.max(0, Math.sin(a));
      const dorsal = Math.max(0, -Math.sin(a));
      // Babine sous le chanfrein, et chanfrein DROIT : un méplat dorsal, pas un
      // bombé — « straight nasal bridge » est la moitié du profil de la race.
      return 1 + 0.14 * ventral * smoothstep(overlapU, 0.62, u)
        - 0.07 * dorsal ** 1.6;
    },
    color: (u, up, out, p) => {
      coatAt(up, out, -0.15, furEdge(p, 0.04));
      out.lerp(COAT.cream, URAJIRO.head(p, u));
    },
  }), head, 'muzzle');

  /* La truffe. Elle était énorme : 0.055 de rayon étiré à 1.15 en largeur sur
   * un museau qui n'en fait que 0.09 au bout. Réduite, et fendue d'un sillon
   * médian — sans lui la bille noire uniforme est la première chose qu'on voit. */
  const nose = mesh(paintBy(new THREE.SphereGeometry(0.042, 12, 9), (p, out) => {
    out.copy(COAT.dark);
    // Le philtrum : une raie plus claire sur l'axe, sous la truffe.
    const groove = (1 - smoothstep(0.0, 0.012, Math.abs(p.x))) * smoothstep(0.006, -0.010, p.y);
    out.lerp(COAT.tongue, groove * 0.22);
  }), head, 'nose');
  nose.position.set(0, -0.043, 0.272);
  nose.scale.set(1.10, 0.86, 0.82);

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
    /* Le standard dit « triangular, the outer corners slightly upturned ».
     * L'ouverture était une calotte ronde, coins interne et externe au même
     * niveau : ça donne un œil de peluche. Incliner la paupière autour de Z
     * relève le coin externe et transforme l'ouverture en amande montante.
     * `rotation.x` reste le canal du clignement (-0.32 → 0.58 dans shiba.js) :
     * le biais vit sur un AUTRE axe, sinon il faudrait retoucher ces bornes. */
    lid.rotation.z = -side * 0.30;
    head.add(lid);
    const lidShell = mesh(paintBy(new THREE.SphereGeometry(
      0.041, 10, 6, 0, TAU, 0, Math.PI * 0.5
    ), (p, out) => {
      // Liseré de paupière : le bord de l'ouverture est sombre et humide, pas
      // roux jusqu'à l'arête.
      out.copy(COAT.red).lerp(COAT.dark, smoothstep(0.014, 0.000, p.y) * 0.55);
    }), lid, 'eyelid');
    // The pivot stays exactly on the eye for blinking; lifting only the shell
    // leaves roughly the upper third covered in the resting pose.
    lidShell.position.y = 0.014;
    lidShell.scale.set(0.76, 1.05, 0.66);
    lids.push(lid);

    // A pin of light: without it a dark eye on a dark mask reads as fur.
    const glint = mesh(paintSolid(new THREE.SphereGeometry(0.009, 6, 5), new THREE.Color(0xf6f2ea)), head, 'eye-glint');
    glint.position.set(side * (EYE_X + 0.008), EYE_Y + 0.008, EYE_Z + 0.016);
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
    // 0.34 de lacet tournait la plaque de champ : vue de face on voyait une
    // lame. L'oreille d'un shiba se présente large, à peine ouverte vers
    // l'extérieur.
    pivot.rotation.set(-0.44, side * 0.22, side * 0.18);
    head.add(pivot);
    /* Le standard dit « relatively small, triangular ». L'oreille faisait 0.20
     * de haut pour un crâne de 0.22 de rayon, en cône à `radial: 3` : trois
     * facettes, une corne. Elle est raccourcie d'un quart, amincie en PLAQUE
     * (0.30 au lieu de 0.45), sa pointe arrondie, et sa face avant CREUSÉE —
     * une oreille est une coquille, et c'est ce creux qui capte l'ombre. */
    mesh(sweep(spine([
      [0, 0.00, 0], [0, 0.080, 0.013], [0, 0.162, 0.021],
    ], 7), {
      radial: 7,
      radius: (u) => {
        // La largeur se referme plus vite que l'épaisseur : contour triangulaire.
        const r = 0.132 * (1 - 0.80 * smoothstep(0.00, 0.94, u));
        return [r, r * 0.40 * (1 - 0.18 * u)];
      },
      profile: (u, a) => {
        // Sweep vers +Y : le repère de départ est semé sur +X, la face avant
        // (+Z de l'oreille, vers l'avant du crâne) tombe donc sur -sin(a).
        const front = Math.max(0, -Math.sin(a));
        // Conque creuse, ouverte au milieu de la hauteur et refermée aux bords.
        const conch = 0.30 * front ** 1.3
          * smoothstep(0.06, 0.34, u) * (1 - smoothstep(0.62, 0.96, u));
        // Pas de bombement au sommet : la pointe n'est déjà pas piquée (le
        // rayon plancher à u=1 vaut 20 % de la base). Un multiplicateur en plus
        // évasait le bout et donnait deux trompettes.
        return 1 - conch;
      },
      color: (u, up, out, p) => {
        out.copy(COAT.red).lerp(COAT.cream, URAJIRO.ear(p));
        out.lerp(COAT.dark, smoothstep(0.66, 1.0, u) * 0.42);
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
    radial: 14,
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

  /* Une seule table de rayons pour les quatre membres — et surtout UN SEUL nom
   * par interface. `joint` (avant) et `stifle` (arrière) sont le dernier rayon
   * du segment haut ET le premier du segment bas : impossible de les
   * désynchroniser. Deux littéraux voisins finissent toujours par diverger, et
   * le symptôme est le manchon télescopique d'origine (le fémur finissait à
   * 0.085, le tibia repartait à 0.092 dans un nœud posé pile au bout).
   *
   * PAYÉ CASH, et deux fois : il ne suffit PAS que le segment bas soit plus
   * large au pivot. À +13 % il RESSORT du segment haut, et l'anneau
   * d'interpénétration de deux tubes à 12 facettes tombe en plein sur la
   * silhouette : on obtient un escalier, plus laid que la marche de départ.
   * Les deux rayons doivent être ÉGAUX au pivot — l'émergence est alors
   * tangente et invisible — et le renflement d'articulation doit se lever
   * SOUS le pivot, jamais dessus. Le rapport rx/ry doit coïncider lui aussi,
   * sans quoi l'égalité n'est vraie que sur deux points de l'anneau. */
  const LEG_R = {
    buried: 0.042, // anneau de bouchon, il ne doit JAMAIS sortir du flanc
    upper: 0.086,  // masse du bras / de la cuisse
    joint: 0.066,  // coude — interface PARTAGÉE avant
    cannon: 0.050, // canon et métatarse
    hock: 0.042,   // pincement du jarret
  };
  LEG_R.stifle = LEG_R.joint * 1.18; // grasset — interface PARTAGÉE arrière
  const FLAT_F = 0.85; // rx/ry, avant — le même des deux côtés du coude
  const FLAT_B = 0.82; // rx/ry, arrière
  const JOINT_SWELL = 0.06;

  const legSpec = [
    { key: 'FL', x: -0.104, z: 0.29, front: true },
    { key: 'FR', x: 0.104, z: 0.29, front: true },
    { key: 'BL', x: -0.114, z: -0.35, front: false },
    { key: 'BR', x: 0.114, z: -0.35, front: false },
  ];

  /* Le pied, balayé de l'ARRIÈRE vers l'AVANT et non de haut en bas. Sweeper
   * un pied vers le bas mettrait la sole sur un capuchon d'extrémité, donc
   * ronde et impossible à aplatir ; balayé selon +Z on retrouve le repère
   * documenté pour le crâne (dorsal = -sin(a), ventral = +sin(a), latéral =
   * cos(a)) et la sole comme les doigts deviennent de simples masques. */
  const FOOT_HALF = 0.038; // demi-hauteur : c'est elle qui pose la sole au sol
  const footSpine = (splay) => [
    [splay * 0.2, 0.010, -0.050],
    [splay * 0.5, -0.002, -0.012],
    [splay * 0.85, -0.004, 0.028],
    [splay, 0.004, 0.066],
  ];
  const footProfile = (u, a) => {
    const ventral = Math.max(0, Math.sin(a));
    const dorsal = Math.max(0, -Math.sin(a));
    // Sole plate : un chien pose à plat, il ne roule pas sur une ellipse.
    const sole = 0.13 * ventral ** 1.4;
    // Quatre doigts arqués sur le dessus du tiers distal. La fréquence 8 place
    // les bosses à ±π/8 et ±3π/8 de l'axe dorsal, soit quatre lobes sur la
    // moitié supérieure une fois le masque `dorsal` appliqué. C'est cette
    // fréquence qui impose `radial: 28` : en dessous les lobes sont
    // sous-échantillonnés et le pied devient une étoile.
    const toes = 0.115 * Math.max(0, -Math.cos(8 * a)) * dorsal ** 0.55
      * smoothstep(0.46, 0.70, u);
    return 1 - sole + toes;
  };

  for (const s of legSpec) {
    // The inner face reverses between left and right legs. Capture that side
    // here; sweep's callback contract stays identical for every other piece.
    const side = Math.sign(s.x);
    const legUrajiro = (p) => URAJIRO.leg(p, side);
    const coatLeg = (up, out, p, distal = 0) => {
      coatAt(up, out, -0.15 + distal, furEdge(p, 0.07));
      out.lerp(COAT.cream, legUrajiro(p));
    };
    const hip = new THREE.Object3D();
    hip.position.set(s.x, s.front ? -SHIBA_BUILD.hipDrop : -0.06, s.z);
    body.add(hip);

    /* — bras / cuisse —
     * La spine démarre AU-DESSUS du pivot : son premier anneau est enfoui dans
     * le flanc, exactement comme le cou recouvre l'épaule et le museau démarre
     * derrière le stop. On ne fait jamais se rencontrer deux anneaux
     * échantillonnés, on les recouvre.
     * Le rayon de ce premier anneau doit rester PETIT : un gros disque
     * horizontal enfoui ressort latéralement et fait une tablette, pire que le
     * défaut d'origine. D'où `LEG_R.buried`, et d'où les pivots ramenés vers
     * l'axe (±0.150 → ±0.104) — à l'ancienne largeur, l'épaule tombait en
     * dehors du flanc et rien ne pouvait s'y cacher. */
    const upperLen = s.front ? SHIBA_BUILD.thigh : 0.20;
    const rise = upperLen * 0.62;
    const uTop = rise / (rise + upperLen);
    const vUpper = (u) => (u - uTop) / (1 - uTop); // 0 au pivot, 1 à l'articulation
    mesh(sweep(spine(
      s.front
        ? [[0, rise, -0.008], [0, 0, 0.006], [0, -upperLen * 0.55, 0.006], [0, -upperLen, 0.006]]
        : [[0, rise, -0.020], [0, 0, 0.004], [0, -upperLen * 0.55, 0.030], [0, -upperLen, 0.050]],
      9), {
      radial: 12,
      radius: (u) => {
        const v = vUpper(u);
        // Au-dessus du pivot le membre se referme en pointe dans le flanc.
        const emerge = smoothstep(-0.62, -0.04, v);
        const bulk = s.front
          ? mix(LEG_R.upper, LEG_R.joint, smoothstep(0.02, 1.00, v))
          : mix(LEG_R.upper * 1.30, LEG_R.stifle, smoothstep(0.06, 1.00, v));
        const r = mix(LEG_R.buried, bulk, emerge);
        return [r, r * (s.front ? FLAT_F : FLAT_B)];
      },
      color: (u, up, out, p) => coatLeg(up, out, p),
    }), hip, 'thigh');

    /* Le fémur descend vers l'AVANT : le grasset d'un chien est sous le ventre,
     * pas derrière la fesse. L'ancien nœud partait à -0.07, ce qui repliait la
     * patte arrière à l'envers de l'anatomie. */
    const knee = new THREE.Object3D();
    knee.position.set(0, -upperLen, s.front ? 0.004 : 0.050);
    hip.add(knee);

    // Chaîne arrière : 0.06 (hanche) + 0.20 (fémur) + 0.330 + 0.07 (pad) =
    // 0.66 = standHeight, la même sole que devant. L'invariant 12 prend la
    // patte la PLUS BASSE des quatre : désaligner les deux chaînes le fait
    // échouer même si chacune est cohérente prise seule.
    const lowerLen = s.front ? SHIBA_BUILD.shin : 0.330;
    const overlap = 0.055;
    const uOv = overlap / (overlap + lowerLen);
    const vLower = (u) => (u - uOv) / (1 - uOv); // 0 à l'articulation, 1 à la cheville
    const splay = side * (s.front ? 0.016 : 0.012);
    mesh(sweep(spine(
      s.front
        ? [[0, overlap, 0.006], [0, -lowerLen * 0.30, 0.006], [0, -lowerLen * 0.68, 0.004],
          [splay, -lowerLen, -0.006]]
        // Jambe → JARRET → métatarse. Le coude arrière se fait dans UNE seule
        // sweep : le rig ne pilote que `hip` et `knee`, on ne l'agrandit pas.
        : [[0, overlap, -0.010], [0, -0.068, -0.048], [0, -0.137, -0.082],
          [0, -0.188, -0.098], [0, -0.246, -0.092], [splay, -lowerLen, -0.080]],
      s.front ? 8 : 12), {
      radial: 12,
      radius: (u) => {
        const v = vLower(u);
        // Le renflement d'articulation. Il vaut EXACTEMENT 1 au pivot et
        // au-dessus (`v <= 0`), sinon le segment bas ressort du segment haut
        // et l'anneau d'interpénétration fait un escalier sur la silhouette.
        // Il se lève sous le pivot, culmine dans l'articulation, et retombe.
        const swell = 1 + JOINT_SWELL * Math.sin(Math.PI * smoothstep(0, 0.36, v));
        if (s.front) {
          // Paturon : léger pincement juste au-dessus du pied.
          const pastern = 1 - 0.18 * smoothstep(0.72, 0.96, v);
          const r = mix(LEG_R.joint, LEG_R.cannon, smoothstep(0, 0.62, v)) * swell * pastern;
          return [r, r * FLAT_F];
        }
        // Le jarret est de l'os et du tendon : le rayon y PINCE. C'est ce
        // pincement, encore plus que le coude, qui fait lire une patte arrière.
        const gaskin = mix(LEG_R.stifle, LEG_R.hock, smoothstep(0.02, 0.56, v));
        const meta = mix(LEG_R.hock, LEG_R.cannon * 0.94, smoothstep(0.58, 1.00, v));
        const r = (v < 0.57 ? gaskin : meta) * swell;
        return [r, r * FLAT_B];
      },
      // Urajiro follows only the inner cannon; a full cream stocking reads as
      // a beagle rather than a shiba.
      color: (u, up, out, p) => coatLeg(up, out, p, 0.10 * smoothstep(0.4, 1.0, vLower(u))),
    }), knee, 'shin');

    /* La rotule. Deux tubes de MÊME rayon au pivot ne suffisent pas dès que
     * leurs TANGENTES diffèrent — et c'est le propre d'une articulation
     * d'angler : au grasset le fémur descend vers l'avant et la jambe repart
     * vers l'arrière. Sans volume dans le coin, l'angle se voit comme un
     * décrochement. Une sphère du même rayon, centrée sur le pivot, est
     * tangente aux deux tubes : l'union se lit comme un coude, pas comme un
     * raccord. C'est aussi pour ça que le rayon du joint est une constante
     * partagée et pas un littéral. */
    const jointR = s.front ? LEG_R.joint : LEG_R.stifle;
    // 1.07 et pas 1.0 : à rayon exactement égal, le capuchon plat du segment
    // haut affleure l'équateur de la sphère et les deux se disputent le
    // z-buffer — un éclat clair apparaît pile sur l'articulation. La sphère
    // doit contenir STRICTEMENT les deux bords, ce qui donne au passage le
    // léger renflement qu'a un vrai coude.
    const cap = mesh(paintBy(new THREE.SphereGeometry(jointR * 1.07, 12, 8), (p, out) => {
      // `upness` FIXÉ à 0, pas la valeur sphérique : un membre est un tube
      // vertical, son `_off.y` vaut zéro partout et `coatAt` y rend une teinte
      // constante. Peindre la rotule avec son vrai gradient haut-bas lui
      // donnait un dégradé que les deux tubes n'ont pas — un bracelet clair
      // pile sur l'articulation, exactement l'anneau qu'on cherchait à effacer.
      coatLeg(0, out, p);
    }), knee, 'joint');
    cap.scale.set(s.front ? FLAT_F : FLAT_B, 1.04, 1.0);

    /* Le pied. Il reste un mesh nommé exactement 'paw' enfant de `knee` :
     * l'invariant 12 mesure sa garde au sol par ce nom, et `shiba.js` prend sa
     * position monde pour les empreintes et la poussière. */
    const paw = mesh(sweep(spine(footSpine(splay * 0.6), 7), {
      radial: 28,
      // Large et bas : un pied de chat. Il s'élargit vite depuis le talon puis
      // se referme à peine aux doigts — s'il se refermait en pointe, les lobes
      // n'auraient plus de largeur où exister.
      radius: (u) => [
        0.028 + 0.034 * smoothstep(0.00, 0.42, u) - 0.012 * smoothstep(0.80, 1.00, u),
        FOOT_HALF * (0.86 + 0.16 * smoothstep(0.00, 0.40, u) - 0.22 * smoothstep(0.72, 1.00, u)),
      ],
      profile: footProfile,
      // Le pied n'est pas une chaussette blanche vernie : le dessus reste
      // roussi, le crème remonte par l'intérieur et par le bas comme partout
      // ailleurs sur ce chien.
      color: (u, up, out, p) => coatLeg(up, out, p, 0.22),
    }), knee, 'paw');
    paw.position.set(0, -lowerLen - (SHIBA_BUILD.pad - FOOT_HALF), 0);

    legs.push({ key: s.key, front: s.front, hip, knee, paw });
  }

  return { root, tilt, body, neck, head, jaw, lids, ears, tailBase, legs, parts };
}
