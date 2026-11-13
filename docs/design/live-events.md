# Live events — design (2026-11-12)

Admins schedule **Live events** from the admin dashboard: named periods that
change catches, EXP, earnings and battles for every player. Terms are in
`CONTEXT.md` (Live event, Event effect, Catch boost, Catch limit).

Status: built 2026-11-12 on branch `design/admin-events` (worktree
E:\Poke-discord-bot-events). The two answers that were provisional (Tier
boosts allowed; a greyed-out ball with no CC spent) were accepted when the
user said "Implement".

### Changes made while building
- Master now gives every Copy its own Level, so **duplicate-catch EXP no
  longer exists**: the EXP multiplier covers battle EXP only (Feed is a
  transfer, not earned EXP, and is never multiplied).
- **Challenge prizes** count as earned from play: their CC and Shiny Dust
  are multiplied, in the prize itself, so the preview matches the payout.
- The `/shop` slash command is an admin-only test PokéMart: no discount there.
- The weekly pack picks inside fixed Tiers; a Catch limit that leaves one of
  its Tiers empty is skipped for that slot only.
- The catch "card tag" is on the caption (" · 🎪 Kanto week"), not drawn
  into the image.
- The Trainer encounter card says "a win pays ×N" while Prize money is up.

## Locked decisions

### Naming
- Player and admin name: **Live event**. "Surge" stays the Underdog surge.
- The existing admin "Events" tab (event log, `events.ndjson`) is renamed
  **Activity log** in the UI. Its route `/api/admin/events` stays as is.

### Model
- A Live event = name, start, end (exact instants, stored UTC), one or more
  Event effects.
- Live events may overlap. Same-kind multipliers multiply together.
- **No caps.** The admin sets any positive multiplier. Only physical bounds
  apply: a chance is clamped to 100 %, a discount can't make a price
  negative, and a multiplier must be a finite number > 0.
- An effect counts if it is running at the moment of the roll or grant
  (a battle that ends after Double EXP ends gets normal EXP).

