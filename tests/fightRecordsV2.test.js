// ==========================================================
// tests/fightRecordsV2.test.js
// Fight records of full-sim fights (v2 results): the steps, end status and
// raw Showdown log are kept, a big raw log is gzipped, today's v1 results
// are stored exactly as before, and a record never shows a player the
// other side's Battle plan.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { resultView, rawLines, RAW_GZIP_OVER, battleRecord, challengeRecord, encounterRecord } from "../utils/fightRecordBuild.js";
import { runBattle } from "../utils/battle/runBattle.js";
import { runChallenge } from "../utils/challenge/runChallenge.js";
import { fightEncounter } from "../utils/encounter/runEncounter.js";
import { setPlan } from "../services/battlePlans.js";
import { createNewUser } from "../utils/userSchema.js";
import { grantCatch } from "../utils/training.js";
import { forViewer, liteRecord } from "../services/fightRecordsApi.js";
import { simulateBattle, loadFullSim } from "../utils/battle/sim.js";
import { closeSimPool } from "../utils/battle/simPool.js";

await loadFullSim(); // the full sim loads on first use (utils/battle/sim.js)

const side = (...ids) => ({ members: ids.map((speciesId) => ({ speciesId, variant: "normal", name: `#${speciesId}`, level: 50 })) });
const full = simulateBattle({ sides: [side(25, 6, 9, 3, 143, 94), side(130, 149, 248, 445, 282, 68)], seed: 3, surge: null, engine: "full" });
const legacy = simulateBattle({ sides: [side(25, 6), side(130, 149)], seed: 3, surge: null, engine: "legacy" });

section("v2 results");
{
  const view = resultView(full);
  assertEqual([view.v, view.steps.length, view.endStatus.length], [2, full.steps.length, 2], "steps and end status are kept");
  assertEqual(rawLines(view), full.raw, "the raw log comes back line for line");
  const big = resultView({ ...full, raw: Array.from({ length: 2000 }, (_, i) => `|move|p1a: s0|Tackle|p2a: s0|${i}`) });
  assertTrue(!big.raw && typeof big.rawGz === "string", `a raw log over ${RAW_GZIP_OVER} bytes is stored gzipped`);
  assertEqual(rawLines(big).length, 2000, "and decodes to every line");
  assertTrue(JSON.stringify(big).length < 2000 * 30, "gzipped, it takes much less room");
}

section("The list stays light");
{
  const lite = liteRecord({ fights: [{ result: resultView(full) }] }).fights[0].result;
  assertEqual(["steps", "raw", "rawGz", "endStatus", "log", "snapshots"].filter((k) => k in lite), [], "the records list leaves out steps, the raw log and per-turn data");
  assertEqual([lite.winner, lite.turns], [full.winner, full.turns], "and keeps the summary");
}

section("v1 results are unchanged");
assertEqual(Object.keys(resultView(legacy)).sort(), ["endedBy", "knockouts", "log", "snapshots", "turns", "winner"], "a legacy result keeps exactly today's fields");

section("Plans stay private");
{
  const record = { sides: [{ id: "A", name: "Ash", plan: "speed" }, { id: "B", name: "Gary", plan: "setup" }] };
  assertEqual(forViewer(record, "A").sides.map((s) => s.plan), ["speed", undefined], "the viewer sees only their own plan");
  assertEqual(forViewer(record, "B").sides.map((s) => s.plan), [undefined, "setup"], "and so does the other player");
  assertEqual(record.sides[1].plan, "setup", "the stored record is never changed");
}

section("Your plan is named in your record (review I6)");
{
  const trainer = (id, speciesIds) => {
    const u = createNewUser(id, id);
    for (const sid of speciesIds) grantCatch(u, sid, "normal", () => 0.5);
    u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
    return u;
  };
  const world = () => {
    const td = { A: trainer("A", [25, 6]), B: trainer("B", [130]) };
    setPlan(td.A, "display", "setup");
    return td;
  };
  const names = { A: "Ash", B: "Gary" };
  const joey = { classKey: "youngster", title: "Youngster", name: "Joey", prize: 50, party: [{ speciesId: 19, level: 5 }], spriteFile: null };
  process.env.FULL_SIM_ENABLED = "1";
  try {
    const td = world();
    const record = battleRecord(await runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", seed: 7 }), names, td);
    assertEqual(record.sides.map((s) => s.plan), [{ id: "setup", name: "Set up & sweep" }, { id: "allout", name: "All-out attack" }], "a full-sim Battle's record names each side's plan");
    assertEqual(forViewer(record, "B").sides.map((s) => s.plan?.name), [undefined, "All-out attack"], "and each player sees only their own");
    const gym = await challengeRecord(await runChallenge({ trainerData: td, userId: "A", key: "brock", seed: 3, pick: "casual" }), "Ash", td);
    assertEqual(gym.sides[0].plan?.id, "setup", "a Challenge's record names the player's plan");
    const met = await fightEncounter({ trainerData: td, userId: "A", encounter: { team: [{ speciesId: 25, variant: "normal" }], trainer: joey }, seed: 5 });
    assertEqual(encounterRecord(met, "Ash", td).sides[0].plan?.id, "setup", "and so does an encounter's");
  } finally {
    delete process.env.FULL_SIM_ENABLED;
  }
  const td = world();
  const legacyRecord = battleRecord(runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", seed: 7 }), names, td);
  assertTrue(legacyRecord.sides.every((s) => !("plan" in s)), "with the switch off, records stay as they are today");
}

await closeSimPool();
finish();
