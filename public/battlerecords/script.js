// ==========================================================
// public/battlerecords/script.js — the Battle Records page.
// Reads GET /api/fight-records (lite records: no turn log) once, then
// filters by tab in the page. Expanding a row loads the full record
// (GET /api/fight-records/:id) for damage, turns and the replay.
// #fight=<id> opens that record's replay (replay.js).
// ==========================================================

import { playerId, showBanner, showExpired } from "/public/shared/shell.js";
import { scanFx } from "/public/shared/spriteFx.js";
import {
  perspective, summarize, timeAgo, pokemonSprite, trainerSprite, itemLabel, damageBySlot, replaySteps,
} from "/public/battlerecords/records.js";
import { openReplay, closeReplay } from "/public/battlerecords/replay.js";

const id = playerId();
const listEl = document.getElementById("brList");
const statusEl = document.getElementById("brStatus");
const summaryEl = document.getElementById("brSummary");
const tabs = document.getElementById("brTabs");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");
const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;
const FALLBACK = `onerror="this.onerror=null;this.src='/public/sprites/items/pokeball.png'"`;
const GROUP_EMPTY = {
  "": "No fights yet. Your next battle, Challenge or Trainer encounter will show up here.",
  battles: "No battles yet. Start one in Discord with /battle.",
  challenges: "No Challenges yet. Take one on in Discord with /challenge.",
  encounters: "No Trainer encounters yet. Trainers spot you while you chat.",
};

let records = [];
let group = "";
const full = new Map(); // id -> full record

async function getJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 403) { const e = new Error("expired"); e.expired = true; throw e; }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.error || `Request failed (${res.status}).`); e.status = res.status; throw e; }
  return body;
}

export async function fullRecord(fightId) {
  if (!full.has(fightId)) {
    const body = await getJSON(`/api/fight-records/${encodeURIComponent(fightId)}?id=${encodeURIComponent(id)}`);
    full.set(fightId, body.record);
  }
  return full.get(fightId);
}

const shown = () => (group ? records.filter((r) => r.group === group) : records);

// ---------- Summary ----------
function donut(rate) {
  const c = 2 * Math.PI * 40;
  return `<div class="br-donut" role="img" aria-label="Win rate ${rate}%">
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--cc-red)" stroke-width="14"/>
    <circle cx="50" cy="50" r="40" fill="none" stroke="var(--cc-blue)" stroke-width="14" stroke-dasharray="${(c * rate) / 100} ${c}"/></svg>
    <b>${rate}%</b></div>`;
}

