# Battles — locked design (grill-with-docs synthesis)

Branch: `feat/battles` (from master 9da64b19).
Glossary: `CONTEXT.md`.

## Battle loop
- `/battle @user` = **Open battle**: runs immediately, no consent, no CC. Only the Challenger earns EXP.
- `/battle @user wager:N` = **Wager battle**: Defender must accept; both earn EXP; winner takes the pot.
- Fight = the existing **Team** (displayedPokemon, ≤6) in slot order, 6v6 singles, next mon on faint.
- Blocked: Defender with no Team; Challenger with no Team; self; bots.
- Any channel. Defender is @mentioned. No opt-out.
- **Battle cap**: 10 battles started per UTC day (same reset as /daily, `commands/daily.js:35-36`), max 3 per opponent per day (your call).
  - Open battle: counts for Challenger only.
  - Open battle past either cap (changed 2026-11-12): still runs, but earns no EXP and doesn't count toward the cap. Ranked and wager battles stay refused.
  - Wager battle: counts for **both** players, and toward the pair's 3/day in either direction. Defender at cap → Accept cancels the offer and refunds the Stake.
  - Declined/expired wagers count for nothing.

## Wagers
- Stake held from the Challenger on offer; one pending wager per Challenger; 15-minute window (your call).
- Accept/Decline buttons only work for the Defender; accept shows both Power ratings.
- No house cut, no maximum. Min stake 1 CC. **All-in**: Defender with less CC can accept for their whole balance; Challenger's excess refunded.
- Both Teams read at the moment of acceptance; if either is empty then, or the Challenger's Power rating is higher than the offer showed, cancel and refund the Stake.
- Pending stakes persisted on the user record; bot restart refunds all pending stakes and edits the offer to "expired".

## Fairness & randomness
- Levels and rarity count in full. Fairness comes from EXP scaling (Gen 5 formula pays little for beating lower-level foes), the Battle cap, Defender never losing anything in Open battles, and Elo giving little for beating weaker teams.
- **Underdog surge**: rare, announced, gap-scaled whole-team boost for the Underdog. Mechanism (Task 7): the surge raises the Underdog's Levels until the Power rating gap is 1.3×; chance = min(20%, 15% × (ratio − 1)) above a 1.25× gap. A fixed stat boost measured only ~0.1% upsets at 5× gaps (most of a big gap is Level), so the boost scales with the gap. Kept at 20% (decided 2026-11-10): a strong surge is fine in casual battles, and ranked and wager battles have none.
- Plus modestly widened global variance (damage roll / crit).
- Target underdog win-rate curve: OPEN CHECK (set in spec, verified by Monte Carlo test).

