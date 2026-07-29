# Sakurajima — doc projet pour agents

Scène Three.js (0.185.1 via importmap unpkg, **aucun build**) : île japonaise
procédurale, cerisiers en fleur, rivière en delta, cycle jour/nuit, shiba
jouable. Direction artistique longue dans `PLAN.md` ; journal des sessions et
pièges dans `REPRISE.md` (**convention : y consigner chaque session**).

## Rôles de l'équipe d'agents (convention utilisateur)

- **Claude** : planifie, orchestre, review — ne code pas lui-même les gros
  chantiers.
- **Grok 4.5** (`grok` CLI, headless : `grok -p "<brief>" --model grok-4.5
  --permission-mode acceptEdits`) : ÉCRIT le code, un chantier à la fois,
  d'après un brief précis de Claude (fichiers, ancrages, contraintes AGENTS).
- **Codex gpt-5.6-sol, effort high** : REVIEW ADVERSARIALE après chaque passe
  substantielle — via le skill du plugin Claude Code `codex:adversarial-review`,
  PAS en appelant le CLI codex à la main (consigne utilisateur).
  Le rapport va dans `ADVERSARIAL_REVIEW_CLAUDE.md`
  (versionner l'id `ADV-...`), avec table de suivi remplie par Claude au
  traitement.
- Après chaque chantier Grok : `git diff` relu par Claude, `node --check`,
  `test/invariants.html` (10 pass), vérification visuelle navigateur, PUIS
  commit.

## Lancer

```sh
python3 serve.py 5173     # JAMAIS python -m http.server (cache les modules ES)
# http://127.0.0.1:5173/index.html
```

- Debug : `globalThis.__sk = { world, scene, camera, renderer, controls, THREE, frame, setCamMode, clock }`.
- `world.dayTime` (0–1, 0.5 = midi), `world.paused`, `world.heightAt(x,z)`, `world.inWater(x,z)`.
- Chargement ultra ≈ 20 s (bake terrain 769² + placements). ~41 fps ultra sur M4 Max.
- Contrôles : ZQSD promène le shiba, `Maj` court, `C` bascule la caméra, Espace pause.

## Architecture (qui fait quoi, qui dépend de qui)

```
config.js   — TOUTES les constantes d'art direction + presets qualité
noise.js    — PRNG seedé (streamFor), noise2/fbm2/ridged2, smoothstep/clamp/mix
island.js   — heightfield analytique → grille bakée → mesh terrain + océan + rochers
river.js    — delta (tronc + distributaires), carve, rubans d'eau, pont taiko-bashi
ponds.js    — 3 étangs à koi (carve composé avec la rivière)
grass.js    — brins instanciés, LOD par chunks
sakura.js   — 5 archétypes de cerisiers, fleurs instanciées
details.js  — fleurs sauvages, lanternes, galets, CHEMIN + TORII (exporte isOnPath, initPath)
detailtex.js— bump maps GÉNÉRÉES (bruit périodique seedé) : grain sol/roche, veinage bois
sky.js      — soleil/lune/étoiles/brouillard/ombres (courbes keyframées par heure)
clouds.js / birds.js / petals.js / wind.js / shiba.js — atmosphère & personnage
main.js     — le SEUL endroit où tout est câblé + boucle de rendu
```

Le cœur : `main.js:258` compose `carve = river(ponds(h))` dans le heightfield de
l'île. **`island.heightAt` est la source de vérité unique** — mesh et samplers
interpolent exactement les mêmes triangles. `main.js:278` : `world.inWater =
ponds.isInPond || river.isInRiver`.

## Contrats (à respecter sous peine de casse silencieuse)

- **`LAND_SCALE`** (`config.js`, = 1.42·√5) : toute coordonnée XZ auteur est
  multipliée par lui À SA DÉFINITION. Les hauteurs suivent **`HEIGHT_SCALE`**
  (1.4), appliqué UNE fois dans `analyticHeight` — jamais les deux.
- **`AREA` vs `AREA_SOFT`** (`config.js`) : les scatters bon marché (fleurs,
  galets) scalent en `AREA = L²` ; les coûteux (herbe, arbres, pétales,
  rochers) en `AREA_SOFT = AREA^0.75`, compensé par des instances plus grosses.
  Honnêteté : `AREA_SOFT` est la POLITIQUE par défaut, pas une protection — le
  coefficient herbe ultra a été volontairement monté (300k→470k, ≈2.66 M de
  brins) à la demande de l'utilisateur, un choix de goût pour la machine cible.
  Les vrais replis machine faible sont les tiers low/high.
- **`sunDistance` dérive de `LAND_SCALE`** (`sky.js`) : le near-plane d'ombre
  est `D_SUN − R_ISLAND − 80` et devient négatif (ombres mortes, zéro erreur)
  si on remet une constante.
- **Rivière = `BRANCHES[]`** (`river.js`) : index 0 = tronc, le reste =
  distributaires (`RIVER.branches`). Champs de distance bakés PAR BRANCHE
  (`_fieldDistB[b]/_fieldTB[b]`), min pris À LA REQUÊTE — le triplet
  (dist, t, b) vient de la même branche, sinon `widthKAt` saute aux frontières
  de Voronoï. API externe stable : `carveRiver`, `isInRiver`, `waterYAt(t)`
  (= tronc) ; `BRANCHES` et `widthKAt` exportés en LECTURE SEULE pour
  test/invariants.html.
  `build()` est idempotent (possède ses rubans/pont, remplace et dispose) ; la
  factory expose `dispose()` et **`bridgeInfo`** (placement FINAL du pont,
  shift compris) après build. **Profil d'eau v4 : l'eau ÉPOUSE le terrain**
  (modèle Waterways) — par station : lit + 0.72·depth, plafonné à la crête de
  digue locale − 0.10, PLANCHER lit + 0.12 (le plancher gagne), remontée
  bornée à 0.12/station, lissage 1-2-1, embouchure fondue vers seaLevel+0.05.
  AUCUNE propagation amont→aval : le « jamais-remonter » v1–v3 passait l'eau
  SOUS le lit dès que celui-ci remontait (trous de sable sec). Le ruban marche
  jusqu'à la vraie ligne d'eau (bisection) + jupe enterrée sous les berges.
  Jonction : stations d'un distributaire dans le chenal du tronc épinglées sur
  l'eau du tronc ; ruban démarrant à >0.55·width de l'axe du tronc (sinon
  double-blend). La jonction doit être où l'eau du tronc ≈ niveau de la mer.
- **Changement de qualité = reload** : le tier est résolu AVANT le boot
  (`?q=` → localStorage `sakurajima.quality` → défaut) ; le bouton persiste et
  recharge. Il n'existe PLUS de rebuild à chaud ni de câblage dupliqué —
  chaque système se dimensionne à la construction, un point c'est tout.
- **Pont/chemin/lanternes = une seule source de vérité** : `river.bridgeInfo`
  (centre, axe, culées réelles). `main.js` appelle `initPath(bridgeInfo)`
  APRÈS `river.build` et AVANT `createGrass` (l'exclusion d'herbe suit le
  tracé corrigé), et passe `bridgeInfo` à `createDetails` pour les lanternes.
- **`createSakuraForest` et `createGrass` ignorent en silence les options
  inconnues.** sakura veut `isLand`, `windUniforms`, `quality` **numérique**
  (un objet → budget NaN → arbres sans branches). grass veut `count`, `bounds`,
  `exclude` (pas `quality`).
- `PATH` (`config.js`) : chemin falaise→pont ; `details.js` exporte `isOnPath`
  (grille de buckets) branché dans l'`exclude` de l'herbe (les deux sites).
- La falaise ouest vit dans `analyticHeight` (secteur angulaire plein-ouest,
  rim + chute) — pas un mesh séparé, tout suit (couleurs, pente, herbe).
- Le pont se place tout seul : recherche de culées de niveau ±12 u le long de
  son axe + semelles de pierre. `bridgeSpan` couvre le chenal mouillé, PAS tout
  le carve (la berge ouest monte sans fin — flanc de crête).

## Pièges (payés cash — ne pas re-payer)

1. **Winding des triangles** : 4 morsures (océan, corolle, ailes, ruban du
   chemin). Une strip enroulée vers le bas sur un matériau `FrontSide` ne rend
   RIEN, silencieusement. Diagnostic éclair : forcer `DoubleSide` à chaud.
2. **`instanceColor`** exige `vertexColors: true` ET un attribut `color` blanc.
3. GLSL : pas de backticks dans les commentaires ; `fog_vertex` exige une
   variable nommée littéralement `mvPosition`.
4. `island.update()` écrase opacité/réflectivité de l'eau chaque frame — régler
   dans sa courbe jour/nuit, pas de l'extérieur.
5. `OrbitControls.update()` repositionne la caméra même `enabled=false`.
6. `preserveDrawingBuffer=false` : capturer pendant que la boucle rAF tourne.
7. Les fades du delta sont fragiles : plafond de fade de rive 1.4 et fade de
   carve descendant à −0.5 sous la mer — remonter ces seuils re-noie les bras
   dans le platier SE.
8. Onglet en arrière-plan = rAF ET setTimeout étranglés.

## Vérification type

1. **`test/invariants.html`** (via serve.py) : la console doit finir par
   `INVARIANTS: 10 pass, 0 fail` — eau jamais sous son lit, remontées de nappe
   bornées, 3 embouchures, continuité de jonction, contention locale (crête de
   digue), build idempotent, chemin→culée réelle, far plane, nuages.
2. Visuel — midi (`__sk.world.dayTime = 0.5`) : mer jusqu'à l'horizon sans
   ligne rasoir, ombres présentes (si absentes → near-plane, piège sky.js).
   Delta vu du SE en hauteur : 3 bras distincts. Nuit (0.97) : lune basse au
   sud avec halo, étoiles dans la bande 0–20°, terre lisible, lanternes
   allumées aux bouts du pont. Vue sol : chemin de terre granuleux, herbe
   exclue dessus, torii debout, bois du pont veiné.
3. Tiers : `?q=low|high|ultra` — aria-pressed reflète le tier réel au boot.
