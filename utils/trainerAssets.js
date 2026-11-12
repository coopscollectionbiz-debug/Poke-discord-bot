// ==========================================================
// utils/trainerAssets.js
// One place that decides which image a trainer sprite is shown as:
//   • the idle GIF (public/sprites/trainers_idle/<name>.gif) when
//     data/sprites/trainer-idles.json lists the file as "ok": generated
//     breathing, or a real animation (animation: "real",
//     data/sprites/trainer-animations.json), or
//   • the static PNG (trainers_2/) otherwise, and always for grayscale
//     (unowned) views.
// TRAINERS_ANIMATED=0 turns every trainer back to the static PNG.
//
// Player data is untouched: displayedTrainer / trainers[] keep storing the
// .png file name; this only maps that name to a URL.
// ==========================================================

import fs from "fs";
import { spritePaths } from "../spriteconfig.js";

let manifest = null;
function idles() {
  if (!manifest) {
    try {
      manifest = JSON.parse(fs.readFileSync(new URL("../data/sprites/trainer-idles.json", import.meta.url), "utf8")).files ?? {};
    } catch (err) {
      console.warn("⚠️ trainer idle manifest unavailable; trainers stay static:", err?.message || err);
      manifest = {};
    }
  }
  return manifest;
}

let partsData = null;
/** Part-motion events for a sprite file (data/sprites/trainer-parts.json), or []. */
export function trainerParts(file) {
  if (!partsData) {
    try {
      partsData = JSON.parse(fs.readFileSync(new URL("../data/sprites/trainer-parts.json", import.meta.url), "utf8")).sprites ?? {};
    } catch {
      partsData = {};
    }
  }
  return (file && partsData[file]?.events) || [];
}

const slash = (s) => (s.endsWith("/") ? s : `${s}/`);
export const trainersAnimated = (env = process.env) => env.TRAINERS_ANIMATED !== "0";

/** The idle record for a sprite file name ("lass-gen4.png"), or null. */
export function trainerIdle(file) {
  const rec = file ? idles()[file] : null;
  return rec?.status === "ok" ? rec : null;
}

/**
 * URL to show a trainer sprite file with.
 * @param file      sprite file name as stored on players, e.g. "lass-gen4.png"
 * @param animated  false forces the static PNG
 * @param grayscale true → the static grayscale PNG (unowned views)
 */
export function trainerImageUrl(file, { animated = true, grayscale = false, env = process.env } = {}) {
  if (!file) return null;
  if (grayscale) return `${slash(spritePaths.trainersGray)}${file}`;
  const idle = animated && trainersAnimated(env) ? trainerIdle(file) : null;
  return idle ? `${slash(spritePaths.trainersIdle)}${idle.gif}` : `${slash(spritePaths.trainers)}${file}`;
}

export function resetTrainerIdlesForTesting(next = null) {
  manifest = next;
}
