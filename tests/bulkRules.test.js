// ==========================================================
// tests/bulkRules.test.js
// Unit tests for the dashboard's bulk donate rules
// (public/picker-pokemon/bulkRules.js), plus checks that the
// server (utils/bulkDonate.js) accepts what the dashboard offers.
// ==========================================================

import { duplicateRows, pickedRows, multiSelectBlock, onlyVariant } from "../public/picker-pokemon/bulkRules.js";
import { bulkDonate, donatableDuplicates } from "../utils/bulkDonate.js";
import { normalizeBox, allCopies, slotsHolding, copiesOf } from "../services/box.js";
import { readFileSync } from "fs";

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

const ECONOMY = {
  ccByTier: { common: 250, uncommon: 500, rare: 1000, epic: 2500, legendary: 5000, mythic: 10000 },
  shinyDustByTier: { common: 4, uncommon: 7, rare: 12, epic: 18, legendary: 22, mythic: 30 },
  normalDustChanceByTier: {},
  normalDustWeeklyCap: 8,
  rollDust: () => 0,
};

// The per-copy rows /api/user-pokemon sends (bot_final.js copyRows).
const TEAM_BITS = { displayedPokemon: 1, battleTeam: 2, showcaseTeam: 4 };
function copyRowsOf(user) {
  normalizeBox(user);
  return allCopies(user).map((c) => [
    c.uid, c.id, c.variant === "shiny" ? 1 : 0, c.level, c.at ?? 0, c.trained ? 1 : 0,
    slotsHolding(user, c.uid).reduce((m, s) => m | (TEAM_BITS[s.field] ?? 0), 0),
    c.exp,
  ]);
}

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

test("the server accepts every duplicate row the dashboard builds from copy rows", () => {
  // Migrate the legacy collection exactly like the bot does on load.
  const user = {
    cc: 0, items: {}, nonShinyDustEarnedThisWeek: 0,
    pokemon: makeCollection(), displayedPokemon: structuredClone(savedTeam),
  };
  normalizeBox(user);
  const rows = duplicateRows(user.pokemon, pokemonData, {}, copyRowsOf(user));
  const topExp = (id, v) => copiesOf(user, id, v).filter((c) => !c.trained)[0]?.exp;
  const topBefore = rows.map((r) => topExp(r.pokeId, r.variant));

  const result = bulkDonate({ user, mode: "duplicates", items: rows.map(({ copies, ...r }) => r), pokemonData, economy: ECONOMY });
  assertEqual(result.error, undefined, "server accepts the whole list");
  assertTrue(result.donatedCopies > 0, `donated ${result.donatedCopies} copies`);
  rows.forEach((r, i) => assertEqual(topExp(r.pokeId, r.variant), topBefore[i], `${pokemonData[r.pokeId].name} ${r.variant}: best copy kept`));
  assertEqual(duplicateRows(user.pokemon, pokemonData, {}, copyRowsOf(user)), [], "nothing left to offer afterward");
});

// Keep the best copy: a team copy is kept, but so is a higher-Level spare.
function keepBestUser() {
  return {
    cc: 0, items: {}, nonShinyDustEarnedThisWeek: 0,
    pokemon: { 4: { normal: 4, shiny: 0 } },
    box: {
      c_teamaaaaaa: { id: 4, exp: 4000 },   // on the team, Lv mid
      c_bestaaaaaa: { id: 4, exp: 90000 },  // spare, the best copy
      c_midaaaaaaa: { id: 4, exp: 2000 },
      c_lowaaaaaaa: { id: 4, exp: 10 },
    },
    displayedPokemon: [{ id: 4, variant: "normal", uid: "c_teamaaaaaa" }],
  };
}

