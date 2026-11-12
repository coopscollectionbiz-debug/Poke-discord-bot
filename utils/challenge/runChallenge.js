// ==========================================================
// utils/challenge/runChallenge.js
// Runs one Challenge and applies every result to trainerData: EXP, the
// daily attempt, the first-win prize, and the 10% CC loss. The caller holds
// the player's lock and saves afterward; nothing here touches Discord.
// Challenges never touch user.battle (Battle rating, W/L, Battle caps).
// An interactive Elite Four run plays one fight per step (startRun,
// continueRun) and keeps its state on the record at challenge.run between steps.
// ==========================================================

import { randomUUID } from "crypto";
import { CHALLENGES, enabledSprites } from "./roster.js";
import { GYM_BADGES, earnedBadgeKeys } from "../../public/picker-pokemon/badges.js";
import { buildTeam, applyGains, withoutMegaStats, withMegaStats } from "../battle/runBattle.js";
import { simulateBattle } from "../battle/sim.js";
import { teamPower } from "../battle/power.js";
import { teamExp, utcDay } from "../battle/rewards.js";
import { CHALLENGE } from "../battle/tuning.js";
import { speciesName } from "../training.js";
import { TRAINER_COSTS } from "../trainerCosts.js";
import { trackProgress } from "../../progression/achievements.js";
import { ownsTrainer, grantTrainer } from "../../services/assets.js";
import { grantItem } from "../../services/inventory.js";

export const challengeLoss = (cc) => Math.floor((cc ?? 0) * CHALLENGE.lossShare);

export function getChallengeRecord(user, day) {
  user.challenge ??= { won: {}, day, attempts: 0 };
  user.challenge.won ??= {};
  if (user.challenge.day !== day) {
    user.challenge.day = day;
    user.challenge.attempts = 0;
  }
  return user.challenge;
}

export function isUnlocked(user, key) {
  const won = user.challenge?.won ?? {};
  if (key === "elite4") return GYM_BADGES.every((b) => b.key in won);
  if (key === "blue") return "elite4" in won;
  return true;
}

// Read-only: why this challenge can't happen right now, or null. /challenge
// runs it before the preview, and runChallenge re-runs it under the lock.
export function challengeBlock({ trainerData, userId, key, now = new Date() }) {
  const user = trainerData[userId];
  if (user?.challenge?.run) return "run_open";
  if (!user || !buildTeam(user).length) return "no_team";
  if (!isUnlocked(user, key)) return key === "elite4" ? "locked_elite4" : "locked_blue";
  const attempts = user.challenge?.day === utcDay(now) ? user.challenge.attempts : 0;
  if (attempts >= CHALLENGE.perDay) return "cap";
  // A wager's Stake is out of the balance until the offer ends, which would shield it from the loss.
  if (user.pendingWager) return "pending_wager";
  return null;
}

// The first enabled sprite the player doesn't own, or half its shop price in CC.
export function prizeSprite(user, trainerKey) {
  const { files, tier } = enabledSprites(trainerKey);
  const file = files.find((f) => !ownsTrainer(user, f));
  return file ? { trainerKey, file } : { trainerKey, cc: TRAINER_COSTS[tier] / 2 };
}

const prizeFor = (user, key) => ({
  ...CHALLENGES[key].prize,
  sprites: CHALLENGES[key].opponents.map((o) => prizeSprite(user, o.trainerKey)),
});

export function previewChallenge(user, key) {
  const firstWin = !(key in (user.challenge?.won ?? {}));
  return { firstWin, prize: firstWin ? prizeFor(user, key) : null, loss: challengeLoss(user.cc) };
}

// Opponents fight with CHALLENGE.statBoost on their stats, at the roster's Levels.
const opponentMembers = (o) =>
  o.team.map((m) => ({ speciesId: m.speciesId, variant: "normal", name: speciesName(m.speciesId), level: m.level, statMult: CHALLENGE.statBoost }));

