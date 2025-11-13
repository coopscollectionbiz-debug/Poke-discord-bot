// ===========================================================
// Coop's Collection — Unified Dashboard Script
// ===========================================================
// Features:
// • Tab-based navigation (Pokémon, Trainers, Shop)
// • Pokémon team management (6-mon team + evolve + donate)
// • Trainer selection
// • Shop with CC purchases
// • Token-secured API communication
// ===========================================================

import { rarityEmojis } from "/public/spriteconfig.js";

// ===========================================================
// 🎨 CONSTANTS & CONFIG
// ===========================================================
const SPRITE_PATHS = {
  pokemon: "/public/sprites/pokemon/normal/",
  shiny: "/public/sprites/pokemon/shiny/",
  grayscale: "/public/sprites/pokemon/grayscale/",
  trainers: "/public/sprites/trainers_2/",
  trainersGray: "/public/sprites/trainers_2/grayscale/",
  items: "/public/sprites/items/",
  types: "/public/sprites/types/",
};

const EVO_COSTS = {
"common-common": 1,  
"common-uncommon": 1,
"uncommon-uncommon": 2,
  "common-rare": 3,
  "uncommon-rare": 2,
  "rare-epic": 3,
  "epic-legendary": 5,
  "legendary-mythic": 7,
};


const API_ENDPOINTS = {
  userPokemon: "/api/user-pokemon",
  setTeam: "/api/set-pokemon-team",
  evolvePokemon: "/api/pokemon/evolve",
  donatePokemon: "/api/pokemon/donate",
  userTrainers: "/api/user-trainers",
  setTrainer: "/api/set-trainer",
  shopItems: "/api/shop-items",
  purchaseItem: "/api/purchase-item",
};

// ===========================================================
// 🧠 GLOBAL STATE
// ===========================================================
let userId = null;
let token = null;
let userData = null;
let allPokemon = [];
let allTrainers = {};
let shopItems = [];

// Flattened trainer list (needed for cross-tab features)
let allTrainerEntries = [];

// Pokémon state
let selectedTeam = [];
let currentMode = "team"; // team, evolve, donate
let showOwnedOnly = false;
let showUnownedOnly = false;
let shinyMode = false;
let pokemonRarityFilter = "";
let pokemonTypeFilter = "";

// Trainer state
let trainerRarityFilter = "all";
let trainerShowOwnedOnly = false;
let trainerShowUnownedOnly = false;

// ===========================================================
// 🚀 INITIALIZATION
// ===========================================================
window.addEventListener("DOMContentLoaded", async () => {
  // Extract URL params
  const urlParams = new URLSearchParams(window.location.search);
  userId = urlParams.get("id");
  token = urlParams.get("token");

  if (!userId || !token) {
    showError("❌ Missing user ID or token. Launch from Discord using /dashboard.");
    return;
  }

  // Setup tab navigation
  setupTabs();
  
  // Setup controls
  setupPokemonControls();
  setupTrainerControls();
  
  // Load all data
  await loadAllData();
});

// ===========================================================
// 📑 TAB MANAGEMENT
// ===========================================================
function setupTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = btn.dataset.tab;

      // Update buttons
      tabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Update content
      tabContents.forEach((content) => {
        content.classList.remove("active");
        if (content.id === `${tabName}-tab`) {
          content.classList.add("active");
        }
      });

      // Load tab-specific data if needed
      if (tabName === "shop") {
        renderShop();
      }
    });
  });
}

