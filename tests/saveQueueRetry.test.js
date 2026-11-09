// ==========================================================
// tests/saveQueueRetry.test.js
// Retry / failure behavior of utils/saveQueue.js with an injected writer
// and shortened timings. Offline, no files written.
// ==========================================================

import {
  enqueueSave,
  shutdownFlush,
  retryDelayMs,
  __setSaveQueueTestHooks,
  __resetSaveQueueForTests,
  __saveQueueState,
} from "../utils/saveQueue.js";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

let unhandled = 0;
process.on("unhandledRejection", () => { unhandled++; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAST = { debounceMs: 5, minIntervalMs: 0, maxWaitMs: 30, retryBaseMs: 20, retryMaxMs: 80 };

// Silence queue logs but capture retry delays.
const original = { log: console.log, warn: console.warn, error: console.error };
let retryDelays = [];
console.log = (msg, ...rest) => { if (!String(msg).startsWith("💾")) original.log(msg, ...rest); };
console.error = (msg, ...rest) => { if (!String(msg).startsWith("❌ Save error")) original.error(msg, ...rest); };
console.warn = (msg) => {
  const m = /Save retry #\d+ in (\d+)ms/.exec(String(msg));
  if (m) retryDelays.push(Number(m[1]));
};

// Fake writer: `plan` is a list of outcomes ("fail" | "ok" | number = ok after ms delay);
// after the list runs out, `fallback` applies.
function makeWriter(plan = [], fallback = "ok") {
  const w = { calls: [], writes: [] };
  w.fn = async (data) => {
    const outcome = plan.length ? plan.shift() : fallback;
    w.calls.push(Date.now());
    if (typeof outcome === "number") await sleep(outcome);
    if (outcome === "fail") throw new Error("EIO (simulated)");
    w.writes.push(JSON.parse(JSON.stringify(data)));
  };
  return w;
}
function setup(plan, fallback) {
  __resetSaveQueueForTests();
  retryDelays = [];
  const w = makeWriter(plan, fallback);
  __setSaveQueueTestHooks({ writer: w.fn, timing: FAST });
  return w;
}
const within = (p, ms) => Promise.race([p, sleep(ms).then(() => "TIMEOUT")]);

// ---------------------------------------------------------
section("Backoff schedule (production defaults)");
assertEqual([1, 2, 3, 4, 5, 6, 7, 50].map((n) => retryDelayMs(n, 1000, 30_000)),
  [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000],
  "delays double from 1 s and stop growing at 30 s");

// ---------------------------------------------------------
section("1. A write fails once, then succeeds");
{
  const w = setup(["fail"], "ok");
  const data = { u1: { cc: 10 } };
  const first = await within(enqueueSave(data), 500);
  assertEqual(first, false, "the waiting caller is released with false (not reported as saved)");
  await sleep(100);
  assertEqual(w.writes.length, 1, "the automatic retry writes once");
  assertEqual(w.writes.at(-1), { u1: { cc: 10 } }, "the retried write has the data");
  assertEqual(__saveQueueState().consecutiveFailures, 0, "failure count resets after success");
}

// ---------------------------------------------------------
section("2–3. Consecutive failures back off and cap");
{
  const w = setup(["fail", "fail", "fail", "fail", "fail"], "ok");
  const data = { u1: { cc: 1 } };
  enqueueSave(data);
  // New changes keep arriving during the backoff; they must not bypass it.
  const chatter = setInterval(() => { data.u1.cc++; enqueueSave(data); }, 3);
  await sleep(450);
  clearInterval(chatter);
  await sleep(150);
  assertEqual(retryDelays, [20, 40, 80, 80, 80], "delays grow 20→40→80 and stop at the cap");
  // calls[0..4] failed, calls[5] is the first success; later writes are
  // ordinary saves for chat that kept arriving after recovery.
  const attempts = w.calls.slice(0, 6);
  const gaps = attempts.slice(1).map((t, i) => t - attempts[i]);
  const expected = [20, 40, 80, 80, 80];
  assertTrue(gaps.length === 5 && gaps.every((g, i) => g >= expected[i] - 5),
    `no attempt happens before its backoff ends, even with new saves arriving (gaps ${gaps.join(",")} ms)`);
  assertTrue(w.writes.length >= 1 && w.calls.length - w.writes.length === 5,
    "exactly 5 failed attempts before recovery (no retry storm)");
  assertEqual(w.writes.at(-1), { u1: { cc: data.u1.cc } }, "the last write holds the latest state");
}

// ---------------------------------------------------------
section("4–6. Changes while a retry is pending; waiters are released");
{
  const w = setup(["fail", "fail"], "ok");
  const data = { u1: { cc: 1, pokemon: { 25: { normal: 1, shiny: 0 } } } };
  const p1 = enqueueSave(data);
  assertEqual(await within(p1, 500), false, "first caller released after the failure");
  data.u1.cc = 2;
  const p2 = enqueueSave(data); // arrives during backoff
  data.u2 = { cc: 7 };
  const p3 = enqueueSave(data);
  const [r2, r3] = await within(Promise.all([p2, p3]), 1000);
  assertTrue(r2 !== undefined && r3 !== undefined, "callers waiting during the retry are released");
  await sleep(150);
  assertEqual(w.writes.at(-1), { u1: { cc: 2, pokemon: { 25: { normal: 1, shiny: 0 } } }, u2: { cc: 7 } },
    "the eventual write contains every change made during the retry");
  assertEqual(__saveQueueState().pendingWaiters, 0, "no caller is left waiting");
}

// ---------------------------------------------------------
section("8. Retries never mutate player data");
{
  setup(["fail", "fail", "fail"], "ok");
  const data = { a: { cc: 100, tp: 5, pokemon: { 1: { normal: 2, shiny: 0 } }, items: { evolution_stone: 1 } } };
  const before = JSON.stringify(data);
  enqueueSave(data);
  await sleep(400);
  assertEqual(JSON.stringify(data), before, "in-memory data is identical after 3 failed retries and a success");
}

// ---------------------------------------------------------
section("9. Empty or invalid data is refused safely");
{
  const w = setup([], "ok");
  assertEqual(await within(enqueueSave({}), 500), false, "empty object: caller told it was not saved");
  assertEqual(await within(enqueueSave([]), 500), false, "array: caller told it was not saved");
  assertEqual(await within(enqueueSave(null), 500), false, "null: caller told it was not saved");
  await sleep(60);
  assertEqual(w.calls.length, 0, "nothing is written");
}

// ---------------------------------------------------------
section("10. Shutdown with a flush or retry in progress");
{
  // a) A slow write is running when shutdown starts, and newer changes arrive.
  const w = setup([60], "ok");
  const data = { u1: { cc: 1 } };
  enqueueSave(data, { force: true }); // starts the slow write now
  await sleep(10);
  data.u1.cc = 2;
  enqueueSave(data);
  const ok = await shutdownFlush(1000);
  assertEqual(ok, true, "shutdown waits for the running write, then writes newer changes");
  assertEqual(w.writes.at(-1), { u1: { cc: 2 } }, "the last write on disk is the newest state");
}
{
  // b) Shutdown during a backoff forces the write immediately.
  const w = setup(["fail"], "ok");
  __setSaveQueueTestHooks({ timing: { retryBaseMs: 5000, retryMaxMs: 5000 } });
  const data = { u1: { cc: 9 } };
  await within(enqueueSave(data), 500);
  const started = Date.now();
  const ok = await shutdownFlush(1000);
  assertEqual(ok, true, "shutdown ignores the retry backoff");
  assertTrue(Date.now() - started < 500, "and does not wait for the backoff to expire");
  assertEqual(w.writes.at(-1), { u1: { cc: 9 } }, "the data reaches disk");
}
{
  // c) Disk still failing at shutdown: must NOT be reported as saved.
  setup([], "fail");
  const data = { u1: { cc: 3 } };
  await within(enqueueSave(data), 500);
  const ok = await shutdownFlush(300);
  assertEqual(ok, false, "shutdown reports failure when the disk is still failing");
}
{
  // d) Nothing pending: shutdown is a no-op success.
  setup([], "ok");
  assertEqual(await shutdownFlush(200), true, "shutdown with nothing pending returns true");
}

// ---------------------------------------------------------
__resetSaveQueueForTests();
await sleep(50);
section("7. Unhandled rejections");
assertEqual(unhandled, 0, "no unhandled promise rejections during any scenario");

Object.assign(console, original);
finish();
process.exit(0);
