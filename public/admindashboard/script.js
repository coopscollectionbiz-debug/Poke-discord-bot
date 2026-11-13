// ==========================================================
// Admin dashboard (public/admindashboard). Hash routes:
//   #/overview  #/players  #/player/<id>/<tab>  #/grants
//   #/changes   #/live (Live events)   #/events (Activity log)
// Every change goes through the review panel (openReview) or the
// Grants page: preview first, then one Confirm. API: routes/admindashboard.js.
// ==========================================================

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const main = $("#main");

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

function ago(ms) {
  if (!ms) return "never";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}
const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const tierChip = (t) => `<span class="chip tier" data-tier="${esc(String(t || "").toLowerCase())}">${esc(t)}</span>`;
const sprite = (id, variant) => `/public/sprites/pokemon/${variant === "shiny" ? "shiny" : "normal"}/${Number(id)}.gif`;
const trainerSprite = (key) => `/public/sprites/trainers_2/${encodeURIComponent(key)}`;

const state = {
  session: null,
  catalog: null,
  users: null,
  selected: new Set(),
  usersSort: { key: "lastActive", dir: -1 },
  usersQuery: "",
  usersOnboarded: false,
  player: null,
};

// ----------------------------------------------------------
// API
// ----------------------------------------------------------
async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the bot. Check your connection and try again." };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (res.status === 403 && /Session expired|authentication/i.test(data.error || "")) {
    $("#sessionOverlay").hidden = false;
  }
  return { ...data, ok: res.ok && data.ok !== false, status: res.status };
}

async function getCatalog() {
  if (!state.catalog) {
    const c = await api("/api/admin/catalog");
    if (c.ok) {
      state.catalog = c;
      c.speciesById = new Map(c.species.map((s) => [s.id, s]));
    }
  }
  return state.catalog;
}

function toast(text, bad = false) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("bad", bad);
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), bad ? 7000 : 4000);
}

// ----------------------------------------------------------
// Router
// ----------------------------------------------------------
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { parts, query: new URLSearchParams(query) };
}

async function route() {
  closeReview();
  const { parts, query } = parseHash();
  const section = parts[0] || "overview";
  $$(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.section === (section === "player" ? "players" : section)));
  main.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    if (section === "players") await renderPlayers();
    else if (section === "player") await renderPlayer(parts[1], parts[2] || "summary");
    else if (section === "grants") await renderGrants();
    else if (section === "changes") await renderChanges(query);
    else if (section === "events") await renderEvents(query);
    else if (section === "live") await renderLiveEvents(parts[1] || null);
    else await renderOverview();
  } catch (err) {
    main.innerHTML = `<div class="error-box">Something went wrong loading this page: ${esc(err?.message || err)}</div>`;
  }
  main.focus({ preventScroll: true });
}
window.addEventListener("hashchange", route);

// ----------------------------------------------------------
// Overview
// ----------------------------------------------------------
async function renderOverview() {
  const s = await api("/api/admin/stats");
  if (!s.ok) return (main.innerHTML = `<div class="error-box">${esc(s.error || "Couldn't load stats.")}</div>`);
  const stat = (label, value, sub = "") => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ""}</div>`;
  main.innerHTML = `
    <div class="page-head"><div><h1>Overview</h1></div></div>
    <div class="stats">
      ${stat("Players", fmt(s.totalUsers), `${fmt(s.onboarded)} onboarded`)}
      ${stat("Active in 24 hours", fmt(s.active24h), `${fmt(s.active7d)} in 7 days`)}
      ${stat("CC held", fmt(s.totalCC))}
      ${stat("TP earned", fmt(s.totalTP))}
      ${stat("Pokémon copies", fmt(s.totalPokemonVariants), `${fmt(s.totalPokemonSpecies)} species owned across players`)}
      ${stat("Trainers owned", fmt(s.totalTrainers))}
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Top 10 by TP</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Player</th><th>Rank</th><th class="num">TP</th></tr></thead>
        <tbody>${s.topByTp.map((u, i) => `<tr class="clickable" data-user="${esc(u.userId)}"><td>${i + 1}</td><td>${esc(u.name || u.userId)}</td><td>${esc(u.rank)}</td><td class="num">${fmt(u.tp)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No players yet.</td></tr>`}</tbody>
      </table></div>
    </section>`;
  $$("tr[data-user]", main).forEach((tr) => tr.addEventListener("click", () => (location.hash = `#/player/${encodeURIComponent(tr.dataset.user)}`)));
}

// ----------------------------------------------------------
// Players
// ----------------------------------------------------------
async function loadUsers(force = false) {
  if (!state.users || force) {
    const r = await api("/api/admin/users");
    if (!r.ok) throw new Error(r.error || "Couldn't load players.");
    state.users = r.users;
  }
  return state.users;
}

async function renderPlayers() {
  await loadUsers(true);
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Players</h1><p id="playersCount"></p></div>
      <button class="btn-primary" id="grantSelected" type="button"></button>
    </div>
    <section class="panel">
      <div class="panel-head">
        <input class="search" id="userSearch" type="search" placeholder="Search name or Discord ID" value="${esc(state.usersQuery)}" />
        <label class="inline"><input type="checkbox" id="onlyOnboarded" ${state.usersOnboarded ? "checked" : ""} /> Onboarded only</label>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th><input type="checkbox" id="selectAll" aria-label="Select all shown" /></th>
          <th data-sort="name">Name</th>
          <th data-sort="rank" class="hide-sm">Rank</th>
          <th data-sort="cc" class="num">CC</th>
          <th data-sort="tp" class="num">TP</th>
          <th data-sort="pokemonCount" class="num hide-sm">Pokémon</th>
          <th data-sort="trainerCount" class="num hide-sm">Trainers</th>
          <th data-sort="lastActive">Last active</th>
        </tr></thead>
        <tbody id="usersBody"></tbody>
      </table></div>
    </section>`;
  $("#userSearch").addEventListener("input", (e) => {
    state.usersQuery = e.target.value;
    drawUsers();
  });
  $("#onlyOnboarded").addEventListener("change", (e) => {
    state.usersOnboarded = e.target.checked;
    drawUsers();
  });
  $$("th[data-sort]", main).forEach((th) =>
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      state.usersSort = { key, dir: state.usersSort.key === key ? -state.usersSort.dir : key === "name" || key === "rank" ? 1 : -1 };
      drawUsers();
    })
  );
  $("#selectAll").addEventListener("change", (e) => {
    for (const u of visibleUsers()) e.target.checked ? state.selected.add(u.userId) : state.selected.delete(u.userId);
    drawUsers();
  });
  $("#grantSelected").addEventListener("click", () => (location.hash = "#/grants"));
  drawUsers();
}

function visibleUsers() {
  const q = state.usersQuery.trim().toLowerCase();
  const { key, dir } = state.usersSort;
  return state.users
    .filter((u) => (!state.usersOnboarded || u.onboardingComplete) && (!q || u.name.toLowerCase().includes(q) || u.userId.includes(q)))
    .sort((a, b) => {
      const x = a[key], y = b[key];
      return (typeof x === "string" ? x.localeCompare(y) : (x || 0) - (y || 0)) * dir;
    });
}

function drawUsers() {
  const rows = visibleUsers();
  $("#playersCount").textContent = `${fmt(rows.length)} of ${fmt(state.users.length)} shown`;
  const n = state.selected.size;
  const btn = $("#grantSelected");
  btn.textContent = n ? `Grant to ${fmt(n)} selected` : "Grant to selected";
  btn.disabled = !n;
  $$("th[data-sort]", main).forEach((th) => {
    th.classList.toggle("sorted", th.dataset.sort === state.usersSort.key);
    th.classList.toggle("asc", th.dataset.sort === state.usersSort.key && state.usersSort.dir === 1);
  });
  const all = rows.length && rows.every((u) => state.selected.has(u.userId));
  $("#selectAll").checked = !!all;
  $("#usersBody").innerHTML =
    rows
      .map(
        (u) => `<tr class="clickable" data-user="${esc(u.userId)}">
        <td><input type="checkbox" data-pick="${esc(u.userId)}" ${state.selected.has(u.userId) ? "checked" : ""} aria-label="Select ${esc(u.name)}" /></td>
        <td>${esc(u.name || "(no name)")}${u.onboardingComplete ? "" : ` <span class="chip">not onboarded</span>`}</td>
        <td class="hide-sm">${esc(u.rank)}</td>
        <td class="num">${fmt(u.cc)}</td>
        <td class="num">${fmt(u.tp)}</td>
        <td class="num hide-sm">${fmt(u.pokemonCount)}</td>
        <td class="num hide-sm">${fmt(u.trainerCount)}</td>
        <td class="nowrap">${ago(u.lastActive)}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="8" class="empty">No players match.</td></tr>`;
  $$("tr[data-user]", main).forEach((tr) =>
    tr.addEventListener("click", (e) => {
      if (e.target.closest("input")) return;
      location.hash = `#/player/${encodeURIComponent(tr.dataset.user)}`;
    })
  );
  $$("input[data-pick]", main).forEach((cb) =>
    cb.addEventListener("change", () => {
      cb.checked ? state.selected.add(cb.dataset.pick) : state.selected.delete(cb.dataset.pick);
      drawUsers();
    })
  );
}

