/* ===========================================================
   Coop's Collection — Pokémon Picker (CORRECT LOGIC)
   ===========================================================
   3 Modes:
   - Change Team: Shows ALL (owned colored, unowned gray+locked)
   - Evolve: Shows ONLY owned (with stone cost badge)
   - Donate: Shows ONLY owned (with CC value badge)
   
   Shiny Toggle: Filters to only show owned shiny variants
   Show Owned/Unowned: Filters visibility in Change Team mode
=========================================================== */

let userId, userToken;
let userData = {};
let pokemonData = {};
let currentMode = "team"; // "team" | "evolve" | "donate"
let shinyMode = false;
let selectedTeam = [];
let showOwnedOnly = false;
let showUnownedOnly = false;

import { rarityEmojis, rarityColors } from "/public/spriteconfig.js";

// ===========================================================
// 🎨 Type ID to Name Mapping (for filtering)
// ===========================================================
const TYPE_MAP = {
  1: "normal", 2: "fighting", 3: "flying", 4: "poison",
  5: "ground", 6: "rock", 7: "bug", 8: "ghost",
  9: "steel", 10: "fire", 11: "water", 12: "grass",
  13: "electric", 14: "psychic", 15: "ice", 16: "dragon",
  17: "dark", 18: "fairy"
};

// ===========================================================
// 🧠 Rank System
// ===========================================================
const RANK_TIERS = [
  { tp: 100, roleName: "Novice Trainer" },
  { tp: 500, roleName: "Junior Trainer" },
  { tp: 1000, roleName: "Skilled Trainer" },
  { tp: 2500, roleName: "Experienced Trainer" },
  { tp: 5000, roleName: "Advanced Trainer" },
  { tp: 7500, roleName: "Expert Trainer" },
  { tp: 10000, roleName: "Veteran Trainer" },
  { tp: 17500, roleName: "Elite Trainer" },
  { tp: 25000, roleName: "Master Trainer" },
  { tp: 50000, roleName: "Gym Leader" },
  { tp: 100000, roleName: "Elite Four Member" },
  { tp: 175000, roleName: "Champion" },
  { tp: 250000, roleName: "Legend" }
];

function getRankFromTP(tp) {
  let currentRank = "Novice Trainer";
  for (const tier of RANK_TIERS) {
    if (tp >= tier.tp) currentRank = tier.roleName;
  }
  return currentRank;
}

// ===========================================================
// 🧬 Evolution Costs
// ===========================================================
const COST_MAP = {
  "common-uncommon": 1,
  "common-rare": 3,
  "uncommon-rare": 2,
  "rare-epic": 3,
  "uncommon-epic": 4,
};

function getEvoList(p) {
  return p?.evolvesTo || p?.evolves_to || [];
}

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

// ===========================================================
// 💰 Donation Values
// ===========================================================
const CC_MAP = {
  common: 250,
  uncommon: 500,
  rare: 1000,
  epic: 2500,
  legendary: 5000,
  mythic: 10000,
};

function getDonationValue(tier, isShiny) {
  const baseValue = CC_MAP[tier] ?? 0;
  return isShiny ? baseValue * 5 : baseValue;
}

// ===========================================================
// 🌐 API Utilities
// ===========================================================
async function fetchUserData() {
  const params = new URLSearchParams({ id: userId, token: userToken });
  const res = await fetch(`/api/user-pokemon?${params}`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to fetch: ${res.status} - ${errorText}`);
  }
  userData = await res.json();
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
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  return res.json();
}

async function evolvePokemon(baseId, targetId) {
  const body = { id: userId, token: userToken, baseId, targetId, shiny: shinyMode };
  const res = await fetch("/api/pokemon/evolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Evolve failed: ${res.status}`);
  return res.json();
}

