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
=========================================================== */

let userId, userToken;
let userData = {};
let pokemonData = {};
let currentMode = "team"; // "team" | "evolve" | "donate"
let shinyMode = false;
let selectedTeam = [];
let activePokemon = null;

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

// ===========================================================
// 🌐 API Utilities
// ===========================================================
async function fetchUserData() {
  const params = new URLSearchParams({ id: userId, token: userToken });
  const res = await fetch(`/api/user-pokemon?${params}`);
  if (!res.ok) throw new Error("Failed to fetch user data");
  userData = await res.json();
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
  document.getElementById("stoneCount").textContent = userData.items?.evolution_stone ?? 0;
  document.getElementById("ccCount").textContent = userData.cc ?? 0;
  document.getElementById("tpCount").textContent = userData.tp ?? 0;
  document.getElementById("rankName").textContent = userData.rank ?? "Novice";
}

// Smooth pulse on stat change
function refreshStats(newData, prevData) {
  const stonesBefore = prevData.items?.evolution_stone ?? 0;
  const stonesAfter = newData.items?.evolution_stone ?? 0;
  const ccBefore = prevData.cc ?? 0;
  const ccAfter = newData.cc ?? 0;

  if (stonesAfter < stonesBefore) flashCounter("stoneCount", "#ef4444");
  if (ccAfter > ccBefore) flashCounter("ccCount", "#10b981");
  if (newData.tp > prevData.tp) flashCounter("tpCount", "#00ff9d");

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
// 🌟 Shiny Toggle
// ===========================================================
function initShinyToggle() {
  const toggle = document.getElementById("toggleShiny");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    shinyMode = !shinyMode;
    toggle.classList.toggle("active", shinyMode);
    toggle.textContent = shinyMode ? "🌟 Shiny Mode: ON" : "✨ Shiny Mode: OFF";
    renderPokemonGrid();
  });
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
  if (!p?.evolvesTo?.length) return false;
  const target = pokemonData[p.evolvesTo[0]];
  if (!target) return false;
  const cost = getEvolutionCost(p, target);
  const stones = userData.items?.evolution_stone ?? 0;
  return stones >= cost;
}

// ===========================================================
// 🎴 Pokémon Grid Renderer
// ===========================================================
function renderPokemonGrid() {
  const container = document.getElementById("pokemonGrid");
  if (!container) return;
  container.innerHTML = "";

  const entries = Object.entries(userData.pokemon || {})
    .filter(([id, data]) => {
      const owned = shinyMode ? (data.shiny ?? 0) : (data.normal ?? 0);
      return owned > 0;
    });

  // Sort by rarity order
  entries.sort(([a], [b]) => {
    const ra = RARITY_ORDER.indexOf(pokemonData[a]?.tier || "common");
    const rb = RARITY_ORDER.indexOf(pokemonData[b]?.tier || "common");
    return ra - rb;
  });

  if (!entries.length) {
    container.innerHTML = `<p class="empty-msg">No Pokémon found for this mode.</p>`;
    return;
  }

  for (const [id, counts] of entries) {
    const p = pokemonData[id];
    if (!p) continue;

    const ownedCount = shinyMode ? (counts.shiny ?? 0) : (counts.normal ?? 0);
    const sprite = shinyMode
      ? `/public/sprites/shiny/${id}.gif`
      : `/public/sprites/pokemon/${id}.gif`;

    const card = document.createElement("div");
    card.className = "pokemon-card";
    card.dataset.id = id;

    // Locked if evolve mode and not eligible
    let locked = false;
    if (currentMode === "evolve" && !isEvolutionEligible(id)) locked = true;

    card.innerHTML = `
      <img src="${sprite}" class="poke-sprite ${locked ? "locked" : ""}">
      <div class="poke-name">${p.name}</div>
      <div class="poke-tier ${p.tier}">${p.tier}</div>
      ${locked ? `<div class="lock-icon">🔒</div>` : ""}
      ${
        currentMode === "team"
          ? `<div class="count-label">x${ownedCount}</div>`
          : ""
      }
    `;

    if (!locked) {
      card.addEventListener("click", () => onPokemonClick(id));
    }

    container.appendChild(card);
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

  document
    .querySelectorAll(".pokemon-card")
    .forEach((el) => el.classList.remove("selected"));
  selectedTeam.forEach((id) => {
    const el = document.querySelector(`.pokemon-card[data-id="${id}"]`);
    if (el) el.classList.add("selected");
  });
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
    updateHUD();
    initStickyHUD();
    initShinyToggle();
    renderPokemonGrid();

    // Hook mode buttons
    document.querySelectorAll(".mode-btn").forEach(btn =>
      btn.addEventListener("click", () => setMode(btn.dataset.mode))
    );

    // Hook save button
    const saveBtn = document.getElementById("saveTeam");
    if (saveBtn) saveBtn.addEventListener("click", async () => {
      const res = await saveTeam();
      if (res.success) alert("✅ Team saved!");
      else alert("❌ Failed to save team");
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
  if (!base?.evolvesTo?.length) return;

  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.className = "modal evo-modal fade-in";

  const baseSprite = shinyMode
    ? `/public/sprites/shiny/${baseId}.gif`
    : `/public/sprites/pokemon/${baseId}.gif`;

  modal.innerHTML = `
    <h2>🧬 Choose Evolution</h2>
    <div class="evo-current">
      <img src="${baseSprite}" class="poke-sprite large">
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

  base.evolvesTo.forEach(targetId => {
    const target = pokemonData[targetId];
    if (!target) return;
    const sprite = shinyMode
      ? `/public/sprites/shiny/${targetId}.gif`
      : `/public/sprites/pokemon/${targetId}.gif`;
    const cost = getEvolutionCost(base, target);
    const stones = userData.items?.evolution_stone ?? 0;
    const enough = stones >= cost;

    const card = document.createElement("div");
    card.className = `evo-option ${enough ? "" : "locked"}`;
    card.innerHTML = `
      <img src="${sprite}" class="poke-sprite small ${enough ? "" : "locked"}">
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

  // Success modal
  const newOverlay = createOverlay();
  const modal = document.createElement("div");
  modal.className = "modal success-modal fade-in";
  const targetSprite = shinyMode
    ? `/public/sprites/shiny/${targetId}.gif`
    : `/public/sprites/pokemon/${targetId}.gif`;
  modal.innerHTML = `
    <h2>✨ ${base.name} evolved into ${target.name}!</h2>
    <img src="${targetSprite}" class="poke-sprite large">
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
    ? `/public/sprites/shiny/${pokeId}.gif`
    : `/public/sprites/pokemon/${pokeId}.gif`;

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
    <img src="${sprite}" class="poke-sprite large">
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
    ? `/public/sprites/shiny/${pokeId}.gif`
    : `/public/sprites/pokemon/${pokeId}.gif`;
  modal.innerHTML = `
    <h2>💰 You donated ${shinyMode ? "✨ shiny " : ""}${p.name}!</h2>
    <img src="${sprite}" class="poke-sprite large">
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
// 💎 Pulse helper for HUD (already defined above, reused here)
// ===========================================================
// flashCounter(id, color) and refreshStats()

// ===========================================================
// ✨ Re-render Hooks
// ===========================================================
window.addEventListener("resize", () => {
  // Reflow grid if needed
  const container = document.getElementById("pokemonGrid");
  if (container) container.style.gridTemplateColumns = "";
});

