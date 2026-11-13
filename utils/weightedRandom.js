// ==========================================================
// weightedRandom.js — Coop's Collection (Gacha-Aligned Version)
// Tier-First · Rank-Aware · Ball-Aware · Fractional Safe
// ==========================================================

import { getRank } from "./rankSystem.js";
import { acquirablePokemon } from "./speciesCatalog.js";
import { applyLimits, boostedWeights, pickWeighted, NO_EFFECTS } from "./liveEventRules.js";
import { catchEffectsFor } from "../services/liveEvents.js";

// ==========================================================
// 🎯 BASE WEIGHTS (Pokéball baseline)
// ==========================================================
export const POKEMON_RARITY_WEIGHTS = {
  common: 52,
  uncommon: 34,
  rare: 8,
  epic: 4,
  legendary: 1.5,
  mythic: 0.5,
};

export const TRAINER_RARITY_WEIGHTS = {
  common: 52,
  uncommon: 34,
  rare: 8,
  epic: 4,
  legendary: 1.5,
  mythic: 0.5,
};

// ==========================================================
// 🎯 BALL MULTIPLIER TABLE (Industry-accurate gacha scaling)
// ==========================================================
export const BALL_MULTIPLIERS = {
  pokeball: {
    common:    1.00,
    uncommon:  1.00,
    rare:      1.00,
    epic:      1.00,
    legendary: 1.00,
    mythic:    1.00,
  },
  greatball: {
    common:    0.86,
    uncommon:  0.95,
    rare:      1.22,
    epic:      1.28,
    legendary: 1.40,
    mythic:    1.35,
  },
  ultraball: {
    common:    0.72,
    uncommon:  0.85,
    rare:      1.55,
    epic:      1.78,
    legendary: 2.15,
    mythic:    2.40,
  },
};

// ==========================================================
// 🎯 Rank multipliers (per rare+ tier)
// ==========================================================
export const RANK_WEIGHT_MULTIPLIERS = {
  "Novice Trainer":       { rare: 1.0,  epic: 1.0,  legendary: 1.0,  mythic: 1.0 },
  "Junior Trainer":       { rare: 1.1,  epic: 1.1,  legendary: 1.05, mythic: 1.0 },
  "Skilled Trainer":      { rare: 1.2,  epic: 1.25, legendary: 1.1,  mythic: 1.05 },
  "Experienced Trainer":  { rare: 1.3,  epic: 1.35, legendary: 1.15, mythic: 1.1 },
  "Advanced Trainer":     { rare: 1.4,  epic: 1.45, legendary: 1.2,  mythic: 1.1 },
  "Expert Trainer":       { rare: 1.5,  epic: 1.55, legendary: 1.25, mythic: 1.15 },
  "Veteran Trainer":      { rare: 1.6,  epic: 1.65, legendary: 1.3,  mythic: 1.2 },
  "Elite Trainer":        { rare: 1.7,  epic: 1.8,  legendary: 1.35, mythic: 1.25 },
  "Master Trainer":       { rare: 1.8,  epic: 1.9,  legendary: 1.4,  mythic: 1.3 },
  "Gym Leader":           { rare: 1.9,  epic: 2.0,  legendary: 1.45, mythic: 1.35 },
  "Elite Four Member":    { rare: 2.0,  epic: 2.2,  legendary: 1.5,  mythic: 1.4 },
  "Champion":             { rare: 2.2,  epic: 2.4,  legendary: 1.6,  mythic: 1.5 },
  "Legend":               { rare: 2.4,  epic: 2.6,  legendary: 1.75, mythic: 1.6 },
};

// ==========================================================
// 🔧 Normalize tier name
// ==========================================================
function normalizeTier(value) {
  const t = String(value || "").toLowerCase();
  return (
    {
      common: "common",
      uncommon: "uncommon",
      rare: "rare",
      epic: "epic",
      legendary: "legendary",
      mythic: "mythic",
    }[t] || "common"
  );
}

