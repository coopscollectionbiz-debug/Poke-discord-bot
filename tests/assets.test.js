// ==========================================================
// tests/assets.test.js
// Trainer ownership (D1), save acknowledgment (D14), the gift and recruit
// helpers (D3/D7/D18), and the recruit/quest pool (D11).
// ==========================================================

import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import {
  normalizeTrainers,
  grantTrainer,
  revokeTrainer,
  ownsTrainer,
  trainerCount,
  auditUser,
  auditTrainerData,
} from "../services/assets.js";
import { saveAndAck, withSaveNote, SAVE_DELAYED_NOTE } from "../utils/saveManager.js";
import { createNewUser, validateUserSchema } from "../utils/userSchema.js";
import { giftTrainer, giftCoins } from "../commands/gift.js";
import { chargeAndGrant, recruitPool, RECRUIT_MAX_DEX } from "../commands/recruit.js";
import { addTrainer, isTrainerOwned, getOwnedTrainerCount } from "../utils/trainerFileHandler.js";
import { lockUsers } from "../utils/userLocks.js";

const roundTrip = (o) => JSON.parse(JSON.stringify(o));

section("Trainer ownership survives a save/load round trip (D1)");
{
  // The old bug: arr["file.png"] = 1 on an array is dropped by JSON.stringify.
  const broken = { trainers: ["a.png"] };
  broken.trainers["b.png"] = 1;
  assertEqual(roundTrip(broken).trainers, ["a.png"], "(the old write really was lost on save)");

  const u = { trainers: ["a.png"] };
  assertTrue(grantTrainer(u, "b.png"), "granting a new trainer returns true");
  assertEqual(roundTrip(u).trainers, ["a.png", "b.png"], "a granted trainer is still there after JSON round trip");
  assertTrue(!grantTrainer(u, "B.PNG"), "granting an owned trainer (any case) is a no-op");
  assertEqual(u.trainers.length, 2, "no duplicate added");

  const legacy = { trainers: { "x.png": true, "y.png": 3 } };
  grantTrainer(legacy, "z.png");
  assertEqual(roundTrip(legacy).trainers, ["x.png", "y.png", "z.png"], "legacy object map is converted, nothing lost");

  const rescued = { trainers: ["a.png"] };
  rescued.trainers["lost.png"] = 1;
  normalizeTrainers(rescued);
  assertEqual(roundTrip(rescued).trainers, ["a.png", "lost.png"], "keys written onto an array are rescued by normalize");

  const caseKeep = { trainers: ["Lass.png", "lass.png"] };
  normalizeTrainers(caseKeep);
  assertEqual(caseKeep.trainers.length, 2, "normalize never merges keys that differ only in case");

  assertTrue(revokeTrainer(u, "A.png") && !ownsTrainer(u, "a.png"), "revoke is case-insensitive");
  assertEqual(trainerCount({ trainers: { p: 1, q: 1 } }), 2, "count works on legacy maps");
  let threw = false;
  try { grantTrainer(u, ""); } catch { threw = true; }
  assertTrue(threw, "an empty trainer key is a caller bug and throws");
}

section("New and repaired records use an array");
{
  assertTrue(Array.isArray(createNewUser("9", "Nine").trainers), "createNewUser starts with trainers []");
  const r = { id: "8", trainers: { "a.png": 1 } };
  validateUserSchema(r, "8", "Eight");
  assertEqual(r.trainers, ["a.png"], "validateUserSchema converts a legacy map in place");
}

section("trainerFileHandler wrappers keep arrays (D1)");
{
  const u = { trainers: [] };
  addTrainer(u, { filename: "lass-gen4.png" });
  assertEqual(roundTrip(u).trainers, ["lass-gen4.png"], "addTrainer writes into the array");
  assertTrue(isTrainerOwned(u, { filename: "LASS-gen4" }), "isTrainerOwned ignores .png and case");
  assertEqual(getOwnedTrainerCount(u), 1, "count");
}

