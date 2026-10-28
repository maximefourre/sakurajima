/**
 * shiba-geom.js — le shiba, modelé ici, sans asset tiers.
 *
 * Une PEAU d'un seul tenant, pas un assemblage de tubes : le corps est un champ
 * de distance (SDF) — ellipsoïdes et cônes arrondis fondus par union lisse —
 * polygonisé au boot par surface nets, puis skinné sur un squelette dont chaque
 * os ne pilote que les primitives qui lui appartiennent. Oreilles, queue,
 * mâchoire, yeux et truffe sont des pièces rigides accrochées aux os : ils ne
 * se déforment jamais, donc ils n'ont rien à gagner à être skinnés.
 *
 * Références (standards AKC/NSCA et Kennel Club, lus le 27/10/2026) :
 *  - hauteur : longueur = 10 : 11 ; poitrail = 1/2 de la hauteur au garrot ;
 *  - museau = 40 % de la tête, chanfrein droit, stop modéré, joues pleines,
 *    tête en « triangle émoussé » vue de dessus ;
 *  - yeux petits, triangulaires, enfoncés, relevés vers l'oreille ;
 *  - oreilles petites, triangulaires, bien écartées, INCLINÉES VERS L'AVANT ;
 *  - cou épais, ligne de dos droite, ventre bien relevé ;
 *  - queue attachée haut, épaisse, en faucille sur le dos, pointée vers le cou ;
 *  - pieds de chat ; cuisse longue, seconde cuisse courte ;
 *  - urajiro : côtés du museau, joues, dessous de mâchoire et gorge, intérieur
 *    des oreilles et des membres, poitrail, ventre, dessous de la queue ;
 *    taches crème au-dessus des yeux (admises, et c'est la « tête » du shiba).
 * Stylisé : tête grossie d'environ 15 % pour rester lisible à distance de jeu.
 *
 * Unités de construction : sol à y = 0, museau vers +Z, garrot à 0.80.
 * shiba.js applique root.scale = SHIBA_BUILD.scale.
 */
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const UP = new THREE.Vector3(0, 1, 0);

/** Robe aka (rousse). La selle est plus sombre que les flancs ; le crème est
 *  l'urajiro, la marque qui fait le shiba bien plus que la couleur rousse. */
export const COAT = {
  red: new THREE.Color(0xd4793a),
  saddle: new THREE.Color(0xa9582a),
  flank: new THREE.Color(0xe39a5c),
  cream: new THREE.Color(0xf4e7d2),
  sock: new THREE.Color(0xecd3ae),
  earIn: new THREE.Color(0xf0d6bf),
  dark: new THREE.Color(0x1d1714),
  iris: new THREE.Color(0x3a2216),
  tongue: new THREE.Color(0xd06a6a),
};

/** standHeight = hauteur du pivot `tilt` (milieu du tronc). L'invariant 11 et
 *  la garde de shiba.js la comparent à la flottaison : le garrot, lui, est à
 *  `withers`, au-dessus. */
export const SHIBA_BUILD = { scale: 1.35, standHeight: 0.66, withers: 0.80 };

/** Dessous du coussinet, dans le repère de l'os `paw` (unités modèle) : centre
 *  de l'ellipsoïde de sole moins sa demi-hauteur, moins la position de l'os
 *  (LEG.paw). L'os `paw` est la cheville (le jarret derrière), 13 à 22 cm
 *  au-dessus du sol : c'est ce point-ci qui touche la terre. */
export const PAW_SOLE = Object.freeze({ F: [0, -0.100, 0.038], B: [0, -0.170, 0.050] });

/** La pose assise, en INTENTIONS (angles passés à poseLeg / poseBody) : une
 *  seule source pour animate(), le banc 26 et l'atelier. Les angles arrière
 *  tiennent compte des angles de repos du fémur (-0.34) et du tibia (+0.67). */
export const SIT_POSE = Object.freeze({
  frontHip: 0.52, frontKnee: -0.04, hindHip: -0.31, hindKnee: 1.24, pitch: -0.60, drop: -0.03,
});

/* ── maths ─────────────────────────────────────────────────────── */

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

/** Union lisse polynomiale (iq). Au-delà de |a - b| > k c'est un min exact. */
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
const smax = (a, b, k) => -smin(-a, -b, k);

/** Bruit de valeur 3D, haché : déterministe, indépendant de seedNoise(). */
function hash3(i, j, k) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h & 0xffff) / 0xffff) * 2 - 1;
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u),
      l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u),
      l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w
  );
}

/* ── primitives ────────────────────────────────────────────────── */

/** Ellipsoïde, distance approchée (iq) — exacte au voisinage de la surface,
 *  qui est le seul endroit où on la lit. */
function ellipsoid(c, r) {
  const [cx, cy, cz] = c, [rx, ry, rz] = r;
  return (x, y, z) => {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const k1 = Math.sqrt(px * px / (rx * rx) + py * py / (ry * ry) + pz * pz / (rz * rz));
    return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  };
}

/** Cône arrondi a → b, rayon linéaire ra → rb. `sy` aplatit la section. */
function cone(a, b, ra, rb, sy = 1) {
  const [ax, ay, az] = a;
  const bx = b[0] - ax, by = (b[1] - ay) / sy, bz = b[2] - az;
  const bb = bx * bx + by * by + bz * bz;
  return (x, y, z) => {
    const px = x - ax, py = (y - ay) / sy, pz = z - az;
    const h = clamp01((px * bx + py * by + pz * bz) / bb);
    const dx = px - bx * h, dy = py - by * h, dz = pz - bz * h;
    return (Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h)) * Math.min(1, sy);
  };
}

/* ── polygonisation : surface nets ─────────────────────────────── */

/**
 * Un sommet par cellule traversée (moyenne des croisements d'arêtes), un quad
 * par arête de grille traversée. Les normales viennent du GRADIENT du champ, pas
 * des faces : c'est ce qui rend la peau lisse à 1 cm de pas. Le sens de chaque
 * quad est choisi contre ce gradient, donc aucun triangle ne peut se retrouver
 * enroulé vers l'intérieur (piège 1 d'AGENTS.md) — c'est vérifié, pas supposé.
 */
