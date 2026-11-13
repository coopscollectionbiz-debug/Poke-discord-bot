// ===========================================================
// Coop's Collection — Trainers page, Auras tab
// Lists every Aura (services/auras.js auraView), previews each one behind
// the displayed trainer, and equips or buys. The server is authoritative.
//   Tier Auras preview with the same pixel backdrop as the bot (spriteFx.js);
//   art Auras play their spritesheet (/auras-art/<id>/aura.json).
// ===========================================================

import { showExpired, toast, confirmDialog } from "/public/shared/shell.js";
import { scanFx } from "/public/shared/spriteFx.js";

const SPRITES = "/public/sprites/trainers_2/";
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
const artMeta = new Map();

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

async function loadArt(id) {
  if (artMeta.has(id)) return artMeta.get(id);
  const meta = await fetch(`/auras-art/${encodeURIComponent(id)}/aura.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  artMeta.set(id, meta);
  return meta;
}

// ---------- previews ----------
// The trainer over the Aura: a tier backdrop (the bot's own pixel recipe) or
// an art Aura's spritesheet, stepping through its frames on the card loop.
function preview(look, trainerFile, art = null) {
  const img = trainerFile ? `<img src="${SPRITES}${esc(trainerFile)}" alt="" loading="lazy" />` : "";
  if (!look) return `<div class="aura-preview">${img}</div>`;
  if (!look.startsWith("art:")) return `<div class="aura-preview" data-fx="trainer" data-fx-tier="${esc(look)}">${img}</div>`;
  const id = look.slice(4), meta = art ?? artMeta.get(id);
  if (!meta) return `<div class="aura-preview">${img}</div>`;
  const frames = Number.isInteger(meta.frames) && meta.frames > 0 ? meta.frames : 24;
  const sky = Array.isArray(meta.sky) && meta.sky.length > 1 ? meta.sky : null;
  const bands = sky ? `linear-gradient(${skyBands(sky).map((c, i, all) => `${c} ${(i / all.length) * 100}% ${((i + 1) / all.length) * 100}%`).join(", ")})` : "none";
  return `<div class="aura-preview aura-art" style="--sky:${bands};--frames:${frames};--sheet:url('/auras-art/${encodeURIComponent(id)}/${encodeURIComponent(meta.layers?.back ?? "back.png")}')"><span class="aura-sheet"></span>${img}</div>`;
}

// Six solid bands interpolated from the sky stops, as the bot draws it (trainerBackdrop.js drawTierSky).
function skyBands(stops, bands = 6) {
  const rgb = stops.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  return Array.from({ length: bands }, (_, b) => {
    const q = (b / (bands - 1)) * (rgb.length - 1), i = Math.min(rgb.length - 2, Math.floor(q)), f = q - i;
    return `rgb(${[0, 1, 2].map((k) => Math.round(rgb[i][k] + (rgb[i + 1][k] - rgb[i][k]) * f)).join(",")})`;
  });
}

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
