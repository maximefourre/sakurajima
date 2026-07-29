# Final fix wave — autumn night readability + golden horizon

**Base head:** `5b9ae34`  
**Verdict:** **DONE_WITH_CONCERNS** (residual golden sea/sky luminance step remains after contingency tint-cap only)

## Defects addressed

| ID | Severity | Symptom | Fix |
|---|---|---|---|
| NIGHT-1 | Major | Autumn `dayTime=.97` terrain + maple near-black at all tiers | Cool moonlit autumn night lift in `src/sky.js` only |
| HORIZON-1 | Moderate | Autumn ultra golden coast razor sea/sky seam | Plan contingency: `uSkyTintStrength` cap `.12→.08` |
| HUD-1 | Moderate (QA) | high/ultra HUD `1 draw / 0 tris` both seasons | Tiny `renderer.info` reset around composer render |

## Root cause

1. **NIGHT-1** — Shared night lighting was identical across seasons, but autumn construction palettes (terrain olive/ochre, maple dark family albedos) are substantially darker than spring pink/green. Under the same moon/hemi/exposure, autumn collapsed into near-black while spring stayed readable. Warm autumn day grades correctly zero at deep night, so they did not compensate.
2. **HORIZON-1** — Autumn dome multiplicative tint peaked at `.12` during golden hour, warming the Preetham sky relative to the shared `fogColor`/ocean horizon path and opening a crisp seam.
3. **HUD-1** — With `EffectComposer`, Three.js `renderer.info.autoReset` resets after every internal `render()`; the HUD sampled only the final fullscreen blit (1 draw / ~0 tris). Not seasonal.

## RED harness (before production)

Extended `test/atmosphere.html` with observable phase/material assertions (no source-text checks):

- autumn golden / noon `uSkyTintStrength ≤ .08`
- night fill proxy:  
  `(ambient·L(hemiGround)·1.35 + ambient·L(hemiSky)·0.45 + keyI·L(key)·0.22)·exposure`  
  must satisfy **autumn > spring × 1.18**
- night key stays cool (`b ≥ r`); hemiGround not warmer than spring; moonIntensity ≥ spring

**RED result (pre-fix):** `ATMOSPHERE: 28 pass, 2 fail`

- `FAIL — autumn golden tint strength > 0 et ≤ .08 (got 0.1138…)`
- `FAIL — nuit profonde autumn fill > spring (… spring 0.0775 autumn 0.0775)`

## Production change (minimal)

### `src/sky.js`

- Cap autumn tint: `Math.min(0.08, …)` (was `0.12`).
- Hoisted cool night targets (no per-frame alloc):  
  `AUTUMN_NIGHT_HEMI_SKY = #2c4f8f`, `AUTUMN_NIGHT_HEMI_GROUND = #141c32`.
- Autumn-only deep-night lift (all × `nightW`, so day/golden paths unchanged):
  - `moonI *= 1 + 0.32 * nightW`
  - `hemiI *= 1 + 0.42 * nightW`
  - `exposure *= 1 + 0.10 * nightW`
  - after warm day grades:  
    `_hemiSky.lerp(AUTUMN_NIGHT_HEMI_SKY, nightW²·0.28)`  
    `_hemiGround.lerp(AUTUMN_NIGHT_HEMI_GROUND, nightW²·0.62)`
- `sky.render()` also resets `renderer.info` once per frame when used.

### `src/main.js`

- Before composer/direct render: `renderer.info.autoReset = false; renderer.info.reset();`

### `test/atmosphere.html`

- Regression checks above (now green).

Spring keyframes, warm autumn day grades, fogColor sharing, and night dome/stars paths are untouched aside from the cool night lift gated by `nightW`.

## GREEN verification

| Harness | Result |
|---|---|
| `test/season.html` | `SEASON: 8 pass, 0 fail` |
| `test/invariants.html` | `INVARIANTS: 7 pass, 0 fail` |
| `test/petals.html?season=spring` | `FOLIAGE (spring): 5 pass, 0 fail` |
| `test/petals.html?season=autumn` | `FOLIAGE (autumn): 5 pass, 0 fail` |
| `test/ground-palettes.html` | `GROUND: 34 pass, 0 fail` |
| `test/atmosphere.html` | `ATMOSPHERE: 30 pass, 0 fail` |
| `node --check src/sky.js src/main.js` | OK |

