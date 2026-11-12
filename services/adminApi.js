// ==========================================================
// services/adminApi.js — Admin change handlers (single player and bulk).
//
// Transport-free like services/gameplay.js: each handler takes plain input
// and returns { status, body }. routes/admindashboard.js does auth, origin
// and readiness checks, then calls these.
//
// • Every change runs inside the player's lock and is saved before the
//   response (saveAndAck). Bulk grants lock one player at a time and save
//   once at the end.
// • A requestId makes a submit safe to repeat: a retry or double-click gets
//   the first result back and nothing runs twice (in memory, 1 hour).
// • Every applied change is written to the admin audit file.
// ==========================================================

import {
  parseChange, applyChange, previewChange, needsReason, isBulkable,
  parseFilters, matchesFilters, lastActiveOf, MAX_REASON,
} from "./adminChanges.js";

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const REPLAY_TTL_MS = 60 * 60 * 1000;
const MAX_BULK = 5000;

const ok = (body) => ({ status: 200, body: { ok: true, ...body } });
const bad = (error, status = 400, extra = {}) => ({ status, body: { ok: false, error, ...extra } });

/**
 * @param {object} deps
 * @param {() => object} deps.getTrainerData
 * @param {(id: string, fn: Function) => Promise<any>} deps.lockUser
 * @param {(data: object) => Promise<{saved: boolean, note: string}>} deps.save
 * @param {(entries: object[]) => Promise<{ok: boolean}>} deps.appendAudit
 * @param {(userId: string, tp: number) => Promise<{ok: boolean, reason?: string}>} [deps.syncRole]
 * @param {() => Promise<Map<string,string>>} [deps.getTrainerKeys] - lower-case key → key
 * @param {(key: string) => string} [deps.trainerName]
 * @param {() => number} [deps.now]
 * @param {() => number} [deps.rand]
 */
