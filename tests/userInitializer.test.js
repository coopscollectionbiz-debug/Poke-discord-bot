// ==========================================================
// tests/userInitializer.test.js
// ensureUserInitialized / validateUserSchema must repair records IN PLACE:
// same object, nothing lost, historical formats left compatible.
// Synthetic records only.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { validateUserSchema } from "../utils/userSchema.js";
import { lockUser } from "../utils/userLocks.js";
import { addExp, getTraining, grantCatch } from "../utils/training.js";
import { getBattleRecord } from "../utils/battle/rewards.js";
import { offerWager, refundWager } from "../utils/battle/wager.js";

const log = console.log;
console.log = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- Basic identity ----------
const trainerData = { 1: { id: "1", cc: 100, tp: 0, pokemon: {}, trainers: [], items: {} } };
const held = trainerData[1];
const returned = await ensureUserInitialized("1", "Ash", trainerData, null);
held.cc += 500;
const fresh = {};
const created = await ensureUserInitialized("2", "Misty", fresh, null);

// ---------- Historical (legacy) record ----------
const legacy = {
  id: "10",
  cc: 4200,
  tp: 15000,
  rank: "Ace Trainer",
  trainers: { "youngster-gen4.png": 1, "lass-gen4.png": 1 }, // legacy object map
  displayedPokemon: [25, 6],                                   // legacy number team
  displayedTrainer: "lass-gen4.png",
  lastDaily: "2026-11-08",                                      // string date format
  lastRecruit: 1730000000000,
  lastQuest: 1730000500000,
  items: { evolution_stone: 3, shiny_dust: 41 },
  purchases: ["starter_pack"],
  onboardingComplete: true,
  ownedPokemon: { 25: { normal: 2, shiny: 1 } },                // deprecated field
  pokemon: {},
};
const legacyBefore = clone(legacy);
const legacyData = { 10: legacy };
const legacyOut = await ensureUserInitialized("10", "Brock", legacyData, null);

// ---------- Modern record with battle, wager and training data ----------
const modern = {
  id: "20", name: "Gary", cc: 9000, tp: 80000,
  pokemon: { 6: { normal: 1, shiny: 1 }, 150: { normal: 1, shiny: 0 } },
  trainers: ["youngster-gen4.png"],
  displayedPokemon: [{ id: 6, variant: "shiny" }, { id: 150, variant: "normal" }],
  displayedTrainer: "youngster-gen4.png",
  lastDaily: "2026-11-09", lastRecruit: 0, lastQuest: 0,
  items: { evolution_stone: 0 }, purchases: [], onboardingComplete: true, luck: 0.021, luckTimestamp: 5,
};
addExp(modern, 6, "shiny", 5000);
const battle = getBattleRecord(modern, "2026-11-09");
battle.rating = 1112; battle.wins = 7; battle.losses = 2; battle.started = 3; battle.vs = { 30: 2 };
offerWager(modern, { defenderId: "30", stake: 500, channelId: "c1", nonce: "n-1", now: 1000 });
const modernBefore = clone(modern);
const modernData = { 20: modern };
const modernOut = await ensureUserInitialized("20", "Gary", modernData, null);

// ---------- Overlapping operations ----------
// A locked command holds the record across an await (like /daily, trainercard
// collectors or the passive reward), while an unlocked command (/showteam,
// /showcard) re-initializes the same user and chat adds TP.
const live = { 30: { id: "30", name: "Red", cc: 1000, tp: 100, pokemon: {}, trainers: [], items: {}, lastDaily: 0 } };
const slowCommand = lockUser("30", async () => {
  const u = await ensureUserInitialized("30", "Red", live, null);
  await sleep(20);
  u.cc += 250;                      // daily CC
  u.lastDaily = "2026-11-09";       // cooldown
  grantCatch(u, 1, "normal", () => 0.5);
});
await sleep(5);
const viewer = await ensureUserInitialized("30", "Red", live, null); // /showteam meanwhile
viewer.tp += 2;                                                      // chat TP meanwhile
live[30].luck = 0.009;                                               // pity update meanwhile
await slowCommand;
const dashboard = lockUser("30", async () => {
  const u = live[30];               // dashboard route re-reads inside the lock
  u.cc -= 1000;                     // buys a ball
  grantCatch(u, 4, "shiny", () => 0.5);
});
await dashboard;

