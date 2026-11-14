// ==========================================================
// utils/battle/ai/estimate.js — how much of the defender's max HP a move
// is expected to take, read from the live battle without touching it.
//
// It never calls the engine's own damage code, which runs events and draws
// random numbers: the AI must not change the battle it is deciding about.
// It is the Gen 9 damage formula over stored stats with boosts, types,
// STAB, weather, screens, burn and the common ability, item and
// fixed-damage cases, times the average roll, crit chance and accuracy.
// Being a little off on rare modifiers is fine: it only ranks moves.
// ==========================================================

import { DAMAGE_ROLL_MIN, CRIT_CHANCE, CRIT_MULT } from "../tuning.js";

const STAGE = [1, 1.5, 2, 2.5, 3, 3.5, 4];
export const boosted = (value, stage = 0) => (stage >= 0 ? value * STAGE[stage] : value / STAGE[-stage]);

const ABILITY_IMMUNE = {
  levitate: "Ground", flashfire: "Fire", wellbakedbody: "Fire", waterabsorb: "Water", stormdrain: "Water", dryskin: "Water",
  voltabsorb: "Electric", lightningrod: "Electric", motordrive: "Electric", sapsipper: "Grass", eartheater: "Ground",
};
const TYPE_ITEMS = {
  charcoal: "Fire", mysticwater: "Water", miracleseed: "Grass", magnet: "Electric", nevermeltice: "Ice", blackbelt: "Fighting",
  poisonbarb: "Poison", softsand: "Ground", sharpbeak: "Flying", twistedspoon: "Psychic", silverpowder: "Bug", hardstone: "Rock",
  spelltag: "Ghost", dragonfang: "Dragon", blackglasses: "Dark", metalcoat: "Steel", silkscarf: "Normal", fairyfeather: "Fairy",
};
const AVERAGE_ROLL = (1 + DAMAGE_ROLL_MIN) / 2;
const CRIT_FACTOR = 1 + CRIT_CHANCE * (CRIT_MULT - 1);

/** Type effectiveness of moveType against the defender (0 when immune, ability immunities included). */
export function typeFactor(b, moveType, attacker, defender) {
  const types = defender.getTypes();
  if (!b.dex.getImmunity(moveType, types)) return 0;
  if (ABILITY_IMMUNE[defender.ability] === moveType && attacker.ability !== "moldbreaker") return 0;
  const eff = 2 ** b.dex.getEffectiveness(moveType, types);
  return defender.ability === "wonderguard" && eff <= 1 ? 0 : eff;
}

/** Expected share of the defender's max HP this move takes (can exceed 1). */
export function estimateDamage(b, attacker, defender, moveId) {
  const move = b.dex.moves.get(moveId);
  if (!move.exists || move.category === "Status" || !defender || defender.fainted || !attacker) return 0;
  const eff = typeFactor(b, move.type, attacker, defender);
  if (eff === 0) return 0;
  const accuracy = move.accuracy === true ? 1 : move.accuracy / 100;
  if (move.ohko) return accuracy;
  if (move.damage === "level") return (accuracy * attacker.level) / defender.maxhp;
  if (typeof move.damage === "number") return (accuracy * move.damage) / defender.maxhp;

  const physical = move.category === "Physical";
  const offStat = move.overrideOffensiveStat ?? (physical ? "atk" : "spa");
  const defStat = move.overrideDefensiveStat ?? (physical ? "def" : "spd");
  const offender = move.overrideOffensivePokemon === "target" ? defender : attacker;
  let attack = boosted(offender.storedStats[offStat], offender.boosts[offStat]);
  if (physical && ["hugepower", "purepower"].includes(attacker.ability)) attack *= 2;
  const defense = Math.max(1, boosted(defender.storedStats[defStat], defender.boosts[defStat]));

  let power = move.basePower || 60; // variable-power moves (Gyro Ball, Low Kick…) count as a middling hit
  if (attacker.ability === "technician" && power <= 60) power *= 1.5;
  const base = Math.floor(Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * power * attack) / defense) / 50) + 2;

  let mod = eff;
  if (attacker.hasType(move.type)) mod *= attacker.ability === "adaptability" ? 2 : 1.5;
  const weather = b.field.effectiveWeather();
  if (["raindance", "primordialsea"].includes(weather)) mod *= move.type === "Water" ? 1.5 : move.type === "Fire" ? 0.5 : 1;
  if (["sunnyday", "desolateland"].includes(weather)) mod *= move.type === "Fire" ? 1.5 : move.type === "Water" ? 0.5 : 1;
  const foeSide = defender.side.sideConditions;
  if (foeSide.auroraveil || (physical && foeSide.reflect) || (!physical && foeSide.lightscreen)) mod *= 0.5;
  if (physical && attacker.status === "brn" && attacker.ability !== "guts") mod *= 0.5;
  if (TYPE_ITEMS[attacker.item] === move.type) mod *= 1.2;
  if (attacker.item === "expertbelt" && eff > 1) mod *= 1.2;
  const hits = Array.isArray(move.multihit) ? (attacker.ability === "skilllink" ? move.multihit[1] : 3) : move.multihit ?? 1;

  return (base * mod * hits * AVERAGE_ROLL * CRIT_FACTOR * accuracy) / defender.maxhp;
}

/** A Pokémon's Speed in the battle as it stands: boosts, paralysis and Tailwind. */
export function speedOf(pokemon) {
  let spe = boosted(pokemon.storedStats.spe, pokemon.boosts.spe);
  if (pokemon.status === "par" && pokemon.ability !== "quickfeet") spe *= 0.5;
  if (pokemon.side.sideConditions.tailwind) spe *= 2;
  return spe;
}
