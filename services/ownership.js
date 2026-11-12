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

import { getSpeciesEntry } from "../utils/speciesCatalog.js";
import { getMove } from "../utils/battle/data.js";
import { expForLevel, floorLevel } from "../utils/training.js";
import {
  COPY_UID_PATTERN, copyOf, copiesOf, spareCopies, isOnTeam, slotsHolding, takeCopy,
  syncLine, registerDex, newCopyUid as newBoxUid, TEAM_FIELDS, normalizeBox,
} from "./box.js";

// Users built or changed outside the normal load path (tests, older code
// that still writes counts) are reconciled before any ownership decision.
const ensureBox = (user) => { if (user && typeof user === "object") normalizeBox(user); };

// Individual copies (docs/adr/0001): every copy lives in user.box; the counts
// in user.pokemon are derived from it (services/box.js syncLine).

const VARIANTS = new Set(["normal", "shiny"]);
/** Server-generated copy ids: "c_" + 10 base62 characters (box and trained records). */
export const CUSTOM_UID_PATTERN = COPY_UID_PATTERN;
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

/** Copies of id:variant with no TM moves. */
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

// Validate player-picked untrained copies (`uids`) of this line.
function checkNamedPlain(user, id, variant, uids, allowTeam) {
  if (!Array.isArray(uids)) return fail("bad_request", "Invalid copy list.");
  if (new Set(uids).size !== uids.length) return fail("bad_request", "A copy is listed twice.");
  for (const uid of uids) {
    const rec = copyOf(user, uid);
    if (!rec || Number(rec.id) !== Number(id) || (rec.shiny ? "shiny" : "normal") !== variant) return fail("unknown_copy", "That Pokémon copy no longer exists.");
    if (user?.customPokemon?.[uid] && !user.customPokemon[uid].suspended) return fail("bad_request", "Confirm TM-trained Pokémon individually.");
    if (!allowTeam && isOnTeam(user, uid)) return fail("on_team", "That Pokémon is on a team. Take it off the team first.");
  }
  return null;
}

/**
 * Check (without changing anything) whether `n` copies of id:variant can be
 * removed. Same result as removeCopies, minus the mutation.
 *   uids        untrained copies the player picked (used first)
 *   customUids  trained copies the player confirmed (with confirmRevs)
 *   exact       remove exactly the named trained copies, untrained for the rest
 *   allowTeam   admin only: copies on a Team may be taken (their slots empty)
 * Untrained copies are otherwise taken lowest Level first, never from a Team.
 */
export function canRemoveCopies(user, { id, variant, n, uids = [], customUids = [], confirmRevs = {}, exact = false, allowTeam = false }) {
  ensureBox(user);
  if (!VARIANTS.has(variant)) return fail("bad_request", "Invalid variant.");
  if (!Number.isInteger(n) || n < 1) return fail("bad_request", "Invalid count.");
  const owned = countOf(user, id, variant);
  if (owned < n) return fail("not_owned", "You don't own enough of that Pokémon.", { owned });
  const named = checkNamedCustoms(user, id, variant, customUids, confirmRevs) ?? checkNamedPlain(user, id, variant, uids, allowTeam);
  if (named) return named;
  if (uids.length > n) return fail("bad_request", "Too many copies listed.");
  const picked = new Set(uids);
  const teamPlain = copiesOf(user, id, variant).filter((c) => !c.trained && isOnTeam(user, c.uid)).sort((a, b) => a.exp - b.exp);
  const auto = [...spareCopies(user, id, variant), ...(allowTeam ? teamPlain : [])]
    .filter((c) => !picked.has(c.uid))
    .map((c) => c.uid);
  const plain = uids.length + auto.length;
  const short = (need) => (customCopiesOf(user, id, variant).length > 0
    ? fail("custom_copies_protected", "Some of these Pokémon have TM-trained moves. Choose them individually to confirm.", { plain, protected: customCopiesOf(user, id, variant).map(copySummary) })
    : fail("on_team", teamPlain.length ? "Some of these Pokémon are on a team. Take them off the team first." : "You don't own enough of that Pokémon.", { plain, need }));
  if (exact) {
    if (customUids.length + uids.length > n) return fail("bad_request", "Too many copies listed.");
    const rest = n - customUids.length - uids.length;
    if (rest > auto.length) return short(rest);
    return { ok: true, plain, usePlain: [...uids, ...auto.slice(0, rest)], useCustom: [...customUids] };
  }
  const needCustom = Math.max(0, n - plain);
  if (needCustom > customUids.length) return short(needCustom);
  return { ok: true, plain, usePlain: [...uids, ...auto].slice(0, n - needCustom), useCustom: customUids.slice(0, needCustom) };
}

