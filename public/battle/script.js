// ==========================================================
// public/battle/script.js — the Battle page.
// Starts Casual and Ranked battles and Challenges (services/dashboardFights.js).
// The server posts each fight to Discord as /battle or /challenge would;
// this page shows the result, where it was posted, and a link to the
// replay in Battle Records. An Elite Four run is polled while it plays, and
// the Revive pick is made here.
// ==========================================================

import { playerId, pageHref, showExpired, toast } from "/public/shared/shell.js";
import { scanFx } from "/public/shared/spriteFx.js";
import { auraPreview, loadAuraLooks, startAuraPreviews } from "/public/shared/auraPreview.js";

const id = playerId();
const $ = (sel) => document.getElementById(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");
const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;

const statusEl = $("btStatus");
const resultEl = $("btResult");

let state = null;
let mode = "open"; // "open" (Casual) or "ranked"
let found = [];
let busy = false; // a Fight press is in progress on this page
let runTimer = null;
let reviveTicker = null;
let preview = null;
let pickedStep = null; // the run step this page sent a Revive pick for

// ---------- API ----------
async function api(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 403) { showExpired(); const e = new Error("expired"); e.expired = true; throw e; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status}).`); e.status = res.status; e.data = data; throw e; }
  return data;
}
const q = (params) => new URLSearchParams({ id, ...params }).toString();

// ---------- Team view ----------
const FALLBACK = `onerror="this.onerror=null;this.src='/public/sprites/items/pokeball.png'"`;
const pokemonSprite = (m) => (m.megaForm
  ? `/public/sprites/pokemon/mega/${m.variant === "shiny" ? "shiny" : "normal"}/${encodeURIComponent(m.megaForm)}.gif`
  : `/public/sprites/pokemon/${m.variant === "shiny" ? "shiny" : "normal"}/${Number(m.speciesId)}.gif`);
const itemLabel = (id) => String(id ?? "").replace(/^item_/, "").split(/[_-]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** A team as the page shows it: sprite, name, Level, shiny, held item. */
function teamList(members, { label }) {
  if (!members?.length) return `<p class="bt-muted">No Pokémon on this team.</p>`;
  return `<ul class="bt-team" aria-label="${esc(label)}">${members.map((m) => `<li>
      <img src="${pokemonSprite(m)}" alt="" ${FALLBACK} />
      <span class="bt-team-name">${esc(m.name)}${m.variant === "shiny" ? ' <span aria-label="shiny">✨</span>' : ""}</span>
      <span class="bt-muted">Lv ${fmt(m.level)}${m.item ? ` · ${esc(itemLabel(m.item))}` : ""}</span>
    </li>`).join("")}</ul>`;
}

// ---------- Tabs ----------
const TABS = [["btTabBattle", "btBattle"], ["btTabChallenges", "btChallenges"]];
function selectTab(tabId, { focus = false } = {}) {
  for (const [t, panel] of TABS) {
    const on = t === tabId;
    $(t).setAttribute("aria-selected", String(on));
    $(t).tabIndex = on ? 0 : -1;
    $(panel).hidden = !on;
  }
  if (focus) $(tabId).focus();
  try { sessionStorage.setItem("cc-battle-tab", tabId); } catch { /* storage blocked */ }
}
$("btTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[role=tab]");
  if (b) selectTab(b.id);
});
$("btTabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const current = TABS.findIndex(([t]) => $(t).getAttribute("aria-selected") === "true");
  selectTab(TABS[(current + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0], { focus: true });
});

// ---------- Where it posts ----------
function whereLine(ch) {
  if (!ch) return `<span class="bt-warn">This fight won't be posted to Discord. Run /dashboard in a server channel to post it.</span>`;
  const name = `#${esc(ch.name ?? "channel")}`;
  return `Posts in ${ch.url ? `<a href="${esc(ch.url)}" target="_blank" rel="noopener">${name}</a>` : name}`;
}

