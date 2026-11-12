// ==========================================================
// tests/gen69Achievements.test.js — Generations 6–9 and the Release C
// achievement / collection systems: existing progress preserved, classic
// goalposts pinned, new regions gated, forms never double-counted,
// inventories and gifting intact. Synthetic players only.
// ==========================================================

import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gen69-ach-"));
process.env.TRAINERDATA_DIR = dir;
delete process.env.POKEMON_GENERATIONS;

const G = await import("../config/generations.js");
const C = await import("../utils/speciesCatalog.js");
const cat = await import("../catalog/achievements.js");
const P = await import("../progression/achievements.js");
const { giftPokemon } = await import("../commands/gift.js");
const DEX = JSON.parse(fs.readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));
const BASELINE = JSON.parse(fs.readFileSync(new URL("../data/pokedex/gen1-5-baseline.json", import.meta.url), "utf8"));
const enable = (list) => { G.setGenerationsForTesting(list); C.resetCatalogCachesForTesting(); };
const NOW = Date.UTC(2026, 10, 10);
const own = (ids, shiny = false) => Object.fromEntries(ids.map((id) => [String(id), { normal: shiny ? 0 : 1, shiny: shiny ? 1 : 0 }]));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const metric = (u, k) => P.computeMetrics(u, [k])[k];

section("Catalog revision 4");
// Revision 4 = 2026-11-11 Pokémon re-tier: Dialga, Palkia, Giratina, Kyurem moved legendary → mythic.
assertEqual(cat.CATALOG_REVISION, 4, "revision 4");
assertEqual([cat.SUPPORTED_SPECIES, cat.TIER_SPECIES.legendary, cat.TIER_SPECIES.mythic, cat.MULTI_MEMBER_FAMILIES], [649, 44, 25, 225], "classic constants (Legendary 44 / Mythic 25 since the re-tier)");
assertEqual(P.familyCount(), 225, "225 Gen 1–5 families (Gen 6–9 links don't merge or grow them)");
assertEqual(P.FAMILY_SIZES.get(133), 8, "Eevee family is still Eevee + 7 (Sylveon is Gen 6)");
assertEqual(cat.NEW_REGIONS, { Kalos: 72, Alola: 88, Galar: 96, Paldea: 120 }, "new regions use the full intended species sets");
for (const [r, n] of Object.entries(cat.NEW_REGIONS)) assertEqual(Object.values(DEX).filter((p) => p.region === r).length, n, `${r} size matches the data (${n})`);
const rev12 = cat.listAchievements().filter((e) => e.since <= 2);
assertEqual(rev12.length, 141, "141 existing achievements kept");
assertTrue(rev12.every((e) => !e.generations), "existing achievements never depend on new generations");
assertTrue(rev12.filter((e) => e.id.startsWith("col_type_") && e.id !== "col_type_all").length === 17, "17 classic type specialists (Fairy is separate)");
assertEqual(cat.getAchievement("col_type_all").target, 17, "Type Encyclopedia keeps its 17-type target");
assertEqual([cat.getAchievement("col_species_649").target, cat.getAchievement("col_legendary_all").target, cat.getAchievement("col_mythic_all").target, cat.getAchievement("evo_family_all").target], [649, 44, 25, 225], "completion targets follow the re-tier (Hall of Legends 44, Mythic Archive 25)");

section("Existing progress is preserved (revision 2 → 3)");
{
  // A rev-2 player with unlocks, claims and counters recorded.
  const u = { tp: 5000, pokemon: own(range(1, 151)), ach: { col_first: 19000, col_region_kanto_full: 19100, col_type_normal: 19050 }, achClaimed: {}, ap: 0,
    stats: { shinyObtained: 3, evolutions: 12 }, progression: { rev: 2, day: 19000, retro: ["col_first"] } };
  const before = JSON.parse(JSON.stringify(u));
  P.normalizeProgression(u);
  const newly = P.retroEvaluate(u, NOW);
  assertTrue(Object.entries(before.ach).every(([id, d]) => u.ach[id] === d), "every existing unlock and its day is kept");
  assertEqual(JSON.stringify(u.pokemon), JSON.stringify(before.pokemon), "inventory untouched by re-evaluation");
  assertEqual([u.stats.evolutions, u.progression.rev], [12, 4], "counters kept; stamped revision 4");
  assertTrue(!newly.some((id) => /alola|kalos|galar|paldea|1025|traveler_9/.test(id)), "no unreleased-generation achievement awarded");
  // The retyped Normal species leave the Normal count, but the recorded unlock stays.
  assertTrue(metric(u, "state:type:1") < 15 || u.ach.col_type_normal, "Normal Specialist kept even if retyping lowered the count");
}

section("Retyping: Fairy Specialist recognised retroactively, nothing revoked");
{
  const fairy = Object.values(DEX).filter((p) => p.id <= 649 && p.types.includes(18)).map((p) => p.id);
  const wasNormal = fairy.filter((id) => BASELINE[id].types.includes(1));
  assertEqual(fairy.length, 22, "22 Gen 1–5 Fairy species");
  const u = { pokemon: own(fairy), ach: { col_type_normal: 19000 }, progression: { rev: 2 } };
  P.retroEvaluate(u, NOW);
  assertTrue(u.ach.col_type_fairy && u.progression.retro.includes("col_type_fairy"), "owning 15+ Fairy types unlocks Fairy Specialist via retro recognition (AP only, recorded in progression.retro)");
  assertTrue(u.ach.col_type_normal === 19000 && wasNormal.length === 12, "Normal Specialist (unlocked before 12 of them became Fairy) is kept");
}

