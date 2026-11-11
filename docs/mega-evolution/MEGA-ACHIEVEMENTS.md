# Mega Evolution: achievements (proposal; not added to production)

## 1. Existing system (audited)

- The catalogue is `catalog/achievements.js` (revision 3). Each entry: `{ id, name, description, category, metric: { kind: "state"|"counter", key }, target, tier, ap, reward, retro, hidden }`.
- The engine is `progression/achievements.js`: `trackProgress(user, events)` and `evaluate`. Rewards are claimed with `claimAchievement`, which refuses anything not approved by the policy (`config/achievementRewards.js`, D-07 "pending_approval").
- Collection metrics read `user.pokemon` (species keys). Forms count toward their base species. Classic completion entries are pinned to Gens 1–5.

Megas are not in `user.pokemon`, so **no existing achievement can move**, and Megas never count as National Dex species. A test pins this: for every existing achievement, its metric is identical before and after a synthetic player gains 10 Mega unlocks.

## 2. New metrics (additive)

| Metric | Kind | Definition |
|---|---|---|
| `state:megaForms` | state | Distinct Mega stable ids unlocked on **currently owned** lines (dormant unlocks don't count, consistent with "own at the same time") |
| `state:megaSpeciesDual` | state | Species with both X and Y (or both Mega and Mega Z) unlocked on owned lines |
| `state:megaLegendary` | state | Distinct Legendary/Mythical Megas unlocked on owned lines |
| `counter:megaUnlocks` | counter | Unlock transactions performed (`retro: "none"`) |
| `counter:megaWins` | counter | Battles won with a Mega on the team (`runBattle`, once per battle) |
| `state:megaCollection` | state | `megaForms` over the activatable set (excludes blocked forms) |

## 3. Proposed entries (category "mega", new; hidden until `MEGA_EVOLUTION_ENABLED`)

| id | Name | Requirement | Tier | AP | Proposed reward (pending approval) |
|---|---|---|---:|---:|---|
| `mega_first` | Mega Bond | Unlock 1 Mega form | 1 | 10 | 5 Mega Shards |
| `mega_forms_5` | Mega Collector I | Own 5 different Mega forms | 2 | 15 | 10 Mega Shards |
| `mega_forms_10` | Mega Collector II | Own 10 | 3 | 25 | Mega Stone Voucher (regular) |
| `mega_forms_25` | Mega Collector III | Own 25 | 4 | 50 | Mega Stone Voucher (regular) |
| `mega_forms_50` | Mega Collector IV | Own 50 | 5 | 80 | Legendary Mega Stone Voucher |
| `mega_win_1` | Mega Victory | Win a battle with a Mega on the team | 1 | 10 | 500 CC |
| `mega_win_25` | Mega Champion | 25 such wins | 3 | 25 | Mega Stone Voucher (regular) |
| `mega_dual` | Two Sides of Power | Unlock both X and Y (or Mega and Mega Z) of one species | 3 | 30 | Badge `badge_mega_dual` |
| `mega_legend` | Legendary Bond | Unlock a Legendary or Mythical Mega | 4 | 40 | Badge |
| `mega_all` | Mega Master | Own every activatable Mega form | 5 | 150 | Title "Mega Master" |

- Mega Stone Vouchers and Shards are new catalogue items (`status: "defined"` until approved).
- The `mega_all` target is computed from the activatable set, so it moves when blocked forms (Zygarde, Rayquaza) are activated. Proposed `retro: "full"`. Re-evaluation follows the Release C pattern (revision bump; earned achievements never revoked).
- Classic entries (Pokédex Complete 649, Hall of Legends, and the rest) are untouched.
