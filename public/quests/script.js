// ==========================================================
// public/quests/script.js: the Daily board (Quests, Phase 1).
// Data: GET /api/quests. Claims: POST /api/quests/claim (requestId-guarded).
// All text is inserted with textContent, never as HTML.
// ==========================================================

import { showExpired, toast } from "/public/shared/shell.js";

const userId = new URLSearchParams(window.location.search).get("id");
const $ = (id) => document.getElementById(id);
let board = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const newRequestId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

function bar(value, target, label) {
  const pct = Math.min(100, Math.round((100 * value) / Math.max(1, target)));
  const wrap = el("div", "quest-bar");
  wrap.setAttribute("role", "progressbar");
  wrap.setAttribute("aria-valuemin", "0");
  wrap.setAttribute("aria-valuemax", String(target));
  wrap.setAttribute("aria-valuenow", String(Math.min(value, target)));
  wrap.setAttribute("aria-label", label);
  const fill = el("span");
  fill.style.width = `${pct}%`;
  wrap.append(fill);
  return wrap;
}

function resetText(at) {
  const mins = Math.max(0, Math.round((at - Date.now()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return `New tasks in ${h ? `${h} h ` : ""}${m} min (00:00 UTC)`;
}

function render() {
  if (!board) return;
  $("questReset").textContent = resetText(board.resetsAt);
  const done = board.tasks.filter((t) => t.claimed).length;
  $("questStatus").textContent = `${done} of ${board.tasks.length} claimed today`;

  const grid = $("questTasks");
  grid.replaceChildren();
  for (const t of board.tasks) {
    const card = el("article", `shop-item quest-card${t.claimed ? " claimed" : t.done ? " done" : ""}`);
    card.append(el("h3", null, `${t.claimed ? "✅" : t.done ? "🎉" : "📋"} ${t.label}`));
    card.append(el("p", "desc", t.hint));
    card.append(bar(t.progress, t.target, `${t.label}: ${t.progress} of ${t.target}`));
    card.append(el("p", "usage", `${t.progress} / ${t.target} · ${t.cc} CC`));
    if (t.done && !t.claimed) {
      const b = el("button", "buy-btn quest-claim", `Claim ${t.cc} CC`);
      b.onclick = () => claim(`task:${t.id}`, b);
      card.append(b);
    }
    grid.append(card);
  }

  const chest = $("questChest");
  chest.replaceChildren(el("h3", null, board.chest.claimed ? "🎁 Chest opened" : "🎁 Daily chest"), el("p", "desc", `All three claimed: ${board.chest.reward}.`));
  if (board.chest.ready) {
    const b = el("button", "buy-btn quest-claim", "Open the chest");
    b.onclick = () => claim("chest", b);
    chest.append(b);
  } else if (!board.chest.claimed) {
    chest.append(el("p", "usage", `${done} / ${board.tasks.length} tasks claimed`));
  }

  const w = board.week;
  const week = $("questWeek");
  week.replaceChildren(el("h3", null, w.claimed ? "🏆 Weekly bonus claimed" : "🏆 Weekly bonus"), el("p", "desc", `Claim ${w.need} of ${w.of} tasks this week: ${w.reward}.`));
  week.append(bar(w.done, w.need, `Weekly bonus: ${w.done} of ${w.need}`), el("p", "usage", `${Math.min(w.done, w.need)} / ${w.need} this week`));
  if (w.ready) {
    const b = el("button", "buy-btn quest-claim", "Throw the Great Ball");
    b.onclick = () => claim("weekly", b);
    week.append(b);
  }
}

async function claim(what, button) {
  button.disabled = true;
  let res, body;
  try {
    res = await fetch("/api/quests/claim", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, what, requestId: newRequestId() }),
    });
    body = await res.json().catch(() => ({}));
  } catch {
    button.disabled = false;
    $("questStatus").textContent = "Network error. Please try again.";
    return;
  }
  if (!res.ok || !body.success) {
    button.disabled = false;
    if (res.status === 403 && body.error !== "Quests aren't open yet.") showExpired();
    $("questStatus").textContent = body.error || "Could not claim this.";
    return;
  }
  board = body.board;
  render();
  const p = body.pokemon;
  const msg = p ? `${p.shiny ? "✨ Shiny " : ""}${p.name} joined your Collection!` : `+${body.cc} CC`;
  toast(body.saveNotice ? `${msg} ${body.saveNotice}` : msg, { tone: "success" });
}

async function load() {
  let res;
  try {
    res = await fetch(`/api/quests?id=${encodeURIComponent(userId)}`, { credentials: "same-origin" });
  } catch {
    $("questStatus").textContent = "Network error. Please try again.";
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    if (res.status === 403) showExpired();
    $("questStatus").textContent = res.status === 403 ? "" : body.error || "Could not load Quests.";
    return;
  }
  if (!body.enabled) {
    $("questStatus").textContent = "Quests aren't open yet.";
    return;
  }
  board = body;
  render();
}

if (!userId) {
  $("questStatus").textContent = ""; // the shared shell shows the missing-link banner
} else {
  load();
  setInterval(() => { if (board) $("questReset").textContent = resetText(board.resetsAt); }, 60_000);
}
