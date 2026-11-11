// ==========================================================
// Mockup kit for the Teams / Collection redesign (design only).
// Static, synthetic data (mock-data.js); not served by the bot and not
// imported by any page. Classic script so the mockups open from file://.
// Builds markup with the shared design system classes
// (public/shared/tokens.css + components.css) plus mock.css.
// ==========================================================
(function () {
  const ROOT = "../../../../public";
  const M = window.MOCK;
  const q = new URLSearchParams(location.search);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const ICONS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <symbol id="i-home" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/></symbol>
  <symbol id="i-dex" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="14" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
  <symbol id="i-teams" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path stroke="currentColor" stroke-width="2" d="M3 12h6m6 0h6"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
  <symbol id="i-person" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M4 21c1-4 4-6 8-6s7 2 8 6"/></symbol>
  <symbol id="i-bag" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/></symbol>
  <symbol id="i-star" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></symbol>
  <symbol id="i-shop" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 9h16l-1-5H5zM5 9v11h14V9M9 20v-6h6v6"/></symbol>
  <symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></symbol>
  <symbol id="i-up" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 14 6-6 6 6"/></symbol>
  <symbol id="i-down" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m6 10 6 6 6-6"/></symbol>
  <symbol id="i-left" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m14 6-6 6 6 6"/></symbol>
  <symbol id="i-right" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m10 6 6 6-6 6"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M7 7l10 10M17 7 7 17"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M12 5v14M5 12h14"/></symbol>
  <symbol id="i-grip" viewBox="0 0 24 24"><g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M8 11V8a4 4 0 0 1 8 0v3"/></symbol>
  <symbol id="i-sparkle" viewBox="0 0 24 24"><path fill="currentColor" d="M10 2c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7zm8 11c.3 2 1.2 2.9 3.2 3.2-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.2 3.2-3.2z"/></symbol>
  <symbol id="i-swords" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 4l9 9M20 4l-9 9M6 14l4 4M18 14l-4 4M3 19l3 2M21 19l-3 2"/></symbol>
  <symbol id="i-smile" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 14c1 1.5 2.3 2 4 2s3-.5 4-2"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/></symbol>
  <symbol id="i-filter" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 6h16M7 12h10M10 18h4"/></symbol>
  <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 11v6M12 7.5v.01"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="m5 12 5 5 9-10"/></symbol>
  <symbol id="i-trophy" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4c0 3 2 5 4 5M16 6h4c0 3-2 5-4 5M12 13v4M8 21h8M9 17h6"/></symbol>
</svg>`;

  const NAV = [
    { key: "overview", label: "Overview", short: "Home", icon: "home", href: "overview.html" },
    { key: "teams", label: "Teams", short: "Teams", icon: "teams", href: "teams-a.html" },
    { key: "collection", label: "Collection", short: "Pokédex", icon: "dex", href: "collection-a.html" },
    { key: "trainers", label: "Trainers", icon: "person", href: "#" },
    { key: "bag", label: "Bag", short: "Bag", icon: "bag", href: "#" },
    { key: "achievements", label: "Achievements", icon: "star", href: "achievements.html" },
    { key: "shop", label: "Shop", icon: "shop", href: "#" },
  ];
  const TABS = ["overview", "teams", "collection", "bag"];

  const icon = (name, cls = "") => `<svg class="mk-ic ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

  function shell(active) {
    document.body.classList.add("cc-shell");
    document.body.insertAdjacentHTML("afterbegin", ICONS);
    const link = (it, short) =>
      `<li><a class="cc-nav-link" href="${it.href}"${it.key === active ? ' aria-current="page"' : ""}>${icon(it.icon)}<span>${short ? it.short : it.label}</span></a></li>`;
    const side = `<nav class="cc-sidebar" aria-label="Dashboard">
      <div class="cc-brand"><i aria-hidden="true"></i><span>Coop’s Collection</span></div>
      <ul class="cc-nav-list">${NAV.map((it) => link(it)).join("")}</ul>
      <div class="mk-wallet"><span><img src="${ROOT}/sprites/items/cc_coin.png" alt="">215,500 CC</span><span><img src="${ROOT}/sprites/items/tp_icon.png" alt="">3,200 TP</span></div>
      <p class="cc-sidebar-foot">Opened from /dashboard in Discord. Links last 10 minutes.</p>
    </nav>`;
    const more = active && !TABS.includes(active);
    const tabs = `<nav class="cc-tabbar" aria-label="Dashboard"><ul class="cc-nav-list">${TABS.map((k) => link(NAV.find((n) => n.key === k), true)).join("")}
      <li><a class="cc-nav-link" href="#"${more ? ' aria-current="page"' : ""}>${icon("more")}<span>More</span></a></li></ul></nav>`;
    document.body.insertAdjacentHTML("afterbegin", `<a class="cc-skip" href="#ccMain">Skip to content</a>${side}`);
    document.body.insertAdjacentHTML("beforeend", tabs);
  }

  // ---------- data helpers ----------
  const owned = (id, variant = "normal") => M.box.find((p) => p.id === id && p.variant === variant);
  const megaOf = (id) => M.megas.find((m) => m.id === id);
  function sprite(id, variant = "normal", megaId = null) {
    if (megaId) return `${ROOT}/sprites/pokemon/mega/${variant}/${megaId}.gif`;
    return `${ROOT}/sprites/pokemon/${variant}/${id}.gif`;
  }
  const typeChips = (types) => types.map((t) => `<span class="cc-type" data-type="${t.toLowerCase()}">${t}</span>`).join("");
  const tierPill = (tier) => `<span class="cc-tier" data-tier="${tier}">${tier[0].toUpperCase() + tier.slice(1)}</span>`;
  const fmt = (n) => Number(n).toLocaleString("en-US");

  // Teams used across the mockups (species id, variant, Mega form).
  const TEAMS = {
    display: [
      { id: 6, variant: "normal", mega: "mega-charizard-x" },
      { id: 25, variant: "shiny" },
      { id: 150, variant: "normal" },
      { id: 94, variant: "normal" },
      { id: 249, variant: "normal" },
      { id: 149, variant: "normal" },
    ],
    // Moved over from the old Team: Lugia (2nd mythic) was left out.
    // Unsaved edits on top: Gengar moved up to slot 2, Garchomp added.
    battle: [
      { id: 6, variant: "normal", mega: "mega-charizard-x" },
      { id: 94, variant: "normal", change: "Moved" },
      { id: 150, variant: "normal" },
      { id: 25, variant: "shiny" },
      { id: 149, variant: "normal" },
      { id: 445, variant: "normal", change: "New" },
    ],
  };
  const member = (m) => (m ? { ...owned(m.id, m.variant), mega: m.mega ? megaOf(m.mega) : null, change: m.change ?? null } : null);
  const team = (key) => TEAMS[key].map(member);

  /** Where a box copy sits: "D1", "B3" … */
  function membership(id, variant) {
    const out = [];
    TEAMS.display.forEach((m, i) => m && m.id === id && m.variant === variant && out.push({ team: "display", slot: i + 1 }));
    TEAMS.battle.forEach((m, i) => m && m.id === id && m.variant === variant && out.push({ team: "battle", slot: i + 1 }));
    return out;
  }
  const memberBadges = (id, variant) =>
    membership(id, variant).map((x) => `<span class="mk-mem mk-mem--${x.team}" title="${x.team === "battle" ? "Battle" : "Display"} team, slot ${x.slot}">${x.team === "battle" ? "B" : "D"}${x.slot}</span>`).join("");

  // ---------- pieces ----------
  /**
   * A team slot card.
   * opts: team ("display"|"battle"), index, size ("lg"|"md"|"row"), controls (bool),
   *       axis ("v"|"h") for reorder arrows, drag (bool)
   */
  function slotCard(p, opts) {
    const { team: t, index: i, size = "md", controls = true, axis = "v", drag = true } = opts;
    const n = i + 1;
    if (!p) {
      return `<li class="mk-slot mk-slot--${size} is-empty">
        <button type="button" class="mk-slot-add" aria-label="Add a Pokémon to ${t === "battle" ? "Battle" : "Display"} team slot ${n}">
          ${icon("plus")}<span>Add</span></button></li>`;
    }
    const isBattle = t === "battle";
    const name = p.mega ? p.mega.name : p.name;
    const lvl = isBattle
      ? `<span class="mk-lv mk-lv--fixed" title="Ranked and wager battles use Lv 50"><b>Lv 50</b><small>yours Lv ${p.level}</small></span>`
      : `<span class="mk-lv"><b>Lv ${p.level}</b></span>`;
    const tags = [
      i === 0 ? `<span class="mk-tag mk-tag--lead">Lead</span>` : "",
      p.mega ? `<span class="mk-tag mk-tag--mega">Mega</span>` : "",
      p.tier === "mythic" ? `<span class="cc-tier" data-tier="mythic">Mythic</span>` : "",
      p.change ? `<span class="mk-tag mk-tag--change">${p.change}</span>` : "",
    ].join("");
    const arrows = axis === "h" ? ["left", "right"] : ["up", "down"];
    const ctl = controls
      ? `<div class="mk-slot-ctl">
          ${drag ? `<span class="mk-grip" title="Drag to reorder (desktop)">${icon("grip")}</span>` : ""}
          <button type="button" class="mk-ib" aria-label="Move ${esc(name)} ${axis === "h" ? "left" : "up"}"${i === 0 ? " disabled" : ""}>${icon(arrows[0])}</button>
          <button type="button" class="mk-ib" aria-label="Move ${esc(name)} ${axis === "h" ? "right" : "down"}"${i === 5 ? " disabled" : ""}>${icon(arrows[1])}</button>
          <button type="button" class="mk-ib mk-ib--x" aria-label="Remove ${esc(name)} from the ${isBattle ? "Battle" : "Display"} team">${icon("x")}</button>
        </div>`
      : "";
    return `<li class="mk-slot mk-slot--${size}${i === 0 ? " is-lead" : ""}${p.variant === "shiny" ? " is-shiny" : ""}${p.mega ? " is-mega" : ""}${p.change ? " is-changed" : ""}">
      <div class="mk-stage">
        <span class="mk-no" aria-label="Slot ${n}">${n}</span>
        ${p.variant === "shiny" ? `<span class="mk-shiny" title="Shiny">${icon("sparkle")}<span class="sr-only">Shiny</span></span>` : ""}
        <img class="cc-sprite" src="${sprite(p.id, p.variant, p.mega?.id)}" alt="">
      </div>
      <div class="mk-slot-body">
        <div class="mk-slot-name">${esc(name)}</div>
        <div class="mk-slot-meta">${lvl}</div>
        <div class="mk-slot-tags">${tags}</div>
      </div>
      ${ctl}
    </li>`;
  }

  /** A box tile (an owned copy). state: "" | "held" | "blocked" | "picked" */
  function boxTile(p, { state = "", blockedReason = "", target = null } = {}) {
    const label = `${p.name}${p.variant === "shiny" ? " (shiny)" : ""}, Lv ${p.level}`;
    return `<li class="mk-tile${p.variant === "shiny" ? " is-shiny" : ""}${state ? ` is-${state}` : ""}">
      <button type="button" class="mk-tile-btn" aria-label="${esc(label)}${state === "blocked" ? `. Can't add: ${esc(blockedReason)}` : ""}"${state === "picked" || state === "held" ? ' aria-pressed="true"' : ""}>
        <span class="mk-tile-badges">${memberBadges(p.id, p.variant)}</span>
        ${p.variant === "shiny" ? `<span class="mk-shiny mk-shiny--sm">${icon("sparkle")}</span>` : ""}
        <img class="cc-sprite" src="${sprite(p.id, p.variant)}" alt="" loading="lazy">
        <span class="mk-tile-name">${esc(p.name)}</span>
        <span class="mk-tile-lv">Lv ${p.level}${p.tier === "mythic" ? ` · <b class="tier-text mythic">Mythic</b>` : ""}</span>
        ${state === "blocked" ? `<span class="mk-tile-block">${icon("lock")}${esc(blockedReason)}</span>` : ""}
      </button>
    </li>`;
  }

  /** Battle-team rule chips. */
  function rules({ mythic = 1, mega = 1, count = 6, error = false } = {}) {
    return `<ul class="mk-rules" aria-label="Battle team rules">
      <li class="mk-rule">${icon("swords")}Battles at <b>Lv 50</b></li>
      <li class="mk-rule${error ? " is-error" : mythic >= 1 ? " is-full" : ""}">Mythic <b>${mythic}/1</b></li>
      <li class="mk-rule${mega >= 1 ? " is-full" : ""}">Mega <b>${mega}/1</b></li>
      <li class="mk-rule">Slots <b>${count}/6</b></li>
    </ul>`;
  }

  const MYTHIC_ERROR = `Rayquaza can’t join your Battle team: it already has a mythic-tier Pokémon (Mewtwo). Remove Mewtwo first, or add Rayquaza to your Display team.`;
  function ruleError() {
    return `<div class="mk-error" role="alert">${icon("lock")}<p><strong>One mythic-tier Pokémon per Battle team</strong>${MYTHIC_ERROR}</p></div>`;
  }

  function movedNotice() {
    return `<div class="cc-banner cc-banner--info mk-notice" role="status">
      <p><strong>Meet your new Battle team</strong>We copied your Team into a new Battle team for ranked and wager battles. Lugia was left out: a Battle team can have one mythic-tier Pokémon. Your Display team didn’t change.</p>
      <button type="button" class="cc-btn mk-notice-x" aria-label="Dismiss">${icon("x")}</button>
    </div>`;
  }

  function saveBar(summary = "Battle team: Gengar moved to slot 2 · Garchomp added") {
    return `<div class="mk-savebar" role="region" aria-label="Unsaved changes">
      <p><strong>Unsaved changes</strong><span>${summary}</span></p>
      <div class="mk-savebar-actions"><button type="button" class="cc-btn">Discard</button><button type="button" class="cc-btn cc-btn--primary">Save teams</button></div>
    </div>`;
  }

  function boxFilters(extra = "") {
    return `<div class="mk-boxbar">
      <label class="sr-only" for="boxSearch">Search your Pokémon</label>
      <input id="boxSearch" type="search" placeholder="Search your Pokémon…">
      <label class="sr-only" for="boxSort">Sort</label>
      <select id="boxSort"><option>Sort: Power</option><option>Level</option><option>Pokédex #</option><option>Name</option></select>
      <div class="mk-seg" role="group" aria-label="Show"><button type="button" aria-pressed="true">All</button><button type="button" aria-pressed="false">${icon("sparkle")}Shiny</button><button type="button" aria-pressed="false">Not on a team</button></div>
      ${extra}
    </div>`;
  }

  /** Box contents sorted by Power, with chosen tiles marked. */
  function boxList({ held = null, blocked = [], picked = null, limit = 40 } = {}) {
    const list = [...M.box].sort((a, b) => b.power - a.power).slice(0, limit);
    return list.map((p) => {
      const k = `${p.id}:${p.variant}`;
      if (held === k) return boxTile(p, { state: "held" });
      if (picked === k) return boxTile(p, { state: "picked" });
      if (blocked.includes(k)) return boxTile(p, { state: "blocked", blockedReason: "Mythic limit" });
      return boxTile(p);
    }).join("");
  }

  window.MK = { ROOT, M, q, esc, icon, shell, owned, sprite, typeChips, tierPill, fmt, TEAMS, team, member, membership, memberBadges, slotCard, boxTile, rules, ruleError, movedNotice, saveBar, boxFilters, boxList, MYTHIC_ERROR };
})();
