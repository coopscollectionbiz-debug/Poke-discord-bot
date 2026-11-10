// ==========================================================
// services/pokemonDetail.js — B2: one Pokémon's details for the dashboard
// (Collection drawer / sheet). Read-only: never writes player data.
//
// Built from the same functions as the Discord cards (utils/render/teamView
// slotView: stats at Level, auto moveset, EXP progress; utils/battle stats
// and movesets), so the dashboard and Discord can never disagree.
// ==========================================================

import { getSpeciesEntry, isGenerationLive } from "../utils/speciesCatalog.js";
import { getSpecies, getMove, TYPE_ID_TO_NAME } from "../utils/battle/data.js";
import { computeStats } from "../utils/battle/stats.js";
import { autoMoveset, movesLearned } from "../utils/battle/moveset.js";
import { getTraining } from "../utils/training.js";
import { slotView } from "../utils/render/teamView.js";
import { displaySpeciesName } from "../utils/render/names.js";
import { RANKED } from "../utils/battle/tuning.js";
import { megasOfSpecies } from "../utils/megas.js";
import { unlockedForms, megaLineKey } from "./megaUnlocks.js";
import { isMegaCapabilityEnabled } from "../config/features.js";
import { toTeamObj } from "../utils/economyRules.js";
import { learnableMoves, chosenMoves, moveInfo as movesetMoveInfo } from "./movesets.js";

const sum = (s) => (s ? s.hp + s.atk + s.def + s.spa + s.spd + s.spe : null);
const nameOf = (id) => displaySpeciesName(id, getSpeciesEntry(id)?.name);
const moveInfo = (m) => { const x = getMove(m); return x ? { id: m, name: x.name, type: x.type ?? null, power: x.power ?? null } : { id: m, name: String(m), type: null, power: null }; };

/** Where this copy sits on each team: { display: 2, battle: null } (1-based slots). */
function teamSlots(user, id, variant) {
  const at = (raw) => {
    const i = (Array.isArray(raw) ? raw : []).map(toTeamObj).findIndex((t) => t && t.id === id && t.variant === variant);
    return i < 0 ? null : i + 1;
  };
  return { display: at(user?.displayedPokemon), battle: at(user?.battleTeam) };
}

/**
 * @returns {{ status: number, body: object }}
 *   404 when the species is unknown, or not in a live generation and not owned.
 */
export function pokemonDetail(user, speciesId, { env = process.env } = {}) {
  const id = Number(speciesId);
  const entry = Number.isInteger(id) ? getSpeciesEntry(id) : null;
  if (!entry) return { status: 404, body: { error: "Unknown Pokémon." } };
  const counts = { normal: Number(user?.pokemon?.[id]?.normal) || 0, shiny: Number(user?.pokemon?.[id]?.shiny) || 0 };
  if (!isGenerationLive(entry.generation) && counts.normal + counts.shiny === 0) return { status: 404, body: { error: "Unknown Pokémon." } };
  const species = getSpecies(id);

  // Each owned copy: real Level, EXP progress, stats and moves there (the
  // same slotView as /showteam and /inspectpokemon), plus its Lv 50
  // (ranked) stats, team slots and the next moves it will learn.
  const copies = {};
  for (const variant of ["normal", "shiny"]) {
    if (!counts[variant]) continue;
    const level = getTraining(user, id, variant).level;
    const v = slotView(user, { speciesId: id, variant, level }, 0);
    const stats50 = species?.baseStats ? computeStats(species.baseStats, RANKED.level) : null;
    copies[variant] = {
      count: counts[variant],
      level,
      expFrac: v.expFrac,
      stats: v.stats,
      power: v.statTotal,
      stats50,
      power50: sum(stats50),
      moves: species ? autoMoveset(id, level).map(moveInfo) : [], // the automatic moveset (slotView uses the same function)
      // Chosen movesets per team (null = automatic) and every move it may equip.
      movesets: {
        display: chosenMoves(user, "display", id, variant)?.map(movesetMoveInfo) ?? null,
        battle: chosenMoves(user, "battle", id, variant)?.map(movesetMoveInfo) ?? null,
      },
      learnable: species ? learnableMoves(user, id, variant, { level }).map((m) => ({ ...movesetMoveInfo(m.id), learnedAt: m.learnedAt, source: m.source })) : [],
      nextMoves: species ? movesLearned(id, level, Math.min(100, level + 20)).map(moveInfo) : [],
      teams: teamSlots(user, id, variant),
    };
  }

  // Mega forms belong to their Pokémon (never Pokédex entries); listed only
  // while Mega Evolution teams are switched on.
  const megaForms = isMegaCapabilityEnabled("team", env)
    ? megasOfSpecies(id).map((f) => ({
      id: f.id,
      name: f.name,
      unlocked: { normal: unlockedForms(user, megaLineKey(id, "normal")).includes(f.id), shiny: unlockedForms(user, megaLineKey(id, "shiny")).includes(f.id) },
    }))
    : [];

  return {
    status: 200,
    body: {
      id,
      name: nameOf(id),
      types: species?.types ?? (entry.types ?? []).map((t) => TYPE_ID_TO_NAME[t]).filter(Boolean),
      tier: String(entry.tier ?? "common").toLowerCase(),
      region: entry.region ?? null,
      generation: entry.generation ?? null,
      flavor: entry.flavor ?? null,
      evolvesFrom: (entry.evolvesFrom ?? []).map((e) => ({ id: e, name: nameOf(e) })),
      evolvesTo: (entry.evolvesTo ?? []).filter((e) => getSpeciesEntry(e) && isGenerationLive(getSpeciesEntry(e).generation)).map((e) => ({ id: e, name: nameOf(e) })),
      baseStats: species?.baseStats ?? null,
      baseTotal: sum(species?.baseStats),
      owned: counts,
      copies,
      megaForms,
    },
  };
}
