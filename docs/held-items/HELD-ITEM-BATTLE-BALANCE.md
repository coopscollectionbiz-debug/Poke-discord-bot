# Held Items: Battle Balance Audit

**Method.** `analysis/held-items/itemSim.mjs` is a copy of the live legacy battle loop (`utils/battle/sim.js`). It keeps the same stats, damage formula, crits, roll, accuracy, multi-hit, drain, recoil, AI, turn order, turn cap and seeded RNG, and adds **prototype** item hooks at the points the architecture proposes. Before any result was used, the copy was checked against the live engine with no items on both sides: **0 differences in 6,000 battles** (3,000 casual production pairs with surge, 3,000 ranked pairs). Item effects use exact mainline numbers (4096-based multipliers).

**Data.** Production rosters are taken from the read-only 2026-11-10 snapshot. 203 players have a Display team (casual, real Levels). **161 can field a full legal ranked team**: the best 6 distinct species at Lv 50, at most 1 mythic, which is what `rankedTeam()` in `run.mjs` builds. Synthetic teams are 6 random acquirable species of one tier at Lv 50.

**Scale.** About 270,000 battles at 2,000 battles per cell. Intervals are 95% Wilson. Seed 20261110. Reproduce with:

```
node analysis/held-items/run.mjs <snapshotDir> 2000
```

Only aggregates are written (`analysis/held-items/out/`).

**"Smart loadout"** is a reasonable player's greedy item pick:
- unevolved Pokémon get Eviolite, then Leftovers or Sitrus;
- bulky Pokémon get Leftovers, Sitrus or Rocky Helmet;
- fast attackers get a Choice Band or Specs, then Life Orb, Expert Belt or a STAB booster;
- slow attackers get a Choice Scarf.

It uses the **Item Clause** (all items different) unless the result says otherwise. It is deliberately not optimal, so the real effect of a skilled player's loadout is a little higher.

**Limits:**
- There is no status, switching or stat stages, because the live engine has none for ordinary Pokémon.
- Mega and ability interactions aren't simulated, because Megas are off in production.
- At the snapshot time nobody had a Battle team yet, so ranked teams are each player's best legal pick.

---

## 1. Headline findings

1. **A full loadout is worth about one Level.** At Lv 50 an itemized team beats its identical un-itemized copy **77.9%** of the time. The same un-itemized team at **Lv 52** beats the itemized one **68%** of the time (§7). Items matter, but they are much smaller than a species-quality gap.
2. **Items do not favour dominant Pokémon or players. They slightly compress gaps.** With both sides itemized, the weaker side's win rate rises in every cross-tier pairing tested: epic vs legendary 7.7% → 13.6%, rare vs epic 27.2% → 29.2% (§3). Item uplift is flat or falling as species tier rises (smart loadout: 76–81% for common–epic, 72% for legendary). Percent-based effects (Leftovers, Sitrus, Helmet) scale with the holder's own HP, and Eviolite only helps unevolved, mostly low-tier, Pokémon.
3. **Wealth can't buy a big edge**, under two conditions: the Item Clause (no clause: 87.4% mirror; with clause: 77.4%), and outlier items held back (point 4).
4. **Three mainline items behave differently here, because Coop battles are long, fully automatic and switch-free:**
   - **Rocky Helmet is an outlier.** On all six it wins 90.8%, the highest of any item. Even one holder wins 66.8%. The AI never avoids contact and never switches.
   - **Life Orb is a trap.** It *loses*: 28.8% on all six, 43.8% on one holder. The 10% HP cost per attack outweighs ×1.3 when a Pokémon attacks 3–4 times before fainting.
   - **Assault Vest has no drawback**, because Coop has no status moves. That makes it a free ×1.5 Sp. Def (73.9% on all six).
