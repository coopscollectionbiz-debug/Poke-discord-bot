/* ===========================================================
   Coop's Collection — Pokémon Picker (UPDATED — NO SHINY TOGGLE)
   ===========================================================
   3 Modes:
   - Change Team: Shows ALL (owned colored, unowned gray+locked)
   - Evolve: Shows ONLY owned (variant chosen in modal)
   - Donate: Shows ONLY owned (variant chosen in modal)

   ✅ Shiny toggle removed.
   ✅ Team slots are now variant-safe objects:
      [{ id: 243, variant: "normal"|"shiny" }, ...] (1–6 unique slots)
   ✅ Evolve/Donate send { variant } to backend (server blocks displayed variant).
=========================================================== */

let userId;
let userData = {};
let pokemonData = {};
let currentMode = "team"; // "team" | "evolve" | "donate"
let selectedTeam = []; // [{id:Number, variant:"normal"|"shiny"}]
let showOwnedOnly = false;
let showUnownedOnly = false;

import { rarityEmojis } from "/public/spriteconfig.js";

// ===========================================================
// 🎨 Type ID to Name Mapping (for filtering)
// ===========================================================
const TYPE_MAP = {
  1: "normal", 2: "fighting", 3: "flying", 4: "poison",
  5: "ground", 6: "rock", 7: "bug", 8: "ghost",
  9: "steel", 10: "fire", 11: "water", 12: "grass",
  13: "electric", 14: "psychic", 15: "ice", 16: "dragon",
  17: "dark", 18: "fairy"
};

// ===========================================================
// 🧠 Rank System
// ===========================================================
const RANK_TIERS = [
  { tp: 100, roleName: "Novice Trainer" },
  { tp: 500, roleName: "Junior Trainer" },
  { tp: 1000, roleName: "Skilled Trainer" },
  { tp: 2500, roleName: "Experienced Trainer" },
  { tp: 5000, roleName: "Advanced Trainer" },
  { tp: 7500, roleName: "Expert Trainer" },
  { tp: 10000, roleName: "Veteran Trainer" },
  { tp: 17500, roleName: "Elite Trainer" },
  { tp: 25000, roleName: "Master Trainer" },
  { tp: 50000, roleName: "Gym Leader" },
  { tp: 100000, roleName: "Elite Four Member" },
  { tp: 175000, roleName: "Champion" },
  { tp: 250000, roleName: "Legend" }
];

function getRankFromTP(tp) {
  let currentRank = "Novice Trainer";
  for (const tier of RANK_TIERS) {
    if (tp >= tier.tp) currentRank = tier.roleName;
  }
  return currentRank;
}

// ===========================================================
// 🧬 Evolution Costs
// ===========================================================
const COST_MAP = {
  "common-common": 1,
  "uncommon-uncommon": 2,
  "rare-rare": 3,
  "epic-epic": 4,
  "legendary-legendary": 6,
  "mythic-mythic": 8,

  "common-uncommon": 1,
  "uncommon-rare": 2,
  "rare-epic": 5,
  "epic-legendary": 8,
  "legendary-mythic": 12,

  "common-rare": 4,
  "common-epic": 8,
  "common-legendary": 12,

  "uncommon-epic": 8,
  "uncommon-legendary": 12,

  "rare-legendary": 8,
  "rare-mythic": 14,

  "epic-mythic": 12,
};

function getEvoList(p) {
  return p?.evolvesTo || p?.evolves_to || [];
}

function getEvolutionCost(base, target) {
  const key = `${base.tier}-${target.tier}`;
  return COST_MAP[key] ?? 0;
}

function minEvolutionCostFor(baseId) {
  const base = pokemonData[baseId];
  const evos = getEvoList(base);
  if (!base || !evos.length) return 0;

  let min = Infinity;
  for (const tid of evos) {
    const t = pokemonData[tid];
    if (!t) continue;
    const cost = getEvolutionCost(base, t);
    if (cost > 0) min = Math.min(min, cost);
  }
  return min === Infinity ? 0 : min;
}

function isEvolutionEligibleAnyVariant(pokeId) {
  const p = pokemonData[pokeId];
  const evos = getEvoList(p);
  if (!p || !evos.length) return false;

  const stones = userData.items?.evolution_stone ?? 0;
  const minCost = minEvolutionCostFor(pokeId);
  if (minCost <= 0) return false;

  // Must have enough stones AND own at least one variant
  const owned = ownedCounts(pokeId);
  return stones >= minCost && (owned.normal > 0 || owned.shiny > 0);
}

// ===========================================================
// 💰 Donation Values
// ===========================================================
const CC_MAP = {
  common: 250,
  uncommon: 500,
  rare: 1000,
  epic: 2500,
  legendary: 5000,
  mythic: 10000,
};

function getDonationValue(tier, isShiny) {
  const baseValue = CC_MAP[tier] ?? 0;
  return isShiny ? baseValue * 5 : baseValue;
}

// ===========================================================
// 🧠 Variant helpers (frontend)
// ===========================================================
function normVariant(v) {
  return String(v || "normal").toLowerCase() === "shiny" ? "shiny" : "normal";
}

