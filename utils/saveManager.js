// ==========================================================
// utils/saveManager.js — FINAL SCHEMA-SAFE VERSION
// ==========================================================
// • Validates trainerData using CURRENT schema
// • No unnecessary hard failures
// • Calls saveQueue for disk writes
// • Compatible with all updated commands
// ==========================================================

import { enqueueSave } from "./saveQueue.js";

// ----------------------------------------------------------
// 🧪 UPDATED TRAINER DATA VALIDATION (schema-accurate)
// ----------------------------------------------------------
function validateTrainerData(data) {
  if (!data || typeof data !== "object") return false;
  if (Object.keys(data).length < 1) return false;

  for (const [id, user] of Object.entries(data)) {
    if (!user || typeof user !== "object") return false;

    // Required numeric fields
    if (typeof user.tp !== "number") return false;
    if (typeof user.cc !== "number") return false;

    // Pokémon inventory must be an object
    if (typeof user.pokemon !== "object" || Array.isArray(user.pokemon)) {
      return false;
    }

    // Trainers is now ALWAYS an array
    if (!Array.isArray(user.trainers)) return false;

    // Items must be object or missing (we allow missing)
    if (user.items && typeof user.items !== "object") return false;

    // Purchases must be array or missing
    if (user.purchases && !Array.isArray(user.purchases)) return false;

    // Displayed Pokémon (team) must be array
    if (user.displayedPokemon && !Array.isArray(user.displayedPokemon)) return false;

    // CurrentTeam must be array if present
    if (user.currentTeam && !Array.isArray(user.currentTeam)) return false;

    // Date fields: allow string, null, or undefined
    if (user.lastDaily && typeof user.lastDaily !== "string" && typeof user.lastDaily !== "number") {
      return false;
    }
    if (user.lastWeeklyPack && typeof user.lastWeeklyPack !== "string") {
      return false;
    }
    if (user.lastQuest && typeof user.lastQuest !== "number") return false;
    if (user.lastRecruit && typeof user.lastRecruit !== "number") return false;

    // Luck fields
    if (typeof user.luck !== "number") return false;
    if (typeof user.luckTimestamp !== "number") return false;
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
// NEW atomicSave (correct output for /adminsave)
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
