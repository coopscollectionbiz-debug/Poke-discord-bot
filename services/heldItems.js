// ==========================================================
// services/heldItems.js — held-item unlocks and team-scoped equipment.
//
// Ownership (amendment §2): a held item is a permanent account-wide UNLOCK,
// stored in the existing inventory as a quantity of 1 (catalog maxStack 1,
// granted only through services/inventory.js grantItem).
// Equipping never changes user.items: one unlock can be used once in EVERY
// team, so nothing can be duplicated or used up by equipment.
//
// Equipment (amendment §3) belongs to a team loadout, not to a Pokémon:
//
//   user.equipment = {
//     rev: 7,                                   // +1 on every change (stale-tab guard)
//     teams: {
//       display: { "u:c_7Hk2Qm9xLp": "leftovers" },   // member → item id
//       battle:  { "u:c_Ab3…": "leftovers", "94:normal": "focus_sash" },
// A member is the copy in the slot ("u:<uid>", docs/adr/0001: the item goes
// with that Pokémon when you swap which copy fills the slot); "<id>:<variant>"
// is the older per-line key, moved onto that line's copy on load
// (reconcileTeamEquipment).
//     },
//   }
//
// Team ids: "display" (user.displayedPokemon), "battle" (user.battleTeam).
// The id pattern also admits future saved Battle teams ("battle:<name>"),
// which this version stores untouched but can't edit or battle with.
//
// Rules, enforced here for every write and re-checked at battle time:
//   R1 one item per member (map shape)
//   R2 Item Clause: an item at most once per team
//   R3 only members of that team, as the team is SAVED, can hold items
//   R4 a member set to Mega Evolve on that team holds no regular item
//      (its slot shows the Mega Stone as a virtual placeholder)
//   R5 only owned, held-category catalog items; species items only on their species
//
// Everything here is synchronous and all-or-nothing; callers run it inside
// runInventoryTransaction (lock → replay → mutate → save).
// ==========================================================

import { getCatalogItem, isHeldItem } from "../catalog/items.js";
import { STARTER_HELD_ITEMS, STARTER_GRANT_VERSION } from "../catalog/heldItems.js";
import { getQuantity, grantItem } from "./inventory.js";
import { megaFieldOf } from "./megaTeam.js";
import { isHeldItemCapabilityEnabled } from "../config/features.js";
import { getMega } from "../utils/megas.js";

export const TEAM_ID_PATTERN = /^(display|battle)(:[a-z0-9-]{1,32})?$/;
export const EDITABLE_TEAMS = Object.freeze(["display", "battle"]);
export const LINE_PATTERN = /^\d{1,5}:(normal|shiny)$/;
/** A member key: the slot's copy, or (older data / no copy) its line. */
export const MEMBER_PATTERN = /^(\d{1,5}:(normal|shiny)|u:c_[A-Za-z0-9]{10})$/;
const DANGEROUS = new Set(["__proto__", "constructor", "prototype"]);
const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
const fail = (status, error, code, extra = {}) => ({ ok: false, status, error, code, ...extra });
export const lineKey = (id, variant) => `${Number(id)}:${variant === "shiny" ? "shiny" : "normal"}`;
export const memberKey = (s) => (s?.uid ? `u:${s.uid}` : lineKey(s.id, s.variant));
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// ----------------------------------------------------------
// Ownership
// ----------------------------------------------------------
/** The catalog entry for a held item id, or null. */
export function heldEntry(id) {
  const e = getCatalogItem(id);
  return isHeldItem(e) ? e : null;
}

/** Does the player own this held-item unlock? */
export const ownsHeldItem = (user, id) => !!heldEntry(id) && getQuantity(user, id) > 0;

/** Every held unlock the player owns (catalog order). */
export function ownedHeldItems(user) {
  return Object.keys(user?.items ?? {}).filter((id) => ownsHeldItem(user, id));
}

/**
 * The eight free starter unlocks, granted lazily and exactly once per
 * version (user.heldItemGrants.starter). Never overwrites inventory: an
 * item already owned is skipped. Idempotent: a second call changes nothing.
 * IN PLACE. Returns the ids granted by this call.
 */
