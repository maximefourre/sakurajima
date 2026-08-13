# Vie + POI — programme en 8 lots

> Programme, pas un seul chantier. Chaque lot est livrable, photographable,
> committé seul.
>
> **Statut :** lot 1 (côte habitée) en cours d’implémentation (13/08).
> Géométries procédurales in-engine (aucune texture externe, contrat du
> projet). Pas de sprites Imagine : ça ne se branche pas sur la scène.

**But :** donner des raisons de marcher vers les coins vides de l’île, et de
la vie attachée à un lieu — poème japonais, pas parc d’attractions.

**Décision de cadrage (validée) :** tout le catalogue, découpé. Pas de
rivière, pas de pont, pas de village, pas de cerf/tanuki, pas de lanternes
orphelines, pas de système sonore (l’aboiement est un geste + hook
`onEvent`, comme les oiseaux).

---

## Exécution — lot 1 (côte habitée)

Trois pièces, dans `src/`, même recette que lanternes / hokora / oiseaux :
primitives mergées, vertex colors, seedé, un draw call par famille.

### `src/poi.js`

```
computeShorePineSite({ heightAt, isOnPath, isInPond })
  → { x, z, h, yaw } | null
placeRock(pine, heightAt, isOnPath, isInPond)
  → { x, z, h, yaw } | null

makeKuromatsuGeometry()
makeSittingRockGeometry(seed = SEED)
stoneYAt(x, z)            // retourne 0 jusqu’au lot 2

createPOI({ seed, heightAt, isOnPath, isInPond, slopeAt, season })
  → { group, stoneYAt, hitsSolid(x,z,pad), sites, dispose }
```

**Pin kuromatsu** — un seul. Fût courbé (cylindres empilés, lean vers
l’intérieur de l’île), écorce sombre vertex-color, plaques de feuillage
aplaties (icosaèdres écrasés, vert-noir, pas des boules sakura). Pas un
archétype de `sakura.js`.

**Rocher d’assise** — icosaèdre bruité, sommet aplati (`y` clampé haut),
assez large pour le shiba assis (~1.4 u de plateau), face mer.

**Placement pur** (testable sans WebGL) : dernier point de `PATHS` route
`plage`, puis marche dans le sens du dernier segment (vers le large),
premier point tel que :

- `!isOnPath(x, z, 0.25)`
- `!isInPond(x, z)`
- `WORLD.seaLevel < heightAt < WORLD.beachTop + 0.6`
- distance au terminus `≤ 12 · LAND_SCALE`

Le pin est déjà hors forêt : `isLand` des cerisiers exige `h > 2.6`.

`hitsSolid` : disque du fût (`r ≈ 0.45`) + disque du rocher (`r ≈ 0.9`).
Branché sur `shiba.blocked` **en plus** de `island.hitsRock`.

### `src/crabs.js`

```
computeCrabSpawns({ heightAt, isInPond, count, seed })
  → [{x,z,h,yaw}]

makeCrabGeometry()        // carapace + 2 pinces + 6 pattes, nez +Z

createCrabs({ seed, quality, heightAt, isInPond })
  → { mesh, update(t, shibaX, shibaZ), dispose }
```

Laisse = même bande que les galets (`-0.55 ≤ h ≤ beachTop·0.85`), hors
étangs. N = `quality.crabs` : 10 / 18 / 28. CPU (N petit) : idle → fuite
si shiba `< 6 u` → enfouissement (scale Y → 0, puis park sous le sable).

### Câblage

- `config.js` : `QUALITY.*.crabs`, tables `POI` et `CRABS`.
- `main.js` : après `ponds.attach` + `initPath` (déjà vrais avant les
  détails). Une étape de boot `'côte'` — `LOAD_STEPS` 13 → 14.
  `groundAt` compose `+ stoneYAt(...)` (0 pour l’instant).
- `test/invariants.html` : deux checks purs (site du pin ; crabes dans
  la laisse). Import des pures seulement.

### Hors lot 1

Bois flotté, `stoneYAt` réel, hérons, tout le reste du programme.

---

## Contraintes (tous les lots)

- `python3 serve.py 5173`. Aucun build, aucune dépendance nouvelle.
- `LAND_SCALE` à la définition de toute coordonnée XZ auteur. `HEIGHT_SCALE`
  une seule fois dans `analyticHeight`. Ne jamais remultiplier `PONDS` ni
  `PATHS` déjà scalés.
