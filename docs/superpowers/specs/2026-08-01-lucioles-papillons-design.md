# Faune d'insectes — lucioles la nuit, papillons le jour

Design validé le 01/08/2026. Deux modules nouveaux, `src/fireflies.js` et
`src/butterflies.js`, qui se relaient sur le cycle jour/nuit.

## Le problème

La nuit de Sakurajima est belle mais **inhabitée**. La courbe nocturne de
`sky.js` est déjà une nuit cinéma volontairement claire (clé lunaire à ~23 % du
soleil de midi, la terre doit rester lisible) — le manque n'est donc pas de la
lumière, c'est du **mouvement**. Rien ne bouge entre le coucher et le lever
sinon l'herbe dans le vent : les oiseaux se sont perchés, les koi sont sous
l'eau, le shiba dort si on ne le pousse pas.

Le jour a le problème symétrique mais plus discret : la prairie est constellée de
dérives de fleurs sauvages que rien ne visite.

**But retenu : de la VIE, pas de la luminosité.** Aucun réglage de la courbe
nocturne de `sky.js` n'entre dans ce chantier. Si la nuit paraît encore trop
sombre après coup, c'est un autre chantier, sur la clé lunaire et l'exposition.

## Décisions de cadrage (validées avec l'utilisateur)

| Question | Choix |
| --- | --- |
| But | De la vie. Pas de retouche d'exposition. |
| Habitat des lucioles | Étangs **+ lisière, en dégradé** — dense sur l'eau, se raréfiant dans l'herbe et sous les arbres alentour. |
| Saisons | **Les deux**, même population. |
| Papillons | **Vraies bêtes** : ils se posent sur les fleurs et fuient le shiba. |
| Synchronie des flashes | **Par bassin** (tranché par Claude, validé). |
| Espèces de papillons | **Deux** (tranché par Claude, validé). |

### Note d'exactitude, assumée

Les hotaru volent en **juin**. Le sakura est d'avril, le momiji de novembre :
aucune des deux saisons de l'île n'est « la bonne ». L'île est un poème compressé
du Japon, pas un calendrier — la licence est prise en connaissance de cause, pas
par ignorance.

## Références externes (étalon avant/après)

Convention du projet : tout chantier visuel se compare à une référence réelle
avant ET après.

- **Genji-botaru (`Luciola cruciata`)** — clignotement **synchronisé** entre
  mâles en vol, période régionale : **2 s à l'ouest du Japon, 4 s à l'est**
  (frontière ≈ ligne tectonique Itoigawa-Shizuoka). Lumière jaune-vert (~560 nm).
  Pic d'activité dans les deux premières heures après le crépuscule.
- **`Pieris rapae`** (petite blanche) — au printemps : vol **lent, à forte
  courbure de trajectoire**, exploratoire et erratique.
- **`Papilio xuthus`** (machaon asiatique) — 7 à 9 cm d'envergure, jaune et noir,
  **voilier puissant**, commun dans tout le Japon y compris en ville.
- **`Vanessa indica`** — アカタテハ *akatateha*, le « tateha roux ». Elle
  **hiverne à l'état adulte** (越冬態 成虫), ce qui est exactement la raison
  pour laquelle on la voit encore voler en fin d'automne quand les autres
  espèces sont déjà à l'état d'œuf ou de chrysalide. Le choix d'automne n'est
  donc pas décoratif : c'est le papillon qui reste.

Sources : biologyinsights.com (bioluminescence du hotaru), earthexhibit.com
(genji), PMC11255373 (vol des *Pieris* par forme saisonnière), bugsofjapan
(*P. xuthus*), imokatsu.com + Wikipedia (*V. indica*, hivernage adulte).

## Architecture

Deux fichiers, pas un. Les deux bêtes ne partagent qu'une ligne — lire `phase` —
et divergent sur tout le reste :

| | Lucioles | Papillons |
| --- | --- | --- |
| Champ d'habitat | 3 bassins à koi | dérives de fleurs sauvages |
| Moteur | dérive **GPU pure**, zéro JS/frame | machine à états **CPU**, N petit |
| Interaction | aucune | poses + fuite devant le shiba |
| Matériau | additif non éclairé | éclairé (clé + ambiante) |
| Mise à l'échelle | absolue | `AREA_SOFT` |

Deux chantiers séparables : si l'un dérape, l'autre atterrit quand même.
Convention du projet respectée — un système, un fichier.

### `phase.emissive` existait déjà

`sky.js:1029` commente `emissive` par « petals / lanterns / **fireflies** glow
amount ». Le crochet était posé. Les lucioles s'y accrochent au lieu de
recalculer une courbe nocturne.

