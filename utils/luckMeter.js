// ==========================================================
// utils/luckMeter.js: the random-reward pity meter (was /luck; now a row on
// the private /trainercard). Each chat or reaction without a random reward
// raises user.luck; a reward resets it. Read-only.
// ==========================================================

export const LUCK_BASE = 0.02; // 2%
export const LUCK_CAP = 0.12; // 12%

/** { chance, bonus } in percent with one decimal, and fill 0..1 of the meter. */
export function luckSummary(user) {
  const luck = Math.max(0, Number(user?.luck) || 0);
  const final = Math.min(LUCK_CAP, LUCK_BASE + luck);
  return { chance: Math.round(final * 1000) / 10, bonus: Math.round(luck * 1000) / 10, fill: final / LUCK_CAP };
}