// One fight: opponent `i` against the player's `members`, who carry their HP
// from earlier fights. EXP is per `team` slot. Challenges have no Underdog
// surge (spec: Difficulty): a surge lifted a lone Pokémon to Lv 100 and beat Gyms.
function simulateFight({ team, members, opponent, i, seed }) {
  const foes = opponentMembers(opponent);
  const alive = members.filter((m) => m.hpFraction === undefined || m.hpFraction > 0);
  const powers = [teamPower(alive), teamPower(foes)];
  const surge = null; // kept in the fight so playback reads the same shape as /battle
  const result = simulateBattle({ sides: [{ members }, { members: foes }], seed: seed + 2 * i + 1, surge });
  const won = result.winner === 0;
  const knockedOut = result.knockouts.filter((k) => k.bySide === 0).map((k) => foes[k.slot]);
  const gains = teamExp({ members: team, knockedOut, won });
  return { opponentKey: opponent.key, members, foes, powers, surge, result, won, gains };
}

// The Team for the next fight: each member keeps its HP fraction from `hp`,
// and a Revive brings `slot` back at full HP if it fainted. Any other slot
// (null, out of range, still standing) revives nothing, so `slot` comes back null.
function carryHp(team, hp, slot) {
  const revived = Number.isInteger(slot) && hp[slot] === 0 ? slot : null;
  return { slot: revived, members: team.map((m, s) => ({ ...m, hpFraction: s === revived ? 1 : hp[s] })) };
}

// Pure. Fights each opponent in order, carrying the player's HP from one
// fight to the next, and stops at the first loss. Levels stay fixed for the
// whole run. After each win but the last, if anyone fainted, pick({ team, hp,
// next }) chooses a Revive; breaks[k] records the break after fight k.
export function simulateChallenge({ team, opponents, seed, pick = () => null }) {
  const fights = [];
  const breaks = [];
  let members = team;
  for (const [i, opponent] of opponents.entries()) {
    const fight = simulateFight({ team, members, opponent, i, seed });
    fights.push(fight);
    if (!fight.won) return { fights, cleared: false, breaks };
    if (i === opponents.length - 1) break;
    const hp = fight.result.snapshots.at(-1)[0];
    const offered = hp.includes(0);
    const carried = carryHp(team, hp, offered ? pick({ team, hp, next: opponents[i + 1] }) : null);
    breaks.push({ offered, slot: carried.slot });
    members = carried.members;
  }
  return { fights, cleared: true, breaks };
}

function grantPrize(user, prize) {
  user.cc = (user.cc ?? 0) + prize.cc + prize.sprites.reduce((t, s) => t + (s.cc ?? 0), 0);
  // Prize Dust skips the weekly cap on Dust from normal donations (spec: Prizes).
  for (const [id, qty] of [["evolution_stone", prize.stones], ["shiny_dust", prize.dust]]) {
    const r = qty > 0 ? grantItem(user, id, qty) : { ok: true };
    if (!r.ok) console.warn(`⚠️ challenge prize: ${id} grant refused: ${r.error}`);
  }
  for (const s of prize.sprites) if (s.file) grantTrainer(user, s.file);
}

// The Outcome's view of one fight, in the shape playback reads.
const outcomeFight = (userId, f) => ({
  opponentKey: f.opponentKey,
  sides: [
    { userId, members: f.members, power: f.powers[0] },
    { userId: f.opponentKey, members: f.foes, power: f.powers[1] },
  ],
  surge: f.surge,
  result: f.result,
  winnerId: f.won ? userId : f.opponentKey,
  gains: f.gains,
});

const owns = (user, m) => (user.pokemon?.[m.speciesId]?.[m.variant] ?? 0) > 0;

