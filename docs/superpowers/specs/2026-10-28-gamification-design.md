# Gamification légère — conception (2026-10-28)

## Intention

Aujourd'hui on se balade et rien d'autre. On veut donner des raisons
d'explorer l'île sans casser son caractère contemplatif.

## Décidé par l'utilisateur

- Périmètre de la vague 1 : **carnet de tampons (goshuin-chō)**, **flair +
  objets cachés (omamori)**, **défis animaux**.
- Ton **contemplatif** : ni échec, ni chrono, ni score agressif.
  Notifications discrètes, récompenses cosmétiques.
- Textes en **français, avec des mots japonais**
  (« Jizō du sentier — gardien des voyageurs »).
- Hors périmètre (vague 2 éventuelle) : allumage des lanternes, moments
  rares liés à l'heure.

## Anti-objectifs

- Une interface criarde qui masque la scène, un HUD permanent chargé.
- Une baisse de fps mesurable (aucune allocation par frame, aucun nouveau
  passage de rendu).
- Casser `test/invariants.html` ou les règles de `docs/pieges.md`.

## Conception

### 1. Noyau `src/quest.js` (pur, sans DOM ni Three)

- `createQuest({ storage = localStorage, sites, treasures })` renvoie
  `{ state, on(evt, fn), report(evt, data), update(t, x, z, dayTime), reset() }`.
- La progression est persistée sous la clé `sakurajima.quest.v1` dans un
  try/catch (en navigation privée : mémoire seule).
- **Tampons** : un tampon par site POI disponible (`pine, rock, jizo,
  tsukubai, iwakura, stones, seaTorii, chashitsu, snag` ; un site absent est
  ignoré). Il est obtenu quand le shiba passe à moins de `radius` du site
  (3 u par défaut ; le torii en mer se valide depuis la plage, 9 u).
  Chaque tampon a `{ id, kanji, nom, haiku (3 vers FR) }`.
- **Défis** : des compteurs avec paliers (1 / 5 / 15).
  - `heron-flush` (hérons envolés), `gull-flush` (goélands), `crab-flee`
    (crabes en fuite), `bird-flush` (passereaux), `butterfly-chase`
    (papillons), `bark` (aboiements, palier caché).
- **Omamori** : `found` est un ensemble d'ids. La complétion de chaque
  catégorie émet `complete`.
- Événements émis : `stamp`, `treasure`, `challenge-tier`, `complete`.

### 2. Objets cachés + flair : `src/treasures.js`

- `createTreasures({ seed, heightAt, isOnPath, isInPond, keepOut, count })`
  place de façon déterministe (via `streamFor(seed,'treasures')`) 12
  omamori hors des chemins et des étangs, au pied des arbres, des rochers ou
  des bambous. Ce sont de petites amulettes de tissu (InstancedMesh, ~0.25 u)
  avec un léger scintillement.
- `update(t, shibaPos)` : un objet à moins de 0.9 u est ramassé et disparaît
  (scale 0). Il émet alors `onFound(id)`.
- `sniff(x, z)` renvoie `{ dir: angle, strength 0..1 }` vers l'objet non
  trouvé le plus proche (strength = 1 à 0 u, 0 au-delà de 40 u).

### 3. Shiba : renifler

- Nouvelle méthode `shiba.sniff(targetYaw, strength)` : la tête descend vers
  le sol, orientée vers `targetYaw`, pendant environ 1.6 s, puis le shiba
  émet `'sniff'`. La queue s'agite plus vite quand `strength` est élevé.
- Touche `R` (+ un bouton tactile). Temps de recharge de 2 s.

### 4. Crochets faune (minimaux, non cassants)

- `crabs.onFlee(count)`, `gulls.onFlush()`, `butterflies.onFlee()`. Ce sont
  des no-op par défaut, appelés au moment où l'état bascule. `herons.onFlush`
  et `birds.onEvent('flush')` existent déjà.

### 5. Interface : `src/journal-ui.js` + CSS dans `index.html`

- **Toasts** discrets en bas, au centre : kanji en tampon rouge vermillon
  et nom. Ils durent environ 3.5 s et sont mis en file d'attente. Les toasts
  de flair sont encore plus discrets.
- **Carnet** (touche `J`, bouton `帳` dans le panneau) : une page de papier
  washi avec une grille de 9 cases de tampons (vides en gris, obtenues en
  sceau rouge et haïku au survol ou au clic), une rangée de 12 omamori et
  une liste des défis avec leurs paliers. `Échap` ou `J` ferme le carnet. La
  touche `H` le masque comme le reste du HUD.
- Typographie : la serif mincho déjà utilisée (`index.html`). La palette
  reprend celle du panneau existant. Pas de dépendance externe.

### 6. Câblage `main.js` (seul endroit)

- Créer treasures après POI. Créer quest après les sites et les trésors.
  Brancher les crochets faune sur `quest.report`. Appeler
  `quest.update` / `treasures.update` dans la boucle. Exposer `__sk.quest`.
- Petit son (optionnel, si `audio`) : réutiliser `chirp` pour un tampon.

## Récompense cosmétique (laissé au builder, avec contrainte)

Les 9 tampons complets → le carnet affiche un sceau doré. Tous les omamori →
le shiba porte un foulard rouge (bandana, une seule géométrie ajoutée au
rig). Si le foulard s'avère risqué dans `shiba-geom.js`, se limiter au sceau
doré et le signaler.

## Vérification

- `node --check` sur chaque fichier touché, puis `test/invariants.html` à 0
  fail, avec de nouveaux checks : placement déterministe des trésors, aucun
  trésor sur un chemin ni dans un étang, persistance aller-retour de quest
  via un stockage factice.
- Navigateur : on ramasse un tampon (téléporter via `__sk`), on ouvre le
  carnet, on vérifie le rendu de jour et de nuit, et des fps inchangés à la
  louche.
