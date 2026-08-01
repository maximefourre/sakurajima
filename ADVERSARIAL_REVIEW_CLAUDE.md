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


---

# Revue ADV-2026-07-28-398087B — passe « immersion » (via skill codex:adversarial-review, gpt-5.6-sol high)

## Suivi de traitement

| Point | Statut | Résolution ou justification |
|---|---|---|
| P2 — relèvement hanami incohérent (accepte 0.45<lift≤1.0 avec pénétration résiduelle) | Traité | Seuil de rejet aligné sur le plafond réellement appliqué : cap ET rejet à 0.65 — plus aucun arbre accepté avec déficit. |
| P2 — terrainH bilinéaire vs interpolation triangulaire de heightAt | Rejeté avec justification | Le filtrage bilinéaire est PLUS lisse que l'interpolation par triangles, la divergence est sous-texel (< l'erreur HalfFloat sur les berges douces, < ~0.3 u sur les plus raides) et tombe dans la bande d'écume de rive qui la masque par construction ; une profondeur négative donne rim=1 → écume à l'intersection réelle eau/berge, précisément l'effet voulu. Reproduire l'interpolation triangulaire coûterait 4 fetches + branches par fragment pour un artefact jamais observé (vérifs visuelles berges/pont/delta). Documenté ici comme limitation assumée. |
| P2 — bascule hi/lo de l'herbe = chute de couverture instantanée ~35 % | Traité (mitigation) | lodKeep 0.45 → 0.62 : couverture lo ≈ 0.62×1.45 ≈ 90 % du hi — le saut passe sous ~10 %. La vraie transition croisée par chunk reste en dette (notée ci-dessous). |
| P2 — keepBlossomSamples garde ~330 Mo de copies mortes (24 o × 13.7 M blossoms) | Traité | `keepBlossomSamples: false` passé par main.js (aucun appel à getBlossomSamples n'existe ; les pétales utilisent forest.emitters). |
| P3 — smoothstep GLSL inversé (edge0>edge1, comportement indéfini) | Traité | `smoothstep(0.55, 0.12, vFade)` → `1.0 - smoothstep(0.12, 0.55, vFade)` ; grep des autres smoothstep GLSL inversés : 8+ occurrences PRÉ-existantes (sakura/grass/sky, antérieures à la passe auditée) laissées en l'état — dette de portabilité notée, à normaliser en lot dédié avec vérification visuelle shader par shader. |

Dette notée : transition croisée temporelle hi/lo par chunk (remplacerait la mitigation lodKeep).

## Rapport Codex (verbatim)

# Codex Adversarial Review

Target: working tree diff
Verdict: needs-attention

ADV-2026-07-28-398087B — No-ship : la passe ne défend pas plusieurs garanties qu’elle annonce. Priorité : collisions hanami, cohérence heightfield/eau, LOD herbe, puis mémoire et portabilité GLSL.

Findings:
- [medium] P2 — Le contrôle hanami accepte encore des branches qu’il sait enterrées (src/sakura.js:1393-1409)
  Le calcul mesure le relèvement nécessaire, rejette seulement au-delà de 1,0 u, puis plafonne pourtant le relèvement appliqué à 0,45 u. Toute occurrence où 0,45 < lift <= 1,0 est donc acceptée avec une pénétration résiduelle de lift−0,45 dans le terrain. Le commentaire affirmant que le placement sauve ou rejette ces cas est faux.
  Recommendation: Appliquer le relèvement complet autorisé, ou rejeter dès que lift dépasse le relèvement maximal réellement appliqué. Critère d’acceptation : après transformation finale, chaque secteur renseigné doit conserver au moins la marge de 0,12 u au-dessus de heightAt ; zéro arbre accepté avec un déficit positif.
- [medium] P2 — La profondeur « réelle » de rivière viole l’interpolation triangulaire du heightfield (src/river.js:464-467)
  terrainH() délègue au filtrage linéaire de la texture, donc effectue une interpolation bilinéaire des quatre texels HalfFloat. island.heightAt et le mesh utilisent au contraire l’un des deux triangles selon fx+fz. Sur les berges fortement creusées, les valeurs divergent précisément là où les seuils de profondeur de 0,03 à 0,42 u pilotent écume et transparence : le shader peut produire profondeur négative, liserés ou eau décalée malgré une géométrie correcte. Cela contredit le contrat de source de vérité unique.
  Recommendation: Échantillonner manuellement les quatre texels puis reproduire la même interpolation par triangles que island.heightAt, ou fournir un champ de profondeur construit avec cette convention. Critère d’acceptation : sur une grille de fragments couvrant centre et deux rives, terrainH doit différer de heightAt de moins que la seule erreur HalfFloat, et la profondeur ne doit pas devenir négative à l’intérieur du ruban.
- [medium] P2 — L’anti-popping herbe conserve un échange instantané de 55 % des brins (src/grass.js:944-969)
  À chaque franchissement du seuil d’un chunk, le code masque intégralement le mesh hi et affiche immédiatement le mesh lo, qui ne contient que lodKeep=0,45 des instances. loWidthMul=1,45 ne compense que partiellement : la couverture linéaire tombe approximativement à 0,45×1,45=65 % de celle du mesh hi. Le changement final réduit l’écart de largeur individuel mais laisse, voire accentue, la chute de densité instantanée revendiquée comme corrigée.
  Recommendation: Faire une transition croisée/dither temporelle ou spatiale entre les deux populations, ou calibrer une représentation lo dont la couverture est réellement équivalente. Critère d’acceptation : une traversée lente des deux seuils d’hystérésis ne doit produire ni saut de compteur rendu en une frame ni variation mesurée de couverture supérieure à 5 %.
- [medium] P2 — Une copie complète et inutilisée de tous les blossoms reste en mémoire (src/sakura.js:1603-1627)
  keepBlossomSamples vaut true par défaut et cette branche conserve deux Float32Array supplémentaires, soit 24 octets par blossom, après avoir déjà construit les attributs GPU. Aucun appel applicatif à getBlossomSamples n’existe : main utilise forest.emitters pour les pétales. Avec 1867 arbres et blossomDensity ultra à 2,2, ce coût croît avec la partie la plus lourde de la passe sans produire d’image ni de gameplay.
  Recommendation: Passer keepBlossomSamples:false depuis main, ou ne construire ces tableaux qu’à la première demande. Critère d’acceptation : rendu et compteurs de pétales identiques, getBlossomSamples non utilisé, et heap de boot réduit d’au moins 24×stats.blossoms octets hors overhead.
- [low] P3 — Le fondu d’embouchure repose sur un smoothstep GLSL indéfini (src/river.js:512-514)
  smoothstep est appelé avec edge0=0,55 supérieur à edge1=0,12. La spécification GLSL laisse ce cas indéfini ; le fondu peut donc changer selon pilote ou backend alors qu’il contrôle la recoloration de l’embouchure.
  Recommendation: Remplacer par 1.0 - smoothstep(0.12, 0.55, vFade). Critère d’acceptation : compilation et captures identiques sur au moins deux familles de GPU, avec mouth=1 sous 0,12, mouth=0 au-dessus de 0,55 et progression monotone entre les deux.

Next steps:
- 1. Corriger et tester le relèvement des arbres.
- 2. Aligner terrainH sur l’interpolation triangulaire de l’île.
- 3. Remplacer le basculement hi/lo de l’herbe par une vraie transition.
- 4. Désactiver la copie sampleCloud inutilisée.
- 5. Normaliser le smoothstep inversé, puis rejouer node --check, les 8 invariants et les parcours visuels pont/berges/LOD.

---

# Revue ADV-2026-07-29-A920146 — passe finale automne momiji

## Suivi de traitement

| Champ | Valeur |
|---|---|
| Identifiant unique | `ADV-2026-07-29-A920146` |
| Date de la revue | 29/07/2026 |
| Plage auditée | `2874276..a920146` |
| Statut | **Traité** |
| Verdict statique | Aucun finding ; revue de branche propre |
| Relecture visuelle | Approuvée après correctifs `e0eb773` et `a920146` |

### Findings et résolutions

| Finding | Statut | Résolution |
|---|---|---|
| Nuits autumn trop sombres | Traité | `e0eb773` rééquilibre le profil nocturne autumn ; lune, étoiles et lisibilité du sol restent préservées sans filtre orange nocturne. |
| Couture mer/ciel à la jonction dorée | Traité | `e0eb773` harmonise l'horizon publié, le brouillard et le ciel ; la couture observée à la golden hour est supprimée. |
| Compteurs HUD du compositeur invalides | Traité | `a920146` corrige les compteurs affichés et leur état de validation ; le HUD ultra reste cohérent pendant la matrice. |
| Revue statique de la plage auditée | Traité | Aucun finding de code retenu sur `2874276..a920146`. Les suites exactes et la relecture visuelle sont consignées dans `REPRISE.md`. |

### Vérification et provenance

Les suites finales sont : `SEASON 8/0`, `FOLIAGE spring 5/0`,
`FOLIAGE autumn 5/0`, `GROUND 34/0`, `ATMOSPHERE 37/0` et
`INVARIANTS 7/0`. La matrice couvre `spring|autumn × low|high|ultra`, avec
les contrôles de midi, de nuit et de golden hour autumn ultra.

Grok CLI était non authentifié et `codex-rescue` a échoué au démarrage du
modèle ; les implémentations et relectures de fallback déléguées ont été
utilisées à la place, ce qui est enregistré explicitement ici.

---

# Revue ADV-2026-07-31-6F5081A — chantiers C-quater / feuilles / hokora

## Suivi de traitement

| Champ | Valeur |
|---|---|
| Identifiant unique | `ADV-2026-07-31-6F5081A` |
| Date de la revue | 31/07/2026 |
| Plage auditée | `d767222..6f5081a` (9 commits, 8 fichiers, +1069/−155) |
| Outil | skill `codex:adversarial-review`, base `d767222`, exécution en tâche de fond |
| Verdict Codex | **needs-attention** — « do not ship » |
| Statut global | **Traité** — finding unique CONFIRMÉ par contre-vérification exacte, puis corrigé et re-vérifié |
| Contre-vérifié par | Claude — vérificateur exact (clipping ruban × triangulation du terrain, aucun échantillonnage), les deux tiers, Chrome réel |
| Commit(s) de résolution | voir `git log --grep=ADV-2026-07-31-6F5081A` |

### Findings et traitement

| Finding | Statut | Résolution, justification ou commit |
|---|---|---|
| [high] Échantillonnage barycentrique fixe (21 points) de `clearRibbonTriangles` : une arête du terrain traversant le triangle entre deux échantillons peut porter le maximum de `heightAt − plan du ruban` ; la marge 0.02 ne borne pas ce maximum non échantillonné. L'invariant ajouté rejoue le même angle mort avec un treillis S=3 plus grossier, donc il peut passer alors que le terrain perfore encore. (`src/details.js:329-360`) | **Traité** | Contre-vérifié exactement (voir ci-dessous) : mécanisme réel, écart important, conséquence pas encore réalisée. Corrigé — l'échantillonnage a disparu du builder ET du banc au profit de l'évaluation exacte. Marge exacte ultra sur TOUS les triangles : **0.0063 → 0.0200**. Commit `git log --grep=ADV-2026-07-31-6F5081A`. |

### Contre-vérification indépendante (Claude, Chrome réel)

`heightAt` est linéaire par morceaux sur une triangulation CONNUE (`island.js:563-580` :
grille régulière, chaque cellule coupée par la diagonale `fx + fz = 1`). Le maximum de
`heightAt − plan du ruban` sur un triangle de ruban est donc atteint sur un sommet de
l'arrangement « triangle de ruban ∩ sous-triangles du terrain » — calculable EXACTEMENT
par clipping, sans aucun échantillonnage. Vérificateur écrit et exécuté sur les 36 088
triangles réellement construits :

| tier  | marge exacte, bande intérieure | marge exacte, TOUS triangles | marge annoncée par le banc |
|-------|--------------------------------|------------------------------|----------------------------|
| low   | 0.0230                         | 0.0230                       | 0.023 (exact)              |
| ultra | **0.0191**                     | **0.0063**                   | 0.025 (**surestimé ×4**)   |

Élévation max exacte 0.2142 (low) / 0.2331 (ultra) — cohérente avec le banc.

Conclusion : **le finding est fondé**. L'échantillonnage rate bien le vrai minimum, et
au tier ultra il annonce une marge quatre fois plus épaisse que la réalité — 0.0063,
soit 1.26× le seuil 0.005. Le chemin ne perfore pas aujourd'hui, mais la garantie
n'était pas prouvée et sa marge réelle est mince. Le calcul exact coûte **~30 ms** sur
l'ensemble des triangles en ultra : rien ne justifie de continuer à échantillonner.

Correctif : évaluation exacte dans le builder ET dans le banc, `island` exposant le
descripteur de sa grille bakée (contrepartie honnête du contrat « `heightAt` est la
source de vérité unique » : qui doit raisonner exactement doit connaître la
discrétisation). Délégué à Codex sol effort high.

Recommandation Codex (retenue telle quelle) : évaluer les extrema induits par les
intersections entre chaque triangle de ruban et la grille bakée du terrain, ou
subdiviser adaptativement avec une borne d'erreur prouvée ; faire porter l'invariant
sur ces points d'intersection exacts, cellules de frange comprises, en `?q=ultra`.

### Résolution (Codex sol effort high, vérifications Claude)

`island` expose `heightGrid = { seg, step, half }` ; `measureRibbonTriangleExact`
(details.js, exportée) clippe chaque triangle de ruban par les deux sous-triangles
de chaque cellule bakée qu'il recouvre, et évalue `plan − heightAt` sur les sommets
du polygone d'intersection. La différence étant affine sur chaque morceau, ses deux
extrema y sont atteints : le résultat est EXACT, pas échantillonné. Le builder
(`clearRibbonTriangles`) et les invariants 8-9 partagent cette unique
implémentation ; l'échantillonnage barycentrique subsiste uniquement comme repli
sans `heightGrid`, documenté comme repli et non comme équivalent.

Mesuré après correctif, sur les 36 088 triangles réellement construits :

| tier  | marge exacte, TOUS triangles | élévation exacte max | passes |
|-------|------------------------------|----------------------|--------|
| low   | 0.0230                       | 0.2142               | 1      |
| ultra | **0.0200** (était 0.0063)    | 0.2331               | 2      |

La marge n'est plus un accident d'échantillonnage : elle vaut exactement
`RIBBON_CLEARANCE_MARGIN`, par construction. `INVARIANTS: 10 pass, 0 fail` aux deux
tiers, recoupé par un vérificateur écrit indépendamment par Claude (mêmes valeurs,
mêmes localisations). Visuel ultra inchangé, 60 fps.

## Rapport Codex (verbatim)

# Codex Adversarial Review

Target: branch diff against d767222
Verdict: needs-attention

Do not ship: the central anti-perforation fix still relies on sampling that cannot guarantee terrain clearance.

Findings:
- [high] Fixed sampling can miss terrain peaks inside ribbon triangles (src/details.js:329-360)
  `clearRibbonTriangles` checks only 21 fixed barycentric points per triangle. `heightAt` is piecewise planar over a separate terrain triangulation, so a terrain edge crossing the ribbon between those samples can contain the maximum of `heightAt - ribbonPlane`; the 0.02 margin provides no bound for that unsampled maximum. The added invariant repeats this blind spot with an even coarser S=3 lattice and therefore can pass while terrain still perforates the visible path. This risks reintroducing the exact green-patch regression the change claims to eliminate.
  Recommendation: Evaluate all extrema induced by intersections between each ribbon triangle and the baked terrain grid, or adaptively subdivide with a proven error bound. Update the invariant to verify those exact intersection points, including rendered fringe cells.

Next steps:
- Replace fixed barycentric clearance sampling with an exact or bounded method.
- Add a regression assertion covering terrain-grid/ribbon intersections at ultra quality.

---

# Revue ADV-2026-08-01-81F0C02 — chantiers shiba, eau et sol

## Suivi de traitement

| Champ | Valeur |
|---|---|
| Identifiant unique | `ADV-2026-08-01-81F0C02` |
| Date de la revue | 01/08/2026 |
| Plage auditée | `78be16d..81f0c02`, branche `chantier/shiba-eau-sol` (7 commits) |
| Outil | skill `codex:adversarial-review`, exécution en tâche de fond |
| Verdict Codex | **needs-attention** — « no-ship » |
| Statut global | **Traité** (3 findings sur 3) |
| Traité par | Claude, contre-vérification indépendante des 3 claims : **les 3 confirmés**, dont **2 portant sur du code écrit par Claude lui-même** (le garde-fou d'ondes et l'invariant 14) |
| Commit(s) de résolution | voir `git log --grep=ADV-2026-08-01-81F0C02` |

### Findings et résolutions

| Finding | Statut | Résolution |
|---|---|---|
| [medium] La durée de vie des anneaux du chien était liée au sillage : `uDogWake.w` coupait la boucle dès qu'il quittait l'empreinte du bassin, tranchant net des ondes en pleine décroissance exponentielle (`src/ponds.js`) | **Traité** | Deux garde-fous **distincts** : `uDogRings` suit la vie des ANNEAUX (TTL 2.6 s, soit `exp(-2.3 × 2.6) = 0.0025`), `uDogWake.w` suit la présence du chien et ne gouverne plus que `pk_wake`. Vérifié en jeu : dans l'eau `rings=1, wake=1` ; à la sortie **`wake=0` immédiatement et `rings=1`** ; 3 s plus tard `rings=0`. C'est mon propre brief qui avait confondu coût du fragment et durée de vie. |
| [medium] Le contrat `water` documenté crashait ses appelants : seul `surfaceAt` était validé, mais `update()` appelle `setSwimmer` **inconditionnellement**, donc même sur terre ferme (`src/shiba.js`) | **Traité** | `impact` et `setSwimmer` sont désormais documentés comme hooks de **présentation optionnels** et normalisés en no-op à la construction. La locomotion ne dépend plus de la présence d'un auditeur d'ondes. |
| [medium] L'invariant 14 pouvait passer au vert avec un étang non nageable : `Math.max` de la profondeur sur TOUS les bassins, et une bande de gué `Infinity` créditée quand un rayon n'atteignait jamais la perte de pied (`test/invariants.html`) | **Traité** | Chaque bassin est jugé **seul** : profondeur minimale par bassin, et un rayon sans perte de pied ne compte plus comme une réussite — il est simplement exclu, avec exigence d'au moins un azimut nageable. Le rapport affiche désormais le bassin **le moins** creux (1.99 u en low, 2.10 en ultra) au lieu du plus creux. |

### Vérification

`INVARIANTS: 15 pass, 0 fail` en tier low **et** en `?q=ultra` — ultra inclus parce
que le prolongement du sentier de la plage ajoute des triangles de ruban sur un
terrain quasi plat : 42 936 triangles couverts, marge exacte 0.0200, élévation
max 0.2309 pour un plafond de 0.550, 43 lanternes sans orpheline.

---

## ADV-2026-08-01-FIREFLY — chantier L, lucioles

| Champ | Valeur |
|---|---|
| Identifiant unique | `ADV-2026-08-01-FIREFLY` |
| Date de la revue | 01/08/2026 |
| Plage auditée | `0875879..HEAD`, focus `src/fireflies.js`, bloc `FIREFLIES` de `config.js`, câblage `main.js`, invariants lucioles |
| Outil | `/codex:adversarial-review --background --base 0875879` |
| Verdict Codex | **needs-attention** — « no-ship » |
| Statut global | **Traité** (5 findings sur 5) |
| Traité par | Claude — contre-vérification numérique indépendante de 3 claims sur 5 : **les 3 confirmés** |
| Commit(s) de résolution | `383de77` |

### Findings

| Finding | Statut | Vérification |
|---|---|---|
| [high] La dérive GPU peut faire passer une luciole SOUS la surface (`src/fireflies.js:230-234`). La garde n'est calculée qu'au semis ; le shader déplace ensuite jusqu'à 2.6 u horizontalement et 0.468 u verticalement sans réévaluer le sol. | **Traité** | **CONFIRMÉ par calcul** : `driftRadius[1] × driftLift = 2.6 × 0.18 = 0.468`, contre `minHeight = 0.40` → garde minimale **−0.068 u**. L'invariant reste vert parce qu'il ne teste que la position semée. |
| [medium] La sphère englobante sous-estime l'amplitude réelle de la dérive (`src/fireflies.js:326-331`). | **Traité** | **CONFIRMÉ par calcul** : borne euclidienne `2.6 × √(1² + 0.82² + 0.18²) = 3.395 u` contre une marge posée de `2.6 + 0.20 = 2.80 u`. Il manque **0.595 u**. |
| [medium] Le budget absolu contredit l'échelle réelle des bassins (`src/config.js:146-182`) : leurs rayons suivent `LAND_SCALE`, donc l'habitat couvre une aire en `LAND_SCALE²` alors que les comptes restent fixes. | **Traité** | **CONFIRMÉ par lecture** : `SITES` de `ponds.js` multiplie bien `radius` par `LAND_SCALE`. Ma justification écrite dans `config.js` (« bassins de taille fixe ») est **factuellement fausse**. |
| [medium] `densityFalloff` encode à la main `-ln(densityFloor)` sans que rien ne garantisse la relation (`src/config.js:272-282`). | **Traité** | **CONFIRMÉ** : `-ln(0.06) = 2.8134` contre `2.81` codé en dur. Le commentaire documente le couplage ; il ne l'impose pas. |
| [medium] Les invariants ne testent ni les trois bassins ni le modèle 78/22 (`test/invariants.html`). Une seule luciole autour d'un seul bassin passerait ; `createFireflies` n'est jamais instancié. | **Traité** | **CONFIRMÉ par lecture** : l'invariant accepte `spots.length > 0`, et aucun des deux ne touche `aFlash`/`aGlow` ni `update()`. |

---

## ADV-2026-08-01-BFLY — chantier P, papillons

| Champ | Valeur |
|---|---|
| Identifiant unique | `ADV-2026-08-01-BFLY` |
| Date de la revue | 01/08/2026 |
| Plage auditée | `0875879..HEAD`, focus `src/butterflies.js`, bloc `BUTTERFLIES`, export `flowerSpots`, câblage, invariants papillons |
| Outil | `/codex:adversarial-review --background --base 0875879` |
| Verdict Codex | **needs-attention** — « no-ship » |
| Statut global | **Traité** (6 findings sur 6) |
| Traité par | Claude — contre-vérification numérique indépendante de 3 claims : **les 3 confirmés**. Module écrit par Claude lui-même après échec de la délégation Codex, et n'ayant jamais eu de second regard. |
| Commit(s) de résolution | `383de77` |

### Findings

| Finding | Statut | Vérification |
|---|---|---|
| [high] La machine à états ne butine pas réellement : `pickFlower` tire 8 indices dans la liste GLOBALE de 25 204 fleurs et abandonne. `PERCHED` se pose en outre à 0.06 u du terrain en ignorant la hauteur réelle de la corolle. | **Traité** | **CONFIRMÉ par calcul** : un disque de 14 u couvre 0.153 % du champ de fleurs → la recherche aboutit dans **1.22 %** des cas. Les papillons ne se posent donc pratiquement **jamais** — c'est-à-dire que la fonctionnalité explicitement choisie par l'utilisateur est non fonctionnelle. |
| [high] Le pilotage CPU invalide la signature de vol : le lacet `-heading` oriente le +Z local perpendiculairement à la vitesse ; `veerChance` est multiplié par `step × 60` ; le roulis global phase-locké explique l'asymétrie. | **Traité** | **CONFIRMÉ par calcul** : produit scalaire vitesse·avant = **0.000000 pour tout cap** — les papillons volent exactement de côté. `Math.PI/2 − heading` donne 1.000000. Et `veerChance 0.16` produit **9.6 embardées/s** au lieu de 0.16. |
| [medium] Le domaine individuel ne borne jamais la position et ne connaît ni terre ni eau ; au-dessus de la mer, `Y` est calculé depuis le fond marin. | **Traité** | Deux garde-fous. **La mer est un mur** : le pas est refusé si `heightAt < seaLevel + 0.5`, et l'individu vire — les étangs restent survolables, leurs fonds étant à ~2.9 u. Puis une **borne dure** à `homeRadius × 1.6`, par projection sur le cercle, que FLEE ne peut pas franchir. Prouvé NON VIDE : sur 60 s de fuites en chaîne le terrain minimal atteint sous un papillon est **exactement 0.50**, soit le seuil lui-même (marge 0.00), avec 1395 échantillons sous 3 u d'altitude. Ils butent donc réellement, à répétition. |
| [medium] La silhouette est tronquée par son quad porteur : le masque reste positif sur ses bords (0.19 au bout d'aile, 0.945 à la queue), donc le rasteriseur coupe droit. | **Traité** | Confirmé par lecture du shader. Explique le bout d'aile plat, indépendamment de l'asymétrie déjà connue. |
| [medium] Le binding vivant crée une dépendance d'ordre silencieuse (`src/main.js`) : construire avant `createDetails` donne un mesh valide de compte zéro, sans erreur. | **Traité** | Confirmé — le commentaire reconnaît le piège mais aucun garde ne le transforme en panne visible. |
| [medium] Les deux invariants n'exercent jamais le runtime : ni `createButterflies`, ni la machine à états, ni `mesh.visible`. | **Traité** | Confirmé — c'est ce qui explique que les quatre défauts ci-dessus passent avec `19 pass, 0 fail`. Le signal de validation est **trompeur**. |

### Vérification des deux rapports

`INVARIANTS: 21 pass, 0 fail` en tier `low` **et** en `?q=ultra`, dont deux
invariants de RUNTIME nouveaux qui instancient les vrais systèmes :

- lucioles : 800 instances, 505/197/98 par bassin, 24 % de solitaires,
  185 périodes distinctes, éclat étalé sur 0.30–1.00 ;
- papillons : **136/136 caps alignés sur le déplacement réel (pire produit
  scalaire 1.000)**, 24 posés sur corolle après 30 s de simulation contre
  **zéro** avant correction, garde au sol minimale 0.22.

Un invariant a dû être corrigé en même temps que le code : l'invariant 11
mesurait la garde au sol depuis le point semé, hypothèse devenue fausse quand le
placement s'est mis à se caler sur le point le plus haut de l'enveloppe de
dérive. Il échouait donc sur sa propre prémisse périmée, pas sur un défaut.

### Reste à traiter

**Aucun.** Les 11 findings des deux rapports sont traités.

Le dernier — le domaine de vol non borné — a été fermé avec un invariant qui
harcèle la population pendant 60 s avec un répulseur mobile balayant le champ de
fleurs, puis vérifie qu'aucun individu n'est au-dessus de la mer ni hors du
domaine élargi. `INVARIANTS: 21 pass, 0 fail` en `low` et en `?q=ultra`.
