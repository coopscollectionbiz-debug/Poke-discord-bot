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
// 2026-11-11 (owner): Z-A Megas of Gen 6–9 Pokémon may battle with their
// Showdown profile, so they are ready when those generations are enabled.
// Every other gate still applies: the generation must be live, the ability
// must be modelled, there must be a sprite, and blocked forms (Floette,
// Zygarde, Original Color Magearna) stay blocked. Z-A Megas of Gen 1–5
// Pokémon (Mega Dragonite, Mega Starmie, …) are NOT accepted.
// ==========================================================

/** National Dex range whose Z-A Mega profiles are accepted (Gen 6–9). */
export const ACCEPTED_ZA_DEX = Object.freeze({ from: 650, to: 1025 });

/** Is this form's unverified Z-A profile accepted for battle? */
export function isAcceptedZaProfile(form) {
  if (!form || form.battleProfile?.verified) return false;
  if (!String(form.introducedIn ?? "").startsWith("Legends: Z-A")) return false;
  const dex = Number(form.species);
  return dex >= ACCEPTED_ZA_DEX.from && dex <= ACCEPTED_ZA_DEX.to;
}
