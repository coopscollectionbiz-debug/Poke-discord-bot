// ==========================================================
// public/shared/teachTm.js — the "Teach a TM" dialog (TM system phase T4).
// Opened from the Collection detail dialog and the Teams page Moves editor.
//
//   GET  /api/pokemon/tm-options?id&species&variant   copies, teams, owned TMs
//   POST /api/pokemon/teach-tm                         the teach (one transaction)
//
// Steps in one dialog: which copy (only when there's a choice) → which TM →
// for each team that copy is on, add / replace / keep (nothing replaced
// without a tap) → confirm. The server re-checks everything; if anything
// changed meanwhile it refuses (TM kept) and the dialog reloads.
// ==========================================================

import { toast, showExpired, pageHref } from "/public/shared/shell.js";
import { moveMeta } from "/public/shared/moveMeta.js";

const LABEL = { display: "Display team", battle: "Battle team" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const newRequestId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
// Standard move row: name on top, type · category · power · accuracy below.
const moveRow = (m, prefix = "") => `<span class="tt-move"><b>${prefix}${esc(m.name)}</b>${moveMeta(m)}</span>`;

const STYLE = `
.tmx-teach{width:min(560px,calc(100vw - 32px));max-height:min(88vh,88dvh);padding:0;border:1.5px solid var(--cc-line);border-radius:var(--cc-r-md,14px);background:var(--cc-surface);color:var(--cc-text);}
.tmx-teach::backdrop{background:#0009}
.tmx-teach form{display:flex;flex-direction:column;max-height:min(88vh,88dvh)}
.tmx-teach .tt-head{display:flex;justify-content:space-between;gap:12px;padding:16px 16px 8px}
.tmx-teach .tt-head h2{margin:0;font-size:20px}
.tmx-teach .tt-body{overflow-y:auto;padding:0 16px 8px;overscroll-behavior:contain}
.tmx-teach fieldset{border:0;margin:0 0 14px;padding:0}
.tmx-teach legend{font-weight:800;margin-bottom:6px}
.tmx-teach .tt-opt{display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 10px;margin:4px 0;border:1.5px solid var(--cc-line);border-radius:10px;cursor:pointer}
.tmx-teach .tt-opt:has(input:checked){border-color:var(--cc-blue)}
.tmx-teach .tt-opt.is-off{opacity:.55;cursor:not-allowed}
.tmx-teach .tt-opt small{color:var(--cc-text-muted);margin-left:auto;text-align:right}
.tmx-teach .tt-move{display:flex;flex-direction:column;min-width:0}
.tmx-teach .tt-muted{color:var(--cc-text-muted);font-size:14px;margin:4px 0}
.tmx-teach .tt-note{margin:0 0 12px;padding:8px 10px;border-radius:10px;background:var(--cc-surface-raised);font-size:14px}
.tmx-teach .tt-note.is-error{border:1px solid var(--cc-red,#e5534b)}
.tmx-teach .tt-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;padding:12px 16px;border-top:1px solid var(--cc-line)}
.tmx-teach .tt-foot p{flex:1 1 200px;margin:0;font-size:13px;color:var(--cc-text-muted)}
@media (max-width:520px){.tmx-teach{width:100vw;max-width:100vw;max-height:100dvh;height:100dvh;border-radius:0}.tmx-teach form{max-height:100dvh;height:100%}.tmx-teach .tt-body{flex:1}}`;

let dialog = null;
function ensureDialog() {
  if (dialog) return dialog;
  if (!document.getElementById("tmxTeachCss")) {
    const st = document.createElement("style");
    st.id = "tmxTeachCss";
    st.textContent = STYLE;
    document.head.append(st);
  }
  dialog = document.createElement("dialog");
  dialog.className = "tmx-teach";
  dialog.setAttribute("aria-labelledby", "ttTitle");
  document.body.append(dialog);
  return dialog;
}

async function getJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  const body = await res.json().catch(() => ({}));
  if (res.status === 403) { showExpired(); throw Object.assign(new Error("expired"), { silent: true }); }
  if (!res.ok) throw new Error(body.error || `Couldn’t load your TMs (${res.status}).`);
  return body;
}

/**
 * Open the dialog for one Pokémon + Variant.
 * uid: undefined = let the player choose a copy; null = an untrained copy;
 * "c_…" = that trained copy (e.g. the copy in a team slot).
 * onDone(result): after a successful teach.
 */
