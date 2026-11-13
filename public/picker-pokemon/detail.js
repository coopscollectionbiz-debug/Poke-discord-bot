// ==========================================================
// public/picker-pokemon/detail.js — the Pokémon details drawer (desktop) /
// sheet (phone), opened from the Collection and from the Teams page.
// Data: GET /api/pokemon/detail (read-only, same numbers as the Discord
// cards). Nothing here writes on its own: buttons call the opening page.
//
//   openDetail(speciesId, ctx, opts)
//     ctx  — userId, apiJSON, and the page's actions:
//            Collection: evolve(id), donate(id, variant), convert(id), canEvolve(id)
//            Any page:   actionsHTML(d, variant) → HTML for the button row
//                        (replaces the Collection buttons) and
//                        onAction(act, d, variant) for its data-act buttons
//     opts — variant:   the copy to open on ("normal" | "shiny")
//            level:     "real" | "50": which Level the stats start at
//                       (a Lv [real] / Lv 50 toggle switches them)
//            slotsFor:  variant → { display, battle, unsaved } to show the
//                       page's current (maybe unsaved) team slots instead
//                       of the saved ones
//            megaName:  set when the slot battles as a Mega form
// ==========================================================

import { scanFx } from "/public/shared/spriteFx.js";
import { pageHref } from "/public/shared/shell.js";
import { openTeachDialog } from "/public/shared/teachTm.js";
import { moveMeta } from "/public/shared/moveMeta.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dex = (id) => `#${String(id).padStart(4, "0")}`;
const STAT_LABELS = [["hp", "HP"], ["atk", "Atk"], ["def", "Def"], ["spa", "SpA"], ["spd", "SpD"], ["spe", "Spe"]];
const sprite = (id, variant) => `/public/sprites/pokemon/${variant === "shiny" ? "shiny" : "normal"}/${id}.gif`;
const RANKED_LEVEL = 50;

let dialog = null;
let lastFocus = null;
let shownVariant = "normal";
let statLevel = "real"; // "real" | "50"

function ensureDialog() {
  if (!document.getElementById("detailStyles")) {
    const link = document.createElement("link");
    link.id = "detailStyles";
    link.rel = "stylesheet";
    link.href = "/public/picker-pokemon/detail.css";
    document.head.append(link);
  }
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "detailDialog";
  dialog.className = "cc-detail";
  dialog.setAttribute("aria-labelledby", "detailTitle");
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { lastFocus?.focus?.({ preventScroll: true }); });
  document.body.append(dialog);
  return dialog;
}

const typeChips = (types) => types.map((t) => `<span class="cc-type" data-type="${esc(String(t).toLowerCase())}">${esc(t)}</span>`).join("");

function statBars(stats) {
  const max = 220;
  return STAT_LABELS.map(([k, label]) => `<div class="dt-stat"><span>${label}</span><b>${stats[k]}</b><span class="dt-bar" aria-hidden="true"><i style="width:${Math.min(100, (stats[k] / max) * 100)}%"></i></span></div>`).join("");
}

// Trained copies (TM system): untrained count + one row per trained copy with its TM moves.
function trainedRows(copies) {
  const rows = [];
  for (const [v, c] of Object.entries(copies)) {
    if (!c.trained?.length) continue;
    rows.push(`<p class="dt-muted" style="margin:6px 0 2px">${v === "shiny" ? "✨ Shiny" : "Normal"}: untrained ×${c.plain} · trained ×${c.trained.length}</p>`);
    for (const t of c.trained) {
      const where = [t.teams.display ? `Casual slot ${t.teams.display}` : "", t.teams.battle ? `Ranked slot ${t.teams.battle}` : ""].filter(Boolean).join(" · ") || "Not on a team";
      rows.push(`<div class="dt-move"><span>★ Trained · ${t.tmMoves.map((m) => esc(m.name)).join(", ")}</span><small class="dt-muted">${where}</small></div>`);
    }
  }
  return rows.join("");
}

/** "Casual slot 3 · Ranked slot 1 (unsaved)" for one copy. */
function slotLine(copy, v, opts) {
  const s = opts.slotsFor?.(v) ?? { display: copy.teams.display, battle: copy.teams.battle, unsaved: false };
  const parts = [s.display ? `Casual slot ${s.display}` : "", s.battle ? `Ranked slot ${s.battle}` : ""].filter(Boolean);
  return parts.length ? `${parts.join(" · ")}${s.unsaved ? ' <span class="dt-unsaved">(unsaved)</span>' : ""}` : "Not on a team";
}

