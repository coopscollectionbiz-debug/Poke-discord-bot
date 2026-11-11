// ==========================================================
// tests/megaShards.test.js — Mega Shards and the Mega Stone shop
// (services/megaShards.js, services/megaApi.js shop handlers, the /daily and
// battle-win rolls). Synthetic players only; nothing is saved to disk.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";

const G = await import("../config/generations.js");
const C = await import("../utils/speciesCatalog.js");
const S = await import("../services/megaShards.js");
const { MEGA_REWARDS } = await import("../config/megaRewards.js");
const { allMegaStones, megaBattleEligibility } = await import("../utils/megas.js");
const { useMegaStone } = await import("../services/mega.js");
const { createMegaHandlers } = await import("../services/megaApi.js");
const { getQuantity, grantItem, listInventory } = await import("../services/inventory.js");
const { lockUser } = await import("../utils/userLocks.js");
const { runBattle } = await import("../utils/battle/runBattle.js");
const { createNewUser } = await import("../utils/userSchema.js");
const { expMessage } = await import("../commands/battle.js");

console.warn = () => {};
const OFF = {};
const MASTER_ONLY = { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1" };
const ON = { MEGA_EVOLUTION_ENABLED: "1", MEGA_REWARDS_ENABLED: "1" };
const ALL_ON = { ...ON, MEGA_BATTLES_ENABLED: "1" };
const NOW = Date.UTC(2026, 10, 11, 12);

// ------------------------------------------------------------------
section("Switched off: nothing is sold, granted or rolled");
for (const [label, env] of [["no flags", OFF], ["master + battles, rewards off", MASTER_ONLY], ["rewards flag without master", { MEGA_REWARDS_ENABLED: "1" }]]) {
  const u = { cc: 100000, items: {} };
  assertEqual(S.megaShopView(u, { env }), { enabled: false }, `${label}: the shop view is { enabled: false }`);
  assertEqual(S.shopStones({ env }), [], `${label}: no stones listed`);
  assertEqual([S.buyShards(u, 1, { env }).code, S.buyMegaStone({ items: { mega_shard: 999 } }, "megastone_charizarditex", { env }).code], ["rewards_off", "rewards_off"], `${label}: both purchases refused`);
  assertEqual([S.rollDailyShards(u, { rng: () => 0, env }), S.rollBattleShards(u, { rng: () => 0, now: NOW, env })], [0, 0], `${label}: drops never roll (even a guaranteed rng)`);
  assertEqual([u.cc, u.items, u.megaShardDrops], [100000, {}, undefined], `${label}: the player is untouched`);
  assertTrue(!grantItem({ items: {} }, "mega_shard", 1, { env }).ok, `${label}: grantItem refuses Mega Shards`);
}

// ------------------------------------------------------------------
section("The shop sells exactly the stones whose Mega can battle");
const stones = S.shopStones({ env: ON });
const expected = allMegaStones().filter((s) => s.forms.some((f) => megaBattleEligibility(f, { env: ALL_ON }).battleReady)).map((s) => s.id).sort();
assertEqual(stones.map((s) => s.id).sort(), expected, "the list equals the battle-eligibility rule, stone by stone");
assertEqual(stones.length, 46, "46 stones while Gens 1–5 are live");
assertTrue(stones.every((s) => s.forms.length && s.forms.every((f) => megaBattleEligibility(f.id, { env: ALL_ON }).battleReady)), "every listed form is battle-ready (non-battling forms of a stone aren't advertised)");
assertEqual(stones.filter((s) => s.special).map((s) => s.id).sort(), ["megastone_latiasite", "megastone_latiosite", "megastone_mewtwonitex", "megastone_mewtwonitey"], "the Legendary stones on sale: Mewtwonite X/Y, Latiasite, Latiosite");
assertTrue(stones.every((s) => s.price === (s.special ? 50 : 25)), "price: 25 shards, 50 for Legendary/Mythical");
assertTrue(!stones.some((s) => ["megastone_meowsticite", "megastone_diancite", "megastone_floettite", "megastone_zygardite"].includes(s.id)), "Z-A, blocked and not-yet-live stones are not sold");
assertEqual(S.shopStones({ env: { ...ON, MEGA_BATTLES_ENABLED: "0" } }).length, 46, "pausing Mega battles doesn't empty the shop (eligibility, not the battle switch)");
assertEqual(S.shopStones({ env: { ...ON, MEGA_FORMS: "mega-charizard-x,mega-lucario" } }).map((s) => s.id), ["megastone_charizarditex", "megastone_lucarionite"], "MEGA_FORMS limits the shop to the allowlisted forms");
G.setGenerationsForTesting([6]); C.resetCatalogCachesForTesting();
const gen6 = S.shopStones({ env: ON });
assertTrue(gen6.some((s) => s.id === "megastone_diancite" && s.special && s.price === 50) && gen6.length === 47, "Gen 6 live: Diancite joins at the Legendary price (47 stones)");
G.setGenerationsForTesting(null); C.resetCatalogCachesForTesting();

// ------------------------------------------------------------------
section("Buying shards with CC: 1,000 CC each, at most 25 a week");
const MON = Date.UTC(2026, 10, 9, 0, 0); // Monday 2026-11-09 00:00 UTC (ISO week 46)
const b = { cc: 30000, items: {} };
assertEqual(S.buyShards(b, 5, { env: ON, now: MON }), { ok: true, bought: 5, cost: 5000, shards: 5, cc: 25000, weeklyBought: 5, weeklyRemaining: 20 }, "5 shards cost 5,000 CC; 20 left this week");
assertEqual(b.megaShardPurchases, { week: "2026-W46", bought: 5 }, "the week's CC purchases are recorded");
assertEqual(S.buyShards(b, 25, { env: ON, now: MON }).code, "weekly_limit", "25 more would pass the weekly limit: refused");
assertTrue(/20 more/.test(S.buyShards(b, 25, { env: ON, now: MON }).error), "the refusal says how many are left");
assertTrue(S.buyShards(b, 20, { env: ON, now: MON + 6 * 86_400_000 + 86_399_000 }).ok, "the remaining 20 can be bought up to Sunday 23:59:59 UTC");
assertEqual([S.buyShards(b, 1, { env: ON, now: MON + 6 * 86_400_000 }).code, b.cc, getQuantity(b, "mega_shard")], ["weekly_limit", 5000, 25], "limit reached: refused, nothing charged");
assertEqual(S.ccShardsThisWeek(b, MON + 7 * 86_400_000), { week: "2026-W47", bought: 0, limit: 25, remaining: 25 }, "the limit resets Monday 00:00 UTC");
assertEqual(S.buyShards(b, 6, { env: ON, now: MON + 7 * 86_400_000 }).code, "no_cc", "next week: not enough CC (6,000 needed) is refused");
assertEqual([b.cc, getQuantity(b, "mega_shard"), b.megaShardPurchases.week], [5000, 25, "2026-W46"], "a refused purchase changes nothing");
const dropOnly = { cc: 1e6, items: { mega_shard: 40 } };
assertTrue(S.buyShards(dropOnly, 25, { env: ON, now: MON }).ok, "shards from drops don't count toward the CC limit");
assertEqual(S.ccShardsThisWeek({ megaShardPurchases: { week: "2026-W46", bought: -3 } }, MON).remaining, 25, "a malformed counter counts as 0");
for (const bad of [0, -1, 1.5, 26, "5", null, Number.MAX_SAFE_INTEGER]) assertEqual(S.buyShards({ cc: 1e9, items: {} }, bad, { env: ON }).code, "bad_quantity", `quantity ${JSON.stringify(bad)} refused`);
assertEqual(S.buyShards({ items: {} }, 1, { env: ON }).code, "no_cc", "a player with no CC field can't buy");
const viewWeek = S.megaShopView(b, { env: ON, now: MON });
assertEqual([viewWeek.ccPerShard, viewWeek.weeklyLimit, viewWeek.weeklyBought, viewWeek.weeklyRemaining], [1000, 25, 25, 0], "the shop view reports the price and this week's limit");

// ------------------------------------------------------------------
section("Spending shards on a Mega Stone");
const s = { cc: 0, items: { mega_shard: 74 } };
const got = S.buyMegaStone(s, "megastone_charizarditex", { env: ON });
assertEqual([got.ok, got.price, got.stones, got.shards], [true, 25, 1, 49], "Charizardite X: 25 shards → 1 stone");
assertEqual(S.buyMegaStone(s, "megastone_mewtwonitex", { env: ON }).code, "no_shards", "Mewtwonite X needs 50; 49 isn't enough");
assertEqual([getQuantity(s, "mega_shard"), getQuantity(s, "megastone_mewtwonitex")], [49, 0], "refusal: nothing spent, nothing granted");
s.items.mega_shard = 50;
assertTrue(S.buyMegaStone(s, "megastone_mewtwonitex", { env: ON }).ok && getQuantity(s, "mega_shard") === 0, "with 50 it's bought");
for (const id of ["megastone_meowsticite", "megastone_diancite", "evolution_stone", "mega_stone_voucher", "__proto__", ""]) {
  assertEqual(S.buyMegaStone({ items: { mega_shard: 999 } }, id, { env: ON }).code, "not_sold", `${id || "(empty)"}: not sold`);
}
const full = { items: { mega_shard: 999, megastone_lucarionite: 99 } };
assertEqual([S.buyMegaStone(full, "megastone_lucarionite", { env: ON }).code, getQuantity(full, "mega_shard")], ["stack_full", 999], "a full stack (99) is refused before any shard is spent");

section("A bought stone unlocks its Mega");
const p = createNewUser("1", "p");
p.pokemon[6] = { normal: 1, shiny: 0 };
p.items.mega_shard = 25;
assertTrue(S.buyMegaStone(p, "megastone_charizarditex", { env: ON }).ok, "bought Charizardite X");
const unlocked = useMegaStone(p, { line: "6:normal", stoneId: "megastone_charizarditex", formId: "mega-charizard-x", now: NOW }, { env: ON });
assertTrue(unlocked.ok && getQuantity(p, "megastone_charizarditex") === 0, "used on Charizard: Mega Charizard X unlocked, stone consumed");
const bagRow = listInventory({ items: { mega_shard: 3 } }, { env: ON }).find((r) => r.id === "mega_shard");
assertTrue(bagRow && /shop/.test(bagRow.usage), "the bag explains what shards are for while rewards are on");

// ------------------------------------------------------------------
section("/daily: a 25% chance of 2 shards");
assertEqual([S.rollDailyShards({ items: {} }, { rng: () => 0.2499, env: ON }), S.rollDailyShards({ items: {} }, { rng: () => 0.25, env: ON })], [2, 0], "the threshold is 25%");
let total = 0;
let seed = 7;
const lcg = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
for (let i = 0; i < 20000; i++) total += S.rollDailyShards({ items: {} }, { rng: lcg, env: ON });
assertTrue(Math.abs(total / 20000 - 0.5) < 0.03, `about 0.5 shards per daily on average (${(total / 20000).toFixed(3)})`);

section("Battle wins: a 10% chance of 1 shard, at most 2 a day");
const w = { items: {} };
assertEqual(S.rollBattleShards(w, { rng: () => 0.1, now: NOW, env: ON }), 0, "the threshold is 10%");
const got3 = [0, 0, 0].map(() => S.rollBattleShards(w, { rng: () => 0, now: NOW, env: ON }));
assertEqual([got3, getQuantity(w, "mega_shard"), w.megaShardDrops], [[1, 1, 0], 2, { day: "2026-11-11", battle: 2 }], "third drop of the day refused");
assertEqual(S.rollBattleShards(w, { rng: () => 0, now: NOW + 86_400_000, env: ON }), 1, "the cap resets the next UTC day");
assertEqual(S.rollBattleShards({ items: {}, megaShardDrops: { day: "2026-11-11", battle: "x" } }, { rng: () => 0, now: NOW, env: ON }), 1, "a malformed counter is repaired, not trusted");

// ------------------------------------------------------------------
section("Battles: the roll never changes the battle, and only a willing winner can earn");
function player(id, team) {
  const u = createNewUser(id, id);
  u.training = {};
  for (const [sp, lvl] of team) { u.pokemon[sp] = { normal: 1, shiny: 0 }; u.training[`${sp}:normal`] = { exp: lvl ** 3 }; }
  u.displayedPokemon = team.map(([sp]) => ({ id: sp, variant: "normal" }));
  u.battleTeam = team.map(([sp]) => ({ id: sp, variant: "normal" }));
  return u;
}
const strong = [[6, 90], [9, 90], [3, 90]];
const weak = [[10, 5], [13, 5]];
let sameBattle = true;
let shardKeysOff = 0;
let challengerShards = 0;
let defenderShards = 0;
let wagerDefenderShards = 0;
for (let seed = 1; seed <= 300; seed++) {
  for (const mode of ["open", "ranked"]) {
    const run = (env, chal, def) => {
      const td = { A: player("A", chal), B: player("B", def) };
      return { out: runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode, seed, now: new Date(NOW), env }), td };
    };
    const off = run(OFF, strong, weak);
    const on = run(ON, strong, weak);
    if ("megaShards" in off.out) shardKeysOff++;
    const strip = (o) => JSON.stringify({ ...o, megaShards: undefined });
    if (strip(off.out) !== strip(on.out)) sameBattle = false;
    challengerShards += on.out.megaShards?.A ?? 0;
    // The Defender wins here but never chose to battle: no roll.
    const lost = run(ON, weak, strong);
    defenderShards += getQuantity(lost.td.B, "mega_shard") + (lost.out.megaShards ? 1 : 0);
  }
  const td = { A: player("A", weak), B: player("B", strong) };
  td.A.cc = 100; td.B.cc = 100;
  const wg = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "wager", stake: 10, seed, now: new Date(NOW), env: ON });
  wagerDefenderShards += wg.megaShards?.B ?? 0;
}
assertTrue(sameBattle, "600 battles: identical results with rewards on and off (apart from the megaShards field)");
assertEqual(shardKeysOff, 0, "rewards off: the battle result has no megaShards key (byte-identical to before)");
assertTrue(challengerShards > 20 && challengerShards < 120, `a winning Challenger earns about 10% of the time (${challengerShards} in 600 wins)`);
assertEqual(defenderShards, 0, "a Defender who wins a casual or ranked battle they didn't start earns nothing");
assertTrue(wagerDefenderShards > 0, "a Defender who accepted a wager can earn by winning it");

