// ==========================================================
// public/teams/script.js — Teams page (Display + Battle teams)
//
// Design option B (docs/design/TEAMS-COLLECTION-REDESIGN.md): a switcher
// shows one team at a time; the box of owned copies is pinned beside it
// (desktop) or opens as a sheet (phone). Tapping a box Pokémon adds it to
// the team on screen.
//
// Reads  GET  /api/user-pokemon   (pokemon, levels, powers, currentTeam, battleTeam)
//        GET  /api/mega           (only to know whether Mega sprites show)
//        GET  /public/pokemonData.json
// Writes POST /api/set-pokemon-team { id, team, teamType: "display" | "battle" }
//
// The server is the authority for every rule (ownership, 1–6 slots, one
// Mega per team, one mythic-tier Pokémon on the Battle team). The checks here
// only explain things early; a refused save shows the server's message.
// ==========================================================

import { playerId, showBanner, showExpired, toast, showActionError, confirmDialog } from "/public/shared/shell.js";
import { displaySpeciesName } from "/public/shared/names.js";
import { scanFx } from "/public/shared/spriteFx.js";
import { openMovesEditor } from "/public/teams/moves.js";

const TEAMS = ["display", "battle"];
const LABEL = { display: "Display team", battle: "Battle team" };
const MAX = 6;
const BATTLE_LEVEL = 50;
// pokemonData.json type ids (same order as the Pokémon page's TYPE_MAP).
const TYPE_NAMES = [null, "normal", "fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel", "fire", "water", "grass", "electric", "psychic", "ice", "dragon", "dark", "fairy"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const keyOf = (s) => `${s.id}:${s.variant}`;
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const app = document.getElementById("teamsApp");
const sheet = document.getElementById("boxSheet");
const sheetBody = document.getElementById("boxSheetBody");
const userId = playerId();

const state = {
  data: {},              // pokemonData by id
  pokemon: {},           // owned counts
  levels: {},            // "6:normal" → Level
  powers: {},            // "6:normal" → Power
  megaOn: false,
  megaCards: [], // GET /api/mega cards (only while Mega Evolution is on)
  saved: { display: [], battle: null },
  notices: [],           // one-time Battle team notices (GET /api/user-pokemon)
  draft: { display: [], battle: null },
  active: "display",
  error: { display: null, battle: null },
  filter: { q: "", show: "all", sort: "power" },
  saving: false,
};

// ---------- helpers ----------
const species = (id) => state.data[id] ?? { name: `#${id}`, tier: "common", types: [] };
const isMythic = (id) => String(species(id).tier).toLowerCase() === "mythic";
/** Type chips (text on the type color, never color alone). Base form's types. */
const typeChips = (id) => `<span class="tm-types">${(species(id).types ?? []).map((t) => TYPE_NAMES[t]).filter(Boolean).map((t) => `<span class="cc-type" data-type="${t}">${t}</span>`).join("")}</span>`;
const levelOf = (s) => state.levels[keyOf(s)] ?? "?";
const powerOf = (s) => state.powers[keyOf(s)] ?? 0;
const megaCard = (formId) => state.megaCards.find((c) => c.formId === formId);
const slotName = (s) => (s.mega && state.megaOn ? megaCard(s.mega)?.name ?? megaName(s) : species(s.id).name);
/** Mega forms this exact copy can use on a team (unlocked on its line, allowed for teams). */
const megaFormsFor = (s) => state.megaCards.filter((c) => c.line === `${s.id}:${s.variant}` && c.teamSelectable);
const megaName = (s) => `Mega ${species(s.id).name}${/-([xy])$/.test(s.mega) ? ` ${s.mega.slice(-1).toUpperCase()}` : ""}`;
function spriteOf(s) {
  if (s.mega && state.megaOn) return `/public/sprites/pokemon/mega/${s.variant}/${s.mega}.gif`;
  return `/public/sprites/pokemon/${s.variant === "shiny" ? "shiny" : "normal"}/${s.id}.gif`;
}
const team = (t) => state.draft[t] ?? [];
const isDirty = (t) => !same(state.draft[t], state.saved[t]);
const anyDirty = () => TEAMS.some(isDirty);

function membership(s) {
  const out = [];
  for (const t of TEAMS) team(t).forEach((m, i) => m.id === s.id && m.variant === s.variant && out.push({ t, slot: i + 1 }));
  return out;
}

/** Why `s` can't join team `t` right now (null = it can). Mirrors the server. */
function blockReason(t, s, { replaceAt = -1 } = {}) {
  const list = replaceAt >= 0 ? team(t).filter((_, k) => k !== replaceAt) : team(t);
  if (list.some((m) => m.id === s.id && m.variant === s.variant)) return { code: "on", short: "On this team", text: `${species(s.id).name} is already on your ${LABEL[t]}.` };
  if (list.length >= MAX) return { code: "full", short: "Team full", text: `Your ${LABEL[t]} is full (6/6). Remove a Pokémon first.` };
  if (t === "battle" && isMythic(s.id)) {
    const other = list.find((m) => isMythic(m.id));
    if (other) {
      return {
        code: "mythic",
        short: "Mythic limit",
        title: "One mythic-tier Pokémon per Battle team",
        text: `${species(s.id).name} can’t join your Battle team: it already has a mythic-tier Pokémon (${species(other.id).name}). Remove ${species(other.id).name} first, or add ${species(s.id).name} to your Display team.`,
      };
    }
  }
  return null;
}

// Screen-reader announcements for reorder/add/remove.
const live = document.createElement("p");
live.className = "sr-only";
live.setAttribute("aria-live", "polite");
document.body.append(live);
const announce = (msg) => { live.textContent = ""; requestAnimationFrame(() => { live.textContent = msg; }); };

// ---------- actions ----------
let focusAfter = null;

/**
 * Add a box copy to team t. at: slot index to insert at (default: the end).
 * replace: swap out the Pokémon at that slot (drag onto a filled slot of a
 * full team). Same rules as the server.
 */
function add(t, s, { at = null, replace = false } = {}) {
  const list = [...team(t)];
  const existing = list.findIndex((m) => m.id === s.id && m.variant === s.variant);
  if (existing >= 0 && at != null) return moveTo(t, existing, Math.min(at, list.length - 1)); // already on it: just move
  const replaceAt = replace && at != null && at < list.length ? at : -1;
  const why = blockReason(t, s, { replaceAt });
  if (why) {
    if (why.code === "mythic") state.error[t] = why;
    else toast(why.text);
    render();
    return;
  }
  state.error[t] = null;
  const slot = { id: s.id, variant: s.variant };
  let pos;
  if (replaceAt >= 0) {
    const [out] = list.splice(replaceAt, 1, slot);
    pos = replaceAt;
    announce(`${species(s.id).name} replaced ${slotName(out)} in slot ${pos + 1}.`);
  } else {
    pos = at == null ? list.length : Math.min(at, list.length);
    list.splice(pos, 0, slot);
    announce(`${species(s.id).name} added to your ${LABEL[t]}, slot ${pos + 1}.`);
  }
  state.draft[t] = list;
  render();
}

function move(t, i, dir) {
  const list = [...team(t)];
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  state.draft[t] = list;
  announce(`${slotName(list[j])} moved to slot ${j + 1}.`);
  // Follow the Pokémon; if its arrow is now disabled (top/bottom), use the other one.
  focusAfter = [`[data-act="move"][data-team="${t}"][data-i="${j}"][data-dir="${dir}"]`, `[data-act="move"][data-team="${t}"][data-i="${j}"][data-dir="${-dir}"]`];
  render();
}

function moveTo(t, from, to) {
  if (from === to) return;
  const list = [...team(t)];
  const [m] = list.splice(from, 1);
  list.splice(to, 0, m);
  state.draft[t] = list;
  announce(`${slotName(m)} moved to slot ${to + 1}.`);
  render();
}

function remove(t, i) {
  const list = [...team(t)];
  const [m] = list.splice(i, 1);
  state.draft[t] = list;
  state.error[t] = null;
  announce(`${slotName(m)} removed from your ${LABEL[t]}.`);
  focusAfter = `[data-act="remove"][data-team="${t}"][data-i="${Math.min(i, list.length - 1)}"]`;
  render();
}

/**
 * Mega picker: cycles this slot through Off → each unlocked form. One Mega
 * per team, so choosing one turns off the other slot's Mega (the server
 * checks the same rule on save).
 */
function cycleMega(t, i) {
  const list = team(t).map((s) => ({ ...s }));
  const s = list[i];
  if (!s) return;
  const options = [null, ...megaFormsFor(s).map((c) => c.formId)];
  const next = options[(options.indexOf(s.mega ?? null) + 1) % options.length];
  if (next) {
    const other = list.findIndex((m, k) => k !== i && m.mega);
    if (other >= 0) {
      toast(`One Mega per team: ${species(list[other].id).name} goes back to its base form.`);
      delete list[other].mega;
    }
    s.mega = next;
  } else delete s.mega;
  state.draft[t] = list;
  announce(next ? `${species(s.id).name} will battle as ${megaCard(next)?.name ?? next}.` : `${species(s.id).name} will battle in its base form.`);
  focusAfter = `[data-act="mega"][data-team="${t}"][data-i="${i}"]`;
  render();
}

function copyDisplay() {
  const kept = [];
  const dropped = [];
  let mythics = 0;
  for (const s of team("display")) {
    if (isMythic(s.id) && mythics++ >= 1) { dropped.push(s); continue; }
    kept.push(clone(s));
  }
  state.draft.battle = kept;
  state.error.battle = null;
  const msg = dropped.length
    ? `Copied your Display team. ${dropped.map((s) => species(s.id).name).join(", ")} left out: one mythic-tier Pokémon per Battle team.`
    : "Copied your Display team.";
  announce(msg);
  toast(msg);
  render();
}

function discard() {
  state.draft = clone(state.saved);
  state.error = { display: null, battle: null };
  announce("Changes discarded.");
  render();
}

async function save() {
  if (state.saving) return;
  const dirty = TEAMS.filter(isDirty);
  for (const t of dirty) {
    if (!team(t).length) {
      state.active = t;
      toast(`Your ${LABEL[t]} needs at least one Pokémon.`, { tone: "error" });
      render();
      return;
    }
  }
  state.saving = true;
  render();
  try {
    for (const t of dirty) {
      const res = await fetch("/api/set-pokemon-team", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, team: team(t), teamType: t }),
      });
      let body = {};
      try { body = await res.json(); } catch { /* non-JSON */ }
      if (res.status === 403) { showExpired(); return; }
      if (!res.ok || !body.success) {
        const err = new Error(body.error || `Couldn’t save your ${LABEL[t]} (${res.status}).`);
        err.team = t;
        throw err;
      }
      // Re-render from what the server stored.
      state.saved.display = clone(body.currentTeam ?? state.saved.display);
      state.saved.battle = clone(body.battleTeam ?? state.saved.battle);
      state.draft[t] = clone(t === "display" ? state.saved.display : state.saved.battle);
      if (body.saveDelayed || body.saved === false) toast(body.notice || "Saved with a delay. Your change is kept and will be written shortly.");
    }
    toast(dirty.length > 1 ? "Both teams saved." : `${LABEL[dirty[0]]} saved.`, { tone: "success" });
  } catch (err) {
    if (err.team) {
      state.active = err.team;
      if (/mythic/i.test(err.message)) state.error[err.team] = { title: "One mythic-tier Pokémon per Battle team", text: err.message };
    }
    showActionError(err, `Couldn’t save your ${err.team ? LABEL[err.team] : "teams"}`);
  } finally {
    state.saving = false;
    render();
  }
}

