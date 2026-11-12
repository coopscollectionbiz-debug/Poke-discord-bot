// ==========================================================
// tests/saveQueuePrompt.test.js
// Prompt saves (enqueueSave(data, { prompt: true }), used by saveAndAck):
// a player is waiting, so the write happens within milliseconds instead of on
// the background debounce / min-interval timers. Every safety rule still holds:
// the ack is true only after the write, retry backoff is never bypassed, and
// the load gate, fencing and empty-data refusal still refuse.
// Offline: injected writer, no files written.
// ==========================================================

import {
  enqueueSave,
  requireLoadBeforeWrite,
  markLoaded,
  fenceWrites,
  __setSaveQueueTestHooks,
  __resetSaveQueueForTests,
  __saveQueueState,
} from "../utils/saveQueue.js";
import { saveAndAck } from "../utils/saveManager.js";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Background timings scaled down 5× from production (1.5 s / 5 s / 15 s);
// prompt timings are the production values.
const TIMING = { debounceMs: 300, minIntervalMs: 1000, maxWaitMs: 3000, retryBaseMs: 300, retryMaxMs: 1200, promptDebounceMs: 10, promptMinIntervalMs: 150 };

const original = { log: console.log, warn: console.warn, error: console.error };
console.log = (msg, ...rest) => { if (!String(msg).startsWith("💾")) original.log(msg, ...rest); };
console.warn = () => {};
console.error = (msg, ...rest) => { const m = String(msg); if (!m.startsWith("❌ Save") && !m.startsWith("⛔")) original.error(msg, ...rest); };

function makeWriter(plan = []) {
  const w = { writes: [], at: [] };
  w.fn = async (data) => {
    const outcome = plan.length ? plan.shift() : "ok";
    if (typeof outcome === "number") await sleep(outcome);
    if (outcome === "fail") throw new Error("EIO (simulated)");
    w.writes.push(JSON.parse(JSON.stringify(data)));
    w.at.push(Date.now());
  };
  return w;
}
function setup(plan) {
  __resetSaveQueueForTests();
  const w = makeWriter(plan);
  __setSaveQueueTestHooks({ writer: w.fn, timing: TIMING });
  return w;
}
async function timed(p) {
  const a = Date.now();
  const v = await p;
  return { v, ms: Date.now() - a };
}

// ---------------------------------------------------------
section("1. A prompt save is written right away and acknowledged");
{
  const w = setup();
  const data = { u1: { moves: ["tackle"] } };
  const { v, ms } = await timed(enqueueSave(data, { prompt: true }));
  assertEqual(v, true, "resolves true (on disk)");
  assertTrue(ms < 120, `resolves within ~promptDebounce + write (${ms} ms, background debounce is ${TIMING.debounceMs} ms)`);
  assertEqual(w.writes.at(-1), data, "the write contains the change");
  assertEqual(__saveQueueState().promptPending, false, "no prompt left pending after the write");
}

// ---------------------------------------------------------
section("2. A background save keeps the background timers");
{
  setup();
  const { v, ms } = await timed(enqueueSave({ u1: { tp: 1 } }));
  assertEqual(v, true, "resolves true");
  assertTrue(ms >= TIMING.debounceMs - 5, `waits for the debounce (${ms} ms ≥ ${TIMING.debounceMs})`);
}

// ---------------------------------------------------------
section("3. Right after a write, a prompt save waits the prompt interval, not the background one");
{
  const w = setup();
  const data = { u1: { n: 0 } };
  await enqueueSave(data, { prompt: true });
  data.u1.n = 1;
  const { v, ms } = await timed(enqueueSave(data, { prompt: true }));
  assertEqual(v, true, "second prompt save resolves true");
  assertTrue(ms < TIMING.promptMinIntervalMs + 100, `within the prompt interval (${ms} ms; background interval is ${TIMING.minIntervalMs} ms)`);
  const gap = w.at[1] - w.at[0];
  assertTrue(gap >= TIMING.promptMinIntervalMs - 5, `writes still at least ${TIMING.promptMinIntervalMs} ms apart (${gap} ms)`);
  assertEqual(w.writes.at(-1).u1.n, 1, "the second write has the newer value");
}

