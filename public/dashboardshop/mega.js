// ======================================================================
// Shop page — Mega Shards and Mega Stones.
//
//   GET  /api/mega/shop?id=…              { enabled:false } while the Mega
//                                          rewards switch is off: this
//                                          section stays hidden and empty
//   POST /api/mega/shop/buy-shards        { id, quantity, requestId }
//   POST /api/mega/shop/buy-stone         { id, stoneId, requestId }
//
// The server decides everything (prices, balance, which stones are sold:
// only stones whose Mega can battle). This file only shows its answers.
// ======================================================================

import { confirmDialog, showMessage, showActionError, showExpired, isExpired, toast } from "/public/shared/shell.js";

const reqId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmt = (n) => Number(n || 0).toLocaleString("en-US");

let state = null;
let userId = null;
let busy = false;

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { credentials: "same-origin" });
  if (res.status === 403 && !body) { showExpired(); return null; }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 403 && /session/i.test(data?.error || "")) { showExpired(); return null; }
  return { ok: res.ok && data?.success, data: data ?? {} };
}

async function load() {
  const r = await api(`/api/mega/shop?id=${encodeURIComponent(userId)}`);
  if (!r?.ok || !r.data.enabled) return hide();
  state = r.data;
  render();
}

function hide() {
  for (const id of ["megaShop", "megaShardStat"]) {
    const n = document.getElementById(id);
    if (n) n.hidden = true;
  }
}

function setCc(cc) {
  state.cc = cc;
  const n = document.getElementById("ccCount");
  if (n) n.textContent = fmt(cc);
}

function render() {
  const section = document.getElementById("megaShop");
  const stat = document.getElementById("megaShardStat");
  if (!section || !state) return;
  section.hidden = false;
  if (stat) { stat.hidden = false; stat.querySelector("#shardCount").textContent = fmt(state.shards); }

  // --- Shard packs (CC), limited per week ---
  const weekly = section.querySelector("#megaWeekly");
  weekly.textContent = state.weeklyRemaining > 0
    ? `You can buy ${state.weeklyRemaining} more with CC this week (limit ${state.weeklyLimit}, resets Monday 00:00 UTC). Shards from /daily and battles don't count.`
    : `You've bought this week's ${state.weeklyLimit} shards with CC. The limit resets Monday 00:00 UTC. Shards from /daily and battles don't count.`;
  const packs = section.querySelector("#megaShardPacks");
  packs.replaceChildren(...state.shardPacks.map((qty) => {
    const cost = qty * state.ccPerShard;
    const overLimit = qty > state.weeklyRemaining;
    const card = el("div", "shop-item mega-item");
    card.append(
      el("div", "mega-shard-icon", "💠"),
      el("h3", null, `${qty} Mega Shard${qty === 1 ? "" : "s"}`),
      el("p", "desc", qty === 1 ? "One shard." : `${qty} shards in one go.`),
      el("p", "price", `${fmt(cost)} CC`),
    );
    const b = el("button", "buy-btn", "Buy");
    b.type = "button";
    b.disabled = state.cc < cost || overLimit;
    if (overLimit) b.textContent = "Weekly limit";
    b.setAttribute("aria-label", `Buy ${qty} Mega Shard${qty === 1 ? "" : "s"} for ${fmt(cost)} CC`);
    b.addEventListener("click", () => buyShards(qty, cost));
    card.append(b);
    return card;
  }));

  // --- Stones (shards) ---
  const grid = section.querySelector("#megaStones");
  const empty = section.querySelector("#megaStonesEmpty");
  empty.hidden = state.stones.length > 0;
  grid.replaceChildren(...state.stones.map((s) => {
    const card = el("div", `shop-item mega-item${s.special ? " is-special" : ""}`);
    const img = el("img", "item-icon mega-form-sprite");
    img.src = s.forms[0]?.sprite ?? "";
    img.alt = "";
    img.loading = "lazy";
    card.append(img, el("h3", null, s.name));
    card.append(el("p", "desc", `Unlocks ${s.forms.map((f) => f.name).join(" / ")} for one of your ${s.baseSpecies}.`));
    if (s.special) card.append(el("p", "mega-tag", "Legendary"));
    card.append(el("p", "price", `${fmt(s.price)} Mega Shards`));
    if (s.owned > 0) card.append(el("p", "mega-owned", `In your bag: ${fmt(s.owned)}`));
    const b = el("button", "buy-btn", "Buy");
    b.type = "button";
    b.disabled = state.shards < s.price;
    b.setAttribute("aria-label", `Buy ${s.name} for ${s.price} Mega Shards`);
    b.addEventListener("click", () => buyStone(s));
    card.append(b);
    return card;
  }));
}

async function run(path, body, onDone) {
  if (busy || isExpired()) return;
  busy = true;
  try {
    const r = await api(path, { id: userId, requestId: reqId(), ...body });
    if (!r) return;
    if (!r.ok) {
      await showMessage({ title: "Couldn't complete the purchase", message: r.data.error || "Please try again.", tone: "error" });
      return load();
    }
    onDone(r.data);
    render();
  } catch (err) {
    showActionError(err, "Couldn't reach the server");
  } finally {
    busy = false;
  }
}

async function buyShards(qty, cost) {
  const ok = await confirmDialog({ title: "Buy Mega Shards?", message: `${qty} Mega Shard${qty === 1 ? "" : "s"} for ${fmt(cost)} CC.`, okText: "Buy" });
  if (!ok) return;
  await run("/api/mega/shop/buy-shards", { quantity: qty }, (d) => {
    state.shards = d.shards;
    state.weeklyBought = d.weeklyBought;
    state.weeklyRemaining = d.weeklyRemaining;
    setCc(d.cc);
    toast(`Bought ${d.bought} Mega Shard${d.bought === 1 ? "" : "s"}.`);
  });
}

async function buyStone(s) {
  const ok = await confirmDialog({ title: `Buy ${s.name}?`, message: `${s.price} Mega Shards. Use it from the Mega section of your Collection to unlock ${s.forms.map((f) => f.name).join(" / ")}.`, okText: "Buy" });
  if (!ok) return;
  await run("/api/mega/shop/buy-stone", { stoneId: s.id }, (d) => {
    state.shards = d.shards;
    const row = state.stones.find((x) => x.id === d.stoneId);
    if (row) row.owned = d.stones;
    toast(`${d.name} added to your bag.`);
  });
}

export function initMegaShop(id) {
  userId = id;
  if (!userId) return hide();
  load().catch(hide);
}

initMegaShop(new URLSearchParams(window.location.search).get("id"));
