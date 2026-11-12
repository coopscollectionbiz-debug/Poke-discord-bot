// ==========================================================
// tests/achievementsExpansion.test.js — Release C revision 2 ("Mastery")
// Catalog integrity + reachability against the real datasets, Pokédex /
// region / classification ownership, shiny species vs copies vs lifetime,
// evolution families from the real graph, distinct evolved species, battle
// streaks through the real runBattle, daily/weekly counting through the
// real /daily command and weekly handler (incl. concurrency and replay),
// revision upgrade from rev 1, AP recalculation, hidden privacy, restart.
// Synthetic players, temp storage only.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { RANKED } from "../utils/battle/tuning.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ach-expansion-"));
process.env.TRAINERDATA_DIR = dir;

const cat = await import("../catalog/achievements.js");
const P = await import("../progression/achievements.js");
const D = await import("../commands/achievements.js");
const { createAchievementHandlers } = await import("../services/achievementsApi.js");
const { APPROVED_REWARD_IDS } = await import("../config/achievementRewards.js");
const { createGameplayHandlers } = await import("../services/gameplay.js");
const { runBattle } = await import("../utils/battle/runBattle.js");
const { execute: daily } = await import("../commands/daily.js");
const { lockUser } = await import("../utils/userLocks.js");
const { saveAndAck } = await import("../utils/saveManager.js");
const { createNewUser } = await import("../utils/userSchema.js");
const { grantCatch } = await import("../utils/training.js");
const { TYPE_ID_TO_NAME } = await import("../utils/battle/data.js");
const store = await import("../persistence/localStore.js");

const readJson = async (p) => JSON.parse(await fs.readFile(new URL(p, import.meta.url), "utf8"));
// Release C/Mastery entries are about the Gen 1–5 Pokédex (#1–649); Gens 6–9 have their own revision-3 entries.
const FULL_DEX = Object.values(await readJson("../public/pokemonData.json"));
const DEX = FULL_DEX.filter((p) => Number(p.id) <= 649);
const TRAINERS = await readJson("../trainerSprites.json");
const clone = (o) => JSON.parse(JSON.stringify(o));
const NOW = Date.UTC(2026, 10, 9, 12);
const DAY = P.dayNumber(NOW);
const own = (ids, shinyIds = []) => Object.fromEntries(ids.map((i) => [i, { normal: 1, shiny: shinyIds.includes(i) ? 1 : 0 }]));
const idsWhere = (f) => DEX.filter(f).map((p) => p.id);
const quietLog = { log: console.log, warn: console.warn, error: console.error };
const hush = () => { console.log = console.warn = console.error = () => {}; };
const unhush = () => Object.assign(console, quietLog);

// ======================= Catalog =======================
section("Catalog integrity (revision 2)");
{
  const all = cat.listAchievements();
  const ids = all.map((a) => a.id);
  assertEqual(cat.CATALOG_REVISION, 4, "catalog revision is 4 (Pokémon re-tier after Generations 6–9)");
  assertEqual(all.length, 165, "165 achievements (141 + 16 for Generations 6–9 + 8 casual battle)");
  assertEqual(new Set(ids).size, ids.length, "ids unique");
  // Every revision-1 entry is unchanged (ids, targets, metrics, AP, tiers).
  const REV1 = { col_first: [1, 5], col_species_500: [500, 100], col_region_unova_full: [156, 75], col_mythic: [1, 40], shiny_100: [100, 150], shiny_species_50: [50, 80], evo_100: [100, 50], bat_wins_500: [500, 100], bat_rating_1600: [1600, 60], trainer_250: [250, 80], don_5000: [5000, 80], econ_buy_100: [100, 30], meta_ap_1500: [1500, 0], lvl_100: [100, 60] };
  assertTrue(Object.entries(REV1).every(([id, [t, ap]]) => cat.getAchievement(id)?.target === t && cat.getAchievement(id)?.ap === ap), "revision-1 targets and AP preserved");
  assertEqual([all.filter((a) => a.since === 1).length, all.filter((a) => a.since === 2).length, all.filter((a) => a.since === 3).length], [83, 58, 16], "83 revision-1 and 58 revision-2 entries kept; 16 revision-3 entries");
  // Self-referential AP loops impossible: meta achievements give 0 AP.
  assertTrue(all.filter((a) => a.metric.key === "ap").every((a) => a.ap === 0), "AP milestones award 0 AP");
  assertTrue(all.every((a) => a.ap <= 250), "no single achievement is worth more than 250 AP");
  // No new rewards; nothing approved.
  const added = all.filter((a) => a.since === 2);
  assertTrue(added.every((a) => a.reward === null && a.rewardStatus === "none"), "expansion adds no currency/item rewards");
  assertEqual(APPROVED_REWARD_IDS.length, 0, "APPROVED_REWARD_IDS is still empty");
  // Tier thresholds increase within each metric.
  const byMetric = new Map();
  for (const a of all) { const k = `${a.metric.kind}:${a.metric.key}`; byMetric.set(k, [...(byMetric.get(k) || []), a]); }
  let ok = true;
  for (const [k, list] of byMetric) {
    const s = [...list].sort((x, y) => x.target - y.target);
    for (let i = 1; i < s.length; i++) if (s[i].target === s[i - 1].target && !k.startsWith("state:region:")) ok = false;
    for (let i = 1; i < s.length; i++) if (s[i].tier < s[i - 1].tier) ok = false;
  }
  assertTrue(ok, "within a metric, targets are distinct and tiers never decrease as targets rise");
  assertEqual(cat.CATEGORIES.activity.label, "Daily & Weekly", "new Daily & Weekly category");
}

