# Coop's Collection — Discord Bot

Discord bot for a Pokémon collector game. Built on `discord.js` v14 with an Express server for the player web dashboard.

## About

A Discord-native Pokémon collector game. Players earn points and ranks for chatting in the channels, and may randomly catch a Pokémon along the way. A companion web dashboard lets them manage their collection and spend points on catching pokemon or updating their trainer. The dashboard's Pokémon page groups the list by region in all four modes: Change Team, Evolve, Donate, and Convert. Each region header shows the player's Pokédex completion for that region, such as "Kanto 75/151". The count always covers the whole region and ignores the page's filters. `CONTEXT.md` defines how Pokédex completion is counted.

In the dashboard's Donate mode, **Donate Duplicates** donates every copy past the first of each Pokémon and variant, and **Multi-select** donates several single copies at once. Both show a confirmation first and donate all or nothing. Domain terms such as duplicate, variant, and Team are defined in [`CONTEXT.md`](./CONTEXT.md).

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
RENDER_EXTERNAL_URL=https://your-app.onrender.com   # used by /dashboard in production
TRAINERDATA_DIR=/data                               # persistent volume path on Fly/Render
```

### 6. Run it

```bash
npm start
```

On first run with `REGISTER_COMMANDS=true`, slash commands register to your `GUILD_ID` (instant). After that, set `REGISTER_COMMANDS=false` to avoid re-registering on every boot.

### 7. Verify

In your test server, run `/dashboard` — the bot should reply with an ephemeral link to the player dashboard.

## Tests

```bash
npm test                  # runs run-tests.js (every tests/*.test.js)
npm run test:validation   # schema validation
npm run test:migration    # schema migration
```

`npm test` runs every `tests/*.test.js` file:

- `atomicWrite.test.js`: atomic file writes
- `saveQueue.test.js`: the save queue
- `regions.test.js`: region grouping and per-region Pokédex completion counts

`tests/addInventory.test.js` checks that `/addinventory` adds Shiny Dust to `items.shiny_dust`, where the dashboard and shiny evolutions read it.

`tests/gift.test.js` covers gifting Pokémon: only normal copies move, the sender's last copy can't be gifted, and no gift creates or destroys copies.

`tests/bulkDonate.test.js` covers the bulk donation rules in `utils/bulkDonate.js`: trimming duplicates per variant, which Pokémon Multi-select accepts, rejecting a list that changed after the player saw it, and CC and Shiny Dust rewards against the weekly cap.

`tests/bulkRules.test.js` covers `public/picker-pokemon/bulkRules.js`, which decides what the dashboard offers: the Donate Duplicates list and the reason each locked card can't be multi-selected. It also runs those lists through `utils/bulkDonate.js` to check that the server accepts every row the dashboard offers and refuses every locked card.

## Common gotchas

- **Slash commands missing** — confirm `CLIENT_ID` matches the application that owns `BOT_TOKEN`, and that the bot was invited with the `applications.commands` scope.
- **Bot online but ignores commands** — Privileged Gateway Intents weren't enabled on the Bot page.
- **Role-rank changes don't apply** — bot's role must be *above* the rank roles in the server's role list, and it needs `Manage Roles`.
- **Backups not appearing** — bot lacks `Attach Files` or `View Channel` in `STORAGE_CHANNEL_ID`.
