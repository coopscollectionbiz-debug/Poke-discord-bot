# Held Items: Balance Validation on the Implemented Engine

These results come from the **real** battle code on branch `feature/held-items`: `simulateBattle` → `effects.js` + `items.js`. The audit's prototype was not used. Script: `analysis/held-items/runImplemented.mjs <snapshotDir> 2000 <masterCheckout>`. It reads the 2026-11-10 production copy in memory and writes aggregates only (`analysis/held-items/out/implemented.*`). Seed 20261111, 2,000 battles per row unless stated. Intervals are 95% Wilson. Two complete runs produced identical numbers for every section they share, so the results are reproducible.

The "optimized" loadout is a greedy 6-item pick from all 33 under the Item Clause. The "starter" loadout picks 6 of the 7 combat starters (Lucky Egg has no combat effect). Neither is the true optimum.

## Gates

| Gate (from the audit roadmap) | Result | Pass? |
|---|---|---|
| No-item battles identical to master's engine | **0 differences in 3,000 battles** (full result objects compared, casual + ranked) | ✅ |
| Seeded replays with items reproduce exactly | **500/500 identical** (result + log) | ✅ |
| No single holder above 68% | max **66.3%** (Leftovers) | ✅ |
| Optimized loadout mirror at or below 80% | **78.6%** | ✅ |
| Turn cap at or below 1% | max **0.3%** | ✅ |
| Lower tier never worse with both sides itemized | 4 of 5 pairings improve or hold. Uncommon vs Rare goes 30.9% → 28.9% (−2.0 points, the size of the ±2.0 sampling interval). | ⚠ within noise |

## 1. One holder (slot 1), ranked mirrors at Lv 50

| Item | Holder wins | Audit prototype |
|---|---|---|
| Leftovers | 66.3% | 64.8% |
| Sitrus Berry | 64.1% | 62.1% |
| Bright Powder | **58.7%** | not simulated |
| Shell Bell | 56.2% | 55.0% |
| Silk Scarf | 55.7% | — |
| Muscle Band | 53.6% | 52.9% |
| Focus Band | 53.5% | not simulated |
| Quick Claw | 53.2% | 51.4% |
| Eviolite (team average; unevolved holders only) | 53.1% | 52.9% |
| Wise Glasses | 52.9% | — |
| Expert Belt | 52.8% | 52.0% |
| Other 16 type boosters | 47.3–52.9% | — |
| Focus Sash | 49.7% | 51.3% |
| **Black Sludge** (on a random holder) | **35.2%** | — |

- **Match with the audit:** every item the prototype also simulated lands within about 2 points of its audit value. There are no major deviations.
- **Bright Powder** is the strongest RNG item: misses per battle rise from 1.09 to 1.61 (§3). It sits in the Sitrus/Shell Bell band, below the 68% gate, so it was left at its authentic ×0.9.
- **Black Sludge** is a trap for anything that isn't Poison-type, as in the games (it does 1/8 damage per turn). The Teams picker now warns "Hurts X every turn: only Poison types are healed". On a Poison type it behaves like Leftovers.
- **Type boosters** are near 50% because the random slot-1 holder's best move often isn't the boosted type. In practice players pick the STAB booster.

## 2. Full loadouts

| Comparison | Itemized side wins | Mean turns | Turn cap |
|---|---|---|---|
| Starter loadout vs no items | 76.2% | 29.1 | 0.0% |
| Optimized loadout vs no items | 78.6% | 29.5 | 0.0% |
| Optimized vs starter loadout (same team) | 54.4% | — | — |

The free starter set gives almost the whole benefit. The shop adds about +4 points: shop items are side-grades, which supports the economy model.

## 3. RNG-heavy items: activation and effect

| Configuration (side A) | A wins | Focus Band saves per battle | Quick Claw activations per battle | Misses per battle (no-item control) |
|---|---|---|---|---|
| Bright Powder on slot 1 | 54.6% | — | — | 1.61 (1.09) |
| Focus Band on slot 1 | 51.1% | 0.102 | — | 1.08 (1.02) |
| Quick Claw on slot 1 | 51.7% | — | 2.76 | 1.08 (0.98) |
| All three (slots 1–3) | 60.2% | 0.098 | 2.12 | 1.77 (1.06) |

