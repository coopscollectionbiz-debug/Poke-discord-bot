// ==========================================================
// utils/challenge/runChallenge.js
// Runs one Challenge and applies every result to trainerData: EXP, the
// daily attempt, the first-win prize, and the 10% CC loss. The caller holds
// the player's lock and saves afterward; nothing here touches Discord.
// Challenges never touch user.battle (Battle rating, W/L, Battle caps).
// ==========================================================

import { CHALLENGES, enabledSprites } from "./roster.js";
import { GYM_BADGES, earnedBadgeKeys } from "../../public/picker-pokemon/badges.js";
import { buildTeam, applyGains } from "../battle/runBattle.js";
import { simulateBattle } from "../battle/sim.js";
import { teamPower, rollSurge } from "../battle/power.js";
import { teamExp, utcDay } from "../battle/rewards.js";
import { CHALLENGE } from "../battle/tuning.js";
import { speciesName } from "../training.js";
import { TRAINER_COSTS } from "../trainerCosts.js";

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
  if (!user || !buildTeam(user).length) return "no_team";
  if (!isUnlocked(user, key)) return key === "elite4" ? "locked_elite4" : "locked_blue";
  const attempts = user.challenge?.day === utcDay(now) ? user.challenge.attempts : 0;
  if (attempts >= CHALLENGE.perDay) return "cap";
  // A wager's Stake is out of the balance until the offer ends, which would shield it from the loss.
  if (user.pendingWager) return "pending_wager";
  return null;
}

const ownedTrainers = (user) =>
  Array.isArray(user.trainers) ? user.trainers : Object.keys(user.trainers ?? {});

// The first enabled sprite the player doesn't own, or half its shop price in CC.
export function prizeSprite(user, trainerKey) {
  const owned = new Set(ownedTrainers(user).map((f) => String(f).trim().toLowerCase()));
  const { files, tier } = enabledSprites(trainerKey);
  const file = files.find((f) => !owned.has(f.toLowerCase()));
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

const opponentMembers = (o) =>
  o.team.map((m) => ({ speciesId: m.speciesId, variant: "normal", name: speciesName(m.speciesId), level: m.level }));

// Pure. Fights each opponent in order, carrying the player's HP (as a fraction
// of max HP) from one fight to the next, and stops at the first loss. Levels
// stay fixed for the whole run.
export function simulateChallenge({ team, opponents, seed }) {
  const fights = [];
  let members = team;
  for (const [i, opponent] of opponents.entries()) {
    const foes = opponentMembers(opponent);
    const alive = members.filter((m) => m.hpFraction === undefined || m.hpFraction > 0);
    const powers = [teamPower(alive), teamPower(foes)];
    const rolled = rollSurge(powers, seed + 2 * i);
    // Only the player's Team can surge (spec: Difficulty).
    const surge = rolled?.side === 0 ? rolled : null;
    const result = simulateBattle({ sides: [{ members }, { members: foes }], seed: seed + 2 * i + 1, surge });
    const won = result.winner === 0;
    const knockedOut = result.knockouts.filter((k) => k.bySide === 0).map((k) => foes[k.slot]);
    const gains = teamExp({ members: team, knockedOut, won });
    fights.push({ opponentKey: opponent.key, members, foes, powers, surge, result, won, gains });
    if (!won) return { fights, cleared: false };
    const hp = result.snapshots.at(-1)[0];
    members = team.map((m, slot) => ({ ...m, hpFraction: hp[slot] }));
  }
  return { fights, cleared: true };
}

function grantPrize(user, prize) {
  user.cc = (user.cc ?? 0) + prize.cc + prize.sprites.reduce((t, s) => t + (s.cc ?? 0), 0);
  user.items ??= {};
  user.items.evolution_stone = (user.items.evolution_stone ?? 0) + prize.stones;
  // Prize Dust skips the weekly cap on Dust from normal donations (spec: Prizes).
  user.items.shiny_dust = (user.items.shiny_dust ?? 0) + prize.dust;
  const files = prize.sprites.filter((s) => s.file).map((s) => s.file);
  if (files.length) user.trainers = [...ownedTrainers(user), ...files];
}

export function runChallenge({ trainerData, userId, key, seed, maxLoss = Infinity, now = new Date() }) {
  const reason = challengeBlock({ trainerData, userId, key, now });
  if (reason) return { ok: false, reason };
  const user = trainerData[userId];
  const challenge = CHALLENGES[key];
  const team = buildTeam(user);
  const { fights, cleared } = simulateChallenge({ team, opponents: challenge.opponents, seed });

  const totals = team.map((_, i) => fights.reduce((t, f) => t + f.gains[i], 0));
  const exp = { [userId]: applyGains(user, team, totals) };

  const day = utcDay(now);
  const record = getChallengeRecord(user, day);
  record.attempts++;

  let prize = null, badge = null, unlocked = null, ccLost = 0;
  if (cleared && !(key in record.won)) {
    const badgesBefore = earnedBadgeKeys(user).length;
    prize = prizeFor(user, key);
    grantPrize(user, prize);
    record.won[key] = day;
    if (challenge.kind === "gym") {
      badge = key;
      if (badgesBefore === GYM_BADGES.length - 1) unlocked = "elite4";
    }
    if (key === "elite4") unlocked = "blue";
  } else if (!cleared) {
    ccLost = Math.min(maxLoss, challengeLoss(user.cc));
    user.cc = (user.cc ?? 0) - ccLost;
  }

  return {
    ok: true,
    key,
    userId,
    seed,
    fights: fights.map((f) => ({
      opponentKey: f.opponentKey,
      sides: [
        { userId, members: f.members, power: f.powers[0] },
        { userId: f.opponentKey, members: f.foes, power: f.powers[1] },
      ],
      surge: f.surge,
      result: f.result,
      winnerId: f.won ? userId : f.opponentKey,
      gains: f.gains,
    })),
    cleared,
    exp,
    prize,
    badge,
    unlocked,
    ccLost,
  };
}
