// ==========================================================
// Coop’s Collection — Static Shop (Client-Side Only)
// ==========================================================
// • Static prices
// • Static item list
// • Popup confirmation + reward preview
// • Fully client-side (no API calls yet)
// ==========================================================

// ==========================================================
// 📘 SHOP ITEMS (STATIC)
// ==========================================================
const SHOP_ITEMS = [
  {
    id: "pokeball",
    name: "Poké Ball",
    price: 100,
    description: "Roll for 1 random Pokémon (base odds).",
    image: "/public/sprites/items/pokeball.png",
    type: "roll"
  },
  {
    id: "greatball",
    name: "Great Ball",
    price: 200,
    description: "Roll for 1 random Pokémon (boosted Uncommon+).",
    image: "/public/sprites/items/greatball.png",
    type: "roll"
  },
  {
    id: "ultraball",
    name: "Ultra Ball",
    price: 400,
    description: "Roll for 1 random Pokémon (boosted Rare+).",
    image: "/public/sprites/items/ultraball.png",
    type: "roll"
  },
  {
    id: "stone",
    name: "Evolution Stone",
    price: 300,
    description: "Used to evolve eligible Pokémon.",
    image: "/public/sprites/items/evolution_stone.png",
    type: "item"
  },
  {
    id: "starter_bundle",
    name: "Starter Bundle",
    price: 0,
    description: "1 Common • 1 Uncommon • 1 Rare • 1 Rare Trainer",
    image: "/public/sprites/items/starter.png",
    type: "bundle"
  }
];

// ==========================================================
// 📦 DOM REFS
// ==========================================================
const shopGrid = document.getElementById("shopGrid");
const overlay = document.getElementById("shopPopupOverlay");
const popup = document.getElementById("shopPopup");

// ==========================================================
// 🚀 INITIAL RENDER
// ==========================================================
window.addEventListener("DOMContentLoaded", () => {
  renderShop();
});

// ==========================================================
// 🛒 RENDER SHOP ITEMS
// ==========================================================
function renderShop() {
  shopGrid.innerHTML = "";

  SHOP_ITEMS.forEach(item => {
    const card = document.createElement("div");
    card.className = "shop-card";

    card.innerHTML = `
      <img class="shop-img" src="${item.image}" alt="${item.name}">
      <h3>${item.name}</h3>
      <p class="shop-desc">${item.description}</p>
      <p class="shop-price">${item.price === 0 ? "FREE" : item.price + " CC"}</p>
      <button class="shop-btn" data-id="${item.id}">Buy</button>
    `;

    const btn = card.querySelector(".shop-btn");
    btn.addEventListener("click", () => openConfirm(item));

    shopGrid.appendChild(card);
  });
}

// ==========================================================
// 🟦 POPUP — CONFIRM PURCHASE
// ==========================================================
function openConfirm(item) {
  popup.innerHTML = `
    <h2>Purchase ${item.name}?</h2>
    <img class="popup-img" src="${item.image}">
    <p>${item.description}</p>
    <p class="popup-price">${item.price === 0 ? "FREE" : item.price + " CC"}</p>

    <div class="popup-buttons">
      <button id="confirmBuy" class="confirm-btn">Confirm</button>
      <button id="cancelBuy" class="cancel-btn">Cancel</button>
    </div>
  `;

  overlay.style.display = "flex";

  document.getElementById("cancelBuy").onclick = closePopup;

  document.getElementById("confirmBuy").onclick = () => {
    handlePurchase(item);
    closePopup();
  };
}

function closePopup() {
  overlay.classList.add("fadeOut");
  setTimeout(() => {
    overlay.style.display = "none";
    overlay.classList.remove("fadeOut");
  }, 250);
}

// ==========================================================
// ⭐ PURCHASE HANDLER (STATIC FOR NOW)
// ==========================================================
function handlePurchase(item) {
  console.log(`Purchased: ${item.name}`);

  // Temporary reward popup (static demo)
  if (item.type === "roll") {
    showReward("pokémon", item.name);
  } else if (item.type === "item") {
    showReward("item", item.name);
  } else if (item.type === "bundle") {
    showReward("bundle", item.name);
  }
}

// ==========================================================
// 🎁 MINI REWARD POPUP
// ==========================================================
function showReward(type, name) {
  popup.innerHTML = `
    <h2>🎉 Reward Received!</h2>
    <p>You received a <strong>${name}</strong> ${type}!</p>
    <button id="closeReward" class="confirm-btn">Close</button>
  `;

  overlay.style.display = "flex";

  document.getElementById("closeReward").onclick = closePopup;
}