/**
 * Remove `n` copies of id:variant. IN PLACE on success only.
 * @returns {{ok:true, removedCustom:string[], removed:{uid, rec, custom}[]} | {ok:false, code, error, ...}}
 */
export function removeCopies(user, args) {
  const check = canRemoveCopies(user, args);
  if (!check.ok) return check;
  const removed = [];
  for (const uid of [...check.usePlain, ...check.useCustom]) {
    const taken = takeCopy(user, uid);
    if (taken) removed.push({ uid, ...taken });
  }
  pruneEmptyLine(user, args.id);
  return { ok: true, removedCustom: check.useCustom, removed };
}

/**
 * Move ONE copy from one line to another (evolution: species changes;
 * shiny craft: variant changes). The copy keeps its uid, its Level (raised
 * to the new species' floor if lower), its TM moves and its Team slots.
 * `uid` names the copy (a trained one needs confirmRev); without one, the
 * highest-Level spare (untrained, on no Team) is used.
 */
export function canTransformCopy(user, { from, to, uid = null, confirmRev = undefined }) {
  ensureBox(user);
  if (!VARIANTS.has(from?.variant) || !VARIANTS.has(to?.variant)) return fail("bad_request", "Invalid variant.");
  if (!Number.isInteger(Number(from.id)) || !Number.isInteger(Number(to.id))) return fail("bad_request", "Invalid Pokémon.");
  if (Number(from.id) === Number(to.id) && from.variant === to.variant) return fail("bad_request", "Nothing to change.");
  if (countOf(user, from.id, from.variant) < 1) return fail("not_owned", "You don't own that Pokémon.");
  if (uid != null) {
    const custom = user?.customPokemon?.[uid];
    if (custom && !custom.suspended) {
      const named = checkNamedCustoms(user, from.id, from.variant, [uid], { [uid]: confirmRev });
      if (named) return named;
      return { ok: true, uid, record: custom };
    }
    const named = checkNamedPlain(user, from.id, from.variant, [uid], true);
    if (named) return named;
    return { ok: true, uid, record: null };
  }
  const spares = spareCopies(user, from.id, from.variant);
  if (spares.length < 1) {
    return fail("choose_copy", "Choose which of these Pokémon to use.", {
      protected: customCopiesOf(user, from.id, from.variant).map(copySummary),
    });
  }
  return { ok: true, uid: spares[spares.length - 1].uid, record: null };
}

export function transformCopy(user, args) {
  const check = canTransformCopy(user, args);
  if (!check.ok) return check;
  const { from, to } = args;
  const { record, uid } = check;
  const rec = copyOf(user, uid);
  rec.id = Number(to.id);
  if (to.variant === "shiny") rec.shiny = true; else delete rec.shiny;
  rec.exp = Math.max(Number(rec.exp) || 0, expForLevel(floorLevel(Number(to.id))));
  for (const { field, index } of slotsHolding(user, uid)) {
    user[field][index].id = Number(to.id);
    user[field][index].variant = to.variant;
  }
  if (record) {
    record.speciesId = Number(to.id);
    record.variant = to.variant;
    record.rev = (record.rev ?? 0) + 1;
    if (Array.isArray(record.history)) {
      record.history.push({ type: Number(from.id) !== Number(to.id) ? "evolve" : "shiny", from: `${from.id}:${from.variant}`, to: `${to.id}:${to.variant}`, at: Date.now() });
    }
  }
  syncLine(user, from.id, from.variant);
  syncLine(user, to.id, to.variant);
  const dex = registerDex(user, to.id, to.variant);
  pruneEmptyLine(user, from.id);
  return { ok: true, uid, movedCustom: record ? record.uid : null, ...dex };
}

/** Admin full wipe (/resetuser): every copy, every trained record and the Pokédex. */
export function wipeCollection(user) {
  user.pokemon = {};
  user.box = {};
  delete user.customPokemon;
  delete user.training;
  delete user.pokedex;
}