// Applies a finished challenge: EXP (`totals` per Team slot) to the members
// the player still owns, then the first-win prize, Badge, and unlock, or the
// loss of min(maxLoss, 10%). The attempt was counted already.
function settle({ user, userId, key, team, totals, cleared, day, maxLoss, now }) {
  const kept = team.flatMap((m, i) => (owns(user, m) ? [i] : []));
  const exp = { [userId]: applyGains(user, kept.map((i) => team[i]), kept.map((i) => totals[i])) };
  const challenge = CHALLENGES[key];
  const won = user.challenge.won;
  let prize = null, badge = null, unlocked = null, ccLost = 0;
  if (cleared && !(key in won)) {
    const badgesBefore = earnedBadgeKeys(user).length;
    prize = prizeFor(user, key);
    grantPrize(user, prize);
    won[key] = day;
    if (challenge.kind === "gym") {
      badge = key;
      if (badgesBefore === GYM_BADGES.length - 1) unlocked = "elite4";
    }
    if (key === "elite4") unlocked = "blue";
  } else if (!cleared) {
    ccLost = Math.min(maxLoss, challengeLoss(user.cc));
    user.cc = (user.cc ?? 0) - ccLost;
  }
  // Achievements for Levels gained and prize sprites. Not a "battle" event:
  // that moves Battle win streaks, and challenges never touch the Battle record.
  trackProgress(user, [{ type: "pokemon" }, { type: "trainers" }], now.getTime());
  return { exp, prize, badge, unlocked, ccLost };
}

export function runChallenge({ trainerData, userId, key, seed, maxLoss = Infinity, now = new Date() }) {
  const reason = challengeBlock({ trainerData, userId, key, now });
  if (reason) return { ok: false, reason };
  const user = trainerData[userId];
  const team = buildTeam(user);
  const { fights, cleared } = simulateChallenge({ team, opponents: CHALLENGES[key].opponents, seed });
  const totals = team.map((_, i) => fights.reduce((t, f) => t + f.gains[i], 0));
  const day = utcDay(now);
  getChallengeRecord(user, day).attempts++;
  const settled = settle({ user, userId, key, team, totals, cleared, day, maxLoss, now });
  return { ok: true, key, userId, seed, fights: fights.map((f) => outcomeFight(userId, f)), cleared, ...settled };
}

// ==========================================================
// The interactive Elite Four run
// ==========================================================
// challenge.run = { nonce, seed, maxLoss, day, team, hp, next, gains,
// fights: [{ opponentKey, won }], breaks, updatedAt, channelId, messageId }.
// `team` is frozen at Fight!, `hp` is the HP fractions after the last fight,
// `next` is the index of the next fight, and `gains` is EXP per slot so far.
// Fight i uses seed + 2i + 1, as in simulateChallenge, so a run whose picks
// match a `pick` plays out exactly like simulateChallenge with it.
// Like every battle, `team` keeps no Mega battle stats on the record: a Mega
// slot keeps only its megaForm id, and each fight looks the stats up again
// (withMegaStats in runBattle.js).

const RUN = CHALLENGES.elite4.opponents;

// Plays fight run.next with `members` and returns the Step. A loss or the last
// fight settles the run and removes it from the record.
function playStep(user, userId, members, now) {
  const run = user.challenge.run;
  const i = run.next;
  const fight = simulateFight({ team: run.team, members: withMegaStats(members), opponent: RUN[i], i, seed: run.seed });
  run.gains = run.gains.map((g, slot) => g + fight.gains[slot]);
  run.fights.push({ opponentKey: fight.opponentKey, won: fight.won });
  run.hp = fight.result.snapshots.at(-1)[0];
  run.next = i + 1;
  run.updatedAt = now.getTime();
  const fights = [
    ...run.fights.slice(0, -1).map((f) => ({ opponentKey: f.opponentKey, winnerId: f.won ? userId : f.opponentKey })),
    outcomeFight(userId, fight),
  ];
  const view = { key: "elite4", userId, fights, breaks: [...run.breaks] };
  const base = { ok: true, nonce: run.nonce, step: i, view };
  if (fight.won && run.next < RUN.length) {
    const fainted = run.hp.flatMap((h, slot) => (h === 0 ? [{ slot, name: run.team[slot].name, level: run.team[slot].level }] : []));
    return { ...base, ended: false, outcome: null, fainted, next: RUN[run.next] };
  }
  const cleared = fight.won;
  delete user.challenge.run;
  const settled = settle({
    user, userId, key: "elite4", team: run.team, totals: run.gains, cleared, day: run.day, maxLoss: run.maxLoss ?? Infinity, now,
  });
  const outcome = { ok: true, key: "elite4", userId, seed: run.seed, fights, breaks: view.breaks, cleared, ...settled };
  return { ...base, ended: true, outcome, fainted: [], next: null };
}