5. **No stall or loop problems.** The turn cap is hit in ≤ 0.5% of battles in every configuration. Mean battle length rises at most from 18.8 to 22.2 turns. The worst-case wall team on all Leftovers averages 26.5 turns.
6. **Casual play is barely affected.** Items move casual results only between near-equal teams (Power ratio below 1.1×). Above 1.25× the Level gaps dominate, and items change outcomes by ≤ 2 points (§4). High-rank versus low-rank casual results stay at 4–5% with or without items (§6).

---

## 2. Item value in ranked mirrors (Lv 50, the same team on both sides; side A holds the items)

| Configuration | Side A wins | 95% CI | Mean turns |
|---|---|---|---|
| none (control) | 49.1% | 46.9–51.3 | 30.7 |
| all 6: Rocky Helmet | **90.8%** | 89.5–92.0 | 22.6 |
| all 6: Sitrus Berry | 89.7% | 88.3–91.0 | 30.1 |
| all 6: Leftovers | 88.6% | 87.2–90.0 | 28.6 |
| all 6: Choice Band | 83.0% | 81.3–84.6 | 26.0 |
| all 6: Choice Scarf | 79.2% | 77.4–80.9 | 31.3 |
| all 6: Assault Vest | 73.9% | 71.9–75.7 | 30.6 |
| all 6: Choice Specs | 69.0% | 67.0–71.0 | 28.1 |
| all 6: Shell Bell | 68.0% | 65.9–70.0 | 30.3 |
| all 6: STAB type booster | 63.9% | 61.8–66.0 | 29.0 |
| all 6: Eviolite (team average; unevolved holders only) | 62.6% | 60.5–64.7 | 31.1 |
| all 6: Muscle Band | 62.2% | 60.1–64.3 | 29.7 |
| all 6: Scope Lens | 61.1% | 58.9–63.2 | 30.1 |
| all 6: Quick Claw | 60.8% | 58.6–62.9 | 30.8 |
| all 6: Expert Belt | 57.6% | 55.4–59.7 | 30.3 |
| all 6: Wise Glasses | 57.2% | 55.0–59.4 | 30.8 |
| all 6: Focus Sash | 51.2% | 49.0–53.4 | 30.7 |
| all 6: Life Orb | **28.8%** | 26.9–30.8 | 21.0 |
| **smart loadout, Item Clause** | **77.4%** | 75.5–79.2 | 27.0 |
| smart loadout, no clause | 87.4% | 85.8–88.7 | 27.8 |

**One holder** (the item on the lead only, which is realistic under the Item Clause):

| Item | Side A wins |
|---|---|
| Rocky Helmet | 66.8% |
| Leftovers | 64.8% |
| Sitrus Berry | 62.1% |
| Choice Band | 61.7% |
| Choice Scarf | 60.2% |
| Choice Specs | 57.6% |
| Assault Vest | 57.0% |
| Shell Bell | 55.0% |
| Eviolite / Muscle Band | 52.9% |
| Expert Belt | 52.0% |
| Quick Claw | 51.4% |
| Focus Sash | 51.3% |
| Scope Lens | 51.1% |
| Life Orb | 43.8% |

**Why Focus Sash is weak at Lv 50.** At equal Levels with IV 15 and no EVs, one-hit KOs from full HP are rare, so the Sash seldom triggers (0.09 activations per battle). In **casual** play, Level gaps create one-hit KOs, and there the Sash is an underdog tool.

---

## 3. Do items help strong or weak species more?

**Uplift by tier** (mirror at Lv 50, 6 random species of one tier, side A holds the items):

| Tier | Life Orb | Leftovers | Focus Sash | Eviolite (unevolved share) | Smart |
|---|---|---|---|---|---|
| Common | 52.6% | 66.5% | 61.3% | **92.0%** (96%) | 76.3% |
| Uncommon | 50.9% | 72.2% | 56.3% | 74.7% (48%) | 81.1% |
| Rare | 50.7% | 74.0% | 60.4% | 65.0% (32%) | 76.3% |
| Epic | 45.6% | 76.3% | 60.2% | 58.4% (21%) | 77.2% |
| Legendary | 55.0% | 73.8% | 57.2% | 48.4% (0%) | 72.3% |

