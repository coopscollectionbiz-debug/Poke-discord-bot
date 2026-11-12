# Held Items: Economy and Acquisition Analysis

**Data.** I used the latest production copy (2026-11-10 16:17 UTC, seq 2328, 2,884 records). It is the same snapshot used in the economy audit (`E:\Poke-discord-bot-econ-audit/docs/economy-audit/PLAYER-ECONOMY-STATISTICS.md`), which also covers the event log (23.3 h). The figures below are aggregates, either from that report or recomputed for this audit (inventory counts). No player is identified.

## 1. The economy today

| Measure | Value | Source |
|---|---|---|
| Records / collectors / active ≤30 d | 2,884 / 450 / **51** (a lower bound: there is no last-seen field) | economy audit §1 |
| Liquid CC, active ≤30 d | median **6,250**; p25 1,715; p75 16,950; p90 85,350; max ≈ 340k; Gini 0.77 | §2 |
| Liquid CC, all records | median 0 (2,464 hold 0) | §2 |
| Imputed collection value (donation payout) | active ≤30 d median 153,000, which is 5.3× liquid CC: a large **latent** money supply | §2 |
| Faucets (23.3 h log) | donations +468,000; `/daily` +31,000 (1,000 each); chat ≈ +1,000 | §2 |
| Sinks (23.3 h log) | Ultra Balls −480,000; Poké Balls −139,000; Great −10,000; Stones −20,000 | §2 |
| Net | **−150,000 CC** in 23.3 h; snapshot to snapshot −130,800 in 17.8 h: the money supply is **shrinking** | §2 |
| Shop prices | Poké 1,000 · Great 2,000 · Ultra 4,000 · Evolution Stone 5,000 · trainer sprites 2,500–150,000 | `bot_final.js`, catalog |
| Inventory | `evolution_stone` 918 across 103 holders (median 5, p90 22, max 52) · `shiny_dust` 1,578 across 59 · **no held items anywhere** | recomputed |
| Wealth vs. Power | among active players, CC does **not** predict best-team Power (ρ = −0.07). TP does (0.72). | §3 |
| Battle participation | 34 players have battled; 126 battles/day, all casual; 0 wagers | §4 |

What this means for items:
- The active population is small (≈ 50). Its wealth is concentrated but **spent**: rich players turn CC into Poké Ball rolls.
- Donations are the main source of CC, and anyone with a collection can liquidate it on demand. CC prices therefore gate **commitment**, not access.
- The supply is already shrinking. A new sink should be **one-time** (finite demand), not recurring, so it doesn't drain newcomers.

## 2. Demand model: why held items are a finite sink

With the Item Clause (one of each item per team) and per-line equipment, **a player can use at most 2 copies of any item**: one Display-team holder and one Battle-team holder, on different lines. A third copy can't be equipped to any effect. Recommendation: `maxStack: 2` for every held item, so nobody spends CC on copies they can't use.

| Player type | Items wanted | Typical spend at proposed prices |
|---|---|---|
| Casual (Display team only, budget) | 3–6 Basic/Standard | 10,000–25,000 |
| Ranked regular (one full Battle-team loadout) | 6 (2–4 Premium) | 30,000–42,000 |
| Completionist (both teams fully itemized, distinct) | 12 | 60,000–90,000 |
| Hard ceiling (every launch item ×2) | 33 × 2 | ≈ 250,000 |

At 51 active players, one ranked loadout each is about **1.5–2.1 M CC of one-time sink**, roughly equal to the active players' entire liquid CC (1.58 M). Demand then saturates, so the sink falls back to zero until new items release. That is good for inflation (no runaway sink) and bad for newcomers only if items are CC-only. Hence the free paths in §4.

## 3. Proposed prices (launch catalog)

Prices are pegged to existing anchors (the 2,500 common trainer, the 5,000 Evolution Stone, the 1,000 `/daily`) and ranked by measured strength (balance doc, one-holder win rates):

