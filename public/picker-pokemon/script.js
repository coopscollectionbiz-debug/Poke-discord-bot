// ===========================================================
// Coop's Collection — Pokémon Team Picker
// ===========================================================
// Select up to 6 Pokémon (1st = lead) → saved to /trainercard
// ===========================================================

import { rarityEmojis } from "/public/spriteconfig.js";

const NORMAL_PATH = "/public/sprites/pokemon/normal/";
const SHINY_PATH  = "/public/sprites/pokemon/shiny/";
const GRAY_PATH   = "/public/sprites/pokemon/grayscale/";
const GRAY_SHINY  = "/public/sprites/pokemon/grayscale/";
const POKEMON_DATA_FILE = "/public/pokemonData.json";

const API_USER = "/api/user-pokemon";
const API_SAVE = "/api/set-pokemon-team";

let allPokemon = {};
let ownedPokemon = [];
let selectedTeam = [];
let userId = null;
let token = null;
let showOwnedOnly = false;
let showUnownedOnly = false;
let showShinyOnly = false;
let selectedRarity = "all";

// ===========================================================
// 🧭 Initialization
// ===========================================================
window.addEventListener("DOMContentLoaded", () => {
  setupControls();
  loadData();
});

async function loadData() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    userId = urlParams.get("id");
    token = urlParams.get("token");

    if (!userId || !token) {
      document.getElementById("pokemonGrid").innerHTML =
        "<p class='error'>❌ Missing user ID or token. Launch from Discord using /changepokemon.</p>";
      return;
    }

    const dataRes = await fetch(POKEMON_DATA_FILE);
    allPokemon = await dataRes.json();

    const res = await fetch(`${API_USER}?id=${userId}&token=${token}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    ownedPokemon = Array.isArray(data.owned)
      ? data.owned
      : typeof data.owned === "object"
      ? Object.keys(data.owned)
      : [];

    render();
  } catch (err) {
    console.error("❌ loadData failed:", err);
    document.getElementById("pokemonGrid").innerHTML =
      "<p class='error'>❌ Failed to load Pokémon data. Please re-open link.</p>";
  }
}

// ===========================================================
// 🎨 Render Pokémon Grid
// ===========================================================
function render(filter = "") {
  const grid = document.getElementById("pokemonGrid");
  grid.innerHTML = "";

  const entries = Object.entries(allPokemon);
  entries.forEach(([name, info]) => {
    const rarity = (info.rarity || "common").toLowerCase();
    if (selectedRarity !== "all" && rarity !== selectedRarity) return;
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;

    const emoji = rarityEmojis?.[rarity] || "⚬";
    const tierDisplay = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    const owned = ownedPokemon.includes(name);

    if (showOwnedOnly && !owned) return;
    if (showUnownedOnly && owned) return;

    const spritePath = showShinyOnly
      ? owned
        ? `${SHINY_PATH}${info.id}.gif`
        : `${GRAY_SHINY}${info.id}.gif`
      : owned
        ? `${NORMAL_PATH}${info.id}.gif`
        : `${GRAY_PATH}${info.id}.gif`;

    const card = document.createElement("div");
    const isSelected = selectedTeam.includes(name);
    card.className = `pokemon-card ${owned ? "owned" : "unowned"} ${isSelected ? "selected" : ""}`;

    const spriteWrapper = document.createElement("div");
    spriteWrapper.className = "sprite-wrapper";

    const img = document.createElement("img");
    img.src = spritePath;
    img.alt = name;
    img.loading = "lazy";

    spriteWrapper.appendChild(img);
    if (!owned) {
      const lock = document.createElement("div");
      lock.className = "lock-overlay";
      lock.innerHTML = "<span>🔒</span>";
      spriteWrapper.appendChild(lock);
    }

    card.appendChild(spriteWrapper);
    card.innerHTML += `
      <p class="pokemon-name">${name}</p>
      <div class="pokemon-tier">
        <span class="tier-text ${rarity}">${tierDisplay}</span>
        <span class="tier-emoji">${emoji}</span>
      </div>
    `;

    if (owned) {
      card.onclick = () => togglePokemon(name, info.id);
    }

    grid.appendChild(card);
  });

  if (grid.children.length === 0) {
    grid.innerHTML = "<p class='notice'>No Pokémon match your filters.</p>";
  }
}

// ===========================================================
// 🧩 Team Selection Logic
// ===========================================================
function togglePokemon(name, id) {
  const idx = selectedTeam.indexOf(name);
  if (idx >= 0) {
    selectedTeam.splice(idx, 1); // deselect
  } else {
    if (selectedTeam.length >= 6) {
      alert("⚠️ You can only select up to 6 Pokémon.");
      return;
    }
    selectedTeam.push(name);
  }
  render(document.getElementById("search").value);
}

// ===========================================================
// 💾 Save Team
// ===========================================================
document.getElementById("saveTeamBtn").addEventListener("click", async () => {
  if (selectedTeam.length === 0) {
    alert("❌ You must select at least one Pokémon.");
    return;
  }

  const payload = {
    id: userId,
    token,
    team: selectedTeam,
  };

  try {
    const res = await fetch(API_SAVE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.success) {
      document.getElementById("teamStatus").textContent =
        `✅ Team saved! ${selectedTeam[0]} is your lead Pokémon.`;
    } else {
      throw new Error("Failed to save");
    }
  } catch (err) {
    console.error("❌ saveTeam failed:", err);
    document.getElementById("teamStatus").textContent =
      "❌ Failed to save team. Please try again.";
  }
});

// ===========================================================
// 🧰 Filter & Toggle Controls
// ===========================================================
function setupControls() {
  document.getElementById("search").addEventListener("input", (e) => render(e.target.value));

  document.getElementById("ownedToggle").addEventListener("click", (e) => {
    showOwnedOnly = !showOwnedOnly;
    showUnownedOnly = false;
    e.target.classList.toggle("active", showOwnedOnly);
    document.getElementById("unownedToggle").classList.remove("active");
    render(document.getElementById("search").value);
  });

  document.getElementById("unownedToggle").addEventListener("click", (e) => {
    showUnownedOnly = !showUnownedOnly;
    showOwnedOnly =
