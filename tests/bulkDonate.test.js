// ==========================================================
// tests/bulkDonate.test.js
// Unit tests for the bulk donation rules (Donate Duplicates + Multi-select)
// ==========================================================

import { bulkDonate } from "../utils/bulkDonate.js";
import { normalizeBox } from "../services/box.js";
// Live users are migrated to individual copies at load (docs/adr/0001);
// fixtures are too, before any "nothing changed" snapshot is taken.
const migrated = (u) => { normalizeBox(u); return u; };

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
  16: { name: "Pidgey", tier: "common" },
  19: { name: "Rattata", tier: "common" },
  25: { name: "Pikachu", tier: "rare" },
  41: { name: "Zubat", tier: "common" },
  150: { name: "Mewtwo", tier: "legendary" },
};

// Every normal roll returns `rolled` dust unless a test overrides it.
function makeEconomy({ rolled = 0, weeklyCap = 8 } = {}) {
  return {
    ccByTier: { common: 250, uncommon: 500, rare: 1000, epic: 2500, legendary: 5000, mythic: 10000 },
    shinyDustByTier: { common: 4, uncommon: 7, rare: 12, epic: 18, legendary: 22, mythic: 30 },
    normalDustChanceByTier: { common: [{ chance: 1, dust: 1 }] },
    normalDustWeeklyCap: weeklyCap,
    rollDust: () => rolled,
  };
}

function makeUser(overrides = {}) {
  return {
    cc: 1000,
    items: { shiny_dust: 5 },
    nonShinyDustEarnedThisWeek: 0,
    pokemon: {
      1: { normal: 1, shiny: 0 }, // on Team
      4: { normal: 3, shiny: 0 }, // normal on Team
      16: { normal: 4, shiny: 2 },
      19: { normal: 2, shiny: 0 },
      25: { normal: 1, shiny: 1 },
      41: { normal: 1, shiny: 0 },
    },
    displayedPokemon: [
      { id: 1, variant: "normal" },
      { id: 4, variant: "normal" },
    ],
    ...overrides,
  };
}

function run(user, mode, items, economy = makeEconomy()) {
  const isOnTeam = (pid, variant) =>
    user.displayedPokemon.some((s) => s.id === pid && s.variant === variant);
  return bulkDonate({ user, mode, items, pokemonData, economy, isOnTeam });
}

// Asserts the call was rejected with a message containing `fragment`
// and that the user object was not touched.
function assertRejected(user, mode, items, fragment, label) {
  const before = structuredClone(migrated(user));
  const result = run(user, mode, items);
  assertTrue(
    typeof result.error === "string" && result.error.includes(fragment),
    `${label}: rejected with "${fragment}" (got: ${JSON.stringify(result.error)})`
  );
  assertEqual(user, before, `${label}: user unchanged`);
}

// ==========================================================
// Donate Duplicates
// ==========================================================
test("duplicates trims each variant to 1, shinies included", () => {
  const user = makeUser();
  const result = run(user, "duplicates", [
    { pokeId: 16, variant: "normal", count: 3 },
    { pokeId: 16, variant: "shiny", count: 1 },
    { pokeId: 19, variant: "normal", count: 1 },
  ]);

  assertEqual(result.error, undefined, "no error");
  assertEqual(user.pokemon[16], { normal: 1, shiny: 1 }, "Pidgey x4 · ✨x2 becomes x1 · ✨x1");
  assertEqual(user.pokemon[19], { normal: 1, shiny: 0 }, "Rattata x2 becomes x1");
  assertEqual(result.donatedCopies, 5, "5 copies donated");
  // 4 normal × 250 + 1 shiny × 250 × 5
  assertEqual(result.gainedCC, 2250, "CC: 4 × 250 + 1 × 1250");
  assertEqual(user.cc, 3250, "user CC increased by gainedCC");
});

test("duplicates donates the extras of a Team variant and keeps the Team copy", () => {
  const user = makeUser();
  const result = run(user, "duplicates", [{ pokeId: 4, variant: "normal", count: 2 }]);

  assertEqual(result.error, undefined, "no error");
  assertEqual(user.pokemon[4], { normal: 1, shiny: 0 }, "Charmander x3 becomes x1");
  assertEqual({ id: user.displayedPokemon[1].id, variant: user.displayedPokemon[1].variant }, { id: 4, variant: "normal" }, "Charmander still on Team");
  assertTrue(!!user.box?.[user.displayedPokemon[1].uid], "the slot names the copy that stayed");
});