---

## Module 1 — `src/fireflies.js`

### Signature

```js
createFireflies({ seed, quality, season, heightAt, ponds })
  → { mesh, update(t, phase), dispose() }
```

`ponds` = `world.ponds.PONDS` (déjà exporté, déjà passé à `createBirds` — même
câblage). `heightAt` = `world.heightAt`.

### Habitat — le dégradé

Champ de densité, maximum sur les bassins et décroissant vers l'extérieur :

```
d(x, z) = max sur les 3 bassins de exp( −(r_i / R_i)² )
R_i = 2.4 × rayon du bassin i
```

Placement par **rejet** sur ce champ, refusé au-delà d'un seuil bas (≈ 0.06) pour
ne pas semer d'individus isolés à l'autre bout de l'île. Résultat : saturé
au-dessus de l'eau, se raréfiant dans l'herbe et sous les cerisiers alentour,
absent du reste. Aucune exclusion de chemin ni de pente : une luciole vole.

Altitude : **0.4 à 2.2 u** au-dessus de la surface locale — `heightAt` sur terre,
plan d'eau du bassin au-dessus de l'eau (`isInPond` tranche).

### Vol — tout sur le GPU

Comme `petals.js` : le CPU pose une uniforme de temps par frame et ne touche à
rien d'autre. Dérive lente en somme de sinus décorrélés par instance
(phase, fréquence et amplitude propres), **quasi horizontale** — une hotaru
ne monte pas, elle traîne. Aucune réponse au vent : elles volent par temps calme
et une luciole emportée par une rafale lirait faux.

**25 % de la population est POSÉE** dans l'herbe, immobile, et clignote sur
place. C'est la réciprocité que `petals.js` a déjà payée pour le vent (fraction
posée qui se soulève aux rafales) : une population entièrement en vol lit comme
un système de particules.

### Clignotement — le cœur du rendu

Trois propriétés, dans l'ordre d'importance :

1. **Synchronie par bassin.** Chaque étang porte sa phase de base ; chaque
   individu s'en écarte d'une gigue de ±0.25 s ; les trois étangs sont
   déphasés entre eux. Chaque bassin respire ensemble, l'île ne pulse pas d'un
   bloc. Tout synchroniser est artificiel, tout randomiser est du bruit — le
   vrai comportement est entre les deux, et c'est aussi le plus beau.
2. **Période 2 s** — le rythme de l'ouest du Japon, plus vivant que les 4 s de
   l'est.
3. **Une forme d'éclair, pas un sinus.** Montée en ~80 ms, décroissance
   exponentielle sur ~0.4 s, puis noir pendant le reste du cycle. Un sinus donne
   une respiration douce ; une luciole fait un **flash**.

### Rendu

Quads additifs orientés caméra, gaussienne radiale dans le fragment. Couleur
jaune-vert (~560 nm, autour de `0x9dff6a`).

**Surpilotage ≈ ×1.6, à recalibrer à l'œil.** La cible de rendu du composer est
en half-float et la passe de bloom seuille par luminance : une valeur bornée à 1
qui passe sous le seuil lit comme un point plat au lieu d'une lumière — **le halo
est ce qui vend la lumière** (`details.js:1531`).

Mais le seuil **n'est pas 0.85** : 0.85 est la valeur passée au constructeur
(`sky.js:1148`), aussitôt écrasée chaque frame par `K_BLOOM_THRESHOLD`
(`sky.js:385`), qui descend à **0.42 en pleine nuit** — calibré pour que la lune
(~2.1 linéaire) et les étoiles les plus vives (~1.3) fassent halo. Le ×2.6 des
lanternes vise le seuil de crépuscule sur une sphère de 0.185 u ; à 0.42 et sur
un quad plus petit, ~1.6 suffit et 2.8 cramerait.

**Confirmé indépendamment** : les bougies d'offrande du hokora (commit `71b5cfb`)
sont réglées à **1.55** pour un émetteur de r 0.019, avec la même conclusion
tirée d'un premier essai trop chaud — « le halo doit venir du bloom, pas de
l'émetteur ». Une luciole doit sortir entre 1.5 et 1.8. À trancher en A/B contre
lanterne et bougie dans le même plan.

**Le tier `low` n'a pas de bloom du tout** (`QUALITY.low.bloom = false`, donc pas
de composer). Le sprite doit donc porter sa propre décroissance douce —
`exp(−k·r²)` et non un `smoothstep` à bord franc — pour rester une lumière quand
le halo n'existe pas.

`depthWrite: false`, `AdditiveBlending`, pas d'ombre, pas de `PointLight` —
une lumière réelle par insecte tuerait la scène.

