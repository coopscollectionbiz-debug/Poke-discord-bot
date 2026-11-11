# Held Items: Technical Implementation Report

| | |
|---|---|
| Branch | `feature/held-items` (local only; **not pushed, not merged, not deployed**) |
| Base | `origin/master` `8c7cc5cb` (latest, verified with `git fetch` before starting) |
| Worktree | `E:\Poke-discord-bot-held-items` |
| Design | [HELD-ITEM-AMENDMENT.md](../HELD-ITEM-AMENDMENT.md) supersedes parts of the eight audit documents |
| Production impact | none while `HELD_ITEMS_*` flags are unset (default) |

## What was built

### Data and services
- **`catalog/heldItems.js`**: the 33 launch items as data (name, group, exact effect text, activation rule, price, starter flag, species restriction, glyph). Choice Band, Choice Specs, Choice Scarf, Life Orb, Rocky Helmet and Assault Vest are deliberately absent.
- **`catalog/items.js`**: adds the 33 as `category: "held"` entries with `maxStack: 1`, `equip: { slot: "pokemon" }` and a shop price. Replaces the never-obtainable `charcoal` placeholder (same id). Adds `isHeldItem()`.
- **`services/inventory.js`**: held-item grants are also gated by the held-item flags, per player. A second copy gives `already_owned`. `/inventory` usage text for held items. Stackable items are unchanged.
- **`config/features.js`**: `HELD_ITEMS_ENABLED`, `HELD_ITEMS_TESTERS`, and the sub-flags `DASHBOARD`, `STARTER`, `SHOP` and `BATTLES` (battles are opt-in).
- **`services/heldItems.js`**:
  - unlock reads;
  - the versioned starter entitlement;
  - team-scoped equipment (`user.equipment.teams[teamId][line]`);
  - Item Clause, Mega slot, saved-member and species rules;
  - atomic move within a team;
  - reconciliation, load-time repair and `battleItems()` battle-time validation;
  - admin reset helper.
- **`services/heldItemsApi.js`** (dashboard only):
  - `GET /api/held-items`;
  - `POST /api/held-items/claim-starter`;
  - `POST /api/held-items/equip` (equip / move / remove; `requestId` replay and `expectedRev` stale guard);
  - `POST /api/held-items/buy`.

  All of them check the session, the flags, ownership, prices and legality server-side, inside the player's lock (`runInventoryTransaction`). Bodies are capped at 4 KB, with a per-player write limit of 30 per minute.
- **`bot_final.js`**: mounts the four routes. Runs `normalizeEquipment` after the team cleaning. A team save reconciles that team's equipment and returns `itemsCleared`.
- **`commands/reset-team.js`, `commands/resetuser.js`**: also clear team equipment. Unlocks are kept.

### Battle
- **`utils/battle/items.js`**: the item registry (one entry per item, hooks only), `isCombatItem`, `expMultiplierFor`.
- **`utils/battle/effects.js`**: item hooks at fixed points:
  - base power, attack, defense and final damage;
  - accuracy (Bright Powder);
  - KO prevention per hit (Focus Sash, Focus Band);
  - after HP drops (Sitrus, including between multi-hits and after residual damage);
  - after the move (Shell Bell);
  - turn order (Quick Claw, which draws only when a holder is involved);
  - end-of-turn residual (Leftovers, Black Sludge; faster battler first, before burn);
  - per-battle `itemUsed` reset;
  - healing that clamps at max HP, never revives, and has a minimum of 1.
- **`utils/battle/sim.js`**: members carry `item`. A battle goes to the effect engine when any battler has an ability **or a combat item**. It is proven identical when no effect is present.
- **`utils/battle/runBattle.js`**: `buildTeam` reads the team's equipment inside the battle locks and copies it onto each member. That copy is the snapshot, and it is recorded in the result. A slot battling as a Mega gets no regular item. Lucky Egg gives `⌊1.5 × battle EXP⌋` to the holder, recorded as `bonusFrom`/`baseGained`. Power, the surge and ranked Lv 50 are untouched.

### Dashboard
- **`public/teams/items.js`** (new): the item picker. Desktop dialog, full-height phone sheet. Current item with its exact effect and Remove. Search, group filters, "only my unlocks". Statuses: equipped here / free / held by a team-mate → **Move here…** with an inline confirm / not unlocked → Shop / species-locked. Warnings for Eviolite with no effect and Black Sludge on non-Poison types. Saves immediately. A stale or conflict reply re-syncs.
- **`public/teams/script.js`**: an item badge on each slot's sprite stage (desktop; hidden on compact phone cards so it never covers the sprite) and an **Item** button next to **Moves**. The Mega Stone placeholder replaces the item controls on Mega slots. A team loadout summary ("Items 4/6 · 1 Mega Stone · ✓ all different" plus the unlock explanation). Starter claim on the first visit. Unsaved team members show "save team first".
- **`public/dashboardshop/heldItems.js`** + `index.html`: a "Held items" section (Owned / Free / Buy with confirm), hidden unless the shop flag is on.
- CSS in `public/teams/style.css` and shared icon styles in `public/shared/components.css`.

