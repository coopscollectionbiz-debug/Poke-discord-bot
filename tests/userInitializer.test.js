// ==========================================================
// tests/userInitializer.test.js
// ensureUserInitialized must keep the SAME object in trainerData, so code
// still holding a reference (collectors, queued rewards) doesn't lose updates.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

const log = console.log;
console.log = () => {};

const trainerData = { 1: { id: "1", cc: 100, tp: 0, pokemon: {}, trainers: [], items: {} } };
const held = trainerData[1];
const returned = await ensureUserInitialized("1", "Ash", trainerData, null);
held.cc += 500;

const fresh = {};
const created = await ensureUserInitialized("2", "Misty", fresh, null);

console.log = log;

section("Existing user");
assertTrue(returned === held, "returns the stored object, not a copy");
assertTrue(trainerData[1] === held, "trainerData keeps the same object");
assertEqual(trainerData[1].cc, 600, "an update made through an older reference is kept");
assertEqual(trainerData[1].items.evolution_stone, 0, "missing fields are still repaired");

section("New user");
assertTrue(fresh[2] === created, "a new user is stored and returned");

finish();