Atmosphere fill after fix: **spring 0.0775 → autumn 0.1214**; golden tint **0.08**.

## Headed visual matrix (one reused tab on CDP `:9223`)

### Phase outputs at `.97` (deterministic)

| Season | ambient | moonI | exposure | hemiGround | key | tint |
|---|---:|---:|---:|---|---|---:|
| spring | 0.506 | 0.982 | 0.796 | `#060810` | `#8ea9dc` | 0 |
| autumn | **0.719** | **1.296** | **0.875** | **`#101629`** | `#8ea9dc` | 0 |

Autumn night remains cool (key blue-silver, fog blue `#121e41`, tint 0).

### Screenshots

**Before (matrix FAIL evidence, copied):**

- `fix-wave-shots/before-autumn-low-97-wide.webp`
- `fix-wave-shots/before-autumn-low-97-close.webp`
- `fix-wave-shots/before-autumn-high-97-wide.webp`
- `fix-wave-shots/before-autumn-ultra-97-wide.webp`
- `fix-wave-shots/before-autumn-ultra-97-close.webp`
- `fix-wave-shots/before-autumn-ultra-72-coast.webp`
- `fix-wave-shots/before-spring-low-97-wide.webp`

**After (stable paused + animation-loop halted, fresh frames):**

- `fix-wave-shots/after3-autumn-low-97-wide.png` — maple crowns + grass readable, blue starfield, lanterns
- `fix-wave-shots/after2-autumn-low-97-close.png` / `after2-autumn-high-97-close.png` — near meadow/crowns
- `fix-wave-shots/after3-autumn-ultra-97-maple-close.png` — orange maple lobes + grass readable under cool moon
- `fix-wave-shots/after2-autumn-ultra-97-wide.png` — forest-scale night
- `fix-wave-shots/after3-autumn-ultra-72-seaward.png` — golden hour seaward, tint=0.08
- `fix-wave-shots/after3-spring-low-97-wide.png` — spring night control (no autumn lift)

### Rendered luminance (sRGB luma bands; framing differs before/after)

| Shot | canopy L | ground L | notes |
|---|---:|---:|---|
| before autumn low close | **5.64** | 10.24 | near-black foliage |
| after autumn low close (`after2`) | **134.0*** | 16.23 | *band includes bright night sky through canopy gaps |
| before autumn ultra close | **3.19** | 4.06 | collapsed |
| after autumn ultra maple close | **11.50** | 23.08 | orange maple readable; ~3.6× canopy lift |
| before golden coast seam Δrow | **45.8** | — | razor horizon |
| after golden seaward seam Δrow | 59.5 | — | still a luminance step (concern); tint capped |

Visual read of after maple close / low wide: leaf shape, family color, grass blades and terrain relief are legible; sky stays deep blue with stars; no orange night grade.

### HUD after fix

| Tier | HUD sample |
|---|---|
| autumn low `.97` | `~110 draw calls / 2.4M tris` |
| autumn high `.97` | `139 draw calls / 9.15M tris` (composer on) |
| autumn ultra `.97` | `155 draw calls / 23.25M tris` |
| autumn ultra `.72` | `163–185 draw calls / ~23–27M tris` |

No longer `1 / 0.00M` on high/ultra.

## HUD ruling

**FIXED (tiny, isolated, covered by headed observation).**  
Cause was composer multi-pass `info` auto-reset, not seasonal rendering. Fix is two lines around the existing render path in `main.js` (+ mirror in `sky.render`). Safe relative to shading. Leave in.

## Concerns

1. **HORIZON-1 residual:** Cap `.08` alone does not fully erase the golden-hour sea/sky luminance step on a pure seaward framing. Further work would need a shared horizon grade beyond the plan’s first contingency (still must not fork ocean fog color).
2. Capture clock labels can lag when the rAF loop is halted for stable screenshots; phase/`dayTime` values above are authoritative.
3. Absolute screenshot band luma is framing-sensitive; phase fill metrics + maple close visual are the primary NIGHT-1 evidence.

## Files touched

- `src/sky.js`
- `src/main.js`
- `test/atmosphere.html`
- `.superpowers/sdd/autumn-momiji-plan/final-fix-report.md`
- `.superpowers/sdd/autumn-momiji-plan/fix-wave-shots/*`