function polygonize(sdf, min, max, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const field = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * cell;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * cell;
      for (let i = 0; i < nx; i++) field[id(i, j, k)] = sdf(min[0] + i * cell, y, z);
    }
  }

  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cid = (i, j, k) => i + cx * (j + cy * k);
  const vIndex = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [];
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) {
      const v = field[id(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
      cv[c] = v;
      if (v < 0) neg++;
    }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      const va = cv[a], vb = cv[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += mix(a & 1, b & 1, t);
      sy += mix((a >> 1) & 1, (b >> 1) & 1, t);
      sz += mix((a >> 2) & 1, (b >> 2) & 1, t);
      n++;
    }
    vIndex[cid(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }

  const nVert = pos.length / 3;
  const normal = new Float32Array(nVert * 3);
  const e = cell * 0.5;
  for (let v = 0; v < nVert; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
    const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
    const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    normal[v * 3] = gx / l; normal[v * 3 + 1] = gy / l; normal[v * 3 + 2] = gz / l;
  }

  const idx = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // Sens : la normale de face doit suivre le gradient moyen des 4 sommets.
    const P = (q, o) => pos[q * 3 + o];
    const ux = P(c, 0) - P(a, 0), uy = P(c, 1) - P(a, 1), uz = P(c, 2) - P(a, 2);
    const vx = P(d, 0) - P(b, 0), vy = P(d, 1) - P(b, 1), vz = P(d, 2) - P(b, 2);
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    let gx = 0, gy = 0, gz = 0;
    for (const q of [a, b, c, d]) { gx += normal[q * 3]; gy += normal[q * 3 + 1]; gz += normal[q * 3 + 2]; }
    if (fx * gx + fy * gy + fz * gz < 0) { const t = b; b = d; d = t; }
    // Diagonale la plus courte : moins de triangles en aiguille.
    const dac = (P(a, 0) - P(c, 0)) ** 2 + (P(a, 1) - P(c, 1)) ** 2 + (P(a, 2) - P(c, 2)) ** 2;
    const dbd = (P(b, 0) - P(d, 0)) ** 2 + (P(b, 1) - P(d, 1)) ** 2 + (P(b, 2) - P(d, 2)) ** 2;
    if (dac <= dbd) idx.push(a, b, c, a, c, d);
    else idx.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 0; i < cx; i++) {
    const a = field[id(i, j, k)], b = field[id(i + 1, j, k)];
    if ((a < 0) === (b < 0)) continue;
    quad(vIndex[cid(i, j - 1, k - 1)], vIndex[cid(i, j, k - 1)], vIndex[cid(i, j, k)], vIndex[cid(i, j - 1, k)]);
  }
  for (let k = 1; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 1; i < cx; i++) {
    const a = field[id(i, j, k)], b = field[id(i, j + 1, k)];
    if ((a < 0) === (b < 0)) continue;
    quad(vIndex[cid(i - 1, j, k - 1)], vIndex[cid(i, j, k - 1)], vIndex[cid(i, j, k)], vIndex[cid(i - 1, j, k)]);
  }
  for (let k = 0; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++) {
    const a = field[id(i, j, k)], b = field[id(i, j, k + 1)];
    if ((a < 0) === (b < 0)) continue;
    quad(vIndex[cid(i - 1, j - 1, k)], vIndex[cid(i, j - 1, k)], vIndex[cid(i, j, k)], vIndex[cid(i - 1, j, k)]);
  }
  return { position: new Float32Array(pos), normal, index: idx };
}

/** Marche le long d'un rayon jusqu'à la surface du champ (repère du champ). */
function surfaceHit(sdf, o, d, maxT = 1) {
  let t = 0, prev = sdf(o[0], o[1], o[2]);
  const step = 0.002;
  while (t < maxT) {
    const nt = t + step;
    const v = sdf(o[0] + d[0] * nt, o[1] + d[1] * nt, o[2] + d[2] * nt);
    if (v < 0 && prev >= 0) {
      let lo = t, hi = nt;
      for (let i = 0; i < 20; i++) {
        const m = (lo + hi) / 2;
        if (sdf(o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m) < 0) hi = m; else lo = m;
      }
      return new THREE.Vector3(o[0] + d[0] * hi, o[1] + d[1] * hi, o[2] + d[2] * hi);
    }
    prev = v; t = nt;
  }
  throw new Error('[shiba-geom] surface introuvable le long du rayon');
}

/* ── squelette ─────────────────────────────────────────────────── */

/** Positions MONDE de repos (unités de construction). La pose de bind est la
 *  pose debout, pattes droites : aucune rotation, donc les inverses de bind ne
 *  sont que des translations. */
const BONES = [
  ['tilt', null, [0, SHIBA_BUILD.standHeight, 0]],
  ['body', 'tilt', [0, SHIBA_BUILD.standHeight, 0]],
  ['pelvis', 'body', [0, 0.66, -0.14]],
  ['neck', 'body', [0, 0.72, 0.34]],
  ['head', 'neck', [0, 0.93, 0.46]],
  ['jaw', 'head', [0, 0.895, 0.585]],
  ['earL', 'head', [-0.072, 1.06, 0.48]],
  ['earR', 'head', [0.072, 1.06, 0.48]],
  ['tailBase', 'pelvis', [0, 0.775, -0.40]],
];
// Avant : épaule → coude → carpe. Arrière : hanche → grasset → jarret.
// Les clés `hip / knee / paw` sont le contrat de shiba.js, quel que soit le
// nom anatomique de l'articulation.
// L'omoplate est un os à part : chez le chien elle n'est pas soudée au thorax,
// elle PIVOTE autour de son tiers haut et porte l'épaule devant / derrière.
// C'est ce qui fait bouger le relief du garrot quand l'antérieur travaille.
const SCAPULA = [0.088, 0.735, 0.250];
const LEG = {
  F: { parent: 'body', hip: [0.100, 0.60, 0.28], knee: [0.100, 0.39, 0.255], paw: [0.098, 0.095, 0.29] },
  B: { parent: 'pelvis', hip: [0.100, 0.62, -0.27], knee: [0.110, 0.38, -0.185], paw: [0.110, 0.165, -0.355] },
};
for (const fb of ['F', 'B']) {
  for (const [lr, s] of [['L', -1], ['R', 1]]) {
    const L = LEG[fb];
    const w = (p) => [s * p[0], p[1], p[2]];
    if (fb === 'F') BONES.push(['scapF' + lr, 'body', w(SCAPULA)]);
    BONES.push(['hip' + fb + lr, fb === 'F' ? 'scapF' + lr : L.parent, w(L.hip)]);
    BONES.push(['knee' + fb + lr, 'hip' + fb + lr, w(L.knee)]);
    BONES.push(['paw' + fb + lr, 'knee' + fb + lr, w(L.paw)]);
  }
}
const BONE_POS = new Map(BONES.map(([n, , p]) => [n, p]));

/* ── le corps : primitives ─────────────────────────────────────── */

/** Chaque primitive dit à quel(s) os elle appartient et dans quel groupe de robe
 *  elle se peint. Les poids de peau et les couleurs se calculent tous deux par
 *  la PROXIMITÉ des primitives, donc ils suivent exactement la même partition
 *  que la forme : il n'y a pas de seconde carte à tenir à jour. */
function bodyPrims() {
  const P = [];
  const add = (d, bones, group, k = 0.06) => P.push({ d, bones, group, k });
  // Le rein fait la transition épaules → bassin : c'est lui qui plie au galop.
  const spineBones = (x, y, z) => {
    const w = ss(0.02, -0.24, z);
    return [['body', 1 - w], ['pelvis', w]];
  };
  const neckBones = (x, y, z) => {
    const w = ss(0.71, 0.84, y + 0.35 * (z - 0.36));
    return [['body', 1 - w], ['neck', w]];
  };

  /* — tronc — garrot à 0.80, sternum à 0.40 (poitrail = 1/2 hauteur), ventre
   * relevé sous le rein (0.53), croupe de niveau avec le dos. */
  add(ellipsoid([0, 0.605, 0.215], [0.150, 0.200, 0.210]), 'body', 'torso');
  add(ellipsoid([0, 0.585, 0.35], [0.115, 0.145, 0.110]), 'body', 'torso');
  add(ellipsoid([0, 0.730, 0.24], [0.100, 0.070, 0.120]), 'body', 'torso');
  add(ellipsoid([0, 0.630, 0.03], [0.145, 0.200, 0.195]), spineBones, 'torso');
  add(ellipsoid([0, 0.662, -0.145], [0.127, 0.150, 0.160]), spineBones, 'torso');
  add(ellipsoid([0, 0.655, -0.29], [0.140, 0.150, 0.140]), 'pelvis', 'torso');
  for (const s of [-1, 1]) {
    // Omoplate et masse de cuisse : partagées entre le tronc et l'os haut du
    // membre, pour que le relief glisse avec la foulée.
    const k = s < 0 ? 'L' : 'R';
    add(ellipsoid([s * 0.087, 0.640, 0.26], [0.065, 0.130, 0.100]),
      () => [['body', 0.25], ['scapF' + k, 0.75]], 'torso', 0.05);
    add(ellipsoid([s * 0.090, 0.585, -0.27], [0.072, 0.140, 0.130]),
      () => [['pelvis', 0.45], ['hipB' + k, 0.55]], 'torso', 0.05);
  }

  /* — cou et collerette — épais, de longueur moyenne, porté haut. */
  add(cone([0, 0.70, 0.32], [0, 0.90, 0.45], 0.120, 0.095), neckBones, 'neck', 0.07);
  add(ellipsoid([0, 0.775, 0.385], [0.150, 0.150, 0.130]), neckBones, 'neck', 0.07);

  /* — tête — occiput 0.385 → truffe 0.78 : 0.395 de long, museau 0.16 (40 %).
   * Crâne large et plat, joues pleines derrière l'œil, chanfrein droit. */
  add(ellipsoid([0, 0.985, 0.50], [0.120, 0.105, 0.115]), 'head', 'head', 0.05);
  for (const s of [-1, 1]) {
    add(ellipsoid([s * 0.072, 0.935, 0.545], [0.072, 0.070, 0.075]), 'head', 'head', 0.05);
    // L'arcade sourcilière : c'est son ombre qui fait le stop.
    add(ellipsoid([s * 0.050, 1.003, 0.585], [0.038, 0.024, 0.034]), 'head', 'head', 0.025);
  }
  add(cone([0, 0.932, 0.580], [0, 0.920, 0.712], 0.069, 0.047, 0.82), 'head', 'muzzle', 0.045);

  /* — membres — avant droits, coude contre le poitrail ; arrière : cuisse
   * longue et musclée (culotte), seconde cuisse courte, jarret net. Les pieds
   * sont des pieds de chat, la sole est coupée à plat par le plan du sol. */
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const W = (p) => [s * p[0], p[1], p[2]];
    const F = LEG.F, B = LEG.B;
    add(cone(W(F.hip), W(F.knee), 0.080, 0.062), 'hipF' + k, 'leg', 0.045);
    add(cone(W(F.knee), W(F.paw), 0.056, 0.043), 'kneeF' + k, 'leg', 0.03);
    add(cone(W(F.paw), W([0.098, 0.040, 0.308]), 0.042, 0.040), 'pawF' + k, 'paw', 0.025);
    add(ellipsoid(W([0.098, 0.031, 0.328]), [0.051, 0.036, 0.060]), 'pawF' + k, 'paw', 0.03);

    add(cone(W(B.hip), W(B.knee), 0.098, 0.068), 'hipB' + k, 'leg', 0.05);
    add(ellipsoid(W([0.102, 0.50, -0.255]), [0.074, 0.135, 0.110]), 'hipB' + k, 'leg', 0.05);
    add(cone(W(B.knee), W(B.paw), 0.064, 0.040), 'kneeB' + k, 'leg', 0.03);
    add(cone(W(B.paw), W([0.110, 0.045, -0.325]), 0.039, 0.040), 'pawB' + k, 'paw', 0.025);
    add(ellipsoid(W([0.110, 0.031, -0.305]), [0.051, 0.036, 0.059]), 'pawB' + k, 'paw', 0.03);
  }
  return P;
}

