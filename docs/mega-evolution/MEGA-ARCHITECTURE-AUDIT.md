# Mega Evolution: architecture audit

Read-only audit. Nothing was implemented, deployed or reconfigured.

| | |
|---|---|
| Audited code | `origin/master` **5157cfe6** (PR #53 merge), checked out read-only at `E:\Poke-discord-bot-mega-audit`, branch `audit/mega-evolution` |
| Production | Fly app `poke-discord-bot-49shta`, release **v21** (latest, verified 2026-11-09 with `flyctl releases`) |
| Generation config | `POKEMON_GENERATIONS` is **not set** (verified with `flyctl secrets list`, names only), so live generations are still 1–5. Unchanged since the Gen 6–9 deployment. |
| Older worktrees | `E:\Poke-discord-bot-gen69` (58b68ef0) and `-gen69-audit` (b43032ce) are **older** than master. They were used only for the cached PokéAPI CSVs (`.cache/pokeapi-e2710d30`). |
| Data sources | `@pkmn/dex` 0.10.12 (Showdown data, an existing dev dependency); PokéAPI CSV commit `e2710d30` (2026-10-20); a fresh sprite probe (2026-11-09, `audit-data/`); Serebii's Z-A Mega Stone index (stone locations only). Bulbapedia refused automated fetches (HTTP 403). |

Owner direction received during the audit (2026-11-09): **Megas are shown as separate Pokémon on the dashboard, and only one can be added to a battle team.** That direction is applied throughout these documents. A Mega is still never a National Dex species and never catchable. It is a view of an owned Pokémon plus that Pokémon's permanent unlock.

## 1. Summary of findings

| Question | Finding | Consequence |
|---|---|---|
| How are forms identified? | `utils/forms.js`: form key `"<dex>:<formeid>"` (e.g. `6:megax`), never a dex number. 361 records in `data/pokedex/forms.json`, all `enabled:false`, and `isFormEnabled()` is hard-wired to `false`. | Good base. Megas get a **stable string id** (`mega-charizard-x`) mapped to the existing key (`6:megax`). |
| Separate records or variants? | Separate records linked to `species`. Each has its own types, base stats, `battleOnly`, `requiredItem`, `showdownSpriteId`. **No abilities field.** | Add `ability` and `stableId` (data change only). |
| Mega coverage in forms.json | **91 of 97** Mega rows. Missing: Meowstic-M/F-Mega, Magearna-Original-Mega and the 3 Tatsugiri Megas. They were classed as other kinds or skipped. Rayquaza-Mega has `requiredItem: null` (correct: it needs Dragon Ascent). | Regenerate the Mega subset (`tools/generate-pokedex.mjs`). |
| Inventory ownership | `user.pokemon[dex] = { normal: n, shiny: n }`: **counts**, not individuals. | See next row. |
| Stable instance IDs? | **None.** The closest stable identity is the *line*: species + variant (`"6:normal"`, `"6:shiny"`). Levels already live there (`user.training["6:normal"].exp`, `utils/training.js`). | **Blocker for a literal "per-instance" unlock.** The recommended design binds unlocks to the line (§3). True instances would be a separate, large migration (decision D-1). |
| Shiny storage | Variant is part of the key: `pokemon[id].shiny` count, training key `id:shiny`. Normal and shiny are separate lines with separate Levels. | A shiny Charizard line and a normal Charizard line each need their own unlock. |
| Form sprites | `utils/sprites.js` resolves **species ids only**, from `data/sprites/sprites.json`. No form sprites are in `public/`. A missing variant shows the Poké Ball placeholder, never a substitute. | Add a form-sprite manifest and resolver (same pipeline: `tools/import-sprites.mjs`, PNG→GIF, SHA-1 checked). |
| Distinct types/stats/abilities? | Types and stats: yes (in forms.json, and they match Showdown and PokéAPI for all 99 rows). Abilities: not stored. | Add abilities. Mechanics: see `MEGA-BATTLE-DESIGN.md`. |
| Temporary form overrides in battle? | `utils/battle/sim.js` `buildMon()` builds a fresh, in-memory battler from `getSpecies(member.speciesId)` on every battle. Nothing in the battler is written back except EXP, rating and W/L, which `runBattle.js` applies afterwards. | **Ideal transformation point.** A Mega override lives only in the sim's memory, so a crash, timeout or restart can never leave a Pokémon Mega Evolved. |
| Abilities in the engine | **None**, except Shedinja's Wonder Guard. There are no stat stages, status, weather, terrain, items, switching choices or protection. Moves carry no flags (contact, punch, bite, pulse, slicing, sound, ball). | Mega abilities do **not** work today. 69 distinct abilities need a tiered plan. |
| Interactive turns? | **No.** `/battle` resolves the whole 6v6 fight synchronously (`simulateBattle`) and replays it as images. In friendly battles the defender doesn't even respond. | Mega selection must happen **before** the battle: the Mega card on the team *is* the selection. That matches the owner's direction. |
| Trading | No trading exists. `/gift` moves **normal copies only**, refuses the species' last copy (normal + shiny counted together), and gives the recipient count only, never Levels (`commands/gift.js:29–41`). Release F (trading) is planned, after the journal and reconciler. | A line's Level and Mega unlock never leave their owner today. A line can be emptied (e.g. the last normal while a shiny remains); its unlock then stays dormant with the sender. The policy is documented in §3.4. |
| Save and backup | Whole-map JSON snapshots: atomic local write on the Fly volume (`/data`), plus Discord backups, with seq, epoch fencing and sha256 (`persistence/`). Every mutation runs under `lockUser` and then `saveAndAck`. | Item consumption plus unlock in one synchronous mutation is atomic on disk, because both are in the same snapshot. |
| Unknown fields on load/save | The live path (`bot_final.js`) keeps unknown user fields. `utils/trainerDataHelper.sanitizeBeforeSave` (which strips non-schema fields) is **not imported** by live code. `normalizeTeam` drops unknown slot fields. | New fields survive rollback to v21 untouched (§4). A test must pin "sanitizeBeforeSave is not on the live path". |
| Achievements and forms | Metrics read `user.pokemon` (species keys) and `user.training`. Forms already "count toward their base species". | Megas are not in `user.pokemon`, so they can't inflate Dex metrics. New metrics are additive. |
| Acquisition gates | All pools go through `utils/speciesCatalog.js` (`isAcquirable` on numeric species ids), plus a backstop in `selectRandomPokemonForUser`. Form keys can't pass `isSpeciesKey`. | Megas are uncatchable by construction. Tests pin this. |
| Multiple unlocked Megas per Pokémon | No model today. | New `user.megaUnlocks[line].forms{}` holds several (§3). |

## 2. The form identity model (proposed, additive)

```
Species           6                       (user.pokemon key, National Dex)
Line              "6:normal"              (training key; the owned Pokémon)
Mega form id      "mega-charizard-x"      (stable, never reused or renamed)
Existing form key "6:megax"               (forms.json key; kept for compatibility)
Mega Stone item   "megastone_charizarditex" (catalog/items.js id)
```

- No new dex numbers, and never `10034`-style ids.
- `mega-<species>[-x|-y|-z]` for standard Megas. Variant-bound Megas: `mega-meowstic-m`, `mega-meowstic-f`, `mega-tatsugiri-curly|droopy|stretchy`, `mega-magearna-original`.
- One module, `utils/megas.js`, owns the table: `stableId → { species, formKey, stone, types, baseStats, ability, sprite, flags }`. It is generated into `data/pokedex/megas.json` from `@pkmn/dex` and validated against PokéAPI (as now: `tools/validate-catalog.mjs`).

## 3. Ownership model

### 3.1 Where an unlock lives

```jsonc
user.megaUnlocks = {
  "6:normal": {                        // the line (species:variant)
    "forms": {
      "mega-charizard-x": { "at": 1762732800000, "stone": "megastone_charizarditex", "req": "a1b2c3d4" },
      "mega-charizard-y": { "at": 1762819200000, "stone": "megastone_charizarditey", "req": "e5f6a7b8" }
    }
  }
}
```

- **Per line, not per species.** The shiny line `6:shiny` needs its own stone.
- Several forms per line are allowed (Charizard X and Y, Mewtwo X and Y, Raichu X and Y, Absol, Garchomp and Lucario Mega and Mega Z).
- **Never deleted.** If the line's count drops to 0 (donate, evolve away, shiny craft), the unlock goes **dormant**: it is hidden, and it reactivates when that line is owned again. `resetLevelIfGone` deletes Levels, but unlocks are not touched (a test pins this).
- **Generation-independent.** Turning a generation off (`POKEMON_GENERATIONS`) never touches `megaUnlocks`. A Mega whose base species belongs to an unreleased generation is simply not *usable* until that generation is live, because the base can't be owned.

### 3.2 Why a line and not an instance (decision D-1)

The approved rules ask for unlocks "bound to individual Pokémon instances". The bot has no instances: three Charizards are `normal: 3`, and they share one Level record. The options:

| Option | What it means | Cost | Recommendation |
|---|---|---|---|
| **A. Line-bound (recommended)** | The unlock belongs to the trainer's Charizard (normal) line, the same unit that holds the Level and appears as one card on the dashboard. | Additive field, no migration of existing data | **Yes.** Matches what players see (one card per line), and is rollback-safe. |
| B. Introduce instance IDs | Every copy becomes `{ uid, species, variant, level, megas }`. | Rewrites `user.pokemon`, `training`, team, gift, donate, evolve, the dashboard and achievements. A one-way migration of ~2,900 players. | Do it with Release F (trading) if ever. Line unlocks then migrate onto the instance that holds the line's Level. |

### 3.3 Mega as a dashboard Pokémon (owner direction)

- The dashboard shows a **separate Mega card** for each *unlocked* Mega of an *owned* line: "Mega Charizard X" (normal or shiny art). It shares the line's Level and is labelled "Battle form of Charizard". Its count is not separate: it is the same Pokémon.
- Not a species: it never appears in `user.pokemon`, the Pokédex count, region or type completion, `/pokedex` ownership, donation or gifting.
- Team slot shape (additive): `{ id: 6, variant: "normal", mega: "mega-charizard-x" }`.
- **At most one slot with `mega` per team** (= one Mega per trainer per battle).
- A line can't be on the team twice (base Charizard **and** Mega Charizard X): the dedupe key stays `id:variant` (decision D-2).

### 3.4 Transfer policy

- `/gift` today: sends normal copies and never Levels, and refuses only the species' last copy across normal + shiny. So the last *normal* copy can go while a shiny remains, which empties the normal line. **The unlock stays with the sender's line** (dormant if emptied; corrected in Phase M0, tested in `tests/megaPersistence.test.js`). The recipient's line gets no unlock. That is consistent with Levels.
- Future trading (Release F): the trade must define whether a line moves whole. Proposed rule: *an unlock moves only when the whole line (last copy plus its Level) moves.* The journal and reconciler already scheduled before F must cover `megaUnlocks`.
- Admin tools (`/resetuser` and similar) must state whether they clear unlocks. Proposed: only an explicit `--include-megas`.

## 4. Schema changes (all additive)

| Field | Type | Default when missing | Written by |
|---|---|---|---|
| `user.megaUnlocks` | `{ [line]: { forms: { [stableId]: {at, stone, req} } } }` | `{}` | Mega unlock transaction only |
| `user.items["megastone_*"]` | integer ≥ 0 | 0 | inventory service (`grantItem`/`consumeItems`) |
| `user.displayedPokemon[i].mega` | stable id or absent | absent | `/api/set-pokemon-team` (validated) |
| `user.stats.megaWins`, `user.stats.megaUnlocks` | integer | 0 | `trackProgress` (Release C counters live in `user.stats`) |
| `user.megaLog` (optional, capped 50) | `[{at, line, form, stone, req}]` | `[]` | unlock transaction (support audit) |

Rollback to v21: v21 ignores `megaUnlocks`, `megaLog` and unknown `items` keys (they are kept and listed as "An item from an earlier version"). `normalizeTeam` drops `mega` from slots, so the slot battles as the base form. No data is lost, and nothing breaks. A test loads synthetic Mega data with the v21 code paths (`MEGA-TEST-AND-ROLLBACK-PLAN.md`).

No schema version bump is needed. `utils/schemaMigration.js` is not on the live path for these fields, and every reader defaults safely.

## 5. Blockers to authentic Mega Evolution

1. **Abilities:** the engine models none. Of the 69 distinct Mega abilities, 34 can be simulated with damage, accuracy or immunity rules inside the current model (8 of them need new move flags), 20 need new subsystems (stat stages, weather, terrain, status), and 15 have **no effect** in this battle model. Details are in `MEGA-BATTLE-DESIGN.md`. Mega Evolution can ship with honest "inert in Coop battles" labels, or wait. Decision D-5.
2. **No interactive turns:** in-battle "choose to Mega Evolve" can't exist without restructuring `/battle`. The pre-battle Mega team slot replaces it (owner direction).
3. **Variant data the bot doesn't store:** gender (Meowstic), appearance (Tatsugiri), Original Color (Magearna), Eternal Flower (Floette), Complete Forme (Zygarde). Decisions D-6 to D-8.
4. **Mega Zygarde:** no acceptable 2D sprite exists (normal or shiny). Blocked.
5. **Mega Rayquaza:** needs Dragon Ascent, not a stone. The bot's movesets are automatic (last 4 level-up moves). Decision D-9.