// ===========================================================
// 📦 DATA LOADING
// ===========================================================
async function loadAllData() {
  try {
    // ===========================================================
    // 🧩 Load Pokémon
    // ===========================================================
    const pokemonRes = await fetch("/public/pokemonData.json");
    const rawPokemon = await pokemonRes.json();
    allPokemon = Object.entries(rawPokemon).map(([id, info]) => ({
      id,
      ...info,
    }));

    // ===========================================================
// 🧩 Load Trainers (correct structure for trainerSprites.json)
// ===========================================================
const trainerRes = await fetch("/public/trainerSprites.json");
const rawTrainers = await trainerRes.json();

// Preserve full structured trainer map for renderTrainers()
allTrainers = rawTrainers;

// Flatten for optional future uses
allTrainerEntries = Object.entries(rawTrainers).flatMap(([name, info]) => {
  const files = Array.isArray(info.sprites) ? info.sprites : [];

  return files.map(fileName => ({
    name,
    file: fileName,
    tier: info.tier?.toLowerCase() || "common",
    spritePath: `/public/sprites/trainers_2/${fileName}`,
  }));
});

    // ===========================================================
    // 👤 Load User Data
    // ===========================================================
    const userRes = await fetch(
      `${API_ENDPOINTS.userPokemon}?id=${userId}&token=${token}`
    );

    if (userRes.status === 403) {
      showError("⏰ Session expired. Please reopen /dashboard from Discord.");
      return;
    }

    if (!userRes.ok) throw new Error(`HTTP ${userRes.status}`);
    userData = await userRes.json();

    // ===========================================================
    // 📊 Update Stats Bar
    // ===========================================================
    updateStatsBar();

    // ===========================================================
    // 🧬 Initialize Pokémon View
    // ===========================================================
    selectedTeam = userData.currentTeam || [];
    renderPokemon();

    // ===========================================================
    // 🎒 Load User’s Owned Trainers
    // ===========================================================
    const trainerUserRes = await fetch(
      `${API_ENDPOINTS.userTrainers}?id=${userId}&token=${token}`
    );

    if (trainerUserRes.status === 403) {
      showError("⏰ Session expired. Please reopen /dashboard from Discord.");
      return;
    }

    if (trainerUserRes.ok) {
      const trainerUserData = await trainerUserRes.json();
      userData.ownedTrainers = trainerUserData.owned || [];
      renderTrainers();
    }

    // ===========================================================
    // 🏪 Load Shop Items
    // ===========================================================
    await loadShopItems();

    console.log("✅ All data loaded successfully");
  } catch (err) {
    console.error("❌ loadAllData failed:", err);
    showError("❌ Failed to load data. Please re-open the link.");
  }
}

// Helper function to refresh user data after actions like evolution/donation
async function loadUserData() {
  try {
    const userRes = await fetch(
      `${API_ENDPOINTS.userPokemon}?id=${userId}&token=${token}`
    );
    
    if (userRes.status === 403) {
      showPopup("⏰ Session Expired", "Your session has expired. Please reopen /dashboard from Discord.", "#ef4444");
      return;
    }
    
    if (!userRes.ok) throw new Error(`HTTP ${userRes.status}`);
    const freshData = await userRes.json();
    
    // Update userData with fresh values
    userData.pokemon = freshData.pokemon;
    userData.items = freshData.items;
    userData.cc = freshData.cc;
    userData.tp = freshData.tp;
    userData.rank = freshData.rank;
    
    // Update stats bar
    updateStatsBar();
  } catch (err) {
    console.error("❌ loadUserData failed:", err);
  }
}

async function loadShopItems() {
  try {
    const res = await fetch(`${API_ENDPOINTS.shopItems}?id=${userId}&token=${token}`);
    if (res.ok) {
      const data = await res.json();
      shopItems = data.items || [];
    } else {
      // Fallback to default shop items if API not available
      shopItems = getDefaultShopItems();
    }
  } catch (err) {
    console.warn("⚠️ Shop API unavailable, using defaults:", err);
    shopItems = getDefaultShopItems();
  }
}

function getDefaultShopItems() {
  return [
    {
      id: "starter_pack",
      name: "Starter Pack",
      description: "1 Common Pokémon • 1 Uncommon • 1 Rare • 1 Rare Trainer (Guaranteed)",
      price: 350,
      image: `${SPRITE_PATHS.items}starter_pack.png`,
      quantity: "one-time",
    },
    {
      id: "pokeball",
      name: "Poké Ball",
      description: "Get 1 random Pokémon (normal odds).",
      price: 50,
      image: `${SPRITE_PATHS.items}pokeball.png`,
      quantity: "unlimited",
    },
    {
      id: "greatball",
      name: "Great Ball",
      description: "Get 1 random Pokémon with boosted odds for Uncommon+.",
      price: 100,
      image: `${SPRITE_PATHS.items}greatball.png`,
      quantity: "unlimited",
    },
    {
      id: "ultraball",
      name: "Ultra Ball",
      description: "Get 1 random Pokémon with boosted odds for Rare+.",
      price: 180,
      image: `${SPRITE_PATHS.items}ultraball.png`,
      quantity: "unlimited",
    }
  ];
}

// ===========================================================
// 📊 STATS BAR
// ===========================================================
function updateStatsBar() {
  document.getElementById("stoneCount").textContent = userData.items?.evolution_stone || 0;
  document.getElementById("ccCount").textContent = userData.cc || 0;
  document.getElementById("tpCount").textContent = userData.tp || 0;
  document.getElementById("rankLabel").textContent = userData.rank || "Novice Trainer";

  // Add compact class on scroll
  let lastScroll = 0;
  window.addEventListener("scroll", () => {
    const statsBar = document.getElementById("statsBar");
    if (window.scrollY > 100 && window.scrollY > lastScroll) {
      statsBar.classList.add("compact");
    } else if (window.scrollY < 50) {
      statsBar.classList.remove("compact");
    }
    lastScroll = window.scrollY;
  });
}

