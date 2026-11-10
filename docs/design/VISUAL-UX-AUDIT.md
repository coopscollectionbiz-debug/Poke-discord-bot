# Visual & UX Audit — Coop's Collection

Milestone A, part 1. Audited at master `5157cfe6` (Gen 6–9 code live, generations 6–9 off) on 2026-11-09.
Branch: `design/visual-ux-overhaul`. Nothing here was deployed. No player data was read.

Each finding is labeled with one of these tags:

| Tag | Meaning |
|---|---|
| **EXISTS** | Current behavior, verified in code |
| **PROBLEM** | Confirmed defect or inconsistency, with a file reference |
| **PROPOSAL** | Presentation change using data and APIs that already exist |
| **NEEDS APPROVAL** | New functionality, new write path, new dependency or new asset |
| **LIMIT** | Technical limitation |
| **PERF** | Performance risk |

---

## 1. What the game actually has (the data contract)

Any redesign has to fit this model. The brief asks for several attributes that **the game does not have**. They must not appear in any UI, because showing them would mean inventing them:

| Brief asks for | In the game? | Evidence |
|---|---|---|
| Nicknames | **No** | No `nickname` field anywhere in `commands/`, `utils/`, `services/`, `routes/`, `public/` |
| Abilities, natures | **No** | `battleData.json` species = `{name, types, baseStats, levelMoves}` only |
| IVs / EVs | **No** (fixed) | `utils/battle/tuning.js:9` `IV = 15 // fixed for everyone: no IVs/EVs/natures` |
| Persistent HP / status | **No** | HP exists only inside a simulated battle (`utils/battle/sim.js`) |
| Held items | **No** per-Pokémon | Items are a player-level bag (`services/inventory.js`) |
| Alternate forms | **Architecture only, all disabled** | `utils/forms.js` `isFormEnabled()` always returns false |
| Level, EXP | **Yes**, per species + variant | `utils/training.js` (`user.training["6:normal"].exp`) |
| Shiny | **Yes** (variant) | `user.pokemon[id] = {normal, shiny}` |
| Types, tier, region, generation | **Yes** | `pokemonData.json`, `battleData.json` |
| Stats at Level | **Derivable** | `computeStats(baseStats, level)` in `utils/battle/stats.js` |
| Moves | **Derivable** (auto) | `autoMoveset(id, level)`: the last 4 level-up moves, as battles use them |
| Team Power | **Derivable** | `teamPower()` in `utils/battle/power.js` |
| Battle rating, W/L | **Yes** | `user.battle` (`utils/battle/rewards.js`) |
| Rank, TP | **Yes** | `utils/rankSystem.js` |

A Pokémon in this game is a **species + variant**, not an individual. That one fact drives most of the layout decisions in this document.

---

## 2. Battle presentation: the reference standard

`utils/battle/render.js` (448 lines) is a self-contained renderer built on `@napi-rs/canvas`, `omggif` and `gifenc`.

| Aspect | What exists | Verdict |
|---|---|---|
| Architecture | One animated GIF per playback update. Frames are encoded as they are drawn, and sprite frames are decoded lazily (`spritePlayer`). The code comments memory measurements (60 MB vs 270 MB). | **Reuse.** The encoder technique is now shared in `utils/render/gif.js` (prototype). |
| Sprite loading | Local files `public/sprites/pokemon/{variant}/{id}.gif`, with grayscale for fainted Pokémon. Missing sprites return `null`. | **Reuse** (`loadSprite`, `spritePlayer` are imported by the prototype) |
| Sprite positioning | Bottom-anchored on an ellipse platform at 1×, with no scaling. | **Refine:** 1× sprites are small. The prototype uses a uniform 2×. |
| Background | Vertical gradient `#141a2c → #1d1530`, with side panels tinted in the side color. | **Reuse** as the brand background |
| Typography | `system-ui, 'DejaVu Sans', …`. Names 13 px and levels 12 px on a 900 px frame. | **Refine:** at Discord's ~550 px display, 13 px becomes about 8 px. |
| Color | INK `#0e1120`, GOLD `#f5c84c`, side blue `#4f8cff` and red `#ff5a6a`, HP green/yellow/red | **Reuse** as tokens (`utils/render/tokens.js`) |
| HP / status | Game-style HP bar with an "HP" tag and green→yellow→red. Poké Ball row for alive or fainted. | **Reuse** (HP is only meaningful in battle) |
| Info layout | Name + Lv + HP per tile. No types, no tier. | **Extend** with type chips outside battles |
| Size / quality | 900 × 468 GIF, 255-color global palette, delta frames | Good |
| Caching | A per-battle `Map` of loaded sprites. No cross-battle cache. | Fine for battles |