**Cross-tier at Lv 50** (the lower tier's win rate):

| Matchup | No items | Both itemized | Only the lower tier | Only the higher tier |
|---|---|---|---|---|
| Common vs Uncommon | 4.5% | 5.7% | 11.3% | 2.4% |
| Uncommon vs Rare | 29.1% | 32.5% | 47.2% | 18.4% |
| Rare vs Epic | 27.2% | 29.2% | 42.9% | 15.2% |
| Epic vs Legendary | 7.7% | **13.6%** | 17.6% | 4.8% |
| Common vs Epic | 0.4% | 0.9% | 1.4% | 0.1% |
| Rare vs Legendary | 2.5% | 4.2% | 4.9% | 1.4% |

Conclusion: **items mildly reduce species-tier dominance and never widen it.** Eviolite is the strongest equalizer, since it only works on unevolved Pokémon, which are mostly Common/Uncommon. It should launch, and it gives newcomers a real tool. No item turns a 2-tier gap into a fair match. Collection progress stays the main source of power, which is the intended reward.

---

## 4. Power-gap bins with production rosters

Underdog win rate. "Smart" loadouts with the Item Clause.

**Ranked** (production best legal teams at Lv 50, no surge):

| Power ratio | Pairs | No items | Both itemized | Only favourite | Only underdog |
|---|---|---|---|---|---|
| 1–1.1× | 2,000 | 26.0% | 28.7% | 18.4% | 40.6% |
| 1.1–1.25× | 2,000 | 3.9% | 6.3% | 2.6% | 8.6% |
| 1.25–1.5× | 2,000 | 0.1% | 0.4% | 0.1% | 0.5% |
| 1.5–2× | 428 | 0.0% | 0.0% | 0.0% | 0.0% |

**Casual** (production Display teams, real Levels, surge on):

| Power ratio | Pairs | No items | Both itemized | Only favourite | Only underdog |
|---|---|---|---|---|---|
| 1–1.1× | 2,000 | 38.8% | 47.5% | 18.6% | 69.6% |
| 1.1–1.25× | 323 | 28.5% | 26.3% | 26.9% | 27.2% |
| 1.25–1.5× | 363 | 18.5% | 19.8% | 19.0% | 20.7% |
| 1.5–2× | 601 | 9.5% | 9.7% | 7.8% | 10.5% |
| 2–3× | 946 | 11.6% | 10.9% | 8.7% | 10.9% |
| 3×+ | 2,000 | 2.9% | 2.6% | 2.5% | 2.7% |

Ranked at Lv 50 is extremely sensitive to species quality: a 1.25× Power gap is already decisive, and that is a property of the current format, not of items. Items are a skill and loadout layer that decides **close** matches. Itemizing when the opponent doesn't is worth about +15 points in the closest bin. When both sides itemize, the underdog gains slightly.

---

## 5. Stalling and loops

Random ranked production pairs, both sides with the same configuration:

| Configuration | Mean turns | Turn cap | Per-battle activity |
|---|---|---|---|
| No items | 18.8 | 0.1% | — |
| All Leftovers | 21.3 | 0.2% | 290 HP healed |
| Leftovers / Sitrus alternating | 21.7 | 0.2% | 3.9 berries, 135 HP |
| Smart (clause) | 19.5 | 0.3% | 0.09 Sash, 0.31 berries |
| Smart (no clause) | 22.2 | 0.5% | — |
| All Shell Bell | 18.7 | 0.0% | — |
| Worst case: Chansey, Blissey and Shuckle walls, all Leftovers | 26.5 | 0.0% | — |

No configuration produced unbounded healing. Structural guarantees (architecture §5.5): heals clamp to max HP and never revive, item damage never triggers on-hit items, once-per-battle flags, and the 300-turn cap.

---

## 6. Trainer rank, wealth and PvP vs PvE

- **Trainer tier/rank** has no battle effect (verified), so items can't compound a rank bonus. Casual high rank (Veteran+) vs low rank (≤ Skilled): the low rank wins 3.9% with no items, 4.4% with both itemized, 4.2% when only the high rank is itemized, and 5.2% when only the low rank is. The gap comes from Levels and team size, not items.
- **Wealth.** Among active players, liquid CC doesn't predict team Power (ρ = −0.07, economy audit). With the Item Clause, the most a rich player can buy is one copy of each item per team. That is about one Level of advantage, and every player can reach it within weeks (economy doc).
- **PvP vs PvE.** The bot has **no PvE battles** (verified: every mode is player vs player). Items therefore need no separate PvE tuning. If PvE (gyms, NPCs) is added later, NPC loadouts should come from the same registry.
- **Speed and turn order.** Choice Scarf (60.2% for one holder) and Quick Claw (51.4%) are within the normal range. Turn order matters less here than in mainline, because battles are long.
- **Species interactions.** Thick Club (Marowak ×2 Attack) and Light Ball (Pikachu) weren't simulated individually. They raise two weak species to mid-tier and need a watch metric after launch, not a blocker.

---

## 7. Level equivalent of a full loadout

Side A has a smart loadout (clause) at Lv 50. Side B has the identical team with no items, at a higher Level:

| Side B Level | Itemized side A wins |
|---|---|
| Lv 50 | 77.9% |
| Lv 52 | 32.1% |
| Lv 53 | 18.8% |
| Lv 55 | 5.9% |
| Lv 57 | 2.3% |

So **a full loadout is worth about 1–1.5 Levels at Lv 50**, or roughly 3% Power. Ranked fixes everyone at Lv 50, so items are the main build choice there, but they don't overwhelm species choice.

---

## 8. Tuning candidates for outliers (not applied)

All six holding the item, ranked mirrors:

| Variant | Side A wins |
|---|---|
| Rocky Helmet 1/6 (mainline) | 90.9% |
| Rocky Helmet 1/8 | 88.3% |
| **Rocky Helmet 1/6, once per battle** | **74.8%** (in line with the Choice items) |
| Sitrus 1/4 (mainline) | 88.0% |
| Life Orb 1/10 per attack (mainline) | 29.0% |

---

## 9. Recommendations

No existing tier bonus, Pokémon stat or damage formula changes.

| # | Recommendation | Evidence |
|---|---|---|
| B1 | **Item Clause** on the Battle team (and, recommended, the Display team) | No clause 87.4% vs clause 77.4% |
| B2 | **Launch** Leftovers, Sitrus, Focus Sash, the Choice trio, Eviolite, Expert Belt, Muscle Band, Wise Glasses, Shell Bell, Quick Claw, Black Sludge, 18 type boosters, Light Ball and Thick Club | All within 51–65% for one holder. Eviolite helps weak species. |
| B3 | **Defer Rocky Helmet** until a Coop-specific rule is approved (recommended: "once per battle", 74.8%) | Outlier at 90.8% on all six and 66.8% for one holder |
| B4 | **Defer Life Orb.** Don't sell a trap at a premium. Revisit only with a format change, or as a documented "high-risk" item. | 28.8% on all six, 43.8% for one holder |
| B5 | **Defer Assault Vest** until status moves exist (its drawback is inert) | 73.9% with no cost |
| B6 | **A Mega ignores its item** (D-H5 A) | Prevents +100 BST from stacking with Choice items |
| B7 | **Keep the surge's Power rating item-free** (`teamPower` unchanged) | Items are worth about 3% Power, which is below the surge's 1.25× threshold |
| B8 | **Balance gates in CI** (roadmap): no single-holder item above 68%, the smart-clause mirror at or below 80%, turn cap at or below 1%, cross-tier "both itemized" never below "no items" for the lower tier | §2–§5 |
| B9 | **Telemetry after launch:** pick rate and win rate per item, weekly. Retune via the registry only. | — |
