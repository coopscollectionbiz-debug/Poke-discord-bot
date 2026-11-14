// ==========================================================
// public/pokedex/script.js: the Pokédex page (docs/adr/0001).
// Every species, by region: caught (✓, and ✨ if a shiny was ever caught)
// or not yet (silhouette). Read-only. Reads GET /api/user-pokemon
// (pokedex, pokemon), /public/pokemonData.json and /api/pokedex-status.
// ==========================================================

import { playerId, pageHref, showBanner, showExpired } from "/public/shared/shell.js";
import { displaySpeciesName } from "/public/shared/names.js";
import { getRegions, countRegistered } from "/public/picker-pokemon/regions.js";
import { viewState, debounce } from "/public/shared/viewState.js";

const app = document.getElementById("dxApp");
const id = playerId();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");

const state = { show: "all", region: "", search: "", shinyView: new Set() };
// Show, region and search survive a trip to another page (this browser tab only).
const view = viewState("pokedex", { show: "all", region: "", search: "" });
const remember = () => view.set({ show: state.show, region: state.region }); // search is saved as typed, on input
let data = {}, regions = [], dex = {}, owned = {};

async function getJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 403) { const e = new Error("expired"); e.expired = true; throw e; }
  if (!res.ok) throw new Error(`Couldn't load the Pokédex (${res.status}).`);
  return res.json();
}

const mask = (sid) => Number(dex[sid]) & 3;
const inBox = (sid) => (Number(owned[sid]?.normal) || 0) + (Number(owned[sid]?.shiny) || 0);

function summary() {
  const all = regions.flatMap((r) => r.ids);
  const caught = all.filter((s) => mask(s)).length;
  const shiny = all.filter((s) => mask(s) & 2).length;
  const bar = (n, d) => `<div class="dx-bar" role="img" aria-label="${n} of ${d}"><i style="width:${d ? Math.round((100 * n) / d) : 0}%"></i></div>`;
  document.getElementById("dxSummary").innerHTML = `
    <div class="dx-stat"><dt>Caught</dt><dd>${fmt(caught)} <small>/ ${fmt(all.length)}</small></dd>${bar(caught, all.length)}</div>
    <div class="dx-stat shiny"><dt>Shiny caught</dt><dd>${fmt(shiny)} <small>/ ${fmt(all.length)}</small></dd>${bar(shiny, all.length)}</div>
    <div class="dx-stat"><dt>In your Collection now</dt><dd>${fmt(all.filter((s) => inBox(s) > 0).length)} <small>species</small></dd><p style="margin:6px 0 0;font-size:13px"><a href="${pageHref("/public/picker-pokemon/")}">Open Collection</a></p></div>`;
}

function regionChips() {
  const chip = (name, label, count) => `<button type="button" class="dx-chip" data-region="${esc(name)}" aria-pressed="${state.region === name}">${esc(label)}${count != null ? ` <small>${count}</small>` : ""}</button>`;
  const host = document.getElementById("dxRegions");
  host.innerHTML = chip("", "All", null) + regions.map((r) => chip(r.name, r.name, `${countRegistered(r, dex)}/${r.ids.length}`)).join("");
}

function entry(sid) {
  const p = data[sid];
  const m = mask(sid);
  const caught = m > 0;
  const hasShiny = (m & 2) !== 0;
  const showShiny = hasShiny && (state.show === "shiny" || state.shinyView.has(sid) || !(m & 1));
  const src = caught ? `/public/sprites/pokemon/${showShiny ? "shiny" : "normal"}/${sid}.gif` : `/public/sprites/pokemon/grayscale/${sid}.gif`;
  const name = caught ? p.name : "???";
  const n = inBox(sid);
  const marks = caught
    ? `<span class="dx-mark caught" title="Caught">✓</span>${hasShiny ? `<span class="dx-mark shiny" title="Shiny caught">✨</span>` : ""}<span class="dx-mark box" title="${n ? `${n} in your Collection` : "None in your Collection now"}">${n ? `×${n}` : "0"}</span>`
    : "";
  const label = `#${sid} ${caught ? p.name : "not caught yet"}${hasShiny ? ", shiny caught" : ""}${caught ? `, ${n} in your Collection` : ""}`;
  return `<li class="dx-entry ${caught ? "caught" : "missing"}${showShiny ? " shiny" : ""}" aria-label="${esc(label)}">
    <span class="dx-no">#${String(sid).padStart(4, "0")}</span>
    ${hasShiny && (m & 1) ? `<button type="button" class="dx-toggle" data-shiny="${sid}" aria-pressed="${showShiny}" aria-label="${showShiny ? "Show normal" : "Show shiny"} ${esc(p.name)}">✨</button>` : ""}
    <img src="${src}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/public/sprites/items/pokeball.png'">
    <span class="dx-name">${esc(name)}</span>
    <span class="dx-marks">${marks}</span>
  </li>`;
}

