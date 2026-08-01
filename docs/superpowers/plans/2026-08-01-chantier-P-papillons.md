# Chantier P — papillons diurnes : plan d'implémentation

> Suite du chantier L (lucioles), livré et commité. Même flux : un brief Codex
> par tâche, `git diff` relu, `node --check`, banc d'invariants, vérification
> navigateur, puis commit.

**But :** peupler le jour de papillons qui butinent les dérives de fleurs
sauvages et s'envolent quand le shiba leur court dessus — le versant diurne de la
faune, dont les lucioles sont le versant nocturne.

**Architecture :** `src/butterflies.js`, un `InstancedMesh` unique. Contrairement
aux lucioles (dérive GPU pure, zéro JS), les papillons ont une **machine à états
sur le CPU** : ils visent des fleurs, s'y posent, et fuient. N ≤ 136, donc le
coût JS est dérisoire. Seul le **battement d'ailes** est sur le GPU.

**Stack :** Three.js 0.185.1 via importmap, aucun build, aucun npm.

## Contraintes globales

- **`python3 serve.py 5173`**, jamais `python -m http.server`.
- Aucune dépendance nouvelle.
- **Piège 1 (winding)** : `DoubleSide` obligatoire, une aile se voit des deux côtés.
- **Piège 3 (GLSL)** : pas de backticks ni d'accents dans les commentaires de
  shader ; `fog_vertex` exige une variable nommée littéralement `mvPosition`.
- **Piège 8** : sous pilotage navigateur l'onglet n'a pas le focus, **rAF ne
  tourne pas**. Toute vérification passe par `__sk.frame()` explicite.
- **`world.quality` est la CHAÎNE du tier**, pas l'objet. `main.js` doit passer
  `q`. Payé au chantier L : avec la chaîne on obtient une population vide et
  aucune erreur.
- Après chaque tâche : `node --check`, banc, commit. Aucun commit par Codex.

## Faits vérifiés dans le code

- Les fleurs (`details.js`, bloc « 1. wildflowers », ~l.1282-1358) sont semées en
  **dérives** par espèce (masque `fbm2`), hors chemin (`isOnPath(x,z,0.4)`), hors
  eau, entre `beachTop+0.5` et `grassTop−1.5`, pente ≤ 0.34. Elles sont posées à
  `y = heightAt − 0.02`. **Leurs positions ne sont écrites que dans des matrices
  d'instance** — d'où l'export à créer.
- Budget fleurs : `2500 × budget × AREA` avec `budget` = 1.0 / 0.62 / 0.3 selon le
  tier (`details.js:1276`) et `AREA ≈ 10.08` → **≈ 25 200 / 15 600 / 7 560**.
- Précédent d'export : `export let lanternSpots = []` (`details.js:321`), rempli
  par `createDetails`.
- Répulseur : `world.birds.setRepeller?.(world.shiba.position)` (`main.js:607`),
  après `world.shiba.update`. `birds.js` utilise `REP_R = 26`.
- `phase.day` existe déjà (`sky.js`), aux côtés de `night` et `twilight`.
- Le banc compte **17 invariants** après le chantier L.

## Structure des fichiers

| Fichier | Action |
| --- | --- |
| `src/butterflies.js` | **créer** — placement, machine à états, mesh, shader |
| `src/details.js` | exporter `flowerSpots` (quelques lignes) |
| `src/config.js` | budget par tier + bloc `BUTTERFLIES` |
| `src/main.js` | 1 import, 1 construction, 1 `update`, 1 `setRepeller` |
| `test/invariants.html` | 2 invariants (18 et 19) |
| `REPRISE.md` | journal |

---

## Tâche P1 — exporter les positions de fleurs

**Fichier :** `src/details.js` uniquement.

`flowerSpots` est un **`Float32Array` de triplets (x, y, z)**, et non un tableau
d'objets comme `lanternSpots` : à 25 200 fleurs en ultra, 25 200 objets coûteraient
cher pour rien, là où le tableau typé fait 300 ko et se lit par index.

- [ ] **Étape 1 : déclarer l'export**, à côté de `lanternSpots` (`details.js:321`) :

```js
/**
 * Positions des fleurs sauvages réellement posées (triplets x, y, z).
 *
 * Tableau TYPÉ et non tableau d'objets comme `lanternSpots` : il y a 38 lanternes
 * et jusqu'à 25 200 fleurs. Rempli par createDetails ; lu par butterflies.js pour
 * savoir où butiner. Re-dériver ces positions ailleurs avec le même flux seedé
 * marcherait aujourd'hui et casserait en silence le jour où les dérives bougent.
 */
export let flowerSpots = new Float32Array(0);
```