// ----------------------------------------------------------
// Player page
// ----------------------------------------------------------
const TABS = [
  ["summary", "Summary"],
  ["pokemon", "Pokémon"],
  ["items", "Items"],
  ["trainers", "Trainers"],
  ["auras", "Auras"],
  ["cooldowns", "Cooldowns"],
  ["history", "History"],
];

async function loadPlayer(id) {
  const r = await api(`/api/admin/player/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(r.error || "Couldn't load this player.");
  state.player = r;
  return r;
}

async function renderPlayer(id, tab) {
  const [data] = await Promise.all([loadPlayer(id), getCatalog()]);
  const p = data.player;
  main.innerHTML = `
    <div class="crumbs"><a href="#/players">Players</a> / ${esc(p.name || p.userId)}</div>
    <div class="player-head">
      <div>
        <h1>${esc(p.name || "(no name)")}</h1>
        <div class="player-id"><span>${esc(p.userId)}</span><button class="btn-sm" id="copyId" type="button">Copy ID</button></div>
      </div>
      <div class="facts">
        <div><div class="fact-label">CC</div><div class="fact-value">${fmt(p.cc)}</div></div>
        <div><div class="fact-label">TP</div><div class="fact-value">${fmt(p.tp)}</div></div>
        <div><div class="fact-label">Rank</div><div class="fact-value">${esc(p.rank)}</div></div>
        <div><div class="fact-label">Last active</div><div class="fact-value">${ago(p.lastActive)}</div></div>
      </div>
    </div>
    <nav class="tabs" aria-label="Player sections">
      ${TABS.map(([k, label]) => `<a class="tab ${k === tab ? "active" : ""}" href="#/player/${encodeURIComponent(p.userId)}/${k}">${label}</a>`).join("")}
    </nav>
    <div id="tabBody"></div>`;
  $("#copyId").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(p.userId);
      toast("ID copied");
    } catch {
      toast("Couldn't copy. Select the ID and copy it instead.", true);
    }
  });
  const body = $("#tabBody");
  const views = { summary: tabSummary, pokemon: tabPokemon, items: tabItems, trainers: tabTrainers, auras: tabAuras, cooldowns: tabCooldowns, history: tabHistory };
  await (views[tab] || tabSummary)(body, data);
}

const refreshPlayer = () => route();

function tabSummary(body, data) {
  const p = data.player;
  body.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Change CC or TP</h2></div>
      <div class="field-row">
        <label>Currency<select id="curKind"><option value="cc">CC</option><option value="tp">TP</option></select></label>
        <label>Change<select id="curOp"><option value="add">Add</option><option value="remove">Remove</option></select></label>
        <label>Amount<input id="curAmount" type="number" min="1" step="1" inputmode="numeric" placeholder="500" /></label>
        <button class="btn-primary" id="curReview" type="button">Review</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Account</h2></div>
      <dl class="kv">
        <dt>Onboarding</dt><dd>${p.onboardingComplete ? "Complete" : "Not finished"}</dd>
        <dt>Pokémon</dt><dd>${fmt(p.copies)} copies, ${fmt(data.pokemon.length)} species + Variant rows</dd>
        <dt>Team</dt><dd>${p.teamSize} of 6</dd>
        <dt>Ranked team</dt><dd>${p.battleTeamSize == null ? "Not set" : `${p.battleTeamSize} of 6`}</dd>
        <dt>Ranked rating</dt><dd>${fmt(p.battleRating)} (${p.rankedWins}–${p.rankedLosses} this season)</dd>
        <dt>Open wager</dt><dd>${p.pendingWager ? `${fmt(p.pendingWager.stake)} CC held until ${when(p.pendingWager.expiresAt)}` : "None"}</dd>
      </dl>
    </section>
    <section class="panel">
      <details id="rawDetails"><summary>Raw record</summary><pre class="raw" id="rawRecord">Loading…</pre></details>
    </section>
    <section class="panel danger-zone">
      <div class="panel-head"><h2>Reset player</h2></div>
      <p class="muted">Wipes everything back to a new player: CC, TP, items, Pokémon, Levels, trainers, Teams, achievements and battle records. The old record is kept in the audit file.</p>
      <button class="btn-ghost-danger" id="resetBtn" type="button">Reset player…</button>
    </section>`;
  $("#curReview").addEventListener("click", () => {
    const amount = Number($("#curAmount").value);
    openReview({ userId: p.userId, userName: p.name, change: { kind: $("#curKind").value, op: $("#curOp").value, amount: amount || 1 }, onDone: refreshPlayer });
  });
  $("#rawDetails").addEventListener("toggle", async (e) => {
    if (!e.target.open) return;
    const r = await api(`/api/admin/user/${encodeURIComponent(p.userId)}`);
    $("#rawRecord").textContent = r.ok ? JSON.stringify(r.user, null, 2) : r.error || "Couldn't load.";
  });
  $("#resetBtn").addEventListener("click", () => openReview({ userId: p.userId, userName: p.name, change: { kind: "reset", confirmName: "" }, onDone: refreshPlayer }));
}

function speciesOptions(includeUnreleased) {
  return state.catalog.species
    .filter((s) => includeUnreleased || s.released)
    .map((s) => `<option value="${esc(`${s.name} #${s.id}`)}">${s.released ? "" : "Unreleased"}</option>`)
    .join("");
}
const speciesFromInput = (v) => {
  const m = String(v).match(/#(\d+)\s*$/);
  if (m) return state.catalog.speciesById.get(Number(m[1])) || null;
  const q = String(v).trim().toLowerCase();
  return state.catalog.species.find((s) => s.name.toLowerCase() === q) || null;
};

function tabPokemon(body, data) {
  const p = data.player;
  body.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Add Pokémon</h2>
        <label class="inline"><input type="checkbox" id="pkUnreleased" /> Show unreleased (testing)</label>
      </div>
      <div class="field-row">
        <label style="flex:2 1 220px">Pokémon<input id="pkSpecies" list="pkList" placeholder="Start typing a name" autocomplete="off" /></label>
        <datalist id="pkList">${speciesOptions(false)}</datalist>
        <label>Variant<select id="pkVariant"><option value="normal">Normal</option><option value="shiny">Shiny</option></select></label>
        <label>Copies<input id="pkAmount" type="number" min="1" step="1" value="1" /></label>
        <button class="btn-primary" id="pkAdd" type="button">Review</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Owned</h2><input class="search" id="pkFilter" type="search" placeholder="Filter by name" /></div>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>Pokémon</th><th class="num">Copies</th><th class="num">Lv</th><th class="hide-sm">On team</th><th></th></tr></thead>
        <tbody id="pkBody"></tbody>
      </table></div>
    </section>`;
  $("#pkUnreleased").addEventListener("change", (e) => ($("#pkList").innerHTML = speciesOptions(e.target.checked)));
  $("#pkAdd").addEventListener("click", () => {
    const s = speciesFromInput($("#pkSpecies").value);
    if (!s) return toast("Pick a Pokémon from the list.", true);
    openReview({
      userId: p.userId, userName: p.name,
      change: { kind: "pokemon", op: "add", speciesId: s.id, variant: $("#pkVariant").value, amount: Number($("#pkAmount").value) || 1 },
      allowUnreleased: $("#pkUnreleased").checked,
      onDone: refreshPlayer,
    });
  });
  // Every copy is its own Pokémon (docs/adr/0001): a row opens into its copies.
  const open = new Set();
  const copyRows = (r, i) => (r.copies ?? []).map((c) => `<tr class="copy-row">
      <td></td>
      <td class="faint">↳ ${c.trained ? `<span class="chip">★ TM-trained</span> ` : ""}<code>${esc(c.uid)}</code></td>
      <td></td>
      <td class="num">${c.level}</td>
      <td class="hide-sm">${c.teams.map((t) => `<span class="chip blue">${esc(t)}</span>`).join(" ")}</td>
      <td class="actions">
        <button class="btn-sm" data-i="${i}" data-uid="${esc(c.uid)}" data-act="copy-level">Set Lv</button>
        <button class="btn-sm" data-i="${i}" data-uid="${esc(c.uid)}" data-act="copy-remove">Remove</button>
      </td></tr>`).join("");
  const draw = () => {
    const q = $("#pkFilter").value.trim().toLowerCase();
    const rows = data.pokemon.filter((r) => !q || r.name.toLowerCase().includes(q) || String(r.id) === q);
    $("#pkBody").innerHTML =
      rows
        .map(
          (r, i) => `<tr>
          <td><img class="sprite" src="${sprite(r.id, r.variant)}" alt="" loading="lazy" /></td>
          <td>${esc(r.name)} <span class="faint">#${r.id}</span> ${r.variant === "shiny" ? `<span class="chip shiny">Shiny</span>` : ""} ${tierChip(r.tier)}</td>
          <td class="num">${fmt(r.count)}</td>
          <td class="num">${r.level}</td>
          <td class="hide-sm">${r.teams.map((t) => `<span class="chip blue">${esc(t)}</span>`).join(" ")}</td>
          <td class="actions">
            <button class="step minus" data-i="${i}" data-act="remove" aria-label="Remove ${esc(r.name)}">−</button>
            <button class="step" data-i="${i}" data-act="add" aria-label="Add ${esc(r.name)}">+</button>
            <button class="btn-sm" data-i="${i}" data-act="level" title="Sets their best copy">Set Lv</button>
            ${(r.copies?.length ?? 0) > 1 || r.copies?.some((c) => c.trained) ? `<button class="btn-sm" data-i="${i}" data-act="copies" aria-expanded="${open.has(`${r.id}:${r.variant}`)}">Copies (${r.copies.length})</button>` : ""}
          </td></tr>${open.has(`${r.id}:${r.variant}`) ? copyRows(r, i) : ""}`
        )
        .join("") || `<tr><td colspan="6" class="empty">${data.pokemon.length ? "Nothing matches." : "They don't own any Pokémon."}</td></tr>`;
    $$("button[data-act]", $("#pkBody")).forEach((b) =>
      b.addEventListener("click", () => {
        const r = rows[Number(b.dataset.i)];
        if (b.dataset.act === "copies") {
          const k = `${r.id}:${r.variant}`;
          if (open.has(k)) open.delete(k); else open.add(k);
          return draw();
        }
        const uid = b.dataset.uid;
        const copy = uid ? r.copies.find((c) => c.uid === uid) : null;
        const change =
          b.dataset.act === "level"
            ? { kind: "level", speciesId: r.id, variant: r.variant, level: r.level }
            : b.dataset.act === "copy-level"
              ? { kind: "level", speciesId: r.id, variant: r.variant, level: copy?.level, uid }
              : b.dataset.act === "copy-remove"
                ? { kind: "pokemon", op: "remove", speciesId: r.id, variant: r.variant, amount: 1, uid }
                : { kind: "pokemon", op: b.dataset.act, speciesId: r.id, variant: r.variant, amount: 1 };
        openReview({ userId: p.userId, userName: p.name, change, allowUnreleased: true, onDone: refreshPlayer });
      })
    );
  };
  $("#pkFilter").addEventListener("input", draw);
  draw();
}

// Item <select> options grouped by category; items players can't get yet say so.
function itemOptions(items) {
  const groups = new Map();
  for (const i of items) (groups.get(i.category) ?? groups.set(i.category, []).get(i.category)).push(i);
  return [...groups].map(([cat, list]) => `<optgroup label="${esc(cat)}">${list
    .map((i) => `<option value="${esc(i.id)}">${esc(i.name)}${i.live === false ? " · not live" : ""}</option>`).join("")}</optgroup>`).join("");
}

function tabItems(body, data) {
  const p = data.player;
  const items = state.catalog.items;
  body.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Add item</h2></div>
      ${items.length ? `<div class="field-row">
        <label style="flex:2 1 220px">Item<select id="itAdd">${itemOptions(items)}</select></label>
        <label>Amount<input id="itAmount" type="number" min="1" step="1" value="1" /></label>
        <button class="btn-primary" id="itReview" type="button">Review</button>
      </div>
      <p class="faint">Every item that can sit in a bag, including TMs, Mega Stones and Mega Shards. Items marked "not live" wait in the bag until players can use them.</p>` : `<p class="muted">No items can be granted right now.</p>`}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Bag</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Item</th><th class="hide-sm">Category</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${
          data.items
            .map(
              (r, i) => `<tr>
              <td>${esc(r.name)}${r.known ? "" : ` <span class="chip">old item</span>`}</td>
              <td class="hide-sm">${esc(r.category)}</td>
              <td class="num">${fmt(r.quantity)}</td>
              <td class="actions">
                <button class="step minus" data-i="${i}" data-act="remove" aria-label="Remove ${esc(r.name)}">−</button>
                ${items.some((c) => c.id === r.id) ? `<button class="step" data-i="${i}" data-act="add" aria-label="Add ${esc(r.name)}">+</button>` : ""}
              </td></tr>`
            )
            .join("") || `<tr><td colspan="4" class="empty">Their bag is empty.</td></tr>`
        }</tbody>
      </table></div>
    </section>`;
  $("#itReview")?.addEventListener("click", () =>
    openReview({ userId: p.userId, userName: p.name, change: { kind: "item", op: "add", itemId: $("#itAdd").value, amount: Number($("#itAmount").value) || 1 }, onDone: refreshPlayer })
  );
  $$("button[data-act]", body).forEach((b) =>
    b.addEventListener("click", () => {
      const r = data.items[Number(b.dataset.i)];
      openReview({ userId: p.userId, userName: p.name, change: { kind: "item", op: b.dataset.act, itemId: r.id, amount: 1 }, onDone: refreshPlayer });
    })
  );
}

function trainerOptions() {
  return state.catalog.trainers.map((t) => `<option value="${esc(`${t.name} — ${t.key}`)}">${esc(t.tier)}</option>`).join("");
}
const trainerFromInput = (v) => {
  const key = String(v).split(" — ").pop().trim().toLowerCase();
  return state.catalog.trainers.find((t) => t.key.toLowerCase() === key) || null;
};

function tabTrainers(body, data) {
  const p = data.player;
  body.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Add trainer</h2></div>
      <div class="field-row">
        <label style="flex:2 1 260px">Trainer<input id="trAdd" list="trList" placeholder="Start typing a name" autocomplete="off" /></label>
        <datalist id="trList">${trainerOptions()}</datalist>
        <button class="btn-primary" id="trReview" type="button">Review</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Owned (${fmt(data.trainers.length)})</h2><input class="search" id="trFilter" type="search" placeholder="Filter by name" /></div>
      <div class="trainer-grid" id="trGrid"></div>
    </section>`;
  $("#trReview").addEventListener("click", () => {
    const t = trainerFromInput($("#trAdd").value);
    if (!t) return toast("Pick a trainer from the list.", true);
    openReview({ userId: p.userId, userName: p.name, change: { kind: "trainer", op: "add", key: t.key }, onDone: refreshPlayer });
  });
  const draw = () => {
    const q = $("#trFilter").value.trim().toLowerCase();
    const rows = data.trainers.filter((t) => !q || t.name.toLowerCase().includes(q) || t.key.toLowerCase().includes(q));
    $("#trGrid").innerHTML =
      rows
        .map(
          (t, i) => `<div class="trainer-card">
          <img src="${trainerSprite(t.key)}" alt="" loading="lazy" />
          <div class="name">${esc(t.name)}</div>
          <div>${t.tier ? tierChip(t.tier) : ""} ${t.displayed ? `<span class="chip blue">Displayed</span>` : ""}</div>
          <button class="btn-sm btn-ghost-danger" data-i="${i}" type="button">Remove</button>
        </div>`
        )
        .join("") || `<p class="empty">${data.trainers.length ? "Nothing matches." : "They don't own any trainers."}</p>`;
    $$("button[data-i]", $("#trGrid")).forEach((b) =>
      b.addEventListener("click", () => {
        const t = rows[Number(b.dataset.i)];
        openReview({ userId: p.userId, userName: p.name, change: { kind: "trainer", op: "remove", key: t.key }, onDone: refreshPlayer });
      })
    );
  };
  $("#trFilter").addEventListener("input", draw);
  draw();
}

// Aura <select> options: every Aura; ones without art or retired say so.
const AURA_KIND = { tier: "Tier", gym: "Gym", elite4: "Elite Four", champion: "Champion", milestone: "Milestone", shop: "Shop", event: "Event" };
function auraOptions(auras) {
  const groups = new Map();
  for (const a of auras) { const k = AURA_KIND[a.kind] ?? a.kind; (groups.get(k) ?? groups.set(k, []).get(k)).push(a); }
  return [...groups].map(([k, list]) => `<optgroup label="${esc(k)}">${list
    .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}${a.retired ? " · retired" : ""}${a.live === false ? " · not live" : ""}</option>`).join("")}</optgroup>`).join("");
}

function tabAuras(body, data) {
  const p = data.player;
  const owned = data.auras ?? [];
  const ownedIds = new Set(owned.map((a) => a.id));
  const addable = (state.catalog.auras ?? []).filter((a) => !ownedIds.has(a.id));
  const lockNote = { record: "from their record", trainer: "from a trainer they own" };
  body.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Add Aura</h2></div>
      ${addable.length ? `<div class="field-row">
        <label style="flex:2 1 260px">Aura<select id="auAdd">${auraOptions(addable)}</select></label>
        <button class="btn-primary" id="auReview" type="button">Review</button>
      </div>
      <p class="faint">Any Aura, including retired event Auras. One marked "not live" has no art yet: it's owned now and shows once its art ships.</p>` : `<p class="muted">They own every Aura.</p>`}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Owned (${fmt(owned.length)})</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Aura</th><th class="hide-sm">Kind</th><th></th></tr></thead>
        <tbody>${
          owned.map((a, i) => `<tr>
            <td>${esc(a.name)}${a.equipped ? ` <span class="chip blue">Equipped</span>` : ""}${a.live ? "" : ` <span class="chip">not live</span>`}</td>
            <td class="hide-sm">${esc(AURA_KIND[a.kind] ?? a.kind)}</td>
            <td class="actions">${a.lockedBy
              ? `<span class="faint">${esc(lockNote[a.lockedBy] ?? "locked")}</span>`
              : `<button class="btn-sm btn-ghost-danger" data-i="${i}" type="button">Remove</button>`}</td></tr>`).join("")
          || `<tr><td colspan="3" class="empty">They don't own any Auras.</td></tr>`
        }</tbody>
      </table></div>
    </section>`;
  $("#auReview")?.addEventListener("click", () =>
    openReview({ userId: p.userId, userName: p.name, change: { kind: "aura", op: "add", auraId: $("#auAdd").value }, onDone: refreshPlayer })
  );
  $$("button[data-i]", body).forEach((b) =>
    b.addEventListener("click", () => {
      const a = owned[Number(b.dataset.i)];
      openReview({ userId: p.userId, userName: p.name, change: { kind: "aura", op: "remove", auraId: a.id }, onDone: refreshPlayer });
    })
  );
}

function tabCooldowns(body, data) {
  const p = data.player;
  body.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Cooldowns</h2></div>
      ${data.cooldowns
        .map((c) => `<div class="cooldown-row"><label class="inline"><input type="checkbox" value="${esc(c.key)}" /> ${esc(c.label)}</label><span class="muted">${esc(c.state)}</span></div>`)
        .join("")}
      <p class="faint">Resetting Daily keeps the daily streak. Resetting the Battle cap lets them earn battle EXP, start ranked and wager battles, and send Rematch requests again today; their Ranked rating is untouched.</p>
      <div class="sheet-actions"><button class="btn-primary" id="cdReview" type="button" disabled>Review reset</button></div>
    </section>`;
  const boxes = $$("input[type=checkbox]", body);
  boxes.forEach((b) => b.addEventListener("change", () => ($("#cdReview").disabled = !boxes.some((x) => x.checked))));
  $("#cdReview").addEventListener("click", () =>
    openReview({ userId: p.userId, userName: p.name, change: { kind: "cooldown", cooldowns: boxes.filter((b) => b.checked).map((b) => b.value) }, onDone: refreshPlayer })
  );
}

async function tabHistory(body, data) {
  body.innerHTML = `<section class="panel"><div class="panel-head"><h2>Admin changes to this player</h2></div><div id="histList"><p class="muted">Loading…</p></div></section>`;
  const r = await api(`/api/admin/audit?userId=${encodeURIComponent(data.player.userId)}&limit=200`);
  $("#histList").innerHTML = r.ok ? auditList(r.entries, { showPlayer: false }) : `<div class="error-box">${esc(r.error)}</div>`;
}

// ----------------------------------------------------------
// Review panel (single player)
// ----------------------------------------------------------
function showValue(v) {
  if (v == null) return "";
  if (typeof v === "number") return fmt(v);
  if (typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(", ");
  return String(v);
}

let review = null;

function closeReview() {
  review = null;
  $("#sheet").hidden = true;
  $("#sheetBackdrop").hidden = true;
}
$("#sheetClose").addEventListener("click", closeReview);
$("#sheetBackdrop").addEventListener("click", closeReview);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#sheet").hidden) closeReview();
});

function openReview({ userId, userName, change, allowUnreleased = false, onDone }) {
  review = { userId, change: { ...change }, allowUnreleased, onDone, requestId: rid(), preview: null, busy: false, firstGrant: false };
  const c = review.change;
  const hasAmount = ["cc", "tp", "item", "pokemon"].includes(c.kind);
  const isReset = c.kind === "reset";
  $("#sheetTitle").textContent = isReset ? "Reset player" : "Review change";
  $("#sheetBody").innerHTML = `
    <div class="review-who">${esc(userName || userId)}</div>
    <div class="review-summary" id="rvSummary">Checking…</div>
    <div class="before-after" id="rvBA"></div>
    <div id="rvError"></div>
    <ul class="warn-list" id="rvWarnings"></ul>
    ${hasAmount ? `<label>Amount<input id="rvAmount" type="number" min="1" step="1" value="${Number(c.amount) || 1}" /></label>` : ""}
    <label id="rvLevelWrap" ${c.kind === "level" ? "" : "hidden"}><span id="rvLevelLabel">Level</span><input id="rvLevel" type="number" min="1" max="100" step="1" value="${c.level ?? ""}" /></label>
    ${isReset ? `<label>Type their name to confirm<input id="rvConfirmName" autocomplete="off" placeholder="${esc(userName)}" /></label>` : ""}
    <label><span>Reason <span id="rvReasonNote"></span></span><textarea id="rvReason" maxlength="300" placeholder="e.g. duplicated by bug, outage compensation"></textarea></label>
    <div class="sheet-actions">
      <button type="button" id="rvCancel">Cancel</button>
      <button type="button" class="${isReset || c.op === "remove" ? "btn-danger" : "btn-primary"}" id="rvConfirm" disabled>${isReset ? "Reset player" : "Confirm"}</button>
    </div>`;
  $("#sheet").hidden = false;
  $("#sheetBackdrop").hidden = false;
  $("#rvCancel").addEventListener("click", closeReview);
  $("#rvAmount")?.addEventListener("input", (e) => {
    c.amount = Number(e.target.value);
    newRequest();
    schedulePreview();
  });
  $("#rvLevel").addEventListener("input", (e) => {
    c.level = e.target.value === "" ? undefined : Number(e.target.value);
    newRequest();
    schedulePreview();
  });
  $("#rvConfirmName")?.addEventListener("input", (e) => {
    c.confirmName = e.target.value;
    schedulePreview();
  });
  $("#rvReason").addEventListener("input", updateConfirm);
  $("#rvConfirm").addEventListener("click", confirmReview);
  runPreview();
  (c.kind === "level" ? $("#rvLevel") : $("#rvAmount") || $("#rvConfirmName") || $("#rvReason")).focus();
}

function newRequest() {
  if (review) review.requestId = rid();
}

function schedulePreview() {
  clearTimeout(schedulePreview.t);
  schedulePreview.t = setTimeout(runPreview, 250);
}

async function runPreview() {
  if (!review) return;
  const mine = review;
  const r = await api("/api/admin/change/preview", { method: "POST", body: { userId: mine.userId, change: mine.change, allowUnreleased: mine.allowUnreleased } });
  if (review !== mine) return;
  mine.preview = r;
  const err = $("#rvError");
  if (!r.ok) {
    $("#rvSummary").textContent = summaryGuess(mine.change);
    $("#rvBA").innerHTML = "";
    $("#rvWarnings").innerHTML = "";
    // Not errors yet: a reset before the name is typed, a Level still at its current value.
    const hint =
      (mine.change.kind === "reset" && /Type the player's name/.test(r.error || "")) ||
      (mine.change.kind === "level" && /is already Lv/.test(r.error || ""));
    err.innerHTML = hint
      ? mine.change.kind === "level" ? `<p class="muted">${esc(r.error)} Enter the new Level.</p>` : ""
      : `<div class="error-box">${esc(r.error || "This change can't be made.")}</div>`;
  } else {
    err.innerHTML = "";
    $("#rvSummary").textContent = r.summary;
    $("#rvBA").innerHTML =
      r.before == null ? "" : `<span>${esc(showValue(r.before))}</span><span class="arrow">→</span><span>${esc(showValue(r.after))}</span>`;
    $("#rvWarnings").innerHTML = (r.warnings || []).map((w) => `<li>${esc(w)}</li>`).join("");
    // First grant of a species + Variant: show the rolled Catch level and let the admin change it.
    if (mine.change.kind === "pokemon" && mine.change.op === "add" && r.level != null) {
      mine.firstGrant = r.levelRolled || mine.change.level != null;
      if (mine.firstGrant) {
        $("#rvLevelWrap").hidden = false;
        $("#rvLevelLabel").textContent = "Catch level";
        if (mine.change.level == null) {
          mine.change.level = r.level;
          $("#rvLevel").value = r.level;
        }
      }
    }
  }
  $("#rvReasonNote").textContent = needsReasonLocal(mine.change) ? "(required)" : "(optional)";
  updateConfirm();
}

function summaryGuess(c) {
  if (c.kind === "reset") return "Reset player";
  if (c.kind === "level") return "Set Level";
  return "Review change";
}

function needsReasonLocal(c) {
  return c.op === "remove" || c.kind === "level" || c.kind === "reset";
}

function updateConfirm() {
  if (!review) return;
  const c = review.change;
  const reasonOk = !needsReasonLocal(c) || $("#rvReason").value.trim().length > 0;
  const nameOk = c.kind !== "reset" || review.preview?.ok;
  $("#rvConfirm").disabled = review.busy || !review.preview?.ok || !reasonOk || !nameOk;
}

async function confirmReview() {
  if (!review || review.busy) return;
  const mine = review;
  mine.busy = true;
  updateConfirm();
  $("#rvConfirm").textContent = "Saving…";
  const r = await api("/api/admin/change", {
    method: "POST",
    body: { userId: mine.userId, change: mine.change, reason: $("#rvReason").value, allowUnreleased: mine.allowUnreleased, requestId: mine.requestId },
  });
  if (review !== mine) return;
  mine.busy = false;
  if (!r.ok) {
    $("#rvConfirm").textContent = mine.change.kind === "reset" ? "Reset player" : "Confirm";
    $("#rvError").innerHTML = `<div class="error-box">${esc(r.error || "The change wasn't made.")}</div>`;
    updateConfirm();
    return;
  }
  const notes = [r.summary];
  if (!r.saved) notes.push(r.note || "Saved locally; the backup will catch up.");
  if (r.role && !r.role.ok) notes.push(`Role not updated: ${r.role.reason}`);
  if (r.audited === false) notes.push("The audit entry couldn't be written; check the server logs.");
  toast(notes.join(" · "), !r.saved || r.audited === false || (r.role && !r.role.ok));
  closeReview();
  state.users = null;
  await mine.onDone?.();
}

// ----------------------------------------------------------
// Grants (bulk)
// ----------------------------------------------------------
const grant = { target: "filters", preview: null, requestId: null };

async function renderGrants() {
  await Promise.all([getCatalog(), loadUsers()]);
  const nSel = state.selected.size;
  if (nSel && grant.target !== "selected" && !grant.touched) grant.target = "selected";
  if (!nSel && grant.target === "selected") grant.target = "filters";
  grant.preview = null;
  main.innerHTML = `<div id="grantsPage">
    <div class="page-head"><div><h1>Grants</h1><p>Add to many players at once, or reset their cooldowns. Removals are made one player at a time.</p></div></div>
    <section class="panel">
      <div class="panel-head"><h2>Who</h2></div>
      <div class="field-row" style="margin-bottom:12px">
        <label class="inline"><input type="radio" name="gTarget" value="selected" ${grant.target === "selected" ? "checked" : ""} ${nSel ? "" : "disabled"} /> ${nSel ? `${fmt(nSel)} selected on Players` : "Selected players (none selected)"}</label>
        <label class="inline"><input type="radio" name="gTarget" value="filters" ${grant.target === "filters" ? "checked" : ""} /> Everyone matching filters</label>
        ${nSel ? `<button class="btn-sm" id="clearSel" type="button">Clear selection</button>` : ""}
      </div>
      <div id="gFilters" ${grant.target === "filters" ? "" : "hidden"}>
        <div class="field-row">
          <label>CC at least<input id="fCcMin" type="number" min="0" /></label>
          <label>CC at most<input id="fCcMax" type="number" min="0" /></label>
          <label>TP at least<input id="fTpMin" type="number" min="0" /></label>
          <label>TP at most<input id="fTpMax" type="number" min="0" /></label>
          <label>Active in the last (days)<input id="fActive" type="number" min="0" /></label>
        </div>
        <div class="field-row" style="margin-top:12px">
          <label>Ownership<select id="fOwnsMode"><option value="">Any</option><option value="has">Owns</option><option value="lacks">Doesn't own</option></select></label>
          <label>Type<select id="fOwnsKind"><option value="pokemon">Pokémon</option><option value="item">Item</option></select></label>
          <label style="flex:2 1 200px">Which<input id="fOwnsWhich" list="fOwnsList" autocomplete="off" placeholder="Name" /></label>
          <datalist id="fOwnsList"></datalist>
          <label>Variant<select id="fOwnsVariant"><option value="any">Either</option><option value="normal">Normal</option><option value="shiny">Shiny</option></select></label>
        </div>
        <label class="inline" style="margin-top:12px"><input type="checkbox" id="fOnboarded" checked /> Onboarded players only</label>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>What</h2></div>
      <div class="field-row">
        <label>Grant<select id="gKind">
          <option value="cc">CC</option><option value="tp">TP</option><option value="item">Item</option>
          <option value="pokemon">Pokémon</option><option value="trainer">Trainer</option><option value="aura">Aura</option><option value="cooldown">Cooldown reset</option>
        </select></label>
        <div id="gFields" style="display:contents"></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Preview</h2><button class="btn-primary" id="gPreview" type="button">Preview</button></div>
      <div id="gPreviewOut"><p class="muted">Preview to see exactly who gets it. The grant goes to that list, even if balances change before you confirm.</p></div>
    </section>
    <section class="panel" id="gConfirmPanel" hidden>
      <label>Reason (required)<textarea id="gReason" maxlength="300" placeholder="e.g. Outage 11 Nov"></textarea></label>
      <div class="sheet-actions" style="margin-top:12px"><button class="btn-primary" id="gConfirm" type="button" disabled></button></div>
    </section>
    <div id="gResult"></div></div>`;
  const page = $("#grantsPage");

  $$("input[name=gTarget]").forEach((r) =>
    r.addEventListener("change", () => {
      grant.target = r.value;
      grant.touched = true;
      $("#gFilters").hidden = grant.target !== "filters";
      invalidate();
    })
  );
  $("#clearSel")?.addEventListener("click", () => {
    state.selected.clear();
    grant.target = "filters";
    renderGrants();
  });
  const fillOwnsList = () => {
    $("#fOwnsList").innerHTML =
      $("#fOwnsKind").value === "item"
        ? state.catalog.items.map((i) => `<option value="${esc(i.name)}"></option>`).join("")
        : speciesOptions(true);
    $("#fOwnsVariant").disabled = $("#fOwnsKind").value === "item";
  };
  $("#fOwnsKind").addEventListener("change", fillOwnsList);
  fillOwnsList();
  $("#gKind").addEventListener("change", drawGrantFields);
  drawGrantFields();
  page.addEventListener("input", (e) => {
    if (e.target.id !== "gReason") invalidate();
    updateGrantConfirm();
  });
  page.addEventListener("change", (e) => {
    if (e.target.id !== "gReason") invalidate();
  });
  $("#gPreview").addEventListener("click", previewGrant);
  $("#gConfirm").addEventListener("click", confirmGrant);
}

function drawGrantFields() {
  const kind = $("#gKind").value;
  const f = $("#gFields");
  if (kind === "cc" || kind === "tp") f.innerHTML = `<label>Amount<input id="gAmount" type="number" min="1" step="1" placeholder="500" /></label>`;
  else if (kind === "item")
    f.innerHTML = state.catalog.items.length
      ? `<label style="flex:2 1 200px">Item<select id="gItem">${itemOptions(state.catalog.items)}</select></label><label>Amount<input id="gAmount" type="number" min="1" step="1" value="1" /></label>`
      : `<p class="muted">No items can be granted right now.</p>`;
  else if (kind === "pokemon")
    f.innerHTML = `<label style="flex:2 1 220px">Pokémon<input id="gSpecies" list="gSpeciesList" autocomplete="off" placeholder="Start typing a name" /></label>
      <datalist id="gSpeciesList">${speciesOptions(false)}</datalist>
      <label>Variant<select id="gVariant"><option value="normal">Normal</option><option value="shiny">Shiny</option></select></label>
      <label>Copies<input id="gAmount" type="number" min="1" step="1" value="1" /></label>
      <label class="inline"><input type="checkbox" id="gUnreleased" /> Show unreleased (testing)</label>
      <p class="faint" style="flex-basis:100%">Players who don't own it yet get a rolled Catch level; others get extra copies only.</p>`;
  else if (kind === "trainer")
    f.innerHTML = `<label style="flex:2 1 260px">Trainer<input id="gTrainer" list="gTrainerList" autocomplete="off" placeholder="Start typing a name" /></label><datalist id="gTrainerList">${trainerOptions()}</datalist>
      <p class="faint" style="flex-basis:100%">Players who already own it are skipped.</p>`;
  else if (kind === "aura")
    f.innerHTML = `<label style="flex:2 1 260px">Aura<select id="gAura">${auraOptions(state.catalog.auras ?? [])}</select></label>
      <p class="faint" style="flex-basis:100%">Any Aura, including retired event Auras and ones without art yet. Players who already own it are skipped.</p>`;
  else
    f.innerHTML = state.catalog.cooldowns.map((c) => `<label class="inline"><input type="checkbox" name="gCooldown" value="${esc(c.key)}" /> ${esc(c.label)}</label>`).join("");
  $("#gUnreleased")?.addEventListener("change", (e) => ($("#gSpeciesList").innerHTML = speciesOptions(e.target.checked)));
  invalidate();
}

function grantChange() {
  const kind = $("#gKind").value;
  const amount = Number($("#gAmount")?.value);
  if (kind === "cc" || kind === "tp") return amount ? { kind, op: "add", amount } : { error: "Enter an amount." };
  if (kind === "item") return $("#gItem") ? { kind, op: "add", itemId: $("#gItem").value, amount: amount || 1 } : { error: "No items can be granted." };
  if (kind === "pokemon") {
    const s = speciesFromInput($("#gSpecies").value);
    return s ? { kind, op: "add", speciesId: s.id, variant: $("#gVariant").value, amount: amount || 1 } : { error: "Pick a Pokémon from the list." };
  }
  if (kind === "trainer") {
    const t = trainerFromInput($("#gTrainer").value);
    return t ? { kind, op: "add", key: t.key } : { error: "Pick a trainer from the list." };
  }
  if (kind === "aura") return $("#gAura")?.value ? { kind, op: "add", auraId: $("#gAura").value } : { error: "Pick an Aura." };
  const cds = $$("input[name=gCooldown]:checked").map((c) => c.value);
  return cds.length ? { kind: "cooldown", cooldowns: cds } : { error: "Choose at least one cooldown." };
}

function grantFilters() {
  const v = (id) => $(id).value.trim();
  const f = { ccMin: v("#fCcMin"), ccMax: v("#fCcMax"), tpMin: v("#fTpMin"), tpMax: v("#fTpMax"), activeDays: v("#fActive"), onboardedOnly: $("#fOnboarded").checked };
  const mode = $("#fOwnsMode").value;
  if (mode) {
    const kind = $("#fOwnsKind").value;
    const which = v("#fOwnsWhich");
    let id = null;
    if (kind === "item") id = state.catalog.items.find((i) => i.name.toLowerCase() === which.toLowerCase())?.id ?? null;
    else id = speciesFromInput(which)?.id ?? null;
    if (id == null) return { error: "Pick what they must own (or not own) from the list." };
    f.owns = { kind, id, variant: $("#fOwnsVariant").value, has: mode === "has" };
  }
  return f;
}

function invalidate() {
  if (!grant.preview) return;
  grant.preview = null;
  $("#gPreviewOut").innerHTML = `<p class="muted">Changed since the last preview. Preview again.</p>`;
  $("#gConfirmPanel").hidden = true;
}

async function previewGrant() {
  const change = grantChange();
  if (change.error) return toast(change.error, true);
  let target;
  if (grant.target === "selected") target = { userIds: [...state.selected] };
  else {
    const filters = grantFilters();
    if (filters.error) return toast(filters.error, true);
    target = { filters };
  }
  $("#gPreviewOut").innerHTML = `<p class="muted">Checking…</p>`;
  const r = await api("/api/admin/bulk/preview", { method: "POST", body: { change, target, allowUnreleased: !!$("#gUnreleased")?.checked } });
  if (!r.ok) {
    $("#gPreviewOut").innerHTML = `<div class="error-box">${esc(r.error)}</div>`;
    return;
  }
  grant.preview = { change, userIds: r.players.map((p) => p.userId), summary: r.summary, count: r.count, allowUnreleased: !!$("#gUnreleased")?.checked };
  grant.requestId = rid();
  const skippedIds = new Set(r.skipped.map((s) => s.userId));
  $("#gPreviewOut").innerHTML = `
    <p><strong>${fmt(r.count)} ${r.count === 1 ? "player" : "players"}</strong>${r.skipped.length ? `, ${fmt(r.skipped.length)} of whom would be skipped` : ""}.</p>
    ${r.skipped.length ? `<ul class="warn-list">${r.skipped.slice(0, 20).map((s) => `<li>${esc(s.name || s.userId)}: ${esc(s.error)}</li>`).join("")}${r.skipped.length > 20 ? `<li>…and ${r.skipped.length - 20} more</li>` : ""}</ul>` : ""}
    <div class="table-wrap bulk-list"><table>
      <thead><tr><th>Player</th><th class="num">CC</th><th class="num">TP</th><th>Last active</th></tr></thead>
      <tbody>${r.players.map((p) => `<tr${skippedIds.has(p.userId) ? ` class="faint"` : ""}><td>${esc(p.name || p.userId)}</td><td class="num">${fmt(p.cc)}</td><td class="num">${fmt(p.tp)}</td><td>${ago(p.lastActive)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">Nobody matches.</td></tr>`}</tbody>
    </table></div>`;
  $("#gConfirmPanel").hidden = r.count === 0;
  updateGrantConfirm();
}

function updateGrantConfirm() {
  const btn = $("#gConfirm");
  if (!btn || !grant.preview) return;
  const p = grant.preview;
  const what = p.change.kind === "cooldown" ? `${p.summary} for` : `${p.summary?.replace(/^Add /, "Grant ") ?? "Grant"} to`;
  btn.textContent = `${what} ${fmt(p.count)} ${p.count === 1 ? "player" : "players"}`;
  btn.disabled = grant.busy || !$("#gReason").value.trim();
}

async function confirmGrant() {
  const p = grant.preview;
  if (!p || grant.busy) return;
  grant.busy = true;
  updateGrantConfirm();
  const r = await api("/api/admin/bulk", {
    method: "POST",
    body: { change: p.change, userIds: p.userIds, reason: $("#gReason").value, allowUnreleased: p.allowUnreleased, requestId: grant.requestId },
  });
  grant.busy = false;
  if (!r.ok) {
    updateGrantConfirm();
    return toast(r.error || "The grant wasn't made.", true);
  }
  state.users = null;
  $("#gConfirmPanel").hidden = true;
  grant.preview = null;
  $("#gPreviewOut").innerHTML = `<p class="muted">Done. Preview again for another grant.</p>`;
  $("#gResult").innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>${esc(r.summary || "Grant")}: ${fmt(r.granted)} ${r.granted === 1 ? "player" : "players"}</h2>
        <a href="#/changes?batch=${encodeURIComponent(r.batchId)}">View in Admin changes</a></div>
      ${r.saved ? "" : `<p class="error-box">${esc(r.note || "Saved locally; the backup will catch up.")}</p>`}
      ${r.audited === false ? `<p class="error-box">The audit entries couldn't be written; check the server logs.</p>` : ""}
      ${r.skipped.length ? `<h3>Skipped</h3><ul class="warn-list">${r.skipped.map((s) => `<li>${esc(s.name || s.userId)}: ${esc(s.error)}</li>`).join("")}</ul>` : ""}
      ${r.roleFailures?.length ? `<h3 style="margin-top:12px">Discord role not updated</h3><ul class="warn-list">${r.roleFailures.map((s) => `<li>${esc(s.name || s.userId)}: ${esc(s.reason)}</li>`).join("")}</ul>` : ""}
    </section>`;
  toast(`${r.summary || "Granted"} to ${fmt(r.granted)} ${r.granted === 1 ? "player" : "players"}`);
}

// ----------------------------------------------------------
// Admin changes (audit)
// ----------------------------------------------------------
function auditList(entries, { showPlayer = true } = {}) {
  if (!entries.length) return `<p class="empty">No admin changes yet.</p>`;
  return entries
    .map(
      (e) => `<div class="audit-item">
      <div class="audit-top">
        <span class="audit-summary">${esc(e.summary)}</span>
        ${showPlayer ? `<a href="#/player/${encodeURIComponent(e.userId)}/history">${esc(e.userName || e.userId)}</a>` : ""}
        ${e.batchId ? `<a class="chip blue" href="#/changes?batch=${encodeURIComponent(e.batchId)}">batch of ${fmt(e.batchSize || 0)}</a>` : ""}
      </div>
      ${e.kind === "reset" ? `<div class="audit-change">Old record kept in the audit file.</div>` : e.before != null ? `<div class="audit-change">${esc(showValue(e.before))} → ${esc(showValue(e.after))}</div>` : ""}
      ${e.reason ? `<div class="audit-change">Reason: ${esc(e.reason)}</div>` : ""}
      <div class="audit-meta">${esc(when(e.at))} by ${esc(e.adminName || e.adminId)}</div>
    </div>`
    )
    .join("");
}

async function renderChanges(query) {
  const filters = { userId: query.get("player") || "", adminId: query.get("admin") || "", batchId: query.get("batch") || "" };
  const offset = Number(query.get("offset")) || 0;
  const qs = new URLSearchParams({ limit: "100", offset: String(offset) });
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  const r = await api(`/api/admin/audit?${qs}`);
  main.innerHTML = `
    <div class="page-head"><div><h1>Admin changes</h1><p>Every change made from this dashboard, newest first. Kept permanently.</p></div></div>
    <section class="panel">
      <form class="field-row" id="auditFilter" style="margin-bottom:12px">
        <label>Player ID<input name="player" value="${esc(filters.userId)}" /></label>
        <label>Admin ID<input name="admin" value="${esc(filters.adminId)}" /></label>
        <label>Batch<input name="batch" value="${esc(filters.batchId)}" /></label>
        <button type="submit">Filter</button>
      </form>
      ${r.ok ? auditList(r.entries) : `<div class="error-box">${esc(r.error)}</div>`}
      ${r.ok ? pager(r.total, offset, 100, (o) => `#/changes?${new URLSearchParams({ ...Object.fromEntries(Object.entries({ player: filters.userId, admin: filters.adminId, batch: filters.batchId }).filter(([, v]) => v)), offset: String(o) })}`) : ""}
    </section>`;
  $("#auditFilter").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const q = new URLSearchParams([...fd].filter(([, v]) => String(v).trim()));
    location.hash = `#/changes${q.toString() ? `?${q}` : ""}`;
  });
}

function pager(total, offset, limit, href) {
  if (total <= limit) return "";
  const prev = offset > 0 ? `<a class="btn btn-sm" href="${href(Math.max(0, offset - limit))}">Newer</a>` : "";
  const next = offset + limit < total ? `<a class="btn btn-sm" href="${href(offset + limit)}">Older</a>` : "";
  return `<div class="pager"><span class="muted">${fmt(offset + 1)}–${fmt(Math.min(total, offset + limit))} of ${fmt(total)}</span>${prev}${next}</div>`;
}

// ----------------------------------------------------------
// Activity log (the 30-day event log; "Live events" are something else)
// ----------------------------------------------------------
const EVENT_TYPES = ["roll", "donate", "evolve", "convert", "daily_claim", "weekly_claim", "quest_claim", "recruit", "stone_purchase", "trainer_purchase"];

async function renderEvents(query) {
  const type = query.get("type") || "";
  const userId = query.get("user") || "";
  const offset = Number(query.get("offset")) || 0;
  const qs = new URLSearchParams({ limit: "100", offset: String(offset) });
  if (type) qs.set("type", type);
  if (userId) qs.set("userId", userId);
  const r = await api(`/api/admin/events?${qs}`);
  main.innerHTML = `
    <div class="page-head"><div><h1>Activity log</h1><p>Player actions from the last 30 days.</p></div></div>
    <section class="panel">
      <form class="field-row" id="evFilter" style="margin-bottom:12px">
        <label>Type<select name="type"><option value="">All types</option>${EVENT_TYPES.map((t) => `<option ${t === type ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label>Player ID<input name="user" value="${esc(userId)}" /></label>
        <button type="submit">Filter</button>
      </form>
      <div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>Type</th><th>Player</th><th>Details</th></tr></thead>
        <tbody>${
          r.ok && r.events.length
            ? r.events.map((e) => `<tr><td class="nowrap">${esc(when(e.timestamp))}</td><td>${esc(e.type)}</td><td><a href="#/player/${encodeURIComponent(e.userId)}">${esc(e.userId)}</a></td><td class="faint">${esc(JSON.stringify(e.data ?? {}))}</td></tr>`).join("")
            : `<tr><td colspan="4" class="empty">${r.ok ? "No events." : esc(r.error)}</td></tr>`
        }</tbody>
      </table></div>
      ${r.ok ? pager(r.total, offset, 100, (o) => `#/events?${new URLSearchParams({ ...(type ? { type } : {}), ...(userId ? { user: userId } : {}), offset: String(o) })}`) : ""}
    </section>`;
  $("#evFilter").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const q = new URLSearchParams([...fd].filter(([, v]) => String(v).trim()));
    location.hash = `#/events${q.toString() ? `?${q}` : ""}`;
  });
}

