# Cuteness and the cute surge

Decided with the owner on 2026-11-11. Casual battles only.

## Goal

A cute Team should sometimes beat a far stronger one. The owner first asked for a cute Team to beat a Team of mythics about 25% of the time, then raised it later the same day: "10/10 should be 42%" and "Typical cute team should win 20% of the time". So against six mythics, a Team averaging 10 wins about 42% and a typical cute Team (scored 6 or 7) about 20%. Every other battle stays as it is today.

## Scores

- Every species (1 to 1,025) and every Mega form has a hand-written **Cuteness** score from 0 to 10. A Mega form has its own score, separate from its base species. Normal and shiny share a score.
- The scores fall in two clusters (owner: "It should really be a bimodal distribution of cute and not-cute pokemon"), and they're strict (owner, later the same day: "There should only be a handful of 10s"). Pokémon that aren't cute score 0 to 2, most cute ones score 6 or 7, a step up gets 8 or 9, and only 10 species score 10.
- They live in `data/battle/cuteness.json`, outside `public/`, the only folder the web server serves (`bot_final.js:427`). Nothing sends them to the dashboard or any API, and `tests/cuteness.test.js` checks both.
- Every score was drafted by hand, and the owner reviews them on an editable review page. The owner's edits get copied back into the file. The owner's first pass, on 2026-11-11, changed 92 scores and put 67 species between the clusters, at 3 to 5.

## The cute surge

- A Team's Cuteness is the average of its members' scores. A slot fighting as a Mega uses its Mega form's score. One Pikachu counts as a fully cute Team.
- Only the Underdog's Cuteness counts, and only in casual battles. The Underdog is the side with the lower Power rating, at a gap of at least `SURGE.minRatio` (1.25, `utils/battle/tuning.js:23`), the same rule as today. The cute Team can be either the Challenger or the Defender.
- Today's Underdog surge doesn't change: the same chance, the same lift to a `SURGE.residual` gap, and the same first draw from the seed.
- Cuteness adds a second roll, the cute surge, drawn after today's roll. Its chance is `CUTE.chance × k`, where `k = ((Team Cuteness − 5) / 5) ^ CUTE.curve`, clamped to 0..1. A straight line (`curve` 1) can't give both of the owner's targets, so `curve` is 0.55: `k` rises fastest just above 5 and reaches 1 at 10 (owner's pick, 2026-11-11). A Team averaging 5 or less never rolls, so its battles stay identical to today, seed for seed. When the cute surge fires, it replaces today's surge for that battle.
- A cute surge lifts the Team's Levels until its Power is `CUTE.margin` times the other Team's. Levels stop at 100, and a stat boost makes up the rest. There's no cap on that boost, even for a lone Pokémon (owner decision).
- After a cute surge, each of the surging Team's Pokémon earns EXP as the Level the surge lifted it to (Lv 100 once the stat boost takes over). A far stronger opponent then pays like an even fight, so picking the strongest Team around isn't a way to farm EXP. Today's surge keeps paying EXP at real Levels.

## What players see

- When a Team averaging over 5 surges, by either roll, the battle's heading says "💖 The crowd can't resist @Ash's team! Underdog surge!" instead of "🔥 The crowd is behind @Ash! Underdog surge!".
- The replay's surge outline and tag are unchanged. No score, boosted Level or stat boost appears anywhere.

## Code

- `data/battle/cuteness.json`: `{ species: { "<id>": score }, megas: { "<form id>": score } }`.
- `utils/battle/cuteness.js`: a member's score, a Team's Cuteness, and `k`.
- `utils/battle/tuning.js`: `CUTE` (threshold, chance, curve, margin).
- `utils/battle/power.js`: `rollSurge` takes each side's Cuteness and returns the cute surge, and `cuteSurgeBoost` finds the stat boost past Lv 100.
- `utils/battle/sim.js`: applies the surge's stat boost.
- `utils/battle/runBattle.js`: passes Cuteness to `rollSurge`, and counts a cute surge's members at their surged Levels for EXP.
- `utils/battle/playback.js`: the 💖 heading.