function animateStat(elementId, value, color = "--brand") {
  const el = document.getElementById(elementId);
  el.textContent = value;
  el.style.setProperty("--pulse-color", `var(${color})`);
  el.classList.add("pulse");
  setTimeout(() => el.classList.remove("pulse"), 400);
}

// ===========================================================
// 🎮 POKÉMON TAB
// ===========================================================

function setupPokemonControls() {
  // Mode buttons
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const mode = e.target.dataset.mode;
      if (!mode) return;

      currentMode = mode;
      document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      
      // Reset team selection when changing modes
      if (mode !== "team") {
        selectedTeam = [];
      }
      
      renderPokemon();
    });
  });

  // Search
  document.getElementById("pokemonSearch").addEventListener("input", (e) => {
    renderPokemon(e.target.value);
  });

  // Rarity filter
  document.getElementById("pokemonRarityFilter").addEventListener("change", (e) => {
    pokemonRarityFilter = e.target.value;
    renderPokemon(document.getElementById("pokemonSearch").value);
  });

  // Type filter
  document.getElementById("pokemonTypeFilter").addEventListener("change", (e) => {
    pokemonTypeFilter = e.target.value;
    renderPokemon(document.getElementById("pokemonSearch").value);
  });

  // Owned toggle
  document.getElementById("pokemonOwnedToggle").addEventListener("click", (e) => {
    showOwnedOnly = !showOwnedOnly;
    showUnownedOnly = false;
    e.target.classList.toggle("active", showOwnedOnly);
    document.getElementById("pokemonUnownedToggle").classList.remove("active");
    renderPokemon(document.getElementById("pokemonSearch").value);
  });

  // Unowned toggle
  document.getElementById("pokemonUnownedToggle").addEventListener("click", (e) => {
    showUnownedOnly = !showUnownedOnly;
    showOwnedOnly = false;
    e.target.classList.toggle("active", showUnownedOnly);
    document.getElementById("pokemonOwnedToggle").classList.remove("active");
    renderPokemon(document.getElementById("pokemonSearch").value);
  });

  // Shiny toggle
  document.getElementById("pokemonShinyToggle").addEventListener("click", (e) => {
    shinyMode = !shinyMode;
    e.target.textContent = shinyMode ? "🌟 Shiny Mode ON" : "🌟 Shiny Mode OFF";
    e.target.classList.toggle("active", shinyMode);
    renderPokemon(document.getElementById("pokemonSearch").value);
  });

  // Save team button
  document.getElementById("saveTeamBtn").addEventListener("click", saveTeam);
}

function renderPokemon(searchFilter = "") {
  const grid = document.getElementById("pokemonGrid");
  grid.innerHTML = "";

  const userPokemon = userData.pokemon || {};

  allPokemon.forEach((pkmn) => {
    // Apply filters
    if (pokemonRarityFilter && pkmn.tier?.toLowerCase() !== pokemonRarityFilter) return;
    if (pokemonTypeFilter && !pkmn.types?.some(t => t.toLowerCase() === pokemonTypeFilter)) return;
    if (searchFilter && !pkmn.name.toLowerCase().includes(searchFilter.toLowerCase())) return;

    const owned = userPokemon[pkmn.id];
    const normalCount = owned?.normal || 0;
    const shinyCount = owned?.shiny || 0;
    const hasAny = normalCount > 0 || shinyCount > 0;
    const displayCount = shinyMode ? shinyCount : normalCount;

    if (showOwnedOnly && !hasAny) return;
    if (showUnownedOnly && hasAny) return;

    // Determine sprite
    let spritePath;
    if (!hasAny || displayCount === 0) {
      spritePath = `${SPRITE_PATHS.grayscale}${pkmn.id}.gif`;
    } else if (shinyMode && shinyCount > 0) {
      spritePath = `${SPRITE_PATHS.shiny}${pkmn.id}.gif`;
    } else {
      spritePath = `${SPRITE_PATHS.pokemon}${pkmn.id}.gif`;
    }

    // Create card
    const card = createPokemonCard(pkmn, spritePath, hasAny, displayCount);
    grid.appendChild(card);
  });

  updateTeamCounter();

  if (grid.children.length === 0) {
    grid.innerHTML = "<p class='notice'>No Pokémon match your filters.</p>";
  }
}