// ---------- Battle tab ----------
function renderBattleTab() {
  for (const b of $("btMode").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  $("btBattleCount").textContent = `${state.battlesLeft} of ${state.battlesPerDay} battles left today`;
  $("btBattleWhere").innerHTML = whereLine(mode === "open" ? state.channels.casual : state.channels.ranked);
  renderPlayers($("btRecent"), state.recent);
  $("btRecentHead").hidden = !state.recent.length;
  renderPlayers($("btFound"), found);
  $("btFoundHead").hidden = !found.length;
}

// Why the Battle button is off for this Defender, or "".
function blockedWhy(p) {
  if (mode === "ranked") {
    if (state.teams.ranked < 6) return "Ranked battles need 6 Pokémon on both Ranked teams.";
    if (!p.ranked) return "Ranked battles need 6 Pokémon on both Ranked teams.";
    if (state.battlesLeft <= 0) return `${state.battlesPerDay} battles today. Ranked opens again at 00:00 UTC.`;
    if (p.leftVs <= 0) return "You two have battled 3 times today.";
    return "";
  }
  if (!state.teams.casual) return "Set a Casual team on the Teams page first.";
  if (!p.casual) return "They haven't set a team yet.";
  if (p.leftVs <= 0) return `${state.perOpponent} battles with them today. Ask for a rematch with /battle.`;
  return "";
}

function renderPlayers(list, players) {
  list.innerHTML = players.map((p) => {
    const why = blockedWhy(p);
    const casualNoExp = !why && mode === "open" && state.battlesLeft <= 0;
    return `<li class="bt-player">
      <div class="bt-player-main">
        <span class="bt-name">${esc(p.name)}</span>
        <span class="bt-muted">Rating ${fmt(p.rating)} · ${p.leftVs} of ${state.perOpponent} left today</span>
        ${why ? `<span class="bt-why">${esc(why)}</span>` : casualNoExp ? `<span class="bt-why">${state.battlesPerDay} battles today. This one earns no EXP.</span>` : ""}
      </div>
      <div class="bt-player-actions">
        <button type="button" class="cc-btn" data-team="${esc(p.id)}" aria-expanded="${openTeams.has(p.id)}" aria-controls="btTeam-${esc(list.id)}-${esc(p.id)}">Team</button>
        <button type="button" class="cc-btn cc-btn--primary" data-battle="${esc(p.id)}" data-name="${esc(p.name)}" ${why || busy ? "disabled" : ""}>Battle</button>
      </div>
      <div class="bt-team-panel" id="btTeam-${esc(list.id)}-${esc(p.id)}" data-team-for="${esc(p.id)}" ${openTeams.has(p.id) ? "" : "hidden"}></div>
    </li>`;
  }).join("");
  for (const panel of list.querySelectorAll("[data-team-for]")) if (!panel.hidden) fillTeam(panel);
}

// Defenders whose team is open, and their teams by "id:mode" (fetched once per page load).
const openTeams = new Set();
const teams = new Map();
async function fillTeam(panel) {
  const defenderId = panel.dataset.teamFor;
  const key = `${defenderId}:${mode}`;
  if (!teams.has(key)) {
    panel.innerHTML = `<p class="bt-muted">Loading…</p>`;
    try {
      teams.set(key, await api(`/api/battle/team?${q({ defenderId, mode })}`));
    } catch (err) {
      if (!err.expired) panel.innerHTML = `<p class="bt-muted">${esc(err.message)}</p>`;
      return;
    }
  }
  const t = teams.get(key);
  if (t.look?.startsWith("art:")) await loadAuraLooks([t.look]);
  panel.innerHTML = `<div class="bt-team-view">
      ${t.trainer ? auraPreview(t.look, t.trainer, { alt: t.name, className: "bt-aura small" }) : ""}
      <div><p class="bt-team-head">${esc(t.name)}'s ${t.mode === "ranked" ? "Ranked team · Lv 50" : "Casual team"}</p>
      ${teamList(t.members, { label: `${t.name}'s team` })}</div></div>`;
  scanFx(panel);
  startAuraPreviews(panel);
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-team]");
  if (!b) return;
  const id = b.dataset.team;
  const open = !openTeams.has(id);
  if (open) openTeams.add(id); else openTeams.delete(id);
  // The same Defender can be in Recent and in the search results: toggle both.
  for (const btn of document.querySelectorAll(`button[data-team="${CSS.escape(id)}"]`)) btn.setAttribute("aria-expanded", String(open));
  for (const panel of document.querySelectorAll(`[data-team-for="${CSS.escape(id)}"]`)) {
    panel.hidden = !open;
    if (open) fillTeam(panel);
  }
});

$("btMode").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b || b.dataset.mode === mode) return;
  mode = b.dataset.mode;
  renderBattleTab();
});

