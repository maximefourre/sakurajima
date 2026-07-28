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
| `src/island.js` | ✅ | Terrain, côte organique, rochers, océan. L'enroulement du disque d'océan était inversé — voir `REPRISE.md` #1. |
| `src/sakura.js` | ✅ | 5 archétypes d'arbres. Attention à ses noms d'options : `isLand`, `windUniforms`, `quality` **numérique**. |
| `src/grass.js` | ✅ | Herbe instanciée. Hook `exclude` ajouté pour la garder hors de l'eau. |
| `src/sky.js` | ✅ | Cycle jour/nuit. Le gain du dôme est keyframé, pas constant. |
| `src/river.js` | ✅ | Rivière + pont japonais, creusés dans le heightfield. |
| `src/ponds.js` | ✅ | Étangs, carpes koi, nénuphars. |
| `src/birds.js` | ✅ | Vol en boids, perchoir nocturne, `setRepeller` pour le shiba. |
| `src/clouds.js` | ✅ | Cumulus proches à parallaxe, dérivant avec le vent partagé. |
| `src/shiba.js` | ✅ | Le personnage jouable. Voir §5. |

---

## Reste à faire, par priorité

### 1. Les cerisiers lisent comme un verger, pas comme un nuage rose
Maintenant que la structure de branches se construit vraiment (le budget de
branches valait NaN — voir `REPRISE.md` #6), les arbres montrent beaucoup
d'écorce sombre. C'est correct et un peu triste. Les leviers, dans l'ordre
d'efficacité : la taille des fleurs (`size` par archétype dans `sakura.js`,
0.09–0.215 aujourd'hui), puis `blossomDensity` dans `main.js`, puis le nombre
d'arbres. Grossir les fleurs remplit une couronne bien plus vite que d'en
ajouter, et coûte moins cher.

### 2. Juger les trois nouveaux modules dans la vraie scène
`ponds`, `birds` et `clouds` ont été écrits puis relus par des agents adverses,
et ils tournent. Mais ils n'ont pas encore été jugés à l'œil à toutes les heures
du jour. En particulier : les nuages à l'aube et au crépuscule, la couleur de
l'eau des étangs sous une lumière rasante, et le passage des oiseaux au perchoir.

### 3. La bande grise au zénith
Quand la caméra pique franchement vers le bas, le haut du cadre ne montre plus
que la bande de brume d'horizon de Preetham, qui est presque blanche. Ce n'est
pas un bug, mais le cadrage d'ouverture devrait l'éviter.

### 4. Le shiba, second passage
Il marche, court, s'assoit, barbote et laisse des empreintes. Manquent encore :
il ne lève la tête vers les pétales que sur une minuterie, pas parce qu'un pétale
est réellement passé ; il n'aboie pas ; et il traverse les troncs. Un test de
collision contre `forest.instances` serait peu coûteux — les positions et les
rayons de couronne sont déjà exposés.

### 5. Le shiba, tel qu'il a été construit  🐕

`src/shiba.js` → `createShiba({ seed, heightAt, slopeAt, normalAt, isInPond, wind, seaLevel })`

Maillage 100 % procédural, aucune texture, aucun asset : des tubes effilés
balayés le long de courbes tracées à la main, peints par sommet, suspendus à une
hiérarchie d'`Object3D` que quelques sinusoïdes animent. Un shiba tient
entièrement dans sa silhouette et dans deux couleurs — queue enroulée **sur** le
dos, oreilles triangulaires petites et portées vers l'avant, museau court et
carré, et le crème *urajiro* sous la mâchoire, le poitrail, le ventre et la queue
contre un manteau roux. Sans ces quatre choses, c'est un renard.

Il est construit à **environ deux fois la taille réelle** (`SHIBA.scale`) : à
l'échelle vraie il fait 0.4 unité au garrot, soit moins qu'un brin d'herbe (0.55),
et il disparaît dans le pré depuis n'importe quelle caméra qui cadre aussi l'île.

- **Contrôleur** : ZQSD/WASD + flèches, `Maj` pour courir. Les touches sont lues
  par `event.code`, donc la même poignée de lignes couvre AZERTY et QWERTY sans
  table de correspondance. Déplacement relatif à la caméra.
- **Terrain** : il se colle au sol via `heightAt`, s'incline **partiellement**
  vers la normale (0.42 vers la verticale — un quadrupède garde son corps bien
  plus horizontal que le sol sous lui), refuse les pentes au-delà de 0.72, refuse
  l'eau profonde mais barbote jusqu'à 0.34 sous le niveau de la mer, et **glisse**
  le long de ce qui le bloque au lieu de s'y coller.
- **Vie** : il s'assoit après 4 s d'immobilité (fondu, pas un claquement de
  doigts), sa queue s'agite d'autant plus vite qu'il vient de courir, ses oreilles
  se couchent à la course et frémissent dans les rafales du vent partagé.
- **Empreintes** : `InstancedMesh` en tampon circulaire, date de naissance par
  instance, fondu dans le fragment shader. Uniquement dans le sable mouillé —
  une empreinte dans l'herbe ne se voit pas et sur le roc elle est fausse.
- **Caméra** : `C` bascule entre la caméra de contemplation (OrbitControls) et
  une caméra tierce personne qui traîne derrière lui, se recale d'elle-même dans
  son dos, et se maintient au-dessus du relief.
- Les oiseaux reçoivent sa position via `birds.setRepeller()` à chaque frame.

### 6. Peaufinage (explicitement repoussé)
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
