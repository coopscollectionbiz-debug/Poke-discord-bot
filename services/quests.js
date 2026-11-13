// ==========================================================
// services/quests.js: the Daily board (Quests, Phase 1).
// docs/audits/economy-2026-11/REPORT.md, Q2.
//
// Three tasks a day, drawn per player from the date, each under the player's
// control (never a chance roll). A finished task pays CC once claimed; all
// three claimed open the chest (one free random catch); 15 claimed tasks in
// an ISO week (UTC) unlock a free Great Ball throw. Everything resets at
// 00:00 UTC.
//
//   user.quests = {
//     day: "2026-11-13",
//     tasks: [{ id, progress, claimed }],   // 3, in board order
//     chestClaimed: false,
//     week: { key: "2026-W46", done: 9, bonusClaimed: false },
//   }
//
// Pure and synchronous: callers hold the user's lock and save afterwards.
// Behind QUESTS_ENABLED (off by default): with it off, progress is never
// recorded and the view/claims refuse.
// ==========================================================

import { getISOWeekKeyUTC } from "../utils/economyRules.js";

const TRUE = new Set(["1", "true", "yes", "on"]);

/** Is the Daily board switched on? Default: false. */
export const questsEnabled = (env = process.env) => TRUE.has(String(env.QUESTS_ENABLED ?? "").trim().toLowerCase());

/** CC per claimed task (D8, decided 2026-11-13). A Live event's CC multiplier applies. */
export const TASK_CC = 50;
export const TASKS_PER_DAY = 3;
/** Claimed tasks in one ISO week that unlock the weekly bonus. */
export const WEEKLY_NEED = 15;
export const WEEKLY_OF = TASKS_PER_DAY * 7;

/**
 * Every task a board can draw. `kind` is what questProgress() is called with.
 * Each one is something the player does on purpose, none depends on luck,
 * and none costs more than it pays (decided 2026-11-13): feeding, throwing a
 * ball, evolving and Challenges were left out, because each costs more than
 * the 50 CC a task pays, so the reward is always a bonus on top.
 */
export const TASKS = Object.freeze([
  { id: "chat30", kind: "chat", target: 30, label: "Send 30 chat messages", hint: "Messages that earn TP (7 s apart)." },
  { id: "casual2", kind: "casual", target: 2, label: "Fight 2 Casual battles", hint: "Win or lose. Start them with /battle." },
  { id: "ranked1", kind: "ranked", target: 1, label: "Fight a Ranked battle", hint: "Win or lose. /battle with ranked on." },
  { id: "daily1", kind: "daily", target: 1, label: "Claim /daily", hint: "Once a day." },
  { id: "donate3", kind: "donate", target: 3, label: "Donate 3 Pokémon", hint: "From your Collection." },
]);
const BY_ID = new Map(TASKS.map((t) => [t.id, t]));

export const utcDayOf = (now) => new Date(now).toISOString().slice(0, 10);
const nextUtcMidnight = (now) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

// FNV-1a: a stable 32-bit hash, so a player's board for a day never changes.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The task ids on this player's board for a UTC day (deterministic). */
export function drawTasks(userId, day) {
  const scored = TASKS.map((t) => ({ id: t.id, s: hash(`${day}:${userId}:${t.id}`) }));
  scored.sort((a, b) => a.s - b.s || a.id.localeCompare(b.id));
  return scored.slice(0, TASKS_PER_DAY).map((x) => x.id);
}

/**
 * Bring user.quests up to the current UTC day and ISO week, repairing
 * anything malformed. Idempotent. Returns user.quests.
 */
export function ensureQuests(user, userId, now = Date.now()) {
  const day = utcDayOf(now);
  const weekKey = getISOWeekKeyUTC(new Date(now));
  let q = user.quests;
  if (!q || typeof q !== "object" || Array.isArray(q)) q = user.quests = {};
  const tasksOk = Array.isArray(q.tasks) && q.tasks.length === TASKS_PER_DAY && q.tasks.every((t) => t && BY_ID.has(t.id));
  if (q.day !== day || !tasksOk) {
    q.day = day;
    q.tasks = drawTasks(String(userId ?? user.id ?? ""), day).map((id) => ({ id, progress: 0, claimed: false }));
    q.chestClaimed = false;
  }
  for (const t of q.tasks) {
    t.progress = Number.isSafeInteger(t.progress) && t.progress > 0 ? Math.min(t.progress, BY_ID.get(t.id).target) : 0;
    t.claimed = t.claimed === true;
  }
  q.chestClaimed = q.chestClaimed === true;
  if (!q.week || typeof q.week !== "object" || q.week.key !== weekKey) q.week = { key: weekKey, done: 0, bonusClaimed: false };
  q.week.done = Number.isSafeInteger(q.week.done) && q.week.done > 0 ? q.week.done : 0;
  q.week.bonusClaimed = q.week.bonusClaimed === true;
  return q;
}

