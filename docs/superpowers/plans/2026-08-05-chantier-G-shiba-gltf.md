# Chantier G — le shiba glTF riggé à la main

> **Pour les agents :** ce plan s'exécute **une tâche à la fois**, par
> `codex-rescue` (Codex sol, effort high). Chaque tâche est un brief autonome.
> **Interdiction explicite de sous-traiter** : Codex laissé libre re-délègue et
> attend un sous-agent qui ne répond jamais (40 min perdues le 02/08, zéro octet
> écrit). Entre deux tâches : `git diff` relu par Claude, `node --check`,
> `test/invariants.html`, puis commit.
>
> Spec : [`../specs/2026-08-04-shiba-gltf-design.md`](../specs/2026-08-04-shiba-gltf-design.md).
> Elle contient tous les nombres et leur justification ; ce plan ne les répète
> que là où ils s'écrivent dans le code.

**But :** remplacer la géométrie du shiba par le modèle glTF du tutoriel
Codédex, en lui fabriquant un squelette de 22 os et des poids de skinning
calculés en code, pour rebrancher le cycle d'animation existant sans le réécrire.

**Architecture :** un nouveau module `src/shiba-gltf.js` rend un *rig* au contrat
de `buildBody()` (mêmes noms, même topologie, même ordre de pattes). `shiba.js`
gagne cinq hooks optionnels tous défaussés sur le comportement actuel, si bien
que le chien procédural reste la branche de repli, à l'octet près. `main.js`
`await` le chargement dans le bloc de boot du shiba.

**Pile :** Three.js 0.185.1 via importmap unpkg, `GLTFLoader` et
`BufferGeometryUtils` depuis `three/addons/`. Aucun build, aucun `npm install`,
aucune dépendance nouvelle.

## Contraintes globales

Elles s'appliquent à **toutes** les tâches, sans être répétées :

- **Aucun build, aucun bundler, aucun `npm install`.** Modules ES natifs, `three`
  et `three/addons/` résolus par l'importmap d'`index.html` et de
  `test/invariants.html`.
- **Serveur : `python3 serve.py 5173`**, jamais `python -m http.server` (il cache
  les modules ES). Depuis ce chantier, c'est une contrainte dure : il y a un
  `fetch`.
- **Déterminisme** : aucun `Math.random()`. Tout aléa passe par
  `streamFor(seed, 'nom')` de `noise.js`. Le rig glTF n'a besoin d'aucun aléa.
- **Commentaires en français** dans les fichiers neufs (convention des modules
  récents : `fireflies.js`, `butterflies.js`). En-tête JSDoc obligatoire, qui
  explique **pourquoi le fichier existe et ce qui n'est pas évident dedans**.
- **Constantes** : `UPPER_SNAKE` en tête de module pour les constantes
  structurelles. Rien de ce chantier ne va dans `config.js` — ce ne sont pas des
  constantes d'art direction, ce sont des ancrages mesurés sur un asset.
- **Commits conventionnels**, scope français, corps expliquant cause → correctif,
  et ligne finale de preuve `INVARIANTS: N pass, 0 fail`.
- **Pièges d'`AGENTS.md` en vigueur** : n°1 winding (un mesh invisible se
  diagnostique en forçant `DoubleSide` à chaud), n°2 `vertexColors` sans attribut
  `color` rend **noir**, n°9 protocole de mesure fps.
- **Le chien procédural doit continuer de tourner à l'identique.** C'est le repli.
  Toute tâche qui touche `shiba.js` ou `shiba-geom.js` se vérifie d'abord **sans**
  le glTF.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `tools/pack-shiba-glb.py` *(nouveau)* | One-shot hors runtime : glTF + bin + PNG → `.glb` autonome. Ne fait pas partie de la scène. |
| `assets/shiba/shiba.glb` *(nouveau)* | L'asset, un seul fichier. |
| `assets/shiba/LICENSE.txt` *(nouveau)* | Attribution CC-BY-4.0. |
| `src/shiba-gltf.js` *(nouveau)* | Charge, fusionne, normalise, rigge. Rend un rig ou `null`. Ne connaît ni le monde, ni le terrain, ni l'eau. |
| `src/shiba.js` | Accepte un rig préconstruit ; cinq hooks optionnels ; range le matériau dans le rig. |
| `src/shiba-geom.js` | Pose `rig.material` et ajoute `rig.sole(leg)`. Rien d'autre ne bouge. |
| `src/main.js` | `await loadShibaBody()` + repli. |
| `test/invariants.html` | Un `await` en tête du bloc chien ; invariant 12 joué deux fois ; 22 à 26 ajoutés. |

---

## Tâche 1 — Empaqueter l'asset

**Fichiers :**
- Créer : `tools/pack-shiba-glb.py`
- Créer : `assets/shiba/shiba.glb` (produit par le script)
- Créer : `assets/shiba/LICENSE.txt`

**Interfaces :**
- Produit : `assets/shiba/shiba.glb`, un glTF binaire autonome (texture et
  géométrie embarquées), chargeable par `GLTFLoader` avec `path = ''`.

- [ ] **Étape 1 — Récupérer les trois fichiers source et vérifier leur sha256**

```sh
mkdir -p /tmp/shiba-src/textures
BASE=https://raw.githubusercontent.com/INOCCENT-Dev/shiba/HEAD/shiba
curl -sL -o /tmp/shiba-src/scene.gltf $BASE/scene.gltf
curl -sL -o /tmp/shiba-src/scene.bin  $BASE/scene.bin
curl -sL -o /tmp/shiba-src/textures/default_baseColor.png $BASE/textures/default_baseColor.png
shasum -a 256 /tmp/shiba-src/scene.gltf /tmp/shiba-src/scene.bin \
              /tmp/shiba-src/textures/default_baseColor.png
```

Attendu, exactement :

```
958ebe1bfb278e4790cf1f3e9526ba38938f6f4c809cc15d91c215be688bf2e2  scene.gltf
810d0b2cad55b3c9f82d0388b8383b5875d8b7bc1a0179f743a296b06c0eada5  scene.bin
c6ab1ca4ead4ef999d0e416cf6a66f26db52bf9e75eef65ef536f97a835a676e  default_baseColor.png
```

**Si un hash diffère, arrêter le chantier et le signaler.** L'asset a changé, et
tous les ancrages mesurés de la spec sont caducs.

- [ ] **Étape 2 — Réduire la texture à 1024²**

```sh
sips -Z 1024 /tmp/shiba-src/textures/default_baseColor.png \
     --out /tmp/shiba-src/textures/base1024.png
```

Attendu : ~748 Ko. (`sips` est natif macOS ; sur une autre plateforme, tout
redimensionneur donnant un PNG 1024×1024 convient — le `.glb` est le livrable,
pas le PNG.)

- [ ] **Étape 3 — Écrire `tools/pack-shiba-glb.py`**

Script Python 3 sans dépendance. Il doit faire exactement ceci, dans cet ordre :

