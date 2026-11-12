// ==========================================================
// tests/gameplayRoutes.test.js — runtime tests of the REAL dashboard
// gameplay handlers (services/gameplay.js, called by bot_final.js routes):
// capture, evolve, shiny conversion, weekly pack; plus replay
// acknowledgment semantics. Real catalog data, real locks, real
// saveAndAck (with an injected writer), synthetic players, temp storage.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
// A copy of species `id` (and shiny 0/1 when given) in the player's box (services/box.js).
const uidOf = (u, id, shiny = null) => Object.keys(u.box ?? {}).find((k) => u.box[k].id === id && (shiny == null || (u.box[k].shiny ? 1 : 0) === shiny));

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gameplay-"));
process.env.TRAINERDATA_DIR = dir;

const { createGameplayHandlers, BALL_COST, EVOLVE_STONE_COST, WEEKLY_PACK_TIERS } = await import("../services/gameplay.js");
const { lockUser } = await import("../utils/userLocks.js");
const { saveAndAck, SAVE_DELAYED_NOTE } = await import("../utils/saveManager.js");
const { SHINY_CRAFT_COST_BY_TIER, shinyEvolveDustCost } = await import("../utils/economyRules.js");
const { getTraining } = await import("../utils/training.js");

const clone = (o) => JSON.parse(JSON.stringify(o));
const copies = (u) => Object.values(u.pokemon || {}).reduce((n, e) => n + (e.normal || 0) + (e.shiny || 0), 0);
const quiet = console.error;

// ---- harness: real handlers, injectable save outcome ----
function setup(players, { saveOk = true } = {}) {
  const state = { td: players, saveOk, saves: 0, events: [], rare: [] };
  const save = (data) => {
    state.saves++;
    return saveAndAck(data, { save: async () => state.saveOk });
  };
  const handlers = createGameplayHandlers({
    getTrainerData: () => state.td,
    lockUser,
    save,
    normalizeUserSchema: (_id, u) => u, // records here are already canonical
    logEvent: (type, id, data) => state.events.push({ type, id, data }),
    onRareCatch: (info) => state.rare.push(info),
  });
  return { state, h: handlers };
}
const auth = (who) => (id) => id === who;
const player = (o = {}) => ({ cc: 0, tp: 0, pokemon: {}, items: { evolution_stone: 0 }, displayedPokemon: [], training: {}, ...o });
const realRandom = Math.random;
const withRandom = async (r, fn) => { Math.random = typeof r === "function" ? r : () => r; try { return await fn(); } finally { Math.random = realRandom; } };