// ==========================================================
// 🎲 Core function: weighted roll with Ball + Rank multipliers
// ==========================================================
function weightFn(baseWeights, user, ballType = "pokeball") {
  // Load multipliers
  const rank = getRank(user?.tp || 0);
  let rankBuffs = RANK_WEIGHT_MULTIPLIERS[rank] || {};
  const ballBuffs = BALL_MULTIPLIERS[ballType] || BALL_MULTIPLIERS.pokeball;

  // For filtered balls, floor legendary/mythic rank multipliers to epic's
  // so they never lose share when lower tiers are filtered out of the pool
  if (ballType !== "pokeball" && rankBuffs.epic) {
    const ceil = rankBuffs.epic;
    rankBuffs = { ...rankBuffs,
      legendary: Math.max(rankBuffs.legendary || 1.0, ceil),
      mythic:    Math.max(rankBuffs.mythic    || 1.0, ceil),
    };
  }

  return (item) => {
    const tier = normalizeTier(item.tier || item.rarity);
    let w = baseWeights[tier] ?? 0;
    if (rankBuffs[tier]) w *= rankBuffs[tier]; // rank buff
    if (ballBuffs[tier]) w *= ballBuffs[tier]; // ball buff
    return w;
  };
}

function weightedRoll(list, baseWeights, user, ballType = "pokeball") {
  if (!Array.isArray(list) || list.length === 0) return null;
  const weightOf = weightFn(baseWeights, user, ballType);
  return pickWeighted(list.map((item) => ({ item, w: weightOf(item) })));
}

// ==========================================================
// 🎯 Ball tier gates (pool filter before weighted roll)
// — Great Ball: no Common
// — Ultra Ball: no Common or Uncommon (Rare+)
// ==========================================================
function filterPokemonPoolByBall(list, ballType) {
  if (!Array.isArray(list) || list.length === 0) return list;

  if (ballType === "greatball") {
    return list.filter((p) => normalizeTier(p?.tier || p?.rarity) !== "common");
  }

  if (ballType === "ultraball") {
    return list.filter((p) => {
      const t = normalizeTier(p?.tier || p?.rarity);
      return t !== "common" && t !== "uncommon";
    });
  }

  return list;
}

// ==========================================================
// 🎯 Pokémon selector (tier-aware, rank-aware, ball-aware)
// ==========================================================
/**
 * One random catch roll. Live events (services/liveEvents.js): Catch limits
 * narrow the pool and Catch boosts reweight it. Free rolls always follow
 * them; paid rolls (`paid: true`: Poké Balls) only when the player
 * opted in. Returns null when a paid, opted-in ball has nothing it may give.
 *
 * @param {{ paid?: boolean, fx?: object }} [opts] fx: precomputed catch effects
 */
export function selectRandomPokemonForUser(pool, user, source = "pokeball", { paid = false, fx = null } = {}) {
  // 🔧 FIX: ensure pool is an array; your pokemonData is an object
  let list = Array.isArray(pool) ? pool : Object.values(pool);
  // Generation controls: never hand out a species from a disabled generation,
  // whatever pool the caller passed (callers should already pass
  // getAcquirablePokemon(); this is the backstop).
  list = acquirablePokemon(list);

  const valid = ["pokeball", "greatball", "ultraball"];
  const ballType = valid.includes(source) ? source : "pokeball";
  const effects = fx ?? catchEffectsFor(user, { paid });

  if (effects.limits.length) {
    const limited = applyLimits(list, effects);
    const usable = filterPokemonPoolByBall(limited, ballType);
    // Paid and opted in: the event pool or nothing (no CC is spent).
    if (paid && !usable.length) return null;
    // Free rolls never come up empty: the dashboard refuses limits that empty
    // a Poké Ball's pool, and if generations change later the roll falls back.
    if (limited.length) list = limited;
  }

  const filtered = filterPokemonPoolByBall(list, ballType);
  if (filtered.length > 0) {
    list = filtered;
  }
  if (!list.length) return null;

  const weightOf = weightFn(POKEMON_RARITY_WEIGHTS, user, ballType);
  return pickWeighted(boostedWeights(list, effects, weightOf));
}

// ==========================================================
// 🎯 Focus type (economy audit 2026-11, replaces /recruit)
// ==========================================================
// A focused throw keeps the ball's Tier odds exactly: the Tier is rolled from
// the whole pool's weights, as a plain throw would. Then the pick is made
// among that Tier's species in the Focus (a type or a Region), at every Tier,
// Mythic included (owner decision 2026-11-13: players may chase a specific
// Legendary or Mythic; docs/audits/economy-2026-11/focus-analysis.json). If
// the Focus has nothing at the rolled Tier for this ball, the Tier is re-rolled
// among the Focus's Tiers by their usual weights.
// Returns { pick } or null when the Focus has nothing this ball can give
// (the caller charges nothing).
const TIER_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

/** The Focus test for a species: { type: <PokeAPI type id> } or { region: "Kanto" }. */
export function focusTest(focus) {
  if (focus?.type != null) return (p) => (p.types ?? []).map(Number).includes(Number(focus.type));
  if (focus?.region) return (p) => p.region === focus.region;
  return () => false;
}