- **Focus Band** saves its holder about once per 10 battles, and its outcome effect is small (+1 point).
- **Quick Claw** fires about 2.8 times per battle (20% of the holder's turns), worth about 2 points.
- All three together cost no more than one Leftovers.

## 4. Tiers and Power gaps

**Lower tier's win rate at Lv 50:**

| Matchup | None | Both optimized | Both starter | Only lower | Only higher |
|---|---|---|---|---|---|
| Common vs Uncommon | 4.9% | 5.3% | 5.7% | 10.8% | 1.9% |
| Uncommon vs Rare | 30.9% | 28.9% | 30.1% | 43.7% | 17.8% |
| Rare vs Epic | 27.2% | 28.8% | 29.3% | 39.8% | 16.1% |
| Epic vs Legendary | 7.3% | 10.4% | 9.5% | 15.2% | 4.8% |
| Rare vs Legendary | 1.9% | 3.4% | 2.5% | 5.2% | 1.2% |

Items don't amplify species dominance. When both sides have items, the gap stays the same or narrows slightly. **Because the eight strongest items are free for everyone, the "only the higher tier has items" case can't come from wealth.**

**Underdog win rate by Power ratio:**

| Ratio | Ranked: none / both / only favourite / only underdog | Casual (surge on): none / both / only favourite / only underdog |
|---|---|---|
| 1–1.1× | 25.7 / 27.5 / 17.0 / 42.4 | 37.6 / 49.8 / 16.6 / 65.7 |
| 1.1–1.25× | 4.5 / 5.8 / 1.9 / 10.6 | 28.3 / 28.8 / 22.0 / 34.6 |
| 1.25–1.5× | 0.0 / 0.2 / 0.1 / 0.6 | 17.7 / 20.0 / 14.3 / 23.4 |
| 1.5–2× | 0 / 0 / 0 / 0 | 8.8 / 10.1 / 8.4 / 12.8 |
| 2–3× | — | 9.4 / 11.5 / 10.4 / 13.7 |
| 3×+ | — | 3.2 / 3.1 / 1.6 / 3.0 |

Items decide close matches and slightly help underdogs when both sides use them. They never rescue a large Power gap. Team Power and the surge exclude items (verified: `teamPower` is unchanged by items).

## 5. Megas, abilities, species items, stalling

- **Mega + abilities:** 48 verified Mega profiles were each tested in slot 1. As `buildTeam` enforces, the Mega holds **no regular item**. With its team-mates itemized, the itemized side wins 65.6%, against a 52.5% no-item control. Ability and item hooks combine without errors, and the turn cap stays at 0%.
- **Species items, 1v1 at Lv 50** against random fully evolved Rare/Epic Pokémon:
  - Light Ball Pikachu: 10.0% → 29.0% wins.
  - Thick Club Marowak: 38.0% → 68.8%.

  This matches their mainline role of making weak species usable. Watch Marowak's pick rate after launch.
- **Stalling:**

  | Configuration | Mean turns | Turn cap |
  |---|---|---|
  | No items | 18.2 | 0% |
  | Optimized | 20.6 | 0.3% |
  | Worst case: six walls on Leftovers, Sitrus, Shell Bell, Bright Powder, Focus Band and Eviolite | 38.2 | 0% |

  No loops. Heals clamp at max HP and never revive, and no item triggers another item.

## 6. Lucky Egg (progression only)

Slot-1 battle EXP per casual battle (production pairs) goes from **133.4 to 199.9** with the egg, ×1.499 after floor rounding. Lucky Egg has no combat hook, so it doesn't route a battle to the effect engine and doesn't change any result. The tests check the cap at Level 100 and confirm that team-mates are unaffected.

## 7. What was not changed

No authentic effect was rebalanced. Bright Powder (×0.9), Focus Band (10%), Quick Claw (20%), Leftovers (1/16), Sitrus (1/4 at 50%), Focus Sash, Expert Belt (×1.2) and Eviolite (×1.5) all use mainline numbers. No tier bonus, Pokémon stat, damage formula, Power formula or surge rule changed.