/** Hide the Battle team notices and tell the server they were seen. */
async function dismissNotices() {
  const ids = state.notices.map((n) => n.id);
  state.notices = [];
  render();
  try {
    const res = await fetch("/api/dismiss-notices", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, ids }),
    });
    if (res.status === 403) showExpired();
  } catch { /* shown again next visit; harmless */ }
}

// ---------- rendering ----------
function slotCard(t, s, i) {
  if (!s) {
    return `<li class="tm-slot is-empty" data-team="${t}" data-i="${i}"><button type="button" class="tm-slot-add" data-act="openbox" aria-label="Add a Pokémon to ${LABEL[t]} slot ${i + 1}">
      <svg class="tm-ic" aria-hidden="true"><use href="#tm-plus"/></svg><span>Add</span></button></li>`;
  }
  const sp = species(s.id);
  const name = slotName(s);
  const isB = t === "battle";
  const savedList = state.saved[t] ?? [];
  const wasAt = savedList.findIndex((m) => keyOf(m) === keyOf(s));
  const change = wasAt === -1 ? "New" : wasAt !== i ? "Moved" : null;
  const lvl = isB
    ? `<span class="tm-lv tm-lv--fixed" title="Ranked and wager battles use Lv ${BATTLE_LEVEL}"><b>Lv ${BATTLE_LEVEL}</b><small>yours Lv ${levelOf(s)}</small></span>`
    : `<span class="tm-lv"><b>Lv ${levelOf(s)}</b></span>`;
  const tags = [
    i === 0 ? `<span class="tm-tag tm-tag--lead">Lead</span>` : "",
    s.mega && state.megaOn ? `<span class="tm-tag tm-tag--mega">Mega</span>` : "",
    isMythic(s.id) ? `<span class="cc-tier" data-tier="mythic">Mythic</span>` : "",
    change ? `<span class="tm-tag tm-tag--change">${change}</span>` : "",
  ].join("");
  const shiny = s.variant === "shiny";
  return `<li class="tm-slot tm-slot--lg${i === 0 ? " is-lead" : ""}${shiny ? " is-shiny" : ""}${s.mega && state.megaOn ? " is-mega" : ""}${change ? " is-changed" : ""}" draggable="true" data-team="${t}" data-i="${i}">
    <div class="tm-stage"${shiny ? ` data-fx="shiny" data-fx-seed="${s.id}"` : ""}>
      <span class="tm-no">${i + 1}<span class="sr-only">: </span></span>
      ${shiny ? `<span class="tm-shiny" title="Shiny"><svg class="tm-ic" aria-hidden="true"><use href="#tm-sparkle"/></svg><span class="sr-only">Shiny</span></span>` : ""}
      <img class="cc-sprite" src="${spriteOf(s)}" alt="" onerror="this.onerror=null;this.src='/public/sprites/items/pokeball.png'">
    </div>
    <div class="tm-slot-body">
      <div class="tm-slot-name">${esc(name)}</div>
      <div class="tm-slot-meta">${lvl}</div>
      ${typeChips(s.id)}
      <div class="tm-slot-tags">${tags}</div>
      <button type="button" class="tm-movesbtn" data-act="moves" data-team="${t}" data-i="${i}" aria-label="${esc(species(s.id).name)}’s moves on your ${LABEL[t]}">Moves</button>
      ${state.megaOn && megaFormsFor(s).length ? `<button type="button" class="tm-megabtn${s.mega ? " is-on" : ""}" data-act="mega" data-team="${t}" data-i="${i}" aria-label="Mega form for ${esc(species(s.id).name)}: ${s.mega ? esc(megaCard(s.mega)?.name ?? s.mega) : "off"}. Change">${s.mega ? `Mega: ${esc((megaCard(s.mega)?.name ?? s.mega).replace(/^Mega /, ""))}` : "Mega: off"}</button>` : ""}
    </div>
    <div class="tm-slot-ctl">
      <span class="tm-grip" title="Drag to reorder"><svg class="tm-ic" aria-hidden="true"><use href="#tm-grip"/></svg></span>
      <button type="button" class="tm-ib" data-act="move" data-team="${t}" data-i="${i}" data-dir="-1" aria-label="Move ${esc(name)} up"${i === 0 ? " disabled" : ""}><svg class="tm-ic" aria-hidden="true"><use href="#tm-up"/></svg></button>
      <button type="button" class="tm-ib" data-act="move" data-team="${t}" data-i="${i}" data-dir="1" aria-label="Move ${esc(name)} down"${i === team(t).length - 1 ? " disabled" : ""}><svg class="tm-ic" aria-hidden="true"><use href="#tm-down"/></svg></button>
      <button type="button" class="tm-ib tm-ib--x" data-act="remove" data-team="${t}" data-i="${i}" aria-label="Remove ${esc(name)} from your ${LABEL[t]}"><svg class="tm-ic" aria-hidden="true"><use href="#tm-x"/></svg></button>
    </div>
  </li>`;
}