// ----------------------------------------------------------
// Live events (routes/liveEventsAdmin.js; docs/design/live-events.md)
//   #/live        list: Running, Scheduled, Ended + announcement channel
//   #/live/new    editor for a new event
//   #/live/<id>   editor for an existing one (read-only once ended)
// ----------------------------------------------------------
const pct = (v) => `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: v < 0.01 ? 3 : 1 })}%`;
// <input type=datetime-local> works in the admin's own time zone.
const toLocalInput = (ms) => {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v) => (v ? new Date(v).getTime() : NaN);
const statusChip = (s) => `<span class="chip ${s === "running" ? "blue" : ""}">${s === "running" ? "Running" : s === "scheduled" ? "Scheduled" : "Ended"}</span>`;
const live = { meta: null, editing: null, previewTimer: null };

async function liveMeta() {
  const r = await api("/api/admin/live-events");
  if (r.ok) live.meta = r;
  return r;
}

async function renderLiveEvents(which) {
  if (which) return renderLiveEditor(which);
  const r = await liveMeta();
  if (!r.ok) return (main.innerHTML = `<div class="error-box">${esc(r.error || "Couldn't load Live events.")}</div>`);
  const ro = state.session?.readOnly;
  const group = (status, title, empty) => {
    const list = r.events.filter((e) => e.status === status);
    return `<section class="panel"><div class="panel-head"><h2>${title}</h2></div>${
      list.length ? list.map((e) => eventCard(e, ro)).join("") : `<p class="muted">${empty}</p>`
    }</section>`;
  };
  main.innerHTML = `<div id="livePage">
    <div class="page-head"><div><h1>Live events</h1><p>Timed changes to catches, EXP, earnings and battles for every player. Times are in your time zone.</p></div>
      ${ro ? "" : `<a class="btn btn-primary" href="#/live/new">New event</a>`}</div>
    ${group("running", "Running", "Nothing is running.")}
    ${group("scheduled", "Scheduled", "Nothing is scheduled.")}
    ${group("ended", "Ended", "No past events.")}
    <section class="panel">
      <div class="panel-head"><h2>Announcements</h2></div>
      <p class="muted">The bot posts in this channel when an event starts and when it ends. Leave it empty to post nothing.</p>
      <div class="field-row"><label style="flex:2 1 240px">Discord channel ID<input id="liveChannel" value="${esc(r.settings.channelId || "")}" inputmode="numeric" ${ro ? "disabled" : ""} /></label>
      ${ro ? "" : `<button class="btn-sm" id="liveChannelSave" type="button">Save channel</button>`}</div>
    </section></div>`;
  $("#liveChannelSave")?.addEventListener("click", async () => {
    const s = await api("/api/admin/live-events/channel", { method: "POST", body: { channelId: $("#liveChannel").value.trim() || null } });
    toast(s.ok ? (s.channelId ? "Announcements will post there." : "Announcements are off.") : s.error, !s.ok);
  });
  $("#livePage").addEventListener("click", (e) => {
    const b = e.target.closest("[data-live-act]");
    if (!b) return;
    const card = b.closest("[data-live-id]");
    const box = $(".live-confirm", card);
    if (b.dataset.liveAct === "cancel") return (box.hidden = true);
    if (b.dataset.liveAct === "end" || b.dataset.liveAct === "delete") {
      box.hidden = false;
      box.dataset.act = b.dataset.liveAct;
      $(".live-go", box).textContent = b.dataset.liveAct === "end" ? "End it now" : "Delete it";
      return $("textarea", box).focus();
    }
    if (b.dataset.liveAct === "go") {
      const reason = $("textarea", box).value.trim();
      if (!reason) return toast("A reason is required.", true);
      b.disabled = true;
      api(`/api/admin/live-events/${card.dataset.liveId}/${box.dataset.act}`, { method: "POST", body: { reason } }).then((s) => {
        b.disabled = false;
        if (!s.ok) return toast(s.error, true);
        toast(box.dataset.act === "end" ? "Ended." : "Deleted.");
        renderLiveEvents(null);
      });
    }
  });
}

