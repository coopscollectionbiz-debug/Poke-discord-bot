// ======================================================================
// 🛒 Coop's Collection — SHOP TAB SCRIPT (TOKEN-ONLY VERSION)
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

const ITEM_COSTS = window.ITEM_COSTS;

// ======================================================
// 🔐 LOAD USER
// ======================================================
async function loadUser() {
  const params = new URLSearchParams(window.location.search);
  userId = params.get("id");
  token  = params.get("token");

  // Do NOT throw here — it breaks all buttons.
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
    body: JSON.stringify({ id: userId, token, user })
  });

  if (!res.ok) throw new Error("Failed to save user");
}


function showLoadingModal() {
  const overlay = document.createElement("div");
  overlay.id = "shopModalOverlay";

  const modal = document.createElement("div");
  modal.id = "shopModal";

  modal.innerHTML = `
    <h2 style="color:#00ff9d; margin-top:0;">Processing...</h2>
    <p style="color:#ccc;">Please wait</p>
    <div class="spinner"></div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Return a function to close the modal
  return () => overlay.remove();
}

// ======================================================
// Shop modals
// ======================================================

function showShopModal({ title, message, sprites = [], onConfirm }) {
  const overlay = document.createElement("div");
  overlay.id = "shopModalOverlay";

  const modal = document.createElement("div");
  modal.id = "shopModal";

  let spriteHTML = sprites
    .map(src => `<img src="${src}" alt="sprite">`)
    .join("");

  modal.innerHTML = `
    <h2 style="color:#00ff9d; margin-top:0;">${title}</h2>
    <div>${spriteHTML}</div>
    <p style="margin:1rem 0; color:#ccc;">${message}</p>

    <div class="modal-buttons">
      <button class="modal-btn cancel">Cancel</button>
      <button class="modal-btn confirm">Confirm</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.querySelector(".cancel").onclick = () => overlay.remove();
  modal.querySelector(".confirm").onclick = async () => {
    await onConfirm();
    overlay.remove();
  };

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ======================================================
// 🎁 TRAINER REWARD
// ======================================================
async function giveTrainerReward(tier) {
  const res = await fetch("/api/rewardTrainer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId, token, tier })
  });
  if (!res.ok) throw new Error("Failed to roll Trainer");
}

// ======================================================
// 🕒 WEEKLY PACK ELIGIBILITY
// ======================================================
function canClaimWeeklyPack() {
  if (!user || !user.lastWeeklyPack) return true;
  return (Date.now() - new Date(user.lastWeeklyPack).getTime()) >= 7 * 24 * 60 * 60 * 1000;
}

// ======================================================
// 🛒 UPDATE SHOP UI
// ======================================================
function updateUI() {
  if (!user) return;

  document.getElementById("ccCount").textContent = user.cc;
  document.getElementById("stoneCount").textContent =
    user.items?.evolution_stone || 0;

  const weekly = document.querySelector("[data-item='weekly']");
  weekly.disabled = !canClaimWeeklyPack();
  weekly.textContent = canClaimWeeklyPack()
    ? "Claim"
    : "Claimed";
}

// ======================================================
// 💰 CC SPENDING HELPERS
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
// ⭐ BUY EVOLUTION STONE (with loading modal)
// ======================================================
async function buyStone(cost) {
  showShopModal({
    title: "Confirm Purchase?",
    message: `Buy an Evolution Stone for ${cost} CC?`,
    sprites: ["/public/sprites/items/evolution_stone.png"],
    onConfirm: async () => {

      if (!charge(cost)) return;

      // 🔄 SHOW LOADING
      const closeLoading = showLoadingModal();

      user.items.evolution_stone =
        (user.items.evolution_stone || 0) + 1;

      await saveUser();
      updateUI();

      closeLoading(); // 🔄 CLOSE LOADING

      showShopModal({
        title: "Purchase Complete!",
        message: "You bought an Evolution Stone!",
        sprites: ["/public/sprites/items/evolution_stone.png"],
        onConfirm: () => {}
      });
    }
  });
}