test("duplicates rejects a row that would leave no copies (stale preview race)", () => {
  // Modal showed Pidgey x4 → donate 3. Another tab donated one, so the user now has x3.
  const user = makeUser();
  user.pokemon[16].normal = 3;
  assertRejected(
    user,
    "duplicates",
    [
      { pokeId: 19, variant: "normal", count: 1 },
      { pokeId: 16, variant: "normal", count: 3 },
    ],
    "You have 3 Pidgey now, so donating 3 would leave none.",
    "Pidgey race"
  );
});

test("duplicates rejects a row for a variant the user no longer owns", () => {
  const user = makeUser();
  assertRejected(
    user,
    "duplicates",
    [{ pokeId: 150, variant: "shiny", count: 1 }],
    "You have 0 shiny Mewtwo now",
    "unowned shiny"
  );
});

// ==========================================================
// Multi-select
// ==========================================================
test("multiselect donates single copies, including a lone shiny", () => {
  const user = makeUser({
    pokemon: {
      41: { normal: 1, shiny: 0 },
      150: { normal: 0, shiny: 1 },
    },
    displayedPokemon: [],
  });
  const result = run(user, "multiselect", [
    { pokeId: 41, variant: "normal", count: 1 },
    { pokeId: 150, variant: "shiny", count: 1 },
  ]);

  assertEqual(result.error, undefined, "no error");
  assertEqual(user.pokemon, {}, "both entries deleted once empty");
  assertEqual(result.donatedCopies, 2, "2 copies donated");
  assertEqual(result.gainedCC, 250 + 5000 * 5, "CC: Zubat 250 + shiny Mewtwo 25,000");
});

test("multiselect rejects a count above 1", () => {
  assertRejected(
    makeUser(),
    "multiselect",
    [{ pokeId: 41, variant: "normal", count: 2 }],
    "one copy",
    "count 2"
  );
});

test("multiselect rejects a Pokémon owned more than once", () => {
  assertRejected(
    makeUser(),
    "multiselect",
    [{ pokeId: 19, variant: "normal", count: 1 }],
    "You have more than one Rattata now.",
    "Rattata x2"
  );
});

test("multiselect rejects a Pokémon owned as one normal and one shiny", () => {
  assertRejected(
    makeUser(),
    "multiselect",
    [{ pokeId: 25, variant: "normal", count: 1 }],
    "You have more than one Pikachu now.",
    "Pikachu x1 · ✨x1"
  );
});

test("multiselect rejects a Team member", () => {
  assertRejected(
    makeUser(),
    "multiselect",
    [{ pokeId: 1, variant: "normal", count: 1 }],
    "Bulbasaur is on one of your teams. Take it off that team first.",
    "Bulbasaur on Team"
  );
});

test("multiselect rejects a copy that is gone (owned 0) without going negative", () => {
  const user = makeUser();
  delete user.pokemon[41];
  assertRejected(
    user,
    "multiselect",
    [{ pokeId: 41, variant: "normal", count: 1 }],
    "You no longer have a Zubat.",
    "Zubat gone"
  );
});

test("multiselect rejects a variant that changed (normal converted to shiny)", () => {
  const user = makeUser();
  user.pokemon[41] = { normal: 0, shiny: 1 };
  assertRejected(
    user,
    "multiselect",
    [{ pokeId: 41, variant: "normal", count: 1 }],
    "You no longer have a Zubat.",
    "Zubat now shiny"
  );
});

