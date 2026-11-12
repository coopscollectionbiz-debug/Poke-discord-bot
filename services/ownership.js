// ==========================================================
// services/ownership.js — the ONLY place that lowers Pokémon ownership.
//
// TM system, phase T0 (docs/tm-system/TM-DONATION-DUPLICATE-SAFETY.md):
// every operation that removes or transforms owned copies (donate, bulk
// donate, gift, evolve, shiny craft, admin wipe) goes through here, so a
// future customized copy (a Pokémon taught a TM, user.customPokemon) can
// never be destroyed by an automatic "pick any copy" operation.
// tests/mutationGuard.test.js forbids direct decrements anywhere else.
//
// Model (owner decision D-T1, hybrid):
//   user.pokemon[id] = { normal, shiny }   TOTAL copies (unchanged meaning)
//   user.customPokemon[uid] = { uid, speciesId, variant, rev, ... }
//     one record per customized copy; absent = none. Nothing creates
//     records yet (T0); this module only protects them.
//   plain copies = total − customized (non-suspended) records of the line.
//
// Rules:
//   • Plain copies are always used first.
//   • A customized copy is removed or transformed ONLY when the caller
//     names its uid AND passes the rev the player confirmed. Without that,
//     the operation is refused (fail closed); it never picks one itself.
//   • Every function validates everything before changing anything.
//   • Pure + synchronous: call inside the caller's user lock/transaction.
// ==========================================================

import { randomBytes } from "crypto";
import { carryLevel, resetLevelIfGone } from "../utils/training.js";
import { getSpeciesEntry } from "../utils/speciesCatalog.js";
import { getMove } from "../utils/battle/data.js";

const VARIANTS = new Set(["normal", "shiny"]);
/** Server-generated customized-copy ids: "c_" + 10 base62 characters. */
export const CUSTOM_UID_PATTERN = /^c_[A-Za-z0-9]{10}$/;
const fail = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });

const countOf = (user, id, variant) => {
  const n = Number(user?.pokemon?.[id]?.[variant]);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Customized (non-suspended) records of one line. */
export function customCopiesOf(user, id, variant) {
  const all = user?.customPokemon;
  if (!all || typeof all !== "object") return [];
  return Object.values(all).filter(
    (c) => c && !c.suspended && Number(c.speciesId) === Number(id) && c.variant === variant,
  );
}

/** Copies of id:variant that carry no customization (interchangeable). */
export function plainCount(user, id, variant) {
  return Math.max(0, countOf(user, id, variant) - customCopiesOf(user, id, variant).length);
}

/** What the player is shown about a protected copy (no internal fields beyond uid/rev). */
export function copySummary(c) {
  return {
    uid: c.uid,
    rev: c.rev ?? 0,
    speciesId: Number(c.speciesId),
    variant: c.variant,
    tmMoves: Array.isArray(c.tmMoves) ? [...c.tmMoves] : [],
  };
}

/** Delete the species entry when it holds no copies and no customized record. */
export function pruneEmptyLine(user, id) {
  const e = user?.pokemon?.[id];
  if (!e) return;
  if ((e.normal ?? 0) <= 0 && (e.shiny ?? 0) <= 0) {
    const hasCustom = customCopiesOf(user, id, "normal").length || customCopiesOf(user, id, "shiny").length;
    if (!hasCustom) delete user.pokemon[id];
  }
}

// Remove a customized record and everything that points at it.
function dropCustom(user, uid) {
  delete user.customPokemon[uid];
  for (const team of Object.values(user.movesets ?? {})) {
    if (team && typeof team === "object") delete team[`u:${uid}`];
  }
  for (const field of ["displayedPokemon", "battleTeam"]) {
    if (!Array.isArray(user[field])) continue;
    for (const slot of user[field]) if (slot && typeof slot === "object" && slot.uid === uid) delete slot.uid;
  }
  if (user.customPokemon && Object.keys(user.customPokemon).length === 0) delete user.customPokemon;
}

// Validate that `uids` name customized copies of this line with confirmed revs.
function checkNamedCustoms(user, id, variant, uids, confirmRevs) {
  if (!Array.isArray(uids)) return fail("bad_request", "Invalid copy list.");
  if (new Set(uids).size !== uids.length) return fail("bad_request", "A copy is listed twice.");
  for (const uid of uids) {
    const c = typeof uid === "string" ? user?.customPokemon?.[uid] : null;
    if (!c || c.suspended || Number(c.speciesId) !== Number(id) || c.variant !== variant) {
      return fail("unknown_copy", "That Pokémon copy no longer exists.");
    }
    if (confirmRevs?.[uid] !== (c.rev ?? 0)) {
      return fail("stale_confirmation", "This Pokémon changed since you confirmed. Please review it again.", { protected: [copySummary(c)] });
    }
  }
  return null;
}

/**
 * Check (without changing anything) whether `n` copies of id:variant can be
 * removed. Same result as removeCopies, minus the mutation.
 */
export function canRemoveCopies(user, { id, variant, n, customUids = [], confirmRevs = {}, exact = false }) {
  if (!VARIANTS.has(variant)) return fail("bad_request", "Invalid variant.");
  if (!Number.isInteger(n) || n < 1) return fail("bad_request", "Invalid count.");
  const owned = countOf(user, id, variant);
  if (owned < n) return fail("not_owned", "You don't own enough of that Pokémon.", { owned });
  const named = checkNamedCustoms(user, id, variant, customUids, confirmRevs);
  if (named) return named;
  const plain = plainCount(user, id, variant);
  // exact (T5): remove precisely the named trained copies, plus plain copies
  // for the rest. Used when the player picked one specific trained copy.
  if (exact) {
    if (customUids.length > n) return fail("bad_request", "Too many copies listed.");
    if (n - customUids.length > plain) {
      return fail("custom_copies_protected", "Some of these Pokémon have TM-trained moves. Choose them individually to confirm.", { plain, protected: customCopiesOf(user, id, variant).map(copySummary) });
    }
    return { ok: true, plain, useCustom: [...customUids] };
  }
  const needCustom = Math.max(0, n - plain);
  if (needCustom > customUids.length) {
    return fail("custom_copies_protected", "Some of these Pokémon have TM-trained moves. Choose them individually to confirm.", {
      plain,
      protected: customCopiesOf(user, id, variant).map(copySummary),
    });
  }
  return { ok: true, plain, useCustom: customUids.slice(0, needCustom) };
}

/**
 * Remove `n` copies of id:variant (plain copies first). IN PLACE on success
 * only. Prunes an empty species entry and resets the Level when the last
 * copy of the variant is gone.
 * @returns {{ok:true, removedCustom:string[]} | {ok:false, code, error, ...}}
 */
export function removeCopies(user, args) {
  const check = canRemoveCopies(user, args);
  if (!check.ok) return check;
  const { id, variant, n } = args;
  user.pokemon[id][variant] = countOf(user, id, variant) - n;
  for (const uid of check.useCustom) dropCustom(user, uid);
  resetLevelIfGone(user, id, variant);
  pruneEmptyLine(user, id);
  return { ok: true, removedCustom: check.useCustom };
}

/**
 * Move ONE copy from one line to another (evolution: species changes;
 * shiny craft: variant changes). The target keeps the higher Level
 * (carryLevel). With `uid`, that customized copy's record moves with it
 * and keeps its uid; without one, a plain copy is used, and the request is
 * refused if only customized copies remain.
 */
export function canTransformCopy(user, { from, to, uid = null, confirmRev = undefined }) {
  if (!VARIANTS.has(from?.variant) || !VARIANTS.has(to?.variant)) return fail("bad_request", "Invalid variant.");
  if (!Number.isInteger(Number(from.id)) || !Number.isInteger(Number(to.id))) return fail("bad_request", "Invalid Pokémon.");
  if (Number(from.id) === Number(to.id) && from.variant === to.variant) return fail("bad_request", "Nothing to change.");
  if (countOf(user, from.id, from.variant) < 1) return fail("not_owned", "You don't own that Pokémon.");
  if (uid != null) {
    const named = checkNamedCustoms(user, from.id, from.variant, [uid], { [uid]: confirmRev });
    if (named) return named;
    return { ok: true, record: user.customPokemon[uid] };
  }
  if (plainCount(user, from.id, from.variant) < 1) {
    return fail("choose_copy", "These Pokémon have TM-trained moves. Choose which one to use.", {
      protected: customCopiesOf(user, from.id, from.variant).map(copySummary),
    });
  }
  return { ok: true, record: null };
}

export function transformCopy(user, args) {
  const check = canTransformCopy(user, args);
  if (!check.ok) return check;
  const { from, to } = args;
  const { record } = check;

  user.pokemon[from.id][from.variant] = countOf(user, from.id, from.variant) - 1;
  user.pokemon[to.id] ??= { normal: 0, shiny: 0 };
  user.pokemon[to.id][to.variant] = countOf(user, to.id, to.variant) + 1;
  carryLevel(user, { id: from.id, variant: from.variant }, { id: to.id, variant: to.variant });
  if (record) {
    record.speciesId = Number(to.id);
    record.variant = to.variant;
    record.rev = (record.rev ?? 0) + 1;
    if (Array.isArray(record.history)) {
      record.history.push({ type: Number(from.id) !== Number(to.id) ? "evolve" : "shiny", from: `${from.id}:${from.variant}`, to: `${to.id}:${to.variant}`, at: Date.now() });
    }
  }
  resetLevelIfGone(user, from.id, from.variant);
  pruneEmptyLine(user, from.id);
  return { ok: true, movedCustom: record ? record.uid : null };
}

/** Admin full wipe (/resetuser): every copy and every customized record. */
export function wipeCollection(user) {
  user.pokemon = {};
  delete user.customPokemon;
}

/**
 * Invariant I-1: customized records per line never exceed the copies owned.
 * Report-only. @returns {string[]} problems, e.g. ["6:normal 3 custom > 2 owned"]
 */
export function ownershipProblems(user) {
  const per = new Map();
  for (const c of Object.values(user?.customPokemon ?? {})) {
    if (!c || c.suspended) continue;
    const k = `${Number(c.speciesId)}:${c.variant}`;
    per.set(k, (per.get(k) ?? 0) + 1);
  }
  const out = [];
  for (const [k, n] of per) {
    const [id, variant] = k.split(":");
    const owned = countOf(user, id, variant);
    if (n > owned) out.push(`${k} ${n} custom > ${owned} owned`);
  }
  return out;
}

// ==========================================================
// Phase T1: customized-copy records in teams and normalization
// ==========================================================

/**
 * The customized copy a team slot points at, or null. A slot's `uid` counts
 * only when the record exists, is not suspended and belongs to the slot's
 * exact line (species + variant). Read-only.
 */
export function slotCopyUid(user, slot) {
  const uid = slot && typeof slot === "object" ? slot.uid : undefined;
  if (typeof uid !== "string" || !CUSTOM_UID_PATTERN.test(uid)) return null;
  const c = user?.customPokemon?.[uid];
  if (!c || c.suspended) return null;
  return Number(c.speciesId) === Number(slot.id) && c.variant === (slot.variant === "shiny" ? "shiny" : "normal") ? uid : null;
}

function quarantine(user, key, value, reason) {
  if (!Array.isArray(user.customPokemonLegacy)) user.customPokemonLegacy = [];
  let json;
  try { json = JSON.stringify(value) ?? String(value); } catch { json = String(value); }
  if (user.customPokemonLegacy.some((e) => e && e.key === key && e.reason === reason && e.value === json)) return;
  user.customPokemonLegacy.push({ key: String(key), value: json, reason, at: new Date().toISOString() });
}

/**
 * IN PLACE, idempotent. Never creates the field, never deletes a valid
 * record, never changes Pokémon counts (docs/tm-system TM-DATA-MIGRATION §3):
 *   1. field absent → nothing; not a plain object → quarantined, removed
 *   2. malformed records → quarantined (customPokemonLegacy), not deleted
 *   3. invariant I-1: when a line has more records than copies (only after a
 *      rollback to code without this service), the NEWEST excess records are
 *      marked suspended; when copies come back, they are restored
 *   4. team slots keep `uid` only when slotCopyUid() accepts it
 *   5. per-copy movesets ("u:<uid>") whose record is gone are dropped
 * @returns {{ changed: boolean, quarantined: number, suspended: number, restored: number }}
 */
export function normalizeCustomPokemon(user) {
  const res = { changed: false, quarantined: 0, suspended: 0, restored: 0 };
  if (!user || typeof user !== "object") return res;

  if ("customPokemon" in user) {
    const all = user.customPokemon;
    if (!all || typeof all !== "object" || Array.isArray(all)) {
      quarantine(user, "(customPokemon)", all, "customPokemon was not an object");
      delete user.customPokemon;
      res.quarantined++;
      res.changed = true;
    } else {
      for (const [key, c] of Object.entries(all)) {
        const why =
          !CUSTOM_UID_PATTERN.test(key) ? "bad uid"
          : !c || typeof c !== "object" || Array.isArray(c) ? "record was not an object"
          : c.uid !== key ? "uid does not match its key"
          : !Number.isInteger(c.speciesId) || !getSpeciesEntry(c.speciesId) ? "unknown species"
          : !VARIANTS.has(c.variant) ? "bad variant"
          : !Array.isArray(c.tmMoves) || c.tmMoves.some((m) => typeof m !== "string" || m.length > 40) ? "bad tmMoves"
          : null;
        if (why) {
          quarantine(user, key, c, why);
          delete all[key];
          res.quarantined++;
          res.changed = true;
          continue;
        }
        const moves = [...new Set(c.tmMoves)];
        if (moves.length !== c.tmMoves.length) { c.tmMoves = moves; res.changed = true; }
        if (!Number.isInteger(c.rev) || c.rev < 0) { c.rev = 0; res.changed = true; }
        if (!Array.isArray(c.history)) { c.history = []; res.changed = true; }
      }

      // 3. I-1 per line: oldest records keep their copies first.
      const lines = new Map();
      for (const c of Object.values(all)) {
        const k = `${c.speciesId}:${c.variant}`;
        if (!lines.has(k)) lines.set(k, []);
        lines.get(k).push(c);
      }
      for (const [k, recs] of lines) {
        const [id, variant] = k.split(":");
        let room = countOf(user, id, variant);
        recs.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.uid.localeCompare(b.uid));
        for (const c of recs) {
          if (room > 0) {
            room--;
            if (c.suspended === "invariant") { delete c.suspended; res.restored++; res.changed = true; }
          } else if (!c.suspended) {
            c.suspended = "invariant";
            res.suspended++;
            res.changed = true;
          }
        }
      }
      if (Object.keys(all).length === 0) { delete user.customPokemon; res.changed = true; }
    }
  }

  // 4. team slots: keep a uid only when it is valid for that slot.
  for (const field of ["displayedPokemon", "battleTeam"]) {
    if (!Array.isArray(user[field])) continue;
    for (const slot of user[field]) {
      if (slot && typeof slot === "object" && "uid" in slot && !slotCopyUid(user, slot)) {
        delete slot.uid;
        res.changed = true;
      }
    }
  }
  // 5. per-copy movesets without a record.
  for (const team of Object.values(user.movesets ?? {})) {
    if (!team || typeof team !== "object") continue;
    for (const k of Object.keys(team)) {
      if (k.startsWith("u:") && !user.customPokemon?.[k.slice(2)]) { delete team[k]; res.changed = true; }
    }
  }
  return res;
}

