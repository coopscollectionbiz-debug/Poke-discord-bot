// ==========================================================
// config/megaRewards.js — Mega Stone economy (D-12 … D-15), DECLARATIVE ONLY.
//
// Phase M0: nothing reads this file at runtime, and `active` is false. No
// command, drop table, shop or achievement grants Mega Stones or Shards. The
// values are the approved design (docs/mega-evolution/MEGA-STONE-ECONOMY.md,
// "Medium" scenario) so later phases can wire them in behind
// MEGA_EVOLUTION_ENABLED after a separate approval.
// ==========================================================

export const MEGA_REWARDS = Object.freeze({
  active: false, // must stay false until a reward phase is approved and the flag is on
  version: 1,

  // D-13: Medium scenario. Chances are per event; all random drops share the weekly cap.
  randomDrops: Object.freeze({
    quest: Object.freeze({ chance: 0.005, maxPerUtcDay: 1 }),
    daily: Object.freeze({ chance: 0.03 }),
    battleWin: Object.freeze({ chance: 0, enabled: false }), // D-14: no battle-win drops initially
    maxPerIsoWeek: 2,
    // Pool: regular stones only, for lines the player owns that lack that unlock; when that is empty, any regular stone.
    pool: "targeted-regular",
  }),

  // D-12: Mega Shards.
  shards: Object.freeze({
    perRandomDrop: 2,
    perDuplicateStone: 5,
    costPerRegularStone: 25,
  }),

  // D-15: Legendary/Mythical stones never come from random drops.
  restrictedStones: Object.freeze({
    officialStatuses: Object.freeze(["legendary", "mythical"]),
    allowedSources: Object.freeze(["milestone_voucher", "event"]),
  }),

  // Seasonal/limited events: none scheduled.
  events: Object.freeze([]),
});
