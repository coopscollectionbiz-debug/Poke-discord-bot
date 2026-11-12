// ==========================================================
// tools/lib/tierRules.mjs — rarity tier rule for species added after
// Gen 5. Gen 1–5 tiers were hand-assigned and are never recomputed.
// Owner-approved changes to either (data/pokedex/tier-overrides.json,
// docs/audits/pokemon-tiers/DECISIONS.md) go through applyTierOverrides.
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
 * Apply owner-approved tier changes (data/pokedex/tier-overrides.json) on
 * top of the baseline and rule tiers. Each entry names the tier it replaces
 * (`from`), so a baseline or rule change underneath it fails loudly instead
 * of being silently overwritten. Afterwards every evolution must still be
 * non-decreasing. Mutates `out` and returns the list of applied ids.
 */
export function applyTierOverrides(out, overrides) {
  const applied = [];
  for (const [id, o] of Object.entries(overrides)) {
    const e = out[id];
    if (!e) throw new Error(`tier override #${id}: no such species`);
    if (!TIER_ORDER.includes(o.tier)) throw new Error(`tier override #${id}: unknown tier ${o.tier}`);
    if (e.tier !== o.from) throw new Error(`tier override #${id} ${e.name}: expected ${o.from} underneath, found ${e.tier}`);
    e.tier = o.tier;
    applied.push(Number(id));
  }
  for (const e of Object.values(out)) {
    for (const t of e.evolvesTo) {
      if (TIER_ORDER.indexOf(out[t].tier) < TIER_ORDER.indexOf(e.tier)) {
        throw new Error(`tier overrides make #${e.id} ${e.name} (${e.tier}) → #${t} ${out[t].name} (${out[t].tier}) go down a tier`);
      }
    }
  }
  return applied;
}

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
