// ==========================================================
// tests/pokemonRetier.test.js — the 2026-11-11 Pokémon re-tier.
// data/pokedex/tier-overrides.json applied to pokemonData.json,
// tools/lib/tierRules.mjs applyTierOverrides, the Battle team mythic trim
// (services/battleTeam.js) and its one-time notice (services/notices.js,
// commands/battle.js sendPendingNotices). Synthetic players only.
// ==========================================================

import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const DEX = read("../pokemonData.json");
const BASELINE = read("../data/pokedex/gen1-5-baseline.json");
const OVERRIDES = read("../data/pokedex/tier-overrides.json").overrides;
const { applyTierOverrides, TIER_ORDER } = await import("../tools/lib/tierRules.mjs");
const B = await import("../services/battleTeam.js");
const N = await import("../services/notices.js");
const { sendPendingNotices } = await import("../commands/battle.js");
const { EVOLVE_STONE_COST } = await import("../services/gameplay.js");

section("Approved tier overrides are live in pokemonData.json");
const ids = Object.keys(OVERRIDES).map(Number);
assertEqual(ids.length, 39, "39 approved tier changes");
assertEqual(ids.filter((n) => DEX[n].tier !== OVERRIDES[n].tier), [], "every override is applied");
assertEqual(ids.filter((n) => n <= 649 && BASELINE[n].tier !== OVERRIDES[n].from), [], "each Gen 1–5 override replaces its baseline tier");
assertEqual(ids.filter((n) => OVERRIDES[n].from === OVERRIDES[n].tier), [], "no override is a no-op");
const mythics = Object.values(DEX).filter((p) => p.tier === "mythic").map((p) => p.id);
assertTrue([483, 484, 487, 646, 888, 889].every((n) => mythics.includes(n)), "Dialga, Palkia, Giratina, Kyurem, Zacian, Zamazenta are mythic");
assertEqual(mythics.length, 44, "44 mythic species (38 + 6)");
assertEqual([1005, 1006, 1009, 1010, 1020, 1021, 1022, 1023, 1018].map((n) => DEX[n].tier), Array(9).fill("legendary"), "590-BST Paradox and Archaludon are legendary");
assertEqual(DEX[289].tier, "epic", "Slaking stays epic (battle-side fix)");
assertEqual(DEX[486].tier, "legendary", "Regigigas stays legendary");
const bad = [];
for (const p of Object.values(DEX)) for (const t of p.evolvesTo) {
  if (TIER_ORDER.indexOf(DEX[t].tier) < TIER_ORDER.indexOf(p.tier)) bad.push(`${p.name}→${DEX[t].name} goes down`);
  if (!(EVOLVE_STONE_COST[`${p.tier}-${DEX[t].tier}`] > 0)) bad.push(`${p.name}→${DEX[t].name} has no Stone cost`);
}
assertEqual(bad, [], "no evolution goes down a tier and every one has a Stone cost");

section("applyTierOverrides guards");
const mini = () => ({ 1: { id: 1, name: "A", tier: "common", evolvesTo: [2] }, 2: { id: 2, name: "B", tier: "rare", evolvesTo: [] } });
{
  const out = mini();
  assertEqual(applyTierOverrides(out, { 2: { from: "rare", tier: "epic" } }), [2], "applies a matching override");
  assertEqual(out[2].tier, "epic", "tier replaced");
}
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
assertTrue(throws(() => applyTierOverrides(mini(), { 2: { from: "uncommon", tier: "epic" } })), "fails when the tier underneath drifted");
assertTrue(throws(() => applyTierOverrides(mini(), { 1: { from: "common", tier: "epic" } })), "fails when an evolution would go down a tier");
assertTrue(throws(() => applyTierOverrides(mini(), { 2: { from: "rare", tier: "ultra" } })), "fails on an unknown tier");

section("Battle team mythic trim");
// 150 Mewtwo (mythic), 483 Dialga, 484 Palkia (mythic after the re-tier), 25 Pikachu.
const player = (battleTeam) => ({
  id: "400000000000000077",
  pokemon: { 25: { normal: 1, shiny: 0 }, 150: { normal: 1, shiny: 0 }, 483: { normal: 0, shiny: 1 }, 484: { normal: 1, shiny: 0 } },
  ...(battleTeam ? { battleTeam } : {}),
});
{
  const u = player([{ id: 150, variant: "normal" }, { id: 25, variant: "normal" }, { id: 483, variant: "shiny" }, { id: 484, variant: "normal" }]);
  B.normalizeBattleTeam(u);
  assertEqual(u.battleTeam, [{ id: 150, variant: "normal" }, { id: 25, variant: "normal" }], "keeps the first mythic in slot order, drops the rest");
  assertEqual(u.pokemon[483].shiny + u.pokemon[484].normal, 2, "removed Pokémon stay in the collection");
  const notes = N.peekNotices(u, N.NOTICE_KINDS.BATTLE_TEAM_TRIM);
  assertEqual(notes.length, 1, "one notice stored");
  assertTrue(/shiny Dialga and Palkia were removed from your Battle team/.test(notes[0].text) && /you kept Mewtwo/.test(notes[0].text), `notice names what was removed and kept: ${notes[0].text}`);
  B.normalizeBattleTeam(u);
  assertEqual(N.peekNotices(u).length, 1, "idempotent: a second pass adds nothing");
}
{
  const u = player([{ id: 483, variant: "shiny" }, { id: 25, variant: "normal" }]);
  B.normalizeBattleTeam(u);
  assertEqual(u.battleTeam.length, 2, "one mythic is within the limit");
  assertTrue(!("notices" in u), "no notice when nothing was removed");
}
{
  const u = player(null);
  B.normalizeBattleTeam(u);
  assertTrue(!("battleTeam" in u) && !("notices" in u), "players without a Battle team are untouched");
}

section("Notices");
{
  const u = { notices: [{ id: "x", kind: "k", text: "t", at: 1 }, null, { kind: "bad" }] };
  N.normalizeNotices(u);
  assertEqual(u.notices.length, 1, "malformed notices dropped");
  assertEqual(N.clearNotices(u, ["x"]), 1, "cleared by id");
  assertTrue(!("notices" in u), "field removed when empty");
  const v = { notices: "junk" };
  N.normalizeNotices(v);
  assertTrue(!("notices" in v), "non-array field removed");
}

section("/battle delivers the notice once");
{
  const u = player([{ id: 150, variant: "normal" }, { id: 484, variant: "normal" }]);
  B.normalizeBattleTeam(u);
  const trainerData = { [u.id]: u };
  const sent = [];
  let saves = 0;
  const lockUser = async (_id, fn) => fn();
  const enqueueSave = async () => { saves++; };
  const interaction = (fail) => ({ user: { id: u.id }, replied: true, deferred: false, followUp: async (o) => { if (fail) throw new Error("Unknown interaction"); sent.push(o); } });

  await sendPendingNotices(interaction(true), trainerData, lockUser, enqueueSave);
  assertEqual(N.peekNotices(u).length, 1, "kept when the follow-up fails");
  await sendPendingNotices(interaction(false), trainerData, lockUser, enqueueSave);
  assertEqual(sent.length, 1, "sent as one follow-up");
  assertTrue(/Palkia was removed/.test(sent[0].content), "follow-up carries the notice text");
  assertEqual(N.peekNotices(u).length, 0, "cleared after sending");
  assertEqual(saves, 1, "clearing is saved");
  await sendPendingNotices(interaction(false), trainerData, lockUser, enqueueSave);
  assertEqual(sent.length, 1, "not sent again");
}

finish();
