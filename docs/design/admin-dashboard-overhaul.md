# Admin dashboard overhaul

Decisions locked in the 2026-11-11 design session. Branch `feature/admin-dashboard-overhaul`, cut from master `bc384b53`. Terms (**Admin change**, **Grant**, **Last active**) are defined in `CONTEXT.md`.

## Scope

Admins can make these **Admin changes** to a player from the dashboard:

- Add or remove CC and TP.
- Add or remove items. Only catalog items with `storage: "inventory"` are listed, because `instant` and `purchase_flag` items never sit in `user.items` (`catalog/items.js`).
- Add or remove Pokémon copies, normal or shiny.
- Add or remove trainers.
- Set the **Level** of an owned species + **Variant**.
- Reset cooldowns: daily (`lastDaily`, streak kept), weekly pack (`weeklyPackClaimed`), quest (`lastQuest`), recruit (`lastRecruit`), and the **Battle cap** (`user.battle.started` and `user.battle.vs`, `utils/battle/rewards.js:43`).
- Reset player: a full wipe back to a new player.

Out of scope: editing Teams, Battle team or **Battle rating**; deleting a player; telling the player about a change.

## Permissions and sessions

- Only a Discord-linked admin session (the Developer role, via `/admindashboard`) can write. `ADMIN_DASH_TOKEN` stays read-only and is accepted only in the `x-admin-token` header, never in `?token=`.
- Write endpoints take POST with a JSON body and reject a request whose `Origin` header is another site. The `admin_session` cookie is already `SameSite: "Lax"` (`bot_final.js:467`).
- Sessions slide. Each admin API call moves expiry to 30 minutes later, but never past 4 hours after login. The link from `/admindashboard` still expires 10 minutes after it's issued if unused (`utils/dashboardAuth.js:44`).
- After expiry, any action shows "Session expired. Run /admindashboard in Discord for a new link." and changes nothing.

## How changes behave

- Counts change by an amount ("+500 CC", "-2 shiny Pidgey"), never by setting a total. Levels are the exception: the admin sets them directly.
- Removing more than the player has is rejected and nothing changes. The error gives the current amount ("They have 300 CC").
- Removing the last copy of a species + **Variant** resets its **Level** (`resetLevelIfGone`) and clears any Team or Battle team slot holding it. Removing the trainer the player has on display clears `displayedTrainer`.
- The first time a player is granted a species + **Variant**, it gets a rolled **Catch level** (`rollCatchLevel`). The review panel shows the roll and the admin can change it. Extra copies of one they already own add to the count only, with no duplicate EXP, the same as gifts.
- Pokémon from unreleased generations are hidden. A "Show unreleased (testing)" switch lists them with an Unreleased tag, and the review panel warns. Items have no testing switch: `grantItem` refuses any item that isn't `status: "active"` (`services/inventory.js:44`), the Mega items included, so only active inventory items are listed (Evolution Stone and Shiny Dust on master `bc384b53`).
- A TP change recomputes `rank` and calls `updateUserRole` after the save. If the role update fails (player left the server, role order), the TP change stands and the result shows "Role not updated" with the reason.
- Every change opens a review panel first, showing before → after and warnings (team slot cleared, Level reset, Rank change, unreleased content). One click on Confirm applies it.
- A reason is required for removals, Level changes, resets and bulk **Grants**. It is optional for single-player **Grants**.
- No undo. To fix a mistake, the admin makes the opposite change by hand.

## Reset player

- Puts the record back to `createNewUser`: CC, TP, rank, items, Pokémon, **Levels**, trainers, Teams, movesets, achievements, battle records, onboarding and cooldowns all go.
- To confirm, the admin types the player's name. A reason is required.
- The audit entry stores a full copy of the old record.
- The reset is refused while the player has a `pendingWager`, because their **Stake** is held out of their CC (`utils/battle/wager.js:16`). The error says when the offer lapses.
- Replaces `/resetuser`.

## Bulk grants

- Targets can be one player, players ticked in the Players table, or every player matching filters.
- Filters combine with AND: CC min/max, TP min/max, **Last active** within N days, onboarded only (on by default), owns or lacks a given Pokémon (+ **Variant**) or item.
- Bulk works for **Grants** and cooldown resets only. Removals, Level changes and resets are one player at a time.
- The preview lists the matching players. Confirm applies to exactly that list, even if someone's values changed in between.
- The confirm button names the change and the count ("Grant 500 CC to 42 players"). A reason is required and names the batch in the audit.
- Each player is granted under their own lock. If one player fails (for example a stack limit), the rest still get it and the result lists who was skipped and why. One save covers the whole batch.
- The batch has one request ID, so a retry or double-click never grants twice.
- Per-player limits still apply: 1,000,000 CC per grant (`MAX_CURRENCY_GRANT`, `services/assets.js:130`) and 1,000,000 items per operation (`MAX_QUANTITY_PER_OP`, `services/inventory.js:25`).

## Last active

- A new `lastActiveAt` field is set when a player earns TP from chat and when they use a slash command.
- Players without it fall back to their latest daily, quest, recruit or weekly pack claim, which is today's rule (`routes/admindashboard.js:96`).
- The Players table, the Overview active counts and the bulk filter all use it.

## Audit

