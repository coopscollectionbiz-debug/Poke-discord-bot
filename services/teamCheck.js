// ==========================================================
// services/teamCheck.js — the Teams page's "Team check" (dashboard UX audit
// item 9). Read-only: a summary of a team as it would fight, built with the
// battle engine's own buildTeam, so Mega forms, chosen moves and trained
// copies count exactly as they do in a battle.
//
//   weaknesses  per attacking type: members hit ×2 or more, resisting, immune
//   headline    one sentence on the biggest shared weakness (or null)
//   moves       damaging move types and the Physical / Special / Status mix
//   speed       who moves first, at the Level the team fights at
//
// Type matchups only: abilities (Levitate and the like) are not counted.
// The draft team comes from the page, so unsaved edits show at once; only
// Pokémon the player owns are counted (buildTeam drops the rest).
// ==========================================================

import { buildTeam } from "../utils/battle/runBattle.js";
import { getSpecies, getMove, effectiveness } from "../utils/battle/data.js";
import { computeStats } from "../utils/battle/stats.js";
import { autoMoveset } from "../utils/battle/moveset.js";
import { RANKED } from "../utils/battle/tuning.js";

export const TYPES = Object.freeze(["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"]);
const TEAMS = { display: "display", battle: "battle" };
const MAX_SLOTS = 6;

/** Defending types that take ×½ or less from `attack` (the suggestion line). */
function resistersOf(attack) {
  return TYPES.filter((t) => effectiveness(attack, [t]) <= 0.5);
}

function cleanSlots(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_SLOTS) return null;
  const out = [];
  for (const s of raw) {
    const id = Number(s?.id);
    if (!Number.isInteger(id) || id < 1 || id > 10000) return null;
    const variant = s?.variant === "shiny" ? "shiny" : "normal";
    const slot = { id, variant };
    if (typeof s.mega === "string" && /^[a-z0-9-]{1,64}$/.test(s.mega)) slot.mega = s.mega;
    if (typeof s.uid === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s.uid)) slot.uid = s.uid;
    out.push(slot);
  }
  return out;
}

/**
 * @param {object} user
 * @param {{ team: "display"|"battle", slots: Array<{id, variant, mega?, uid?}> }} req
 * @returns {{ ok: true, check } | { ok: false, status, error }}
 */
export function teamCheck(user, { team, slots } = {}, { env = process.env } = {}) {
  const movesetTeam = TEAMS[team];
  if (!movesetTeam) return { ok: false, status: 400, error: "Unknown team" };
  const list = cleanSlots(slots);
  if (!list) return { ok: false, status: 400, error: "Invalid team" };
  const ranked = team === "battle";

  const members = buildTeam(user, { env, team: list, movesetTeam, equipmentTeam: movesetTeam }).map((m) => {
    const profile = m.battleProfile ?? getSpecies(m.speciesId);
    const level = ranked ? RANKED.level : m.level;
    const stats = computeStats(profile.baseStats, level);
    // Moves come from the real Level, also in Ranked (teams/moves.js).
    const moves = (m.moves ?? autoMoveset(m.speciesId, m.level)).map((id) => ({ id, ...(getMove(id) ?? {}) })).filter((x) => x.name);
    return { name: m.name, types: [...(profile.types ?? [])], level, realLevel: m.level, speed: stats.spe, moves };
  });

  const weaknesses = TYPES.map((attack) => {
    let weak = 0, resist = 0, immune = 0;
    for (const m of members) {
      const x = effectiveness(attack, m.types);
      if (x === 0) immune++;
      else if (x >= 2) weak++;
      else if (x <= 0.5) resist++;
    }
    return { type: attack, weak, resist, immune };
  });

  // The biggest shared weakness: most members weak, fewest covering it.
  const worst = [...weaknesses]
    .filter((w) => w.weak >= 2 && w.weak > w.resist + w.immune)
    .sort((a, b) => b.weak - a.weak || (a.resist + a.immune) - (b.resist + b.immune) || TYPES.indexOf(a.type) - TYPES.indexOf(b.type))[0];
  const covered = (w) => w.resist + w.immune;
  const headline = worst
    ? {
      type: worst.type,
      text: `${worst.weak} of ${members.length} are weak to ${worst.type}, and ${covered(worst) === 0 ? "none resist it" : `only ${covered(worst)} ${covered(worst) === 1 ? "resists" : "resist"} it`}.`,
      tryTypes: resistersOf(worst.type).filter((t) => !members.some((m) => m.types.includes(t))).slice(0, 3),
    }
    : null;

  const typeCounts = {};
  const mix = { Physical: 0, Special: 0, Status: 0 };
  for (const m of members) {
    for (const mv of m.moves) {
      if (mix[mv.category] != null) mix[mv.category]++;
      if (mv.category !== "Status" && mv.type) typeCounts[mv.type] = (typeCounts[mv.type] ?? 0) + 1;
    }
  }
  const moveTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type, count]) => ({ type, count }));
  // Defending types none of the team's damaging moves hit for ×2.
  const noSuperEffective = TYPES.filter((def) => !moveTypes.some((t) => effectiveness(t.type, [def]) >= 2));

  return {
    ok: true,
    check: {
      team,
      level: ranked ? RANKED.level : null,
      size: members.length,
      weaknesses,
      headline,
      moves: { types: moveTypes, mix, noSuperEffective },
      speed: members.map((m) => ({ name: m.name, speed: m.speed })).sort((a, b) => b.speed - a.speed || a.name.localeCompare(b.name)),
    },
  };
}
