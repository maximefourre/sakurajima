# Correctifs audit 01/09 — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Pour agents implémenteurs :** Grok seul (`AGENTS.md`, 01/09/2026). Chaque
> chantier est **un sous-agent Grok** (`general-purpose` ou `grok-delegate`),
> **INTERDICTION de sous-traiter** (laissé libre, il re-délègue et n'écrit
> rien — 40 min perdues le 02/08, zéro octet écrit). Un chantier = un
> worktree = les fichiers listés, **rien d'autre**. Ne pas ouvrir `main.js`
> ni `test/invariants.html` en vague 1. Pas de Codex, pas de Claude.

**Goal:** Fermer tous les findings de l'audit du 01/09 (`main` @ `d47e1e5`) sans feature, sans rivière/pont, sans casser `INVARIANTS: N pass, 0 fail`.

**Architecture:** Sept chantiers **fichier-disjoints** en vague 1 (worktrees parallèles), puis un chantier câblage+banc qui possède `main.js` / `index.html` / `invariants.html`, puis un re-bench fps (piège 9) qui réécrit les chiffres. Les deux vents et les trois `mulberry32` ne sont **pas** unifiés : on documente pourquoi.

**Tech Stack:** Three.js 0.185.1 vendorisé, aucun build, `python3 serve.py 5173`, banc `test/invariants.html`.

**Spec:** audit conversation du 01/09 (findings P1–P3). Ce plan est la source d'exécution.

## Global Constraints

- Serveur : `python3 serve.py 5173`. JAMAIS `python -m http.server`.
- Aucune dépendance nouvelle. Pas de npm, pas de CDN.
- `island.heightAt` est la source de vérité. Ne pas rebrancher un cache.
- `LAND_SCALE` / `HEIGHT_SCALE` : XZ à la définition, hauteurs une fois dans `analyticHeight`.
- Qualité / saison = reload. `createSakuraForest` : `quality` **numérique**. `createGrass` : `count` / `bounds` / `exclude` / `shortZone`.
- Pas de rivière, pas de pont.
- Pièges 1 (winding), 5 (OrbitControls), 9 (fps), 10 (coût feuillage géométrique).
- Après chaque chantier : `node --check` des fichiers touchés, puis commit. Vague 2 : `test/invariants.html` **low ET ultra** → `0 fail` (ne pas figer N).
- Brief sous-agent Grok : interdire explicitement de sous-traiter. Pas de Codex.
- Ne pas hardcoder `79 pass` dans AGENTS / PLAN.

## Hors scope (volontaire — findings rejetés avec justification)

| Finding | Pourquoi on ne le « corrige » pas |
|---|---|
| Unifier `wind.js` et `sakura.WIND_GLSL` | Art direction. L'adaptateur `forestWind` (`main.js:190-203`) **est** le contrat. Unifier recasse couronnes/bambous. Documenté en A. |
| Unifier les 3 `mulberry32` | `sakura.js:45-57` n'est pas byte-identique à `noise.js:30-38` (`a \|= 0` vs `>>> 0`). Importer l'un dans l'autre **reshuffle** forêt/herbe. Documenté en A. |
| Changer `DEFAULT_QUALITY` (ultra < 30 fps sol) | Décision utilisateur 08/08. J met à jour les **chiffres**, pas le défaut. |
| Exclure `test/` de Vercel | Décision 12/08 (QA public). A documente que c'est voulu. |
| CI GitHub Actions | Le banc est WebGL. Pas de runner. `node --check` reste la porte locale. |
| LOD herbe / wrack-snag / 3ᵉ saison | Dette **produit**, pas finding d'audit. Après J seulement, sur demande. |
| `export default` inutilisés, bloom async (1ères frames), `boot().catch` | P3 / déjà couvert : `boot.js:18-20` + `unhandledrejection`. |
| `SHADER_LIGHT_SCALE` dupliqué | Cosmétique éclairage, hors audit actionnable. |

## Graphe d'exécution (le parallèle)

```
VAGUE 1 — 7 worktrees EN PARALLÈLE (aucun ne touche main.js ni invariants.html)
  A docs-contrats          *.md + docs/superpowers/plans/{12/08,13/08}
  B mort                   DELETE src/heightcache.js + designs/
  C sky-enveloppe          src/sky.js + test/atmosphere.html
  D audio-master           src/audio.js
  E serve                  serve.py + .gitignore
  F usines                 config.js + sakura/grass + 8 create*(quality.?)
  G comments-poi           poi.js, details.js, ponds.js, shiba.js, petals.js

          │ merge A–G sur main (rebase, un par un, conflits impossibles si files tenus)
          ▼
VAGUE 2 — 1 chantier (possède les hotspots)
  H cablage-banc           main.js + index.html + test/invariants.html
                           (+ ADV-2026-09-01-H)

          ▼
VAGUE 3 — 1 chantier, machine cible, piège 9
  J fps-honnetes           AGENTS.md + PLAN.md + REPRISE.md  (chiffres seulement)
```

