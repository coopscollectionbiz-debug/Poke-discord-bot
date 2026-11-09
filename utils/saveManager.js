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
    // enqueueSave resolves false when the write failed (it is retried).
    return (await enqueueSave(trainerData)) !== false;
  } catch (err) {
    console.error("❌ saveTrainerData failed:", err);
    return false;
  }
}

// ----------------------------------------------------------
// atomicSave — local save only (Discord backup handled by 1-minute interval)
// ----------------------------------------------------------
export async function atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord) {
  const errors = [];

  try {
    // enqueueSave resolves false (never throws) when the disk write failed;
    // the data stays in memory and the save keeps retrying in the background.
    const saved = await enqueueSave(trainerData);
    if (saved === false) {
      const msg = "❌ Local save failed (retrying in background; data is still in memory)";
      console.error(msg);
      errors.push(msg);
    }
  } catch (err) {
    const msg = `❌ Local save failed: ${err.message}`;
    console.error(msg);
    errors.push(msg);
  }
  return { ok: errors.length === 0, errors };
}
