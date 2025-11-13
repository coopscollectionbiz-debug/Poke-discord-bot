// Unified Dashboard Script
// Loads user data, updates lead Pokémon, handles filters, grid rendering, and trainer redirect.

let userData = null;

// Fetch user data using URL params
async function fetchUser() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const token = params.get("token");

  if (!id || !token) return null;

  const res = await fetch(`/api/user-pokemon?id=${id}&token=${token}`);
  return await res.json();
}

// Update Lead Pokémon Sprite
function updateLeadPokemonSprite() {
  const img = document.getElementById("leadPokemonSprite");
  const lead = userData.currentTeam?.[0];

  if (!lead) {
    img.src = "/public/sprites/pokemon/0.gif";
    return;
  }

  const isShiny = userData.pokemon?.[lead]?.shiny > 0;
  img.src = isShiny
    ? `/public/sprites/shiny/${lead}.gif`
    : `/public/sprites/pokemon/${lead}.gif`;
}

// HUD Rendering (TP, CC, etc.)
function renderHUD() {
  const hud = document.getElementById("hud");
  hud.innerHTML = `
    <div class="hud-item">TP: ${userData.tp}</div>
    <div class="hud-item">CC: ${userData.cc}</div>
    <div class="hud-item">Stones: ${userData.items?.evolution_stone ?? 0}</div>
    <div class="hud-item">Rank: ${userData.rank}</div>
  `;
}

// Pokémon Grid Rendering
function renderPokemonGrid() {
  const grid = document.getElementById("pokemonGrid");
  grid.innerHTML = "";

  const searchText = document.getElementById("searchInput").value.toLowerCase();
  const rarity = document.getElementById("rarityFilter").value;
  const type = document.getElementById("typeFilter").value;
  const shinyOnly = document.getElementById("showShinyOnly").checked;

  for (const [id, data] of Object.entries(userData.pokemon || {})) {
    const ownedNormal = data.normal || 0;
    const ownedShiny = data.shiny || 0;
    const hasShiny = ownedShiny > 0;

    if (shinyOnly && !hasShiny) continue;

    const name = window.pokemonData?.[id]?.name || `#${id}`;
    const tier = window.pokemonData?.[id]?.tier || "common";
    const typing = window.pokemonData?.[id]?.types || [];

    if (searchText && !name.toLowerCase().includes(searchText)) continue;
    if (rarity !== "all" && tier !== rarity) continue;
    if (type !== "all" && !typing.includes(type)) continue;

    const sprite = hasShiny
      ? `/public/sprites/shiny/${id}.gif`
      : `/public/sprites/pokemon/${id}.gif`;

    const card = document.createElement("div");
    card.className = "pokemon-card";
    card.innerHTML = `
      <img src="${sprite}" />
      <span>${name}</span>
      <span class="count">Normal: ${ownedNormal} | Shiny: ${ownedShiny}</span>
    `;

    grid.appendChild(card);
  }
}

// Load Pokémon Database (Needed for names/types)
async function loadPokemonDatabase() {
  const res = await fetch("/public/pokemonData.json");
  window.pokemonData = await res.json();
  populateFilters();
}

// Populate Filter Dropdowns
function populateFilters() {
  const rarityFilter = document.getElementById("rarityFilter");
  const typeFilter = document.getElementById("typeFilter");

  rarityFilter.innerHTML = `
    <option value="all">All Rarities</option>
    <option value="common">Common</option>
    <option value="uncommon">Uncommon</option>
    <option value="rare">Rare</option>
    <option value="epic">Epic</option>
    <option value="legendary">Legendary</option>
    <option value="mythic">Mythic</option>
  `;

  const types = new Set();
  for (const p of Object.values(window.pokemonData)) {
    (p.types || []).forEach((t) => types.add(t));
  }

  typeFilter.innerHTML = `<option value="all">All Types</option>`;
  for (const t of [...types].sort()) {
    typeFilter.innerHTML += `<option value="${t}">${t}</option>`;
  }
}

// Change Trainer Button
function initTrainerButton() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const token = params.get("token");

  document.getElementById("changeTrainerBtn").onclick = () => {
    window.location.href = `/public/picker?id=${id}&token=${token}`;
  };
}

// Event Listeners
function initEventHandlers() {
  document.getElementById("searchInput").addEventListener("input", renderPokemonGrid);
  document.getElementById("rarityFilter").addEventListener("change", renderPokemonGrid);
  document.getElementById("typeFilter").addEventListener("change", renderPokemonGrid);
  document.getElementById("showShinyOnly").addEventListener("change", renderPokemonGrid);
}

// Initialize Dashboard
async function init() {
  await loadPokemonDatabase();

  userData = await fetchUser();
  if (!userData) {
    alert("Missing or invalid user token");
    return;
  }

  renderHUD();
  updateLeadPokemonSprite();
  renderPokemonGrid();
  initTrainerButton();
  initEventHandlers();
}

init();
