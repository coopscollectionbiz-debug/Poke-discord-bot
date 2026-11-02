// ==========================================================
// utils/battle/runBattle.js
// Runs one Battle and applies every result to trainerData: EXP, Battle
// rating, W/L, Battle caps, and (Wager battles) the pot. The caller holds
// both players' locks and saves afterward; nothing here touches Discord.
// ==========================================================

import { normalizeTeam } from "../teamNormalize.js";
import { getTraining, addExp, trainingKey, speciesName } from "../training.js";
import { getMove } from "./data.js";
import { movesLearned } from "./moveset.js";
import { simulateBattle } from "./sim.js";
import { teamPower, rollSurge } from "./power.js";
import { teamExp, eloUpdate, utcDay, getBattleRecord, capBlock, recordStart } from "./rewards.js";

// The Team in slot order, skipping slots whose variant is no longer owned.
export function buildTeam(user) {
  return normalizeTeam(user.displayedPokemon, 6)
    .filter((slot) => (user.pokemon?.[slot.id]?.[slot.variant] ?? 0) > 0)
    .map((slot) => ({
      speciesId: slot.id,
      variant: slot.variant,
      name: speciesName(slot.id),
      level: getTraining(user, slot.id, slot.variant).level,
    }));
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
    };
  });
}

export function runBattle({ trainerData, challengerId, defenderId, mode, stake = 0, seed, now = new Date() }) {
  if (challengerId === defenderId) return { ok: false, reason: "self" };
  const challenger = trainerData[challengerId];
  const defender = trainerData[defenderId];
  const teams = [buildTeam(challenger ?? {}), buildTeam(defender ?? {})];
  if (!teams[0].length) return { ok: false, reason: "no_team_challenger" };
  if (!teams[1].length) return { ok: false, reason: "no_team_defender" };

  const day = utcDay(now);
  const records = [getBattleRecord(challenger, day), getBattleRecord(defender, day)];
  const block = capBlock(records[0], defenderId);
  if (block) return { ok: false, reason: `cap_${block}` };
  if (mode === "wager") {
    const defenderBlock = capBlock(records[1], challengerId);
    if (defenderBlock) return { ok: false, reason: `defender_cap_${defenderBlock}` };
  }

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
