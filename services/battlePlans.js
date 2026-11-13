// ==========================================================
// services/battlePlans.js — each fighting Team's Battle plan
// (CONTEXT.md "Battle plan"; full-sim spec, "Battle plans").
//
//   user.battlePlans = { display?: planId, battle?: planId }
// Team keys as in services/movesets.js: "display" is the Casual team,
// "battle" the Ranked team (Ranked and Wager battles). The Showcase team
// never fights, so it has no plan. Unset = All-out attack.
//
// Readiness counts only the moves each member really brings (its picked
// Moveset, else its default moves), and suggestions only ever suggest:
// nothing here changes a Moveset.
// ==========================================================

import { BATTLE_PLANS, DEFAULT_PLAN, isPlanId, moveRoles, planById, planReadiness } from "../catalog/battlePlans.js";
import { TEAM_TYPES, learnableMoves } from "./movesets.js";
import { buildTeam } from "../utils/battle/runBattle.js";
import { autoMoveset } from "../utils/battle/moveset.js";
import { getMove, getSpecies } from "../utils/battle/data.js";

export { BATTLE_PLANS, DEFAULT_PLAN };
export const PLAN_TEAMS = TEAM_TYPES; // ["display", "battle"]
const MAX_SUGGESTIONS = 3;

export function getPlan(user, team) {
  const id = user?.battlePlans?.[team];
  return isPlanId(id) ? id : DEFAULT_PLAN;
}

/** IN PLACE. → { ok: true, plan } | { ok: false, error } */
export function setPlan(user, team, planId) {
  if (!PLAN_TEAMS.includes(team)) return { ok: false, error: "That Team doesn't fight, so it has no Battle plan." };
  if (!isPlanId(planId)) return { ok: false, error: "Unknown Battle plan." };
  user.battlePlans ??= {};
  user.battlePlans[team] = planId;
  return { ok: true, plan: planId };
}

/** The Team's members with the moves each one brings into a fight. */
function teamMembers(user, team) {
  const opts = team === "battle" ? { team: user.battleTeam ?? [], movesetTeam: "battle", equipmentTeam: "battle" } : {};
  return buildTeam(user, opts).map((m) => ({ ...m, moves: m.moves ?? autoMoveset(m.speciesId, m.level) }));
}

/**
 * How the Team can get a move that helps `plan` by leveling up: the member
 * that already knows one (it just isn't in its Moveset), else the one that
 * learns one soonest. { name, move, moveName, level, known } or null.
 * Status TMs aren't sold yet (catalog/statusTmDraft.js), so only Levels count.
 */
function howToGet(members, plan) {
  let best = null;
  for (const m of members) {
    for (const [at, id] of getSpecies(m.speciesId)?.levelMoves ?? []) {
      if (!moveRoles(id).some((r) => plan.roles.includes(r))) continue;
      const gap = Math.max(0, at - m.level);
      if (!best || gap < best.gap) best = { gap, name: m.baseName ?? m.name, move: id, level: at, known: at <= m.level };
    }
  }
  if (!best) return null;
  return { name: best.name, move: best.move, moveName: getMove(best.move)?.name ?? best.move, level: best.level, known: best.known };
}

/** What the Teams page shows for one Team: its plan and readiness (with how to get ready when it isn't). */
export function teamPlanView(user, team) {
  const plan = getPlan(user, team);
  const members = teamMembers(user, team);
  const readiness = planReadiness(members, plan);
  return { team, plan, readiness: readiness.ready ? readiness : { ...readiness, howTo: howToGet(members, planById(plan)) } };
}

/**
 * A computer-run Pokémon's moves (full sim): nobody takes suggestions for
 * it, so its plan picks them. The most recent level-up move that helps the
 * plan, then its last attacks learned, four at most. All-out attack: its
 * last 4 attacks, as today.
 */
export function planMoves(speciesId, level, planId, env) {
  const plan = planById(planId) ?? planById(DEFAULT_PLAN);
  const attacks = autoMoveset(speciesId, level, env);
  if (!plan.roles.length) return attacks;
  const learned = getSpecies(speciesId, env).levelMoves.filter(([at]) => at <= level).map(([, id]) => id);
  const helper = learned.reverse().find((id) => moveRoles(id).some((r) => plan.roles.includes(r)));
  return helper ? [helper, ...attacks.filter((id) => id !== helper)].slice(0, 4) : attacks;
}

/**
 * Moves this Pokémon has learned that would help its Team's plan and that
 * it doesn't bring yet, best first (the most recently learned). Empty for
 * All-out attack. Taking one is the player's call (the Moveset editor).
 */
export function suggestions(user, team, speciesId, variant, { uid = null } = {}) {
  const plan = planById(getPlan(user, team));
  if (!plan?.roles.length) return [];
  const member = teamMembers(user, team).find((m) => m.speciesId === Number(speciesId) && m.variant === variant && (uid == null || m.copyUid === uid || m.uid === uid));
  const brought = new Set(member?.moves ?? []);
  return learnableMoves(user, speciesId, variant, { uid })
    .filter((m) => !brought.has(m.id) && getMove(m.id) && moveRoles(m.id).some((r) => plan.roles.includes(r)))
    .sort((a, b) => (b.learnedAt ?? 0) - (a.learnedAt ?? 0))
    .slice(0, MAX_SUGGESTIONS)
    .map((m) => m.id);
}