function toTeamObj(entry) {
  if (typeof entry === "number") return { id: Number(entry), variant: "normal" };
  if (typeof entry === "string") {
    const n = Number(entry);
    return Number.isInteger(n) ? { id: n, variant: "normal" } : null;
  }
  if (entry && typeof entry === "object") {
    const pid = Number(entry.id);
    if (!Number.isInteger(pid)) return null;
    return { id: pid, variant: normVariant(entry.variant) };
  }
  return null;
}

function teamKey(slot) {
  return `${Number(slot.id)}:${normVariant(slot.variant)}`;
}

function ownsVariant(pid, variant) {
  const entry = userData.pokemon?.[pid];
  if (!entry) return false;
  return Number(entry?.[variant] ?? 0) > 0;
}

function ownedCounts(pid) {
  const entry = userData.pokemon?.[pid];
  if (!entry) return { normal: 0, shiny: 0, any: 0 };
  const normal = Number(entry.normal ?? 0);
  const shiny = Number(entry.shiny ?? 0);
  return { normal, shiny, any: normal + shiny };
}

function normalizeTeam(rawTeam) {
  const arr = Array.isArray(rawTeam) ? rawTeam : [];
  const mapped = arr.map(toTeamObj).filter(Boolean);

  // dedupe by teamKey, keep order
  const seen = new Set();
  const deduped = [];
  for (const slot of mapped) {
    const k = teamKey(slot);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(slot);
    if (deduped.length >= 6) break;
  }
  return deduped;
}