section("Reachability against the real datasets");
{
  const all = cat.listAchievements();
  const regionSize = (r) => DEX.filter((p) => p.region === r).length;
  const typeCount = (t) => DEX.filter((p) => p.types.includes(Number(t))).length;
  const tierCount = (t) => DEX.filter((p) => String(p.tier).toLowerCase() === t).length;
  const trainerTier = (t) => Object.values(TRAINERS).filter((x) => String(x.tier).toLowerCase() === t).length;
  assertEqual(DEX.length, cat.SUPPORTED_SPECIES, `supported Pokédex is ${DEX.length} species`);
  assertEqual(Object.fromEntries(Object.keys(cat.REGIONS).map((r) => [r, regionSize(r)])), { ...cat.REGIONS }, "regional totals match pokemonData.json");
  assertEqual([tierCount("legendary"), tierCount("mythic")], [cat.TIER_SPECIES.legendary, cat.TIER_SPECIES.mythic], "Legendary/Mythic totals match the dataset");
  assertEqual(P.familyCount(), cat.MULTI_MEMBER_FAMILIES, "225 multi-member evolution families in the graph");
  assertTrue(Object.keys(TYPE_ID_TO_NAME).every((t) => typeCount(t) >= cat.TYPE_MASTERY_MIN), "every type has enough species for Type Encyclopedia");
  // Classic metrics are bounded by the Gen 1–5 data; the rest by all 1,025 species.
  const fullCount = (f) => FULL_DEX.filter(f).length;
  const reach = {
    uniqueSpecies: FULL_DEX.length, classicSpecies: DEX.length, shinySpecies: FULL_DEX.length, regions: 5, regionsAll: 9, shinyRegions: 5, familiesComplete: P.familyCount(),
    typeMastery: 17, typeMasteryAll: Object.keys(TYPE_ID_TO_NAME).length, trainers: Object.keys(TRAINERS).length,
    "trainerTier:legendary": trainerTier("legendary"), "trainerTier:mythic": trainerTier("mythic"),
    "classicTier:legendary": tierCount("legendary"), "classicTier:mythic": tierCount("mythic"),
    "tier:legendary": fullCount((p) => p.tier === "legendary"), "tier:mythic": fullCount((p) => p.tier === "mythic"),
    "shinyTier:legendary": fullCount((p) => p.tier === "legendary"), "shinyTier:mythic": fullCount((p) => p.tier === "mythic"),
    "family:133": P.FAMILY_SIZES.get(133),
  };
  for (const r of Object.keys(cat.ALL_REGIONS)) reach[`region:${r}`] = fullCount((p) => p.region === r);
  for (const t of Object.keys(TYPE_ID_TO_NAME)) reach[`type:${t}`] = fullCount((p) => p.types.includes(Number(t)));
  assertTrue(all.filter((a) => a.metric.kind === "state").every((a) => reach[a.metric.key] !== undefined || !/^(region:|type:|tier:|classic|unique|regions)/.test(a.metric.key)), "every collection metric has a data bound");
  const bounded = all.filter((a) => a.metric.kind === "state" && reach[a.metric.key] !== undefined);
  const over = bounded.filter((a) => a.target > reach[a.metric.key]).map((a) => a.id);
  assertEqual(over, [], `no state achievement exceeds what the data allows (${bounded.length} checked)`);
  assertTrue(!cat.getAchievement("col_species_750"), "no 750-species achievement (only 649 supported)");
  assertTrue(!cat.getAchievement("trainer_750") && !cat.getAchievement("trainer_1000"), "no trainer threshold above the 745 trainers");
  assertTrue(!all.some((a) => /rating_18|rating_2/.test(a.id)), "no rating milestone above 1600 (not reachable with Elo K=32 in one guild)");
  assertTrue(!all.some((a) => /trade|friend/.test(a.id)), "no trade/friendship evolution achievements (not game mechanics)");
}

