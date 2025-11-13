// ==========================================================
// weightedRandom.js
// Coop's Collection — Correct Weighted RNG System
// ==========================================================

import { getRank } from "./rankSystem.js";
import { rollForShiny } from "../shinyOdds.js";
import { getAllPokemon, getAllTrainers } from "./dataLoader.js";
import { addPokemonToUser, addTrainerToUser } from "./userData.js";

// ==========================================================
// BASE RARITY WEIGHTS (per-tier odds)
// ==========================================================
export const POKEMON_RARITY_WEIGHTS = {
  common: 54,
  uncommon: 30,
  rare: 10,
  epic: 4,
  legendary: 1.5,
  mythic: 0.5,
};

export const TRAINER_RARITY_WEIGHTS = {
  common: 54,
  uncommon: 30,
  rare: 10,
  epic: 4,
  legendary: 1.5,
  mythic: 0.5,
};

// ==========================================================
// RANK BUFFS (increase rare+ odds)
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
// NORMALIZE RARITY
// ==========================================================
function normalizeTier(value) {
  const t = String(value).toLowerCase();
  return ["common","uncommon","rare","epic","legendary","mythic"].includes(t)
    ? t
    : "common";
}

// ==========================================================
// STEP 1 — Pick a rarity based on:
//  • base weights
//  • rank buffs
//  • pokéball boosts
// ==========================================================
function pickRarity(user, ballBoost = null) {
  const rank = getRank(user.tp || 0);
  const buffs = RANK_WEIGHT_MULTIPLIERS[rank] || {};

  const weighted = {};

  for (const rarity in POKEMON_RARITY_WEIGHTS) {
    let w = POKEMON_RARITY_WEIGHTS[rarity];

    // Apply rank buffs (rare+)
    if (buffs[rarity]) w *= buffs[rarity];

    // Apply ball boosts
    if (ballBoost === "uncommonPlus") {
      if (rarity === "uncommon") w *= 2;
      if (rarity === "rare")     w *= 2;
      if (rarity === "epic")     w *= 1.5;
    }

    if (ballBoost === "rarePlus") {
      if (rarity === "rare")      w *= 3;
      if (rarity === "epic")      w *= 2.5;
      if (rarity === "legendary") w *= 2;
      if (rarity === "mythic")    w *= 2;
    }

    weighted[rarity] = w;
  }

  // Convert weights into a bag
  const bag = [];
  for (const r in weighted) {
    const count = Math.max(1, Math.floor(weighted[r]));
    for (let i = 0; i < count; i++) bag.push(r);
  }

  return bag[Math.floor(Math.random() * bag.length)];
}

// ==========================================================
// STEP 2 — Pick Pokémon from a chosen rarity
// ==========================================================
function pickPokemonOfRarity(rarity) {
  const pool = getAllPokemon().filter(
    p => normalizeTier(p.tier) === rarity
  );

  if (!pool.length) return null;

  return pool[Math.floor(Math.random() * pool.length)];
}

// ==========================================================
// STEP 3 — Finalize Pokémon reward
// ==========================================================
async function finalizePokemonReward(user, pokemon) {
  const shiny = rollForShiny();

  const reward = {
    type: "pokemon",
    id: pokemon.id,
    name: pokemon.name,
    rarity: pokemon.tier,
    shiny,
  };

  await addPokemonToUser(user.id, reward);
  return reward;
}

// ==========================================================
// PUBLIC FUNCTIONS
// ==========================================================

// ⭐ Normal random Pokémon (Pokéball)
export async function giveRandomPokemon(user) {
  const rarity = pickRarity(user, null);
  const pokemon = pickPokemonOfRarity(rarity);
  return finalizePokemonReward(user, pokemon);
}

// ⭐ Greatball — uncommon+ boosted
export async function giveGreatballPokemon(user) {
  const rarity = pickRarity(user, "uncommonPlus");
  const pokemon = pickPokemonOfRarity(rarity);
  return finalizePokemonReward(user, pokemon);
}

// ⭐ Ultraball — rare+ boosted
export async function giveUltraballPokemon(user) {
  const rarity = pickRarity(user, "rarePlus");
  const pokemon = pickPokemonOfRarity(rarity);
  return finalizePokemonReward(user, pokemon);
}

// ⭐ Guaranteed rarity (Starter Pack)
export async function giveRandomPokemonOfRarity(user, rarity) {
  const pokemon = pickPokemonOfRarity(normalizeTier(rarity));
  return finalizePokemonReward(user, pokemon);
}

// ⭐ Random trainer of guaranteed rarity
export async function giveRandomTrainerOfRarity(user, rarity) {
  const trainers = getAllTrainers();
  const pool = Object.entries(trainers).filter(
    ([, info]) => normalizeTier(info.tier) === normalizeTier(rarity)
  );

  if (!pool.length) return null;

  // Pick random trainer entry
  const [key, info] = pool[Math.floor(Math.random() * pool.length)];

  // Pick a random sprite
  const sprite =
    Array.isArray(info.sprites) && info.sprites.length
      ? info.sprites[Math.floor(Math.random() * info.sprites.length)]
      : `${key}.png`;

  const result = {
    type: "trainer",
    key,
    name: key,
    rarity: info.tier,
    spriteFile: sprite,
  };

  await addTrainerToUser(user.id, result);
  return result;
}

// ==========================================================
// Starter Pack — 3 Pokémon + 1 Rare Trainer
// ==========================================================
export async function giveStarterPack(user) {
  const c = await giveRandomPokemonOfRarity(user, "common");
  const u = await giveRandomPokemonOfRarity(user, "uncommon");
  const r = await giveRandomPokemonOfRarity(user, "rare");

  const trainer = await giveRandomTrainerOfRarity(user, "rare");

  return {
    pokemon: [c, u, r],
    trainer,
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