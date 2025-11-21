// ==========================================================
// utils/saveManager.js — AUTO-REPAIR VERSION (Option B)
// ==========================================================
// • Validates AND auto-repairs trainerData
// • Never rejects due to old schema fields
// • Fully compatible with ALL commands
// ==========================================================

import { enqueueSave } from "./saveQueue.js";

// ----------------------------------------------------------
// 🧪 AUTO-REPAIR USER SCHEMA
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

    // Trainer list (array)
    trainers: Array.isArray(user.trainers) ? user.trainers : [],

    // Items (object)
    items: user.items && typeof user.items === "object" ? user.items : {},

    // Purchases (array)
    purchases: Array.isArray(user.purchases) ? user.purchases : [],

    // TEAM MIGRATION:
    // displayedPokemon → currentTeam (one-time auto conversion)
    currentTeam: Array.isArray(user.currentTeam)
      ? user.currentTeam
      : Array.isArray(user.displayedPokemon)
        ? user.displayedPokemon
        : [],

    // Legacy field removed
    // displayedPokemon is intentionally discarded

    // Date fields (string/number/null allowed)
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

    // Luck system normalization
    luck: typeof user.luck === "number" ? user.luck : 0,
    luckTimestamp: typeof user.luckTimestamp === "number" ? user.luckTimestamp : 0,
  };
}

// ----------------------------------------------------------
// AUTO-REPAIR VALIDATION
// ----------------------------------------------------------
function validateTrainerData(data) {
  if (!data || typeof data !== "object") return false;
  if (Object.keys(data).length < 1) return false;

  // We NEVER reject users — we auto-repair them
  for (const [id, user] of Object.entries(data)) {
    data[id] = normalizeUserForSave(id, user);
  }

  return true;
}

// ----------------------------------------------------------
// Simple save (legacy)
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
// NEW atomicSave
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
