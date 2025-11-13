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
  const baseURL = window.location.origin;

  try {
    // =======================================================
    // 🧩 Load Pokémon + Trainer Data (Safe for Render + Local)
    // =======================================================
    // 🐉 Pokémon Data
    const pokemonRes = await fetch(`${baseURL}/public/pokemonData.json`);
    if (!pokemonRes.ok) throw new Error(`Failed to load pokemonData.json (${pokemonRes.status})`);
    const rawPokemon = await pokemonRes.json();

    // Handle both array and object formats safely
    allPokemon = Array.isArray(rawPokemon)
      ? rawPokemon
      : Object.entries(rawPokemon).map(([id, info]) => ({ id, ...info }));

    if (!Array.isArray(allPokemon)) {
      console.warn("⚠️ pokemonData.json did not load as expected, forcing empty array fallback");
      allPokemon = [];
    }

    // 👥 Trainer Data
    const trainerRes = await fetch(`${baseURL}/public/trainerSprites.json`);
    if (!trainerRes.ok) throw new Error(`Failed to load trainerSprites.json (${trainerRes.status})`);
    allTrainers = await trainerRes.json();

    if (!allTrainers || typeof allTrainers !== "object") {
      console.warn("⚠️ trainerSprites.json invalid or empty, applying empty fallback");
      allTrainers = {};
    }

    console.log(`✅ Loaded ${allPokemon.length} Pokémon and ${Object.keys(allTrainers).length} trainers`);

    // =======================================================
    // 👤 Load User Pokémon Data
    // =======================================================
    const userRes = await fetch(`${API_ENDPOINTS.userPokemon}?id=${userId}&token=${token}`);
    if (userRes.status === 403) {
      showError("⏰ Session expired. Please reopen /dashboard from Discord.");
      return;
    }
    if (!userRes.ok) throw new Error(`HTTP ${userRes.status}`);
    userData = await userRes.json();

    // Update stats bar
    updateStatsBar();

    // Initialize Pokémon view
    selectedTeam = userData.currentTeam || [];
    renderPokemon();

    // =======================================================
    // 🎴 Load Trainer Ownership
    // =======================================================
    const trainerUserRes = await fetch(`${API_ENDPOINTS.userTrainers}?id=${userId}&token=${token}`);
    if (trainerUserRes.status === 403) {
      showError("⏰ Session expired. Please reopen /dashboard from Discord.");
      return;
    }
    if (trainerUserRes.ok) {
      const trainerUserData = await trainerUserRes.json();
      userData.ownedTrainers = Array.isArray(trainerUserData.owned)
        ? trainerUserData.owned
        : Object.keys(trainerUserData.owned || {});
      renderTrainers();
    }

    // =======================================================
    // 🛒 Load Shop Items
    // =======================================================
    await loadShopItems();

    console.log("✅ All data loaded successfully");
  } catch (err) {
    console.error("❌ loadAllData failed:", err);
    showError("❌ Failed to load data. Please re-open the link.");
  }
}
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
      id: "evolution_stone",
      name: "Evolution Stone",
      description: "Evolve any Pokémon that has an evolution available",
      price: 150,
      image: `${SPRITE_PATHS.items}evolution_stone.png`,
      quantity: "unlimited",
    },
    {
      id: "shiny_charm",
      name: "Shiny Charm",
      description: "Permanently increase shiny odds by 0.5%",
      price: 500,
      image: `${SPRITE_PATHS.items}shiny_charm.png`,
      quantity: "limited",
    },
    {
      id: "lucky_egg",
      name: "Lucky Egg",
      description: "Double TP gain for 24 hours",
      price: 300,
      image: `${SPRITE_PATHS.items}lucky_egg.png`,
      quantity: "unlimited",
    },
    {
      id: "rare_candy",
      name: "Rare Candy",
      description: "Get 5 random Pokémon instantly",
      price: 250,
      image: `${SPRITE_PATHS.items}rare_candy.png`,
      quantity: "unlimited",
    },
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
    evoCost.textContent = "🪨 1";
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

