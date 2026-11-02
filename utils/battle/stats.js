import { IV } from "./tuning.js";

// Gen 5 stat formula with a fixed IV and no EVs or natures.
export function computeStats(baseStats, level) {
  const core = (b) => Math.floor(((2 * b + IV) * level) / 100);
  return {
    hp: core(baseStats.hp) + level + 10,
    atk: core(baseStats.atk) + 5,
    def: core(baseStats.def) + 5,
    spa: core(baseStats.spa) + 5,
    spd: core(baseStats.spd) + 5,
    spe: core(baseStats.spe) + 5,
  };
}
