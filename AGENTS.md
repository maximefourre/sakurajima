# Sakurajima — doc projet pour agents

Scène Three.js (0.185.1 vendorisé dans `vendor/three/`, importmap local,
**aucun build**) : île japonaise procédurale, cerisiers, chemins lanternés,
cycle jour/nuit, shiba jouable.

**Chercher avant de lire** :
- Code (où est un symbole, qui l'appelle, son source) : MCP
  `codebase-memory-mcp` — `search_graph`, `trace_path`, `get_code_snippet`.
  Index propre à chaque worktree : si `list_projects` ne liste pas le dossier
  courant, lancer `index_repository` dessus (quelques secondes).
- Règles, contrats, « pourquoi » : `grep -i <mot> docs/INDEX.md` donne le
  doc/la section ; ne lire que ça.
- Ordre de boot : `docs/cablage.txt` (généré : `python3 tools/gen-cablage.py`,
  à relancer après modification du câblage de `main.js`).
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
  `H` HUD, `Échap` reset. Boot à midi figé.
- Vercel : servi tel quel ; `.vercelignore` exclut `*.md`, `docs/`, `tools/`,
  `serve.py`. `test/` est public (voulu).
