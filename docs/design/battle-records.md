# Battle Records — design (locked 2026-11-12)

A dashboard page, modelled on op.gg match history, where a player sees and replays their own **Fight records** (see CONTEXT.md → Battle Records).

## What the code does today

- Battles keep only running totals per player: wins, losses, Ranked rating (`utils/battle/runBattle.js:196-235`).
- Battles and Challenges append one line to `events.ndjson` with the seed, players, winner and turn count, but no teams (`commands/battle.js:188`, `commands/challenge.js:192`). That file keeps 30 days (`utils/eventLog.js:65`, `RETENTION_MS`).
- Battles, Challenges and Trainer encounters all call `simulateBattle` (`runBattle.js:184`, `utils/challenge/runChallenge.js:87`, `utils/encounter/runEncounter.js:65`). Both engines return `{ winner, turns, endedBy, snapshots, knockouts, log }` (`utils/battle/sim.js:153-237`), and the effect engine adds `turnNotes` (`utils/battle/effects.js:432-501`). `knockouts` records the attacker's slot.
- **No backfill is possible:** the old event lines have no team snapshot, and replaying a seed against today's teams gives a different fight.

## Locked decisions

### Scope and terms
- A record is written for every finished Battle (Casual, Ranked, Wager), Challenge, and Trainer encounter.
- The page is titled **Battle Records**, and each entry is a **Fight record**. "Battle" still means PvP only.
- An Elite Four run is **one** record, replayed fight by fight with the Revive pick shown between fights.
- A record is written only when the fight ends. A run still in progress has none. A run the bot finishes on restart (`bot_final.js:2635`) is recorded with the fights that were played.
- Declined or expired Wager offers and declined Trainer encounters write no record.

### Data model
- A record holds: id, kind (`casual|ranked|wager|gym|e4|blue|red|encounter`), timestamp, Season (rated kinds), both sides' snapshots (player id or computer opponent key, display name, trainer sprite, and the 6 members as they were: species, Variant, Level fought at, moveset, held item, Mega), and the result (`winner`, `endedBy`, `turns`, `knockouts`, `log`, `snapshots`, `turnNotes` if present, surge). It also holds the outcome for the player: rating from→to, CC/stake/Prize money, EXP, and any Badge earned. An E4 record holds an ordered list of fights plus Revive picks.
- Names, sprites and teams are a **snapshot at fight time** and never change after renames, re-tiers or team edits.
- A Battle is stored **once** and indexed by both players' ids.

### Storage and retention
- A **separate append-only store** on the data volume next to `events.ndjson` (`/srv/pokebot/data`). It is not in trainerData and not in the Discord backups. If the disk is lost, history is lost but no game state is.
- Each player keeps the **newest 50 per kind group**: Battles (casual+ranked+wager), Challenges, Trainer encounters. A Battle record is deleted only when neither player still has it in their 50.
- Writing never blocks or breaks a fight. It runs after the result is saved and before the Discord replay, and on failure logs a warning (the same rule as `logEvent`).
- **Player deletion:** `forgetPlayer(id)` deletes their records and, in opponents' records, replaces their id and name with "Former trainer" (the team and turns stay). No deletion path exists today, so a `tools/` script runs it, and any future delete path calls the same function.

### Visibility
- Only the signed-in owner sees their records, through the existing `requireDashboardSession` check (`bot_final.js:1339`). There are no share links or public profiles. A Battle appears in both players' histories.

### UX
- A **new nav page**, Battle Records. Nothing changes on Overview or in Discord.
- **Filter tabs:** All · Battles · Challenges · Encounters.
- **Summary** (follows the selected tab, newest 20): W/L and a win-rate donut, plus the 3 most-used Pokémon with win rate and KOs/faints. The Ranked tab also shows current rating and the change over those 20.
- **Row** (op.gg style; blue for a win, red for a loss): kind, time ago, Victory/Defeat, rating change or CC result on the left. Your 6 sprites with KO counts, turns and KOs/faints in the middle. The opponent's name, trainer sprite and 6 sprites on the right. On phones the opponent's side moves under yours.
- **Expanded row:** each Pokémon's moves, held item, Level, KOs and damage dealt; rewards (EXP, Badge, CC); turn list.
- **Watch:** a full-screen viewer with play/pause, previous/next turn, 1×/2× speed and a turn scrubber, linked at `#fight=<id>`. Esc or back closes it.
- **Replay look:** drawn in the browser (HTML/CSS) with the same animated sprites and `public/shared/spriteFx.js`, HP bars, a move/damage caption, a faint animation and a simple VS intro. No Tier backdrops or trainer card effects. Costs no server CPU.
- **Empty state:** history starts empty on launch day, and the page says records begin with the next fight.

### Rollout
- **One release**, with recording and the page together. There is no feature flag in this plan, so history starts at deploy.

## Measured sizes

From `node tools/measure-fight-record.js 100`, run 2026-11-12 on 228 records built from real fights by `tools/fight-record-fixtures.mjs`. The players are synthetic, so team sizes and fight lengths in production will differ.

| Kind | Median | Max |
|---|---|---|
| Casual battle | 6.6 KB | 8.4 KB |
| Ranked battle | 7.4 KB | 8.7 KB |
| Wager battle | 7.7 KB | 8.0 KB |
| Gym Challenge | 4.4 KB | 6.1 KB |
| Elite Four run | 22.0 KB | 22.5 KB |
| Trainer encounter | 6.0 KB | 8.6 KB |

