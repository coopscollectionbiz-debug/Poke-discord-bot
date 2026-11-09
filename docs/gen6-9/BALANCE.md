# Gen 6–9 balance and economy

This document separates **what the implementation does** (§1) from **proposed balance changes that are NOT implemented** (§3) and need an owner decision. All numbers come from `BALANCE-DATA.md` (`npm run report:balance`).

## 1. What the implementation does (no tuning changed)

- **Tier odds per draw are unchanged:** common 52%, uncommon 34%, rare 8%, epic 4%, legendary 1.5%, mythic 0.5%. Ball and rank multipliers are unchanged too.
- **Within a tier, every released species is equally likely** (existing behaviour). New species join their tier's pool only when their generation is released.
- **Existing tiers are untouched.** New species get tiers from a written rule that restates the Gen 1–5 pattern (71% exact / 98% within one tier on Gen 1–5).
- **New tier mix (376 species):**
  - common 80, uncommon 40, rare 104, epic 90, legendary 45, mythic 17.
  - Gen 6–9 has proportionally fewer uncommons and more epics than Gen 1–5. Most of that comes from the 31 Ultra Beasts and Paradox Pokémon (all epic) and from Gen 9's many single-stage species.
- **Shiny odds** (`shinyOdds.js`) are unchanged per draw.
- **Prices are unchanged:** Evolution Stone and Shiny Dust costs, Poké Ball prices, weekly pack composition, starter pack.
- **Achievements:** new entries mirror the classic region and type entries. They pay AP only; rewards stay `pending_approval` (D-07), like every Release C reward.

## 2. Impact by release scenario

| Scenario | Species | Chance a draw is a Gen 6–9 species | Odds of any one specific Gen 1–5 species vs today (common / rare / legendary / mythic) |
|---|---:|---:|---|
| Gen 7 only | 737 | 8.5% | 92% / 88% / 79% / 75% |
| Gens 6–7 | 809 | 15.9% | 83% / 80% / 73% / 64% |
| Gens 6–8 | 905 | 23.1% | 75% / 68% / 60% / 60% |
| All | 1025 | 30.0% | 67% / 61% / 52% / 55% |

What this means:
- **Collection difficulty.** Finishing a classic region gets slower in proportion to the dilution. With everything released, a player missing one specific Gen 1–5 legendary needs about twice as many legendary draws to find it.
- **Legendary/Mythic availability.**
  - Pools grow from 48 → 93 legendaries and 21 → 38 mythics with everything released.
  - Total legendary/mythic draws per player don't change; they're spread over more species.
  - Classic legendary achievements are pinned to the Gen 1–5 set (48/21), so they get harder in practice. Legend Collector/Keeper (10/25 different) get easier, because any generation counts.
- **Daily rewards, shop, quests, recruit, weekly pack.** Same tier logic everywhere, so they all show the same dilution. Quest and recruit payouts are unchanged.
- **Shiny acquisition.** Shinies per draw are unchanged, but the odds of a shiny of a specific species fall in step with the table.
- **Trading/market.** There's no market yet (Release F). Gifting is unchanged: normal copies only. Rarer old species become relatively scarcer, which may raise their perceived value once trading exists.
- **Evolution economy.**
  - Gen 6–9 evolutions cost the same Stones per tier step as before.
  - 113 of them also require the official level. Catch levels already scale by stage (2–15 / 16–32 / 32–45), so most second stages are caught at or above their evolution level, but late evolutions (e.g. Dragapult Lv 60, Kommo-o Lv 45) need battle EXP.
  - This slows Stone spending slightly for new species only.

## 3. Proposals (NOT implemented; owner decision)

1. **Release one generation at a time.** The recommended order is Alola → Kalos → Galar → Paldea. Each step dilutes classic odds by 8–12%, instead of 33% at once.
2. **Optional "new region" weighting.** In the release window, give the new generation its proportional share instead of more. Today's rule already does this, so the recommendation is no change. A "featured generation" boost would further dilute classic species and is **not** recommended.
3. **Optional classic-species protection.** If classic completion is a priority, a future option is a per-tier 50/50 split between "classic" and "new" species (each pool stays uniform inside). This would keep classic odds at ≥ about 50–60% of today even with everything out, but make new species rarer per draw. Not implemented. It changes established gameplay and needs a design decision.
4. **Legendary pool.** Consider moving some Gen 7–9 sub-legendaries (the Tapus, Loyal Three, Treasures of Ruin) to `epic` if legendary dilution is too strong. Today the rule follows the games' legendary flag.
5. **Gen 9 visuals.** 95 of 120 species are static. Consider waiting for more animations (the audit can be re-run) before releasing Gen 9. This is a presentation matter, not economy.
6. **Achievement rewards.** If D-07 approves rewards later, the new region entries reuse the classic values (2,000 CC for Explorer; badge + title for Complete). Price-check them against the total CC supply at that point.