function rules() {
  const list = team("battle");
  const mythic = list.filter((s) => isMythic(s.id)).length;
  const mega = state.megaOn ? list.filter((s) => s.mega).length : 0;
  const err = !!state.error.battle;
  return `<ul class="tm-rules" aria-label="Battle team rules">
    <li class="tm-rule"><svg class="tm-ic" aria-hidden="true"><use href="#tm-swords"/></svg>Battles at <b>Lv ${BATTLE_LEVEL}</b></li>
    <li class="tm-rule${err ? " is-error" : mythic >= 1 ? " is-full" : ""}">Mythic <b>${mythic}/1</b></li>
    ${state.megaOn ? `<li class="tm-rule${mega >= 1 ? " is-full" : ""}">Mega <b>${mega}/1</b></li>` : ""}
    <li class="tm-rule">Slots <b>${list.length}/6</b></li>
  </ul>`;
}

function teamPanel() {
  const t = state.active;
  const isB = t === "battle";
  const list = team(t);
  const head = isB
    ? `<div><h2 class="tm-h2" id="teamHeading" tabindex="-1"><svg class="tm-ic" aria-hidden="true"><use href="#tm-swords"/></svg>Battle team</h2>
         <p class="tm-sub">Ranked and wager battles. Everyone fights at Lv ${BATTLE_LEVEL}; your Pokémon still earn EXP at their real Level.</p></div>${state.draft.battle ? rules() : ""}`
    : `<div><h2 class="tm-h2" id="teamHeading" tabindex="-1"><svg class="tm-ic" aria-hidden="true"><use href="#tm-smile"/></svg>Display team</h2>
         <p class="tm-sub">Open battles at real Levels, plus /showteam and your trainer card. Slot 1 leads.</p></div>`;
  let body;
  if (isB && state.draft.battle == null) {
    body = `<div class="tm-empty"><p><strong>No Battle team yet.</strong><br>Ranked and wager battles will use it.</p>
      <button type="button" class="cc-btn cc-btn--primary" data-act="copy"${team("display").length ? "" : " disabled"}>Copy my Display team</button>
      <p class="tm-sub" style="margin-top:12px">Or pick Pokémon from your box. One mythic-tier Pokémon at most.</p></div>`;
  } else if (!list.length) {
    body = `<div class="tm-empty"><p><strong>This team is empty.</strong> Pick up to six Pokémon from your box.</p>
      ${isB && team("display").length ? `<button type="button" class="cc-btn" data-act="copy">Copy my Display team</button>` : ""}</div>`;
  } else {
    body = `<ol class="tm-slots">${Array.from({ length: MAX }, (_, i) => slotCard(t, list[i] ?? null, i)).join("")}</ol>`;
  }
  const note = isB && state.notices.length
    ? `<div class="tm-notice" role="status"><p>${state.notices.map((n) => esc(n.text)).join("<br>")}</p><button type="button" class="cc-btn" data-act="dismiss">Got it</button></div>`
    : "";
  const e = state.error[t];
  const err = e ? `<div class="tm-error" role="alert"><svg class="tm-ic" aria-hidden="true"><use href="#tm-lock"/></svg><p><strong>${esc(e.title ?? "Can’t add that Pokémon")}</strong>${esc(e.text)}</p></div>` : "";
  return `<section id="teamPanel" class="tm-panel tm-panel--${t} tm-team" role="tabpanel" aria-labelledby="tab-${t}">
    <div class="tm-panel-head">${head}</div>${note}${body}${err}
    <button type="button" class="cc-btn tm-addbtn" data-act="openbox"><svg class="tm-ic" aria-hidden="true"><use href="#tm-plus"/></svg>Add from your box</button>
  </section>`;
}

