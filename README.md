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

Every species and Variant a player owns has one Level, from 1 to 100. A first catch rolls a Catch level based on the Pokémon's Stage. A duplicate catch adds half the EXP needed for the next Level. A species and Variant the player hasn't caught since Levels arrived (owned from before battles, or only received as a gift or admin grant) shows the bottom of its catch range until their next catch of it, which rolls a Catch level. Stone evolution and shiny crafting keep the higher of the two Levels. A Level resets when the player has no copies of that species and Variant left, whether they gifted, donated, evolved, or crafted the last one into a shiny, so their next catch rolls a new Catch level. Battles pay EXP for every opponent the Team knocks out, more for higher-level opponents, and every Team member gets it.

Levels show on the dashboard, on `/showteam` and `/trainercard`, and in `/inspectpokemon`.

Every tunable number (catch ranges, EXP pace, Underdog surge, Battle caps) is in `utils/battle/tuning.js`. The design and the reasons for each number are in [`docs/superpowers/specs/2026-11-02-battles-design.md`](docs/superpowers/specs/2026-11-02-battles-design.md).

### Battle data

`battleData.json` holds base stats, level-up moves, each move's power and effects, and the type chart for all 1,025 species: Gen 5 values for #1–649 (plus Fairy moves for the 22 species retyped to Fairy), the latest generation's values for #650–1025, and the modern 18-type chart. The effects it stores are priority, hit counts, drain, recoil, and crash damage. `tools/generate-battle-data.mjs` builds it from Pokémon Showdown's data (MIT) through the dev dependencies `@pkmn/dex` and `@pkmn/data`. The bot never loads those packages at runtime. Battle images are animated GIFs: `@napi-rs/canvas` draws each frame, the runtime dependency `omggif` reads each sprite's animation frames, and the runtime dependency `gifenc` encodes the result. `utils/battle/render.js` encodes each frame as soon as it's drawn and decodes sprite frames only as an image reaches them, which keeps a 6v6 battle to about 60 MB, and it pauses between frames so a battle never stalls the bot's other commands. To regenerate it:

```bash
npm run generate:battle-data
node tests/battleData.test.js
```

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

`npm test` runs every `tests/*.test.js`. The battle tests cover the generated data (`battleData`), the sim, including priority, multi-hit, drain, recoil, crash damage, and recoil knockouts (`battleSim`), Levels, catches, and Level resets (`training`), EXP, the 2-month leveling pace, Elo, and caps (`battleRewards`), whole battles, playback, the rating embed and EXP summary, and the replay line (`runBattle`), Stakes (`wager`), the `/battle` command, wager buttons, and who gets a private EXP message, driven with stub Discord objects (`battleCommand`), `/leaderboard` (`leaderboard`), turn narration and how it wraps, the animated frames, the attacker's own HP changing, decoding sprites as they play, colors that only appear late in an image, and rendering without stalling the bot (`battleRender`), `/inspectpokemon` text (`levelDisplay`), and Underdog win rates over 24,000 simulated battles (`battleBalance`).

`tests/adminDashboard.test.js` covers the admin dashboard: every Admin change (CC, TP, items, Pokémon, trainers, Levels, cooldowns, reset), rejected over-removals, clearing Team slots when a last copy goes, bulk grants (filters, partial failure, retries), the audit file, sliding admin sessions, and the write guards on the admin API.

`tests/gift.test.js` covers gifting Pokémon: only normal copies move, the sender's last copy can't be gifted, no gift creates or destroys copies, and the sender's Level resets when their last normal goes.

`tests/bulkDonate.test.js` covers the bulk donation rules in `utils/bulkDonate.js`: trimming duplicates per variant, which Pokémon Multi-select accepts, rejecting a list that changed after the player saw it, CC and Shiny Dust rewards against the weekly cap, and resetting the Level of a Pokémon donated away.

`tests/bulkRules.test.js` covers `public/picker-pokemon/bulkRules.js`, which decides what the dashboard offers: the Donate Duplicates list and the reason each locked card can't be multi-selected. It also runs those lists through `utils/bulkDonate.js` to check that the server accepts every row the dashboard offers and refuses every locked card.

## Common gotchas

- **Slash commands missing** — confirm `CLIENT_ID` matches the application that owns `BOT_TOKEN`, and that the bot was invited with the `applications.commands` scope.
- **Bot online but ignores commands** — Privileged Gateway Intents weren't enabled on the Bot page.
- **Role-rank changes don't apply** — bot's role must be *above* the rank roles in the server's role list, and it needs `Manage Roles`.
- **Backups not appearing** — bot lacks `Attach Files` or `View Channel` in `STORAGE_CHANNEL_ID`.
- **Battles never show up** — the bot posts battles and wager offers as new messages, so it needs `Send Messages` and `Attach Files` in the channel where `/battle` runs.