- `island.heightAt` = source de vérité. Les POI se posent dessus. Les pas
  japonais **ne recreusent pas** le heightfield.
- `world.groundAt` reste le sol des movers (shiba, caméra suivie). Chaque
  surface marchable nouvelle s’y compose (aujourd’hui : `heightAt +
  pathSurfaceLiftAt`). Les pas japonais ajouteront `stoneYAt`.
- Un système, un fichier. **`details.js` n’absorbe pas les nouveaux landmarks**
  (déjà ~2 k lignes : fleurs, rubans, lanternes, hokora). Nouveau `src/poi.js`
  pour le statique authoré ; un fichier faune par famille (`crabs.js`,
  `herons.js`, …), même patron que `fireflies.js` / `butterflies.js`.
- Faune : N **petit et local**, pas `AREA_SOFT` sauf insectes de nappe
  (libellules, mites). Le feuillage reste 75–88 % du frame.
- Qualité = reload. Budgets au constructeur. `QUALITY` + table d’art direction
  dans `config.js`.
- Graine unique (`SEED`). Zéro `Math.random()`.
- Après chaque lot : `node --check`, `test/invariants.html` **low ET ultra**
  (`0 fail`), vérif visuelle (midi + nuit), `REPRISE.md`, commit, review
  adversariale si le lot est substantiel.
- `LOAD_STEPS` s’incrémente si le boot gagne une étape visible.

---

## Fichiers (carte globale)

| Fichier | Rôle | Lots |
|---|---|---|
| `src/poi.js` | Landmarks statiques authorés + `stoneYAt` + sites exportés | 1, 2, 3, 4, 7 |
| `src/crabs.js` | Crabes de laisse, fuite | 1 |
| `src/herons.js` | Hérons échassiers, envol | 2 |
| `src/dragonflies.js` | Libellules GPU au-dessus des nénuphars | 2 |
| `src/moths.js` | Mites GPU autour des lanternes | 5 |
| `src/gulls.js` | Goélands posés sur stacks / torii marin | 4 |
| `src/bamboo.js` | Bosquet instancié + vent | 8 |
| `src/config.js` | Budgets, `PATHS` 4ᵉ route, constantes d’art | tous |
| `src/main.js` | Boot, `groundAt`, `setRepeller`, boucle | tous |
| `src/shiba.js` | Gestes (aboie, secoue, regard) | 6 |
| `src/details.js` | **Intouché** sauf lot 8 (4ᵉ route via `PATHS` déjà lu) et exports ponctuels si un helper (torii / shimenawa) doit être partagé | 3, 4, 8 |
| `src/sakura.js` | Exclusion des emprises POI dans `isLand` (câblé depuis `main.js`, pas un rewrite) | 1, 7, 8 |
| `test/invariants.html` | Un ou deux invariants **purs** par lot | tous |
| `REPRISE.md` / `PLAN.md` / `AGENTS.md` | Journal + contrats | tous |

`birds.js` et `ponds.js` restent fermés : on ne greffe ni le héron ni le
goéland dessus. Le milan et les koi existent déjà.

---

## Carte de l’île (où ça atterrit)

```
                    falaise ouest + hokora (existant, saturé — on n’y ajoute rien)
                              ↑ route torii
  iwakura (L3)  récif de crête (-48,-4)
                              │
  mer ── torii marin + goélands (L4) sur un sea stack déjà généré
                              │
carrefour [6,-30] ── jizō (L3) ── route plage ── pin + rocher + crabes (L1)
       │
       └── boucle étangs : héron + libellules + pas japonais (L2)
                           tsukubai berge (L3)
                           chashitsu lisière (L7)
       │
       └── (L8) 4ᵉ sentier → est → bambous
```

La route `plage` s’arrête déjà à `[50.5, 71.9]·L`, lisière herbe/sable
(`h ≈ 1.48`, `beachTop = 1.2`). Le pin se pose **juste au-delà**, sur le
sable, hors ruban.

---

## Les 8 lots

### Lot 1 — Côte habitée

**Livrable :** le sentier de la plage mène quelque part, et la laisse bouge.

- **Pin kuromatsu** unique, tordu vers l’intérieur (vent de mer), feuillage
  sombre en plaques, pas un 6ᵉ archétype sakura. Assis sur `heightAt`, hors
  `isOnPath`, dans la bande sable (`seaLevel < h ≤ beachTop + 0.6`).
