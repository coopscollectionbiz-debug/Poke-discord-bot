# Held Items: Architecture Amendment (Phase A)

The implementation brief of 2026-11-10 supersedes parts of the eight audit documents. This amendment records each change and the final design as built on branch `feature/held-items`, which is based on master `8c7cc5cb`. Where this file and the audit disagree, this file wins.

## 1. Superseded decisions

| Audit decision | Superseded by | Why |
|---|---|---|
| D-H1: equipment per Pokémon **line** (`species:variant`), shared by both teams | **Team-scoped equipment**: each team loadout has its own assignments | Owner requirement: the same unlock can be used on different teams |
| D-H3: a stack count + reservation per physical copy (I-1: bindings ≤ owned) | **One account-wide unlock** (quantity 0 or 1), reusable once in *every* team | Owner requirement: no copies, no reservations |
| D-H8: `maxStack` 2, prices 2,500 / 5,000 / 8,000 | **`maxStack` 1** (an unlock). Prices re-evaluated in §8. | The permanent-unlock model |
| D-H9: vouchers, weekly pack, season rewards | **Eight free starter unlocks** plus the shop. Vouchers are deferred. | Owner requirement (keep launch simple) |
| D-H6: 33 items including Choice Band, Choice Specs and Choice Scarf | **33 items, with no Choice items.** Bright Powder, Focus Band and Lucky Egg replace them. | Choice locks are deferred (automatic battles, no switching) |
| D-H5 A: a Mega ignores its item in battle | **Kept and strengthened.** A Mega slot can't be assigned an item at all, and shows its Mega Stone as a placeholder. | Owner requirement |
| D-H2: Item Clause per team | **Kept**, strict, enforced in the UI, the server and at battle time | — |

Unchanged from the audit: the item registry plus effect-engine hooks, routing to the effect engine only when an effect is present, Life Orb / Rocky Helmet / Assault Vest deferred, surge Power excluding items, flags off by default, and dashboard-only management.

## 2. Ownership: account-wide unlocks in the existing inventory

- An unlock is stored in the existing inventory as `user.items[id]` = 1. The catalog entry has `stackable: false` and `maxStack: 1`. The existing `grantItem` limit therefore refuses a second copy (code `already_owned`). Ordinary items (Evolution Stones, Shiny Dust) keep their stack behaviour, because the limit is per catalog entry.
- **Equipping never touches `user.items`.** Nothing is consumed by assigning, removing or battling.
- Every held-item grant (shop, starter, admin `/addinventory`, achievement rewards) also passes the held-item feature flag check in `validateHoldableItem`. While the flags are unset (production), no held item can be obtained by any path.
- The old `charcoal` catalog entry was a Release B placeholder: "defined", never obtainable, and owned by nobody (verified: 0 records hold it). It is replaced by the active held item with the **same id**, so no id is duplicated.

## 3. Team-scoped equipment

```js
user.equipment = {
  rev: 7,                                      // +1 on every change (stale-tab guard)
  teams: {
    display: { "6:normal": "leftovers", "25:normal": "lucky_egg" },
    battle:  { "143:normal": "leftovers", "94:normal": "focus_sash" },
    // future: "battle:<name>" for saved Battle teams (stored untouched today)
  },
};
```

- The **team id** is `display` (`user.displayedPokemon`) or `battle` (`user.battleTeam`). The pattern `^(display|battle)(:[a-z0-9-]{1,32})?$` already accepts future saved Battle teams. This version keeps such entries exactly as stored, and refuses to edit them or battle with them.
- The **member id** is the line key `species:variant`, which is unique within a team (the team rule). There are no per-Pokémon instance records.
- **Rules**, enforced in `services/heldItems.js` on every write and re-checked by `battleItems()` at battle time (fail-closed):
  - R1: one item per member.
  - R2: the Item Clause (an item at most once per team).
  - R3: only members of the **saved** team can hold items.
  - R4: no regular item on a slot set to Mega Evolve on that team.
  - R5: the item must be owned, must be in the held category, and species items only go on their species.