function createPokemonCard(pkmn, spritePath, owned, count) {
  const card = document.createElement("div");
  card.className = `pokemon-card ${owned ? "owned" : "unowned"}`;

  const rarity = (pkmn.tier || "common").toLowerCase();
  const emoji = rarityEmojis?.[rarity] || "⚬";
  const tierDisplay = rarity.charAt(0).toUpperCase() + rarity.slice(1);

  const spriteWrapper = document.createElement("div");
  spriteWrapper.className = "sprite-wrapper";

  const img = document.createElement("img");
  img.src = spritePath;
  img.alt = pkmn.name;
  img.loading = "lazy";
  img.className = "poke-sprite";

  spriteWrapper.appendChild(img);

  // Lock overlay for unowned
  if (!owned) {
    const lock = document.createElement("div");
    lock.className = "lock-overlay";
    lock.innerHTML = "<span>🔒</span>";
    spriteWrapper.appendChild(lock);
  }

  // Team badge
  const teamIndex = selectedTeam.findIndex((p) => p.id === pkmn.id && p.shiny === shinyMode);
  if (teamIndex >= 0 && currentMode === "team") {
    const badge = document.createElement("div");
    badge.className = "team-badge";
    badge.textContent = teamIndex + 1;
    spriteWrapper.appendChild(badge);
    card.classList.add("selected");
  }

  // Count label
  if (owned && count > 0) {
    const countLabel = document.createElement("div");
    countLabel.className = "count-label";
    countLabel.textContent = `x${count}`;
    spriteWrapper.appendChild(countLabel);
  }

 // Evolution cost badge (evolve mode)
if (currentMode === "evolve" && owned && pkmn.evolution) {
  const evoCost = document.createElement("div");
  evoCost.className = "evolve-cost";

  // Determine actual evolution cost from tier map
  const target = allPokemon.find(p => p.id === pkmn.evolution);
  const evoKey = `${(pkmn.tier || "common").toLowerCase()}-${(target?.tier || "uncommon").toLowerCase()}`;
  const evoPrice = EVO_COSTS[evoKey] || 1;

  // Evolution stone sprite (16px icon)
  const stoneIcon = document.createElement("img");
  stoneIcon.src = `${SPRITE_PATHS.items}evolution_stone.png`;
  stoneIcon.className = "stone-icon";
  stoneIcon.alt = "Evolution Stone";
  stoneIcon.draggable = false;

  evoCost.appendChild(stoneIcon);
  evoCost.appendChild(document.createTextNode(` ${evoPrice}`));

  spriteWrapper.appendChild(evoCost);

  // Styling eligibility
  const hasStone = (userData.items?.evolution_stone || 0) >= evoPrice;
  if (hasStone) {
    card.classList.add("eligible");
  } else {
    card.classList.add("ineligible");
  }
}

    spriteWrapper.appendChild(evoCost);
    
    const hasStone = (userData.items?.evolution_stone || 0) > 0;
    if (hasStone) {
      card.classList.add("eligible");
    } else {
      card.classList.add("ineligible");
    }
  }

  // Donate value badge (donate mode)
  if (currentMode === "donate" && owned && count > 0) {
    const donateVal = document.createElement("div");
    donateVal.className = "donate-value";
    const ccValue = calculateDonationValue(rarity, shinyMode);
    donateVal.textContent = `💰 ${ccValue}`;
    spriteWrapper.appendChild(donateVal);
  }

  card.appendChild(spriteWrapper);
  card.innerHTML += `
    <p class="pokemon-name">${pkmn.name}</p>
    <div class="pokemon-tier">
      <span class="tier-emoji">${emoji}</span>
      <span class="tier-text ${rarity}">${tierDisplay}</span>
    </div>
  `;

  // Click handler
  if (owned) {
    card.onclick = () => handlePokemonClick(pkmn, card);
  }

  return card;
}

function handlePokemonClick(pkmn, card) {
  if (currentMode === "team") {
    toggleTeamSelection(pkmn, card);
  } else if (currentMode === "evolve") {
    evolvePokemon(pkmn);
  } else if (currentMode === "donate") {
    donatePokemon(pkmn);
  }
}

function toggleTeamSelection(pkmn, card) {
  const teamObj = { id: pkmn.id, shiny: shinyMode };
  const existingIndex = selectedTeam.findIndex(
    (p) => p.id === pkmn.id && p.shiny === shinyMode
  );

  if (existingIndex >= 0) {
    // Remove from team
    selectedTeam.splice(existingIndex, 1);
    card.classList.remove("selected");
  } else if (selectedTeam.length < 6) {
    // Add to team
    selectedTeam.push(teamObj);
    card.classList.add("selected");
  } else {
    showPopup("⚠️ Team Full", "You can only have 6 Pokémon on your team!", "#facc15");
    return;
  }

  renderPokemon(document.getElementById("pokemonSearch").value);
}