/** Pelage : une rugosité de surface à ~2 cm, plus forte sur la collerette et
 *  les culottes, quasi nulle sur la face (le standard : « short on face »). */
function furAmp(x, y, z) {
  const face = ss(0.50, 0.60, z) * ss(0.85, 0.95, y);
  const ruff = Math.exp(-((z - 0.37) ** 2 + (y - 0.76) ** 2) / 0.012);
  return 0.0016 * (1 - 0.8 * face) + 0.0022 * ruff;
}

function bodySdf(prims) {
  return (x, y, z) => {
    let d = 1e9;
    for (const p of prims) d = smin(d, p.d(x, y, z), p.k);
    if (Math.abs(d) < 0.03) {
      d += furAmp(x, y, z) * (noise3(x * 48, y * 48, z * 48) + 0.5 * noise3(x * 110, y * 30, z * 110));
    }
    // La sole : un chien pose à plat.
    return Math.max(d, -y);
  };
}

/* ── la robe ───────────────────────────────────────────────────── */

const _c = new THREE.Color();
/** Bord de robe cassé par le poil : un seuil net lit comme de la peinture. */
const fur = (x, y, z, a = 1) => a * noise3(x * 38, y * 38, z * 38);

const PAINT = {
  torso(x, y, z, nx, ny, nz, out) {
    const j = fur(x, y, z, 0.12);
    // Selle sur le dos, flancs plus clairs.
    out.copy(COAT.flank).lerp(COAT.red, ss(0.0, 0.5, ny + j));
    out.lerp(COAT.saddle, ss(0.55, 0.95, ny + j) * 0.65);
    // Ventre et poitrail (le « nœud papillon » crème du poitrail).
    const under = ss(-0.10, -0.50, ny + j);
    const bib = ss(0.30, 0.42, z + j * 0.3) * ss(0.20, 0.55, nz + j) * ss(0.74, 0.62, y)
      * ss(0.13, 0.06, Math.abs(x));
    const vent = ss(-0.36, -0.44, z) * ss(-0.2, -0.6, nz) * ss(0.72, 0.62, y + j * 0.2);
    out.lerp(COAT.cream, Math.max(under, bib, vent));
  },
  neck(x, y, z, nx, ny, nz, out) {
    const j = fur(x, y, z, 0.12);
    out.copy(COAT.red).lerp(COAT.saddle, ss(0.6, 0.95, ny) * 0.5);
    // Gorge crème, qui remonte sur les côtés de la collerette.
    const throat = ss(0.0, 0.45, nz + j) * ss(0.25, -0.35, ny + j);
    out.lerp(COAT.cream, throat);
  },
  head(x, y, z, nx, ny, nz, out) {
    const j = fur(x, y, z, 0.08);
    out.copy(COAT.red).lerp(COAT.saddle, ss(0.7, 1.0, ny) * 0.35);
    const ax = Math.abs(x);
    // Joues : le bas et l'arrière des flancs de la tête, derrière l'œil.
    const cheek = ss(0.050, 0.095, ax + j * 0.02) * ss(0.975, 0.935, y + j * 0.015)
      * ss(0.46, 0.52, z);
    const under = ss(-0.15, -0.55, ny + j);
    // Taches crème au-dessus des yeux.
    const sx = (ax - 0.050) / 0.020, sy = (y - 1.022) / 0.012, sz = (z - 0.590) / 0.030;
    const spot = 1 - ss(0.6, 1.0, Math.sqrt(sx * sx + sy * sy + sz * sz));
    out.lerp(COAT.cream, Math.max(cheek, under, spot * 0.9));
  },
  muzzle(x, y, z, nx, ny, nz, out) {
    const j = fur(x, y, z, 0.06);
    out.copy(COAT.red);
    // Chanfrein roux, côtés et dessous crème : c'est le masque de la race.
    const sides = ss(0.25, -0.15, ny + j);
    out.lerp(COAT.cream, sides);
    // Lèvre : liseré noir sous le museau, vers l'avant.
    const lip = ss(-0.55, -0.85, ny) * ss(0.64, 0.70, z);
    out.lerp(COAT.dark, lip * 0.35);
  },
  leg(x, y, z, nx, ny, nz, out) {
    const j = fur(x, y, z, 0.12);
    const side = Math.sign(x) || 1;
    out.copy(COAT.red);
    // Intérieur des membres crème, et l'arrière des avant-bras.
    const inner = ss(0.05, -0.45, nx * side + j);
    const low = ss(0.30, 0.12, y + j * 0.05);
    out.lerp(COAT.sock, low * 0.7);
    out.lerp(COAT.cream, inner);
  },
  paw(x, y, z, nx, ny, nz, out) {
    out.copy(COAT.sock).lerp(COAT.cream, 0.5 + 0.5 * ss(0.0, -0.5, ny));
    // Coussinets : la sole est sombre.
    out.lerp(COAT.dark, ss(0.012, 0.002, y) * 0.8);
  },
};
const GROUPS = Object.keys(PAINT);

