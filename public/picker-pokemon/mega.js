/* ===========================================================
   Coop's Collection — Mega Evolution cards (Phase M1)
   ===========================================================
   Loaded by script.js. Asks GET /api/mega first: while Mega Evolution is
   switched off the server answers { enabled: false } and this module adds
   NOTHING to the page (no section, no stylesheet, no listeners).

   The server decides everything (unlock state, eligibility, stones); this
   file only renders what /api/mega returns and sends requests:
     POST /api/mega/unlock     { id, line, stoneId, formId, choice?, requestId }
     POST /api/mega/preferred  { id, line, formId|null, requestId }
   Team changes go through the normal Save Team flow (set-pokemon-team),
   which re-validates the one-Mega and base/Mega rules server-side.
=========================================================== */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STAT_LABELS = [["hp", "HP"], ["atk", "Atk"], ["def", "Def"], ["spa", "SpA"], ["spd", "SpD"], ["spe", "Spe"]];
const reqId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

let ctx = null;
let state = { enabled: false, cards: [], stones: [], capabilities: {} };
let section = null;

export async function initMega(context) {
  ctx = context;
  let data;
  try {
    data = await ctx.apiJSON(`/api/mega?${new URLSearchParams({ id: ctx.userId })}`);
  } catch {
    return { enabled: false };
  }
  if (!data?.enabled) return { enabled: false };
  state = data;
  injectStyles();
  section = document.createElement("section");
  section.id = "megaSection";
  section.setAttribute("aria-label", "Mega Evolutions");
  const grid = document.getElementById("pokemonGrid");
  grid?.parentNode?.insertBefore(section, grid);
  render();
  onModeChange(ctx.getMode());
  return { enabled: true, onModeChange, render, refresh, megaSprite };
}

/** Sprite for a team slot that carries a Mega form (used by team previews). */
export function megaSprite(slot) {
  const c = state.cards.find((x) => x.formId === slot.mega && x.line === `${slot.id}:${slot.variant}`);
  return c?.sprite ?? null;
}

function onModeChange(mode) {
  if (section) section.style.display = mode === "team" ? "block" : "none";
}

async function refresh() {
  try {
    const data = await ctx.apiJSON(`/api/mega?${new URLSearchParams({ id: ctx.userId })}`);
    if (data?.enabled) state = data;
  } catch { /* keep the last good view */ }
  render();
}

function injectStyles() {
  if (document.getElementById("megaStyles")) return;
  const link = document.createElement("link");
  link.id = "megaStyles";
  link.rel = "stylesheet";
  link.href = "/public/picker-pokemon/mega.css";
  document.head.appendChild(link);
}

// -----------------------------------------------------------
// Rendering
// -----------------------------------------------------------
function teamMegaSlot() {
  return ctx.getTeam().find((s) => s.mega) ?? null;
}

function render() {
  if (!section) return;
  const cards = state.cards;
  const unlocked = cards.filter((c) => c.unlocked);
  const locked = cards.filter((c) => c.state === "locked");
  const onTeam = teamMegaSlot();
  section.innerHTML = `
    <div class="mega-head">
      <h2>🧬 Mega Evolutions</h2>
      <p class="mega-sub">Battle forms of Pokémon you own. They share their Pokémon's Level, and one Mega can join your team.
        ${state.capabilities?.battle ? "" : `<span class="mega-note">Mega battles arrive in a later update; for now a Mega on your team battles as its base form.</span>`}</p>
      ${state.stones.length ? `<p class="mega-stones">💎 ${state.stones.map((s) => `${esc(s.name)} ×${s.quantity}`).join(" · ")}</p>` : ""}
    </div>
    ${unlocked.length ? `<h3 class="mega-h3">Unlocked</h3><div class="mega-grid">${unlocked.map(cardHTML).join("")}</div>` : `<p class="mega-empty">No Mega forms unlocked yet.</p>`}
    ${locked.length ? `<details class="mega-locked"${unlocked.length ? "" : " open"}><summary>Unlockable Megas for your Pokémon (${locked.length})</summary><div class="mega-grid">${locked.map(cardHTML).join("")}</div></details>` : ""}
  `;
  section.querySelectorAll("[data-action]").forEach((btn) => btn.addEventListener("click", () => onAction(btn.dataset.action, btn.dataset.card)));
  void onTeam;
}

