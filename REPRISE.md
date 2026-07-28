# Où j'en suis — point d'arrêt du 28/07/2026

> Le contexte long (direction artistique, décisions, pièges) est dans `PLAN.md`.
> Ce fichier-ci est la checklist opérationnelle.

## Reprendre en 30 secondes

```sh
cd ~/Projects/vibecode/sakurajima
python3 serve.py 5173
# puis http://127.0.0.1:5173/index.html
```

**La scène s'affiche, tourne, et se pilote.** ZQSD/WASD promènent le shiba,
`Maj` le fait courir, `C` bascule entre caméra libre et caméra suivie.

---

## Ce qui a été corrigé le 28/07 — ne pas le refaire

| # | Fichier | Problème | Correctif |
|---|---|---|---|
| 1 | `island.js` | **Le disque d'océan était enroulé à l'envers.** Toutes les faces pointaient vers le fond marin, donc `side: FrontSide` culait la mer entière. L'île flottait dans une cuvette de fond marin nu et le shader d'eau ne dessinait rien — ce qui se lisait comme un problème de réglage et avait été chassé comme tel. | Indices inversés |
| 2 | `main.js` | Forçait l'opacité et la réflectivité de l'eau au boot ; `island.update()` les réécrit à chaque frame depuis sa courbe jour/nuit, donc ces affectations n'atteignaient jamais la première image | Intention déplacée dans la courbe, bloc mort supprimé |
| 3 | `sky.js` | Le dôme de Preetham saturait en blanc à midi. Un gain unique ne peut pas servir midi **et** le crépuscule : l'écart de luminance est d'un ordre de grandeur | Gain **keyframé** (`K_SKY_GAIN`), valeurs obtenues par calibration en navigateur, pas à l'œil |
| 4 | `sky.js` | Brouillard rabaissé à 16 % pour combattre un « voile blanc » qui était en fait le ciel cramé + la mer absente. Résultat : ligne d'horizon au rasoir | `FOG_SCALE` 0.16 → 0.56 |
| 5 | `grass.js` | **Aucune notion d'eau.** Les cuvettes sont creusées dans le heightfield, donc leur fond passe tous les tests que l'herbe applique. Les étangs se remplissaient d'herbe immergée | Hook `exclude` ajouté, câblé sur étangs + rivière |
| 6 | `main.js` | `createSakuraForest` recevait `isInPond`, `wind` et l'**objet** de qualité. Or il attend `isLand`, `windUniforms` et un **nombre**. `clamp(objet, …)` vaut NaN → chaque arbre était construit avec un budget de branches NaN et se rendait comme un nuage de fleurs sans arbre dessous | Noms corrigés, densité de fleurs relevée pour compenser les vraies branches |
| 7 | `main.js` | La forêt tournait sur son propre vent : `wind.js` stocke la direction en `Vector2`, `sakura.js` la lit en `vec3` | Petit adaptateur `forestWind` dans `main.js`, rafraîchi chaque frame |

## Ce qui a été ajouté le 28/07

- **`src/shiba.js`** — le personnage jouable. Maillage procédural (tubes effilés
  balayés le long de courbes, peinture par sommet), animé par une hiérarchie
  d'`Object3D`. Marche/course, orientation lissée, conformation au terrain,
  refus de l'eau profonde mais barbotage dans les hauts-fonds, position assise
  après quelques secondes d'inactivité, queue qui s'agite plus fort après une
  course, empreintes de pattes dans le sable mouillé qui s'effacent en 26 s.
- **Caméra tierce personne** dans `main.js` (`C` pour basculer). Elle traîne
  derrière lui avec du retard et se tient hors du relief.
- **`src/ponds.js`, `src/birds.js`, `src/clouds.js`** — les trois stubs
  remplacés. Étangs à koi et nénuphars, vol de boids qui se perche la nuit et
  se disperse quand le chien approche, cumulus proches à vraie parallaxe.
- **`src/details.js`** — le niveau du sol. Fleurs sauvages en dérives (quatre
  espèces qui se regroupent séparément, pliées par le vent partagé), lanternes
  de pierre le long du chemin du pont dont la cage à feu s'allume au crépuscule,
  galets sur l'estran.
