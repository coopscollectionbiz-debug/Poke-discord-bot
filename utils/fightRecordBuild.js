// ==========================================================
// utils/fightRecordBuild.js — Fight records from finished fights
// ==========================================================
//
// Pure builders: a Battle, Challenge or Trainer encounter outcome in, one
// Fight record out (docs/design/battle-records.md). Everything is copied
// as it was at fight time: names, trainer sprites, members with their
// Levels, moves and held items, and the simulator's whole result, so a
// replay never changes after a rename or a team edit.
//
// Record shape (v1):
//   { v, id, at, kind, group, season, players: [human ids],
//     sides: [{ id|null, name, trainer, key? }, …],  // [0] = Challenger / the player
//     fights: [{ foe?, members: [[A], [B]], result, surge }],
//     breaks?, winner: 0|1, rewards: { [userId]: {...} } }
// `result` is simulateBattle's: winner, turns, endedBy, knockouts, log,
// snapshots (and turnNotes from the effect engine).
//
// recordFight() wraps a builder so a bug here can never break a fight.
// ==========================================================

import { gzipSync, gunzipSync } from "zlib";
import { getMove } from "./battle/data.js";
import { memberMoves } from "./battle/sim.js";
import { RANKED } from "./battle/tuning.js";
import { withMegaStats } from "./battle/runBattle.js";
import { CHALLENGES, opponentName, displaySprite } from "./challenge/roster.js";
import { simulateChallenge } from "./challenge/runChallenge.js";
import { fightRecords, newFightId } from "./fightRecords.js";
import { simulateAsync, after } from "./battle/simPool.js";
import { planById } from "../catalog/battlePlans.js";

export const RECORD_VERSION = 1;

/** A record kind's group (the page's filter tabs and the 50-per-group limit). */
export const groupOf = (kind) =>
  ({ casual: "battles", ranked: "battles", wager: "battles", encounter: "encounters" })[kind] ?? "challenges";

const moveName = (id) => getMove(id)?.name ?? String(id);

/** One fighter as it fought. */
export function memberView(m) {
  return {
    speciesId: m.speciesId,
    variant: m.variant ?? "normal",
    name: m.name,
    level: m.level,
    ...(m.realLevel != null && m.realLevel !== m.level && { realLevel: m.realLevel }),
    moves: memberMoves(m).map(moveName),
    ...(m.item && { item: m.item }),
    ...(m.megaForm && { megaForm: m.megaForm, baseName: m.baseName ?? null }),
    ...(m.hpFraction != null && m.hpFraction !== 1 && { hpFraction: m.hpFraction }),
  };
}

// Full-sim (v2) results also keep their steps, end status and the raw
// Showdown log, gzipped (Node's zlib, base64) once it is over RAW_GZIP_OVER
// bytes. v1 results keep exactly the fields they always had.
export const RAW_GZIP_OVER = 16 * 1024;
const rawField = (raw) => {
  const text = raw.join("\n");
  return Buffer.byteLength(text) > RAW_GZIP_OVER ? { rawGz: gzipSync(text).toString("base64") } : { raw };
};
/** A stored result's raw Showdown log as lines (v2), or [] (v1). */
export const rawLines = (r) => r.raw ?? (r.rawGz ? gunzipSync(Buffer.from(r.rawGz, "base64")).toString().split("\n") : []);

export const resultView = (r) => ({
  winner: r.winner,
  turns: r.turns,
  endedBy: r.endedBy,
  knockouts: r.knockouts,
  log: r.log,
  snapshots: r.snapshots,
  ...(r.turnNotes && { turnNotes: r.turnNotes }),
  ...(r.v === 2 && { v: 2, steps: r.steps, endStatus: r.endStatus, ...rawField(r.raw ?? []) }),
});

// EXP rows as the expanded row shows them.
const expView = (rows) => (rows ?? []).map((g) => ({
  name: g.name, fromLevel: g.fromLevel, toLevel: g.toLevel, gained: g.gained,
  ...(g.learned?.length && { learned: g.learned }),
  ...(g.megaForm && { megaForm: g.megaForm }),
}));

