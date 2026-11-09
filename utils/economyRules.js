// ==========================================================
// utils/economyRules.js — gameplay rules shared by bot_final.js routes and
// their handlers (moved verbatim from bot_final.js; values unchanged).
// ==========================================================

// ==========================================================
// 🧠 Pokémon Variant + Items Helpers (GLOBAL, SINGLE SOURCE)
// ==========================================================
export function normVariant(v) {
  return String(v || "normal").toLowerCase() === "shiny" ? "shiny" : "normal";
}

export function toTeamObj(entry) {
  if (typeof entry === "number") return { id: entry, variant: "normal" };
  if (typeof entry === "string") {
    const n = Number(entry);
    return Number.isInteger(n) ? { id: n, variant: "normal" } : null;
  }
  if (entry && typeof entry === "object") {
    const pid = Number(entry.id);
    if (!Number.isInteger(pid)) return null;
    return { id: pid, variant: normVariant(entry.variant) };
  }
  return null;
}

export function isDisplayedVariant(user, pokeId, variant) {
  const teamRaw = Array.isArray(user.displayedPokemon) ? user.displayedPokemon : [];
  const team = teamRaw.map(toTeamObj).filter(Boolean);
  const pid = Number(pokeId);
  const v = normVariant(variant);
  return team.some((t) => t.id === pid && t.variant === v);
}

// ==========================================================
// ✨ SHINY DUST ECONOMY (Single Source of Truth)
// ==========================================================
export function tierKey(t) {
  return String(t || "common").toLowerCase();
}

// CC paid per donated copy (shiny pays 5×). Shared by single + bulk donate.
export const DONATION_CC_BY_TIER = {
  common: 250,
  uncommon: 500,
  rare: 1000,
  epic: 2500,
  legendary: 5000,
  mythic: 10000,
};

export const DUST_REWARD_BY_TIER = {
  common: 4,
  uncommon: 7,
  rare: 12,
  epic: 18,
  legendary: 22,
  mythic: 30,
};

export const SHINY_CRAFT_COST_BY_TIER = {
  common: 15,
  uncommon: 25,
  rare: 40,
  epic: 60,
  legendary: 80,
  mythic: 120,
};


// Craft cost for converting normal -> shiny by tier
export function craftCostForTier(tier) {
  return SHINY_CRAFT_COST_BY_TIER[tierKey(tier)] ?? 0;
}

// Shiny evolve dust uses the "difference" rule
export function shinyEvolveDustCost(baseTier, targetTier) {
  return Math.max(0, craftCostForTier(targetTier) - craftCostForTier(baseTier));
}

// ==========================================================
// 🗓️ NON-SHINY DUST WEEKLY CAP (UTC ISO WEEK)
// ==========================================================
// ==========================================================
// 🗓️ NON-SHINY DUST WEEKLY CAP (UTC ISO WEEK)
// ==========================================================
export const NON_SHINY_DUST_WEEKLY_CAP = 8;

export function getISOWeekKeyUTC(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sun=0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function ensureWeeklyReset(u) {
  const key = getISOWeekKeyUTC();

  // sanitize fields
  if (typeof u.nonShinyDustWeekKey !== "string") u.nonShinyDustWeekKey = "";
  u.nonShinyDustEarnedThisWeek = Number.isFinite(u.nonShinyDustEarnedThisWeek)
    ? Math.max(0, Math.floor(u.nonShinyDustEarnedThisWeek))
    : 0;

  // roll week if changed
  if (u.nonShinyDustWeekKey !== key) {
    u.nonShinyDustWeekKey = key;
    u.nonShinyDustEarnedThisWeek = 0;
    u.weeklyPackClaimed = false;
  }

  // clamp to cap
  if (u.nonShinyDustEarnedThisWeek > NON_SHINY_DUST_WEEKLY_CAP) {
    u.nonShinyDustEarnedThisWeek = NON_SHINY_DUST_WEEKLY_CAP;
  }
}
