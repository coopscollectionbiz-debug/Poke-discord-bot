# Mega Evolution: audit and design (for approval)

Read-only audit of production `master` 5157cfe6 (Fly v21, `POKEMON_GENERATIONS` unset), 2026-11-09. Nothing was implemented, deployed or reconfigured.

| Document | Contents |
|---|---|
| `MEGA-ARCHITECTURE-AUDIT.md` | Form identity, ownership, persistence, compatibility, blockers |
| `MEGA-CATALOGUE.csv` | 99 rows: 93 Mega forms (97 rows with gender/appearance/colour variants) + 2 Primal (out of scope) |
| `MEGA-SPRITE-AVAILABILITY.md` | Per-form sprite probe, coverage by group, missing list |
| `MEGA-STONE-ECONOMY.md` | Channels, scenarios, caps (all proposals) |
| `MEGA-BATTLE-DESIGN.md` | Team-slot selection, transformation point, HP rule, the 69 abilities classified |
| `MEGA-INVENTORY-AND-PERSISTENCE.md` | Stone items, the unlock transaction, duplication safety, migration |
| `MEGA-DISCORD-AND-DASHBOARD.md` | `/mega` commands, Mega cards, team rules, API |
| `MEGA-ACHIEVEMENTS.md` | New metrics and entries |
| `MEGA-IMPLEMENTATION-PLAN.md` | Phases M0–M5, files, gates, estimate |
| `MEGA-TEST-AND-ROLLBACK-PLAN.md` | Test suites, flag, rollback |
| `audit-data/` | Probe results, Showdown dump, scripts, Z-A contact sheet |
| `MEGA-ABILITY-MANIFEST.md` | Phase M0: ability categories and the engine work required (from `data/pokedex/mega-abilities.json`) |
| `M0-IMPLEMENTATION-REPORT.md` | Phase M0: what was built, totals, deviations, tests, M1 work |

**Status:** decisions D-1 to D-17 approved on 2026-11-10. Phase M0 (data foundation) is implemented on `feature/mega-evolution-m0`. Mega Evolution stays disabled.

## Reproduce

1. Dump the Showdown data: `audit-data/showdown-megas.json` comes from `@pkmn/dex` 0.10.12 (every species whose forme matches `Mega`/`Primal`, num ≥ 1, with its base species' types, stats and abilities, and the stone item).
2. Put PokéAPI CSVs from commit `e2710d30` (`pokemon_forms.csv`, `pokemon_stats.csv`, `pokemon_types.csv`, `types.csv`, `pokemon_species.csv`) into a work directory next to `showdown-megas.json`.
3. Run `python -P -E audit-data/scripts/probe.py <workdir> <workdir>/dl` (Pillow; HTTP GETs of public sprite files only, written to `dl/`). This produces `probe-results.json`.
4. Run `node audit-data/scripts/build-catalogue.mjs <workdir> <repo root> <workdir>/catalogue.csv`. This produces `MEGA-CATALOGUE.csv`.

## Decisions requiring approval

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Unlock bound to the **line** (species + normal/shiny), since the bot has no instance ids | Line-bound now; instance ids only with Release F |
| D-2 | A base Pokémon and its own Mega on the same team? | No (same Pokémon) |
| D-3 | Feature flag name and default | `MEGA_EVOLUTION_ENABLED`, unset = off; optional `MEGA_FORMS` allowlist |
| D-4 | Launch set | 88 eligible forms; or a staged subset (e.g. X/Y + ORAS first: 47 eligible forms, 23 of them animated) |
| D-5 | Ship with only class-A abilities working (B "coming later", C "no effect")? | Yes, with honest labels |
| D-6 | Meowstic gender (not stored) | Player picks M/F once at unlock |
| D-7 | Tatsugiri appearance (not stored) | Player picks at unlock |
| D-8 | Magearna Original Color | Standard Mega only |
| D-9 | Mega Rayquaza (needs Dragon Ascent, no stone) | Keep blocked; or a special "Meteorite" event item (non-canonical; needs approval) |
| D-10 | EXP yield from a Mega foe | Base-species BST (no EXP inflation) |
| D-11 | Mega Heatran / Tatsugiri ability slot | Slot 0 (Flash Fire / Commander) |
| D-12 | Mega Shards pity system | Yes: 2 per drop, 5 per duplicate, 25 per regular stone |
| D-13 | Drop-rate scenario and weekly cap | Medium, 2 per week |
| D-14 | Battle-win drops | Not in Phase 1 |
| D-15 | Legendary/Mythical stones | Only via the `mega_forms_50` voucher and events |
| D-16 | Mega Floette / Mega Zygarde (prerequisite formes not in the bot; Zygarde has no sprite) | Keep blocked |
| D-17 | Achievement rewards (each entry) | Per `MEGA-ACHIEVEMENTS.md`, through the existing approval policy |

| `M2-IMPLEMENTATION-REPORT.md` | Phase M2: battle engine, abilities, regression corpus, benchmark, ability coverage table |
| `M3-IMPLEMENTATION-REPORT.md` | Phase M3: Mega display in /showteam, trainer card, inspect, EXP and battle images, dashboard cards, battle states, collection progress, no-Mega pixel gate (`m3-previews/`) |