function switcher() {
  const tab = (t) => {
    const list = state.draft[t];
    const mini = list && list.length
      ? `<span class="tm-mini" aria-hidden="true">${list.map((s) => `<img src="${spriteOf(s)}" alt="">`).join("")}</span>`
      : `<span class="tm-sub">${t === "battle" && list == null ? "Not set yet" : "Empty"}</span>`;
    const status = isDirty(t) ? `<span class="tm-dot" aria-hidden="true"></span><span class="sr-only">(unsaved changes)</span>` : list ? `${list.length}/6` : "";
    return `<button type="button" class="tm-tab" role="tab" id="tab-${t}" aria-controls="teamPanel" aria-selected="${state.active === t}" tabindex="${state.active === t ? 0 : -1}" data-act="tab" data-team="${t}">
      <span class="tm-tab-title"><svg class="tm-ic" aria-hidden="true"><use href="#tm-${t === "battle" ? "swords" : "smile"}"/></svg>${LABEL[t]}<small>${status}</small></span>${mini}</button>`;
  };
  return `<div class="tm-switch" role="tablist" aria-label="Team">${tab("display")}${tab("battle")}</div>`;
}

function boxItems() {
  const out = [];
  for (const [k, v] of Object.entries(state.pokemon)) {
    const id = Number(k);
    if (!Number.isInteger(id) || !state.data[id]) continue;
    if ((v?.normal ?? 0) > 0) out.push({ id, variant: "normal", count: v.normal });
    if ((v?.shiny ?? 0) > 0) out.push({ id, variant: "shiny", count: v.shiny });
  }
  const { q, show, sort } = state.filter;
  const qq = q.trim().toLowerCase();
  const list = out.filter((s) => {
    if (show === "shiny" && s.variant !== "shiny") return false;
    if (show === "free" && membership(s).length) return false;
    if (qq && !species(s.id).name.toLowerCase().includes(qq) && !(species(s.id).storedName ?? "").toLowerCase().includes(qq) && String(s.id) !== qq) return false;
    return true;
  });
  const by = {
    power: (a, b) => powerOf(b) - powerOf(a) || a.id - b.id,
    level: (a, b) => (Number(levelOf(b)) || 0) - (Number(levelOf(a)) || 0) || a.id - b.id,
    dex: (a, b) => a.id - b.id || (a.variant === "shiny") - (b.variant === "shiny"),
    name: (a, b) => species(a.id).name.localeCompare(species(b.id).name),
  }[sort];
  return list.sort(by);
}

