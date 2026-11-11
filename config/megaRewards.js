// ==========================================================
// config/megaRewards.js — Mega Shard economy (owner decision 2026-11-11).
//
// Players earn generic Mega Shards and spend them on any Mega Stone whose
// form can battle. Stones are never dropped directly.
//
//   • /daily          — a 25% chance (same as the Evolution Stone) of 2 shards
//   • battle wins     — a 10% chance of 1 shard, at most 2 per UTC day; only
//                       a player who started or accepted the battle
//                       (the Challenger, or either side of a wager)
//   • shop (CC)       — 1,000 CC per shard (a regular stone = 25,000 CC,
//                       between the Rare→Epic and Epic→Legendary evolution
//                       steps), at most 25 shards per week (Monday 00:00
//                       UTC reset, like the Weekly Pack); drops don't count
//   • shop (shards)   — 25 shards per regular stone; 50 for a Legendary or
//                       Mythical stone
//
// Everything here runs only while the Mega "rewards" capability is on
// (MEGA_EVOLUTION_ENABLED + MEGA_REWARDS_ENABLED=1, config/features.js).
// With it off, no code path reads these values to grant anything.
// ==========================================================

export const MEGA_REWARDS = Object.freeze({
  version: 2,
  shardItem: "mega_shard",

  daily: Object.freeze({ chance: 0.25, shards: 2 }),

  battleWin: Object.freeze({ chance: 0.1, shards: 1, maxPerUtcDay: 2 }),

  shop: Object.freeze({
    ccPerShard: 1000,
    shardPacks: Object.freeze([1, 5, 25]), // the quantities the dashboard offers
    maxShardsPerPurchase: 25,
    maxCcShardsPerWeek: 25, // shards bought with CC per ISO week (UTC)
    stonePrice: Object.freeze({ regular: 25, legendary: 50 }),
  }),
});