```python
#!/usr/bin/env python3
"""pack-shiba-glb.py — glTF + .bin + PNG -> .glb autonome.

One-shot hors runtime. Le depot ne versionne que le .glb produit ; ce script
existe pour que ce binaire soit REPRODUCTIBLE a partir des trois sha256
consignes dans la spec. Il ne touche ni aux materiaux ni aux noeuds :
KHR_materials_unlit et doubleSided doivent survivre intacts, le rig s'appuie
dessus (cf. spec, section « Le materiau »).
"""
import json, struct, sys

def pad(b, n, fill):           # aligne sur n octets
    r = (-len(b)) % n
    return b + fill * r

src_gltf, src_bin, src_png, out = sys.argv[1:5]
g = json.load(open(src_gltf))
bin_data = open(src_bin, 'rb').read()
png = open(src_png, 'rb').read()

# 1. le buffer unique = scene.bin aligne, puis le PNG
bin_aligned = pad(bin_data, 4, b'\0')
img_offset = len(bin_aligned)
buffer = bin_aligned + png

# 2. bufferView pour l'image, et l'image passe en reference interne
g['bufferViews'].append({'buffer': 0, 'byteOffset': img_offset,
                         'byteLength': len(png)})
g['images'][0] = {'bufferView': len(g['bufferViews']) - 1,
                  'mimeType': 'image/png'}

# 3. le buffer perd son uri
g['buffers'][0] = {'byteLength': len(buffer)}

# 4. serialisation GLB : entete 12 o, chunk JSON (espaces), chunk BIN (zeros)
js = pad(json.dumps(g, separators=(',', ':')).encode('utf-8'), 4, b' ')
bn = pad(buffer, 4, b'\0')
total = 12 + 8 + len(js) + 8 + len(bn)
with open(out, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))     # 'glTF', version 2
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)   # 'JSON'
    f.write(struct.pack('<II', len(bn), 0x004E4942)); f.write(bn)   # 'BIN\0'
print(out, total, 'octets')
```

- [ ] **Étape 4 — Produire le `.glb` et vérifier qu'il se relit**

```sh
mkdir -p assets/shiba
python3 tools/pack-shiba-glb.py /tmp/shiba-src/scene.gltf /tmp/shiba-src/scene.bin \
        /tmp/shiba-src/textures/base1024.png assets/shiba/shiba.glb
python3 - <<'EOF'
import struct, json
d = open('assets/shiba/shiba.glb','rb').read()
magic, ver, total = struct.unpack_from('<III', d, 0)
assert magic == 0x46546C67 and ver == 2 and total == len(d), 'entete GLB invalide'
jlen, jtype = struct.unpack_from('<II', d, 12)
assert jtype == 0x4E4F534A, 'chunk JSON absent'
g = json.loads(d[20:20+jlen])
assert 'uri' not in g['buffers'][0], 'buffer encore externe'
assert 'bufferView' in g['images'][0], 'image encore externe'
assert g['extensionsUsed'] == ['KHR_materials_unlit'], 'extension perdue'
assert g['materials'][0].get('doubleSided') is True, 'doubleSided perdu'
assert len(g['meshes']) == 3, 'meshes perdus'
print('GLB valide,', len(d), 'octets')
EOF
```

Attendu : `GLB valide, ~890000 octets`. Les quatre `assert` sont le test : ils
échouent bruyamment si le packer casse ce dont le rig dépend.

- [ ] **Étape 5 — Écrire `assets/shiba/LICENSE.txt`**

```
Modele 3D « Shiba »
Auteur   : zixisun02 — https://sketchfab.com/zixisun51
Source   : https://sketchfab.com/3d-models/shiba-faef9fe5ace445e7b2989d1c1ece361c
Licence  : CC-BY-4.0 — http://creativecommons.org/licenses/by/4.0/
Recupere : 2026-08-03

Modifications apportees par ce projet :
  - texture baseColor reduite de 2048x2048 a 1024x1024 ;
  - glTF + .bin + PNG empaquetes en un .glb autonome (tools/pack-shiba-glb.py) ;
  - a l'execution : mise a l'echelle x0.823, recentrage sur le milieu des
    appuis, et ajout d'un squelette de 22 os avec poids de skinning calcules
    (src/shiba-gltf.js). La geometrie d'origine n'est pas modifiee.

sha256 des fichiers d'origine :
  958ebe1bfb278e4790cf1f3e9526ba38938f6f4c809cc15d91c215be688bf2e2  scene.gltf
  810d0b2cad55b3c9f82d0388b8383b5875d8b7bc1a0179f743a296b06c0eada5  scene.bin
  c6ab1ca4ead4ef999d0e416cf6a66f26db52bf9e75eef65ef536f97a835a676e  textures/default_baseColor.png
```

- [ ] **Étape 6 — Ajouter la ligne de crédit dans `index.html`**

Dans le `<div class="hint">` du `#panel`, après la dernière ligne de touches,
ajouter une ligne discrète :

```html
<div class="credit">Shiba 3D : zixisun02 — CC-BY 4.0</div>
```

- [ ] **Étape 7 — Commit**

```sh
git add tools/pack-shiba-glb.py assets/shiba/shiba.glb assets/shiba/LICENSE.txt index.html
git commit -m "feat(shiba): l'asset glTF, empaquete en un .glb autonome

Premier binaire versionne du depot. « Shiba » de zixisun02, CC-BY-4.0, texture
reduite a 1024 et embarquee ; le packer est un one-shot hors runtime pour que
le binaire reste reproductible depuis les trois sha256 d'origine.

KHR_materials_unlit et doubleSided survivent a l'empaquetage : le rig s'appuie
dessus (le loader rend un MeshBasicMaterial, cf. spec)."
```

---

## Tâche 2 — `shiba-gltf.js` : charger, fusionner, normaliser

Cette tâche s'arrête **avant** le squelette. Le livrable est une géométrie
fusionnée, à la bonne échelle, au bon centre, et son matériau — vérifiables
numériquement.

**Fichiers :**
- Créer : `src/shiba-gltf.js`

**Interfaces :**
- Consomme : `assets/shiba/shiba.glb` (tâche 1).
- Produit, exporté pour la tâche 3 et pour les invariants :
  - `loadShibaBody({ url })` → `Promise<rig|null>` — rendra le rig complet en
    tâche 3 ; à ce stade il rend `{ geometry, material, ranges }`.
  - `NORM` — les constantes de normalisation : `{ K: 0.823, DZ: 0.300 }`.
  - `ranges` = `{ collar: [start, end), eyes: [start, end) }`, intervalles de
    vertices dans la géométrie fusionnée.

- [ ] **Étape 1 — Squelette du module et en-tête**

```js
/** shiba-gltf.js — le chien du tutoriel Codedex, riggé à la main.
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
 *  3. Les os des paupieres et des oreilles sont bindes dans une pose NON NULLE,
 *     parce que animate() leur ecrit une valeur non nulle au repos. Bindes a
 *     l'identite, ils donneraient une deformation permanente.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Echelle et recentrage, mesures : k par la longueur hors-tout (1.461 / 1.775),
 *  DZ pour amener le milieu des appuis EN CONTACT sur l'origine. Ne pas deriver
 *  DZ d'une tranche epaisse : le milieu bouge de 0.02 a 0.06 selon le seuil,
 *  soit jusqu'a trois fois la tolerance de l'invariant 23. */
export const NORM = Object.freeze({ K: 0.823, DZ: 0.300 });

const URL_DEFAUT = 'assets/shiba/shiba.glb';
```

- [ ] **Étape 2 — Charger et fusionner**

```js
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

  const geos = [corps, collier, yeux].map((o) => {
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
  for (const g of geos) g.dispose();

  return {
    geometry,
    materialSource: corps.material,
    ranges: {
      corps: [0, nCorps],
      collar: [nCorps, nCorps + nCollier],
      eyes: [nCorps + nCollier, nCorps + nCollier + nYeux],
    },
  };
}
```

- [ ] **Étape 3 — Normaliser**

