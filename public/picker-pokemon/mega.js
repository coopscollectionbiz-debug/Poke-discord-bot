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
let statusText = "";

/** Messages for the player, shown in the Mega section and announced politely. */
function notify(msg) {
  statusText = msg;
  const el = section?.querySelector(".mega-status");
  if (el) el.textContent = msg;
}

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
  return { enabled: true, onModeChange, render, refresh, megaSprite, megaSlotState, isMegaUnlockedOn };
}

/**
 * Sprite for a Team slot that carries a Mega form (used by Team previews):
 * the Mega's own sprite only when that slot battles as the Mega, so the
 * dashboard shows the same form as /showteam, the trainer card and battles.
 */
export function megaSprite(slot) {
  const c = cardForSlot(slot);
  return c && c.battleStatus?.state === "ready" ? c.sprite : null;
}

function onModeChange(mode) {
  // Shown in the Collection's Browse mode (and the old Change Team mode).
  if (section) section.style.display = mode === "team" || mode === "browse" ? "block" : "none";
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

function cardForSlot(slot) {
  return slot ? state.cards.find((x) => x.formId === slot.mega && x.line === `${slot.id}:${slot.variant}`) ?? null : null;
}

/** True when `formId` is unlocked and usable on this Pokémon's normal or shiny line. */
export function isMegaUnlockedOn(id, variant, formId) {
  return state.cards.some((c) => c.formId === formId && c.line === `${Number(id)}:${variant}` && c.state === "active" && c.teamSelectable);
}

/**
 * "ready" when this Team slot battles (and is shown everywhere) as its Mega;
 * anything else means it battles and shows as its base form.
 */
export function megaSlotState(slot) {
  return cardForSlot(slot)?.battleStatus?.state ?? "locked";
}

function progressHTML() {
  const p = state.progress;
  if (!p) return "";
  return `<p class="mega-progress"><span class="mega-progress-count"><b>${p.unlocked}</b> / ${p.available}</span>
    <span class="mega-progress-label">Mega forms unlocked${p.shiny ? ` · ${p.shiny} shiny` : ""}<small>Separate from your Pokédex</small></span></p>`;
}

function teamLineHTML() {
  const slot = teamMegaSlot();
  const c = cardForSlot(slot);
  if (!c) return "";
  if (c.battleStatus?.state === "ready") {
    return `<p class="mega-team ready">On your Team: <b>${esc(c.name)}</b> · Battle-ready</p>`;
  }
  return `<p class="mega-team warn"><b>${esc(c.name)}</b> is on your Team but battles as ${esc(c.baseSpecies)} for now. ${esc(c.battleStatus?.detail ?? "")}</p>`;
}

function render() {
  if (!section) return;
  const cards = state.cards;
  const unlocked = cards.filter((c) => c.unlocked);
  const locked = cards.filter((c) => c.state === "locked");
  section.innerHTML = `
    <div class="mega-head">
      <div class="mega-title">
        <h2><span class="mega-mark" aria-hidden="true">MEGA</span> Mega Evolutions</h2>
        ${progressHTML()}
      </div>
      <p class="mega-sub">Mega forms of Pokémon you own. A Mega shares its Pokémon's Level and Team slot, and one Mega can be on your Team.</p>
      ${teamLineHTML()}
      <p class="mega-status" role="status" aria-live="polite">${esc(statusText)}</p>
      ${state.stones.length ? `<p class="mega-stones">💎 ${state.stones.map((s) => `${esc(s.name)} ×${s.quantity}`).join(" · ")}</p>` : ""}
    </div>
    ${unlocked.length ? `<h3 class="mega-h3">Unlocked</h3><div class="mega-grid">${unlocked.map(cardHTML).join("")}</div>` : `<p class="mega-empty">No Mega forms unlocked yet.</p>`}
    ${locked.length ? `<details class="mega-locked"${unlocked.length ? "" : " open"}><summary>Unlockable Megas for your Pokémon (${locked.length})</summary><div class="mega-grid">${locked.map(cardHTML).join("")}</div></details>` : ""}
  `;
  section.querySelectorAll("[data-action]").forEach((btn) => btn.addEventListener("click", () => onAction(btn.dataset.action, btn.dataset.card)));
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

// The ability, and honestly whether it does anything: an unconfirmed ability
// (Legends: Z-A Megas) is never described as working.
function abilityLine(c) {
  const note = !c.ability.verified ? "not confirmed yet"
    : c.ability.category === "no-effect" ? "no effect in Coop battles" : "";
  return `<p class="mega-ability">Ability <b>${esc(c.ability.name)}</b>${note ? ` <span class="mega-tag${c.ability.verified ? "" : " warn"}">${note}</span>` : ""}</p>`;
}

function battleLine(c) {
  const bs = c.battleStatus ?? { state: "locked", label: "Locked", detail: "" };
  return `<p class="mega-battle ${esc(bs.state)}"><span class="mega-dot" aria-hidden="true"></span>${esc(bs.label)}</p>
    ${bs.detail ? `<p class="mega-battle-detail">${esc(bs.detail)}</p>` : ""}`;
}

function cardHTML(c) {
  const shiny = c.variant === "shiny";
  const badge = { active: "Unlocked", dormant: "Not owned", locked: "Locked", blocked: "Unavailable" }[c.state];
  const variantLabel = c.variantChoice ? Object.values(c.variantChoice)[0] : "";
  const slot = teamMegaSlot();
  // The Team being edited on this page (not the saved one), so Replace/Remove update at once.
  const onTeam = !!slot && slot.mega === c.formId && `${slot.id}:${slot.variant}` === c.line;
  const buttons = [];
  if (c.state === "active") {
    // Teams are edited on the Teams page; without a team editor here
    // (ctx.setTeam) the card links there instead of editing a Team.
    if (c.teamSelectable && !ctx.setTeam) buttons.push(onTeam
      ? `<span class="mega-btn on" aria-label="On your Display team">✓ On Team</span>`
      : `<a class="mega-btn" href="/public/teams/?id=${encodeURIComponent(ctx.userId)}">Use on a team</a>`);
    else if (c.teamSelectable) buttons.push(onTeam
      ? `<button type="button" class="mega-btn on" data-action="team-remove" data-card="${esc(c.cardId)}" aria-pressed="true">✓ On Team</button>`
      : `<button type="button" class="mega-btn" data-action="team-add" data-card="${esc(c.cardId)}">Add to Team</button>`);
    buttons.push(c.preferred
      ? `<button type="button" class="mega-btn ghost" data-action="unprefer" data-card="${esc(c.cardId)}" aria-pressed="true">★ Preferred</button>`
      : `<button type="button" class="mega-btn ghost" data-action="prefer" data-card="${esc(c.cardId)}">☆ Set preferred</button>`);
  }
  if (c.state === "locked") {
    buttons.push(c.canUnlock
      ? `<button type="button" class="mega-btn unlock" data-action="unlock" data-card="${esc(c.cardId)}">Use ${esc(c.requiredStone?.name)}</button>`
      : `<span class="mega-need">Needs ${esc(c.requiredStone?.name)}${c.requiredStone ? ` (you have ${c.requiredStone.have})` : ""}</span>`);
  }
  return `
  <article class="mega-card ${c.state}${shiny ? " shiny" : ""}${onTeam ? " on-team" : ""}" data-card="${esc(c.cardId)}" aria-label="${esc(c.name)}${shiny ? " (shiny)" : ""}, ${esc(badge)}">
    <div class="mega-card-top">
      <span class="mega-badge ${c.state}">${badge}</span>
      ${shiny ? `<span class="mega-shiny" title="Shiny">✨</span>` : ""}
    </div>
    <img class="mega-sprite${c.state === "locked" || c.state === "dormant" ? " dim" : ""}" src="${esc(c.sprite)}" alt="${esc(c.name)}${shiny ? " (shiny)" : ""}" width="96" height="96" loading="lazy">
    <h4>${esc(c.name)}</h4>
    <p class="mega-base">Mega form of your ${shiny ? "shiny " : ""}${esc(c.baseSpecies)}${variantLabel && c.state === "locked" ? ` · ${esc(variantLabel)}` : ""}</p>
    <p class="mega-level">${c.level ? `Lv ${c.level} <small>shared with ${esc(c.baseSpecies)}</small>` : "No copies owned. The unlock is kept."}</p>
    <div class="mega-types">${typeIcons(c)}</div>
    ${battleLine(c)}
    ${abilityLine(c)}
    <details class="mega-stats"><summary>Stats vs ${esc(c.baseSpecies)} · BST ${c.bst}</summary>${statRows(c)}</details>
    <p class="mega-stone">💎 ${c.requiredStone ? esc(c.requiredStone.name) : "No Mega Stone"}</p>
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
          notify(`✅ ${res.name} unlocked!${res.note ? ` ${res.note}` : ""}`);
        } catch (err) {
          overlay?.remove?.();
          notify(`❌ ${err.message}`);
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
      notify(`❌ ${err.message}`);
    }
    await refresh();
  });
}

function addToTeam(c) {
  const [sid, variant] = c.line.split(":");
  const id = Number(sid);
  const team = ctx.getTeam().map((s) => ({ ...s }));
  const otherMega = team.find((s) => s.mega && !(s.id === id));
  const place = (t) => {
    // A Pokémon and its own Mega share one slot (dashboard rule: one slot per Pokémon).
    const idx = t.findIndex((s) => Number(s.id) === id);
    const slot = { id, variant, mega: c.formId };
    if (idx >= 0) t[idx] = slot;
    else {
      if (t.length >= 6) { notify("⚠️ Your team is full (6 Pokémon). Remove one first."); return; }
      t.push(slot);
    }
    ctx.setTeam(t);
    notify(`${c.name} is on your team. Save the team to keep it.`);
    render();
  };
  if (!otherMega) return place(team);
  // Only one Mega per team: ask in the page's own dialog, not a browser dialog.
  ctx.createConfirmModal({
    title: "Only one Mega per team",
    confirmLabel: "Replace",
    message: `Replace the Mega currently on your team with its base form and add ${esc(c.name)}?`,
    onConfirm: (overlay) => {
      overlay?.remove?.();
      place(team.map((s) => (s === otherMega ? { id: s.id, variant: s.variant } : s)));
    },
  });
}

function removeFromTeam(c) {
  const [sid] = c.line.split(":");
  ctx.setTeam(ctx.getTeam().filter((s) => !(Number(s.id) === Number(sid) && s.mega === c.formId)));
  render();
}
