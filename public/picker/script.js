// ===========================================================
// Coop's Collection — Trainer Picker (COOKIE SESSION VERSION)
// No token in URL/body. Uses HttpOnly cookie "dashboard_session".
// ===========================================================

import { rarityEmojis } from "/public/spriteconfig.js";

const TRAINER_SPRITE_PATH = "/public/sprites/trainers_2/";
const GRAY_PATH = "/public/sprites/trainers_2/grayscale/";
const TRAINER_DATA_FILE = "/public/trainerSprites.json";

const API_USER = "/api/user-trainers";
const API_SET = "/api/set-trainer";
const API_PURCHASE = "/api/unlock-trainer";

// ===========================================================
// 💰 Tier-Based Trainer Costs
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

let showOwnedOnly = false;
let showUnownedOnly = false;
let selectedRarity = "all";

let userCC = 0;

// Lock to prevent double purchase attempts
let purchaseInProgress = false;

// Equipped trainer
window.currentEquippedTrainer = null;

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

    if (!userId) {
      grid.innerHTML =
        "<p class='error'>❌ Missing user ID. Please open the dashboard link from Discord.</p>";
      return;
    }

    // Load trainer definitions
    const spriteRes = await fetch(TRAINER_DATA_FILE, { credentials: "same-origin" });
    allTrainers = await spriteRes.json();

    // Load owned trainers + CC (+ equipped trainer) using cookie session
    const res = await fetch(`${API_USER}?id=${encodeURIComponent(userId)}`, {
      credentials: "same-origin",
    });

    if (!res.ok) {
      grid.innerHTML =
        "<p class='error'>❌ Session expired. Please re-open the dashboard link from Discord.</p>";
      return;
    }

    const data = await res.json();

    // ⭐ Capture equipped trainer from backend (supports both new + legacy keys)
    const equipped = data.equipped || data.displayedTrainer || null;
    window.currentEquippedTrainer = equipped;
    console.log("Equipped Trainer:", equipped);

    if (data.owned) {
      ownedTrainers = Array.isArray(data.owned) ? data.owned : Object.keys(data.owned);
    } else {
      ownedTrainers = [];
    }

    userCC = data.cc ?? 0;

    console.log("✅ Loaded owned trainers:", ownedTrainers);
    console.log("✅ User CC:", userCC);

    updateCCDisplay();
    render();
  } catch (err) {
    console.error("❌ loadData failed:", err);
    const grid = document.getElementById("trainerGrid");
    if (grid) {
      grid.innerHTML =
        "<p class='error'>❌ Failed to load trainer data. Please re-open link.</p>";
    }
  }
}

// ===========================================================
// UPDATE STICKY CC BAR
// ===========================================================
function updateCCDisplay() {
  const ccDisplay = document.getElementById("ccDisplay");
  if (!ccDisplay) return;

  ccDisplay.textContent = `${(userCC ?? 0).toLocaleString()} CC`;
}

// ===========================================================
// RENDER TRAINER GRID
// ===========================================================
function render(filter = "") {
  const grid = document.getElementById("trainerGrid");
  if (!grid) return;
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

      // Determine ownership by filename match ignoring extensions
      const owns = ownedTrainers.some((owned) => {
        const a = String(owned).toLowerCase().replace(".png", "").replace(".gif", "").trim();
        const b = String(fileName).toLowerCase().replace(".png", "").replace(".gif", "").trim();
        return a === b;
      });

      // Determine equipped state
      const isEquipped =
        window.currentEquippedTrainer &&
        String(window.currentEquippedTrainer)
          .toLowerCase()
          .includes(String(fileName).toLowerCase().replace(".png", "").replace(".gif", ""));

      if (showOwnedOnly && !owns) return;
      if (showUnownedOnly && owns) return;

      const imgPath = `${TRAINER_SPRITE_PATH}${fileName}`;

      const card = document.createElement("div");
      card.className = `trainer-card ${owns ? "owned" : "unowned"}`;
      if (isEquipped) card.classList.add("equipped");

      // -------------------------------------------------------
      // Sprite wrapper
      // -------------------------------------------------------
      const wrapper = document.createElement("div");
      wrapper.className = "sprite-wrapper";

      const img = document.createElement("img");
      img.src = imgPath;
      img.alt = name;
      img.loading = "lazy";
      img.onerror = () => card.remove();

      wrapper.appendChild(img);

      // Lock icon overlay for unowned trainers
      if (!owns) {
        const lock = document.createElement("div");
        lock.className = "lock-overlay";
        lock.innerHTML = `🔒`;
        wrapper.appendChild(lock);
      }

      card.appendChild(wrapper);

      // -------------------------------------------------------
      // Name
      // -------------------------------------------------------
      const nameEl = document.createElement("p");
      nameEl.className = "trainer-name";
      nameEl.textContent = name;
      card.appendChild(nameEl);

      // -------------------------------------------------------
      // Tier
      // -------------------------------------------------------
      const tierEl = document.createElement("div");
      tierEl.className = "trainer-tier";
      tierEl.innerHTML = `
        <span class="tier-text ${rarity}">${tierDisplay}</span>
        <span class="tier-emoji">${emoji}</span>
      `;
      card.appendChild(tierEl);

      // -------------------------------------------------------
      // Price (only for unowned trainers)
      // -------------------------------------------------------
      if (!owns) {
        const priceEl = document.createElement("div");
        priceEl.className = "trainer-price";
        priceEl.innerHTML = `
          <img src="/public/sprites/items/cc_coin.png" class="cc-icon-small" />
          <span>${price.toLocaleString()}</span>
        `;
        card.appendChild(priceEl);
      }

      // -------------------------------------------------------
      // Click actions
      // -------------------------------------------------------
      card.onclick = owns
        ? () => askToEquipTrainer(name, fileName)
        : () => askToBuyTrainer(name, fileName, rarity, price);

      grid.appendChild(card);
    });
  });

  if (!grid.children.length) {
    grid.innerHTML = "<p class='notice'>No trainers match your filters.</p>";
  }
}

