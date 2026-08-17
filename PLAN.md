# Sakurajima — état des lieux et reste à faire

Île 3D en three.js couverte de cerisiers (ou d'érables momiji en automne), vent
en bourrasques qui emporte les pétales et couche l'herbe, cycle jour/nuit complet,
relief et rochers, étangs à carpes koi, oiseaux, nuages, réseau de chemins
lanternés avec torii, shiba jouable. Deux saisons : `?season=spring|autumn`,
choix persistant, tout est recolorié à la construction.

**Machine cible :** Apple M4 Max, 32 cœurs GPU → budgets calibrés généreusement.
**three.js 0.185.1** vendorisé dans `vendor/three/` (importmap local), aucun build step.

---

## Lancer

```sh
python3 serve.py 5173      # serveur no-store + charset utf-8 (indispensable, voir plus bas)
open http://127.0.0.1:5173/index.html
```

Bancs d'essai isolés : `test/invariants.html` (le juge de paix — `0 fail`,
N imprimé), `test/petals.html`, `test/season.html`, `test/ground-palettes.html`,
`test/atmosphere.html`.

---

## Fait

| Module | État | Notes |
|---|---|---|
| `src/noise.js` | ✅ écrit à la main | PRNG mulberry32 + flux indépendants par sous-système, bruit gradient, fbm, ridged, domain warp. **Source de vérité unique** pour la hauteur du terrain. Validé numériquement sous node. |
| `src/wind.js` | ✅ écrit à la main | Modèle en **train de rafales** : accalmies réelles, bourrasques qui montent et retombent, cap en marche aléatoire avec embardées, fronts qui traversent l'île. Implémentations JS et GLSL jumelles. |
| `src/petals.js` | ✅ écrit à la main | ~12k pétales instanciés, animation 100 % vertex shader, culbute sur axe précessant, silhouette échancrée procédurale, demi-Lambert pour la translucidité. **Validé en navigateur**, shader compile. |
| `src/config.js` | ✅ | Toutes les constantes d'art direction + presets qualité low/high/ultra. |
| `index.html` | ✅ | Voile de chargement, HUD horloge/perf, panneau de réglages, capture des erreurs fatales. |
| `serve.py` | ✅ | Serveur de dev `no-store` + `charset=utf-8`. |
| `src/island.js` | ✅ | Terrain, côte organique, rochers, océan. L'enroulement du disque d'océan était inversé — voir `REPRISE.md` #1. |
| `src/sakura.js` | ✅ | 5 archétypes d'arbres. Attention à ses noms d'options : `isLand`, `windUniforms`, `quality` **numérique**. |
| `src/grass.js` | ✅ | Herbe instanciée. Hook `exclude` ajouté pour la garder hors de l'eau. |
| `src/sky.js` | ✅ | Cycle jour/nuit. Le gain du dôme est keyframé, pas constant. |
| `src/ponds.js` | ✅ | Étangs, carpes koi, nénuphars. (La rivière et le pont ont été SUPPRIMÉS le 29/07 sur décision utilisateur — ne pas réintroduire.) |
| `src/details.js` | ✅ | Fleurs sauvages, réseau de 4 routes (`PATHS`), torii, lanternes générées le long des routes, galets. Exporte `isOnPath`/`initPath`. |
| `src/bamboo.js` | ✅ | Bosquet instancié à l'est (lot 8), vent partagé. |
| `src/detailtex.js` | ✅ | Bump maps générées (grain sol/roche, veinage bois), zéro texture externe. |
| `src/season.js` | ✅ | Résolveur pur de saison : URL → localStorage → `spring`. |
| `src/seasonal-foliage.js` | ✅ | Profils de feuillage partagés sakura/momiji (silhouette, dominantes, palettes) pour couronnes, feuilles en vol et tapis. |
| `src/birds.js` | ✅ | Vol en boids, perchoir nocturne, `setRepeller` pour le shiba. |
| `src/clouds.js` | ✅ | Cumulus proches à parallaxe, dérivant avec le vent partagé. |
| `src/shiba.js` | ✅ | Le personnage jouable. Voir §5. |