### Heure — un pic, pas un plateau

L'activité réelle culmine dans les deux premières heures après le crépuscule puis
retombe. Une courbe scalaire piquée peu après le coucher multiplie l'intensité
globale, plutôt qu'un plateau constant de la nuit entière. Coût : un scalaire.

Fenêtre : `lit = clamp(phase.night + 0.6 × phase.twilight, 0, 1)`, puis le pic
par-dessus. Invisible et non mis à jour quand `lit < 0.01`.

### Budget — dérogation assumée à la doctrine

```
low 160 · high 420 · ultra 800    (valeurs ABSOLUES)
```

`config.js` impose que les scatters coûteux passent en `AREA_SOFT`. **Les
lucioles n'y passent pas, et c'est délibéré** : elles sont ancrées sur trois
bassins de taille fixe, pas étalées sur une surface. Les faire croître avec l'île
les diluerait sans rien ajouter au cadrage. Écrire la raison dans `config.js`, à
côté des chiffres — sinon la prochaine relecture la « corrigera ».

Coût : un seul draw call, ≤ 800 quads minuscules, additifs, sans ombre.

---

## Module 2 — `src/butterflies.js`

### Signature

```js
createButterflies({ seed, quality, season, heightAt, flowerSpots, wind })
  → { group, update(t, dt, shaderPhase), setRepeller(pos), dispose() }
```

`setRepeller` copie exactement `world.birds.setRepeller?.(world.shiba.position)`
de `main.js:542` — même contrat, même point d'appel, après `shiba.update`.

**Éclairage : `shaderPhase`, pas `phase`.** `main.js` normalise `keyIntensity`
(≈ 4.3 à midi, échelle `DirectionalLight`) avant de le donner aux shaders écrits
à la main. Un papillon nourri à la valeur brute serait blanc pur en plein jour.

### Espèces — deux, pour ne pas lire comme un clone dupliqué

| Saison | Espèce A | Espèce B |
| --- | --- | --- |
| printemps | `Pieris rapae` — petite, blanche | `Papilio xuthus` — grand machaon jaune-noir |
| automne | `Vanessa indica` — akatateha, roux-orangé | `Papilio xuthus` |

Répartition ≈ 70 % espèce A / 30 % espèce B : les grands machaons sont plus rares
que les blanches, et un ciel plein de grands papillons perd l'échelle.

### Le vol est la signature

La référence est explicite : les *Pieris* de printemps volent **lentement, avec
une forte courbure de trajectoire**. C'est erratique, ça zigzague — ce n'est
surtout pas l'arc lisse d'un boid.

- **Cap** en marche aléatoire, plus **embardées sèches** occasionnelles. Le
  mécanisme existe déjà dans le projet : `WIND.veerChance` / `veerAmount` fait
  exactement ça pour la direction des rafales. Le réemployer plutôt que
  l'inventer.
- **Tangage vertical calé sur le battement d'ailes.** Un papillon monte au coup
  d'aile bas et retombe entre deux. C'est LE tell, et il tient ici le rôle exact
  que le `BANK` tient dans `birds.js` : « le détail le moins cher et le plus
  porteur du fichier ».
- **Blanche** : bas (0.3–1.5 u), lent, erratique, au-dessus des fleurs.
  **Machaon** : plus rapide, plus droit, plus haut (2–4 u, autour des couronnes),
  avec des **planés** entre les battements.

Vent : advection douce seulement, sur le CPU comme `birds.js` (« pas d'uniforme
de vent ici, exprès » — le shader n'a pas besoin de `uTime` et ne peut donc pas
entrer en collision avec le bloc de vent partagé).

### Domaine — ils ne partent pas en mer

Un cap en marche aléatoire non borné finit par emmener la population au large,
lentement et sans que rien ne l'arrête. `birds.js` a déjà résolu ça avec un
**volume de repos souple** (`HOME_X`/`HOME_Z`, `HOME_RX`/`HOME_RZ`, dimensionné
juste à l'intérieur des bornes de la terre pour que les excursions traversent la
côte plutôt que la haute mer). Même mécanisme ici, mais **centré sur le
barycentre du champ de fleurs** et nettement plus resserré : un papillon n'a pas
le rayon d'action d'un oiseau. Force de rappel proportionnelle au dépassement,
pas un mur — un papillon qui rebondit sur une frontière invisible se dénonce.

### Machine à états

```
WANDER ──(fleur proche & tirage)──▶ APPROACH ──▶ PERCHED
   ▲                                                │
   └──────────────(temps écoulé)────────────────────┘
   ▲
   └── FLUSH ◀──(shiba à moins de ~4 u)── n'importe quel état
```