// Wager stake held, record re-initialized, then refunded through the live record.
const w = { 40: { id: "40", cc: 800, tp: 0, pokemon: {}, trainers: [], items: {} } };
offerWager(w[40], { defenderId: "41", stake: 300, channelId: "c", nonce: "n-2", now: 0 });
await ensureUserInitialized("40", "Blue", w, null);
const refunded = refundWager(w[40], "n-2");

console.log = log;

section("Object identity");
assertTrue(returned === held, "returns the stored object, not a copy");
assertTrue(trainerData[1] === held, "trainerData keeps the same object");
assertEqual(trainerData[1].cc, 600, "a CC update made through an older reference is kept");
assertEqual(trainerData[1].items.evolution_stone, 0, "missing fields are still repaired");
assertTrue(fresh[2] === created && Array.isArray(created.displayedPokemon), "a new user is created and stored");
assertTrue(validateUserSchema(held, "1", "Ash") === held, "validateUserSchema returns its input object");

section("Historical record format");
assertTrue(legacyOut === legacy && legacyData[10] === legacy, "identity kept for a legacy record");
// D5: every entry point now produces the same trainer shape (an array of
// sprite keys), so a legacy object map is converted here too, losing nothing.
assertEqual(legacy.trainers, Object.keys(legacyBefore.trainers), "legacy trainer object map becomes an array of the same keys");
assertEqual(legacy.displayedPokemon, legacyBefore.displayedPokemon, "legacy number team is left as-is");
assertEqual([legacy.lastDaily, legacy.lastRecruit, legacy.lastQuest], [legacyBefore.lastDaily, legacyBefore.lastRecruit, legacyBefore.lastQuest], "cooldowns preserved (string and number formats)");
assertEqual([legacy.cc, legacy.tp, legacy.rank], [4200, 15000, "Ace Trainer"], "CC, TP and rank preserved");
assertEqual(legacy.items, { evolution_stone: 3, shiny_dust: 41 }, "items preserved");
assertEqual(legacy.pokemon, { 25: { normal: 2, shiny: 1 } }, "deprecated ownedPokemon still migrates into pokemon");
assertTrue(!("ownedPokemon" in legacy), "deprecated field removed after migration");
assertEqual(legacy.name, "Brock", "missing name filled from the username");

section("Battle, wager and training data");
assertTrue(modernOut === modern, "identity kept for a modern record");
const after = clone(modern);
const changed = Object.keys(modernBefore).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(modernBefore[k]));
// Individual copies (docs/adr/0001): team slots gain the uid of their copy and
// training is rewritten from the copies (same Levels); nothing else changes.
assertEqual(changed.filter((k) => k !== "displayedPokemon" && k !== "training"), [], "every other existing field (battle, pendingWager, luck, CC, TP) is unchanged");
assertEqual((after.displayedPokemon ?? []).map((s) => (s && typeof s === "object" ? `${s.id}:${s.variant}` : s)), (modernBefore.displayedPokemon ?? []).map((s) => (s && typeof s === "object" ? `${s.id}:${s.variant}` : s)), "the team keeps the same Pokémon in the same slots");
const added = Object.keys(after).filter((k) => !(k in modernBefore)).sort();
// Pre-existing behavior (unchanged by the in-place fix): absent fields get defaults.
assertEqual(added, ["box", "lastWeeklyPack", "onboardingDate", "onboardingStage", "pokedex", "rank", "starterPokemon", "weeklyPackClaimed"],
  "only missing fields are filled with defaults");
assertEqual(getTraining(modern, 6, "shiny").level, getTraining(modernBefore, 6, "shiny").level, "training level unchanged");
assertEqual(modern.pendingWager?.stake, 500, "pending wager stake kept");
assertEqual(modern.battle.rating, 1112, "battle rating kept");

section("Overlapping operations");
const r = live[30];
assertEqual(r.cc, 1000 + 250 - 1000, "CC: daily +250 and a dashboard −1000 both applied");
assertEqual(r.tp, 102, "chat TP made by another command during the hold is kept");
assertEqual(r.luck, 0.009, "pity update made during the hold is kept");
assertEqual(r.lastDaily, "2026-11-09", "cooldown set by the slow command is kept");
assertTrue(r.pokemon[1]?.normal === 1 && r.pokemon[4]?.shiny === 1, "Pokémon from both commands are owned");
assertEqual([refunded, w[40].cc, w[40].pendingWager], [300, 800, null], "a wager stake is refunded exactly once on the live record");

finish();
