# Coop's Collection — Discord Bot

Discord bot for a Pokémon collector game. Built on `discord.js` v14 with an Express server for the player web dashboard.

## About

A Discord-native Pokémon collector game. Players earn points and ranks for chatting in the channels, and may randomly catch a Pokémon along the way. A companion web dashboard lets them manage their collection and spend points on catching Pokémon or updating their trainer. Every catch is its own Copy with its own Level, and the Pokédex keeps every species and shiny a player has ever caught, even after their last Copy is gone (see [Collection and Pokédex](#collection-and-pokédex)).

Game terms (Tier, Stage, Variant, Copy, Collection, Pokédex, Team, Ranked rating, and so on) are defined in [`CONTEXT.md`](CONTEXT.md).

## Dashboard

`/dashboard` replies privately with a link to the Overview page. The link works for 10 minutes if it isn't opened. Once it's opened, the session lasts 30 minutes past the player's last action, up to 4 hours (`utils/dashboardAuth.js`). The admin dashboard's sessions work the same way. Every page shares one navigation bar (`public/shared/shell.js`), a sidebar on desktop and a tab bar on phones:

- **Overview** (`/public/overview`): the Showcase team on six pedestals, the Casual and Ranked teams, the ranked and casual records, rewards waiting to be claimed, and Pokédex completion per region. It changes nothing.
- **Collection** (`/public/picker-pokemon`): every Copy the player owns, one tile each, with the Browse, Evolve, Feed, Donate, and Convert modes. See [Collection and Pokédex](#collection-and-pokédex). Teams aren't built here.
- **Pokédex** (`/public/pokedex`): every species in the released regions, caught or not. It changes nothing.
- **Teams** (`/public/teams`): the Showcase, Casual, and Ranked teams, each Pokémon's moves and held item for the Casual and Ranked teams, and each Team's Battle plan when the full sim is on. See [Teams and moves](#teams-and-moves).
- **Battle Records** (`/public/battlerecords`): see [Battle Records](#battle-records).
- **Trainers** (`/public/picker`): the trainer sprites, which one the player displays, and an Auras tab (see [Auras](#auras)).
- **Bag** (`/public/bag`): the player's items, read-only, the same list `/inventory` shows privately in Discord, including held-item unlocks and TMs. Evolution Stones and Shiny Dust are spent in the Collection page's Evolve and Convert modes, TMs in the Teach a TM dialog, and held items on the Teams page.
- **Achievements** (`/public/achievements`): see [Achievements](#achievements).
- **Shop** (`/public/dashboardshop`): Poké Balls, Evolution Stones, the Weekly Pack, and, when their switches are on, Held items, Technical Machines, and Mega Shards and Stones. During a [Live event](#live-events) it shows the event's discounts and the Poké Ball choice.

The sprite credits for Pokémon and trainer artists are at `/credits`, linked from the sidebar. Shiny Pokémon and Tier backdrops look the same as on the Discord cards (`public/shared/spriteFx.js`).

## Collection and Pokédex

Every Pokémon a player owns is its own Copy (`services/box.js`), with its own Level and EXP. The Pokédex records every species and shiny the player has ever caught. It never drops, so giving up a last Copy leaves the species registered. Pokédex completion and the Pokédex-named achievements (each region's Pokédex Complete, National Pokédex Complete, and Prismatic Pokédex) count the Pokédex. The ones that say "at the same time" (Living Pokédex, Hall of Legends, Mythic Archive) count the Collection. A catch card says NEW the first time a species enters the Pokédex, and NEW SHINY for the first shiny of a species already in it. The design is in [`docs/adr/0001-individual-copies-and-permanent-pokedex.md`](docs/adr/0001-individual-copies-and-permanent-pokedex.md).

The Collection page shows one tile per Copy, with its Level, its Tier, a ★ TM mark on a Trained copy, and a C, R, or S badge for each Team it's on. It filters by search, rarity, type, region, and Shiny only. Each region chip shows that region's Pokédex completion, such as "Kanto 75/151", counted over the whole region whatever the other filters say. It sorts by Pokédex number, Power, Level, Newest, or Name, and groups the tiles by region under Pokédex number. Tapping a tile opens the mode's action for that Copy. When the player owns more than one Copy of it, or a Trained one, a "Which one?" chooser comes first with the tapped Copy picked.

- **Browse** opens the detail panel: stats, the player's Copies with each one's moves and learnable moves, and the Team slots it fills, plus a Teach a TM button when TMs are on.
- **Evolve** spends Evolution Stones by the Tier step, plus Shiny Dust for a shiny. The Copy keeps its EXP, raised to the evolved species' lowest catch Level if it's below that, and a Copy on a Team evolves in its slots. Every generation evolves on Stones alone, with no Level requirement (`services/evolutionRules.js`).
- **Feed** gives up one Copy to add EXP to another Copy of the same Pokémon and Variant: half the EXP the target needs for its next Level. The Copy given up can't be on a Team. The one that grows can.
- **Donate** gives up one Copy for CC, and sometimes Shiny Dust. **Donate Duplicates** donates, for each Pokémon and Variant, every Copy except the best one (the highest EXP), any Copy on a Team, and any Trained copy. Its confirmation shows one tile per Copy with its Level, and tapping a tile keeps that Copy too. **Multi-select** donates several Pokémon the player owns only one Copy of. Both show a confirmation first and donate all or nothing.
- **Convert** turns a normal Copy shiny for Shiny Dust by Tier. It keeps its EXP, moves, and Team slots.

A Copy on any of the three Teams can't be donated, gifted, or fed until it's taken off. A Trained copy is never picked automatically, and donating or feeding one asks the player to confirm that its TMs aren't refunded. `/gift type:pokemon` sends one normal Copy: the sender's lowest-EXP Copy that isn't on a Team or Trained, and never their last Copy of that Pokémon. It arrives with its Level and EXP and registers in the recipient's Pokédex.

After the first boot with the Pokédex, the bot reads its own backups in the storage channel once, newest first, and adds every species and shiny each player ever had (`services/dexBackfill.js`). It runs in the background, resumes after a restart from `pokedex-backfill-state.json` in `TRAINERDATA_DIR`, and creates no Copies. `POKEDEX_SCAN=off` skips it.

## Battles

Players battle each other's Teams in casual, ranked, or wager battles. The bot simulates the whole fight with Gen 5 stats, moves, and type matchups and saves the result, then replays it in the channel. The replay opens with a VS card (`utils/render/battleVsCard.js`): both trainers and Teams, and each player's record for that mode (the casual record, or the Ranked rating and this season's record), read before the battle so it never gives the result away. A Wager offer carries the same card. Then the fight plays turn by turn as animated images: each player's displayed trainer stands at the left of their row, on their Aura if they have one (see [Auras](#auras)), the two Pokémon fighting are spotlit, HP bars drain, and a game-style text box narrates each move. Battles longer than 12 turns are spread over 12 updates. A final image shows who won, the MVP (the winner's Pokémon with the most knockouts), level-ups, and new moves, and an embed under it shows each player's Ranked rating change, or says a casual battle was unrated. When the replay ends, each player who earned EXP gets a message only they can see with each Pokémon's EXP gain. Discord allows these replies only within 15 minutes of a command, so a Challenger whose Wager was accepted near the end of the offer may not get theirs; the EXP still counts. At most 2 battles replay at once. When more start, each extra battle's message shows its place in line until its replay begins. The results count right away; only the replay waits.

Moves follow Gen 5 rules for priority, multi-hit, drain, recoil, and crash damage. Quick Attack goes first and Vital Throw goes last. Bullet Seed hits 2 to 5 times. Giga Drain heals the user half the damage it deals, and Double-Edge hurts the user as well as the target. A missed High Jump Kick costs the user half its max HP. A Pokémon that faints from its own recoil or crash counts as a knockout for the Pokémon it attacked. When both last Pokémon faint from one move, the side whose Pokémon fainted last wins. With recoil, that's the user's side, as in Gen 5. The sim has no abilities except Shedinja's Wonder Guard, and no items, status conditions, stat changes, or other move side effects. A battle with a Mega Evolution or a held item that acts in combat is the exception: it runs on a second engine, `utils/battle/effects.js`, that adds abilities, held items, stat stages, weather, terrain, and burn (see [Mega Evolution](#mega-evolution) and [Held items](#held-items), both off by default). With the full sim switched on, every fight follows Pokémon Showdown's engine instead (see [Full sim and Battle plans](#full-sim-and-battle-plans)).

- `/battle opponent:@user` starts a casual battle between both players' Casual teams at their real Levels. It runs right away, costs nothing, and is unrated. It counts toward a separate casual record and the casual achievements. Only the Challenger earns EXP.
- `/battle opponent:@user ranked:True` starts a ranked battle between both players' Ranked teams, with every Pokémon at Lv 50. It runs right away, and both players' Ranked ratings change. Only the Challenger earns EXP. Both players need a full Ranked team of 6 Pokémon they own.
- `/battle opponent:@user wager:100` offers a Wager battle. Like a ranked battle, it uses Ranked teams at Lv 50 and changes both ratings, and it puts CC on the line. Both players need a full Ranked team of 6, checked when the offer is made and again at Accept, and both need a Discord account at least 7 days old and 25 species registered in their Pokédex (`WAGER` in `utils/battle/tuning.js`), since a Wager is the only way CC moves between players. The bot holds the Challenger's CC until the Defender accepts or declines, or for 15 minutes. A Defender with less CC than the Stake can accept with everything they have, and the Challenger gets the difference back. Both players earn EXP, and the winner takes the pot. If the Challenger's Ranked team gets stronger before the Defender answers, Accept cancels the offer instead. A restart refunds any Stake still waiting for an answer.
- `/leaderboard` shows the top 10 Ranked ratings this season and your position. Casual battles don't count.
- `/rankedcard` (alias `/showbattlecard`) shows the player's Ranked team at Lv 50 as an image, with their Ranked rating, record, and leaderboard position. With `user:` it shows another player's card, privately.

`/battle` answers "Your battle is starting below" once the result is saved. The replay and the private EXP message follow.

Each player can start 10 battles per UTC day in all modes together, and at most 3 against the same opponent. A Wager battle counts for both players. Past either cap, the bot refuses ranked and wager battles. Past the daily cap, a casual battle still runs, but it earns no EXP or Mega Shards and doesn't count toward the 10. After 3 casual battles against one opponent in a day, the next one posts a Rematch request in the channel, and the battle runs only if the opponent accepts within 5 minutes (`REMATCH` in `utils/battle/tuning.js`). An accepted rematch earns no EXP or Mega Shards. If the opponent declines or doesn't answer, the Challenger can't ask them again until midnight UTC, or until the opponent sends them a `/battle` that isn't refused. A restart closes open requests without blocking anyone, and an admin's Battle cap reset lifts the block. Casual battles past either cap still count on both players' casual records and toward the casual achievements. In a casual battle, when one Team is much stronger, the Underdog sometimes gets a surge that raises its Levels for that battle, so lopsided fights are rarely but not never upsets. Ranked and wager battles have no surge.

A cute Underdog gets a second chance. Every species and Mega form has a hand-written Cuteness score from 0 to 10 in `data/battle/cuteness.json`, and they're strict: Pokémon that aren't cute score 0 to 2, most cute ones score 6 or 7, and only 10 species score 10. A Team's Cuteness is its members' average, so a lone Pikachu counts as a fully cute Team. An Underdog averaging over 5 also rolls for a cute surge. Its chance climbs fastest just above 5 and reaches 42% at an average of 10 (`CUTE` in `utils/battle/tuning.js`). A cute surge lifts the Team until its Power is 1.5 times the other Team's, first by Level and then, past Lv 100, by raising its stats, with no cap. Against six mythics, a Team averaging 10 wins about 42% of the time, a Team of the cutest Pokémon (scored 9 or 10) about 37%, and a typical cute Team (scored 6 or 7) about 20%. After a cute surge the Team earns EXP as the Levels it was lifted to, so beating a far stronger Team pays like an even fight. When a cute Team surges, the heading reads "💖 The crowd can't resist @Ash's team! Underdog surge!". Teams averaging 5 or less surge exactly as before. The scores never leave the server: no page, route, or command reads them. The design is in [`docs/superpowers/specs/2026-11-11-cuteness-design.md`](docs/superpowers/specs/2026-11-11-cuteness-design.md).

Ranked ratings start at 1000 and belong to a season (`RANKED.season` in `utils/battle/tuning.js`). When the season number goes up, each player's record from the old season moves to their history, and they start again at 1000 and 0–0. Ranked battle achievements count wins from every season.

### Teams and moves

Each player has three Teams in slot order, each slot one specific Copy, set on the dashboard's Teams page (`/public/teams`), one tab each:

- The **Showcase team** (`services/showcaseTeam.js`) is for show: the Overview page, `/showcase` (alias `/showteam`), and the trainer card. It holds 0 to 6 Pokémon, can hold the same Pokémon more than once (one Copy per slot) and any number of Megas, and never fights, so it has no moves, held items, or Battle plan. At launch it was filled once from the Casual team.
- The **Casual team** fights casual battles at its real Levels.
- The **Ranked team** fights ranked and wager battles, where every Pokémon is Lv 50 (`RANKED.level`). It holds at most one mythic-tier Pokémon. If a re-tier leaves a Ranked team with more than one mythic, the bot keeps the first mythic in slot order when it starts and takes the rest off the team, which leaves them in the Collection. The player gets a one-time notice (`services/notices.js`), a banner on the Teams page until dismissed or a private note after their next `/battle`, whichever comes first.

The Casual and Ranked teams hold 1 to 6 Pokémon, each Pokémon and Variant once, with at most one Mega, and slot 1 leads. Challenges and Trainer encounters fight with whichever of the two the player picks, at real Levels. On the Teams page, adding a Pokémon the player owns more than once asks which Copy, and a slot with more than one Copy to choose from has a Change copy button. Copy from fills a Team from either of the other two, keeping what fits the target's rules and listing what it left out. Moves come along only between Casual and Ranked. Nothing changes until Save. The rules are in `services/battleTeam.js`, `services/megaTeam.js`, and `services/teamCopy.js`.

Each Copy can have up to 4 moves chosen for the Casual team and 4 for the Ranked team, picked on the Teams page from the moves it has learned by level-up at its own real Level and any it learned from a TM (see [TMs](#tms)). A Ranked team Pokémon fighting at Lv 50 still knows only those. Without a choice, it uses the last four moves it learned. A level-up that teaches a move never equips it: for each Team still on automatic moves, the bot keeps the moves the Pokémon had before (`keepMovesOnLevelUp`), and the new move waits in the Moves editor. `/inspectpokemon`, an alias that opens `/pokedex` on Your stats, shows the Casual team's moves. Its text fallback adds the Ranked team's when they're set and, with the full sim on, the ability the Casual team's Battle plan picks. The move rules are in `services/movesets.js`. The admin command `/resetteam` clears the Casual and Ranked teams, their moves, and their held items, and keeps the held-item unlocks.

### Held items

Held items are built but off unless `HELD_ITEMS_ENABLED` is set (`config/features.js`). There are 33, each a permanent unlock a player owns once (`catalog/heldItems.js`):

- 8 are free starters, claimed on the Teams page: Leftovers, Sitrus Berry, Focus Sash, Quick Claw, Expert Belt, Bright Powder, Focus Band, and Lucky Egg.
- 25 are sold once each in the Shop's Held items section: the 18 type items at 3,000 CC (moves of that type hit 1.2 times as hard), Muscle Band, Wise Glasses, and Black Sludge at 4,000, Shell Bell, Light Ball (Pikachu only), and Thick Club (Cubone and Marowak only) at 5,000, and Eviolite at 6,000.

Players equip them on the Teams page, one per Pokémon on the Casual and Ranked teams, and an unlock can be on one Pokémon per Team (the Item Clause; picking it for a second one offers to move it). The item belongs to the Copy in the slot, and a slot set to Mega Evolve holds its Mega Stone instead. Equipping uses nothing up. Each battle mode uses its Team's items, and challenges and encounters use the picked Team's. Items never change a Team's Power or the Underdog surge. Lucky Egg has no effect in combat and pays 1.5 times the battle EXP, rounded down. The effects are in `utils/battle/items.js`. Choice items, Life Orb, Rocky Helmet, and Assault Vest are never offered.

`HELD_ITEMS_TESTERS`, a comma-separated list of Discord ids, limits them to those players. Under the master switch, `HELD_ITEMS_DASHBOARD_ENABLED`, `HELD_ITEMS_STARTER_ENABLED`, and `HELD_ITEMS_SHOP_ENABLED` are on and `0` turns that part off. `HELD_ITEMS_BATTLES_ENABLED=1` turns on the battle effects and Lucky Egg's EXP, which are off without it. Turning any switch off deletes nothing. The rules and rollout plan are in `docs/held-items/`.

### TMs

TMs are built but off unless `TM_ENABLED` is set (`config/tmFeatures.js`). There are 156 for sale, each teaching one damaging move (`catalog/tms.js`, with each species' compatibility in `data/battle/tm-data.json`, built by `npm run generate:tm-data`). The Shop's Technical Machines section sells them by tier at 1,500, 3,000, 5,000, 6,000, and 7,500 CC, 1 to 10 at a time, filtered by default to TMs the player's Pokémon can learn. The buy dialog lists which of the player's Pokémon can learn it, Casual and Ranked team members first, with each one's Level and whether it already knows the move. `TM_WEEKLY_CAP`, a whole number, limits how many a player can buy per week, and is off unless set.

The Teach a TM dialog, opened from the Collection page's detail panel or a Team slot's Moves editor, teaches a TM's move to one Copy for good and uses the TM up. A move the Copy already has is refused and the TM kept. A Copy that learns a TM move is a Trained copy: every slot that held an untrained Copy of that Pokémon and Variant switches to it, and it keeps its TM moves through evolution, shiny crafting, and gifts. For each Team it's on, the player picks whether the new move is added, replaces a move, or waits, and the dialog starts on keeping the current moves. When the Copy would learn the move by level-up later anyway, the dialog says at which Level and warns before teaching, but still allows it. Turning TMs off hides the shop and the dialog, and keeps every TM and Trained copy.

### Full sim and Battle plans

With `FULL_SIM_ENABLED` on (off by default), every fight (casual, ranked and wager battles, challenges, and Trainer encounters) runs on Pokémon Showdown's own battle engine, `@pkmn/sim`, instead of the bot's two engines. Status moves, every Pokémon's ability, held items, stat stages, weather, terrain, hazards, screens, Trick Room, Tailwind and PP all work as in the games, with Gen 9 stats and moves. The damage roll (80 to 100%), crit odds (1 in 12) and crit damage (×2) stay as swingy as the bot's own engine. There are no clauses, the turn cap stays at 300, and nobody switches on purpose: after a faint or a U-turn the healthy Pokémon in the lowest slot comes in, while Roar and Dragon Tail drag in a random one. In an Elite Four run, HP and status carry from fight to fight. Fights run on a worker thread (`utils/battle/simPool.js`, `SIM_THREADS`), so a fight never stalls the bot.

The AI plays each side by the side's **Battle plan**: All-out attack (the default), Set up & sweep, Status & stall, Hazards & screens, Weather, or Speed control (Trick Room for a slow Team, Tailwind for a fast one). Players set one plan for the Casual team and one for the Ranked team on the Teams page. Only the owner sees it. A player's own Fight records and replays name the plan they played, and the other player's never do. The plan picks each Pokémon's ability for the fight, from its species' regular abilities, and `/inspectpokemon` shows the one the Casual team's plan picks. It never changes a player's moves. A Pokémon brings its picked Moveset, or else its last four attacks, and the plan only marks moves it suggests in the Moveset editor. A plan whose key move nobody brings plays as All-out attack, and the Teams page names the move it needs and the Team member that knows it or learns it soonest, with the Level.

Players' Teams play at Solid skill. Most Trainer classes are Solid too, the youngest classes are Rookies (they stray from the best move more often), and every Challenge opponent (the Gym Leaders, the Elite Four, Blue and Red), Ace Trainers and Dragon Tamers are Experts (they never stray, and look a turn ahead). To make up for that, each Challenge gets its own hidden stat boost on the full sim in place of today's ×1.1, set so it needs the same Level as it does today, except the Elite Four, which needs Lv 70 rather than 73 (`FULL_SIM.challengeStatBoost` in `utils/battle/tuning.js`, measured with `tools/challenge-gates.mjs`). Each computer opponent plays a signature plan that also picks its moves (`catalog/opponentPlans.js`, a draft awaiting sign-off). Status moves come from level-up learnsets now, and later from status TMs (`catalog/statusTmDraft.js`, not sold until signed off).

When the switch first turns on, the bot records the moves every Team member without a picked Moveset brings, so nobody's moves change (`services/fullSimCutover.js`). The record belongs to the Pokémon, not a Team. A picked Moveset replaces it on that Team only, and clearing the pick brings it back. A level-up still never equips a newly learned move: the Pokémon keeps the moves it fought with. Players who join with the switch on have nothing to record. Picked moves that the new learnsets no longer teach keep working until the player edits that Moveset. A fight the sim can't finish, such as one on a crashed worker, changes nothing. A wager returns both Stakes, an Elite Four run stays as it was, and a Trainer encounter's card stays open. With the switch off, the bot never loads `@pkmn/sim` or `full-sim-data.json`. New Fight records keep each fight's steps and the raw Showdown log, gzipped when large, and old records replay as before. Discord replays get about 20 updates instead of 12. The design is in [`docs/superpowers/specs/2026-11-12-full-sim-design.md`](docs/superpowers/specs/2026-11-12-full-sim-design.md).

### Levels

Every Copy has its own Level, from 1 to 100, set by its EXP. Every catch, a duplicate too, adds a Copy with a Catch level rolled from its Stage (`CATCH_RANGES` in `utils/battle/tuning.js`): 2 to 15 for Stage 1, 16 to 32 for Stage 2, 32 to 45 for Stage 3, and 40 to 55 for a Stage 1 legendary or mythic. Rolls lean toward the low end, and 3% go past the range, up to 35, 50, 65, and 75. Feed is how one Copy makes another stronger (see [Collection and Pokédex](#collection-and-pokédex)). Battles, challenges, and Trainer encounters pay EXP for every opponent the Team knocks out, more for higher-level opponents, and every Team member gets it. Ranked and wager battles pay EXP by the Pokémon's real Levels, not Lv 50.

Levels show on the dashboard, on `/showcase` and `/trainercard`, and in `/pokedex`'s Your stats.

Every tunable number (catch ranges, EXP pace, Underdog surge and cute surge, Battle caps, the ranked Level and season, the challenge cap and loss, the challenge opponents' stat boost, the Revive window, and Trainer encounter odds, limits, and Levels) is in `utils/battle/tuning.js`. The design and the reasons for each number are in [`docs/superpowers/specs/2026-11-02-battles-design.md`](docs/superpowers/specs/2026-11-02-battles-design.md); the Trainer encounter numbers are in [`docs/superpowers/specs/2026-11-10-trainer-encounters-design.md`](docs/superpowers/specs/2026-11-10-trainer-encounters-design.md).

### Battle data

`battleData.json` holds base stats, level-up moves, each move's power and effects, and the type chart for all 1,025 species: Gen 5 values for #1–649 (plus Fairy moves for the 22 species retyped to Fairy), the latest generation's values for #650–1025, and the modern 18-type chart. The effects it stores are priority, hit counts, drain, recoil, and crash damage. `tools/generate-battle-data.mjs` builds it from Pokémon Showdown's data (MIT) through the dev dependencies `@pkmn/dex` and `@pkmn/data`, which the bot never loads at runtime. The full sim reads `data/battle/full-sim-data.json` instead (Gen 9 stats and moves, status moves with the Battle plan roles each one plays, each species' latest-game learnset and regular abilities, and each ability's Showdown rating; `npm run generate:full-sim-data`), and its engine, `@pkmn/sim` (MIT, pinned at 0.10.12), is a runtime dependency. Battle images are animated GIFs: `@napi-rs/canvas` draws each frame, the runtime dependency `omggif` reads each sprite's animation frames, and the runtime dependency `gifenc` encodes the result. They render on worker threads, like the cards (see [Cards and animated sprites](#cards-and-animated-sprites)). `utils/battle/render.js` draws the parts that never change once per image, and the shared encoder, `utils/render/gif.js`, writes only the part of each frame that changed. To regenerate the battle data:

```bash
npm run generate:battle-data
node tests/battleData.test.js
```

### Battle Records

Every finished Battle, Challenge, and Trainer encounter is saved as a Fight record: both Teams as they fought, the result, and every turn. The dashboard's Battle Records page lists the player's own, with All, Battles, Challenges, and Encounters tabs. A summary covers the newest 20 in the tab: wins and losses, the win rate, knockouts and faints, the three most-used Pokémon, and the Ranked rating. Each fight's row opens into moves, items, Levels, knockouts, damage, and rewards, and Watch replays the fight full screen in the browser (a `#fight=<id>` link opens it). A player sees only their own records, and a Battle shows in both players' lists. Each player keeps their newest 50 Battles, 50 Challenges, and 50 encounters. A Battle is stored once for both players, and an Elite Four run is one record. Records live in `fight-records.ndjson` in `TRAINERDATA_DIR`, outside the player data and its backups, and saving one never holds up or breaks a fight. `node tools/forget-fight-player.js <id> --yes` removes a player from the file (stop the bot first; without `--yes` it only reports), and the other player's copy then shows "Former trainer". The design is in [`docs/design/battle-records.md`](docs/design/battle-records.md).

## Challenges

`/challenge` pits the player's Casual or Ranked team, their pick, at its real Levels, against fixed Kanto teams: the 8 Gym Leaders, the Elite Four, Blue, and Red. Challenges use the same sim and replay as Battles, with no Underdog surge, and leaders appear by name, never as a mention. Every challenge opponent fights with its stats raised 10% (`CHALLENGE.statBoost`). That's hidden on purpose: players only see the roster's Levels, and EXP, which follows those Levels, is unchanged. The leader stands at the left of their row like a player's trainer, the leader's row and nameplate show their type, and a Gym's Badge sits between the rows. A first win adds a screen to the final image that presents the Badge, or "ELITE FOUR CLEARED", "CHAMPION DEFEATED", or "RED DEFEATED". After the replay, challenges follow `/battle`: the embed under the final image says only what the image doesn't (how far an Elite Four run got, the Badge, the prize, what unlocked, or the loss line; nothing after a rematch win), and the player gets a private message with the result (the exact CC lost or the prize) over the same EXP card `/battle` sends.

- `/challenge` with no opponent shows a private board image: the 8 Gyms with each leader's sprite, type, and Badge (lit once earned), then the Elite Four, Blue, and Red on darker stages, as black silhouettes behind a padlock with what opens them until they open (the Elite Four's names and the Champion's show as "???"), and with a gold CLEARED tag once beaten. It shows how many challenges are left today, and never shows Levels. If the image can't render, a text embed with the same facts goes instead. Under it, a dropdown lists everyone the player can challenge now (the Elite Four and Blue join once they open); picking one opens the same private preview as naming them. The dropdown works for 10 minutes.
- `/challenge opponent:Brock` shows a private preview: a VS card with the player's trainer, Badges, and Team against the leader, their type, a Poké Ball per Pokémon in their party, the Badge on the line, and the prize, plus a line with the exact CC a loss would cost. Its buttons are Fight with Casual and Fight with Ranked, one for each of those Teams the player has set, and Not now. The card shows the Casual team, or the Ranked team when that's the only one, and the bot acknowledges privately first, since the card takes a few seconds to draw. The Elite Four card shows all four members. Not now, or leaving the preview for 2 minutes, costs nothing. A Fight button checks everything again, saves the result with the picked Team and its Battle plan, then posts the same card in public and the replay. The card never shows the amount (it says "Lose: 10% of CC"), and the public one is built before the win is saved, so it still shows the Badge as on the line. If the card can't be drawn, an embed with the same facts goes instead. The player's private result, with the exact CC lost or the prize and their EXP card, arrives after the replay ends.
- With `CHALLENGE_CHANNEL_ID` set, `/challenge` works only in that channel; anywhere else it privately points the player there. Unset, it works in any channel.

Gyms can be fought in any order, and beating a Gym Leader the first time earns their Badge. All 8 Badges unlock the Elite Four run: Lorelei, Bruno, Agatha, and Lance back to back, replayed in one message, all with the Team and Battle plan the run started with. Each Pokémon keeps its damage from one fight to the next, fainted ones stay fainted unless revived, and losing any fight ends the run. There's no forfeit. Clearing the run once unlocks Blue as a separate fight. Red is open to everyone from the start.

After each Elite Four fight the player wins, if any of their Pokémon fainted, they get a private menu with one button per fainted Pokémon and 60 seconds to pick one to Revive. It comes back at full HP for the next fight; with no pick, nothing is revived. Meanwhile the public replay says they're choosing, and the next fight's header says who was revived. The run is saved on the player's record after every fight. While it's open, other challenges are refused (`/battle` still works). If the bot restarts mid-run, or an error stops the run and it sits for 15 minutes, it finishes without Revives (at startup, or on the player's next `/challenge`), and its replay message shows the result. The dashboard never receives an open run, since its seed would let a player test each Revive in advance.

Each player gets 5 challenges per UTC day, separate from the 10 Battles, and an Elite Four run counts as one. Every challenge pays EXP for each knockout, win or lose. Challenges never change the Ranked rating or either battle record.

The first win against each opponent pays the leader's trainer sprite, CC, evolution stones, Shiny Dust, and their Aura (see [Auras](#auras)); the Elite Four run pays all four sprites. Each Elite Four member beaten in a run adds their Aura, even when the run is lost later. The sprite is the first enabled version of that leader the player doesn't own. A player who owns them all gets half the sprite's shop price (`TRAINER_COSTS` in `utils/trainerCosts.js`) in CC instead. Prize Dust doesn't count toward the weekly cap on Dust from donations. Rematches pay EXP only.

Losing costs 10% of the player's CC, rounded down, and that CC is gone. A failed Elite Four run costs it once. The loss is never more than the preview showed, even if the player's balance grew before they clicked Fight!. Public posts give it as 10% and never the amount, because 10 times the amount would reveal the balance. A player can't challenge while one of their wager offers is waiting for an answer.

Badges show in a row on the trainer card and under the stats bar on the dashboard's Collection page, with unearned ones dimmed. `/api/user-pokemon` sends the challenges won (`challengeProgress`) for that row, never an open run. The 8 Badges are defined in `public/picker-pokemon/badges.js`, which the bot and the dashboard share. The Badge art is FireRed's trainer card badges, tinted with each badge's usual colors by `tools/tint-badges.mjs` (`npm run generate:badges`), which writes `public/sprites/badges/` from the sheet in `tools/badges/`. The board, the VS card, and the replay draw the Badges from `public/sprites/badges/` themselves. Only the preview's fallback embed loads its Badge image from the bot's public host (`PUBLIC_URL`), the same way trainer sprites do. Text lines name the Badges. The teams and prizes are in `utils/challenge/roster.js`. The design, the prize table, and the measured difficulty of each challenge are in [`docs/superpowers/specs/2026-11-08-challenges-design.md`](docs/superpowers/specs/2026-11-08-challenges-design.md).

## Trainer encounters

While a player chats, a computer-run Trainer can spot them, the way a Trainer on a route spots the player in the games, except the player can run. Each message that earns TP and doesn't catch a Pokémon has a 1.5% chance. A player is spotted at most 8 times per UTC day and never within 30 minutes of their last encounter, whether they fought it or not. Nobody is spotted without a Casual or Ranked team, with an Elite Four run open, or with a wager offer waiting for an answer. Encounters use none of the 10 Battles or 5 challenges a day.

The card posts in the channel the player chatted in, mentioning them: their trainer and Team against the Trainer, who has the games' "!" over their head and a Poké Ball per Pokémon, a games-style text box ("Youngster Joey challenged Ash!" and the Trainer's line), and the Prize money ("Win or lose: 260 CC"). It never shows the Trainer's Levels. A player with only one of the Casual and Ranked teams set gets Battle! and Run. A player with both gets Battle with Casual, Battle with Ranked, and Run, and the card shows the Casual team with a Prize money row for each. Only the spotted player can press the buttons; anyone else gets a private note. Run, or no answer in 2 minutes, shrinks the card to one line ("Ash ran away from Youngster Joey."). A Battle button fights with that Team the way a casual battle would (its chosen moves and held items, and its Mega if it still qualifies) but with no Underdog surge, at its current Levels, minus any Pokémon given up since. The replay plays on the card itself, ending with the Trainer's after-battle line and "Ash got 260 CC for winning!" or "Ash whited out!". The player then gets their EXP card privately, alone in its own message, plus the exact CC paid on a loss. Ten seconds after the replay ends (`ENCOUNTER.resultMs`), the card drops its images and keeps only those two lines, so every encounter leaves just a line or two of text in the channel. The bot never removes the private EXP card, but like any private reply, Discord drops it when the player dismisses it or restarts Discord.

The bot rolls one Trainer per Team from the same seed, so the class, name, party size, and lines match, and only the Levels and Prize money follow the Team. The Trainer's Levels follow the mean Level of the Team: 70% of Trainers are 2 to 15 Levels below it, 20% within 2, and 10% 5 to 15 above (never below Lv 5 or above Lv 100). Each brings 3 to 6 Pokémon on their class's type theme, from every released region, never legendary or mythic, each the furthest form of its line that fits its Level. Half of the strongest Trainers are Ace Trainers and half look like any other class, with a quietly confident line as a hint (so is the Prize money, for a player who knows the bases). One weak Trainer in 33 sends out a much stronger Pokémon last, legendaries included. Prize money is the class's base (10, 40 for Gentlemen, Ladies, Rich Boys, and Beauties, 30 for Ace Trainers) times the Level of the Trainer's last Pokémon: a win pays it, and a loss pays the same, or everything the player holds if that's less. Encounters never change the Ranked rating or either battle record.

Open encounters live only in memory and hold nothing, so a restart loses them; a click on a card from before the restart shrinks it to "This Trainer lost interest." The classes are in `utils/encounter/roster.js`, the lines in `utils/encounter/lines.js`, the roll in `utils/encounter/generate.js`, the rules and the fight in `utils/encounter/runEncounter.js`, the Discord side in `utils/encounter/service.js`, and the card in `utils/render/encounterCard.js`. The design and the measured win rates, CC, and leveling pace are in [`docs/superpowers/specs/2026-11-10-trainer-encounters-design.md`](docs/superpowers/specs/2026-11-10-trainer-encounters-design.md).

## Achievements

`/achievements` (private) and the dashboard's Achievements page list every achievement in 9 categories: Pokémon Collection, Shiny Hunting, Evolution, Ranked Battles, Casual Battles, Training, Economy, Daily & Weekly, and Special Milestones. Hidden ones show as "???". Each achievement a player reaches earns Achievement Points. The rewards some achievements list, such as CC, items, titles, and badges, show as "pending approval", and none can be claimed until its id is added to `APPROVED_REWARD_IDS` in `config/achievementRewards.js`, which is empty. Ranked Battles counts ranked and wager battles, and Casual Battles counts casual wins and win streaks. The catalog is `catalog/achievements.js`, and the progress rules are in `progression/achievements.js`.

## Auras

An Aura is the effect a player shows behind their trainer on their own cards and battle images: `/trainercard`, `/rankedcard`, the challenge and encounter cards, the VS card, and their rows in a battle replay. Computer-run opponents never wear one. There are 42 (`catalog/auras.js`), kept for good once earned (`services/auras.js`):

- the three Tier backdrops, Epic, Legendary, and Mythic, from ever owning a trainer of that tier;
- one per Gym Leader, Elite Four member, Blue, and Red, from beating them (see [Challenges](#challenges));
- 13 milestone Auras from achievements: each region's Pokédex, a Ranked rating of 1400 and of 1600, and 25 and 100 different shinies;
- 9 sold on the Auras tab for 25,000, 50,000, or 100,000 CC;
- 3 event Auras, which only an admin hands out. A retired one is never handed out again.

Players pick one on the dashboard's Trainers page, Auras tab: Auto (the default: their displayed trainer's own Tier backdrop, so nothing below Epic), None, or an Aura they own. Only the three Tier backdrops have art in the repo so far. Any other Aura can be owned but not equipped until its art ships in `assets/auras/<id>/` (`aura.json` and `back.png`), and the shop lists none until then. An equipped Aura whose art goes missing falls back to Auto.

Art Auras follow one contract that the bot and the dashboard share (`public/shared/auraArt.js`): every sheet plays once per 2.4-second loop, the same clock as the trainer's idle, `back.png` sits on the trainer's feet on cards, `vs.png` fills a VS half and is mirrored on the opponent's half, and `row.png` backs a replay row. An Aura draws even without a `tint` in `aura.json`, which only colors platforms and records. An optional `light` in `aura.json` lights the trainer from behind, the sides, or a direction, per frame if wanted. Without it, trainers draw exactly as before.

## Live events

A Live event is a named period an admin schedules on the admin dashboard's Live events tab, with a start, an end, and one or more Event effects that apply to every player while it runs (`utils/liveEventRules.js`, `services/liveEvents.js`). The effects:

- a Catch boost on chosen types, Regions, Tiers, or species, and a Catch limit to chosen types, Regions, or species;
- the shiny chance and the chat catch chance;
- battle EXP, optionally for one type only;
- TP from chatting, CC earned, and Shiny Dust earned;
- a shop discount from 1 to 100% on Poké Balls, Evolution Stones, TMs, held items, trainer sprites, or Auras;
- the Trainer encounter chance, Prize money on wins, and extra battles per day.

Effects have no caps except one: Poké Balls are never discounted more than 30% in total, however many events run (`MAX_DISCOUNT` in `utils/liveEventRules.js`), so throwing a ball and donating the catch never pays for itself at any Rank. For the same reason, a CC multiplier doesn't apply to donations. Several events can run at once: multipliers of the same kind multiply, discounts each take their share of what's left, extra battles add up, and a Pokémon must pass every running Catch limit. A boost on a type, Region, or species keeps each Tier's overall chance, and only a boost on a Tier changes it. An admin can't save limits that together leave a plain Poké Ball nothing to roll.

The free random catches (the chat catch, `/daily`, and the Weekly Pack) always follow boosts and limits. The paid ones, dashboard Poké Balls, follow them only when the player turns on Use Live event, on `/events` or the Shop page. It's off by default and turns off again when a newer catch event starts. With it on, a ball that has nothing to give is grayed out and costs nothing.

The bot checks every 30 seconds and posts a start and an end message to the channel set on the Live events tab, if one is set. A start or end it missed while it was down posts once at boot. `/events` privately lists what's on now and up to 5 events coming up. A catch caption shaped by a boost or limit ends with "· 🎪" and the event's name, and the encounter card says "a win pays ×N" during a Prize money event. A scheduled event can be edited or deleted, a running one edited or ended now, and an ended one only read. Every change is an audited Admin change with a reason. Events are stored in `live-events.json` in `TRAINERDATA_DIR`. The design is in [`docs/design/live-events.md`](docs/design/live-events.md).

## Mega Evolution

Mega Evolution is built but off unless `MEGA_EVOLUTION_ENABLED` is set. Without it, the dashboard shows no Megas, the server refuses Mega unlocks and Teams with a Mega slot, and battles and cards ignore any Mega data already stored. With it set to `1` (`config/features.js`):

- Using a Mega Stone in the Collection page's Mega Evolutions section permanently unlocks that Mega form for one species and Variant. Players get Mega Stones only through Mega Shards, below, or an admin grant.
- `MEGA_REWARDS_ENABLED=1` (off by default) turns on Mega Shards (`services/megaShards.js`). `/daily` has a 25% chance of 2, and a battle win a 10% chance of 1, at most 2 a UTC day, for a winner who chose to fight: the Challenger, or either side of a Wager battle. The Shop sells shards for 1,000 CC each, in packs of 1, 5, or 25, up to 25 bought with CC per week (the week starts Monday 00:00 UTC), and sells a Mega Stone for 25 shards, or 50 for a legendary or mythical Pokémon's. It lists only stones whose form can battle: 70 with Gens 1–5 released. The economy is in [`docs/mega-evolution/MEGA-SHARDS.md`](docs/mega-evolution/MEGA-SHARDS.md).
- A form can battle only with an accepted battle profile (`config/megaBattleProfiles.js`). The Legends: Z-A forms are accepted, with their abilities from Showdown's data. Mega Rayquaza, Mega Floette, Mega Zygarde, and the Original Color Mega Magearna never battle.
- Each Team can have one slot set to an unlocked Mega form. A Mega shares its Pokémon's Level, EXP, and Team slot, and never counts toward Pokédex completion.
- The slot fights and shows as the Mega (its stats, types, and ability, Mega sprites, and a MEGA tag) only when `MEGA_BATTLES_ENABLED=1` is set too. The master switch alone leaves it off, and the slot fights and shows as the base Pokémon.
- `MEGA_DASHBOARD_ENABLED`, `MEGA_UNLOCKS_ENABLED`, and `MEGA_TEAMS_ENABLED` are on under the master switch, and `0` turns that part off. `MEGA_FORMS` limits the release to a comma-separated list of form ids, such as `mega-charizard-x`. A form also needs its generation released (`POKEMON_GENERATIONS`).

The forms are in `data/pokedex/megas.json`, their abilities in `data/pokedex/mega-abilities.json` and `utils/battle/abilities.js`, and each player's unlocks in `megaUnlocks` on their record. The design and the milestone reports are in `docs/mega-evolution/`.

```bash
npm run generate:megas        # data/pokedex/megas.json, mega-abilities.json, data/sprites/mega-source-manifest.json
npm run generate:move-flags   # data/battle/move-flags.json, the move flags abilities read
npm run import:mega-sprites   # public/sprites/pokemon/mega/ and data/sprites/megas.json
npm run validate:megas        # release gate: forms, stones, and sprites
```

## Cards and animated sprites

Most commands reply with a rendered image card instead of an embed: `/showcase`, `/pokedex` (and `/inspectpokemon`), `/leaderboard`, `/daily`, `/trainercard` and its shared copy, `/rankedcard`, the `/challenge` board and VS card, the Trainer encounter card, the `/battle` VS card, the private EXP card after a battle, and the catch and broadcast cards. A card is an animated GIF when anything on it moves, and every trainer and Pokémon on it stands on a dithered pixel floor. Cards and battle images render on worker threads (`utils/render/renderPool.js`). `RENDER_THREADS` sets how many, 3 by default, and `0` renders on the main thread with at most 2 GIF cards at once (`utils/render/stage.js`). A card waits up to 2 seconds for a free thread and then goes out as a PNG, as does a card that fails as a GIF. If the threads can't start, everything renders on the main thread. A card that can't render at all falls back to the old embed or text. The layouts are in `docs/design/COMMAND-CARDS.md`.

`/trainercard` answers privately, with a Luck row only the player sees and a Share to channel button that posts a public copy without it. `/showcard` posts the public card directly, and `/luck` opens `/trainercard`. `/pokedex name:` privately opens a species' Entry, Your stats, and Shiny pages, with autocomplete and a "Did you mean" for typos (`utils/pokemonSearch.js`). `/inspecttrainer` privately shows a trainer sprite's tier, whether the player owns it, and how many players do. The dashboard's Trainers page replaced `/showtrainers`.

Every Pokémon sprite moves. Most are Black/White-style animated GIFs. Of the sprites that had only a still frame, 202 (139 species and 63 Megas) now use reviewed community animations, recorded in `data/sprites/animated-imports.json`, imported by `tools/import-animated-sprites.mjs`, and credited on `/credits`. With `POKEMON_LOOP_FIT` on (the default), each sprite plays its whole cycle, up to 8 seconds, and a card fits one loop to all its sprites, so nothing jumps mid-motion when the GIF wraps. `/showcase` fits its loop the same way, and a card with only one moving sprite, like a shiny catch card, can loop for up to 12 seconds (`SINGLE_CLOCK_CAP_MS`) so it never jumps. A battle replay's images carry the sprites' timing from one update to the next (`utils/render/spriteLoops.js`).

The other 32 still sprites (24 species and 8 Megas) have an idle baked into their GIF by `node tools/generate-pokemon-idles.mjs`, which has no npm script (`--check` verifies the GIFs are current without writing). The rig in `utils/spriteRig.js` gives each Pokémon a seeded performance: the body squats up to 3 px, the head leans 1 px, ears or a crest follow a beat later, and it blinks during a rest wherever `data/sprites/pokemon-blinks.json` lists its eyes. It only moves the sprite's own pixels, never cuts across a face, and moves the normal, shiny, and grayscale sprites in step. A sprite whose cut would show stays still until `data/sprites/pokemon-idle-review.json` approves it. Run the tool after `import:sprites` or `import:mega-sprites`.

171 trainer sprites use real animations: 163 from the games (Black 2 and White 2 preferred) and 8 artist-made Paldea Gym Leaders, listed in `data/sprites/trainer-animations.json` and imported by `tools/import-trainer-animations.mjs`. Every other trainer sprite has a generated idle GIF in `public/sprites/trainers_idle/`, built by `npm run generate:trainer-idles` from the poses in `data/sprites/trainer-idles.json` and the blinks and other part motions in `data/sprites/trainer-parts.json`. `node tools/detect-trainer-parts.mjs <out.json>` (`npm run detect:trainer-parts`) only proposes part motions to review by eye and never writes that file. The generated sprites are checked in. Trainers animate in embeds, on the dashboard's Trainers page (unowned ones in grayscale), on `/trainercard`, the `/leaderboard` podium, the challenge, encounter, and VS cards, and in battle rows. Shiny Pokémon get a backdrop of gold motes and stars. A player's Aura, by default their Epic, Legendary, or Mythic trainer's Tier backdrop (the tier's sky with rising motes, plus a glow and twinkles from Legendary up, and meteors for Mythic), fills their part of `/trainercard`, the ranked card, the VS, challenge, and encounter cards, and their battle rows (`utils/render/trainerBackdrop.js`). The trainer animation design is in `docs/design/TRAINER-ANIMATION.md`.

Set any of these to `0` to turn animation off:

- `CARDS_ANIMATED`: every card is a PNG.
- `SHOWTEAM_ANIMATED` or `CATCH_ANIMATED`: only `/showcase`, or only the catch cards.
- `TRAINERS_ANIMATED`: trainers stay still everywhere.
- `SHINY_FX`: no shiny backdrop.
- `CARD_TRAINER_FX`: the challenge, encounter, and `/battle` VS cards and the battle rows lose their Tier backdrops and idle trainers, and `/battle` opens without its VS card.
- `POKEMON_LOOP_FIT`: sprites go back to a fixed 2.4-second loop, and each replay image starts its sprites over.

## Trainer sprites

`trainerSprites.json` (copied to `public/trainerSprites.json`) lists every trainer sprite by group, with a Tier that sets its shop price (`TRAINER_COSTS` in `utils/trainerCosts.js`). The 2026-11-10 trainer re-tier set each Tier by the character's role in the games, from generic classes at Common or Uncommon up to Red and Blue at Mythic. A sprite moved up to Epic or above without a real animation blinks only after its eyes are added to `data/sprites/trainer-parts.json` by hand. The trainer consolidation folded 367 redrawn versions of the same outfit from different games into 149 kept sprites (`data/sprites/trainer-consolidation.json`, applied by `tools/apply-trainer-consolidation.mjs`), which leaves 905 to collect. A player who owned a folded sprite got the kept one instead, with a one-time notice and no refund, and a displayed folded sprite became the kept one (`services/trainerConsolidation.js`). Folded files stay on disk, disabled with `mergedInto`, so old links still load. A group whose sprites are all disabled is skipped, so nothing can roll or grant it. The trainer artists on `/credits` come from `data/sprites/trainer-credits.json`, which `node tools/import-trainer-credits.mjs <index.php>` rebuilds from Pokémon Showdown's trainer sprite credits. Unowned trainers show in grayscale from `public/sprites/trainers_2/grayscale/`, which `pwsh tools/grayscale-trainer-sprites.ps1` builds with ImageMagick (`-Force` rebuilds every file).

## Admin dashboard

`/admindashboard`, for members with the `ADMIN_ROLE_NAME` role, privately links to the admin dashboard. Its tabs are Overview, Players, Grants, Admin changes, Live events, and Activity log, and a player's page has Summary, Pokémon, Items, Trainers, Auras, Cooldowns, and History tabs. Every Admin change shows its before and after for review and is written to `admin-audit.ndjson` in `TRAINERDATA_DIR`. Admins can:

- add or remove CC, TP, items, Pokémon, trainers, and Auras. A species row opens into its Copies, each with Set Lv and Remove;
- reset cooldowns: the daily, the Weekly Pack, and the battle cap (the tab still lists Quest and Recruit, left from the removed `/quest` and `/recruit`);
- reset a player, which wipes everything once the admin types the player's name, and is refused while the player has a wager offer open;
- send Grants, which are adds and cooldown resets only, to ticked players or everyone a filter matches. A Grant is safe to retry.

Any item kept in the bag can be granted, including ones players can't get yet (TMs, Mega Stones and Shards, held items), with a warning that it waits in their bag. Poké Balls and one-time purchases can't be. Any Aura can be granted, a retired or art-less one with a warning, and an Aura that a challenge win, an achievement, or an owned trainer earned can't be removed, since it would come back. Changes need the admin's Discord session, and `ADMIN_DASH_TOKEN` only reads the API. The design is in `docs/design/admin-dashboard-overhaul.md`.

## Player data

The bot keeps player data in memory, writes a local snapshot to `TRAINERDATA_DIR`, and posts a backup to the storage channel every 5 minutes when something changed, on shutdown, and on `/adminsave`. It downloads each backup again to check it. At startup it loads the newest valid copy, and if that copy has fewer than 80% of the players of the largest one, it loads nothing and waits. Each process takes a writer epoch higher than any it has seen. A process that finds a backup with a higher epoch stops writing and reports `superseded` on `/readyz`, so only the newest process writes. Production keeps the snapshot on a Fly volume with `LOCAL_IS_DURABLE=1`. How startup picks a copy, the `/readyz` fields, restoring a backup (`RESTORE_FROM`, `CONFIRM_RESTORE`), and the overrides `ALLOW_LOCAL_ONLY` and `ALLOW_PLAYER_COUNT_DROP` are in [`RUNBOOK.md`](RUNBOOK.md). Every push to `master` deploys to production. Besides the snapshot, `TRAINERDATA_DIR` holds `events.ndjson` (the Activity log), `fight-records.ndjson` (see [Battle Records](#battle-records)), `live-events.json`, `admin-audit.ndjson`, and `pokedex-backfill-state.json`.

## Setup

### Prerequisites

- Node.js **22.x** (see `engines` in `package.json`)
- A Discord account with permission to create applications and manage a test server

### 1. Clone and install

```bash
git clone <repo-url>
cd Poke-discord-bot
npm install
```

### 2. Create the Discord application + bot

1. Go to <https://discord.com/developers/applications> and click **New Application**.
2. **General Information** → copy **Application ID** → this is your `CLIENT_ID`.
3. Left sidebar → **Bot** → **Reset Token** → copy the token immediately (it's only shown once) → this is your `BOT_TOKEN`. Treat it like a password.
4. Still on the **Bot** page, scroll to **Privileged Gateway Intents** and enable:
   - Server Members Intent
   - Message Content Intent

### 3. Invite the bot to your test server

1. **OAuth2 → URL Generator**.
2. Scopes: check `bot` and `applications.commands`.
3. Bot permissions: at minimum `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Use Slash Commands`, `Manage Roles` (the bot assigns rank roles).
4. Open the generated URL in a browser, pick your test server, authorize.

### 4. Collect Discord IDs

Enable Developer Mode in Discord: **User Settings → Advanced → Developer Mode**.

- `GUILD_ID` — right-click the server icon → **Copy Server ID**.
- `STORAGE_CHANNEL_ID` — create a **private** text channel (only admins + the bot can view; it stores a full player data backup every 5 minutes when something changed). Right-click it → **Copy Channel ID**. Make sure the bot has `View Channel`, `Send Messages`, `Attach Files`, and `Read Message History` there.

### 5. Configure `.env`

Create a `.env` file in the project root:

```bash
# Discord
BOT_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id
GUILD_ID=your_test_server_id
STORAGE_CHANNEL_ID=your_private_backup_channel_id

# Runtime
NODE_ENV=development
PORT=3000
REGISTER_COMMANDS=true     # set true on first run; flip to false afterwards to skip re-registration
CHALLENGE_CHANNEL_ID=      # optional: the only channel /challenge works in (unset: any channel)
CASUAL_BATTLE_CHANNEL_ID=  # optional: the only channel casual /battle works in (unset: any channel)
REWARD_CHANNEL_ID=         # optional: gets every catch broadcast (they also post where they happened)
RARE_SIGHTINGS_CHANNEL_ID= # optional: also gets the Rare-and-up and shiny ones
ADMIN_ROLE_NAME=Developer  # the role allowed to use /admindashboard (default: Developer)
ADMIN_DASH_TOKEN=          # optional: a shared secret for read-only access to the admin dashboard's API
```

The feature switches are with their features: [Held items](#held-items), [TMs](#tms), [Full sim and Battle plans](#full-sim-and-battle-plans), [Mega Evolution](#mega-evolution), [Cards and animated sprites](#cards-and-animated-sprites) (including `RENDER_THREADS`), and `POKEDEX_SCAN` under [Collection and Pokédex](#collection-and-pokédex).

#### Optional — production-only

```bash
PUBLIC_URL=https://bot.example.com   # base for dashboard links and embed images (defaults to https://$FLY_APP_NAME.fly.dev on Fly, else https://bot.coopscollection.com)
                                     # RENDER_EXTERNAL_URL still works as an older name for it, except for onrender.com addresses
POKEMON_GENERATIONS=                 # Gens 6–9 to release, e.g. 7 or 6-9 (default: none; Gens 1–5 are always on)
TRAINERDATA_DIR=/srv/pokebot/data                  # persistent data directory (production VPS; see RUNBOOK.md)
LOCAL_IS_DURABLE=1                                  # TRAINERDATA_DIR is a mounted volume; see RUNBOOK.md
```

### 6. Run it

```bash
npm start
```

On first run with `REGISTER_COMMANDS=true`, slash commands register to your `GUILD_ID` (instant). After that, set `REGISTER_COMMANDS=false` to avoid re-registering on every boot. Set it to `true` again for one run whenever a command's name, options, or permissions change.

### 7. Verify

In your test server, run `/dashboard` — the bot should reply with an ephemeral link to the player dashboard.

### 8. Pick the challenge channel (optional)

`/challenge` works only in the channel `CHALLENGE_CHANNEL_ID` names, or in any channel when it's unset. Right-click the channel → **Copy Channel ID** and add it to `.env`. For production, set it in `fly.toml` under `[env]`, where it's commented out until a channel is chosen.

Casual battles work the same way with `CASUAL_BATTLE_CHANNEL_ID`: set, casual battles and Rematch requests happen only in that channel, and a casual `/battle` anywhere else privately points the player there. Ranked and wager battles still work in any channel. In production both go in `/etc/pokebot.env`, followed by `sudo systemctl restart pokebot`.

## Generations 6–9

All 1,025 species are in the data, but only Gens 1–5 can be obtained unless `POKEMON_GENERATIONS` releases more (see `config/generations.js`). A configured generation that fails validation stays off. Owned Pokémon are never removed by switching a generation off. Gen 6–9 Pokémon evolve on Evolution Stones alone, like Gens 1–5, with no Level requirement, once the generation they evolve into is released. Sprites: Black/White-style animated GIFs where they exist, otherwise static Black/White-style pixel art with a generated idle (see [Cards and animated sprites](#cards-and-animated-sprites)), never 3D renders; credits for Pokémon and trainer sprites at `/credits`. Data pipeline and release process: `docs/gen6-9/README.md`.

A species' Tier measures how collectible it is, not how strong it is in battle. The 2026-11-11 Pokémon re-tier changed 39 species, 15 of them in Gens 1–5, through `data/pokedex/tier-overrides.json`, which `generate:pokedex` applies last. It stops if a species' tier underneath isn't the one an override expects, or if an override would put an evolution a tier below the form it evolves from. The decisions are in `docs/audits/pokemon-tiers/DECISIONS.md`.

```bash
npm run generate:pokedex      # pokemonData.json (+ public copy), data/pokedex/forms.json, tier overrides applied last
npm run generate:battle-data  # battleData.json
npm run import:sprites        # sprites + data/sprites/sprites.json (verifies audited SHA-1s)
npm run generate:credits      # public/credits/index.html, from data/sprites/sprites.json and trainer-credits.json
npm run validate:catalog      # release gate (add a generation number to check one)
npm run report:balance        # docs/gen6-9/BALANCE-DATA.md
npm run check:tier-rule       # how closely the Gen 6+ tier rule matches the Gen 1–5 tiers
```

## Tests

```bash
npm run test:safe         # every tests/*.test.js, in a fresh temp data folder
npm test                  # the same, but TRAINERDATA_DIR must name a writable folder outside the repo
```

`npm test` runs every `tests/*.test.js`. The battle tests cover the generated data (`battleData`), the sim, including priority, multi-hit, drain, recoil, crash damage, recoil knockouts, Pokémon starting a fight damaged or fainted, and the stat boost (`battleSim`), Levels per Copy, Catch level rolls, and no EXP from a duplicate catch (`training`), EXP, the 2-month leveling pace, Elo, and caps (`battleRewards`), whole battles, playback, the rating embed and EXP summary, the replay line, casual, ranked, and wager battles and ranked seasons, the full Ranked team rule (5 of 6 refused for either player, an unowned slot not counting, casual battles unaffected), the Wager gate (account age and Pokédex), casual battles past the daily Battle cap, which earn no EXP and use no battle while ranked and wager battles stay refused, the 4th casual battle against one Defender, which runs only as an accepted Rematch request, earns no EXP and lifts the Defender's block on the Challenger, and the Underdog surge in casual battles only (`runBattle`), Stakes (`wager`), Rematch request bookkeeping: one open request per Defender, settling by nonce, the rest-of-the-day block and what lifts it, and closing every request at startup (`rematch`), the `/battle` command, the casual battle channel, wager buttons, who gets a private EXP message, the no-EXP reply past the daily Battle cap, Rematch requests (posting, Accept with no EXP card, Decline, expiry, the block and the Defender's `/battle` or Wager offer lifting it, a deleted message, a failed post, an emptied Team, one open request per Defender, two quick `/battle`s at 2 of 3, and a full-sim fight that fails), the `ranked` option, wagers on full Ranked teams, each player's trainer in the replay, and `/battle` answering before its replay ends, driven with stub Discord objects (`battleCommand`), `/leaderboard` and its season's ranked records (`leaderboard`), turn narration and how it wraps, the animated frames, the attacker's own HP changing, decoding sprites as they play, colors that only appear late in an image, rendering without stalling the bot, each player's trainer portrait, and the challenge styling: the type tint, the Badge between the rows, and the award screen (`battleRender`), `/inspectpokemon` text (`levelDisplay`), and Underdog win rates over 24,000 simulated battles (`battleBalance`), the Cuteness scores (every species and Mega form, two clusters, only a handful of 10s), a Team's Cuteness, today's surge unchanged seed for seed for Teams averaging 5 or less, the cute surge's chance, its curve, and its lift past Lv 100, EXP at the surged Levels, the cute heading, casual battles only, and no page, route, or command reading the scores (`cuteness`), and the cute surge's measured win rates against six mythics for a Team averaging 10 and a Team of the cutest Pokémon at the same Level, across a Level gap, and as a Team of one, and for a typical cute Team, the share of random Teams that are cute, and the EXP from a cute win (`cutenessBalance`). The Team tests cover the mythic and Mega limits, which Copies count as on a Team, and bulk donation refusing a Ranked team Copy (`battleTeam`), which moves a Pokémon can pick, each Team's own moves in battle, the moves `/inspectpokemon` shows, and a level-up never equipping a newly learned move, with only a Team on automatic moves pinned (`movesets`), and the `/rankedcard` image (`battleCard`). They also cover:

- `showcaseTeam`: the Showcase filled once from the Casual team at launch and never refilled once emptied, repeats as separate Copies (a slot with no Copy left is dropped), Showcase Copies counting as on a Team, dashboard saves (a named Copy kept, no Copy left, one Copy in two slots, unowned, over 6, empty allowed, a malformed Mega), and the load path.
- `twoCopiesTeam`: the Casual and Ranked teams holding each Pokémon once while the Showcase takes repeats, the slot's Copy being the one that fights, and held items belonging to the Copy in the slot, including an older per-line item moved onto it.
- `teamCopy`: Copy from requests (no source, duplicates dropped, onto itself, an unknown source) and moves following only the Pokémon copied.
- `copyMovesets`: learnable moves following each Copy's own Level, a separate Moveset per Copy, and battles using the slot's Copy for its Level and moves.
- `movesetSaveRoute`: saving moves for a box Copy on the Casual and Ranked teams, clearing back to automatic moves, refusing an unknown or wrong-species Copy, repairing a stale slot at load, and the route going through `saveMoveset`.

The full-sim tests cover:

- `fullSimEngine`: seeded determinism, the stat multiplier on every stat (HP included), the 80–100% damage roll, 1-in-12 crits and ×2 crit damage, the turn cap, slot-order switching after a U-turn and a faint, and a refused choice falling back to the engine's default.
- `fullSimResult`: the result in today's shape plus steps, the raw log and end status; knockout credit for poison and recoil; hazard and status steps; carried HP and status; a side with nobody left; held items by name, Lucky Egg as no item, and Megas as their Showdown forme.
- `fullSimData`: the switch, `battleData.json` byte-for-byte unchanged, Gen 9 stats and status moves in `full-sim-data.json`, latest-game learnsets, regular abilities, and attacks-only default moves.
- `battlePlans` and `battleAi`: move roles, readiness, plan-picked abilities, the damage estimate (which never draws from the battle's random numbers), one scenario per plan, and the three skill levels.
- `simPool`: the worker's result equals the inline one, the switch-off path stays synchronous, a Battle under the switch, an Elite Four run keeping its engine after the switch flips, and HP and status carry-over.
- `fightRecordsV2`: v2 results keep steps and the raw log (gzipped when large), the list stays light, v1 results are unchanged, a Battle, Challenge or encounter record names each player's plan, and a record never shows the other side's plan.
- `fullSimLazyLoad`: with the switch off, importing every module `bot_final.js` imports and every command loads no `@pkmn/sim` and never reads `full-sim-data.json`.
- `fullSimFlip`: each engine reads its own data whatever the switch says, and an Elite Four run that started on today's engine finishes on it after the switch turns on, with a Fight record that replays every fight.
- `fightFailure`, plus a section each in `battleCommand`, `encounterFlow` and `challengeCommand`: a fight the sim fails leaves nothing half done. The Elite Four run isn't left open and spends no attempt, a failed fight mid-run can be played again, one run that can't finish at startup doesn't stop the others, a wager returns both Stakes, an encounter card stays open, and `/challenge` tells the player what happened and how the run finishes.
- `fullSimReplay`: narration of status, hazards, weather and boosts, who is in front after a U-turn (Discord and browser), and the update count.
- `battlePlansService`, `battlePlansApi` and `teamsPlans`: plans per Team, readiness with how to get the plan's move, suggestions, the dashboard endpoints (sessions, the lock, refusals, the switch), the Teams page row, `/inspectpokemon`'s ability, and the cutover keeping every Team member's moves (on both Teams, for players who join later, on every screen, and through a level-up that teaches a move). `tmTeaching` checks that a TM teach keeps the recorded moves.
- `opponentPlans` and `statusTmDraft`: every Challenge opponent and Trainer class has a plan and skill, their plan picks their moves, and the drafted status TMs.
- `fullSimBalance`: the Underdog targets and battle length on the full sim.
- `fullSimCutenessBalance`, `fullSimChallengeBalance` and `fullSimEncounterBalance`, the `tests/*.slow.js` files: the cute surge, Challenge and Trainer encounter targets on the full sim. They take an hour or more together, so `npm test` skips them; run `npm run test:full-sim-balance` after tuning the full sim and before turning it on. Each is generated from `cutenessBalance`, `challengeBalance` or `encounterBalance`, so keep each pair in step. `run-tests.js` never passes `FULL_SIM_ENABLED` to a test, so every other suite covers today's engines.

The challenge tests cover:

- `challengeRoster`: the 14 teams and their Levels, the prize table, the leaders' sprites, the Badges and their 128×128 images, the Badge image URLs, and the Badge line in `/trainercard`'s text fallback.
- `runChallenge`: the picked Casual or Ranked team fighting at real Levels (a player with only a Ranked team can challenge with it), unlocks, the hidden stat boost on every opponent (never the player's Team, and Levels unchanged), the 5-a-day cap and its reset at midnight UTC, Elite Four HP carried between fights, Revives in the sim, EXP summed per run with Levels fixed, first-win prizes and the sprite fallback, prizes going through the trainer and inventory services, achievements for prize sprites and Levels, the 10% loss and its cap at the previewed amount, and no Underdog surge. It also covers the interactive run saved on the record: one fight per step, stale or repeated steps, a record replaced or a Team member given away mid-run, finishing open runs, the event log entry, the dashboard never receiving an open run, and the Collection page getting the challenges won for its Badge row. With a Mega on the Team, the run saves no Mega battle stats on the record, plays the same after a reload between fights, fights as the base form once Mega battles are off, and loses a fight it starts with every Pokémon fainted at turn 0, including after a restart.
- `challengeCard`: the VS card's facts for a Gym, a rematch, the Elite Four, Blue, and Red, its alt text, that it never carries the loss amount or balance, the prize wrapping onto two lines, and where the trainers, Badges, and medallion are drawn.
- `challengeBoard`: the board image's Gyms, Badges, attempts left, each League stage locked, open, or cleared, its alt text, and that locked opponents are dark silhouettes.
- `challengePlayback`: the result embed (only what the image doesn't say, with no EXP or Badge thumbnail, and none after a rematch win), each fight's styling and the first-win award (none for a rematch or a loss), the Elite Four run replaying one fight at a time on one message with the replay slot free between fights, the Revive in each header, the "choosing" line and the result-only edit, no leader as a mention, and no exact loss in public.
- `challengeCommand`: `/challenge` driven with stub Discord objects, covering the board image, its fallback embed and its dropdown, the challenge channel, every refusal, the VS card preview (acknowledged privately before the card renders) and its fallback embed, the Fight with Casual and Fight with Ranked buttons, the public card showing the Badge still on the line, the player's trainer in the replay, the private result with the EXP card (and its text fallback), Not now, expiry, Fight, a double click, changes to the player's record, Team, or wagers between the preview and the click, and the private result arriving after the replay. For the Elite Four run it covers the Revive menu, a pick, the 60-second deadline, late and repeated clicks, a menu that can't be sent, refusals while a run is open, a run that stopped unexpectedly, and a run still playing that is left alone.
- `challengeBalance`: the Level at which stand-in Teams beat each challenge half the time, with a stand-in player who revives their strongest fainted Pokémon, enforcing Giovanni < Elite Four run < Blue < Red, and printing the run's gate with no Revives, win-rate curves, a one-Pokémon Team, and leveling pace with 5 challenges a day.

The Trainer encounter tests cover:

- `encounterRoster`: the tuning values, the 35 Trainer classes (never a `/challenge` opponent, every sprite present, the Prize money bases, type themes), the names, and the lines (every class has a set, no dashes or curly quotes, each fits the text box).
- `encounterGenerate`: tier shares and Level bands around the Team's mean Level, the Level floor and cap, 3 to 6 Pokémon weakest to strongest, Ace Trainers only among the strongest, the 3% surprise, no legendary lines on regular teams, forms that fit their Level, type themes, species for every class at every Level, Prize money, the hinting lines, and seeds.
- `runEncounter`: the encounter record and its day reset, who can be spotted (no Casual or Ranked team, an open run, a pending wager, one at a time, the 30-minute gap, 8 a day), and the fight: Prize money both ways, paying at most the balance, EXP on a loss, the picked Team minus Pokémon given up, fighting with its chosen moves, held items, and Mega, re-checks at the click, and no change to Battles or challenges.
- `encounterCard`: the card's facts, no Levels, alt text, the "!" bitmap and where it sits, and where the trainers, text box, and Prize money are drawn.
- `encounterFlow`: the replay on the card and its result embed, then the service with stub Discord objects: the permission check before the roll, a miss, a posted card, a failed post, simultaneous hits, no Team, the embed fallback, someone else's click, Run, no answer, Battle! (or Battle with Casual and Battle with Ranked) with the EXP card alone in its private message and the card shrinking to its result 10 seconds later, a replay that can't play, a double click racing the timeout, a refused Battle, and a click after a restart, and the card's Mega fighting as a Mega.
- `startupReadiness`: an encounter rolls only after a message whose catch roll missed, never before player data loads, and a failed roll is logged.
- `encounterBalance`: prints win rates by tier for Team sizes 1 to 6 over 400 fights per case, a Lv 100 carrying five Lv 5s, CC per encounter, and leveling pace with 8 a day, enforcing Under >= Even >= Over.

The Mega Evolution tests cover:

- `megaSafety`: every switch off by default, no tie to the generation releases, Mega Stones and Shards only in the Mega shop and the shard drops and only while the rewards switch is on, admin grants going through the admin path, 70 forms battling with Gens 1–5 released, and Mega code used only where it's needed.
- `megaShards`: everything off selling, granting, and rolling nothing, the shop matching the forms that can battle (70 stones, 80 with Gen 6, 90 with every generation, at 25 or 50 shards), CC shards at 1,000 each with the 25-a-week limit and its Monday reset, buying a stone and unlocking its Mega, the `/daily` 25% and battle-win 10% rolls with the 2-a-day cap, battle results unchanged by the roll and Defenders earning nothing, the EXP message's line, and the API's switches and replay safety.
- `megaCatalog`: the forms, the stones, the special cases, and the ability list.
- `megaUnlock`: using a Mega Stone, the switches, repeated and simultaneous requests, and recovering from a crash through the real save queue.
- `megaPersistence`: the unlock records, and player records from before Megas.
- `megaCardsTeam`: Mega cards, the Team rules, and where a Mega starts fighting, with Teams without a Mega unchanged.
- `megaAbilities`: every implemented ability and the effects engine, with scripted random rolls.
- `megaBattle`: battles through the real code path, falling back to the base form whenever a Mega doesn't qualify, EXP, images, and a side that starts with every Pokémon fainted losing at turn 0 on both engines.
- `megaBattleRegression`: 3,000 battles without a Mega match `tests/fixtures/battle-corpus-pre-m2.json`, which `tools/dev/battle-corpus.mjs` recorded from the engine before Megas, with the switches off and all on. The 515 battles with a cute Team are exempt, since the cute surge changes them by design (`cuteness` covers it), so 2,485 must match exactly.
- `megaPresentation`: every card and screen shows the same form.
- `megaSprites`: the sprite files, their hashes, and that they're 2D pixel art.

The dashboard and card tests cover:

- `dashboardFoundation`: the pages and navigation, and that the dashboard's Pokémon names and search match the bot's.
- `gameplayRoutes`: the dashboard's catch, evolve, convert, and Weekly Pack handlers, including an evolution target that isn't one and a Team Copy evolving in its slots.
- `pokemonDetail`: the Collection page's detail panel matches the Discord cards and changes nothing.
- `pokemonPower`: the dashboard's per-Pokémon Power adds up to the cards' Team Power.
- `spriteFx`: the dashboard's shiny and trainer backdrops match the Discord cards pixel for pixel.
- `commandCards`: the EXP, leaderboard, daily, trainer, Pokédex, and inspect cards, what they show, their fallbacks, and that they change nothing.
- `catchMessage`: the catch and broadcast cards, the GIF limit, the animation switches, and the embed fallback.
- `showteamRender` and `showteamCommand`: the `/showcase` layout and `/showteam` as its alias, its controls and who may use them, the GIF limit and PNG fallbacks, the Manage link, the inspect card, and `/showcase` looping on whole sprite cycles.
- `pokemonFx`: the rig idle (squash, head lean, ear drag, blink) on the 32 sprites without an animation (64 files with their shinies) and no other, and that only shinies get the backdrop, it stays clear of the Pokémon, and `SHINY_FX=0` turns it off.
- `trainerIdle`: trainer poses, the idle GIFs and their manifest being current, part motions, trainer image URLs, the tier backdrop, and the rendered cards.
- `pokemonSearch`: `/pokedex` autocomplete (owned first, at most 25 choices, Discord-length names, number matches, punctuation ignored) and typo matching (opening a clear winner, Did you mean, nothing close).
- `cardImage`: card file names (plain for a card posted once, a new name for each replacement, PNGs too) and the one-line timing log.
- `cardTrainerFx`: tier lookup and `CARD_TRAINER_FX=0`, backdrops staying clear of a card's content, VS records read before the battle and never created, the `/battle` VS card (PNG by default, a GIF when animated, smaller with effects off), challenge cards staying PNG with effects off, battle rows, and the VS card opening the replay and holding for whole loops.
- `animatedImports`: the 202 imported Pokémon animations (each with its animator, source, license, and shiny method), files matching their recorded hashes, normal and shiny moving together, the rig leaving imported sprites alone, and every animator credited on `/credits`.
- `trainerAnimations`: the 171 real trainer animations (8 artist-made with source and permission, 163 from the games), matching GIF, still, and grayscale files, the idle manifest and image URLs (with `TRAINERS_ANIMATED=0` and grayscale), `generate-trainer-idles --check`, and card poses following the real frames.
- `trainerConsolidation`: the 367 folds into 149 kept sprites (no chains, no outfits, no female into male, every folded file disabled with `mergedInto`), Weird Light, 905 trainers offered, `apply-trainer-consolidation --check`, and the player migration (the grant, the displayed trainer, one notice, a second pass changing nothing).

The rendering tests cover:

- `renderPool`: `RENDER_THREADS` (3 by default, none for 0 or a bad value, at most 16), job order and priority, a card's 2-second wait and then its PNG, a crashed thread replaced, a pool that can't start falling back to the main thread, arguments that can't go to a thread, a thread drawing the same image as the main thread, and the loop-lag summary.
- `gifEncoder`: changed-rectangle GIFs decoding frame for frame and delay for delay like full frames, unchanged frames, corner pixels, rectangles past 255 px, colors sharing a palette entry, single-frame GIFs, and the card GIF's frame count, delay, and looping.
- `spriteLoops`: each sprite's loop (its whole cycle, cached), one loop fitted to several sprites (2.4-second multiples with a trainer, speed nudges, a 50 ms grid), the union-box anchor on the floor, fitted card GIFs and the 8 MB fallback, the replay clock carrying across updates, a lone sprite on a card fitting up to 12 seconds while battle images keep 7.2, and `POKEMON_LOOP_FIT=0` bringing back the old loops.
- `softPlatformCache`: the cached floor matching the cell-by-cell drawing pixel for pixel at whole and fractional positions, for each tint and grid, and a scaled or fractionally moved canvas drawing the cells directly.

The achievement, item, and catalogue tests cover:

- `achievements` and `achievementsExpansion`: the catalog and its categories, progress, achievements recognized after the fact, reward claims (once only, all or nothing, a failed save, a restart), hidden entries, and battle achievements counting ranked and wager battles only.
- `achievementsBench`: prints the cost of achievements for 3,000 synthetic players.
- `inventory` and `inventoryRegression`: the item catalog and inventory service, locked changes, `/inventory`, the Bag page's data, and `/daily` giving exactly what it gave before.
- `chatLog`: chat CC logged to the event log, and 500 messages in a day all paying (chat has no daily cap, only its cooldown).
- `assets`: trainer ownership kept as an array through saves, loads, and repairs, the gift helpers and their two-user lock, save acknowledgment, and the report-only audit.
- `catalog`: every trainer Tier is a known one, the public copy matches, each sprite file is in one group, and a group whose sprites are all disabled is skipped.
- `gen69Catalog`, `gen69Display`, `gen69Generations`, `gen69Achievements`, and `gen69Balance`: Generations 6–9 in the catalogue and sprites, in battles and cards, behind the release switches on every way to get a Pokémon, in achievements, and in the catch odds.
- `regions`: region grouping and Pokédex completion counts.
- `pokemonRetier`: the 2026-11-11 Pokémon re-tier, with the approved tier overrides live in `pokemonData.json`, the override guards, the Ranked team mythic trim, and its one-time notice reaching the player once.

The Collection and Pokédex tests cover:

- `box`: player records moving to one Copy per Pokémon (Team and Trained Copies keeping the shared Level, others re-rolling at most that), each catch rolling its own Catch level, NEW and NEW SHINY, the Pokédex never dropping and the backfill merge, Feed (Teams, Variants, a Trained copy's confirmation, the EXP gain), which Copy goes first when one is removed, evolving a named Copy with its slots following and its Level kept, battle EXP going to the Copy that fought, gifts keeping Level and catch date, and counts an older release changed being reconciled.
- `dexBackfill`: reading species and shinies from backups (form keys ignored, old name lists skipped), a full scan that skips a broken backup and creates no Copies, stopping and resuming from the saved cursor, a finished scan never running again, and Pokédex achievements unlocking while the "at the same time" ones don't.
- `ownership`: plain Copies removed first and nothing removed when in doubt, Trained copies only when named and confirmed, last-Copy cleanup, donations never taking a Trained copy, a repeated request donating once, only plain Copies gifted, evolution and shiny crafting moving one Copy with its TM moves, the admin wipe, and 12,000 random operations keeping every Copy and Trained-copy record.

The held item and TM tests cover:

- `heldItems`: the switches (off by default, the tester list, one part off), unlocks as one-of-each bag items, the icon files, the eight starters granted exactly once and never overwriting, equipment per Team and the Item Clause, Mega slots holding their Mega Stone, the load-time repair only removing assignments, a rollback keeping newer data, battle-time checks independent of what was stored, the dashboard API (sessions, switches, a replayed request, stale tabs, 5 simultaneous equips with one winner, purchases charged once, refusals when owned or short of CC), and the Activity log entries.
- `heldItemBattle`: the item registry matching the catalog, battles without items unchanged, Leftovers and Black Sludge, Sitrus Berry once per battle, Focus Sash and Focus Band, Bright Powder, Quick Claw's turn order, damage modifiers, Shell Bell, seeded battles with items, and in whole battles: the items fixed at the start, Casual and Ranked items kept apart, no change to Power, a Mega slot fighting without a regular item, Lucky Egg's EXP in the result, items never used up, and no items with the battle switch off.
- `tmData`: the 156 TMs for sale and 16 held back, every move real and damaging, banned moves absent, learner lists, Gen 5 TM numbers, compatibility spot checks (Charizard, Pikachu, Sylveon, and Magikarp, Ditto, and Unown learning nothing), the 16 species no TM fits, and `tm_<move>` item ids.
- `tmShop`: the TM items and which are sold, the price tiers, TM numbers in names, held-back TMs unobtainable, the Technical Machines bag category, `TM_ENABLED` and the weekly cap switch, the shop switched off, buying (CC charged once, quantity limits, refusals changing nothing), the weekly cap's reset, no counter created by browsing, a repeated request charging once, the buy dialog's list of the player's Pokémon that can learn a TM (Team members first), and the Shop page asking `/api/tm-shop`, a URL ad blockers leave alone.
- `tmSafetyUi`: removing exactly the named Trained copy, donating one only with the TM warning confirmed (a stale view, an unknown Copy, one request applied once), evolving and shiny crafting a chosen Trained copy with its moves kept, refusing before any Stones are spent, Donate Duplicates counting only untrained Copies, Multi-select blocking a lone Trained copy, and the dashboard's Trained summary.
- `customCopies`: players without Trained copies unaffected, the repair of Trained-copy records at load, Team slots naming a Copy (forged and wrong-Pokémon slots refused), per-Copy TM moves and Movesets, battles using the Copy's moves, and the detail panel listing Trained copies.
- `tmTeaching`: the switch off, the teach options (teachable, known, incompatible, held-back TMs hidden), teaching an untrained Copy (the TM spent once, slots moving to the new Copy, add, replace, or keep per Team), a second Trained copy, stale refusals keeping the TM, a move learned later by level-up taught early, with the Level it would be learned at for the dialog's warning, one request teaching once, Team saves keeping Trained copies, moves surviving evolution and shiny crafting, and the full sim keeping the cutover-recorded moves.

The Battle Records tests cover:

- `fightRecords`: the store (newest first, the three groups, a shared Battle in both histories, a restart, trimming to the newest 50, a torn last line, a forgotten player becoming "Former trainer"), records for casual, ranked, wager, Gym, Elite Four with Revives, and encounter fights, saving a record never throwing, and the API (403, 400, 404, the light list).
- `battleRecordsPage`: each player's view of a record, the summary (wins and losses, win rate, the top 3, the rating, the newest 20), replay steps and turn navigation, the Elite Four replay with HP carried over, move text, time-ago and item labels, damage per slot, and the player's own Battle plan on a row and in the replay.

The Aura and Live event tests cover:

- `auras`: the catalog (unique ids, the 25,000, 50,000, and 100,000 CC prices, one Aura per Gym Leader and Elite Four member, real achievements), Tier Auras stored and kept after a trainer is given away, the load backfill, Auras proved by challenge wins and achievements (a lost Elite Four run still keeps the members beaten), the Auto, None, and equip rules, no equipping without art or ownership and the fallback to Auto, the CC shop, admin grants and removals, and the art backdrop drawn end to end.
- `auraIntegration`: art Auras mirrored on the opponent's VS half, drawn without a tint on VS cards and battle playback, `back.png` anchored on the trainer's feet, the optional trainer lighting (validated, following the pose, mirrored), every sheet playing once per 2.4 seconds, and the loop closing.
- `liveEvents`: validation with no caps except Poké Ball discounts (over 30% refused, stacked and older events held to 30% when priced), donations ignoring the CC multiplier, overlapping multipliers, Catch boosts keeping each Tier's odds, Catch limits on real rolls, the paid-roll choice and its reset when a new catch event starts, a grayed-out ball charging no CC, limits that leave nothing refused, discounts and EXP by type, the odds preview, the admin store (create, edit, end, delete, the audit reason, reloading from the file), and the start and end posts (never twice, failed ones retried).

The player data and safety tests cover:

- `durability`: writer epochs, compact snapshots, verified Discord uploads, booting from the volume, the save circuit breaker, and two processes at once.
- `loader`, `snapshot`, and `localStore`: how startup chooses a copy, snapshot checks, and local snapshots, including what a crash can leave behind.
- `persistenceRestart`: simulated restarts with the real save code, which never load data older than the newest saved copy.
- `saveQueue`, `saveQueueFailure`, `saveQueueRetry`, `saveQueuePrompt`, and `atomicWrite`: queued saves, awaited dashboard saves written within milliseconds (one write for simultaneous saves, never skipping a retry's backoff), retrying a failed write without leaving a lock held, and atomic file writes.
- `userInitializer`: repairing a player record in place without losing anything.
- `playerDataGuard`: no tracked file holds player data, and the Docker image leaves backups out.
- `mutationGuard`: data-integrity bugs fixed in `bot_final.js` stay fixed.
- `commandContract` and `commandsDiff`: every command takes the arguments `bot_final.js` passes, and a dry run of slash-command registration.
- `testRunnerGuard`: `run-tests.js` refuses to run unless `TRAINERDATA_DIR` is a writable folder outside the repo.

`tests/adminDashboard.test.js` covers the admin dashboard: every Admin change (CC, TP, items, Pokémon, trainers, Levels, cooldowns, reset), rejected over-removals, clearing Team slots when a last copy goes, bulk grants (filters, partial failure, retries), the audit file, grants of any item (Mega, TM, and held items, with stack limits) and any Aura (with locked removals), the catalog marking what isn't live yet, rolling player and admin sessions (the 10-minute unopened link, the 30-minute slide, the 4-hour cap), the read-only shared token, and the write guards on the admin API. `adminCopies` covers an admin's per-Copy controls: Set Level changing only that Copy, Remove taking one named Copy (a Trained one too, with its TM record), refusing an unknown or already-gone Copy, and the Pokédex keeping the species.

`tests/gift.test.js` covers gifting Pokémon: only normal copies move, the sender's last copy can't be gifted, no gift creates or destroys copies, and the sender's Level resets when their last normal goes.

`tests/bulkDonate.test.js` covers the bulk donation rules in `utils/bulkDonate.js`: Donate Duplicates keeping the best Copy and every Team Copy, which Pokémon Multi-select accepts, rejecting a list that changed after the player saw it, CC and Shiny Dust rewards against the weekly cap, and one Activity log entry per Copy.

`tests/bulkRules.test.js` covers `public/picker-pokemon/bulkRules.js`, which decides what the dashboard offers: the Donate Duplicates list (keeping the best Copy even when a lower one is on a Team, donating exactly the Copies left ticked, tied best Copies, and Team Copies left out for every Team), the reason each locked card can't be multi-selected, and the row showing in Donate mode. It also runs those lists through `utils/bulkDonate.js` to check that the server accepts every row the dashboard offers and refuses every locked card.

## Common gotchas

- **Slash commands missing** — confirm `CLIENT_ID` matches the application that owns `BOT_TOKEN`, and that the bot was invited with the `applications.commands` scope.
- **Bot online but ignores commands** — Privileged Gateway Intents weren't enabled on the Bot page.
- **Role-rank changes don't apply** — bot's role must be *above* the rank roles in the server's role list, and it needs `Manage Roles`.
- **Backups not appearing** — bot lacks `Attach Files` or `View Channel` in `STORAGE_CHANNEL_ID`.
- **Battles or challenges never show up** — the bot posts battles, wager offers, and challenges as new messages, so it needs `Send Messages` and `Attach Files` in the channel where `/battle` or `/challenge` runs.
- **Trainer encounters never happen in a channel** — a Trainer only spots players in channels where the bot can view, send messages, attach files, and embed links.
- **Sprites or Badges missing from embeds** — Discord fetches embed images from `PUBLIC_URL`, so it must be a public `https://` address serving this version (Badge images ship in `public/sprites/badges/`). Discord can't fetch `http://localhost:3000`. A `PUBLIC_URL` without `http://` or `https://` (like `localhost:3000`) makes discord.js reject every embed that has a sprite.