- One player at the cap (50 per group, medians): 898 KB.
- 100 players at the cap: 87.7 MB at most. Battles shared by two players are stored once, so the real figure is lower.
- Reading one player's 138 records: 40.3 ms. The list payload (lite, no turn log) is 415 KB; the full records would be 945 KB.

**Still open:** how many players actually fight, which sets the real file size. Count players with any `battle`, `casual`, `challenge` or `encounter` record in `/srv/pokebot/data/trainerData.json` on the VPS, then multiply by the per-player figure above.

## Full-sim records (v2 results)

Fights on the full sim (`FULL_SIM_ENABLED`) store a v2 `result`: today's fields (`winner`, `turns`, `endedBy`, `knockouts`, `log`, `snapshots`) plus `v: 2`, `steps` (per turn: move, hp, switch, status, faint, note), `endStatus`, and the raw Showdown log as `raw`, or `rawGz` (gzip, base64) once it's over 16 KB (`utils/fightRecordBuild.js`). Both replayers read the v1 fields, so v1 and v2 records replay through the same code; v2 narration rides in each hit's `preNotes` and `notes`. The records list (`liteRecord`) leaves the turn-by-turn fields out. Each player's side of a full-sim fight keeps `plan: { id, name }`, the Battle plan it played, and the page names it in the expanded row and the replay's first caption. A Battle's record is stored once, and the API removes the other side's Battle plan before it sends one (`forViewer`, `services/fightRecordsApi.js`).

From `FULL_SIM_ENABLED=1 node tools/measure-fight-record.js 100` (2026-11-12, synthetic players): medians casual 16.6 KB, ranked 18.6 KB, gym 8.3 KB, encounter 14.8 KB, wager 18.1 KB, Elite Four 50.1 KB; 100 players at the cap at most 205.3 MB; one player's list read in 19.2 ms with a 426 KB lite payload.

## Implementation notes

- Store: `utils/fightRecords.js`. The file is `fight-records.ndjson` in `TRAINERDATA_DIR`, with an in-memory index of byte offsets. Every read and write goes through one queue. A compaction runs once dead lines outnumber live ones (and there are at least 200).
- Builders: `utils/fightRecordBuild.js`. `recordFight()` never throws. An Elite Four outcome now carries `runTeam` (the frozen team), so the earlier fights can be re-run. The re-run is used only if it reaches the same last fight; otherwise those fights are marked `missing`.
- Hooks: `commands/battle.js` (casual, ranked, wager), `commands/challenge.js` (`logChallenge`: Gyms, Blue, Red, Elite Four, stale runs), `bot_final.js` (runs finished on restart), and `utils/encounter/service.js`.
- API: `services/fightRecordsApi.js`, mounted in `bot_final.js` at `/api/fight-records` and `/api/fight-records/:fightId`.
- Page: `public/battlerecords/` (`records.js` holds the pure logic, `script.js` the list, `replay.js` the viewer). It's in the nav as "Battle Records" ("Records" on phones).
- Tools: `tools/measure-fight-record.js`, `tools/forget-fight-player.js` (dry run unless `--yes`; stop the bot first), and `tools/dev/battle-records-preview.mjs` (local preview on port 5199 with real fights).
- Tests: `tests/fightRecords.test.js`, `tests/battleRecordsPage.test.js`.

## Manual test plan

1. Deploy to a test bot. Open the dashboard and check the nav has **Battle Records**, with the empty state on the page.
2. Run a Casual `/battle` against a second account. After the Discord replay, reload Battle Records: there's one row under All and Battles, coloured for the result, with your 6 sprites and theirs, and no rating change.
3. Sign in as the second account: the same fight shows from their side (they are the Defender; colour and result flipped).
4. Run a Ranked battle: the row shows rating from→to, and the Ranked summary shows current rating.
5. Offer a Wager and let it expire: no new row. Accept one: the row shows the CC won or lost.
6. Expand a row: moves, held items, Levels, KOs, damage and EXP match the Discord EXP card.
7. Click Watch: the viewer opens and the URL has `#fight=`. Play, pause, step forward and back, switch to 2×, and drag the scrubber. Every HP bar and faint matches the Discord replay of the same fight. Esc closes it, and the browser back button closes it too.
8. Reload with `#fight=<id>` in the URL: the viewer reopens on that fight.
9. Change your team, rename yourself on Discord, then rewatch the old fight: it still shows the old team and name.
10. Do a Gym Challenge, and win one for a Badge: the row shows the Badge, and the Challenges tab filters it.
11. Do an Elite Four run and lose at fight 3: there's one row, and the replay plays fights 1→3 with the Revive picks shown between them.
12. Accept a Trainer encounter: the row shows Prize money. Decline one: no row.
13. Restart the bot during an E4 run: after startup there's one row with the fights that were played.
14. Phone width (375 px): rows stack the opponent under you, nothing scrolls sideways, and the viewer controls are usable.
15. Open another player's id in the API URL with your session: you get 403.
16. Stop the bot, run `node tools/forget-fight-player.js <id> --yes` for the second account, then start the bot: their page is empty, and your shared fight shows "Former trainer" and still replays.
17. Fill one kind past 50 (use a script): the oldest drops, and a shared Battle stays for the player who still has it in their 50.
