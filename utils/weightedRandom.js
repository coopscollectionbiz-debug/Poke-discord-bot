// ==========================================================
// weightedRandom.js — Coop’s Collection (Gacha-Aligned Version)
// Tier-First · Rank-Aware · Ball-Aware · Fractional Safe
// ==========================================================

import { getRank } from "./rankSystem.js";

// ==========================================================
// 🎯 BASE WEIGHTS (Pokéball baseline)
// ==========================================================
export const POKEMON_RARITY_WEIGHTS = {
  common: 50,
  uncommon: 34,
  rare: 10,
  epic: 4,
  legendary: 1.5,
  mythic: 0.5,
};

export const TRAINER_RARITY_WEIGHTS = {
  common: 50,
  uncommon: 34,
  rare: 10,
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
function weightedRoll(list, baseWeights, user, ballType = "pokeball") {
  if (!Array.isArray(list) || list.length === 0) return null;

  // Load multipliers
  const rank = getRank(user.tp || 0);
  const rankBuffs = RANK_WEIGHT_MULTIPLIERS[rank] || {};
  const ballBuffs = BALL_MULTIPLIERS[ballType] || BALL_MULTIPLIERS.pokeball;

  let total = 0;

  const weighted = list.map((item) => {
    const tier = normalizeTier(item.tier || item.rarity);
    let w = baseWeights[tier] ?? 0;

    // Apply rank buff
    if (rankBuffs[tier]) w *= rankBuffs[tier];

    // Apply ball buff
    if (ballBuffs[tier]) w *= ballBuffs[tier];

    total += w;
    return { item, w };
  });

  if (total <= 0) return list[Math.floor(Math.random() * list.length)];

  let roll = Math.random() * total;

  for (const { item, w } of weighted) {
    roll -= w;
    if (roll <= 0) return item;
  }

  return weighted[weighted.length - 1].item;
}

// ==========================================================
// 🎯 Pokémon selector (tier-aware, rank-aware, ball-aware)
// ==========================================================
export function selectRandomPokemonForUser(pool, user, source = "pokeball") {
  const valid = ["pokeball", "greatball", "ultraball"];
  const ballType = valid.includes(source) ? source : "pokeball";
  return weightedRoll(pool, POKEMON_RARITY_WEIGHTS, user, ballType);
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
        spriteFile: v.spriteFile || v.sprites?.[0] || `${v.id}.png`,
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
    groupName: chosen.raw.key || chosen.id
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