### Tooling and analysis
- `tools/held-items-audit.mjs`: read-only migration dry run on a data copy.
- `tools/dev/held-items-preview.mjs`: a local Teams/Shop preview over one synthetic player, using the real handlers (`PREVIEW_MEGA=1` shows a Mega slot). Never deploy it.
- `analysis/held-items/runImplemented.mjs`: balance validation on the implemented engine.

## Files changed

24 code, test and tool files: +2,221 / −31 lines. Docs and analysis are not included in that count.

```
bot_final.js                      +34
catalog/heldItems.js              new
catalog/items.js                  ±
commands/reset-team.js            +2
commands/resetuser.js             +2
config/features.js                +51
public/dashboardshop/heldItems.js new
public/dashboardshop/index.html   +8
public/shared/components.css      +14
public/teams/items.js             new
public/teams/script.js            ±
public/teams/style.css            +
services/heldItems.js             new
services/heldItemsApi.js          new
services/inventory.js             ±
tests/heldItemBattle.test.js      new
tests/heldItems.test.js           new
tests/megaSafety.test.js          +4 (allowlists the two held-item services: Mega-slot checks + shared flags module)
tools/dev/held-items-preview.mjs  new
tools/held-items-audit.mjs        new
utils/battle/effects.js           ±
utils/battle/items.js             new
utils/battle/runBattle.js         ±
utils/battle/sim.js               ±
```

## Tests

- `npm run test:safe`: see the final count in the summary below this table.
- New: `tests/heldItems.test.js` (94 checks) and `tests/heldItemBattle.test.js` (73 checks). They cover:
  - flags and the tester allowlist;
  - unique unlocks, and ordinary stacks unchanged;
  - the starter grant: eight items, once, idempotent, no overwrite, nothing else touched;
  - one Leftovers on Display + Battle; Item Clause; atomic move; replace and remove keep the unlock;
  - not-member, not-owned, species, deferred-item and no-team refusals;
  - Mega slot: placeholder, refusal, clearing only that team on save, re-enable;
  - reconciliation and load-time repair of corrupted data (idempotent);
  - rollback compatibility;
  - battle-time fail-closed validation;
  - API: 400/403/404, flags off, replay, stale `expectedRev`, 5 concurrent equips with exactly one winner, double click, purchase charged once, already-owned refusal, insufficient CC, shop off, rate limit, save failure plus replay;
  - battle: registry/catalog agreement; inert items change nothing (400 seeded battles); effect engine equals the legacy loop with no effects (300); exact numbers for every launch effect; once-per-battle behaviour and reset; RNG draws only when a holder is involved; determinism; snapshot and team isolation; Power unchanged; Lv 50 intact; Lucky Egg ×1.5 floor, team-mates unaffected, level cap; nothing used up.
- Existing regression gates still pass, including the 3,000-battle no-Mega corpus (`megaBattleRegression`), `megaSafety`, `mutationGuard`, `commandContract` (no new slash commands) and `dashboardFoundation`.

## Simulations, migration, UI

- Balance on the implemented engine: [BALANCE-VALIDATION.md](BALANCE-VALIDATION.md). Every gate passed except one cross-tier cell, which is within sampling noise. 0 no-item differences against master in 3,000 battles. 500/500 replays identical.
- Migration dry run on the production copy: [MIGRATION-VALIDATION.md](MIGRATION-VALIDATION.md). **PASS**, with 0 unintended changes across 2,884 records.
- UI was checked in a browser through the local preview at desktop width and at 375 px:
  - starter claim, equip, search, move-within-team confirm, cross-team independence;
  - warnings, Mega Stone placeholder, shop purchase;
  - no horizontal scroll.

  Screenshots are in [previews/](previews/). Bugs found and fixed during this check: search lost text on re-render, the dialog jumped when filtering and on confirm, the phone summary was squeezed, the badge covered sprites on phones, and Mega Stone names were truncated.

## Remaining limitations (not done, or pending validation)

1. **Production-like validation:** the dry run used the 2026-11-10 16:17 copy, which predates Battle teams. It must be rerun on a fresh copy before the deploy (rollout step 3). The UI was tested against the local preview, not the real bot process with Discord.
2. **Item icons** are emoji glyphs, because no held-item sprite assets exist. Final art needs the owner's choice and licensing.
3. **Discord displays:**
   - battle replays show item activations through the existing notes;
   - `/inventory` lists held items;
   - `/showteam`, `/showbattlecard` and the EXP card don't draw item icons or a "Lucky Egg" label yet (optional, display only).
4. **Vouchers, weekly-pack items, and ranked or season item rewards** are deferred (no clean existing reward hook; achievement item rewards are unapproved).
5. **Mega + item** in a *live* Mega battle is covered by engine tests and simulations. Mega flags are off in production, so it hasn't been exercised in the real bot.
6. **Team saves** still have no revision token (a pre-existing gap). Equipment changes do, and a team save that drops assignments bumps the equipment revision so other tabs re-sync.
7. **Future saved Battle teams:** the storage and team-id pattern support them, and unknown well-formed team ids are preserved. No UI, API or battle path uses them yet.
8. Owner decisions are still open: prices, icons, the EXP-card label (rollout §D).
