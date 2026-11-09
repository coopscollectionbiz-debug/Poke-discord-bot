// ==========================================================
// tests/achievements.test.js — Release C achievement system
// Catalog, normalization, targeted progress, retroactive recognition,
// reward claims (lock, once-only, all-or-nothing, replay, failed/delayed
// save, restart), Discord view/ownership/hidden privacy, dashboard API.
// Synthetic players, temp storage only.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "achievements-"));
process.env.TRAINERDATA_DIR = dir;

const cat = await import("../catalog/achievements.js");
const P = await import("../progression/achievements.js");
const { createAchievementHandlers } = await import("../services/achievementsApi.js");
const D = await import("../commands/achievements.js");
const { defaultRewardPolicy, APPROVED_REWARD_IDS } = await import("../config/achievementRewards.js");
const { lockUser } = await import("../utils/userLocks.js");
const { saveAndAck, SAVE_DELAYED_NOTE } = await import("../utils/saveManager.js");
const { getCatalogItem } = await import("../catalog/items.js");
const { validateUserSchema, createNewUser } = await import("../utils/userSchema.js");
const store = await import("../persistence/localStore.js");

const clone = (o) => JSON.parse(JSON.stringify(o));
const quiet = console.error;
const NOW = Date.UTC(2026, 10, 9, 12);
const DAY = P.dayNumber(NOW);
const species = (ids, shinyIds = []) => Object.fromEntries(ids.map((i) => [i, { normal: 1, shiny: shinyIds.includes(i) ? 1 : 0 }]));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const TEST_APPROVED = new Set(["col_first", "col_species_100", "shiny_10", "col_species_25", "col_species_250"]);
const testPolicy = { isApproved: (e) => TEST_APPROVED.has(e.id) };

// ======================= Catalog =======================
section("Catalog");
{
  const all = cat.listAchievements();
  const ids = all.map((a) => a.id);
  assertEqual(new Set(ids).size, ids.length, "ids are unique");
  assertTrue(ids.every((id) => cat.ACHIEVEMENT_ID_PATTERN.test(id)), "ids are stable snake_case");
  assertTrue(all.length >= 80, `${all.length} achievements`);
  assertEqual(Object.keys(cat.CATEGORIES).length, 8, "8 categories (activity added in revision 2)");
  assertTrue(all.every((a) => cat.CATEGORIES[a.category] && a.name && a.description && Number.isSafeInteger(a.target) && a.target > 0 && Number.isSafeInteger(a.ap) && a.ap >= 0), "required metadata present");
  assertTrue(all.every((a) => ["state", "counter"].includes(a.metric.kind) && ["full", "baseline", "none"].includes(a.retro)), "metric kind and retroactivity declared");
  assertTrue(all.every((a) => Object.isFrozen(a)), "entries are frozen");
  // Tiered families: thresholds strictly increase with tier.
  for (const fam of ["col_species_", "shiny_", "bat_wins_", "evo_", "trainer_", "don_", "meta_ap_"]) {
    const f = all.filter((a) => a.id.startsWith(fam) && /^\d+$/.test(a.id.slice(fam.length))).sort((x, y) => x.target - y.target);
    assertTrue(f.every((a, i) => i === 0 || (a.target > f[i - 1].target && a.tier >= f[i - 1].tier)), `${fam}* thresholds and tiers increase`);
  }
  assertEqual(all.filter((a) => a.reward).every((a) => a.rewardStatus === "pending_approval"), true, "every reward is pending approval");
  assertEqual(APPROVED_REWARD_IDS.length, 0, "no reward is approved for production");
  assertTrue(all.every((a) => !defaultRewardPolicy.isApproved(a)), "the default policy approves nothing");
  assertEqual(cat.getAchievement("col_species_100").reward, { cc: 3000, items: { evolution_stone: 1 } }, "reward values match the design");
  assertEqual(cat.getAchievement("nope"), null, "unknown id → null");
  assertEqual(cat.getAchievement("__proto__"), null, "prototype key → null");
  assertEqual(all.filter((a) => a.hidden).map((a) => a.id).sort(), ["bat_upset", "col_mythic", "col_mythic_all", "evo_family_eevee", "shiny_mythic"], "five hidden achievements");
  assertTrue(all.filter((a) => a.id.startsWith("meta_ap_")).every((a) => a.ap === 0), "meta AP achievements give 0 AP (no loop)");
}

