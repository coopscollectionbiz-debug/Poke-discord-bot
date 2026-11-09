# Gen 6–9 release checklist, deployment and rollback

**Nothing in this document has been executed.** Every production step needs explicit owner approval at the time.

Recommended order: Gen 7 (Alola) → Gen 6 (Kalos) → Gen 8 (Galar/Hisui) → Gen 9 (Paldea). The code doesn't depend on that order: `POKEMON_GENERATIONS` accepts any combination.

## A. One-time: shipping the code (all generations still off)

1. **Merge order.** Release C (PR #51) must land first. This branch is built on it. Then open a PR from `feature/gen6-9` to `master`. Merging to `master` deploys production through the Fly GitHub app.
2. **Pre-merge checks** (on the PR):
   - `npm run test:safe`: all test files pass.
   - `npm run validate:catalog`: passes for 1–9.
   - `node tools/commands-diff.mjs --list`, then `--fetch` (read-only) against the guild: `/addinventory` gains one optional option, `allow_unreleased`. No command is added or removed. Production registers commands from source on boot (`REGISTER_COMMANDS=true`).
3. **Confirm the public URL.** Check that `PUBLIC_URL` (or `FLY_APP_NAME`) gives the host that serves `/public/`. Run `flyctl secrets list` (it shows names only). Embeds no longer fall back to `onrender.com` (those hosts return 503/404). If `RENDER_EXTERNAL_URL` is set to a non-Render URL, it is still honoured.
4. **Backup before deploy** (same as A1/A2 practice):
   - Download the latest verified snapshot from the `/data` volume and the latest Discord storage-channel backup.
   - Record the writer epoch and snapshot hash.
5. **Deploy** (merge). The first boot runs achievement retro evaluation once per player (revision 3):
   - Expected: `col_type_fairy` / `col_type_all_18` may unlock (AP only) for players with 15+ Fairy types after retyping.
   - No existing unlock, claim, counter or inventory entry changes. This is covered by `tests/gen69Achievements.test.js`.
6. **Post-deploy validation:**
   - `/readyz` is `ready:true`.
   - `GET /api/pokedex-status` returns `{"liveGenerations":[1,2,3,4,5],"maxDex":1025}`.
   - `/pokedex Clefairy` shows Fairy.
   - `/pokedex Sylveon` says "isn't in the Pokédex yet".
   - `/credits` loads.
   - A Discord embed image URL points at the Fly host and loads.
   - The dashboard shows only the 5 classic regions.
7. **Rollback of the code** (if needed): revert the merge commit on `master`.
   - Player data stays compatible. Retro unlocks are just `user.ach` entries. Release C keeps unknown ids and gives them 0 AP. Gen 6–9 Pokémon can't exist yet, because nothing grants them while generations are off (except `/addinventory allow_unreleased`, so don't use it in production before a release).
   - **Once any generation has been released, don't roll back the code. Roll back the generation instead (B, "Rollback of a generation").**
     - The older code can't describe Gen 6–9 Pokémon.
     - Its normaliser would also move Gen 6–9 ids out of `user.evoSpecies` into `progressionLegacy`. They are set aside, not lost, but it is avoidable.

## B. Per-generation release

Replace `N` with the generation number and `REGION` with its region.

### Readiness (all must be true)

| Check | How | Gen 6 | Gen 7 | Gen 8 | Gen 9 |
|---|---|---|---|---|---|
| Species data complete | `npm run validate:catalog N` | ✅ | ✅ | ✅ | ✅ |
| Normal sprite for every species | validate + `gen69Catalog` | 72 (54 animated) | 88 (74 animated) | 96 (67 animated) | 120 (25 animated) |
| Distinct shiny for every species | validate + `gen69Catalog` | 72 (48 animated) | 88 (74 animated) | 96 (66 animated) | 120 (25 animated) |
| Battle data / inspection | `gen69Display` (every species simulated, inspected, sprites decoded) | ✅ | ✅ | ✅ | ✅ |
| Evolution graph valid | `gen69Catalog` | ✅ | ✅ | ✅ (6 form-gated) | ✅ (1 form-gated) |
| Achievements | `gen69Achievements` (region entries unlock only when live) | ✅ | ✅ | ✅ | ✅ |
| Economy impact reviewed | `BALANCE.md` / `npm run report:balance` | owner | owner | owner | owner |
| Owner approval | — | ☐ | ☐ | ☐ | ☐ |

Gen 9 is 79% static sprites. Re-run the sprite audit (`docs/audits/pokemon-gen6-9/scripts`) before releasing it, to pick up newly published animations. Upgrading a static sprite is a file swap at the same path plus a manifest update (`npm run import:sprites` after the source manifest is refreshed). It needs no player-data change.

### Release

1. Backup (A.4).
2. Set the environment variable, e.g. Gen 7: `POKEMON_GENERATIONS=7`; later Gens 6+7: `POKEMON_GENERATIONS=6,7`.
   - On Fly: `flyctl secrets set POKEMON_GENERATIONS=7 -a poke-discord-bot-49shta`. This restarts the machine. Owner runs or approves it.
3. Boot log: no `⛔ Generation N is configured but NOT enabled` line. If that line appears, the generation failed validation and stays off. Fix the data and redeploy.
4. Verify:
   - `GET /api/pokedex-status` lists N.
   - `/pokedex <a REGION species>` shows it.
   - The dashboard shows the REGION header.
   - A few `/recruit` or test catches can produce REGION species. Use a test account and check the event log.
   - The REGION achievements appear in `/achievements`.
5. Announce (patch notes).

### Rollback of a generation

- Remove N from `POKEMON_GENERATIONS` (or unset it) and restart.
- **Effect:**
  - REGION species stop appearing in every pool (catch, daily, shop, quest, recruit, weekly pack, evolution, starter list).
  - Owned REGION Pokémon stay in inventories with their Levels and shiny status. They stay visible in the dashboard and `/pokedex` for their owners, and they can still battle and be gifted.
  - REGION achievements already earned stay earned and visible. Unearned ones are hidden again.
- **Never** delete species from `pokemonData.json` to roll back. Records would then hold ids the game can't describe.

## C. Data safety rules (all phases)

- Tests run only against temp directories (`npm run test:safe`) and synthetic players.
- No script in this branch reads or writes `/data`, the storage channel, or production config.
- `POKEMON_GENERATIONS` is an operator setting. It is never written by code. The test runner strips it so tests can't inherit it.