**Règle worktree :** `git worktree add .worktrees/audit-A -b fix/audit-2026-09-A`. Interdiction d'éditer un fichier hors de sa colonne. `main.js` / `invariants.html` = H seulement.

## Fichiers — qui possède quoi

| Chantier | Crée / supprime | Modifie (exclusif) |
|---|---|---|
| A | — | `AGENTS.md`, `PLAN.md`, `REPRISE.md`, `ADVERSARIAL_REVIEW_CLAUDE.md`, `docs/superpowers/plans/2026-08-12-correctifs-audit.md`, `docs/superpowers/plans/2026-08-13-vie-poi-programme.md` |
| B | **DELETE** `src/heightcache.js`, `designs/` | — |
| C | — | `src/sky.js`, `test/atmosphere.html` |
| D | — | `src/audio.js` |
| E | — | `serve.py`, `.gitignore` |
| F | — | `src/config.js`, `src/sakura.js`, `src/grass.js`, `src/fireflies.js`, `src/butterflies.js`, `src/moths.js`, `src/crabs.js`, `src/herons.js`, `src/dragonflies.js`, `src/gulls.js`, `src/bamboo.js` |
| G | — | `src/poi.js`, `src/details.js`, `src/ponds.js`, `src/shiba.js`, `src/petals.js` |
| H | — | `src/main.js`, `index.html`, `test/invariants.html` |
| J | — | `AGENTS.md`, `PLAN.md`, `REPRISE.md` (3 lignes fps, après merge A) |

---

### Task A: Docs-contrats (zéro logique de scène)

**Files:**
- Modify: `AGENTS.md`, `PLAN.md`, `REPRISE.md`, `ADVERSARIAL_REVIEW_CLAUDE.md`, `docs/superpowers/plans/2026-08-12-correctifs-audit.md`, `docs/superpowers/plans/2026-08-13-vie-poi-programme.md`

**Interfaces:**
- Consumes: rien (état `d47e1e5`)
- Produces: contrats alignés sur le code **sauf** les fps (chantier J)

- [ ] **A1.** `AGENTS.md` Lancer / contrôles / archi / vérif visuelle.

Remplacer le bullet fps (l.39-43) par :

```
- Chargement ultra ≈ 20 s (bake terrain 769² + placements). Printemps ultra
  sur M4 Max, cible 3600×1896, caméra verrouillée : **33.7 fps** ouverture,
  **24.6** au sol ; automne 59 / 49.3 — chiffres **antérieurs** aux impostors
  de couronne et au recul herbe 560k→420k (re-bench : plan 01/09 chantier J).
  Le poste dominant est le FEUILLAGE (piège 10) : baisser le DPR ne rapporte
  rien. Mesurer = piège 9 (`readPixels` + caméra figée).
```

Contrôles (l.44-45) — ajouter `H` masque HUD **sauf** le crédit CC-BY, boot à midi figé (`START_TIME=0.5`, `START_PAUSED=true`) jusqu'à `P`.

Architecture (l.49-75) — insérer :

```
cloud-shadow.js — fbm XZ dérivé du vent, uniforms partagés terrain/rochers/herbe
```

Après la ligne `wind.js`, ajouter un paragraphe **Deux vents** :

```
Deux GLSL de vent, volontairement. `wind.js` (train de rafales, uWindDir vec2)
pilote herbe, pétales, fleurs, oiseaux. `sakura.js` exporte un WIND_GLSL
sinusoïdal (uWindDir vec3) consommé par les couronnes ET `bamboo.js`.
`main.js` possède `forestWind` : adaptateur vec2→vec3 rafraîchi chaque frame.
Ne PAS passer `createWind().uniforms` à `createSakuraForest` (no-op silencieux).
Ne PAS unifier les deux modèles sans demande explicite.
```

Vérif visuelle (l.199) : `fadeEnd` **250**, pas 330. Phrase :

```
l'ouverture postcard peut n'être que de l'albedo — `fadeEnd` 250 (330
soumettait encore la forêt depuis la plage, ~20 fps, piège 10).
```

Ajouter sous Lancer un bullet deploy :

```
- Vercel : `outputDirectory: "."`, `.vercelignore` enlève `*.md`, `docs/`,
  `designs/`, `tools/`, `serve.py`. **`test/` est public** (QA, voulu).
  `assets/shiba/LICENSE.txt` reste (CC-BY).
```

- [ ] **A2.** `PLAN.md`

- Table Fait `noise.js` : **pas** « source de vérité unique pour la hauteur » — c'est `island.heightAt`. noise = PRNG + fbm.
- Table Fait `petals.js` : plus « ~12k » → `QUALITY.petals` × `AREA_SOFT` (≈ 170 k air ultra).
- Table Fait : ajouter une ligne par module manquant (`audio`, `poi`, `chashitsu`, `fireflies`, `butterflies`, `moths`, `herons`, `dragonflies`, `crabs`, `gulls`, `bamboo`, `cloud-shadow`, `particles`, `touch`, `boot`, `shiba-gltf` / `shiba-geom`). État ✅, une phrase. Ne pas inventer des fps.
- §2bis (l.119-121) : **supprimer** le bullet « fps ultra ≈40 / conforme au ~41 ». Garder oiseaux / halo / eau kaki (goût).
- l.200 : remplacer `Lot 5 (wrack / snag / moucherons) non ouvert` par ` wrack / snag / moucherons (PLAN §7, distinct du lot 5 mites déjà livré) — non ouvert.`

