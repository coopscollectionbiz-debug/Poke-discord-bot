# Challenges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/challenge`, where players fight fixed Kanto teams (8 Gym Leaders, an Elite Four run, Blue, Red) for Badges and one-time prizes, and lose 10% of their CC on a loss.

**Architecture:** Pure rules in `utils/challenge/` (roster, gating, the fight loop, prizes, loss) on top of the existing battle sim, which gains starting HP per Pokémon. `utils/battle/playback.js` gets a challenge replay that plays several fights in one message. `commands/challenge.js` shows the board, a private preview with Fight! and Not now, then posts a public intro and the replay. The 8 Badges live in `public/picker-pokemon/badges.js`, shared by the bot and the dashboard.

**Tech Stack:** Node 22 ESM, discord.js 14.24.2, the in-repo Gen 5 sim (`utils/battle/`), and plain-node tests on `tests/harness.js`.

**Spec:** `docs/superpowers/specs/2026-11-08-challenges-design.md`. Read it first; this plan doesn't repeat its reasons.

## Global Constraints

- Use American English everywhere. UI copy says only what the player can't see on their own (CLAUDE.md). The plan gives the exact copy.
- Add no dependencies.
- The server owns `challenge` on the user record. Never add it to the `/api/updateUser` allowlist (`bot_final.js:1470`).
- Never post a player's exact CC loss, or anything a balance could be worked out from, in a public message. Public text says "10% of their CC".
- Save every result (EXP, attempt, prize, loss) before the replay starts, the same order `/battle` uses.
- Other commands and the dashboard replace a player's record in `trainerData` with a copy. Re-read `trainerData[userId]` inside the lock, and never hold a user object across an `await`.
- Only the player's Team can surge. A leader never surges.
- Challenges never touch `user.battle` (Battle rating, W/L, Battle caps).
- Tests are `tests/*.test.js` files run with `node`. `npm test` runs them all. Two failures are expected: `tests/saveQueue.test.js` already fails on origin/master (it imports `getQueueLength`, which `utils/saveQueue.js` doesn't export), and the Badge emoji ID check in `tests/challengeRoster.test.js` fails until the manual upload. Any other failure is a regression.
- Commit only if the user approves per-task commits at plan review (CLAUDE.md: commit only when asked). If they do, use the commit steps as written.

## Review Focus

1. **A record replaced between preview and Fight!** The dashboard swaps `trainerData[id]` for a copy. The fight must land on the live record. Task 5 tests this.
2. **The Team emptied between preview and Fight!** If the player gifted or donated their whole Team, Fight! must refuse with the no-Team message, not crash in the sim. Task 5 tests this.
3. **A wager offered between preview and Fight!** Fight! re-checks and refuses. Task 5 tests this.
4. **A preview opened before midnight UTC and clicked after.** The attempt counts on the click's day, with a fresh count of 5. Task 3 tests this (`now` parameter).
5. **A leader rendered as a mention.** No message may contain `<@brock>` or any `<@` + opponent key. Leaders appear by name only. Task 4 tests this.

---

### Task 1: Starting HP in the sim

**Files:**
- Modify: `utils/battle/sim.js` (`buildMon`)
- Test: `tests/battleSim.test.js`

**Interfaces:**
- Produces: a sim member may carry `hpFraction` (number, 0 to 1). If it's absent, the member starts at full HP, as today. If it's `0`, the member starts fainted, never acts, and never counts as knocked out. If it's above 0, the member starts at `max(1, round(maxHp × hpFraction))`. `result.snapshots[0]` reflects the starting HP, so a replay shows carried damage with no render change.

- [ ] **Step 1: Add the failing tests** to a new section `"Starting HP"` in `tests/battleSim.test.js`:
  - `hpFraction 0.5 starts at half HP`: `simulateBattle` with side 0 = `[{ speciesId: 6, level: 50, hpFraction: 0.5 }]` vs one Lv 50 Blastoise. `snapshots[0][0][0]` is within `1 / maxHp` of `0.5`.
  - `a fainted member never acts`: side 0 = `[{ speciesId: 6, level: 50, hpFraction: 0 }, { speciesId: 9, level: 50 }]`. No `log` event has `side === 0 && slot === 0`, and no knockout has `side === 0 && slot === 0`.
  - `a sliver of HP rounds up to 1`: `hpFraction: 0.0001` gives `snapshots[0][0][0] > 0`.
  - `carried HP is deterministic`: the same inputs and seed twice give equal `JSON.stringify(result)`.
- [ ] **Step 2:** Run `node tests/battleSim.test.js`. Expect the four new assertions to fail.
- [ ] **Step 3:** In `buildMon`, set `hp` from `member.hpFraction` as described under Interfaces. Leave `maxHp` alone. Shedinja's max HP stays 1.
- [ ] **Step 4:** Run `node tests/battleSim.test.js` and `node tests/battleBalance.test.js`. Both pass, and the existing assertions are unchanged.
- [ ] **Step 5: Commit** `Let the battle sim start a Pokémon below full HP`.

---

### Task 2: Roster and Badges

**Files:**
- Create: `public/picker-pokemon/badges.js`, `utils/challenge/badgeEmojis.js`, `utils/challenge/roster.js`
- Test: `tests/challengeRoster.test.js`

**Interfaces:**
- Produces, in `public/picker-pokemon/badges.js` (no DOM access, so the bot can import it):
  - `GYM_BADGES`: an array of 8 `{ key, leader, badge, type, image }` in Gym order, with `image` = `/public/sprites/badges/<file>`:
    `brock` Brock, Boulder Badge, Rock, `boulder.png` · `misty` Misty, Cascade Badge, Water, `cascade.png` · `surge` Lt. Surge, Thunder Badge, Electric, `thunder.png` · `erika` Erika, Rainbow Badge, Grass, `rainbow.png` · `koga` Koga, Soul Badge, Poison, `soul.png` · `sabrina` Sabrina, Marsh Badge, Psychic, `marsh.png` · `blaine` Blaine, Volcano Badge, Fire, `volcano.png` · `giovanni` Giovanni, Earth Badge, Ground, `earth.png`
  - `earnedBadgeKeys(user) -> string[]`: the Gym keys present in `user.challenge?.won`, in Gym order.
- Produces, in `utils/challenge/badgeEmojis.js`:
  - `BADGE_EMOJIS`: `{ brock: { name: "boulder_badge", id: "" }, ... }` for all 8, named `<badge>_badge`. A comment says to paste the IDs after uploading in the Developer Portal (README Setup).
  - `badgeEmoji(key) -> string`: `<:name:id>`.
  - `badgeLine(user) -> string`: `🏅 **Badges:** ${n}/8` followed by a space and the earned Badges' emojis (nothing after the count when n is 0).
- Produces, in `utils/challenge/roster.js`:
  - `CHALLENGE_KEYS`: `["brock","misty","surge","erika","koga","sabrina","blaine","giovanni","elite4","blue","red"]`.
  - `CHALLENGES[key]`: `{ key, label, kind: "gym" | "elite4" | "champion" | "red", prize: { cc, stones, dust }, opponents: Opponent[], badge?: GYM_BADGES entry }`. The labels are the Gym leaders' names plus `Elite Four`, `Blue`, and `Red`.
  - `Opponent`: `{ key, name, title, type, trainerKey, team: [{ speciesId, level }] }`. The titles are `Gym Leader`, `Elite Four`, `Champion`, and `Pokémon Trainer` (Red). `type` is the Gym or Elite Four type, or `null` for Blue and Red. `trainerKey` is the `trainerSprites.json` key (Lt. Surge is `ltsurge`).
  - `opponentName(o) -> string`: `${o.title} ${o.name}`.
  - `enabledSprites(trainerKey) -> { files: string[], tier: string }`: the enabled sprite files in `trainerSprites.json` order, with `tier` lowercased. It reads `trainerSprites.json` with `fs`, the way `utils/broadcastReward.js` does.
  - `displaySprite(o) -> string`: `enabledSprites(o.trainerKey).files[0]`.
- Values: teams are the spec's Draft rosters, in table order, with these species IDs. Geodude 74, Onix 95, Kabutops 141, Omastar 139, Aerodactyl 142, Golem 76, Staryu 120, Starmie 121, Golduck 55, Dewgong 87, Vaporeon 134, Gyarados 130, Voltorb 100, Pikachu 25, Raichu 26, Electabuzz 125, Magneton 82, Jolteon 135, Victreebel 71, Tangela 114, Vileplume 45, Parasect 47, Exeggutor 103, Bellossom 182, Koffing 109, Muk 89, Weezing 110, Golbat 42, Venomoth 49, Kadabra 64, Mr. Mime 122, Alakazam 65, Hypno 97, Slowbro 80, Growlithe 58, Ponyta 77, Rapidash 78, Arcanine 59, Magmar 126, Ninetales 38, Rhyhorn 111, Dugtrio 51, Nidoqueen 31, Nidoking 34, Rhydon 112, Persian 53, Cloyster 91, Jynx 124, Lapras 131, Piloswine 221, Hitmonchan 107, Hitmonlee 106, Machamp 68, Poliwrath 62, Gengar 94, Haunter 93, Arbok 24, Dragonair 148, Dragonite 149, Charizard 6, Pidgeot 18, Blastoise 9, Snorlax 143, Venusaur 3. Prizes are the spec's prize table.

- [ ] **Step 1: Write `tests/challengeRoster.test.js`** with these assertions:
  - `CHALLENGE_KEYS` equals the list above, and every key has a `CHALLENGES` entry.
  - There are 14 distinct opponents: 1 per Gym, 4 in `elite4` (Lorelei, Bruno, Agatha, Lance in that order), 1 each for Blue and Red.
  - Every team has 6 members, every `speciesId` exists in `battleData.json`, and every level is an integer from 1 to 100.
  - Gym ace Levels (the team maximum) are `[25,30,35,40,44,48,53,58]`, Elite Four aces are `[56,57,58,60]`, Blue's ace is 75, and Red's levels are `[88,80,82,84,84,84]`. Task 7 may retune these; update this assertion with it.
  - Prizes match the spec table exactly, for example `CHALLENGES.red.prize` equals `{ cc: 100000, stones: 6, dust: 120 }`, and the CC sums to 229,000.
  - Every opponent's `trainerKey` has at least one enabled sprite. `displaySprite` for Brock is `brock-gen3.png`.
  - `earnedBadgeKeys({ challenge: { won: { misty: "d", brock: "d", red: "d" } } })` equals `["brock","misty"]`.
  - `badgeLine` with no Badges is `🏅 **Badges:** 0/8`. With `won` holding `brock` and `misty`, it starts with `🏅 **Badges:** 2/8 ` and contains `badgeEmoji("brock")` and `badgeEmoji("misty")` but not `badgeEmoji("surge")`.
  - `every Badge emoji has an ID`: every `BADGE_EMOJIS[key].id` matches `/^\d{17,20}$/`. This fails until the manual upload. That's intended.
- [ ] **Step 2:** Run `node tests/challengeRoster.test.js`. It fails because the modules are missing.
- [ ] **Step 3:** Create the three modules per Interfaces.
- [ ] **Step 4:** Run `node tests/challengeRoster.test.js`. Everything passes except `every Badge emoji has an ID`.
- [ ] **Step 5: Commit** `Add the Kanto challenge roster and Badges`.

---

### Task 3: Challenge rules

**Files:**
- Create: `utils/challenge/runChallenge.js`, `utils/trainerCosts.js`
- Modify: `utils/battle/runBattle.js` (export the EXP apply step), `utils/battle/tuning.js` (add `CHALLENGE`), `bot_final.js:585-592` (import `TRAINER_COSTS` from the new module and keep `export`ing it from `bot_final.js`)
- Test: `tests/runChallenge.test.js`

**Interfaces:**
- Consumes: `buildTeam` (`utils/battle/runBattle.js`), `teamPower` and `rollSurge` (`utils/battle/power.js`), `simulateBattle` with `hpFraction` (Task 1), `teamExp` and `utcDay` (`utils/battle/rewards.js`), `CHALLENGES`, `enabledSprites`, and `GYM_BADGES` (Task 2).
- Produces:
  - In `utils/battle/tuning.js`: `CHALLENGE = { perDay: 5, lossShare: 0.1, previewMs: 2 * 60 * 1000 }`.
  - In `utils/trainerCosts.js`: `TRAINER_COSTS`, moved verbatim from `bot_final.js:585-592`.
  - In `utils/battle/runBattle.js`: `applyGains(user, members, gains) -> entries`. This is the body of today's `applyExp` map (`addExp` plus `movesLearned`), returning `[{ key, name, fromLevel, toLevel, gained, learned }]`. `applyExp` calls it, and `/battle` behaves the same.
  - In `utils/challenge/runChallenge.js`:
    - `challengeLoss(cc) -> number`: `Math.floor((cc ?? 0) * CHALLENGE.lossShare)`.
    - `getChallengeRecord(user, day) -> { won, day, attempts }`: creates `user.challenge` if missing, and resets `attempts` to 0 when `day` changed.
    - `isUnlocked(user, key) -> boolean`: Gyms and Red are always open. `elite4` needs all 8 Gym keys in `won`, and `blue` needs `won.elite4`.
    - `challengeBlock({ trainerData, userId, key, now = new Date() }) -> null | "no_team" | "locked_elite4" | "locked_blue" | "cap" | "pending_wager"`, checked in that order. It's read-only: it counts today's attempts as `user.challenge?.day === utcDay(now) ? attempts : 0` and never creates the record.
    - `prizeSprite(user, trainerKey) -> { trainerKey, file } | { trainerKey, cc }`: the first enabled file the player doesn't own (compared case-insensitively against `user.trainers` as an array, or the keys of a legacy object), or else `{ cc: TRAINER_COSTS[tier] / 2 }`.
    - `previewChallenge(user, key) -> { firstWin, prize: { cc, stones, dust, sprites } | null, loss }`: makes no changes. `prize` is `null` on a rematch. `sprites` holds one `prizeSprite` per opponent.
    - `simulateChallenge({ team, opponents, seed }) -> { fights, cleared }`. This is pure, and Task 7 uses it directly. For fight `i`, the powers are `[teamPower(alive members), teamPower(opponent.team)]`. The surge is `rollSurge(powers, seed + 2 * i)`, kept only if `side === 0`. The sim seed is `seed + 2 * i + 1`. The player's members carry `hpFraction` from the previous fight's `result.snapshots.at(-1)[0]` (none for the first fight). The loop stops after the first loss. Each fight is `{ opponentKey, members, surge, result, won, gains }`, where `gains = teamExp({ members: team, knockedOut, won })` and `knockedOut` is the opponent members in `result.knockouts` with `bySide === 0`.
    - `runChallenge({ trainerData, userId, key, seed, maxLoss = Infinity, now = new Date() }) -> { ok: false, reason } | Outcome`. It re-runs `challengeBlock`, simulates, adds up the gains per member, calls `applyGains` once, and records the attempt. On a first win it grants the prize: `cc`, `items.evolution_stone`, `items.shiny_dust`, and pushes the sprites into a `trainers` array (converting a legacy object to an array of its keys first). On a loss, `user.cc` drops by `min(maxLoss, challengeLoss(user.cc))`.
    - `Outcome`: `{ ok: true, key, userId, seed, fights: [{ opponentKey, sides: [{ userId, members, power }, { userId: opponentKey, members, power }], surge, result, winnerId }], cleared, exp: { [userId]: entries }, prize, badge, unlocked, ccLost }`. Here `badge` is the Gym key on a first Gym win (otherwise `null`), and `unlocked` is `"elite4"` when this win made the 8th Badge, `"blue"` on the first run clear, and otherwise `null`. `ccLost` is 0 on a win. Each fight's `sides` and `winnerId` have the shape `playback.js` expects (`winnerId` is `userId` or `opponentKey`).

- [ ] **Step 1: Write `tests/runChallenge.test.js`.** Use helpers: `player(id, speciesIds, level)` builds `createNewUser`, sets `pokemon[id].normal = 1` and `training["<id>:normal"] = { exp: level ** 3 }` for each, sets `displayedPokemon`, and sets `cc = 12345`. `STRONG` is `[150, 249, 250, 384, 483, 484]` at Lv 100. `WEAK` is `[10]` (Caterpie) at Lv 5. Assertions:
  - Gating: a fresh player gets `locked_elite4` for `elite4` and `locked_blue` for `blue`, and `null` for `red` and `brock`. With 7 Gym keys in `won` they still get `locked_elite4`, and with 8 they get `null`. With `won.elite4` set, `blue` is `null`.
  - `no_team` when `displayedPokemon` is empty. `pending_wager` when `pendingWager` is set.
  - Cap: 5 `runChallenge` calls on day D succeed, and the 6th returns `{ ok: false, reason: "cap" }`. With `now` on day D+1 it succeeds and `attempts` is 1. (This covers Review Focus 4.)
  - First win: `STRONG` against `brock` gives `cleared` true, CC 12345 + 2500, stones 1, Dust 5, `trainers` includes `brock-gen3.png`, `won.brock` is set, `badge` is `"brock"`, and `ccLost` is 0. Winning again gives `prize === null` and leaves CC unchanged.
  - Sprite fallback: with all 3 enabled Brock sprites owned and `won.brock` cleared, a win gives `prize.sprites[0]` equal to `{ trainerKey: "brock", cc: 7500 }`, and CC rises by 2500 + 7500.
  - Legacy `trainers` object `{ "x.png": 1 }`: after a first win, `trainers` is an array containing `x.png` and `brock-gen3.png`.
  - Loss: `WEAK` against `red` gives `cleared` false and `ccLost` 1234, leaving CC at 11111. With `maxLoss: 500` the loss is 500. A player with 9 CC loses 0. The player's `exp` entries equal `applyGains`-style entries whose `gained` sums equal the sum of the fight's `gains` (so a loss still pays EXP).
  - Elite Four: with 8 Badges and `STRONG`, `elite4` gives 4 fights, `cleared`, `unlocked` `"blue"`, 4 sprites in `prize.sprites`, and CC + 30000. The 8th Badge win gives `unlocked === "elite4"`.
  - Carried HP: for any `simulateChallenge` run with 2 or more fights, each fight's `result.snapshots[0][0]` is within 0.02 of the previous fight's `result.snapshots.at(-1)[0]` at every slot.
  - Levels fixed: every fight's `sides[0].members` levels equal the starting levels. Each member's training EXP rises by exactly the sum of its per-fight `gains`.
  - A failed run costs 10% once: with a Team that beats Lorelei but loses later (find a seed with 1 to 3 fights in `simulateChallenge`), `ccLost` is `challengeLoss(12345)`.
  - Surge side: over 200 seeds, `STRONG` against `brock` never surges. Over 300 seeds, a Lv 40 Team of `[18, 59, 130, 68, 94, 34]` against `red` surges at least once, always with `side === 0`.
  - `user.battle` stays `undefined` after any challenge.
  - `previewChallenge`: a fresh player sees `firstWin` true, `prize.cc` 2500, and `loss` 1234. After a win, `prize` is `null`.
- [ ] **Step 2:** Run `node tests/runChallenge.test.js`. It fails because the module is missing.
- [ ] **Step 3:** Implement per Interfaces. Move `TRAINER_COSTS`, export `applyGains`, and add `CHALLENGE`.
- [ ] **Step 4:** Run `node tests/runChallenge.test.js`, `node tests/runBattle.test.js`, and `node tests/battleRewards.test.js`. All pass.
- [ ] **Step 5: Commit** `Add challenge rules: unlocks, daily cap, fights, prizes, and the 10% loss`.

---

### Task 4: Challenge replay

**Files:**
- Modify: `utils/battle/playback.js`
- Test: `tests/challengePlayback.test.js`

**Interfaces:**
- Consumes: `Outcome` (Task 3), and `opponentName`, `CHALLENGES`, and `GYM_BADGES` (Task 2).
- Produces:
  - An internal `replayFight({ channel, message, header, fight, names, sprites, maxUpdates, delayMs, finalEmbed }) -> message`, extracted from `playBattle`: the start frame, the turn frames, and the final frame. `playBattle` keeps its signature and output and uses it.
  - `challengeNames(outcome, playerName) -> { [userId]: playerName, [opponentKey]: opponentName(o) }` for every opponent fought.
  - `challengeHeader(outcome, i) -> string`. A single fight is `⚔️ <@player> challenges Gym Leader Brock!` (the title changes per opponent). An Elite Four fight is `⚔️ <@player> · Elite Four · Bruno (2 of 4)`. A surged fight adds the line `🔥 The crowd is behind <@player>! Underdog surge!`.
  - `buildChallengeEmbed(outcome, names) -> EmbedBuilder`. The title is `🏆 <player> defeated <opponentName>!` on a single win, `🏆 <player> cleared the Elite Four!` on a run clear, `<opponentName> wins!` on a single loss, and `The Elite Four run ends at <name>.` on a run loss. The description has these lines in order, each only when it applies: the MVP of the last fight (same format as `buildResultEmbed`), the turn-cap line, `🔥 Underdog surge!`, the run progress (`Lorelei ✓ · Bruno ✓ · Agatha ✗`), `🏅 <badgeEmoji> Earned the <Badge name>!`, `🎁 <prize text>`, `🔓 The Elite Four is open!` or `🔓 Blue is waiting.`, and `💸 Lost 10% of their CC.` Prize text joins `<Name> sprite` (or `<n> CC for owning every <Name> sprite`), `<cc> CC`, `<n> stone(s)`, and `<n> Dust`, with numbers in `toLocaleString("en-US")`. One field, `EXP · <player>`, uses `expLines`. There's no rating field.
  - `playChallenge(channel, outcome, names, { maxUpdates, delayMs, queue } = PLAYBACK)`. It acquires one queue slot for the whole challenge and replays every fight on one message. Only the last fight's final frame gets `outcome.exp` (so level-ups show once, at the end), and the final edit adds `buildChallengeEmbed`. While waiting, the place-in-line text uses `challengeHeader(outcome, 0)`.

- [ ] **Step 1: Write `tests/challengePlayback.test.js`.** Set `PLAYBACK.delayMs = 0`, build Outcomes with `runChallenge` (Task 3 helpers), and use a stub channel whose `send` and `edit` record their options. Assertions:
  - A cleared Elite Four Outcome makes exactly 1 `channel.send`. Edit contents include `(1 of 4)` and `(4 of 4)`, and the last edit carries an embed titled `🏆 A cleared the Elite Four!`.
  - No sent or edited content, and no embed text, contains `<@` followed by any opponent key (Review Focus 5).
  - A lost single fight: the embed includes `💸 Lost 10% of their CC.`, and no text contains `ccLost` formatted as a number.
  - A first Brock win: the embed includes `Earned the Boulder Badge` and `2,500 CC`.
  - Holding one slot: with `queue = createQueue(1)`, starting two `playChallenge` calls at once makes the second's first message include `#1 in line`.
  - A failed `edit` stops the replay without throwing and frees the slot (mirroring the `runBattle.test.js` case).
- [ ] **Step 2:** Run `node tests/challengePlayback.test.js`. It fails.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run `node tests/challengePlayback.test.js` and `node tests/runBattle.test.js`. Both pass, and `/battle` replays are unchanged.
- [ ] **Step 5: Commit** `Replay challenges, with the Elite Four run in one message`.

---

### Task 5: The `/challenge` command

**Files:**
- Create: `commands/challenge.js`
- Test: `tests/challengeCommand.test.js`

**Interfaces:**
- Consumes: Tasks 2 to 4, `lockUser` and `enqueueSave` (passed to `execute` by `bot_final.js:1847-1855`), `logEvent` (`utils/eventLog.js`), and `spritePaths.trainers` (`spriteconfig.js`).
- Produces:
  - `data`: `/challenge` with the description `Take on Kanto's Gym Leaders, the Elite Four, Blue, and Red`, and an optional string option `opponent` (description `Who to challenge; leave empty to see your progress`) whose choices are `CHALLENGE_KEYS` with their labels.
  - `refusal(reason, user) -> string` with this exact copy:
    - `no_team`: `Set a Team on your dashboard first.`
    - `locked_elite4`: `Earn all 8 Badges first. You have ${n}.`
    - `locked_blue`: `Clear the Elite Four to challenge Blue.`
    - `cap`: `You've used all 5 challenges today. They reset at midnight UTC.`
    - `pending_wager`: `Finish your pending wager first.`
    - `no_perms`: `I can't post challenges in this channel. Try another one.`
    - `settled`: `This challenge already happened.`
  - `boardEmbed(user, now) -> EmbedBuilder`. The title is `Kanto challenges`. There's one line per Gym, `${badgeEmoji} **${leader}** · ${type}`, with ` ✅` appended when earned. Then `🔒 **Elite Four** · ${8 - n} more Badges` or `**Elite Four**` (adding ` ✅` once cleared), `🔒 **Blue** · Clear the Elite Four` or `**Blue**`, and `**Red**`. The footer is `Challenges left today: ${left}/5`. No Levels anywhere.
  - `previewEmbed(user, key, { exactLoss }) -> EmbedBuilder`. The thumbnail is `spritePaths.trainers + displaySprite(first opponent)`, and the title is `opponentName` (or `Elite Four` for the run). For Gyms, the description has a Badge line `${badgeEmoji} ${badge}` and `${type}`. The fields are `Win` (prize text, or `Rematch: EXP only`) and `Lose`. `Lose` is `${loss} CC (10% of your CC)` when `exactLoss` is set, otherwise `10% of their CC`. The private preview uses `exactLoss`, and the public intro card doesn't.
  - `execute(interaction, trainerData, _saveLocal, _saveDiscord, lockUser, enqueueSave)`:
    - With no `opponent`, it replies privately with the board.
    - With an `opponent`, it checks permissions (ViewChannel, SendMessages, AttachFiles, the same as `commands/battle.js`) and `challengeBlock`, refusing privately on either.
    - Otherwise it replies privately with `previewEmbed(..., { exactLoss: true })` and the buttons `challenge_fight:<nonce>` (Success, `Fight!`) and `challenge_cancel:<nonce>` (Secondary, `Not now`). It collects clicks on the returned `InteractionResponse` (`createMessageComponentCollector`, `time: CHALLENGE.previewMs`, filtered by nonce).
    - Not now calls `i.update({ content: "Not now.", embeds: [], components: [] })`.
    - Expiry edits the reply to `Preview expired.` with no components.
    - Fight! calls `i.deferUpdate()`, then inside `lockUser(userId)` runs `runChallenge` with `maxLoss` = the previewed loss and saves with `enqueueSave(trainerData, { force: true })`. A refusal edits the preview to `refusal(reason)`.
    - After a successful fight, it edits the preview privately: `You won!` plus the prize text on a win, or `You lost ${ccLost} CC.` on a loss. Then it posts the public intro card (`previewEmbed` without `exactLoss`, no mention), logs `logEvent("challenge", userId, { key, seed, reached: fights.length, cleared, prize: !!prize, ccLost })`, and awaits `playChallenge(channel, outcome, challengeNames(...))`.
    - A second click after the fight gets `settled` as a private follow-up.

- [ ] **Step 1: Write `tests/challengeCommand.test.js`,** modeled on `tests/battleCommand.test.js`. The stubbed `interaction.reply` returns `{ createMessageComponentCollector }` (a controllable collector), and the button stubs have `update`, `deferUpdate`, `editReply`, and `followUp`. Assertions:
  - Board: with no `opponent`, the reply is ephemeral, has 8 Gym lines, contains no `Lv`, and the footer reads `Challenges left today: 5/5`.
  - Each refusal reason returns its exact copy privately, and nothing is sent to the channel.
  - The preview with CC 12345 contains `1,234 CC (10% of your CC)`.
  - Not now: nothing is sent to the channel, and `challenge.attempts` is unset or 0.
  - Expiry: ending the collector with `"time"` edits the reply to `Preview expired.`.
  - Fight! with a weak Team against Brock: the private edit contains `You lost 1,234 CC.`. The channel gets the intro card and the replay, and neither contains `1,234`. The record shows `cc` 11111 and `attempts` 1.
  - Double click: a second Fight! gets `This challenge already happened.`, and `attempts` stays 1.
  - Review Focus 1: after the preview, replace `trainerData.A` with `structuredClone(trainerData.A)`, then click Fight!. The live record (`trainerData.A`) has the attempt and the CC change.
  - Review Focus 2: after the preview, set `trainerData.A.displayedPokemon = []`, then click Fight!. The edit is `Set a Team on your dashboard first.` and nothing posts.
  - Review Focus 3: after the preview, set `trainerData.A.pendingWager = { nonce: "x" }`, then click Fight!. The edit is `Finish your pending wager first.`.
- [ ] **Step 2:** Run `node tests/challengeCommand.test.js`. It fails.
- [ ] **Step 3:** Implement `commands/challenge.js` per Interfaces. `bot_final.js:1244` loads it automatically. Fight! runs in the collector, outside the 25-second command timeout (`bot_final.js:262`), so the private result isn't overwritten.
- [ ] **Step 4:** Run `node tests/challengeCommand.test.js` and `node tests/battleCommand.test.js`. Both pass.
- [ ] **Step 5: Commit** `Add /challenge with a private preview and the Fight! button`.

---

### Task 6: Badges on `/trainercard` and the dashboard

**Files:**
- Modify: `commands/trainercard.js:510-517` (the description), `public/picker-pokemon/index.html` (after `#statsBar`), `public/picker-pokemon/script.js` (`updateHUD`), `public/picker-pokemon/style.css`
- Test: none new. The logic (`badgeLine`, `earnedBadgeKeys`) is tested in Task 2. What's left is one description line and markup, which no test here reaches (there's no DOM harness and no `/trainercard` stub). The check is spec manual test steps 16 and 17.

