// ==========================================================
// public/teams/copyPicker.js — "Which copy?" for a team slot (TM system T5).
// Used when adding a Pokémon that has trained copies, and by a slot's
// "Change copy" button. Resolves to:
//   "c_…"      a trained copy (its TM moves come along)
//   null       an untrained copy
//   undefined  cancelled
// The server checks the copy again when the team is saved.
// Resolves from its own buttons / Escape, not from the dialog "close"
// event (some embedded browsers don't fire it reliably).
// ==========================================================

import { mountCopyChoice } from "/public/picker-pokemon/copyChoice.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function chooseCopy({ userData, pokeId, variant, name, owned, current }) {
  return new Promise((resolve) => {
    const lastFocus = document.activeElement;
    const d = document.createElement("dialog");
    d.className = "cc-dialog";
    d.setAttribute("aria-labelledby", "copyPickTitle");
    d.innerHTML = `
      <h2 id="copyPickTitle">${esc(name)}${variant === "shiny" ? " ✨" : ""}</h2>
      <p class="tm-sub">Which copy goes on this team? Trained copies battle with the moves they learned from TMs.</p>
      <div data-slot></div>
      <div class="tm-moves-actions" style="margin-top:12px"><button type="button" class="cc-btn" data-cancel>Cancel</button><button type="button" class="cc-btn cc-btn--primary" data-ok>Use this copy</button></div>`;
    document.body.append(d);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      if (d.open) d.close();
      d.remove();
      lastFocus?.focus?.({ preventScroll: true });
      resolve(value);
    };
    const ok = d.querySelector("[data-ok]");
    const picker = mountCopyChoice(d.querySelector("[data-slot]"), {
      userData, pokeId, variant, name, owned, mode: "team",
      onChange: () => { ok.disabled = !picker.get().ok; },
    });
    // Start on the slot's current copy when changing an existing slot.
    if (current !== undefined) {
      const r = d.querySelector(`[data-slot] input[type=radio][value="${CSS.escape(current ?? "")}"]`);
      if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
    }
    ok.disabled = !picker.get().ok;
    ok.onclick = () => { const c = picker.get(); if (c.ok) finish(c.uid ?? null); };
    d.querySelector("[data-cancel]").onclick = () => finish(undefined);
    d.addEventListener("cancel", (e) => { e.preventDefault(); finish(undefined); }); // Escape
    d.addEventListener("click", (e) => { if (e.target === d) finish(undefined); }); // backdrop
    d.addEventListener("close", () => finish(undefined));
    d.showModal();
    d.querySelector("[data-slot] input:checked, [data-slot] input")?.focus();
  });
}
