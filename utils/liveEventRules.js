// ==========================================================
// utils/liveEventRules.js — Live events: pure rules.
//
// A Live event is a named period (start/end, epoch ms) holding one or more
// Event effects (CONTEXT.md; docs/design/live-events.md). This file has no
// I/O: validation, which effects are running, how overlapping effects
// combine, and how Catch boosts / Catch limits reshape a random roll.
//
// No caps: an admin may set any positive multiplier. Only physical bounds
// apply (a chance tops out at 100 %, a discount at 100 %).
// ==========================================================

import { GENERATIONS, generationOfDex } from "../config/generations.js";
import { TYPE_ID_TO_NAME } from "./battle/data.js";

export const TIERS = Object.freeze(["common", "uncommon", "rare", "epic", "legendary", "mythic"]);
export const TYPES = Object.freeze(Object.values(TYPE_ID_TO_NAME));
export const REGIONS = Object.freeze(Object.values(GENERATIONS).map((g) => g.region));

/** Shop categories a discount can cover. */
export const DISCOUNT_CATEGORIES = Object.freeze({
  balls: "Poké Balls",
  stones: "Evolution Stones",
  tms: "TMs",
  heldItems: "Held items",
  trainers: "Trainer sprites",
  recruit: "/recruit",
  auras: "Auras",
});

/**
 * Every effect kind: label, what its value is, and (for match effects) which
 * targets it may name. `value` is "mult" (× N, > 0), "percent" (1–100) or
 * "count" (whole number ≥ 1).
 */
export const EFFECT_KINDS = Object.freeze({
  catchBoost: { label: "Catch boost", group: "Catch", value: "mult", match: ["types", "regions", "tiers", "species"] },
  catchLimit: { label: "Catch limit", group: "Catch", value: null, match: ["types", "regions", "species"] },
  shiny: { label: "Shiny chance", group: "Catch", value: "mult" },
  catchRate: { label: "Chat catch chance", group: "Catch", value: "mult" },
  exp: { label: "Battle EXP", group: "EXP", value: "mult", match: ["types"] },
  tp: { label: "Chat TP", group: "Economy", value: "mult" },
  cc: { label: "CC earned", group: "Economy", value: "mult" },
  dust: { label: "Shiny Dust earned", group: "Economy", value: "mult" },
  discount: { label: "Shop discount", group: "Economy", value: "percent" },
  encounterRate: { label: "Trainer encounter chance", group: "Battles", value: "mult" },
  prize: { label: "Prize money won", group: "Battles", value: "mult" },
  battleCap: { label: "Extra battles per day", group: "Battles", value: "count" },
});

const CATCH_KINDS = new Set(["catchBoost", "catchLimit"]);
const NAME_MAX = 60;

const list = (v) => (Array.isArray(v) ? v : []);
const uniq = (a) => [...new Set(a)];

// ----------------------------------------------------------
// Species facts
// ----------------------------------------------------------

/** A species' Region, by National Dex number (CONTEXT.md, Region). */
export const regionOf = (id) => GENERATIONS[generationOfDex(id)]?.region ?? null;

/** Type names of a species entry ({ types: [typeId] }). */
export const typeNamesOf = (p) => list(p?.types).map((t) => TYPE_ID_TO_NAME[t] ?? String(t));

const tierOf = (p) => String(p?.tier || p?.rarity || "common").toLowerCase();

/**
 * Does a species match an effect's targets? Fields named in `match` must all
 * hold (Kanto + Water = Kanto Water Pokémon); within a field, any value does.
 * An effect with no targets matches everything.
 */
export function matches(match, p) {
  const m = match || {};
  if (list(m.types).length && !typeNamesOf(p).some((t) => m.types.includes(t))) return false;
  if (list(m.regions).length && !m.regions.includes(regionOf(p.id))) return false;
  if (list(m.tiers).length && !m.tiers.includes(tierOf(p))) return false;
  if (list(m.species).length && !m.species.map(Number).includes(Number(p.id))) return false;
  return true;
}

