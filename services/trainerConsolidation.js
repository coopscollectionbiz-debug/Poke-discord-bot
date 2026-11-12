// ==========================================================
// services/trainerConsolidation.js
// Generation consolidation (owner-approved 2026-11-11): game and generation
// redraws of the same outfit fold into one sprite per group
// (data/sprites/trainer-consolidation.json; e.g. twins-gen3/-gen3rs/-gen4…
// → twins.png). Outfits never fold, and female variants are their own groups.
//
// Player migration (runs in normalizeUserSchema, idempotent):
//   • every owned folded file is removed;
//   • its target is granted if the player doesn't already own it
//     (owning cynthia-gen4.png → owns cynthia.png);
//   • a displayed trainer that folded becomes its target;
//   • one notice says what changed (shown on the dashboard and by /trainercard).
// No currency refunds: most trainers were collected before they could be bought.
// ==========================================================

import fs from "fs";
import { addNotice, NOTICE_KINDS } from "./notices.js";

const MAP_URL = new URL("../data/sprites/trainer-consolidation.json", import.meta.url);
let INTO = null;
/** { foldedFile(lowercase) → target file } */
export function consolidationMap() {
  if (!INTO) {
    const { into } = JSON.parse(fs.readFileSync(MAP_URL, "utf8"));
    INTO = new Map(Object.entries(into).map(([f, t]) => [f.toLowerCase(), t]));
  }
  return INTO;
}

/** The file a trainer sprite now lives under (itself when it didn't fold). */
export function canonicalTrainerFile(file) {
  if (typeof file !== "string") return file;
  return consolidationMap().get(file.trim().toLowerCase()) ?? file;
}

const label = (f) => String(f).replace(/\.png$/i, "");

/**
 * IN PLACE. Folds a player's owned and displayed trainers into their targets.
 * Returns { removed: [files], granted: [files], displayed: newFile|null } (empty when nothing changed).
 */
export function consolidateUserTrainers(user, { notice = true, now = Date.now() } = {}) {
  const out = { removed: [], granted: [], displayed: null };
  if (!user || !Array.isArray(user.trainers)) return out;
  const map = consolidationMap();
  const owned = new Set(user.trainers.map((t) => String(t).toLowerCase()));
  const next = [];
  for (const t of user.trainers) {
    const target = map.get(String(t).toLowerCase());
    if (!target) { next.push(t); continue; }
    out.removed.push(t);
    if (!owned.has(target.toLowerCase())) { owned.add(target.toLowerCase()); next.push(target); out.granted.push(target); }
  }
  if (out.removed.length) user.trainers = next;
  if (typeof user.displayedTrainer === "string") {
    const target = map.get(user.displayedTrainer.trim().toLowerCase());
    if (target) { user.displayedTrainer = target; out.displayed = target; }
  }
  if (notice && out.removed.length) {
    const kept = [...new Set(out.removed.map((f) => map.get(f.toLowerCase())))];
    const text = `Trainer collection update: older game versions of the same outfit now share one sprite. `
      + `${out.removed.length} of your trainer${out.removed.length === 1 ? "" : "s"} merged into ${kept.length} (${kept.slice(0, 6).map(label).join(", ")}${kept.length > 6 ? ", …" : ""}).`
      + (out.granted.length ? ` You now own ${out.granted.length === 1 ? label(out.granted[0]) : `${out.granted.length} of those`}.` : "")
      + (out.displayed ? ` Your displayed trainer is now ${label(out.displayed)}.` : "");
    addNotice(user, NOTICE_KINDS.TRAINER_CONSOLIDATION, text, now);
  }
  return out;
}
