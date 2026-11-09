// ==========================================================
// tests/regions.test.js
// Region grouping + Pokédex completion counts (public/picker-pokemon/regions.js)
// ==========================================================

import fs from "fs";
import { getRegions, countOwned } from "../public/picker-pokemon/regions.js";

// Simple test harness
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ✅ ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ ${message}`);
    console.error(`     Expected: ${JSON.stringify(expected)}`);
    console.error(`     Actual: ${JSON.stringify(actual)}`);
    testsFailed++;
  }
}

function test(name, fn) {
  testsRun++;
  console.log(`\n🧪 Test ${testsRun}: ${name}`);
  try {
    fn();
  } catch (err) {
    console.error(`  ❌ Test threw error: ${err.message}`);
    console.error(err.stack);
    testsFailed++;
  }
}

// The same file the dashboard page fetches
const pokemonData = JSON.parse(
  fs.readFileSync(new URL("../public/pokemonData.json", import.meta.url))
);

const fixture = {
  1: { id: 1, name: "Bulbasaur", region: "Kanto" },
  2: { id: 2, name: "Chikorita", region: "Johto" },
  3: { id: 3, name: "Venusaur", region: "Kanto" },
};

test("getRegions orders regions by lowest ID and groups non-adjacent IDs", () => {
  assertEqual(
    getRegions(fixture),
    [
      { name: "Kanto", ids: [1, 3] },
      { name: "Johto", ids: [2] },
    ],
    "Kanto (from #1) comes first and collects #1 and #3"
  );
});

test("getRegions on the real Pokémon data", () => {
  const regions = getRegions(pokemonData);
  assertEqual(
    regions.map((r) => r.name),
    ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"],
    "Nine regions in Pokédex order"
  );
  assertEqual(
    regions.map((r) => r.ids.length),
    [151, 100, 135, 107, 156, 72, 88, 96, 120],
    "Region sizes match the data"
  );
  assertEqual(regions[0].ids.slice(0, 3), [1, 2, 3], "IDs ascend within a region");
  assertEqual(regions[1].ids[0], 152, "Johto starts at #152");
});

test("countOwned counts each Pokémon once across variants", () => {
  const [kanto] = getRegions(fixture);
  assertEqual(countOwned(kanto, { 1: { normal: 2, shiny: 1 } }), 1, "Normal + shiny Bulbasaur = 1");
  assertEqual(countOwned(kanto, { 3: { normal: 0, shiny: 1 } }), 1, "Shiny-only counts");
  assertEqual(
    countOwned(kanto, { 1: { normal: 1, shiny: 0 }, 3: { normal: 1, shiny: 0 } }),
    2,
    "Two different Pokémon = 2"
  );
});

test("countOwned ignores what isn't currently owned in the region", () => {
  const [kanto] = getRegions(fixture);
  assertEqual(countOwned(kanto, {}), 0, "Player with no Pokémon = 0");
  assertEqual(countOwned(kanto, { 1: { normal: 0, shiny: 0 } }), 0, "Zero-copy entry doesn't count");
  assertEqual(countOwned(kanto, { 2: { normal: 1, shiny: 0 } }), 0, "Johto Pokémon doesn't count toward Kanto");
  assertEqual(countOwned(kanto, { 9999: { normal: 1, shiny: 0 } }), 0, "ID missing from the data is ignored");
});

console.log("\n" + "=".repeat(50));
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsRun} total`);

if (testsFailed > 0) {
  console.log("\n❌ Some tests failed\n");
  process.exit(1);
} else {
  console.log("\n✅ All tests passed!\n");
  process.exit(0);
}