// ======================= Normalization =======================
section("Normalization");
{
  const u = JSON.parse('{"cc":5,"custom":{"keep":1},"ach":{"col_first":20000,"BAD ID":3,"col_species_25":-1,"future_ach":20001,"__proto__":7},"achClaimed":"oops","stats":{"evolutions":2.5,"donated":-3,"other":9},"ap":999}');
  P.normalizeProgression(u);
  assertEqual(Object.keys(u.ach).sort(), ["col_first", "future_ach"], "invalid entries removed from ach, unknown valid ids kept");
  assertTrue(!("achClaimed" in u), "a non-object achClaimed is removed…");
  const keys = u.progressionLegacy.map((e) => e.key);
  assertTrue(["ach.BAD ID", "ach.col_species_25", "ach.__proto__", "achClaimed", "stats.evolutions", "stats.donated"].every((k) => keys.includes(k)), "…and everything removed or fixed is recorded in progressionLegacy");
  assertEqual([u.stats.evolutions, u.stats.donated, u.stats.other], [2, 0, 9], "counters fixed, unknown stat kept");
  assertEqual(u.ap, 5, "AP recomputed from known unlocks");
  assertEqual(u.custom, { keep: 1 }, "unrelated fields untouched");
  const once = clone(u);
  assertTrue(!P.normalizeProgression(u) && JSON.stringify(u) === JSON.stringify(once), "normalization is idempotent");
  const fresh = createNewUser("1", "Ash");
  assertTrue(!("ach" in fresh) && !("stats" in fresh), "new records carry no achievement fields until needed");
  const v = { id: "2", ach: { col_first: "x" } };
  validateUserSchema(v, "2", "Misty");
  assertEqual(v.ach, {}, "validateUserSchema uses the same normalizer");
}

// ======================= Progress =======================
section("Targeted progress");
{
  const u = { tp: 0, pokemon: {}, battle: { wins: 0, rating: 1000 } };
  P.retroEvaluate(u, NOW);
  assertEqual(u.ach ?? {}, {}, "a brand-new player unlocks nothing");
  u.pokemon = species([25]);
  assertEqual(P.trackProgress(u, [{ type: "pokemon" }], NOW), ["col_first"], "first Pokémon → First Partner");
  assertEqual(P.trackProgress(u, [{ type: "pokemon" }], NOW), [], "duplicate event → nothing new (no double unlock)");
  u.battle.wins = 1;
  const before = clone(u);
  assertEqual(P.trackProgress(u, [{ type: "pokemon" }], NOW), [], "a Pokémon event does not evaluate battle achievements (targeted)");
  assertEqual(u.ach, before.ach, "…so nothing changed");
  assertEqual(P.trackProgress(u, [{ type: "battle" }], NOW), ["bat_first_win"], "battle event → First Victory");
  for (let i = 0; i < 9; i++) P.trackProgress(u, [{ type: "evolved" }], NOW);
  assertTrue(!u.ach.evo_10 && u.ach.evo_1 && u.stats.evolutions === 9, "counter: 9 evolutions → tier I only");
  P.trackProgress(u, [{ type: "evolved" }], NOW);
  assertTrue(!!u.ach.evo_10, "10th evolution → tier II");
  P.trackProgress(u, [{ type: "donated", n: 100 }], NOW);
  assertTrue(u.ach.don_1 && u.ach.don_100 && !u.ach.don_1000, "a bulk donation of 100 unlocks I and II");
  P.trackProgress(u, [{ type: "purchase" }], NOW);
  assertTrue(!!u.ach.econ_buy_1, "first purchase → Customer");
  u.pokemon = {}; // donate everything: permanent unlocks stay
  P.trackProgress(u, [{ type: "donated" }], NOW);
  assertTrue(!!u.ach.col_first, "unlocks are permanent even when the metric drops");
  assertEqual(u.ap, Object.keys(u.ach).reduce((s, id) => s + cat.getAchievement(id).ap, 0), "AP equals the sum of unlocked AP");
  const s0 = clone(u);
  assertEqual(P.trackProgress(u, [{ type: "unknown" }], NOW), [], "unknown events are ignored");
  assertEqual(u, s0, "…and change nothing (no unnecessary writes)");
  // Region / type / tier / rank / trainers / level.
  const w = { tp: 30000, pokemon: species(range(1, 151)), trainers: Array.from({ length: 12 }, (_, i) => `t${i}.png`), training: { "1:normal": { exp: 130000 } } };
  P.retroEvaluate(w, NOW);
  assertTrue(w.ach.col_region_kanto_full && w.ach.col_region_kanto_half && !w.ach.col_region_johto_half, "all 151 Kanto → Kanto complete, Johto untouched");
  assertTrue(w.ach.col_species_100 && !w.ach.col_species_250, "151 species → Researcher, not Professor's Aide");
  assertTrue(w.ach.col_legendary && w.ach.col_mythic, "Kanto includes legendary and mythic tiers");
  assertTrue(w.ach.rank_master_trainer && !w.ach.rank_gym_leader, "30,000 TP → Master Trainer, not Gym Leader");
  assertTrue(w.ach.trainer_10 && !w.ach.trainer_50, "12 trainers → Trainer Collector I");
  assertTrue(w.ach.lvl_50 && !w.ach.lvl_100, "a Level 50+ Pokémon → Seasoned");
  assertTrue([100, 500, 1500, 3000].every((n) => !!w.ach[`meta_ap_${n}`] === w.ap >= n), `AP milestones follow AP (${w.ap} AP)`);
}

