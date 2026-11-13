// ==========================================================
// services/fullSimCutover.js — nobody's moves change when the full sim
// turns on (full-sim spec, "Moves and TMs").
//
// The full sim's learnsets (latest game) differ from today's (Gen 5 for
// #1–649), so a Team member with no picked Moveset would suddenly bring
// different "last 4 attacks". runCutover() runs once per player when the
// switch is first on: for every Casual and Ranked team member with no
// picked Moveset it records the moves it brings today and its Level:
//   user.fullSimMoves = { [movesetKey]: { moves, level } }   (copy or line key)
//   user.fullSimCutover = 1
// From then on that member's default moves are those, with every attack
// the new learnset teaches above that Level learned on top the games' way
// (newest in, oldest out; the same rule as feat/move-choice's learnMove).
// The record belongs to the Pokémon, not to a Team: a picked Moveset takes
// its place on that Team only, and clearing the pick brings it back, so
// editing one Team never changes the other's moves.
// Pokémon off every Team at cutover simply use the new learnsets, and so
// does anyone who joins with the switch on (utils/userSchema.js
// createNewUser marks them as cut over).
// ==========================================================

import { getSpecies, getMove } from "../utils/battle/data.js";
import { autoMoveset } from "../utils/battle/moveset.js";
import { normalizeTeam } from "../utils/teamNormalize.js";
import { chosenMoves, copyKey } from "./movesets.js";
import { slotCopyUid, slotBoxUid } from "./ownership.js";
import { copyTraining } from "./box.js";
import { getTraining } from "../utils/training.js";
import { isFullSimEnabled, CUTOVER_VERSION } from "../config/fullSim.js";

export { CUTOVER_VERSION };
const LEGACY = {}; // an env with the full sim off: today's data
const MAX = 4;

const learn = (moves, id) => {
  const next = [...moves.filter((m) => m !== id), id];
  return next.length > MAX ? next.slice(1) : next;
};

/** A member's moves from its cutover record at `level`: recorded moves plus attacks taught since. */
export function cutoverMoves(record, speciesId, level) {
  const taught = getSpecies(speciesId).levelMoves
    .filter(([at, id]) => at > record.level && at <= level && getMove(id)?.category !== "Status")
    .map(([, id]) => id);
  return taught.reduce(learn, record.moves);
}

/** The cutover record key for a Team slot, the same key its Moveset would use. */
export function slotMovesKey(user, slot) {
  const uid = slotBoxUid(user, slot) ?? slotCopyUid(user, slot);
  return uid ? copyKey(uid) : `${slot.id}:${slot.variant}`;
}

const lineKey = (id, variant) => `${Number(id)}:${variant === "shiny" ? "shiny" : "normal"}`;
// A copy's record, else its line's, the way a copy with no Moveset of its own
// uses the line's: a slot recorded before it named a copy (a TM teach
// creates one) keeps its moves. The line's goes only to a copy at or above
// the Level it was recorded at, never to a younger copy of that line.
const recordAt = (user, key, id, variant, level) => {
  const own = user?.fullSimMoves?.[key];
  if (own) return own;
  const line = user?.fullSimMoves?.[lineKey(id, variant)];
  return line && level >= line.level ? line : null;
};

/** The record for this Team slot at the member's Level, if the cutover made one. */
export function cutoverRecord(user, slot, level) {
  return recordAt(user, slotMovesKey(user, slot), slot.id, slot.variant, level);
}

const levelOf = (user, slot) => {
  const uid = slotBoxUid(user, slot);
  return (uid && copyTraining(user, uid)?.level) ?? getTraining(user, slot.id, slot.variant).level;
};

// A line seen as a whole (no copy named) shows the copy that's on a Team,
// whose record is under that copy's key.
const lineRecordKey = (user, { id, variant }) => {
  const onTeam = [...normalizeTeam(user?.displayedPokemon ?? [], 6), ...normalizeTeam(user?.battleTeam ?? [], 6)]
    .find((s) => s.id === Number(id) && s.variant === variant);
  return onTeam ? slotMovesKey(user, onTeam) : lineKey(id, variant);
};

/**
 * The moves a copy brings with no picked Moveset: its cutover record (full
 * sim) or the last 4 attacks it learned. `slot` is { id, variant, uid? }
 * with uid the copy's own id; without one, the line's copy on a Team.
 */
export function defaultMoves(user, slot, level) {
  const variant = slot.variant === "shiny" ? "shiny" : "normal";
  const key = slot.uid ? copyKey(slot.uid) : lineRecordKey(user, { id: slot.id, variant });
  const record = isFullSimEnabled() ? recordAt(user, key, slot.id, variant, level) : null;
  return record ? cutoverMoves(record, slot.id, level) : autoMoveset(slot.id, level);
}

/** Records every unpicked Team member's moves once per player. Idempotent. */
export function runCutover(trainerData) {
  let players = 0;
  for (const user of Object.values(trainerData ?? {})) {
    if (!user || user.fullSimCutover >= CUTOVER_VERSION) continue;
    for (const [team, field] of [["display", "displayedPokemon"], ["battle", "battleTeam"]]) {
      for (const slot of normalizeTeam(user[field] ?? [], 6)) {
        const uid = slotBoxUid(user, slot) ?? slotCopyUid(user, slot);
        if (chosenMoves(user, team, slot.id, slot.variant, { uid })) continue;
        const key = slotMovesKey(user, slot);
        if (user.fullSimMoves?.[key]) continue;
        const level = levelOf(user, slot);
        (user.fullSimMoves ??= {})[key] = { moves: autoMoveset(slot.id, level, LEGACY), level };
      }
    }
    user.fullSimCutover = CUTOVER_VERSION;
    players++;
  }
  return players;
}
