// ==========================================================
// utils/render/trainerTier.js
// A player's displayed trainer's tier (trainerSprites.json), for the tier
// backdrop and the colours that match it on cards and battle images, plus
// the kill switch for the trainer effects added to those images.
//
// Only players get a tier: a Gym Leader's or an encounter Trainer's sprite
// can be a collectible with a tier of its own, so callers pass tiers for
// the player's side only and never look one up for a computer-run opponent.
// ==========================================================

import { readFileSync } from "fs";

let byFile = null;
function index() {
  if (byFile) return byFile;
  byFile = new Map();
  try {
    const data = JSON.parse(readFileSync(new URL("../../trainerSprites.json", import.meta.url), "utf8"));
    for (const entry of Object.values(data ?? {})) {
      const tier = String(entry?.tier ?? "common").toLowerCase();
      for (const s of Array.isArray(entry?.sprites) ? entry.sprites : []) {
        const file = typeof s === "string" ? s : s?.file;
        if (!file) continue;
        const key = file.toLowerCase().replace(/\.(png|gif)$/i, "");
        if (!byFile.has(key)) byFile.set(key, tier);
      }
    }
  } catch {
    // No tiers: every trainer reads as common (no backdrop).
  }
  return byFile;
}

/** The tier ("common" … "mythic") of a trainer sprite file, or null when unknown or none. */
export function trainerTier(file) {
  if (!file) return null;
  const key = String(file).split(/[\\/]/).pop().toLowerCase().replace(/\.(png|gif)$/i, "");
  return index().get(key) ?? null;
}

/**
 * CARD_TRAINER_FX=0 turns off what this feature added to cards and battle
 * images: tier backdrops on the /challenge, encounter and /battle VS cards
 * and playback rows, animated trainers there, and the /battle VS card. The
 * soft platforms and the GIF banding fix stay (they only change how a still
 * image is drawn). On by default.
 */
export const cardTrainerFx = (env = process.env) => env.CARD_TRAINER_FX !== "0";
