// ==========================================================
// utils/render/renderPool.js
// Renders images on worker threads, so drawing and GIF encoding (0.3–1 s
// per animated card or battle turn) never block the bot's main thread:
// commands, buttons and dashboard saves keep being served while images
// are built.
//
// RENDER_THREADS sets the thread count (default 3, sized for the VPS,
// which also runs the WoW server: tools/bench-render-threads.mjs).
// RENDER_THREADS=0 renders on the main thread, as before.
//
// A job names a renderer in utils/render/renderers.js and passes its
// arguments, which must be plain data (structured clone). Jobs run in
// order; `priority` puts one at the front of the line. With `waitMs`, a
// job that hasn't started within that time is dropped and rejects with
// code RENDER_QUEUE_TIMEOUT (cards then send a still image instead).
// A thread that crashes is replaced, and its job rejects. If threads keep
// failing to start, the pool shuts itself off and callers render on the
// main thread (code RENDER_POOL_DOWN).
// ==========================================================

import { Worker, isMainThread } from "worker_threads";
import { AsyncLocalStorage } from "async_hooks";

const WORKER_URL = new URL("./renderWorker.js", import.meta.url);
export const DEFAULT_RENDER_THREADS = 3;
const MAX_START_FAILURES = 3;

/** Per-call pool options (cardImage sets { waitMs } / { priority }). */
export const renderOptions = new AsyncLocalStorage();

function codedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** RENDER_THREADS as a count: unset → default, invalid or < 0 → 0 (off). */
export function renderThreadCount(env = process.env) {
  const raw = env.RENDER_THREADS;
  if (raw === undefined || raw === "") return DEFAULT_RENDER_THREADS;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 16) : 0;
}