// ======================= Pokédex =======================
section("Pokédex, regions and classifications (ownership)");
{
  const kanto = idsWhere((p) => p.region === "Kanto");
  const u = { pokemon: own(kanto.slice(0, Math.ceil(151 * 0.75))) };
  P.retroEvaluate(u, NOW);
  assertTrue(u.ach.col_region_kanto_75 && u.ach.col_region_kanto_half && !u.ach.col_region_kanto_full, "Kanto 75% between half and full");
  assertTrue(!u.ach.col_world_traveler, "only one region: not a World Traveler");
  const one = { pokemon: own(["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova"].map((r) => idsWhere((p) => p.region === r)[0])) };
  P.retroEvaluate(one, NOW);
  assertTrue(!!one.ach.col_world_traveler, "one Pokémon from each region → World Traveler");

  const full = { pokemon: own(DEX.map((p) => p.id)) };
  P.retroEvaluate(full, NOW);
  assertTrue(full.ach.col_species_649 && full.ach.col_legendary_all && full.ach.col_mythic_all && full.ach.col_type_all && full.ach.evo_family_all, "owning all 649 completes Pokédex, legendaries, mythics, types and every family");
  const missing = clone(full);
  delete missing.pokemon[idsWhere((p) => p.tier === "legendary")[0]];
  delete missing.ach;
  delete missing.progression;
  P.retroEvaluate(missing, NOW);
  assertTrue(!missing.ach.col_species_649 && !missing.ach.col_legendary_all && missing.ach.col_legendary_25, "one missing Legendary: no Pokédex Complete, no Hall of Legends");
  const leg = idsWhere((p) => p.tier === "legendary");
  const l = { pokemon: own(leg.slice(0, 10)) };
  P.retroEvaluate(l, NOW);
  assertTrue(l.ach.col_legendary_10 && !l.ach.col_legendary_25, "10 Legendaries → Legend Collector only");
  // Types: 15 of 16 types is not enough.
  const perType = new Set();
  for (const t of Object.keys(TYPE_ID_TO_NAME).slice(0, 16)) idsWhere((p) => p.types.includes(Number(t))).slice(0, 15).forEach((i) => perType.add(i));
  const ty = { pokemon: own([...perType].filter((i) => !DEX.find((p) => p.id === i).types.includes(Number(Object.keys(TYPE_ID_TO_NAME)[16])))) };
  P.retroEvaluate(ty, NOW);
  assertTrue(!ty.ach?.col_type_all, "Type Encyclopedia needs all 17 types");
  // Ownership semantics: donating drops the metric, but unlocks are permanent.
  P.trackProgress(full, [{ type: "donated", n: 1 }], NOW);
  full.pokemon = {};
  P.trackProgress(full, [{ type: "donated", n: 1 }], NOW);
  assertTrue(full.ach.col_species_649, "unlocks stay after the Pokémon are gone");
  assertTrue(/at the same time/.test(cat.getAchievement("col_species_649").description) && /at the same time/.test(cat.getAchievement("evo_family_10").description), "ownership-based achievements say so");
}

// ======================= Shiny =======================
section("Shiny species vs copies vs lifetime");
{
  // 10 copies of ONE shiny species: copies ≠ species.
  const u = { pokemon: { 25: { normal: 0, shiny: 10 } } };
  P.retroEvaluate(u, NOW);
  assertTrue(u.ach.shiny_10 && !u.ach.shiny_species_10, "10 shiny copies of one species: Shiny Hunter I, not Prismatic Pokédex I");
  assertEqual(u.stats.shinyObtained, 10, "lifetime counter seeded with copies (lower bound)");
  const leg = idsWhere((p) => p.tier === "legendary")[0];
  const myth = idsWhere((p) => p.tier === "mythic")[0];
  const v = { pokemon: { ...own([1, 2, 3]), [leg]: { normal: 1, shiny: 0 } } };
  P.retroEvaluate(v, NOW);
  assertTrue(!v.ach.shiny_legendary && v.ach.col_legendary, "a normal Legendary is not a shiny Legendary");
  v.pokemon[leg].shiny = 1;
  P.trackProgress(v, [{ type: "shiny" }], NOW);
  // shinyTier metrics are collection metrics, evaluated on pokemon events:
  P.trackProgress(v, [{ type: "pokemon" }], NOW);
  assertTrue(!!v.ach.shiny_legendary && !v.ach.shiny_mythic, "shiny Legendary unlocks Gleaming Legend, not Mirage");
  v.pokemon[myth] = { normal: 0, shiny: 1 };
  P.trackProgress(v, [{ type: "pokemon" }], NOW);
  assertTrue(!!v.ach.shiny_mythic, "shiny Mythic → hidden Mirage");
  const glob = { pokemon: own(["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova"].map((r) => idsWhere((p) => p.region === r)[3]), ["Kanto", "Johto", "Hoenn", "Sinnoh"].map((r) => idsWhere((p) => p.region === r)[3])) };
  P.retroEvaluate(glob, NOW);
  assertTrue(!glob.ach.shiny_globetrotter, "4 of 5 regions shiny: no Globetrotter");
  // Conversion counts once: the hook sends exactly one shiny event.
  const conv = { stats: { shinyObtained: 5 }, progression: { rev: 2 }, pokemon: { 1: { normal: 0, shiny: 1 } } };
  P.trackProgress(conv, [{ type: "shiny" }, { type: "pokemon" }], NOW);
  assertEqual(conv.stats.shinyObtained, 6, "a shiny conversion adds exactly 1 to the lifetime counter");
  // Re-running retro never lowers or double-seeds.
  const r = { pokemon: { 4: { normal: 0, shiny: 3 } }, stats: { shinyObtained: 40 } };
  P.retroEvaluate(r, NOW);
  assertEqual(r.stats.shinyObtained, 40, "baseline never lowers a higher counter");
}