- **PERCHED** : ailes qui s'ouvrent et se ferment très lentement, pas immobiles.
- **FLUSH** : rayon **~4 u**, bien plus court que les 26 u des oiseaux — on
  approche un papillon de près avant qu'il ne parte, et un papillon qui décolle
  à 26 u lit comme un oiseau. Impulsion vers le haut et à l'opposé, retour en
  WANDER après quelques secondes.
- **Crépuscule** : ils cherchent un perchoir, s'y posent, et s'effacent posés.
  Version bon marché du roost de `birds.js` — pas d'approche d'atterrissage
  simulée, mais ça lit vrai. Symétrique au lever.

### Poses — ce que ça demande à `details.js`

Les papillons visent les **dérives de fleurs sauvages**. Leurs positions ne sont
pas exportées aujourd'hui : elles sont écrites directement dans des matrices
d'instance.

**Ajout requis dans `details.js`** : collecter les positions posées et les
exporter, exactement comme `lanternSpots` l'est déjà (`details.js:321`,
`export let lanternSpots = []`, rempli par `createDetails`). Le précédent existe,
le diff est de quelques lignes.

L'alternative — re-dériver les positions dans `butterflies.js` avec le même
`streamFor(seed, 'details.flowers')` — est **rejetée** : elle duplique la logique
de placement, et le jour où les dérives changent, les papillons se posent en
silence sur de l'herbe nue.

### Ailes

**Battement dans le vertex shader, phase intégrée sur le CPU.** Pas
`sin(uTime · freq)`. C'est le point 2 de l'en-tête de `birds.js`, déjà payé :
dès que la fréquence varie — planer, fuir, se poser — un sinus à fréquence
variable **saute** à l'instant du changement. On intègre `dφ` par individu et on
téléverse la phase.

Silhouette en **alpha analytique dans le fragment**, comme `sakuraAlpha` de
`petals.js` : aile antérieure arrondie, lobe postérieur, queue pour le machaon.
Idiome du projet (les textures sont générées, jamais chargées).

**`DoubleSide` obligatoire** — une aile se voit des deux côtés. Et **piège 1
d'`AGENTS.md`** : le winding a déjà mordu ce projet quatre fois (océan, corolle,
ailes d'oiseau, ruban de chemin). Diagnostic éclair si les papillons sont
invisibles : forcer `DoubleSide` à chaud.