// ===========================================================
// 🌐 API Utilities (COOKIE-SESSION SAFE)
// ===========================================================
async function fetchUserData() {
  const params = new URLSearchParams({ id: userId });

  const res = await fetch(`/api/user-pokemon?${params}`, {
    credentials: "same-origin",
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to fetch user: ${res.status} ${errorText}`);
  }

  userData = await res.json();
  userData.items ??= { evolution_stone: 0 };
  userData.pokemon ??= {};
  userData.currentTeam ??= [];
  return userData;
}

async function saveTeam() {
  const body = { id: userId, team: selectedTeam };

  const res = await fetch("/api/set-pokemon-team", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Save failed: ${res.status}`);
  return data;
}

async function evolvePokemon(baseId, targetId, variant) {
  const body = { id: userId, baseId, targetId, variant: normVariant(variant) };

  const res = await fetch("/api/pokemon/evolve", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Evolve failed: ${res.status}`);
  return data;
}

async function donatePokemon(pokeId, variant) {
  const body = { id: userId, pokeId, variant: normVariant(variant) };

  const res = await fetch("/api/pokemon/donate", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Donate failed: ${res.status}`);
  return data;
}

// ===========================================================
// 🎨 HUD
// ===========================================================
function initStickyHUD() {
  const bar = document.getElementById("statsBar");
  if (!bar) return;

  window.addEventListener("scroll", () => {
    if (window.scrollY > 100) bar.classList.add("compact");
    else bar.classList.remove("compact");
  });
}

function flashCounter(id, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.setProperty("--pulse-color", color);
  el.classList.add("pulse");
  setTimeout(() => el.classList.remove("pulse"), 400);
}

function updateHUD() {
  const stones = userData.items?.evolution_stone ?? 0;
  const cc = userData.cc ?? 0;
  const tp = userData.tp ?? 0;
  const rank = getRankFromTP(tp);

  const stoneEl = document.getElementById("stoneCount");
  const ccEl = document.getElementById("ccCount");
  const tpEl = document.getElementById("tpCount");
  const rankEl = document.getElementById("rankLabel");

  if (stoneEl) stoneEl.textContent = stones;
  if (ccEl) ccEl.textContent = cc;
  if (tpEl) tpEl.textContent = tp;
  if (rankEl) rankEl.textContent = rank;
}

function refreshStats(newData, prevData) {
  const stonesBefore = prevData.items?.evolution_stone ?? 0;
  const stonesAfter = newData.items?.evolution_stone ?? 0;
  const ccBefore = prevData.cc ?? 0;
  const ccAfter = newData.cc ?? 0;

  if (stonesAfter < stonesBefore) flashCounter("stoneCount", "#ef4444");
  if (ccAfter > ccBefore) flashCounter("ccCount", "#10b981");
  if ((newData.tp ?? 0) > (prevData.tp ?? 0)) flashCounter("tpCount", "#00ff9d");

  updateHUD();
}

// ===========================================================
// 🧩 Mode Switching
// ===========================================================
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll("#modeToggle .mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  renderPokemonGrid();
  updateTeamCounter();
}

// ===========================================================
// 🌟 Toggle Buttons (Owned/Unowned only — shiny removed)
// ===========================================================
function initToggles() {
  const ownedBtn = document.getElementById("ownedToggle");
  const unownedBtn = document.getElementById("unownedToggle");

  // If your HTML still has shinyToggle, hide it safely.
  const shinyBtn = document.getElementById("shinyToggle");
  if (shinyBtn) shinyBtn.style.display = "none";

  if (ownedBtn) {
    ownedBtn.addEventListener("click", () => {
      showOwnedOnly = !showOwnedOnly;
      if (showOwnedOnly) showUnownedOnly = false;
      ownedBtn.classList.toggle("active", showOwnedOnly);
      if (unownedBtn) unownedBtn.classList.remove("active");
      renderPokemonGrid();
    });
  }

  if (unownedBtn) {
    unownedBtn.addEventListener("click", () => {
      showUnownedOnly = !showUnownedOnly;
      if (showUnownedOnly) showOwnedOnly = false;
      unownedBtn.classList.toggle("active", showUnownedOnly);
      if (ownedBtn) ownedBtn.classList.remove("active");
      renderPokemonGrid();
    });
  }
}

// ===========================================================
// ✅ Team selection helpers (variant-safe)
// ===========================================================
function findTeamIndex(pid, variant) {
  const key = `${Number(pid)}:${normVariant(variant)}`;
  return selectedTeam.findIndex((s) => teamKey(s) === key);
}

function findTeamIndexAnyVariant(pid) {
  const n = Number(pid);
  return selectedTeam.findIndex((s) => Number(s.id) === n);
}

function clampTeamTo6Unique() {
  // keep order, dedupe by key, clamp to 6
  const seen = new Set();
  const next = [];
  for (const slot of selectedTeam) {
    const k = teamKey(slot);
    if (seen.has(k)) continue;
    seen.add(k);
    next.push({ id: Number(slot.id), variant: normVariant(slot.variant) });
    if (next.length >= 6) break;
  }
  selectedTeam = next;
}

// ===========================================================
// 🎴 Pokémon Grid Renderer (UPDATED — NO SHINY TOGGLE)
// ===========================================================
function renderPokemonGrid() {
  const container = document.getElementById("pokemonGrid");
  if (!container) return;
  container.innerHTML = "";

  const searchEl = document.getElementById("search");
  const rarityEl = document.getElementById("rarityFilter");
  const typeEl = document.getElementById("typeFilter");

  const search = (searchEl?.value || "").toLowerCase().trim();
  const rarityFilter = rarityEl?.value || "";
  const typeFilter = typeEl?.value || "";

  const ids = Object.keys(pokemonData).map(Number).sort((a, b) => a - b);
  let shown = 0;

  for (const id of ids) {
    const p = pokemonData[id];
    if (!p) continue;

    const types = p.types || [];
    const name = p.name || `#${id}`;

    if (search && !name.toLowerCase().includes(search)) continue;
    if (rarityFilter && p.tier !== rarityFilter) continue;
    if (typeFilter) {
      const typeNames = types.map((tid) => TYPE_MAP[tid]).filter(Boolean);
      if (!typeNames.includes(typeFilter)) continue;
    }

    const owned = ownedCounts(id);
    const isOwnedAny = owned.any > 0;

    // Mode filtering
    if (currentMode === "evolve" || currentMode === "donate") {
      if (!isOwnedAny) continue;
    } else {
      if (showOwnedOnly && !isOwnedAny) continue;
      if (showUnownedOnly && isOwnedAny) continue;
    }

    // Lock state
    let locked = false;
    if (currentMode === "team") {
      locked = !isOwnedAny;
    } else if (currentMode === "evolve") {
      locked = !isEvolutionEligibleAnyVariant(id);
    } else if (currentMode === "donate") {
      locked = !isOwnedAny;
    }

    // Sprite path (display NORMAL art as primary; shiny indicated via count / variant selection)
    let spritePath;
    if (locked) spritePath = `/public/sprites/pokemon/grayscale/${id}.gif`;
    else spritePath = `/public/sprites/pokemon/normal/${id}.gif`;

    const card = document.createElement("div");
    card.className = `pokemon-card ${isOwnedAny ? "owned" : "unowned"}`;
    if (locked) card.classList.add("locked");
    card.dataset.id = id;

    // Selected state (any variant for this Pokémon)
    const anyTeamIndex = findTeamIndexAnyVariant(id);
    if (anyTeamIndex >= 0) card.classList.add("selected");

    const typeIcons = types
      .map(
        (typeId) =>
          `<img src="/public/sprites/types/${typeId}.png" alt="${TYPE_MAP[typeId]}" style="width: 32px; height: 32px; image-rendering: pixelated;">`
      )
      .join("");

    let badgeHTML = "";

    if (currentMode === "donate") {
      // Show best possible donation (shiny if they own shiny, else normal)
      const showShiny = owned.shiny > 0;
      const ccValue = getDonationValue(p.tier, showShiny);
      badgeHTML = `
        <div class="donate-value" style="bottom:6px; right:6px;">
          💰 ${ccValue}${showShiny ? " ✨" : ""}
        </div>`;
    }

    if (currentMode === "evolve") {
      const minCost = minEvolutionCostFor(id);
      if (minCost > 0) {
        badgeHTML = `
          <div class="evolve-cost" style="bottom:6px; right:6px; opacity:${locked ? 0.5 : 1};">
            <img src="/public/sprites/items/evolution_stone.png"
                 style="width:16px;height:16px;vertical-align:middle;image-rendering:pixelated;">
            ${minCost}
          </div>`;
      }
    }

    // Count label (show both normal and shiny counts when owned)
    let countHTML = "";
    if (owned.any > 0) {
      const parts = [];
      if (owned.normal > 0) parts.push(`x${owned.normal}`);
      if (owned.shiny > 0) parts.push(`✨x${owned.shiny}`);
      countHTML = `<div class="count-label bottom-left">${parts.join(" · ")}</div>`;
    }

    // Team badge (position in team list)
    let teamBadgeHTML = "";
    if (anyTeamIndex >= 0) {
      teamBadgeHTML = `<div class="team-badge">${anyTeamIndex + 1}</div>`;
    }

    card.innerHTML = `
      <div class="sprite-wrapper">
        <img src="${spritePath}" class="poke-sprite" alt="${name}">
        ${teamBadgeHTML}
        ${locked ? `<div class="lock-overlay"><span>🔒</span></div>` : ""}
        ${countHTML}
        ${badgeHTML}
      </div>
      <div class="pokemon-name">${name}</div>
      <div class="type-icons" style="display: flex; gap: 4px; justify-content: center; margin: 4px 0;">
        ${typeIcons}
      </div>
      <div class="pokemon-tier">
        <span class="tier-emoji">${rarityEmojis[p.tier] || ""}</span>
        <span class="tier-text ${p.tier}">${p.tier.charAt(0).toUpperCase() + p.tier.slice(1)}</span>
      </div>
    `;

    if (!locked) card.addEventListener("click", () => onPokemonClick(id));

    container.appendChild(card);
    shown++;
  }

  if (shown === 0) {
    container.innerHTML = `<p class="empty-msg">No Pokémon match your filters.</p>`;
  }
}

// ===========================================================
// 🖱️ Click Handler
// ===========================================================
function onPokemonClick(id) {
  if (currentMode === "team") toggleTeamSelection(id);
  else if (currentMode === "evolve") openEvolutionModal(id);
  else if (currentMode === "donate") openDonationModal(id);
}

// ===========================================================
// ⭐ Team Selection (UPDATED — variant choose via modal when needed)
// ===========================================================
function toggleTeamSelection(id) {
  const pid = Number(id);
  const owned = ownedCounts(pid);

  if (owned.any <= 0) return;

  // If already selected (any variant) -> remove it immediately
  const existingIdx = findTeamIndexAnyVariant(pid);
  if (existingIdx >= 0) {
    selectedTeam.splice(existingIdx, 1);
    renderPokemonGrid();
    updateTeamCounter();
    return;
  }

  // Adding new slot
  if (selectedTeam.length >= 6) {
    alert("⚠️ Team is full! Maximum 6 Pokémon.");
    return;
  }

  // If only one variant owned -> add that variant automatically
  const onlyNormal = owned.normal > 0 && owned.shiny <= 0;
  const onlyShiny = owned.shiny > 0 && owned.normal <= 0;

  if (onlyNormal) {
    selectedTeam.push({ id: pid, variant: "normal" });
    clampTeamTo6Unique();
    renderPokemonGrid();
    updateTeamCounter();
    return;
  }

  if (onlyShiny) {
    selectedTeam.push({ id: pid, variant: "shiny" });
    clampTeamTo6Unique();
    renderPokemonGrid();
    updateTeamCounter();
    return;
  }

  // Owns both -> ask which to equip
  openVariantChoiceModal({
    title: "⭐ Choose Variant for Team",
    pokeId: pid,
    onChoose: (variant) => {
      selectedTeam.push({ id: pid, variant: normVariant(variant) });
      clampTeamTo6Unique();
      renderPokemonGrid();
      updateTeamCounter();
    },
  });
}

function updateTeamCounter() {
  const counter = document.getElementById("teamCounter");
  if (counter) counter.textContent = `${selectedTeam.length}/6 selected`;
}

// ===========================================================
// 🚀 Initialization (COOKIE-SESSION SAFE)
// ===========================================================
async function init() {
  try {
    const params = new URLSearchParams(window.location.search);
    userId = params.get("id");

    if (!userId) {
      document.body.innerHTML = "<p class='error'>❌ Missing user id.</p>";
      return;
    }

    // Load Pokemon data
    const pokeRes = await fetch("/public/pokemonData.json", { credentials: "same-origin" });
    if (!pokeRes.ok) throw new Error("Pokemon data failed");
    pokemonData = await pokeRes.json();

    // Load user data (if cookie is missing, backend will 403)
    try {
      await fetchUserData();
    } catch (err) {
      document.body.innerHTML =
        "<p class='error'>❌ Session expired. Please re-open the dashboard link from Discord.</p>";
      return;
    }

    // Normalize currentTeam to [{id,variant}]
    selectedTeam = normalizeTeam(userData.currentTeam);
    clampTeamTo6Unique();

    updateHUD();
    updateTeamCounter();
    initStickyHUD();
    initToggles();
    renderPokemonGrid();

    // Filters
    document.getElementById("search")?.addEventListener("input", renderPokemonGrid);
    document.getElementById("rarityFilter")?.addEventListener("change", renderPokemonGrid);
    document.getElementById("typeFilter")?.addEventListener("change", renderPokemonGrid);

    // Mode buttons
    document.querySelectorAll("#modeToggle .mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });

    // Save button
    const saveBtn = document.getElementById("saveTeamBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        if (selectedTeam.length === 0) {
          alert("⚠️ Select at least one Pokémon!");
          return;
        }

        const previewHTML = selectedTeam
          .map((slot) => {
            const id = Number(slot.id);
            const v = normVariant(slot.variant);
            const sprite =
              v === "shiny"
                ? `/public/sprites/pokemon/shiny/${id}.gif`
                : `/public/sprites/pokemon/normal/${id}.gif`;
            return `<img src="${sprite}" style="width:64px;height:64px;image-rendering:pixelated;">`;
          })
          .join("");

        createConfirmModal({
          title: "💾 Save New Team?",
          message: `
            <div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;margin-bottom:1rem;">
              ${previewHTML}
            </div>
            Are you sure you want to save this new team?
          `,
          onConfirm: async (overlay) => {
            try {
              const res = await saveTeam();
              if (res.success) {
                const modal2 = createOverlay();
                const confirmBox = document.createElement("div");
                confirmBox.style.cssText = `
                  background: var(--card);
                  border: 2px solid var(--brand);
                  border-radius: 14px;
                  padding: 2rem;
                  text-align: center;
                  max-width: 480px;
                  width: 92%;
                `;

                const teamPreview = selectedTeam
                  .map((slot) => {
                    const id = Number(slot.id);
                    const v = normVariant(slot.variant);
                    const sprite =
                      v === "shiny"
                        ? `/public/sprites/pokemon/shiny/${id}.gif`
                        : `/public/sprites/pokemon/normal/${id}.gif`;
                    return `<img src="${sprite}" style="width:64px;height:64px;image-rendering:pixelated;">`;
                  })
                  .join("");

                confirmBox.innerHTML = `
                  <h2 style="color: var(--brand);">✅ Team Saved!</h2>
                  <p style="margin:0.5rem 0 1rem;color:#ccc;">
                    Your new team has been successfully updated.
                  </p>
                  <div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;margin-bottom:1rem;">
                    ${teamPreview}
                  </div>
                  <button style="
                    background: var(--brand);
                    color: var(--bg);
                    border: none;
                    padding: 10px 24px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 700;
                  ">OK</button>
                `;

                confirmBox.querySelector("button").addEventListener("click", () => closeOverlay(modal2));
                modal2.appendChild(confirmBox);
              }
            } catch (err) {
              alert("❌ " + err.message);
            } finally {
              closeOverlay(overlay);
            }
          },
        });
      });
    }
  } catch (err) {
    console.error("Init failed:", err);
    document.body.innerHTML = `<p class='error'>❌ ${err.message}</p>`;
  }
}