```js
/** Semelles a y = 0, milieu des appuis EN CONTACT a z = 0, echelle K. */
function normaliser(geometry) {
  const pos = geometry.attributes.position;
  let yMin = Infinity;
  for (let i = 0; i < pos.count; i++) yMin = Math.min(yMin, pos.getY(i));

  // Appuis = vertices en contact, a moins de 0.02 au-dessus de la semelle.
  // Le partage avant/arriere se fait a z = -0.40, entre les deux trains.
  let zAv = 0, nAv = 0, zAr = 0, nAr = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) - yMin >= 0.02) continue;
    const z = pos.getZ(i);
    if (z > -0.40) { zAv += z; nAv++; } else { zAr += z; nAr++; }
  }
  if (!nAv || !nAr) throw new Error('[shiba-gltf] appuis introuvables');
  const milieu = (zAv / nAv + zAr / nAr) / 2;

  const m = new THREE.Matrix4()
    .makeScale(NORM.K, NORM.K, NORM.K)
    .premultiply(new THREE.Matrix4().makeTranslation(0, -yMin * NORM.K, -milieu * NORM.K));
  geometry.applyMatrix4(m);
  geometry.computeBoundingBox();
}
```

- [ ] **Étape 4 — Construire le matériau**

```js
/** L'asset est unlit : le loader rend un MeshBasicMaterial, sans roughness ni
 *  metalness, qui ne recoit NI lumiere NI ombre. On reconstruit un Standard en
 *  reprenant sa texture (dont le colorSpace srgb est deja pose par le loader).
 *  vertexColors: false est EXPLICITE : le materiau procedural vaut true, et
 *  herite sans attribut `color` rendrait le chien noir (piege n°2). */
function construireMateriau(src) {
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
  src.dispose();   // le MeshBasicMaterial abandonne ; sa map est PARTAGEE
  return material;
}
```

- [ ] **Étape 5 — L'export public, version tâche 2**

```js
export async function loadShibaBody({ url = URL_DEFAUT } = {}) {
  try {
    const { geometry, materialSource, ranges } = await chargerGeometrie(url);
    normaliser(geometry);
    const material = construireMateriau(materialSource);
    return { geometry, material, ranges };     // rig complet en tache 3
  } catch (err) {
    console.warn('[shiba-gltf] chargement impossible, repli procedural :', err);
    return null;
  }
}
```

- [ ] **Étape 6 — Vérifier la syntaxe**

```sh
node --check src/shiba-gltf.js
```

Attendu : aucune sortie.

- [ ] **Étape 7 — Vérifier les nombres dans le navigateur**

Servir (`python3 serve.py 5173`) puis, dans la console de
`http://127.0.0.1:5173/index.html` :

```js
const { loadShibaBody } = await import('/src/shiba-gltf.js');
const r = await loadShibaBody({ url: '/assets/shiba/shiba.glb' });
const b = r.geometry.boundingBox;
console.log('vertices', r.geometry.attributes.position.count);   // 2547
console.log('ranges', r.ranges);         // corps 2145, collar 272, eyes 130
console.log('bbox min', b.min.toArray().map(v => v.toFixed(3)).join(' '));
console.log('bbox max', b.max.toArray().map(v => v.toFixed(3)).join(' '));
console.log('materiau', r.material.type, 'map', !!r.material.map);
```

Attendu, à ±0.005 :

| grandeur | valeur |
|---|---|
| `vertices` | `2547` |
| `ranges` | `corps [0,2145]`, `collar [2145,2417]`, `eyes [2417,2547]` |
| `bbox.min.y` | `0.000` — les semelles sont sur le plan zéro |
| `bbox.max.y` | `1.137` |
| `bbox.min.x` / `max.x` | `−0.379` / `+0.379` (largeur 0.757) |
| `bbox.min.z` / `max.z` | `−0.861` / `+0.600` (longueur 1.461) |
| `materiau` | `MeshStandardMaterial`, `map true` |

**Si `bbox.max.z − bbox.min.z` ne vaut pas 1.461, `K` est faux. Si `min.y` n'est
pas 0, la normalisation est faussée par l'ordre scale/translation.**

- [ ] **Étape 8 — Commit**

```sh
git add src/shiba-gltf.js
git commit -m "feat(shiba): chargement, fusion et normalisation du glTF

Trois meshes (corps 2145, collier 272, yeux 130) fusionnes en une geometrie de
2547 vertices, matrices de noeuds appliquees AVANT toute mesure — le glTF est
en Z-up et les positions brutes decrivent un chien couche sur le dos.

Normalisation mesuree, pas authoree : semelles a y=0, milieu des appuis EN
CONTACT (y < 0.02) a z=0, echelle 0.823 par la longueur hors-tout.

Le materiau charge est un MeshBasicMaterial (KHR_materials_unlit) : on
reconstruit un Standard, sinon le chien ne recoit ni lumiere ni ombre."
```

---

## Tâche 3 — Le squelette et les poids

**Fichiers :**
- Modifier : `src/shiba-gltf.js`

**Interfaces :**
- Consomme : `{ geometry, material, ranges }` (tâche 2), `NORM`.
- Produit : `loadShibaBody()` rend désormais le rig complet :

```js
{
  root,                 // THREE.Group — possede par shiba.js (position/quaternion/scale)
  tilt, body, neck, head, jaw,   // THREE.Bone
  lids: [lidL, lidR],            // THREE.Bone, [x<0, x>0]
  ears: [earL, earR],            // idem
  tailBase,                      // THREE.Bone
  legs: [ { key, front, hip, knee, paw }, ... ],   // FL, FR, BL, BR
  parts: [geometry],             // iterable d'objets a .dispose()
  material,                      // le rig POSSEDE son materiau
  mesh,                          // THREE.SkinnedMesh, nomme 'shiba-body'
  skeleton,                      // THREE.Skeleton
  sole(leg),                     // -> THREE.Vector3 en coordonnees MONDE
  swimFloat: 0.56,
  poseLeg(leg, hip, knee, w),
  poseBody(y, pitch, roll, w),
}
```

- [ ] **Étape 1 — La table des os**

Ancrages mesurés, en unités de construction, positions **locales** au parent :

```js
/** Ancrages MESURES sur la geometrie normalisee (cf. spec, « Reperes finaux »).
 *  L'ORDRE de ce tableau definit la semantique de skinIndex : ne jamais le
 *  reordonner sans reconstruire les poids. */
const OS = [
  // nom,        parent,      position locale,              pose de bind
  ['tilt',       null,        [0, 0.360, 0],                null],
  ['body',       'tilt',      [0, 0, 0],                    null],
  ['neck',       'body',      [0, +0.223, +0.124],          null],
  ['head',       'neck',      [0, +0.117, +0.096],          null],
  ['jaw',        'head',      [0, -0.140, +0.210],          null],
  ['lidL',       'head',      [-0.097, +0.171, +0.219],     { x: -0.32 }],
  ['lidR',       'head',      [+0.097, +0.171, +0.219],     { x: -0.32 }],
  ['earL',       'head',      [-0.165, +0.337, -0.043],     { x: -0.30, z: -0.20 }],
  ['earR',       'head',      [+0.165, +0.337, -0.043],     { x: -0.30, z: +0.20 }],
  ['tailBase',   'body',      [0, +0.093, -0.507],          null],
  ['hipFL',      'body',      [-0.184, -0.179, +0.193],     null],
  ['kneeFL',     'hipFL',     [0, -0.081, 0],               null],
  ['pawFL',      'kneeFL',    [0, -0.080, +0.010],          null],
  ['hipFR',      'body',      [+0.184, -0.179, +0.193],     null],
  ['kneeFR',     'hipFR',     [0, -0.081, 0],               null],
  ['pawFR',      'kneeFR',    [0, -0.080, +0.010],          null],
  ['hipBL',      'body',      [-0.243, -0.179, -0.193],     null],
  ['kneeBL',     'hipBL',     [0, -0.081, 0],               null],
  ['pawBL',      'kneeBL',    [0, -0.080, +0.010],          null],
  ['hipBR',      'body',      [+0.243, -0.179, -0.193],     null],
  ['kneeBR',     'hipBR',     [0, -0.081, 0],               null],
  ['pawBR',      'kneeBR',    [0, -0.080, +0.010],          null],
];
```

