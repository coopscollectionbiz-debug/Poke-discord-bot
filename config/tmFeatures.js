// ==========================================================
// config/tmFeatures.js — TM system feature flags (phase T3), read from the
// environment. Kept apart from config/features.js (Mega Evolution).
//
//   TM_SHOP_ENABLED   "1"/"true"/"yes"/"on" lists and sells TMs on the
//                     dashboard. Unset = OFF. Turning it off hides the shop
//                     and refuses purchases; owned TMs stay in the bag.
//   TM_WEEKLY_CAP     Optional whole number: most TMs one player may buy per
//                     ISO week (owner decision D-T7: the counter is always
//                     kept, the cap is OFF unless this is set).
// ==========================================================

const TRUE = new Set(["1", "true", "yes", "on"]);

/** Is the TM shop switched on? Default: false. */
export function isTmShopEnabled(env = process.env) {
  return TRUE.has(String(env.TM_SHOP_ENABLED ?? "").trim().toLowerCase());
}

/** Weekly TM purchase cap, or null when off (unset, malformed or < 1). */
export function tmWeeklyCap(env = process.env) {
  const raw = String(env.TM_WEEKLY_CAP ?? "").trim();
  if (!/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}
