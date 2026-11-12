// ==========================================================
// tools/fight-record-fixtures.mjs — real Fight records from synthetic
// players, for the measure tool and the dev preview. Every fight is run
// by the game's own code (runBattle, runChallenge, the Elite Four run,
// fightEncounter); only the players are made up. Nothing is saved.
// ==========================================================

import { runBattle, buildTeam } from "../utils/battle/runBattle.js";
import { runChallenge, startRun, continueRun } from "../utils/challenge/runChallenge.js";
import { fightEncounter } from "../utils/encounter/runEncounter.js";
import { rollTrainer } from "../utils/encounter/generate.js";
import { battleRecord, challengeRecord, encounterRecord } from "../utils/fightRecordBuild.js";
import { createNewUser } from "../utils/userSchema.js";

const GYMS = ["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"];

export function fixturePlayer(id, name, team, level, { trainer = "youngster-gen4.png", shiny = [] } = {}) {
  const u = createNewUser(id, name);
  for (const sid of team) {
    const variant = shiny.includes(sid) ? "shiny" : "normal";
    u.pokemon[sid] = { normal: variant === "normal" ? 1 : 0, shiny: variant === "shiny" ? 1 : 0 };
    (u.training ??= {})[`${sid}:${variant}`] = { exp: level ** 3 };
  }
  u.displayedPokemon = team.map((sid) => ({ id: sid, variant: shiny.includes(sid) ? "shiny" : "normal" }));
  u.battleTeam = u.displayedPokemon;
  u.cc = 50000;
  u.displayedTrainer = trainer;
  return u;
}

const day = (base, n) => new Date(base.getTime() + n * 86400000);

/**
 * Records for `me` against a few made-up players: casual, ranked and
 * wager Battles (as Challenger and as Defender), Gyms, Elite Four runs
 * (one with Revives), and Trainer encounters, spread over `days` days.
 */
export function fixtureRecords({ me = "100000000000000001", days = 12, now = new Date() } = {}) {
  const td = {
    [me]: fixturePlayer(me, "Coop", [6, 9, 3, 25, 149, 94], 62, { trainer: "red-masters.png", shiny: [25] }),
    R1: fixturePlayer("R1", "Misty Fan", [130, 131, 121, 55, 134, 91], 58, { trainer: "misty.png" }),
    R2: fixturePlayer("R2", "Pallet Gary", [18, 65, 112, 59, 103, 9], 64, { trainer: "blue-masters.png" }),
    R3: fixturePlayer("R3", "Hiker Joe", [76, 95, 208, 142, 248, 68], 55, { trainer: "brock.png" }),
  };
  const names = { [me]: "Coop", R1: "Misty Fan", R2: "Pallet Gary", R3: "Hiker Joe" };
  td[me].challenge = { won: {}, day: null, attempts: 0 };
  const out = [];
  let seed = 11;
  const start = new Date(now.getTime() - days * 86400000);
  for (let d = 0; d < days; d++) {
    const at = (h) => new Date(day(start, d).getTime() + h * 3600000);
    for (const [opp, mode, flip] of [["R1", "open", false], ["R2", "ranked", false], ["R3", "open", true], ["R1", "ranked", true]]) {
      const [c, def] = flip ? [opp, me] : [me, opp];
      const o = runBattle({ trainerData: td, challengerId: c, defenderId: def, mode, seed: seed++, now: at(2 + out.length % 8) });
      if (o.ok) out.push(battleRecord(o, names, td, { now: at(2 + out.length % 8) }));
    }
    if (d % 3 === 0) {
      td[me].pendingWager = null;
      const o = runBattle({ trainerData: td, challengerId: me, defenderId: "R2", mode: "wager", stake: 500, seed: seed++, now: at(20) });
      if (o.ok) out.push(battleRecord(o, names, td, { now: at(20) }));
    }
    const gym = GYMS[d % GYMS.length];
    const g = runChallenge({ trainerData: td, userId: me, key: gym, seed: seed++, now: at(9) });
    if (g.ok) out.push(challengeRecord(g, "Coop", td, { now: at(9) }));
    if (d % 4 === 1) {
      td[me].challenge.won = Object.fromEntries(GYMS.map((k) => [k, "2026-11-01"]));
      let step = startRun({ trainerData: td, userId: me, seed: seed++, now: at(15) });
      while (step.ok && !step.ended) step = continueRun({ trainerData: td, userId: me, nonce: step.nonce, step: step.step + 1, slot: step.fainted[0]?.slot, now: at(15) });
      if (step.ok) out.push(challengeRecord(step.outcome, "Coop", td, { now: at(15) }));
    }
    for (const h of [11, 17]) {
      const team = buildTeam(td[me]);
      const trainer = rollTrainer({ team, seed: seed++ });
      const e = fightEncounter({ trainerData: td, userId: me, encounter: { team: team.map(({ speciesId, variant }) => ({ speciesId, variant })), trainer }, seed: seed++, now: at(h) });
      if (e.ok) out.push(encounterRecord(e, "Coop", td, { now: at(h) }));
    }
  }
  return { me, records: out.sort((a, b) => a.at - b.at) };
}
