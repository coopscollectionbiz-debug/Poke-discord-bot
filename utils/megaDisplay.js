// ==========================================================
// utils/megaDisplay.js — Mega Evolution presentation rules (Phase M3).
//
// One place that decides how a Mega is SHOWN, for every surface: /showteam,
// the trainer card, the inspect card, the EXP card, battle images and the
// dashboard. Pure: reads player data and flags, never writes.
//
// What a surface shows always follows what a battle would do
// (services/megaTeam.js resolveBattleMega, fail-closed): a Team slot appears
// as a Mega only when it would battle as one. Otherwise it appears as its
// base form, and — only while Mega Evolution is visible at all — the player
// gets a short, plain explanation. With Mega Evolution switched off nothing
// here produces any output, so existing images stay exactly as they were.
// ==========================================================

import { getMega, allMegas, megaFormGate, megaBattleEligibility } from "./megas.js";
import { isMegaCapabilityEnabled } from "../config/features.js";
import { resolveBattleMega, megaFieldOf } from "../services/megaTeam.js";
import { readMegaUnlocks } from "../services/megaUnlocks.js";
import { COLOR } from "./render/tokens.js";

/** The Mega colour, shared by Discord images and the dashboard (--cc-mega). */
export const MEGA_COLOR = COLOR.mega;

/** "Mega Charizard X" → "Charizard X" (for tight labels that carry a MEGA tag). */
export function megaShortName(formOrId) {
  const f = typeof formOrId === "string" ? getMega(formOrId) : formOrId;
  return f ? String(f.name).replace(/^Mega /, "") : null;
}

/**
 * Turns an internal eligibility reason into one sentence for players. Never
 * mentions flags, environment variables, data sources or code.
 */
export function playerMegaReason(reason) {
  const r = String(reason ?? "");
  if (/switched off/i.test(r)) return "Mega battles aren't available yet.";
  if (/more than one Mega/i.test(r)) return "A team can hold only one Mega. Pick one on the Teams page.";
  if (/not unlocked|doesn't belong/i.test(r)) return "This Mega isn't unlocked for that Pokémon.";
  if (/not owned/i.test(r)) return "You don't own that Pokémon any more. The unlock is kept.";
  if (/unverified/i.test(r)) return "This Mega can't battle yet: its battle data hasn't been confirmed.";
  if (/generation \d+ is not live/i.test(r)) return "This Mega's generation isn't available yet.";
  if (/not modelled/i.test(r)) return "This Mega can't battle yet.";
  return "This Mega isn't available yet.";
}

/**
 * The Mega on a player's stored Team, as the surfaces should show it.
 *   null                         – no Mega selected, or Mega Teams are hidden
 *   { active: true, ... }        – battles (and is shown) as the Mega
 *   { active: false, message }   – shown as the base form, with the reason
 */
export function teamMegaStatus(user, { env = process.env } = {}) {
  const raw = Array.isArray(user?.displayedPokemon) ? user.displayedPokemon : [];
  const slot = raw.find((t) => megaFieldOf(t));
  if (!slot || !isMegaCapabilityEnabled("team", env)) return null;
  const r = resolveBattleMega(user, { env });
  const formId = r?.formId ?? megaFieldOf(slot);
  const f = getMega(formId);
  const name = f?.name ?? "This Mega";
  const baseName = f?.baseSpecies ?? "its base form";
  if (r?.ok) return { active: true, formId, name, baseName };
  const reason = playerMegaReason(r?.reason);
  return { active: false, formId, name, baseName, reason, message: `${name} is on this team but battles as ${baseName} for now. ${reason}` };
}

/**
 * The three battle states every Mega card uses:
 *   "ready"       – Battle-ready: unlocked, Pokémon owned, and it can battle
 *   "unavailable" – Unlocked, but it can't battle right now (with why)
 *   "locked"      – Not unlocked (or not available at all)
 */
export function megaBattleStatus({ formId, unlocked, owned, env = process.env }) {
  const e = megaBattleEligibility(formId, { env });
  if (!unlocked) {
    const f = getMega(formId);
    const detail = f?.status !== "eligible" ? "This Mega isn't available."
      : e.reasons.some((x) => /unverified/i.test(x)) ? "Once unlocked it can be shown and added to a team, but it can't battle yet."
        : "Unlock it with its Mega Stone.";
    return { state: "locked", label: "Locked", detail };
  }
  if (!owned) return { state: "unavailable", label: "Unlocked · can't battle", detail: playerMegaReason("line not owned") };
  if (e.battleReady) return { state: "ready", label: "Battle-ready", detail: "Battles as this Mega when it's on a team." };
  return { state: "unavailable", label: "Unlocked · can't battle yet", detail: playerMegaReason(e.reasons[0]) };
}

/**
 * Mega collection progress, kept apart from the National Pokédex: Megas are
 * forms, never species, so they never change dex counts or completion.
 *   available – forms players can currently see and unlock
 *   unlocked  – of those, forms unlocked on at least one line
 *   shiny     – of those, forms unlocked on a shiny line
 */
export function megaCollectionProgress(user, { env = process.env } = {}) {
  const available = allMegas().filter((f) => megaFormGate(f.id, "dashboard", { env }).allowed).map((f) => f.id);
  const avail = new Set(available);
  const any = new Set(), shiny = new Set();
  for (const [line, entry] of Object.entries(readMegaUnlocks(user))) {
    for (const id of entry.forms) {
      if (!avail.has(id)) continue;
      any.add(id);
      if (line.endsWith(":shiny")) shiny.add(id);
    }
  }
  return { unlocked: any.size, available: avail.size, shiny: shiny.size };
}
