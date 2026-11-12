// ==========================================================
// utils/battle/items.js — the held-item effect registry.
//
// One entry per held item id (catalog/heldItems.js). The battle engine
// (utils/battle/effects.js) calls these hooks at fixed points; no item id is
// checked anywhere else in battle code. Numbers follow Pokémon Showdown
// (Gen 9 rules), using its 4096-based modifiers.
//
// Hook context (see effects.js): { fx, self, foe, attacker, target, move,
// mt (move type), eff, physical, damage, hpBefore, rng }.
//   onBasePower(c)            → multiplier on the holder's move power
//   onModifyAttack(c)         → multiplier on the holder's Atk or Sp. Atk
//   onModifyDefense(c)        → multiplier on the holder's Def or Sp. Def (when hit)
//   onFinalDamage(c)          → multiplier on the holder's final damage
//   onModifyAccuracy(c)       → multiplier on the accuracy of moves aimed at the holder
//   onFractionalPriority(c)   → true = moves first within its priority bracket (draws rng)
//   onTryKO(c)                → { text } = survive this hit with 1 HP (may draw rng)
//   onAfterHPDrop(c)          → after the holder loses HP and is still standing
//   onAfterMove(c)            → after the holder's move (drain/recoil done)
//   onResidual(c)             → end of turn
//   expMultiplier             → battle EXP multiplier for the holder (not combat)
//   oncePerBattle             → after it triggers, it does nothing until the next battle
//
// Random draws happen ONLY when a holder is involved, so battles without
// items consume exactly the same random numbers as before.
// ==========================================================

import { getHeldItemDef } from "../../catalog/heldItems.js";
import fs from "fs";

const SHOWDOWN = "Pokémon Showdown data (@pkmn/dex), Gen 9 rules";
const POKEDATA = JSON.parse(fs.readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));
export const Q = (n) => n / 4096;
/** Can this species still evolve? (Eviolite) Uses the battling species, never a Mega profile. */
export const canEvolve = (speciesId) => Array.isArray(POKEDATA[speciesId]?.evolvesTo) && POKEDATA[speciesId].evolvesTo.length > 0;

const nameOf = (id) => getHeldItemDef(id)?.name ?? id;
const typeBooster = (type) => ({ onBasePower: (c) => (c.mt === type ? Q(4915) : 1) });
const survive = (id) => (c) => ({ text: `${c.self.name} hung on using its ${nameOf(id)}!` });

export const ITEM_REGISTRY = Object.freeze({
  // ---------------- starter unlocks ----------------
  leftovers: {
    onResidual: (c) => c.fx.healItem(c.self, Math.floor(c.self.maxHp / 16), `${c.self.name} restored a little HP using its Leftovers!`),
  },
  sitrus_berry: {
    oncePerBattle: true,
    onAfterHPDrop: (c) => {
      if (c.self.hp > c.self.maxHp / 2) return false;
      c.fx.healItem(c.self, Math.floor(c.self.maxHp / 4), `${c.self.name} ate its Sitrus Berry and restored HP!`, { force: true });
      return true; // used
    },
  },
  focus_sash: {
    oncePerBattle: true,
    onTryKO: (c) => (c.hpBefore === c.self.maxHp ? survive("focus_sash")(c) : null),
  },
  focus_band: {
    onTryKO: (c) => (c.rng.next() < 0.1 ? survive("focus_band")(c) : null),
  },
  quick_claw: {
    onFractionalPriority: (c) => c.rng.next() < 0.2,
    quickText: (mon) => `${mon.name}'s Quick Claw let it move first!`,
  },
  expert_belt: { onFinalDamage: (c) => (c.eff > 1 ? Q(4915) : 1) },
  bright_powder: { onModifyAccuracy: () => Q(3686) },
  lucky_egg: { expMultiplier: 1.5 },

  // ---------------- shop unlocks ----------------
  eviolite: { onModifyDefense: (c) => (canEvolve(c.self.speciesId) ? 1.5 : 1) },
  shell_bell: {
    onAfterMove: (c) => {
      if (c.damage > 0) c.fx.healItem(c.self, Math.floor(c.damage / 8), `${c.self.name} restored a little HP using its Shell Bell!`);
    },
  },
  black_sludge: {
    onResidual: (c) => {
      if (c.self.types.includes("Poison")) c.fx.healItem(c.self, Math.floor(c.self.maxHp / 16), `${c.self.name} restored a little HP using its Black Sludge!`);
      else c.fx.damage(c.self, Math.max(1, Math.floor(c.self.maxHp / 8)), `${c.self.name} is hurt by its Black Sludge!`);
    },
  },
  muscle_band: { onBasePower: (c) => (c.physical ? Q(4505) : 1) },
  wise_glasses: { onBasePower: (c) => (!c.physical ? Q(4505) : 1) },
  light_ball: { onModifyAttack: (c) => (c.self.speciesId === 25 ? 2 : 1) },
  thick_club: { onModifyAttack: (c) => ([104, 105].includes(c.self.speciesId) && c.physical ? 2 : 1) },
  charcoal: typeBooster("Fire"),
  mystic_water: typeBooster("Water"),
  miracle_seed: typeBooster("Grass"),
  magnet: typeBooster("Electric"),
  never_melt_ice: typeBooster("Ice"),
  black_belt: typeBooster("Fighting"),
  poison_barb: typeBooster("Poison"),
  soft_sand: typeBooster("Ground"),
  sharp_beak: typeBooster("Flying"),
  twisted_spoon: typeBooster("Psychic"),
  silver_powder: typeBooster("Bug"),
  hard_stone: typeBooster("Rock"),
  spell_tag: typeBooster("Ghost"),
  dragon_fang: typeBooster("Dragon"),
  black_glasses: typeBooster("Dark"),
  metal_coat: typeBooster("Steel"),
  silk_scarf: typeBooster("Normal"),
  fairy_feather: typeBooster("Fairy"),
});

export const ITEM_SOURCE = SHOWDOWN;
export const getItemEffect = (id) => (typeof id === "string" && Object.prototype.hasOwnProperty.call(ITEM_REGISTRY, id) ? ITEM_REGISTRY[id] : null);

/** Does this item do anything in combat? (Lucky Egg doesn't.) */
export const isCombatItem = (id) => {
  const e = getItemEffect(id);
  return !!e && Object.keys(e).some((k) => k.startsWith("on"));
};

/** The battle EXP multiplier for a member's item (1 when none). */
export const expMultiplierFor = (id) => getItemEffect(id)?.expMultiplier ?? 1;
