// ======================================================================
// Shop · Technical Machines (TM system phase T3)
//
// GET  /api/tm-shop?id=…      catalog, prices, owned counts, "teaches N"
//      (not /api/tms: blockers' EasyPrivacy list blocks "/tms?id=")
// POST /api/shop/buy-tm       { id, item, qty, requestId }
//
// Everything shown comes from the server (prices, compatibility, owned
// counts); the client only filters the list. The section stays hidden while
// the shop is switched off (TM_ENABLED). One request id per confirmation
// dialog, so a double click or retry never charges twice.
// ======================================================================

import { showMessage, isExpired, showExpired } from "/public/shared/shell.js";
import { moveMeta, tmDisc } from "/public/shared/moveMeta.js";

const TYPES = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"];
const TIER_LABEL = { basic: "Basic", standard: "Standard", power: "Power", premium: "Premium", elite: "Elite" };
const state = { userId: null, data: null, filter: { q: "", type: "", tier: "", mine: true } };

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");
const newRequestId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

async function load() {
  state.userId = new URLSearchParams(window.location.search).get("id");
  if (!state.userId) return;
  let res;
  try {
    res = await fetch(`/api/tm-shop?id=${encodeURIComponent(state.userId)}`, { credentials: "same-origin" });
  } catch {
    return; // the main shop script already reports connection problems
  }
  if (res.status === 403) return showExpired();
  if (!res.ok) return;
  state.data = await res.json();
  if (!state.data?.enabled) return;
  mount();
}

function mount() {
  const main = document.getElementById("ccMain");
  if (!main || document.getElementById("tmHeading")) return;
  const section = document.createElement("section");
  section.className = "shop-section tmx";
  section.setAttribute("aria-labelledby", "tmHeading");
  section.innerHTML = `
    <h2 id="tmHeading">Technical Machines</h2>
    <p class="subtitle">Each TM teaches one move to one compatible Pokémon and is used up when taught. Prices depend on how strong the move is.</p>
    <div class="tmx-filters" role="search">
      <label class="tmx-field tmx-search"><span class="sr-only">Search moves</span>
        <input type="search" id="tmxQ" placeholder="Search moves" autocomplete="off" /></label>
      <label class="tmx-field"><span class="sr-only">Type</span>
        <select id="tmxType"><option value="">All types</option>${TYPES.map((t) => `<option>${t}</option>`).join("")}</select></label>
      <label class="tmx-field"><span class="sr-only">Price tier</span>
        <select id="tmxTier"><option value="">All prices</option>${Object.entries(TIER_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label class="tmx-check"><input type="checkbox" id="tmxMine" checked /> Only TMs my Pokémon can learn</label>
    </div>
    <p class="tmx-count" id="tmxCount" aria-live="polite"></p>
    <div class="shop-grid tmx-grid" id="tmxGrid"></div>`;
  const weekly = main.querySelector('[aria-labelledby="weeklyHeading"]');
  main.insertBefore(section, weekly ?? null);

  section.querySelector("#tmxQ").addEventListener("input", (e) => { state.filter.q = e.target.value.trim().toLowerCase(); render(); });
  section.querySelector("#tmxType").addEventListener("change", (e) => { state.filter.type = e.target.value; render(); });
  section.querySelector("#tmxTier").addEventListener("change", (e) => { state.filter.tier = e.target.value; render(); });
  section.querySelector("#tmxMine").addEventListener("change", (e) => { state.filter.mine = e.target.checked; render(); });
  section.querySelector("#tmxGrid").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tm]");
    if (btn) confirmBuy(btn.dataset.tm);
  });
  render();
}

function visible() {
  const { q, type, tier, mine } = state.filter;
  return state.data.tms
    .filter((t) => (!q || t.name.toLowerCase().includes(q)) && (!type || t.type === type) && (!tier || t.tier === tier) && (!mine || t.teaches > 0))
    .sort((a, b) => b.teaches - a.teaches || a.price - b.price || a.name.localeCompare(b.name));
}

function card(t) {
  const affordable = (state.data.cc ?? 0) >= t.price;
  return `<div class="shop-item tmx-item" data-tier="${esc(t.tier)}">
    <div class="tmx-top">${tmDisc(t.type, { size: 60 })}<span class="tmx-tier">${esc(TIER_LABEL[t.tier] ?? t.tier)}</span></div>
    <h3>${esc(t.name)}</h3>
    <p class="desc">${moveMeta(t)}</p>
    <p class="tmx-meta">${t.teaches > 0 ? `${fmt(t.teaches)} of your Pokémon can learn it` : "None of your Pokémon can learn it"}${t.owned ? ` · <b>You have ${fmt(t.owned)}</b>` : ""}</p>
    <p class="price">${fmt(t.price)} CC</p>
    <button type="button" class="buy-btn" data-tm="${esc(t.item)}"${affordable ? "" : " disabled"} aria-label="Buy ${esc(t.name)} for ${fmt(t.price)} CC">${affordable ? "Buy" : "Not enough CC"}</button>
  </div>`;
}

function render() {
  const grid = document.getElementById("tmxGrid");
  if (!grid) return;
  const list = visible();
  document.getElementById("tmxCount").textContent = `${list.length} of ${state.data.tms.length} TMs`;
  grid.innerHTML = list.length ? list.map(card).join("") : `<p class="tmx-empty">No TMs match these filters.</p>`;
}

const TEAM_LABEL = { casual: "Casual", ranked: "Ranked", showcase: "Showcase" };