- **Move within a team:** equipping an item another member holds is refused with `item_clause` (and the holder's id), unless the request says `move: true`. With `move: true`, both changes happen in one atomic mutation.
- **Reconciliation:**
  - When a team is saved, `reconcileTeamEquipment` drops that team's assignments for members that left or are now Mega slots. The reply lists them (`itemsCleared`) and the UI says "your unlocks are kept".
  - On load, `normalizeEquipment` runs after the team cleaning. It drops assignments for Pokémon no longer owned, items no longer owned, unknown ids, malformed keys and Item Clause duplicates (the earlier slot wins).
  - It only ever **removes assignments**. Structural garbage is recorded in `user.equipmentLegacy`.
  - It never creates the field.

## 4. Mega Evolution and the item slot

- A slot with `mega` on a team shows a **virtual Mega Stone placeholder**, derived from the form's prerequisite (`megastone_*`). It is never bought or owned through the held-item shop.
- Equip on that slot is refused (`mega_slot`). Saving a team that newly sets a Mega clears **only that team's** assignment for that slot, and says so. Other teams with the same Pokémon are not touched.
- Turning Mega off frees the slot again (the unlock was kept, so it can be re-equipped). I chose "clear with notice" over "suspend" because a suspended item could collide with the Item Clause when it came back.
- In battle, `buildTeam` drops a regular item from the slot that actually battles as a Mega. `battleItems` already skips stored Mega slots.

## 5. The eight free starter unlocks

Leftovers, Sitrus Berry, Focus Sash, Quick Claw, Expert Belt, Bright Powder, Focus Band and Lucky Egg. There is no type booster among them.

- **Mechanism:** a versioned entitlement, `user.heldItemGrants.starter = 1`. `ensureStarterHeldItems` adds each missing unlock through `grantItem`, skips any already owned, then records the version. It is idempotent: a restart, retry or repeat changes nothing. A future starter-set change bumps `STARTER_GRANT_VERSION` and grants only what is missing.
- **When:** lazily, through its own transaction (`POST /api/held-items/claim-starter`, request-id replay), which the Teams and Shop pages call on the player's first visit. Equipment only exists on the dashboard, so the first visit is the first moment the items can matter. New and existing players take the same path. There is **no bulk rewrite**: boot changes no record.
- **Flags:** `HELD_ITEMS_STARTER_ENABLED`, under the master flag and the tester allowlist.
- **Dry run on the production copy** (2,884 records): every record would get exactly the eight unlocks. 0 Pokémon, Level, CC, team, trainer, progression or other-item changes. A second run changes nothing. Details are in the migration report.

## 6. Choice items deferred: the revised 33

| Kind | Items | Count |
|---|---|---|
| Free starters | Leftovers, Sitrus Berry, Focus Sash, Quick Claw, Expert Belt, Bright Powder, Focus Band, Lucky Egg | 8 |
| Shop: non-type | Eviolite, Shell Bell, Black Sludge, Muscle Band, Wise Glasses, Light Ball, Thick Club | 7 |
| Shop: type boosters | Charcoal, Mystic Water, Miracle Seed, Magnet, Never-Melt Ice, Black Belt, Poison Barb, Soft Sand, Sharp Beak, Twisted Spoon, Silver Powder, Hard Stone, Spell Tag, Dragon Fang, Black Glasses, Metal Coat, Silk Scarf, Fairy Feather | 18 |
| **Total** | | **33** |

Count check: the audit's launch set had 33 items. Removing the 3 Choice items leaves 30. Bright Powder, Focus Band and Lucky Egg were **not** in that launch set (the audit had them as "not at launch", "phase 2" and absent), so adding them gives exactly **33 unique ids** (a test asserts this). No further substitute was needed, so none was activated.

Deferred, with no catalog or registry entry: Choice Band, Choice Specs, Choice Scarf, Life Orb, Rocky Helmet and Assault Vest. Tests assert they can't be equipped, bought or battled with.

## 7. Lucky Egg: tracing EXP

| Question | Finding (code) |
|---|---|
| EXP award paths | (1) **Battle EXP**: `runBattle.applyExp`, from `teamExp` (Gen V formula, every member earns from every KO, ×1.5 for a win). (2) **Duplicate catches**: `grantCatch` gives half the EXP to the next Level. (3) Admin Level tools. |
| Attribution | Per line (`user.training["id:variant"].exp`). The Level comes from EXP (Level³). |
| Scope | Every member of the battling team, including fainted ones (Exp. Share style) |
| Casual vs ranked | Casual: the challenger earns at real Levels. Ranked: the challenger earns at **real** Levels (not the Lv 50 battle Level). Wager: both players earn. |
| Max Level | `setExp` caps EXP at `expForLevel(100)` |
| Anti-farming | Daily caps: 10 battles per day, 3 per opponent per day (`CAPS`) |

**Applied to battle EXP only:** `gain = ⌊base × 1.5⌋` for the member whose **battle-team loadout** holds Lucky Egg. The other members, catches, CC, TP, achievement points and every other reward are unchanged. Duplicate-catch EXP is not "battle EXP" and is not boosted, which matches mainline, where Lucky Egg affects battle experience only. No new EXP path was added. The cap is still enforced. The EXP result records `bonusFrom: "lucky_egg"` and `baseGained` for display.

## 8. Economy: re-evaluation under permanent unlocks

- **Finite one-time sink.** A player buys each of the 25 shop items at most once, ever. The full shop costs **87,000 CC** in total: 18 × 3,000 + 3 × 4,000 + 3 × 5,000 + 6,000.
- **The strongest items are free.** Leftovers, Sitrus Berry, Focus Sash and Expert Belt are starters, so shop items are side-grades and specializations. Prices gate **collection and customization**, not power.
- **Prices.** I re-evaluated the audit's 2,500 / 5,000 / 8,000 bands. One purchase now serves every team, so it is worth more than an audit copy. But the premium tier (Leftovers and similar) is now free. That gives:
  - type boosters: 3,000 CC;
  - Muscle Band, Wise Glasses, Black Sludge: 4,000;
  - Shell Bell, Light Ball, Thick Club: 5,000;
  - Eviolite: 6,000 (the strongest shop item for unevolved Pokémon).
- **Against wealth data:**
  - The active-player median (6,250 CC) buys one or two items at once.
  - A typical ranked player's wants (two or three STAB boosters plus Eviolite or a band) cost about 12,000–21,000, around p75 active wealth.
  - Completing the shop costs about p90 wealth.
- **No resale, no trading, no consumption.** The sink is bounded per player, and items create no CC.
- **Deferred:** vouchers, weekly-pack items, ranked and season rewards. There is no clean existing reward hook for items in these flows. Achievement item rewards exist in code but are unapproved.

## 9. Flags

| Variable | Default | Controls |
|---|---|---|
| `HELD_ITEMS_ENABLED` | unset = OFF | master switch |
| `HELD_ITEMS_TESTERS` | unset = everyone, once the master is on | comma-separated Discord ids: a staged audience |
| `HELD_ITEMS_DASHBOARD_ENABLED` | on under the master | Teams UI, view, equip |
| `HELD_ITEMS_STARTER_ENABLED` | on under the master | starter claim |
| `HELD_ITEMS_SHOP_ENABLED` | on under the master | buying |
| `HELD_ITEMS_BATTLES_ENABLED` | **opt-in** | combat effects and Lucky Egg EXP |

Turning any flag off deletes nothing: battles ignore items, and the UI hides the controls.
