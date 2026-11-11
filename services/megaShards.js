// ==========================================================
// services/megaShards.js — Mega Shards and the Mega Stone shop.
//
// Players collect generic Mega Shards (daily chance, battle-win chance, or
// bought with CC) and spend them on any Mega Stone whose form can battle.
// Rates and prices: config/megaRewards.js.
//
// Every function here is a synchronous, all-or-nothing mutation (or a pure
// read) and does nothing unless the Mega "rewards" capability is on
// (MEGA_EVOLUTION_ENABLED + MEGA_REWARDS_ENABLED=1). Writes from the dashboard
// run inside runInventoryTransaction (lock → requestId replay → mutation →
// save); /daily and /battle call the roll helpers inside their own locks.
// ==========================================================

import { getCatalogItem } from "../catalog/items.js";
import { getQuantity, grantItem, consumeItems } from "./inventory.js";
import { allMegaStones, getMega, megaBattleEligibility, megaSpritePath } from "../utils/megas.js";
import { isMegaCapabilityEnabled } from "../config/features.js";
import { MEGA_REWARDS } from "../config/megaRewards.js";

export const SHARD_ID = MEGA_REWARDS.shardItem;
const fail = (error, code, status = 400) => ({ ok: false, error, code, status });
export const rewardsOn = (env = process.env) => isMegaCapabilityEnabled("rewards", env);
const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

// ----------------------------------------------------------
// The shop list: only stones with at least one form that can battle.
// Eligibility is the battle rule itself (verified profile, modelled ability,
// sprite, live generation, MEGA_FORMS), evaluated as if Mega battles were
// switched on, so the shop doesn't empty while battles are paused.
// ----------------------------------------------------------
function battleEligibleForms(stone, env) {
  const battleEnv = { ...env, MEGA_BATTLES_ENABLED: "1" };
  return stone.forms.filter((f) => megaBattleEligibility(f, { env: battleEnv }).battleReady);
}

/** Shard price of a stone: Legendary/Mythical stones cost more. */
export function stonePrice(stone) {
  const special = stone.officialStatus === "legendary" || stone.officialStatus === "mythical";
  return special ? MEGA_REWARDS.shop.stonePrice.legendary : MEGA_REWARDS.shop.stonePrice.regular;
}

/** Every stone the shop sells right now (empty while rewards are off). */
export function shopStones({ env = process.env } = {}) {
  if (!rewardsOn(env)) return [];
  const out = [];
  for (const s of allMegaStones()) {
    const forms = battleEligibleForms(s, env);
    if (!forms.length) continue;
    out.push({
      id: s.id,
      name: s.name,
      species: s.species,
      baseSpecies: s.baseSpecies,
      forms: forms.map((f) => ({ id: f, name: getMega(f)?.name ?? f, sprite: megaSpritePath(f, "normal") })),
      special: s.officialStatus === "legendary" || s.officialStatus === "mythical",
      price: stonePrice(s),
    });
  }
  return out.sort((a, b) => a.species - b.species || a.id.localeCompare(b.id));
}

const shopStoneById = (id, env) => shopStones({ env }).find((s) => s.id === id) ?? null;

// ----------------------------------------------------------
// Reads
// ----------------------------------------------------------
export const shardCount = (user) => getQuantity(user, SHARD_ID);

/** Dashboard view of the shop (prices, balance, stones and how many the player holds). */
export function megaShopView(user, { env = process.env } = {}) {
  if (!rewardsOn(env)) return { enabled: false };
  return {
    enabled: true,
    shards: shardCount(user),
    cc: Number.isSafeInteger(user?.cc) ? user.cc : 0,
    ccPerShard: MEGA_REWARDS.shop.ccPerShard,
    shardPacks: [...MEGA_REWARDS.shop.shardPacks],
    maxShardsPerPurchase: MEGA_REWARDS.shop.maxShardsPerPurchase,
    stones: shopStones({ env }).map((s) => ({ ...s, owned: getQuantity(user, s.id) })),
  };
}

// ----------------------------------------------------------
// Writes (synchronous, all-or-nothing)
// ----------------------------------------------------------

