// ===========================================================
// Coop's Collection — Trainer Picker (COOKIE SESSION VERSION)
// Hardened + Server-authoritative refresh
// ===========================================================

import { rarityEmojis } from "/public/spriteconfig.js";

const TRAINER_SPRITE_PATH = "/public/sprites/trainers_2/";
const TRAINER_DATA_FILE = "/public/trainerSprites.json";

const API_USER = "/api/user-trainers";
const API_SET = "/api/set-trainer";
const API_PURCHASE = "/api/unlock-trainer";

// ===========================================================
// 💰 Tier-Based Trainer Costs (UI only; server is authoritative)
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
let purchaseInProgress = false;

// Equipped trainer (filename)
window.currentEquippedTrainer = null;

// ===========================================================
// HELPERS
// ===========================================================
function normFile(s) {
  return String(s || "")
    .toLowerCase()
    .replace(".png", "")
    .replace(".gif", "")
    .trim();
}

function showSessionExpired() {
  const grid = document.getElementById("trainerGrid");
  if (grid) {
    grid.innerHTML =
      "<p class='error'>⏱ Session expired. Please return to Discord and re-open the dashboard link.</p>";
  }

  // Disable controls so they don’t spam calls
  const search = document.getElementById("search");
  const ownedToggle = document.getElementById("ownedToggle");
  const unownedToggle = document.getElementById("unownedToggle");
  const rarityFilter = document.getElementById("rarityFilter");

  if (search) search.disabled = true;
  if (ownedToggle) ownedToggle.disabled = true;
  if (unownedToggle) unownedToggle.disabled = true;
  if (rarityFilter) rarityFilter.disabled = true;
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...opts,
  });

  // 403 = cookie session expired/invalid
  if (res.status === 403) {
    const err = new Error("SESSION_EXPIRED");
    err.code = 403;
    throw err;
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Some endpoints might not return JSON on error
  }

  return { res, data };
}

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
// LOAD TRAINER DATA + OWNERSHIP + CC + EQUIPPED
// ===========================================================
async function loadData() {
  try {
    const grid = document.getElementById("trainerGrid");

    if (!userId) {
      if (grid) {
        grid.innerHTML =
          "<p class='error'>❌ Missing user ID. Please open the dashboard link from Discord.</p>";
      }
      return;
    }

    // 1) Load trainer definitions
    const spriteRes = await fetch(TRAINER_DATA_FILE, { credentials: "same-origin" });
    allTrainers = await spriteRes.json();

    // 2) Load owned trainers + CC (+ equipped trainer) using cookie session
    await refreshUserState();

    updateCCDisplay();
    render(document.getElementById("search")?.value || "");
  } catch (err) {
    console.error("❌ loadData failed:", err);

    if (err?.code === 403 || err?.message === "SESSION_EXPIRED") {
      showSessionExpired();
      return;
    }

    const grid = document.getElementById("trainerGrid");
    if (grid) {
      grid.innerHTML =
        "<p class='error'>❌ Failed to load trainer data. Please re-open link.</p>";
    }
  }
}

