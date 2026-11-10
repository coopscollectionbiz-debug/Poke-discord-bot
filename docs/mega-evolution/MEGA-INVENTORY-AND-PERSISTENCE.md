# Mega Evolution: inventory and persistence

## 1. The existing inventory (audited)

- `catalog/items.js` is the single item catalogue. Ids are stable and never reused. `status: "active" | "defined"` (defined = not obtainable). `storage: "inventory" | "instant" | "purchase_flag"`. It has `tradable`, `consumable`, `equip` and `shop` metadata.
- `services/inventory.js` is the only writer of `user.items`. `grantItem`/`consumeItems` are synchronous and all-or-nothing. `runInventoryTransaction()` does validate → lock → replay check → mutate → `saveAndAck` → acknowledge, with **request-id replay protection** (`user.itemRequests`, 24 h TTL, `durable` flag).
- `grantItem` refuses `defined` items, so stones can be catalogued long before they are obtainable.

## 2. Model chosen: consumable stone → permanent line unlock

| Model | Verdict |
|---|---|
| Permanent inventory unlock (keep the stone, unlock the species globally) | Rejected: species-global, against the approved rules |
| Non-consumable equipment held by a Pokémon | Rejected: needs an equipment system (`equip` exists only as metadata) and per-instance identity |
| **Consumable stone, used on an owned line, creates a permanent unlock on that line** | **Recommended** (the approved recommendation) |

Using a stone consumes **one** stone and writes `megaUnlocks[line].forms[stableId]`. Mega Evolution in battle never consumes anything.

### Stone catalogue entries (92 stones)

```js
item({
  id: "megastone_charizarditex",   // "megastone_" + Showdown item id
  name: "Charizardite X",
  description: "Use on a Charizard to permanently unlock Mega Charizard X for that Charizard.",
  category: "mega",                // new category, order 3
  rarity: "epic",                  // "legendary" for the 10 Legendary/Mythical stones
  consumable: true,
  tradable: false,
  status: "defined",               // becomes "active" only at activation, per form
  storage: "inventory",
  maxStack: 99,
  shop: null,                      // never in the standard shop
  sources: ["quest_rare", "achievement", "event"],
  mega: { forms: ["mega-charizard-x"], species: 6 },
  sinceRelease: "M",
})
```

Shared stones map to several forms, and the form is picked by the line's variant data:

| Stone | Forms | How the form is chosen |
|---|---|---|
| Meowsticite | Mega Meowstic M / F | Gender. The bot stores none. Decision D-6: (a) player picks once at unlock, or (b) default M. Both forms are unlocked by one stone only if the owner approves. |
| Tatsugirinite | Curly / Droopy / Stretchy | Appearance, not stored. Decision D-7: player picks at unlock. |
| Magearnite | Mega Magearna / Original | Colour, not stored. Decision D-8: standard only, until Original Color exists. |

Not catalogued: no stone for Rayquaza (Dragon Ascent, D-9). The Primal orbs are out of scope.

## 3. The unlock transaction

`services/mega.js`, with `unlockMega({ trainerData, userId, line, stone, form?, requestId })`, runs inside `runInventoryTransaction`, `payloadKey = "mega:" + line + ":" + stone + ":" + (form ?? "")`.

`mutate(user)` is synchronous and all-or-nothing:

1. `MEGA_EVOLUTION_ENABLED` is on, and the form's activation status allows unlocking. Otherwise: "Mega Evolution isn't available yet."
2. `line` matches `^\d{1,4}:(normal|shiny)$` and `user.pokemon[id][variant] > 0`. Otherwise: "You don't own that Pokémon."
3. The base species' generation is live (`isGenerationLive`).
4. The stone's catalogue entry is `active` and maps to `species` (and to the variant-chosen form). Otherwise: "That stone doesn't work on <name>."
5. The form isn't already unlocked on that line. Otherwise refuse with **no consumption**: "Already unlocked."
6. `consumeItems(user, { [stone]: 1 })`. If that fails, refuse (nothing changed).
7. Write `megaUnlocks[line].forms[form] = { at, stone, req: requestId }` and append to `megaLog` (capped at 50).
8. Return `{ ok: true, line, form }`. Achievement progress is tracked (`trackProgress(user, [{ type: "mega_unlock" }])`).

