// ======================================================================
// 🛒 Coop's Collection — SHOP TAB SCRIPT (COOKIE SESSION VERSION)
// ✅ UPDATED: No more full-user saves (prevents /api/updateUser abuse)
// ✅ UPDATED: Evolution Stone purchase is now SERVER-AUTHORITATIVE
//            (calls /api/shop/buy-stone — backend to be added next)
// ======================================================================

let user = null;
let userId = null;

import { rarityEmojis, rarityColors } from "/public/spriteconfig.js";

window.rarityEmojis = rarityEmojis;
window.rarityColors = rarityColors;

// ======================================================
// STATIC ITEM COSTS (must match bot shop backend)
// ======================================================
window.ITEM_COSTS = {
  pokeball: 1000,
  greatball: 1500,
  ultraball: 3000,
  evo_stone: 5000,
};

// ======================================================
// 🔐 LOAD USER (cookie session)
// ======================================================
async function loadUser() {
  const params = new URLSearchParams(window.location.search);
  userId = params.get("id");

  if (!userId) {
    document.body.innerHTML = `
      <div style="padding:2rem;text-align:center;color:#ccc">
        <h2>🔒 Dashboard Access Required</h2>
        <p>Please open this page from Discord using the /dashboard command.</p>
      </div>
    `;
    return;
  }

  const res = await fetch(`/api/user?id=${encodeURIComponent(userId)}`, {
    credentials: "same-origin",
  });

  if (res.status === 403) {
    document.body.innerHTML = `
      <div style="padding:2rem;text-align:center;color:#ccc">
        <h2>⏱ Session Expired</h2>
        <p>Please return to Discord and re-open the dashboard.</p>
      </div>
    `;
    return;
  }

  if (!res.ok) {
    document.body.innerHTML = "<p>Failed to load dashboard.</p>";
    return;
  }

  user = await res.json();
  updateUI();
}

// ======================================================
// 💾 SAVE USER (PATCH ONLY — NEVER SEND FULL USER)
// NOTE: Keep this for cosmetic fields only (whitelisted on backend)
// ======================================================
async function saveUserPatch(patch) {
  const res = await fetch("/api/updateUser", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId, user: patch }),
  });

  if (!res.ok) throw new Error("Failed to save user patch");
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

  document.getElementById("ccCount").textContent = user.cc ?? 0;
  document.getElementById("stoneCount").textContent =
    user.items?.evolution_stone || 0;

  const weeklyBtn = document.querySelector("[data-item='weekly']");
  if (weeklyBtn) {
    weeklyBtn.disabled = !canClaimWeeklyPack();
    weeklyBtn.textContent = canClaimWeeklyPack() ? "Claim" : "Claimed";
  }
}

// ======================================================
// UI-ONLY affordability helper (NO MUTATION)
// ======================================================
function canAfford(cost) {
  return (user?.cc ?? 0) >= cost;
}

// ======================================================
// BUY EVOLUTION STONE (SERVER AUTHORITATIVE)
// Requires backend route: POST /api/shop/buy-stone { id }
// Expected response:
//   { success:true, cc:<number>, stones:<number> }
//   OR { success:false, error:"..." }
// ======================================================
async function buyStone(cost) {
  showShopModal({
    title: "Confirm Purchase?",
    message: `Buy an Evolution Stone for ${cost} CC?`,
    sprites: ["/public/sprites/items/evolution_stone.png"],
    onConfirm: async () => {
      // Quick UI hint only; server will enforce anyway
      if (!canAfford(cost)) {
        showShopModal({
          title: "Not enough CC",
          message: "You don’t have enough CC for this purchase.",
          onConfirm: () => {},
        });
        return;
      }

      const closeLoading = showLoadingModal();

      let res;
      try {
        res = await fetch("/api/shop/buy-stone", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: userId }),
        }).then((r) => r.json());
      } catch (e) {
        closeLoading();
        showShopModal({
          title: "Error",
          message: "Network error. Please try again.",
          onConfirm: () => {},
        });
        return;
      }

      closeLoading();

      if (!res?.success) {
        showShopModal({
          title: "Error",
          message: res?.error || "Purchase failed.",
          onConfirm: () => {},
        });
        return;
      }

      // Update local view from server response
      if (typeof res.cc === "number") user.cc = res.cc;
      user.items ??= {};
      if (typeof res.stones === "number") {
        user.items.evolution_stone = res.stones;
      } else {
        // Fallback: if backend returns a delta, still handle gracefully
        user.items.evolution_stone = (user.items.evolution_stone || 0) + 1;
      }

      updateUI();

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
// BUY POKEBALL (server authoritative)
// ======================================================
async function buyPokeball(type, cost) {
  const ballSprite = `/public/sprites/items/${type}.png`;

  showShopModal({
    title: "Confirm Purchase?",
    message: `Buy a ${type.replace("ball", " Ball")} for ${cost} CC?`,
    sprites: [ballSprite],
    onConfirm: async () => {
      const reward = await fetch("/api/rewardPokemon", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, source: type }),
      }).then((r) => r.json());

      if (!reward.success) {
        showShopModal({
          title: "Error",
          message: reward.error || "Reward could not be generated.",
          onConfirm: () => {},
        });
        return;
      }

      if (typeof reward.cc === "number") {
        user.cc = reward.cc;
        updateUI();
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

      setTimeout(() => {
        const overlay = document.getElementById("shopModalOverlay");
        if (!overlay) return;

        const cancelBtn = overlay.querySelector(".modal-btn.cancel");
        if (cancelBtn) {
          cancelBtn.disabled = true;
          cancelBtn.textContent = "Reward Locked";
          cancelBtn.style.opacity = "0.5";

          const clone = cancelBtn.cloneNode(true);
          cancelBtn.parentNode.replaceChild(clone, cancelBtn);
        }
      }, 50);
    },
  });
}

