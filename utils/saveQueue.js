// ==========================================================
// utils/saveQueue.js — COALESCED SAFE VERSION (VERSION-SAFE)
// ==========================================================
// • Callers keep using: await enqueueSave(trainerData)
// • Coalesces many calls into one write
// • Stringify happens ONLY during flush (not per call)
// • Min write interval prevents save storms
// • Atomic: tmp -> rename
// • FIX: version counter prevents dropping updates during flush
// • Failed writes: callers are released with `false` (never hang, never
//   reject) and the save is retried with exponential backoff that neither
//   new saves nor the max-wait timer can bypass. Forced flushes (shutdown,
//   battles) ignore the backoff.
// ==========================================================

import fs from "fs/promises";
import path from "path";

const TRAINERDATA_PATH = path.resolve("./trainerData.json");
const TEMP_PATH = path.resolve("./trainerData.json.tmp");

// Tune these (tests may override through __setSaveQueueTestHooks):
const DEFAULT_TIMING = {
  debounceMs: 1500,      // wait this long after the LAST request
  minIntervalMs: 5000,   // never write more often than this
  maxWaitMs: 15000,      // guarantee a write within this window
  retryBaseMs: 1000,     // first retry after a failed write
  retryMaxMs: 30_000,    // retries never wait longer than this
};
let timing = { ...DEFAULT_TIMING };

let lastWriteAt = 0;

// Latest data pointer we should write (usually trainerData reference)
let latestData = null;

// Dirty tracking (FIX)
let dirtyVersion = 0;
let flushedVersion = 0;

let flushTimer = null;
let maxWaitTimer = null;
let flushing = null; // Promise of the in-progress write, or null

// Retry state after failed writes
let consecutiveFailures = 0;
let retryNotBefore = 0;

// Promise that resolves when the requested version has been flushed
const waiters = new Map(); // version -> [resolve,...]

// ----------------------------------------------------------
// 🛡️ Minimal validity check: only reject EMPTY data
// ----------------------------------------------------------
function isTrainerDataSafe(data) {
  if (!data || typeof data !== "object") return false;
  if (Array.isArray(data)) return false;
  return Object.keys(data).length >= 1;
}

// ----------------------------------------------------------
// 💾 Atomic write (stringify only here)
// ----------------------------------------------------------
async function atomicWriteJson(json) {
  const jsonString = JSON.stringify(json, null, 2);
  try {
    await fs.writeFile(TEMP_PATH, jsonString, "utf8");
    await fs.rename(TEMP_PATH, TRAINERDATA_PATH);
  } catch (err) {
    try { await fs.unlink(TEMP_PATH); } catch {}
    throw err;
  }
}
let writeJson = atomicWriteJson;

// Waiters resolve with true when their version reached disk, false when the
// write failed or was refused. They never reject and never hang: callers
// await enqueueSave() inside lockUser, so a pending promise would keep that
// user locked until restart.
function resolveWaitersUpTo(version, saved = true) {
  for (const [v, resolvers] of waiters) {
    if (v <= version) {
      for (const r of resolvers) {
        try { r(saved); } catch {}
      }
      waiters.delete(v);
    }
  }
}

/** Retry delay after the Nth consecutive failure (1-based): base, 2×base, 4×base … capped. */
export function retryDelayMs(failures, base = timing.retryBaseMs, max = timing.retryMaxMs) {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(max, base * 2 ** Math.min(n - 1, 30));
}

function clearTimers() {
  try { clearTimeout(flushTimer); } catch {}
  try { clearTimeout(maxWaitTimer); } catch {}
  flushTimer = null;
  maxWaitTimer = null;
}

// ----------------------------------------------------------
// 🚀 Core flush
// ----------------------------------------------------------
function flushNow({ force = false } = {}) {
  // If a flush is already running, don't start another; the running one
  // reschedules itself if more changes arrived meanwhile.
  if (flushing) return flushing;

  // Nothing to do
  if (!latestData) return Promise.resolve();

  const now = Date.now();

  // After a failed write, wait out the backoff unless forced.
  if (!force && now < retryNotBefore) {
    scheduleFlush(retryNotBefore - now);
    return Promise.resolve();
  }

  // Rate limit disk writes unless forced
  const sinceLast = now - lastWriteAt;
  if (!force && sinceLast < timing.minIntervalMs) {
    scheduleFlush(Math.max(250, timing.minIntervalMs - sinceLast));
    return Promise.resolve();
  }

  // Snapshot current dirty version + data ref
  const startVersion = dirtyVersion;
  const dataToWrite = latestData;

  if (!isTrainerDataSafe(dataToWrite)) {
    console.warn("⚠️ Refusing save: trainerData appears EMPTY/INVALID");
    // Nothing is written; callers are told the save did not happen.
    latestData = null;
    clearTimers();
    resolveWaitersUpTo(startVersion, false);
    return Promise.resolve();
  }

  // Clear timers while we flush
  clearTimers();

  flushing = (async () => {
    let failed = false;
    try {
      await writeJson(dataToWrite);
      lastWriteAt = Date.now();
      flushedVersion = startVersion;
      consecutiveFailures = 0;
      retryNotBefore = 0;
      console.log("💾 Saved trainerData.json");

      // Resolve anyone waiting for <= flushedVersion
      resolveWaitersUpTo(flushedVersion, true);
    } catch (err) {
      failed = true;
      console.error("❌ Save error:", err?.message || err);
    } finally {
      flushing = null;

      if (failed) {
        // Release callers (the change is still in memory and still dirty),
        // keep latestData, and retry with backoff until a write succeeds.
        resolveWaitersUpTo(startVersion, false);
        consecutiveFailures++;
        const delay = retryDelayMs(consecutiveFailures);
        retryNotBefore = Date.now() + delay;
        console.warn(`⏳ Save retry #${consecutiveFailures} in ${delay}ms`);
        scheduleFlush(delay);
      } else if (dirtyVersion === startVersion) {
        // ✅ Only clear latestData if NOTHING changed during flush
        latestData = null;
      } else {
        // Changes arrived during the flush: write them soon.
        scheduleFlush(250);
      }
    }
  })();

  return flushing;
}

