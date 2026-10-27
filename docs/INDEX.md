# Index — une ligne par sujet

Usage : `grep -i <mot> docs/INDEX.md docs/symbols.txt`, puis lire seulement
la cible (`sed -n` sur la ligne, ou la section du doc).
`symbols.txt` = tous les exports de `src/` avec fichier:ligne + ordre de
câblage de `main.js` (régénérer : `python3 tools/gen-symbols.py`).

## Sujet → où

règles pièges casse silencieuse appris → pieges.md
terrain hauteur sol heightAt source de vérité carve → architecture.md#terrain ; island.js
falaise ouest cliff rim → architecture.md#terrain ; island.js analyticHeight
étangs ponds koi isInPond inWater carve attach → architecture.md#terrain ; ponds.js ; verification.md (attach tôt)
échelle LAND_SCALE HEIGHT_SCALE AREA AREA_SOFT densité → architecture.md#échelles ; config.js
ombres shadow near sunDistance shadowEnvelope SKY_TUNE → architecture.md#ombres ; sky.js
qualité tier low high ultra ?q= localStorage reload → architecture.md#qualité ; config.js QUALITY
chemins routes PATHS isOnPath PATH_HALF initPath → architecture.md#chemins ; details.js
lanternes torii toriiAt orpheline → architecture.md#chemins ; details.js
ruban chemin flotte perfore clearRibbonTriangles pathSurfaceLiftAt patin belvédère → architecture.md#dégagement-des-rubans
vent wind rafales WIND_GLSL forestWind uWindDir → architecture.md#deux-modèles-de-vent ; wind.js ; sakura.js
cerisiers arbres sakura momiji feuillage createSakuraForest quality nombre → architecture.md#signatures-piégeuses ; sakura.js
herbe grass shortZone rase plancher fadeEnd createGrass → architecture.md#signatures-piégeuses ; perf.md ; grass.js
faune qualityCount QUALITY row → architecture.md#signatures-piégeuses
modules qui fait quoi fichier → architecture.md#modules
câblage ordre boot main.js → symbols.txt#câblage
fps perf banc mesure readPixels autoRotate dérive → perf.md#mesurer-sans-inventer-les-chiffres
feuillage coût géométrie fill-rate DPR shuffle FOLIAGE_SHUFFLE_BLOCK → perf.md#le-feuillage-est-géométrique-pas-fill-rate
chiffres référence M4 Max chargement 20 s → perf.md#référence
invariants test pass fail couverture → verification.md#invariants
checklist visuelle midi nuit vue sol → verification.md#visuel
debug __sk dayTime paused contrôles touches → AGENTS.md#lancer
déploiement Vercel vercelignore public → AGENTS.md#lancer
winding DoubleSide instanceColor GLSL mvPosition OrbitControls rAF → pieges.md#pièges
shiba chien nage regard aboie secoue → shiba.js ; shiba-geom.js ; shiba-gltf.js
eau ondes wake pondWaterYAt → ponds.js ; verification.md
saison automne printemps → season.js ; seasonal-foliage.js
ciel lune étoiles brouillard nuit → sky.js
nuages ombres de nuages → clouds.js ; cloud-shadow.js
audio sons ambiance cigales cicada phrases surf grenouilles → audio.js ; config.js AMBIENCE
POI chashitsu pas japonais stoneYAt signes torii marin → poi.js ; chashitsu.js
tactile mobile touch → touch.js
rivière pont → supprimés, ne pas réintroduire (pieges.md#règles)