**Elements to reuse everywhere:** the night-sky background, the ink/gold palette, platforms, the Poké Ball row, the game text box, bottom-anchored pixel sprites, and the HP colors.

---

## 3. Discord command audit

There are 29 commands. Player-facing commands are listed first. "Admin" means admin-gated in code.

| Command | Presentation | Info shown | Interaction | Problems | Priority |
|---|---|---|---|---|---|
| **/showteam** | Canvas PNG 1200 × 520 (`utils/trainerCardCanvas.js`) | Trainer, rank, TP, avatar, trainer sprite, 6 tiles (tier badge, sprite at 86 px, name, Lv, #id) | None | See §3.1 | **P0** |
| /trainercard, /showcard | Embed: team as fields, lead sprite as image, trainer thumbnail. Also the onboarding flow (starter and trainer pickers with buttons). | Rank, TP, CC, team list | Prev/Next/Select buttons on onboarding | Text-list team; color `0x5865f2` (Discord blurple) instead of the brand. `/showcard` duplicates `/trainercard`. | P1 |
| /inspectpokemon | Ephemeral embed with a sprite image | Rarity, type, region, then "Your Lv … HP x · Atk y …" and the move list as text | None | Wall of text; stats as one long line; color `0x1abc9c`; never shows the shiny sprite | **P1** |
| /pokedex | Embed + shiny toggle button | Rarity, types with emoji, flavor | Toggle shiny, Close | Separate type→emoji map (`commands/pokedex.js:28-75`); color by tier | P2 |
| /inventory | Embed + category select + pager (`inv:` nonce) | Items, quantities, uses | Select, Prev/Next | Sound structure (Release B). Text-only. | P2 |
| /achievements | Embed + category select + pager + Claim | AP, x/y, %, per-achievement lines | Select, Prev/Next, Claim | Sound (Release C); color `0xf5b301` | P2 |
| /battle | Animated GIF playback + wager buttons | Full battle | Accept/Decline | **The reference** | — |
| /leaderboard | Embed, numbered text | Name, rating, W–L | None | Plain text; color `0xf1c40f` | P3 |
| Random catch (passive chat reward; `bot_final.js` + `utils/broadcastReward.js`) | Ping line + embed with an 80 px thumbnail; separate broadcast embed with different wording | Name, tier | None | Thumbnail covered by Discord's GIF badge; catch said twice; discards the catch Level/NEW result; slug names (see SHOWTEAM-REDESIGN.md "Related") | **P1** |
| /daily | 3 embeds (two Pokémon + summary) | Sprites, rarity, rewards | None | Emoji tier marks; three embeds per claim | P2 |
| /showtrainers | Embed pager + class inspect buttons | Trainer collection | Prev/Next/Close/Inspect | Colors `0x43b581`, `0x3498db`; generic `prev`/`next` custom IDs | P3 |
| /dashboard | Ephemeral embed with a one-time link | Link | None | — | — |
| /luck, /swapicon, /quest, /recruit, /gift | Embeds | Various | Some buttons | Inconsistent colors and emoji | P3 |
| Admin (12): addcurrency, addinventory, adminsave, admindashboard, fixroles, resetdaily, resetteam, resetstarterpack, resetuser, resetweekly, shop, viewuser, inspecttrainer | Plain text or embeds | — | — | Out of scope (not player-facing) | — |

Interaction-ID conventions **EXIST** and are sound in newer commands (`inv:${nonce}:…`, `ach:${nonce}:…`, `wager_accept:${nonce}`). Older commands use bare IDs (`prev`, `next`, `toggle_shiny`) inside message-scoped collectors.

### 3.1 `/showteam` confirmed problems

1. **PROBLEM:** It shows Pokémon the battle Team will not use. `commands/showteam.js:68` reads `displayedPokemon` raw and does not filter out variants the player no longer owns. Battles use `buildTeam()` (`utils/battle/runBattle.js:25`), which does. After a donation, `/showteam` can show a "ghost" slot that never fights. It also does not deduplicate.
2. **PROBLEM:** The fallback can show a variant the player doesn't own. `showteam.js:72-76` takes the first six `user.pokemon` keys as `normal` even when only the shiny is owned.
3. **PROBLEM:** Sprites are fetched over HTTP from the bot's own public URL (`showteam.js:89-92` → `trainerCardCanvas.js:120`). That costs up to 12 network round trips per render, and each one tries a `.png` that never exists before falling back to the `.gif`. Rendering fails whenever the public host is unreachable. Sprite URLs are built by hand instead of going through the manifest (`utils/sprites.js`).
4. **PROBLEM (latent crash):** `utils/trainerCardCanvas.js:290` calls `path.basename` and `:215-218` reads `spritePaths`, but neither is imported. Today's call site happens to avoid both branches.
5. **PROBLEM:** Types are not shown at all, although they are the most recognizable Pokémon fact.
6. **PROBLEM:** Readability. The 1200 × 520 image (2.3:1) shows at about 550 × 238 in Discord, so its 16 px secondary text renders at about 7 px. Sprites are drawn into an 86 px box with smoothing, which blurs the pixel art.
7. **PROBLEM:** "Empty" slots are a gray word in the corner. "Sprite failed" / "Trainer sprite failed to load" debug text can reach players.
8. **PROBLEM:** The `✨` emoji is drawn into the canvas. The production image (`node:22-slim` + Cairo/Pango build deps) ships no emoji font, so it likely renders as a box. Tier marks use `✮` glyphs, which have the same risk.

### 3.2 Cross-command inconsistencies

- **Six different brand colors** are used for embeds: `0x5865f2`, `0x1abc9c`, `0xf5b301`, `0xf1c40f`, `0x43b581` and `0x3498db`, plus tier colors.
- **Three copies of the tier palette:** `spriteconfig.js`, `utils/rarityPalette.js` and `utils/colors.js` (identical), plus `TIER_COLORS` in `trainerCardCanvas.js`.
- **Two type-id maps:** `utils/battle/data.js` (title case) and `commands/pokedex.js` (lower case + emoji).
- **Two team normalizers:** `utils/teamNormalize.js` and a local copy in `showteam.js`/`trainercard.js`.
- **PROBLEM: 24 species show API slugs as names.** Examples: "Mr-mime", "Nidoran-f", "Ho-oh", "Giratina-altered", "Darmanitan-standard", "Basculin-red-striped", "Deoxys-normal" (`pokemonData.json`). This affects every command and the dashboard. The prototype adds a display-only map (`utils/render/names.js`) and leaves stored names untouched, because name search and achievements use them.

---

## 4. Dashboard audit

| Area | What exists | Tag |
|---|---|---|
| Framework | Static HTML + vanilla JS + CSS per page under `public/`, served by Express in `bot_final.js`. No build step. | EXISTS |
| Pages | `picker-pokemon` (Manage Pokémon, 76 KB JS), `picker` (Trainers), `dashboardshop` (Shop), `bag`, `achievements`, `credits`, `admindashboard` | EXISTS |
| Orphan | `public/dashboard/` (`dashboard.html`, 38 KB script) has no route and no link | PROBLEM (dead code) |
| Auth | `/dashboard` creates a one-time token. `/auth/dashboard` sets an httpOnly `dashboard_session` cookie (**10 min** `maxAge`) and redirects to `picker-pokemon?id=…`. Every `/api/*` route checks `requireDashboardSession(req, id)`. | EXISTS |
| Session length | 10 minutes, then every call returns 403 and the player has to run `/dashboard` again | PROBLEM (UX); changing it is NEEDS APPROVAL (security trade-off) |
| Write guard | A POST is refused while the bot isn't ready or saves are degraded (503) | EXISTS (good) |
| Navigation | One row of 5 emoji tab *buttons* that navigate by `location.href` with `?id=`. There is no Overview/Home page. | PROBLEM (no IA, buttons used as links, no current-page semantics) |
| Pokémon page | Grid of **all** species (owned and unowned), with search, rarity, type, owned/unowned toggles, and modes Team/Evolve/Donate/Convert, multi-select and bulk donate | EXISTS |
| Large collections | Renders every card at once (up to 1,025 animated GIFs). No pagination or virtualization. | PERF |
| Team management | Click-to-toggle in "Change Team" mode + "Save Team". `POST /api/set-pokemon-team` validates 1–6 unique owned slots under the user lock. **This is the only player write path for the Team.** | EXISTS |
| Team reorder | Order follows click order. There is no way to reorder without clearing the slots. | PROBLEM |
| Pokémon detail | No detail view | Proposed |
| Tokens | Three conflicting `:root` palettes: picker `--brand:#00ff9d` (neon green), shop `--brand:#3b82f6`, admin `--accent:#ef4444`. Bag and achievements borrow the shop CSS. | PROBLEM |
| Fonts | Inter from Google Fonts | EXISTS |
| Responsive | One `@media (max-width:520px)` block each in picker-pokemon and shop; none elsewhere | PROBLEM |
| Accessibility | 3 `aria-` attributes across all player pages. Emoji-only labels. `alert()`/`confirm()` dialogs (6 in picker). No visible focus styles were audited. | PROBLEM |
| Loading / error states | Ad hoc text; expiry shows raw 403 messages | PROBLEM |
| Data | `public/pokemonData.json` is a full copy of the root file (identical today, but it can drift) | Risk |
| APIs available | `GET /api/user`, `/api/user-pokemon` (pokemon, currentTeam, levels, items, cc, tp, rank), `/api/inventory`, `/api/achievements`, `/api/user-trainers`, `/api/shop-trainers`, `/api/pokedex-status`. Writes: set-pokemon-team, evolve, donate, donate-bulk, convert-to-shiny, set-trainer, unlock-trainer, shop/buy-stone, weekly-pack, achievements/claim. | EXISTS |
| APIs missing for the brief | Battle record/rating per player for an Overview, server-side search/sort/paging, per-species detail (stats/moves are computed only in bot code), recent activity feed | NEEDS APPROVAL (backend) |

---

## 5. Technical limitations

- **LIMIT:** Discord shows an attached image at about 550 px wide (desktop) and the full message width (~360 px) on phones. Detail text in an image will not survive that downscaling, so images should carry identity (sprite, name, Level, type color) and leave detail to embeds or ephemeral follow-ups. The prototype checks this (`docs/design/previews/readability-sheet.png`).
- **LIMIT:** Discord components: 5 action rows, a select menu has 25 options, and custom-ID nonces are already the pattern. A Team has at most 6, so one select menu covers "inspect a slot".
- **LIMIT:** Discord's attachment limit is 8 MB (higher with boosts). The animated Team GIF is about 0.5 MB.
- **LIMIT:** Fonts. The production image has no emoji font and no Inter; text falls back to DejaVu Sans, which is wider than the Segoe UI used for the local previews. The prototype draws shiny marks and tier pips as vectors (no emoji) and fits every string by measurement. Bundling a font is NEEDS APPROVAL (see DESIGN-SYSTEM §7).
- **LIMIT:** Sprites are 2D B/W-style for every generation: PokéAPI B/W for #1–649 and Smogon gen5(ani) for #650–1025, 156 of them static. There are no back sprites in the manifest, and forms are disabled.

## 6. Performance risks

- **PERF:** Production is a single 512 MB machine. The battle notes about 220 MB free. A full-team animated GIF measured **~0.5–0.85 s and RSS ≈ 111 MB** for the whole preview process (Windows dev box). Concurrent `/showteam` GIFs need a concurrency cap (a semaphore of 2) or PNG-first.
- **PERF:** A PNG Team image takes **~50–90 ms** cold and ~50 ms warm, with no network calls (today's command makes up to 12 HTTP fetches).
- **PERF:** The dashboard renders ≤1,025 GIFs at once (see §4).

---

## 7. Prioritized problem list

| # | Problem | Fix in |
|---|---|---|
| 1 | `/showteam` ghost slots and wrong-variant fallback (data correctness on screen) | Milestone C (prototype view model already fixes it) |
| 2 | `/showteam` readability, missing types, blurred sprites | Milestone C |
| 3 | HTTP self-fetch of sprites in `/showteam` | Milestone C |
| 4 | 24 slug names shown to players | Milestone C (display map, all commands) |
| 5 | Latent `path`/`spritePaths` crash in `trainerCardCanvas.js` | Milestone C |
| 6 | Dashboard has no Home, 3 palettes, weak mobile and a11y | Milestone D |
| 7 | Team reorder impossible; no Pokémon detail | Milestone E |
| 8 | Dashboard renders the whole Pokédex at once | Milestone E |
| 9 | Six embed colors, duplicate palettes and maps | Milestone C (tokens) |
| 10 | 10-minute dashboard session | Decision for the owner |