export function createRenderPool({ size, workerUrl = WORKER_URL, workerData = null, log = console.log } = {}) {
  const threads = new Set();
  const idle = [];
  const queue = [];
  const jobs = new Map(); // id -> { resolve, reject, thread }
  let nextId = 1;
  let startFailures = 0;
  let down = null;
  let closed = false;
  const stats = { completed: 0, failed: 0, queueTimeouts: 0, crashes: 0, peakQueued: 0 };

  const failAll = (err) => {
    for (const job of queue.splice(0)) {
      clearTimeout(job.timer);
      job.reject(err);
    }
  };

  // Threads keep the process alive only while there is work in hand, so a
  // script (or test) that is done can exit with the threads still idle.
  const updateRefs = () => {
    const busy = queue.length > 0 || jobs.size > 0;
    for (const t of threads) (busy ? t.worker.ref() : t.worker.unref());
  };

  const pump = () => {
    while (idle.length && queue.length) {
      const thread = idle.pop();
      const job = queue.shift();
      clearTimeout(job.timer);
      jobs.set(job.id, { resolve: job.resolve, reject: job.reject, thread });
      thread.job = job.id;
      try {
        thread.worker.postMessage({ id: job.id, name: job.name, args: job.args });
      } catch (err) {
        // Arguments that can't be cloned: give the thread back, fail the job.
        jobs.delete(job.id);
        thread.job = null;
        idle.push(thread);
        job.reject(err);
      }
    }
    updateRefs();
  };

  const spawn = () => {
    if (closed || down) return;
    const worker = new Worker(workerUrl, { workerData });
    const thread = { worker, ready: false, job: null };
    threads.add(thread);
    updateRefs();
    worker.on("message", (msg) => {
      if (msg.ready) {
        thread.ready = true;
        startFailures = 0;
        idle.push(thread);
        pump();
        return;
      }
      const job = jobs.get(msg.id);
      jobs.delete(msg.id);
      thread.job = null;
      idle.push(thread);
      if (job) {
        if (msg.error) {
          stats.failed++;
          const err = new Error(msg.error);
          err.code = msg.code;
          job.reject(err);
        } else {
          stats.completed++;
          job.resolve(Buffer.from(msg.bytes));
        }
      }
      pump();
    });
    const lost = (reason) => {
      if (!threads.has(thread)) return;
      threads.delete(thread);
      const at = idle.indexOf(thread);
      if (at >= 0) idle.splice(at, 1);
      if (thread.job != null) {
        const job = jobs.get(thread.job);
        jobs.delete(thread.job);
        job?.reject(codedError(`render thread crashed: ${reason}`, "RENDER_THREAD_CRASHED"));
      }
      if (closed) return;
      stats.crashes++;
      if (!thread.ready && ++startFailures >= MAX_START_FAILURES) {
        down = `render threads failed to start ${startFailures} times (${reason})`;
        log(`⚠️ ${down}; rendering on the main thread from now on`);
        failAll(codedError(down, "RENDER_POOL_DOWN"));
        return;
      }
      log(`⚠️ render thread lost (${reason}); starting a new one`);
      spawn();
    };
    worker.on("error", (err) => lost(err?.message || String(err)));
    worker.on("exit", (code) => lost(`exit ${code}`));
  };

  for (let i = 0; i < size; i++) spawn();

  return {
    size,
    /** Renders `name(...args)` on a thread. → Promise<Buffer> */
    run(name, args, { waitMs = null, priority = false } = {}) {
      if (down) return Promise.reject(codedError(down, "RENDER_POOL_DOWN"));
      if (closed) return Promise.reject(codedError("render pool closed", "RENDER_POOL_DOWN"));
      return new Promise((resolve, reject) => {
        const job = { id: nextId++, name, args, resolve, reject, timer: null };
        if (waitMs != null) {
          job.timer = setTimeout(() => {
            const at = queue.indexOf(job);
            if (at < 0) return; // already started
            queue.splice(at, 1);
            stats.queueTimeouts++;
            updateRefs();
            reject(codedError(`no render thread free within ${waitMs} ms`, "RENDER_QUEUE_TIMEOUT"));
          }, waitMs);
          job.timer.unref?.();
        }
        if (priority) queue.unshift(job);
        else queue.push(job);
        stats.peakQueued = Math.max(stats.peakQueued, queue.length);
        pump();
      });
    },
    status() {
      return {
        threads: size,
        alive: threads.size,
        busy: jobs.size,
        queued: queue.length,
        down,
        ...stats,
      };
    },
    async close() {
      closed = true;
      failAll(codedError("render pool closed", "RENDER_POOL_DOWN"));
      await Promise.all([...threads].map((t) => t.worker.terminate()));
    },
  };
}

let shared; // undefined: not created yet; null: off
/** The bot's pool, created on first use; null when RENDER_THREADS=0 or on a worker. */
export function getRenderPool(env = process.env) {
  if (shared !== undefined) return shared;
  const size = isMainThread ? renderThreadCount(env) : 0;
  shared = size > 0 ? createRenderPool({ size }) : null;
  if (shared) console.log(`🧵 Rendering on ${size} thread${size === 1 ? "" : "s"}`);
  return shared;
}

/** The shared pool's status for /readyz (null when off or not yet used). */
export function renderPoolStatus() {
  return shared ? shared.status() : null;
}

/**
 * Wraps a renderer so it runs on the pool. `name` is its key in
 * utils/render/renderers.js; `direct` is the same function, used when the
 * pool is off or down, or when the arguments can't be sent to a thread.
 * `prepare` turns the call's arguments into what's sent (plain data).
 */
export function threaded(name, direct, { prepare = (args) => args, pool = getRenderPool } = {}) {
  let warned = false;
  return async (...args) => {
    const p = pool();
    if (!p) return direct(...args);
    try {
      return await p.run(name, prepare(args), renderOptions.getStore() ?? {});
    } catch (err) {
      if (err?.code === "RENDER_POOL_DOWN" || err?.name === "DataCloneError") {
        if (err?.name === "DataCloneError" && !warned) {
          warned = true;
          console.warn(`⚠️ ${name} arguments can't go to a render thread; rendering on the main thread:`, err.message);
        }
        return direct(...args);
      }
      throw err;
    }
  };
}
