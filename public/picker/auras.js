// ===========================================================
// Coop's Collection — Trainers page, Auras tab
// Lists every Aura (services/auras.js auraView), previews each one behind
// the displayed trainer, and equips or buys. The server is authoritative.
//   Tier Auras preview with the same pixel backdrop as the bot (spriteFx.js);
//   art Auras play their spritesheet (/auras-art/<id>/aura.json) on a canvas,
//   with the bot's own timing, placement and trainer lighting
//   (/public/shared/auraArt.js: one implementation for both).
// ===========================================================

import { showExpired, toast, confirmDialog } from "/public/shared/shell.js";
import { scanFx } from "/public/shared/spriteFx.js";
import { auraFrameAt, sheetFrame, normalizeLight, lightPose, lightStrengthAt, BACK_FEET_FROM_BOTTOM } from "/public/shared/auraArt.js";

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
// an art Aura's spritesheet. Art plays on a 90×105 canvas exactly as the bot's
// cards do: once per 2.4 s loop whatever the sheet's frame count, the trainer's
// feet on the sheet's feet row, lit when the Aura has "light".
function preview(look, trainerFile, art = null) {
  const img = trainerFile ? `<img src="${SPRITES}${esc(trainerFile)}" alt="" loading="lazy" />` : "";
  if (!look) return `<div class="aura-preview">${img}</div>`;
  if (!look.startsWith("art:")) return `<div class="aura-preview" data-fx="trainer" data-fx-tier="${esc(look)}">${img}</div>`;
  const id = look.slice(4), meta = art ?? artMeta.get(id);
  if (!meta) return `<div class="aura-preview">${img}</div>`;
  const sky = Array.isArray(meta.sky) && meta.sky.length > 1 ? meta.sky : null;
  const bands = sky ? `linear-gradient(${skyBands(sky).map((c, i, all) => `${c} ${(i / all.length) * 100}% ${((i + 1) / all.length) * 100}%`).join(", ")})` : "none";
  return `<div class="aura-preview aura-art" style="--sky:${bands}" data-art="${esc(id)}" data-trainer="${esc(trainerFile ?? "")}"><canvas class="aura-canvas" width="90" height="105" aria-hidden="true"></canvas></div>`;
}

// ---------- art previews: one clock for every canvas on the page ----------
const images = new Map();
const loadImage = (src) => {
  if (!images.has(src)) images.set(src, new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; }));
  return images.get(src);
};
const trainers = new Map(); // file -> { canvas, rgba, w, h, soles }
async function trainerPixels(file) {
  if (!file) return null;
  if (!trainers.has(file)) trainers.set(file, loadImage(SPRITES + file).then((img) => {
    if (!img) return null;
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const rgba = x.getImageData(0, 0, c.width, c.height).data;
    let soles = 0; for (let i = 3; i < rgba.length; i += 4) if (rgba[i] >= 8) soles = Math.floor(i / 4 / c.width) + 1;
    return { canvas: c, rgba, w: c.width, h: c.height, soles };
  }));
  return trainers.get(file);
}
let players = [], ticking = false;
async function startArtPreviews(root) {
  const found = [];
  for (const el of root.querySelectorAll("[data-art]")) {
    const meta = artMeta.get(el.dataset.art), cv = el.querySelector("canvas");
    if (!meta || !cv) continue;
    const n = Number.isInteger(meta.frames) && meta.frames > 0 ? meta.frames : 24;
    let light = null;
    try { light = normalizeLight(meta.light); } catch { light = null; } // the bot draws it unlit too
    const [sheet, trainer] = await Promise.all([loadImage(`/auras-art/${encodeURIComponent(el.dataset.art)}/${encodeURIComponent(meta.layers?.back ?? "back.png")}`), trainerPixels(el.dataset.trainer)]);
    if (!sheet) continue;
    const ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
    found.push({ cv, ctx, sheet, n, trainer, light, lit: new Map(), last: -1 });
  }
  players = players.filter((p) => p.cv.isConnected).concat(found);
  if (!ticking && players.length) { ticking = true; requestAnimationFrame(tick); }
}
function litTrainer(p, f) {
  const t = p.trainer, k = p.light ? lightStrengthAt(p.light, f) : 0;
  if (!t || !(k > 0)) return t?.canvas ?? null;
  if (!p.lit.has(k)) {
    const c = document.createElement("canvas"); c.width = t.w; c.height = t.h;
    c.getContext("2d").putImageData(new ImageData(lightPose(t.rgba, t.w, t.h, p.light, k), t.w, t.h), 0, 0);
    p.lit.set(k, c);
  }
  return p.lit.get(k);
}
function drawArt(p, f) {
  const { ctx, cv, sheet, n } = p, fw = Math.floor(sheet.naturalWidth / n), fh = sheet.naturalHeight;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(sheet, sheetFrame(f, n) * fw, 0, fw, fh, Math.round((cv.width - fw) / 2), cv.height - fh, fw, fh);
  const t = p.trainer, img = litTrainer(p, f);
  if (t && img) ctx.drawImage(img, Math.round(cv.width / 2 - t.w / 2), cv.height - BACK_FEET_FROM_BOTTOM - t.soles);
}
function tick() {
  players = players.filter((p) => p.cv.isConnected);
  if (!players.length) { ticking = false; return; }
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const f = still ? 0 : auraFrameAt(performance.now());
  for (const p of players) if (p.last !== f) { drawArt(p, f); p.last = f; }
  requestAnimationFrame(tick);
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