---

## Chantiers ouverts du 30/07 (feedback joueur, captures à l'appui)

Implémentation déléguée à **Codex gpt-5.6-sol** (sous-agent `codex-rescue` du
plugin — vérifié prêt et authentifié le 30/07) pour économiser le quota du
modèle principal ; brief précis + review Claude entre chaque chantier.
Un chantier à la fois. Grok CLI toujours non authentifié.

- **C — Chemins** — **SOLDÉ le 31/07** (`756e0b2`, puis `ae2bd1c`). Perforations
  et carrefour réglés dès `756e0b2` ; il a fallu deux tentatives de plus pour
  que le ruban COLLE au sol (le feedback « il est surélevé » venait de
  l'anti-perforation elle-même). Solution finale : dégagement itératif par
  triangle, aucune sonde de voisinage — voir REPRISE et le contrat dans
  AGENTS.md. Ne pas réintroduire de max ni de résidu sur un voisinage.
- **E — Autel de divinité canine** — **SOLDÉ le 30/07** (`e16631b`) : hokora de
  pierre + deux gardiens canins au bout de la route 'torii', sur la terrasse.
- **F — Autel enrichi** — **SOLDÉ le 01/08** : grain de pierre (`makeGrainBump`
  + UV planaires), patine par PIXEL en fragment shader (mousse en taches,
  coulures, lichen), mobilier de culte (offrandes, shimenawa, shide, tuiles),
  komainu a-un. Voir REPRISE pour les trois pièges (patine par sommet
  impossible sur des boîtes, `bumpScale` mort à 0.20, `patch` réservé en GLSL).
- **A — Arbres automne** — **SOLDÉ le 30/07** (`964f282`) : `foliageDensity`
  automne 3.6/2.8/2.0, feuilles maple +15 %, branches plongeantes redressées
  (pas supprimées — flux RNG préservé), silhouettes printemps intactes.
- **B — Tapis de feuilles au sol** — **SOLDÉ le 31/07** (`8bcd892`) : ×2.5
  (480 928 instances ultra), tailles 0.34-0.62, quad élargi, 34 % dispersées
  hors couronnes, plus aucune feuille verte tombée ni en vol, printemps
  strictement inchangé.
- **D — Perf générales / LOD** — **SOLDÉ le 31/07** (`f558ee3`, `97cfc7f`,
  `0de1818`), sans aucune perte de qualité graphique.
  - Les chiffres de référence du 30/07 (« ~40 fps ») étaient **faux** : mesurés
    sans resynchronisation GPU et avec une caméra qui dérivait. Voir pièges 9 et
    10 d'AGENTS.md — c'est la leçon principale du chantier.
  - Étalon refait : printemps ultra 15.4 fps à l'ouverture, 21.4 au sol. Le
    feuillage forêt est **88 %** du temps de frame en vue large et **75 %** au
    sol, pour 50.1 M quads. Rien d'autre ne pèse (herbe 13 % au sol, passe
    d'ombre 4-7 %, tapis/pétales/détails/nuages ≤ 3 %).
  - Trois leviers appliqués : buckets 6×6 → 16×16 (culling plus fin), attributs
    d'instance 44 → 18 o (2 102 → 860 Mo de VRAM), éclaircissage par distance à
    couverture constante (`1/√f`) sur instances mélangées par blocs de 64.
  - Résultat : **ouverture 15.4 → 33.7 fps (×2.2)**, sol 21.4 → 24.6 (+15 %),
    automne 59 / 49.3. L'objectif « ≥ 55 fps au sol » n'est PAS atteint et ne
    l'était pas atteignable ainsi : au sol le feuillage proche est à `f = 1` par
    conception, c'est le prix de l'absence de perte visuelle.
  - `LOD_MIN_FRACTION = 0.30`, arbitré par l'utilisateur sur comparaison A/B à
    trois états (référence 50.1 M pétales / 0.45 / 0.30, même chargement, même
    caméra). Le premier jugement « 0.30 lisse la canopée » avait été porté avec
    `FOLIAGE_SHUFFLE_BLOCK = 256` ; à 64 l'écart se referme largement.
  - Reste ouvert : impostors/billboards du lointain (gros chantier) ; chunking du
    tapis ; resserrage des anneaux LOD herbe. Écarté : réduire le far plane
    (l'horizon dégagé est un choix d'AD), baisser le DPR (ne rapporte rien,
    piège 10).

## Reste à faire, par priorité

### 1. La couture mer/ciel au coucher du soleil (0.78–0.84)
**SOLDÉ le 16/08.** Le dôme printemps n'avait pas de bande `uHorizonFog` (réservé
à l'automne golden). Preetham passait au bleu dès le soleil sous l'horizon
pendant que brouillard / pigment mer restaient saumon. Correctif : courbes
fog/hemi accélérées après `u=0.75`, bande horizon printemps seulement soleil
bas, mer tirée vers `fogColor` au loin, `phase.day` pour le lerp NIGHT/DAY.

### 2. Les nuages au crépuscule virent au marron sale
**SOLDÉ le 16/08** (même passe). L'underlighting `uKeyColor` orange × ambient
sol brun au `lowSun` donnait de la boue. La clé de crépuscule mélange désormais
vers ciel/brouillard.

### 2bis. Constats de la passe du 30/07 qui n'appellent PAS de correctif
- fps ultra printemps ≈40 (vue large et sol) — conforme au «~41 fps» documenté,
  les 48 M de fleurs n'ont rien coûté de plus.
- Oiseaux : le perchoir nocturne fonctionne ; si on téléporte `dayTime` en
  pleine nuit ils mettent ~1 min simulée à converger — artefact de test, pas
  un bug.
- Halo solaire très large et brûlé au lever/coucher bas (deux saisons, ~1/4 du
  cadre en plein contre-jour). État de base, pas une régression automne — à
  trancher comme choix d'art direction si ça gêne.
- Eau des étangs printemps à la golden hour : brun kaki plat, ne prend pas la
  lumière chaude (l'aube automne, lilas, est belle). Niveau goût, pas cassé.

### 3. La bande grise au zénith
**SOLDÉ le 16/08.** Le cadrage d'ouverture (fov 42°, look ~19° vers le bas)
mettait le haut du cadre sur la brume d'horizon Preetham. `CAMERA.start.y`
78·L·0.86 et `target.y` 14 : look ~13°, le ciel du haut de cadre est du ciel.

### 4. Le shiba, second passage
Aboiement / secouement / regard lieux : lot 6. **SOLDÉ le 16/08** le reste :
collision des fûts (`trunkHits` / `forest.hitsTrunk`, pas la couronne) ; regard
vers un pétale **volant** (`nearestAirbornePetal`, rayon 6). Pas la 3ᵉ saison.

### 4bis. Une troisième saison ?
Le contrat de saison est générique (résolveur pur, palettes à la construction,
feuillage partagé) et l'automne fournit un précédent complet à imiter, bancs
d'essai compris. Hiver (yuki) ou été seraient un chantier bien calibré — sur
demande explicite seulement.

### 5. Le shiba, tel qu'il a été construit  🐕

`src/shiba.js` → `createShiba({ seed, heightAt, slopeAt, normalAt, isInPond, wind, seaLevel })`

Maillage 100 % procédural, aucune texture, aucun asset : des tubes effilés
balayés le long de courbes tracées à la main, peints par sommet, suspendus à une
hiérarchie d'`Object3D` que quelques sinusoïdes animent. Un shiba tient
entièrement dans sa silhouette et dans deux couleurs — queue enroulée **sur** le
dos, oreilles triangulaires petites et portées vers l'avant, museau court et
carré, et le crème *urajiro* sous la mâchoire, le poitrail, le ventre et la queue
contre un manteau roux. Sans ces quatre choses, c'est un renard.

Il est construit à **environ deux fois la taille réelle** (`SHIBA.scale`) : à
l'échelle vraie il fait 0.4 unité au garrot, soit moins qu'un brin d'herbe (0.55),
et il disparaît dans le pré depuis n'importe quelle caméra qui cadre aussi l'île.

- **Contrôleur** : ZQSD/WASD + flèches, `Maj` pour courir. Les touches sont lues
  par `event.code`, donc la même poignée de lignes couvre AZERTY et QWERTY sans
  table de correspondance. Déplacement relatif à la caméra.
- **Terrain** : il se colle au sol via `heightAt`, s'incline **partiellement**
  vers la normale (0.42 vers la verticale — un quadrupède garde son corps bien
  plus horizontal que le sol sous lui), refuse les pentes au-delà de 0.72, refuse
  l'eau profonde mais barbote jusqu'à 0.34 sous le niveau de la mer, et **glisse**
  le long de ce qui le bloque au lieu de s'y coller.
- **Vie** : il s'assoit après 4 s d'immobilité (fondu, pas un claquement de
  doigts), sa queue s'agite d'autant plus vite qu'il vient de courir, ses oreilles
  se couchent à la course et frémissent dans les rafales du vent partagé.
- **Empreintes** : `InstancedMesh` en tampon circulaire, date de naissance par
  instance, fondu dans le fragment shader. Uniquement dans le sable mouillé —
  une empreinte dans l'herbe ne se voit pas et sur le roc elle est fausse.
- **Caméra** : `C` bascule entre la caméra de contemplation (OrbitControls) et
  une caméra tierce personne qui traîne derrière lui, se recale d'elle-même dans
  son dos, et se maintient au-dessus du relief.
- Les oiseaux reçoivent sa position via `birds.setRepeller()` à chaque frame.

### 6. Peaufinage
**SOLDÉ le 16/08** (demandé après les §3–4).
- Pétales : taille relevée (printemps 0.16–0.40, automne 0.22–0.48). Comptes inchangés (fps).
- Cadrage d'ouverture : déjà §3.
- Ombres de nuages : fbm XZ dérivé du vent, partagé terrain / rochers / herbe. Pas de 2ᵉ shadow map.
- Rayons crépusculaires : ShaderPass radial après le bloom, force golden+twilight.
- Son : `src/audio.js` Web Audio, câblé sur `birds.onEvent` (`call`/`flush`) et `shiba.onEvent` (`bark`). Premier geste pour débloquer le contexte.

---

## Pièges déjà rencontrés (ne pas les repayer)

1. **Backticks dans un commentaire GLSL.** Les shaders sont dans des template
   literals JS ; un backtick dans un commentaire termine la chaîne. Coûte une
   `SyntaxError` incompréhensible.
2. **`fog_vertex` de three exige une variable nommée littéralement `mvPosition`.**
   La renommer casse la compilation.
3. **`python -m http.server` met en cache.** Les imports ESM étant statiques, un
   cache-buster dans l'URL de la page ne les atteint pas : on debug l'ancien
   module sans le savoir. D'où `serve.py`.
4. **Pas de charset sur `text/html`** → le navigateur retombe sur un encodage
   legacy et casse sur le moindre octet non-ASCII dans un script inline.
5. **`windForce`** existe en deux signatures (`(pos)` et `(pos, t)`) ; une
   surcharge GLSL les réconcilie, ne pas en supprimer une.

---

## Décisions d'architecture à ne pas défaire

- **Un seul bruit.** `heightAt()` et le maillage du terrain doivent partager
  exactement la même fonction, sinon les props ne collent plus au sol.
- **Aucun `Math.random()`.** Tout passe par un flux graine ; l'île doit être
  identique à chaque rechargement, sinon elle n'est pas dirigeable artistiquement.
- **Uniforms de vent partagés par référence.** Un seul `wind.update()` pilote
  tous les matériaux. Ne jamais cloner cet objet (attention à
  `UniformsUtils.merge`, qui clone : réassigner après).
- **Aucune texture externe.** Fleurs, pétales, koi, nuages sont procéduraux —
  net à toute distance et zéro requête réseau.
