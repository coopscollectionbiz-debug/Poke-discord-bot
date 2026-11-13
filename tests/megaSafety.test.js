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
assertTrue(MEGAS.every((f) => !M.isMegaAvailable(f.id, { env: allOn, generationLive: () => true })), "M2: master flag on but MEGA_BATTLES_ENABLED unset: no form available for battle");
const battlesOn = { ...allOn, MEGA_BATTLES_ENABLED: "1" };
assertEqual(MEGAS.filter((f) => M.isMegaAvailable(f.id, { env: battlesOn, generationLive: () => true })).length, 93, "with battles explicitly on and all generations live: the 47 verified X/Y/ORAS forms plus the 46 owner-accepted Z-A forms");
assertEqual(MEGAS.filter((f) => !M.isMegaAvailable(f.id, { env: battlesOn, generationLive: () => true })).map((f) => f.id).sort(), ["mega-floette", "mega-magearna-original", "mega-rayquaza", "mega-zygarde"], "only the four blocked forms never battle");
assertEqual(MEGAS.filter((f) => M.isMegaAvailable(f.id, { env: battlesOn })).length, 70, "with today's live generations (1–5): 70 forms");
const ZA = await import("../config/megaBattleProfiles.js");
ZA.setZaAcceptanceForTesting(false);
assertTrue(MEGAS.filter((f) => !f.battleProfile.verified).every((f) => !M.isMegaAvailable(f.id, { env: battlesOn, generationLive: () => true })), "acceptance off: no unverified Z-A form is battle-available (the refusal path still works)");
ZA.setZaAcceptanceForTesting(true);
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
let leaked = 0;
for (let i = 0; i < 3000; i++) for (const ball of ["pokeball", "greatball", "ultraball"]) if (typeof selectRandomPokemonForUser(poisoned, { tp: 500000 }, ball).id !== "number") leaked++;
assertEqual(leaked, 0, "9,000 selector draws (chat catch, daily, packs, dashboard capture) from a pool seeded with every Mega: none drawn");
assertTrue(!Object.keys(DEX).some((k) => !/^\d+$/.test(k)) && Object.keys(DEX).length === 1025, "pokemonData.json (wild/starter/shop species source) holds only the 1,025 numeric species");

