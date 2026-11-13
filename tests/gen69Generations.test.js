// ==========================================================
// tests/gen69Generations.test.js — generation enable controls across
// every acquisition pathway, evolution rules, admin override, and the
// guarantee that disabling a generation never touches owned Pokémon.
// Synthetic players and a temp data dir only.
// ==========================================================

import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gen69-gens-"));
process.env.TRAINERDATA_DIR = dir;
delete process.env.POKEMON_GENERATIONS;

const G = await import("../config/generations.js");
const C = await import("../utils/speciesCatalog.js");
const { getAllPokemon, getAcquirablePokemon } = await import("../utils/dataLoader.js");
const { selectRandomPokemonForUser } = await import("../utils/weightedRandom.js");
const { createGameplayHandlers } = await import("../services/gameplay.js");
const { lockUser } = await import("../utils/userLocks.js");
const { saveAndAck } = await import("../utils/saveManager.js");
const { trainingKey, expForLevel, floorLevel } = await import("../utils/training.js");
const { officialMethodText, checkEvolutionRequirements } = await import("../services/evolutionRules.js");
const { parseChange, applyChange } = await import("../services/adminChanges.js");
const DEX = JSON.parse(fs.readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));

const enable = (list) => { G.setGenerationsForTesting(list); C.resetCatalogCachesForTesting(); };
const all = await getAllPokemon();

section("Configuration");
assertEqual(G.parseGenerations(undefined).enabled, [1, 2, 3, 4, 5], "default: Gens 1–5 only");
assertEqual(G.parseGenerations("7").enabled, [1, 2, 3, 4, 5, 7], "single generation");
assertEqual(G.parseGenerations("6-9").enabled, [1, 2, 3, 4, 5, 6, 7, 8, 9], "range");
assertEqual(G.parseGenerations(" 6 , 8 ").enabled, [1, 2, 3, 4, 5, 6, 8], "list with spaces");
const bad = G.parseGenerations("x,10,9-6");
assertTrue(bad.enabled.join() === "1,2,3,4,5" && bad.warnings.length === 3, "malformed parts are ignored with warnings; Gens 1–5 always stay on");
assertEqual(G.generationOfDex(899), 8, "Hisui-introduced #899 belongs to Gen 8 (Galar)");
assertEqual(C.liveGenerations(), [1, 2, 3, 4, 5], "nothing new is live by default");
assertTrue(!C.isAcquirable(700) && C.isAcquirable(133) && !C.isAcquirable("52:galar") && !C.isAcquirable(0) && !C.isAcquirable(1026), "acquirable: Gen 1–5 species only; never forms or bad ids");

section("Every acquisition pool excludes disabled generations (default)");
const acq = await getAcquirablePokemon();
assertEqual(acq.length, 649, "getAcquirablePokemon(): 649 species");
let leaked = 0;
for (const ball of ["pokeball", "greatball", "ultraball"]) {
  for (let i = 0; i < 4000; i++) if (selectRandomPokemonForUser(all, { tp: 500000 }, ball).id > 649) leaked++;
}
assertEqual(leaked, 0, "12,000 weighted draws from the FULL list never return a Gen 6–9 species (backstop)");