**La colonne « pose de bind » n'est pas décorative.** `animate()` écrit sur les
paupières `mix(-0.32, 0.58, blink)` — donc **−0.32 au repos** — et sur les
oreilles `landEarX = -0.30 + 0.34·speedN + flick`, `landEarZ = side·(0.20 +
0.10·gust)` — donc **`x = −0.30`, `z = side·0.20` au repos**. Un os bindé à
l'identité transformerait ces valeurs de repos en déformation permanente. Ne
**pas** recopier la pose d'auteur de `shiba-geom.js:568-573` : elle est écrasée
en vol par `animate()` et n'a jamais été la pose de repos réelle.

- [ ] **Étape 2 — Construire la hiérarchie d'os**

```js
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
```

- [ ] **Étape 3 — Les portes**

```js
const ss = (a, b, x) => {                    // smoothstep, tolere a > b
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Une porte par os. Sans elles, une patte gauche aspire la droite (0.37 u
 *  d'ecart pour un os de 0.16), et les os les plus animes capturent le crane.
 *  Ce sont des smoothstep et pas des coupures : une coupure franche laisse une
 *  couture visible sur un mesh lisse. */
function porte(nom, x, y, z) {
  if (nom === 'jaw' || nom === 'lidL' || nom === 'lidR') return 0;  // aucun vertex
  if (nom === 'body') return 1;                                     // receptacle
  if (nom === 'head') return ss(0.00, 0.18, z);
  if (nom === 'neck') return ss(-0.15, 0.05, z) * ss(0.36, 0.16, z) * ss(0.22, 0.40, y);
  if (nom === 'tailBase') return ss(-0.30, -0.50, z);
  if (nom === 'earL') return ss(0, -0.06, x) * ss(0.90, 1.05, y);
  if (nom === 'earR') return ss(0, +0.06, x) * ss(0.90, 1.05, y);
  const m = /^(hip|knee|paw)([FB])([LR])$/.exec(nom);
  if (m) {
    const zHanche = m[2] === 'F' ? +0.193 : -0.193;
    const lat = m[3] === 'L' ? ss(0, -0.10, x) : ss(0, +0.10, x);
    return lat * ss(0.42, 0.26, Math.abs(z - zHanche)) * ss(0.34, 0.20, y);
  }
  return 0;
}
```

Le terme vertical de la porte du cou n'est pas ornemental : les appuis avant sont
à `z = +0.193`, en plein dans sa bande longitudinale. Sans lui, le cou tirerait
les pattes avant.

- [ ] **Étape 4 — Les poids**

```js
const EPS = 0.023;         // 2 % de la hauteur du chien
const P = 4;               // exposant du falloff
/** body n'a pas de segment (il est a (0,0,0) dans tilt, et un point attire de
 *  facon isotrope) : il prend pour proxy l'axe cou -> queue. */
const RACHIS = [new THREE.Vector3(0, 0.583, +0.124), new THREE.Vector3(0, 0.453, -0.507)];

function distanceAuSegment(p, a, b, tmp) {
  tmp.subVectors(b, a);
  const l2 = tmp.lengthSq();
  const t = l2 > 1e-12
    ? Math.min(1, Math.max(0, (p.clone().sub(a).dot(tmp)) / l2))
    : 0;
  return p.distanceTo(tmp.copy(a).addScaledVector(b.clone().sub(a), t));
}

function calculerPoids(geometry, bones, par, ranges) {
  const pos = geometry.attributes.position;
  const n = pos.count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  // Segments monde de chaque os, dans la pose de bind.
  const seg = bones.map((b) => {
    const fin = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    if (b.name === 'tilt') return null;                      // structurel
    if (b.name === 'body') return [RACHIS[0], RACHIS[1]];
    const debut = new THREE.Vector3().setFromMatrixPosition(b.parent.matrixWorld);
    return [debut, fin];
  });
  const idxLidL = bones.findIndex((b) => b.name === 'lidL');
  const idxLidR = bones.findIndex((b) => b.name === 'lidR');
  const idxNeck = bones.findIndex((b) => b.name === 'neck');

  const p = new THREE.Vector3(), tmp = new THREE.Vector3();
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
      const d = distanceAuSegment(p, seg[b][0], seg[b][1], tmp);
      cand.push([g / Math.pow(d + EPS, P), b]);
    }
    // Les 4 plus gros ; a egalite le plus petit indice d'os gagne, pour que le
    // resultat soit deterministe.
    cand.sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));
    let somme = 0;
    for (let k = 0; k < 4 && k < cand.length; k++) somme += cand[k][0];
    for (let k = 0; k < 4 && k < cand.length; k++) {
      si[v * 4 + k] = cand[k][1];
      sw[v * 4 + k] = cand[k][0] / somme;
    }
    // Les influences inutilisees restent (indice 0, poids 0) : JAMAIS un indice
    // invalide « puisque le poids est nul ». Les 4 termes sont toujours evalues
    // par le shader, et 0.0 * NaN = NaN detruit le vertex.
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}
```

`Uint16BufferAttribute` **sans** `normalized: true` : avec, tous les indices sont
divisés par 65535, deviennent ≈ 0, et **le chien entier se colle à l'os 0**, sans
la moindre erreur.

- [ ] **Étape 5 — Assembler le rig**

```js
function assembler(geometry, material, bones, par) {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'shiba-body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // La bounding sphere d'un SkinnedMesh est calculee UNE fois et jamais
  // invalidee : elle refletterait la pose de la premiere frame, et le chien
  // (ou seulement son ombre) clignoterait des qu'il s'anime hors d'elle.
  mesh.frustumCulled = false;
  mesh.normalizeSkinWeights();

  const skeleton = new THREE.Skeleton(bones);
  // bindMatrix identite EXPLICITE : sans second argument, bind() appelle
  // calculateInverses() et ECRASE les inverses qu'on vient de calculer.
  mesh.bind(skeleton, new THREE.Matrix4());

  const root = new THREE.Group();
  root.name = 'shiba';
  // Le mesh ET la racine d'os sous le MEME parent : en AttachedBindMode,
  // mesh.position/rotation/scale n'a AUCUN effet visuel. C'est root que
  // shiba.js deplace, et c'est le seul montage qui marche.
  root.add(mesh);
  root.add(par.get('tilt'));

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
    parts: [geometry],       // un seul BufferGeometry a liberer
    material,
  };
}
```

`assembler` prend donc `(geometry, material, bones, par)` et rend l'objet
ci-dessus ; `loadShibaBody` y attache ensuite `sole`, `poseLeg`, `poseBody` et
`swimFloat` (étape 6) avant de le rendre.

L'ordre `FL, FR, BL, BR` est obligatoire : `GAITS.trot.ph = [0, π, π, 0]` apparie
`legs[0]↔legs[3]` et `legs[1]↔legs[2]`, ce sont les diagonales.

- [ ] **Étape 6 — `sole()`, les hooks et l'export final**

```js
/** Semelle de la patte, en coordonnees MONDE. getVertexPosition() applique bien
 *  la transform d'os, mais rend un point dans l'espace LOCAL du mesh : sans
 *  localToWorld, l'invariant 12 PASSE sans rien mesurer, ce qui est pire qu'un
 *  echec. Les indices sont pre-calcules une fois : les vertices dont l'os
 *  dominant est le paw de cette patte. */
function faireSole(mesh, geometry, legs, bones) {
  const si = geometry.attributes.skinIndex, sw = geometry.attributes.skinWeight;
  const parPatte = new Map(legs.map((l) => [l.key, []]));
  const nomVersPatte = new Map(legs.map((l) => [l.paw.name, l.key]));
  for (let v = 0; v < si.count; v++) {
    let best = 0, bi = si.getX(v);
    for (const c of ['X', 'Y', 'Z', 'W']) {
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
```

