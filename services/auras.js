// ==========================================================
// services/auras.js — Aura ownership, equipping and the CC shop.
//
// Storage (created on first write, never by a read):
//   user.auras = { owned: { [auraId]: unlockedDay }, equipped: "auto" | "none" | auraId }
// day = UTC days since 1970. A missing record means "nothing stored, Auto".
//
// What a player owns is what is stored PLUS what their record already
// proves, so nothing needs a migration to show up:
//   • Gym / Blue / Red Auras: user.challenge.won has the challenge
//     (clearing the Elite Four proves all four members);
//   • milestone Auras: user.ach has the achievement.
// Tier Auras ARE stored (trainers can be given away; the Aura stays), by
// grantTrainer for every new trainer and by syncTierAuras on every load,
// which also backfills existing collections. Elite Four members beaten in a
// run that was then lost are stored by grantChallengeAuras.
//
// Equipped "auto" (the default) shows the displayed trainer's own tier
// backdrop, exactly as before Auras; "none" shows nothing; an Aura id shows
// that Aura while it is owned and its art exists, else falls back to Auto.
//
// Synchronous: call inside lockUser, between the awaits and the save.
// ==========================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AURAS, getAura, TIER_AURA } from "../catalog/auras.js";
import { trainerTier } from "../utils/render/trainerTier.js";
import { liveEffects } from "./liveEvents.js";
import { discountedPrice } from "../utils/liveEventRules.js";

export const AURA_AUTO = "auto";
export const AURA_NONE = "none";
const dayOf = (now) => Math.floor((now instanceof Date ? now.getTime() : Number(now) || Date.now()) / 86_400_000);

// ----------------------------------------------------------
// Art: assets/auras/<id>/aura.json. AURA_ART_DIR overrides the folder (tests).
// ----------------------------------------------------------
const DEFAULT_ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "auras");
export const auraArtDir = (env = process.env) => env.AURA_ART_DIR || DEFAULT_ART_DIR;
let readyCache = null;
/** True when the Aura can be drawn: a tier look, or its art folder has aura.json. */
export function auraReady(id, env = process.env) {
  const a = getAura(id);
  if (!a) return false;
  if (!a.look.startsWith("art:")) return true;
  readyCache ??= new Map();
  const key = `${auraArtDir(env)}|${a.id}`;
  if (!readyCache.has(key)) readyCache.set(key, fs.existsSync(path.join(auraArtDir(env), a.id, "aura.json")));
  return readyCache.get(key);
}
export const resetAuraArtCacheForTesting = () => { readyCache = null; };

// ----------------------------------------------------------
// Ownership
// ----------------------------------------------------------
/** Repairs user.auras in place if present (never creates it). */
export function normalizeAuras(user) {
  const a = user?.auras;
  if (a === undefined) return user;
  if (!a || typeof a !== "object" || Array.isArray(a)) { user.auras = { owned: {}, equipped: AURA_AUTO }; return user; }
  const owned = {};
  for (const [id, day] of Object.entries(a.owned && typeof a.owned === "object" ? a.owned : {})) {
    if (getAura(id)) owned[id] = Number.isSafeInteger(day) && day >= 0 ? day : 0;
  }
  a.owned = owned;
  const eq = String(a.equipped ?? AURA_AUTO);
  a.equipped = eq === AURA_NONE || getAura(eq) ? eq : AURA_AUTO;
  return user;
}

const record = (user) => {
  if (!user.auras || typeof user.auras !== "object") user.auras = { owned: {}, equipped: AURA_AUTO };
  user.auras.owned ??= {};
  user.auras.equipped ??= AURA_AUTO;
  return user.auras;
};

/** Store an Aura. Returns true if it was new. Refuses retired event Auras. */
export function grantAura(user, id, now = Date.now()) {
  const a = getAura(id);
  if (!user || !a) return false;
  if (a.kind === "event" && a.retired) return false;
  if (user.auras?.owned?.[a.id] !== undefined) return false;
  record(user).owned[a.id] = dayOf(now);
  return true;
}

/**
 * Admin grant (admin dashboard only): any Aura, retired event Auras and
 * Auras whose art isn't live yet included (it shows once its art exists;
 * until then equipping falls back to Auto). False if already owned.
 */
export function adminGrantAura(user, id, now = Date.now()) {
  const a = getAura(id);
  if (!user || !a || ownsAura(user, a.id)) return false;
  record(user).owned[a.id] = dayOf(now);
  return true;
}

/**
 * Why an owned Aura can't be removed by an admin, or null if it can:
 * "record" (a challenge win or achievement proves it) or "trainer" (a tier
 * Aura of a trainer they still own; it would come back on the next load).
 */
export function auraLockedBy(user, id) {
  if (derivedIds(user).has(id)) return "record";
  const list = Array.isArray(user?.trainers) ? user.trainers : [];
  if (list.some((f) => TIER_AURA[trainerTier(f) ?? ""] === id)) return "trainer";
  return null;
}

/**
 * Admin removal of a stored Aura. False when it isn't stored, or the record
 * still proves it (a challenge win or achievement). Unequips it.
 */
export function revokeAura(user, id) {
  if (user?.auras?.owned?.[id] === undefined || auraLockedBy(user, id)) return false;
  delete user.auras.owned[id];
  if (user.auras.equipped === id) user.auras.equipped = AURA_AUTO;
  return true;
}

/** The tier Aura a trainer unlocks (Epic+), stored. Called by grantTrainer. */
export function grantTierAuraFor(user, trainerFile, now = Date.now()) {
  const id = TIER_AURA[trainerTier(trainerFile) ?? ""];
  return id ? grantAura(user, id, now) : false;
}