async function donatePokemon(pokeId) {
  const body = { id: userId, token: userToken, pokeId, shiny: shinyMode };
  const res = await fetch("/api/pokemon/donate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Donate failed: ${res.status}`);
  return res.json();
}

// ===========================================================
// 🎨 HUD
// ===========================================================
function initStickyHUD() {
  const bar = document.getElementById("statsBar");
  if (!bar) return;
  window.addEventListener("scroll", () => {
    if (window.scrollY > 100) bar.classList.add("compact");
    else bar.classList.remove("compact");
  });
}

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
  const rank = getRankFromTP(tp);

  const stoneEl = document.getElementById("stoneCount");
  const ccEl = document.getElementById("ccCount");
  const tpEl = document.getElementById("tpCount");
  const rankEl = document.getElementById("rankLabel");

  if (stoneEl) stoneEl.textContent = stones;
  if (ccEl) ccEl.textContent = cc;
  if (tpEl) tpEl.textContent = tp;
  if (rankEl) rankEl.textContent = rank;
}

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

// ===========================================================
// 🌟 Toggle Buttons
// ===========================================================
function initToggles() {
  const shinyBtn = document.getElementById("shinyToggle");
  const ownedBtn = document.getElementById("ownedToggle");
  const unownedBtn = document.getElementById("unownedToggle");

  if (shinyBtn) {
    shinyBtn.addEventListener("click", () => {
      shinyMode = !shinyMode;
      shinyBtn.classList.toggle("active", shinyMode);
      shinyBtn.textContent = shinyMode ? "🌟 Shiny Mode ON" : "🌟 Shiny Mode OFF";
      console.log(`✨ Shiny mode: ${shinyMode}`);
      renderPokemonGrid();
    });
  }

  if (ownedBtn) {
    ownedBtn.addEventListener("click", () => {
      showOwnedOnly = !showOwnedOnly;
      if (showOwnedOnly) showUnownedOnly = false;
      ownedBtn.classList.toggle("active", showOwnedOnly);
      if (unownedBtn) unownedBtn.classList.remove("active");
      renderPokemonGrid();
    });
  }

  if (unownedBtn) {
    unownedBtn.addEventListener("click", () => {
      showUnownedOnly = !showUnownedOnly;
      if (showUnownedOnly) showOwnedOnly = false;
      unownedBtn.classList.toggle("active", showUnownedOnly);
      if (ownedBtn) ownedBtn.classList.remove("active");
      renderPokemonGrid();
    });
  }
}

// ===========================================================
// 🧮 Ownership Helper
// ===========================================================
function ownedCountForVariant(id) {
  const entry = userData.pokemon?.[id];
  if (!entry) return { normal: 0, shiny: 0, any: 0 };
  const normal = Number(entry.normal ?? 0);
  const shiny = Number(entry.shiny ?? 0);
  return { normal, shiny, any: normal + shiny };
}

