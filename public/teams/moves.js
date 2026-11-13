// ==========================================================
// public/teams/moves.js — the Teams page's moveset editor (owner decision:
// each team keeps its own moveset for the same Pokémon copy, with a copy
// from the other team). Up to 4 distinct moves the copy has learned by its
// real Level, plus the TM moves of the slot's copy when it is a trained copy
// (`s.uid`, TM system). Saves at once through POST /api/pokemon/moveset;
// "Use automatic moves" clears the choice. The server re-checks every rule.
// ==========================================================

import { toast, showActionError, showExpired } from "/public/shared/shell.js";
import { openTeachDialog } from "/public/shared/teachTm.js";
import { moveMeta } from "/public/shared/moveMeta.js";

const MAX = 4;
const LABEL = { display: "Display team", battle: "Battle team" };
const OTHER = { display: "battle", battle: "display" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let dialog = null;
let lastFocus = null;
let saving = false; // a save is in flight: keep the dialog open and its controls disabled

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "tm-moves";
  dialog.setAttribute("aria-labelledby", "movesTitle");
  dialog.addEventListener("click", (e) => { if (e.target === dialog && !saving) dialog.close(); });
  dialog.addEventListener("cancel", (e) => { if (saving) e.preventDefault(); }); // Esc while saving
  dialog.addEventListener("close", () => lastFocus?.focus?.({ preventScroll: true }));
  document.body.append(dialog);
  return dialog;
}

async function postMoveset(userId, team, s, moves) {
  const res = await fetch("/api/pokemon/moveset", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId, team, pokeId: s.id, variant: s.variant, moves, ...(s.uid ? { uid: s.uid } : {}) }),
  });
  let body = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (res.status === 403) { showExpired(); throw Object.assign(new Error("expired"), { silent: true }); }
  if (!res.ok || !body.success) throw new Error(body.error || `Couldn’t save the moves (${res.status}).`);
  return body;
}

/**
 * Open the editor for copy `s` ({ id, variant, name }) on team `team`.
 * onSaved(): called after a successful save (the page re-renders).
 */
