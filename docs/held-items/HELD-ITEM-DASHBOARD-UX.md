# Held Items: Dashboard → Team Experience

The dashboard is the **only** place to manage equipment. No slash command equips, removes or lists equipment for editing. Discord only *shows* items: battle notes, `/showbattlecard` icons, and the `/inventory` "Equipped on …" text.

This builds on the Teams page that exists today (`public/teams/`, PR #67, Option B) and on the shared design system (`public/shared/tokens.css`, `components.css`, `shell.js`). It keeps that page's visual hierarchy: sprite stage → name → Level → types → tags → actions.

## 1. Audit of the current Teams page

| Element | Today | Held-item implication |
|---|---|---|
| Layout | Display/Battle switcher. The box is pinned beside the team on desktop and opens as a `<dialog>` sheet on phones. | Equipment fits **inside each slot card**. No new page. |
| Team editing | A **draft** with a save bar (add/remove/reorder, then Save) | Equipment is per line and shared by both teams, so it must **not** join the team draft. It saves immediately, like Moves. |
| Moves | `Moves` button → `teams/moves.js` dialog → immediate `POST /api/pokemon/moveset` | **The pattern to copy:** an `Item` button and an item dialog |
| Mega | A `Mega: X` toggle button per slot | The item chip sits next to it. When the slot is a Mega, the chip shows "Inactive while Mega" (D-H5 A). |
| Touch | Buttons only. Reordering has up/down buttons as well as drag. | The item flow uses taps only. Nothing depends on hover. |
| Rules strip | `Lv 50 · Mythic n/1 · Mega n/1 · Slots n/6` | Add **`Items n/6 · all different`** on the Battle team (Item Clause) |
| Stale state | None (last write wins) | Equipment adds `heldItemsRev` (§6) |

## 2. Team overview: the slot card

```
┌──────────────────────────────── slot 1 · Lead ─┐
│  ┌──────────────┐  Charizard                   │
│  │              │  Lv 50  (yours Lv 41)        │
│  │   sprite     │  [Fire] [Flying]             │
│  │          ┌──┐│  Lead · Mythic …             │
│  │          │🍖││  [ Moves ]  [ 🍖 Leftovers ▸ ]│
│  └──────────┴──┘┘                              │
└────────────────────────────────────────────────┘
   item badge: 28px circle, bottom-right of the sprite stage
```

- **Item badge** (28 px) sits at the bottom-right corner of the sprite stage, over the stage padding and never over the sprite. With no item it is a **dashed empty circle** with a `+`. The sprite stays fully visible, and the badge sits inside the stage's existing padding box.
- An **`Item` button** in the action row, next to `Moves`: `🍖 Leftovers ▸` or `＋ Add item`. On a phone the button text shortens to the icon plus the name, truncated with an ellipsis. The full name stays in `aria-label`.
- States, shown with text and icon, never color alone:
  - **Inactive while Mega**: chip greyed, with "Mega Stone occupies the item slot".
  - **No effect**: amber "⚠ No effect on Charizard" (Eviolite on a fully evolved Pokémon).
  - **Duplicate on this team** (Battle team, Item Clause): red "Also on Garchomp. Only the first battles with it." The strip shows `Items: 1 duplicate`.
- **Item details without navigating:** tapping the badge opens the same item dialog, scrolled to "Current item" with the exact effect. Nothing is hover-only. On desktop a `title` tooltip repeats the short effect as a convenience.
- The **box tiles** (the "Add from your box" list) show a 16 px item glyph on lines that hold an item, so players can see prepared Pokémon.

## 3. Pokémon equipment panel (the item dialog)

It opens from `Item` on a slot card (or from the Collection drawer, read-only with a link to Teams). Desktop: a centered dialog, 640 px wide. Phone: a **full-height sheet** with a sticky header and footer.

```
┌ Charizard's item ───────────────────────────── ✕ ┐
│ CURRENT                                          │
│ 🍖 Leftovers                        Recovery     │
│ Restores 1/16 of max HP at the end of each turn. │
│ Works every battle. Shared by Display + Battle.  │
│ [ Remove ]                                       │
├──────────────────────────────────────────────────┤
│ 🔍 Search items…                                  │
│ (All) (Offense) (Defense) (Recovery) (Speed &    │
│  utility) (Type) (Species)   ☐ Only what I own   │
├──────────────────────────────────────────────────┤
│ 🎯 Choice Scarf          Speed ×1.5, locked into │
│    Own 1 · 1 on Garchomp      [ Move here ]      │
│ 🥋 Choice Band           Attack ×1.5, locked …   │
│    Own 2 · 1 equipped         [ Equip ]          │
│ 🔥 Charcoal              Fire moves ×1.2         │
│    Own 1 · 0 equipped   ✓ Fire STAB [ Equip ]    │
│ 🪨 Eviolite              Def/SpD ×1.5 if it can  │
│    Own 1         ⚠ No effect on Charizard [Equip]│
│ 💡 Light Ball            Pikachu only            │
│    Own 1                 🔒 Can't hold  (disabled)│
│ 🛡 Focus Sash            Not owned · 5,000 CC     │
│                          [ Get in Shop ↗ ]       │
└──────────────────────────────────────────────────┘
```

Contents (required by the brief):
- **Current item:** icon, name, group, exact battle effect from the catalog's `battle.text`, the activation rule ("once per battle, resets after"), and a **Remove** button.
- **Available items from the bag:** each row shows **Own N · M equipped** and, when every copy is in use, **where** ("1 on Garchomp").
- **Actions:** **Equip** when a copy is free. **Replace** is implicit: equipping over a current item returns the old one to the bag, and the toast says so. **Move here** when every copy is on other lines: a confirm step names the source ("Move Choice Scarf from Garchomp to Charizard? Garchomp will hold nothing.") and the move is one atomic request. **Remove** unequips.
- **Compatibility:** species-locked items are disabled with "🔒 Pikachu only". Items with no effect are allowed with an amber warning. The Battle team's Item Clause conflict is a warning on the row ("Garchomp on your Battle team already holds this"). The server refuses it at Battle-team save time.
- **Feedback:** a toast ("Charizard is now holding Leftovers. Choice Band went back to your bag."), the slot badge updates in place, and focus returns to the `Item` button. A "saved with a delay" note reuses `saveAckFields`.
- **Not owned:** shown only with the "Only what I own" toggle off. A **Get in Shop** link deep-links to the shop's held-items section. Only owned, free copies are equippable.

## 4. Item selector: search, filters and sort

- **Search** matches name and effect text, case- and accent-insensitive.
- **Filter chips** from catalog `heldGroup`: Offense · Defense · Recovery · Speed & utility · Type · Species. Chips are single-select with "All". Type items get a type sub-chip row (the 18 types as colored `cc-type` chips). They default to the holder's types first, so "✓ Fire STAB" items sort to the top.
- **Sort** (default "Best for this Pokémon"): items that fit and are free first, then owned but in use, then no effect, then not owned. Within each group: STAB type match, then group, then name. Alternatives: A–Z, Recently used.
- **Empty state:** "You don't own any held items yet. Your first Battle team earns a free Basic item voucher." with a Shop button.

## 5. Mobile

- A full-height `<dialog>` sheet (the same component as the box sheet). The header is sticky with the Pokémon name and ✕, the search and chips are sticky, and the list scrolls.
- **Touch targets ≥ 44 × 44 px**. Row buttons sit on the right at thumb reach. The effect text wraps under the name, with no truncation of rules text.
- There is **no hover state** anywhere. Details are always visible, and tapping a row's icon expands a "More" section with the full description and activation rules.
- The confirm for "Move here" is an inline two-button row inside the list item (`Move` / `Cancel`), not a stacked modal.
- The slot card at 375 px keeps the sprite stage at its current size. The item button wraps under Moves in the action row when it's narrow.
- Reduced motion: the badge "equip" pop animation respects `prefers-reduced-motion`.

## 6. API (dashboard-only, server-authoritative)

| Endpoint | Purpose |
|---|---|
| `GET /api/held-items?id=` | `{ rev, items: [{ id, name, group, icon, battleText, rule, restrict, owned, equipped, available, holders: [line] }], equipment: { line: itemId }, flags }`. Display rows only, built from the catalog, never the raw record. |
| `POST /api/held-items/equip` | Body `{ id, pokeId, variant, itemId \| null, takeFrom?: { pokeId, variant }, expectedRev, requestId }`. `itemId: null` unequips. |
| `GET /api/user-pokemon` (existing) | Adds `heldItems` and `heldItemsRev` (read-only) so the Teams page renders badges in one load |
| `POST /api/set-pokemon-team` (existing) | Battle team: also refuses Item Clause duplicates (`code: "item_clause"`) |
| `POST /api/held-items/redeem-voucher` | `{ id, voucherId, itemId, requestId }`. Consumes the voucher and grants the item in one transaction. |
| `POST /api/shop/buy-held-item` | `{ id, itemId, requestId }`. Mirrors `buy-stone`: price from the catalog, `maxStack` check, `runInventoryTransaction`. |

Security and integrity, for every write:
1. **Authentication:** `requireDashboardSession(req, id)` gives 403, and the client shows the existing expiry banner.
2. **Body limits:** `express.json({ limit: "4kb" })`. Ids are checked against `ITEM_ID_PATTERN` and `REQUEST_ID_PATTERN`. Variant is normalized.
3. **Atomic:** `runInventoryTransaction` takes the user lock, replays the request id, runs a sync all-or-nothing mutate, then `saveAndAck`.
4. **Ownership:** the server re-checks the line's ownership (I-2), the item's existence and status (I-3), and availability (I-1) inside the lock. Client-sent counts are ignored.
5. **Duplicate assignment:** I-1 is re-checked under the lock. Two concurrent equips of the last copy serialize, and the second gets `409 { code: "unavailable", holders }`.
6. **Stale state:** `expectedRev ≠ user.heldItemsRev` gives `409 { code: "stale", rev, equipment }`. The client re-renders from the payload and tells the player "Your items changed in another tab. Here's the latest." A replayed request id returns the first result even if the rev has moved since, which is safe because it is idempotent.
7. **Inventory sync:** the response returns `{ rev, equipment, items: [changed rows] }`, so the page never re-derives counts locally.
8. **Feature flags:** `HELD_ITEMS_DASHBOARD` (view), `HELD_ITEMS_EQUIP`, `HELD_ITEMS_SHOP`, and `HELD_ITEMS_BATTLES` (effects). They follow the Mega capability pattern: when off, the routes return 404/403 with a friendly message, and the UI hides the controls.
9. **Rate:** the existing per-user lock serializes writes. A per-user limit of 30 equipment writes per minute is recommended (there is no dashboard rate limiter today).

Error copy reuses `showActionError`. A refusal shows the server's message verbatim (for example "Light Ball can only be held by Pikachu.").

## 7. Other surfaces

| Surface | Change |
|---|---|
| **Bag** (`/public/bag`) | Held items get their own category. Each row shows **Own N · Equipped on: Charizard, Garchomp**, with a "Manage on Teams" link. |
| **Shop** (`/public/dashboardshop`) | A "Held items" section with the same group chips, price tier badges and `maxStack` ("You have 2/2"). The buy confirm names the effect. Voucher redemption opens the same picker. |
| **Collection drawer** | Read-only "Holding: Leftovers" plus a link to Teams |
| **Overview** | Optional "Battle team items: 4/6 equipped" nudge |
| Discord `/showbattlecard`, `/showteam` | A small item icon per slot (display only, Phase H5) |
| Discord battle playback | Item notes ("Charizard restored a little HP using its Leftovers!") |
| Discord `/inventory` | Lists held items with "Equipped on …". No equip actions. |

## 8. Assets

There are no held-item icons in `public/sprites/items` today. Options: draw them in-house in the project's pixel style, or source them with the same licensing and credits process used for Pokémon sprites (`/credits`). This is an asset task in Phase H3, and the source needs owner approval.

## 9. Accessibility checklist

Every control is a `<button>` with an `aria-label` that names the Pokémon and the item. The dialog uses `aria-labelledby`, a focus trap and Escape (native `<dialog>`). States are expressed in text plus an icon. Contrast follows the `tokens.css` pairs. The list is a `role="list"`, and each row's action button includes the item name.
