// ===========================================================
// Coop's Collection — Trainer Picker (Token-Secured Version)
// ===========================================================

import { rarityEmojis } from "/public/spriteconfig.js";

const TRAINER_SPRITE_PATH = "/public/sprites/trainers_2/";
const GRAY_PATH = "/public/sprites/trainers_2/grayscale/";
const TRAINER_DATA_FILE = "/public/trainerSprites.json";

const API_USER = "/api/user-trainers";
const API_SET  = "/api/set-trainer";
const API_PURCHASE = "/api/unlock-trainer";

// ===========================================================
// 💰 Tier-Based Trainer Costs (Option A)
// ===========================================================
const TRAINER_COSTS = {
  common: 2500,
  uncommon: 7500,
  rare: 15000,
  epic: 35000,
  legendary: 75000,
  mythic: 150000,
};

// ===========================================================
// GLOBAL STATE (Unified Token)
// ===========================================================
let allTrainers = {};
let ownedTrainers = [];
let userId = null;
let token  = null;

let showOwnedOnly   = false;
let showUnownedOnly = false;
let selectedRarity  = "all";

let userCC = 0; // <-- CC from shop API

// ===========================================================
// INITIALIZATION
// ===========================================================
window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  userId = params.get("id");
  token  = params.get("token");

  setupControls();
  loadData();
  initNavTabs();
});

