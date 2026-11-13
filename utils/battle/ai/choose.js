// ==========================================================
// utils/battle/ai/choose.js — the Battle-plan AI (full-sim spec, "AI").
//
// makeChooser({ plan, skill, seed }) returns a chooser for
// showdown/engine.js drive(): each turn it scores every usable move and
// picks the best.
//   • An attack scores the share of the foe's HP it's expected to take
//     (utils/battle/ai/estimate.js), plus a bonus for a knockout.
//   • A status move scores a small general value when it would do
//     something, a large bonus when it's what the plan is for, and −1 when
//     it would fail or undo itself (Trick Room while Trick Room is up).
// Skill: Rookie strays to a random move 35% of the time; Solid 10%
// (MOVE_RANDOM_CHANCE); Expert never strays, and plays Solid's top 3 one
// turn ahead on copies of the battle, keeping the one that comes out best. The chooser's
// own random numbers never come from the battle, so choosing can't change
// the battle's rolls.
// ==========================================================

import { Battle, PRNG } from "@pkmn/sim";
import { moveRoles, DEFAULT_PLAN } from "../../../catalog/battlePlans.js";
import { installOverrides, nextSlotChoice, seedFor } from "../showdown/engine.js";
import { estimateDamage, speedOf, typeFactor } from "./estimate.js";
import { WEATHER_OF, weatherFor } from "./weather.js";
import { createRng } from "../rng.js";
import { MOVE_RANDOM_CHANCE } from "../tuning.js";

export const SKILLS = Object.freeze({
  rookie: { slip: 0.35, lookahead: false },
  solid: { slip: MOVE_RANDOM_CHANCE, lookahead: false },
  // Expert never strays: measured, that is most of its edge over Solid
  // (tools/bench-full-sim.mjs), and the lookahead adds a little more.
  expert: { slip: 0, lookahead: true },
});

const PLAN_BONUS = 0.6;
const KO_BONUS = 0.5;
const STATUS_IMMUNE = { par: ["Electric"], brn: ["Fire"], psn: ["Poison", "Steel"], tox: ["Poison", "Steel"], frz: ["Ice"] };

const alive = (side) => side.pokemon.filter((p) => !p.fainted);
const usable = (req) => req.active[0].moves.map((m, k) => ({ k, id: m.id, disabled: m.disabled })).filter((m) => !m.disabled);

/** The weather that helps this side's living Pokémon most (types and abilities), or null. */
export function teamWeather(side) {
  return weatherFor(alive(side).map((p) => ({ types: p.getTypes(), ability: p.ability })));
}

const meanSpeed = (side) => { const ps = alive(side); return ps.reduce((t, p) => t + p.storedStats.spe, 0) / Math.max(1, ps.length); };

function bestHitOn(b, attacker, defender) {
  return Math.max(0, ...attacker.moveSlots.map((s) => estimateDamage(b, attacker, defender, s.id)));
}

/** One move's score for this side right now. */
export function scoreMove(b, side, moveId, plan = DEFAULT_PLAN) {
  const me = b.sides[side].active[0];
  const foe = b.sides[1 - side].active[0];
  const myHp = me.hp / me.maxhp;
  const foeHp = foe && !foe.fainted ? foe.hp / foe.maxhp : 0;
  const roles = moveRoles(moveId);
  if (roles.includes("attack")) {
    const move = b.dex.moves.get(moveId);
    const est = estimateDamage(b, me, foe, moveId);
    let s = Math.min(est, foeHp);
    if (foeHp > 0 && est >= foeHp) s += KO_BONUS + (move.priority > 0 ? 0.2 : 0);
    return s;
  }
  const move = b.dex.moves.get(moveId);
  const bonus = (forPlan) => (plan === forPlan ? PLAN_BONUS : 0);
  const safe = foe ? bestHitOn(b, foe, me) < myHp / 2 : true;
  const foeSide = b.sides[1 - side];
  const mySide = b.sides[side];
  const values = roles.map((role) => {
    switch (role) {
      case "setup": {
        const maxed = Object.entries(move.boosts).every(([stat, v]) => v <= 0 || me.boosts[stat] >= 4);
        if (maxed) return -1;
        return safe ? 0.15 + bonus("setup") : -0.05;
      }
      case "status": {
        if (!foe || foe.fainted) return -1;
        if (move.status) {
          if (foe.status || STATUS_IMMUNE[move.status]?.some((t) => foe.hasType(t))) return -1;
          if (move.status === "par" && move.type === "Electric" && typeFactor(b, "Electric", me, foe) === 0) return -1;
          if (move.status === "slp" && foeSide.pokemon.some((p) => p.status === "slp")) return 0.05;
        } else if (foe.volatiles[move.volatileStatus] || (move.volatileStatus === "leechseed" && foe.hasType("Grass"))) return -1;
        return 0.25 + bonus("status");
      }
      case "hazard": {
        const set = foeSide.sideConditions[move.sideCondition];
        const full = set && (move.sideCondition === "spikes" ? set.layers >= 3 : move.sideCondition === "toxicspikes" ? set.layers >= 2 : true);
        if (full || alive(foeSide).length < 2) return -1;
        return 0.2 + bonus("hazards");
      }
      case "screen": {
        if (mySide.sideConditions[move.sideCondition]) return -1;
        if (move.id === "auroraveil" && !["snowscape", "hail"].includes(b.field.effectiveWeather())) return -1;
        return 0.15 + bonus("hazards") * 0.9;
      }
      case "weather": {
        const weather = WEATHER_OF[b.dex.toID(move.weather)];
        if (WEATHER_OF[b.field.effectiveWeather()] === weather) return -1;
        return 0.05 + (teamWeather(mySide) === weather ? bonus("weather") + 0.2 : 0);
      }
      case "speed": {
        const foeFaster = foe && speedOf(foe) > speedOf(me);
        if (move.id === "trickroom") {
          if (b.field.pseudoWeather.trickroom) return -1;
          const slowTeam = meanSpeed(mySide) < meanSpeed(foeSide);
          return foeFaster ? 0.1 + (slowTeam ? bonus("speed") + 0.3 : 0) : -0.5;
        }
        if (mySide.sideConditions.tailwind) return -1;
        return 0.1 + (meanSpeed(mySide) >= meanSpeed(foeSide) ? bonus("speed") + 0.1 : 0);
      }
      case "recovery":
        return myHp > 0.9 ? -1 : myHp < 0.5 ? 0.3 + bonus("status") * 0.5 : 0;
      case "protect":
        return me.volatiles.stall || me.lastMove?.stallingMove ? -0.5 : 0.02 + (plan === "status" && ["psn", "tox", "brn"].includes(foe?.status) ? 0.3 : 0);
      default:
        return 0;
    }
  });
  return values.length ? Math.max(...values) : 0;
}

