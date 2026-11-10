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
import { listAchievements, getAchievement, BY_METRIC, CATALOG_REVISION, CATEGORIES, TIER_NAMES, REGIONS, ALL_REGIONS, TYPE_MASTERY_MIN, isAchievementActive } from "../catalog/achievements.js";
import { speciesOfKey, isSpeciesKey } from "../utils/forms.js";
import { TYPE_ID_TO_NAME, LEGACY_TYPE_IDS } from "../utils/battle/data.js";
import { levelsForUser } from "../utils/training.js";
import { lifetimeRanked } from "../utils/battle/rewards.js";
import { getQuantity, grantItem, validateHoldableItem } from "../services/inventory.js";
import { grantCurrency } from "../services/assets.js";

// Species facts (region, types, tier, generation, evolution family) for
// collection metrics, loaded once. Families are the connected components of
// the Gen 1–5 evolution graph (Release C's family achievements are about
// those 225 families; Gen 6–9 links such as Eevee → Sylveon never change
// them). Edges to unknown ids are ignored, so malformed or cyclic data
// cannot loop; a family's key is its lowest id. Gen 6+ species: family 0.
const CLASSIC_MAX = 649;
const SPECIES = (() => {
  const raw = JSON.parse(fs.readFileSync(new URL("../public/pokemonData.json", import.meta.url), "utf8"));
  const m = new Map();
  for (const p of Object.values(raw)) {
    const id = Number(p.id);
    m.set(id, { region: p.region, types: p.types || [], tier: String(p.tier || "common").toLowerCase(), classic: id <= CLASSIC_MAX,
      links: [...(p.evolvesTo || []), ...(p.evolvesFrom || [])].map(Number).filter((t) => id <= CLASSIC_MAX && t <= CLASSIC_MAX), family: 0 });
  }
  const parent = new Map([...m.keys()].filter((id) => id <= CLASSIC_MAX).map((id) => [id, id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const [id, sp] of m) for (const t of sp.links) if (parent.has(t) && parent.has(id) && t !== id) { const a = find(id), b = find(t); if (a !== b) parent.set(Math.max(a, b), Math.min(a, b)); }
  for (const [id, sp] of m) if (parent.has(id)) sp.family = find(id);
  return m;
})();
/** family key → member count (families of size 1 are not "families"). Gen 1–5 only. */
export const FAMILY_SIZES = (() => {
  const s = new Map();
  for (const sp of SPECIES.values()) if (sp.family) s.set(sp.family, (s.get(sp.family) || 0) + 1);
  return s;
})();
export const familyCount = () => [...FAMILY_SIZES.values()].filter((n) => n >= 2).length;

// Trainer file → tier (trainerSprites.json; every sprite of an entry maps to its tier).
const TRAINER_TIER = (() => {
  const m = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(new URL("../trainerSprites.json", import.meta.url), "utf8"));
    for (const [key, info] of Object.entries(raw)) {
      const tier = String(info?.tier || "common").toLowerCase();
      const files = (Array.isArray(info?.sprites) ? info.sprites : []).map((s) => (typeof s === "string" ? s : s?.file)).filter(Boolean);
      if (!files.length) files.push(`${key}.png`);
      for (const f of files) m.set(String(f).toLowerCase(), tier);
    }
  } catch { /* no trainer tiers: tier metrics stay 0 */ }
  return m;
})();

