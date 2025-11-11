/* ===========================================================
   Coop’s Collection — Pokémon Picker
   ===========================================================
   Modes: 
     🟢 Change Team
     🧬 Evolve
     💝 Donate
   Includes:
     • Sticky + compact HUD
     • Pulse animations for stat changes
     • Shiny-aware rendering
     • Tier + cost display on evolutions
     • Owned/Unowned toggles for Team mode
=========================================================== */

let userId, userToken;
let userData = {};
let pokemonData = {};
let currentMode = "team"; // "team" | "evolve" | "donate"
let shinyMode = false;
let selectedTeam = [];
let activePokemon = null;

// NEW: Owned/Unowned view flags (Team mode UI)
let showOwned = true;
let showUnowned = true;

// ===========================================================
// 🧠 Utility Constants
// ===========================================================
const COST_MAP = {
  "common-uncommon": 1,
  "common-rare": 3,
  "uncommon-rare": 2,
  "rare-epic": 3,
  "uncommon-epic": 4,
};
const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

// Helper: get evolution list from either key
function getEvoList(p) {
  return p?.evolvesTo || p?.evolves_to || [];
}

// ===========================================================
// 🌐 API Utilities
// ===========================================================
async function fetchUserData() {
  const params = new URLSearchParams({ id: userId, token: userToken });
  const res = await fetch(`/api/user-pokemon?${params}`);
  if (!res.ok) throw new Error("Failed to fetch user data");
  userData = await res.json();
  // normalize minimal structure
  userData.items ??= { evolution_stone: 0 };
  userData.pokemon ??= {};
  userData.currentTeam ??= [];
  return userData;
}