/** Usable moves for a move request, best first: [{ k, id, score }]. */
export function rankMoves(req, b, side, plan) {
  return usable(req).map((m) => ({ ...m, score: scoreMove(b, side, m.id, plan) })).sort((x, y) => y.score - x.score || x.k - y.k);
}

// HP left on this side minus the foe's, plus half a point per Pokémon still standing.
const standing = (b, side) => {
  const total = (s) => s.pokemon.reduce((t, p) => t + p.hp / p.maxhp + (p.fainted ? 0 : 0.5), 0);
  return total(b.sides[side]) - total(b.sides[1 - side]);
};

const ROLLOUTS = 3;

// One turn of `candidate` on a copy of the battle, against the foe's Solid
// reply; returns how the standing changed. `rollSeed` sets the copy's
// random numbers, so every candidate faces the same rolls.
function rollout(state, b, side, candidate, rollSeed) {
  const copy = Battle.fromJSON(JSON.parse(state));
  installOverrides(copy);
  copy.prng = new PRNG(seedFor(rollSeed)); // the copy can't see the real battle's rolls
  const foeReq = copy.sides[1 - side].activeRequest;
  const reply = foeReq && !foeReq.wait && !foeReq.forceSwitch ? `move ${(rankMoves(foeReq, copy, 1 - side, DEFAULT_PLAN)[0]?.k ?? 0) + 1}` : "default";
  if (!copy.sides[side].choose(`move ${candidate.k + 1}`)) copy.sides[side].choose("default");
  if (foeReq && !foeReq.wait && !copy.sides[1 - side].choose(reply)) copy.sides[1 - side].choose("default");
  const turn = copy.turn;
  for (let n = 0; n < 8 && !copy.ended && copy.turn === turn; n++) {
    if (copy.allChoicesDone()) { copy.commitChoices(); continue; }
    copy.sides.forEach((s) => { const r = s.activeRequest; if (r?.forceSwitch && !s.isChoiceDone()) s.choose(nextSlotChoice(r)); });
  }
  return standing(copy, side) - standing(b, side);
}

// Solid's top candidates, each played one turn ahead ROLLOUTS times. A
// turn's HP swing can't show what a status or setup move is worth later,
// so each candidate keeps its plan score on top of the swing.
function lookahead(b, side, candidates, rng) {
  const state = JSON.stringify(b.toJSON());
  const seeds = Array.from({ length: ROLLOUTS }, () => rng.int(2 ** 31));
  let best = candidates[0], bestValue = -Infinity;
  for (const c of candidates) {
    const swing = seeds.reduce((t, seed) => t + rollout(state, b, side, c, seed), 0) / ROLLOUTS;
    const value = swing + c.score;
    if (value > bestValue) { best = c; bestValue = value; }
  }
  return best;
}

export function makeChooser({ plan = DEFAULT_PLAN, skill = "solid", seed = 1, slip } = {}) {
  const rng = createRng(seed);
  const level = SKILLS[skill] ?? SKILLS.solid;
  const slipChance = slip ?? level.slip;
  return (req, b, side) => {
    const ranked = rankMoves(req, b, side, plan);
    if (!ranked.length) return "default";
    if (rng.next() < slipChance) return `move ${ranked[rng.int(ranked.length)].k + 1}`;
    const pick = level.lookahead && ranked.length > 1 ? lookahead(b, side, ranked.slice(0, 3), rng) : ranked[0];
    return `move ${pick.k + 1}`;
  };
}