function renderSummary(list) {
  if (!list.length) { summaryEl.hidden = true; summaryEl.innerHTML = ""; return; }
  const s = summarize(list, id);
  const ratingLine = s.rating
    ? `<p class="br-rating">Ranked rating ${fmt(s.rating.current)} <span class="${s.rating.change >= 0 ? "up" : "down"}">${signed(s.rating.change)}</span> <span class="br-muted">over ${s.rating.games} rated</span></p>`
    : "";
  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <div class="br-wl">${donut(s.winRate)}
      <div class="br-wl-text"><p class="br-sum-head">Last ${s.count} fight${s.count === 1 ? "" : "s"}</p>
        <p class="br-big">${s.wins}W ${s.losses}L</p>${ratingLine}</div></div>
    <div><p class="br-sum-head">KOs / faints</p><p class="br-kda">${s.kos} / ${s.faints}</p><p class="br-muted">${s.kda}:1 · ${(s.kos / s.count).toFixed(1)} KOs a fight</p></div>
    <div><p class="br-sum-head">Most used</p><ul class="br-top">${s.top.map((m) => {
      const rate = Math.round((100 * m.wins) / m.games);
      return `<li><span ${m.variant === "shiny" ? `data-fx="shiny" data-fx-seed="${m.speciesId}"` : ""}><img src="${pokemonSprite(m)}" alt="" ${FALLBACK}></span>
        <span class="name">${esc(m.name)}${m.variant === "shiny" ? " ✨" : ""}</span>
        <span><span class="wr${rate >= 60 ? " hot" : ""}">${rate}%</span> <span class="br-muted">(${m.wins}W ${m.games - m.wins}L) · ${m.kos} KO</span></span></li>`;
    }).join("")}</ul></div>`;
}

// ---------- Rows ----------
function monTile(m, { ko = 0, out = false } = {}) {
  const shiny = m.variant === "shiny";
  return `<span class="br-mon${out ? " out" : ""}" ${shiny ? `data-fx="shiny" data-fx-seed="${m.speciesId}"` : ""} title="${esc(m.name)} Lv ${m.level}">
    <img src="${pokemonSprite(m)}" alt="${esc(m.name)}${shiny ? " (shiny)" : ""}" loading="lazy" ${FALLBACK}>${ko ? `<span class="ko" aria-label="${ko} KOs">${ko}</span>` : ""}</span>`;
}

function deltaChip(p) {
  if (!p.delta) return "";
  const up = p.delta.value > 0;
  const text = p.delta.type === "rating" ? `${signed(p.delta.value)}` : `${signed(p.delta.value)} CC`;
  return `<span class="br-delta ${up ? "up" : "down"}" aria-label="${p.delta.type === "rating" ? "Rating" : "Coop Coins"} ${text}">${up ? "▲" : "▼"} ${text}</span>`;
}

function rowHtml(r) {
  const p = perspective(r, id);
  const foeSprites = r.kind === "elite4"
    ? p.foes.map((f) => `<img class="br-trainer" style="width:30px;height:30px" src="${trainerSprite(f.trainer)}" alt="${esc(f.name)}" title="${esc(f.name)}" ${FALLBACK}>`).join("")
    : p.foeTeam.map((m) => monTile(m)).join("");
  return `<li class="br-row ${p.won ? "win" : "loss"}" data-id="${esc(r.id)}">
    <button type="button" class="br-head" aria-expanded="false" aria-controls="b-${esc(r.id)}">
      <span class="br-meta"><span class="br-kind">${esc(p.label)}</span> <span class="br-when"><time datetime="${new Date(r.at).toISOString()}">${timeAgo(r.at)}</time></span>
        <span class="br-result">${p.won ? "Victory" : "Defeat"} ${deltaChip(p)}</span></span>
      <span class="br-mine"><span class="br-sprites">${p.team.map((m, i) => monTile(m, { ko: p.kos[i], out: p.fainted[i] })).join("")}</span>
        <span class="br-line"><b>${p.totalKos}</b> KOs · <b>${p.totalFaints}</b> fainted · ${p.turns} turns${r.fights.length > 1 ? ` · ${r.fights.length} fights` : ""}</span></span>
      <span class="br-foe"><img class="br-trainer" src="${trainerSprite(p.foe?.trainer)}" alt="" ${FALLBACK}>
        <span><span class="who">${esc(p.foe?.name ?? "")}</span><span class="br-sprites">${foeSprites}</span></span></span>
      <span class="br-chev" aria-hidden="true">▾</span>
    </button>
    <div class="br-body" id="b-${esc(r.id)}" hidden></div>
  </li>`;
}

function renderList() {
  const list = shown();
  renderSummary(list);
  statusEl.textContent = list.length ? `${list.length} fight${list.length === 1 ? "" : "s"} · newest first` : GROUP_EMPTY[group];
  listEl.innerHTML = list.map(rowHtml).join("");
  scanFx(document.getElementById("ccMain"));
}

// ---------- Expanded row ----------
function teamTable(title, members, { kos = [], dmg = [] } = {}) {
  return `<div class="br-table"><h3>${esc(title)}</h3><div class="br-scroll"><table>
    <thead><tr><th>Pokémon</th><th>Moves</th><th>Item</th><th class="num">KOs</th><th class="num" title="Damage dealt, as a share of one Pokémon's full HP">Damage<br><span class="br-muted">% of HP</span></th></tr></thead>
    <tbody>${members.map((m, i) => `<tr>
      <td class="mon"><img src="${pokemonSprite(m)}" alt="" ${FALLBACK}>${esc(m.name)}${m.variant === "shiny" ? " ✨" : ""} <span class="br-muted">Lv ${m.level}${m.realLevel ? ` (real ${m.realLevel})` : ""}</span></td>
      <td class="moves">${esc((m.moves ?? []).join(", "))}</td>
      <td>${m.item ? esc(itemLabel(m.item)) : "—"}</td>
      <td class="num">${kos[i] ?? 0}</td>
      <td class="num">${dmg[i] ?? 0}%</td></tr>`).join("")}</tbody></table></div></div>`;
}

function rewardsHtml(r, p) {
  const out = [];
  const rw = p.reward;
  if (rw.rating) out.push(`Ranked rating ${fmt(rw.rating.from)} → ${fmt(rw.rating.to)} (${signed(rw.rating.to - rw.rating.from)})`);
  if (rw.cc) out.push(`${signed(rw.cc)} CC${r.kind === "wager" ? " (Stake)" : r.kind === "encounter" ? " Prize money" : ""}`);
  if (rw.badge) out.push(`Earned the ${esc(rw.badge[0].toUpperCase() + rw.badge.slice(1))} Badge`);
  if (rw.prize) out.push(`First-win prize: ${fmt(rw.prize.cc)} CC, ${rw.prize.stones} Evolution Stone${rw.prize.stones === 1 ? "" : "s"}, ${rw.prize.dust} Shiny Dust${rw.prize.sprites?.length ? `, ${rw.prize.sprites.length} trainer sprite${rw.prize.sprites.length === 1 ? "" : "s"}` : ""}`);
  if (rw.unlocked) out.push(`Unlocked ${rw.unlocked === "elite4" ? "the Elite Four" : esc(rw.unlocked[0].toUpperCase() + rw.unlocked.slice(1))}`);
  for (const g of rw.exp ?? []) if (g.gained) out.push(`${esc(g.name)} +${fmt(g.gained)} EXP${g.toLevel > g.fromLevel ? ` · Lv ${g.fromLevel} → ${g.toLevel}` : ""}${g.learned?.length ? ` · learned ${esc(g.learned.join(", "))}` : ""}`);
  if (!out.length) return "";
  return `<h3>Rewards</h3><ul class="br-rewards">${out.map((x) => `<li>${x}</li>`).join("")}</ul>`;
}

function fightsHtml(r, p) {
  if (r.fights.length < 2) return "";
  return `<h3>Fights</h3><ol class="br-fights">${r.fights.map((f, i) => {
    const won = f.result ? f.result.winner === p.mine : i < r.fights.length - 1;
    const br = r.breaks?.[i];
    const rev = br?.offered ? (br.slot != null ? ` · then revived ${esc(p.team[br.slot]?.name ?? "")}` : " · no Revive picked") : "";
    return `<li>${esc(f.foe?.name ?? "")}: ${won ? "won" : "lost"}${f.result ? ` in ${f.result.turns} turns` : ""}${f.missing ? " (turns not saved)" : ""}${i < r.fights.length - 1 ? rev : ""}</li>`;
  }).join("")}</ol>`;
}

async function expand(li) {
  const body = li.querySelector(".br-body");
  const head = li.querySelector(".br-head");
  const open = body.hidden;
  body.hidden = !open;
  li.classList.toggle("open", open);
  head.setAttribute("aria-expanded", String(open));
  if (!open || body.dataset.ready) return;
  body.innerHTML = `<p class="br-muted">Loading…</p>`;
  try {
    const r = await fullRecord(li.dataset.id);
    const p = perspective(r, id);
    const lastFight = [...r.fights].reverse().find((f) => f.result);
    const steps = replaySteps(r, id).filter((s) => s.kind !== "intro" || s.missing);
    body.innerHTML = `
      <div class="br-actions"><button type="button" class="cc-btn cc-btn--primary" data-watch>▶ Watch</button></div>
      ${fightsHtml(r, p)}
      <div class="br-tables">
        ${teamTable(`${p.me?.name ?? "You"}${p.plan ? ` · ${p.plan}` : ""}`, p.team, { kos: p.kos, dmg: damageBySlot(r, p.mine) })}
        ${lastFight ? teamTable(lastFight.foe?.name ?? p.foe?.name ?? "Opponent", lastFight.members[p.theirs], {
          kos: lastFight.members[p.theirs].map((_, i) => lastFight.result.knockouts.filter((k) => k.bySide === p.theirs && k.bySlot === i).length),
          dmg: r.fights.length > 1 ? [] : damageBySlot(r, p.theirs),
        }) : ""}
      </div>
      ${rewardsHtml(r, p)}
      <details class="br-turns"><summary>Turn by turn</summary><ol>${steps.map((s) => `<li>${s.turn ? `<span class="br-muted">T${s.turn}</span> ` : ""}${esc(s.caption)}</li>`).join("")}</ol></details>`;
    body.dataset.ready = "1";
  } catch (err) {
    if (err.expired) return showExpired();
    body.innerHTML = `<p class="br-muted">${esc(err.message)}</p>`;
  }
}

// ---------- Replay via #fight=<id> ----------
const fightFromHash = () => new URLSearchParams(location.hash.slice(1)).get("fight");

async function syncHash() {
  const fightId = fightFromHash();
  if (!fightId) return closeReplay();
  try {
    const r = await fullRecord(fightId);
    openReplay(r, id, { onClose: () => { if (fightFromHash()) history.back(); } });
  } catch (err) {
    if (err.expired) return showExpired();
    showBanner(err.status === 404 ? "That fight isn't in your Battle Records anymore." : err.message, { title: "Couldn't open the replay", key: "replay" });
    history.replaceState(null, "", location.pathname + location.search);
  }
}

// ---------- Wiring ----------
tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-group]");
  if (!b) return;
  group = b.dataset.group;
  tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  renderList();
});

listEl.addEventListener("click", (e) => {
  const li = e.target.closest(".br-row");
  if (!li) return;
  if (e.target.closest("[data-watch]")) {
    location.hash = `fight=${encodeURIComponent(li.dataset.id)}`;
    return;
  }
  if (e.target.closest(".br-head")) expand(li);
});

window.addEventListener("hashchange", syncHash);

async function load() {
  if (!id) { statusEl.textContent = ""; return; }
  try {
    records = (await getJSON(`/api/fight-records?id=${encodeURIComponent(id)}`)).records ?? [];
  } catch (err) {
    statusEl.textContent = "";
    if (err.expired) return showExpired();
    return showBanner(err.message, { title: "Couldn't load Battle Records" });
  }
  renderList();
  if (fightFromHash()) syncHash();
}

load();
