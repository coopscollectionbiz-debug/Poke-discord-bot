/* ===========================================================
   Coop's Collection — Pokémon Picker (HYBRID FIXED VERSION)
   ===========================================================
   Combines:
   - Three-mode system (Team, Evolve, Donate)
   - Proven team selection from working version
   - Better debugging and error handling
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

import { rarityEmojis, rarityColors } from "/public/spriteconfig.js";

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
  console.log(`🔄 Switching to ${mode} mode`);
  currentMode = mode;
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  renderPokemonGrid();
}

function refreshModeButtons() {
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === currentMode);
  });
}


// ===========================================================
// 🌟 Shiny Toggle + Owned/Unowned Toggles (Trainer-style logic)
// ===========================================================
function initShinyToggle() {
  const shinyBtn = document.getElementById("toggleShiny");
  if (shinyBtn) {
    shinyBtn.addEventListener("click", () => {
      shinyMode = !shinyMode;
      shinyBtn.classList.toggle("active", shinyMode);
      shinyBtn.textContent = shinyMode ? "🌟 Shiny Mode ON" : "✨ Shiny Mode OFF";
      console.log(`✨ Shiny mode: ${shinyMode}`);
      renderPokemonGrid();
    });
  }

  const ownedBtn = document.getElementById("toggleOwned");
  const unownedBtn = document.getElementById("toggleUnowned");

  if (ownedBtn) {
    ownedBtn.addEventListener("click", (e) => {
      showOwned = !showOwned;
      showUnowned = false; // mutually exclusive
      e.target.classList.toggle("active", showOwned);
      if (unownedBtn) unownedBtn.classList.remove("active");
      console.log(`👀 Show owned: ${showOwned}, Show unowned: ${showUnowned}`);
      renderPokemonGrid();
    });
  }

  if (unownedBtn) {
    unownedBtn.addEventListener("click", (e) => {
      showUnowned = !showUnowned;
      showOwned = false; // mutually exclusive
      e.target.classList.toggle("active", showUnowned);
      if (ownedBtn) ownedBtn.classList.remove("active");
      console.log(`👀 Show owned: ${showOwned}, Show unowned: ${showUnowned}`);
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
// 🎴 Pokémon Grid Renderer (FIXED VERSION)
// ===========================================================
function renderPokemonGrid() {
  console.log(`🎨 Rendering grid in ${currentMode} mode, shiny: ${shinyMode}`);
  const container = document.getElementById("pokemonGrid");
  if (!container) {
    console.error("❌ pokemonGrid element not found!");
    return;
  }
  container.innerHTML = "";

  const searchEl = document.getElementById("searchInput");
  const rarityEl = document.getElementById("rarityFilter");
  const typeEl = document.getElementById("typeFilter");

  const search = (searchEl?.value || "").toLowerCase().trim();
  const rarityFilter = rarityEl?.value || "";
  const typeFilter = typeEl?.value || "";

  // Build and sort list
  let ids = Object.keys(pokemonData).map(Number).sort((a, b) => a - b);
  let shown = 0;

  for (const id of ids) {
    const p = pokemonData[id];
    if (!p) continue;

    const types = p.types || [];
    const name = p.name || `#${id}`;

    // Basic filters
    if (search && !name.toLowerCase().includes(search)) continue;
    if (rarityFilter && p.tier !== rarityFilter) continue;
    if (typeFilter && !types.includes(typeFilter)) continue;

    const ownedCounts = ownedCountForVariant(id);
    const isOwnedVariant = shinyMode ? ownedCounts.shiny > 0 : ownedCounts.normal > 0;
    const isOwnedAny = ownedCounts.any > 0;

    // =======================================================
    // 🧩 Mode-specific visibility
    // =======================================================
    if (currentMode === "evolve" || currentMode === "donate") {
      // Only show Pokémon you actually own (variant-aware)
      if (!isOwnedVariant) continue;
    } else {
      // Trainer-style toggle behavior
      if (showOwned && !isOwnedAny) continue;   // hide unowned if owned-only active
      if (showUnowned && isOwnedAny) continue; // hide owned if unowned-only active
      // If both are false → show all
    }

    // =======================================================
    // 🔒 Lock & sprite logic
    // =======================================================
    let locked = false;
    if (currentMode === "evolve" && (!isOwnedVariant || !isEvolutionEligible(id))) locked = true;
    if (currentMode === "team" && !isOwnedAny) locked = true;

    let spritePath;
    if (shinyMode) {
      spritePath = locked
        ? `/public/sprites/pokemon/grayscale/${id}.gif`
        : `/public/sprites/pokemon/shiny/${id}.gif`;
    } else {
      spritePath = locked
        ? `/public/sprites/pokemon/grayscale/${id}.gif`
        : `/public/sprites/pokemon/normal/${id}.gif`;
    }

    // =======================================================
    // 🧱 Card Construction
    // =======================================================
    const card = document.createElement("div");
    card.className = `pokemon-card${locked ? " locked" : ""}`;
    card.dataset.id = id;

    const teamIndex = selectedTeam.indexOf(Number(id));
    const displayCount = shinyMode ? ownedCounts.shiny : ownedCounts.normal;

    card.innerHTML = `
      <div class="sprite-wrapper">
        <img src="${spritePath}" class="poke-sprite ${locked ? "locked" : ""}" alt="${name}">
        ${teamIndex >= 0 ? `<div class="team-badge">${teamIndex + 1}</div>` : ""}
        ${locked ? `<div class="lock-overlay"><span>🔒</span></div>` : ""}
        ${displayCount > 0 ? `<div class="count-label bottom-left">x${displayCount}</div>` : ""}
      </div>
      <div class="pokemon-name">${name}</div>
      <div class="pokemon-tier">
        <div class="tier-emoji">${rarityEmojis[p.tier] || ""}</div>
        <div class="tier-text" style="color:${rarityColors[p.tier] || "#ccc"};">
          ${p.tier.charAt(0).toUpperCase() + p.tier.slice(1)}
        </div>
      </div>
    `;

    // =======================================================
    // 🚫 Click only if NOT locked
    // =======================================================
    if (!locked) {
      card.addEventListener("click", () => {
        console.log(`🖱️ Clicked Pokemon #${id} (${name}) in ${currentMode} mode`);
        onPokemonClick(id);
      });
    }

    container.appendChild(card);
    shown++;
  }

  // Fallback message
  if (shown === 0) {
    container.innerHTML = `<p class="empty-msg">No Pokémon match your filters.</p>`;
  }
  
  console.log(`✅ Rendered ${shown} Pokemon cards`);
}

// ===========================================================
// 🖱️ Pokémon Click Handler (FIXED - HYBRID VERSION)
// ===========================================================
function onPokemonClick(id) {
  console.log(`🎯 onPokemonClick called with id: ${id}, mode: ${currentMode}`);
  
  if (currentMode === "team") {
    toggleTeamSelection(id);
  } else if (currentMode === "evolve") {
    openEvolutionModal(id);
  } else if (currentMode === "donate") {
    openDonationModal(id);
  }
}

function toggleTeamSelection(id) {
  // Convert to number for consistency
  const numId = Number(id);
  console.log(`🔄 toggleTeamSelection called with id: ${numId}`);
  console.log(`📋 Current team:`, selectedTeam);
  
  const index = selectedTeam.indexOf(numId);
  
  if (index >= 0) {
    // Remove from team
    selectedTeam.splice(index, 1);
    console.log(`➖ Removed Pokemon #${numId} from team`);
  } else {
    // Add to team (max 6)
    if (selectedTeam.length >= 6) {
      console.warn(`⚠️ Team is full! Cannot add Pokemon #${numId}`);
      const status = document.getElementById("statusMsg");
      if (status) {
        status.textContent = "❌ Team is full! (Max 6 Pokémon)";
        status.classList.remove("success");
        status.classList.add("error");
        setTimeout(() => status.textContent = "", 2000);
      }
      return;
    }
    selectedTeam.push(numId);
    console.log(`➕ Added Pokemon #${numId} to team`);
  }
  
  console.log(`📋 New team:`, selectedTeam);
  renderPokemonGrid();
}

// ===========================================================
// 🚀 Initialization
// ===========================================================
async function init() {
  console.log("🚀 Initializing Pokemon Portal...");
  
  // Pull query params
  const url = new URL(window.location.href);
  userId = url.searchParams.get("id");
  userToken = url.searchParams.get("token");
  
  console.log(`🔐 User ID: ${userId}, Token: ${userToken ? "present" : "missing"}`);
  
  if (!userId || !userToken) {
    document.body.innerHTML = "<p>Missing credentials.</p>";
    return;
  }

  try {
    console.log("📦 Loading data...");
    const [pokeRes, userRes] = await Promise.all([
      fetch("/public/pokemonData.json").then(r => r.json()),
      fetchUserData(),
    ]);
    pokemonData = pokeRes;
    userData = userRes;

    console.log(`✅ Loaded ${Object.keys(pokemonData).length} Pokemon`);
    console.log(`👤 User data:`, {
      id: userData.id,
      pokemonCount: Object.keys(userData.pokemon || {}).length,
      currentTeam: userData.currentTeam,
      stones: userData.items?.evolution_stone,
      cc: userData.cc,
      tp: userData.tp
    });

    // Initialize selected team
    selectedTeam = Array.isArray(userData.currentTeam) ? [...userData.currentTeam] : [];
    console.log(`📋 Initial team:`, selectedTeam);

    updateHUD();
    initStickyHUD();
    initShinyToggle();
    renderPokemonGrid();

    // ===========================================================
    // 🧭 Hook filters + log dataset coverage
    // ===========================================================

    // Re-render grid when filters change
    document.getElementById("searchInput")?.addEventListener("input", () => {
      console.log("🔍 Search input changed");
      renderPokemonGrid();
    });
    document.getElementById("rarityFilter")?.addEventListener("change", () => {
      console.log("⭐ Rarity filter changed");
      renderPokemonGrid();
    });
    document.getElementById("typeFilter")?.addEventListener("change", () => {
      console.log("🏷️ Type filter changed");
      renderPokemonGrid();
    });

    // Debug coverage
    const ids = Object.keys(pokemonData).map(Number).sort((a, b) => a - b);
    console.log("Pokémon loaded:", ids.length, "min:", ids[0], "max:", ids[ids.length - 1]);

    // Hook mode buttons
    document.querySelectorAll(".mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        console.log(`🔘 Mode button clicked: ${btn.dataset.mode}`);
        setMode(btn.dataset.mode);
      });
    });

    // Hook save button (support either id)
    const saveBtn = document.getElementById("saveTeamBtn") || document.getElementById("saveTeam");
    if (saveBtn) {
      console.log("✅ Save button found, attaching handler");
      saveBtn.addEventListener("click", async () => {
        console.log("💾 Save button clicked");
        console.log("📋 Saving team:", selectedTeam);
        const res = await saveTeam();
      const status = document.getElementById("statusMsg");
      if (res.success) {
        console.log("✅ Team saved successfully!");
        if (status) {
          status.textContent = "✅ Team saved!";
          status.classList.remove("error");
          status.classList.add("success");
          setTimeout(() => (status.textContent = ""), 2500);
        } else {
          alert("✅ Team saved!");
        }
      } else {
        console.error("❌ Failed to save team:", res.error);
        if (status) {
          status.textContent = "❌ Failed to save team";
          status.classList.remove("success");
          status.classList.add("error");
        } else {
          alert("❌ Failed to save team");
        }
      }
    });
    } else {
      console.warn("⚠️ Save button not found!");
    }
  } catch (err) {
    console.error("❌ Initialization failed:", err);
    document.body.innerHTML = `<p>Error loading data: ${err.message}</p>`;
  }
  
  console.log("🎉 Initialization complete!");
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
  console.log(`🧬 Opening evolution modal for Pokemon #${baseId}`);
  const base = pokemonData[baseId];
  const evoList = getEvoList(base);
  if (!evoList.length) {
    console.warn(`⚠️ Pokemon #${baseId} has no evolutions`);
    return;
  }

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
  console.log(`✨ Evolving Pokemon #${baseId} → #${targetId}`);
  const base = pokemonData[baseId];
  const target = pokemonData[targetId];
  const res = await evolvePokemon(baseId, targetId);

  if (!res.success) {
    console.error("❌ Evolution failed:", res.error);
    alert("❌ " + (res.error || "Evolution failed."));
    closeOverlay(overlay);
    return;
  }

  console.log("✅ Evolution successful!");
  
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
  console.log(`💝 Opening donation modal for Pokemon #${pokeId}`);
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
    <p>You'll receive <b>${finalValue} CC</b> for donating this Pokémon.</p>
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
  console.log(`💰 Donating Pokemon #${pokeId}`);
  const p = pokemonData[pokeId];
  const res = await donatePokemon(pokeId);
  if (!res.success) {
    console.error("❌ Donation failed:", res.error);
    alert("❌ " + (res.error || "Donation failed."));
    closeOverlay(overlay);
    return;
  }

  console.log(`✅ Donation successful! Gained ${res.gainedCC} CC`);

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