// ==========================================================
// tests/runBattle.test.js
// Applying a whole battle to trainerData: Teams, caps, EXP, Elo, pot.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { buildTeam, runBattle } from "../utils/battle/runBattle.js";
import { createNewUser } from "../utils/userSchema.js";
import { grantCatch } from "../utils/training.js";

const NOW = new Date("2026-11-02T12:00:00Z");
const fixed = () => 0.5;

function trainer(id, team) {
  const u = createNewUser(id, `Trainer ${id}`);
  for (const [speciesId] of team) grantCatch(u, speciesId, "normal", fixed);
  u.displayedPokemon = team.map(([speciesId]) => ({ id: speciesId, variant: "normal" }));
  return u;
}
const world = () => ({
  A: trainer("A", [[6], [25], [1]]),
  B: trainer("B", [[19], [9]]),
  C: trainer("C", []),
});
const open = (td, seed = 1, c = "A", d = "B") =>
  runBattle({ trainerData: td, challengerId: c, defenderId: d, mode: "open", seed, now: NOW });

section("Open battle");
{
  const td = world();
  const before = { a: JSON.stringify(td.A.training), b: JSON.stringify(td.B.training) };
  const out = open(td);
  assertTrue(out.ok, "battle runs");
  assertTrue(out.result.knockouts.some((k) => k.bySide === 0), "Challenger scores a knockout (fixture precondition)");
  assertTrue(JSON.stringify(td.A.training) !== before.a, "Challenger's Team gains EXP");
  assertEqual(JSON.stringify(td.B.training), before.b, "Defender's training is unchanged");
  assertEqual([td.A.battle.started, td.B.battle.started], [1, 0], "only the Challenger uses a battle");
  const dA = td.A.battle.rating - 1000, dB = td.B.battle.rating - 1000;
  assertTrue(dA === -dB && dA !== 0, "ratings move equal and opposite");
  assertEqual(td[out.winnerId].battle.wins + td[out.loserId].battle.losses, 2, "W/L recorded");
  assertEqual(Object.keys(out.exp), ["A"], "EXP report covers the Challenger only");
  assertTrue(out.exp.A.every((e) => e.toLevel >= e.fromLevel && Array.isArray(e.learned)), "EXP report has Level changes and learned moves");
  assertEqual(out.sides.map((s) => s.members.length), [3, 2], "both Teams fought");
}

section("Wager battle");
{
  const td = world();
  const ccBefore = { A: td.A.cc, B: td.B.cc };
  const out = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "wager", stake: 50, seed: 2, now: NOW });
  assertEqual(td[out.winnerId].cc - ccBefore[out.winnerId], 100, "winner gets the 2 × 50 pot");
  assertEqual(td[out.loserId].cc, ccBefore[out.loserId], "loser's Stake was already taken");
  assertEqual(Object.keys(out.exp).sort(), ["A", "B"], "both Teams earn EXP");
  assertEqual([td.A.battle.started, td.B.battle.started, td.A.battle.vs.B, td.B.battle.vs.A], [1, 1, 1, 1], "both players use a battle");
}

section("Teams");
{
  const td = world();
  td.B.pokemon[19].normal = 0;
  assertEqual(buildTeam(td.B).map((m) => m.speciesId), [9], "unowned team slots are dropped");
  td.B.pokemon[9].normal = 0;
  assertEqual(open(td).reason, "no_team_defender", "a Team of only unowned slots counts as no Team");
  assertEqual(open(world(), 1, "C", "B").reason, "no_team_challenger", "Challenger needs a Team");
  assertEqual(buildTeam(td.A)[0].name, "Charizard", "members carry the game's name");
}

section("Refusals and caps");
{
  const td = world();
  assertEqual(open(td, 1, "A", "A").reason, "self", "can't battle yourself");
  for (let i = 0; i < 3; i++) open(td, i);
  assertEqual(open(td, 9).reason, "cap_opponent", "4th battle vs the same Defender is refused");
  td.A.battle.started = 10;
  td.C = trainer("C", [[16]]);
  assertEqual(open(td, 9, "A", "C").reason, "cap_daily", "11th battle of the day is refused");
  td.A.battle.day = "2026-11-01";
  assertTrue(open(td, 9, "A", "C").ok, "caps use the day of the battle, not the offer");
  const w = world();
  w.B.battle = { rating: 1000, wins: 0, losses: 0, day: "2026-11-02", started: 10, vs: {} };
  assertEqual(runBattle({ trainerData: w, challengerId: "A", defenderId: "B", mode: "wager", stake: 1, seed: 1, now: NOW }).reason,
    "defender_cap_daily", "a Defender out of battles can't take a wager");
}

section("Determinism");
assertEqual(open(world(), 42), open(world(), 42), "same inputs + seed → same outcome");

finish();
