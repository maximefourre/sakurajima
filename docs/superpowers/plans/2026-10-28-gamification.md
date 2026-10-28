# Gamification légère — plan d'implémentation

> **For agentic workers:** chaque tâche est exécutée par un worker Orca dans son
> propre worktree. Steps en checkbox (`- [ ]`). Lire `AGENTS.md` et
> `docs/pieges.md` avant de coder.

**Goal :** carnet de tampons POI, omamori cachés + flair du shiba, défis animaux, persistés.
**Architecture :** noyau pur `quest.js` (état, persistance, événements), `treasures.js`
(objets 3D + flair), `journal-ui.js` (DOM), petits crochets faune/shiba ; tout est câblé
uniquement dans `main.js`.
**Tech :** Three.js 0.185.1 vendorisé, modules ES, aucun build, aucune dépendance ajoutée.
**Spec :** `docs/superpowers/specs/2026-10-28-gamification-design.md`

## Global Constraints

- Aucun build, aucune dépendance externe, import `three` via l'importmap existant.
- Textes joueur : français + mots japonais. Ton contemplatif : ni échec, ni chrono.
- Aucune allocation par frame dans les `update()` (scratch hors boucle).
- Clé de stockage : `sakurajima.quest.v1`, tout accès `localStorage` dans un try/catch.
- `main.js` est le SEUL endroit de câblage (pieges.md) : T1–T4 n'y touchent pas.
- Tests navigateur : une page `test/<nom>.html` qui finit par la ligne
  `INVARIANTS: N pass, M fail` (même harnais que `test/invariants.html`).
  Lancer : `python3 serve.py <PORT>` puis
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --virtual-time-budget=30000 --dump-dom http://127.0.0.1:<PORT>/test/<nom>.html | grep -o 'INVARIANTS: [0-9]* pass, [0-9]* fail'`
- Avant commit : `node --check` sur chaque .js touché, `git diff` relu.

## Review Focus

1. Navigation privée / `localStorage` qui throw → le jeu marche en mémoire, aucune erreur console.
2. Site POI absent (`null`, tier low sans étang) → le tampon est ignoré, pas de crash, total = sites présents.
3. Sauvegarde corrompue ou d'une version future → ignorée, progression repart à zéro, pas de throw.
4. Carnet ouvert → il n'intercepte que `J`/`Échap` ; ZQSD pilote toujours le chien ; `R` répété → recharge, pas de spam de toasts.
5. Reset `Échap` ne doit PAS effacer la progression (seulement vue/temps).

---

### Task 1 : noyau `src/quest.js`

**Files :** Create `src/quest.js`, `test/quest.html`.

**Interfaces — Produces :**
```js
export const STAMPS   // [{ id, site, kanji, name, haiku: [l1,l2,l3], radius }]
                      // ids = 'pine','rock','jizo','tsukubai','iwakura','stones','seaTorii','chashitsu','snag'
                      // radius 3, sauf seaTorii 9
export const CHALLENGES // [{ id, name, kanji, tiers: [1,5,15], hidden?: true }]
                      // ids = 'heron-flush','gull-flush','crab-flee','bird-flush','butterfly-chase','bark'(hidden)
export const STORAGE_KEY = 'sakurajima.quest.v1'
export function createQuest({ storage = globalThis.localStorage, sites = {}, treasureIds = [] })
  → {
    state,                       // { stamps: Set<id>, treasures: Set<id>, counts: {id:number}, rewards: Set<'gold-seal'|'bandana'> }
    stamps(),                    // STAMPS filtrés aux sites présents (non null), avec .x .z .got:boolean
    totals(),                    // { stamps:{got,total}, treasures:{got,total}, challenges:[{id,count,tier,next}] }
    on(evt, fn),                 // evt ∈ 'stamp','treasure','challenge-tier','complete' ; renvoie off()
    report(evt, data),           // evt = id de challenge (incrémente), ou 'treasure' avec data={id}
    update(x, z),                // test de proximité tampons ; pas d'allocation
    reset(),                     // efface tout + storage
  }
```
Payloads : `stamp` → `{ id, kanji, name, haiku }` ; `treasure` → `{ id, got, total }` ;
`challenge-tier` → `{ id, name, kanji, tier, count }` ; `complete` → `{ kind:'stamps'|'treasures', reward:'gold-seal'|'bandana' }`.
Un `site` POI peut avoir `x,z` directement, ou (stones) être un tableau : prendre le premier élément ; (seaTorii) `x,z` du torii. Valider dans le code réel `src/poi.js` (`computeSeaToriiSite`, `computeSteppingStones`).

