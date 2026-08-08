# Où j'en suis — point d'arrêt du 28/07/2026

> Le contexte long (direction artistique, décisions, pièges) est dans `PLAN.md`.
> Ce fichier-ci est la checklist opérationnelle.

## Reprendre en 30 secondes

```sh
cd ~/Projects/vibecode/sakurajima
python3 serve.py 5173
# puis http://127.0.0.1:5173/index.html
```

**La scène s'affiche, tourne, et se pilote.** ZQSD/WASD promènent le shiba,
`Maj` le fait courir, `C` bascule entre caméra libre et caméra suivie.

---

## Ce qui a été corrigé le 28/07 — ne pas le refaire

| # | Fichier | Problème | Correctif |
|---|---|---|---|
| 1 | `island.js` | **Le disque d'océan était enroulé à l'envers.** Toutes les faces pointaient vers le fond marin, donc `side: FrontSide` culait la mer entière. L'île flottait dans une cuvette de fond marin nu et le shader d'eau ne dessinait rien — ce qui se lisait comme un problème de réglage et avait été chassé comme tel. | Indices inversés |
| 2 | `main.js` | Forçait l'opacité et la réflectivité de l'eau au boot ; `island.update()` les réécrit à chaque frame depuis sa courbe jour/nuit, donc ces affectations n'atteignaient jamais la première image | Intention déplacée dans la courbe, bloc mort supprimé |
| 3 | `sky.js` | Le dôme de Preetham saturait en blanc à midi. Un gain unique ne peut pas servir midi **et** le crépuscule : l'écart de luminance est d'un ordre de grandeur | Gain **keyframé** (`K_SKY_GAIN`), valeurs obtenues par calibration en navigateur, pas à l'œil |
| 4 | `sky.js` | Brouillard rabaissé à 16 % pour combattre un « voile blanc » qui était en fait le ciel cramé + la mer absente. Résultat : ligne d'horizon au rasoir | `FOG_SCALE` 0.16 → 0.56 |
| 5 | `grass.js` | **Aucune notion d'eau.** Les cuvettes sont creusées dans le heightfield, donc leur fond passe tous les tests que l'herbe applique. Les étangs se remplissaient d'herbe immergée | Hook `exclude` ajouté, câblé sur étangs + rivière |
| 6 | `main.js` | `createSakuraForest` recevait `isInPond`, `wind` et l'**objet** de qualité. Or il attend `isLand`, `windUniforms` et un **nombre**. `clamp(objet, …)` vaut NaN → chaque arbre était construit avec un budget de branches NaN et se rendait comme un nuage de fleurs sans arbre dessous | Noms corrigés, densité de fleurs relevée pour compenser les vraies branches |
| 7 | `main.js` | La forêt tournait sur son propre vent : `wind.js` stocke la direction en `Vector2`, `sakura.js` la lit en `vec3` | Petit adaptateur `forestWind` dans `main.js`, rafraîchi chaque frame |

## Ce qui a été ajouté le 28/07

- **`src/shiba.js`** — le personnage jouable. Maillage procédural (tubes effilés
  balayés le long de courbes, peinture par sommet), animé par une hiérarchie
  d'`Object3D`. Marche/course, orientation lissée, conformation au terrain,
  refus de l'eau profonde mais barbotage dans les hauts-fonds, position assise
  après quelques secondes d'inactivité, queue qui s'agite plus fort après une
  course, empreintes de pattes dans le sable mouillé qui s'effacent en 26 s.
- **Caméra tierce personne** dans `main.js` (`C` pour basculer). Elle traîne
  derrière lui avec du retard et se tient hors du relief.
- **`src/ponds.js`, `src/birds.js`, `src/clouds.js`** — les trois stubs
  remplacés. Étangs à koi et nénuphars, vol de boids qui se perche la nuit et
  se disperse quand le chien approche, cumulus proches à vraie parallaxe.
- **`src/details.js`** — le niveau du sol. Fleurs sauvages en dérives (quatre
  espèces qui se regroupent séparément, pliées par le vent partagé), lanternes
  de pierre le long du chemin du pont dont la cage à feu s'allume au crépuscule,
  galets sur l'estran.
- **L'embouchure de la rivière.** Le chenal ne creusait pas seulement la terre :
  il continuait sous la mer, et le ruban d'eau s'arrêtait sur une arête
  rectangulaire posée au-dessus des vagues. Le carve s'éteint maintenant quand
  le sol atteint le niveau de l'eau, et l'embouchure est *trouvée* et non
  écrite : on échantillonne les berges de part et d'autre du couloir et le
  ruban se dissout là où elles disparaissent.

---

## Session « île ×5 » du 28/07 (après-midi) — ce qui a changé et pourquoi

