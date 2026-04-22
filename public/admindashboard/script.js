// ==========================================================
// admindashboard/script.js
// ----------------------------------------------------------
// Front-end for the admin analytics dashboard. Fetches from
// /api/admin/* endpoints (all guarded by the admin_session
// cookie set via /auth/admin). Entirely read-only for now.
//
// Failure mode: any 403 from the API is treated as a stale
// session and triggers the full-page "session expired" banner
// with instructions to re-run /admindashboard in Discord.
// ==========================================================

(() => {
  "use strict";

  // ----------------------------------------------------------
  // 🌐 API helpers
  // ----------------------------------------------------------
  /**
   * Wrapper around fetch that:
   *   - Sends cookies (credentials: "include")
   *   - Shows the session expired banner on 403
   *   - Returns parsed JSON or throws
   */
  async function apiFetch(path) {
    const res = await fetch(path, { credentials: "include" });
    if (res.status === 403) {
      showSessionExpired();
      throw new Error("session_expired");
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  }

  // ----------------------------------------------------------
  // 🔒 Session expired handler
  // ----------------------------------------------------------
  // Hide every normal panel and show the red banner. One-way —
  // refreshing the page is the only recovery path.
  function showSessionExpired() {
    document.getElementById("sessionBanner").hidden = false;
    const toHide = ["summary", "usersPanel", "eventsPanel", "tabNav"];
    for (const id of toHide) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    const panels = document.querySelectorAll(".panel");
    panels.forEach((p) => { p.hidden = true; });
  }

  // ----------------------------------------------------------
  // 🔢 Formatting helpers
  // ----------------------------------------------------------
  const nf = new Intl.NumberFormat("en-US");

  function fmtNumber(n) {
    if (n == null || !Number.isFinite(Number(n))) return "0";
    return nf.format(Number(n));
  }

  /** Relative time string ("3m ago", "—" if never). */
  function fmtRelative(ts) {
    if (!ts) return "—";
    const diff = Date.now() - Number(ts);
    if (diff < 0) return "just now";
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(Number(ts)).toLocaleDateString();
  }

  function fmtDateTime(ts) {
    if (!ts) return "";
    return new Date(Number(ts)).toLocaleString();
  }

  // ==========================================================
  // 📊 Summary cards + leaderboard
  // ==========================================================
  async function loadStats() {
    try {
      const s = await apiFetch("/api/admin/stats");

      document.getElementById("statTotalUsers").textContent = fmtNumber(s.totalUsers);
      document.getElementById("statOnboarded").textContent =
        `${fmtNumber(s.onboarded)} onboarded`;
      document.getElementById("statActive24h").textContent = fmtNumber(s.active24h);
      document.getElementById("statActive7d").textContent = fmtNumber(s.active7d);
      document.getElementById("statTotalCC").textContent = fmtNumber(s.totalCC);
      document.getElementById("statTotalTP").textContent = fmtNumber(s.totalTP);
      document.getElementById("statPokemonVariants").textContent = fmtNumber(s.totalPokemonVariants);
      document.getElementById("statPokemonSpecies").textContent = fmtNumber(s.totalPokemonSpecies);
      document.getElementById("statTrainers").textContent = fmtNumber(s.totalTrainers);

      const top = document.getElementById("topByTp");
      top.innerHTML = "";
      (s.topByTp || []).forEach((u, i) => {
        const li = document.createElement("li");
        li.innerHTML = `
          <span>
            <span class="rank-badge">#${i + 1}</span>
            ${escapeHtml(u.name || "(unnamed)")}
            <span style="color:var(--muted);font-size:11px">${escapeHtml(u.rank || "")}</span>
          </span>
          <span>${fmtNumber(u.tp)} TP</span>
        `;
        li.addEventListener("click", () => openUser(u.userId));
        li.style.cursor = "pointer";
        top.appendChild(li);
      });
    } catch (e) {
      if (e.message !== "session_expired") console.error("loadStats:", e);
    }
  }

  // ==========================================================
  // 👥 Users table — client-side sort + search
  // ==========================================================
  // We load all users once (summary fields only — cheap) and
  // then sort/filter entirely in the browser. Keeps the UI
  // responsive and avoids paginating the API at this scale.
  let userRows = [];
  let sortKey = "tp";
  let sortDir = "desc";
  let searchTerm = "";

  async function loadUsers() {
    try {
      const data = await apiFetch("/api/admin/users");
      userRows = data.users || [];
      renderUsers();
    } catch (e) {
      if (e.message !== "session_expired") console.error("loadUsers:", e);
    }
  }

  function renderUsers() {
    const tbody = document.getElementById("usersBody");
    if (!tbody) return;

    const q = searchTerm.trim().toLowerCase();
    const filtered = q
      ? userRows.filter((u) => (u.name || "").toLowerCase().includes(q))
      : userRows.slice();

    const dir = sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "string" || typeof bv === "string") {
        return String(av || "").localeCompare(String(bv || "")) * dir;
      }
      return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
    });

    tbody.innerHTML = filtered.map((u) => `
      <tr data-user-id="${escapeAttr(u.userId)}">
        <td>${escapeHtml(u.name || "(unnamed)")}</td>
        <td>${escapeHtml(u.rank || "")}</td>
        <td>${fmtNumber(u.tp)}</td>
        <td>${fmtNumber(u.cc)}</td>
        <td>${fmtNumber(u.pokemonCount)}</td>
        <td>${fmtNumber(u.trainerCount)}</td>
        <td>${fmtRelative(u.lastActive)}</td>
      </tr>
    `).join("");

    // Sort indicator on the active column
    document.querySelectorAll("thead th[data-sort]").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === sortKey) {
        th.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
      }
    });

    tbody.querySelectorAll("tr").forEach((row) => {
      row.addEventListener("click", () => openUser(row.dataset.userId));
    });
  }

  // ==========================================================
  // 🔍 User drill-down modal
  // ==========================================================
  async function openUser(userId) {
    if (!userId) return;
    const modal = document.getElementById("userModal");
    const body = document.getElementById("modalBody");
    const title = document.getElementById("modalTitle");
    modal.hidden = false;
    title.textContent = `User ${userId}`;
    body.textContent = "Loading…";

    try {
      const data = await apiFetch(`/api/admin/user/${encodeURIComponent(userId)}`);
      const u = data.user || {};
      title.textContent = `${u.name || "(unnamed)"} — ${userId}`;

      const pokemonList = Object.entries(u.pokemon || {})
        .map(([pid, v]) => `${pid}: ${v.normal || 0}N / ${v.shiny || 0}S`)
        .join("\n") || "(none)";

      const trainerList = Array.isArray(u.trainers)
        ? u.trainers.join(", ")
        : Object.keys(u.trainers || {}).join(", ") || "(none)";

      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px">
          ${kv("Rank", u.rank)}
          ${kv("TP", fmtNumber(u.tp))}
          ${kv("CC", fmtNumber(u.cc))}
          ${kv("Shiny Dust", fmtNumber(u?.items?.shiny_dust))}
          ${kv("Evolution Stones", fmtNumber(u?.items?.evolution_stone))}
          ${kv("Last Daily", u.lastDaily || "—")}
          ${kv("Last Recruit", fmtRelative(u.lastRecruit))}
          ${kv("Last Quest", fmtRelative(u.lastQuest))}
        </div>
        <h3>Pokémon (${Object.keys(u.pokemon || {}).length} species)</h3>
        <pre>${escapeHtml(pokemonList)}</pre>
        <h3>Trainers</h3>
        <pre>${escapeHtml(trainerList)}</pre>
        <h3>Raw Record</h3>
        <pre>${escapeHtml(JSON.stringify(u, null, 2))}</pre>
      `;
    } catch (e) {
      if (e.message !== "session_expired") {
        body.textContent = `Failed to load user: ${e.message}`;
      }
    }
  }

  function kv(label, value) {
    return `
      <div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">${escapeHtml(label)}</div>
        <div style="font-size:14px;font-weight:600">${escapeHtml(String(value ?? "—"))}</div>
      </div>
    `;
  }

  // ==========================================================
  // 📜 Event log tab
  // ==========================================================
  // Pagination is server-driven (total + offset). Keeps the
  // browser memory footprint bounded even with ~30k events.
  const EVENT_PAGE_SIZE = 50;
  let eventOffset = 0;
  let eventTotal = 0;

  async function loadEvents() {
    const typeFilter = document.getElementById("eventTypeFilter").value;
    const userFilter = document.getElementById("eventUserFilter").value.trim();

    const params = new URLSearchParams();
    if (typeFilter) params.set("type", typeFilter);
    if (userFilter) params.set("userId", userFilter);
    params.set("limit", String(EVENT_PAGE_SIZE));
    params.set("offset", String(eventOffset));

    try {
      const data = await apiFetch(`/api/admin/events?${params.toString()}`);
      eventTotal = data.total || 0;

      const list = document.getElementById("eventList");
      list.innerHTML = (data.events || []).map((e) => `
        <li>
          <span class="event-time">${escapeHtml(fmtDateTime(e.timestamp))}</span>
          <span class="event-type">${escapeHtml(e.type)}</span>
          <span class="event-body">
            <span class="event-user">${escapeHtml(e.userId)}</span>
            ${escapeHtml(summarizeEventData(e))}
          </span>
        </li>
      `).join("") || "<li style='color:var(--muted)'>No events match.</li>";

      const shown = Math.min(eventOffset + EVENT_PAGE_SIZE, eventTotal);
      document.getElementById("eventMeta").textContent =
        `${fmtNumber(eventTotal)} events total`;
      document.getElementById("eventPageInfo").textContent =
        eventTotal === 0 ? "—" : `${eventOffset + 1}–${shown} of ${fmtNumber(eventTotal)}`;

      document.getElementById("eventPrev").disabled = eventOffset === 0;
      document.getElementById("eventNext").disabled = eventOffset + EVENT_PAGE_SIZE >= eventTotal;
    } catch (e) {
      if (e.message !== "session_expired") console.error("loadEvents:", e);
    }
  }

  /**
   * Render the event-specific data blob as a short human line.
   * We could render full JSON but the table would be unreadable —
   * this keeps the log scannable.
   */
  function summarizeEventData(ev) {
    const d = ev.data || {};
    switch (ev.type) {
      case "roll":
        return `${d.ball || "?"} → ${d.pokemonName || "?"} (${d.tier || "?"})${d.shiny ? " ✨" : ""}`;
      case "donate":
        return `${d.pokemonName || "?"} (${d.tier || "?"}, ${d.variant || "normal"}) → +${fmtNumber(d.ccGained)} CC${d.dustGained ? `, +${d.dustGained} dust` : ""}`;
      case "evolve":
        return `${d.fromName || "?"} → ${d.toName || "?"} (${d.variant || "normal"}, ${d.stoneCost}💎${d.dustCost ? ` +${d.dustCost} dust` : ""})`;
      case "convert":
        return `${d.pokemonName || "?"} → shiny (${d.dustCost} dust)`;
      case "daily_claim": {
        const mons = (d.pokemon || []).map((p) => p.pokemonName).join(", ");
        return `+${fmtNumber(d.ccAwarded)} CC, +${fmtNumber(d.tpAwarded)} TP${d.stoneAwarded ? ", +1💎" : ""}, [${mons}]`;
      }
      case "weekly_claim": {
        const mons = (d.rewards || []).map((r) => r.pokemonName).join(", ");
        return `[${mons}]`;
      }
      case "quest_claim":
        return d.rewardType === "trainer"
          ? `trainer: ${d.trainerName || "?"} (+${d.ccAwarded} CC)`
          : `pokemon: ${d.pokemonName || "?"} (${d.tier || "?"})${d.shiny ? " ✨" : ""} (+${d.ccAwarded} CC)`;
      case "recruit":
        return d.rewardType === "trainer"
          ? `trainer: ${d.trainerName || "?"} (-${d.ccSpent} CC)`
          : `pokemon: ${d.pokemonName || "?"} (${d.tier || "?"})${d.shiny ? " ✨" : ""} (-${d.ccSpent} CC)`;
      case "stone_purchase":
        return `-${fmtNumber(d.cost)} CC → stones: ${d.stonesAfter}`;
      default:
        return JSON.stringify(d);
    }
  }

  // ==========================================================
  // 🛡️ HTML escaping — rendered data comes from trainerData
  // which is largely user-supplied (names). Always escape.
  // ==========================================================
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ==========================================================
  // 🎛️ Wire up UI
  // ==========================================================
  function init() {
    // Column header clicks toggle sort
    document.querySelectorAll("thead th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (sortKey === key) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = key;
          // Numeric columns default to descending (top scores first);
          // name column defaults to ascending (alphabetical).
          sortDir = key === "name" ? "asc" : "desc";
        }
        renderUsers();
      });
    });

    document.getElementById("userSearch").addEventListener("input", (e) => {
      searchTerm = e.target.value;
      renderUsers();
    });

    document.getElementById("modalClose").addEventListener("click", () => {
      document.getElementById("userModal").hidden = true;
    });
    document.querySelector("#userModal .modal-backdrop").addEventListener("click", () => {
      document.getElementById("userModal").hidden = true;
    });

    // Tab switching
    document.getElementById("tabUsers").addEventListener("click", () => {
      document.getElementById("tabUsers").classList.add("active");
      document.getElementById("tabEvents").classList.remove("active");
      document.getElementById("usersPanel").hidden = false;
      document.getElementById("eventsPanel").hidden = true;
    });
    document.getElementById("tabEvents").addEventListener("click", () => {
      document.getElementById("tabEvents").classList.add("active");
      document.getElementById("tabUsers").classList.remove("active");
      document.getElementById("usersPanel").hidden = true;
      document.getElementById("eventsPanel").hidden = false;
      loadEvents();
    });

    // Event log filters
    document.getElementById("eventRefresh").addEventListener("click", () => {
      eventOffset = 0;
      loadEvents();
    });
    document.getElementById("eventTypeFilter").addEventListener("change", () => {
      eventOffset = 0;
      loadEvents();
    });
    document.getElementById("eventUserFilter").addEventListener("change", () => {
      eventOffset = 0;
      loadEvents();
    });
    document.getElementById("eventPrev").addEventListener("click", () => {
      eventOffset = Math.max(0, eventOffset - EVENT_PAGE_SIZE);
      loadEvents();
    });
    document.getElementById("eventNext").addEventListener("click", () => {
      eventOffset += EVENT_PAGE_SIZE;
      loadEvents();
    });

    loadStats();
    loadUsers();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
