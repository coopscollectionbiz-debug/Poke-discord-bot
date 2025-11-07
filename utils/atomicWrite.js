// ==========================================================
// utils/atomicWrite.js
// Atomic filesystem writes with in-process locks
// ==========================================================

import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

// In-process lock set to prevent concurrent writes to the same file
const fileLocks = new Set();

/**
 * Atomic write operation using tmp file + rename
 * Prevents partial writes and corruption
 * @param {string} filePath - Target file path
 * @param {string} content - Content to write
 * @throws {Error} If write fails or file is locked
 */
export async function atomicWrite(filePath, content) {
  const absolutePath = path.resolve(filePath);
  
  // Check for in-process lock
  if (fileLocks.has(absolutePath)) {
    throw new Error(`File is locked: ${filePath}`);
  }

  // Acquire lock
  fileLocks.add(absolutePath);

  try {
    // Create temp file in the same directory to ensure same filesystem
    const dir = path.dirname(absolutePath);
    const ext = path.extname(absolutePath);
    const tmpName = `.${path.basename(absolutePath, ext)}.${randomBytes(6).toString("hex")}${ext}.tmp`;
    const tmpPath = path.join(dir, tmpName);

    try {
      // Write to temp file
      await fs.writeFile(tmpPath, content, "utf8");

      // Atomic rename (overwrites target if exists)
      await fs.rename(tmpPath, absolutePath);
    } catch (err) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tmpPath);
      } catch (cleanupErr) {
        // Log cleanup failures for debugging
        console.debug(`⚠️ Failed to cleanup temp file ${tmpPath}:`, cleanupErr.message);
      }
      throw err;
    }
  } finally {
    // Always release lock
    fileLocks.delete(absolutePath);
  }
}

/**
 * Atomic JSON write operation
 * @param {string} filePath - Target file path
 * @param {*} data - Data to serialize as JSON
 * @throws {Error} If write fails or file is locked
 */
export async function atomicWriteJson(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  await atomicWrite(filePath, json);
}

/**
 * Check if a file is currently locked (for testing)
 * @param {string} filePath - File path to check
 * @returns {boolean} True if locked
 */
export function isLocked(filePath) {
  const absolutePath = path.resolve(filePath);
  return fileLocks.has(absolutePath);
}
