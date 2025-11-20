// ==========================================================
// utils/saveManager.js  (FINAL VERSION — NO DISK WRITES HERE)
// ==========================================================
// • Validates data
// • Calls saveQueue to actually write
// • Optionally triggers Discord backup when needed
// ==========================================================

import { enqueueSave } from "./saveQueue.js";

// ----------------------------------------------------------
// Validation
// ----------------------------------------------------------
function validateTrainerData(data) {
  if (!data || typeof data !== "object") return false;
  if (Object.keys(data).length < 1) return false;

  for (const user of Object.values(data)) {
    if (typeof user.tp !== "number") return false;
    if (typeof user.cc !== "number") return false;
    if (typeof user.pokemon !== "object") return false;
    if (!user.trainers || typeof user.trainers !== "object") return false;
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

  // Validate data
  if (!validateTrainerData(trainerData)) {
    const msg = "❌ saveTrainerData refused invalid object";
    console.warn(msg);
    errors.push(msg);
    return { ok: false, errors };
  }

  try {
    // Local save via queue
    await enqueueSave(trainerData);
  } catch (err) {
    const msg = `❌ Local save failed: ${err.message}`;
    console.error(msg);
    errors.push(msg);
  }

  try {
    // Optional cloud save
    if (saveDataToDiscord) {
      await saveDataToDiscord(trainerData);
    }
  } catch (err) {
    const msg = `❌ Discord save failed: ${err.message}`;
    console.error(msg);
    errors.push(msg);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
