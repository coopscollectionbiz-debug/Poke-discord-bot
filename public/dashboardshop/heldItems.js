// ==========================================================
// public/dashboardshop/heldItems.js — the shop's "Held items" section.
//
// Lists every held item. Starter items show "Free", owned ones "Owned",
// the rest a Buy button (POST /api/held-items/buy; the price, ownership and
// CC are checked server-side; a requestId makes a double click buy once).
// Hidden unless GET /api/held-items says the shop is on for this player.
// ==========================================================

import { playerId, pageHref, toast, showActionError, confirmDialog } from "/public/shared/shell.js";
import { itemIcon, buyHeldItem, claimStarter } from "/public/teams/items.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const userId = playerId();
const section = document.getElementById("held-items");
const grid = document.getElementById("heldGrid");
const state = { items: [], cc: 0, busy: false };

function card(it) {
  const action = it.owned
    ? `<p class="price">✓ Owned</p><a class="buy-btn" href="${pageHref("/public/teams")}">Equip on Teams</a>`
    : it.starter
      ? `<p class="price">FREE</p><p class="desc">A free starter item. Open Teams to unlock it.</p>`
      : `<p class="price">${Number(it.price).toLocaleString()} CC</p>
         <button type="button" class="buy-btn" data-buy="${esc(it.id)}"${state.busy || state.cc < it.price ? " disabled" : ""} aria-label="Buy ${esc(it.name)} for ${Number(it.price).toLocaleString()} CC">${state.cc < it.price ? "Not enough CC" : "Buy"}</button>`;
  return `<div class="shop-item">
    ${itemIcon(it, { size: "lg" })}
    <h3>${esc(it.name)}</h3>
    <p class="desc">${esc(it.effect)}</p>
    <p class="desc" style="opacity:.75">${esc(it.groupLabel)} · ${esc(it.rule)}</p>
    ${action}
  </div>`;
}

function render() {
  const order = (it) => (it.owned ? 2 : it.starter ? 1 : 0);
  grid.innerHTML = [...state.items].sort((a, b) => order(a) - order(b) || (a.price ?? 0) - (b.price ?? 0) || a.name.localeCompare(b.name)).map(card).join("");
}

grid.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-buy]");
  if (!btn || btn.disabled || state.busy) return;
  const it = state.items.find((i) => i.id === btn.dataset.buy);
  if (!it) return;
  const ok = await confirmDialog({ title: `Buy ${it.name}?`, message: `${it.effect} One unlock works on every team. ${Number(it.price).toLocaleString()} CC.`, okText: "Buy", cancelText: "Cancel" });
  if (!ok) return;
  state.busy = true;
  render();
  try {
    const r = await buyHeldItem(userId, it.id);
    state.items = r.items ?? state.items;
    state.cc = r.cc;
    const cc = document.getElementById("ccCount");
    if (cc) cc.textContent = Number(r.cc).toLocaleString();
    toast(`${it.name} unlocked! Equip it on the Teams page.`, { tone: "success" });
    if (r.saveDelayed || r.saved === false) toast(r.notice || "Saved with a delay. Your purchase is kept and will be written shortly.");
  } catch (err) {
    if (!err.silent) showActionError(err, "Couldn't buy that item");
  } finally {
    state.busy = false;
    render();
  }
});

async function load() {
  if (!userId || !section) return;
  try {
    const r = await fetch(`/api/held-items?id=${encodeURIComponent(userId)}`, { credentials: "same-origin" });
    const d = r.ok ? await r.json() : null;
    if (!d?.enabled || !d.capabilities?.shop) return;
    state.items = d.items ?? [];
    state.cc = d.cc ?? 0;
    if (d.starterPending) {
      try { const c = await claimStarter(userId); state.items = c.items ?? state.items; } catch { /* Teams page retries */ }
    }
    section.hidden = false;
    render();
    if (location.hash === "#held-items") section.scrollIntoView();
  } catch { /* the section stays hidden */ }
}
load();
