import { getSpecies } from "./data.js";
import { computeStats } from "./stats.js";
import { SURGE } from "./tuning.js";

// Power rating: the sum of every Team member's stats at its Level.
export function teamPower(members) {
  return members.reduce((total, m) => {
    const s = computeStats(getSpecies(m.speciesId).baseStats, m.level);
    return total + s.hp + s.atk + s.def + s.spa + s.spd + s.spe;
  }, 0);
}

export function surgeChance(powerA, powerB) {
  const ratio = Math.max(powerA, powerB) / Math.min(powerA, powerB);
  if (ratio < SURGE.minRatio) return { underdog: null, chance: 0 };
  return { underdog: powerA < powerB ? 0 : 1, chance: Math.min(SURGE.maxChance, SURGE.perRatio * (ratio - 1)) };
}
