# Coop's Collection — Discord Bot

Discord bot for a Pokémon collector game. Built on `discord.js` v14 with an Express server for the player web dashboard.

## About

A Discord-native Pokémon collector game. Players earn points and ranks for chatting in the channels, and may randomly catch a Pokémon along the way. A companion web dashboard lets them manage their collection and spend points on catching pokemon or updating their trainer. The dashboard's Pokémon page groups the list by region in all four modes: Change Team, Evolve, Donate, and Convert. Each region header shows the player's Pokédex completion for that region, such as "Kanto 75/151". The count always covers the whole region and ignores the page's filters. `CONTEXT.md` defines how Pokédex completion is counted.

In the dashboard's Donate mode, **Donate Duplicates** donates every copy past the first of each Pokémon and variant, and **Multi-select** donates several single copies at once. Both show a confirmation first and donate all or nothing.

Game terms (Tier, Stage, Variant, duplicate, Team, Battle rating, and so on) are defined in [`CONTEXT.md`](CONTEXT.md).

## Battles

Players battle each other's Teams. The bot simulates the whole fight with Gen 5 stats, moves, and type matchups, then replays it in the channel turn by turn as animated images: the two Pokémon fighting are spotlit, HP bars drain, and a game-style text box narrates each move. Battles longer than 12 turns are spread over 12 updates. A final image shows who won, the MVP (the winner's Pokémon with the most knockouts), level-ups, and new moves, and an embed under it shows each player's Battle rating change. When the replay ends, each player who earned EXP gets a message only they can see with each Pokémon's EXP gain. Discord allows these replies only within 15 minutes of a command, so a Challenger whose Wager was accepted near the end of the offer may not get theirs; the EXP still counts. At most 2 battles replay at once. When more start, each extra battle's message shows its place in line until its replay begins. The results count right away; only the replay waits.

Moves follow Gen 5 rules for priority, multi-hit, drain, recoil, and crash damage. Quick Attack goes first and Vital Throw goes last. Bullet Seed hits 2 to 5 times. Giga Drain heals the user half the damage it deals, and Double-Edge hurts the user as well as the target. A missed High Jump Kick costs the user half its max HP. A Pokémon that faints from its own recoil or crash counts as a knockout for the Pokémon it attacked. When both last Pokémon faint from one move, the side whose Pokémon fainted last wins. With recoil, that's the user's side, as in Gen 5. The sim has no abilities except Shedinja's Wonder Guard, and no items, status conditions, stat changes, or other move side effects.

- `/battle opponent:@user` starts an Open battle. It runs right away and costs nothing. Only the Challenger earns EXP, and both players' Battle ratings change.
- `/battle opponent:@user wager:100` offers a Wager battle. The bot holds the Challenger's CC until the Defender accepts or declines, or for 15 minutes. A Defender with less CC than the Stake can accept with everything they have, and the Challenger gets the difference back. Both players earn EXP, and the winner takes the pot. If the Challenger's Team gets stronger before the Defender answers, Accept cancels the offer instead. A restart refunds any Stake still waiting for an answer.
- `/leaderboard` shows the top 10 Battle ratings and your position.

Each player can start 10 battles per UTC day, and at most 3 against the same opponent. A Wager battle counts for both players. When one Team is much stronger, the Underdog sometimes gets a surge that raises its Levels for that battle, so lopsided fights are rarely but not never upsets.

### Levels

Every species and Variant a player owns has one Level, from 1 to 100. A first catch rolls a Catch level based on the Pokémon's Stage. A duplicate catch adds half the EXP needed for the next Level. A species and Variant the player hasn't caught since Levels arrived (owned from before battles, or only received as a gift or admin grant) shows the bottom of its catch range until their next catch of it, which rolls a Catch level. Stone evolution and shiny crafting keep the higher of the two Levels. A Level resets when the player has no copies of that species and Variant left, whether they gifted, donated, evolved, or crafted the last one into a shiny, so their next catch rolls a new Catch level. Battles and challenges pay EXP for every opponent the Team knocks out, more for higher-level opponents, and every Team member gets it.

Levels show on the dashboard, on `/showteam` and `/trainercard`, and in `/inspectpokemon`.

Every tunable number (catch ranges, EXP pace, Underdog surge, Battle caps, the challenge cap and loss, the Revive window) is in `utils/battle/tuning.js`. The design and the reasons for each number are in [`docs/superpowers/specs/2026-11-02-battles-design.md`](docs/superpowers/specs/2026-11-02-battles-design.md).

### Battle data