// ===========================================================
// 🎴 Pokémon Grid Renderer (CORRECT LOGIC)
// ===========================================================
function renderPokemonGrid() {
  console.log(`🎨 Rendering: ${currentMode} mode, shiny: ${shinyMode}, ownedOnly: ${showOwnedOnly}, unownedOnly: ${showUnownedOnly}`);
  
  const container = document.getElementById("pokemonGrid");
  if (!container) return;
  container.innerHTML = "";

  const searchEl = document.getElementById("search");
  const rarityEl = document.getElementById("rarityFilter");
  const typeEl = document.getElementById("typeFilter");

  const search = (searchEl?.value || "").toLowerCase().trim();
  const rarityFilter = rarityEl?.value || "";
  const typeFilter = typeEl?.value || "";

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
    if (typeFilter) {
      const typeNames = types.map(tid => TYPE_MAP[tid]).filter(Boolean);
      if (!typeNames.includes(typeFilter)) continue;
    }

    const ownedCounts = ownedCountForVariant(id);
    const isOwnedAny = ownedCounts.any > 0;
    const isOwnedNormal = ownedCounts.normal > 0;
    const isOwnedShiny = ownedCounts.shiny > 0;

    // =======================================================
    // 🌟 SHINY MODE FILTER
    // =======================================================
    if (shinyMode) {
      // Shiny mode: Only show if user owns shiny variant
      if (!isOwnedShiny) continue;
    }

    // =======================================================
    // 🧩 MODE-SPECIFIC VISIBILITY
    // =======================================================
    if (currentMode === "evolve" || currentMode === "donate") {
      // Evolve/Donate: ONLY show owned Pokemon (respecting shiny filter above)
      const hasVariant = shinyMode ? isOwnedShiny : isOwnedNormal;
      if (!hasVariant) continue;
    } else {
      // Team mode: Apply owned/unowned toggles
      if (showOwnedOnly && !isOwnedAny) continue;
      if (showUnownedOnly && isOwnedAny) continue;
    }

    // 🔒 LOCK STATE — always enforce lock correctly across modes
let locked = false;

if (currentMode === "team") {
  // Always lock unowned in team mode
  locked = !isOwnedAny;
} else if (currentMode === "evolve") {
  const hasVariant = shinyMode ? isOwnedShiny : isOwnedNormal;
  locked = !hasVariant || !isEvolutionEligible(id);
} else if (currentMode === "donate") {
  const hasVariant = shinyMode ? isOwnedShiny : isOwnedNormal;
  locked = !hasVariant;
}

    // =======================================================
    // 🖼️ SPRITE PATH
    // =======================================================
    let spritePath;
    if (locked) {
      spritePath = `/public/sprites/pokemon/grayscale/${id}.gif`;
    } else if (shinyMode) {
      spritePath = `/public/sprites/pokemon/shiny/${id}.gif`;
    } else {
      spritePath = `/public/sprites/pokemon/normal/${id}.gif`;
    }

    // =======================================================
    // 🧱 CARD CONSTRUCTION
    // =======================================================
    const card = document.createElement("div");
    card.className = `pokemon-card ${isOwnedAny ? "owned" : "unowned"}`;
    if (locked) card.classList.add("locked");
    card.dataset.id = id;

    const teamIndex = selectedTeam.indexOf(Number(id));
    if (teamIndex >= 0) card.classList.add("selected");

    const displayCount = shinyMode ? ownedCounts.shiny : ownedCounts.normal;

    // Type icons
    const typeIcons = types.map(typeId => 
      `<img src="/public/sprites/types/${typeId}.png" alt="${TYPE_MAP[typeId]}" style="width: 32px; height: 32px; image-rendering: pixelated;">`
    ).join('');

  // 💰 / 🧬 Mode-specific badges (bottom-right corner)
let badgeHTML = "";

if (currentMode === "donate") {
  // Always show CC reward for donate mode (owned-only mode anyway)
  const ccValue = getDonationValue(p.tier, shinyMode);
  badgeHTML = `
    <div class="donate-value" style="bottom:6px; right:6px;">
      💰 ${ccValue}
    </div>`;
}

if (currentMode === "evolve") {
  // Always show stone cost if this Pokémon has any evolution, even if locked
  const evos = getEvoList(p);
  if (evos.length) {
    const target = pokemonData[evos[0]];
    if (target) {
      const cost = getEvolutionCost(p, target);
      badgeHTML = `
        <div class="evolve-cost" style="bottom:6px; right:6px; opacity:${locked ? 0.5 : 1};">
          <img src="/public/sprites/items/evolution_stone.png"
               style="width:16px;height:16px;vertical-align:middle;image-rendering:pixelated;">
          ${cost}
        </div>`;
    }
  }
}
    card.innerHTML = `
      <div class="sprite-wrapper">
        <img src="${spritePath}" class="poke-sprite" alt="${name}">
        ${teamIndex >= 0 ? `<div class="team-badge">${teamIndex + 1}</div>` : ""}
        ${locked ? `<div class="lock-overlay"><span>🔒</span></div>` : ""}
        ${displayCount > 0 ? `<div class="count-label bottom-left">x${displayCount}</div>` : ""}
        ${badgeHTML}

      </div>
      <div class="pokemon-name">${name}</div>
      <div class="type-icons" style="display: flex; gap: 4px; justify-content: center; margin: 4px 0;">
        ${typeIcons}
      </div>
      <div class="pokemon-tier">
        <span class="tier-emoji">${rarityEmojis[p.tier] || ""}</span>
        <span class="tier-text ${p.tier}">${p.tier.charAt(0).toUpperCase() + p.tier.slice(1)}</span>
      </div>
    `;

    // Click handler
    if (!locked) {
      card.addEventListener("click", () => onPokemonClick(id));
    }

    container.appendChild(card);
    shown++;
  }

  if (shown === 0) {
    container.innerHTML = `<p class="empty-msg">No Pokémon match your filters.</p>`;
  }
  
  console.log(`✅ Rendered ${shown} Pokemon cards`);
}

