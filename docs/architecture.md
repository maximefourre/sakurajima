# Architecture et contrats — détails

Version courte des règles : `AGENTS.md`. Ici, le pourquoi.

## Modules

```
config.js   — TOUTES les constantes d'art direction + presets qualité
noise.js    — PRNG seedé (streamFor), noise2/fbm2/ridged2, smoothstep/clamp/mix
island.js   — heightfield analytique → grille bakée → mesh terrain + océan + rochers
ponds.js    — 3 étangs à koi (seul carve composé dans le heightfield)
grass.js    — brins instanciés, LOD par chunks, plancher 0.55 là où il y a des brins
sakura.js   — 5 archétypes sakura/momiji, feuillage instancié (saison au boot)
details.js  — fleurs sauvages, RÉSEAU DE CHEMINS (4 routes) + TORII + LANTERNES
              générées le long des routes, galets (exporte isOnPath, initPath)
bamboo.js   — bosquet instancié à l'est (fût + feuillage, vent partagé)
detailtex.js— bump maps GÉNÉRÉES (bruit périodique seedé) : grain sol/roche, veinage bois
sky.js      — soleil/lune/étoiles/brouillard/ombres (courbes keyframées par heure)
clouds.js / birds.js / petals.js / wind.js / season.js / seasonal-foliage.js
cloud-shadow.js — fbm XZ dérivé du vent, uniforms partagés terrain/rochers/herbe
fireflies.js / butterflies.js / moths.js / particles.js — faune, pétales, poussière
audio.js     — SFX call/flush/bark + lits d'ambiance (surf, bambou, cigales, grenouilles)
herons.js   — hérons échassiers des bas-fonds, envol si shiba proche
              (`onFlush` / `lastFlush` / `forEach` pour le regard du chien)
shiba.js    — gestes aboie / secoue / regard : `onEvent('bark')`,
              `setLookTargets([{x,y,z,kind}])`, `notify('heron-flush')`
dragonflies.js — libellules GPU au-dessus des bassins (jour)
midges.js   — moucherons : essaims de berge au crépuscule (N fixe par tier, contre-jour)
poi.js      — landmarks authorés (côte, pas japonais, signes, torii marin, chashitsu) + stoneYAt
chashitsu.js — pièce de thé abandonnée, site lisière étangs, importée par poi.js
crabs.js    — crabes de laisse (fuite, enfouissement)
gulls.js    — goélands posés sur stacks / nuki du torii marin
shiba-geom.js — le chien, modelé ici : SDF → surface nets → peau skinnée (21 os),
              oreilles/queue/mâchoire/yeux rigides, hooks de pose à 3 articulations
              (pied à plat à l'appui, omoplate qui glisse, assise sur les épaules),
              colonne vivante : flexion latérale au pas/trot, flexion/extension
              au galop, dos arqué en virage, queue qui suit le bassin.
              `SIT_POSE` = seule source des angles d'assise. Aucun asset tiers.
              Atelier : tools/shiba-studio.html (?view=side&pose=sit&stretch)
touch.js / boot.js — commandes tactiles, voile d'erreur
main.js     — le SEUL endroit où tout est câblé + boucle de rendu
```

## Deux modèles de vent

`wind.js` (train de rafales, `uWindDir` vec2) pilote herbe, pétales, fleurs,
oiseaux. `sakura.js` exporte un `WIND_GLSL` sinusoïdal (`uWindDir` vec3)
consommé par les couronnes ET `bamboo.js`. `main.js` possède `forestWind` :
adaptateur vec2→vec3 rafraîchi chaque frame. Passer `createWind().uniforms` à
`createSakuraForest` est un no-op silencieux.

## Terrain

