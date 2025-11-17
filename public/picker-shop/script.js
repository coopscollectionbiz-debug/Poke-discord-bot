// ======================================================================
// 🛒 Coop's Collection — SHOP TAB SCRIPT (MODULE VERSION)
// ======================================================================

let user = null;
let userId = null;
let token = null;

import { rarityEmojis, rarityColors } from "/public/spriteconfig.js";

window.rarityEmojis = rarityEmojis;
window.rarityColors = rarityColors;

// ======================================================
// STATIC ITEM COSTS (must match bot shop backend)
// ======================================================
window.ITEM_COSTS = {
  pokeball: 500,
  greatball: 1000,
  ultraball: 2500,
  evo_stone: 5000,
};

// ======================================================
// 🔐 LOAD USER
// ======================================================
async function loadUser() {
  const params = new URLSearchParams(window.location.search);
  userId = params.get("id");
  token = params.get("token");

  if (!userId || !token) {
    console.warn("Missing id or token in URL");
    return;
  }

  const res = await fetch(`/api/user?id=${userId}&token=${token}`);
  if (!res.ok) {
    console.error("Failed to load user");
    return;
  }

  user = await res.json();
  updateUI();
}

// ======================================================
// 💾 SAVE USER
// ======================================================
async function saveUser() {
  const res = await fetch("/api/updateUser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId, token, user }),
  });

  if (!res.ok) throw new Error("Failed to save user");
}

// ======================================================
// LOADING MODAL
// ======================================================
function showLoadingModal() {
  const overlay = document.createElement("div");
  overlay.id = "shopModalOverlay";

  const modal = document.createElement("div");
  modal.id = "shopModal";

  modal.innerHTML = `
    <h2 style="color:#00ff9d;margin-top:0;">Processing...</h2>
    <p style="color:#ccc;">Please wait</p>
    <div class="spinner"></div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  return () => overlay.remove();
}

// ======================================================
// SHOP MODAL (CONFIRM + CANCEL)
// ======================================================
function showShopModal({ title, message, sprites = [], onConfirm }) {
  const overlay = document.createElement("div");
  overlay.id = "shopModalOverlay";

  const modal = document.createElement("div");
  modal.id = "shopModal";

  const spriteHTML = sprites
    .map((src) => `<img src="${src}" alt="sprite">`)
    .join("");

  modal.innerHTML = `
    <h2 style="color:#00ff9d;margin-top:0;">${title}</h2>
    <div>${spriteHTML}</div>
    <p style="margin:1rem 0;color:#ccc;">${message}</p>
    <div class="modal-buttons">
      <button class="modal-btn cancel">Cancel</button>
      <button class="modal-btn confirm">Confirm</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const cancelBtn = modal.querySelector(".cancel");
  const confirmBtn = modal.querySelector(".confirm");

  cancelBtn.onclick = () => overlay.remove();

  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = "Processing...";
    confirmBtn.style.opacity = "0.6";

    const closeLoading = showLoadingModal();

    try {
      await onConfirm();
    } finally {
      closeLoading();
      overlay.remove();
    }
  };

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ======================================================
// WEEKLY PACK ELIGIBILITY
// ======================================================
function canClaimWeeklyPack() {
  if (!user || !user.lastWeeklyPack) return true;

  return (
    Date.now() - new Date(user.lastWeeklyPack).getTime() >
    7 * 24 * 60 * 60 * 1000
  );
}

// ======================================================
// UPDATE SHOP UI
// ======================================================
function updateUI() {
  if (!user) return;

  document.getElementById("ccCount").textContent = user.cc;
  document.getElementById("stoneCount").textContent =
    user.items?.evolution_stone || 0;

  const weeklyBtn = document.querySelector("[data-item='weekly']");
  weeklyBtn.disabled = !canClaimWeeklyPack();
  weeklyBtn.textContent = canClaimWeeklyPack() ? "Claim" : "Claimed";
}

// ======================================================
// CC SPENDING
// ======================================================
function charge(cost) {
  if (user.cc < cost) {
    alert("Not enough CC!");
    return false;
  }
  user.cc -= cost;
  return true;
}

// ======================================================
// BUY EVOLUTION STONE
// ======================================================
async function buyStone(cost) {
  showShopModal({
    title: "Confirm Purchase?",
    message: `Buy an Evolution Stone for ${cost} CC?`,
    sprites: ["/public/sprites/items/evolution_stone.png"],
    onConfirm: async () => {
      if (!charge(cost)) return;

      const closeLoading = showLoadingModal();

      user.items.evolution_stone =
        (user.items.evolution_stone || 0) + 1;

      await saveUser();
      updateUI();
      closeLoading();

      showShopModal({
        title: "Purchase Complete!",
        message: "You bought an Evolution Stone!",
        sprites: ["/public/sprites/items/evolution_stone.png"],
        onConfirm: () => {},
      });
    },
  });
}

