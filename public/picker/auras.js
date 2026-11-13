// ===========================================================
// Coop's Collection — Trainers page, Auras tab
// Lists every Aura (services/auras.js auraView), previews each one behind
// the displayed trainer, and equips or buys. The server is authoritative.
//   Tier Auras preview with the same pixel backdrop as the bot (spriteFx.js);
//   art Auras play their spritesheet (/auras-art/<id>/aura.json) on a canvas,
//   with the bot's own timing, placement and trainer lighting
//   (/public/shared/auraArt.js: one implementation for both; drawn by
//   /public/shared/auraPreview.js, which the Battle page uses too).
// ===========================================================

import { showExpired, toast, confirmDialog } from "/public/shared/shell.js";
import { scanFx } from "/public/shared/spriteFx.js";
import { auraPreview, loadAuraArt, startAuraPreviews } from "/public/shared/auraPreview.js";

const GROUPS = [
  ["tier", "Tier Auras", "Unlocked for good by owning a trainer of that tier."],
  ["gym", "Gym Leaders", "Beat each Gym Leader in /challenge."],
  ["elite4", "Elite Four", "Beat each member in /challenge, even in a run you lose later."],
  ["champion", "Champions", "Beat Blue and Red in /challenge."],
  ["milestone", "Milestones", "Earned with these achievements."],
  ["shop", "Shop", "Buy with CC."],
  ["event", "Events", "Handed out during events, kept for good."],
];

const params = new URLSearchParams(location.search);
const userId = params.get("id");
const panel = document.getElementById("aurasPanel");
let state = null;
let busy = false;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Number(n || 0).toLocaleString("en-US");

async function api(url, body) {
  const res = await fetch(url, body
    ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { credentials: "same-origin" });
  if (res.status === 403) { showExpired(); throw new Error("SESSION_EXPIRED"); }
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// ---------- tabs ----------
function selectTab(name) {
  const auras = name === "auras";
  document.getElementById("tabTrainers").setAttribute("aria-selected", String(!auras));
  document.getElementById("tabAuras").setAttribute("aria-selected", String(auras));
  document.getElementById("trainersPanel").hidden = auras;
  panel.hidden = !auras;
  const url = new URL(location.href);
  if (auras) url.searchParams.set("tab", "auras"); else url.searchParams.delete("tab");
  history.replaceState(null, "", url);
  if (auras && !state) load();
}
document.getElementById("tabTrainers").addEventListener("click", () => selectTab("trainers"));
document.getElementById("tabAuras").addEventListener("click", () => selectTab("auras"));
if (params.get("tab") === "auras") selectTab("auras");

// ---------- data ----------
async function load() {
  if (!userId) { panel.innerHTML = ""; return; }
  try {
    state = await api(`/api/auras?id=${encodeURIComponent(userId)}`);
    await Promise.all(state.auras.filter((a) => a.ready && a.look.startsWith("art:")).map((a) => loadArt(a.id)));
    render();
  } catch (err) {
    if (err.message !== "SESSION_EXPIRED") panel.innerHTML = `<p class="notice cc-empty">Couldn't load Auras: ${esc(err.message)}</p>`;
  }
}

// ---------- previews ----------
// The trainer over the Aura: public/shared/auraPreview.js (shared with the Battle page).
const loadArt = loadAuraArt;
const preview = (look, trainerFile) => auraPreview(look, trainerFile);
const startArtPreviews = startAuraPreviews;

function render() {
  const s = state;
  const owned = s.auras.filter((a) => a.owned).length;
  const equippedLook = s.equipped === "auto" ? s.autoTier : s.equipped === "none" ? null : s.auras.find((a) => a.id === s.equipped)?.look ?? s.autoTier;
  const equippedName = s.equipped === "auto" ? "Auto (your trainer's tier)" : s.equipped === "none" ? "None" : s.auras.find((a) => a.id === s.equipped)?.name ?? "Auto";
  const quick = (id, label, note) => `
    <button type="button" class="aura-quick${s.equipped === id ? " is-on" : ""}" data-equip="${id}" ${s.equipped === id ? "aria-pressed=\"true\"" : "aria-pressed=\"false\""}>
      <strong>${label}</strong><span>${note}</span>
    </button>`;
  panel.innerHTML = `
    <section class="aura-now cc-card">
      ${preview(equippedLook, s.trainer)}
      <div>
        <p class="cc-eyebrow">Equipped</p>
        <h2>${esc(equippedName)}</h2>
        <p class="muted">Shown behind your trainer on your trainer card, ranked card, /challenge, encounters and battles. ${owned} of ${s.auras.length} owned.</p>
        <div class="aura-quicks">${quick("auto", "Auto", "Your trainer's own tier")}${quick("none", "None", "No Aura")}</div>
      </div>
    </section>
    ${GROUPS.map(([kind, title, blurb]) => {
      const list = s.auras.filter((a) => a.kind === kind);
      if (!list.length) return "";
      return `<section class="aura-group"><h2>${title}</h2><p class="muted">${blurb}</p><div class="aura-grid">${list.map(card).join("")}</div></section>`;
    }).join("")}`;
  scanFx(panel);
  startArtPreviews(panel);
}

function card(a) {
  const s = state, on = s.equipped === a.id;
  let action;
  if (on) action = `<span class="aura-state is-on">Equipped</span>`;
  else if (a.owned && a.ready) action = `<button type="button" class="cc-btn cc-btn--primary" data-equip="${esc(a.id)}">Equip</button>`;
  else if (a.owned) action = `<span class="aura-state">Owned · art coming soon</span>`;
  else if (a.kind === "shop") action = `<button type="button" class="cc-btn cc-btn--gold" data-buy="${esc(a.id)}" ${s.cc < a.price ? "disabled" : ""}>Buy · ${fmt(a.price)} CC</button>`;
  else action = `<span class="aura-state">${esc(a.howToEarn)}</span>`;
  const look = a.ready ? a.look : null;
  return `<article class="aura-card${a.owned ? "" : " is-locked"}${on ? " is-on" : ""}">
    ${preview(look, s.trainer)}
    <h3>${esc(a.name)}</h3>
    ${a.owned || a.kind === "shop" ? "" : `<p class="faint">Locked</p>`}
    ${action}
  </article>`;
}

// ---------- actions ----------
panel.addEventListener("click", async (e) => {
  const eq = e.target.closest("[data-equip]"), buy = e.target.closest("[data-buy]");
  if ((!eq && !buy) || busy) return;
  busy = true;
  window.showProcessing?.();
  try {
    if (eq) {
      const r = await api("/api/auras/equip", { id: userId, aura: eq.dataset.equip });
      state.equipped = r.equipped;
      toast("Aura equipped", { tone: "success" });
    } else {
      const a = state.auras.find((x) => x.id === buy.dataset.buy);
      if (!(await confirmDialog({ title: `Buy ${a.name}?`, message: `${fmt(a.price)} CC`, okText: "Buy" }))) return;
      const r = await api("/api/shop/buy-aura", { id: userId, aura: a.id, requestId: crypto.randomUUID?.() ?? null });
      a.owned = true;
      state.cc = r.cc;
      const bar = document.getElementById("ccDisplay");
      if (bar) bar.textContent = `${fmt(r.cc)} CC`;
      toast(`${a.name} unlocked`, { tone: "success" });
    }
    render();
  } catch (err) {
    if (err.message !== "SESSION_EXPIRED") toast(err.message, { tone: "error" });
  } finally {
    busy = false;
    window.hideProcessing?.();
  }
});