// Closes the break before fight run.next with a Revive of `slot` (when
// something fainted; anything invalid revives nothing) and plays that fight.
function breakThenPlay(user, userId, slot, now) {
  const run = user.challenge.run;
  const offered = run.hp.includes(0);
  const carried = carryHp(run.team, run.hp, offered ? slot : null);
  run.breaks.push({ offered, slot: carried.slot });
  return playStep(user, userId, carried.members, now);
}

export function startRun({ trainerData, userId, seed, maxLoss = Infinity, channelId = null, now = new Date() }) {
  const reason = challengeBlock({ trainerData, userId, key: "elite4", now });
  if (reason) return { ok: false, reason };
  const user = trainerData[userId];
  const team = buildTeam(user);
  const day = utcDay(now);
  const record = getChallengeRecord(user, day);
  record.attempts++;
  record.run = {
    nonce: randomUUID(), seed,
    maxLoss: Number.isFinite(maxLoss) ? maxLoss : null, // the record is saved as JSON, which has no Infinity
    day, team: withoutMegaStats(team), hp: null, next: 0, gains: team.map(() => 0), fights: [], breaks: [],
    updatedAt: now.getTime(), channelId, messageId: null,
  };
  return playStep(user, userId, record.run.team, now);
}

// `step` is the index of the fight to play next; `slot` is the picked Revive,
// null for no pick, or undefined when nothing had fainted.
export function continueRun({ trainerData, userId, nonce, step, slot, now = new Date() }) {
  const user = trainerData[userId];
  const run = user?.challenge?.run;
  if (!run || run.nonce !== nonce || run.next !== step) return { ok: false, reason: "stale_step" };
  return breakThenPlay(user, userId, slot, now);
}

// Plays the rest of an open run with no Revives and settles it.
export function finishOpenRun({ trainerData, userId, now = new Date() }) {
  const user = trainerData[userId];
  if (!user?.challenge?.run) return null;
  let step;
  do step = breakThenPlay(user, userId, null, now);
  while (!step.ended);
  return step.outcome;
}

export const isRunStale = (user, now = new Date()) =>
  !!user?.challenge?.run && now.getTime() - user.challenge.run.updatedAt > CHALLENGE.staleRunMs;

export function finishAllOpenRuns(trainerData, now = new Date()) {
  return Object.keys(trainerData).flatMap((userId) => {
    const run = trainerData[userId]?.challenge?.run;
    if (!run) return [];
    const { channelId, messageId } = run;
    return [{ userId, outcome: finishOpenRun({ trainerData, userId, now }), channelId, messageId }];
  });
}

// The player's record as the dashboard gets it. An open run's seed decides
// its remaining fights, so with it a player could test each Revive offline.
export function hideOpenRun(user) {
  if (!user.challenge?.run) return user;
  const { run, ...challenge } = user.challenge;
  return { ...user, challenge };
}

// What the Collection page's Badge row needs from /api/user-pokemon: the
// challenges won (Badges are the Gym keys), never the open run or attempts.
export const challengeProgress = (user) => ({ won: { ...(user?.challenge?.won ?? {}) } });

// The event log's record of a finished challenge. A run lists each break's
// Revive: the slot, "none" when nothing had fainted, or null for no pick.
export const challengeLogEntry = (outcome) => ({
  key: outcome.key, seed: outcome.seed, reached: outcome.fights.length, cleared: outcome.cleared, prize: !!outcome.prize, ccLost: outcome.ccLost,
  ...(outcome.breaks && { revives: outcome.breaks.map((b) => (b.offered ? b.slot : "none")) }),
});

export function attachRunMessage(user, nonce, { channelId, messageId }) {
  const run = user?.challenge?.run;
  if (run?.nonce !== nonce) return;
  run.channelId = channelId;
  run.messageId = messageId;
}