test("Donate Duplicates keeps the best copy even when a lower copy is on a team", () => {
  const user = keepBestUser();
  const rows = duplicateRows(user.pokemon, pokemonData, {}, copyRowsOf(user));
  assertEqual(rows.map((r) => r.uids), [["c_lowaaaaaaa", "c_midaaaaaaa"]], "offers only the two lower spares, lowest first");
  assertEqual(donatableDuplicates(user, 4, "normal"), ["c_lowaaaaaaa", "c_midaaaaaaa"], "server agrees");

  const tooMany = bulkDonate({ user: keepBestUser(), mode: "duplicates", items: [{ pokeId: 4, variant: "normal", count: 3 }], pokemonData, economy: ECONOMY });
  assertTrue(/best copy/.test(tooMany.error || ""), `count past the donatable copies is refused (${tooMany.error})`);

  const u2 = keepBestUser();
  const ok = bulkDonate({ user: u2, mode: "duplicates", items: [{ pokeId: 4, variant: "normal", count: 2 }], pokemonData, economy: ECONOMY });
  assertEqual(ok.error, undefined, "count alone is accepted");
  assertEqual(Object.keys(u2.box).sort(), ["c_bestaaaaaa", "c_teamaaaaaa"], "team copy and best copy stay");
});

test("Donate Duplicates donates exactly the copies the player left ticked", () => {
  const user = keepBestUser();
  const rows = duplicateRows(user.pokemon, pokemonData, {}, copyRowsOf(user));
  const picked = pickedRows(rows, new Set(["c_lowaaaaaaa"])); // kept the mid copy
  assertEqual(picked.map(({ copies, ...r }) => r), [{ pokeId: 4, variant: "normal", count: 1, uids: ["c_lowaaaaaaa"] }], "pickedRows trims uids and count");
  assertEqual(pickedRows(rows, new Set()), [], "nothing ticked → no rows");

  const r = bulkDonate({ user, mode: "duplicates", items: picked.map(({ copies, ...x }) => x), pokemonData, economy: ECONOMY });
  assertEqual(r.donatedCopies, 1, "one copy donated");
  assertEqual(Object.keys(user.box).sort(), ["c_bestaaaaaa", "c_midaaaaaaa", "c_teamaaaaaa"], "the unticked mid copy stays");

  // Naming a copy donates that one, even when a lower spare exists.
  const u3 = keepBestUser();
  const mid = bulkDonate({ user: u3, mode: "duplicates", items: [{ pokeId: 4, variant: "normal", count: 1, uids: ["c_midaaaaaaa"] }], pokemonData, economy: ECONOMY });
  assertEqual(mid.error, undefined, "a named higher spare is donated instead of the lowest");
  assertTrue(!u3.box.c_midaaaaaaa && !!u3.box.c_lowaaaaaaa, "only the named copy left");
});

test("two copies tied for best: either may be donated, never both", () => {
  const tied = () => ({
    cc: 0, items: {}, nonShinyDustEarnedThisWeek: 0,
    pokemon: { 4: { normal: 3, shiny: 0 } },
    box: { c_Aaaaaaaaaa: { id: 4, exp: 500 }, c_baaaaaaaaa: { id: 4, exp: 500 }, c_lowaaaaaaa: { id: 4, exp: 1 } },
  });
  for (const uid of ["c_Aaaaaaaaaa", "c_baaaaaaaaa"]) {
    const user = tied();
    const r = bulkDonate({ user, mode: "duplicates", items: [{ pokeId: 4, variant: "normal", count: 2, uids: ["c_lowaaaaaaa", uid] }], pokemonData, economy: ECONOMY });
    assertEqual(r.error, undefined, `donating ${uid} keeps the other Lv-equal copy`);
  }
  const both = bulkDonate({ user: tied(), mode: "duplicates", items: [{ pokeId: 4, variant: "normal", count: 2, uids: ["c_Aaaaaaaaaa", "c_baaaaaaaaa"] }], pokemonData, economy: ECONOMY });
  assertTrue(typeof both.error === "string", "donating both tied best copies is refused");
  const user = tied();
  assertEqual(duplicateRows(user.pokemon, pokemonData, {}, copyRowsOf(user))[0].count, 2, "dashboard offers 2 of 3");
});