**Interfaces:**
- Consumes: `badgeLine` (Task 2) and `GYM_BADGES` / `earnedBadgeKeys` (Task 2).
- Produces:
  - `/trainercard`'s description gains `${badgeLine(user)}\n` right after the `🧍 **Trainers:**` line.
  - The dashboard gets `<div id="badgeRow" class="badge-row"></div>` after `#statsBar`. `updateHUD` fills it with 8 `<img src=image alt="${badge}" title="${badge}">`, with class `earned` or `unearned`. `script.js` imports `GYM_BADGES` and `earnedBadgeKeys` from `./badges.js`. In CSS, `.badge-row` is a centered flex row of 32px icons with an 8px gap, `.badge-row img.unearned` gets `opacity: 0.25; filter: grayscale(1);`, and the row wraps at phone width.

- [ ] **Step 1:** Make the `/trainercard`, HTML, script, and CSS changes.
- [ ] **Step 2:** Run `node tests/challengeRoster.test.js` and `node tests/levelDisplay.test.js`. Both pass, apart from the emoji ID check. Run `node --check public/picker-pokemon/script.js`; it exits 0.
- [ ] **Step 3:** Start the bot locally, open the dashboard with a test player who has 2 Badges, and confirm the row shows 2 earned and 6 dimmed (broken-image alt text is expected until the art is in). Run `/trainercard` and confirm the `🏅 **Badges:** 2/8` line.
- [ ] **Step 4: Commit** `Show Badges on /trainercard and the dashboard`.

