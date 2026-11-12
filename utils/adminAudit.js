// ==========================================================
// utils/adminAudit.js — permanent record of Admin changes.
//
// One NDJSON line per change per player, in TRAINERDATA_DIR next to
// trainerData.json (the Fly volume). Unlike utils/eventLog.js this file is
// never pruned: it is the only history of what admins changed and why.
// *.ndjson is git-ignored, so player data in it never reaches the repo.
// ==========================================================

import fs from "fs/promises";
import path from "path";

export const auditPath = () => path.join(process.env.TRAINERDATA_DIR || ".", "admin-audit.ndjson");

/**
 * Append entries. Returns { ok } and never throws; the caller reports a
 * failure to the admin (the change itself has already been saved).
 * @param {object[]} entries
 */
export async function appendAudit(entries) {
  const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
  if (!list.length) return { ok: true };
  try {
    await fs.appendFile(auditPath(), list.map((e) => JSON.stringify({ at: Date.now(), ...e })).join("\n") + "\n", "utf8");
    return { ok: true };
  } catch (err) {
    console.warn("⚠️ admin audit write failed:", err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Read entries, newest first.
 * @param {{ userId?: string, adminId?: string, batchId?: string, limit?: number, offset?: number }} [filters]
 */
export async function readAudit({ userId = null, adminId = null, batchId = null, limit = 100, offset = 0 } = {}) {
  let raw;
  try {
    raw = await fs.readFile(auditPath(), "utf8");
  } catch (err) {
    if (err?.code !== "ENOENT") console.warn("⚠️ admin audit read failed:", err?.message || err);
    return { total: 0, entries: [] };
  }
  const matched = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // a torn last line
    }
    if (userId && e.userId !== userId) continue;
    if (adminId && e.adminId !== adminId) continue;
    if (batchId && e.batchId !== batchId) continue;
    matched.push(e);
  }
  matched.reverse();
  return { total: matched.length, entries: matched.slice(offset, offset + limit) };
}
