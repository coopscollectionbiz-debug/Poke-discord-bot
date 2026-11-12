// ==========================================================
// utils/trainerCosts.js
// Shop price of a trainer sprite by tier. bot_final.js charges these in
// /api/unlock-trainer; /challenge pays half when a prize sprite is owned.
// ==========================================================

export const TRAINER_COSTS = {
  common: 2500,
  uncommon: 7500,
  rare: 15000,
  epic: 35000,
  legendary: 75000,
  mythic: 150000,
};
