// ==========================================================
// tests/megaUnlock.test.js — Mega Evolution Phase M1: permanent Mega Stone
// unlocking (services/mega.js useMegaStone + services/megaApi.js), the
// capability gates, inventory integration, duplicate/concurrent requests,
// failed saves and crash recovery through the REAL save queue, local
// snapshot store and loader. Synthetic players only; temp TRAINERDATA_DIR.
// ==========================================================

import fs from "fs/promises";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const F = await import("../config/features.js");
const G = await import("../config/generations.js");
const C = await import("../utils/speciesCatalog.js");
const { useMegaStone } = await import("../services/mega.js");
const { createMegaHandlers } = await import("../services/megaApi.js");
const { readMegaUnlocks, unlockedForms } = await import("../services/megaUnlocks.js");
const { listInventory, getQuantity } = await import("../services/inventory.js");
const { lockUser } = await import("../utils/userLocks.js");
const { saveAndAck } = await import("../utils/saveManager.js");
const q = await import("../utils/saveQueue.js");
const store = await import("../persistence/localStore.js");
const { loadBestSnapshot } = await import("../persistence/loader.js");
const { validateUserSchema } = await import("../utils/userSchema.js");

const quiet = { log: console.log, warn: console.warn, error: console.error };
console.log = (m, ...r) => { if (!/^(💾|⏳)/.test(String(m))) quiet.log(m, ...r); };
console.warn = (m, ...r) => { if (!/^(⚠️|⏳)/.test(String(m))) quiet.warn(m, ...r); };
console.error = (m, ...r) => { if (!/^❌ Save error/.test(String(m))) quiet.error(m, ...r); };

const ON = { env: { MEGA_EVOLUTION_ENABLED: "1" } };
const T0 = Date.UTC(2026, 10, 10, 12);
const UID = "200000000000000001";
const clone = (o) => JSON.parse(JSON.stringify(o));
const player = () => ({
  id: UID, name: "Mega Tester", cc: 500, tp: 1000,
  pokemon: { 6: { normal: 2, shiny: 1 }, 150: { normal: 1, shiny: 0 }, 384: { normal: 1, shiny: 0 }, 678: { normal: 1, shiny: 1 }, 978: { normal: 1, shiny: 0 }, 718: { normal: 1, shiny: 0 }, 670: { normal: 1, shiny: 0 }, 801: { normal: 1, shiny: 0 } },
  training: { "6:normal": { exp: 125000 }, "6:shiny": { exp: 27000 } },
  items: { evolution_stone: 2, shiny_dust: 10, megastone_charizarditex: 2, megastone_charizarditey: 1, megastone_mewtwonitex: 1, megastone_mewtwonitey: 1, megastone_meowsticite: 2, megastone_tatsugirinite: 1, megastone_zygardite: 1, megastone_floettite: 1, megastone_magearnite: 1, mega_shard: 7 },
  displayedPokemon: [{ id: 6, variant: "normal" }],
});
const use = (u, line, stoneId, formId, extra = {}, opts = ON) => useMegaStone(u, { line, stoneId, formId, now: T0, ...extra }, opts);