// ======================================================
// ⭐ BUY POKEBALL — now includes colored rarity + emoji
// ======================================================
async function buyPokeball(type, cost) {
  const ballSprite = `/public/sprites/items/${type}.png`;

  showShopModal({
    title: "Confirm Purchase?",
    message: `Buy a ${type.replace("ball"," Ball")} for ${cost} CC?`,
    sprites: [ballSprite],
    onConfirm: async () => {

      if (!charge(cost)) return;

      updateUI();
      await saveUser();

      const reward = await fetch("/api/rewardPokemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: userId,
          token,
          source: type
        })
      }).then(r => r.json());

      if (!reward.success) {
        showShopModal({
          title: "Error",
          message: "Reward could not be generated.",
          onConfirm: () => {}
        });
        return;
      }

      // -------------------------------
      // ⭐ Build tier display
      // -------------------------------
      const rarity = reward.pokemon.rarity;
      const emoji = window.rarityEmojis?.[rarity] ?? "";
      const color = window.rarityColors?.[rarity] ?? "#fff";

      const rarityHTML = `
        <span style="color:${color}; font-weight:700;">
          ${emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)}
        </span>
      `;

      // -------------------------------
      // ⭐ Final popup with styled rarity
      // -------------------------------
      showShopModal({
        title: "You caught a Pokémon!",
        message: `${rarityHTML}<br>${reward.pokemon.name}`,
        sprites: [reward.pokemon.sprite],
        onConfirm: () => {}
      });

    }
  });
}

// ======================================================
// 🎁 WEEKLY PACK (with loading modal)
// ======================================================
async function claimWeeklyPack() {
  if (!canClaimWeeklyPack()) return;

  const rewards = [];

  async function pushPokemon(tier) {
    const result = await fetch("/api/rewardPokemon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, source: tier })
    }).then(r => r.json());
    rewards.push(result.pokemon);
  }

  async function pushTrainer(tier) {
    const result = await fetch("/api/rewardTrainer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, token, tier })
    }).then(r => r.json());
    rewards.push(result.trainer);
  }

  // Pokémon
  await pushPokemon("common");
  await pushPokemon("common");
  await pushPokemon("common");
  await pushPokemon("uncommon");
  await pushPokemon("uncommon");
  await pushPokemon("rare");

  // Trainers
  await pushTrainer("common");
  await pushTrainer("common");
  await pushTrainer("common");
  await pushTrainer("uncommon");
  await pushTrainer("uncommon");
  await pushTrainer("rare");

  // 🔄 SHOW LOADING (covers save + UI update)
  const closeLoading = showLoadingModal();

  user.lastWeeklyPack = new Date().toISOString();
  await saveUser();
  updateUI();

  closeLoading(); // 🔄 CLOSE LOADING

  showShopModal({
    title: "Weekly Pack Rewards!",
    message: rewards.map(r => `${r.rarity} ${r.name}`).join("<br>"),
    sprites: [
      "/public/sprites/items/starter_pack.png",
      ...rewards.map(r => r.sprite)
    ],
    onConfirm: () => {}
  });
}

// ======================================================
// 🎯 BUTTON BINDINGS
// ======================================================
window.addEventListener("DOMContentLoaded", () => {
  loadUser();

 document.querySelector("[data-item='pokeball']").onclick =
  () => buyPokeball("pokeball", window.ITEM_COSTS.pokeball);

document.querySelector("[data-item='greatball']").onclick =
  () => buyPokeball("greatball", window.ITEM_COSTS.greatball);

document.querySelector("[data-item='ultraball']").onclick =
  () => buyPokeball("ultraball", window.ITEM_COSTS.ultraball);

document.querySelector("[data-item='evo_stone']").onclick =
  () => buyStone(window.ITEM_COSTS.evo_stone);


  document.querySelector("[data-item='weekly']").onclick =
    claimWeeklyPack;
});

// ======================================================
// 🔄 NAVIGATION TABS — TOKEN SAFE
// ======================================================
(function initNavTabs() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const urlToken = params.get("token");

  if (!id || !urlToken) return;

  const goPokemon  = document.getElementById("goPokemon");
  const goTrainers = document.getElementById("goTrainers");
  const goShop     = document.getElementById("goShop");

  if (goPokemon)
    goPokemon.onclick = () =>
      window.location.href = `/public/picker-pokemon/?id=${id}&token=${urlToken}`;

  if (goTrainers)
    goTrainers.onclick = () =>
      window.location.href = `/public/picker/?id=${id}&token=${urlToken}`;

  if (goShop)
    goShop.onclick = () =>
      window.location.href = `/public/picker-shop/?id=${id}&token=${urlToken}`;
})();