---

### Task 7: Balance test and tuning

**Files:**
- Create: `tests/challengeBalance.test.js`
- Modify: `utils/challenge/roster.js` (ace targets, only if the order fails), `tests/challengeRoster.test.js` (the ace assertion, if retuned), and the spec (the measured gates)

**Interfaces:**
- Consumes: `simulateChallenge` (Task 3), `CHALLENGES` (Task 2), `catchBand` (`utils/training.js`), `teamExp`, `expForLevel`, and `levelForExp`.
- Produces: printed gate Levels, win-rate curves, surge flips, and leveling pace, plus the enforced order.

- [ ] **Step 1: Write `tests/challengeBalance.test.js`.**
  - Stand-in pool: species in `battleData.json` whose `pokemonData` `evolvesTo` is empty and whose `catchBand(id)` isn't `"legendary"`. `standIn(level, rng)` picks 6 distinct species from the pool at `level`, with RNG seed `20261109`.
  - `winRate(key, level, n = 200)` is the fraction of `simulateChallenge` runs with `cleared`.
  - `gate(key)` is the lowest Level from 1 to 100 with `winRate >= 0.5`, found by binary search, or 101 if none.
  - Assert `gate("giovanni") < gate("elite4") < gate("blue") < gate("red")`.
  - Print every challenge's gate, and its win rate at Levels 20, 30, through 100.
  - Surge flips: for each challenge at `gate - 5`, out of the losses, count how many win when re-simulated with the rolled surge versus with no surge. Print the rate.
  - Pace: starting from `gate("elite4")`, count days to Lv 100 at 10 Battles a day (the `battleRewards.test.js` model), and again with 5 cleared Elite Four runs added each day (the EXP for knocking out all 24 Elite Four Pokémon, with the win bonus on each fight). Print both day counts.
  - Print the runtime.
