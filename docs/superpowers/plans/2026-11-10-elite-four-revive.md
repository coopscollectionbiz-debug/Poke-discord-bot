# Elite Four Revive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Elite Four run interactive: after each won fight the player picks one fainted Pokémon to Revive at full HP, the run plays out one fight at a time, and every challenge's private result arrives after its replay.

**Architecture:** `simulateChallenge` gains a `pick` callback, which is enough for the balance test. Interactive runs get a small lifecycle in `utils/challenge/runChallenge.js` (`startRun`, `continueRun`, `finishOpenRun`, `finishAllOpenRuns`) that keeps the open run on the player's record at `challenge.run` and settles it with the same prize and loss code single fights use. `utils/battle/playback.js` replays one fight at a time on the run's message. `commands/challenge.js` drives the loop: replay a fight, offer the Revive buttons privately, continue. `bot_final.js` finishes open runs at startup.

**Tech Stack:** Node 22 ESM, discord.js 14.28.0 (installed in the worktree), the in-repo sim, plain-node tests on `tests/harness.js`.

**Spec:** `docs/superpowers/specs/2026-11-08-challenges-design.md`, sections "Difficulty", "Elite Four run" (including "Revive"), "Discord UX", "Data", and "Open checks". This plan builds on `docs/superpowers/plans/2026-11-09-challenges.md`, which is done.

## Global Constraints

