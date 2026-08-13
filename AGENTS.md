# Sakurajima — doc projet pour agents

Scène Three.js (0.185.1 vendorisé dans `vendor/three/`, importmap local,
**aucun build**) : île japonaise
procédurale, cerisiers en fleur, réseau de chemins lanternés, cycle jour/nuit, shiba
jouable. Direction artistique longue dans `PLAN.md` ; journal des sessions et
pièges dans `REPRISE.md` (**convention : y consigner chaque session**).

## Rôles de l'équipe d'agents (convention utilisateur)

- **Claude (Fable ou Opus) — session principale** : planifie, orchestre,
  review — ne code pas lui-même les gros chantiers. Ne PAS dépenser le
  modèle principal en implémentation déléguée.
- **Codex sol, effort high — IMPLÉMENTATION** : sous-agent `codex-rescue` du
  plugin Codex. ÉCRIT le code, un chantier à la fois, d'après un brief précis
  de Claude (fichiers, ancrages, contraintes AGENTS). Le brief doit lui
  interdire explicitement de sous-traiter : laissé libre, il re-délègue et
  attend un sous-agent qui ne répond jamais (40 min perdues le 02/08, zéro
  octet écrit).
- **Codex sol, effort high — REVIEW ADVERSARIALE** après chaque passe
  substantielle — via le skill du plugin Claude Code `codex:adversarial-review`,
  PAS en appelant le CLI codex à la main (consigne utilisateur).
  Le rapport va dans `ADVERSARIAL_REVIEW_CLAUDE.md`
  (versionner l'id `ADV-...`), avec table de suivi remplie par Claude au
  traitement.
- Après chaque chantier d'implémentation : `git diff` relu par Claude,
  `node --check`, `test/invariants.html` (tous les invariants pass),
  vérification visuelle navigateur, PUIS commit.

## Lancer

```sh
python3 serve.py 5173     # JAMAIS python -m http.server (cache les modules ES)
# http://127.0.0.1:5173/index.html
```

- Debug : `globalThis.__sk = { world, scene, camera, renderer, controls, THREE, frame, setCamMode, clock }`.
- `world.dayTime` (0–1, 0.5 = midi), `world.paused`, `world.heightAt(x,z)`, `world.inWater(x,z)`.
- Chargement ultra ≈ 20 s (bake terrain 769² + placements). Printemps ultra sur
  M4 Max, cible 3600×1896, caméra verrouillée : **33.7 fps** au cadrage
  d'ouverture, **24.6** au sol ; automne 59 / 49.3 (le « ~41 fps » d'avant venait
  d'une mesure faussée, cf. piège 9). Le poste dominant est le FEUILLAGE de la
  forêt — 88 % du temps de frame en vue large, 75 % au sol.
- Contrôles : ZQSD promène le shiba, `Maj` court, `C` bascule la caméra,
  Espace saut, `P` pause du temps.

## Architecture (qui fait quoi, qui dépend de qui)

```
config.js   — TOUTES les constantes d'art direction + presets qualité
noise.js    — PRNG seedé (streamFor), noise2/fbm2/ridged2, smoothstep/clamp/mix
island.js   — heightfield analytique → grille bakée → mesh terrain + océan + rochers
ponds.js    — 3 étangs à koi (seul carve composé dans le heightfield)
grass.js    — brins instanciés, LOD par chunks, plancher 0.55 là où il y a des brins
sakura.js   — 5 archétypes sakura/momiji, feuillage instancié (saison au boot)
details.js  — fleurs sauvages, RÉSEAU DE CHEMINS (3 routes) + TORII + LANTERNES
              générées le long des routes, galets (exporte isOnPath, initPath)
detailtex.js— bump maps GÉNÉRÉES (bruit périodique seedé) : grain sol/roche, veinage bois
sky.js      — soleil/lune/étoiles/brouillard/ombres (courbes keyframées par heure)
clouds.js / birds.js / petals.js / wind.js / season.js / seasonal-foliage.js
fireflies.js / butterflies.js / particles.js — faune, pétales, poussière
poi.js      — landmarks authorés (kuromatsu, rocher d'assise) + stoneYAt
crabs.js    — crabes de laisse (fuite, enfouissement)
shiba.js / shiba-geom.js / shiba-gltf.js — chien (glTF + repli procédural)
touch.js / boot.js — commandes tactiles, voile d'erreur
main.js     — le SEUL endroit où tout est câblé + boucle de rendu
```

Le cœur : main.js compose `carve = ponds(h)` dans le heightfield de l'île.
**`island.heightAt` est la source de vérité unique** — mesh et samplers
interpolent exactement les mêmes triangles. `world.inWater = ponds.isInPond`.
LA RIVIÈRE ET LE PONT ONT ÉTÉ SUPPRIMÉS le 29/07 sur décision utilisateur
(après 5 itérations d'eau) — ne pas les réintroduire sans demande explicite.

## Contrats (à respecter sous peine de casse silencieuse)

- **`LAND_SCALE`** (`config.js`, = 1.42·√5) : toute coordonnée XZ auteur est
  multipliée par lui À SA DÉFINITION. Les hauteurs suivent **`HEIGHT_SCALE`**
  (1.4), appliqué UNE fois dans `analyticHeight` — jamais les deux.
- **`AREA` vs `AREA_SOFT`** (`config.js`) : les scatters bon marché (fleurs,
  galets) scalent en `AREA = L²` ; les coûteux (herbe, arbres, pétales,
  rochers) en `AREA_SOFT = AREA^0.75`, compensé par des instances plus grosses.
  Honnêteté : `AREA_SOFT` est la POLITIQUE par défaut, pas une protection — le
  coefficient herbe ultra a été volontairement monté (300k→560k, ≈3.17 M de
  brins) à la demande de l'utilisateur, un choix de goût pour la machine cible.
  Les vrais replis machine faible sont les tiers low/high.
- **`sunDistance` dérive du rayon d'ombre réel** (`sky.js`, `shadowEnvelope`) :
  `R ≈ 1.30 · island.radius + 10` (côte + rochers, pas `125 · LAND_SCALE`),
  `D = R + 220`, near = `D − R − 80` (= 140). Changer R sans D rend le near
  **négatif** (ombres mortes, zéro erreur). Le fallback `SKY_TUNE` utilise
  la même formule, pour qu'un argument oublié ne puisse pas tuer les ombres.
- **Changement de qualité = reload** : le tier est résolu AVANT le boot
  (`?q=` → localStorage `sakurajima.quality` → défaut : `ultra`, ou `high` si
  le pointeur est grossier — un téléphone ne survit pas au bake ultra) ; le
  bouton persiste et recharge. Il n'existe PLUS de rebuild à chaud ni de câblage dupliqué —
  chaque système se dimensionne à la construction, un point c'est tout.
- **Réseau de chemins = `PATHS`** (`config.js`) : 3 routes depuis un carrefour
  en lisière de prairie — 'torii' (grimpe à la terrasse de la falaise ouest,
  rim rehaussé à 12.5·H pour un vrai dénivelé), 'etangs' (boucle fermée,
  premier point = dernier), 'plage'. `details.js` : un ruban par route,
  `isOnPath(x, z, extra)` sur TOUTES les routes (demi-largeur = `PATH_HALF`,
  le max après remap fbm), lanternes GÉNÉRÉES le
  long des routes (quinconce, sautées si pente > 0.9 ou sol trop bas — AUCUNE
  lanterne orpheline, consigne utilisateur), torii aux fractions `toriiAt` de
  la route 'torii'. `main.js` appelle `initPath()` AVANT `createGrass`, et
  les cerisiers excluent `isOnPath(x, z, 4)` (aucun arbre sur un chemin,
  consigne utilisateur).
- **Les rubans se posent COLLÉS puis se dégagent triangle par triangle**
  (`clearRibbonTriangles`, details.js) : `y = heightAt + bombé`, puis chaque
  triangle est relevé du déficit mesuré sur l'arrangement exact ruban ∩ grille
  bakée (marge 0.02). Le treillis barycentrique n'est qu'un fallback si
  `heightGrid` est absent — il ne prouve pas le dégagement. Relever les TROIS
  sommets du même montant translate le plan sans le pencher — la passe est
  monotone, donc elle converge. Ne PAS revenir à une sonde de voisinage : un max
  (ou un résidu de plan) sur un disque paie la pente et la concavité, qui ne
  perforent jamais, et fait FLOTTER le chemin (~1 u, deux régressions payées).
  La terrasse du belvédère est un **patin à anneaux** (pas un éventail) : clip
  par azimut **avant** le dégagement, sinon le sommet centre soulève toute la
  dalle. `pathSurfaceLiftAt` — surface de marche du shiba et de la caméra — ne
  peut pas rejouer ce dégagement par requête ponctuelle : c'est un bombé pur,
  dont l'écart à la surface visible est BORNÉ par un invariant (≤ 0.25).
- **`createSakuraForest` et `createGrass` ignorent en silence les options
  inconnues.** sakura veut `isLand`, `windUniforms`, `quality` **numérique**
  (un objet → budget NaN → arbres sans branches). grass veut `count`, `bounds`,
  `exclude` / `shortZone` (pas `quality`). Sur la sente l'herbe est **rase**
  (`shortZone` → `isOnPath`), plus une exclusion dure.
- La falaise ouest vit dans `analyticHeight` (secteur angulaire plein-ouest,
  rim + chute) — pas un mesh séparé, tout suit (couleurs, pente, herbe).

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
8. Onglet en arrière-plan = rAF ET setTimeout étranglés.
9. **Mesurer les fps demande DEUX précautions, sinon les chiffres sont inventés.**
   (a) `__sk.frame()` ne fait que SOUMETTRE à la GPU, il ne l'attend pas : une
   boucle forcée annonçait 1413 fps. Resynchroniser par un
   `gl.readPixels(0,0,1,1,…)` après chaque frame. (b) La caméra bouge toute seule
   — `OrbitControls.autoRotate` est actif au boot, et si `world.camMode` vaut
   `'follow'` le rig tierce personne la ramène derrière le shiba à chaque frame :
   elle dérivait de **992 u** pendant un banc qu'on croyait cadré. Avant toute
   mesure : `__sk.setCamMode('orbit')`, `controls.autoRotate = false`,
   `controls.enableDamping = false`, puis VÉRIFIER que la dérive est nulle sur la
   durée du banc. Avec les deux, les mesures tiennent à ±0.3 fps.
10. **Le coût du feuillage est géométrique, pas fill-rate** : DPR 2 → 1 → 0.5 ne
   change rien (21.3 / 21.6 / 21.8 fps). Baisser la résolution ne rapporte RIEN ;
   le seul levier est le nombre d'instances soumises. Corollaire : l'ordre des
   instances compte aussi — mélanger le feuillage par instance coûte 18 % au sol
   par perte de localité de rasterisation (cf. `FOLIAGE_SHUFFLE_BLOCK`).

## Vérification type

1. **`test/invariants.html`** (via serve.py) : la console doit finir par
   `INVARIANTS: N pass, 0 fail` (N grandit avec les chantiers, seul le
   `0 fail` est immuable) — chemin sur terre ferme, far plane, nuages,
   étangs carvés, routes hors étangs, la route des torii grimpe à la falaise,
   aucune lanterne orpheline, les trois de la terre battue (dégagée du
   terrain, collée à ≤ 0.55 u, hauteur logique fidèle à la surface visible),
   puis les cinq du chien et de l'eau : flottaison (le dos sort de l'eau),
   pattes posées sur le sol logique, `pondWaterYAt` cohérent et sans route
   mouillée, étangs nageables ET franchissables, bancs d'ondes koi/chien
   disjoints, plus celui des lucioles. **`ponds.attach()` est appelé TÔT**, juste
   après l'île, parce que l'habitat des lucioles en a besoin : il réécrit `PONDS`
   avec les valeurs MESURÉES, donc l'invariant 4 travaille sur des rayons
   mesurés et non authorés. Vérifié dans les deux ordres.
   **Le tier du bake se choisit par `?q=low|high|ultra`, défaut low.** `heightAt`
   interpole la grille BAKÉE : low (~4.6 u de pas) est le terrain le plus lisse,
   donc le cas le PLUS FACILE. Toute retouche de la géométrie des chemins se
   repasse en `?q=ultra` — c'est là que le correctif C-ter s'est fait prendre
   (élévation 1.11 u en ultra contre 0.93 en low, pour un plafond de 0.55).
2. Visuel — midi (`__sk.world.dayTime = 0.5`) : mer jusqu'à l'horizon sans
   ligne rasoir, ombres présentes jusqu'à la côte (si absentes → near-plane,
   piège sky.js). Herbe : plancher 0.55 **à la caméra suivie, sur la prairie**
   (là où des brins existent). L'ouverture postcard peut n'être que de
   l'albedo — `fadeEnd` 330, coût géométrique, piège 10. Nuit (0.97) : lune
   basse au sud avec halo, étoiles dans la bande 0–20°, terre lisible,
   lanternes allumées le long des trois routes. Vue sol : chemins de terre
   granuleux, herbe **rase** dessus (`shortZone`), torii debout sur la montée,
   aucun arbre sur un chemin. La laisse de mer est fermée (houle ≠ étang) ;
   la pose de nage ne pompe pas avec la vague.
3. Tiers : `?q=low|high|ultra` — aria-pressed reflète le tier réel au boot.
