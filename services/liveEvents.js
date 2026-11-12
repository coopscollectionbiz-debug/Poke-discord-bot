// ==========================================================
// services/liveEvents.js — Live events: storage and admin operations.
//
// State lives in TRAINERDATA_DIR/live-events.json (one writer: the bot),
// written atomically. Every hook reads liveEffects(), the running effects
// combined (utils/liveEventRules.js). Admin operations validate, save, and
// append to admin-audit.ndjson with a reason.
// ==========================================================

import fs from "fs/promises";
import path from "path";
import { readFileSync } from "fs";
import { atomicWrite } from "../utils/atomicWrite.js";
import { appendAudit } from "../utils/adminAudit.js";
import { acquirablePokemon, getSpeciesEntry } from "../utils/speciesCatalog.js";
import {
  cleanEvent, combine, emptyLimitProblem, statusOf, stopAt, hasCatchEffects, NO_EFFECTS,
} from "../utils/liveEventRules.js";

const pokemonData = JSON.parse(readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));

export const liveEventsPath = () => path.join(process.env.TRAINERDATA_DIR || ".", "live-events.json");

const empty = () => ({ events: [], settings: { channelId: null }, nextId: 1 });
let state = empty();

/** Load from disk. A missing file is an empty state; a broken one is reported and left untouched on disk. */
export async function loadLiveEvents() {
  try {
    const raw = JSON.parse(await fs.readFile(liveEventsPath(), "utf8"));
    state = { ...empty(), ...raw, settings: { ...empty().settings, ...(raw.settings || {}) } };
  } catch (err) {
    if (err?.code !== "ENOENT") console.error("❌ live-events.json unreadable; Live events are off until it's fixed:", err?.message || err);
    state = empty();
  }
  return state;
}

async function persist() {
  await atomicWrite(liveEventsPath(), JSON.stringify(state, null, 2));
}

export const listLiveEvents = () => state.events.filter((e) => !e.deleted);
export const getLiveEvent = (id) => state.events.find((e) => e.id === Number(id) && !e.deleted) ?? null;
export const liveEventSettings = () => ({ ...state.settings });

/** The running effects, combined. Never throws: a broken state means no effects. */
export function liveEffects(now = Date.now()) {
  try {
    return combine(state.events, now);
  } catch (err) {
    console.warn("⚠️ live effects failed:", err?.message || err);
    return NO_EFFECTS;
  }
}

// ----------------------------------------------------------
// Paid rolls: the player's "Use Live event" choice
// ----------------------------------------------------------

/** Is the player's opt-in still good? It lapses when a newer Catch boost or limit starts. */
export function optedIn(user, fx = liveEffects()) {
  const at = Number(user?.liveEventOptInAt);
  return hasCatchEffects(fx) && Number.isFinite(at) && at >= (fx.catchStartedAt ?? 0);
}

export function setOptIn(user, on, now = Date.now()) {
  if (on) user.liveEventOptInAt = now;
  else delete user.liveEventOptInAt;
  return optedIn(user, liveEffects(now));
}

/**
 * The effects a roll should use. Free rolls always follow Catch boosts and
 * limits; paid rolls only when the player opted in.
 */
export function catchEffectsFor(user, { paid = false, fx = liveEffects() } = {}) {
  if (!paid || optedIn(user, fx)) return fx;
  return { ...fx, boosts: [], limits: [] };
}

// ----------------------------------------------------------
// Admin operations
// ----------------------------------------------------------

const speciesExists = (id) => Boolean(getSpeciesEntry(id));
const plainPool = () => acquirablePokemon(Object.values(pokemonData));

function check(raw, id = null) {
  const r = cleanEvent(raw, { speciesExists });
  if (r.error) return r;
  const candidate = { ...r.event, id };
  const problem = emptyLimitProblem(candidate, listLiveEvents(), plainPool());
  return problem ? { error: problem } : r;
}

const fail = (status, error) => ({ ok: false, status, error });
const needReason = (reason) => (String(reason ?? "").trim() ? null : fail(400, "A reason is required."));

async function audit(action, event, admin, reason, extra = {}) {
  return appendAudit({
    type: "live_event",
    action,
    eventId: event.id,
    eventName: event.name,
    adminId: admin?.id ?? null,
    adminName: admin?.name ?? null,
    reason: String(reason ?? "").trim(),
    ...extra,
  });
}

