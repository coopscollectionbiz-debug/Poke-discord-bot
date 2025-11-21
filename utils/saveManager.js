// ==========================================================
// utils/saveManager.js — FINAL VERSION (Fix A)
// ==========================================================
// • NO schema rewriting
// • NO normalization
// • Saves exactly what is in memory
// • enqueueSave() is the ONLY local save
// • saveDataToDiscord() is optional cloud backup
// ==========================================================

import { enqueueSave } from "./saveQueue.js";

// ----------------------------------------------------------
// Simple legacy save (still supported)
// ----------------------------------------------------------
export async function saveTrainerData(trainerData) {
  try {
    await enqueueSave(trainerData);
    return true;
  } catch (err) {
    console.error("❌ saveTrainerData failed:", err);
    return false;
  }
}

// ----------------------------------------------------------
// atomicSave — local + Discord backup
// ----------------------------------------------------------
export async function atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord) {
  const errors = [];

  // 1️⃣ Local save
  try {
    await enqueueSave(trainerData);
  } catch (err) {
    const msg = `❌ Local save failed: ${err.message}`;
    console.error(msg);
    errors.push(msg);
  }

  // 2️⃣ Discord save
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
