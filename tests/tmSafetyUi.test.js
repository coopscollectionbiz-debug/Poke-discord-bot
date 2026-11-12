// ==========================================================
// tests/tmSafetyUi.test.js — TM system phase T5: choosing a specific
// trained copy in donate, evolve and shiny craft (server side), the bulk
// donate rules the dashboard uses, and the trained-copy summary.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tm-t5-"));
process.env.TRAINERDATA_DIR = dir;

const { createGameplayHandlers } = await import("../services/gameplay.js");
const { lockUser } = await import("../utils/userLocks.js");
const { saveAndAck } = await import("../utils/saveManager.js");
const { donateOne } = await import("../utils/bulkDonate.js");
const { canRemoveCopies, trainedSummary, customCopiesOf, plainCount, ownershipProblems } = await import("../services/ownership.js");
const bulkRules = await import("../public/picker-pokemon/bulkRules.js");

const clone = (o) => JSON.parse(JSON.stringify(o));
const B = "c_BBBBBBBBBB", C = "c_CCCCCCCCCC";
const rec = (uid, speciesId, variant, tmMoves, rev = 1) => ({ uid, speciesId, variant, tmMoves, rev, history: [], createdAt: 1 });
const pokemonData = { 4: { name: "Charmander", tier: "common" }, 5: { name: "Charmeleon", tier: "uncommon" }, 6: { name: "Charizard", tier: "rare" } };
const economy = { ccByTier: { common: 250, uncommon: 500, rare: 1000 }, shinyDustByTier: { rare: 12 }, normalDustChanceByTier: {}, normalDustWeeklyCap: 8, rollDust: () => 0 };
const notOnTeam = () => false;

// 3 Charizards: 1 untrained, B (Thunder Punch), C (Dragon Claw).
const player = () => ({
  cc: 0, tp: 0, displayedPokemon: [], training: { "6:normal": { exp: 64000 } },
  pokemon: { 6: { normal: 3, shiny: 0 } },
  customPokemon: { [B]: rec(B, 6, "normal", ["thunderpunch"]), [C]: rec(C, 6, "normal", ["dragonclaw"]) },
  items: { evolution_stone: 20, shiny_dust: 200 },
});

section("exact removal of a named trained copy");
{
  const u = player();
  assertEqual(canRemoveCopies(u, { id: 6, variant: "normal", n: 1, customUids: [B], confirmRevs: { [B]: 1 }, exact: true }).useCustom, [B], "exact: the named copy, even though an untrained one exists");
  assertEqual(canRemoveCopies(u, { id: 6, variant: "normal", n: 1, customUids: [B], confirmRevs: { [B]: 1 } }).useCustom, [], "without exact, an untrained copy is still used first");
  assertEqual(canRemoveCopies(u, { id: 6, variant: "normal", n: 1, customUids: [B, C], confirmRevs: { [B]: 1, [C]: 1 }, exact: true }).code, "bad_request", "can't name more copies than are removed");
}

section("donate: a trained copy only with the TM warning confirmed");
{
  const u = player();
  const base = { user: u, pokeId: 6, variant: "normal", pokemonData, economy, isOnTeam: notOnTeam };
  const before = clone(u);
  assertEqual(donateOne({ ...base, uid: B, rev: 1 }).code, "confirm_required", "no confirmation → refused");
  assertEqual(donateOne({ ...base, uid: B, rev: 0, confirmTrained: true }).code, "stale_confirmation", "old rev → refused");
  assertEqual(donateOne({ ...base, uid: "c_ZZZZZZZZZZ", rev: 1, confirmTrained: true }).code, "unknown_copy", "unknown copy → refused");
  assertEqual(u, before, "refusals change nothing");
  const r = donateOne({ ...base, uid: B, rev: 1, confirmTrained: true });
  assertTrue(!r.error && r.gainedCC === 1000 && r.event.trainedUid === B, "B donated with confirmation (1,000 CC, event names the copy)");
  assertEqual([u.pokemon[6].normal, plainCount(u, 6, "normal"), Object.keys(u.customPokemon)], [2, 1, [C]], "exactly B is gone; the untrained copy and C stay");
  const r2 = donateOne({ ...base });
  assertTrue(!r2.error, "without a uid the untrained copy goes");
  assertEqual([u.pokemon[6].normal, Object.keys(u.customPokemon)], [1, [C]], "C, the last copy, is still protected");
  assertEqual(donateOne({ ...base }).code, "custom_copies_protected", "and can't go without naming it");
  assertEqual(ownershipProblems(u), [], "I-1 holds");
}

// ---- evolve / convert through the real handlers ----
function setup(players) {
  const state = { td: players, events: [] };
  const h = createGameplayHandlers({
    getTrainerData: () => state.td, lockUser,
    save: (data) => saveAndAck(data, { save: async () => true }),
    normalizeUserSchema: (_id, u) => u,
    logEvent: (type, id, data) => state.events.push({ type, id, data }),
  });
  return { state, h };
}
const U = "100000000000000077";
const auth = (id) => id === U;