let searchSeq = 0;
let searchTimer = null;
$("btSearch").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 250);
});
async function search() {
  const text = $("btSearch").value.trim();
  const seq = ++searchSeq;
  const empty = $("btFoundEmpty");
  if (text.length < 2) {
    found = [];
    empty.hidden = true;
    return renderBattleTab();
  }
  try {
    const data = await api(`/api/battle/players?${q({ q: text })}`);
    if (seq !== searchSeq) return;
    found = data.players;
    empty.hidden = found.length > 0;
    empty.textContent = "No players with that name have started playing.";
  } catch (err) {
    if (err.expired || seq !== searchSeq) return;
    found = [];
    empty.hidden = false;
    empty.textContent = err.message;
  }
  renderBattleTab();
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-battle]");
  if (!b || busy) return;
  busy = true;
  b.textContent = "Battling…";
  for (const other of document.querySelectorAll("button[data-battle]")) other.disabled = true;
  try {
    const data = await api("/api/battle/start", { method: "POST", body: { id, defenderId: b.dataset.battle, mode } });
    showResult(data);
  } catch (err) {
    if (!err.expired) toast(err.message, { tone: "error", timeout: 7000 });
  } finally {
    busy = false;
    await refresh();
  }
});

// ---------- Result ----------
function expList(rows) {
  if (!rows?.length) return "";
  return `<ul class="bt-exp">${rows.map((e) => `<li><span>${esc(e.name)}</span>
    <span>${e.toLevel > e.fromLevel ? `Lv ${e.fromLevel} → <b>${e.toLevel}</b>` : `Lv ${e.fromLevel}`} · +${fmt(e.gained)} EXP</span>
    ${e.learned?.length ? `<span class="bt-learned">Learned ${esc(e.learned.join(", "))}. Equip it on the Teams page.</span>` : ""}</li>`).join("")}</ul>`;
}

function showResult({ result, fightId, posted }) {
  if (!result) return;
  const lines = [];
  if (result.kind === "battle") {
    if (result.rating) lines.push(`Ranked rating ${fmt(result.rating.from)} → <b>${fmt(result.rating.to)}</b> (${signed(result.rating.to - result.rating.from)})`);
    if (result.overCap) lines.push("No EXP: you've used all your battles for today.");
    if (result.megaShards) lines.push(`+${result.megaShards} Mega Shard${result.megaShards === 1 ? "" : "s"}`);
  } else {
    if (result.won && result.prize) lines.push(`Prize: ${esc(result.prize)}`);
    if (result.won && !result.prize) lines.push("Rematch: EXP only.");
    if (result.badge) lines.push(`You earned the ${esc(result.badge)}.`);
    if (result.unlocked === "elite4") lines.push("The Elite Four is open.");
    if (result.unlocked === "blue") lines.push("Blue is open.");
    if (result.auras) lines.push(`+${result.auras} Aura${result.auras === 1 ? "" : "s"}`);
    if (!result.won) lines.push(`You lost ${fmt(result.ccLost)} CC.`);
  }
  const replay = fightId ? `<a class="cc-btn" href="${esc(pageHref("/public/battlerecords/", id))}#fight=${encodeURIComponent(fightId)}">Watch replay</a>` : "";
  const where = posted
    ? `<p class="bt-muted">Posted in ${posted.url ? `<a href="${esc(posted.url)}" target="_blank" rel="noopener">#${esc(posted.name ?? "channel")}</a>` : `#${esc(posted.name ?? "channel")}`}</p>`
    : `<p class="bt-muted">Not posted to Discord.</p>`;
  resultEl.className = `bt-result cc-card ${result.won ? "win" : "loss"}`;
  resultEl.innerHTML = `
    <p class="bt-result-head">${result.won ? "You won" : "You lost"} against ${esc(result.opponent)}</p>
    ${lines.map((l) => `<p>${l}</p>`).join("")}
    ${expList(result.exp)}
    <div class="bt-result-foot">${where}${replay}</div>`;
  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------- Challenges tab ----------
function renderChallengesTab() {
  $("btChallengeCount").textContent = `${state.challengesLeft} of ${state.challengesPerDay} Challenges left today`;
  $("btChallengeWhere").innerHTML = whereLine(state.channels.challenge);
  const runOpen = state.run && state.run.stage !== "done";
  $("btBoard").innerHTML = state.board.map((c) => {
    const off = !c.unlocked || runOpen || state.challengesLeft <= 0 || busy;
    const note = !c.unlocked ? (c.key === "elite4" ? "Earn all 8 Badges" : "Clear the Elite Four") : c.won ? "Beaten" : c.type ?? "";
    return `<li><button type="button" class="bt-tile${c.won ? " won" : ""}" data-challenge="${esc(c.key)}" ${off ? "disabled" : ""}>
      <span class="bt-tile-name">${c.unlocked ? "" : "🔒 "}${esc(c.label)}</span>
      <span class="bt-muted">${esc(note)}</span></button></li>`;
  }).join("");
  renderRun();
}

$("btBoard").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-challenge]");
  if (!b) return;
  try {
    const data = await api(`/api/battle/challenge?${q({ key: b.dataset.challenge })}`);
    if (!data.ok) return toast(data.error, { tone: "error", timeout: 7000 });
    preview = data;
    openFoe = null;
    // Art Auras need their aura.json before they can be drawn.
    await loadAuraLooks([data.player?.look, ...(data.trainers ?? []).map((t) => t.aura?.look)]);
    if (preview === data) renderPreview();
  } catch (err) {
    if (!err.expired) toast(err.message, { tone: "error", timeout: 7000 });
  }
});

