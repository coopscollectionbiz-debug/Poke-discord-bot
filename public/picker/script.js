// ===========================================================
// Coop's Collection — Trainer Picker (Token-Secured Version)
// ===========================================================

import { rarityEmojis } from "/public/spriteconfig.js";

const TRAINER_SPRITE_PATH = "/public/sprites/trainers_2/";
const GRAY_PATH = "/public/sprites/trainers_2/grayscale/";
const TRAINER_DATA_FILE = "/public/trainerSprites.json";

const API_USER = "/api/user-trainers";
const API_SET = "/api/set-trainer";

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
  setupReturnButton();
  setupControls();
  loadData();
});

// ===========================================================
// 🔙 RETURN BUTTON
// ===========================================================
function setupReturnButton() {
  const btn = document.getElementById("returnBtn");
  btn.addEventListener("click", () => {
    // Redirect back to unified dashboard
    window.location.href = "/public/picker-pokemon/index.html";
  });
}

// ===========================================================
// 📦 LOAD DATA
// ===========================================================
async function loadData() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    userId = urlParams.get("id");
    token = urlParams.get("token");

    if (!userId || !token) {
      document.getElementById("trainerGrid").innerHTML =
        "<p class='error'>❌ Missing user ID or token. Launch from Discord using /changetrainer.</p>";
      return;
    }

    const spriteRes = await fetch(TRAINER_DATA_FILE);
    allTrainers = await spriteRes.json();

    const res = await fetch(`${API_USER}?id=${userId}&token=${token}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // 🔧 Normalize trainer data
    if (data.owned) {
      if (Array.isArray(data.owned)) {
        ownedTrainers = data.owned;
      } else if (typeof data.owned === "object") {
        ownedTrainers = Object.keys(data.owned);
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
// 🎨 RENDER GRID
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
  document
    .getElementById("search")
    .addEventListener("input", (e) => render(e.target.value));

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
  try {
    const res = await fetch(API_SET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, name, file }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success) {
      showPopup("✅ Trainer Equipped!", `${name} is now your displayed Trainer!`);
    } else {
      showPopup("❌ Error", "Failed to equip trainer. Please try again.", "#ef4444");
    }
  } catch (err) {
    console.error("❌ selectTrainer failed:", err);
    showPopup("❌ Error", "Could not connect to the server.", "#ef4444");
  }
}

// ===========================================================
// ✨ POPUP CONFIRMATION UTILITY
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
      font-family: 'Poppins', sans-serif;
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
