// ==========================================================
// tests/megaPersistence.test.js — Mega Evolution Phase M0: the additive,
// line-bound unlock schema (services/megaUnlocks.js) and its compatibility
// with today's (v21) player-data code paths. Synthetic players only,
// modelled on the production schema; TRAINERDATA_DIR is a temp dir.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";

const U = await import("../services/megaUnlocks.js");
const { validateUserSchema } = await import("../utils/userSchema.js");
const { normalizeInventory, listInventory, getQuantity, auditInventory } = await import("../services/inventory.js");
const { normalizeTeam } = await import("../utils/teamNormalize.js");
const { buildTeam } = await import("../utils/battle/runBattle.js");
const { computeMetrics, normalizeProgression, listAchievements } = await import("../progression/achievements.js").then(async (m) => ({ ...m, listAchievements: (await import("../catalog/achievements.js")).listAchievements }));
const { resetLevelIfGone, getTraining } = await import("../utils/training.js");
const { giftPokemon } = await import("../commands/gift.js");
const store = await import("../persistence/localStore.js");

const ON = { env: { MEGA_EVOLUTION_ENABLED: "1" } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const T0 = Date.UTC(2026, 10, 10, 12);

// A player shaped like production records (Release A–C + Gen 6–9 fields).
const prodLike = () => ({
  id: "100000000000000001", name: "Synthetic", cc: 12345, tp: 67890, rank: "Ace Trainer",
  onboardingComplete: true, onboardingStage: "done", onboardingDate: "2025-01-01T00:00:00.000Z", starterPokemon: 4,
  pokemon: { 4: { normal: 1, shiny: 0 }, 6: { normal: 3, shiny: 1 }, 150: { normal: 1, shiny: 0 }, 678: { normal: 2, shiny: 0 }, 978: { normal: 1, shiny: 0 } },
  trainers: ["lass-gen4.png"],
  displayedPokemon: [{ id: 6, variant: "normal" }, { id: 6, variant: "shiny" }, 150, "678"],
  displayedTrainer: "lass-gen4.png",
  lastDaily: T0 - 1, lastRecruit: 0, lastQuest: 0, lastWeeklyPack: null, weeklyPackClaimed: false,
  items: { evolution_stone: 4, shiny_dust: 120, legacy_thing: 2 },
  itemsLegacy: [{ key: "old", value: "\"x\"", reason: "not a number", at: "2026-11-09T00:00:00.000Z" }],
  purchases: ["starter_pack"], luck: 3, luckTimestamp: T0 - 5,
  training: { "6:normal": { exp: 125000 }, "6:shiny": { exp: 27000 }, "150:normal": { exp: 343000 } },
  battle: { day: 20766, rating: 1100, wins: 4, losses: 2, starts: {} },
  ach: { col_first: 20000 }, achClaimed: {}, stats: { shinyObtained: 1, evolutions: 2, donated: 0, purchases: 1 },
});

section("Old records: safe defaults, nothing created");
const legacy = prodLike();
const before = JSON.stringify(legacy);
assertEqual(U.readMegaUnlocks(legacy), {}, "a record without megaUnlocks reads as nothing unlocked");
assertEqual(U.unlockedForms(legacy, "6:normal"), [], "no forms on any line");
assertEqual(U.activeMegaForms(legacy), [], "no active Megas");
assertEqual(U.normalizeMegaUnlocks(legacy), { changed: false, quarantined: 0 }, "normalize is a no-op without the field");
assertEqual(JSON.stringify(legacy), before, "the record is byte-identical (field never created, nothing else touched)");
const viaSchema = prodLike();
validateUserSchema(viaSchema, viaSchema.id, viaSchema.name);
assertTrue(!("megaUnlocks" in viaSchema) && !("megaLegacy" in viaSchema), "validateUserSchema (live load path) adds no Mega fields");
assertEqual([viaSchema.pokemon, viaSchema.training, viaSchema.displayedPokemon], [legacy.pokemon, legacy.training, legacy.displayedPokemon], "counts, Levels and team untouched by the schema pass");

section("Flag gates every write (default off)");
const p = prodLike();
assertEqual(U.recordMegaUnlock(p, { line: "6:normal", formId: "mega-charizard-x", stone: "megastone_charizarditex" }).code, "disabled", "unlock refused with MEGA_EVOLUTION_ENABLED unset");
assertEqual(U.recordMegaUnlock(p, { line: "6:normal", formId: "mega-charizard-x", stone: "megastone_charizarditex" }, { env: { MEGA_EVOLUTION_ENABLED: "0" } }).code, "disabled", "…and with MEGA_EVOLUTION_ENABLED=0");
assertEqual(U.setPreferredMega(p, "6:normal", null).code, "disabled", "preferred-form change refused while off");
assertTrue(!("megaUnlocks" in p), "a refused write leaves no trace");

section("Line-bound unlocks (D-1), multiple forms, preferred form");
const w = prodLike();
assertTrue(U.recordMegaUnlock(w, { line: "6:normal", formId: "mega-charizard-x", stone: "megastone_charizarditex", requestId: "req-aaaa-0001", at: T0 }, ON).ok, "unlock Mega Charizard X on the normal line");
assertTrue(U.recordMegaUnlock(w, { line: "6:normal", formId: "mega-charizard-y", stone: "megastone_charizarditey", at: T0 + 1 }, ON).ok, "…and Mega Charizard Y on the same line");
assertEqual(U.unlockedForms(w, "6:normal"), ["mega-charizard-x", "mega-charizard-y"], "a line keeps several forms");
assertEqual(U.unlockedForms(w, "6:shiny"), [], "the shiny line is separate: nothing unlocked there");
assertEqual(U.recordMegaUnlock(w, { line: "6:normal", formId: "mega-charizard-x", stone: "megastone_charizarditex" }, ON).code, "already_unlocked", "unlocking the same form twice is refused");
assertEqual(U.recordMegaUnlock(w, { line: "6:shiny", formId: "mega-charizard-x", stone: "megastone_charizarditey" }, ON).code, "wrong_stone", "wrong stone refused");
assertEqual(U.recordMegaUnlock(w, { line: "6:normal", formId: "mega-venusaur", stone: "megastone_venusaurite" }, ON).code, "wrong_species", "a form of another species is refused");
assertEqual(U.recordMegaUnlock(w, { line: "3:normal", formId: "mega-venusaur", stone: "megastone_venusaurite" }, ON).code, "not_owned", "an unowned line is refused");
assertEqual(U.recordMegaUnlock(w, { line: "6:normal", formId: "mega-rayquaza" }, ON).code, "wrong_species", "Mega Rayquaza on a Charizard line is refused");
w.pokemon[384] = { normal: 1, shiny: 0 };
assertEqual(U.recordMegaUnlock(w, { line: "384:normal", formId: "mega-rayquaza" }, ON).code, "blocked", "Mega Rayquaza is blocked");
w.pokemon[718] = { normal: 1, shiny: 0 }; w.pokemon[670] = { normal: 1, shiny: 0 }; w.pokemon[801] = { normal: 1, shiny: 0 };
assertEqual(["718:normal/mega-zygarde", "670:normal/mega-floette", "801:normal/mega-magearna-original"].map((x) => { const [line, formId] = x.split("/"); return U.recordMegaUnlock(w, { line, formId, stone: "x" }, ON).code; }), ["blocked", "blocked", "blocked"], "Mega Zygarde, Floette and Magearna Original are blocked");
assertEqual(U.recordMegaUnlock(w, { line: "6:normal", formId: "mega-charizard-x", requestId: "bad id!" }, ON).code, "already_unlocked", "rule checks run before request-id checks");
assertEqual(U.recordMegaUnlock(w, { line: "6:shiny", formId: "mega-charizard-x", stone: "megastone_charizarditex", requestId: "no" }, ON).code, "bad_request_id", "malformed request id refused");
assertTrue(U.recordMegaUnlock(w, { line: "6:shiny", formId: "mega-charizard-y", stone: "megastone_charizarditey", at: T0 + 2 }, ON).ok, "the shiny line gets its own unlock");
assertEqual(w.megaUnlocks["6:normal"].forms["mega-charizard-x"], { at: T0, stone: "megastone_charizarditex", req: "req-aaaa-0001" }, "the record stores time, stone and request id");
assertTrue(U.setPreferredMega(w, "6:normal", "mega-charizard-y", ON).ok && U.readMegaUnlocks(w)["6:normal"].preferred === "mega-charizard-y", "preferred form selection");
assertEqual(U.setPreferredMega(w, "6:shiny", "mega-charizard-x", ON).code, "not_unlocked", "can't prefer a form the line hasn't unlocked");
assertTrue(U.setPreferredMega(w, "6:normal", null, ON).ok && w.megaUnlocks["6:normal"].preferred === null, "preferred form can be cleared");

section("Variant choices (D-6 Meowstic gender, D-7 Tatsugiri appearance)");
assertTrue(U.recordMegaUnlock(w, { line: "678:normal", formId: "mega-meowstic-f", stone: "megastone_meowsticite", at: T0 }, ON).ok, "Meowstic: female chosen at unlock");
assertEqual(w.megaUnlocks["678:normal"].forms["mega-meowstic-f"].choice, { gender: "f" }, "gender stored with the unlock");
assertEqual(U.recordMegaUnlock(w, { line: "678:normal", formId: "mega-meowstic-m", stone: "megastone_meowsticite" }, ON).code, "variant_locked", "the gender can't be changed afterwards on that line");
assertTrue(U.recordMegaUnlock(w, { line: "978:normal", formId: "mega-tatsugiri-stretchy", stone: "megastone_tatsugirinite", at: T0 }, ON).ok, "Tatsugiri: appearance chosen at unlock");
assertEqual(w.megaUnlocks["978:normal"].forms["mega-tatsugiri-stretchy"].choice, { appearance: "stretchy" }, "appearance stored with the unlock");
assertEqual(U.recordMegaUnlock(w, { line: "978:normal", formId: "mega-tatsugiri-curly", stone: "megastone_tatsugirinite" }, ON).code, "variant_locked", "the appearance can't be changed afterwards");
assertEqual(U.recordMegaUnlock(w, { line: "6:normal", formId: "mega-charizard-x", stone: "megastone_charizarditex" }, ON).code, "already_unlocked", "Charizard X/Y are not a variant group (both allowed, already done)");

section("Unlocks never disappear (dormant lines, gifts, Levels)");
const d = clone(w);
const ref = JSON.stringify(d.megaUnlocks);
d.pokemon[6].shiny = 0; resetLevelIfGone(d, 6, "shiny");
assertTrue(!d.training["6:shiny"] && JSON.stringify(d.megaUnlocks) === ref, "losing the last shiny Charizard deletes its Level but keeps its unlock");
assertTrue(!U.activeMegaForms(d).some((x) => x.line === "6:shiny") && U.unlockedForms(d, "6:shiny").length === 1, "the shiny line's unlock is dormant (inactive, still stored)");
d.pokemon[6].shiny = 1;
assertTrue(U.activeMegaForms(d).some((x) => x.line === "6:shiny"), "re-acquiring the line reactivates it");
const recipient = prodLike(); delete recipient.pokemon[6];
assertEqual(giftPokemon(d, recipient, "6", "Charizard", 2), null, "gift 2 of 3 normal Charizards (allowed)");
assertTrue(JSON.stringify(d.megaUnlocks) === ref && !("megaUnlocks" in recipient), "gifting moves counts only: the sender keeps the unlock, the recipient gets none");
// /gift refuses only the species' last copy across normal + shiny: with a shiny
// Charizard still owned, the last NORMAL one may go. The normal line then
// empties: its Level is deleted, its unlock stays with the sender (dormant).
assertEqual(giftPokemon(d, recipient, "6", "Charizard", 1), null, "with a shiny still owned, the last normal Charizard can be gifted (existing rule)");
resetLevelIfGone(d, 6, "normal"); // gift.js does this inside giftPokemon; repeated here to be explicit
assertTrue(d.pokemon[6].normal === 0 && !d.training["6:normal"] && JSON.stringify(d.megaUnlocks) === ref, "the emptied normal line keeps its unlock (dormant), never transferred");
assertTrue(!("megaUnlocks" in recipient) && !U.activeMegaForms(d).some((x) => x.line === "6:normal"), "recipient gets no unlock; the sender's normal line is inactive until re-owned");
const solo = { pokemon: { 6: { normal: 1, shiny: 0 } }, megaUnlocks: { "6:normal": { forms: { "mega-charizard-x": { at: T0, stone: "megastone_charizarditex" } }, preferred: null } } };
assertTrue(/can't gift your last/.test(giftPokemon(solo, { pokemon: {} }, "6", "Charizard", 1) ?? ""), "the species' very last copy can never be gifted, so a sole Mega line can't be emptied by gifting (existing rule)");
assertEqual([getTraining(w, 6, "normal").exp, w.pokemon[6]], [125000, { normal: 3, shiny: 1 }], "unlocking changes no Level, count or shiny status");
assertEqual(normalizeTeam(w.displayedPokemon), normalizeTeam(prodLike().displayedPokemon), "unlocking changes no team");

section("Malformed data: quarantined, never silently dropped");
const m = prodLike();
m.megaUnlocks = {
  "6:normal": { forms: { "mega-charizard-x": { at: T0, stone: "megastone_charizarditex" }, "mega-venusaur": { at: T0, stone: "x" }, "mega-nope": { at: 1 } }, preferred: "mega-charizard-y" },
  "6:sparkly": { forms: {} },
  "150:shiny": "yes",
  "150:normal": { forms: { "mega-mewtwo-x": { at: -5 } } },
};
const r1 = U.normalizeMegaUnlocks(m, T0);
assertEqual(r1.quarantined, 6, "6 bad entries quarantined (wrong species, unknown form, bad line, non-object, bad record, stale preferred)");
assertEqual(Object.keys(m.megaUnlocks), ["6:normal"], "only valid lines remain");
assertEqual([Object.keys(m.megaUnlocks["6:normal"].forms), m.megaUnlocks["6:normal"].preferred], [["mega-charizard-x"], null], "valid form kept, stale preferred cleared");
assertTrue(m.megaLegacy.length === 6 && m.megaLegacy.every((e) => e.key && e.reason && e.at), "every removal recorded in megaLegacy");
assertEqual(U.normalizeMegaUnlocks(m, T0), { changed: false, quarantined: 0 }, "idempotent");
const arr = prodLike(); arr.megaUnlocks = ["oops"];
assertEqual([U.normalizeMegaUnlocks(arr, T0).quarantined, arr.megaUnlocks], [1, {}], "a non-object megaUnlocks is quarantined and reset");
const proto = prodLike(); proto.megaUnlocks = JSON.parse('{"__proto__": {"forms": {}}, "6:normal": {"forms": {"__proto__": {"at": 1}}}}');
U.normalizeMegaUnlocks(proto, T0);
assertTrue(!Object.prototype.hasOwnProperty.call(proto.megaUnlocks, "__proto__") && ({}).forms === undefined, "prototype keys removed, no pollution");
assertEqual(U.readMegaUnlocks({ megaUnlocks: { "6:normal": { forms: { "mega-charizard-x": { at: "soon" } } } } }), {}, "readers ignore malformed records without mutating");

section("Serialization round trip (real local snapshot store)");
store.__resetLocalStoreForTests();
const td = { [w.id]: w, [legacy.id + "2"]: prodLike() };
await store.writeSnapshot(td, { now: T0 });
const back = await store.readFileCandidate(store.paths().current, store.paths().currentMeta, "local");
assertTrue(back.ok && back.metaTrusted, "snapshot written and read back with a trusted SHA-256");
assertEqual(back.data[w.id].megaUnlocks, w.megaUnlocks, "megaUnlocks survive save → load byte-for-byte");
assertEqual(back.data[w.id].pokemon, w.pokemon, "counts survive");
assertEqual(U.readMegaUnlocks(back.data[w.id]), U.readMegaUnlocks(w), "the reloaded view is identical");

section("Rollback compatibility: v21 code paths with Mega data present");
const rb = clone(w);
rb.items.megastone_venusaurite = 2; rb.items.mega_shard = 7; // as if granted by a later release
rb.displayedPokemon = [{ id: 6, variant: "normal", mega: "mega-charizard-x" }, { id: 150, variant: "normal" }];
const megaBefore = JSON.stringify(rb.megaUnlocks);
let threw = null;
try {
  validateUserSchema(rb, rb.id, rb.name);
  normalizeInventory(rb);
  normalizeProgression(rb);
} catch (e) { threw = e; }
assertTrue(threw === null, "validateUserSchema / normalizeInventory / normalizeProgression don't throw");
assertEqual(JSON.stringify(rb.megaUnlocks), megaBefore, "megaUnlocks preserved untouched");
assertEqual([getQuantity(rb, "megastone_venusaurite"), getQuantity(rb, "mega_shard"), auditInventory(rb)], [2, 7, []], "stones and shards kept as valid inventory");
const rows = listInventory(rb).filter((r) => r.id.startsWith("mega"));
assertTrue(rows.length === 2 && rows.every((r) => !r.usable && r.status === "defined"), "the bag lists them as not usable yet");
assertEqual(normalizeTeam(rb.displayedPokemon), [{ id: 6, variant: "normal" }, { id: 150, variant: "normal" }], "a Mega team slot normalizes to its base Pokémon (no Mega in battle)");
assertEqual(buildTeam(rb).map((x) => [x.speciesId, x.variant, "megaForm" in x]), [[6, "normal", false], [150, "normal", false]], "buildTeam battles the base forms only");

section("Achievements and Pokédex counts ignore Megas");
const keys = [...new Set(listAchievements().map((a) => `${a.metric.kind}:${a.metric.key}`))];
const plain = prodLike(); normalizeProgression(plain);
const withMega = clone(w); delete withMega.pokemon[384]; delete withMega.pokemon[718]; delete withMega.pokemon[670]; delete withMega.pokemon[801]; normalizeProgression(withMega);
assertEqual(computeMetrics(withMega, keys), computeMetrics(plain, keys), `all ${keys.length} achievement metrics identical with and without Mega unlocks (no National Dex inflation)`);

finish();
