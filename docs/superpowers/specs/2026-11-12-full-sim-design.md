# Full simulation and Battle plans: locked design (grill-with-docs synthesis)

Branch: `design/full-sim` (from origin/master c40d6fb7).
Glossary: `CONTEXT.md` (new: **Battle plan**, **Ability**; changed: **Moveset**).
Spike probes: `tools/spike-showdown/` (run from the repo root).

## Goal

Fights use the whole of Pokémon battling: status moves, abilities on every Pokémon, held items, stat stages, weather, hazards, screens and Trick Room. Fights stay automatic. A player steers them with one choice per fighting **Team**, its **Battle plan**, and keeps full control of moves.

## Engine

- Pokémon Showdown's engine, `@pkmn/sim` pinned to exactly **0.10.12**. It is MIT-licensed, was published 2026-10-28 (`npm view @pkmn/sim time`), and matches the `@pkmn/dex` / `@pkmn/data` 0.10.12 the repo already pins. It is a new runtime dependency. Format: `gen9customgame@@@!teampreview`, which applies no legality checks and skips team preview (`p1_sync.mjs`).
- It replaces `utils/battle/sim.js` and `effects.js` / `abilities.js` / `items.js` for every fight kind: Casual, Ranked, Wager, Challenges (the Elite Four run too) and Trainer encounters.
- It runs on a worker thread, like `utils/render/renderPool.js`. Under both players' locks: build the Teams, send them to the sim worker, await the result, then apply EXP, ratings and CC in today's single synchronous block. Inside the worker the `Battle` class runs synchronously with no streams, and a given seed always produces the same battle (`p1b_determinism.mjs`: the same hash in two processes over 100 battles).
- A `FULL_SIM_ENABLED` switch, read the way `TM_ENABLED` is. Off keeps today's engines; on moves every fight kind at once. The old engines are deleted one release after the new one is stable.
- Engine overrides. These are instance patches on the pinned version, and each gets a test so an upgrade can't break one silently:
  - Every stat ×N, HP included, through `statModify`: Challenge opponents ×1.1 and the cute surge. It matches our formula for all 1,025 species at Lv 5/37/50/100 except Shedinja's fixed 1 HP (`p2a2_statmult.mjs`).
  - Levels through `set.level`: Ranked fights at Lv 50, and the surge raises Levels.
  - Our randomness stays as it is today: damage roll 80–100%, crits 1 in 12, high-crit moves 1 in 8, crit damage ×2 (`randomizer`, `randomChance`, `getDamage`; `p2e_rng.mjs`). The integer roll 80..100 stands in for today's continuous one.
  - Slot order comes from each Pokémon's original slot, kept in its nickname. Showdown reorders `side.pokemon` on every switch (`p2f_switch.mjs`).
  - A Mega fights as the Showdown forme from turn 1, as it does today. All 97 Megas in `data/pokedex/megas.json` resolve, with stats, types and abilities identical to our `battleProfile` (`p2c_mega.mjs`). The fight never sends Showdown's own `mega`, Tera, Dynamax or Z choices.
  - Elite Four carry-over: HP and major status (poison, burn, paralysis, sleep, freeze) are set before `start()`, and fainted members are left out of the engine team (`p2b_hp.mjs`, `p2b2_faintedlead.mjs`). Carrying status over has not been probed yet (see Open checks). Stat boosts, PP and field effects reset between fights.