- [ ] Step 1 : écrire `test/quest.html` (copie du harnais de `test/invariants.html` lignes 1–90, sans le bake île), checks :
  - `stamp sur proximité` : sites `{jizo:{x:0,z:0}}`, `update(1,1)` → event `stamp` id `jizo`, `totals().stamps` = `{got:1,total:1}`.
  - `site null ignoré` : `sites:{jizo:null, snag:{x:5,z:5}}` → `stamps().length === 1`.
  - `pas de double tampon` : 2× `update` au même point → 1 seul event.
  - `paliers` : 5× `report('gull-flush')` → events `challenge-tier` avec tier 1 puis 5.
  - `omamori complet` : `treasureIds:['a','b']`, `report('treasure',{id:'a'})`, puis `'b'` → `complete` `{kind:'treasures',reward:'bandana'}`; re-report `'a'` sans effet.
  - `persistance` : stockage factice `{getItem,setItem,removeItem}` partagé entre deux `createQuest` → le second voit les tampons/compteurs.
  - `stockage qui throw` : `getItem/setItem` qui throw → aucune exception, état mémoire OK.
  - `sauvegarde corrompue` : `getItem` renvoie `'{oops'` puis `'{"v":99}'` → état vide, pas de throw.
  - `reset` : vide l'état et appelle `removeItem(STORAGE_KEY)`.
- [ ] Step 2 : lancer (PORT 5181) → FAIL (module absent).
- [ ] Step 3 : implémenter `src/quest.js`. Format persistant `{ v:1, stamps:[], treasures:[], counts:{}, rewards:[] }`, écrit à chaque changement. Rédiger les 9 haïkus (5-7-5 approximatif en FR, évoquant le lieu ; kanji : 松 pin, 岩 rocher, 地蔵 jizō, 蹲踞 tsukubai, 磐座 iwakura, 飛石 pas japonais, 鳥居 torii marin, 茶室 chashitsu, 枯木 arbre mort). Noms de défis : « Envol des aosagi » 鷺, « Goélands dispersés » 鴎, « Crabes en fuite » 蟹, « Moineaux effarouchés » 雀, « Chasse aux chō » 蝶, « Ouaf ! » 吠 (caché).
- [ ] Step 4 : relancer → `INVARIANTS: N pass, 0 fail`.
- [ ] Step 5 : `node --check src/quest.js`, commit `feat: quest — noyau tampons/omamori/défis persistés`.

### Task 2 : interface `src/journal-ui.js` + styles

**Files :** Create `src/journal-ui.js`, `test/journal.html` (page de démo visuelle avec un faux quest). Modify `index.html` (CSS + markup `#toasts`, `#journal`, bouton `帳` dans le panneau existant).

