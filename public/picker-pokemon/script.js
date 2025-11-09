// ===========================================================
// Coop's Collection — Pokémon Team Picker (Token-Secured)
// ===========================================================

import { rarityEmojis } from "/public/spriteconfig.js";

const POKEMON_SPRITE_PATH = "/public/sprites/pokemon/normal/";
const SHINY_PATH = "/public/sprites/pokemon/shiny/";
const GRAY_PATH = "/public/sprites/pokemon/grayscale/";
const POKEMON_DATA_FILE = "/public/pokemonData.json";

const API_USER = "/api/user-pokemon";
const API_SET = "/api/set-pokemon-team";

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

// ===========================================================
// 📦 Data Load
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

    const res = await fetch(POKEMON_DATA_FILE);
    allPokemon = await res.json();

    const ownedRes = await fetch(`${API_USER}?id=${userId}&token=${token}`);
    if (!ownedRes.ok) throw new Error(`HTTP ${ownedRes.status}`);
    const data = await ownedRes.json();

    // ✅ Normalize owned Pokémon (support object or array)
    if (data.owned) {
      if (Array.isArray(data.owned)) {
        ownedPokemon = data.owned.map((x) => String(x).toLowerCase());
      } else if (typeof data.owned === "object") {
        ownedPokemon = Object.keys(data.owned).map((x) => String(x).toLowerCase());
      }
    }

    // ✅ Store full object for shiny tracking
    if (typeof data.owned === "object") {
      window.userOwnedData = {};
      for (const [key, value] of Object.entries(data.owned)) {
        window.userOwnedData[String(key).toLowerCase()] = value;
      }
    }

    if (Array.isArray(data.currentTeam))
      selectedTeam = data.currentTeam.map((x) => String(x).toLowerCase());

    render();
  } catch (err) {
    console.error("❌ loadData failed:", err);
    document.getElementById("pokemonGrid").innerHTML =
      "<p class='error'>❌ Failed to load Pokémon data. Please re-open link.</p>";
  }
}

// ===========================================================
// 🎨 Render Grid
// ===========================================================
function render(filter = "") {
  const grid = document.getElementById("pokemonGrid");
  grid.innerHTML = "";

  const entries = Object.entries(allPokemon);
  entries.forEach(([id, info]) => {
    const normalizedId = String(info.id || id).toLowerCase();
    const name = info.name || `#${id}`;
    const rarity = (info.tier || "common").toLowerCase();
    const tierDisplay = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    const emoji = rarityEmojis?.[rarity] || "⚬";

    // ===========================================================
    // 🧩 Ownership & Shiny Filter Logic
    // ===========================================================
    const ownedEntry = ownedPokemon.includes(normalizedId);
    let owned = ownedEntry;
    let shinyOwned = false;

    if (typeof window.userOwnedData === "object") {
      const ownedData = window.userOwnedData[normalizedId];
      shinyOwned = ownedData?.shiny > 0;
    }

    // When shiny mode is active AND owned filter is on → only show shiny owned Pokémon
    if (showShinyOnly && showOwnedOnly && !shinyOwned) return;

    // Filters
    if (selectedRarity !== "all" && rarity !== selectedRarity) return;
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;
    if (showOwnedOnly && !owned) return;
    if (showUnownedOnly && owned) return;

    // ===========================================================
    // 🖼️ Sprite Path Setup
    // ===========================================================
    const spriteFile = `${info.id}.gif`;
    const basePath = showShinyOnly ? SHINY_PATH : POKEMON_SPRITE_PATH;
    const imgPath = owned ? `${basePath}${spriteFile}` : `${GRAY_PATH}${spriteFile}`;

    // ===========================================================
    // 📦 Card Structure
    // ===========================================================
    const card = document.createElement("div");
    card.className = `pokemon-card ${owned ? "owned" : "unowned"}`;

    // Sprite wrapper
    const spriteWrapper = document.createElement("div");
    spriteWrapper.className = "sprite-wrapper";

    const img = document.createElement("img");
    img.src = imgPath;
    img.alt = name;
    img.loading = "lazy";
    img.onerror = () => {
      console.warn(`⚠️ Missing sprite for ${name} (${spriteFile})`);
      card.remove();
    };
    spriteWrapper.appendChild(img);

    // 🔒 Lock overlay for unowned
    if (!owned) {
      const lock = document.createElement("div");
      lock.className = "lock-overlay";
      lock.innerHTML = "<span>🔒</span>";
      spriteWrapper.appendChild(lock);
    }

    // 🔢 Team order badge if selected
    const indexInTeam = selectedTeam.indexOf(normalizedId);
    if (indexInTeam !== -1) {
      const badge = document.createElement("div");
      badge.className = "team-badge";
      badge.textContent = indexInTeam + 1;
      spriteWrapper.appendChild(badge);
      card.classList.add("selected");
    }

    // ===========================================================
    // 🧱 Card Text (Aligned)
    // ===========================================================
    const infoBlock = document.createElement("div");
    infoBlock.innerHTML = `
      <p class="pokemon-name">${name}</p>
      <div class="pokemon-tier">
        <span class="tier-text ${rarity}">${tierDisplay}</span>
        <span class="tier-emoji">${emoji}</span>
      </div>
    `;

    card.appendChild(spriteWrapper);
    card.appendChild(infoBlock);

    if (owned) card.onclick = () => toggleSelect(info);
    grid.appendChild(card);
  });

  if (grid.children.length === 0)
    grid.innerHTML = "<p class='notice'>No Pokémon match your filters.</p>";
}

// ===========================================================
// 🖱️ Team Selection Logic
// ===========================================================
function toggleSelect(info) {
  const idStr = String(info.id).toLowerCase();
  const alreadySelected = selectedTeam.includes(idStr);

  if (alreadySelected) {
    selectedTeam = selectedTeam.filter((p) => p !== idStr);
  } else {
    if (selectedTeam.length >= 6) {
      alert("⚠️ You can only select up to 6 Pokémon!");
      return;
    }
    selectedTeam.push(idStr);
  }

  render(document.getElementById("search").value);
  updateTeamStatus();
}

// ===========================================================
// 💾 Save Team
// ===========================================================
document.getElementById("saveTeamBtn").addEventListener("click", async () => {
  if (selectedTeam.length === 0) {
    alert("❌ You must select at least one Pokémon.");
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

    const msg = document.getElementById("teamStatus");
    if (data.success) {
      msg.textContent = "✅ Team saved successfully!";
      msg.className = "status-msg success";
    } else {
      throw new Error("Save failed");
    }
  } catch (err) {
    console.error("❌ saveTeam failed:", err);
    const msg = document.getElementById("teamStatus");
    msg.textContent = "❌ Failed to save team.";
    msg.className = "status-msg error";
  }
});

// ===========================================================
// 🧰 Filter Controls
// ===========================================================
function setupControls() {
  document.getElementById("search").addEventListener("input", (e) => {
    render(e.target.value);
  });

  document.getElementById("rarityFilter").addEventListener("change", (e) => {
    selectedRarity = e.target.value;
    render(document.getElementById("search").value);
  });

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
}

// ===========================================================
// 🧾 Status Display
// ===========================================================
function updateTeamStatus() {
  const status = document.getElementById("teamStatus");
  if (selectedTeam.length === 0) {
    status.textContent = "No Pokémon selected.";
    status.className = "status-msg";
  } else {
    const lead = allPokemon[selectedTeam[0]]?.name || "Unknown";
    status.textContent = `🧢 ${selectedTeam.length}/6 selected — Lead: ${lead}`;
    status.className = "status-msg active";
  }
}
