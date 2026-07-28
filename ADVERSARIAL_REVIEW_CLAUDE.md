# Revue adversariale de l’implémentation Claude

## Suivi de traitement

| Champ | Valeur |
|---|---|
| Identifiant unique | `ADV-2026-07-28-DD673B6` |
| Date de la revue | 28/07/2026 |
| État audité | `main` à `2bc3c43` |
| Implémentation principale auditée | `dd673b6` |
| Statut global | **Traité** (P2.6 partiellement : matrice perf complète par tier reportée, voir REPRISE) |
| Traité par | Claude (contre-vérification indépendante des 8 claims : tous confirmés ; P2.7 était pire qu'annoncé — bord réel du disque océan = nearR+farR = 5768) |
| Date de traitement | 28/07/2026 (soir) |
| Commit(s) de résolution | voir `git log --grep=ADV-2026-07-28-DD673B6` |

### Instruction à Claude

Cette revue ne doit pas être recommencée sur les commits indiqués ci-dessus.
Traiter les remarques ou documenter explicitement leur rejet, puis :

1. renseigner le tableau de suivi ci-dessous ;
2. passer le statut global à **Traité**, **Partiellement traité** ou **Rejeté avec justification** ;
3. indiquer la date et les commits concernés ;
4. conserver l’identifiant `ADV-2026-07-28-DD673B6` dans le message de commit ou le journal de session.

| Point | Statut | Résolution, justification ou commit |
|---|---|---|
| P1.1 — qualité low inaccessible avant le boot et rebuild incomplet | Traité | Tier résolu avant boot (`?q=` → localStorage → défaut) ; bouton = persist + `location.assign` (cold start honnête du tier) ; `rebuildForQuality()` supprimé ; aria-pressed dérivé du tier réel. Vérifié : `?q=low` → terrain 320², aria low:true. |
| P1.2 — placement final du pont non partagé avec chemin/lanternes | Traité | `buildBridge` retourne `{bridge, info}` ; `river.bridgeInfo` exposé (centre, axe, culées réelles, shift) ; `initPath(bridgeInfo)` recale le dernier point du chemin sur la culée réelle (appelé avant l'herbe) ; lanternes dérivées de `bridgeInfo.ends`. Invariant 5 : fin du chemin < 8 u de la culée. |
| P2.3 — garde-fou du profil fluvial sans effet en amont de `src` | Traité | Boucle morte supprimée ; `console.warn` si argmax > 5 % des stations ; clamp jamais-remonter FINAL après lissage + blend mer + ré-épinglage, politique tidale documentée. Invariant 1. |
| P2.4 — distance interpolée et identité de branche incohérentes | Traité | Champs bakés PAR BRANCHE (`_fieldDistB/_fieldTB`), bilinéaire par branche puis argmin à la requête — triplet (dist, t, b) cohérent. Invariant 3 (≤ 3 bandes par transect de jonction). |
| P2.5 — `river.build()` non idempotent et absence de `dispose()` | Traité | La factory possède rubans de branches + pont ; build() retire+dispose les précédents ; `dispose()` ajouté. Invariant 4 (children stables après 2ᵉ build). |
| P2.6 — justification de performance `AREA_SOFT` insuffisante | Partiellement traité | Docs réécrites honnêtement (AGENTS/REPRISE : AREA_SOFT = politique, coefficient herbe monté volontairement à la demande de l'utilisateur). Matrice perf complète par tier reportée — les mesures rAF sous CDP sont faussées par l'étranglement d'onglet (REPRISE, piège 8) ; valeurs indicatives consignées. |
| P2.7 — far plane non garanti au zoom orbital maximal | Traité | Pire encore que signalé : `makeOceanDisc` sortait à nearR+farR (5768). Formule corrigée (farR = vrai rayon extérieur) ; `CAMERA.far` dérivé du pire cas caméra (maxDistance + bord océan + marge ≈ 7091). Invariant 6 (lu depuis la boundingSphere du mesh construit). |
| P3.8 — enveloppe des nuages et documentation incohérentes | Traité | `FIELD_HALF/FADE_*` dérivés de `CAMERA.maxDistance` (×1.18/×0.82/×1.08), commentaires réécrits, tiers +1 rangée/colonne. Invariant 7. |
| P3.9 — duplications normalisées comme contrats | Traité | La duplication herbe/pétales a DISPARU (reload au changement de tier) ; le pont a une source de vérité unique (`bridgeInfo`) ; AGENTS.md réécrit en ce sens. |
| P3.10 — couverture de test insuffisante | Traité | `test/invariants.html` : 8 assertions numériques sur le vrai pipeline (tier low), sortie console greppable `INVARIANTS: 8 pass, 0 fail`. Matrice visuelle 4 heures × 5 vues exécutée à la main pendant la session. |

## Verdict

L’ensemble est ambitieux, cohérent visuellement dans son intention et nettement mieux documenté que la moyenne. En revanche, plusieurs commentaires présentent comme garantis des comportements que l’architecture ne garantit pas réellement. Le défaut principal n’est pas un détail cosmétique : le mode de qualité « low » ne remplit pas sa fonction de repli pour machine faible. Le second risque important vient des repères du pont, du chemin et des lanternes, calculés par trois chemins différents.

Je ne recommande pas d’ajouter de nouvelles features avant d’avoir fermé les points P1 ci-dessous et posé des tests d’invariants sur le delta.

## P1 — à corriger avant de considérer cette passe solide

### 1. Le sélecteur de qualité est trompeur et le mode low n’est pas un vrai mode de secours

Éléments concernés :

- `src/config.js:136-176`
- `src/main.js:95-109`
- `src/main.js:243-378`
- `src/main.js:539-593`

`DEFAULT_QUALITY` vaut `ultra` et aucun choix n’est lu avant `boot()`. Le panneau de qualité n’apparaît qu’après la construction de la scène. Une machine faible doit donc d’abord supporter :

- le terrain ultra en 768 × 768 quads ;
- environ 1 414 arbres et 28 prototypes ;
- 622 rochers ;
- les détails ultra, dont environ 25 205 fleurs sauvages ;
- les nuages, oiseaux et étangs ultra ;
- environ 48 093 pétales au premier chargement ;
- environ 2 659 242 brins d’herbe au premier chargement.

Ensuite, `rebuildForQuality()` ne reconstruit que l’herbe et les pétales, puis ajuste le DPR, les ombres et le bloom. Le terrain, les rochers, la forêt, les détails, les nuages, les oiseaux et les étangs restent dans leur tier initial ultra. Le commentaire « Only the instance-count-heavy systems need rebuilding » est factuellement faux : la forêt et les détails sont eux aussi fortement dépendants du tier.

Conséquences :

- « low » ne peut pas sauver un chargement qui échoue ou sature avant l’apparition de l’UI ;
- passer d’ultra à low laisse une scène hybride, pas une scène low ;
- les chiffres et attentes de `QUALITY.low` ne décrivent jamais l’état réel obtenu depuis l’UI ;
- un diagnostic de performance devient ambigu, car `world.quality === "low"` ne prouve pas que les systèmes sont en low.

Suggestion :

1. Choisir le tier avant `boot()` — paramètre d’URL, préférence persistée, écran de préchargement ou défaut moins agressif.
2. Soit reconstruire tous les systèmes dépendants du tier, soit assumer explicitement que le bouton ne règle qu’un sous-ensemble et le renommer.
3. Exposer dans le HUD les compteurs réellement actifs, pas seulement le label demandé.

Critère d’acceptation : un cold start en low ne doit jamais allouer les ressources ultra, et un passage ultra → low doit produire les mêmes budgets qu’un cold start low, ou l’UI doit annoncer clairement qu’il s’agit d’un repli partiel.

### 2. Le pont se déplace, mais le chemin et les lanternes restent sur sa position théorique

Éléments concernés :

- `src/river.js:527-569`
- `src/details.js:394-413`
- `src/config.js:180-195`

`buildBridge()` recherche une meilleure paire de culées et translate le pont de `shift ∈ [-12, 12]` le long de son axe. Cette transformation finale reste locale à `buildBridge()` et n’est ni retournée par `build()`, ni exposée par l’API de la rivière.

À l’inverse, `details.js` recrée sa propre courbe, reprend `RIVER.bridgeAt`, puis pose les lanternes autour du centre nominal sans connaître `shift`. Le commentaire disant qu’elles « land on its actual abutments » est donc incorrect. Le chemin est lui aussi authoré indépendamment et se termine près de la culée nominale.

Conséquences possibles :

- lanternes décalées jusqu’à 12 unités par rapport aux culées ;
- une ou plusieurs lanternes supprimées par le filtre `usable` alors que la culée réelle est valide ;
- chemin qui aboutit à côté du pont ;
- zone d’exclusion d’herbe qui suit le chemin nominal, pas forcément la connexion réelle au tablier.

Ce défaut est architectural : une inspection visuelle satisfaisante avec le seed actuel ne le rend pas robuste à une modification de terrain, d’échelle, de travée ou de `bridgeAt`.

Suggestion : faire du placement final du pont une donnée partagée, par exemple `{ center, axis, ends, baseY, shift }`, puis dériver de ce résultat les lanternes et le dernier segment du chemin. Ne pas recalculer la même landmark depuis `RIVER` dans plusieurs modules.

Critère d’acceptation : pour tout `shift` retenu, l’extrémité du chemin et les lanternes restent à une distance bornée des culées réelles, sans constante dupliquée.

## P2 — défauts ou fragilités techniques sérieuses

### 3. Le garde-fou « source mal placée » du profil fluvial ne fait pas ce que le commentaire promet

Éléments concernés :

- `src/river.js:616-646`

Pour le tronc, le code cherche la station la plus haute dans `src`. Si `src > 0`, la boucle amont exécute :

```js
br.profile[i] = Math.min(br.profile[i], bed[i] + RIVER.depth * 0.72);
```

Or `br.profile[i]` vient juste d’être initialisé exactement à `bed[i] + RIVER.depth * 0.72`. Cette boucle est donc un no-op. Puis la monotonie n’est imposée que de `src + 1` vers l’aval.

Si le cas que le commentaire prétend gérer arrive réellement — la première station est plus basse qu’une station suivante — le tronçon `[0, src]` continue de monter dans le sens de l’écoulement. Le code évite certes d’aplatir tout le fleuve au niveau trop bas de la première station, mais il ne produit pas pour autant un profil hydrologiquement valide.

Le seed actuel peut masquer le problème si `src === 0`. Cela reste un invariant non défendu.

Suggestion :

- soit refuser explicitement un tronc dont la station la plus haute n’est pas la source ;
- soit tronquer/repositionner la source ;
- soit calculer une régression isotone avec contraintes de source et d’embouchure.

Critère d’acceptation : après lissage et raccord à la mer, vérifier automatiquement pour chaque branche que `profile[i + 1] <= profile[i] + epsilon`, avec une politique explicitement documentée pour la zone tidale.

### 4. Le champ de distance mélange une valeur continue avec une identité de branche discontinue

Éléments concernés :

- `src/river.js:143-191`
- `src/river.js:243-285`

La distance est interpolée bilinéairement entre quatre texels, tandis que `t` et `b` sont pris en nearest-neighbour sur un seul texel. Près des frontières de Voronoï entre tronc et distributaires, le triplet retourné peut donc combiner :

- une distance issue du mélange de plusieurs branches ;
- un `t` et un `b` provenant d’une seule branche arbitrairement choisie.

Cette incohérence alimente ensuite `widthKAt(b, t)`, le carve et `isInRiver()`. Elle peut créer des changements de largeur ou de rejet par paliers exactement là où le delta doit être le plus continu.

Ce n’est pas une preuve qu’un artefact est visible avec le seed actuel, mais le modèle de données rend l’artefact possible par construction.

Suggestion : baker une distance par branche puis choisir le minimum cohérent au moment de la requête, ou stocker suffisamment d’information pour que distance, `t` et branche proviennent du même candidat. À défaut, ajouter une sonde de continuité autour des jonctions.

Critère d’acceptation : une grille de probes transversales autour de chaque split ne doit montrer ni saut de largeur, ni trou dans `isInRiver`, ni dérivée brutale du carve hors du bruit de rive prévu.

### 5. `river.build()` n’est pas idempotent et la rivière n’a pas de cycle de vie complet

Éléments concernés :

- `src/river.js:602-723`
- `src/river.js:764`

À chaque appel, `build()` :

- remplace et dispose uniquement la géométrie du ruban principal ;
- ajoute de nouveaux meshes de distributaires ;
- ajoute un nouveau pont complet, ses géométries et ses matériaux.

Les branches et ponts précédents ne sont ni retirés ni disposés. `createRiver()` n’expose par ailleurs aucun `dispose()`.

Aujourd’hui `boot()` appelle `build()` une seule fois, donc le défaut reste dormant. Mais l’API publique donne l’impression qu’un rebuild est possible, et le projet possède déjà un mécanisme de changement de qualité. Un second appel duplique silencieusement la géométrie et les draw calls.

Suggestion : soit rendre `build()` explicitement one-shot avec une assertion claire, soit faire posséder à la rivière ses branches/pont et les remplacer proprement. Ajouter un `dispose()` symétrique.

Critère d’acceptation : deux appels successifs à `build(heightAt)` doivent laisser le même nombre d’enfants, les mêmes draw calls et aucune ressource orpheline — ou le second appel doit échouer explicitement.

### 6. L’argument de performance d’`AREA_SOFT` est trop optimiste pour l’herbe ultra

Éléments concernés :

- `src/config.js:117-175`
- `REPRISE.md`, section « île ×5 »

La documentation explique que l’échelle d’aire pleine mènerait à environ 3 M de brins, jugés intenables, puis présente `AREA_SOFT` comme le repli. Mais le coefficient ultra passe simultanément de 300 000 à 470 000, ce qui donne environ 2,66 M de brins. Le gain réel face au seuil déclaré intenable n’est que d’environ 11 %.

Le chiffre de 41 fps sur M4 Max est utile, mais une seule vue au sol ne couvre ni le pire cas GPU, ni le temps de chargement, ni la mémoire, ni les autres tiers.

Suggestion : séparer clairement le budget de densité du budget de distance visible, mesurer le worst case et définir une limite mémoire/temps de boot. Si 2,66 M est assumé comme ultra M4 Max, la documentation doit cesser de présenter `AREA_SOFT` comme une protection générale.

Critère d’acceptation : tableau cold-start / mémoire / FPS bas percentile pour low, high et ultra, avec au moins vue aérienne forêt + delta, vue au sol herbe, et crépuscule avec bloom.

### 7. Le far plane ne couvre pas nécessairement tout le disque océan au zoom orbital maximal

Éléments concernés :

- `src/config.js:197-209`
- `src/island.js:796-807`

Le commentaire vérifie seulement que `CAMERA.far` dépasse le rayon du disque océan. Or le far plane mesure la distance depuis la caméra, pas depuis l’origine.

Valeurs actuelles :

- `CAMERA.far ≈ 5 557` ;
- rayon océan ≈ `WORLD.size × 3.37 ≈ 4 923` ;
- distance orbitale maximale ≈ `1 969`.

Une caméra éloignée regardant à travers l’île peut donc avoir le bord opposé du disque à environ 6 892 unités. Le brouillard peut cacher le clipping dans beaucoup de vues, mais la garantie écrite est fausse.

Suggestion : dériver le far plane de la géométrie visible et de l’enveloppe de caméra, ou démontrer par le frustum et le brouillard que les zones clippées ne contribuent jamais.

## P3 — cohérence, documentation et dette de validation

### 8. Le champ de nuages n’est pas « confortablement au-delà » de la caméra

Éléments concernés :

- `src/clouds.js:10-13`
- `src/clouds.js:45-60`

`FIELD_HALF = 620 × LAND_SCALE`, exactement comme `CAMERA.maxDistance`, et `FADE_FAR = 600 × LAND_SCALE`. À la distance orbitale maximale, la caméra est donc déjà au bord, voire au-delà de la zone de fade radial. Les commentaires utilisent encore les anciennes distances absolues (~640) et affirment une marge qui n’existe pas.

Ce n’est pas forcément un bug visuel : faire disparaître les nuages près d’une caméra très reculée peut être acceptable. Mais il faut le tester et documenter le comportement réel.

### 9. La documentation centralise les pièges, mais normalise aussi des duplications fragiles

`AGENTS.md` signale que le câblage herbe/pétales est dupliqué et doit être modifié « en miroir ». C’est un bon avertissement opérationnel, mais pas une résolution. Le nouveau chemin a déjà nécessité de toucher les deux sites.

De même, `details.js` importe `RIVER` pour reconstruire un placement nominal alors que `river.js` calcule le placement final. Dire aux futurs agents de respecter ces duplications augmente le risque d’une prochaine divergence.

Suggestion : traiter les contrats centralisés comme des dettes à supprimer, pas comme des invariants désirables. Une factory commune pour herbe/pétales et un landmark partagé pour le pont réduiraient beaucoup la surface de casse.

### 10. La couverture de test est insuffisante par rapport au nombre de garanties annoncées

Le dépôt ne contient pas de suite de tests pour les nouveaux invariants. `test/` ne contient qu’une page manuelle dédiée aux pétales. Les contrôles effectués pendant cette revue confirment uniquement :

- syntaxe valide pour tous les fichiers `src/*.js` via `node --check` ;
- absence d’erreur de whitespace via `git diff --check` ;
- cohérence numérique des constantes importables de `config.js`.

Ils ne prouvent pas :

- le raccord visuel des trois bras ;
- l’absence de z-fighting ou de double blend ;
- le placement réel chemin/pont/lanternes ;
- le comportement aux quatre heures clés ;
- les tiers de qualité ;
- la stabilité après rebuild ;
- la performance ou les fuites GPU.

Suggestion de matrice minimale :

| Axe | Cas minimaux |
|---|---|
| Heure | aube 0.235, midi 0.5, coucher 0.79, nuit 0.97 |
| Caméra | ouverture, sol près du pont, aérienne SE du delta, falaise ouest, zoom orbital max |
| Qualité | cold start low/high/ultra, puis ultra → low |
| Invariants | profil descendant, 3 embouchures distinctes, raccords sans trous, chemin connecté à la culée réelle |
| Cycle de vie | deux builds ou erreur one-shot explicite, dispose sans hausse persistante des ressources |

## Ordre de reprise recommandé

1. Rendre le choix low effectif avant le boot et définir si le changement à chaud est complet ou partiel.
2. Exposer le placement final du pont et en faire la source de vérité du chemin et des lanternes.
3. Ajouter des assertions numériques sur le profil et la continuité du delta.
4. Rendre le cycle de vie de `river` explicite.
5. Faire la matrice visuelle et performance avant tout nouveau réglage artistique.

## Conclusion directe

Le travail est inventif et documenté, mais il est trop sûr de lui dans ses commentaires. Plusieurs « contrats » sont en réalité des conventions non vérifiées, et certaines conventions dupliquent précisément les données qui devraient avoir une source de vérité unique. Le prochain passage doit réduire ces écarts entre récit et comportement réel, pas ajouter une nouvelle couche de réglages.