- **Rocher d’assise** à son pied, plat dessus, assez large pour le shiba
  assis face à la mer. Collision : `poi.hitsSolid`.
- **Crabes** sur la laisse (même bande que les galets de `details.js` :
  `-0.55 ≤ h ≤ beachTop·0.85`, hors étangs). N = 10 / 18 / 28 selon
  low/high/ultra. Machine à états CPU (N petit) : idle → fuite si shiba
  `< ~6 u` → enfouissement. Un `InstancedMesh`.
- Bois flotté : **non**.

**Fichiers :** `poi.js`, `crabs.js` ; budgets `QUALITY.crabs` + `POI` /
`CRABS` dans `config.js` ; câbler dans `main.js` **après** `initPath` +
`ponds.attach` ; `groundAt` gagne un `+ stoneYAt(...)` qui retourne **0**.

**Invariants :**
- le pin est sur terre ferme, hors chemin, dans la bande sable, à moins de
  `12·L` du dernier point de la route `plage` ;
- tous les crabes spawnent dans la bande de laisse, aucun dans un étang.

**Vérif visuelle :** suivre le sentier plage jusqu’au pin ; midi ; s’asseoir
sur le rocher ; courir vers les crabes et les voir s’enfoncer.

Spec : `docs/superpowers/specs/2026-08-13-lot1-cote-habitee-design.md`

---

### Lot 2 — Étangs le jour

**Livrable :** les bassins ne sont plus uniquement des koi sous une glace.

- **Hérons** (aigrette / héron cendré, 1 géométrie, 2–3 individus ultra,
  1 en low). Pattes dans les bas-fonds (`isInPond` et profondeur faible,
  hors le disque central des koi). Idle, coup de bec, envol si shiba
  `< ~14 u` (même idée que `birds.setRepeller`). Perch possible sur une
  berge. Fichier `herons.js`.
- **Libellules** au-dessus des nénuphars. GPU pur (patron lucioles), actives
  le jour (`1 - phase.night`), habitat = bassins, altitude 0.3–1.4 u au-dessus
  de `waterY`. Budgets `AREA_SOFT` petits (≈ 8 / 18 / 32). `dragonflies.js`.
- **Pas japonais** sur le **grand** étang uniquement (`PONDS[0]`, site
  authoré `(16,-42)·L`). 5–7 dalles, arc de berge à berge, assez serrées
  pour le shiba (`écart ≤ 1.1 u`). Posées à `pondWaterYAt + 0.04`.
  `stoneYAt(x,z)` retourne la hauteur dalle si le point est sur une pierre
  (disque de rayon dalle), sinon 0. **Ne pas recarver.** Herbe exclue sur
  les dalles. Koi : les dalles évitent le centre (`r < 0.35 · radius`).

**Dépend de :** lot 1 (`poi.js` + `stoneYAt` déjà composé dans `groundAt`).

**Invariants :** dalles au-dessus de l’eau, dans le grand bassin, hors
centre koi, `stoneYAt` fidèle à ≤ 0.08 u ; hérons spawnent en eau peu
profonde ; libellules dans l’habitat bassin.

**Vérif :** midi, le chien traverse le grand étang à pied ; un héron s’envole ;
libellules lisibles au-dessus des nénuphars, absentes la nuit.

---

### Lot 3 — Signes sacrés

**Livrable :** le carrefour, la crête et une berge deviennent des lieux.

- **Jizō** à côté du carrefour (`PATHS.routes[0].points[0]`), **hors** de
  l’axe (décalage `≥ PATH_HALF + 1.2`), pierre patinée (même recette grain +
  mousse que le hokora, sans le copier-coller du shader entier si un helper
  propre se dégage — sinon dupliquer le motif, **ne pas refactorer le
  sanctuaire**).
- **Tsukubai** (bassin de pierre + louche) sur la berge du grand étang, hors
  chemin, hors eau. Eau stagnante dans la cuve (petit disque, pas un 4ᵉ
  `PONDS`).
- **Iwakura** : shimenawa + shide sur le plus gros bloc authoré du récif de
  crête (`SPRING_ROCKS[0]`, `s = 4.6` en `(-48,-4)·L`). On n’ajoute pas de
  rocher. Exporter depuis `island.js` le site du récif **ou** re-dériver les
  mêmes coordonnées authorées (elles sont déjà en clair).

