// ==========================================================
// public/overview/script.js — the dashboard home (Overview).
// Read-only: both teams, the ranked record (rating, W/L, leaderboard
// position, streak) and the casual one, rewards waiting (claimable
// achievements, weekly pack) and Pokédex completion per live region.
//
// Reads GET /api/user-pokemon (teams, levels, ranked, casual, pokemon),
//       GET /api/user (name, TP, rank, weekly pack),
//       GET /api/achievements (claimable count),
//       GET /api/mega (Mega sprites only while Mega Evolution is on),
//       /public/pokemonData.json + regions.js for completion.
// ==========================================================

import { playerId, pageHref, showBanner, showExpired } from "/public/shared/shell.js";
import { displaySpeciesName } from "/public/shared/names.js";
import { scanFx } from "/public/shared/spriteFx.js";
import { getRegions, countRegistered } from "/public/picker-pokemon/regions.js";
import { getNextMondayUTC, formatCountdown } from "/public/weeklyReset.js";

const app = document.getElementById("ovApp");
const id = playerId();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");
const pct = (w, l) => (w + l ? Math.round((100 * w) / (w + l)) : 0);

async function getJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 403) { const e = new Error("expired"); e.expired = true; throw e; }
  if (!res.ok) throw new Error(`Couldn’t load the overview (${res.status}).`);
  return res.json();
}

