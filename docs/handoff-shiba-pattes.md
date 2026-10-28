# Handoff — pattes du shiba (worktree dédié)

Base : `main` @ `eeb9250` (empreintes au contact réel du coussinet).
Lire d'abord `AGENTS.md`, puis `docs/pieges.md` (n° 11 en particulier).

## État (28/10) : traité par l'IK de pied

Cadence liée à la vitesse, phase d'appui par patte avec ancre monde,
IK à deux os + abduction dans `poseLeg` (`reach`), décollage par les doigts.
Mesures sol plat : semelle min -0.007, glissé ≤ 0.023 au trot comme au galop,
16/16/16/16 appuis au trot (invariants « pattes au trot / au galop »). Reste à
juger en jeu : la cadence (≈ 4.0 Hz au trot, 4.2 au galop) et le virage sur place.
Voir `docs/pieges.md` n° 11-12. Ce qui suit est le diagnostic d'origine.

## Symptômes

1. **Pattes arrière pas droites** (vu en jeu par l'utilisateur, 27/10).
   Pas encore diagnostiqué : angle, aplomb latéral, ou jarret ? À regarder
   d'abord en jeu, chien de profil ET de dos, à l'arrêt puis au trot.
2. **Pieds sous le sol à l'appui**. Le dessous du coussinet descend à
   -0.05 / -0.10 u pour l'arrière (marche et course) et jusqu'à -0.08 pour
   l'avant au galop. C'est sans doute lié au point 1.
3. **Pieds qui glissent pendant l'appui**. Pas de verrouillage du pied : en
   marche, le coussinet avance encore de 0.24 à 0.65 u entre le contact et son
   point bas. Les empreintes sont posées au contact, donc le pied repart devant
   elles.
4. **Les antérieurs touchent deux fois par foulée** en marche (creux de 0.01,
   remontée à 0.11, nouveau creux). Résultat : 9/8 empreintes à l'avant contre
   5/4 à l'arrière.

## Mesures (sol plat, `heightAt = () => 0`, headless)

Sonde jetable : `createShiba({ heightAt: () => 0, water: { surfaceAt: () => null } })`,
touche `KeyW` (+ `ShiftLeft` pour la course), `update(t, 1/60)` sur 300 images.
À chaque image : `group.updateMatrixWorld(true)`, puis
`dog.group.getObjectByName('paw' + k).localToWorld(PAW_SOLE[F|B])` pour le
dessous du coussinet, et `dog.soles()` pour la semelle skinnée.
Sans touche « marche », la vitesse mesurée est de 6.4 (trot ?) ; en course, 14.8.

Courbe du coussinet en marche (y, une image sur deux) :
- FL : 0.16 → 0.01 (appui) → 0.11 → -0.03 → 0.16 …  ⇒ double creux
- BL : 0.26 (sommet) → -0.05 (appui) → 0.15 → 0.26 …

## Où regarder

- `src/shiba.js` `animate()` (~l.566) : `stride`, carriage du corps
  (`bodyYF`, `bodyPitchF`), puis `locomotionHip` / `locomotionKnee` (~l.677) par
  allure (`GAITS`, l.53).
- `src/shiba-geom.js` `poseLeg` (~l.895) : il traduit l'intention en angles
  d'omoplate / hanche / genou / pied, et tient le pied « à plat à l'appui ».
  `LEG` (l.263) donne les positions de repos des os, `PAW_SOLE` (l.56) le
  dessous du coussinet dans le repère de l'os `paw` (qui est la cheville à
  l'avant et le jarret à l'arrière).
- `tools/shiba-studio.html` : l'atelier de poses.
- Invariants déjà en place : « les pattes touchent le sol logique »
  (`test/invariants.html` ~l.904, n'utilise que la semelle la plus basse) et
  « milieu des appuis » (~l.1551). Aucun ne borne l'enfoncement par patte ni le
  glissement à l'appui.

## Pistes (non tranchées)

- Enfoncement : borner chaque semelle à l'appui (≥ -0.02) dans un invariant
  d'abord, puis corriger la hauteur du corps ou les angles arrière plutôt que
  de relever le chien en bloc.
- Glissement : IK de pied à l'appui (le pied reste fixé au point de contact,
  la hanche/le genou compensent), ou faire coller la longueur de foulée à la
  vitesse (`stride` contre `state.speed`).
- Double appui avant : vérifier la courbe `locomotionHip` / `Knee` de l'allure
  dominante en marche.

## Contrats à ne pas casser

- Les empreintes et la poussière se déclenchent sur `PAW_SOLE` (hystérésis
  < 0.03 / > 0.08 au-dessus de `heightAt`). Si la pose change, revérifier
  qu'elles tombent sous le pied (sonde ci-dessus : écart au contact ≤ 0.03).
- Les gerbes d'eau restent sur la phase de l'allure (nage).
- Invariants headless : 95 réussis, 1 échec déjà connu (« papillons … sous le
  sol »), sans rapport.

## Vérifier

`node --check`, `test/invariants.html`, puis en jeu à midi figé : le chien de
profil au pas, au trot et au galop, et de dos à l'arrêt.
Chrome headless local, si l'extension n'est pas disponible :
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --virtual-time-budget=120000 --dump-dom <url>`
