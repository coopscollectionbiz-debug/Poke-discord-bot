# Generation 7 (Alola) — release checklist and rollback plan

**Status: not executed.** Each production step marked 🔐 needs explicit owner approval at the time. The general process is in `RELEASE-CHECKLIST.md`; this document is the concrete Gen 7 instance.

## 0. What Gen 7 brings

| Item | Value |
|---|---|
| Species | 88 (#722–809), region **Alola** |
| Sprites | 74 animated + 14 static normal sprites. 74 animated + 14 static shinies, all distinct from the normal sprite |
| Static-only species | Dartrix, Decidueye, Torracat, Oricorio, Mareanie, Salandit, Salazzle, Tsareena, Oranguru, Passimian, Golisopod, Tapu Fini, Guzzlord, Poipole |
| Tiers | 15 common, 10 uncommon, 23 rare, 20 epic, 13 legendary, 7 mythic |
| Fairy-type species | 12 |
| Evolutions into Alola species | 33 total. 27 need the official level (highest: Lv 53). 6 use the Stone-cost equivalent (2 item, 3 friendship/other level-up, 1 Meltan candy). No cross-generation and no form-gated evolutions |
| Starters added to the selection | Rowlet, Litten, Popplio |
| Achievements switched on | Alola Explorer (44), Alola Cartographer (66), Alola Pokédex Complete (88). AP only; rewards pending (D-07) |
| Forms | none. Alolan regional forms stay disabled |
| Encounter impact | Every existing species is drawn at 91.7% of today's rate (weighted selector). 8.3% of draws are Alola. Legendary 0.462% → 0.538% per draw. Full tables: `GEN7-ENCOUNTER-COMPARISON.md` |

## 1. Preconditions (all must hold before step 2)

- [ ] Release C (PR #51) is merged to `master` and has run in production without issues.
- [ ] The Gen 6–9 PR is merged to `master` and deployed with **no** `POKEMON_GENERATIONS` set (the code release). Post-deploy checks from `RELEASE-CHECKLIST.md` §A.6 have passed:
  - `GET /api/pokedex-status` → `{"liveGenerations":[1,2,3,4,5],"maxDex":1025}`.
  - The revision-3 migration ran: the boot log line `🏅 Achievements: … retroactive unlock(s)` appears.
  - From the 3,000-player qualification, expect only Fairy Specialist, Type Encyclopedia II, and a few Decorated milestones.
- [ ] The embed image host is confirmed. A `/pokedex Pikachu` image loads in Discord from `https://poke-discord-bot-49shta.fly.dev/…`. Production has a `RENDER_EXTERNAL_URL` secret whose value isn't visible. The new code ignores it if it's an `onrender.com` address and uses the Fly app URL instead. Optional: set `PUBLIC_URL=https://poke-discord-bot-49shta.fly.dev` 🔐 to make this explicit.
- [ ] Owner approves the Gen 7 encounter impact (`GEN7-ENCOUNTER-COMPARISON.md`) and keeps the level requirement (approved 2026-11-09).
- [ ] Local gate on the exact commit being released:
  - `npm run validate:catalog 7` passes.
  - `npm run test:safe` passes.

## 2. Backup 🔐 (read-only on production)

1. Record the current machine and image: `flyctl status -a poke-discord-bot-49shta`.
2. Save the latest verified snapshot from the `/data` volume, plus the latest storage-channel backup. Use the RUNBOOK procedure: copy off the machine, don't modify it.
3. Note the writer epoch, snapshot hash and player count from the boot log.

## 3. Release 🔐

1. `flyctl secrets set POKEMON_GENERATIONS=7 -a poke-discord-bot-49shta`. This restarts the single machine (about 30 s of downtime; the graceful shutdown saves first).
2. Watch the boot log:
   - It must not contain `⛔ Generation 7 is configured but NOT enabled`. If it does, Gen 7 stays off automatically: go to §5.
   - It must contain the usual load, epoch and readiness lines, and `/readyz` must report `ready:true`.

## 4. Verification (first hour)

- [ ] `GET /api/pokedex-status` → `liveGenerations` includes `7`.
- [ ] `/pokedex Rowlet` shows the animated sprite. `/pokedex Tapu Fini` shows the static sprite. The footer credits the Smogon Sun/Moon project.
- [ ] Dashboard:
  - An "Alola 0/88" header is shown.
  - An owned Eevee still offers no Sylveon (Gen 6 is off).
  - Popplio → Brionne shows "Requires Lv. 17".
- [ ] `/achievements` lists the three Alola entries.
- [ ] Event log (`/api/admin/events`, admin): within normal traffic, about 8% of new catches are #722–809. No catches above #809 or in #650–721.
- [ ] `/credits` loads.
- [ ] No new errors in `flyctl logs`, in particular no `⚠️ No normal sprite for Pokémon #…` or `No shiny sprite` warnings.
- [ ] Post the patch notes (`PATCH-NOTES-DRAFT.md`, Alola section).

## 5. Rollback plan

**Generation rollback (preferred, about 1 minute)** 🔐
- Run `flyctl secrets unset POKEMON_GENERATIONS -a poke-discord-bot-49shta`. The machine restarts with Gens 1–5 only.
- Effect, verified by `tests/gen69Generations.test.js` ("Rollback of a released generation…"):
  - Alola species stop appearing in catches, `/daily`, `/recruit`, `/quest`, the starter pack, the weekly pack, evolutions and the starter list.
  - Every Alola Pokémon a player already caught stays in their inventory with its Level and shiny status. It can still battle and be gifted, and stays visible to its owner in `/pokedex` and the dashboard.
  - Alola achievements already earned stay earned and visible. Nothing is deleted or re-dated.
- Re-releasing later is just setting the variable again.

**Code rollback (only if the Gen 6–9 code itself misbehaves)** 🔐
- First unset `POKEMON_GENERATIONS` (above), then revert the Gen 6–9 merge commit on `master`.
- If any Alola Pokémon were acquired, prefer staying on the Gen 6–9 code with Gen 7 off. The previous code can't describe #722–809. Its normaliser would also move those ids from `evoSpecies` to `progressionLegacy` (set aside, not lost).
- Release C booting a revision-3 record keeps every unlock (qualified on 3,000 synthetic players: 0 unlocks lost).

**Never** edit `pokemonData.json` to remove species, or touch player records, as a rollback step.

## 6. Risks to watch

- **Static sprites:** 14 Alola species are static, including two starter evolutions (Dartrix and Decidueye, which are reserved by an animator on the tracker) and Torracat.
- **Quest rarity:** quests pick uniformly. The Legendary rate per Pokémon quest goes from 7.4% to 8.3%. That's existing behaviour; see `BALANCE.md` §4.
- **Late evolutions:** level requirements may surprise players (Kommo-o Lv 45, the Cosmoem line Lv 53). The dashboard shows the level needed.
- **No CI, unprotected master:** merges to `master` deploy immediately. Run `npm run test:safe` and `npm run validate:catalog` on the merge commit before merging.
