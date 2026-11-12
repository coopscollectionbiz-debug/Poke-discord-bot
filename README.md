# Coop's Collection — Discord Bot

Discord bot for a Pokémon collector game. Built on `discord.js` v14 with an Express server for the player web dashboard.

## About

A Discord-native Pokémon collector game. Players earn points and ranks for chatting in the channels, and may randomly catch a Pokémon along the way. A companion web dashboard lets them manage their collection and spend points on catching pokemon or updating their trainer. The dashboard's Collection page groups the list by region in all four modes: Browse, Evolve, Donate, and Convert. Each region header shows the player's Pokédex completion for that region, such as "Kanto 75/151". The count always covers the whole region and ignores the page's filters. `CONTEXT.md` defines how Pokédex completion is counted.

In the dashboard's Donate mode, **Donate Duplicates** donates every copy past the first of each Pokémon and variant, and **Multi-select** donates several single copies at once. Both show a confirmation first and donate all or nothing. A Pokémon on either Team can't be donated one at a time, evolved, or converted to shiny in that Variant until the player takes it off the Team. Donate Duplicates still donates its extra copies.

Game terms (Tier, Stage, Variant, duplicate, Team, Ranked rating, and so on) are defined in [`CONTEXT.md`](CONTEXT.md).

## Dashboard

`/dashboard` replies privately with a link that signs the player in for 10 minutes and opens the Overview page. Every page shares one navigation bar (`public/shared/shell.js`), a sidebar on desktop and a tab bar on phones:

- **Overview** (`/public/overview`): both Teams, the ranked and casual records, rewards waiting to be claimed, and Pokédex completion per region. It changes nothing.
- **Collection** (`/public/picker-pokemon`): every Pokémon in the released regions, with the four modes above, a Shiny only filter, a normal/shiny flip on cards where the player owns both, the Badge row, and a detail panel with stats, each Team's moves, and the Team slots it fills. Teams aren't built here.
- **Teams** (`/public/teams`): the Display team and the Battle team, and each Pokémon's moves for that Team. See [Teams and moves](#teams-and-moves).
- **Trainers** (`/public/picker`): the trainer sprites, and which one the player displays.
- **Bag** (`/public/bag`): the player's items, read-only, the same list `/inventory` shows privately in Discord. Evolution Stones and Shiny Dust are spent in the Collection page's Evolve and Convert modes.
- **Achievements** (`/public/achievements`): see [Achievements](#achievements).
- **Shop** (`/public/dashboardshop`).

The sprite credits for Pokémon and trainer artists are at `/credits`, linked from the sidebar. Shiny Pokémon get the same gold backdrop as on the Discord cards (`public/shared/spriteFx.js`).

## Battles

Players battle each other's Teams in casual, ranked, or wager battles. The bot simulates the whole fight with Gen 5 stats, moves, and type matchups, then replays it in the channel turn by turn as animated images: each player's displayed trainer stands at the left of their row, the two Pokémon fighting are spotlit, HP bars drain, and a game-style text box narrates each move. Battles longer than 12 turns are spread over 12 updates. A final image shows who won, the MVP (the winner's Pokémon with the most knockouts), level-ups, and new moves, and an embed under it shows each player's Ranked rating change, or says a casual battle was unrated. When the replay ends, each player who earned EXP gets a message only they can see with each Pokémon's EXP gain. Discord allows these replies only within 15 minutes of a command, so a Challenger whose Wager was accepted near the end of the offer may not get theirs; the EXP still counts. At most 2 battles replay at once. When more start, each extra battle's message shows its place in line until its replay begins. The results count right away; only the replay waits.

Moves follow Gen 5 rules for priority, multi-hit, drain, recoil, and crash damage. Quick Attack goes first and Vital Throw goes last. Bullet Seed hits 2 to 5 times. Giga Drain heals the user half the damage it deals, and Double-Edge hurts the user as well as the target. A missed High Jump Kick costs the user half its max HP. A Pokémon that faints from its own recoil or crash counts as a knockout for the Pokémon it attacked. When both last Pokémon faint from one move, the side whose Pokémon fainted last wins. With recoil, that's the user's side, as in Gen 5. The sim has no abilities except Shedinja's Wonder Guard, and no items, status conditions, stat changes, or other move side effects. A battle with a Mega Evolution in it is the exception: it runs on a second engine, `utils/battle/effects.js`, that adds abilities, stat stages, weather, terrain, and burn (see [Mega Evolution](#mega-evolution), which is off by default).

- `/battle opponent:@user` starts a casual battle between both players' Display teams at their real Levels. It runs right away, costs nothing, and is unrated. It counts toward a separate casual record and the casual achievements. Only the Challenger earns EXP.
- `/battle opponent:@user ranked:True` starts a ranked battle between both players' Battle teams, with every Pokémon at Lv 50. It runs right away, and both players' Ranked ratings change. Only the Challenger earns EXP. Both players need a Battle team.
- `/battle opponent:@user wager:100` offers a Wager battle. Like a ranked battle, it uses Battle teams at Lv 50 and changes both ratings, and it puts CC on the line. The bot holds the Challenger's CC until the Defender accepts or declines, or for 15 minutes. A Defender with less CC than the Stake can accept with everything they have, and the Challenger gets the difference back. Both players earn EXP, and the winner takes the pot. If the Challenger's Battle team gets stronger before the Defender answers, Accept cancels the offer instead. A restart refunds any Stake still waiting for an answer.
- `/leaderboard` shows the top 10 Ranked ratings this season and your position. Casual battles don't count.
- `/showbattlecard` shows the player's Battle team at Lv 50 as an image, with their Ranked rating, record, and leaderboard position.

Each player can start 10 battles per UTC day in all modes together, and at most 3 against the same opponent. A Wager battle counts for both players. In a casual battle, when one Team is much stronger, the Underdog sometimes gets a surge that raises its Levels for that battle, so lopsided fights are rarely but not never upsets. Ranked and wager battles have no surge.

A cute Underdog gets a second chance. Every species and Mega form has a hand-written Cuteness score from 0 to 10 in `data/battle/cuteness.json`, and they're strict: Pokémon that aren't cute score 0 to 2, most cute ones score 6 or 7, and only 10 species score 10. A Team's Cuteness is its members' average, so a lone Pikachu counts as a fully cute Team. An Underdog averaging over 5 also rolls for a cute surge. Its chance climbs fastest just above 5 and reaches 42% at an average of 10 (`CUTE` in `utils/battle/tuning.js`). A cute surge lifts the Team until its Power is 1.5 times the other Team's, first by Level and then, past Lv 100, by raising its stats, with no cap. Against six mythics, a Team averaging 10 wins about 42% of the time, a Team of the cutest Pokémon (scored 9 or 10) about 37%, and a typical cute Team (scored 6 or 7) about 20%. After a cute surge the Team earns EXP as the Levels it was lifted to, so beating a far stronger Team pays like an even fight. When a cute Team surges, the heading reads "💖 The crowd can't resist @Ash's team! Underdog surge!". Teams averaging 5 or less surge exactly as before. The scores never leave the server: no page, route, or command reads them. The design is in [`docs/superpowers/specs/2026-11-11-cuteness-design.md`](docs/superpowers/specs/2026-11-11-cuteness-design.md).

Ranked ratings start at 1000 and belong to a season (`RANKED.season` in `utils/battle/tuning.js`). When the season number goes up, each player's record from the old season moves to their history, and they start again at 1000 and 0–0. Ranked battle achievements count wins from every season.

### Teams and moves

Each player has two Teams of 1 to 6 Pokémon in slot order, both set on the dashboard's Teams page:

- The **Display team** shows on `/showteam` and the trainer card, and fights casual battles, challenges, and Trainer encounters at its real Levels.
- The **Battle team** fights ranked and wager battles, where every Pokémon is Lv 50 (`RANKED.level`). It holds at most one mythic-tier Pokémon. Nothing fills it from the Display team except the page's Copy my Display team button. If a re-tier leaves a Battle team with more than one mythic, the bot keeps the first mythic in slot order when it starts and takes the rest off the team, which leaves them in the collection. The player gets a one-time notice (`services/notices.js`), a banner on the Teams page until dismissed or a private note after their next `/battle`, whichever comes first.

Each Pokémon can have up to 4 moves chosen for each Team, picked on the Teams page from the moves it has learned by level-up at its real Level. A Battle team Pokémon fighting at Lv 50 still knows only those. Without a choice, it uses the last four moves it learned. The `/inspectpokemon` card shows the Display team's moves, and its text fallback adds the Battle team's when they're set. The team rules are in `services/battleTeam.js` and the move rules in `services/movesets.js`. The admin commands `/reset-team` and `/resetuser` clear both Teams and their moves. `/resetuser` also clears the casual record, and keeps the ranked record.

### Levels

Every species and Variant a player owns has one Level, from 1 to 100. A first catch rolls a Catch level based on the Pokémon's Stage. A duplicate catch adds half the EXP needed for the next Level. A species and Variant the player hasn't caught since Levels arrived (owned from before battles, or only received as a gift or admin grant) shows the bottom of its catch range until their next catch of it, which rolls a Catch level. Stone evolution and shiny crafting keep the higher of the two Levels. A Level resets when the player has no copies of that species and Variant left, whether they gifted, donated, evolved, or crafted the last one into a shiny, so their next catch rolls a new Catch level. Battles, challenges, and Trainer encounters pay EXP for every opponent the Team knocks out, more for higher-level opponents, and every Team member gets it. Ranked and wager battles pay EXP by the Pokémon's real Levels, not Lv 50.

Levels show on the dashboard, on `/showteam` and `/trainercard`, and in `/inspectpokemon`.

Every tunable number (catch ranges, EXP pace, Underdog surge and cute surge, Battle caps, the ranked Level and season, the challenge cap and loss, the challenge opponents' stat boost, the Revive window, and Trainer encounter odds, limits, and Levels) is in `utils/battle/tuning.js`. The design and the reasons for each number are in [`docs/superpowers/specs/2026-11-02-battles-design.md`](docs/superpowers/specs/2026-11-02-battles-design.md); the Trainer encounter numbers are in [`docs/superpowers/specs/2026-11-10-trainer-encounters-design.md`](docs/superpowers/specs/2026-11-10-trainer-encounters-design.md).

### Battle data

`battleData.json` holds base stats, level-up moves, each move's power and effects, and the type chart for all 1,025 species: Gen 5 values for #1–649 (plus Fairy moves for the 22 species retyped to Fairy), the latest generation's values for #650–1025, and the modern 18-type chart. The effects it stores are priority, hit counts, drain, recoil, and crash damage. `tools/generate-battle-data.mjs` builds it from Pokémon Showdown's data (MIT) through the dev dependencies `@pkmn/dex` and `@pkmn/data`. The bot never loads those packages at runtime. Battle images are animated GIFs: `@napi-rs/canvas` draws each frame, the runtime dependency `omggif` reads each sprite's animation frames, and the runtime dependency `gifenc` encodes the result. `utils/battle/render.js` encodes each frame as soon as it's drawn and decodes sprite frames only as an image reaches them, which keeps a 6v6 battle to about 60 MB, and it pauses between frames so a battle never stalls the bot's other commands. To regenerate it:

```bash
npm run generate:battle-data
node tests/battleData.test.js
```

## Challenges

`/challenge` pits a player's Display team, the one casual battles use, against fixed Kanto teams: the 8 Gym Leaders, the Elite Four, Blue, and Red. Challenges use the same sim and replay as Battles, with no Underdog surge, and leaders appear by name, never as a mention. Every challenge opponent fights with its stats raised 10% (`CHALLENGE.statBoost`). That's hidden on purpose: players only see the roster's Levels, and EXP, which follows those Levels, is unchanged. The leader stands at the left of their row like a player's trainer, the leader's row and nameplate show their type, and a Gym's Badge sits between the rows. A first win adds a screen to the final image that presents the Badge, or "ELITE FOUR CLEARED", "CHAMPION DEFEATED", or "RED DEFEATED". After the replay, challenges follow `/battle`: the embed under the final image says only what the image doesn't (how far an Elite Four run got, the Badge, the prize, what unlocked, or the loss line; nothing after a rematch win), and the player gets a private message with the result (the exact CC lost or the prize) over the same EXP card `/battle` sends.

- `/challenge` with no opponent shows a private board image: the 8 Gyms with each leader's sprite, type, and Badge (lit once earned), then the Elite Four, Blue, and Red on darker stages, as black silhouettes behind a padlock with what opens them until they open (the Elite Four's names and the Champion's show as "???"), and with a gold CLEARED tag once beaten. It shows how many challenges are left today, and never shows Levels. If the image can't render, a text embed with the same facts goes instead. Under it, a dropdown lists everyone the player can challenge now (the Elite Four and Blue join once they open); picking one opens the same private preview as naming them. The dropdown works for 10 minutes.
- `/challenge opponent:Brock` shows a private preview: a VS card with the player's trainer, Badges, and Team against the leader, their type, a Poké Ball per Pokémon in their party, the Badge on the line, and the prize, plus a line with the exact CC a loss would cost and Fight! and Not now buttons. The Elite Four card shows all four members. Not now, or leaving the preview for 2 minutes, costs nothing. Fight! checks everything again, saves the result, then posts the same card in public and the replay. The card never shows the amount (it says "Lose: 10% of CC"), and the public one is built before the win is saved, so it still shows the Badge as on the line. If the card can't be drawn, an embed with the same facts goes instead. The player's private result, with the exact CC lost or the prize and their EXP card, arrives after the replay ends.
- With `CHALLENGE_CHANNEL_ID` set, `/challenge` works only in that channel; anywhere else it privately points the player there. Unset, it works in any channel.

Gyms can be fought in any order, and beating a Gym Leader the first time earns their Badge. All 8 Badges unlock the Elite Four run: Lorelei, Bruno, Agatha, and Lance back to back, replayed in one message. Each Pokémon keeps its damage from one fight to the next, fainted ones stay fainted unless revived, and losing any fight ends the run. There's no forfeit. Clearing the run once unlocks Blue as a separate fight. Red is open to everyone from the start.

After each Elite Four fight the player wins, if any of their Pokémon fainted, they get a private menu with one button per fainted Pokémon and 60 seconds to pick one to Revive. It comes back at full HP for the next fight; with no pick, nothing is revived. Meanwhile the public replay says they're choosing, and the next fight's header says who was revived. The run is saved on the player's record after every fight. While it's open, other challenges are refused (`/battle` still works). If the bot restarts mid-run, or an error stops the run and it sits for 15 minutes, it finishes without Revives (at startup, or on the player's next `/challenge`), and its replay message shows the result. The dashboard never receives an open run, since its seed would let a player test each Revive in advance.

Each player gets 5 challenges per UTC day, separate from the 10 Battles, and an Elite Four run counts as one. Every challenge pays EXP for each knockout, win or lose. Challenges never change the Ranked rating or either battle record.

The first win against each opponent pays the leader's trainer sprite, CC, evolution stones, and Shiny Dust; the Elite Four run pays all four sprites. The sprite is the first enabled version of that leader the player doesn't own. A player who owns them all gets half the sprite's shop price (`TRAINER_COSTS` in `utils/trainerCosts.js`) in CC instead. Prize Dust doesn't count toward the weekly cap on Dust from donations. Rematches pay EXP only.

Losing costs 10% of the player's CC, rounded down, and that CC is gone. A failed Elite Four run costs it once. The loss is never more than the preview showed, even if the player's balance grew before they clicked Fight!. Public posts give it as 10% and never the amount, because 10 times the amount would reveal the balance. A player can't challenge while one of their wager offers is waiting for an answer.

Badges show in a row on the `/trainercard` and `/showcard` card and under the stats bar on the dashboard's Collection page, with unearned ones dimmed. `/api/user-pokemon` sends the challenges won (`challengeProgress`) for that row, never an open run. The 8 Badges are defined in `public/picker-pokemon/badges.js`, which the bot and the dashboard share. The Badge art is FireRed's trainer card badges, tinted with each badge's usual colors by `tools/tint-badges.mjs` (`npm run generate:badges`), which writes `public/sprites/badges/` from the sheet in `tools/badges/`. The board, the VS card, and the replay draw the Badges from `public/sprites/badges/` themselves. Only the preview's fallback embed loads its Badge image from the bot's public host (`PUBLIC_URL`), the same way trainer sprites do. Text lines name the Badges. The teams and prizes are in `utils/challenge/roster.js`. The design, the prize table, and the measured difficulty of each challenge are in [`docs/superpowers/specs/2026-11-08-challenges-design.md`](docs/superpowers/specs/2026-11-08-challenges-design.md).

## Trainer encounters

While a player chats, a computer-run Trainer can spot them, the way a Trainer on a route spots the player in the games, except the player can run. Each message that earns TP and doesn't catch a Pokémon has a 1.5% chance. A player is spotted at most 8 times per UTC day and never within 30 minutes of their last encounter, whether they fought it or not. Nobody is spotted without a Display team, with an Elite Four run open, or with a wager offer waiting for an answer. Encounters use none of the 10 Battles or 5 challenges a day.

The card posts in the channel the player chatted in, mentioning them: their trainer and Team against the Trainer, who has the games' "!" over their head and a Poké Ball per Pokémon, a games-style text box ("Youngster Joey challenged Ash!" and the Trainer's line), and the Prize money ("Win or lose: 260 CC"). It never shows the Trainer's Levels. Only the spotted player can press Battle! or Run; anyone else gets a private note. Run, or no answer in 2 minutes, shrinks the card to one line ("Ash ran away from Youngster Joey."). Battle! fights with the Display team on the card the way a casual battle would (its chosen moves, and its Mega if it still qualifies) but with no Underdog surge, at its current Levels, minus any Pokémon given up since. The replay plays on the card itself, ending with the Trainer's after-battle line and "Ash got 260 CC for winning!" or "Ash whited out!". The player then gets their EXP card privately, alone in its own message, plus the exact CC paid on a loss. Ten seconds after the replay ends (`ENCOUNTER.resultMs`), the card drops its images and keeps only those two lines, so every encounter leaves just a line or two of text in the channel. The bot never removes the private EXP card, but like any private reply, Discord drops it when the player dismisses it or restarts Discord.

The Trainer's Levels follow the mean Level of the Team: 70% of Trainers are 2 to 15 Levels below it, 20% within 2, and 10% 5 to 15 above (never below Lv 5 or above Lv 100). Each brings 3 to 6 Pokémon on their class's type theme, from every released region, never legendary or mythic, each the furthest form of its line that fits its Level. Half of the strongest Trainers are Ace Trainers and half look like any other class, with a quietly confident line as a hint (so is the Prize money, for a player who knows the bases). One weak Trainer in 33 sends out a much stronger Pokémon last, legendaries included. Prize money is the class's base (10, 40 for Gentlemen, Ladies, Rich Boys, and Beauties, 30 for Ace Trainers) times the Level of the Trainer's last Pokémon: a win pays it, and a loss pays the same, or everything the player holds if that's less. Encounters never change the Ranked rating or either battle record.

Open encounters live only in memory and hold nothing, so a restart loses them; a click on a card from before the restart shrinks it to "This Trainer lost interest." The classes are in `utils/encounter/roster.js`, the lines in `utils/encounter/lines.js`, the roll in `utils/encounter/generate.js`, the rules and the fight in `utils/encounter/runEncounter.js`, the Discord side in `utils/encounter/service.js`, and the card in `utils/render/encounterCard.js`. The design and the measured win rates, CC, and leveling pace are in [`docs/superpowers/specs/2026-11-10-trainer-encounters-design.md`](docs/superpowers/specs/2026-11-10-trainer-encounters-design.md).

## Achievements

`/achievements` (private) and the dashboard's Achievements page list every achievement in 9 categories: Pokémon Collection, Shiny Hunting, Evolution, Ranked Battles, Casual Battles, Training, Economy, Daily & Weekly, and Special Milestones. Hidden ones show as "???". Each achievement a player reaches earns Achievement Points. The rewards some achievements list, such as CC, items, titles, and badges, show as "pending approval", and none can be claimed until its id is added to `APPROVED_REWARD_IDS` in `config/achievementRewards.js`, which is empty. Ranked Battles counts ranked and wager battles, and Casual Battles counts casual wins and win streaks. The catalog is `catalog/achievements.js`, and the progress rules are in `progression/achievements.js`.

## Mega Evolution

Mega Evolution is built but off. Production leaves `MEGA_EVOLUTION_ENABLED` unset, so the dashboard shows no Megas, the server refuses Mega unlocks and Teams with a Mega slot, and battles and cards ignore any Mega data already stored. With it set to `1` (`config/features.js`):

- Using a Mega Stone in the Collection page's Mega Evolutions section permanently unlocks that Mega form for one species and Variant. No player can get a Mega Stone yet. The stones are defined in `catalog/items.js`, but no shop, drop, or reward grants them.
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

Most commands reply with a rendered image card instead of an embed: `/showteam`, `/inspectpokemon`, `/leaderboard`, `/daily`, `/trainercard` and `/showcard`, `/pokedex`, `/showbattlecard`, the private EXP card after a battle, and the catch and broadcast cards. A card is an animated GIF when any sprite on it moves. At most 2 GIF cards render at once (`utils/render/stage.js`), and a card that can't get a turn or fails as a GIF goes out as a PNG. A card that can't render at all falls back to the old embed or text. The layouts are in `docs/design/COMMAND-CARDS.md`.

Every static Pokémon sprite has its own idle baked into its GIF by `node tools/generate-pokemon-idles.mjs`, which has no npm script (`--check` verifies the GIFs are current without writing). The rig in `utils/spriteRig.js` gives each Pokémon a seeded performance: the body squats up to 3 px, the head leans 1 px, ears or a crest follow a beat later, and it blinks during a rest wherever `data/sprites/pokemon-blinks.json` lists its eyes. It only moves the sprite's own pixels, never cuts across a face, and moves the normal, shiny, and grayscale sprites in step. A sprite whose cut would show stays still until `data/sprites/pokemon-idle-review.json` approves it. Run the tool after `import:sprites` or `import:mega-sprites`. Every trainer sprite has an idle GIF in `public/sprites/trainers_idle/`, built by `npm run generate:trainer-idles` from the poses in `data/sprites/trainer-idles.json` and the blinks and other part motions in `data/sprites/trainer-parts.json`. `node tools/detect-trainer-parts.mjs <out.json>` (`npm run detect:trainer-parts`) only proposes part motions to review by eye and never writes that file. The generated sprites are checked in. Trainers animate in embeds, on the dashboard's Trainers page, on `/trainercard`, and on the `/leaderboard` podium, and unowned trainers stay still. Shiny Pokémon get a backdrop of gold motes and stars, and Epic, Legendary, and Mythic trainers get a tier backdrop on `/trainercard`. The trainer animation design is in `docs/design/TRAINER-ANIMATION.md`.

Set any of these to `0` to turn animation off:

- `CARDS_ANIMATED`: every card is a PNG.
- `SHOWTEAM_ANIMATED` or `CATCH_ANIMATED`: only `/showteam`, or only the catch cards.
- `TRAINERS_ANIMATED`: trainers stay still everywhere.
- `SHINY_FX`: no shiny backdrop.

## Trainer sprites

`trainerSprites.json` (copied to `public/trainerSprites.json`) lists every trainer sprite by group, with a Tier that sets its shop price (`TRAINER_COSTS` in `utils/trainerCosts.js`). The 2026-11-10 trainer re-tier set each Tier by the character's role in the games, from generic classes at Common or Uncommon up to Red and Blue at Mythic. A sprite moved up to Epic or above blinks only after its eyes are added to `data/sprites/trainer-parts.json` by hand. A group whose sprites are all disabled is skipped, so nothing can roll or grant it. The trainer artists on `/credits` come from `data/sprites/trainer-credits.json`, which `node tools/import-trainer-credits.mjs <index.php>` rebuilds from Pokémon Showdown's trainer sprite credits. Unowned trainers show in grayscale from `public/sprites/trainers_2/grayscale/`, which `pwsh tools/grayscale-trainer-sprites.ps1` builds with ImageMagick (`-Force` rebuilds every file).

## Player data

The bot keeps player data in memory, writes a local snapshot to `TRAINERDATA_DIR`, and posts a backup to the storage channel every 5 minutes when something changed, on shutdown, and on `/adminsave`. It downloads each backup again to check it. At startup it loads the newest valid copy, and if that copy has fewer than 80% of the players of the largest one, it loads nothing and waits. Each process takes a writer epoch higher than any it has seen. A process that finds a backup with a higher epoch stops writing and reports `superseded` on `/readyz`, so only the newest process writes. Production keeps the snapshot on a Fly volume with `LOCAL_IS_DURABLE=1`. How startup picks a copy, the `/readyz` fields, restoring a backup (`RESTORE_FROM`, `CONFIRM_RESTORE`), and the overrides `ALLOW_LOCAL_ONLY` and `ALLOW_PLAYER_COUNT_DROP` are in [`RUNBOOK.md`](RUNBOOK.md). Every push to `master` deploys to production.

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
REWARD_CHANNEL_ID=         # optional: gets every catch and recruit broadcast (they also post where they happened)
RARE_SIGHTINGS_CHANNEL_ID= # optional: also gets the Rare-and-up and shiny ones
ADMIN_ROLE_NAME=Developer  # the role allowed to use /admindashboard (default: Developer)
ADMIN_DASH_TOKEN=          # optional: a shared secret that also opens the admin dashboard's API
```

The Mega Evolution and animation switches are under [Mega Evolution](#mega-evolution) and [Cards and animated sprites](#cards-and-animated-sprites).

#### Optional — production-only

```bash
PUBLIC_URL=https://your-app.fly.dev   # base for dashboard links and embed images (defaults to https://$FLY_APP_NAME.fly.dev)
                                     # RENDER_EXTERNAL_URL still works as an older name for it, except for onrender.com addresses
POKEMON_GENERATIONS=                 # Gens 6–9 to release, e.g. 7 or 6-9 (default: none; Gens 1–5 are always on)
TRAINERDATA_DIR=/data                               # persistent volume path on Fly/Render
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

## Generations 6–9

All 1,025 species are in the data, but only Gens 1–5 can be obtained unless `POKEMON_GENERATIONS` releases more (see `config/generations.js`). A configured generation that fails validation stays off. Owned Pokémon are never removed by switching a generation off. Sprites: Black/White-style animated GIFs where they exist, otherwise static Black/White-style pixel art with a generated idle (see [Cards and animated sprites](#cards-and-animated-sprites)), never 3D renders; credits for Pokémon and trainer sprites at `/credits`. Data pipeline and release process: `docs/gen6-9/README.md`.

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

`npm test` runs every `tests/*.test.js`. The battle tests cover the generated data (`battleData`), the sim, including priority, multi-hit, drain, recoil, crash damage, recoil knockouts, Pokémon starting a fight damaged or fainted, and the stat boost (`battleSim`), Levels, catches, and Level resets (`training`), EXP, the 2-month leveling pace, Elo, and caps (`battleRewards`), whole battles, playback, the rating embed and EXP summary, the replay line, casual, ranked, and wager battles and ranked seasons, and the Underdog surge in casual battles only (`runBattle`), Stakes (`wager`), the `/battle` command, wager buttons, who gets a private EXP message, the `ranked` option, wagers on Battle teams, and each player's trainer in the replay, driven with stub Discord objects (`battleCommand`), `/leaderboard` and its season's ranked records (`leaderboard`), turn narration and how it wraps, the animated frames, the attacker's own HP changing, decoding sprites as they play, colors that only appear late in an image, rendering without stalling the bot, each player's trainer portrait, and the challenge styling: the type tint, the Badge between the rows, and the award screen (`battleRender`), `/inspectpokemon` text (`levelDisplay`), and Underdog win rates over 24,000 simulated battles (`battleBalance`), the Cuteness scores (every species and Mega form, two clusters, only a handful of 10s), a Team's Cuteness, today's surge unchanged seed for seed for Teams averaging 5 or less, the cute surge's chance, its curve, and its lift past Lv 100, EXP at the surged Levels, the cute heading, casual battles only, and no page, route, or command reading the scores (`cuteness`), and the cute surge's measured win rates against six mythics for a Team averaging 10 and a Team of the cutest Pokémon at the same Level, across a Level gap, and as a Team of one, and for a typical cute Team, the share of random Teams that are cute, and the EXP from a cute win (`cutenessBalance`). The Team tests cover the mythic and Mega limits and the refusal to donate, evolve, or convert a Pokémon on either Team (`battleTeam`), which moves a Pokémon can pick, each Team's own moves in battle, and the moves `/inspectpokemon` shows (`movesets`), and the `/showbattlecard` image (`battleCard`).

The challenge tests cover:

- `challengeRoster`: the 14 teams and their Levels, the prize table, the leaders' sprites, the Badges and their 128×128 images, the Badge image URLs, and the Badge line in `/trainercard`'s text fallback.
- `runChallenge`: the Display team fighting (never the Battle team), unlocks, the hidden stat boost on every opponent (never the player's Team, and Levels unchanged), the 5-a-day cap and its reset at midnight UTC, Elite Four HP carried between fights, Revives in the sim, EXP summed per run with Levels fixed, first-win prizes and the sprite fallback, prizes going through the trainer and inventory services, achievements for prize sprites and Levels, the 10% loss and its cap at the previewed amount, and no Underdog surge. It also covers the interactive run saved on the record: one fight per step, stale or repeated steps, a record replaced or a Team member given away mid-run, finishing open runs, the event log entry, the dashboard never receiving an open run, and the Collection page getting the challenges won for its Badge row. With a Mega on the Team, the run saves no Mega battle stats on the record, plays the same after a reload between fights, fights as the base form once Mega battles are off, and loses a fight it starts with every Pokémon fainted at turn 0, including after a restart.
- `challengeCard`: the VS card's facts for a Gym, a rematch, the Elite Four, Blue, and Red, its alt text, that it never carries the loss amount or balance, the prize wrapping onto two lines, and where the trainers, Badges, and medallion are drawn.
- `challengeBoard`: the board image's Gyms, Badges, attempts left, each League stage locked, open, or cleared, its alt text, and that locked opponents are dark silhouettes.
- `challengePlayback`: the result embed (only what the image doesn't say, with no EXP or Badge thumbnail, and none after a rematch win), each fight's styling and the first-win award (none for a rematch or a loss), the Elite Four run replaying one fight at a time on one message with the replay slot free between fights, the Revive in each header, the "choosing" line and the result-only edit, no leader as a mention, and no exact loss in public.
- `challengeCommand`: `/challenge` driven with stub Discord objects, covering the board image, its fallback embed and its dropdown, the challenge channel, every refusal, the VS card preview and its fallback embed, the public card showing the Badge still on the line, the player's trainer in the replay, the private result with the EXP card (and its text fallback), Not now, expiry, Fight!, a double click, changes to the player's record, Team, or wagers between the preview and Fight!, and the private result arriving after the replay. For the Elite Four run it covers the Revive menu, a pick, the 60-second deadline, late and repeated clicks, a menu that can't be sent, refusals while a run is open, a run that stopped unexpectedly, and a run still playing that is left alone.
- `challengeBalance`: the Level at which stand-in Teams beat each challenge half the time, with a stand-in player who revives their strongest fainted Pokémon, enforcing Giovanni < Elite Four run < Blue < Red, and printing the run's gate with no Revives, win-rate curves, a one-Pokémon Team, and leveling pace with 5 challenges a day.

The Trainer encounter tests cover:

- `encounterRoster`: the tuning values, the 35 Trainer classes (never a `/challenge` opponent, every sprite present, the Prize money bases, type themes), the names, and the lines (every class has a set, no dashes or curly quotes, each fits the text box).
- `encounterGenerate`: tier shares and Level bands around the Team's mean Level, the Level floor and cap, 3 to 6 Pokémon weakest to strongest, Ace Trainers only among the strongest, the 3% surprise, no legendary lines on regular teams, forms that fit their Level, type themes, species for every class at every Level, Prize money, the hinting lines, and seeds.
- `runEncounter`: the encounter record and its day reset, who can be spotted (no Team, an open run, a pending wager, one at a time, the 30-minute gap, 8 a day), and the fight: Prize money both ways, paying at most the balance, EXP on a loss, the card's Team minus Pokémon given up, fighting with its chosen Display moves and Mega, re-checks at the click, and no change to Battles or challenges.
- `encounterCard`: the card's facts, no Levels, alt text, the "!" bitmap and where it sits, and where the trainers, text box, and Prize money are drawn.
- `encounterFlow`: the replay on the card and its result embed, then the service with stub Discord objects: the permission check before the roll, a miss, a posted card, a failed post, simultaneous hits, no Team, the embed fallback, someone else's click, Run, no answer, Battle! with the EXP card alone in its private message and the card shrinking to its result 10 seconds later, a replay that can't play, a double click racing the timeout, a refused Battle!, and a click after a restart, and the card's Mega fighting as a Mega.
- `startupReadiness`: an encounter rolls only after a message whose catch roll missed, never before player data loads, and a failed roll is logged.
- `encounterBalance`: prints win rates by tier for Team sizes 1 to 6 over 400 fights per case, a Lv 100 carrying five Lv 5s, CC per encounter, and leveling pace with 8 a day, enforcing Under >= Even >= Over.

The Mega Evolution tests cover:

- `megaSafety`: every switch off by default, no tie to the generation releases, no Mega Stone in any shop or reward pool, and Mega code used only where it's needed.
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
- `gameplayRoutes`: the dashboard's catch, evolve, convert, and weekly pack handlers, including an evolution target that isn't one and a Pokémon on either Team.
- `pokemonDetail`: the Collection page's detail panel matches the Discord cards and changes nothing.
- `pokemonPower`: the dashboard's Power matches `/showteam`.
- `spriteFx`: the dashboard's shiny and trainer backdrops match the Discord cards pixel for pixel.
- `commandCards`: the EXP, leaderboard, daily, trainer, Pokédex, and inspect cards, what they show, their fallbacks, and that they change nothing.
- `catchMessage`: the catch and broadcast cards, the GIF limit, the animation switches, and the embed fallback.
- `showteamRender` and `showteamCommand`: the `/showteam` layout, its controls and who may use them, the GIF limit and PNG fallbacks, the Manage link, and the inspect card.
- `pokemonFx`: the rig idle (squash, head lean, ear drag, blink) on every static sprite and no other, and that only shinies get the backdrop, it stays clear of the Pokémon, and `SHINY_FX=0` turns it off.
- `trainerIdle`: trainer poses, the idle GIFs and their manifest being current, part motions, trainer image URLs, the tier backdrop, and the rendered cards.

The achievement, item, and catalogue tests cover:

- `achievements` and `achievementsExpansion`: the catalog and its categories, progress, achievements recognized after the fact, reward claims (once only, all or nothing, a failed save, a restart), hidden entries, and battle achievements counting ranked and wager battles only.
- `achievementsBench`: prints the cost of achievements for 3,000 synthetic players.
- `inventory` and `inventoryRegression`: the item catalog and inventory service, locked changes, `/inventory`, the Bag page's data, and `/daily` giving exactly what it gave before.
- `assets`: trainer ownership, the gift and recruit helpers, and the recruit and quest pool.
- `catalog`: every trainer Tier is a known one, the public copy matches, each sprite file is in one group, and a group whose sprites are all disabled is skipped.
- `gen69Catalog`, `gen69Display`, `gen69Generations`, `gen69Achievements`, and `gen69Balance`: Generations 6–9 in the catalogue and sprites, in battles and cards, behind the release switches on every way to get a Pokémon, in achievements, and in the catch odds.
- `regions`: region grouping and Pokédex completion counts.
- `pokemonRetier`: the 2026-11-11 Pokémon re-tier, with the approved tier overrides live in `pokemonData.json`, the override guards, the Battle team mythic trim, and its one-time notice reaching the player once.

The player data and safety tests cover:

- `durability`: writer epochs, compact snapshots, verified Discord uploads, booting from the volume, the save circuit breaker, and two processes at once.
- `loader`, `snapshot`, and `localStore`: how startup chooses a copy, snapshot checks, and local snapshots, including what a crash can leave behind.
- `persistenceRestart`: simulated restarts with the real save code, which never load data older than the newest saved copy.
- `saveQueue`, `saveQueueFailure`, `saveQueueRetry`, and `atomicWrite`: queued saves, retrying a failed write without leaving a lock held, and atomic file writes.
- `userInitializer`: repairing a player record in place without losing anything.
- `playerDataGuard`: no tracked file holds player data, and the Docker image leaves backups out.
- `mutationGuard`: data-integrity bugs fixed in `bot_final.js` stay fixed.
- `commandContract` and `commandsDiff`: every command takes the arguments `bot_final.js` passes, and a dry run of slash-command registration.
- `testRunnerGuard`: `run-tests.js` refuses to run unless `TRAINERDATA_DIR` is a writable folder outside the repo.

`tests/addInventory.test.js` checks that `/addinventory` adds Shiny Dust to `items.shiny_dust`, where the dashboard and shiny evolutions read it.

`tests/gift.test.js` covers gifting Pokémon: only normal copies move, the sender's last copy can't be gifted, no gift creates or destroys copies, and the sender's Level resets when their last normal goes.

`tests/bulkDonate.test.js` covers the bulk donation rules in `utils/bulkDonate.js`: trimming duplicates per variant, which Pokémon Multi-select accepts, rejecting a list that changed after the player saw it, CC and Shiny Dust rewards against the weekly cap, and resetting the Level of a Pokémon donated away.

`tests/bulkRules.test.js` covers `public/picker-pokemon/bulkRules.js`, which decides what the dashboard offers: the Donate Duplicates list and the reason each locked card can't be multi-selected. It also runs those lists through `utils/bulkDonate.js` to check that the server accepts every row the dashboard offers and refuses every locked card.

## Common gotchas

- **Slash commands missing** — confirm `CLIENT_ID` matches the application that owns `BOT_TOKEN`, and that the bot was invited with the `applications.commands` scope.
- **Bot online but ignores commands** — Privileged Gateway Intents weren't enabled on the Bot page.
- **Role-rank changes don't apply** — bot's role must be *above* the rank roles in the server's role list, and it needs `Manage Roles`.
- **Backups not appearing** — bot lacks `Attach Files` or `View Channel` in `STORAGE_CHANNEL_ID`.
- **Battles or challenges never show up** — the bot posts battles, wager offers, and challenges as new messages, so it needs `Send Messages` and `Attach Files` in the channel where `/battle` or `/challenge` runs.
- **Trainer encounters never happen in a channel** — a Trainer only spots players in channels where the bot can view, send messages, attach files, and embed links.
- **Sprites or Badges missing from embeds** — Discord fetches embed images from `PUBLIC_URL`, so it must be a public `https://` address serving this version (Badge images ship in `public/sprites/badges/`). Discord can't fetch `http://localhost:3000`. A `PUBLIC_URL` without `http://` or `https://` (like `localhost:3000`) makes discord.js reject every embed that has a sprite.
