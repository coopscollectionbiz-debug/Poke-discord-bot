// ======================================================================
// 🛒 Coop's Collection — SHOP TAB SCRIPT (COOKIE SESSION VERSION)
// ✅ UPDATED: No more full-user saves (prevents /api/updateUser abuse)
// ✅ UPDATED: Evolution Stone purchase is now SERVER-AUTHORITATIVE
//            (calls /api/shop/buy-stone — backend to be added next)
// ======================================================================

let user = null;
let userId = null;

import { rarityEmojis, rarityColors } from "/public/spriteconfig.js";
import { getNextMondayUTC, formatCountdown } from "/public/weeklyReset.js";
import { showExpired, showBanner, showMessage, isExpired } from "/public/shared/shell.js";
import { displayNameFromStored } from "/public/shared/names.js";

// Tier pill (text + tier color) for reward lines.
function tierPill(rarity) {
  const r = String(rarity || "common").toLowerCase();
  return `<span class="cc-tier" data-tier="${escapeHtml(r)}">${escapeHtml(r)}</span>`;
}

window.rarityEmojis = rarityEmojis;
window.rarityColors = rarityColors;

// ======================================================
// STATIC ITEM COSTS (must match bot shop backend)
// ======================================================
window.ITEM_COSTS = {
  pokeball: 1000,
  greatball: 2000,
  ultraball: 4000,
  evo_stone: 5000,
};

// ======================================================
// 🔐 LOAD USER (cookie session)
// ======================================================
async function loadUser() {
  const params = new URLSearchParams(window.location.search);
  userId = params.get("id");

  // No id: the shared shell already shows the "open from /dashboard" banner.
  if (!userId) {
    setBuyButtonsDisabled(true);
    return;
  }

  let res;
  try {
    res = await fetch(`/api/user?id=${encodeURIComponent(userId)}`, {
      credentials: "same-origin",
    });
  } catch {
    showBanner("Couldn't reach the server. Check your connection and refresh.", { title: "Couldn't load the Shop", key: "load" });
    return;
  }

  if (res.status === 403) {
    showExpired();
    setBuyButtonsDisabled(true);
    return;
  }

  if (!res.ok) {
    showBanner("Please refresh the page in a moment.", { title: "Couldn't load the Shop", key: "load" });
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
    <h2>Processing…</h2>
    <p>Please wait</p>
    <div class="spinner" aria-hidden="true"></div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  return () => overlay.remove();
}

// ======================================================
// SHOP MODAL (CONFIRM + CANCEL)
// ======================================================
function showShopModal({ title, message, sprites = [], onConfirm }) {
  // After a session expiry the shared banner is the only message.
  if (isExpired()) return;
  const overlay = document.createElement("div");
  overlay.id = "shopModalOverlay";

  const modal = document.createElement("div");
  modal.id = "shopModal";

  const spriteHTML = sprites
    .map((src) => `<img src="${src}" alt="">`)
    .join("");

  modal.innerHTML = `
    <h2>${title}</h2>
    <div>${spriteHTML}</div>
    <p style="margin:1rem 0;">${message}</p>
    <div class="modal-buttons">
      <button type="button" class="modal-btn cancel">Cancel</button>
      <button type="button" class="modal-btn confirm">Confirm</button>
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
    } catch (err) {
      console.error("Shop action failed:", err);
      if (!isExpired()) showMessage({ title: "Something went wrong", message: "Couldn't reach the server. Check your CC before trying again.", tone: "error" });
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
  if (!user) return false;
  return !user.weeklyPackClaimed;
}

// ======================================================
// UPDATE SHOP UI
// ======================================================
function updateUI() {
  if (!user) return;

  document.getElementById("ccCount").textContent = Number(user.cc ?? 0).toLocaleString("en-US");
  document.getElementById("stoneCount").textContent =
    user.items?.evolution_stone || 0;

  const weeklyBtn = document.querySelector("[data-item='weekly']");
  if (weeklyBtn) {
    weeklyBtn.disabled = !canClaimWeeklyPack();
    weeklyBtn.textContent = canClaimWeeklyPack() ? "Claim" : "Claimed";
  }

  updateTimers();
}

function updateTimers() {
  if (!user) return;

  const weeklyEl = document.getElementById("weeklyStatus");
  if (weeklyEl) {
    const msUntilReset = getNextMondayUTC().getTime() - Date.now();
    weeklyEl.textContent = canClaimWeeklyPack()
      ? "Available now!"
      : `Resets in ${formatCountdown(msUntilReset)}`;
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
          message: "You don't have enough CC for this purchase.",
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
          // One id per purchase click: a retried/double-sent request can't buy twice.
          body: JSON.stringify({ id: userId, requestId: newRequestId() }),
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
        // The modal renders HTML, so escape the server's notice text.
        message: res.saveNotice
          ? `You bought an Evolution Stone!<br><br><span style="color:var(--cc-gold);">${escapeHtml(res.saveNotice)}</span>`
          : "You bought an Evolution Stone!",
        sprites: ["/public/sprites/items/evolution_stone.png"],
        onConfirm: () => {},
      });
    },
  });
}

function setBuyButtonsDisabled(disabled) {
  document.querySelectorAll(".buy-btn").forEach((b) => (b.disabled = disabled));
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
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

      const rarityHTML = tierPill(reward.pokemon.rarity);

      showShopModal({
        title: "You caught a Pokémon!",
        message: `${rarityHTML}<br><strong class="reward-line">${escapeHtml(displayNameFromStored(reward.pokemon.name))}</strong>`,
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

  let res;
  try {
    res = await fetch("/api/weekly-pack", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId }),
    }).then((r) => r.json());
  } catch {
    res = { success: false, error: "Couldn't reach the server. Refresh to check whether your pack was claimed." };
  }

  closeLoading();

  if (!res.success) {
    if (!isExpired()) showMessage({ title: "Weekly Pack unavailable", message: res.error || "Weekly pack unavailable.", tone: "error" });
    updateUI();
    return;
  }

  const rewards = res.rewards || [];

  await loadUser();
  updateUI();

  const rewardLines = rewards.map(
    (r) => `<span class="reward-line">${tierPill(r.rarity)} ${escapeHtml(displayNameFromStored(r.name))}</span>`
  );

  showShopModal({
    title: "Weekly Pack Rewards!",
    message: rewardLines.join(""),
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

  // Tick countdown timers every 30s
  setInterval(updateTimers, 30_000);

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

// Navigation lives in /public/shared/shell.js (real links with ?id=).
