// ==========================================================
// tests/fightFailure.test.js
// A full-sim fight that fails (the sim worker crashes, runs out of memory,
// or the engine throws) leaves no Elite Four run half done (review I4): a
// run that can't start isn't left open and spends no attempt, a failed
// fight mid-run leaves the run as it was, and one run that can't finish
// at startup doesn't stop the others. The wager case is in
// tests/battleCommand.test.js.
//
// The full sim is swapped for one that always throws (a module hook), and
// SIM_THREADS=0 runs it inline, so no production code needs a test seam.
// ==========================================================

import { registerHooks } from "module";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { startRun, continueRun, finishAllOpenRuns } from "../utils/challenge/runChallenge.js";
import { createNewUser } from "../utils/userSchema.js";

registerHooks({
  load(url, context, next) {
    if (url.endsWith("/utils/battle/showdown/simulate.js")) {
      return { format: "module", shortCircuit: true, source: 'export function simulateFull() { throw new Error("test: the sim failed"); }' };
    }
    return next(url, context);
  },
});
process.env.SIM_THREADS = "0";

const D = new Date("2026-11-09T12:00:00Z");
const GYMS = ["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"];
const STRONG = [150, 249, 250, 384, 483, 484];
function ready(id) {
  const u = createNewUser(id, `Trainer ${id}`);
  for (const sid of STRONG) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    u.training ??= {};
    u.training[`${sid}:normal`] = { exp: 100 ** 3 };
  }
  u.displayedPokemon = STRONG.map((sid) => ({ id: sid, variant: "normal" }));
  u.cc = 12345;
  u.challenge = { won: Object.fromEntries(GYMS.map((k) => [k, "2026-11-01"])), day: null, attempts: 0 };
  return u;
}
const failure = async (value) => {
  try { await value; return null; } catch (err) { return err.message; }
};
// An open run on today's engine (its first fight won), then marked as a full-sim run.
function openFullRun(td, userId) {
  delete process.env.FULL_SIM_ENABLED;
  const step = startRun({ trainerData: td, userId, seed: 1, now: D });
  td[userId].challenge.run.engine = "full";
  return step;
}

section("An Elite Four run whose first fight fails");
{
  process.env.FULL_SIM_ENABLED = "1";
  const td = { A: ready("A") };
  const err = await failure(startRun({ trainerData: td, userId: "A", seed: 1, now: D }));
  assertTrue(String(err).includes("the sim failed"), "the error reaches the command");
  assertEqual([td.A.challenge.run, td.A.challenge.attempts], [undefined, 0], "no run is left open and no attempt is spent");
}

section("A fight that fails mid-run");
{
  const td = { A: ready("A") };
  const step = openFullRun(td, "A");
  assertTrue(!step.ended, "the run is open after its first fight");
  const before = JSON.stringify(td.A.challenge.run);
  const err = await failure(continueRun({ trainerData: td, userId: "A", nonce: step.nonce, step: step.step + 1, slot: step.fainted[0]?.slot, now: D }));
  assertTrue(String(err).includes("the sim failed"), "the error reaches the command");
  assertEqual(JSON.stringify(td.A.challenge.run), before, "the run is as it was, so trying again plays the same fight");
}

section("Finishing open runs at startup");
{
  const td = { A: ready("A"), B: ready("B") };
  openFullRun(td, "A");
  delete process.env.FULL_SIM_ENABLED;
  startRun({ trainerData: td, userId: "B", seed: 2, now: D }); // today's engine: finishes
  const done = await finishAllOpenRuns(td, D);
  assertEqual(done.map((d) => d.userId), ["B"], "a run that can't finish doesn't stop the others");
  assertTrue(!!td.A.challenge.run, "and it stays open for the next restart");
}

finish();
