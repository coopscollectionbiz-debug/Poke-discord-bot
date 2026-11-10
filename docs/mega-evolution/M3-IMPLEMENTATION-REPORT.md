# Mega Evolution: Phase M3 implementation report (visual and Discord integration)

| | |
|---|---|
| Branch | `feature/mega-evolution-m3` (local only; not pushed, no PR) |
| Worktree | `E:\Poke-discord-bot-mega-m3` |
| Based on | M2 `8d793c8a`, plus a merge of current master `38884217` (`6e03179d`) |
| Production | Untouched. No push, no deploy, no Fly.io or environment change, no player data, no stones distributed, no encounter or generation change. Mega battles still need `MEGA_EVOLUTION_ENABLED` **and** `MEGA_BATTLES_ENABLED=1`; neither is set. Rewards stay hard-off. |

## 1. Summary

- **What players see:** every surface shows the same form the battle engine uses.
  - Surfaces: `/showteam` and its Inspect card, the trainer card (`/trainercard`, `/showcard`), the EXP card, battle images, the leaderboard lead and the dashboard.
  - A Team slot appears as a Mega **only when it would battle as one**.
  - Otherwise it appears as its base form with a plain-language reason.
- **One rule set:** `utils/megaDisplay.js`.
- **Sprites:** the existing loaders now accept Mega form ids and read only the validated Mega manifest. A missing Mega sprite gives the placeholder, never the base form's art.
- **Dashboard Mega cards:** rebuilt on the PR #56/#57 design system, with three battle states, collection progress kept apart from the Pokédex, and an explanation line for the Team.
- **Gates** (all pass):

  | Gate | Result |
  |---|---|
  | No-Mega Discord images vs master | **23/23 byte-identical**, with Mega off **and** with every switch on |
  | No-Mega dashboard vs master | identical markup and layout at desktop, tablet and mobile |
  | 3,000-battle regression | **0 differences** |
  | Full suite | **61/61 files, 2,099/2,099 assertions** |

## 2. Master integration

