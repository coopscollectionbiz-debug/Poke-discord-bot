/* ===========================================================
   Coop's Collection — Pokémon Picker (FIXED VERSION)
   ===========================================================
   - Fixed all element ID mismatches
   - Three-mode system (Team, Evolve, Donate)
   - Team selection functionality restored
=========================================================== */

let userId, userToken;
let userData = {};
let pokemonData = {};
let currentMode = "team"; // "team" | "evolve" | "donate"
let shinyMode = false;
let selectedTeam = [];
let activePokemon = null;

// Owned/Unowned view flags (Team mode UI)
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
  updateTeamCounter();
}

function refreshModeButtons() {
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === currentMode);
  });
}

// ===========================================================
// 🌟 Shiny Toggle + Owned/Unowned Toggles (FIXED IDs)
// ===========================================================
function initShinyToggle() {
  const shinyBtn = document.getElementById("shinyToggle"); // FIXED: was "toggleShiny"
  if (shinyBtn) {
    shinyBtn.addEventListener("click", () => {
      shinyMode = !shinyMode;
      shinyBtn.classList.toggle("active", shinyMode);
      shinyBtn.textContent = shinyMode ? "🌟 Shiny Mode ON" : "🌟 Shiny Mode OFF";
      console.log(`✨ Shiny mode: ${shinyMode}`);
      renderPokemonGrid();
    });
  }

  const ownedBtn = document.getElementById("ownedToggle"); // FIXED: was "toggleOwned"
  const unownedBtn = document.getElementById("unownedToggle"); // FIXED: was "toggleUnowned"

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
// 🎴 Pokémon Grid Renderer
// ===========================================================
function renderPokemonGrid() {
  console.log(`🎨 Rendering grid in ${currentMode} mode, shiny: ${shinyMode}`);
  const container = document.getElementById("pokemonGrid");
  if (!container) {
    console.error("❌ pokemonGrid element not found!");
    return;
  }
  container.innerHTML = "";

  const searchEl = document.getElementById("search"); // FIXED: was "searchInput"
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
      if (showOwned && !showUnowned && !isOwnedAny) continue;   // hide unowned if owned-only active
      if (showUnowned && !showOwned && isOwnedAny) continue; // hide owned if unowned-only active
      // If both are true or both false → show all
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
        <span class="tier-emoji">${rarityEmojis[p.tier] || ""}</span>
        <span class="tier-text ${p.tier}">${p.tier.charAt(0).toUpperCase() + p.tier.slice(1)}</span>
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
// 🖱️ Pokémon Click Handler
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

// ===========================================================
// ⭐ Team Selection Logic (from working version)
// ===========================================================
function toggleTeamSelection(id) {
  const numId = Number(id);
  const index = selectedTeam.indexOf(numId);
  
  if (index >= 0) {
    // Already in team - remove
    selectedTeam.splice(index, 1);
    console.log(`➖ Removed Pokemon #${id} from team`);
  } else {
    // Not in team - try to add
    if (selectedTeam.length >= 6) {
      alert("⚠️ Team is full! You can only have 6 Pokémon.");
      return;
    }
    selectedTeam.push(numId);
    console.log(`➕ Added Pokemon #${id} to team`);
  }
  
  console.log(`📋 Current team:`, selectedTeam);
  renderPokemonGrid();
  updateTeamCounter();
}

// ===========================================================
// 📊 Update Team Counter
// ===========================================================
function updateTeamCounter() {
  const counter = document.getElementById("teamCounter");
  if (counter) {
    counter.textContent = `${selectedTeam.length}/6 selected`;
  }
}

// ===========================================================
// 🚀 Initialization
// ===========================================================
async function init() {
  console.log("🚀 Initializing Pokémon picker...");
  
  try {
    // Extract URL params
    const params = new URLSearchParams(window.location.search);
    userId = params.get("id");
    userToken = params.get("token");
    
    if (!userId || !userToken) {
      document.body.innerHTML = "<p class='error'>❌ Missing credentials. Please use /changepokemon from Discord.</p>";
      return;
    }
    
    console.log(`👤 User ID: ${userId}`);

    // Load Pokémon data
    console.log("📦 Loading Pokémon data...");
    const pokeRes = await fetch("/public/pokemonData.json");
    pokemonData = await pokeRes.json();
    console.log(`✅ Loaded ${Object.keys(pokemonData).length} Pokémon`);

    // Load user data
    console.log("👤 Loading user data...");
    await fetchUserData();
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
    updateTeamCounter();
    initStickyHUD();
    initShinyToggle();
    renderPokemonGrid();

    // ===========================================================
    // 🧭 Hook filters (FIXED IDs)
    // ===========================================================
    document.getElementById("search")?.addEventListener("input", () => {
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

    // Hook mode buttons
    document.querySelectorAll(".mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        console.log(`🔘 Mode button clicked: ${btn.dataset.mode}`);
        setMode(btn.dataset.mode);
      });
    });

    // Hook save button (FIXED ID)
    const saveBtn = document.getElementById("saveTeamBtn");
    if (saveBtn) {
      console.log("✅ Save button found, attaching handler");
      saveBtn.addEventListener("click", async () => {
        console.log("💾 Save button clicked");
        console.log("📋 Saving team:", selectedTeam);
        
        if (selectedTeam.length === 0) {
          alert("⚠️ Please select at least one Pokémon for your team!");
          return;
        }
        
        const res = await saveTeam();
        const status = document.getElementById("teamStatus"); // FIXED: was "statusMsg"
        
        if (res.success) {
          console.log("✅ Team saved successfully!");
          if (status) {
            status.textContent = "✅ Team saved successfully!";
            status.className = "status-msg success";
            setTimeout(() => {
              status.textContent = "";
              status.className = "status-msg";
            }, 3000);
          } else {
            alert("✅ Team saved!");
          }
        } else {
          console.error("❌ Failed to save team:", res.error);
          if (status) {
            status.textContent = "❌ Failed to save team";
            status.className = "status-msg error";
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
    document.body.innerHTML = `<p class='error'>Error loading data: ${err.message}</p>`;
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
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    animation: fadeIn 0.3s ease;
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function closeOverlay(overlay) {
  if (!overlay) return;
  overlay.style.animation = "fadeOut 0.3s ease";
  setTimeout(() => overlay.remove(), 300);
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
  modal.style.cssText = `
    background: var(--card);
    border: 2px solid var(--brand);
    border-radius: 14px;
    padding: 2rem;
    text-align: center;
    box-shadow: 0 0 20px #00ff9d70;
    max-width: 500px;
    width: 92%;
  `;

  const baseSprite = shinyMode
    ? `/public/sprites/pokemon/shiny/${baseId}.gif`
    : `/public/sprites/pokemon/normal/${baseId}.gif`;

  modal.innerHTML = `
    <h2 style="color: var(--brand); margin-bottom: 1.5rem;">🧬 Choose Evolution</h2>
    <div style="display: flex; align-items: center; justify-content: center; gap: 1rem; margin-bottom: 1.5rem;">
      <img src="${baseSprite}" style="width: 96px; height: 96px; image-rendering: pixelated;" alt="${base.name}">
      <span style="font-size: 2rem;">➡️</span>
    </div>
    <div class="evo-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;"></div>
    <div style="display: flex; gap: 1rem; justify-content: center;">
      <button class="cancel-btn" style="background: var(--border); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">Cancel</button>
      <button class="confirm-btn" disabled style="background: var(--brand); color: var(--bg); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 700;">Confirm Evolution</button>
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
    card.style.cssText = `
      background: var(--card);
      border: 2px solid ${enough ? "var(--border)" : "#555"};
      border-radius: 10px;
      padding: 10px;
      cursor: ${enough ? "pointer" : "not-allowed"};
      opacity: ${enough ? "1" : "0.5"};
      transition: all 0.2s ease;
      position: relative;
    `;
    card.innerHTML = `
      <img src="${sprite}" style="width: 80px; height: 80px; image-rendering: pixelated; margin-bottom: 0.5rem;" alt="${target.name}">
      <div style="font-weight: 600; margin-bottom: 0.25rem;">${target.name}</div>
      <div style="font-size: 0.85rem; color: #aaa; text-transform: capitalize;">${target.tier}</div>
      <div style="margin-top: 0.5rem; color: var(--brand); font-weight: 700;">🪨 ${cost}</div>
      ${!enough ? `<div style="position: absolute; top: 5px; right: 5px; font-size: 1.2rem;">🔒</div>` : ""}
    `;
    if (enough) {
      card.addEventListener("click", () => {
        grid.querySelectorAll("div").forEach(c => c.style.borderColor = "var(--border)");
        card.style.borderColor = "var(--brand)";
        card.style.boxShadow = "0 0 10px #00ff9d60";
        selectedTarget = targetId;
        modal.querySelector(".confirm-btn").disabled = false;
      });
      card.addEventListener("mouseenter", () => {
        if (selectedTarget !== targetId) card.style.borderColor = "var(--brand)";
      });
      card.addEventListener("mouseleave", () => {
        if (selectedTarget !== targetId) card.style.borderColor = "var(--border)";
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
  
  // Show success modal
  const newOverlay = createOverlay();
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card);
    border: 2px solid var(--brand);
    border-radius: 14px;
    padding: 2rem;
    text-align: center;
    box-shadow: 0 0 20px #00ff9d70;
    max-width: 400px;
    width: 92%;
  `;
  const targetSprite = shinyMode
    ? `/public/sprites/pokemon/shiny/${targetId}.gif`
    : `/public/sprites/pokemon/normal/${targetId}.gif`;
  modal.innerHTML = `
    <h2 style="color: var(--brand); margin-bottom: 1rem;">✨ Evolution Complete!</h2>
    <p style="margin-bottom: 1rem;">${base.name} evolved into ${target.name}!</p>
    <img src="${targetSprite}" style="width: 120px; height: 120px; image-rendering: pixelated; margin-bottom: 1rem;" alt="${target.name}">
    <button class="ok-btn" style="background: var(--brand); color: var(--bg); border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-weight: 700;">OK</button>
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
  modal.style.cssText = `
    background: var(--card);
    border: 2px solid #facc15;
    border-radius: 14px;
    padding: 2rem;
    text-align: center;
    box-shadow: 0 0 20px rgba(250, 204, 21, 0.4);
    max-width: 400px;
    width: 92%;
  `;

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
    <h2 style="color: #facc15; margin-bottom: 1rem;">💝 Donate ${shinyMode ? "✨ shiny " : ""}${p.name}?</h2>
    <img src="${sprite}" style="width: 96px; height: 96px; image-rendering: pixelated; margin-bottom: 1rem;" alt="${p.name}">
    <p style="margin-bottom: 1.5rem;">You'll receive <b style="color: #facc15;">${finalValue} CC</b> for donating this Pokémon.</p>
    <div style="display: flex; gap: 1rem; justify-content: center;">
      <button class="cancel-btn" style="background: var(--border); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">Cancel</button>
      <button class="confirm-btn" style="background: #facc15; color: var(--bg); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 700;">Confirm Donation</button>
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
  modal.style.cssText = `
    background: var(--card);
    border: 2px solid #facc15;
    border-radius: 14px;
    padding: 2rem;
    text-align: center;
    box-shadow: 0 0 20px rgba(250, 204, 21, 0.4);
    max-width: 400px;
    width: 92%;
  `;
  const sprite = shinyMode
    ? `/public/sprites/pokemon/shiny/${pokeId}.gif`
    : `/public/sprites/pokemon/normal/${pokeId}.gif`;
  modal.innerHTML = `
    <h2 style="color: #facc15; margin-bottom: 1rem;">💰 Donation Complete!</h2>
    <p style="margin-bottom: 1rem;">You donated ${shinyMode ? "✨ shiny " : ""}${p.name}!</p>
    <img src="${sprite}" style="width: 96px; height: 96px; image-rendering: pixelated; margin-bottom: 1rem;" alt="${p.name}">
    <p style="margin-bottom: 1.5rem;">Received <b style="color: #facc15;">${res.gainedCC} CC</b>!</p>
    <button class="ok-btn" style="background: #facc15; color: var(--bg); border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-weight: 700;">OK</button>
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