/* ── poids de peau ─────────────────────────────────────────────── */

const W_FALL = 0.028;   // portée de l'influence d'une primitive au-delà de la plus proche
const W_FLOOR = 0.02;   // en dessous, l'influence est jetée (puis renormalisation)

/** Portes des os de patte. Latérale : un os gauche ne tire JAMAIS un sommet de
 *  droite, et s'éteint en douceur sur la ligne médiane (sinon le sternum, entre
 *  les deux coudes, se déchire quand les pattes vont en sens opposés).
 *  Verticale : au-dessus de l'épaule / de la hanche, le flanc suit le tronc. */
function legGate(name, x, y) {
  const sc = /^scapF([LR])$/.exec(name);
  // L'omoplate : jamais sur la ligne du dos (le garrot reste au tronc).
  if (sc) return ss(0.02, 0.07, x * (sc[1] === 'L' ? -1 : 1));
  const m = /^(hip|knee|paw)[FB]([LR])$/.exec(name);
  if (!m) return 1;
  const side = m[2] === 'L' ? -1 : 1;
  // Les os bas (avant-bras, jambe, pied) n'ont rien à faire sur le sternum,
  // qui passe ENTRE les coudes à 7 cm de leur axe : à 20 % d'influence, la
  // nage le tirait en nappe (banc 26). Seul l'os haut garde une porte large.
  // Os bas : à hauteur de poitrail, porte entre 5 et 9 cm de la ligne
  // médiane (à 3.5–7 cm l'avant-bras gardait 13 % du pli d'aisselle et
  // l'étirait au galop, banc 26). Vers le sol elle s'ouvre dès 1 cm : la face
  // intérieure du pied est à 4.7 cm, la fermer laisse le pied au sol.
  const chest = ss(0.22, 0.36, y);
  let g = m[1] === 'hip' ? ss(0.0, 0.05, x * side)
    : ss(mix(0.0, 0.05, chest), mix(0.03, 0.09, chest), x * side);
  if (m[1] === 'hip') {
    // L'os haut remonte en s'effaçant jusqu'à ~16 cm au-dessus de son pivot :
    // l'omoplate et la masse de la cuisse SUIVENT le membre, le garrot et la
    // croupe non. À 7 cm, tout le haut restait collé au tronc et la jonction
    // épaule / cuisse lisait comme une pièce rigide (retour utilisateur 27/10).
    const py = BONE_POS.get(name)[1];
    g *= ss(py + 0.16, py - 0.02, y);
  }
  return g;
}

function skinAndPaint(geo, prims, boneIndex) {
  const n = geo.position.length / 3;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const color = new Float32Array(n * 3);
  const d = new Float32Array(prims.length);
  const acc = new Map();
  const gw = new Float32Array(GROUPS.length);
  const tmp = new THREE.Color();
  for (let v = 0; v < n; v++) {
    const x = geo.position[v * 3], y = geo.position[v * 3 + 1], z = geo.position[v * 3 + 2];
    let dmin = Infinity;
    for (let i = 0; i < prims.length; i++) { d[i] = prims[i].d(x, y, z); dmin = Math.min(dmin, d[i]); }
    acc.clear(); gw.fill(0);
    for (let i = 0; i < prims.length; i++) {
      const dd = d[i] - dmin;
      if (dd > 0.2) continue;
      const a = Math.exp(-dd / W_FALL);
      gw[GROUPS.indexOf(prims[i].group)] += a;
      const b = prims[i].bones;
      const list = typeof b === 'string' ? [[b, 1]] : b(x, y, z);
      for (const [name, w] of list) {
        const ww = a * w * legGate(name, x, y);
        if (ww > 0) acc.set(name, (acc.get(name) || 0) + ww);
      }
    }
    let top = [...acc.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4);
    let sum = top.reduce((s, [, w]) => s + w, 0);
    top = top.filter(([, w]) => w / sum >= W_FLOOR);
    if (!top.length) top = [['body', 1]];
    sum = top.reduce((s, [, w]) => s + w, 0);
    for (let c = 0; c < 4; c++) {
      // Une influence nulle porte l'indice 0 : le shader évalue les 4 termes.
      skinIndex[v * 4 + c] = c < top.length ? boneIndex.get(top[c][0]) : 0;
      skinWeight[v * 4 + c] = c < top.length ? top[c][1] / sum : 0;
    }

    // Couleur : mélange des peintures de groupe, pondéré comme les os.
    let gs = 0;
    for (let g = 0; g < GROUPS.length; g++) gs += gw[g];
    _c.setRGB(0, 0, 0);
    const nx = geo.normal[v * 3], ny = geo.normal[v * 3 + 1], nz = geo.normal[v * 3 + 2];
    for (let g = 0; g < GROUPS.length; g++) {
      if (gw[g] / gs < 0.01) continue;
      PAINT[GROUPS[g]](x, y, z, nx, ny, nz, tmp);
      _c.r += tmp.r * gw[g] / gs; _c.g += tmp.g * gw[g] / gs; _c.b += tmp.b * gw[g] / gs;
    }
    // Variation de mèche, faible, pour casser l'aplat.
    const lum = 1 + 0.05 * noise3(x * 45, y * 16, z * 45);
    color[v * 3] = _c.r * lum; color[v * 3 + 1] = _c.g * lum; color[v * 3 + 2] = _c.b * lum;
  }
  return { skinIndex, skinWeight, color };
}

/* ── pièces rigides ────────────────────────────────────────────── */

function partGeometry(sdf, min, max, cell, paint) {
  const g = polygonize(sdf, min, max, cell);
  const n = g.position.length / 3;
  const color = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    paint(g.position[v * 3], g.position[v * 3 + 1], g.position[v * 3 + 2],
      g.normal[v * 3], g.normal[v * 3 + 1], g.normal[v * 3 + 2], _c);
    color[v * 3] = _c.r; color[v * 3 + 1] = _c.g; color[v * 3 + 2] = _c.b;
  }
  return { ...g, color };
}

/** Triangle isocèle 2D (iq), pointe à l'origine, base à y = q.y. */
function sdTriIso(px, py, qx, qy) {
  px = Math.abs(px);
  const h1 = clamp01((px * qx + py * qy) / (qx * qx + qy * qy));
  const ax = px - qx * h1, ay = py - qy * h1;
  const h2 = clamp01(px / qx);
  const bx = px - qx * h2, by = py - qy;
  const s = -Math.sign(qy);
  const dA = ax * ax + ay * ay, sA = s * (px * qy - py * qx);
  const dB = bx * bx + by * by, sB = s * (py - qy);
  const dd = Math.min(dA, dB), sg = Math.min(sA, sB);
  return -Math.sqrt(dd) * Math.sign(sg);
}

/** Oreille : plaque triangulaire épaisse, pointe arrondie, conque creusée sur
 *  la face avant (+Z). Repère local : base à l'origine, pointe vers +Y. La base
 *  descend sous y = 0 pour s'enfoncer dans le crâne. */
const EAR = { tip: 0.098, base: -0.050, halfW: 0.050, round: 0.010 };
function earSdf(x, y, z) {
  const H = EAR.tip - EAR.base;
  const qx = EAR.halfW * H / EAR.tip;
  const d2 = sdTriIso(x, EAR.tip - y, qx, H);
  const ht = mix(0.017, 0.006, clamp01(y / EAR.tip));
  const dz = Math.abs(z + 0.004) - ht;
  const ox = Math.max(d2, 0), oz = Math.max(dz, 0);
  let d = Math.hypot(ox, oz) + Math.min(Math.max(d2, dz), 0) - EAR.round;
  d = smax(d, -ellipsoid([0, 0.042, 0.025], [0.027, 0.044, 0.015])(x, y, z), 0.012);
  return d + 0.0015 * noise3(x * 90, y * 90, z * 90);
}
function earPaint(x, y, z, nx, ny, nz, out) {
  out.copy(COAT.red);
  const conch = ss(0.15, 0.6, nz) * ss(0.036, 0.018, Math.abs(x) + 0.25 * Math.max(0, y - 0.06));
  out.lerp(COAT.earIn, conch);
  // Bord de pointe un peu plus sombre (poil plus court, plus dense).
  out.lerp(COAT.saddle, ss(0.07, 0.11, y) * 0.45);
}

