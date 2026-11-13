// ==========================================================
// public/teams/movePicks.js — the Moves editor's picks (public/teams/moves.js),
// DOM-free so tests/teamsMovePicks.test.js runs them in Node.
//
// The editor holds { auto, picked }. auto: the Pokémon uses its automatic
// moves, the ones the server says it fights with when nothing is picked
// (copy.moves), which can include moves recorded at the full-sim switch that
// its learnset no longer teaches. Those show and fight, but can't be ticked.
// picked: up to 4 moves it can pick (copy.learnable). Save sends null for
// automatic moves, else the picks.
// ==========================================================

export const MAX = 4;
export const AUTOMATIC = Object.freeze({ auto: true, picked: [] });

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const canPick = (copy, id) => copy.learnable.some((l) => l.id === id);

/** A pick of `ids`, keeping only moves it can pick, four at most. */
export function pickFrom(copy, ids) {
  return { auto: false, picked: ids.filter((id) => canPick(copy, id)).slice(0, MAX) };
}

/** This Team's Moveset, else automatic moves. */
export function startPicks(copy, team) {
  const chosen = copy.movesets?.[team];
  return chosen ? pickFrom(copy, chosen.map((m) => m.id)) : AUTOMATIC;
}

/** The moves the editor lists at the top: [{ id, name }]. */
export function shownMoves(state, copy) {
  return state.auto ? copy.moves : state.picked.map((id) => copy.learnable.find((l) => l.id === id) ?? { id, name: id });
}

/** Ids of the ticked boxes: the automatic moves it can pick, or the picks. */
export function tickedMoves(state, copy) {
  return state.auto ? pickFrom(copy, copy.moves.map((m) => m.id)).picked : state.picked;
}

/**
 * Moves it would fight with that it can't pick again: the automatic moves
 * shown, or, while picking, what it fights with until the pick is saved.
 */
export function lostMoves(state, copy, team) {
  const fighting = state.auto ? copy.moves : copy.movesets?.[team] ?? copy.moves;
  return fighting.filter((m) => !canPick(copy, m.id));
}

/** Tick (on) or untick a move. From automatic moves, this starts a pick from the ticked ones. */
export function toggleMove(state, copy, id, on) {
  const picked = tickedMoves(state, copy).filter((x) => x !== id);
  return { auto: false, picked: on && picked.length < MAX && canPick(copy, id) ? [...picked, id] : picked };
}

/** What Save sends: null brings back automatic moves. */
export const savedMoves = (state) => (state.auto ? null : state.picked);
export const canSave = (state) => state.auto || state.picked.length > 0;

/** One row of the move list. meta: the move's details as HTML (public/shared/moveMeta.js). */
export function moveRow(m, { on, full, recommended, meta }) {
  const locked = !on && full;
  return `<li><label class="tm-move${on ? " is-on" : ""}${locked ? " is-full" : ""}${recommended ? " is-rec" : ""}">
    <input type="checkbox" value="${esc(m.id)}"${on ? " checked" : ""}${locked ? " disabled" : ""}>
    <span class="tm-move-name">${esc(m.name)}${meta}</span>${recommended ? `<span class="tm-move-rec">Recommended</span>` : ""}
  </label></li>`;
}