// ===========================================================
// FILTER CONTROLS
// ===========================================================
function setupControls() {
  const search = document.getElementById("search");
  if (search) {
    search.addEventListener("input", (e) => render(e.target.value));
  }

  const ownedToggle = document.getElementById("ownedToggle");
  const unownedToggle = document.getElementById("unownedToggle");
  const rarityFilter = document.getElementById("rarityFilter");

  if (ownedToggle) {
    ownedToggle.addEventListener("click", (e) => {
      showOwnedOnly = !showOwnedOnly;
      showUnownedOnly = false;
      e.target.classList.toggle("active", showOwnedOnly);
      if (unownedToggle) unownedToggle.classList.remove("active");
      render(search?.value || "");
    });
  }

  if (unownedToggle) {
    unownedToggle.addEventListener("click", (e) => {
      showUnownedOnly = !showUnownedOnly;
      showOwnedOnly = false;
      e.target.classList.toggle("active", showUnownedOnly);
      if (ownedToggle) ownedToggle.classList.remove("active");
      render(search?.value || "");
    });
  }

  if (rarityFilter) {
    rarityFilter.addEventListener("change", (e) => {
      selectedRarity = e.target.value;
      render(search?.value || "");
    });
  }
}

// ===========================================================
// EQUIP TRAINER
// ===========================================================
function askToEquipTrainer(name, file) {
  createTrainerModal({
    title: "Equip This Trainer?",
    message: `Would you like to equip <strong>${name}</strong>?`,
    sprite: `${TRAINER_SPRITE_PATH}${file}`,
    confirmText: "Equip",
    onConfirm: () => selectTrainer(name, file),
  });
}

async function selectTrainer(name, file) {
  try {
    const res = await fetch(API_SET, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, name, file }),
    });

    const data = await res.json();

    if (!data.success) {
      return createTrainerModal({
        title: "Equip Failed",
        message: data.error || "Could not equip trainer.",
        sprite: `${TRAINER_SPRITE_PATH}${file}`,
        confirmText: "OK",
      });
    }

    // Update equipped trainer in memory
    window.currentEquippedTrainer = file;

    // Re-render grid to highlight newly equipped card
    render(document.getElementById("search")?.value || "");

    createTrainerModal({
      title: "Trainer Equipped!",
      message: `${name} is now your active trainer.`,
      sprite: `${TRAINER_SPRITE_PATH}${file}`,
      confirmText: "OK",
    });
  } catch (err) {
    console.error("❌ selectTrainer failed:", err);
    createTrainerModal({
      title: "Equip Failed",
      message: "Network error. Please try again.",
      sprite: `${TRAINER_SPRITE_PATH}${file}`,
      confirmText: "OK",
    });
  }
}

// ===========================================================
// BUY TRAINER
// ===========================================================
function askToBuyTrainer(name, file, rarity, price) {
  const canAfford = (userCC ?? 0) >= price;
  const delta = price - (userCC ?? 0);

  createTrainerModal({
    title: "Unlock Trainer?",
    sprite: `${TRAINER_SPRITE_PATH}${file}`,
    price,
    message: canAfford
      ? `Purchase <strong>${name}</strong>?`
      : `This trainer costs <strong>${price.toLocaleString()} CC</strong>.<br>You need <strong>${delta.toLocaleString()} CC</strong> more.`,
    confirmText: canAfford ? "Buy" : `Need ${delta.toLocaleString()} CC`,
    confirmDisabled: !canAfford,
    onConfirm: () => purchaseTrainer(file),
  });
}

// ===========================================================
// PURCHASE API — SAFE, WITH REFRESH PROTECTION
// ===========================================================
async function purchaseTrainer(file) {
  if (purchaseInProgress) return;
  purchaseInProgress = true;

  showProcessing();

  try {
    const res = await fetch(API_PURCHASE, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, file }),
    });

    const data = await res.json();

    if (!data.success) {
      hideProcessing();
      purchaseInProgress = false;
      return createTrainerModal({
        title: "Purchase Failed",
        message: data.error || "Could not purchase trainer.",
        sprite: `${TRAINER_SPRITE_PATH}${file}`,
        confirmText: "OK",
      });
    }

    // Server-authoritative updates
    if (typeof data.cc === "number") userCC = data.cc;
    ownedTrainers.push(data.file || file);

    updateCCDisplay();
    render(document.getElementById("search")?.value || "");

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
    createTrainerModal({
      title: "Purchase Failed",
      message: "Network error. Please try again.",
      sprite: `${TRAINER_SPRITE_PATH}${file}`,
      confirmText: "OK",
    });
  }
}

// ===========================================================
// MODAL BUILDER
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

    <p class="modal-message">${message || ""}</p>

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
// NAVIGATION TABS (TOKEN-FREE)
// ===========================================================
function initNavTabs() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) return;

  const goPokemon = document.getElementById("goPokemon");
  const goTrainers = document.getElementById("goTrainers");
  const goShop = document.getElementById("goShop");

  if (goPokemon)
    goPokemon.onclick = () =>
      (window.location.href = `/public/picker-pokemon/?id=${encodeURIComponent(id)}`);

  if (goTrainers)
    goTrainers.onclick = () =>
      (window.location.href = `/public/picker/?id=${encodeURIComponent(id)}`);

  if (goShop)
    goShop.onclick = () =>
      (window.location.href = `/public/dashboardshop/?id=${encodeURIComponent(id)}`);
}
