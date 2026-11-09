# Pokémon Generations 6–9 — Sprite Availability Audit

**Status:** read-only audit. Nothing was implemented, deployed or enabled. No production data, deployment config or live sprite reference was touched.
**Date:** 2026-11-09. **Code audited:** branch `feature/release-c-achievements` (commit `33b797a2`, master `440f9c73` + Release C), checked out read-only in a separate worktree.
**Companion files:** `pokemon-sprite-inventory.csv` (every species and form), `MISSING-ANIMATIONS.md`, `SPRITE-SOURCES-AND-LICENSING.md`, `BOT-EXPANSION-COMPATIBILITY.md`, `GEN6-9-ROLLOUT-RECOMMENDATIONS.md`.

---

## 1. Headline results

- **376 new species audited** (Gen 6: 72, Gen 7: 88, Gen 8: 96, Gen 9: 120), plus **361 alternate forms** tracked separately. That is 737 inventory rows in all.
- **Verified animated 2D coverage (A+B):** Gen 6 75.0%, Gen 7 84.1%, Gen 8 69.8%, Gen 9 20.8%. Overall 220 of 376 (58.5%).
- **Fully ready (A: animated front and animated shiny, both published):** 212 of 376 (56.4%).
- **Static-only (C):** 156 species. Every one has a verified BW-style static front and a static shiny.
- **Artwork-only (D), no asset (E), unverified (U):** 0 / 0 / 0 at species level. Every new species has at least a static 2D pixel-art sprite in the bot's existing style.
- **Gen 9 is the gap.** Only 25 of 120 species are animated, and no Gen 9 species has an animated back sprite.
- **The bot's current sprites are byte-identical to PokéAPI's `black-white/animated` set** (e.g. `normal/25.gif` = PokéAPI `animated/25.gif`, md5 `8c27b9d8…`). The Gen 6–9 animations in that same folder, and in Showdown's `gen5ani`, come from the Smogon BW-style community projects. They match the existing look.

## 2. Classification (species)

### T1 Species classification by generation

| Generation | Total species | A | B | C | D | E | U | Animated 2D coverage % (A+B) | Fully ready % (A) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Gen 6 | 72 | 48 | 6 | 18 | 0 | 0 | 0 | 75.0% | 66.7% |
| Gen 7 | 88 | 74 | 0 | 14 | 0 | 0 | 0 | 84.1% | 84.1% |
| Gen 8 | 96 | 65 | 2 | 29 | 0 | 0 | 0 | 69.8% | 67.7% |
| Gen 9 | 120 | 25 | 0 | 95 | 0 | 0 | 0 | 20.8% | 20.8% |
| **Total** | **376** | **212** | **8** | **156** | **0** | **0** | **0** | **58.5%** | **56.4%** |

### T2 Individual asset coverage — fronts and shiny (species)

| Generation | Species | Animated front | Animated shiny front | Static front | Static shiny | Official artwork |
|---|---:|---:|---:|---:|---:|---:|
| Gen 6 | 72 | 54 (75.0%) | 48 (66.7%) | 72 (100.0%) | 72 (100.0%) | 72 (100.0%) |
| Gen 7 | 88 | 74 (84.1%) | 74 (84.1%) | 88 (100.0%) | 88 (100.0%) | 88 (100.0%) |
| Gen 8 | 96 | 67 (69.8%) | 66 (68.8%) | 96 (100.0%) | 96 (100.0%) | 96 (100.0%) |
| Gen 9 | 120 | 25 (20.8%) | 25 (20.8%) | 120 (100.0%) | 120 (100.0%) | 120 (100.0%) |
| **Total** | **376** | **220 (58.5%)** | **213 (56.6%)** | **376 (100.0%)** | **376 (100.0%)** | **376 (100.0%)** |

### T3 Individual asset coverage — back sprites (species)

| Generation | Species | Animated back | Animated shiny back |
|---|---:|---:|---:|
| Gen 6 | 72 | 42 (58.3%) | 38 (52.8%) |
| Gen 7 | 88 | 69 (78.4%) | 69 (78.4%) |
| Gen 8 | 96 | 59 (61.5%) | 59 (61.5%) |
| Gen 9 | 120 | 0 (0.0%) | 0 (0.0%) |
| **Total** | **376** | **170 (45.2%)** | **166 (44.1%)** |

### T4 Shiny readiness per species (what a shiny roll could display)

