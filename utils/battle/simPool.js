// ==========================================================
// utils/battle/simPool.js — full-sim fights on worker threads, so a fight
// (about 10 ms with Solid AI, 150 ms or more with an Expert side) never
// blocks the bot's main thread. Same shape as utils/render/renderPool.js,
// minus its queue timeouts: a fight's result is never optional.
//
// simulateLive(input) is what fight runners call: with the full sim off it
// returns today's synchronous result (nothing changes); with it on it
// returns a Promise from the worker. after(value, fn) continues either way,
// so runners stay synchronous with the switch off.
//
// SIM_THREADS (config/fullSim.js): worker count, default 1; 0 runs inline.
// A worker that crashes is replaced, and its job rejects.
// ==========================================================

import { Worker } from "worker_threads";
import { isFullSimEnabled } from "../../config/fullSim.js";
import { simulateBattle, loadFullSim } from "./sim.js";

const WORKER_URL = new URL("./simWorker.js", import.meta.url);
export const DEFAULT_SIM_THREADS = 1;

export function simThreads(env = process.env) {
  const n = Number(env.SIM_THREADS ?? DEFAULT_SIM_THREADS);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 8) : DEFAULT_SIM_THREADS;
}

/** fn(value) now if value is plain, or once it resolves if it's a Promise. */
export const after = (value, fn) => (value && typeof value.then === "function" ? value.then(fn) : fn(value));

/** fn()'s value; if it throws or rejects, undo() runs first and the error still reaches the caller. */
export function undoOnFailure(fn, undo) {
  let value;
  try {
    value = fn();
  } catch (err) {
    undo();
    throw err;
  }
  return value && typeof value.then === "function" ? value.catch((err) => { undo(); throw err; }) : value;
}

const workers = [];
const idle = [];
const queue = [];
const jobs = new Map(); // id → { resolve, reject, worker }
let nextId = 1;

function spawn() {
  const worker = new Worker(WORKER_URL);
  worker.unref(); // an idle pool never keeps the process alive
  worker.on("message", ({ id, result, error }) => {
    const job = jobs.get(id);
    jobs.delete(id);
    if (error) job?.reject(new Error(error)); else job?.resolve(result);
    idle.push(worker);
    pump();
  });
  worker.on("error", (err) => {
    for (const [id, job] of jobs) if (job.worker === worker) { jobs.delete(id); job.reject(err); }
    workers.splice(workers.indexOf(worker), 1);
    const i = idle.indexOf(worker);
    if (i >= 0) idle.splice(i, 1);
    spawn();
    pump();
  });
  workers.push(worker);
  idle.push(worker);
}

function pump() {
  while (idle.length && queue.length) {
    const worker = idle.shift();
    const { id, input, resolve, reject } = queue.shift();
    jobs.set(id, { resolve, reject, worker });
    worker.ref(); // a fight in progress keeps the process alive
    worker.once("message", () => worker.unref());
    worker.postMessage({ id, input });
  }
}

/** One full-sim fight on a worker (inline when SIM_THREADS=0). */
export function simulateAsync(input, { env = process.env } = {}) {
  const threads = simThreads(env);
  if (threads === 0) return loadFullSim().then(() => simulateBattle(input));
  while (workers.length < threads) spawn();
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, input, resolve, reject });
    pump();
  });
}

/**
 * A fight as the runners need it: today's synchronous result with the full
 * sim off; with it on (or input.engine "full"), a Promise from the worker.
 */
export function simulateLive(input, { env = process.env } = {}) {
  const engine = input.engine ?? (isFullSimEnabled(env) ? "full" : "legacy");
  return engine === "full" ? simulateAsync({ ...input, engine }, { env }) : simulateBattle({ ...input, engine });
}

/** Stops every worker (tests, graceful shutdown). */
export async function closeSimPool() {
  const all = workers.splice(0);
  idle.length = 0;
  await Promise.all(all.map((w) => w.terminate()));
}
