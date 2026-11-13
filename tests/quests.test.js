// ==========================================================
// tests/quests.test.js: the Daily board (Quests, Phase 1).
// ==========================================================

import { readFileSync } from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { TASKS, TASK_CC, WEEKLY_NEED, drawTasks, ensureQuests, questProgress, questView, claimQuest, questsEnabled } from "../services/quests.js";
import { createQuestHandlers } from "../services/questsApi.js";
import { createMessageHandler } from "../utils/passiveChat.js";
import { NO_EFFECTS } from "../utils/liveEventRules.js";
import { lockUser } from "../utils/userLocks.js";

const ON = { QUESTS_ENABLED: "1" };
const OFF = {};
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0); // Fri 2026-11-13, ISO week 46
const DAY = 86_400_000;
const ID = "123456789012345678";
const pokemonData = JSON.parse(readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));
const POOL = Object.values(pokemonData).filter((p) => p.generation <= 5);

const grantCc = (u, n) => { u.cc = (u.cc ?? 0) + n; return n; };
const fakeRoll = (u, ball) => ({ id: ball === "greatball" ? 25 : 16, name: ball, tier: "common", shiny: false });
const freshUser = () => ({ id: ID, cc: 0, tp: 0, pokemon: {}, box: {}, pokedex: {} });
// Finish every task on today's board.
function finishAll(u, now = NOW) {
  for (const t of ensureQuests(u, ID, now).tasks) {
    const def = TASKS.find((d) => d.id === t.id);
    questProgress(u, ID, def.kind, def.target, { now, env: ON });
  }
}

section("Switch");
assertEqual([questsEnabled(OFF), questsEnabled(ON), questsEnabled({ QUESTS_ENABLED: "no" })], [false, true, false], "QUESTS_ENABLED gates the board, off by default");
{
  const u = freshUser();
  assertEqual(questProgress(u, ID, "chat", 1, { now: NOW, env: OFF }), false, "off: progress is never recorded");
  assertEqual(u.quests, undefined, "off: nothing is written to the player");
  assertEqual(claimQuest(u, ID, "chest", { now: NOW, env: OFF, grantCc, rollCatch: fakeRoll }).status, 403, "off: claims refuse");
}

section("The day's board");
{
  const a = drawTasks(ID, "2026-11-13");
  assertEqual(a, drawTasks(ID, "2026-11-13"), "the same player and day always get the same board");
  assertEqual(new Set(a).size, 3, "three different tasks");
  assertTrue(a.every((id) => TASKS.some((t) => t.id === id)), "drawn from the task list");
  const days = new Set(Array.from({ length: 14 }, (_, i) => drawTasks(ID, `2026-11-${String(i + 1).padStart(2, "0")}`).join()));
  assertTrue(days.size > 7, "boards change from day to day");
  const others = new Set(Array.from({ length: 10 }, (_, i) => drawTasks(`1234567890123456${i}0`, "2026-11-13").join()));
  assertTrue(others.size > 1, "different players get different boards");
  const seen = new Set(Array.from({ length: 200 }, (_, i) => drawTasks(ID, `d${i}`)).flat());
  assertEqual(seen.size, TASKS.length, "every task shows up over time");
  assertTrue(TASKS.every((t) => !/catch/i.test(t.label)), "no task depends on a catch roll");
  assertTrue(TASKS.every((t) => ["chat", "casual", "ranked", "daily", "donate"].includes(t.kind)), "only tasks that cost nothing or pay for themselves (no feed, throw, evolve or Challenge)");
}

section("Progress");
{
  const u = freshUser();
  const q = ensureQuests(u, ID, NOW);
  const t = q.tasks[0];
  const def = TASKS.find((d) => d.id === t.id);
  questProgress(u, ID, def.kind, def.target + 50, { now: NOW, env: ON });
  assertEqual(u.quests.tasks[0].progress, def.target, "progress stops at the target");
  const kinds = new Set(q.tasks.map((x) => TASKS.find((d) => d.id === x.id).kind));
  const other = TASKS.find((d) => !kinds.has(d.kind));
  assertEqual(questProgress(u, ID, other.kind, 1, { now: NOW, env: ON }), false, "an action not on today's board changes nothing");
}

