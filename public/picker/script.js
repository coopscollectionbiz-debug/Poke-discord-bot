// ===========================================================
// Coop's Collection — Trainer Picker (Token-Secured Version)
// ===========================================================
// Features:
// • Reads id + token from URL (?id=...&token=...)
// • Owned trainers shown in color, unowned in grayscale
// • Filters: search, rarity, owned/unowned toggles
// • Securely communicates with /api endpoints
// ===========================================================

// ===========================================================
// ✅ Correct public paths
// ===========================================================

import { rarityEmojis } from "/public/spriteconfig.js";

const TRAINER_SPRITE_PATH = "/public/sprites/trainers_2/";
const GRAY_PATH            = "/public/sprites/trainers_2/grayscale/";
const TRAINER_DATA_FILE    = "/public/trainerSprites.json";

// API stays same-origin
const API_USER = "/api/user-trainers";
const API_SET  = "/api/set-trainer";


let allTrainers = {};
let ownedTrainers = [];
let userId = null;
let token = null;
let showOwnedOnly = false;
let showUnownedOnly = false;
let selectedRarity = "all";

// ===========================================================
// 🧭 INITIALIZATION
// ===========================================================
window.addEventListener("DOMContentLoaded", () => {
  setupControls();
  loadData();
});

async function loadData() {
  try {
    // Parse URL params
    const urlParams = new URLSearchParams(window.location.search);
    userId = urlParams.get("id");
    token = urlParams.get("token");

    if (!userId || !token) {
      document.getElementById("trainerGrid").innerHTML =
        "<p class='error'>❌ Missing user ID or token. Launch from Discord using /changetrainer.</p>";
      return;
    }

    // Load all trainers
    const spriteRes = await fetch(TRAINER_DATA_FILE);
    allTrainers = await spriteRes.json();

    // Fetch user-owned trainers
const res = await fetch(`${API_USER}?id=${userId}&token=${token}`);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const data = await res.json();

// 🔧 Normalize trainer data
if (data.owned) {
  if (Array.isArray(data.owned)) {
    ownedTrainers = data.owned;
  } else if (typeof data.owned === "object") {
    ownedTrainers = Object.keys(data.owned); // convert { "lyra.png": 1, "buck.png": 1 } → ["lyra.png", "buck.png"]
  } else {
    ownedTrainers = [];
  }
} else {
  ownedTrainers = [];
}

    render();
  } catch (err) {
    console.error("❌ loadData failed:", err);
    document.getElementById("trainerGrid").innerHTML =
      "<p class='error'>❌ Failed to load trainer data. Please re-open link.</p>";
  }
}

// ===========================================================
// 🎨 RENDER GRID (updated for "sprites" support + missing sprite fix)
// ===========================================================

function render(filter = "") {
  const grid = document.getElementById("trainerGrid");
  grid.innerHTML = "";

  const entries = Object.entries(allTrainers);

  entries.forEach(([name, info]) => {
    const rarity = (info.tier || "common").toLowerCase();
    const tierDisplay = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    const emoji = rarityEmojis?.[rarity] || "⚬";

    if (selectedRarity !== "all" && rarity !== selectedRarity) return;
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;

    const spriteFiles = Array.isArray(info.sprites)
      ? info.sprites
      : Array.isArray(info.files)
      ? info.files
      : [];

    spriteFiles.forEach((fileName) => {
      if (typeof fileName !== "string") return;

      const owned = ownedTrainers.some((t) => {
  const baseT = t.split("/").pop().toLowerCase();
  return baseT === fileName.toLowerCase();
});


      // ✅ Ownership filtering
      if (showOwnedOnly && !owned) return;
      if (showUnownedOnly && owned) return;

      const imgPath = owned
        ? `${TRAINER_SPRITE_PATH}${fileName}`
        : `${GRAY_PATH}${fileName}`;

      const card = document.createElement("div");
      card.className = `trainer-card ${owned ? "owned" : "unowned"}`;

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
          <span class="tier-text ${rarity}">${tierDisplay}</span>
          <span class="tier-emoji">${emoji}</span>
        </div>
      `;

      if (owned) card.onclick = () => selectTrainer(name, fileName);
      grid.appendChild(card);
    });
  });

  if (grid.children.length === 0) {
    grid.innerHTML = "<p class='notice'>No trainers match your filters.</p>";
  }
}


// ===========================================================
// 🧰 FILTER & TOGGLE CONTROLS
// ===========================================================
function setupControls() {
  // 🔍 Search bar
  document
    .getElementById("search")
    .addEventListener("input", (e) => render(e.target.value));

  // ✅ "Show Owned Only" button
  document.getElementById("ownedToggle").addEventListener("click", (e) => {
    showOwnedOnly = !showOwnedOnly;
    showUnownedOnly = false;
    e.target.classList.toggle("active", showOwnedOnly);
    document.getElementById("unownedToggle").classList.remove("active");
    render(document.getElementById("search").value);
  });

  // 🚫 "Show Unowned Only" button
  document.getElementById("unownedToggle").addEventListener("click", (e) => {
    showUnownedOnly = !showUnownedOnly;
    showOwnedOnly = false;
    e.target.classList.toggle("active", showUnownedOnly);
    document.getElementById("ownedToggle").classList.remove("active");
    render(document.getElementById("search").value);
  });

  // 🌟 Rarity dropdown
  document
    .getElementById("rarityFilter")
    .addEventListener("change", (e) => {
      selectedRarity = e.target.value;
      render(document.getElementById("search").value);
    });
}

// ===========================================================
// 🖱️ SELECT TRAINER
// ===========================================================
async function selectTrainer(name, file) {
  if (!confirm(`Select ${name}?`)) return;

  try {
    const res = await fetch(API_SET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, name, file }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success) {
      alert(`✅ ${name} equipped as your displayed Trainer!`);
    } else {
      throw new Error("Response not successful");
    }
  } catch (err) {
    console.error("❌ selectTrainer failed:", err);
    alert("❌ Failed to update trainer. Please reopen the picker via /changetrainer.");
  }
}