// ======================= Capture =======================
section("Capture: Poké Balls (instant use)");
{
  assertEqual(BALL_COST, { pokeball: 1000, greatball: 2000, ultraball: 4000 }, "ball prices unchanged");
  const U = "100000000000000001";
  const { state, h } = setup({ [U]: player({ cc: 10000 }) });
  for (const [ball, cost] of Object.entries(BALL_COST)) {
    const before = clone(state.td[U]);
    const r = await h.rewardPokemon({ body: { id: U, source: ball }, isAuthorized: auth(U) });
    const u = state.td[U];
    assertTrue(r.status === 200 && r.body.success && r.body.saved === true, `${ball}: success and saved`);
    assertEqual([before.cc - u.cc, copies(u) - copies(before)], [cost, 1], `${ball}: charges exactly ${cost} CC and grants exactly 1 Pokémon`);
    assertEqual(u.items, before.items, `${ball}: nothing is stored in the bag`);
    assertTrue(r.body.pokemon && r.body.pokemon.sprite && r.body.cc === u.cc, `${ball}: response has the Pokémon, sprite and new balance`);
  }
  assertEqual(state.events.filter((e) => e.type === "roll").length, 3, "one roll event per throw");

  const snap = clone(state.td);
  const bad = await h.rewardPokemon({ body: { id: U, source: "masterball" }, isAuthorized: auth(U) });
  const proto = await h.rewardPokemon({ body: { id: U, source: "__proto__" }, isAuthorized: auth(U) });
  assertTrue(bad.body.success === false && proto.body.success === false && JSON.stringify(state.td) === JSON.stringify(snap), "invalid ball types change nothing");
  state.td[U].cc = 999;
  const poor = await h.rewardPokemon({ body: { id: U, source: "pokeball" }, isAuthorized: auth(U) });
  assertTrue(poor.body.success === false && /Not enough CC/.test(poor.body.error) && state.td[U].cc === 999, "not enough CC: refused, nothing charged");

  assertEqual((await h.rewardPokemon({ body: { id: U, source: "pokeball" }, isAuthorized: auth("someone-else") })).status, 403, "another player's session: 403");
  assertEqual((await h.rewardPokemon({ body: { source: "pokeball" }, isAuthorized: () => true })).status, 400, "missing id: 400");
  assertEqual((await h.rewardPokemon({ body: { id: "999", source: "pokeball" }, isAuthorized: () => true })).status, 404, "unknown player: 404");
  assertEqual((await h.rewardPokemon({ body: { id: U, source: "pokeball", requestId: "bad id" }, isAuthorized: auth(U) })).status, 400, "malformed request id: 400");

  // Repeated request (same requestId) → one charge, one Pokémon.
  state.td[U].cc = 5000;
  const n0 = copies(state.td[U]);
  const a = await h.rewardPokemon({ body: { id: U, source: "pokeball", requestId: "cap-req-0001" }, isAuthorized: auth(U) });
  const b = await h.rewardPokemon({ body: { id: U, source: "pokeball", requestId: "cap-req-0001" }, isAuthorized: auth(U) });
  assertTrue(a.body.success && b.body.success && b.body.replayed === true && !a.body.replayed, "a retried request is a replay");
  assertEqual([state.td[U].cc, copies(state.td[U]) - n0], [4000, 1], "…charged once, one Pokémon");
  assertEqual(b.body.pokemon.id, a.body.pokemon.id, "…and the replay returns the same Pokémon");

  // Concurrency: 6 parallel throws, CC for 2.
  state.td[U].cc = 2500;
  const n1 = copies(state.td[U]);
  const par = await Promise.all(Array.from({ length: 6 }, () => h.rewardPokemon({ body: { id: U, source: "pokeball" }, isAuthorized: auth(U) })));
  assertEqual([par.filter((r) => r.body.success).length, state.td[U].cc, copies(state.td[U]) - n1], [2, 500, 2], "parallel throws never overspend");

  // Failed save → acknowledged as delayed, change kept for the retrying queue.
  state.saveOk = false;
  state.td[U].cc = 1000;
  console.error = () => {};
  const d = await h.rewardPokemon({ body: { id: U, source: "pokeball" }, isAuthorized: auth(U) });
  console.error = quiet;
  assertTrue(d.body.success && d.body.saved === false && d.body.saveNotice === SAVE_DELAYED_NOTE, "failed save: success with the delay notice, never saved:true");
  assertEqual(state.td[U].cc, 0, "…and the change is kept (not rolled back)");
  state.saveOk = true;

  // Rare/shiny broadcast only once, never on replay.
  state.td[U].cc = 3000;
  state.rare.length = 0;
  await withRandom(0, () => h.rewardPokemon({ body: { id: U, source: "pokeball", requestId: "cap-shiny-01" }, isAuthorized: auth(U) }));
  await withRandom(0, () => h.rewardPokemon({ body: { id: U, source: "pokeball", requestId: "cap-shiny-01" }, isAuthorized: auth(U) }));
  assertEqual(state.rare.length, 1, "a shiny catch is broadcast once (not again on replay)");
}

