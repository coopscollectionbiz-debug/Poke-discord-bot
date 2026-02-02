// ==========================================================
// utils/saveQueue.js — COALESCED SAFE VERSION (VERSION-SAFE)
// ==========================================================
// • Callers keep using: await enqueueSave(trainerData)
// • Coalesces many calls into one write
// • Stringify happens ONLY during flush (not per call)
// • Min write interval prevents save storms
// • Atomic: tmp -> rename
// • FIX: version counter prevents dropping updates during flush
// ==========================================================

import fs from "fs/promises";
import path from "path";

const TRAINERDATA_PATH = path.resolve("./trainerData.json");
const TEMP_PATH = path.resolve("./trainerData.json.tmp");

// Tune these:
const SAVE_DEBOUNCE_MS = 1500;     // wait this long after the LAST request
const SAVE_MIN_INTERVAL_MS = 5000; // never write more often than this
const SAVE_MAX_WAIT_MS = 15000;    // guarantee a write within this window

let lastWriteAt = 0;

// Latest data pointer we should write (usually trainerData reference)
let latestData = null;

// Dirty tracking (FIX)
let dirtyVersion = 0;
let flushedVersion = 0;

let flushTimer = null;
let maxWaitTimer = null;
let flushing = false;

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
  await fs.writeFile(TEMP_PATH, jsonString, "utf8");
  await fs.rename(TEMP_PATH, TRAINERDATA_PATH);
}

function resolveWaitersUpTo(version) {
  for (const [v, resolvers] of waiters) {
    if (v <= version) {
      for (const r of resolvers) {
        try { r(); } catch {}
      }
      waiters.delete(v);
    }
  }
}

// ----------------------------------------------------------
// 🚀 Core flush
// ----------------------------------------------------------
async function flushNow({ force = false } = {}) {
  // If a flush is already running, just return
  if (flushing) return;

  // Nothing to do
  if (!latestData) return;

  // Rate limit disk writes unless forced
  const now = Date.now();
  const sinceLast = now - lastWriteAt;
  if (!force && sinceLast < SAVE_MIN_INTERVAL_MS) {
    scheduleFlush(Math.max(250, SAVE_MIN_INTERVAL_MS - sinceLast));
    return;
  }

  // Snapshot current dirty version + data ref
  const startVersion = dirtyVersion;
  const dataToWrite = latestData;

  if (!isTrainerDataSafe(dataToWrite)) {
    console.warn("⚠️ Refusing save: trainerData appears EMPTY/INVALID");
    // Do NOT clear dirtyVersion; keep dirty so next enqueue can retry
    latestData = null;
    return;
  }

  flushing = true;

  // Clear timers while we flush
  try { clearTimeout(flushTimer); } catch {}
  try { clearTimeout(maxWaitTimer); } catch {}
  flushTimer = null;
  maxWaitTimer = null;

  try {
    await atomicWriteJson(dataToWrite);
    lastWriteAt = Date.now();
    flushedVersion = startVersion;
    console.log("💾 Saved trainerData.json");

    // Resolve anyone waiting for <= flushedVersion
    resolveWaitersUpTo(flushedVersion);
  } catch (err) {
    console.error("❌ Save error:", err?.message || err);
    try { await fs.unlink(TEMP_PATH); } catch {}
  } finally {
    flushing = false;

    // ✅ Only clear latestData if NOTHING changed during flush
    // If dirtyVersion advanced while we flushed, keep latestData
    // and schedule another flush soon.
    if (dirtyVersion === startVersion) {
      latestData = null;
    } else {
      scheduleFlush(250);
    }
  }
}

// ----------------------------------------------------------
// 🕒 Scheduler (debounce + max-wait)
// ----------------------------------------------------------
function scheduleFlush(delayMs = SAVE_DEBOUNCE_MS) {
  try { clearTimeout(flushTimer); } catch {}
  flushTimer = setTimeout(() => {
    flushNow().catch(() => {});
  }, delayMs);

  // Guarantee we flush within SAVE_MAX_WAIT_MS of first dirty mark
  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      flushNow().catch(() => {});
    }, SAVE_MAX_WAIT_MS);
  }
}

// ----------------------------------------------------------
// ✅ Public API: enqueue save (fast, coalesced, awaitable)
// ----------------------------------------------------------
export function enqueueSave(trainerData, opts = {}) {
  latestData = trainerData;
  dirtyVersion++;

  const myVersion = dirtyVersion;

  // Return a promise that resolves when myVersion is flushed
  const p = new Promise((resolve) => {
    const arr = waiters.get(myVersion) || [];
    arr.push(resolve);
    waiters.set(myVersion, arr);
  });

  // Debounce
  scheduleFlush(SAVE_DEBOUNCE_MS);

  // Force immediate flush (still respects MIN interval unless you want it to ignore)
  if (opts?.force) {
    flushNow({ force: true }).catch(() => {});
  }

  return p;
}

// ----------------------------------------------------------
// 🚦 Shutdown flush (SIGINT/SIGTERM)
// ----------------------------------------------------------
export async function shutdownFlush(timeout = 8000) {
  try {
    await Promise.race([
      flushNow({ force: true }),
      new Promise((resolve) => setTimeout(resolve, timeout)),
    ]);
    return true;
  } catch {
    return false;
  }
}

// Compatibility export
export const saveTrainerDataLocal = enqueueSave;