Les trois hooks de réglage, avec leurs valeurs de départ **mesurées** (elles se
valident à l'écran en tâche 7) :

```js
const mix = (a, b, t) => a + (b - a) * t;

// La chaine de patte du chibi fait 0.161 contre 0.522 : 3.2 fois plus courte.
// Les amplitudes de GAITS ont ete reglees pour la seconde. On ouvre la hanche
// pour que le pas se lise, on ferme le genou (os de 0.081, il se replierait
// dans la cuisse), et l'assise est un cas a part : 1.95 rad de genou est
// geometriquement impossible sur un moignon.
rig.poseLeg = (leg, hip, knee, { sit }) => {
  leg.hip.rotation.x = hip * mix(1.30, 0.55, sit);
  leg.knee.rotation.x = knee * mix(0.40, 0.18, sit);
};
// 1.6 sur le rebond : sur ce chien, le pas se lit par le corps. Mais
// l'affaissement d'assise est ABSOLU, et -0.20 sur un ventre a 0.069 du sol
// enterre le chien — d'ou le remplacement, et pas un facteur.
rig.poseBody = (y, pitch, roll, { sit }) => {
  rig.body.position.y = mix(y * 1.6, -0.045, sit);
  rig.body.rotation.x = mix(pitch, -0.12, sit);
  rig.body.rotation.z = roll;
};
// Le dos du chibi est a 0.878 au-dessus des pattes contre 1.336 pour le chien
// procedural. Avec SHIBA.swimFloat = 0.85 il ne sortirait de l'eau que de
// 0.028 : il nagerait submerge. 0.56 lui rend les 36 % de dos hors de l'eau.
rig.swimFloat = 0.56;
```

- [ ] **Étape 7 — Vérifier**

```sh
node --check src/shiba-gltf.js
```

Puis, dans la console du navigateur :

```js
const { loadShibaBody } = await import('/src/shiba-gltf.js');
const rig = await loadShibaBody({ url: '/assets/shiba/shiba.glb' });
console.log('os', rig.skeleton.bones.length, rig.skeleton.bones.map(b => b.name).join(','));
console.log('pattes', rig.legs.map(l => l.key + (l.front ? 'av' : 'ar')).join(' '));
const sw = rig.mesh.geometry.attributes.skinWeight;
let pire = 0;
for (let v = 0; v < sw.count; v++) {
  const s = sw.getX(v) + sw.getY(v) + sw.getZ(v) + sw.getW(v);
  pire = Math.max(pire, Math.abs(s - 1));
}
console.log('ecart max a somme 1 :', pire.toExponential(2));
```

Attendu : `os 22 tilt,body,neck,head,jaw,lidL,…` ; `pattes FLav FRav BLar BRar` ;
écart max `< 1e-4`.

- [ ] **Étape 8 — Commit**

```sh
git add src/shiba-gltf.js
git commit -m "feat(shiba): squelette de 22 os et poids de skinning calcules

Poids par distance au segment d'os (p=4, eps=0.023), une porte smoothstep par
os. Deux affectations dures : le collier suit le cou en rigide, les billes
d'yeux suivent leur paupiere.

jaw et lids ont une porte NULLE : la gueule est peinte dans la texture, et une
paupiere qui bascule de 0.90 rad plusieurs fois par 10 s ne doit pas se disputer
le sommet du crane.

Les os des paupieres et des oreilles sont bindes dans leur pose de REPOS
(-0.32 ; -0.30 et side*0.20), parce que animate() leur ecrit ces valeurs au
repos : bindes a l'identite, elles deviendraient une deformation permanente."
```

---

## Tâche 4 — Les invariants du rig (22 à 26)

Cette tâche vérifie les tâches 2 et 3 **avant** que quoi que ce soit ne soit
branché. C'est délibéré : la leçon du 01/08 est que quatre défauts majeurs sont
passés avec « 19 pass, 0 fail » parce que les invariants testaient des fonctions
pures au lieu d'instancier le vrai système.

**Fichiers :**
- Modifier : `test/invariants.html`

**Interfaces :**
- Consomme : `loadShibaBody()` (tâche 3).

- [ ] **Étape 1 — Charger l'asset en tête du bloc chien**

Le harnais est 100 % synchrone aujourd'hui. Le module est un module ES : le
top-level `await` est disponible et c'est le seul montage correct — un `check`
fait dans un `.then` s'ajouterait **après** la ligne `INVARIANTS: …` sans être
compté, et un rejet ne serait vu que par le `unhandledrejection` de la l.34,
**qui n'incrémente pas `fail`**.

Juste avant l'invariant 11, insérer :

```js
import { loadShibaBody } from '../src/shiba-gltf.js';

let gltfRig = null, gltfCause = '';
try {
  gltfRig = await loadShibaBody({ url: '../assets/shiba/shiba.glb' });
  if (!gltfRig) gltfCause = 'loadShibaBody a rendu null (voir le warn ci-dessus)';
} catch (e) {
  gltfCause = String(e);
}
check('asset glTF charge', gltfRig !== null, gltfCause);
```

L'URL est **relative à `test/`** : `'../assets/shiba/shiba.glb'`. Un asset absent
doit **échouer**, pas être sauté — sinon la page imprime `21 pass, 0 fail` en
vert alors que rien du chantier n'a été testé.

- [ ] **Étape 2 — Écrire les invariants 22 à 26**

Chacun commence par `if (!gltfRig) { check(nom, false, gltfCause); }` pour que le
compte reste fixe à 26 quoi qu'il arrive.

```js
/* ── 22. le rig glTF expose le contrat complet ── */
{
  const r = gltfRig;
  const ok = !!r && ['root','tilt','body','neck','head','jaw','tailBase','material']
      .every((k) => r[k])
    && r.lids?.length === 2 && r.ears?.length === 2 && r.legs?.length === 4
    && r.legs.every((l) => l.hip && l.knee && l.paw && typeof l.front === 'boolean')
    && typeof r.sole === 'function'
    && r.legs[0].front && r.legs[1].front && !r.legs[2].front && !r.legs[3].front
    && Math.sign(r.legs[0].hip.position.x) === -Math.sign(r.legs[1].hip.position.x);
  check('rig glTF : contrat complet, pattes FL FR BL BR', ok,
        r ? r.legs.map((l) => l.key).join(' ') : gltfCause);
}
```

L'ordre des pattes est testé parce qu'il **porte du sens** : `GAITS.trot.ph =
[0, π, π, 0]` apparie `legs[0]↔legs[3]`, ce sont les diagonales. Un ordre
`FL, BL, FR, BR` ferait trotter le chien à l'amble, sans aucune erreur.

```js
/* ── 23. echelle et pose ──
 * ATTENTION AUX UNITES : sole() et getWorldPosition() rendent du MONDE, soit
 * 1.35 x les unites de construction (root.scale). */
{
  const r = gltfRig;
  let ok = false, detail = gltfCause;
  if (r) {
    r.root.updateMatrixWorld(true);
    const zAv = (r.sole(r.legs[0]).z + r.sole(r.legs[1]).z) / 2;
    const zAr = (r.sole(r.legs[2]).z + r.sole(r.legs[3]).z) / 2;
    const milieu = (zAv + zAr) / 2;
    const zTete = r.head.getWorldPosition(new THREE.Vector3()).z;
    const zQueue = r.tailBase.getWorldPosition(new THREE.Vector3()).z;
    // Dos = le plus haut vertex domine par l'os body.
    const dos = hauteurDosGltf(r);
    ok = Math.abs(milieu) <= 0.03 && zTete > zQueue
      && dos * 1.35 > r.swimFloat + 0.03;
    detail = `milieu ${milieu.toFixed(3)}, dos ${(dos * 1.35).toFixed(3)} > swimFloat ${r.swimFloat}`;
  }
  check('rig glTF : appuis centres, +Z, dos hors de l\'eau', ok, detail);
}
```

Deux fonctions locales au harnais, à écrire une fois et à réutiliser par les
invariants 23 et 25 :

```js
/** L'os dominant d'un vertex : celui de ses 4 influences qui a le plus de poids. */
function osDominant(r, v) {
  const si = r.mesh.geometry.attributes.skinIndex;
  const sw = r.mesh.geometry.attributes.skinWeight;
  let best = -1, bi = 0;
  for (const c of ['X', 'Y', 'Z', 'W']) {
    const w = sw['get' + c](v);
    if (w > best) { best = w; bi = si['get' + c](v); }
  }
  return r.skeleton.bones[bi].name;
}

/** nom d'os -> nombre de vertices qu'il domine. */
function compterDominance(r) {
  const m = new Map(r.skeleton.bones.map((b) => [b.name, 0]));
  const n = r.mesh.geometry.attributes.position.count;
  for (let v = 0; v < n; v++) {
    const nom = osDominant(r, v);
    m.set(nom, m.get(nom) + 1);
  }
  return m;
}

/** Hauteur du dos VISIBLE, en unites de construction : le plus haut vertex
 *  domine par l'os body. L'invariant 11, lui, prend SHIBA_BUILD.standHeight —
 *  qui est la somme de la chaine de patte, donc la LIGNE MEDIANE et non le dos.
 *  Le commentaire de shiba.js:81-82 fait d'ailleurs la meme confusion. Sur le
 *  chien procedural l'ecart est sans consequence ; sur le chibi il vaut 0.29 u,
 *  et c'est la difference entre un chien qui nage et un chien qui coule. */
function hauteurDosGltf(r) {
  const pos = r.mesh.geometry.attributes.position;
  let h = -Infinity;
  for (let v = 0; v < pos.count; v++) {
    if (osDominant(r, v) === 'body') h = Math.max(h, pos.getY(v));
  }
  return h;
}
```

```js
/* ── 24. poids bien formes ── */
{
  const r = gltfRig; let ok = false, detail = gltfCause;
  if (r) {
    const si = r.mesh.geometry.attributes.skinIndex;
    const sw = r.mesh.geometry.attributes.skinWeight;
    const n = r.skeleton.bones.length;
    let pireSomme = 0, mauvaisIdx = 0, negatif = 0, idxNonNul = 0;
    for (let v = 0; v < si.count; v++) {
      let s = 0;
      for (const c of ['X','Y','Z','W']) {
        const w = sw['get'+c](v), i = si['get'+c](v);
        s += w;
        if (w < 0) negatif++;
        if (i < 0 || i >= n) mauvaisIdx++;
        if (w === 0 && i !== 0) idxNonNul++;
      }
      pireSomme = Math.max(pireSomme, Math.abs(s - 1));
    }
    ok = pireSomme < 1e-4 && !mauvaisIdx && !negatif && !idxNonNul;
    detail = `ecart ${pireSomme.toExponential(2)}, idx hors bornes ${mauvaisIdx}, negatifs ${negatif}, idx parasites ${idxNonNul}`;
  }
  check('rig glTF : poids bien formes', ok, detail);
}

/* ── 25. rig non degenere ── */
{
  const r = gltfRig; let ok = false, detail = gltfCause;
  if (r) {
    const dom = compterDominance(r);           // Map nom -> nb de vertices
    const pattes = r.skeleton.bones.filter((b) => /^(hip|knee|paw)/.test(b.name));
    ok = pattes.every((b) => (dom.get(b.name) || 0) >= 20)
      && ['head','neck','tailBase','lidL','lidR'].every((k) => (dom.get(k) || 0) >= 10)
      && (dom.get('jaw') || 0) === 0;
    detail = [...dom].map(([k, v]) => `${k}:${v}`).join(' ');
  }
  check('rig glTF : chaque os porte de la matiere, jaw aucune', ok, detail);
}
```

`jaw` à **exactement 0** est la version testable de « aucun vertex sous son
influence ». Un os sans matière est un os qui anime du vide, et ça ne se voit pas
à l'œil sur une pose neutre.

```js
/* ── 26. non-explosion et lateralite ── */
const POSES = [
  ['repos',            { hip: 0,     knee: 0,     sit: 0,   shake: 0 }],
  ['marche phase 0',   { hip: 0.30,  knee: -0.36, sit: 0,   shake: 0 }],
  ['trot phase 0',     { hip: 0.62,  knee: -0.84, sit: 0,   shake: 0 }],
  ['galop phase 0',    { hip: 0.95,  knee: -1.47, sit: 0,   shake: 0 }],
  ['marche phase pi',  { hip: -0.30, knee: -0.36, sit: 0,   shake: 0 }],
  ['trot phase pi',    { hip: -0.62, knee: -0.84, sit: 0,   shake: 0 }],
  ['galop phase pi',   { hip: -0.95, knee: -1.47, sit: 0,   shake: 0 }],
  ['nage amplitude',   { hip: 1.34,  knee: -1.20, sit: 0,   shake: 0 }],
  ['assise pleine',    { hip: -0.85, knee: 1.95,  sit: 1,   shake: 0 }],
  ['secouage mi',      { hip: 0,     knee: 0,     sit: 0,   shake: 0.5, roll: 0.42 }],
  ['galop + tete',     { hip: -0.95, knee: -1.47, sit: 0,   shake: 0, head: 0.7, tail: 0.9 }],
  ['assise + clin',    { hip: -0.85, knee: 1.95,  sit: 1,   shake: 0, blink: 1, ear: 0.46 }],
];
```

Les poses sont posées **directement sur les os**, via `rig.poseLeg` /
`rig.poseBody` et des écritures de rotation — `animate()` est privée du closure
de `createShiba`, ce n'est pas une API de test, et on ne duplique pas sa formule
non plus.

```js
{
  const r = gltfRig; let ok = false, detail = gltfCause;
  if (r) {
    const pos = r.mesh.geometry.attributes.position;
    const tmp = new THREE.Vector3(), repos = [];
    const poser = (p) => {
      for (const leg of r.legs) r.poseLeg(leg, p.hip, p.knee, { swim: 0, sit: p.sit, shake: p.shake, speedN: 0 });
      r.poseBody(0, 0, p.roll || 0, { swim: 0, sit: p.sit, shake: p.shake, speedN: 0 });
      r.head.rotation.y = p.head || 0;
      r.tailBase.rotation.y = p.tail || 0;
      for (const l of r.lids) l.rotation.x = p.blink ? 0.58 : -0.32;
      for (const e of r.ears) e.rotation.x = p.ear ?? -0.30;
      r.root.updateMatrixWorld(true);
    };
    poser(POSES[0][1]);
    for (let v = 0; v < pos.count; v++) repos.push(r.mesh.getVertexPosition(v, tmp).clone());
    const boiteRepos = new THREE.Box3().setFromPoints(repos);
    const volRepos = boiteRepos.getSize(new THREE.Vector3()).length();

    let pireDerive = 0, pirePose = '', pireVol = 0;
    for (const [nom, p] of POSES) {
      poser(p);
      const pts = [];
      for (let v = 0; v < pos.count; v++) {
        r.mesh.getVertexPosition(v, tmp);
        pts.push(tmp.clone());
        const d = tmp.distanceTo(repos[v]);
        if (d > pireDerive) { pireDerive = d; pirePose = nom; }
      }
      const vol = new THREE.Box3().setFromPoints(pts).getSize(new THREE.Vector3()).length();
      pireVol = Math.max(pireVol, vol / volRepos);
    }
    poser(POSES[0][1]);            // rendre le rig a son repos

    // Lateralite : aucun vertex d'un cote ne recoit de poids d'une patte de
    // l'autre. C'est ce qui garantit que les pattes ne se collent pas.
    const si = r.mesh.geometry.attributes.skinIndex;
    const sw = r.mesh.geometry.attributes.skinWeight;
    let fuites = 0;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      if (Math.abs(x) <= 0.02) continue;
      for (const c of ['X', 'Y', 'Z', 'W']) {
        if (sw['get' + c](v) <= 0) continue;
        const nom = r.skeleton.bones[si['get' + c](v)].name;
        const m = /^(hip|knee|paw)[FB]([LR])$/.exec(nom);
        if (m && ((m[2] === 'L' && x > 0.02) || (m[2] === 'R' && x < -0.02))) fuites++;
      }
    }
    ok = pireDerive <= 0.35 && pireVol <= 2 && fuites === 0;
    detail = `derive max ${pireDerive.toFixed(3)} (${pirePose}), bbox x${pireVol.toFixed(2)}, fuites laterales ${fuites}`;
  }
  check('rig glTF : aucune explosion sur 12 poses, pattes non collees', ok, detail);
}
```

Les deux seuils : **0.35 u** de dérive maximale — 25 % de la longueur du chien,
au-delà c'est une membrane et pas une déformation — et une bbox qui reste sous
**2×** celle du repos.

- [ ] **Étape 3 — Vérifier**

```sh
python3 serve.py 5173
```

Ouvrir `http://127.0.0.1:5173/test/invariants.html`, puis la même page avec
`?q=ultra`. La console doit finir par :

```
INVARIANTS: 26 pass, 0 fail
```

**Les deux tiers**, pas seulement `low` : `low` (~4.6 u de pas) est le terrain le
plus lisse, donc le cas le plus facile.

- [ ] **Étape 4 — Commit**

```sh
git add test/invariants.html
git commit -m "test(shiba): cinq invariants sur le rig glTF, de 21 a 26

Contrat complet et ordre FL/FR/BL/BR (les diagonales du trot en dependent),
echelle et centrage des appuis, dos hors de l'eau contre le swimFloat du rig,
poids bien formes, rig non degenere, non-explosion sur 12 poses + lateralite.

Le harnais gagne son premier await (top-level, module ES) : un check fait dans
un .then s'ajouterait APRES la ligne INVARIANTS sans etre compte. Un asset
absent ECHOUE, il n'est pas saute.

INVARIANTS: 26 pass, 0 fail en low et en ultra"
```

---

## Tâche 5 — Les cinq hooks dans `shiba.js` et `shiba-geom.js`

**Le chien procédural doit sortir de cette tâche strictement identique.** C'est
le repli, et c'est la tâche la plus facile à casser du chantier.

**Fichiers :**
- Modifier : `src/shiba.js` (l.200-250, l.464-465, l.518-525, l.858-865)
- Modifier : `src/shiba-geom.js` (l.846, plus `sole` et le commentaire l.823-824)

**Interfaces :**
- Consomme : le rig de la tâche 3.
- Produit : `createShiba({ …, body })` accepte un rig préconstruit ; le contrat
  de rig gagne `material`, `sole(leg)`, `swimFloat`, `poseLeg`, `poseBody`.

- [ ] **Étape 1 — `shiba-geom.js` : poser `material` et ajouter `sole`**

`buildBody(material)` reçoit déjà le matériau ; il le **range** désormais dans le
rig, et ajoute une `sole` qui lit le mesh nommé `'paw'` — la mécanique actuelle
de l'invariant 12, déplacée du harnais vers le rig qui la connaît :

```js
const _boxSole = new THREE.Box3();
const sole = (leg) => {
  // Le mesh 'paw' est un enfant de knee (L823-840). Sa bbox monde donne la
  // semelle ; seul le point BAS compte.
  let paw = null;
  leg.knee.traverse((o) => { if (o.isMesh && o.name === 'paw') paw = o; });
  const b = _boxSole.setFromObject(paw);
  return new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
};
return { root, tilt, body, neck, head, jaw, lids, ears, tailBase, legs, parts, material, sole };
```

Reformuler le commentaire l.823-824 : la clause « l'invariant 12 le retrouve par
son nom » devient « `rig.sole()` le retrouve par son nom ; c'est lui que
l'invariant 12 consomme ».

- [ ] **Étape 2 — `shiba.js` : accepter un rig préconstruit**

```js
export function createShiba({ seed = 1337, heightAt, /* … */, body = null } = {}) {
  // …
  const rig = body ?? buildBody(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.86, metalness: 0.0, flatShading: false,
  }));
  rig.root.scale.setScalar(SHIBA_BUILD.scale);
```

Le matériau n'est plus créé que dans la branche de repli — `buildBody` le range
dans le rig (étape 1). **Ne pas** le créer inconditionnellement : avec
`vertexColors: true` et une géométrie glTF sans attribut `color`, un branchement
malheureux rendrait le chien **noir**, silencieusement.

- [ ] **Étape 3 — Le `mix` de secouage remonte, puis `poseLeg`**

Aujourd'hui `shiba.js:464-465` écrit :

```js
leg.hip.rotation.x = mix(hip, 0, shake);
leg.knee.rotation.x = mix(knee, 0, shake);
```

Remplacer par :

```js
// Le mix de secouage est applique ICI, en amont du hook : sinon chaque rig
// devrait penser a l'appliquer, et l'oubli fait regresser le chien procedural.
const hipF = mix(hip, 0, shake);
const kneeF = mix(knee, 0, shake);
if (rig.poseLeg) rig.poseLeg(leg, hipF, kneeF, { swim, sit, shake, speedN });
else { leg.hip.rotation.x = hipF; leg.knee.rotation.x = kneeF; }
```

- [ ] **Étape 4 — `poseBody`**

`shiba.js:518/521/525` écrit `body.position.y`, `.rotation.z` et `.rotation.x`.
Les remplacer par un appel unique, après le calcul des trois valeurs :

```js
const bodyYF = mix(bodyY, 0, shake);
const rollF = mix(bodyRoll, shakeWave * 0.42, shake);
const pitchF = mix(bodyPitch, 0, shake);
if (rig.poseBody) rig.poseBody(bodyYF, pitchF, rollF, { swim, sit, shake, speedN });
else { rig.body.position.y = bodyYF; rig.body.rotation.x = pitchF; rig.body.rotation.z = rollF; }
```

- [ ] **Étape 5 — `swimFloat` et `dispose`**

`SHIBA.swimFloat` n'a **qu'un seul** site de lecture au runtime, `shiba.js:792` :

```js
const targetY = state.swimming ? s - (rig.swimFloat ?? SHIBA.swimFloat) : ground;
```

La garde de `shiba.js:84` (niveau module, sur les constantes) **ne bouge pas** :
elle protège le rig procédural, et elle s'évalue avant qu'aucun rig n'existe.

**À lire avant de toucher à ce nombre** — le commentaire `shiba.js:81-83` dit :
« At swimFloat 0.55 he looked as if he walked on water ». C'est vrai **pour le
chien procédural**, dont le dos est à 1.336 au-dessus des pattes : à 0.55 il
sortait de l'eau de 0.786, soit 59 % de sa hauteur de dos. Le chibi a son dos à
0.878 : à 0.56 il n'en sort que de 0.318, soit 36 % — exactement la proportion
qu'a le chien procédural à 0.85. Le précédent ne s'applique donc pas, mais il
doit être cité dans le commentaire du nouveau nombre, sinon la prochaine session
lira `0.56` comme une régression qu'on aurait ignorée.

`dispose()` devient :

```js
for (const g of rig.parts) g.dispose();
rig.material.map?.dispose();     // partagee avec le MeshBasicMaterial abandonne
rig.material.dispose();
```

- [ ] **Étape 6 — Vérifier que le chien procédural n'a pas bougé**

```sh
node --check src/shiba.js && node --check src/shiba-geom.js
python3 serve.py 5173
```

`http://127.0.0.1:5173/test/invariants.html` — attendu `26 pass, 0 fail`.
Puis, dans `index.html` : marcher, courir, s'asseoir, nager, se secouer. **Aucune
différence visible** avec avant le chantier ; c'est le point de contrôle.

- [ ] **Étape 7 — Commit**

```sh
git add src/shiba.js src/shiba-geom.js
git commit -m "feat(shiba): cinq hooks optionnels sur le contrat de rig

material, sole(leg), swimFloat, poseLeg, poseBody — tous defausses sur le
comportement actuel, pour que le chien procedural reste le repli a l'identique.

Le mix de secouage remonte en amont de poseLeg : le laisser dans le hook
obligerait chaque rig a y penser, et l'oubli ferait regresser le chien
procedural. poseBody remplace un facteur multiplicatif envisage d'abord :
bodyY a DEJA absorbe l'affaissement d'assise, un facteur l'aurait amplifie.

INVARIANTS: 26 pass, 0 fail en low et en ultra"
```

---

## Tâche 6 — Câbler `main.js`, et l'invariant 12 joué deux fois

**Fichiers :**
- Modifier : `src/main.js` (bloc `step('shiba')`, l.469-503)
- Modifier : `test/invariants.html` (invariant 12)

- [ ] **Étape 1 — L'`await` dans le bloc du shiba**

Entre `await step('shiba')` (l.469) et `createShiba` (l.491) :

```js
// Le glTF est le chien normal ; le procedural est le repli. Un asset absent ou
// casse doit degrader en silence pour l'utilisateur et bruyamment en console.
let dogBody = null;
try {
  dogBody = await loadShibaBody();
} catch (err) {
  console.warn('[main] shiba glTF indisponible, repli procedural :', err);
}
```

puis passer `body: dogBody` à `createShiba`. L'import va en tête de `main.js`,
avec les autres.

C'est le seul emplacement sûr : le chien est le **dernier** système construit,
rien avant lui ne lit `world.shiba`, `boot()` est déjà `async` et déjà interrompue
par 13 `await step(...)`, et `veil` ne disparaît qu'à la l.509 — le chargement se
déroule sous le voile.

- [ ] **Étape 2 — Invariant 12 joué deux fois**

Remplacer la recherche par `o.name === 'paw'` par `rig.sole(leg)`, et faire
tourner le bloc deux fois : une fois **sans** `body` (repli procédural, gardien
de `SHIBA_BUILD`), une fois **avec** le corps glTF. Seuil **0.09 dans les deux
cas** — ne pas le serrer à 0.01 côté glTF sous prétexte que la normalisation pose
les semelles à `y = 0` : la semelle mesurée est celle du vertex **skinné**, pas
celle du repos, et le chien est posé sur un terrain interpolé.

- [ ] **Étape 3 — Vérifier**

Invariants en `low` et `ultra` : `26 pass, 0 fail`. Puis `index.html` : le chien
glTF apparaît. Et le repli, en renommant temporairement l'asset :

```sh
mv assets/shiba/shiba.glb assets/shiba/shiba.glb.off
# recharger : le chien procedural doit apparaitre, avec un warn en console
mv assets/shiba/shiba.glb.off assets/shiba/shiba.glb
```

- [ ] **Étape 4 — Commit**

```sh
git add src/main.js test/invariants.html
git commit -m "feat(shiba): le chien glTF branche, le procedural en repli

await loadShibaBody() dans le bloc step('shiba'), dernier systeme construit :
rien avant lui ne lit world.shiba, et le chargement se deroule sous le voile.
Asset renomme a la main : le chien procedural reprend la main avec un warn.

Invariant 12 joue deux fois, sur les deux rigs, via rig.sole() — le mesh nomme
'paw' n'existe plus cote glTF, ou il n'y a qu'un SkinnedMesh.

INVARIANTS: 26 pass, 0 fail en low et en ultra"
```

---

## Tâche 7 — Le réglage visuel

Les quatre nombres de la tâche 3 sont des **hypothèses de départ mesurées**, pas
des constantes d'art. Cette tâche les valide à l'écran. **C'est Claude qui la
conduit, avec l'utilisateur** — pas Codex : c'est un jugement, pas un calcul.

- [ ] **Étape 1 — Marche, course, virage.** Les pattes bougent-elles assez pour
  lire ? Le corps glisse-t-il ? Épaules et hanches se pincent-elles ?
  → règle `poseLeg` (`1.30` / `0.40`) et le `1.6` de rebond de `poseBody`.
- [ ] **Étape 2 — Assise** après 4.2 s d'immobilité. La pose la plus exposée.
  → règle les `-0.045` et `-0.12` de `poseBody`, et le `0.55` / `0.18` de sit.
- [ ] **Étape 3 — Nage** en étang, entrée et sortie. Le dos sort-il vraiment ?
  → règle `swimFloat` (départ 0.56).
- [ ] **Étape 4 — Secouage** en sortie d'eau : pose neutre propre, gouttelettes
  émises depuis le milieu du corps.
- [ ] **Étape 5 — Gros plan sur la tête.** Le clignement lit-il comme une
  paupière ou comme un œil qui pivote ? Le crâne reste-t-il immobile pendant ?
  **Si ça lit mal, mettre l'influence des `lid` à zéro** : le clignement redevient
  un no-op, comme `jaw`. C'était un pari, pas une promesse.
- [ ] **Étape 6 — Midi (`dayTime = 0.5`) et nuit (`0.97`).** La texture est
  *baked* : elle peut aplatir le couchant ou paraître trop claire la nuit.
  → règle `roughness` (départ 0.90), éventuellement `material.color`.
- [ ] **Étape 7 — Ombre portée** présente et suivant la pose. Si elle
  disparaît : `frustumCulled`.
- [ ] **Étape 8 — Performance**, au protocole du piège n°9 :
  `__sk.setCamMode('orbit')`, `autoRotate = false`, `enableDamping = false`,
  `gl.readPixels` après chaque frame, dérive de caméra vérifiée nulle. Attendu :
  aucune différence mesurable (7304 tri / 33 draws → 4316 tri / 1 draw).
- [ ] **Étape 9 — Commit du réglage**, avec les valeurs finales et ce qui les a
  décidées.

---

## Tâche 8 — Documentation et review

- [ ] **Étape 1 — `AGENTS.md`** : la doctrine (« aucun asset externe » devient
  « aucun asset externe, **sauf le shiba** »), l'asset et sa licence, le
  `serve.py` désormais obligatoire pour cause de `fetch`, et le compte
  d'invariants — il annonce encore 16 pour 26 réels.
- [ ] **Étape 2 — En-tête de `shiba.js`** : la l.4 dit « A procedural dog: no
  glTF, no rig, no textures ». Elle devient fausse et doit dire ce qui est vrai :
  un chien glTF riggé en code, avec le procédural en repli.
- [ ] **Étape 3 — `REPRISE.md`** : entrée de session au canevas maison — demande
  et diagnostic, ce qui a été construit avec les chiffres, ce que la mesure a
  rattrapé, pièges payés, vérification, ce qui reste.
- [ ] **Étape 4 — Review adversariale** via le skill `codex:adversarial-review`
  (jamais le CLI codex à la main), rapport dans `ADVERSARIAL_REVIEW_CLAUDE.md`
  sous l'id `ADV-2026-08-05-SHIBA-GLTF`, table de suivi remplie au traitement.
- [ ] **Étape 5 — Commit.**