- Everything in the first plan's Global Constraints still holds: American English, UI copy rule, no new dependencies, `challenge` never in the `/api/updateUser` allowlist, no exact CC loss or balance in public, results saved before the replay that shows them, re-read `trainerData[userId]` inside the lock and never hold a user object across an await, challenges never touch `user.battle`.
- Challenges have no Underdog surge on either side. `/battle`'s surge (cap 8%, `SURGE.maxChance`) is unchanged.
- Every way out of a Revive break leads to the next fight or the end of the run.
- Discord facts used here (verified 2026-11-10): interaction tokens are valid for 15 minutes, and the first response must come within 3 seconds ([Discord docs](https://docs.discord.com/developers/interactions/receiving-and-responding)). In discord.js 14.28.0, a collector on a message matches clicks by `interaction.message.id` (`InteractionCollector.js:153`), and `interaction.editReply({ message })` edits a follow-up through the interaction webhook (`InteractionResponses.js:247`); `Message#edit` uses the channel endpoint and can't edit a private follow-up.
- `npm test` has two expected failures: `tests/saveQueue.test.js` (fails on origin/master) and the Badge emoji ID check in `tests/challengeRoster.test.js` (fails until the art is uploaded). Any other failure is a regression.
- Commit after each task (approved for this branch).

## Review Focus

1. **A late or repeated Revive click.** A click after the 60-second deadline, a second click, or a click from an earlier break must not revive anything or advance the run. It gets "Too late. No Pokémon was revived." Task 4 tests this.
2. **Fight! on an older preview while a run is open.** It refuses with "Finish your Elite Four run first." Task 2 tests `run_open` in `challengeBlock`, and Task 4 tests the click.
3. **The record replaced mid-run.** A dashboard save copies the record, `challenge.run` included, under the same lock. The next step must find the run on the live record and continue. Task 2 tests this.
4. **A Team member given away mid-run.** It gets no EXP at the end, and no training record is created for it. Task 2 tests this.
5. **A run that stops unexpectedly.** If its last step is more than 15 minutes old, the next `/challenge` finishes it with no Revives before doing anything else. Tasks 2 and 4 test this.

---

### Task 1: No surge, original Elite Four Levels, Revives in the sim

**Files:**
- Modify: `utils/challenge/runChallenge.js` (`simulateChallenge`; the surge removal is already in the working tree, uncommitted), `utils/challenge/roster.js` (Elite Four Levels +1, back to the draft), `utils/battle/playback.js` (surge lines already removed, uncommitted)
- Test: `tests/runChallenge.test.js`, `tests/challengeRoster.test.js`, `tests/challengeBalance.test.js`, `tests/challengePlayback.test.js` (surge test already removed)
- Docs: `CONTEXT.md` and the spec are already updated, uncommitted.

**Interfaces:**
- Produces: `simulateChallenge({ team, opponents, seed, pick = () => null }) -> { fights, cleared, breaks }`.
  - After each won fight except the last, if any `hp[slot] === 0`, it calls `pick({ team, hp, next })`, where `hp` is the HP fractions after that fight and `next` is the next opponent. A returned slot whose HP is 0 comes back at `1`. Anything else (null, an out-of-range slot, a slot still standing) revives nothing.
  - `breaks[k]` describes the break after fight `k`, for each break reached: `{ offered: boolean, slot: number | null }`. `offered` is false when nothing had fainted.
  - Fights carry `surge: null` (already in the tree). The sim seed for fight `i` stays `seed + 2 * i + 1`.
- Elite Four Levels: every Pokémon +1, giving aces 56, 57, 58, 60, the draft values before Task 7 of the first plan shifted them. Restore the spec's Rosters table and its "Tuning" bullet to match (the bullet now says the −1 shift was undone because the Revive breaks the tie with Blue).

- [ ] **Step 1: Tests.**
  - `tests/challengeRoster.test.js`: Elite Four aces `[56, 57, 58, 60]`, and the four teams' Levels equal the draft values (Lorelei 54, 53, 54, 56, 56, 55; Bruno 52, 54, 54, 55, 57, 54; Agatha 54, 54, 53, 56, 58, 55; Lance 56, 54, 54, 58, 60, 56).
  - `tests/runChallenge.test.js`, section "Revive in the sim":
    - With `pick = ({ hp }) => hp.findIndex((h) => h === 0)`, a run that reaches a second fight with a fainted Pokémon has `fights[k + 1].result.snapshots[0][0][slot] === 1` for the picked slot, and the other slots carry their HP as before.
    - `pick` is never called after a win with nothing fainted, and that break is `{ offered: false, slot: null }`.
    - A pick of a standing slot, `7`, or `null` revives nothing (fainted stay at 0), and the break records `slot: null`.
    - `breaks.length === fights.length - 1` for every run.
    - The fixture from "A win with every Pokémon fainted" plus a pick of slot 0 makes fight 2 last at least 1 turn.
    - The existing "no Underdog surge" section stays.
  - `tests/challengeBalance.test.js`: the Elite Four gate uses a stand-in player who always picks the fainted Pokémon with the highest `teamPower([member])` (earlier slot on a tie). Also print the run's gate with no picks, labeled "never picks". The order assertion uses the picking gate.
- [ ] **Step 2:** Run the four test files. The roster test fails on the aces, the runChallenge test fails on `breaks` and picks, and the balance test fails its order check (Elite Four 74 ties Blue 74 now).
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run the four files, `node tests/challengeCommand.test.js`, and `npm test`. Only the two expected failures remain.
- [ ] **Step 5:** Copy the balance test's printed numbers into the spec's Measured section, and replace the Elite Four open check with the measured gates (picking and never-picking), each with `(node tests/challengeBalance.test.js)`. Update the Measured surge bullets for no surge in challenges.
- [ ] **Step 6: Commit** `Drop the surge from challenges and add Revives to the Elite Four sim`.

---

### Task 2: The run's lifecycle

**Files:**
- Modify: `utils/challenge/runChallenge.js`, `utils/battle/tuning.js`
- Test: `tests/runChallenge.test.js`

**Interfaces:**
- Consumes: `simulateChallenge`'s per-fight pieces, `applyGains`, `buildTeam`, `getChallengeRecord`, `prizeFor`, `challengeLoss`.
- Produces:
  - `CHALLENGE` gains `pickMs: 60 * 1000` and `staleRunMs: 15 * 60 * 1000`.
  - `challengeBlock` checks `run_open` first: `user.challenge?.run` exists. The rest of the order is unchanged.
  - `challenge.run` on the record: `{ nonce, seed, maxLoss, day, team, hp, next, gains, fights: [{ opponentKey, won }], breaks, updatedAt, channelId, messageId }`. `team` is the `buildTeam` result at Fight!, `next` is the index of the next fight, `gains` is the per-member EXP total so far, and `updatedAt` is a ms timestamp.
  - `startRun({ trainerData, userId, seed, maxLoss, channelId, now }) -> { ok: false, reason } | Step`. It runs `challengeBlock` for `elite4`, records the attempt, creates `challenge.run`, and simulates fight 0.
  - `continueRun({ trainerData, userId, nonce, step, slot, now }) -> { ok: false, reason: "stale_step" } | Step`. It requires `run.nonce === nonce && run.next === step`, applies the Revive (same rule as `pick`), records `breaks[step - 1]`, and simulates fight `step`. Use `slot === undefined` for "nothing to offer" (`offered: false`) and `null` for "offered, nothing picked".
  - `Step`: `{ ok: true, nonce, step, view, ended, outcome, fainted, next }`.
    - `view` is the run so far in the shape playback reads: `{ key: "elite4", userId, fights, breaks }`, where `fights[i]` (the fight just simulated) is complete (`opponentKey, sides, surge: null, result, winnerId, gains`), and earlier fights are `{ opponentKey, winnerId }`.
    - `step` is the index of the fight just simulated.
    - When the run ended (a loss, or Lance beaten), `ended` is true and `outcome` is the full Outcome. It extends the first plan's Outcome with `breaks`, and `outcome.fights` has every fight. `challenge.run` is removed.
    - Otherwise `fainted` is `[{ slot, name, level }]` for HP-0 members (may be empty), and `next` is the next opponent.
  - `finishOpenRun({ trainerData, userId, now }) -> Outcome | null`: plays the remaining fights with no Revives (breaks `{ offered: true, slot: null }` when something fainted), settles, and removes the run. Returns `null` with no open run.
  - `isRunStale(user, now) -> boolean`: `now - run.updatedAt > CHALLENGE.staleRunMs`.
  - `finishAllOpenRuns(trainerData, now) -> [{ userId, outcome, channelId, messageId }]`.
  - `attachRunMessage(user, nonce, { channelId, messageId })`: sets them when the nonce matches.
  - Settling is shared with `runChallenge`: sum the gains, apply EXP, then the prize and Badge/unlock, or the loss of `min(maxLoss, challengeLoss(cc))`. For runs, apply EXP only to members the player still owns (`user.pokemon[id][variant] > 0`). The EXP report lists only those. `won.elite4` takes `run.day`.
- Determinism: fight `i` of a run is simulated with `seed + 2 * i + 1`, so an interactive run whose picks match `pick` reproduces `simulateChallenge` exactly.

- [ ] **Step 1: Tests** in `tests/runChallenge.test.js`, section "Interactive Elite Four run". Use the `player` helper with 8 Badges.
  - `startRun` with STRONG: `ok`, `step` 0, the attempt counted, `challenge.run.next === 1`, `ended` false, `next.name === "Bruno"`.
  - `run_open`: with a run open, `challengeBlock` returns `"run_open"` for `brock`, `elite4`, and `red` (Review Focus 2).
  - Matching the sim: for 30 seeds with a Lv 60 Team and a pick of the first fainted slot, driving `startRun` then `continueRun` with the same picks gives the same `cleared` and per-fight winners as `simulateChallenge` with that `pick`.
  - Stale steps: `continueRun` with the wrong nonce or a past step returns `{ ok: false, reason: "stale_step" }` and changes nothing (Review Focus 1).
  - `slot: null` after something fainted records `{ offered: true, slot: null }`, and the fainted stay at 0.
  - The end: a cleared run's `outcome` has 4 fights, `breaks` of length 3, `prize`, `unlocked: "blue"`, and `challenge.run` removed. A lost run's `ccLost` is `min(maxLoss, 10%)`.
  - Record replaced mid-run: after `startRun`, `trainerData.A = structuredClone(trainerData.A)`, then `continueRun` succeeds on the live record (Review Focus 3).
  - Given away mid-run: after `startRun`, set one member's count to 0 and delete its training. Finish the run. That member has no training record, and the EXP report doesn't list it (Review Focus 4).
  - `finishOpenRun`: from an open run, it returns an Outcome with no Revives and removes the run. With no run, it returns `null`.
  - `isRunStale`: false at `updatedAt + 15 min`, true at `+ 15 min + 1 ms` (Review Focus 5).
  - `finishAllOpenRuns`: two players with open runs and one without returns 2 entries with their `channelId` and `messageId`, and both runs are gone.
  - `attachRunMessage` ignores a wrong nonce.
- [ ] **Step 2:** Run `node tests/runChallenge.test.js`. The new section fails.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run `node tests/runChallenge.test.js` and `node tests/challengeCommand.test.js`. Both pass.
- [ ] **Step 5: Commit** `Run the Elite Four one fight at a time, saved on the player's record`.

---

### Task 3: Replay one fight at a time

**Files:**
- Modify: `utils/battle/playback.js`
- Test: `tests/challengePlayback.test.js`

**Interfaces:**
- Consumes: `Step.view` and the final Outcome (Task 2).
- Produces:
  - `challengeHeader(outcome, i)`: for `i > 0` with `outcome.breaks[i - 1]?.offered`, it adds a line. If the slot is set, `💊 <@player> revived <name>!`, with the name from `outcome.fights[i].sides[0].members[slot].name` or the run's Team. Otherwise `💊 No Pokémon was revived.`
  - `playChallengeFight(channel, message, outcome, i, names, { last, maxUpdates, delayMs, queue } = PLAYBACK) -> message | null`. It holds one replay slot for this fight only, and replays fight `i` on `message` (or a new channel message when null; a first post that fails throws). It paces the start frame when `message` exists. With `last`, the result frame gets `outcome.exp` and `buildChallengeEmbed(outcome, names)`. It returns null if an edit fails. `playChallenge` (single fights) keeps its behavior and may use this.
  - `showChoosing(message, outcome, i) -> Promise<boolean>`: edits the content to `challengeHeader(outcome, i)` plus `\n⏳ <@player> is choosing a Pokémon to revive…`. It returns false if the edit fails and never throws.
  - `showRunResult(message, outcome, names, note) -> Promise<boolean>`: edits the message to `content: note` and `embeds: [buildChallengeEmbed(outcome, names)]`, with no new image. It never throws. The notes are in Task 4 and Task 5.
- [ ] **Step 1: Tests:**
  - Headers: a view with `breaks[0] = { offered: true, slot: 2 }` gives line 2 of `challengeHeader(view, 1)` as `💊 <@A> revived <member 2's name>!`. `{ offered: true, slot: null }` gives `💊 No Pokémon was revived.`, and `{ offered: false }` adds no line.
  - `playChallengeFight` for fights 0, 1, then the last with `last: true`: 1 `send`, the same message edited throughout, the embed only on the last call's final edit, and with `queue = createQueue(1)` the slot free between calls (a second `acquire` resolves between fights).
  - `showChoosing` edits the content and returns true. With a failing edit it returns false without throwing.
  - `showRunResult` sets the note and the embed, and returns false on a failing edit.
  - No text contains `<@` plus an opponent key (as in the existing test).
- [ ] **Step 2:** Run `node tests/challengePlayback.test.js`. It fails.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run `node tests/challengePlayback.test.js` and `node tests/runBattle.test.js`. Both pass.
- [ ] **Step 5: Commit** `Replay Elite Four fights one at a time, with the Revive in the header`.

---

### Task 4: `/challenge`: the Revive menu, and results after the replay

**Files:**
- Modify: `commands/challenge.js`
- Test: `tests/challengeCommand.test.js`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces:
  - `refusal("run_open")`: `Finish your Elite Four run first.`
  - **Before anything else** in `execute` with an opponent, and inside the Fight! lock: if `isRunStale(live, now)`, call `finishOpenRun`, save, and `showRunResult` on the run's message (fetched by `channelId`/`messageId`, ignoring failures) with the note `⚔️ <@player>'s Elite Four run stopped unexpectedly and finished without Revives.` Then continue.
  - **Fight! (every challenge):** `i.update({ content: "⚔️ Your challenge is starting below.", embeds: [], components: [] })`. The private result (`privateResult(outcome)`, unchanged) is edited onto the preview with `fightClick.editReply` only after the last replay ends. A post failure still edits in `It counted, but I couldn't post it in this channel.`
  - **Single fights:** as now, with the private result moved after `playChallenge`.
  - **Elite Four:** under the lock, `startRun` with the interaction's `channelId`, then save. Post the intro card, then loop:
    1. `playChallengeFight` for `step.step` (`last: step.ended`). After the first one, `attachRunMessage` under the lock, then save.
    2. If `step.ended`, stop.
    3. If `step.fainted` is empty, `continueRun(slot: undefined)`.
    4. Otherwise `showChoosing`, then the Revive menu.
       - It's sent with `latest.followUp({ content, components, flags: Ephemeral })`, where `latest` is the newest click (Fight!, or the last Revive click).
       - Content: `Next: <name> · <type>\nPick a Pokémon to revive · 60 s`.
       - One Success-style button per fainted Pokémon, labeled `<name> Lv <level>`, with ID `challenge_revive:<nonce>:<step>:<slot>`, up to 5 per row.
       - Collect on the returned message for `CHALLENGE.pickMs`.
       - The first click calls `i.update({ content: "<name> revived.", components: [] })` and becomes `latest`.
       - At the deadline, call `latest.editReply({ message: menu, content: "No Pokémon was revived.", components: [] })`.
       - A send that fails counts as no pick.
    5. Then `continueRun` under the lock with that slot (or `null`), save, and repeat.
  - **A click after its break** (collector ended, or a wrong step): `i.reply({ content: "Too late. No Pokémon was revived.", flags: Ephemeral })`.
  - `logEvent("challenge", ...)` gains `revives: breaks.map((b) => (b.offered ? b.slot : "none"))` for runs.
- [ ] **Step 1: Tests** in `tests/challengeCommand.test.js`. Extend the harness: Revive-button stubs, plus `followUp` on button stubs that returns a message with a controllable collector. Use 8 Badges. The command picks its own seed, so use a Team whose behavior holds for any seed: Lv 5 Magikarp (129) leading, then Lv 100 Mewtwo (150) and Lv 100 Lugia (249). Magikarp faints to Lorelei's lead, and the other two clear every fight. Pin that as a fixture precondition: across 200 seeds, `simulateChallenge` clears, and Magikarp is at 0 HP after fight 0. Assertions:
  - Fight! updates the preview to `⚔️ Your challenge is starting below.`. The private result isn't edited in until the last replay has run (check the order of the recorded calls).
  - With a fainted Pokémon after Lorelei: the public message's content gains `⏳ <@A> is choosing a Pokémon to revive…`, and the private menu's content starts with `Next: Bruno · Fighting`, with one button per fainted Pokémon labeled `<name> Lv <level>`.
  - A click revives it: the menu updates to `<name> revived.`, and the next fight's header contains `💊 <@A> revived <name>!`.
  - Ending the collector with `"time"` edits the menu to `No Pokémon was revived.`, and the next header contains `💊 No Pokémon was revived.`
  - A second click, or a click on an earlier break's button, gets `Too late. No Pokémon was revived.` privately and changes nothing (Review Focus 1).
  - While a run is open, `/challenge opponent:brock` refuses with `Finish your Elite Four run first.`, and Fight! on an older Brock preview refuses the same way (Review Focus 2).
  - A stale run (move `challenge.run.updatedAt` back 16 minutes): `/challenge` finishes it, edits the run's message to the stopped-unexpectedly note, and then shows the board or preview (Review Focus 5).
  - A single fight: the preview shows `⚔️ Your challenge is starting below.` first, and `You lost 1,234 CC.` arrives after the replay.
  - No public text contains `1,234`.
- [ ] **Step 2:** Run `node tests/challengeCommand.test.js`. The new assertions fail.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run `node tests/challengeCommand.test.js`, `node tests/battleCommand.test.js`, and `npm test`. Only the two expected failures remain.
- [ ] **Step 5: Commit** `Let players pick a Revive between Elite Four fights`.

---

### Task 5: Startup, docs, and the full check

**Files:**
- Modify: `bot_final.js` (next to `refundPendingWagersOnStartup`, `bot_final.js:2299` after the rebase), `README.md`, the spec

- [ ] **Step 1: Startup.** Add `finishOpenRunsOnStartup()`.
  - It calls `finishAllOpenRuns(trainerData, new Date())`, then saves with `enqueueSave(..., { force: true })` if any were finished.
  - For each entry with a message, it fetches the channel and message, and calls `showRunResult` with the note `⚔️ The bot restarted, so <@player>'s Elite Four run finished without Revives.`. It uses `challengeNames` with the stored name fallback (`trainerData[userId].username` or `Trainer`).
  - It logs a count, and runs in the `ready` handler right after the wager refund.
  - Verify with `node --check bot_final.js`. The pure part is covered in Task 2.
- [ ] **Step 2: README.** In Challenges:
  - Describe the Revive: after each win, pick one fainted Pokémon within 60 seconds, which comes back at full HP; no pick means no Revive; there's no forfeit; and a restart finishes the run without Revives.
  - Say challenges have no Underdog surge.
  - Say the private result arrives after the replay.
  - Update the test descriptions for `runChallenge`, `challengePlayback`, `challengeCommand`, and `challengeBalance`.
- [ ] **Step 3: Spec.**
  - Code changes and Tests: list the lifecycle, playback, command, and startup pieces.
  - Manual test plan: add the 13 steps from the grill synthesis as steps 19–31, and change step 4's private-reply wording to "after the replay".
  - Grep the spec, README, and CONTEXT for stale mentions of `surge`, `simulates the whole run at once`, and `Fighting…`.
- [ ] **Step 4:** Run `npm test`. Only the two expected failures remain.
- [ ] **Step 5: Commit** `Finish open Elite Four runs at startup; document the Revive`.
- [ ] **Step 6:** End-of-branch review with one fresh reviewer, on the diff from `6c1fb5b` (the 8% surge commit) to HEAD, with this plan's Review Focus.