// ======================================================
// WEEKLY PACK — Single call (cookie session)
// ======================================================
async function claimWeeklyPack() {
  if (!canClaimWeeklyPack()) return;

  const weeklyBtn = document.querySelector("[data-item='weekly']");
  if (weeklyBtn) weeklyBtn.disabled = true;

  const closeLoading = showLoadingModal();

  const res = await fetch("/api/weekly-pack", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId }),
  }).then((r) => r.json());

  closeLoading();

  if (!res.success) {
    alert(res.error || "Weekly pack unavailable.");
    updateUI();
    return;
  }

  const rewards = res.rewards || [];

  await loadUser();
  updateUI();

  const rewardLines = rewards.map((r) => {
    const emoji = window.rarityEmojis?.[r.rarity] ?? "";
    const color = window.rarityColors?.[r.rarity] ?? "#fff";
    return `
      <span style="color:${color}; font-weight:700;">
        ${emoji} ${r.rarity}
      </span> — ${r.name}
    `;
  });

  showShopModal({
    title: "Weekly Pack Rewards!",
    message: rewardLines.join("<br>"),
    sprites: [
      "/public/sprites/items/starter_pack.png",
      ...rewards.map((r) => r.sprite),
    ],
    onConfirm: () => {},
  });
}

// ======================================================
// BUTTON BINDINGS
// ======================================================
window.addEventListener("DOMContentLoaded", () => {
  loadUser();

  const pokeballBtn = document.querySelector("[data-item='pokeball']");
  const greatballBtn = document.querySelector("[data-item='greatball']");
  const ultraballBtn = document.querySelector("[data-item='ultraball']");
  const stoneBtn = document.querySelector("[data-item='evo_stone']");
  const weeklyBtn = document.querySelector("[data-item='weekly']");

  if (pokeballBtn)
    pokeballBtn.onclick = () =>
      buyPokeball("pokeball", window.ITEM_COSTS.pokeball);

  if (greatballBtn)
    greatballBtn.onclick = () =>
      buyPokeball("greatball", window.ITEM_COSTS.greatball);

  if (ultraballBtn)
    ultraballBtn.onclick = () =>
      buyPokeball("ultraball", window.ITEM_COSTS.ultraball);

  if (stoneBtn)
    stoneBtn.onclick = () => buyStone(window.ITEM_COSTS.evo_stone);

  if (weeklyBtn) weeklyBtn.onclick = claimWeeklyPack;
});

// ======================================================
// TOKEN-FREE NAVIGATION
// ======================================================
(function initNavTabs() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) return;

  const goPokemon = document.getElementById("goPokemon");
  const goTrainers = document.getElementById("goTrainers");
  const goShop = document.getElementById("goShop");

  if (goPokemon)
    goPokemon.onclick = () =>
      (window.location.href = `/public/picker-pokemon/?id=${encodeURIComponent(
        id
      )}`);

  if (goTrainers)
    goTrainers.onclick = () =>
      (window.location.href = `/public/picker/?id=${encodeURIComponent(id)}`);

  if (goShop)
    goShop.onclick = () =>
      (window.location.href = `/public/dashboardshop/?id=${encodeURIComponent(
        id
      )}`);
})();
