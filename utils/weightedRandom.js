// ==========================================================
// weightedRandom.js (Fractional RNG Version)
// Coop’s Collection — Tier-First, Rank-Aware, Fractional Weights
// ==========================================================

import { getRank } from "./rankSystem.js";

// ==========================================================
// ⚖️ Base rarity/tier weights (fractional allowed!)
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
// Normalize label
// ==========================================================
function normalizeTier(value) {
  const t = String(value || "common").toLowerCase();
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
// 💪 Rank multipliers (fractional safe!)
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
// 🎲 FRACTIONAL weighted random choice
// Pure probability roll, no rounding, no bags
// ==========================================================
function fractionalRandomChoice(list, weights) {
  if (!Array.isArray(list) || list.length === 0) return null;

  let total = 0;
  const tiers = list.map((item) => {
    const tier = normalizeTier(item.tier || item.rarity);
    const w = weights[tier] ?? 0;
    total += w;
    return { item, weight: w };
  });

  if (total <= 0) return list[Math.floor(Math.random() * list.length)];

  let roll = Math.random() * total;

  for (const { item, weight } of tiers) {
    roll -= weight;
    if (roll <= 0) return item;
  }

  return tiers[tiers.length - 1].item;
}

// ==========================================================
// 🎲 FRACTIONAL weighted random with rank multipliers
// ==========================================================
function fractionalRandomChoiceWithRank(list, weights, user) {
  if (!Array.isArray(list) || list.length === 0) return null;

  const rank = getRank(user.tp || 0);
  const buffs = RANK_WEIGHT_MULTIPLIERS[rank] || {};

  let total = 0;
  const weightedList = list.map((item) => {
    const tier = normalizeTier(item.tier || item.rarity);
    let w = weights[tier] ?? 0;

    if (buffs[tier]) w *= buffs[tier];

    total += w;
    return { item, weight: w };
  });

  if (total <= 0)
    return list[Math.floor(Math.random() * list.length)];

  let roll = Math.random() * total;

  for (const { item, weight } of weightedList) {
    roll -= weight;
    if (roll <= 0) return item;
  }

  return weightedList[weightedList.length - 1].item;
}

// ==========================================================
// 🧩 Convenience wrapper: Pokémon
// ==========================================================
export function selectRandomPokemonForUser(pokemonPool, user) {
  return fractionalRandomChoiceWithRank(
    pokemonPool,
    POKEMON_RARITY_WEIGHTS,
    user
  );
}

// ==========================================================
// 🧩 Convenience wrapper: Trainer
// ==========================================================
export function selectRandomTrainerForUser(trainerPool, user) {
  // Flatten trainerPool objects into usable trainer entries
  const entries = Array.isArray(trainerPool)
    ? trainerPool
    : Object.entries(trainerPool).map(([k, v]) => ({ key: k, ...v }));

  const normalized = entries.map((trainer, i) => ({
    id: trainer.id || trainer.key || `trainer-${i}`,
    name: trainer.name || trainer.key,
    tier: normalizeTier(trainer.tier || trainer.rarity || "common"),
    sprites: trainer.sprites || [trainer.spriteFile || `${trainer.id}.png`],
    spriteFile: trainer.spriteFile || (trainer.sprites?.[0] ?? `${trainer.id}.png`),
    raw: trainer,
  }));

  const chosen = fractionalRandomChoiceWithRank(
    normalized,
    TRAINER_RARITY_WEIGHTS,
    user
  );

  return {
    id: chosen.id,
    name: chosen.name,
    tier: chosen.tier,
    rarity: chosen.tier,
    sprites: chosen.sprites,
    spriteFile: chosen.spriteFile,
    filename: chosen.spriteFile,
    groupName: chosen.raw.key || chosen.id,
  };
}

// ==========================================================
// 🧪 Simulation helper (fractional safe)
// ==========================================================
export function simulateDrops(pool, iterations = 10000) {
  const counts = {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
    mythic: 0,
  };

  for (let i = 0; i < iterations; i++) {
    const pick = fractionalRandomChoice(pool, TRAINER_RARITY_WEIGHTS);
    if (pick)
      counts[normalizeTier(pick.tier || pick.rarity)]++;
  }

  console.log("🎲 Simulated distribution:", counts);
  return counts;
}
