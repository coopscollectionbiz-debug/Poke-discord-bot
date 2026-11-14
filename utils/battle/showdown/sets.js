// ==========================================================
// utils/battle/showdown/sets.js — one Team member as a Showdown set.
//
// Every set is named `s<slot>` (its Team slot; engine.js explains why).
// IVs are all 15 and EVs 0 with a neutral nature, which gives exactly our
// stat formula (utils/battle/stats.js). A Mega slot fights as its Showdown
// forme from turn 1, with the Mega's own ability. HP and status carried
// between Elite Four fights are applied by applyCarryOver once the sides
// exist, before anything is logged.
// ==========================================================

import { Dex } from "@pkmn/sim";
import { getSpecies } from "../data.js";
import { getMega } from "../../megas.js";
import { getHeldItemDef } from "../../../catalog/heldItems.js";
import { memberMoves } from "../sim.js";
import { IV } from "../tuning.js";

const dex = Dex.forFormat("gen9customgame");
const flat = (v) => ({ hp: v, atk: v, def: v, spa: v, spd: v, spe: v });

/** Our held-item id as the engine's item name, or "" when it has no battle effect (Lucky Egg). */
export function showdownItem(id) {
  const name = id ? getHeldItemDef(id)?.name : null;
  return name && dex.items.get(name).exists ? name : "";
}

/** The species' first regular ability (Battle plans pick a better one in utils/battle/ai). */
export const firstAbility = (speciesName) => dex.species.get(speciesName).abilities["0"];

/**
 * The member's Showdown set, or null if it starts fainted (it never comes in).
 * levelMult and statMult are the Underdog surge's; member.statMult (a
 * Challenge opponent's boost) multiplies with it.
 */
export function memberSet(member, { slot, levelMult = 1, statMult = 1, ability, env = process.env } = {}) {
  if (member.hpFraction !== undefined && member.hpFraction <= 0) return null;
  const profile = member.battleProfile ?? null;
  const species = profile ? getMega(profile.formId)?.showdownName ?? getSpecies(member.speciesId, env).name : getSpecies(member.speciesId, env).name;
  const mult = (member.statMult ?? 1) * statMult;
  return {
    name: `s${slot}`,
    species,
    level: Math.min(100, Math.round(member.level * levelMult)),
    moves: memberMoves(member, env),
    ability: profile?.ability ?? ability ?? firstAbility(species),
    item: showdownItem(member.item),
    nature: "Hardy",
    gender: "",
    evs: flat(0),
    ivs: flat(IV),
    ...(mult !== 1 && { statMult: mult }),
  };
}

/**
 * HP and major status carried into this fight (Elite Four), set directly on
 * the engine's Pokémon before the battle starts so the first switch-in
 * already shows them. setStatus() can't be used: it refuses Pokémon that
 * aren't on the field yet. Sleep gets a fresh 1–3 turn counter (Showdown's
 * own range) and badly poisoned restarts at its first stage.
 */
export function applyCarryOver(b, side, members) {
  for (const p of b.sides[side].pokemon) {
    const m = members[Number(p.name.slice(1))];
    if (m.hpFraction !== undefined && m.hpFraction < 1) p.hp = Math.max(1, Math.round(p.maxhp * m.hpFraction));
    if (m.status) {
      p.status = m.status;
      p.statusState = b.initEffectState({ id: m.status, target: p });
      if (m.status === "slp") p.statusState.startTime = p.statusState.time = b.random(2, 5);
      if (m.status === "tox") p.statusState.stage = 0;
    }
  }
}