| Generation | Animated shiny | Animated normal but shiny only static | Animated normal, no distinct shiny at all | Static only: static shiny | Static only: no shiny |
|---|---:|---:|---:|---:|---:|
| Gen 6 | 48 | 6 | 0 | 18 | 0 |
| Gen 7 | 74 | 0 | 0 | 14 | 0 |
| Gen 8 | 66 | 1 | 0 | 29 | 0 |
| Gen 9 | 25 | 0 | 0 | 95 | 0 |

### T5 Alternate forms (counted separately from species)

| Form group | Forms | A | B | C | D | E | U | Animated (A+B) | Animated shiny |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Alolan forms | 21 | 19 | 0 | 0 | 2 | 0 | 0 | 90.5% | 19 |
| Galarian forms | 20 | 13 | 0 | 7 | 0 | 0 | 0 | 65.0% | 13 |
| Hisuian forms | 16 | 6 | 0 | 10 | 0 | 0 | 0 | 37.5% | 6 |
| Paldean forms | 4 | 1 | 0 | 3 | 0 | 0 | 0 | 25.0% | 1 |
| Mega Evolutions | 91 | 24 | 0 | 66 | 1 | 0 | 0 | 26.4% | 24 |
| Primal Reversions | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 100.0% | 2 |
| Gigantamax | 34 | 9 | 2 | 23 | 0 | 0 | 0 | 32.4% | 9 |
| Terastal forms | 6 | 2 | 0 | 0 | 4 | 0 | 0 | 33.3% | 2 |
| Other battle-only forms | 21 | 9 | 0 | 9 | 3 | 0 | 0 | 42.9% | 9 |
| Gender-specific (sprite-only) | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 100.0% | 1 |
| Cosmetic forms | 22 | 5 | 0 | 8 | 9 | 0 | 0 | 22.7% | 5 |
| Other visually distinct forms | 123 | 84 | 1 | 36 | 2 | 0 | 0 | 69.1% | 85 |
| **All forms** | **361** | **175** | **3** | **162** | **21** | **0** | **0** | **49.3%** | **176** |

### T6 Mega Evolutions by era

| Era | Megas | A | B | C | D | E | U |
|---|---:|---:|---:|---:|---:|---:|---:|
| X/Y + ORAS megas | 48 | 24 | 0 | 24 | 0 | 0 | 0 |
| Legends: Z-A (2025) megas | 43 | 0 | 0 | 42 | 1 | 0 | 0 |

### T7 Paradox and legendary/mythical species

| Group | Species | A | B | C | D | E | U |
|---|---:|---:|---:|---:|---:|---:|---:|
| Paradox Pokémon | 20 | 7 | 0 | 13 | 0 | 0 | 0 |
| Legendary | 36 | 25 | 1 | 10 | 0 | 0 | 0 |
| Mythical | 10 | 8 | 0 | 2 | 0 | 0 | 0 |
| Ultra Beasts | 11 | 9 | 0 | 2 | 0 | 0 | 0 |

### T8 Rollout options — eligible species per generation

| Generation | Total | Option A: animated + animated shiny (A) | Option A′: any published animated front (A + published B) | Option B: animated or static 2D (A+B+C) | Option C: whole generation |
|---|---:|---:|---:|---:|---:|
| Gen 6 | 72 | 48 (66.7%) | 54 (75.0%) | 72 (100.0%) | 72 (100%) |
| Gen 7 | 88 | 74 (84.1%) | 74 (84.1%) | 88 (100.0%) | 88 (100%) |
| Gen 8 | 96 | 65 (67.7%) | 66 (68.8%) | 96 (100.0%) | 96 (100%) |
| Gen 9 | 120 | 25 (20.8%) | 25 (20.8%) | 120 (100.0%) | 120 (100%) |
| **Total** | 376 | 212 (56.4%) | 219 (58.2%) | 376 (100.0%) | 376 (100%) |

### T9 Source contribution (species, animated front)

- Showdown `gen5ani` (preferred where present): 217
- PokéAPI `black-white/animated` only: 2
- Smogon tracker attachment only (unpublished): 1
- None: 156

Mirror check, all 396 entries with an animated front on either mirror: identical bytes 136, both present but different files 197, Showdown only 54, PokéAPI only 9.

Animated front file size (species, preferred file): median 41 KiB, max 201 KiB, total 12.0 MiB for 220 files.

### How to read these tables

- **A** — a verified animated BW-style front **and** a distinct animated shiny front, both on a published mirror (Showdown or PokéAPI).
- **B** — animated front verified, but the animated shiny is missing (7 species: Chesnaught, Pangoro, Honedge, Inkay, Malamar, Noivern, Falinks), or the animation exists only as an unpublished Smogon tracker attachment (Spectrier).
- **C** — no verified animated 2D sprite. A verified static BW-style front exists.
- **D / E / U** — none at species level. At form level, D = 21 (mostly totem forms, Furfrou trims, Ogerpon Terastal forms and Z-A Mega Meowstic). In these cases the only "pixel" candidates were downscaled render placeholders, and they were rejected.
- "Animated shiny" counts only when the shiny GIF differs from the normal GIF. Byte-identical "shiny" copies are treated as missing.