test("Donate Duplicates refuses named copies that must be kept", () => {
  const cases = [
    [["c_bestaaaaaa"], "the best copy"],
    [["c_teamaaaaaa"], "a team copy"],
    [["c_lowaaaaaaa", "c_lowaaaaaaa"], "the same copy twice"],
    [["c_nopeaaaaaa"], "a copy that doesn't exist"],
  ];
  for (const [uids, what] of cases) {
    const user = keepBestUser();
    const r = bulkDonate({ user, mode: "duplicates", items: [{ pokeId: 4, variant: "normal", count: uids.length, uids }], pokemonData, economy: ECONOMY });
    assertTrue(typeof r.error === "string" && Object.keys(user.box).length === 4, `refuses ${what} and changes nothing (${r.error})`);
  }
  const trainedUser = keepBestUser();
  trainedUser.customPokemon = { c_lowaaaaaaa: { tmMoves: ["flamethrower"], rev: 1 } };
  const r = bulkDonate({ user: trainedUser, mode: "duplicates", items: [{ pokeId: 4, variant: "normal", count: 1, uids: ["c_lowaaaaaaa"] }], pokemonData, economy: ECONOMY });
  assertTrue(typeof r.error === "string" && !!trainedUser.box.c_lowaaaaaaa, `refuses a TM-trained copy (${r.error})`);
  const badCount = bulkDonate({ user: keepBestUser(), mode: "duplicates", items: [{ pokeId: 4, variant: "normal", count: 2, uids: ["c_lowaaaaaaa"] }], pokemonData, economy: ECONOMY });
  assertTrue(typeof badCount.error === "string", `refuses a count that doesn't match the list (${badCount.error})`);
});