### Effects (all four groups in v1)
| Group | Effect | Applies to |
|---|---|---|
| Catch | Catch boost: types, Regions, Tiers, species × N | every random roll (below) |
| Catch | Catch limit: only types / Regions / species | every random roll |
| Catch | Shiny chance × N | every shiny roll, paid ones included, whatever the toggle |
| Catch | Chat catch rate × N | the chat catch chance after pity (clamped at 100 %) |
| EXP | EXP × N, optionally only for chosen types (type of the Pokémon gaining EXP) | EXP from every kind of battle (`applyGains`, utils/battle/runBattle.js) |
| Economy | TP × N | chat TP |
| Economy | CC × N | chat CC, `/daily` CC, quest CC, Donation CC, Challenge prize CC. Never Wager pots, refunds, Grants or gifts (Prize money has its own multiplier) |
| Economy | Shiny Dust × N | Donation dust (the weekly cap counts dust before the multiplier), Challenge prize dust |
| Economy | Shop discount % | admin-picked categories: Poké Balls, Evolution Stones, TMs, held items, trainer sprites, `/recruit` (Mega Shards once PR #74 lands). Overlapping discounts multiply the remaining price |
| Battles | Trainer encounter rate × N | the encounter roll after a missed catch (clamped at 100 %) |
| Battles | Prize money × N | winnings only, never what a loser pays |
| Battles | Extra Battle cap +N | daily total only, not the per-Defender limit |

### Catch rules
- **Random rolls**: chat catch, `/daily`, Poké Balls (dashboard + `/shop`),
  `/recruit`, quests, weekly pack — every caller of
  `selectRandomPokemonForUser` (utils/weightedRandom.js). Grants, gifts and
  evolutions are never affected.
- **Boost math**: a type, Region or species boost keeps each Tier's total
  share as it is today and only reweights species inside the Tier. A Tier
  boost does change Tier odds **(provisional: allowed, no cap)**.
- **Overlapping limits**: a species must pass every running Catch limit.
  The dashboard refuses to save any event whose limits, overlapping any
  others, leave a plain Poké Ball nothing to roll, so free rolls can never
  come up empty.
- **Paid rolls** (Poké Balls, `/recruit`): the player chooses "Use Live
  event". Off means the normal pool and odds. It is Off by default,
  remembered per player, and **resets to Off whenever a new Catch boost or
  Catch limit starts**. With it On, a ball with nothing left to give is
  greyed out and no CC is spent **(provisional)**.

### Admin lifecycle
- Scheduled: edit or delete. Running: edit (applies from the next roll or
  grant) or End now. Ended: read-only history.
- Every create, edit, end and delete is an **Admin change** in
  `admin-audit.ndjson`, with a reason. Writes need the Discord admin
  session, as all dashboard writes do.

### Player-facing
- The bot posts in one announcement channel (a dashboard setting) when an
  event starts and when it ends: its effects and end time as a Discord
  timestamp. If the bot was offline at the boundary, it posts on boot,
  once.
- `/events` lists what is running and what is coming up.
- A catch card shows a small event tag when a Catch boost or limit shaped
  that roll.

### Dashboard tab "Live events"
- A list: Running / Scheduled / Ended.
- An editor: name, start and end (in the admin's time zone), and
  add-effect rows.
- **Odds preview**, the safety net now that there are no caps: for a Poké
  Ball roll during the event, each Tier's %, species left, and the most
  boosted species, against normal. Computed from the live pool.

### Persistence
- `live-events.json` in `TRAINERDATA_DIR`, written with the existing
  atomic write. Single writer (the VPS bot), consistent with
  [no SQL retool]. Includes the "announced start/end" flags for the
  posts on boot. The paid-roll choice is `liveEventOptInAt` on the player
  record: it counts only if it is newer than the latest-started running
  Catch boost or limit, which is how it "resets" with no job.

## Code map
- Rules (pure): `utils/liveEventRules.js`. Words: `utils/liveEventText.js`.
- Store + admin operations + paid choice: `services/liveEvents.js`.
- Player view, `/events`, posts: `services/liveEventsPlayer.js`, `commands/events.js`.
- Admin API: `routes/liveEventsAdmin.js` (mounted by routes/admindashboard.js).
- Admin page: "Live events" in `public/admindashboard/script.js`.
- Player pages: `public/shared/liveEvents.js` (shop banner, prices, the
  choice; trainer picker prices).
- Hooks: `utils/weightedRandom.js` (boosts, limits, paid rolls),
  `shinyOdds.js`, `bot_final.js` (chat catch chance, stone and trainer
  prices, routes, posts), `utils/passiveChat.js` (chat TP/CC),
  `commands/daily.js`, `commands/quest.js`, `commands/recruit.js`,
  `services/gameplay.js` (balls, weekly pack), `utils/bulkDonate.js`,
  `utils/challenge/runChallenge.js`, `utils/battle/runBattle.js` (EXP),
  `utils/battle/rewards.js` (Battle cap), `utils/encounter/*` (chance,
  Prize money), `services/tmShop.js`, `services/heldItemsApi.js`,
  `services/auras.js`.
- Tests: `tests/liveEvents.test.js`. Odds: `tools/live-event-odds.mjs`.

## Measured
- **Tier odds under a Catch limit.** A limit changes how many species each
  Tier holds, so Tier shares shift. "Kanto only", Poké Ball, Novice, Gens
  1–5 live: legendary 0.43 % → 0.27 %, mythic 0.08 % → 0.03 %, common
  54.07 % → 63.84 % (649 → 151 species). Source: `node
  tools/live-event-odds.mjs '[{"kind":"catchLimit","match":{"regions":["Kanto"]}}]'`
  on 2026-11-12. The dashboard preview shows the same table for any event.

## Open checks
- **Hook coverage.** Every CC/TP/Dust/EXP grant site named above needs the
  multiplier, and no other site should get it. Check with a test that greps
  the grant sites, like the existing `resetLevelIfGone` guard test.

## Sources for numbers quoted
- Tier weights 52 / 34 / 8 / 4 / 1.5 / 0.5: `POKEMON_RARITY_WEIGHTS`,
  utils/weightedRandom.js.
- Chat catch 1 % base, +0.3 % pity per message, 5 % max: constants in
  `tryGiveRandomReward`, bot_final.js (~line 1070).
