// ==========================================================
// utils/render/teamView.js
// The read-only view model behind team images: a player's Team exactly as
// battles use it (buildTeam: slot order, owned variants only), plus the
// display facts each slot needs. Pure: never mutates the player record.
//
// Only data the game really has is exposed. The game has no nicknames,
// abilities, natures, IVs/EVs, held items or persistent HP/status (see
// docs/design/VISUAL-UX-AUDIT.md), so none are invented here.
// ==========================================================

import fs from "fs";
import { buildTeam } from "../battle/runBattle.js";
import { getSpecies, getMove } from "../battle/data.js";
import { computeStats } from "../battle/stats.js";
import { autoMoveset } from "../battle/moveset.js";
import { teamPower } from "../battle/power.js";
import { getTraining, expForLevel } from "../training.js";
import { LEVEL_CAP } from "../battle/tuning.js";
import { getRank } from "../rankSystem.js";
import { TYPE_ID_TO_NAME } from "../battle/data.js";
import { displaySpeciesName } from "./names.js";

const POKEMON = JSON.parse(fs.readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));

/** EXP progress through the current Level, 0..1 (1 at the Level cap). */
export function expProgress(exp, level) {
  if (level >= LEVEL_CAP) return 1;
  const lo = expForLevel(level), hi = expForLevel(level + 1);
  return hi > lo ? Math.max(0, Math.min(1, (exp - lo) / (hi - lo))) : 0;
}

/** One slot's display facts, from species data and the player's training. */
export function slotView(user, member, index) {
  const { speciesId: id, variant, level } = member;
  const entry = POKEMON[id] ?? {};
  const species = getSpecies(id);
  const types = species?.types ?? (entry.types ?? []).map((t) => TYPE_ID_TO_NAME[t]).filter(Boolean);
  const { exp } = getTraining(user, id, variant);
  const stats = species ? computeStats(species.baseStats, level) : null;
  return {
    slot: index + 1,
    id,
    name: displaySpeciesName(id, entry.name ?? member.name),
    variant,
    shiny: variant === "shiny",
    level,
    expFrac: expProgress(exp, level),
    types,
    tier: String(entry.tier ?? "common").toLowerCase(),
    region: entry.region ?? null,
    generation: entry.generation ?? null,
    stats,
    statTotal: stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : null,
    moves: species ? autoMoveset(id, level).map((m) => getMove(m)?.name ?? m) : [],
  };
}

/**
 * The whole team image's data.
 * - members: the battle Team (owned slots, in order)
 * - fallback: true when the player has no Team and the image shows the
 *   first owned Pokémon instead (the current /showteam behavior, kept)
 */
export function buildTeamView(user, { displayName = "Trainer", trainerFile = null } = {}) {
  let members = buildTeam(user ?? {});
  let fallback = false;
  if (!members.length) {
    // Same rule as today's /showteam: first six owned species, normal variant.
    const owned = Object.keys(user?.pokemon ?? {})
      .filter((k) => /^\d+$/.test(k) && (user.pokemon[k]?.normal ?? 0) > 0)
      .map(Number).slice(0, 6);
    members = owned.map((id) => ({ speciesId: id, variant: "normal", name: POKEMON[id]?.name, level: getTraining(user, id, "normal").level }));
    fallback = members.length > 0;
  }
  const slots = members.map((m, i) => slotView(user, m, i));
  const known = members.filter((m) => getSpecies(m.speciesId));
  return {
    displayName,
    rank: getRank(user?.tp ?? 0) ?? "Unranked", // getRank is null under 100 TP; no rank name is invented
    tp: Math.floor(user?.tp ?? 0),
    trainerFile: trainerFile ?? user?.displayedTrainer ?? null,
    battle: user?.battle ? { rating: user.battle.rating ?? null, wins: user.battle.wins ?? 0, losses: user.battle.losses ?? 0 } : null,
    power: known.length ? teamPower(known) : 0,
    slots,
    fallback,
  };
}