window.addEventListener("DOMContentLoaded", init);

// ===========================================================
// 🧩 Modal System
// ===========================================================
function createOverlay() {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.75);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function closeOverlay(overlay) {
  if (overlay) overlay.remove();
}

// ===========================================================
// 💾 Confirmation Modal (used for Save Team)
// ===========================================================
function createConfirmModal({ title, message, onConfirm, onCancel }) {
  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card);
    border: 2px solid var(--brand);
    border-radius: 14px;
    padding: 2rem;
    text-align: center;
    max-width: 500px;
    width: 92%;
  `;

  modal.innerHTML = `
    <h2 style="color: var(--brand); margin-bottom: 0.5rem;">${title}</h2>
    <p style="margin-bottom: 1rem; color: #ccc;">${message}</p>
    <div style="display: flex; gap: 1rem; justify-content: center;">
      <button class="cancel-btn"
        style="background: var(--border); color: white; border: none;
               padding: 10px 20px; border-radius: 8px; cursor: pointer;">
        Cancel
      </button>
      <button class="confirm-btn"
        style="background: var(--brand); color: var(--bg); border: none;
               padding: 10px 20px; border-radius: 8px; cursor: pointer;
               font-weight: 700;">
        Confirm Save
      </button>
    </div>
  `;

  modal.querySelector(".cancel-btn").addEventListener("click", () => {
    closeOverlay(overlay);
    if (onCancel) onCancel();
  });
  modal.querySelector(".confirm-btn").addEventListener("click", () => {
    if (onConfirm) onConfirm(overlay);
  });

  overlay.appendChild(modal);
}

// ===========================================================
// ⭐ Variant Choice Modal (Team / Evolve / Donate)
// ===========================================================
function openVariantChoiceModal({ title, pokeId, onChoose }) {
  const p = pokemonData[pokeId];
  if (!p) return;

  const owned = ownedCounts(pokeId);
  const overlay = createOverlay();

  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card);
    border: 2px solid var(--brand);
    border-radius: 14px;
    padding: 1.5rem 1.75rem;
    text-align: center;
    max-width: 520px;
    width: 92%;
  `;

  const normalSprite = `/public/sprites/pokemon/normal/${pokeId}.gif`;
  const shinySprite = `/public/sprites/pokemon/shiny/${pokeId}.gif`;

  const normalBtn = owned.normal > 0
    ? `<button class="pick-normal" style="background: var(--brand); color: var(--bg); border:none; padding:10px 14px; border-radius:10px; font-weight:800; cursor:pointer;">Use Normal (x${owned.normal})</button>`
    : `<button disabled style="background:#444; color:#999; border:none; padding:10px 14px; border-radius:10px; font-weight:800;">Normal (x0)</button>`;

  const shinyBtn = owned.shiny > 0
    ? `<button class="pick-shiny" style="background: #facc15; color: var(--bg); border:none; padding:10px 14px; border-radius:10px; font-weight:900; cursor:pointer;">Use Shiny (✨x${owned.shiny})</button>`
    : `<button disabled style="background:#444; color:#999; border:none; padding:10px 14px; border-radius:10px; font-weight:900;">Shiny (✨x0)</button>`;

  modal.innerHTML = `
    <h2 style="color: var(--brand); margin:0 0 0.75rem;">${title}</h2>
    <p style="color:#ccc;margin:0 0 1rem;">${p.name}</p>

    <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-bottom:1rem;">
      <div style="background:rgba(0,0,0,0.25);border:1px solid var(--border);border-radius:12px;padding:12px;min-width:180px;">
        <img src="${normalSprite}" style="width:96px;height:96px;image-rendering:pixelated;">
        <div style="margin-top:8px;">${normalBtn}</div>
      </div>

      <div style="background:rgba(0,0,0,0.25);border:1px solid var(--border);border-radius:12px;padding:12px;min-width:180px;">
        <img src="${shinySprite}" style="width:96px;height:96px;image-rendering:pixelated;">
        <div style="margin-top:8px;">${shinyBtn}</div>
      </div>
    </div>

    <button class="cancel-btn" style="background: var(--border); color: white; border: none; padding: 10px 22px; border-radius: 10px; cursor: pointer; font-weight:700;">
      Cancel
    </button>
  `;

  modal.querySelector(".cancel-btn").addEventListener("click", () => closeOverlay(overlay));

  const bn = modal.querySelector(".pick-normal");
  const bs = modal.querySelector(".pick-shiny");

  if (bn) bn.addEventListener("click", () => {
    closeOverlay(overlay);
    onChoose?.("normal");
  });
  if (bs) bs.addEventListener("click", () => {
    closeOverlay(overlay);
    onChoose?.("shiny");
  });

  overlay.appendChild(modal);
}

