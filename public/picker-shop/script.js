// ======================================================================
// 🛒 Coop's Collection — SHOP TAB SCRIPT (TOKEN-ONLY VERSION)
// ======================================================================
// Uses backend APIs:
//   GET  /api/user
//   POST /api/updateUser
//   POST /api/rewardPokemon
//   POST /api/rewardTrainer
// ======================================================================

let user = null;
let userId = null;
let token = null;

// ======================================================
// 💰 SHOP COST TABLE
// ======================================================
const ITEM_COSTS = {
  pokeball: 500,
  greatball: 1000,
  ultraball: 2500,
  evo_stone: 5000
};

// ======================================================
// 🔐 LOAD USER
// ======================================================
async function loadUser() {
  const params = new URLSearchParams(window.location.search);
  userId = params.get("id");
  token  = params.get("token");

  if (!userId || !token) throw new Error("Missing id or token");

  const res = await fetch(`/api/user?id=${userId}&token=${token}`);
  if (!res.ok) throw new Error("Failed to load user");

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
  if (!user.lastWeeklyPack) return true;

  const last = new Date(user.lastWeeklyPack).getTime();
  return (Date.now() - last) >= 7 * 24 * 60 * 60 * 1000;
}

// ======================================================
// 🛒 UPDATE SHOP UI
// ======================================================
function updateUI() {
  document.getElementById("ccCount").textContent = user.cc;
  document.getElementById("stoneCount").textContent =
    user.items?.evolution_stone || 0;

  const weekly = document.querySelector("[data-item='weekly']");
  weekly.disabled = !canClaimWeeklyPack();
  weekly.textContent = canClaimWeeklyPack()
    ? "Claim Weekly Pack"
    : "Weekly Pack (Claimed)";
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

async function buyStone(cost) {
  showShopModal({
    title: "Confirm Purchase?",
    message: `Buy an Evolution Stone for ${cost} CC?`,
    sprites: ["/public/sprites/items/evolutionstone.png"],
    onConfirm: async () => {

      if (!charge(cost)) return;

      user.items.evolution_stone =
        (user.items.evolution_stone || 0) + 1;

      await saveUser();
      updateUI();

      showShopModal({
        title: "Purchase Complete!",
        message: "You bought an Evolution Stone!",
        sprites: ["/public/sprites/items/evolutionstone.png"],
        onConfirm: () => {}
      });
    }
  });
}

async function buyPokeball(type, cost) {
  const ballSprite = `/public/sprites/items/${type}.png`;

  showShopModal({
    title: "Confirm Purchase?",
    message: `Buy a ${type.replace("ball"," Ball")} for ${cost} CC?`,
    sprites: [ballSprite],
    onConfirm: async () => {

      // Not enough CC
      if (!charge(cost)) return;

      updateUI();
      await saveUser();

      // Roll Pokémon & receive full reward info
      const reward = await fetch("/api/rewardPokemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: userId,
          token,
          source: type
        })
      }).then(r => r.json());

      // reward.format:
      // {
      //   success: true,
      //   pokemon: {
      //     name: "Pikachu",
      //     rarity: "rare",
      //     sprite: "/public/.../pikachu.png"
      //   }
      // }

      if (!reward.success) {
        showShopModal({
          title: "Error",
          message: "Reward could not be generated.",
          sprites: [],
          onConfirm: () => {}
        });
        return;
      }

      // Success popup showing the captured Pokémon
      showShopModal({
        title: "You caught a Pokémon!",
        message: `${reward.pokemon.rarity.toUpperCase()} ${reward.pokemon.name}`,
        sprites: [reward.pokemon.sprite],
        onConfirm: () => {}
      });

    } // end onConfirm
  });
}

// ======================================================
// 🎁 WEEKLY PACK
// ======================================================
async function claimWeeklyPack() {
  if (!canClaimWeeklyPack()) return alert("Already claimed!");

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

  user.lastWeeklyPack = new Date().toISOString();
  await saveUser();
  updateUI();

  showShopModal({
    title: "Weekly Pack Rewards!",
    message: rewards.map(r => `${r.rarity} ${r.name}`).join("<br>"),
    sprites: rewards.map(r => r.sprite),
    onConfirm: () => {}
  });
}

// ======================================================
// 🎯 BUTTON BINDINGS
// ======================================================
window.addEventListener("DOMContentLoaded", () => {
  loadUser();

  document.querySelector("[data-item='pokeball']").onclick =
    () => buyPokeball("pokeball", ITEM_COSTS.pokeball);

  document.querySelector("[data-item='greatball']").onclick =
    () => buyPokeball("greatball", ITEM_COSTS.greatball);

  document.querySelector("[data-item='ultraball']").onclick =
    () => buyPokeball("ultraball", ITEM_COSTS.ultraball);

  document.querySelector("[data-item='evo_stone']").onclick =
    () => buyStone(ITEM_COSTS.evo_stone);

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

  // Correct check
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