const snapshot = (e) => (e ? JSON.parse(JSON.stringify(e)) : null);

/** Validate without saving (the dashboard's Save button state). */
export const checkLiveEvent = (raw, id = null) => check(raw, id == null ? null : Number(id));

export async function createLiveEvent(raw, { admin, reason, now = Date.now() }) {
  const missing = needReason(reason);
  if (missing) return missing;
  const r = check(raw);
  if (r.error) return fail(400, r.error);
  if (r.event.endAt <= now) return fail(400, "That window has already ended.");
  const event = { id: state.nextId++, ...r.event, createdAt: now, createdBy: admin?.id ?? null, endedAt: null, startPosted: false, endPosted: false };
  state.events.push(event);
  await persist();
  const audited = await audit("create", event, admin, reason, { after: snapshot(event) });
  return { ok: true, event, audited: audited.ok };
}

export async function updateLiveEvent(id, raw, { admin, reason, now = Date.now() }) {
  const missing = needReason(reason);
  if (missing) return missing;
  const event = getLiveEvent(id);
  if (!event) return fail(404, "No such event.");
  const status = statusOf(event, now);
  if (status === "ended") return fail(409, "This event has ended and can't be changed.");
  // A running event keeps its start: it has already begun.
  const next = { ...raw, startAt: status === "running" ? event.startAt : raw.startAt };
  const r = check(next, event.id);
  if (r.error) return fail(400, r.error);
  if (r.event.endAt <= now) return fail(400, "To stop it now, use End now.");
  const before = snapshot(event);
  Object.assign(event, r.event, { updatedAt: now });
  await persist();
  const audited = await audit("edit", event, admin, reason, { before, after: snapshot(event) });
  return { ok: true, event, audited: audited.ok };
}

export async function endLiveEvent(id, { admin, reason, now = Date.now() }) {
  const missing = needReason(reason);
  if (missing) return missing;
  const event = getLiveEvent(id);
  if (!event) return fail(404, "No such event.");
  if (statusOf(event, now) !== "running") return fail(409, "Only a running event can be ended early.");
  event.endedAt = now;
  await persist();
  const audited = await audit("end", event, admin, reason, { endedAt: now });
  return { ok: true, event, audited: audited.ok };
}

export async function deleteLiveEvent(id, { admin, reason, now = Date.now() }) {
  const missing = needReason(reason);
  if (missing) return missing;
  const event = getLiveEvent(id);
  if (!event) return fail(404, "No such event.");
  if (statusOf(event, now) !== "scheduled") return fail(409, "Only an event that hasn't started can be deleted.");
  event.deleted = true;
  await persist();
  const audited = await audit("delete", event, admin, reason, { before: snapshot(event) });
  return { ok: true, audited: audited.ok };
}

export async function setAnnounceChannel(channelId, { admin }) {
  const id = channelId ? String(channelId).trim() : null;
  if (id && !/^\d{5,25}$/.test(id)) return fail(400, "That isn't a Discord channel id.");
  const before = state.settings.channelId;
  state.settings.channelId = id;
  await persist();
  await appendAudit({ type: "live_event", action: "channel", adminId: admin?.id ?? null, adminName: admin?.name ?? null, before, after: id, reason: "Announcement channel" });
  return { ok: true, channelId: id };
}

// ----------------------------------------------------------
// Announcements: which start/end posts are due
// ----------------------------------------------------------

/** Events whose start or end post is due (also catches boundaries passed while the bot was down). */
export function duePosts(now = Date.now()) {
  const due = [];
  for (const e of listLiveEvents()) {
    if (!e.startPosted && e.startAt <= now && now < stopAt(e)) due.push({ kind: "start", event: e });
    if (!e.endPosted && now >= stopAt(e)) due.push({ kind: "end", event: e, skippedStart: !e.startPosted });
  }
  return due;
}

export async function markPosted(id, kind) {
  const e = getLiveEvent(id);
  if (!e) return;
  if (kind === "start") e.startPosted = true;
  if (kind === "end") { e.endPosted = true; e.startPosted = true; }
  await persist();
}

// ----------------------------------------------------------
// Testing
// ----------------------------------------------------------

export function setLiveEventsForTesting(events = [], settings = {}) {
  state = { ...empty(), events: events.map((e, i) => ({ id: i + 1, endedAt: null, ...e })), settings: { ...empty().settings, ...settings } };
  state.nextId = state.events.length + 1;
}