function updateTeamCounter() {
  const counter = document.getElementById("teamCounter");
  counter.textContent = `${selectedTeam.length}/6 selected`;
}

async function saveTeam() {
  try {
    const statusMsg = document.getElementById("teamStatus");
    statusMsg.textContent = "Saving team...";
    statusMsg.className = "status-msg active";

    const res = await fetch(API_ENDPOINTS.setTeam, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, team: selectedTeam }),
    });

    if (res.status === 403) {
      statusMsg.textContent = "⏰ Session expired - reopen /dashboard";
      statusMsg.className = "status-msg error";
      showPopup("⏰ Session Expired", "Your session has expired. Please reopen /dashboard from Discord.", "#ef4444");
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success) {
      statusMsg.textContent = "✅ Team saved successfully!";
      statusMsg.className = "status-msg success";
      userData.currentTeam = selectedTeam;
    } else {
      throw new Error("Failed to save team");
    }

    setTimeout(() => {
      statusMsg.textContent = "";
      statusMsg.className = "status-msg";
    }, 3000);
  } catch (err) {
    console.error("❌ saveTeam failed:", err);
    const statusMsg = document.getElementById("teamStatus");
    statusMsg.textContent = "❌ Failed to save team";
    statusMsg.className = "status-msg error";
  }
}

async function evolvePokemon(pkmn) {
  if (!pkmn.evolution) {
    showPopup("❌ Cannot Evolve", "This Pokémon has no evolution!", "#ef4444");
    return;
  }

  const hasStone = (userData.items?.evolution_stone || 0) > 0;
  if (!hasStone) {
    showPopup("❌ No Evolution Stones", "You need an Evolution Stone to evolve Pokémon!", "#ef4444");
    return;
  }

  try {
    const res = await fetch(API_ENDPOINTS.evolvePokemon, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        id: userId, 
        token, 
        baseId: pkmn.id, 
        targetId: pkmn.evolution, 
        shiny: shinyMode 
      }),
    });

    if (res.status === 403) {
      showPopup("⏰ Session Expired", "Your session has expired. Please reopen /dashboard from Discord.", "#ef4444");
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success) {
      // Update local data
      userData.items.evolution_stone = data.stones;
      
      // Refresh user data to get updated Pokémon
      await loadUserData();
      
      animateStat("stoneCount", userData.items.evolution_stone);
      
      // Show evolution popup
      showEvolutionPopup(data.evolved, shinyMode);
      
      // Re-render
      renderPokemon(document.getElementById("pokemonSearch").value);
    } else {
      throw new Error(data.error || "Evolution failed");
    }
  } catch (err) {
    console.error("❌ evolvePokemon failed:", err);
    showPopup("❌ Evolution Failed", err.message, "#ef4444");
  }
}

async function donatePokemon(pkmn) {
  const userPokemon = userData.pokemon[pkmn.id];
  const count = shinyMode ? (userPokemon?.shiny || 0) : (userPokemon?.normal || 0);

  if (count <= 0) {
    showPopup("❌ Cannot Donate", "You don't have this Pokémon!", "#ef4444");
    return;
  }

  try {
    const res = await fetch(API_ENDPOINTS.donatePokemon, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, pokeId: pkmn.id, shiny: shinyMode }),
    });

    if (res.status === 403) {
      showPopup("⏰ Session Expired", "Your session has expired. Please reopen /dashboard from Discord.", "#ef4444");
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success) {
      // Update local data
      userData.cc = data.totalCC;
      
      // Refresh user data to get updated Pokémon
      await loadUserData();
      
      animateStat("ccCount", userData.cc, "--gold");
      
      // Show donation popup
      showDonationPopup(pkmn, data.gainedCC, shinyMode);
      
      // Re-render
      renderPokemon(document.getElementById("pokemonSearch").value);
    } else {
      throw new Error(data.error || "Donation failed");
    }
  } catch (err) {
    console.error("❌ donatePokemon failed:", err);
    showPopup("❌ Donation Failed", err.message, "#ef4444");
  }
}

function calculateDonationValue(rarity, isShiny = false) {
  const values = {
    common: 10,
    uncommon: 25,
    rare: 50,
    epic: 100,
    legendary: 200,
    mythic: 500,
  };

  const base = values[rarity] || 10;
  return isShiny ? base * 5 : base;
}