Un seul `InstancedMesh` pour les deux espèces (l'espèce est un attribut
d'instance qui commute la silhouette et la couleur), donc **un draw call**.

### Budget

```
low 5 · high 12 · ultra 24    par île unité, × AREA_SOFT (≈ 5.66)
→ ≈ 28 / 68 / 136 individus
```

Eux couvrent bien une surface : ils suivent la doctrine `AREA_SOFT` de
`config.js` sans dérogation.

Coût CPU : O(N), pas de recherche de voisinage (aucun vol en formation à
simuler). `birds.js` fait déjà du boids en O(N²) sans se plaindre.

---

## Le relais crépusculaire

Une seule source pour les deux modules : `phase.day`, `phase.twilight`,
`phase.night`, déjà calculés par `sky.js` à chaque frame. Les papillons se
posent et s'effacent pendant que les lucioles montent. Aucune coordination entre
les deux fichiers — ils lisent le même objet et n'ont pas à se connaître.

## Ce que ça touche ailleurs

| Fichier | Changement |
| --- | --- |
| `main.js` | 2 imports, 2 constructions dans le boot, 2 `update()` dans la boucle, 1 `setRepeller` |
| `details.js` | export des positions de fleurs (quelques lignes, sur le modèle de `lanternSpots`) |
| `config.js` | 2 blocs de budget + les constantes d'art direction |
| `test/invariants.html` | 3 invariants nouveaux |

**Aucun contrat d'`AGENTS.md` n'est en jeu** : pas de heightfield, pas de réseau
de chemins, pas de `sunDistance` ni de near-plane d'ombre, pas de rebuild à
chaud. Les deux systèmes se dimensionnent à la construction, comme tout le reste.

## Vérification

### Invariants — de 10 à 14, en deux temps

`test/invariants.html` doit finir par `INVARIANTS: 12 pass, 0 fail` après le
chantier L, puis `14 pass, 0 fail` après le chantier P.

Chantier L (lucioles) :

11. **Lucioles dans leur habitat** — toute position semée est à l'intérieur du
    rayon d'habitat d'au moins un bassin ; aucune isolée à l'autre bout de l'île.
12. **Les lucioles dorment le jour** — à `dayTime = 0.5`, aucune luciole visible.

Chantier P (papillons) :

13. **Papillons au-dessus de la surface** — pour tout individu, `y > heightAt(x,z)`
    avec une garde, et XZ à l'intérieur du domaine de vol (pas en mer).
14. **Les papillons dorment la nuit** — à `dayTime = 0.97`, aucun papillon
    visible.

12 et 14 sont ce qui attrape une fenêtre inversée ou un gate oublié — la panne la
plus probable de tout ce chantier, et la plus silencieuse.

Rappel du piège de la suite : **le tier du bake se choisit par `?q=`, défaut
low**, et `low` est le terrain le PLUS LISSE donc le cas le plus facile. Tout ce
qui touche à la géométrie se repasse en `?q=ultra`.

### Performance

Deux draw calls, ≤ 950 instances au total, aucune ombre. Le poste dominant reste
le feuillage (88 % du temps de frame en vue large, 75 % au sol) : ceci devrait
être sous le bruit. **On le mesure au lieu de l'affirmer**, sous le protocole
complet du piège 9 :

- resynchroniser par `gl.readPixels(0,0,1,1,…)` après chaque frame — `__sk.frame()`
  ne fait que soumettre à la GPU (une boucle forcée annonçait 1413 fps) ;
- `__sk.setCamMode('orbit')`, `controls.autoRotate = false`,
  `controls.enableDamping = false`, puis **vérifier que la dérive de caméra est
  nulle** sur la durée du banc (une mesure « cadrée » avait dérivé de 992 u).

Étalon actuel à ne pas dégrader — printemps ultra, 3600×1896 : **ouverture
33.7 fps, sol 24.6**. Le banc des lucioles se fait **de nuit**, où le décor est
différent : relever la référence nocturne AVANT d'ajouter quoi que ce soit.

### Visuel

- Nuit (`__sk.world.dayTime = 0.97`) : les trois bassins respirent chacun à son
  rythme, l'île ne pulse pas d'un bloc, les flashes ont un halo (bloom) et non
  un bord dur. Comparaison à des photos longue pose de hotaru.
- Jour (`0.5`) : des papillons visitent les dérives de fleurs, le vol zigzague au
  lieu de planer en arcs, on distingue les deux espèces à la taille et à
  l'allure. Comparaison à des vidéos de prairie.
- Crépuscule (`0.75` → `0.85`) : le relais se fait sans trou ni chevauchement
  franc.
- Les deux saisons, aux trois tiers `?q=low|high|ultra`.

## Hors périmètre (YAGNI)

- Pas de `PointLight` par luciole — mort assurée.
- Pas de reflet des lucioles dans l'eau des étangs.
- Pas de retouche de la courbe nocturne de `sky.js` (autre chantier, autre spec).
- Pas de libellules, pas de cigales, pas de son.
- Pas de cycle de vie, de ponte, ni d'accouplement.
- Pas de collision avec les arbres ou les lanternes.

## Ordre des chantiers — arbre partagé

Au moment d'écrire ce spec, `src/details.js` portait 172 lignes non commitées
d'une autre session (un hokora : `applyShrineSurface`, mousse, lichen, toiture,
puis des bougies d'offrande allumées la nuit). **Cette session a depuis commité**
(`71b5cfb`) — le blocage est levé et les deux chantiers peuvent s'enchaîner sur
un arbre propre. Le séquençage ci-dessous reste néanmoins le bon ordre : il
répond d'abord à la demande d'origine, qui portait sur la nuit.

Or les **lucioles ne touchent pas `details.js`** : leur habitat vient de
`ponds.js`. Seuls les papillons en ont besoin, pour l'export des positions de
fleurs. D'où le séquençage retenu :

1. **Chantier L — lucioles.** Démarre immédiatement. Touche `src/fireflies.js`
   (nouveau), `main.js`, `config.js`, `test/invariants.html`. **Zéro
   recouvrement** avec le sanctuaire, donc ni worktree ni merge.
2. **Chantier P — papillons.** Démarre une fois `details.js` commité par l'autre
   session. Touche `src/butterflies.js` (nouveau), `details.js` (export des
   fleurs), `main.js`, `config.js`, `test/invariants.html`.

Les invariants montent donc en deux temps : 10 → 12 au chantier L (habitat des
lucioles, exclusivité de nuit), puis 12 → 14 au chantier P (papillons au-dessus
de la surface et dans leur domaine, exclusivité de jour). Le compte final attendu
est `INVARIANTS: 14 pass, 0 fail` — et non 13 : séparer l'exclusivité du relais
en deux vérifications, une par espèce, la rend diagnostiquable chantier par
chantier.
