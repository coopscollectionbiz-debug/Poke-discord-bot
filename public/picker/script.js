// ===========================================================
// Coop's Collection — Trainer Picker (COOKIE SESSION VERSION)
// Hardened + Server-authoritative refresh
// ===========================================================

import { showExpired } from "/public/shared/shell.js";
import { scanFx, hasTrainerBackdrop } from "/public/shared/spriteFx.js";

const LOCK_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>`;

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
// Breathing idle GIFs: { "file.png": "file.gif" } (tools/generate-trainer-idles.mjs)
let trainerIdles = {};
// A trainer image: the breathing idle when `animated` and one exists, else the PNG.
const trainerImg = (file, animated) =>
  animated && trainerIdles[file] ? `/public/sprites/trainers_idle/${trainerIdles[file]}` : `${TRAINER_SPRITE_PATH}${file}`;
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
  // One message on every page (shared shell banner).
  showExpired();
  const grid = document.getElementById("trainerGrid");
  if (grid) grid.innerHTML = "";

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
  loadData();
});

// ===========================================================
// LOAD TRAINER DATA + OWNERSHIP + CC + EQUIPPED
// ===========================================================
async function loadData() {
  try {
    const grid = document.getElementById("trainerGrid");

    if (!userId) {
      // The shared shell shows the "open from /dashboard" banner.
      if (grid) grid.innerHTML = "";
      return;
    }

    // 1) Load trainer definitions
    const spriteRes = await fetch(TRAINER_DATA_FILE, { credentials: "same-origin" });
    allTrainers = await spriteRes.json();
    // Breathing idles (optional: trainers stay static PNGs without it)
    trainerIdles = await fetch("/public/sprites/trainers_idle/manifest.json", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));

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
        "<p class='error'>Couldn't load your Trainers. Refresh the page, or run /dashboard in Discord for a new link.</p>";
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

      // Owned trainers breathe (idle GIF); unowned stay static (CSS grays them).
      const staticPath = `${TRAINER_SPRITE_PATH}${fileName}`;
      const imgPath = trainerImg(fileName, owns);

      const card = document.createElement("div");
      card.className = `trainer-card ${owns ? "owned" : "unowned"}`;
      if (isEquipped) card.classList.add("equipped");

      // Sprite wrapper
      const wrapper = document.createElement("div");
      wrapper.className = "sprite-wrapper";
      // Owned Epic+ trainers: the Discord trainer card's tier backdrop.
      if (owns && hasTrainerBackdrop(rarity)) { wrapper.dataset.fx = "trainer"; wrapper.dataset.fxTier = rarity; }

      const img = document.createElement("img");
      img.src = imgPath;
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => {
        if (img.src.endsWith(".gif")) { img.src = staticPath; return; } // idle GIF missing: use the PNG
        card.remove();
      };

      wrapper.appendChild(img);

      // Lock icon overlay for unowned trainers
      if (!owns) {
        const lock = document.createElement("div");
        lock.className = "lock-overlay";
        lock.innerHTML = LOCK_ICON;
        wrapper.appendChild(lock);
      }
      if (isEquipped) {
        const tag = document.createElement("span");
        tag.className = "equipped-tag";
        tag.textContent = "Equipped";
        wrapper.appendChild(tag);
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
      tierEl.innerHTML = `<span class="cc-tier" data-tier="${rarity}">${tierDisplay}</span>`;
      card.appendChild(tierEl);

      // Price (only for unowned)
      if (!owns) {
        const priceEl = document.createElement("div");
        priceEl.className = "trainer-price";
        priceEl.innerHTML = `
          <img src="/public/sprites/items/cc_coin.png" class="cc-icon-small" alt="" />
          <span>${price.toLocaleString()} CC</span>
        `;
        card.appendChild(priceEl);
      }

      // Keyboard + screen reader: the card is the control.
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.dataset.ccActivate = "1";
      card.setAttribute(
        "aria-label",
        `${name}, ${tierDisplay}, ${isEquipped ? "equipped" : owns ? "owned, equip" : `not owned, unlock for ${price.toLocaleString()} CC`}`
      );

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
  scanFx(grid);
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
      ownedToggle.classList.toggle("active", showOwnedOnly);
      if (unownedToggle) unownedToggle.classList.remove("active");
      ownedToggle.setAttribute("aria-pressed", String(showOwnedOnly));
      unownedToggle?.setAttribute("aria-pressed", "false");
      render(search?.value || "");
    });
  }

  if (unownedToggle) {
    unownedToggle.addEventListener("click", (e) => {
      showUnownedOnly = !showUnownedOnly;
      showOwnedOnly = false;
      unownedToggle.classList.toggle("active", showUnownedOnly);
      if (ownedToggle) ownedToggle.classList.remove("active");
      unownedToggle.setAttribute("aria-pressed", String(showUnownedOnly));
      ownedToggle?.setAttribute("aria-pressed", "false");
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
    sprite: trainerImg(file, true),
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
        sprite: trainerImg(file, true),
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
      sprite: trainerImg(file, true),
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
      sprite: trainerImg(file, true),
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
    sprite: trainerImg(file, false),
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
        sprite: trainerImg(file, false),
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
      sprite: trainerImg(file, true),
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
      sprite: trainerImg(file, false),
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
            <img src="/public/sprites/items/cc_coin.png" class="cc-icon-small" alt="" />
            <span>${price.toLocaleString()} CC</span>
          </div>
        `
        : ""
    }

    <p class="modal-message">${message || ""}</p>

    <div class="modal-buttons">
      <button type="button" class="modal-btn cancel">Cancel</button>
      <button type="button" class="modal-btn confirm" ${confirmDisabled ? "disabled" : ""}>
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

// Navigation lives in /public/shared/shell.js (real links with ?id=).