`battleData.json` holds base stats, level-up moves, each move's power and effects, and the type chart for all 1,025 species: Gen 5 values for #1–649 (plus Fairy moves for the 22 species retyped to Fairy), the latest generation's values for #650–1025, and the modern 18-type chart. The effects it stores are priority, hit counts, drain, recoil, and crash damage. `tools/generate-battle-data.mjs` builds it from Pokémon Showdown's data (MIT) through the dev dependencies `@pkmn/dex` and `@pkmn/data`. The bot never loads those packages at runtime. Battle images are animated GIFs: `@napi-rs/canvas` draws each frame, the runtime dependency `omggif` reads each sprite's animation frames, and the runtime dependency `gifenc` encodes the result. `utils/battle/render.js` encodes each frame as soon as it's drawn and decodes sprite frames only as an image reaches them, which keeps a 6v6 battle to about 60 MB, and it pauses between frames so a battle never stalls the bot's other commands. To regenerate it:

```bash
npm run generate:battle-data
node tests/battleData.test.js
```

## Challenges

`/challenge` pits a player's Team against fixed Kanto teams: the 8 Gym Leaders, the Elite Four, Blue, and Red. Challenges use the same sim and replay as Battles, with no Underdog surge, and leaders appear by name, never as a mention.

- `/challenge` with no opponent shows a private board: each Gym Leader's Badge and type, which Badges the player has, what the Elite Four and Blue still need, and how many challenges are left today. It never shows Levels.
- `/challenge opponent:Brock` shows a private preview: the leader's sprite, Badge, and type, the prize, and the exact CC a loss would cost, with Fight! and Not now buttons. Not now, or leaving the preview for 2 minutes, costs nothing. Fight! checks everything again, saves the result, then posts a public intro card and the replay. The player's private result, with the exact CC lost or the prize, arrives after the replay ends.

Gyms can be fought in any order, and beating a Gym Leader the first time earns their Badge. All 8 Badges unlock the Elite Four run: Lorelei, Bruno, Agatha, and Lance back to back, replayed in one message. Each Pokémon keeps its damage from one fight to the next, fainted ones stay fainted unless revived, and losing any fight ends the run. There's no forfeit. Clearing the run once unlocks Blue as a separate fight. Red is open to everyone from the start.

