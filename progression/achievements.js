// ==========================================================
// progression/achievements.js — achievement progress engine (Release C)
//
// Storage (compact, in the player record; ACHIEVEMENT-SYSTEM-DESIGN §2):
//   user.ach         { [achievementId]: unlockedDay }   day = UTC days since 1970
//   user.achClaimed  { [achievementId]: claimedDay }
//   user.ap          number — cached sum of AP of unlocked achievements
//   user.stats       { shinyObtained, evolutions, donated, purchases } counters
//   user.progression { rev, day, retro: [ids unlocked by the retro evaluator] }
// Invalid values are moved to user.progressionLegacy, never silently dropped.
//
// Everything here is synchronous and never awaits: call it inside the
// player's lock, in the same block as the mutation that caused it.
// Evaluation is targeted: an event only re-checks achievements whose metric
// it can change, and nothing is written when nothing changes.
// ==========================================================

import fs from "fs";
import { listAchievements, getAchievement, BY_METRIC, CATALOG_REVISION, CATEGORIES, TIER_NAMES } from "../catalog/achievements.js";
import { levelsForUser } from "../utils/training.js";
import { getQuantity, grantItem, validateHoldableItem } from "../services/inventory.js";
import { grantCurrency } from "../services/assets.js";

// Species facts (region, types, tier) for collection metrics, loaded once.
const SPECIES = (() => {
  const raw = JSON.parse(fs.readFileSync(new URL("../public/pokemonData.json", import.meta.url), "utf8"));
  const m = new Map();
  for (const p of Object.values(raw)) {
    m.set(Number(p.id), { region: p.region, types: p.types || [], tier: String(p.tier || "common").toLowerCase() });
  }
  return m;
})();

export const dayNumber = (ms = Date.now()) => Math.floor(ms / 86_400_000);
export const COUNTER_KEYS = Object.freeze(["shinyObtained", "evolutions", "donated", "purchases"]);
const ID_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;
const DANGEROUS = new Set(["__proto__", "constructor", "prototype"]);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isDay = (v) => Number.isSafeInteger(v) && v > 0;

// ----------------------------------------------------------
// Normalization (idempotent; preserves unknown ids and fields)
// ----------------------------------------------------------
function legacy(user, key, value, reason) {
  if (!Array.isArray(user.progressionLegacy)) user.progressionLegacy = [];
  const v = (() => { try { return JSON.stringify(value) ?? String(value); } catch { return String(value); } })();
  if (user.progressionLegacy.some((e) => e && e.key === key && e.reason === reason && e.value === v)) return;
  user.progressionLegacy.push({ key, value: v, reason });
}

function cleanDayMap(user, field) {
  const raw = user[field];
  if (raw === undefined) return false;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    legacy(user, field, raw, "not an object");
    delete user[field];
    return true;
  }
  let changed = false;
  for (const k of Object.keys(raw)) {
    if (DANGEROUS.has(k) || !ID_PATTERN.test(k) || !isDay(raw[k])) {
      legacy(user, `${field}.${k}`, raw[k], DANGEROUS.has(k) ? "reserved key" : "invalid entry");
      delete raw[k];
      changed = true;
    }
  }
  return changed;
}

/** Make achievement fields well-formed IN PLACE. Returns true if anything changed. */
export function normalizeProgression(user) {
  if (!user || typeof user !== "object") return false;
  let changed = cleanDayMap(user, "ach") | cleanDayMap(user, "achClaimed");

  if (user.stats !== undefined) {
    if (!user.stats || typeof user.stats !== "object" || Array.isArray(user.stats)) {
      legacy(user, "stats", user.stats, "not an object");
      delete user.stats;
      changed = true;
    } else {
      for (const k of COUNTER_KEYS) {
        if (!own(user.stats, k)) continue;
        const v = user.stats[k];
        if (!Number.isSafeInteger(v) || v < 0) {
          legacy(user, `stats.${k}`, v, "not a non-negative integer");
          user.stats[k] = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
          changed = true;
        }
      }
    }
  }
  if (user.ach !== undefined) {
    const ap = sumAp(user);
    if (user.ap !== ap) {
      user.ap = ap;
      changed = true;
    }
  }
  return !!changed;
}