function renderPreview({ scroll = true } = {}) {
  const el = $("btPreview");
  if (!preview) { el.hidden = true; el.innerHTML = ""; return; }
  const p = preview;
  const title = p.key === "elite4" ? "Elite Four" : p.opponents[0];
  // You (with your equipped Aura) against every trainer you'll face, each
  // over the Aura they give when beaten, once that Aura's art exists.
  const figure = (look, trainer, name, sub) => `<figure class="bt-fig">
      ${auraPreview(look, trainer, { alt: name, className: "bt-aura" })}
      <figcaption><b>${esc(name)}</b>${sub ? `<span class="bt-muted">${esc(sub)}</span>` : ""}</figcaption></figure>`;
  // An opponent: click to see their party.
  const foe = (t, i) => `<button type="button" class="bt-fig-btn" data-foe="${i}" aria-expanded="${openFoe === i}" aria-controls="btFoeTeam">
      ${figure(t.aura?.look ?? null, t.trainer, t.name, t.aura?.look ? t.aura.name : t.title)}
      <span class="bt-fig-hint">${openFoe === i ? "Hide team" : "See team"}</span></button>`;
  const shownFoe = p.trainers?.[openFoe];
  const vs = p.player && p.trainers?.length ? `<div class="bt-vs${p.trainers.length > 1 ? " many" : ""}">
      <div class="bt-vs-side">${figure(p.player.look, p.player.trainer, p.player.name, "You")}</div>
      <span class="bt-vs-mark" aria-hidden="true">VS</span>
      <div class="bt-vs-side foes">${p.trainers.map(foe).join("")}</div>
    </div>
    <div id="btFoeTeam" class="bt-team-panel" ${shownFoe ? "" : "hidden"}>${shownFoe
      ? `<p class="bt-team-head">${esc(shownFoe.name)}'s team</p>${teamList(shownFoe.team, { label: `${shownFoe.name}'s team` })}`
      : ""}</div>` : "";
  el.innerHTML = `
    ${vs}
    <p class="bt-preview-head">${esc(title)}${p.badge ? ` · <span class="bt-muted">${esc(p.badge)} · ${esc(p.type)}</span>` : ""}</p>
    ${p.key === "elite4" ? `<p class="bt-muted">${esc(p.opponents.join(" · "))}</p>` : ""}
    <dl class="bt-stakes">
      <dt>Win</dt><dd>${p.prize ? esc(p.prize) : "Rematch: EXP only"}</dd>
      <dt>Lose</dt><dd>${esc(p.lossText)} (10% of your CC)</dd>
    </dl>
    <div class="bt-actions">
      ${p.picks.map((pick) => `<button type="button" class="cc-btn ${pick === "ranked" ? "cc-btn--primary" : "cc-btn--gold"}" data-fight="${pick}" ${busy ? "disabled" : ""}>Fight with ${pick === "ranked" ? "Ranked" : "Casual"} team</button>`).join("")}
      <button type="button" class="cc-btn" data-fight="">Not now</button>
    </div>`;
  el.hidden = false;
  scanFx(el);
  startAuraPreviews(el);
  if (scroll) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

let openFoe = null; // index of the Challenge opponent whose team is open
$("btPreview").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-foe]");
  if (!b) return;
  const i = Number(b.dataset.foe);
  openFoe = openFoe === i ? null : i;
  renderPreview({ scroll: false });
  $("btPreview").querySelector(`button[data-foe="${i}"]`)?.focus();
});

$("btPreview").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-fight]");
  if (!b || busy) return;
  const pick = b.dataset.fight;
  const key = preview?.key;
  preview = null;
  renderPreview();
  if (!pick || !key) return;
  busy = true;
  statusEl.textContent = "Starting your Challenge…";
  try {
    const data = await api("/api/battle/challenge", { method: "POST", body: { id, key, pick } });
    if (data.run) {
      state.run = data.run;
      renderRun();
      pollRun();
    } else {
      showResult(data);
    }
  } catch (err) {
    if (!err.expired) toast(err.message, { tone: "error", timeout: 7000 });
  } finally {
    busy = false;
    statusEl.textContent = "";
    await refresh();
  }
});

// ---------- Elite Four run ----------
function renderRun() {
  const el = $("btRun");
  const run = state?.run;
  clearInterval(reviveTicker);
  if (!run || run.stage === "done") {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  if (run.stage === "elsewhere") {
    el.innerHTML = `<p>You have an Elite Four run open in Discord. Finish it there.</p>`;
    el.hidden = false;
    return;
  }
  const at = run.stage === "revive" ? run.fight + 1 : run.fight; // during a Revive pick, the next fight is up
  const steps = run.opponents.map((name, i) => `<li class="${i < at ? "past" : i === at ? "now" : ""}">${esc(name)}</li>`).join("");
  let body = `<p class="bt-muted">${run.posted ? "Playing in Discord." : "Playing here only."}</p>`;
  if (run.stage === "revive" && run.pick) {
    const p = run.pick;
    body = `<p>Revive one Pokémon for ${esc(p.next)} · <b id="btReviveLeft">${Math.ceil(p.msLeft / 1000)}</b> s</p>
      <div class="bt-actions">${p.fainted.map((f) => `<button type="button" class="cc-btn cc-btn--primary" data-revive="${f.slot}">${esc(f.name)} Lv ${f.level}</button>`).join("")}</div>`;
    const ends = Date.now() + p.msLeft;
    reviveTicker = setInterval(() => {
      const left = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
      const span = $("btReviveLeft");
      if (span) span.textContent = String(left);
      if (left <= 0) clearInterval(reviveTicker);
    }, 250);
  }
  el.innerHTML = `<p class="bt-preview-head">Elite Four run</p><ol class="bt-steps">${steps}</ol>${body}`;
  el.hidden = false;
}

$("btRun").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-revive]");
  const p = state?.run?.pick;
  if (!b || !p) return;
  for (const x of $("btRun").querySelectorAll("button")) x.disabled = true;
  try {
    pickedStep = p.step;
    const data = await api("/api/battle/revive", { method: "POST", body: { id, nonce: p.nonce, step: p.step, slot: Number(b.dataset.revive) } });
    state.run = data.run;
    toast(`${b.textContent.replace(/ Lv \d+$/, "")} revived.`, { tone: "success" });
  } catch (err) {
    if (!err.expired) toast(err.message, { tone: "error" });
  }
  renderRun();
});

function pollRun() {
  clearTimeout(runTimer);
  runTimer = setTimeout(async () => {
    try {
      const { run } = await api(`/api/battle/run?${q({})}`);
      const before = state.run;
      state.run = run;
      if (run?.stage === "done") {
        if (run.result) showResult({ result: run.result, fightId: run.fightId, posted: run.postedTo });
        await refresh();
        return;
      }
      if (before?.stage === "revive" && run?.stage !== "revive" && pickedStep !== before.pick?.step) {
        toast("No Revive picked. The run goes on.");
      }
      // Re-render only when something changed, so a click on a Revive button isn't lost.
      if (!before || before.stage !== run?.stage || before.fight !== run?.fight) renderRun();
      if (run && run.stage !== "elsewhere") pollRun();
    } catch (err) {
      if (!err.expired) pollRun();
    }
  }, 1500);
}

// ---------- Load ----------
async function refresh() {
  try {
    state = await api(`/api/battle?${q({})}`);
    statusEl.textContent = "";
    renderBattleTab();
    renderChallengesTab();
    if (state.run && (state.run.stage === "playing" || state.run.stage === "revive")) pollRun();
  } catch (err) {
    if (err.expired) return;
    statusEl.textContent = err.status === 404 ? "The Battle page isn't open yet." : err.message;
  }
}

if (id) {
  let tab = "btTabBattle";
  try { tab = sessionStorage.getItem("cc-battle-tab") || tab; } catch { /* storage blocked */ }
  selectTab(TABS.some(([t]) => t === tab) ? tab : "btTabBattle");
  refresh();
} else {
  statusEl.textContent = "";
}
