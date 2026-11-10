// ==========================================================
// tests/pokemonPower.test.js
// Per-Pokémon Power (dashboard sort) must be the same six-stat total that
// /showteam's Team Power adds up (utils/battle/power.js teamPower).
// ==========================================================

import { pokemonPower, powersFromLevels, teamPower } from "../utils/battle/power.js";
import { getSpecies } from "../utils/battle/data.js";

let passed = 0;
let failed = 0;
function check(cond, message) {
  if (cond) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.error(`  ❌ ${message}`); }
}

console.log("\n🧪 pokemonPower matches teamPower for a single member");
let mismatches = 0;
let checked = 0;
for (let id = 1; id <= 1025; id++) {
  if (!getSpecies(id)) continue;
  for (const level of [1, 5, 16, 50, 100]) {
    checked++;
    if (pokemonPower(id, level) !== teamPower([{ speciesId: id, level }])) mismatches++;
  }
}
check(checked > 0 && mismatches === 0, `${checked} species×Level pairs agree with teamPower`);

console.log("\n🧪 worked example and Team sum");
check(pokemonPower(25, 16) === 160, "Pikachu Lv 16 = 160 (39+25+17+23+20+36)");
const team = [{ speciesId: 25, level: 16 }, { speciesId: 6, level: 36 }, { speciesId: 1, level: 5 }];
check(
  team.reduce((s, m) => s + pokemonPower(m.speciesId, m.level), 0) === teamPower(team),
  "sum of member Powers equals Team Power"
);

console.log("\n🧪 powersFromLevels");
const powers = powersFromLevels({ "25:normal": 16, "25:shiny": 16, "6:normal": 36, "999999:normal": 5 });
check(powers["25:normal"] === 160 && powers["25:shiny"] === 160, "shiny and normal at the same Level have the same Power");
check(powers["6:normal"] === pokemonPower(6, 36), "keys map to that species' Power");
check(!("999999:normal" in powers), "species without battle data are left out");
check(JSON.stringify(powersFromLevels(undefined)) === "{}", "no levels → empty map");
check(pokemonPower(25, "x") === null, "non-numeric Level → null");

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