function sumAp(user) {
  let ap = 0;
  for (const id of Object.keys(user.ach || {})) ap += getAchievement(id)?.ap ?? 0;
  return ap;
}

// ----------------------------------------------------------
// Metrics
// ----------------------------------------------------------
const COLLECTION_PREFIXES = ["region:", "type:", "tier:"];
const isCollectionKey = (k) => k === "uniqueSpecies" || k === "shinyCopies" || k === "shinySpecies" || COLLECTION_PREFIXES.some((p) => k.startsWith(p));

function collectionMetrics(user) {
  const out = { uniqueSpecies: 0, shinyCopies: 0, shinySpecies: 0 };
  for (const [idStr, e] of Object.entries(user.pokemon || {})) {
    const normal = Number(e?.normal) || 0;
    const shiny = Number(e?.shiny) || 0;
    if (normal + shiny <= 0) continue;
    out.uniqueSpecies++;
    if (shiny > 0) { out.shinySpecies++; out.shinyCopies += shiny; }
    const sp = SPECIES.get(Number(idStr));
    if (!sp) continue;
    const r = `region:${sp.region}`;
    out[r] = (out[r] || 0) + 1;
    for (const t of sp.types) out[`type:${t}`] = (out[`type:${t}`] || 0) + 1;
    out[`tier:${sp.tier}`] = (out[`tier:${sp.tier}`] || 0) + 1;
  }
  return out;
}

/**
 * Current value of each requested metric ("state:key" / "counter:key").
 * Only computes what is asked for (the collection pass is one loop).
 */
export function computeMetrics(user, wanted) {
  const out = {};
  let coll = null;
  for (const full of wanted) {
    const [kind, key] = [full.slice(0, full.indexOf(":")), full.slice(full.indexOf(":") + 1)];
    if (kind === "counter") { out[full] = Math.max(0, Number(user.stats?.[key]) || 0); continue; }
    if (isCollectionKey(key)) { coll ??= collectionMetrics(user); out[full] = coll[key] || 0; continue; }
    switch (key) {
      case "battleWins": out[full] = Number(user.battle?.wins) || 0; break;
      case "battleRating": out[full] = Number(user.battle?.rating) || 0; break;
      case "tp": out[full] = Number(user.tp) || 0; break;
      case "trainers": out[full] = Array.isArray(user.trainers) ? user.trainers.length : Object.keys(user.trainers || {}).length; break;
      case "maxLevel": { let m = 0; for (const lv of Object.values(levelsForUser(user))) if (lv > m) m = lv; out[full] = m; break; }
      case "ap": out[full] = sumAp(user); break;
      default: out[full] = 0;
    }
  }
  return out;
}

const ALL_METRICS = [...BY_METRIC.keys()];
const COLLECTION_METRICS = ALL_METRICS.filter((k) => k.startsWith("state:") && isCollectionKey(k.slice(6)));
const EVENT_METRICS = {
  pokemon: [...COLLECTION_METRICS, "state:maxLevel", "state:tp"],
  shiny: ["counter:shinyObtained"],
  evolved: ["counter:evolutions", ...COLLECTION_METRICS, "state:maxLevel"],
  donated: ["counter:donated", ...COLLECTION_METRICS],
  purchase: ["counter:purchases"],
  battle: ["state:battleWins", "state:battleRating", "state:maxLevel"],
  tp: ["state:tp"],
  trainers: ["state:trainers"],
};

// ----------------------------------------------------------
// Unlocking
// ----------------------------------------------------------
function unlockWhere(user, entries, metrics, day, newly) {
  for (const e of entries) {
    if (own(user.ach || {}, e.id)) continue;
    if ((metrics[`${e.metric.kind}:${e.metric.key}`] ?? 0) >= e.target) {
      user.ach ??= {};
      user.ach[e.id] = day;
      newly.push(e.id);
    }
  }
}