// ===========================================================
// 🔁 UPDATED: evolvePokemon()
// ===========================================================
async function evolvePokemon(pkmn) {
  if (!pkmn.evolution) {
    showPopup("❌ Cannot Evolve", "This Pokémon has no evolution!", "#ef4444");
    return;
  }

  const hasStone =
    (userData.items?.evolution_stone ?? userData.items?.evolutionStone ?? 0) > 0;
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
        shiny: shinyMode,
      }),
    });

    if (res.status === 403) {
      showPopup("⏰ Session Expired", "Your session has expired. Please reopen /dashboard from Discord.", "#ef4444");
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success) {
      // Update local stones safely
      const stones =
        data.stones ??
        userData.items?.evolution_stone ??
        userData.items?.evolutionStone ??
        0;
      userData.items.evolution_stone = stones;

      // Refresh user Pokémon data before re-rendering
      await loadUserData();

      // Animate stats
      animateStat("stoneCount", stones);

      // Show evolution popup (safe reset)
      showEvolutionPopup(data.evolved, shinyMode);

      // Refresh Pokémon grid AFTER data is reloaded
      await renderPokemon(document.getElementById("pokemonSearch").value);
    } else {
      throw new Error(data.error || "Evolution failed");
    }
  } catch (err) {
    console.error("❌ evolvePokemon failed:", err);
    showPopup("❌ Evolution Failed", err.message, "#ef4444");
  }
}

// ===========================================================
// 🔁 UPDATED: donatePokemon()
// ===========================================================
async function donatePokemon(pkmn) {
  const userPokemon = userData.pokemon[pkmn.id];
  const count = shinyMode ? userPokemon?.shiny || 0 : userPokemon?.normal || 0;

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
      // Update local CC
      userData.cc = data.totalCC ?? userData.cc ?? 0;

      // Refresh Pokémon data before re-rendering
      await loadUserData();

      // Animate CC stat
      animateStat("ccCount", userData.cc, "--gold");

      // Show donation popup (safe reset)
      showDonationPopup(pkmn, data.gainedCC, shinyMode);

      // Refresh grid AFTER data reload
      await renderPokemon(document.getElementById("pokemonSearch").value);
    } else {
      throw new Error(data.error || "Donation failed");
    }
  } catch (err) {
    console.error("❌ donatePokemon failed:", err);
    showPopup("❌ Donation Failed", err.message, "#ef4444");
  }
}

// ===========================================================
// 🔁 UPDATED: loadUserData()
// ===========================================================
async function loadUserData() {
  try {
    const userRes = await fetch(`${API_ENDPOINTS.userPokemon}?id=${userId}&token=${token}`);

    if (userRes.status === 403) {
      showPopup("⏰ Session Expired", "Your session has expired. Please reopen /dashboard from Discord.", "#ef4444");
      return;
    }

    if (!userRes.ok) throw new Error(`HTTP ${userRes.status}`);
    const freshData = await userRes.json();

    // Safely merge into userData
    userData.pokemon = freshData.pokemon || {};
    userData.items = freshData.items || {};
    userData.cc = freshData.cc ?? userData.cc ?? 0;
    userData.tp = freshData.tp ?? userData.tp ?? 0;
    userData.rank = freshData.rank || userData.rank || "Novice Trainer";

    updateStatsBar();
  } catch (err) {
    console.error("❌ loadUserData failed:", err);
  }
}