**Interfaces — Consumes :** l'objet de Task 1 (`stamps()`, `totals()`, `on()`), seulement via ces méthodes.
**Produces :**
```js
export function createJournalUI({ quest, root = document })
  → { toast(kind, payload), open(), close(), toggle(), isOpen(), refresh(), setHidden(bool), dispose() }
// s'abonne lui-même à quest.on(...) pour afficher les toasts ; kind ∈ 'stamp','treasure','challenge-tier','complete','sniff'
// payload 'sniff' = { strength } → texte discret : « Une odeur lointaine… » (<0.25), « Ça sent quelque chose… » (<0.6), « Tout près ! » (≥0.6)
```
- Utiliser le skill `frontend-design`. Esthétique : papier washi (dégradé crème + grain CSS), sceaux vermillon `#c8372d` en cercle/carré kanji, mincho existant. Toasts bas-centre, file, ~3.5 s, `pointer-events:none`. Carnet centré, ≤ 92vw, lisible sur mobile, fermeture `J`/`Échap`/clic dehors, `aria-modal`, focus géré. Sceau doré si reward `gold-seal`.
- Ne PAS câbler les touches globales (Task 5) : exposer `toggle()`.
- [ ] Step 1 : `test/journal.html` avec faux quest (9 tampons dont 4 obtenus, 3/12 omamori, défis variés) + boutons pour déclencher chaque toast ; checks DOM : carnet a 9 cases, 4 marquées `.got`, `toggle()` ouvre/ferme, `setHidden(true)` masque les toasts → `INVARIANTS: N pass, 0 fail` (PORT 5182).
- [ ] Step 2 : implémenter, relancer → 0 fail ; capture headless `--screenshot` du carnet ouvert jointe au rapport (`--report-path`).
- [ ] Step 3 : `node --check`, commit `feat: carnet goshuin et toasts`.

### Task 3 : crochets faune + shiba renifle + foulard

**Files :** Modify `src/crabs.js`, `src/gulls.js`, `src/butterflies.js`, `src/shiba.js`, `src/shiba-geom.js` (si foulard).

**Produces :**
- `crabs.onFlee = (n) => {}` appelé une fois par crabe qui bascule idle→flee (n=1).
- `gulls.onFlush = () => {}` appelé une fois par `flushAll()` effectif.
- `butterflies.onFlee = () => {}` appelé une fois par papillon qui bascule en fuite.
  Propriétés assignables sur l'objet renvoyé (même motif que `herons.onFlush`, `herons.js:568,690`).
- `shiba.sniff(targetYaw:number, strength:number) → boolean` (false si saut/nage/secoue/aboie ou recharge <2 s). Pose ~1.6 s : tête basse vers le sol, tournée vers `targetYaw` (monde) dans la limite du cou ; queue plus rapide ∝ strength. Émet `emit('sniff')` au début. Nouveau poids `state.sniff` dans la pile de pose, comme `bark`.
- `shiba.setBandana(on:boolean)` : petit foulard rouge triangulaire noué au cou, suit l'os du cou. Si trop risqué, méthode no-op + le signaler dans le rapport.
- Respecter `pieges.md` #11 et ne rien changer aux allures existantes.
- [ ] Step 1 : ajouter à `test/invariants.html` ? NON (fichier partagé). Créer `test/hooks.html` : crabs/gulls/butterflies créés comme dans `test/invariants.html` (voir ses imports), simuler `update` avec un shiba au contact → chaque callback appelé ≥1 ; `createShiba` (motif existant dans invariants) puis `sniff(0,1)` → true, re-`sniff` immédiat → false. PORT 5183.
- [ ] Step 2 : implémenter, relancer → 0 fail ; `test/invariants.html` toujours 0 fail.
- [ ] Step 3 : `node --check` des fichiers, capture `tools/shiba-studio.html` si utile, commit `feat: crochets faune, shiba renifle et foulard`.

### Task 4 : omamori `src/treasures.js`

**Files :** Create `src/treasures.js`, `test/treasures.html`. Ajouter `TREASURES` dans `src/config.js` (seul ajout autorisé dans ce fichier : un bloc exporté en fin de fichier).