**Le knob** : `LAND_SCALE = 1.42·√5` (aire exactement ×5). Nouveau knob frère :
`HEIGHT_SCALE = 1.4` — relief relevé partiellement (appliqué UNE fois sur
l'accumulateur `land` dans `analyticHeight`), sinon la crête de 17 u sur une
île de 1120 u lisait comme une crêpe. Les budgets coûteux (herbe, arbres,
pétales, rochers) scalent désormais en `AREA_SOFT = AREA^0.75` — l'aire pleine
donnait 3 M de brins et 3125 arbres, intenable ; la densité perçue est
compensée par des instances plus grosses (fleurs +35 %, brins plus larges).

| Correctif d'échelle | Où |
|---|---|
| **Near-plane d'ombre négatif** (`D_SUN` fixe 320 < islandRadius+80) → toutes les ombres mortes. `sunDistance` désormais dérivé de `LAND_SCALE` | `sky.js:62` |
| Disque océan : rayons dérivés (`ISLAND_R·1.5`, `SIZE·3.37`), 320 anneaux | `island.js` |
| Fade de houle GLSL ×2.24 (1450→4250) | `island.js` |
| `FOG_SCALE 0.56 → 0.25` (même profondeur optique au nouvel horizon) | `sky.js` |
| Champ de nuages : `FIELD_HALF/FADE_*` dérivés de LAND_SCALE, decks +30 % | `clouds.js` |
| Fleurs/galets : comptes ×AREA (`2500·budget·AREA`, `120·budget·AREA`) | `details.js` |
| Profondeur d'étang ×min(HEIGHT_SCALE, 1.3) | `ponds.js:73` |
| `CEILING 98 → 140` (oiseaux au-dessus du relief relevé) | `birds.js` |
| Caméra `far = 1750·L` ; segments terrain 768 (ultra) / 512 / 320 | `config.js`, `island.js` |

**Le delta.** `river.js` généralisé en `BRANCHES[]` (tronc + 2 distributaires,
`RIVER.branches` dans config). Index spatial et champ de distance baké
min-combinés sur toutes les branches (`_fieldB` en plus de `_fieldT`) ;
`carveRiver`/`isInRiver` inchangés d'API. Leçons chèrement payées :
- **La jonction doit être là où l'eau du tronc est déjà ≈ niveau de la mer**
  ([40,80], eau ≈ 0.9). Plus haut, les bras épinglés au niveau du tronc
  flottent au-dessus du platier qu'ils traversent.
- **Tout le quadrant SE est un platier à peine émergé.** Deux fades devaient
  s'adoucir pour que trois bras y restent lisibles : le fade de rive du ruban
  (2.4 → 1.4 de plafond) et le fade d'estuaire du carve (il descend maintenant
  à −0.5 sous la mer, sinon les bras n'avaient pas de lit dans le platier et
  l'eau passait sous le sable).
- Les embouchures sont écartées de 135–165 u (est (311,254)·unit, SO (51,400),
  tronc (203,337)) — plus près, tout fusionnait en une lagune unique.
- Continuité à la jonction : les stations d'un distributaire encore dans le
  chenal du tronc sont épinglées sur `waterYAt(tronc)`, ré-épinglées après
  chaque passe de lissage ; son ruban ne démarre qu'à >0.55·width de l'axe du
  tronc (sinon double-blend sombre des deux surfaces transparentes).

**Le pont.** Travée raccourcie (`16·(1+(L−1)·0.6)` ≈ 37) : la rivière longe le
flanc de crête, la berge ouest monte sans fin, une travée de 60 u enterrait un
bout et perchait l'autre sur une tour. `buildBridge` glisse maintenant le
tablier le long de son axe (recherche ±12 u) vers la paire de culées la plus
horizontale, se pose sur la plus haute, et comble sous chaque bout avec une
semelle de pierre (plafonnée à 4 u). Lanternes de pierre appariées aux deux
extrémités (spots calculés depuis la courbe dans `details.js` — le glow
nocturne est gratuit, même InstancedMesh que les autres).

**Falaise + chemin + torii.**
- Falaise : secteur angulaire plein-ouest dans `analyticHeight` — la côte
  gonfle vers un rebord (`rim ≈ 8·HEIGHT_SCALE`) puis tombe (`sstep(0.545,
  0.585, d)`) dans une eau profonde (−15). Tout suit (couleur roche via la
  pente, pas d'herbe sur la face, pierriers au pied).
- Chemin : `PATH` dans config (falaise → pont, au sud de la rivière), ruban de
  terre battue à 3 colonnes drapé sur `heightAt` dans `details.js`, herbe
  exclue via `isOnPath` (grille de buckets, export module) branché dans les
  DEUX sites d'appel de `createGrass` de `main.js`.
- Torii : géométrie fusionnée peinte par sommet (même recette que la
  lanterne), 3 instances aux fractions `PATH.toriiAt`.

**Luxuriance.** Herbe : couverture élargie (patchLow 0.14, bareThreshold 0.86),
brins 0.62×0.068, fondu caméra 160/230, ~2.66 M brins ultra
(`470000·AREA_SOFT`). Cerisiers : fleurs +35 % de taille par archétype,
densité +25 %, `blossomDensity` ultra 2.6, budget branches 1.25, massifs
contrastés (`groveScale 0.018`, `groveContrast 0.85`), ~1400 arbres.

**Mesuré en fin de session : ~41 fps ultra** (vue pont au sol). Replis dans
l'ordre si besoin : grass `fadeEnd 230→190` ; trees 1400→1000 ;
`blossomDensity 2.6→2.2` ; anneaux océan 320→280.

---

## Session « nuit + review ADV + textures » du 28/07 (soir)

Trois chantiers : la nuit féérique, la résolution de la review adversariale
`ADV-2026-07-28-DD673B6` (statuts dans `ADVERSARIAL_REVIEW_CLAUDE.md`), et le
détail procédural des surfaces.

**La nuit.** Le diagnostic n'était pas « réglages trop sombres » mais
géométrique : la lune (dec −7) culminait à 50° alors que l'orbite ne cadre
jamais au-dessus de ~20°, et l'extinction d'horizon des étoiles
(smoothstep −0.015→0.17) tuait précisément la bande 0–10° — la seule visible.
Correctifs : `moonDeclination −34` (culmination 24°, lune basse cadrable, le
commentaire d'origine croyait −7 « plus bas » que l'anti-soleil : c'est
l'inverse), disque ×1.7 (angularRadius 0.030) et éclat 2.4 ; étoiles pleine
force dès 3.4° (smoothstep −0.04→0.06), alpha plancher 0.50, taille ×~1.7,
4800 étoiles ; terre nocturne ×~3 (lune 1.0 vs soleil 4.3, hemi 0.50 et bleu
saturé 0x1d3a78 qui SURVIT au toe ACES, exposition nuit 0.80) ; dôme/Voie
lactée éclaircis ; clés de brouillard NOCTURNES ×1.4 (le FOG_SCALE global
reste 0.25 — le jour est calé) avec bleu 0x101c40 ; bloom nuit seuil 0.42
(0.30 noyait le disque dans son propre halo) ; decks nuages +20-30 %.

**Review — tout accepté, tout traité** (contre-vérification indépendante : les
8 claims étaient vrais ; P2.7 pire qu'annoncé, le vrai bord du disque océan
était nearR+farR = 5768). Résolutions notables :
- Tier de qualité résolu AVANT boot (`?q=` → localStorage → défaut) ; bouton
  = persist + reload ; `rebuildForQuality()` SUPPRIMÉ avec sa duplication.
- `river.bridgeInfo` (placement final, shift compris) = source de vérité du
  chemin (`initPath`, appelé avant l'herbe) et des lanternes de culées.
- Boucle morte du profil supprimée, warn si source mal placée, clamp
  jamais-remonter FINAL (politique tidale documentée dans river.js).
- Champs de distance PAR BRANCHE, min à la requête → triplet (dist,t,b)
  cohérent, plus de saut de largeur aux frontières de Voronoï.
- `build()` idempotent + `dispose()` complet.
- `makeOceanDisc` : farR est désormais VRAIMENT le rayon extérieur (l'ancien
  `nearR·t + farR·t⁵` débordait de 844 u) ; `CAMERA.far` dérivé du pire cas
  caméra (maxDistance + bord océan) ≈ 7091.
- Enveloppe nuages dérivée de `CAMERA.maxDistance` (×1.18/×0.82/×1.08),
  tiers +1 rangée/colonne pour tenir la densité.
- **`test/invariants.html`** : 8 assertions numériques, console
  `INVARIANTS: 8 pass, 0 fail`. Leçon de test : un transect à la jonction
  traverse LÉGITIMEMENT jusqu'à 3 chenaux — compter les bandes (> 3 = trou),
  pas les ré-entrées.

**Textures.** Doctrine préservée (zéro image) : `detailtex.js` génère des
bump maps en bruit de valeur PÉRIODIQUE seedé (le bruit lib ne tile pas — un
lattice enveloppant si). Terrain : bumpMap grain (repeat 96) + octave fine +
STRATES sur pente forte (falaise ouest) ; rochers : grain minéral + veines en
position-monde (par fragment, instance-safe) ; bois pont/torii : veinage
anisotrope (UV conservés dans makeToriiGeometry — les primitives en ont
toutes) ; chemin : speckle position-monde (le ruban n'a pas d'UV).

**Perf (indicatif, M4 Max, ultra)** : 41–64 fps selon la vue (64 aérien midi,
~41 au sol près du pont) avant Phase C ; cold start ultra ~20 s, low < 8 s
(terrain 320²). Matrice complète par tier : à faire proprement (les mesures
rAF sous CDP sont faussées par l'étranglement d'onglet en arrière-plan —
piège n°8).

---

## Session « immersion » du 28/07 (nuit) — pipeline multi-agents

Première vraie passe du pipeline d'équipe (AGENTS.md « Rôles ») : specs par
agents de conception parallèles → briefs chirurgicaux → **Grok 4.5 écrit** →
Claude review/vérifie/committe → **Codex sol (high) en revue adversariale**.
Sept chantiers (commits 837e8f2..398087b) :

1. **Physique du pont** : `bridgeDeckHeightAt/NormalAt` sur l'api rivière
   (l'arche reste privée au pont), `passable()` du shiba court-circuite eau et
   pente à hauteur de tablier, garde-corps par refus glissant, empreintes
   coupées sur les planches, sol composite `world.groundAt` réservé aux
   MOVERS (chien + caméra) — les scatters restent sur `heightAt`.
2. **Eau v2** : profondeur RÉELLE lue du heightfield baké (surface − lit
   creusé) → couleur/alpha/écume de rive/bras du delta ; lit sable-galets
   recoloré via `riverBedFactor` (island importe river — l'inverse est
   INTERDIT, cycle ESM avec TDZ) ; chaque bord de ruban MARCHE jusqu'à sa
   ligne d'eau ; cascades blanchies par ratio de dérivées (fwidth brut
   écumerait toute l'eau lointaine en incidence rasante) ; source rétrécie
   (widthK 0.35→1 sur t 0–0.10) naissant dans un récif de rochers authorés à
   ZÉRO tirage rngRock ; `waterSurfaceYAt` interdit de marcher sous la nappe.
3. **Hanami** : 1867 arbres, floorY par archétype dans l'intégrateur de
   croissance, bois-le-plus-bas par secteur d'azimut baké par prototype et
   testé contre le terrain au placement, canopées chevauchantes (0.60).
4. **Herbe joueur** : uPlayer + traîne qui lague (sillage), poussée radiale en
   vecteur rotation sommée au vent, squash vertical. 3.17 M brins, fondu
   240/330, lo-LOD aminci (le POP venait de l'écart de largeur hi/lo).
5. **Pétales** : spawn à hauteur de canopée réelle (le « ça tombe du ciel »
   était un plafond global de 46 u), lancement horizontal porté par le vent,
   tapis statique 39.6k sous les couronnes (cut-out opaque, uniforms
   partagés), 65k en l'air.
6. **Lotus** : fleurs dressées vertex-colorées dans la frange peu profonde
   hors budget d'excursion des koi ; nénuphars −35 %.
7. **Shiba** : yeux sortis du crâne (ils étaient modelés SOUS la surface du
   sweep) + glint ; phase de queue INTÉGRÉE (sin(t·wag) à wag variable balaye
   à wag + t·dwag/dt → frénésie exactement à l'arrêt après une course).

**Leçons d'orchestration payées cash :**
- Tuer un run d'agent codeur puis `git checkout` pendant que le run suivant a
  DÉJÀ LU les fichiers = le second croit les éditions « déjà présentes » et
  ne les réapplique pas → trou silencieux (ReferenceError au boot). Toujours
  reset AVANT de relancer, jamais entre lecture et écriture.
- Le clamp de berges échantillonné à +1 u du ruban tombe DANS le bol de carve
  (sol ≈ lit) → il a plaqué toute la surface sur son propre lit : nappe
  d'écume pâle uniforme + murs d'eau à chaque creux. Échantillonner à +3 u.
- Diagnostic shader express : forcer un uniform en rouge vif tranche en une
  frame entre « pipeline cassé » et « tuning terne » (ici : tuning — le
  fresnel rasant délavait un uDeep désaturé).

Revue adversariale Codex de la passe : voir `ADVERSARIAL_REVIEW_CLAUDE.md`
(section ADV-2026-07-28-398087B).

---

## Session « polish joueur » du 28/07 (fin de nuit)

Cycle complet du pipeline : polish3 (pétales 0.22-0.85, lit sable/gravier/
roche + galets immergés, micro-houle vertex sur l'eau, saut du chien Espace +
vitesses x2, pause sur P), chemin organique (lacets authorés + perturbation
fbm du tracé — index/ruban/torii RE-échantillonnés depuis la même courbe
perturbée, largeurs par côté décorrélées, bord rongé par cutout aPathEdge,
terrasse d'observation au rim avec lanternes, premier torii à t=0.02), et
revue adversariale ADV-2026-07-28-398087B via le skill codex:adversarial-review
(5 findings : 4 traités dont ~330 Mo de heap morts rendus par
keepBlossomSamples:false et la cohérence cap/rejet du relèvement hanami à
0.65 ; 1 rejeté avec justification — bilinéaire vs triangles du terrainH).
Dette notée : cross-fade hi/lo par chunk d'herbe (mitigé par lodKeep 0.62),
smoothstep GLSL inversés pré-existants (8+, lot dédié), cap de FPS pour les
ventilateurs (non fait).

---

## Session « rivière v3 » du 29/07 — la contention, enfin juste

Trois formulations du clamp de niveau d'eau, trois leçons :
1. `max(berges)` : l'eau fuit PAR-DESSUS la berge basse sur tout dévers →
   nappe de verre flottante (la capture du joueur).
2. `min(sol à offset fixe)` : sur dévers le sol à 9 u est déjà en contrebas →
   la rivière se vide en flaques.
3. **La bonne : la CRÊTE DE DIGUE par côté** — max du sol le long du rayon de
   berge (5 échantillons de halfW+0.5 à halfW+0.85·bank), puis
   `min(crêteL, crêteR) − 0.10`. Bief symétrique : crête = haut de berge
   naturel → eau profonde conservée. Dévers : crête = rebord du bol avant la
   descente → filet contenu et continu. C'est l'équivalent côté profil du
   « terrain conformé à la spline » des outils de rivière (Unreal/Waterways).
La rivière se traverse désormais à gué (blocage supprimé, ralenti ×0.55 dans
l'eau), les rides sont étirées ~4:1 dans le sens du courant, et l'invariant
n°9 verrouille la contention (zone d'épinglage de jonction exemptée, comme le
clamp). INVARIANTS: 9 pass, 0 fail.

---

## Session « rivière v4 » du 29/07 — abandon du monotone global

La v3 a tenu une soirée : captures du joueur = **trous** (tranchée de sable
sèche en plein cours) ET **eau volante** persistante. Diagnostic — les deux
symptômes sortaient du même axiome faux, le profil « jamais-remonter » :

- Le lit (carve RELATIF au terrain) **ondule**. Un profil d'eau monotone
  au-dessus d'un lit qui remonte passe forcément SOUS le lit : toute selle
  basse propageait son niveau à tout l'aval → tronçons à sec. Aucun clamp ne
  répare ça : **le monotone global est insoluble, il fallait le supprimer.**
- Le ruban s'arrêtait à largeur fixe et reculait « juste avant » la berge →
  bord pendu au-dessus du bol creusé.

**v4 (recherche : Waterways/Godot, Unreal Water, Simonschreibt)** — l'eau
épouse le terrain, tout est LOCAL, aucune propagation :
1. Par station : `surface = lit + 0.72·depth`, plafonnée `min(crêtes) − 0.10`,
   **plancher `lit + 0.12` (le plancher gagne)** → un trou est impossible par
   construction. Remontée de nappe bornée à 0.12/station (plancher conservé :
   un lit qui grimpe porte un film de rapide, écumé par la cascade fwidth).
2. Ruban : bisection jusqu'à la **vraie ligne d'eau** puis bord poussé 0.30
   DANS la berge + **jupe** (4 colonnes/station, rabat −1.35 u) qui comble les
   creux entre stations → un bord volant est impossible par construction.
3. Banc d'essai réécrit : « jamais sous son lit », « remontées de nappe
   bornées », contention locale sur les MÊMES rayons que build (`widthKAt`
   exporté lecture seule). **INVARIANTS: 10 pass, 0 fail.**

Vérifié en scène : bief du pont plein et contenu, 14 sondes de chenal sans
trou (profondeurs 0.17–3.13 u), delta 3 bras, haut cours propre. Leçon à ne
pas re-payer : quand deux bugs opposés (eau dessous / eau dessus) résistent à
trois clamps, c'est l'axiome commun qui est faux, pas les seuils.

**Suite (même jour) — l'éventail du delta.** Capture du joueur au couchant :
tabliers blancs volants au split. Diagnostic chiffré : 61 stations dont l'eau
se tient jusqu'à +3.1 u au-dessus du « rebord bas » — mais ce rebord est la
TRANCHÉE du bras voisin (trois chenaux creusent une auge commune) ; la marche
de ligne d'eau ne trouvait jamais de sol qui remonte et laissait le bord pendu
à pleine largeur, jupe de 1.35 u en étendard au-dessus du vide. Trois fixes :
1. Bord **drapé** : quand aucune berge ne remonte sur tout le couloir, le bord
   est posé au sol (sol+0.08) — l'eau verse le long de la pente au lieu de
   flotter. 2. Jupe plongée sous le sol LOCAL (plus de profondeur fixe).
3. `aSkirt` sur jupes et bords drapés : écume cascade (fwidth sature sur une
   face verticale), spéculaire et fresnel coupés — sinon lignes blanches
   géométriques à travers l'eau du voisin. La marche couvre désormais TOUT le
   couloir creusé (le wobble de largeur raccourcissait la recherche et laissait
   des bords en l'air sur berge saine).

**Suite 2 (même jour) — « moche, déborde, pas naturelle ».** Quatre passes en
cascade, chacune révélée par la précédente :
1. Marcher sur tout le couloir (0.9·bank) faisait s'étaler la nappe en
   cellophane sur 40 u (herbe à travers l'eau — l'exclusion suit la largeur de
   chenal). Empreinte restaurée à chenal+0.45·bank, wobble compris.
2. Crête « sol SEC uniquement » : un rayon dans le chenal mouillé du voisin
   mesure sa tranchée, pas une berge — le compter écrasait tout l'éventail en
   film invisible (« oued à sec » vu du ciel).
3. **Section de carve composée** (le vrai fond du problème) : le bol unique
   pow(u,1.7) étalait 4 u de creux sur tout le couloir → soucoupe plate sur
   les plats, où AUCUNE règle de niveau ne marche (crête proche = lavis de
   15 cm ; crête lointaine = tente drapée). Chenal net avec lèvre à
   ~1.15·halfW (70 % du creux) + évasement doux (30 %), crête échantillonnée
   SUR la lèvre → l'eau a un niveau à tenir et la ligne d'eau un sol qui
   remonte, par construction. Incision pleine sur la plaine basse (fondu
   d'estuaire 1.2 → 0.45).
4. Rendu au ras de l'eau : clapot en espace monde dans rides et normales
   (les UV de spline s'étirent sur 700 u — surface sans matière en incidence
   rasante), fresnel plafonné 0.12 (ciel blanc = cellophane), rampe de
   profondeur 1.2 + uDeep 0x1a7183 (la heightmap, texel 2-3 u, lisse la
   tranchée étroite et sous-estime la profondeur de moitié — diagnostiqué en
   forçant uDeep rouge à chaud).
Piège de vérif payé : une « eau pâle qui couvre tout » à hauteur de chien
peut être l'ENVERS de la nappe — vérifier `waterSurfaceYAt(x,z)` contre le y
caméra avant de conclure (deux fausses itérations sur ce fantôme).

**Suite 3 (même jour) — « pas profond », « flaque à la source », étalonnage
Ghibli.** Consigne utilisateur adoptée en mémoire : comparer chaque passe
visuelle à une référence en ligne. Écarts relevés (recherche d'images
« ghibli river ») : leur eau est un bleu saturé quasi opaque PLUS FONCÉ que
les berges, l'herbe descend à la ligne d'eau, pas de tablier de sable géant.
1. **Le voile laiteux, enfin élucidé** : le flag `aSkirt` d'un bord drapé
   (0.85) s'interpole à travers TOUTE la nappe (2 colonnes intérieures
   seulement) → chaque bief à bord drapé perdait ~30 % d'alpha sur la moitié
   de sa largeur. C'était LE « délavé » qui survivait à tous les réglages de
   couleur. L'alpha ne dépend plus de vSkirt (seuls écume/spec/fresnel sont
   coupés), flag drapé à 0.5.
2. Couleurs étalonnées Ghibli : uShallow 0x4fc4c4, uDeep 0x1e6f97, alpha
   cœur 0.92 ; tablier de lit resserré (riverBedFactor 0.45→0.26·bank).
3. **Nage** (shiba.js) : dès que le sol est à plus de 0.85 sous la surface,
   le chien perd pied et flotte à surface−0.85 (avant : il marchait au fond
   en scaphandrier — « il a pied partout » = aucune profondeur perceptible).
4. **Vasque de source** (widthKAt tronc) : né à 0.35× la largeur, le chenal
   était plus étroit que le pas de la grille → bake lissé en flaque. La
   source naît en vasque pleine largeur, se resserre en goulet (0.55), puis
   largeur de croisière.
Piège de vérif : en camMode « orbit », l'update du shiba est GELÉE — toute
mesure console de sa physique (nage, saut) doit se faire en caméra suivie,
sinon on lit des instantanés figés en plein lerp.

---

## Session « exit la rivière, place aux chemins » du 29/07 (après-midi)

Décision utilisateur après cinq itérations d'eau : « enlève la rivière et le
pont, tu n'arrives pas à faire un truc propre ». Exécution en deux chantiers
Grok :
1. **Excision** : river.js supprimé, carve = étangs seuls, inWater = étangs,
   birds.js réparé (il importait encore RIVER — crash au boot, repéré par
   Grok), toute la doc/commentaires nettoyés. Les étangs à koi restent.
   **Herbe partout** : plancher de densité 0.55 (patchFloor), masque de terre
   nue désarmé — les « m² sans un brin » étaient les clairières volontaires
   de la passe polish.
2. **Réseau de chemins** (`PATHS`, 3 routes depuis un carrefour de prairie) :
   la montée aux TORII (lacets éprouvés de l'ancien chemin, terrasse de la
   falaise ouest, rim rehaussé 8→12.5·H pour un vrai dénivelé de ~10 u),
   la boucle fermée des ÉTANGS, le chemin de la PLAGE. Lanternes GÉNÉRÉES le
   long des routes uniquement (quinconce, sautées si pente forte — consigne :
   plus de lanterne orpheline à flanc de falaise), cerisiers exclus de
   l'emprise (`isOnPath(x, z, 4)`). INVARIANTS: 7 pass, 0 fail.
Vérifié : boot sans erreur, vue aérienne (réseau lisible entre les étangs),
montée aux torii à midi, lanternes allumées et torii sous la Voie lactée à
23 h.

---

## Session « pétales calmés, forêt en gradient » du 29/07 (suite)

- **Pétales-toupies, le retour** : le tumble était multiplié par la rafale
  (`gust`, crête 2.6 × le curseur de vent) — en bourrasque tout tournait 3×
  trop vite. Facteur plafonné (`min(gust, 1.0) * 0.45`) : une rafale presse
  un pétale, elle ne le fait pas tourner. La leçon : tout facteur shader
  branché sur uWindStrength doit être borné, la crête de squall dépasse 1.
- **Gradient des cerisiers** (Grok) : plus un arbre sous h = 2.6 (sable et
  dunes) ; poids d'implantation à deux foyers — centre (0, −10)·L et coin
  falaise (−88, 0)·L — qui module l'ACCEPTATION (0.22 → 1.0) et l'ÉCHELLE
  globale (×0.82 → ×1.37, espacement et branches basses compris). Le budget
  inchangé se redistribue : lisières clairsemées d'arbres modestes, cœur et
  montée à la falaise denses et hauts.

---

## Session « polish sente + forêt monumentale » du 29/07 (fin d'après-midi)

Rafale de retouches sur retours joueur, dans l'ordre :
- **Sente foulée** : les « patchs verts en plein chemin » étaient le TERRAIN
  transperçant le ruban entre deux échantillons (drapé 3 colonnes à +0.08).
  → 5 colonnes, rehausse, empilement déterministe des routes au carrefour
  (liftBias par route) + liserés neutralisés aux départs (edgeK) pour une
  fusion propre. Extrémités ouvertes FUSELÉES ; terrasse effilochée via
  aPathEdge radial.
- **Herbe rase sur la sente** (grass.js `shortZone`) : plus une exclusion
  dure — densité 12 %, brins courts. Fleurs sauvages exclues du chemin.
- **Torii** : calés sur la hauteur du chemin au centre, piliers allongés
  (−1.8 sous la base), portique ×1.35.
- **Forêt monumentale** : arbres ×1.5, branches +40 %, blossomDensity 3.0
  ultra, pétales 15500 + tapis 9500 ultra.
- **Vent** : balancement des arbres ×2 (uBarkSway 0.34 / uBlossomSway 0.58) ;
  bourrasques à pétales (décollage du tapis plus facile, portage ×2 en squall).
- **Falaise rocheuse** : la couleur roche était calée sur WORLD.grassMaxSlope
  (0.62) alors que l'herbe réelle meurt à 0.38 → la bande 0.38-0.62 (la FACE
  de la falaise) restait verte et nue. Seuils réalignés (0.30→0.52).
Attention perf : ultra s'est alourdi — ~23 fps sur les vues chargées.

---

## Reste à faire, dans l'ordre

1. **Relire les trois nouveaux modules** (`ponds`, `birds`, `clouds`). Ils ont
   été écrits puis relus par des agents adverses, et ils tournent, mais
   personne ne les a encore jugés à l'œil dans la vraie scène à toutes les
   heures du jour. Vérifier en particulier les nuages à l'aube et au crépuscule.
2. **Les cerisiers.** Maintenant que la structure de branches se construit
   vraiment (voir #6), ils lisent comme un verger clairsemé plutôt que comme un
   nuage rose. C'est une question de goût, pas un bug : les leviers sont
   `blossomDensity` dans `main.js` et `size` par archétype dans `sakura.js`.
   Grossir les fleurs remplit une couronne plus vite que d'en ajouter.
3. **Bande grise au zénith** quand la caméra pique vers le bas : c'est la bande
   de brume d'horizon de Preetham vue de près. Cosmétique, mais à surveiller.
4. **Peaufinage** — ombres portées des nuages sur l'île, rayons crépusculaires,
   son (le module oiseaux expose déjà `onEvent` pour les cris).

---

## Pièges de débogage propres à cet environnement

1. **`OrbitControls.update()` repositionne la caméra même quand `enabled` est
   `false`.** Toute caméra placée à la main est écrasée à la frame suivante.
2. **`preserveDrawingBuffer` est `false`** : une capture d'écran prise pendant
   que la boucle rAF est arrêtée saisit un tampon vidé. Rendre la boucle avant
   de capturer.
3. **Un onglet en arrière-plan** étrangle `requestAnimationFrame` **et**
   `setTimeout`. Pour simuler du temps, épingler `__sk.clock.getDelta` et
   appeler `__sk.frame()` en boucle synchrone.
4. `globalThis.__sk` expose `{ world, scene, camera, renderer, controls, THREE,
   frame, setCamMode, clock }`.
5. **L'enroulement des triangles contre l'attribut `normal`.** Ce projet s'est
   fait avoir QUATRE fois : le disque d'océan, la corolle des fleurs, les ailes
   des oiseaux, et le ruban du chemin (invisible en silence sur un matériau
   `FrontSide` — diagnostiqué en le forçant en rouge puis en `DoubleSide`).
   Sur un matériau `DoubleSide`, three inverse la normale d'ombrage
   pour la face arrière ; si l'enroulement géométrique regarde vers le bas alors
   que l'attribut dit vers le haut, la surface est éclairée par en dessous et
   sort noire — sans aucune erreur, avec tous les uniformes corrects.
6. **`instanceColor` sans `vertexColors: true`** ne fait rien : le chunk
   `color_fragment` de three est gardé par `USE_COLOR` seul, donc la couleur est
   téléversée, multipliée dans l'étage sommet, puis jamais lue. Il faut les deux,
   plus un attribut `color` blanc sur la géométrie.

## 2026-07-29 — Des fleurs de cerisier, pas des confettis (suite tapis hanami)

Consigne joueur : « ça devrait être des fleurs de cerisier, pas juste un truc
rose ; trop grosses, il en faut plus mais moins grosses — arbres, air, sol ;
trop coincées dans l'herbe. »

- **sakura.js** : blossom.size ×0.55 sur les 5 archétypes (à l'échelle d'arbre
  ×1.5-2, 0.46 auteur ≈ 1 m monde = blob), spread ×0.85 ; blossomDensity
  main.js 3.0→3.6 ultra. Mesuré : 23.5 M fleurs (20.2 M avant), couronnes
  toujours pleines en vue large.
- **petals.js** : silhouette factorisée SAKURA_SHAPE_GLSL (pétale échancré OU
  corolle 5 lobes, même math que la rosette d'arbre) ; attribut aShape sur les
  2 meshes — 12 % de corolles en l'air (tumble ×0.65), 40 % au sol ; cœur rose
  soutenu radial sur les corolles. Tailles air ×0.67, sol ×0.6. Tapis perché
  0.25-0.70 (haut de l'herbe, était 0.06-0.42 = « coincé ») et posé au sol sur
  les chemins (option onPath) ; heightAt = world.groundAt (sinon les pétales
  passaient SOUS le ruban des chemins).
- **Tapis anti-paillettes** : le ShaderMaterial ne reçoit pas la shadow map →
  plein soleil sous sa propre couronne = tout brûlait en blanc. Part de soleil
  bakée PAR INSTANCE (distance au tronc + jitter tacheté) dans aTintAge.z :
  rose à l'ombre, étincelant à la lisière. Palette rosée (#f5dfe4/#efb3c4),
  skew teinte 2.4→1.7.
- **config.js** : petals 19000, fallenPetals 34000 (·AREA_SOFT) ultra —
  mesurés 107.5k en l'air, 192.4k au sol.
- Vérif : node --check ×4, invariants 7/7, visuel midi gros plan + vue large.
- **Piège navigateur** : onglet MCP caché ⇒ rAF gelé (0 frame), captures =
  frame PÉRIMÉE (l'aube éternelle). Parade : piloter la boucle à la main —
  `for(i…) __sk.frame(performance.now()+i*16)` rend même onglet caché, puis
  screenshot. Le HUD horloge peut rester en retard (throttlé), foi aux uniforms.
- Grok CLI déconnecté (auth.json absent) → chantier codé par Claude sur brief
  écrit ; relancer `grok login` avant le prochain chantier.

## 2026-07-29 — Prairie sans jaune, couronnes en grain fin (soir)

Consigne joueur : « encore des feuilles au sol qui ne viennent pas d'un
cerisier » (= les fleurs sauvages jaunes) ; fleurs des ARBRES ÷2 en taille,
×2 en nombre.

- **details.js** `FLOWERS` : palette passée en tons hanami — buttercup
  0xf5c93f/0xd99a1e (jaune/or) → 0xf2cfdd/0xdd9db8 (roses), cœur daisy
  0xe8c25c (or) → 0xf2e3cf (crème). Le jaune à hauteur d'herbe lisait comme
  des feuilles mortes sur le tapis rose. Distribution/poids inchangés.
- **sakura.js** : blossom.size ÷2 sur les 5 archétypes (≈7-13 cm monde),
  blossomDensity main.js ×2 (ultra 3.6→7.2, high 2.8→5.6, low 1.9→3.8).
  Mesuré ultra : **48.0 M fleurs** (23.5 M avant).
- **PIÈGE PAYÉ — mur GC du bake blossoms** : le bake monde poussait ~150 M
  de doubles dans des tableaux JS ordinaires (`push` par bucket). Au-delà de
  ~16 M d'instances le tas V8 (~2 Go) part en GC-thrash : boot ultra passé de
  ~40 s à PLUSIEURS MINUTES de thread bloqué (onglet «gelé», CDP timeout).
  Correctif : deux passes — comptage par bucket (`Int32Array`), puis écriture
  au curseur dans des `Float32Array` pré-alloués, branchés tels quels dans les
  `InstancedBufferAttribute` (zéro copie). Boot ultra revenu ≈ 40 s.
- Vérif : node --check ×3, invariants 7/7, visuel midi (prairie zéro jaune,
  pâquerettes crème + boutons roses + campanules mauves ; couronnes = masses
  de petites corolles individuées). fps ultra à confirmer sur machine cible :
  48 M de quads instanciés, si trop lourd le seul knob est blossomDensity.

## Session « automne momiji — clôture » du 29/07/2026

Travail finalisé dans le worktree `feature/autumn-momiji` :
`/Users/fourreto/Projects/vibecode/sakurajima/.worktrees/autumn-momiji`.
Le printemps reste le défaut. Le résolveur `season` applique la priorité
URL → `localStorage` → `spring`, et le sélecteur persiste le choix puis
recharge la scène afin que toutes les données de construction restent
cohérentes.

- **Forêt et feuilles** : les couronnes momiji remplacent les fleurs dans le
  pipeline partagé, avec silhouette maple et nervures dans les shaders ;
  dominantes déterministes rouge, orange, jaune et vert, palettes ombre/
  milieu/soleil interpolées en linéaire. Les mêmes profils alimentent les
  feuilles en vol et le tapis, avec la silhouette et la couleur autumn
  partagées, sans seconde forêt ni draw call supplémentaire.
- **Environnement** : profil autumn appliqué au sol, à l'herbe, aux fleurs,
  aux étangs/lotus et aux pigments de l'océan, sans déplacer les scatters.
  Le ciel, la lumière et le brouillard sont réchauffés le jour et à la golden
  hour ; la lune, le dôme nocturne et les étoiles restent bleus. Le brouillard
  et le ciel partagent l'horizon publié, sans couture mer/ciel.
- **Correctifs visuels finaux** : `e0eb773` corrige les nuits autumn trop
  sombres et la couture mer/ciel ; `a920146` corrige les compteurs HUD invalides
  du compositeur. La relecture visuelle ciblée est approuvée.
- **Validation exacte** : `SEASON: 8 pass, 0 fail` ; `FOLIAGE spring: 5 pass,
  0 fail` ; `FOLIAGE autumn: 5 pass, 0 fail` ; `GROUND: 34 pass, 0 fail` ;
  `ATMOSPHERE: 37 pass, 0 fail` ; `INVARIANTS: 7 pass, 0 fail`.
- **Matrice visuelle** : les six combinaisons `spring|autumn × low|high|ultra`
  ont été parcourues, à midi et de nuit ; autumn ultra a aussi été vérifié à
  la golden hour. Les contrôles ont couvert silhouettes, dominantes, chute et
  tapis, terrain/étangs, horizon, ciel nocturne, lanternes, chemins, torii,
  ombres et absence d'arbres sur l'eau ou les chemins.
- **Performance** : observation comparative à qualité égale — une forêt, un
  mesh aérien et un tapis dans les deux saisons ; `keepFoliageSamples` reste
  désactivé et les dominantes n'ajoutent ni matériau ni draw call. Aucun pic
  continu n'a été observé dans le HUD ultra/profiler pendant la matrice.
- **Outils** : Grok CLI était non authentifié et `codex-rescue` a échoué au
  démarrage du modèle ; les implémentations et revues de repli déléguées ont
  donc été utilisées. Ces limitations sont consignées pour éviter de présenter
  la provenance des passes comme une exécution réussie de ces outils.

## Session « vérification post-fusion automne » du 30/07/2026

Relecture de la fusion `d767222` (branche `feature/autumn-momiji` → main,
précédée de `692cc18` qui hisse les constantes de ciel côté main pour éviter
le conflit). Aucun code modifié.

- Analyse : fusion propre (aucune constante dupliquée dans `sky.js`),
  contrat de saison conforme (résolution URL → localStorage → spring avant le
  boot, saison passée à la construction de chaque système, sélecteur qui
  persiste puis recharge — même patron que la qualité).
- Vérif : `node --check` sur tous les `src/*.js` ; `INVARIANTS: 7 pass,
  0 fail` ; visuel `?season=autumn` — midi (forêt momiji rouge/orange/jaune,
  ombres, horizon sans couture, 91 fps), nuit 0.97 (dôme et étoiles restés
  bleus, terre lisible, lanternes allumées le long du chemin, lune avec halo),
  golden hour 0.74 (brouillard chaud partagé mer/ciel sans couture). Sélecteur
  aria-pressed correct, zéro erreur console.
- Rappel piège n°8 payé à nouveau : onglet Chrome en arrière-plan = rAF
  étranglé — l'heure ne bouge plus ; forcer des frames via `__sk.frame()` en
  boucle pour les captures pilotées par CDP.

## Session « PLAN à jour + passe visuelle multi-heures ×2 saisons » du 30/07/2026

Deux tâches convenues avec l'utilisateur, aucune modification de code.

- **PLAN.md remis d'aplomb** : suppression de `src/river.js` du tableau (la
  rivière n'existe plus depuis le 29/07), ajout de `details/detailtex/season/
  seasonal-foliage`, mention des deux saisons et des bancs d'essai, item
  « verger, pas nuage rose » retiré (traité le 29/07), items renumérotés.
- **Passe item 2 (ponds/birds/clouds à toutes les heures, ×2 saisons)**,
  heures visitées : 0.24/0.26 (aube), 0.5 (midi), 0.74 (golden), 0.80
  (coucher), 0.86 (crépuscule), 0.95-0.97 (nuit). Trouvailles :
  - **BUG VISUEL — couture mer/ciel au coucher (0.80), deux saisons** : mer
    saumon uniforme contre ciel bleu nuit, ligne rasoir pleine largeur. OK à
    midi/golden/nuit. → PLAN item 1.
  - **Nuages marron sale au crépuscule**, deux saisons. → PLAN item 2.
  - Halo solaire géant brûlé au lever/coucher bas : état de base commun aux
    deux saisons, pas une régression automne. Choix d'AD à trancher.
  - Étangs printemps golden hour : eau kaki plate (l'aube automne lilas est
    belle). Goût, pas cassé.
  - Perchoir nocturne des oiseaux : OK. Après un saut d'horloge vers la nuit,
    ~1 min simulée de convergence (32→25 en vol sur ~13 s) — artefact de test.
- **Item 1 soldé** : fps ultra printemps mesurés ≈40 en vue large ET au sol
  (frames forcées via `__sk.frame()`, onglet en arrière-plan) — conforme au
  «~41 fps ultra M4 Max» d'AGENTS.md, les 48 M de fleurs ne coûtent rien de
  plus. Automne nettement plus léger (91 fps vue large).
- Méthode captures onglet non focalisé : boucle `while` sur `__sk.frame()`
  ~1 s puis screenshot CDP ; le HUD fps est alors non représentatif, mesurer
  en frames/seconde de la boucle.

## Session « feedback automne + backlog chantiers » du 30/07/2026 (soir)

Feedback joueur en rafale (5 captures) → backlog consigné dans PLAN.md,
section « Chantiers ouverts du 30/07 » : C chemins (perforations vertes =
terrain à travers le ruban + jonction carrefour), E autel hokora divinité
canine en haut de la falaise, A couronnes momiji dégarnies + branches
basses, B tapis de feuilles (densité/silhouette/vert interdit au sol),
D perf/LOD. Détails et ancrages de code dans PLAN.md — c'est la source.

- Outillage : Grok CLI toujours non authentifié ; **codex-cli 0.145.0 prêt
  et authentifié** (vérifié via codex:setup) — consigne utilisateur :
  déléguer l'implémentation à Codex gpt-5.6-sol (sous-agent codex-rescue)
  pour préserver le quota du modèle principal (passage en Opus prévu,
  quota Fable hebdo presque atteint).
- Chantier C lancé le premier (avant la consigne Codex) sur agent de repli
  Claude — laissé se terminer pour ne pas jeter les tokens déjà dépensés.
  Review Claude + invariants + visuel exigés avant commit, comme toujours.

## Chantier C livré — chemins : perforations + carrefour (30/07/2026 soir)

Implémentation : agent de repli Claude (lancé avant la consigne Codex).
Review Claude complète : diff relu, node --check OK, `INVARIANTS: 8 pass,
0 fail` dans Chrome réel, visuel midi automne (carrefour fondu en clairière
unique, zéro perforation, zéro marche, pointe de fin de plage conservée).

- **Anti-perforation DÉFINITIF** : les rubans et le patin échantillonnent
  `groundMax` (max de `heightAt` sur ±1.5 u, grille 7×7) par sommet — toute
  combinaison convexe des sommets domine les crêtes du terrain quel que soit
  le tier. 7 colonnes, pas axial ~0.7 u, lift RÉDUIT (0.06→0.12 bombé,
  biais 0/0.02/0.04) : zéro perforation avec un relief moindre.
- **Builders purs exportés** `computeRibbonMeshes` / `computeJunctionPad`
  (details.js), consommés tels quels par createDetails ET par le nouvel
  invariant 8 (échantillonnage barycentrique de chaque triangle, marge min
  0.057 mesurée) — le banc teste la géométrie exactement rendue.
- **Carrefour** : plus de pincement de départ des routes ouvertes (pleine
  largeur à t=0), patin de terre battue fbm (rayon width×1.6) posé à 0.04
  SOUS l'étage le plus bas des rubans. Lanternes/`isOnPath`/`PATHS`
  intacts.
- Reste à surveiller en jeu : l'enfoncement des pattes du shiba sur la jupe
  externe du patin (≤ ~4 cm théorique), l'herbe haute qui traverse la jupe
  (lit comme des touffes de berge, acceptable à la review).

## Régression chantier C corrigée + chantier E livré (30/07/2026 nuit)

- **RÉGRESSION C (« je glitch à travers », capture joueur)** : le ruban étant
  passé sur `groundMax`, en pente sa surface s'éloigne de `heightAt` (~1 u) ;
  or le sol composite des movers restait `heightAt + 0.13·prox` ET le shiba
  recevait en fait `heightAt` BRUT (incohérence préexistante masquée tant que
  le ruban collait au sol). Correctif (Claude, micro-retouche) :
  `pathSurfaceLiftAt(heightAt,x,z)` exporté par details.js — suit la vraie
  surface (groundMax + bombé 0.04→0.12 par proximité, patin fondu au
  pourtour) ; branché dans `world.groundAt` ET passé à `createShiba`.
  Vérifié : shiba posé sur la montée aux torii (rise 0.37 absorbé),
  invariants 8/8. `PATH_SURFACE_LIFT` reste exporté mais n'est plus utilisé.
- **Chantier E (Codex sol, effort high — premier chantier Codex réussi)** :
  hokora de pierre procédural (marches, maisonnette, toit à deux pans,
  ouverture sombre, 117 tris) + deux gardiens canins assis à bavoir/collier
  vermillon (349 tris chacun) au bout de la route 'torii', posés sur la
  terrasse falaise, face à l'arrivée du chemin, passage central 1.5 u.
  Déterministe (aucun RNG), vertex colors + flatShading, disposables OK.
  Review Claude : diff relu, node --check, invariants 8/8 Chrome réel,
  visuel terrasse (rien ne flotte, lanternes intactes, très joli face à la
  mer). Codex n'avait pas accès réseau au serveur — vérifs faites par Claude.

## Chantier A livré — arbres automne (30/07/2026 nuit, Codex sol)

- foliageDensity automne 2.1/1.7/1.2 → 3.6/2.8/2.0 (printemps intact),
  taille des feuilles maple +15 % sur les 5 archétypes.
- Branches plongeantes REDRESSÉES (pas supprimées — déterminisme du flux
  RNG préservé, aucune consommation ajoutée/retirée) :
  `levelPlungingDirection` plie toute direction sous y<-0.35 vers
  l'horizontale (smoothstep), et les pointes FEUILLUES sont garanties à
  ≥1.1 u au-dessus de la base du tronc (`raiseDirectionY` sur les derniers
  segments). S'applique aux deux saisons (structure partagée, voulu).
- Review Claude : diff relu (smoothstep importé, ctx.leanDir existant),
  node --check ×2, visuel automne (couronnes pleines, plus de branches dans
  l'herbe, ~71 fps) et printemps (silhouettes préservées, ~64 fps même
  cadrage). Codex sans accès réseau : vérifs navigateur par Claude.

## Chantier B livré — tapis de feuilles (31/07/2026 ~0h, Codex sol)

- Tapis automne ×2.5 (480 928 instances ultra mesurées), tailles 0.34-0.62,
  quad élargi ×1.28 + cut-out 0.45→0.35 : la silhouette maple LIT au sol.
- Dispersion : exactement 34 % hors couronnes (quota décroissant, une
  décision seedée par instance, mêmes rejets eau/mer/pente ; buckets
  spatiaux pour le test « hors de tout disque de couronne »). Chemins
  couverts. Printemps STRICTEMENT inchangé (192 371 instances, roses).
- Plus AUCUNE feuille verte tombée ni en vol : remap green→yellow dans
  `autumnColor` (petals.js uniquement — les couronnes gardent leurs verts).
- Review Claude : diff relu (`half`/`WORLD.seaLevel` existants, ordre RNG
  printemps préservé), node --check, visuel automne (~139 fps, chemin
  jonché lisible, zéro verte) et printemps (identique à avant).

## PASSATION Fable → Opus (31/07/2026, quota Fable atteint)

État au moment de la passation :
- Chantiers C, E, A, B livrés/commités (756e0b2..8bcd892), reviews faites.
- **EN VOL : correctif C-ter** (« le chemin ne colle plus au terrain ») —
  tâche Codex `task-ms81whro-lz5x7c`, brief : remplacer la base `groundMax`
  des rubans/patin/`pathSurfaceLiftAt` par un RÉSIDU DE PLAN LOCAL
  (pente non payée, seules les crêtes le sont), + invariant chiffré
  d'ÉLÉVATION max (~0.55 u) en plus de l'anti-perforation. Statut/résultat :
  `node ~/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs status|result task-ms81whro-lz5x7c`.
- Après review+commit de C-ter : lancer la REVIEW ADVERSARIALE de toute la
  série via le skill/commande du plugin `codex:adversarial-review`
  (le fichier de commande existe dans le plugin ; ne PAS appeler le CLI
  codex à la main). Rapport → ADVERSARIAL_REVIEW_CLAUDE.md, id ADV-…,
  table de suivi remplie au traitement.
- Vérifs type pour C-ter : node --check, invariants (8 pass + borne
  élévation), visuel pente de la route torii (ruban AU RAS du sol),
  carrefour, shiba posé ni enterré ni flottant, deux saisons non requises
  (details.js est asaisonnier).

## C-ter REJETÉ, C-quater livré — chemins collés au terrain (31/07/2026, Opus)

Reprise de la passation. Le correctif C-ter était livré mais **jamais mesuré** :
Codex l'avait écrit et validé `node --check`, puis son sandbox avait refusé
d'ouvrir un port pour le banc, et le job est mort avec la veille de la machine.
Piège d'outillage à connaître : **le champ `elapsed` du plugin Codex masque les
heures** — il affichait « 8m 26s » pour 8 h 26, et le registre de jobs a été
purgé au démarrage de la session suivante. Le rapport final se récupère malgré
tout dans `~/.codex/sessions/<AAAA>/<MM>/<JJ>/rollout-*-<threadId>.jsonl`.

### La review a rejeté C-ter — il échouait son propre invariant

|                    | marge min | élévation max | plafond |
|--------------------|-----------|---------------|---------|
| C-ter @tier low    | 0.032 ✓   | **0.932** ✗   | 0.55    |
| C-ter @tier ultra  | 0.026 ✓   | **1.108** ✗   | 0.55    |

Trois causes, toutes mesurées, pas déduites :

1. **La grille de sondes est un CARRÉ de demi-côté R, pas un disque.** Ses coins
   portent à R·√2 = 1.70 u pour une sonde annoncée à 1.2. Au point coupable le
   résidu maximal était atteint exactement au coin (−1.2, −1.2). Restreindre au
   disque faisait tomber l'élévation de 0.932 à 0.634 — mieux, toujours hors
   plafond.
2. **Le résidu paie aussi la CONCAVITÉ.** Un sommet posé dans un creux voit ses
   voisins au-dessus de son plan tangent et se soulève — or un creux ne perfore
   jamais, la corde passe au-dessus. Structurel à la formulation, pas réglable.
3. **La précondition du garde-fou était fausse.** Mesurée pour la première fois :
   arête XZ max **1.530 u** sur le patin de carrefour, au-delà de la sonde 1.2
   ET de l'ancienne 1.5. Cause : le contour fbm du patin fait varier `rr` de
   0.74 u entre deux angles voisins. **Le carrefour n'a jamais été garanti,
   depuis `756e0b2`** — l'anti-perforation « définitive » reposait sur une
   précondition affirmée en commentaire et jamais vérifiée.

### C-quater : la formulation honnête

Abandon de toute sonde de voisinage. La contrainte réelle est locale au
triangle : son plan doit dominer le terrain sous LUI. `clearRibbonTriangles`
(details.js) pose les sommets collés (`y = heightAt + bombé`) puis relève chaque
triangle du déficit mesuré sur un treillis barycentrique (SB=5, marge 0.02), en
montant les TROIS sommets du même montant — ce qui translate le plan sans le
pencher, donc la passe est monotone et converge (≤ 2 passes mesurées, 6 max).

Conséquence directe : **plus aucune précondition de tessellation à tenir**. Un
maillage plus grossier se fait juste relever un peu plus. `RIBBON_PROBE_R`,
`ribbonRiseAt` et l'invariant de tessellation ont été supprimés avec la sonde.

`pathSurfaceLiftAt` redevient un **bombé pur** : le dégagement appartient aux
triangles et ne se rejoue pas par requête ponctuelle. L'approximation n'est plus
espérée mais bornée par un invariant.

Mesures finales, Chrome réel, **10 pass / 0 fail aux deux tiers** :

|       | marge min | élévation max | écart shiba |
|-------|-----------|---------------|-------------|
| low   | 0.023     | **0.199**     | 0.096       |
| ultra | 0.025     | **0.232**     | 0.098       |

Coût ~758 k appels `heightAt`, **moins** que les ~1.1 M de la sonde remplacée.
Visuel ultra à midi : montée aux torii au ras du sol sans liseré ni socle,
carrefour fondu en clairière unique, shiba quatre pattes sur la terre battue au
carrefour et sur la montée. Implémentation Codex sol effort high (Grok toujours
non authentifié, vérifié), review et vérifications Claude. Commit `ae2bd1c`.

### Le banc d'essai avait trois trous — comblés

- **Il ne bâtissait l'île qu'au tier low**, le terrain le plus LISSE (pas de
  grille ~4.6 u contre ~1.9 u en ultra) : le cas le plus facile. C'est ultra qui
  a fait tomber C-ter (1.11 contre 0.93). Le tier se choisit désormais par
  `?q=low|high|ultra`, défaut low pour garder un bake court. **Toute retouche de
  la géométrie des chemins se repasse en `?q=ultra`.**
- **Les claims étaient agrégés** dans un seul `check()` : un échec ne disait pas
  lequel avait cassé. Séparés en trois (dégagement, adhérence, fidélité).
- **La fidélité de `pathSurfaceLiftAt` à la surface visible n'était pas testée**
  du tout — c'est pourtant elle qui décide si le shiba est enterré ou flottant.
  Invariant ajouté, seuil 0.25, mesuré 0.098.

Leçon générale : les deux régressions de chemins ont la même signature — une
garantie géométrique affirmée en commentaire, jamais mesurée, et un banc qui ne
couvrait pas le tier réellement joué. Les invariants numériques valent ce que
vaut leur couverture.

## Review adversariale ADV-2026-07-31-6F5081A traitée (31/07/2026, Opus)

Un seul finding, en `high`, et il était **fondé** : `clearRibbonTriangles`
échantillonnait 21 points barycentriques fixes par triangle alors que `heightAt`
est linéaire par morceaux sur une triangulation CONNUE (`island.js:563-580`,
diagonale `fx + fz = 1`). Le vrai maximum de `heightAt − plan du ruban` vit sur
les arêtes de la grille du terrain, que le treillis ne touche pas — et
l'invariant rejouait le même angle mort avec un treillis plus grossier encore.

Contre-vérification Claude avant d'accepter le claim : vérificateur EXACT écrit
séparément (clipping de chaque triangle de ruban par les sous-triangles du
terrain, zéro échantillonnage), passé sur les 36 088 triangles réellement
construits.

| tier  | marge exacte, bande intérieure | marge exacte, TOUS triangles | marge annoncée par le banc |
|-------|--------------------------------|------------------------------|----------------------------|
| low   | 0.0230                         | 0.0230                       | 0.023 (exact)              |
| ultra | 0.0191                         | **0.0063**                   | 0.025 (**surestimé ×4**)   |

Le chemin ne perforait pas, mais la garantie n'était pas prouvée et la marge
réelle en ultra valait 1.26× le seuil au lieu des 5× annoncés. Le point qui a
tranché : le calcul exact coûte **~30 ms** sur l'ensemble des triangles — rien
ne justifiait de continuer à échantillonner.

Correctif (Codex sol effort high) : `island` expose `heightGrid = {seg, step,
half}` — contrepartie honnête du contrat « `heightAt` est la source de vérité
unique », qui doit raisonner exactement doit connaître la discrétisation.
`measureRibbonTriangleExact` (details.js, exportée) est partagée par le builder
ET par les invariants 8-9 : une seule implémentation, pas deux qui divergent.
L'échantillonnage subsiste comme repli sans `heightGrid`, documenté comme repli.

Après correctif, marge exacte sur TOUS les triangles : low 0.0230, **ultra
0.0200** (contre 0.0063) — soit exactement `RIBBON_CLEARANCE_MARGIN`, par
construction et non plus par chance. Élévation inchangée (0.2142 / 0.2331),
convergence 1-2 passes. `INVARIANTS: 10 pass, 0 fail` aux deux tiers, recoupés
par le vérificateur indépendant de Claude (mêmes valeurs, mêmes localisations).
Visuel ultra inchangé, 60 fps.

**Le motif est désormais établi, trois fois sur le même fichier** : une garantie
géométrique affirmée en commentaire et jamais mesurée. Sur les chemins, tout ce
qui prétend dominer le terrain doit être mesuré exactement, aux deux tiers,
avant d'être cru.

## Chantier D — performance sans perte de qualité (31/07/2026, Opus)

Question utilisateur : « peut-on aller chercher de la perf, sans réduire la
qualité graphique ? » Réponse : oui, **ouverture 15.4 → 27.8 fps (+81 %)**, sol
21.4 → 24.2, automne 59 / 49.3. Trois commits : `f558ee3`, `97cfc7f`, `0de1818`.

### D'abord : les chiffres du 30/07 étaient faux

Deux défauts de méthode, tous deux consignés en pièges 9 et 10 d'AGENTS.md :

- **`__sk.frame()` ne fait que soumettre à la GPU**, il ne l'attend pas. La
  boucle forcée annonçait **1413 fps**. Il faut resynchroniser par
  `gl.readPixels(0,0,1,1,…)` après chaque frame.
- **La caméra bougeait toute seule.** `OrbitControls.autoRotate` est actif au
  boot, et surtout `world.camMode` valait `'follow'` : le rig tierce personne la
  ramenait derrière le shiba à chaque frame. Elle **dérivait de 992 u** pendant
  un banc qu'on croyait cadré. Verrouiller `setCamMode('orbit')`, `autoRotate`
  et `enableDamping` à false, puis VÉRIFIER que la dérive est nulle.

Avec les deux, les mesures tiennent à ±0.3 fps. Sans, on écrit n'importe quoi
dans la doc — c'est ce qui s'était passé.

### Le diagnostic

Par extinction de chaque système : **la forêt est 88 %** du temps de frame en vue
large et **75 %** au sol. Rien d'autre ne pèse. 50 104 523 quads de feuillage
contre 7 M de triangles d'écorce.

Deux faits qui ont décidé de tout :
- **le coût est géométrique, pas fill-rate** : DPR 2 → 1 → 0.5 donne
  21.3 / 21.6 / 21.8 fps. Baisser la résolution ne rapporte rien — donc il n'y
  avait aucune qualité d'image à sacrifier, seulement des sommets à ne pas
  soumettre ;
- **le coût est linéaire en instances** : 100 % → 66.8 ms, 50 % → 39.9,
  25 % → 28.1.

### Les trois leviers

**B — buckets 6×6 → 16×16.** La granularité du bucketing EST celle du frustum
culling. Ouverture 15.4 → 16.3, sol 21.4 → 24.3. 24×24 testé : ça sature.
Aucun changement visuel, instances identiques.

**A — attributs 44 → 18 octets.** `aOffset` Int16×3, `aColor`+`aKind` fusionnés
en Uint8×4, `aParams` Uint16×4. L'astuce : la dénormalisation des offsets passe
par la transformation DU MESH (`mesh.position` = centre du bucket, `mesh.scale` =
demi-diamètre), donc le `modelMatrix * vec4(aOffset,1)` déjà présent fait le
travail et **la déclaration GLSL ne change pas**. 2 102 → 860 Mo de VRAM.
**Gain fps marginal (~1.5 %)** : sur cette machine le coût par instance n'est pas
la bande passante mais le vertex shader et le setup des primitives. Consigné tel
quel — le gain réel est la portabilité, pas le fps.

**C — éclaircissage par distance à couverture constante.** À l'ouverture, 100 %
des pétales sont à plus de 600 u et 63.7 % au-delà de 900 u, où un pétale fait
0.72 pixel. Garder une fraction `f` et grossir de `1/√f` conserve la surface
couverte (elle va comme le carré de la taille — ne pas « simplifier » en linéaire).

### Le piège que C a révélé, et qui vaut pour tout LOD par instanceCount

Réduire `instanceCount` ne prend qu'un **préfixe**. Les instances étant écrites
arbre par arbre, il faut mélanger — mais un Fisher-Yates **par instance** détruit
la localité de rasterisation. Mesuré en isolant le mélange de l'éclaircissage
(fraction forcée à 1) : **sol 24.6 → 20.2 fps (−18 %)**, ouverture inchangée.
Sous-pixel ça ne coûte rien ; dès que les pétales couvrent des pixels, ça se paie.

D'où le mélange par **blocs** (`FOLIAGE_SHUFFLE_BLOCK`) : un préfixe reste
uniforme à la granularité du bloc, chaque run garde sa localité. Bloc 256 rendait
le sol à 25.2 mais éclaircissait par paquets **visibles** (trous groupés dans les
couronnes) ; bloc 64 donne le même fps à l'ouverture et une canopée redevenue
indiscernable. C'est un curseur entre deux défauts opposés, pas un réglage libre.

### Le réglage retenu

Courbe mesurée à l'ouverture : min 1.00 → 16.8 fps, 0.60 → 23.7, 0.45 → 28.0,
0.30 → 34.5. **0.45 retenu dans un premier temps** : indiscernable de l'original en A/B direct, pour
+67 %. 0.30 double le fps mais lisse perceptiblement la canopée — écarté au nom
de la consigne « sans réduire la qualité graphique », et laissé à un caractère
près si le goût change.

Vérifications : instances 50 104 523 et arbres 1867 identiques à chaque étape
(rien n'est perdu au bake, l'éclaircissage est un choix de rendu) ; captures
comparatives au même cadrage avec LOD activé puis neutralisé à chaud ; gros plan
sous couronne identique (les couronnes proches sont à `f = 1` par conception) ;
automne vérifié. `getFoliageSamples()` rend toujours tout, le tapis n'est pas
affecté.

## Chantier S0 — découpe mécanique du shiba (31/07/2026, Codex)

`src/shiba.js` a été scindé : constantes et builders géométriques exportés dans
`src/shiba-geom.js`, comportement et empreintes conservés dans `src/shiba.js`.
`SHIBA_BUILD` porte le gabarit avant ; les longueurs arrière distinctes
0.06/0.28/0.25 et la construction existante du pad sont restées inchangées.
`SHIBA` est exporté et `main.js` consomme désormais `world.shiba.speedN`.

Syntaxe Node et comparaison mécanique ancien/nouveau : OK. Le banc navigateur
n'a pas pu être lancé dans le bac à sable : ouverture du port 5173 refusée par
l'OS (`PermissionError: [Errno 1] Operation not permitted`) et Chrome headless
quitte avec le code 134 avant de produire une sortie.

### Suite : `LOD_MIN_FRACTION` porté à 0.30 (même jour, arbitrage utilisateur)

Comparaison A/B à trois états produite au même chargement, même caméra, même
lumière — seul l'éclaircissage change : référence sans LOD (50.1 M pétales,
16.5 fps), 0.45 (22.5 M, 27.7), 0.30 (15.0 M, 33.8). Utilisateur : **0.30**.

Correction d'un jugement antérieur de cette session : le « 0.30 lisse
perceptiblement la canopée » avait été constaté avec `FOLIAGE_SHUFFLE_BLOCK = 256`,
qui éclaircissait par paquets. À 64, l'écart entre 0.30 et la référence est bien
plus faible que ce que cette première capture laissait croire — la granularité du
mélange pesait plus lourd dans le rendu que la fraction elle-même. À retenir pour
tout futur réglage : **régler le bloc AVANT de juger la fraction.**

Étalon final printemps ultra : **ouverture 33.7 fps** (contre 15.4 au départ,
×2.2), sol 24.6.

## Chantier shiba eau — requête unique et nage des étangs (31/07/2026, Codex)

Le shiba ne reçoit plus les anciens contrats `isInPond`, `seaLevel`,
`waterSurfaceAt` ni les restes du pont. `main.js` compose désormais un service
`water.surfaceAt(x,z,t) -> y|null` pour les étangs et la mer ; `ponds.js` expose
la ligne d'eau exacte, distincte de la marge vaseuse de `isInPond`.

Toute la locomotion aquatique dérive d'une profondeur unique : gué progressif,
nage hystérétique à 0.85 u, flottaison à surface − 0.85, laisse marine à −3 u.
La pose fondue ajoute assiette cabrée, queue-gouvernail, oreilles plaquées et
pagayage diagonal asymétrique (34 % moteur, antérieurs ×1.4). L'invariant de
flottaison est contrôlé au chargement : 0.66 × 1.35 = 0.891, soit 0.041 u de
dos émergé.

`node --check` : OK sur `ponds.js`, `main.js`, `shiba.js` et `shiba-geom.js`.
L'agent d'implémentation n'a pas pu lancer le banc navigateur dans son bac
(`serve.py 5174` → `PermissionError`, Chrome headless → code 134) et ne l'a pas
prétendu. **Vérification faite ensuite par Claude**, worktree servi sur 5174 :

- `INVARIANTS: 10 pass, 0 fail`.
- Centre du bassin le plus profond (`waterY 4.217`, lit `−0.177`) : profondeur
  `4.394`, `swimming` vrai, `position.y = 3.367` soit **exactement
  `waterY − 0.85`**. Dos émergé de `0.041`, museau hors de l'eau.
- Bande de gué mesurée sur le grand bassin (rayon 32.4) : **5.83 u de large**,
  de `0.99·r` (profondeur 0.046) à `0.81·r` (0.795) — environ 0.9 s de marche.
- Hystérésis : oscillation lente de ±0.004·r autour du seuil sur 80 frames →
  **0 bascule** de `state.swimming`.
- Prairie sèche : profondeur 0, `wading` et `swimming` faux.
- Contrôle visuel : il flotte dos affleurant et tête franchement dehors, pattes
  qui pagaient sous la surface ; 24 meshes, aucune géométrie sans attribut
  `color`, aucun éclairage inversé.

**Piège de mesure à consigner** : l'onglet en arrière-plan étrangle rAF *et*
`setTimeout` (piège 8), donc `state` reste figé après un déplacement du chien
depuis la console. La physique se mesure en appelant `__sk.frame()` à la main
dans une boucle avec une attente active (`performance.now()`), pas avec
`setTimeout`. Et `controls.minDistance` vaut **14** : approcher la caméra du
chien exige de l'abaisser, sinon `controls.update()` repousse la caméra
(piège 5).

## Chantier shiba silhouette — hooks de sweep et contrat de race (31/07/2026, Codex)

`sweep()` gagne deux points d'accroche et un correctif :

- **`o.profile(u, a)`** — multiplicateur de rayon par angle de section. C'est le
  levier unique du pelage : mèches périodiques `cos(6a)` et `cos(11a+3u)`
  fermées sans couture, appliquées seulement à la collerette (0.06), la culotte
  (0.05), le panache de queue (0.07) et la bavette (0.04). **Zéro sur les
  pattes** — une patte festonnée devient une chenille.
- **4ᵉ argument `p` du callback couleur** (point local du sommet), pour l'urajiro
  par zone de S3. À retenir : `upness` est dans le repère LOCAL de la pièce, ce
  qui ne coïncide avec le monde que parce que les pivots sont axés au build —
  toute pièce à pivot tourné (les oreilles déjà, la mâchoire de S2 demain) doit
  peindre depuis `p`.
- **Couture de normales recousue** : les sommets `s=0` et `s=radial` coïncident
  mais n'appartiennent qu'à un quad chacun, donc `computeVertexNormals()` leur
  donnait deux normales écartées de 25.7° (radial 14) — **un fil de lumière le
  long du flanc gauche**, invisible sous la lumière molle actuelle mais fatal dès
  qu'on ajoute du relief. Moyennées station par station.

Proportions mesurées, avant → après : garrot 0.9672 → 0.9731, longueur
1.0740 → 1.0704, **ratio 0.90053 → 0.90913** contre 10:11 = 0.90909 (écart
0.004 %). Museau/tête 42.6 % → **40.0 %**. Oreilles écartées de +16 %
(±0.125 → ±0.145) et inclinées vers l'avant (−0.32 → −0.46). Queue épaissie de
+16.7 % (0.150 → 0.175), attache et centreline conservées. Torse passé à
`radial 16` (+84 triangles).

`makeCoatBump(seed)` est exportée mais **pas encore branchée** : le `bumpMap` du
matériau se pose dans `shiba.js`, hors du périmètre de ce chantier. À faire avec
S3, avec `bumpScale ≈ 0.02`.

## Chantier ondes d'étang — le chien fait de l'eau (31/07/2026, Codex + Claude)

Le banc d'ondes concentriques existait déjà dans `ponds.js` mais n'était nourri
que par les koi, et son ring buffer était unique : brancher le chien dessus
l'aurait fait évincer les carpes. `RIPPLE_SLOTS` passe de 8 à 11, en **deux
plages disjointes à bornes littérales** — koi 0..7 avec leur curseur modulo 8,
chien 8..10 avec le sien modulo 3. Le quota devient structurel : aucun impact du
chien ne peut plus toucher un slot de koi, et l'invariant 15 le verrouille.

La boucle du chien est encadrée par `if (uDogWake.w > 0.0)` : hors de l'eau,
l'étang ne paie qu'une branche uniforme, pas trois itérations de plus par
évaluation — et `pk_surface` est évaluée **3 fois par fragment** (normale en
différences finies), donc chaque itération compte triple.

Le sillage n'est pas fait d'anneaux mais d'un terme analytique unique : capsule
2D entre la position et un point traînant (le patron `uPlayer`/`uPlayerTrail` de
`grass.js`, réutilisé tel quel), creux gaussien sous la coque plus bourrelet
clair au pourtour. Le liseré blanc est gratuit : le fragment transforme déjà
toute hauteur positive en crête claire.

**Réglage corrigé après mesure en jeu.** Première livraison : onde de patte à
0.075 d'amplitude (crête réelle 0.054 après le facteur de force) et sillage à
0.08. Or le clapot de brise ambiant de `pk_surface` monte à `0.010 + 0.052 ×
1.7 = 0.098` : l'effet était **sous le bruit de fond**, présent mais illisible.
Le diagnostic express du projet a tranché en une frame — `uDogWake.z` forcé à
1.2 depuis la console faisait apparaître le creux, donc pipeline bon, réglage
sourd. Relevé à **0.16** pour l'onde de patte (et nombre d'onde 12 → 9.5, car à
λ = 0.52 u les anneaux se referment avant d'être lus) et **0.22** pour le
sillage. Vérifié : le creux et son bourrelet se lisent à distance de jeu.

Chaîne d'émission vérifiée de bout en bout, touches clavier comprises : en gué
à 0.81 u de profondeur, deux ondes naissent aux positions des pattes AVANT avec
une force de 0.72, `uDogWake.w = 1` et son amplitude reste **nulle** tant qu'il
n'a pas perdu pied — le creux de coque n'appartient qu'à la nage.

## Chantier tête — stop, gueule et regard (31/07/2026, Codex)

Le crâne et le museau étaient **un seul sweep**, ce qui interdit structurellement
un stop : un stop est une discontinuité de la dérivée du rayon ET de la ligne
d'axe, qu'un `radius(u)` continu sur 14 stations lisse toujours. Scindés :
crâne de 8 stations à couronne aplatie (le front large et plat du standard),
museau de 6 stations à chanfrein **rectiligne**, démarrant 0.04 u à l'intérieur
du crâne — le recouvrement masque le joint, comme le cou sur l'épaule.

La gueule est un **volume**, pas une tache : mandibule sur un pivot `jaw`, et
cavité buccale sphérique **entièrement à l'intérieur** du museau. Fermée, le
depth test la cache ; ouverte, elle apparaît dans l'écart. Aucun z-fighting
n'est possible, les surfaces ne sont jamais coplanaires. C'est le pendant
volumétrique du choix SDF fait pour les empreintes. `COAT.tongue`, déclarée et
inutilisée depuis le premier jour, sert enfin.

La mandibule est le premier pivot tourné hors oreilles : elle peint depuis `p`
et non depuis `upness`, qui vit dans le repère local de la pièce.

Paupières en demi-sphère sur un pivot centré sur l'œil : c'est leur intersection
avec la sphère de l'œil qui donne l'amande, et `lid.rotation.x` donnera le
clignement. `jaw` et `lids` sont exposés par `buildBody` pour S4.

**DÉFAUT CONNU, à corriger en S3 : la face est presque entièrement crème.** Vue
de face le chien lit comme un chien à masque blanc, pas comme un shiba. Cause
identifiée, ce n'est pas la géométrie : le museau porte un biais crème constant
de `0.52 + 0.16 u` passé à `coatAt`, dont la fenêtre `smoothstep(-0.55 + biais,
0.15 + biais, upness)` bascule alors presque tout le chanfrein du côté crème. Le
crâne, lui, est juste (biais −0.15). L'urajiro réel n'est pas un biais global :
c'est un masque par ZONE — flancs du museau, joues, sous-mâchoire, gorge, face
interne des pattes, ventre, dessous de la queue — et le dessus du chanfrein doit
rester roux. C'est exactement le mandat de S3.

## Chantier urajiro — le masque par zone (31/07/2026, Codex + Claude)

Le crème n'est plus un biais global passé à `coatAt` mais un **masque par zone**
évalué depuis le 4ᵉ argument `p` du callback de `sweep` : ventre (et pas les
flancs), sous-mâchoire, flancs du museau, joues, face **interne** des pattes,
intérieur des oreilles. `coatAt` reste la base (rousseur, selle) ; l'urajiro se
superpose en `lerp` final. Les biais crème par pièce sont ramenés à −0.15 : c'est
le masque qui travaille, plus le biais.

**Deux exceptions à connaître.** La QUEUE garde `upness` : elle s'enroule sur plus
de 270°, donc son « dessous » n'est PAS `p.y < 0` sur toute sa longueur, et
`upness` — la composante verticale de la normale de section transportée — est
exactement la bonne quantité. La MANDIBULE peint aussi depuis `p`, parce que son
pivot tourne : `upness` y vit dans le repère de la mâchoire.

**Correctif de suivi, mesuré en jeu.** La première passe laissait encore une face
blanche. Cause : `muzzleFlanks` ouvrait sa fenêtre jusqu'à `p.y < 0.060` alors
que l'axe du museau vit entre −0.008 et −0.040 — **tout** le chanfrein tombait
donc du côté crème. Fenêtre resserrée à `smoothstep(-0.030, -0.080, p.y)` : le
crème ne monte plus que sur le bas des flancs, le dessus du chanfrein reste roux.
C'est la moitié du masque de la race.

## Chantier poussière — la réaction du sol (31/07/2026, Codex + Claude)

`src/particles.js` : un pool unique de grains (192/128/64 selon le tier) plus un
pool de 32 couronnes d'eau, tous deux calqués sur `createFootprints` — ring
buffer, `aBorn`, fondu en `(1 − age/vie)`, instances parquées à `y = −9999`,
`frustumCulled = false`. **+2 draw calls, conformes à la cible.**

La balistique vit dans le VERTEX shader (`pos = origine + v·age + ½g·age²`) :
zéro travail CPU par grain et zéro upload de matrice par frame — les matrices
d'instance ne portent que l'origine, écrite une fois à l'émission. La matière
suit le sol : `isOnPath` → terre battue, `WORLD.beachTop` → sable, service eau →
gouttes et couronne, sinon prairie (palette d'automne au boot).

**Trois causes cumulées rendaient l'effet INVISIBLE, toutes trouvées à la
mesure, aucune devinée :**

1. **Les grains naissaient sous le chien.** Émis à l'aplomb de la patte et
   billboardés, ils étaient masqués par sa propre silhouette. Prouvé en basculant
   `depthTest` : profondeur désactivée, la bouffée apparaissait ; réactivée, elle
   disparaissait derrière le corps. Correctif : un **drift** passé à `burst`, qui
   biaise vitesse ET origine vers l'ARRIÈRE — ce qui est aussi la vérité physique,
   un animal qui court projette la matière derrière lui.
2. **La poussière avait la couleur du sol dont elle se lève** (`0xb77b48`, très
   exactement la teinte de la terre battue). Une poussière en suspension diffuse
   la lumière et lit toujours plus clair que la surface qu'elle quitte : les
   palettes sont éclaircies.
3. **Grains trop petits et trop brefs** : 0.16–0.32 u pour 1.15 s. Portés à
   0.30–0.58 u et 1.7 s.

**Méthode de diagnostic, à réutiliser** : bissection par substitution de
matériau. `MeshBasicMaterial` → les instances s'affichent, donc l'instanciation
est saine. Vertex maison + fragment trivial → s'affiche, donc le vertex est bon.
Fragment réel + `depthTest: false` → s'affiche, donc le fragment est bon. Seule
variable restante : la profondeur. Quatre captures, aucune hypothèse.

État honnête : l'effet est **présent mais discret**. Les deux seuls réglages sont
`PAW_BURST_COUNT` et `PAW_BURST_SIZE` dans `shiba.js`, plus les tailles par
matière dans `particles.js`. À monter si l'utilisateur le veut plus franc.

## Vague finale — allures, mer, koi, et revue adversariale (01/08/2026)

Trois chantiers en parallèle sur fichiers disjoints, plus la revue adversariale
`ADV-2026-08-01-81F0C02` lancée en même temps sur les sept commits précédents.

**Allures** : trois cycles (quatre temps / deux diagonales / galop) blendés par
leurs SORTIES et non par leurs phases — interpoler des déphasages traverse des
poses où les pattes se synchronisent puis se désynchronisent. `state.gait` reste
un accumulateur unique. Empilement sans FSM : quatre scalaires 0..1 dans un ordre
de `mix()`. Ébrouement déclenché par `wetness` à la sortie de l'eau, tête qui mène
et queue qui suit 0.14 s plus tard — c'est ce décalage qui fait lire l'onde le
long du corps. Garde-fou dur à 1.4 s contre le chien paralysé au bord de l'eau.

**Mer** : la route 'plage' s'arrêtait à **h = +14.6, soit ~125 u de l'eau** — il
fallait courir 8,5 s hors sentier pour se mouiller une patte, et la tolérance de
l'invariant 5 sur son dernier point était vide de sens. Trois points ajoutés.
`oceanSwellY` exporté d'`island.js` (même somme de 4 Gerstner que le shader, sans
le pincement XZ) : le chien flotte sur la VRAIE surface, car à hauteur constante
il aurait « marché sur l'eau » un creux sur deux, l'amplitude valant 0.10 à 0.66 u
dans la zone de baignade. Sillage en fragment sous masque, jamais en géométrie :
la tessellation de l'océan vers r=300 fait 3.6 × 7.4 u.

**Koi** : peur qui monte à 4/s, retombe à 0.35/s. Elles ne quittent pas leur
trajectoire — c'est son budget qui les garde dans le contour.

### Revue adversariale : 3 findings, 3 confirmés, 3 traités

Détail dans `ADVERSARIAL_REVIEW_CLAUDE.md`. **Deux des trois portaient sur du
code écrit par Claude lui-même**, ce qui est le meilleur argument pour la
convention : le garde-fou d'ondes `uDogWake.w > 0` que j'avais spécifié dans un
brief coupait aussi la durée de vie des anneaux, et mon invariant 14 agrégeait
par `Math.max` sur tous les bassins, autorisant exactement la régression qu'il
prétendait attraper.

**Leçon à retenir** : un garde-fou de COÛT (« ne calcule pas ce qui n'est pas
visible ») et une durée de VIE (« cet effet doit finir de mourir ») ne sont pas la
même chose. Les avoir fait porter par le même uniform était l'erreur, pas son
seuil. Deux uniforms distincts, et le problème disparaît.

### Suites finales

`INVARIANTS: 15 pass, 0 fail` en low **et** en `?q=ultra`. En ultra, avec le
sentier prolongé : 42 936 triangles de ruban couverts, marge exacte 0.0200,
élévation max 0.2309 pour un plafond de 0.550, 43 lanternes sans orpheline.
Contrôles en jeu : ondes qui survivent à la sortie du bassin et meurent seules à
3 s ; `wetness` à 1 après bain, `shake` à 0.98 sur 51 frames puis retour à 0 ;
`oceanSwellY` qui varie dans le temps.

**Dette laissée ouverte, assumée** : la poussière au sol est présente mais
DISCRÈTE (voir le journal du chantier), et le sillage de nage est peut-être un
peu appuyé — deux jugements de goût qui reviennent à l'utilisateur, pas des bugs.

## Réglages du sillage et de la poussière — trois allers-retours, puis des molettes (01/08/2026)

Retours utilisateur en jeu : « bizarre le halo lumineux autour » (sillage de
nage) et « on dirait des bulles » (poussière). Les deux étaient justes, et les
deux venaient d'une erreur de ma part.

**Le halo.** Le fragment de l'étang convertit toute hauteur positive en crête
claire. À 0.22 d'amplitude, le bourrelet du sillage dépassait largement le
clapot de brise (0.098) : il ne lisait plus comme de l'eau soulevée mais comme
un anneau lumineux posé sur la nappe. Amplitude 0.22 → **0.13**, bourrelet
0.55 → **0.32**, gaussienne deux fois plus large et poussée plus loin du corps.
L'histoire complète du nombre est en commentaire : à 0.08 il passait SOUS le
clapot, à 0.22 il devenait un halo — les deux bouts constatés en jeu.

**Les bulles.** Ce n'était pas un problème d'intensité mais de FORME : le grain
était un disque à cœur plein (opaque à 100 % jusqu'à `r = 0.52`) et à bord
circulaire, donc chaque particule lisait comme une bille. Remplacé par une
décroissance douce sans palier, avec un rayon modulé par l'angle (graine tirée
de la date de naissance, donc deux grains nés à la même frame diffèrent) et une
luminosité qui varie d'un grain à l'autre. Les gouttes, elles, **restent des
disques nets** — une goutte EST une bille.

**Le piège que je me suis tendu.** En corrigeant les bulles j'ai baissé la forme
ET l'intensité, et la poussière a disparu une deuxième fois. Or le seul passage
du disque plein à la décroissance douce divise déjà l'opacité effective par ~2
(0.46 contre 1.0 au même rayon). Corriger une forme et compenser sa part, oui ;
cumuler les deux baisses, non.

**Conclusion méthodologique** : trois allers-retours capture/relance pour un
réglage de goût, c'est deux de trop. Les deux constantes sont désormais des
**molettes vivantes**, réglables à chaud sans rechargement :

```js
// poussière (opacité)
__sk.world.particles.group.getObjectByName('shiba-ground-grains')
  .material.uniforms.uDustOpacity.value = 0.9;
// sillage de nage (profondeur du creux)
(await import('/src/shiba.js')).SHIBA.wakeAmp = 0.2;
```

**Valeur figée par l'utilisateur : `uDustOpacity = 0.20`.** Choisie à la molette,
en jeu, après avoir essayé plus fort. Ce n'est pas un compromis moyen, c'est un
parti pris : la poussière est un souffle, pas un nuage. `SHIBA.wakeAmp` reste à
0.13. Ne pas les remonter en croyant corriger un oubli.

## Empreintes à l'envers, et sentier de plage repris (01/08/2026)

**Empreintes retournées.** `createFootprints` couche son plan par
`rotateX(-π/2)`, ce qui envoie le bord `v = 1` — celui où le fragment dessine
les quatre doigts — vers **−Z**. Or le modèle regarde **+Z** et `stampPrint`
applique le lacet du chien : les orteils pointaient donc systématiquement vers
l'arrière. Le défaut existait depuis la création des empreintes et personne ne
l'avait vu, parce qu'une empreinte de patte reste lisible à l'envers. Corrigé
par un `rotateY(π)` supplémentaire, qui conserve la normale vers le haut et ne
fait que miroiter `u` — sans effet, les quatre orteils étant disposés
symétriquement.

**Sentier de plage.** Le prolongement livré la veille descendait jusqu'à
`h = −0.43`, traçant un long ruban de terre battue **en travers du sable**
jusqu'à l'eau. Rejeté : « je veux pas qu'il avance autant dans le sable ». Le
dernier point est ramené à la LISIÈRE herbe/sable, mesurée sur le heightfield :
coordonnées auteur `(50.5, 71.9)`, `h = 1.52`, juste au-dessus de
`WORLD.beachTop = 1.2`. Deux lanternes disparaissent avec le tronçon (43 → 41).

**Fin de ruban franche.** La largeur de la route 'plage' était multipliée par
`1 − smoothstep(0.94, 1, t)`, donc elle tendait vers zéro : une aiguille. Ce
fuseau avait été demandé plus tôt comme « un coup de pinceau levé posé sur
l'herbe » — **arbitrage inversé, assumé**. Remplacé par un resserrement de 25 %
sur le dernier septième, qui évite le bord coupé au couteau sans dessiner de
pointe.

Conséquence à connaître : la plage se traverse désormais **librement, sans
sentier**. Le chien atteint toujours la mer et la houle le porte, mais le
dernier tronçon se fait sur le sable ouvert, ce qui était le but.

Vérifié : `INVARIANTS: 15 pass, 0 fail` en `?q=ultra` (39 368 triangles de
ruban, marge exacte 0.0200, élévation max 0.2376, 41 lanternes sans orpheline),
plus contrôle visuel des empreintes de face et de la fin du sentier.

### La fin du sentier, troisième et dernière tentative

Deux échecs successifs, tous deux sur le même axe : **la largeur**. Un fuseau
vers zéro donne une aiguille ; une largeur constante donne une coupe au couteau.
« Trop nette, trop droite, pas naturelle. »

L'erreur était de chercher au mauvais endroit. Une sente réelle ne se termine
pas, elle se **dissout** : la terre se fait manger par l'herbe en mouchetures.
Or le fragment du ruban sait déjà faire exactement cela — c'est lui qui produit
les bords latéraux effilochés, par `vPathEdge + bruit > 0.90 → discard`. Il
suffisait donc de pousser `aPathEdge` vers 1 sur le dernier tronçon pour livrer
la FIN au **même** effilochage : même bruit, même grain, donc même famille de
contours que les côtés. Zéro géométrie ajoutée, zéro constante artistique neuve.

`edge = max(latéral, fin)` et non une somme : au milieu du ruban la fin domine,
sur les bords c'est le liseré latéral, et les deux se rejoignent dans le coin
sans marche.

La longueur de dissolution est écrite en **unités monde** (16 u) puis convertie
en fraction du paramètre via `route.curve.getLength()`. `t` court sur toute la
route : une fraction en dur dissoudrait des dizaines d'unités sur un tracé long
et rien du tout sur un court. Premier jet à `smoothstep(0.72, 1)` : 130 unités
de dissolution, attrapé avant capture.

**Leçon** : quand deux réglages opposés du même paramètre échouent tous les
deux, c'est le paramètre qui est le mauvais — pas sa valeur. Même forme que la
leçon de la rivière (« c'est l'axiome commun qui est faux ») et que celle des
ondes (« un garde-fou de coût n'est pas une durée de vie »).
## Chantier F — autel enrichi : texture et mobilier de culte (01/08/2026, Codex sol)

Demande utilisateur : « plus de détails et de texture à l'autel ». Deux passes
Codex (effort high) + réglage final par Claude en navigateur. `src/details.js`
uniquement.

- **Texture** : `makeGrainBump` (jusque-là réservé au terrain) appliqué à
  `shrineMat`. Débloqué en remplaçant le `deleteAttribute('uv')` des helpers
  `part()` par une projection planaire à l'échelle du monde (`applyShrineSurface`,
  plan choisi sur la normale dominante, 1.6 UV/u).
- **Patine par PIXEL** (`onBeforeCompile`, idiome de `pathMat`) : bruit de valeur
  3D sur la position locale → variation de valeur, mousse en taches + coulures
  sous l'avant-toit, lichen en haut et sur le toit. Attribut `aPatina`
  (1 pierre / 0.5 toit / 0 exclu : ouverture, vermillon, paille, offrandes).
- **Mobilier** : socle de pierres à jupe enterrée, dalle d'offrandes, deux coupes
  et un bol, shimenawa + ligatures + shide en zigzag, rive de tuiles à
  l'avant-toit, embouts de faîtage, kegyo. Hokora 117 → 863 tris.
- **Komainu a-un** : deux géométries distinctes (429 / 421 tris). Gauche gueule
  OUVERTE (cavité en retrait entre chops et mâchoire) + boule ; droite gueule
  fermée + chiot.

### Trois pièges payés, à ne pas re-payer

1. **Une couleur par SOMMET ne peut pas peindre une patine sur des `BoxGeometry`.**
   Un bloc a 8 sommets : sur une face de 1.1 × 1.2 u on n'obtient qu'un dégradé à
   quatre coins, jamais une tache. La première passe a livré une patine par sommet
   invisible. La réponse n'est pas de tesseller, c'est le fragment shader.
2. **`bumpScale: 0.20` ne produit RIEN sur cette pierre** ; il a fallu 0.85.
   Diagnostic éclair quand un bump semble mort : l'afficher en `material.map` —
   si le grain apparaît net, les UV sont bonnes et le problème est l'amplitude.
3. **La mousse doit DARKENER, pas seulement teinter.** `0x5d6b33` et `0x9a9691`
   sont voisins une fois en linéaire ; sans le `*= mix(1.0, 0.84, w)` la patine
   disparaît dans l'ACES. Et `patch` est un **mot réservé GLSL ES 3.00** — le
   shader ne compile pas et l'objet disparaît sans autre symptôme.

Pose : la surface visible de la terrasse est à **y = 0.083** dans le repère local
du hokora (mesuré au raycast sur `overlook-terrace`) — la première passe avait
supposé 0.04 et enterrait la dalle d'offrandes. Ancrages `heightAt + 0.10 / + 0.11`
inchangés.

Vérifications : `node --check`, `INVARIANTS: 10 pass, 0 fail` en `?q=ultra`
(Chrome réel), visuel midi et nuit à 3 u en `?q=high`. Deux jobs Codex fantômes
(un doublon de relance, un zombie à 9 h d'« elapsed » journal figé) ont dû être
annulés à la main ; le fichier avait bien été écrit dans les deux cas.

### Suite : toit décollé (même jour, retour utilisateur)

Deux choses dans le même retour, à ne pas confondre.

1. **« Aucune diff »** : la capture venait du port **5174**, servi par le worktree
   `.claude/worktrees/shiba-eau-sol` d'une session parallèle, dont `details.js`
   n'a pas une ligne du chantier F. Le chantier est sur **5173**. Réflexe à
   garder quand deux sessions tournent : `lsof -nP -iTCP -sTCP:LISTEN` puis
   `lsof -a -p <pid> -d cwd` — le port ne dit pas quel arbre il sert.
2. **Le toit décollait pour de vrai**, sur les deux ports, et seulement en vue
   BASSE (l'angle du joueur derrière le shiba ; les vérifications précédentes
   avaient toutes été faites de face, à hauteur d'homme). Trois causes :
   auvent de 1.28 de profondeur sur un corps de 0.84 — 0.22 de vide ombré de
   chaque côté ; **pignon arrière absent**, donc on voyait à travers ; rive de
   toit plus longue que la pente, dépassant comme une perche.

Correctif : corniche `1.24 × 0.11 × 0.98` à y = 1.635 dont le toit prend appui,
pignon arrière (winding inversé, face vers -Z), profondeur d'auvent 1.28 → 1.06,
toit descendu de 1.82 → 1.775, rive raccourcie 0.92 → 0.86 et rentrée sous la
ligne d'égout. 863 → 876 tris. Invariants 10/10, revérifié en vue basse des deux
côtés.

**Leçon de méthode** : un objet posé au sol se juge à la hauteur d'œil du
personnage, pas seulement de face. Les défauts d'assise ne se voient que d'en bas.

### Suite : lichen en auréoles et bavoir traversé (même jour, retour utilisateur)

- **« Des taches bizarres sur le toit »** — le lichen était mixé à **0.55** vers
  un ton pâle (`0xc8c2a2`) sur une toiture `STONE_DARK`, en plages larges
  (bruit à 4.35). Sur une surface sombre, un mix pâle fort ne lit pas comme du
  lichen mais comme une auréole. Réglé en **mouchetis rare** : bruit 7.20, seuil
  0.70-0.86, poids 0.24 (et 0.75 de zone sur le toit). Règle générale : plus le
  support est sombre, plus la patine claire doit être FINE et FAIBLE.
- **« Le tissu triangle rouge est buggé »** — le bavoir était **un seul triangle
  sans épaisseur**, et la mâchoire ouverte du gardien 'a' (sphère y 0.41-0.59)
  le traversait de part en part : vu de biais, un éclat rouge sans volume.
  Deux corrections : bavoir refait en **coin SOLIDE** (2 faces + 3 rives, 8 tris)
  et descendu sous le collier (y 0.525-0.305) ; mâchoire remontée et affinée
  (y 0.535-0.635) pour dégager la poitrine sans refermer la gueule.
- Au passage : la cavité de la gueule passe de `TORII_DARK` (0x30261e) à
  `0x4a4039`. En quasi-noir elle fusionnait avec l'ombre sous les babines en une
  seule masse plate — la bouche lisait comme un trou, pas comme une gueule.

Tentative intermédiaire écartée : remonter TOUTE la bouche sur le museau
dégageait bien le bavoir, mais exposait la cavité sombre en pleine face. C'est
le bavoir qu'il fallait descendre, pas la bouche qu'il fallait monter.

### Suite : bougies d'offrande allumées la nuit (même jour, demande utilisateur)

Deux bougies sur la dalle d'offrandes, allumées sur la MÊME courbe que les
lanternes (`phase.night + phase.twilight * 0.75`) : éteintes à midi, allumées
de ~0.80 (crépuscule) à ~0.25 (aube), vérifié par balayage de `dayTime`.

- `HOKORA_CANDLES` (repère local du hokora) est la source de vérité unique : la
  cire est bâtie dans `makeHokoraGeometry`, les flammes sont un `InstancedMesh`
  additif **parenté au mesh du sanctuaire** — il hérite position et orientation,
  donc aucune reprise de la tangente du chemin, rien à tenir en phase à la main.
- Flamme : sphère r 0.019 étirée ×2 en Y. Le premier essai à 0.052 sortait des
  flammes **de la taille des coupes à saké** — des œufs lumineux, pas des
  bougies. Le halo doit venir du bloom, pas de l'empreinte de l'émetteur.
- Vacillement plus rapide et moins profond que les lanternes, et surtension 1.55
  contre 2.6 : une bougie qui halote comme un kasuga-doro cesse d'être une bougie.
- `update()` a été restructuré : il sortait en `return` anticipé quand les
  lanternes n'étaient pas allumées, ce qui aurait aussi coupé les bougies. Les
  deux blocs sont maintenant indépendants sous la même valeur `lit`.

Invariants 10/10 en `?q=ultra`.

## Chantier L — lucioles nocturnes (01/08/2026)

Demande : « luciole la nuit ? j'essaye de rendre ça plus vivant parce qu'il fait
sombre », puis « papillons en journée ». Diagnostic retenu après questions : la
nuit n'est pas trop sombre, elle est **inhabitée** — il manque du mouvement, pas
de la lumière. Aucune retouche de la courbe nocturne de `sky.js`.

Spec des deux chantiers (lucioles + papillons) :
`docs/superpowers/specs/2026-08-01-lucioles-papillons-design.md`.
Plan détaillé : `docs/superpowers/plans/2026-08-01-chantier-L-lucioles.md`.
Implémentation déléguée à Codex (Grok non authentifié — repli prévu par AGENTS.md).

### Ce qui a été construit

`src/fireflies.js` : placement pur par rejet + `InstancedBufferGeometry` dont
tout le mouvement vit dans le vertex shader (patron `petals.js`, pas `birds.js` —
une luciole n'interagit avec rien). 160 / 420 / 800 individus selon le tier, en
**absolu et non `AREA_SOFT`** : elles sont ancrées sur trois bassins de taille
fixe, les diluer avec l'île n'aurait rien apporté.

**La synchronie est PAR BASSIN**, ce qui est le comportement réel des
genji-botaru : chaque étang porte sa phase, chaque individu s'en écarte de
±0.25 s. Vérifié numériquement sur un cycle complet plutôt qu'à l'œil — bassin 0
allumé aux pas 0-5, bassin 1 aux pas 6-13, bassin 2 aux pas 14-19, pic à ~55 % de
la population. Une vague, pas un interrupteur.

### Ce que la mesure préalable a rattrapé

Le banc fps **avant** (T1) devait juste donner une référence ; il a surtout révélé
que `ponds.attach()` élargit les bassins de ~42 % (32.5 / 19.3 / 13.6 au lieu de
22.9 / 16.5 / 12.7 nominaux), donc que les trois habitats **se chevauchent**. Avec
un `exp(-u²)` nu, la densité valait encore **0.368 au rayon d'habitat** où le
placement coupe net : chaque nuée aurait été tranchée en cercle visible, et deux
bassins déphasés se seraient touchés à densité franche.

D'où `densityFalloff = -ln(densityFloor)` : la décroissance atteint le plancher
**exactement** à la coupure, les deux mécanismes disent la même chose au lieu de
se contredire. Vérifié : `exp(-2.81) = 0.0602` contre un plancher à 0.06.

### Le seuil de bloom n'est pas 0.85

Le spec initial prévoyait une surtension ×2.8 « pour passer le seuil de 0.85 ».
Faux : 0.85 est la valeur du **constructeur** (`sky.js:1148`), écrasée chaque
frame par `K_BLOOM_THRESHOLD` (`sky.js:385`), qui descend à **0.42 en pleine
nuit**. Les bougies du hokora, réglées le même jour par l'autre session, étaient
déjà à 1.55 pour un petit émetteur.

Courbe mesurée au framebuffer (différence avec/sans mesh, scène gelée, ultra) :

| Surtension | % d'écran touché | Delta max /765 | Cœurs saturés |
| --- | --- | --- | --- |
| 1.0 | 0.30 % | 553 | 0 |
| 1.2 | 0.79 % | 632 | 0 |
| **1.6 retenu** | **3.79 %** | **682** | 0 |
| 2.2 | 10.0 % | 708 | 0 |
| 2.8 | 15.1 % | 721 | 16 |

**Le delta max bouge à peine quand l'emprise écran est multipliée par 50.**
Au-delà du seuil, monter la surtension n'éclaircit pas la luciole : ça étale son
halo. À 2.8, 15 % de l'écran est voilé de vert — le « cœur noyé dans son propre
halo » que le commentaire des lanternes annonçait. 1.6 est au genou de la courbe.

### Performance

Protocole du piège 9 respecté des deux côtés (resync `readPixels`, orbit,
`autoRotate` off, damping off, dérive vérifiée nulle), même buffer 3600×2008,
`dayTime = 0.97`, deux passes de 240 frames par cadrage.

| | Avant | Après (800 lucioles) |
| --- | --- | --- |
| Ouverture | 71.0 / 71.6 | 71.7 / 72.5 |
| Sol | 73.2 / 73.3 | 73.7 / 73.4 |

L'écart est **dans le bruit** : le coût est sous le plancher de mesure, ce qui
n'est pas la même chose que nul. À noter au passage : **la nuit tourne deux fois
plus vite que le jour** (71 contre 33.7 à l'ouverture) — clé solaire éteinte, la
passe d'ombres cesse de payer le feuillage.

### Pièges payés

- **`world.quality` est la CHAÎNE du tier**, pas l'objet. Passer `world.quality`
  à `createFireflies` donne `quality?.fireflies === undefined`, donc un compte de
  zéro et une population VIDE sans la moindre erreur. `main.js` doit passer `q`.
  Une heure perdue à chercher un bug de shader qui n'existait pas.
- **Piège 8, revisité** : sous pilotage navigateur l'onglet n'a pas le focus, donc
  rAF ne tourne PAS. `renderer.info.render.frame` restait à 0 et les uniformes
  n'étaient jamais mis à jour. Toute vérification passe par `__sk.frame()` explicite.
- Le brouillard est un `FogExp2` : sur un matériau additif il faut **atténuer**
  (`col *= 1 - fogF`) et surtout pas mélanger vers `fogColor`, sinon une luciole
  lointaine devient plus brillante que de près.
- **Sphère englobante posée à la main, obligatoire** : la géométrie ne contient
  qu'un quad unité à l'origine, le calcul automatique de three ignore `aPos` et
  aurait culé toute la population dès qu'on regarde ailleurs.

### État

`INVARIANTS: 17 pass, 0 fail` en `?q=ultra` (les 16 existants — dont les cinq du
chien et de l'eau arrivés par merge pendant le chantier — plus les deux des
lucioles). Trois tiers vérifiés visuellement.

Suite : chantier P ci-dessous.

## Chantier P — papillons diurnes (01/08/2026)

Le versant jour de la même demande. `src/butterflies.js` : deux fonctions pures
(semis, courbe d'activité) plus un `InstancedMesh` piloté par une machine à états
CPU — contrairement aux lucioles qui sont en dérive GPU pure, les papillons
butinent, se posent et fuient, donc ils ont besoin du CPU. N ≤ 136, c'est gratuit.

Deux espèces : *Pieris rapae* / *Papilio xuthus* au printemps, *Vanessa indica*
(akatateha) remplaçant la blanche à l'automne — elle **hiverne à l'état adulte**,
d'où sa présence en novembre quand les autres sont à l'état d'œuf.

`INVARIANTS: 19 pass, 0 fail` en `?q=ultra`. Coût dans le bruit : ouverture
34.0/34.2 → 33.7/34.0, sol 32.4 → 32.5 (trois passes identiques).

### Ce que la mesure a corrigé, encore

- **Le champ de fleurs fait 633 × 637 u.** Mon `homeRadius: 150` mesuré depuis le
  barycentre global aurait ramené toute la population au centre et vidé la
  périphérie. Le domaine est devenu **individuel** — 70 u autour de la fleur
  d'éclosion. C'est aussi le comportement réel : les *Pieris* explorent leur
  « natal patch ».
- **Les ailes sont HORIZONTALES, pas verticales.** C'est ce qui permet au
  battement de faire tourner la NORMALE et donc d'accrocher la lumière
  différemment à chaque coup. Des ailes verticales tourneraient dans leur propre
  plan, resteraient éclairées à l'identique, et le scintillement — tout le tell —
  disparaîtrait.
- **Corde 0.84 pour 1.0 d'envergure.** Le premier jet à corde 1.0 donnait des
  losanges deux fois plus profonds que larges : ça lisait comme une pastille.
- **L'échancrure et la bande de corps.** Sans le creux entre aile antérieure et
  postérieure, et sans la bande sombre axiale, la paire d'ailes fusionne en un
  seul lobe symétrique et l'insecte lit comme un pétale.

### Pièges payés

- **Ordre de construction impératif** : les papillons se construisent APRÈS
  `createDetails`, seul à remplir `flowerSpots` (binding ES vivant, comme
  `lanternSpots`). Les construire à côté des lucioles, où l'envie est forte,
  donne zéro papillon sans la moindre erreur.
- **Chauffe du banc fps** : la première passe après un déplacement de caméra
  donnait 29.4 contre 32.4 pour les cinq suivantes (σ = 0.08). Les 8 frames de
  chauffe ne suffisent pas — **la première passe complète EST la chauffe**. Sans
  ça on croit à un bruit de ±3 fps là où il est de ±0.1.

### Sur la délégation

Codex a **calé** sur le brief de `createButterflies` : quinze minutes, aucune
écriture, mort en phase d'exploration. Tous les briefs qui ont abouti sur ce
chantier et le précédent contenaient le code **verbatim** ; le seul qui lui
demandait de concevoir à partir d'une spec a échoué. Le module a donc été écrit
par le modèle principal, en dérogation assumée à la convention d'`AGENTS.md`.
**À retenir pour les prochains chantiers : découper en tâches dont le code est
déjà écrit, ou ne pas déléguer.**

### Défaut connu, non corrigé

La silhouette **reste asymétrique** en gros plan : une aile se présente pleine,
l'autre en biseau. L'échancrure et le corps fonctionnent, la lecture « papillon »
passe à distance de jeu, mais un examen rapproché montre que les deux ailes ne se
présentent pas identiquement. Piste probable : le roulis
`sin(flapPhase) * 0.10` composé après le lacet dans l'Euler XYZ. Non investigué.

## Correctif — variété individuelle des lucioles (01/08/2026)

Retour utilisateur : « elles brillent toutes à la même fréquence ». Le constat
était juste et le défaut plus large qu'annoncé : `uPeriod` était un uniforme
**global** et l'éclat une constante. Toute la population partageait période ET
intensité, seule la phase changeait — le défaut que la synchronie par bassin
devait éviter, réintroduit un cran plus bas : trois groupes qui pulsent, mais
chaque groupe rigide.

La difficulté est qu'on **ne peut pas simplement randomiser la période** : la
synchronie par bassin est le comportement réel des genji-botaru, et des périodes
toutes différentes la dissoudraient en quelques dizaines de secondes. D'où trois
leviers dont un seul touche à la fréquence :

- **éclat individuel** 0.30–1.00 et **décroissance** 0.62–1.55 (durée du flash) —
  aucun effet sur la synchronie, et c'est de là que vient l'essentiel de la
  variété perçue ;
- **22 % de solitaires** à période propre (1.25–3.60 s), hors du chœur de leur
  bassin. Biologiquement vrai : tous les mâles ne se joignent pas au chant, et ce
  sont ces traînards qui empêchent l'ensemble de lire comme une horloge.

Vérifié après coup sur un cycle complet : le chœur respire toujours (pics 0.64 /
0.67 / 0.73 par bassin, chacun dans sa fenêtre) et les solitaires tiennent un
fond constant de 0.11 à 0.30 qui comble les creux. 185 périodes distinctes contre
une. Coût mesuré mesh caché/affiché au même cadrage : **−0.1 fps**.

**Leçon générale : une variation par instance ne se met pas dans un uniforme.**
Le même piège guette tout système instancié de ce projet.

## Reviews adversariales et correctifs (01/08/2026)

`ADV-2026-08-01-FIREFLY` (lucioles) et `ADV-2026-08-01-BFLY` (papillons), lancées
en parallèle. **Verdict des deux : needs-attention, « no-ship ».** 11 findings,
dont 6 contre-vérifiés numériquement par Claude — **tous confirmés, aucun rejeté**.
10 traités dans `383de77`.

### Ce que la review a trouvé et que la vérification maison avait manqué

- **Les papillons volaient exactement de côté.** Le lacet valait `-heading`, ce
  qui envoie le +Z local sur `(-sin h, cos h)` alors que la vitesse va vers
  `(cos h, sin h)` : produit scalaire **nul pour tout cap**. Correctif
  `PI/2 - heading`.
- **Le butinage ne fonctionnait pas.** `pickFlower` tirait 8 indices dans les
  25 204 fleurs de l'île entière : un disque de 14 u couvre 0.153 % du champ, soit
  **1.22 % de réussite**. La fonctionnalité explicitement demandée était morte.
  Index spatial en grille.
- **`flowerSpots` portait le Y du terrain**, donc les rares posés atterrissaient
  20 à 95 cm sous la corolle, dans les tiges.
- **Le taux d'embardée était 60× trop grand** : `veerChance * step * 60` donne la
  probabilité PAR FRAME, soit 9.6/s au lieu de 0.16/s.
- **Le roulis phase-locké** ajoutait la même rotation aux deux ailes déjà
  opposées : c'était l'origine de l'asymétrie. Supprimé, silhouette redevenue
  symétrique.
- **Lucioles** : dérive verticale centrée → −0.068 u sous la surface ; sphère
  englobante 0.595 u trop courte ; `densityFalloff` copie de `-ln(densityFloor)`
  au lieu d'en être dérivé ; budget absolu justifié par des « bassins de taille
  fixe » — **factuellement faux**, leurs rayons suivent `LAND_SCALE`.

### La leçon, et elle est structurelle

**Mes invariants testaient ce qui est facile, pas ce qui compte.** Les quatre
défauts majeurs des papillons sont passés avec `19 pass, 0 fail` parce que les
deux invariants n'appelaient que des fonctions pures et n'instanciaient jamais
`createButterflies`. Le signal de validation que j'avais présenté était trompeur.

D'où deux invariants de RUNTIME (20 et 21) qui construisent les vrais systèmes :
cap comparé au déplacement réel frame à frame, butinage effectif sur 30 s de
simulation, garde au sol après coup, gate jour/nuit sur `update()`, proportion de
solitaires et étalement de l'éclat. `INVARIANTS: 21 pass, 0 fail` en low et ultra
— dont **136/136 caps alignés (pire 1.000)** et **24 posés sur corolle contre 0**.

Un invariant a dû être corrigé avec le code : l'invariant 11 mesurait la garde au
sol au point semé, hypothèse périmée dès que le placement s'est calé sur
l'enveloppe de dérive. Il échouait sur sa propre prémisse, pas sur un défaut.

### Reste

**1 finding sur 11** : le domaine de vol des papillons n'est jamais borné en
position et ne connaît ni terre ni eau. `FLEE` continue d'intégrer hors domaine,
et au-dessus de la mer `Y` viendrait du fond marin. Non traité.

## Étalon photographique des papillons (01/08/2026)

Le seul écart de méthode qui restait : les lucioles avaient été comparées à des
références réelles, les papillons non. Fait par la **morphométrie publiée**
plutôt que par une impression sur photo.

### Ce qui était juste

**Le rapport de taille entre les deux espèces.** Réel : *P. xuthus* 7–9 cm contre
*P. rapae* 3.2–4.7 cm, soit ×2.0. Rendu : 0.72 / 0.34 = **×2.12**, à 6 % près.

### Ce qui manquait : les marques qui NOMMENT les espèces

Les deux ne se distinguaient que par la taille et la teinte, avec un liseré
sombre uniforme. Ajouté :

- *Pieris rapae* : **pointe d'aile noire** au sommet de l'antérieure et **point
  noir** sur son disque — les deux marques du guide d'identification ;
- *Papilio xuthus* : **nervures noires rayonnantes** sur le jaune, son signalement
  plus encore que la queue.

### L'échelle, assumée après mesure

Étalonnage du monde sur deux objets connus : le shiba (garrot 0.66 u pour ~40 cm)
donne 1 u ≈ 0.61 m, la lanterne de pierre (2.0 u pour ~1.8 m) donne 0.90 m. À
0.9 m/u :

| | rendu | réel | facteur |
|---|---|---|---|
| machaon | 65 cm | 7–9 cm | **×8.1** |
| petite blanche | 31 cm | 3.2–4.7 cm | **×7.7** |
| luciole | 18 cm | ~1.5 cm | **×12** |

Les insectes sont donc surdimensionnés d'un ordre de grandeur. **Non corrigé, et
documenté dans `config.js` comme un choix** : à l'échelle vraie une blanche
ferait 0.044 u, sous le pixel à toute distance de jeu — l'exact contraire de ce
que ces deux chantiers visaient. Le facteur est au moins cohérent entre les trois
espèces, et le rapport inter-espèces est juste.

Sources : AHDB et Butterflies and Moths of North America (*P. rapae* : envergure,
pointes noires, un point chez le mâle et deux chez la femelle), Kiddle et Bugs of
Japan (*P. xuthus* : 7–11 cm, jaune et noir).

## Le shiba refait — silhouette et tête (03/08/2026)

Demande : « on dirait un assemblage ». C'était exact, et pour deux raisons
distinctes qui se renforçaient.

### 1. Les marches de silhouette

Chaque pièce était une `sweep` autonome, et là où deux se rencontraient le rayon
sautait. Le pire était le genou : le fémur finissait à 0.085, le tibia repartait
à 0.092 dans un nœud posé PILE au bout — on voyait l'anneau de bouchon du
premier et le bord du second, un manchon télescopique.

**Trois choses ont dû être vraies en même temps** pour que le raccord disparaisse,
et je les ai découvertes dans cet ordre, chacune en cassant la précédente :

1. **Rayons égaux au pivot, pas « le bas plus large ».** À +13 % le segment bas
   RESSORT du haut, et l'anneau d'interpénétration de deux tubes à 12 facettes
   tombe sur la silhouette : on obtient un escalier, plus laid que la marche de
   départ. Le renflement d'articulation doit donc se lever SOUS le pivot
   (`sin(π·smoothstep(0, 0.36, v))`, nul en 0), jamais dessus.
2. **Même rapport rx/ry des deux côtés**, sinon l'égalité n'est vraie que sur
   deux points de l'anneau. D'où `FLAT_F` / `FLAT_B`.
3. **Une rotule au pivot.** Même à rayon et aplatissement égaux, deux tubes dont
   les TANGENTES diffèrent font un décrochement — et angler est précisément le
   rôle d'une articulation. Une sphère de même rayon (× 1.07, pour contenir
   STRICTEMENT les capuchons plats : à 1.00 ils se disputent le z-buffer et un
   éclat clair apparaît pile sur l'articulation) est tangente aux deux tubes.

Un piège de peinture s'y ajoute : la rotule doit être peinte avec `upness = 0`,
pas avec son vrai gradient sphérique. Un membre est un tube vertical, son
`_off.y` vaut zéro partout et `coatAt` y rend une teinte constante ; la rotule
peinte « correctement » portait un dégradé que les tubes n'ont pas — un bracelet
clair exactement à l'endroit qu'on voulait effacer.

Les rayons vivent maintenant dans un `LEG_R` unique, avec **un seul nom par
interface** (`joint`, `stifle`), sur le modèle de `SHIBA_BUILD`.

### 2. La robe peinte au lieu d'être poilue

`URAJIRO.leg` coupait le membre en deux dans sa longueur sur un seuil de 0.06 u :
moitié rousse, moitié crème, arête au rasoir. Ce n'est pas une marque de race qui
se lit, ce sont deux plastiques emboîtés. Bande élargie, décentrée vers
l'intérieur, et surtout **cassée par un bruit** (`furEdge`, nouveau) échantillonné
sur la POSITION — indexé sur `u` ou sur l'anneau il tournerait avec lui et
donnerait des rayures régulières au lieu de mèches. Même traitement sur
`URAJIRO.torso` et sur le seuil de `coatAt`, qui prend un 4ᵉ paramètre `jitter`.

### 3. Anatomie — ce qui manquait vraiment

- **Le coude était 0.24 u sous le sternum**, le bras pendait à nu. `thigh`/`shin`
  passent de 0.26/0.23 à **0.17/0.32** : la somme est inchangée, donc
  `standHeight` et la garde au sol aussi, seul l'étage du coude remonte.
- **Arrière-main** : la patte était deux tubes droits, et le fémur partait vers
  l'ARRIÈRE. Le grasset est passé devant, et le bas est devenu une seule sweep
  coudée jambe → **jarret pincé** → métatarse (sans nouveau nœud de rig : le rig
  ne pilote que `hip` et `knee`).
- **Pieds** : les sphères crème sont devenues des sweeps balayées de l'arrière
  vers l'avant — balayer vers le bas mettrait la sole sur un capuchon, donc ronde
  et impossible à aplatir. Sole plate, **quatre doigts arqués** en `max(0, −cos 8a)`
  masqué sur la moitié dorsale. C'est cette fréquence 8 qui impose `radial: 28`.
- **Épaule, hanche, poitrail, tuck-up** posés sur le `profile` du torse. L'ancien
  creux de taille était un gaussien appliqué aux DEUX rayons : il pinçait aussi
  le dos, alors qu'un flanc ne remonte que par en dessous.
- **Pivots ramenés vers l'axe** (±0.150 → ±0.104) : à l'ancienne largeur l'épaule
  tombait EN DEHORS du flanc, et un anneau enfoui qui dépasse latéralement fait
  une tablette — pire que le défaut d'origine.

### 4. La tête

Le museau démarrait à 0.132 quand le crâne finissait à 0.163 (la tablette au
stop) et ne s'affinait que de 12 % : un pavé. Il repart quasiment au rayon du
crâne, perd 42 %, en section de coin, chanfrein plat. Le stop est désormais porté
par une **arcade sourcilière** — un stop est une ombre, pas une marche. Joue
déplacée en arrière (l'arcade zygomatique est derrière l'œil) et étoffée.

Étalon FCI 257 / AKC, trois écarts objectifs corrigés : oreilles « relatively
small » (elles faisaient presque la hauteur du crâne, en cône à `radial: 3` →
plaque triangulaire creuse, `radial: 7`, ¼ plus courtes) ; œil « triangular,
outer corners slightly upturned » (bille ronde → amande, coin externe relevé par
`lid.rotation.z`, en gardant `rotation.x` libre pour le clignement que pilote
`shiba.js`) ; truffe réduite et fendue d'un philtrum.

### Vérification

`node --check`, puis `INVARIANTS: 21 pass, 0 fail` en **low ET en ultra**, dont
la garde au sol à −0.013 u pour un plafond de 0.090. Contrôle visuel en
navigateur : profil, trois quarts avant, face, détail des membres.

### Ce qui reste

- Les pattes avant gardent un très léger anneau au paturon.
- Le poitrail est un peu pâle de face — beaucoup d'urajiro d'un coup.
- Rien n'a été mesuré côté fps : le chien pèse quelques milliers de triangles
  dans une scène à 4 M, mais ça n'a pas été chiffré.

### Note de méthode — l'implémentation a dû être reprise en direct

Grok n'était plus authentifié, et **Codex a calé deux fois** (37 min puis 15 min,
zéro octet écrit) : laissé libre, il re-délègue à un sous-agent et attend
indéfiniment. `AGENTS.md` a été mis à jour — Grok retiré sur demande, Codex
devient l'implémenteur, et le brief doit lui interdire explicitement de
sous-traiter. Le chantier a finalement été écrit par la session principale.

---

## Session « mise en ligne Vercel » du 08/08

La scène est publiée. Aucun code de la scène n'a été touché — seulement deux
fichiers de configuration à la racine.

### Ce qui a été ajouté

| Fichier | Rôle |
|---|---|
| `.vercelignore` | Exclut `*.md`, `docs/`, `designs/`, `tools/`, `serve.py`, `.claude/`. **Le dépôt est servi tel quel** : sans cette liste, `REPRISE.md` et `ADVERSARIAL_REVIEW_CLAUDE.md` seraient lisibles publiquement à la racine du site. `assets/shiba/LICENSE.txt` reste inclus — l'attribution CC-BY est une obligation. |
| `vercel.json` | `framework: null`, `buildCommand: null`, `outputDirectory: "."`. Rend explicite ce que Vercel devinerait de toute façon, mais le rend **déterministe** : aucune détection de framework ne peut décider d'inventer un build. |
| `.gitignore` | `+ .vercel` (ajouté par la CLI ; contient `projectId`/`orgId`). |

`serve.py` ne part pas en prod et n'a rien à y faire : il existe pour contourner
le cache de `python -m http.server` et forcer les types MIME des modules ES.
Vercel sert `.js` en `application/javascript; charset=utf-8` et `.glb` en
`model/gltf-binary` nativement — vérifié, pas supposé.

### URLs

- Production : `https://sakurajima-blue.vercel.app`
- Projet Vercel : `fourreto/sakurajima` (33 fichiers, ~2 Mo déployés)
- Dépôt : `github.com/maximefourre/sakurajima` — **privé**, les journaux de
  session et les rapports de review ne sont pas publics.

**Redéployer : `git push`.** Le dépôt est connecté au projet Vercel, chaque
push sur `main` redéploie la production, chaque autre branche obtient une URL
de prévisualisation. `npx vercel --prod` reste disponible pour publier depuis
le disque sans passer par un commit.

### Vérification

- HTTP : `/` 200, `/src/boot.js` 200 en `application/javascript`,
  `/assets/shiba/shiba.glb` 200 en `model/gltf-binary`, et **404 sur
  `REPRISE.md`, `AGENTS.md`, `PLAN.md`, `ADVERSARIAL_REVIEW_CLAUDE.md`,
  `serve.py`, `vercel.json`** — l'exclusion tient.
- Boot navigateur : voile levée, `__sk` présent, shiba chargé depuis le `.glb`
  déployé, cycle du jour qui avance. Console propre — les trois seuls messages
  sont des avertissements de dépréciation émis par three.js lui-même
  (`THREE.Clock`, `PCFSoftShadowMap`).
- `test/invariants.html` **contre le site déployé** : `INVARIANTS: 26 pass, 0 fail`.
- Visuel : île, forêt en fleur, mer moutonnante, nuages, aube à 06:00.

### Pièges

- **`gh auth login` ne suffit pas à autoriser `git push`.** Il range le jeton
  dans le trousseau, mais ne branche pas git dessus : le premier push meurt sur
  `could not read Username for 'https://github.com': Device not configured`.
  Ce qui trompe, c'est que `gh repo create --push` marche — parce que c'est
  `gh` qui pousse, pas git. Le correctif est `gh auth setup-git`.

- Le HUD perf affichait `— fps / — draw calls / — triangles` et
  `renderer.info.render.frame` valait 0 : **onglet en arrière-plan**, rAF
  étranglé (piège 8). Rien à voir avec le déploiement — le rendu est correct
  dès que l'onglet repasse au premier plan.
- `vercel whoami` reste pendu indéfiniment quand la CLI n'est pas authentifiée,
  au lieu de rendre la main sur une erreur. Pour tester l'authentification,
  regarder plutôt l'existence de
  `~/Library/Application Support/com.vercel.cli/`.

### Ce qui reste ouvert

- **Le site dépend d'unpkg en production.** L'importmap charge three 0.185.1
  et 7 addons depuis `unpkg.com` : une panne d'unpkg = scène qui ne boote pas,
  et chaque visiteur paie les allers-retours CDN. Vendoriser three en local
  supprimerait cette dépendance, au prix du « aucun build » revendiqué par
  `AGENTS.md` — décision d'architecture, pas encore prise.
- **Les ~20 s de bake décident de la première impression** d'un visiteur qui
  n'a rien demandé. Le tier par défaut mériterait d'être rediscuté maintenant
  que la page est publique.
- **`AGENTS.md` annonce `INVARIANTS: 16 pass`**, la suite en compte 26 (elle
  est passée par 21 à la session shiba). Le chiffre est périmé dans la doc.

---

## Session « les trois points ouverts » du 08/08 (suite)

Les trois points laissés par la mise en ligne, traités sur décision utilisateur.

### 1. three vendorisé — plus aucune dépendance unpkg

`vendor/three/` : `build/three.module.js` + `build/three.core.js` (importé en
relatif par le premier), **15 addons** sous `examples/jsm/` (les 8 utilisés +
leur fermeture transitive : Pass, MaskPass, ShaderPass, 3 shaders,
SkeletonUtils — calculée par script sur les vrais `import`, pas devinée), et
`LICENSE` (MIT). Provenance : tarball npm officiel `three-0.185.1.tgz` ;
sha256 identiques à unpkg sur échantillon. ~2.3 Mo.

Les importmaps des **5 pages** (index + 4 tests) pointent vers
`/vendor/three/...` en chemins **absolus** — les pages de test vivent sous
`/test/`, un `./vendor/...` y résoudrait vers `/test/vendor/...`. Piège évité :
les fichiers vendorisés contiennent des spécificateurs `three/addons/...` dans
des annotations JSDoc `@three_import` — des commentaires ; un audit naïf des
imports les prend pour des imports nus cassés.

### 2. Tier par défaut : ultra desktop, high mobile

Décision utilisateur (« ultra desktop, medium mobile » — medium interprété
comme `high`, le tier du milieu). `DEFAULT_QUALITY_MOBILE = 'high'` dans
config.js ; le repli final d'`initialTier` (main.js) choisit selon
`matchMedia('(pointer: coarse)')`. `?q=` et le choix persisté gardent la
priorité — contrat AGENTS inchangé.

Au passage, trouvaille de la review adversariale (préexistante mais sur ce
chemin) : la garde `QUALITY[requested]` remontait la chaîne de prototypes —
`?q=constructor` passait, budgets `undefined`, `setPixelRatio(NaN)`, scène
morte. Corrigé par `Object.hasOwn` aux deux sites, vérifié en navigateur :
`?q=constructor` retombe proprement sur le repli.

### 3. Docs

`AGENTS.md` : en-tête (vendorisé, importmap local), défaut mobile dans le
contrat qualité, `INVARIANTS: 16` → `26` avec disclaimer (le compte grandit,
seul le `0 fail` est immuable). `PLAN.md:10` disait aussi « via importmap
unpkg » — attrapé par la review, corrigé.

### Vérification

- `node --check` main.js/config.js ; fermeture des imports vendorisés rejouée
  par script : tout résout.
- Invariants **low ET ultra** en local : `26 pass, 0 fail` × 2, **zéro requête
  unpkg** sur un chargement entièrement tracé (le vendor est bien servi).
- Boot complet en local, aria-pressed sur le tier réel, console sans erreur.
- Review adversariale par Workflow (8 agents, 5 axes + réfutation) : 2
  trouvailles confirmées — les deux corrigées ci-dessus — 1 réfutée.
  Le skill `codex:adversarial-review` d'AGENTS.md n'existait pas dans cette
  session ; remplacé par le fan-out Workflow.
