// ==========================================================
// utils/saveManager.js  (FINAL VERSION — NO DISK WRITES HERE)
// ==========================================================
// • Validates data
// • Calls saveQueue to actually write
// • Optionally triggers Discord backup when needed
// ==========================================================

import { enqueueSave } from "./saveQueue.js";

// Validate data before saving
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

// Unified save API
export async function saveTrainerData(trainerData) {
  if (!validateTrainerData(trainerData)) {
    console.warn("❌ saveTrainerData refused invalid object");
    return false;
  }

  await enqueueSave(trainerData);

  return true;
}

// Backwards compatibility
export const atomicSave = saveTrainerData;
