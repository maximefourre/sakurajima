# Sakurajima — doc projet pour agents

Scène Three.js (0.185.1 via importmap unpkg, **aucun build**) : île japonaise
procédurale, cerisiers en fleur, rivière en delta, cycle jour/nuit, shiba
jouable. Direction artistique longue dans `PLAN.md` ; journal des sessions et
pièges dans `REPRISE.md` (**convention : y consigner chaque session**).

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
details.js  — fleurs sauvages, lanternes, galets, CHEMIN + TORII (exporte isOnPath)
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
- **`sunDistance` dérive de `LAND_SCALE`** (`sky.js`) : le near-plane d'ombre
  est `D_SUN − R_ISLAND − 80` et devient négatif (ombres mortes, zéro erreur)
  si on remet une constante.
- **Rivière = `BRANCHES[]`** (`river.js`) : index 0 = tronc, le reste =
  distributaires (`RIVER.branches`). Champ de distance baké min-combiné
  (`_fieldDist/_fieldT/_fieldB`). API externe stable : `carveRiver`,
  `isInRiver`, `waterYAt(t)` (= tronc). Jonction : les stations d'un
  distributaire dans le chenal du tronc sont épinglées sur l'eau du tronc
  (ré-épinglées après chaque lissage) ; son ruban démarre à >0.55·width de
  l'axe du tronc (sinon double-blend). La jonction doit être où l'eau du tronc
  ≈ niveau de la mer.
- **Câblage herbe/pétales DUPLIQUÉ** dans `main.js` (création initiale ~302 ET
  `rebuildForQuality` ~561) : toute modification doit être faite EN MIROIR.
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

## Vérification visuelle type

Midi (`__sk.world.dayTime = 0.5`) : mer jusqu'à l'horizon sans ligne rasoir,
ombres présentes (si absentes → near-plane, piège sky.js). Delta vu du SE en
hauteur : 3 bras distincts. Aube/nuit (0.97) : lanternes allumées aux bouts du
pont. Vue sol : chemin de terre visible, herbe exclue dessus, torii debout.
