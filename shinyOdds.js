// helpers/shinyOdds.js
// ==========================================================
// 🧠 Universal shiny rate scaling based on total TP
// ==========================================================
export function getShinyOdds(tp = 0, baseOdds = 500) {
  // You can tweak baseOdds for different acquisition methods if desired
  if (tp >= 250000) return 1 / 250;
  if (tp >= 175000) return 1 / 280;
  if (tp >= 100000) return 1 / 300;
  if (tp >= 50000)  return 1 / 320;
  if (tp >= 25000)  return 1 / 340;
  if (tp >= 17500)  return 1 / 360;
  if (tp >= 10000)  return 1 / 380;
  if (tp >= 7500)   return 1 / 400;
  if (tp >= 5000)   return 1 / 420;
  if (tp >= 2500)   return 1 / 440;
  if (tp >= 1000)   return 1 / 460;
  if (tp >= 500)    return 1 / 480;
  return 1 / baseOdds;
}

// ==========================================================
// 🪄 Shiny roll helper
// ==========================================================
export function rollForShiny(tp = 0, baseOdds = 500) {
  const shinyChance = getShinyOdds(tp, baseOdds);
  return Math.random() < shinyChance;
}