`origin/master` was `38884217` (PRs #52, #55, #56, #57, #58) and has not moved since. It was merged into the M3 branch first (`6e03179d`), in this worktree only, and M3 was built on top. Master itself is unchanged and nothing was merged into it.

| PR | Effect on M3 |
|---|---|
| #56/#57 visual overhaul and dashboard foundation | `/showteam` (refined layout), trainer card, inspect and EXP cards are new renderers under `utils/render/`. M3 integrates into **these**, not M1/M2-era designs. The dashboard Mega section was restyled on `public/shared/tokens.css`. |
| #58 animated compact cards | Animated cards go through `utils/render/stage.js`, which M3 made Mega-aware in one place. `power.js` auto-merged with M2's Mega-aware `teamPower`. |
| #52 private EXP | The EXP card (private follow-up) shows the Mega that battled. |
| #55 achievements date fix | The suite is fully green. |

**Conflicts:** none. The merge applied cleanly; no newer master code was discarded.

## 3. Visual architecture audit

| Surface | Source | Sprite path before M3 | M3 change |
|---|---|---|---|
| `/showteam` | `commands/showteam.js` → `utils/render/teamView.js` (view) → `showteam.js` + `showteamRefined.js` | `loadStaticSprite(id)`; animated: `battle/render.js loadSprite` | slot `spriteId`, Mega name/types/stats, MEGA tag, inactive-Mega note in the message, Inspect menu entry |
| Inspect card | `utils/render/inspectCard.js` (slot from teamView) | `loadStaticSprite` + stage | `spriteId`, MEGA tag, Mega accent |
| Trainer card | `commands/trainercard.js` → `trainerCard.js` (`trainerCardView` → `buildTeamView`) | `loadStaticSprite` + stage | `spriteId`, MEGA tag, Mega accent; statistics untouched |
| EXP card | `commands/battle.js` → `expCard.js` (`expView` from `runBattle` outcome) | `loadStaticSprite(id)` | Mega sprite, short name + MEGA tag |
| Battle images | `utils/battle/playback.js` → `battle/render.js renderBattleFrame` | M2: own Mega folder logic | now the shared `loadAnimatedSprite` |
| Leaderboard | `leaderboardCard.js` (`buildTeam(u)[0]`) | species id | the Mega lead's id |
| Pokédex, catch, daily cards | `pokedexCard.js`, `catchCard.js`, `dailyCard.js` | species only | none: species only, Megas are never species |
| Dashboard | `public/picker-pokemon/script.js` + `mega.js` / `mega.css` | M1 card data | three battle states, progress, Team line, preview sprite follows battle state |

**Shared utilities.** One sprite lookup for every renderer:
- **Static:** `utils/render/sprites.js spriteFileFor`/`loadStaticSprite`.
- **Animated:** `utils/battle/render.js loadAnimatedSprite`, used by `stage.js`, `showteam.js` and `renderBattleFrame`.

The two lookups differ only in format. Nothing duplicates the sprite selection.

**Already form-aware before M3:** only battle images (M2). Everything else used species ids and needed integration.

## 4. Display rules (`utils/megaDisplay.js`)

- **The Team:** `buildTeamView` already uses `buildTeam`, the battle Team with fail-closed `resolveBattleMega`. M3 makes the slot view honour the validated battle participant:
  - **Name and sprite:** the Mega's name ("Mega Charizard X") and its sprite (`spriteId` = form id).
  - **Types and stats:** the Mega's types, and stats at Level from the Mega's base stats.
  - **Kept from the base line:** Level, EXP bar, Pokédex number, rarity and moves.
  - **Team power:** uses the Mega (as in battle).
- **Fail-closed display:** if the stored Mega can't battle, the slot is the base form everywhere. `teamMegaStatus` gives a single reason. Cases: battles off, two Megas, not unlocked, wrong normal/shiny line, line not owned, blocked form, unverified (Z-A), unreleased generation, form allowlist.
  - `/showteam` shows the reason as the message text, e.g. "🧬 Mega Raichu X is on this Team but battles as Raichu for now. This Mega can't battle yet: its battle data hasn't been confirmed."
  - The dashboard shows the same reason in the Mega section.
- **Mega Evolution off:** `teamMegaStatus` returns null. The team view is byte-for-byte the view without any Mega (tested), so there is no note and no new field.
- **Player wording:** `playerMegaReason` never mentions flags, environment variables, data sources or code (tested).
- **Three battle states** (`megaBattleStatus`, on every card):

  | State | When | Card says |
  |---|---|---|
  | **Battle-ready** | unlocked, Pokémon owned, battles on, verified ability, generation live | "Battle-ready" |
  | **Unlocked, can't battle** | e.g. Z-A Megas (unconfirmed), battles off, Pokémon no longer owned | "Unlocked · can't battle yet" and the reason |
  | **Locked** | not unlocked, or blocked / unreleased | "Locked" (blocked: "Unavailable") and what's needed |

  A Z-A ability is labelled "not confirmed yet"; nothing calls it functional.
- **Mega collection progress** (`megaCollectionProgress`): forms unlocked out of forms currently available (blocked and unreleased forms excluded), plus a shiny count. It's shown only in the Mega section, labelled "Separate from your Pokédex". Pokédex counts, regional progress and generation completion are unchanged (tested). Megas are never added to encounters or acquisition pools; the M2 safety scan still forbids it.
- **Display data comes from the validated participant.**
  - The EXP card reads the `megaForm` that `runBattle` records on its own EXP entries. It's a display-only field, and absent for ordinary members, so ordinary outcomes are unchanged.
  - A form that doesn't belong to that species is ignored (tested).
  - No client input is used for any Discord surface.

## 5. Discord surfaces

| Surface | Mega result |
|---|---|
| `/showteam` | Mega sprite (normal/shiny), "Mega Charizard X", Mega types, base Level, MEGA tag under the rarity pill, Mega accent (shiny gold and lead blue keep priority), Inspect menu "Mega · Fire / Dragon"; same 1200×920 card |
| Inspect | MEGA tag beside the rarity pill; Mega name capped at 46 px so descenders clear the type chips; eyebrow shortened to leave room |
| Trainer card | MEGA tag in the slot; Mega accent; owned/shiny/trainer counts unchanged (a Mega is never counted) |
| EXP card (private) | Mega sprite, "Charizard X" + MEGA tag; EXP and Level are the base line's |
| Battle images | Mega sprite normal/shiny, **grayscale Mega sprite when fainted**, muted MEGA tag on a fainted Mega, Showdown-style ability text (M2) |
| Result embed | Unchanged text (rating only, #52); MVP and level-up lines use the battle participant's name |
| Leaderboard | A Mega lead shows its Mega sprite |

Representative renders (`docs/mega-evolution/m3-previews/`, generated by `tools/dev/mega-m3-previews.mjs`, fixture players only):

| Required | Files |
|---|---|
| Mega Charizard X | `showteam-charizardX.png`, `-animated.gif`, `inspect-charizardX.png`, `trainercard-charizardX.png`, `exp-charizardX.png` |
| Mega Charizard Y | `showteam-charizardY.png`, `inspect-charizardY.png`, `trainercard-charizardY.png` |
| Mega Mewtwo X | `showteam-mewtwoX.png`, `inspect-mewtwoX.png`, `trainercard-mewtwoX.png` |
| Shiny Mega (Gardevoir) | `showteam-shinyMega.png`, `inspect-shinyMega.png`, `trainercard-shinyMega.png`; shiny Charizard Y on the dashboard |
| Fainted Mega | `battle-fainted-mega.gif` (grayscale Mega Charizard X, muted tag), `battle-start.gif` (X vs Y) |
| Blocked form | `dashboard-desktop-dormant-blocked.jpg` (Mega Rayquaza "Unavailable", no unlock or Team button) |
| Unlocked, battle-unavailable Z-A Mega | `showteam-zaUnavailable.png` (shown as Raichu) + its message text in `manifest.json`; `dashboard-desktop-za-on-team.jpg` |
| Discord mobile scale | `showteam-charizardX-mobile-360.png`, `trainercard-shinyMega-mobile-360.png` |

## 6. Discord image verification

`tests/megaPresentation.test.js` and the preview tool render the **real attachments** with the same renderers and `cardImage` rules the commands use.

| Check | Result |
|---|---|
| Sprite files | from `data/sprites/megas.json` only; normal ≠ shiny for every form (0 identical files); grayscale exists for every sprite |
| Missing sprite | Mega Zygarde and Mega Magearna (Original Color) have none (both blocked) → `null` → placeholder; base art never substituted (tested) |
| Formats | PNG stills; GIF when animated (`/showteam`, cards via `stage.js`); battles GIF |
| Dimensions | unchanged: `/showteam` 1200×920, trainer 1200×640, inspect 1000×440, EXP 1000×632, battle 900×474 |
| Attachment sizes | `/showteam` PNG ~180 KB, animated ~680 KB, battle frames ~210–245 KB: far below Discord's 8 MB (25 MB boosted) limit |
| Embeds | the only new text is one optional message line (well under 2,000 chars); select-menu labels/descriptions stay ≤ 100 chars (sliced as before) |
| Mobile | at 360 px wide (Discord mobile) the MEGA tag and Mega name read like the existing rarity pills |

**Limitation:** real Discord delivery was **not** tested. No isolated test channel or bot token was authorized, and nothing was sent to any channel. Verification is local rendering of the exact attachments.

## 7. Dashboard

The section loads only when `/api/mega` says Mega Evolution is enabled, so with Mega off the page is unchanged.
- **Cards:**
  - sprite (shiny distinct), Mega name and "Mega form of your [shiny] X";
  - shared Level ("Lv 50 shared with Charizard"), types, stats vs base (BST);
  - ability with honest status, the battle-state chip and reason;
  - required Mega Stone, preferred toggle, Add to Team / On Team.
- **States:** dormant "No copies owned. The unlock is kept."; locked previews never look owned; blocked forms are never unlockable or selectable.
- **Head:** progress (e.g. "5 / 70 Mega forms unlocked · 2 shiny"), the Team line ("On your Team: Mega Charizard X · Battle-ready", or the reason it battles as its base form), and the Mega Stones in the bag.
- **Team preview:** the Save dialog previews the **Mega sprite only when that slot is Battle-ready**, otherwise the base sprite, matching `/showteam`.
- **Dialogs:** no `alert()`/`confirm()`. Replacing a Mega uses the page's own dialog, and status is an `aria-live` line.
- **Fixed during the check:** after Replace, the previous Mega card kept its "On Team" ring, because it read the saved Team instead of the Team being edited. The ring now follows the edited Team.
- **Responsive** (browser, preview server with fixture data): 1024, 768 and 375 px have no horizontal overflow, buttons are 44 px tall, cards are two columns on phones and one column at 340 px or narrower.

## 8. No-Mega visual regression (acceptance gate)

- **Discord images:** `tools/dev/visual-regression.mjs` renders 23 outputs for fixture players without Megas through each checkout's own renderers.
  - Outputs: `/showteam` (Team, shiny, no-Team fallback, empty; PNG and GIF), trainer card (incl. animated), inspect (incl. animated), EXP card (PNG and GIF), battle start/turn/final frames, leaderboard, two Pokédex cards and a catch card.
  - `tools/dev/visual-compare.mjs` compares bytes, then decoded pixels of every frame.

  | Comparison | Result |
  |---|---|
  | master `38884217` vs M3, Mega off | **23/23 same bytes** |
  | master vs M3, every Mega switch on (Teams without Megas) | **23/23 same bytes** |

- **Dashboard:** `tools/dev/dashboard-static-preview.mjs` serves each checkout's page with the same fixture player and `/api/mega` → `{enabled:false}`. In the browser, a hash of the rendered markup and of every element's box (after images load):

  | Viewport | Markup | Layout | Mega section present |
  |---|---|---|---|
  | 1024 px | identical | identical | no |
  | 768 px | identical | identical | no |
  | 375 px | identical | identical | no |

The pixel gate stays a dev tool rather than a suite test. There's no CI, and font rendering differs between machines, so committed image hashes would be flaky.

## 9. Battle regression

`tests/megaBattleRegression.test.js` (the M2 corpus recorded from the pre-M2 engine) shows **0 differences in 3,000 battles** with Mega off and fully on. The test compares winners, the full log (damage), knockouts, HP, EXP, ratings and both players' persistent records. The only battle-file change in M3 is display-only: an extra EXP-entry field for Mega members, plus the shared sprite loader. Rendering never touches outcomes.

## 10. Performance

`tools/dev/render-bench.mjs`: median of 8 renders after warm-up, two runs each, same machine.

| Surface | Master | M3, no Mega | M3, Mega X in slot 1 |
|---|---:|---:|---:|
| `/showteam` PNG | 56–57 ms | 56 ms | 55–56 ms |
| `/showteam` GIF | 359–371 ms | 351–355 ms | 356–374 ms |
| Trainer card | 27 ms | 26–29 ms | 26–27 ms |
| Inspect card | 16–18 ms | 15–17 ms | 16–17 ms |
| EXP card | 23–24 ms | 23–24 ms | 22–23 ms |
| Battle frame (GIF) | 158–166 ms | 163–164 ms | 164–166 ms |
| Peak RSS | 163 MB | 166 MB | 164–166 MB |
| Heap after GC | 11.4 MB | 12.5 MB | 12.6 MB |

- **Speed:** no measurable change. The ~1 MB heap is the Mega data and ability registry (M0–M2), loaded once.
- **Sprites:** a render loads only the sprites it draws (cached per id/variant, 200-entry cap). Nothing loads the Mega catalogue.
- **Assets:** 95 forms × 3 variants, about 2.6 MB per variant folder. The largest file is 300 KB (grayscale Mega Alakazam); Mega Charizard X is 160 KB. The manifest is 188 KB of metadata. Dashboard cards load each sprite lazily.

## 11. Tests

| Suite | Result |
|---|---|
| `tests/megaPresentation.test.js` (new) | **71/71**: sprite resolution (normal/shiny/grayscale, X≠Y, no base fallback), team view (name/sprite/types/stats/Level/order/power), fail-closed display for 9 cases plus the off-state equality, player wording, cross-surface agreement (battle, trainer card, `/showteam`, leaderboard), Inspect menu, real renders with sizes, battle sprites incl. grayscale, EXP card incl. a forged form, dashboard battle states, blocked forms, collection progress, Pokédex counts, `/api/mega` |
| `tests/megaSafety.test.js` | allowlist extended with the three M3 presentation files; reward, shop, catch, daily, quest, achievement and playback code still never mention Mega |
| Everything else | unchanged and passing (incl. master's `dashboardFoundation`, `showteamRender`, `showteamCommand`, `commandCards`, `battleRender`, `leaderboard`) |
| **Full suite (`npm run test:safe`)** | **61/61 files, 2,099/2,099 assertions** |

## 12. Protections kept

- **Unchanged, confirmed by tests:**
  - virtual forms bound to species + normal/shiny;
  - no inventory or Pokédex change;
  - shared Level;
  - one Mega per Team, never with its own base form;
  - never catchable;
  - one-time stone use;
  - the two-flag battle gate;
  - rewards off;
  - Z-A battles blocked;
  - Rayquaza, Floette, Zygarde and Magearna Original blocked;
  - generation gating.
- **What M3 did and didn't change:**
  - It changed no battle or inventory mechanics, so no approval is needed for scope.
  - Only display data was added to the M2 participant.

## 13. Known limitations and next steps

- Real Discord delivery is untested (see §6). The first check after deploy should be a test server.
- `/showteam`'s note for an inactive Mega is message text, not drawn on the image (images stay identical to master when no Mega is active).
- Owner decisions carried from M2: activating `MEGA_BATTLES_ENABLED`, a verification path for Z-A profiles, Dragon Ascent (Rayquaza), a Discord `/mega` command and inventory category.
- **Ready for M4:** rewards, shards and the economy. The display already reports collection progress for achievement hooks.