// Static audit: each acquisition call site must draw from a gated list.
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const SITES = [
  ["bot_final.js", /const allPokemon = await getAcquirablePokemon\(\);[\s\S]{0,200}selectRandomPokemonForUser\(allPokemon/, "chat catch"],
  ["commands/daily.js", /const allPokemon = await getAcquirablePokemon\(\);/, "/daily"],
  ["commands/shop.js", /const allPokemon = await getAcquirablePokemon\(\);[\s\S]{0,600}pickPokemon/, "shop starter pack"],
  ["services/gameplay.js", /acquirablePokemon\(await loadAllPokemon\(\)\)/, "dashboard capture"],
  ["services/gameplay.js", /acquirablePokemon\(await loadPokemonCached\(\)\)/, "weekly pack"],
  ["services/gameplay.js", /checkEvolutionRequirements\(/, "evolution"],
  ["services/adminChanges.js", /!isAcquirable\(id\) && !ctx\.allowUnreleased/, "admin dashboard grants"],
  ["commands/trainercard.js", /filter\(\(g\) => !g\.gen \|\| isGenerationLive\(g\.gen\)\)/, "starter selection"],
];
for (const [file, re, label] of SITES) assertTrue(re.test(src(file)), `${label} (${file}) draws from the generation-gated pool`);
const callers = ["bot_final.js", "commands/daily.js", "commands/shop.js", "services/gameplay.js", "utils/broadcastReward.js", "commands/trainercard.js"]
  .filter((f) => /selectRandomPokemonForUser\(\s*(await\s+)?getAllPokemon/.test(src(f)));
assertEqual(callers, [], "no call site feeds the raw catalogue straight into the selector");

// ---- gameplay handlers (real code, synthetic players)
function setup(players) {
  const state = { td: players };
  const h = createGameplayHandlers({ getTrainerData: () => state.td, lockUser, save: (d) => saveAndAck(d, { save: async () => true }), normalizeUserSchema: (_i, u) => u });
  return { state, h };
}
const auth = (who) => (id) => id === who;
const player = (o = {}) => ({ cc: 10_000_000, tp: 0, pokemon: {}, items: { evolution_stone: 500, shiny_dust: 500 }, displayedPokemon: [], training: {}, ...o });

section("Dashboard capture and weekly pack");
{
  const { state, h } = setup({ U: player() });
  let max = 0;
  for (let i = 0; i < 300; i++) {
    const r = await h.rewardPokemon({ body: { id: "U", source: i % 2 ? "ultraball" : "pokeball" }, isAuthorized: auth("U") });
    if (r.body?.pokemon?.id > max) max = r.body.pokemon.id;
  }
  assertTrue(max > 0 && max <= 649, `300 captures stay in Gens 1–5 (max #${max})`);
  const wk = await h.weeklyPack({ body: { id: "U" }, isAuthorized: auth("U") });
  assertTrue(wk.status === 200 && wk.body.rewards.every((r) => r.id <= 649), "weekly pack stays in Gens 1–5");
  void state;
}

section("Evolution: generation gate and official levels");
{
  const { state, h } = setup({ U: player({ pokemon: { 133: { normal: 1, shiny: 0 } } }) });
  const r = await h.evolve({ body: { id: "U", baseId: 133, targetId: 700 }, isAuthorized: auth("U") });
  assertTrue(r.status === 400 && /hasn't been released/.test(r.body.error) && state.td.U.pokemon[133].normal === 1 && state.td.U.items.evolution_stone === 500, "Eevee → Sylveon refused while Gen 6 is off; nothing spent");
  const ok = await h.evolve({ body: { id: "U", baseId: 133, targetId: 134 }, isAuthorized: auth("U") });
  assertTrue(ok.status === 200 && ok.body.success, "Eevee → Vaporeon unaffected");
}
assertEqual(officialMethodText(DEX[700]), "Level up knowing a Fairy-type move with high friendship", "official method shown for flavour");
enable([6, 7, 8, 9]);
{
  const { state, h } = setup({ U: player({ pokemon: { 133: { normal: 1, shiny: 1 }, 650: { normal: 1, shiny: 0 } } }) });
  const syl = await h.evolve({ body: { id: "U", baseId: 133, targetId: 700, variant: "shiny" }, isAuthorized: auth("U") });
  assertTrue(syl.status === 200 && state.td.U.pokemon[700]?.shiny === 1 && state.td.U.pokemon[133].normal === 1 && !state.td.U.pokemon[700]?.normal, "with Gen 6 live: shiny Eevee → shiny Sylveon; shiny status kept; the normal Eevee untouched");
  // No Level requirement for any generation: a low-Level Chespin evolves on Stones alone, like Gen 1–5.
  state.td.U.training[trainingKey(650, "normal")] = { exp: expForLevel(5) };
  const low = await h.evolve({ body: { id: "U", baseId: 650, targetId: 651 }, isAuthorized: auth("U") });
  assertTrue(low.status === 200 && state.td.U.pokemon[651]?.normal === 1 && !state.td.U.pokemon[650], "Chespin at Lv 5 → Quilladin (no Level requirement, Stones only)");
  // The evolved Pokémon is raised to the evolved species' minimum Level (Quilladin: 16), as for Gen 1–5.
  const quilladin = Object.values(state.td.U.box ?? {}).flat().find((c) => Number(c?.id) === 651);
  const evolvedExp = quilladin?.exp ?? state.td.U.training?.[trainingKey(651, "normal")]?.exp ?? 0;
  assertTrue(evolvedExp >= expForLevel(floorLevel(651)), "evolved Pokémon is at least Quilladin's minimum Level");
}
{
  const { state, h } = setup({ U: player({ pokemon: { 264: { normal: 1, shiny: 0 } }, training: { "264:normal": { exp: expForLevel(50) } } }) });
  const r = await h.evolve({ body: { id: "U", baseId: 264, targetId: 862 }, isAuthorized: auth("U") });
  assertTrue(!DEX[264].evolvesTo.includes(862) && r.status === 400 && state.td.U.pokemon[264].normal === 1, "Linoone → Obstagoon refused even with Gen 8 live (needs Galarian Linoone, a disabled form)");
}
assertTrue(typeof checkEvolutionRequirements === "function", "evolution rules exported");

section("Enabling a generation adds its complete species set");
enable([7]);
assertEqual(C.liveGenerations(), [1, 2, 3, 4, 5, 7], "Gen 7 live");
const alola = (await getAcquirablePokemon()).filter((p) => p.id >= 650);
assertTrue(alola.length === 88 && alola.every((p) => p.generation === 7), "all 88 Alola species (and nothing else) become acquirable");
let sawAlola = false;
for (let i = 0; i < 6000 && !sawAlola; i++) if (selectRandomPokemonForUser(all, { tp: 0 }).generation === 7) sawAlola = true;
assertTrue(sawAlola, "Alola species appear in weighted draws once enabled");

section("Disabling never removes owned Pokémon");
{
  const td = { U: player({ pokemon: { 722: { normal: 2, shiny: 1 }, 25: { normal: 1, shiny: 0 } }, training: { "722:normal": { exp: 1000 } } }) };
  const snap = JSON.stringify(td);
  enable([]);
  const { state, h } = setup(td);
  for (let i = 0; i < 20; i++) await h.rewardPokemon({ body: { id: "U", source: "pokeball" }, isAuthorized: auth("U") });
  assertTrue(state.td.U.pokemon[722].normal === 2 && state.td.U.pokemon[722].shiny === 1 && state.td.U.training["722:normal"].exp === 1000, "owned Rowlet (normal + shiny + Level) untouched after Gen 7 is switched off");
  assertTrue(JSON.parse(snap).U.pokemon[722].normal === 2, "fixture sanity");
  const conv = await h.convertShiny?.({ body: { id: "U", pokemonId: 722 }, isAuthorized: auth("U") });
  void conv;
}

section("Rollback of a released generation keeps newly acquired Pokémon fully usable");
{
  // Gen 7 live: a player catches Alola Pokémon through the real capture handler.
  enable([7]);
  const { state, h } = setup({ U: player({ tp: 300000 }), V: player() });
  let tries = 0;
  while (!Object.keys(state.td.U.pokemon).some((id) => Number(id) >= 722) && tries++ < 3000) {
    await h.rewardPokemon({ body: { id: "U", source: "ultraball" }, isAuthorized: auth("U") });
  }
  const alolaIds = Object.keys(state.td.U.pokemon).map(Number).filter((id) => id >= 722 && id <= 809);
  assertTrue(alolaIds.length > 0, `caught Alola species while Gen 7 was live (#${alolaIds.join(", #")})`);
  const a = alolaIds[0];
  state.td.U.displayedPokemon = [{ id: a, variant: "normal" }];
  state.td.U.pokemon[a].normal = Math.max(2, state.td.U.pokemon[a].normal);
  const { retroEvaluate, normalizeProgression } = await import("../progression/achievements.js");
  const { validateUserSchema } = await import("../utils/userSchema.js");
  retroEvaluate(state.td.U);
  const snapshot = JSON.stringify({ pokemon: state.td.U.pokemon, training: state.td.U.training, ach: state.td.U.ach });

  // Operator rolls Gen 7 back: restart with POKEMON_GENERATIONS unset.
  enable([]);
  validateUserSchema(state.td.U, "U", "u");
  normalizeProgression(state.td.U);
  retroEvaluate(state.td.U);
  assertEqual(JSON.stringify({ pokemon: state.td.U.pokemon, training: state.td.U.training, ach: state.td.U.ach }), snapshot, "after rollback + reboot: Alola Pokémon, Levels and achievements byte-identical");
  const { buildTeam } = await import("../utils/battle/runBattle.js");
  const team = buildTeam(state.td.U);
  assertTrue(team.length === 1 && team[0].speciesId === a && team[0].level >= 1, "an Alola Pokémon stays on the battle Team");
  const { simulateBattle } = await import("../utils/battle/sim.js");
  const sim = simulateBattle({ sides: [{ members: team }, { members: [{ speciesId: 25, variant: "normal", level: 30 }] }], seed: 3, surge: null });
  assertTrue([0, 1].includes(sim.winner), "and can still battle");
  const { giftPokemon } = await import("../commands/gift.js");
  assertEqual(giftPokemon(state.td.U, state.td.V, String(a), "alola", 1), null, "and can still be gifted");
  assertTrue(!C.isAcquirable(a) && C.speciesProblems(a).length === 0, "it is no longer acquirable, but its data stays complete");
  const caught = [];
  for (let i = 0; i < 200; i++) { const r = await h.rewardPokemon({ body: { id: "U", source: "ultraball" }, isAuthorized: auth("U") }); if (r.body?.pokemon) caught.push(r.body.pokemon.id); }
  assertTrue(caught.length > 0 && caught.every((id) => id <= 649), "new catches are Gens 1–5 only again");
}

section("Admin dashboard grant override");
function grant(speciesId, allow) {
  const user = { pokemon: {}, training: {} };
  const r = applyChange(user, parseChange({ kind: "pokemon", op: "add", speciesId, amount: 1 }).change, { allowUnreleased: allow === true, rand: () => 0 });
  return { user, r };
}
enable([]);
const refused = grant(906, null);
assertTrue(!refused.r.ok && /isn't released yet/.test(refused.r.error) && !refused.user.pokemon[906], "unreleased species refused without the testing switch");
const allowed = grant(906, true);
assertEqual(allowed.user.pokemon[906]?.normal, 1, "the testing switch grants it (admin testing)");
const classic = grant(25, null);
assertEqual(classic.user.pokemon[25]?.normal, 1, "Gen 1–5 grants unchanged");

section("Invalid data keeps a generation off");
enable([6]);
assertTrue(C.isGenerationLive(6), "complete generation goes live");
assertEqual(C.generationProblems(9), [], "Gen 9 currently validates cleanly");
assertTrue(C.speciesProblems(99999).length > 0, "a missing species is reported, so its generation could never go live");

enable(null);
await fsp.rm(dir, { recursive: true, force: true });
finish();
