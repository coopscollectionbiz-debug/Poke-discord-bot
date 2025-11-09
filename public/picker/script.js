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
    ownedTrainers = data.owned || [];

    render();
  } catch (err) {
    console.error("❌ loadData failed:", err);
    document.getElementById("trainerGrid").innerHTML =
      "<p class='error'>❌ Failed to load trainer data. Please re-open link.</p>";
  }
}

// ===========================================================
// 🎨 RENDER GRID (updated for "sprites" support)
// ===========================================================
function render(filter = "") {
  const grid = document.getElementById("trainerGrid");
  grid.innerHTML = "";

  const entries = Object.entries(allTrainers);

  entries.forEach(([name, info]) => {
    const rarity = (info.tier || "common").toLowerCase();
    if (selectedRarity !== "all" && rarity !== selectedRarity) return;
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;

    const spriteFiles = info.sprites || info.files || [];
    spriteFiles.forEach((file) => {
      const owned = ownedTrainers.includes(file);

      const imgPath = owned
        ? `${TRAINER_SPRITE_PATH}${file}`
        : `${GRAY_PATH}${file}`;

      const card = document.createElement("div");
      card.className = `trainer-card ${owned ? "owned" : "unowned"}`;
      card.innerHTML = `
        <img src="${imgPath}" alt="${name}" loading="lazy"/>
        <p>${name}</p>
        <span class="rarity ${rarity}">${rarity}</span>
      `;

      // Only clickable if the user owns that exact sprite
      if (owned) {
        card.onclick = () => selectTrainer(name, file);
      }

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
  document
    .getElementById("search")
    .addEventListener("input", (e) => render(e.target.value));

  document
    .getElementById("ownedToggle")
    .addEventListener("click", () => {
      showOwnedOnly = !showOwnedOnly;
      showUnownedOnly = false;
      render(document.getElementById("search").value);
    });

  document
    .getElementById("unownedToggle")
    .addEventListener("click", () => {
      showUnownedOnly = !showUnownedOnly;
      showOwnedOnly = false;
      render(document.getElementById("search").value);
    });

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
