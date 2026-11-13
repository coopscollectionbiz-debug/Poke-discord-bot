// ==========================================================
// tests/simPool.test.js
// Fights under FULL_SIM_ENABLED: the sim worker gives the same result as
// running inline; with the switch off nothing becomes async; Battles and
// Elite Four runs await the worker; a run keeps the engine it started on;
// HP and status carry between Elite Four fights.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { simulateBattle, loadFullSim } from "../utils/battle/sim.js";
import { simulateAsync, simulateLive, closeSimPool } from "../utils/battle/simPool.js";
import { runBattle } from "../utils/battle/runBattle.js";
import { startRun, continueRun, carryHp } from "../utils/challenge/runChallenge.js";
import { createNewUser } from "../utils/userSchema.js";

await loadFullSim(); // the full sim loads on first use (utils/battle/sim.js)

const D = new Date("2026-11-09T12:00:00Z");
const GYMS = ["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"];
const side = (...ids) => ({ members: ids.map((speciesId) => ({ speciesId, variant: "normal", name: `#${speciesId}`, level: 50 })) });
const input = { sides: [side(25, 6, 9), side(3, 143, 94)], seed: 77, surge: null };
const withSwitch = async (on, fn) => {
  const saved = process.env.FULL_SIM_ENABLED;
  if (on) process.env.FULL_SIM_ENABLED = "1"; else delete process.env.FULL_SIM_ENABLED;
  try { return await fn(); } finally { if (saved === undefined) delete process.env.FULL_SIM_ENABLED; else process.env.FULL_SIM_ENABLED = saved; }
};
function player(id, speciesIds, level) {
  const u = createNewUser(id, `Trainer ${id}`);
  for (const sid of speciesIds) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    u.training ??= {};
    u.training[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  u.cc = 5000;
  return u;
}

section("Worker");
{
  const inline = simulateBattle({ ...input, engine: "full" });
  const pooled = await simulateAsync({ ...input, engine: "full" });
  assertEqual(pooled, inline, "the sim worker returns exactly the inline result");
  assertEqual(inline.v, 2, "the full engine's result");
}

section("Switch off");
await withSwitch(false, () => {
  const r = simulateLive(input);
  assertTrue(typeof r?.then !== "function" && r.v === undefined, "with the switch off a fight stays synchronous on today's engine");
});

section("A Battle on the full sim");
await withSwitch(true, async () => {
  const td = { A: player("A", [25, 6, 9], 40), B: player("B", [3, 143, 94], 40) };
  const pending = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", seed: 5, now: D });
  assertTrue(typeof pending?.then === "function", "with the switch on, runBattle returns a Promise");
  const out = await pending;
  assertEqual([out.ok, out.result.v, Object.keys(out.exp)], [true, 2, ["A"]], "it fights on the full engine and pays the Challenger's EXP once");
});

section("Elite Four carry-over");
{
  const team = [{ name: "a" }, { name: "b" }, { name: "c" }];
  const carried = carryHp(team, [0.4, 0, 1], ["psn", "", ""], 1);
  assertEqual(carried.members.map((m) => [m.hpFraction, m.status ?? ""]), [[0.4, "psn"], [1, ""], [1, ""]], "HP and status carry; a Revive brings a Pokémon back at full HP with no status");
  assertEqual(carryHp(team, [0.4, 0, 1], undefined, null).members.map((m) => m.status ?? ""), ["", "", ""], "a result without status (today's engine) carries none");
}
await withSwitch(true, async () => {
  const td = { A: player("A", [150, 249, 250, 384, 483, 484], 100) };
  td.A.challenge = { won: Object.fromEntries(GYMS.map((k) => [k, "2026-11-01"])), day: null, attempts: 0 };
  const first = await startRun({ trainerData: td, userId: "A", seed: 1, now: D });
  assertEqual([first.ok, td.A.challenge.run?.engine], [true, "full"], "a run started on the full sim is stamped with it");
  delete process.env.FULL_SIM_ENABLED;
  const next = await continueRun({ trainerData: td, userId: "A", nonce: first.nonce, step: first.step + 1, slot: null, now: D });
  assertEqual(next.view.fights.at(-1).result?.v, 2, "after the switch flips, the run still finishes on the engine it started on");
});

await closeSimPool();
finish();
