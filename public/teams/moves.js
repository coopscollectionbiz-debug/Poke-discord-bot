// ==========================================================
// public/teams/moves.js — the Teams page's moveset editor (owner decision:
// each team keeps its own moveset for the same Pokémon copy, with a copy
// from the other team). Up to 4 distinct moves the copy has learned by its
// real Level (TMs later). Saves at once through POST /api/pokemon/moveset;
// "Use automatic moves" clears the choice. The server re-checks every rule.
// ==========================================================

import { toast, showActionError, showExpired } from "/public/shared/shell.js";

const MAX = 4;
const LABEL = { display: "Display team", battle: "Battle team" };
const OTHER = { display: "battle", battle: "display" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let dialog = null;
let lastFocus = null;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "tm-moves";
  dialog.setAttribute("aria-labelledby", "movesTitle");
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => lastFocus?.focus?.({ preventScroll: true }));
  document.body.append(dialog);
  return dialog;
}

async function postMoveset(userId, team, s, moves) {
  const res = await fetch("/api/pokemon/moveset", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId, team, pokeId: s.id, variant: s.variant, moves }),
  });
  let body = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (res.status === 403) { showExpired(); throw Object.assign(new Error("expired"), { silent: true }); }
  if (!res.ok || !body.success) throw new Error(body.error || `Couldn’t save the moves (${res.status}).`);
  return body.moves ?? null;
}

/**
 * Open the editor for copy `s` ({ id, variant, name }) on team `team`.
 * onSaved(): called after a successful save (the page re-renders).
 */
export async function openMovesEditor({ userId, team, s, name, onSaved }) {
  lastFocus = document.activeElement;
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
  const copy = d.copies?.[s.variant];
  if (!copy) { dialog.close(); return toast("You don’t own that copy any more."); }
  const chosen = copy.movesets?.[team];
  const other = copy.movesets?.[OTHER[team]];
  // Start from this team's moveset, else the automatic one it battles with now.
  let picked = (chosen ?? copy.moves).map((m) => m.id).filter((id) => copy.learnable.some((l) => l.id === id));

  const draw = () => {
    const full = picked.length >= MAX;
    dialog.innerHTML = `
      <div class="tm-moves-head">
        <div><p class="cc-eyebrow">${esc(LABEL[team])} · Lv ${copy.level}</p><h2 id="movesTitle">${esc(name)}’s moves</h2>
          <p class="tm-sub">Pick up to 4 moves it has learned. ${team === "battle" ? "Ranked battles are at Lv 50, but it only knows moves learned by its real Level." : "Used in casual (open) battles."}</p></div>
        <button type="button" class="tm-ib" data-close aria-label="Close">✕</button>
      </div>
      <div class="tm-moves-picked" aria-live="polite"><b>${picked.length}/${MAX}</b> ${picked.map((id) => `<span class="tm-movechip">${esc(copy.learnable.find((l) => l.id === id)?.name ?? id)}</span>`).join("") || "<span class=\"tm-sub\">No moves picked</span>"}</div>
      <div class="tm-moves-tools">
        ${other ? `<button type="button" class="cc-btn" data-copy>Copy from ${esc(LABEL[OTHER[team]])}</button>` : ""}
        <button type="button" class="cc-btn" data-auto>Use automatic moves</button>
      </div>
      <ul class="tm-movelist" aria-label="Learned moves">
        ${copy.learnable.map((m) => {
          const on = picked.includes(m.id);
          return `<li><label class="tm-move${on ? " is-on" : ""}${!on && full ? " is-full" : ""}">
            <input type="checkbox" value="${esc(m.id)}"${on ? " checked" : ""}${!on && full ? " disabled" : ""}>
            <span class="tm-move-name">${esc(m.name)}</span>
            ${m.type ? `<span class="cc-type" data-type="${esc(m.type.toLowerCase())}">${esc(m.type)}</span>` : ""}
            <span class="tm-move-meta">${m.power ? `${m.power} pow` : m.category ? esc(m.category) : ""}${m.source === "tm" ? " · TM" : m.learnedAt ? ` · Lv ${m.learnedAt}` : ""}</span>
          </label></li>`;
        }).join("")}
      </ul>
      <p class="tm-sub tm-moves-note">${copy.nextMoves?.length ? `Learns next: ${copy.nextMoves.map((m) => esc(m.name)).join(", ")}. ` : ""}TMs will add more moves here.</p>
      <div class="tm-moves-actions"><button type="button" class="cc-btn" data-close>Cancel</button><button type="button" class="cc-btn cc-btn--primary" data-save${picked.length ? "" : " disabled"}>Save moves</button></div>`;
  };
  draw();
  dialog.querySelector("[data-close]")?.focus();

  dialog.onchange = (e) => {
    const box = e.target.closest('input[type="checkbox"]');
    if (!box) return;
    if (box.checked && picked.length < MAX && !picked.includes(box.value)) picked.push(box.value);
    if (!box.checked) picked = picked.filter((x) => x !== box.value);
    draw();
    dialog.querySelector(`input[value="${CSS.escape(box.value)}"]`)?.focus();
  };
  dialog.onclick = async (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) return dialog.close();
    if (e.target.closest("[data-copy]")) {
      picked = other.map((m) => m.id).filter((id) => copy.learnable.some((l) => l.id === id)).slice(0, MAX);
      draw();
      toast(`Copied the ${LABEL[OTHER[team]]}’s moves. Save to keep them.`);
      return;
    }
    if (e.target.closest("[data-auto]") || e.target.closest("[data-save]")) {
      const clearing = !!e.target.closest("[data-auto]");
      try {
        await postMoveset(userId, team, s, clearing ? null : picked);
        dialog.close();
        toast(clearing ? `${name} uses its automatic moves on your ${LABEL[team]}.` : `${name}’s moves saved for your ${LABEL[team]}.`, { tone: "success" });
        onSaved?.();
      } catch (err) {
        if (!err.silent) showActionError(err, "Couldn’t save the moves");
      }
    }
  };
}