## Tests

- `tests/cuteness.test.js`: every species and Mega form has a whole-number score from 0 to 10, the scores are bimodal, Team Cuteness, `k` and its curve, today's surge unchanged at `k = 0`, the cute surge's rate and strength, the stat boost past Lv 100, EXP at surged Levels, the heading, casual only, and the scores never reaching `public/` or an API.
- `tests/cutenessBalance.test.js`: the measurements below.
- `tests/megaBattleRegression.test.js`: its 3,000 recorded casual battles (from before Megas) still have to match exactly, except the 515 with a cute Team, which the cute surge changes by design. A cute Team's ordinary surge stays today's surge object for object, so only battles where the cute roll fires actually change. The heading works out a Team's Cuteness from its members instead of reading a flag on the surge.

## Measured

Command: `node tests/cutenessBalance.test.js`, run 2026-11-11 with `CUTE = { threshold: 5, chance: 0.42, curve: 0.55, margin: 1.5 }` and the scores after the owner's edits. Each row is 2,000 casual battles through `runBattle`, a fresh cute Team as the Challenger against six random mythic-tier species. The rows share seeds, so the cute surge fires on nearly the same battles in every row.

| Cute Team | Mythics | Cute surge fires | Wins once it fires | Wins overall |
|---|---|---|---|---|
| Six scored 10, Lv 10 | Lv 10 | 42% | 100% | 42% |
| Six scored 10, Lv 50 | Lv 50 | 42% | 100% | 42% |
| Six scored 10, Lv 90 | Lv 90 | 42% | 99% | 41% |
| Six of the cutest (scored 9 or 10), Lv 10 | Lv 10 | 37% | 99% | 37% |
| Six of the cutest, Lv 30 | Lv 30 | 37% | 100% | 37% |
| Six of the cutest, Lv 50 | Lv 50 | 37% | 100% | 37% |
| Six of the cutest, Lv 70 | Lv 70 | 37% | 100% | 37% |
| Six of the cutest, Lv 90 | Lv 90 | 37% | 100% | 37% |
| Six of the cutest, Lv 20 | Lv 90 | 37% | 98% | 36% |
| One of the cutest, Lv 30 | Lv 30 | 37% | 93% | 44% |
| Six typical cute ones (scored 6 or 7), Lv 50 | Lv 50 | 20% | 100% | 20% |

- Both of the owner's targets hold: a Team averaging 10 wins 42%, at every Level, and a typical cute Team wins 20%. A typical Team averages about 6.3, and its expected cute surge chance is 20.2%.
- The cutest Teams (scored 9 or 10, about 9.25 on average) win 37%, across a 70-Level gap too. A Team of one wins more, 44%, because today's surge already lets a lone Pokémon win at big gaps. That was true before Cuteness.
- At 300 battles a row, the same rows read 2 to 3 points low (39% and 18%), which is sampling noise. That's why each row runs 2,000.
- 6% of random catchable Teams (Gens 1–5, no legendaries or mythics) average over 5. As Underdogs, their average cute surge chance is 0.8%, up from 0.2% on the straight line, because the curve gives Teams just over 5 more. `tests/battleBalance.test.js` still measures today's surge alone and keeps its targets.
- After a cute surge, six Lv 20s that beat six Lv 90 mythics earn 4,672 EXP each, 3 Levels. At their real Levels the same win would pay about 16,000 EXP each, 8 Levels (`koExp` in `utils/battle/rewards.js`).
- The scores, after the owner's edits on 2026-11-11: 637 species score 0 to 2, 67 score 3 to 5, 250 score 6 or 7, 61 score 8 or 9, and 10 score 10. The average is 2.97. `tests/cuteness.test.js` checks the shape. The numbers above were measured on these scores.
