// ==========================================================
// tests/inventoryRegression.test.js
// Release B routes existing item rewards through services/inventory.js.
// /daily must give exactly what it gave before (1000 CC, 100 TP, 2 Pokémon,
// a 25% Evolution Stone) and keep every other field and item.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inv-regression-"));
process.env.TRAINERDATA_DIR = dir;

const { execute: daily } = await import("../commands/daily.js");
const { lockUser } = await import("../utils/userLocks.js");
const { createNewUser } = await import("../utils/userSchema.js");

const replies = [];
function fakeInteraction(id) {
  return {
    user: { id, username: `Trainer${id}` },
    deferred: false,
    replied: false,
    async deferReply() { this.deferred = true; },
    async editReply(p) { replies.push(p); return p; },
    async reply(p) { this.replied = true; replies.push(p); return p; },
    async followUp(p) { replies.push(p); return p; },
  };
}
const ownedCopies = (u) => Object.values(u.pokemon || {}).reduce((n, e) => n + (e.normal || 0) + (e.shiny || 0), 0);
const quiet = { log: console.log, warn: console.warn };
const realRandom = Math.random;

async function runDaily(trainerData, id, rand) {
  Math.random = () => rand;
  console.log = console.warn = () => {};
  try {
    await daily(fakeInteraction(id), trainerData, null, null, lockUser, null, null);
  } finally {
    Math.random = realRandom;
    Object.assign(console, quiet);
  }
}

section("/daily with the Evolution Stone roll (rand < 0.25)");
{
  const id = "4001";
  const user = createNewUser(id, "Ash");
  user.cc = 50;
  user.tp = 10;
  user.items = { evolution_stone: 2, shiny_dust: 7, old_badge: 1 };
  user.customField = { keep: true };
  const td = { [id]: user };
  const copies = ownedCopies(user);

  await runDaily(td, id, 0.01);
  assertEqual([user.cc, user.tp], [1050, 110], "+1000 CC and +100 TP (unchanged amounts)");
  assertEqual(user.items.evolution_stone, 3, "exactly one Evolution Stone added");
  assertEqual([user.items.shiny_dust, user.items.old_badge], [7, 1], "other items (including legacy ids) untouched");
  assertEqual(ownedCopies(user), copies + 2, "two Pokémon granted");
  assertEqual(user.customField, { keep: true }, "unrelated fields preserved");
  assertTrue(td[id] === user, "the live record is updated in place");

  await runDaily(td, id, 0.01);
  assertEqual([user.cc, user.items.evolution_stone], [1050, 3], "a second claim the same day gives nothing");
}

section("/daily without the stone (rand ≥ 0.25)");
{
  const id = "4002";
  const td = { [id]: createNewUser(id, "Misty") };
  await runDaily(td, id, 0.99);
  assertEqual(td[id].items, { evolution_stone: 0 }, "no stone, bag otherwise unchanged");
  assertEqual(td[id].cc, 1000, "CC still awarded");
}

await new Promise((r) => setTimeout(r, 50));
await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
finish();
process.exit(0);