function learnerRow(p) {
  const chips = p.teams.map((tm) => `<span class="tmx-lr-team" data-team="${esc(tm)}">${esc(TEAM_LABEL[tm] ?? tm)}</span>`).join("");
  return `<li class="tmx-lr-row${p.known ? " is-known" : ""}">
    <img src="/public/sprites/pokemon/${p.variant === "shiny" ? "shiny" : "normal"}/${Number(p.speciesId)}.gif" alt="" loading="lazy" width="40" height="40">
    <span class="tmx-lr-name">${esc(p.name)}${p.variant === "shiny" ? " ✨" : ""} <small>Lv ${Number(p.level)}</small></span>
    <span class="tmx-lr-tags">${chips}${p.known ? `<small>Already knows it</small>` : ""}</span>
  </li>`;
}

// Casual and Ranked team members first (the server sorts), then the rest
// under their own heading.
async function loadLearners(item, list) {
  if (!list) return;
  try {
    const res = await fetch(`/api/tm-shop/learners?id=${encodeURIComponent(state.userId)}&item=${encodeURIComponent(item)}`, { credentials: "same-origin" });
    if (res.status === 403) return showExpired();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { learners = [] } = await res.json();
    if (!list.isConnected) return;
    const title = list.closest(".tmx-lr")?.querySelector("h3");
    if (title && learners.length) title.textContent = `${fmt(learners.length)} of your Pokémon can learn it`; // a shiny counts as its own row
    const top = learners.filter((p) => p.priority);
    const rest = learners.filter((p) => !p.priority);
    list.innerHTML = learners.length
      ? [
          top.length ? `<li class="tmx-lr-head">On your teams</li>${top.map(learnerRow).join("")}` : "",
          rest.length ? `${top.length ? `<li class="tmx-lr-head">Other Pokémon</li>` : ""}${rest.map(learnerRow).join("")}` : "",
        ].join("")
      : `<li class="tmx-lr-note">None of your Pokémon can learn it yet.</li>`;
  } catch {
    if (list.isConnected) list.innerHTML = `<li class="tmx-lr-note">Couldn't load your Pokémon. Close this and try again.</li>`;
  }
}

function confirmBuy(itemId) {
  if (isExpired()) return;
  const t = state.data.tms.find((x) => x.item === itemId);
  if (!t) return;
  const requestId = newRequestId(); // one per dialog
  const max = Math.max(1, Math.min(state.data.maxPerPurchase ?? 10, Math.floor((state.data.cc ?? 0) / t.price) || 1, state.data.weekly?.remaining ?? Infinity));
  const overlay = document.createElement("div");
  overlay.id = "shopModalOverlay";
  overlay.innerHTML = `<div id="shopModal" role="dialog" aria-modal="true" aria-labelledby="tmxDlgTitle">
    <h2 id="tmxDlgTitle">Buy ${esc(t.name)}?</h2>
    <p>${esc(t.description)}</p>
    <section class="tmx-lr" aria-labelledby="tmxLrTitle">
      <h3 id="tmxLrTitle">${t.teaches > 0 ? `${fmt(t.teaches)} of your Pokémon can learn it` : "None of your Pokémon can learn it yet"}</h3>
      ${t.teaches > 0 ? `<ul class="tmx-lr-list" id="tmxLearners"><li class="tmx-lr-note">Loading your Pokémon…</li></ul>` : ""}
    </section>
    <label class="tmx-qty">Quantity <input type="number" id="tmxQty" min="1" max="${max}" value="1" inputmode="numeric" /></label>
    <p class="tmx-total" id="tmxTotal">${fmt(t.price)} CC</p>
    <div class="modal-buttons">
      <button type="button" class="modal-btn cancel">Cancel</button>
      <button type="button" class="modal-btn confirm">Buy</button>
    </div></div>`;
  document.body.appendChild(overlay);
  if (t.teaches > 0) loadLearners(t.item, overlay.querySelector("#tmxLearners"));
  const qtyEl = overlay.querySelector("#tmxQty");
  const totalEl = overlay.querySelector("#tmxTotal");
  const confirm = overlay.querySelector(".confirm");
  const cancel = overlay.querySelector(".cancel");
  const qty = () => Math.max(1, Math.min(max, Math.floor(Number(qtyEl.value) || 1)));
  qtyEl.addEventListener("input", () => { totalEl.textContent = `${fmt(qty() * t.price)} CC`; });
  const close = () => overlay.remove();
  cancel.onclick = close;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  confirm.focus();
  confirm.onclick = async () => {
    confirm.disabled = cancel.disabled = true;
    confirm.textContent = "Buying…";
    try {
      const res = await fetch("/api/shop/buy-tm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: state.userId, item: t.item, qty: qty(), requestId }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && /session/i.test(body.error ?? "")) { close(); return showExpired(); }
      if (!res.ok || !body.success) throw Object.assign(new Error(body.error || "Purchase failed."), { server: true });
      close();
      state.data.cc = body.cc;
      t.owned = body.quantity;
      if (state.data.weekly) state.data.weekly = { ...state.data.weekly, ...body.weekly };
      document.dispatchEvent(new CustomEvent("cc:changed", { detail: { cc: body.cc } }));
      render();
      showMessage({ title: "TM bought", message: `${body.qty > 1 ? `${body.qty} × ` : ""}${body.name} added to your bag (${fmt(body.cost)} CC).${body.saveNotice ? ` ${body.saveNotice}` : ""}`, tone: "success" });
    } catch (err) {
      close();
      showMessage({ title: "Couldn't buy the TM", message: err.server ? err.message : "Couldn't reach the server. Check your CC before trying again.", tone: "error" });
    }
  };
}

window.addEventListener("DOMContentLoaded", load);
