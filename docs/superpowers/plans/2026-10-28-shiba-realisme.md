# Shiba réaliste — proportions et allures — plan d'implémentation

> **Pour les workers :** exécuter tâche par tâche (superpowers:executing-plans). Cases `- [ ]` à cocher.

**But :** qu'on reconnaisse un vrai shiba au premier coup d'œil, à l'arrêt comme en mouvement.

**Architecture :** deux chantiers en série. La forme (`src/shiba-geom.js` : squelette `BONES` / `LEG` / `SCAPULA`, primitives SDF `bodyPrims`, `PAW_SOLE`, `SIT_POSE`) passe d'abord, puis les allures (`src/shiba.js` : `GAITS`, crouch, bob, nod, IK de pied) sur les nouvelles longueurs d'os. Chaque chantier est jugé contre des références photo et vidéo de vrais shibas, et verrouillé par des invariants chiffrés dans `test/invariants.html`.

**Stack :** Three.js 0.185.1 vendorisé, modules ES sans build, `python3 serve.py 5173`.

**Spec :** demande validée en chat le 28/10/2026 (résumée ci-dessous).
- Proportions : le cou est trop long ; les pattes sont trop pliées (le chien marche accroupi). Visé : membres presque droits sous le corps, arrière modérément angulé, jarrets courts, tête compacte, museau court, poitrail profond, rapport hauteur/longueur 10:11, queue en faucille.
- Animation : les allures manquent de naturel. Visé : trot en diagonale, dos stable sans tangage, tête qui bouge peu, transitions et arrêt crédibles.
- Hors champ : nage, aboiement, toilette, empreintes. On les réajuste seulement s'ils cassent.

## Contraintes globales

- Lire d'abord `AGENTS.md` et `docs/pieges.md` (n° 11 et 12 en particulier). Lancer avec `python3 serve.py 5173`, jamais `python -m http.server`.
- Aucun build, aucune dépendance nouvelle. Three.js reste le vendorisé.
- Le rig garde son contrat avec `shiba.js` : les noms d'os `hip / knee / paw`, `tilt`, `body`, `pelvis`, `neck`, `head`, `jaw`, `earL/R`, `tailBase`, `scapF*`.
- `SHIBA_BUILD.withers × scale` doit rester au-dessus de `SHIBA.swimFloat + 0.03` (invariant existant).
- Fin de chaque tâche : `git diff` relu, `node --check` sur chaque fichier JS touché, `test/invariants.html` à 0 fail (en `?q=low` ET `?q=ultra`), vérification visuelle dans le navigateur, puis commit. Si le câblage de `main.js` change : `python3 tools/gen-cablage.py`.
- Étalon externe obligatoire : au moins 4 références réelles (profil debout, profil au trot, face, 3/4) trouvées sur le web, avec leurs URL notées dans le rapport. Captures du chien sous les mêmes angles avant et après le chantier.
- Commits en français, au format du dépôt (`feat: shiba — …`, `tune: shiba — …`).

## Points de vigilance