// ==========================================================
// Phase T4: creating trained copies and keeping them on their team slots
// ==========================================================

const UID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const COPY_HISTORY_MAX = 20;

/** A fresh, unused trained-copy id ("c_" + 10 base62 chars from crypto). */
export function newCopyUid(user) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = randomBytes(10);
    let uid = "c_";
    for (const b of bytes) uid += UID_ALPHABET[b % UID_ALPHABET.length];
    if (!user?.customPokemon?.[uid]) return uid;
  }
  throw new Error("newCopyUid: could not find a free id");
}

/**
 * Turn ONE untrained copy of id:variant into a trained copy (record with no
 * moves yet). Counts don't change: the copy just stops being untrained.
 * Caller (TM teaching) has validated everything and adds the move next.
 */
export function createTrainedCopy(user, id, variant, now = Date.now()) {
  if (plainCount(user, id, variant) < 1) return fail("choose_copy", "You have no untrained copy of that Pokémon left.");
  const uid = newCopyUid(user);
  user.customPokemon ??= {};
  user.customPokemon[uid] = { uid, speciesId: Number(id), variant, tmMoves: [], rev: 0, history: [], createdAt: now };
  return { ok: true, uid };
}

/** Add a TM-learned move to a trained copy (deduplicated), bump rev, record history. */
export function learnTmMove(user, uid, moveId, { item = null, requestId = null, now = Date.now() } = {}) {
  const c = user?.customPokemon?.[uid];
  if (!c || c.suspended) return fail("unknown_copy", "That Pokémon copy no longer exists.");
  if (!c.tmMoves.includes(moveId)) c.tmMoves.push(moveId);
  c.rev = (c.rev ?? 0) + 1;
  c.history.push({ type: "tm", move: moveId, ...(item && { item }), at: now, ...(requestId && { req: requestId }) });
  if (c.history.length > COPY_HISTORY_MAX) c.history.splice(0, c.history.length - COPY_HISTORY_MAX);
  return { ok: true, rev: c.rev };
}

