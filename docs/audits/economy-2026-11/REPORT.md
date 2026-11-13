# Economy audit and Quests design, November 2026

Date: 2026-11-13. Branch `audit/economy-2026-11` off master `b198f60d` (Gens 1 to 6 live, `TM_ENABLED=1`, Mega and held item flags off).

This report changes no code, price or flag. It has two parts:

- **Part 1** audits everything a player can earn, buy, spend or get.
- **Part 2** designs Quests (the Daily board and Expeditions) and the Focus type option that replaces `/recruit`.

## How to read the numbers

Every number names its source. There are three kinds of source:

- **Code.** A `file:line` on this branch. That is the value of a constant and nothing more.
- **Model.** `model.json`, written by `POKEMON_GENERATIONS=6 node tools/economy-audit/model.mjs`. It uses the bot's own odds and EXP functions. It reads no player data.
- **Live.** `aggregates-reconciled.json` and `aggregates-7d.json`, written by `tools/economy-audit/aggregate.mjs` on the production server, 2026-11-13 14:00Z. They hold aggregates only, with no ids or names, and the top of each balance spread is rounded. `tools/economy-audit/README.md` has the exact commands.

The live window is 2026-11-10 22:17Z to 2026-11-13 13:53Z (63.6 h, from the snapshot file times). In that window 44 players were active in the last 7 days. "Per active player per day" means a window total divided by 44 x 2.65 days = 116.6 player-days. That is a derived figure, not a measurement.

## Decisions

Each line has a recommendation. Nothing here is built yet.