/** Queue : en faucille sur le dos, attachée haut, pointée vers le cou, épaisse
 *  comme une brosse. Repère local = tailBase. */
const TAIL_PTS = [
  [0, -0.04, 0.03], [0, 0.0, 0.0], [0, 0.065, -0.030], [0, 0.128, 0.000],
  [0.010, 0.150, 0.075], [0.030, 0.128, 0.160], [0.060, 0.082, 0.205], [0.086, 0.048, 0.212],
];
const TAIL_R = [0.040, 0.047, 0.062, 0.072, 0.074, 0.066, 0.050, 0.030];
const TAIL_CURL = [0.025, 0.065, 0.090];  // centre de la boucle, pour peindre le dessous
const tailPrims = TAIL_PTS.slice(0, -1).map((a, i) => cone(a, TAIL_PTS[i + 1], TAIL_R[i], TAIL_R[i + 1]));
function tailSdf(x, y, z) {
  let d = 1e9;
  for (const p of tailPrims) d = smin(d, p(x, y, z), 0.035);
  // La brosse « s'ouvre » : poil plus long, plus de relief que sur le corps.
  if (Math.abs(d) < 0.03) d += 0.0045 * noise3(x * 34, y * 34, z * 34) + 0.0015 * noise3(x * 80, y * 80, z * 80);
  return d;
}
function tailPaint(x, y, z, nx, ny, nz, out) {
  const tx = TAIL_CURL[0] - x, ty = TAIL_CURL[1] - y, tz = TAIL_CURL[2] - z;
  const l = Math.hypot(tx, ty, tz) || 1;
  const inward = (nx * tx + ny * ty + nz * tz) / l;   // face tournée vers la boucle = dessous
  const j = fur(x, y, z, 0.15);
  out.copy(COAT.red).lerp(COAT.saddle, ss(0.3, -0.6, inward + j) * 0.45);
  out.lerp(COAT.cream, ss(0.05, 0.55, inward + j));
  // La pointe crème.
  const tip = Math.hypot(x - TAIL_PTS[7][0], y - TAIL_PTS[7][1], z - TAIL_PTS[7][2]);
  out.lerp(COAT.cream, ss(0.06, 0.025, tip) * 0.8);
}

/** Mâchoire inférieure, repère local = os jaw. Crème, liseré noir sur le dessus. */
const jawPrim = cone([0, -0.002, 0.010], [0, -0.006, 0.118], 0.046, 0.026, 0.62);
const jawSdf = (x, y, z) => jawPrim(x, y, z);
function jawPaint(x, y, z, nx, ny, nz, out) {
  out.copy(COAT.cream).lerp(COAT.dark, ss(0.45, 0.85, ny) * ss(0.03, 0.07, z) * 0.5);
}

/* ── cache : la polygonisation ne se fait qu'une fois par page ─── */

let CACHE = null;
function bake() {
  if (CACHE) return CACHE;
  const prims = bodyPrims();
  const sdf = bodySdf(prims);
  const boneIndex = new Map(BONES.map(([n], i) => [n, i]));
  const body = polygonize(sdf, [-0.21, -0.01, -0.50], [0.21, 1.14, 0.82], 0.0110);
  const skin = skinAndPaint(body, prims, boneIndex);

  // Le visage se pose SUR la peau : on lance des rayons sur le champ de la tête
  // seule, pour que yeux, truffe et oreilles affleurent exactement la surface
  // quelle que soit la retouche de forme.
  const headPrims = prims.filter((p) => p.group === 'head' || p.group === 'muzzle');
  const headSdf = (x, y, z) => { let d = 1e9; for (const p of headPrims) d = smin(d, p.d(x, y, z), p.k); return d; };
  const eyes = [-1, 1].map((s) => surfaceHit(headSdf, [s * 0.058, 0.988, 0.80], [0, 0, -1]));
  const nose = surfaceHit(headSdf, [0, 0.936, 0.90], [0, 0, -1]);
  const ears = [-1, 1].map((s) => surfaceHit(headSdf, [s * 0.072, 1.20, 0.475], [0, -1, 0]));

  const ear = partGeometry(earSdf, [-0.095, -0.06, -0.045], [0.095, 0.125, 0.045], 0.0038, earPaint);
  const tail = partGeometry(tailSdf, [-0.13, -0.10, -0.16], [0.21, 0.30, 0.33], 0.0075, tailPaint);
  const jaw = partGeometry(jawSdf, [-0.06, -0.06, -0.05], [0.06, 0.04, 0.18], 0.0045, jawPaint);
  CACHE = { body, skin, eyes, nose, ears, ear, tail, jaw };
  return CACHE;
}

function toGeometry(g, extra = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.position.slice(), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normal.slice(), 3));
  geo.setAttribute('color', new THREE.BufferAttribute((extra.color ?? g.color).slice(), 3));
  if (extra.skinIndex) {
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(extra.skinIndex.slice(), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(extra.skinWeight.slice(), 4));
  }
  geo.setIndex(g.index);
  geo.computeBoundingSphere();
  return geo;
}

function paintSolid(geo, col) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

/* ── l'animal ──────────────────────────────────────────────────── */

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler();

/**
 * Construit le shiba. Rend le rig au contrat de shiba.js : nœuds pilotés
 * (tilt, body, neck, head, jaw, lids, ears, tailBase, legs FL FR BL BR),
 * hooks de pose, `sole()`, `parts` (géométries) et `materials` à libérer.
 */