// ===========================================================
// 🧬 Evolution Modal (UPDATED — choose variant inside modal)
// ===========================================================
function openEvolutionModal(baseId) {
  const base = pokemonData[baseId];
  const evoList = getEvoList(base);
  if (!base || !evoList.length) return;

  const owned = ownedCounts(baseId);
  if (owned.any <= 0) return;

  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card); border: 2px solid var(--brand);
    border-radius: 14px; padding: 2rem; text-align: center;
    max-width: 640px; width: 92%;
  `;

  let chosenVariant = owned.normal > 0 ? "normal" : "shiny";

  const baseSpriteFor = (v) =>
    v === "shiny"
      ? `/public/sprites/pokemon/shiny/${baseId}.gif`
      : `/public/sprites/pokemon/normal/${baseId}.gif`;

  modal.innerHTML = `
    <h2 style="color: var(--brand);">🧬 Choose Evolution</h2>

    <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin:0.75rem 0 0.25rem;">
      <button class="variant-btn v-normal" style="padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:#fff;font-weight:800;cursor:pointer;">
        Normal (${owned.normal})
      </button>
      <button class="variant-btn v-shiny" style="padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:#fff;font-weight:900;cursor:pointer;">
        ✨ Shiny (${owned.shiny})
      </button>
    </div>

    <div style="display: flex; align-items: center; justify-content: center; gap: 1rem; margin: 0.75rem 0 1rem;">
      <img class="base-sprite" src="${baseSpriteFor(chosenVariant)}" style="width: 96px; height: 96px; image-rendering: pixelated;">
      <span style="font-size: 2rem;">➡️</span>
    </div>

    <div class="evo-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin: 1rem 0;"></div>

    <div style="display: flex; gap: 1rem; justify-content: center;">
      <button class="cancel-btn" style="background: var(--border); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">Cancel</button>
      <button class="confirm-btn" disabled style="background: var(--brand); color: var(--bg); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 700;">Evolve</button>
    </div>

    <p class="hint" style="margin-top:0.75rem;color:#aaa;font-weight:600;"></p>
  `;

  const btnNormal = modal.querySelector(".v-normal");
  const btnShiny = modal.querySelector(".v-shiny");
  const baseSpriteEl = modal.querySelector(".base-sprite");
  const hintEl = modal.querySelector(".hint");
  const grid = modal.querySelector(".evo-grid");
  const confirmBtn = modal.querySelector(".confirm-btn");

  let selectedTarget = null;

  function renderEvoTargets() {
    grid.innerHTML = "";
    selectedTarget = null;
    confirmBtn.disabled = true;

    const stones = userData.items?.evolution_stone ?? 0;

    evoList.forEach((targetId) => {
      const target = pokemonData[targetId];
      if (!target) return;

      const sprite =
        chosenVariant === "shiny"
          ? `/public/sprites/pokemon/shiny/${targetId}.gif`
          : `/public/sprites/pokemon/normal/${targetId}.gif`;

      const cost = getEvolutionCost(base, target);
      const enough = stones >= cost && cost > 0;
      const ownsThisVariant = ownsVariant(baseId, chosenVariant);
      const allowed = enough && ownsThisVariant;

      const card = document.createElement("div");
      card.className = "evo-card";
      card.style.cssText = `
        background: var(--card);
        border: 2px solid ${allowed ? "var(--border)" : "#555"};
        border-radius: 10px;
        padding: 10px;
        cursor: ${allowed ? "pointer" : "not-allowed"};
        opacity: ${allowed ? "1" : "0.5"};
        position: relative;
        user-select: none;
      `;

      card.innerHTML = `
        <img src="${sprite}" style="width:80px;height:80px;image-rendering:pixelated;">
        <div style="font-weight:600;margin-top:0.5rem;">${target.name}</div>
        <div style="color:#aaa;text-transform:capitalize;">${target.tier}</div>
        <div style="margin-top:0.5rem;color:var(--brand);font-weight:700;">
          <img src="/public/sprites/items/evolution_stone.png"
               style="width:16px;height:16px;vertical-align:middle;image-rendering:pixelated;">
          ${cost}
        </div>
      `;

      if (allowed) {
        card.addEventListener("click", () => {
          grid.querySelectorAll(".evo-card").forEach((c) => (c.style.borderColor = "var(--border)"));
          card.style.borderColor = "var(--brand)";
          selectedTarget = targetId;
          confirmBtn.disabled = false;
        });
      }

      grid.appendChild(card);
    });
  }

  function setVariantAndRender(v) {
    chosenVariant = normVariant(v);

    const isN = chosenVariant === "normal";
    btnNormal.style.borderColor = isN ? "var(--brand)" : "var(--border)";
    btnNormal.style.boxShadow = isN ? "0 0 10px #00ff9d40" : "none";
    btnShiny.style.borderColor = !isN ? "#facc15" : "var(--border)";
    btnShiny.style.boxShadow = !isN ? "0 0 10px rgba(250,204,21,0.35)" : "none";

    if (baseSpriteEl) baseSpriteEl.src = baseSpriteFor(chosenVariant);

    if (!ownsVariant(baseId, chosenVariant)) {
      hintEl.textContent = `You don’t own a ${chosenVariant} ${base.name}.`;
      hintEl.style.color = "#ef4444";
      confirmBtn.disabled = true;
    } else {
      hintEl.textContent = `Evolving ${chosenVariant === "shiny" ? "✨ shiny " : ""}${base.name}.`;
      hintEl.style.color = "#aaa";
    }

    renderEvoTargets();
  }

  if (btnNormal) {
    btnNormal.disabled = owned.normal <= 0;
    btnNormal.style.opacity = owned.normal > 0 ? "1" : "0.5";
    btnNormal.style.cursor = owned.normal > 0 ? "pointer" : "not-allowed";
    btnNormal.addEventListener("click", () => setVariantAndRender("normal"));
  }

  if (btnShiny) {
    btnShiny.disabled = owned.shiny <= 0;
    btnShiny.style.opacity = owned.shiny > 0 ? "1" : "0.5";
    btnShiny.style.cursor = owned.shiny > 0 ? "pointer" : "not-allowed";
    btnShiny.addEventListener("click", () => setVariantAndRender("shiny"));
  }

  // initial render
  setVariantAndRender(chosenVariant);

  modal.querySelector(".cancel-btn").addEventListener("click", () => closeOverlay(overlay));
  confirmBtn.addEventListener("click", async () => {
    if (!selectedTarget) return;
    await handleEvolutionConfirm(baseId, selectedTarget, chosenVariant, overlay);
  });

  overlay.appendChild(modal);
}

async function handleEvolutionConfirm(baseId, targetId, variant, overlay) {
  try {
    const base = pokemonData[baseId];
    const target = pokemonData[targetId];

    const res = await evolvePokemon(baseId, targetId, variant);
    if (!res.success) {
      alert("❌ " + (res.error || "Evolution failed"));
      closeOverlay(overlay);
      return;
    }

    // If base (same variant) was on team, remove it locally (UI convenience)
    const idx = findTeamIndex(baseId, variant);
    if (idx >= 0) selectedTeam.splice(idx, 1);

    const modal2 = createOverlay();
    const successModal = document.createElement("div");
    successModal.style.cssText = `
      background: var(--card); border: 2px solid var(--brand);
      border-radius: 14px; padding: 2rem; text-align: center;
      max-width: 420px; width: 92%;
    `;

    const targetSprite = normVariant(variant) === "shiny"
      ? `/public/sprites/pokemon/shiny/${targetId}.gif`
      : `/public/sprites/pokemon/normal/${targetId}.gif`;

    successModal.innerHTML = `
      <h2 style="color: var(--brand);">✨ Evolution Complete!</h2>
      <p>${base.name} evolved into ${target.name}!</p>
      <p style="color:#aaa;font-weight:700;margin:0.25rem 0 0.75rem;">
        Variant: ${normVariant(variant) === "shiny" ? "✨ Shiny" : "Normal"}
      </p>
      <img src="${targetSprite}" style="width: 120px; height: 120px; image-rendering: pixelated; margin: 1rem 0;">
      <button class="ok-btn" style="background: var(--brand); color: var(--bg); border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-weight: 700;">OK</button>
    `;
    successModal.querySelector(".ok-btn").addEventListener("click", () => closeOverlay(modal2));
    modal2.appendChild(successModal);

    const prev = structuredClone(userData);
    userData = await fetchUserData();

    // re-sync team from server response in case it auto-cleaned ghosts
    selectedTeam = normalizeTeam(userData.currentTeam);

    refreshStats(userData, prev);
    renderPokemonGrid();
    updateTeamCounter();
    closeOverlay(overlay);
  } catch (err) {
    alert("❌ " + err.message);
    closeOverlay(overlay);
  }
}

// ===========================================================
// 💝 Donation Modal (UPDATED — choose variant inside modal)
// ===========================================================
function openDonationModal(pokeId) {
  const p = pokemonData[pokeId];
  if (!p) return;

  const owned = ownedCounts(pokeId);
  if (owned.any <= 0) return;

  // If user owns both, ask variant first
  if (owned.normal > 0 && owned.shiny > 0) {
    openVariantChoiceModal({
      title: "💝 Donate — Choose Variant",
      pokeId,
      onChoose: (variant) => openDonationConfirmModal(pokeId, variant),
    });
    return;
  }

  const variant = owned.normal > 0 ? "normal" : "shiny";
  openDonationConfirmModal(pokeId, variant);
}

function openDonationConfirmModal(pokeId, variant) {
  const p = pokemonData[pokeId];
  if (!p) return;

  const v = normVariant(variant);
  const overlay = createOverlay();

  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card); border: 2px solid #facc15;
    border-radius: 14px; padding: 2rem; text-align: center;
    max-width: 440px; width: 92%;
  `;

  const sprite = v === "shiny"
    ? `/public/sprites/pokemon/shiny/${pokeId}.gif`
    : `/public/sprites/pokemon/normal/${pokeId}.gif`;

  const ccValue = getDonationValue(p.tier, v === "shiny");

  modal.innerHTML = `
    <h2 style="color: #facc15;">💝 Donate ${v === "shiny" ? "✨ " : ""}${p.name}?</h2>
    <img src="${sprite}" style="width: 96px; height: 96px; image-rendering: pixelated; margin: 1rem 0;">
    <p style="margin-top:-0.25rem;color:#aaa;font-weight:700;">
      Variant: ${v === "shiny" ? "✨ Shiny" : "Normal"}
    </p>
    <p>You'll receive <b style="color: #facc15;">💰 ${ccValue} CC</b></p>
    <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 1rem;">
      <button class="cancel-btn" style="background: var(--border); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">Cancel</button>
      <button class="confirm-btn" style="background: #facc15; color: var(--bg); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 700;">Confirm</button>
    </div>
  `;

  modal.querySelector(".cancel-btn").addEventListener("click", () => closeOverlay(overlay));
  modal.querySelector(".confirm-btn").addEventListener("click", async () => {
    await handleDonationConfirm(pokeId, v, overlay);
  });

  overlay.appendChild(modal);
}