## 3. What was checked, and how

### 3.1 Canonical Pokédex

| Source | Retrieved | Used for |
|---|---|---|
| `@pkmn/dex` 0.10.12 (Pokémon Showdown data, MIT). Already a dev dependency of the bot. | 2026-11-09 | Species list 650–1025, forms, Showdown sprite ids, types |
| PokéAPI `data/v2/csv` (`pokemon_species.csv`, `pokemon.csv`, `pokemon_forms.csv`), master branch | 2026-11-09 | Generation, legendary/mythical flags, gender-difference flags, numeric form ids for PokéAPI sprite paths, cross-generation evolutions |

The species counts match the expected totals exactly: 72 / 88 / 96 / 120 = 376. The entry list is saved as `sources/gen6-9-entries.json`.

**Forms included** (361): every forme of a #650–1025 species, plus every Gen 6+ forme of a #1–649 species (Megas, Primal, Alolan/Galarian/Hisuian/Paldean, Gigantamax, Pikachu caps and similar), cosmetic formes, and Pyroar's female sprite. Paradox Pokémon (20) are **species**, not forms. They appear in T7, not T5. Forms are never counted toward species totals.

### 3.2 Sprite sources audited

| Source | Style verdict | Gen 6–9 relevance | Treated as |
|---|---|---|---|
| Showdown `sprites/gen5ani`, `gen5ani-shiny`, `gen5ani-back`, `gen5ani-back-shiny` | **BW 2D pixel art** (Smogon projects) | 1,255 / 1,252 / 1,137 / 1,135 files | Primary animated source |
| Showdown `sprites/gen5`, `gen5-shiny` | BW 2D pixel art, **except ~52 Gen 9 / Z-A Mega files that are downscaled 3D renders** (1,400–3,000 colours, soft alpha) | 1,673 / 1,651 files | Static source. Render placeholders rejected |
| PokéAPI `versions/generation-v/black-white/animated` (+shiny/back) | BW 2D pixel art. **Mirror** of the Smogon projects | 219 of 376 species | Mirror / alternate. Primary for 2 species and 7 totem forms Showdown lacks |
| PokéAPI `versions/generation-v/black-white` and root `pokemon/{id}.png` (byte-identical for 650+) | BW 2D pixel art | 376 of 376 species | Static source. Real pixel art where Showdown has placeholders |
| Smogon tracker spreadsheets (Gen 6, 7, 8, 9) | Upstream of the above | 8 tabs exported | Used to attribute artists and to find unpublished animations |
| Showdown `sprites/ani` (+shiny/back); PokéAPI `other/showdown` (byte-identical mirror of `ani`) | **3D-model animations** (rendered model GIFs; some palette-reduced to about 15 colours, still 3D-shaded) | 1,686 files | **Rejected for style.** Recorded per row as "3D GIF exists" |
| Showdown `gen6`, PokéAPI `x-y`/`omega-ruby-alpha-sapphire`/`ultra-sun-ultra-moon`/`sword-shield`/`scarlet-violet`/`legends-*`/`champions` | 3DS / HOME model renders (249+ colours; WebP for Champions) | — | Rejected for style. Not counted |
| Showdown `dex`, `home`; PokéAPI `other/home` | 3D renders | — | Counted only as "render fallback" (D) |
| PokéAPI `other/official-artwork` | Official 2D artwork | 376 of 376 species | Artwork fallback (D) |

The visual check (`scripts` contact sheets, random sample of 42 A/C sprites plus all flagged files) confirmed that every A and C sprite is hard-edged BW-style pixel art. It also confirmed the Showdown `ani` / PokéAPI `other/showdown` files are 3D-model animations.

### 3.3 File verification (per file, not per filename)

Every candidate file (5,202 files, about 165 MB, plus 4 imgur links resolved to direct files) was downloaded to a local scratch cache and decoded with Pillow 12.3. These were recorded per file:

- HTTP status, byte size, SHA-1
- real format (from the file header, not the extension), dimensions
- frame count, **unique** composited frame count, total loop duration, loop flag
- colours per sampled frame and the number of distinct alpha levels (the pixel-art vs render test)

