/** shiba-gltf.js — le chien du tutoriel Codedex, rigue a la main.
 *
 *  L'asset (« Shiba » de zixisun02, CC-BY-4.0) est une STATUE : zero animation,
 *  zero skin, un shell soude de 3708 triangles. Ce module lui fabrique le
 *  squelette qu'il n'a pas, au contrat exact de buildBody() de shiba-geom.js,
 *  pour que animate() de shiba.js le pilote sans etre reecrit.
 *
 *  Trois choses portent tout le fichier, et aucune n'est evidente :
 *
 *  1. TOUS les ancrages sont MESURES sur la geometrie, pas authores. Le glTF
 *     est en Z-up : le graphe porte une rotation -90 X, donc les positions
 *     brutes du .bin decrivent un chien couche sur le dos. On applique les
 *     matrices de noeuds AVANT de mesurer quoi que ce soit.
 *  2. Le materiau charge est un MeshBasicMaterial, pas un Standard : l'asset
 *     declare KHR_materials_unlit. Ecrire roughness dessus ne leve aucune
 *     erreur et ne fait RIEN. On reconstruit un MeshStandardMaterial.
 *  3. Les os des paupieres et des oreilles seront bindes dans une pose NON
 *     NULLE (tache 3), parce que animate() leur ecrit une valeur non nulle au
 *     repos. Bindes a l'identite, ils donneraient une deformation permanente.
 *
 *  Etat : tache 2 du chantier G. loadShibaBody() rend pour l'instant la
 *  geometrie normalisee et son materiau ; le squelette arrive en tache 3.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Echelle et recentrage, mesures : K par la longueur hors-tout (1.461 / 1.775),
 *  DZ pour amener le milieu des appuis EN CONTACT sur l'origine. Ne pas deriver
 *  DZ d'une tranche epaisse : le milieu bouge de 0.02 a 0.06 selon le seuil,
 *  soit jusqu'a trois fois la tolerance de l'invariant 23. DZ est ici la valeur
 *  ATTENDUE ; la fonction la remesure et n'utilise pas cette constante, qui
 *  documente le resultat et sert de repere si la mesure derive un jour. */
export const NORM = Object.freeze({ K: 0.823, DZ: 0.300 });

const URL_DEFAUT = 'assets/shiba/shiba.glb';
/** Un vertex « en contact » est a moins de ca au-dessus de la semelle. */
const SEUIL_CONTACT = 0.02;
/** Partage avant/arriere des appuis, entre les deux trains. */
const Z_ENTRE_TRAINS = -0.40;

/** Charge le .glb et fusionne ses trois meshes en une geometrie unique.
 *  Rend aussi les intervalles de vertices de chacun : apres fusion, le collier
 *  et les yeux ne sont plus identifiables autrement, et la tache 3 en a besoin
 *  pour leur affectation de poids en dur. */
async function chargerGeometrie(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  // Les matrixWorld ne sont PAS a jour a la sortie du loader, et c'est la que
  // vit la conversion Z-up -> Y-up. Sans ce parcours, tout est de travers.
  gltf.scene.updateMatrixWorld(true);

  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (meshes.length !== 3) {
    throw new Error(`[shiba-gltf] 3 meshes attendus, ${meshes.length} trouves`);
  }
  // Ordre impose : corps (le plus gros), collier, yeux. On trie par nombre de
  // vertices decroissant plutot que par nom : les noms sont ceux de l'export
  // Sketchfab (Box002, Group18985, Object001) et ne se lisent pas.
  meshes.sort((a, b) => b.geometry.attributes.position.count
                      - a.geometry.attributes.position.count);
  const [corps, collier, yeux] = meshes;

  const sources = [corps, collier, yeux];
  const geos = sources.map((o) => {
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    return g;
  });
  const geometry = mergeGeometries(geos, false);
  // mergeGeometries rend null + console.error : il ne LEVE pas.
  if (!geometry) throw new Error('[shiba-gltf] fusion des geometries refusee');

  const nCorps = geos[0].attributes.position.count;
  const nCollier = geos[1].attributes.position.count;
  const nYeux = geos[2].attributes.position.count;

  // Le materiau est unique dans l'asset, mais le loader peut en instancier un
  // par mesh : on les dedoublonne pour n'en disposer chacun qu'une fois. La
  // texture, elle, est PARTAGEE et ne doit surtout pas etre disposee ici.
  const materiauxSource = [...new Set(sources.map((o) => o.material))];

  // Les clones sont fusionnes, les originaux ne servent plus.
  for (const g of geos) g.dispose();
  for (const o of sources) o.geometry.dispose();

  return {
    geometry,
    materiauxSource,
    ranges: {
      corps: [0, nCorps],
      collar: [nCorps, nCorps + nCollier],
      eyes: [nCorps + nCollier, nCorps + nCollier + nYeux],
    },
  };
}

