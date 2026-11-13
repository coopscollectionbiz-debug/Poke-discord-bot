// ==========================================================
// services/tmTeaching.js — teaching TMs (TM system phase T4).
//
// Pure functions; the routes add the session check, the user lock and the
// save through runInventoryTransaction (requestId: a retried or
// double-clicked teach applies once). Owner decisions (2026-11-11 grill):
//   • A taught move stays learned by that copy forever (D-T2), no cap (D-T3).
//   • Teaching an untrained copy makes it a trained copy, and every
//     untrained team slot of that Pokémon + Variant switches to it.
//   • A move the copy can already use (level-up at its current Level, or a
//     TM it learned) is refused and the TM is kept.
//   • For each team the copy is on, the player chose in the dialog: add the
//     move (fewer than 4 selected), replace one move, or keep the moves.
//     Nothing is replaced without that choice.
//   • If anything changed since the dialog opened (the copy, the untrained
//     copies, a team's moves), the whole teach is refused and the TM kept.
//   • Every check runs before anything changes; the TM is spent only in
//     the same synchronous block that teaches the move.
// ==========================================================

import { getCatalogItem } from "../catalog/items.js";
import { getQuantity, consumeItem } from "./inventory.js";
import { canLearnByTm, moveIdForTmItem } from "../utils/battle/tmData.js";
import { getSpecies } from "../utils/battle/data.js";
import { defaultMoves } from "./fullSimCutover.js";
import { getTraining } from "../utils/training.js";
import { isTmEnabled } from "../config/tmFeatures.js";
import { learnableMoves, chosenMoves, setMoveset, moveInfo, MAX_MOVES, TEAM_TYPES } from "./movesets.js";
import { plainCount, customCopiesOf, slotCopyUid, slotBoxUid, createTrainedCopy, learnTmMove, assignLineSlotsToCopy } from "./ownership.js";
import { copyTraining } from "./box.js";

const TEAM_FIELD = { display: "displayedPokemon", battle: "battleTeam" };
const fail = (status, error, code, extra = {}) => ({ ok: false, status, error, code, ...extra });
const normV = (v) => (v === "shiny" ? "shiny" : "normal");

/** 1-based slot of the target copy on one team, or null. uid null = an untrained slot of the line. */
function slotOf(user, team, id, variant, uid) {
  const list = Array.isArray(user?.[TEAM_FIELD[team]]) ? user[TEAM_FIELD[team]] : [];
  // Every slot names its copy (docs/adr/0001): a named copy is matched by uid.
  const i = list.findIndex((s) => s && typeof s === "object" && Number(s.id) === id && normV(s.variant) === variant && (uid ? s.uid === uid : (slotCopyUid(user, s) ?? null) === null));
  return i < 0 ? null : i + 1;
}

/** The moves this copy battles with on `team` now (its selection, else automatic; full sim: as recorded at cutover). */
function effectiveMoves(user, team, id, variant, uid) {
  return chosenMoves(user, team, id, variant, { uid }) ?? defaultMoves(user, { id, variant, uid }, (uid && copyTraining(user, uid)?.level) ?? getTraining(user, id, variant).level);
}

/** Teams the target copy is on → { team: { slot, moves } }. */
function teamsOf(user, id, variant, uid) {
  const out = {};
  for (const team of TEAM_TYPES) {
    const slot = slotOf(user, team, id, variant, uid);
    if (slot) out[team] = { slot, moves: effectiveMoves(user, team, id, variant, uid) };
  }
  return out;
}

/**
 * What the teach dialog needs for one Pokémon + Variant: the copies you can
 * teach (untrained group + each trained copy), their teams and moves, and
 * every owned TM with its status per copy. Server-derived only.
 */
export function teachOptions(user, { speciesId, variant }, { env = process.env } = {}) {
  const id = Number(speciesId);
  const v = normV(variant);
  if (!isTmEnabled(env)) return { ok: true, enabled: false };
  if (!Number.isInteger(id) || !getSpecies(id)) return fail(404, "Unknown Pokémon.", "bad_species");
  if (!(Number(user?.pokemon?.[id]?.[v]) > 0)) return fail(400, "You don't own that Pokémon.", "unowned");
  const level = getTraining(user, id, v).level;
  const targets = [];
  const plain = plainCount(user, id, v);
  if (plain > 0) targets.push({ key: "untrained", uid: null, rev: null, count: plain, tmMoves: [], teams: teamsOf(user, id, v, null) });
  for (const c of customCopiesOf(user, id, v)) {
    targets.push({ key: c.uid, uid: c.uid, rev: c.rev ?? 0, count: 1, tmMoves: c.tmMoves.map(moveInfo), teams: teamsOf(user, id, v, c.uid) });
  }
  for (const t of targets) for (const team of Object.keys(t.teams)) t.teams[team].moves = t.teams[team].moves.map(moveInfo);

  const tms = [];
  for (const itemId of Object.keys(user?.items ?? {})) {
    const move = moveIdForTmItem(itemId);
    const entry = move && getCatalogItem(itemId);
    if (!entry || entry.status !== "active" || !(getQuantity(user, itemId) > 0)) continue;
    const compatible = canLearnByTm(id, move);
    const status = {};
    for (const t of targets) {
      status[t.key] = !compatible ? "incompatible" : learnableMoves(user, id, v, { uid: t.uid }).some((m) => m.id === move) ? "known" : "teachable";
    }
    tms.push({ item: itemId, owned: getQuantity(user, itemId), ...moveInfo(move), accuracy: entry.tm.accuracy, status });
  }
  tms.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, enabled: true, speciesId: id, variant: v, level, maxMoves: MAX_MOVES, targets, tms };
}

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Teach one TM. IN PLACE on success only.
 * @param {object} req { item, pokeId, variant, uid|null, rev, expect: {team:[moveIds]}, equip: {team: "add"|"keep"|{replace}} }
 * @returns {{ok:true, ...} | {ok:false, status, error, code}}
 */
