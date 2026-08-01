# Chantier L — lucioles nocturnes : plan d'implémentation

> **Pour agents implémenteurs :** ce plan s'exécute tâche par tâche. Chaque étape
> est cochable (`- [ ]`). Ne pas sauter les étapes de mesure : elles existent
> parce que ce projet a déjà payé des mesures inventées (piège 9 d'`AGENTS.md`).

**But :** peupler la nuit de Sakurajima de lucioles ancrées sur les trois étangs
à koi, qui clignotent en synchronie par bassin — sans toucher à l'exposition
nocturne ni dégrader les fps.

**Architecture :** un module neuf, `src/fireflies.js`, exposant une fonction pure
de placement (testable dans le banc d'invariants) et un `InstancedMesh` unique
dont TOUT le mouvement vit dans le vertex shader — le CPU pose deux uniformes par
frame et ne touche à rien d'autre. C'est le patron de `petals.js`, pas celui de
`birds.js` : les lucioles n'interagissent avec rien.

**Stack :** Three.js 0.185.1 via importmap unpkg, **aucun build, aucun bundler,
aucun `npm install`**. Modules ES natifs servis par `python3 serve.py`.

## Contraintes globales

Copiées d'`AGENTS.md` et du spec. Elles s'appliquent à **toutes** les tâches.

- **Serveur : `python3 serve.py 5173`. JAMAIS `python -m http.server`** — il
  sert les modules ES avec un mauvais type MIME et masque les erreurs.
- **Aucune dépendance nouvelle.** Pas de npm, pas de CDN supplémentaire.
- **`LAND_SCALE`** : toute coordonnée XZ auteur est multipliée par lui *à sa
  définition*. Les positions d'étangs lues via `PONDS` sont **déjà** à l'échelle
  — ne pas remultiplier.
- **Changement de qualité = reload.** Chaque système se dimensionne à la
  construction. Pas de rebuild à chaud, pas de câblage dupliqué.
- **Piège 3 (GLSL) :** pas de backticks dans les commentaires de shader, et
  `fog_vertex` exige une variable nommée **littéralement** `mvPosition`.
- **Piège 1 (winding) :** si le mesh ne rend rien, forcer `side: THREE.DoubleSide`
  à chaud avant de chercher ailleurs. Quatre morsures déjà payées sur ce projet.
- **Piège 9 (mesure fps) :** toute mesure exige `gl.readPixels(0,0,1,1,…)` après
  chaque frame ET `setCamMode('orbit')` + `autoRotate = false` +
  `enableDamping = false` + dérive de caméra vérifiée nulle.
- **Ce chantier ne touche pas `src/details.js`.** Si une tâche vous y amène,
  arrêtez-vous et signalez-le. (La session parallèle qui y construisait un hokora
  a commité — `71b5cfb` — mais la règle tient : les lucioles n'ont rien à y
  faire.)
- Après chaque tâche : `node --check` sur les fichiers touchés, puis commit.
- Écrire les commentaires en français ou en anglais selon le fichier voisin ;
  `src/` est majoritairement en anglais avec des passages français récents. Suivre
  le ton du projet : expliquer **pourquoi**, pas paraphraser le code.

## Structure des fichiers

| Fichier | Responsabilité | Action |
| --- | --- | --- |
| `src/fireflies.js` | placement (pur) + mesh + shader + gate nuit | **créer** |
| `src/config.js` | budgets par tier + constantes d'art direction | modifier |
| `src/main.js` | construction dans le boot + 1 appel dans la boucle | modifier |
| `test/invariants.html` | invariants 11 et 12 | modifier |
| `REPRISE.md` | journal de session (convention du projet) | modifier |

**`src/details.js` : intouché.** **`src/ponds.js` : intouché** — il exporte déjà
tout ce qu'il faut.

## Faits vérifiés dans le code (à ne pas re-découvrir)

- `ponds.PONDS` est un `Array<{x, z, radius, waterY, depth}>` de 3 entrées.
  `radius` et `waterY` sont **nominaux jusqu'à `attach()`**, qui les remplace par
  les valeurs **mesurées** sur le bassin réellement creusé (`ponds.js:1367-1372`).
- `main.js:311` appelle `world.ponds.attach({ heightAt: world.heightAt })`.
  **Toute construction de lucioles doit venir APRÈS cette ligne**, sinon le rayon
  d'habitat est calculé sur des rayons nominaux qui ne sont pas ceux de l'eau.
- `test/invariants.html` **n'appelle pas `attach()`** aujourd'hui. La tâche 3 l'ajoute.
- `sky.update()` renvoie `phase`, qui porte `day`, `night`, `twilight`, `golden`,
  `stars`, `emissive`, `solar`. `sky.js:1029` commente déjà `emissive` par
  « petals / lanterns / **fireflies** glow amount ».
- Seuil de bloom **animé** : `K_BLOOM_THRESHOLD` (`sky.js:385`) vaut **0.42 en
  pleine nuit**. Le 0.85 du constructeur (`sky.js:1148`) est écrasé chaque frame.
- `QUALITY.low.bloom === false` → **pas de composer sur le tier low**, donc pas
  de halo. Le sprite doit porter sa propre décroissance.
- Le brouillard est un **`THREE.FogExp2`** à densité animée (`sky.js:982`, `1302`).
- `wind.uniforms` contient `uTime` (`wind.js:121`). Les lucioles **ne s'y
  branchent pas** (elles ne répondent pas au vent) et déclarent leur propre
  `uTime` — c'est délibéré, pas un oubli.

---

## Tâche 1 : relever la référence fps nocturne AVANT de toucher à quoi que ce soit

Sans référence prise avant, l'impact du chantier est indémontrable. Les chiffres
d'`AGENTS.md` (ouverture 33.7, sol 24.6) sont des mesures **de jour** — la nuit
le décor est différent (ombres, bloom fort, dôme nocturne).

**Fichiers :**
- Aucun. Tâche de mesure pure.

**Interfaces :**
- Consomme : rien.
- Produit : deux nombres (nuit-ouverture, nuit-sol) réutilisés à la tâche 7.

- [ ] **Étape 1 : lancer le serveur**

```sh
python3 serve.py 5173
```

Ouvrir `http://127.0.0.1:5173/index.html?q=ultra` et attendre la fin du
chargement (≈ 20 s en ultra : bake terrain 769² + placements).

- [ ] **Étape 2 : neutraliser TOUT ce qui bouge la caméra**

Dans la console. Les trois lignes sont obligatoires — le piège 9 documente une
mesure « cadrée » qui avait en fait dérivé de 992 unités.

```js
const { world, controls, camera, renderer } = __sk;
__sk.setCamMode('orbit');
controls.autoRotate = false;
controls.enableDamping = false;
world.paused = true;          // fige le cycle jour/nuit
world.dayTime = 0.97;         // pleine nuit, lune basse au sud
const before = camera.position.clone();
```

- [ ] **Étape 3 : mesurer avec resynchronisation GPU**

`__sk.frame()` ne fait que **soumettre** à la GPU. Sans `readPixels` pour
attendre, une boucle forcée annonçait 1413 fps.

```js
async function bench(n = 240) {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  __sk.frame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    __sk.frame();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }
  const ms = (performance.now() - t0) / n;
  return { fps: +(1000 / ms).toFixed(1), ms: +ms.toFixed(2) };
}
console.log('nuit / ouverture', await bench());
```

- [ ] **Étape 4 : VÉRIFIER que la caméra n'a pas bougé**

Si ce nombre n'est pas nul, la mesure est à jeter et il faut recommencer à
l'étape 2.

```js
console.log('dérive caméra =', camera.position.distanceTo(before).toFixed(4));
```

- [ ] **Étape 5 : répéter au sol**

```js
camera.position.set(20, 3.2, -120);
controls.target.set(20, 2.0, -135);
controls.update();
const before2 = camera.position.clone();
console.log('nuit / sol', await bench());
console.log('dérive =', camera.position.distanceTo(before2).toFixed(4));
```

- [ ] **Étape 6 : consigner les deux chiffres**

**FAIT le 01/08/2026.** Référence à battre en tâche 7 :

```
RÉFÉRENCE NUIT AVANT LUCIOLES — ultra, buffer 3600×2008, dayTime 0.97, 240 frames
  ouverture (CAMERA.start)         71.0 / 71.6 fps   (14.08 / 13.98 ms)  dérive 0
  sol (bord du grand bassin)       73.2 / 73.3 fps   (13.65 / 13.64 ms)  dérive 0
```

Deux passes par cadrage, concordantes à ≤ 0.6 fps — la mesure est stable.

Deux remarques qui comptent pour la suite :
- **La nuit est deux fois plus rapide que le jour** (71 contre 33.7 à l'ouverture).
  La clé solaire éteinte, la passe d'ombres cesse de payer le feuillage. Il y a
  donc de la marge, mais ça ne dispense pas de mesurer.
- Le buffer est **3600×2008** et non le 3600×1896 d'`AGENTS.md` (fenêtre un peu
  plus haute, ~6 % de pixels en plus). Ces chiffres ne se comparent donc qu'entre
  eux — ce qui est exactement leur usage.

Pas de commit — aucun fichier source n'a changé.

- [ ] **Étape 7 : relever les rayons de bassin réellement mesurés**

Ils dimensionnent l'habitat, et les valeurs nominales de `ponds.js` en sont loin.

**FAIT.** `attach()` élargit de ~42 %, pas des « 15-20 % » annoncés dans le
commentaire de `ponds.js` :

| Bassin | Centre | Rayon mesuré | Habitat (×2.4) | Plan d'eau |
| --- | --- | --- | --- | --- |
| 0 (le grand) | (50.8, −133.4) | 32.5 | 78.0 | 7.13 |
| 1 | (−12.7, −231.8) | 19.3 | 46.3 | 4.12 |
| 2 | (63.5, −222.3) | 13.6 | 32.6 | 3.99 |

Les trois habitats **se chevauchent** (0-1 : 117 u entre centres pour 124 u
cumulés ; 1-2 : 77 pour 79). C'est ce constat qui a imposé la décroissance calée
sur le plancher décrite en tâche 2 — sans elle, deux bassins déphasés se
seraient touchés à densité visible, et chaque nuée aurait été tranchée net en
cercle.

---

## Tâche 2 : budget et constantes d'art direction dans `config.js`

**Fichiers :**
- Modifier : `src/config.js` (bloc `QUALITY`, ≈ l.136-183, et ajout en fin de fichier)

**Interfaces :**
- Consomme : `QUALITY` existant.
- Produit : `QUALITY.<tier>.fireflies` (nombre entier) et l'export `FIREFLIES`
  (objet gelé), consommés par les tâches 4 et 5.

- [ ] **Étape 1 : ajouter le compte par tier**

Une ligne dans chacun des trois presets, juste après `rocks`. Valeurs
**absolues** — pas de `AREA_SOFT`.

```js
// dans QUALITY.low
    rocks: Math.round(35 * AREA_SOFT),
    fireflies: 160,
// dans QUALITY.high
    rocks: Math.round(74 * AREA_SOFT),
    fireflies: 420,
// dans QUALITY.ultra
    rocks: Math.round(110 * AREA_SOFT),
    fireflies: 800,
```

- [ ] **Étape 2 : ajouter le bloc d'art direction en fin de fichier**

Après le bloc `CAMERA`. Le commentaire de dérogation à `AREA_SOFT` n'est pas
décoratif : sans lui, la prochaine relecture « corrigera » ces chiffres.

```js
/**
 * Lucioles — hotaru.
 *
 * BUDGET EN ABSOLU, PAS EN AREA_SOFT, ET C'EST VOULU. La doctrine de ce fichier
 * veut que les scatters coûteux suivent AREA_SOFT parce qu'ils couvrent une
 * SURFACE. Les lucioles, non : elles sont ancrées sur trois bassins de taille
 * fixe. Les faire croître avec l'île les diluerait sans rien ajouter au cadrage.
 *
 * Le clignotement est SYNCHRONISÉ PAR BASSIN, ce qui est à la fois le
 * comportement réel des genji-botaru et le plus beau des trois choix possibles :
 * tout synchroniser fait pulser l'île d'un bloc, tout randomiser fait du bruit.
 * Chaque étang porte sa phase, chaque individu s'en écarte de `flashJitter`.
 */
export const FIREFLIES = Object.freeze({
  // Rayon d'habitat, en multiples du rayon MESURÉ du bassin (32.5 / 19.3 / 13.6
  // après attach(), soit des habitats de 78 / 46 / 33 unités).
  habitatK: 2.4,

  // Champ de densité : exp(-densityFalloff * (r/habitat)^2), coupé au plancher.
  //
  // LES DEUX CONSTANTES SONT LIÉES, NE PAS EN BOUGER UNE SEULE :
  //   densityFalloff = -ln(densityFloor)
  // Avec un exp(-u^2) nu, la densité vaut encore 0.368 au rayon d'habitat, où le
  // placement coupe net : la population serait TRANCHÉE à 37 % de densité et
  // dessinerait un cercle visible autour de chaque étang. En calant la
  // décroissance pour qu'elle atteigne le plancher exactement à la coupure, les
  // deux mécanismes disent la même chose au lieu de se contredire, et la nuée
  // s'éteint d'elle-même au bord.
  //
  // Effet de bord bienvenu : les trois habitats se chevauchent (117 u entre les
  // centres 0-1 pour 124 u d'habitats cumulés, 77 contre 79 pour 1-2). Avec la
  // décroissance calée, la densité y est negligeable — deux bassins déphasés ne
  // se retrouvent donc jamais côte à côte à densité visible.
  densityFloor: 0.06,
  densityFalloff: 2.81,   // = -ln(0.06)

  minHeight: 0.4,       // au-dessus de la surface locale (sol OU plan d'eau)
  maxHeight: 2.2,       // une hotaru traîne, elle ne monte pas

  perchedFraction: 0.25, // posées dans l'herbe, immobiles, clignotant sur place

  driftRadius: [0.5, 2.6],  // amplitude de dérive, unités monde
  driftRate:   [0.10, 0.32],// rad/s ; lent — c'est un vol traînant
  driftLift:   0.18,        // part verticale de la dérive : quasi horizontale

  // 2 s = le rythme de l'OUEST du Japon. L'est bat à 4 s ; 2 s est plus vivant.
  flashPeriod: 2.0,
  flashJitter: 0.25,     // écart individuel autour de la phase du bassin, en secondes
  flashRise: 0.04,       // fraction du cycle : 80 ms à 2 s. Un éclair, pas un sinus.
  flashDecay: 6.0,       // décroissance exponentielle, en unités de cycle

  size: [0.13, 0.20],    // demi-côté du quad, unités monde

  color: 0x9dff6a,       // jaune-vert, ~560 nm

  // Surpilotage pour passer le seuil de bloom. ATTENTION : le seuil n'est PAS
  // le 0.85 du constructeur — K_BLOOM_THRESHOLD (sky.js) l'écrase chaque frame
  // et vaut 0.42 en pleine nuit. Le 2.6 des lanternes viserait beaucoup trop
  // haut ici. À trancher en A/B contre une lanterne dans le même plan.
  overdrive: 1.6,

  // Pic d'activité après le crépuscule, en `phase.solar` : les vraies culminent
  // dans les deux heures qui suivent le coucher, pas toute la nuit à plat.
  peakSolar: 0.82,
  peakWidth: 0.16,
  peakFloor: 0.45,       // activité résiduelle au cœur de la nuit
});
```

- [ ] **Étape 3 : vérifier la syntaxe**

```sh
node --check src/config.js
```

Attendu : aucune sortie (succès).

- [ ] **Étape 4 : vérifier que rien n'a cassé**

Recharger `http://127.0.0.1:5173/index.html?q=low` : la scène doit se charger
normalement. Ajouter une clé à `QUALITY` est inerte pour tous les consommateurs
existants, mais on le confirme au lieu de le supposer.

- [ ] **Étape 5 : commit**

```sh
git add src/config.js
git commit -m "feat(lucioles): budgets par tier et constantes d'art direction"
```

---

## Tâche 3 : invariant 11 — le placement, écrit AVANT le placement

Cette tâche écrit le test d'abord. Le banc doit **échouer** avant d'implémenter,
sinon le test ne teste rien.

**Fichiers :**
- Modifier : `test/invariants.html` (imports l.36-42, et nouveau bloc avant la
  ligne `const summary = …`)

**Interfaces :**
- Consomme : `computeFireflySpots` de `src/fireflies.js` (créé à la tâche 4).
- Produit : le contrat que la tâche 4 doit satisfaire.

**Le contrat, à respecter au caractère près par la tâche 4 :**

```js
computeFireflySpots({ ponds, heightAt, isInPond, count, seed })
  → Array<{ x, y, z, pond, perched }>
// ponds    : ponds.PONDS, soit [{x, z, radius, waterY, depth}] (APRÈS attach)
// heightAt : (x, z) => number
// isInPond : (x, z) => boolean
// count    : entier, la cible ; la fonction peut en rendre MOINS si le rejet
//            n'aboutit pas, jamais PLUS
// seed     : entier, passé à streamFor pour un placement déterministe
// pond     : index entier du bassin le plus proche (0..2) — c'est lui qui porte
//            la phase de flash partagée
// perched  : bool, individu posé (immobile) plutôt qu'en vol
```

- [ ] **Étape 1 : faire appeler `attach()` par le banc**

Le banc ne l'appelle pas aujourd'hui, donc `PONDS[i].radius` y est nominal et pas
mesuré — l'habitat serait testé sur un rayon que `main.js` n'utilise jamais.
Ajouter juste après la ligne `say('island bâtie en …')` (l.68) :

```js
// Comme main.js:311 — sans ça PONDS porte des rayons NOMINAUX, et l'habitat des
// lucioles serait vérifié contre un bassin qui n'existe pas.
ponds.attach({ heightAt: island.heightAt });
```

- [ ] **Étape 2 : ajouter l'import**

Sur la ligne d'imports (après celle de `clouds.js`, l.42) :

```js
import { computeFireflySpots } from '../src/fireflies.js';
import { FIREFLIES } from '../src/config.js';
```

`FIREFLIES` peut aussi être ajouté à l'import existant de `config.js` (l.36) —
au choix, mais une seule fois.

- [ ] **Étape 3 : écrire l'invariant 11**

À insérer juste avant `const summary = …` (l.240).

```js
/* ── 11. lucioles dans leur habitat ──────────────────────────────────────── */
{
  const spots = computeFireflySpots({
    ponds: ponds.PONDS,
    heightAt: island.heightAt,
    isInPond: ponds.isInPond,
    count: QUALITY[TIER].fireflies,
    seed: SEED,
  });

  let ok = spots.length > 0;
  let detail = spots.length ? '' : 'aucune position produite';
  let worstRatio = 0, worstAt = '';

  for (const s of spots) {
    // 1. jamais plus loin que le rayon d'habitat du bassin qu'on lui attribue
    const p = ponds.PONDS[s.pond];
    if (!p) { ok = false; detail = `pond index ${s.pond} hors bornes`; break; }
    const r = Math.hypot(s.x - p.x, s.z - p.z);
    const ratio = r / (p.radius * FIREFLIES.habitatK);
    if (ratio > worstRatio) { worstRatio = ratio; worstAt = `(${s.x.toFixed(0)},${s.z.toFixed(0)})`; }
    if (ratio > 1) {
      ok = false;
      detail = `individu à ${r.toFixed(1)} u du bassin ${s.pond} (habitat ${(p.radius * FIREFLIES.habitatK).toFixed(1)})`;
      break;
    }
    // 2. le bassin attribué est bien le PLUS PROCHE — sinon la phase partagée
    //    fait clignoter un individu au rythme d'un étang qui n'est pas le sien
    let best = s.pond, bestD = r;
    for (let k = 0; k < ponds.PONDS.length; k++) {
      const q = ponds.PONDS[k];
      const d = Math.hypot(s.x - q.x, s.z - q.z);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best !== s.pond) {
      ok = false;
      detail = `individu à (${s.x.toFixed(0)},${s.z.toFixed(0)}) attribué au bassin ${s.pond}, plus proche du ${best}`;
      break;
    }
    // 3. au-dessus de la surface, jamais dedans
    const surf = ponds.isInPond(s.x, s.z) ? p.waterY : island.heightAt(s.x, s.z);
    const clearance = s.y - surf;
    if (!(clearance >= FIREFLIES.minHeight - 1e-3 && clearance <= FIREFLIES.maxHeight + 1e-3)) {
      ok = false;
      detail = `garde au sol ${clearance.toFixed(2)} hors [${FIREFLIES.minHeight}, ${FIREFLIES.maxHeight}]`;
      break;
    }
  }

  check('lucioles dans l’habitat des bassins', ok,
    ok ? `${spots.length} lucioles, 3 bassins, pire rayon ${(worstRatio * 100).toFixed(0)} % de l’habitat ${worstAt}`
       : detail);
}
```

- [ ] **Étape 4 : lancer le banc et VÉRIFIER QU'IL ÉCHOUE**

Ouvrir `http://127.0.0.1:5173/test/invariants.html`.

Attendu : la page affiche une erreur de chargement de module — `src/fireflies.js`
n'existe pas encore. C'est l'échec correct. **Si la page affiche
`INVARIANTS: 11 pass`, quelque chose ne va pas : le test ne teste rien.**

- [ ] **Étape 5 : commit du test seul**

```sh
git add test/invariants.html
git commit -m "test(lucioles): invariant 11 — habitat, bassin le plus proche, garde au sol"
```

---

## Tâche 4 : `computeFireflySpots` — le placement qui fait passer l'invariant 11

**Fichiers :**
- Créer : `src/fireflies.js`

**Interfaces :**
- Consomme : `FIREFLIES` et `QUALITY` de `config.js` (tâche 2) ; `streamFor` et
  `R` de `noise.js` ; le contrat exact de la tâche 3.
- Produit : `export function computeFireflySpots(...)`, consommé par le banc et
  par `createFireflies` (tâche 5).

**Ce qu'il faut savoir sur `noise.js` :** `streamFor(seed, 'clé')` rend un PRNG
déterministe indépendant des autres flux — c'est la raison pour laquelle ajouter
un système ne décale pas le placement des autres. `R.range(rng, a, b)` tire un
flottant dans `[a, b)`.

- [ ] **Étape 1 : écrire le fichier avec la seule fonction pure**

```js
/**
 * fireflies.js — les hotaru des trois étangs.
 *
 * Deux choix portent tout le rendu, et aucun des deux n'est évident :
 *
 *  1. LA SYNCHRONIE EST PAR BASSIN. Les genji-botaru synchronisent réellement
 *     leurs flashes. Tout synchroniser ferait pulser l'île entière d'un bloc —
 *     artificiel ; tout randomiser ferait du bruit. Chaque étang porte sa phase,
 *     chaque individu s'en écarte d'une gigue de FIREFLIES.flashJitter. Chaque
 *     bassin respire ensemble, les trois sont déphasés entre eux.
 *  2. UN QUART DE LA POPULATION EST POSÉE, immobile, et clignote sur place.
 *     C'est la même réciprocité que petals.js a payée pour le vent : une
 *     population entièrement en vol lit comme un système de particules.
 *
 * Tout le mouvement vit dans le vertex shader. Le CPU pose deux uniformes par
 * frame et ne touche à rien d'autre — patron de petals.js, pas celui de
 * birds.js : une luciole n'interagit avec rien.
 *
 * Pas de réponse au vent, DÉLIBÉRÉMENT : les hotaru volent par temps calme, et
 * une luciole emportée par une rafale lit faux. D'où un uTime privé plutôt que
 * le bloc de vent partagé.
 */

import * as THREE from 'three';
import { FIREFLIES } from './config.js';
import { streamFor, R } from './noise.js';

/**
 * Sème les lucioles sur le champ de densité des bassins.
 *
 * Champ : d(x,z) = max sur les bassins de exp(-(r / (radius * habitatK))^2).
 * Échantillonnage par REJET plutôt qu'analytique : le rejet suit
 * automatiquement les trois bassins de tailles différentes sans avoir à
 * répartir un quota entre eux, et il refuse les positions trop maigres au lieu
 * de les rapprocher artificiellement du centre.
 *
 * Rend MOINS que `count` si le rejet n'aboutit pas dans le budget d'essais.
 * Jamais plus.
 */
export function computeFireflySpots({ ponds, heightAt, isInPond, count, seed = 1 } = {}) {
  const out = [];
  if (!ponds || ponds.length === 0 || !heightAt || count <= 0) return out;

  const rng = streamFor(seed, 'fireflies.placement');

  // Rayon d'habitat par bassin, et boîte englobante commune pour tirer dedans.
  const reach = ponds.map((p) => p.radius * FIREFLIES.habitatK);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < ponds.length; i++) {
    minX = Math.min(minX, ponds[i].x - reach[i]); maxX = Math.max(maxX, ponds[i].x + reach[i]);
    minZ = Math.min(minZ, ponds[i].z - reach[i]); maxZ = Math.max(maxZ, ponds[i].z + reach[i]);
  }

  // Budget d'essais borné : sans lui, un champ de densité mal réglé boucle sans
  // fin au lieu de rendre une population maigre qu'on peut voir et corriger.
  const maxTries = count * 40;

  for (let tries = 0; tries < maxTries && out.length < count; tries++) {
    const x = R.range(rng, minX, maxX);
    const z = R.range(rng, minZ, maxZ);

    // Densité, et bassin LE PLUS PROCHE — c'est lui qui portera la phase de
    // flash partagée, donc il doit être le plus proche et pas seulement le plus
    // dense, sinon deux bassins voisins mélangeraient leurs rythmes.
    let dens = 0, pond = -1, bestD2 = Infinity;
    for (let i = 0; i < ponds.length; i++) {
      const dx = x - ponds[i].x, dz = z - ponds[i].z;
      const d2 = dx * dx + dz * dz;
      const u = Math.sqrt(d2) / reach[i];
      // Décroissance calée sur le plancher (cf. config) : à u = 1 elle vaut
      // exactement densityFloor, donc la coupure ci-dessous ne tranche rien de
      // visible. Un exp(-u*u) nu y laisserait encore 37 % de densité.
      const d = Math.exp(-FIREFLIES.densityFalloff * u * u);
      if (d > dens) dens = d;
      if (d2 < bestD2) { bestD2 = d2; pond = i; }
    }
    if (dens < FIREFLIES.densityFloor) continue;
    if (rng() > dens) continue;

    // L'individu doit rester dans l'habitat du bassin qu'on lui attribue, pas
    // seulement dans celui du plus dense : c'est ce que l'invariant 11 vérifie.
    if (Math.sqrt(bestD2) > reach[pond]) continue;

    // Surface locale : plan d'eau au-dessus du bassin, terrain ailleurs.
    const surf = isInPond && isInPond(x, z) ? ponds[pond].waterY : heightAt(x, z);
    const perched = rng() < FIREFLIES.perchedFraction;
    // Les posées se tiennent bas, dans l'herbe ; les volantes occupent la bande.
    const y = perched
      ? surf + FIREFLIES.minHeight
      : surf + R.range(rng, FIREFLIES.minHeight, FIREFLIES.maxHeight);

    out.push({ x, y, z, pond, perched });
  }

  return out;
}
```

- [ ] **Étape 2 : vérifier la syntaxe**

```sh
node --check src/fireflies.js
```

Attendu : aucune sortie.

- [ ] **Étape 3 : relancer le banc et VÉRIFIER QU'IL PASSE**

Ouvrir `http://127.0.0.1:5173/test/invariants.html`.

Attendu en console : **`INVARIANTS: 11 pass, 0 fail`**, et la ligne
`PASS — lucioles dans l'habitat des bassins (160 lucioles, 3 bassins, …)`.

Si le compte rendu est très inférieur à 160, le champ de densité est trop
sélectif : c'est visible immédiatement dans le détail du PASS, et c'est le
signal que `densityFloor` ou `habitatK` doit bouger. **Ne pas augmenter
`maxTries` pour masquer ça.**

- [ ] **Étape 4 : repasser le banc en ultra**

```
http://127.0.0.1:5173/test/invariants.html?q=ultra
```

`heightAt` interpole la grille **bakée** : `low` (~4.6 u de pas) est le terrain
le plus lisse, donc le cas le plus FACILE. Attendu : `INVARIANTS: 11 pass,
0 fail` avec 800 lucioles.

- [ ] **Étape 5 : commit**

```sh
git add src/fireflies.js
git commit -m "feat(lucioles): placement par rejet sur le champ de densité des bassins"
```

---

## Tâche 5 : le mesh et le shader — dérive, flash, halo

**Fichiers :**
- Modifier : `src/fireflies.js` (ajout après `computeFireflySpots`)

**Interfaces :**
- Consomme : `computeFireflySpots` (tâche 4), `FIREFLIES` (tâche 2).
- Produit :

```js
createFireflies({ seed, quality, heightAt, ponds, isInPond })
  → { mesh, update(t, phase), dispose() }
// mesh   : THREE.Mesh sur InstancedBufferGeometry, ajouté à la scène par main.js
// update : t = secondes écoulées, phase = l'objet rendu par sky.update()

fireflyActivity(phase) → number dans [0, 1]
// Exportée à part parce que l'invariant 12 (tâche 6) l'importe et la teste
// directement. `phase` n'a besoin que de { night, twilight, solar }.
```

- [ ] **Étape 1 : ajouter la courbe d'activité, exportée**

Elle est **exportée** parce que l'invariant 12 (tâche 6) doit tester **cette**
formule et non une copie. Une courbe recopiée dans le banc dériverait en silence
le jour où on la retouche, et le test continuerait de passer sur l'ancienne.

```js
/**
 * Quelle part de la population brille, entre 0 et 1.
 *
 * Un PIC, pas un plateau : les vraies hotaru culminent dans les deux heures qui
 * suivent le coucher, puis retombent. `phase.solar` est cyclique — d'où la
 * distance circulaire, sans quoi minuit (solar 0) serait vu comme très loin du
 * pic (solar 0.82) alors qu'il n'en est qu'à 0.18.
 */
export function fireflyActivity(phase) {
  if (!phase) return 0;
  // Allumées la nuit et sur les deux crépuscules, comme les lanternes.
  const lit = Math.max(0, Math.min(1, (phase.night ?? 0) + (phase.twilight ?? 0) * 0.6));
  if (lit <= 0) return 0;
  let d = Math.abs((phase.solar ?? 0) - FIREFLIES.peakSolar);
  if (d > 0.5) d = 1 - d;
  const peak = Math.exp(-(d * d) / (FIREFLIES.peakWidth * FIREFLIES.peakWidth));
  return lit * (FIREFLIES.peakFloor + (1 - FIREFLIES.peakFloor) * peak);
}
```

- [ ] **Étape 2 : ajouter la construction du mesh**

À la suite du fichier.

```js
/**
 * Construit la population. Tout est fixé ici : le mesh n'est jamais reconstruit,
 * conformément à la doctrine « changement de qualité = reload ».
 */
export function createFireflies({ seed = 1, quality, heightAt, ponds, isInPond } = {}) {
  const count = quality?.fireflies ?? 0;
  const spots = computeFireflySpots({ ponds, heightAt, isInPond, count, seed });
  const n = spots.length;

  const geo = new THREE.InstancedBufferGeometry();
  {
    // Quad unité écrit à la main plutôt qu'emprunté à une PlaneGeometry : passer
    // les attributs d'une géométrie temporaire PUIS la disposer ferait supprimer
    // les buffers GPU partagés le jour où l'ordre de construction changerait.
    // Quatre sommets, deux triangles, aucune ambiguïté. position.xy court dans
    // [-0.5, 0.5] — le vertex shader en dépend.
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,   0.5, -0.5, 0,   0.5, 0.5, 0,   -0.5, 0.5, 0,
    ], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
  }

  const aPos   = new Float32Array(n * 3);  // position monde de l'individu
  const aSeed  = new Float32Array(n * 4);  // phase, driftRate, driftRadius, size
  const aFlash = new Float32Array(n * 2);  // décalage de phase du flash, posée 0/1

  // Phase de flash PAR BASSIN — le cœur du rendu. Décorrélées entre elles par un
  // décalage irrationnel plutôt qu'un tirage : trois bassins tirés au hasard
  // peuvent sortir presque en phase, ce qui ruine l'effet une fois sur dix.
  const pondPhase = ponds.map((_, i) => (i * 0.618034 * FIREFLIES.flashPeriod));

  const rng = streamFor(seed, 'fireflies.attrs');
  for (let i = 0; i < n; i++) {
    const s = spots[i];
    aPos[i * 3] = s.x; aPos[i * 3 + 1] = s.y; aPos[i * 3 + 2] = s.z;

    aSeed[i * 4]     = R.range(rng, 0, Math.PI * 2);                        // phase de dérive
    aSeed[i * 4 + 1] = R.range(rng, FIREFLIES.driftRate[0], FIREFLIES.driftRate[1]);
    aSeed[i * 4 + 2] = R.range(rng, FIREFLIES.driftRadius[0], FIREFLIES.driftRadius[1]);
    aSeed[i * 4 + 3] = R.range(rng, FIREFLIES.size[0], FIREFLIES.size[1]);

    aFlash[i * 2]     = pondPhase[s.pond] + R.range(rng, -FIREFLIES.flashJitter, FIREFLIES.flashJitter);
    aFlash[i * 2 + 1] = s.perched ? 1 : 0;
  }

  geo.setAttribute('aPos',   new THREE.InstancedBufferAttribute(aPos, 3));
  geo.setAttribute('aSeed',  new THREE.InstancedBufferAttribute(aSeed, 4));
  geo.setAttribute('aFlash', new THREE.InstancedBufferAttribute(aFlash, 2));
  geo.instanceCount = n;
```

- [ ] **Étape 3 : ajouter le matériau, uniformes et shaders**

À la suite, dans la même fonction. **Trois pièges sont désamorcés ici et il faut
lire les commentaires avant de simplifier quoi que ce soit.**

```js
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime:      { value: 0 },
      uActivity:  { value: 0 },   // 0 = éteintes ; le CPU ne pose que ça et uTime
      uPeriod:    { value: FIREFLIES.flashPeriod },
      uColor:     { value: new THREE.Color(FIREFLIES.color) },
      uOverdrive: { value: FIREFLIES.overdrive },
      uLift:      { value: FIREFLIES.driftLift },
      uRise:      { value: FIREFLIES.flashRise },
      uDecay:     { value: FIREFLIES.flashDecay },
    },
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,             // une lumière ne masque pas ce qui est derrière
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,        // billboard : la face vue dépend de la caméra

    vertexShader: /* glsl */ `
      attribute vec3  aPos;
      attribute vec4  aSeed;    // phase, driftRate, driftRadius, size
      attribute vec2  aFlash;   // décalage de phase, posee (0/1)

      uniform float uTime;
      uniform float uPeriod;
      uniform float uActivity;
      uniform float uLift;
      uniform float uRise;
      uniform float uDecay;

      varying float vGlow;
      varying vec2  vQuad;

      #include <fog_pars_vertex>

      void main() {
        float phase  = aSeed.x;
        float rate   = aSeed.y;
        float radius = aSeed.z;
        float size   = aSeed.w;

        // Les posees ne derivent pas : elles clignotent sur place dans l'herbe.
        float airborne = 1.0 - aFlash.y;

        vec3 p = aPos;
        p.x += airborne * radius * sin(uTime * rate + phase);
        p.z += airborne * radius * 0.82 * sin(uTime * rate * 0.71 + phase * 1.7);
        // Quasi horizontal : une hotaru traine, elle ne monte pas.
        p.y += airborne * radius * uLift * sin(uTime * rate * 0.53 + phase * 2.3);

        // Le flash. Montee rapide puis decroissance exponentielle, PAS un sinus :
        // un sinus donne une respiration douce, une luciole fait un eclair.
        float u = fract((uTime + aFlash.x) / uPeriod);
        float rise  = smoothstep(0.0, uRise, u);
        float decay = exp(-max(u - uRise, 0.0) * uDecay);
        vGlow = rise * decay * uActivity;

        // -1..1 pour la gaussienne du fragment (position.xy court dans -0.5..0.5)
        vQuad = position.xy * 2.0;

        // Le nom mvPosition est OBLIGATOIRE : fog_vertex le lit litteralement.
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        // Billboard : le decalage se fait en espace vue, donc le quad fait
        // toujours face a la camera sans qu'on ait a composer une rotation.
        mvPosition.xy += position.xy * size;
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3  uColor;
      uniform float uOverdrive;

      varying float vGlow;
      varying vec2  vQuad;

      #include <fog_pars_fragment>

      void main() {
        float r2 = dot(vQuad, vQuad);
        if (r2 > 1.0) discard;

        // exp(-k r^2) et non un smoothstep : le tier low n'a PAS de bloom
        // (QUALITY.low.bloom === false, donc pas de composer), et un bord franc
        // y lirait comme une pastille au lieu d'une lumiere. Le halo du bloom
        // vient par-dessus quand il existe, il ne le remplace pas.
        float core = exp(-r2 * 7.0);

        vec3 col = uColor * core * vGlow * uOverdrive;

        // Brouillard ADDITIF : on ATTENUE, on ne melange pas vers fogColor.
        // Le chunk fog_fragment standard fait mix(gl_FragColor.rgb, fogColor, f),
        // ce qui AJOUTERAIT du brouillard sur un materiau additif : une luciole
        // lointaine deviendrait un halo bleu plus brillant que de pres.
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float fogF = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          col *= 1.0 - clamp(fogF, 0.0, 1.0);
        #endif

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
```

- [ ] **Étape 4 : ajouter le mesh, l'`update` et le `dispose`**

```js
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'fireflies';
  mesh.renderOrder = 6;          // apres les lanternes (3) et les petales (5)
  mesh.visible = false;          // eteintes tant que la nuit n'est pas la
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  // SPHERE ENGLOBANTE OBLIGATOIRE, ET PAS UNE OPTIMISATION.
  // La geometrie ne contient qu'un quad unite a l'origine : le calcul
  // automatique de three ne voit QUE `position` et rendrait une sphere de rayon
  // 0.7 au centre du monde. Les positions reelles vivent dans `aPos`, que le
  // culling ignore — les lucioles disparaitraient des qu'on ne regarde pas
  // l'origine de la carte. On la pose donc a la main.
  //
  // Ce n'est pas frustumCulled = false comme petals.js : les petales couvrent
  // toute l'ile, les lucioles n'occupent que trois taches, et les culler quand
  // on regarde ailleurs est exact ET gratuit.
  {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += aPos[i * 3]; cy += aPos[i * 3 + 1]; cz += aPos[i * 3 + 2]; }
    cx /= Math.max(n, 1); cy /= Math.max(n, 1); cz /= Math.max(n, 1);
    let r = 0;
    for (let i = 0; i < n; i++) {
      r = Math.max(r, Math.hypot(aPos[i * 3] - cx, aPos[i * 3 + 1] - cy, aPos[i * 3 + 2] - cz));
    }
    // Marge = derive maximale + demi-quad : la sphere doit couvrir la position
    // ANIMEE, pas la position semee, sinon les bords disparaissent par a-coups.
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(cx, cy, cz),
      r + FIREFLIES.driftRadius[1] + FIREFLIES.size[1]
    );
  }

  /**
   * Deux uniformes par frame, rien d'autre. `phase` vient de sky.update().
   */
  function update(t, phase) {
    if (!phase) return;

    const activity = fireflyActivity(phase);

    mesh.visible = activity > 0.01;
    if (!mesh.visible) return;

    uniforms.uTime.value = t;
    uniforms.uActivity.value = activity;
  }

  function dispose() {
    geo.dispose();
    material.dispose();
  }

  return { mesh, update, dispose };
}
```

- [ ] **Étape 5 : vérifier la syntaxe**

```sh
node --check src/fireflies.js
```

Attendu : aucune sortie.

- [ ] **Étape 6 : relancer le banc**

`http://127.0.0.1:5173/test/invariants.html` doit toujours afficher
`INVARIANTS: 11 pass, 0 fail`. Ajouter `createFireflies` ne doit rien changer à
l'invariant 11 — s'il casse, c'est que `computeFireflySpots` a été touché.

- [ ] **Étape 7 : commit**

```sh
git add src/fireflies.js
git commit -m "feat(lucioles): mesh instancié, dérive GPU et flash synchronisé par bassin"
```

---

## Tâche 6 : câblage dans `main.js` et invariant 12

**Fichiers :**
- Modifier : `src/main.js` (imports ≈ l.18-24 ; boot après `await step('oiseaux')`
  ≈ l.409-416 ; boucle ≈ l.534)
- Modifier : `test/invariants.html` (invariant 12)

**Interfaces :**
- Consomme : `createFireflies` (tâche 5).
- Produit : `world.fireflies`, accessible depuis la console via `__sk.world`.

- [ ] **Étape 1 : écrire l'invariant 12 D'ABORD**

Dans `test/invariants.html`, juste après le bloc de l'invariant 11.

C'est la panne la plus probable de tout le chantier et la plus silencieuse : une
fenêtre inversée fait briller les lucioles en plein midi et personne ne s'en rend
compte avant de regarder. Le test est purement numérique, sans rendu.

Ajouter `fireflyActivity` à l'import de `fireflies.js` posé à la tâche 3 :

```js
import { computeFireflySpots, fireflyActivity } from '../src/fireflies.js';
```

Puis le bloc :

```js
/* ── 12. les lucioles dorment le jour ────────────────────────────────────── */
{
  // On appelle la VRAIE courbe, importée. Recopier la formule ici la ferait
  // dériver en silence le jour où on la retouche, et le test continuerait de
  // passer sur une version qui n'est plus celle qui tourne.
  const noon      = fireflyActivity({ night: 0, twilight: 0, solar: 0.5 });
  const midnight  = fireflyActivity({ night: 1, twilight: 0, solar: 0.0 });
  const afterDusk = fireflyActivity({ night: 1, twilight: 0, solar: FIREFLIES.peakSolar });

  check('les lucioles dorment le jour',
    noon === 0 && midnight > 0 && afterDusk > midnight,
    `midi ${noon.toFixed(3)} · minuit ${midnight.toFixed(3)} · apres-coucher ${afterDusk.toFixed(3)}`);
}
```

- [ ] **Étape 2 : lancer le banc**

Attendu : **`INVARIANTS: 12 pass, 0 fail`**. Cet invariant passe immédiatement —
il vérifie la courbe écrite à la tâche 5, qui existe déjà. C'est assumé : il est
là pour attraper une **régression future**, pas pour piloter cette tâche-ci. Le
test qui pilotait le placement, lui, a bien échoué avant (tâche 3, étape 4).

- [ ] **Étape 3 : ajouter l'import dans `main.js`**

Après la ligne `import { createBirds } from './birds.js';` (l.23) :

```js
import { createFireflies } from './fireflies.js';
```

- [ ] **Étape 4 : construire les lucioles dans le boot**

Juste après le bloc `await step('oiseaux')` et son `scene.add(world.birds.group)`
(≈ l.416), donc **bien après le `world.ponds.attach(...)` de la l.311** — c'est
cet ordre qui garantit des rayons de bassin mesurés et non nominaux.

```js
  await step('lucioles');
  // APRES ponds.attach() (l.311) : PONDS ne porte les rayons et le plan d'eau
  // REELLEMENT creuses qu'une fois attach passe. Construire avant donnerait un
  // habitat calcule sur des rayons nominaux que rien d'autre n'utilise.
  //
  // PIEGE, paye pendant T5 : passer `q`, l'OBJET de qualite, et surtout PAS
  // `world.quality` — qui est la CHAINE 'low'/'high'/'ultra'. Avec la chaine,
  // `quality?.fireflies` vaut undefined, le `?? 0` de createFireflies donne un
  // compte de zero, et on obtient une population VIDE sans la moindre erreur.
  // C'est exactement la casse silencieuse contre laquelle AGENTS.md met en garde.
  world.fireflies = createFireflies({
    seed: SEED, quality: q,
    heightAt: world.heightAt,
    ponds: world.ponds.PONDS,
    isInPond: world.inWater,
  });
  scene.add(world.fireflies.mesh);
```

- [ ] **Étape 5 : brancher l'update dans la boucle**

Juste après `world.details.update(t, phase);` (≈ l.535) :

```js
  // `phase` brut et non `shaderPhase` : le materiau est additif et non eclaire,
  // il n'a aucun usage de keyIntensity normalise.
  world.fireflies.update(t, phase);
```

- [ ] **Étape 6 : vérifier la syntaxe**

```sh
node --check src/main.js
```

- [ ] **Étape 7 : voir les lucioles**

Ouvrir `http://127.0.0.1:5173/index.html?q=ultra`, puis en console :

```js
__sk.world.paused = true;
__sk.world.dayTime = 0.82;                 // juste apres le coucher : le pic
__sk.setCamMode('orbit');
__sk.controls.autoRotate = false;
// Se placer au bord du grand bassin (ponds.PONDS[0] est le plus large).
const p = __sk.world.ponds.PONDS[0];
__sk.camera.position.set(p.x + 26, p.waterY + 5, p.z + 26);
__sk.controls.target.set(p.x, p.waterY + 1, p.z);
__sk.controls.update();
console.log('lucioles visibles :', __sk.world.fireflies.mesh.visible);
```

Attendu, dans l'ordre où il faut vérifier :
1. `mesh.visible === true`.
2. Des points jaune-vert au-dessus de l'eau et dans l'herbe des berges.
3. **Ils clignotent ensemble sur un même bassin** — c'est le point à vérifier
   en premier, c'est tout le chantier.
4. Le flash est un éclair, pas une respiration : montée sèche, extinction.
5. Halo doux autour du cœur (bloom actif en ultra).

Si le mesh est invisible alors que `visible === true` : piège 1, forcer
`__sk.world.fireflies.mesh.material.side = THREE.DoubleSide` — c'est déjà le cas
dans le code, donc chercher plutôt du côté de `uActivity` (l'afficher) et de la
sphère englobante (mettre `mesh.frustumCulled = false` à chaud pour trancher).

- [ ] **Étape 8 : vérifier l'absence de jour**

```js
__sk.world.dayTime = 0.5;
__sk.frame();
console.log('a midi, visible =', __sk.world.fireflies.mesh.visible);  // attendu : false
```

- [ ] **Étape 9 : vérifier les trois tiers**

Recharger avec `?q=low`, puis `?q=high`, puis `?q=ultra`. Sur `low` il n'y a pas
de bloom : les lucioles doivent rester des **lumières douces**, pas des pastilles
à bord franc. C'est le cas qui valide le choix de `exp(-k·r²)`.

- [ ] **Étape 10 : commit**

```sh
git add src/main.js test/invariants.html
git commit -m "feat(lucioles): câblage main.js et invariant 12 (relais jour/nuit)"
```

---

## Tâche 7 : mesure d'impact, réglage à l'œil et journal

**Fichiers :**
- Modifier : `REPRISE.md`
- Possiblement : `src/config.js` (réglage de `overdrive` / `flashPeriod` / comptes)

**Interfaces :**
- Consomme : les chiffres de référence de la tâche 1.
- Produit : le chantier soldé.

- [ ] **Étape 1 : refaire le banc fps, protocole identique**

Reprendre **exactement** les étapes 2 à 5 de la tâche 1, mêmes positions de
caméra, même `dayTime = 0.97`, même vérification de dérive nulle. Un protocole
différent rend la comparaison sans valeur.

- [ ] **Étape 2 : comparer**

Attendu : écart sous le bruit de mesure (±0.3 fps avec ce protocole). Le poste
dominant reste le feuillage — 88 % du temps de frame en vue large. Un draw call
de plus avec ≤ 800 quads minuscules ne devrait rien coûter.

**Si la perte dépasse 1 fps : ne pas hausser les épaules.** Vérifier d'abord que
la sphère englobante fait son travail (`mesh.visible` doit passer à `false` quand
on regarde à l'opposé des étangs), puis le surdessin (800 quads additifs qui se
recouvrent tous à l'écran, ça se voit en s'approchant très près).

- [ ] **Étape 3 : trancher `overdrive` en A/B contre les émetteurs existants**

Le 1.6 de la tâche 2 est un point de départ raisonné, pas une mesure. Deux
étalons existent déjà dans la scène, et ils encadrent la réponse :

| Émetteur | Surtension | Taille |
| --- | --- | --- |
| Fire box de lanterne (`details.js`, `LANTERN_LIGHT`) | **2.6** | sphère r 0.185 |
| Flamme de bougie du hokora (`CANDLE_LIGHT`, commit `71b5cfb`) | **1.55** | r 0.019 étirée ×2 |

La bougie est l'analogue le plus proche — petit émetteur, même seuil de bloom
nocturne — et la session qui l'a réglée a tiré la même conclusion par un autre
chemin : « le halo doit venir du bloom, pas de l'émetteur », après un premier
essai trop gros qui donnait « des flammes de la taille des coupes à saké ».
**Une luciole doit sortir entre 1.5 et 1.8, pas près de 2.6.**

Se placer de nuit dans un plan qui contient **à la fois** une lanterne allumée et
des lucioles, puis :

```js
const u = __sk.world.fireflies.mesh.material.uniforms;
u.uOverdrive.value = 1.2;   // regarder
u.uOverdrive.value = 1.6;   // regarder
u.uOverdrive.value = 2.2;   // regarder
```

Critère : la luciole doit être **plus petite et plus vive** que la lanterne, sans
noyer son propre cœur dans le halo. Reporter la valeur retenue dans
`FIREFLIES.overdrive` (`config.js`).

Rappel de méthode payé par le chantier LOD (cf. `REPRISE.md`) : **régler ce qui
change la granularité AVANT de juger l'intensité.** Ici, si le compte de lucioles
doit bouger, le faire d'abord — l'`overdrive` se juge à densité définitive.

- [ ] **Étape 4 : comparer à la référence réelle**

Convention du projet : tout chantier visuel se compare à un étalon externe.
Ouvrir des photographies longue pose de hotaru japonaises et vérifier trois
choses : la **couleur** (jaune-vert, pas blanc ni cyan), la **densité** (des
grappes autour de l'eau, pas une voie lactée uniforme), et la **hauteur de vol**
(bas, dans et juste au-dessus de la végétation).

- [ ] **Étape 5 : vérifier que les 10 invariants d'origine tiennent toujours**

```
http://127.0.0.1:5173/test/invariants.html?q=ultra
```

Attendu : `INVARIANTS: 12 pass, 0 fail`. Les 10 anciens comptent : la tâche 3 a
ajouté un `ponds.attach()` au banc, ce qui change ce que voient les invariants
4 et 5. **Si l'un d'eux a bougé, c'est un vrai résultat à comprendre, pas un
détail de banc.**

- [ ] **Étape 6 : relire le diff complet**

```sh
git diff main...HEAD --stat
git diff main...HEAD
```

Vérifier en particulier : **`src/details.js` n'apparaît pas** (l'autre session y
travaille), et aucun fichier n'a été touché hors de la liste de la section
« Structure des fichiers ».

- [ ] **Étape 7 : consigner la session dans `REPRISE.md`**

Convention du projet : chaque session y est consignée. Ajouter une section
`## Chantier L — lucioles (01/08/2026)` contenant :
- ce qui a été construit, en une phrase ;
- **les chiffres fps avant/après**, avec le protocole utilisé ;
- la valeur d'`overdrive` retenue et **pourquoi** (le seuil de bloom nocturne à
  0.42, pas 0.85 — l'erreur que ce chantier a failli commettre) ;
- ce qui reste : le chantier P (papillons), en attente du commit de `details.js`.

- [ ] **Étape 8 : commit final**

```sh
git add REPRISE.md src/config.js
git commit -m "docs(lucioles): journal de session, réglages tranchés à l'œil"
```

---

## Après ce plan

**Revue adversariale.** `AGENTS.md` impose une revue Codex après chaque passe
substantielle, via le skill `codex:adversarial-review` du plugin Claude Code
(**pas** en appelant le CLI `codex` à la main). Le rapport va dans
`ADVERSARIAL_REVIEW_CLAUDE.md` avec un id `ADV-…` versionné.

**Chantier P (papillons). Débloqué** — la session parallèle a commité
`src/details.js` (`71b5cfb`), l'arbre est propre. Il peut donc s'enchaîner
directement, y compris l'export des positions de fleurs. Le spec le décrit
intégralement : `docs/superpowers/specs/2026-08-01-lucioles-papillons-design.md`.

**Ce que le hokora change pour la nuit.** Le sanctuaire de la falaise porte
désormais deux bougies allumées du crépuscule à l'aube. C'est un troisième foyer
lumineux nocturne après les lanternes et les lucioles — sans conséquence pour ce
chantier (les étangs sont à l'opposé de la falaise ouest), mais à garder en tête
au moment de juger si la nuit est « assez vivante » : elle l'est déjà un peu plus
qu'au moment où ce plan a été écrit.

## Auto-revue de ce plan

**Couverture du spec** — chaque section du spec pointe vers une tâche : habitat
et dégradé → T4 ; vol GPU et fraction posée → T4/T5 ; synchronie par bassin,
période 2 s, forme d'éclair → T5 ; rendu additif, surpilotage, cas `low` sans
bloom → T5/T7 ; courbe d'activité piquée → T5 ; budget absolu et sa
justification → T2 ; invariants 11 et 12 → T3/T6 ; banc fps sous le piège 9 →
T1/T7 ; étalon visuel externe → T7. Le relais crépusculaire est couvert côté
lucioles (T5) ; son versant papillons appartient au chantier P.

**Cohérence des noms** — `computeFireflySpots`, `createFireflies` et
`fireflyActivity` sont écrits à l'identique en T3, T4, T5 et T6. Les champs
`{x, y, z, pond, perched}` sont définis en T3 et consommés tels quels en T4 et
T5. Les clés de `FIREFLIES` utilisées dans les shaders et la courbe
(`flashPeriod`, `flashRise`, `flashDecay`, `driftLift`, `overdrive`, `peakSolar`,
`peakWidth`, `peakFloor`) sont toutes déclarées en T2.

**Trois défauts corrigés à cette relecture**, notés parce qu'ils se
reproduiraient sinon :
1. La courbe d'activité était recopiée dans le banc — elle est maintenant
   **exportée et importée**, donc le test porte sur le code qui tourne.
2. Le quad empruntait ses attributs à une `PlaneGeometry` aussitôt disposée :
   partage de buffers GPU pour rien. Il est écrit à la main.
3. La sphère englobante était présentée comme une optimisation. C'est une
   **obligation** : `position` ne contient qu'un quad à l'origine, le calcul
   automatique culerait toute la population dès qu'on regarde ailleurs.

**Point non couvert, assumé** — le `size` du quad est en unités monde, donc une
luciole très lointaine devient sous-pixel et disparaît. C'est correct et voulu ;
si le rendu à distance déçoit, le levier est un plancher de taille en espace
écran, et ce serait un ajout ultérieur, pas une correction.