// ===========================================================
// 👤 TRAINER TAB
// ===========================================================

function setupTrainerControls() {
  // Search
  document.getElementById("trainerSearch").addEventListener("input", (e) => {
    renderTrainers(e.target.value);
  });

  // Rarity filter
  document.getElementById("trainerRarityFilter").addEventListener("change", (e) => {
    trainerRarityFilter = e.target.value;
    renderTrainers(document.getElementById("trainerSearch").value);
  });

  // Owned toggle
  document.getElementById("trainerOwnedToggle").addEventListener("click", (e) => {
    trainerShowOwnedOnly = !trainerShowOwnedOnly;
    trainerShowUnownedOnly = false;
    e.target.classList.toggle("active", trainerShowOwnedOnly);
    document.getElementById("trainerUnownedToggle").classList.remove("active");
    renderTrainers(document.getElementById("trainerSearch").value);
  });

  // Unowned toggle
  document.getElementById("trainerUnownedToggle").addEventListener("click", (e) => {
    trainerShowUnownedOnly = !trainerShowUnownedOnly;
    trainerShowOwnedOnly = false;
    e.target.classList.toggle("active", trainerShowUnownedOnly);
    document.getElementById("trainerOwnedToggle").classList.remove("active");
    renderTrainers(document.getElementById("trainerSearch").value);
  });
}

function normalizeTrainerSprites(info) {
  if (!info || !Array.isArray(info.sprites)) return [];

  return info.sprites
    .map(entry => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && !entry.disabled) return entry.file;
      return null;
    })
    .filter(Boolean);
}

function renderTrainers(searchFilter = "") {
  const grid = document.getElementById("trainerGrid");
  grid.innerHTML = "";

  const ownedTrainers = userData.ownedTrainers || [];

  Object.entries(allTrainers).forEach(([name, info]) => {
    const rarity = (info.tier || "common").toLowerCase();

    if (trainerRarityFilter !== "all" && rarity !== trainerRarityFilter) return;
    if (searchFilter && !name.toLowerCase().includes(searchFilter.toLowerCase())) return;

    const spriteFiles = normalizeTrainerSprites(info);

    spriteFiles.forEach(fileName => {
      const owned = ownedTrainers.some(t =>
        t.split("/").pop().toLowerCase() === fileName.toLowerCase()
      );

      if (trainerShowOwnedOnly && !owned) return;
      if (trainerShowUnownedOnly && owned) return;

      const card = createTrainerCard(name, fileName, rarity, owned);
      grid.appendChild(card);
    });
  });

  if (grid.children.length === 0) {
    grid.innerHTML = "<p class='notice'>No trainers match your filters.</p>";
  }
}

function createTrainerCard(name, fileName, rarity, owned) {
  const card = document.createElement("div");
  card.className = `trainer-card ${owned ? "owned" : "unowned"}`;

  const emoji = rarityEmojis?.[rarity] || "⚬";
  const tierDisplay = rarity.charAt(0).toUpperCase() + rarity.slice(1);

  const imgPath = owned
    ? `${SPRITE_PATHS.trainers}${fileName}`
    : `${SPRITE_PATHS.trainersGray}${fileName}`;

  // -----------------------------
  // Sprite wrapper + image
  // -----------------------------
  const spriteWrapper = document.createElement("div");
  spriteWrapper.className = "sprite-wrapper";

  const img = document.createElement("img");
  img.src = imgPath;
  img.alt = name;
  img.loading = "lazy";
  img.onerror = () => {
    console.warn(`⚠️ Missing sprite file: ${fileName}`);
    card.remove();
  };

  spriteWrapper.appendChild(img);

  if (!owned) {
    const lock = document.createElement("div");
    lock.className = "lock-overlay";
    lock.innerHTML = "<span>🔒</span>";
    spriteWrapper.appendChild(lock);
  }

  card.appendChild(spriteWrapper);

  // -----------------------------
  // Name
  // -----------------------------
  const nameEl = document.createElement("p");
  nameEl.className = "trainer-name";
  nameEl.textContent = name;
  card.appendChild(nameEl);

  // -----------------------------
  // Tier row
  // -----------------------------
  const tierRow = document.createElement("div");
  tierRow.className = "trainer-tier";

  const emojiSpan = document.createElement("span");
  emojiSpan.className = "tier-emoji";
  emojiSpan.textContent = emoji;

  const tierTextSpan = document.createElement("span");
  tierTextSpan.className = `tier-text ${rarity}`;
  tierTextSpan.textContent = tierDisplay;

  tierRow.appendChild(emojiSpan);
  tierRow.appendChild(tierTextSpan);

  card.appendChild(tierRow);

  // -----------------------------
  // Click handler
  // -----------------------------
  if (owned) {
    card.addEventListener("click", () => selectTrainer(name, fileName));
  }

  return card;
}

