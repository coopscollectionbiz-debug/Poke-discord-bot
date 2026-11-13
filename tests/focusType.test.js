// ==========================================================
// tests/focusType.test.js: Focus type on the Poké Ball buy (replaces /recruit).
// The Tier odds stay the ball's; Common..Legendary picks come from the chosen
// type; a Mythic roll ignores the Focus and refunds the surcharge.
// ==========================================================

import { readFileSync } from "fs";
import { assertTrue, assertEqual, assertBetween, section, finish } from "./harness.js";
import { selectFocusedPokemon, rollRows } from "../utils/weightedRandom.js";
import { acquirablePokemon } from "../utils/speciesCatalog.js";
import { NO_EFFECTS } from "../utils/liveEventRules.js";
import { createGameplayHandlers, BALL_COST, focusSurcharge, focusTypeEnabled } from "../services/gameplay.js";
import { lockUser } from "../utils/userLocks.js";
import { saveAndAck } from "../utils/saveManager.js";

const pokemonData = JSON.parse(readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));
const POOL = acquirablePokemon(Object.values(pokemonData));
const FIRE = 10, FAIRY = 18;
const USER = { tp: 25_000 };

// Seeded uniform numbers so the shares below are stable run to run.
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

section("Switch and price");
assertEqual([focusTypeEnabled({}), focusTypeEnabled({ FOCUS_TYPE_ENABLED: "1" })], [false, true], "FOCUS_TYPE_ENABLED, off by default");
assertEqual(Object.keys(BALL_COST).map(focusSurcharge), [500, 1000, 2000], "the ball's list price + 50%: 1,500 / 3,000 / 6,000 in total");

section("Tier odds are the ball's; non-Mythic picks are the chosen type");
for (const ball of ["pokeball", "ultraball"]) {
  const rand = seeded(ball === "pokeball" ? 1 : 2);
  const N = 20_000;
  const tiers = {};
  let offType = 0, mythicNotApplied = 0, mythics = 0;
  for (let i = 0; i < N; i++) {
    const r = selectFocusedPokemon(POOL, USER, ball, FIRE, { fx: NO_EFFECTS, rand });
    const t = r.pick.tier;
    if (t === "mythic") { mythics++; if (!r.focusApplied) mythicNotApplied++; }
    else if (!r.pick.types.includes(FIRE)) offType++;
    tiers[t] = (tiers[t] ?? 0) + 1;
  }
  const plain = tierShare(ball);
  assertEqual(offType, 0, `${ball}: every Common..Legendary pick is Fire-type`);
  assertEqual(mythicNotApplied, mythics, `${ball}: every Mythic roll ignores the Focus`);
  assertBetween(mythics / N, plain.mythic * 0.75, plain.mythic * 1.25, `${ball}: Mythics come up as often as on a plain throw (${(plain.mythic * 100).toFixed(2)}%)`);
  for (const t of ["rare", "epic", "legendary"]) {
    if (!plain[t]) continue;
    assertBetween((tiers[t] ?? 0) / N, plain[t] * 0.85, plain[t] * 1.15, `${ball}: ${t} share matches a plain throw`);
  }
}

section("A type with nothing at a Tier re-rolls the Tier");
{
  const fairyLegends = POOL.filter((p) => p.types.includes(FAIRY) && p.tier === "legendary").length;
  assertEqual(fairyLegends, 0, "no Fairy Legendary in the live Gens (the case under test)");
  const rand = seeded(3);
  let legendary = 0, offType = 0;
  for (let i = 0; i < 5000; i++) {
    const r = selectFocusedPokemon(POOL, USER, "ultraball", FAIRY, { fx: NO_EFFECTS, rand });
    if (r.focusApplied && r.pick.tier === "legendary") legendary++;
    if (r.focusApplied && !r.pick.types.includes(FAIRY)) offType++;
  }
  assertEqual([legendary, offType], [0, 0], "a Legendary roll becomes a Fairy Rare or Epic, never another type");
}

section("The Shop handler: price, refund, flag");
{
  const td = { u1: { cc: 1_000_000, tp: 25_000, pokemon: {}, items: { evolution_stone: 0 }, displayedPokemon: [], training: {} } };
  const make = (env, pool = null) => createGameplayHandlers({
    getTrainerData: () => td, lockUser, save: (d) => saveAndAck(d, { save: async () => true }),
    normalizeUserSchema: (_id, u) => u, env,
    ...(pool && { loaders: { getAllPokemon: async () => pool } }),
  });
  const off = make({});
  const refused = await off.rewardPokemon({ body: { id: "u1", source: "pokeball", focus: "Fire" }, isAuthorized: () => true });
  assertTrue(!refused.body.success && td.u1.cc === 1_000_000, "off: a Focused Throw is refused and costs nothing");

  // Only Fire Commons and Mythics: a Poké Ball either focuses (Fire) or lands a Mythic.
  const pool = POOL.filter((p) => (p.tier === "common" && p.types.includes(FIRE)) || p.tier === "mythic");
  const on = make({ FOCUS_TYPE_ENABLED: "1" }, pool);
  let applied = 0, refunds = 0;
  for (let i = 0; i < 400; i++) {
    const before = td.u1.cc;
    const r = await on.rewardPokemon({ body: { id: "u1", source: "pokeball", focus: "fire" }, isAuthorized: () => true });
    const paid = before - td.u1.cc;
    if (r.body.focus.applied) { applied++; if (paid !== 1500) throw new Error(`focused throw charged ${paid}`); }
    else { refunds++; if (paid !== 1000 || r.body.focus.refunded !== 500 || r.body.pokemon.rarity !== "mythic") throw new Error(`mythic throw charged ${paid}`); }
  }
  assertTrue(applied > 0, `${applied} focused throws charged 1,500 (ball + 500)`);
  assertTrue(refunds > 0, `${refunds} Mythic throws charged 1,000 (the 500 refunded)`);
  const bad = await on.rewardPokemon({ body: { id: "u1", source: "pokeball", focus: "Shadow" }, isAuthorized: () => true });
  assertTrue(!bad.body.success && /Unknown type/.test(bad.body.error), "an unknown type is refused");
  const plain = await on.rewardPokemon({ body: { id: "u1", source: "pokeball" }, isAuthorized: () => true });
  assertTrue(plain.body.success && plain.body.focus === null && plain.body.cost === 1000, "a plain throw is unchanged");
}

finish();