function statsSection(c) {
  const at50 = statLevel === "50" && c.stats50;
  const toggle = c.level !== RANKED_LEVEL && c.stats50
    ? `<div class="dt-lvseg" role="group" aria-label="Stats at">
        <button type="button" data-level="real" aria-pressed="${!at50}">Lv ${c.level}</button>
        <button type="button" data-level="50" aria-pressed="${!!at50}">Lv 50</button>
      </div>`
    : "";
  const title = at50 ? `Stats in ranked (Lv 50)` : `Stats at Lv ${c.level}`;
  const power = at50 ? `Power at Lv 50: ${c.power50?.toLocaleString("en-US") ?? "—"} · yours Lv ${c.level}` : `Power ${c.power.toLocaleString("en-US")} · at Lv 50 in ranked: ${c.power50?.toLocaleString("en-US") ?? "—"}`;
  return `<section class="dt-sec"><div class="dt-sec-head"><h3>${title}</h3>${toggle}</div>${statBars(at50 ? c.stats50 : c.stats)}
    <p class="dt-muted">${power}</p></section>`;
}

function collectionActions(d, ctx, opts) {
  const copies = d.copies ?? {};
  const c = copies[shownVariant];
  const onTeam = !!(c && (c.teams.display || c.teams.battle));
  return `${ctx.canEvolve?.(d.id) ? `<button type="button" class="cc-btn" data-act="evolve">Evolve</button>` : ""}
    <button type="button" class="cc-btn" data-act="donate"${onTeam ? ' disabled title="On a team: remove it first"' : ""}>Donate ${shownVariant === "shiny" ? "shiny" : ""}</button>
    ${copies.normal && !copies.shiny ? `<button type="button" class="cc-btn cc-btn--gold" data-act="convert">✨ Convert</button>` : ""}
    <a class="cc-btn cc-btn--primary" href="${pageHref("/public/teams/", ctx.userId)}">Use on a team</a>`;
}

function render(d, ctx, opts) {
  const copies = d.copies ?? {};
  const owned = Object.keys(copies);
  if (!owned.includes(shownVariant)) shownVariant = owned[0] ?? "normal";
  const c = copies[shownVariant];
  const variantToggle = owned.length > 1
    ? `<div class="dt-seg" role="group" aria-label="Copy">${owned.map((v) => `<button type="button" data-variant="${v}" aria-pressed="${v === shownVariant}">${v === "shiny" ? "✨ Shiny" : "Normal"}</button>`).join("")}</div>`
    : "";
  const evo = [...d.evolvesFrom.map((e) => ({ ...e, rel: "from" })), { id: d.id, name: d.name, rel: "this" }, ...d.evolvesTo.map((e) => ({ ...e, rel: "to" }))];
  const art = owned.length ? sprite(d.id, shownVariant) : `/public/sprites/pokemon/grayscale/${d.id}.gif`;
  const actions = owned.length ? (ctx.actionsHTML ? ctx.actionsHTML(d, shownVariant) : collectionActions(d, ctx, opts)) : "";
  dialog.innerHTML = `
    <div class="dt-head">
      <div>
        <p class="cc-eyebrow">${dex(d.id)} · ${esc(d.region ?? "")}${d.generation ? ` · Gen ${d.generation}` : ""}</p>
        <h2 id="detailTitle">${esc(d.name)}</h2>
        <div class="dt-chips">${typeChips(d.types)}<span class="cc-tier" data-tier="${esc(d.tier)}">${esc(d.tier)}</span></div>
      </div>
      <button type="button" class="dt-close" aria-label="Close">✕</button>
    </div>
    <div class="dt-stage${shownVariant === "shiny" && owned.length ? " is-shiny" : ""}"${shownVariant === "shiny" && owned.length ? ` data-fx="shiny" data-fx-seed="${d.id}"` : ""}>
      ${variantToggle}
      <img src="${art}" alt="${esc(d.name)}${shownVariant === "shiny" ? " (shiny)" : ""}" class="${owned.length ? "" : "silhouette"}" onerror="this.onerror=null;this.src='/public/sprites/items/pokeball.png'">
    </div>
    ${opts.megaName ? `<p class="dt-note">On this team it battles as <b>${esc(opts.megaName)}</b>, whose stats differ from these.</p>` : ""}
    ${d.flavor ? `<p class="dt-flavor">${esc(d.flavor)}</p>` : ""}
    <section class="dt-sec"><h3>Your copies</h3>
      ${owned.length ? owned.map((v) => `<div class="dt-copy"><img src="${sprite(d.id, v)}" alt=""><span>${v === "shiny" ? "✨ Shiny" : "Normal"} ×${copies[v].count} · <b>Lv ${copies[v].level}</b><br><small>${slotLine(copies[v], v, opts)}</small></span></div>`).join("") : `<p class="dt-muted">Not caught yet.</p>`}
      ${trainedRows(copies)}
      ${d.tm?.enabled && c ? `<button type="button" class="cc-btn" data-act="teach">Teach a TM${owned.length > 1 ? ` (${shownVariant === "shiny" ? "shiny" : "normal"})` : ""}</button>` : ""}
    </section>
    ${d.megaForms?.length ? `<section class="dt-sec"><h3>Mega forms</h3><div class="dt-forms">${d.megaForms.map((f) => `<div class="dt-form"><img src="/public/sprites/pokemon/mega/${shownVariant === "shiny" ? "shiny" : "normal"}/${esc(f.id)}.gif" alt=""><b>${esc(f.name)}</b><small>${f.unlocked[shownVariant] ? "Unlocked" : "Locked"}</small></div>`).join("")}</div><p class="dt-muted">Forms of ${esc(d.name)}: they never count as Pokédex entries.</p></section>` : ""}
    ${c ? `${statsSection(c)}
      ${["display", "battle"].map((team) => {
        const set = c.movesets?.[team];
        const list = set ?? c.moves;
        return `<section class="dt-sec"><h3>${team === "battle" ? "Ranked team moves" : "Casual team moves"}${set ? "" : " · automatic"}</h3><div class="dt-moves">${list.map((m) => `<div class="dt-move"><span>${esc(m.name)}${moveMeta(m)}</span></div>`).join("")}</div></section>`;
      }).join("")}
      <section class="dt-sec"><p class="dt-muted" style="margin:0">${c.nextMoves.length ? `Learns next: ${c.nextMoves.map((m) => esc(m.name)).join(", ")}. ` : ""}${ctx.actionsHTML ? "Each team keeps its own moves." : `Change moves on the <a href="${pageHref("/public/teams/", ctx.userId)}">Teams page</a> (each team keeps its own).`}</p></section>`
    : d.baseStats ? `<section class="dt-sec"><h3>Base stats</h3>${statBars(d.baseStats)}<p class="dt-muted">Total ${d.baseTotal}</p></section>` : ""}
    ${evo.length > 1 ? `<section class="dt-sec"><h3>Evolution</h3><div class="dt-evo">${evo.map((e) => `<button type="button" class="dt-evo-step${e.rel === "this" ? " is-this" : ""}" data-species="${e.id}"${e.rel === "this" ? ' aria-current="true"' : ""}><img src="/public/sprites/pokemon/normal/${e.id}.gif" alt="">${esc(e.name)}</button>`).join('<span aria-hidden="true">›</span>')}</div></section>` : ""}
    ${actions ? `<section class="dt-sec dt-actions">${actions}</section>` : ""}`;
  scanFx(dialog);
}