// ======================= Retroactive =======================
section("Retroactive recognition");
{
  const longtime = { tp: 12000, pokemon: species(range(1, 300), range(1, 12)), battle: { wins: 55, rating: 1450 }, trainers: ["a.png"], customField: { keep: true } };
  const before = clone(longtime);
  const n1 = P.retroEvaluate(longtime, NOW);
  assertTrue(n1.length > 10, `a long-time player gets ${n1.length} provable unlocks`);
  assertTrue(longtime.ach.col_species_250 && longtime.ach.shiny_10 && longtime.ach.shiny_species_10 && longtime.ach.bat_wins_50 && longtime.ach.bat_rating_1400 && !longtime.ach.bat_rating_1600, "collection, shiny, battle unlocks from current data");
  assertEqual(longtime.stats.shinyObtained, 12, "shiny counter seeded with current shiny copies (a lower bound)");
  assertTrue(!longtime.stats.evolutions && !longtime.stats.donated && !longtime.stats.purchases, "no fabricated history: evolutions, donations, purchases start at 0");
  assertTrue(!longtime.ach.evo_1 && !longtime.ach.don_1 && !longtime.ach.econ_buy_1, "…so no history-only achievement is unlocked");
  assertEqual(longtime.progression.retro.sort(), n1.sort(), "retro unlocks are labelled");
  assertTrue(!longtime.achClaimed, "recognition grants no rewards");
  assertEqual([longtime.cc, longtime.items], [before.cc, before.items], "no currency or items granted");
  assertEqual(longtime.customField, { keep: true }, "unknown fields preserved");
  const snap = clone(longtime);
  assertEqual(P.retroEvaluate(longtime, NOW + 86_400_000), [], "re-running changes nothing");
  assertEqual(longtime, snap, "…idempotent");
  // Never lowers newer progress.
  const ahead = { tp: 0, pokemon: species([1], [1]), stats: { shinyObtained: 40, evolutions: 7 }, ach: { evo_1: DAY - 3 } };
  P.retroEvaluate(ahead, NOW);
  assertEqual([ahead.stats.shinyObtained, ahead.stats.evolutions, ahead.ach.evo_1], [40, 7, DAY - 3], "existing counters and unlock days are never lowered or rewritten");
  assertTrue(ahead.ach.shiny_25 && !ahead.ach.shiny_50, "counters above the baseline still count");
  // Previously claimed rewards stay claimed.
  const claimedBefore = { pokemon: species([1]), ach: { col_first: DAY - 10 }, achClaimed: { col_first: DAY - 9 } };
  P.retroEvaluate(claimedBefore, NOW);
  assertEqual(claimedBefore.achClaimed, { col_first: DAY - 9 }, "prior claims untouched");
  // Malformed historical fields.
  const broken = JSON.parse('{"pokemon":{"25":{"normal":"x"}},"ach":[1,2],"stats":"bad"}');
  P.normalizeProgression(broken);
  const r = P.retroEvaluate(broken, NOW);
  assertTrue(Array.isArray(r) && typeof broken.progression === "object", "malformed records are normalized then evaluated without throwing");
}

