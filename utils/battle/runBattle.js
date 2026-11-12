// ==========================================================
// utils/battle/runBattle.js
// Runs one Battle and applies every result to trainerData: EXP, Battle
// rating, W/L, Battle caps, and (Wager battles) the pot. The caller holds
// both players' locks and saves afterward; nothing here touches Discord.
//
// Modes (owner decision, docs/design/TEAMS-COLLECTION-REDESIGN.md):
//   open    casual: Display teams at real Levels, Underdog surge, unrated
//           (user.casual W/L), no battle achievements
//   ranked  Battle teams at Lv 50, no surge, rated (user.battle), battle
//           achievements; no consent needed
//   wager   as ranked, plus the accepted pot
// EXP always uses real Levels (Pokémon still level up), in every mode.
// ==========================================================

import { trackProgress } from "../../progression/achievements.js";
import { normalizeTeam } from "../teamNormalize.js";
import { getTraining, addExp, trainingKey, speciesName } from "../training.js";
import { getMove } from "./data.js";
import { movesLearned } from "./moveset.js";
import { simulateBattle } from "./sim.js";
import { teamPower, rollSurge, cuteSurgeBoost } from "./power.js";
import { teamExp, eloUpdate, utcDay, getBattleRecord, getCasualRecord, capBlock, recordStart } from "./rewards.js";
import { RANKED, CUTE } from "./tuning.js";
import { teamCuteness } from "./cuteness.js";
import { chosenMoves } from "../../services/movesets.js";
import { resolveBattleMega } from "../../services/megaTeam.js";
import { megaBattleEligibility, megaBattleProfile } from "../megas.js";
import { isMegaCapabilityEnabled } from "../../config/features.js";
import { toTeamObj } from "../economyRules.js";
import { slotCopyUid } from "../../services/ownership.js";
import { battleItems } from "../../services/heldItems.js";
import { expMultiplierFor } from "./items.js";

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
// movesetTeam: whose chosen movesets apply ("display" for casual battles and
// displays, "battle" for ranked/wager). Members without one use automatic moves.
// TM system (T1): a slot naming a customized copy (`uid`, services/ownership.js)
// fights with that copy's moves (its TM moves included); the member carries
// `uid`. Slots without one are built exactly as before.
// Held items (equipmentTeam, default = movesetTeam): each member's item is
// read here, inside the battle's locks, and copied onto the member. That
// copy is the battle snapshot: later equipment changes can't touch a battle
// that has started, and the result/replay shows what actually battled.
// services/heldItems.battleItems re-checks every rule (ownership, Item
// Clause, Mega slot, species, battle capability) and drops anything doubtful.
export function buildTeam(user, { env = process.env, team = user.displayedPokemon, movesetTeam = "display", equipmentTeam = movesetTeam } = {}) {
  const mega = resolveBattleMega(user, { env, team });
  if (mega && !mega.ok && isMegaCapabilityEnabled("battle", env)) console.warn(`⚠️ Mega slot battles as its base form (${mega.reason}).`);
  const items = battleItems(user, equipmentTeam, { env });
  const uids = new Map();
  for (const entry of Array.isArray(team) ? team : []) {
    const t = toTeamObj(entry);
    if (!t || uids.has(`${t.id}:${t.variant}`)) continue;
    uids.set(`${t.id}:${t.variant}`, slotCopyUid(user, { ...t, uid: entry?.uid }));
  }
  return normalizeTeam(team, 6)
    .filter((slot) => (user.pokemon?.[slot.id]?.[slot.variant] ?? 0) > 0)
    .map((slot) => {
      const member = {
        speciesId: slot.id,
        variant: slot.variant,
        name: speciesName(slot.id),
        level: getTraining(user, slot.id, slot.variant).level,
      };
      const uid = uids.get(`${slot.id}:${slot.variant}`) ?? null;
      if (uid) member.uid = uid;
      const moves = chosenMoves(user, movesetTeam, slot.id, slot.variant, { uid });
      if (moves) member.moves = moves;
      // A slot battling as a Mega never uses a regular item (its Mega Stone fills the slot).
      const item = items.get(`${slot.id}:${slot.variant}`);
      if (item && !(mega?.ok && mega.key === `${slot.id}:${slot.variant}`)) member.item = item;
      if (!mega?.ok || mega.key !== `${slot.id}:${slot.variant}`) return member;
      return { ...member, name: mega.profile.name, baseName: member.name, megaForm: mega.formId, battleProfile: mega.profile };
    });
}

// A built Team without its Mega battle stats, for saving on the player's
// record, which never holds them (tests/megaBattle.test.js). A Mega slot keeps
// its megaForm id; withMegaStats puts the stats back before a fight.
export const withoutMegaStats = (team) => team.map(({ battleProfile, ...m }) => m);

// Saved fighters made ready to fight: each Mega slot gets its battle profile
// again. A form no longer battle-ready (Mega battles switched off since it was
// saved, say) fights as its base form, failing closed like buildTeam.
export function withMegaStats(members, { env = process.env } = {}) {
  return members.map((m) => {
    if (!m.megaForm) return m;
    if (megaBattleEligibility(m.megaForm, { env }).battleReady) return { ...m, battleProfile: megaBattleProfile(m.megaForm) };
    const { megaForm, baseName, battleProfile, ...base } = m;
    return { ...base, name: baseName ?? base.name };
  });
}

/**
 * The Battle team (user.battleTeam) as fighters: every member at
 * RANKED.level for the battle, its real Level kept as realLevel (EXP and
 * display). Empty when the player has no Battle team.
 */