// ======================= Evolve =======================
section("Evolve: stones and shiny dust");
{
  assertEqual([EVOLVE_STONE_COST["common-common"], EVOLVE_STONE_COST["uncommon-rare"], EVOLVE_STONE_COST["rare-epic"], EVOLVE_STONE_COST["legendary-mythic"]], [1, 2, 5, 12], "stone costs unchanged");
  const U = "100000000000000002";
  const mk = () => player({ pokemon: { 10: { normal: 1, shiny: 0 }, 17: { normal: 1, shiny: 0 }, 1: { normal: 1, shiny: 1 } }, items: { evolution_stone: 0, shiny_dust: 0 } });
  const { state, h } = setup({ [U]: mk() });
  const ev = (o) => h.evolve({ body: { id: U, ...o }, isAuthorized: auth(U) });

  let snap = clone(state.td);
  const none = await ev({ baseId: 17, targetId: 18 });
  assertTrue(none.status === 400 && /Not enough Evolution Stones/.test(none.body.error) && JSON.stringify(state.td) === JSON.stringify(snap), "no stones: refused, nothing changed");

  state.td[U].items.evolution_stone = 2;
  const ok = await ev({ baseId: 17, targetId: 18 });
  const u = state.td[U];
  assertTrue(ok.status === 200 && ok.body.success && ok.body.saved === true, "uncommon→rare succeeds");
  assertEqual([u.items.evolution_stone, u.pokemon[17], u.pokemon[18]?.normal, ok.body.evolved.cost, ok.body.stonesRemaining], [0, undefined, 1, 2, 0], "spends exactly 2 stones, base → target");

  // Shiny evolve 1→2 (rare→epic): 5 stones + dust difference.
  const dust = shinyEvolveDustCost("rare", "epic");
  assertEqual(dust, SHINY_CRAFT_COST_BY_TIER.epic - SHINY_CRAFT_COST_BY_TIER.rare, "shiny dust rule unchanged (target craft cost − base craft cost)");
  u.items.evolution_stone = 5;
  u.items.shiny_dust = dust - 1;
  snap = clone(state.td);
  const shortDust = await ev({ baseId: 1, targetId: 2, variant: "shiny" });
  assertTrue(shortDust.status === 400 && shortDust.body.dustRequired === dust && JSON.stringify(state.td) === JSON.stringify(snap), "not enough dust: refused, stones NOT spent");
  u.items.shiny_dust = dust;
  const shinyOk = await ev({ baseId: 1, targetId: 2, variant: "shiny" });
  assertTrue(shinyOk.body.success && shinyOk.body.evolved.dustCost === dust, "shiny evolve succeeds with the exact dust");
  assertEqual([u.items.evolution_stone, u.items.shiny_dust, u.pokemon[1].shiny, u.pokemon[1].normal, u.pokemon[2].shiny], [0, 0, 0, 1, 1], "exact stones and dust spent; only the shiny copy evolved");

  snap = clone(state.td);
  assertEqual((await ev({ baseId: 2, targetId: 1 })).status, 400, "unsupported tier path (epic→rare): 400");
  assertEqual((await ev({ baseId: 99999, targetId: 1 })).status, 400, "unknown species: 400");
  assertEqual((await ev({ baseId: 10 })).status, 400, "missing target: 400");
  u.items.evolution_stone = 1;
  // Individual copies (docs/adr/0001): a Team copy is never picked
  // automatically; named, it may evolve and its slot follows (below).
  u.displayedPokemon = [{ id: 10, variant: "normal", uid: uidOf(u, 10) }];
  snap = clone(state.td);
  const shown = await ev({ baseId: 10, targetId: 11 });
  assertTrue(shown.status === 400 && /Choose which/.test(shown.body.error) && JSON.stringify(state.td) === JSON.stringify(snap), "a Pokémon on the Team is never evolved unless named; nothing changed");
  u.displayedPokemon = [];
  const notOwned = await ev({ baseId: 11, targetId: 12 });
  assertTrue(notOwned.status === 400 && /do not own/.test(notOwned.body.error) && u.items.evolution_stone === 1, "not owned: refused, stone kept");

  // Level carries over (existing behavior).
  // carryLevel: the target keeps the higher of its own floor and the source's EXP.
  u.box[uidOf(u, 10)].exp = 50000; // the copy's own EXP (user.training is derived)
  await ev({ baseId: 10, targetId: 11 });
  assertEqual(getTraining(u, 11, "normal").exp, 50000, "EXP above the target's floor carries to the evolved form");
  assertTrue(!u.training["10:normal"], "the base's level entry is removed when its last copy evolves");

  // Concurrency: 2 copies, stones for only 1 evolution, 4 parallel requests.
  state.td[U] = player({ pokemon: { 10: { normal: 2, shiny: 0 } }, items: { evolution_stone: 1 } });
  const par = await Promise.all(Array.from({ length: 4 }, () => h.evolve({ body: { id: U, baseId: 10, targetId: 11 }, isAuthorized: auth(U) })));
  const v = state.td[U];
  assertEqual([par.filter((r) => r.body.success).length, v.items.evolution_stone, v.pokemon[10].normal, v.pokemon[11].normal], [1, 0, 1, 1], "parallel evolves can't spend the same stone twice");

  // Replay + failed save.
  v.items.evolution_stone = 1;
  state.saveOk = false;
  console.error = () => {};
  const r1 = await h.evolve({ body: { id: U, baseId: 10, targetId: 11, requestId: "evo-req-0001" }, isAuthorized: auth(U) });
  const r2 = await h.evolve({ body: { id: U, baseId: 10, targetId: 11, requestId: "evo-req-0001" }, isAuthorized: auth(U) });
  console.error = quiet;
  assertTrue(r1.body.saved === false && r2.body.replayed && r2.body.saved === false, "delayed save: the original and its replay both say not yet saved");
  assertEqual([v.items.evolution_stone, v.pokemon[10]], [0, undefined], "…and the evolution happened once");
  state.saveOk = true;
  const r3 = await h.evolve({ body: { id: U, baseId: 10, targetId: 11, requestId: "evo-req-0001" }, isAuthorized: auth(U) });
  assertTrue(r3.body.replayed && r3.body.saved === true, "once a save succeeds, the replay reports saved");
}