// ======================================================
// BUY POKEBALL
// ======================================================
async function buyPokeball(type, cost) {
  const ballSprite = `/public/sprites/items/${type}.png`;

  showShopModal({
    title: "Confirm Purchase?",
    message: `Buy a ${type.replace("ball", " Ball")} for ${cost} CC?`,
    sprites: [ballSprite],
    onConfirm: async () => {
      if (!charge(cost)) return;

      await saveUser();
      updateUI();

      const reward = await fetch("/api/rewardPokemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, token, source: type }),
      }).then((r) => r.json());

      if (!reward.success) {
        showShopModal({
          title: "Error",
          message: "Reward could not be generated.",
          onConfirm: () => {},
        });
        return;
      }

      const rarity = reward.pokemon.rarity;
      const emoji = rarityEmojis[rarity] ?? "";
      const color = rarityColors[rarity] ?? "#fff";

      const rarityHTML = `
        <span style="color:${color};font-weight:700;">
          ${emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)}
        </span>
      `;

      showShopModal({
        title: "You caught a Pokémon!",
        message: `${rarityHTML}<br>${reward.pokemon.name}`,
        sprites: [reward.pokemon.sprite],
        onConfirm: () => {},
      });
    },
  });
}

// ======================================================
// WEEKLY PACK — FINAL FIXED VERSION
// ======================================================
async function claimWeeklyPack() {
  if (!canClaimWeeklyPack()) return;

  const weeklyBtn = document.querySelector("[data-item='weekly']");
  if (weeklyBtn) weeklyBtn.disabled = true;

  // Show loading overlay
  const closeLoading = showLoadingModal();
  const rewards = [];

  // Pokémon reward helper
  async function pushPokemon(tier) {
    const result = await fetch("/api/rewardPokemon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, source: tier }),
    }).then((r) => r.json());

    if (result?.success && result?.pokemon) {
      rewards.push({
        type: "pokemon",
        name: result.pokemon.name,
        rarity: result.pokemon.rarity,
        sprite: result.pokemon.sprite
      });
    }
  }

  // Trainer reward helper (with safety normalization)
  async function pushTrainer(tier) {
    const result = await fetch("/api/rewardTrainer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, tier }),
    }).then((r) => r.json());

    if (result?.success && result?.trainer) {
      const t = result.trainer;
      rewards.push({
        type: "trainer",
        name: t.name || "Unknown Trainer",
        rarity: t.rarity || "common",
        sprite: t.sprite || "/public/sprites/items/unknown.png"
      });
    }
  }

  // ======================================================
  // ⭐ Generate ALL rewards BEFORE setting cooldown
  // ======================================================
  await pushPokemon("common");
  await pushPokemon("common");
  await pushPokemon("common");
  await pushPokemon("uncommon");
  await pushPokemon("uncommon");
  await pushPokemon("rare");

  await pushTrainer("common");
  await pushTrainer("common");
  await pushTrainer("common");
  await pushTrainer("uncommon");
  await pushTrainer("uncommon");
  await pushTrainer("rare");

  // ======================================================
  // ⭐ Apply cooldown AFTER rewards are safely rolled
  // ======================================================
  user.lastWeeklyPack = new Date().toISOString();
  await saveUser();
  updateUI();

  closeLoading();

  // ======================================================
  // Render rewards cleanly
  // ======================================================
  const rewardLines = rewards.map((r) => {
    const rare = r.rarity || "common";
    const name = r.name || "Unknown";
    return `${rare} — ${name}`;
  });

  const spriteList = [
    "/public/sprites/items/starter_pack.png",
    ...rewards.map((r) => r.sprite)
  ];

  // ======================================================
  // 🎁 Show final modal
  // ======================================================
  showShopModal({
    title: "Weekly Pack Rewards!",
    message: rewardLines.join("<br>"),
    sprites: spriteList,
    onConfirm: () => {},
  });
}

// ======================================================
// BUTTON BINDINGS
// ======================================================
window.addEventListener("DOMContentLoaded", () => {
  loadUser();

  document.querySelector("[data-item='pokeball']").onclick = () =>
    buyPokeball("pokeball", window.ITEM_COSTS.pokeball);

  document.querySelector("[data-item='greatball']").onclick = () =>
    buyPokeball("greatball", window.ITEM_COSTS.greatball);

  document.querySelector("[data-item='ultraball']").onclick = () =>
    buyPokeball("ultraball", window.ITEM_COSTS.ultraball);

  document.querySelector("[data-item='evo_stone']").onclick = () =>
    buyStone(window.ITEM_COSTS.evo_stone);

  document.querySelector("[data-item='weekly']").onclick = claimWeeklyPack;
});

// ======================================================
// TOKEN-SAFE NAVIGATION
// ======================================================
(function initNavTabs() {
  function getSafeParams() {
    if (userId && token) return { id: userId, token };

    const params = new URLSearchParams(window.location.search);
    return {
      id: params.get("id"),
      token: params.get("token"),
    };
  }

  const { id, token: safeToken } = getSafeParams();
  if (!id || !safeToken) return;

  const goPokemon = document.getElementById("goPokemon");
  const goTrainers = document.getElementById("goTrainers");
  const goShop = document.getElementById("goShop");

  if (goPokemon)
    goPokemon.onclick = () =>
      (window.location.href = `/public/picker-pokemon/?id=${id}&token=${safeToken}`);

  if (goTrainers)
    goTrainers.onclick = () =>
      (window.location.href = `/public/picker/?id=${id}&token=${safeToken}`);

  if (goShop)
    goShop.onclick = () =>
      (window.location.href = `/public/picker-shop/?id=${id}&token=${safeToken}`);
})();