- Mechanics that come with the engine: real PP, so a stalled fight ends in Struggle; an **Ability** on every Pokémon; status; hazards, screens, weather, terrain, Trick Room and Tailwind; in-battle item removal (Knock Off, Trick, Bug Bite), which lasts for that fight only and never touches the **Bag**. Past species and moves work in custom game (`p3_data.mjs`: Butterfree used Pursuit, Return, Hidden Power and Frustration).
- **No clauses.** There is no Sleep, OHKO or Evasion clause. Custom game doesn't enforce any of them, so we add none.
- **Turn cap.** Our driver stops a fight at turn 300 (Showdown alone would tie at turn 1000). At the cap the side with more total HP left wins, and an exact tie goes to the Defender, as today. In a double KO the side whose Pokémon fainted last wins; Showdown agrees with `sim.js` here (`p2g_rules.mjs`).
- **Switching.** The AI never switches on purpose. After a faint or a switch-out move (U-turn, Volt Switch, Flip Turn, Eject Button), the healthy benched Pokémon with the lowest slot number comes in. Roar, Whirlwind, Dragon Tail and Red Card drag one in at random, Showdown's default.
- **Data.** Full-sim fights use Showdown's Gen 9 species and move data. A new generated file, `data/battle/full-sim-data.json`, holds the same numbers plus status moves and latest-game learnsets for every species, #1–649 included. `battleData.json` stays exactly as it is for the legacy engines, so turning the switch off changes nothing. The switch also picks which file the dashboard, `/inspectpokemon`, Movesets and Power rating read, so they always show the numbers the fight uses. TM compatibility moves to each species' latest game the same way, in a full-sim copy of `data/battle/tm-data.json`. Against today's data, 55 species in #1–649 differ in base stats (none in types; #650+ are unchanged) and 53 of 460 moves differ (`p3_data.mjs`).
- **KO credit.** A knockout counts for the opposing Pokémon on the field when the faint happens, which is the attacker for a direct hit. A Pokémon that knocks itself out (recoil, Explosion, Life Orb) credits the foe on the field, today's rule. EXP still goes by side, so this only affects the MVP.

## Battle plans

- Six plans. Every fighting Team starts on All-out attack.

  | Plan | What the AI does |
  |---|---|
  | All-out attack | Uses its strongest move each turn |
  | Set up & sweep | Boosts while the foe can't KO it soon, then attacks |
  | Status & stall | Paralyzes, burns, poisons or puts the foe to sleep, then protects, heals and outlasts it |
  | Hazards & screens | Sets Stealth Rock, Spikes, Reflect and Light Screen early, then attacks |
  | Weather | Sets whichever of rain, sun, sand or snow helps its Team most, then plays to it |
  | Speed control | Sets Trick Room if its Team is slow, Tailwind if it's fast |

- Cut, with the reason: Pivot (U-turn chains need real switching decisions and break slot order), Baton Pass, Perish trapping, and doubles-only support moves.
- The Casual team and the Ranked team each have their own plan. The Showcase team has none. A Team's plan comes with it into Challenges and Trainer encounters. A Wager uses the plans as they are when the fight runs, and changing a plan or Moveset never cancels a pending Wager, because Power rating doesn't count either.
- Players set plans only on the dashboard Teams page, in a plan row above the six slots on the Casual and Ranked tabs. The row is hidden while the switch is off, since plans do nothing then.
- Every plan can be picked at any time. Each one shows a readiness line built from the moves the Team actually brings. If no member brings a plan's key move, the plan plays as All-out attack, and the line says how to get the move (the Level it's learned at, or a TM when `TM_ENABLED` is on). Nothing is ever blocked, and the plan never switches itself back.
- Players stay in control of moves. In battle a Pokémon brings its picked **Moveset**, or else the last 4 attacks it learned (attacks only, as today), whatever the plan. The plan only suggests changes: the Moveset editor marks suggested moves "Suggested", and the player takes them one Pokémon at a time. No bulk apply.
- **Ability.** For each fight, the plan picks the best of the species' regular abilities (Weather picks Swift Swim for Kingdra). Hidden abilities are never used. A Mega always has its own ability. Nothing is stored.
- Only the owner sees a plan, on their Teams page and in their own **Fight records**. Battles, Discord replays and the other player's copy of a record never mention it. Moves still narrate normally ("Bronzong used Trick Room!").
- **Computer-run opponents.** Each Challenge opponent gets a fixed signature plan suited to their canon style, and Trainer encounters take their plan from their **Trainer class**. Their plan also picks their moves and abilities, since nobody is there to take suggestions. The plan for each opponent and class gets drafted for the owner to sign off before it ships.
- All player-facing copy (plan names, readiness lines, suggestions, narration) goes through `/unslop` before it ships.

## AI

- Three skill levels:
  - **Rookie.** Plan-weighted scoring with a large random slip, for low Trainer classes (Youngster, Lass, Bug Catcher…).
  - **Solid.** Plan-weighted scoring with a small slip, like today's `MOVE_RANDOM_CHANCE` 0.1. It plays every player Team, so player fights stay symmetric, plus Gym Leaders and most Trainer classes.
  - **Expert.** Solid with no random slip, plus one turn of lookahead (three rollouts per candidate, plan score added), for every Challenge opponent (the Gym Leaders, the Elite Four, Blue and Red), Ace Trainers and Dragon Tamers. Challenges make up for their Experts with a hidden stat boost on the full sim tuned per Challenge, so each gate Level matches today's, except the Elite Four's, which is Lv 70 rather than 73 (decided 2026-11-12; `FULL_SIM.challengeStatBoost`, `tools/challenge-gates.mjs`). Measured, never slipping is most of its edge (see Measured).