function strip(team, { battle, data, levels, megaOn }) {
  if (!team?.length) {
    return `<p class="ov-empty">${battle ? "No Battle team yet. Ranked and wager battles need one." : "No Display team yet."} <a href="${pageHref("/public/teams/")}${battle ? "&team=battle" : ""}">Set it up</a></p>`;
  }
  return `<ul class="ov-strip">${team.map((s, i) => {
    const shiny = s.variant === "shiny";
    const mega = s.mega && megaOn;
    const src = mega ? `/public/sprites/pokemon/mega/${s.variant}/${s.mega}.gif` : `/public/sprites/pokemon/${shiny ? "shiny" : "normal"}/${s.id}.gif`;
    const name = data[s.id]?.name ?? `#${s.id}`;
    const lv = levels[`${s.id}:${s.variant}`] ?? "?";
    return `<li class="${i === 0 ? "lead" : ""}${shiny ? " shiny" : ""}" ${shiny ? `data-fx="shiny" data-fx-seed="${s.id}"` : ""}>
      ${mega ? `<span class="ov-mega">Mega</span>` : ""}
      <img src="${src}" alt="${esc(name)}${shiny ? " (shiny)" : ""}" onerror="this.onerror=null;this.src='/public/sprites/items/pokeball.png'">
      <small class="${battle ? "b" : ""}">${battle ? `Lv 50` : `Lv ${lv}`}</small>
    </li>`;
  }).join("")}</ul>`;
}

async function load() {
  if (!id) { app.innerHTML = ""; return; }
  let up, user, ach, data, live, megaOn = false;
  try {
    [up, user, ach, data, live] = await Promise.all([
      getJSON(`/api/user-pokemon?id=${encodeURIComponent(id)}`),
      getJSON(`/api/user?id=${encodeURIComponent(id)}`),
      getJSON(`/api/achievements?id=${encodeURIComponent(id)}`).catch(() => null),
      fetch("/public/pokemonData.json", { credentials: "same-origin" }).then((r) => r.json()),
      fetch("/api/pokedex-status", { credentials: "same-origin" }).then((r) => r.json()).catch(() => ({ liveGenerations: [1, 2, 3, 4, 5] })),
    ]);
    try { const m = await getJSON(`/api/mega?id=${encodeURIComponent(id)}`); megaOn = !!m?.enabled; } catch { megaOn = false; }
  } catch (err) {
    app.innerHTML = "";
    if (err.expired) return showExpired();
    return showBanner(err.message, { title: "Couldn’t load the overview" });
  }
  for (const [k, p] of Object.entries(data)) p.name = displaySpeciesName(k, p.name);

  document.getElementById("ovTitle").textContent = `Welcome back${user?.name ? `, ${user.name}` : ""}`;
  document.getElementById("ovSub").textContent = `${user?.rank ?? "Trainer"} · ${fmt(up.tp)} TP · ${fmt(up.cc)} CC`;

  // Pokédex completion: live generations only (Mega forms are never entries).
  const liveSet = new Set(live.liveGenerations ?? [1, 2, 3, 4, 5]);
  const liveData = Object.fromEntries(Object.entries(data).filter(([, p]) => liveSet.has(p.generation)));
  const regions = getRegions(liveData);
  const ownedTotal = regions.reduce((s, r) => s + countRegistered(r, up.pokedex), 0);
  const total = regions.reduce((s, r) => s + r.ids.length, 0);

  const r = up.ranked ?? { rating: 1000, wins: 0, losses: 0 };
  const c = up.casual ?? { wins: 0, losses: 0 };
  const claimable = (ach?.achievements ?? ach?.list ?? []).filter?.((a) => a.claimable).length ?? 0;
  const weeklyReady = user && !user.weeklyPackClaimed;
  const resetIn = formatCountdown(getNextMondayUTC() - Date.now());
  const ctx = { data, levels: up.levels ?? {}, megaOn };

  app.innerHTML = `<div class="ov-grid">
    <section class="ov-card ov-rank" aria-labelledby="ovRanked">
      <h2 id="ovRanked">Ranked</h2>
      <div class="ov-rating"><span class="ov-big">${fmt(r.rating)}</span>${r.position ? `<span class="ov-pos">#${r.position} <small>of ${fmt(r.players)}</small></span>` : `<span class="ov-pos"><small>Not ranked yet</small></span>`}</div>
      <dl class="ov-kv"><div><dt>Record</dt><dd>${r.wins}W–${r.losses}L</dd></div><div><dt>Win rate</dt><dd>${pct(r.wins, r.losses)}%</dd></div><div><dt>Streak</dt><dd class="good">${r.streak ? `W${r.streak}` : "—"}</dd></div></dl>
      <div class="ov-wl${r.wins + r.losses ? "" : " is-empty"}" role="img" aria-label="${r.wins} wins, ${r.losses} losses"><i style="width:${pct(r.wins, r.losses)}%"></i></div>
      <p class="ov-note">${r.wins + r.losses ? "This season’s ranked and wager battles." : "Play a ranked battle in Discord: /battle ranked:True"}</p>
    </section>
    <section class="ov-card ov-casual" aria-labelledby="ovCasual">
      <h2 id="ovCasual">Casual</h2>
      <p class="ov-note">Open battles · unrated</p>
      <dl class="ov-kv"><div><dt>Record</dt><dd>${c.wins}W–${c.losses}L</dd></div><div><dt>Best streak</dt><dd>${c.bestStreak ? `W${c.bestStreak}` : "—"}</dd></div></dl>
    </section>
    <section class="ov-card ov-rewards" aria-labelledby="ovRewards">
      <h2 id="ovRewards">Rewards waiting</h2>
      <div class="ov-reward"><img src="/public/sprites/items/rank_badge.png" alt=""><p>${claimable ? `${claimable} achievement${claimable > 1 ? "s" : ""} to claim` : "No achievements to claim"}<small>Achievements page</small></p><a class="cc-btn${claimable ? " cc-btn--gold" : ""}" href="${pageHref("/public/achievements/")}">${claimable ? "Claim" : "View"}</a></div>
      <div class="ov-reward"><img src="/public/sprites/items/starter_pack.png" alt=""><p>${weeklyReady ? "Weekly pack ready" : "Weekly pack claimed"}<small>Resets in ${esc(resetIn)}</small></p><a class="cc-btn" href="${pageHref("/public/dashboardshop/")}">${weeklyReady ? "Open" : "Shop"}</a></div>
    </section>
    <section class="ov-card ov-teams" aria-label="Teams">
      <h2 class="ov-teamhead">Display team <a href="${pageHref("/public/teams/")}">Edit</a></h2>${strip(up.currentTeam, { ...ctx, battle: false })}
      <h2 class="ov-teamhead">Battle team <span class="ov-lv50">Lv 50</span> <a href="${pageHref("/public/teams/")}&team=battle">Edit</a></h2>${strip(up.battleTeam, { ...ctx, battle: true })}
    </section>
    <section class="ov-card ov-dex" aria-labelledby="ovDex">
      <h2 id="ovDex">Pokédex</h2>
      <p class="ov-note">${ownedTotal} of ${total} owned · Mega forms don’t count as entries</p>
      ${regions.map((g) => { const n = countRegistered(g, up.pokedex); return `<div class="ov-reg"><span>${esc(g.name)}</span><span class="ov-bar" role="img" aria-label="${esc(g.name)}: ${n} of ${g.ids.length}"><i style="width:${Math.round((n / g.ids.length) * 100)}%"></i></span><span>${n}/${g.ids.length}</span></div>`; }).join("")}
      <a class="ov-link" href="${pageHref("/public/picker-pokemon/")}">Open the Collection</a>
    </section>
  </div>`;
  scanFx(app);
}

load();