// `plan`: the Battle plan a player's side played (full-sim fights only).
// The server shows it to that player alone (services/fightRecordsApi.js forViewer).
const playerSide = (userId, name, trainerData, plan = null) => ({
  id: String(userId),
  name: name || trainerData?.[userId]?.name || "Trainer",
  trainer: trainerData?.[userId]?.displayedTrainer ?? null,
  ...(planById(plan) && { plan: { id: plan, name: planById(plan).name } }),
});

const base = (kind, now) => ({ v: RECORD_VERSION, id: newFightId(), at: now.getTime(), kind, group: groupOf(kind) });

/**
 * A Battle (casual, ranked or wager) from runBattle's outcome.
 * `names`: display names by user id.
 */
export function battleRecord(outcome, names, trainerData, { now = new Date() } = {}) {
  const kind = outcome.mode === "open" ? "casual" : outcome.mode;
  const ids = outcome.sides.map((s) => String(s.userId));
  const rewards = {};
  for (const id of ids) {
    const won = outcome.winnerId === id;
    rewards[id] = {
      ...(outcome.rating?.[id] && { rating: outcome.rating[id] }),
      ...(kind === "wager" && { cc: won ? outcome.stake : -outcome.stake }),
      ...(outcome.exp?.[id] && { exp: expView(outcome.exp[id]) }),
    };
  }
  return {
    ...base(kind, now),
    season: kind === "casual" ? null : RANKED.season,
    players: ids,
    sides: ids.map((id, i) => playerSide(id, names?.[id], trainerData, outcome.sides[i].plan)),
    fights: [{
      members: outcome.sides.map((s) => s.members.map(memberView)),
      result: resultView(outcome.result),
      surge: outcome.surge ?? null,
    }],
    winner: outcome.result.winner,
    rewards,
  };
}

const foeOf = (o) => ({ key: o.key, name: opponentName(o), trainer: displaySprite(o) ?? null });
const sameResult = (a, b) => a.winner === b.winner && a.turns === b.turns && JSON.stringify(a.knockouts) === JSON.stringify(b.knockouts);

// An Elite Four outcome keeps the full result of its last fight only.
// The fights are deterministic (seed, frozen team, Revive picks), so the
// earlier ones are re-run here and accepted only if the re-run reaches
// the same last fight. Otherwise the earlier fights are marked missing.
// The re-run uses the engine the run fought on (outcome.engine; runs from
// before the full sim have none and fought on the legacy engine). A
// full-sim re-run goes to the sim worker, so this returns a Promise then.
function runFights(outcome) {
  const full = (f) => !!f.result;
  if (outcome.fights.every(full)) return outcome.fights.map((f) => ({ opponentKey: f.opponentKey, members: f.sides.map((s) => s.members), result: f.result, surge: f.surge }));
  const opponents = CHALLENGES.elite4.opponents.slice(0, outcome.fights.length);
  const last = outcome.fights.at(-1);
  const asRecorded = () => outcome.fights.map((f) => (full(f)
    ? { opponentKey: f.opponentKey, members: f.sides.map((s) => s.members), result: f.result, surge: f.surge }
    : { opponentKey: f.opponentKey, missing: true }));
  if (!Array.isArray(outcome.runTeam)) return asRecorded();
  const engine = outcome.engine ?? "legacy";
  const warn = (err) => { console.warn("⚠️ fight record: E4 re-run failed:", err?.message || err); return asRecorded(); };
  try {
    const sim = simulateChallenge({
      team: withMegaStats(outcome.runTeam),
      opponents,
      seed: outcome.seed,
      plan: outcome.plan,
      engine,
      pick: ({ next }) => outcome.breaks?.[opponents.indexOf(next) - 1]?.slot ?? null,
      ...(engine === "full" && { simulate: (input) => simulateAsync({ ...input, engine }) }),
    });
    const settled = after(sim, (s) => (s.fights.length === outcome.fights.length && sameResult(s.fights.at(-1).result, last.result)
      ? s.fights.map((f) => ({ opponentKey: f.opponentKey, members: [f.members, f.foes], result: f.result, surge: f.surge }))
      : asRecorded()));
    return typeof settled?.then === "function" ? settled.catch(warn) : settled;
  } catch (err) {
    return warn(err);
  }
}