- **Scoring.** Each turn, every legal move gets a score from expected damage and KO chance, plus the plan's bonuses (for example, Speed control rewards Trick Room when the foe is faster and Trick Room isn't up; Set up & sweep rewards a boost when the foe can't KO within 2 turns). An illegal choice (Choice lock, Taunt, no PP) falls back to `choose('default')`. Damage comes from our own estimator over the live battle state (stats with boosts, types, ability and item modifiers), unless implementation shows that calling the engine's `getDamage` neither draws from the battle's random generator nor fires events. `@smogon/calc` is not used, since it would be a second new dependency.
- **Lookahead.** The top 3 candidates are each played for one turn on a cloned battle (`Battle.fromJSON(JSON.parse(JSON.stringify(b.toJSON())))`, with the clone's random generator re-seeded so it can't see the real rolls) against the foe's Solid reply, then scored on HP swing plus KOs (`p6_lookahead.mjs`, `p6a_clone.mjs`).
- **Trade-off.** In the spike, a lookahead chooser beat a highest-base-power chooser 58.0% to 42.0% over 1,000 battles with seats swapped, and highest-power vs itself was 253 to 247 (`node --expose-gc tools/spike-showdown/p6_lookahead.mjs 500`). Neither is the plan-weighted scorer, so Solid's cost and Expert vs Solid get re-measured once Solid exists.

## Moves and TMs

- Status moves arrive by level-up at the Copy's real Level, and as new status TMs in the existing shop, using the existing compatibility generator and price tiers, assigned by impact. The full list with tiers gets drafted for the owner to sign off. Like the damaging TMs, they sit behind `TM_ENABLED`.
- Moves taught by a TM belong to the Copy and stay with it.
- Nobody's moves change at cutover. Picked Moveset moves that the new learnsets no longer allow stay usable until the player edits that Moveset; after that the normal rules apply. The move picker marks them so they don't look like a bug.
- The same goes for Team members with no picked Moveset. When the switch first turns on, a one-time migration records each one's current moves (its last 4 attacks under today's learnsets) and its Level. From then on its default moves are those, with each attack the new learnset teaches above that Level learned on top the default way (newest in, oldest out). Since master's "new moves are learned, not equipped" rule (2026-11-12), a level-up from battle EXP or Feed pins the moves it fought with instead, so an attack joins this way only on Levels gained otherwise. The record belongs to the Pokémon, not a Team. A picked Moveset replaces it on that Team only, and clearing the pick brings it back, so editing one Team never changes the other's moves. Pokémon off every Team at cutover, and players who join after it, simply use the new learnsets.
- Coordinate with `feat/move-choice` (not merged, and based on master from before individual Copies). It stores a chosen Moveset as `{ moves, movesLevel }` and learns later moves on top with `learnMove` (newest in, oldest out), the same model as the cutover record above. Reuse its `learnMove` / `movesTaught` shape so the two merge cleanly. Both also change the move picker.

## Balance

