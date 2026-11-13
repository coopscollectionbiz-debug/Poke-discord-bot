// ==========================================================
// tests/focusType.test.js: Focused Throws on the Poké Ball buy (replaces
// /recruit). One Focus per throw: a type or a Region. The ball's Tier odds
// stay the same; the pick comes from the Focus at every Tier, Mythic included
// (owner decision 2026-11-13: players may chase specific Legendaries and Mythics).
// ==========================================================

import { readFileSync } from "fs";
import { assertTrue, assertEqual, assertBetween, section, finish } from "./harness.js";
import { selectFocusedPokemon, rollRows } from "../utils/weightedRandom.js";
import { acquirablePokemon } from "../utils/speciesCatalog.js";
import { NO_EFFECTS } from "../utils/liveEventRules.js";
import { createGameplayHandlers, BALL_COST, focusSurcharge, focusTypeEnabled, parseFocus, focusRegions } from "../services/gameplay.js";
import { lockUser } from "../utils/userLocks.js";
import { saveAndAck } from "../utils/saveManager.js";

const pokemonData = JSON.parse(readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));
const POOL = acquirablePokemon(Object.values(pokemonData));
const FIRE = 10, FAIRY = 18;
const USER = { tp: 25_000 };

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const tierShare = (ball) => {
  const rows = rollRows(POOL, USER, ball);
  const tot = rows.reduce((s, r) => s + r.w, 0);
  const out = {};
  for (const r of rows) out[r.item.tier] = (out[r.item.tier] ?? 0) + r.w / tot;
  return out;
};

section("Switch, price, and what can be focused");
assertEqual([focusTypeEnabled({}), focusTypeEnabled({ FOCUS_TYPE_ENABLED: "1" })], [false, true], "FOCUS_TYPE_ENABLED, off by default");
assertEqual(Object.keys(BALL_COST).map(focusSurcharge), [500, 1000, 2000], "the ball's list price + 50%: 1,500 / 3,000 / 6,000 in total");
assertEqual(parseFocus("fire"), { type: FIRE, label: "Fire", kind: "type" }, "a type, any case");
assertEqual(parseFocus("Kanto"), { region: "Kanto", label: "Kanto", kind: "region" }, "a Region");
assertTrue(focusRegions().includes("Kanto") && focusRegions().every((r) => POOL.some((p) => p.region === r)), "Regions are those of the live generations");
assertEqual([parseFocus(""), parseFocus("Shadow"), parseFocus("Paldea")], [null, null, null], "unknown or unreleased: nothing");

function run(ball, focus, test, seed, N = 20_000) {
  const rand = seeded(seed);
  const tiers = {};
  let off = 0;
  for (let i = 0; i < N; i++) {
    const r = selectFocusedPokemon(POOL, USER, ball, focus, { fx: NO_EFFECTS, rand });
    if (!test(r.pick)) off++;
    tiers[r.pick.tier] = (tiers[r.pick.tier] ?? 0) + 1;
  }
  return { off, tiers, N };
}

section("Type Focus: the ball's Tier odds, every pick from the type (Mythic too)");
for (const [ball, seed] of [["pokeball", 1], ["ultraball", 2]]) {
  const { off, tiers, N } = run(ball, { type: FIRE }, (p) => p.types.includes(FIRE), seed);
  const plain = tierShare(ball);
  assertEqual(off, 0, `${ball}: every pick is Fire-type, at every Tier`);
  for (const t of ["rare", "epic", "legendary", "mythic"]) {
    if (!plain[t]) continue;
    const lo = t === "mythic" ? 0.7 : 0.85, hi = t === "mythic" ? 1.3 : 1.15;
    assertBetween((tiers[t] ?? 0) / N, plain[t] * lo, plain[t] * hi, `${ball}: ${t} share matches a plain throw (${(plain[t] * 100).toFixed(2)}%)`);
  }
}

section("Region Focus works the same way");
{
  const { off, tiers, N } = run("ultraball", { region: "Kanto" }, (p) => p.region === "Kanto", 3);
  const plain = tierShare("ultraball");
  assertEqual(off, 0, "every pick is from Kanto");
  assertBetween((tiers.legendary ?? 0) / N, plain.legendary * 0.85, plain.legendary * 1.15, "Legendary share matches a plain throw");
}

section("A Focus with nothing at a Tier re-rolls the Tier");
{
  assertEqual(POOL.filter((p) => p.types.includes(FAIRY) && p.tier === "legendary").length, 0, "no Fairy Legendary in the live Gens (the case under test)");
  const { off, tiers } = run("ultraball", { type: FAIRY }, (p) => p.types.includes(FAIRY), 4, 5000);
  assertEqual([off, tiers.legendary ?? 0], [0, 0], "a Legendary roll becomes another Fairy Tier, never another type");
}

section("The Shop handler: price, Focus result, flag");
{
  const td = { u1: { cc: 1_000_000, tp: 25_000, pokemon: {}, items: { evolution_stone: 0 }, displayedPokemon: [], training: {} } };
  const make = (env) => createGameplayHandlers({
    getTrainerData: () => td, lockUser, save: (d) => saveAndAck(d, { save: async () => true }),
    normalizeUserSchema: (_id, u) => u, env,
  });
  const off = make({});
  const refused = await off.rewardPokemon({ body: { id: "u1", source: "pokeball", focus: "Fire" }, isAuthorized: () => true });
  assertTrue(!refused.body.success && td.u1.cc === 1_000_000, "off: a Focused Throw is refused and costs nothing");

  const on = make({ FOCUS_TYPE_ENABLED: "1" });
  for (const [focus, kind, check] of [["fire", "type", (id) => pokemonData[id].types.includes(FIRE)], ["kanto", "region", (id) => pokemonData[id].region === "Kanto"]]) {
    let wrong = 0;
    for (let i = 0; i < 50; i++) {
      const before = td.u1.cc;
      const r = await on.rewardPokemon({ body: { id: "u1", source: "greatball", focus }, isAuthorized: () => true });
      if (!r.body.success || before - td.u1.cc !== 3000 || r.body.focus.kind !== kind || !check(r.body.pokemon.id)) wrong++;
    }
    assertEqual(wrong, 0, `50 ${kind} throws: each charged 3,000 and caught from the Focus`);
  }
  const bad = await on.rewardPokemon({ body: { id: "u1", source: "pokeball", focus: "Shadow" }, isAuthorized: () => true });
  assertTrue(!bad.body.success && /Unknown type or Region/.test(bad.body.error), "an unknown Focus is refused");
  const plain = await on.rewardPokemon({ body: { id: "u1", source: "pokeball" }, isAuthorized: () => true });
  assertTrue(plain.body.success && plain.body.focus === null && plain.body.cost === 1000, "a plain throw is unchanged");
}

finish();