function boxTile(s) {
  const t = state.active;
  const sp = species(s.id);
  const why = state.draft[t] == null && t === "battle" ? null : blockReason(t, s);
  const badges = membership(s).map((m) => `<span class="tm-mem tm-mem--${m.t}" title="${LABEL[m.t]}, slot ${m.slot}">${m.t === "battle" ? "B" : "D"}${m.slot}</span>`).join("");
  const shiny = s.variant === "shiny";
  const blocked = why && why.code === "mythic";
  const label = `${sp.name}${shiny ? " (shiny)" : ""}, Lv ${levelOf(s)}${why ? `. ${why.short}` : `. Add to your ${LABEL[t]}`}`;
  return `<li class="tm-tile${shiny ? " is-shiny" : ""}${blocked ? " is-blocked" : ""}${why?.code === "on" ? " is-on" : ""}">
    <button type="button" class="tm-tile-btn" data-act="add" data-id="${s.id}" data-variant="${s.variant}" aria-label="${esc(label)}" draggable="true">
      <span class="tm-tile-badges">${badges}</span>
      ${blocked ? `<span class="tm-tile-block" title="${esc(why.text)}"><svg class="tm-ic" aria-hidden="true"><use href="#tm-lock"/></svg>Mythic</span>` : ""}
      ${shiny ? `<span class="tm-shiny tm-shiny--sm"><svg class="tm-ic" aria-hidden="true"><use href="#tm-sparkle"/></svg></span>` : ""}
      <span class="tm-tile-art"${shiny ? ` data-fx="shiny" data-fx-seed="${s.id}"` : ""}><img class="cc-sprite" src="/public/sprites/pokemon/${shiny ? "shiny" : "normal"}/${s.id}.gif" alt="" loading="lazy" onerror="this.onerror=null;this.src='/public/sprites/items/pokeball.png'"></span>
      <span class="tm-tile-name">${esc(sp.name)}</span>
      ${typeChips(s.id)}
      <span class="tm-tile-lv">Lv ${levelOf(s)}${isMythic(s.id) && !blocked ? ` · <b class="tier-text mythic">Mythic</b>` : ""}</span>
    </button></li>`;
}