/** The copy a team slot stands for (any copy of the slot's line), or null. */
export function slotBoxUid(user, slot) {
  const uid = slot && typeof slot === "object" ? slot.uid : undefined;
  const rec = copyOf(user, uid);
  if (!rec) return null;
  return Number(rec.id) === Number(slot.id) && (rec.shiny ? "shiny" : "normal") === (slot.variant === "shiny" ? "shiny" : "normal") ? uid : null;
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

  // 4. team slots: keep a uid only when it names a copy of that slot's line
  // (services/box.js normalizeBox fills in the rest).
  for (const field of TEAM_FIELDS) {
    if (!Array.isArray(user[field])) continue;
    for (const slot of user[field]) {
      if (slot && typeof slot === "object" && "uid" in slot && !slotCopyUid(user, slot) && !slotBoxUid(user, slot)) {
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

export const COPY_HISTORY_MAX = 20;

/** A fresh, unused copy id ("c_" + 10 base62 chars from crypto). */
export const newCopyUid = newBoxUid;

/**
 * Turn ONE untrained copy of id:variant into a trained copy (record with no
 * moves yet). Counts don't change: the copy just stops being untrained.
 * `uid` names the copy; otherwise the best untrained copy on a Team is used,
 * then the best untrained copy. Caller (TM teaching) has validated
 * everything and adds the move next.
 */
export function createTrainedCopy(user, id, variant, now = Date.now(), uid = null) {
  ensureBox(user);
  const untrained = copiesOf(user, id, variant).filter((c) => !c.trained);
  if (untrained.length < 1) return fail("choose_copy", "You have no untrained copy of that Pokémon left.");
  if (uid != null && !untrained.some((c) => c.uid === uid)) return fail("choose_copy", "That Pokémon already has TM-trained moves or no longer exists.");
  uid ??= (untrained.find((c) => isOnTeam(user, c.uid)) ?? untrained[0]).uid;
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
 * Teams whose slots hold copy `uid` (it is a specific Pokémon now, so it
 * already sits in its own slots; nothing is repointed).
 * @returns {string[]} ("display" / "battle" / "showcase")
 */
export function assignLineSlotsToCopy(user, id, variant, uid) {
  const name = { displayedPokemon: "display", battleTeam: "battle", showcaseTeam: "showcase" };
  return slotsHolding(user, uid).map((s) => name[s.field]);
}

/**
 * Team saves from clients that don't know about trained copies (older pages,
 * /api/updateUser) send slots without `uid`. For each slot of `next`: a uid
 * the client sent is used when valid; an explicit `uid: null` means an
 * untrained copy; NO uid field keeps the trained copy that line's slot held
 * in `previous`. Returns a new array; never invents a copy.
 */
export function carryCopyUids(user, previous, next, raw = []) {
  // Per line, the copies that line's slots held before (in slot order).
  const lineKey = (s) => `${Number(s.id)}:${s.variant === "shiny" ? "shiny" : "normal"}`;
  const prevUids = new Map();
  for (const s of Array.isArray(previous) ? previous : []) {
    const uid = s && typeof s === "object" ? slotBoxUid(user, s) ?? slotCopyUid(user, s) : null;
    if (uid) (prevUids.get(lineKey(s)) ?? prevUids.set(lineKey(s), []).get(lineKey(s))).push(uid);
  }
  const rawByKey = new Map();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const key = `${Number(r.id)}:${r.variant === "shiny" || (r.variant == null && (r.shiny === true || r.isShiny === true)) ? "shiny" : "normal"}`;
    (rawByKey.get(key) ?? rawByKey.set(key, []).get(key)).push(r);
  }
  const used = new Set();
  const valid = (base, uid) => (uid && !used.has(uid) && (slotBoxUid(user, { ...base, uid }) || slotCopyUid(user, { ...base, uid })) ? uid : null);
  return (Array.isArray(next) ? next : []).map((slot) => {
    const key = lineKey(slot);
    const r = rawByKey.get(key)?.shift();
    const { uid: _drop, ...base } = slot;
    let uid = null;
    if (r && Object.prototype.hasOwnProperty.call(r, "uid")) {
      // explicit null: an untrained copy (services/box.js normalizeBox picks one)
      uid = r.uid == null ? null : valid(base, r.uid);
    } else {
      uid = valid(base, slot.uid) ?? (prevUids.get(key) ?? []).map((u) => valid(base, u)).find(Boolean) ?? null;
    }
    if (uid) used.add(uid);
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