export async function openTeachDialog({ userId, speciesId, variant, name, uid = undefined, onDone }) {
  const lastFocus = document.activeElement;
  ensureDialog();
  const ids = new Map(); // one request id per (copy, TM) choice
  const idFor = (k) => { if (!ids.has(k)) ids.set(k, newRequestId()); return ids.get(k); };
  const sel = { target: uid === undefined ? null : uid === null ? "untrained" : uid, item: null, equip: {} };
  let data = null;
  let note = null;
  let busy = false;

  dialog.onclose = () => lastFocus?.focus?.({ preventScroll: true });
  dialog.innerHTML = `<form method="dialog"><div class="tt-head"><h2 id="ttTitle">Teach a TM</h2></div><p class="tt-muted" style="padding:0 16px 16px">Loading…</p></form>`;
  if (!dialog.open) dialog.showModal();

  async function load() {
    try {
      data = await getJSON(`/api/pokemon/tm-options?${new URLSearchParams({ id: userId, species: speciesId, variant })}`);
    } catch (err) {
      if (err.silent) return dialog.close();
      dialog.innerHTML = `<form method="dialog"><div class="tt-head"><h2 id="ttTitle">Couldn’t load your TMs</h2></div><p class="tt-muted" style="padding:0 16px">${esc(err.message)}</p><div class="tt-foot"><button class="cc-btn" value="close">Close</button></div></form>`;
      return;
    }
    if (!data.enabled) { dialog.close(); return toast("TMs aren’t available yet."); }
    if (sel.target && !data.targets.some((t) => t.key === sel.target)) sel.target = null;
    if (!sel.target && data.targets.length === 1) sel.target = data.targets[0].key;
    if (sel.item && !data.tms.some((t) => t.item === sel.item)) sel.item = null;
    sel.equip = {};
    draw();
  }

  const target = () => data.targets.find((t) => t.key === sel.target) ?? null;
  const tm = () => data.tms.find((t) => t.item === sel.item) ?? null;
  const teamsOn = () => Object.entries(target()?.teams ?? {});
  const ready = () => {
    if (!target() || !tm() || tm().status[sel.target] !== "teachable") return false;
    return teamsOn().every(([team, on]) => sel.equip[team] === "keep" || sel.equip[team] === "add" || (sel.equip[team]?.replace && on.moves.some((m) => m.id === sel.equip[team].replace)));
  };

  function draw() {
    const keepScroll = dialog.querySelector(".tt-body")?.scrollTop ?? 0; // redraws must not jump to the top
    const t = target();
    const copyStep = data.targets.length > 1 ? `<fieldset><legend>Which ${esc(name)}?</legend>${data.targets.map((x) => `
      <label class="tt-opt"><input type="radio" name="tt-copy" value="${esc(x.key)}"${sel.target === x.key ? " checked" : ""}>
        <span>${x.uid ? `★ Trained · ${x.tmMoves.map((m) => esc(m.name)).join(", ")}` : `Untrained ×${x.count}`}</span>
        <small>${Object.entries(x.teams).map(([team, on]) => `${LABEL[team]} slot ${on.slot}`).join(" · ") || "Not on a team"}</small></label>`).join("")}</fieldset>` : "";
    const tmStep = !t ? "" : data.tms.length === 0
      ? `<p class="tt-note">You don’t have any TMs. <a href="${pageHref("/public/dashboardshop/", userId)}">Buy TMs in the Shop</a>.</p>`
      : `<fieldset><legend>Which TM?</legend>${data.tms.map((x) => {
          const st = x.status[sel.target];
          const why = st === "known" ? "Already knows it" : st === "incompatible" ? `${esc(name)} can’t learn it` : `You have ${x.owned}`;
          return `<label class="tt-opt${st === "teachable" ? "" : " is-off"}"><input type="radio" name="tt-tm" value="${esc(x.item)}"${sel.item === x.item ? " checked" : ""}${st === "teachable" ? "" : " disabled"}>
            ${moveRow(x)}<small>${why}</small></label>`;
        }).join("")}</fieldset>`;
    const m = tm();
    const equipStep = !t || !m || m.status[sel.target] !== "teachable" ? "" : teamsOn().length === 0
      ? `<p class="tt-muted">This ${esc(name)} isn’t on a team. ${esc(m.name)} will be learned, and you can pick it in a team’s moves later.</p>`
      : teamsOn().map(([team, on]) => on.moves.length < data.maxMoves
          ? `<fieldset><legend>${LABEL[team]} (slot ${on.slot})</legend><p class="tt-muted">Now: ${on.moves.map((x) => esc(x.name)).join(", ")}</p>
              <label class="tt-opt"><input type="checkbox" data-team="${team}" data-add${sel.equip[team] === "keep" ? "" : " checked"}><span>Add ${esc(m.name)} to these moves</span></label></fieldset>`
          : `<fieldset><legend>${LABEL[team]} (slot ${on.slot}): replace a move?</legend>
              ${on.moves.map((x) => `<label class="tt-opt"><input type="radio" name="tt-eq-${team}" data-team="${team}" value="${esc(x.id)}"${sel.equip[team]?.replace === x.id ? " checked" : ""}>${moveRow(x, "Replace ")}</label>`).join("")}
              <label class="tt-opt"><input type="radio" name="tt-eq-${team}" data-team="${team}" value=""${sel.equip[team] === "keep" ? " checked" : ""}><span>Keep current moves</span></label></fieldset>`).join("");
    // Teams under 4 moves default to "add" (pre-checked, can untick).
    for (const [team, on] of teamsOn()) if (on.moves.length < data.maxMoves && sel.equip[team] == null) sel.equip[team] = "add";
    dialog.innerHTML = `<form method="dialog">
      <div class="tt-head"><div><p class="cc-eyebrow">Teach a TM</p><h2 id="ttTitle">${esc(name)}${variant === "shiny" ? " ✨" : ""}</h2></div>
        <button class="tm-ib dt-close" value="close" aria-label="Close" formnovalidate>✕</button></div>
      <div class="tt-body">${note ? `<p class="tt-note is-error" role="alert">${esc(note)}</p>` : ""}${copyStep}${tmStep}${equipStep}</div>
      <div class="tt-foot"><p>${m && t ? `Uses 1 ${esc(m.name)} TM (you have ${m.owned}). It stays learned by this ${esc(name)}.` : ""}</p>
        <button class="cc-btn" value="close" formnovalidate>Cancel</button>
        <button type="button" class="cc-btn cc-btn--primary" data-teach${ready() && !busy ? "" : " disabled"}>${busy ? "Teaching…" : m ? `Teach ${esc(m.name)}` : "Teach"}</button></div></form>`;
    const body = dialog.querySelector(".tt-body");
    if (body) body.scrollTop = keepScroll;
  }

  dialog.onchange = (e) => {
    const el = e.target;
    if (el.name === "tt-copy") { sel.target = el.value; sel.item = null; sel.equip = {}; }
    else if (el.name === "tt-tm") { sel.item = el.value; sel.equip = {}; }
    else if (el.dataset.add != null) sel.equip[el.dataset.team] = el.checked ? "add" : "keep";
    else if (el.dataset.team) sel.equip[el.dataset.team] = el.value ? { replace: el.value } : "keep";
    note = null;
    draw();
    // keep keyboard focus on the control that was just changed
    const again = el.name ? dialog.querySelector(`input[name="${CSS.escape(el.name)}"][value="${CSS.escape(el.value)}"]`) : dialog.querySelector(`input[data-team="${CSS.escape(el.dataset.team ?? "")}"][data-add]`);
    again?.focus({ preventScroll: true });
  };

  dialog.onclick = async (e) => {
    if (!e.target.closest("[data-teach]") || !ready() || busy) return;
    const t = target();
    const m = tm();
    busy = true;
    draw();
    try {
      const res = await fetch("/api/pokemon/teach-tm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: userId, item: m.item, pokeId: speciesId, variant, uid: t.uid, rev: t.rev,
          expect: Object.fromEntries(teamsOn().map(([team, on]) => [team, on.moves.map((x) => x.id)])),
          equip: Object.fromEntries(teamsOn().map(([team]) => [team, sel.equip[team]])),
          requestId: idFor(`${t.key}|${m.item}`),
        }),
      });
      const body = await res.json().catch(() => ({}));
      busy = false;
      if (res.status === 403 && /session/i.test(body.error ?? "")) { dialog.close(); return showExpired(); }
      if (res.status === 409) { note = body.error || "Something changed. Check and confirm again."; return load(); }
      if (!res.ok || !body.success) { note = body.error || `Couldn’t teach the move (${res.status}).`; return draw(); }
      dialog.close();
      toast(`${name} learned ${body.move?.name ?? m.name}!${body.saveNotice ? ` ${body.saveNotice}` : ""}`, { tone: "success" });
      onDone?.(body);
    } catch {
      busy = false;
      note = "Couldn’t reach the server. Check your Bag before trying again.";
      draw();
    }
  };

  await load();
}