## Levels & EXP
- Stored per species + Variant in a new sibling map (e.g. `training: { "6:normal": { level, exp } }`), not inside `pokemon[id]`. Count model untouched (~104 server refs / 22 files + 15 dashboard refs — grep; feat/bulk-donate +1313 lines on counts — `git diff --stat`).
- No record ⇒ Level = bottom of the Catch-level range for its Stage/Tier. No migration.
- Record is deleted when the count reaches 0 (gift, donation, evolution, shiny craft), so the next catch rolls a Catch level again. (Changed after the first live tests; the record used to survive.)
- **Catch level**: range by Stage, with a high range for non-evolving legendary/mythic (27 legendaries + 20 mythics are stage 1 — node script over pokemonData.json). Wide, skewed low, rare high tail. Same roll from every source (chat, /daily, /recruit, /quest, shop balls, starter).
- No record ⇒ Level = Catch level. Record exists ⇒ duplicate ⇒ +½ of the next Level's EXP (see Numbers); count still +1.
- Gifts and admin grants: count only, never EXP, never a roll.
- Stone evolution: target Level = max(target Level-or-floor, base Level); base keeps its Level. No auto-evolve. **Floor applies** (user's call): a Lv 2 Charmander → never-owned Charizard lands at the stage-3 floor. ⇒ Stage floors (esp. stage 3 + legendary) and stone prices are now the dominant leveling-balance knobs.
- Shiny craft (normal→shiny): shiny Level = max(shiny Level-or-floor, normal Level) — same rule as evolve.
- `training`, Battle rating, W/L, pending stake: server-authoritative; dashboard patch allowlist (`bot_final.js:1469`) must not grow to include them. No schema-file registration (see Simplifications); note the unused `sanitizeBeforeSave` → `stripDeprecatedFields` whitelist would wipe them if ever wired up.
- EXP from battles: Gen V formula per knockout, base stat total standing in for base EXP yield; whole Team shares (Exp. Share style); winner bonus. Curve: Medium Fast = L³ (Serebii exp page). Cap Lv 100.
  - Gen V formula (Serebii): `floor(floor(√A·A²)·B / floor(√C·C²)) + 1`, A = 2·L_foe + 10, C = L_foe + L_user + 10, B = baseExp·L_foe/5 (×1.5 trainer battle, ÷ participants).

## Sim
- Real Gen 5 data: base stats, types, 17-type chart (no Fairy), level-up learnsets (`5L`), move power/type/category/accuracy — from Pokémon Showdown (MIT) via `@pkmn/dex` + `@pkmn/data` **devDependencies** in a one-shot generator → committed `battleData.json`. No runtime dep.
- Moveset = last 4 damaging moves learned by Level (wild-Pokémon rule). Optional stored moveset override reserved for future move management.
- No abilities (except Shedinja's Wonder Guard)/items/status. Fixed stats (no IV/EV/nature). Shiny = no stat bonus. Full HP each battle.
- Move choice: highest expected damage vs current foe, small random chance otherwise.
- Fallback typed attack for mons with no damaging moves (Abra, Ditto, Wobbuffet, Unown, Magikarp <15).
- Turn order by move priority, then Speed, random tiebreak. Turn cap → winner by remaining team HP%.
- Seeded RNG; seed logged for reproducibility.
- Sim runs and **applies and saves all results first**; display is a replay, so a failed replay never changes results. (A hard crash before the next Discord backup can still lose them, like any other action.)

## Battle rating (Elo)
- Moves for both players after every Open and Wager battle. Start 1000, K 32 (proposed defaults).
- W/L stored alongside. `/leaderboard`: top 10 + your position, only players with ≥1 battle. No roles, no seasons.

## Display
- "Watch it happen" (revised after the first live test): an animated image of both Teams, edited once per turn about 2 s apart, up to 12 updates (longer battles spread evenly). Each player's displayed trainer stands at the left of their row, or an empty platform when they have none (added 2026-11-10 with `/challenge`'s replay). The fighting pair is spotlit, HP drains, and a game-style text box narrates each hit ("Luxray used Spark! It's super effective!"), from a per-turn log the sim records without changing any random draw. Then a final image (its text box cycles: the win and the MVP, the winner's Pokémon with the most knockouts, then level-ups and new moves) and a result embed with each player's rating change. Once the replay ends, each player who earned EXP gets an ephemeral message with each Pokémon's EXP gain. (Revised: the embed used to repeat the winner, MVP, surge, pot, level-ups, and new moves, which the image and the message header already show.)
- At most 2 replays render at once (`PLAYBACK.maxAtOnce`). A battle that has to wait posts its message right away (so the mentions notify), shows its place in line, and starts in order as replays finish. Results are already saved, so only the replay waits. (Added after measuring memory and lag with several battles at once.)
- Levels visible on: dashboard (collection cards, team picker — "Lv N", no EXP bar), /inspectpokemon (Level, stats, auto-moves), trainer card / /showteam canvas, /trainercard embed, battle frames.

## Open checks (no figure until measured)
- Average / p99 turns per battle — Task 7 Monte Carlo; sets the turn cap.
- Surge probability and boost size — tuned in Task 7 to the upset targets.
- `battleData.json` size — printed by the generator in Task 1.
- Save→load round trip preserves `training` / `battle` / `pendingWager` — test in Task 3.
- (Resolved in walkthrough: catch ranges, duplicate EXP, BST yield scale, randomness, upset targets. Moot: CC balances, since wagers have no cap.)

## Numbers and edge cases (locked in the post-plan walkthrough)
Targets are design goals the Monte Carlo test enforces, not measurements.
- **Leveling pace:** ~2 months from Lv 5 → 100 at 10 battles/day, 50% win rate → `BST_YIELD_SCALE = 0.035` (measured by the "Leveling pace" test in `tests/battleRewards.test.js` with the real EXP code: half wins, half losses, against equal-Level Teams of the species closest to the average base stat total; Lv 100 ≈ 56 days).
- **Battle EXP** depends on each knocked-out foe's Level vs the recipient's Level and the foe's BST (Gen V formula). E.g. a Lv 30 member gets 13 / 58 / 136 / 305 / 521 EXP per knockout of an average foe at Lv 10 / 20 / 30 / 45 / 60 (node one-liner at scale 0.035).
- **Duplicate catch:** +½ of the EXP the species+Variant needs for its next Level (0 at Lv 100). Replaces the catch-level-based rule (which gave ~12 EXP for a typical duplicate).
- **Catch ranges** (lean low; ~3% roll into the tail): Stage 1: 2–15 (tail 35) · Stage 2: 16–32 (tail 50) · Stage 3: 32–45 (tail 65) · Tier legendary/mythic at Stage 1: 40–55 (tail 75). Legendary range covers 47 species (node script over pokemonData.json; includes Phione). Evolution stones cost 5,000 CC each (`bot_final.js:2188`), which gates the evolve-floor jump.
- **Upset targets** (Underdog win rate by Power rating ratio): ≈1× → 35–65%; 2× → 3–10%; ≥5× → 0.3–3%, never 0.
- **Randomness:** damage roll 80–100% (Gen 5: 85–100%); crit 1/12, high-crit moves 1/8 (Gen 5: 1/16, 1/8). Task 7 may nudge these to hit the targets.
- **Shedinja:** 1 HP + Wonder Guard (only super-effective hits damage it) — the one ability in the sim.
- **Turn cap:** ≥ 3× the measured p99 battle length; at the cap, higher total HP% wins, exact tie → Defender.
- No Elo decay, no provisional period, flat K 32; no extra anti-alt rule (Elo self-limits; 3/opponent cap).

## Simplifications (ponytail pass)
- No EXP bar anywhere; dashboard shows "Lv N" only.
- Sim models power, type, accuracy, STAB, crits, damage roll. No fixed-damage moves (their base power ≤ 1 already filters fixed-damage and variable-power moves out).
- Added after the first live tests, following Pokémon Showdown's Gen 5 rules:
  - Move priority decides turn order before Speed does.
  - A 2 to 5 hit move hits 2 or 3 times 35% of the time each, and 4 or 5 times 15% each. Double Kick and the other fixed-count moves always hit twice, and Triple Kick kicks three times. Triple Kick's kicks have 10, 20, and 30 power, and each kick checks accuracy. Every hit rolls its own crit and damage, and the hits stop when the target faints.
  - Drain heals the user `round(dealt × 1/2)`.
  - Recoil costs the user `round(total dealt × fraction)`, at least 1 HP.
  - A Jump Kick or High Jump Kick that misses, or hits an immune target, costs the user `floor(max HP / 2)`.
  - Drain and recoil use the HP the target actually lost.
- A Pokémon that faints from its own recoil or crash is a knockout for the Pokémon it attacked, for EXP and MVP. If both sides run out in one move, the side whose Pokémon fainted last wins. That's the Gen 5 rule, and it means the recoil user's side wins.
- Still not modeled: Sucker Punch failing when the target already moved, Revenge and Avalanche doubling after being hit, Dragon Tail and Circle Throw forcing a switch, stat changes from moves like Close Combat and Overheat, and other side effects. Revenge and Avalanche still go last, at 60 power. Move choice counts the expected hits of multi-hit moves but ignores drain, recoil, and crash risk, and it applies Triple Kick's accuracy once rather than per kick.
- No schema-file registration; `training`/`battle`/`pendingWager` are created on first use (live load/save paths mutate users in place and keep unknown fields).
- Commit per task; spec and plan are committed.
