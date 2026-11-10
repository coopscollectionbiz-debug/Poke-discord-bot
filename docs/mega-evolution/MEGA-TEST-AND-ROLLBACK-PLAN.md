# Mega Evolution: test and rollback plan

## 1. Automated tests (new suites; run under `npm run test:safe`)

### Catalogue and assets: `tests/megaCatalog.test.js`, `tests/megaSprites.test.js`
- Exactly 93 Mega forms / 97 rows (+2 Primal excluded). Every row's stats and types equal Showdown 0.10.12 **and** PokéAPI e2710d30. Multi-form species: Charizard, Mewtwo, Raichu (X/Y); Absol, Garchomp, Lucario (Mega + Z).
- Stone mapping: 92 stones; every stone maps only to forms of its species; shared stones (Meowsticite, Tatsugirinite, Magearnite) map by variant; Rayquaza has no stone.
- Stable ids are unique, never numeric, never equal to a species key; `parseFormKey`/`isSpeciesKey` reject them.
- Sprites: every activatable form has a normal and a shiny file whose SHA-1 equals the audit record; the shiny differs from the normal (bytes and first-frame pixels); transparency present; ≤ 64 colours and 2 alpha levels; GIF decodes; frame count matches the manifest. Mega Zygarde is not activatable.

### Eligibility and gates: `tests/megaEligibility.test.js`
- Eligible: owned line plus matching stone. Ineligible: unowned line, wrong species, wrong variant data, unreleased generation, flag off, blocked form.
- **Never acquirable:** for every pool (`acquirablePokemon`, quest, daily, recruit, weekly and starter packs, dashboard capture, `selectRandomPokemonForUser`) sampled 10,000×, no Mega id or form key appears; `grantCatch` refuses form keys.

### Unlock transaction: `tests/megaUnlock.test.js`
- Success consumes exactly 1 stone and writes 1 unlock.
- Already unlocked → refused, stone not consumed.
- The same requestId replayed 5× → one consumption, the same result.
- Two concurrent requests (different ids, same line) through `lockUser` → one unlock, one refusal, one stone consumed.
- `save` fails → the unlock and the consumption both stay in memory; the queue retry persists both; never only one.
- A simulated crash before the save (drop in-memory state, reload the last snapshot) → the stone is still present and no unlock exists.
- Multiple forms on one line (X then Y); shiny and normal lines independent.
- `resetLevelIfGone`, donate, evolve-away and shiny craft never delete `megaUnlocks` (dormant), and reacquisition reactivates them.
- `/api/updateUser` ignores `megaUnlocks` and `mega`.

### Team and battle: `tests/megaBattle.test.js`
- At most one Mega per team (API and `buildTeam`); base and Mega of the same line can't both be on the team; an invalid `mega` falls back to the base.
- `buildMon` with a Mega: Mega stats, types and ability; the same Level, moves and variant; HP rule (Chimecho 75, Floette 74, Zygarde 216 base); EXP credited to the base training key.
- **Determinism:** 1,000 seeded random battles without Megas produce logs identical to the pre-change engine (golden file).
- Reversion: after `runBattle`, the player record contains no Mega state other than `megaUnlocks`; an exception thrown inside `simulateBattle` leaves `trainerData` byte-identical.
- No X/Y switching: the form is taken once from the team snapshot under the lock.
- Abilities: one test per class-A ability against a hand-computed damage or immunity; class B/C abilities have no effect, and are labelled.
- Flag off → the team battles as the base form.

### Achievements: `tests/megaAchievements.test.js`
- Every existing achievement metric is unchanged after adding 10 unlocks to a synthetic player (Megas never count as species).
- New metrics count only owned lines; `megaWins` increments once per battle.

### Trading / gift: `tests/megaGift.test.js`
- `/gift` of a Mega-unlocked species: the sender keeps the unlock (the last copy can't be gifted); the recipient gets none.

### Serialization and migration: `tests/megaMigration.test.js`
- Synthetic players modelled on the production schema (counts, training, items with legacy keys, itemsLegacy, ach, battle, displayedPokemon in all 3 legacy shapes): load → normalize → save → load round-trips with no change except the added defaults.
- Malformed `megaUnlocks` (array, wrong keys, prototype keys) are quarantined to `megaLegacy`, never dropped.
- **Rollback compatibility:** data with Mega fields loaded through the v21 code paths (`validateUserSchema`, `normalizeInventory`, `normalizeTeam`, `buildTeam`, `listInventory`, `evaluate`) → no throw; `megaUnlocks` preserved byte-for-byte; team slots battle as the base form; stones listed as unknown items.
- `utils/trainerDataHelper.sanitizeBeforeSave` (which strips unknown fields) is not imported by `bot_final.js` (a static import test).

## 2. Feature flag

- `MEGA_EVOLUTION_ENABLED` (Fly env or secret), **unset = off**. Read at boot by `config/features.js`. Optional `MEGA_FORMS` allowlist.
- Off means: no unlocks, no stone drops, Mega team slots battle as the base form, Mega cards shown read-only with "Mega Evolution is paused", `/mega unlock` refuses. **Nothing is deleted:** `megaUnlocks` and stones stay.

## 3. Rollback procedures (no snapshot restore over live progress)

| Situation | Action | Data effect |
|---|---|---|
| Gameplay problem (balance, ability bug) | Unset `MEGA_EVOLUTION_ENABLED` (or narrow `MEGA_FORMS`) and restart | None. Unlocks and stones kept |
| Reward problem (drop rate) | Set the rate table to 0 in `config/megaRewards.js` and deploy | None |
| Code defect | Flag off first; then `flyctl releases rollback` to the last pre-Mega image (v21 or later) | v21 ignores Mega fields (tested); they survive and come back with a later release |
| A wrongly granted stone or unlock | Admin correction through `/addinventory` (negative not allowed: use a dedicated `/mega revoke` admin action that logs to `megaLog`) | Targeted, logged |
| Data corruption (should be impossible) | Standard A2 recovery (local-prev / Discord backup) per `RUNBOOK.md` | Last resort only; it loses live progress |

Before activation (Phase M5): take the standard pre-release backup (`E:\PokeBot-Restricted\backups\...`), record the Fly release, image and writer epoch, and verify the boot log (unlock count 0, no normalization quarantines).
