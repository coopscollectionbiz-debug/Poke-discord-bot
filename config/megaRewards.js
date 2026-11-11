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
//   • shop (CC)       — 200 CC per shard (25 shards = 5,000 CC, the price of
//                       an Evolution Stone)
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
    ccPerShard: 200,
    shardPacks: Object.freeze([1, 5, 25]), // the quantities the dashboard offers
    maxShardsPerPurchase: 100,
    stonePrice: Object.freeze({ regular: 25, legendary: 50 }),
  }),
});