// ===========================================================
// 🖱️ Click Handler
// ===========================================================
function onPokemonClick(id) {
  if (currentMode === "team") {
    toggleTeamSelection(id);
  } else if (currentMode === "evolve") {
    openEvolutionModal(id);
  } else if (currentMode === "donate") {
    openDonationModal(id);
  }
}

// ===========================================================
// ⭐ Team Selection
// ===========================================================
function toggleTeamSelection(id) {
  const numId = Number(id);
  const index = selectedTeam.indexOf(numId);
  
  if (index >= 0) {
    selectedTeam.splice(index, 1);
    console.log(`➖ Removed Pokemon #${id}`);
  } else {
    if (selectedTeam.length >= 6) {
      alert("⚠️ Team is full! Maximum 6 Pokémon.");
      return;
    }
    selectedTeam.push(numId);
    console.log(`➕ Added Pokemon #${id}`);
  }
  
  renderPokemonGrid();
  updateTeamCounter();
}

function updateTeamCounter() {
  const counter = document.getElementById("teamCounter");
  if (counter) counter.textContent = `${selectedTeam.length}/6 selected`;
}

// ===========================================================
// 🚀 Initialization
// ===========================================================
async function init() {
  console.log("🚀 Initializing...");
  
  try {
    const params = new URLSearchParams(window.location.search);
    userId = params.get("id");
    userToken = params.get("token");
    
    if (!userId || !userToken) {
      document.body.innerHTML = "<p class='error'>❌ Missing credentials. Use /changepokemon in Discord.</p>";
      return;
    }

    // Load Pokemon data
    const pokeRes = await fetch("/public/pokemonData.json");
    if (!pokeRes.ok) throw new Error("Pokemon data failed");
    pokemonData = await pokeRes.json();
    console.log(`✅ Loaded ${Object.keys(pokemonData).length} Pokémon`);

    // Load user data
    await fetchUserData();
    console.log(`✅ User data loaded`);

    selectedTeam = Array.isArray(userData.currentTeam) ? [...userData.currentTeam] : [];

    updateHUD();
    updateTeamCounter();
    initStickyHUD();
    initToggles();
    renderPokemonGrid();

    // Hook filters
    document.getElementById("search")?.addEventListener("input", () => renderPokemonGrid());
    document.getElementById("rarityFilter")?.addEventListener("change", () => renderPokemonGrid());
    document.getElementById("typeFilter")?.addEventListener("change", () => renderPokemonGrid());

    // ✅ Hook main mode buttons only (ignore filters)
document.querySelectorAll("#modeToggle .mode-btn").forEach(btn => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

    // Hook save button
    const saveBtn = document.getElementById("saveTeamBtn");
    saveBtn.addEventListener("click", () => {
  if (selectedTeam.length === 0) {
    alert("⚠️ Select at least one Pokémon!");
    return;
  }

  // Build preview HTML for selected Pokémon
  const previewHTML = selectedTeam.map(id => {
    const sprite = shinyMode
      ? `/public/sprites/pokemon/shiny/${id}.gif`
      : `/public/sprites/pokemon/normal/${id}.gif`;
    return `<img src="${sprite}" style="width:64px;height:64px;image-rendering:pixelated;">`;
  }).join("");

  createConfirmModal({
    title: "💾 Save New Team?",
    message: `
      <div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;margin-bottom:1rem;">
        ${previewHTML}
      </div>
      Are you sure you want to save this new team?
    `,
    onConfirm: async (overlay) => {
      try {
        const res = await saveTeam();
       if (res.success) {
  const modal2 = createOverlay();
  const confirmBox = document.createElement("div");
  confirmBox.style.cssText = `
    background: var(--card);
    border: 2px solid var(--brand);
    border-radius: 14px;
    padding: 2rem;
    text-align: center;
    max-width: 480px;
    width: 92%;
  `;

  // 🧩 Build a row of the new team’s sprites
  const teamPreview = selectedTeam.map(id => {
    const sprite = shinyMode
      ? `/public/sprites/pokemon/shiny/${id}.gif`
      : `/public/sprites/pokemon/normal/${id}.gif`;
    return `<img src="${sprite}" style="width:64px;height:64px;image-rendering:pixelated;">`;
  }).join("");

  confirmBox.innerHTML = `
    <h2 style="color: var(--brand);">✅ Team Saved!</h2>
    <p style="margin:0.5rem 0 1rem;color:#ccc;">
      Your new team has been successfully updated.
    </p>
    <div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;margin-bottom:1rem;">
      ${teamPreview}
    </div>
    <button style="
      background: var(--brand);
      color: var(--bg);
      border: none;
      padding: 10px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 700;
    ">OK</button>
  `;

  confirmBox.querySelector("button").addEventListener("click", () => closeOverlay(modal2));
  modal2.appendChild(confirmBox);
}

      } catch (err) {
        alert("❌ " + err.message);
      } finally {
        closeOverlay(overlay);
      }
    }
  });
});

  } catch (err) {
    console.error("Init failed:", err);
    document.body.innerHTML = `<p class='error'>❌ ${err.message}</p>`;
  }
}

window.addEventListener("DOMContentLoaded", init);

// ===========================================================
// 🧩 Modal System
// ===========================================================
function createOverlay() {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.75);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function closeOverlay(overlay) {
  if (overlay) overlay.remove();
}

// ===========================================================
// 💾 Confirmation Modal (used for Save Team)
// ===========================================================
function createConfirmModal({ title, message, onConfirm, onCancel }) {
  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card);
    border: 2px solid var(--brand);
    border-radius: 14px;
    padding: 2rem;
    text-align: center;
    max-width: 500px;
    width: 92%;
  `;

  modal.innerHTML = `
    <h2 style="color: var(--brand); margin-bottom: 0.5rem;">${title}</h2>
    <p style="margin-bottom: 1rem; color: #ccc;">${message}</p>
    <div style="display: flex; gap: 1rem; justify-content: center;">
      <button class="cancel-btn"
        style="background: var(--border); color: white; border: none;
               padding: 10px 20px; border-radius: 8px; cursor: pointer;">
        Cancel
      </button>
      <button class="confirm-btn"
        style="background: var(--brand); color: var(--bg); border: none;
               padding: 10px 20px; border-radius: 8px; cursor: pointer;
               font-weight: 700;">
        Confirm Save
      </button>
    </div>
  `;

  modal.querySelector(".cancel-btn").addEventListener("click", () => {
    closeOverlay(overlay);
    if (onCancel) onCancel();
  });
  modal.querySelector(".confirm-btn").addEventListener("click", () => {
    if (onConfirm) onConfirm(overlay);
  });

  overlay.appendChild(modal);
}

// ===========================================================
// 🧬 Evolution Modal
// ===========================================================
function openEvolutionModal(baseId) {
  const base = pokemonData[baseId];
  const evoList = getEvoList(base);
  if (!evoList.length) return;

  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card); border: 2px solid var(--brand);
    border-radius: 14px; padding: 2rem; text-align: center;
    max-width: 500px; width: 92%;
  `;

  const baseSprite = shinyMode
    ? `/public/sprites/pokemon/shiny/${baseId}.gif`
    : `/public/sprites/pokemon/normal/${baseId}.gif`;

  modal.innerHTML = `
    <h2 style="color: var(--brand);">🧬 Choose Evolution</h2>
    <div style="display: flex; align-items: center; justify-content: center; gap: 1rem; margin: 1rem 0;">
      <img src="${baseSprite}" style="width: 96px; height: 96px; image-rendering: pixelated;">
      <span style="font-size: 2rem;">➡️</span>
    </div>
    <div class="evo-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; margin: 1rem 0;"></div>
    <div style="display: flex; gap: 1rem; justify-content: center;">
      <button class="cancel-btn" style="background: var(--border); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">Cancel</button>
      <button class="confirm-btn" disabled style="background: var(--brand); color: var(--bg); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 700;">Evolve</button>
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
      background: var(--card); border: 2px solid ${enough ? "var(--border)" : "#555"};
      border-radius: 10px; padding: 10px; cursor: ${enough ? "pointer" : "not-allowed"};
      opacity: ${enough ? "1" : "0.5"}; position: relative;
    `;
    card.innerHTML = `
      <img src="${sprite}" style="width: 80px; height: 80px; image-rendering: pixelated;">
      <div style="font-weight: 600; margin-top: 0.5rem;">${target.name}</div>
      <div style="color: #aaa; text-transform: capitalize;">${target.tier}</div>
      <div style="margin-top: 0.5rem; color: var(--brand); font-weight: 700;">
        <img src="/public/sprites/items/evolution_stone.png" style="width: 16px; height: 16px; vertical-align: middle; image-rendering: pixelated;"> ${cost}
      </div>
    `;
    if (enough) {
      card.addEventListener("click", () => {
        grid.querySelectorAll("div").forEach(c => c.style.borderColor = "var(--border)");
        card.style.borderColor = "var(--brand)";
        selectedTarget = targetId;
        modal.querySelector(".confirm-btn").disabled = false;
      });
    }
    grid.appendChild(card);
  });

  modal.querySelector(".cancel-btn").addEventListener("click", () => closeOverlay(overlay));
  modal.querySelector(".confirm-btn").addEventListener("click", async () => {
    if (!selectedTarget) return;
    await handleEvolutionConfirm(baseId, selectedTarget, overlay);
  });

  overlay.appendChild(modal);
}