- [ ] **Étape 2 : collecter pendant le semis.** Dans le bloc wildflowers, avant la
  boucle sur `FLOWER_BASE`, déclarer `const spotAcc = [];`. Dans la boucle de
  placement, juste après `mesh.setMatrixAt(placed++, _m);`, ajouter
  `spotAcc.push(x, h, z);`. Après la boucle sur les espèces, poser
  `flowerSpots = new Float32Array(spotAcc);`.

- [ ] **Étape 3 :** `node --check src/details.js`, puis banc → toujours
  `INVARIANTS: 17 pass, 0 fail`. Commit.

---

## Tâche P2 — budget et constantes

**Fichier :** `src/config.js` uniquement.

- [ ] **Étape 1 :** ajouter dans les trois presets de `QUALITY`, après `fireflies` :
  `butterflies: Math.round(5 * AREA_SOFT)` (low), `Math.round(12 * AREA_SOFT)`
  (high), `Math.round(24 * AREA_SOFT)` (ultra) → ≈ 28 / 68 / 136.

  Contrairement aux lucioles, **ceux-là suivent `AREA_SOFT`** : ils couvrent une
  surface (la prairie), qui grandit avec l'île.

- [ ] **Étape 2 :** ajouter le bloc `BUTTERFLIES` en fin de fichier :

```js
/**
 * Papillons — le versant diurne de la faune, dont les lucioles sont le nocturne.
 *
 * Deux espèces, parce qu'une seule lit comme un clone dupliqué. Au printemps la
 * petite blanche (Pieris rapae) et le machaon asiatique (Papilio xuthus) ; à
 * l'automne la blanche cède la place au tateha roux (Vanessa indica), qui
 * HIVERNE À L'ÉTAT ADULTE — c'est précisément pourquoi on la voit encore voler
 * en novembre quand les autres espèces sont à l'état d'oeuf ou de chrysalide.
 *
 * Le vol est la signature : les Pieris de printemps volent LENTEMENT et à FORTE
 * COURBURE de trajectoire. Ce n'est pas l'arc lisse d'un boid — c'est un zigzag.
 */
export const BUTTERFLIES = Object.freeze({
  bigFraction: 0.30,      // part de machaons : les grands sont plus rares

  // — petite espèce (blanche au printemps, tateha roux à l'automne) —
  small: {
    span: 0.34,           // envergure, unités monde
    speed: [1.4, 2.4],
    cruiseY: [0.3, 1.5],  // au-dessus du sol : elle butine bas
    flapRate: [9.0, 13.0],// battements/s — rapide et irrégulier
    veerChance: 0.16,     // probabilité d'embardée sèche par seconde
    veerAmount: 1.5,      // radians
    bob: 0.16,            // tangage vertical calé sur le battement
  },
  // — machaon : plus grand, plus rapide, plus haut, il PLANE —
  big: {
    span: 0.72,
    speed: [2.2, 3.4],
    cruiseY: [1.6, 4.0],
    flapRate: [4.5, 7.0],
    veerChance: 0.06,
    veerAmount: 0.9,
    bob: 0.10,
    glideChance: 0.35,    // fraction du temps ailes tendues, sans battre
  },

  turnRate: 2.6,          // rad/s max — au-delà le vol lit comme un missile

  // — butinage —
  perchChance: 0.5,       // probabilité de viser une fleur en fin d'errance
  perchSeconds: [1.5, 5.0],
  approachRadius: 14,     // rayon de recherche d'une fleur cible
  arriveDist: 0.35,

  // — fuite —
  // 4 u, pas les 26 u des oiseaux : on approche un papillon de TRÈS près avant
  // qu'il ne parte, et un papillon qui décolle à 26 u lit comme un oiseau.
  fleeRadius: 4.0,
  fleeSeconds: [2.0, 4.0],
  fleeSpeed: 5.0,

  // — domaine —
  // Rappel SOUPLE vers le barycentre du champ de fleurs. Sans lui, un cap en
  // marche aléatoire finit par emmener toute la population en mer, lentement et
  // sans que rien ne l'arrête. Un mur ferait rebondir, ce qui se dénonce.
  homeRadius: 150,
  homePull: 1.8,

  // — jour —
  // Miroir de fireflyActivity : allumés en plein jour, éteints la nuit, la
  // transition suivant le même `phase` que les lucioles.
  duskFade: 0.35,         // part du crépuscule où ils volent encore
});
```

