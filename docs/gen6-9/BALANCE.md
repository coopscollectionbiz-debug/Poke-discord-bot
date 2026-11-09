# Gen 6–9 balance and economy

This document separates **what the implementation does** (§1) from **proposed balance changes that are NOT implemented** (§4) and need an owner decision.

All numbers are exact and come from `npm run report:balance` (→ `BALANCE-DATA.md`) and `npm run report:balance -- --gen7` (→ `GEN7-ENCOUNTER-COMPARISON.md`). `tests/gen69Balance.test.js` checks the model against the live selector by sampling.

> **Correction (qualification, 2026-11-09).** An earlier draft said tier odds per draw stay at 52/34/8/4/1.5/0.5%. That was wrong. The selector (`utils/weightedRandom.js`) gives *each species* its tier's weight, so a tier's share of draws is *species in the tier × weight ÷ total weight*. Tier shares therefore shift when species are added, and today's actual shares are 55.4 / 33.2 / 8.4 / 2.5 / 0.46 / 0.07% (Poké Ball, no rank).

## 1. What the implementation does (no tuning changed)

- No weight, multiplier, price or odds constant was changed:
  - tier weights, ball and rank multipliers
  - Stone, Dust and ball prices
  - weekly pack composition and starter pack
  - shiny odds
- New species join pools only when their generation is released. The selector then treats them exactly like existing species of the same tier.
- Existing tiers are untouched. New species get tiers from a written rule that restates the Gen 1–5 pattern (71% exact, 98% within one tier on Gen 1–5).
- New achievements pay AP only. Rewards stay `pending_approval` (D-07).

## 2. Gen 7 (first release): before → after

Full tables are in `GEN7-ENCOUNTER-COMPARISON.md`. Alola adds 88 species: 15 common, 10 uncommon, 23 rare, 20 epic, 13 legendary, 7 mythic.

| Measure (Poké Ball, no rank, unless stated) | Before | After |
|---|---:|---:|
| Common / Uncommon / Rare / Epic share | 55.38 / 33.16 / 8.42 / 2.51% | 55.39 / 32.41 / 8.80 / 2.78% |
| Legendary share | 0.462% | 0.538% (0.424% existing + 0.114% Alola) |
| Mythic share | 0.067% | 0.082% (0.062% existing + 0.020% Alola) |
| Ultra Ball, Legend rank: Legendary / Mythic | 5.62% / 0.92% | 6.13% / 1.05% |
| One specific existing species (any tier), e.g. Pikachu | 1 in 458 | 1 in 500 (**91.7%** of today) |
| Mewtwo / Mew / Arceus | 1 in 31,173 | 1 in 33,987 (91.7%) |
| Share of draws that are an Alola species | — | 8.3% (Poké Ball); 14.2% (Ultra Ball, Legend) |
| `/quest`: any one existing species (uniform pick) | — | 88.1% of today |
| Weekly/starter pack slot: common / uncommon / rare species | — | 91.7% / 93.8% / 87.7% of today |

Key facts:
- Under the weighted selector, **every existing species keeps the same relative odds**, at 91.7% of today's (91.2% at Master Trainer, 85.8% with an Ultra Ball at Legend). No tier is singled out.
- **Legendary and Mythical rates per draw go up slightly** (Alola is legendary-heavy). The chance of an *existing* legendary goes down: 0.462% → 0.424%.
- **Quests** pick uniformly from the whole pool. Today that already gives 7.4% Legendary and 3.2% Mythic per Pokémon quest. With Alola: 8.3% and 3.8%. That is existing behaviour, but more visible now; see §4.

## 3. Later generations (cumulative, weighted selector)

| Scenario | Any one existing species vs today | Share of draws from Gens 6–9 | Legendary / Mythic share |
|---|---:|---:|---|
| + Gen 7 | 91.7% | 8.3% | 0.54% / 0.08% |
| + Gens 6–7 | 84.1% | 15.9% | 0.53% / 0.09% |
| + Gens 6–8 | 76.7% | 23.3% | 0.59% / 0.09% |
| All | 69.7% | 30.3% | 0.62% / 0.08% |

Other effects:
- **Collection difficulty:** completing a classic region slows by the same ratio.
- **Classic achievements:** they stay pinned to the Gen 1–5 sets, so they get slightly harder in practice. "N different Legendaries" achievements get easier.
- **Shiny:** odds per acquisition are unchanged; a shiny of a specific species falls by the same ratio.
- **Trading:** none yet. Gifting is unchanged.
- **Evolution:** Stone prices are unchanged. 113 new evolutions also need the official level. Catch levels already scale by stage, so most mid-stages are caught at or above their evolution level, but late ones (Dragapult Lv 60, Kommo-o Lv 45) need battle EXP.

## 4. Proposals (NOT implemented; each needs before/after numbers and owner approval)

1. **Release one generation at a time**, starting with Alola: −8.3% per existing species, instead of −30% at once. *Process only; nothing to apply.*
2. **Quest legendary rate.** Quests ignore tiers, so 1 in 12 Pokémon quests gives a Legendary today, rising to 1 in 11 with Alola. If that's unintended, give quests the weighted selector. That would change established gameplay, so it's out of scope here.
3. **Classic-species protection** (only if classic completion speed matters more): a per-tier split between classic and new species. Not modelled or implemented. Would need its own before/after comparison.
4. **Sub-legendaries.** Moving the Tapus and similar to `epic` would lower Alola's legendary contribution, from 0.114% back towards 0.06% per draw. Not applied.
5. **Gen 9 visuals:** 95 of 120 species are static. Wait for more animations before releasing it.
6. **Rewards** (if D-07 is approved later): the new region entries reuse the classic values.
