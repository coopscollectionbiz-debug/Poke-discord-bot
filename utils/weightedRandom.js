// ==========================================================
// weightedRandom.js
// Coop's Collection — Correct Weighted RNG System (ASYNC SAFE)
// FULL VERSION — NO TRUNCATION
// ==========================================================

import { getRank } from "./rankSystem.js";
import { rollForShiny } from "../shinyOdds.js";
import { getAllPokemon, getAllTrainers } from "./dataLoader.js";
import { loadUserFromFile, saveUserToFile } from "./userSchema.js";

// ==========================================================
// User Modification Helpers
// ==========================================================
async function addPokemonToUser(userId, reward) {
  const user = await loadUserFromFile(userId);
  if (!user.pokemon) user.pokemon = [];

  user.pokemon.push({
    id: reward.id,
    name: reward.name,
    rarity: reward.rarity,
    shiny: reward.shiny,
    timestamp: Date.now()
  });

  await saveUserToFile(userId, user);
}

async function addTrainerToUser(userId, reward) {
  const user = await loadUserFromFile(userId);
  if (!user.trainers) user.trainers = [];

  user.trainers.push({
    key: reward.key,
    name: reward.name,
    rarity: reward.rarity,
    spriteFile: reward.spriteFile,
    timestamp: Date.now()
  });

  await saveUserToFile(userId, user);
}

// ==========================================================
// BASE WEIGHTS
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
// RANK BUFFS
// ==========================================================
export const RANK_WEIGHT_MULTIPLIERS = {
  "Novice Trainer":       { rare: 1.0, epic: 1.0, legendary: 1.0, mythic: 1.0 },
  "Junior Trainer":       { rare: 1.1, epic: 1.1, legendary: 1.05, mythic: 1.0 },
  "Skilled Trainer":      { rare: 1.2, epic: 1.25, legendary: 1.1, mythic: 1.05 },
  "Experienced Trainer":  { rare: 1.3, epic: 1.35, legendary: 1.15, mythic: 1.1 },
  "Advanced Trainer":     { rare: 1.4, epic: 1.45, legendary: 1.2, mythic: 1.1 },
  "Expert Trainer":       { rare: 1.5, epic: 1.55, legendary: 1.25, mythic: 1.15 },
  "Veteran Trainer":      { rare: 1.6, epic: 1.65, legendary: 1.3, mythic: 1.2 },
  "Elite Trainer":        { rare: 1.7, epic: 1.8, legendary: 1.35, mythic: 1.25 },
  "Master Trainer":       { rare: 1.8, epic: 1.9, legendary: 1.4, mythic: 1.3 },
  "Gym Leader":           { rare: 1.9, epic: 2.0, legendary: 1.45, mythic: 1.35 },
  "Elite Four Member":    { rare: 2.0, epic: 2.2, legendary: 1.5, mythic: 1.4 },
  "Champion":             { rare: 2.2, epic: 2.4, legendary: 1.6, mythic: 1.5 },
  "Legend":               { rare: 2.4, epic: 2.6, legendary: 1.75, mythic: 1.6 },
};

// ==========================================================
// Normalize Tier
// ==========================================================
function normalizeTier(value) {
  const t = String(value).toLowerCase();
  return ["common","uncommon","rare","epic","legendary","mythic"].includes(t)
    ? t : "common";
}

// ==========================================================
// Weighted rarity selection
// ==========================================================
function pickRarity(user, ballBoost = null) {
  const rank = getRank(user.tp || 0);
  const buffs = RANK_WEIGHT_MULTIPLIERS[rank] || {};
  const weighted = {};

  for (const rarity in POKEMON_RARITY_WEIGHTS) {
    let w = POKEMON_RARITY_WEIGHTS[rarity];

    // Rank buffs applied to rare+
    if (buffs[rarity]) w *= buffs[rarity];

    if (ballBoost === "uncommonPlus") {
      if (["uncommon","rare","epic"].includes(rarity)) w *= 2;
    }

    if (ballBoost === "rarePlus") {
      if (["rare","epic","legendary","mythic"].includes(rarity)) w *= 2.5;
    }

    weighted[rarity] = w;
  }

  const bag = [];
  for (const r in weighted) {
    const count = Math.max(1, Math.floor(weighted[r]));
    for (let i = 0; i < count; i++) bag.push(r);
  }

  return bag[Math.floor(Math.random() * bag.length)];
}

// ==========================================================
// Pick Pokémon (ASYNC SAFE NOW)
// ==========================================================
async function pickPokemonOfRarity(rarity) {
  const all = await getAllPokemon();
  const pool = all.filter(p => normalizeTier(p.tier) === rarity);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ==========================================================
// Finalize Pokémon
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
// Public Pokémon acquisition functions
// ==========================================================
export async function giveRandomPokemon(user) {
  const rarity = pickRarity(user);
  const pokemon = await pickPokemonOfRarity(rarity);
  return finalizePokemonReward(user, pokemon);
}

export async function giveGreatballPokemon(user) {
  const rarity = pickRarity(user, "uncommonPlus");
  const pokemon = await pickPokemonOfRarity(rarity);
  return finalizePokemonReward(user, pokemon);
}

export async function giveUltraballPokemon(user) {
  const rarity = pickRarity(user, "rarePlus");
  const pokemon = await pickPokemonOfRarity(rarity);
  return finalizePokemonReward(user, pokemon);
}

export async function giveRandomPokemonOfRarity(user, rarity) {
  const pokemon = await pickPokemonOfRarity(normalizeTier(rarity));
  return finalizePokemonReward(user, pokemon);
}

// ==========================================================
// Trainer RNG (ASYNC SAFE)
// ==========================================================
export async function giveRandomTrainerOfRarity(user, rarity) {
  const trainers = await getAllTrainers();

  const pool = trainers.filter(
    t => normalizeTier(t.rarity) === normalizeTier(rarity)
  );

  if (!pool.length) return null;

  const t = pool[Math.floor(Math.random() * pool.length)];

  const sprite = Array.isArray(t.sprites) && t.sprites.length
    ? t.sprites[Math.floor(Math.random() * t.sprites.length)]
    : t.filename || t.sprite || `${t.name}.png`;

  const reward = {
    type: "trainer",
    key: t.name,
    name: t.name,
    rarity: t.rarity,
    spriteFile: sprite,
  };

  await addTrainerToUser(user.id, reward);
  return reward;
}

// ==========================================================
// Starter Pack
// ==========================================================
export async function giveStarterPack(user) {
  return {
    pokemon: [
      await giveRandomPokemonOfRarity(user, "common"),
      await giveRandomPokemonOfRarity(user, "uncommon"),
      await giveRandomPokemonOfRarity(user, "rare"),
    ],
    trainer: await giveRandomTrainerOfRarity(user, "rare"),
  };
}