export function createAdminHandlers(deps) {
  const {
    getTrainerData, lockUser, save, appendAudit,
    syncRole = async () => ({ ok: true }),
    getTrainerKeys = async () => new Map(),
    trainerName = (k) => k,
    now = Date.now,
    rand = Math.random,
  } = deps;

  const replays = new Map(); // requestId -> { at, promise }

  function remember(requestId, run) {
    const t = now();
    for (const [k, v] of replays) if (t - v.at > REPLAY_TTL_MS) replays.delete(k);
    const seen = replays.get(requestId);
    if (seen) return seen.promise.then((r) => ({ ...r, body: { ...r.body, replayed: true } }));
    const promise = run();
    replays.set(requestId, { at: t, promise });
    // A rejected run (thrown error) may be retried.
    promise.catch(() => replays.delete(requestId));
    return promise;
  }

  async function parse(raw) {
    const trainerKeys = raw?.kind === "trainer" && raw?.op === "add" ? await getTrainerKeys() : undefined;
    return parseChange(raw, { trainerKeys });
  }

  function cleanReason(reason) {
    return String(reason ?? "").trim().slice(0, MAX_REASON);
  }

  const ctxFor = (userId, user, allowUnreleased) => ({
    allowUnreleased: allowUnreleased === true,
    rand,
    now: now(),
    trainerName,
    playerName: user?.name,
    userId,
  });

  async function afterTp(userId, result, change) {
    if (change.kind !== "tp" || !result.rankChanged) return null;
    try {
      return await syncRole(userId, result.after);
    } catch (err) {
      return { ok: false, reason: err?.message || String(err) };
    }
  }

  // --------------------------------------------------------
  // Single player
  // --------------------------------------------------------
  async function preview({ userId, change: raw, allowUnreleased }) {
    const user = getTrainerData()?.[userId];
    if (!user) return bad("Player not found.", 404);
    const p = await parse(raw);
    if (!p.ok) return bad(p.error);
    const r = previewChange(user, p.change, ctxFor(userId, user, allowUnreleased));
    if (!r.ok) return bad(r.error, 409, { current: r.current });
    return ok({
      summary: r.summary,
      before: p.change.kind === "reset" ? null : r.before,
      after: r.after,
      warnings: r.warnings,
      level: r.level ?? null,
      levelRolled: r.levelRolled ?? false,
      needsReason: needsReason(p.change),
    });
  }

  async function apply({ admin, userId, change: raw, reason, allowUnreleased, requestId }) {
    if (!REQUEST_ID.test(String(requestId ?? ""))) return bad("Missing request id.");
    return remember(`one:${requestId}`, async () => {
      const p = await parse(raw);
      if (!p.ok) return bad(p.error);
      const why = cleanReason(reason);
      if (needsReason(p.change) && !why) return bad("Add a reason for this change.");

      const td = getTrainerData();
      if (!td?.[userId]) return bad("Player not found.", 404);

      const outcome = await lockUser(String(userId), async () => {
        const user = td[userId];
        if (!user) return { error: bad("Player not found.", 404) };
        const r = applyChange(user, p.change, ctxFor(userId, user, allowUnreleased));
        if (!r.ok) return { error: bad(r.error, 409, { current: r.current }) };
        const ack = await save(td);
        return { r, ack, name: user.name ?? "" };
      });
      if (outcome.error) return outcome.error;

      const { r, ack, name } = outcome;
      const audit = await appendAudit([{
        adminId: admin.id, adminName: admin.name ?? "",
        userId, userName: name,
        kind: p.change.kind, change: p.change,
        summary: r.summary, before: r.before, after: r.after, warnings: r.warnings,
        reason: why,
      }]);
      const role = await afterTp(userId, r, p.change);
      return ok({
        summary: r.summary,
        before: p.change.kind === "reset" ? null : r.before,
        after: r.after,
        warnings: r.warnings,
        level: r.level ?? null,
        saved: ack.saved,
        note: ack.note || "",
        audited: audit.ok,
        role,
      });
    });
  }

  // --------------------------------------------------------
  // Bulk
  // --------------------------------------------------------
  function resolveTargets(target, td) {
    if (Array.isArray(target?.userIds)) {
      const ids = [...new Set(target.userIds.map(String))].filter((id) => td[id]);
      return { ok: true, ids };
    }
    const f = parseFilters(target?.filters ?? {});
    if (!f.ok) return f;
    const t = now();
    const ids = Object.keys(td).filter((id) => matchesFilters(td[id], f.filters, t));
    return { ok: true, ids };
  }

  const row = (id, u) => ({
    userId: id,
    name: u?.name ?? "",
    cc: Number(u?.cc) || 0,
    tp: Number(u?.tp) || 0,
    lastActive: lastActiveOf(u),
  });

  async function bulkPreview({ change: raw, target }) {
    const p = await parse(raw);
    if (!p.ok) return bad(p.error);
    if (!isBulkable(p.change)) return bad("Only grants and cooldown resets can go to many players.");
    const td = getTrainerData() || {};
    const t = resolveTargets(target, td);
    if (!t.ok) return bad(t.error);
    if (t.ids.length > MAX_BULK) return bad(`That matches ${t.ids.length} players; the limit is ${MAX_BULK}.`);
    const players = t.ids.map((id) => row(id, td[id])).sort((a, b) => a.name.localeCompare(b.name));
    // Dry-run on copies so the preview already shows who would be skipped.
    const skipped = [];
    for (const id of t.ids) {
      const r = previewChange(td[id], p.change, ctxFor(id, td[id], target?.allowUnreleased));
      if (!r.ok) skipped.push({ userId: id, name: td[id]?.name ?? "", error: r.error });
    }
    const summary = previewChange({}, p.change.kind === "cooldown" ? p.change : { ...p.change }, ctxFor("", {}, true));
    return ok({ count: players.length, players, skipped, summary: summary.ok ? summary.summary : null });
  }

  async function bulkApply({ admin, change: raw, userIds, reason, allowUnreleased, requestId }) {
    if (!REQUEST_ID.test(String(requestId ?? ""))) return bad("Missing request id.");
    return remember(`bulk:${requestId}`, async () => {
      const p = await parse(raw);
      if (!p.ok) return bad(p.error);
      if (!isBulkable(p.change)) return bad("Only grants and cooldown resets can go to many players.");
      const why = cleanReason(reason);
      if (!why) return bad("Add a reason for this batch.");
      if (!Array.isArray(userIds) || !userIds.length) return bad("No players selected.");
      const ids = [...new Set(userIds.map(String))];
      if (ids.length > MAX_BULK) return bad(`At most ${MAX_BULK} players per batch.`);

      const td = getTrainerData() || {};
      const batchId = `b-${requestId}`;
      const done = [];
      const skipped = [];
      let summary = "";
      for (const id of ids) {
        const res = await lockUser(id, async () => {
          const user = td[id];
          if (!user) return { error: "Player not found." };
          const r = applyChange(user, p.change, ctxFor(id, user, allowUnreleased));
          return r.ok ? { r, name: user.name ?? "" } : { error: r.error, name: user.name ?? "" };
        });
        if (res.error) skipped.push({ userId: id, name: res.name ?? "", error: res.error });
        else {
          summary = res.r.summary;
          done.push({ userId: id, name: res.name, r: res.r });
        }
      }
      const ack = done.length ? await save(td) : { saved: true, note: "" };
      const audit = await appendAudit(done.map((d) => ({
        adminId: admin.id, adminName: admin.name ?? "",
        userId: d.userId, userName: d.name,
        kind: p.change.kind, change: p.change,
        summary: d.r.summary, before: d.r.before, after: d.r.after, warnings: d.r.warnings,
        reason: why, batchId, batchSize: ids.length,
      })));
      const roleFailures = [];
      for (const d of done) {
        const role = await afterTp(d.userId, d.r, p.change);
        if (role && !role.ok) roleFailures.push({ userId: d.userId, name: d.name, reason: role.reason });
      }
      return ok({
        batchId,
        summary,
        granted: done.length,
        skipped,
        saved: ack.saved,
        note: ack.note || "",
        audited: audit.ok,
        roleFailures,
      });
    });
  }

  return { preview, apply, bulkPreview, bulkApply };
}