/**
 * Record `n` of an action for today's board. No-op while Quests are off or
 * when no task on today's board counts this kind. Returns true if anything changed.
 */
export function questProgress(user, userId, kind, n = 1, { now = Date.now(), env = process.env } = {}) {
  if (!user || !questsEnabled(env)) return false;
  const amount = Number.isSafeInteger(n) && n > 0 ? n : 0;
  if (!amount) return false;
  const q = ensureQuests(user, userId, now);
  let changed = false;
  for (const t of q.tasks) {
    const def = BY_ID.get(t.id);
    if (def.kind !== kind || t.progress >= def.target) continue;
    t.progress = Math.min(def.target, t.progress + amount);
    changed = true;
  }
  return changed;
}

/** What the dashboard and /quest show. Pure (call ensureQuests first to roll the day). */
export function questView(user, { now = Date.now(), ccPerTask = TASK_CC } = {}) {
  const q = user.quests;
  const tasks = q.tasks.map((t) => {
    const def = BY_ID.get(t.id);
    return { id: t.id, label: def.label, hint: def.hint, progress: t.progress, target: def.target, done: t.progress >= def.target, claimed: t.claimed, cc: ccPerTask };
  });
  const allClaimed = tasks.every((t) => t.claimed);
  return {
    day: q.day,
    resetsAt: nextUtcMidnight(now),
    tasks,
    chest: { ready: allClaimed && !q.chestClaimed, claimed: q.chestClaimed, reward: "1 random Pokémon (Poké Ball odds)" },
    week: { key: q.week.key, done: q.week.done, need: WEEKLY_NEED, of: WEEKLY_OF, ready: q.week.done >= WEEKLY_NEED && !q.week.bonusClaimed, claimed: q.week.bonusClaimed, reward: "1 free Great Ball throw" },
  };
}

export const CLAIM_PATTERN = /^(task:[a-z0-9]{1,20}|chest|weekly)$/;

/**
 * Claim one thing. `grantCc(user, amount)` and `rollCatch(user, ball)` are
 * supplied by the caller (Live event CC multiplier, the catch pool), so this
 * stays pure. rollCatch returns { id, name, tier, shiny } or null.
 * @returns {{ok:true, what, cc?, pokemon?} | {ok:false, status, error}}
 */
export function claimQuest(user, userId, what, { now = Date.now(), env = process.env, grantCc, rollCatch } = {}) {
  if (!questsEnabled(env)) return { ok: false, status: 403, error: "Quests aren't open yet." };
  if (typeof what !== "string" || !CLAIM_PATTERN.test(what)) return { ok: false, status: 400, error: "Unknown quest reward." };
  const q = ensureQuests(user, userId, now);

  if (what.startsWith("task:")) {
    const t = q.tasks.find((x) => x.id === what.slice(5));
    if (!t) return { ok: false, status: 400, error: "That task isn't on today's board." };
    if (t.claimed) return { ok: false, status: 409, error: "Already claimed." };
    if (t.progress < BY_ID.get(t.id).target) return { ok: false, status: 409, error: "That task isn't finished yet." };
    const cc = grantCc(user, TASK_CC);
    t.claimed = true;
    q.week.done += 1;
    return { ok: true, what, cc, ccTotal: user.cc };
  }

  if (what === "chest") {
    if (q.chestClaimed) return { ok: false, status: 409, error: "Already claimed today." };
    if (!q.tasks.every((t) => t.claimed)) return { ok: false, status: 409, error: "Claim all three tasks first." };
    const pokemon = rollCatch(user, "pokeball");
    if (!pokemon) return { ok: false, status: 503, error: "No Pokémon could be picked. Try again in a moment." };
    q.chestClaimed = true;
    return { ok: true, what, pokemon };
  }

  // weekly
  if (q.week.bonusClaimed) return { ok: false, status: 409, error: "Already claimed this week." };
  if (q.week.done < WEEKLY_NEED) return { ok: false, status: 409, error: `Claim ${WEEKLY_NEED} tasks this week first (${q.week.done} so far).` };
  const pokemon = rollCatch(user, "greatball");
  if (!pokemon) return { ok: false, status: 503, error: "No Pokémon could be picked. Try again in a moment." };
  q.week.bonusClaimed = true;
  return { ok: true, what, pokemon };
}