- [ ] **Étape 3 :** `node --check`, chargement OK, commit.

---

## Tâche P3 — invariants 18 et 19, écrits AVANT le code

**Fichier :** `test/invariants.html` uniquement. Le banc doit **échouer** ensuite.

Contrat que P4 devra satisfaire :

```js
computeButterflySpawns({ flowerSpots, heightAt, count, seed })
  → Array<{ x, y, z, big, flowerIndex }>
butterflyActivity(phase) → number dans [0, 1]
```

- [ ] **Étape 1 :** importer `flowerSpots` de `details.js`, et
  `computeButterflySpawns, butterflyActivity` de `../src/butterflies.js`, plus
  `BUTTERFLIES` de config.

- [ ] **Étape 2 :** ajouter, avant `const summary` :

```js
/* ── papillons : semés au-dessus du sol, dans leur domaine ──────────────── */
{
  const spawns = computeButterflySpawns({
    flowerSpots, heightAt: island.heightAt,
    count: QUALITY[TIER].butterflies, seed: SEED,
  });
  let ok = spawns.length > 0;
  let detail = spawns.length ? '' : 'aucun papillon produit';
  let worstClear = Infinity, worstAt = '';
  // Barycentre du champ de fleurs — le centre du domaine de vol.
  let cx = 0, cz = 0, nf = flowerSpots.length / 3;
  for (let i = 0; i < nf; i++) { cx += flowerSpots[i*3]; cz += flowerSpots[i*3+2]; }
  cx /= Math.max(nf,1); cz /= Math.max(nf,1);
  for (const s of spawns) {
    const clear = s.y - island.heightAt(s.x, s.z);
    if (clear < worstClear) { worstClear = clear; worstAt = `(${s.x.toFixed(0)},${s.z.toFixed(0)})`; }
    if (!(clear > 0.05)) { ok = false; detail = `papillon sous le sol : garde ${clear.toFixed(2)} ${worstAt}`; break; }
    if (Math.hypot(s.x - cx, s.z - cz) > BUTTERFLIES.homeRadius * 1.5) {
      ok = false; detail = `papillon hors domaine à (${s.x.toFixed(0)},${s.z.toFixed(0)})`; break;
    }
  }
  check('papillons au-dessus du sol et dans leur domaine', ok,
    ok ? `${spawns.length} papillons, ${nf} fleurs, garde min ${worstClear.toFixed(2)} ${worstAt}` : detail);
}

/* ── papillons : ils dorment la nuit ────────────────────────────────────── */
{
  // La VRAIE courbe, importée — pas une copie qui dériverait en silence.
  const noon  = butterflyActivity({ day: 1, night: 0, twilight: 0 });
  const night = butterflyActivity({ day: 0, night: 1, twilight: 0 });
  const dusk  = butterflyActivity({ day: 0, night: 0, twilight: 1 });
  check('les papillons dorment la nuit',
    night === 0 && noon > 0 && dusk > 0 && dusk < noon,
    `midi ${noon.toFixed(3)} · nuit ${night.toFixed(3)} · crepuscule ${dusk.toFixed(3)}`);
}
```

- [ ] **Étape 3 :** lancer le banc → **doit échouer** (module `butterflies.js`
  introuvable, HTTP 404, journal vide). Commit du test seul.

---

## Tâche P4 — `butterflies.js` : placement, courbe, machine à états, mesh

**Fichier :** `src/butterflies.js` (créer).

Contenu, dans l'ordre :

1. **`computeButterflySpawns`** — tire `count` fleurs au hasard dans
   `flowerSpots`, place le papillon au-dessus (`cruiseY` de son espèce), tire
   `big` selon `bigFraction`. Rend `{x, y, z, big, flowerIndex}`.
2. **`butterflyActivity(phase)`** — `clamp(day + twilight × duskFade)`. Miroir
   exact de `fireflyActivity`.
3. **`createButterflies({ seed, quality, season, heightAt, flowerSpots, wind })`**
   → `{ mesh, update(t, dt, shaderPhase), setRepeller(pos), dispose() }`.

**Géométrie** : deux quads, une aile de chaque côté, corps implicite. 8 sommets.
`position.x` porte le signe de l'aile — le shader s'en sert pour le battement.

