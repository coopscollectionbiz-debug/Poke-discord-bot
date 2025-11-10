/* ===========================================================
   Coop's Collection — Pokémon Management Script (FINAL)
   Modes: Change Team / Evolve / Donate
   =========================================================== */

let allPokemonData = {};
let userPokemon = {};
let userItems = { evolution_stone: 0 };
let userOwnedIds = [];
let currentTeam = [];
let userId, token;
let mode = "change";
let shinyMode = false;

// ===========================================================
// 🧭 URL & API Setup
// ===========================================================
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  userId = params.get("id");
  token = params.get("token");

  const pokemonGrid = document.getElementById("pokemonGrid");
  const statusMsg = document.getElementById("statusMsg");
  const saveBtn = document.getElementById("saveTeamBtn");

  if (!pokemonGrid || !statusMsg || !saveBtn) {
    console.error("❌ Missing core DOM elements in index.html");
    return;
  }

  // ===========================================================
  // 🪄 Utility
  // ===========================================================
  function setStatus(text, type = "neutral") {
    if (!statusMsg) return;
    statusMsg.textContent = text;
    statusMsg.className = `status-msg ${type}`;
  }

  function donationValueFor(tier) {
    const map = {
      common: 250,
      uncommon: 500,
      rare: 1000,
      epic: 2500,
      legendary: 5000,
      mythic: 10000,
    };
    return map[tier] ?? 0;
  }

  function evolutionCost(fromTier, toTier) {
    const costMap = {
      "common-uncommon": 1,
      "common-rare": 3,
      "uncommon-rare": 2,
      "rare-epic": 3,
      "uncommon-epic": 4,
    };
    const key = `${fromTier}-${toTier}`;
    return costMap[key] ?? 0;
  }

  function addBadge(el, text, cls) {
    const div = document.createElement("div");
    div.className = cls;
    div.textContent = text;
    el.appendChild(div);
  }

  function addLock(el) {
    const lock = document.createElement("div");
    lock.className = "lock-overlay";
    lock.innerHTML = `<span>🔒</span>`;
    el.appendChild(lock);
  }

  // ===========================================================
  // 📦 Load Data
  // ===========================================================
  async function init() {
    try {
      if (!userId || !token) {
        setStatus("Missing user credentials. Please reopen via Discord.", "error");
        return;
      }

      const [pokeRes, dataRes] = await Promise.all([
        fetch(`/api/user-pokemon?id=${userId}&token=${token}`),
        fetch(`/public/pokemonData.json`),
      ]);

      if (!pokeRes.ok || !dataRes.ok) throw new Error("HTTP fetch error");

      const pokeData = await pokeRes.json();
      const allData = await dataRes.json();

      if (pokeData.error) {
        setStatus("Session expired or invalid token.", "error");
        return;
      }

      allPokemonData = allData;
      userOwnedIds = pokeData.owned || [];
      currentTeam = pokeData.currentTeam || [];
      userPokemon = pokeData.pokemon || {};
      userItems = pokeData.items || { evolution_stone: 0 };

      // 🪙 Populate top stats bar
      const stoneCountEl = document.getElementById("stoneCount");
      if (stoneCountEl) stoneCountEl.textContent = userItems.evolution_stone ?? 0;
      
      const ccCountEl = document.getElementById("ccCount");
      if (ccCountEl) ccCountEl.textContent = pokeData.cc ?? 0;
      
      const tpCountEl = document.getElementById("tpCount");
      if (tpCountEl) tpCountEl.textContent = pokeData.tp ?? 0;
      
      const rankLabelEl = document.getElementById("rankLabel");
      if (rankLabelEl) rankLabelEl.textContent = pokeData.rank ?? "Novice Trainer";

      renderPokemonGrid();
    } catch (err) {
      console.error(err);
      setStatus("Failed to load Pokémon data.", "error");
    }
  }

  // ===========================================================
  // 🧩 Render Pokémon Grid
  // ===========================================================
  function renderPokemonGrid() {
    if (!pokemonGrid) return;
    pokemonGrid.innerHTML = "";

    const showAll = mode === "change";
    const isEvolve = mode === "evolve";
    const isDonate = mode === "donate";

    for (const [id, poke] of Object.entries(allPokemonData)) {
      const ownedData = userPokemon[id];
      const isOwned =
        ownedData && ((ownedData.normal ?? 0) > 0 || (ownedData.shiny ?? 0) > 0);

      if (!showAll && !isOwned) continue;

      const card = document.createElement("div");
      card.className = "pokemon-card";
      card.dataset.type = poke.type?.toLowerCase() || "";
      if (isOwned) card.classList.add("owned");
      else card.classList.add("unowned");

      const sprite = document.createElement("img");
      sprite.src = `/public/sprites/pokemon/${id}.gif`;
      sprite.alt = poke.name;
      card.appendChild(sprite);

      const name = document.createElement("div");
      name.className = "pokemon-name";
      name.textContent = poke.name;
      card.appendChild(name);

      const tier = document.createElement("div");
      tier.className = `tier-text ${poke.tier}`;
      tier.textContent = poke.tier.toUpperCase();
      card.appendChild(tier);

      // ⭐ Team Marker
      if (mode === "change" && currentTeam.includes(Number(id))) {
        const badge = document.createElement("div");
        badge.className = "team-badge";
        badge.textContent = currentTeam.indexOf(Number(id)) + 1;
        card.appendChild(badge);
      }

      // 🧬 Evolve Mode
      if (isEvolve && isOwned) {
        const evolvesTo = poke.evolvesTo;
        const next = evolvesTo ? allPokemonData[evolvesTo] : null;

        if (!next) {
          card.classList.add("unowned");
          addLock(card);
        } else {
          const cost = evolutionCost(poke.tier, next.tier);
          const hasEnoughStones = userItems.evolution_stone >= cost;
          const ownedNormal = userPokemon[id]?.normal ?? 0;
          const ownedShiny = userPokemon[id]?.shiny ?? 0;

          let canEvolve = false;
          if (shinyMode) {
            canEvolve = ownedShiny > 0 && cost > 0 && hasEnoughStones;
          } else {
            canEvolve = ownedNormal > 0 && cost > 0 && hasEnoughStones;
          }

          if (canEvolve) {
            addBadge(card, `🪨 ${cost}`, "evolve-cost");
            card.classList.add("eligible");
            card.addEventListener("click", () =>
              confirmEvolution(id, evolvesTo, shinyMode)
            );
          } else {
            addBadge(card, `🪨 ${cost}`, "evolve-cost");
            card.classList.add("unowned");
            addLock(card);
          }
        }
      }

      // 💝 Donate Mode
      if (isDonate && isOwned) {
        addBadge(card, `💰 ${donationValueFor(poke.tier)}`, "donate-value");
        card.addEventListener("click", () => confirmDonation(id));
      }

      // ⭐ Change Mode
      if (mode === "change" && isOwned) {
        card.addEventListener("click", () => toggleTeam(id));
      }

      pokemonGrid.appendChild(card);
    }
  }

  // ===========================================================
  // 🧬 Evolution Confirmation
  // ===========================================================
  async function confirmEvolution(baseId, targetId) {
    const base = allPokemonData[baseId];
    const target = allPokemonData[targetId];
    const cost = evolutionCost(base.tier, target.tier);

    const proceed = confirm(
      `Evolve ${base.name} → ${target.name}?\nCost: ${cost}🪨 Evolution Stones\n${
        shinyMode ? "✨ Shiny evolution enabled" : ""
      }`
    );
    if (!proceed) return;

    setStatus("Evolving...", "active");
    try {
      const res = await fetch("/api/pokemon/evolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: userId,
          token,
          baseId,
          targetId,
          shiny: shinyMode,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      showEvolutionPopup(base.name, target.name, targetId, shinyMode);
      await refreshStats();
      init();
    } catch (err) {
      console.error(err);
      setStatus(`❌ ${err.message}`, "error");
    }
  }

  // ===========================================================
  // 💝 Donation Confirmation
  // ===========================================================
  async function confirmDonation(pokeId) {
    const poke = allPokemonData[pokeId];
    const baseValue = donationValueFor(poke.tier);
    const value = shinyMode ? baseValue * 5 : baseValue;

    const proceed = confirm(
      `Donate ${shinyMode ? "✨ shiny " : ""}${poke.name} to Professor Coop?\nYou'll receive ${value} CC.`
    );
    if (!proceed) return;

    setStatus("Donating...", "active");
    try {
      const res = await fetch("/api/pokemon/donate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, token, pokeId, shiny: shinyMode }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      showDonationPopup(poke.name, poke.tier, value, pokeId, shinyMode);
      await refreshStats();
      init();
    } catch (err) {
      console.error(err);
      setStatus(`❌ ${err.message}`, "error");
    }
  }

  // ===========================================================
  // ⭐ Team Management
  // ===========================================================
  function toggleTeam(id) {
    id = Number(id);
    const index = currentTeam.indexOf(id);
    if (index >= 0) currentTeam.splice(index, 1);
    else if (currentTeam.length < 6) currentTeam.push(id);
    else alert("Your team can only hold 6 Pokémon.");
    renderPokemonGrid();
  }

  saveBtn.addEventListener("click", async () => {
    setStatus("Saving team...", "active");
    try {
      const res = await fetch("/api/set-pokemon-team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, token, team: currentTeam }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStatus("✅ Team updated successfully!", "success");
    } catch (err) {
      console.error(err);
      setStatus(`❌ ${err.message}`, "error");
    }
  });

  // ===========================================================
  // 🧭 Mode Switching & Shiny Toggle
  // ===========================================================
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      mode = btn.dataset.mode;
      renderPokemonGrid();
    });
  });

  const shinyToggle = document.getElementById("shinyToggle");
  if (shinyToggle) {
    shinyToggle.addEventListener("click", () => {
      shinyMode = !shinyMode;
      shinyToggle.classList.toggle("active");
      shinyToggle.textContent = shinyMode ? "✨ Shiny Mode ON" : "Shiny Mode OFF";
    });
  }

  // ===========================================================
  // 🔁 Refresh Stats Bar
  // ===========================================================
  async function refreshStats() {
    try {
      const res = await fetch(`/api/user-pokemon?id=${userId}&token=${token}`);
      const data = await res.json();
      if (data.error) return;
      
      const stoneCountEl = document.getElementById("stoneCount");
      if (stoneCountEl) stoneCountEl.textContent = data.items?.evolution_stone ?? 0;
      
      const ccCountEl = document.getElementById("ccCount");
      if (ccCountEl) ccCountEl.textContent = data.cc ?? 0;
      
      const tpCountEl = document.getElementById("tpCount");
      if (tpCountEl) tpCountEl.textContent = data.tp ?? 0;
      
      const rankLabelEl = document.getElementById("rankLabel");
      if (rankLabelEl) rankLabelEl.textContent = data.rank ?? "Novice Trainer";
    } catch (err) {
      console.error("Failed to refresh stats:", err);
    }
  }

  // ===========================================================
  // 🎉 Evolution Popup
  // ===========================================================
  function showEvolutionPopup(fromName, toName, toId, shiny = false) {
    const overlay = document.createElement("div");
    overlay.id = "evoPopupOverlay";

    const popup = document.createElement("div");
    popup.id = "evoPopup";
    if (shiny) popup.classList.add("shiny");

    const spritePath = shiny
      ? `/public/sprites/pokemon/shiny/${toId}.gif`
      : `/public/sprites/pokemon/normal/${toId}.gif`;

    popup.innerHTML = `
      <h2>${shiny ? "✨ " : ""}${fromName} evolved into ${toName}!</h2>
      <img src="${spritePath}" alt="${toName}" />
      <button id="closeEvoPopup">Continue</button>
    `;

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    document.getElementById("closeEvoPopup").addEventListener("click", () => {
      overlay.classList.add("fadeOut");
      setTimeout(() => overlay.remove(), 300);
    });
  }

  // ===========================================================
  // 💝 Donation Popup
  // ===========================================================
  function showDonationPopup(pokeName, tier, value, pokeId, shiny) {
    const overlay = document.createElement("div");
    overlay.id = "donationPopupOverlay";

    const popup = document.createElement("div");
    popup.id = "donationPopup";
    if (shiny) popup.classList.add("shiny");

    const spritePath = shiny
      ? `/public/sprites/pokemon/shiny/${pokeId}.gif`
      : `/public/sprites/pokemon/normal/${pokeId}.gif`;

    popup.innerHTML = `
      <h2>${shiny ? "✨ " : ""}You donated ${pokeName}!</h2>
      <img src="${spritePath}" alt="${pokeName}" />
      <p class="donate-msg">Professor Coop thanks you!</p>
      <p class="cc-earned">+${value.toLocaleString()} CC earned 💰</p>
      <button id="closeDonationPopup">Continue</button>
    `;

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    document.getElementById("closeDonationPopup").addEventListener("click", () => {
      overlay.classList.add("fadeOut");
      setTimeout(() => overlay.remove(), 300);
    });
  }

  // ===========================================================
  // 🚀 Init
  // ===========================================================
  init();

// ===========================================================
// 🔍 Filter Pokémon (Search / Rarity / Type)
// ===========================================================
window.filterPokemon = function () {
  const search = document.getElementById("searchInput")?.value.toLowerCase() || "";
  const rarity = document.getElementById("rarityFilter")?.value || "";
  const type = document.getElementById("typeFilter")?.value || "";
  const cards = document.querySelectorAll(".pokemon-card");

  cards.forEach((card) => {
    const name = card.querySelector(".pokemon-name")?.textContent.toLowerCase() || "";
    const tier = card.querySelector(".tier-text")?.textContent.toLowerCase() || "";
    const matchesSearch = !search || name.includes(search);
    const matchesRarity = !rarity || tier.includes(rarity);
    const matchesType = !type || card.dataset.type === type;
    card.style.display =
      matchesSearch && matchesRarity && matchesType ? "flex" : "none";
  });
};

});