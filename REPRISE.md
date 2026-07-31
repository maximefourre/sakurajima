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
