# Held Items: Data Safety and Migration

## 1. Starting state (verified on the 2026-11-10 production copy)

| Check | Result |
|---|---|
| Records | 2,884 |
| Any `heldItems`/`equip`/`gear` field, or a non-`normal`/`shiny` key under `pokemon[id]`, or an extra key on a team slot | **none** |
| Held-item ids in `items` | **none** (only `evolution_stone` 918 and `shiny_dust` 1,578) |
| `itemsLegacy` quarantine entries | 0 |
| `battleTeam` set | 0 at copy time (Teams page shipped afterwards, in PR #67) |

**There is no existing equipment to preserve or convert.** The migration is purely additive.

## 2. Schema changes

| Field | Type | Created when | Absent means |
|---|---|---|---|
| `user.heldItems` | `{ "id:variant": itemId }` | first equip | nothing equipped |
| `user.heldItemsRev` | safe integer ≥ 0 | first equip | 0 |
| `user.heldItemsLegacy` | `[{ key, value, reason, at }]` | normalizer quarantines something | nothing quarantined |
| `user.items[heldId]` | integer (existing map) | purchase, voucher or admin grant | 0 |
| catalog entries | `catalog/items.js` | release | — |

Nothing existing is renamed, moved or reformatted. `pokemon`, `items` counts, `cc`, `displayedPokemon`, `battleTeam`, `movesets`, `training` and `megaUnlocks` are all untouched.

## 3. Migration procedure

**There is no batch migration.** `normalizeHeldItems(user)` runs lazily inside `validateUserSchema`, like `normalizeMegaUnlocks`. It:

- never creates `heldItems`;
- never changes `items`, `cc`, `pokemon` or either team;
- only removes invalid **bindings** and records them in `heldItemsLegacy`.

Because no record has the field today, the first boot of the release changes **zero** records. That is verified by a dry-run tool, below.

New tool: `tools/held-items-audit.mjs <trainerData.json>`. It is read-only by default. It reports, per invariant I-1 to I-4 (architecture §2):

- counts of violations;
- the bindings the normalizer would drop;
- a SHA-256 of every record's `pokemon`, `items`, `cc`, `displayedPokemon` and `battleTeam`, before and after normalization (they must match).

Run it on a fresh copy of production before every deploy in this feature, and after the deploy on the post-boot snapshot.

## 4. Malformed and legacy records

| Input | Behaviour |
|---|---|
| `heldItems` is not a plain object (array, string, null) | Quarantine the whole value and delete the field |
| Bad line key (`"abc"`, `"6:gold"`, `"__proto__"`) | Drop that binding and quarantine it |
| Binding to an unknown id, a non-held id or a `defined` id | Drop and quarantine (the item stays in `items`) |
| Binding to a line that isn't owned | Drop (the item stays in `items`) |
| More bindings than copies owned | Keep Battle-team members first, then Display-team members (slot order), then ascending line key. Drop the rest. |
| `heldItemsRev` not a safe integer | Reset to 0 (the next equip makes it 1) |
| Unknown future item ids in `items` (for example after a rollback and roll-forward) | Kept (the existing `normalizeInventory` rule) |

**No item is ever created by repair.** Repair only removes bindings, and bindings don't hold quantity. That is the core duplicate-prevention guarantee.

## 5. Duplicate prevention summary

1. Equipping never changes `items` counts (reservation model).
2. Purchases and vouchers go through `runInventoryTransaction` with a request-id replay, so a retried request never grants twice.
3. I-1 is checked under the user lock on every equip.
4. A `consumeItems` reservation guard stops any sink from consuming equipped copies.
5. The normalizer enforces I-1 on load, so a corrupted or restored record can't hold more equipped copies than it owns.

## 6. Backup and recovery

Follow the procedure proven in Releases B, C and Mega:

1. **Pre-deploy backup:**
   - pull `/data/trainerData.json` plus its meta (`MSYS_NO_PATHCONV=1 flyctl ssh sftp get`) into `E:\PokeBot-Restricted\backups\pre-held-items-<UTC>`;
   - record the seq, epoch and SHA-256;
   - generate per-player fingerprints (the existing baseline tooling).
2. **Dry run:** `tools/held-items-audit.mjs` on that copy. The expectation is 0 records changed.
3. **Deploy** (a master merge, which auto-deploys). The boot log must show the player count unchanged and `held items: 0 bindings repaired`.
4. **Post-deploy verify:** pull the post-boot snapshot and compare fingerprints. Only records that equipped or bought items since then may differ, and only in the `heldItems*` and `items[heldId]` fields and `cc`.
5. **Recovery path:** the existing Fly volume snapshots, daily `/data/snapshots/`, Discord backups (epoch-fenced), and the restricted pre-deploy copy.

Fly.io compatibility: no new files and no new volume paths. Everything lives in `trainerData.json` on `/data`, written by the existing `saveAndAck` path and fenced by the writer epoch.

## 7. Rollback

| Rollback to | What happens to new data | Safe? |
|---|---|---|
| **Flag off** (`HELD_ITEMS_*` unset) | Battles ignore items, the dashboard hides the controls, and the shop stops selling. All bindings and items are kept. | **Yes, the preferred first response** |
| **Previous Fly release** (pre-feature image) | Old code ignores `heldItems`/`heldItemsRev` (unknown top-level fields are kept by `validateUserSchema`, which repairs in place and never strips). Held item ids in `items` are kept as "unknown" items by `normalizeInventory`, and `/inventory` shows them as "an item from an earlier version". CC spent stays spent. | **Yes.** Players keep what they paid for. It reappears on roll-forward. |
| **Restore the pre-deploy backup** | Loses every purchase made since the deploy (the CC is returned implicitly, because the old `cc` is restored) | Last resort only: it also reverts all other progress since then |

**Rollback requirements:**
- Every phase ships behind flags whose default is OFF.
- The previous release's image id is recorded before each deploy.
- No phase rewrites existing fields, so a code rollback never needs a data rollback.
- `tests/heldItemsRollback.test.js` loads a record with `heldItems` and new ids into the **old** normalizers (`validateUserSchema` from the base commit, via a git-show fixture) and asserts that nothing is dropped or changed.

## 8. Deployment risks

| Risk | Mitigation |
|---|---|
| Battle results change for battles with no items after the routing change | No-item corpus gate (0 differences) plus the existing no-Mega corpus |
| A slow playback queue if the effect engine is slower | The corpus run reports simulation time. Playback rendering dominates. |
| A purchase spike that hits a save delay | The existing durable acknowledgement and "saved with a delay" UX. Replays are safe. |
| Command registration (REGISTER_COMMANDS=true re-registers on every boot) | No new commands in this feature, so nothing to register |
| Owner testing in production with no tester audience | Add `HELD_ITEMS_TESTERS` (a Discord id allowlist) so the owner can verify the live feature before the global flag |
