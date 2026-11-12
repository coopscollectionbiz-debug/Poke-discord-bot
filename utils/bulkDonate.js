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
//   duplicates  — must leave at least 1 plain copy of that variant. Team
//                 variants are allowed: the copy kept is the Team copy.
//   multiselect — exactly 1 copy of that Pokémon in total, not on Team.
//
// TM safety (services/ownership.js): only PLAIN copies are ever donated
// here. A copy with TM-trained moves (user.customPokemon) is never part of
// a bulk donation; it can only go through a single, explicit donation.
//
// donateOne() is the single-copy donation (POST /api/pokemon/donate) with
// the same per-copy rewards, so both routes share one rule.
// ==========================================================

import { grantItem } from "../services/inventory.js";
import { plainCount, customCopiesOf, canRemoveCopies, removeCopies } from "../services/ownership.js";
import { spareCopies, normalizeBox } from "../services/box.js";
import { liveEffects } from "../services/liveEvents.js";
import { scaleEarned } from "./liveEventRules.js";

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
  normalizeBox(user); // copies exist before spare counts are read (services/box.js)
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
    const plain = plainCount(user, pid, variant);
    const trained = customCopiesOf(user, pid, variant).length;
    const label = variant === "shiny" ? `shiny ${p.name}` : p.name;

    if (mode === "duplicates") {
      if (plain - count < 1) {
        if (trained > 0) {
          return { error: `You have ${plain} untrained ${label} now, so donating ${count} would leave none. TM-trained copies are never bulk-donated.` };
        }
        return { error: `You have ${owned} ${label} now, so donating ${count} would leave none.` };
      }
      // Copies on a Team are never donated (docs/adr/0001).
      const spare = spareCopies(user, pid, variant).length;
      if (count > spare) return { error: `Only ${spare} of your ${label} can be donated: the others are on a team or have TM-trained moves.` };
    } else {
      if (count !== 1) return { error: "Multi-select donates one copy of each Pokémon." };
      if (owned < 1) return { error: `You no longer have a ${label}.` };

      const total = (user.pokemon[pid].normal ?? 0) + (user.pokemon[pid].shiny ?? 0);
      if (total > 1) return { error: `You have more than one ${p.name} now.` };
      if (plain < 1) return { error: `Your ${label} has TM-trained moves. Donate it on its own to confirm.` };
      if (isOnTeam(pid, variant)) {
        return { error: `${p.name} is on one of your teams (Display or Battle). Remove it from that team first.` };
      }
    }

    rows.push({ pid, p, variant, count });
  }

  // ---------- apply: same per-copy rewards as POST /api/pokemon/donate ----------
  let gainedCC = 0;
  let shinyDustGained = 0;
  const events = [];

  for (const { pid, p, variant, count } of rows) {
    for (let i = 0; i < count; i++) {
      const ev = copyReward(user, pid, p, variant, economy);
      gainedCC += ev.ccGained;
      shinyDustGained += ev.dustGained;
      events.push(ev);
    }
    // Plain copies only (validated above), so this cannot be refused.
    const removed = removeCopies(user, { id: pid, variant, n: count });
    if (!removed.ok) throw new Error(`bulkDonate: removal refused after validation (${removed.code})`);
  }

  user.cc = (user.cc ?? 0) + gainedCC;
  if (shinyDustGained > 0) {
    const r = grantItem(user, "shiny_dust", shinyDustGained);
    if (!r.ok) console.warn(`⚠️ bulkDonate: shiny dust grant refused: ${r.error}`);
  }

  return { donatedCopies: events.length, gainedCC, shinyDustGained, events };
}

// One donated copy's reward (CC, Shiny Dust with the weekly normal-dust cap).
// Mutates only the weekly dust counter; the caller applies CC and Dust.
function copyReward(user, pid, p, variant, economy) {
  const tier = String(p.tier || "common").toLowerCase();
  const baseCC = economy.ccByTier[tier] ?? 0;
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
  // Live event multipliers on what a Donation earns. The weekly normal-dust
  // cap counts the dust before the multiplier, so an event never eats it.
  const fx = liveEffects();
  return { pokemonId: pid, pokemonName: p.name, tier, variant, ccGained: scaleEarned(cc, fx.cc), dustGained: scaleEarned(dust, fx.dust) };
}

/**
 * Donate ONE copy (POST /api/pokemon/donate). Same rewards as one bulk copy.
 * A plain copy is always used; if only TM-trained copies remain, the
 * donation is refused with code "custom_copies_protected" (fail closed:
 * naming a trained copy explicitly arrives with the TM teaching UI).
 * All checks run before anything changes.
 * @returns {{ error:string, code?:string, protected?:Array } | { event, gainedCC, shinyDustGained }}
 */
export function donateOne({ user, pokeId, variant, pokemonData, economy, isOnTeam, uid = null, rev = null, confirmTrained = false }) {
  const pid = Number(pokeId);
  const p = Number.isInteger(pid) ? pokemonData[pid] : null;
  if (!p) return { error: "Invalid Pokémon ID" };
  if (!VARIANTS.has(variant)) return { error: "Invalid variant." };
  if ((user.pokemon?.[pid]?.[variant] ?? 0) <= 0) {
    return { error: `You don’t own a ${variant === "shiny" ? "shiny " : ""}${p.name} to donate.` };
  }
  // Individual copies (docs/adr/0001): a copy on a Team is never donated
  // (canRemoveCopies refuses it with code "on_team"); other copies of the
  // same Pokémon can be. `uid` names the copy the player tapped.
  // T5 (owner decision D-T10): a trained copy goes only when the player
  // named it, saw the TM warning and ticked its checkbox (confirmTrained),
  // with the rev the warning showed. Without a uid, the lowest-Level spare is used.
  const trained = uid != null && !!user.customPokemon?.[uid] && !user.customPokemon[uid].suspended;
  if (trained && confirmTrained !== true) {
    return { error: "Confirm that this Pokémon's TM-trained moves will be lost.", code: "confirm_required" };
  }
  const args = uid == null
    ? { id: pid, variant, n: 1 }
    : trained
      ? { id: pid, variant, n: 1, customUids: [uid], confirmRevs: { [uid]: rev }, exact: true }
      : { id: pid, variant, n: 1, uids: [uid], exact: true };
  const can = canRemoveCopies(user, args);
  if (!can.ok) {
    if (can.code === "on_team") return { error: `That ${p.name} is on one of your teams. Take it off the team first.`, code: "on_team" };
    return { error: can.error, code: can.code, ...(can.protected && { protected: can.protected }) };
  }
  void isOnTeam;

  const event = copyReward(user, pid, p, variant, economy);
  if (trained) event.trainedUid = uid;
  const removed = removeCopies(user, args);
  if (!removed.ok) throw new Error(`donateOne: removal refused after validation (${removed.code})`);
  user.cc = (user.cc ?? 0) + event.ccGained;
  if (event.dustGained > 0) {
    const r = grantItem(user, "shiny_dust", event.dustGained);
    if (!r.ok) console.warn(`⚠️ donateOne: shiny dust grant refused: ${r.error}`);
  }
  return { event, gainedCC: event.ccGained, shinyDustGained: event.dustGained };
}