- Power rating stays the sum of stats at Level, from Gen 9 base stats when the switch is on. Plans, moves, abilities and items stay out of it.
- Every existing balance target stays. The suites are re-run on the new engine and their constants re-tuned: `battleBalance`, `cutenessBalance`, `challengeBalance`, `encounterBalance`, `gen69Balance`, `heldItemBattle`, plus the Mega regression suites.
- The current Season keeps running. Ratings carry across the switch, and switching back doesn't touch them either.
- **Held items.** The 33 held items stay. Their effects match Showdown's (parity audit, `parity-probe.mjs`). Lucky Egg is EXP-only and has no Showdown counterpart, so the engine sees no item. The deferred items (Choice Band, Choice Specs, Choice Scarf, Life Orb, Rocky Helmet, Assault Vest) stay deferred.
- **Mega abilities.** Showdown behaves differently from ours for six (Sheer Force, Berserk, Intimidate's exemptions, Trace, Protean, Speed Boost), and Showdown's behavior becomes the rule. The 13 "no effect" abilities (Prankster, Magic Bounce, Regenerator…) start working. `docs/mega-evolution/MEGA-ABILITY-MANIFEST.md` gets updated to match.

## Fight records and replays

- New records get a v2 `result`: the full raw Showdown log, a normalized step list in our own event types (`move`, `hp` with no attacker, `switch`, `status`, `faint`, `note`), and the v1 summary fields (`winner`, `turns`, `endedBy`, `snapshots`, `knockouts`, a flat `log`), so stats pages work unchanged. Both replayers branch on the step list, and v1 records keep today's code path. Records live in `fight-records.ndjson` on the data volume, not in `trainerData` or the Discord backups (`utils/fightRecords.js`), so size affects disk and page load, not backups. If the raw log makes records too big, it is gzipped with Node's built-in `zlib`.
- **Discord replay.** About 20 evenly spaced updates (`PLAYBACK.maxUpdates`, today 12), with the correct active Pokémon on every frame and narration for the new events. Longer battles still skip turns under the "TURNS a–b" badge. The browser replay shows every step.

## Wiring rules

- Every caller of `runBattle`, `runChallenge` and `runEncounter` becomes async. The players' locks stay held across the await for the sim worker, and nothing writes a user object outside its lock.
- An Elite Four run stores each fight's result as it happens and stamps the run with the engine that started it, so a fight record never re-simulates earlier fights (`runFights` does today) and flipping the switch mid-run can't mix engines.
- A Battle's Fight record is stored once for both players, so the server removes the other side's Battle plan before it sends a record to the page.
- The new user fields (each Team's Battle plan, the cutover move records) get a save-and-load round-trip test with `utils/userSchema.js`. The plan is set through its own endpoint, validated under the user's lock, and never through the dashboard patch allowlist.
- Balance suites set their sample sizes before re-tuning. At roughly 11 ms per battle, today's 24,000-battle Underdog suite would take minutes.

## Implementation order

1. The engine adapter behind `simulateBattle`'s interface, with a test for every engine override.
2. The full-sim data file and its generator.
3. The sim worker, the switch, wiring for every fight kind, and v2 records.
4. The Solid AI, Battle plans and abilities, then Rookie and Expert.
5. Both replayers.
6. The Teams page plan row, readiness and suggestions. Under "suggest only" they are the only way a player's plan gets its moves, so they ship with plans.
7. Computer-opponent plans, and the status TMs as unsold `"defined"` entries until sign-off.
8. Balance re-tuning.
9. README, docs and the ADR.

## Manual test plan

Run with `FULL_SIM_ENABLED` on and `TM_ENABLED` on unless a step says otherwise.

1. With the switch off, run `/battle` against a friend. The replay, the moves, the Teams page (no plan row) and `/inspectpokemon` look exactly as they do on master.
2. Turn the switch on and restart. Open the dashboard Teams page, Casual tab. The plan row shows All-out attack. A Team member with no picked Moveset shows the same four moves it had before the restart.
3. Open the plan menu. All six plans are listed with a readiness line each. Pick Speed control on a Team where nobody knows Trick Room or Tailwind. The line says it plays as All-out attack and how to get Trick Room.
4. Open a Pokémon's Moveset editor. Moves the plan suggests are marked "Suggested". Take one. The Moveset saves, the readiness line turns ready, and no other Pokémon's moves changed.
5. Run `/battle` (Casual). The replay has about 20 updates, narrates status, hazard and weather events, and after a U-turn or a faint shows the right Pokémon in front. The private EXP message arrives after the replay.
6. Open Battle Records and replay that fight. Switches, status and hazard damage show step by step, and your plan is named. Log in as the opponent and open the same record. Your plan isn't shown anywhere.
7. Replay a Fight record from before the switch. It plays as it did on master.
8. Run a Ranked battle and confirm both Teams fight at Lv 50. Offer a Wager, change your plan before the Defender accepts, then accept. The Wager runs.
9. Run `/challenge` against Koga. His Pokémon use status moves. Start an Elite Four run, get a Pokémon poisoned by Lorelei and win. In Bruno's fight that Pokémon is still poisoned, and the Revive pick still works.
10. Trigger Trainer encounters. A Youngster sometimes makes odd move choices. An Ace Trainer doesn't.
11. Open the TM shop. No status TM is for sale until the list is signed off.
12. Open `/inspectpokemon` for a Pokémon whose base stats changed in Gen 9 (Pikachu). It shows the Gen 9 stats and the ability its Team's plan picks.
13. Turn the switch off and restart. Battles use the old engine, new Fight records still replay, the plan row is gone, and saved plans come back when the switch is turned on again.

## Measured

Every figure below comes from a command in this repo, run on the dev Mac (Node 22). The VPS is different hardware; see Open checks.

| What | Figure | Source |
|---|---|---|
| ms per 6v6 battle, both sides highest-base-power ("greedy") | p50 10.3–12.3, p99 36–172, max 444 across runs | `node --expose-gc tools/spike-showdown/p5_perf.mjs greedy 1000` (and `3000`) |
| Turns per battle, greedy | p50 17, p99 95–100, max 129 | same |
| ms per battle, random choices | p50 17.3, p99 61.9; turns p99 78, max 144; 0 ties | `p5_perf.mjs random 1000` |
| ms per battle, one side lookahead | p50 78.8–90.1, p99 460–463 | `p6_lookahead.mjs 500` |
| ms per battle, both sides lookahead | p50 147, p99 609 | same |
| ms per lookahead decision | 4.1–4.9 | same |
| Lookahead vs greedy wins (1,000 battles, seats swapped) | 58.0% vs 42.0% | same |
| Plan-weighted AI, 6v6, Solid vs Solid | p50 10.2 ms, p99 31.8 ms per battle | `node tools/bench-full-sim.mjs 300` |
| Expert side vs Solid | p50 148 ms, p99 283 ms per battle | same |
| Win share against Solid (600 battles, seats swapped) | Rookie 36.2% · Solid with no slip 53.7% · Expert 55.7% | same |
| v2 Fight record medians | casual 16.6 KB · ranked 18.6 · gym 8.3 · encounter 14.8 · wager 18.1 · Elite Four 50.1; 100 players at the cap ≤ 205.3 MB; lite list 426 KB | `FULL_SIM_ENABLED=1 node tools/measure-fight-record.js 100` |
| Memory (RSS) | 40 MB at start, ~188–195 after importing the engine, 285–291 after 1,000–3,000 battles | `p5_perf.mjs` |
| Species #1–649 whose base stats differ, Gen 5 vs Gen 9 | 55 (0 in types) | `p3_data.mjs` |
| Moves in `battleData.json` that differ | 53 of 460 | `p3_data.mjs` |
| Real Teams with each plan's pieces (99 Teams, old pre-Levels backup; level-up at any Level / any learn method) | All-out 99/99 · Set up 22/45 · Status 13/41 · Hazards 8/43 · Screens 18/77 · Weather 12/23 · Trick Room 0/9 · Tailwind 3/18 | `node tools/spike-showdown/plan-viability.mjs <backup.json>` |
| Species learning Trick Room by level-up / any method | 3 / 143 of 1,025 | same |

## Open checks (no figure until measured)

- **VPS timings.** Run `p5_perf.mjs` and `p6_lookahead.mjs` on the VPS. This sets how many sim workers run.
- **Plan fit under the final rules.** Measure it with level-up at or below the real Level plus the drafted status TMs, by extending `plan-viability.mjs` once the status TM list exists. The table above is an upper bound for level-up and a different rule for "any method".
- **Picked moves the new learnsets drop.** Count them with a `tools/` script over a production snapshot. It sizes the grandfathering.
- **Elite Four status carry-over.** Write a probe beside `p2b_hp.mjs`.
- **Discord replay at about 20 updates.** Measure render time and memory with 2 replays at once (`PLAYBACK.maxAtOnce`).
- **Balance re-tune results.** Re-run each suite listed under Balance.
- **Eviolite.** Showdown uses `species.nfe`, while we use `evolvesTo` in `pokemonData.json`. Add a test that the two agree.

## Not in scope

Voluntary switching, a Pivot plan, hidden abilities, battle clauses, Tera / Dynamax / Z-moves / Showdown's own Mega mechanic, the deferred held items, per-Pokémon roles, plans visible to other players, a Discord command for plans, and applying suggestions in bulk.

## Docs to update during implementation

README (Battles, Battle data, the test list, dependencies), `CONTEXT.md` (done on this branch), `docs/design/battle-records.md`, `docs/mega-evolution/MEGA-ABILITY-MANIFEST.md`, `docs/gen6-9/OUTSTANDING.md` (moves the old sim couldn't model), `RUNBOOK.md` (the `FULL_SIM_ENABLED` switch), and an ADR for replacing the engines (offered).
