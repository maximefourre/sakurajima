#!/usr/bin/env python3
"""Régénère docs/symbols.txt : un export par ligne, greppable.

    python3 tools/gen-symbols.py

Format : `nom  fichier:ligne  signature`. Section finale : ordre de câblage
de main.js (appels create*/init*/attach).
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "docs" / "symbols.txt"

DECL = re.compile(r"^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)\s*(.*)")
LIST = re.compile(r"^export\s*\{([^}]*)\}")
WIRE = re.compile(r"\b((?:create|init)[A-Z]\w*|\w+\.attach)\s*\(")


def signature(name, rest):
    rest = rest.strip()
    if rest.startswith("("):
        depth = 0
        for i, ch in enumerate(rest):
            depth += ch == "("
            depth -= ch == ")"
            if depth == 0:
                return rest[: i + 1][:90]
        return rest[:90]
    rest = re.sub(r"/\*.*?\*/", "", rest).strip()
    return rest[:70]


rows, wiring = [], []
for path in sorted(SRC.glob("*.js")):
    rel = path.relative_to(ROOT).as_posix()
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if m := DECL.match(line):
            rows.append((m[1], f"{rel}:{n}", signature(m[1], m[2])))
        elif m := LIST.match(line):
            for name in m[1].split(","):
                name = name.split(" as ")[-1].strip()
                if name:
                    rows.append((name, f"{rel}:{n}", "(re-export)"))
        if path.name == "main.js" and (m := WIRE.search(line)) and "function " not in line:
            wiring.append(f"{rel}:{n}  {m[1]}")

w = max(len(r[0]) for r in rows)
lines = ["# Généré par tools/gen-symbols.py — ne pas éditer à la main.",
         "# grep -i <mot> docs/symbols.txt", ""]
lines += [f"{a:<{w}}  {b:<24}  {c}".rstrip() for a, b, c in sorted(rows, key=lambda r: r[0].lower())]
lines += ["", "## Câblage main.js (ordre d'appel)"] + wiring
OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"{len(rows)} exports, {len(wiring)} appels de câblage → {OUT.relative_to(ROOT)}")
