# Battle FX: status and stat-change animations

Status: designed 2026-11-13 in a `/grill-with-docs` session, not built.
Branch: `design/full-sim`.

## Goal

In a Discord battle replay, status conditions and stat changes should be obvious and fun. Today the replay only tells them in text added to the attack's text box. With Battle FX, each one gets a short animated moment, a **beat**, with its own text line. Two marks also stay on the field: a status tag on each Pokémon that has one, and stat chips on the fighting Pokémon.

## Scope

- **Discord replay only.** `utils/battle/render.js` and `utils/battle/playback.js`. The Battle Records browser replay (`public/battlerecords/replay.js`) doesn't change.
- **Full-sim fights only.** Results with `v: 2` and `steps`. Today's engine and the Mega effects engine have no statuses to show, so their images don't change.
- **One switch.** `BATTLE_FX`, on by default. `BATTLE_FX=0` gives exactly today's turn images and pacing.
- **What gets animated.** The six major status conditions, Leech Seed, confusion, and stat changes. Hazards, weather, screens, items, and abilities stay as text in the attack's box, as today.

## Terms

CONTEXT.md defines **Stage** as a species' place in its evolution line, and the README uses "stat boost" for the hidden boost Challenge opponents get (`CHALLENGE.statBoost`). So this design says neither for in-battle changes. These terms go into CONTEXT.md with the build, matching the README's existing "status conditions, stat changes":

- **Status condition.** One of the six major statuses: burned, poisoned, badly poisoned, paralyzed, asleep, or frozen. It stays through switching out. _Avoid_: ailment, status effect.
- **Stat change.** A battling Pokémon's temporary raise or drop to one stat, from −6 to +6, that ends when it leaves the field. _Avoid_: stat stage, stage, stat boost (the Challenge opponents' hidden boost), buff.

"Beat" is an implementation word for one animated moment in a replay image, so it stays out of CONTEXT.md.

## What players see

### Beats

A beat is one short animation with its own line in the text box. There are three kinds:

1. **Landing.** A status condition lands, Leech Seed lands, confusion starts, a status is cured (woke up, thawed out, status returned to normal), or stats change. Consecutive stat-change lines for one Pokémon from one cause are one beat, so Shell Smash is one beat, not five.
2. **Can't move.** The Pokémon is asleep, frozen, fully paralyzed, or hurt itself in its confusion.
3. **End of turn.** Burn, poison, and bad poison damage, and the Leech Seed drain. The HP bar drains during the beat, where today it jumps on the next image.

Each beat's line uses the games' and Showdown's wording (`utils/battle/narrate.js`). The attack's own box keeps the attack and its effectiveness lines, and drops the lines that became beats. A combined stat beat groups the stats by direction and amount, as the games do: "Cloyster's Defense and Sp. Def fell! Cloyster's Attack, Sp. Atk, and Speed rose sharply!"

The spotlight is the ring under the fighting Pokémon, which is also the only one drawn at full opacity. It follows switches inside a turn image: a U-turn, a Red Card or Roar drag, or a faint replacement. Today it stays on one Pokémon for the whole image. With it following, Intimidate, Toxic Spikes, and Sticky Web land on the Pokémon that's visibly in front.

A turn whose only lines can't be beats (a flinch, a recharge, "But it failed!") and that has no hit shows those lines one after another. Today such a turn's lines show up a turn late, in the next hit's box.

### Look: games-style pixel effects

Each effect is drawn on the Pokémon's tile, over its sprite, on the same 2-pixel grid as the ring.

| Condition | Beat |
|---|---|
| Burn | flames rising around the sprite, an orange flash |
| Poison | purple bubbles rising; bad poison is a deeper purple |
| Paralysis | yellow sparks, and the sprite jitters |
| Sleep | "Z"s drifting up from the sprite's head |
| Freeze | an ice burst and a pale blue tint over the sprite |
| Confusion | stars circling the sprite's head |
| Leech Seed | sprouts on the target, and green orbs flying to the seeder |
| Stat up | red chevrons rising, and an "ATK ▲▲" pop |
| Stat down | blue chevrons falling, and a "DEF ▼" pop |

A cure beat plays a short sparkle and removes the tag.

### Lasting marks

- **Status tag.** `BRN`, `PSN`, `TOX`, `PAR`, `SLP`, or `FRZ` takes the place of "HP" in the bar's left capsule, colored by the condition. It shows on every image while the status lasts, on benched Pokémon too, including the start and result images. It pops in on its landing beat and goes on a cure or a faint.
- **Stat chips.** These sit at the top-left of the fighting Pokémon's tile, opposite the MEGA tag at the top-right. They're red for a raise and blue for a drop, such as `ATK+2`. There are at most two lines of chips. A change that doesn't fit is left off, and the text box always names it. Chips go when the Pokémon switches out or its stat changes are cleared.
- **Elite Four.** A status carried into the next fight shows on that fight's start image.

