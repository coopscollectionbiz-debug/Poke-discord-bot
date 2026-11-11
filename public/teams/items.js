// ==========================================================
// public/teams/items.js — the Teams page's held-item picker.
//
// Held items are permanent account-wide unlocks. One unlock can be held by
// one Pokémon in EACH team (Item Clause per team), so equipping on the
// Display team never changes the Battle team. Changes save at once through
// POST /api/held-items/equip (like Moves), independent of unsaved team
// edits. The server re-checks every rule; expectedRev makes a stale tab get
// the latest loadout instead of overwriting it.
// ==========================================================

import { toast, showActionError, showExpired, pageHref } from "/public/shared/shell.js";

const LABEL = { display: "Display team", battle: "Battle team" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(16).slice(2, 10)}`);

let dialog = null;
let lastFocus = null;

/**
 * The small round item icon: the official in-game bag icon on a tinted disc
 * (pixel-crisp; Fairy Feather's HD icon scales smoothly). If the image can't
 * load, the emoji glyph is shown instead.
 */
export function itemIcon(item, { size = "md", mega = false } = {}) {
  if (mega) return `<span class="hi-icon hi-icon--${size} hi-icon--mega" aria-hidden="true">💎</span>`;
  if (!item) return `<span class="hi-icon hi-icon--${size} hi-icon--empty" aria-hidden="true">+</span>`;
  const glyph = esc(item.glyph ?? "•");
  const img = item.icon
    ? `<img class="hi-icon-img${item.iconSmooth ? " is-smooth" : ""}" src="${esc(item.icon)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(this.dataset.glyph))" data-glyph="${glyph}">`
    : glyph;
  return `<span class="hi-icon hi-icon--${size}" data-group="${esc(item.group)}" aria-hidden="true">${img}</span>`;
}

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "tm-moves hi-dialog";
  dialog.setAttribute("aria-labelledby", "hiTitle");
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => lastFocus?.focus?.({ preventScroll: true }));
  document.body.append(dialog);
  return dialog;
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (res.status === 403 && data.code !== "disabled") { showExpired(); throw Object.assign(new Error("expired"), { silent: true }); }
  return { res, data };
}

/** Claim the eight free starter unlocks (idempotent server-side). */
export async function claimStarter(userId) {
  const { res, data } = await postJson("/api/held-items/claim-starter", { id: userId, requestId: newRequestId() });
  if (!res.ok || !data.success) throw new Error(data.error || `Couldn’t unlock your starter items (${res.status}).`);
  return data;
}

/** Buy one unlock (used by the shop page too). */
export async function buyHeldItem(userId, itemId) {
  const { res, data } = await postJson("/api/held-items/buy", { id: userId, itemId, requestId: newRequestId() });
  if (!res.ok || !data.success) throw Object.assign(new Error(data.error || `Couldn’t buy that item (${res.status}).`), { code: data.code });
  return data;
}

/**
 * Open the picker.
 * @param {object} o
 * @param {string} o.userId
 * @param {"display"|"battle"} o.team
 * @param {{id:number, variant:string}} o.s       the team member (saved)
 * @param {string} o.name                          its display name
 * @param {() => object} o.getHeld                 current held state { items, rev, teams }
 * @param {(data:object) => void} o.onChange       server reply (rev/teams/items) after any change or conflict
 * @param {(id:number) => string} o.nameOf         species id → display name
 * @param {(itemId:string) => string|null} [o.warningFor] a warning for this Pokémon (e.g. no effect)
 */
export function openItemPicker({ userId, team, s, name, getHeld, onChange, nameOf, warningFor = null }) {
  lastFocus = document.activeElement;
  const d = ensureDialog();
  const line = `${s.id}:${s.variant}`;
  const ui = { q: "", group: "all", ownedOnly: true, busy: false, confirmMove: null };

  const loadout = () => getHeld().teams?.[team] ?? [];
  const current = () => loadout().find((m) => m.line === line)?.item ?? null;
  const holderOf = (itemId) => loadout().find((m) => m.item === itemId && m.line !== line) ?? null;
  const itemById = (id) => getHeld().items.find((i) => i.id === id) ?? null;

  function statusOf(it) {
    if (it.restrictSpecies && !it.restrictSpecies.includes(s.id)) return { kind: "locked", text: it.rule };
    if (!it.owned) return { kind: "shop", text: it.price ? `Not unlocked · ${it.price.toLocaleString()} CC in the Shop` : "Not unlocked" };
    if (current() === it.id) return { kind: "here", text: "Held by this Pokémon" };
    const h = holderOf(it.id);
    if (h) return { kind: "move", text: `Held by ${nameOf(h.id)} on this team`, holder: h };
    return { kind: "free", text: "Unlocked" };
  }

  function row(it) {
    const st = statusOf(it);
    const btn =
      st.kind === "free" ? `<button type="button" class="cc-btn cc-btn--primary hi-act" data-hi="equip" data-item="${esc(it.id)}"${ui.busy ? " disabled" : ""}>Equip</button>`
      : st.kind === "move" ? (ui.confirmMove === it.id
        ? `<span class="hi-confirm"><button type="button" class="cc-btn cc-btn--primary hi-act" data-hi="move" data-item="${esc(it.id)}"${ui.busy ? " disabled" : ""}>Move here</button><button type="button" class="cc-btn hi-act" data-hi="cancel">Cancel</button></span>`
        : `<button type="button" class="cc-btn hi-act" data-hi="askmove" data-item="${esc(it.id)}"${ui.busy ? " disabled" : ""}>Move here…</button>`)
      : st.kind === "here" ? `<span class="hi-state hi-state--here">✓ Equipped</span>`
      : st.kind === "shop" ? `<a class="cc-btn hi-act" href="${pageHref("/public/dashboardshop")}#held-items">Shop</a>`
      : `<span class="hi-state hi-state--locked">🔒 Can’t hold</span>`;
    const confirm = ui.confirmMove === it.id && st.holder
      ? `<p class="hi-note">${esc(nameOf(st.holder.id))} will hold nothing on your ${LABEL[team]}. Your other team is not changed.</p>` : "";
    const warn = warningFor?.(it.id);
    const evo = warn ? `<p class="hi-note hi-note--warn">⚠ ${esc(warn)}</p>` : "";
    return `<li class="hi-row${st.kind === "here" ? " is-here" : ""}${st.kind === "locked" || st.kind === "shop" ? " is-muted" : ""}">
      ${itemIcon(it)}
      <div class="hi-row-body">
        <p class="hi-row-name">${esc(it.name)} <span class="hi-chip">${esc(it.groupLabel)}</span>${it.starter ? ` <span class="hi-chip hi-chip--free">Free</span>` : ""}</p>
        <p class="hi-row-effect">${esc(it.effect)}</p>
        <p class="hi-row-rule">${esc(it.rule)}</p>
        <p class="hi-row-status hi-row-status--${st.kind}">${esc(st.text)}</p>${confirm}${evo}
      </div>
      <div class="hi-row-act">${btn}</div>
    </li>`;
  }

  function listHtml() {
    const held = getHeld();
    const q = fold(ui.q);
    const list = held.items
      .filter((it) => ui.group === "all" || it.group === ui.group)
      .filter((it) => !ui.ownedOnly || it.owned)
      .filter((it) => !q || fold(`${it.name} ${it.effect} ${it.boostsType ?? ""}`).includes(q))
      .sort((a, b) => {
        const rank = (it) => ({ here: 0, free: 1, move: 2, shop: 3, locked: 4 })[statusOf(it).kind];
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
    return list.length ? list.map(row).join("") : `<li class="hi-empty">No items match. ${ui.ownedOnly ? "Turn off “Only my unlocks” to see every item." : ""}</li>`;
  }
  // Searching only refreshes the list, so the search box keeps its text,
  // caret and on-screen keyboard.
  function renderList() {
    const ul = d.querySelector(".hi-list");
    if (ul) ul.innerHTML = listHtml();
  }

  function render() {
    const held = getHeld();
    const cur = itemById(current());
    const groups = [{ key: "all", label: "All" }, ...(held.groups ?? [])];
    const ownedCount = held.items.filter((i) => i.owned).length;
    const keepScroll = d.scrollTop; // a re-render (busy state, confirm step) must not jump to the top
    d.innerHTML = `<div class="tm-moves-head">
        <h2 class="tm-h2" id="hiTitle">${esc(name)}’s item <small class="hi-sub">${LABEL[team]}</small></h2>
        <button type="button" class="tm-ib" data-hi="close" aria-label="Close">✕</button>
      </div>
      <div class="hi-current">
        ${itemIcon(cur, { size: "lg" })}
        <div class="hi-row-body">
          ${cur ? `<p class="hi-row-name">${esc(cur.name)} <span class="hi-chip">${esc(cur.groupLabel)}</span></p><p class="hi-row-effect">${esc(cur.effect)}</p><p class="hi-row-rule">${esc(cur.rule)}</p>`
            : `<p class="hi-row-name">No item</p><p class="hi-row-rule">Pick one of your unlocked items below.</p>`}
        </div>
        ${cur ? `<button type="button" class="cc-btn hi-act" data-hi="remove"${ui.busy ? " disabled" : ""}>Remove</button>` : ""}
      </div>
      <p class="hi-explain">Items are permanent unlocks: one unlock works on every team, but only one Pokémon per team can hold it. Nothing is used up.</p>
      <div class="hi-tools">
        <label class="sr-only" for="hiSearch">Search items</label>
        <input id="hiSearch" class="hi-search" type="search" placeholder="Search items…" value="${esc(ui.q)}" data-hi="search" autocomplete="off">
        <div class="hi-chips" role="group" aria-label="Filter by kind">
          ${groups.map((g) => `<button type="button" class="hi-filter${ui.group === g.key ? " is-on" : ""}" data-hi="group" data-group="${esc(g.key)}" aria-pressed="${ui.group === g.key}">${esc(g.label)}</button>`).join("")}
        </div>
        <label class="hi-owned"><input type="checkbox" data-hi="owned"${ui.ownedOnly ? " checked" : ""}> Only my unlocks (${ownedCount}/${held.items.length})</label>
      </div>
      <ul class="hi-list" role="list">${listHtml()}</ul>`;
    d.scrollTop = keepScroll;
  }

  async function send(itemId, { move = false } = {}) {
    if (ui.busy) return;
    ui.busy = true;
    render();
    const before = current();
    try {
      const { res, data } = await postJson("/api/held-items/equip", {
        id: userId, requestId: newRequestId(), team, pokeId: s.id, variant: s.variant, itemId, move, expectedRev: getHeld().rev,
      });
      if (data.rev != null || data.teams) onChange(data);
      if (res.status === 409 && data.code === "stale") { toast(data.error, { tone: "error" }); return; }
      if (res.status === 409 && data.code === "item_clause") { ui.confirmMove = itemId; toast(data.error, { tone: "error" }); return; }
      if (!res.ok || !data.success) throw new Error(data.error || `Couldn’t change the item (${res.status}).`);
      const it = itemById(itemId);
      const old = itemById(before);
      const c = data.change ?? {};
      if (!itemId) toast(`${name} isn’t holding anything now.`, { tone: "success" });
      else {
        const extra = c.from ? ` ${nameOf(Number(c.from.split(":")[0]))} no longer holds it on this team.` : old && old.id !== itemId ? ` ${old.name} is free again.` : "";
        toast(`${name} is holding ${it?.name ?? itemId} on your ${LABEL[team]}.${extra}`, { tone: "success" });
      }
      if (data.saveDelayed || data.saved === false) toast(data.notice || "Saved with a delay. Your change is kept and will be written shortly.");
      ui.confirmMove = null;
    } catch (err) {
      if (!err.silent) showActionError(err, "Couldn’t change the item");
    } finally {
      ui.busy = false;
      if (d.open) render();
    }
  }

  d.onclick = (e) => {
    if (e.target === d) return;
    const el = e.target.closest("[data-hi]");
    if (!el || el.disabled) return;
    const act = el.dataset.hi;
    if (act === "close") d.close();
    else if (act === "group") { ui.group = el.dataset.group; render(); }
    else if (act === "equip") send(el.dataset.item);
    else if (act === "askmove") { ui.confirmMove = el.dataset.item; render(); }
    else if (act === "move") send(el.dataset.item, { move: true });
    else if (act === "cancel") { ui.confirmMove = null; render(); }
    else if (act === "remove") send(null);
  };
  d.oninput = (e) => {
    const el = e.target;
    if (el.dataset?.hi === "search") {
      ui.q = el.value;
      renderList();
    }
  };
  d.onchange = (e) => { if (e.target.dataset?.hi === "owned") { ui.ownedOnly = e.target.checked; render(); } };
  render();
  d.showModal();
  d.querySelector("[data-hi='close']")?.focus();
}