async function selectTrainer(name, fileName) {
  try {
    const res = await fetch(API_ENDPOINTS.setTrainer, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, name, file: fileName }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success) {
      showPopup("✅ Trainer Equipped!", `${name} is now your displayed Trainer!`);
    } else {
      throw new Error("Failed to equip trainer");
    }
  } catch (err) {
    console.error("❌ selectTrainer failed:", err);
    showPopup("❌ Error", "Could not equip trainer.", "#ef4444");
  }
}

// ===========================================================
// 🛒 SHOP TAB — FINAL VERSION (Starter Pack + Balls + Stones)
// ===========================================================

async function loadShopItems() {
  try {
    const res = await fetch(
      `${API_ENDPOINTS.shopItems}?id=${userId}&token=${token}`
    );

    if (!res.ok) throw new Error(`Shop load failed: HTTP ${res.status}`);

    const data = await res.json();
    shopItems = data.items || [];
    renderShop();
  } catch (err) {
    console.error("❌ loadShopItems failed:", err);
    document.getElementById("shopGrid").innerHTML =
      "<p class='error'>Failed to load shop items.</p>";
  }
}

function renderShop() {
  const grid = document.getElementById("shopGrid");
  grid.innerHTML = "";

  shopItems.forEach((item) => {
    const card = document.createElement("div");
    card.className = "shop-item";

    const img = document.createElement("img");
    img.src = item.image;
    img.className = "shop-item-image";

    const name = document.createElement("div");
    name.className = "shop-item-name";
    name.textContent = item.name;

    const desc = document.createElement("div");
    desc.className = "shop-item-description";
    desc.textContent = item.description;

    const price = document.createElement("div");
    price.className = "shop-item-price";
    price.textContent = `${item.price} CC`;

    const btn = document.createElement("button");
    btn.className = "shop-buy-btn";
    btn.textContent = "Buy";

    // Starter Pack one-time rule
    const alreadyBought =
      item.id === "starter_pack" && userData.items?.starter_pack >= 1;

    if (alreadyBought) {
      btn.disabled = true;
      btn.textContent = "Purchased";
    }

    btn.onclick = () => confirmBuyItem(item);

    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(desc);
    card.appendChild(price);
    card.appendChild(btn);

    grid.appendChild(card);
  });
}

// ===========================================================
// 🟢 CONFIRM PURCHASE POPUP
// ===========================================================
function confirmBuyItem(item) {
  if (isBuying) return;

  const overlay = document.getElementById("shopPopupOverlay");
  const popup = document.getElementById("shopPopup");

  popup.innerHTML = `
    <h2>Purchase ${item.name}?</h2>
    <img src="${item.image}">
    <p>${item.description}</p>
    <p class="shop-price">Cost: ${item.price} CC</p>

    <div class="shop-popup-buttons">
      <button id="shopConfirm" class="confirm-btn">Confirm</button>
      <button id="shopCancel" class="cancel-btn">Cancel</button>
    </div>
  `;

  overlay.style.display = "flex";

  document.getElementById("shopCancel").onclick = () => closeShopPopup();

  document.getElementById("shopConfirm").onclick = async () => {
    await buyItem(item);
    closeShopPopup();
  };
}

function closeShopPopup() {
  const overlay = document.getElementById("shopPopupOverlay");
  overlay.classList.add("fadeOut");
  setTimeout(() => {
    overlay.style.display = "none";
    overlay.classList.remove("fadeOut");
  }, 260);
}

// ===========================================================
// 🟣 PURCHASE ITEM
// ===========================================================
async function buyItem(item) {
  if (isBuying) return;
  isBuying = true;

  try {
    const res = await fetch("/api/purchase-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: userId,
        token,
        itemId: item.id,
      }),
    });

    const data = await res.json();
    if (!data.success) {
      showPopup("❌ Purchase Failed", data.error || "Unknown error", "#ef4444");
      isBuying = false;
      return;
    }

    // Update user CC + items
    userData.cc = data.newCC;
    userData.items = data.items;
    userData.purchases = data.purchases;

    animateStat("ccCount", userData.cc, "--brand");

    // Show rewards
    if (Array.isArray(data.rewards)) {
      for (const reward of data.rewards) {
        showShopRewardPopup(reward);
      }
    }

    renderShop();
  } catch (err) {
    console.error("❌ buyItem failed:", err);
    showPopup("❌ Error", "Could not complete purchase.", "#ef4444");
  }

  isBuying = false;
}