### Long fights

A fight longer than its update limit (`FULL_SIM.maxUpdates`, 20, `utils/battle/tuning.js:95`) skips turns between images, as today. A skipped turn's beats don't play. The next image's tags and chips come from the recorded state, so they're right anyway.

## Timing

All frame counts are at `ANIMATION.delayMs`, 100 ms (`utils/battle/render.js:51`).

- **Segments.** A beat is 8 frames, 0.8 s (design value, locked in the grill). A hit stays `ANIMATION.eventFrames`, 7 frames (`render.js:51`). A line on a turn with no hit is also 8 frames. A switch takes no frames: the spotlight moves at the next segment.
- **Cap per image.** When an image's beats add up to more than the cap, they share it evenly, and each keeps at least 4 frames. The 4-frame floor is a design value: a hit's impact plays over its frames 2 to 5 (`frameState` in `render.js`). The cap's value is an open check, see below.
- **Pacing.** Only an image with beats changes the pace. The next update after it waits for its content to play, plus a read margin, and never less than `PLAYBACK.delayMs`, 2,000 ms (`tuning.js:81`). The read margin is 600 ms, a design value: it's today's margin after a two-hit turn, 2,000 − 2 × 700 ms. An image without beats waits exactly `PLAYBACK.delayMs`, even when its hits run past 2 s, as today. The wait before image N+1 is image N's `waitMs`, carried in the loop's `wait` variable as the VS card's hold is today. The wait scales with the `delayMs` a caller passes, as `waitMs × delayMs / PLAYBACK.delayMs`. That way the tests that replay with `delayMs: 0` (`tests/runBattle.test.js`, Playback) still run instantly.
- **GIF length.** Discord loops a GIF once its regular frames run out, which replays the turn so HP jumps back up (`render.js:42-47`). So each turn GIF keeps today's margin of regular frames past the next update: `ANIMATION.turnMs − PLAYBACK.delayMs`, 4,000 − 2,000 = 2,000 ms (`render.js:51`, `tuning.js:81`). Its regular frames last at least its content plus `ANIMATION.holdFrames` (10 frames, `render.js:51`), and at least its wait plus that margin. With no beats, that's today's `max(hits × 7 + 10, 40)` frames.
- **GIF size.** Today turn images have no size fallback, and beats add frames, not bigger ones. The bench reports the largest turn GIF. If any passes `MAX_GIF_BYTES`, 8 MB (`utils/render/spriteLoops.js`), the build stops for a decision on a fallback that cuts frames or animation. Otherwise there's no fallback.

## Data

### Conditions, recorded by the engine

The engine records each Pokémon's status condition, and the fighting Pokémon's stat changes, confusion, and Leech Seed. They go in a new result field, `conditions`, indexed like `snapshots`:

```
conditions[0]   after the Elite Four carry-over, before the leads come in (statuses only)
conditions[t]   at the end of turn t, after any replacements (t = 1 … turns)
conditions[t] = {
  status: [[side 0, one per Team slot], [side 1]],   // "" | "brn" | "psn" | "tox" | "par" | "slp" | "frz"; "" once fainted
  active: [ { slot, boosts: { atk: 2, … nonzero only }, confused, seeded } | null, … ]
}
```

- **Why the engine records them.** Rebuilding stat changes from the log alone misses Baton Pass, Psych Up (`-copyboost`), Haze (`-clearallboost`), and Transform. `NOTE_KINDS` (`utils/battle/showdown/result.js:51`) doesn't even keep `-copyboost`. Reading the engine's own state is exact and simpler.
- **How.** It needs no new patch on `@pkmn/sim`. `drive()` (`utils/battle/showdown/engine.js`) takes an `onTurn(b)` callback. It calls `onTurn` after `commitChoices()` whenever `b.turn` has moved on, which happens once the turn's replacements are in and `endTurn` has logged the next `|turn|`. It also calls it once when the battle ends mid-turn. `simulateFull` records `conditions[0]` in its `beforeStart`, after `applyCarryOver`, and passes the list to `buildResult`. A fight where a side starts with nobody able to battle returns `conditions: [conditions[0]]`. The AI's look-ahead runs on `Battle.fromJSON` copies and never calls `drive()` (`utils/battle/ai/choose.js:153`), so it can't write into the real fight's list.
- **Size.** About 100 bytes per turn. The field lives only on the in-memory result. Fight records and saved Elite Four runs don't keep it: `utils/fightRecordBuild.js` picks its fields, and a run saves only HP and `endStatus`.
- **Inside one image.** The tags and chips start from `conditions[turn − 1]` and change at each beat. A status lands or is cured, a stat change adds up, a switch clears that side's chips, and a faint removes its tag. The next image starts again from the recorded state, so an effect the beats can't express, such as Baton Pass, is right by the next image.
- **Results without `conditions`** get beats but no tags or chips. No Discord replay has one today, since each plays right after its fight.

