# Mega Shards and the Mega Stone shop

Owner decision, 2026-11-11. This replaces the earlier M4 economy in `MEGA-STONE-ECONOMY.md` (D-12 to D-15). Stones are never dropped directly. Players collect generic Mega Shards and buy the stone they want.

## Earning shards

| Source | Rule |
|---|---|
| `/daily` | 25% chance (the same as the Evolution Stone) of **2 shards** |
| Battle win | 10% chance of **1 shard**, at most 2 drops per UTC day. Only for a winner who chose to battle: the Challenger, or either side of an accepted wager. A Defender who wins a casual or ranked battle they didn't start gets nothing. |
| Shop (CC) | **200 CC per shard**, in packs of 1, 5 or 25 (25 shards = 5,000 CC, the price of an Evolution Stone) |

On average, `/daily` alone gives about 0.5 shards a day.

## Spending shards

The dashboard Shop has a Mega Evolution section that sells **only stones whose Mega can battle**. A stone is listed only if at least one of its forms passes the battle-eligibility rule (`megaBattleEligibility`): a verified profile, a modelled ability, a sprite, a live generation and `MEGA_FORMS`. That's 46 stones while Gens 1–5 are live; Diancite joins when Gen 6 goes live. Pausing Mega battles (`MEGA_BATTLES_ENABLED=0`) doesn't empty the shop.

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