// ==========================================================
// Malformed input (trust boundary)
// ==========================================================
test("rejects malformed requests", () => {
  const ok = { pokeId: 19, variant: "normal", count: 1 };
  assertRejected(makeUser(), "everything", [ok], "Invalid mode", "unknown mode");
  assertRejected(makeUser(), "duplicates", [], "Nothing to donate", "empty items");
  assertRejected(makeUser(), "duplicates", "nope", "Nothing to donate", "items not an array");
  assertRejected(makeUser(), "duplicates", [null], "Invalid Pokémon", "null row");
  assertRejected(
    makeUser(),
    "duplicates",
    [{ ...ok, pokeId: 9999 }],
    "Invalid Pokémon",
    "unknown pokeId"
  );
  assertRejected(
    makeUser(),
    "duplicates",
    [{ ...ok, variant: "golden" }],
    "Invalid variant",
    "bad variant is not coerced to normal"
  );
  assertRejected(
    makeUser(),
    "duplicates",
    [{ ...ok, count: 0 }],
    "Invalid count",
    "count 0"
  );
  assertRejected(
    makeUser(),
    "duplicates",
    [{ ...ok, count: 1.5 }],
    "Invalid count",
    "fractional count"
  );
  assertRejected(
    makeUser(),
    "duplicates",
    [{ pokeId: 16, variant: "normal", count: 1 }, { pokeId: 16, variant: "normal", count: 1 }],
    "listed twice",
    "repeated row"
  );
});

// ==========================================================
// Shiny Dust
// ==========================================================
test("shiny copies give fixed tier dust; normal copies roll", () => {
  const user = makeUser();
  const result = run(
    user,
    "duplicates",
    [
      { pokeId: 16, variant: "shiny", count: 1 },
      { pokeId: 16, variant: "normal", count: 3 },
    ],
    makeEconomy({ rolled: 1 })
  );

  assertEqual(result.shinyDustGained, 4 + 3, "4 fixed (common shiny) + 3 rolled");
  assertEqual(user.items.shiny_dust, 5 + 7, "dust added to inventory");
  assertEqual(user.nonShinyDustEarnedThisWeek, 3, "only rolled dust counts toward the weekly cap");
});

test("normal dust stops at the weekly cap; shiny dust ignores it", () => {
  const user = makeUser({ nonShinyDustEarnedThisWeek: 7 });
  const result = run(
    user,
    "duplicates",
    [
      { pokeId: 16, variant: "normal", count: 3 },
      { pokeId: 16, variant: "shiny", count: 1 },
    ],
    makeEconomy({ rolled: 2, weeklyCap: 8 })
  );

  assertEqual(result.shinyDustGained, 1 + 4, "1 left under the cap + 4 shiny");
  assertEqual(user.nonShinyDustEarnedThisWeek, 8, "earned this week clamps at the cap");
});

test("returns one event per copy for the admin log", () => {
  const user = makeUser();
  const result = run(
    user,
    "duplicates",
    [
      { pokeId: 19, variant: "normal", count: 1 },
      { pokeId: 16, variant: "shiny", count: 1 },
    ],
    makeEconomy({ rolled: 0 })
  );

  assertEqual(
    result.events,
    [
      { pokemonId: 19, pokemonName: "Rattata", tier: "common", variant: "normal", ccGained: 250, dustGained: 0 },
      { pokemonId: 16, pokemonName: "Pidgey", tier: "common", variant: "shiny", ccGained: 1250, dustGained: 4 },
    ],
    "event payloads match the single-donate shape"
  );
});

// ==========================================================
// Levels
// ==========================================================
test("a donated-away Pokémon's Level resets; one with a copy left keeps its Level", () => {
  const user = makeUser({
    pokemon: {
      41: { normal: 1, shiny: 0 },
      16: { normal: 4, shiny: 0 },
    },
    displayedPokemon: [],
    training: { "41:normal": { exp: 27000 }, "16:normal": { exp: 8000 } },
  });

  assertEqual(run(user, "multiselect", [{ pokeId: 41, variant: "normal", count: 1 }]).error, undefined, "multiselect: no error");
  assertEqual(user.training["41:normal"], undefined, "Zubat's Level goes with its last copy");

  assertEqual(run(user, "duplicates", [{ pokeId: 16, variant: "normal", count: 3 }]).error, undefined, "duplicates: no error");
  assertEqual(user.training["16:normal"], { exp: 8000 }, "Pidgey keeps its Level with one copy left");
});

// ==========================================================
// Summary
// ==========================================================
console.log("\n" + "=".repeat(60));
console.log(`📊 bulkDonate: ${testsPassed} passed, ${testsFailed} failed (${testsRun} tests)`);
console.log("=".repeat(60));
process.exit(testsFailed > 0 ? 1 : 0);
