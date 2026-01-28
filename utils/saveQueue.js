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
  if (Array.isArray(data)) return false;

  const keys = Object.keys(data);
  if (keys.length < 1) return false;

  return true;
}

// ----------------------------------------------------------
// 💾 Atomic write
// ----------------------------------------------------------
async function atomicWriteJson(json) {
  const jsonString = JSON.stringify(json, null, 2);

  // Avoid unnecessary writes
  if (jsonString === lastJsonString) return;
  lastJsonString = jsonString;

  try {
    // Write temp file
    await fs.writeFile(TEMP_PATH, jsonString, "utf8");

    // Atomic rename (same directory)
    await fs.rename(TEMP_PATH, TRAINERDATA_PATH);
  } catch (err) {
    // Best-effort cleanup of temp file
    try { await fs.unlink(TEMP_PATH); } catch {}
    throw err;
  }
}

// ----------------------------------------------------------
// 🚀 Public: enqueue save
// ----------------------------------------------------------
export function enqueueSave(trainerData) {
  queue = queue
    .then(async () => {
      if (!isTrainerDataSafe(trainerData)) {
        console.warn("⚠️ Refusing save: trainerData appears EMPTY/INVALID");
        return;
      }

      await atomicWriteJson(trainerData);
      console.log("💾 Saved trainerData.json");
    })
    .catch((err) => {
      console.error("❌ Save error:", err);
      // Keep queue alive even after an error
    });

  return queue;
}

// ----------------------------------------------------------
// 🚦 Shutdown flush (SIGINT/SIGTERM)
// ----------------------------------------------------------
export async function shutdownFlush(timeout = 5000) {
  try {
    await Promise.race([
      queue,
      new Promise((resolve) => setTimeout(resolve, timeout)),
    ]);
    return true;
  } catch {
    return false;
  }
}

// Compatibility export
export const saveTrainerDataLocal = enqueueSave;
