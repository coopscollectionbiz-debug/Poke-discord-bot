// ==========================================================
// utils/saveQueue.js (FINAL SAFE VERSION)
// ==========================================================
// • The ONLY place where trainerData.json is written
// • Atomic: temp → rename to prevent corruption
// • Serialized queue so writes never overlap
// • NEVER writes empty or tiny objects
// • All other code should call enqueueSave(trainerData)
// ==========================================================

import fs from "fs/promises";
import path from "path";

const TRAINERDATA_PATH = path.resolve("./trainerData.json");
const TEMP_PATH = path.resolve("./trainerData.json.tmp");

let queue = Promise.resolve();
let lastJsonString = null;

// ----------------------------------------------------------
// 🛡️ Schema validator (prevents corrupted saves)
// ----------------------------------------------------------
function isTrainerDataValid(data) {
  if (!data || typeof data !== "object") return false;

  const keys = Object.keys(data);
  if (keys.length < 1) return false;

  for (const [id, user] of Object.entries(data)) {
    if (!user || typeof user !== "object") return false;
    if (typeof user.tp !== "number") return false;
    if (typeof user.cc !== "number") return false;
    if (typeof user.pokemon !== "object") return false;
    if (!user.trainers || typeof user.trainers !== "object") return false;
  }

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

  // Write to temp
  await fs.writeFile(TEMP_PATH, jsonString, "utf8");

  // Replace original (atomic on most filesystems)
  await fs.rename(TEMP_PATH, TRAINERDATA_PATH);
}

// ----------------------------------------------------------
// 🚀 Public: enqueue save
// ----------------------------------------------------------
export function enqueueSave(trainerData) {
  queue = queue.then(async () => {
    if (!isTrainerDataValid(trainerData)) {
      console.warn("⚠️ Refusing invalid trainerData save");
      return;
    }

    // Write trainerData.json atomically
    await atomicWriteJson(TRAINERDATA_PATH, trainerData);

    // Mark bot_final.js as dirty so 15-minute backups fire
    if (global.markDirty) global.markDirty();

    console.log("💾 Saved trainerData.json (dirty flag set)");
  }).catch(err => console.error("❌ Save error:", err));

  return queue;
}

// ----------------------------------------------------------
// 🚦 Shutdown flush (used on SIGINT)
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
