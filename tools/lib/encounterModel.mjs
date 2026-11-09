// ==========================================================
// tools/lib/encounterModel.mjs — exact encounter probabilities, mirroring
// utils/weightedRandom.js (selectRandomPokemonForUser → weightedRoll) and
// the uniform/tier-slot pickers. Build/analysis only.
//
// weightedRoll gives EACH SPECIES the weight of its tier (× rank × ball
// multipliers), so a tier's share of draws is (species in tier × weight) /
// Σ over all species — adding species changes tier shares as well as
// per-species odds.
// ==========================================================

import { POKEMON_RARITY_WEIGHTS, BALL_MULTIPLIERS, RANK_WEIGHT_MULTIPLIERS } from "../../utils/weightedRandom.js";

export const TIERS = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const BALL_EXCLUDES = { pokeball: [], greatball: ["common"], ultraball: ["common", "uncommon"] };

/** Per-species weight for a tier, exactly as weightedRoll computes it. */
export function speciesWeight(tier, rank, ball) {
  let rankBuffs = RANK_WEIGHT_MULTIPLIERS[rank] || {};
  if (ball !== "pokeball" && rankBuffs.epic) {
    const ceil = rankBuffs.epic;
    rankBuffs = { ...rankBuffs, legendary: Math.max(rankBuffs.legendary || 1, ceil), mythic: Math.max(rankBuffs.mythic || 1, ceil) };
  }
  const ballBuffs = BALL_MULTIPLIERS[ball] || BALL_MULTIPLIERS.pokeball;
  let w = POKEMON_RARITY_WEIGHTS[tier] ?? 0;
  if (rankBuffs[tier]) w *= rankBuffs[tier];
  if (ballBuffs[tier]) w *= ballBuffs[tier];
  return w;
}

/**
 * Weighted selector (chat catch, /daily, /recruit, dashboard Poké Balls).
 * @returns {{ perSpecies: Record<tier, number>, tierShare: Record<tier, number> }}
 */
export function weightedOdds(pool, { rank = "Novice Trainer", ball = "pokeball" } = {}) {
  const filtered = pool.filter((p) => !BALL_EXCLUDES[ball].includes(p.tier));
  const list = filtered.length ? filtered : pool;
  const counts = Object.fromEntries(TIERS.map((t) => [t, list.filter((p) => p.tier === t).length]));
  const total = TIERS.reduce((a, t) => a + counts[t] * speciesWeight(t, rank, ball), 0);
  const perSpecies = {}, tierShare = {};
  for (const t of TIERS) {
    perSpecies[t] = counts[t] ? speciesWeight(t, rank, ball) / total : 0;
    tierShare[t] = counts[t] * perSpecies[t];
  }
  return { perSpecies, tierShare, counts };
}

/** /quest: uniform over the pool. */
export function uniformOdds(pool) {
  const counts = Object.fromEntries(TIERS.map((t) => [t, pool.filter((p) => p.tier === t).length]));
  return { perSpecies: Object.fromEntries(TIERS.map((t) => [t, counts[t] ? 1 / pool.length : 0])), tierShare: Object.fromEntries(TIERS.map((t) => [t, counts[t] / pool.length])), counts };
}

/** Tier-slot packs (weekly pack, starter pack): fixed tiers, uniform within. */
export function slotOdds(pool, tier) {
  const n = pool.filter((p) => p.tier === tier).length;
  return n ? 1 / n : 0;
}