// ===========================================================
// ✨ POPUP UTILITIES
// ===========================================================

function showPopup(title, message, color = "#00ff9d") {
  const popup = document.createElement("div");
  popup.innerHTML = `
    <div style="
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #1b1b2f;
      color: white;
      border: 2px solid ${color};
      border-radius: 16px;
      padding: 20px 30px;
      text-align: center;
      box-shadow: 0 0 20px rgba(0, 255, 157, 0.4);
      font-family: 'Inter', sans-serif;
      z-index: 9999;
      max-width: 320px;
      animation: fadeIn 0.3s ease;
    ">
      <h2 style="margin: 0 0 8px; font-size: 1.2em;">${title}</h2>
      <p style="margin: 0; font-size: 0.95em;">${message}</p>
    </div>
  `;
  document.body.appendChild(popup);

  setTimeout(() => {
    popup.firstChild.style.transition = "opacity 0.4s ease";
    popup.firstChild.style.opacity = "0";
    setTimeout(() => popup.remove(), 400);
  }, 2500);
}

function showEvolutionPopup(evolved, isShiny) {
  const overlay = document.getElementById("evoPopupOverlay");
  const popup = document.getElementById("evoPopup");
  
  if (isShiny) {
    popup.classList.add("shiny");
  } else {
    popup.classList.remove("shiny");
  }
  
  const spritePath = isShiny 
    ? `${SPRITE_PATHS.shiny}${evolved.id}.gif`
    : `${SPRITE_PATHS.pokemon}${evolved.id}.gif`;
  
  document.getElementById("evoSprite").src = spritePath;
  document.getElementById("evoMessage").textContent = 
    `Your Pokémon evolved into ${evolved.name}!`;
  
  overlay.style.display = "flex";
  
  document.getElementById("closeEvoPopup").onclick = () => {
    overlay.classList.add("fadeOut");
    setTimeout(() => {
      overlay.style.display = "none";
      overlay.classList.remove("fadeOut");
    }, 300);
  };
}

function showDonationPopup(pkmn, ccGained, isShiny) {
  const overlay = document.getElementById("donationPopupOverlay");
  const popup = document.getElementById("donationPopup");
  
  if (isShiny) {
    popup.classList.add("shiny");
  } else {
    popup.classList.remove("shiny");
  }
  
  const spritePath = isShiny
    ? `${SPRITE_PATHS.shiny}${pkmn.id}.gif`
    : `${SPRITE_PATHS.pokemon}${pkmn.id}.gif`;
  
  document.getElementById("donationSprite").src = spritePath;
  document.getElementById("donationMessage").textContent = 
    `You donated ${pkmn.name} to the collection!`;
  document.getElementById("donationCC").textContent = `+${ccGained} CC earned!`;
  
  overlay.style.display = "flex";
  
  document.getElementById("closeDonationPopup").onclick = () => {
    overlay.classList.add("fadeOut");
    setTimeout(() => {
      overlay.style.display = "none";
      overlay.classList.remove("fadeOut");
    }, 300);
  };
}

function showError(message) {
  document.getElementById("pokemonGrid").innerHTML = 
    `<p class='error'>${message}</p>`;
}

// ===========================================================
// 🎁 SHOW REWARD POPUP (Pokémon / Trainer)
// ===========================================================
function showShopRewardPopup(reward) {
  const overlay = document.getElementById("shopPopupOverlay");
  const popup = document.getElementById("shopPopup");

  const isPokemon = reward.type === "pokemon";

  let sprite;
  if (isPokemon) {
    sprite = reward.shiny
      ? `${SPRITE_PATHS.shiny}${reward.id}.gif`
      : `${SPRITE_PATHS.pokemon}${reward.id}.gif`;
  } else {
    sprite = `${SPRITE_PATHS.trainers}${reward.spriteFile || reward.filename}`;
  }

  popup.innerHTML = `
    <h2>${isPokemon ? "New Pokémon!" : "New Trainer!"}</h2>
    <img src="${sprite}">
    <p>${reward.shiny ? "✨ Shiny " : ""}${reward.name}</p>
    <button class="confirm-btn" id="closeRewardPopup">Close</button>
  `;

  overlay.style.display = "flex";

  document.getElementById("closeRewardPopup").onclick = () => {
    closeShopPopup();
  };
}

