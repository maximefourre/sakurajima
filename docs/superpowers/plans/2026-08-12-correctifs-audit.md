# Correctifs audit 12/08 — plan d'implémentation

> **Pour agents implémenteurs :** ce plan s'exécute **un chantier à la fois**.
> Chaque étape est cochable (`- [ ]`). Interdiction de sous-traiter (un Codex
> laissé libre re-délègue et n'écrit rien — `AGENTS.md`). Ne pas sauter les
> mesures : ce projet a déjà payé des fps inventés (piège 9).
>
> **REQUIRED SUB-SKILL à l'exécution :** `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans`.
>
> **Révisions ADV (12/08, 3 subagents, tous `needs-attention` sur le v1).**
> Intégrées ci-dessous. Ne pas réintroduire les fourches que l'ADV a tuées
> (`seaPassable` à côté de `passable`, fan 1 anneau + clear, `R = radius+80`,
> « mount puis return » sans capture phase).

**But :** fermer les findings de l'audit du 12/08 (`main` @ `f8187c8`) sans
ajouter de feature, sans réintroduire rivière/pont, sans casser le `0 fail`
des invariants.

**Architecture :** six chantiers séquentiels, chacun commitable seul. L'eau
reste « une hauteur ou rien » pour la flottaison ; la *classification*
étang/mer est une deuxième question, et **toute** décision mer/étang
(passable, nage, caméra) passe par elle. Les rubans gardent
pose-puis-dégagement ; la terrasse devient un **patin à anneaux**, pas un
éventail. Les enveloppes ombre/herbe lisent un rayon **mesuré**, jamais
`125` ni `WORLD.size === 240`.

**Stack :** Three.js 0.185.1 vendorisé, aucun build, `python3 serve.py 5173`.

## Contraintes globales

- **Serveur : `python3 serve.py 5173`. JAMAIS `python -m http.server`.**
- **Aucune dépendance nouvelle.** Pas de npm, pas de CDN.
- **`island.heightAt` est la source de vérité.** Ne pas brancher `heightcache.js`.
- **`LAND_SCALE` / `HEIGHT_SCALE` :** XZ à la définition, hauteurs une fois
  dans `analyticHeight`.
- **Changement de qualité = reload.**
- **Pas de rivière, pas de pont.**
- **Piège 1 (winding), 5 (OrbitControls.update en follow), 9 (fps).**
- **`createSakuraForest` : `quality` numérique.** `createGrass` : `count`,
  `bounds`, `exclude` / `shortZone`.
- Après chaque chantier : `node --check` des fichiers touchés,
  `test/invariants.html` **low ET ultra** → **`0 fail`** (ne pas figer N),
  puis commit.
- Brief Codex : **interdire explicitement de sous-traiter.**
- Ne pas hardcoder `26 pass` / `27 pass` dans AGENTS, PLAN, ni le journal.

## Hors scope (volontaire)

| Idée | Pourquoi |
|---|---|
| Bras d'occlusion caméra / lerp de `lookAt` | Feature, pas le plancher |
| Gravité hors saut (`airborne` en marchant dans le vide) | Locomotion à part |
| Unifier les 3 vents | Art direction |
| Supprimer `heightcache.js` | Mort inoffensif |
| Exclure `test/` de Vercel | Décision produit |
| `terrainH` océan bilinear vs triangles | Cosmétique rivage |
| `isInPond` sur les rochers | 2ᵉ placement après `attach` |
| Défaut public `high` | Décision utilisateur 08/08 |
| `fadeEnd` → 700+ pour voir l'herbe depuis l'ouverture | Coût géométrique (piège 10) — on **réécrit le contrat visuel**, on n'allonge pas le fade |
| Proximité de sente vs `wL`/`wR` locaux | I2 = les boudins ne dépassent plus le lift ; le liséré des pinces reste |

## Structure des fichiers

| Fichier | Chantiers | Rôle |
|---|---|---|
| `AGENTS.md`, `PLAN.md` | A | Contrats vrais **y compris** fade herbe, `sunDistance`, vérif visuelle |
| `src/shiba.js` | B | `passable` + hystérésis nage (profondeur **plate**) + hook de test |
| `src/main.js` | B, D, E | `water.isPond`, caméra, tactile **avant** OrbitControls, clavier, bounds herbe |
| `test/invariants.html` | B, C, E, F | Laisse, terrasse dédiée, largeur, near d'ombre, honnêteté |
| `src/details.js` | C | Terrasse anneaux + largeur fbm + `pathSurfaceLiftAt` |
| `src/grass.js` | C, E | `pathLiftY` (C) ; commentaire fade (E) — les deux touchent ce fichier |
| `src/sky.js` | E | R/D dérivés, fallback `SKY_TUNE` **même formule** |
| `REPRISE.md` | chaque | Journal |
| `ADVERSARIAL_REVIEW_CLAUDE.md` | après B–F | Suivi `ADV-2026-08-12-<lettre>` |

## Faits vérifiés (ne pas re-découvrir)

- `passable` (`shiba.js:340-348`) : `s > seaLevel + 0.5`. `uWaveAmp = 1.15`
  (`island.js:896`). Crestes Gerstner jusqu'à ≈ 2.45. Invariant 14 : mer plate.
- `createShiba` n'expose **pas** `_passableForTest` aujourd'hui (`:942-983`).
  `nowT` n'est écrit que dans `update`. Un check qui l'appelle **plante**,
  il n'échoue pas.
- Invariants 12 et 14 ne passent pas par `passable`. Un centre d'étang a
  encore `h >> seaLevel - 3` : `pondOpen` sur un vrai bassin ne prouve
  **pas** la branche étang.
- `oceanSwellY` sans uniforms rend **0** (`island.js:307`) — un test qui
  l'appelle mal **verdit le bug**.
- Terrasse : fan 28 segs, chaque triangle contient le sommet 0
  (`details.js:1629`). `clearRibbonTriangles` relève les 3 sommets du
  même montant (`:510-513`) → le pire triangle soulève **toute** la dalle.
  Face ouest : `sstep(0.545, 0.585, d)` sur ≈ 22 u (`island.js:593`) ;
  `slopeAt` milieu de face ≈ 0.58–0.64, **sous 0.72**.
- `P_CELL = 12`, `P_PAD = width/2 + 6 = 8.4`. Après `PATH_HALF ≈ 3.07`,
  arbres `extra=4` → rayon 7.07 < 12. **Ne pas** monter `P_CELL`.
- `createSky` lit `SKY_TUNE.islandRadius` **seulement** pour les caméras
  d'ombre (`sky.js:942-967`). Un arg oublié + R élargi = near **négatif**.
- Masque terre jusqu'à `d ≈ 1.10` (ellipse) ; rochers jusqu'à `1.30 · R`.
  `R + 80` ≈ `1.14 · R` : c'est les stacks, **sans** marge, sans la côte.
- Premier doigt hybride : `OrbitControls` est créé **avant** le handler
  follow (`main.js:102` puis `:305`). `onFirstTouch` en bubble arrive trop
  tard ; `endDrag` avec `touchActive` et id absent laisse `dragging === true`.

---

## Découpage

```
A  docs-contrats     (aucune logique de scène — y compris vérif visuelle)
B  laisse + nage     C1 passable + profondeur plate pour state.swimming
C  sentes            I1 terrasse ANNEAUX + I2 largeur + lift herbe
D  jouer             I4 plancher eau + I5 capture-phase + I6 repeat
E  enveloppes        I3 ombres (R mesuré) + bounds herbe
F  banc honnête      I8 + LOAD_STEPS
```

A d'abord. B puis C (tous deux touchent `invariants.html`). D après B
(même famille eau, mais D **n'utilise pas** `water.isPond` — classifier
inline identique, documenté). E après C (`grass.js` partagé). F après C.

---

### Chantier A — Contrats vrais

**Fichiers :** `AGENTS.md`, `PLAN.md`, en-tête `src/shiba-gltf.js`,
`src/grass.js:176-177`, `REPRISE.md`.

**Ne pas toucher à la scène.**

- [ ] **A1.** `AGENTS.md` :
  - Contrôles : Espace = saut, `P` = pause.
  - Chemins : herbe **rase** via `shortZone`, pas exclusion dure.
    Vérif §2 : plus « herbe exclue dessus ».
  - Dégagement : arrangement exact ruban ∩ grille ; barycentrique =
    fallback sans `heightGrid`.
  - Ultra herbe : `560000 · AREA_SOFT` ≈ 3.17 M.
  - Supprimer « (grille de buckets) branché dans l'exclude… ».
  - Archi : `fireflies.js`, `butterflies.js`, `shiba-gltf.js`,
    `touch.js`, `particles.js`, `boot.js`.
  - **`sunDistance` dérive du rayon d'ombre réel**, pas d'une constante
    `125 · LAND_SCALE`. Near = `D − R − 80` doit rester > 0.
  - Vérif visuelle herbe : plancher 0.55 **à la caméra suivie, sur la
    prairie** ; l'ouverture peut être de l'albedo (fade 330, coût
    géométrique). La laisse est fermée ; la pose de nage ne doit plus
    pomper avec la houle (chantier B).
  - Invariants : « N pass, **0 fail** » — N n'est pas un contrat.
- [ ] **A2.** `PLAN.md:21` : « 0 fail (N imprimé) », plus « 7 pass attendus ».
- [ ] **A3.** `shiba-gltf.js:21-22` : l'état réel (squelette + poids + `pose*`).
- [ ] **A4.** Relire le diff. Commit `docs: contrats alignés sur le code (audit 12/08)`.

**Critère :** un agent qui ne lit que `AGENTS.md` ne conclut plus
« Espace pause », « herbe interdite sur la sente », « ombres calées sur
125 », ni « herbe visible dès l'ouverture ».

---

### Chantier B — Laisse de mer + nage (C1)

**Fichiers :** `src/shiba.js`, `src/main.js`, `test/invariants.html`,
`REPRISE.md`.

**Règles ADV (non négociables) :**

1. **Une** fonction live. Pas d'export `seaPassable` à côté de `passable`.
2. Le hook de test appelle `passable` après `nowT = t`.
3. Ordre TDD : hook + check qui **échoue** sur la formule actuelle,
   **puis** changement de formule.
4. `surfaceAt` du banc = mer **synthétique** `seaLevel + 1.15 * sin(t)`,
   jamais `oceanSwellY` (qui peut valoir 0). Précondition :
   `max s(t) > seaLevel + 0.5`.
5. La branche étang se prouve avec un bassin **synthétique**
   (`h = seaLevel - 5`, `surfaceAt = 8`, `isPond = true`), pas le centre
   réel (lit encore `>> -3`).
6. Invariants 12/14 : hors scope C1 (ils ne passent pas par `passable`).

**Interfaces :**

- `water.surfaceAt(x,z,t) → number|null` — **inchangé**.
- `water.isPond(x,z) → boolean`. Absent ⇒ tout plan d'eau est la **mer**
  (laisse). Plus sûr qu'un faux étang.
- Hook interne, renvoyé sur l'objet shiba :

```js
// Uniquement pour le banc. Pose nowT puis appelle passable.
passableAt(x, z, t) { nowT = t; return passable(x, z); }
```

- [ ] **B1.** Ajouter `passableAt` **sans** changer la formule de `passable`.
  Dans le banc, après l'invariant 14 :

```js
{
  const seaLevel = WORLD.seaLevel;
  const x = 0, z = island.radius * 1.35;
  const h = island.heightAt(x, z);
  const deep = h < seaLevel - SHIBA.swimReach - 0.5;
  const water = {
    surfaceAt: (_x, _z, t) => seaLevel + 1.15 * Math.sin(t),
    isPond: () => false,
  };
  const dog = createShiba({ seed: SEED, heightAt: island.heightAt, water, body: null });
  let crestOpens = false;
  let maxS = -Infinity;
  for (let t = 0; t <= Math.PI * 2; t += 0.1) {
    const s = seaLevel + 1.15 * Math.sin(t);
    if (s > maxS) maxS = s;
    if (dog.passableAt(x, z, t)) crestOpens = true;
  }
  const deepPond = createShiba({
    seed: SEED,
    heightAt: () => seaLevel - 5,
    water: {
      surfaceAt: () => 8,
      isPond: () => true,
    },
    body: null,
  });
  const pondOpen = deepPond.passableAt(0, 0, 0);
  dog.dispose();
  deepPond.dispose();
  check('laisse de mer : houle n’ouvre pas le large, étang profond ouvert',
    deep && maxS > seaLevel + 0.5 && !crestOpens && pondOpen,
    `h=${h.toFixed(2)} maxS=${maxS.toFixed(2)} crestOpens=${crestOpens} pondOpen=${pondOpen}`);
}
```

- [ ] **B2.** `?q=low` : ce check **FAIL** (`crestOpens === true`). Si la
  page plante, s'arrêter — ne pas « réparer » le test.

- [ ] **B3.** `main.js` ~573 : ajouter `isPond: (x, z) => world.ponds.pondWaterYAt(x, z) !== null`.

- [ ] **B4.** `passable` :

```js
function passable(x, z) {
  const h = heightAt(x, z);
  const s = water.surfaceAt(x, z, nowT);
  if (s !== null) {
    if (typeof water.isPond === 'function' && water.isPond(x, z)) return true;
    return h > seaLevelLocal - SHIBA.swimReach;
  }
  return !(slopeAt && slopeAt(x, z) > SHIBA.maxSlope);
}
```

  **Interdit :** `s > seaLevel + k` sous quelque forme.

- [ ] **B5.** Hystérésis de nage (`shiba.js:803-821`) : `state.swimming`
  se décide sur une profondeur **plate**, pas sur la houle.

```js
const still = typeof water.isPond === 'function' && water.isPond(position.x, position.z)
  ? s                                   // plan d'étang (déjà plat)
  : (s !== null ? seaLevelLocal : null);
const depthStill = still === null ? 0 : Math.max(0, still - ground);
// depth (houle) reste pour targetY / VFX
if (state.swimming) {
  if (depthStill < SHIBA.swimDepth - 0.12) state.swimming = false;
} else if (depthStill > SHIBA.swimDepth) {
  state.swimming = true;
}
```

  `targetY` continue d'utiliser `s` (le chien suit la vague). Seul
  l'état nage/sol est plat.

- [ ] **B6.** Relancer le check B1 : **PASS**. low **et** ultra, 0 fail
  sur tout le banc. Promener vers le large : il longe, pas de cliquetis
  au-delà de −3 ; en nageant sur place la pose ne bascule pas à chaque
  creux. `node --check`. Commit
  `fix(shiba): la houle n'ouvre plus la laisse ni la pose de nage`.

**Critère :** `crestOpens === false` avec `maxS > 0.5`. Bassin synthétique
profond ouvert. Pas de second chemin `s > seaLevel + …`.

---

### Chantier C — Sentes (I1 + I2)

**Fichiers :** `src/details.js`, `src/grass.js`, `test/invariants.html`,
`REPRISE.md`.

**Règles ADV (non négociables) :**

1. **Pas** d'éventail 1 anneau + `clearRibbonTriangles`. Le sommet centre
   est dans chaque triangle → le pire déficit soulève la dalle.
2. Recette du patin (`computeJunctionPad`, 10×72) : anneaux concentriques,
   rayons **déjà clipés** par azimut, **puis** dégagement.
3. Ne jamais abandonner un azimut (corde opaque, `aPathEdge` interpolé
   ≈ 0 → terre volante). `r ≥ r_min` (~0.4).
4. Clip : `|h − h0| > 0.25` **ou** `slopeAt > 0.45` → réduire r, **ne
   pas** relever. `slopeAt` (ou diff finie sur `heightGrid.step`) est un
   argument du builder. 0.72 est trop haut pour la face ouest (~0.60).
5. `computeOverlookTerrace(heightAt, heightGrid, slopeAt)` lit
   `PATHS.routes` par `name === 'torii'`, dernier point, **sans** second
   `LAND_SCALE`, **sans** `_routes`. Même fbm d'outline qu'aujourd'hui.
6. Supprimer le bloc inline `details.js:1601-1641` (sinon double mesh).
7. **Ne pas** pousser la terrasse dans l'agrégat 8–10 tant que le clip
   n'est pas prouvé. Check **dédié** C5, intérieur visible seulement
   (`aPathEdge ≤ 0.66`). Si `highest > 0.55` : resserrer le clip, **ne
   pas** monter le plafond.
8. Largeur :

```js
const unit = (x, z, ox, oz) => {
  const u = fbm2(x * 0.11 + ox, z * 0.11 + oz, 2) * 0.5 + 0.5;
  return clamp(u, 0, 1);
};
const wL = wk * PATHS.width * 0.5 * (0.78 + 0.50 * unit(p.x, p.z, 3.1, 0));
const wR = wk * PATHS.width * 0.5 * (0.78 + 0.50 * unit(p.x, p.z, -9.4, 5.2));
export const PATH_HALF = PATHS.width * 0.5 * 1.28; // max après remap
```

   `isOnPath` / `pathProximity` utilisent `PATH_HALF`. Les pinces (1.87)
   auront encore un liséré d'herbe rase plus large que le ruban — **accepté**.
9. `P_PAD = PATH_HALF + 6`. **Ne pas** changer `P_CELL` (12 suffit :
   7.07 < 12). `extra` arbres = 4, inchangé.
10. `pathLiftY = pathSurfaceLiftAt(heightAt, x, z)`. Lift terrasse =
    0.22→0.14 selon r / r_azimut **retenu**, pas `R_max`.

- [ ] **C1.** Extraire le builder anneaux + clip + clear. Brancher
  `createDetails` dessus. Détruire l'inline.
- [ ] **C2.** Remap fbm + `PATH_HALF` + `P_PAD`.
- [ ] **C3.** `pathSurfaceLiftAt` : disque de terrasse au rayon clipé.
- [ ] **C4.** `pathLiftY` réel.
- [ ] **C5.** Banc **`?q=ultra`** :
  - check dédié terrasse (pas l'agrégat 8–10) : intérieur visible
    au-dessus du terrain, `highest ≤ 0.55`, `|logical − actual| ≤ 0.25` ;
  - 40 stations / route : `wL, wR ≥ 0.78 * PATHS.width/2 - 1e-3`.
- [ ] **C6.** Visuel : pattes **sur** la dalle ; pas de ruban fil.
  `node --check`. Commit
  `fix(paths): terrasse en anneaux dégagée, largeur de ruban honnête`.

**Critère :** centre terrasse `|groundAt − meshY| ≤ 0.25`. Aucune
demi-largeur < 0.78 nominale. Invariants 8–10 (rubans + patin) toujours
verts en ultra.

---

### Chantier D — Jouer (I4, I5, I6)

**Fichiers :** `src/main.js`, `REPRISE.md`. Pas besoin de `touch.js` si
le mount est hissé dans `main.js`.

**I4 — plancher d'eau (mer plate).** Ne passe **pas** par `water.isPond`
(le follow n'a pas l'objet `water` sous la main). **Même prédicat**,
écrit une fois en commentaire « identique à `water.isPond` + mer plate » :

```js
const gx = _camWant.x, gz = _camWant.z;
const ground = (world.groundAt || world.heightAt)(gx, gz);
const pondY = world.ponds.pondWaterYAt(gx, gz);
const stillSea = world.heightAt(gx, gz) < world.island.seaLevel
  ? world.island.seaLevel   // PAS oceanSwellY
  : null;
const waterY = pondY !== null ? pondY : stillSea;
const floor = Math.max(ground, waterY ?? -Infinity) + 1.2;
```

Hors scope : rayon d'occlusion, lerp de `lookAt`.

**I5 — ADV : capture-phase AVANT OrbitControls.**

Aujourd'hui OC est construit ligne 102, le follow à 305, `onFirstTouch`
en bubble trop tard.

- [ ] **D2.** **Avant** `new OrbitControls(...)` :

```js
const onFirstTouchCapture = (e) => {
  if (e.pointerType !== 'touch' || touchActive) return;
  e.stopImmediatePropagation();
  mountTouchControls();   // hissé : let mountTouchControls = () => {};
};
renderer.domElement.addEventListener('pointerdown', onFirstTouchCapture, {
  capture: true,
});
```

  `mountTouchControls` est une `let` au scope module, assignée dans
  `boot` (les listeners canvas existent déjà ; le premier toucher est
  après boot). Dans `endDrag` : si l'id est inconnu, **quand même**
  `follow.dragging = false`.

  Critère : le premier doigt ne démarre **ni** OC ni follow drag.

**I6 :**

```js
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  ...
});
```

- [ ] **D1.** Plancher eau.
- [ ] **D2.** Capture-phase + hoist + `endDrag` défensif.
- [ ] **D3.** `e.repeat`.
- [ ] **D4.** Nager : lentille au-dessus de l'eau. Hybride : premier
  doigt révèle l'UI, `follow.dragging === false`, OC n'a pas mangé le
  geste. Maintenir `C`/`P` = un toggle. `node --check`. Commit
  `fix(play): plancher d'eau, premier doigt en capture, pas de repeat`.

---

### Chantier E — Enveloppes (I3)

**Fichiers :** `src/sky.js`, `src/main.js`, `src/grass.js` (commentaire),
`test/invariants.html`, `REPRISE.md`.

**Ombre — les deux knobs, fallback identique.**

Mesurer une fois (script one-shot dans la console de `invariants.html`
ou dans E1) le max `hypot(x,z)` des sommets terrain avec `h > seaLevel`
**et** des centres de rochers. S'attendre à ~`1.30 · island.radius`.

```js
// sky.js — fallback = même formule, pour qu'un oubli d'arg ne tue pas les ombres
function shadowEnvelope(islandR) {
  const R = islandR ?? (1.30 * (125 * LAND_SCALE) + 10); // jamais l'ancien 125*L nu
  return { R, D: Math.round(R + 220) };
}
```

Mieux : `SKY_TUNE.islandRadius` devient `1.30 * 125 * LAND_SCALE + 10`
(≈ 1.30 × ancienne valeur, pas 125). `sunDistance = islandRadius + 220`.
`createSky({ islandRadius })` **remplace** les deux.

```js
world.sky = createSky({
  ...,
  islandRadius: world.island.radius * 1.30 + 10,
});
```

Near = `D − R − 80` = 140. **Interdit** de changer R sans D.

Texels : R 397 → ~740, texel ultra ×1.86. Noter dans REPRISE. Vérif
visuelle crépuscule : pas d'acné / peter-panning évident. Si oui,
`normalBias` — **pas** élargir `bias` à l'aveugle.

**E1 n'est pas une identité.** Le banc n'a pas de sky. Options :
exporter `shadowEnvelope` depuis `sky.js` et asserter
`env.R >= island.radius * 1.29 && env.D - env.R - 80 > 0` **et**
`env.R >= island.radius * 1.30` sur la valeur que `createSky`
utiliserait (`island.radius * 1.30 + 10`). Ça prouve le **choix**,
pas juste `220-80>0`.

**Herbe — bounds, pas fade.**

```js
bounds: { radius: world.island.radius * 1.12 },
```

(`normBounds` comprend `radius`.) N fixe → densité intérieure baisse
un peu. **Ne pas** vendre « herbe sur la plage » comme victoire E3
(la fin de plage est déjà dans ±365). Victoire réelle : côte au-delà
de R actuelle (365) jusqu'à ~1.12 R.

Fade 240/330 **inchangé**. Contrat déjà réécrit en A.

- [ ] **E1.** Check `shadowEnvelope(island.radius * 1.30 + 10)`.
- [ ] **E2.** `createSky({ islandRadius })` + fallback `SKY_TUNE` aligné.
- [ ] **E3.** `bounds: { radius: island.radius * 1.12 }`.
- [ ] **E4.** Commentaires sky/grass : plus de « WORLD.size 240 ».
- [ ] **E5.** Midi ultra : pas de disque d'ombre net à ~400 u. Crépuscule :
  contact shadows lisibles. `node --check`. Commit
  `fix(scale): ombres et herbe calées sur 1.30·island.radius`.

**Critère :** `near > 0`. Un oubli d'`islandRadius` ne peut plus produire
un near négatif. Un point terre à `1.05 · island.radius` peut recevoir
de l'herbe (sauf exclude / plage / pente).

---

### Chantier F — Banc honnête (I8) + LOAD_STEPS

**Fichiers :** `test/invariants.html`, `src/main.js`, `REPRISE.md`.

- [ ] **F1.** `LOAD_STEPS = 13` (13 `await step(...)` dans `boot`).
- [ ] **F2.** `if (!Object.hasOwn(QUALITY, q)) return;` avant persist.
- [ ] **F3.** Banc :
  - Dès le départ : `TIER=<low|high|ultra>`.
  - Si `TIER !== 'ultra'` : `WARN: banc en ${TIER} — les rubans se jugent en ?q=ultra`.
  - Lanternes : **une** marge, constante partagée avec le placement.
    `extra = 1.3 + 0.3` (slack d'échantillonnage d'arc). Après C,
    `r = PATH_HALF + extra`. **Avant** de supprimer le retry@5 :
    imprimer une fois `max_i |lantern − axis| − sideOff`. Si > 0.3,
    augmenter le slack, ne pas remettre un retry silencieux.
  - `onerror` / `unhandledrejection` : `fail++`, `INVARIANTS:` dans
    un `finally`.
  - **Ne pas** asserter `worstAll > 0` sur le liséré (`cut > 0.90`).
- [ ] **F4.** low et ultra : 0 fail. Commit
  `test: banc honnête (tier visible, lanternes, LOAD_STEPS)`.

---

## Ordre et briefs Codex

Un Codex **par** chantier, effort high, **interdiction de sous-traiter**.
Après B–F : revue adversariale, id `ADV-2026-08-12-B` … `F`, tableau
dans `ADVERSARIAL_REVIEW_CLAUDE.md`.

| # | Chantier | Risque | Dépend |
|---|---|---|---|
| A | Docs | nul | — |
| B | Laisse + nage | faible si TDD respecté | A |
| C | Sentes | **falaise / winding / 0.55** | A |
| D | Jouer | capture OC | — (pas B) |
| E | Enveloppes | **near-plane, texels, grass.js** | C (fichier) |
| F | Banc | faible | C (`PATH_HALF`) |

Phrase à coller en tête de **chaque** brief :

> Tu écris le code toi-même. Tu n'appelles aucun sous-agent. Tu suis
> uniquement le chantier X du plan
> `docs/superpowers/plans/2026-08-12-correctifs-audit.md`. Tu ne
> hardcodes pas le nombre d'invariants. E change R **et** D. D2 est
> capture-phase avant OrbitControls, pas un `return` dans `onFirstTouch`.

## Vérification finale (après F)

1. `node --check` sur tous les `src/*.js` touchés.
2. `test/invariants.html?q=low` et `?q=ultra` : `0 fail`, ligne `TIER=`.
3. Visuel :
   - mer : longe, ne part pas ; pose de nage stable sur une crête ;
   - torii : pattes sur la terrasse, dalle non soulevée d'un cran ;
   - midi : pas de coupure d'ombre à ~400 u ;
   - `C`/`P` : un tap = un toggle ;
   - hybride : premier doigt = UI, pas un drag caméra.
4. `AGENTS.md` encore vrai. `REPRISE.md` à jour.
