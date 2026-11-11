# Trainer encounters: locked design (grill-with-docs synthesis)

Branch: `feat/challenges`. Glossary: `CONTEXT.md` (Trainer encounter, Trainer class, Ace Trainer, Prize money).

Values marked "decided" were chosen in the design session on 2026-11-10; they are design goals, not measurements. Values from existing code cite where they live. Quantities nobody has measured yet are listed under Open checks with no figure.

## What it is

While a player chats, a computer-run Trainer can spot them and ask for a fight, the way a Trainer on a route spots the player in the games. Unlike the games, the player can run. A Trainer encounter is neither a Battle (no other player takes part) nor a Challenge (the Trainer is not one of the fixed Kanto teams).

## Spotting

- Each message that earns TP rolls for an encounter, separately from the catch roll: 1% a message, with no pity (decided). A message earns TP at most once every 7 s per player (`MESSAGE_COOLDOWN`, `bot_final.js:598`). A message that produced a catch never also spots.
- A player is spotted at most 8 times per UTC day (decided; `utcDay`, `utils/battle/rewards.js:36`) and never within 30 minutes of their last encounter (decided). Encounters the player runs from or ignores count toward both.
- Encounters use none of the 10 Battles a day (`CAPS.perDay`, `utils/battle/tuning.js:46`) or the 5 challenge attempts (`CHALLENGE.perDay`, `tuning.js:59`).
- A player is never spotted when they have no Team, have an Elite Four run open, have a wager waiting for an answer, or already have an encounter open.
- The card posts in the channel the player chatted in. `CHALLENGE_CHANNEL_ID` doesn't apply. The bot checks its permissions there (view, send, attach files, embed links) before rolling, and an encounter counts only once its card is posted, so a channel it can't post in never uses one up.

## The Trainer

- **Classes.** Generic Trainer classes from `trainerSprites.json`, never a `/challenge` opponent or a named character. Each class has a title, a sprite (its first enabled sprite, the same rule as the leaders, `displaySprite` in `utils/challenge/roster.js:95`), a gender for its names, a type theme, a prize money base, and its lines. The list is in `utils/encounter/roster.js`.
- **Levels follow the player.** "Average" is the mean Level of the Team on the card, rounded. Each encounter rolls a tier (decided):

  | Tier | Share | Each Pokémon's Level |
  |---|---|---|
  | Under | 70% | avg −15 to avg −2 |
  | Even | 20% | avg −2 to avg +2 |
  | Over | 10% | avg +5 to avg +15 |

  Each Pokémon rolls its own Level in the band, never below Lv 5 or above Lv 100. The team is ordered weakest to strongest, so the strongest comes out last.
- **Team size.** A random 3 to 6 Pokémon, whatever the tier and the player's Team size (decided).
- **Ace Trainers.** Half of Over-tier encounters use the Ace Trainer class; the other half use any other class (decided). Under and Even encounters never use the Ace Trainer class.
- **Species.** Drawn from the class's type theme, from every released region (`isAcquirable`, `utils/speciesCatalog.js:111`), never legendary or mythic. Each Pokémon is the furthest form of its line that fits its Level: its catch-Level floor (`floorLevel`, `utils/training.js:49`, from `CATCH_RANGES` at `tuning.js:30`: Stage 2 from Lv 16, Stage 3 from Lv 32) is at or below its Level, and no evolution of it fits too.
- **The surprise.** 3% of Under-tier encounters swap the last Pokémon for a surprise (decided): Level avg +10 to avg +25 (at most Lv 100), any released species that fits that Level, legendaries and mythics included, ignoring the class theme.
- **No boosts.** Trainers get neither the challenges' hidden stat boost (`CHALLENGE.statBoost`) nor an Underdog surge.

## Prize money

- Prize money is the class's base × the Level of the Trainer's last Pokémon, as in the games. Most classes have base 10; the wealthy classes (Gentleman, Lady, Rich Boy, Beauty) 40; the Ace Trainer 30 (decided). A Youngster whose last Pokémon is Lv 26 pays 10 × 26 = 260 CC; the most any Trainer can pay is 40 × 100 = 4,000 CC.
- The card shows the amount: "Win or lose: 260 CC" (decided).
- A win pays the prize money and EXP. A loss pays the Trainer that amount, or all the player's CC if they hold less, and still pays EXP for knockouts. EXP is `teamExp` (`utils/battle/rewards.js:23`), with the win bonus only on a win, as in challenges.
- The Team on the card fights, because its Levels set the amount. A Pokémon the player no longer owns sits out; with none left, Battle! is refused privately.
- The card's Team is the player's Display team, the Team casual battles use, and it fights the way a casual battle would: each Pokémon's chosen Display moves, and the card's Mega slot as a Mega if it still qualifies at the click. The Battle team never fights an encounter (decided 2026-11-10).
- Encounters never move Battle rating or W/L. Level-ups count toward achievements (a `pokemon` event to `trackProgress`, as challenges send), never a `battle` event.