// ======================= Evolution =======================
section("Evolution families (real graph) and distinct evolved species");
{
  const fam = (id) => DEX.filter((p) => P.FAMILY_SIZES && true).filter((p) => sameFamily(p.id, id)).map((p) => p.id);
  // sameFamily via the graph: BFS over evolvesTo/From in the test (independent of the engine's union-find).
  const byId = new Map(DEX.map((p) => [p.id, p]));
  function sameFamily(a, b) {
    const seen = new Set([a]);
    const q = [a];
    while (q.length) { const x = q.shift(); if (x === b) return true; for (const y of [...byId.get(x).evolvesTo, ...byId.get(x).evolvesFrom]) if (byId.has(y) && !seen.has(y)) { seen.add(y); q.push(y); } }
    return false;
  }
  const eevee = fam(133);
  assertEqual(eevee.length, 8, "branching family: Eevee + 7 evolutions");
  assertEqual(fam(1).sort((a, b) => a - b), [1, 2, 3], "multi-stage family: Bulbasaur line");
  assertEqual(P.FAMILY_SIZES.get(DEX.find((p) => p.name === "Tauros").id), 1, "species without evolutions are a family of 1 (not counted)");
  assertEqual(fam(236).length, 4, "Tyrogue's branching family (4)");
  const u = { pokemon: own(eevee.slice(0, 7)) };
  P.retroEvaluate(u, NOW);
  assertTrue(!u.ach?.evo_family_eevee && !u.ach?.evo_family_1, "7 of 8 Eeveelutions: incomplete");
  u.pokemon[eevee[7]] = { normal: 0, shiny: 1 };
  P.trackProgress(u, [{ type: "pokemon" }], NOW);
  assertTrue(u.ach.evo_family_eevee && u.ach.evo_family_1, "the 8th (even shiny) completes the hidden Eeveelution Gallery");
  const t = { pokemon: own([DEX.find((p) => p.name === "Tauros").id]) };
  P.retroEvaluate(t, NOW);
  assertTrue(!t.ach?.evo_family_1, "a no-evolution species never counts as a completed family");

  // Distinct species evolved into + shiny evolutions (counters, no history).
  const e = { progression: { rev: 2 }, pokemon: {} };
  for (let i = 0; i < 12; i++) P.trackProgress(e, [{ type: "evolved", species: 2, shiny: false }], NOW);
  assertEqual([e.stats.evolutions, e.evoSpecies], [12, [2]], "evolving into the same species 12× counts 12 evolutions but 1 species");
  for (const s of [3, 5, 6, 8, 9, 11, 12, 14, 15]) P.trackProgress(e, [{ type: "evolved", species: s }], NOW);
  assertTrue(e.ach.evo_species_10 && e.ach.evo_10 && !e.ach.evo_shiny_1, "10 distinct targets → Evolution Scholar I");
  P.trackProgress(e, [{ type: "evolved", species: 99999, shiny: true }], NOW);
  assertTrue(e.evoSpecies.length === 10 && e.ach.evo_shiny_1, "unknown species ignored for distinct count; shiny evolution counted");

  // Real handler: a replayed evolve request doesn't count twice.
  const U = "500000000000000001";
  const td = { [U]: { cc: 0, tp: 0, pokemon: { 10: { normal: 2, shiny: 0 } }, items: { evolution_stone: 5 }, displayedPokemon: [], training: {} } };
  const h = createGameplayHandlers({ getTrainerData: () => td, lockUser, save: (d) => saveAndAck(d, { save: async () => true }), normalizeUserSchema: (_i, x) => x, logEvent: () => {}, onRareCatch: () => {} });
  const evo = () => h.evolve({ body: { id: U, baseId: 10, targetId: 11, requestId: "evo-ach-0001" }, isAuthorized: (id) => id === U });
  const r1 = await evo();
  const r2 = await evo();
  assertTrue(r1.body.success && r2.body.replayed, "first evolve applied, second replayed");
  assertEqual([td[U].stats.evolutions, td[U].evoSpecies], [1, [11]], "replay does not count a second evolution");
  const bad = await h.evolve({ body: { id: U, baseId: 10, targetId: 12 }, isAuthorized: (id) => id === U });
  assertTrue(bad.status === 400 && td[U].stats.evolutions === 1, "an illegitimate evolution (PR #50 check) is refused and not counted");
}