export function teachTm(user, req = {}, { env = process.env, now = Date.now(), requestId = null } = {}) {
  if (!isTmEnabled(env)) return fail(403, "TMs aren't available yet.", "disabled");
  const id = Number(req.pokeId);
  const v = normV(req.variant);
  if (!Number.isInteger(id) || !getSpecies(id)) return fail(400, "Unknown Pokémon.", "bad_species");
  if (!(Number(user?.pokemon?.[id]?.[v]) > 0)) return fail(400, "You don't own that Pokémon.", "unowned");

  const move = moveIdForTmItem(req.item);
  const entry = move ? getCatalogItem(req.item) : null;
  if (!entry || entry.category !== "tm") return fail(400, "Unknown TM.", "unknown_tm");
  if (entry.status !== "active") return fail(400, `${entry.name} can't be used yet.`, "not_usable");
  if (getQuantity(user, entry.id) < 1) return fail(400, `You don't have ${entry.name}.`, "no_tm");
  if (!canLearnByTm(id, move)) return fail(400, `${getSpecies(id).name} can't learn ${moveInfo(move).name}.`, "incompatible");

  // Target copy: a named trained copy (with the rev the dialog showed) or an untrained one.
  let uid = null;
  let plainUid = null; // a named untrained copy (docs/adr/0001): it becomes the trained one
  if (req.uid != null) {
    uid = slotCopyUid(user, { id, variant: v, uid: req.uid });
    if (!uid) {
      plainUid = slotBoxUid(user, { id, variant: v, uid: req.uid });
      if (!plainUid) return fail(409, "That Pokémon changed since you opened this. Check and try again.", "stale_copy");
    } else if (req.rev !== (user.customPokemon[uid].rev ?? 0)) return fail(409, "That Pokémon changed since you opened this. Check and try again.", "stale_copy");
  } else if (plainCount(user, id, v) < 1) {
    return fail(409, "You have no untrained copy left. Check and try again.", "stale_copy");
  }
  if (learnableMoves(user, id, v, { uid: uid ?? plainUid }).some((m) => m.id === move)) {
    return fail(400, `It already knows ${moveInfo(move).name}.`, "already_known");
  }

  // Teams this copy is on: the dialog's view must still be current, and each
  // needs an explicit choice.
  const teams = teamsOf(user, id, v, uid ?? plainUid);
  const expect = req.expect && typeof req.expect === "object" ? req.expect : {};
  const equip = req.equip && typeof req.equip === "object" ? req.equip : {};
  for (const team of TEAM_TYPES) {
    const on = teams[team];
    if (!on) {
      if (expect[team] != null || equip[team] != null) return fail(409, "Your teams changed since you opened this. Check and try again.", "stale_moves");
      continue;
    }
    if (!sameList(expect[team], on.moves)) return fail(409, "Your moves changed in another window. Check and confirm again.", "stale_moves");
  }
  const plans = {};
  for (const [team, on] of Object.entries(teams)) {
    const choice = equip[team];
    if (choice === "keep") continue;
    if (choice === "add") {
      if (on.moves.length >= MAX_MOVES) return fail(400, "Choose a move to replace, or keep the current moves.", "bad_equip");
      plans[team] = [...on.moves, move];
    } else if (choice && typeof choice === "object" && typeof choice.replace === "string" && on.moves.includes(choice.replace)) {
      plans[team] = on.moves.map((m) => (m === choice.replace ? move : m));
    } else {
      return fail(400, "Choose what to do with each team's moves.", "bad_equip");
    }
  }

  // ---- apply: everything below runs together (no refusal possible) ----
  const spent = consumeItem(user, entry.id, 1);
  if (!spent.ok) return fail(400, spent.error ?? "Couldn't use the TM.", "no_tm");
  let created = false;
  if (!uid) {
    const made = createTrainedCopy(user, id, v, now, plainUid);
    if (!made.ok) throw new Error(`teachTm: ${made.code} after validation`);
    uid = made.uid;
    created = true;
  }
  const learned = learnTmMove(user, uid, move, { item: entry.id, requestId, now });
  if (!learned.ok) throw new Error(`teachTm: ${learned.code} after validation`);
  const slotsChanged = created ? assignLineSlotsToCopy(user, id, v, uid) : [];
  for (const [team, moves] of Object.entries(plans)) setMoveset(user, team, id, v, moves, { uid });

  const c = user.customPokemon[uid];
  return {
    ok: true,
    uid,
    rev: c.rev,
    created,
    move: moveInfo(move),
    item: entry.id,
    tmLeft: getQuantity(user, entry.id),
    tmMoves: c.tmMoves.map(moveInfo),
    slotsChanged,
    teams: Object.fromEntries(Object.keys(teamsOf(user, id, v, uid)).map((team) => [team, effectiveMoves(user, team, id, v, uid).map(moveInfo)])),
  };
}