## Discord UX

- **The card.** A rendered card in the style of the Gym VS card, toned down (`utils/render/encounterCard.js`). The player's trainer and Team stand on the blue half. The Trainer stands on the red half with the games' "!" over their head (pixel art drawn in code on a 16×16 grid, decided), their class and name, and their party as Poké Balls. There are no Levels, no type tint, and no Badges. A games-style text box reads "Youngster Joey challenged Ash!" with the Trainer's line under it, and the stakes read "Win or lose: 260 CC". The message @mentions the player. The card has alt text, and when it can't render an embed with the same facts goes instead.
- **Lines.** Every class has its own lines in its own voice. Over-tier Trainers of a class other than Ace Trainer draw from a shared pool of calm, too-confident lines instead, a hint they're strong (decided). The surprise's line gives no hint. The Prize money on the card is a second hint: it's the class base × the last Pokémon's Level, so a player who knows the bases can read a strong Trainer or a surprise from it. That was accepted when the amount went on the card (decided 2026-11-10). Ace Trainers use their own confident lines. All copy is written fresh in the games' voice, not copied from the games.
- **Buttons.** Battle! and Run, answered for 2 minutes (decided). Only the spotted player's clicks count; anyone else gets a private "This Trainer has their eye on Ash."
- **Run, or no answer.** The card shrinks to one text line with no image, from rotating pools: "Ash ran away from Youngster Joey.", "Ash scurried away from Youngster Joey.", "Youngster Joey lost interest."
- **Battle!** The buttons go. Under the player's lock the bot re-checks the Team, open runs and wagers, fights with the card's Team, settles CC and EXP, and saves; then the replay plays on the card itself, in place of the card image, with both trainers' portraits, no type tint, no Badge pill, and no award screen. It waits for a replay slot like every other replay (`PLAYBACK.maxAtOnce`, `tuning.js:65`). Under the final image: the Trainer's after-battle line, then "Ash got 260 CC for winning!" or "Ash whited out!". The loss line has no amount: a short balance would reveal how much the player holds. After the replay the player gets a private recap: the battle's final image and the EXP card (`utils/render/expCard.js`), with the exact CC paid on a loss.
- **The result line** (decided 2026-11-11). The final image stays up 10 seconds (`ENCOUNTER.resultMs`), then the card drops its images and embed and keeps those two lines as plain text, so the channel keeps only the result. A restart in those 10 seconds leaves the final image up. A replay that can't play still leaves the line, and the recap then says "The battle counted, but I couldn't post it here." over the EXP card alone.
- **Refused Battle!** A Battle! refused (no Pokémon left, an open run, a pending wager) replies privately and leaves the encounter open until it's answered or times out.
- **Restart.** Open encounters live only in memory and hold nothing. A click on a card left from before a restart shrinks it to "This Trainer lost interest." Buttons go through the bot's global button handler, not a per-message collector, so these clicks are always answered.

## Data

- `user.encounter = { day, count, lastAt }`: the UTC day, encounters posted that day, and when the last one posted (ms). The record normalizer and validator keep unknown fields (`normalizeUserSchema` in `bot_final.js:259`, `validateUserSchema` in `utils/userSchema.js:108`); `tests/runEncounter.test.js` pins the validator's half for `encounter` (the normalizer lives in `bot_final.js`, which tests can't import).
- The event log gets one `encounter` event per step: `spotted` (tier, class, party size, prize money, surprise), `answered` (battle, run, timeout), and `result` (won, CC moved). These are for tuning the rates.

## Code

