// ==========================================================
// utils/eventLog.js — Append-only NDJSON event log
// ==========================================================
//
// PURPOSE
// -------
// Captures a timestamped history of player actions (rolls, donations,
// daily claims, etc.) for the admin dashboard analytics panel.
//
// WHY NDJSON (newline-delimited JSON) INSTEAD OF A SINGLE JSON ARRAY?
// ------------------------------------------------------------------
// A flat JSON array would require reading + parsing + rewriting the
// entire file on every event. At ~1k events/day across all users,
// that becomes an O(n²) cost at scale. NDJSON lets us append a single
// line per event with fs.appendFile — constant time per write,
// crash-safe (a partially written line just gets dropped on read),
// and streamable if we ever need it.
//
// WHY A SEPARATE FILE INSTEAD OF STORING EVENTS ON trainerData?
// --------------------------------------------------------------
// trainerData is game state (source of truth, backed up to Discord
// every 15min). Events are append-only analytics data that would
// balloon the JSON blob. Keeping them separate means trainerData
// stays lean and events don't compete with game state for the
// Discord backup channel.
//
// WHY IS logEvent() TRY/CATCH WRAPPED INTERNALLY?
// ------------------------------------------------
// The bot is a single process. If a logging failure (e.g. disk full,
// filesystem hiccup on Fly's volume) bubbled up into the donate
// handler, it could reject the user's API request and leave their
// Pokemon in a weird state. Analytics failures must NEVER break
// gameplay, so every write is caught and silently warned.
//
// RETENTION / SCALE EXPECTATIONS
// ------------------------------
// 30 days. pruneEvents() runs on startup and on a daily setInterval.
//
// Rough volume model: an active player generates a few dozen events
// per day (rolls, donates, daily, quest, etc.). With ~50 active
// users × ~40 events/day × 30 days ≈ 60k events ≈ ~15 MB on disk.
//
// At that size:
//   • fs.appendFile for writes stays constant-time (it's just one line).
//   • readEvents loads + parses the whole file per call. At 60k lines
//     that's still sub-second, and the admin API is low-QPS. If this
//     ever becomes a real bottleneck, the next step is an index file
//     (timestamp → byte offset) or a rolling daily shard.
// ==========================================================

import fs from "fs/promises";
import path from "path";

// ----------------------------------------------------------
// 📁 File location
// ----------------------------------------------------------
// Honor TRAINERDATA_DIR so the event log lives on the same
// persistent volume as trainerData.json (relevant on Fly).
const EVENTS_DIR = process.env.TRAINERDATA_DIR || ".";
const EVENTS_PATH = path.join(EVENTS_DIR, "events.ndjson");
const EVENTS_TMP_PATH = path.join(EVENTS_DIR, "events.ndjson.tmp");

// 30 days in milliseconds — events older than this get pruned.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// ==========================================================
// 📝 logEvent — the only write path
// ==========================================================
/**
 * Append a single event to the log. NEVER throws — failures are
 * logged as warnings so they can't break the caller's game action.
 *
 * @param {string} type - Event type (e.g. "roll", "donate", "daily_claim")
 * @param {string} userId - Discord user ID who triggered the event
 * @param {object} [data={}] - Arbitrary event-specific payload
 */
