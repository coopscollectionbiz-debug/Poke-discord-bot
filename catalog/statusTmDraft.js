// ==========================================================
// catalog/statusTmDraft.js — DRAFT status TMs for the full sim, awaiting
// owner sign-off (full-sim spec, "Moves and TMs"). NOT sold and NOT in
// data/battle/tm-data.json yet: once signed off, tools/generate-tm-data.mjs
// adds them with latest-game compatibility and catalog/tms.js prices them.
//
// Tiers by impact, on the shop's existing prices
// (Basic 1,500 · Standard 3,000 · Power 5,000 · Premium 6,000):
//   basic     common defensive or weather tools most Teams can use
//   standard  status that cripples one foe, and screens
//   power     setup moves and hazards that swing a whole fight
//   premium   Trick Room and the strongest field control
// ==========================================================

export const STATUS_TM_DRAFT = Object.freeze({
  protect: "basic",
  rest: "basic",
  raindance: "basic",
  sunnyday: "basic",
  sandstorm: "basic",
  snowscape: "basic",
  thunderwave: "standard",
  toxic: "standard",
  willowisp: "standard",
  reflect: "standard",
  lightscreen: "standard",
  swordsdance: "power",
  calmmind: "power",
  bulkup: "power",
  nastyplot: "power",
  stealthrock: "power",
  spikes: "power",
  toxicspikes: "power",
  tailwind: "power",
  trickroom: "premium",
  auroraveil: "premium",
  stickyweb: "premium",
});
