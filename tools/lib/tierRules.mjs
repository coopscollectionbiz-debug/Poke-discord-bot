// ==========================================================
// tools/lib/tierRules.mjs — rarity tier rule for species added after
// Gen 5. Gen 1–5 tiers were hand-assigned and are never recomputed.
//
// The rule restates the patterns in the hand-assigned Gen 1–5 data
// (see docs/gen6-9/BALANCE.md for the agreement measurement):
//   • Mythical → mythic. Legendary → legendary, or mythic for box
//     legendaries (base stat total ≥ 670: Mewtwo, Lugia, Kyogre…).
//   • Starter and pseudo-legendary lines → rare / epic / legendary by stage.
//   • Ultra Beasts and Paradox Pokémon (not flagged legendary) → epic.
//   • Babies → common. Fossil bases → rare.
//   • Everything else by evolution role and catch rate (the games' own
//     rarity signal), with base stat total splitting the mixed buckets.
// ==========================================================

export const TIER_ORDER = Object.freeze(["common", "uncommon", "rare", "epic", "legendary", "mythic"]);

/**
 * @param {{bst:number, capture:number, tags:string[], hasPre:boolean, hasEvo:boolean,
 *          starter:boolean, pseudo:boolean, fossil:boolean}} c
 */
export function classifyTier(c) {
  const { bst, capture, tags = [], hasPre, hasEvo, starter, pseudo, fossil } = c;
  if (tags.includes("mythical")) return "mythic";
  if (tags.includes("legendary")) return bst >= 670 ? "mythic" : "legendary";
  if (tags.includes("ultra-beast") || tags.includes("paradox")) return "epic";
  if (starter || pseudo) return !hasPre ? "rare" : hasEvo ? "epic" : "legendary";
  if (tags.includes("baby")) return "common";
  if (fossil && !hasPre) return "rare";
  const role = !hasPre && !hasEvo ? "single" : !hasPre ? "base" : hasEvo ? "mid" : "final";
  if (role === "base") return capture >= 120 ? "common" : capture >= 75 ? "uncommon" : "rare";
  if (role === "mid") return capture >= 75 ? "uncommon" : "epic";
  if (role === "final") {
    if (capture >= 120) return "rare";
    if (capture >= 75) return bst >= 480 ? "rare" : "uncommon";
    if (capture < 45) return "epic";
    return bst >= 500 ? "epic" : bst >= 450 ? "rare" : "uncommon";
  }
  // single-stage
  if (capture >= 120) return "uncommon";
  if (capture >= 75 || capture < 45) return "rare";
  return bst >= 450 ? "rare" : "uncommon";
}