/** Re-check the given metric keys; record new unlocks. Returns new ids. */
export function evaluate(user, metricKeys, now = Date.now()) {
  const day = dayNumber(now);
  const keys = [...new Set(metricKeys)].filter((k) => BY_METRIC.has(k) && k !== "state:ap");
  const metrics = computeMetrics(user, keys);
  const newly = [];
  for (const k of keys) unlockWhere(user, BY_METRIC.get(k), metrics, day, newly);
  if (newly.length) {
    user.ap = sumAp(user);
    // AP milestones depend on AP itself (meta achievements give 0 AP: no loop).
    unlockWhere(user, BY_METRIC.get("state:ap") || [], { "state:ap": user.ap }, day, newly);
  }
  return newly;
}

/**
 * Retroactive recognition (idempotent; once per catalog revision per player).
 * Unlocks achievements PROVABLE from the current record: state metrics, plus
 * the shiny counter seeded with the current shiny copies (a lower bound).
 * Never fabricates history: evolutions, donations and purchases start at 0.
 * Recognition only — it grants no rewards.
 */
export function retroEvaluate(user, now = Date.now()) {
  if (!user || typeof user !== "object") return [];
  if (Number(user.progression?.rev) >= CATALOG_REVISION) return [];
  const day = dayNumber(now);
  const shinyNow = computeMetrics(user, ["state:shinyCopies"])["state:shinyCopies"];
  if (shinyNow > (Number(user.stats?.shinyObtained) || 0)) {
    user.stats ??= {};
    user.stats.shinyObtained = shinyNow;
  }
  const keys = listAchievements().filter((e) => e.retro !== "none").map((e) => `${e.metric.kind}:${e.metric.key}`);
  const newly = evaluate(user, keys, now);
  const prev = user.progression && typeof user.progression === "object" && !Array.isArray(user.progression) ? user.progression : {};
  user.progression = { ...prev, rev: CATALOG_REVISION, day: prev.day ?? day, retro: [...new Set([...(Array.isArray(prev.retro) ? prev.retro : []), ...newly])] };
  if (user.ap === undefined) user.ap = sumAp(user);
  return newly;
}

/**
 * Record gameplay events and re-check only the affected achievements.
 * events: [{ type: "pokemon"|"shiny"|"evolved"|"donated"|"purchase"|"battle"|"tp"|"trainers", n? }]
 * Counter events add n (default 1). Returns newly unlocked ids.
 */
export function trackProgress(user, events, now = Date.now()) {
  if (!user || typeof user !== "object") return [];
  const newly = retroEvaluate(user, now); // no-op once stamped
  const keys = new Set();
  for (const ev of events) {
    if (!ev || !EVENT_METRICS[ev.type]) continue;
    const n = Number.isSafeInteger(ev.n) && ev.n > 0 ? ev.n : ev.n === 0 ? 0 : 1;
    const counter = { shiny: "shinyObtained", evolved: "evolutions", donated: "donated", purchase: "purchases" }[ev.type];
    if (counter && n > 0) {
      user.stats ??= {};
      user.stats[counter] = (Number(user.stats[counter]) || 0) + n;
    }
    for (const k of EVENT_METRICS[ev.type]) keys.add(k);
  }
  return newly.concat(evaluate(user, keys, now));
}