async function handleEvolutionConfirm(baseId, targetId, overlay) {
  try {
    const base = pokemonData[baseId];
    const target = pokemonData[targetId];
    const res = await evolvePokemon(baseId, targetId);

    if (!res.success) {
      alert("❌ " + (res.error || "Evolution failed"));
      closeOverlay(overlay);
      return;
    }

    // Remove from team if selected
    const teamIndex = selectedTeam.indexOf(Number(baseId));
    if (teamIndex >= 0) {
      selectedTeam.splice(teamIndex, 1);
    }

    // Success modal
    const modal2 = createOverlay();
    const successModal = document.createElement("div");
    successModal.style.cssText = `
      background: var(--card); border: 2px solid var(--brand);
      border-radius: 14px; padding: 2rem; text-align: center;
      max-width: 400px; width: 92%;
    `;
    const targetSprite = shinyMode
      ? `/public/sprites/pokemon/shiny/${targetId}.gif`
      : `/public/sprites/pokemon/normal/${targetId}.gif`;
    successModal.innerHTML = `
      <h2 style="color: var(--brand);">✨ Evolution Complete!</h2>
      <p>${base.name} evolved into ${target.name}!</p>
      <img src="${targetSprite}" style="width: 120px; height: 120px; image-rendering: pixelated; margin: 1rem 0;">
      <button class="ok-btn" style="background: var(--brand); color: var(--bg); border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-weight: 700;">OK</button>
    `;
    successModal.querySelector(".ok-btn").addEventListener("click", () => closeOverlay(modal2));
    modal2.appendChild(successModal);

    const prev = structuredClone(userData);
    userData = await fetchUserData();
    refreshStats(userData, prev);
    renderPokemonGrid();
    updateTeamCounter();
    closeOverlay(overlay);
  } catch (err) {
    alert("❌ " + err.message);
    closeOverlay(overlay);
  }
}