/** Stores the tier Aura of every trainer owned now: backfill + repair, on every load. */
export function syncTierAuras(user, now = Date.now()) {
  const list = Array.isArray(user?.trainers) ? user.trainers : [];
  let added = 0;
  for (const f of list) if (grantTierAuraFor(user, f, now)) added++;
  return added;
}

/**
 * Challenge wins. `beaten` is the opponent keys beaten in this run (an Elite
 * Four run can be lost after beating some members: they still count).
 */
export function grantChallengeAuras(user, challengeKey, beaten = [], now = Date.now()) {
  const out = [];
  for (const a of AURAS) {
    if (a.challenge !== challengeKey) continue;
    const hit = a.opponent ? beaten.includes(a.opponent) : beaten.length > 0;
    if (hit && grantAura(user, a.id, now)) out.push(a.id);
  }
  return out;
}

/** Ids proven by the record (challenge wins, achievements), stored or not. */
function derivedIds(user) {
  const won = user?.challenge?.won ?? {};
  const ach = user?.ach ?? {};
  const out = new Set();
  for (const a of AURAS) {
    if (a.challenge && a.challenge in won) out.add(a.id); // clearing elite4 proves all four members
    if (a.achievement && a.achievement in ach) out.add(a.id);
  }
  return out;
}

/** Every Aura id the player owns. */
export function ownedAuraIds(user) {
  const out = derivedIds(user);
  for (const id of Object.keys(user?.auras?.owned ?? {})) if (getAura(id)) out.add(id);
  return out;
}
export const ownsAura = (user, id) => ownedAuraIds(user).has(String(id));

// ----------------------------------------------------------
// Equipping and drawing
// ----------------------------------------------------------
export const equippedAura = (user) => {
  const eq = user?.auras?.equipped;
  return eq === AURA_NONE || getAura(eq) ? eq : AURA_AUTO;
};

/** Equip "auto", "none" or an owned Aura whose art exists. */
export function equipAura(user, id, { env = process.env } = {}) {
  const want = String(id ?? "");
  if (want !== AURA_AUTO && want !== AURA_NONE) {
    if (!getAura(want)) return { ok: false, status: 404, error: "Unknown Aura" };
    if (!ownsAura(user, want)) return { ok: false, status: 400, error: "You don't own this Aura yet." };
    if (!auraReady(want, env)) return { ok: false, status: 400, error: "This Aura's art isn't ready yet." };
  }
  if (equippedAura(user) === want) return { ok: true, equipped: want, changed: false };
  record(user).equipped = want;
  return { ok: true, equipped: want, changed: true };
}

/**
 * What the renderer draws behind this player's trainer: a tier key, an
 * "art:<id>" look, or null for nothing. `trainerFile` defaults to the
 * displayed trainer (pass the one the image shows, if different).
 */
export function auraLook(user, { trainerFile = user?.displayedTrainer, env = process.env } = {}) {
  const auto = () => trainerTier(trainerFile);
  const eq = equippedAura(user);
  if (eq === AURA_NONE) return null;
  if (eq === AURA_AUTO) return auto();
  if (!ownsAura(user, eq) || !auraReady(eq, env)) return auto();
  return getAura(eq).look;
}

// ----------------------------------------------------------
// Dashboard view and the CC shop
// ----------------------------------------------------------
function howToEarn(a) {
  switch (a.kind) {
    case "tier": return `Own any ${a.tier[0].toUpperCase()}${a.tier.slice(1)} trainer`;
    case "gym": case "elite4": case "champion": return `Beat ${a.by} in /challenge`;
    case "milestone": return a.goal;
    case "shop": return `${a.price.toLocaleString("en-US")} CC in the shop`;
    case "event": return a.retired ? "A past event" : "During its event";
    default: return "";
  }
}

/** Everything the Auras tab needs. Pure: never writes. */
export function auraView(user, { env = process.env } = {}) {
  const owned = ownedAuraIds(user);
  const stored = user?.auras?.owned ?? {};
  return {
    equipped: equippedAura(user),
    cc: Number(user?.cc) || 0,
    auras: AURAS
      .filter((a) => !(a.kind === "event" && a.retired && !owned.has(a.id))) // a retired event Aura shows only to those who have it
      .filter((a) => a.kind !== "shop" || owned.has(a.id) || auraReady(a.id, env)) // no art, nothing to sell
      .map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        look: a.look,
        owned: owned.has(a.id),
        unlockedDay: stored[a.id] ?? null,
        ready: auraReady(a.id, env),
        howToEarn: howToEarn(a),
        price: a.kind === "shop" ? discountedPrice(liveEffects(), "auras", a.price) : null, // a Live event's discount
      })),
  };
}

/** Buy a shop Aura with CC. */
export function buyAura(user, id, { env = process.env, now = Date.now() } = {}) {
  const a = getAura(id);
  if (!a || a.kind !== "shop") return { ok: false, status: 404, error: "That Aura isn't for sale." };
  if (!auraReady(a.id, env)) return { ok: false, status: 400, error: "That Aura isn't for sale yet." };
  if (ownsAura(user, a.id)) return { ok: false, status: 400, error: "You already own this Aura." };
  const cc = Number(user.cc) || 0;
  const price = discountedPrice(liveEffects(now), "auras", a.price); // a Live event's discount
  if (cc < price) return { ok: false, status: 400, error: `Requires ${price.toLocaleString("en-US")} CC` };
  user.cc = cc - price;
  grantAura(user, a.id, now);
  return { ok: true, aura: a.id, cost: price, cc: user.cc };
}