/** Buy `qty` shards with CC. */
export function buyShards(user, qty, { env = process.env } = {}) {
  if (!rewardsOn(env)) return fail("Mega Shards aren't available yet.", "rewards_off", 403);
  const max = MEGA_REWARDS.shop.maxShardsPerPurchase;
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > max) return fail(`Choose between 1 and ${max} shards.`, "bad_quantity");
  const cost = qty * MEGA_REWARDS.shop.ccPerShard;
  const cc = Number.isSafeInteger(user.cc) ? user.cc : 0;
  if (cc < cost) return fail(`Not enough CC: ${qty} Mega Shard${qty === 1 ? "" : "s"} cost ${cost.toLocaleString()} CC.`, "no_cc");
  const granted = grantItem(user, SHARD_ID, qty, { env });
  if (!granted.ok) return fail(granted.error, "grant_failed");
  user.cc = cc - cost;
  return { ok: true, bought: qty, cost, shards: granted.quantity, cc: user.cc };
}

/** Spend shards on one battle-eligible Mega Stone. */
export function buyMegaStone(user, stoneId, { env = process.env } = {}) {
  if (!rewardsOn(env)) return fail("Mega Stones aren't available yet.", "rewards_off", 403);
  const stone = shopStoneById(stoneId, env);
  if (!stone) return fail("That Mega Stone isn't sold in the shop.", "not_sold");
  const entry = getCatalogItem(stoneId);
  const have = getQuantity(user, stoneId);
  if (entry?.maxStack != null && have + 1 > entry.maxStack) return fail(`You can't hold more than ${entry.maxStack} ${stone.name}.`, "stack_full");
  const shards = shardCount(user);
  if (shards < stone.price) return fail(`${stone.name} costs ${stone.price} Mega Shards; you have ${shards}.`, "no_shards");
  // Spend and grant in one synchronous block: both checks above passed, so
  // neither step can fail between them.
  const spent = consumeItems(user, { [SHARD_ID]: stone.price });
  if (!spent.ok) return fail(spent.error, "spend_failed");
  const granted = grantItem(user, stoneId, 1, { env });
  if (!granted.ok) {
    grantItem(user, SHARD_ID, stone.price, { env }); // put the shards back (unreachable in practice)
    return fail(granted.error, "grant_failed");
  }
  return { ok: true, stoneId, name: stone.name, price: stone.price, stones: granted.quantity, shards: shardCount(user) };
}

// ----------------------------------------------------------
// Drops. `rng` returns [0, 1); callers pass Math.random or a seeded RNG.
// Return the number of shards granted (0 when nothing dropped).
// ----------------------------------------------------------

/** /daily: a chance of shards, like the Evolution Stone roll. */
export function rollDailyShards(user, { rng = Math.random, env = process.env } = {}) {
  if (!rewardsOn(env)) return 0;
  const { chance, shards } = MEGA_REWARDS.daily;
  if (!(rng() < chance)) return 0;
  return grantItem(user, SHARD_ID, shards, { env }).ok ? shards : 0;
}

/**
 * A battle win: a chance of shards, at most `maxPerUtcDay` drops a day.
 * The counter lives in user.megaShardDrops = { day, battle }.
 */
export function rollBattleShards(user, { rng = Math.random, now = Date.now(), env = process.env } = {}) {
  if (!rewardsOn(env)) return 0;
  const { chance, shards, maxPerUtcDay } = MEGA_REWARDS.battleWin;
  const day = utcDay(now);
  const rec = user.megaShardDrops && typeof user.megaShardDrops === "object" && user.megaShardDrops.day === day
    ? user.megaShardDrops
    : { day, battle: 0 };
  if (!Number.isSafeInteger(rec.battle) || rec.battle < 0) rec.battle = 0;
  if (rec.battle >= maxPerUtcDay) return 0;
  if (!(rng() < chance)) return 0;
  if (!grantItem(user, SHARD_ID, shards, { env }).ok) return 0;
  rec.battle += 1;
  user.megaShardDrops = rec;
  return shards;
}

/** One line for Discord messages, or "" when nothing dropped. */
export const shardDropLine = (n) => (n > 0 ? `💠 You found **${n} Mega Shard${n === 1 ? "" : "s"}**! Spend them in the dashboard shop.` : "");
