// ==========================================================
// utils/bulkDonate.js — Donate Duplicates + Multi-select rules
// ==========================================================
//
// Pure: bulkDonate() does no I/O, so tests can run it without booting the bot.
// The caller (POST /api/pokemon/donate-bulk) holds the user lock,
// runs ensureWeeklyReset first, saves, and writes the event log.
//
// ALL-OR-NOTHING: every row is checked before anything changes.
// The client sends exactly what its confirmation modal showed; if
// the collection changed since (another tab, a catch in Discord),
// one failing row rejects the whole request and the user is untouched.
//
// Each mode has its own rule, so the server can catch a stale list:
//   duplicates  — must leave at least 1 copy of that variant. Team
//                 variants are allowed: the copy kept is the Team copy.
//   multiselect — exactly 1 copy of that Pokémon in total, not on Team.
// ==========================================================

import { grantItem } from "../services/inventory.js";
import { resetLevelIfGone } from "./training.js";

const VARIANTS = new Set(["normal", "shiny"]);

/**
 * @param {object} args
 * @param {object} args.user - normalized trainer record (mutated on success only)
 * @param {"duplicates"|"multiselect"} args.mode
 * @param {Array<{pokeId:number, variant:"normal"|"shiny", count:number}>} args.items
 * @param {object} args.pokemonData - id → { name, tier }
 * @param {object} args.economy - { ccByTier, shinyDustByTier, normalDustChanceByTier,
 *                                  normalDustWeeklyCap, rollDust(table) }
 * @param {(pid:number, variant:string) => boolean} args.isOnTeam
 * @returns {{ error: string } | { donatedCopies, gainedCC, shinyDustGained, events }}
 */
export function bulkDonate({ user, mode, items, pokemonData, economy, isOnTeam }) {
  if (mode !== "duplicates" && mode !== "multiselect") return { error: "Invalid mode." };
  if (!Array.isArray(items) || items.length === 0) return { error: "Nothing to donate." };

  // ---------- validate every row before touching the user ----------
  const rows = [];
  const seen = new Set();

  for (const item of items) {
    const pid = Number(item?.pokeId);
    const p = Number.isInteger(pid) ? pokemonData[pid] : null;
    if (!p) return { error: "Invalid Pokémon ID." };

    // Strict: normVariant() would quietly turn a typo into "normal".
    const variant = item.variant;
    if (!VARIANTS.has(variant)) return { error: "Invalid variant." };

    const count = item.count;
    if (!Number.isInteger(count) || count < 1) return { error: "Invalid count." };

    const key = `${pid}:${variant}`;
    if (seen.has(key)) return { error: `${p.name} is listed twice.` };
    seen.add(key);

    const owned = user.pokemon?.[pid]?.[variant] ?? 0;
    const label = variant === "shiny" ? `shiny ${p.name}` : p.name;

    if (mode === "duplicates") {
      if (owned - count < 1) {
        return { error: `You have ${owned} ${label} now, so donating ${count} would leave none.` };
      }
    } else {
      if (count !== 1) return { error: "Multi-select donates one copy of each Pokémon." };
      if (owned < 1) return { error: `You no longer have a ${label}.` };

      const total = (user.pokemon[pid].normal ?? 0) + (user.pokemon[pid].shiny ?? 0);
      if (total > 1) return { error: `You have more than one ${p.name} now.` };
      if (isOnTeam(pid, variant)) {
        return { error: `${p.name} is on your Team. Remove it from your Team first.` };
      }
    }

    rows.push({ pid, p, variant, count });
  }

  // ---------- apply: same per-copy rewards as POST /api/pokemon/donate ----------
  let gainedCC = 0;
  let shinyDustGained = 0;
  const events = [];

  for (const { pid, p, variant, count } of rows) {
    const tier = String(p.tier || "common").toLowerCase();
    const baseCC = economy.ccByTier[tier] ?? 0;

    for (let i = 0; i < count; i++) {
      const cc = variant === "shiny" ? baseCC * 5 : baseCC;
      let dust = 0;

      if (variant === "shiny") {
        dust = economy.shinyDustByTier[tier] ?? 0; // not capped
      } else {
        const earned = user.nonShinyDustEarnedThisWeek ?? 0;
        const remaining = Math.max(0, economy.normalDustWeeklyCap - earned);
        if (remaining > 0) {
          const table = economy.normalDustChanceByTier?.[tier] ?? [{ chance: 1, dust: 0 }];
          dust = Math.min(economy.rollDust(table), remaining);
          user.nonShinyDustEarnedThisWeek = earned + dust;
        }
      }

      gainedCC += cc;
      shinyDustGained += dust;
      events.push({ pokemonId: pid, pokemonName: p.name, tier, variant, ccGained: cc, dustGained: dust });
    }

    user.pokemon[pid][variant] -= count;
    if ((user.pokemon[pid].normal ?? 0) <= 0 && (user.pokemon[pid].shiny ?? 0) <= 0) {
      delete user.pokemon[pid];
    }
    resetLevelIfGone(user, pid, variant);
  }

  user.cc = (user.cc ?? 0) + gainedCC;
  if (shinyDustGained > 0) {
    const r = grantItem(user, "shiny_dust", shinyDustGained);
    if (!r.ok) console.warn(`⚠️ bulkDonate: shiny dust grant refused: ${r.error}`);
  }

  return { donatedCopies: events.length, gainedCC, shinyDustGained, events };
}
