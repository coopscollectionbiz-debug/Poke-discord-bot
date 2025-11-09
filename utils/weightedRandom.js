// ==========================================================
// weightedRandom.js
// Shared weighted random selection logic (Tier- and Rank-Aware)
// ==========================================================

import { getRank } from "./rankSystem.js";

// ==========================================================
// ⚖️ Base rarity/tier weights
// Higher = more common
// ==========================================================
export const POKEMON_RARITY_WEIGHTS = {
  common: 60,
  uncommon: 24,
  rare: 10,
  epic: 4,
  legendary: 1.5,
  mythic: 0.5,
};

export const TRAINER_RARITY_WEIGHTS = {
  common: 60,
  uncommon: 24,
  rare: 10,
  epic: 4,
  legendary: 1.5,
  mythic: 0.5,
};

// ==========================================================
// 🧩 Normalize tier/rarity label
// ==========================================================
function normalizeTier(value) {
  const t = String(value || "common").toLowerCase();
  const map = {
    common: "common",
    uncommon: "uncommon",
    rare: "rare",
    epic: "epic",
    legendary: "legendary",
    mythic: "mythic",
  };
  return map[t] || "common";
}

// ==========================================================
// 💪 Rank-based Weight Multipliers
// Matches rank names from rankSystem.js
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
// 🎲 Weighted Random Choice Helper
// ==========================================================
export function weightedRandomChoice(list, weights) {
  if (!Array.isArray(list) || !list.length) return null;
  const bag = [];

  for (const item of list) {
    const rarity = normalizeTier(item.tier || item.rarity);
    const weight = weights[rarity] || 1;
    for (let i = 0; i < Math.round(weight); i++) bag.push(item);
  }

  return bag[Math.floor(Math.random() * bag.length)];
}

// ==========================================================
// 🧮 Rank-Aware Weighted Random Choice
// Applies multipliers based on user rank and rarity/tier
// ==========================================================
export function weightedRandomChoiceWithRank(list, weights, user) {
  if (!Array.isArray(list) || !list.length) return null;

  const rank = getRank(user.tp || 0);
  const buffs = RANK_WEIGHT_MULTIPLIERS[rank] || {};
  const bag = [];

  for (const item of list) {
    const rarity = normalizeTier(item.tier || item.rarity);
    let weight = weights[rarity] || 1;

    if (buffs[rarity]) weight *= buffs[rarity];
    for (let i = 0; i < Math.round(weight); i++) bag.push(item);
  }

  if (!bag.length) return list[Math.floor(Math.random() * list.length)];
  return bag[Math.floor(Math.random() * bag.length)];
}

// ==========================================================
// 🧩 Convenience Wrappers
// ==========================================================
export function selectRandomPokemonForUser(pokemonPool, user) {
  return weightedRandomChoiceWithRank(pokemonPool, POKEMON_RARITY_WEIGHTS, user);
}

// ==========================================================
// 🧩 Fixed Trainer Selector (uses group key for readable names)
// ==========================================================
export function selectRandomTrainerForUser(trainerPool, user) {
  // Normalize trainerPool entries into [groupName, data]
  const entries = Array.isArray(trainerPool)
    ? trainerPool.map((t, i) => [t.id || t.name || `trainer-${i}`, t])
    : Object.entries(trainerPool);

  const allTrainers = entries.map(([groupKey, data]) => {
    const id = String(groupKey)
      .replace(/^trainers?_2\//, "")
      .replace(/\.png$/i, "")
      .trim()
      .toLowerCase();

    const tier = normalizeTier(data?.tier || data?.rarity || "common");

    // 🧩 Collect sprite filenames
    const sprites = Array.isArray(data?.sprites)
      ? data.sprites
          .filter((s) => typeof s === "string" && s.trim().length)
          .map((s) => s.toLowerCase())
      : [typeof data?.spriteFile === "string"
          ? data.spriteFile.toLowerCase()
          : `${id}.png`];

    // 🧠 Smart name: prefer the group key (Ace Trainer, Grunt, etc.)
    let displayName = groupKey
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();

    // Clean common suffixes
    displayName = displayName
      .replace(/\bTrainer\b/i, "Trainer")
      .replace(/\bGrunt\b/i, "Rocket Grunt")
      .replace(/\s{2,}/g, " ");

    return { id, name: displayName, tier, sprites, groupName: groupKey };
  });

  // Weighted random pick based on rarity + user rank
  const chosen = weightedRandomChoiceWithRank(
    allTrainers,
    TRAINER_RARITY_WEIGHTS,
    user
  );
  if (!chosen) return null;

  // Pick a random sprite file within the chosen group
  const spriteFile =
    chosen.sprites[Math.floor(Math.random() * chosen.sprites.length)];

  // 🧩 Final normalized trainer object
  return {
    id: chosen.id,
    name: chosen.name,               // ✅ Always readable ("Ace Trainer")
    rarity: chosen.tier,
    spriteFile: spriteFile.toLowerCase(),
    filename: spriteFile.toLowerCase(),
    tier: chosen.tier,
    groupName: chosen.groupName,
  };
}

// ==========================================================
// 🧪 Simulation Helper
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
    const pick = weightedRandomChoice(pool, TRAINER_RARITY_WEIGHTS);
    if (pick) counts[normalizeTier(pick.tier || pick.rarity)]++;
  }

  console.log("🎲 Simulated drop distribution:", counts);
  return counts;
}