function boxPanel(where) {
  const t = state.active;
  const items = boxItems();
  const f = state.filter;
  const seg = (v, label) => `<button type="button" data-act="show" data-show="${v}" aria-pressed="${f.show === v}">${label}</button>`;
  return `<div class="tm-panel-head"><div>${where === "sheet" ? "" : `<h2 class="tm-h2" id="boxHeading">Add to ${LABEL[t]}</h2>`}
      <p class="tm-sub">Tap to add.${t === "battle" ? " Locked: would break a Battle team rule." : ""} D = Display slot, B = Battle slot.</p></div></div>
    <div class="tm-boxbar">
      <label class="sr-only" for="boxSearch-${where}">Search your Pokémon</label>
      <input id="boxSearch-${where}" type="search" placeholder="Search…" value="${esc(f.q)}" data-act="search" autocomplete="off">
      <label class="sr-only" for="boxSort-${where}">Sort</label>
      <select id="boxSort-${where}" data-act="sort">
        ${[["power", "Power"], ["level", "Level"], ["dex", "Pokédex #"], ["name", "Name"]].map(([v, l]) => `<option value="${v}"${f.sort === v ? " selected" : ""}>Sort: ${l}</option>`).join("")}
      </select>
      <div class="tm-seg" role="group" aria-label="Show">${seg("all", "All")}${seg("shiny", "Shiny")}${seg("free", "Not on a team")}</div>
    </div>
    ${items.length ? `<ul class="tm-box">${items.map(boxTile).join("")}</ul>` : `<p class="cc-empty">${Object.keys(state.pokemon).length ? "No Pokémon match." : "You haven’t caught any Pokémon yet. Try /daily in Discord."}</p>`}`;
}

function saveBar() {
  if (!anyDirty()) return "";
  const parts = TEAMS.filter(isDirty).map((t) => {
    const a = state.saved[t] ?? [];
    const b = team(t);
    const added = b.filter((s) => !a.some((m) => keyOf(m) === keyOf(s))).map((s) => species(s.id).name);
    const removed = a.filter((s) => !b.some((m) => keyOf(m) === keyOf(s))).map((s) => species(s.id).name);
    const bits = [];
    if (added.length) bits.push(`added ${added.join(", ")}`);
    if (removed.length) bits.push(`removed ${removed.join(", ")}`);
    if (!bits.length) bits.push("new order");
    return `${LABEL[t]}: ${bits.join(" · ")}`;
  });
  return `<div class="tm-savebar" role="region" aria-label="Unsaved changes">
    <p><strong>Unsaved changes</strong><span>${esc(parts.join(" — "))}</span></p>
    <div class="tm-savebar-actions">
      <button type="button" class="cc-btn" data-act="discard"${state.saving ? " disabled" : ""}>Discard</button>
      <button type="button" class="cc-btn cc-btn--primary" data-act="save"${state.saving ? " disabled" : ""}>${state.saving ? "Saving…" : TEAMS.filter(isDirty).length > 1 ? "Save teams" : "Save"}</button>
    </div></div>`;
}

const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <symbol id="tm-up" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 14 6-6 6 6"/></symbol>
  <symbol id="tm-down" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 10 6 6 6-6"/></symbol>
  <symbol id="tm-x" viewBox="0 0 24 24"><path stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M7 7l10 10M17 7 7 17"/></symbol>
  <symbol id="tm-plus" viewBox="0 0 24 24"><path stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M12 5v14M5 12h14"/></symbol>
  <symbol id="tm-grip" viewBox="0 0 24 24"><g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></symbol>
  <symbol id="tm-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M8 11V8a4 4 0 0 1 8 0v3"/></symbol>
  <symbol id="tm-sparkle" viewBox="0 0 24 24"><path fill="currentColor" d="M10 2c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7zm8 11c.3 2 1.2 2.9 3.2 3.2-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.2 3.2-3.2z"/></symbol>
  <symbol id="tm-swords" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 4l9 9M20 4l-9 9M6 14l4 4M18 14l-4 4M3 19l3 2M21 19l-3 2"/></symbol>
  <symbol id="tm-smile" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 14c1 1.5 2.3 2 4 2s3-.5 4-2"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/></symbol>
