#!/usr/bin/env python3
"""Régénère docs/cablage.txt : ordre de câblage de main.js, greppable.

    python3 tools/gen-cablage.py

Format : `fichier:ligne  appel` (appels create*/init*/attach, dans l'ordre).
Les symboles et leurs appelants : codebase-memory-mcp (voir AGENTS.md).
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAIN = ROOT / "src" / "main.js"
OUT = ROOT / "docs" / "cablage.txt"

WIRE = re.compile(r"\b((?:create|init)[A-Z]\w*|\w+\.attach)\s*\(")

rel = MAIN.relative_to(ROOT).as_posix()
wiring = [f"{rel}:{n}  {m[1]}"
          for n, line in enumerate(MAIN.read_text(encoding="utf-8").splitlines(), 1)
          if (m := WIRE.search(line)) and "function " not in line]

lines = ["# Généré par tools/gen-cablage.py — ne pas éditer à la main.",
         "# Câblage main.js (ordre d'appel)", ""] + wiring
OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"{len(wiring)} appels de câblage → {OUT.relative_to(ROOT)}")