export function ensureStarterHeldItems(user, { env = process.env } = {}) {
  if (!user || typeof user !== "object") return { changed: false, granted: [] };
  if (!isHeldItemCapabilityEnabled("starter", env, user.id ?? null)) return { changed: false, granted: [] };
  const grants = isPlainObject(user.heldItemGrants) ? user.heldItemGrants : null;
  const done = Number.isSafeInteger(grants?.starter) ? grants.starter : 0;
  if (done >= STARTER_GRANT_VERSION) return { changed: false, granted: [] };
  const granted = [];
  for (const id of STARTER_HELD_ITEMS) {
    if (getQuantity(user, id) > 0) continue;
    const r = grantItem(user, id, 1, { env });
    if (r.ok) granted.push(id);
  }
  user.heldItemGrants = { ...(grants ?? {}), starter: STARTER_GRANT_VERSION };
  return { changed: true, granted };
}

/** Is the starter grant still waiting for this player (feature on, not yet granted)? */
export function starterPending(user, { env = process.env } = {}) {
  if (!isHeldItemCapabilityEnabled("starter", env, user?.id ?? null)) return false;
  return !(Number(user?.heldItemGrants?.starter) >= STARTER_GRANT_VERSION);
}

// ----------------------------------------------------------
// Teams and equipment (reads)
// ----------------------------------------------------------
/** The saved slots of an editable team ([{ id, variant, uid?, mega? }]) or null when the team doesn't exist. */
export function teamSlots(user, teamId) {
  const raw = teamId === "display" ? user?.displayedPokemon : teamId === "battle" ? user?.battleTeam : undefined;
  if (!Array.isArray(raw)) return teamId === "display" ? [] : null;
  const out = [];
  const seen = new Set();
  for (const t of raw) {
    const id = Number(typeof t === "object" && t ? t.id : t);
    if (!Number.isInteger(id)) continue;
    const variant = t && typeof t === "object" && t.variant === "shiny" ? "shiny" : "normal";
    const uid = t && typeof t === "object" && typeof t.uid === "string" ? t.uid : null;
    const key = lineKey(id, variant); // each Pokémon once per team
    if (seen.has(key)) continue;
    seen.add(key);
    const mega = megaFieldOf(t);
    out.push({ id, variant, ...(uid ? { uid } : {}), ...(mega ? { mega } : {}) });
    if (out.length >= 6) break;
  }
  return out;
}

/** The equipment map for one team (read-only copy; {} when none). */
export function teamEquipment(user, teamId) {
  const m = user?.equipment?.teams?.[teamId];
  if (!isPlainObject(m)) return {};
  return Object.fromEntries(Object.entries(m).filter(([k, v]) => MEMBER_PATTERN.test(k) && typeof v === "string"));
}

export const equipmentRev = (user) => (Number.isSafeInteger(user?.equipment?.rev) && user.equipment.rev >= 0 ? user.equipment.rev : 0);

/** Can this species hold this item at all? (species-locked items) */
export function fitsSpecies(entry, speciesId) {
  const only = entry?.held?.restrictSpecies;
  return !only || only.includes(Number(speciesId));
}

/** The Mega Stone shown as a virtual placeholder for a Mega slot (display only). */
export function megaPlaceholder(slot) {
  if (!slot?.mega) return null;
  const f = getMega(slot.mega);
  const stone = f?.prerequisite?.kind === "stone" ? f.prerequisite.item : null;
  const entry = stone ? getCatalogItem(stone) : null;
  return {
    formId: slot.mega,
    name: f?.name ?? slot.mega,
    stone,
    stoneName: entry?.name ?? stone ?? "Mega Stone",
    icon: entry?.icon ? `/public/sprites/${entry.icon}` : null,
    iconSmooth: !!entry?.iconSmooth,
  };
}

/**
 * A read model of one team's loadout for the dashboard and cards.
 * [{ line, id, variant, item: id|null, megaSlot: {…}|null, issue: null|code }]
 */
export function describeLoadout(user, teamId) {
  const slots = teamSlots(user, teamId) ?? [];
  const eq = teamEquipment(user, teamId);
  return slots.map((s) => {
    const line = memberKey(s); // "line" kept as the field name the dashboard sends back
    const item = eq[line] ?? null;
    return { line, id: s.id, variant: s.variant, ...(s.uid ? { uid: s.uid } : {}), item: s.mega ? null : item, megaSlot: megaPlaceholder(s) };
  });
}

// ----------------------------------------------------------
// Writes (sync, all-or-nothing, IN PLACE)
// ----------------------------------------------------------
function ensureEquipment(user) {
  if (!isPlainObject(user.equipment)) user.equipment = { rev: 0, teams: {} };
  if (!isPlainObject(user.equipment.teams)) user.equipment.teams = {};
  if (!Number.isSafeInteger(user.equipment.rev) || user.equipment.rev < 0) user.equipment.rev = 0;
  return user.equipment;
}
function teamMap(user, teamId) {
  const eq = ensureEquipment(user);
  if (!isPlainObject(eq.teams[teamId])) eq.teams[teamId] = {};
  return eq.teams[teamId];
}
const bump = (user) => { ensureEquipment(user).rev += 1; };

