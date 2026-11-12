// ==========================================================
// tests/startupReadiness.test.js
// Before player data loads, chat must not create/modify records, grant
// rewards, queue role updates, or post rank announcements; once ready,
// normal processing resumes. Fully offline, synthetic data.
// ==========================================================

import { createMessageHandler, createRoleFlush } from "../utils/passiveChat.js";
import { getRank } from "../utils/rankSystem.js";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

// ---------- fakes ----------
let ready = false;
let trainerData = {};
const calls = { saves: 0, roleQueued: [], rewards: 0, reacts: 0, roleUpdates: [], channelSends: 0 };
const cooldowns = new Map();
const pending = new Map();

// Stand-in for bot_final's normalizeUserSchema: creates a default record.
const normalizeUserSchema = (id, u) => {
  const user = u && typeof u === "object" ? u : {};
  user.id ??= id;
  user.tp = Number.isFinite(user.tp) ? user.tp : 0;
  user.cc = Number.isFinite(user.cc) ? user.cc : 0;
  user.luck = Number.isFinite(user.luck) ? user.luck : 0;
  user.pokemon ??= {};
  return user;
};

const queueRoleUpdate = (job) => {
  calls.roleQueued.push(job.userId);
  pending.set(job.userId, job); // mirror bot_final's queueRoleUpdate
};

let tick = 1_000_000;
const onMessage = createMessageHandler({
  isReady: () => ready,
  getTrainerData: () => trainerData,
  normalizeUserSchema,
  cooldowns,
  config: { cooldownMs: 7000, tpGain: 2, ccChance: 0.02, ccGain: 100 },
  enqueueSave: () => { calls.saves++; },
  queueRoleUpdate,
  giveRandomReward: async (userObj) => {
    calls.rewards++;
    userObj.pokemon[25] = { normal: 1, shiny: 0 };
    userObj.luck = 0.5;
  },
  random: () => 0, // always wins the CC roll, so a missed guard would show up
  now: () => (tick += 10_000), // never on cooldown
  defer: (fn) => fn(),
});

const channel = { send: async () => { calls.channelSends++; } };
const flush = createRoleFlush({
  isReady: () => ready,
  pending,
  getTrainerData: () => trainerData,
  getRank,
  getMember: async (_g, id) => ({ id }),
  updateUserRole: async (member, tp, ch) => {
    calls.roleUpdates.push({ id: member.id, tp, announced: !!ch });
    if (ch) await ch.send({});
  },
});

const msg = (id) => ({
  author: { id, username: `u${id}`, bot: false },
  guild: { id: "g1" },
  channel,
  react: async () => { calls.reacts++; },
});
const settle = () => new Promise((r) => setImmediate(r));

// ---------- 1. not ready, empty data (fresh boot) ----------
section("Before player data loads");
await onMessage(msg("A"));
await onMessage(msg("B"));
await settle();
assertEqual(Object.keys(trainerData).length, 0, "no player records are created");
assertEqual(calls.saves, 0, "no save is queued");
assertEqual(calls.rewards, 0, "no Pokémon / luck reward is rolled");
assertEqual(calls.reacts, 0, "no CC reaction is added");
assertEqual(calls.roleQueued.length, 0, "no role update is queued");
assertEqual(cooldowns.size, 0, "cooldowns are not consumed");

// ---------- 2. not ready, but data present (e.g. shutdown, or retry window) ----------
section("Existing players while not ready");
const loaded = {
  P: { id: "P", tp: 60000, cc: 1234, luck: 0.03, rank: getRank(60000), pokemon: { 6: { normal: 2, shiny: 1 } } },
};
const snapshot = JSON.stringify(loaded);
trainerData = loaded;
await onMessage(msg("P"));
await settle();
assertEqual(JSON.stringify(trainerData), snapshot, "existing rank, TP, CC, luck and Pokémon are untouched");

// A job left in the queue (e.g. from before a reload) must not sync while not ready.
pending.set("P", { guild: { id: "g1" }, userId: "P", tp: 2, channel });
await flush();
assertEqual(calls.roleUpdates.length, 0, "the role flush does nothing while not ready");
assertEqual(calls.channelSends, 0, "no public rank announcement is sent");
assertEqual(pending.size, 1, "queued jobs are kept, not dropped");
assertEqual(trainerData.P.rank, getRank(60000), "the stored rank is not downgraded");
pending.clear();

// ---------- 3. ready: normal processing resumes ----------
section("After player data is ready");
ready = true;
await onMessage(msg("P"));
await settle();
assertEqual(trainerData.P.tp, 60002, "TP is granted");
assertEqual(trainerData.P.cc, 1334, "the CC roll can pay out");
assertEqual(calls.rewards, 1, "the random reward runs");
assertEqual(calls.saves, 1, "a save is queued");
assertEqual(calls.roleQueued, ["P"], "a role update is queued");

await flush();
assertEqual(calls.roleUpdates.length, 1, "the role flush syncs once ready");
assertEqual(calls.roleUpdates[0].announced, false, "no announcement when the rank didn't change");
assertEqual(trainerData.P.rank, getRank(60000), "rank stays correct");

await onMessage(msg("N"));
await settle();
assertTrue(trainerData.N && trainerData.N.tp === 2, "a brand-new chatter gets a record once ready");

// ---------- Trainer encounters ----------
section("Trainer encounters roll only after a miss");
{
  const spotted = [];
  let reward = "missed";
  let readyNow = false;
  let spotFails = false;
  const handler = createMessageHandler({
    isReady: () => readyNow,
    getTrainerData: () => trainerData,
    normalizeUserSchema,
    cooldowns: new Map(),
    config: { cooldownMs: 7000, tpGain: 2, ccChance: 0.02, ccGain: 100 },
    enqueueSave: () => {},
    queueRoleUpdate: () => {},
    giveRandomReward: async () => reward,
    spot: async (m) => {
      if (spotFails) throw new Error("boom");
      spotted.push(m.author.id);
    },
    random: () => 1,
    now: () => (tick += 10_000),
    defer: (fn) => fn(),
  });
  const say = async () => { await handler(msg("S")); await settle(); };
  await say();
  assertEqual(spotted, [], "never before player data loads");
  readyNow = true;
  await say();
  assertEqual(spotted, ["S"], "a message whose catch roll missed can be spotted");
  reward = "caught";
  await say();
  assertEqual(spotted, ["S"], "never in the same message as a catch");
  reward = "cooldown";
  await say();
  assertEqual(spotted, ["S"], "or on the reward cooldown");
  reward = "missed";
  spotFails = true;
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(" "));
  await say();
  console.warn = warn;
  assertTrue(warned.some((w) => w.includes("encounter")), "a failed spot is logged, not thrown");
}

finish();
