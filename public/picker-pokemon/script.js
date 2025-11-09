// ===========================================================
// Coop's Collection — Pokémon Picker (Token-Secured Version)
// ===========================================================
// Features:
// • Reads id + token from URL (?id=...&token=...)
// • Owned Pokémon shown in color, unowned in grayscale
// • Shiny toggle + rarity filters
// • Allows selecting up to 6 Pokémon (team setup)
// • First selected = lead Pokémon on trainer card
// ===========================================================

import { rarityEmojis } from "/public/spriteconfig.js";

const POKEMON_SPRITE_PATH = "/public/sprites/pokemon/normal/";
const SHINY_PATH          = "/public/sprites/pokemon/shiny/";
const GRAY_PATH           = "/public/sprites/pokemon/gray/";
const POKEMON_DATA_FILE   = "/public/pokemonData.json";

const API_USER = "/api/user-pokemon";
const API_SET  = "/api/set-pokemon-team";

let allPokemon = {};
let ownedPokemon = [];
let userId = null;
let token = null;

let showOwnedOnly = false;
let showUnownedOnly = false;
let showShinyOnly = false;
let selectedRarity = "all";
let selectedTeam = [];

// ===========================================================
// 🧭 Initialization
// ===========================================================
window.addEventListener("DOMContentLoaded", () => {
  setupControls();
  loadData();
});

// ===========================================================
// 📦 Load Pokémon + Ownership
// ===========================================================
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

    if (data.owned) {
      if (Array.isArray(data.owned)) {
        ownedPokemon = data.owned;
      } else if (typeof data.owned === "object") {
        ownedPokemon = Object.keys(data.owned);
      }
    }

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
    const tierDisplay = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    const emoji = rarityEmojis?.[rarity] || "⚬";

    if (selectedRarity !== "all" && rarity !== selectedRarity) return;
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;

    const owned = ownedPokemon.includes(name);
    if (showOwnedOnly && !owned) return;
    if (showUnownedOnly && owned) return;

    const spriteFile = `${info.id}.gif`;
    const basePath = showShinyOnly
      ? SHINY_PATH
      : POKEMON_SPRITE_PATH;

    const imgPath = owned
      ? `${basePath}${spriteFile}`
      : `${GRAY_PATH}${spriteFile}`;

    const card = document.createElement("div");
    card.className = `pokemon-card ${owned ? "owned" : "unowned"}`;

    const spriteWrapper = document.createElement("div");
    spriteWrapper.className = "sprite-wrapper";

    const img = document.createElement("img");
    img.src = imgPath;
    img.alt = name;
    img.loading = "lazy";
    img.onerror = () => {
      console.warn(`⚠️ Missing sprite: ${spriteFile}`);
      card.remove();
    };
    spriteWrapper.appendChild(img);

    if (!owned) {
      const lock = document.createElement("div");
      lock.className = "lock-overlay";
      lock.innerHTML = "<span>🔒</span>";
      spriteWrapper.appendChild(lock);
    }

    // ✅ Selection highlight
    if (selectedTeam.includes(name)) {
      const sel = document.createElement("div");
      sel.className = "selected-overlay";
      sel.innerHTML = `<span>${selectedTeam.indexOf(name) + 1}</span>`;
      spriteWrapper.appendChild(sel);
      card.classList.add("selected");
    }

    card.appendChild(spriteWrapper);
    card.innerHTML += `
      <p class="pokemon-name">${name}</p>
      <div class="pokemon-tier">
        <span class="tier-text ${rarity}">${tierDisplay}</span>
        <span class="tier-emoji">${emoji}</span>
      </div>
    `;

    if (owned) card.onclick = () => toggleSelect(name);
    grid.appendChild(card);
  });

  if (grid.children.length === 0) {
    grid.innerHTML = "<p class='notice'>No Pokémon match your filters.</p>";
  }

  updateTeamUI();
}

// ===========================================================
// 🧩 Toggle Pokémon Selection
// ===========================================================
function toggleSelect(name) {
  const idx = selectedTeam.indexOf(name);
  if (idx !== -1) {
    selectedTeam.splice(idx, 1);
  } else {
    if (selectedTeam.length >= 6) {
      alert("You can only select 6 Pokémon!");
      return;
    }
    selectedTeam.push(name);
  }
  render(document.getElementById("search").value);
}

// ===========================================================
// 💾 Save Team Button
// ===========================================================
async function saveTeam() {
  if (selectedTeam.length === 0) {
    alert("Please select at least one Pokémon to save your team!");
    return;
  }

  try {
    const res = await fetch(API_SET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, team: selectedTeam }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success) {
      alert(`✅ Team saved successfully! Your lead Pokémon is ${selectedTeam[0]}.`);
    } else {
      throw new Error("Response not successful");
    }
  } catch (err) {
    console.error("❌ saveTeam failed:", err);
    alert("❌ Failed to save team. Please reopen via /changepokemon.");
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

  document.getElementById("saveTeam").addEventListener("click", saveTeam);
}

// ===========================================================
// 🧱 Update Team Preview / Save Button
// ===========================================================
function updateTeamUI() {
  const teamCount = selectedTeam.length;
  const saveBtn = document.getElementById("saveTeam");
  const counter = document.getElementById("teamCounter");

  if (counter) counter.textContent = `${teamCount}/6 selected`;
  if (saveBtn) saveBtn.disabled = teamCount === 0;
}
