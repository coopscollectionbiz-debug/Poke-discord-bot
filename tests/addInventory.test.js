// ==========================================================
// tests/addInventory.test.js
// /addinventory must add Shiny Dust where the dashboard and shiny evolutions
// read it (user.items.shiny_dust). It used to write user.shinyDust, which
// nothing reads, so admin grants of dust never reached players.
// ==========================================================

import fs from "fs";
import os from "os";
import path from "path";

// The save queue writes to TRAINERDATA_DIR; use a private scratch folder so
// the test never touches a real data file, and remove it afterwards.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "addinventory-test-"));
process.chdir(scratch);
process.env.TRAINERDATA_DIR = scratch;
process.on("exit", () => {
  try { process.chdir(os.tmpdir()); fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
});
const { default: addinventory } = await import("../commands/addinventory.js");
const { lockUser } = await import("../utils/userLocks.js");

let passed = 0, failed = 0;
function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { console.log(`  ✅ ${message}`); passed++; }
  else { console.error(`  ❌ ${message}\n     Expected: ${JSON.stringify(expected)}\n     Actual: ${JSON.stringify(actual)}`); failed++; }
}

// An admin running /addinventory user:@U1 type:Item name:<name> quantity:<quantity>.
async function addItem(trainerData, name, quantity) {
  const interaction = {
    deferred: false,
    replied: false,
    member: { permissions: { has: () => true } },
    options: {
      getUser: () => ({ id: "U1", username: "tester" }),
      getString: (key) => ({ type: "item", name })[key],
      getBoolean: () => null,
      getInteger: () => quantity,
    },
    async deferReply() { this.deferred = true; },
    async editReply(o) { this.text = o.content; },
    async reply(o) { this.text = o.content; this.replied = true; },
    async followUp(o) { this.text = o.content; },
  };
  await addinventory.execute(interaction, trainerData, async () => {}, async () => {}, lockUser, async () => {}, null);
  return interaction.text;
}

console.log("Shiny Dust");
{
  const trainerData = {};
  const text = await addItem(trainerData, "Shiny Dust", 250);
  assertEqual(trainerData.U1.items.shiny_dust, 250, "a new player's dust lands in items.shiny_dust");
  assertEqual("shinyDust" in trainerData.U1, false, "nothing is written to the unused shinyDust field");
  assertEqual(text?.includes("250× ✨ Shiny Dust"), true, "the admin sees what was added");

  await addItem(trainerData, "shiny_dust", 3);
  assertEqual(trainerData.U1.items.shiny_dust, 253, "more dust adds to the balance");
}

console.log("Shop items");
{
  globalThis.SHOP_ITEMS = {
    stardust: { id: "shiny_dust", name: "Shiny Dust" },
    evolution_stone: { id: "evolution_stone", name: "Evolution Stone" },
  };
  const trainerData = {};
  await addItem(trainerData, "stardust", 2);
  assertEqual(trainerData.U1.items.shiny_dust, 2, "a shop item whose id is shiny_dust also lands in items.shiny_dust");
  await addItem(trainerData, "evolution_stone", 4);
  assertEqual(trainerData.U1.items.evolution_stone, 4, "other items still work");
  delete globalThis.SHOP_ITEMS;
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