/** Semelles a y = 0, milieu des appuis EN CONTACT a z = 0, echelle K.
 *  Rend le recentrage reellement applique, pour que l'appelant puisse le
 *  comparer a NORM.DZ. */
function normaliser(geometry) {
  const pos = geometry.attributes.position;
  let yMin = Infinity;
  for (let i = 0; i < pos.count; i++) yMin = Math.min(yMin, pos.getY(i));

  // Appuis = vertices en contact avec le sol. Une tranche epaisse donnerait
  // un tout autre milieu : c'est la definition, pas le seuil, qui compte.
  let zAv = 0, nAv = 0, zAr = 0, nAr = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) - yMin >= SEUIL_CONTACT) continue;
    const z = pos.getZ(i);
    if (z > Z_ENTRE_TRAINS) { zAv += z; nAv++; } else { zAr += z; nAr++; }
  }
  if (!nAv || !nAr) throw new Error('[shiba-gltf] appuis introuvables');
  const milieu = (zAv / nAv + zAr / nAr) / 2;

  // premultiply : le resultat est T * S, donc on met a l'echelle PUIS on
  // translate. Dans l'autre ordre, la translation serait elle aussi mise a
  // l'echelle et les semelles ne tomberaient pas sur zero.
  const m = new THREE.Matrix4()
    .makeScale(NORM.K, NORM.K, NORM.K)
    .premultiply(new THREE.Matrix4().makeTranslation(
      0, -yMin * NORM.K, -milieu * NORM.K,
    ));
  geometry.applyMatrix4(m);
  geometry.computeBoundingBox();
  return { dz: -milieu * NORM.K };
}

/** L'asset est unlit : le loader rend un MeshBasicMaterial, sans roughness ni
 *  metalness, qui ne recoit NI lumiere NI ombre. On reconstruit un Standard en
 *  reprenant sa texture (dont le colorSpace srgb est deja pose par le loader ;
 *  la refabriquer a la main rouvrirait ce piege).
 *  vertexColors: false est EXPLICITE : le materiau procedural vaut true, et en
 *  heriter sans attribut `color` rendrait le chien noir (piege n°2). */
function construireMateriau(materiauxSource) {
  const src = materiauxSource[0];
  const material = new THREE.MeshStandardMaterial({
    map: src.map,
    roughness: 0.90,
    metalness: 0.0,
    vertexColors: false,
    // doubleSided tel que charge. Descendre a FrontSide demande de verifier que
    // la geometrie fusionnee est fermee (piege n°1 : une face manquante est
    // INVISIBLE, sans erreur) — ce n'est pas le sujet de ce chantier.
    side: src.side,
  });
  // Les MeshBasicMaterial abandonnes. Leur `map` est partagee avec le materiau
  // qu'on vient de construire : dispose() d'un materiau ne touche pas a sa
  // texture, donc elle survit — c'est exactement ce qu'on veut.
  for (const m of materiauxSource) m.dispose();
  return material;
}