// ----------------------------------------------------------
// View (pure — never writes)
// ----------------------------------------------------------
export function achievementView(user, { policy, category = null } = {}) {
  const all = listAchievements();
  const metrics = computeMetrics(user, ALL_METRICS);
  const recorded = user.ach || {};
  const claimed = user.achClaimed || {};
  let ap = 0;
  const rows = [];
  for (const e of all) {
    const value = metrics[`${e.metric.kind}:${e.metric.key}`] ?? 0;
    const unlocked = own(recorded, e.id) || (e.metric.key !== "ap" && value >= e.target);
    if (unlocked) ap += e.ap;
    if (category && e.category !== category) continue;
    const isClaimed = own(claimed, e.id);
    const approved = !!e.reward && policy?.isApproved?.(e) === true;
    const concealed = e.hidden && !unlocked;
    rows.push({
      id: e.id,
      name: concealed ? "???" : e.name,
      description: concealed ? "A hidden achievement. Keep playing to discover it." : e.description,
      category: e.category,
      tier: e.tier,
      tierName: TIER_NAMES[e.tier],
      ap: e.ap,
      hidden: e.hidden,
      unlocked,
      unlockedDay: own(recorded, e.id) ? recorded[e.id] : null,
      progress: concealed ? null : { value: Math.min(value, e.target), target: e.target },
      counterSince: e.metric.kind === "counter" && user.progression?.day ? user.progression.day : null,
      reward: concealed || !e.reward ? null : { ...e.reward, status: approved ? "available" : "pending_approval" },
      claimed: isClaimed,
      claimable: unlocked && approved && !isClaimed,
    });
  }
  const meta = rows.filter((r) => r.id.startsWith("meta_ap_"));
  for (const r of meta) {
    const e = getAchievement(r.id);
    if (!r.unlocked && ap >= e.target) r.unlocked = true;
    r.progress = { value: Math.min(ap, e.target), target: e.target };
  }
  const total = all.length;
  const unlockedCount = all.filter((e) => own(recorded, e.id) || (e.metric.key === "ap" ? ap >= e.target : (metrics[`${e.metric.kind}:${e.metric.key}`] ?? 0) >= e.target)).length;
  const categories = Object.entries(CATEGORIES)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, c]) => {
      const inCat = all.filter((e) => e.category === key);
      const done = inCat.filter((e) => own(recorded, e.id) || (e.metric.key === "ap" ? ap >= e.target : (metrics[`${e.metric.kind}:${e.metric.key}`] ?? 0) >= e.target)).length;
      return { key, label: c.label, emoji: c.emoji, unlocked: done, total: inCat.length };
    });
  return { ap, unlocked: unlockedCount, total, categories, achievements: rows };
}

// ----------------------------------------------------------
// Claiming (sync, all-or-nothing; call inside the lock)
// ----------------------------------------------------------
const SUPPORTED_REWARD_KEYS = new Set(["cc", "items"]);

/**
 * Claim one achievement's reward. Checks, in order: known id, has a reward,
 * reward approved, not already claimed, unlocked (recording a provable
 * unlock first), reward types supported, items obtainable and within
 * stack limits — and only then grants everything and records the claim.
 */
export function claimAchievement(user, id, { policy, now = Date.now() } = {}) {
  const e = getAchievement(id);
  if (!e) return { ok: false, status: 404, error: "Unknown achievement." };
  if (!e.reward) return { ok: false, status: 400, error: "This achievement has no reward to claim." };
  if (policy?.isApproved?.(e) !== true) return { ok: false, status: 409, error: "This reward is pending approval and can't be claimed yet." };
  if (own(user.achClaimed || {}, id)) return { ok: false, status: 409, error: "You already claimed this reward." };

  if (!own(user.ach || {}, id)) {
    evaluate(user, [`${e.metric.kind}:${e.metric.key}`], now);
    if (!own(user.ach || {}, id)) return { ok: false, status: 400, error: "You haven't unlocked this achievement yet." };
  }

  const unsupported = Object.keys(e.reward).filter((k) => !SUPPORTED_REWARD_KEYS.has(k));
  if (unsupported.length) return { ok: false, status: 409, error: `This reward includes ${unsupported.join(", ")}, which isn't available yet.` };

  const cc = e.reward.cc ?? 0;
  if (cc && (!Number.isSafeInteger(cc) || cc <= 0)) return { ok: false, status: 500, error: "Invalid reward definition." };
  const items = Object.entries(e.reward.items || {});
  for (const [itemId, qty] of items) {
    const v = validateHoldableItem(itemId);
    if (!v.ok) return { ok: false, status: 409, error: `Reward item unavailable: ${v.error}` };
    const max = v.entry.maxStack;
    if (getQuantity(user, itemId) + qty > max) return { ok: false, status: 409, error: `You can't hold more ${v.entry.name}.` };
  }

  // Everything validated: apply all of it (cannot fail part-way).
  if (cc) grantCurrency(user, cc);
  for (const [itemId, qty] of items) grantItem(user, itemId, qty);
  user.achClaimed ??= {};
  user.achClaimed[id] = dayNumber(now);
  return { ok: true, achievement: id, granted: { cc, items: Object.fromEntries(items) }, cc: user.cc };
}