// ======================= Battles =======================
section("Battle streaks through the real runBattle");
{
  const fixed = () => 0.5;
  const mk = (id, team) => { const u = createNewUser(id, `T${id}`); for (const s of team) grantCatch(u, s, "normal", fixed); u.displayedPokemon = team.map((s) => ({ id: s, variant: "normal" })); u.battleTeam = u.displayedPokemon.map((s) => ({ ...s })); return u; };
  // Evenly matched teams so the real simulation produces both outcomes.
  const td = { A: mk("A", [7, 4]), B: mk("B", [4, 7]) };
  let day = 0;
  const results = [];
  const upsets = { A: 0, B: 0 };
  for (let seed = 1; seed <= 40; seed++) {
    // Battle achievements count ranked (and wager) battles.
    const out = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "ranked", seed, now: new Date(NOW + 86_400_000 * day++) });
    if (!out.ok) continue;
    results.push(out.winnerId);
    if (out.rating[out.loserId].from - out.rating[out.winnerId].from >= 200) upsets[out.winnerId]++;
  }
  assertTrue(results.includes("A") && results.includes("B"), `fixture: ${results.length} real battles with both outcomes`);
  // Expected streaks recomputed independently from the real results.
  const expect = (who) => { let cur = 0, best = 0; for (const w of results) { cur = w === who ? cur + 1 : 0; best = Math.max(best, cur); } return [cur, best]; };
  for (const who of ["A", "B"]) {
    assertEqual([td[who].stats?.winStreak ?? 0, td[who].stats?.bestWinStreak ?? 0], expect(who), `${who}: current and best streak match the real win/loss sequence`);
    assertEqual(td[who].battle.wins, results.filter((w) => w === who).length, `${who}: wins and streak moved in the same block`);
  }
  const winSeeds = [];
  for (let s = 1; s < 400 && winSeeds.length < 1; s++) {
    const t2 = { X: mk("X", [150, 249, 250]), Y: mk("Y", [10]) };
    if (runBattle({ trainerData: t2, challengerId: "X", defenderId: "Y", mode: "ranked", seed: s, now: new Date(NOW) }).winnerId === "X") winSeeds.push(s);
  }
  const opp = ["B"];
  // Engine-level contract with the exact runBattle event (won true/false).
  const s = { battle: { wins: 0 }, progression: { rev: 2 } };
  const win = () => { s.battle.wins++; P.trackProgress(s, [{ type: "battle", won: true, upset: false }], NOW); };
  for (let i = 0; i < 4; i++) win();
  P.trackProgress(s, [{ type: "battle", won: false }], NOW);
  for (let i = 0; i < 2; i++) win();
  assertEqual([s.stats.winStreak, s.stats.bestWinStreak], [2, 4], "a loss resets the streak; best streak kept");
  assertTrue(s.ach.bat_streak_3 && !s.ach.bat_streak_5, "best 4 → Hot Streak only");
  P.trackProgress(s, [{ type: "battle" }], NOW);
  assertEqual(s.stats.winStreak, 2, "an event without a confirmed result never moves the streak");
  const up = { battle: { wins: 1 }, progression: { rev: 2 } };
  P.trackProgress(up, [{ type: "battle", won: true, upset: true }], NOW);
  assertTrue(!!up.ach.bat_upset, "beating a 200+ higher-rated opponent → hidden Giant Slayer");
  const lost = { battle: { wins: 0 }, progression: { rev: 2 } };
  P.trackProgress(lost, [{ type: "battle", won: false, upset: true }], NOW);
  assertTrue(!lost.ach?.bat_upset && !lost.stats?.upsetWins, "losing never counts as an upset (no reward for losing)");
  // Upset flag from real ratings.
  const ut = { X: mk("X", [150, 249, 250]), Y: mk("Y", [10]) };
  ut.X.battle = { rating: 1000, wins: 0, losses: 0, day: "", started: 0, vs: {}, season: RANKED.season };
  ut.Y.battle = { rating: 1300, wins: 0, losses: 0, day: "", started: 0, vs: {}, season: RANKED.season };
  const o = runBattle({ trainerData: ut, challengerId: "X", defenderId: "Y", mode: "ranked", seed: winSeeds[0], now: new Date(NOW) });
  if (o.winnerId === "X") assertEqual(ut.X.stats.upsetWins, 1, "real battle: 300-point underdog win recorded as an upset");
  else assertTrue(!ut.X.stats?.upsetWins, "real battle: no upset without a win");
  assertEqual([td.A.stats?.upsetWins ?? 0, td.B.stats?.upsetWins ?? 0], [upsets.A, upsets.B], `upsets recorded exactly when the winner was rated 200+ lower before the battle (A ${upsets.A}, B ${upsets.B})`);
  assertTrue(opp.length === 1, "fixture");
}

