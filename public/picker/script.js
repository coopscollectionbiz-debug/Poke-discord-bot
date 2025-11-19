// ===========================================================
// Coop's Collection — Trainer Picker (Token-Secured Version)
// ===========================================================

import { rarityEmojis } from "/public/spriteconfig.js";

const TRAINER_SPRITE_PATH = "/public/sprites/trainers_2/";
const GRAY_PATH = "/public/sprites/trainers_2/grayscale/";
const TRAINER_DATA_FILE = "/public/trainerSprites.json";

const API_USER = "/api/user-trainers";
const API_SET = "/api/set-trainer";
const API_PURCHASE = "/api/unlock-trainer";

// ===========================================================
// 💰 Tier-Based Trainer Costs (Option B final)
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
// GLOBAL STATE
// ===========================================================
let allTrainers = {};
let ownedTrainers = [];
let userId = null;
let token = null;

let showOwnedOnly = false;
let showUnownedOnly = false;
let selectedRarity = "all";

let userCC = 0;

// Lock to prevent double purchase attempts
let purchaseInProgress = false;

// ===========================================================
// PROCESSING OVERLAY
// ===========================================================
window.showProcessing = () => {
  const overlay = document.getElementById("processingOverlay");
  if (overlay) overlay.style.display = "flex";
};

window.hideProcessing = () => {
  const overlay = document.getElementById("processingOverlay");
  if (overlay) overlay.style.display = "none";
};

// ===========================================================
// INITIALIZATION
// ===========================================================
window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  userId = params.get("id");
  token = params.get("token");

  setupControls();
  initNavTabs();
  loadData();
});