</svg>`;
document.body.insertAdjacentHTML("afterbegin", ICONS);

function render() {
  const searchFocus = document.activeElement?.dataset?.act === "search" ? { where: document.activeElement.id, pos: document.activeElement.selectionStart } : null;
  app.innerHTML = `${switcher()}<div class="tm-layout">${teamPanel()}<aside class="tm-panel tm-boxpanel" aria-labelledby="boxHeading">${boxPanel("side")}</aside></div>${saveBar()}`;
  if (sheet.open) { sheetBody.innerHTML = boxPanel("sheet"); scanFx(sheetBody); }
  scanFx(app); // shiny backdrops (same as the Discord cards)
  document.getElementById("boxSheetTitle").textContent = `Add to your ${LABEL[state.active]}`;
  if (focusAfter) {
    const el = [focusAfter].flat().map((s) => document.querySelector(s)).find((x) => x && !x.disabled);
    (el ?? document.getElementById("teamHeading"))?.focus?.();
    focusAfter = null;
  } else if (searchFocus) {
    const el = document.getElementById(searchFocus.where);
    if (el) { el.focus(); el.setSelectionRange(searchFocus.pos, searchFocus.pos); }
  }
}

// ---------- events ----------
function onClick(e) {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const t = el.dataset.team;
  const i = Number(el.dataset.i);
  if (act === "tab") { state.active = t; render(); document.getElementById(`tab-${t}`)?.focus(); }
  else if (act === "move") move(t, i, Number(el.dataset.dir));
  else if (act === "remove") remove(t, i);
  else if (act === "add") add(state.active, { id: Number(el.dataset.id), variant: el.dataset.variant });
  else if (act === "copy") copyDisplay();
  else if (act === "mega") cycleMega(t, i);
  else if (act === "moves") {
    const s = team(t)[i];
    if (s) openMovesEditor({ userId, team: t, s, name: species(s.id).name, onSaved: () => render() });
  }
  else if (act === "discard") discard();
  else if (act === "save") save();
  else if (act === "show") { state.filter.show = el.dataset.show; render(); }
  else if (act === "openbox") openSheet();
  else if (act === "dismiss") dismissNotices();
}
function onInput(e) {
  const el = e.target;
  if (el.dataset?.act === "search") { state.filter.q = el.value; render(); }
  if (el.dataset?.act === "sort") { state.filter.sort = el.value; render(); }
}
app.addEventListener("click", onClick);
app.addEventListener("input", onInput);
app.addEventListener("change", onInput);
sheetBody.addEventListener("click", onClick);
sheetBody.addEventListener("input", onInput);
sheetBody.addEventListener("change", onInput);

// Arrow keys move between the two tabs (WAI-ARIA tabs pattern).
app.addEventListener("keydown", (e) => {
  if (e.target?.dataset?.act !== "tab" || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  state.active = state.active === "display" ? "battle" : "display";
  if (e.key === "Home") state.active = "display";
  if (e.key === "End") state.active = "battle";
  render();
  document.getElementById(`tab-${state.active}`)?.focus();
});

function openSheet() {
  if (!window.matchMedia("(max-width: 820px)").matches) {
    document.getElementById(`boxSearch-side`)?.focus();
    return;
  }
  sheetBody.innerHTML = boxPanel("sheet");
  sheet.showModal();
  scanFx(sheetBody);
}
document.getElementById("boxSheetClose").addEventListener("click", () => sheet.close());
sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });

// Drag and drop (mouse; on every device the ▲▼ / ✕ buttons and tapping a
// box Pokémon do the same):
//   • a team slot onto another slot → move it there
//   • a team slot onto the box      → take it off the team
//   • a box Pokémon onto a slot     → add it there (onto a filled slot of a
//     full team: replace that Pokémon); onto the team panel → add at the end
let drag = null; // { kind: "slot", t, i } | { kind: "box", s }
const clearDrop = () => document.querySelectorAll(".is-dropover, .is-dropbad, .is-dropremove").forEach((x) => x.classList.remove("is-dropover", "is-dropbad", "is-dropremove"));

app.addEventListener("dragstart", (e) => {
  const li = e.target.closest?.(".tm-slot[draggable]");
  const tile = e.target.closest?.(".tm-tile-btn[draggable]");
  if (li) {
    drag = { kind: "slot", t: li.dataset.team, i: Number(li.dataset.i) };
    li.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
  } else if (tile) {
    drag = { kind: "box", s: { id: Number(tile.dataset.id), variant: tile.dataset.variant } };
    tile.closest(".tm-tile")?.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "copyMove";
  } else return;
  e.dataTransfer.setData("text/plain", drag.kind);
  document.body.classList.add(`tm-dragging-${drag.kind}`);
});

/** Where a drop at this element would go, or null. */
function dropTarget(el) {
  if (!drag || !el?.closest) return null;
  const slot = el.closest(".tm-slot[data-team]");
  const panel = el.closest("#teamPanel");
  const box = el.closest(".tm-boxpanel");
  const t = state.active;
  if (drag.kind === "slot") {
    if (slot && slot.dataset.team === drag.t) return { type: "move", el: slot, to: Math.min(Number(slot.dataset.i), team(t).length - 1) };
    if (box) return { type: "remove", el: box };
    return null;
  }
  // From the box.
  if (slot) {
    const i = Number(slot.dataset.i);
    const full = team(t).length >= MAX;
    const replace = full && i < team(t).length;
    const onTeam = team(t).some((m) => m.id === drag.s.id && m.variant === drag.s.variant);
    const ok = onTeam || !blockReason(t, drag.s, { replaceAt: replace ? i : -1 });
    return { type: "add", el: slot, at: i, replace, ok };
  }
  if (panel) {
    const ok = !blockReason(t, drag.s);
    return { type: "add", el: panel.querySelector(".tm-slots") ?? panel, at: null, replace: false, ok };
  }
  return null;
}

document.addEventListener("dragover", (e) => {
  const d = dropTarget(e.target);
  clearDrop();
  if (!d) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = d.type === "add" ? (d.ok ? "copy" : "none") : "move";
  d.el.classList.add(d.type === "remove" ? "is-dropremove" : d.ok === false ? "is-dropbad" : "is-dropover");
});
document.addEventListener("drop", (e) => {
  const d = dropTarget(e.target);
  const from = drag;
  clearDrop();
  if (!d || !from) return;
  e.preventDefault();
  drag = null;
  if (d.type === "move") moveTo(from.t, from.i, d.to);
  else if (d.type === "remove") remove(from.t, from.i);
  else if (d.type === "add") add(state.active, from.s, { at: d.at, replace: d.replace });
});
document.addEventListener("dragend", () => {
  drag = null;
  clearDrop();
  document.body.classList.remove("tm-dragging-slot", "tm-dragging-box");
  document.querySelectorAll(".is-dragging").forEach((x) => x.classList.remove("is-dragging"));
});

// Unsaved changes: the browser's own prompt on close/reload, and an in-page
// dialog for the dashboard's own links.
window.addEventListener("beforeunload", (e) => {
  if (!anyDirty()) return;
  e.preventDefault();
  e.returnValue = "";
});
document.addEventListener("click", async (e) => {
  const a = e.target.closest?.("a.cc-nav-link");
  if (!a || !anyDirty() || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const leave = await confirmDialog({
    title: "Leave without saving?",
    message: "Your team changes aren’t saved yet.",
    okText: "Leave",
    cancelText: "Stay",
    tone: "error",
  });
  if (leave) {
    state.draft = clone(state.saved); // so beforeunload doesn't ask again
    window.location.assign(a.href);
  }
});

// ---------- load ----------
async function load() {
  if (!userId) { app.innerHTML = ""; return; }
  try {
    const [pdRes, userRes] = await Promise.all([
      fetch("/public/pokemonData.json", { credentials: "same-origin" }),
      fetch(`/api/user-pokemon?id=${encodeURIComponent(userId)}`, { credentials: "same-origin" }),
    ]);
    if (userRes.status === 403) { app.innerHTML = ""; showExpired(); return; }
    if (!pdRes.ok || !userRes.ok) throw new Error(`Couldn’t load your teams (${userRes.status}).`);
    const data = await pdRes.json();
    for (const [id, p] of Object.entries(data)) {
      p.storedName = p.name;
      p.name = displaySpeciesName(id, p.name);
    }
    state.data = data;
    const u = await userRes.json();
    state.pokemon = u.pokemon ?? {};
    state.levels = u.levels ?? {};
    state.powers = u.powers ?? {};
    const norm = (list) => (Array.isArray(list) ? list.map((s) => ({ id: Number(s.id), variant: s.variant === "shiny" ? "shiny" : "normal", ...(s.mega ? { mega: s.mega } : {}) })) : null);
    state.saved = { display: norm(u.currentTeam) ?? [], battle: norm(u.battleTeam) };
    state.notices = Array.isArray(u.notices) ? u.notices.filter((n) => n.kind === "battle_team_trim") : [];
    state.draft = clone(state.saved);
    const want = new URLSearchParams(location.search).get("team");
    state.active = want === "battle" || want === "display" ? want : state.notices.length ? "battle" : "display";
  } catch (err) {
    app.innerHTML = "";
    showBanner(err?.message || "Couldn’t load your teams. Please try again.", { title: "Couldn’t load your teams" });
    return;
  }
  // Mega sprites only while Mega Evolution is switched on server-side.
  try {
    const m = await fetch(`/api/mega?id=${encodeURIComponent(userId)}`, { credentials: "same-origin" });
    const md = m.ok ? await m.json() : null;
    state.megaOn = !!md?.enabled;
    state.megaCards = state.megaOn && Array.isArray(md.cards) ? md.cards : [];
  } catch { state.megaOn = false; }
  render();
}

load();