- A separate NDJSON file on the Fly volume, never pruned and never committed. Each line has the admin's Discord ID and name, the time, player ID and name, the change, before and after values, the reason, and the batch ID for bulk grants.
- Shown on the player page (History tab) and in Admin changes (all players, filter by admin, player or batch).

## Slash commands

- Retired: `/addcurrency`, `/addinventory`, `/resetuser`, `/resertdaily`, `/resetweekly`.
- `/gift` is player-to-player and stays.

## Layout

- The left nav has Overview, Players, Grants, Admin changes and Event log. At phone width the nav becomes a top menu and the review panel becomes a bottom sheet.
- Overview has today's stats cards and Top 10 by TP.
- Players is the searchable, sortable table, with checkboxes and a "Grant to selected" button.
- The player page has a header (name, ID with copy, CC, TP, Rank, **Last active**) and tabs for Summary, Pokémon, Items, Trainers, Cooldowns and History.
  - The Pokémon tab lists owned species + **Variant** rows with count, **Level**, team slot, the −/+ controls and Set Lv, plus an "Add Pokémon" search across every species.
  - Items and Trainers work the same way.
- Grants holds the bulk form: target, change, preview, reason, confirm.
- UI copy follows the unslop rules: no decorative emoji in headings, no text that repeats what the screen shows, sentence-case labels.

## Build order

1. Server: an admin change service (pure functions over a user record, one per change type, returning before/after and warnings), sliding sessions, `lastActiveAt`, the audit file, and write routes that reuse `runInventoryTransaction`'s lock-and-save pattern.
2. Unit tests for every change type, the over-remove rejection, last-copy team clearing, bulk partial failure and replay, and reset with a pending wager.
3. Front end: the new layout and each tab.
4. Retire the five slash commands.
5. Manual test plan below, on a local bot with a copy of test data, never production data in the repo.

## Build notes

- Code: `services/adminChanges.js` (pure change rules), `services/adminApi.js` (locks, saves, replay protection, audit), `utils/adminAudit.js`, `routes/admindashboard.js`, `public/admindashboard/`. Tests: `tests/adminDashboard.test.js`.
- Rank shown on the dashboard is computed from TP, not the stored `rank` field, which only updates on the next role sync.
- Rank-role sync uses the bot's `GUILD_ID` server (`syncRankRole` in `bot_final.js`).
- `lastActiveAt` from chat is set before the existing `enqueueSave` in `utils/passiveChat.js`. From slash commands it is set in the dispatcher and saved with whatever that command or the next action saves; a command that saves nothing can lose it on a restart.
- The admin router is mounted before the player `/api` readiness guard, so write routes check the same conditions themselves (`writeBlocked`).
- Local preview with synthetic players: `node tools/admin-dashboard-dev.mjs`, then open `/dev/login`.
- Retired commands disappear from Discord at the next command registration (`REGISTER_COMMANDS`), which replaces the guild's whole command list.

## Open checks

- **Audit file size.** Small, but unmeasured. Check: `ls -l` of `admin-audit.ndjson` on the volume after a month.

## Manual test plan

Run against a local bot with test players.

1. Run `/admindashboard` as a Developer and open the link. Overview loads. Wait 11 minutes without opening a second link, use the page, and it still works (sliding session). Run `/admindashboard` as a non-Developer and get the refusal.
2. Players: search by name, sort by CC, open a player. The header values match `/trainercard`.
3. CC: +500 and confirm. The header updates and History has the entry. Try −1,000,000. The review shows the rejection with the current balance and nothing changes.
4. TP: add enough to cross a Rank boundary. Rank updates and the player's Discord role changes. Remove it again and the role drops back.
5. Items: add 3 Rare Candy, remove 2 with a reason, then remove with an empty reason. Confirm stays disabled until a reason is entered.
6. Pokémon: add a species the player doesn't own. The review shows a rolled Level. Change it to 40, confirm, and the player's dashboard shows Lv 40. Add a second copy and the Level stays 40.
7. Pokémon on a Team: put shiny Pidgey on the player's Team, then remove the last shiny Pidgey. The review warns about the Team slot and the Level reset. Afterwards `/trainercard` no longer shows it.
8. Set Lv: set a Pokémon to Lv 75. `/inspectpokemon` shows Lv 75.
9. Trainers: remove the displayed trainer. The trainer card falls back with no error.
10. Cooldowns: claim `/daily`, reset Daily in the dashboard, and `/daily` works again with the streak kept. Reach the Battle cap, reset it, and `/battle` works.
11. Unreleased: search a Gen 9 Pokémon and it's missing. Turn on the testing switch and it appears tagged; the review warns.
12. Bulk to selected: tick 3 players, grant 100 CC, and all 3 get it, with one batch in Admin changes.
13. Bulk by filter: filter max CC 1,000 and active within 7 days. The preview count matches the table. Confirm, and the button text shows the count. Double-click Confirm and players get it once.
14. Bulk partial failure: include a player whose Rare Candy stack is near the limit. The result lists them as skipped and the others get it.
15. Reset player: start a wager offer as that player and try to reset. It's refused with the expiry time. After the offer lapses, type the name and confirm. The player is back to starter selection and the History entry has the old record.
16. Phone width (375 px): the nav is a top menu, the review is a bottom sheet, and nothing scrolls sideways except inside tables.
17. Retired commands: `/addcurrency` and the others no longer appear in Discord after command registration.
