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
- **Underdog surge**: rare, announced, gap-scaled whole-team boost for the Underdog. Mechanism (Task 7): the surge raises the Underdog's Levels until the Power rating gap is 1.3×; chance = min(20%, 15% × (ratio − 1)) above a 1.25× gap. A fixed stat boost measured only ~0.1% upsets at 5× gaps (most of a big gap is Level), so the boost scales with the gap.
- Plus modestly widened global variance (damage roll / crit).
- Target underdog win-rate curve: OPEN CHECK (set in spec, verified by Monte Carlo test).

## Levels & EXP
- Stored per species + Variant in a new sibling map (e.g. `training: { "6:normal": { level, exp } }`), not inside `pokemon[id]`. Count model untouched (~104 server refs / 22 files + 15 dashboard refs — grep; feat/bulk-donate +1313 lines on counts — `git diff --stat`).
- No record ⇒ Level = bottom of the Catch-level range for its Stage/Tier. No migration.
- Record survives count reaching 0.
- **Catch level**: range by Stage, with a high range for non-evolving legendary/mythic (27 legendaries + 20 mythics are stage 1 — node script over pokemonData.json). Wide, skewed low, rare high tail. Same roll from every source (chat, /daily, /recruit, /quest, shop balls, starter).
- No record ⇒ Level = Catch level. Record exists (any count, including 0) ⇒ duplicate ⇒ +½ of the next Level's EXP (see Numbers); count still +1.
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
- Turn order by Speed, random tiebreak. Turn cap → winner by remaining team HP%.
- Seeded RNG; seed logged for reproducibility.
- Sim runs and **applies and saves all results first**; display is a replay, so a failed replay never changes results. (A hard crash before the next Discord backup can still lose them, like any other action.)

## Battle rating (Elo)
- Moves for both players after every Open and Wager battle. Start 1000, K 32 (proposed defaults).
- W/L stored alongside. `/leaderboard`: top 10 + your position, only players with ≥1 battle. No roles, no seasons.

## Display
- "Watch it happen": rendered image of both Teams with HP bars, edited ~4 times at evenly spaced turns, 2–3 s apart (your call), then a result embed: winner, surge banner, EXP, level-ups, newly learned moves, rating changes. No full log.
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
- Sim models power, type, accuracy, STAB, crits, damage roll. No recoil, drain, multi-hit, priority, or fixed-damage moves (their base power ≤ 1 already filters fixed-damage and variable-power moves out).
- No schema-file registration; `training`/`battle`/`pendingWager` are created on first use (live load/save paths mutate users in place and keep unknown fields).
- Commit per task; spec and plan are committed.
