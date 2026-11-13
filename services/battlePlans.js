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
// Moveset, else its default moves), and recommended moves only ever
// recommend: nothing here changes a Moveset.
// ==========================================================

import {
  BATTLE_PLANS, DEFAULT_PLAN, isPlanId, moveRoles, planById, planReadiness,
  moveHelps, teamWeatherOf, weatherAbility, averageBaseSpeed, isSlow, betterAttackStats, setupSuits,
} from "../catalog/battlePlans.js";
import { TEAM_TYPES, MAX_MOVES, learnableMoves } from "./movesets.js";
import { buildTeam } from "../utils/battle/runBattle.js";
import { autoMoveset } from "../utils/battle/moveset.js";
import { getMove, getSpecies } from "../utils/battle/data.js";
import { boosted } from "../utils/battle/ai/estimate.js";
import { WEATHER_OF } from "../utils/battle/ai/weather.js";

export { BATTLE_PLANS, DEFAULT_PLAN };
export const PLAN_TEAMS = TEAM_TYPES; // ["display", "battle"]

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
  const weather = plan.id === "weather" ? teamWeatherOf(members) : null;
  // What to add is advice, like the Recommended tag: a setup move that suits
  // the Pokémon, not one the AI would merely play with what it brings now.
  const worth = (id, m) => (plan.id === "setup" ? moveRoles(id).includes("setup") && setupSuits(m.speciesId, id) : moveHelps(id, m, plan, weather));
  let best = null;
  for (const m of members) {
    for (const [at, id] of getSpecies(m.speciesId)?.levelMoves ?? []) {
      if (!worth(id, m)) continue;
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

const isSlot = (speciesId, variant, uid) => (m) => m.speciesId === Number(speciesId) && m.variant === variant && (uid == null || m.copyUid === uid || m.uid === uid);

/**
 * What the Moves editor's "Use recommended moves" fills in for this Team
 * slot: recommendMoves over every move the copy has learned, with its
 * teammates as they fight now. → { moves, helper }. Saving is the player's call.
 */
export function recommended(user, team, speciesId, variant, { uid = null } = {}) {
  const members = teamMembers(user, team);
  const self = members.find(isSlot(speciesId, variant, uid));
  const mates = members.filter((m) => m !== self).map((m) => ({ speciesId: m.speciesId, moves: m.moves }));
  const ids = learnableMoves(user, speciesId, variant, { uid }).map((m) => m.id).filter((id) => getMove(id));
  return recommendMoves(Number(speciesId), ids, getPlan(user, team), { mates });
}

// Recommended moves' scoring. Like utils/battle/ai/estimate.js, a move whose
// power varies or is fixed counts as a middling hit and a 2–5 hit move as 3
// hits. A move that recharges or charges first takes two turns, so it counts
// half; one that faints its user or usually fails is left out.
const VARIABLE_POWER = 60;
const MULTI_HIT_AVERAGE = 3;
const TWO_TURN = new Set(["recharge", "charge"]);
const LEFT_OUT = new Set(["selfKO", "conditional"]);
// A new type is picked before a second attack of a type already picked, as
// long as it's at least this share of the best attack's score.
const NEW_TYPE_SHARE = 0.5;

const newest = (ids) => ids.at(-1) ?? null; // learned order: the last is the newest
// The one move for the plan, as the AI would use it (utils/battle/ai/choose.js),
// or null. ids are in learned order; mates: [{ speciesId, moves }].
function planHelper(speciesId, ids, plan, mates, env) {
  const helping = ids.filter((id) => moveRoles(id).some((r) => plan.roles.includes(r)));
  if (!helping.length) return null;
  const notBrought = (id) => !mates.some((m) => m.moves.includes(id));
  switch (plan.id) {
    case "setup": {
      // A move that raises the attacking stat it's better at (either, when even),
      // else, for a slow Pokémon, one that raises Speed. Calm Mind on a physical
      // attacker raises nothing it hits with, and the AI plays Agility only
      // against a faster foe, which a fast Pokémon rarely meets.
      const raises = (id, list) => list.some((s) => getMove(id, env).boosts?.[s] > 0);
      return newest(helping.filter((id) => raises(id, betterAttackStats(speciesId, env))))
        ?? (isSlow(speciesId, env) ? newest(helping.filter((id) => raises(id, ["spe"]))) : null);
    }
    case "hazards": {
      // Different hazards and screens stack, so only the same move is doubled up.
      const open = helping.filter(notBrought);
      return newest(open.filter((id) => moveRoles(id).includes("hazard"))) ?? newest(open);
    }
    case "weather": {
      // The Team's weather, unless a teammate's move or anyone's ability sets it.
      const team = [{ speciesId, moves: [] }, ...mates];
      const weather = teamWeatherOf(team, env);
      if (!weather) return null;
      const setsIt = (m) => m.moves.some((id) => WEATHER_OF[id] === weather) || weatherAbility(m.speciesId, weather);
      return team.some(setsIt) ? null : newest(helping.filter((id) => WEATHER_OF[id] === weather));
    }
    case "speed": {
      // One setter is enough: Trick Room for a Team slower than the average Pokémon, else Tailwind.
      if (mates.some((m) => m.moves.some((id) => moveRoles(id).includes("speed")))) return null;
      const team = [speciesId, ...mates.map((m) => m.speciesId)];
      const slow = team.reduce((t, id) => t + getSpecies(id, env).baseStats.spe, 0) / team.length < averageBaseSpeed(env);
      const wanted = slow ? "trickroom" : "tailwind";
      return helping.includes(wanted) ? wanted : newest(helping);
    }
    default:
      return newest(helping);
  }
}

/**
 * Recommended moves from `ids` (moves it has learned, in learned order) for
 * plan `planId`: the plan's move first when it has one the plan would use,
 * then its strongest attacks, new types first. Its own types, the attacking
 * stat it's better at (raised by the plan's move), accuracy, hits and
 * drawbacks count. mates: its teammates as [{ speciesId, moves }].
 * → { moves: 1–4 ids, helper: id | null }
 */
export function recommendMoves(speciesId, ids, planId, { mates = [], env = process.env } = {}) {
  const plan = planById(planId) ?? planById(DEFAULT_PLAN);
  const species = getSpecies(speciesId, env);
  const known = ids.filter((id) => getMove(id, env));
  const helper = plan.roles.length ? planHelper(speciesId, known, plan, mates, env) : null;
  const boosts = helper ? getMove(helper, env).boosts ?? {} : {};
  const score = (id) => {
    const m = getMove(id, env);
    const stat = m.category === "Physical" ? "atk" : "spa";
    const stab = species.types.includes(m.type) ? 1.5 : 1;
    const accuracy = m.accuracy === true ? 1 : m.accuracy / 100;
    const hits = Array.isArray(m.multihit) ? MULTI_HIT_AVERAGE : m.multihit ?? 1;
    const stage = Math.max(-6, Math.min(6, boosts[stat] ?? 0));
    return (m.power || VARIABLE_POWER) * stab * accuracy * hits * boosted(species.baseStats[stat], stage) * (TWO_TURN.has(m.drawback) ? 0.5 : 1);
  };
  const byScore = (list) => list.map((id) => ({ id, score: score(id), type: getMove(id, env).type }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const attacks = known.filter((id) => getMove(id, env).category !== "Status");
  const ranked = byScore(attacks.filter((id) => !LEFT_OUT.has(getMove(id, env).drawback)));
  const slots = MAX_MOVES - (helper ? 1 : 0);
  const picked = [];
  const best = ranked[0]?.score ?? 0;
  for (const a of ranked) {
    if (picked.length < slots && a.score >= best * NEW_TYPE_SHARE && !picked.some((p) => p.type === a.type)) picked.push(a);
  }
  for (const a of ranked) if (picked.length < slots && !picked.includes(a)) picked.push(a);
  // Its only attacks are ones usually left out: the best of them beats none.
  if (!picked.length && attacks.length) picked.push(byScore(attacks)[0]);
  const moves = [...(helper ? [helper] : []), ...picked.map((a) => a.id)];
  return { moves: moves.length ? moves : known.slice(-MAX_MOVES), helper };
}