// ----------------------------------------------------------
// 🕒 Scheduler (debounce + max-wait)
// ----------------------------------------------------------
function scheduleFlush(delayMs = timing.debounceMs) {
  // While backing off, nothing may fire earlier than the retry time.
  const minDelay = Math.max(0, retryNotBefore - Date.now());
  const delay = Math.max(delayMs, minDelay);

  try { clearTimeout(flushTimer); } catch {}
  flushTimer = setTimeout(() => {
    flushNow().catch(() => {});
  }, delay);

  // Guarantee we flush within maxWaitMs of first dirty mark
  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = null;
      flushNow().catch(() => {});
    }, Math.max(timing.maxWaitMs, minDelay));
  }
}

// ----------------------------------------------------------
// ✅ Public API: enqueue save (fast, coalesced, awaitable)
// Resolves true once this change is on disk, false if the write failed
// or was refused (the change stays in memory and is retried).
// ----------------------------------------------------------
export function enqueueSave(trainerData, opts = {}) {
  // Refuse empty/invalid data up front: never let it replace a pending
  // valid save, and never leave the caller waiting.
  if (!isTrainerDataSafe(trainerData)) {
    console.warn("⚠️ Refusing save: trainerData appears EMPTY/INVALID");
    return Promise.resolve(false);
  }

  latestData = trainerData;
  dirtyVersion++;

  const myVersion = dirtyVersion;

  const p = new Promise((resolve) => {
    const arr = waiters.get(myVersion) || [];
    arr.push(resolve);
    waiters.set(myVersion, arr);
  });

  // Debounce
  scheduleFlush(timing.debounceMs);

  // Force immediate flush (ignores the min interval and retry backoff)
  if (opts?.force) {
    flushNow({ force: true }).catch(() => {});
  }

  return p;
}

// ----------------------------------------------------------
// 🚦 Shutdown flush (SIGINT/SIGTERM)
// Waits for any in-progress write, then force-writes whatever is still
// dirty. Returns true only if every change is on disk within `timeout`.
// ----------------------------------------------------------
export async function shutdownFlush(timeout = 8000) {
  const deadline = Date.now() + timeout;
  const timeLeft = () => Math.max(0, deadline - Date.now());
  const within = (p) =>
    Promise.race([p, new Promise((resolve) => setTimeout(resolve, timeLeft()))]);

  try {
    // Finish the running write, then force-write newer changes (bounded passes).
    for (let pass = 0; pass < 3 && timeLeft() > 0; pass++) {
      if (flushing) await within(flushing);
      if (flushedVersion >= dirtyVersion) break;
      if (!latestData) break; // refused (empty) — nothing writable
      await within(flushNow({ force: true }));
    }
  } catch {
    // fall through to the durability check
  }

  const durable = flushedVersion >= dirtyVersion;
  if (durable) clearTimers();
  return durable;
}

// ----------------------------------------------------------
// 🧪 Test hooks (no effect unless called)
// ----------------------------------------------------------
export function __setSaveQueueTestHooks({ writer, timing: t } = {}) {
  if (writer) writeJson = writer;
  if (t) timing = { ...timing, ...t };
}

export function __resetSaveQueueForTests() {
  clearTimers();
  writeJson = atomicWriteJson;
  timing = { ...DEFAULT_TIMING };
  lastWriteAt = 0;
  latestData = null;
  dirtyVersion = 0;
  flushedVersion = 0;
  flushing = null;
  consecutiveFailures = 0;
  retryNotBefore = 0;
  resolveWaitersUpTo(Infinity, false);
}

export function __saveQueueState() {
  return {
    dirtyVersion,
    flushedVersion,
    consecutiveFailures,
    retryNotBefore,
    flushing: !!flushing,
    pendingWaiters: [...waiters.values()].reduce((n, a) => n + a.length, 0),
  };
}

// Compatibility export
export const saveTrainerDataLocal = enqueueSave;