// ======================= Daily & weekly =======================
section("Daily claims and streaks (UTC days)");
{
  const u = { progression: { rev: 2 } };
  const d = (day) => P.trackProgress(u, [{ type: "daily", day }], NOW);
  d(DAY);
  d(DAY); // duplicate same day
  assertEqual([u.stats.dailyClaims, u.stats.dailyStreak], [1, 1], "a second count on the same UTC day is refused");
  for (let i = 1; i <= 6; i++) d(DAY + i);
  assertTrue(u.stats.dailyClaims === 7 && u.stats.bestDailyStreak === 7 && u.ach.daily_7 && u.ach.daily_streak_7, "7 consecutive days → Regular Visitor + Week Streak");
  d(DAY + 9); // missed two days
  assertEqual([u.stats.dailyStreak, u.stats.bestDailyStreak, u.stats.dailyClaims], [1, 7, 8], "a missed day restarts the streak; best kept; claims keep counting");
  d(DAY + 3); // clock went backwards
  assertEqual(u.stats.dailyClaims, 8, "an earlier day never counts");
  // Through the real /daily command: concurrency and duplicates.
  const id = "600000000000000001";
  const td = { [id]: createNewUser(id, "Ash") };
  const fake = () => ({ user: { id, username: "Ash" }, deferred: false, replied: false, async deferReply() { this.deferred = true; }, async editReply(p) { return p; }, async reply(p) { this.replied = true; return p; }, async followUp(p) { return p; } });
  hush();
  try {
    await Promise.all(Array.from({ length: 5 }, () => daily(fake(), td, null, null, lockUser, null, null)));
  } finally { unhush(); }
  const today = Math.floor(Date.parse(new Date().toISOString().slice(0, 10)) / 86_400_000);
  assertEqual([td[id].stats?.dailyClaims, td[id].stats?.lastDailyDay], [1, today], "5 concurrent /daily presses → exactly one counted claim (today, UTC)");
  assertTrue(!td[id].ach?.daily_7, "no history inferred from lastDaily");
}

section("Weekly pack claims (real handler)");
{
  const U = "700000000000000001";
  const td = { [U]: { cc: 0, tp: 0, pokemon: {}, items: { evolution_stone: 0 }, displayedPokemon: [], training: {} } };
  let ok = true;
  const h = createGameplayHandlers({ getTrainerData: () => td, lockUser, save: (d) => saveAndAck(d, { save: async () => ok }), normalizeUserSchema: (_i, x) => x, logEvent: () => {}, onRareCatch: () => {} });
  const wk = (rid) => h.weeklyPack({ body: { id: U, ...(rid ? { requestId: rid } : {}) }, isAuthorized: (id) => id === U });
  const par = await Promise.all([wk(), wk(), wk(), wk()]);
  assertEqual([par.filter((r) => r.body.success).length, td[U].stats.weeklyClaims], [1, 1], "4 concurrent weekly claims → one success, one count");
  const refused = await wk();
  assertTrue(!refused.body.success && td[U].stats.weeklyClaims === 1, "a refused claim is not counted");
  // Next week, with a delayed save and a replay.
  td[U].weeklyPackClaimed = false;
  ok = false;
  hush();
  const a = await wk("weekly-ach-0002");
  const b = await wk("weekly-ach-0002");
  unhush();
  ok = true;
  assertTrue(a.body.success && a.body.saved === false && !b.body.success && td[U].stats.weeklyClaims === 2, "delayed save, then a retry: retry refused by the once-per-week flag, counted once, reported as not yet saved");
  for (let i = 0; i < 3; i++) P.trackProgress(td[U], [{ type: "weekly" }], NOW);
  assertTrue(!!td[U].ach.weekly_5, "5 weekly claims → Weekly Regular");
}

