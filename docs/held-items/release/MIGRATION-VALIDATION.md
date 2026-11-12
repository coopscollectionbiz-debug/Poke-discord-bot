# Held Items: Data Migration Validation

## Schema (additive only)

| Field | Created | Absent means | Who writes it |
|---|---|---|---|
| `items[<held id>]` = 1 | Starter claim, purchase, admin grant (all behind the flags) | Not unlocked | `services/inventory.js` `grantItem` only |
| `heldItemGrants.starter` = 1 | The first starter claim | Not claimed yet | `ensureStarterHeldItems` |
| `equipment.{rev, teams.{display, battle}}` | The first equip | No equipment | `services/heldItems.js` |
| `equipmentLegacy[]` | The repair quarantines something | Nothing quarantined | `normalizeEquipment` |

**No existing field is renamed, reformatted or removed.** That covers Pokémon counts (normal and shiny), training/Levels, CC, TP, inventory, trainers, both teams, movesets, Mega unlocks, achievements and the battle records.

## There is no batch migration

- The load path (`normalizeUserSchema` → `normalizeEquipment`) never creates fields.
- The starter grant is lazy: its own request, made on the player's first dashboard visit, through `runInventoryTransaction`.
- Booting this release therefore changes **zero** records.

## Dry run on a copy of production data

`node tools/held-items-audit.mjs <copy of trainerData.json>`. Read-only and in memory. It prints aggregates only.

The input was the restricted copy of `/data/trainerData.json` taken 2026-11-10 16:17 UTC: seq 2328, SHA-256 `f7d8e5ce…557b69`.

| Check | Result |
|---|---|
| Records | 2,884 |
| Records that already have held-item data | 0 |
| Records changed by the load-time repair | **0** |
| Records the starter grant applies to | 2,884 |
| Unlocks granted | 23,072 = 2,884 × 8 (none were already owned) |
| Records where Pokémon, Levels, CC, TP, teams, movesets, Mega unlocks, trainers, progression, purchases or `lastDaily` changed | **0** |
| Records where any other inventory item changed | **0** |
| Records changed by a second grant run (idempotence) | **0** |
| Errors | 0 |
| **Verdict** | **PASS** |

**Limitation:** this copy predates the PR #67 merge (Battle teams, movesets), so it holds no `battleTeam` data. The automated tests cover records that do have Battle teams and movesets. **Rerun the dry run on a fresh production copy before the deploy** (rollout checklist, step 2).

## Malformed and legacy data

These cases are covered by `tests/heldItems.test.js`:

- Missing `equipment`: stays missing.
- Non-object `equipment` (array, string): quarantined to `equipmentLegacy`, then removed.
- Malformed team ids: quarantined. Well-formed future ids such as `battle:future-1` are kept untouched.
- Bad line keys, unknown or deferred item ids, and Item Clause duplicates are dropped. The earlier slot wins, and the drops are recorded.
- An assignment whose Pokémon left the team, became a Mega slot or is no longer owned is dropped. The unlock is kept.
- An assignment whose item is no longer owned (for example after an admin correction) is dropped.
- A bad `rev` is reset and then bumped.
- The repair is idempotent: running it again changes nothing.
- The repair **only removes assignments and never removes unlocks**, so it can't create or destroy an item.

## Duplicate prevention

1. Unlocks are `maxStack: 1`. `grantItem` refuses a second copy, whatever the path (shop, starter, admin, rewards).
2. Purchases and starter claims run through `runInventoryTransaction` with a request id, so a retry replays the first result and never charges or grants twice. Tested, including a save failure followed by a retry.
3. Equipping never changes `items`.
4. Concurrent equips serialize on the player lock. With `expectedRev`, exactly one of five simultaneous equips succeeds and the other four get `stale` (tested).

## Rollback compatibility

The test "Old versions keep the new data" in `tests/heldItems.test.js` checks two things:

- `validateUserSchema` and `normalizeInventory` keep `equipment`, `heldItemGrants` and the unlocks.
- Unknown item ids with valid counts are kept, which is the rule older releases rely on.

A rollback to the pre-feature image therefore loses nothing. The data comes back on roll-forward. Older code ignores `equipment`, so battles run without items.

## Persistence

Nothing new touches storage. All writes go through the existing `saveAndAck` path:

- durable acknowledgement;
- "saved with a delay" on a failed write, with the change kept in memory and retried;
- epoch-fenced snapshots on the Fly volume.

No new files or volume paths. **The live Fly volume was not touched.** Every run used a local restricted copy or synthetic players.