// Individual copies (#107): two copies of one Pokémon can sit on teams
// (Showcase repeats, or different copies on Casual and Ranked). The counts
// alone offered those, and the all-or-nothing server refused the batch.
test("duplicateRows leaves out copies on any team, and the server accepts the rows", () => {
  const box = {
    "c_p1aaaaaaaa": { id: 25, exp: 900 }, "c_p2aaaaaaaa": { id: 25, exp: 500 }, "c_p3aaaaaaaa": { id: 25, exp: 40 }, "c_p4aaaaaaaa": { id: 25, exp: 10 },
    "c_r1aaaaaaaa": { id: 19, exp: 300 }, "c_r2aaaaaaaa": { id: 19, exp: 5 }, "c_r3aaaaaaaa": { id: 19, exp: 1 },
    "c_g1aaaaaaaa": { id: 92, shiny: true, exp: 0 }, "c_g2aaaaaaaa": { id: 92, shiny: true, exp: 0 },
  };
  const user = {
    cc: 0, items: {}, nonShinyDustEarnedThisWeek: 0,
    pokemon: { 25: { normal: 4, shiny: 0 }, 19: { normal: 3, shiny: 0 }, 92: { normal: 0, shiny: 2 } },
    box,
    showcaseTeam: [{ id: 25, variant: "normal", uid: "c_p1aaaaaaaa" }, { id: 25, variant: "normal", uid: "c_p2aaaaaaaa" }],
    battleTeam: [{ id: 92, variant: "shiny", uid: "c_g1aaaaaaaa" }, null],
    displayedPokemon: [{ id: 92, variant: "shiny", uid: "c_g2aaaaaaaa" }],
  };
  const TEAM_BIT = { displayedPokemon: 1, battleTeam: 2, showcaseTeam: 4 };
  const copies = Object.entries(box).map(([uid, c]) => [
    uid, c.id, c.shiny ? 1 : 0, 1, 0, 0,
    Object.entries(TEAM_BIT).reduce((m, [f, bit]) => ((user[f] || []).some((s) => s?.uid === uid) ? m | bit : m), 0),
    c.exp,
  ]);

  const rows = duplicateRows(user.pokemon, pokemonData, {}, copies);
  assertEqual(
    rows,
    [
      { pokeId: 19, variant: "normal", count: 2, uids: ["c_r3aaaaaaaa", "c_r2aaaaaaaa"], copies: [{ uid: "c_r3aaaaaaaa", level: 1 }, { uid: "c_r2aaaaaaaa", level: 1 }] },
      { pokeId: 25, variant: "normal", count: 2, uids: ["c_p4aaaaaaaa", "c_p3aaaaaaaa"], copies: [{ uid: "c_p4aaaaaaaa", level: 1 }, { uid: "c_p3aaaaaaaa", level: 1 }] },
    ],
    "lowest EXP first; Rattata keeps its best; Pikachu offers only its 2 off-team copies; shiny Gastly (both on teams) not offered"
  );
  assertEqual(duplicateRows(user.pokemon, pokemonData, {}), [
    { pokeId: 19, variant: "normal", count: 2 },
    { pokeId: 25, variant: "normal", count: 3 },
    { pokeId: 92, variant: "shiny", count: 1 },
  ], "without copy rows, the counts alone are used (old payloads)");

  const result = bulkDonate({
    user, mode: "duplicates", items: rows, pokemonData,
    economy: {
      ccByTier: { common: 250, uncommon: 500, rare: 1000 }, shinyDustByTier: {},
      normalDustChanceByTier: {}, normalDustWeeklyCap: 8, rollDust: () => 0,
    },
  });
  assertEqual(result.error, undefined, "server accepts the whole list");
  assertEqual(result.donatedCopies, 4, "2 Rattata + 2 Pikachu");
  assertEqual(Object.keys(user.box).sort(), ["c_g1aaaaaaaa", "c_g2aaaaaaaa", "c_p1aaaaaaaa", "c_p2aaaaaaaa", "c_r1aaaaaaaa"], "team copies and the highest-EXP Rattata stay");
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

test("More Than One Copy says 'then select it' only when Donate Duplicates unlocks the card", () => {
  const user = {
    cc: 0, items: {}, nonShinyDustEarnedThisWeek: 0,
    pokemon: makeCollection(), displayedPokemon: structuredClone(savedTeam),
  };
  const rows = duplicateRows(user.pokemon, pokemonData, {}, copyRowsOf(user));
  const done = bulkDonate({ user, mode: "duplicates", items: rows.map(({ copies, ...r }) => r), pokemonData, economy: ECONOMY });
  assertEqual(done.error, undefined, "Donate Duplicates accepted");
  const after = user.pokemon;

  for (const pid of [19, 92]) {
    const name = pokemonData[pid].name;
    assertTrue(
      block(pid)?.message.endsWith(", then select it."),
      `${name} message says it can be selected (got: ${block(pid)?.message})`
    );
    assertEqual(block(pid, after), null, `${name} is selectable after Donate Duplicates`);
  }

  // Pidgey x4 · ✨x2 ends at 1 of each; Charmander x3 keeps its Team copy
  // (and its best copy, if that isn't the Team one).
  for (const pid of [16, 4]) {
    const name = pokemonData[pid].name;
    assertTrue(
      !block(pid)?.message.includes("select it") && !block(pid)?.message.includes("down to 1"),
      `${name} message doesn't promise it can be selected (got: ${block(pid)?.message})`
    );
    assertTrue(block(pid, after) !== null, `${name} is still locked after Donate Duplicates (${block(pid, after)?.title})`);
  }
  assertEqual(block(16, after)?.title, "🔒 You Own Both Variants", "Pidgey: one of each variant left");
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

// Regression: the box view (#107) returned before updateBulkUI(), so the
// Donate Duplicates / Multi-select row never showed in Donate mode.
test("the dashboard shows the bulk donate row before the box view returns", () => {
  const src = readFileSync(new URL("../public/picker-pokemon/script.js", import.meta.url), "utf8");
  const start = src.indexOf("function renderPokemonGridCards()");
  const body = src.slice(start, src.indexOf("\nfunction ", start + 10));
  const ui = body.indexOf("updateBulkUI();");
  const box = body.indexOf("return renderBoxTiles(");
  assertTrue(start >= 0 && ui >= 0 && box >= 0 && ui < box, "updateBulkUI() runs before renderBoxTiles() returns");
});

// ==========================================================
// Summary
// ==========================================================
console.log("\n" + "=".repeat(60));
console.log(`📊 bulkRules: ${testsPassed} passed, ${testsFailed} failed (${testsRun} tests)`);
console.log("=".repeat(60));
process.exit(testsFailed > 0 ? 1 : 0);
