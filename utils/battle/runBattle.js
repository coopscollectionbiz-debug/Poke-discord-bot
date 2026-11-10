// ==========================================================
// utils/battle/runBattle.js
// Runs one Battle and applies every result to trainerData: EXP, Battle
// rating, W/L, Battle caps, and (Wager battles) the pot. The caller holds
// both players' locks and saves afterward; nothing here touches Discord.
// ==========================================================

import { trackProgress } from "../../progression/achievements.js";
import { normalizeTeam } from "../teamNormalize.js";
import { getTraining, addExp, trainingKey, speciesName } from "../training.js";
import { getMove } from "./data.js";
import { movesLearned } from "./moveset.js";
import { simulateBattle } from "./sim.js";
import { teamPower, rollSurge } from "./power.js";
import { teamExp, eloUpdate, utcDay, getBattleRecord, capBlock, recordStart } from "./rewards.js";
import { resolveBattleMega } from "../../services/megaTeam.js";
import { isMegaCapabilityEnabled } from "../../config/features.js";

// Locks both players in a fixed (ascending id) order so two battles between
// the same pair, started from either side, can't deadlock.
export function withBothLocks(lockUser, idA, idB, fn) {
  const [first, second] = [String(idA), String(idB)].sort();
  return lockUser(first, () => (first === second ? fn() : lockUser(second, fn)));
}

// The Team in slot order, skipping slots whose variant is no longer owned.
// Mega Evolution (Phase M2): the one fully valid, battle-eligible Mega slot
// (services/megaTeam.js resolveBattleMega, fail-closed) gets a battle-only
// profile: Mega stats, types, ability and name. speciesId, variant and Level
// stay the base line's, so EXP, Levels and ownership never see the Mega.
export function buildTeam(user, { env = process.env } = {}) {
  const mega = resolveBattleMega(user, { env });
  if (mega && !mega.ok && isMegaCapabilityEnabled("battle", env)) console.warn(`⚠️ Mega slot battles as its base form (${mega.reason}).`);
  return normalizeTeam(user.displayedPokemon, 6)
    .filter((slot) => (user.pokemon?.[slot.id]?.[slot.variant] ?? 0) > 0)
    .map((slot) => {
      const member = {
        speciesId: slot.id,
        variant: slot.variant,
        name: speciesName(slot.id),
        level: getTraining(user, slot.id, slot.variant).level,
      };
      if (!mega?.ok || mega.key !== `${slot.id}:${slot.variant}`) return member;
      return { ...member, name: mega.profile.name, baseName: member.name, megaForm: mega.formId, battleProfile: mega.profile };
    });
}

function applyExp(user, side, result, sideIndex) {
  const knockedOut = result.knockouts
    .filter((k) => k.bySide === sideIndex)
    .map((k) => side.opponent[k.slot]);
  const gains = teamExp({ members: side.members, knockedOut, won: result.winner === sideIndex });
  return side.members.map((m, i) => {
    const { fromLevel, toLevel } = addExp(user, m.speciesId, m.variant, gains[i]);
    return {
      key: trainingKey(m.speciesId, m.variant),
      name: m.name,
      fromLevel,
      toLevel,
      gained: gains[i],
      learned: movesLearned(m.speciesId, fromLevel, toLevel).map((id) => getMove(id).name),
      // Display only (the EXP card): which Mega this member battled as. The
      // EXP itself always goes to the base line above. Absent for ordinary
      // members, so their results are byte-for-byte unchanged.
      ...(m.megaForm ? { megaForm: m.megaForm, baseName: m.baseName } : {}),
    };
  });
}

// Read-only: why this battle can't happen right now, or null. /battle runs it
// before deferring (instant ephemeral refusals) and runBattle re-runs it under lock.
export function battleBlock({ trainerData, challengerId, defenderId, mode, now = new Date(), env = process.env }) {
  if (challengerId === defenderId) return "self";
  if (!buildTeam(trainerData[challengerId] ?? {}, { env }).length) return "no_team_challenger";
  if (!buildTeam(trainerData[defenderId] ?? {}, { env }).length) return "no_team_defender";
  const day = utcDay(now);
  const blockFor = (user, opponentId) => (user?.battle?.day === day ? capBlock(user.battle, opponentId) : null);
  const block = blockFor(trainerData[challengerId], defenderId);
  if (block) return `cap_${block}`;
  const defenderBlock = mode === "wager" && blockFor(trainerData[defenderId], challengerId);
  if (defenderBlock) return `defender_cap_${defenderBlock}`;
  return null;
}

export function runBattle({ trainerData, challengerId, defenderId, mode, stake = 0, seed, now = new Date(), env = process.env }) {
  const reason = battleBlock({ trainerData, challengerId, defenderId, mode, now, env });
  if (reason) return { ok: false, reason };
  const challenger = trainerData[challengerId];
  const defender = trainerData[defenderId];
  const teams = [buildTeam(challenger, { env }), buildTeam(defender, { env })];
  const day = utcDay(now);
  const records = [getBattleRecord(challenger, day), getBattleRecord(defender, day)];

  const powers = teams.map(teamPower);
  const surge = rollSurge(powers, seed);
  const result = simulateBattle({ sides: teams.map((members) => ({ members })), seed: seed + 1, surge });

  const ids = [challengerId, defenderId];
  const users = [challenger, defender];
  const winnerId = ids[result.winner];
  const loserId = ids[1 - result.winner];

  const exp = {};
  for (const i of mode === "wager" ? [0, 1] : [0]) {
    exp[ids[i]] = applyExp(users[i], { members: teams[i], opponent: teams[1 - i] }, result, i);
  }

  const from = records.map((r) => r.rating);
  const to = eloUpdate(from[0], from[1], result.winner === 0 ? 1 : 0);
  records.forEach((r, i) => {
    r.rating = to[i];
    if (i === result.winner) r.wins++;
    else r.losses++;
  });

  // Release C: battle achievements (wins, rating, levels, streaks) for both
  // players. Runs exactly once per completed battle, in the same synchronous
  // block as wins++/losses++ and inside the caller's withBothLocks, so a
  // streak can never move without the win/loss it belongs to. "upset" uses
  // the pre-battle ratings.
  users.forEach((u, i) => {
    const won = i === result.winner;
    trackProgress(u, [{ type: "battle", won, upset: won && from[1 - i] - from[i] >= 200 }], now.getTime());
  });

  recordStart(records[0], defenderId);
  if (mode === "wager") {
    recordStart(records[1], challengerId);
    trainerData[winnerId].cc = (trainerData[winnerId].cc ?? 0) + 2 * stake;
  }

  return {
    ok: true,
    seed,
    mode,
    stake,
    sides: ids.map((userId, i) => ({ userId, members: teams[i], power: powers[i] })),
    surge,
    result,
    winnerId,
    loserId,
    exp,
    rating: { [ids[0]]: { from: from[0], to: to[0] }, [ids[1]]: { from: from[1], to: to[1] } },
  };
}