section("Gift helpers (D1, D7)");
{
  const a = { cc: 50, trainers: ["a.png", "b.png"] };
  const b = { cc: 0, trainers: [] };
  assertEqual(giftTrainer(a, b, "a.png", "A"), null, "a trainer gift succeeds");
  assertEqual([roundTrip(a).trainers, roundTrip(b).trainers], [["b.png"], ["a.png"]], "the trainer moves and survives a save");
  assertTrue(giftTrainer(a, b, "b.png", "B") !== null, "the last trainer can't be gifted");
  assertTrue(giftTrainer(a, b, "zzz.png", "Z") !== null, "an unowned trainer can't be gifted");
  assertTrue(giftTrainer({ trainers: ["c.png", "d.png"] }, b, "a.png", "A") !== null, "refused: you don't own it");

  assertEqual(giftCoins(a, b, 20), null, "a CC gift succeeds");
  assertEqual([a.cc, b.cc], [30, 20], "CC moves exactly");
  assertTrue(giftCoins(a, b, 31) !== null && a.cc === 30 && b.cc === 20, "an over-balance gift is refused and moves nothing");
}

section("Recruit charge-and-grant is all-or-nothing (D18)");
{
  const poor = { cc: 99, trainers: [] };
  let granted = false;
  const r1 = chargeAndGrant(poor, () => { granted = true; });
  assertTrue(!r1.ok && !granted && poor.cc === 99, "not enough CC: nothing granted, nothing charged");
  const rich = { cc: 150, trainers: [] };
  const r2 = chargeAndGrant(rich, (u) => grantTrainer(u, "t.png"), 1234);
  assertTrue(r2.ok && rich.cc === 50 && rich.lastRecruit === 1234 && ownsTrainer(rich, "t.png"), "enough CC: charged once, granted once");
}

section("Recruit/quest pool is not empty (D11)");
{
  const dex = JSON.parse(fs.readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));
  const all = Object.values(dex).map((p) => ({ ...p, id: Number(p.id) }));
  const pool = recruitPool(all);
  assertTrue(pool.length > 600, `pool has ${pool.length} Pokémon (filtering on a missing 'generation' field gave 0)`);
  assertTrue(pool.every((p) => p.id >= 1 && p.id <= RECRUIT_MAX_DEX), "only national dex 1–649");
}

section("Save acknowledgment (D14)");
{
  const ok = await saveAndAck({ u: {} }, { save: async () => true });
  assertEqual(ok, { saved: true, note: "" }, "a confirmed save has no note");
  const quiet = console.error; console.error = () => {};
  const failed = await saveAndAck({ u: {} }, { save: async () => false });
  const thrown = await saveAndAck({ u: {} }, { save: async () => { throw new Error("disk"); } });
  console.error = quiet;
  assertEqual(failed.saved, false, "a failed save is reported as not saved");
  assertEqual(thrown.saved, false, "a throwing save is reported as not saved");
  assertTrue(withSaveNote("Done!", failed).includes(SAVE_DELAYED_NOTE), "the reply carries the delay note");
  assertEqual(withSaveNote("Done!", ok), "Done!", "no note when saved");
}

section("Two-user lock (gift)");
{
  const order = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await Promise.all([
    lockUsers("A", "B", async () => { order.push("1s"); await sleep(20); order.push("1e"); }),
    lockUsers("B", "A", async () => { order.push("2s"); await sleep(5); order.push("2e"); }),
  ]);
  assertEqual(order, ["1s", "1e", "2s", "2e"], "opposite-direction gifts run one after the other, no deadlock");
}

section("Audit (report-only)");
{
  const bad = { cc: -5, tp: 1, trainers: { a: 1 }, pokemon: { 25: { normal: 1.5 } }, items: { x: -1 } };
  const p = auditUser(bad);
  assertTrue(p.length === 4, `finds the 4 problems (${p.join("; ")})`);
  const sum = auditTrainerData({ 1: bad, 2: { cc: 1, tp: 1, trainers: [], pokemon: {}, items: {} } });
  assertEqual([sum.users, sum.usersWithProblems], [2, 1], "summary counts users");
  assertTrue(!JSON.stringify(sum).includes("\"1\""), "the summary never names a user id");
}

finish();
