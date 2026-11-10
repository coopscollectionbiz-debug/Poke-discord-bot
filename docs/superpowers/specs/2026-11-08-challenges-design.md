# Challenges: locked design (grill-with-docs synthesis)

Branch: `feat/challenges` (branched from origin/master 7398d386; rebased onto 4a78a4ae on 2026-11-09).
Glossary: `CONTEXT.md` (Challenge, Badge, Elite Four run).

Targets in this spec are design goals that a test enforces, not measurements. Every measured number names the command that measured it. Quantities nobody has measured yet are listed under Open checks with no figure.

## The ladder

- 8 Gym Leaders, fought in any order. Beating one for the first time earns their Badge.
- All 8 Badges unlock the Elite Four run: Lorelei, Bruno, Agatha, and Lance back to back.
- Clearing the Elite Four run once unlocks Blue for good. Blue is a separate single fight, so losing to Blue means retrying Blue, not the run.
- Red is open to every player from day one.
- A beaten leader can be fought again, and a cleared Elite Four run can be run again. Repeats pay EXP only.

## Opponents

- Every Gym Leader and Elite Four member fields 6 Pokémon. Each team starts from the leader's FireRed/LeafGreen team and is filled to 6 with on-type Pokémon from that leader's later canon teams (the Let's Go rematch first, then the HGSS rematch).
- Each team keeps its canon Level spread, with the ace highest. The whole team shifts until the ace hits its target, and filled-in Pokémon take the rounded average of the shifted canon Levels. The roster file writes out every Level literally.
- Blue fields his FireRed/LeafGreen Champion lineup with the Blastoise ace. The bot never records a player's starter (`starterPokemon` is `null` by default at `utils/userSchema.js:72`, and nothing writes it), so Blue can't counter it the way he does in the games.
- Red fields his HeartGold/SoulSilver team at its canon Levels.
- Leaders use the same automatic moves as players: the last 4 damaging moves learned by Level (`utils/battle/moveset.js`). The sim has no status moves, so canon movesets wouldn't work.

### Rosters

Sources: [pokemondb FRLG](https://pokemondb.net/firered-leafgreen/gymleaders-elitefour), [pokemondb Let's Go](https://pokemondb.net/lets-go-pikachu-eevee/gymleaders-elitefour), [pokemondb HGSS](https://pokemondb.net/heartgold-soulsilver/gymleaders-elitefour). The scratch draft checked that every species exists in `battleData.json`. The roster test will repeat that check in the repo.

| Opponent | Type | Badge | Ace target | Team (Level) |
|---|---|---|---|---|
| Brock | Rock | Boulder | 25 | Geodude 23, Onix 25, Kabutops 24, Omastar 24, Aerodactyl 24, Golem 24 |
| Misty | Water | Cascade | 30 | Staryu 27, Starmie 30, Golduck 29, Dewgong 29, Vaporeon 29, Gyarados 29 |
| Lt. Surge | Electric | Thunder | 35 | Voltorb 32, Pikachu 29, Raichu 35, Electabuzz 32, Magneton 32, Jolteon 32 |
| Erika | Grass | Rainbow | 40 | Victreebel 40, Tangela 35, Vileplume 40, Parasect 38, Exeggutor 38, Bellossom 38 |
| Koga | Poison | Soul | 44 | Koffing 38, Koffing 38, Muk 40, Weezing 44, Golbat 40, Venomoth 40 |
| Sabrina | Psychic | Marsh | 48 | Kadabra 43, Mr. Mime 42, Venomoth 43, Alakazam 48, Hypno 44, Slowbro 44 |
| Blaine | Fire | Volcano | 53 | Growlithe 48, Ponyta 46, Rapidash 48, Arcanine 53, Magmar 49, Ninetales 49 |
| Giovanni | Ground | Earth | 58 | Rhyhorn 53, Dugtrio 50, Nidoqueen 52, Nidoking 53, Rhydon 58, Persian 53 |
| Lorelei | Ice | | 56 | Dewgong 54, Cloyster 53, Slowbro 54, Jynx 56, Lapras 56, Piloswine 55 |
| Bruno | Fighting | | 57 | Onix 52, Hitmonchan 54, Hitmonlee 54, Onix 55, Machamp 57, Poliwrath 54 |
| Agatha | Ghost | | 58 | Gengar 54, Golbat 54, Haunter 53, Arbok 56, Gengar 58, Weezing 55 |
| Lance | Dragon | | 60 | Gyarados 56, Dragonair 54, Dragonair 54, Aerodactyl 58, Dragonite 60, Charizard 56 |
| Blue | | | 75 | Pidgeot 71, Alakazam 69, Rhydon 71, Arcanine 71, Exeggutor 73, Blastoise 75 |
| Red | | | 88 (canon) | Pikachu 88, Lapras 80, Snorlax 82, Venusaur 84, Charizard 84, Blastoise 84 |

- Giovanni's sixth Pokémon is Persian (decided). His FRLG team has 5, and neither his Let's Go team nor HGSS has another Ground type for him. Persian is his signature outside the Gym.
- The ace targets come from the interview (Gyms "a touch lower" than 30 → 65, so Giovanni tops out around 55 to 60, and the Elite Four sit around 55 to 60). The balance test tunes them.
- Tuning: before the Revive, the Elite Four run's gate at these Levels tied Blue's at Lv 74, and every Elite Four Pokémon briefly moved down 1 Level to break the tie (`node tests/challengeBalance.test.js` at pre-rebase commit fbaa9e52, on Gen 1–5 data). The Revive breaks it instead, so the Levels are back at the draft: the run's gate is Lv 67, under Blue's Lv 72 (Measured).

## Difficulty

- Leader Levels are fixed. They don't scale to the player, and player Levels are never capped in a challenge.
- A gate Level is the lowest uniform Team Level at which stand-in Teams win at least half the time against an opponent. A stand-in Team is 6 random distinct species, all at the same Level, with one seed per sample. The species come from those with no further evolution (`evolvesTo` empty in `pokemonData.json`), minus the legendary catch band (`catchBand(id) === "legendary"` in `utils/training.js`, meaning Tier legendary or mythic at Stage 1). Tier alone can't do this job, because Tier is rarity: Venusaur is Tier legendary. Its Level is measured in steps of 1.
- The balance test enforces Giovanni's gate < the Elite Four run's gate < Blue's gate < Red's gate. It prints each Gym's gate but doesn't require them to rise one by one, because type matchups could put a later Gym's gate below an earlier one's even with higher Levels. If the printed Gym gates come out badly out of order, tune the ace targets by hand.
- Challenges have no Underdog surge, on either side (decided 2026-11-10). With `/battle`'s surge, a one-Pokémon Team surged to Lv 100 and beat Gyms it had no business beating (see Measured).
- The sim's existing turn-cap rule applies. More HP left wins, and an exact tie goes to the leader (side 1).

## Elite Four run

- One `/challenge` runs Lorelei, then Bruno, then Agatha, then Lance. The player's Pokémon keep their HP, as a fraction of max HP, from fight to fight, and fainted Pokémon stay fainted unless revived. Each leader starts at full HP.
- The run uses the player's Team as it was when they clicked Fight!. Levels stay fixed during the run. EXP from every fight is added up and applied once at the end, only to Pokémon the player still owns then (giving away a Pokémon's last copy resets its Level, so EXP must not recreate it).
- The run uses 1 daily attempt, counted at Fight!.
- There's no forfeit. A run ends when the player loses a fight or beats Lance.

### Revive (decided 2026-11-10)

- After each fight the player wins (up to 3 times a run), they pick one fainted Pokémon to Revive. It comes back at full HP for the next fight. If nothing fainted, there's nothing to pick and the next fight starts right away.
- The pick is a private message with one button per fainted Pokémon (name and Level), naming the next opponent and type, such as "Next: Agatha · Ghost". All 6 can be fainted after a win on a double knockout, so the buttons may take two rows.
- The player has 60 seconds from when that fight's result frame appears. Without a pick, no Pokémon is revived for that break. The buttons disappear at the deadline; a click that arrives later gets "Too late. No Pokémon was revived." Only the first click counts.
- Spectators: during the pause, the public replay message keeps the last result frame and its text adds "⏳ <name> is choosing a Pokémon to revive…". The next fight's header adds "💊 <name> revived <Pokémon>!" or "💊 No Pokémon was revived."
- The run is simulated one fight at a time. After each fight the bot saves the run's progress on the player's record, then replays that fight. The replay slot is released during the pause, so the next fight may show its place in line.
- Each private message uses the newest click's reply window (Discord interaction tokens are valid for 15 minutes, [Discord docs](https://docs.discord.com/developers/interactions/receiving-and-responding)). If a long replay queue pushes a pick message past that window, that break gets no Revive and the run continues.
- If the public replay message is deleted mid-run, the run keeps going and still resolves; only the replay stops.
- A restart mid-run finishes every open run at startup with no Revives, applies EXP and the prize or loss, and edits the run's public message to the result with a note that the bot restarted. Unanswered wager offers are closed the same way today (`refundPendingWagersOnStartup`, `bot_final.js:2299`).
- While a run is open, `/challenge` with an opponent refuses privately: "Finish your Elite Four run first." Fight! on any older preview re-checks under the lock and refuses the same way. `/battle` still works.
- Every way out of a break leads to the next fight or the end of the run: a pick, the 60-second deadline, a pick message that couldn't be sent, or a replay edit that failed.
- A run can't stay stuck. If its last saved step is more than 15 minutes old and no command is still playing it (an unexpected error stopped it), the player's next `/challenge` first finishes it with no Revives, applies the results, and clears it, then carries on with their request. A run still being played is never finished this way, even when a long replay queue holds its step for 15 minutes.
- A Revive menu keeps answering clicks for 15 minutes after its pick or deadline: a repeat click is acknowledged quietly, and a late one gets "Too late. No Pokémon was revived." (Discord shows "This interaction failed" for a click nothing answers, and the buttons stay up if the deadline edit fails.)
- The 10% loss is charged when the run ends, as for single fights: the smaller of the previewed amount and 10% of the balance then. Moving CC away mid-run can shrink it, the same gap as `/gift` before a challenge (decided: not closed).
- The event log entry records each break's pick, or that none was made.
- The Elite Four Levels go back to the draft (aces 56, 57, 58, 60). The −1 shift only broke a tie with Blue, which the Revive now breaks.

## Attempts and EXP

- Each player gets 5 challenge attempts per UTC day, in any mix of opponents. They reset at midnight UTC, the same time as the Battle cap (`utcDay` in `utils/battle/rewards.js`). This cap is separate from the 10 Battles per day (`CAPS.perDay` in `utils/battle/tuning.js`).
- Every attempt pays EXP per knockout with the Gen V formula (`teamExp` in `utils/battle/rewards.js`), win or lose, including the win bonus on a win.
- Challenges never move Battle rating or W/L.
- Players who use both caps level faster than the 2-month pace. A new pace test measures how much faster. Its scenario is the worst case: 10 Battles plus 5 cleared Elite Four runs a day, from the run's gate Level to Lv 100, compared with 10 Battles alone over the same span. One run is up to 4 fights and 24 knockouts, so it pays more EXP than any single fight.

## Prizes (first win only)

A first win pays the leader's trainer sprite, CC, evolution stones, and Shiny Dust. The Elite Four run pays once, for clearing all four, and unlocks all four Elite Four sprites.

| Opponent | CC | Stones | Dust | Sprite tier (`trainerSprites.json`) |
|---|---|---|---|---|
| Brock | 2,500 | 1 | 5 | Rare |
| Misty | 3,000 | 1 | 5 | Rare |
| Lt. Surge | 4,000 | 1 | 10 | Rare |
| Erika | 5,000 | 1 | 10 | Rare |
| Koga | 6,000 | 2 | 15 | Epic |
| Sabrina | 7,500 | 2 | 15 | Rare |
| Blaine | 9,000 | 2 | 20 | Rare |
| Giovanni | 12,000 | 3 | 25 | Epic |
| Elite Four run | 30,000 | 4 | 40 | Epic ×3 (Lorelei, Bruno, Agatha), Legendary (Lance) |
| Blue | 50,000 | 5 | 60 | Mythic |
| Red | 100,000 | 6 | 120 | Mythic |
| Total | 229,000 | 28 | 325 | |

- The sprite prize is the first enabled version of that leader's sprite the player doesn't own, in `trainerSprites.json` order. A player who owns every enabled version gets half its shop price in CC instead: 7,500 for Rare, 17,500 for Epic, 37,500 for Legendary, and 75,000 for Mythic (half of `TRAINER_COSTS` in `utils/trainerCosts.js`).
- Unlocked sprites go into the `trainers` array through `grantTrainer` (`services/assets.js`), like every other trainer grant.
- Prize stones and Dust go through `grantItem` (`services/inventory.js`). Prize Dust doesn't count toward the 8-a-week cap on Dust from normal donations (`NON_SHINY_DUST_WEEKLY_CAP`, `utils/economyRules.js:87`).
- Levels gained and prize sprites count toward achievements: the challenge sends `pokemon` and `trainers` events to `trackProgress` (`progression/achievements.js`). It never sends a `battle` event, which would move Battle win streaks.
- Reference values: `/daily` pays 1,000 CC (`commands/daily.js:32`), a stone costs 5,000 CC (`bot_final.js:1880`), shiny crafting costs 15 to 120 Dust (`utils/economyRules.js:61`), and normal donations pay at most 8 Dust a week (`utils/economyRules.js:87`).

## Losing

- Losing a challenge costs 10% of the player's CC, rounded down (`floor(CC × 0.1)`). The CC is gone, and no one receives it. A player with under 10 CC loses nothing.
- Every loss costs this, including rematches and fights lost at the turn cap. A failed Elite Four run costs 10% once, not once per fight. Losing still pays EXP.
- Losses compound. Five losses in one day leave 0.9⁵ ≈ 59% of the player's CC.
- The player never loses more than the confirm preview showed. The loss is the smaller of the amount shown and 10% of the CC they hold when they click Fight!.
- Public posts give the loss as 10% ("10% of CC" on the card, "Lost 10% of their CC." in the result). The exact amount appears only in the player's private messages, because a public amount times 10 would reveal their balance. `/battle` keeps balances private the same way.
- A player can't challenge while one of their `/battle` wagers is waiting for an answer. The Stake is out of their balance until the offer ends, so a wager could otherwise shield their CC from the loss.

## Discord UX

- `/challenge` with no option replies privately with the progress board, drawn as an image (`utils/render/challengeBoard.js`; decided 2026-11-10). A row of the 8 Gyms shows each leader's sprite, name, type, and Badge, lit with a gold frame once earned. Below, the Elite Four, Blue, and Red stand on darker stages lit from below: black silhouettes behind a padlock with the rule that opens them ("Earn all 8 Badges", "Clear the Elite Four"; the lit Badges already show how many are left) until they open, with "???" for the Elite Four's names and the Champion's, in color once open, and with a gold CLEARED tag once beaten. Red's stage has snow. The header shows the player's name and the challenges left today; it has no Badge count, since the lit Badges show it. It shows no Levels. When the image can't render, the text embed with the same facts goes instead.
- `/challenge opponent:<choice>` has 11 choices: the 8 Gym Leaders, Elite Four, Blue, and Red. It replies privately with a preview: a rendered VS card (`utils/render/challengeCard.js`; decided 2026-11-10, after master's card redesign) and Fight! and Not now buttons. The card puts the player's trainer, Badges, and battle Team on a blue half and the opponent on a half tinted with their type (the opponent's red for Blue and Red), with the opponent's party as Poké Balls (the Team isn't revealed), a Gym's Badge "on the line" (or "rematch"), and the prize (or "EXP only"). The Elite Four card shows all four members with their types and says the run is four battles with a Revive between them. The exact CC a loss would cost is a text line above the card, never on it.
- Not now, or letting the preview expire after about 2 minutes, costs nothing. The bot holds nothing while a preview is open, so a restart leaves nothing to refund.
- Fight! re-checks unlocks, attempts left, the Team, and pending wagers under the player's lock, and uses the Team as of the click. Then it posts the VS card publicly as the intro (it says "Lose: 10% of CC" and carries alt text saying the same), and the replay posts below it, the same way `/battle` does. The intro's card is built under the lock before the fight is saved, so a first win's intro still shows the Badge as on the line. When the card can't render, the preview and intro send the old embed with the same facts instead. A second click finds the fight already settled.
- Every replay, `/battle` and `/challenge` alike, shows each row's trainer in a portrait at its left: a player's displayed trainer (an empty platform when they have none) and the leader's sprite (decided 2026-11-10). Tiles narrow from 144 to 124 px so the frame stays 900 wide and GIF memory doesn't grow. A challenge replay is also styled (decided 2026-11-10): the opponent's row and nameplate carry their type, and a Gym's Badge sits in the pill between the rows. The opponent's color stays red, as in the design system; the type only tints. A first win adds an award screen to the final image, after who won: the field dims, and the Badge is presented at 6× with twinkling sparkles ("<player> received the Boulder Badge!"), or a gold title for the Elite Four ("ELITE FOUR CLEARED"), Blue ("CHAMPION DEFEATED"), and Red ("RED DEFEATED"). Rematches and losses have no award screen.
- An Elite Four run replays in one message, fight after fight, with a header such as "Elite Four · Bruno (2 of 4)". Carried-over HP shows at the start of each fight. Each fight holds a replay slot (`PLAYBACK.maxAtOnce`) only while it plays, and the run ends with one result showing how far the player got and the prize if they cleared it.
- The post-match flow is `/battle`'s (decided 2026-11-10): the embed under the final image says only what the image doesn't, which is how far an Elite Four run got, the Badge, the prize, what unlocked, and "💸 Lost 10% of their CC." for a loss. A rematch win has nothing to add, so it gets no embed. The winner, MVP, and level-ups are on the image, and the embed has no rating lines and no Badge thumbnail. EXP is private: after the replay the player gets a new private message, captioned with the result (the exact CC lost, or the prize), with the EXP card `/battle` sends (`utils/render/expCard.js`, with no Battle rating), or its text when the card can't render.
- `/challenge` works only in the channel `CHALLENGE_CHANNEL_ID` names (set in `fly.toml` in production; decided 2026-11-09). Anywhere else, the board and every challenge reply privately "Challenges happen in #channel." Unset, it works in any channel.
- Refusals are private. They cover a missing Team, a locked opponent (with what's missing), no attempts left, a pending wager, and the bot lacking permissions in the channel.
- After a loss, the player's private reply shows the exact CC lost.
- The private result arrives after the replay, for single fights and the Elite Four run alike (decided 2026-11-10), as a follow-up on the player's newest click (Fight!, or their last Revive pick), whose reply window is freshest. The "⚔️ Your challenge is starting below." message stays, or says the challenge counted but couldn't be posted. If the replay outlasts the 15-minute reply window, the public result still shows and only the private message is missing. A crash during a single fight's replay leaves the player with neither result message, though the result itself was saved first, the same as `/battle`.

## Badges in other places

- Badge art comes from 8 Badge PNGs in `public/sprites/badges/`: FireRed's trainer card badges (pret/pokefirered `graphics/trainer_card/badges.png`), which the game draws in silver, tinted with each badge's usual colors and scaled to 128×128 by `tools/tint-badges.mjs` (decided 2026-11-10).
- In Discord, the board, the VS card, and the replay frames draw the Badge PNGs from local files, so they need no public host. Only the preview's fallback embed loads its Badge image from the bot's public host, like trainer sprites (`spritePaths.badges`, `utils/challenge/badgeImages.js`), as the embed's author icon. Nothing is uploaded to Discord, so every bot application shows them with no setup (decided 2026-11-09; this replaced application emojis, whose IDs differ for each bot). Text lines, like the board and `/trainercard`'s fallback, name the Badges instead.
- `/trainercard` and `/showcard` draw a Badge row on the rendered card (`utils/render/trainerCard.js`; decided 2026-11-09, after master made the card an image): the count out of 8 and all 8 Badges, earned ones in color and the rest dimmed. The text fallback, sent when the card can't render, keeps one description line with the count and the earned Badges' names.
- The dashboard adds a Badges row under the stats bar with all 8 images, unearned ones dimmed. The dashboard is `public/picker-pokemon/`, where `/auth/dashboard` lands (`bot_final.js:437`). `public/dashboard/` isn't served. `/api/user` returns the whole player record (`bot_final.js:1239-1253`) except an open run (`hideOpenRun`).
- The 8 Gym Badges are defined once, in `public/picker-pokemon/badges.js`. It has no DOM access, so the bot can import it too, the same pattern `regions.js` uses.

## Data

- Progress lives on the user record as `challenge: { won: { <opponentKey>: <UTC day of first win> }, day, attempts }`, created on first use. Badges are the Gym keys present in `won`. The key `elite4` marks a cleared run and is what unlocks Blue.
- The server owns `challenge`. It must never join the `/api/updateUser` allowlist, the same rule as `training` and `battle`.
- Like `training` and `battle`, `challenge` isn't registered in a schema file. The unused `sanitizeBeforeSave` → `stripDeprecatedFields` whitelist would wipe it if anyone ever wired that up (the battles spec gives the same warning).
- Each attempt runs under the player's lock (`lockUser`). The command checks the cap and unlocks, simulates, applies EXP and prizes, records the attempt, and saves before the replay starts, the same order `/battle` uses.
- An open Elite Four run lives at `challenge.run`: the Team as of Fight!, each member's HP, the next fight, the EXP so far, the seed, the previewed loss, the picks so far, and the public message's channel and ID. The seed decides the remaining fights, so `/api/user` leaves the open run out of what it sends the dashboard. Every step re-reads the live record under the lock and checks the run's nonce and step, so a stale or repeated click does nothing. The run is removed when it ends.

## Code changes

- `utils/battle/sim.js`: accept a starting HP fraction per member, where 0 means fainted. The first snapshot reflects it.
- `utils/challenge/roster.js`: the 14 opponent entries (8 Gym Leaders, 4 Elite Four members, Blue, Red) with type, Badge, display sprite, prize sprite key, team, and prize.
- `utils/challenge/runChallenge.js`: the pure rules with no Discord code. It checks what's unlocked and the cap, runs one fight, applies EXP and prizes, and records the attempt. `simulateChallenge` takes a Revive pick for the balance test. The interactive run is `startRun` and `continueRun` (one fight per step, kept at `challenge.run`), `finishOpenRun` and `finishAllOpenRuns` (the rest with no Revives), `isRunStale`, and `attachRunMessage`. Single fights and runs settle through the same code.
- `utils/battle/tuning.js`: the challenge cap of 5 per day, the 60-second Revive window (`pickMs`), and the 15-minute stale-run limit (`staleRunMs`).
- `utils/battle/playback.js`: a leader is a name, not a `<@mention>`. Add the challenge result embed, `playChallengeFight` (one fight of a run on its message, holding a replay slot only while it plays), the Revive line in the header, `showChoosing`, and `showRunResult`.
- `commands/challenge.js`: the slash command, the Revive menu and its 60-second deadline, the run loop, and finishing a stale run on the next `/challenge`.
- `bot_final.js`: `finishOpenRunsOnStartup` finishes every open run after a restart and edits its replay message, next to the wager refund.
- `commands/trainercard.js`, `utils/render/trainerCard.js` and `public/picker-pokemon/*`: the Badge line and rows.
- Event log entries `challenge` with the opponent, seed, how far the player got, the result, the prize, and the CC lost, plus each break's Revive for a run (`finished: "stale"` or `"restart"` when it was finished without Revives). The event log is admin-only, so it can hold the exact amount.
- `README.md` gets a Challenges section (the ladder, the 5-a-day cap next to the 10-a-day Battle cap, prizes, the 10% loss, where Badges show), the new test files in Tests, the challenge channel in Setup, and a gotcha for embed images that don't load.
- `CONTEXT.md` already has Challenge, Badge, and Elite Four run.

## Tests

- `tests/challengeRoster.test.js` checks that every team has 6 Pokémon, every species exists in `battleData.json`, every ace is the team's highest Level, and the prize table matches this spec. It also checks each Badge's image URL.
- `tests/battleSim.test.js` adds carried HP and checks that fainted members are skipped.
- `tests/runChallenge.test.js` covers gating (8 Badges for the run, a cleared run for Blue, Red always open), the 5-per-day cap and its reset, the run stopping at the first loss, EXP summed with Levels fixed during the run, prizes paid once, the owned-sprite CC fallback, sprites written to the `trainers` array without losing trainers stored there as array properties, Dust stopping at the item stack limit, achievements for a prize sprite and a Level reached with Battle win streaks left alone, no Underdog surge, and Battle rating left untouched. It covers the Revive in the sim: a break after each won fight but the last, the picked Pokémon back at full HP, no pick when nothing fainted, and a pick of a standing or missing slot reviving nothing. It also covers the loss: 10% rounded down, never more than the previewed amount, once per failed Elite Four run, nothing below 10 CC, EXP still paid, and a refusal while a wager is pending.
- `tests/runChallenge.test.js` also covers the interactive run: one fight per step matching `simulateChallenge` with the same picks, stale or repeated steps, every challenge refused while a run is open, a record replaced or a Team member given away mid-run, finishing open runs, the 15-minute stale limit, and the event log entry.
- `tests/challengeCard.test.js` covers the VS card: its facts for a Gym, a rematch, the Elite Four, Blue, and Red, its alt text, no loss amount or balance anywhere in it, the prize wrapping onto two lines at no less than 22 px, and pixel checks that the trainers, the player's Badges (earned lit, others dim), and the Badge medallion land where `cardSlots` says.
- `tests/challengeBoard.test.js` covers the board: the 8 Gyms in order with leader, type, and Badge, Badges and attempts counted (yesterday's attempts don't), each League stage locked, open, or cleared, a player with no record, its alt text, and pixel checks that earned Badges are lit, leaders always show in color, and locked opponents are dark silhouettes.
- `tests/battleRender.test.js` covers the portraits on every replay: tile spacing beside them, both trainers drawn (and an empty portrait for a missing or unset one), and `/battle` keeping the opponent's red row and plain pill. It covers the challenge styling: the opponent's row tinted with their type, the Badge in the center pill, and the award screen (the Badge only on its own screen, the field dimmed, sparkles that change, and a gold title when there's no Badge).
- `tests/challengePlayback.test.js` covers the result embed (only what the image doesn't say, no EXP or Badge thumbnail, and none after a rematch win), each fight's styling and the award for a first Gym win, the Elite Four, Blue, and Red (none for a rematch or a loss), the award screen in a first win's final image and its absence in a rematch's, a run replayed one fight at a time on one message with the slot free between fights, the Revive line in the header, the "choosing" line, the result-only edit, no leader as a mention, and no exact loss in public.
- `tests/challengeCommand.test.js` uses stub Discord objects to cover the board image and its fallback embed, the refusals, the private preview (the VS card, its alt text, and the amount in text only) and its fallback embed, Fight!, Not now and expiry removing the card, a double click, the public intro card with no amount and the Badge still on the line after a first win, the player's trainer in the replay, the replay message, and the private result after the replay with the EXP card (its text fallback, and a refused follow-up that doesn't throw). For the run it covers the Revive menu (two rows for six fainted), a pick, the deadline, late and repeated clicks, a menu that can't be sent, refusals while a run is open, a stale run, and a live run that is never treated as stale.
- `tests/challengeBalance.test.js` measures gate Levels against stand-in Teams and enforces the order in Difficulty. Its stand-in player revives the strongest fainted Pokémon (by Power rating) at each Elite Four break; it also prints the run's gate for a player who never picks. It also prints win rate by Level for each opponent and a leveling pace that includes 5 challenges a day.

## Measured (stand-in Teams, 200 per Level)

Every figure in this section comes from `node tests/challengeBalance.test.js`, run on master's Gen 6–9 data (2026-11-09). The stand-in pool has 492 species from all 9 generations, including Gens 6–9 that players can't obtain until `POKEMON_GENERATIONS` releases them. On the earlier Gen 1–5 data the gates were 1–3 Levels higher (Giovanni 50, Elite Four run 68, Blue 74, Red 86).

- Gate Levels: Brock 22, Misty 29, Lt. Surge 30, Erika 33, Koga 37, Sabrina 43, Blaine 47, Giovanni 49, Elite Four run 67, Blue 72, Red 83. The Gyms rise one by one, and the enforced order holds.
- The Elite Four run's gate is Lv 67 for a player who revives their strongest fainted Pokémon at every break, and Lv 73 for one who never picks.
- Win rate climbs steeply, so every challenge is a Level gate and retries barely matter. A 10% win rate becomes 90% over 6 Levels for Brock (Lv 19 → 25), 10 for Giovanni (45 → 55), 12 for the Elite Four run (60 → 72), 15 for Blue (65 → 80), and 19 for Red (74 → 93).
- A one-Pokémon Team. Challenges have no Underdog surge, so a lone Lv 30 Charizard wins 0% of 200 runs against every challenge. With `/battle`'s surge, a Team of one was always the Underdog by a wide margin and surged to Lv 100: the same Charizard won 27% of 200 runs against every Gym from Brock through Blaine at the old 20% cap, and 11% at the 8% cap (`node tests/challengeBalance.test.js` at pre-rebase commits 6e50566a and a3f0cedf, on Gen 1–5 data). That is why challenges have none.
- Leveling pace: from Lv 67 (the Elite Four run's gate) to Lv 100 takes 31 days at 10 Battles a day, and 14 days with 5 cleared Elite Four runs a day too.

## Open checks

- Red's HGSS Levels. The pokemondb fetch cut off before Red's row, so those Levels came from a page summary. Check the HGSS page by hand.
- Giovanni's FRLG ace. The fetch reported "Rhyhorn Lv 50", which looks like a transcription slip for Rhydon. Check the FRLG page by hand.

## Manual steps

1. Set `CHALLENGE_CHANNEL_ID` in `fly.toml` under `[env]` to the challenge channel's ID (the commented line is already there).
2. Set `REGISTER_COMMANDS=true` for one run to register `/challenge`, then set it back to `false`.
3. Check the two canon Levels listed under Open checks.

## Manual test plan

Run these in a test server against a local copy of `trainerData.json`, editing the `challenge` record by hand to reach later states.

1. Run `/challenge`. The board is a private image: 8 Gym tiles with each leader, type, and a dim Badge; the Elite Four and the Champion as black silhouettes with a padlock ("Earn all 8 Badges", "Clear the Elite Four") and "???" for their names; Red in color on a snowy stage; and "5/5" challenges left. No Levels appear. Check it on a phone too.
2. Give the player 12,345 CC, equip a trainer, and run `/challenge opponent:Brock`. A private preview shows the VS card (the player's trainer, Badges, and Team on the left; Brock, ROCK, six Poké Balls, the Boulder Badge "on the line", and the prize on the right; "Lose: 10% of CC"), the line "A loss costs you **1,234 CC**.", and Fight! and Not now. Check it on a phone too: the card should be readable at phone width. Click Not now. The card disappears, nothing posts in the channel, and the board still shows 5 attempts left.
3. Run it again and let the preview sit for about 2 minutes. The buttons stop working and nothing changes.
4. Run it again with a weak Team (all Pokémon below Lv 15) and click Fight!. The private message reads "⚔️ Your challenge is starting below." and the card leaves it. The same VS card posts publicly with "Lose: 10% of CC" and no amount. The replay shows the player's trainer at the left of the top row, Brock at the left of the bottom row with a ROCK chip by his name, and the Boulder Badge in the pill between the rows. The replay posts below it and Brock wins. The embed under the final image says only "💸 Lost 10% of their CC.": no EXP, no rating, and no amount. After the replay, a new private message says "You lost 1,234 CC." over the EXP card, the balance is 11,111, and the board shows 4 attempts left. Click Fight! again on the old preview. It says the fight is already settled.
5. Open a preview whose loss line says 1,111 CC, raise the player's CC to 50,000 in the data file, then click Fight! and lose. The loss is 1,111, not 5,000.
6. Offer a `/battle` wager, then run `/challenge opponent:Brock`. It refuses privately because a wager is waiting. Decline the wager and the challenge works.
7. Repeat Brock with a Team strong enough to win. The intro card still shows the Boulder Badge dim in the player's row and "on the line". The final image shows who won, then dims and presents the Boulder Badge with sparkles ("<player> received the Boulder Badge!"), then loops. The embed shows the Badge, 2,500 CC, 1 stone, and 5 Dust, with no Badge thumbnail, and the private message reads "You won! 🎁 Brock sprite, 2,500 CC, 1 stone, and 5 Dust" over the EXP card. The board shows Brock's tile in gold with the Boulder Badge lit. The dashboard's Trainers tab shows the new Brock sprite, and its stats bar shows the new CC, stone, and Dust totals.
8. Challenge Brock again. The preview and intro card say "REMATCH" over the Badge and "EXP only", a win pays no prize, the final image has no award screen, and no embed follows it.
9. Give the player every enabled Brock sprite, clear `won.brock`, and win again. The prize shows 7,500 CC in place of a sprite.
10. Use all 5 attempts, then try once more. The private refusal says attempts reset at midnight UTC. Change `challenge.day` to yesterday and confirm the count resets.
11. With fewer than 8 Badges, `/challenge opponent:Elite Four` refuses privately and says how many Badges are missing. `/challenge opponent:Blue` refuses and says to clear the Elite Four.
12. Set all 8 Gym keys in `won` and run the Elite Four. The run plays in one message with "Elite Four · <name> (n of 4)" headers. A Pokémon damaged in one fight starts the next with that HP, and fainted ones don't come back unless revived. A loss ends the run with how far the player got and costs 10% once. A clear pays 4 sprites, 30,000 CC, 4 stones, and 40 Dust, and says Blue is unlocked.
13. While two `/battle` replays are running, start an Elite Four run. Its message shows its place in line, then its first fight plays.
14. Challenge Blue, then Red, from a fresh account. Blue refuses and Red runs.
15. Restart the bot during a replay. After restart, the result (EXP, attempt, prize or CC lost) is still on the player's record. Restart while a preview is open. Its buttons stop working and nothing was charged.
16. Run `/trainercard` and `/showcard`. The card shows a Badge row with the count, earned Badges in color, and the rest dimmed.
17. Open the dashboard. The Badges row shows all 8, with unearned ones dimmed.
18. Try to set `challenge` through the dashboard's `/api/updateUser`. The server ignores it.

The Revive (use a record with all 8 Badges and a Team around Lv 70):

19. Run `/challenge opponent:Elite Four` and click Fight!. The private message reads "⚔️ Your challenge is starting below.", and the intro card and replay post publicly.
20. Win Lorelei with at least one Pokémon fainted. The public text adds "⏳ @Ash is choosing a Pokémon to revive…". The private menu reads "Next: Bruno · Fighting" with one button per fainted Pokémon and its Level. Check on a phone too that the menu shows up within a few seconds.
21. Click one. The menu reads "<name> revived.", Bruno's header says "💊 @Ash revived <name>!", and that Pokémon starts at full HP while the others keep their damage. Double-click a button at the next break: only one Revive happens.
22. At a later break, wait 60 seconds. The menu reads "No Pokémon was revived." with no buttons, and the next header says "💊 No Pokémon was revived."
23. Win a fight with nothing fainted. The next fight starts with no menu.
24. Finish the run. A new private message arrives after the last replay, with the exact CC lost or the prize over the EXP card.
25. During a pause, `/challenge opponent:Brock` and Fight! on a Brock preview opened before the run both refuse with "Finish your Elite Four run first." `/battle` still works.
26. Restart the bot during a pick. On startup, the run's public message shows the result with "⚔️ The bot restarted, so @Ash's Elite Four run finished without Revives.", and the record shows the EXP and the prize or loss.
27. Delete the replay message mid-run. Picks still arrive and the run still resolves.
28. Run two `/battle` replays, then pick at a break. The next fight shows its place in line on the run's message, then plays.
29. Set `CHALLENGE.staleRunMs` in `utils/battle/tuning.js` to 30 seconds, restart, start a run, and wait 30 seconds at a pick. (The bot keeps records in memory, so editing the data file without a restart changes nothing.) Run `/challenge opponent:Brock`: it still refuses, because the run is still being played, and the run carries on normally. Set `staleRunMs` back to 15 minutes. Finishing a run whose command died can't be set up by hand; `tests/challengeCommand.test.js` covers it.
30. Give away a Team member's last copy mid-run. It gets no EXP at the end and keeps no Level.
31. Challenge Brock. The private result arrives after the replay.
32. Set `CHALLENGE_CHANNEL_ID` to one channel and restart. `/challenge` anywhere else replies privately "Challenges happen in #channel", with nothing posted; in that channel it works.
33. Run `/challenge opponent:Elite Four` with all 8 Badges. The card shows all 8 Badges lit, the four members with their types, and the four-battles line. Each fight's replay shows that member's portrait and type. Clearing the run ends with an "ELITE FOUR CLEARED" screen. A first win over Blue ends with "CHAMPION DEFEATED", and over Red with "RED DEFEATED".
34. Unequip the trainer (no displayed trainer) and challenge Brock. The card and the replay show an empty platform where the trainer would stand, and nothing else breaks.

## Not included

There is no Hall of Fame or leaderboard for clears, no Champion title, no admin tool to grant or reset Badges, and no Badges on `/showteam`.

## Unrelated finding

`/recruit` and `/quest` used to write `user.trainers[file] = count` onto the array, and `JSON.stringify` drops string keys on an array, so those trainers were lost on save. Master fixed this with `grantTrainer` in `services/assets.js`, which challenge prizes use too.
