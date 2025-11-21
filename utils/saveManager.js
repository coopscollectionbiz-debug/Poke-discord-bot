// ==========================================================
// utils/saveManager.js — AUTO-REPAIR (Option A, DisplayedPokemon Canonical)
// ==========================================================
// • Auto-repairs users safely
// • NO currentTeam anywhere
// • Uses displayedPokemon as canonical team field
// • Never rejects saves
// • 100% compatible with dashboard + commands
// ==========================================================

import { enqueueSave } from "./saveQueue.js";

// ----------------------------------------------------------
// 🧪 AUTO-REPAIR USER SCHEMA (REAL BOT SCHEMA)
// ----------------------------------------------------------
function normalizeUserForSave(userId, user) {
  if (!user || typeof user !== "object") return {};

  return {
    // Required numeric fields
    tp: typeof user.tp === "number" ? user.tp : 0,
    cc: typeof user.cc === "number" ? user.cc : 0,

    // Pokémon inventory (object)
    pokemon:
      user.pokemon && typeof user.pokemon === "object" && !Array.isArray(user.pokemon)
        ? user.pokemon
        : {},

    // Trainer list (array OR legacy object map)
    trainers: Array.isArray(user.trainers)
      ? user.trainers
      : Object.keys(user.trainers || {}),

    // Items
    items:
      user.items && typeof user.items === "object"
        ? user.items
        : { evolution_stone: 0 },

    // Purchases
    purchases: Array.isArray(user.purchases) ? user.purchases : [],

    // ⭐ CANONICAL TEAM FIELD (your real schema)
    displayedPokemon: Array.isArray(user.displayedPokemon)
      ? user.displayedPokemon
      : [],

    // Trainer icon
    displayedTrainer: user.displayedTrainer ?? null,

    // Date fields
    lastDaily:
      typeof user.lastDaily === "string" || typeof user.lastDaily === "number"
        ? user.lastDaily
        : 0,

    lastWeeklyPack:
      typeof user.lastWeeklyPack === "string" ? user.lastWeeklyPack : null,

    lastQuest:
      typeof user.lastQuest === "number" ? user.lastQuest : 0,

    lastRecruit:
      typeof user.lastRecruit === "number" ? user.lastRecruit : 0,

    // Onboarding (unchanged)
    onboardingComplete: !!user.onboardingComplete,
    onboardingDate: user.onboardingDate ?? null,
    starterPokemon: user.starterPokemon ?? null,

    // Luck system
    luck: typeof user.luck === "number" ? user.luck : 0,
    luckTimestamp: typeof user.luckTimestamp === "number" ? user.luckTimestamp : 0,
  };
}

// ----------------------------------------------------------
// AUTO-REPAIR VALIDATION (NEVER rejects)
// ----------------------------------------------------------
function validateTrainerData(data) {
  if (!data || typeof data !== "object") return false;
  if (Object.keys(data).length < 1) return false;

  // Auto-repair ALL users in place
  for (const [id, user] of Object.entries(data)) {
    data[id] = normalizeUserForSave(id, user);
  }

  return true;
}

// ----------------------------------------------------------
// Simple save (legacy) — still works
// ----------------------------------------------------------
export async function saveTrainerData(trainerData) {
  if (!validateTrainerData(trainerData)) {
    console.warn("❌ saveTrainerData refused invalid object");
    return false;
  }

  await enqueueSave(trainerData);
  return true;
}

// ----------------------------------------------------------
// NEW atomicSave — local + discord
// ----------------------------------------------------------
export async function atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord) {
  const errors = [];

  if (!validateTrainerData(trainerData)) {
    const msg = "❌ saveTrainerData refused invalid object";
    console.warn(msg);
    errors.push(msg);
    return { ok: false, errors };
  }

  try {
    await enqueueSave(trainerData);
  } catch (err) {
    const msg = `❌ Local save failed: ${err.message}`;
    console.error(msg);
    errors.push(msg);
  }

  try {
    if (saveDataToDiscord) {
      await saveDataToDiscord(trainerData);
    }
  } catch (err) {
    const msg = `❌ Discord save failed: ${err.message}`;
    console.error(msg);
    errors.push(msg);
  }

  return { ok: errors.length === 0, errors };
}
