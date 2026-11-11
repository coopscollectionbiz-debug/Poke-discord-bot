// ==========================================================
// config/megaBattleProfiles.js — which unverified Mega battle profiles the
// owner has accepted for battle.
//
// data/pokedex/megas.json marks every Legends: Z-A Mega's battle profile
// "unverified": Z-A has no abilities in play, so the ability comes from
// Pokémon Showdown's "Future" data (stats and types are Z-A's own). That
// record stays as it is. This file is the owner's decision about using
// those profiles anyway.
//
// 2026-11-11 (owner): every Z-A Mega may battle with its Showdown profile,
// first for Gen 6–9 Pokémon (ready when those generations are enabled),
// then for Gen 1–5 Pokémon too (Mega Dragonite, Mega Starmie, Mega Raichu
// X/Y, …). Every other gate still applies: the generation must be live, the
// ability must be modelled, there must be a sprite, and blocked forms
// (Floette, Zygarde, Original Color Magearna, Rayquaza) stay blocked.
// ==========================================================

/** National Dex range whose Z-A Mega profiles are accepted (all generations). */
export const ACCEPTED_ZA_DEX = Object.freeze({ from: 1, to: 1025 });

// Tests only: switch acceptance off to exercise the "unverified profile"
// refusal path, which no real form reaches while every Z-A form is accepted.
let acceptanceOn = true;
export function setZaAcceptanceForTesting(on) { acceptanceOn = on !== false; }

/** Is this form's unverified Z-A profile accepted for battle? */
export function isAcceptedZaProfile(form) {
  if (!acceptanceOn || !form || form.battleProfile?.verified) return false;
  if (!String(form.introducedIn ?? "").startsWith("Legends: Z-A")) return false;
  const dex = Number(form.species);
  return dex >= ACCEPTED_ZA_DEX.from && dex <= ACCEPTED_ZA_DEX.to;
}