### The timeline, one pure function

`turnTimeline(result, turn, names, { env })` goes in a new file, `utils/battle/timeline.js`. It reads `steps[turn − 1]`, `log[turn − 1]`, `snapshots[turn − 1]`, and `conditions[turn − 1]`, and returns the image's ordered segments with their frames:

- `hit`: a log event. With `BATTLE_FX` on, its `preNotes` and `notes` are rebuilt from this turn's steps by `buildResult`'s own rules, minus the lines that became beats. That also drops lines carried in from an earlier hitless turn.
- `beat`: its kind, side, and slot, its text, any HP change (from and to, plus the seeder's heal for Leech Seed), and the tags and chips after it.
- `line`: text with no animation, only on a turn with no hit.
Each segment also carries the spotlight's `active`, the HP, and the marks at its start, so a switch shows from the next segment on, and the timeline's `end` holds the state after the last one. The timeline applies every `hp` step in order. A beat animates its own. A hit's damage, drain, and recoil animate as today. Any other change (Leftovers, hazards, weather, Life Orb) applies at the next segment boundary, where today it waits for the next image. So after the last segment, HP equals `snapshots[turn]` and the tags equal `conditions[turn].status`, and the tests check this over seeded fights.

It also returns what pacing needs: `frames`, `waitMs`, `minFrames`, and whether there are beats.

The n-th move step in `steps[turn − 1]` is the n-th event in `log[turn − 1]`, because `buildResult` pushes both in the same place. Playback computes the timeline once per image and uses its `waitMs` for the next update. It then passes the timeline to the render thread, which it can clone to as plain data. With `BATTLE_FX=0` it returns today's events as hits, unchanged, with `waitMs` equal to `PLAYBACK.delayMs`.

### Rendering

- `renderBattleFrame` takes `timeline` in place of `events`. An image is a turn image when its timeline has any segment. Today the test is `events.length`, which treats a hitless turn as a start image, so it loops with an empty text box. Each frame's state comes from the segment it falls in: a hit plays as today, a beat plays its effect, a line shows its text, and the spotlight follows the segment's `active`.
- Start and result images take `marks`, which playback reads from `conditions[0]` and `conditions[turns]`, so their tags show.
- A beat that knocks a Pokémon out, such as a burn KO, grays its sprite, as a hit's faint does.
- The new `utils/battle/fx.js` draws the effects: one pure function per kind, `(ctx, box, phase)` with the phase from 0 to 1.
- `drawHpBar`'s stamp key includes the tag, so a tagged bar isn't copied from an untagged one.
- The chips' box joins the MEGA tag's box in the row backdrop's occupancy map, so a tier backdrop's effects stay off it.
- The palette also samples one mid-beat frame for each effect kind in the image, with today's first, award, and last frames, so flame orange and ice blue are in it.

## Open checks

`tools/bench-battle-fx.mjs` stays in the repo. It runs seeded full-sim fights with both sides on Status & stall (`status`), then on Set up & sweep (`setup`), plus Elite Four runs. It renders every turn image with `BATTLE_FX` on and off, on the render threads (`RENDER_THREADS`, 3 by default), and reports:

| Check | Why it matters | Reported |
|---|---|---|
| beat time per image | sets the cap | p50, p95, and max; the cap is set at the p95, so 95% of images play every beat at full length |
| turn GIF size | must stay under `MAX_GIF_BYTES`, 8 MB | the max, on and off |
| render time per turn image | each image renders during the wait before it | p50, p95, and max, on and off |
| render of N+1 against wait(N) + 2,000 ms, per consecutive pair | past that, image N's GIF runs out of regular frames and loops back | how many pairs exceed it, on and off |
| replay length per fight, and the worst Elite Four fight | a replay holds one of `PLAYBACK.maxAtOnce` (2) slots while it plays, and each Elite Four fight's private reply needs its button click's 15-minute window (the `tuning.js` comment by `staleRunMs`) | on vs off |

The render.js comment gives "~2.5–2.8 s between playback updates" from a screen recording, and that was never measured again. The bench reports the computed interval, `max(wait, render time)`, instead.

### Measured

`FULL_SIM_ENABLED=1 node tools/bench-battle-fx.mjs 40 5` ran on 2026-11-13 on a development Mac (darwin arm64, Node 22.22.3, 3 render threads), with no cap set. That covered 40 fights per plan, 5 Elite Four runs, and 1,758 turn images each way.

| Check | BATTLE_FX on | BATTLE_FX=0 |
|---|---|---|
| beat time per image, p50 / p95 / max | 800 / 2,400 / 4,000 ms | 0 |
| largest turn GIF | 989 KB | 881 KB |
| render per turn image, p50 / p95 / max | 237 / 365 / 769 ms | 215 / 289 / 758 ms |
| images that would loop back | 0 of 1,758 | 0 of 1,758 |
| replay per fight, p50 / p95 / max | 49 / 62 / 67 s | 42 / 42 / 42 s |
| worst Elite Four fight | 59.6 s | 42.0 s |

- **The cap** is the p95, 24 frames (`FX.capFrames`). An image with more than three beats shares 2.4 s among them.
- **GIF size.** The largest turn GIF is an eighth of `MAX_GIF_BYTES`, so there's no fallback.
- **Render time.** The slowest render, 769 ms, is well under the 2,000 ms wait it happens in.
- **Replay length.** A fight's replay grows by about 7 s at the median and 25 s at worst. That's far inside an Elite Four fight's 15-minute reply window.
- **Not measured yet:** the VPS, whose CPU is shared with other services.

## Tests

- **`tests/battleTimeline.test.js` (new).** Each beat kind, from real steps, with one test per condition. It also covers:
  - Shell Smash as one beat
  - a switch moving the spotlight, and Intimidate landing on the incoming Pokémon
  - cures, and a faint clearing a tag
  - beat lines removed from the hit's notes, with the other lines kept
  - a hitless turn getting its own lines, and the next turn not repeating them
  - the cap sharing frames evenly down to its floor
  - pacing: never under 2,000 ms, an image with no beats waiting exactly that, and the scaling by `delayMs`
  - the GIF length rule
  - `BATTLE_FX=0` returning today's events and wait
  - **the end-state check:** over seeded fights on both plans, every turn's HP after the last segment equals `snapshots[turn]`, and its tags equal `conditions[turn].status`
- **`tests/fullSimEngine.test.js` and `tests/fullSimResult.test.js`.**
  - `conditions` has one entry per snapshot in a fight that ends by knockout mid-turn, in one capped at the turn limit, and in one decided at turn 0.
  - A status lands and is cured.
  - Stat changes show on the active Pokémon (Swords Dance +2, Intimidate −1), go after a switch, go after Haze, and pass with Baton Pass.
  - An Elite Four carried status is in `conditions[0]`.
- **`tests/battleRender.test.js`.** Tag and chip pixels at their layout spots, and a beat's frames differing from the hold frames. Also the HP bar draining during a residual beat, a burn KO graying the sprite, a hitless turn rendering as a turn image, the start image's tags, and the palette sampling a mid-beat frame.
- **`tests/runBattle.test.js`, Playback.** The next update waits for the shown image's `waitMs`, scaled by the `delayMs` passed.
- **`tools/render-golden.mjs`.** Images with `BATTLE_FX=0`, and today's-engine images, stay identical frame for frame to before the change.

## Manual test plan

Run on the test bot with `FULL_SIM_ENABLED=1`. Use one test player on a Status & stall team (Thunder Wave, Will-O-Wisp, Toxic, and Leech Seed users) and one on a Set up & sweep team (Swords Dance, Dragon Dance, and Shell Smash users).

1. Run `/battle` between them. On the turn a status lands, its beat plays (flames, bubbles, sparks, "Z"s, or ice), and the text box shows its own line after the attack's. The tag appears in the bar's left capsule and stays on later images, benched too.
2. On a turn with burn or poison damage, the end-of-turn beat plays and the HP bar drains during it.
3. For a sleeping, frozen, or fully paralyzed Pokémon, the can't-move beat plays with its line ("is fast asleep.").
4. On waking up or thawing, the cure beat plays and the tag goes.
5. Swords Dance shows red chevrons and "ATK ▲▲", then an `ATK+2` chip that stays until it switches out. Shell Smash is one beat.
6. When Intimidate triggers on a switch-in, the spotlight is on the incoming Pokémon as its foe's Attack falls.
7. After a U-turn, the spotlight moves to the Pokémon that came in, inside the same image.
8. Leech Seed shows sprouts on the target, then orbs flying to the seeder at the end of the turn. Both HP bars move.
9. Confusion shows stars when it lands, then a self-hit beat that drains HP.
10. Watch a turn with several beats. No beat is cut off by the next update, and the GIF never loops back mid-turn.
11. Run an Elite Four fight that carries a burn into the next one. The next fight's start image shows `BRN`.
12. Set `BATTLE_FX=0` and restart. Replays look and pace exactly as before.

## Out of scope

- The Battle Records browser replay.
- Animations for hazards, weather, screens, items, and abilities.
- Today's engine and the Mega effects engine.