// ---------------------------------------------------------
section("4. Busy background traffic does not hold a prompt save back");
{
  const w = setup();
  const data = { u1: { tp: 0 }, u2: { moves: [] } };
  const chat = setInterval(() => { data.u1.tp++; enqueueSave(data); }, 40); // every 40 ms < debounce
  await sleep(200);
  data.u2.moves = ["ember"];
  const { v, ms } = await timed(enqueueSave(data, { prompt: true }));
  assertEqual(v, true, "prompt save resolves true while chat keeps saving");
  assertTrue(ms < 250, `resolves quickly (${ms} ms; without prompt it would wait up to maxWait ${TIMING.maxWaitMs} ms)`);
  assertEqual(w.writes.at(-1).u2.moves, ["ember"], "the write has the player's change");
  // Afterwards the background saves fall back to the background timing.
  const before = w.writes.length;
  await sleep(600);
  clearInterval(chat);
  assertTrue(w.writes.length - before <= 1, `background saves are not written at prompt speed (${w.writes.length - before} writes in 600 ms)`);
  await sleep(TIMING.maxWaitMs + 200);
}

// ---------------------------------------------------------
section("5. Simultaneous prompt saves share one write");
{
  const w = setup();
  const data = { u1: {} };
  const all = await Promise.all(Array.from({ length: 10 }, (_, i) => { data[`p${i}`] = { x: i }; return enqueueSave(data, { prompt: true }); }));
  assertTrue(all.every((x) => x === true), "all 10 callers resolve true");
  assertEqual(w.writes.length, 1, "one write covered all 10 changes");
  assertEqual(Object.keys(w.writes[0]).length, 11, "the write contains every change");
}

// ---------------------------------------------------------
section("6. A prompt save arriving during a running write is written right after it");
{
  const w = setup([120, "ok"]);
  const data = { u1: { n: 0 } };
  const first = enqueueSave(data, { prompt: true });
  await sleep(40); // the first write is now running (120 ms)
  data.u1.n = 1;
  const { v, ms } = await timed(enqueueSave(data, { prompt: true }));
  assertEqual(await first, true, "the first caller resolves true");
  assertEqual(v, true, "the second caller resolves true");
  assertEqual(w.writes.length, 2, "two writes");
  assertEqual(w.writes[1].u1.n, 1, "the second write has the change made during the first");
  assertTrue(ms < 120 + TIMING.promptMinIntervalMs + 100, `second caller waited ${ms} ms (first write + the ${TIMING.promptMinIntervalMs} ms prompt interval, no background delay)`);
}

// ---------------------------------------------------------
section("7. A failed write: the caller gets false and the retry backoff is NOT bypassed");
{
  const w = setup(["fail"]);
  const data = { u1: { n: 1 } };
  const first = await timed(enqueueSave(data, { prompt: true }));
  assertEqual(first.v, false, "caller released with false (not reported as saved)");
  const retryAt = __saveQueueState().retryNotBefore;
  assertTrue(retryAt > Date.now(), "a retry is scheduled with backoff");
  data.u1.n = 2;
  const second = await timed(enqueueSave(data, { prompt: true }));
  const wroteAt = w.at[0];
  assertEqual(second.v, true, "the next prompt save resolves true once the retry succeeds");
  assertTrue(wroteAt >= retryAt - 5, `the write waited out the backoff (wrote ${wroteAt - retryAt} ms after retryNotBefore)`);
  assertEqual(w.writes.length, 1, "exactly one successful write");
  assertEqual(w.writes[0].u1.n, 2, "it carries the newest data");
}

// ---------------------------------------------------------
section("8. Prompt saves are still refused by the load gate, fencing and empty data");
{
  const w = setup();
  requireLoadBeforeWrite();
  assertEqual(await enqueueSave({ u1: {} }, { prompt: true }), false, "before markLoaded(): refused with false");
  markLoaded();
  assertEqual(await enqueueSave({}, { prompt: true }), false, "empty data: refused with false");
  assertEqual(await enqueueSave({ u1: {} }, { prompt: true }), true, "after markLoaded(): written");
  fenceWrites("test: newer epoch");
  assertEqual(await enqueueSave({ u1: { n: 9 } }, { prompt: true }), false, "fenced: refused with false");
  assertEqual(w.writes.length, 1, "nothing written while gated, empty or fenced");
}

// ---------------------------------------------------------
section("9. saveAndAck (dashboard and command replies) uses the prompt path");
{
  const w = setup();
  const { v, ms } = await timed(saveAndAck({ u1: { team: [1] } }));
  assertEqual(v, { saved: true, note: "" }, "acknowledged as saved");
  assertTrue(ms < 120, `quick (${ms} ms)`);
  assertEqual(w.writes.length, 1, "written once");
}

__resetSaveQueueForTests();
console.log = original.log;
console.warn = original.warn;
console.error = original.error;
finish();
