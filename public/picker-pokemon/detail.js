// ==========================================================
// public/picker-pokemon/detail.js — the Collection's Pokémon detail
// (design option A): a drawer beside the grid on desktop, a bottom sheet on
// phones. Data: GET /api/pokemon/detail (read-only, same numbers as the
// Discord cards). Actions reuse the page's own Evolve / Donate / Convert
// flows (passed in as ctx), so nothing here writes on its own.
// ==========================================================

import { scanFx } from "/public/shared/spriteFx.js";
import { pageHref } from "/public/shared/shell.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dex = (id) => `#${String(id).padStart(4, "0")}`;
const STAT_LABELS = [["hp", "HP"], ["atk", "Atk"], ["def", "Def"], ["spa", "SpA"], ["spd", "SpD"], ["spe", "Spe"]];
const sprite = (id, variant) => `/public/sprites/pokemon/${variant === "shiny" ? "shiny" : "normal"}/${id}.gif`;

let dialog = null;
let lastFocus = null;
let shownVariant = "normal";

function ensureDialog() {
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

function render(d, ctx) {
  const copies = d.copies ?? {};
  const owned = Object.keys(copies);
  if (!owned.includes(shownVariant)) shownVariant = owned[0] ?? "normal";
  const c = copies[shownVariant];
  const tier = d.tier;
  const slots = c ? [c.teams.display ? `Showcase team slot ${c.teams.display}` : "", c.teams.battle ? `Battle team slot ${c.teams.battle}` : ""].filter(Boolean) : [];
  const variantToggle = owned.length > 1
    ? `<div class="dt-seg" role="group" aria-label="Copy">${owned.map((v) => `<button type="button" data-variant="${v}" aria-pressed="${v === shownVariant}">${v === "shiny" ? "✨ Shiny" : "Normal"}</button>`).join("")}</div>`
    : "";
  const evo = [...d.evolvesFrom.map((e) => ({ ...e, rel: "from" })), { id: d.id, name: d.name, rel: "this" }, ...d.evolvesTo.map((e) => ({ ...e, rel: "to" }))];
  const art = owned.length ? sprite(d.id, shownVariant) : `/public/sprites/pokemon/grayscale/${d.id}.gif`;
  dialog.innerHTML = `
    <div class="dt-head">
      <div>
        <p class="cc-eyebrow">${dex(d.id)} · ${esc(d.region ?? "")}${d.generation ? ` · Gen ${d.generation}` : ""}</p>
        <h2 id="detailTitle">${esc(d.name)}</h2>
        <div class="dt-chips">${typeChips(d.types)}<span class="cc-tier" data-tier="${esc(tier)}">${esc(tier)}</span></div>
      </div>
      <button type="button" class="dt-close" aria-label="Close">✕</button>
    </div>
    <div class="dt-stage${shownVariant === "shiny" && owned.length ? " is-shiny" : ""}"${shownVariant === "shiny" && owned.length ? ` data-fx="shiny" data-fx-seed="${d.id}"` : ""}>
      ${variantToggle}
      <img src="${art}" alt="${esc(d.name)}${shownVariant === "shiny" ? " (shiny)" : ""}" class="${owned.length ? "" : "silhouette"}" onerror="this.onerror=null;this.src='/public/sprites/items/pokeball.png'">
    </div>
    ${d.flavor ? `<p class="dt-flavor">${esc(d.flavor)}</p>` : ""}
    <section class="dt-sec"><h3>Your copies</h3>
      ${owned.length ? owned.map((v) => `<div class="dt-copy"><img src="${sprite(d.id, v)}" alt=""><span>${v === "shiny" ? "✨ Shiny" : "Normal"} ×${copies[v].count} · <b>Lv ${copies[v].level}</b><br><small>${[copies[v].teams.display ? `Display slot ${copies[v].teams.display}` : "", copies[v].teams.battle ? `Battle slot ${copies[v].teams.battle}` : ""].filter(Boolean).join(" · ") || "Not on a team"}</small></span></div>`).join("") : `<p class="dt-muted">Not caught yet.</p>`}
    </section>
    ${d.megaForms?.length ? `<section class="dt-sec"><h3>Mega forms</h3><div class="dt-forms">${d.megaForms.map((f) => `<div class="dt-form"><img src="/public/sprites/pokemon/mega/${shownVariant === "shiny" ? "shiny" : "normal"}/${esc(f.id)}.gif" alt=""><b>${esc(f.name)}</b><small>${f.unlocked[shownVariant] ? "Unlocked" : "Locked"}</small></div>`).join("")}</div><p class="dt-muted">Forms of ${esc(d.name)}: they never count as Pokédex entries.</p></section>` : ""}
    ${c ? `<section class="dt-sec"><h3>Stats at Lv ${c.level}</h3>${statBars(c.stats)}
      <p class="dt-muted">Power ${c.power.toLocaleString("en-US")} · at Lv 50 in ranked: ${c.power50?.toLocaleString("en-US") ?? "—"}</p></section>
      ${["display", "battle"].map((team) => {
        const set = c.movesets?.[team];
        const list = set ?? c.moves;
        return `<section class="dt-sec"><h3>${team === "battle" ? "Battle team moves" : "Showcase team moves"}${set ? "" : " · automatic"}</h3><div class="dt-moves">${list.map((m) => `<div class="dt-move"><span>${esc(m.name)}</span>${m.type ? `<span class="cc-type" data-type="${esc(m.type.toLowerCase())}">${esc(m.type)}</span>` : ""}</div>`).join("")}</div></section>`;
      }).join("")}
      <section class="dt-sec"><p class="dt-muted" style="margin:0">${c.nextMoves.length ? `Learns next: ${c.nextMoves.map((m) => esc(m.name)).join(", ")}. ` : ""}Change moves on the <a href="${pageHref("/public/teams/", ctx.userId)}">Teams page</a> (each team keeps its own).</p></section>`
    : d.baseStats ? `<section class="dt-sec"><h3>Base stats</h3>${statBars(d.baseStats)}<p class="dt-muted">Total ${d.baseTotal}</p></section>` : ""}
    ${evo.length > 1 ? `<section class="dt-sec"><h3>Evolution</h3><div class="dt-evo">${evo.map((e) => `<button type="button" class="dt-evo-step${e.rel === "this" ? " is-this" : ""}" data-species="${e.id}"${e.rel === "this" ? ' aria-current="true"' : ""}><img src="/public/sprites/pokemon/normal/${e.id}.gif" alt="">${esc(e.name)}</button>`).join('<span aria-hidden="true">›</span>')}</div></section>` : ""}
    ${owned.length ? `<section class="dt-sec dt-actions">
      ${ctx.canEvolve(d.id) ? `<button type="button" class="cc-btn" data-act="evolve">Evolve</button>` : ""}
      <button type="button" class="cc-btn" data-act="donate"${slots.length ? ' disabled title="On a team: remove it first"' : ""}>Donate ${shownVariant === "shiny" ? "shiny" : ""}</button>
      ${copies.normal && !copies.shiny ? `<button type="button" class="cc-btn cc-btn--gold" data-act="convert">✨ Convert</button>` : ""}
      <a class="cc-btn cc-btn--primary" href="${pageHref("/public/teams/", ctx.userId)}">Use on a team</a>
    </section>` : ""}`;
  scanFx(dialog);
}

async function load(id, ctx) {
  ensureDialog();
  dialog.innerHTML = `<p class="dt-muted" style="padding:24px">Loading…</p>`;
  if (!dialog.open) dialog.showModal();
  try {
    const d = await ctx.apiJSON(`/api/pokemon/detail?${new URLSearchParams({ id: ctx.userId, species: id })}`);
    const owned = Object.keys(d.copies ?? {});
    shownVariant = owned.includes("normal") ? "normal" : owned[0] ?? "normal";
    if (owned.length === 1) shownVariant = owned[0];
    render(d, ctx);
    dialog.onclick = (e) => {
      if (e.target === dialog) return dialog.close();
      const b = e.target.closest("button, [data-act]");
      if (!b) return;
      if (b.classList.contains("dt-close")) return dialog.close();
      if (b.dataset.variant) { shownVariant = b.dataset.variant; return render(d, ctx); }
      if (b.dataset.species && b.dataset.species !== String(d.id)) return load(Number(b.dataset.species), ctx);
      const act = b.dataset.act;
      if (!act || b.disabled) return;
      dialog.close();
      if (act === "evolve") ctx.evolve(d.id);
      else if (act === "donate") ctx.donate(d.id, shownVariant);
      else if (act === "convert") ctx.convert(d.id);
    };
    dialog.querySelector(".dt-close")?.focus();
  } catch (err) {
    dialog.innerHTML = `<div class="dt-head"><h2 id="detailTitle">Couldn't load this Pokémon</h2><button type="button" class="dt-close" aria-label="Close">✕</button></div><p class="dt-muted" style="padding:0 16px 16px">${esc(err?.message || "Please try again.")}</p>`;
    dialog.onclick = (e) => { if (e.target === dialog || e.target.closest(".dt-close")) dialog.close(); };
  }
}

/** Open the detail drawer/sheet for one species. */
export function openDetail(id, ctx) {
  lastFocus = document.activeElement;
  return load(id, ctx);
}
