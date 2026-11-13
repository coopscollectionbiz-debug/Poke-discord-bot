// ==========================================================
// services/evolutionRules.js — evolution eligibility beyond "is it a real
// evolution" (that check stays in services/gameplay.js).
//
// Every evolution costs Evolution Stones by rarity step (EVOLVE_STONE_COST)
// — the bot's single, established evolution currency. On top of that:
//
//   1. Generation gate: the target's generation must be live
//      (config/generations.js). Evolving never creates a species players
//      can't otherwise obtain yet.
//   2. No Level requirement, for any generation (owner decision 2026-11-13):
//      Gen 6–9 evolve on Evolution Stones alone, exactly like Gens 1–5.
//      Every official method (levels, items, friendship/affection, trade,
//      moves, special conditions) maps to the Stone cost; the official
//      method is still shown to players for flavour.
//   3. Evolutions that need a regional form (e.g. Galarian Linoone →
//      Obstagoon) are not in `evolvesTo` at all until forms are enabled.
//
// Evolution never changes ownership counts beyond the one copy evolved,
// never changes shiny status, and carries the Level (carryLevel).
// ==========================================================

import { isAcquirable } from "../utils/speciesCatalog.js";

/** Human-readable official method (for display; the bot's cost is Stones). */
export function officialMethodText(target, nameOf = (id) => `#${id}`) {
  const e = target?.evolution;
  if (!e) return null;
  const parts = [];
  switch (e.trigger) {
    case "level-up": parts.push(e.minLevel ? `Level ${e.minLevel}` : "Level up"); break;
    case "in-battle-level-up": parts.push(`Level ${e.minLevel} in battle`); break;
    case "use-item": parts.push(`Use ${e.item}`); break;
    case "trade": parts.push(e.heldItem ? `Trade holding ${e.heldItem}` : e.tradeSpecies ? `Trade for ${nameOf(e.tradeSpecies)}` : "Trade"); break;
    case "spin": parts.push("Spin while holding a Sweet"); break;
    case "agile-style-move": parts.push(`Use ${e.knownMove ?? "a move"} in Agile Style ${e.moveCount ?? 20} times`); break;
    case "strong-style-move": parts.push(`Use ${e.knownMove ?? "a move"} in Strong Style ${e.moveCount ?? 20} times`); break;
    case "recoil-damage": parts.push(`Take ${e.damageTaken ?? 294}+ recoil damage`); break;
    case "three-critical-hits": parts.push("Land 3 critical hits in one battle"); break;
    case "take-damage": parts.push(`Take ${e.damageTaken ?? 49}+ damage, then pass under a stone arch`); break;
    case "use-move": parts.push(`Use ${e.usedMove ?? e.knownMove ?? "a move"} ${e.moveCount ?? 20} times`); break;
    case "three-defeated-bisharp": parts.push("Defeat 3 Bisharp leading Pawniard"); break;
    case "gimmighoul-coins": parts.push("Collect 999 Gimmighoul Coins"); break;
    case "meltan-candies": parts.push("Feed 400 Meltan Candies"); break;
    default: parts.push(e.trigger ?? "Special");
  }
  if (e.knownMove && !/Style|Use /.test(parts[0])) parts.push(`knowing ${e.knownMove}`);
  if (e.knownMoveType) parts.push(`knowing a ${e.knownMoveType}-type move`);
  if (e.minHappiness) parts.push("with high friendship");
  if (e.minAffection) parts.push("with high affection");
  if (e.heldItem && e.trigger !== "trade") parts.push(`holding ${e.heldItem}`);
  if (e.timeOfDay) parts.push(`at ${e.timeOfDay}`);
  if (e.gender) parts.push(`(${e.gender} only)`);
  if (e.location) parts.push(`at ${e.location}`);
  if (e.rain) parts.push("in the rain");
  if (e.upsideDown) parts.push("with the console upside down");
  if (e.partySpecies) parts.push(`with ${nameOf(e.partySpecies)} in the party`);
  if (e.partyType) parts.push(`with a ${e.partyType}-type in the party`);
  if (e.requiresForm) parts.push(`(${e.requiresForm} form only)`);
  return parts.join(" ");
}

/**
 * Bot-side requirement check, run inside the user's lock: only the
 * generation gate (there is no Level requirement for any generation).
 * @returns {{ok:true} | {ok:false, error:string, status?:number}}
 */
export function checkEvolutionRequirements(user, base, target, variant, { uid = null } = {}) {
  if (!isAcquirable(target.id)) {
    return { ok: false, error: `${target.name} isn't available yet. Generation ${target.generation} hasn't been released.` };
  }
  return { ok: true };
}
