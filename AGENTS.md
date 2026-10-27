# Sakurajima — doc projet pour agents

Scène Three.js (0.185.1 vendorisé dans `vendor/three/`, importmap local,
**aucun build**) : île japonaise procédurale, cerisiers, chemins lanternés,
cycle jour/nuit, shiba jouable.

**Chercher avant de lire** : `grep -i <mot> docs/INDEX.md docs/symbols.txt`
donne le doc/la section ou le `fichier:ligne` exact ; ne lire que ça.
`symbols.txt` est généré (`python3 tools/gen-symbols.py`, à relancer après
ajout/renommage d'exports).
Avant de coder : `docs/pieges.md` (règles et pièges appris à l'usage).

## Workflow

Après chaque chantier : `git diff` relu, `node --check`,
`test/invariants.html` (0 fail), vérification visuelle navigateur, PUIS commit.

## Lancer

```sh
python3 serve.py 5173     # JAMAIS python -m http.server (cache les modules ES)
# http://127.0.0.1:5173/index.html   (?q=low|high|ultra)
```

- Debug : `globalThis.__sk = { world, scene, camera, renderer, controls, THREE, frame, setCamMode, clock }`.
  `world.dayTime` (0–1, 0.5 = midi), `world.paused`, `world.heightAt(x,z)`, `world.inWater(x,z)`.
- Contrôles : ZQSD, `Maj` court, `C` caméra, Espace saut, `P` pause du temps,
  `H` HUD (sauf crédit CC-BY), `Échap` reset. Boot à midi figé.
- Vercel : servi tel quel ; `.vercelignore` exclut `*.md`, `docs/`, `tools/`,
  `serve.py`. `test/` est public (voulu). `assets/shiba/LICENSE.txt` reste (CC-BY).