/**
 * Validate an equip/move/remove request against R1–R5.
 * itemId null = remove. move true = take the item from the team-mate holding it.
 * @returns {{ok:true, slot, entry, from:string|null, replaced:string|null} | fail}
 */
export function checkEquip(user, { teamId, line, itemId, move = false }) {
  if (!EDITABLE_TEAMS.includes(teamId)) return fail(400, "Unknown team.", "bad_team");
  if (typeof line !== "string" || !MEMBER_PATTERN.test(line)) return fail(400, "Unknown Pokémon.", "bad_line");
  const slots = teamSlots(user, teamId);
  if (!slots) return fail(400, "You haven't set up that team yet.", "no_team");
  const slot = slots.find((s) => memberKey(s) === line);
  if (!slot) return fail(409, "That Pokémon isn't on this team (save your team first).", "not_member");
  const eq = teamEquipment(user, teamId);
  const current = eq[line] ?? null;
  if (itemId === null) return { ok: true, slot, entry: null, from: null, replaced: current };
  if (typeof itemId !== "string" || DANGEROUS.has(itemId)) return fail(400, "Unknown item.", "bad_item");
  const entry = heldEntry(itemId);
  if (!entry) return fail(400, "That isn't a held item.", "bad_item");
  if (slot.mega) return fail(409, "This Pokémon is set to Mega Evolve on this team: its Mega Stone uses the item slot.", "mega_slot");
  if (!ownsHeldItem(user, itemId)) return fail(409, `You haven't unlocked ${entry.name} yet.`, "not_owned");
  if (!fitsSpecies(entry, slot.id)) return fail(409, `${entry.name} can't be held by that Pokémon. ${entry.held.rule}`, "wrong_species");
  if (current === itemId) return { ok: true, slot, entry, from: null, replaced: null, unchanged: true };
  const holder = Object.keys(eq).find((k) => k !== line && eq[k] === itemId && slots.some((s) => memberKey(s) === k));
  if (holder && !move) return fail(409, `${entry.name} is already held by another Pokémon on this team. Move it instead?`, "item_clause", { holder });
  return { ok: true, slot, entry, from: holder ?? null, replaced: current };
}

/** Apply a validated equip/move/remove. Never touches user.items or another team. */
export function applyEquip(user, { teamId, line, itemId, move = false }) {
  const c = checkEquip(user, { teamId, line, itemId, move });
  if (!c.ok) return c;
  if (c.unchanged) return { ok: true, changed: false, teamId, line, item: itemId, from: null, replaced: null };
  if (itemId === null && !c.replaced) return { ok: true, changed: false, teamId, line, item: null, from: null, replaced: null };
  const map = teamMap(user, teamId);
  if (c.from) delete map[c.from];
  if (itemId === null) delete map[line];
  else map[line] = itemId;
  bump(user);
  return { ok: true, changed: true, teamId, line, item: itemId, from: c.from, replaced: c.replaced };
}

/**
 * Bring one team's equipment in line with R2–R5 after the team or the
 * collection changed. Only ever REMOVES assignments (never an unlock).
 * Returns the removed [{ line, item, reason }].
 */
export function reconcileTeamEquipment(user, teamId) {
  const m = user?.equipment?.teams?.[teamId];
  if (!isPlainObject(m)) return [];
  const slots = teamSlots(user, teamId) ?? [];
  // Older per-line keys move onto the first copy of that line on the team.
  for (const k of Object.keys(m)) {
    if (!LINE_PATTERN.test(k)) continue;
    const first = slots.find((s) => s.uid && lineKey(s.id, s.variant) === k);
    if (first && !own(m, `u:${first.uid}`)) { m[`u:${first.uid}`] = m[k]; delete m[k]; }
  }
  const order = new Map(slots.map((s, i) => [memberKey(s), { s, i }]));
  const removed = [];
  const drop = (line, reason) => { removed.push({ line, item: m[line], reason }); delete m[line]; };
  // Members first in slot order so the Item Clause keeps the earlier slot.
  const keys = Object.keys(m).sort((a, b) => (order.get(a)?.i ?? 99) - (order.get(b)?.i ?? 99) || a.localeCompare(b));
  const used = new Set();
  for (const line of keys) {
    const item = m[line];
    const member = order.get(line)?.s;
    if (DANGEROUS.has(line) || !MEMBER_PATTERN.test(line)) drop(line, "bad_line");
    else if (typeof item !== "string" || !heldEntry(item)) drop(line, "unknown_item");
    else if (!member) drop(line, "not_member");
    else if (member.mega) drop(line, "mega_slot");
    else if (!ownsHeldItem(user, item)) drop(line, "not_owned");
    else if (!fitsSpecies(heldEntry(item), member.id)) drop(line, "wrong_species");
    else if (used.has(item)) drop(line, "item_clause");
    else used.add(item);
  }
  if (!Object.keys(m).length) delete user.equipment.teams[teamId];
  if (removed.length) bump(user);
  return removed;
}

