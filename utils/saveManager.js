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
      const msg = "Local save failed (retrying in background; data is still in memory)";
      console.error(msg);
      errors.push(msg);
    }
  } catch (err) {
    const msg = `Local save failed: ${err.message}`;
    console.error(msg);
    errors.push(msg);
  }
  return { ok: errors.length === 0, errors };
}

// ----------------------------------------------------------
// Save acknowledgment (D-14 / D-29)
// ----------------------------------------------------------
// Player actions must never claim "saved" when the disk write failed.
// The change is NOT rolled back: it stays in memory and the queue keeps
// retrying, so a rollback would just diverge from what gets written.
// Instead, the reply tells the player it was saved with a delay.
export const SAVE_DELAYED_NOTE =
  "Saved with a delay: your change is kept and will be written shortly. If the bot restarts before then, it could be lost.";

/**
 * Save and report whether the change reached disk.
 * @param {object} trainerData
 * @param {{ save?: (data:object) => Promise<boolean> }} [opts] - injectable for tests
 * @returns {Promise<{ saved: boolean, note: string }>} note is "" when saved
 */
export async function saveAndAck(trainerData, { save = enqueueSave } = {}) {
  let saved = false;
  try {
    saved = (await save(trainerData)) === true;
  } catch (err) {
    console.error("❌ saveAndAck: save threw:", err?.message || err);
  }
  if (!saved) console.error("❌ Save not confirmed (data kept in memory; retrying in background)");
  return { saved, note: saved ? "" : SAVE_DELAYED_NOTE };
}

/** Append the delay note to a reply text when the save was not confirmed. */
export function withSaveNote(text, ack) {
  return ack?.note ? `${text}\n\n${ack.note}` : text;
}

/**
 * Fields every dashboard write reply carries (D14): `saved: true`, or
 * `saved: false` plus the "saved with a delay" notice.
 */
export function saveAckFields(ack) {
  return ack?.saved ? { saved: true } : { saved: false, saveNotice: ack?.note || SAVE_DELAYED_NOTE };
}