Rules:
- *Animated* = at least 2 unique frames. A GIF with only one unique frame would count as static. None was found.
- *2D pixel art* = binary alpha with ≤128 colours, or ≤64 colours. BW sprites use ≤16. 3D renders and HOME art use thousands of colours and soft alpha.
- *Shiny* must differ (SHA-1) from the normal sprite.
- *Decode failures:* 2 Showdown `gen5-shiny` files (`alcremie-lemoncream.png`, `alcremie-rubyswirl.png`) do not decode. 4 tracker cells point at imgur *pages*. These were resolved to `i.imgur.com/<id>.gif` and then verified.

Animation characteristics of the 220 animated species fronts: 8–180 frames (median 79), loop 0.8–17.2 s (median 7.8 s), all `loop=0` (infinite), all binary transparency. File size: median 41 KiB, max 201 KiB, 12.0 MiB in total.

### 3.4 Mirror / duplicate analysis

The same artwork appears in several places. It is counted **once** per entry. The preferred file is Showdown `gen5ani`, and the other copy is recorded as `alternate_source`.

| Collection | Relationship |
|---|---|
| PokéAPI `black-white/animated` 650+ | Mirror of Showdown `gen5ani`. Of 396 entries with an animated front on either mirror, 136 are byte-identical and 197 are the same sprite in a different file. Showdown usually crops to the sprite, and PokéAPI keeps the 96×96 canvas or an older revision (frame counts differ in 49 cases). Showdown-only: 54. PokéAPI-only: 9 (Blipbug, Carkol, 7 totem forms). |
| PokéAPI `other/showdown` | Byte-identical mirror of Showdown `ani` (3D). Rejected. |
| PokéAPI root `pokemon/{id}.png` (650+) | Byte-identical to PokéAPI `black-white/{id}.png` |
| Smogon forum attachments | Upstream originals, reached through the trackers. Published copies end up on Showdown, then PokéAPI. |
| Showdown `sprites.zip` (linked from the sprites index) | Bundle of the same folders. Not separately counted. |

**Cropping note:** the bot's existing GIFs are cropped (e.g. Pikachu 50×46). Showdown `gen5ani` is mostly cropped too, but some files are 96×96 (19 class-A species). Implementation should trim transparent borders once, at import, so thumbnails line up.

### 3.5 Community spreadsheet (accessed, not blocked)

The spreadsheet given in the brief (`1FMcHbSK…`) is readable without sign-in. It is the **Sun/Moon (Gen 7) Sprite Project** tracker, with tabs `static sprites`, `animated sprites`, `large icons` and `other generations`. The `other generations` tab links three sibling trackers:

| Tracker | Sheet id |
|---|---|
| Gen 6 (X/Y) Sprite Project | `1Gn0UORn-unvcbUeQhQdEBz0ADNcH49BZZqQ1dpXm9eo` |
| Gen 7 (Sun/Moon) Sprite Project | `1FMcHbSKEWZc7v2Ur4cyJjT_NhO0gqXyU9kDhsOQhlBQ` |
| Gen 8 Sprite Project | `1acgzAjh0dnFRQnjZu8kSjS177rKCzpFfEHRLtwuuXRU` |
| Gen 9 Sprite Project | `1MCjDktTOOFjLKM5C-RW6SfBQGkjlxDSCZAZDma_ItuA` |

All `static sprites` and `animated sprites` tabs were exported as CSV (`sources/smogon-trackers/`). Each row has Front / Back / Front-shiny / Back-shiny attachment links, the animator, and QC. Limits that apply:

- **Cell colour is lost in CSV export.** The Gen 6 static tab says "pink links are not final, grey links are final". Final vs. draft could not be read from the export, so tracker-only assets are classified B with *low* confidence.
- **The trackers contain errors.** The Gen 8 row numbered 894 is labelled "Regidrago" and links Regidrago files (Regieleki is #894). Gigantamax rows reuse base-species names. Form rows sit inside the species section. The matcher (`scripts/02-probe-sources.py`) matches by section, then exact name, then number, and `03-classify.py` rejects tracker links whose file name names a different Pokémon or a Gigantamax sprite. Rows that could not be matched to an entry (mostly Alcremie sweet variants, Castform, partner-cap Pikachu/Eevee, and defaults of pre-Gen 6 species) are listed in §6.
- Reservations ("arinoelle (reserved)", "nyx (reserved)") show which missing animations are being worked on. They are visible per row in the tracker CSVs.

## 4. Special forms

See T5–T7 above. In summary:

- **Regional forms:** Alolan 19/21 animated (the 2 misses are totem-sized forms). Galarian 13/20. Hisuian 6/16. Paldean 1/4.
- **Megas:** 24 of 48 X/Y+ORAS Megas animated. **0 of 43 Legends: Z-A Megas animated.** 42 of those have a PokéAPI static pixel sprite, and Showdown has only render placeholders for them.
- **Primal:** 2/2 animated. **Gigantamax:** 11/34 animated (9 A, 2 B). **Terastal:** 2/6 animated (Terapagos forms). The 4 Ogerpon Tera forms are D.
- **Paradox Pokémon:** 7/20 animated (Great Tusk, Flutter Mane, Iron Hands, Iron Moth, Iron Thorns, Iron Valiant, Gouging Fire). 13 are static only.
- **Gender:** Pyroar-F animated. Meowstic-F, Indeedee-F, Basculegion-F and Oinkologne-F are formes, listed under "other".
- **Legendary/Mythical:** 33 of 46 are A. Static only: Tapu Fini, Kubfu, Urshifu, Zarude, Regieleki, Enamorus, Koraidon, Okidogi, Munkidori, Fezandipiti, Ogerpon, Pecharunt. Spectrier is B (animation only on the tracker).

## 5. Limitations and confidence

- Confidence (species): **high** 366, **medium** 9, **low** 1 (Spectrier, tracker-only, on imgur).
- **Species completeness ≠ asset completeness.** "Static front 100%" means the bot can show *something* in-style for every species. It does not mean a full set (back, animated shiny) exists. T2/T3 give per-asset counts.
- Showdown and PokéAPI are live repositories. Results are a snapshot: Showdown directory listings and PokéAPI `PokeAPI/sprites` at commit `1b3b7c0a` (2026-11-03), both fetched 2026-11-09. New Smogon animations are published continually. For example, several Gen 7 files on Showdown are dated 2026-07-14.
- The pixel-art test is heuristic. Every file it flagged was checked by eye, and a random sample of passes was checked by eye.
- Back sprites were checked for availability and decoding, but not visually reviewed one by one. The bot does not display backs today.
- Pokémon Essentials sprite packs and other community collections were **not file-verified** in this audit. They are recorded as **U (unverified source)** in `SPRITE-SOURCES-AND-LICENSING.md` §3. This does not change any classification: every species already has a verified in-style static sprite. Those packs could only add animations for the 156 C species, and that would need a separate check.

## 6. Tracker rows not matched to an inventory entry

92 static-tab rows and 6 animated-tab rows. These are mostly variants the inventory does not track separately:
- Castform weathers: pre-Gen 6 species.
- Zygarde Cell: not a battle forme.
- Partner Pikachu/Eevee by gender.
- 63 Alcremie cream × sweet combinations: the inventory tracks the 9 Showdown cream formes.
- Hisuian rows in the Gen 8 static tab that have no section header.
- Mabosstiff, which is misspelled in the tracker.

The full list is printed by `02-probe-sources.py` (`unmatchedSheetRows` in its output). None of these changes a species classification.

## 7. Reproduce

All scripts are read-only. They only issue HTTP GETs of public files and write to a local cache.

```bash
# 0. inputs (scratch directory of your choice: $W)
git clone --filter=blob:none --no-checkout https://github.com/PokeAPI/sprites.git $W/pokeapi-sprites
git -C $W/pokeapi-sprites ls-tree -r --name-only HEAD > $W/pokeapi-tree.txt
for f in pokemon pokemon_species pokemon_forms; do curl -sfL -o $W/csv/$f.csv https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/$f.csv; done
for d in gen5ani gen5ani-shiny gen5ani-back gen5ani-back-shiny gen5 gen5-shiny ani ani-shiny dex home gen6; do curl -sfL -o $W/sd/ls_$d.html https://play.pokemonshowdown.com/sprites/$d/; done
# tracker CSVs: https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<gid> (ids/gids in §3.5; copies in sources/smogon-trackers)
# 1-5
node scripts/01-build-dex.mjs <bot>/node_modules $W/csv $W/dex.json
python -P -E scripts/02-probe-sources.py --dex $W/dex.json --listings $W/sd --tree $W/pokeapi-tree.txt --pokeapi-csv $W/csv --sheets sources/smogon-trackers --cache $W/cache --out $W/results.json
python -P -E scripts/03-classify.py --results $W/results.json --cache $W/cache --csv pokemon-sprite-inventory.csv --summary $W/summary.json
python -P -E scripts/04-report-tables.py $W/summary.json > $W/tables.md
python -P -E scripts/05-missing-animations.py $W/summary.json MISSING-ANIMATIONS.md
```

Animated-tab gids: Gen 6 `1197499454`, Gen 7 `1194128475`, Gen 8 `1786391859`, Gen 9 `546004762`. Static tabs are `gid=0`.