/**
 * Load-time repair (idempotent). Never creates `equipment`. Structural
 * problems are recorded in user.equipmentLegacy; the editable teams are
 * reconciled; future team ids with a valid shape are kept untouched.
 */
export function normalizeEquipment(user) {
  if (!user || typeof user !== "object" || !("equipment" in user)) return { changed: false, removed: [] };
  const removed = [];
  const quarantine = (key, value, reason) => {
    if (!Array.isArray(user.equipmentLegacy)) user.equipmentLegacy = [];
    let json;
    try { json = JSON.stringify(value) ?? String(value); } catch { json = String(value); }
    if (!user.equipmentLegacy.some((e) => e?.key === key && e?.value === json && e?.reason === reason)) {
      user.equipmentLegacy.push({ key, value: json, reason, at: new Date().toISOString() });
    }
    removed.push({ key, reason });
  };
  if (!isPlainObject(user.equipment)) {
    quarantine("(equipment)", user.equipment, "not an object");
    delete user.equipment;
    return { changed: true, removed };
  }
  const eq = user.equipment;
  if (!Number.isSafeInteger(eq.rev) || eq.rev < 0) eq.rev = 0;
  if (!isPlainObject(eq.teams)) {
    if (eq.teams !== undefined) quarantine("(equipment.teams)", eq.teams, "not an object");
    eq.teams = {};
  }
  for (const teamId of Object.keys(eq.teams)) {
    if (DANGEROUS.has(teamId) || !TEAM_ID_PATTERN.test(teamId) || !isPlainObject(eq.teams[teamId])) {
      quarantine(`teams.${teamId}`, eq.teams[teamId], "bad team");
      delete eq.teams[teamId];
      continue;
    }
    if (!EDITABLE_TEAMS.includes(teamId)) continue; // a future team: keep as stored
    for (const r of reconcileTeamEquipment(user, teamId)) {
      if (r.reason !== "not_member" && r.reason !== "mega_slot") quarantine(`teams.${teamId}.${r.line}`, r.item, r.reason);
      else removed.push({ key: `teams.${teamId}.${r.line}`, reason: r.reason });
    }
  }
  return { changed: removed.length > 0, removed };
}

/**
 * The items one team's members battle with: Map member key → item id. Re-validates
 * R2–R5 from scratch (fail-closed: anything doubtful battles with no item)
 * and checks the battle capability for that player. The Mega check uses the
 * stored slot's `mega` field; buildTeam additionally drops the item of the
 * slot that actually battles as a Mega.
 */
export function battleItems(user, teamId, { env = process.env } = {}) {
  const out = new Map();
  if (!isHeldItemCapabilityEnabled("battles", env, user?.id ?? null)) return out;
  const slots = teamSlots(user, teamId) ?? [];
  const eq = teamEquipment(user, teamId);
  const used = new Set();
  for (const s of slots) {
    const key = memberKey(s);
    const item = eq[key] ?? (s.uid ? eq[lineKey(s.id, s.variant)] : undefined); // older per-line key, first slot only (Item Clause)
    if (!item || s.mega || used.has(item)) continue;
    const entry = heldEntry(item);
    if (!entry || !ownsHeldItem(user, item) || !fitsSpecies(entry, s.id)) continue;
    used.add(item);
    out.set(key, item);
  }
  return out;
}



/**
 * Admin resets (/resetteam, /resetuser): clear the editable teams' equipment.
 * Unlocks (user.items) are never touched. IN PLACE.
 */
export function clearTeamEquipment(user, teamIds = EDITABLE_TEAMS) {
  const teams = user?.equipment?.teams;
  if (!isPlainObject(teams)) return false;
  let changed = false;
  for (const t of teamIds) if (own(teams, t)) { delete teams[t]; changed = true; }
  if (changed) bump(user);
  return changed;
}
