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
11. Shiba : tout effet au sol se déclenche sur la hauteur de `PAW_SOLE`, pas sur
    l'os `paw` (cheville/jarret). Décalques sur les sentes : `world.dirtAt`, pas
    `groundAt`. Depuis l'IK de pied (28/10) la phase d'appui (`u < duty`) EST le
    contact au sol ; elle ne l'était pas avec les balanciers en sinus.
12. Shiba, pieds posés : la cadence découle de la vitesse (`speed × duty / sweep`).
    Toucher à `walkSpeed`/`runSpeed` ou à `GAITS.*.sweep` change la cadence, pas
    la longueur de foulée. L'antérieur est presque TENDU au repos : sa portée
    vient de `crouch`, du décollage par les doigts (`TOE_*`) et de `leadF`.
    Rallonger `sweep` le fait décoller du sol en fin d'appui (invariant « pattes
    au trot / au galop »). Pour RALENTIR la cadence, baisser `duty` (plus de
    suspension, la foulée s'allonge en l'air) : sweep .85 au trot = glissé 0.16.
    Allures naturelles (29/10) : le trot lent a son propre `dutySlow` / `sweepSlow`
    (interpolés par la vitesse) et la porte pas → trot s'ouvre à speedN .07–.13 :
    la cadence reste ≈ 2 Hz de 2 u/s à la course (avant : 5.6 Hz à 4 u/s). `crouch`
    trot 0.035 : en dessous le glissé dépasse 0.03 ; au pas, `sweep` > 0.42 enfonce
    les antérieurs (-0.02).
13. Shiba, pente : un pied hors de portée (arrêt en pleine foulée, écart de
    décollage, patte presque tendue au repos) est ramené par le solveur à
    l'HORIZONTALE, donc dans la pente : creux = pente × recul (-0.036 mesuré à
    0.36, ni `crouch` ni `ANCHOR_SLACK` n'y changent rien de façon stable : le
    creux dépend de la phase des pieds à l'arrêt). Correctif : après la pose,
    `animate()` mesure la sole de chaque pied (`SOLE_SUNK_MIN`), relève sa cible
    du creux et repose la patte. Invariant « pattes en pente » (relâché à dix
    phases de foulée). Ne pas régler ça avec `crouch`.
    `accel` / `brake` 11 / 11 (avant 14 / 18) : arrêt progressif (un arrêt
    brusque depuis le galop glissait de 23 u/s par image, 4.6 maintenant) ; coût :
    0.3 s de plus pour atteindre la course, 0.5 s de plus pour s'arrêter. À
    remonter (accel d'abord) si les touches paraissent molles.
