# Mega Shards and the Mega Stone shop

Owner decision, 2026-11-11. This replaces the earlier M4 economy in `MEGA-STONE-ECONOMY.md` (D-12 to D-15). Stones are never dropped directly. Players collect generic Mega Shards and buy the stone they want.

## Earning shards

| Source | Rule |
|---|---|
| `/daily` | 25% chance (the same as the Evolution Stone) of **2 shards** |
| Battle win | 10% chance of **1 shard**, at most 2 drops per UTC day. Only for a winner who chose to battle: the Challenger, or either side of an accepted wager. A Defender who wins a casual or ranked battle they didn't start gets nothing. |
| Shop (CC) | **1,000 CC per shard**, in packs of 1, 5 or 25, at most **25 shards per week** (resets Monday 00:00 UTC, like the Weekly Pack). Drops don't count toward the limit. |

On average, `/daily` alone gives about 0.5 shards a day, and an active battler gets up to another 0.5.

### Why these numbers (owner decision 2026-11-11: Evolution Stones stay as they are)

A Mega is a bigger power jump than a final evolution, so a regular stone (25 shards) is priced at 25,000 CC with CC. That sits between the Rare→Epic step (5 Evolution Stones = 25,000 CC) and the Epic→Legendary step (8 = 40,000 CC). Legendary stones (50 shards) cost 50,000 CC.

- **Drops only:** about one regular Mega every 4–6 weeks.
- **Drops plus `/daily` CC:** about one every 2–3 weeks.
- **Weekly limit:** CC can buy at most one regular stone's worth (25 shards) a week, so large CC balances can't buy every Mega at launch.

Most Megas also need the final evolution first; Charizard alone is 13 Evolution Stones. A few have no evolution: Kangaskhan, Pinsir, Aerodactyl, Heracross, Absol and Mawile.

## Spending shards

The dashboard Shop has a Mega Evolution section that sells **only stones whose Mega can battle**. A stone is listed only if at least one of its forms passes the battle-eligibility rule (`megaBattleEligibility`): a verified profile, a modelled ability, a sprite, a live generation and `MEGA_FORMS`. That's 46 stones while Gens 1–5 are live, and 66 once Gens 6–9 are live. Pausing Mega battles (`MEGA_BATTLES_ENABLED=0`) doesn't empty the shop.

### Gen 6–9 Megas (owner decision 2026-11-11)

Most Gen 6–9 Megas debuted in Legends: Z-A, which has no abilities in play, so `megas.json` marks their battle profile "unverified" (stats and types from Z-A; ability from Pokémon Showdown's "Future" data). The owner accepted those profiles for **Gen 6–9 Pokémon** (`config/megaBattleProfiles.js`), so these Megas battle and are sold as soon as their generation goes live. Every ability involved is already modelled by the battle engine.

| Generation | Stones that join the shop when it goes live |
|---|---|
| 6 | Chesnaughtite, Delphoxite, Greninjite, Pyroarite, Meowsticite (M/F), Malamarite, Barbaracite, Dragalgite, Hawluchanite, Diancite (Mythical, 50) |
| 7 | Crabominite, Golisopite, Drampanite, Magearnite (Mythical, 50), Zeraorite (Mythical, 50) |
| 8 | Falinksite |
| 9 | Scovillainite, Glimmoranite, Tatsugirinite (3 appearances), Baxcalibrite |

Still blocked: Mega Floette (needs Floette-Eternal), Mega Zygarde (needs Complete Forme; no sprite) and Original Color Mega Magearna. Z-A Megas of **Gen 1–5** Pokémon (e.g. Mega Dragonite, Mega Starmie, Mega Raichu X/Y) are not accepted and stay out of battle and the shop.

| Stone | Price |
|---|---|
| Regular | 25 shards |
| Legendary / Mythical (Mewtwonite X/Y, Latiasite, Latiosite; Diancite with Gen 6) | 50 shards |

A bought stone goes to the bag and is used from the Mega section of the Collection page, exactly as before.

## Switches

All of this is behind the new opt-in capability **rewards**: `MEGA_EVOLUTION_ENABLED=1` **and** `MEGA_REWARDS_ENABLED=1`. With either unset, which is production today:

- no shard or stone can be granted (`grantItem` refuses them);
- `/daily` and battles never roll for shards, and battle results carry no `megaShards` key;
- `GET /api/mega/shop` answers `{ enabled: false }`, both purchase endpoints return 403, and the Shop page shows no Mega section.

`/addinventory` still can't grant Mega items in any mode; it uses the catalog's static holdability. Vouchers stay unobtainable.

## Code

- `config/megaRewards.js`: rates and prices.
- `services/megaShards.js`: shop list, CC purchase, stone purchase, daily and battle rolls.
- `services/megaApi.js` + `bot_final.js`: `GET /api/mega/shop`, `POST /api/mega/shop/buy-shards`, `POST /api/mega/shop/buy-stone`. These are session-checked, require a requestId (replay-safe) and run under the player lock.
- `commands/daily.js`, `utils/battle/runBattle.js`, `commands/battle.js`: the two drop points and their message lines. The battle roll uses its own seeded RNG, so battles are unchanged.
- `public/dashboardshop/mega.js`: the Shop page section.
- Tests: `tests/megaShards.test.js` (79 assertions), plus updated `megaSafety`, `megaCatalog` and `megaUnlock`.
- Preview: `node tools/dev/mega-shop-preview.mjs 5191 on|off` runs the real shop handlers over one in-memory player.

## Going live

1. Merge and deploy (nothing changes for players).
2. Set `MEGA_EVOLUTION_ENABLED=1`, `MEGA_BATTLES_ENABLED=1` and `MEGA_REWARDS_ENABLED=1` on Fly, after the usual backup.
