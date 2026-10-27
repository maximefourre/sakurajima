# Performance

## Référence

Chargement ultra ≈ 20 s (bake terrain 769² + placements).

Printemps ultra sur M4 Max, caméra verrouillée, `readPixels`, canvas
2490×2008 (01/09, post-impostors, herbe 420k·AREA_SOFT) : **53.8 fps**
ouverture, **29.1** au sol ; automne **54.5 / 42.7**. L'étalon du 31/07
(33.7 / 24.6 à 3600×1896) n'est plus le contrat — pas la même résolution.
Le poste dominant reste le feuillage.

## Mesurer sans inventer les chiffres

1. `__sk.frame()` ne fait que soumettre à la GPU, il ne l'attend pas : une
   boucle forcée annonçait 1413 fps. Resynchroniser par un
   `gl.readPixels(0,0,1,1,…)` après chaque frame.
2. La caméra bouge toute seule : `OrbitControls.autoRotate` est actif au
   boot, et en `camMode = 'follow'` le rig la ramène derrière le shiba à
   chaque frame (dérive de 992 u pendant un banc qu'on croyait cadré).
   Avant toute mesure : `__sk.setCamMode('orbit')`,
   `controls.autoRotate = false`, `controls.enableDamping = false`, puis
   vérifier que la dérive est nulle sur la durée du banc.

Avec les deux, les mesures tiennent à ±0.3 fps.

## Le feuillage est géométrique, pas fill-rate

DPR 2 → 1 → 0.5 ne change rien (21.3 / 21.6 / 21.8 fps). Le seul levier est
le nombre d'instances soumises. L'ordre compte aussi : mélanger le feuillage
par instance coûte 18 % au sol par perte de localité de rasterisation
(cf. `FOLIAGE_SHUFFLE_BLOCK`).

`fadeEnd` de l'herbe à 250 : à 330 la forêt était encore soumise depuis la
plage (~20 fps).