/**
 * Point every UNTRAINED slot of this line (both teams) at trained copy `uid`
 * (owner decision, T4). Slots already holding another trained copy stay.
 * @returns {string[]} the teams changed ("display" / "battle")
 */
export function assignLineSlotsToCopy(user, id, variant, uid) {
  const changed = [];
  for (const [field, team] of [["displayedPokemon", "display"], ["battleTeam", "battle"]]) {
    if (!Array.isArray(user?.[field])) continue;
    for (const slot of user[field]) {
      if (slot && typeof slot === "object" && Number(slot.id) === Number(id) && (slot.variant === "shiny" ? "shiny" : "normal") === variant && !slotCopyUid(user, slot)) {
        slot.uid = uid;
        changed.push(team);
      }
    }
  }
  return changed;
}

/**
 * Team saves from clients that don't know about trained copies (older pages,
 * /api/updateUser) send slots without `uid`. For each slot of `next`: a uid
 * the client sent is used when valid; an explicit `uid: null` means an
 * untrained copy; NO uid field keeps the trained copy that line's slot held
 * in `previous`. Returns a new array; never invents a copy.
 */
export function carryCopyUids(user, previous, next, raw = []) {
  const prevUid = new Map();
  for (const s of Array.isArray(previous) ? previous : []) {
    const uid = s && typeof s === "object" ? slotCopyUid(user, s) : null;
    const key = s && typeof s === "object" ? `${Number(s.id)}:${s.variant === "shiny" ? "shiny" : "normal"}` : null;
    if (uid && key && !prevUid.has(key)) prevUid.set(key, uid);
  }
  const rawByKey = new Map();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const key = `${Number(r.id)}:${r.variant === "shiny" || (r.variant == null && (r.shiny === true || r.isShiny === true)) ? "shiny" : "normal"}`;
    if (!rawByKey.has(key)) rawByKey.set(key, r);
  }
  return (Array.isArray(next) ? next : []).map((slot) => {
    const key = `${Number(slot.id)}:${slot.variant === "shiny" ? "shiny" : "normal"}`;
    const r = rawByKey.get(key);
    const { uid: _drop, ...base } = slot;
    let uid;
    if (r && Object.prototype.hasOwnProperty.call(r, "uid")) uid = r.uid == null ? null : slotCopyUid(user, { ...base, uid: r.uid });
    else uid = slot.uid ? slotCopyUid(user, slot) : prevUid.get(key) ?? null;
    return uid ? { ...base, uid } : base;
  });
}