// ===========================================================
// 💝 Donation Modal
// ===========================================================
function openDonationModal(pokeId) {
  const p = pokemonData[pokeId];
  if (!p) return;

  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card); border: 2px solid #facc15;
    border-radius: 14px; padding: 2rem; text-align: center;
    max-width: 400px; width: 92%;
  `;

  const sprite = shinyMode
    ? `/public/sprites/pokemon/shiny/${pokeId}.gif`
    : `/public/sprites/pokemon/normal/${pokeId}.gif`;

  const ccValue = getDonationValue(p.tier, shinyMode);

  modal.innerHTML = `
    <h2 style="color: #facc15;">💝 Donate ${shinyMode ? "✨ " : ""}${p.name}?</h2>
    <img src="${sprite}" style="width: 96px; height: 96px; image-rendering: pixelated; margin: 1rem 0;">
    <p>You'll receive <b style="color: #facc15;">💰 ${ccValue} CC</b></p>
    <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 1rem;">
      <button class="cancel-btn" style="background: var(--border); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">Cancel</button>
      <button class="confirm-btn" style="background: #facc15; color: var(--bg); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 700;">Confirm</button>
    </div>
  `;

  modal.querySelector(".cancel-btn").addEventListener("click", () => closeOverlay(overlay));
  modal.querySelector(".confirm-btn").addEventListener("click", async () => {
    await handleDonationConfirm(pokeId, overlay);
  });

  overlay.appendChild(modal);
}

async function handleDonationConfirm(pokeId, overlay) {
  try {
    const p = pokemonData[pokeId];
    const res = await donatePokemon(pokeId);

    if (!res.success) {
      alert("❌ " + (res.error || "Donation failed"));
      closeOverlay(overlay);
      return;
    }

    // Remove from team if selected
    const teamIndex = selectedTeam.indexOf(Number(pokeId));
    if (teamIndex >= 0) {
      selectedTeam.splice(teamIndex, 1);
    }

    // Success modal
    const modal2 = createOverlay();
    const successModal = document.createElement("div");
    successModal.style.cssText = `
      background: var(--card); border: 2px solid #facc15;
      border-radius: 14px; padding: 2rem; text-align: center;
      max-width: 400px; width: 92%;
    `;
    const sprite = shinyMode
      ? `/public/sprites/pokemon/shiny/${pokeId}.gif`
      : `/public/sprites/pokemon/normal/${pokeId}.gif`;
    successModal.innerHTML = `
      <h2 style="color: #facc15;">💰 Donation Complete!</h2>
      <p>You donated ${shinyMode ? "✨ " : ""}${p.name}!</p>
      <img src="${sprite}" style="width: 96px; height: 96px; image-rendering: pixelated; margin: 1rem 0;">
      <p style="color: #facc15; font-weight: 800;">Received ${res.gainedCC} CC!</p>
      <button class="ok-btn" style="background: #facc15; color: var(--bg); border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-weight: 700;">OK</button>
    `;
    successModal.querySelector(".ok-btn").addEventListener("click", () => closeOverlay(modal2));
    modal2.appendChild(successModal);

    const prev = structuredClone(userData);
    userData = await fetchUserData();
    refreshStats(userData, prev);
    renderPokemonGrid();
    updateTeamCounter();
    closeOverlay(overlay);
  } catch (err) {
    alert("❌ " + err.message);
    closeOverlay(overlay);
  }
}

//------------------------------------------------------------
// 🔄 Navigation Tabs — Unified Token-Safe Routing
//------------------------------------------------------------
(function initNavTabs() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const token = params.get("token");

  if (!id || !token) {
    console.warn("❌ Missing ID or token in URL — tabs disabled.");
    return;
  }

  const goPokemon  = document.getElementById("goPokemon");
  const goTrainers = document.getElementById("goTrainers");
  const goShop     = document.getElementById("goShop");

  // ⭐ Pokémon Tab
  if (goPokemon) {
    goPokemon.onclick = () => {
      window.location.href = `/public/picker-pokemon/?id=${id}&token=${token}`;
    };
  }

  // 🧑 Trainers Tab
  if (goTrainers) {
    goTrainers.onclick = () => {
      window.location.href = `/public/picker/?id=${id}&token=${token}`;
    };
  }

  // 🛒 Shop Tab
  if (goShop) {
    goShop.onclick = () => {
      window.location.href = `/public/picker-shop/?id=${id}&token=${token}`;
    };
  }
})();