/* ── Le squelette ─────────────────────────────────────────────── */

/** Ancrages MESURES sur la geometrie normalisee (cf. spec, « Reperes finaux »).
 *  L'ORDRE de ce tableau definit la semantique de skinIndex : ne jamais le
 *  reordonner sans reconstruire les poids.
 *
 *  La colonne de bind n'est PAS decorative. animate() ecrit sur certains os une
 *  valeur non nulle AU REPOS — les paupieres mix(-0.32, 0.58, blink) donc -0.32
 *  (shiba.js:621), les oreilles landEarX = -0.30 + 0.34*speedN et
 *  landEarZ = side*(0.20 + 0.10*gust) donc -0.30 et side*0.20 (shiba.js:596-600).
 *  Un os binde a l'identite transformerait ces valeurs en deformation
 *  PERMANENTE. Ne pas recopier la pose d'auteur de shiba-geom.js:568-573
 *  (-0.44, side*0.22, side*0.18) : elle est ecrasee en vol par animate() et n'a
 *  jamais ete la pose de repos reelle. */
const OS = [
  // nom,      parent,    position locale,            pose de bind
  ['tilt',     null,      [0, 0.360, 0],              null],
  ['body',     'tilt',    [0, 0, 0],                  null],
  ['neck',     'body',    [0, +0.223, +0.124],        null],
  ['head',     'neck',    [0, +0.117, +0.096],        null],
  ['jaw',      'head',    [0, -0.140, +0.210],        null],
  ['lidL',     'head',    [-0.097, +0.171, +0.219],   { x: -0.32 }],
  ['lidR',     'head',    [+0.097, +0.171, +0.219],   { x: -0.32 }],
  ['earL',     'head',    [-0.165, +0.337, -0.043],   { x: -0.30, z: -0.20 }],
  ['earR',     'head',    [+0.165, +0.337, -0.043],   { x: -0.30, z: +0.20 }],
  ['tailBase', 'body',    [0, +0.093, -0.507],        null],
  ['hipFL',    'body',    [-0.184, -0.179, +0.193],   null],
  ['kneeFL',   'hipFL',   [0, -0.081, 0],             null],
  ['pawFL',    'kneeFL',  [0, -0.080, +0.010],        null],
  ['hipFR',    'body',    [+0.184, -0.179, +0.193],   null],
  ['kneeFR',   'hipFR',   [0, -0.081, 0],             null],
  ['pawFR',    'kneeFR',  [0, -0.080, +0.010],        null],
  ['hipBL',    'body',    [-0.243, -0.179, -0.193],   null],
  ['kneeBL',   'hipBL',   [0, -0.081, 0],             null],
  ['pawBL',    'kneeBL',  [0, -0.080, +0.010],        null],
  ['hipBR',    'body',    [+0.243, -0.179, -0.193],   null],
  ['kneeBR',   'hipBR',   [0, -0.081, 0],             null],
  ['pawBR',    'kneeBR',  [0, -0.080, +0.010],        null],
];

function construireSquelette() {
  const par = new Map();
  const bones = [];
  for (const [nom, parent, [x, y, z], bind] of OS) {
    const b = new THREE.Bone();
    b.name = nom;
    b.position.set(x, y, z);
    if (bind) {
      if (bind.x !== undefined) b.rotation.x = bind.x;
      if (bind.z !== undefined) b.rotation.z = bind.z;
    }
    if (parent) par.get(parent).add(b);
    par.set(nom, b);
    bones.push(b);
  }
  // Les matrixWorld doivent etre a jour AVANT le Skeleton : c'est la qu'il
  // calcule les boneInverses. Sans ca, les poses de bind ci-dessus sont perdues.
  bones[0].updateMatrixWorld(true);
  return { bones, par };
}

/* ── Les poids ────────────────────────────────────────────────── */