async function saveTeam() {
  const body = { id: userId, token: userToken, team: selectedTeam };
  const res = await fetch("/api/set-pokemon-team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function evolvePokemon(baseId, targetId) {
  const body = { id: userId, token: userToken, baseId, targetId, shiny: shinyMode };
  const res = await fetch("/api/pokemon/evolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function donatePokemon(pokeId) {
  const body = { id: userId, token: userToken, pokeId, shiny: shinyMode };
  const res = await fetch("/api/pokemon/donate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ===========================================================
// 🎨 HUD — Sticky + Compact
// ===========================================================
function initStickyHUD() {
  const bar = document.getElementById("statsBar");
  if (!bar) return;
  window.addEventListener("scroll", () => {
    if (window.scrollY > 100) bar.classList.add("compact");
    else bar.classList.remove("compact");
  });
}

// Counter pulse animation helper
function flashCounter(id, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.setProperty("--pulse-color", color);
  el.classList.add("pulse");
  setTimeout(() => el.classList.remove("pulse"), 400);
}

function updateHUD() {
  const stones = userData.items?.evolution_stone ?? 0;
  const cc = userData.cc ?? 0;
  const tp = userData.tp ?? 0;
  const rank = userData.rank ?? "Novice";

  const stoneEl = document.getElementById("stoneCount");
  const ccEl = document.getElementById("ccCount");
  const tpEl = document.getElementById("tpCount");
  const rankEl = document.getElementById("rankLabel") || document.getElementById("rankName");

  if (stoneEl) stoneEl.textContent = stones;
  if (ccEl) ccEl.textContent = cc;
  if (tpEl) tpEl.textContent = tp;
  if (rankEl) rankEl.textContent = rank;
}

// Smooth pulse on stat change
function refreshStats(newData, prevData) {
  const stonesBefore = prevData.items?.evolution_stone ?? 0;
  const stonesAfter = newData.items?.evolution_stone ?? 0;
  const ccBefore = prevData.cc ?? 0;
  const ccAfter = newData.cc ?? 0;

  if (stonesAfter < stonesBefore) flashCounter("stoneCount", "#ef4444");
  if (ccAfter > ccBefore) flashCounter("ccCount", "#10b981");
  if ((newData.tp ?? 0) > (prevData.tp ?? 0)) flashCounter("tpCount", "#00ff9d");

  updateHUD();
}

// ===========================================================
// 🧩 Mode Switching
// ===========================================================
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  renderPokemonGrid();
}

// ===========================================================
// 🌟 Shiny Toggle + Owned/Unowned Toggles
// ===========================================================
function initShinyToggle() {
  const toggle = document.getElementById("toggleShiny");
  if (toggle) {
    toggle.addEventListener("click", () => {
      shinyMode = !shinyMode;
      toggle.classList.toggle("active", shinyMode);
      toggle.textContent = shinyMode ? "🌟 Shiny Mode: ON" : "✨ Shiny Mode: OFF";
      renderPokemonGrid();
    });
  }

  const ownedBtn = document.getElementById("toggleOwned");
  if (ownedBtn) {
    ownedBtn.classList.toggle("active", showOwned);
    ownedBtn.textContent = showOwned ? "✅ Show Owned" : "🚫 Hide Owned";
    ownedBtn.addEventListener("click", () => {
      showOwned = !showOwned;
      ownedBtn.classList.toggle("active", showOwned);
      ownedBtn.textContent = showOwned ? "✅ Show Owned" : "🚫 Hide Owned";
      renderPokemonGrid();
    });
  }

  const unownedBtn = document.getElementById("toggleUnowned");
  if (unownedBtn) {
    unownedBtn.classList.toggle("active", showUnowned);
    unownedBtn.textContent = showUnowned ? "✅ Show Unowned" : "❌ Hide Unowned";
    unownedBtn.addEventListener("click", () => {
      showUnowned = !showUnowned;
      unownedBtn.classList.toggle("active", showUnowned);
      unownedBtn.textContent = showUnowned ? "✅ Show Unowned" : "❌ Hide Unowned";
      renderPokemonGrid();
    });
  }
}

// ===========================================================
// 🧬 Eligibility Checks
// ===========================================================
function getEvolutionCost(base, target) {
  const key = `${base.tier}-${target.tier}`;
  return COST_MAP[key] ?? 0;
}

function isEvolutionEligible(pokeId) {
  const p = pokemonData[pokeId];
  const evos = getEvoList(p);
  if (!evos.length) return false;
  const target = pokemonData[evos[0]];
  if (!target) return false;
  const cost = getEvolutionCost(p, target);
  const stones = userData.items?.evolution_stone ?? 0;
  return stones >= cost;
}

function ownedCountForVariant(id) {
  const entry = userData.pokemon?.[id];
  if (!entry) return { normal: 0, shiny: 0, any: 0 };
  const normal = Number(entry.normal ?? 0);
  const shiny = Number(entry.shiny ?? 0);
  return { normal, shiny, any: normal + shiny };
}

// ===========================================================
// 🎴 Pokémon Grid Renderer
// ===========================================================
function renderPokemonGrid() {
  const container = document.getElementById("pokemonGrid");
  if (!container) return;
  container.innerHTML = "";

  const searchEl = document.getElementById("searchInput");
  const rarityEl = document.getElementById("rarityFilter");
  const typeEl = document.getElementById("typeFilter");

  const search = (searchEl?.value || "").toLowerCase().trim();
  const rarityFilter = rarityEl?.value || "";
  const typeFilter = typeEl?.value || "";

  // Build list depending on mode:
  // • team: all Pokémon (apply owned/unowned toggles)
  // • evolve/donate: ONLY owned (variant-aware)
  let ids = Object.keys(pokemonData).map(Number);

  // sort by rarity then id
  ids.sort((a, b) => {
    const ra = RARITY_ORDER.indexOf(pokemonData[a]?.tier || "common");
    const rb = RARITY_ORDER.indexOf(pokemonData[b]?.tier || "common");
    if (ra !== rb) return ra - rb;
    return a - b;
  });

  let shown = 0;

  for (const id of ids) {
    const p = pokemonData[id];
    if (!p) continue;

    const types = p.types || [];
    const name = p.name || `#${id}`;

    if (search && !name.toLowerCase().includes(search)) continue;
    if (rarityFilter && p.tier !== rarityFilter) continue;
    if (typeFilter && !types.includes(typeFilter)) continue;

    const ownedCounts = ownedCountForVariant(id);
    const isOwnedVariant = shinyMode ? ownedCounts.shiny > 0 : ownedCounts.normal > 0;
    const isOwnedAny = ownedCounts.any > 0;

    // Mode-specific visibility
    if (currentMode === "evolve" || currentMode === "donate") {
      // Only show OWNED of the selected variant
      if (!isOwnedVariant) continue;
    } else {
      // Team mode — obey toggles (default both true = show all)
      if (isOwnedAny && !showOwned) continue;
      if (!isOwnedAny && !showUnowned) continue;
    }

    // Sprite path logic
    let spritePath;
    if (shinyMode) {
      spritePath = `/public/sprites/pokemon/shiny/${id}.gif`;
    } else if (currentMode === "team" && !isOwnedAny) {
      spritePath = `/public/sprites/pokemon/grayscale/${id}.gif`;
    } else {
      spritePath = `/public/sprites/pokemon/normal/${id}.gif`;
    }

    // Card
    const card = document.createElement("div");
    card.className = "pokemon-card";
    card.dataset.id = id;

    // Locked overlay for evolve if not eligible (still hidden by owned-only above)
    let locked = false;
    if (currentMode === "evolve" && !isEvolutionEligible(id)) locked = true;

    // Owned count badge (show any total in Team, variant count in Evolve/Donate)
    const displayCount =
      currentMode === "team"
        ? ownedCounts.any
        : shinyMode
        ? ownedCounts.shiny
        : ownedCounts.normal;

    const teamIndex = selectedTeam.indexOf(Number(id));

    card.innerHTML = `
      <div class="sprite-wrapper">
        <img src="${spritePath}" class="poke-sprite ${locked ? "locked" : ""}" alt="${name}">
        ${teamIndex >= 0 ? `<div class="team-badge">${teamIndex + 1}</div>` : ""}
        ${locked ? `<div class="lock-overlay"><span>🔒</span></div>` : ""}
        ${displayCount > 0 ? `<div class="count-label">x${displayCount}</div>` : ""}
      </div>
      <div class="pokemon-name">${name}</div>
      <div class="pokemon-tier">
  <div class="tier-emoji">${rarityEmojis[p.tier] || ""}</div>
  <div class="tier-text" style="color:${rarityColors[p.tier] || "#ccc"};">
    ${p.tier}
  </div>
</div>

    `;

    if (!locked) {
      card.addEventListener("click", () => onPokemonClick(id));
    } else {
      card.classList.add("ineligible");
    }

    container.appendChild(card);
    shown++;
  }

  if (shown === 0) {
    container.innerHTML = `<p class="empty-msg">No Pokémon found for this mode.</p>`;
  }
}

// ===========================================================
// 🧭 Mode Click Logic
// ===========================================================
function onPokemonClick(pokeId) {
  if (currentMode === "team") handleTeamSelection(pokeId);
  else if (currentMode === "evolve") openEvolutionModal(pokeId);
  else if (currentMode === "donate") openDonationModal(pokeId);
}

function handleTeamSelection(pokeId) {
  const idx = selectedTeam.indexOf(Number(pokeId));
  if (idx > -1) selectedTeam.splice(idx, 1);
  else if (selectedTeam.length < 6) selectedTeam.push(Number(pokeId));

  // Re-render to refresh slot numbers and selection
  renderPokemonGrid();
}

// ===========================================================
// 🚀 Initialization
// ===========================================================
async function init() {
  // Pull query params
  const url = new URL(window.location.href);
  userId = url.searchParams.get("id");
  userToken = url.searchParams.get("token");
  if (!userId || !userToken) {
    document.body.innerHTML = "<p>Missing credentials.</p>";
    return;
  }

  try {
    const [pokeRes, userRes] = await Promise.all([
      fetch("/public/pokemonData.json").then(r => r.json()),
      fetchUserData(),
    ]);
    pokemonData = pokeRes;
    userData = userRes;

    // Initialize selected team
    selectedTeam = Array.isArray(userData.currentTeam) ? [...userData.currentTeam] : [];

    updateHUD();
    initStickyHUD();
    initShinyToggle();
    renderPokemonGrid();

    // Hook mode buttons
    document.querySelectorAll(".mode-btn").forEach(btn =>
      btn.addEventListener("click", () => setMode(btn.dataset.mode))
    );

    // Hook save button (support either id)
    const saveBtn = document.getElementById("saveTeamBtn") || document.getElementById("saveTeam");
    if (saveBtn) saveBtn.addEventListener("click", async () => {
      const res = await saveTeam();
      const status = document.getElementById("statusMsg");
      if (res.success) {
        if (status) {
          status.textContent = "✅ Team saved!";
          status.classList.remove("error");
          status.classList.add("success");
          setTimeout(() => (status.textContent = ""), 2500);
        } else {
          alert("✅ Team saved!");
        }
      } else {
        if (status) {
          status.textContent = "❌ Failed to save team";
          status.classList.remove("success");
          status.classList.add("error");
        } else {
          alert("❌ Failed to save team");
        }
      }
    });
  } catch (err) {
    console.error(err);
    document.body.innerHTML = `<p>Error loading data: ${err.message}</p>`;
  }
}

window.addEventListener("DOMContentLoaded", init);

// ===========================================================
// 🧩 Modal System
// ===========================================================
function createOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay visible";
  document.body.appendChild(overlay);
  return overlay;
}

function closeOverlay(overlay) {
  if (!overlay) return;
  overlay.classList.remove("visible");
  setTimeout(() => overlay.remove(), 200);
}

// ===========================================================
// 🧬 EVOLUTION MODAL
// ===========================================================
function openEvolutionModal(baseId) {
  const base = pokemonData[baseId];
  const evoList = getEvoList(base);
  if (!evoList.length) return;

  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.className = "modal evo-modal fade-in";

  const baseSprite = shinyMode
    ? `/public/sprites/pokemon/shiny/${baseId}.gif`
    : `/public/sprites/pokemon/normal/${baseId}.gif`;

  modal.innerHTML = `
    <h2>🧬 Choose Evolution</h2>
    <div class="evo-current">
      <img src="${baseSprite}" class="poke-sprite large" alt="${base.name}">
      <span class="arrow">➡️</span>
    </div>
    <div class="evo-grid"></div>
    <div class="modal-actions">
      <button class="cancel-btn">Cancel</button>
      <button class="confirm-btn" disabled>Confirm Evolution</button>
    </div>
  `;

  const grid = modal.querySelector(".evo-grid");
  let selectedTarget = null;

  evoList.forEach(targetId => {
    const target = pokemonData[targetId];
    if (!target) return;
    const sprite = shinyMode
      ? `/public/sprites/pokemon/shiny/${targetId}.gif`
      : `/public/sprites/pokemon/normal/${targetId}.gif`;
    const cost = getEvolutionCost(base, target);
    const stones = userData.items?.evolution_stone ?? 0;
    const enough = stones >= cost;

    const card = document.createElement("div");
    card.className = `evo-option ${enough ? "" : "locked"}`;
    card.innerHTML = `
      <img src="${sprite}" class="poke-sprite small ${enough ? "" : "locked"}" alt="${target.name}">
      <div class="poke-name">${target.name}</div>
      <div class="poke-tier ${target.tier}">${target.tier}</div>
      <div class="cost">🪨 ${cost}</div>
      ${!enough ? `<div class="lock-icon">🔒</div>` : ""}
    `;
    if (enough) {
      card.addEventListener("click", () => {
        grid.querySelectorAll(".evo-option").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        selectedTarget = targetId;
        modal.querySelector(".confirm-btn").disabled = false;
      });
    }
    grid.appendChild(card);
  });

  modal.querySelector(".cancel-btn").addEventListener("click", () => closeOverlay(overlay));
  modal.querySelector(".confirm-btn").addEventListener("click", async () => {
    if (!selectedTarget) return;
    modal.querySelector(".confirm-btn").disabled = true;
    await handleEvolutionConfirm(baseId, selectedTarget, overlay);
  });

  overlay.appendChild(modal);
}

async function handleEvolutionConfirm(baseId, targetId, overlay) {
  const base = pokemonData[baseId];
  const target = pokemonData[targetId];
  const res = await evolvePokemon(baseId, targetId);

  if (!res.success) {
    alert("❌ " + (res.error || "Evolution failed."));
    closeOverlay(overlay);
    return;
  }

  // Pre-confirmation was the selection modal; now show success
  const newOverlay = createOverlay();
  const modal = document.createElement("div");
  modal.className = "modal success-modal fade-in";
  const targetSprite = shinyMode
    ? `/public/sprites/pokemon/shiny/${targetId}.gif`
    : `/public/sprites/pokemon/normal/${targetId}.gif`;
  modal.innerHTML = `
    <h2>✨ ${base.name} evolved into ${target.name}!</h2>
    <img src="${targetSprite}" class="poke-sprite large" alt="${target.name}">
    <button class="ok-btn">OK</button>
  `;
  modal.querySelector(".ok-btn").addEventListener("click", () => closeOverlay(newOverlay));
  newOverlay.appendChild(modal);

  // Refresh local data and HUD
  const prev = structuredClone(userData);
  userData = await fetchUserData();
  refreshStats(userData, prev);
  renderPokemonGrid();
  closeOverlay(overlay);
}

// ===========================================================
// 💝 DONATION MODAL
// ===========================================================
function openDonationModal(pokeId) {
  const p = pokemonData[pokeId];
  if (!p) return;
  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.className = "modal donate-modal fade-in";

  const sprite = shinyMode
    ? `/public/sprites/pokemon/shiny/${pokeId}.gif`
    : `/public/sprites/pokemon/normal/${pokeId}.gif`;

  // CC map same as backend
  const ccMap = {
    common: 250,
    uncommon: 500,
    rare: 1000,
    epic: 2500,
    legendary: 5000,
    mythic: 10000,
  };
  const baseValue = ccMap[p.tier] ?? 0;
  const finalValue = shinyMode ? baseValue * 5 : baseValue;

  modal.innerHTML = `
    <h2>💝 Donate ${shinyMode ? "✨ shiny " : ""}${p.name}?</h2>
    <img src="${sprite}" class="poke-sprite large" alt="${p.name}">
    <p>You’ll receive <b>${finalValue} CC</b> for donating this Pokémon.</p>
    <div class="modal-actions">
      <button class="cancel-btn">Cancel</button>
      <button class="confirm-btn">Confirm Donation</button>
    </div>
  `;

  modal.querySelector(".cancel-btn").addEventListener("click", () => closeOverlay(overlay));
  modal.querySelector(".confirm-btn").addEventListener("click", async () => {
    modal.querySelector(".confirm-btn").disabled = true;
    await handleDonationConfirm(pokeId, overlay);
  });

  overlay.appendChild(modal);
}

async function handleDonationConfirm(pokeId, overlay) {
  const p = pokemonData[pokeId];
  const res = await donatePokemon(pokeId);
  if (!res.success) {
    alert("❌ " + (res.error || "Donation failed."));
    closeOverlay(overlay);
    return;
  }

  // Success popup
  const overlay2 = createOverlay();
  const modal = document.createElement("div");
  modal.className = "modal success-modal fade-in";
  const sprite = shinyMode
    ? `/public/sprites/pokemon/shiny/${pokeId}.gif`
    : `/public/sprites/pokemon/normal/${pokeId}.gif`;
  modal.innerHTML = `
    <h2>💰 You donated ${shinyMode ? "✨ shiny " : ""}${p.name}!</h2>
    <img src="${sprite}" class="poke-sprite large" alt="${p.name}">
    <p>Received <b>${res.gainedCC}</b> CC!</p>
    <button class="ok-btn">OK</button>
  `;
  modal.querySelector(".ok-btn").addEventListener("click", () => closeOverlay(overlay2));
  overlay2.appendChild(modal);

  // Update stats + grid
  const prev = structuredClone(userData);
  userData = await fetchUserData();
  refreshStats(userData, prev);
  renderPokemonGrid();
  closeOverlay(overlay);
}

// ===========================================================
// ✨ Re-render Hooks
// ===========================================================
window.addEventListener("resize", () => {
  const container = document.getElementById("pokemonGrid");
  if (container) container.style.gridTemplateColumns = "";
});