**Produces :**
```js
export const TREASURES = { count: 12, pickRadius: 0.9, sniffRange: 40, size: 0.25 }  // config.js
export function placeTreasures({ seed, heightAt, isOnPath, isInPond, keepOut, count }) → [{ id:'omamori-0'…, x, y, z }]
export function createTreasures({ seed, heightAt, isOnPath, isInPond, keepOut, count = TREASURES.count })
  → { mesh, ids:string[], spots, update(t, x, z), sniff(x, z) → {dir, strength, id|null}, markFound(ids:Iterable), onFound: (id)=>{} , dispose() }
// dir = Math.atan2(dx, dz) (convention heading du shiba — vérifier dans shiba.js), strength = 1 - d/sniffRange clampé
```
- Placement : `streamFor(seed,'treasures')` (voir `src/noise.js`/autres modules pour l'utilitaire de flux), sur terre (`heightAt>0.3`), hors chemin (`!isOnPath`), hors étang, hors `keepOut`, espacement ≥ 12 u, répartis sur l'île (rejet). Rester dans l'emprise `WORLD`/`AREA` de config.
- Mesh : InstancedMesh d'un omamori (sachet arrondi + cordon), couleurs variées par instance (`instanceColor` : voir pieges.md #2), léger scintillement par onBeforeCompile ou émissif pulsé — pas d'allocation par frame. `markFound` met l'échelle à 0 (instances retirées au boot depuis la sauvegarde).
- [ ] Step 1 : `test/treasures.html` (bake île comme `test/invariants.html` tier low) : 12 spots ; déterministe (2 appels = mêmes coords) ; aucun `isOnPath`/`isInPond` ; espacement ≥ 12 ; `sniff` au-dessus d'un spot → strength≈1 ; `update` sur un spot → `onFound` une fois ; `markFound` puis `sniff` vise le suivant. PORT 5184.
- [ ] Step 2 : implémenter, relancer → 0 fail.
- [ ] Step 3 : `node --check`, commit `feat: omamori cachés et flair`.

### Task 5 : câblage `main.js`, tactile, docs (après T1–T4 fusionnées)

**Files :** Modify `src/main.js`, `src/touch.js`, `index.html` (bouton tactile renifler seulement), `docs/INDEX.md`, `AGENTS.md` (contrôles R/J), `docs/symbols.txt` (régénéré).

- Créer `world.treasures` après `world.poi` (mêmes `heightAt`, `isOnPath`, `inWater`, `poi.keepOut`) ; `world.quest = createQuest({ sites: world.poi.sites, treasureIds: world.treasures.ids })` ; `treasures.markFound(quest.state.treasures)` ; `treasures.onFound = id => quest.report('treasure',{id})`.
- Crochets : `herons.onFlush` (garder l'appel existant à `shiba.notify`) → `report('heron-flush')` ; `gulls.onFlush` → `'gull-flush'` ; `crabs.onFlee` → `'crab-flee'` ; `birds.onEvent('flush')` (garder audio) → `'bird-flush'` ; `butterflies.onFlee` → `'butterfly-chase'` ; `shiba.onEvent('bark')` (garder audio) → `'bark'`.
- Boucle : `world.quest.update(shiba.position.x, z)` et `world.treasures.update(t, x, z)`.
- `createJournalUI({ quest })` ; `quest.on('complete', ({reward}) => reward==='bandana' && shiba.setBandana(true))`, et au boot si reward déjà acquis.
- Touches dans le handler existant (`main.js:1199`) : `KeyR` → `const s = treasures.sniff(x,z); if (shiba.sniff(s.dir, s.strength)) ui.toast('sniff', s)` ; `KeyJ` → `ui.toggle()` ; `Échap` ferme d'abord le carnet s'il est ouvert ; `H` → `ui.setHidden`. `Échap` ne réinitialise PAS la progression.
- `__sk.quest`, `__sk.treasures` ; son : `audio.handle('call')` sur `stamp`.
- [ ] Step 1 : implémenter ; `node --check` ; `test/invariants.html` + `quest`/`hooks`/`treasures`/`journal` → 0 fail (PORT 5185).
- [ ] Step 2 : navigateur (`?q=high`) : téléporter le shiba sur le jizō via `__sk` → toast tampon ; `R` → chien renifle + toast ; `J` carnet ; nuit (`dayTime=0.0`) lisible ; aucune erreur console ; captures dans le rapport.
- [ ] Step 3 : `python3 tools/gen-symbols.py`, INDEX (ligne « gamification quest tampons omamori carnet → quest.js ; treasures.js ; journal-ui.js »), commit `feat: gamification câblée (carnet, omamori, défis)`.
