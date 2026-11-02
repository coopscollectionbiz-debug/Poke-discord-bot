// ==========================================================
// tests/bulkRules.test.js
// Unit tests for the dashboard's bulk donate rules
// (public/picker-pokemon/bulkRules.js), plus checks that the
// server (utils/bulkDonate.js) accepts what the dashboard offers.
// ==========================================================

import { duplicateRows, multiSelectBlock, onlyVariant } from "../public/picker-pokemon/bulkRules.js";
import { bulkDonate } from "../utils/bulkDonate.js";

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

function assertTrue(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ ${message}`);
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

// ----------------------------------------------------------
// Fixtures
// ----------------------------------------------------------
const pokemonData = {
  1: { name: "Bulbasaur", tier: "common" },
  4: { name: "Charmander", tier: "common" },
  7: { name: "Squirtle", tier: "common" },
  16: { name: "Pidgey", tier: "common" },
  19: { name: "Rattata", tier: "common" },
  25: { name: "Pikachu", tier: "rare" },
  41: { name: "Zubat", tier: "common" },
  92: { name: "Gastly", tier: "uncommon" },
  150: { name: "Mewtwo", tier: "legendary" },
};

function makeCollection() {
  return {
    1: { normal: 1, shiny: 0 }, // on Team
    4: { normal: 3, shiny: 0 }, // on Team, with duplicates
    7: { normal: 1, shiny: 0 },
    16: { normal: 4, shiny: 2 },
    19: { normal: 2, shiny: 0 },
    25: { normal: 1, shiny: 1 },
    41: { normal: 1, shiny: 0 },
    92: { normal: 0, shiny: 3 }, // shiny-only duplicates
    150: { normal: 0, shiny: 1 }, // lone shiny
    9999: { normal: 5, shiny: 0 }, // not in pokemonData (removed from the game)
  };
}

const savedTeam = [
  { id: 1, variant: "normal" },
  { id: 4, variant: "normal" },
  { id: 7, variant: "shiny" }, // Team shows a shiny Squirtle the player doesn't own
];

const block = (pid, pokemon = makeCollection(), team = savedTeam) =>
  multiSelectBlock(pid, { pokemon, pokemonData, savedTeam: team });

// The server in the same state the dashboard sees.
function serverDonate(mode, items, pokemon = makeCollection()) {
  const user = {
    cc: 0,
    items: {},
    nonShinyDustEarnedThisWeek: 0,
    pokemon,
    displayedPokemon: savedTeam,
  };
  const result = bulkDonate({
    user,
    mode,
    items,
    pokemonData,
    economy: {
      ccByTier: { common: 250, uncommon: 500, rare: 1000, epic: 2500, legendary: 5000, mythic: 10000 },
      shinyDustByTier: { common: 4, uncommon: 7, rare: 12, epic: 18, legendary: 22, mythic: 30 },
      normalDustChanceByTier: {},
      normalDustWeeklyCap: 8,
      rollDust: () => 0,
    },
    isOnTeam: (pid, variant) => savedTeam.some((s) => s.id === pid && s.variant === variant),
  });
  return { result, user };
}

// ==========================================================
// Donate Duplicates
// ==========================================================
test("duplicateRows lists every copy past the first, per variant, sorted by ID", () => {
  assertEqual(
    duplicateRows(makeCollection(), pokemonData),
    [
      { pokeId: 4, variant: "normal", count: 2 },
      { pokeId: 16, variant: "normal", count: 3 },
      { pokeId: 16, variant: "shiny", count: 1 },
      { pokeId: 19, variant: "normal", count: 1 },
      { pokeId: 92, variant: "shiny", count: 2 },
    ],
    "Team Charmander extras, Pidgey both variants, Rattata, shiny Gastly; no x1 rows; unknown #9999 skipped"
  );
});

test("duplicateRows handles an empty or missing collection", () => {
  assertEqual(duplicateRows({}, pokemonData), [], "empty collection");
  assertEqual(duplicateRows(undefined, pokemonData), [], "missing collection");
});

test("the server accepts every duplicate row and leaves 1 of each variant", () => {
  const rows = duplicateRows(makeCollection(), pokemonData);
  const { result, user } = serverDonate("duplicates", rows);

  assertEqual(result.error, undefined, "server accepts the whole list");
  assertEqual(result.donatedCopies, 9, "2 + 3 + 1 + 1 + 2 copies");
  for (const { pokeId, variant } of rows) {
    assertEqual(user.pokemon[pokeId][variant], 1, `${pokemonData[pokeId].name} ${variant} left at 1`);
  }
  assertEqual(duplicateRows(user.pokemon, pokemonData), [], "no duplicates left afterward");
});

// ==========================================================
// Multi-select
// ==========================================================
test("multiSelectBlock explains each lock", () => {
  assertEqual(block(19)?.title, "🔒 More Than One Copy", "Rattata x2");
  assertTrue(
    block(19)?.message.startsWith("You have 2 Rattata."),
    `Rattata x2 message names the count (got: ${block(19)?.message})`
  );
  assertTrue(
    block(92)?.message.startsWith("You have 3 shiny Gastly."),
    `shiny-only duplicates name the shiny count (got: ${block(92)?.message})`
  );
  assertEqual(block(25)?.title, "🔒 You Own Both Variants", "Pikachu x1 · ✨x1");
  assertEqual(block(39)?.title, "🔒 Not Owned", "unowned Pokémon");
  assertEqual(block(1)?.title, "🔒 On Your Team", "Bulbasaur on the saved Team");
  assertEqual(block(41), null, "Zubat x1 is selectable");
  assertEqual(block(150), null, "a lone shiny is selectable");
});

test("the Team lock matches the variant on the Team", () => {
  assertEqual(block(7), null, "Team has shiny Squirtle, player owns only a normal: selectable");
  assertEqual(
    block(150, makeCollection(), [{ id: 150, variant: "shiny" }])?.title,
    "🔒 On Your Team",
    "lone shiny Mewtwo on the Team is locked"
  );
});

test("onlyVariant returns the variant of a single copy", () => {
  assertEqual(onlyVariant(makeCollection(), 41), "normal", "normal Zubat");
  assertEqual(onlyVariant(makeCollection(), 150), "shiny", "shiny Mewtwo");
});

test("the server accepts every selectable Pokémon and refuses every locked one", () => {
  const ids = Object.keys(pokemonData).map(Number);
  const selectable = ids.filter((pid) => block(pid) === null);
  assertEqual(selectable, [7, 41, 150], "selectable: Squirtle, Zubat, shiny Mewtwo");

  const { result } = serverDonate(
    "multiselect",
    selectable.map((pid) => ({ pokeId: pid, variant: onlyVariant(makeCollection(), pid), count: 1 }))
  );
  assertEqual(result.error, undefined, "server accepts all selectable Pokémon together");

  for (const pid of ids.filter((id) => block(id) !== null)) {
    const { result: r } = serverDonate("multiselect", [
      { pokeId: pid, variant: onlyVariant(makeCollection(), pid), count: 1 },
    ]);
    assertTrue(
      typeof r.error === "string",
      `server refuses locked ${pokemonData[pid].name} (got: ${JSON.stringify(r.error)})`
    );
  }
});

// ==========================================================
// Summary
// ==========================================================
console.log("\n" + "=".repeat(60));
console.log(`📊 bulkRules: ${testsPassed} passed, ${testsFailed} failed (${testsRun} tests)`);
console.log("=".repeat(60));
process.exit(testsFailed > 0 ? 1 : 0);
