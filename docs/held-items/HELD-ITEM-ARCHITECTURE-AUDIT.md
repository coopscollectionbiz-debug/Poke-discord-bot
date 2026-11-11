# Held Items: Architecture Audit and Design

**Status:** audit and design only. No production code, player data, commits or deploys.
**Code audited:** `origin/master` at `8c7cc5cb` (PR #69, which includes PR #67 Teams/Battle team and ranked battles), in worktree `E:\Poke-discord-bot-held-items` on branch `audit/held-items`.
**Player data:** the read-only production copy from 2026-11-10 16:17 UTC (seq 2328, 2,884 records), stored in the restricted folder. It was read in memory only. Every output is an aggregate.

> **Repository note.** The brief names `E:\Poke-discord-bot`. That clone has the old history from before the 2026-11-09 rewrite: it is on branch `durable-storage` at a commit from before Release B, and its push is disabled. It does not contain the inventory, battles, Teams page or Mega code. Everything here was checked against current `master` in a fresh worktree instead.

Companion documents:

| Doc | Content |
|---|---|
| [HELD-ITEM-CHAMPIONS-CATALOG.csv](HELD-ITEM-CHAMPIONS-CATALOG.csv) | 67 rows: Champions status, mainline effect, engine class, recommendation, price |
| [HELD-ITEM-COMPATIBILITY-MATRIX.csv](HELD-ITEM-COMPATIBILITY-MATRIX.csv) | Hooks and mechanics each item needs |
| [HELD-ITEM-BATTLE-BALANCE.md](HELD-ITEM-BATTLE-BALANCE.md) | About 270,000 simulated battles on the real formulas and real rosters |
| [HELD-ITEM-ECONOMY-ANALYSIS.md](HELD-ITEM-ECONOMY-ANALYSIS.md) | Prices and acquisition |
| [HELD-ITEM-DASHBOARD-UX.md](HELD-ITEM-DASHBOARD-UX.md) | Teams page equipment UX and API |
| [HELD-ITEM-DATA-MIGRATION.md](HELD-ITEM-DATA-MIGRATION.md) | Schema, migration and rollback |
| [HELD-ITEM-IMPLEMENTATION-ROADMAP.md](HELD-ITEM-IMPLEMENTATION-ROADMAP.md) | Phases, gates, deployment, and the final recommendation |

---

## 1. Existing systems (verified in code)

### 1.1 Pokémon ownership: counts, not instances

| Fact | Where |
|---|---|
| `user.pokemon = { [speciesId]: { normal: n, shiny: m } }`. Copies are **counts**. There are no instance ids, nicknames, IVs, EVs, natures or abilities. | `utils/userSchema.js`, `services/battleTeam.js` |
| A "copy" that battles is a **line** `species:variant` (e.g. `"6:normal"`). All copies of a line share one Level (`user.training["6:normal"]`). | `utils/training.js` |
| Per-line state already exists for Levels (`training`), Mega unlocks (`megaUnlocks`) and chosen moves (`movesets.{display,battle}`). | `training.js`, `services/megaUnlocks.js`, `services/movesets.js` |
| Losing the last copy of a line runs **one** choke point, `resetLevelIfGone(user, id, variant)`. It has 5 call sites: donate, bulk donate, evolve, convert-to-shiny, and the admin `/gift`. | `bot_final.js:2247`, `utils/bulkDonate.js:115`, `services/gameplay.js:228,291`, `commands/gift.js:40` |
| Copies on **either** team can't be donated, evolved or converted (`isOnAnyTeam`). The admin `/gift` has **no** team check. | `services/gameplay.js:208,277`, `bot_final.js` donate, `commands/gift.js:28` |

**Consequence.** A held item can only be bound to a **line**. That is the same granularity the game uses for Levels, Megas and moves. Duplicate copies of a line can't be told apart and never battle separately.

### 1.2 Unified inventory (Release B): ready for reservations

- `user.items = { [catalogId]: integer ≥ 0 }`. `services/inventory.js` is the only writer. Its pure functions are all-or-nothing, and `runInventoryTransaction()` runs **lock → replay check → mutate → saveAndAck**. Replay protection comes from the request id: `itemRequests` keeps a durable flag and a 24 h TTL.
- `catalog/items.js` defines a `held` category and an `equip: { slot: "pokemon" }` field. **`charcoal` already exists** as a `defined` held item. Ids are stable and are never reused.
- `grantItem` refuses items with status `defined`. `normalizeInventory` keeps unknown ids that have valid counts, which matters for rollback (§9 of the migration doc).
- Gap: **`consumeItems` has no notion of reserved quantity.** A future sell, gift or admin removal could take away an item that is equipped. §3.4 adds the guard.

Production inventory today (snapshot): only `evolution_stone` (918 in total, 103 holders, median 5) and `shiny_dust` (1,578, 59 holders). **No record has any held item, equipment field or unknown Pokémon/slot field** (all 2,884 scanned). There is nothing legacy to migrate.

### 1.3 Battle engine

| Fact | Where |
|---|---|
| 6v6 singles, **fully automatic**. Team order is the send-out order, and there is **no switching**. The AI picks the move with the best expected damage, or a random move 10% of the time. | `utils/battle/sim.js` |
| Gen 5 stats (IV 15, no EVs or natures) and the Gen 5 damage formula. Crits are 1/12 at ×2, and high-crit moves 1/8. The damage roll is 0.80–1.00. Turn cap is 300. | `stats.js`, `tuning.js` |
| **All 460 moves deal damage.** There are no status moves. 223 moves carry a `contact` flag. | `battleData.json`, `data/battle/move-flags.json` |
| There are two loops. The **legacy loop** has no abilities, status or stat stages. The **effect-aware engine** (`effects.js`, from Mega M2) adds ability hooks, stat stages, weather, terrain, burn, entry effects and end-of-turn effects. Today it is used only when a battler has an ability. | `sim.js:simulateBattle`, `effects.js` |
| **I verified that the effect engine equals the legacy loop when no battler has an ability:** 0 differences in 3,000 random Lv 50 battles (`analysis/held-items/fxParity.mjs`). | new check |
| Modes: **casual** uses the Display team at real Levels, with the underdog surge, unrated. **Ranked** and **wager** use the Battle team at Lv 50, at most 1 mythic, Elo, no surge. | `runBattle.js` |
| A battle is **built and resolved synchronously** inside `withBothLocks` (both players' locks, in a fixed order). Playback only renders the finished result. | `runBattle.js:467,553` |
| A ranked team's Power uses Lv 50 stats. Power drives the casual surge. | `power.js` |

**Trainer "tier bonuses" don't touch battles.** The rank comes from TP and changes catch odds and shiny odds only. A trainer sprite's tier only sets its price and card backdrop. No battle code reads either one. This is verified in `utils/battle/*` and matches `TIER-BONUS-BALANCE.md` in the economy audit. "Tier" therefore matters for items only as *Pokémon species tier* (BST) and *player wealth*, and the balance doc tests both.

### 1.4 Dashboard

- Auth: a 10-minute token from `/dashboard`, stored in the `dashboard_session` httpOnly cookie. `requireDashboardSession(req, id)` checks that the token belongs to that id and has the type `dashboard`.
- The Teams page (`public/teams/`, PR #67, Option B) has a Display/Battle switcher and a box (a sheet on phones). Teams are edited as a **draft** and saved through `POST /api/set-pokemon-team`. **Moves are saved immediately** through a dialog (`teams/moves.js` → `POST /api/pokemon/moveset`). The dialog is the pattern to reuse.
- `GET /api/user-pokemon` returns `items` (raw counts), `pokemon`, both teams, levels and powers.
- Gaps: the team and moveset POSTs take the user lock but have **no stale-state token** (last write wins) and no request id. The dashboard has no rate limiting.

### 1.5 Economy, shop, rewards

The dashboard shop sells Poké/Great/Ultra Balls (1,000/2,000/4,000 CC), Evolution Stones (5,000) and trainer sprites (2,500–150,000). `/daily` pays 1,000 CC. Donations are the main source of CC. `/quest`, `/recruit`, `/shop` and `/gift` are admin-only. Achievement rewards are points only (CC and item rewards are not approved). The figures are in the economy doc.

### 1.6 Trading

**There is no player-to-player trading.** The catalog marks every item `tradable: false`, with the note "trading is Pokémon-only, and not built yet". The only transfer of a Pokémon is the **admin-only `/gift`**, which moves normal copies with no team check. The design covers `/gift` now and defines the rule for future trading (§3.6).

### 1.7 Persistence and safety nets

A single Fly machine with the volume at `/data`. `saveAndAck` gives a durable acknowledgement, and snapshots carry a writer epoch with fencing. Daily snapshots and Discord backups exist. The test runner is `npm run test:safe`. Regression gates already in place: the 3,000-battle no-Mega corpus (`tests/fixtures/battle-corpus-pre-m2.json`) and `megaSafety` / `megaPresentation`.

### 1.8 Reusable vs. risky

| Reuse | Risk to manage |
|---|---|
| `runInventoryTransaction`: lock, replay, durable acknowledgement | `consumeItems` doesn't know about reservations |
| Catalog `held` category, `equip.slot`, the `charcoal` id | No item icons exist for held items (an asset task) |
| The `resetLevelIfGone` choke point for "the last copy is gone" | `/gift` ignores teams. Equipment must not depend on team protection. |
| The effect engine's hook architecture, its notes, and its proven parity | Items would send most battles to the effect engine (a performance check is needed) |
| The ability registry pattern (`abilities.js`) | The legacy AI's random-move draw has to be skipped under a Choice lock without disturbing RNG order for battles with no items |
| The moves dialog on the Teams page | Team and moveset writes have no stale-state token |
| The Mega flag/capability pattern (`config/features.js`) | There is no tester allowlist. Mega launched "invisible to all" with no staged audience. |

---

## 2. Ownership model: stack plus reservations (recommended) vs. item instances

| | **A. Stackable counts plus equipment reservations** (recommended) | B. Individually identified item instances |
|---|---|---|
| Storage | `items.leftovers = 2` (unchanged) plus `heldItems["6:normal"] = "leftovers"` | `itemInstances = [{ uid, itemId }]` plus `heldItems[line] = uid` |
| Fits the current inventory | **Exactly**: there is no schema change to `items` | Needs a second inventory model next to `items`, plus conversion |
| Fits the Pokémon model | Lines are counts too. Instances would bind to a non-instance anyway. | Adds instance precision the Pokémon side can't use |
| Duplicate creation | **Impossible by construction**: equipping never changes a count. "Available" = owned − equipped. | Each mint must be guarded, and an instance can be duplicated on restore or merge |
| Unequip | Delete one key. Nothing is credited back, so nothing can be credited twice. | Move an instance back, which needs a two-sided update |
| Line lost (donate/gift) | Delete the binding. The item stays counted in `items`. | Same, plus instance bookkeeping |
| Rollback to the previous release | The old code ignores `heldItems` and keeps the new ids in `items` (unknown ids are kept) | Old code would not understand `itemInstances`, so the items would be invisible |
| Future trading of items | Tradable = owned − equipped (a reservation check) | Natural, but not needed |
| Per-copy wear or durability | Not supported (not wanted) | Supported |

**Recommendation: A.** It reuses Release B without changes to `items`, it can't mint items, and it rolls back cleanly. The single invariant that must always hold is:

> **I-1** For every item id: `#bindings(itemId) ≤ getQuantity(user, itemId)`.
> **I-2** Every binding's line is owned: `pokemon[id][variant] > 0`.
> **I-3** Every binding's item is a catalog entry with `category: "held"`, `equip.slot: "pokemon"`, and is active.
> **I-4** At most one item per line (enforced by the map shape).

Every write path checks I-1 to I-4. The normalizer repairs violations on load deterministically (§3.5). Repair only ever **removes** bindings, never items.

---

## 3. Data-driven design

### 3.1 Schema (additive)

```js
user.heldItems = { "6:normal": "leftovers", "445:shiny": "choice_scarf" }; // line → item id; absent = none
user.heldItemsRev = 17;  // integer, +1 on every equipment change (stale-state token)
```

- `heldItems` missing means "nothing equipped". The normalizer **never creates** it (the same rule as `battleTeam` and `megaUnlocks`).
- **Line-level, shared by both teams (decision D-H1).** An item is physical: a Pokémon line holding Leftovers holds it on the Display team and on the Battle team. That is what "one physical copy on one Pokémon" means. Movesets are per team, but moves are knowledge, not objects. The alternative is per-team loadouts (`heldItems.display/battle`). It is more flexible, but it either needs two physical copies for one Pokémon or breaks the physical model, and it doubles the UI. **Recommended: per line.**
- Items may be equipped on **any owned line**, not only team members. Players can then prepare without a team edit, and it removes all coupling to team saves.

### 3.2 Catalog entries (data, not code)

Each held item is an ordinary `catalog/items.js` entry with `category: "held"`, `equip: { slot: "pokemon" }`, a `heldGroup` (offense / defense / recovery / speed / utility / type / species, used for the selector filters), an optional `restrictTo: { species: [...] } | { types: [...] }`, a `battle: { effectId, text }` description for the UI, and `status: "defined"` until launch. The **battle behaviour lives only in the item registry** (§5), keyed by the same id. The catalog never contains code.

### 3.3 Service: `services/heldItems.js` (pure, sync, all-or-nothing)

| Function | Rule |
|---|---|
| `heldItemOf(user, line)` | Read |
| `equippedCount(user, itemId)` / `availableCount` | `owned − equipped` |
| `validateEquip(user, line, itemId, { takeFrom })` | Line owned (I-2). Item active and held (I-3). Species/type restriction. Available ≥ 1, counting the copy freed if the line already holds the same id, or a copy taken from `takeFrom` in the same transaction. |
| `equip(user, line, itemId, { takeFrom })` | Replace and transfer happen in **one** mutation. The old item on `line` returns to available implicitly. `takeFrom`'s binding is removed. `heldItemsRev++`. |
| `unequip(user, line)` | Delete the key, `heldItemsRev++` |
| `releaseLine(user, line, { carryTo })` | Runs at the `resetLevelIfGone` sites. If the line's last copy is gone, its binding is removed, or **carried** to `carryTo` (evolve, convert-to-shiny) when that line holds nothing and the item fits it. Otherwise the item stays in the bag. Returns a note for the response ("Leftovers went back to your bag"). |
| `normalizeHeldItems(user)` | Repair on load (§3.5) |
| `itemClauseConflicts(user, team)` | Items held more than once by members of a team (§4.3) |

### 3.4 Inventory guard

`consumeItems(user, costs)` gains a reservation check: it refuses when `have − q < equippedCount(id)`, with the message "Unequip it first". This protects every future sink (selling, recipes, admin removal) in one place. `grantItem` is unchanged.

### 3.5 Normalizer (idempotent, never deletes items)

Runs inside `validateUserSchema`, after `normalizeInventory` and before team normalization:

1. If `heldItems` is not a plain object: record it in `user.heldItemsLegacy` and delete it.
2. Drop bindings that are malformed (bad line key, non-string value, dangerous key).
3. Drop bindings to unknown or non-held ids, recorded in `heldItemsLegacy`.
4. Drop bindings whose line isn't owned (I-2).
5. For each id with more bindings than owned (I-1): keep the bindings on team members first (Battle team, then Display, in slot order), then the rest in ascending line key order. Drop the excess and record it.
6. Coerce `heldItemsRev` to a safe integer ≥ 0.

Being deterministic means two machines, or a restore, converge on the same state. Because only bindings are removed, there is no risk of duplicating an item.

### 3.6 Ownership changes, including trading

| Event | Behaviour |
|---|---|
| Donate / bulk donate (non-team lines only) | `releaseLine`: the item returns to the bag, and the response says so |
| Evolve the last copy | Carry to the evolved line if that line holds nothing and the item fits it. Otherwise return to the bag. |
| Convert the last normal copy to shiny | Carry normal → shiny on the same rule |
| Admin `/gift` of the last copy | Release for the **sender**. Equipment **never** travels with a Pokémon. |
| Future trading (Release F) | The same rule: a traded line arrives with no item, and the sender's item returns to their bag. Items stay non-tradable unless approved. If they ever become tradable: tradable = owned − equipped. |
| Admin resetuser / reset-team | `resetuser` wipes the record, and `heldItems` goes with it. `reset-team` leaves equipment alone, because equipment is per line, not per team. |

### 3.7 Mega Evolution interaction (decision D-H5)

In mainline and Champions, a Mega holds its Mega Stone, so it **can't hold another item**. Coop *consumes* the stone to unlock the form instead. Options:

- **A (recommended):** a slot that battles as a Mega ignores its held item. The battle note says "Mega Stone occupies the item slot", and the Teams card shows the item greyed with "inactive while Mega". This is faithful to Champions and stops Mega stats (+100 BST) from also stacking a Choice item. It is fail-closed: if `resolveBattleMega` falls back to the base form, the item works.
- B: the item works on a Mega too. This is simpler but adds power to the strongest slot.

Megas are off in production today, so this decision only matters once Mega battles are switched on.

---

## 4. Rules

### 4.1 One item per Pokémon line

Enforced by the map shape (I-4).

### 4.2 Battle snapshot

Equipment is read **inside `buildTeam`**, under the battle's `withBothLocks`. Every equipment write takes the same user lock, so an equipment change can't interleave with a battle. The resolved item id is copied onto each member (`member.item`) and into the battle result (`sides[].members[].item`). Playback, cards and logs then show what actually battled, even if the player re-equips during the 24-second replay. In wagers, items are read at **accept** (battle start), not at offer time. The offer message promises no loadout.

### 4.3 Item Clause (decision D-H2)

The VGC/Champions convention, and the strongest balance lever measured (balance doc §3): **no two members of one team may hold the same item.** The 18 type boosters count as different items.

- On the **Battle team** (ranked/wager): enforced at team save and at equip time with a clear error. At battle time it fails closed: a duplicate after the first holder battles with no item, plus a warning log line.
- On the **Display team** (casual): recommended on as well, so there is one mental model. Casual items matter little (balance §6).

### 4.4 Consumable items

**Reusable by default.** Berries and Focus Sash work **once per battle** (`mon.itemUsed`). They are never removed from `user.items` and reset automatically, because each battle rebuilds battler state from the record. No persistent "consumed" state exists, so there is nothing to clean up after a crash.

### 4.5 Compatibility

The data comes from catalog `restrictTo`. Species items (Light Ball, Thick Club) are **refused** on other species. Eviolite on a fully evolved Pokémon, or Black Sludge on a non-Poison type, is **allowed with a warning** ("No effect on this Pokémon" / "Hurts non-Poison holders"), matching mainline, where you may hold anything.

---

## 5. Battle integration

### 5.1 Routing

Today `simulateBattle` sends a battle to `simulateBattleFx` when any battler has an ability. Proposed: **when any battler has an ability *or* an item.** Because the effect engine equals the legacy loop with no effects (§1.3), battles with no items and no abilities keep **byte-identical** results. The legacy loop stays the path for battles with no items, guarded by the existing corpus test.

### 5.2 Registry: `utils/battle/items.js` (mirrors `abilities.js`)

```js
export const ITEM_REGISTRY = Object.freeze({
  leftovers: { status: "implemented", source: SHOWDOWN,
    onResidual: (c) => c.fx.heal(c.self, 16, `${c.self.name} restored a little HP using its Leftovers!`) },
  choice_band: { status: "implemented", choiceLock: true, onModifyAtk: () => 1.5 },
  focus_sash: { status: "implemented", oncePerBattle: true,
    onTryKO: (c) => c.hpBefore === c.self.maxHp ? { surviveAt: 1, text: `${c.self.name} hung on using its Focus Sash!` } : null },
  // …
});
```

`fx.itemOf(mon)` returns null when the mon is a Mega under D-H5 A, when the item was used this battle, when the item's status isn't `implemented`, or when its `HELD_ITEMS_BATTLES` capability is off.

### 5.3 Hook points

| Event (brief) | Hook | Engine point | Items |
|---|---|---|---|
| Battle initialisation | `onStart` (once per mon at build) | `prepareBattler` | stat multipliers (Eviolite, Choice, species items) |
| Turn initialisation / entry | `onEntry` | `runEntries` | Air Balloon (announce) |
| Turn order | `onModifySpe`, `onFractionalPriority` | `speedOf`, `firstToMoveFx` | Choice Scarf, Quick Claw |
| Move choice | `onChooseMove` | `chooseMoveFx` | Choice lock |
| Before attack | `onBeforeMove` | `useMoveFx` start | (reserved) |
| Damage calculation | `onBasePower`, `onModifyAtk/SpA`, `onModifyDef/SpD`, `onFinalDamage`, `onSourceFinalDamage`, `onModifyCritRatio`, `onModifyAccuracy` | `prepareMove`, `oneHit`, `finalMult` | boosters, Bands, Expert Belt, Life Orb, resist berries, Scope Lens, lenses |
| Would-KO | `onTryKO` | per hit, before `hurt` | Focus Sash, Focus Band |
| After damage (target) | `onDamagingHit` / `onAfterHit` | after each hit | Sitrus/Oran, Rocky Helmet, Air Balloon pop |
| After move (attacker) | `onAfterMove` | after drain/recoil | Life Orb, Shell Bell |
| Status application | `onSetStatus` | `fx.setStatus` | Lum and status berries (later) |
| Healing | — | `fx.heal` (always clamps, never on a fainted mon) | — |
| Turn completion | `onResidual` | `runResidual` | Leftovers, Black Sludge |
| Fainting | — | `recordFaints` | (none at launch) |
| Battle completion | — | the result object | `members[].item` and `itemEvents` for the cards |

### 5.4 Ordering and stacking

- **Multipliers** follow Showdown order: ability before item within each stage. They are applied as 4096-based fractions (`Q(n)`) with the same rounding as mainline, inside the existing `Math.floor` chain.
- **Residual order:** weather chip → ability residuals → **item residuals** (faster battler first) → burn → durations. This is the Gen 5+ order (Leftovers before burn).
- **Stacking:** one item per mon, so items only stack with abilities. That is multiplicative and mainline-faithful (for example Huge Power × Choice Band). A `stackCap` field exists in the registry in case a combination needs a cap. None is proposed at launch.

### 5.5 Activation limits and loop safety

- `oncePerBattle` items set `itemUsed`. `fx.itemOf` then returns null, so they can't trigger again.
- Every hook fires at most once per (event, mon). Heals clamp to `maxHp − hp` and never revive. Recoil or Helmet damage clamps to the HP that is left.
- **No item triggers another trigger.** Heal hooks don't raise events, and damage from items (`fx.damage`) never calls `onDamagingHit`, so Rocky Helmet versus Rocky Helmet can't chain.
- Turn cap 300 bounds any heal-versus-chip stall. Measured: the turn cap is hit in ≤ 0.5% of battles under every configuration tested, and the worst case (Chansey, Blissey and Shuckle walls, all on Leftovers) averages 26.5 turns (balance §5).

### 5.6 AI awareness

`expectedDamageFx` already flows through `prepareMove`/`finalMult`, so item multipliers enter the AI's choice automatically. Under a Choice lock the AI **draws nothing**. It doesn't roll the 10% random move, so the RNG stream stays deterministic and identical across replays.

### 5.7 Determinism and testing requirements

- Same inputs and seed always give the same result. Item random draws (Quick Claw, Focus Band) happen **only when a holder is involved**, so battles with no items consume an identical RNG stream.
- Gates: the existing no-Mega corpus has 0 differences, plus a **new no-item corpus** (3,000 battles, ranked and casual) with 0 differences after the routing change. One unit test per item covers the exact numbers and the once-per-battle behaviour. Balance gates are in the roadmap.

### 5.8 Discord display (no new commands)

Item notes flow through the existing `ev.notes`/`preNotes`/`endNotes` into battle playback (as abilities do). `/showbattlecard` and `/showteam` can show a small item icon per slot (display only, Phase H5). **No slash command equips or manages items.** `/inventory` lists held items with "Equipped on Charizard".

---

## 6. Integration risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Routing every item battle through `effects.js` changes performance | Medium | Measure turns per ms in the corpus run. The effect engine already runs Mega battles. Playback is the bottleneck (a 2 s/turn render), not the simulation. |
| R2 | An item is lost because a line was donated, gifted or evolved | High | Reservation model plus `releaseLine` at the `resetLevelIfGone` sites, with tests per site. The normalizer is a backstop. |
| R3 | Two dashboard tabs overwrite each other | Medium | `expectedRev` gives 409 Conflict, and the client reloads the state (UX doc §6) |
| R4 | A double click equips twice | Low | Request-id replay (Release B) |
| R5 | An equipped item is spent by some future sink | Medium | The `consumeItems` reservation guard (§3.4) |
| R6 | Rollback to v-prev | Low | v-prev ignores `heldItems` and keeps the new item ids in `items`. The CC spent is still recorded as spent, so players keep the items they paid for when the release is restored. |
| R7 | Balance outliers (Rocky Helmet, Life Orb) | Medium | Deferred until tuned (balance doc) |
| R8 | A Mega plus an item stacking | Medium | D-H5 A |
| R9 | Item Clause duplicates appearing through team edits | Low | Validated on both writes, and fail-closed at battle time |
| R10 | Admin `/gift` moves a team member | Pre-existing | Out of scope. Equipment is safe either way. Recommend a team check in `/gift` separately. |
