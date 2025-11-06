// ==========================================================
// utils/saveQueue.js
// Save queue with debouncing and serialization
// ==========================================================

import { atomicWriteJson } from "./atomicWrite.js";

// Queue state
let saveQueue = [];
let saveTimer = null;
let isFlushing = false;
let isShuttingDown = false;

// Configuration
const DEBOUNCE_MS = 5000; // 5 seconds debounce by default
const TRAINERDATA_PATH = "./trainerData.json";

/**
 * Enqueue a save operation
 * Debounces and coalesces multiple saves
 * @param {Object} data - Trainer data to save
 * @returns {Promise<Object>} Result of save operation
 */
export async function enqueueSave(data) {
  if (isShuttingDown) {
    throw new Error("Cannot enqueue saves during shutdown");
  }

  return new Promise((resolve, reject) => {
    // Add to queue
    saveQueue.push({ data, resolve, reject });

    // Clear existing timer
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    // Set new debounce timer
    saveTimer = setTimeout(() => {
      processSaveQueue();
    }, DEBOUNCE_MS);
  });
}

/**
 * Process all queued saves
 * Only the latest save is executed (coalescing)
 */
async function processSaveQueue() {
  if (isFlushing || saveQueue.length === 0) {
    return;
  }

  isFlushing = true;
  saveTimer = null;

  // Get all queued items
  const batch = saveQueue.slice();
  saveQueue = [];

  // Use the latest data (all saves have the same data reference typically)
  const latestItem = batch[batch.length - 1];
  const { data } = latestItem;

  try {
    // Perform atomic local save using atomicWriteJson
    await atomicWriteJson(TRAINERDATA_PATH, data);
    console.log(`💾 Queued save: ${Object.keys(data).length} users`);

    // Resolve all promises
    batch.forEach(item => item.resolve({ 
      localSuccess: true,
      errors: []
    }));
  } catch (err) {
    console.error("❌ Save queue processing failed:", err.message);
    // Reject all promises with the same error
    batch.forEach(item => item.reject(err));
  } finally {
    isFlushing = false;

    // If more saves were queued during processing, schedule next batch
    if (saveQueue.length > 0 && !isShuttingDown) {
      saveTimer = setTimeout(() => {
        processSaveQueue();
      }, DEBOUNCE_MS);
    }
  }
}

/**
 * Flush all pending saves with timeout
 * Used during graceful shutdown
 * @param {number} timeoutMs - Maximum time to wait for flush
 * @returns {Promise<boolean>} True if flushed successfully
 */
export async function shutdownFlush(timeoutMs = 10000) {
  isShuttingDown = true;

  // Clear debounce timer and process immediately
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  // Create timeout promise
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve(false), timeoutMs);
  });

  // Create flush promise
  const flushPromise = (async () => {
    while (saveQueue.length > 0 || isFlushing) {
      await processSaveQueue();
      // Small delay to ensure flush completes
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return true;
  })();

  // Race between timeout and flush
  const result = await Promise.race([flushPromise, timeoutPromise]);
  
  if (!result) {
    console.warn("⚠️ Save queue flush timed out");
  } else {
    console.log("✅ Save queue flushed successfully");
  }

  return result;
}

/**
 * Get current queue length (for testing/monitoring)
 * @returns {number} Number of pending saves
 */
export function getQueueLength() {
  return saveQueue.length;
}

/**
 * Check if currently flushing (for testing/monitoring)
 * @returns {boolean} True if flushing
 */
export function isFlushing() {
  return isFlushing;
}
