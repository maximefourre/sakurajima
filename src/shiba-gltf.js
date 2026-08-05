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

/** Charge le shiba glTF, le normalise et lui fabrique un squelette au contrat
 *  de buildBody(). Rend null si l'asset est indisponible : le chien procedural
 *  de shiba-geom.js reprend alors la main, et l'echec doit rester silencieux
 *  pour l'utilisateur mais bruyant en console. */
export async function loadShibaBody({ url = URL_DEFAUT } = {}) {
  try {
    const { geometry, materiauxSource, ranges } = await chargerGeometrie(url);
    normaliser(geometry);
    const material = construireMateriau(materiauxSource);
    return { geometry, material, ranges };   // rig complet en tache 3
  } catch (err) {
    console.warn('[shiba-gltf] chargement impossible, repli procedural :', err);
    return null;
  }
}