const hasTargets = (match) => ["types", "regions", "tiers", "species"].some((k) => list(match?.[k]).length);

// ----------------------------------------------------------
// Validation
// ----------------------------------------------------------

function cleanMatch(kind, raw, errors, speciesExists) {
  const allowed = EFFECT_KINDS[kind].match || [];
  const out = {};
  const pick = (field, valid, fix = (x) => x) => {
    const vals = uniq(list(raw?.[field]).map(fix));
    if (!vals.length) return;
    if (!allowed.includes(field)) return errors.push(`${EFFECT_KINDS[kind].label} can't target ${field}.`);
    const bad = vals.filter((v) => !valid(v));
    if (bad.length) return errors.push(`Unknown ${field}: ${bad.join(", ")}.`);
    out[field] = vals;
  };
  pick("types", (t) => TYPES.includes(t));
  pick("regions", (r) => REGIONS.includes(r));
  pick("tiers", (t) => TIERS.includes(t), (t) => String(t).toLowerCase());
  pick("species", (id) => Number.isInteger(id) && speciesExists(id), Number);
  return out;
}

/**
 * Validate one effect. Returns { effect } (a clean copy) or { error }.
 * @param {(id:number)=>boolean} speciesExists
 */
export function cleanEffect(raw, speciesExists = () => true) {
  const kind = raw?.kind;
  const def = EFFECT_KINDS[kind];
  if (!def) return { error: `Unknown effect: ${kind}` };
  const errors = [];
  const effect = { kind };
  if (def.value) {
    const v = Number(raw.value);
    if (def.value === "mult" && !(Number.isFinite(v) && v > 0)) errors.push(`${def.label}: the multiplier must be a number above 0.`);
    if (def.value === "percent" && !(Number.isFinite(v) && v > 0 && v <= 100)) errors.push(`${def.label}: the discount must be between 1 and 100 %.`);
    if (def.value === "count" && !(Number.isInteger(v) && v >= 1)) errors.push(`${def.label}: must be a whole number of at least 1.`);
    effect.value = v;
  }
  if (def.match) {
    effect.match = cleanMatch(kind, raw.match, errors, speciesExists);
    if (CATCH_KINDS.has(kind) && !hasTargets(effect.match)) errors.push(`${def.label}: pick at least one type, Region${kind === "catchBoost" ? ", Tier" : ""} or species.`);
  }
  if (kind === "discount") {
    const cats = uniq(list(raw.categories));
    const bad = cats.filter((c) => !DISCOUNT_CATEGORIES[c]);
    if (bad.length) errors.push(`Unknown shop categories: ${bad.join(", ")}.`);
    if (!cats.length) errors.push("Shop discount: pick at least one category.");
    effect.categories = cats;
  }
  return errors.length ? { error: errors.join(" ") } : { effect };
}

/**
 * Validate a whole event (name, window, effects). Does not check overlap
 * with other events; see emptyLimitProblem.
 * @returns {{ event: object } | { error: string }}
 */
export function cleanEvent(raw, { speciesExists = () => true } = {}) {
  const name = String(raw?.name ?? "").trim();
  if (!name) return { error: "Give the event a name." };
  if (name.length > NAME_MAX) return { error: `Names are at most ${NAME_MAX} characters.` };
  const startAt = Number(raw?.startAt);
  const endAt = Number(raw?.endAt);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return { error: "Pick a start and an end." };
  if (endAt <= startAt) return { error: "The end must be after the start." };
  const effects = [];
  for (const e of list(raw?.effects)) {
    const r = cleanEffect(e, speciesExists);
    if (r.error) return { error: r.error };
    effects.push(r.effect);
  }
  if (!effects.length) return { error: "Add at least one effect." };
  return { event: { name, startAt, endAt, effects } };
}

// ----------------------------------------------------------
// What's running
// ----------------------------------------------------------

/** The time an event actually stops: its end, or when an admin ended it. */
export const stopAt = (e) => (e.endedAt != null ? Math.min(e.endedAt, e.endAt) : e.endAt);

