# Mega Evolution: Phase M1 implementation report

| | |
|---|---|
| Branch | `feature/mega-evolution-m1` (local only; not pushed, no PR) |
| Worktree | `E:\Poke-discord-bot-mega-m1` |
| Based on | M0 `b685c88a` (→ audit `f56631c3` → production `5157cfe6`) |
| Master drift | `origin/master` moved to `15caf105` during M1 (PR #55: achievements test clock fix; PR #52: battle EXP sent privately). Not merged into this branch. See §8. |
| Production | Untouched. No deploy, no Fly.io change, no player data. `MEGA_EVOLUTION_ENABLED` unset, so every Mega capability is off. |

M1 adds permanent Mega Stone unlocking, the persistence wiring, virtual Mega cards, the dashboard UI and team selection. **With the flag unset (production), players see and can do nothing new.** The dashboard module renders nothing, the Mega endpoints answer `{ enabled: false }` or 403, Mega team slots are refused, and the bag shows stones as "not usable yet". Nobody can own a stone anyway, because stones stay `defined` and `grantItem` (including `/addinventory`) refuses them. **Mega battles and Mega rewards are hard-off in code**: no environment variable can enable them in M1.

## 1. Architecture decisions

| Topic | Decision |
|---|---|
| Unlock identity | Line = `species:normal|shiny` (D-1). Implemented in `services/megaUnlocks.js` (M0 schema) |
| Atomic unlock | `useMegaStone()` in `services/mega.js`: one synchronous, all-or-nothing mutation run inside the existing `runInventoryTransaction` (lockUser → requestId replay → mutation → `saveAndAck` → A2 save queue). No new write path |
| Order inside the mutation | Validate everything (flag, form gate, line, ownership, stone, choice, already-unlocked, request id) → write the unlock record → consume one stone. Consumption can't fail after validation; if it ever did, only the just-written unlock record is withdrawn. `user.items` is changed **only** by `services/inventory.js` (the existing `mutationGuard` test enforces this; it caught my first draft) |
| Why this is atomic on disk | Both changes are made in one synchronous block on one in-memory player record, and the save queue writes whole-map snapshots (atomic temp-file + rename, seq/epoch, SHA-256). Any snapshot contains both or neither. A failed write is retried, never rolled back. A crash before the write loses both. Tested in §6, not just argued |
| Idempotency | `requestId` is **required** for `/api/mega/unlock`. Replays return the first result without re-running. A reused id with a different payload is refused. The dashboard generates a fresh `crypto.randomUUID()` per confirmed click |
| Capabilities | `config/features.js`: the master switch `MEGA_EVOLUTION_ENABLED`, plus `MEGA_DASHBOARD_ENABLED`, `MEGA_UNLOCKS_ENABLED`, `MEGA_TEAMS_ENABLED` (each defaults on once the master is on; `0/false/off/no` disables just that part). `battle` and `rewards` are `BUILT: false` constants that no environment can override. Optional `MEGA_FORMS` allowlist applies to every capability |
| Per-form gate | `megaFormGate(id, capability)` in `utils/megas.js`: capability, allowlist, eligible status (blocked forms never pass), generation live. Battle readiness is separate (`megaBattleEligibility`) and is false for every form |
| Mega cards | Computed on read (`buildMegaCards`). Never stored, never counted. States: `active` (unlocked, line owned), `dormant` (unlocked, line has 0 copies: kept, not usable), `locked` (owned eligible line, not unlocked: preview), `blocked` (only from bad data) |
| Team slot | `{ id, variant, mega }`. The extra field is optional. Teams without it are unchanged |
| Battle boundary | `buildTeam()` reads the team through `normalizeTeam()`, which keeps only `{id, variant}`, so a Mega slot battles as its base form with no Mega stats, types or ability, and no player data is touched. `megaBattleBoundary()` reports this explicitly. Proven by a battle whose log is byte-identical to the same team without the Mega card |
| Rollback | v21 rebuilds every team slot as `{id, variant}` (the field disappears; the slot battles as base) and ignores `megaUnlocks` and stone items (kept, shown as legacy). No restore of old snapshots needed; switch the flag off instead |
| Discord command | **Not added.** Every boot re-registers all guild commands (`REGISTER_COMMANDS=true`), so a `/mega` command would appear to players immediately, even with the flag off. Unlocking is dashboard-only in M1. A gated command (registered only when the flag is on) is a later-phase decision |
| Inventory category | Stones stay under "Evolution" (M0 deviation 1). The bag's usage text and "usable" flag follow the unlock capability |

## 2. Files

### Created
| File | Purpose |
|---|---|
| `services/mega.js` | `useMegaStone` (atomic unlock), `buildMegaCards` (virtual cards), `megaStoneBag` |
| `services/megaApi.js` | `GET /api/mega`, `POST /api/mega/unlock`, `POST /api/mega/preferred` handlers (session, input validation, capabilities, transactions) |
| `services/megaTeam.js` | `normalizeDisplayedTeam` (the bot's stored-team normalizer moved out of `bot_final.js`, plus keeping a valid Mega slot), `prepareTeamSelection` (the team route's validation plus the Mega rules), `megaBattleBoundary` |
| `public/picker-pokemon/mega.js`, `mega.css` | Dashboard Mega section: unlocked/dormant cards, unlock previews and confirmation, preferred form, add/remove Mega in the team. Loaded only when `/api/mega` says enabled |
| `tests/megaUnlock.test.js` (89 assertions) | Capabilities, unlock matrix, special cases, inventory, API validation, duplicates, concurrency, failed saves, crash recovery through the real queue/store/loader, save/reload |
| `tests/megaCardsTeam.test.js` (53 assertions) | Cards, previews, dormant/reactivation, gifts/donations, team rules, regression against verbatim pre-M1 code (2,000 random teams), battle boundary |
| `tools/dev/mega-dashboard-preview.mjs` | Local-only visual preview (real handlers, one synthetic player, no writes). Never imported by the bot |
| `docs/mega-evolution/M1-IMPLEMENTATION-REPORT.md` | This report |

### Modified
| File | Change |
|---|---|
| `bot_final.js` | Imports. `normalizeUserSchema` step 4 → `normalizeMegaUnlocks(user); normalizeDisplayedTeam(user);` (same output for every team without Megas, proven against the old code). The set-team route uses `prepareTeamSelection`. Mounts the 3 Mega routes behind `requireDashboardSession`. `/api/updateUser` unchanged (still can't write Mega fields) |
| `utils/userSchema.js` | `validateUserSchema` calls `normalizeMegaUnlocks` (repairs if present; never creates the field) |
| `config/features.js` | Capability model (above) |
| `utils/megas.js` | `megaFormGate`, `megaBattleEligibility` |
| `services/inventory.js` | `listInventory(user, { env })`: Mega Stone usable/usage text follows the unlock capability. All other rows unchanged (tested) |
| `public/picker-pokemon/script.js` | Team slots keep a `mega` field (max one); team previews use the Mega sprite; `createConfirmModal` gains an optional `confirmLabel` (default unchanged); `initMegaUI()` dynamic import |
| `tools/generate-megas.mjs`, `data/pokedex/megas.json` | Launch blocker text updated ("Phase M1 unlock flow not built" → "Mega battle transformation not built (Phase M2)") |
| `tests/megaSafety.test.js` | The M0 check "nothing live uses Mega code" replaced by an exact allowlist of M1 files, **plus** stricter checks: 22 battle/reward/acquisition files never mention Mega, nothing reads the reward config, the routes are session-checked, `/api/updateUser` stays closed, and the dashboard module never touches the page when disabled |
| `run-tests.js` | Strips the new sub-flags from test processes |

## 3. Unlock operation

`useMegaStone(user, { line, stoneId, formId, choice?, requestId? }, { env })`:
1. Unlock capability on; form passes `megaFormGate("unlock")` (not blocked, allowlisted, generation live).
2. Line well-formed with explicit `normal|shiny`, matching species, owned (count > 0).
3. Stone: a known Mega Stone, the one this form needs, quantity ≥ 1.
4. Variant choice: the chosen form *is* the choice (Meowstic gender, Tatsugiri appearance). An explicit `choice` must match it. A line's first choice is permanent (`variant_locked`).
5. Not already unlocked (no stone consumed on refusal).
6. Request id well-formed.
7. Record the unlock, consume exactly one stone, return `{ ok, line, formId, name, stone, stonesLeft, choice? }`, or `{ ok: false, error, code, status }`.

Player-facing errors are short. Internal block reasons (design notes such as "D-9") go only into a separate `reasons` field.

## 4. Special cases

| Form | M1 behaviour |
|---|---|
| Meowstic | One card per gender until the player picks. The unlock stores `choice.gender`, and the other gender's card then disappears for that line. Gender is never inferred (not stored by the bot). Gen 6 must be released first. |
| Tatsugiri | Same, with `choice.appearance` (curly/droopy/stretchy). Gen 9 must be released. |
| Magearna | Standard Mega unlockable (Gen 7 must be live). Original Color stays blocked and is never offered. |
| Rayquaza | No stone exists. Blocked; never offered even when Rayquaza is owned; unlock and team selection refused. |
| Floette, Zygarde | Blocked everywhere. |
| Unverified Z-A abilities | Cards say "unverified". Every form is `battleReady: false` with explicit reasons; no battle behaviour is invented. |

Generation gates are unchanged and independent: Megas of Gen 6–9 species can't be unlocked or previewed while their generation is unreleased (production today: Gens 1–5 only).

## 5. Dashboard (verified in a browser)

Checked with `tools/dev/mega-dashboard-preview.mjs` (real handlers, synthetic player) in the in-app browser at 1280 px and 375 px (mobile):
- Unlocked, dormant ("No copies owned — unlock kept") and locked-preview cards with Mega sprite (normal/shiny), name, base relationship, shared Level, Mega types, ability with battle status and "unverified" tag, stats vs base, required stone, preferred star.
- Charizard X/Y and Mewtwo X/Y appear as separate cards. Owned Rayquaza shows no Mega card.
- **Full unlock in the UI:** "Use Charizardite Y" → confirmation (button labelled with the stone) → server consumed 1 → 0, recorded Mega Charizard Y; the card moved to Unlocked.
- **Team:** "Add to team" put Mega Charizard X in Charizard's slot. The save preview showed the Mega sprite, the server stored `{id:6, variant:"normal", mega:"mega-charizard-x"}`, and it survived a reload.
- **Bypass attempts** posted directly to the server were all refused: two Megas, base + Mega, not unlocked, wrong line, dormant line, blocked form, junk form id, missing request id, wrong stone, no stone.
- **Mobile:** no horizontal overflow (page width 375 = viewport), 2-column card grid.
- **Flag off:** the module returns `{enabled:false}` and the page DOM and `<head>` are unchanged (also unit-tested).
- No script errors (the only console errors were the deliberate 400s).

## 6. Tests

| Suite | Result |
|---|---|
| `tests/megaUnlock.test.js` (new) | 89/89 |
| `tests/megaCardsTeam.test.js` (new) | 53/53 |
| `tests/megaSafety.test.js` (updated) | 41/41 |
| `tests/megaCatalog.test.js`, `megaSprites.test.js`, `megaPersistence.test.js` (M0) | 65/65, 23/23, 66/66 |
| **Full suite `npm run test:safe`** | **50 of 51 files pass**; 1,643 of 1,644 counted assertions |
| `npm run validate:megas`, `npm run validate:catalog` | ✅ both |

**The one failure is the known pre-existing one:** `tests/achievements.test.js`, "exactly 500 CC granted, claim recorded today" (test clock pinned to 2026-11-09). It is unchanged, as instructed, and it is the only unrelated failure. Master has since fixed it (PR #55, `42f6ec83`), so it disappears once M1 is rebased or merged onto current master.

Crash and failure boundaries actually exercised (`megaUnlock.test.js`, real `saveQueue` + `localStore` + `loader` + `validateUserSchema`):
- **Unsaved unlock, then a crash:** after reboot the unlock **and** its stone are both absent; the earlier durable unlock and its consumed stone are both present.
- **Torn temp file** (interrupted write): ignored; the last complete snapshot loads.
- **Corrupt current file:** falls back to a snapshot that is internally consistent (unlock and stone agree).
- **Retry after restart:** the durable `requestId` replays and consumes nothing.
- **Failed save:** reported as `saved: false, persisted: "pending"`; memory holds both changes; the retry confirms without a second stone.
- **Concurrency:** 8 parallel requests with different ids give 1 unlock, 7 refusals, 1 stone. 5 parallel double-clicks with the same id give 1 unlock, 4 replays, 1 stone.

Regression covered: random-team equivalence with the pre-M1 route and normalizer (2,000 cases, identical results and error messages); bag rows identical with the flag on or off; achievements and Pokédex metrics unchanged; gifts and donations don't move or copy unlocks; existing battles unchanged; the existing test suite otherwise green.

## 7. Security review of new inputs

| Input | Validation (server-side) |
|---|---|
| Player id | `^\d{5,25}$` + dashboard session (`requireDashboardSession`) + record exists |
| Line | `^([1-9]\d{0,3}):(normal|shiny)$` (explicit variant; no default); species must match the form; must be owned |
| Form id | `^mega-[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64 chars, must exist in the catalogue, must pass the form gate |
| Stone id | `^megastone_[a-z0-9]{1,40}$`, must be one of the 92 catalogued stones and the form's own stone |
| Choice | Optional object with exactly one key (`gender`|`appearance`) and a string value; must equal the form's variant |
| Request id | Required for unlock, `^[A-Za-z0-9-]{8,64}$` (no `_`, so it can't spell `__proto__`) |
| Team slot `mega` | Must be a well-formed id string; otherwise refused (not silently dropped); then all team rules |
| Bodies | `express.json({ limit: "4kb" })` on the Mega routes |

Client-reported unlock state is never trusted: cards, eligibility and quantities come from the server, and every write re-checks under the player lock.

## 8. Master drift

`origin/master` advanced from `5157cfe6` to `15caf105` during M1:
- PR #55 (`42f6ec83`): achievements test injectable clock.
- PR #52 (`9496d296`): battle result embed shows rating changes, and EXP is sent privately. It touches `commands/battle.js`, `utils/battle/playback.js`, `services/achievementsApi.js` and tests.

M1 changes none of those files. A trial merge was run in a throwaway worktree (results recorded at commit time in the final report message). The M1 branch itself was **not** merged or rebased, per instructions.

## 9. Known limitations

- Unlocking is dashboard-only (no `/mega` Discord command; see §1).
- Mega cards are a separate section in Team mode, not mixed into the region grid.
- `/showteam`, the trainer card and battle images show the base sprite for a Mega slot until M2 (consistent with the battle boundary).
- `/api/updateUser` (legacy team path) drops a `mega` field, so a team saved through it battles as base. The dashboard uses `set-pokemon-team`.
- No shard exchange, rewards, drops or vouchers (M4).
- The preview tool is for local visual checks only.

## 10. Remaining dependencies for Phase M2 (battle)

1. Move flags in `battleData.json`; `utils/battle/abilities.js` with the 34 current-engine abilities; stat stages, switch-in/end-of-turn phases, weather, terrain and burn for the other 20 (`MEGA-ABILITY-MANIFEST.md`).
2. `buildTeam` → `member.megaForm`; `buildMon` species override (stats, types, HP rule from `MEGA-BATTLE-DESIGN.md` §4); EXP stays on base BST (D-10).
3. Flip `BUILT.battle` only with the seeded golden test proving non-Mega battles are byte-identical.
4. Render and playback: Mega sprite, "Mega Evolved!" frame (`utils/battle/render.js`, `playback.js`, which PR #52 changed, so rebase first).
5. Verify the unverified Z-A abilities, or keep those forms out of battle.
6. Decide the Discord `/mega` command and the `mega` inventory category before activation.