async function handleDonationConfirm(pokeId, variant, overlay) {
  try {
    const p = pokemonData[pokeId];
    const v = normVariant(variant);

    const res = await donatePokemon(pokeId, v);

    if (!res.success) {
      alert("❌ " + (res.error || "Donation failed"));
      closeOverlay(overlay);
      return;
    }

    // If that exact variant was on team, remove locally
    const idx = findTeamIndex(pokeId, v);
    if (idx >= 0) selectedTeam.splice(idx, 1);

    const modal2 = createOverlay();
    const successModal = document.createElement("div");
    successModal.style.cssText = `
      background: var(--card); border: 2px solid #facc15;
      border-radius: 14px; padding: 2rem; text-align: center;
      max-width: 420px; width: 92%;
    `;

    const sprite = v === "shiny"
      ? `/public/sprites/pokemon/shiny/${pokeId}.gif`
      : `/public/sprites/pokemon/normal/${pokeId}.gif`;

    successModal.innerHTML = `
      <h2 style="color: #facc15;">💰 Donation Complete!</h2>
      <p>You donated ${v === "shiny" ? "✨ " : ""}${p.name}!</p>
      <p style="color:#aaa;font-weight:700;margin:0.25rem 0 0.75rem;">
        Variant: ${v === "shiny" ? "✨ Shiny" : "Normal"}
      </p>
      <img src="${sprite}" style="width: 96px; height: 96px; image-rendering: pixelated; margin: 1rem 0;">
      <p style="color: #facc15; font-weight: 800;">Received ${res.gainedCC} CC!</p>
      <button class="ok-btn" style="background: #facc15; color: var(--bg); border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-weight: 700;">OK</button>
    `;
    successModal.querySelector(".ok-btn").addEventListener("click", () => closeOverlay(modal2));
    modal2.appendChild(successModal);

    const prev = structuredClone(userData);
    userData = await fetchUserData();

    selectedTeam = normalizeTeam(userData.currentTeam);

    refreshStats(userData, prev);
    renderPokemonGrid();
    updateTeamCounter();
    closeOverlay(overlay);
  } catch (err) {
    alert("❌ " + err.message);
    closeOverlay(overlay);
  }
}

// ======================================================
// 🔄 NAVIGATION TABS — COOKIE SESSION (NO TOKEN IN URL)
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
      (window.location.href = `/public/picker-pokemon/?id=${encodeURIComponent(id)}`);

  if (goTrainers)
    goTrainers.onclick = () =>
      (window.location.href = `/public/picker/?id=${encodeURIComponent(id)}`);

  if (goShop)
    goShop.onclick = () =>
      (window.location.href = `/public/dashboardshop/?id=${encodeURIComponent(id)}`);
})();