Steps 6 and 7 happen in the same synchronous block, inside the user lock, and land in the same whole-map snapshot. A stone is therefore never consumed without the unlock, and vice versa.

| Risk | Protection |
|---|---|
| Double click / Discord retry | Same `requestId` → replay returns the first result, never re-runs the mutation (existing `findRequest`) |
| Two concurrent requests with different ids | `lockUser` serialises them. The second sees "Already unlocked" and consumes nothing |
| Stone consumed but unlock lost | Impossible: one mutation, one snapshot. A failed save is retried by the A2 queue, never rolled back |
| Process dies before the save | Neither change is on disk. The player still has the stone, and can retry |
| Same id, different payload | Refused ("request id already used for a different action") |
| Unlock on a line the player lost meanwhile | Re-checked under the lock (step 2) |
| Dashboard-only client tampering | Only `megaUnlocks` writes go through `unlockMega`. `/api/updateUser` keeps its strict whitelist, and a test asserts it ignores `megaUnlocks` |

## 4. Duplicates, limits, refunds, invalid use

- **Duplicates:** extra stones stay in the bag (max 99). They're still useful: the shiny line needs its own stone. Proposed (decision D-12, see the economy doc): 1 duplicate can be exchanged for **Mega Shards** (5), with 25 shards buying any *regular* stone.
- **Inventory limit:** 99 per stone. A grant over the limit refuses (existing `grantItem`), and reward code converts the overflow to shards rather than losing it.
- **Refunds:** none for a completed unlock (it's permanent and never consumed). An admin can regrant a stone through `/addinventory`, which logs the change.
- **Invalid use:** every refusal happens before step 6, so nothing is consumed.
- **Selecting a preferred form:** the team slot (`mega` field) is the selection. There's no separate "preferred" field to drift out of sync (owner direction).

## 5. Persistence and backups

- **Storage:** `user.megaUnlocks`, `user.megaLog` and `user.items.megastone_*` are ordinary fields in the player record, so they are covered by the existing snapshot chain: local atomic write → `local-prev` → Discord backup, with seq, epoch and sha256.
- **Restart:** loaded as-is. Readers default a missing or malformed `megaUnlocks` to `{}`. `normalizeMegaUnlocks(user)` (called from `validateUserSchema`, idempotent) quarantines malformed entries into `user.megaLegacy`, the same pattern as `itemsLegacy`. It never deletes silently.
- **Generations:** nothing in `config/generations.js` or `speciesCatalog.js` reads or clears `megaUnlocks`.
- **Old backups:** a pre-Mega backup has no `megaUnlocks`. Restoring it is valid but loses unlocks made since. **Never** restore a backup over live data to undo Mega. Use the feature flag instead (`MEGA-TEST-AND-ROLLBACK-PLAN.md`).

## 6. Migration

No transform of existing data is needed. The feature only adds keys.

| Requirement | How it's met |
|---|---|
| Existing records stay valid | No existing field changes type or meaning |
| Missing Mega fields default safely | `megaUnlocks ?? {}`, `items[x] ?? 0`, `slot.mega` absent = base |
| Pokémon ids unchanged | Species keys and training keys untouched. Megas have no dex numbers |
| Shiny status and Levels preserved | Unlock keyed by `id:variant`. EXP stays on the base training key |
| Trades and gifts | `/gift` moves counts only, and never the last copy; the unlock stays on the sender's line (policy in the architecture audit, §3.4) |
| Concurrency, idempotency, no partial unlock | §3 |
| Old backups restorable | Yes. They simply lack the new fields |

A **one-time retro grant** is not needed (nobody can have Mega progress before launch).
