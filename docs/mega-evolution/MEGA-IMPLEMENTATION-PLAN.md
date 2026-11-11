# Mega Evolution: implementation plan

Base: `master` 5157cfe6 (production v21). Every merge to `master` deploys production through the Fly GitHub app, and the repo has no CI. So each phase lands as its own PR with **`MEGA_EVOLUTION_ENABLED` unset (off)**, and `npm run test:safe` must be green locally before review. The owner merges.

## Phase M0: data and assets (no gameplay change)

| File | Change |
|---|---|
| `tools/generate-pokedex.mjs` → new `tools/generate-megas.mjs` | Build `data/pokedex/megas.json` from `@pkmn/dex` (93 forms / 97 rows): `stableId`, `species`, `formKey`, `stone`, `types`, `baseStats`, `ability` (slot 0), `introGroup`, `status` (eligible / blocked / needs-decision), `legendary`. Cross-check against PokéAPI CSVs, and fail on any difference |
| `data/pokedex/forms.json` | Add the 6 missing Mega rows (Meowstic M/F, Magearna Original, Tatsugiri ×3) with `kind: "mega"`; add `stableId` |
| `utils/megas.js` (new) | Read-only API: `getMega(stableId)`, `megasOf(species)`, `megaForStone(stone, variantData)`, `isMegaActivatable(stableId)` (flag + status + sprite + generation live) |
| `tools/import-sprites.mjs` | `--forms mega` mode → `public/sprites/pokemon/forms/{normal,shiny,grayscale}/<stableId>.gif`, plus `data/sprites/forms.json`. SHA-1 must match `docs/mega-evolution/audit-data/probe-results.json` |
| `utils/sprites.js` | `formSpritePath(stableId, variant)`: manifest-checked; placeholder on a miss, never the base sprite |
| `tools/validate-catalog.mjs` | Validate megas.json, the sprites and the stone mapping |
| `tools/generate-credits.mjs` | Mega sprite artists on `/credits` |
| `catalog/items.js` | 92 stones (`status: "defined"`, category `mega`), Mega Shard, Mega Stone Voucher (defined) |

Gate: `validate:catalog`, new `tests/megaCatalog.test.js` and `megaSprites.test.js`, full suite green. No behaviour change, since everything is `defined` or flag-off.

## Phase M1: unlock and persistence (flag-gated)

| File | Change |
|---|---|
| `config/features.js` (new) | `MEGA_EVOLUTION_ENABLED` (env, default off), plus an optional `MEGA_FORMS` allowlist (comma list of stable ids, or `all`) |
| `services/mega.js` (new) | `normalizeMegaUnlocks`, `unlockMega` (through `runInventoryTransaction`), `activeMegaForms(user)`, `megaLog` |
| `utils/userSchema.js` | Call `normalizeMegaUnlocks` in `validateUserSchema` |
| `bot_final.js` | `GET /api/mega`, `POST /api/mega/unlock` (session + requestId); `/api/updateUser` whitelist test |
| `commands/mega.js` (new) | `list`, `info`, `unlock` |
| `services/inventory.js` | Usage text for stones; `listInventory` category |
| `catalog/items.js` | Stone `status` stays `defined` until activation; activation flips listed stones to `active` |

Gate: unlock, concurrency, replay, failed-save and rollback tests (`MEGA-TEST-AND-ROLLBACK-PLAN.md`).

## Phase M2: team and battle (flag-gated)

| File | Change |
|---|---|
| `utils/teamNormalize.js` | Keep a validated `mega` on slots. Dedupe on `id:variant`. At most one `mega` per team |
| `bot_final.js` `/api/set-pokemon-team` | Server-side validation and messages |
| `utils/battle/runBattle.js` `buildTeam` | Re-validate under lock; set `member.megaForm`; count `megaWins` |
| `utils/battle/sim.js` `buildMon` | Species override from `utils/megas.js` (stats, types, HP rule, `ability`) |
| `utils/battle/abilities.js` (new) | Hooks and the 34 class-A abilities; class B/C are explicit no-ops with a status label |
| `tools/generate-battle-data.mjs` / `battleData.json` | Additive move `flags` (contact, punch, bite, pulse, slicing, bullet, secondary) |
| `utils/battle/power.js` | Mega stats in `teamPower` |
| `utils/battle/rewards.js` | EXP yield keeps base-species BST (D-10) |
| `utils/battle/render.js`, `playback.js` | Mega sprite, badge, "Mega Evolved!" frame, ability events |
| `commands/battle.js` | Summary text; event log `megaForm` |

Gate: the seeded regression test proves non-Mega battles are unchanged (same seed → identical log for 1,000 random teams), plus the ability unit tests and the balance spot check (`tests/battleBalance.test.js` re-run with Megas).

## Phase M3: dashboard

`public/picker-pokemon/script.js` (Mega cards, filter, team rules, detail tabs), `public/bag/script.js` (Mega category, Use on…), `public/pokedex` read-only Mega info. Gate: manual check in the preview browser against a synthetic save; screenshot record.

## Phase M4: rewards and achievements (each table needs approval)

`config/megaRewards.js` (rates, caps, targeted pool, shards, events), hooks in `commands/quest.js`, `commands/daily.js` (and battle if D-14), `catalog/achievements.js` (revision 4: mega category), `progression/achievements.js` (new metrics), `config/achievementRewards.js` (approval list).

## Phase M5: activation (production action, needs explicit approval)

Set `MEGA_EVOLUTION_ENABLED=1` (and optionally `MEGA_FORMS`) on Fly, flip the approved stones to `active`, announce. Same backup and verification checklist style as `docs/gen6-9/RELEASE-CHECKLIST.md`.

## Optional enhancements (not mandatory)

- Phase B abilities: stat stages, weather, terrain, burn (20 abilities).
- Locked grayscale Mega cards in the grid.
- Shard exchange UI.
- Mega Zygarde, Mega Rayquaza, Mega Floette (after decisions and assets).
- Per-gender, appearance and colour data (Meowstic, Tatsugiri, Magearna Original).
- Instance IDs (only with Release F trading).
- An animated Mega Evolution transition GIF in playback.

## Dependencies

- M1 needs M0. M2 needs M1. M3 needs M1 (unlock UI) and M2 (team). M4 needs M1. M5 needs everything plus approvals.
- The journal and reconciler (open item before Release F) must include `megaUnlocks` if trading ships after Mega.
- `@pkmn/dex` stays pinned at 0.10.12. An upgrade re-runs the catalogue cross-check.

## Complexity estimate

| Phase | Size | Risk |
|---|---|---|
| M0 | Medium (generators, 288 sprite files = 96 rows × normal/shiny/grayscale, 92 stones) | Low |
| M1 | Medium | Medium (persistence; mitigated by the existing transaction pattern) |
| M2 | Large (sim changes, 34 abilities, flags, render) | Medium-high: battle balance and determinism |
| M3 | Medium-large (2,095-line dashboard script) | Medium |
| M4 | Small-medium | Economy tuning |
| Total | Comparable to Release C plus half of the Gen 6–9 expansion | |