1. **Pose assise / couchée / toilette** après le changement de longueurs d'os : pas de pied dans le sol, pas de patte à travers le corps (`SIT_POSE`, banc 26).
2. **Nage** : le garrot émerge toujours, et les pattes ne sortent pas du dos de l'eau.
3. **Terrain en pente** (chemins de l'île) : les semelles restent au sol, sans enfoncement supérieur à celui d'aujourd'hui.
4. **Virage sur place et arrêt brusque** : pas de pop de pose, pas de pieds qui glissent.
5. **Collerette et skinning** : le cou raccourci ne doit pas pincer la peau quand la tête regarde, aboie ou hoche.

---

### Tâche 1 : proportions du shiba

**Fichiers :**
- Modifier : `src/shiba-geom.js` (`SHIBA_BUILD`, `PAW_SOLE`, `SIT_POSE`, `BONES`, `SCAPULA`, `LEG`, `bodyPrims`, pièces rigides si besoin)
- Modifier si nécessaire : `src/shiba.js` (constantes qui dépendent des longueurs d'os : `TOE_LEN`, crouch par défaut à l'arrêt)
- Modifier : `tools/shiba-studio.html` (seulement s'il casse)
- Test : `test/invariants.html` (nouveaux invariants « proportions shiba »)

**Interfaces :**
- Produit : les mêmes exports qu'aujourd'hui (`SHIBA_BUILD`, `PAW_SOLE`, `SIT_POSE`, `buildBody`), avec de nouvelles valeurs. La tâche 2 en dépend.

- [ ] **Étape 1 : références.** Trouver au moins 4 photos de shibas adultes (profil debout, profil au trot, face, 3/4). Y mesurer les rapports : hauteur au garrot / longueur du corps, longueur visible du cou (garrot → occiput) / hauteur au garrot, longueur de la tête / hauteur au garrot, hauteur du coude / hauteur au garrot, angle épaule-coude-carpe à l'avant debout, angle hanche-grasset-jarret à l'arrière, hauteur du jarret / hauteur au garrot. Noter les URL et les valeurs (moyenne et fourchette) en tête de `src/shiba-geom.js`, dans le bloc « Références ».
- [ ] **Étape 2 : captures « avant ».** Prendre le chien dans la scène, debout et au trot, sous les mêmes angles. Écrire une sonde jetable qui mesure les mêmes rapports sur le rig actuel (positions des os en pose debout, angles des articulations à l'arrêt ET à mi-appui au trot). Noter l'écart à chaque référence.
- [ ] **Étape 3 : invariants qui échouent.** Ajouter dans `test/invariants.html` un invariant « proportions shiba » qui vérifie sur `buildBody()` / `createShiba` à l'arrêt :
  - chaque rapport de l'étape 1 tombe dans la fourchette mesurée sur les références ;
  - l'angle du membre avant debout (épaule-coude-carpe) est à au plus 12° du droit ;
  - le garrot à l'arrêt après crouch est à au moins 97 % de `SHIBA_BUILD.withers` (le chien ne s'accroupit pas debout).
  Lancer la page : l'invariant doit échouer sur le modèle actuel, au moins pour le cou et les pattes.
- [ ] **Étape 4 : remodeler.** Raccourcir le cou (os `neck` et `head`, cônes de cou et de collerette), redresser les membres (`LEG`, `SCAPULA`), puis recaler `PAW_SOLE`, `SIT_POSE` et les primitives de pattes et de pieds. La tête reste stylisée à environ +15 %, comme aujourd'hui. Garder la robe et l'urajiro.
- [ ] **Étape 5 : vérifier.** Invariants à 0 fail en `?q=low` et `?q=ultra`. Captures « après » sous les mêmes angles que l'étape 2, comparées aux références, avec les mesures de la sonde avant/après dans le rapport. Contrôler aussi : assis, couché, toilette, nage, aboiement et regard (points de vigilance 1, 2 et 5).
- [ ] **Étape 6 : commit.** `feat: shiba — proportions du vrai chien (cou court, membres droits)`.

### Tâche 2 : allures naturelles

**Fichiers :**
- Modifier : `src/shiba.js` (`GAITS`, crouch, `locomotionBodyY`, roll, `flex`, `lat`, `sag`, `bounce`, `nod`, `bob`, transitions marche/trot/galop/arrêt)
- Test : `test/invariants.html` (nouvel invariant « allure shiba », plus les invariants « pattes au trot / au galop » existants)

**Interfaces :**
- Consomme : le rig de la tâche 1 (mêmes noms d'os, nouvelles longueurs).

- [ ] **Étape 1 : références de mouvement.** Trouver au moins 2 vidéos de shibas au pas et au trot, de profil (et du galop si possible). Relever : l'appariement des pattes au trot (diagonales synchrones), l'ordre des appuis au pas (latéral à 4 temps), l'amplitude verticale du garrot, le tangage du dos, le hochement de tête, la cadence (Hz) à chaque allure, l'extension des membres en fin de foulée. Noter les URL et les valeurs.
- [ ] **Étape 2 : mesure « avant ».** Sonde sol plat, comme dans `docs/handoff-shiba-pattes.md` (`heightAt: () => 0`, `KeyW` puis `ShiftLeft`, 300 images à 1/60). Mesurer les mêmes grandeurs que l'étape 1, avec un enregistrement GIF ou une série de captures en jeu.
- [ ] **Étape 3 : invariant qui échoue.** « allure shiba » sur sol plat, en régime établi au trot :
  - les contacts des diagonales (FL+BR, FR+BL) tombent à moins de 8 % de période l'un de l'autre ;
  - le tangage du tronc reste dans la fourchette mesurée ;
  - l'amplitude verticale du garrot reste dans la fourchette mesurée ;
  - le hochement de tête ne dépasse pas la fourchette mesurée ;
  - au pas, l'ordre des appuis est latéral à 4 temps.
  Il doit échouer sur au moins un critère avant modification. Sinon, le dire dans le rapport et viser les critères visuels de l'étape 5.
- [ ] **Étape 4 : retravailler les allures.** Ajuster `GAITS` et la mise en mouvement du tronc et de la tête, rendre les transitions et l'arrêt progressifs, et garder les membres tendus à l'appui (pas de crouch). Ne pas casser l'IK de pied ni les empreintes : semelle min ≥ -0.01, glissé ≤ 0.025.
- [ ] **Étape 5 : vérifier.** Invariants à 0 fail (`?q=low` et `?q=ultra`). Côte à côte avec les références vidéo (GIF du chien au pas, au trot et au galop, de profil), plus le virage sur place, l'arrêt brusque et la pente (points de vigilance 3 et 4).
- [ ] **Étape 6 : commit.** `feat: shiba — allures naturelles (trot diagonal, dos stable)`.

### Tâche 3 : vérification indépendante (après chaque tâche)

Un relecteur en lecture seule, sans modifier les fichiers, contrôle : le diff contre la spec ci-dessus, `node --check`, les invariants (`?q=low` et `?q=ultra`) et une comparaison visuelle indépendante avec ses propres références. Il rend un verdict accepté/refusé avec des constats précis, chacun avec fichier:ligne.