After each Elite Four fight the player wins, if any of their Pokémon fainted, they get a private menu with one button per fainted Pokémon and 60 seconds to pick one to Revive. It comes back at full HP for the next fight; with no pick, nothing is revived. Meanwhile the public replay says they're choosing, and the next fight's header says who was revived. The run is saved on the player's record after every fight. While it's open, other challenges are refused (`/battle` still works). If the bot restarts mid-run, or an error stops the run and it sits for 15 minutes, it finishes without Revives (at startup, or on the player's next `/challenge`), and its replay message shows the result. The dashboard never receives an open run, since its seed would let a player test each Revive in advance.

Each player gets 5 challenges per UTC day, separate from the 10 Battles, and an Elite Four run counts as one. Every challenge pays EXP for each knockout, win or lose. Challenges never change Battle rating or W/L.

The first win against each opponent pays the leader's trainer sprite, CC, evolution stones, and Shiny Dust; the Elite Four run pays all four sprites. The sprite is the first enabled version of that leader the player doesn't own. A player who owns them all gets half the sprite's shop price (`TRAINER_COSTS` in `utils/trainerCosts.js`) in CC instead. Prize Dust doesn't count toward the weekly cap on Dust from donations. Rematches pay EXP only.

Losing costs 10% of the player's CC, rounded down, and that CC is gone. A failed Elite Four run costs it once. The loss is never more than the preview showed, even if the player's balance grew before they clicked Fight!. Public posts say "10% of their CC" and never the amount, because 10 times the amount would reveal the balance. A player can't challenge while one of their wager offers is waiting for an answer.

Badges show on `/trainercard` and in a row under the dashboard's stats bar, with unearned ones dimmed. The 8 Badges are defined in `public/picker-pokemon/badges.js`, which the bot and the dashboard share. The Badge art is FireRed's trainer card badges, tinted with each badge's usual colors by `tools/tint-badges.mjs` (`npm run generate:badges`), which writes `public/sprites/badges/` from the sheet in `tools/badges/`. The teams and prizes are in `utils/challenge/roster.js`. The design, the prize table, and the measured difficulty of each challenge are in [`docs/superpowers/specs/2026-11-08-challenges-design.md`](docs/superpowers/specs/2026-11-08-challenges-design.md).

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
- `STORAGE_CHANNEL_ID` — create a **private** text channel (only admins + the bot can view; it stores full player data backups every 15 min). Right-click it → **Copy Channel ID**. Make sure the bot has `View Channel`, `Send Messages`, `Attach Files`, and `Read Message History` there.

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
```

#### Optional — production-only

```bash
PUBLIC_URL=https://your-app.fly.dev   # base for dashboard links and embed images (defaults to https://$FLY_APP_NAME.fly.dev)
POKEMON_GENERATIONS=                 # Gens 6–9 to release, e.g. 7 or 6-9 (default: none; Gens 1–5 are always on)
TRAINERDATA_DIR=/data                               # persistent volume path on Fly/Render
```

### 6. Run it

```bash
npm start
```

On first run with `REGISTER_COMMANDS=true`, slash commands register to your `GUILD_ID` (instant). After that, set `REGISTER_COMMANDS=false` to avoid re-registering on every boot. Set it to `true` again for one run whenever a command's name, options, or permissions change.

### 7. Verify

In your test server, run `/dashboard` — the bot should reply with an ephemeral link to the player dashboard.

### 8. Upload the Badge emojis

`/challenge` and `/trainercard` show the 8 Kanto Badges as application emojis. The art is in `public/sprites/badges/` (128×128 PNGs, which the dashboard also shows).

1. In the Developer Portal, open your application's **Emojis** page and upload each PNG from `public/sprites/badges/` with the name `utils/challenge/badgeEmojis.js` gives it (`boulder.png` as `boulder_badge`, `cascade.png` as `cascade_badge`, and so on).
2. Paste each emoji's ID into `utils/challenge/badgeEmojis.js`.

## Generations 6–9

All 1,025 species are in the data, but only Gens 1–5 can be obtained unless `POKEMON_GENERATIONS` releases more (see `config/generations.js`). A configured generation that fails validation stays off. Owned Pokémon are never removed by switching a generation off. Sprites: Black/White-style animated GIFs where they exist, otherwise static Black/White-style pixel art, never 3D renders; credits at `/credits`. Data pipeline and release process: `docs/gen6-9/README.md`.

```bash
npm run generate:pokedex      # pokemonData.json (+ public copy), data/pokedex/forms.json
npm run generate:battle-data  # battleData.json
npm run import:sprites        # sprites + data/sprites/sprites.json (verifies audited SHA-1s)
npm run generate:credits      # public/credits/index.html
npm run validate:catalog      # release gate (add a generation number to check one)
npm run report:balance        # docs/gen6-9/BALANCE-DATA.md
```

## Tests

```bash
npm test                  # runs run-tests.js (every tests/*.test.js)
npm run test:validation   # schema validation
npm run test:migration    # schema migration
```

`npm test` runs every `tests/*.test.js`. The battle tests cover the generated data (`battleData`), the sim, including priority, multi-hit, drain, recoil, crash damage, recoil knockouts, and Pokémon starting a fight damaged or fainted (`battleSim`), Levels, catches, and Level resets (`training`), EXP, the 2-month leveling pace, Elo, and caps (`battleRewards`), whole battles, playback, the rating embed and EXP summary, and the replay line (`runBattle`), Stakes (`wager`), the `/battle` command, wager buttons, and who gets a private EXP message, driven with stub Discord objects (`battleCommand`), `/leaderboard` (`leaderboard`), turn narration and how it wraps, the animated frames, the attacker's own HP changing, decoding sprites as they play, colors that only appear late in an image, and rendering without stalling the bot (`battleRender`), `/inspectpokemon` text (`levelDisplay`), and Underdog win rates over 24,000 simulated battles, plus a lone Pokémon against full Teams (`battleBalance`).

The challenge tests cover:

- `challengeRoster`: the 14 teams and their Levels, the prize table, the leaders' sprites, the Badges and their 128×128 images, and the Badge line on `/trainercard`. Its check that every Badge emoji has an ID fails until Setup step 8 is done.
- `runChallenge`: unlocks, the 5-a-day cap and its reset at midnight UTC, Elite Four HP carried between fights, Revives in the sim, EXP summed per run with Levels fixed, first-win prizes and the sprite fallback, prizes going through the trainer and inventory services, achievements for prize sprites and Levels, the 10% loss and its cap at the previewed amount, and no Underdog surge. It also covers the interactive run saved on the record: one fight per step, stale or repeated steps, a record replaced or a Team member given away mid-run, finishing open runs, the event log entry, and the dashboard never receiving an open run.
- `challengePlayback`: the result embed, the Elite Four run replaying one fight at a time on one message with the replay slot free between fights, the Revive in each header, the "choosing" line and the result-only edit, no leader as a mention, and no exact loss in public.
- `challengeCommand`: `/challenge` driven with stub Discord objects, covering the board, every refusal, the preview, Not now, expiry, Fight!, a double click, changes to the player's record, Team, or wagers between the preview and Fight!, and the private result arriving after the replay. For the Elite Four run it covers the Revive menu, a pick, the 60-second deadline, late and repeated clicks, a menu that can't be sent, refusals while a run is open, a run that stopped unexpectedly, and a run still playing that is left alone.
- `challengeBalance`: the Level at which stand-in Teams beat each challenge half the time, with a stand-in player who revives their strongest fainted Pokémon, enforcing Giovanni < Elite Four run < Blue < Red, and printing the run's gate with no Revives, win-rate curves, a one-Pokémon Team, and leveling pace with 5 challenges a day.

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
- **`npm test` fails at "every Badge emoji has an ID"** — the Badge emoji IDs in `utils/challenge/badgeEmojis.js` are empty until Setup step 8 is done. Until then, Badges show as raw text like `<:boulder_badge:>` in Discord.
