// ==========================================================
// config/tmFeatures.js — TM system feature flags (phase T3), read from the
// environment. Kept apart from config/features.js (Mega Evolution).
//
//   TM_ENABLED        "1"/"true"/"yes"/"on" turns TMs on: the dashboard shop
//                     AND teaching (owner decision, T4: one switch, so TMs
//                     are never sold without a way to use them). Unset = OFF.
//                     Turning it off hides both; owned TMs and trained
//                     copies (with their moves) stay.
//   TM_WEEKLY_CAP     Optional whole number: most TMs one player may buy per
//                     ISO week (owner decision D-T7: the counter is always
//                     kept, the cap is OFF unless this is set).
// ==========================================================

const TRUE = new Set(["1", "true", "yes", "on"]);

/** Are TMs (shop + teaching) switched on? Default: false. */
export function isTmEnabled(env = process.env) {
  return TRUE.has(String(env.TM_ENABLED ?? "").trim().toLowerCase());
}

/** Weekly TM purchase cap, or null when off (unset, malformed or < 1). */
export function tmWeeklyCap(env = process.env) {
  const raw = String(env.TM_WEEKLY_CAP ?? "").trim();
  if (!/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}