function calculateDonationValue(rarity, isShiny = false) {
  const values = {
    common: 100,
    uncommon: 350,
    rare: 1000,
    epic: 3000,
    legendary: 5000,
    mythic: 7000,
  };

  let value = values[rarity] || 10;

  // 🟡 Give 5x bonus for shiny Pokémon
  if (isShiny) value *= 5;

  return value;
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

function renderTrainers(searchFilter = "") {
  const grid = document.getElementById("trainerGrid");
  grid.innerHTML = "";

  const ownedTrainers = userData.ownedTrainers || [];

  Object.entries(allTrainers).forEach(([name, info]) => {
    const rarity = (info.tier || "common").toLowerCase();

    // 🔍 Apply filters
    if (trainerRarityFilter !== "all" && rarity !== trainerRarityFilter) return;
    if (searchFilter && !name.toLowerCase().includes(searchFilter.toLowerCase())) return;

    // 🧩 Normalize sprite entries (handles both strings + objects)
    const spriteFiles = Array.isArray(info.sprites)
      ? info.sprites
      : Array.isArray(info.files)
      ? info.files
      : [];

    spriteFiles.forEach((entry) => {
      // Entry may be string or object
      const fileName = typeof entry === "string" ? entry : entry.file;
      const disabled = typeof entry === "object" && entry.disabled;

      // Skip invalid or disabled sprites
      if (!fileName || disabled) return;

      // ✅ Check ownership
      const owned = ownedTrainers.some((t) => {
        const baseT = t.split("/").pop().toLowerCase();
        return baseT === fileName.toLowerCase();
      });

      // 🧭 Apply view filters
      if (trainerShowOwnedOnly && !owned) return;
      if (trainerShowUnownedOnly && owned) return;

      // 🎴 Create and append trainer card
      const card = createTrainerCard(name, fileName, rarity, owned);
      grid.appendChild(card);
    });
  });

  // 🪶 Handle empty grid
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
  card.innerHTML += `
    <p class="trainer-name">${name}</p>
    <div class="trainer-tier">
      <span class="tier-emoji">${emoji}</span>
      <span class="tier-text ${rarity}">${tierDisplay}</span>
    </div>
  `;

  if (owned) {
    card.onclick = () => selectTrainer(name, fileName);
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
// 🛒 SHOP TAB
// ===========================================================

function renderShop() {
  const grid = document.getElementById("shopGrid");
  grid.innerHTML = "";

  shopItems.forEach((item) => {
    const card = createShopCard(item);
    grid.appendChild(card);
  });

  if (grid.children.length === 0) {
    grid.innerHTML = "<p class='notice'>Shop items are loading...</p>";
  }
}

function createShopCard(item) {
  const card = document.createElement("div");
  card.className = "shop-item";

  const canAfford = (userData.cc || 0) >= item.price;

  card.innerHTML = `
    <img src="${item.image}" alt="${item.name}" class="shop-item-image">
    <h3 class="shop-item-name">${item.name}</h3>
    <p class="shop-item-description">${item.description}</p>
    <p class="shop-item-price">💰 ${item.price} CC</p>
    <button class="shop-buy-btn" ${!canAfford ? "disabled" : ""}>
      ${canAfford ? "Purchase" : "Not Enough CC"}
    </button>
  `;

  const btn = card.querySelector(".shop-buy-btn");
  if (canAfford) {
    btn.onclick = () => showPurchaseConfirmation(item);
  }

  return card;
}

function showPurchaseConfirmation(item) {
  const overlay = document.getElementById("shopPopupOverlay");
  const popup = document.getElementById("shopPopup");
  
  document.getElementById("shopPopupTitle").textContent = "Confirm Purchase";
  document.getElementById("shopPopupImage").src = item.image;
  document.getElementById("shopPopupMessage").textContent = 
    `Purchase ${item.name} for ${item.price} CC?`;
  
  overlay.style.display = "flex";

  // Confirm button
  const confirmBtn = document.getElementById("confirmPurchaseBtn");
  confirmBtn.onclick = async () => {
    await purchaseItem(item);
    overlay.style.display = "none";
  };

  // Cancel button
  const cancelBtn = document.getElementById("cancelPurchaseBtn");
  cancelBtn.onclick = () => {
    overlay.style.display = "none";
  };
}

async function purchaseItem(item) {
  try {
    const res = await fetch(API_ENDPOINTS.purchaseItem, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, itemId: item.id }),
    });

    if (res.status === 403) {
      showPopup("⏰ Session Expired", "Your session has expired. Please reopen /dashboard from Discord.", "#ef4444");
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success) {
      // Update local data
      userData.cc = data.newCC;
      if (data.items) {
        userData.items = data.items;
      }
      
      // Update UI
      animateStat("ccCount", userData.cc, "--gold");
      if (item.id === "evolution_stone") {
        animateStat("stoneCount", userData.items.evolution_stone);
      }
      
      renderShop();
      showPopup("✅ Purchase Complete!", `You bought ${item.name}!`);
    } else {
      throw new Error(data.error || "Purchase failed");
    }
  } catch (err) {
    console.error("❌ purchaseItem failed:", err);
    showPopup("❌ Purchase Failed", err.message, "#ef4444");
  }
}

