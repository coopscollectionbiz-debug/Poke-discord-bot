// ==========================================================
// utils/encounter/runEncounter.js
// The rules of a Trainer encounter that touch the player's record
// (docs/superpowers/specs/2026-11-10-trainer-encounters-design.md): who a
// Trainer may spot, counting a posted card, and the fight with its
// settlement. The caller holds the player's lock and saves afterward;
// nothing here touches Discord. Encounters never touch user.battle
// (Battle rating, W/L, Battle caps) or user.challenge.
// ==========================================================

import { buildTeam, availablePicks, applyGains } from "../battle/runBattle.js";
import { simulateBattle } from "../battle/sim.js";
import { teamExp, utcDay } from "../battle/rewards.js";
import { speciesName } from "../training.js";
import { trackProgress } from "../../progression/achievements.js";
import { ENCOUNTER } from "../battle/tuning.js";

// user.encounter = { day, count, lastAt }: cards posted on that UTC day, and
// when the last one posted (ms). lastAt survives the day change for the gap.
export function getEncounterRecord(user, day) {
  user.encounter ??= { day, count: 0, lastAt: null };
  if (user.encounter.day !== day) {
    user.encounter.day = day;
    user.encounter.count = 0;
  }
  return user.encounter;
}

/** Read-only: why a Trainer can't spot this player now, or null. `open`: they already have an encounter open. */
export function spotBlock({ user, open, now }) {
  if (!user || !availablePicks(user).length) return "no_team";
  if (user.challenge?.run) return "run_open";
  // A wager's Stake is out of the balance until the offer ends, which would shield it from paying out.
  if (user.pendingWager) return "pending_wager";
  if (open) return "open";
  const r = user.encounter;
  if (r?.lastAt != null && now.getTime() - r.lastAt < ENCOUNTER.gapMs) return "gap";
  if (r?.day === utcDay(now) && r.count >= ENCOUNTER.perDay) return "cap";
  return null;
}

/** Counts a card that posted. */
export function recordSpot(user, now) {
  const r = getEncounterRecord(user, utcDay(now));
  r.count++;
  r.lastAt = now.getTime();
}

/**
 * Fights the Trainer with the card's Team (`encounter.team`: species,
 * Variant, and megaForm on a Mega slot): members the player gave up since
 * sit out, the rest fight at their current Levels. A win pays the Prize money; a loss pays the same, or
 * all the player's CC if they hold less. EXP per knockout either way.
 */
export function fightEncounter({ trainerData, userId, encounter: { team, trainer, pick = "casual" }, seed, now = new Date() }) {
  const user = trainerData[userId];
  if (user?.challenge?.run) return { ok: false, reason: "run_open" };
  if (user?.pendingWager) return { ok: false, reason: "pending_wager" };
  // As the Display team fights in casual battles: chosen Display moves, and
  // the Mega slot as a Mega only if it still qualifies (buildTeam re-checks).
  // Ranked (three-teams split): the Ranked team's moves and held items, still at real Levels.
  const side = pick === "ranked" ? { movesetTeam: "battle", equipmentTeam: "battle" } : {};
  const members = buildTeam(user, { ...side, team: team.map((m) => ({ id: m.speciesId, variant: m.variant, ...(m.copyUid && { uid: m.copyUid }), ...(m.megaForm && { mega: m.megaForm }) })) });
  if (!members.length) return { ok: false, reason: "no_team" };

  const foes = trainer.party.map((m) => ({ speciesId: m.speciesId, variant: "normal", name: speciesName(m.speciesId), level: m.level }));
  const result = simulateBattle({ sides: [{ members }, { members: foes }], seed, surge: null });
  const won = result.winner === 0;
  const knockedOut = result.knockouts.filter((k) => k.bySide === 0).map((k) => foes[k.slot]);
  const exp = { [userId]: applyGains(user, members, teamExp({ members, knockedOut, won })) };

  let paid = 0;
  if (won) {
    user.cc = (user.cc ?? 0) + trainer.prize;
  } else {
    paid = Math.min(trainer.prize, Math.max(0, user.cc ?? 0));
    user.cc = (user.cc ?? 0) - paid;
  }
  // Achievements for Levels gained. Not a "battle" event: that moves Battle win streaks.
  trackProgress(user, [{ type: "pokemon" }], now.getTime());
  return {
    ok: true, userId, trainer,
    sides: [{ userId, members }, { userId: "trainer", members: foes }],
    surge: null, result, winnerId: won ? userId : "trainer", won, exp, prize: trainer.prize, paid,
  };
}