- [ ] **Step 2:** Run `node tests/challengeBalance.test.js`. If the order assertion fails, adjust the ace targets in `roster.js` by shifting whole teams (the spread rule in the spec), rerun, and update `tests/challengeRoster.test.js` to match.
- [ ] **Step 3:** Copy the printed gates, surge flip rates, and pace into the spec's Open checks, each followed by `(node tests/challengeBalance.test.js)`.
- [ ] **Step 4:** Run `node tests/challengeBalance.test.js` again. It passes, and the printed numbers match the spec.
- [ ] **Step 5: Commit** `Measure challenge gates and leveling pace`.

---

### Task 8: Docs and full check

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-11-08-challenges-design.md` (status of open checks)

- [ ] **Step 1: README.** Add a `## Challenges` section after Battles. It covers `/challenge` and the board, the ladder (Gyms in any order, 8 Badges for the Elite Four run, Blue after the run, Red open to all), the 5-a-day cap next to Battles' 10, EXP on every attempt, one-time prizes and the sprite rule, the private preview, the 10% loss, and where Badges show. Add the five new test files to Tests, with one line each on what they cover. Under Setup, add the Badge emoji upload (8 PNGs at 128×128 and under 256 KiB, uploaded in the Developer Portal, IDs pasted into `utils/challenge/badgeEmojis.js`, the same files copied into `public/sprites/badges/`). Add a gotcha for when `npm test` fails at the Badge emoji ID check. Note that `TRAINER_COSTS` now lives in `utils/trainerCosts.js`.
- [ ] **Step 2: Stale-entry check.** `grep -n "Battle cap\|10 battles\|trainercard\|TRAINER_COSTS\|public/dashboard" README.md CONTEXT.md docs/superpowers/specs/*.md` and fix anything that no longer holds.
- [ ] **Step 3:** Run `npm test`. Only the two expected failures remain (saveQueue, and the Badge emoji ID check).
- [ ] **Step 4:** Start the bot locally with `REGISTER_COMMANDS=true` (`npm start`) and check that it boots and registers `/challenge`. Run spec manual steps 1–4 in a test server as far as the art allows.
- [ ] **Step 5: Commit** `Document challenges`.
- [ ] **Step 6:** Native's end-of-branch review: one fresh reviewer on the whole branch diff against `origin/master`.