- [ ] **A3.** `ADVERSARIAL_REVIEW_CLAUDE.md` — bannière **en tête**, avant ADV-2026-08-12-PLAN :

```markdown
> **Historique rivière / pont.** Les findings ADV-2026-07-28 qui citent
> `src/river.js`, `buildBridge`, `isInRiver` décrivent du code **supprimé
> le 29/07**. Ne pas les « rouvrir ». L'île n'a plus de rivière ni de pont.
```

- [ ] **A4.** Plans superpowers — statut, pas de réécriture.

En tête de `docs/superpowers/plans/2026-08-12-correctifs-audit.md` :

```
**STATUT : IMPLÉMENTÉ** (branche `fix/audit-2026-08-12`, merge `a0cec36`).
Les cases `[ ]` ci-dessous sont historiques. Ne pas relancer.
```

En tête de `docs/superpowers/plans/2026-08-13-vie-poi-programme.md` :

```
**STATUT : LOTS 1–8 LIVRÉS** (côte → hérons → signes → torii marin →
mites → gestes shiba → chashitsu → bambous). Le « lot 1 en cours (13/08) »
est périmé. Ne pas relancer.
```

- [ ] **A5.** `REPRISE.md` — session « audit 01/09 — docs » : ce chantier A, liste des contrats alignés, pointer le plan. Convention : consigner.

- [ ] **A6.** Grep de contrôle (doit être vide **sauf** historique ADV/REPRISE déjà banniéré) :

```sh
rg -n "fadeEnd 330|~12k pétales|source de vérité unique pour la hauteur" AGENTS.md PLAN.md
```

Expected: plus aucune occurrence dans AGENTS/PLAN.

- [ ] **A7.** Commit

```bash
git add AGENTS.md PLAN.md REPRISE.md ADVERSARIAL_REVIEW_CLAUDE.md \
  docs/superpowers/plans/2026-08-12-correctifs-audit.md \
  docs/superpowers/plans/2026-08-13-vie-poi-programme.md
git commit -m "$(cat <<'EOF'
docs: contrats alignés sur l'audit du 01/09

fadeEnd 250, deux vents documentés, plans 12/08 et POI marqués livrés,
bannière rivière historique sur l'ADV. fps à re-mesurer (chantier J).
EOF
)"
```

---

### Task B: Code mort

**Files:**
- Delete: `src/heightcache.js`
- Delete: `designs/` (6 fichiers : 5 `*.meta.txt` + `workflow-ponds-birds-clouds.js`)

**Interfaces:**
- Consumes: grep zéro import de `heightcache` / `designs/` depuis `src/` et `test/` (déjà vrai @ `d47e1e5`)
- Produces: arbre sans module mort ni briefs unpkg

- [ ] **B1.** Confirmer l'absence d'import

```sh
rg -n "heightcache|buildHeightCache" src test index.html
rg -n "designs/" src test index.html
```

Expected: zéro hit (hors `docs/` / ce plan / REPRISE historique).

- [ ] **B2.** Supprimer

```bash
git rm src/heightcache.js
git rm -r designs
```

- [ ] **B3.** Commit

```bash
git commit -m "$(cat <<'EOF'
chore: retire heightcache.js mort et designs/ périmés

Le heightfield est déjà baké dans island.js. designs/ documentait unpkg + Water.js.
EOF
)"
```

---

### Task C: Enveloppe d'ombre — fallback = île réelle