async function load(id, ctx, opts) {
  ensureDialog();
  dialog.innerHTML = `<p class="dt-muted" style="padding:24px">Loading…</p>`;
  if (!dialog.open) dialog.showModal();
  try {
    const d = await ctx.apiJSON(`/api/pokemon/detail?${new URLSearchParams({ id: ctx.userId, species: id })}`);
    const owned = Object.keys(d.copies ?? {});
    shownVariant = opts.variant && owned.includes(opts.variant) ? opts.variant : owned.includes("normal") ? "normal" : owned[0] ?? "normal";
    statLevel = opts.level === "50" ? "50" : "real";
    render(d, ctx, opts);
    dialog.onclick = (e) => {
      if (e.target === dialog) return dialog.close();
      const b = e.target.closest("button, [data-act]");
      if (!b) return;
      if (b.classList.contains("dt-close")) return dialog.close();
      if (b.dataset.variant) { shownVariant = b.dataset.variant; render(d, ctx, opts); return dialog.querySelector(`[data-variant="${shownVariant}"]`)?.focus(); }
      if (b.dataset.level) { statLevel = b.dataset.level; render(d, ctx, opts); return dialog.querySelector(`[data-level="${statLevel}"]`)?.focus(); }
      // Another species in the chain: its own details, no page-specific slot or Mega context.
      if (b.dataset.species && b.dataset.species !== String(d.id)) return load(Number(b.dataset.species), ctx, { level: opts.level });
      const act = b.dataset.act;
      if (!act || b.disabled || b.getAttribute("aria-disabled") === "true") return;
      if (b.tagName === "A") return; // plain links navigate (pages guard unsaved changes themselves)
      dialog.close();
      if (act === "teach") return openTeachDialog({ userId: ctx.userId, speciesId: d.id, variant: shownVariant, name: d.name, onDone: () => load(d.id, ctx, opts) });
      if (ctx.onAction) return ctx.onAction(act, d, shownVariant);
      if (act === "evolve") ctx.evolve(d.id);
      else if (act === "donate") ctx.donate(d.id, shownVariant);
      else if (act === "convert") ctx.convert(d.id);
    };
    dialog.querySelector(".dt-close")?.focus();
  } catch (err) {
    dialog.innerHTML = `<div class="dt-head"><h2 id="detailTitle">Couldn’t load this Pokémon</h2><button type="button" class="dt-close" aria-label="Close">✕</button></div><p class="dt-muted" style="padding:0 16px 16px">${esc(err?.message || "Please try again.")}</p>`;
    dialog.onclick = (e) => { if (e.target === dialog || e.target.closest(".dt-close")) dialog.close(); };
  }
}

/** Open the details drawer/sheet for one species (see the header for ctx and opts). */
export function openDetail(id, ctx, opts = {}) {
  lastFocus = document.activeElement;
  return load(id, ctx, opts);
}