section("evolve: the chosen trained copy evolves with its moves");
{
  const { state, h } = setup({ [U]: { ...player(), pokemon: { 5: { normal: 2, shiny: 0 } }, training: { "5:normal": { exp: 40 ** 3 } }, customPokemon: { [B]: rec(B, 5, "normal", ["dragonclaw"]) } } });
  const r = await h.evolve({ body: { id: U, baseId: 5, targetId: 6, variant: "normal", uid: B, rev: 1, requestId: "evo1-trained-a" }, isAuthorized: auth });
  const u = state.td[U];
  assertTrue(r.status === 200 && r.body.success, "evolved");
  assertEqual([u.customPokemon[B].speciesId, u.customPokemon[B].tmMoves, u.pokemon[5].normal, u.pokemon[6].normal], [6, ["dragonclaw"], 1, 1], "B is now a Charizard with Dragon Claw; the untrained Charmeleon stays");
  const stale = await h.evolve({ body: { id: U, baseId: 5, targetId: 6, variant: "normal", uid: B, rev: 1 }, isAuthorized: auth });
  assertTrue(stale.status >= 400, "B is no longer a Charmeleon → refused");
  const stones = u.items.evolution_stone;
  const old = await h.evolve({ body: { id: U, baseId: 5, targetId: 6, variant: "normal" }, isAuthorized: auth });
  assertTrue(old.body.success && u.items.evolution_stone < stones, "no uid → the untrained copy evolves (as before)");
}

section("evolve: only trained copies left and no choice → refused before spending");
{
  const { state, h } = setup({ [U]: { ...player(), pokemon: { 5: { normal: 1, shiny: 0 } }, customPokemon: { [B]: rec(B, 5, "normal", ["dragonclaw"]) } } });
  const before = clone(state.td[U]);
  const r = await h.evolve({ body: { id: U, baseId: 5, targetId: 6, variant: "normal" }, isAuthorized: auth });
  assertEqual([r.status, r.body.code], [400, "choose_copy"], "choose_copy");
  assertEqual(state.td[U], before, "no Stones spent, nothing changed");
}

section("shiny craft: the chosen trained copy becomes shiny");
{
  const { state, h } = setup({ [U]: player() });
  const r = await h.convertToShiny({ body: { id: U, pokeId: 6, uid: C, rev: 1, requestId: "conv1-trained-a" }, isAuthorized: auth });
  const u = state.td[U];
  assertTrue(r.status === 200 && r.body.success, "converted");
  assertEqual([u.customPokemon[C].variant, u.customPokemon[C].tmMoves, u.pokemon[6]], ["shiny", ["dragonclaw"], { normal: 2, shiny: 1 }], "C is shiny with Dragon Claw");
  assertEqual([customCopiesOf(u, 6, "normal").map((c) => c.uid), plainCount(u, 6, "normal")], [[B], 1], "B and the untrained copy are untouched");
  const replay = await h.convertToShiny({ body: { id: U, pokeId: 6, uid: C, rev: 1, requestId: "conv1-trained-a" }, isAuthorized: auth });
  assertTrue(replay.body.replayed && u.pokemon[6].shiny === 1, "same request id → applied once");
}

section("bulk rules (dashboard)");
{
  const pokemon = { 6: { normal: 3, shiny: 0 }, 4: { normal: 1, shiny: 0 }, 5: { normal: 4, shiny: 0 } };
  const trained = { "6:normal": [{ uid: B }, { uid: C }], "4:normal": [{ uid: "c_DDDDDDDDDD" }], "5:normal": [{ uid: "c_EEEEEEEEEE" }] };
  const rows = bulkRules.duplicateRows(pokemon, pokemonData, trained);
  assertEqual(rows, [{ pokeId: 5, variant: "normal", count: 2 }], "Charizard (1 untrained) offers none; Charmeleon (3 untrained) offers 2");
  assertEqual(bulkRules.keptTrained(rows, trained), 1, "the summary counts the kept trained Charmeleon");
  assertEqual(bulkRules.duplicateRows(pokemon, pokemonData), [{ pokeId: 5, variant: "normal", count: 3 }, { pokeId: 6, variant: "normal", count: 2 }], "without trained data: unchanged behavior");
  assertEqual(bulkRules.multiSelectBlock(4, { pokemon, pokemonData, savedTeam: [], trained })?.title, "🔒 TM-Trained", "a lone trained copy can't be multi-selected");
  assertEqual(bulkRules.multiSelectBlock(4, { pokemon, pokemonData, savedTeam: [] }), null, "an untrained lone copy still can");
}

section("trained summary for the dashboard");
{
  const u = player();
  u.displayedPokemon = [{ id: 6, variant: "normal", uid: C }];
  const s = trainedSummary(u);
  assertEqual(Object.keys(s), ["6:normal"], "keyed by line");
  const c = s["6:normal"].find((x) => x.uid === C);
  assertEqual([c.rev, c.tmMoves[0].name, c.tmMoves[0].category, c.teams], [1, "Dragon Claw", "Physical", { display: 1, battle: null }], "rev, move info, team slots");
  u.customPokemon[B].suspended = "invariant";
  assertEqual(trainedSummary(u)["6:normal"].map((x) => x.uid), [C], "suspended copies are not offered");
}

finish();
