// ==========================================================
// rankSystem.js
// Centralized rank tier management with optimized lookups
// ==========================================================

/**
 * Rank tier definitions
 */
const RANK_TIERS = [
  { tp: 100, roleName: "Novice Trainer" },
  { tp: 500, roleName: "Junior Trainer" },
  { tp: 1000, roleName: "Skilled Trainer" },
  { tp: 2500, roleName: "Experienced Trainer" },
  { tp: 5000, roleName: "Advanced Trainer" },
  { tp: 7500, roleName: "Expert Trainer" },
  { tp: 10000, roleName: "Veteran Trainer" },
  { tp: 17500, roleName: "Elite Trainer" },
  { tp: 25000, roleName: "Master Trainer" },
  { tp: 50000, roleName: "Gym Leader" },
  { tp: 100000, roleName: "Elite Four Member" },
  { tp: 175000, roleName: "Champion" },
  { tp: 250000, roleName: "Legend" }
];

/**
 * Map for O(1) role name lookups
 */
const ROLE_NAME_MAP = new Map(
  RANK_TIERS.map(tier => [tier.roleName, tier.tp])
);

/**
 * Get the rank name for a given TP total
 * @param {number} tp - Total TP
 * @returns {string} Rank name
 */
export function getRank(tp) {
if (tp < 100) return null;
  let current = "";
  for (const tier of RANK_TIERS) {
    if (tp >= tier.tp) {
      current = tier.roleName;
    }
  }
  return current;
}

/**
 * Get all rank tiers
 * @returns {Array} Array of rank tier objects
 */
export function getRankTiers() {
  return [...RANK_TIERS];
}

/**
 * Get the TP requirement for a specific rank
 * @param {string} roleName - Rank role name
 * @returns {number|null} TP requirement or null if not found
 */
export function getTpForRank(roleName) {
  return ROLE_NAME_MAP.get(roleName) || null;
}

/**
 * Get the next rank tier for a given TP
 * @param {number} tp - Current TP
 * @returns {object|null} Next tier object or null if at max
 */
export function getNextRank(tp) {
  for (const tier of RANK_TIERS) {
    if (tp < tier.tp) {
      return tier;
    }
  }
  return null;
}

/**
 * Get progress to next rank as a percentage
 * @param {number} tp - Current TP
 * @returns {object} { current: string, next: string|null, progress: number, remaining: number }
 */
export function getRankProgress(tp) {
  const current = getRank(tp);
  const next = getNextRank(tp);
  
  if (!next) {
    return {
      current,
      next: null,
      progress: 100,
      remaining: 0
    };
  }
  
  const currentTier = RANK_TIERS.find(t => t.roleName === current);
  const currentTp = currentTier?.tp || 0;
  const nextTp = next.tp;
  const range = nextTp - currentTp;
  const progress = ((tp - currentTp) / range) * 100;
  
  return {
    current,
    next: next.roleName,
    progress: Math.min(100, Math.max(0, progress)),
    remaining: Math.max(0, nextTp - tp)
  };
}
