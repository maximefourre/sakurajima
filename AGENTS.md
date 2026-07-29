# Sakurajima — doc projet pour agents

Scène Three.js (0.185.1 via importmap unpkg, **aucun build**) : île japonaise
procédurale, cerisiers en fleur, réseau de chemins lanternés, cycle jour/nuit, shiba
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
  `test/invariants.html` (7 pass), vérification visuelle navigateur, PUIS
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
ponds.js    — 3 étangs à koi (seul carve composé dans le heightfield)
grass.js    — brins instanciés, LOD par chunks, plancher de densité 0.55 partout
sakura.js   — 5 archétypes sakura/momiji, feuillage instancié (saison au boot)
details.js  — fleurs sauvages, RÉSEAU DE CHEMINS (3 routes) + TORII + LANTERNES
              générées le long des routes, galets (exporte isOnPath, initPath)
detailtex.js— bump maps GÉNÉRÉES (bruit périodique seedé) : grain sol/roche, veinage bois
sky.js      — soleil/lune/étoiles/brouillard/ombres (courbes keyframées par heure)
clouds.js / birds.js / petals.js / wind.js / shiba.js / season.js / seasonal-foliage.js — atmosphère, saison & personnage
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
  coefficient herbe ultra a été volontairement monté (300k→470k, ≈2.66 M de
  brins) à la demande de l'utilisateur, un choix de goût pour la machine cible.
  Les vrais replis machine faible sont les tiers low/high.
- **`sunDistance` dérive de `LAND_SCALE`** (`sky.js`) : le near-plane d'ombre
  est `D_SUN − R_ISLAND − 80` et devient négatif (ombres mortes, zéro erreur)
  si on remet une constante.
- **Changement de qualité = reload** : le tier est résolu AVANT le boot
  (`?q=` → localStorage `sakurajima.quality` → défaut) ; le bouton persiste et
  recharge. Il n'existe PLUS de rebuild à chaud ni de câblage dupliqué —
  chaque système se dimensionne à la construction, un point c'est tout.
- **Réseau de chemins = `PATHS`** (`config.js`) : 3 routes depuis un carrefour
  en lisière de prairie — 'torii' (grimpe à la terrasse de la falaise ouest,
  rim rehaussé à 12.5·H pour un vrai dénivelé), 'etangs' (boucle fermée,
  premier point = dernier), 'plage'. `details.js` : un ruban par route,
  `isOnPath(x, z, extra = 1.3)` sur TOUTES les routes, lanternes GÉNÉRÉES le
  long des routes (quinconce, sautées si pente > 0.9 ou sol trop bas — AUCUNE
  lanterne orpheline, consigne utilisateur), torii aux fractions `toriiAt` de
  la route 'torii'. `main.js` appelle `initPath()` AVANT `createGrass`, et
  les cerisiers excluent `isOnPath(x, z, 4)` (aucun arbre sur un chemin,
  consigne utilisateur).
- **`createSakuraForest` et `createGrass` ignorent en silence les options
  inconnues.** sakura veut `isLand`, `windUniforms`, `quality` **numérique**
  (un objet → budget NaN → arbres sans branches). grass veut `count`, `bounds`,
  `exclude` (pas `quality`).
  (grille de buckets) branché dans l'`exclude` de l'herbe (les deux sites).
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

## Vérification type

1. **`test/invariants.html`** (via serve.py) : la console doit finir par
   `INVARIANTS: 7 pass, 0 fail` — chemin sur terre ferme, far plane, nuages,
   étangs carvés, routes hors étangs, la route des torii grimpe à la falaise,
   aucune lanterne orpheline.
2. Visuel — midi (`__sk.world.dayTime = 0.5`) : mer jusqu'à l'horizon sans
   ligne rasoir, ombres présentes (si absentes → near-plane, piège sky.js).
   Herbe SANS zone nue (plancher 0.55). Nuit (0.97) : lune basse au sud avec
   halo, étoiles dans la bande 0–20°, terre lisible, lanternes allumées le
   long des trois routes. Vue sol : chemins de terre granuleux, herbe exclue
   dessus, torii debout sur la montée, aucun arbre sur un chemin.
3. Tiers : `?q=low|high|ultra` — aria-pressed reflète le tier réel au boot.