export const isRunning = (e, now) => !e.deleted && e.startAt <= now && now < stopAt(e);
export const isScheduled = (e, now) => !e.deleted && now < e.startAt && e.endedAt == null;
export const isOver = (e, now) => !e.deleted && now >= stopAt(e);

export const statusOf = (e, now) => (isRunning(e, now) ? "running" : isScheduled(e, now) ? "scheduled" : "ended");

export const runningEvents = (events, now) => list(events).filter((e) => isRunning(e, now));

/** Do two windows overlap? */
export const overlaps = (a, b) => a.startAt < stopAt(b) && b.startAt < stopAt(a);

/**
 * The running effects combined into one object every hook reads. Each
 * multiplier is the product of all running ones of its kind (1 when none).
 * `catchStartedAt` is the latest start among running events that hold a
 * Catch boost or Catch limit: a paid-roll opt-in older than that has lapsed.
 */
export function combine(events, now) {
  const running = runningEvents(events, now);
  const out = {
    events: running.map((e) => ({ id: e.id, name: e.name, endAt: stopAt(e) })),
    boosts: [],
    limits: [],
    shiny: 1, catchRate: 1, tp: 1, cc: 1, dust: 1, encounterRate: 1, prize: 1,
    exp: [],
    discounts: [],
    battleCap: 0,
    catchEvents: [],
    catchStartedAt: null,
  };
  for (const e of running) {
    let catchy = false;
    for (const f of e.effects) {
      switch (f.kind) {
        case "catchBoost": out.boosts.push({ ...f, event: e.name }); catchy = true; break;
        case "catchLimit": out.limits.push({ ...f, event: e.name }); catchy = true; break;
        case "exp": out.exp.push(f); break;
        case "discount": out.discounts.push(f); break;
        case "battleCap": out.battleCap += f.value; break;
        default: out[f.kind] *= f.value;
      }
    }
    if (catchy) {
      out.catchEvents.push(e.name);
      out.catchStartedAt = Math.max(out.catchStartedAt ?? 0, e.startAt);
    }
  }
  return out;
}

export const NO_EFFECTS = Object.freeze(combine([], 0));

export const hasCatchEffects = (fx) => fx.boosts.length > 0 || fx.limits.length > 0;

/** EXP multiplier for one Pokémon (by its species entry). */
export function expMultiplier(fx, p) {
  return fx.exp.reduce((m, f) => (hasTargets(f.match) && !matches(f.match, p) ? m : m * f.value), 1);
}

/** Price after every running discount on a category (each takes its % off what's left). Never below 0. */
export function discountedPrice(fx, category, price) {
  const keep = fx.discounts
    .filter((d) => d.categories.includes(category))
    .reduce((k, d) => k * (1 - d.value / 100), 1);
  return Math.max(0, Math.round(price * keep));
}

/** Scale an amount earned; whole numbers, never negative. */
export const scaleEarned = (amount, mult) => Math.max(0, Math.round((Number(amount) || 0) * mult));

/** A chance scaled and clamped to [0, 1]. */
export const scaleChance = (chance, mult) => Math.min(1, Math.max(0, chance * mult));

// ----------------------------------------------------------
// Catch boosts and Catch limits on a random roll
// ----------------------------------------------------------

/** The pool after every running Catch limit. */
export const applyLimits = (pool, fx) => (fx.limits.length ? pool.filter((p) => fx.limits.every((l) => matches(l.match, p))) : pool);

/**
 * Per-species weights after Catch boosts. `weightOf(p)` is the normal weight.
 * Type, Region and species boosts keep each Tier's total weight as it was and
 * only reweight species inside the Tier; a Tier boost then scales its Tier.
 * Returns an array of { item, w } in pool order.
 */