section("The battle EXP message shows a drop");
const etd = { A: player("A", strong), B: player("B", weak) };
const real = runBattle({ trainerData: etd, challengerId: "A", defenderId: "B", mode: "open", seed: 3, now: new Date(NOW), env: ON });
const names = { A: "Ash", B: "Gary" };
const noRender = { render: () => { throw new Error("no render"); } };
const withDrop = await expMessage({ ...real, megaShards: { A: 1 } }, "A", names, etd.A, noRender);
const noDrop = await expMessage({ ...real, megaShards: { A: 0 } }, "A", names, etd.A, noRender);
assertTrue(/1 Mega Shard\*\*/.test(withDrop.content) && !/Mega Shard/.test(noDrop.content), "a drop adds one line to the EXP message; no drop adds nothing");
const plain = await expMessage({ ...real, megaShards: undefined }, "A", names, etd.A, noRender);
assertEqual(plain.content, noDrop.content, "rewards off: the EXP message is unchanged");

// ------------------------------------------------------------------
section("API: gated, validated, replay-safe");
const UID = "100000000000000042";
let saves = 0;
const td = { [UID]: { id: UID, cc: 30000, items: {}, pokemon: {} } };
const handlers = (env) => createMegaHandlers({ getTrainerData: () => td, lockUser, save: async () => { saves++; return { saved: true, note: "" }; }, getEnv: () => env });
const auth = (id) => id === UID;
const off = handlers(OFF);
const on = handlers(ON);
assertEqual(off.shop({ query: { id: UID }, isAuthorized: auth }).body, { success: true, enabled: false }, "off: the view exposes nothing");
assertEqual((await off.buyShards({ body: { id: UID, quantity: 1, requestId: "req-off-0001" }, isAuthorized: auth })).status, 403, "off: buying shards → 403");
assertEqual((await off.buyStone({ body: { id: UID, stoneId: "megastone_charizarditex", requestId: "req-off-0002" }, isAuthorized: auth })).status, 403, "off: buying a stone → 403");
assertEqual([on.shop({ query: { id: UID }, isAuthorized: () => false }).status, on.shop({ query: { id: "x" }, isAuthorized: auth }).status], [403, 400], "session and id checks come first");
const view = on.shop({ query: { id: UID }, isAuthorized: auth }).body;
assertTrue(view.enabled && view.stones.length === 46 && view.shards === 0 && view.cc === 30000 && view.ccPerShard === 1000 && view.weeklyRemaining === 25, "on: the view lists the stones, balance and price");
assertEqual((await on.buyShards({ body: { id: UID, quantity: 25 }, isAuthorized: auth })).status, 400, "a request id is required");
assertEqual((await on.buyShards({ body: { id: UID, quantity: "25", requestId: "req-shards-01" }, isAuthorized: auth })).status, 400, "the quantity must be a number");
const first = await on.buyShards({ body: { id: UID, quantity: 25, requestId: "req-shards-02" }, isAuthorized: auth });
const again = await on.buyShards({ body: { id: UID, quantity: 25, requestId: "req-shards-02" }, isAuthorized: auth });
assertTrue(first.status === 200 && !first.body.replayed && again.body.replayed, "the same request id is a replay");
assertEqual([td[UID].cc, getQuantity(td[UID], "mega_shard"), td[UID].megaShardPurchases.bought], [5000, 25, 25], "a double click buys once (and counts once toward the weekly limit)");
const both = await Promise.all([1, 2].map((i) => on.buyStone({ body: { id: UID, stoneId: "megastone_lucarionite", requestId: `req-stone-0${i}` }, isAuthorized: auth })));
assertEqual(both.map((r) => r.status).sort(), [200, 400], "two different concurrent stone purchases with 25 shards: one succeeds, one is refused");
assertEqual([getQuantity(td[UID], "megastone_lucarionite"), getQuantity(td[UID], "mega_shard")], [1, 0], "exactly one stone, shards never negative");
assertEqual((await on.buyStone({ body: { id: UID, stoneId: "Megastone_X", requestId: "req-stone-09" }, isAuthorized: auth })).status, 400, "a malformed stone id is rejected");
assertTrue(saves >= 2, "successful purchases are saved");

assertEqual(MEGA_REWARDS.shop.shardPacks, [1, 5, 25], "the dashboard offers packs of 1, 5 and 25");

finish();
