// ==========================================================
// tests/power50.test.js — Power at Lv 50 for the Ranked team (dashboard UX
// audit item 1) and the TM shop's category filter and sort (item 4).
// The dashboard must rank Ranked picks by the same number the battle engine
// uses: every member at RANKED.level, Mega stats when the form can battle.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";

const { teamPower, pokemonPower, powersAtRanked, powersFromLevels } = await import("../utils/battle/power.js");
const { RANKED } = await import("../utils/battle/tuning.js");
const { buildBattleTeam } = await import("../utils/battle/runBattle.js");
const { buildMegaCards, useMegaStone } = await import("../services/mega.js");
const { getMega } = await import("../utils/megas.js");
const { filterTms } = await import("../public/dashboardshop/tmFilter.js");

section("powersAtRanked: one Lv 50 Power per species");
const levels = { "18:normal": 90, "25:normal": 100, "25:shiny": 12, "143:normal": 62, "149:normal": 41, "248:normal": 35, "445:normal": 30 };
const p50 = powersAtRanked(levels);
assertEqual(Object.keys(p50).sort(), ["143", "149", "18", "248", "25", "445"], "one entry per species, shiny and normal share it");
for (const id of Object.keys(p50)) {
  assertEqual(p50[id], teamPower([{ speciesId: Number(id), level: RANKED.level }]), `#${id}: same number as teamPower for one member at Lv ${RANKED.level}`);
}
assertEqual(RANKED.level, 50, "Ranked level is 50");

section("The audit's sample: real-level order is not the Ranked order");
const now = powersFromLevels(levels);
const byNow = ["18", "25", "143", "149", "248", "445"].sort((a, b) => Math.max(now[`${b}:normal`] ?? 0) - Math.max(now[`${a}:normal`] ?? 0));
const by50 = ["18", "25", "143", "149", "248", "445"].sort((a, b) => p50[b] - p50[a] || Number(a) - Number(b));
assertEqual(byNow[0], "18", "real-level Power puts the Lv 90 Pidgeot first");
assertEqual(by50.slice(0, 3), ["149", "248", "445"], "at Lv 50 Dragonite, Tyranitar and Garchomp lead");
assertEqual([p50[149], p50[248], p50[445]], [727, 727, 727], "600-total species all reach 727 at Lv 50");
assertEqual(p50[18], 596, "Pidgeot is 596 at Lv 50");
assertTrue(pokemonPower(445, 30) < p50[445], "a Lv 30 Garchomp's own Power is lower than its Ranked Power");

section("The battle engine agrees: Battle team members fight at Lv 50");
const player = {
  id: "500000000000000001", name: "Power Tester", pokemon: { 18: { normal: 1 }, 445: { normal: 1 } },
  training: { "18:normal": { exp: 700000 }, "445:normal": { exp: 30000 } },
  displayedPokemon: [{ id: 18, variant: "normal" }], battleTeam: [{ id: 18, variant: "normal" }, { id: 445, variant: "normal" }],
};
const fighters = buildBattleTeam(player, { env: {} });
assertEqual(fighters.map((m) => m.level), [50, 50], "both members fight at Lv 50 whatever their real Level");
const lv = powersAtRanked({ "18:normal": 1, "445:normal": 1 });
assertEqual(teamPower(fighters), lv[18] + lv[445], "team Power in battle = sum of the dashboard's powers50");

section("Mega cards carry power50 from the form that will fight");
const ON = { MEGA_EVOLUTION_ENABLED: "1" };
const u = { id: "500000000000000002", name: "Mega Tester", pokemon: { 6: { normal: 1 } }, items: { megastone_charizarditex: 1 }, displayedPokemon: [{ id: 6, variant: "normal" }] };
useMegaStone(u, { line: "6:normal", stoneId: "megastone_charizarditex", formId: "mega-charizard-x", now: Date.UTC(2026, 10, 14) }, { env: ON });
const off = buildMegaCards(u, { env: ON }).find((c) => c.formId === "mega-charizard-x");
const on = buildMegaCards(u, { env: { ...ON, MEGA_BATTLES_ENABLED: "1" } }).find((c) => c.formId === "mega-charizard-x");
assertEqual(off.power50, pokemonPower(6, 50), "battles off: the Mega fights as base Charizard, so its Lv 50 Power is Charizard's");
assertEqual(on.power50, teamPower([{ speciesId: 6, level: 50, battleProfile: { baseStats: getMega("mega-charizard-x").baseStats } }]), "battle-ready: Mega Charizard X's own stats at Lv 50");
assertTrue(on.power50 > off.power50, "the Mega form is stronger at Lv 50");

section("TM shop: category filter and sort");
const tms = [
  { name: "TM26 Earthquake", type: "Ground", category: "Physical", power: 100, price: 9000, tier: "elite", teaches: 7 },
  { name: "TM24 Thunderbolt", type: "Electric", category: "Special", power: 90, price: 7000, tier: "premium", teaches: 3 },
  { name: "TM06 Toxic", type: "Poison", category: "Status", power: null, price: 3000, tier: "standard", teaches: 9 },
  { name: "TM Rock Slide", type: "Rock", category: "Physical", power: 75, price: 4500, tier: "power", teaches: 0 },
];
const names = (l) => l.map((t) => t.name.replace(/^TM\d*\s*/, ""));
assertEqual(names(filterTms(tms, { cat: "Physical" })), ["Earthquake", "Rock Slide"], "Physical keeps only physical moves");
assertEqual(names(filterTms(tms, { cat: "Status" })), ["Toxic"], "Status keeps only status moves");
assertEqual(names(filterTms(tms, { cat: "Physical", mine: true })), ["Earthquake"], "category combines with 'my Pokémon can learn'");
assertEqual(names(filterTms(tms, { sort: "power" })), ["Earthquake", "Thunderbolt", "Rock Slide", "Toxic"], "Power sort: strongest first, status moves last");
assertEqual(names(filterTms(tms, { sort: "price-asc" })), ["Toxic", "Rock Slide", "Thunderbolt", "Earthquake"], "Price low → high");
assertEqual(names(filterTms(tms, { sort: "name" })), ["Earthquake", "Rock Slide", "Thunderbolt", "Toxic"], "Name ignores the TM number");
assertEqual(names(filterTms(tms)), ["Toxic", "Earthquake", "Thunderbolt", "Rock Slide"], "default: most learners first (unchanged)");

finish();