function typeIcons(c) {
  return c.typeIds.map((t, i) => `<img class="mega-type" src="/public/sprites/types/${t}.png" alt="${esc(c.types[i])}" title="${esc(c.types[i])}">`).join("");
}

function statRows(c) {
  return STAT_LABELS.map(([k, label]) => {
    const v = c.baseStats[k], b = c.base.baseStats[k], d = v - b;
    return `<div class="mega-stat"><span>${label}</span><span class="mega-bar"><i style="width:${Math.min(100, Math.round((v / 200) * 100))}%"></i></span><b>${v}</b><em class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "+" + d : d < 0 ? d : ""}</em></div>`;
  }).join("");
}

function abilityLine(c) {
  const status = c.ability.category === "no-effect" ? "No effect in Coop battles"
    : c.battle.battleReady ? "Works in Coop battles" : "Not active in battles yet";
  return `<p class="mega-ability"><b>${esc(c.ability.name)}</b> <span class="mega-tag">${status}</span>${c.ability.verified ? "" : ` <span class="mega-tag warn" title="Legends: Z-A has no abilities in play; this comes from community battle data.">unverified</span>`}</p>`;
}

function cardHTML(c) {
  const shiny = c.variant === "shiny";
  const badge = { active: "Unlocked", dormant: "Not owned", locked: "Locked", blocked: "Unavailable" }[c.state];
  const variantLabel = c.variantChoice ? Object.values(c.variantChoice)[0] : "";
  const onTeam = c.onTeam || (teamMegaSlot()?.mega === c.formId && `${teamMegaSlot().id}:${teamMegaSlot().variant}` === c.line);
  const buttons = [];
  if (c.state === "active") {
    if (c.teamSelectable) buttons.push(onTeam
      ? `<button class="mega-btn on" data-action="team-remove" data-card="${esc(c.cardId)}">✓ On team (remove)</button>`
      : `<button class="mega-btn" data-action="team-add" data-card="${esc(c.cardId)}">Add to team</button>`);
    buttons.push(c.preferred
      ? `<button class="mega-btn ghost" data-action="unprefer" data-card="${esc(c.cardId)}">★ Preferred</button>`
      : `<button class="mega-btn ghost" data-action="prefer" data-card="${esc(c.cardId)}">☆ Set preferred</button>`);
  }
  if (c.state === "locked") {
    buttons.push(c.canUnlock
      ? `<button class="mega-btn unlock" data-action="unlock" data-card="${esc(c.cardId)}">Use ${esc(c.requiredStone?.name)}</button>`
      : `<span class="mega-need">Needs ${esc(c.requiredStone?.name)}${c.requiredStone ? ` (you have ${c.requiredStone.have})` : ""}</span>`);
  }
  return `
  <article class="mega-card ${c.state}${shiny ? " shiny" : ""}${onTeam ? " on-team" : ""}" data-card="${esc(c.cardId)}">
    <span class="mega-badge ${c.state}">${badge}</span>
    <img class="mega-sprite${c.state === "locked" || c.state === "dormant" ? " dim" : ""}" src="${esc(c.sprite)}" alt="${esc(c.name)}" loading="lazy">
    <h4>${esc(c.name)}${shiny ? " ✨" : ""}</h4>
    <p class="mega-base">Battle form of your ${shiny ? "shiny " : ""}${esc(c.baseSpecies)}${variantLabel && c.state === "locked" ? ` · ${esc(variantLabel)}` : ""}</p>
    <p class="mega-level">${c.level ? `Lv ${c.level} <small>(shared)</small>` : "No copies owned — unlock kept"}</p>
    <div class="mega-types">${typeIcons(c)}</div>
    ${abilityLine(c)}
    <details class="mega-stats"><summary>Stats vs ${esc(c.baseSpecies)} · BST ${c.bst}</summary>${statRows(c)}</details>
    <p class="mega-stone">💎 ${c.requiredStone ? esc(c.requiredStone.name) : "—"}</p>
    <div class="mega-actions">${buttons.join("")}</div>
  </article>`;
}