// ======================= Persistence =======================
section("Persistence: save, reload, restore");
{
  store.__resetLocalStoreForTests();
  store.setEpoch(1);
  const u = { cc: 1, pokemon: species(range(1, 30)), tp: 600 };
  P.retroEvaluate(u, NOW);
  P.trackProgress(u, [{ type: "evolved" }, { type: "shiny", n: 3 }], NOW);
  const data = { 5001: u };
  await store.writeSnapshot(data);
  const [cur] = await store.readLocalCandidates();
  const back = cur.data[5001];
  assertEqual([back.ach, back.stats, back.ap, back.progression], [u.ach, u.stats, u.ap, u.progression], "achievement state survives save/reload exactly");
  assertEqual(P.retroEvaluate(back, NOW + 1e9), [], "after a restart nothing is re-unlocked");
  P.normalizeProgression(back);
  assertEqual(back.ach, u.ach, "reload + normalize changes nothing");
  assertEqual(JSON.parse(JSON.stringify(data))[5001].ach, u.ach, "backup/restore text round trip keeps it");
}

// ======================= Claims =======================
section("Reward claims");
{
  const U = "200000000000000001";
  let saveOk = true;
  let saves = 0;
  const td = { [U]: { cc: 100, pokemon: species(range(1, 120), [5]), items: { evolution_stone: 0 } } };
  const H = createAchievementHandlers({ getTrainerData: () => td, lockUser, save: (d) => { saves++; return saveAndAck(d, { save: async () => saveOk }); }, policy: testPolicy });
  const claim = (achievementId, extra = {}) => H.claim({ body: { id: U, achievementId, ...extra }, isAuthorized: (id) => id === U });

  // Production default: nothing is claimable.
  const prod = createAchievementHandlers({ getTrainerData: () => td, lockUser, save: saveAndAck });
  const p0 = await prod.claim({ body: { id: U, achievementId: "col_first" }, isAuthorized: () => true });
  assertTrue(p0.status === 409 && /pending approval/.test(p0.body.error) && td[U].cc === 100, "with the production policy every reward is refused (pending approval)");

  const r1 = await claim("col_first");
  assertTrue(r1.status === 200 && r1.body.success && r1.body.saved === true, "valid claim succeeds and is saved");
  assertEqual([td[U].cc, td[U].achClaimed.col_first], [600, DAY], "exactly 500 CC granted, claim recorded today");
  const r2 = await claim("col_first");
  assertTrue(r2.status === 409 && /already claimed/.test(r2.body.error) && td[U].cc === 600, "a second claim is refused, no second grant");

  const r3 = await claim("col_species_100");
  assertTrue(r3.body.success && td[U].cc === 3600 && td[U].items.evolution_stone === 1, "CC + item reward granted through Release B (exact amounts)");
  const voucher = await claim("col_species_25");
  assertTrue(voucher.status === 409 && /unavailable/.test(voucher.body.error) && !td[U].achClaimed.col_species_25 && getCatalogItem("ball_voucher_poke").status === "defined", "a reward containing a not-yet-obtainable item is refused entirely (nothing granted)");
  td[U].pokemon = species(range(1, 260), [5]);
  const title = await claim("col_species_250");
  assertTrue(title.status === 409 && /title/.test(title.body.error), "unsupported reward types (title) are refused");
  const locked = await claim("shiny_10");
  assertTrue(locked.status === 400 && /haven't unlocked/.test(locked.body.error), "a locked achievement can't be claimed");
  assertEqual((await claim("no_such_ach")).status, 404, "unknown achievement: 404");
  assertEqual((await claim("BAD!")).status, 400, "malformed achievement id: 400");
  assertEqual((await H.claim({ body: { id: U, achievementId: "col_first" }, isAuthorized: () => false })).status, 403, "another player's session: 403");
  assertEqual((await claim("col_first", { requestId: "bad id" })).status, 400, "malformed request id: 400");

  // Concurrent claims of the same reward.
  td[U].stats = { shinyObtained: 10 };
  const dustBefore = td[U].items.shiny_dust ?? 0;
  const par = await Promise.all(Array.from({ length: 6 }, () => claim("shiny_10")));
  assertEqual([par.filter((r) => r.status === 200).length, (td[U].items.shiny_dust ?? 0) - dustBefore], [1, 10], "6 concurrent claims → exactly one grant of 10 Shiny Dust");

  // Replay, delayed save, restart.
  const V = "200000000000000002";
  td[V] = { cc: 0, pokemon: species([1]) };
  const claimV = (rid) => H.claim({ body: { id: V, achievementId: "col_first", requestId: rid }, isAuthorized: (id) => id === V });
  saveOk = false;
  console.error = () => {};
  const d1 = await claimV("claim-req-0001");
  const d2 = await claimV("claim-req-0001");
  console.error = quiet;
  assertTrue(d1.body.success && d1.body.saved === false && d1.body.saveNotice === SAVE_DELAYED_NOTE, "failed save: claim acknowledged as delayed, not saved");
  assertTrue(d2.body.replayed && d2.body.saved === false && td[V].cc === 500, "replay during the outage: not re-applied, still not saved");
  saveOk = true;
  const d3 = await claimV("claim-req-0001");
  assertTrue(d3.body.replayed && d3.body.saved === true && td[V].cc === 500, "replay after recovery: saved, still one grant");
  const restarted = clone(td);
  const H2 = createAchievementHandlers({ getTrainerData: () => restarted, lockUser, save: (d) => saveAndAck(d, { save: async () => true }), policy: testPolicy });
  const d4 = await H2.claim({ body: { id: V, achievementId: "col_first", requestId: "claim-req-0001" }, isAuthorized: () => true });
  const d5 = await H2.claim({ body: { id: V, achievementId: "col_first" }, isAuthorized: () => true });
  assertTrue(d4.body.replayed && d5.status === 409 && restarted[V].cc === 500, "after a restart: replay recognised, fresh claim refused, no double grant");
  assertTrue(saves > 0, "claims go through the A1/A2 save path");
}

// ======================= Dashboard API =======================
section("Dashboard /api/achievements");
{
  const A = "300000000000000001";
  const B = "300000000000000002";
  const td = { [A]: { tp: 600, pokemon: species(range(1, 30), [1]), secret: "x" }, [B]: { tp: 0, pokemon: {} } };
  const snap = clone(td);
  const H = createAchievementHandlers({ getTrainerData: () => td, lockUser, save: saveAndAck });
  const ok = H.view({ query: { id: A }, isAuthorized: (id) => id === A });
  assertTrue(ok.status === 200 && ok.body.success, "own achievements: 200");
  const first = ok.body.achievements.find((r) => r.id === "col_first");
  assertTrue(first.unlocked && first.reward.status === "pending_approval" && !first.claimable, "unlocked, reward shown as pending approval, not claimable");
  const sp = ok.body.achievements.find((r) => r.id === "col_species_100");
  assertEqual(sp.progress, { value: 30, target: 100 }, "progress is correct");
  assertTrue(!JSON.stringify(ok.body).includes("secret"), "never returns the raw record");
  assertEqual(H.view({ query: { id: B }, isAuthorized: (id) => id === A }).status, 403, "another player's achievements: 403");
  assertEqual(H.view({ query: { id: "x" }, isAuthorized: () => true }).status, 400, "malformed id: 400");
  assertEqual(H.view({ query: { id: A, category: "__proto__" }, isAuthorized: () => true }).status, 400, "unknown category: 400");
  assertEqual(H.view({ query: { id: "999999999999999999" }, isAuthorized: () => true }).status, 404, "unknown player: 404");
  assertEqual(H.view({ query: { id: A, category: "shiny" }, isAuthorized: () => true }).body.achievements.every((r) => r.category === "shiny"), true, "category filter");
  assertEqual(td, snap, "reads never mutate player data");
  const hidden = H.view({ query: { id: B }, isAuthorized: () => true }).body.achievements.find((r) => r.hidden && r.category === "collection");
  assertTrue(hidden.name === "???" && hidden.progress === null && hidden.reward === null && hidden.ap === null && /^hidden_\d+$/.test(hidden.id) && !/Mythic/.test(hidden.description), "a locked hidden achievement reveals nothing");
}

// ======================= Discord view =======================
section("Discord /achievements view");
{
  const nonce = "abcdef123456";
  const u = { tp: 600, pokemon: species(range(1, 30), [1]) };
  const v = D.buildAchievementsView(u, { nonce });
  const text = v.embeds[0].data.description;
  assertTrue(/Pokémon Collection: \*\*\d+\/48\*\* \(\d+%\)/.test(text) && /First Partner/.test(text), "overview shows category totals and achievements (unreleased generations hidden)");
  assertTrue(/pending approval/.test(text), "rewards are labelled pending approval");
  assertEqual(v.components[1].components.length, 2, "no Claim button when nothing is claimable");
  const total = cat.listAchievements().filter(cat.isAchievementActive).length;
  assertEqual(v.pages, Math.ceil(total / D.ACHIEVEMENTS_PAGE_SIZE), "paginated");
  const last = D.buildAchievementsView(u, { nonce, page: 999 });
  assertTrue(last.page === last.pages - 1 && last.embeds[0].data.description.length <= 4096, "page clamped, embed within limits");
  const hiddenPage = (() => { for (let p = 0; p < 10; p++) { const x = D.buildAchievementsView({ pokemon: {} }, { nonce, category: "collection", page: p }); if (/\?\?\?/.test(x.embeds[0].data.description)) return x; } return null; })();
  assertTrue(hiddenPage && !/Myth Made Real/.test(hiddenPage.embeds[0].data.description), "the hidden achievement's name is not revealed while locked");
  const withClaim = D.buildAchievementsView({ pokemon: species([1]) }, { nonce, policy: testPolicy });
  assertEqual(withClaim.components[1].components.length, 3, "a Claim button appears when a reward is claimable");
  const owner = "400000000000000001";
  const st = { category: "all", page: 0 };
  assertTrue(!D.reduceAchievementsInteraction(st, { userId: "400000000000000002", customId: `ach:${nonce}:next` }, { ownerId: owner, nonce }).allowed, "another player can't press the buttons");
  assertTrue(!D.reduceAchievementsInteraction(st, { userId: owner, customId: "ach:ffffffffffff:claim" }, { ownerId: owner, nonce }).allowed, "foreign nonce refused");
  assertTrue(!D.reduceAchievementsInteraction(st, { userId: owner, customId: "inv:abcdef123456:next" }, { ownerId: owner, nonce }).allowed, "other commands' component ids refused");
  assertTrue(!D.reduceAchievementsInteraction(st, { userId: owner, customId: `ach:${nonce}:cat`, values: ["__proto__"] }, { ownerId: owner, nonce }).allowed, "unknown category refused");
  const c = D.reduceAchievementsInteraction(st, { userId: owner, customId: `ach:${nonce}:claim` }, { ownerId: owner, nonce });
  assertTrue(c.allowed && c.claim, "owner's claim press is routed to claiming");
  const before = clone(u);
  D.buildAchievementsView(u, { nonce, category: "battle" });
  assertEqual(u, before, "rendering never mutates the record");
  // Claiming from Discord uses the same service.
  const td = { [owner]: { cc: 0, pokemon: species([1]) } };
  const H = createAchievementHandlers({ getTrainerData: () => td, lockUser, save: (d) => saveAndAck(d, { save: async () => true }), policy: testPolicy });
  const msg = await D.claimPage(H, owner, ["col_first"]);
  const again = await D.claimPage(H, owner, ["col_first"]);
  assertTrue(/Claimed 1 reward/.test(msg) && /already claimed/.test(again) && td[owner].cc === 500, "Discord claim grants once; a second press is refused");
}

await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
finish();
process.exit(0);