function matches(sid) {
  const m = mask(sid);
  if (state.show === "caught" && !m) return false;
  if (state.show === "missing" && m) return false;
  if (state.show === "shiny" && !(m & 2)) return false;
  if (!state.search) return true;
  const q = state.search;
  if (/^#?\d+$/.test(q)) return String(sid) === q.replace("#", "");
  // Only caught names are searchable, so a search never spoils a silhouette.
  return m > 0 && String(data[sid].name).toLowerCase().includes(q);
}

function render() {
  summary();
  regionChips();
  const parts = [];
  for (const r of regions) {
    if (state.region && r.name !== state.region) continue;
    const ids = r.ids.filter(matches);
    if (!ids.length) continue;
    parts.push(`<h2 class="dx-region">${esc(r.name)} <small>${countRegistered(r, dex)}/${r.ids.length} caught</small></h2><ul class="dx-grid">${ids.map(entry).join("")}</ul>`);
  }
  app.innerHTML = parts.join("") || `<p class="dx-empty">No Pokémon match.</p>`;
}

async function load() {
  if (!id) { app.innerHTML = ""; return; }
  let up, live;
  try {
    [up, data, live] = await Promise.all([
      getJSON(`/api/user-pokemon?id=${encodeURIComponent(id)}`),
      fetch("/public/pokemonData.json", { credentials: "same-origin" }).then((r) => r.json()),
      fetch("/api/pokedex-status", { credentials: "same-origin" }).then((r) => r.json()).catch(() => ({ liveGenerations: [1, 2, 3, 4, 5] })),
    ]);
  } catch (err) {
    app.innerHTML = "";
    if (err.expired) return showExpired();
    return showBanner(err.message, { title: "Couldn't load the Pokédex" });
  }
  dex = up.pokedex ?? {};
  owned = up.pokemon ?? {};
  const liveGens = new Set((live?.liveGenerations ?? [1, 2, 3, 4, 5]).map(Number));
  // Released generations, plus anything already caught (admin test grants).
  const shown = {};
  for (const [k, p] of Object.entries(data)) {
    if (!/^\d+$/.test(k)) continue;
    p.name = displaySpeciesName(k, p.name);
    if (liveGens.has(Number(p.generation ?? 1)) || mask(k)) shown[k] = p;
  }
  data = shown;
  regions = getRegions(data);
  const kept = view.get();
  if (["all", "caught", "missing", "shiny"].includes(kept.show)) state.show = kept.show;
  if (regions.some((r) => r.name === kept.region)) state.region = kept.region;
  state.search = kept.search.trim().toLowerCase();
  document.getElementById("dxSearch").value = kept.search;
  for (const x of document.querySelectorAll("[data-show]")) x.setAttribute("aria-pressed", String(x.dataset.show === state.show));
  render();
  view.trackScroll();
  view.restoreScroll();
}

document.querySelector(".dx-seg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-show]");
  if (!b) return;
  state.show = b.dataset.show;
  remember();
  for (const x of document.querySelectorAll("[data-show]")) x.setAttribute("aria-pressed", String(x === b));
  render();
});
document.getElementById("dxRegions").addEventListener("click", (e) => {
  const b = e.target.closest("[data-region]");
  if (!b) return;
  state.region = b.dataset.region;
  remember();
  render();
});
const renderSoon = debounce(render, 120);
document.getElementById("dxSearch").addEventListener("input", (e) => {
  state.search = e.target.value.trim().toLowerCase();
  view.set({ search: e.target.value });
  renderSoon();
});
app.addEventListener("click", (e) => {
  const b = e.target.closest("[data-shiny]");
  if (!b) return;
  const sid = Number(b.dataset.shiny);
  if (state.shinyView.has(sid)) state.shinyView.delete(sid); else state.shinyView.add(sid);
  render();
});

load();