**Dépend de :** lot 1 (`poi.js`). Indépendant du lot 2.

**Invariants :** jizō hors ruban ; tsukubai hors étang et hors chemin ;
iwakura à moins de 2 u du centre du plus gros bloc du récif.

**Vérif :** le carrefour se photographie ; la shimenawa se lit sur la crête
depuis la montée aux torii.

---

### Lot 4 — Silhouette mer

**Livrable :** la carte postale gagne un torii dans l’écume, la côte des
oiseaux posés.

- **Torii marin** sur **un** sea stack existant (seed fixe → positions
  stables). Choisir le stack le plus cadrable depuis la caméra d’ouverture
  **et** visible depuis le pin du lot 1 ; si aucun ne convient, **authorer
  un** stack supplémentaire (ne pas déplacer les autres : le RNG rochers
  doit rester intact — même leçon que `SPRING_ROCKS`).
- Posts dans l’eau (`h < 0`), nuki hors houle. Réutiliser
  `makeToriiGeometry` de `details.js` (l’exporter) à une échelle un peu
  plus grande, vermillon identique. Ce n’est **pas** une lanterne : le
  contrat « pas d’orpheline » ne s’applique pas.
- **Goélands** posés sur stacks + traverse du torii marin. N = 6 / 10 / 16.
  Idle, toilette, envol groupé si shiba proche de la côte (`< ~20 u`) ou
  caméra très proche. `gulls.js`, pas `birds.js`.

**Dépend de :** lot 1 (le pin est le belvédère d’où on le voit). Idéalement
après le lot 3 pour ne pas saturer `poi.js` en parallèle.

**Invariants :** posts du torii en `h < 0` ; aucun stack préexistant déplacé ;
goélands spawnent sur un stack ou le nuki.

**Vérif :** cadrage d’ouverture à `dayTime = 0.5` **et** `0.78` ; le torii
se lit en silhouette ; depuis le pin, il est dans le champ vers le large.

---

### Lot 5 — Nuit des routes

**Livrable :** la nuit hors étangs bouge.

- **Mites** autour de `lanternSpots` (déjà exporté par `details.js`, rempli
  par `createDetails`). GPU pur, patron lucioles, couleur chaude
  (`~0xffc878`), dérive serrée autour de chaque lanterne (rayon 1.4–2.2 u),
  actives sur `phase.emissive`. N ≈ 2 par lanterne ultra / 1 high / 0.5 low
  (low peut tomber à 1 toutes les deux lanternes).
- Habitat = lanternes des trois routes **+** la paire de terrasse. Pas de
  mites au hokora (les bougies suffisent).

**Dépend de :** `createDetails` avant construction (déjà vrai pour les
papillons). Indépendant des lots 2–4.

**Invariants :** chaque mite est à moins de 2.6 u d’une lanterne au spawn ;
population nulle si `lanternSpots` est vide.

**Vérif :** `dayTime = 0.97`, suivre n’importe quelle route : un halo vivant
autour des cages à feu ; les étangs gardent leurs lucioles, sans se
mélanger (couleur et habitat disjoints).

---

### Lot 6 — Shiba plus vivant

**Livrable :** le chien réagit au monde qu’on vient de poser.

- **Aboiement** : 1 geste (tête + mâchoire) déclenché — idle long, héron
  qui s’envole, ou touche dédiée **non** (pas de nouvelle touche : le HUD
  est déjà plein). Hook `onEvent('bark')` comme `birds.onEvent`, **pas de
  fichier audio** dans ce lot.
- **Secouement** après sortie d’eau (étang ou mer, dès que
  `!isInPond && !inSea` après une nage/barbotage ≥ 1.2 s).
- **Regard** : si idle et (héron à `< 18 u` ou hokora / jizō / pin à
  `< 10 u`), la tête tourne vers la cible 2–4 s. Le « lever la tête vers
  un pétale réel » de PLAN §4 reste **hors lot** (autre chantier).
- Collision troncs : **hors lot** (PLAN §4, besoin de `forest.instances`,
  chantier à part).

**Dépend de :** lots 1–2 pour avoir pin + héron à regarder. Le jizō (lot 3)
est un bonus si déjà là ; le regard marche avec le hokora existant sinon.