- **L'embouchure de la rivière.** Le chenal ne creusait pas seulement la terre :
  il continuait sous la mer, et le ruban d'eau s'arrêtait sur une arête
  rectangulaire posée au-dessus des vagues. Le carve s'éteint maintenant quand
  le sol atteint le niveau de l'eau, et l'embouchure est *trouvée* et non
  écrite : on échantillonne les berges de part et d'autre du couloir et le
  ruban se dissout là où elles disparaissent.

---

## Session « île ×5 » du 28/07 (après-midi) — ce qui a changé et pourquoi

**Le knob** : `LAND_SCALE = 1.42·√5` (aire exactement ×5). Nouveau knob frère :
`HEIGHT_SCALE = 1.4` — relief relevé partiellement (appliqué UNE fois sur
l'accumulateur `land` dans `analyticHeight`), sinon la crête de 17 u sur une
île de 1120 u lisait comme une crêpe. Les budgets coûteux (herbe, arbres,
pétales, rochers) scalent désormais en `AREA_SOFT = AREA^0.75` — l'aire pleine
donnait 3 M de brins et 3125 arbres, intenable ; la densité perçue est
compensée par des instances plus grosses (fleurs +35 %, brins plus larges).

| Correctif d'échelle | Où |
|---|---|
| **Near-plane d'ombre négatif** (`D_SUN` fixe 320 < islandRadius+80) → toutes les ombres mortes. `sunDistance` désormais dérivé de `LAND_SCALE` | `sky.js:62` |
| Disque océan : rayons dérivés (`ISLAND_R·1.5`, `SIZE·3.37`), 320 anneaux | `island.js` |
| Fade de houle GLSL ×2.24 (1450→4250) | `island.js` |
| `FOG_SCALE 0.56 → 0.25` (même profondeur optique au nouvel horizon) | `sky.js` |
| Champ de nuages : `FIELD_HALF/FADE_*` dérivés de LAND_SCALE, decks +30 % | `clouds.js` |
| Fleurs/galets : comptes ×AREA (`2500·budget·AREA`, `120·budget·AREA`) | `details.js` |
| Profondeur d'étang ×min(HEIGHT_SCALE, 1.3) | `ponds.js:73` |
| `CEILING 98 → 140` (oiseaux au-dessus du relief relevé) | `birds.js` |
| Caméra `far = 1750·L` ; segments terrain 768 (ultra) / 512 / 320 | `config.js`, `island.js` |

**Le delta.** `river.js` généralisé en `BRANCHES[]` (tronc + 2 distributaires,
`RIVER.branches` dans config). Index spatial et champ de distance baké
min-combinés sur toutes les branches (`_fieldB` en plus de `_fieldT`) ;
`carveRiver`/`isInRiver` inchangés d'API. Leçons chèrement payées :
- **La jonction doit être là où l'eau du tronc est déjà ≈ niveau de la mer**
  ([40,80], eau ≈ 0.9). Plus haut, les bras épinglés au niveau du tronc
  flottent au-dessus du platier qu'ils traversent.
- **Tout le quadrant SE est un platier à peine émergé.** Deux fades devaient
  s'adoucir pour que trois bras y restent lisibles : le fade de rive du ruban
  (2.4 → 1.4 de plafond) et le fade d'estuaire du carve (il descend maintenant
  à −0.5 sous la mer, sinon les bras n'avaient pas de lit dans le platier et
  l'eau passait sous le sable).
- Les embouchures sont écartées de 135–165 u (est (311,254)·unit, SO (51,400),
  tronc (203,337)) — plus près, tout fusionnait en une lagune unique.
- Continuité à la jonction : les stations d'un distributaire encore dans le
  chenal du tronc sont épinglées sur `waterYAt(tronc)`, ré-épinglées après
  chaque passe de lissage ; son ruban ne démarre qu'à >0.55·width de l'axe du
  tronc (sinon double-blend sombre des deux surfaces transparentes).

**Le pont.** Travée raccourcie (`16·(1+(L−1)·0.6)` ≈ 37) : la rivière longe le
flanc de crête, la berge ouest monte sans fin, une travée de 60 u enterrait un
bout et perchait l'autre sur une tour. `buildBridge` glisse maintenant le
tablier le long de son axe (recherche ±12 u) vers la paire de culées la plus
horizontale, se pose sur la plus haute, et comble sous chaque bout avec une
semelle de pierre (plafonnée à 4 u). Lanternes de pierre appariées aux deux
extrémités (spots calculés depuis la courbe dans `details.js` — le glow
nocturne est gratuit, même InstancedMesh que les autres).

**Falaise + chemin + torii.**
- Falaise : secteur angulaire plein-ouest dans `analyticHeight` — la côte
  gonfle vers un rebord (`rim ≈ 8·HEIGHT_SCALE`) puis tombe (`sstep(0.545,
  0.585, d)`) dans une eau profonde (−15). Tout suit (couleur roche via la
  pente, pas d'herbe sur la face, pierriers au pied).
- Chemin : `PATH` dans config (falaise → pont, au sud de la rivière), ruban de
  terre battue à 3 colonnes drapé sur `heightAt` dans `details.js`, herbe
  exclue via `isOnPath` (grille de buckets, export module) branché dans les
  DEUX sites d'appel de `createGrass` de `main.js`.
- Torii : géométrie fusionnée peinte par sommet (même recette que la
  lanterne), 3 instances aux fractions `PATH.toriiAt`.

**Luxuriance.** Herbe : couverture élargie (patchLow 0.14, bareThreshold 0.86),
brins 0.62×0.068, fondu caméra 160/230, ~2.66 M brins ultra
(`470000·AREA_SOFT`). Cerisiers : fleurs +35 % de taille par archétype,
densité +25 %, `blossomDensity` ultra 2.6, budget branches 1.25, massifs
contrastés (`groveScale 0.018`, `groveContrast 0.85`), ~1400 arbres.

**Mesuré en fin de session : ~41 fps ultra** (vue pont au sol). Replis dans
l'ordre si besoin : grass `fadeEnd 230→190` ; trees 1400→1000 ;
`blossomDensity 2.6→2.2` ; anneaux océan 320→280.

---

## Session « nuit + review ADV + textures » du 28/07 (soir)

Trois chantiers : la nuit féérique, la résolution de la review adversariale
`ADV-2026-07-28-DD673B6` (statuts dans `ADVERSARIAL_REVIEW_CLAUDE.md`), et le
détail procédural des surfaces.

**La nuit.** Le diagnostic n'était pas « réglages trop sombres » mais
géométrique : la lune (dec −7) culminait à 50° alors que l'orbite ne cadre
jamais au-dessus de ~20°, et l'extinction d'horizon des étoiles
(smoothstep −0.015→0.17) tuait précisément la bande 0–10° — la seule visible.
Correctifs : `moonDeclination −34` (culmination 24°, lune basse cadrable, le
commentaire d'origine croyait −7 « plus bas » que l'anti-soleil : c'est
l'inverse), disque ×1.7 (angularRadius 0.030) et éclat 2.4 ; étoiles pleine
force dès 3.4° (smoothstep −0.04→0.06), alpha plancher 0.50, taille ×~1.7,
4800 étoiles ; terre nocturne ×~3 (lune 1.0 vs soleil 4.3, hemi 0.50 et bleu
saturé 0x1d3a78 qui SURVIT au toe ACES, exposition nuit 0.80) ; dôme/Voie
lactée éclaircis ; clés de brouillard NOCTURNES ×1.4 (le FOG_SCALE global
reste 0.25 — le jour est calé) avec bleu 0x101c40 ; bloom nuit seuil 0.42
(0.30 noyait le disque dans son propre halo) ; decks nuages +20-30 %.

**Review — tout accepté, tout traité** (contre-vérification indépendante : les
8 claims étaient vrais ; P2.7 pire qu'annoncé, le vrai bord du disque océan
était nearR+farR = 5768). Résolutions notables :
- Tier de qualité résolu AVANT boot (`?q=` → localStorage → défaut) ; bouton
  = persist + reload ; `rebuildForQuality()` SUPPRIMÉ avec sa duplication.
- `river.bridgeInfo` (placement final, shift compris) = source de vérité du
  chemin (`initPath`, appelé avant l'herbe) et des lanternes de culées.
- Boucle morte du profil supprimée, warn si source mal placée, clamp
  jamais-remonter FINAL (politique tidale documentée dans river.js).
- Champs de distance PAR BRANCHE, min à la requête → triplet (dist,t,b)
  cohérent, plus de saut de largeur aux frontières de Voronoï.
- `build()` idempotent + `dispose()` complet.
- `makeOceanDisc` : farR est désormais VRAIMENT le rayon extérieur (l'ancien
  `nearR·t + farR·t⁵` débordait de 844 u) ; `CAMERA.far` dérivé du pire cas
  caméra (maxDistance + bord océan) ≈ 7091.
- Enveloppe nuages dérivée de `CAMERA.maxDistance` (×1.18/×0.82/×1.08),
  tiers +1 rangée/colonne pour tenir la densité.
- **`test/invariants.html`** : 8 assertions numériques, console
  `INVARIANTS: 8 pass, 0 fail`. Leçon de test : un transect à la jonction
  traverse LÉGITIMEMENT jusqu'à 3 chenaux — compter les bandes (> 3 = trou),
  pas les ré-entrées.

**Textures.** Doctrine préservée (zéro image) : `detailtex.js` génère des
bump maps en bruit de valeur PÉRIODIQUE seedé (le bruit lib ne tile pas — un
lattice enveloppant si). Terrain : bumpMap grain (repeat 96) + octave fine +
STRATES sur pente forte (falaise ouest) ; rochers : grain minéral + veines en
position-monde (par fragment, instance-safe) ; bois pont/torii : veinage
anisotrope (UV conservés dans makeToriiGeometry — les primitives en ont
toutes) ; chemin : speckle position-monde (le ruban n'a pas d'UV).

**Perf (indicatif, M4 Max, ultra)** : 41–64 fps selon la vue (64 aérien midi,
~41 au sol près du pont) avant Phase C ; cold start ultra ~20 s, low < 8 s
(terrain 320²). Matrice complète par tier : à faire proprement (les mesures
rAF sous CDP sont faussées par l'étranglement d'onglet en arrière-plan —
piège n°8).

---

## Reste à faire, dans l'ordre

1. **Relire les trois nouveaux modules** (`ponds`, `birds`, `clouds`). Ils ont
   été écrits puis relus par des agents adverses, et ils tournent, mais
   personne ne les a encore jugés à l'œil dans la vraie scène à toutes les
   heures du jour. Vérifier en particulier les nuages à l'aube et au crépuscule.
2. **Les cerisiers.** Maintenant que la structure de branches se construit
   vraiment (voir #6), ils lisent comme un verger clairsemé plutôt que comme un
   nuage rose. C'est une question de goût, pas un bug : les leviers sont
   `blossomDensity` dans `main.js` et `size` par archétype dans `sakura.js`.
   Grossir les fleurs remplit une couronne plus vite que d'en ajouter.
3. **Bande grise au zénith** quand la caméra pique vers le bas : c'est la bande
   de brume d'horizon de Preetham vue de près. Cosmétique, mais à surveiller.
4. **Peaufinage** — ombres portées des nuages sur l'île, rayons crépusculaires,
   son (le module oiseaux expose déjà `onEvent` pour les cris).

---

## Pièges de débogage propres à cet environnement

1. **`OrbitControls.update()` repositionne la caméra même quand `enabled` est
   `false`.** Toute caméra placée à la main est écrasée à la frame suivante.
2. **`preserveDrawingBuffer` est `false`** : une capture d'écran prise pendant
   que la boucle rAF est arrêtée saisit un tampon vidé. Rendre la boucle avant
   de capturer.
3. **Un onglet en arrière-plan** étrangle `requestAnimationFrame` **et**
   `setTimeout`. Pour simuler du temps, épingler `__sk.clock.getDelta` et
   appeler `__sk.frame()` en boucle synchrone.
4. `globalThis.__sk` expose `{ world, scene, camera, renderer, controls, THREE,
   frame, setCamMode, clock }`.
5. **L'enroulement des triangles contre l'attribut `normal`.** Ce projet s'est
   fait avoir QUATRE fois : le disque d'océan, la corolle des fleurs, les ailes
   des oiseaux, et le ruban du chemin (invisible en silence sur un matériau
   `FrontSide` — diagnostiqué en le forçant en rouge puis en `DoubleSide`).
   Sur un matériau `DoubleSide`, three inverse la normale d'ombrage
   pour la face arrière ; si l'enroulement géométrique regarde vers le bas alors
   que l'attribut dit vers le haut, la surface est éclairée par en dessous et
   sort noire — sans aucune erreur, avec tous les uniformes corrects.
6. **`instanceColor` sans `vertexColors: true`** ne fait rien : le chunk
   `color_fragment` de three est gardé par `USE_COLOR` seul, donc la couleur est
   téléversée, multipliée dans l'étage sommet, puis jamais lue. Il faut les deux,
   plus un attribut `color` blanc sur la géométrie.
