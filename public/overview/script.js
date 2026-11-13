// ==========================================================
// public/overview/script.js — the dashboard home (Overview).
// Read-only: the Showcase team up top (6 pedestals), the Casual and Ranked
// teams, the ranked record (rating, W/L, leaderboard position, streak) and
// the casual one, rewards waiting (claimable achievements, weekly pack) and
// Pokédex completion per live region.
//
// Reads GET /api/user-pokemon (teams, levels, copies, ranked, casual, pokemon),
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

const SHOWCASE_SLOTS = 6;

// One slot's sprite: the Mega form while Mega Evolution is on, else base.
function spriteOf(s, megaOn) {
  const shiny = s.variant === "shiny";
  const mega = s.mega && megaOn;
  return { shiny, mega, src: mega ? `/public/sprites/pokemon/mega/${s.variant}/${s.mega}.gif` : `/public/sprites/pokemon/${shiny ? "shiny" : "normal"}/${s.id}.gif` };
}

// The slot's own copy Level when it names one, else the line's best Level.
function levelOf(s, { levels, copies }) {
  const row = s.uid ? copies.find((r) => r[0] === s.uid) : null;
  return row?.[3] ?? levels[`${s.id}:${s.variant}`] ?? "?";
}

// Showcase team: six pedestals, empty ones dashed. Never fights, so no Lv 50.
function showcase(team, ctx) {
  const list = Array.isArray(team) ? team.slice(0, SHOWCASE_SLOTS) : [];
  const editHref = `${pageHref("/public/teams/")}&team=showcase`;
  const slots = Array.from({ length: SHOWCASE_SLOTS }, (_, i) => {
    const s = list[i];
    if (!s) return `<li class="ov-ped is-empty"><span class="ov-ped-stage" aria-hidden="true"></span><span class="ov-ped-name">Empty</span></li>`;
    const { shiny, mega, src } = spriteOf(s, ctx.megaOn);
    const name = ctx.data[s.id]?.name ?? `#${s.id}`;
    return `<li class="ov-ped${shiny ? " shiny" : ""}${mega ? " mega" : ""}" ${shiny ? `data-fx="shiny" data-fx-seed="${s.id}"` : ""}>
      ${mega ? `<span class="ov-mega">Mega</span>` : ""}
      <span class="ov-ped-stage"><img src="${src}" alt="${esc(name)}${shiny ? " (shiny)" : ""}" onerror="this.onerror=null;this.src='/public/sprites/items/pokeball.png'"></span>
      <span class="ov-ped-name">${esc(name)}</span>
      <small>Lv ${esc(levelOf(s, ctx))}</small>
    </li>`;
  }).join("");
  return `<section class="ov-card ov-showcase" aria-labelledby="ovShowcase">
    <h2 class="ov-teamhead" id="ovShowcase">Showcase team <a href="${editHref}">Edit</a></h2>
    ${list.length ? `<p class="ov-note">Your favorites. Shown on /showcase and your trainer card.</p>` : `<p class="ov-note">No favorites picked yet. <a href="${editHref}">Pick your Showcase team</a></p>`}
    <ul class="ov-peds">${slots}</ul>
  </section>`;
}

function strip(team, { ranked, ...ctx }) {
  if (!team?.length) {
    return `<p class="ov-empty">${ranked ? "No Ranked team yet. Ranked and wager battles need one." : "No Casual team yet."} <a href="${pageHref("/public/teams/")}&team=${ranked ? "battle" : "display"}">Set it up</a></p>`;
  }
  return `<ul class="ov-strip">${team.map((s, i) => {
    const { shiny, mega, src } = spriteOf(s, ctx.megaOn);
    const name = ctx.data[s.id]?.name ?? `#${s.id}`;
    return `<li class="${i === 0 ? "lead" : ""}${shiny ? " shiny" : ""}" ${shiny ? `data-fx="shiny" data-fx-seed="${s.id}"` : ""}>
      ${mega ? `<span class="ov-mega">Mega</span>` : ""}
      <img src="${src}" alt="${esc(name)}${shiny ? " (shiny)" : ""}" onerror="this.onerror=null;this.src='/public/sprites/items/pokeball.png'">
      <small class="${ranked ? "b" : ""}">${ranked ? `Lv 50` : `Lv ${levelOf(s, ctx)}`}</small>
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
  const ctx = { data, levels: up.levels ?? {}, copies: Array.isArray(up.copies) ? up.copies : [], megaOn };

  app.innerHTML = `<div class="ov-grid">
    ${showcase(up.showcaseTeam, ctx)}
    <section class="ov-card ov-rank" aria-labelledby="ovRanked">
      <h2 id="ovRanked">Ranked</h2>
      <div class="ov-rating"><span class="ov-big">${fmt(r.rating)}</span>${r.position ? `<span class="ov-pos">#${r.position} <small>of ${fmt(r.players)}</small></span>` : `<span class="ov-pos"><small>Not ranked yet</small></span>`}</div>
      <dl class="ov-kv"><div><dt>Record</dt><dd>${r.wins}W–${r.losses}L</dd></div><div><dt>Win rate</dt><dd>${pct(r.wins, r.losses)}%</dd></div><div><dt>Streak</dt><dd class="good">${r.streak ? `W${r.streak}` : "—"}</dd></div></dl>
      <div class="ov-wl${r.wins + r.losses ? "" : " is-empty"}" role="img" aria-label="${r.wins} wins, ${r.losses} losses"><i style="width:${pct(r.wins, r.losses)}%"></i></div>
      <p class="ov-note">${r.wins + r.losses ? "This season’s ranked and wager battles." : "Play a ranked battle in Discord: /battle ranked:True"}</p>
    </section>
    <section class="ov-card ov-casual" aria-labelledby="ovCasual">
      <h2 id="ovCasual">Casual</h2>
      <p class="ov-note">Casual battles · unrated</p>
      <dl class="ov-kv"><div><dt>Record</dt><dd>${c.wins}W–${c.losses}L</dd></div><div><dt>Best streak</dt><dd>${c.bestStreak ? `W${c.bestStreak}` : "—"}</dd></div></dl>
    </section>
    <section class="ov-card ov-rewards" aria-labelledby="ovRewards">
      <h2 id="ovRewards">Rewards waiting</h2>
      <div class="ov-reward"><img src="/public/sprites/items/rank_badge.png" alt=""><p>${claimable ? `${claimable} achievement${claimable > 1 ? "s" : ""} to claim` : "No achievements to claim"}<small>Achievements page</small></p><a class="cc-btn${claimable ? " cc-btn--gold" : ""}" href="${pageHref("/public/achievements/")}">${claimable ? "Claim" : "View"}</a></div>
      <div class="ov-reward"><img src="/public/sprites/items/starter_pack.png" alt=""><p>${weeklyReady ? "Weekly pack ready" : "Weekly pack claimed"}<small>Resets in ${esc(resetIn)}</small></p><a class="cc-btn" href="${pageHref("/public/dashboardshop/")}">${weeklyReady ? "Open" : "Shop"}</a></div>
    </section>
    <section class="ov-card ov-teams" aria-label="Casual and Ranked teams">
      <h2 class="ov-teamhead">Casual team <a href="${pageHref("/public/teams/")}&team=display">Edit</a></h2>${strip(up.currentTeam, { ...ctx, ranked: false })}
      <h2 class="ov-teamhead">Ranked team <span class="ov-lv50">Lv 50</span> <a href="${pageHref("/public/teams/")}&team=battle">Edit</a></h2>${strip(up.battleTeam, { ...ctx, ranked: true })}
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
