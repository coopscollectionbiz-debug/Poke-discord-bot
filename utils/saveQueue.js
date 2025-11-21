// ==========================================================
// utils/saveQueue.js — FINAL SAFE VERSION (Schema-Agnostic)
// ==========================================================
// • The ONLY place where trainerData.json is written
// • Atomic: temp → rename (no corruption)
// • Serialized queue so writes never overlap
// • Never rejects saves based on schema (saveManager handles that)
// ==========================================================

import fs from "fs/promises";
import path from "path";

const TRAINERDATA_PATH = path.resolve("./trainerData.json");
const TEMP_PATH = path.resolve("./trainerData.json.tmp");

let queue = Promise.resolve();
let lastJsonString = null;

// ----------------------------------------------------------
// 🛡️ Minimal validity check: only reject EMPTY data
// ----------------------------------------------------------
function isTrainerDataSafe(data) {
  if (!data || typeof data !== "object") return false;

  const keys = Object.keys(data);
  if (keys.length < 1) return false;

  return true;
}

// ----------------------------------------------------------
// 💾 Atomic write
// ----------------------------------------------------------
async function atomicWriteJson(filePath, json) {
  const jsonString = JSON.stringify(json, null, 2);

  // Avoid unnecessary writes
  if (jsonString === lastJsonString) return;
  lastJsonString = jsonString;

  // Write temp file
  await fs.writeFile(TEMP_PATH, jsonString, "utf8");

  // Atomic rename
  await fs.rename(TEMP_PATH, TRAINERDATA_PATH);
}

// ----------------------------------------------------------
// 🚀 Public: enqueue save
// ----------------------------------------------------------
export function enqueueSave(trainerData) {
  queue = queue.then(async () => {

    if (!isTrainerDataSafe(trainerData)) {
      console.warn("⚠️ Refusing save: trainerData appears EMPTY");
      return;
    }

    await atomicWriteJson(TRAINERDATA_PATH, trainerData);
    console.log("💾 Saved trainerData.json");

  }).catch(err => console.error("❌ Save error:", err));

  return queue;
}

// ----------------------------------------------------------
// 🚦 Shutdown flush (SIGINT)
// ----------------------------------------------------------
export async function shutdownFlush(timeout = 5000) {
  let done = false;

  queue.then(() => done = true);

  const start = Date.now();
  while (!done && Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 50));
  }

  return done;
}

// Compatibility export
export const saveTrainerDataLocal = enqueueSave;