export function boostedWeights(pool, fx, weightOf) {
  const base = pool.map((p) => ({ item: p, w: weightOf(p) }));
  if (!fx.boosts.length) return base;
  const inner = fx.boosts.filter((b) => !list(b.match.tiers).length || ["types", "regions", "species"].some((k) => list(b.match[k]).length));
  const tierOnly = fx.boosts.filter((b) => list(b.match.tiers).length && !["types", "regions", "species"].some((k) => list(b.match[k]).length));

  // 1) Reweight inside each Tier, keeping the Tier's total.
  const byTier = new Map();
  for (const row of base) {
    const t = tierOf(row.item);
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t).push(row);
  }
  const out = new Map();
  for (const rows of byTier.values()) {
    const total = rows.reduce((s, r) => s + r.w, 0);
    const factors = rows.map((r) => inner.reduce((f, b) => (matches(b.match, r.item) ? f * b.value : f), 1));
    const boostedTotal = rows.reduce((s, r, i) => s + r.w * factors[i], 0);
    const k = boostedTotal > 0 ? total / boostedTotal : 1;
    rows.forEach((r, i) => out.set(r, r.w * factors[i] * k));
  }
  // 2) Tier boosts change the Tier's share.
  return base.map((r) => ({
    item: r.item,
    w: tierOnly.reduce((w, b) => (matches(b.match, r.item) ? w * b.value : w), out.get(r)),
  }));
}

/** Pick from weighted rows with `rand` in [0, 1). */
export function pickWeighted(rows, rand = Math.random) {
  const total = rows.reduce((s, r) => s + r.w, 0);
  if (!rows.length) return null;
  if (total <= 0) return rows[Math.floor(rand() * rows.length)].item;
  let roll = rand() * total;
  for (const r of rows) {
    roll -= r.w;
    if (roll <= 0) return r.item;
  }
  return rows.at(-1).item;
}

/**
 * Overlap check for Catch limits: refuse an event if, at any moment it runs,
 * the Catch limits running together leave `pool` (a plain Poké Ball's pool:
 * every acquirable species) empty. `others` are the other events.
 * Returns an error string or null.
 */
export function emptyLimitProblem(event, others, pool) {
  // An event without a Catch limit can't empty the pool.
  if (!event.effects.some((f) => f.kind === "catchLimit")) return null;
  const limitsOf = (e) => e.effects.filter((f) => f.kind === "catchLimit");
  const peers = list(others).filter((o) => !o.deleted && o.id !== event.id && overlaps(event, o) && limitsOf(o).length);
  // The set of running peers only changes where one starts or stops, so
  // checking those instants (and the event's own start) covers every moment.
  const instants = uniq([event.startAt, ...peers.flatMap((p) => [p.startAt, stopAt(p)])])
    .filter((t) => t >= event.startAt && t < stopAt(event));
  for (const t of instants) {
    const with_ = peers.filter((p) => p.startAt <= t && t < stopAt(p));
    const fx = { limits: [event, ...with_].flatMap(limitsOf) };
    if (!applyLimits(pool, fx).length) {
      const names = with_.map((e) => e.name);
      return names.length
        ? `Together with ${names.join(", ")}, these Catch limits leave nothing to catch.`
        : "These Catch limits leave nothing to catch with the generations that are live.";
    }
  }
  return null;
}

/**
 * Odds summary for a pool + weights: each Tier's share (0–1), species count,
 * and the species whose chance rose most against `baseRows`.
 */
export function oddsSummary(rows, baseRows = null, top = 8) {
  const total = rows.reduce((s, r) => s + r.w, 0) || 1;
  const tiers = Object.fromEntries(TIERS.map((t) => [t, 0]));
  for (const r of rows) tiers[tierOf(r.item)] = (tiers[tierOf(r.item)] ?? 0) + r.w / total;
  let risers = [];
  if (baseRows) {
    const baseTotal = baseRows.reduce((s, r) => s + r.w, 0) || 1;
    const before = new Map(baseRows.map((r) => [r.item.id, r.w / baseTotal]));
    risers = rows
      .map((r) => ({ id: r.item.id, name: r.item.name, tier: tierOf(r.item), chance: r.w / total, before: before.get(r.item.id) ?? 0 }))
      .sort((a, b) => b.chance - a.chance)
      .slice(0, top);
  }
  return { species: rows.length, tiers, top: risers };
}