/** smoothstep, qui tolere a > b (porte inversee). */
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/** Une porte par os. Sans elles, une patte gauche aspire la droite (0.37 u
 *  d'ecart pour un os de 0.16), et surtout les os les plus animes capturent le
 *  crane. Ce sont des smoothstep et pas des coupures : une coupure franche
 *  laisse une couture visible sur un mesh lisse.
 *
 *  jaw et lids ont une porte NULLE, et c'est deliberé : la gueule et les yeux
 *  sont PEINTS dans la texture. Les paupieres ne recoivent que l'affectation
 *  dure des billes d'yeux — leur laisser la porte du museau ferait froisser le
 *  visage a chaque clignement, qui bascule de 0.90 rad plusieurs fois par 10 s. */
function porte(nom, x, y, z) {
  if (nom === 'jaw' || nom === 'lidL' || nom === 'lidR') return 0;
  if (nom === 'body') return 1;                   // receptacle par defaut
  if (nom === 'head') return ss(0.00, 0.18, z);
  // Le terme vertical du cou n'est pas ornemental : les appuis avant sont a
  // z = +0.193, en plein dans sa bande longitudinale. Sans lui, le cou tirerait
  // les pattes avant.
  if (nom === 'neck') return ss(-0.15, 0.05, z) * ss(0.36, 0.16, z) * ss(0.22, 0.40, y);
  if (nom === 'tailBase') return ss(-0.30, -0.50, z);
  if (nom === 'earL') return ss(0, -0.06, x) * ss(0.90, 1.05, y);
  if (nom === 'earR') return ss(0, +0.06, x) * ss(0.90, 1.05, y);
  const m = /^(hip|knee|paw)([FB])([LR])$/.exec(nom);
  if (m) {
    const zHanche = m[2] === 'F' ? +0.193 : -0.193;
    const lat = m[3] === 'L' ? ss(0, -0.10, x) : ss(0, +0.10, x);
    // La bande longitudinale se deduit de l'ECARTEMENT DES HANCHES (0.386 entre
    // les deux trains), pas du gout. Une premiere version portait 0.26 pleine /
    // 0.42 nulle : au milieu du ventre, |z - 0.193| = 0.193 < 0.26, donc LES
    // QUATRE pattes avaient leur porte grande ouverte au meme endroit. Au galop,
    // ou l'avant et l'arriere tournent en sens opposes, le ventre se dechirait —
    // une nappe etiree entre l'epaule et la patte, visible en gros plan et
    // attrapee par l'invariant de derive (0.390 pour un plafond de 0.35).
    return lat * ss(0.22, 0.10, Math.abs(z - zHanche)) * ss(0.34, 0.20, y);
  }
  return 0;
}

const EPS = 0.023;     // 2 % de la hauteur du chien
const P = 4;           // exposant du falloff
/** body n'a pas de segment (il est a (0,0,0) dans tilt, et un point attire de
 *  facon isotrope) : il prend pour proxy l'axe cou -> queue. */
const RACHIS = [
  new THREE.Vector3(0, 0.583, +0.124),
  new THREE.Vector3(0, 0.453, -0.507),
];
/** Le plumet, mesuré : il court de la base de queue au centroïde de son bout.
 *  Sans ce proxy, l'os de queue héritait du segment corps -> tailBase, qui se
 *  SUPERPOSE au rachis ci-dessus — et `body`, dont la porte vaut 1 partout,
 *  gagnait 152 des 229 vertices du plumet. Les deux tiers de la queue étaient
 *  collés au corps et ne remuaient pas. */
const AXE_QUEUE = [
  new THREE.Vector3(0, 0.453, -0.507),
  new THREE.Vector3(0, 0.461, -0.788),
];

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _proj = new THREE.Vector3();
function distanceAuSegment(p, a, b) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const l2 = _ab.lengthSq();
  const t = l2 > 1e-12 ? Math.min(1, Math.max(0, _ap.dot(_ab) / l2)) : 0;
  _proj.copy(a).addScaledVector(_ab, t);
  return p.distanceTo(_proj);
}