function eventCard(e, ro) {
  const window_ = `${esc(when(e.startAt))} → ${esc(when(e.stopAt))}${e.endedAt && e.endedAt < e.endAt ? " (ended early)" : ""}`;
  return `<div class="live-card" data-live-id="${e.id}">
    <div class="live-card-head"><div><strong>${esc(e.name)}</strong> ${statusChip(e.status)}<div class="faint">${window_}</div></div>
      <div class="live-actions">
        <a class="btn btn-sm" href="#/live/${e.id}">${e.status === "ended" || ro ? "View" : "Edit"}</a>
        ${!ro && e.status === "running" ? `<button class="btn-sm btn-ghost-danger" data-live-act="end" type="button">End now</button>` : ""}
        ${!ro && e.status === "scheduled" ? `<button class="btn-sm btn-ghost-danger" data-live-act="delete" type="button">Delete</button>` : ""}
      </div></div>
    <ul class="live-effects">${e.effects.map((f) => `<li>${esc(f.text)}</li>`).join("")}</ul>
    <div class="live-confirm" hidden><label>Reason (required)<textarea maxlength="300"></textarea></label>
      <div class="sheet-actions"><button class="btn-sm" data-live-act="cancel" type="button">Cancel</button><button class="btn-danger live-go" data-live-act="go" type="button"></button></div></div>
  </div>`;
}

