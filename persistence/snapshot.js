// ==========================================================
// persistence/snapshot.js
// Pure helpers for trainerData snapshots: metadata, validation, and the
// startup selection rule. No I/O here, so every rule is unit-testable.
//
// Snapshot metadata: { seq, savedAt, userCount, sha256, bytes }
//   seq      – increases on every successful local write AND every
//              Discord upload, carried across restarts. Compared first,
//              so machine/Discord clock skew can't pick an older copy.
//   savedAt  – ms epoch, used only when seq is unknown (legacy backups).
//   sha256   – of the exact text of the file it describes.
// ==========================================================

import crypto from "crypto";

export const SOURCE_PRIORITY = { local: 3, "local-prev": 2, discord: 1 };

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function buildMeta(text, { seq, savedAt = Date.now(), userCount }) {
  return {
    seq,
    savedAt,
    userCount,
    sha256: sha256(text),
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

// ----------------------------------------------------------
// Discord backup message text <-> metadata
// ----------------------------------------------------------
export function formatBackupMessage(meta) {
  return `trainerData seq=${meta.seq} users=${meta.userCount} sha256=${meta.sha256} savedAt=${meta.savedAt}`;
}

export function parseBackupMessage(content) {
  const s = String(content || "");
  const num = (k) => {
    const m = new RegExp(`\\b${k}=(\\d+)\\b`).exec(s);
    return m ? Number(m[1]) : null;
  };
  const hash = /\bsha256=([0-9a-f]{64})\b/.exec(s);
  const meta = { seq: num("seq"), userCount: num("users"), savedAt: num("savedAt"), sha256: hash ? hash[1] : null };
  return meta.seq == null && meta.sha256 == null ? null : meta;
}

// ----------------------------------------------------------
// Validation
// ----------------------------------------------------------
/**
 * Validate one candidate snapshot.
 * @param {object} c
 * @param {string} c.source      - "local" | "local-prev" | "discord"
 * @param {string|null} c.text   - raw file text (null = missing)
 * @param {object|null} c.meta   - metadata if any
 * @param {number|null} c.fallbackTime - mtime / message timestamp
 * @param {string} [c.id]        - human id for logs (path or message id)
 * @returns {{ok:true, source, id, data, userCount, seq, savedAt, metaTrusted}|{ok:false, source, id, reason}}
 */
export function validateSnapshot({ source, text, meta = null, fallbackTime = null, id = source }) {
  if (text == null) return { ok: false, source, id, reason: "missing" };
  if (!String(text).trim()) return { ok: false, source, id, reason: "empty file" };

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, source, id, reason: `invalid JSON (${e.message.slice(0, 60)})` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, source, id, reason: "not a user map" };
  }
  const ids = Object.keys(data);
  if (ids.length === 0) return { ok: false, source, id, reason: "no users" };
  const bad = ids.find((k) => !data[k] || typeof data[k] !== "object" || Array.isArray(data[k]));
  if (bad !== undefined) return { ok: false, source, id, reason: `user ${bad} is not an object` };

  // Metadata is trusted only if it describes exactly this text.
  const metaTrusted = !!(meta && meta.sha256 && meta.sha256 === sha256(text));
  const seq = metaTrusted && Number.isInteger(meta.seq) ? meta.seq : null;
  const savedAt =
    metaTrusted && Number.isFinite(meta.savedAt) ? meta.savedAt : Number.isFinite(fallbackTime) ? fallbackTime : 0;

  return { ok: true, source, id, data, userCount: ids.length, seq, savedAt, metaTrusted };
}

// ----------------------------------------------------------
// Selection
// ----------------------------------------------------------
/** true if a is newer than b. */
export function isNewer(a, b) {
  if (a.seq != null && b.seq != null && a.seq !== b.seq) return a.seq > b.seq;
  if (a.seq != null && b.seq != null) {
    // same seq: same snapshot content generation — prefer local
    return (SOURCE_PRIORITY[a.source] ?? 0) > (SOURCE_PRIORITY[b.source] ?? 0);
  }
  if (a.savedAt !== b.savedAt) return a.savedAt > b.savedAt;
  return (SOURCE_PRIORITY[a.source] ?? 0) > (SOURCE_PRIORITY[b.source] ?? 0);
}

/**
 * Pick the newest valid snapshot, refusing one with far fewer players
 * than the largest valid candidate (unless explicitly allowed).
 * @returns {{ chosen: object|null, rejected: Array<{source,id,reason}>, blocked: string|null, maxUsers: number }}
 */
export function selectSnapshot(candidates, { minUserRatio = 0.8, allowPlayerCountDrop = false } = {}) {
  const valid = candidates.filter((c) => c.ok);
  const rejected = candidates.filter((c) => !c.ok).map(({ source, id, reason }) => ({ source, id, reason }));
  if (!valid.length) return { chosen: null, rejected, blocked: "no valid snapshot", maxUsers: 0 };

  let chosen = valid[0];
  for (const c of valid.slice(1)) if (isNewer(c, chosen)) chosen = c;

  const maxUsers = Math.max(...valid.map((c) => c.userCount));
  if (!allowPlayerCountDrop && chosen.userCount < minUserRatio * maxUsers) {
    return {
      chosen: null,
      rejected,
      maxUsers,
      blocked:
        `newest snapshot (${chosen.source} ${chosen.id}) has ${chosen.userCount} players, ` +
        `below ${Math.round(minUserRatio * 100)}% of the largest valid snapshot (${maxUsers}). ` +
        `Set ALLOW_PLAYER_COUNT_DROP=1 only after checking it is correct.`,
    };
  }
  return { chosen, rejected, blocked: null, maxUsers };
}

// ----------------------------------------------------------
// Operator restore override
// ----------------------------------------------------------
/**
 * RESTORE_FROM=discord:<messageId> | file:<path>, honoured only when
 * CONFIRM_RESTORE has exactly the same value.
 * @returns {null | {kind:"discord"|"file", target:string} | {error:string}}
 */
export function resolveRestore(env = process.env) {
  const raw = String(env.RESTORE_FROM || "").trim();
  if (!raw) return null;
  const m = /^(discord|file):(.+)$/.exec(raw);
  if (!m) return { error: `RESTORE_FROM must be discord:<messageId> or file:<path> (got "${raw}")` };
  if (String(env.CONFIRM_RESTORE || "").trim() !== raw) {
    return { error: "RESTORE_FROM is set but CONFIRM_RESTORE does not match it; refusing to restore" };
  }
  return { kind: m[1], target: m[2].trim() };
}
