// ==========================================================
// public/achievements/script.js — Achievements page (Release C)
// Data: GET /api/achievements (server-computed). Claims: POST
// /api/achievements/claim (same locked once-only service as Discord).
// All text is inserted with textContent, never as HTML.
// ==========================================================

const params = new URLSearchParams(window.location.search);
const userId = params.get("id");
const $ = (id) => document.getElementById(id);
let data = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function nav() {
  if (!userId) return;
  const go = (path) => () => (window.location.href = `${path}?id=${encodeURIComponent(userId)}`);
  $("goPokemon").onclick = go("/public/picker-pokemon/");
  $("goTrainers").onclick = go("/public/picker/");
  $("goShop").onclick = go("/public/dashboardshop/");
  $("goBag").onclick = go("/public/bag/");
  $("goAchievements").onclick = go("/public/achievements/");
}

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function rewardLine(r) {
  if (!r.reward) return null;
  const parts = [];
  if (r.reward.cc) parts.push(`${Number(r.reward.cc).toLocaleString()} CC`);
  for (const [k, v] of Object.entries(r.reward.items || {})) parts.push(`${v}× ${k.replace(/_/g, " ")}`);
  for (const k of ["title", "badge", "cosmetic"]) if (r.reward[k]) parts.push(k);
  let state = "pending approval";
  if (r.claimed) state = "claimed";
  else if (r.reward.status === "available") state = r.unlocked ? "ready to claim" : "available when unlocked";
  return `🎁 ${parts.join(", ")} · ${state}`;
}

function render() {
  const grid = $("achGrid");
  grid.replaceChildren();
  if (!data) return;
  const summary = $("achSummary");
  const pct = (a, b) => (b > 0 ? Math.floor((100 * a) / b) : 0);
  summary.replaceChildren(el("span", "chip", `${data.ap.toLocaleString()} AP`), el("span", "chip", `${data.unlocked}/${data.total} unlocked · ${pct(data.unlocked, data.total)}%`));
  for (const c of data.categories) {
    const chip = el("span", "chip", `${c.emoji} ${c.unlocked}/${c.total}`);
    chip.title = `${c.label}: ${pct(c.unlocked, c.total)}% complete`;
    summary.append(chip);
  }

  const f = $("achFilter").value;
  const list = data.achievements.filter(
    (r) => f === "all" || (f === "unlocked" && r.unlocked) || (f === "locked" && !r.unlocked) || (f === "claimable" && r.claimable)
  );
  $("achStatus").textContent = list.length ? `${list.length} achievement${list.length === 1 ? "" : "s"}` : "Nothing to show here.";

  for (const r of list) {
    const card = el("div", `shop-item bag-item ach-card${r.unlocked ? "" : " locked"}`);
    card.append(el("h3", null, `${r.unlocked ? "✅" : r.hidden ? "❔" : "🔒"} ${r.name}`));
    card.append(el("p", "tier", r.ap == null ? r.tierName : `${r.tierName} · ${r.ap} AP`));
    card.append(el("p", "desc", r.description));
    if (r.progress && !r.unlocked) {
      const wrap = el("div", "ach-bar");
      const fill = el("span");
      fill.style.width = `${Math.round((100 * r.progress.value) / Math.max(1, r.progress.target))}%`;
      wrap.append(fill);
      card.append(wrap, el("p", "usage", `${r.progress.value.toLocaleString()} / ${r.progress.target.toLocaleString()}`));
    }
    const line = rewardLine(r);
    if (line) card.append(el("p", "reward", line));
    if (r.claimable) {
      const b = el("button", "buy-btn claim-btn", "Claim reward");
      b.onclick = () => claim(r.id, b);
      card.append(b);
    }
    grid.append(card);
  }
}

async function claim(achievementId, button) {
  button.disabled = true;
  let res;
  let body;
  try {
    res = await fetch("/api/achievements/claim", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, achievementId, requestId: newRequestId() }),
    });
    body = await res.json().catch(() => ({}));
  } catch {
    button.disabled = false;
    $("achStatus").textContent = "Network error. Please try again.";
    return;
  }
  if (!res.ok || !body.success) {
    button.disabled = false;
    $("achStatus").textContent = body.error || "Could not claim this reward.";
    return;
  }
  await load(false);
  $("achStatus").textContent = body.saveNotice ? `Reward claimed. ${body.saveNotice}` : "Reward claimed!";
}

async function load(resetStatus = true) {
  const category = $("achCategory").value;
  if (resetStatus) $("achStatus").textContent = "Loading…";
  let res;
  try {
    res = await fetch(`/api/achievements?id=${encodeURIComponent(userId)}${category ? `&category=${encodeURIComponent(category)}` : ""}`, { credentials: "same-origin" });
  } catch {
    $("achStatus").textContent = "Network error. Please try again.";
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    $("achStatus").textContent = res.status === 403 ? "Your session expired. Open a new link with /dashboard in Discord." : body.error || "Could not load achievements.";
    return;
  }
  const select = $("achCategory");
  if (select.options.length === 1) {
    for (const c of body.categories || []) {
      const o = el("option", null, `${c.emoji} ${c.label}`);
      o.value = c.key;
      select.append(o);
    }
  }
  data = body;
  render();
}

nav();
if (!userId) {
  $("achStatus").textContent = "Missing player id. Open the dashboard from Discord with /dashboard.";
} else {
  $("achCategory").onchange = () => load();
  $("achFilter").onchange = render;
  load();
}
