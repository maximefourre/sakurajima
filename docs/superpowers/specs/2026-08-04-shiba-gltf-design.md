# Le shiba en glTF — un modèle importé, rigué à la main

> Chantier G. Spec validée avec l'utilisateur le 04/08/2026, corrigée le 05/08
> après une critique adversariale à quatre lentilles (75 défauts signalés,
> 36 confirmés — voir « Ce que la critique a changé » en fin de document).
> Implémentation : Codex sol, effort high, sur brief. Review adversariale après.

## En bref

> Ce document est long parce que c'est un **brief d'implémentation** : chaque
> nombre y est mesuré et justifié, pour que Codex n'ait rien à inventer. Voici
> ce qu'il faut savoir pour décider.

**Ce qu'on fait.** On remplace la géométrie du shiba par le modèle du tuto
Codédex, et on lui fabrique en code le squelette qu'il n'a pas (22 os, poids
calculés par distance) pour rebrancher le cycle d'animation existant. Le chien
procédural reste en repli si l'asset ne charge pas.

**Ce que ça coûte.** Un binaire de 890 Ko versionné et un `fetch` au boot — les
deux premiers du dépôt, contre la doctrine « tout procédural ». Dérogation
assumée, bornée au shiba.

**Ce qu'on gagne.** Une bien meilleure silhouette, et 7304 triangles en 33 draw
calls qui deviennent 4316 en 1.

**Ce qu'on perd.** La mâchoire (peinte dans la texture). Le clignement est
récupéré par une astuce à valider en gros plan.