// ===========================================================
// LOAD TRAINER DATA + CC + OWNERSHIP
// ===========================================================
async function loadData() {
  try {
    const grid = document.getElementById("trainerGrid");

    if (!userId || !token) {
      grid.innerHTML =
        "<p class='error'>❌ Missing user ID or token. Launch from Discord using /changetrainer.</p>";
      return;
    }

    // Load trainer definitions
    const spriteRes = await fetch(TRAINER_DATA_FILE);
    allTrainers = await spriteRes.json();

    // Load owned trainers
    const res = await fetch(`${API_USER}?id=${userId}&token=${token}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (data.owned) {
      ownedTrainers = Array.isArray(data.owned)
        ? data.owned
        : Object.keys(data.owned);
    } else {
      ownedTrainers = [];
    }

    // Load CC
    const userRes = await fetch(`/api/user?id=${userId}&token=${token}`);
    const userData = await userRes.json();
    userCC = userData.cc ?? 0;

    updateCCDisplay();

    render();

  } catch (err) {
    console.error("❌ loadData failed:", err);
    document.getElementById("trainerGrid").innerHTML =
      "<p class='error'>❌ Failed to load trainer data. Please re-open link.</p>";
  }
}

// ===========================================================
// UPDATE STICKY CC BAR
// ===========================================================
function updateCCDisplay() {
  const ccBar = document.getElementById("ccDisplayBar");
  if (!ccBar) return;

  ccBar.innerHTML = `
    <img src="/public/sprites/items/cc_coin.png" class="cc-icon" />
    ${userCC.toLocaleString()} CC
  `;
}

// ===========================================================
// RENDER TRAINER GRID
// ===========================================================
function render(filter = "") {
  const grid = document.getElementById("trainerGrid");
  grid.innerHTML = "";

  Object.entries(allTrainers).forEach(([name, info]) => {
    const rarity = (info.tier || "common").toLowerCase();
    const tierDisplay = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    const emoji = rarityEmojis?.[rarity] || "⚬";
    const price = TRAINER_COSTS[rarity] ?? 5000;

    if (selectedRarity !== "all" && rarity !== selectedRarity) return;
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;

    const spriteFiles = Array.isArray(info.sprites)
      ? info.sprites
      : Array.isArray(info.files)
      ? info.files
      : [];

    spriteFiles.forEach((fileName) => {
      if (typeof fileName !== "string") return;

      const owns = ownedTrainers.some((t) => {
        const base = t.split("/").pop().toLowerCase();
        return base === fileName.toLowerCase();
      });

      if (showOwnedOnly && !owns) return;
      if (showUnownedOnly && owns) return;

      const imgPath = owns
        ? `${TRAINER_SPRITE_PATH}${fileName}`
        : `${GRAY_PATH}${fileName}`;

      const card = document.createElement("div");
      card.className = `trainer-card ${owns ? "owned" : "unowned"}`;

      const wrapper = document.createElement("div");
      wrapper.className = "sprite-wrapper";

      const img = document.createElement("img");
      img.src = imgPath;
      img.alt = name;
      img.loading = "lazy";
      img.onerror = () => card.remove();
      wrapper.appendChild(img);

      if (!owns) {
        const lock = document.createElement("div");
        lock.className = "lock-overlay";
        lock.innerHTML = `<img src="/public/sprites/items/cc_coin.png" class="cc-icon-small"/> ${price.toLocaleString()}`;
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

      if (owns) {
        card.onclick = () => askToEquipTrainer(name, fileName);
      } else {
        card.onclick = () =>
          askToBuyTrainer(name, fileName, rarity, price);
      }

      grid.appendChild(card);
    });
  });

  if (!grid.children.length) {
    grid.innerHTML =
      "<p class='notice'>No trainers match your filters.</p>";
  }
}

// ===========================================================
// FILTER CONTROLS
// ===========================================================
function setupControls() {
  document.getElementById("search").addEventListener("input", (e) =>
    render(e.target.value)
  );

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

  document.getElementById("rarityFilter").addEventListener("change", (e) => {
    selectedRarity = e.target.value;
    render(document.getElementById("search").value);
  });
}

// ===========================================================
// EQUIP TRAINER
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
      });
    }
  } catch (err) {
    console.error("❌ selectTrainer failed:", err);
  }
}

// ===========================================================
// BUY TRAINER
// ===========================================================
function askToBuyTrainer(name, file, rarity, price) {
  const canAfford = userCC >= price;
  const delta = price - userCC;

  createTrainerModal({
    title: "Unlock Trainer?",
    sprite: `${TRAINER_SPRITE_PATH}${file}`,
    price,
    message: canAfford
      ? `Purchase <strong>${name}</strong>?`
      : `This trainer costs <strong>${price.toLocaleString()} CC</strong>.<br>You need <strong>${delta.toLocaleString()} CC</strong> more.`,
    confirmText: canAfford ? "Buy" : `Need ${delta.toLocaleString()} CC`,
    confirmDisabled: !canAfford,
    onConfirm: () => purchaseTrainer(file, price)
  });
}




// ===========================================================
// PURCHASE API — SAFE, WITH REFRESH PROTECTION
// ===========================================================
async function purchaseTrainer(file, price) {
  if (purchaseInProgress) return;
  purchaseInProgress = true;

  showProcessing();

  try {
    const res = await fetch(API_PURCHASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, file }),
    });

    const data = await res.json();

    if (!data.success) {
      hideProcessing();
      purchaseInProgress = false;
      return createTrainerModal({
        title: "Purchase Failed",
        message: data.error || "Could not purchase trainer.",
        sprite: `${TRAINER_SPRITE_PATH}${file}`,
      });
    }

    // Update CC + owned list
    userCC -= price;
    ownedTrainers.push(file);

    updateCCDisplay();
    render();

    hideProcessing();
    purchaseInProgress = false;

    createTrainerModal({
      title: "Trainer Unlocked!",
      message: "You can now equip this trainer.",
      sprite: `${TRAINER_SPRITE_PATH}${file}`,
      confirmText: "OK",
    });

  } catch (err) {
    console.error("❌ purchaseTrainer failed:", err);
    hideProcessing();
    purchaseInProgress = false;
  }
}

// ===========================================================
// MODAL BUILDER (Clean version, no markdown **)
// ===========================================================
function createTrainerModal({
  title,
  message,
  sprite,
  price = null,
  onConfirm,
  confirmText = "Confirm",
  confirmDisabled = false,
}) {
  const overlay = document.createElement("div");
  overlay.id = "trainerModalOverlay";

  const modal = document.createElement("div");
  modal.id = "trainerModal";

  modal.innerHTML = `
    <h2 class="modal-title">${title}</h2>

    <img src="${sprite}" class="modal-sprite" alt="trainer" />

    ${
      price !== null
        ? `
          <div class="modal-price-row">
            <img src="/public/sprites/items/cc_coin.png" class="cc-icon-small" />
            <span>${price.toLocaleString()} CC</span>
          </div>
        `
        : ""
    }

    <p class="modal-message">${message}</p>

    <div class="modal-buttons">
      <button class="modal-btn cancel">Cancel</button>
      <button class="modal-btn confirm" ${confirmDisabled ? "disabled" : ""}>
        ${confirmText}
      </button>
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

// ===========================================================
// NAVIGATION TABS
// ===========================================================
function initNavTabs() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const tok = params.get("token");

  if (!id || !tok) return;

  const goPokemon = document.getElementById("goPokemon");
  const goTrainers = document.getElementById("goTrainers");
  const goShop = document.getElementById("goShop");

  if (goPokemon)
    goPokemon.onclick = () =>
      (window.location.href = `/public/picker-pokemon/?id=${id}&token=${tok}`);

  if (goTrainers)
    goTrainers.onclick = () =>
      (window.location.href = `/public/picker/?id=${id}&token=${tok}`);

  if (goShop)
    goShop.onclick = () =>
      (window.location.href = `/public/picker-shop/?id=${id}&token=${tok}`);
}