export const dayNumber = (ms = Date.now()) => Math.floor(ms / 86_400_000);
export const COUNTER_KEYS = Object.freeze([
  "shinyObtained", "evolutions", "donated", "purchases",
  // Revision 2 (counted from the expansion on; never inferred from history)
  "shinyEvolutions", "dailyClaims", "dailyStreak", "bestDailyStreak", "lastDailyDay", "weeklyClaims", "winStreak", "bestWinStreak", "upsetWins",
]);
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
  // Distinct species evolved into (rev 2): sorted unique known species ids.
  if (user.evoSpecies !== undefined) {
    const raw = user.evoSpecies;
    const ok = Array.isArray(raw) ? [...new Set(raw.filter((v) => Number.isSafeInteger(v) && SPECIES.has(v)))].sort((a, b) => a - b) : [];
    if (!Array.isArray(raw) || ok.length !== raw.length || ok.some((v, i) => v !== raw[i])) {
      legacy(user, "evoSpecies", raw, "invalid entries removed");
      user.evoSpecies = ok;
      changed = true;
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
const COLLECTION_PREFIXES = ["region:", "type:", "tier:", "classicTier:", "shinyTier:", "family:"];
const COLLECTION_KEYS = new Set(["uniqueSpecies", "classicSpecies", "shinyCopies", "shinySpecies", "regions", "regionsAll", "shinyRegions", "familiesComplete", "typeMastery", "typeMasteryAll"]);
const isCollectionKey = (k) => COLLECTION_KEYS.has(k) || COLLECTION_PREFIXES.some((p) => k.startsWith(p));
const TYPE_IDS = Object.keys(TYPE_ID_TO_NAME);

/**
 * Ownership by National Dex species. A form key ("52:galar", utils/forms.js)
 * counts toward its base species, so a species is never counted twice.
 * Unknown keys keep their old behaviour (counted as their own entry).
 */
function ownedBySpecies(user) {
  const owned = new Map();
  for (const [key, e] of Object.entries(user.pokemon || {})) {
    const normal = Number(e?.normal) || 0;
    const shiny = Number(e?.shiny) || 0;
    if (normal + shiny <= 0) continue;
    const species = isSpeciesKey(key) ? Number(key) : (speciesOfKey(key) ?? key);
    const cur = owned.get(species) || { normal: 0, shiny: 0 };
    owned.set(species, { normal: cur.normal + normal, shiny: cur.shiny + shiny });
  }
  return owned;
}

/** One pass over the player's Pokémon (current ownership). */
function collectionMetrics(user) {
  const out = { uniqueSpecies: 0, classicSpecies: 0, shinyCopies: 0, shinySpecies: 0 };
  const fam = new Map();
  const shinyRegions = new Set();
  for (const [id, e] of ownedBySpecies(user)) {
    const { shiny } = e;
    out.uniqueSpecies++;
    if (shiny > 0) { out.shinySpecies++; out.shinyCopies += shiny; }
    const sp = SPECIES.get(Number(id));
    if (!sp) continue;
    if (sp.classic) out.classicSpecies++;
    const r = `region:${sp.region}`;
    out[r] = (out[r] || 0) + 1;
    for (const t of sp.types) out[`type:${t}`] = (out[`type:${t}`] || 0) + 1;
    out[`tier:${sp.tier}`] = (out[`tier:${sp.tier}`] || 0) + 1;
    if (sp.classic) out[`classicTier:${sp.tier}`] = (out[`classicTier:${sp.tier}`] || 0) + 1;
    if (shiny > 0) {
      out[`shinyTier:${sp.tier}`] = (out[`shinyTier:${sp.tier}`] || 0) + 1;
      shinyRegions.add(sp.region);
    }
    if (sp.family) fam.set(sp.family, (fam.get(sp.family) || 0) + 1);
  }
  out.regions = Object.keys(REGIONS).filter((r) => out[`region:${r}`] > 0).length;
  out.regionsAll = Object.keys(ALL_REGIONS).filter((r) => out[`region:${r}`] > 0).length;
  out.shinyRegions = Object.keys(REGIONS).filter((r) => shinyRegions.has(r)).length;
  out.typeMastery = LEGACY_TYPE_IDS.filter((t) => (out[`type:${t}`] || 0) >= TYPE_MASTERY_MIN).length;
  out.typeMasteryAll = TYPE_IDS.filter((t) => (out[`type:${t}`] || 0) >= TYPE_MASTERY_MIN).length;
  out.familiesComplete = 0;
  for (const [f, owned] of fam) {
    out[`family:${f}`] = owned;
    const size = FAMILY_SIZES.get(f);
    if (size >= 2 && owned === size) out.familiesComplete++;
  }
  return out;
}

function trainerTierCount(user, tier) {
  const list = Array.isArray(user.trainers) ? user.trainers : Object.keys(user.trainers || {});
  let n = 0;
  for (const t of list) if (typeof t === "string" && TRAINER_TIER.get(t.toLowerCase()) === tier) n++;
  return n;
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
    if (kind === "counter") {
      out[full] = key === "evolvedSpecies" ? (Array.isArray(user.evoSpecies) ? user.evoSpecies.length : 0) : Math.max(0, Number(user.stats?.[key]) || 0);
      continue;
    }
    if (isCollectionKey(key)) { coll ??= collectionMetrics(user); out[full] = coll[key] || 0; continue; }
    if (key.startsWith("trainerTier:")) { out[full] = trainerTierCount(user, key.slice(12)); continue; }
    switch (key) {
      // Battle achievements count ranked + wager battles, across every season:
      // the rating reset never takes back progress (utils/battle/rewards.js).
      case "battleWins": out[full] = lifetimeRanked(user).wins; break;
      case "battleRating": out[full] = lifetimeRanked(user).bestRating; break;
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
const TRAINER_METRICS = ALL_METRICS.filter((k) => k === "state:trainers" || k.startsWith("state:trainerTier:"));
const EVENT_METRICS = {
  pokemon: [...COLLECTION_METRICS, "state:maxLevel", "state:tp"],
  shiny: ["counter:shinyObtained"],
  evolved: ["counter:evolutions", "counter:evolvedSpecies", "counter:shinyEvolutions", ...COLLECTION_METRICS, "state:maxLevel"],
  donated: ["counter:donated", ...COLLECTION_METRICS],
  purchase: ["counter:purchases"],
  battle: ["state:battleWins", "state:battleRating", "state:maxLevel", "counter:bestWinStreak", "counter:upsetWins"],
  tp: ["state:tp"],
  trainers: TRAINER_METRICS,
  daily: ["counter:dailyClaims", "counter:bestDailyStreak"],
  weekly: ["counter:weeklyClaims"],
};

const bump = (user, key, n = 1) => {
  user.stats ??= {};
  user.stats[key] = (Number(user.stats[key]) || 0) + n;
  return user.stats[key];
};

/**
 * Apply one event's counter changes. Each event type is emitted exactly once
 * per successful operation by its handler (see the hook list in the report),
 * after the operation's own once-only guard; `daily` additionally refuses a
 * second count for the same UTC day.
 */
function applyCounters(user, ev, n) {
  switch (ev.type) {
    case "shiny": if (n > 0) bump(user, "shinyObtained", n); break;
    case "donated": if (n > 0) bump(user, "donated", n); break;
    case "purchase": if (n > 0) bump(user, "purchases", n); break;
    case "weekly": bump(user, "weeklyClaims"); break;
    case "evolved": {
      bump(user, "evolutions");
      if (ev.shiny === true) bump(user, "shinyEvolutions");
      const sid = Number(ev.species);
      if (Number.isSafeInteger(sid) && SPECIES.has(sid)) {
        const list = Array.isArray(user.evoSpecies) ? user.evoSpecies : (user.evoSpecies = []);
        if (!list.includes(sid)) { list.push(sid); list.sort((a, b) => a - b); }
      }
      break;
    }
    case "battle": {
      // Streaks only move on a confirmed result (won true/false).
      if (ev.won === true) {
        const s = bump(user, "winStreak");
        if (s > (Number(user.stats.bestWinStreak) || 0)) user.stats.bestWinStreak = s;
        if (ev.upset === true) bump(user, "upsetWins");
      } else if (ev.won === false && user.stats?.winStreak) {
        user.stats.winStreak = 0;
      }
      break;
    }
    case "daily": {
      const day = Number(ev.day);
      if (!Number.isSafeInteger(day) || day <= 0) break;
      const s = (user.stats ??= {});
      const last = Number(s.lastDailyDay) || 0;
      if (day <= last) break; // same day (or clock went back): never counted twice
      s.dailyClaims = (Number(s.dailyClaims) || 0) + 1;
      s.dailyStreak = last === day - 1 && Number(s.dailyStreak) > 0 ? Number(s.dailyStreak) + 1 : 1;
      if (s.dailyStreak > (Number(s.bestDailyStreak) || 0)) s.bestDailyStreak = s.dailyStreak;
      s.lastDailyDay = day;
      break;
    }
    default:
  }
}

// ----------------------------------------------------------
// Unlocking
// ----------------------------------------------------------
function unlockWhere(user, entries, metrics, day, newly) {
  for (const e of entries) {
    if (own(user.ach || {}, e.id)) continue;
    if (!isAchievementActive(e)) continue; // generation not released yet
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
 * events: [{ type: "pokemon"|"shiny"|"evolved"|"donated"|"purchase"|"battle"|"tp"|"trainers"|"daily"|"weekly", n? }]
 *   evolved: { species, shiny }   battle: { won, upset }   daily: { day }
 * Counter events add n (default 1). Returns newly unlocked ids.
 * Call only AFTER the operation succeeded, inside its lock, before its save.
 */
export function trackProgress(user, events, now = Date.now()) {
  if (!user || typeof user !== "object") return [];
  const newly = retroEvaluate(user, now); // no-op once stamped
  const keys = new Set();
  for (const ev of events) {
    if (!ev || !EVENT_METRICS[ev.type]) continue;
    const n = Number.isSafeInteger(ev.n) && ev.n > 0 ? ev.n : ev.n === 0 ? 0 : 1;
    applyCounters(user, ev, n);
    for (const k of EVENT_METRICS[ev.type]) keys.add(k);
  }
  return newly.concat(evaluate(user, keys, now));
}

// ----------------------------------------------------------
// View (pure — never writes)
// ----------------------------------------------------------
const HIDDEN_ALIAS = new Map(listAchievements().filter((e) => e.hidden).map((e, i) => [e.id, `hidden_${i + 1}`]));
export function achievementView(user, { policy, category = null } = {}) {
  // Entries of unreleased generations are not shown (an entry a player
  // already holds — e.g. after a rollback — always stays visible).
  const all = listAchievements().filter((e) => isAchievementActive(e) || own(user?.ach || {}, e.id));
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
    // A locked hidden achievement reveals nothing that hints at its
    // condition: not its id, name, description, tier, AP, progress or reward.
    rows.push({
      id: concealed ? HIDDEN_ALIAS.get(e.id) : e.id,
      name: concealed ? "???" : e.name,
      description: concealed ? "A hidden achievement. Keep playing to discover it." : e.description,
      category: e.category,
      tier: concealed ? null : e.tier,
      tierName: concealed ? "Hidden" : TIER_NAMES[e.tier],
      ap: concealed ? null : e.ap,
      hidden: e.hidden,
      unlocked,
      unlockedDay: own(recorded, e.id) ? recorded[e.id] : null,
      progress: concealed ? null : { value: Math.min(value, e.target), target: e.target },
      counterSince: !concealed && e.metric.kind === "counter" && user.progression?.day ? user.progression.day : null,
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