**Battement sur le GPU, phase intégrée sur le CPU.** Attribut d'instance `aFlap`
(float), réécrit chaque frame. **Pas `sin(uTime × freq)`** : c'est le point 2 de
l'en-tête de `birds.js`, déjà payé — dès que la fréquence varie (planer, fuir, se
poser), un sinus à fréquence variable **saute** à l'instant du changement.

Rotation des ailes autour de l'axe du corps, dans le vertex shader :

```glsl
float a = sin(aFlap) * amp;
float s = sign(position.x);          // aile gauche / droite
float ca = cos(s * a), sa = sin(s * a);
vec3 p = vec3(position.x * ca - position.y * sa,
              position.x * sa + position.y * ca,
              position.z);
```

Les deux ailes montent ensemble — c'est ce que fait un papillon, pas un oiseau.

**Silhouette en alpha analytique** dans le fragment, comme `sakuraAlpha` de
`petals.js` : aile antérieure arrondie, lobe postérieur, et une queue pour le
machaon (commutée par `aSpecies`).

**Machine à états** (CPU, par individu) :

```
WANDER ──(fleur proche & tirage)──▶ APPROACH ──(arriveDist)──▶ PERCHED
   ▲                                                              │
   └──────────────────(perchSeconds écoulées)─────────────────────┘
   ▲
   └── FLEE ◀──(shiba à moins de fleeRadius)── n'importe quel état
```

- WANDER : cap en marche aléatoire + **embardées sèches** (`veerChance` /
  `veerAmount`, le mécanisme de `WIND` réemployé), **tangage vertical calé sur le
  battement** (`bob`), rappel souple vers le barycentre au-delà de `homeRadius`.
- PERCHED : posé sur la fleur, ailes qui s'ouvrent et se ferment **très
  lentement** — pas immobiles.
- FLEE : impulsion vers le haut et à l'opposé du shiba, `fleeSeconds`.
- Crépuscule : ils cherchent un perchoir et s'effacent posés. Version bon marché
  du roost de `birds.js`, mais ça lit vrai.

**Matériau** : `ShaderMaterial`, `side: DoubleSide`, `transparent`, éclairage
enroulé (`wrap`) depuis `keyDir`/`keyColor` comme `petals.js`, brouillard standard
(mélange, PAS l'atténuation additive des lucioles — ici le matériau est éclairé).

**Sphère englobante** : `mesh.frustumCulled = false`. Contrairement aux lucioles,
les papillons couvrent toute la prairie et leurs matrices d'instance bougent
chaque frame — recalculer une sphère à chaque frame coûterait plus que le culling
ne rapporte.

- [ ] `node --check`, banc → **`INVARIANTS: 19 pass, 0 fail`** en `?q=low` ET
  `?q=ultra`. Commit.

---

## Tâche P5 — câblage, mesure, réglage, journal

- [ ] **main.js** : import ; construction après les lucioles avec
  `quality: q, flowerSpots, heightAt: world.heightAt, wind: world.wind, season` ;
  `world.butterflies.update(t, dt, shaderPhase)` dans la boucle — **`shaderPhase`
  et non `phase`** : le matériau est éclairé, et `keyIntensity` brut (~4.3 à midi)
  le brûlerait en blanc ; puis
  `world.butterflies.setRepeller?.(world.shiba.position)` juste après celui des
  oiseaux (`main.js:607`).
- [ ] **Banc fps de jour**, protocole du piège 9 des deux côtés. Référence à
  relever AVANT le câblage. Étalon connu : printemps ultra, ouverture 33.7 / sol 24.6.
- [ ] **Visuel** : à midi, des papillons visitent les dérives ; le vol **zigzague**
  au lieu de planer en arcs ; on distingue les deux espèces à la taille et à
  l'allure ; courir le shiba dedans les fait décoller. À minuit : aucun.
- [ ] **Étalon externe** : comparaison à des photos de *Pieris rapae* et de
  *Papilio xuthus* — taille relative, contraste des ailes, allure du vol.
- [ ] **`REPRISE.md`** : journal, chiffres avant/après, réglages tranchés.

## Ce qui n'est pas fait (YAGNI)

Pas de vol en formation, pas de collision avec les arbres ou les lanternes, pas de
cycle de vie, pas de ponte, pas d'ombre portée (des ailes de 3 cm ne projettent
rien de lisible), pas de son.