function calculerPoids(geometry, bones, ranges) {
  const pos = geometry.attributes.position;
  const n = pos.count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);

  // Segments de chaque os dans la pose de bind. root est a l'identite a ce
  // stade, donc matrixWorld donne directement des coordonnees de construction,
  // le meme repere que la geometrie normalisee.
  const seg = bones.map((b) => {
    if (b.name === 'tilt') return null;                   // structurel
    if (b.name === 'body') return RACHIS;
    if (b.name === 'tailBase') return AXE_QUEUE;
    return [
      new THREE.Vector3().setFromMatrixPosition(b.parent.matrixWorld),
      new THREE.Vector3().setFromMatrixPosition(b.matrixWorld),
    ];
  });
  const idx = (nom) => bones.findIndex((b) => b.name === nom);
  const idxNeck = idx('neck'), idxLidL = idx('lidL'), idxLidR = idx('lidR');

  const p = new THREE.Vector3();
  const cand = [];
  for (let v = 0; v < n; v++) {
    p.fromBufferAttribute(pos, v);
    // Affectations DURES : le collier suit le cou comme un objet rigide, les
    // billes d'yeux suivent leur paupiere. Elles court-circuitent le calcul.
    if (v >= ranges.collar[0] && v < ranges.collar[1]) {
      si[v * 4] = idxNeck; sw[v * 4] = 1; continue;
    }
    if (v >= ranges.eyes[0] && v < ranges.eyes[1]) {
      si[v * 4] = p.x < 0 ? idxLidL : idxLidR; sw[v * 4] = 1; continue;
    }
    cand.length = 0;
    for (let b = 0; b < bones.length; b++) {
      if (!seg[b]) continue;
      const g = porte(bones[b].name, p.x, p.y, p.z);
      if (g <= 0) continue;
      const d = distanceAuSegment(p, seg[b][0], seg[b][1]);
      cand.push([g / Math.pow(d + EPS, P), b]);
    }
    // Les 4 plus gros ; a egalite le plus petit indice d'os gagne, pour que le
    // resultat soit deterministe.
    cand.sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));
    let somme = 0;
    const k = Math.min(4, cand.length);
    for (let i = 0; i < k; i++) somme += cand[i][0];
    for (let i = 0; i < k; i++) {
      si[v * 4 + i] = cand[i][1];
      sw[v * 4 + i] = cand[i][0] / somme;
    }
    // Les influences inutilisees restent (indice 0, poids 0) : JAMAIS un indice
    // invalide « puisque le poids est nul ». Les 4 termes sont toujours evalues
    // par le shader, et 0.0 * NaN = NaN detruit le vertex.
  }
  // normalized: false. Avec true, un Uint16 est divise par 65535, tous les
  // indices tombent a ~0, et LE CHIEN ENTIER se colle a l'os 0 sans une seule
  // erreur.
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}

/* ── L'assemblage ─────────────────────────────────────────────── */

