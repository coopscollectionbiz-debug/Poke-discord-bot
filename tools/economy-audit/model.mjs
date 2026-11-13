#!/usr/bin/env node
// ==========================================================
// tools/economy-audit/model.mjs
// Code-only economy model for docs/audits/economy-2026-11. No player data.
//
//   POKEMON_GENERATIONS=6 node tools/economy-audit/model.mjs > docs/audits/economy-2026-11/model.json
//
// Uses the bot's own odds functions (utils/weightedRandom.js rollRows,
// utils/battle/rewards.js koExp) so the numbers follow the code. Quest and
// Expedition figures are the DESIGN PROPOSAL in the report (section Q), not
// anything the bot does today.
// ==========================================================

process.env.POKEMON_GENERATIONS ??= "6"; // production value on 2026-11-13

const root = new URL("../../", import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const { rollRows, POKEMON_RARITY_WEIGHTS } = await imp("utils/weightedRandom.js");
const { acquirablePokemon, liveGenerations } = await imp("utils/speciesCatalog.js");
const { DONATION_CC_BY_TIER, DUST_REWARD_BY_TIER, SHINY_CRAFT_COST_BY_TIER, NON_SHINY_DUST_WEEKLY_CAP } = await imp("utils/economyRules.js");
const { BALL_COST, EVOLVE_STONE_COST, WEEKLY_PACK_TIERS } = await imp("services/gameplay.js");
const { TRAINER_COSTS } = await imp("utils/trainerCosts.js");
const { CHALLENGES } = await imp("utils/challenge/roster.js");
const { CAPS, CHALLENGE, ENCOUNTER, WIN_EXP_MULT } = await imp("utils/battle/tuning.js");
const { koExp } = await imp("utils/battle/rewards.js");
const { TYPE_ID_TO_NAME, effectiveness } = await imp("utils/battle/data.js");
const { getShinyOdds } = await imp("shinyOdds.js");
const { TM_PRICE_BY_TIER } = await imp("catalog/tms.js");
const { MEGA_REWARDS } = await imp("config/megaRewards.js");
const pokemonData = (await import(new URL("pokemonData.json", root).href, { with: { type: "json" } })).default;

const TIERS = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const BALLS = ["pokeball", "greatball", "ultraball"];
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;
const pool = acquirablePokemon(Object.values(pokemonData));

// Constants copied from code that isn't importable without starting the bot.
// bot_final.js:691-697 (chat), :159-190 (non-shiny donation dust), :2277 (stone price);
// commands/daily.js:38-40; utils/passiveChat.js (no daily cap).
const CHAT = { tpPerMsg: 2, ccChance: 0.02, ccGain: 100, cooldownMs: 7000, baseCatch: 0.01, pityStep: 0.003, maxCatch: 0.05 };
const DAILY = { cc: 1000, tp: 100, stoneChance: 0.25, catches: 2 };
const STONE_PRICE_DASHBOARD = 5000;
const NON_SHINY_DUST_EV = { common: 0.03, uncommon: 0.06, rare: 0.14, epic: 0.38, legendary: 0.8, mythic: 1.05 + 0.12 * 4 };

// ---------- 1. Tier odds per ball and Rank ----------
const RANK_TP = { "Novice (0 TP)": 0, "Advanced (5k TP)": 5000, "Master (25k TP)": 25000, "Legend (250k TP)": 250000 };
function tierOdds(rows) {
  const tot = rows.reduce((t, r) => t + r.w, 0);
  const out = Object.fromEntries(TIERS.map((t) => [t, 0]));
  for (const r of rows) out[String(r.item.tier).toLowerCase()] += r.w / tot;
  return out;
}
const speciesByTier = Object.fromEntries(TIERS.map((t) => [t, pool.filter((p) => p.tier === t).length]));
const odds = {};
for (const [label, tp] of Object.entries(RANK_TP)) {
  odds[label] = {};
  for (const b of BALLS) odds[label][b] = Object.fromEntries(Object.entries(tierOdds(rollRows(pool, { tp }, b))).map(([k, v]) => [k, r4(v)]));
}

// ---------- 2. Donation payback per ball (CC back per CC spent) ----------
const evOf = (o, table) => TIERS.reduce((t, k) => t + o[k] * table[k], 0);
const payback = {};
for (const [label] of Object.entries(RANK_TP)) {
  payback[label] = {};
  for (const b of BALLS) {
    const o = odds[label][b];
    const cc = evOf(o, DONATION_CC_BY_TIER);
    payback[label][b] = { donateCcEV: Math.round(cc), price: BALL_COST[b], paybackShare: r2(cc / BALL_COST[b]), netCostPerCatch: Math.round(BALL_COST[b] - cc), nonShinyDustEV: r2(evOf(o, NON_SHINY_DUST_EV)) };
  }
}
// Live event stacking: CC multiplier needed for a ball to pay for itself when donated.
const eventBreakEven = {};
for (const b of BALLS) {
  const cc = payback["Legend (250k TP)"][b].donateCcEV;
  eventBreakEven[b] = Object.fromEntries([0, 25, 50].map((d) => [`discount${d}`, r2((BALL_COST[b] * (1 - d / 100)) / cc)]));
}

// ---------- 3. Chat catch with pity ----------
function chatCatch() {
  let surv = 1, e = 0, luck = 0, cdf50 = null, cdf90 = null, p = 0;
  for (let n = 1; n <= 2000; n++) {
    luck = Math.min(CHAT.maxCatch, luck + CHAT.pityStep);
    p = Math.min(CHAT.maxCatch, CHAT.baseCatch + luck);
    e += n * surv * p;
    surv *= 1 - p;
    if (cdf50 == null && 1 - surv >= 0.5) cdf50 = n;
    if (cdf90 == null && 1 - surv >= 0.9) cdf90 = n;
  }
  return { expectedMessagesPerCatch: r2(e), medianMessages: cdf50, p90Messages: cdf90, chanceAtCap: CHAT.maxCatch, messagesToCap: Math.ceil((CHAT.maxCatch - CHAT.baseCatch) / CHAT.pityStep) };
}
const chat = chatCatch();
const maxMsgsPerDay = Math.floor(86_400_000 / CHAT.cooldownMs);
const chatCeiling = { maxRewardedMessagesPerDay: maxMsgsPerDay, tp: maxMsgsPerDay * CHAT.tpPerMsg, ccEV: Math.round(maxMsgsPerDay * CHAT.ccChance * CHAT.ccGain), catchesEV: Math.round(maxMsgsPerDay / chat.expectedMessagesPerCatch), donateCcOfCatchesEV: Math.round((maxMsgsPerDay / chat.expectedMessagesPerCatch) * payback["Legend (250k TP)"].pokeball.donateCcEV) };

// ---------- 4. Player profiles (CC per day, free faucets only) ----------
// Messages = rewarded chat messages (7 s apart). Encounter: ENCOUNTER.chance per missed catch roll, capped perDay.
const freeCatchDonate = payback["Advanced (5k TP)"].pokeball.donateCcEV; // a free catch donated, pokeball odds
function profile(msgs, { claimsDaily = true, donatesFreeCatches = true, encounterPrize = 600 } = {}) {
  const chatCC = msgs * CHAT.ccChance * CHAT.ccGain;
  const chatCatches = msgs / chat.expectedMessagesPerCatch;
  const encounters = Math.min(ENCOUNTER.perDay, msgs * ENCOUNTER.chance);
  const daily = claimsDaily ? DAILY.cc : 0;
  const weeklyPackPerDay = WEEKLY_PACK_TIERS.reduce((t, k) => t + DONATION_CC_BY_TIER[k], 0) / 7;
  const catchesPerDay = chatCatches + (claimsDaily ? DAILY.catches : 0);
  const donate = donatesFreeCatches ? catchesPerDay * freeCatchDonate + weeklyPackPerDay : 0;
  const enc = encounters * encounterPrize * 0.7; // assume 70% of spotted encounters are fought and won
  return { messages: msgs, chatCC: Math.round(chatCC), daily, encounterCC: Math.round(enc), donateFreeCatchesCC: Math.round(donate), totalCC: Math.round(chatCC + daily + enc + donate), catchesPerDay: r2(catchesPerDay), stonesPerWeek: r2(DAILY.stoneChance * 7 * (claimsDaily ? 1 : 0)) };
}
const profiles = { casual_20msgs: profile(20), active_100msgs: profile(100), grinder_400msgs: profile(400), spammer_cap: profile(maxMsgsPerDay, { encounterPrize: 600 }) };

// ---------- 5. One-time pools ----------
const challengePool = Object.values(CHALLENGES).reduce((t, c) => ({ cc: t.cc + c.prize.cc, stones: t.stones + c.prize.stones, dust: t.dust + c.prize.dust }), { cc: 0, stones: 0, dust: 0 });
let achievements = null;
try {
  const cat = await imp("catalog/achievements.js");
  const list = cat.listAchievements().filter(cat.isAchievementActive);
  const sum = { count: list.length, withReward: 0, cc: 0, items: {} };
  for (const a of list) {
    if (!a.reward) continue;
    sum.withReward++;
    sum.cc += Number(a.reward.cc ?? 0) || 0;
    for (const [k, v] of Object.entries(a.reward.items ?? {})) sum.items[k] = (sum.items[k] ?? 0) + Number(v || 0);
  }
  const { APPROVED_REWARD_IDS } = await imp("config/achievementRewards.js");
  achievements = { ...sum, approvedRewardIds: APPROVED_REWARD_IDS.length };
} catch (e) { achievements = { error: String(e.message) }; }

// ---------- 6. Stones: what one evolution costs ----------
const stoneCostCC = Object.fromEntries(Object.entries(EVOLVE_STONE_COST).map(([k, s]) => [k, { stones: s, ccAtShop: s * STONE_PRICE_DASHBOARD, daysOfDailyRolls: r2(s / DAILY.stoneChance) }]));

// ---------- 7. Focus type pools ----------
const TYPE_IDS = Object.keys(TYPE_ID_TO_NAME).map(Number);
const focus = {};
for (const tid of TYPE_IDS) {
  const tp = pool.filter((p) => (p.types ?? []).includes(tid));
  const byTier = Object.fromEntries(TIERS.map((t) => [t, tp.filter((p) => p.tier === t).length]));
  const perBall = {};
  for (const b of BALLS) {
    // Option B (filter only): the type pool with the bot's normal per-species weights.
    const rowsB = rollRows(tp, { tp: 25000 }, b);
    const totB = rowsB.reduce((t, r) => t + r.w, 0);
    const oB = tierOdds(rowsB);
    const maxSpeciesB = Math.max(...rowsB.map((r) => r.w / totB));
    // Option A (keep the ball's Tier odds, then pick within the type's Tier): renormalised over Tiers the type has.
    const oAll = odds["Master (25k TP)"][b];
    const have = TIERS.filter((t) => byTier[t] > 0 && oAll[t] > 0);
    const z = have.reduce((t, k) => t + oAll[k], 0);
    const oA = Object.fromEntries(TIERS.map((t) => [t, have.includes(t) ? oAll[t] / z : 0]));
    const maxSpeciesA = Math.max(...have.map((t) => oA[t] / byTier[t]));
    // A plain ball's chance of any one species of the type's rarest legendary/mythic, for comparison.
    const rowsAll = rollRows(pool, { tp: 25000 }, b);
    const totAll = rowsAll.reduce((t, r) => t + r.w, 0);
    const topTier = ["mythic", "legendary", "epic"].find((t) => byTier[t] > 0 && oAll[t] > 0);
    // Recommended (D7): option B without the Legendary and Mythic Tiers.
    const rowsC = rollRows(tp.filter((p) => p.tier !== "legendary" && p.tier !== "mythic"), { tp: 25000 }, b);
    const oC = rowsC.length ? tierOdds(rowsC) : null;
    perBall[b] = {
      recommended_filterNoLegendaryMythic: oC ? { tierOdds: Object.fromEntries(Object.entries(oC).map(([k, v]) => [k, r4(v)])), donateCcEV: Math.round(evOf(oC, DONATION_CC_BY_TIER)) } : null,
      optionB_filterOnly: { tierOdds: Object.fromEntries(Object.entries(oB).map(([k, v]) => [k, r4(v)])), donateCcEV: Math.round(evOf(oB, DONATION_CC_BY_TIER)), maxOneSpecies: r4(maxSpeciesB) },
      optionA_keepTierOdds: { tierOdds: Object.fromEntries(Object.entries(oA).map(([k, v]) => [k, r4(v)])), donateCcEV: Math.round(evOf(oA, DONATION_CC_BY_TIER)), maxOneSpecies: r4(maxSpeciesA) },
      plainBall: { donateCcEV: payback["Master (25k TP)"][b].donateCcEV, oneSpeciesOfTopTier: topTier ? r4((rowsAll.find((r) => r.item.tier === topTier)?.w ?? 0) / totAll) : null },
      price: { plain: BALL_COST[b], focused: Math.round(BALL_COST[b] * 1.5) },
    };
  }
  focus[TYPE_ID_TO_NAME[tid]] = { species: tp.length, byTier, perBall };
}

// ---------- 8. Battle EXP reference ----------
// EXP one Team member gets from a won Casual battle against `n` foes of a typical species (BST ~ 450, use Pidgeot 18) at the same Level.
const winExp = (level, n = 3, foe = 18) => Math.floor(Array.from({ length: n }, () => koExp({ foeSpeciesId: foe, foeLevel: level, recipientLevel: level })).reduce((a, b) => a + b, 0) * WIN_EXP_MULT);
const expRef = Object.fromEntries([15, 30, 40, 60].map((l) => [`Lv${l}`, { wonBattle3Foes: winExp(l, 3), wonBattle6Foes: winExp(l, 6), expToNextLevel: (l + 1) ** 3 - l ** 3 }]));

// ---------- 9. Quests proposal (report section Q) ----------
const Q = {
  board: { ccPerTask: 50, tasks: 3, chest: "1 free random catch (Poke Ball odds)", weekly: { need: 15, of: 21, reward: "1 free Great Ball throw" } },
  missions: { lengthsH: [2, 4, 8, 12], levels: "player-independent, from the date seed: 15 / 30 / 40 / 60 typical", running: 2, offered: 4 },
  successChance: "35% + 60% x (threats countered / threats) + Level adj (+1%/Lv above, -3%/Lv below the mission Level, party average), clamped 5%..95%",
  lootPerSuccess: {
    ccPerHour: 15,
    stoneChanceByLength: { 2: 0.1, 4: 0.2, 8: 0.4, 12: 0.6 },
    dustByLength: { 2: 0, 4: 1, 8: 2, 12: 3 },
    pokemonChanceByLength: { 2: 0, 4: 0, 8: 0.05, 12: 0.1 },
    tmChance12h: 0.02,
    bonusRoll: { chance: 0.2, effect: "x2 EXP, or one extra draw of the loot table" },
  },
  failure: { ccPerHour: 5, expShare: 0.25 },
  weeklyCaps: { stones: 5, dust: 15, pokemon: 2, tms: 1 },
};
function expeditionWeek(runs, success = 0.75) {
  // runs: [lengthH,...] per day
  const day = runs.reduce((t, L) => {
    const l = Q.lootPerSuccess;
    const bonus = 1 + l.bonusRoll.chance * 0.5; // half the bonus rolls are an extra draw
    return {
      cc: t.cc + success * L * l.ccPerHour * bonus + (1 - success) * L * Q.failure.ccPerHour,
      stones: t.stones + success * l.stoneChanceByLength[L] * bonus,
      dust: t.dust + success * l.dustByLength[L] * bonus,
      pokemon: t.pokemon + success * l.pokemonChanceByLength[L] * bonus,
      tms: t.tms + (L === 12 ? success * l.tmChance12h * bonus : 0),
    };
  }, { cc: 0, stones: 0, dust: 0, pokemon: 0, tms: 0 });
  const wk = Object.fromEntries(Object.entries(day).map(([k, v]) => [k, v * 7]));
  const capped = { cc: wk.cc, stones: Math.min(wk.stones, Q.weeklyCaps.stones), dust: Math.min(wk.dust, Q.weeklyCaps.dust), pokemon: Math.min(wk.pokemon, Q.weeklyCaps.pokemon), tms: Math.min(wk.tms, Q.weeklyCaps.tms) };
  const ccEquivalent = capped.cc + capped.stones * STONE_PRICE_DASHBOARD + capped.pokemon * freeCatchDonate + capped.tms * TM_PRICE_BY_TIER.basic;
  return { uncapped: Object.fromEntries(Object.entries(wk).map(([k, v]) => [k, r2(v)])), capped: Object.fromEntries(Object.entries(capped).map(([k, v]) => [k, r2(v)])), ccEquivalentPerWeek: Math.round(ccEquivalent), ccOnlyPerDay: Math.round(capped.cc / 7) };
}
const boardWeek = (doneDays = 7) => {
  const greatEV = payback["Advanced (5k TP)"].greatball.donateCcEV;
  return { cc: doneDays * Q.board.tasks * Q.board.ccPerTask, chestDonateEV: Math.round(doneDays * freeCatchDonate), weeklyGreatBallDonateEV: doneDays >= 5 ? greatEV : 0, perDayCC: Math.round((doneDays * Q.board.tasks * Q.board.ccPerTask + doneDays * freeCatchDonate + (doneDays >= 5 ? greatEV : 0)) / 7) };
};
const quests = {
  proposal: Q,
  expeditions: { casual_one12hPerDay: expeditionWeek([12], 0.7), active_8hAnd12h: expeditionWeek([8, 12], 0.8), maxed_all4Missions_2slots: expeditionWeek([2, 4, 8, 12], 0.9) },
  board: { allDays: boardWeek(7), fiveDays: boardWeek(5) },
  oldQuestIfReleased: { cooldownSec: 60, perDayMax: 1440, ccPerDay: 1440 * 50, freeCatchesOrTrainersPerDay: 1440 },
  oldRecruitIfReleased: { priceCC: 100, pokeballEquivalent: BALL_COST.pokeball, discount: r2(1 - 100 / BALL_COST.pokeball), donateEV: payback["Advanced (5k TP)"].pokeball.donateCcEV, profitPerRecruitWhenDonated: payback["Advanced (5k TP)"].pokeball.donateCcEV - 100, trainerRollVsCheapestTrainer: TRAINER_COSTS.common },
};

// ---------- 10. Shiny ----------
const shiny = Object.fromEntries([0, 1000, 10000, 50000, 250000].map((tp) => [`tp${tp}`, `1/${Math.round(1 / getShinyOdds(tp))}`]));

const out = {
  generatedAt: new Date().toISOString(),
  liveGenerations: liveGenerations(),
  acquirableSpecies: pool.length,
  speciesByTier,
  baseWeightsPerSpecies: POKEMON_RARITY_WEIGHTS,
  tierOdds: odds,
  donationPayback: payback,
  eventBreakEvenCcMultiplier: eventBreakEven,
  chatCatch: chat,
  chatCeilingPerDay: chatCeiling,
  profilesPerDay: profiles,
  oneTime: { challengeFirstWins: challengePool, achievements },
  stoneCost: stoneCostCC,
  dust: { donationShiny: DUST_REWARD_BY_TIER, craft: SHINY_CRAFT_COST_BY_TIER, nonShinyWeeklyCap: NON_SHINY_DUST_WEEKLY_CAP, nonShinyEV: NON_SHINY_DUST_EV },
  megaShards: MEGA_REWARDS,
  battleCaps: { ...CAPS, challengePerDay: CHALLENGE.perDay, challengeLossShare: CHALLENGE.lossShare, encounter: { chance: ENCOUNTER.chance, perDay: ENCOUNTER.perDay } },
  expReference: expRef,
  shinyOdds: shiny,
  focusType: focus,
  quests,
};
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
