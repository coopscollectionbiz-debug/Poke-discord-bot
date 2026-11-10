// ==========================================================
// tests/megaSafety.test.js — Mega Evolution Phase M0 safety gates:
// default-off flags, independence from generation controls, no Mega in
// any acquisition/shop/reward pool or Pokédex count, nothing usable, and
// no live code path wired to the M0 modules yet.
// ==========================================================

import fs from "fs";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const F = await import("../config/features.js");
const G = await import("../config/generations.js");
const C = await import("../utils/speciesCatalog.js");
const M = await import("../utils/megas.js");
const { selectRandomPokemonForUser } = await import("../utils/weightedRandom.js");
const { recruitPool } = await import("../commands/recruit.js");
const { grantItem } = await import("../services/inventory.js");
const items = await import("../catalog/items.js");
const { computeMetrics } = await import("../progression/achievements.js");
const { MEGA_REWARDS } = await import("../config/megaRewards.js");

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const DEX = read("../pokemonData.json");
const MEGAS = M.allMegas();

section("MEGA_EVOLUTION_ENABLED defaults to off");
assertTrue(!F.isMegaEvolutionEnabled({}), "unset → off");
assertTrue(["", "0", "false", "no", "off", "enabled", "2", " "].every((v) => !F.isMegaEvolutionEnabled({ MEGA_EVOLUTION_ENABLED: v })), "anything but 1/true/yes/on → off");
assertTrue(["1", "true", "TRUE", " yes ", "on"].every((v) => F.isMegaEvolutionEnabled({ MEGA_EVOLUTION_ENABLED: v })), "1/true/yes/on → on");
assertTrue(!F.isMegaEvolutionEnabled(process.env), "the test environment has it off (run-tests strips it)");
assertEqual(F.megaFormAllowlist({}), null, "MEGA_FORMS unset → no restriction");
assertEqual(F.megaFormAllowlist({ MEGA_FORMS: "all" }), null, "MEGA_FORMS=all → no restriction");
assertEqual([...F.megaFormAllowlist({ MEGA_FORMS: "mega-charizard-x, MEGA-VENUSAUR,bad id,6:megax" })], ["mega-charizard-x", "mega-venusaur"], "allowlist keeps only well-formed ids");
assertTrue(!F.isMegaFormAllowedByFlags("mega-charizard-x", { MEGA_FORMS: "mega-charizard-x" }), "an allowlist without the flag allows nothing");
assertTrue(F.isMegaFormAllowedByFlags("mega-charizard-x", { MEGA_EVOLUTION_ENABLED: "1", MEGA_FORMS: "mega-charizard-x" }) && !F.isMegaFormAllowedByFlags("mega-venusaur", { MEGA_EVOLUTION_ENABLED: "1", MEGA_FORMS: "mega-charizard-x" }), "with the flag on, the allowlist restricts forms");

section("Nothing is usable in Phase M0, whatever the flags");
const allOn = { MEGA_EVOLUTION_ENABLED: "1", MEGA_FORMS: "all" };
assertTrue(MEGAS.every((f) => !M.isMegaAvailable(f.id, { env: {} })), "flag off: no form available");
assertTrue(MEGAS.every((f) => !M.isMegaAvailable(f.id, { env: allOn, generationLive: () => true })), "flag on and every generation live: still no form available (none launch-ready, D-5)");
assertTrue(M.megaAvailability("mega-venusaur", { env: allOn, generationLive: () => true }).reasons.some((r) => r.startsWith("D-5")), "the reason given is the D-5 ability gate");
assertTrue(M.megaAvailability("mega-greninja", { env: allOn }).reasons.some((r) => /generation 6 is not live/.test(r)), "an unreleased generation is reported as its own reason");

section("Generation controls are independent of Mega flags");
assertEqual(G.configuredGenerations({ POKEMON_GENERATIONS: "", MEGA_EVOLUTION_ENABLED: "1", MEGA_FORMS: "all" }), G.configuredGenerations({ POKEMON_GENERATIONS: "" }), "Mega flags don't change the configured generations");
assertTrue(!F.isMegaEvolutionEnabled({ POKEMON_GENERATIONS: "6,7,8,9" }), "releasing generations doesn't enable Mega Evolution");
assertEqual(C.liveGenerations(), [1, 2, 3, 4, 5], "live generations are still 1–5 (POKEMON_GENERATIONS unset)");
const genSrc = fs.readFileSync(new URL("../config/generations.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../utils/speciesCatalog.js", import.meta.url), "utf8");
assertTrue(!/mega/i.test(genSrc), "config/generations.js and utils/speciesCatalog.js don't reference Mega code");

