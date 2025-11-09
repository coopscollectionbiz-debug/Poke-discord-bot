// ===========================================================
// Coop's Collection — Pokémon Picker (Token-Secured Version)
// ===========================================================
// Reads id + token from URL (?id=...&token=...)
// Displays owned/unowned Pokémon with filters and rarity tags
// ===========================================================

import { rarityEmojis } from "/public/spriteconfig.js";

const POKEMON_SPRITE_PATH = "/public/sprites/pokemon/";
const SHINY_PATH = "/public/sprites/shiny/";
const POKEMON_DATA_FILE = "/public/pokemonData.json";

const API_USER = "/api/user-pokemon";
const API_SET  = "/api/set-pokemon";

let allPokemon = {};
let ownedPokemon = [];
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
    ownedPokemon = data.owned || [];

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
    const emoji = rarityEmojis?.[rarity] || "⚬";
    const tierDisplay = rarity.charAt(0).toUpperCase() + rarity.slice(1);

    if (selectedRarity !== "all" && rarity !== selectedRarity) return;
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;

    const owned = ownedPokemon.includes(name);
    if (showOwnedOnly && !owned) return;
    if (showUnownedOnly && owned) return;

    const spriteFile = showShinyOnly
      ? `${SHINY_PATH}${info.id}.gif`
      : `${POKEMON_SPRITE_PATH}${info.id}.gif`;

    const imgPath = owned ? spriteFile : `${POKEMON_SPRITE_PATH}${info.id}.gif`;

    const card = document.createElement("div");
    card.className = `pokemon-card ${owned ? "owned" : "unowned"}`;
    card.innerHTML = `
      <div class="sprite-wrapper">
        <img src="${imgPath}" alt="${name}" loading="lazy" />
        ${!owned ? '<div class="lock-overlay"><span>🔒</span></div>' : ""}
      </div>
      <p class="pokemon-name">${name}</p>
      <div class="pokemon-tier">
        <span class="tier-text ${rarity}">${tierDisplay}</span>
        <span class="tier-emoji">${emoji}</span>
      </div>
    `;

    if (owned) card.onclick = () => selectPokemon(name, info.id);
    grid.appendChild(card);
  });

  if (grid.children.length === 0) {
    grid.innerHTML = "<p class='notice'>No Pokémon match your filters.</p>";
  }
}

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
    showOwnedOnly = false;
    e.target.classList.toggle("active", showUnownedOnly);
    document.getElementById("ownedToggle").classList.remove("active");
    render(document.getElementById("search").value);
  });

  document.getElementById("shinyToggle").addEventListener("click", (e) => {
    showShinyOnly = !showShinyOnly;
    e.target.classList.toggle("active", showShinyOnly);
    render(document.getElementById("search").value);
  });

  document.getElementById("rarityFilter").addEventListener("change", (e) => {
    selectedRarity = e.target.value;
    render(document.getElementById("search").value);
  });
}

// ===========================================================
// 🖱️ Select Pokémon
// ===========================================================
async function selectPokemon(name, id) {
  if (!confirm(`Select ${name}?`)) return;

  try {
    const res = await fetch(API_SET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, name, file: id }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success) {
      alert(`✅ ${name} equipped as your displayed Pokémon!`);
    } else {
      throw new Error("Response not successful");
    }
  } catch (err) {
    console.error("❌ selectPokemon failed:", err);
    alert("❌ Failed to update Pokémon. Please reopen the picker via /changepokemon.");
  }
}