function assembler(geometry, material, bones, par) {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'shiba-body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // La bounding sphere d'un SkinnedMesh est calculee UNE fois et jamais
  // invalidee : elle refleterait la pose de la premiere frame, et le chien — ou
  // seulement son ombre — clignoterait des qu'il s'anime hors d'elle.
  mesh.frustumCulled = false;
  mesh.normalizeSkinWeights();

  const skeleton = new THREE.Skeleton(bones);
  // bindMatrix identite EXPLICITE : sans second argument, bind() appelle
  // calculateInverses() et ECRASE les inverses qu'on vient de calculer.
  mesh.bind(skeleton, new THREE.Matrix4());

  const root = new THREE.Group();
  root.name = 'shiba';
  // Le mesh ET la racine d'os sous le MEME parent : en AttachedBindMode,
  // mesh.position/rotation/scale n'a AUCUN effet visuel, la transform du mesh
  // etant annulee par bindMatrixInverse. C'est root que shiba.js deplace, et
  // c'est le seul montage qui marche.
  root.add(mesh);
  root.add(par.get('tilt'));

  // L'ordre FL, FR, BL, BR est OBLIGATOIRE : GAITS.trot.ph = [0, pi, pi, 0]
  // apparie legs[0] avec legs[3] et legs[1] avec legs[2] — ce sont les
  // diagonales. Un ordre FL, BL, FR, BR ferait trotter le chien a l'amble.
  const legs = [['FL', true], ['FR', true], ['BL', false], ['BR', false]]
    .map(([key, front]) => ({
      key, front,
      hip: par.get('hip' + key), knee: par.get('knee' + key), paw: par.get('paw' + key),
    }));

  // Le contrat de buildBody(), nom pour nom. lids et ears sont [gauche, droite]
  // — shiba.js:595 associe ears[0] au cote side = -1, donc x < 0.
  return {
    root, mesh, skeleton, legs,
    tilt: par.get('tilt'),
    body: par.get('body'),
    neck: par.get('neck'),
    head: par.get('head'),
    jaw: par.get('jaw'),
    lids: [par.get('lidL'), par.get('lidR')],
    ears: [par.get('earL'), par.get('earR')],
    tailBase: par.get('tailBase'),
    parts: [geometry],          // un seul BufferGeometry a liberer
    material,
  };
}

/** Semelle de la patte, en coordonnees MONDE. getVertexPosition() applique bien
 *  la transform d'os, mais rend un point dans l'espace LOCAL du mesh : sans
 *  localToWorld, l'invariant 12 PASSE sans rien mesurer, ce qui est pire qu'un
 *  echec. L'appelant doit avoir mis les matrices monde a jour.
 *  Les indices sont pre-calcules une fois : les vertices dont l'os dominant est
 *  le paw de cette patte. */
function faireSole(mesh, geometry, legs, bones) {
  const si = geometry.attributes.skinIndex;
  const sw = geometry.attributes.skinWeight;
  const parPatte = new Map(legs.map((l) => [l.key, []]));
  const nomVersPatte = new Map(legs.map((l) => [l.paw.name, l.key]));
  const comp = ['X', 'Y', 'Z', 'W'];
  for (let v = 0; v < si.count; v++) {
    let best = -1, bi = 0;
    for (const c of comp) {
      const w = sw['get' + c](v);
      if (w > best) { best = w; bi = si['get' + c](v); }
    }
    const key = nomVersPatte.get(bones[bi].name);
    if (key) parPatte.get(key).push(v);
  }
  const tmp = new THREE.Vector3();
  return (leg) => {
    const out = new THREE.Vector3(0, Infinity, 0);
    for (const v of parPatte.get(leg.key)) {
      mesh.getVertexPosition(v, tmp);
      mesh.localToWorld(tmp);
      if (tmp.y < out.y) out.copy(tmp);
    }
    return out;
  };
}

/* ── Les hooks de reglage ─────────────────────────────────────── */

/** Le dos du chibi est a 0.650 * 1.35 = 0.878 au-dessus des pattes, contre
 *  1.336 pour le chien procedural. Avec SHIBA.swimFloat = 0.85 il ne sortirait
 *  de l'eau que de 0.028 : il nagerait submerge. 0.56 lui rend 36 % de dos hors
 *  de l'eau, exactement la proportion qu'a le chien procedural a 0.85.
 *  Le commentaire shiba.js:81-83 dit « At swimFloat 0.55 he looked as if he
 *  walked on water » : c'est vrai POUR LE CHIEN PROCEDURAL, qui a 0.55 sortait
 *  de 59 % de sa hauteur de dos. Le precedent ne s'applique pas ici. */
const SWIM_FLOAT = 0.56;