section("Claims");
{
  const u = freshUser();
  const q = ensureQuests(u, ID, NOW);
  const first = `task:${q.tasks[0].id}`;
  assertEqual(claimQuest(u, ID, first, { now: NOW, env: ON, grantCc, rollCatch: fakeRoll }).status, 409, "an unfinished task can't be claimed");
  assertEqual(claimQuest(u, ID, "task:nope", { now: NOW, env: ON, grantCc, rollCatch: fakeRoll }).status, 400, "a task not on the board can't be claimed");
  finishAll(u);
  assertEqual(claimQuest(u, ID, "chest", { now: NOW, env: ON, grantCc, rollCatch: fakeRoll }).status, 409, "the chest needs all three claimed");
  const r = claimQuest(u, ID, first, { now: NOW, env: ON, grantCc, rollCatch: fakeRoll });
  assertTrue(r.ok && r.cc === TASK_CC && u.cc === TASK_CC, `a finished task pays ${TASK_CC} CC`);
  assertEqual(claimQuest(u, ID, first, { now: NOW, env: ON, grantCc, rollCatch: fakeRoll }).status, 409, "and only once");
  for (const t of u.quests.tasks.slice(1)) claimQuest(u, ID, `task:${t.id}`, { now: NOW, env: ON, grantCc, rollCatch: fakeRoll });
  assertEqual(u.cc, 3 * TASK_CC, "three tasks: 150 CC");
  assertEqual(questView(u, { now: NOW }).chest.ready, true, "the chest is ready");
  const c = claimQuest(u, ID, "chest", { now: NOW, env: ON, grantCc, rollCatch: fakeRoll });
  assertTrue(c.ok && c.pokemon.name === "pokeball", "the chest rolls at Poké Ball odds");
  assertEqual(claimQuest(u, ID, "chest", { now: NOW, env: ON, grantCc, rollCatch: fakeRoll }).status, 409, "one chest a day");
  assertEqual(u.quests.week.done, 3, "the week counts claimed tasks");
}

section("Daily and weekly reset");
{
  const u = freshUser();
  let t = NOW;
  for (let d = 0; d < 5; d++) {
    finishAll(u, t);
    for (const task of u.quests.tasks) claimQuest(u, ID, `task:${task.id}`, { now: t, env: ON, grantCc, rollCatch: fakeRoll });
    t += DAY;
  }
  // Fri 13 → Tue 17: Fri, Sat, Sun count for week 46; Mon and Tue start week 47.
  assertEqual(u.quests.week.key, "2026-W47", "the ISO week rolls on Monday (UTC)");
  assertEqual(u.quests.week.done, 6, "the week count restarts with the new week");
  ensureQuests(u, ID, t);
  assertTrue(u.quests.tasks.every((x) => x.progress === 0 && !x.claimed) && !u.quests.chestClaimed, "a new UTC day is a fresh board");
  assertEqual(claimQuest(u, ID, "weekly", { now: t, env: ON, grantCc, rollCatch: fakeRoll }).status, 409, `the weekly bonus needs ${WEEKLY_NEED}`);
  u.quests.week.done = WEEKLY_NEED;
  const w = claimQuest(u, ID, "weekly", { now: t, env: ON, grantCc, rollCatch: fakeRoll });
  assertTrue(w.ok && w.pokemon.name === "greatball", "the weekly bonus throws a Great Ball");
  assertEqual(claimQuest(u, ID, "weekly", { now: t, env: ON, grantCc, rollCatch: fakeRoll }).status, 409, "once a week");
}

section("Broken records are repaired");
{
  const u = freshUser();
  u.quests = { day: "2026-11-13", tasks: [{ id: "bogus" }], week: "x" };
  ensureQuests(u, ID, NOW);
  assertTrue(u.quests.tasks.length === 3 && u.quests.week.done === 0, "bad tasks and week are rebuilt");
}

