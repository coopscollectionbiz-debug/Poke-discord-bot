// ==========================================================
// tests/chatCap.test.js
// Economy audit 2026-11, D3: rewarded chat messages are capped per player
// per UTC day, and chat CC is logged (D10).
// ==========================================================

import { createMessageHandler } from "../utils/passiveChat.js";
import { NO_EFFECTS } from "../utils/liveEventRules.js";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 13, 23, 0, 0); // 23:00 UTC, an hour before the day rolls

function setup({ cap = 3, random = () => 0 } = {}) {
  const trainerData = {};
  const calls = { rewards: 0, saves: 0, logs: [] };
  let t = START;
  const handler = createMessageHandler({
    isReady: () => true,
    getTrainerData: () => trainerData,
    normalizeUserSchema: (id, u) => ({ id, tp: 0, cc: 0, ...(u ?? {}) }),
    cooldowns: new Map(),
    config: { cooldownMs: 7000, tpGain: 2, ccChance: 0.02, ccGain: 100, dailyCap: cap },
    enqueueSave: () => { calls.saves++; },
    queueRoleUpdate: () => {},
    giveRandomReward: async () => { calls.rewards++; return "missed"; },
    random,
    now: () => t,
    defer: (fn) => fn(),
    effects: () => NO_EFFECTS,
    log: (type, userId, data) => calls.logs.push({ type, userId, data }),
  });
  const msg = { author: { id: "u1", bot: false }, guild: {}, channel: {}, react: async () => {} };
  const send = async (stepMs = 10_000) => { t += stepMs; await handler(msg); };
  return { trainerData, calls, send, setTime: (v) => { t = v; } };
}

section("The cap stops TP, CC, catches and encounters for the rest of the UTC day");
{
  const s = setup({ cap: 3 });
  for (let i = 0; i < 5; i++) await s.send();
  const u = s.trainerData.u1;
  assertEqual(u.tp, 6, "3 rewarded messages: 3 x 2 TP, the 4th and 5th pay nothing");
  assertEqual(u.cc, 300, "CC only from the first 3 (the CC roll always wins here)");
  assertEqual(s.calls.rewards, 3, "the catch roll runs only for the first 3");
  assertEqual(u.chatToday.count, 3, "the count stops at the cap");
  assertTrue(u.lastActiveAt >= START + 50_000, "a capped message still counts as activity");
}

section("Messages on cooldown don't use up the cap");
{
  const s = setup({ cap: 3 });
  await s.send(10_000);
  await s.send(1_000); // inside the 7 s cooldown
  await s.send(1_000);
  assertEqual(s.trainerData.u1.chatToday.count, 1, "only the rewarded message counts");
}

section("The cap resets at 00:00 UTC");
{
  const s = setup({ cap: 2 });
  for (let i = 0; i < 4; i++) await s.send();
  assertEqual(s.trainerData.u1.tp, 4, "capped before midnight");
  s.setTime(START + DAY);
  await s.send();
  assertEqual(s.trainerData.u1.tp, 6, "the next UTC day pays again");
  assertEqual(s.trainerData.u1.chatToday, { day: "2026-11-14", count: 1 }, "a new day starts a new count");
}

section("Chat CC is logged (D10)");
{
  const s = setup({ cap: 5 });
  await s.send();
  assertEqual(s.calls.logs, [{ type: "chat_cc", userId: "u1", data: { cc: 100 } }], "one chat_cc event per CC award");
  const quiet = setup({ cap: 5, random: () => 0.99 });
  await quiet.send();
  assertEqual(quiet.calls.logs.length, 0, "no CC, nothing logged");
}

section("No cap configured: unchanged behavior");
{
  const s = setup({ cap: 0 });
  for (let i = 0; i < 10; i++) await s.send();
  assertEqual(s.trainerData.u1.tp, 20, "every rewarded message pays");
  assertEqual(s.trainerData.u1.chatToday, undefined, "no counter is kept");
}

finish();