// ======================= Trainers =======================
section("Trainer collection");
{
  const entries = Object.entries(TRAINERS);
  const files = (tier, n) => entries.filter(([, v]) => String(v.tier).toLowerCase() === tier).slice(0, n).map(([k, v]) => String((Array.isArray(v.sprites) && (typeof v.sprites[0] === "string" ? v.sprites[0] : v.sprites[0]?.file)) || `${k}.png`).toLowerCase());
  const u = { trainers: [...files("legendary", 10), ...files("mythic", 1), "not-a-real-trainer.png"] };
  P.retroEvaluate(u, NOW);
  assertTrue(u.ach.trainer_legendary_10 && u.ach.trainer_mythic_1 && !u.ach.trainer_mythic_10 && u.ach.trainer_10, "10 Legendary + 1 Mythic trainer; unknown files ignored for tiers");
  const v = { trainers: files("mythic", 9).map((f) => f.toUpperCase()), progression: { rev: 2 } };
  v.trainers.push(files("mythic", 10)[9]);
  P.trackProgress(v, [{ type: "trainers" }], NOW);
  assertTrue(!!v.ach.trainer_mythic_10, "trainer event (recruit/quest/gift/shop hooks) evaluates tier metrics, case-insensitive");
}

// ======================= Revision upgrade =======================
section("Revision 1 → 2 upgrade: conservative and idempotent");
{
  const kanto = idsWhere((p) => p.region === "Kanto");
  const u = {
    pokemon: own(kanto, kanto.slice(0, 12)),
    battle: { wins: 1100, rating: 1450 },
    trainers: ["a.png"],
    ach: { col_first: DAY - 30, col_species_100: DAY - 30, bat_wins_500: DAY - 20, shiny_10: DAY - 25 },
    achClaimed: { col_first: DAY - 29 },
    stats: { shinyObtained: 12, evolutions: 3 },
    progression: { rev: 1, day: DAY - 30, retro: ["col_first"] },
    lastDaily: new Date(NOW - 86_400_000).toISOString().slice(0, 10),
    weeklyPackClaimed: true,
  };
  P.normalizeProgression(u);
  const before = clone(u);
  const newly = P.retroEvaluate(u, NOW);
  assertTrue(newly.includes("col_region_kanto_75") && newly.includes("bat_wins_1000") && newly.includes("evo_family_1"), "rev-2 state achievements recognised on upgrade");
  assertTrue(!newly.some((id) => cat.getAchievement(id).retro === "none"), "no history-only achievement unlocked by the upgrade");
  assertTrue(!u.stats.dailyClaims && !u.stats.weeklyClaims && !u.stats.bestWinStreak && !u.evoSpecies, "no daily/weekly/streak/evolved-species history inferred");
  assertTrue(Object.entries(before.ach).every(([id, d]) => u.ach[id] === d), "existing unlock days preserved");
  assertEqual(u.achClaimed, before.achClaimed, "claims untouched");
  assertEqual(u.stats.evolutions, 3, "existing counters untouched");
  assertEqual(u.progression.rev, 4, "stamped with revision 4");
  assertEqual(u.progression.day, DAY - 30, "original tracking start day kept");
  assertEqual(u.ap, Object.keys(u.ach).reduce((s, id) => s + cat.getAchievement(id).ap, 0), "AP recalculated from all unlocks");
  const snap = clone(u);
  assertEqual(P.retroEvaluate(u, NOW + 5 * 86_400_000), [], "re-running the upgrade does nothing");
  assertEqual(u, snap, "…and changes nothing");
  // A rev-1 player with an unknown future id keeps it; AP ignores it.
  const f = { ach: { col_first: DAY, future_thing: DAY }, progression: { rev: 1 }, pokemon: own([1]) };
  P.normalizeProgression(f);
  P.retroEvaluate(f, NOW);
  assertTrue(f.ach.future_thing === DAY && f.ap === 5, "unknown ids kept; AP counts only known ones");
}

// ======================= Persistence =======================
section("Persistence: restart keeps every new counter");
{
  store.__resetLocalStoreForTests();
  store.setEpoch(1);
  const u = { progression: { rev: 2 }, pokemon: own([1]) };
  P.trackProgress(u, [{ type: "daily", day: DAY }, { type: "weekly" }, { type: "evolved", species: 2, shiny: true }, { type: "battle", won: true, upset: true }], NOW);
  await store.writeSnapshot({ 9001: u });
  const [cur] = await store.readLocalCandidates();
  const back = cur.data[9001];
  assertEqual([back.stats, back.evoSpecies, back.ach, back.ap], [u.stats, u.evoSpecies, u.ach, u.ap], "stats, evolved species, unlocks and AP survive a restart");
  P.normalizeProgression(back);
  P.trackProgress(back, [{ type: "daily", day: DAY }], NOW);
  assertEqual(back.stats.dailyClaims, 1, "after a restart, the same day still can't be counted twice");
  const bad = { evoSpecies: [2, "x", 2, 99999, -1, 3], stats: { winStreak: -2, dailyClaims: 1.5 } };
  P.normalizeProgression(bad);
  assertEqual([bad.evoSpecies, bad.stats.winStreak, bad.stats.dailyClaims], [[2, 3], 0, 1], "malformed new fields are repaired…");
  assertTrue(bad.progressionLegacy.some((e) => e.key === "evoSpecies") && bad.progressionLegacy.some((e) => e.key === "stats.winStreak"), "…and the originals recorded in progressionLegacy");
}