/** Le chibi a le tronc POSÉ PAR TERRE : garde au sol mesurée à 0.069 u de monde
 *  entre les deux trains, pour une ligne de dos à 0.930. Il marchait « assis ».
 *  On lui rallonge donc les pattes de LIFT, en montant `tilt` et en descendant
 *  le genou et le pied de la moitié chacun — les semelles ne bougent pas, seul
 *  le tronc se lève. C'est un ÉTIREMENT, pas une correction d'anatomie : le
 *  modèle n'a pas ces pattes-là.
 *
 *  Appliqué APRÈS le bind, délibérément. La pose de bind doit rester celle de
 *  la géométrie, sinon les os de patte flotteraient dans le ventre et les poids
 *  emporteraient le tronc avec les pattes. Le squelette capture l'anatomie ;
 *  l'étirement vient par-dessus.
 *
 *  Effet secondaire recherché : la chaîne passe de 0.161 à 0.241, donc le même
 *  angle de hanche déplace le pied 1.5 fois plus loin. */
const LIFT = 0.08;

/** Le pas ne se lisait pas : 0.075 u de course au pas, contre 0.208 pour le
 *  chien procédural. Un simple facteur ne suffit pas — au galop il déchire la
 *  peau (mesuré au chantier G, tâche 3 : propre jusqu'à 0.85 rad, déchiré
 *  au-delà). D'où une saturation douce plutôt qu'un facteur : GAIN_HANCHE
 *  multiplie les petits angles, et tanh les écrase vers LIM_HANCHE sans jamais
 *  la dépasser ni créer de plateau. Marche 0.30 -> 0.48 rad au lieu de 0.27 ;
 *  galop 0.95 -> 0.82 rad, sous le plafond sûr. */
const GAIN_HANCHE = 1.8, LIM_HANCHE = 0.85;
const GAIN_GENOU = 0.9, LIM_GENOU = 0.60;

/** La queue ne remuait pas : 0.10 rad au repos sur un macaron dont la masse est
 *  à 0.22 du pivot, soit 0.024 u de monde — invisible. Le plumet long et fin du
 *  chien procédural rendait le même angle lisible ; pas ce ballon-ci. */
const GAIN_QUEUE = 4.5, LIM_QUEUE = 0.75;

/** L'inverse pour la tête. `lookUp` lève le museau de 0.62 rad toutes les 6 à
 *  15 s — une intention (il regarde les pétales tomber), mais sur une tête
 *  énorme montée sur un cou court elle déplace le crâne de 0.36 u D'UN COUP, et
 *  ça lit comme un à-coup en arrière. On sature à 0.28 : les petits angles
 *  (trim de course, nage, assise) passent presque intacts, la pointe est
 *  écrêtée. Le à-coup vient aussi de l'attaque instantanée de lookUp, qui est
 *  dans animate() et vaut pour les deux corps — on ne peut qu'en réduire
 *  l'amplitude ici. */
const LIM_TETE = 0.28;

/** Le cou aussi, et c'est lui qu'on avait oublié : en s'asseyant, animate() lui
 *  demande -0.28 rad, qui S'AJOUTENT au bascule du crâne. D'où le « coup sec
 *  vers l'arrière avant de s'asseoir » — deux articulations qui partent
 *  ensemble sur une tête démesurée. */
const LIM_COU = 0.15;

const satur = (x, gain, lim) => lim * Math.tanh((x * gain) / lim);

/** Charge le shiba glTF, le normalise et lui fabrique un squelette au contrat
 *  de buildBody(). Rend null si l'asset est indisponible : le chien procedural
 *  de shiba-geom.js reprend alors la main, et l'echec doit rester silencieux
 *  pour l'utilisateur mais bruyant en console. */
