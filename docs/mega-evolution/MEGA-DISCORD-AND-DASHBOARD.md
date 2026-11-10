# Mega Evolution: Discord commands and dashboard

## 1. Existing conventions (audited)

- Slash commands live in `commands/*.js` (`SlashCommandBuilder`). They're registered per guild on every boot (`REGISTER_COMMANDS=true`). Replies use `safeReply`, and mutations run under `lockUser` + `saveAndAck`.
- Dashboard pages are static apps in `public/` (team and collection: `public/picker-pokemon`; bag: `public/bag`; achievements: `public/achievements`) that call `/api/*` in `bot_final.js` with a dashboard session (`requireDashboardSession`).
- Evolution, shiny craft and donation already happen on the dashboard (`/api/pokemon/evolve`, `/api/pokemon/convert-to-shiny`, `/api/pokemon/donate`). Mega unlock fits that pattern.

## 2. Discord

One new command group, plus small changes to existing commands:

| Command | Purpose | Notes |
|---|---|---|
| `/mega list` | Your unlocked Megas (per line), stones in the bag, and owned lines that a stone in your bag could unlock | Ephemeral. Paginated (`utils/pagination.js`) |
| `/mega info pokemon:<name>` | The forms for a species: stone, Mega types, stats vs base, ability with its **Coop-battle status** (Works / Coming later / No effect), normal and shiny sprite | Read-only. Works for any species, owned or not. Shows "Unavailable" for blocked forms (e.g. Mega Zygarde) |
| `/mega unlock pokemon:<name> shiny:<bool> stone:<autocomplete> [form]` | Applies a stone to your line | Confirmation button with a nonce, then `unlockMega` with `requestId = interaction.id` (idempotent across Discord retries) |
| `/inventory` | Stones listed under a new "Mega" category with "Use on the dashboard or with /mega unlock" | `listInventory` usage text |
| `/showteam`, `/trainercard` | The Mega slot shows the Mega sprite and a ⓜ badge | Reads `slot.mega` |
| `/inspectpokemon` (admin) | Shows `megaUnlocks` for a user | Read-only |
| `/addinventory` (admin) | Can grant stones once they're `active` | Existing guard: `defined` items are refused unless `allow_unreleased` is passed |

No `/mega select`: the dashboard team slot is the selection (owner direction). The command `/mega team` was considered and rejected, so that one team editor stays authoritative.

Every `/mega` reply while `MEGA_EVOLUTION_ENABLED` is off: "Mega Evolution isn't available yet." `info` stays available to admins for review.

## 3. Dashboard

### Collection grid (`public/picker-pokemon`)

- **Mega cards as separate Pokémon (owner direction):** for each owned line with an unlock, a card "Mega Charizard X" appears directly after the base card. It uses the Mega sprite (normal or shiny to match the line), a "MEGA" ribbon, the line's Level, and a sub-label "Battle form of your Charizard".
- **Locked state (optional, Phase 2):** for an owned line with an eligible Mega and no unlock, a grayscale card with a lock and "Needs Charizardite X". Shown only when the player has the stone or opts in, so the grid doesn't fill with locks.
- Mega cards are excluded from: Pokédex counts, region and type progress, donate, bulk donate, gift, evolve and shiny craft. Their action menu has only "Add to team", "Details" and "Compare".
- A filter chip "Megas" shows only Mega cards.

### Team builder

- A Mega card can be added like any card. The API stores `{ id, variant, mega }`.
- **One Mega per team:** adding a second Mega is blocked client-side ("Only one Mega per team; replace Mega Charizard X?") and enforced server-side.
- A base card and its own Mega can't both be on the team (same Pokémon; decision D-2). Adding one offers to swap out the other.
- The team view shows the Mega's types, and a "Mega" badge on the slot.

### Pokémon detail panel

- A tab per form: base / Mega X / Mega Y.
- Stat bars, base vs Mega (bot base stats for #1–649 are Gen 5 values; the comparison labels them "your Pokémon's stats").
- Type change, and weakness changes (e.g. Charizard X loses its 4× Rock weakness).
- Ability name, the official description, and the **Coop-battle status** badge.
- Normal/shiny preview toggle. The grayscale image is used when locked.
- The "Unlock" button appears when a matching stone is in the bag. It confirms, then calls `POST /api/mega/unlock` with a client-generated `requestId` (replay-safe; same pattern as the bag).

### Bag (`public/bag`)

- A "Mega Stones" category (stone icons from the Showdown item sprites, licence-checked in the asset phase), the count, and "Use on…" listing eligible owned lines.
- Mega Shards and the 25-shard exchange (if D-12 is approved).

### API (new)

| Endpoint | Body | Effect |
|---|---|---|
| `GET /api/mega` | — | Catalogue subset (activatable forms), the user's unlocks, eligible lines |
| `POST /api/mega/unlock` | `{ id, line, stone, form?, requestId }` | `unlockMega` transaction |
| `POST /api/mega/exchange` | `{ id, from, to, requestId }` | Shard exchange (if approved) |
| `POST /api/set-pokemon-team` | accepts `mega` per slot | validation from `MEGA-BATTLE-DESIGN.md` §2 |

`/api/updateUser` keeps its strict whitelist. It never accepts `megaUnlocks` or `mega`.

## 4. Base form vs battle form

All copy says "battle form". Pokédex, trainer card counts, `/pokedex` and achievements use only the base species. The Mega card never replaces the base card: owning a Mega Charizard X card always means owning a Charizard. A Mega card can't exist without its owned base line, and it disappears (dormant) if the line is gone.