section("Mega items: never active, never in the legacy shop, grantable only while Mega rewards are on");
assertTrue(items.listCatalog().filter((i) => /^mega/.test(i.id)).every((i) => !i.shop && i.status === "defined"), "no Mega item has a shop entry or is active");
assertTrue(items.listCatalog().filter((i) => /^mega/.test(i.id)).every((i) => !grantItem({ items: {} }, i.id, 1).ok), "grantItem (daily, shop, achievements) refuses every Mega item");
assertTrue(!/mega/i.test(fs.readFileSync(new URL("../catalog/achievements.js", import.meta.url), "utf8")), "no achievement rewards or mentions Mega items (D-17: framework approved, entries not added)");
const REWARDS_ON = { MEGA_EVOLUTION_ENABLED: "1", MEGA_REWARDS_ENABLED: "1" };
assertTrue(items.listCatalog().filter((i) => /^mega/.test(i.id)).every((i) => !grantItem({ items: {} }, i.id, 1, { env: { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1" } }).ok), "with the master switch on but rewards off, every Mega item is still refused");
assertTrue(grantItem({ items: {} }, "mega_shard", 1, { env: REWARDS_ON }).ok && grantItem({ items: {} }, "megastone_charizarditex", 1, { env: REWARDS_ON }).ok, "rewards on: shards and stones can be granted");
assertTrue(!grantItem({ items: {} }, "mega_stone_voucher", 1, { env: REWARDS_ON }).ok && !grantItem({ items: {} }, "mega_stone_voucher_legendary", 1, { env: REWARDS_ON }).ok, "vouchers stay refused even with rewards on");
assertTrue(MEGA_REWARDS.version === 2 && !items.isHoldable("mega_shard") && !items.isHoldable("megastone_charizarditex"), "catalog holdability (player paths) is unchanged: Mega items are never holdable through it");
// 2026-11-12 (owner): the admin dashboard may grant any bag item, Mega items included,
// whatever the switches say. That path is admin-only (adminGrantItem in services/adminChanges.js).
{
  const { adminGrantItem } = await import("../services/inventory.js");
  const OFF = {};
  const u = { id: "1", items: {} };
  const s = adminGrantItem(u, "mega_shard", 5, { env: OFF }), st = adminGrantItem(u, "megastone_charizarditex", 1, { env: OFF });
  assertTrue(s.ok && st.ok && u.items.mega_shard === 5 && u.items.megastone_charizarditex === 1 && !s.live && !st.live, "admin grants: shards and stones go in the bag with every switch off and are reported as not live");
  assertTrue(adminGrantItem({ items: {} }, "megastone_charizarditex", 1, { env: REWARDS_ON }).live, "admin grants: with rewards on, a stone counts as live");
  const adminSrc = fs.readFileSync(new URL("../services/adminChanges.js", import.meta.url), "utf8");
  assertTrue(/adminGrantItem\(/.test(adminSrc) && !/grantItem\(user/.test(adminSrc.replace(/adminGrantItem\(user/g, "")), "admin item grants go only through adminGrantItem");
}

section("Pokédex completion ignores Megas");
const user = { pokemon: Object.fromEntries(Array.from({ length: 649 }, (_, i) => [i + 1, { normal: 1, shiny: 0 }])) };
const base = computeMetrics(user, ["state:uniqueSpecies", "state:classicSpecies", "state:regions"]);
user.megaUnlocks = Object.fromEntries(MEGAS.filter((f) => f.species <= 649).map((f) => [`${f.species}:normal`, { forms: { [f.id]: { at: 1, stone: null } }, preferred: null }]));
assertEqual(computeMetrics(user, ["state:uniqueSpecies", "state:classicSpecies", "state:regions"]), base, "unique species, classic Pokédex and regions unchanged by Mega unlocks");
assertEqual(base["state:classicSpecies"], 649, "a full classic Pokédex is still exactly 649");

section("Mega code is wired only where Phases M1–M3 need it");
const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const live = ["bot_final.js", ...["commands", "services", "routes", "utils", "progression", "persistence", "public"].flatMap((d) => walk(path.join(ROOT, d)).map((f) => path.relative(ROOT, f).split(path.sep).join("/")))];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(m?js|html)$/.test(e.name) ? [path.join(dir, e.name)] : []));
}
assertTrue(live.length > 100 && live.includes("bot_final.js") && live.includes("commands/battle.js"), `the scan covers the live code (${live.length} files)`);
// Phase M1: the Mega modules may be used ONLY by these files (unlock API,
// team validation, load-path normalization, bag usage text, dashboard UI).
const MEGA_USERS = [
  "bot_final.js", "services/inventory.js", "services/mega.js", "services/megaApi.js", "services/megaTeam.js",
  "services/megaUnlocks.js", "utils/megas.js", "utils/userSchema.js", "public/picker-pokemon/script.js", "public/picker-pokemon/mega.js",
  // Phase M2: the battle engine (Mega participants, abilities, rendering).
  "utils/battle/runBattle.js", "utils/battle/sim.js", "utils/battle/effects.js", "utils/battle/abilities.js", "utils/battle/power.js", "utils/battle/render.js",
  // Phase M3: presentation only (shared Mega display rules, Mega sprite files, the EXP card).
  "utils/megaDisplay.js", "utils/render/sprites.js", "utils/render/expCard.js",
  // Teams: the Battle team reuses team validation and cleaning (one Mega per team).
  "services/battleTeam.js",
  // Collection detail (B2): lists a species' Mega forms and whether each is unlocked (read-only).
  "services/pokemonDetail.js",
  // Mega Shards (2026-11-11): the shard service, its two drop points and the dashboard shop.
  "services/megaShards.js", "commands/daily.js", "commands/battle.js", "public/dashboardshop/mega.js", "public/dashboardshop/index.html",
  // Held items: a slot set to Mega Evolve holds its Mega Stone, so it can't
  // hold a regular item (read-only Mega checks), and the held-item feature
  // flags live in the shared config/features.js. No Mega acquisition here.
  "services/heldItems.js", "services/heldItemsApi.js",
  // Showcase team (three-teams split): shows any number of unlocked Megas
  // (read-only display checks: unlocked on the line, allowed on teams).
  "services/showcaseTeam.js", "utils/render/teamView.js",
];
const megaModule = /megaUnlocks\.js|megas\.js|config\/features\.js|megaRewards\.js|megaApi\.js|megaTeam\.js|\/mega\.js|"\.\/mega\.js"/;
const users = live.filter((f) => megaModule.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
assertEqual(users.filter((f) => !MEGA_USERS.includes(f)), [], "only the M1–M3 files import Mega modules (no reward, shop, catch, daily, quest or achievement code)");
const megaRefs = live.filter((f) => /megastone_|mega_shard|megaUnlocks/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
assertEqual(megaRefs.filter((f) => !MEGA_USERS.includes(f)), [], "only the M1–M3 files reference Mega Stones, Shards or megaUnlocks");
const NEVER = live.filter((f) => /^(utils\/battle\/(rewards|playback|data|moveset|stats|tuning|wager|rng)\.js|commands\/(quest|recruit|shop|gift)\.js|progression\/|services\/gameplay\.js|utils\/weightedRandom\.js)/.test(f));
assertEqual(NEVER.filter((f) => /mega/i.test(fs.readFileSync(path.join(ROOT, f), "utf8"))), [], `EXP/rewards, playback, battle data and acquisition code (${NEVER.length} files) never mentions Mega`);
assertEqual(live.filter((f) => /megaRewards/.test(fs.readFileSync(path.join(ROOT, f), "utf8"))), ["services/megaShards.js"], "only the shard service reads the Mega reward config");
for (const [file, call] of [["commands/daily.js", /rollDailyShards\(user\)/], ["utils/battle/runBattle.js", /rewardsOn\(env\) && !overCap && \(winnerId === challengerId \|\| mode === "wager"\)/]]) {
  assertTrue(call.test(fs.readFileSync(path.join(ROOT, file), "utf8")), `${file}: the shard roll is the gated helper call`);
}
section("Routes and dashboard: gated, session-checked, nothing rendered while off");
const botSrc = fs.readFileSync(path.join(ROOT, "bot_final.js"), "utf8");
for (const route of ['app.get("/api/mega"', 'app.post("/api/mega/unlock"', 'app.post("/api/mega/preferred"', 'app.get("/api/mega/shop"']) {
  const block = botSrc.slice(botSrc.indexOf(route), botSrc.indexOf(route) + 400);
  assertTrue(botSrc.includes(route) && /requireDashboardSession\(req, id\)/.test(block), `${route.split('"')[1]} is mounted behind the dashboard session check`);
}
assertTrue(/prepareTeamSelection\(u, team\)/.test(botSrc) && /normalizeMegaUnlocks\(user\);\s*normalizeDisplayedTeam\(user\);/.test(botSrc), "the team route and the load-path normalizer use the shared Mega-aware code");
const updateUser = botSrc.slice(botSrc.indexOf('app.post("/api/updateUser"'), botSrc.indexOf('app.post("/api/updateUser"') + 2500);
assertTrue(!/mega/i.test(updateUser), "/api/updateUser stays closed to Mega fields (strict whitelist unchanged)");
const megaUi = await import("../public/picker-pokemon/mega.js");
let touched = false;
const realDoc = globalThis.document;
globalThis.document = new Proxy({}, { get() { touched = true; return () => null; } });
const ui = await megaUi.initMega({ userId: "1", apiJSON: async () => ({ success: true, enabled: false }), getMode: () => "team", getTeam: () => [] });
globalThis.document = realDoc;
assertEqual([ui, touched], [{ enabled: false }, false], "dashboard module: when the server says disabled it never touches the page");
const failing = await megaUi.initMega({ userId: "1", apiJSON: async () => { throw new Error("403"); }, getMode: () => "team", getTeam: () => [] });
assertEqual(failing, { enabled: false }, "…and a failed /api/mega request also renders nothing");

assertTrue(!/trainerDataHelper/.test(fs.readFileSync(path.join(ROOT, "bot_final.js"), "utf8")), "bot_final.js doesn't import trainerDataHelper (whose sanitizeBeforeSave would strip unknown fields like megaUnlocks)");

finish();
