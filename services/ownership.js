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

import { carryLevel, resetLevelIfGone } from "../utils/training.js";

const VARIANTS = new Set(["normal", "shiny"]);
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
export function canRemoveCopies(user, { id, variant, n, customUids = [], confirmRevs = {} }) {
  if (!VARIANTS.has(variant)) return fail("bad_request", "Invalid variant.");
  if (!Number.isInteger(n) || n < 1) return fail("bad_request", "Invalid count.");
  const owned = countOf(user, id, variant);
  if (owned < n) return fail("not_owned", "You don't own enough of that Pokémon.", { owned });
  const named = checkNamedCustoms(user, id, variant, customUids, confirmRevs);
  if (named) return named;
  const plain = plainCount(user, id, variant);
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
