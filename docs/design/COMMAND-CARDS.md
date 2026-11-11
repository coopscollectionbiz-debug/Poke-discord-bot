# Command Cards — Milestone C rollout

Branch `design/visual-ux-overhaul`, rebased onto master `15caf105` (it includes PR #52 private battle EXP and PR #55 achievements test fix). **Not committed, merged or deployed.**

Every card uses the design system (DESIGN-SYSTEM.md): the battle background, local 2D sprites at whole-number scales, type chips, a name-only rarity pill, a flat EXP bar (never the HP bar), gold for shiny and blue for the lead.

Every command keeps its old embed or text as a **fallback** if rendering throws. No card changes game rules, rewards, saves, odds or permissions.

| Command | Before | Now | Code | Previews |
|---|---|---|---|---|
| `/showteam` | 1200 × 520 canvas, HTTP-fetched sprites, ghost slots | Refined A/B layout. GIF, one render at a time, PNG fallback, `SHOWTEAM_ANIMATED=0` forces PNG. Inspect select (anyone) and Manage Team link (owner). | `commands/showteam.js`, `utils/render/showteamRefined.js` | `hybrid-ab-refined-*` |
| `/battle`: private EXP | Plain-text list per player | **EXP card**: Victory or Defeat, rating ▲/▼, underdog surge, wager pot, and per member the sprite, Lv before → after, "LEVEL UP!", +EXP, current EXP bar and learned moves. Caption "EXP from your battle with X:". | `commands/battle.js` (`expMessage`), `utils/render/expCard.js` | `battle-exp-winner.png`, `battle-exp-loser.png` |
| `/battle`: public result | Rating-only embed (since PR #52) | Unchanged, plus a **wager-pot line** ("💰 X takes the **N CC** pot!"), which PR #52 had dropped and nothing else showed. On `feat/challenges`, the replay frames also show **each player's displayed trainer** at the left of their row (tiles 144 → 124 px; the frame stays 900 wide). | `utils/battle/playback.js`, `utils/battle/render.js` | `battle-start-portraits.png` |
| `/leaderboard` | Numbered text embed | **Podium** for the top 3 (trainer sprites on gold, silver and bronze), rows 4–10 with lead Pokémon, W–L and win %. The viewer's row is highlighted, or pinned below when outside the top 10. The ranking function is unchanged. | `commands/leaderboard.js`, `utils/render/leaderboardCard.js` | `leaderboard-top.png`, `leaderboard-outside.png` |
| `/daily` | 3 embeds, "GIF"-badged thumbnails | **One card**: the two Pokémon (catch Level, types, rarity, NEW or +EXP), +CC, +TP, Evolution Stone when it drops, balance, and **RANK UP** when the TP crosses a rank. It uses `grantCatch`'s results, which were previously discarded. | `commands/daily.js`, `utils/render/dailyCard.js` | `daily-stone-rankup.png`, `daily-plain.png` |
| `/trainercard`, `/showcard` | Text embed, emoji stars, thumbnail | **Trainer card**: the equipped trainer at 4× on a tier-lit platform, name and rarity, rank with progress to the next rank, TP, CC, Pokémon, shiny, trainers, rating and record, the 8 Badges from `/challenge` (earned ones in color; added after the previews were taken), and a Team strip (the battle Team). | `commands/trainercard.js` (`showTrainerCard`), `utils/render/trainerCard.js` | `trainercard-full.png`, `trainercard-new.png` |
| `/pokedex` | Embed + hot-linked sprite | **Pokédex entry card**: dex number, region, name, types, rarity, flavor text, evolution line, owned normal / shiny. The shiny toggle re-renders the card. The #650+ sprite credit is printed on the card. | `commands/pokedex.js`, `utils/render/pokedexCard.js` | `pokedex-*.png` |
| `/inspectpokemon` | Text stats line | The `/showteam` inspect card: one per owned variant (stats at your Level, battle moves), or a base-stats card when you own neither | `commands/inspectpokemon.js` (`inspectSlots`), `utils/render/inspectCard.js` | `inspectpokemon-owned.png`, `inspectpokemon-base.png` |
| `/challenge` (branch `feat/challenges`) | Board: a text embed. Preview and intro: an embed with hot-linked leader and Badge images. Replay: the `/battle` layout. Result: an embed with EXP | **Board**: the 8 Gyms (leader, type, Badge lit once earned) and the League on dark stages, locked opponents as unnamed silhouettes, CLEARED in gold. **VS card** for the private preview and the public intro: the challenger's trainer, Badges and Team on a blue half, the opponent on a half tinted with their type, their party as Poké Balls, the Badge "on the line", the prize, "Lose: 10% of CC", and alt text. The exact loss is a text line on the private preview only. **Replay frames** get trainer portraits, the opponent's type tint and chip, and the Badge in the center pill; a first win adds an **award screen** (the Badge at 6× with sparkles, or a gold title). **After the match**, `/battle`'s flow: an embed with only what the image doesn't say, and the private **EXP card** captioned with the exact loss or the prize. | `commands/challenge.js` (`boardMessage`, `previewMessage`, `challengeExpMessage`), `utils/render/challengeBoard.js`, `utils/render/challengeCard.js`, `utils/battle/render.js` (`theme`), `utils/battle/playback.js` (`challengeTheme`, `challengeAward`) | `challenge-board-partway.png`, `challenge-board-champion.png`, `challenge-vs-gym.png`, `challenge-vs-elite4.png`, `challenge-battle-start.png`, `challenge-badge-award.png` |
| Trainer encounters (branch `feat/challenges`) | New | **Encounter card** in the channel the player chatted in: the challenge VS card's split field, toned down (no type tint, no Badges, no text in the field), the player's trainer and Team against the Trainer under the games' "!" (16×16 pixel art at 4×), their party as Poké Balls, a games-style text box ("Youngster Joey challenged Ash!" and the Trainer's line), and the Prize money in gold beside it; alt text; an embed when it can't render. Run or no answer shrinks it to one text line. **Replay**: `/battle`'s layout with both trainers' portraits; the embed under the final image has the Trainer's after-battle line and the Prize money or "whited out". **After the match**, the private EXP card. | `utils/encounter/service.js`, `utils/render/encounterCard.js`, `utils/render/primitives.js` (`drawAlertBubble`), `utils/battle/playback.js` (`playEncounter`) | `encounter-card.png`, `encounter-card-ace.png` |
| **Random catch** (passive chat reward) | Ping line + 80 px "GIF"-badged thumbnail embed; the catch said twice; broadcast channels used different wording | **Catch card** under "🎉 @you caught a wild **X**!". It shows NEW or +EXP · ×N owned, the catch Level, types, rarity and regional Pokédex progress. Shiny and Rare-or-better catches are animated (one GIF at a time, PNG if busy, `CATCH_ANIMATED=0` forces PNG). Broadcast channels get the **same card** under a no-ping caption. Daily, trainer and admin broadcasts keep their embed. | `bot_final.js` (tryGiveRandomReward), `utils/render/catchMessage.js`, `utils/broadcastReward.js` (optional `image`/`caption`) | `catch-*.png/.gif`, `catch-discord-*.png` |

## Behavior notes

- **`/trainercard` counts** "Pokémon" as species with at least one copy now. Previously it counted every inventory key, including emptied entries and form keys. The "Team" strip is the battle Team, so ghost slots are gone. The existing step that saves a fallback team when none is set is **unchanged**.
- **`/daily`** still grants the same Pokémon, CC, TP and stone in the same order, saves the same way, and broadcasts the same way. The card only reads `grantCatch`'s return value.
- **`/leaderboard`** now defers its reply (rendering takes ~50 ms) and edits it with the image.
- **`/pokedex`** closes cleanly: Close removes the attachment, not just the embed.
- **Sprites everywhere** are read from local files through the manifest. No command hot-links `/public/sprites/...` for these views any more.
- **Display names** come from `utils/render/names.js` ("Mr. Mime", not "Mr-mime"). Stored names and search are unchanged.

## Tests

| Change | Detail |
|---|---|
| New | `tests/commandCards.test.js` (39 checks) |
| New (`feat/challenges`) | `tests/challengeCard.test.js` (41), `tests/challengeBoard.test.js` (32), `tests/encounterCard.test.js` (24) |
| Updated (`feat/challenges`) | `tests/battleRender.test.js`: portraits on every replay, the challenge styling and award screen. `tests/battleCommand.test.js`: each player's trainer in the replay. `tests/challengePlayback.test.js` and `tests/challengeCommand.test.js`: the card, the styling and the award in place of the embed images |
| New | `tests/catchMessage.test.js` (19) |
| New | `tests/showteamCommand.test.js` (30) |
| New | `tests/showteamRender.test.js` (88) |
| Updated: pinned the old presentation | `tests/runBattle.test.js`: a Wager result embed now has the pot description |
| Updated | `tests/battleCommand.test.js`: the private EXP message is a caption + card |
| Updated | `tests/gen69Display.test.js`: `/pokedex` sends the entry card, and the credit is on the card |

Full suite: **49/49 test files pass** on the rollout branch, and **56/56** on `feat/challenges`.

## Not done (needs your call)

- **Font bundling.** Fly renders in DejaVu Sans. All text is fitted by measurement.
- **Before release:** check Discord's image height cap in a real client, and measure render time and RSS on Fly. Every merge to master deploys.

## Follow-up (2026-11-10, after PR #56 went live)

The owner's feedback from production, and what changed:

| Feedback | Change |
|---|---|
| "The random catch is too big" | The catch card is now a **900 × 240** banner (about 550 × 147 in Discord; it was 1000 × 360, about 550 × 198). Pokédex progress moved onto its own short line. |
| "Remove the 'Caught by' section" | Removed. The caption above the card already names the catcher. |
| "Sprites should be animated everywhere, on every card, where available" | New shared **sprite stage** (`utils/render/stage.js`). In GIF mode, each card draws everything once and redraws only the Pokémon sprites per frame, using the battle's sprite player. This now applies to the catch card (every catch, not only shiny or Rare+), the inspect card, the battle EXP card, the leaderboard leads, `/daily`, the trainer card's Team strip and `/pokedex`. A card whose sprites are all static (for example #1025) stays a PNG. Trainer sprites are static PNG art. |
| "Rare sightings wasn't updated" | `broadcastReward` used to fall back to the old embed whenever the caller passed no card: `/daily`, the starter pack (`/shop`) and dashboard rewards. It now renders a **sighting card** itself (sprite, name, types, rarity; "RARE POKÉMON FOUND!"), so every Pokémon broadcast in every channel, rare sightings included, is a card. Trainer broadcasts keep their embed. |

**Load limits:** one **shared GIF gate** (`cardGifGate`, limit 2) now covers every card, including `/showteam`. A request that finds both slots busy gets the PNG immediately.

**Kill switches:** `CARDS_ANIMATED=0` turns off all animation. The per-surface switches `SHOWTEAM_ANIMATED=0` and `CATCH_ANIMATED=0` still work.

**Measured on the dev PC** (PNG / GIF):

| Card | PNG | GIF |
|---|---|---|
| Catch | 8 ms | 99 ms, 58 KB |
| Inspect | — | 144 ms |
| EXP | — | 180 ms |
| Leaderboard | — | 264 ms |
| Daily | — | 155 ms |
| Trainer | — | 203 ms, 343 KB |
| Pokédex | — | 122 ms |

Peak RSS for the whole benchmark process was 169 MB. Expect Fly to be 2–3× slower.

### National Pokédex number and private Pokédex progress (same follow-up)

**National Pokédex number** (`#0613`, the shared `dexNo()` helper):

| Card | Where the number is |
|---|---|
| Catch / sighting | Beside the rarity pill |
| `/showteam` | After the slot badge (and LEAD tag), on a dark backing |
| `/daily` | After the NEW / +EXP tag |
| Battle EXP | Bottom-right of each tile |
| Inspect, `/pokedex` | Already shown there; both now use the same helper |

**Public cards no longer show Pokédex progress.** "Kanto Pokédex 121/151" read confusingly next to the National number. The catch card dropped it and shrank to **900 × 200** (about 550 × 122 in Discord).

**Private progress instead.** Random catches come from chat messages, and Discord allows private replies only to interactions, so there is no private reply after a catch. The owner chose to show progress in the two private views:

- **`/daily`**: a Pokédex strip with the regions of today's two Pokémon, then **National**.
- **`/pokedex`**: a "Your Pokédex" row with the species' region, then National.

**How it's counted** (`utils/render/dexProgress.js`, following CONTEXT.md): distinct species owned now, in either variant.
- **Regional:** out of the region's size from the achievements catalog.
- **National:** out of the species in released generations (649 with Gens 1–5). It grows when a generation is released.
