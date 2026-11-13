// ==========================================================
// utils/battle/simWorker.js — one sim worker thread (utils/battle/simPool.js).
// It receives { id, input } (simulateBattle's input as plain data) and
// posts back { id, result } or { id, error }.
// ==========================================================

import { parentPort } from "worker_threads";
import { simulateBattle, loadFullSim } from "./sim.js";

await loadFullSim(); // messages wait in the port until the listener below starts it

parentPort.on("message", ({ id, input }) => {
  try {
    parentPort.postMessage({ id, result: simulateBattle(input) });
  } catch (err) {
    parentPort.postMessage({ id, error: String(err?.stack || err) });
  }
});