**Invariants :** un shiba qui n’a jamais nagé ne se secoue pas ; le regard
ne détourne pas le corps en course.

**Vérif :** sortir d’un étang → secouement ; s’arrêter près d’un héron →
tête vers lui, puis aboiement éventuel à l’envol.

---

### Lot 7 — Chashitsu

**Livrable :** une trace humaine au-delà du culte, abandonnée.

- Une pièce, ossature bois + cloisons ouvertes (pas de shoji animés), toit
  de chaume/bardeaux procédural, mousse, vue cadrée vers les étangs.
- Site : lisière de prairie, près de la boucle `etangs`, hors chemin
  (`isOnPath(..., 4)`), hors eau, pente `< 0.25`, `h` prairie.
- Aucun habitant, aucune fumée, aucune lanterne ajoutée (les lanternes de
  la boucle éclairent déjà).
- `isLand` des cerisiers et `exclude` herbe refusent l’emprise (disque
  ~6 u). `poi.hitsSolid` bloque le shiba.

**Dépend de :** lot 1 (`poi.js`). Mieux après le lot 3 (vocabulaire bois /
patine déjà chaud).

**Invariants :** hors chemin, hors eau, pente douce ; aucun arbre dans
l’emprise ; le shiba ne traverse pas les poteaux.

**Vérif :** on arrive par la boucle des étangs ; de l’intérieur, les trois
bassins se lisent ; nuit : éclairé seulement par les lanternes de la route.

---

### Lot 8 — Est : bambous + 4ᵉ sentier

**Livrable :** le quadrant est n’est plus une forêt sans but.

- **Nouvelle route `bambous`** dans `PATHS.routes`, depuis le carrefour
  vers l’est (bosse authorée `(56,-10)·L` comme cible de relief). Même
  contrat que les trois autres : ruban collé + dégagement triangle par
  triangle, lanternes générées (quinconce, skip pente / sol bas), herbe
  rase (`shortZone`), cerisiers exclus (`isOnPath(..., 4)`).
- **Bambous** instanciés, vent partagé (`windUniforms`), fût + feuillage
  simple, densité locale (bosquet, pas l’île entière). `bamboo.js`.
  `AREA_SOFT` pour le compte, instances plus grosses.
- Pas de rivière, pas de pont, pas de lanternes hors de la nouvelle route.

**Dépend de :** rien d’autre, mais **en dernier** : c’est le lot le plus
dangereux (contrats de ruban déjà payés deux fois). Toute géométrie de
chemin se rejoue en `?q=ultra`.

**Invariants :** les invariants de terre battue existants restent vrais
**sur les quatre routes** ; aucune lanterne orpheline ; le bosquet est à
l’est du carrefour ; zéro bambou sur le ruban.

**Vérif :** ultra, midi et nuit ; la 4ᵉ route grimpe/descend sans flotter
ni percer ; lanternes allumées ; le bosquet se lit comme un biome, pas
comme des cerisiers verts.

---

## Ordre et parallélisme

```
L1 côte ──► L2 étangs jour ──► L6 shiba
   │              │
   ├──────────────┴──► L3 signes ──► L7 chashitsu
   │
   ├──► L4 mer
   ├──► L5 mites        (après L1 seulement par le boot ; après createDetails)
   └──► L8 bambous      (dernier, isolé, dangereux)
```

Exécution réelle : **un lot à la fois**, dans l’ordre 1 → 2 → 3 → 4 → 5 →
6 → 7 → 8. L5 pourrait glisser juste après L1 si on veut de la nuit tôt ;
on ne le fait pas — d’abord les destinations diurnes.

---

## Ce que ce programme ne fait pas

- Rivière, pont, 4ᵉ étang, 2ᵉ hokora sur la terrasse.
- Cerfs, tanuki, cigales, grenouilles, audio.
- Impostors feuillage / perf forêt (autre piste PLAN).
- 3ᵉ saison.
- Collision shiba ↔ troncs (reste PLAN §4).

---

## Marche à suivre

1. Spec du **lot courant** sous `docs/superpowers/specs/`.
2. Implémentation **sans sous-traiter** (un Codex laissé libre re-délègue
   et n’écrit rien — `AGENTS.md`).
3. Review du diff + adversariale + invariants low ET ultra + commit.
4. Lot suivant.
