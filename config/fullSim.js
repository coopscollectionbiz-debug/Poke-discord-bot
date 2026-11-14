// ==========================================================
// config/fullSim.js — the full-sim switch, read from the environment
// (docs/superpowers/specs/2026-11-12-full-sim-design.md).
//
//   FULL_SIM_ENABLED  "1"/"true"/"yes"/"on": every fight runs on Pokémon
//                     Showdown's engine with Battle plans, and battle data
//                     comes from data/battle/full-sim-data.json (Gen 9).
//                     Unset = OFF: today's engines and battleData.json,
//                     exactly as before. Saved plans stay either way.
//   SIM_THREADS       Sim worker threads (default 1; 0 = on the main thread).
// ==========================================================

const TRUE = new Set(["1", "true", "yes", "on"]);

/** user.fullSimCutover once a player's moves are recorded (services/fullSimCutover.js). */
export const CUTOVER_VERSION = 1;

/**
 * Is the full sim on? `env` falls back to process.env when it isn't an
 * object, so callbacks like `ids.map(getMove)` (which pass an index) still
 * read the real switch.
 */
export function isFullSimEnabled(env = process.env) {
  const source = env && typeof env === "object" ? env : process.env;
  return TRUE.has(String(source.FULL_SIM_ENABLED ?? "").trim().toLowerCase());
}