export async function loadShibaBody({ url = URL_DEFAUT } = {}) {
  try {
    const { geometry, materiauxSource, ranges } = await chargerGeometrie(url);
    normaliser(geometry);
    const material = construireMateriau(materiauxSource);
    const { bones, par } = construireSquelette();
    calculerPoids(geometry, bones, ranges);
    const rig = assembler(geometry, material, bones, par);
    // L'étirement des pattes, APRÈS le bind (cf. LIFT). Les semelles restent où
    // elles sont : ce qu'on monte de tilt, on le redescend en deux fois sur le
    // genou et le pied.
    rig.tilt.position.y += LIFT;
    for (const l of rig.legs) {
      l.knee.position.y -= LIFT / 2;
      l.paw.position.y -= LIFT / 2;
    }
    rig.ranges = ranges;
    rig.sole = faireSole(rig.mesh, geometry, rig.legs, bones);
    rig.swimFloat = SWIM_FLOAT;

    // La chaine de patte du chibi fait 0.161 contre 0.522 : 3.2 fois plus
    // courte. Les amplitudes de GAITS ont ete reglees pour la seconde. On ouvre
    // la hanche pour que le pas se lise, on ferme le genou (os de 0.081, il se
    // replierait dans la cuisse), et l'assise est un cas a part : 1.95 rad de
    // genou est geometriquement impossible sur un moignon.
    // Saturation douce, pas un facteur (cf. GAIN_HANCHE / LIM_HANCHE) : le pas
    // doit se lire, et le galop ne doit pas déchirer la peau. L'assise reste un
    // cas à part — 1.95 rad de genou est géométriquement impossible sur un
    // moignon, on l'écrase franchement.
    rig.poseLeg = (leg, hip, knee, { sit = 0 } = {}) => {
      leg.hip.rotation.x = mix(satur(hip, GAIN_HANCHE, LIM_HANCHE), hip * 0.55, sit);
      leg.knee.rotation.x = mix(satur(knee, GAIN_GENOU, LIM_GENOU), knee * 0.18, sit);
    };
    // 1.6 sur le rebond : sur ce chien, le pas se lit par le corps. Mais
    // l'affaissement d'assise est ABSOLU, et -0.20 sur un ventre a 0.069 du sol
    // enterre le chien — d'ou un remplacement, et pas un facteur.
    rig.poseTail = (x, y, z) => {
      rig.tailBase.rotation.x = x;
      rig.tailBase.rotation.y = satur(y, GAIN_QUEUE, LIM_QUEUE);
      rig.tailBase.rotation.z = z;
    };
    // Le « coup sec » n'était pas une affaire d'amplitude mais d'ATTAQUE :
    // `lookUp` saute de 0 à 1 en une frame dans animate(), et le crâne partait
    // d'un bloc. Rapetisser le geste aurait tué l'intention (il regarde les
    // pétales tomber) sans supprimer la saccade. On lisse donc la montée sur
    // TAU_TETE, ce qui garde l'amplitude et supprime le claquement. La descente
    // était déjà douce (lookUp décroît en ~1.8 s).
    const TAU_TETE = 0.30;
    let lissTete = 0, lissCou = 0;
    rig.poseHead = (p) => {
      const k = p.dt > 0 ? 1 - Math.exp(-p.dt / TAU_TETE) : 1;
      lissTete += (satur(p.headPitch, 1, LIM_TETE) - lissTete) * k;
      lissCou += (satur(p.neckPitch, 1, LIM_COU) - lissCou) * k;
      rig.head.rotation.y = p.headYaw;
      rig.head.rotation.x = lissTete;
      rig.head.rotation.z = p.headRoll;
      rig.neck.rotation.x = lissCou;
      rig.neck.rotation.z = p.neckRoll;
    };
    rig.poseBody = (y, pitch, roll, { sit = 0 } = {}) => {
      rig.body.position.y = mix(y * 1.6, -0.045, sit);
      rig.body.rotation.x = mix(pitch, -0.12, sit);
      rig.body.rotation.z = roll;
    };
    return rig;
  } catch (err) {
    console.warn('[shiba-gltf] chargement impossible, repli procedural :', err);
    return null;
  }
}