export async function openMovesEditor({ userId, team, s, name, suggested = [], onSaved, onTaught }) {
  lastFocus = document.activeElement;
  saving = false;
  ensureDialog();
  dialog.innerHTML = `<p class="tm-sub" style="padding:24px">Loading moves…</p>`;
  if (!dialog.open) dialog.showModal();
  let d;
  try {
    const res = await fetch(`/api/pokemon/detail?${new URLSearchParams({ id: userId, species: s.id })}`, { credentials: "same-origin" });
    if (res.status === 403) { dialog.close(); return showExpired(); }
    d = await res.json();
    if (!res.ok) throw new Error(d.error || "Couldn’t load the moves.");
  } catch (err) {
    dialog.innerHTML = `<div class="tm-moves-head"><h2 id="movesTitle">Couldn’t load the moves</h2><button type="button" class="tm-ib" data-close aria-label="Close">✕</button></div><p class="tm-sub" style="padding:0 16px 16px">${esc(err.message)}</p>`;
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    return;
  }
  const line = d.copies?.[s.variant];
  if (!line) { dialog.close(); return toast("You don’t own that copy any more."); }
  // Every copy is its own Pokémon (docs/adr/0001): the slot's copy has its
  // own Level, learnable moves and moveset per team. A trained copy also
  // lists its TM moves in the note below.
  const own = s.uid ? line.each?.find((c) => c.uid === s.uid) : null;
  if (s.uid && !own) { dialog.close(); return toast("That Pokémon changed. Reload the page."); }
  const trained = s.uid ? line.trained?.find((t) => t.uid === s.uid) ?? null : null;
  const copy = own ? { ...line, level: own.level, moves: own.moves, nextMoves: own.nextMoves, learnable: own.learnable, movesets: own.movesets } : line;
  copy.learnable ??= [];
  const chosen = copy.movesets?.[team];
  const other = copy.movesets?.[OTHER[team]];
  // Start from this team's moveset, else the automatic one it battles with now.
  let picked = (chosen ?? copy.moves).map((m) => m.id).filter((id) => copy.learnable.some((l) => l.id === id));
  // Full sim: moves picked before the switch that its learnset no longer
  // teaches still fight until this Moveset is saved again.
  const kept = (chosen ?? []).filter((m) => !copy.learnable.some((l) => l.id === m.id));

  const draw = () => {
    const full = picked.length >= MAX;
    dialog.innerHTML = `
      <div class="tm-moves-head">
        <div><p class="cc-eyebrow">${esc(LABEL[team])} · Lv ${copy.level}</p><h2 id="movesTitle">${esc(name)}’s moves</h2>
          <p class="tm-sub">Pick up to 4 moves it has learned. ${team === "battle" ? "Ranked battles are at Lv 50, but it only knows moves learned by its real Level." : "Used in casual (open) battles."}</p></div>
        <button type="button" class="tm-ib" data-close aria-label="Close">✕</button>
      </div>
      <div class="tm-moves-picked" aria-live="polite"><b>${picked.length}/${MAX}</b> ${picked.map((id) => `<span class="tm-movechip">${esc(copy.learnable.find((l) => l.id === id)?.name ?? id)}</span>`).join("") || "<span class=\"tm-sub\">No moves picked</span>"}</div>
      ${kept.length ? `<p class="tm-sub tm-moves-kept">${esc(kept.map((m) => m.name ?? m.id).join(", "))} can't be picked again. ${kept.length === 1 ? "It stays" : "They stay"} until you save new moves.</p>` : ""}
      <div class="tm-moves-tools">
        ${d.tm?.enabled ? `<button type="button" class="cc-btn" data-teach>Teach a TM</button>` : ""}
        ${other ? `<button type="button" class="cc-btn" data-copy>Copy from ${esc(LABEL[OTHER[team]])}</button>` : ""}
        <button type="button" class="cc-btn" data-auto>Use automatic moves</button>
      </div>
      <ul class="tm-movelist" aria-label="Learned moves">
        ${copy.learnable.map((m) => {
          const on = picked.includes(m.id);
          return `<li><label class="tm-move${on ? " is-on" : ""}${!on && full ? " is-full" : ""}">
            <input type="checkbox" value="${esc(m.id)}"${on ? " checked" : ""}${!on && full ? " disabled" : ""}>
            <span class="tm-move-name">${esc(m.name)}${moveMeta(m, { extra: [m.source === "tm" ? "TM" : m.learnedAt ? `Lv ${m.learnedAt}` : "", suggested.includes(m.id) ? "Suggested" : ""] })}</span>
          </label></li>`;
        }).join("")}
      </ul>
      <p class="tm-sub tm-moves-note">${copy.nextMoves?.length ? `Learns next: ${copy.nextMoves.map((m) => esc(m.name)).join(", ")}. ` : ""}${trained ? `★ Trained copy: ${trained.tmMoves.map((m) => esc(m.name)).join(", ")} learned from TMs.` : ""}</p>
      <div class="tm-moves-actions"><button type="button" class="cc-btn" data-close>Cancel</button><button type="button" class="cc-btn cc-btn--primary" data-save${picked.length ? "" : " disabled"}>Save moves</button></div>`;
  };
  draw();
  dialog.querySelector("[data-close]")?.focus();

  dialog.onchange = (e) => {
    const box = e.target.closest('input[type="checkbox"]');
    if (!box || saving) return;
    if (box.checked && picked.length < MAX && !picked.includes(box.value)) picked.push(box.value);
    if (!box.checked) picked = picked.filter((x) => x !== box.value);
    draw();
    dialog.querySelector(`input[value="${CSS.escape(box.value)}"]`)?.focus();
  };
  dialog.onclick = async (e) => {
    if (saving) return; // controls are disabled; ignore stray clicks until the server answers
    if (e.target === dialog || e.target.closest("[data-close]")) return dialog.close();
    if (e.target.closest("[data-teach]")) {
      dialog.close();
      // This slot's copy: its trained copy, or an untrained one (uid null).
      return openTeachDialog({ userId, speciesId: s.id, variant: s.variant, name, uid: s.uid ?? null, onDone: () => onTaught?.() });
    }
    if (e.target.closest("[data-copy]")) {
      picked = other.map((m) => m.id).filter((id) => copy.learnable.some((l) => l.id === id)).slice(0, MAX);
      draw();
      toast(`Copied the ${LABEL[OTHER[team]]}’s moves. Save to keep them.`);
      return;
    }
    if (e.target.closest("[data-auto]") || e.target.closest("[data-save]")) {
      if (saving) return;
      const clearing = !!e.target.closest("[data-auto]");
      setBusy(true, clearing);
      try {
        const body = await postMoveset(userId, team, s, clearing ? null : picked);
        saving = false;
        dialog.close();
        // Success only after the server confirmed; "saved with a delay" when
        // the change is kept in memory but not on disk yet.
        if (body.saved === false) toast(body.saveNotice || "Saved with a delay. Your change is kept and will be written shortly.");
        else toast(clearing ? `${name} uses its automatic moves on your ${LABEL[team]}.` : `${name}’s moves saved for your ${LABEL[team]}.`, { tone: "success" });
        onSaved?.();
      } catch (err) {
        setBusy(false);
        if (!err.silent) showActionError(err, "Couldn’t save the moves");
      }
    }
  };

  // While saving: every control is disabled, the pressed button says
  // "Saving…", and the dialog can't be dismissed (the result is still coming).
  function setBusy(on, clearing = false) {
    saving = on;
    dialog.setAttribute("aria-busy", on ? "true" : "false");
    if (!on) { draw(); return; }
    for (const el of dialog.querySelectorAll("button, input")) el.disabled = true;
    const pressed = dialog.querySelector(clearing ? "[data-auto]" : "[data-save]");
    if (pressed) pressed.textContent = "Saving…";
  }
}