// ---- editor ----
const blankEffect = () => ({ kind: "catchBoost", value: 2, match: {} });

async function renderLiveEditor(which) {
  await getCatalog();
  if (!live.meta) await liveMeta();
  if (!live.meta?.kinds) return (main.innerHTML = `<div class="error-box">Couldn't load Live events.</div>`);
  let ev;
  if (which === "new") {
    const start = Date.now() + 60 * 60 * 1000;
    ev = { id: null, status: "new", name: "", startAt: start - (start % (15 * 60000)), endAt: start - (start % (15 * 60000)) + 7 * 86400000, effects: [blankEffect()] };
  } else {
    const found = live.meta.events.find((e) => String(e.id) === String(which));
    if (!found) return (main.innerHTML = `<div class="error-box">No such event. <a href="#/live">Back to Live events</a></div>`);
    ev = JSON.parse(JSON.stringify(found));
  }
  live.editing = ev;
  const locked = ev.status === "ended" || state.session?.readOnly;
  const running = ev.status === "running";
  main.innerHTML = `<div id="liveEditor">
    <div class="crumbs"><a href="#/live">Live events</a> › ${ev.id ? esc(ev.name) : "New event"}</div>
    <div class="page-head"><div><h1>${ev.id ? esc(ev.name) : "New Live event"} ${ev.id ? statusChip(ev.status) : ""}</h1>
      <p>${locked ? "Ended events can't be changed." : running ? "It's running: changes apply from the next catch, battle or purchase. Its start can't move." : "Times are in your time zone; players see their own."}</p></div></div>
    <fieldset class="live-fieldset" ${locked ? "disabled" : ""}>
    <section class="panel">
      <div class="field-row">
        <label style="flex:2 1 220px">Name<input id="leName" maxlength="60" value="${esc(ev.name)}" placeholder="e.g. Kanto week" /></label>
        <label>Starts<input id="leStart" type="datetime-local" value="${toLocalInput(ev.startAt)}" ${running ? "disabled" : ""} /></label>
        <label>Ends<input id="leEnd" type="datetime-local" value="${toLocalInput(ev.endAt)}" /></label>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Effects</h2><button class="btn-sm" id="leAdd" type="button">Add effect</button></div>
      <div id="leEffects"></div>
    </section>
    </fieldset>
    <section class="panel">
      <div class="panel-head"><h2>Preview</h2>
        <label class="inline">Roll with <select id="leBall"><option value="pokeball">Poké Ball</option><option value="greatball">Great Ball</option><option value="ultraball">Ultra Ball</option></select></label></div>
      <div id="lePreview"><p class="muted">Add an effect to see what it does.</p></div>
    </section>
    ${locked ? "" : `<section class="panel">
      <label>Reason (required)<textarea id="leReason" maxlength="300" placeholder="e.g. Kanto community week"></textarea></label>
      <div class="sheet-actions" style="margin-top:12px"><a class="btn btn-sm" href="#/live">Cancel</a><button class="btn-primary" id="leSave" type="button">${ev.id ? "Save changes" : "Schedule event"}</button></div>
    </section>`}</div>`;
  drawEffects();
  const page = $("#liveEditor");
  page.addEventListener("input", () => { readEditor(); queueLivePreview(); });
  page.addEventListener("change", (e) => {
    if (e.target.matches("[data-f=kind]")) {
      const i = Number(e.target.closest("[data-i]").dataset.i);
      const kind = e.target.value;
      const def = live.meta.kinds[kind];
      live.editing.effects[i] = { kind, ...(def.value === "mult" ? { value: 2 } : def.value === "percent" ? { value: 25 } : def.value === "count" ? { value: 5 } : {}), ...(def.match ? { match: {} } : {}), ...(kind === "discount" ? { categories: [] } : {}) };
      drawEffects();
    } else readEditor();
    queueLivePreview();
  });
  page.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]");
    if (rm) { live.editing.effects.splice(Number(rm.dataset.remove), 1); drawEffects(); queueLivePreview(); }
  });
  $("#leAdd").addEventListener("click", () => { live.editing.effects.push(blankEffect()); drawEffects(); queueLivePreview(); });
  $("#leSave")?.addEventListener("click", saveLiveEvent);
  queueLivePreview(0);
}

