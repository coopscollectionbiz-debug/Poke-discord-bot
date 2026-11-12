// ==========================================================
// public/picker-pokemon/copyChoice.js — "Which one?" for Donate, Evolve,
// Convert to shiny and Feed.
//
// Every copy is its own Pokémon (docs/adr/0001), so the chooser lists each
// copy of the Pokémon + Variant with its Level, its Teams and any TM moves.
// The tile the player tapped in the box is preselected. Shown only when
// there is more than one copy, or a trained one.
//
// A copy on a Team can't be donated or fed (the server refuses it too).
// Donate mode adds the TM warning (owner decision D-T10): a trained copy
// can be donated only after the player ticks "I understand…". The server
// re-checks the copy, its revision and the confirmation.
//
// data (GET /api/user-pokemon):
//   userData.copies  [[uid, id, shiny 0|1, level, caughtAt, trained 0|1, teams bitmask]]
//   userData.trained { "6:normal": [{ uid, rev, tmMoves: [{ id, name, … }], teams }] }
// ==========================================================

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const list = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

const STYLE = `
.cc-copychoice{margin:12px 0;text-align:left}
.cc-copychoice p.cc-cc-title{margin:0 0 6px;font-weight:800;color:var(--cc-text)}
.cc-copychoice .cc-cc-list{max-height:260px;overflow:auto;padding-right:2px}
.cc-copychoice label.cc-cc-opt{display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 10px;margin:4px 0;border:1.5px solid var(--cc-line);border-radius:10px;cursor:pointer;color:var(--cc-text)}
.cc-copychoice label.cc-cc-opt:has(input:checked){border-color:var(--cc-blue)}
.cc-copychoice label.cc-cc-opt.is-off{opacity:.55;cursor:not-allowed}
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

const TEAM_NAMES = [[1, "Casual"], [2, "Ranked"], [4, "Showcase"]];
export const teamNames = (mask) => TEAM_NAMES.filter(([b]) => (mask & b) !== 0).map(([, n]) => n);

/** Trained copies of one Pokémon + Variant (from /api/user-pokemon). */
export function trainedCopies(userData, pokeId, variant) {
  return userData?.trained?.[`${Number(pokeId)}:${variant === "shiny" ? "shiny" : "normal"}`] ?? [];
}

/** Every copy of one Pokémon + Variant, best Level first: [{ uid, level, at, trained, teams, rev, tmMoves }]. */
export function copiesOf(userData, pokeId, variant) {
  const shiny = variant === "shiny" ? 1 : 0;
  const trained = new Map(trainedCopies(userData, pokeId, variant).map((t) => [t.uid, t]));
  return (Array.isArray(userData?.copies) ? userData.copies : [])
    .filter((r) => r[1] === Number(pokeId) && r[2] === shiny)
    .map(([uid, , , level, at, isTrained, teams]) => ({
      uid, level, at, teams, trained: !!isTrained,
      rev: trained.get(uid)?.rev ?? null,
      tmMoves: trained.get(uid)?.tmMoves ?? [],
    }))
    .sort((a, b) => b.level - a.level || a.uid.localeCompare(b.uid));
}

/**
 * Mount the chooser into `container` (replacing its content).
 * mode: "donate" | "evolve" | "convert" | "feed". onChange(): after any change.
 * preselect: the uid of the tile the player tapped. exclude: uid(s) not to offer (the Feed
 * target, or copies already on the same team).
 * Returns { needed, get(): { ok, uid, rev, confirmTrained, copy } }.
 */
export function mountCopyChoice(container, { userData, pokeId, variant, name, mode, onChange = () => {}, preselect = null, exclude = null }) {
  // exclude: one uid or a list (copies already used elsewhere on the same team).
  const skip = new Set([exclude ?? []].flat());
  const copies = copiesOf(userData, pokeId, variant).filter((c) => !skip.has(c.uid));
  container.innerHTML = "";
  const lockedOut = (c) => (mode === "donate" || mode === "feed") && c.teams > 0;
  if (mode !== "feed" && copies.length <= 1 && !copies.some((c) => c.trained)) {
    const only = copies[0] ?? null;
    return { needed: false, get: () => ({ ok: true, uid: only?.uid ?? null, rev: null, confirmTrained: false, copy: only }) };
  }
  ensureCss();
  const group = `cc-copy-${Math.random().toString(36).slice(2, 8)}`;
  const usable = copies.filter((c) => !lockedOut(c));
  let choice = copies.find((c) => c.uid === preselect && !lockedOut(c))?.uid
    ?? (mode === "donate" || mode === "feed" ? [...usable].reverse().find((c) => !c.trained)?.uid : usable[0]?.uid)
    ?? null;
  let ack = false;

  const where = (c) => {
    const t = teamNames(c.teams);
    return t.length ? `On ${t.join(" + ")} team` : "Not on a team";
  };
  const draw = () => {
    const c = copies.find((x) => x.uid === choice) ?? null;
    const moves = c?.trained ? list(c.tmMoves.map((m) => m.name)) : "";
    container.innerHTML = `<div class="cc-copychoice">
      <p class="cc-cc-title">${mode === "feed" ? `Feed which ${esc(name)}?` : `Which ${esc(name)}?`}</p>
      <div class="cc-cc-list" role="radiogroup" aria-label="Which ${esc(name)}">
      ${copies.length ? copies.map((x) => `<label class="cc-cc-opt${lockedOut(x) ? " is-off" : ""}"><input type="radio" name="${group}" value="${esc(x.uid)}"${choice === x.uid ? " checked" : ""}${lockedOut(x) ? " disabled" : ""}>
        <span><b>Lv ${x.level}</b>${x.trained ? ` · ★ ${esc(x.tmMoves.map((m) => m.name).join(", ") || "TM-trained")}` : ""}</span><small>${esc(where(x))}${lockedOut(x) ? " · take it off first" : ""}</small></label>`).join("")
        : `<p class="cc-tmnote">You have no other ${esc(name)} to use.</p>`}
      </div>
      ${c?.trained && (mode === "donate" || mode === "feed") ? `<div class="cc-tmwarn" role="alert">
          <b>⚠️ This ${esc(name)} has TM-trained moves</b>
          <p>It learned ${esc(moves)} from TMs. ${mode === "feed" ? "Feeding" : "Donating"} it permanently removes those trained moves. The TMs are not refunded.</p>
          <label><input type="checkbox" data-ack${ack ? " checked" : ""}><span>I understand this trained ${esc(name)} and its TM moves will be gone.</span></label>
        </div>` : ""}
      ${c?.trained && (mode === "evolve" || mode === "convert") ? `<p class="cc-tmnote">Its TM moves (${esc(moves)}) stay with it.</p>` : ""}
      ${c && c.teams > 0 && (mode === "evolve" || mode === "convert") ? `<p class="cc-tmnote">It stays in its team slots.</p>` : ""}
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
      if (choice === null) return { ok: false, reason: copies.length ? `Choose which ${name}.` : `You have no other ${name} to use.` };
      const c = copies.find((x) => x.uid === choice);
      if (!c) return { ok: false, reason: "That Pokémon changed. Close and try again." };
      if ((mode === "donate" || mode === "feed") && c.trained && !ack) return { ok: false, reason: "Tick the box to confirm.", copy: c };
      return { ok: true, uid: c.uid, rev: c.trained ? c.rev : null, confirmTrained: mode === "donate" && c.trained, copy: c };
    },
  };
}