section("No Mega in any acquisition pool");
assertTrue(MEGAS.every((f) => !C.isAcquirable(f.id) && !C.isAcquirable({ id: f.id }) && !C.isAcquirable(f.formKey ?? "x")), "isAcquirable rejects every Mega id and form key");
const poisoned = [...Object.values(DEX), ...MEGAS.map((f) => ({ id: f.id, name: f.name, tier: "common", types: f.typeIds, generation: 1 }))];
assertEqual(C.acquirablePokemon(poisoned).filter((p) => typeof p.id !== "number").length, 0, "acquirablePokemon drops Mega entries even if injected into the pool");
assertEqual(recruitPool(poisoned).filter((p) => typeof p.id !== "number").length, 0, "/recruit and /quest pool (recruitPool) never contains a Mega");
let leaked = 0;
for (let i = 0; i < 3000; i++) for (const ball of ["pokeball", "greatball", "ultraball"]) if (typeof selectRandomPokemonForUser(poisoned, { tp: 500000 }, ball).id !== "number") leaked++;
assertEqual(leaked, 0, "9,000 selector draws (chat catch, daily, packs, dashboard capture) from a pool seeded with every Mega: none drawn");
assertTrue(!Object.keys(DEX).some((k) => !/^\d+$/.test(k)) && Object.keys(DEX).length === 1025, "pokemonData.json (wild/starter/shop species source) holds only the 1,025 numeric species");

section("No Mega in shops, rewards or item grants");
assertTrue(items.listCatalog().filter((i) => /^mega/.test(i.id)).every((i) => !i.shop && i.status === "defined"), "no Mega item has a shop entry or is active");
assertTrue(items.listCatalog().filter((i) => /^mega/.test(i.id)).every((i) => !grantItem({ items: {} }, i.id, 1).ok), "grantItem (daily, shop, achievements, /addinventory) refuses every Mega item");
assertTrue(!/mega/i.test(fs.readFileSync(new URL("../catalog/achievements.js", import.meta.url), "utf8")), "no achievement rewards or mentions Mega items (D-17: framework approved, entries not added)");
assertEqual(MEGA_REWARDS.active, false, "the Mega reward config is inactive");

section("Pokédex completion ignores Megas");
const user = { pokemon: Object.fromEntries(Array.from({ length: 649 }, (_, i) => [i + 1, { normal: 1, shiny: 0 }])) };
const base = computeMetrics(user, ["state:uniqueSpecies", "state:classicSpecies", "state:regions"]);
user.megaUnlocks = Object.fromEntries(MEGAS.filter((f) => f.species <= 649).map((f) => [`${f.species}:normal`, { forms: { [f.id]: { at: 1, stone: null } }, preferred: null }]));
assertEqual(computeMetrics(user, ["state:uniqueSpecies", "state:classicSpecies", "state:regions"]), base, "unique species, classic Pokédex and regions unchanged by Mega unlocks");
assertEqual(base["state:classicSpecies"], 649, "a full classic Pokédex is still exactly 649");

section("M0 is not wired into any live code path");
const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const live = ["bot_final.js", ...["commands", "services", "routes", "utils", "progression", "persistence", "public"].flatMap((d) => walk(path.join(ROOT, d)).map((f) => path.relative(ROOT, f)))];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(m?js|html)$/.test(e.name) ? [path.join(dir, e.name)] : []));
}
assertTrue(live.length > 100 && live.includes("bot_final.js") && live.some((f) => /commands[\\/]battle\.js$/.test(f)), `the scan covers the live code (${live.length} files)`);
const m0Modules =/megaUnlocks\.js|utils\/megas\.js|\.\/megas\.js|config\/features\.js|megaRewards\.js/;
const wired = live.filter((f) => !/^services[\\/]megaUnlocks\.js$|^utils[\\/]megas\.js$/.test(f) && m0Modules.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
assertEqual(wired, [], "no command, route, service, page or the bot imports the M0 Mega modules");
const megaRefs = live.filter((f) => !/^services[\\/]megaUnlocks\.js$|^utils[\\/]megas\.js$/.test(f) && /megastone_|mega_shard|megaUnlocks/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
assertEqual(megaRefs, [], "no live code references Mega Stones, Shards or megaUnlocks");
assertTrue(!/trainerDataHelper/.test(fs.readFileSync(path.join(ROOT, "bot_final.js"), "utf8")), "bot_final.js doesn't import trainerDataHelper (whose sanitizeBeforeSave would strip unknown fields like megaUnlocks)");

finish();