function multiCheck(name, options, chosen, label = (o) => o) {
  return `<div class="live-checks" data-multi="${name}">${options.map((o) => `<label class="inline"><input type="checkbox" value="${esc(o)}" ${chosen.includes(o) ? "checked" : ""} /> ${esc(label(o))}</label>`).join("")}</div>`;
}

function drawEffects() {
  const m = live.meta;
  const kinds = Object.entries(m.kinds);
  const groups = [...new Set(kinds.map(([, d]) => d.group))];
  const kindSelect = (cur) => `<select data-f="kind">${groups.map((g) => `<optgroup label="${esc(g)}">${kinds.filter(([, d]) => d.group === g).map(([k, d]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</optgroup>`).join("")}</select>`;
  $("#leEffects").innerHTML = live.editing.effects.length ? live.editing.effects.map((f, i) => {
    const def = m.kinds[f.kind];
    const mt = f.match || {};
    const can = (k) => (def.match || []).includes(k);
    const species = (mt.species || []).map((id) => { const s = state.catalog.speciesById.get(Number(id)); return s ? `${s.name} #${s.id}` : `#${id}`; }).join(", ");
    return `<div class="live-effect" data-i="${i}">
      <div class="field-row">
        <label>Effect${kindSelect(f.kind)}</label>
        ${def.value === "mult" ? `<label>Multiplier (×)<input data-f="value" type="number" step="any" min="0" value="${esc(f.value)}" /></label>` : ""}
        ${def.value === "percent" ? `<label>Discount (%)<input data-f="value" type="number" min="1" max="100" value="${esc(f.value)}" /></label>` : ""}
        ${def.value === "count" ? `<label>Extra battles per day<input data-f="value" type="number" min="1" step="1" value="${esc(f.value)}" /></label>` : ""}
        <button class="btn-sm btn-ghost-danger" data-remove="${i}" type="button">Remove</button>
      </div>
      ${f.kind === "exp" ? `<p class="faint">Leave types empty for every Pokémon.</p>` : ""}
      ${can("types") ? `<h3>Types</h3>${multiCheck("types", m.types, mt.types || [])}` : ""}
      ${can("regions") ? `<h3>Regions</h3>${multiCheck("regions", m.regions, mt.regions || [])}` : ""}
      ${can("tiers") ? `<h3>Tiers</h3>${multiCheck("tiers", m.tiers, mt.tiers || [])}` : ""}
      ${can("species") ? `<label>Species (comma-separated)<input data-f="species" list="leSpeciesList" value="${esc(species)}" placeholder="e.g. Pikachu, Eevee" /></label>` : ""}
      ${f.kind === "discount" ? `<h3>Shop categories</h3>${multiCheck("categories", Object.keys(m.categories), f.categories || [], (c) => m.categories[c])}` : ""}
      ${def.match && ["types", "regions", "tiers", "species"].filter(can).length > 1 ? `<p class="faint">Pick several kinds and a Pokémon must match all of them (Kanto + Water = Kanto Water-types).</p>` : ""}
    </div>`;
  }).join("") + `<datalist id="leSpeciesList">${speciesOptions(true)}</datalist>` : `<p class="muted">No effects yet.</p>`;
}

function readEditor() {
  const ev = live.editing;
  ev.name = $("#leName").value;
  if (!$("#leStart").disabled) ev.startAt = fromLocalInput($("#leStart").value);
  ev.endAt = fromLocalInput($("#leEnd").value);
  $$("#leEffects .live-effect").forEach((row) => {
    const f = ev.effects[Number(row.dataset.i)];
    const v = $("[data-f=value]", row);
    if (v) f.value = Number(v.value);
    $$("[data-multi]", row).forEach((box) => {
      const vals = $$("input:checked", box).map((c) => c.value);
      if (box.dataset.multi === "categories") f.categories = vals;
      else f.match = { ...(f.match || {}), [box.dataset.multi]: vals };
    });
    const sp = $("[data-f=species]", row);
    if (sp) {
      const ids = sp.value.split(",").map((s) => s.trim()).filter(Boolean).map((s) => speciesFromInput(s)?.id ?? NaN);
      f.match = { ...(f.match || {}), species: ids };
    }
  });
}

const payload = () => {
  const ev = live.editing;
  return { name: ev.name, startAt: ev.startAt, endAt: ev.endAt, effects: ev.effects };
};

function queueLivePreview(delay = 350) {
  clearTimeout(live.previewTimer);
  live.previewTimer = setTimeout(runLivePreview, delay);
}

async function runLivePreview() {
  const out = $("#lePreview");
  if (!out || !live.editing) return;
  if (state.session?.readOnly) return (out.innerHTML = `<p class="muted">Preview needs a Discord admin session.</p>`);
  const r = await api("/api/admin/live-events/preview", { method: "POST", body: { id: live.editing.id, event: payload(), ball: $("#leBall").value } });
  if (!r.ok) return (out.innerHTML = `<div class="error-box">${esc(r.error)}</div>`);
  if (!r.valid) {
    out.innerHTML = `<div class="error-box">${esc(r.error)}</div>`;
    $("#leSave") && ($("#leSave").disabled = true);
    return;
  }
  $("#leSave") && ($("#leSave").disabled = false);
  const list = `<ul class="live-effects">${r.effects.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
  if (!r.odds) return (out.innerHTML = `${list}<p class="muted">No Catch boost or limit, so catch odds don't change.</p>`);
  const o = r.odds;
  const tiers = Object.keys(o.normal.tiers);
  out.innerHTML = `${list}
    ${o.alsoRunning.length ? `<p class="muted">Also running then: ${esc(o.alsoRunning.join(", "))}. The odds include them.</p>` : ""}
    <p class="muted">A Novice player's roll, before Rank bonuses. Paid rolls only use the event if the player turns it on.</p>
    <div class="table-wrap"><table>
      <thead><tr><th></th><th class="num">Species</th>${tiers.map((t) => `<th class="num">${tierChip(t)}</th>`).join("")}</tr></thead>
      <tbody>
        <tr><td>Normally</td><td class="num">${fmt(o.normal.species)}</td>${tiers.map((t) => `<td class="num">${pct(o.normal.tiers[t])}</td>`).join("")}</tr>
        <tr><td><strong>During this event</strong></td><td class="num">${fmt(o.during.species)}</td>${tiers.map((t) => `<td class="num">${pct(o.during.tiers[t])}</td>`).join("")}</tr>
      </tbody></table></div>
    <h3 style="margin-top:12px">Most likely single Pokémon during the event</h3>
    <div class="table-wrap"><table><thead><tr><th>Pokémon</th><th>Tier</th><th class="num">Chance</th><th class="num">Normally</th></tr></thead>
      <tbody>${o.during.top.map((s) => `<tr><td>${esc(s.name)}</td><td>${tierChip(s.tier)}</td><td class="num">${pct(s.chance)}</td><td class="num">${pct(s.before)}</td></tr>`).join("")}</tbody></table></div>`;
}

async function saveLiveEvent() {
  readEditor();
  const reason = $("#leReason").value.trim();
  if (!reason) return toast("A reason is required.", true);
  const ev = live.editing;
  const btn = $("#leSave");
  btn.disabled = true;
  const r = await api(ev.id ? `/api/admin/live-events/${ev.id}/edit` : "/api/admin/live-events", { method: "POST", body: { event: payload(), reason } });
  btn.disabled = false;
  if (!r.ok) return toast(r.error, true);
  toast(ev.id ? "Saved." : "Scheduled.");
  live.meta = null;
  location.hash = "#/live";
}

// ----------------------------------------------------------
// Start
// ----------------------------------------------------------
(async function start() {
  const s = await api("/api/admin/session");
  if (s.ok) {
    state.session = s;
    $("#sessionInfo").textContent = `Signed in as ${s.name || s.id}${s.readOnly ? " (read-only)" : ""}`;
  }
  if (!location.hash) location.hash = "#/overview";
  else route();
})();