// -----------------------------------------------------------
// Actions
// -----------------------------------------------------------
function onAction(action, cardId) {
  const c = state.cards.find((x) => x.cardId === cardId);
  if (!c) return;
  if (action === "unlock") return confirmUnlock(c);
  if (action === "prefer" || action === "unprefer") return setPreferred(c, action === "prefer" ? c.formId : null);
  if (action === "team-add") return addToTeam(c);
  if (action === "team-remove") return removeFromTeam(c);
}

function confirmUnlock(c) {
  const permanent = c.variantChoice
    ? `<br><br><span class="mega-warn">This sets your ${c.variant === "shiny" ? "shiny " : ""}${esc(c.baseSpecies)}'s ${esc(Object.keys(c.variantChoice)[0])} to <b>${esc(Object.values(c.variantChoice)[0])}</b> for Mega Evolution. It can't be changed later.</span>`
    : "";
  ctx.createConfirmModal({
    title: `💎 Unlock ${esc(c.name)}?`,
    confirmLabel: `Use ${esc(c.requiredStone.name)}`,
    message: `
      <img src="${esc(c.sprite)}" alt="" style="width:96px;height:96px;image-rendering:pixelated;"><br>
      Use <b>1× ${esc(c.requiredStone.name)}</b> on your ${c.variant === "shiny" ? "shiny " : ""}${esc(c.baseSpecies)}.<br><br>
      The stone is used up and ${esc(c.name)} stays unlocked for this ${c.variant === "shiny" ? "shiny " : ""}${esc(c.baseSpecies)} permanently. Mega Evolving in battle never uses anything.
      ${permanent}`,
    onConfirm: async (overlay) => {
      await ctx.withActionLock(async () => {
        try {
          const res = await ctx.apiJSON("/api/mega/unlock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: ctx.userId, line: c.line, stoneId: c.requiredStone.id, formId: c.formId, ...(c.variantChoice && { choice: c.variantChoice }), requestId: reqId() }),
          });
          overlay?.remove?.();
          await ctx.refreshUser();
          await refresh();
          ctx.notify(`✅ ${res.name} unlocked!${res.note ? ` ${res.note}` : ""}`);
        } catch (err) {
          overlay?.remove?.();
          ctx.notify(`❌ ${err.message}`);
          await refresh();
        }
      });
    },
  });
}

async function setPreferred(c, formId) {
  await ctx.withActionLock(async () => {
    try {
      await ctx.apiJSON("/api/mega/preferred", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ctx.userId, line: c.line, formId, requestId: reqId() }),
      });
    } catch (err) {
      ctx.notify(`❌ ${err.message}`);
    }
    await refresh();
  });
}

function addToTeam(c) {
  const [sid, variant] = c.line.split(":");
  const id = Number(sid);
  let team = ctx.getTeam().map((s) => ({ ...s }));
  const otherMega = team.find((s) => s.mega && !(s.id === id));
  if (otherMega) {
    if (!confirm("Only one Mega can be on your team. Replace the current Mega with its base form?")) return;
    team = team.map((s) => (s === otherMega ? { id: s.id, variant: s.variant } : s));
  }
  // A Pokémon and its own Mega share one slot (dashboard rule: one slot per Pokémon).
  const idx = team.findIndex((s) => Number(s.id) === id);
  const slot = { id, variant, mega: c.formId };
  if (idx >= 0) team[idx] = slot;
  else {
    if (team.length >= 6) { alert("⚠️ Team is full! Maximum 6 Pokémon."); return; }
    team.push(slot);
  }
  ctx.setTeam(team);
  render();
}

function removeFromTeam(c) {
  const [sid] = c.line.split(":");
  ctx.setTeam(ctx.getTeam().filter((s) => !(Number(s.id) === Number(sid) && s.mega === c.formId)));
  render();
}