// ======================= Privacy & UI =======================
section("Hidden privacy, dashboard and Discord with the larger catalog");
{
  const A = "800000000000000001";
  const B = "800000000000000002";
  const td = { [A]: { pokemon: own([1, 2, 3]) }, [B]: { pokemon: own([4]) } };
  const H = createAchievementHandlers({ getTrainerData: () => td, lockUser, save: saveAndAck });
  const body = H.view({ query: { id: A }, isAuthorized: (id) => id === A }).body;
  const hiddenRows = body.achievements.filter((r) => r.hidden);
  const text = JSON.stringify(hiddenRows);
  assertEqual(hiddenRows.length, 5, "five hidden rows");
  assertTrue(hiddenRows.every((r) => r.name === "???" && r.ap === null && r.tier === null && r.progress === null && r.reward === null && /^hidden_\d+$/.test(r.id)), "locked hidden rows: no name, AP, tier, progress, reward or real id");
  assertTrue(!/Mirage|Eevee|Giant|Mythic|upset|shiny_mythic|bat_upset|evo_family_eevee|col_mythic/i.test(text), "no hidden name, condition or id leaks into the response");
  td[A].pokemon = own(idsWhere((p) => p.id >= 133 && p.id <= 136).concat([196, 197, 470, 471]));
  const after = H.view({ query: { id: A }, isAuthorized: () => true }).body.achievements.find((r) => r.id === "evo_family_eevee");
  assertTrue(after && after.unlocked && after.name === "Eeveelution Gallery" && after.ap === 40, "once unlocked, the details become visible");
  assertEqual(H.view({ query: { id: B }, isAuthorized: (id) => id === A }).status, 403, "cross-user view denied");
  assertEqual(H.view({ query: { id: A, category: "activity" }, isAuthorized: () => true }).body.achievements.length, 10, "activity category filter");
  assertTrue(body.categories.length === 9 && body.total === cat.listAchievements().filter(cat.isAchievementActive).length, "category counts cover all 9 categories (released generations only)");
  // Discord: every page of every category within embed limits; no claim button (nothing approved).
  const nonce = "a1b2c3d4e5f6";
  let pages = 0;
  for (const c of ["all", ...Object.keys(cat.CATEGORIES)]) {
    const first = D.buildAchievementsView(td[B], { nonce, category: c });
    for (let p = 0; p < first.pages; p++) {
      const v = D.buildAchievementsView(td[B], { nonce, category: c, page: p });
      pages++;
      const desc = v.embeds[0].data.description;
      if (desc.length > 4096 || (v.embeds[0].data.title || "").length > 256 || v.components[1].components.length !== 2) throw new Error(`page ${c}/${p} invalid`);
      if (/Mirage|Eeveelution|Giant Slayer|Mythic Archive|Myth Made Real/.test(desc)) throw new Error("hidden name leaked");
    }
  }
  assertTrue(pages > 20, `all ${pages} Discord pages render within limits, no hidden names, no claim buttons`);
  const ov = D.buildAchievementsView(td[B], { nonce });
  assertTrue(/Daily & Weekly: \*\*\d+\/10\*\* \(\d+%\)/.test(ov.embeds[0].data.description) && /\(\d+%\)/.test(ov.embeds[0].data.title), "overview shows completion percentages");
  const sel = ov.components[0].components[0].options.map((o) => o.data.value);
  assertEqual(sel, ["all", "collection", "shiny", "evolution", "battle", "casual", "training", "economy", "activity", "special"], "category select includes Daily & Weekly and Casual Battles");
  const st = { category: "all", page: 0 };
  assertTrue(D.reduceAchievementsInteraction(st, { userId: B, customId: `ach:${nonce}:cat`, values: ["activity"] }, { ownerId: B, nonce }).allowed, "owner can pick the new category");
  assertTrue(!D.reduceAchievementsInteraction(st, { userId: A, customId: `ach:${nonce}:next` }, { ownerId: B, nonce }).allowed, "another player can't press the buttons");
  assertTrue(!D.reduceAchievementsInteraction(st, { userId: B, customId: "ach:000000000000:next" }, { ownerId: B, nonce }).allowed, "an expired message's controls are refused");
}

await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
finish();
process.exit(0);