// ===========================================================
// REFRESH USER STATE (server-authoritative)
// ===========================================================
async function refreshUserState() {
  const { data } = await fetchJSON(`${API_USER}?id=${encodeURIComponent(userId)}`);

  // Equipped trainer: backend may return equipped OR displayedTrainer
  const equipped = data?.equipped || data?.displayedTrainer || null;
  window.currentEquippedTrainer = equipped;

  // Owned trainers can be array or legacy object-map
  if (data?.owned) {
    ownedTrainers = Array.isArray(data.owned) ? data.owned : Object.keys(data.owned);
  } else {
    ownedTrainers = [];
  }

  userCC = data?.cc ?? 0;
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

  const searchTerm = String(filter || "").toLowerCase().trim();

  Object.entries(allTrainers || {}).forEach(([name, info]) => {
    const rarity = String(info?.tier || "common").toLowerCase();
    const tierDisplay = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    const emoji = rarityEmojis?.[rarity] || "⚬";
    const price = TRAINER_COSTS[rarity] ?? 5000;

    if (selectedRarity !== "all" && rarity !== selectedRarity) return;
    if (searchTerm && !String(name).toLowerCase().includes(searchTerm)) return;

    const spriteFiles = Array.isArray(info?.sprites)
      ? info.sprites
      : Array.isArray(info?.files)
      ? info.files
      : [];

    spriteFiles.forEach((fileName) => {
      if (typeof fileName !== "string") return;

      // Ownership by filename match (no extension)
      const owns = ownedTrainers.some((owned) => normFile(owned) === normFile(fileName));

      // Equipped exact match (no false positives)
      const isEquipped =
        window.currentEquippedTrainer &&
        normFile(window.currentEquippedTrainer) === normFile(fileName);

      if (showOwnedOnly && !owns) return;
      if (showUnownedOnly && owns) return;

      const imgPath = `${TRAINER_SPRITE_PATH}${fileName}`;

      const card = document.createElement("div");
      card.className = `trainer-card ${owns ? "owned" : "unowned"}`;
      if (isEquipped) card.classList.add("equipped");

      // Sprite wrapper
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

      // Name
      const nameEl = document.createElement("p");
      nameEl.className = "trainer-name";
      nameEl.textContent = name;
      card.appendChild(nameEl);

      // Tier
      const tierEl = document.createElement("div");
      tierEl.className = "trainer-tier";
      tierEl.innerHTML = `
        <span class="tier-text ${rarity}">${tierDisplay}</span>
        <span class="tier-emoji">${emoji}</span>
      `;
      card.appendChild(tierEl);

      // Price (only for unowned)
      if (!owns) {
        const priceEl = document.createElement("div");
        priceEl.className = "trainer-price";
        priceEl.innerHTML = `
          <img src="/public/sprites/items/cc_coin.png" class="cc-icon-small" />
          <span>${price.toLocaleString()}</span>
        `;
        card.appendChild(priceEl);
      }

      // Click actions
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
  if (search) search.addEventListener("input", (e) => render(e.target.value));

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
    window.showProcessing?.();

    const { data } = await fetchJSON(API_SET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, name, file }),
    });

    if (!data?.success) {
      return createTrainerModal({
        title: "Equip Failed",
        message: data?.error || "Could not equip trainer.",
        sprite: `${TRAINER_SPRITE_PATH}${file}`,
        confirmText: "OK",
      });
    }

    // Update equipped trainer in memory
    window.currentEquippedTrainer = file;

    // Re-render grid
    render(document.getElementById("search")?.value || "");

    createTrainerModal({
      title: "Trainer Equipped!",
      message: `${name} is now your active trainer.`,
      sprite: `${TRAINER_SPRITE_PATH}${file}`,
      confirmText: "OK",
    });
  } catch (err) {
    console.error("❌ selectTrainer failed:", err);

    if (err?.code === 403 || err?.message === "SESSION_EXPIRED") {
      showSessionExpired();
      return;
    }

    createTrainerModal({
      title: "Equip Failed",
      message: "Network error. Please try again.",
      sprite: `${TRAINER_SPRITE_PATH}${file}`,
      confirmText: "OK",
    });
  } finally {
    window.hideProcessing?.();
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

async function purchaseTrainer(file) {
  if (purchaseInProgress) return;
  purchaseInProgress = true;

  window.showProcessing?.();

  try {
    const { data } = await fetchJSON(API_PURCHASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, file }),
    });

    if (!data?.success) {
      return createTrainerModal({
        title: "Purchase Failed",
        message: data?.error || "Could not purchase trainer.",
        sprite: `${TRAINER_SPRITE_PATH}${file}`,
        confirmText: "OK",
      });
    }

    // Optimistic add (UI immediately shows owned)
    ownedTrainers.push(data?.file || file);

    // ✅ Server-authoritative refresh (CC + owned list)
    await refreshUserState();

    updateCCDisplay();
    render(document.getElementById("search")?.value || "");

    createTrainerModal({
      title: "Trainer Unlocked!",
      message: "You can now equip this trainer.",
      sprite: `${TRAINER_SPRITE_PATH}${file}`,
      confirmText: "OK",
    });
  } catch (err) {
    console.error("❌ purchaseTrainer failed:", err);

    if (err?.code === 403 || err?.message === "SESSION_EXPIRED") {
      showSessionExpired();
      return;
    }

    createTrainerModal({
      title: "Purchase Failed",
      message: "Network error. Please try again.",
      sprite: `${TRAINER_SPRITE_PATH}${file}`,
      confirmText: "OK",
    });
  } finally {
    window.hideProcessing?.();
    purchaseInProgress = false;
  }
}

// ===========================================================
// MODAL BUILDER (matches your current HTML/CSS)
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