- `utils/battle/tuning.js`: `ENCOUNTER` (chance, gap, daily cap, answer window, how long the final image stays up, tiers, Level floor, party size, Ace share, surprise).
- `utils/encounter/roster.js`: the Trainer classes. `utils/encounter/lines.js`: every line.
- `utils/encounter/generate.js`: rolling a Trainer from a Team and a seed (pure).
- `utils/encounter/runEncounter.js`: the encounter record, who can be spotted, and the fight with its settlement (pure apart from the record it's handed).
- `utils/encounter/service.js`: the Discord side: spotting, the card, the buttons, timeouts, stale clicks, the replay on the card, the private recap, and the result line.
- `utils/render/encounterCard.js`: the card; the "!" in `utils/render/primitives.js`.
- `utils/battle/playback.js`: `playEncounter` and its result embed.
- `utils/passiveChat.js` and `bot_final.js`: the roll after a message that didn't catch, and routing `encounter:` buttons.

## Tests

- `tests/encounterRoster.test.js`: classes, sprites, bases, and lines.
- `tests/encounterGenerate.test.js`: tier shares, bands, party size, order, Ace Trainers, the surprise, forms that fit the Level, species coverage for every class at every Level, prize money.
- `tests/runEncounter.test.js`: who can be spotted, the record, the fight and its settlement.
- `tests/encounterCard.test.js`: the card's facts, alt text, and layout.
- `tests/encounterFlow.test.js`: the Discord flow with stub objects, including the replay on the card, the private recap, the result line, and a replay that can't play.
- `tests/startupReadiness.test.js`: the encounter roll runs only after a message that didn't catch.
- `tests/encounterBalance.test.js`: the open checks below.

## Measured (stand-in Teams, 400 fights per tier per case)

Command: `TRAINERDATA_DIR=<dir> node tests/encounterBalance.test.js` (run 2026-11-11). A stand-in Team is random distinct fully evolved, non-legendary species, all at the average Level. The first run used 100 fights per case. After master's 2026-11-11 Pokémon re-tier made eight unreleased species legendary, the stand-in pool shrank and one row's order flipped within sampling noise, so the test now runs 400.

Win rate by tier (the test prints every Team size from 1 to 6):

| avg Lv | Team | Under | Even | Over |
|---|---|---|---|---|
| 10 | 1 | 80% | 27% | 0% |
| 10 | 3 | 98% | 83% | 0% |
| 10 | 6 | 98% | 99% | 0% |
| 30 | 1 | 39% | 7% | 0% |
| 30 | 3 | 93% | 45% | 1% |
| 30 | 6 | 99% | 92% | 7% |
| 60 | 1 | 12% | 7% | 1% |
| 60 | 3 | 71% | 42% | 8% |
| 60 | 6 | 99% | 86% | 34% |
| 90 | 1 | 9% | 7% | 2% |
| 90 | 3 | 56% | 43% | 17% |
| 90 | 6 | 94% | 87% | 55% |

- Small Teams lose most encounters, because the Trainer brings 3 to 6 Pokémon whatever the Team size. A Team of one at avg Lv 30 wins 39% of Under encounters.
- Over-tier encounters are nearly unwinnable for low-Level Teams (0% to 7% at avg Lv 10 to 30) and closer to even for high ones (34% to 55% at avg Lv 60 to 90, Team of 6): the same +5 to +15 Levels matter more at low Levels.
- A Lv 100 Pokémon carrying five Lv 5s (avg Lv 21) wins 98% to 100% of every tier, for a mean Prize money of 232 CC (Under) to 744 CC (Over), while the Lv 5s take EXP for every knockout.
- CC per accepted encounter, Team of 6, the player always holding enough: avg Lv 10, +42 CC (334 a day at 8); avg Lv 30, +230 (1,837 a day); avg Lv 60, +586 (4,687 a day); avg Lv 90, +916 (7,325 a day). For scale, `/daily` pays 1,000 CC.
- Leveling pace, with 10 Battles a day as in `tests/challengeBalance.test.js` and the encounters' worst case (8 a day, all won, every Trainer Pokémon knocked out): Lv 5 to 100 takes 56 days without encounters and 30 days with them; Lv 50 to 100 takes 42 days and 22 days.

## Open checks

- How many encounters players actually see per day. Count `encounter` `spotted` events in `events.ndjson` after release.

## Manual steps

- No new slash command, so no command registration.
- For local testing only, the test branch `local/test-challenges` raises the roll to 100%, drops the gap, and lifts the daily cap, marked "TEMP local testing, do not commit".

## Manual test plan

1. Chat once. A card appears in that channel with the "!", "…challenged Ash!", a line, 3 to 6 Poké Balls, "Win or lose: N CC", and Battle! and Run.
2. From a second account, press Battle!. The private "has their eye on" reply appears; the card doesn't change.
3. Press Run. The card becomes one text line with no image.
4. Get spotted again and wait 2 minutes. The card becomes the "lost interest" line.
5. Press Battle! on a new card. The buttons go, the replay plays on the card with no new message, and the after-battle line and prize line sit under the final image. A private recap follows with the final image and the EXP card; CC rose by N. About 10 seconds after the final image, the card loses its images and shows only those two lines, with no ping. From the second account, the card shows the same two lines and no image.
6. Lose to an Over-tier Trainer. "whited out!" shows, the recap says how much was paid ("You paid Ace Trainer Kent 3,000 CC."), and CC dropped by N, or to 0 when it was under N.
7. Get spotted, change the Team on the dashboard, press Battle!. The fight uses the card's Team.
8. Get spotted and donate one Pokémon from the card: it sits out. Donate them all: Battle! is refused privately.
9. Restart the bot with a card open and press Battle!. The card shrinks to "This Trainer lost interest."
10. With an Elite Four run open, chat: no one spots you. Again with a wager waiting for an answer.
11. In a channel where the bot can't attach files, chat. Nothing posts and the count doesn't move.
12. With a temporary cap of 2 and a 1-minute gap: a third encounter never appears, and the gap holds.
13. With the temporary edits removed, chat for a while. Encounters are rare and never come with a catch.

## Not included

A setting to never be spotted (Run is the opt-out), Trainer sprites as prizes, encounter stats, leaderboards or achievements, and meeting the same Trainer again.