section("Classic goalposts can't be shortcut by new species");
{
  enable([6, 7, 8, 9]);
  const u = { pokemon: { ...own(range(1, 600)), ...own(range(650, 698)) } };
  P.retroEvaluate(u, NOW);
  assertEqual([metric(u, "state:uniqueSpecies"), metric(u, "state:classicSpecies")], [649, 600], "649 species owned, but only 600 from Gens 1–5");
  assertTrue(!u.ach?.col_species_649, "Pokédex Complete (Gens 1–5) needs all 649 classic species");
  const legends = Object.values(DEX).filter((p) => p.tier === "legendary");
  const v = { pokemon: own(legends.filter((p) => p.id >= 650).slice(0, 48).map((p) => p.id)) };
  P.retroEvaluate(v, NOW);
  assertTrue(!v.ach?.col_legendary_all && v.ach?.col_legendary_25, "48 new legendaries: Legend Keeper yes, Hall of Legends (Gen 1–5 set) no");
  const w = { pokemon: own([133, 134, 135, 136, 196, 197, 470, 700]) };
  P.retroEvaluate(w, NOW);
  assertTrue(!w.ach?.evo_family_eevee, "Sylveon can't stand in for Glaceon in Eeveelution Gallery");
  const x = { pokemon: own([133, 134, 135, 136, 196, 197, 470, 471, 700]) };
  P.retroEvaluate(x, NOW);
  assertTrue(x.ach?.evo_family_eevee, "Eeveelution Gallery still unlocks with the original 8");
  enable(null);
}

section("New regions are gated by generation");
{
  const alola = Object.values(DEX).filter((p) => p.region === "Alola").map((p) => p.id);
  const u = { pokemon: own(alola) }; // e.g. admin test grants
  P.retroEvaluate(u, NOW);
  assertTrue(!u.ach?.col_region_alola_full && !u.ach?.col_region_alola_half, "Gen 7 off: owning all of Alola unlocks nothing");
  const hidden = P.achievementView(u, {}).achievements.map((r) => r.id);
  assertTrue(!hidden.some((id) => /alola|kalos|galar|paldea|_1025|traveler_9/.test(id)), "unreleased-generation achievements are not shown");
  enable([7]);
  P.evaluate(u, ["state:region:Alola"], NOW);
  assertTrue(u.ach.col_region_alola_full && u.ach.col_region_alola_75 && u.ach.col_region_alola_half, "Gen 7 live: Alola Explorer / Cartographer / Pokédex Complete");
  assertTrue(!u.ach.col_region_kalos_half, "Kalos still off");
  enable(null);
  const shown = P.achievementView(u, {}).achievements.map((r) => r.id);
  assertTrue(shown.includes("col_region_alola_full"), "after a rollback, an achievement already earned stays visible (never revoked)");
  enable([6, 7, 8, 9]);
  const all9 = { pokemon: own(Object.keys(cat.ALL_REGIONS).map((r) => Object.values(DEX).find((p) => p.region === r).id)) };
  P.retroEvaluate(all9, NOW);
  assertTrue(all9.ach.col_world_traveler_9 && all9.ach.col_world_traveler, "World Traveler II (9 regions) once all generations are live; World Traveler (5) as before");
  enable(null);
}

section("Forms never double-count a species");
{
  const u = { pokemon: { 52: { normal: 1, shiny: 0 }, "52:galar": { normal: 2, shiny: 1 }, "6:megax": { normal: 1, shiny: 0 } } };
  assertEqual(metric(u, "state:uniqueSpecies"), 2, "Meowth + Galarian Meowth = 1 species; Mega Charizard X counts as Charizard");
  assertEqual(metric(u, "state:region:Kanto"), 2, "region completion counts species once");
  assertEqual(metric(u, "state:shinySpecies"), 1, "a shiny form counts as one shiny species");
}

section("Inventory, gifting and collection with Gen 6–9 species");
{
  const a = { pokemon: { 700: { normal: 3, shiny: 1 } }, training: {} }, b = { pokemon: {}, training: {} };
  assertEqual(giftPokemon(a, b, "700", "Sylveon", 2), null, "gift 2 Sylveon");
  assertTrue(a.pokemon[700].normal === 1 && a.pokemon[700].shiny === 1 && b.pokemon[700].normal === 2, "counts move exactly; shiny stays with the sender");
  assertEqual(metric(b, "state:region:Kalos"), 1, "the recipient's Kalos progress counts it");
  const legacyRecord = JSON.parse(JSON.stringify({ pokemon: own(range(1, 649)), training: { "25:normal": { exp: 8000 } } }));
  const copy = JSON.parse(JSON.stringify(legacyRecord));
  P.retroEvaluate(copy, NOW);
  assertEqual(JSON.stringify(copy.pokemon), JSON.stringify(legacyRecord.pokemon), "a full Gen 1–5 collection is untouched");
  assertTrue(copy.ach.col_species_649 && copy.ach.col_legendary_all && copy.ach.col_mythic_all && copy.ach.evo_family_all, "owning all 649 still completes the classic Pokédex, legendaries, mythics and families");
}

await fsp.rm(dir, { recursive: true, force: true });
finish();