// ======================= Evolve: only real evolutions =======================
section("Evolve: the target must be a real evolution of the base");
{
  const data = JSON.parse(await fs.readFile(new URL("../public/pokemonData.json", import.meta.url), "utf8"));
  const U = "100000000000000009";
  const { state, h } = setup({});
  const fresh = (pokemon) => { state.td[U] = player({ pokemon, items: { evolution_stone: 50, shiny_dust: 500 } }); return state.td[U]; };
  const ev = (o) => h.evolve({ body: { id: U, ...o }, isAuthorized: auth(U) });

  // The exploit: Caterpie (common) → Venusaur (legendary) is a supported
  // rarity step (12 stones) but not an evolution of Caterpie.
  fresh({ 10: { normal: 1, shiny: 1 } });
  let snap = clone(state.td);
  const exploit = await ev({ baseId: 10, targetId: 3 });
  assertTrue(exploit.status === 400 && /isn't an evolution of/.test(exploit.body.error), "common → unrelated legendary is refused");
  assertEqual(state.td, snap, "…and nothing changed (no stones spent, no Pokémon moved)");
  const shinyExploit = await ev({ baseId: 10, targetId: 3, variant: "shiny" });
  assertTrue(shinyExploit.status === 400 && JSON.stringify(state.td) === JSON.stringify(snap), "same for a shiny attempt (no dust spent)");
  assertEqual((await ev({ baseId: 10, targetId: 10 })).status, 400, "a species can't 'evolve' into itself");
  assertEqual((await ev({ baseId: 11, targetId: 10 })).status, 400, "no reverse evolution (Metapod → Caterpie)");

  // Branching evolutions still work (Eevee → any of its listed forms).
  for (const t of [134, 196]) {
    fresh({ 133: { normal: 1, shiny: 0 } });
    const r = await ev({ baseId: 133, targetId: t });
    assertTrue(r.status === 200 && r.body.success && state.td[U].pokemon[t]?.normal === 1, `Eevee → ${data[t].name} still works`);
  }
  fresh({ 133: { normal: 1, shiny: 0 } });
  assertEqual((await ev({ baseId: 133, targetId: 150 })).status, 400, "Eevee → an unlisted species is refused");

  // Every real evolution in the data passes the target check (sampled across the dex).
  // Released generations only (Gen 6+ targets such as Eevee → Sylveon are gated; covered in gen69Evolution.test.js).
  const real = Object.values(data).flatMap((p) => (p.evolvesTo || []).map((t) => [Number(p.id), Number(t)])).filter(([, t]) => t <= 649);
  const sample = real.filter((_, i) => i % 16 === 0);
  let passed = 0;
  for (const [b, t] of sample) {
    fresh({ [b]: { normal: 1, shiny: 0 } });
    const r = await ev({ baseId: b, targetId: t });
    if (r.status === 200 && r.body.success) passed++;
  }
  assertEqual(passed, sample.length, `${sample.length} sampled real evolutions all succeed`);
}

// ======================= Shiny conversion =======================
section("Shiny conversion");
{
  assertEqual(SHINY_CRAFT_COST_BY_TIER, { common: 15, uncommon: 25, rare: 40, epic: 60, legendary: 80, mythic: 120 }, "dust costs unchanged");
  const U = "100000000000000003";
  const { state, h } = setup({ [U]: player({ pokemon: { 10: { normal: 2, shiny: 0 } }, items: { evolution_stone: 0, shiny_dust: 14 } }) });
  const cv = (o) => h.convertToShiny({ body: { id: U, ...o }, isAuthorized: auth(U) });

  let snap = clone(state.td);
  const poor = await cv({ pokeId: 10 });
  assertTrue(poor.status === 400 && poor.body.dustRequired === 15 && JSON.stringify(state.td) === JSON.stringify(snap), "not enough dust: refused, nothing changed");
  const notOwned = await cv({ pokeId: 25 });
  assertTrue(notOwned.status === 400 && JSON.stringify(state.td) === JSON.stringify(snap), "not owned: refused and NO empty entry created (bug fixed)");
  assertEqual((await cv({ pokeId: 999999 })).status, 400, "unknown species: 400");
  assertEqual((await cv({})).status, 400, "missing pokeId: 400");

  const u = state.td[U];
  u.items.shiny_dust = 15;
  const ok = await cv({ pokeId: 10 });
  assertTrue(ok.body.success && ok.body.dustCost === 15 && ok.body.saved === true, "common conversion costs exactly 15 dust");
  assertEqual([u.items.shiny_dust, u.pokemon[10].normal, u.pokemon[10].shiny, ok.body.counts.shiny], [0, 1, 1, 1], "one normal became shiny");

  const teamUid = uidOf(u, 10, 0);
  u.displayedPokemon = [{ id: 10, variant: "normal", uid: teamUid }];
  u.items.shiny_dust = 15;
  snap = clone(state.td);
  assertTrue((await cv({ pokeId: 10 })).status === 400 && JSON.stringify(state.td) === JSON.stringify(snap), "normal copy on the Team: never converted unless named");
  const named = await cv({ pokeId: 10, uid: teamUid });
  assertTrue(named.body.success && u.displayedPokemon[0].variant === "shiny" && u.displayedPokemon[0].uid === teamUid, "named, the Team copy converts and its slot follows");
  u.displayedPokemon = [];
  u.items.shiny_dust = 15; // the named conversion spent it; the concurrency check below needs one conversion's worth

  // Concurrency: dust for one conversion, 3 parallel requests.
  u.pokemon[10].normal = 3;
  const par = await Promise.all(Array.from({ length: 3 }, () => cv({ pokeId: 10 })));
  assertEqual([par.filter((r) => r.body.success).length, u.items.shiny_dust, u.pokemon[10].normal, u.pokemon[10].shiny], [1, 0, 2, 3], "parallel conversions can't double-spend dust");

  state.saveOk = false;
  u.items.shiny_dust = 15;
  console.error = () => {};
  const d = await cv({ pokeId: 10 });
  console.error = quiet;
  assertTrue(d.body.success && d.body.saved === false && d.body.saveNotice, "failed save: delay notice, not saved:true");
  state.saveOk = true;
}

// ======================= Weekly pack =======================
section("Weekly pack");
{
  assertEqual(WEEKLY_PACK_TIERS, ["common", "common", "common", "uncommon", "uncommon", "rare"], "pack contents unchanged");
  const U = "100000000000000004";
  const { state, h } = setup({ [U]: player() });
  const wk = () => h.weeklyPack({ body: { id: U }, isAuthorized: auth(U) });

  const r = await wk();
  const u = state.td[U];
  assertTrue(r.status === 200 && r.body.success && r.body.saved === true && u.weeklyPackClaimed === true, "claim succeeds and is saved");
  assertEqual(r.body.rewards.map((x) => x.rarity), ["common", "common", "common", "uncommon", "uncommon", "rare"], "3 common, 2 uncommon, 1 rare");
  assertEqual(copies(u), 6, "six Pokémon granted");
  const again = await wk();
  assertTrue(again.status === 400 && /already claimed/.test(again.body.error) && copies(u) === 6, "a second claim is refused");

  // Concurrent claims from a fresh player.
  const V = "100000000000000005";
  state.td[V] = player();
  const par = await Promise.all(Array.from({ length: 4 }, () => h.weeklyPack({ body: { id: V }, isAuthorized: auth(V) })));
  assertEqual([par.filter((x) => x.body.success).length, copies(state.td[V])], [1, 6], "parallel claims: exactly one pack");

  // New ISO week → claimable again (existing rule).
  u.nonShinyDustWeekKey = "2000-W01";
  assertTrue((await wk()).body.success && copies(u) === 12, "a new week resets the claim");

  // Never an empty "claimed" pack.
  const W = "100000000000000006";
  const empty = createGameplayHandlers({
    getTrainerData: () => ({ [W]: player() }),
    lockUser,
    save: (d) => saveAndAck(d, { save: async () => true }),
    normalizeUserSchema: (_i, x) => x,
    loaders: { getPokemonCached: async () => [] },
  });
  const e = await empty.weeklyPack({ body: { id: W }, isAuthorized: auth(W) });
  assertEqual(e.status, 503, "no reward data: 503, nothing claimed");
  const thrower = createGameplayHandlers({
    getTrainerData: () => ({ [W]: player() }),
    lockUser,
    save: (d) => saveAndAck(d, { save: async () => true }),
    normalizeUserSchema: (_i, x) => x,
    loaders: { getPokemonCached: async () => { throw new Error("disk"); } },
  });
  assertEqual((await thrower.weeklyPack({ body: { id: W }, isAuthorized: auth(W) })).status, 503, "data load error: 503, nothing claimed");

  const X = "100000000000000007";
  state.td[X] = player();
  state.saveOk = false;
  console.error = () => {};
  const d = await h.weeklyPack({ body: { id: X }, isAuthorized: auth(X) });
  console.error = quiet;
  assertTrue(d.body.success && d.body.saved === false && d.body.saveNotice && state.td[X].weeklyPackClaimed, "failed save: delay notice; the claim stays (queue retries) so it can't be claimed twice");
  state.saveOk = true;
  assertEqual((await h.weeklyPack({ body: { id: X }, isAuthorized: auth("other") })).status, 403, "another player's session: 403");
}

// ======================= Replay acknowledgment semantics =======================
section("Replay acknowledgment");
{
  const U = "100000000000000008";
  const { state, h } = setup({ [U]: player({ cc: 10000 }) });
  const buy = (rid) => h.rewardPokemon({ body: { id: U, source: "pokeball", requestId: rid }, isAuthorized: auth(U) });

  // 1. success → replay: durable, no extra save needed.
  await buy("rep-ok-0001");
  const savesBefore = state.saves;
  const rp = await buy("rep-ok-0001");
  assertTrue(rp.body.replayed && rp.body.saved === true && state.saves === savesBefore, "replay after a confirmed save: saved, without another write");

  // 2. delayed original → replay before confirmation → replay after.
  state.saveOk = false;
  console.error = () => {};
  const d1 = await buy("rep-delay-01");
  const d2 = await buy("rep-delay-01");
  console.error = quiet;
  assertTrue(d1.body.saved === false && d2.body.replayed && d2.body.saved === false && d2.body.saveNotice, "delayed original + early replay: both report NOT saved");
  state.saveOk = true;
  const d3 = await buy("rep-delay-01");
  assertTrue(d3.body.replayed && d3.body.saved === true, "replay after the save succeeds: saved");
  assertEqual(state.td[U].cc, 10000 - 2000, "two distinct purchases charged, replays never charged");

  // 3. process restart: reload the saved map (JSON round trip) into fresh handlers.
  const reloaded = JSON.parse(JSON.stringify(state.td));
  const fresh = setup(reloaded);
  const cc0 = reloaded[U].cc;
  const n0 = copies(reloaded[U]);
  const rr = await fresh.h.rewardPokemon({ body: { id: U, source: "pokeball", requestId: "rep-delay-01" }, isAuthorized: auth(U) });
  assertTrue(rr.body.replayed && rr.body.saved === true && reloaded[U].cc === cc0 && copies(reloaded[U]) === n0, "after a restart the request is still recognised: no second charge or Pokémon");

  // 4. concurrent duplicates.
  const cc1 = state.td[U].cc;
  const dup = await Promise.all(Array.from({ length: 5 }, () => buy("rep-dup-0001")));
  assertEqual([dup.filter((r) => r.body.replayed).length, cc1 - state.td[U].cc], [4, 1000], "5 concurrent duplicates: one purchase, four replays");

  // 5. conflicting payload with the same id.
  const conflict = await h.rewardPokemon({ body: { id: U, source: "greatball", requestId: "rep-dup-0001" }, isAuthorized: auth(U) });
  assertTrue(conflict.status === 400 && /different action/.test(conflict.body.error), "same id, different action: refused");

  // 6. failed save then client retry with the SAME id while the disk is still failing.
  state.saveOk = false;
  console.error = () => {};
  const f1 = await buy("rep-fail-001");
  const f2 = await buy("rep-fail-001");
  console.error = quiet;
  state.saveOk = true;
  assertTrue(f1.body.saved === false && f2.body.replayed && f2.body.saved === false, "retry during an outage: replayed, still reported as not saved");
}

await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
finish();
process.exit(0);
