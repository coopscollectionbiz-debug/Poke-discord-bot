// ==========================================================
// services/notices.js — one-time notices stored on the player's record.
//
// user.notices = [{ id, kind, text, at }]. A notice is written by the server
// (e.g. a boot migration), shown by the dashboard and/or a command reply, and
// removed once shown (dismissed on the dashboard or sent in Discord). The
// field is optional: missing means "no notices". Older builds ignore it.
// ==========================================================

import { randomUUID } from "crypto";

export const NOTICE_KINDS = Object.freeze({ BATTLE_TEAM_TRIM: "battle_team_trim" });
const MAX_NOTICES = 20;

/** IN PLACE: drop malformed entries; never creates the field. */
export function normalizeNotices(user) {
  if (!user || !("notices" in user)) return;
  if (!Array.isArray(user.notices)) { delete user.notices; return; }
  user.notices = user.notices.filter((n) => n && typeof n.id === "string" && typeof n.kind === "string" && typeof n.text === "string");
  if (!user.notices.length) delete user.notices;
}

export function addNotice(user, kind, text, now = Date.now()) {
  const n = { id: randomUUID(), kind, text, at: now };
  user.notices = [...(Array.isArray(user.notices) ? user.notices : []), n].slice(-MAX_NOTICES);
  return n;
}

/** Notices of one kind (or all), oldest first, without removing them. */
export function peekNotices(user, kind) {
  const list = Array.isArray(user?.notices) ? user.notices : [];
  return kind ? list.filter((n) => n.kind === kind) : list.slice();
}

/** Remove notices by id. Returns how many were removed. */
export function clearNotices(user, ids) {
  if (!Array.isArray(user?.notices)) return 0;
  const drop = new Set(ids);
  const before = user.notices.length;
  user.notices = user.notices.filter((n) => !drop.has(n.id));
  if (!user.notices.length) delete user.notices;
  return before - (user.notices?.length ?? 0);
}
