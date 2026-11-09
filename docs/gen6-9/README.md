# Generations 6–9 — implementation overview

Branch `feature/gen6-9`, built on Release C (`origin/feature/release-c-achievements` @ `0d4bbea9`, PR #51, not yet merged to `master`). Production `master` is `440f9c73`. Nothing here is deployed, and no generation is released by default.

Related documents:
- `RELEASE-CHECKLIST.md`: per-generation release, deployment, backup and rollback.
- `BALANCE.md` + `BALANCE-DATA.md`: economy impact and proposals.
- `PATCH-NOTES-DRAFT.md`: player-facing notes.
- `OUTSTANDING.md`: incomplete functionality and open decisions.
- `../audits/pokemon-gen6-9/`: the sprite audit this work is built on.

## What is implemented

| Area | Where | Status |
|---|---|---|
| National Pokédex #1–1025 (376 new species: names, flavor text, generation, region, modern types, tags, evolution links and official evolution methods, rarity tier) | `pokemonData.json`, `public/pokemonData.json` (identical), `tools/generate-pokedex.mjs` | Done, tested |
| Gen 1–5 entries | `data/pokedex/gen1-5-baseline.json` (frozen) | Names, tiers, regions, flavor text and existing evolution links unchanged. Only approved changes: Fairy retypes (22), `generation`/`tags` fields, 8 new evolution links |
| Fairy type (#18) | `utils/battle/data.js`, battle generator, `public/sprites/types/18.png` | Done: modern chart, type-specialist achievement, icon, dashboard filter (already existed) |
| Battle data for all 1,025 | `battleData.json`, `tools/generate-battle-data.mjs` | Done. #1–649 keep Gen 5 stats and moves. #650–1025 use their latest generation's stats and level-up moves. 460 moves (298 from Gen 5) |
| Sprites: normal, shiny and grayscale for all 376 | `public/sprites/pokemon/{normal,shiny,grayscale}/<id>.gif`, `data/sprites/sprites.json`, `tools/import-sprites.mjs` | Done: 220 animated + 156 static normals, 213 animated + 163 static shinies. Every file matches the audited SHA-1 |
| Sprite resolution | `utils/sprites.js` | Manifest-checked. A missing variant shows the Poké Ball placeholder, never the normal sprite as a shiny |
| Public URL (Fly) | `utils/publicUrl.js` | `PUBLIC_URL` → non-Render `RENDER_EXTERNAL_URL` → `https://$FLY_APP_NAME.fly.dev` → production Fly URL. All Render defaults removed |
| Generation controls | `config/generations.js`, `utils/speciesCatalog.js` | Gens 1–5 always on. Gens 6–9 off unless `POKEMON_GENERATIONS` lists them **and** they validate |
| Acquisition gates | chat catch, `/daily`, `/recruit`, `/quest`, shop starter pack, dashboard capture, weekly pack, evolution, `/addinventory` (`allow_unreleased` override), starter selection, plus a backstop in `selectRandomPokemonForUser` | Done, tested |
| Evolutions | `services/evolutionRules.js` | 154 edges into Gen 6+. 113 enforce the official level using the bot's Levels. The other 41 use the Stone cost (documented equivalent). The 10 evolutions that need a regional form are gated |
| Forms (361) | `data/pokedex/forms.json`, `utils/forms.js` | Architecture only: identity keys, types, stats, sprite ids, kinds. **All disabled** |
| Achievements | `catalog/achievements.js` (revision 3), `progression/achievements.js` | 16 new entries. Classic targets pinned to Gens 1–5. New-region entries hidden until their generation is live |
| Dashboard | `public/picker-pokemon/script.js`, `GET /api/pokedex-status` | Unreleased species hidden unless owned. Unreleased evolutions not offered. Level requirement shown |
| `/pokedex` | `commands/pokedex.js` | Accent/punctuation-insensitive names. Unreleased species visible only to owners. Sprite credit in the footer |
| Credits | `/credits` → `public/credits/index.html`, `tools/generate-credits.mjs` | Projects, sources, and a per-species artist list from the trackers |
| Release gate | `npm run validate:catalog [gen]` | Checks catalogue, battle data, sprite files and SHA-1s, evolution graph and form keys |
| Tests | `tests/gen69Catalog`, `gen69Generations`, `gen69Achievements`, `gen69Display` + 7 updated suites | 44/44 test files pass (`npm run test:safe`) |

## Data sources and versions

| Source | Version | Used for |
|---|---|---|
| PokéAPI CSV data | commit `e2710d30d14b3f4dc6a02a4a71e8619cd835b7ff` (2026-10-20) | Names, flavor text (earliest English entry, so no later regional-form text), generation, legendary/mythical/baby flags, evolution chains and conditions |
| `@pkmn/dex` / `@pkmn/data` (Pokémon Showdown data, MIT) | 0.10.12 (existing dev dependencies) | Modern types, base stats, learnsets, moves, type chart, forms. Cross-checked against PokéAPI: types and stats agree for all 1,025, except Minior (see below) |
| Sprite audit | `docs/audits/pokemon-gen6-9/` (probe run 2026-11-09) | `data/sprites/source-manifest.json`: exact source URL and SHA-1 per normal/shiny |
| Pokémon Showdown sprites `gen5ani`/`gen5`, PokéAPI sprites `black-white` (commit `1b3b7c0a`), Smogon tracker attachment (1: Spectrier) | as audited | Sprite files |
| Showdown `types/Fairy.png` | fetched 2026-11-09 | Fairy icon, cropped to rows 1–12 like the existing 17 (which are byte-identical crops of Showdown's icons) |

Minior is a known exception. Showdown's base forme is Core, which matches the sprite. PokéAPI's default is Red Meteor. The bot uses Showdown's data, and this is recorded in `tools/generate-pokedex.mjs`.

## Key decisions taken (within the approved scope)

- **Regions:** Kalos 650–721, Alola 722–809, Galar 810–905 (includes the Hisui-introduced #899–905, so no species is counted twice), Paldea 906–1025. Region completion uses these full sets, whatever is enabled.
- **Rarity tiers for new species:** a written rule (`tools/lib/tierRules.mjs`) that restates the hand-assigned Gen 1–5 pattern. On Gen 1–5 it reproduces 71.3% of tiers exactly and 98.3% within one tier (`npm run check:tier-rule`). Evolutions never step down a tier, so every Gen 6–9 evolution has a Stone price.
- **Battle behaviour for #1–649:** Gen 5 stats and move values are unchanged. Typing and the chart are modern (approved): Fairy matchups, and Steel no longer resists Ghost/Dark. 20 of the 22 retyped species gain the Fairy level-up moves they have in their latest game. Togepi and Azurill have none.
- **Evolution methods:** where the games use a level, that level is required (113 edges, Gen 6–9 targets only, `ENFORCE_LEVEL_EVOLUTIONS` in `services/evolutionRules.js`). Items, friendship, trade, move-use and special methods map to the existing Evolution Stone cost, and the official method is shown for flavour. Gen 1–5 evolutions are unchanged.
- **Form-dependent evolutions** (Obstagoon, Perrserker, Cursola, Sirfetch'd, Mr. Rime, Runerigus, Basculegion, Sneasler, Overqwil, Clodsire) are not offered from the base species. Those ten species can still be caught once their generation is released.
- **Achievements:** the Release C/Mastery "complete" entries (Pokédex Complete 649, Hall of Legends 48, Mythic Archive 21, families 225, Eeveelution 8, Type Encyclopedia 17 types, World Traveler 5 regions) are pinned to Gens 1–5, so new species can neither move nor shortcut them. New entries use the same shapes, AP and pending rewards as the classic region and type entries.
- **Forms count toward their base species** in every collection metric (no double counting).
- **Arceus (#493):** the shipped shiny is byte-identical to the normal sprite, and upstream has the same defect. It predates this work, is reported in `OUTSTANDING.md`, and is not blocking.

## Regenerating

```bash
npm run generate:pokedex       # needs network once (PokéAPI CSVs cached in .cache/)
npm run generate:battle-data
npm run import:sprites         # network; every file must match the audited SHA-1
npm run generate:credits
npm run validate:catalog
npm run test:safe
```