// ===========================================================
// LOAD TRAINER DATA
// ===========================================================
async function loadData() {
  try {
    if (!userId || !token) {
      document.getElementById("trainerGrid").innerHTML =
        "<p class='error'>❌ Missing user ID or token. Launch from Discord using /changetrainer.</p>";
      return;
    }

    // Load sprite definitions
    const spriteRes = await fetch(TRAINER_DATA_FILE);
    allTrainers = await spriteRes.json();

    // Load ownership + CC
    const res = await fetch(`${API_USER}?id=${userId}&token=${token}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    // Owned list
    if (data.owned) {
      if (Array.isArray(data.owned)) ownedTrainers = data.owned;
      else if (typeof data.owned === "object") ownedTrainers = Object.keys(data.owned);
      else ownedTrainers = [];
    } else {
      ownedTrainers = [];
    }

    // Pull CC from shop endpoint
    const shopRes = await fetch(`/api/user?preset=pokemon&id=${userId}&token=${token}`);
    if (shopRes.ok) {
      const shopData = await shopRes.json();
      userCC = shopData.cc ?? 0;
    }

    render();

  } catch (err) {
    console.error("❌ loadData failed:", err);
    document.getElementById("trainerGrid").innerHTML =
      "<p class='error'>❌ Failed to load trainer data. Please re-open link.</p>";
  }
}

// ===========================================================
// RENDER TRAINER GRID
// ===========================================================
function render(filter = "") {
  const grid = document.getElementById("trainerGrid");
  grid.innerHTML = "";

  Object.entries(allTrainers).forEach(([name, info]) => {

    const rarity      = (info.tier || "common").toLowerCase();
    const tierDisplay = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    const emoji       = rarityEmojis?.[rarity] || "⚬";
    const price       = TRAINER_COSTS[rarity] ?? 5000;

    if (selectedRarity !== "all" && rarity !== selectedRarity) return;
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;

    const spriteFiles = Array.isArray(info.sprites)
      ? info.sprites
      : (Array.isArray(info.files) ? info.files : []);

    spriteFiles.forEach((fileName) => {
      if (typeof fileName !== "string") return;

      const owned = ownedTrainers.some((t) => {
        const base = t.split("/").pop().toLowerCase();
        return base === fileName.toLowerCase();
      });

      if (showOwnedOnly && !owned) return;
      if (showUnownedOnly && owned) return;

      const imgPath = owned
        ? `${TRAINER_SPRITE_PATH}${fileName}`
        : `${GRAY_PATH}${fileName}`;

      const card = document.createElement("div");
      card.className = `trainer-card ${owned ? "owned" : "unowned"}`;

      const wrapper = document.createElement("div");
      wrapper.className = "sprite-wrapper";

      const img = document.createElement("img");
      img.src = imgPath;
      img.alt = name;
      img.loading = "lazy";
      img.onerror = () => card.remove();

      wrapper.appendChild(img);

      if (!owned) {
        const lock = document.createElement("div");
        lock.className = "lock-overlay";
        lock.innerHTML = `<span>🔒 ${price.toLocaleString()} CC</span>`;
        wrapper.appendChild(lock);
      }

      card.appendChild(wrapper);

      card.innerHTML += `
        <p class="trainer-name">${name}</p>
        <div class="trainer-tier">
          <span class="tier-text ${rarity}">${tierDisplay}</span>
          <span class="tier-emoji">${emoji}</span>
        </div>
      `;

      if (owned) {
        card.onclick = () => askToEquipTrainer(name, fileName);
      } else {
        card.onclick = () => askToBuyTrainer(name, fileName, rarity, price);
      }

      grid.appendChild(card);
    });
  });

  if (grid.children.length === 0) {
    grid.innerHTML = "<p class='notice'>No trainers match your filters.</p>";
  }
}

// ===========================================================
// FILTER CONTROLS
// ===========================================================
function setupControls() {

  document.getElementById("search")
    .addEventListener("input", (e) => render(e.target.value));

  document.getElementById("ownedToggle")
    .addEventListener("click", (e) => {
      showOwnedOnly   = !showOwnedOnly;
      showUnownedOnly = false;
      e.target.classList.toggle("active", showOwnedOnly);
      document.getElementById("unownedToggle").classList.remove("active");
      render(document.getElementById("search").value);
    });

  document.getElementById("unownedToggle")
    .addEventListener("click", (e) => {
      showUnownedOnly = !showUnownedOnly;
      showOwnedOnly   = false;
      e.target.classList.toggle("active", showUnownedOnly);
      document.getElementById("ownedToggle").classList.remove("active");
      render(document.getElementById("search").value);
    });

  document.getElementById("rarityFilter")
    .addEventListener("change", (e) => {
      selectedRarity = e.target.value;
      render(document.getElementById("search").value);
    });
}

// ===========================================================
// EQUIP TRAINER (OWNED)
// ===========================================================
function askToEquipTrainer(name, file) {
  createTrainerModal({
    title: "Equip This Trainer?",
    message: `Would you like to equip **${name}**?`,
    sprite: `${TRAINER_SPRITE_PATH}${file}`,
    confirmText: "Equip",
    onConfirm: () => selectTrainer(name, file),
  });
}

async function selectTrainer(name, file) {
  try {
    const res = await fetch(API_SET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, name, file }),
    });

    const data = await res.json();
    if (data.success) {
      createTrainerModal({
        title: "Trainer Equipped!",
        message: `${name} is now your active trainer.`,
        sprite: `${TRAINER_SPRITE_PATH}${file}`,
        confirmText: "OK",
        onConfirm: () => {},
      });
    } else {
      createTrainerModal({
        title: "Error",
        message: data.error || "Failed to equip trainer.",
        sprite: `${TRAINER_SPRITE_PATH}${file}`,
      });
    }
  } catch (err) {
    console.error("❌ selectTrainer failed:", err);
  }
}

// ===========================================================
// BUY TRAINER (UNOWNED)
// ===========================================================
function askToBuyTrainer(name, file, rarity, price) {
  const canAfford = userCC >= price;

  createTrainerModal({
    title: "Unlock Trainer?",
    message: `Buy **${name}** for **${price.toLocaleString()} CC**?`,
    sprite: `${TRAINER_SPRITE_PATH}${file}`,
    confirmText: canAfford ? "Buy" : `Need ${price - userCC} more CC`,
    confirmDisabled: !canAfford,
    onConfirm: () => purchaseTrainer(file),
  });
}

async function purchaseTrainer(file) {
  try {
    const res = await fetch(API_PURCHASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, file }),
    });

    const data = await res.json();

    if (data.success) {
      createTrainerModal({
        title: "Trainer Unlocked!",
        message: "You can now equip this trainer.",
        sprite: `${TRAINER_SPRITE_PATH}${file}`,
        confirmText: "OK",
      });

      // reload ownership + CC
      loadData();
    } else {
      createTrainerModal({
        title: "Purchase Failed",
        message: data.error || "Could not purchase trainer.",
        sprite: `${TRAINER_SPRITE_PATH}${file}`,
      });
    }
  } catch (err) {
    console.error("❌ purchaseTrainer failed:", err);
  }
}

// ===========================================================
// MODAL BUILDER
// ===========================================================
function createTrainerModal({ title, message, sprite, onConfirm, confirmText = "Confirm", confirmDisabled = false }) {
  const overlay = document.createElement("div");
  overlay.id = "trainerModalOverlay";

  const modal = document.createElement("div");
  modal.id = "trainerModal";

  modal.innerHTML = `
    <h2 class="modal-title">${title}</h2>
    <img src="${sprite}" alt="trainer"/>
    <p class="modal-message">${message}</p>

    <div class="modal-buttons">
      <button class="modal-btn cancel">Cancel</button>
      <button class="modal-btn confirm" ${confirmDisabled ? "disabled" : ""}>${confirmText}</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.querySelector(".cancel").onclick = () => overlay.remove();
  modal.querySelector(".confirm").onclick = async () => {
    if (!confirmDisabled && onConfirm) await onConfirm();
    overlay.remove();
  };

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ======================================================
// NAVIGATION TABS — ALWAYS USE CURRENT TOKEN
// ======================================================
function initNavTabs() {
  const params = new URLSearchParams(window.location.search);
  const id    = params.get("id");
  const tok   = params.get("token");

  if (!id || !tok) return;

  const goPokemon  = document.getElementById("goPokemon");
  const goTrainers = document.getElementById("goTrainers");
  const goShop     = document.getElementById("goShop");

  if (goPokemon)  goPokemon.onclick  = () =>
    (window.location.href = `/public/picker-pokemon/?id=${id}&token=${tok}`);

  if (goTrainers) goTrainers.onclick = () =>
    (window.location.href = `/public/picker/?id=${id}&token=${tok}`);

  if (goShop)     goShop.onclick     = () =>
    (window.location.href = `/public/picker-shop/?id=${id}&token=${tok}`);
}