/** A Challenge (Gym, Elite Four run, Blue, Red) from its final outcome. */
export function challengeRecord(outcome, playerName, trainerData, { now = new Date() } = {}) {
  const challenge = CHALLENGES[outcome.key];
  const userId = String(outcome.userId);
  const byKey = Object.fromEntries(challenge.opponents.map((o) => [o.key, o]));
  return after(runFights(outcome), (ran) => challengeRecordFrom(outcome, playerName, trainerData, now, challenge, userId, byKey, ran));
}

function challengeRecordFrom(outcome, playerName, trainerData, now, challenge, userId, byKey, ran) {
  const fights = ran.map((f) => {
    const foe = foeOf(byKey[f.opponentKey]);
    if (f.missing) return { foe, missing: true };
    return { foe, members: f.members.map((side) => side.map(memberView)), result: resultView(f.result), surge: f.surge ?? null };
  });
  const lead = challenge.opponents[0];
  const prize = outcome.prize;
  const prizeCc = prize ? prize.cc + prize.sprites.reduce((t, s) => t + (s.cc ?? 0), 0) : 0;
  return {
    ...base(challenge.kind, now),
    key: outcome.key,
    season: null,
    players: [userId],
    sides: [
      playerSide(userId, playerName, trainerData, outcome.engine === "full" ? outcome.plan : null),
      { id: null, key: outcome.key, name: challenge.kind === "elite4" ? "Elite Four" : opponentName(lead), trainer: displaySprite(lead) ?? null },
    ],
    fights,
    ...(outcome.breaks && { breaks: outcome.breaks }),
    winner: outcome.cleared ? 0 : 1,
    rewards: {
      [userId]: {
        cc: prize ? prizeCc : -(outcome.ccLost ?? 0),
        ...(prize && { prize: { cc: prize.cc, stones: prize.stones, dust: prize.dust, sprites: prize.sprites.filter((s) => s.file).map((s) => s.file) } }),
        ...(outcome.badge && { badge: outcome.badge }),
        ...(outcome.unlocked && { unlocked: outcome.unlocked }),
        exp: expView(outcome.exp?.[userId]),
      },
    },
  };
}

/** A Trainer encounter from fightEncounter's outcome. */
export function encounterRecord(outcome, playerName, trainerData, { now = new Date() } = {}) {
  const userId = String(outcome.userId);
  const t = outcome.trainer;
  return {
    ...base("encounter", now),
    season: null,
    players: [userId],
    sides: [
      playerSide(userId, playerName, trainerData, outcome.sides[0].plan),
      { id: null, key: t.classKey, name: `${t.title} ${t.name}`, trainer: t.spriteFile ?? null },
    ],
    fights: [{
      members: outcome.sides.map((s) => s.members.map(memberView)),
      result: resultView(outcome.result),
      surge: null,
    }],
    winner: outcome.result.winner,
    rewards: { [userId]: { cc: outcome.won ? outcome.prize : -outcome.paid, exp: expView(outcome.exp?.[userId]) } },
  };
}

/**
 * Builds and stores a record. Never throws and never waits on the write:
 * a failed build or write only logs a warning, so the fight stands.
 */
export function recordFight(build, { store = fightRecords } = {}) {
  const failed = (err) => {
    console.warn("⚠️ fight record build failed:", err?.message || err);
    return false;
  };
  try {
    const record = build(); // a Promise when an Elite Four re-run used the sim worker
    return typeof record?.then === "function" ? record.then((r) => store.add(r)).catch(failed) : store.add(record);
  } catch (err) {
    return Promise.resolve(failed(err));
  }
}
