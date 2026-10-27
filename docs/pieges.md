# Règles et pièges

Appris à l'usage. Le détail du pourquoi : `architecture.md`, `perf.md`.

## Règles (casse silencieuse sinon)

- `main.js` est le SEUL endroit où tout est câblé.
- `island.heightAt` est la source de vérité unique du sol (carve des étangs inclus).
- `LAND_SCALE` sur les XZ auteur à leur définition ; `HEIGHT_SCALE` une seule
  fois dans `analyticHeight`.
- Scatters coûteux en `AREA_SOFT`, bon marché en `AREA`.
- `sunDistance` : changer le rayon d'ombre sans `D` rend le near négatif (ombres mortes).
- Changement de qualité = reload, pas de rebuild à chaud.
- Deux modèles de vent volontaires ; ne pas passer `createWind().uniforms` à
  `createSakuraForest`, ne pas les unifier sans demande.
- Chemins : `initPath()` avant `createGrass` ; aucun arbre sur un chemin ;
  aucune lanterne orpheline ni dans un étang.
- Rubans : collés puis dégagés triangle par triangle (`clearRibbonTriangles`).
  Ne PAS revenir à une sonde de voisinage (fait flotter le chemin).
- `createSakuraForest({quality})` veut un nombre ; `createGrass` throw avec
  `quality` ; les faunes veulent le row `QUALITY.x`, pas la string.
- Rivière et pont supprimés (décision utilisateur) : ne pas les réintroduire.

## Pièges

1. Winding inversé sur `FrontSide` = rien ne rend. Diagnostic : `DoubleSide` à chaud.
2. `instanceColor` exige `vertexColors: true` ET un attribut `color` blanc.
3. GLSL : pas de backticks dans les commentaires ; `fog_vertex` exige `mvPosition`.
4. `island.update()` écrase opacité/réflectivité de l'eau chaque frame.
5. `OrbitControls.update()` repositionne la caméra même `enabled=false`.
6. `preserveDrawingBuffer=false` : capturer pendant que la boucle rAF tourne.
7. Onglet en arrière-plan = rAF et setTimeout étranglés.
8. Mesurer les fps : `readPixels` après chaque frame + caméra figée (voir `perf.md`).
9. Le feuillage coûte en géométrie, pas en fill-rate : baisser la résolution ne rapporte rien.
10. Retouche des chemins : repasser les invariants en `?q=ultra` (low est le cas facile).
