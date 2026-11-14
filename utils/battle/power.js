import { getSpecies } from "./data.js";
import { computeStats } from "./stats.js";
import { SURGE, CUTE, RANKED } from "./tuning.js";
import { createRng } from "./rng.js";
import { cuteFactor } from "./cuteness.js";

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
  return powerOfStats(getSpecies(Number(speciesId))?.baseStats, level);
}

// Six-stat total of a stat profile (species or Mega battleProfile) at `level`.
export function powerOfStats(baseStats, level) {
  if (!baseStats || !Number.isFinite(Number(level))) return null;
  const s = computeStats(baseStats, Number(level));
  return s.hp + s.atk + s.def + s.spa + s.spd + s.spe;
}

// Power at the Ranked level (RANKED.level, 50) for every species in a levels
// map ({ "25:normal": 16, "25:shiny": 70 } → { "25": 427 }). Ranked and wager
// battles set every member to that Level (runBattle.js), so every copy of a
// species has the same Ranked Power. Read-only, for the dashboard.
export function powersAtRanked(levels) {
  const out = {};
  for (const key of Object.keys(levels ?? {})) {
    const id = String(key).split(":")[0];
    if (id in out) continue;
    const p = pokemonPower(id, RANKED.level);
    if (p != null) out[id] = p;
  }
  return out;
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
//
// `cuteness` is each side's Team Cuteness (utils/battle/cuteness.js). An
// Underdog over CUTE.threshold also rolls for the cute surge, on the seed's
// second draw, so every other battle stays the same seed for seed. A cute
// surge replaces today's and lifts the Team past the other one: runBattle
// sets its exact Levels and stat boost with cuteSurgeBoost. When the cute
// roll misses, the surge is today's, object for object.
export function rollSurge([powerA, powerB], seed, cuteness = [0, 0]) {
  const { underdog, chance } = surgeChance(powerA, powerB);
  if (underdog === null) return null;
  const rng = createRng(seed);
  const surges = rng.next() < chance;
  const ratio = Math.max(powerA, powerB) / Math.min(powerA, powerB);
  const k = cuteFactor(cuteness[underdog]);
  if (k > 0 && rng.next() < CUTE.chance * k) return { side: underdog, levelMult: ratio * CUTE.margin, statMult: 1, cute: true };
  if (!surges) return null;
  return { side: underdog, levelMult: Math.max(1, ratio / SURGE.residual) };
}

// A cute surge's lift for `members`: Levels first, then a stat boost for
// whatever Lv 100 leaves short, until their Power is `targetPower`. No cap.
// Power grows about evenly with Level, so the Level lift is the Power ratio.
export function cuteSurgeBoost(members, targetPower) {
  const levelMult = targetPower / teamPower(members);
  const lifted = members.map((m) => ({ ...m, level: Math.min(100, Math.round(m.level * levelMult)) }));
  return { levelMult, statMult: Math.max(1, targetPower / teamPower(lifted)) };
}
