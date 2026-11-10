# Mega Evolution: Mega Stone economy (proposal; nothing activated)

Every rate, cap and reward in this document is a **placeholder for approval**. No reward table, price or odds constant was changed. Production player data was not read: activity profiles are modelled, not measured.

## 1. Existing reward economy (audited)

| Source | Cadence / cap | Today's rewards | Code |
|---|---|---|---|
| `/daily` | 1 per day | 1,000 CC, 100 TP, 2 Pokémon, 25% chance of 1 Evolution Stone | `commands/daily.js` |
| `/quest` | **60 s cooldown, no daily cap** | 70% a Pokémon (uniform pick) / 30% a trainer, plus 50 CC | `commands/quest.js` |
| `/recruit` | 30 s cooldown | Pokémon | `commands/recruit.js` |
| Battles | 10 per day, 3 per opponent | EXP, Elo, W/L; wager pot | `utils/battle/tuning.js` |
| Achievements | once each | CC, items (`shiny_dust`), badges and titles; new rewards wait in `pending_approval` (D-07, `config/achievementRewards.js`) | `progression/achievements.js` |
| Shop | CC | Evolution Stone 5,000 CC, balls | dashboard, `/shop` |
| Weekly pack | 1 per ISO week | 6 Pokémon by tier | `services/gameplay.js` |

Consequence: **any per-quest drop must have a daily cap.** At a 60 s cooldown a determined player can run hundreds of quests per day.

## 2. Principles

1. Never in the standard shop, never from wild encounters, never purchasable with real money (there is none), never from `/recruit`.
2. Random drops give only **regular** stones (82). The **10 Legendary/Mythical stones** (Mewtwonite X/Y, Latiasite, Latiosite, Heatranite, Zygardite = Legendary; Diancite, Darkranite, Magearnite, Zeraorite = Mythical) come only from top-tier achievements and announced events.
3. **Targeted pool:** a random drop picks uniformly among regular stones for **lines the player owns that lack that unlock**. When that pool is empty, it picks from all regular stones (a duplicate is still useful for the shiny line, or as shards). Without this, any one specific stone takes years (§4).
4. **Pity through shards:** every random drop also gives 2 Mega Shards; a duplicate stone can be exchanged for 5. 25 shards buy **any regular stone** (not Legendary/Mythical).
5. A global cap of **2 random stones per ISO week** across all sources, so grinding can't outrun casual play by much.
6. Every table is configuration (`config/megaRewards.js`), loaded and validated at boot. All rates default to 0 while `MEGA_EVOLUTION_ENABLED` is off.

## 3. Proposed acquisition channels

| Channel | Proposal | Stones |
|---|---|---|
| Rare quest reward | Per-quest chance *p_q*; **at most 1 stone per UTC day** from quests | regular, targeted |
| `/daily` bonus | Chance *p_d* per claim | regular, targeted |
| Battle wins | Chance *p_w* per win (only against a different trainer, within existing caps) | regular, targeted |
| Achievement milestones | Fixed grants (see `MEGA-ACHIEVEMENTS.md`) | "Mega Stone Voucher" = choose any regular stone; the top tier gives a Legendary/Mythical voucher |
| Seasonal / limited events | Admin-scheduled event table (start/end, featured stones, per-player cap) | featured stones, including at most 1 Legendary/Mythical per event |
| Weekly pack | Not proposed (keeps the pack's Pokémon focus) | — |

## 4. Acquisition-time scenarios

Activity profiles (assumed): **casual** = daily + 5 quests + 2 wins per day; **active** = daily + 30 quests + 6 wins; **grinder** = daily + 300 quests + 10 wins. The weekly cap of 2 applies.

| Scenario | *p_q* / *p_d* / *p_w* | Profile | Stones / week | First stone | Specific stone, uniform over 82 | Specific stone, targeted pool of 10 | Guaranteed choice via shards |
|---|---|---|---:|---:|---:|---:|---:|
| Low | 0.2% / 2% / 0.5% | casual | 0.28 | 25 d | 5.6 yr | 250 d | 313 d |
| | | active | 0.76 | 9 d | 2.1 yr | 93 d | 116 d |
| | | grinder | 2.00 (cap) | 4 d | 287 d | 35 d | 44 d |
| **Medium (recommended start)** | 0.5% / 3% / 1% | casual | 0.52 | 13 d | 3.0 yr | 134 d | 167 d |
| | | active | 1.60 | 4 d | 359 d | 44 d | 55 d |
| | | grinder | 2.00 (cap) | 4 d | 287 d | 35 d | 44 d |
| High | 1% / 5% / 2% | casual | 0.97 | 7 d | 1.6 yr | 72 d | 90 d |
| | | active | 2.00 (cap) | 4 d | 287 d | 35 d | 44 d |
| | | grinder | 2.00 (cap) | 4 d | 287 d | 35 d | 44 d |

The figures are expected values (geometric waiting times; the shard column = 12.5 drops at 2 shards each). With a targeted pool of 30 owned-but-locked lines the "specific stone" times triple, so the shard path then dominates.

**Set completion:** the 82 regular stones by random drops alone take 3.9 years at the weekly cap (coupon collector). Shards, vouchers and events are what make completion realistic. That's intentional: a Mega collection is a long-term goal.

Without milestone vouchers or events, a Legendary/Mythical stone is never obtainable. This is intentional (principle 2).

## 5. Abuse and fairness

- **Alt accounts:** battle-win drops count only wins against an opponent who has at least one battle of their own that day and isn't the same opponent more than 3 times (existing caps). Proposed: no battle drops in Phase 1.
- **Not pay-to-win:** no CC or real-money path to stones. Shards come only from drops and duplicates.
- **PvP impact:** Megas raise BST by 100 (most). The Power rating and underdog surge include Mega stats, so an underdog's surge chance accounts for the Mega (`MEGA-BATTLE-DESIGN.md` §5). Elo is unchanged.
- **Logging:** every stone grant writes an event-log entry (`source`, `stone`, `rate table version`), so drop rates can be audited after launch.

## 6. Decisions needed

- D-13: scenario (Low / Medium / High) and the weekly cap.
- D-12: shards (yes/no; 2 per drop, 5 per duplicate, 25 per stone).
- D-14: whether battle wins drop stones at all.
- D-15: the first event's featured stones, and the Legendary/Mythical voucher milestone.
