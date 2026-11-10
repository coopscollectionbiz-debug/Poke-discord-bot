# Command Cards — Milestone C rollout

Branch `design/visual-ux-overhaul`, rebased onto master `15caf105` (it includes PR #52 private battle EXP and PR #55 achievements test fix). **Not committed, merged or deployed.**

Every card uses the design system (DESIGN-SYSTEM.md): the battle background, local 2D sprites at whole-number scales, type chips, a name-only rarity pill, a flat EXP bar (never the HP bar), gold for shiny and blue for the lead.

Every command keeps its old embed or text as a **fallback** if rendering throws. No card changes game rules, rewards, saves, odds or permissions.

| Command | Before | Now | Code | Previews |
|---|---|---|---|---|
| `/showteam` | 1200 × 520 canvas, HTTP-fetched sprites, ghost slots | Refined A/B layout. GIF, one render at a time, PNG fallback, `SHOWTEAM_ANIMATED=0` forces PNG. Inspect select (anyone) and Manage Team link (owner). | `commands/showteam.js`, `utils/render/showteamRefined.js` | `hybrid-ab-refined-*` |
| `/battle`: private EXP | Plain-text list per player | **EXP card**: Victory or Defeat, rating ▲/▼, underdog surge, wager pot, and per member the sprite, Lv before → after, "LEVEL UP!", +EXP, current EXP bar and learned moves. Caption "EXP from your battle with X:". | `commands/battle.js` (`expMessage`), `utils/render/expCard.js` | `battle-exp-winner.png`, `battle-exp-loser.png` |
| `/battle`: public result | Rating-only embed (since PR #52) | Unchanged, plus a **wager-pot line** ("💰 X takes the **N CC** pot!"), which PR #52 had dropped and nothing else showed | `utils/battle/playback.js` | — |
| `/leaderboard` | Numbered text embed | **Podium** for the top 3 (trainer sprites on gold, silver and bronze), rows 4–10 with lead Pokémon, W–L and win %. The viewer's row is highlighted, or pinned below when outside the top 10. The ranking function is unchanged. | `commands/leaderboard.js`, `utils/render/leaderboardCard.js` | `leaderboard-top.png`, `leaderboard-outside.png` |
| `/daily` | 3 embeds, "GIF"-badged thumbnails | **One card**: the two Pokémon (catch Level, types, rarity, NEW or +EXP), +CC, +TP, Evolution Stone when it drops, balance, and **RANK UP** when the TP crosses a rank. It uses `grantCatch`'s results, which were previously discarded. | `commands/daily.js`, `utils/render/dailyCard.js` | `daily-stone-rankup.png`, `daily-plain.png` |
| `/trainercard`, `/showcard` | Text embed, emoji stars, thumbnail | **Trainer card**: the equipped trainer at 4× on a tier-lit platform, name and rarity, rank with progress to the next rank, TP, CC, Pokémon, shiny, trainers, rating and record, the 8 Badges from `/challenge` (earned ones in color; added after the previews were taken), and a Team strip (the battle Team). | `commands/trainercard.js` (`showTrainerCard`), `utils/render/trainerCard.js` | `trainercard-full.png`, `trainercard-new.png` |
| `/pokedex` | Embed + hot-linked sprite | **Pokédex entry card**: dex number, region, name, types, rarity, flavor text, evolution line, owned normal / shiny. The shiny toggle re-renders the card. The #650+ sprite credit is printed on the card. | `commands/pokedex.js`, `utils/render/pokedexCard.js` | `pokedex-*.png` |
| `/inspectpokemon` | Text stats line | The `/showteam` inspect card: one per owned variant (stats at your Level, battle moves), or a base-stats card when you own neither | `commands/inspectpokemon.js` (`inspectSlots`), `utils/render/inspectCard.js` | `inspectpokemon-owned.png`, `inspectpokemon-base.png` |
| `/challenge` (branch `feat/challenges`) | Preview and intro: an embed with hot-linked leader and Badge images. Replay: the `/battle` layout | **VS card** for the private preview and the public intro: the challenger's trainer, Badges and Team on a blue half, the opponent on a half tinted with their type, their party as Poké Balls, the Badge "on the line", the prize, "Lose: 10% of CC", and alt text. The exact loss is a text line on the private preview only. **Replay frames** get trainer portraits, the opponent's type tint and chip, and the Badge in the center pill; a first win adds an **award screen** (the Badge at 6× with sparkles, or a gold title). `/battle` frames are unchanged. | `commands/challenge.js` (`previewMessage`), `utils/render/challengeCard.js`, `utils/battle/render.js` (`theme`), `utils/battle/playback.js` (`challengeTheme`, `challengeAward`) | `challenge-vs-gym.png`, `challenge-vs-elite4.png`, `challenge-battle-start.png`, `challenge-badge-award.png` |
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
| New (`feat/challenges`) | `tests/challengeCard.test.js` (41) |
| Updated (`feat/challenges`) | `tests/battleRender.test.js`: the challenge styling and award screen. `tests/challengePlayback.test.js` and `tests/challengeCommand.test.js`: the card, the styling and the award in place of the embed images |
| New | `tests/catchMessage.test.js` (19) |
| New | `tests/showteamCommand.test.js` (30) |
| New | `tests/showteamRender.test.js` (88) |
| Updated: pinned the old presentation | `tests/runBattle.test.js`: a Wager result embed now has the pot description |
| Updated | `tests/battleCommand.test.js`: the private EXP message is a caption + card |
| Updated | `tests/gen69Display.test.js`: `/pokedex` sends the entry card, and the credit is on the card |

Full suite: **49/49 test files pass** on the rollout branch, and **55/55** on `feat/challenges`.

## Not done (needs your call)

- **Font bundling.** Fly renders in DejaVu Sans. All text is fitted by measurement.
- **Before release:** check Discord's image height cap in a real client, and measure render time and RSS on Fly. Every merge to master deploys.