`main.js` compose `carve = ponds(h)` dans le heightfield de l'île.
`island.heightAt` est la source de vérité unique : mesh et samplers
interpolent exactement les mêmes triangles. `world.inWater = ponds.isInPond`.
La falaise ouest vit dans `analyticHeight` (secteur angulaire plein-ouest,
rim + chute) — pas un mesh séparé, tout suit (couleurs, pente, herbe).
La rivière et le pont ont été supprimés le 29/07 (après 5 itérations d'eau).

## Échelles

- `LAND_SCALE` (= 1.42·√5) s'applique aux coordonnées XZ auteur à leur
  définition ; `HEIGHT_SCALE` (1.4) une seule fois dans `analyticHeight`.
- `AREA = L²` pour les scatters bon marché (fleurs, galets) ;
  `AREA_SOFT = AREA^0.75` pour les coûteux (herbe, arbres, pétales, rochers),
  compensé par des instances plus grosses. C'est une politique par défaut, pas
  une protection : le coefficient herbe ultra est passé 300k→560k→420k
  (≈2.37 M de brins) ; 560k lisait à 20 fps au sol. Les vrais replis machine
  faible sont les tiers low/high.

## Ombres

`sunDistance` dérive du rayon d'ombre réel (`sky.js`, `shadowEnvelope`) :
`R ≈ 1.30 · island.radius + 10` (côte + rochers), `D = R + 220`,
near = `D − R − 80` (= 140). Changer R sans D rend le near négatif : ombres
mortes, zéro erreur. Le fallback `SKY_TUNE` utilise la même formule.

## Qualité

Le tier est résolu avant le boot : `?q=` → localStorage `sakurajima.quality`
→ défaut `ultra`, ou `high` si le pointeur est grossier (un téléphone ne
survit pas au bake ultra). Le bouton persiste et recharge. Pas de rebuild à
chaud : chaque système se dimensionne à la construction.

## Chemins

`PATHS` (`config.js`) : 4 routes depuis un carrefour en lisière de prairie —
'torii' (grimpe à la terrasse de la falaise ouest, rim rehaussé à 12.5·H),
'etangs' (boucle fermée, premier point = dernier), 'plage', 'bambous' (est,
bosse (56,-10)·L).

`details.js` : un ruban par route ; `isOnPath(x, z, extra)` couvre toutes les
routes (demi-largeur = `PATH_HALF`, le max de `pathWidthK`, borne
conservatrice pour arbres/lanternes/POI). La largeur réelle est le champ monde
`pathWidthK` (0.66–1.28, houle ~9 u + lobes ~2 u : sinon bords droits) ;
`onPathDirt(x, z, extra)` suit ce bord visible (herbe rase, fleurs, épaule). Lanternes
générées en quinconce, sautées si pente > 0.9, sol trop bas ou `isInPond`
(le seuil mer rate les bassins carvés). Torii aux fractions `toriiAt` de la
route 'torii'. `initPath()` est appelé avant `createGrass` ; les cerisiers
excluent `isOnPath(x, z, 4)`. Sur la sente l'herbe est rase (`shortZone`).

### Dégagement des rubans

`clearRibbonTriangles` : `y = heightAt + bombé`, puis chaque triangle est
relevé du déficit mesuré sur l'arrangement exact ruban ∩ grille bakée
(marge 0.02). Le treillis barycentrique n'est qu'un fallback sans
`heightGrid`. Relever les trois sommets du même montant translate le plan sans
le pencher : la passe est monotone et converge.

Une sonde de voisinage (max ou résidu de plan sur un disque) paie la pente et
la concavité, qui ne perforent jamais, et fait flotter le chemin (~1 u, deux
régressions payées).

La terrasse du belvédère est un patin à anneaux : clip par azimut avant le
dégagement, sinon le sommet centre soulève toute la dalle.

`pathSurfaceLiftAt` (surface de marche du shiba et de la caméra) ne peut pas
rejouer ce dégagement par requête ponctuelle : c'est un bombé pur, dont
l'écart à la surface visible est borné par un invariant (≤ 0.25).

## Signatures piégeuses

- `createSakuraForest` : `quality` est un nombre (0.6 / 0.9 / 1.25) ; un
  objet `QUALITY` throw.
- `createGrass` throw si on lui passe `quality` (il veut `count`, `bounds`,
  `exclude` / `shortZone`).
- Les faunes (`qualityCount`) veulent le row `QUALITY.ultra`, pas la string.