/**
 * @param {object[]} pool  acquirable species
 * @param {{ type?: number, region?: string }} focus
 * @param {{ paid?: boolean, fx?: object, rand?: () => number }} [opts]
 */
export function selectFocusedPokemon(pool, user, source, focus, { paid = true, fx = null, rand = Math.random } = {}) {
  let list = acquirablePokemon(Array.isArray(pool) ? pool : Object.values(pool));
  const ballType = ["pokeball", "greatball", "ultraball"].includes(source) ? source : "pokeball";
  const effects = fx ?? catchEffectsFor(user, { paid });
  if (effects.limits.length) {
    const limited = filterPokemonPoolByBall(applyLimits(list, effects), ballType);
    if (paid && !limited.length) return null;
    if (limited.length) list = limited;
  }
  list = filterPokemonPoolByBall(list, ballType);
  if (!list.length) return null;

  const inFocus = focusTest(focus);
  const rows = boostedWeights(list, effects, weightFn(POKEMON_RARITY_WEIGHTS, user, ballType));
  const byTier = new Map(TIER_ORDER.map((t) => [t, []]));
  for (const r of rows) byTier.get(normalizeTier(r.item.tier || r.item.rarity))?.push(r);
  const tierWeight = (t) => byTier.get(t).reduce((s, r) => s + r.w, 0);
  const focused = (t) => byTier.get(t).filter((r) => inFocus(r.item));

  const focusTiers = TIER_ORDER.filter((t) => focused(t).length && tierWeight(t) > 0);
  if (!focusTiers.length) return null; // nothing of this Focus for this ball

  const tier = pickWeighted(TIER_ORDER.map((t) => ({ item: t, w: tierWeight(t) })), rand);
  const useTier = focused(tier).length ? tier : pickWeighted(focusTiers.map((t) => ({ item: t, w: tierWeight(t) })), rand);
  return { pick: pickWeighted(focused(useTier), rand) };
}

/** Balls that have nothing to give under the running Catch limits (greyed out for opted-in players). */
export function emptyBalls(pool, effects) {
  if (!effects.limits.length) return [];
  const limited = applyLimits(acquirablePokemon(Array.isArray(pool) ? pool : Object.values(pool)), effects);
  return ["pokeball", "greatball", "ultraball"].filter((b) => !filterPokemonPoolByBall(limited, b).length);
}

/** The weighted rows a roll would use (the dashboard's odds preview). */
export function rollRows(pool, user, source = "pokeball", effects = NO_EFFECTS) {
  let list = acquirablePokemon(Array.isArray(pool) ? pool : Object.values(pool));
  const ballType = ["pokeball", "greatball", "ultraball"].includes(source) ? source : "pokeball";
  list = applyLimits(list, effects);
  const filtered = filterPokemonPoolByBall(list, ballType);
  if (effects.limits.length || filtered.length) list = filtered;
  return boostedWeights(list, effects, weightFn(POKEMON_RARITY_WEIGHTS, user, ballType));
}



// ==========================================================
// 🎯 Trainer selector (same logic, pre-flattened)
// ==========================================================
export function selectRandomTrainerForUser(trainerPool, user) {
  const flat = Array.isArray(trainerPool)
    ? trainerPool
    : Object.entries(trainerPool).map(([key, v], i) => ({
        id: v.id ?? key ?? `trainer-${i}`,
        name: v.name || key,
        tier: normalizeTier(v.tier || v.rarity),
        spriteFile: v.spriteFile || v.sprites?.[0] || `${key}.png`,
        groupName: key,     // <-- THIS FIXES THE ERROR
        raw: v,
      }));

  const chosen = weightedRoll(flat, TRAINER_RARITY_WEIGHTS, user, "pokeball");

  return {
    id: chosen.id,
    name: chosen.name,
    tier: chosen.tier,
    rarity: chosen.tier,
    spriteFile: chosen.spriteFile,
    filename: chosen.spriteFile,
    groupName: chosen.groupName   // <-- NOW SAFE
  };
}

// ==========================================================
// 🧪 Optional simulation
// ==========================================================
export function simulateDrops(pool, iterations = 10000) {
  const counts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 };

  for (let i = 0; i < iterations; i++) {
    const pick = weightedRoll(pool, TRAINER_RARITY_WEIGHTS, { tp: 0 }, "pokeball");
    if (pick) counts[normalizeTier(pick.tier)]++;
  }

  return counts;
}