// ------------------------------------------------------------------
section("Capabilities: one switch per subsystem; battle and rewards can't be switched on");
assertEqual(F.megaCapabilities({}), { dashboard: false, unlock: false, team: false, battle: false, rewards: false }, "everything off by default");
assertEqual(F.megaCapabilities({ MEGA_EVOLUTION_ENABLED: "1" }), { dashboard: true, unlock: true, team: true, battle: false, rewards: false }, "master switch on: dashboard, unlock and team on; battle and rewards stay off");
assertEqual(F.megaCapabilities({ MEGA_EVOLUTION_ENABLED: "1", MEGA_UNLOCKS_ENABLED: "0", MEGA_TEAMS_ENABLED: "off" }), { dashboard: true, unlock: false, team: false, battle: false, rewards: false }, "sub-switches turn single subsystems off");
assertEqual(F.megaCapabilities({ MEGA_UNLOCKS_ENABLED: "1", MEGA_DASHBOARD_ENABLED: "1", MEGA_TEAMS_ENABLED: "1" }), { dashboard: false, unlock: false, team: false, battle: false, rewards: false }, "sub-switches alone can't turn anything on");
const everything = { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1", MEGA_REWARDS_ENABLED: "1", MEGA_BATTLE_ENABLED: "true", MEGA_FORMS: "all" };
assertTrue(!F.isMegaCapabilityEnabled("rewards", everything) && !F.isMegaCapabilityEnabled("__proto__", everything), "no environment can enable Mega rewards (not built)");
assertTrue(F.isMegaCapabilityEnabled("battle", everything) && !F.isMegaCapabilityEnabled("battle", { MEGA_EVOLUTION_ENABLED: "1" }) && !F.isMegaCapabilityEnabled("battle", { MEGA_BATTLES_ENABLED: "1" }) && !F.isMegaCapabilityEnabled("battle", { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "0" }), "M2: Mega battles need BOTH the master switch and an explicit MEGA_BATTLES_ENABLED=1 (opt-in)");

// ------------------------------------------------------------------
section("useMegaStone: success, exactly one stone, permanent record");
let u = player();
const before = clone(u);
let r = use(u, "6:normal", "megastone_charizarditex", "mega-charizard-x", { requestId: "req-0001-aaaa" });
assertEqual([r.ok, r.formId, r.stonesLeft], [true, "mega-charizard-x", 1], "unlock succeeds and reports one stone left");
assertEqual(getQuantity(u, "megastone_charizarditex"), 1, "exactly one Charizardite X consumed");
assertEqual(u.megaUnlocks["6:normal"].forms["mega-charizard-x"], { at: T0, stone: "megastone_charizarditex", req: "req-0001-aaaa" }, "unlock recorded with time, stone and request id");
assertEqual([u.pokemon, u.training, u.displayedPokemon, u.cc], [before.pokemon, before.training, before.displayedPokemon, before.cc], "counts, Levels, team and currency untouched");
assertTrue(Object.keys(u.items).every((k) => k === "megastone_charizarditex" || u.items[k] === before.items[k]), "no other item changed (Mega Shards tracked separately: still 7)");

section("useMegaStone: refusals change nothing");
const refusals = [
  ["disabled", () => use(u, "6:normal", "megastone_charizarditey", "mega-charizard-y", {}, { env: {} })],
  ["unlock switched off", () => use(u, "6:normal", "megastone_charizarditey", "mega-charizard-y", {}, { env: { MEGA_EVOLUTION_ENABLED: "1", MEGA_UNLOCKS_ENABLED: "0" } })],
  ["already unlocked", () => use(u, "6:normal", "megastone_charizarditex", "mega-charizard-x")],
  ["wrong stone", () => use(u, "6:normal", "megastone_charizarditex", "mega-charizard-y")],
  ["wrong species", () => use(u, "6:normal", "megastone_mewtwonitex", "mega-mewtwo-x")],
  ["missing stone", () => use(u, "6:normal", "megastone_venusaurite", "mega-venusaur")],
  ["not owned line", () => use(u, "150:shiny", "megastone_mewtwonitex", "mega-mewtwo-x")],
  ["no stone in bag", () => use({ ...clone(u), items: {} }, "150:normal", "megastone_mewtwonitex", "mega-mewtwo-x")],
  ["bad line (no variant)", () => use(u, "6", "megastone_charizarditey", "mega-charizard-y")],
  ["bad line (garbage)", () => use(u, "6:sparkly", "megastone_charizarditey", "mega-charizard-y")],
  ["unknown form", () => use(u, "6:normal", "megastone_charizarditey", "mega-charizard-z")],
  ["unknown stone", () => use(u, "6:normal", "megastone_nope", "mega-charizard-y")],
  ["non-stone item", () => use(u, "6:normal", "evolution_stone", "mega-charizard-y")],
  ["bad request id", () => use(u, "6:normal", "megastone_charizarditey", "mega-charizard-y", { requestId: "x" })],
  ["Rayquaza (Dragon Ascent, blocked)", () => use(u, "384:normal", "megastone_charizarditey", "mega-rayquaza")],
  ["Zygarde (blocked)", () => use(u, "718:normal", "megastone_zygardite", "mega-zygarde")],
  ["Floette (blocked)", () => use(u, "670:normal", "megastone_floettite", "mega-floette")],
  ["Magearna Original (blocked)", () => use(u, "801:normal", "megastone_magearnite", "mega-magearna-original")],
  ["Meowstic while Gen 6 is unreleased", () => use(u, "678:normal", "megastone_meowsticite", "mega-meowstic-f")],
];
const snap = JSON.stringify(u);
for (const [label, fn] of refusals) {
  const res = fn();
  assertTrue(res.ok === false && typeof res.error === "string" && res.code, `refused: ${label} (${res.code})`);
}
assertEqual(JSON.stringify(u), snap, "after 19 refusals the player record is byte-identical (no stone lost, no unlock written)");
assertTrue(!/prerequisite|D-9|D-16/.test(use(u, "384:normal", "megastone_charizarditey", "mega-rayquaza").error), "players see a short message, not internal design notes");

section("Normal/shiny lines and multiple forms");
assertTrue(use(u, "6:shiny", "megastone_charizarditex", "mega-charizard-x").ok, "the shiny line needs and takes its own stone");
assertTrue(use(u, "6:normal", "megastone_charizarditey", "mega-charizard-y").ok, "Charizard Y on the same normal line");
assertEqual([unlockedForms(u, "6:normal"), unlockedForms(u, "6:shiny")], [["mega-charizard-x", "mega-charizard-y"], ["mega-charizard-x"]], "normal: X and Y; shiny: X only");
assertTrue(use(u, "150:normal", "megastone_mewtwonitex", "mega-mewtwo-x").ok && use(u, "150:normal", "megastone_mewtwonitey", "mega-mewtwo-y").ok, "Mewtwo X and Y");
assertEqual([getQuantity(u, "megastone_charizarditex"), getQuantity(u, "megastone_charizarditey"), getQuantity(u, "megastone_mewtwonitex")], [0, 0, 0], "each unlock spent exactly one stone");

section("Variant choices (Gens 6, 7 and 9 released only inside this test)");
G.setGenerationsForTesting([6, 7, 9]); C.resetCatalogCachesForTesting();
const v = player();
assertEqual(use(v, "678:normal", "megastone_meowsticite", "mega-meowstic-f", { choice: { gender: "m" } }).code, "bad_choice", "a choice that contradicts the chosen form is refused");
assertTrue(use(v, "678:normal", "megastone_meowsticite", "mega-meowstic-f", { choice: { gender: "f" } }).ok, "Meowstic: female chosen at unlock");
assertEqual(v.megaUnlocks["678:normal"].forms["mega-meowstic-f"].choice, { gender: "f" }, "gender stored");
assertEqual(use(v, "678:normal", "megastone_meowsticite", "mega-meowstic-m").code, "variant_locked", "the gender is permanent for that line (no second stone consumed)");
assertEqual(getQuantity(v, "megastone_meowsticite"), 1, "only one Meowsticite spent");
assertTrue(use(v, "678:shiny", "megastone_meowsticite", "mega-meowstic-m").ok, "the shiny Meowstic line chooses its own gender");
assertTrue(use(v, "978:normal", "megastone_tatsugirinite", "mega-tatsugiri-droopy", { choice: { appearance: "droopy" } }).ok && v.megaUnlocks["978:normal"].forms["mega-tatsugiri-droopy"].choice.appearance === "droopy", "Tatsugiri: appearance chosen and stored");
assertTrue(use(v, "801:normal", "megastone_magearnite", "mega-magearna").ok, "standard Mega Magearna can be unlocked");
G.setGenerationsForTesting(null); C.resetCatalogCachesForTesting();

section("MEGA_FORMS allowlist");
const al = player();
assertEqual(use(al, "150:normal", "megastone_mewtwonitex", "mega-mewtwo-x", {}, { env: { MEGA_EVOLUTION_ENABLED: "1", MEGA_FORMS: "mega-charizard-x" } }).code, "blocked", "a form outside MEGA_FORMS can't be unlocked");
assertTrue(use(al, "6:normal", "megastone_charizarditex", "mega-charizard-x", {}, { env: { MEGA_EVOLUTION_ENABLED: "1", MEGA_FORMS: "mega-charizard-x" } }).ok, "an allowlisted form can");

section("Inventory integration");
const bag = player();
const rowsOff = listInventory(bag, { env: {} }).filter((x) => x.id.startsWith("megastone_"));
assertTrue(rowsOff.length === 9 && rowsOff.every((x) => !x.usable && x.usage === "Not usable yet." && x.category === "evolution"), "flag off: stones listed under Evolution, not usable");
const rowsOn = listInventory(bag, { env: ON.env }).filter((x) => x.id.startsWith("megastone_"));
assertTrue(rowsOn.every((x) => x.usable && /dashboard/.test(x.usage) && x.name && x.description.includes("permanently unlock")), "unlock on: stones usable, with accurate name, description and usage");
assertTrue(listInventory(bag, { env: ON.env }).some((x) => x.id === "mega_shard" && x.quantity === 7 && !x.usable), "Mega Shards stay a separate, not-usable stack (no redemption in M1)");
assertEqual(listInventory(bag, { env: ON.env }).filter((x) => !x.id.startsWith("mega")), listInventory(player(), { env: {} }).filter((x) => !x.id.startsWith("mega")), "non-Mega bag rows identical with the flag on or off");
const dup = player();
use(dup, "6:normal", "megastone_charizarditex", "mega-charizard-x");
assertEqual(getQuantity(dup, "megastone_charizarditex"), 1, "a duplicate stone stays a valid inventory item after unlocking (usable on the shiny line)");

// ------------------------------------------------------------------
section("API: gating, input validation, server-side authority");
let td = { [UID]: player() };
let saves = 0;
const okSave = async (d) => { saves++; return saveAndAck(d, { save: async () => true }); };
const H = (env, save = okSave) => createMegaHandlers({ getTrainerData: () => td, lockUser, save, getEnv: () => env });
const auth = (id) => id === UID;
assertEqual(H({}).view({ query: { id: UID }, isAuthorized: auth }), { status: 200, body: { success: true, enabled: false } }, "flag off: the view says only { enabled: false }");
assertEqual((await H({}).unlock({ body: { id: UID, line: "6:normal", stoneId: "megastone_charizarditex", formId: "mega-charizard-x", requestId: "req-off-0001" }, isAuthorized: auth })).status, 403, "flag off: unlock refused (403)");
assertEqual((await H({}).preferred({ body: { id: UID, line: "6:normal", formId: null }, isAuthorized: auth })).status, 403, "flag off: preferred refused (403)");
assertEqual((await H({ MEGA_EVOLUTION_ENABLED: "1", MEGA_UNLOCKS_ENABLED: "0" }).unlock({ body: { id: UID, line: "6:normal", stoneId: "megastone_charizarditex", formId: "mega-charizard-x", requestId: "req-off-0002" }, isAuthorized: auth })).status, 403, "unlock switched off alone: refused even with the dashboard on");
assertEqual(td[UID].items.megastone_charizarditex, 2, "nothing consumed by refused requests");
const on = H(ON.env);
const bad = async (body, want, label) => assertEqual((await on.unlock({ body: { id: UID, requestId: "req-bad-0001", line: "6:normal", stoneId: "megastone_charizarditex", formId: "mega-charizard-x", ...body }, isAuthorized: auth })).status, want, label);
assertEqual((await on.unlock({ body: { id: "999999999999999999", line: "6:normal" }, isAuthorized: auth })).status, 403, "another player's id: 403");
await bad({ id: "abc" }, 400, "malformed player id: 400");
await bad({ requestId: undefined }, 400, "missing request id: 400 (required for idempotency)");
await bad({ line: "6:shinyy" }, 400, "bad line: 400");
await bad({ line: { a: 1 } }, 400, "non-string line: 400");
await bad({ stoneId: "evolution_stone" }, 400, "non-Mega item id: 400");
await bad({ formId: "../../etc" }, 400, "malformed form id: 400");
await bad({ choice: ["f"] }, 400, "malformed choice: 400");
await bad({ choice: { gender: "f", hp: 999 } }, 400, "choice with extra keys: 400");
await bad({ formId: "mega-charizard-y" }, 400, "wrong stone for the form: 400 from the server rules");
assertEqual(td[UID].items.megastone_charizarditex, 2, "nothing consumed by any invalid request");
const view = on.view({ query: { id: UID }, isAuthorized: auth });
assertTrue(view.body.enabled && view.body.capabilities.battle === false && view.body.capabilities.rewards === false, "flag on: the view reports battle and rewards off");

section("Duplicate requests, double clicks, retries");
saves = 0;
const body = { id: UID, line: "6:normal", stoneId: "megastone_charizarditex", formId: "mega-charizard-x", requestId: "req-dbl-0001" };
const r1 = await on.unlock({ body, isAuthorized: auth });
const r2 = await on.unlock({ body, isAuthorized: auth });
assertEqual([r1.status, r1.body.success, r2.status, r2.body.replayed], [200, true, 200, true], "the same request twice: one unlock, the retry is a replay");
assertEqual(td[UID].items.megastone_charizarditex, 1, "…and exactly one stone consumed");
const r3 = await on.unlock({ body: { ...body, formId: "mega-charizard-y", stoneId: "megastone_charizarditey" }, isAuthorized: auth });
assertEqual(r3.status, 400, "reusing a request id for a different unlock is refused");

section("Concurrent unlock attempts");
td = { [UID]: player() };
const many = await Promise.all(Array.from({ length: 8 }, (_, i) => on.unlock({ body: { ...body, requestId: `req-par-${String(i).padStart(4, "0")}` }, isAuthorized: auth })));
assertEqual([many.filter((x) => x.status === 200).length, many.filter((x) => x.body.code === "already_unlocked").length], [1, 7], "8 parallel requests (different ids): exactly one unlock, 7 refused");
assertEqual(td[UID].items.megastone_charizarditex, 1, "…and exactly one stone consumed");
td = { [UID]: player() };
const same = await Promise.all(Array.from({ length: 5 }, () => on.unlock({ body: { ...body, requestId: "req-same-0001" }, isAuthorized: auth })));
assertEqual([same.filter((x) => x.status === 200 && !x.body.replayed).length, same.filter((x) => x.body.replayed).length, td[UID].items.megastone_charizarditex], [1, 4, 1], "5 parallel double-clicks (same id): one unlock, 4 replays, one stone");

section("Interrupted save: memory and disk never diverge, nothing half-applied");
td = { [UID]: player() };
let fail = true;
const flaky = createMegaHandlers({ getTrainerData: () => td, lockUser, getEnv: () => ON.env, save: (d) => saveAndAck(d, { save: async () => !fail }) });
const f1 = await flaky.unlock({ body: { ...body, requestId: "req-flk-0001" }, isAuthorized: auth });
assertEqual([f1.status, f1.body.saved, f1.body.persisted], [200, false, "pending"], "a failed write is reported honestly (saved: false, pending)");
assertTrue(td[UID].items.megastone_charizarditex === 1 && unlockedForms(td[UID], "6:normal").includes("mega-charizard-x"), "in memory both changes exist together (the queue keeps retrying)");
fail = false;
const f2 = await flaky.unlock({ body: { ...body, requestId: "req-flk-0001" }, isAuthorized: auth });
assertEqual([f2.body.replayed, f2.body.saved, td[UID].items.megastone_charizarditex], [true, true, 1], "the retry replays (no second stone) and confirms the save");

// ------------------------------------------------------------------
section("Crash recovery through the real save queue, snapshot store and loader");
const dir = process.env.TRAINERDATA_DIR;
async function boot() {
  q.__resetSaveQueueForTests();
  store.__resetLocalStoreForTests();
  q.__setSaveQueueTestHooks({ timing: { debounceMs: 5, minIntervalMs: 0, maxWaitMs: 50, retryBaseMs: 20, retryMaxMs: 40 } });
  q.requireLoadBeforeWrite();
  const res = await loadBestSnapshot({ readLocalCandidates: store.readLocalCandidates, fetchDiscordCandidates: async () => [], readFileCandidate: async () => ({ ok: false }), fetchDiscordMessageCandidate: async () => ({ ok: false }), env: {} });
  if (!res.ok) return null;
  store.setSeqAtLeast(res.maxSeq);
  q.markLoaded();
  for (const [id, user] of Object.entries(res.chosen.data)) validateUserSchema(user, id, user.name); // the live load path
  return res.chosen.data;
}
const realSave = (d) => saveAndAck(d, { save: (x) => q.enqueueSave(x, { force: true }) });
// Boot 1: seed the disk.
q.__resetSaveQueueForTests(); store.__resetLocalStoreForTests();
await store.writeSnapshot({ [UID]: player() }, { now: T0 });
let data = await boot();
assertTrue(!!data && !("megaUnlocks" in data[UID]), "boot 1: the player loads with no Mega fields (none created)");
const real = () => createMegaHandlers({ getTrainerData: () => data, lockUser, getEnv: () => ON.env, save: realSave });
const c1 = await real().unlock({ body: { ...body, requestId: "req-crash-001" }, isAuthorized: auth });
assertEqual([c1.status, c1.body.saved], [200, true], "unlock saved through the real queue (durable)");

// Crash A: a change made after the last durable write is lost — completely.
assertTrue(real().unlock && use(data[UID], "6:normal", "megastone_charizarditey", "mega-charizard-y").ok, "a second unlock happens in memory only…");
q.__resetSaveQueueForTests(); // …then the process dies before any save
data = await boot();
assertEqual([unlockedForms(data[UID], "6:normal"), getQuantity(data[UID], "megastone_charizarditey")], [["mega-charizard-x"], 1], "crash before saving: the unsaved unlock AND its stone are both absent — never one without the other");
assertEqual([getQuantity(data[UID], "megastone_charizarditex"), data[UID].megaUnlocks["6:normal"].forms["mega-charizard-x"].stone], [1, "megastone_charizarditex"], "the durable unlock and its consumed stone survived the restart together");

// Crash B: a write interrupted half-way (truncated temp file) is ignored.
await fs.writeFile(path.join(dir, "trainerData.json.tmp"), '{"200000000000000001": {"items": {"megastone_charizard');
data = await boot();
assertTrue(!!data && unlockedForms(data[UID], "6:normal").length === 1 && getQuantity(data[UID], "megastone_charizarditex") === 1, "a torn temp file is ignored: the last complete snapshot loads");

// Crash C: corrupt current file → previous complete snapshot.
const c2 = await real().unlock({ body: { id: UID, line: "6:shiny", stoneId: "megastone_charizarditex", formId: "mega-charizard-x", requestId: "req-crash-002" }, isAuthorized: auth });
assertTrue(c2.body.saved === true, "a third unlock is saved");
await fs.writeFile(path.join(dir, "trainerData.json"), '{"200000000000000001": {"items": {');
data = await boot();
const s6 = unlockedForms(data[UID], "6:shiny"), stones = getQuantity(data[UID], "megastone_charizarditex");
assertTrue((s6.length === 1 && stones === 0) || (s6.length === 0 && stones === 1), `corrupt current file: the fallback snapshot is internally consistent (shiny unlock ${s6.length}, Charizardite X ${stones})`);

// Replay after restart: the durable request is recognised, nothing re-applied.
data = await boot();
const before2 = getQuantity(data[UID], "megastone_charizarditex");
const replay = await real().unlock({ body: { ...body, requestId: "req-crash-001" }, isAuthorized: auth });
assertEqual([replay.body.replayed, getQuantity(data[UID], "megastone_charizarditex")], [true, before2], "a retried request after a restart replays instead of consuming another stone");

section("Save → reload → normalize: unlocks, choices and preferences persist");
const p = player();
G.setGenerationsForTesting([6, 9]); C.resetCatalogCachesForTesting();
use(p, "6:normal", "megastone_charizarditex", "mega-charizard-x");
use(p, "6:normal", "megastone_charizarditey", "mega-charizard-y");
use(p, "978:normal", "megastone_tatsugirinite", "mega-tatsugiri-curly");
G.setGenerationsForTesting(null); C.resetCatalogCachesForTesting();
p.megaUnlocks["6:normal"].preferred = "mega-charizard-y";
p.pokemon[978] = { normal: 0, shiny: 0 }; // the line reaches zero copies
store.__resetLocalStoreForTests();
await store.writeSnapshot({ [UID]: p }, { now: T0 });
const back = (await store.readFileCandidate(store.paths().current, store.paths().currentMeta, "local")).data[UID];
validateUserSchema(back, UID, back.name);
assertEqual(readMegaUnlocks(back), readMegaUnlocks(p), "unlocks identical after save, reload and the live schema pass");
assertEqual([readMegaUnlocks(back)["6:normal"].preferred, back.megaUnlocks["978:normal"].forms["mega-tatsugiri-curly"].choice], ["mega-charizard-y", { appearance: "curly" }], "preferred form and appearance choice persist");
assertTrue(!!readMegaUnlocks(back)["978:normal"], "an unlock on a line with zero copies survives (dormant)");

q.__resetSaveQueueForTests();
Object.assign(console, quiet);
finish();