| Price tier | CC | `/daily` equivalent | Items | One-holder win rate |
|---|---|---|---|---|
| **Basic** | **2,500** | 2.5 days | 18 type boosters, Expert Belt, Muscle Band, Wise Glasses, Quick Claw | 51–53% |
| **Standard** | **5,000** | 5 days | Focus Sash, Eviolite, Shell Bell, Black Sludge, Light Ball, Thick Club | 51–55% (Eviolite much higher on low-tier teams) |
| **Premium** | **8,000** | 8 days | Leftovers, Sitrus Berry, Choice Band, Choice Specs, Choice Scarf | 58–65% |

Justification:
- **The active median player (6,250 CC) can buy any Basic or Standard item immediately, and a Premium item after about 2 dailies.** p25 players (1,715) need about 1–6 days. The full ranked loadout (≈ 40k) is around **p75 wealth**, about 5 weeks of `/daily` alone, or a single afternoon of donations for an established collector.
- **Premium is priced below an Ultra Ball pair (8,000)** and is one-time. Players compare items with what they already buy daily, and a permanent Leftovers for the cost of two Ultra rolls reads as fair.
- **Strength scales the price, but the spread is narrow (3.2×).** The goal is "everyone can field items soon", not a paywall. The Item Clause, not the price, prevents whales from stacking.
- **No resale, no trading of items, no CC refunds.** Items never become a CC faucet or a laundering path.

**Deferred items** get a price when they are approved: Life Orb, Rocky Helmet, Assault Vest, Scope Lens, resist berries and so on (catalog CSV).

## 4. Acquisition model (recommended)

| Source | What | Why | Farming guard |
|---|---|---|---|
| **Dashboard shop** (primary) | Every launch item at the prices above | Predictable access; the player chooses | `maxStack: 2` |
| **First Battle team saved** | 1 **Basic voucher** (pick any Basic item) | Everyone starts itemized for free | One-time flag in `purchases`/progression |
| **Achievements** (new rewards, need approval) | "First ranked win": Standard voucher. "10 ranked wins": Premium voucher. "Collect 50 species": Standard voucher. | Progression unlocks that don't depend on wealth | Achievements are one-time and already idempotent (Release C) |
| **Weekly pack** | 25% chance of a Basic item (or a voucher, if the item would exceed `maxStack`) | A light recurring trickle for engaged free players | Weekly cadence already exists |
| **Ranked season end** | Premium voucher for finishing a season with ≥ 20 ranked games | Rewards participation, not rating | Season counter already exists (`RANKED.season`) |
| **Events** | Admin grants through `/addinventory` (works once the items are active) | Owner-run promotions | Admin-only |
| **Per-battle drops** | **Not recommended** | Casual battles are unrated and need no consent, so drops would turn into farming | — |
| **Daily** | Not recommended | Keeps `/daily` simple | — |

A **voucher** is three new catalog items: `held_voucher_basic`, `held_voucher_standard` and `held_voucher_premium`. Each is consumed in the dashboard to get one item of its tier or lower, in a single `runInventoryTransaction` (consume the voucher, grant the item). If the chosen item is already at `maxStack`, the voucher is refused and the player picks another.

**Free-player path:** the starter Basic voucher, the first ranked win (Standard) and 10 ranked wins (Premium) add up to three useful items in about a week of ranked play, with zero CC. Together with about 5 dailies, a fresh player can field a reasonable 4–6 item loadout in **2–3 weeks** without donating anything.

## 5. Inflation and long-term health

- **No new faucet.** Items are never sold back for CC, so they can't create CC.
- **A finite sink.** Demand caps at about 2 copies per item, so items absorb surplus CC once and then stop. Recurring sinks (balls, stones) stay the backbone.
- **Watch metrics (weekly):** CC spent on held items, share of active players with at least one item equipped, median days from first dashboard visit to first equip, item pick rates, and the CC distribution of buyers. If the median newcomer takes more than 21 days to their first equip, lower the Basic price or raise the voucher frequency.
- **New items** later (Phase 2 catalog) restart demand in small, controllable waves.

## 6. Unverifiable or low-confidence points

- Activity cohorts are lower bounds (there is no last-seen field).
- CC flow rates come from 23 hours of logs (direction: medium confidence; long-run rate: low).
- Purchase behaviour for a product that doesn't exist yet is a model, not data.
- Pokémon Champions' VP prices are reported by fan sources and conflict for several items (catalog CSV). They were used only as a ranking hint, never converted to CC.