| # | Decision | Recommendation | Other options |
|---|---|---|---|
| D1 | What happens to the old `/quest` and `/recruit` commands | **Unregister both now.** Only Discord's default Administrator permission hides them, and a server admin can open them to any role. As written, `/recruit` pays 432 CC profit per use (F3). | Leave them hidden until Quests ship |
| D2 | Live event guard on Poké Ball discounts and the CC multiplier | **Cap a Poké Ball discount at 30%, and stop the CC multiplier from applying to donations.** At 43% off, Master Rank players profit from throw-and-donate (F2). | One check that refuses any event where a ball's price drops below its donation value; or no guard (no event has run yet) |
| D3 | Daily chat cap (R1 from 11-10) | **Declined by the owner (2026-11-13): no cap.** Chat activity is the main driver of the game. The 7 s cooldown stays the only limit, and the `chat_cc` log (D10) shows if a spammer appears. | Cap at 300 rewarded messages a day (the audit's first recommendation) |
| D4 | Wager guard (R3 from 11-10) | **Build an account age gate (7 days, 25 Pokédex entries) before Quests ship.** Wagers are the only way to move CC between players, and Quests make an alt worth farming. A max stake is optional. | Defer (1 Wager battle in 334) |
| D5 | Challenge prizes for the Elite Four, Blue and Red | **Keep them as they are.** They are one-time. A recurring net sink (F1) absorbs them over weeks. Re-check supply after the first Elite Four clears. | Halve the Elite Four, Blue and Red CC before anyone clears; or pay part in stones and dust |
| D6 | Evolution Stone access | **Add stones to Expeditions, capped at 5 a week.** Keep the shop at 5,000 CC. | Cap 3 or 7; or cut the shop price |
| D7 | Focus type odds (this changes a locked decision) | **Filter the pool by type and leave out Legendary and Mythic.** Keeping each ball's Tier odds makes one legendary or mythic 10x (median) to 21x more likely, at only 1.5x the price (F5). | Keep +50% with both Tiers in; or +200% |
| D8 | Daily board pay | **50 CC per task.** The chest catch is worth more than the task CC (Q2). The mockup's 150 would come to about 30% of an active player's gross income. | 100 or 150 CC per task |
| D9 | Expedition loot table and weekly caps | **Use the Q3 table**: 15 CC/hour, stones 10 to 60% by length, dust 0 to 3, Pokémon 5 to 10% on 8 h and 12 h, rare basic TM. Weekly caps: 5 stones, 15 dust, 2 Pokémon, 1 TM. | 25 CC/hour (mockup) |
| D10 | Logging gaps | **Log trainer purchases, Mega Shard purchases, challenge prize amounts and a daily chat CC total in Phase 0.** About 3% of supply change can't be traced today. | Leave as is |
| D11 | Catch rates and shiny odds | **No change now.** Quests add catches (chest, Expeditions). Re-measure after Phase 2. | Raise the chat catch base to 1.5% |
| D12 | Admin `/shop` stone price (3,500) vs dashboard (5,000) | **Set the admin `/shop` price to 5,000** (low priority; admin-only). | Leave it |

## Top 5 findings

1. **The recurring economy is a net sink, and one-time Challenge prizes are what grow supply.** CC supply rose 192,808 (+7.3%) in 63.6 h. First-win Challenge prizes paid 368,000 of that, 196% of the net growth. Without them, logged flows net -180,192 CC (Live). The next wave is the Elite Four, Blue and Red: 180,000 CC each for every player who clears them (`utils/challenge/roster.js:48-79`). 4 players have already cleared Giovanni.
2. **A Live event can turn Poké Balls into a CC printer.** Throwing has no cooldown, donations have no CC cap, and the admin form allows a 1 to 100% discount (`utils/liveEventRules.js:120`). A Poké Ball donates back 575 CC on average at Master Rank (Model), so any discount above 42.5% pays for itself. A CC multiplier of 1.58 or more does the same for Legend Rank with no discount (Model). No event has ever run (there is no `live-events.json` on the server), so this is a footgun, not an exploit.
3. **The old `/recruit` and `/quest` must never reach players as written.** `/recruit` sells a Poké Ball roll for 100 CC (`commands/recruit.js:44`) that donates back 532 CC (Model, Advanced Rank). That is +432 CC every 30 s, about 1.2M CC a day. `/quest` pays 50 CC plus a free Pokémon or trainer every minute (`commands/quest.js:30-31`), which is 72,000 CC and 1,440 free rolls a day. Only Discord's Administrator default keeps players out.
4. **Evolution Stones run out once Challenge prizes are spent.** In the window, 73% of new stones (101 of 138) and 94% of new Shiny Dust (790 of 837) came from first-win prizes (Live). After that, the free supply is the `/daily` 25% roll: 1.75 stones a week (`commands/daily.js:40`). A Rare to Epic evolution costs 5 stones, which is 25,000 CC at the shop or 20 days of dailies (Model).
5. **Focus type at +50% makes chasing one legendary or mythic 7 to 14x cheaper per CC.** Inside a type pool, one Legendary or Mythic species is 10.3x (median of 127) and up to 21x more likely than with a plain ball (Model). Examples: Xerneas in Fairy, Zapdos in Electric. Leaving those two Tiers out of Focus keeps the chase on plain balls and events (D7).

Also worth knowing: chat catches are not a flat 1%. A pity meter adds 0.3% per rewarded message up to 5%, so a catch comes every 24.6 rewarded messages on average (median 19, 90% within 50) (Model; `bot_final.js:1127-1136`).

# Part 1: Economy audit

## 1.1 Population and supply

| Measure | Value | Source |
|---|---|---|
| Player records | 2,885 | Live |
| Active in 1 / 7 / 30 days | 36 / 44 / 47 | Live (last active, CONTEXT.md) |
| CC supply, all players | 2,627,680 to 2,820,488 (+192,808, +7.3%) | Live, snapshot delta |
| Active players' CC: median / p75 / p90 | 5,210 / 24,286 / 84,015 | Live |
| Active players holding 100,000 CC or more | 4 of 44 | Live |
| Active players' stones: median / p90 | 6 / 39 | Live |
| Active players' Shiny Dust: median / p90 | 22 / 94 | Live |
| Copies per active player: median / p90 | 119 / 543 | Live |
| TMs held / Mega Shards held | 0 / 0 | Live (3 TMs bought, all 3 taught) |

## 1.2 CC flows in the window

All rows come from the event log (Live, `aggregates-reconciled.json`) except chat, which is estimated.

| Flow | Window total | Per active player per day | Kind |
|---|---|---|---|
| Challenge first wins (base prize) | +368,000 | +3,156 | one-time |
| Donations | +330,750 | +2,837 | conversion |
| `/daily` | +83,000 | +712 | recurring |
| Trainer encounter wins | +18,060 | +155 | recurring |
| Chat CC (estimate) | about +6,600 | about +57 | recurring |
| Poké Balls | -470,000 | -4,031 | sink |
| Evolution Stones (shop) | -90,000 | -772 | sink |
| Challenge losses (10%) | -40,002 | -343 | sink |
| TMs | -12,000 | -103 | sink |
| **Logged net** | **+187,808** | **+1,611** | |
| Supply change | +192,808 | | |
| Not traced | +5,000 (3%) | | chat CC, trainer purchases, admin grants, sprite-owned prize CC |

The chat estimate: 14,900 TP was gained in the window, minus 83 dailies x 100 TP, leaves 6,600 chat TP. That is 3,300 rewarded messages, and each one pays an expected 2 CC (2% x 100 CC; `bot_final.js:691-693`). It matches the 5,000 that can't be traced.

Players throw mostly Ultra Balls: 112 of 130 throws (Live). Battles in the window: 169 Casual, 164 Ranked, 1 Wager (Live).

## 1.3 Faucets

| Faucet | Code | Rate | Flow (Live or Model) | Verdict | Opportunities |
|---|---|---|---|---|---|
| `/daily` | `commands/daily.js:38-40` | 1,000 CC, 100 TP, 2 random catches, 25% chance of 1 stone, once per UTC day | +712 CC per active player per day (Live); 83 claims by 35 players | Healthy. It's the backbone of income. | Leave it. Quests add to it rather than changing it. |
| Chat TP and CC | `bot_final.js:691-697`, `utils/passiveChat.js:61-74` | 2 TP and a 2% chance of 100 CC per rewarded message, 7 s apart, **no daily cap** | About +57 CC per active player per day (estimate) | Quiet in practice, unbounded in principle | No cap (D3 declined). Watch `chat_cc` totals per day; act only if one player's chat CC stands out. |
| Chat catch | `bot_final.js:1127-1136` | 1% + 0.3% pity per rewarded message, up to 5%, Poké Ball odds | 1 catch per 24.6 messages (Model) | Fair | D11: no change |
| Weekly pack | `services/gameplay.js:68` | 6 catches: 3 Common, 2 Uncommon, 1 Rare | 5 claims in the window (Live) | Healthy | None |
| Trainer encounters | `utils/battle/tuning.js:86-104`, `utils/encounter/generate.js:63` | 1.5% per missed catch roll, 8 a day at most; prize = class base (10, 30 or 40) x the last Pokémon's Level, won or paid | 27 results, 27 wins, +18,060 CC (Live). Average prize 669. | Small. Every result in the window was a win. | Watch the win rate; Under-tier encounters (70%) may be too soft. |
| Challenge first wins | `utils/challenge/roster.js:31-79`, `utils/challenge/runChallenge.js:135-142` | One-time per Challenge: 229,000 CC, 28 stones and 325 dust in total (Model), plus the trainer sprite, or half its price in CC if already owned | +368,000 CC, 101 stones, 790 dust in 63.6 h (Live) | The biggest faucet, and it ends | D5: keep. 4 players are one step from the 180,000 CC Elite Four, Blue and Red pool. |
| Donations | `utils/economyRules.js:45-52`, `utils/bulkDonate.js:194` | 250 / 500 / 1,000 / 2,500 / 5,000 / 10,000 CC by Tier; a shiny pays 5x | +330,750 CC from 338 copies (Live) | A conversion, not a faucet: it pays back 42 to 63% of a ball's price (Model). Free catches donated are real income. | D2: keep Live event multipliers off donations |
| Achievements | `config/achievementRewards.js:14` | `APPROVED_REWARD_IDS` is empty, so no reward can be claimed | 0 | Dormant | A pending one-time pool of 70,000 CC, 4 stones, 227 dust, 1 Lucky Egg and 1 ball voucher across 73 Achievements (Model). Approving it would be a one-time faucet like Challenges. |
| Live events | `utils/liveEventRules.js:36-50` | CC, TP, dust, prize and EXP multipliers; a 1 to 100% shop discount; catch boosts and limits | Never run (no events file on the server) | Footgun | D2 |
| `/quest`, `/recruit` (old) | `commands/quest.js:30-31`, `commands/recruit.js:43-44` | Free roll + 50 CC every minute; 100 CC roll every 30 s | 1 quest claim, 0 recruits (Live) | Would break the economy if exposed | D1 |
| Admin grants | `services/adminChanges.js:41-67` | Any CC, TP, item, Pokémon, trainer or Aura, up to 1,000,000 per change, with a reason | Inside the 5,000 that can't be traced | Fine. Audited by the admin changes log. | None |
| Wagers | `utils/battle/wager.js:11-16`, `utils/battle/tuning.js:57` | Moves CC between players; minimum 1, no maximum, All-in | 1 Wager battle, 100 CC stake (Live) | Unused, but it's the CC transfer route for alts | D4 |

## 1.4 Sinks

| Sink | Code | Price | Flow (Live) | Verdict | Opportunities |
|---|---|---|---|---|---|
| Poké Balls | `services/gameplay.js:41`, `utils/weightedRandom.js:35-63,137-148` | 1,000 / 2,000 / 4,000 CC. A Great Ball leaves out Common; an Ultra Ball leaves out Common and Uncommon. | -470,000 CC, 130 throws | The main sink, working well | Focus type (Q4) adds a premium version |
| Evolution Stones | `bot_final.js:2277`, `commands/shop.js:94` | 5,000 CC on the dashboard; 3,500 in admin `/shop` | -90,000 CC, 18 bought by 3 players | Steep but used | D6, D12 |
| Evolution (stones and dust) | `services/gameplay.js:44-64`, `utils/economyRules.js:63-82` | 1 to 12 stones by Tier step; shiny evolutions also cost the dust difference | 123 stones and 55 dust spent in 23 evolutions | Stones are the bottleneck | D6 |
| Shiny craft | `utils/economyRules.js:63-70` | 15 / 25 / 40 / 60 / 80 / 120 dust by Tier | 355 dust in 5 crafts | Fine while Challenge dust lasts | Expedition dust (Q3) |
| TMs | `catalog/tms.js:23` | 1,500 / 3,000 / 5,000 / 6,000 / 7,500 | -12,000 CC, 3 TMs | Too early to judge | Keep the prices (11-13 audit) |
| Held items | `catalog/heldItems.js:39-76` | 3,000 to 6,000 CC per unlock; 8 free starters | Flag off | Not live | None |
| Mega Shards and Stones | `config/megaRewards.js:27-36` | 1,000 CC per shard, 25 bought a week at most; a Mega Stone costs 25 or 50 shards | Flag off | Not live. CC caps it at one regular Mega Stone a week. | None |
| Trainer sprites | `utils/trainerCosts.js:7-14` | 2,500 / 7,500 / 15,000 / 35,000 / 75,000 / 150,000 by Tier | Not logged | Can't judge | D10: log purchases |
| Auras (shop) | `catalog/auras.js:54-73` | 25,000 / 50,000 / 100,000 | 0 purchases | Only tier Auras are usable today | A good large sink once shop art ships |
| Challenge losses | `utils/battle/tuning.js:68-69` | 10% of CC per lost attempt, 5 attempts a day | -40,002 CC | Fine | None |
| Trainer encounter losses | `utils/encounter/runEncounter.js:75-82` | Pay the prize, or all CC if less | 0 (no losses) | Fine | None |

## 1.5 Catch rates and Tier odds

Weights apply per species, not per Tier (`utils/weightedRandom.js:101-115`). So a Tier's odds depend on how many species it holds in the live Gens. With Gens 1 to 6 there are 721 species: 180 Common, 163 Uncommon, 184 Rare, 115 Epic, 49 Legendary, 30 Mythic (Model). Rank raises Rare and above (`utils/weightedRandom.js:65-80`).

Tier odds by ball and Rank (Model, `tierOdds`):

| Rank | Ball | Common | Uncommon | Rare | Epic | Legendary | Mythic | Donation payback |
|---|---|---|---|---|---|---|---|---|
| Novice | Poké | 55.3% | 32.8% | 8.7% | 2.7% | 0.43% | 0.09% | 49% |
| Novice | Ultra | 0 | 0 | 69.3% | 24.9% | 4.8% | 1.09% | 42% |
| Master (25k TP) | Poké | 50.5% | 29.9% | 14.3% | 4.7% | 0.55% | 0.11% | 57% |
| Master (25k TP) | Great | 0 | 53.5% | 32.8% | 11.4% | 1.98% | 0.39% | 51% |
| Master (25k TP) | Ultra | 0 | 0 | 68.1% | 25.8% | 4.98% | 1.13% | 42% |
| Legend (250k TP) | Poké | 47.3% | 28.0% | 17.9% | 6.1% | 0.65% | 0.12% | 63% |

Shiny odds go from 1 in 500 at 0 TP to 1 in 250 at 250,000 TP (`shinyOdds.js:7-21`). The 7-day event log has 3 shinies in 731 random catches from balls, dailies and weekly packs (Live, `aggregates-7d.json`). That sample is too small to judge.

Verdict: the odds are coherent. Higher balls cost more per catch and pay back less, which keeps Ultra Balls a real sink. Note that adding Gens shifts Tier odds, because each Gen adds species to some Tiers more than others.

## 1.6 Evolution Stones and Shiny Dust

| | In (window) | Out (window) | Source |
|---|---|---|---|
| Stones | 138: Challenges 101, `/daily` 19, shop 18 | 123 (evolutions) | Live |
| Shiny Dust | 837: Challenges 790, donations 47 | 410: crafts 355, evolutions 55 | Live |

Once a player has collected their Challenge prizes (28 stones and 325 dust each), the free supply is 1.75 stones a week from `/daily` and at most 8 non-shiny donation dust a week (`utils/economyRules.js:89`). A Rare to Epic evolution costs 5 stones, and an Epic to Legendary one costs 8 (`services/gameplay.js:44-64`). That is the gap Expeditions fill (D6).

## 1.7 Exploits and runaway faucets

| Risk | Status | Size | Fix |
|---|---|---|---|
| Live event ball discount of 43% or more, or a CC multiplier of 1.58 or more, with throw-and-donate | Open, never triggered | Unlimited: no throw cooldown and no donation CC cap | D2 |
| `/recruit` opened to players | Hidden by Discord's Administrator default only | +432 CC per use, about +1.2M CC a day | D1 |
| `/quest` opened to players | Hidden by Discord's Administrator default only | 72,000 CC and 1,440 free rolls a day | D1 |
| Chat spam with no cap | Accepted (D3 declined), not seen (chat is quiet) | Up to 12,342 rewarded messages a day: 24,684 CC plus about 502 catches, worth 317,839 CC if donated (Model) | Monitor through the `chat_cc` log (D10) |
| Alt accounts moving CC through Wager losses | Open, 1 Wager seen | Whatever an alt can earn | D4 |
| Untraced CC | 3% of supply change | +5,000 in 63.6 h | D10 |

## 1.8 Where to raise or lower

- **Raise stone access.** Do it through Expeditions, capped (D6), not by cutting the shop price. Shop buyers today are the richest players, and a lower price would mostly help them.
- **Raise Shiny Dust a little.** Expeditions add up to 15 a week (Q3). The non-shiny donation cap of 8 stays.
- **Keep catch rates.** The chest and Expedition Pokémon add about 1 catch a day for a player who does the board (Q5).
- **Lower nothing in CC income now.** The recurring economy is a net sink of about -68,000 CC a day without Challenge prizes (Live, -180,192 over 2.65 days). Quests give recurring income back as Challenge prizes run out.
- **Add sinks later, not now.** Shop Auras (25,000 to 100,000) and Focus type are the natural large sinks.

# Part 2: Quests and Focus type

## Q1. Locked in the design session

- `/quest` becomes **Quests**: a **Daily board** and **Expeditions**. The dashboard does everything; a slim `/quest` in Discord shows status, claims, and links to the page. No DMs.
- Board tasks never depend on luck.
- Expeditions work like a mission table: a shared board of 4 **Missions** a day (seeded by the date), 2 running at once, a party of up to 3 **Copies**, threat types, and a success chance from type counters and Level.
- Team copies can be sent. Sending one takes it off every Team, and until it returns it can't be fed, evolved, donated, gifted, taught a TM or put on a Team.
- Expedition loot is a mixed table with weekly caps. Copies earn EXP. A bonus roll can add EXP or loot, and a failure pays a little EXP.
- `/recruit` is retired. It's replaced by **Focus type** on the dashboard Poké Ball buy, at the ball's price +50%. (D7 asks to change how the odds work.)
- The new terms are in `CONTEXT.md`: Quests, Daily board, Mission, Expedition, Focus type.

## Q2. Daily board

**Player loop.** Open Quests or `/quest`. See 3 tasks. Play normally. Each task fills as it happens. Claim each finished task, then the chest when all 3 are done. The board resets at 00:00 UTC.

**Task pool.** Each day 3 tasks are drawn, seeded by the date and the player id so friends see different boards. Every task is under the player's control:

| Task | Counts | Why it's safe |
|---|---|---|
| Send 30 chat messages | Rewarded messages only (7 s apart) | The task pays once a day, so it adds no extra reason to spam |
| Fight 2 Casual battles | Win or lose | No reason to collude; per-opponent cap of 3 a day (`utils/battle/tuning.js:56`) |
| Throw 1 Poké Ball (any ball) | A dashboard throw | It's a sink |
| Donate 3 duplicates | Any Tier | Already pays CC |
| Evolve 1 Pokémon | Any | Uses stones |
| Feed 1 Pokémon | Any | A small sink of copies |
| Try 1 Challenge | Any result | Has its own loss rule |
| Claim `/daily` | Once | Pulls players back each day |

**Rewards (D8).**

| Reward | Amount | Value (Model) |
|---|---|---|
| Each task | 50 CC | 150 CC a day |
| Chest (all 3 done) | 1 free random catch at Poké Ball odds | 532 CC if donated (Advanced Rank) |
| Weekly bonus (15 of 21 tasks) | 1 free Great Ball throw | 944 CC if donated |
| **Total, every day done** | | **817 CC a day** (`quests.board.allDays.perDayCC`) |

That is about 22% of an active player's gross income in the window (3,760 CC per player per day without Challenge prizes, Live). Most of the value is the catch, and only if it's donated. At 150 CC per task, the total would be 1,117 a day (30%).

**Caps.** A task can be claimed once a day, the chest once a day, and the weekly bonus once per ISO week (UTC). A free catch follows Live event Catch boosts and limits like every free roll (CONTEXT.md).

**User data.**

```
user.quests = {
  day: "2026-11-13",
  board: { tasks: [{ id: "chat30", progress: 12, target: 30, claimed: false }, ...], chestClaimed: false },
  week:  { key: "2026-W46", done: 9, bonusClaimed: false }
}
```

Progress comes from hooks on events the bot already records: the chat handler, battle end, donate, evolve, feed, throw, challenge settle and daily claim. Everything is written in the same user lock and save as the action itself.

**Surfaces.** On the dashboard, a Quests page with a Daily tab: 3 task cards with progress bars and a Claim button, the chest, and the weekly meter. In Discord, `/quest` replies privately with the same summary, plus Claim buttons for finished tasks and the chest, and an "Open Quests" link.

**Anti-abuse.** Claims use the existing `requestId` replay guard. Progress only counts actions that already pass their own checks. Day and week keys come from server time.

## Q3. Expeditions

**Player loop.** Open Quests, then the Expeditions tab. Pick one of today's 4 Missions. Fill a party of up to 3 copies; the success chance updates as you pick. Send. Come back when the timer ends, then claim the loot and EXP.

**Missions.** 4 a day from a date seed, the same for everyone, with lengths of 2, 4, 8 and 12 h. Each has a Level (typical: 15, 30, 40, 60) and 1 to 3 threat types. A player can take each Mission once a day and run 2 at a time.

**Success chance.**

```
35% + 60% x (threats countered / threats)
  + 1% per Level the party average is above the Mission Level
  - 3% per Level it is below
clamped to 5%..95%
```

A copy counters a threat when one of its types is super-effective against that threat type (`utils/battle/data.js:24`, `effectiveness`). The chance is rolled when the party is sent, stored, and shown on the claim. That way, waiting or re-claiming can't change it.

**Loot per success** (D9; `quests.proposal` in `model.json`):

| Length | CC | Stone chance | Dust | Pokémon chance | TM chance |
|---|---|---|---|---|---|
| 2 h | 30 | 10% | 0 | 0 | 0 |
| 4 h | 60 | 20% | 1 | 0 | 0 |
| 8 h | 120 | 40% | 2 | 5% | 0 |
| 12 h | 180 | 60% | 3 | 10% | 2% (a basic TM) |

- **Bonus roll:** a 20% chance on a success of either double EXP or one extra draw of the loot table.
- **Failure:** 5 CC per hour and 25% of the EXP.
- **Weekly caps:** 5 stones, 15 dust, 2 Pokémon, 1 TM. The CC isn't capped, because the slots already limit it.

**EXP.** On a success, each copy gets the EXP of one won Casual battle against 3 foes at the Mission's Level. At Lv 40 that is 868 EXP, against 4,921 to reach Lv 41 (`expReference` in `model.json`). The Battle cap is 10 a day (`utils/battle/tuning.js:56`), so Expeditions add at most 2 to 4 battles' worth, and only for the copies sent. Lucky Egg doesn't apply, because held items come off with the Team.

**Expected value per week** (Model, `quests.expeditions`):

| Player | Runs a day | Success | CC a day | Stones a week | Dust a week | Pokémon a week | CC equivalent a week |
|---|---|---|---|---|---|---|---|
| Casual | one 12 h | 70% | 157 | 3.2 | 15 (capped) | 0.5 | 17,715 |
| Active | 8 h + 12 h | 80% | 284 | 5 (capped) | 15 (capped) | 0.9 | 27,664 |
| Maxed | all 4 | 90% | 399 | 5 (capped) | 15 (capped) | 1.0 | 28,555 |

The CC equivalent prices stones at the 5,000 CC shop price. Most of an Expedition's value is stones that players would otherwise buy or go without, so the CC actually printed is small (157 to 399 a day).

**Sending a Team copy.** The confirm dialog says which Teams the copy leaves. If it's on the Ranked team, it also says the team will drop below 6/6, and Ranked and Wager battles stay blocked until it's refilled (memory: ranked-full-team). The copy's held item goes back to the Bag, and its moveset for that Team is dropped.

**User data.**

```
user.quests.expeditions = [
  { id: "x_8f2k", mission: "2026-11-13:3", sentAt, endsAt,
    party: ["c_aaa", "c_bbb"], chance: 0.78, outcome: { success: true, bonus: "exp", loot: {...} }, claimed: false }
]
user.quests.weekCaps = { key: "2026-W46", stones: 2, dust: 6, pokemon: 0, tms: 0 }
```

A copy is away when its uid is in the party of an unclaimed Expedition. One helper, `isAway(user, uid)`, answers that, and every path that changes a copy calls it: feed, evolve, donate, bulk donate, gift, TM teach, team edits, team copy and shiny craft. No new field goes on the box record.

**Surfaces.** On the dashboard:
- **Mission cards:** length, Level, threat type chips, and "taken today".
- **Party picker:** the Collection grid with a type filter, with a live success %.
- **Running list:** countdowns and Claim buttons.
- **Away badge:** on the copy in the Collection and Teams.

In Discord, `/quest` lists running Expeditions with time left, Claim buttons for finished ones, and the loot in the reply.

**Anti-abuse.**
- The outcome is fixed at send.
- A claim is idempotent (`requestId`).
- A copy can be in only one Expedition.
- Away copies can't be donated or gifted, so they can't be duplicated or passed on.
- Loot can't be traded. CC can only move through Wagers, so D4 must land first.

**Edge cases.**
- A copy evolves or is deleted by an admin while away: the admin path must skip away copies, or end the Expedition and return the party.
- An account reset: Expeditions are cleared with everything else.
- Gen flag changes: loot Pokémon roll from live Gens only.

## Q4. Focus type (replaces `/recruit`)

**Player loop.** On the dashboard Poké Ball buy, an optional "Focus type" picker. Choose a ball and a type, see the price and odds, and throw.

**Price.** The ball price +50%: Poké 1,500, Great 3,000, Ultra 6,000. A Live event discount applies to the base price.

**Odds (D7).** There are two ways to build the roll. The model compares them for every type:

- **A. Keep the ball's Tier odds, then pick within the type.** This was the locked idea. A type with only 1 or 2 species in a high Tier makes each of them far likelier. For example, a focused Ultra Ball gives Xerneas 0.81% against 0.038% plain, 21x the chance (Model).
- **B. Filter the pool by type, with normal weights.** This is simpler, and the Tier odds become the type's own. It still raises one legendary's chance about 10x, because the pool is smaller.

Recommendation: **B, with the Legendary and Mythic Tiers left out of Focus rolls.** Players who chase a legendary keep using plain balls and events. Focus helps build Expedition counters, which is its job. Without those two Tiers, a focused Ultra Ball rolls Rare and Epic only. That is still a 6,000 CC sink that returns 1,206 to 1,608 CC if donated, depending on the type (`focusType.*.perBall.ultraball.recommended_filterNoLegendaryMythic` in `model.json`).

**Small pools.** The smallest type pools are Ice (33 species), Ghost (35), Fairy (35) and Dragon (38) (Model). If a ball leaves out the Tiers a type has (for example, Dragon has 1 Common), the roll uses the Tiers left. A type with nothing for a ball shows that ball greyed out, as the Catch limit code already does (`utils/weightedRandom.js`, `emptyBalls`).

**Data.** None new. A throw logs `roll` with `focus: "<type>"`.

**Retiring `/recruit`.**
- Remove `commands/recruit.js` and its registration.
- Keep `recruitPool`, which `/quest` imports, by moving it to `utils/speciesCatalog.js` or deleting it with the old `/quest`.
- Remove the `recruit` Live event discount category (`utils/liveEventRules.js:27`), and use `balls` for Focus.
- Update CONTEXT.md's random catch note.

## Q5. Economy cost, all of Part 2

For an active player who does the board every day and runs 2 Expeditions:

| | CC a day | Stones a week | Dust a week | Extra catches a week |
|---|---|---|---|---|
| Daily board | 150 + a catch (532 if donated) + the weekly Great Ball | 0 | 0 | 8 |
| Expeditions | 284 | 5 | 15 | 0.9 |
| **Total new** | **434 CC, plus about 670 if the board catches are donated** | **5** | **15** | **about 9** |
| Today (Live, per active player) | 924 recurring (`/daily`, encounters, chat) | 1.75 (`/daily`) | at most 8 (donations) | 14 (`/daily`) + chat |

Quests roughly double recurring CC income for a daily player. That's intended: Challenge prizes are now 3,156 CC per player per day, and they end. The recurring economy is -68,000 CC a day without them. Focus type adds a sink that grows with Expedition demand.

## Q6. Phased build plan

Each phase is its own PR behind its own flag, off by default.

| Phase | Content | Flag | Done when |
|---|---|---|---|
| 0. Guards | D1 unregister `/quest` `/recruit`; D2 event guard; D4 Wager age gate; D10 logging (D3 declined). Built in PR #134 | none (fixes) | Tests for each guard, and `node --check` before deploy |
| 1. Daily board | `user.quests` schema + normalizer, task hooks, claims, dashboard Daily tab, slim `/quest` | `QUESTS_ENABLED`, `QUESTS_BOARD_ENABLED` | Board resets at 00:00 UTC; replayed claims pay once |
| 2. Expeditions | Mission generator, `isAway` on every copy path, send and claim, loot and caps, dashboard tab, `/quest` lines | `QUESTS_EXPEDITIONS_ENABLED` | An away copy is refused by every path; caps hold over a simulated week |
| 3. Focus type | Picker on the Poké Ball buy, pricing, odds option B, `/recruit` code removed | `FOCUS_TYPE_ENABLED` | Odds preview matches the roll; no Legendary or Mythic from Focus |
| 4. Tune | Re-run `tools/economy-audit` after 2 weeks | none | Report addendum |

## Q7. Manual test plan

For each phase, on a local bot with a test account:

1. **Board:** claim `/daily`, send 30 messages 7 s apart, and fight 2 Casual battles. Watch each card fill, claim each one, open the chest, and check that the catch card appears. Run `/quest` and check that it shows the same state.
2. **Reset:** set the clock past 00:00 UTC. The board is new, and the week meter keeps its count.
3. **Send:** put a Ranked team copy in a party. The confirm names the Teams it leaves and the 6/6 warning. Send it, then try to feed, evolve, donate, gift, teach a TM and add it to a Team. Each one is refused with an "away" message.
4. **Claim:** finish an Expedition (shorten the timer in a test). Claim twice quickly; the loot is paid once. Check the EXP on the copy and the loot in the Bag.
5. **Caps:** grant enough runs to pass the 5 stone cap in one week. Stones stop at 5, and the rest of the loot still pays.
6. **Focus:** pick Fairy with an Ultra Ball. The preview shows only Rare and Epic, and the price is 6,000. Throw 20 times with test CC; no Legendary or Mythic appears.
7. **Discord:** run `/quest` with nothing done, with a finished Expedition, and with the chest ready. The buttons work, and the "Open Quests" link opens the page.

## Q8. Open checks

| Check | Why it matters | How to measure |
|---|---|---|
| Trainer sprite spending | An unlogged sink | D10 logging, then `aggregate.mjs` |
| Win rate of Under-tier Trainer encounters | 27 of 27 won | `aggregate.mjs` after D10 adds tier to the result event |
| How the held item and moveset leave a Team when a copy is sent | The send flow reuses team edit code | A unit test in Phase 2 on `services/heldItems.js` and `services/movesets.js` |
| Real Expedition success rates | The formula's 35% / 60% split is a design guess | Phase 2 logs, then `aggregate.mjs` |
| Supply after the first Elite Four clears | D5 | `aggregate.mjs` with `--prev` the snapshot before the clear |