/**
 * Read-only (T5): every line's trained copies for dashboard choosers.
 * { "6:normal": [{ uid, rev, tmMoves: [{id,name,type,category,power}], teams: {display, battle} }] }
 * Move names come from battle data; unknown ids are shown as their id.
 */
export function trainedSummary(user, moveName = defaultMoveInfo) {
  const out = {};
  const slotIn = (field, uid) => {
    const list = Array.isArray(user?.[field]) ? user[field] : [];
    const i = list.findIndex((s) => s && typeof s === "object" && s.uid === uid);
    return i < 0 ? null : i + 1;
  };
  for (const c of Object.values(user?.customPokemon ?? {})) {
    if (!c || c.suspended) continue;
    const k = `${Number(c.speciesId)}:${c.variant}`;
    (out[k] ??= []).push({
      uid: c.uid,
      rev: c.rev ?? 0,
      tmMoves: (c.tmMoves ?? []).map(moveName),
      teams: { display: slotIn("displayedPokemon", c.uid), battle: slotIn("battleTeam", c.uid) },
    });
  }
  return out;
}

function defaultMoveInfo(id) {
  const m = getMove(id);
  return m ? { id, name: m.name, type: m.type ?? null, category: m.category ?? null, power: m.power ?? null } : { id, name: String(id), type: null, category: null, power: null };
}