export function buildBattleTeam(user, { env = process.env } = {}) {
  if (!Array.isArray(user?.battleTeam)) return [];
  return buildTeam(user, { env, team: user.battleTeam, movesetTeam: "battle", equipmentTeam: "battle" }).map((m) => ({ ...m, realLevel: m.level, level: RANKED.level }));
}

/** A player's fighters for this mode. */
export const teamFor = (user, mode, opts = {}) => (mode === "open" ? buildTeam(user ?? {}, opts) : buildBattleTeam(user ?? {}, opts));

// EXP uses real Levels in every mode: the fighters' battle Levels are swapped
// back to their real ones (ranked/wager members carry realLevel).
const atRealLevels = (members) => members.map((m) => (m.realLevel != null ? { ...m, level: m.realLevel } : m));

// After a cute surge, the surging side earns as the Levels it fought at
// (`levelMult`, Lv 100 at most), so a far stronger opponent pays like an
// even fight instead of a fortune in EXP.
function applyExp(user, side, result, sideIndex) {
  const knockedOut = result.knockouts
    .filter((k) => k.bySide === sideIndex)
    .map((k) => side.opponent[k.slot]);
  const surged = (m) => (side.levelMult ? { ...m, level: Math.min(100, Math.round(m.level * side.levelMult)) } : m);
  const base = teamExp({ members: atRealLevels(side.members).map(surged), knockedOut: atRealLevels(knockedOut), won: result.winner === sideIndex });
  // Lucky Egg: the holder's battle EXP × 1.5, rounded down (Gen 5+). Members
  // without an EXP item keep exactly the same gain as before.
  const gains = base.map((g, i) => Math.floor(g * expMultiplierFor(side.members[i].item)));
  return applyGains(user, side.members, gains, base);
}

// Adds gains[i] EXP to members[i] and reports each one's Level change and new
// moves. base[i] (held items): the gain before an EXP item, reported when it differs.
export function applyGains(user, members, gains, base = gains) {
  return members.map((m, i) => {
    const { fromLevel, toLevel } = addExp(user, m.speciesId, m.variant, gains[i]);
    return {
      key: trainingKey(m.speciesId, m.variant),
      name: m.name,
      fromLevel,
      toLevel,
      gained: gains[i],
      learned: movesLearned(m.speciesId, fromLevel, toLevel).map((id) => getMove(id).name),
      ...(gains[i] !== base[i] ? { bonusFrom: m.item, baseGained: base[i] } : {}),
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
  const prefix = mode === "open" ? "no_team" : "no_battle_team";
  if (!teamFor(trainerData[challengerId], mode, { env }).length) return `${prefix}_challenger`;
  if (!teamFor(trainerData[defenderId], mode, { env }).length) return `${prefix}_defender`;
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
  const rated = mode !== "open";
  const teams = [teamFor(challenger, mode, { env }), teamFor(defender, mode, { env })];
  const day = utcDay(now);
  const records = [getBattleRecord(challenger, day), getBattleRecord(defender, day)];

  // Power at the Levels they fight at (Lv 50 in ranked/wager). The Underdog
  // surge, and the cute surge with it, is a casual-only feature.
  const powers = teams.map(teamPower);
  const surge = rated ? null : rollSurge(powers, seed, teams.map(teamCuteness));
  if (surge?.cute) Object.assign(surge, cuteSurgeBoost(teams[surge.side], CUTE.margin * powers[1 - surge.side]));
  const result = simulateBattle({ sides: teams.map((members) => ({ members })), seed: seed + 1, surge });

  const ids = [challengerId, defenderId];
  const users = [challenger, defender];
  const winnerId = ids[result.winner];
  const loserId = ids[1 - result.winner];

  const exp = {};
  for (const i of mode === "wager" ? [0, 1] : [0]) {
    exp[ids[i]] = applyExp(users[i], { members: teams[i], opponent: teams[1 - i], ...(surge?.cute && surge.side === i && { levelMult: surge.levelMult }) }, result, i);
  }

  let rating = {};
  if (rated) {
    const from = records.map((r) => r.rating);
    const to = eloUpdate(from[0], from[1], result.winner === 0 ? 1 : 0);
    records.forEach((r, i) => {
      r.rating = to[i];
      if (i === result.winner) r.wins++;
      else r.losses++;
    });
    rating = { [ids[0]]: { from: from[0], to: to[0] }, [ids[1]]: { from: from[1], to: to[1] } };

    // Release C: battle achievements (wins, rating, levels, streaks) for both
    // players — ranked and wager battles only (owner decision). Runs exactly
    // once per completed battle, in the same synchronous block as
    // wins++/losses++ and inside the caller's withBothLocks, so a streak can
    // never move without the win/loss it belongs to. "upset" uses the
    // pre-battle ratings.
    users.forEach((u, i) => {
      const won = i === result.winner;
      trackProgress(u, [{ type: "battle", won, upset: won && from[1 - i] - from[i] >= 200 }], now.getTime());
    });
  } else {
    // Casual: unrated W/L and streaks for both players, then the casual
    // achievements (same block, inside the caller's locks).
    users.forEach((u, i) => {
      const c = getCasualRecord(u);
      if (i === result.winner) {
        c.wins++;
        c.streak = (c.streak ?? 0) + 1;
        if (c.streak > (c.bestStreak ?? 0)) c.bestStreak = c.streak;
      } else {
        c.losses++;
        c.streak = 0;
      }
      trackProgress(u, [{ type: "casual" }], now.getTime());
    });
  }

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
    rated,
    rating, // {} for casual battles
  };
}