// ===========================================================
// ✨ POPUP UTILITIES — Evolution • Donation • Shop
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

// ===========================================================
// 🧬 Evolution Popup
// ===========================================================
function showEvolutionPopup(evolved, isShiny) {
  const overlay = document.getElementById("evoPopupOverlay");
  const popup = document.getElementById("evoPopup");

  if (isShiny) popup.classList.add("shiny");
  else popup.classList.remove("shiny");

  const spritePath = isShiny
    ? `${SPRITE_PATHS.shiny}${evolved.id}.gif`
    : `${SPRITE_PATHS.pokemon}${evolved.id}.gif`;

  document.getElementById("evoSprite").src = spritePath;
  document.getElementById("evoMessage").textContent =
    `Your Pokémon evolved into ${evolved.name}!`;

  overlay.style.display = "flex";
}

// ===========================================================
// 💎 Donation Popup
// ===========================================================
function showDonationPopup(pkmn, ccGained, isShiny) {
  const overlay = document.getElementById("donationPopupOverlay");
  const popup = document.getElementById("donationPopup");

  if (isShiny) popup.classList.add("shiny");
  else popup.classList.remove("shiny");

  const spritePath = isShiny
    ? `${SPRITE_PATHS.shiny}${pkmn.id}.gif`
    : `${SPRITE_PATHS.pokemon}${pkmn.id}.gif`;

  document.getElementById("donationSprite").src = spritePath;
  document.getElementById("donationMessage").textContent =
    `You donated ${pkmn.name} to the collection!`;
  document.getElementById("donationCC").textContent = `+${ccGained} CC earned!`;

  overlay.style.display = "flex";
}

// ===========================================================
// 🛒 Shop Purchase Confirmation Popup
// ===========================================================
function showPurchaseConfirmation(item) {
  const overlay = document.getElementById("shopPopupOverlay");
  document.getElementById("shopPopupTitle").textContent = "Confirm Purchase";
  document.getElementById("shopPopupImage").src = item.image;
  document.getElementById("shopPopupMessage").textContent =
    `Purchase ${item.name} for ${item.price} CC?`;

  overlay.style.display = "flex";

  const confirmBtn = document.getElementById("confirmPurchaseBtn");
  confirmBtn.onclick = async () => {
    await purchaseItem(item);
    overlay.classList.add("fadeOut");
    setTimeout(() => {
      overlay.style.display = "none";
      overlay.classList.remove("fadeOut");
    }, 300);
  };
}

// ===========================================================
// 🧩 Global Popup Close Bindings (applies to all overlays)
// ===========================================================
function bindGlobalPopups() {
  const popups = [
    { overlay: "evoPopupOverlay", button: "closeEvoPopup" },
    { overlay: "donationPopupOverlay", button: "closeDonationPopup" },
    { overlay: "shopPopupOverlay", button: "cancelPurchaseBtn" },
  ];

  popups.forEach(({ overlay, button }) => {
    const overlayEl = document.getElementById(overlay);
    const buttonEl = document.getElementById(button);
    if (!overlayEl || !buttonEl) return;

    // ✅ Button closes overlay
    buttonEl.addEventListener("click", () => {
      overlayEl.classList.add("fadeOut");
      setTimeout(() => {
        overlayEl.style.display = "none";
        overlayEl.classList.remove("fadeOut");
      }, 300);
    });

    // ✅ Clicking outside popup closes overlay
    overlayEl.addEventListener("click", (e) => {
      if (e.target === overlayEl) {
        overlayEl.classList.add("fadeOut");
        setTimeout(() => {
          overlayEl.style.display = "none";
          overlayEl.classList.remove("fadeOut");
        }, 300);
      }
    });
  });
}

// Run global binding after DOM loads
window.addEventListener("DOMContentLoaded", bindGlobalPopups);

// ===========================================================
// ❌ Error Display Helper
// ===========================================================
function showError(message) {
  document.getElementById("pokemonGrid").innerHTML =
    `<p class='error'>${message}</p>`;
}