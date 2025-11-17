// ======================================================================
// 🛒 Coop’s Collection — SHOP TAB SCRIPT (FINAL VERSION)
// ======================================================================
// Uses ONLY the existing backend APIs:
//   GET  /api/user
//   POST /api/updateUser
//   POST /api/rewardPokemon
//   POST /api/rewardTrainer
// ======================================================================

let user = null;
let userId = null;
let userToken = null;

// ======================================================
// 💰 CENTRAL SHOP COST TABLE
// ======================================================
const ITEM_COSTS = {
  pokeball: 500,
  greatball: 1000,
  ultraball: 2500,
  evo_stone: 5000
};


// -----------------------------------------------------
// 🔐 Load User
// -----------------------------------------------------
async function loadUser() {
  const params = new URLSearchParams(window.location.search);
  userId = params.get("id");
  userToken = params.get("token");

  const res = await fetch(`/api/user?id=${userId}&token=${userToken}`);
  if (!res.ok) throw new Error("Failed to load user");

  user = await res.json();
  updateUI();
}

// -----------------------------------------------------
// 💾 Save User
// -----------------------------------------------------
async function saveUser() {
  const res = await fetch("/api/updateUser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId, token: userToken, user })
  });

  if (!res.ok) throw new Error("Failed to save user");
}

// -----------------------------------------------------
// 🎁 Pokémon Reward (pokéballs)
// -----------------------------------------------------
async function givePokemonReward(ballType) {
  const res = await fetch("/api/rewardPokemon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: userId,
      token: userToken,
      source: ballType
    })
  });

  if (!res.ok) throw new Error("Failed to roll Pokémon");
}

// -----------------------------------------------------
// 🎁 Trainer Reward (specific tier)
// -----------------------------------------------------
async function giveTrainerReward(tier) {
  const res = await fetch("/api/rewardTrainer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: userId,
      token: userToken,
      tier
    })
  });

  if (!res.ok) throw new Error("Failed to roll Trainer");
}

// -----------------------------------------------------
// 🕒 Weekly Pack Eligibility
// -----------------------------------------------------
function canClaimWeeklyPack() {
  if (!user.lastWeeklyPack) return true;

  const last = new Date(user.lastWeeklyPack).getTime();
  const now = Date.now();

  return (now - last) >= 7 * 24 * 60 * 60 * 1000;
}

// -----------------------------------------------------
// 🛒 UI Update
// -----------------------------------------------------
function updateUI() {
  document.getElementById("ccCount").textContent = user.cc;
  document.getElementById("stoneCount").textContent = user.items?.evolution_stone || 0;

  const weeklyBtn = document.querySelector("[data-item='weekly']");
  weeklyBtn.disabled = !canClaimWeeklyPack();
  weeklyBtn.textContent = canClaimWeeklyPack() ? "Claim Weekly Pack" : "Weekly Pack (Claimed)";
}

// -----------------------------------------------------
// 💰 Spend CC
// -----------------------------------------------------
function charge(cost) {
  if (user.cc < cost) {
    alert("Not enough CC!");
    return false;
  }
  user.cc -= cost;
  return true;
}

// -----------------------------------------------------
// 💎 Buy Evolution Stone
// -----------------------------------------------------
async function buyStone(cost) {
  if (!charge(cost)) return;

  user.items.evolution_stone = (user.items.evolution_stone || 0) + 1;

  updateUI();
  await saveUser();
  alert("Evolution Stone added!");
}

// -----------------------------------------------------
// 🧪 Poké Ball Purchases
// -----------------------------------------------------
async function buyPokeball(type, cost) {
  if (!charge(cost)) return;

  updateUI();
  await saveUser();
  await givePokemonReward(type);

  alert(`${type} reward added!`);
}

// -----------------------------------------------------
// 🎁 Weekly Pack (3 common, 2 uncommon, 1 rare — both Pokémon & Trainers)
// -----------------------------------------------------
async function claimWeeklyPack() {
  if (!canClaimWeeklyPack()) return alert("Already claimed!");

  // ---- Pokémon ----
  await givePokemonReward("common");
  await givePokemonReward("common");
  await givePokemonReward("common");

  await givePokemonReward("uncommon");
  await givePokemonReward("uncommon");

  await givePokemonReward("rare");

  // ---- Trainers ----
  await giveTrainerReward("common");
  await giveTrainerReward("common");
  await giveTrainerReward("common");

  await giveTrainerReward("uncommon");
  await giveTrainerReward("uncommon");

  await giveTrainerReward("rare");

  // Mark timestamp
  user.lastWeeklyPack = new Date().toISOString();
  await saveUser();

  updateUI();
  alert("Weekly Pack collected!");
}

// -----------------------------------------------------
// 🎯 Bind Buttons
// -----------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  loadUser();

document.querySelector("[data-item='pokeball']").onclick = () =>
  buyPokeball("pokeball", ITEM_COSTS.pokeball);

document.querySelector("[data-item='greatball']").onclick = () =>
  buyPokeball("greatball", ITEM_COSTS.greatball);

document.querySelector("[data-item='ultraball']").onclick = () =>
  buyPokeball("ultraball", ITEM_COSTS.ultraball);

document.querySelector("[data-item='evo_stone']").onclick = () =>
  buyStone(ITEM_COSTS.evo_stone);

  document.querySelector("[data-item='weekly']").onclick = claimWeeklyPack;
});

//------------------------------------------------------------
// 🔄 Navigation Tabs — EXACT SAME BEHAVIOR AS TRAINERS
//------------------------------------------------------------
(function initNavTabs() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const token = params.get("token");

  if (!id || !token) return;

  document.getElementById("goPokemon").onclick = () =>
    window.location.href = `/public/picker-pokemon/?id=${id}&token=${token}`;

  document.getElementById("goTrainers").onclick = () =>
    window.location.href = `/public/picker/?id=${id}&token=${token}`;

  document.getElementById("goShop").onclick = () =>
    window.location.href = `/public/picker-shop/?id=${id}&token=${token}`;
})();

