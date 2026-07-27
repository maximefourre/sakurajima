# Sakurajima — état des lieux et reste à faire

Île 3D en three.js couverte de cerisiers, vent en bourrasques qui emporte les pétales
et couche l'herbe, cycle jour/nuit complet, relief et rochers, étangs à carpes koi,
oiseaux, nuages.

**Machine cible :** Apple M4 Max, 32 cœurs GPU → budgets calibrés généreusement.
**three.js 0.185.1** via importmap unpkg, aucun build step.

---

## Lancer

```sh
python3 serve.py 5173      # serveur no-store + charset utf-8 (indispensable, voir plus bas)
open http://127.0.0.1:5173/index.html
```

Bancs d'essai isolés : `test/petals.html`

---

## Fait

| Module | État | Notes |
|---|---|---|
| `src/noise.js` | ✅ écrit à la main | PRNG mulberry32 + flux indépendants par sous-système, bruit gradient, fbm, ridged, domain warp. **Source de vérité unique** pour la hauteur du terrain. Validé numériquement sous node. |
| `src/wind.js` | ✅ écrit à la main | Modèle en **train de rafales** : accalmies réelles, bourrasques qui montent et retombent, cap en marche aléatoire avec embardées, fronts qui traversent l'île. Implémentations JS et GLSL jumelles. |
| `src/petals.js` | ✅ écrit à la main | ~12k pétales instanciés, animation 100 % vertex shader, culbute sur axe précessant, silhouette échancrée procédurale, demi-Lambert pour la translucidité. **Validé en navigateur**, shader compile. |
| `src/config.js` | ✅ | Toutes les constantes d'art direction + presets qualité low/high/ultra. |
| `index.html` | ✅ | Voile de chargement, HUD horloge/perf, panneau de réglages, capture des erreurs fatales. |
| `serve.py` | ✅ | Serveur de dev `no-store` + `charset=utf-8`. |
| `src/island.js` | 🟡 designé | Terrain, côte organique, rochers, océan. Non encore exécuté. |
| `src/sakura.js` | 🟡 designé | 5 archétypes d'arbres. Non encore exécuté. |
| `src/grass.js` | 🟡 designé | Herbe instanciée. Non encore exécuté. |
| `src/sky.js` | 🟡 designé | Cycle jour/nuit. Non encore exécuté. |
| `src/ponds.js` | 🔴 **stub** | Renvoie un groupe vide, `carvePonds` = identité. |
| `src/birds.js` | 🔴 **stub** | |
| `src/clouds.js` | 🔴 **stub** | |

---

## Reste à faire, par priorité

### 1. Faire booter le MVP (en cours)
Les 4 modules designés (`island`, `sakura`, `grass`, `sky`) sont installés mais
**jamais exécutés**. Il faut lancer `index.html` et corriger en boucle jusqu'à
l'affichage. Erreurs attendues :

- **Collision de uniforms.** `grass.js` déclare son propre `uTime`, et mon
  `WIND_GLSL` déclare aussi `uniform float uTime;`. Une double déclaration ne
  compile pas en GLSL. Correctif : retirer `uTime` des uniforms de grass et
  laisser le bloc vent le fournir, ou renommer celui de grass.
- **`sakura.js` a réimplémenté son propre vent** (`WIND_GLSL`,
  `createWindUniforms`). Le débrancher et lui passer `wind.WIND_GLSL` +
  `wind.uniforms` par référence, comme le fait déjà `grass.js`.
- `grass.js` et `sakura.js` exportent chacun leur `mulberry32` — inoffensif,
  mais à faire pointer vers `noise.js` pour que le monde reste reproductible.
- Vérifier que `island.heightAt` et le maillage du terrain utilisent bien le
  **même** bruit, sinon arbres et herbe flotteront ou s'enfonceront.

### 2. Récupérer les résultats du 2ᵉ workflow
Les designs **étangs+koi / oiseaux / nuages** tournaient encore. Résultats dans :

```
~/.claude/projects/-Users-fourreto-Projects-vibecode-sakurajima/…/subagents/workflows/wf_4e530dc3-58a/journal.jsonl
```

Extraire les entrées `type: "result"`, champ `corrected_code` (sinon `code`),
et remplacer les stubs. Le script d'extraction utilisé pour le 1ᵉʳ workflow est
réutilisable tel quel.

### 3. Appliquer les corrections des vérificateurs
Chaque sous-système a un agent adverse qui produit `corrected_code` (API r185
hallucinées, GLSL qui ne compile pas, `onBeforeCompile` mal ancré, allocations
par frame). Ces résultats sont dans le même journal, phase `Verify`. **Préférer
`corrected_code` au `code` d'origine** partout où il existe.

### 4. Câbler les étangs correctement
`main.js` appelle déjà `createPonds()` **avant** `createIsland()` et passe
`ponds.carvePonds` au terrain, pour que les cuvettes soient creusées dans le
heightfield lui-même plutôt que plaquées après coup. Puis `ponds.attach({heightAt})`.
Le stub respecte cette forme — le vrai module doit la respecter aussi.

### 5. Peaufinage (explicitement repoussé)
- Densité et taille des pétales à rejuger **dans la scène réelle**, pas dans le banc d'essai.
- Cadrage de la caméra d'ouverture.
- Ombres portées des nuages sur l'île.
- Rayons crépusculaires.
- Son (le module oiseaux expose déjà un hook `onEvent` pour les cris).

---

## Pièges déjà rencontrés (ne pas les repayer)

1. **Backticks dans un commentaire GLSL.** Les shaders sont dans des template
   literals JS ; un backtick dans un commentaire termine la chaîne. Coûte une
   `SyntaxError` incompréhensible.
2. **`fog_vertex` de three exige une variable nommée littéralement `mvPosition`.**
   La renommer casse la compilation.
3. **`python -m http.server` met en cache.** Les imports ESM étant statiques, un
   cache-buster dans l'URL de la page ne les atteint pas : on debug l'ancien
   module sans le savoir. D'où `serve.py`.
4. **Pas de charset sur `text/html`** → le navigateur retombe sur un encodage
   legacy et casse sur le moindre octet non-ASCII dans un script inline.
5. **`windForce`** existe en deux signatures (`(pos)` et `(pos, t)`) ; une
   surcharge GLSL les réconcilie, ne pas en supprimer une.

---

## Décisions d'architecture à ne pas défaire

- **Un seul bruit.** `heightAt()` et le maillage du terrain doivent partager
  exactement la même fonction, sinon les props ne collent plus au sol.
- **Aucun `Math.random()`.** Tout passe par un flux graine ; l'île doit être
  identique à chaque rechargement, sinon elle n'est pas dirigeable artistiquement.
- **Uniforms de vent partagés par référence.** Un seul `wind.update()` pilote
  tous les matériaux. Ne jamais cloner cet objet (attention à
  `UniformsUtils.merge`, qui clone : réassigner après).
- **Aucune texture externe.** Fleurs, pétales, koi, nuages sont procéduraux —
  net à toute distance et zéro requête réseau.
