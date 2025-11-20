// ==========================================================
// utils/saveQueue.js (SAFE VERSION — CORRUPTION PROOF)
// ==========================================================
// • Prevents empty saves
// • Prevents partial trainerData wipes
// • Never writes {} or tiny objects
// • Serialized save queue with write lock
// • Atomic temp → replace write to prevent file corruption
// ==========================================================

import fs from "fs/promises";
import path from "path";

const TRAINERDATA_PATH = path.resolve("./trainerData.json");
const TEMP_PATH = path.resolve("./trainerData.json.tmp");

let saveQueue = [];
let isProcessing = false;

// ==========================================================
// 🔒 VALIDATION RULES
// ==========================================================

function isTrainerDataValid(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;

  const keys = Object.keys(data);

  // Reject completely empty saves
  if (keys.length === 0) return false;

  // Reject partial loads — your real trainerData normally has 200+ entries
  if (keys.length < 20) {
    console.error(`⛔ BLOCKED SAVE — trainerData has too few users (${keys.length})`);
    return false;
  }

  // Per-user sanity checks
  for (const [id, user] of Object.entries(data)) {
    if (!user || typeof user !== "object") return false;

    // Required fields
    if (typeof user.cc !== "number") return false;
    if (typeof user.tp !== "number") return false;
    if (typeof user.pokemon !== "object") return false;

    // If any user has a broken trainers list → invalid save
    if (!user.trainers || typeof user.trainers !== "object") return false;
  }

  return true;
}

// ==========================================================
// 💾 Atomic write (never writes empty data)
// ==========================================================
async function atomicWriteJson(filePath, json) {
  const jsonString = JSON.stringify(json, null, 2);

  // DO NOT WRITE `{}` EVER
  if (jsonString.trim() === "{}") {
    throw new Error("Refusing to write EMPTY trainerData.json");
  }

  // Write to temp file first
  await fs.writeFile(TEMP_PATH, jsonString);
  // Replace original in one atomic move
  await fs.rename(TEMP_PATH, filePath);
}

// ==========================================================
// 🚀 Queue processor
// ==========================================================
async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  while (saveQueue.length > 0) {
    const data = saveQueue.shift();

    try {
      if (!isTrainerDataValid(data)) {
        console.error("⛔ Save skipped — trainerData INVALID or too small.");
        continue;
      }

      await atomicWriteJson(TRAINERDATA_PATH, data);
      console.log("💾 trainerData.json saved safely");
    } catch (err) {
      console.error("❌ Save failed:", err.message);
    }
  }

  isProcessing = false;
}

// ==========================================================
// 📥 Public enqueue function
// ==========================================================
export async function enqueueSave(data) {
  // Reject invalid or empty data
  if (!isTrainerDataValid(data)) {
    console.error("⛔ enqueueSave BLOCKED — invalid trainerData");
    return;
  }

  saveQueue.push(data);
  processQueue();
}

// ==========================================================
// 🔄 saveTrainerDataLocal — wrapper for codebase compatibility
// ==========================================================
export async function saveTrainerDataLocal(trainerData) {
  await enqueueSave(trainerData);
}

// ==========================================================
// 🛑 Shutdown flush (optional)
// ==========================================================
export async function shutdownFlush(timeout = 5000) {
  const start = Date.now();

  while ((isProcessing || saveQueue.length > 0) &&
         Date.now() - start < timeout) {
    await new Promise(res => setTimeout(res, 100));
  }

  return !(isProcessing || saveQueue.length > 0);
}
