import { getSpecies } from "./data.js";
import { computeStats } from "./stats.js";
import { SURGE } from "./tuning.js";
import { createRng } from "./rng.js";

// Power rating: the sum of every Team member's stats at its Level.
export function teamPower(members) {
  return members.reduce((total, m) => {
    // A Mega battles with its Mega stats, so the underdog surge sees them (EXP doesn't: rewards.js uses the base species).
    const s = computeStats((m.battleProfile ?? getSpecies(m.speciesId)).baseStats, m.level);
    return total + s.hp + s.atk + s.def + s.spa + s.spd + s.spe;
  }, 0);
}

// One Pokémon's Power: its six-stat total at its Level (the same sum
// teamPower adds up per member). null when the species has no battle data.
export function pokemonPower(speciesId, level) {
  const species = getSpecies(Number(speciesId));
  if (!species?.baseStats || !Number.isFinite(Number(level))) return null;
  const s = computeStats(species.baseStats, Number(level));
  return s.hp + s.atk + s.def + s.spa + s.spd + s.spe;
}

// Power for every entry of a levels map ({ "25:normal": 16 } → { "25:normal": 160 }).
// Read-only; used by the dashboard's GET /api/user-pokemon for sorting.
export function powersFromLevels(levels) {
  const out = {};
  for (const [key, level] of Object.entries(levels ?? {})) {
    const p = pokemonPower(String(key).split(":")[0], level);
    if (p != null) out[key] = p;
  }
  return out;
}

export function surgeChance(powerA, powerB) {
  const ratio = Math.max(powerA, powerB) / Math.min(powerA, powerB);
  if (ratio < SURGE.minRatio) return { underdog: null, chance: 0 };
  return { underdog: powerA < powerB ? 0 : 1, chance: Math.min(SURGE.maxChance, SURGE.perRatio * (ratio - 1)) };
}

// The surge raises the Underdog's Levels until the gap is SURGE.residual.
// A fixed stat boost can't produce upsets at 5×+ gaps (most of that gap is
// Level: HP and the damage formula's Level term), so it scales with the gap.
// Uses the seed's first draw; the sim gets seed + 1.
export function rollSurge([powerA, powerB], seed) {
  const { underdog, chance } = surgeChance(powerA, powerB);
  if (underdog === null || createRng(seed).next() >= chance) return null;
  const ratio = Math.max(powerA, powerB) / Math.min(powerA, powerB);
  return { side: underdog, levelMult: Math.max(1, ratio / SURGE.residual) };
}
