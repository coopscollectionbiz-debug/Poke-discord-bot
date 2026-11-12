// ==========================================================
// public/picker-pokemon/copyChoice.js — "Which copy?" for Donate, Evolve
// and Convert to shiny (TM system phase T5).
//
// Shown only when the Pokémon + Variant has trained copies (copies that
// learned TM moves). Untrained copies are interchangeable and offered as one
// option ("Untrained ×N", the default when there is one). A trained copy is
// never chosen automatically.
//
// Donate mode adds the TM warning (owner decision D-T10): a trained copy
// can be donated only after the player ticks "I understand…". The server
// re-checks the copy, its revision and the confirmation.
//
// data: userData.trained from GET /api/user-pokemon
//   { "6:normal": [{ uid, rev, tmMoves: [{ id, name, type, category, power }], teams }] }
// ==========================================================

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const list = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

const STYLE = `
.cc-copychoice{margin:12px 0;text-align:left}
.cc-copychoice p.cc-cc-title{margin:0 0 6px;font-weight:800;color:var(--cc-text)}
.cc-copychoice label.cc-cc-opt{display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 10px;margin:4px 0;border:1.5px solid var(--cc-line);border-radius:10px;cursor:pointer;color:var(--cc-text)}
.cc-copychoice label.cc-cc-opt:has(input:checked){border-color:var(--cc-blue)}
.cc-copychoice label.cc-cc-opt small{margin-left:auto;color:var(--cc-text-muted);text-align:right}
.cc-copychoice .cc-tmwarn{margin-top:10px;padding:10px 12px;border:1.5px solid var(--cc-red,#e5534b);border-radius:10px;background:color-mix(in srgb,var(--cc-red,#e5534b) 10%,transparent)}
.cc-copychoice .cc-tmwarn b{display:block;margin-bottom:4px;color:var(--cc-text)}
.cc-copychoice .cc-tmwarn p{margin:0 0 8px;color:var(--cc-text-muted)}
.cc-copychoice .cc-tmwarn label{display:flex;gap:10px;align-items:flex-start;min-height:44px;color:var(--cc-text);font-weight:700;cursor:pointer}
.cc-copychoice .cc-tmwarn input{width:20px;height:20px;flex:none;margin-top:1px}
.cc-copychoice .cc-tmnote{margin:8px 0 0;color:var(--cc-text-muted);font-size:14px}`;

function ensureCss() {
  if (document.getElementById("ccCopyChoiceCss")) return;
  const st = document.createElement("style");
  st.id = "ccCopyChoiceCss";
  st.textContent = STYLE;
  document.head.append(st);
}

/** Trained copies of one Pokémon + Variant (from /api/user-pokemon). */
export function trainedCopies(userData, pokeId, variant) {
  return userData?.trained?.[`${Number(pokeId)}:${variant === "shiny" ? "shiny" : "normal"}`] ?? [];
}

/**
 * Mount the chooser into `container` (replacing its content).
 * mode: "donate" | "evolve" | "convert". onChange(): called after any change.
 * Returns { needed, get(): { ok, uid, rev, confirmTrained, copy } }.
 *   needed=false → no trained copies; get() is always { ok:true, uid:null }.
 */
export function mountCopyChoice(container, { userData, pokeId, variant, name, owned, mode, onChange = () => {} }) {
  const trained = trainedCopies(userData, pokeId, variant);
  container.innerHTML = "";
  if (!trained.length) return { needed: false, get: () => ({ ok: true, uid: null, rev: null, confirmTrained: false, copy: null }) };
  ensureCss();
  const plain = Math.max(0, Number(owned) - trained.length);
  const group = `cc-copy-${Math.random().toString(36).slice(2, 8)}`;
  const where = (t) => [t.teams?.display ? `Display slot ${t.teams.display}` : "", t.teams?.battle ? `Battle slot ${t.teams.battle}` : ""].filter(Boolean).join(" · ") || "Not on a team";
  let choice = plain > 0 ? "" : null; // "" = untrained; uid = trained; null = not chosen yet
  let ack = false;

  const draw = () => {
    const t = trained.find((x) => x.uid === choice) ?? null;
    const moves = t ? list(t.tmMoves.map((m) => m.name)) : "";
    container.innerHTML = `<div class="cc-copychoice">
      <p class="cc-cc-title">Which ${esc(name)}?</p>
      ${plain > 0 ? `<label class="cc-cc-opt"><input type="radio" name="${group}" value=""${choice === "" ? " checked" : ""}><span>Untrained ×${plain}</span></label>` : ""}
      ${trained.map((x) => `<label class="cc-cc-opt"><input type="radio" name="${group}" value="${esc(x.uid)}"${choice === x.uid ? " checked" : ""}>
        <span>★ Trained · ${esc(x.tmMoves.map((m) => m.name).join(", "))}</span><small>${esc(where(x))}</small></label>`).join("")}
      ${t && mode === "donate" ? `<div class="cc-tmwarn" role="alert">
          <b>⚠️ This ${esc(name)} has TM-trained moves</b>
          <p>It learned ${esc(moves)} from TMs. Donating it permanently removes those trained moves. The TMs are not refunded.</p>
          <label><input type="checkbox" data-ack${ack ? " checked" : ""}><span>I understand this trained ${esc(name)} and its TM moves will be gone.</span></label>
        </div>` : ""}
      ${t && (mode === "evolve" || mode === "convert") ? `<p class="cc-tmnote">Its TM moves (${esc(moves)}) stay with it.</p>` : ""}
    </div>`;
  };
  container.onchange = (e) => {
    if (e.target.matches?.(`input[name="${group}"]`)) { choice = e.target.value; ack = false; }
    else if (e.target.matches?.("[data-ack]")) ack = e.target.checked;
    draw();
    const again = e.target.matches?.("[data-ack]") ? container.querySelector("[data-ack]") : container.querySelector(`input[name="${group}"][value="${CSS.escape(e.target.value)}"]`);
    again?.focus({ preventScroll: true });
    onChange();
  };
  draw();

  return {
    needed: true,
    get() {
      if (choice === null) return { ok: false, reason: `Choose which ${name}.` };
      if (choice === "") return { ok: true, uid: null, rev: null, confirmTrained: false, copy: null };
      const t = trained.find((x) => x.uid === choice);
      if (!t) return { ok: false, reason: "That copy changed. Close and try again." };
      if (mode === "donate" && !ack) return { ok: false, reason: "Tick the box to confirm.", copy: t };
      return { ok: true, uid: t.uid, rev: t.rev, confirmTrained: mode === "donate", copy: t };
    },
  };
}