**Files:**
- Modify: `src/sky.js:55-78`, `src/sky.js:461-465`, `src/sky.js:42`
- Modify: `test/atmosphere.html:82-87` (passer un `islandRadius` **ou** s'appuyer sur le nouveau fallback — les deux doivent donner near > 0)

**Interfaces:**
- Consumes: `WORLD.size` (`config.js:55`, `Math.round(460 * LAND_SCALE)`), `ISLAND_R = size * 0.385` (`island.js:549`)
- Produces: `shadowEnvelope(undefined)` ≡ `shadowEnvelope(1.30 * WORLD.size * 0.385 + 10)`

Ne plus jamais écrire `125` dans `sky.js`. La formule unique est `1.30 * WORLD.size * 0.385 + 10` (même `ISLAND_R` que `island.js:549`).

- [ ] **C1.** Banc qui échoue aujourd'hui. `test/atmosphere.html` a déjà `check` (l.44) et importe `createSky`. Ajouter :

```js
import { createSky, shadowEnvelope } from '../src/sky.js';
import { WORLD, LAND_SCALE } from '../src/config.js';
```

Puis **avant** tout `createSky` / canvas (fonction pure, pas de WebGL) :

```js
{
  const omit = shadowEnvelope(undefined);
  const live = shadowEnvelope(1.30 * WORLD.size * 0.385 + 10);
  const old = 1.30 * 125 * LAND_SCALE + 10;
  const nearOmit = omit.D - omit.R - 80;
  check('shadowEnvelope sans arg : même R que l’île, near > 0',
    Math.abs(omit.R - live.R) < 1e-6 && nearOmit > 0 && Math.abs(omit.R - old) > 1,
    `R=${omit.R.toFixed(1)} old=${old.toFixed(1)} near=${nearOmit.toFixed(1)}`);
}
```

- [ ] **C2.** Lancer `http://127.0.0.1:5173/test/atmosphere.html` — le nouvel assert **échoue** (R fallback actuel = `1.30*125*L+10` ≈ 526, île ≈ 741). Les checks existants restent verts.

- [ ] **C3.** Implémenter. `sky.js` importe aujourd'hui `{ SEED, LAND_SCALE }` — étendre :

```js
import { SEED, LAND_SCALE, WORLD } from './config.js';
```

`SKY_TUNE.sunDistance` / `SKY_TUNE.islandRadius` (`sky.js:76-77`) — `WORLD` est déjà évalué au chargement du module :

```js
  islandRadius: 1.30 * WORLD.size * 0.385 + 10,
  sunDistance: Math.round(1.30 * WORLD.size * 0.385 + 10 + 220),
```

`shadowEnvelope` :

```js
export function shadowEnvelope(islandR) {
  const R = islandR ?? (1.30 * WORLD.size * 0.385 + 10);
  return { R, D: Math.round(R + 220) };
}
```

Chercher-remplacer tout `1.30 * 125 * LAND_SCALE` dans `sky.js` — **zéro** occurrence restante.

`quality.stars || SKY_TUNE.starCount` (`sky.js:683`) → `SKY_TUNE.starCount` (la clé `stars` n'existe pas dans `QUALITY`).

- [ ] **C4.** Relancer atmosphere.html. Expected: assert vert, les 41 checks existants restent 0 fail. `node --check src/sky.js`.

- [ ] **C5.** Commit

```bash
git add src/sky.js test/atmosphere.html
git commit -m "$(cat <<'EOF'
fix(sky): fallback d'ombre sur le rayon réel de l'île

Plus de 125·LAND_SCALE. Un createSky sans islandRadius garde near = 140.
EOF
)"
```

---

### Task D: SFX sous le gain master

**Files:**
- Modify: `src/audio.js:128-169`

**Interfaces:**
- Consumes: `master` (`createGain` branché sur `destination`, `AMBIENCE.master`) créé dans `startBeds`
- Produces: `chirp` / `bark` connectés à `master`, pas à `c.destination`

Piège : `ensure()` peut n'avoir pas encore appelé `startBeds` si le contexte n'est pas `running`. `chirp` sort déjà tôt si `c.state !== 'running'`. Après `startBeds`, `master` est non-null.

- [ ] **D1.** Test pur (pas de Web Audio) — on ne peut pas brancher un AudioContext dans invariants. À la place, extraire un helper testable :

Dans `audio.js`, au-dessus de `chirp` :

```js
/** Destination des SFX : le master s'il existe, sinon le contexte (unlock). */
export function sfxOut(ctx, masterNode) {
  return masterNode || ctx.destination;
}
```

Ajouter dans `test/invariants.html` **est interdit** (appartient à H). Ici, un assert node :

```bash
node --input-type=module -e '
import { sfxOut } from "./src/audio.js";
const fakeCtx = { destination: { id: "dest" } };
const fakeMaster = { id: "master" };
if (sfxOut(fakeCtx, null).id !== "dest") process.exit(1);
if (sfxOut(fakeCtx, fakeMaster).id !== "master") process.exit(1);
console.log("sfxOut ok");
'
```

Expected avant le fix de `chirp` : le helper passe dès qu'il existe ; le helper est le test. Ensuite brancher `chirp`/`bark` dessus.

- [ ] **D2.** Écrire `sfxOut` + le one-liner node. Expected: `sfxOut ok`.

- [ ] **D3.** Dans `chirp` et `bark`, remplacer `g.connect(c.destination)` et `ng.connect(c.destination)` par `g.connect(sfxOut(c, master))`. `flush` reste une boucle de `chirp`.

- [ ] **D4.** `node --check src/audio.js` + le one-liner. Commit

```bash
git add src/audio.js
git commit -m "$(cat <<'EOF'
fix(audio): aboiement et cris passent par le gain master
EOF
)"
```

---

### Task E: serve.py sans listing + ignore `.hermes`

**Files:**
- Modify: `serve.py:18-45`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `SimpleHTTPRequestHandler.list_directory`
- Produces: GET `/src/` → 404 ; fichiers toujours servis par chemin exact

- [ ] **E1.** Dans `NoCacheHandler` :

```python
    def list_directory(self, path):
        self.send_error(404, "directory listing disabled")
        return None
```

- [ ] **E2.** `.gitignore` — ajouter (le dossier n'est pas versionné, il traîne au `git status`) :

```
.hermes/
```

- [ ] **E3.** Vérif locale

```bash
python3 serve.py 5174
# autre terminal :
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5174/src/
# expected: 404
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5174/src/config.js
# expected: 200
```

Tuer le serveur 5174 (ne pas toucher 5173 s'il tourne).

- [ ] **E4.** Commit

```bash
git add serve.py .gitignore
git commit -m "$(cat <<'EOF'
chore(serve): 404 sur le listing de répertoires

Plus de listing SimpleHTTP. Ignore .hermes/.
EOF
)"
```

---

### Task F: Usines silencieuses + `keepFoliageSamples` + `grassRadius`

**Files:**
- Modify: `src/config.js` (helper + supprimer `grassRadius`)
- Modify: `src/sakura.js:1605-1646`, `src/sakura.js:1-12` (commentaire vent)
- Modify: `src/grass.js:589-604`, `src/grass.js:735-812` (`recordPlacements`), `src/grass.js:1077-1091` (return)
- Modify: `src/fireflies.js:133-135`, `src/butterflies.js` (`createButterflies` count), `src/moths.js:99`, `src/crabs.js:130`, `src/herons.js:408`, `src/dragonflies.js:67`, `src/gulls.js:152`, `src/bamboo.js:226`

**Interfaces:**
- Consumes: objets `QUALITY.low|high|ultra`
- Produces:
  - `qualityCount(quality, key) => number` (throw sinon)
  - `createSakuraForest` throw si `quality` n'est pas un number fini
  - `createGrass` throw si `options.quality` est passé
  - `createGrass({ recordPlacements: true })` → `{ placements: [{x,z,heightScale,short}] }`
  - `keepFoliageSamples` défaut **`false`**

- [ ] **F1.** Helper dans `config.js` (après `export const QUALITY`, avant `DEFAULT_QUALITY`) :

```js
/**
 * Lit quality[key] (un row QUALITY). Une string 'ultra' ou un objet
 * inconnu produisait count=0 sans erreur (lucioles, crabes, …).
 * @param {object} quality
 * @param {string} key
 * @returns {number}
 */
export function qualityCount(quality, key) {
  if (quality == null || typeof quality !== 'object' || Array.isArray(quality)) {
    throw new Error(`[sakurajima] ${key}: expected QUALITY object, got ${typeof quality}`);
  }
  const n = quality[key];
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`[sakurajima] quality.${key} is not a number`);
  }
  return n;
}
```

Supprimer les trois clés `grassRadius` (`config.js:143, 165, 187`). Rien ne les lit ; l'herbe utilise `island.radius * 1.12` (`main.js:571`).

- [ ] **F2.** Test node qui **échoue** tant que les usines n'appellent pas le helper (on teste le helper d'abord, puis un import fireflies n'est pas node-safe à cause de THREE). Le helper est pur.

```bash
node --input-type=module -e '
import { qualityCount, QUALITY } from "./src/config.js";
if (qualityCount(QUALITY.low, "fireflies") !== QUALITY.low.fireflies) process.exit(2);
let n = 0;
try { qualityCount("ultra", "fireflies"); } catch { n++; }
try { qualityCount(null, "fireflies"); } catch { n++; }
try { qualityCount({}, "fireflies"); } catch { n++; }
if (n !== 3) { console.error("expected 3 throws, got", n); process.exit(1); }
if ("grassRadius" in QUALITY.ultra) { console.error("grassRadius still present"); process.exit(1); }
console.log("qualityCount ok");
'
```

Expected: `qualityCount ok`.

- [ ] **F3.** Remplacer chaque `quality?.X ?? 0` par `qualityCount(quality, 'X')` :

| Fichier | Clé |
|---|---|
| `fireflies.js:134` | `'fireflies'` |
| `butterflies.js` (`createButterflies`) | `'butterflies'` |
| `moths.js:99` | `'moths'` (supprimer le fallback `MOTHS.perLantern[quality?.label]`) |
| `crabs.js:130` | `'crabs'` |
| `herons.js:408` | `'herons'` |
| `dragonflies.js:67` | `'dragonflies'` |
| `gulls.js:152` | `'gulls'` |
| `bamboo.js:226` | `'bamboo'` |

Import : `import { …, qualityCount } from './config.js';` (chaque fichier importe déjà `config.js` sous un nom d'export nommé — ajouter `qualityCount` à cette ligne).

- [ ] **F4.** `createSakuraForest` — juste après `const o = Object.assign(…)` :

```js
if (typeof o.quality !== 'number' || !Number.isFinite(o.quality)) {
  throw new Error(
    '[sakura] quality must be a number (0.6 / 0.9 / 1.25), not a QUALITY object'
  );
}
```

Défaut `keepFoliageSamples: false` (`sakura.js:1643`).

Commentaire d'en-tête `sakura.js:10-11` : rayer « grass/petals should reuse it ». Écrire : « WIND_GLSL des couronnes ; herbe/pétales consomment `wind.js`. Bambous importent CE bloc. Câbler via `forestWind` (main.js). »

- [ ] **F5.** `createGrass` — au début, après `options = {}` :

```js
if (Object.prototype.hasOwnProperty.call(options, 'quality')) {
  throw new Error('[grass] createGrass ignores quality; pass count, bounds, exclude, shortZone');
}
```

`recordPlacements` — avant la boucle, `const placements = [];`. Après `aHS[i] = …` :

```js
if (CFG.recordPlacements) {
  placements.push({ x, z, heightScale: aHS[i], short: shortK < 1 });
}
```

Return :

```js
placements: CFG.recordPlacements ? placements : null,
```

Commentaire pont `grass.js:461` : remplacer « grass under the bridge » par « herbe sous un surplomb (le chien au-dessus) ».

- [ ] **F6.** Relancer le one-liner F2. `node --check` sur **tous** les js touchés :

```bash
node --check src/config.js src/sakura.js src/grass.js src/fireflies.js \
  src/butterflies.js src/moths.js src/crabs.js src/herons.js \
  src/dragonflies.js src/gulls.js src/bamboo.js
```

Expected: silence, exit 0.

- [ ] **F7.** Commit

```bash
git add src/config.js src/sakura.js src/grass.js src/fireflies.js \
  src/butterflies.js src/moths.js src/crabs.js src/herons.js \
  src/dragonflies.js src/gulls.js src/bamboo.js
git commit -m "$(cat <<'EOF'
fix: usines throw si quality mal typé ; keepFoliageSamples false

Une string 'ultra' vidait lucioles/faune sans erreur. grassRadius mort retiré.
EOF
)"
```

---

### Task G: PATH_HALF unique + headers / JSDoc / rivière morte

**Files:**
- Modify: `src/poi.js:17-38`
- Modify: `src/details.js:185-190`
- Modify: `src/ponds.js:13, 64`
- Modify: `src/shiba.js:1-12`
- Modify: `src/petals.js:1-6`

**Interfaces:**
- Consumes: `export const PATH_HALF` déjà dans `details.js:33` ; `poi.js` importe déjà `makeToriiGeometry` depuis `details.js`
- Produces: une seule définition de `PATH_HALF`

- [ ] **G1.** `poi.js` — ajouter à l'import existant :

```js
import { makeToriiGeometry, PATH_HALF } from './details.js';
```

Supprimer les 3 lignes 36-38 (`// Same formula…` + `const PATH_HALF = …`).

- [ ] **G2.** JSDoc `initPath` (`details.js:185-190`) :

```js
/**
 * Rebuild the full path-network index and, if heightAt is provided, the
 * overlook terrace. Call before createGrass so exclusion follows the network.
 * @param {{ heightAt?: function, heightGrid?: object, slopeAt?: function }} [opts]
 * @returns {{x: number, z: number}} end of the 'torii' route
 */
```

- [ ] **G3.** `ponds.js:13` : « the same mistake the river's first elevation profile made » → « the same mistake an absolute water level would make ». `ponds.js:64` : supprimer « All are 70+ units clear of the river. »

- [ ] **G4.** Header `shiba.js` lignes 3-5 :

```
 * Playable dog. Runtime body is the Sketchfab glTF (shiba-gltf.js) when the
 * asset loads; buildBody() in shiba-geom.js is the fallback. Same pose*
 * contract either way.
```

Header `petals.js` ligne 5 : « so 12 000 petals » → « so QUALITY.petals × AREA_SOFT petals (one draw call for the airborne field) ».

- [ ] **G5.** `node --check src/poi.js src/details.js src/ponds.js src/shiba.js src/petals.js`

```bash
rg -n "70\\+ units clear of the river|no glTF, no rig|12 000 petals|Same formula as details.PATH_HALF" src
```

Expected: zéro.

- [ ] **G6.** Commit

```bash
git add src/poi.js src/details.js src/ponds.js src/shiba.js src/petals.js
git commit -m "$(cat <<'EOF'
refactor: PATH_HALF unique ; headers et commentaires rivière alignés
EOF
)"
```

---

### Task H: Câblage `main.js` + crédit CC-BY + banc (vague 2, **après** merge A–G)

**Files:**
- Modify: `src/main.js:168-180`, `src/main.js:427-430`, `src/main.js:1172-1175`
- Modify: `index.html` (crédit hors panneau)
- Modify: `test/invariants.html` (rochers hors étangs + herbe rase)

**Interfaces:**
- Consumes: `createIsland({ isInPond })` déjà branché dans `island.js:1121` ; `island.rockKeepOut` ; `createGrass({ recordPlacements })` livré par F ; `isOnPath` / `pathSurfaceLiftAt` / `LAND_SCALE`
- Produces: zéro rocher-non-stack dans un étang ; crédit visible si HUD masqué ; `world.bamboo` / `audio` / `fireflies` / `butterflies` / `particles` / `cloudShadow` sur le bag

Ne pas toucher à `createSakuraForest` / `createGrass` câblage existant (déjà correct).

- [ ] **H1.** Invariant rochers — dans `test/invariants.html`, **juste après** le bloc `hitsRock` (après l.1076), **avant** `createShiba`. Écrire d'abord, lancer, **FAIL attendu** (isInPond pas encore passé) :

```js
{
  const wet = (island.rockKeepOut || []).filter((r) => {
    if (r.stack) return false;          // sea stacks : mer, pas étang
    if (r.spring) return false;         // récif authoré
    return ponds.isInPond(r.x, r.z);
  });
  check('rochers hors étangs', wet.length === 0,
    wet.length ? `n=${wet.length} ex=(${wet[0].x.toFixed(1)},${wet[0].z.toFixed(1)})` : 'ok');
}
```

Lancer `http://127.0.0.1:5173/test/invariants.html?q=low` — cette ligne FAIL, le reste 0 fail.

- [ ] **H2.** Invariant herbe (F a livré `recordPlacements`). Après `initPath` (le réseau existe déjà plus haut dans le fichier). Placer près des checks sentes, count petit :

```js
import { createGrass } from '../src/grass.js';
```

(ajouter à la liste d'imports en tête.)

```js
{
  const jx = 6 * LAND_SCALE, jz = -30 * LAND_SCALE;
  const grass = createGrass({
    seed: SEED,
    count: 2200,
    bounds: { minX: jx - 28, maxX: jx + 28, minZ: jz - 28, maxZ: jz + 28 },
    heightAt: island.heightAt,
    slopeAt: island.slopeAt,
    exclude: (x, z) => ponds.isInPond(x, z),
    shortZone: (x, z) => isOnPath(x, z, 0.25),
    pathLiftAt: (x, z) => pathSurfaceLiftAt(island.heightAt, x, z),
    recordPlacements: true,
  });
  const ps = grass.placements || [];
  const inPond = ps.filter((p) => ponds.isInPond(p.x, p.z));
  const ras = ps.filter((p) => p.short);
  check('herbe : zéro brin dans un étang', inPond.length === 0,
    `n=${ps.length} pond=${inPond.length}`);
  check('herbe : des brins rases sur la sente', ras.length > 0,
    `rase=${ras.length} / ${ps.length}`);
  check('herbe : rase bornée par shortK 0.45',
    ras.every((p) => p.heightScale <= 1.6 * 0.45 + 1e-6),
    ras.length ? `max=${Math.max(...ras.map((p) => p.heightScale)).toFixed(3)}` : 'no ras');
  grass.dispose();
}
```

`?q=low` : les trois PASS dès que F est mergé (indépendants du câblage `isInPond` île). Si F n'est pas mergé, `recordPlacements` est null → FAIL. C'est voulu : H s'exécute après A–G.

- [ ] **H3.** `createIsland` — passer le prédicat (les ponds existent déjà l.421, `isInPond` nominal marche pré-`attach`, `ponds.js:860-864`) :

```js
  world.island = createIsland({
    seed: SEED, quality: q, carve, season: world.season,
    cloudShadow: world.cloudShadow.uniforms,
    isInPond: (x, z) => world.ponds.isInPond(x, z),
  });
```

- [ ] **H4.** Bag `world` (l.168-180) — ajouter les clés déjà assignées plus bas et absentes du literal :

```js
  bamboo: null, fireflies: null, butterflies: null,
  audio: null, particles: null, cloudShadow: null,
```

- [ ] **H5.** Crédit CC-BY toujours visible. Dans `index.html` : laisser `.credit` dans le panneau **et** ajouter un duplicata hors `#panel`, **ou** mieux — sortir le crédit du panneau :

Juste avant `<div id="fatal">` :

```html
<div id="credit">Modèle du shiba : « Shiba » par zixisun02 — CC-BY 4.0</div>
```

CSS (avec les autres HUD) :

```css
#credit {
  position: fixed; bottom: 0.7rem; left: 0.9rem; z-index: 21;
  font-size: .55rem; letter-spacing: .06em;
  opacity: .45; pointer-events: none;
  text-shadow: 0 1px 10px rgba(0,0,0,.75);
}
:root.touch #credit { left: 0.9rem; bottom: calc(env(safe-area-inset-bottom, 0px) + 0.6rem); }
```

Retirer `.hint .credit` du panneau (l.436) pour ne pas doubler. `H` continue de masquer `#hud` / `#panel` seulement — `#credit` n'est pas touché (`main.js:1172-1175` inchangé).

- [ ] **H6.** Relancer invariants **low ET ultra**. Expected : `INVARIANTS: N pass, 0 fail` (N = ancien + 4 : 1 rochers + 3 herbe). `node --check src/main.js`.

Visuel rapide : `H` masque l'UI, le crédit bas-gauche reste ; un étang vu du ciel sans rocher dans l'eau.

- [ ] **H7.** `REPRISE.md` — session « audit 01/09 vague 2 » (H a le droit d'append REPRISE : A est mergé ; n'éditer **que** une section nouvelle en fin de fichier, ne pas reformuler A).

- [ ] **H8.** Commit

```bash
git add src/main.js index.html test/invariants.html REPRISE.md
git commit -m "$(cat <<'EOF'
fix: rochers hors étangs, crédit CC-BY hors HUD, invariants herbe

isInPond branché sur createIsland. 4 checks (rochers + herbe rase).
EOF
)"
```

- [ ] **H9.** Review adversariale `ADV-2026-09-01-H` : second Grok (skill `review` ou sous-agent lecture seule), **pas** Codex. Rapport dans `ADVERSARIAL_REVIEW_CLAUDE.md` (nom historique). Traiter ou justifier avant J.

---

### Task J: Banc fps honnête (vague 3, machine cible, **après** H)

**Files:**
- Modify: `AGENTS.md` (bullet Lancer fps seulement)
- Modify: `PLAN.md` (plus de §2bis « ~40 ») — déjà fait en A ; ici **uniquement** coller les nouveaux chiffres s'ils bougent
- Modify: `REPRISE.md` (table de mesure)

**Interfaces:**
- Consumes: piège 9 (`AGENTS.md`)
- Produces: 4 nombres (printemps ouverture, printemps sol, automne ouverture, automne sol) ±0.3 fps

Protocole **obligatoire** (sinon les chiffres sont inventés) :

```js
// console, après boot
__sk.setCamMode('orbit');
__sk.controls.autoRotate = false;
__sk.controls.enableDamping = false;
__sk.world.paused = true;
__sk.world.dayTime = 0.5;
// vérifier dérive caméra nulle sur 3 s (position identique)
const gl = __sk.renderer.getContext();
const buf = new Uint8Array(4);
function frameSync() {
  __sk.frame();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
}
// 120 frames, chrono performance.now(), fps = 120 / dt
```

Deux poses : (1) cadrage d'ouverture = `CAMERA.start` / `CAMERA.target` ; (2) sol prairie, caméra suivie **ensuite** figée (`setCamMode('orbit')` + copier la pose, autoRotate false). Résolution cible 3600×1896 si dispo, sinon noter la taille réelle. Qualité `ultra`. Saisons `?season=spring` et `?season=autumn` (reload).

- [ ] **J1.** Mesurer 2×2. Noter DPR, taille canvas, GPU.

- [ ] **J2.** Réécrire le bullet fps de `AGENTS.md` avec les **nouveaux** nombres, date 01/09 (ou jour J), et « post-impostors, herbe 420k·AREA_SOFT ».

- [ ] **J3.** `REPRISE.md` — table 4 cellules + protocole. Commit

```bash
git add AGENTS.md PLAN.md REPRISE.md
git commit -m "$(cat <<'EOF'
docs: fps ultra re-mesurés (piège 9) après impostors et 420k
EOF
)"
```

Ne **pas** changer `DEFAULT_QUALITY`. Ne **pas** toucher aux budgets.

---

## Mapping findings → tâches (couverture)

| Finding audit | Tâche |
|---|---|
| P1 fadeEnd 330 vs 250 / PLAN ~40 fps | A (texte), J (chiffres) |
| P1 usines silencieuses | F |
| P1 deux vents | A (documente), hors-scope unifier |
| P1 rochers dans les bassins | H |
| P1 plans 12/08 et POI encore « ouverts » | A |
| P1 ultra < 30 fps sol | J (mesure) ; défaut inchangé |
| P2 heightcache + designs/ | B |
| P2 SKY_TUNE 125 | C |
| P2 keepFoliageSamples default true | F |
| P2 grassRadius mort | F |
| P2 triple mulberry32 | A (documente), hors-scope unifier |
| P2 SFX hors master | D |
| P2 PATH_HALF recopié | G |
| P2 pas de CI | hors-scope |
| P2 test/ public Vercel | A (documente) |
| P2 H cache le crédit CC-BY | H |
| P2 serve.py listing | E |
| P2 collision de nom « lot 5 » | A |
| P2 headers shiba / pétales | G |
| P2 world bag incomplet | H |
| P2 commentaires rivière | G |
| P3 initPath JSDoc | G |
| P3 quality.stars lookup mort | C |
| P3 .hermes untracked | E |

---

## Orchestration Grok (session principale)

1. Lancer **A–G en parallèle** (7 worktrees, 7 sous-agents Grok, brief = la Task, + « n'édite AUCUN fichier hors liste », + « INTERDICTION de sous-traiter », + « pas de Codex »).
2. Rebase-merge dans l'ordre A, B, C, D, E, F, G (pas de chevauchement). `git diff` relu. `node --check` déjà dans chaque tâche.
3. Un Grok pour H. Invariants low **et** ultra. Visuel crédit + étangs. ADV-2026-09-01-H.
4. J **sur la machine cible**, pas un runner headless (piège 8 : onglet background). Coller les chiffres mesurés, pas les inventer.

**Deux options d'exécution :**

1. **Subagent-Driven (recommandé)** — un sous-agent **Grok** par tâche A–G en parallèle (`general-purpose` ou `grok-delegate`, interdiction de sous-traiter), review Grok entre merges, puis H, puis J.
2. **Inline** — executing-plans dans **cette** session Grok, une tâche à la fois, dans l'ordre A…G puis H puis J (perd le parallèle).

Quelle approche ?