section("Dashboard handlers: view, claim, replay");
{
  const td = { [ID]: freshUser() };
  const logs = [];
  const save = async () => ({ saved: true, note: "" });
  const off = createQuestHandlers({ getTrainerData: () => td, lockUser, save, loadPool: async () => POOL, env: OFF, now: () => NOW });
  assertEqual((await off.view({ query: { id: ID }, isAuthorized: () => true })).body, { success: true, enabled: false }, "off: the view says not enabled");
  const h = createQuestHandlers({ getTrainerData: () => td, lockUser, save, loadPool: async () => POOL, logEvent: (...a) => logs.push(a), env: ON, now: () => NOW });
  assertEqual((await h.view({ query: { id: ID }, isAuthorized: () => false })).status, 403, "a stranger's session is refused");
  const v = await h.view({ query: { id: ID }, isAuthorized: () => true });
  assertTrue(v.body.enabled && v.body.tasks.length === 3, "on: the board comes back");
  finishAll(td[ID]);
  const what = `task:${td[ID].quests.tasks[0].id}`;
  const r1 = await h.claim({ body: { id: ID, what, requestId: "req-aaaa-1111" }, isAuthorized: () => true });
  const r2 = await h.claim({ body: { id: ID, what, requestId: "req-aaaa-1111" }, isAuthorized: () => true });
  assertTrue(r1.body.success && r2.body.replayed && td[ID].cc === TASK_CC, "a repeated requestId pays once");
  assertEqual(logs.length, 1, "and logs once");
  assertEqual(logs[0][0], "quest_claim", "logged as quest_claim");
  for (const t of td[ID].quests.tasks.slice(1)) await h.claim({ body: { id: ID, what: `task:${t.id}` }, isAuthorized: () => true });
  const chest = await h.claim({ body: { id: ID, what: "chest" }, isAuthorized: () => true });
  const caught = chest.body.pokemon;
  assertTrue(chest.body.success && pokemonData[caught.id] && td[ID].pokedex[caught.id] > 0, "the chest catch is a real Pokémon, registered in the Pokédex");
  assertEqual((await h.claim({ body: { id: ID, what: "../x" }, isAuthorized: () => true })).status, 400, "a malformed claim is refused");
}

section("Chat progress (no cap)");
{
  const td = {};
  let t = NOW;
  const env = process.env.QUESTS_ENABLED;
  process.env.QUESTS_ENABLED = "1";
  const onMessage = createMessageHandler({
    isReady: () => true, getTrainerData: () => td, normalizeUserSchema: (id, u) => ({ id, tp: 0, cc: 0, ...(u ?? {}) }),
    cooldowns: new Map(), config: { cooldownMs: 7000, tpGain: 2, ccChance: 0, ccGain: 100 },
    enqueueSave: () => {}, queueRoleUpdate: () => {}, giveRandomReward: async () => "missed",
    random: () => 1, now: () => t, defer: (fn) => fn(), effects: () => NO_EFFECTS,
  });
  const msg = { author: { id: ID, bot: false }, guild: {}, channel: {}, react: async () => {} };
  for (let i = 0; i < 40; i++) { t += 10_000; await onMessage(msg); }
  const chat = td[ID].quests.tasks.find((x) => x.id === "chat30");
  if (chat) assertEqual(chat.progress, 30, "chat messages fill the chat task (capped at its target)");
  else assertTrue(td[ID].quests.tasks.length === 3, "no chat task today: chat still rolls the board");
  if (env == null) delete process.env.QUESTS_ENABLED; else process.env.QUESTS_ENABLED = env;
}

section("Hooks are wired");
{
  const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const hooks = [
    ["utils/passiveChat.js", /questProgress\(userObj, userId, "chat"/],
    ["utils/battle/runBattle.js", /questProgress\(challenger, challengerId, "casual"/],
    ["bot_final.js", /questProgress\(u, id, "donate"\)/],
    ["bot_final.js", /questProgress\(u, id, "donate", result\.donatedCopies\)/],
    ["utils/battle/runBattle.js", /questProgress\(challenger, challengerId, "ranked"/],
    ["commands/daily.js", /questProgress\(user, userId, "daily"\)/],
  ];
  for (const [f, re] of hooks) assertTrue(re.test(src(f)), `${f}: ${re.source.split(",").at(-1)}`);
  const kinds = new Set(TASKS.map((t) => t.kind));
  assertEqual([...kinds].sort(), ["casual", "chat", "daily", "donate", "ranked"], "every task kind has a hook above");
}

finish();
