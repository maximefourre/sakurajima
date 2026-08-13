# Lot 1 — Côte habitée

Design du premier lot du programme Vie + POI
(`docs/superpowers/plans/2026-08-13-vie-poi-programme.md`). 13/08/2026.

## Le problème

La route `plage` s’arrête à la lisière herbe/sable (`[50.5, 71.9]·L`,
`h ≈ 1.48`). Au-delà : une laisse de galets, rien à viser, rien qui bouge.
Le sentier ne mène nulle part.

**But :** une destination sur le sable, et de la vie attachée à la laisse.

## Décisions

| Question | Choix |
| --- | --- |
| Sujet | Un pin kuromatsu + un rocher d’assise. Pas un 6ᵉ archétype sakura. |
| Vie | Crabes de laisse, pas du bois flotté. |
| Placement | Pur, testable sans WebGL : marche depuis le terminus `plage`. |
| Collision | `poi.hitsSolid` **en plus** de `island.hitsRock`. |
| `stoneYAt` | Branché dans `groundAt`, retourne **0** (prise pour le lot 2). |
| Budget crabes | 10 / 18 / 28 selon le tier. **Pas** `AREA_SOFT` : N petit et local. |
| Recette | Primitives mergées, vertex colors, `streamFor`. Zéro `Math.random()`. |

Hors lot : hérons, libellules, pas japonais, jizō, tsukubai, iwakura, torii
marin, goélands, mites, aboiement / secouement, chashitsu, bambous, 4ᵉ
sentier, bois flotté.

## Placement du pin

Depuis le dernier point de `PATHS.routes` nommé `plage`, avancer dans le
sens du dernier segment (vers le large). Premier point tel que :

- `!isOnPath(x, z, 0.25)`
- `!isInPond(x, z)`
- `WORLD.seaLevel < heightAt(x, z) < WORLD.beachTop + 0.6`
- distance au terminus `≤ 12 · LAND_SCALE`

`yaw` = azimut **vers l’intérieur** (local +Z du pin = inland, vent de mer).
Le pin est déjà hors forêt : `isLand` des cerisiers exige `h > 2.6`.

Le rocher se pose au pied, décalé vers la mer, même bande sable, hors
ruban. Plateau ~1.4 u (assez pour le shiba assis). Disques de collision :
fût `r ≈ 0.45`, rocher `r ≈ 0.9`.

## Crabes

Même bande que les galets de `details.js` : `-0.55 ≤ h ≤ beachTop·0.85`,
hors étangs. Un `InstancedMesh`. Machine à états CPU :

`idle` → `flee` si shiba `< 6 u` → `bury` (scale Y → 0) → park sous le sable.

Nez local +Z. Géométrie : carapace + 2 pinces + 6 pattes.

## API

### `src/poi.js`

```
computeShorePineSite({ heightAt, isOnPath, isInPond }) → { x, z, h, yaw } | null
placeRock(pine, heightAt, isOnPath, isInPond) → { x, z, h, yaw } | null
makeKuromatsuGeometry()
makeSittingRockGeometry(seed = SEED)
stoneYAt(x, z)            // 0
createPOI({ seed, heightAt, isOnPath, isInPond, slopeAt, season })
  → { group, stoneYAt, hitsSolid(x,z,pad), sites, dispose }
```

`sites.pine` / `sites.rock` exposent les positions pour le banc.

### `src/crabs.js`

```
computeCrabSpawns({ heightAt, isInPond, count, seed }) → [{x,z,h,yaw}]
makeCrabGeometry()
createCrabs({ seed, quality, heightAt, isInPond })
  → { mesh, update(t, shibaX, shibaZ), dispose }
```

Constantes d’art dans `config.js` (`POI`, `CRABS`). Budgets sur
`QUALITY.*.crabs`.

## Câblage

- `LOAD_STEPS` 13 → 14. Étape `'côte'` après `initPath` + `ponds.attach`,
  **avant** `'shiba'` (`blocked` lit `world.poi`).
- `groundAt` = `heightAt + pathSurfaceLiftAt + poi.stoneYAt` (late-binding).
- `blocked` = `island.hitsRock(x,z,0.35) \|\| poi.hitsSolid(x,z,0.35)`.
- Boucle : `crabs.update(t, dogX, dogZ)` près de la faune.
- `sakura.js` / `grass.js` intouchés. `isLand` refuse déjà le sable.

## Invariants (purs)

1. `computeShorePineSite` ne rend pas `null`. Le site est hors chemin, hors
   étang, dans la bande sable, à moins de `12·L` du terminus `plage`.
2. `placeRock` ne rend pas `null`. Le rocher est hors chemin, dans la bande
   sable, vers le large par rapport au fût.
3. `computeCrabSpawns` rend exactement `QUALITY[tier].crabs` individus, tous
   dans la bande de laisse, aucun dans un étang.

Ne pas figer le total `N pass`. Le contrat reste `0 fail` en `?q=low` et
`?q=ultra`.