export async function logEvent(type, userId, data = {}) {
  try {
    const entry = {
      timestamp: Date.now(),
      type,
      userId: String(userId),
      data,
    };
    // One JSON object per line. Trailing newline is required so the
    // next append starts on a fresh line.
    await fs.appendFile(EVENTS_PATH, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    console.warn(`⚠️ logEvent(${type}) failed:`, err?.message || err);
  }
}

// ==========================================================
// 📖 readEvents — used by the admin API
// ==========================================================
/**
 * Read the event log, optionally filtered. Returns events in
 * reverse-chronological order (newest first).
 *
 * At the expected scale (tens of thousands of events over 30 days)
 * loading the whole file per call is fine — the admin API is
 * low-QPS. If this grows an order of magnitude, switch to a
 * streaming reader or a timestamp index.
 *
 * @param {object} [filters]
 * @param {string} [filters.type]    - Only events of this type
 * @param {string} [filters.userId]  - Only events from this user
 * @param {number} [filters.since]   - Only events >= this timestamp (ms)
 * @param {number} [filters.until]   - Only events <= this timestamp (ms)
 * @param {number} [filters.limit]   - Max events to return (default 100)
 * @param {number} [filters.offset]  - Skip first N matches (pagination)
 * @returns {Promise<{total: number, events: Array}>}
 */
export async function readEvents(filters = {}) {
  const {
    type = null,
    userId = null,
    since = null,
    until = null,
    limit = 100,
    offset = 0,
  } = filters;

  let raw;
  try {
    raw = await fs.readFile(EVENTS_PATH, "utf8");
  } catch (err) {
    // ENOENT just means no events have been logged yet — not an error.
    if (err?.code === "ENOENT") return { total: 0, events: [] };
    console.warn("⚠️ readEvents failed:", err?.message || err);
    return { total: 0, events: [] };
  }

  const lines = raw.split("\n");
  const matched = [];

  // Parse each line defensively — a partially written last line or
  // a corrupted entry shouldn't poison the whole response.
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (type && entry.type !== type) continue;
    if (userId && entry.userId !== String(userId)) continue;
    if (since && entry.timestamp < since) continue;
    if (until && entry.timestamp > until) continue;

    matched.push(entry);
  }

  // Newest first — more useful default for a dashboard.
  matched.sort((a, b) => b.timestamp - a.timestamp);

  const total = matched.length;
  const paginated = matched.slice(offset, offset + limit);

  return { total, events: paginated };
}

// ==========================================================
// 🧹 pruneEvents — drops entries older than RETENTION_MS
// ==========================================================
/**
 * Rewrite the event log file, keeping only entries within the
 * retention window. Uses tmp-file + rename for atomicity so a
 * crash mid-prune can't lose everything.
 *
 * Safe to call on startup and on a recurring interval.
 *
 * @returns {Promise<{kept: number, dropped: number}>}
 */
export async function pruneEvents() {
  const cutoff = Date.now() - RETENTION_MS;

  let raw;
  try {
    raw = await fs.readFile(EVENTS_PATH, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { kept: 0, dropped: 0 };
    console.warn("⚠️ pruneEvents read failed:", err?.message || err);
    return { kept: 0, dropped: 0 };
  }

  const lines = raw.split("\n");
  const survivors = [];
  let dropped = 0;

  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      dropped++;
      continue;
    }
    if (entry.timestamp >= cutoff) {
      survivors.push(line);
    } else {
      dropped++;
    }
  }

  // No work needed — early out so we don't do a pointless rewrite.
  if (dropped === 0) return { kept: survivors.length, dropped: 0 };

  try {
    // Survivors keep their original serialized form — faster and
    // preserves any fields we don't know about.
    const output = survivors.length ? survivors.join("\n") + "\n" : "";
    await fs.writeFile(EVENTS_TMP_PATH, output, "utf8");
    await fs.rename(EVENTS_TMP_PATH, EVENTS_PATH);
    console.log(`🧹 Event log pruned: kept ${survivors.length}, dropped ${dropped}`);
  } catch (err) {
    console.warn("⚠️ pruneEvents write failed:", err?.message || err);
  }

  return { kept: survivors.length, dropped };
}

// ==========================================================
// 🛑 shutdown — hook for gracefulShutdown
// ==========================================================
/**
 * Currently a no-op. fs.appendFile resolves once the write hits
 * the OS; there's no in-memory buffer to flush. Exposed as an
 * export so if we add write coalescing later, the shutdown path
 * in bot_final.js already calls it.
 */
export async function shutdown() {
  return;
}