**Les trois risques.** (1) Le chien est une peluche chibi : 53 % plus large que
l'actuel, pattes 3.2 fois plus courtes — la marche se lira surtout par le corps.
(2) La texture est *baked*, elle peut aplatir le couchant. (3) Quatre nombres
(amplitude des pattes, affaissement d'assise, rebond, flottaison) sont des
hypothèses de départ à régler à l'écran.

**Ce qui reste à décider : rien.** Les questions de cadrage ont été tranchées le
04/08 (tableau ci-dessous).

---

## Le problème

L'utilisateur a pointé un tutoriel — [Codédex, *Build an Interactive 3D Model with
Three.js*](https://www.codedex.io/projects/build-an-interactive-3d-model-with-threejs) —
et demandé : « utilise ça pour faire le model du shiba ».

Le chien du 03/08 (`shiba-geom.js`, 847 lignes, 33 meshes, 7304 triangles) est
entièrement procédural, et il est bon en mouvement : marche/trot/galop mélangés
par poids, nage en trot diagonal, oreilles, queue, clignement, empreintes,
gerbes d'eau. Le modèle du tutoriel est meilleur en pose fixe et **nul en
mouvement** : c'est une statue de 4316 triangles, sans squelette, sans animation.

Le chantier consiste donc exactement en ceci : **prendre la silhouette du glTF et
lui rendre le mouvement du chien procédural**, en fabriquant nous-mêmes le
squelette et les poids que l'asset n'a pas. Le cycle d'animation existant ne doit
pas être réécrit — il doit être rebranché.

## Décisions de cadrage (validées avec l'utilisateur)

| Question | Choix |
|---|---|
| Statue ou animé ? | **Découper et rigger.** Le swap brut (chien qui glisse) est rejeté. |
| Comment, sur un shell soudé ? | **Auto-skinning** : squelette fabriqué en code, poids par distance aux segments d'os, `SkinnedMesh`. La découpe rigide en sous-meshes est rejetée (fentes aux épaules et aux hanches sur un mesh soudé). |
| Sort du chien procédural ? | **Repli silencieux.** Le glTF devient le chien normal ; si le chargement échoue, `buildBody()` reprend la main. Pas de sélecteur `?dog=`, pas de câblage dupliqué. |
| Hébergement de l'asset | **Vendorisé dans le dépôt**, un seul `.glb`. Pas de CDN : la scène doit tourner hors ligne, comme tout le reste. |

### La dérogation doctrinale, assumée

Ce chantier casse frontalement une doctrine écrite noir sur blanc dans le code :

- `shiba.js:4` — « A procedural dog: **no glTF, no rig, no textures**, in keeping
  with the rest of the scene ».
- `detailtex.js:1-4` — « **No image files**: the project's doctrine is
  procedural-everything ».

Le dépôt compte aujourd'hui **45 fichiers versionnés, zéro octet binaire**, et
**aucun chargement de ressource au runtime** — le seul réseau est l'importmap
unpkg. Ce chantier introduit les deux : un binaire versionné et un `fetch`.

C'est un choix de l'utilisateur, pas un accident, et il ne se généralise pas :
il vaut **pour le shiba seul**. Le sol, les rochers, le bois, l'herbe, les
arbres, les insectes restent procéduraux. `AGENTS.md` et l'en-tête de `shiba.js`
doivent être corrigés dans le même commit, sinon la doctrine devient un mensonge
que la prochaine session lira comme une contrainte.

## L'asset — provenance, licence, empaquetage

**Source** : « Shiba » par **zixisun02**,
[Sketchfab](https://sketchfab.com/3d-models/shiba-faef9fe5ace445e7b2989d1c1ece361c),
**CC-BY-4.0**. Le glTF porte lui-même sa provenance dans `asset.extras`
(title / author / license / source) — ce n'est pas une reconstitution.

Fichiers d'origine (miroir public du même export Sketchfab 12.68.0,
`raw.githubusercontent.com/INOCCENT-Dev/shiba/HEAD/shiba/`) :

| fichier | taille | sha256 |
|---|---|---|
| `scene.gltf` | 7 859 o | `958ebe1bfb278e4790cf1f3e9526ba38938f6f4c809cc15d91c215be688bf2e2` |
| `scene.bin` | 133 296 o | `810d0b2cad55b3c9f82d0388b8383b5875d8b7bc1a0179f743a296b06c0eada5` |
| `textures/default_baseColor.png` (2048²) | 1 837 463 o | `c6ab1ca4ead4ef999d0e416cf6a66f26db52bf9e75eef65ef536f97a835a676e` |

**Empaquetage : un seul `assets/shiba/shiba.glb`.** Trois fichiers séparés
obligeraient à résoudre des URI relatives (le projet n'a **aucune** convention
pour ça — ni `import.meta.url`, ni relatif-page) et à étendre le MIME de
`serve.py` pour `.bin` et `.png`. Un `.glb` autonome supprime les deux problèmes :
un seul `fetch`, `path = ''`, aucune résolution.

Texture ramenée de 2048² à **1024²** avant empaquetage (mesures : 2048² = 1.8 Mo,
1024² = 748 Ko, 512² = 240 Ko). Total attendu du `.glb` : **≈ 890 Ko**.

Le script d'empaquetage est un one-shot sans dépendance, documenté dans le commit
pour que le binaire soit reproductible depuis les trois sha256 ci-dessus. Il doit
faire exactement ceci :

1. réduire le PNG à 1024² ;
2. concaténer `scene.bin` et le PNG dans un buffer unique, chaque segment aligné
   sur 4 octets ;
3. ajouter un `bufferView` pour l'image, et remplacer `images[0].uri` par
   `{ bufferView, mimeType: 'image/png' }` ;
4. supprimer `buffers[0].uri` et corriger `byteLength` ;
5. sérialiser : en-tête 12 o (`glTF`, version 2, longueur totale), chunk JSON
   (type `JSON`, **complété par des espaces** jusqu'à un multiple de 4), chunk
   binaire (type `BIN\0`, **complété par des zéros**) ;
6. laisser `samplers`, `materials`, `meshes`, `nodes` **intacts** — en
   particulier `KHR_materials_unlit` et `doubleSided` (voir « Le matériau »).

**Attribution CC-BY** — obligatoire, à trois endroits :
1. `assets/shiba/LICENSE.txt` : titre, auteur, URL source, licence, date de
   récupération, et la liste des modifications (rééchelonnage, recentrage,
   texture réduite, squelette ajouté).
2. `index.html`, dans le `<div class="hint">` du panneau : une ligne
   « Shiba 3D : zixisun02 — CC-BY 4.0 ».
3. `AGENTS.md`, section asset.

C'est le premier crédit tiers du dépôt ; il n'y a aucun modèle existant à imiter.

## Mesures — ce que le modèle est vraiment

Toutes les valeurs sont **mesurées** sur la géométrie, matrices de nœuds
appliquées (le glTF est en Z-up ; le graphe porte une rotation −90° X — il ne
faut donc surtout pas lire les positions brutes du `.bin`, qui décrivent un chien
couché sur le dos). Repère de mesure : semelles ramenées à `y = 0`, échelle glTF
native. **Chaque ligne donne le prédicat qui l'a produite** — sans lui, un
invariant qui prétend la revérifier mesure autre chose.

| repère | définition | valeur |
|---|---|---|
| bbox | mesh `Box002` | **0.920** × **1.381** × **1.775** (l × h × L) |
| orientation | museau vs queue | **regarde +Z** — museau `z = +0.364`, queue `z = −1.411` |
| appuis avant | centroïde des vertices `y < 0.02`, `z > −0.40` (n = 44) | `x = ∓0.223`, `z = −0.130` |
| appuis arrière | idem, `z ≤ −0.40` (n = 68) | `x = ∓0.296`, `z = −0.600` |
| **milieu des appuis** | moyenne des deux | **`z = −0.365`** |
| ligne de dos | max `y`, `|x| < 0.10`, `z ∈ [−0.90, −0.45]` (derrière le crâne) | `y ≈ 0.790` |
| sommet du crâne | max `y` global | `y = 1.381` |
| ventre entre les trains | min `y`, `|x| < 0.08`, `z ∈ [−0.60, −0.20]` | `y = 0.084` |
| point bas du dessous | min `y`, `|x| < 0.08`, tout `z` (c'est la **croupe**, `z = −0.80`) | `y = 0.062` |
| jointure de patte | le cylindre d'appui arrière est **vide entre `y = 0.25` et `y = 0.45`** | moignon jusqu'à `y ≈ 0.22` |
| yeux (mesh séparé) | centroïdes par signe de `x` | `(±0.118, 0.980, 0.169)`, bille 0.156 × 0.156 × 0.078 |
| base d'oreille | hauteur au-delà de laquelle il n'y a plus de crâne médian (`|x| < 0.05` disparaît) | `y ≈ 1.26`, lobes centrés `(±0.20, ·, −0.15)` |
| attache de queue | le tronc s'élargit de 0.44 à 0.59 en franchissant | `z ≈ −0.98` |
| collier (mesh séparé) | centroïde | `(0, 0.708, −0.214)` |

Découpage : **`Box002` = corps entier soudé** (2145 vtx / 3708 tri),
**`Group18985` = collier** (272 vtx), **`Object001` = les deux yeux** (130 vtx,
séparables 65/65 par le signe de `x` — le plus petit `|x|` vaut 0.033, aucun
vertex n'est près de l'axe). Un seul matériau, une seule texture baked.
**La géométrie fusionnée compte donc 2547 vertices**, pas 2145.

Partition **disjointe** des 2145 vertices du corps, qui dit quels os auront de la
matière : `pattes` (`y < 0.25 ∧ |z| < 0.95`) **776** ; `tête` (`z > 0.05`) **287** ;
`queue` (`z < −0.95`) **318** ; `tronc` (le reste) **764**. Somme = 2145.

### L'échelle : k = 0.823, une seule contrainte

**Longueur hors-tout, bbox contre bbox.** Le chien procédural mesure 1.461 u de
construction (bbox complète, queue comprise) ; le glTF, 1.775 selon la même
définition. D'où :

```
k = 1.461 / 1.775 = 0.823
```

C'est la **seule** contrainte, et c'est délibéré. Une version antérieure de cette
spec en invoquait une seconde — aligner la ligne de dos du glTF sur
`SHIBA_BUILD.standHeight = 0.66` — qui est fausse : `standHeight` est la **somme
de la chaîne de patte** (`hipDrop + thigh + shin + pad`), donc la hauteur de la
ceinture pelvienne, pas celle du dos visible. Le dos du chien procédural est à
**0.990**, soit 1.50 × standHeight. La coïncidence à 1 % entre les deux nombres
n'en était pas une : elle comparait deux grandeurs différentes.

Conséquences à k = 0.823 :

| | procédural | glTF ×0.823 |
|---|---|---|
| longueur hors-tout | 1.461 | 1.461 *(par construction)* |
| hauteur hors-tout | 1.307 | 1.137 |
| **largeur** | 0.496 | **0.757** |
| ligne de dos | 0.990 | **0.650** |
| ventre entre les trains | 0.474 | **0.069** |
| longueur de chaîne `hip→paw` | 0.522 av. / 0.562 arr. | **0.161** |
| empattement (appuis av. ↔ arr.) | 0.594 | 0.386 |

**Note d'exactitude, assumée.** Le modèle est une caricature chibi, et les trois
lignes en gras le disent : il est 53 % plus large que le chien procédural, son
dos est un tiers plus bas, et sa chaîne de patte est **3.2 fois plus courte**.
À l'étalon métrique du projet (~0.9 m/u, calibré sur la **lanterne** —
`REPRISE.md` documente d'ailleurs que l'étalon shiba, lui, ne donne pas le même
facteur), il ferait environ 0.92 m de large pour 1.78 m de long : un shiba réel
fait 25 à 30 cm de large. Le chien lira comme une peluche, pas comme un animal.
C'est le modèle demandé ; le noter ici évite qu'une session future le prenne
pour un bug d'échelle.

### Le recentrage : sur les appuis, pas sur la bbox

Le rig procédural place son origine au **milieu des appuis** (avant `z = +0.294`,
arrière `z = −0.300`, milieu `z ≈ 0`). `shiba.js` pose `root.position` sur le sol
aux `(x, z)` du chien, et la caméra tierce personne vise `root`.

Le glTF a son milieu d'appuis à `z = −0.365`, soit `−0.300` après échelle. Laissé
à l'origine du glTF, le chien traînerait **23 %** de sa longueur derrière son
marqueur de position ; centré sur sa bbox, encore 6 %.

**Translation après échelle : `Δz = +0.300`, `Δx = 0` (déjà symétrique),
`Δy` tel que les semelles soient à `y = 0`.**

La définition des « appuis » — centroïde des vertices en contact, `y < 0.02`
avant échelle — n'est pas un détail de rédaction : l'invariant 23 la rejoue via
`rig.sole()`, et une définition par tranche épaisse (`y < 0.17`, `y < 0.25`)
déplace le milieu de 0.02 à 0.06, soit jusqu'à trois fois la tolérance.

Repères finaux, en unités de construction, dans l'espace de `root` :

| repère | position |
|---|---|
| semelles | `y = 0` |
| ligne de dos | `y = 0.650` |
| sommet du crâne | `y = 1.137` |
| museau | `z = +0.600` |
| bout de queue | `z = −0.861` |
| appuis avant | `(±0.184, 0, +0.193)` |
| appuis arrière | `(±0.243, 0, −0.193)` |
| jointure de patte | `y = 0.181` |
| yeux (centres) | `(±0.097, 0.807, +0.439)` — arête haute à `y = 0.871`, bille de 0.128 |
| base d'oreille | `(±0.165, 1.037, +0.177)` |
| collier | `(0, 0.583, +0.124)` |
| attache de queue | `(0, 0.453, −0.507)` |
| ventre entre les trains | `y = 0.069` |

---

## Architecture

### Module `src/shiba-gltf.js` — signature

```js
/** Charge le shiba glTF, le normalise et lui fabrique un squelette au contrat
 *  de buildBody(). Rend null si l'asset est indisponible (repli procédural). */
export async function loadShibaBody({ url = 'assets/shiba/shiba.glb' } = {})
  → Promise<rig | null>
```

Un seul export public. Le module ne connaît ni le monde, ni le terrain, ni l'eau,
ni la qualité : il rend un rig, exactement comme `buildBody()`.

Étapes, dans l'ordre :

1. `new GLTFLoader().loadAsync(url)` — `three/addons/loaders/GLTFLoader.js`,
   déjà résolu par l'importmap d'`index.html` **et** de `test/invariants.html`.
2. `gltf.scene.updateMatrixWorld(true)` — **obligatoire** : à la sortie du
   loader les `matrixWorld` ne sont pas à jour, et le graphe porte la rotation
   Z-up→Y-up.
3. Fusion des trois meshes en une géométrie unique via `mergeGeometries`
   (`three/addons/utils/BufferGeometryUtils.js`), chaque géométrie clonée puis
   `applyMatrix4(o.matrixWorld)`. Les trois portent les mêmes attributs
   (`POSITION`, `NORMAL`, `TEXCOORD_0`) et sont toutes indexées : le merge passe.
   **Retenir l'intervalle de vertices de chacune** — le collier et les yeux ont
   un traitement de poids particulier, et après fusion ils ne sont plus
   identifiables autrement. `mergeGeometries` rend `null` en cas de refus : le
   tester.
4. Normalisation appliquée **à la géométrie** (`applyMatrix4`), pas à un nœud —
   ainsi `root.scale` reste libre pour le `×1.35` que `shiba.js:246` y pose :
   `scale(0.823)`, puis translation `(0, −y_semelles, +0.300)`.
5. Construction des os avec leur **pose de bind** (§ suivant), puis
   `tilt.updateMatrixWorld(true)`, puis `new THREE.Skeleton(bones)`.
6. Calcul des poids, écriture de `skinIndex` / `skinWeight`.
7. `new THREE.SkinnedMesh(geo, material)`, `normalizeSkinWeights()`,
   `bind(skeleton, new THREE.Matrix4())`, `castShadow = receiveShadow = true`,
   `frustumCulled = false`.
8. Retour du rig.

En cas d'échec (réseau, parse, merge refusé, mesh introuvable) : `console.warn`
explicite avec la cause, et **retour `null`**. Jamais d'exception qui remonte —
le repli doit être silencieux pour l'utilisateur et bruyant dans la console.

### Le matériau — l'asset est *unlit*, et c'est un piège

`GLTFLoader` **ne rend pas** un `MeshStandardMaterial` : l'asset déclare
`extensionsUsed: ["KHR_materials_unlit"]` et `materials[0].extensions.
KHR_materials_unlit`, donc `GLTFMaterialsUnlitExtension.getMaterialType()` rend
un **`MeshBasicMaterial`**, et la branche `pbrMetallicRoughness` de
`loadMaterial` est court-circuitée — `roughness` et `metalness` ne sont même
jamais assignés. Écrire `m.roughness = 0.90` dessus ne lève aucune erreur et
**ne fait rien** : `ShaderLib.basic` n'a pas cet uniform. Un chien unlit ne suit
pas le cycle jour/nuit et **ne reçoit plus les ombres** (le shader `basic` n'a ni
`lights_fragment_begin` ni `shadowmap_pars_fragment`) tout en continuant d'en
projeter — une régression qui passerait la puce de vérification « ombre portée
présente ».

Le rig construit donc **explicitement** son matériau :

```js
const src = /* matériau du premier mesh chargé */;
const material = new THREE.MeshStandardMaterial({
  map: src.map,            // colorSpace 'srgb' déjà posé par le loader
  roughness: 0.90,
  metalness: 0.0,
  vertexColors: false,     // l'asset n'a AUCUN attribut COLOR_0 — piège n°2
  side: src.side,          // DoubleSide tel que chargé — piège n°1, cf. plus bas
});
src.dispose();             // le MeshBasicMaterial abandonné
```

- **`vertexColors: false` est explicite** parce que le matériau procédural, lui,
  vaut `true` : hériter de ce réglage sans attribut `color` rendrait le chien
  **noir**, silencieusement (piège n°2 d'`AGENTS.md`, déjà payé sur ce projet).
- **`side` est repris tel quel** (l'asset est `doubleSided: true`). Descendre à
  `FrontSide` demande d'abord de vérifier que la géométrie fusionnée est fermée —
  les yeux et le collier sont souvent des cartes planes, et le piège n°1
  (winding, quatre morsures déjà payées) rend une face manquante **invisible**,
  sans erreur. On ne troque pas une panne silencieuse contre une autre.
- **`map` est partagée** entre le `MeshBasicMaterial` abandonné et le nouveau :
  ne la disposer **qu'une fois**, dans `dispose()`.

### Le contrat de rig, et les cinq points où il doit s'élargir

Le contrat existant, relevé dans `shiba.js` :

```
{ root, tilt, body, neck, head, jaw, lids[2], ears[2], tailBase,
  legs[4] { front, hip, knee, paw }, parts }
```

- `root` : `shiba.js` **possède** `position`, `quaternion` et `scale` — le rig
  doit être livré à l'échelle 1, et `root` doit être un conteneur déplaçable.
- `body` : `position.y`, `rotation.x` et `rotation.z` sont écrits en **absolu**
  (donc `body` vaut 0 au repos), **et sa position MONDE est lue**
  (`getWorldPosition`, `shiba.js:533`) — son `Y` sert d'altitude d'émission des
  gouttelettes de secouage. `body` doit donc rester à l'étage du tronc.
- `legs` : seuls `hip.rotation.x` et `knee.rotation.x` sont écrits ; seule la
  position **monde XZ** de `paw` est lue (empreintes, gerbes, impacts d'eau).
  Le `Y` du paw n'est lu nulle part.
- **L'ordre de `legs` est porteur de sens** : `GAITS.trot.ph = [0, π, π, 0]`
  apparie `legs[0]↔legs[3]` et `legs[1]↔legs[2]` — ce sont les diagonales.
  L'ordre **FL, FR, BL, BR** est obligatoire.
- `ears[0]` est le côté `x < 0` (`shiba.js:595`, `side = i === 0 ? -1 : 1`) ;
  `lids` suit la même convention.
- `parts` : itérable d'objets exposant `dispose()`.
- `tilt` n'est **jamais** référencé par `shiba.js` : il porte seulement l'offset
  entre le plan des semelles et `body`. Sa hauteur est donc **libre**.

Cinq élargissements, tous optionnels, tous défaussés sur le comportement actuel :

**(1) `rig.material`.** Le rig possède son matériau ; `dispose()` libère
`rig.parts`, `rig.material` et `rig.material.map`. Côté procédural, `shiba.js`
crée son `MeshStandardMaterial({ vertexColors: true, … })` comme aujourd'hui et
le pose sur le rig — la seule différence est **qui le range**.

**(2) `rig.poseLeg(leg, hip, knee, w)`.** `animate()` mélange locomotion, nage,
assise **et secouage** avant d'appeler le hook ; `hip` et `knee` sont donc les
angles **finaux**, et `w = { swim, sit, shake, speedN }` n'est passé qu'à titre
indicatif. Défaut, si absent — strictement le comportement d'aujourd'hui :

```js
leg.hip.rotation.x = hip;  leg.knee.rotation.x = knee;
```

C'est le point où la version précédente de cette spec se trompait : elle donnait
ce défaut alors que `shiba.js:464-465` écrit `mix(hip, 0, shake)`. Un
implémenteur fidèle aurait fait **régresser le chien procédural**, celui-là même
dont on exige la constance. Le `mix` de secouage remonte donc dans `animate()`,
en amont du hook, pour les deux rigs.

**(3) `rig.poseBody(y, pitch, roll, w)`.** Même problème, sur le tronc :
`shiba.js:518/521/525` écrit `body.position.y`, `.rotation.x` et `.rotation.z` en
absolu, avec des valeurs réglées pour l'anatomie procédurale — l'assise vaut
`y = −0.20` et `pitch = −0.30` sur un chien dont la chaîne de patte fait 0.52.
Sur 0.16, cet affaissement enfonce le chibi dans le sol. Défaut = les trois
écritures actuelles à l'identique.

Ce hook **remplace** le `rig.bobScale` de la version précédente, qui était un
piège : `bodyY` a déjà absorbé l'affaissement d'assise (`bodyY = mix(bodyY,
−0.20, sit)`) **avant** la ligne 518 ; un facteur multiplicatif aurait donc
amplifié l'assise en même temps que le rebond.

**(4) `rig.sole(leg)` → `THREE.Vector3` en **coordonnées monde**.** Le rig
procédural le tire de la bbox du mesh nommé `'paw'` ; le rig glTF, de la
géométrie skinnée :

```js
mesh.localToWorld( mesh.getVertexPosition(i, v) )   // i = vertex dominé par l'os paw
```

`SkinnedMesh.getVertexPosition()` applique bien la transform d'os, mais rend un
point dans l'espace **local du mesh** — pas monde, contrairement à ce
qu'affirmait la version précédente. Oublier le `localToWorld` donne un test qui
**passe sans rien mesurer** (une semelle à `y ≈ 0` comparée à un `shiba.position.y`
lui aussi proche de 0 au boot), ce qui est pire qu'un échec.

**(5) `rig.swimFloat`.** `SHIBA.swimFloat = 0.85` est la profondeur des pattes
sous la surface en nage. Le dos du chien procédural est à `0.990 × 1.35 = 1.336`
au-dessus des pattes : il sort de **0.486**, soit 36 % de sa hauteur de dos. Le
dos du chibi est à `0.650 × 1.35 = 0.878` : il ne sortirait que de **0.028** — le
chien nagerait à ras, presque submergé. Le rig porte donc sa propre valeur
(défaut `SHIBA.swimFloat`), et le glTF prend **≈ 0.56**, qui lui rend la même
proportion de dos hors de l'eau. À valider en nage.

Aucun autre changement de comportement dans `shiba.js`. `animate()` gagne cinq
lectures de hook et perd deux écritures directes ; la machine à états, les
empreintes, la nage, le secouage, les allures : intacts.

### Le squelette — 22 os, ancrages mesurés

`root` reste un `Group` ; **le `SkinnedMesh` et la racine d'os `tilt` sont tous
deux enfants de `root`**. C'est le seul montage correct : en `AttachedBindMode`
(le défaut), `mesh.position/rotation/scale` **n'a aucun effet visuel** — la
transform du mesh est annulée par `bindMatrixInverse`. Déplacer le chien passe
donc obligatoirement par le parent commun, ce que `shiba.js` fait déjà sur `root`.

`tilt.position.y = 0.360` — le **centre du tronc**, à mi-hauteur entre le ventre
(0.069) et la ligne de dos (0.650). Ce n'est pas `SHIBA_BUILD.standHeight` : ce
nombre appartient au rig procédural (somme de sa chaîne de patte) et n'a aucun
sens ici. Deux raisons de choisir le centre du tronc : les rotations de `body`
pivotent autour d'un axe naturel, et `body.getWorldPosition().y` — l'altitude
d'émission des gouttelettes — tombe au milieu du corps.

Hiérarchie et positions **locales** (unités de construction) :

```
root (Group)                          — possédé par shiba.js
├ SkinnedMesh 'shiba-body'            — transform identité, jamais touchée
└ tilt (Bone)      (0, 0.360, 0)
  └ body (Bone)    (0, 0, 0)                    [cumulé (0, 0.360, 0)]
    ├ neck         (0, +0.223, +0.124)          [cumulé (0, 0.583, +0.124)]
    │ └ head       (0, +0.117, +0.096)          [cumulé (0, 0.700, +0.220)]
    │   ├ jaw      (0, −0.140, +0.210)          [cumulé (0, 0.560, +0.430)]
    │   ├ lid ×2   (±0.097, +0.171, +0.219)     [cumulé (±0.097, 0.871, +0.439)]
    │   │            BIND : rotation.x = −0.32
    │   └ ear ×2   (±0.165, +0.337, −0.043)     [cumulé (±0.165, 1.037, +0.177)]
    │                BIND : rotation.x = −0.30, rotation.z = sign(x)·0.20
    ├ tailBase     (0, +0.093, −0.507)          [cumulé (0, 0.453, −0.507)]
    └ hip ×4       (±0.184|±0.243, −0.179, +0.193|−0.193)   [cumulé y = 0.181]
      └ knee       (0, −0.081, 0)                            [cumulé y = 0.100]
        └ paw      (0, −0.080, +0.010)                       [cumulé y = 0.020]
```

Ordre du tableau `bones` — il **définit** la sémantique de `skinIndex` et ne doit
jamais être réordonné sans reconstruire les poids :

```
0 tilt   1 body   2 neck   3 head   4 jaw   5 lidL   6 lidR   7 earL   8 earR
9 tailBase
10-12 hipFL kneeFL pawFL      13-15 hipFR kneeFR pawFR
16-18 hipBL kneeBL pawBL      19-21 hipBR kneeBR pawBR
```

**Les poses de bind ne sont pas décoratives.** `animate()` écrit sur certains os
une valeur **non nulle au repos** ; si l'os est bindé à l'identité, cette valeur
devient une déformation permanente. Deux cas, et ils se traitent pareil :

- `lids` — `shiba.js:621` écrit `mix(-0.32, 0.58, blink)` : au repos **−0.32**.
- `ears` — `shiba.js:596-600` écrit `landEarX = -0.30 + 0.34·speedN + flick` et
  `landEarZ = side·(0.20 + 0.10·gust)` : au repos **`x = −0.30`, `z = side·0.20`,
  `y = 0`**.

Ces valeurs vont dans la pose de bind, **avant** le `updateMatrixWorld(true)` de
l'étape 5 — sinon les `boneInverses` capturent l'identité et le correctif est
nul. Piège à ne pas commettre : ne **pas** recopier la pose d'auteur du rig
procédural (`shiba-geom.js:568-573`, `rot = (−0.44, side·0.22, side·0.18)`), qui
est écrasée en vol par `animate()` et n'a donc jamais été la pose de repos réelle.

`jaw` est un vrai os, **sans un seul vertex sous son influence** : la gueule est
peinte dans la texture, il n'y a pas de mâchoire à ouvrir. Il reste dans le
tableau pour ne pas décaler les `skinIndex`, et `animate()` continue d'écrire
`jaw.rotation.x` sans effet visible. Perte assumée, pas oubli.

### Les poids — distance au segment, portes chiffrées

Pour chaque vertex `v` et chaque os `b` porteur d'un segment `[b, parent(b)]` :

```
d      = distance(v, segment_b)
w_raw  = gate_b(v) / (d + ε)^p        p = 4,  ε = 0.023  (2 % de la hauteur)
```

On garde les **4 plus gros** — à égalité, le plus petit indice d'os gagne, pour
que le résultat soit déterministe —, on normalise à somme 1, et
`normalizeSkinWeights()` sert de filet. Les influences inutilisées reçoivent
`skinIndex = 0, skinWeight = 0` — **jamais un indice invalide** : les 4 termes
sont toujours évalués par le shader, et un seul fetch pathologique donne un `NaN`
qui détruit le vertex.

**Deux os sortent de la boucle.** `tilt` (indice 0) n'a pas de segment — son
parent est un `Group` — et sert de valeur de remplissage des influences nulles.
`body` est à `(0,0,0)` dans `tilt` : son segment serait un point, et un point
attire de façon isotrope. Il prend donc pour proxy le **segment de rachis**
`(0, 0.583, +0.124) → (0, 0.453, −0.507)`, c'est-à-dire l'axe cou → queue.

`gate_b(v)` est le cœur du problème. Sans porte, une patte gauche aspire la patte
droite (0.37 u d'écart pour un os de 0.16), et surtout les os les plus animés
capturent le crâne. **Les portes sont des `smoothstep`, pas des coupures
binaires** — une coupure franche laisse une couture visible sur un mesh lisse.

| os | porte |
|---|---|
| `hip`, `knee`, `paw` | `smoothstep(0, 0.10, ±x)` selon le côté × `smoothstep(0.42, 0.26, \|z − z_hanche\|)` × `smoothstep(0.34, 0.20, y)` |
| `head` | `smoothstep(0.00, 0.18, z)` |
| `neck` | `smoothstep(−0.15, +0.05, z)` × `smoothstep(0.36, 0.16, z)` × `smoothstep(0.22, 0.40, y)` |
| `ear` ×2 | `smoothstep(0, 0.06, ±x)` selon le côté × `smoothstep(0.90, 1.05, y)` |
| `tailBase` | `smoothstep(−0.30, −0.50, z)` |
| `jaw` | **0** — aucun vertex |
| `lid` ×2 | **0** — aucun vertex par distance |
| `body` | **1** partout — c'est le réceptacle par défaut |

Le terme vertical de la porte du cou n'est pas ornemental : les appuis avant sont
à `z = +0.193`, en plein dans sa bande longitudinale. Sans lui, le cou tirerait
les pattes avant.

`jaw` et `lids` à porte nulle **corrigent une auto-contradiction** de la version
précédente, qui leur donnait la porte du museau une ligne après avoir écrit
qu'ils n'auraient aucun vertex. Conséquences mesurées de cette erreur : les
paupières, qui basculent de 0.90 rad plusieurs fois par 10 s, se disputaient le
sommet du crâne avec les oreilles — le visage se serait froissé à chaque
clignement.

Deux affectations **dures**, qui court-circuitent le calcul :

- **le collier** (les 272 vertices de `Group18985`) → 100 % `neck` ; il doit
  suivre le cou comme un objet rigide, pas se déformer.
- **les yeux** (les 130 vertices d'`Object001`, séparés en deux par le signe de
  `x`) → 100 % `lidL` / `lidR`.

Un vertex dont **toutes** les portes valent 0 n'existe pas : `body` vaut 1
partout. C'est ce qui garantit qu'aucun vertex ne se retrouve à somme nulle —
donc aspiré vers l'origine.

### Le clignement récupéré

Les yeux sont un **mesh séparé** — la seule bonne surprise de l'asset. On peut
donc rendre le clignement qu'un swap brut aurait perdu.

Chaque bille est liée à 100 % à son os `lid`, dont le pivot est posé sur
l'**arête supérieure** de la bille (`y = 0.871` ; la bille fait 0.128 de haut
après échelle). Les os `lid` étant bindés à `rotation.x = −0.32`, le repos est
l'identité et le clignement est une bascule de **0.90 rad autour d'une charnière
haute**, qui enfonce la bille dans le crâne : le bas de la bille recule de 0.100
et monte de 0.048, il passe sous la surface du front.

**À valider visuellement, en gros plan.** Si ça lit comme un œil qui pivote
plutôt que comme une paupière, on met l'influence des `lid` à zéro et le
clignement redevient un no-op, comme `jaw`. Pari à faible coût, pas une promesse.

### Les pièges three.js r185 qui tuent en silence

Vérifiés sur les sources taguées `r185`. Chacun produit un résultat faux **sans
une seule erreur console**.

1. **`skinIndex` en `Uint16` avec `normalized: true`** → tous les indices
   deviennent ≈ 0, **le chien entier se colle à l'os 0**. Il faut
   `Uint16BufferAttribute(si, 4)` avec `normalized = false`.
2. **`Σw ≠ 1`** : le shader ne normalise pas. `Σw = 0.5` dégonfle le mesh vers
   l'origine ; `Σw = 0` étire les triangles en éventail vers `(0,0,0)`.
3. **`Skeleton(bones)` lit `bones[i].matrixWorld`** : `tilt.updateMatrixWorld(true)`
   **avant** de construire le squelette, sinon les `boneInverses` sont faux — et
   les poses de bind des `lids`/`ears` sont perdues.
4. **`bind(skeleton)` sans second argument appelle `calculateInverses()` et
   écrase les inverses.** On passe donc un `bindMatrix` **identité explicite** —
   le mesh est à l'identité dans `root`, exactement ce que fait `GLTFLoader`.
   Bénéfice : le bind ne dépend plus de l'insertion dans la scène.
5. **`frustumCulled = false` sur le `SkinnedMesh`.** `Frustum.intersectsObject`
   appelle `computeBoundingSphere()` **une seule fois** et ne l'invalide jamais :
   la sphère reflète la pose de la première frame, et le chien — ou seulement son
   ombre — **clignote ou disparaît** dès qu'il s'anime hors d'elle.
6. **`material.skinning` n'existe plus depuis r129.** Le define `USE_SKINNING`
   vient de l'objet (`object.isSkinnedMesh`), pas du matériau. Corollaire : les
   ombres marchent sans rien configurer, et le `customDepthMaterial` des vieux
   tutoriels est du code mort.
7. **`mergeGeometries` rend `null` + `console.error`, il ne lève pas.**
8. **Jamais de scale non uniforme sur un os** : three applique la `skinMatrix`
   elle-même à la normale, pas son inverse-transposée. Un squash/stretch
   inclinerait l'éclairage sur les zones étirées.
9. **`root.scale.setScalar(1.35)` est posé APRÈS le bind**, par `shiba.js:246`.
   C'est correct en `AttachedBindMode` : `bindMatrixInverse` est recalculé chaque
   frame depuis `matrixWorld`, la transform du mesh s'annule, et l'échelle passe
   par les `matrixWorld` des os. Ne pas « corriger » ce qui n'est pas cassé.

Coût : **2547 vertices skinnés**, ≈ 5100 invocations vertex avec la passe
d'ombre. Le seul coût CPU est `Skeleton.update()` — 22 matrices et un upload de
texture d'os de 2.3 Ko par frame (12 × 12 RGBA float). Contre 2.66 M de brins
d'herbe en ultra, c'est du bruit.

---

## Le cycle de marche sur des moignons

C'est le vrai risque du chantier, et il est géométrique.

| | procédural | glTF |
|---|---|---|
| hanche au-dessus du sol | 0.560 av. / 0.600 arr. | **0.181** |
| chaîne `hip→paw` | 0.522 av. / 0.562 arr. | **0.161** |
| garde au sol du ventre | 0.474 | **0.069** |

Les amplitudes de `GAITS` ont été réglées pour la première colonne : hanche
0.30 rad en marche, 0.62 en trot, 0.95 en galop, genou ×1.20 à ×1.55, nage à
1.34 rad, **assise à −0.85 de hanche et +1.95 de genou**, tronc à `y = −0.20` et
`pitch = −0.30`. Appliquées telles quelles à une chaîne **3.2 fois plus courte** :

- le pas devient invisible — 0.62 rad déplace le pied de 0.095 u contre 0.303 ;
- le genou à 1.47 rad replie la partie basse **dans** la haute (os de 0.081) ;
- l'assise à 1.95 rad de genou est géométriquement impossible, et l'affaissement
  du tronc de 0.20 enfonce un chien dont le ventre est à 0.069 du sol.

`rig.poseLeg` et `rig.poseBody` sont là pour ça. Points de départ à régler au
visuel, et à consigner dans `shiba-gltf.js` avec les mesures qui les ont produits :

```js
poseLeg(leg, hip, knee, { sit }) {
  leg.hip.rotation.x  = hip  * mix(1.30, 0.55, sit);
  leg.knee.rotation.x = knee * mix(0.40, 0.18, sit);
},
poseBody(y, pitch, roll, { sit }) {
  // 1.6 sur le rebond : le pas se lit par le corps. Mais l'assise est un
  // affaissement ABSOLU, et 0.20 sur un ventre à 0.069 enterre le chien.
  rig.body.position.y = mix(y * 1.6, -0.045, sit);
  rig.body.rotation.x = mix(pitch,   -0.12,  sit);
  rig.body.rotation.z = roll;
}
```

Ces nombres sont des **hypothèses de départ mesurées**, pas des constantes
d'art — ils se valident à l'écran, en marche, en course, en nage et en assise.

Ce qui **ne** change **pas** : les phases, les portes de transition entre
allures, la courbe de contact qui pilote empreintes et gerbes, la nage en trot
diagonal. Le rythme du chien est bon ; seule son anatomie change.

---

## Ce que ça touche ailleurs

| Fichier | Changement |
|---|---|
| `src/shiba-gltf.js` | **nouveau** — chargement, normalisation, squelette, poids, `SkinnedMesh` |
| `src/shiba.js` | `createShiba({ body })` ; les cinq hooks optionnels ; le `mix` de secouage remonte en amont de `poseLeg` ; `dispose()` libère matériau + texture ; en-tête corrigé (la doctrine « no glTF » y est écrite) |
| `src/shiba-geom.js` | `buildBody` pose `rig.material` (le matériau qu'il reçoit) et ajoute `rig.sole(leg)` ; `parts` existe déjà et ne bouge pas. Le commentaire l.823-824 (« il reste un mesh nommé exactement `paw` … l'invariant 12 le retrouve par son nom ») devient faux et doit être reformulé : c'est `rig.sole` que l'invariant consomme désormais. **Rien n'est supprimé : c'est le repli.** |
| `src/main.js` | `await loadShibaBody()` dans le bloc `step('shiba')` (main.js:469-491), avant `createShiba` ; `try/catch` → `body: null` en cas d'échec |
| `assets/shiba/shiba.glb` | **nouveau** — premier binaire versionné du dépôt |
| `assets/shiba/LICENSE.txt` | **nouveau** — attribution CC-BY-4.0 |
| `index.html` | ligne de crédit dans le `.hint` du panneau |
| `test/invariants.html` | un `await` en tête du bloc chien ; invariant 12 joué deux fois ; 5 invariants ajoutés |
| `AGENTS.md` | doctrine, asset, licence, et le compte d'invariants (il annonce encore 16 pour 21 réels) |
| `REPRISE.md` | entrée de session |

L'`await` s'insère **dans le bloc `shiba`, juste après `await step('shiba')`**.
`boot()` est déjà `async` et déjà interrompue par 13 `await step(...)` ; un point
de suspension de plus au même endroit ne viole aucun ordre documenté (le chien
est le tout dernier système construit, et rien avant lui ne lit `world.shiba`).
`veil` ne disparaît qu'à `main.js:509` : le chargement se déroule sous le voile.

**Largeur du chien : rien ne s'y adosse.** Vérifié — `passable()` teste le
terrain et l'eau à un point, pas une emprise ; la largeur des chemins n'entre
dans aucun test de collision du chien ; l'invariant 14 (« nageable ET
franchissable ») borne une bande de gué contre `SHIBA.swimDepth`, une profondeur,
pas une largeur. Les 53 % de plus sont un fait visuel sans conséquence de code.

---

## Vérification

### Invariants — de 21 à 26

Le harnais est **100 % synchrone** aujourd'hui : aucun `await`, aucun `fetch`.
Le résumé `INVARIANTS: N pass, 0 fail` est imprimé à la fin de l'évaluation
top-level — un `check` fait dans un `.then` s'ajouterait **après** le résumé sans
être compté, et un rejet ne serait vu que par le `unhandledrejection` de la l.34,
**qui n'incrémente pas `fail`**. Le module est un module ES : le top-level await
est le seul montage correct. Un `await` unique, en tête du bloc chien, garde tout
le reste dans le même flot séquentiel.

Trois précautions, sinon le harnais **ment en vert** :

- l'URL depuis `test/` est **`'../assets/shiba/shiba.glb'`** ;
- le `await` est dans un `try/catch`, et le tout premier `check` du bloc est
  `check('asset glTF chargé', rig !== null, cause)`. Un asset absent doit
  **échouer**, pas être sauté : le compte reste fixe à 26 ;
- si le rig est `null`, les invariants 22 à 26 comptent chacun un `fail` avec le
  même motif, plutôt que de laisser la page imprimer `21 pass, 0 fail` en vert
  alors que rien du chantier n'a été testé.

**Invariant 12, joué deux fois.** Aujourd'hui il cherche `o.isMesh && o.name ===
'paw'` : avec un `SkinnedMesh` unique il n'y a plus de mesh `'paw'`, `lowest`
resterait `Infinity` et le test échouerait pour une mauvaise raison. Il passe
donc par `rig.sole(leg)` — **en coordonnées monde pour les deux rigs** — et
tourne :

- **sans `body`** (repli procédural), seuil 0.09 inchangé : c'est le gardien de
  `SHIBA_BUILD`, et rien ne doit le desserrer ;
- **avec le corps glTF**, seuil 0.09 également. Ne pas le serrer à 0.01 sous
  prétexte que la normalisation pose les semelles à `y = 0` : la semelle mesurée
  est celle du vertex **skinné**, pas celle du repos, et le chien est posé sur un
  terrain interpolé.

Cinq invariants nouveaux :

22. **Contrat complet** — `root`, `tilt`, `body`, `neck`, `head`, `jaw`,
    `lids[2]`, `ears[2]`, `tailBase`, `legs[4]` avec `{front, hip, knee, paw}`,
    `parts` itérable, `material`. `legs` dans l'ordre **FL, FR, BL, BR** :
    `legs[0].front && legs[1].front && !legs[2].front && !legs[3].front`, et
    `legs[0].hip.position.x` de signe opposé à `legs[1]` — c'est ce qui rend les
    diagonales du trot correctes.
23. **Échelle et pose.** Attention aux unités : `rig.sole()` et
    `getWorldPosition()` rendent du **monde**, donc `1.35 ×` les unités de
    construction de cette spec (`root.scale`). Les trois clauses, avec `heading = 0` :
    - **milieu des appuis** —
      `((sole(FL).z + sole(BL).z) / 2) − shiba.position.z` dans `± 0.03`
      (soit ± 0.02 en construction). C'est le recentrage `Δz` qu'on revérifie, et
      il faut la **même définition que la mesure** : `sole` rend le vertex de
      contact, pas un centroïde de tranche épaisse.
    - **orientation +Z** — `head` a un `z` monde supérieur à `tailBase`.
    - **dos hors de l'eau** — `max(y) des vertices dominés par l'os body`, en
      monde et relatif à `shiba.position.y`, doit dépasser
      `rig.swimFloat + 0.03`. C'est la version *rig* de l'invariant 11, qui lui
      ne teste que des constantes et laisserait passer un chibi submergé.

    La hauteur des semelles n'est pas testée ici : c'est exactement l'invariant
    12, et le dupliquer avec un seuil plus serré ne ferait que créer un second
    gardien qui échoue en premier pour la même raison.
24. **Poids bien formés** — pour chaque vertex `|Σw − 1| < 1e−4` ; aucun poids
    négatif ; tout `skinIndex` dans `[0, nBones)` ; toute influence de poids nul
    porte l'indice 0.
25. **Rig non dégénéré** — chaque os de patte domine ≥ 20 vertices ; `head`,
    `neck`, `tailBase` et chaque `lid` ≥ 10 ; `jaw` en domine **exactement 0**
    (c'est la version testable de « aucun vertex sous son influence »). `tilt`
    est exclu du test : il est structurel.
26. **Non-explosion et latéralité.** Les 12 poses sont posées **directement sur
    les os**, via `rig.poseLeg` / `rig.poseBody` — `animate()` est privée du
    closure de `createShiba` et n'est pas une API de test ; on ne duplique pas sa
    formule non plus. Aucun vertex skinné ne s'éloigne de plus de **0.35 u** de
    sa position de repos (soit 25 % de la longueur du chien : au-delà, c'est une
    membrane, pas une déformation) et la bbox reste sous 2× celle du repos. Et
    aucun vertex à `x > +0.02` ne reçoit de poids d'un os de patte gauche
    (symétriquement) — c'est le test qui garantit que les pattes ne se collent
    pas.

    | # | pose |
    |---|---|
    | 1 | repos |
    | 2-4 | marche / trot / galop, phase 0 |
    | 5-7 | marche / trot / galop, phase π |
    | 8 | nage, hanche à l'amplitude max (1.34 rad) |
    | 9 | assise pleine (`sit = 1`) |
    | 10 | secouage à mi-course (`shake = 0.5`, roll max) |
    | 11 | galop phase π + tête tournée à fond + queue à fond |
    | 12 | assise + clignement fermé + oreilles en arrière |

Cible : **`INVARIANTS: 26 pass, 0 fail`**, en `low` **et** en `?q=ultra`.
Le harnais doit être servi par `serve.py` (jamais `python -m http.server`) —
c'est désormais une contrainte dure et non plus une habitude, puisqu'il y a un
`fetch`.

### Visuel

Le chien est le sujet ; les captures se font en vue rapprochée, pas au cadrage
d'ouverture.

- **Marche, course, virage** : les pattes bougent-elles assez pour lire ? le
  corps ne glisse-t-il pas ? les épaules et les hanches ne se pincent-elles pas ?
- **Nage** en étang, entrée et sortie de l'eau : le dos sort-il vraiment
  (c'est `rig.swimFloat` qu'on valide là) ?
- **Assise** après 4.2 s d'immobilité — la pose la plus exposée, et celle dont
  les trois nombres de `poseBody` dépendent.
- **Secouage** (sortie d'eau) : la pose neutre braquée doit rester propre, et les
  gouttelettes partir du milieu du corps.
- **Gros plan sur la tête** : le clignement lit-il comme une paupière ? le crâne
  reste-t-il immobile pendant ?
- **Midi (0.5) et nuit (0.97)** : la texture est *baked* avec un ombrage doux et
  un peu d'occlusion. Elle peut aplatir le couchant ou paraître trop claire la
  nuit. Réglage par `roughness` — qui existe bel et bien, maintenant que le
  matériau est un `MeshStandardMaterial` construit à la main.
- **Ombre portée** présente et suivant la pose (si elle disparaît : piège n°5).
- Les trois tiers `?q=low|high|ultra` — le chien est identique aux trois.

### Performance

Protocole du piège n°9 d'`AGENTS.md`, sans exception : `__sk.setCamMode('orbit')`,
`autoRotate = false`, `enableDamping = false`, resynchronisation par
`gl.readPixels` après chaque frame, dérive de caméra vérifiée nulle.

Attendu : **aucune différence mesurable**. Le chien passe de 7304 triangles en 33
draw calls à 4316 triangles en 1 draw call — c'est un gain. Si les fps bougent de
plus de 1, c'est un symptôme, pas un résultat : chercher du côté de
`frustumCulled` et de la shadow map.

Poids ajouté au chargement : ~890 Ko de `.glb`, servi en `no-store`, donc
retéléchargé à chaque reload. Sur un boot ultra de ~20 s c'est négligeable.

---

## Hors périmètre (YAGNI)

- **Pas de sélecteur `?dog=`.** Le repli est un filet, pas une option.
- **Pas de `quality` sur le chien.** 4316 triangles ne justifient pas un LOD.
- **Pas d'`AnimationMixer`.** Le glTF n'a aucun clip.
- **Pas de morph targets, pas de mâchoire, pas de langue.** La gueule est peinte.
- **Pas de bump map de poil.** `makeCoatBump()` existe, n'a jamais été branchée,
  et le glTF a sa propre texture.
- **Pas de correction de `LOAD_STEPS`** (11 déclarés pour 13 `step`, la barre
  monte à ~118 %). Défaut réel, constaté, sans rapport avec ce chantier.
- **Pas d'extension du MIME de `serve.py`.** Le `.glb` autonome n'en a pas besoin.

## Ordre des chantiers

1. **Empaquetage de l'asset** — récupération, vérification des trois sha256,
   réduction de texture, `.glb`, `LICENSE.txt`. Préalable qui rend le reste
   testable.
2. **`shiba-gltf.js`** — chargement, normalisation, squelette, poids, bind.
   Vérifié isolément par les invariants 22 à 26 **avant** d'être branché.
3. **Élargissement du contrat dans `shiba.js` / `shiba-geom.js`** — les cinq
   hooks. Le chien procédural doit continuer de tourner à l'identique : c'est la
   première chose à revérifier, et le `mix` de secouage déplacé est le point le
   plus facile à casser.
4. **Câblage `main.js` + repli**, puis réglage visuel des nombres de `poseLeg`,
   `poseBody` et `swimFloat`.
5. **Invariants** (12 joué deux fois, 22-26 ajoutés), `low` et `ultra`.
6. **Doc** : `AGENTS.md`, en-tête de `shiba.js`, commentaire `shiba-geom.js:823`,
   `REPRISE.md`.
7. **Review adversariale** via le skill `codex:adversarial-review`, rapport dans
   `ADVERSARIAL_REVIEW_CLAUDE.md` sous l'id `ADV-2026-08-05-SHIBA-GLTF`.

---

## Ce que la critique a changé

Quatre relecteurs adversariaux (arithmétique, three.js r185, contrat, complétude)
ont signalé 75 défauts sur la première version ; 36 ont survécu à une passe de
réfutation. Les six qui ont changé le design, et pas seulement un chiffre :

1. **L'asset est `KHR_materials_unlit`** — `GLTFLoader` rend un
   `MeshBasicMaterial`. Les réglages `roughness`/`metalness` annoncés étaient
   deux no-op silencieux, et le chien aurait cessé de recevoir les ombres et de
   suivre le cycle jour/nuit.
2. **`k = 0.83` avait une fausse seconde justification** : `standHeight` est la
   somme de la chaîne de patte, pas la ligne de dos. `k = 0.823`, une contrainte.
3. **Le chibi nagerait submergé** — dos à 0.028 hors de l'eau contre 0.486 pour
   le chien procédural. D'où `rig.swimFloat`, cinquième hook.
4. **La table des portes contredisait le texte** : `jaw` et `lids` recevaient la
   porte du museau une ligne après qu'on ait écrit qu'ils n'auraient aucun
   vertex. Le visage se serait froissé à chaque clignement.
5. **Le défaut de `poseLeg` perdait le `mix` de secouage** — un implémenteur
   fidèle aurait fait régresser le chien procédural. Et `bobScale` amplifiait
   l'affaissement d'assise ; il devient `poseBody`.
6. **`getVertexPosition()` rend du local, pas du monde** — l'invariant 12 réécrit
   serait passé sans rien mesurer.

Les corrections de chiffres, elles, portaient sur : le recentrage (`Δz` dépendait
d'un seuil jamais énoncé), la partition des vertices (2759 annoncés pour un mesh
de 2145), le compte skinné (2547 et non 2145), la garde au sol du ventre
(mesurée sous la croupe et non entre les trains), la base d'oreille, et
l'attribution de l'étalon métrique.