export function buildBody() {
  const B = bake();

  // Pelage : diffus mat + sheen, qui donne au contre-jour le liseré clair
  // d'un poil de garde plutôt que le reflet d'une peau.
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    sheen: 0.7,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0xffd8a8),
  });
  // Truffe et yeux : humides, donc brillants.
  const wet = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0 });

  /* squelette */
  const par = new Map();
  const bones = [];
  for (const [name, parent, p] of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    const pp = parent ? BONE_POS.get(parent) : [0, 0, 0];
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    if (parent) par.get(parent).add(b);
    par.set(name, b);
    bones.push(b);
  }
  bones[0].updateMatrixWorld(true);

  const parts = [];
  const bodyGeo = toGeometry(B.body, B.skin);
  parts.push(bodyGeo);
  const mesh = new THREE.SkinnedMesh(bodyGeo, material);
  mesh.name = 'shiba-body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // La sphère englobante d'un SkinnedMesh reflète la pose de bind et n'est
  // jamais invalidée : le chien en mouvement sortirait de son propre volume.
  mesh.frustumCulled = false;
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton, new THREE.Matrix4());

  const root = new THREE.Group();
  root.name = 'shiba';
  root.add(mesh);
  root.add(par.get('tilt'));

  const rigid = (geo, parent, name, mat = material) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    parts.push(geo);
    return m;
  };
  /** Position MONDE de repos → repère local de l'os (bind sans rotation). */
  const local = (bone, p) => _v.set(p.x - BONE_POS.get(bone)[0], p.y - BONE_POS.get(bone)[1], p.z - BONE_POS.get(bone)[2]);

  const head = par.get('head');
  const jaw = par.get('jaw');

  /* — yeux — petits, en amande, relevés vers l'oreille, enfoncés sous
   * l'arcade. Le cadre porte l'orientation ; la paupière pivote dedans sur X,
   * qui reste le canal du clignement (-0.32 ouvert → 0.58 fermé). */
  const lids = [];
  B.eyes.forEach((hit, i) => {
    const side = i === 0 ? -1 : 1;
    const frame = new THREE.Object3D();
    frame.name = 'eye-frame';
    frame.position.copy(local('head', hit));
    frame.position.z -= 0.010;
    frame.rotation.set(0.05, side * 0.42, side * 0.28, 'YXZ');
    head.add(frame);
    const rim = rigid(paintSolid(new THREE.SphereGeometry(1, 14, 10), COAT.dark), frame, 'eye-rim', wet);
    rim.scale.set(0.024, 0.0165, 0.012);
    const eye = rigid(paintSolid(new THREE.SphereGeometry(1, 14, 10), COAT.iris), frame, 'eye', wet);
    eye.scale.set(0.020, 0.0135, 0.0115);
    eye.position.z = 0.002;
    const glint = rigid(paintSolid(new THREE.SphereGeometry(1, 6, 5), new THREE.Color(0xf6f2ea)), frame, 'eye-glint', wet);
    glint.scale.setScalar(0.0032);
    glint.position.set(side * 0.004, 0.005, 0.012);

    const lid = new THREE.Object3D();
    lid.name = 'lid';
    frame.add(lid);
    const shell = new THREE.SphereGeometry(1, 14, 7, 0, TAU, 0, Math.PI * 0.5);
    const pos = shell.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      _c.copy(COAT.red).lerp(COAT.dark, ss(0.25, 0.0, pos.getY(v)) * 0.85);
      col[v * 3] = _c.r; col[v * 3 + 1] = _c.g; col[v * 3 + 2] = _c.b;
    }
    shell.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const lidMesh = rigid(shell, lid, 'eyelid');
    lidMesh.scale.set(0.0235, 0.0175, 0.0135);
    lidMesh.position.y = 0.002;
    lids.push(lid);
  });

  /* — truffe — noire, humide, fendue d'un sillon (deux lobes). */
  const noseGeo = new THREE.SphereGeometry(1, 16, 12);
  {
    const pos = noseGeo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), y = pos.getY(v);
      // Le sillon médian, et le dessus plat de la truffe.
      pos.setY(v, y - 0.18 * Math.exp(-(x * x) / 0.02) * Math.max(0, -y) + (y > 0.55 ? -(y - 0.55) * 0.5 : 0));
    }
    noseGeo.computeVertexNormals();
    paintSolid(noseGeo, COAT.dark);
  }
  const nose = rigid(noseGeo, head, 'nose', wet);
  nose.position.copy(local('head', B.nose));
  nose.position.z -= 0.010;
  nose.position.y += 0.004;
  nose.scale.set(0.024, 0.019, 0.018);

  /* — gueule — la mâchoire recouvre le museau en pose fermée ; la cavité
   * sombre n'apparaît que dans l'ouverture. */
  rigid(toGeometry(B.jaw), jaw, 'mandible');
  const cavity = rigid(paintSolid(new THREE.SphereGeometry(1, 10, 8), COAT.dark), head, 'mouth-cavity');
  cavity.position.copy(local('head', new THREE.Vector3(0, 0.894, 0.665)));
  cavity.scale.set(0.040, 0.020, 0.070);
  const tongue = rigid(paintSolid(new THREE.SphereGeometry(1, 10, 6), COAT.tongue), jaw, 'tongue');
  tongue.position.set(0, 0.010, 0.075);
  tongue.scale.set(0.030, 0.008, 0.055);

  /* — oreilles — l'os pivote ; la pièce porte un lacet fixe pour présenter la
   * conque vers l'avant, à peine ouverte vers l'extérieur. */
  const earGeo = toGeometry(B.ear);
  const ears = [par.get('earL'), par.get('earR')];
  ears.forEach((bone, i) => {
    const side = i === 0 ? -1 : 1;
    const hit = B.ears[i];
    // L'os est replacé SUR le crâne mesuré (aucun vertex skinné n'en dépend).
    bone.position.copy(local('head', hit));
    bone.position.y -= 0.016;
    const geo = i === 0 ? earGeo : earGeo.clone();
    if (i === 1) parts.push(geo);
    const m = new THREE.Mesh(geo, material);
    m.name = 'ear';
    m.castShadow = true; m.receiveShadow = true;
    m.rotation.y = side * 0.28;
    bone.add(m);
  });
  parts.push(earGeo);

  /* — queue — */
  const tailBase = par.get('tailBase');
  rigid(toGeometry(B.tail), tailBase, 'tail');

  /* — pattes, dans l'ordre FL FR BL BR : GAITS.trot apparie legs[0] avec
   * legs[3] et legs[1] avec legs[2], les diagonales. */
  const legs = [['FL', true], ['FR', true], ['BL', false], ['BR', false]].map(([key, front]) => ({
    key, front,
    hip: par.get('hip' + key[0] + key[1]),
    knee: par.get('knee' + key[0] + key[1]),
    paw: par.get('paw' + key[0] + key[1]),
    scap: front ? par.get('scapF' + key[1]) : null,
  }));
  // Pivots de repos, pour le glissé d'épaule et la levée de hanche.
  for (const l of legs) {
    l.hipRest = l.hip.position.clone();
    if (l.scap) l.scapRest = l.scap.position.clone();
  }

  /* — semelle : le plus bas des sommets skinnés que domine l'os du pied. */
  const si = bodyGeo.attributes.skinIndex, sw = bodyGeo.attributes.skinWeight;
  const byLeg = new Map(legs.map((l) => [l.key, []]));
  const pawOf = new Map(legs.map((l) => [bones.indexOf(l.paw), l.key]));
  for (let v = 0; v < si.count; v++) {
    let best = -1, bi = 0;
    for (let c = 0; c < 4; c++) { const w = sw.getComponent(v, c); if (w > best) { best = w; bi = si.getComponent(v, c); } }
    const key = pawOf.get(bi);
    if (key) byLeg.get(key).push(v);
  }
  const _s = new THREE.Vector3();
  const sole = (leg) => {
    const out = new THREE.Vector3(0, Infinity, 0);
    for (const v of byLeg.get(leg.key)) {
      mesh.getVertexPosition(v, _s);
      mesh.localToWorld(_s);
      if (_s.y < out.y) out.copy(_s);
    }
    return out;
  };

  const body = par.get('body');
  const pelvis = par.get('pelvis');
  const neck = par.get('neck');

  /* ── hooks de pose : l'anatomie du geste ───────────────────────
   * shiba.js calcule l'INTENTION (balancier de hanche, pli de genou, poids
   * d'assise / nage / secouage). Ici on la traduit sur trois articulations :
   *  - à l'appui, le pied reste À PLAT : l'os du pied compense la somme des
   *    angles au-dessus de lui, tangage du corps compris ;
   *  - en phase aérienne, l'avant replie le CARPE (le pied se retourne vers
   *    l'arrière) et l'arrière plie grasset + jarret ;
   *  - assis, l'arrière se plie en Z, jarret posé, métatarse à plat au sol. */
  let bodyPitch = 0, bodyRoll = 0;
  const hindHip = [0, 0];
  const frontLift = [0, 0];
  // Butée souple de l'épaule et de la hanche : identité jusqu'à 0.8 rad, puis
  // saturation vers 1.1. Au-delà, la peau entre coude et ventre se tend en
  // nappe (×5.6 d'étirement d'arête à la nage, à 1.34 rad, banc 26). Le galop
  // (0.95) passe presque intact ; la nage plafonne vers 1.08.
  const HIP_KNEE = 0.8, HIP_LIM = 1.1;
  const hipStop = (x) => {
    const a = Math.abs(x);
    if (a <= HIP_KNEE) return x;
    return Math.sign(x) * (HIP_KNEE + (HIP_LIM - HIP_KNEE) * Math.tanh((a - HIP_KNEE) / (HIP_LIM - HIP_KNEE)));
  };
  /* — IK de pied —
   * Les angles seuls (balancier en sinus) ne posent pas un pied : il touche au
   * fond d'un V, s'enfonce, glisse. Quand shiba.js fournit `reach` (le point
   * MONDE où doit être le dessous du coussinet, PAW_SOLE), on résout la patte
   * à deux os dans le plan sagittal de son parent (omoplate devant, bassin
   * derrière), pied tenu à `footPitch` du plan du root. L'écart latéral (roulis
   * du tronc, lacet du bassin) est rattrapé par une abduction de la hanche
   * (rotation.z, ordre ZXY : elle s'applique APRÈS le balancier). */
  const ang = (y, z) => Math.atan2(y, z);
  const _ikT = new THREE.Vector3(), _ikZ = new THREE.Vector3();
  const _ikQ = new THREE.Quaternion(), _ikR = new THREE.Quaternion();
  const ik = { h: 0, k: 0, p: 0, g: 0 };
  for (const l of legs) {
    const K0 = l.knee.position, A0 = l.paw.position, S = PAW_SOLE[l.front ? 'F' : 'B'];
    // Côté du genou : celui du repos (coude derrière, grasset devant).
    const Dz = K0.z + A0.z, Dy = K0.y + A0.y;
    l.bend = Math.sign(Dz * K0.y - Dy * K0.z);
    l.chainAng = ang(Dy + S[1], Dz + S[2]);
    l.hip.rotation.order = 'ZXY';
  }
  /** Angle d'épaule / de hanche (repère du tronc) qui pointe vers `target` :
   *  sert au partage omoplate / épaule et aux glissés de pivot, AVANT la
   *  résolution exacte. */
  const guessHip = (leg, target) => {
    const par = leg.hip.parent;
    par.updateWorldMatrix(true, false);
    _ikT.copy(target); par.worldToLocal(_ikT).sub(leg.hipRest);
    return leg.chainAng - ang(_ikT.y, _ikT.z) + (leg.front ? leg.scap.rotation.x : 0);
  };
  /** `toe` : distance (u modèle) entre le dessous du coussinet et le bout des
   *  doigts. Non nul, `target` est la sole À PLAT et le pied pivote autour des
   *  DOIGTS (décollage : le talon se lève, la portée s'allonge). */
  const solveLeg = (leg, target, footPitch, toe) => {
    const par = leg.hip.parent;
    par.updateWorldMatrix(true, false);
    // Tangage du parent dans le repère du root : le pied est tenu à plat sur
    // le plan du root (pente partielle), bassin fléchi au galop compris.
    root.getWorldQuaternion(_ikR).invert().multiply(par.getWorldQuaternion(_ikQ));
    _ikZ.set(0, 0, 1).applyQuaternion(_ikR);
    const flat = -Math.atan2(-_ikZ.y, _ikZ.z);
    const rel = footPitch + flat;
    const S = PAW_SOLE[leg.front ? 'F' : 'B'];
    const c = Math.cos(rel), s = Math.sin(rel);
    _ikT.copy(target); par.worldToLocal(_ikT).sub(leg.hip.position);
    if (toe) {
      // Doigts = sole à plat + toe vers l'avant ; sole = doigts - toe tourné.
      _ikT.y += toe * (Math.sin(rel) - Math.sin(flat));
      _ikT.z += toe * (Math.cos(flat) - Math.cos(rel));
    }
    // Cible de la cheville / du jarret : la sole moins son décalage tourné.
    const Px = _ikT.x - S[0], Py = _ikT.y - (S[1] * c - S[2] * s), Pz = _ikT.z - (S[1] * s + S[2] * c);
    const K0 = leg.knee.position, A0 = leg.paw.position;
    const x0 = K0.x + A0.x;
    const yl = -Math.sqrt(Math.max(Px * Px + Py * Py - x0 * x0, 1e-6));
    ik.g = Math.atan2(Py, Px) - Math.atan2(yl, x0);
    const a = Math.hypot(K0.y, K0.z), b = Math.hypot(A0.y, A0.z);
    // Hors de portée (fin d'appui, pied loin derrière) : on garde la HAUTEUR
    // et on rapproche le pied à l'horizontale. Raccourcir le long de la
    // droite hanche → pied le soulèverait en plein appui.
    const R = (a + b) * 0.9995;
    let Pzr = Pz;
    if (Pz * Pz + yl * yl > R * R) Pzr = Math.sign(Pz) * Math.sqrt(Math.max(R * R - yl * yl, 0));
    const d = Math.min(Math.max(Math.hypot(Pzr, yl), Math.abs(a - b) + 1e-4), R);
    const aD = ang(yl, Pzr);
    const aK = aD + leg.bend * Math.acos(Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d))));
    ik.h = ang(K0.y, K0.z) - aK;
    const Kz = a * Math.cos(aK), Ky = a * Math.sin(aK);
    ik.k = ang(A0.y, A0.z) - ang(d * Math.sin(aD) - Ky, d * Math.cos(aD) - Kz) - ik.h;
    ik.p = rel - ik.h - ik.k;
    return ik;
  };

  const poseLeg = (leg, hipIn, knee, {
    sit = 0, swim = 0, lie = 0, reach = null, ik: ikW = 0, fold: reachFold = 0, footPitch = 0, toe = 0,
  } = {}) => {
    const w = reach ? ikW : 0;
    // Sous IK, l'intention (balancier, repli) vient de la cible : le partage
    // d'omoplate, les glissés de pivot et le roulis du poitrail la suivent.
    const hip = w > 0 ? mix(hipStop(hipIn), guessHip(leg, reach), w) : hipStop(hipIn);
    const fold = mix(Math.max(0, -knee), reachFold, w);    // repli de phase aérienne
    leg.hip.rotation.x = hip;
    if (leg.front) {
      // L'omoplate prend ~35 % de l'angle et l'épaule le reste : la SOMME est
      // inchangée (le pied à plat compense toujours hip + elbow), mais le
      // pivot de l'épaule avance / recule réellement sous la peau.
      const scap = 0.35 * hip * (1 - lie);
      leg.scap.rotation.x = scap;
      leg.hip.rotation.x = hip - scap;
    }
    // L'épaule d'un chien n'est pas une rotule fixe : l'omoplate GLISSE sur le
    // thorax, vers l'arrière quand le membre recule, et se soulève quand il se
    // replie. La hanche se lève aussi en phase aérienne. Translations du pivot
    // (repère du tronc), la peau partagée les suit.
    const glide = leg.front ? 0.065 : 0.020;
    // Avant : l'épaule de la patte qui se replie RETOMBE (elle n'est plus
    // chargée) ; celle d'appui reste, sinon on soulèverait un pied posé —
    // le garrot qui monte à mi-appui vient du rebond du tronc, pas de
    // l'omoplate. Arrière : la hanche se lève en phase aérienne.
    const lift = (leg.front ? -0.022 * ss(0.0, 0.4, fold) : 0.022 * fold) * (1 - sit) * (1 - swim);
    if (leg.front) {
      // Le glissé et la levée portent sur l'OMOPLATE (le relief du garrot).
      leg.scap.position.set(leg.scapRest.x, leg.scapRest.y + 1.3 * lift, leg.scapRest.z - glide * hip * (1 - sit));
    } else {
      leg.hip.position.set(leg.hipRest.x, leg.hipRest.y + lift, leg.hipRest.z - glide * hip * (1 - sit));
    }
    if (leg.front) {
      frontLift[leg.key === 'FL' ? 0 : 1] = lift;
      // Le poitrail roule vers l'épaule qui porte : c'est elle qui monte.
      // Posé (pas cumulé) : l'IK repose FL après FR, sans doubler le roulis.
      if (leg.key === 'FR') body.rotation.z = bodyRoll + 1.6 * (frontLift[1] - frontLift[0]);
    }
    if (!leg.front) {
      hindHip[leg.key === 'BL' ? 0 : 1] = hip;
      // Bascule du bassin : il roule vers la patte d'appui à chaque pas.
      if (leg.key === 'BR') pelvis.rotation.z = 0.05 * (hindHip[0] - hindHip[1]) * (1 - sit);
    }
    if (leg.front) {
      const elbow = -0.42 * fold;
      leg.knee.rotation.x = elbow;
      const plant = -(bodyPitch + hip + elbow);
      // Couché en sphinx, l'avant-bras est au sol et le pied le prolonge vers
      // l'avant (≈ -1.45 rad monde) au lieu de se replier.
      leg.paw.rotation.x = mix(plant + fold * mix(1.55, 0.9, swim), -1.45 - (bodyPitch + hip + elbow), lie);
    } else {
      const stifle = knee > 0 ? knee : 0.70 * fold;
      leg.knee.rotation.x = stifle;
      const plant = -(bodyPitch + hip + stifle);
      const walk = plant - 0.55 * fold;
      // Assis : métatarse couché vers l'avant (-1.45 rad ≈ vers +Z). Son
      // angle de repos (-0.24, il descend déjà un peu vers l'avant) se retire.
      const sitFoot = -1.21 - (bodyPitch + hip + stifle);
      leg.paw.rotation.x = mix(walk, sitFoot, sit);
    }
    leg.hip.rotation.z = 0;
    if (w > 0) {
      const s = solveLeg(leg, reach, footPitch, toe);
      leg.hip.rotation.x = mix(leg.hip.rotation.x, s.h, w);
      leg.hip.rotation.z = w * s.g;
      leg.knee.rotation.x = mix(leg.knee.rotation.x, s.k, w);
      leg.paw.rotation.x = mix(leg.paw.rotation.x, s.p, w);
    }
  };

  // L'assise pivote autour des ÉPAULES, pas du milieu du tronc : un chien qui
  // s'assied laisse ses antérieurs où ils sont et descend l'arrière-train.
  const SIT_PIVOT = new THREE.Vector3(0, LEG.F.hip[1] - SHIBA_BUILD.standHeight, LEG.F.hip[2]);
  // La colonne n'a que deux os (tronc → bassin), mais la peau du rein les
  // mélange : tourner le bassin contre le tronc COURBE le dos. Trois plans :
  //  - latéral (lacet) : le plus grand mouvement de la colonne aux allures
  //    symétriques — le bassin part du côté du postérieur qui se pose, le
  //    poitrail contre-tourne vers l'antérieur qui mène ; plus la courbe d'un
  //    virage, dos arqué dans le sens où il tourne ;
  //  - sagittal (tangage) : fléchi au posé des postérieurs, étendu à leur
  //    décollage — faible au pas / trot, majeur au galop (`flex`) ;
  //  - le bassin rebondit plus que le poitrail.
  // Les INTENTIONS viennent d'animate() (qui connaît les phases) ; ici on les
  // répartit sur les os.
  const pelvisRest = pelvis.position.clone();
  let chestYaw = 0, pelvisYaw = 0;
  const poseBody = (y, pitch, roll, {
    sit = 0, flex = 0, lat = 0, sag = 0, bounce = 0, bend = 0, sway = 0,
  } = {}) => {
    bodyPitch = pitch;
    bodyRoll = roll;
    // La torsion se partage à parts presque égales : le poitrail porte autant
    // le geste que le bassin (sinon tout le mouvement part dans l'arrière-train).
    chestYaw = -0.9 * lat + bend + 0.6 * sway;
    pelvisYaw = lat - bend - 0.4 * sway;
    body.rotation.set(pitch, chestYaw, roll);
    _v.copy(SIT_PIVOT).multiplyScalar(sit);
    _w.copy(_v).applyEuler(_e.set(pitch, chestYaw, roll));
    body.position.set(0, y, 0).add(_v).sub(_w);
    // Le bassin est l'enfant du tronc : son lacet RELATIF porte la différence.
    pelvis.rotation.y = pelvisYaw - chestYaw;
    pelvis.rotation.x = flex + sag + 0.12 * sit;
    pelvis.position.set(pelvisRest.x, pelvisRest.y + bounce, pelvisRest.z);
  };

  // La tête n'est stabilisée qu'à MOITIÉ : un chien garde le regard à peu
  // près de niveau, mais sa tête vit — elle hoche avec les antérieurs et
  // suit le corps avec retard. Un lissage exponentiel de 0.22 s (version
  // précédente) écrasait tout ce qui bat à la cadence du pas (2–3 Hz) : tête
  // figée. Un ressort sous-amorti laisse passer le hochement, le retarde un
  // peu et adoucit quand même les sauts de `lookUp`.
  const W_TETE = 13, Z_TETE = 0.55;
  const neckRest = neck.position.clone();
  let hP = 0, hV = 0, nP = 0, nV = 0, lastDt = 1 / 60;
  const poseHead = (p) => {
    lastDt = p.dt > 0 ? Math.min(p.dt, 0.1) : 0;
    if (lastDt <= 0) { hP = p.headPitch; nP = p.neckPitch; hV = nV = 0; }
    else {
      hV += (W_TETE * W_TETE * (p.headPitch - hP) - 2 * Z_TETE * W_TETE * hV) * lastDt; hP += hV * lastDt;
      nV += (W_TETE * W_TETE * (p.neckPitch - nP) - 2 * Z_TETE * W_TETE * nV) * lastDt; nP += nV * lastDt;
    }
    const lissTete = hP, lissCou = nP;
    // Assis, le tronc est basculé de 0.60 : à 25 % de compensation le chien
    // fixait le ciel. Posé (assis / couché) il compense presque tout.
    // `comp` = part TOTALE du tangage compensée, partagée moitié cou, moitié tête.
    const comp = mix(0.5, 0.85, clamp01(p.rest ?? 0));
    neck.rotation.x = lissCou - 0.5 * comp * bodyPitch;
    // Balancier vertical de la tête, porté par la base du cou.
    neck.position.set(neckRest.x, neckRest.y + (p.bob ?? 0), neckRest.z);
    // Le cou contre-tourne une PARTIE de la torsion du poitrail : la tête
    // suit les épaules sans que le regard ne quitte l'axe de la marche.
    neck.rotation.y = -0.40 * chestYaw;
    neck.rotation.z = p.neckRoll;
    head.rotation.set(lissTete - 0.5 * comp * bodyPitch, p.headYaw, p.headRoll, 'YXZ');
  };

  // Queue : un ressort sous-amorti sur le battement. La brosse est lourde, elle
  // suit le geste avec un temps de retard et dépasse un peu — c'est ce qui la
  // fait lire comme du poil et pas comme une pièce vissée.
  let tY = 0, vY = 0, tX = 0, vX = 0;
  const poseTail = (x, y, z) => {
    const dt = lastDt;
    // La queue est portée par le bassin : elle suit son lacet, avec le retard
    // du ressort (action superposée) au lieu de bouger d'un bloc avec lui.
    y += 0.5 * pelvisYaw;
    if (dt <= 0) { tY = y; tX = x; vY = vX = 0; }
    else {
      const w = 15, zeta = 0.5;
      vY += (w * w * (y - tY) - 2 * zeta * w * vY) * dt; tY += vY * dt;
      vX += (w * w * (x - tX) - 2 * w * vX) * dt; tX += vX * dt;
    }
    tailBase.rotation.set(tX, tY, z);
  };

  return {
    root, mesh, skeleton, legs,
    tilt: par.get('tilt'), body, pelvis, neck, head, jaw, lids, ears, tailBase,
    parts, material, materials: [material, wet], sole,
    poseLeg, poseBody, poseHead, poseTail,
  };
}
