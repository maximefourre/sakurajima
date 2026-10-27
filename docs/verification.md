# Vérification

## Invariants (`test/invariants.html`)

La console doit finir par `INVARIANTS: N pass, 0 fail` (N grandit, seul le
`0 fail` est immuable). Couverture :

- chemin sur terre ferme, far plane, nuages, étangs carvés, routes hors
  étangs, la route des torii grimpe à la falaise ;
- aucune lanterne orpheline ni dans un étang ;
- terre battue : dégagée du terrain, collée à ≤ 0.55 u, hauteur logique
  fidèle à la surface visible ;
- chien et eau : flottaison (le dos sort), pattes sur le sol logique,
  `pondWaterYAt` cohérent sans route mouillée, étangs nageables et
  franchissables, bancs d'ondes koi/chien disjoints ;
- lucioles, trois signes sacrés, pas japonais (`stoneYAt` fidèle, dalles hors
  ruban), hérons en bas-fonds, libellules dans l'habitat bassin, mites à une
  lanterne, shiba secoué seulement après nage, regard sans lacet du corps,
  chashitsu hors chemin/eau/pente, bambous à l'est du carrefour hors ruban.

`ponds.attach()` est appelé tôt, juste après l'île (l'habitat des lucioles en
a besoin) : il réécrit `PONDS` avec les valeurs mesurées, donc l'invariant des
étangs travaille sur des rayons mesurés et non authorés.

Le tier se choisit par `?q=low|high|ultra`, défaut low. `heightAt` interpole
la grille bakée : low (~4.6 u de pas) est le terrain le plus lisse, donc le
cas le plus facile. Toute retouche de la géométrie des chemins se repasse en
`?q=ultra` (un correctif y montait à 1.11 u contre 0.93 en low, pour un
plafond de 0.55).

## Visuel

- **Midi** (`__sk.world.dayTime = 0.5`) : mer jusqu'à l'horizon sans ligne
  rasoir, ombres jusqu'à la côte (absentes → near-plane, voir
  `architecture.md`). Herbe : plancher 0.55 à la caméra suivie, sur la
  prairie. L'ouverture postcard peut n'être que de l'albedo.
- **Nuit** (0.97) : lune basse au sud avec halo, étoiles dans la bande 0–20°,
  terre lisible, lanternes allumées le long des quatre routes.
- **Vue sol** : chemins de terre granuleux, herbe rase dessus, torii debout
  sur la montée, aucun arbre sur un chemin. Laisse de mer fermée (houle ≠
  étang) ; la pose de nage ne pompe pas avec la vague.
- **Tiers** : `aria-pressed` reflète le tier réel au boot.
