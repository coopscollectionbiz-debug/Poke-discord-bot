/* ===========================================================
   Coop's Collection — Pokémon Picker (HARDENED + NO SHINY TOGGLE)
   ===========================================================
   4 Modes:
   - Change Team: Shows ALL (owned colored, unowned gray+locked)
   - Evolve: Shows ONLY owned (variant chosen in modal)
   - Donate: Shows ONLY owned (variant chosen in modal)
   - Convert: Shows ONLY owned (convert normal -> shiny using Shiny Dust)

   ✅ Cookie-session safe (credentials: "same-origin")
   ✅ Server-authoritative after ALL mutations (refetch user)
   ✅ Unified API wrapper with consistent error handling
   ✅ Global action lock + Processing overlay integration
   ✅ Donation badge fixed (no more "shiny value" bait)
   ✅ TEAM RULE: 1 slot per Pokémon ID (no normal+shiny simultaneously)
      - Team slots are variant-safe objects: { id, variant }
      - But only ONE slot per Pokémon ID is allowed
=========================================================== */

let userId;
let userData = {};
let pokemonData = {};
// Collection modes. "browse" (default) opens a Pokémon's details; teams are
// edited on the Teams page (/public/teams/). The old "team" mode code below
// stays for the Mega hooks but has no button.
let currentMode = "browse"; // "browse" | "evolve" | "donate" | "convert"
let selectedTeam = []; // [{id:Number, variant:"normal"|"shiny"}]
let showOwnedOnly = false;
let showUnownedOnly = false;
let regionFilter = ""; // "" = every live region
let shinyOnly = false;
let regions = []; // [{ name, ids }], built once from pokemonData in init()
// Multi-select (Donate mode). In-memory only; a reload resets it, and the
// pageshow handler below resets it on a back/forward cache restore.
let multiSelectOn = false;
const multiSelected = new Set(); // Pokémon IDs
// The box tile the player tapped (docs/adr/0001): preselected in "Which one?".
let pendingCopyUid = null;

import { rarityEmojis } from "/public/spriteconfig.js";
import { getNextMondayUTC, formatCountdown } from "/public/weeklyReset.js";
import { getRegions, countOwned, countRegistered } from "/public/picker-pokemon/regions.js";
import * as bulkRules from "/public/picker-pokemon/bulkRules.js";
import { showMessage, showActionError, showExpired, showBanner, toast, EXPIRED_MESSAGE } from "/public/shared/shell.js";
import { displaySpeciesName, nameMatches } from "/public/shared/names.js";
import { scanFx } from "/public/shared/spriteFx.js";
import { openDetail } from "/public/picker-pokemon/detail.js";
import { mountCopyChoice, copiesOf, teamNames } from "/public/picker-pokemon/copyChoice.js";
import { GYM_BADGES, earnedBadgeKeys } from "/public/picker-pokemon/badges.js";

const LOCK_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>`;
const SPARKLE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>`;
const capitalize = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// ===========================================================
// 🎨 Type ID to Name Mapping (for filtering)
// ===========================================================
const TYPE_MAP = {
  1: "normal",
  2: "fighting",
  3: "flying",
  4: "poison",
  5: "ground",
  6: "rock",
  7: "bug",
  8: "ghost",
  9: "steel",
  10: "fire",
  11: "water",
  12: "grass",
  13: "electric",
  14: "psychic",
  15: "ice",
  16: "dragon",
  17: "dark",
  18: "fairy",
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
  { tp: 250000, roleName: "Legend" },
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

function tierOf(p) {
  return String(p?.tier || "common").toLowerCase().trim();
}

// Released generations (GET /api/pokedex-status). Defaults to Gens 1–5.
let releasedGenerations = new Set([1, 2, 3, 4, 5]);
async function limitToReleasedGenerations(data, owned) {
  try {
    const res = await fetch("/api/pokedex-status", { credentials: "same-origin" });
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body.liveGenerations)) releasedGenerations = new Set(body.liveGenerations.map(Number));
    }
  } catch { /* keep the safe default */ }
  const isOwned = (id) => ((owned[id]?.normal || 0) + (owned[id]?.shiny || 0)) > 0;
  const out = {};
  for (const [id, p] of Object.entries(data)) {
    if (releasedGenerations.has(Number(p.generation ?? 1)) || isOwned(id)) out[id] = p;
  }
  for (const p of Object.values(out)) {
    if (Array.isArray(p.evolvesTo)) p.evolvesTo = p.evolvesTo.filter((t) => out[t] && releasedGenerations.has(Number(out[t].generation ?? 1)));
  }
  return out;
}

function getEvoList(p) {
  return p?.evolvesTo || p?.evolves_to || [];
}

function getEvolutionCost(base, target) {
  const key = `${tierOf(base)}-${tierOf(target)}`;
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

  const owned = ownedCounts(pokeId);
  return stones >= minCost && owned.any > 0;
}

// ===========================================================
// 💰 Donation Values + Shiny Dust
// ===========================================================
const CC_MAP = {
  common: 250,
  uncommon: 500,
  rare: 1000,
  epic: 2500,
  legendary: 5000,
  mythic: 10000,
};

const SHINY_DUST_REWARD = {
  common: 4,
  uncommon: 7,
  rare: 12,
  epic: 18,
  legendary: 22,
  mythic: 30,
};

const SHINY_CRAFT_COST = {
  common: 15,
  uncommon: 25,
  rare: 40,
  epic: 60,
  legendary: 80,
  mythic: 120,
};

function dustCostForTier(tier) {
  return SHINY_CRAFT_COST[String(tier || "common").toLowerCase()] ?? 0;
}

// Used for shiny evolution discount logic
function shinyEvolveDustCost(baseTier, targetTier) {
  return Math.max(0, dustCostForTier(targetTier) - dustCostForTier(baseTier));
}

function getDonationValue(tier, isShiny) {
  const baseValue = CC_MAP[String(tier || "common").toLowerCase()] ?? 0;
  return isShiny ? baseValue * 5 : baseValue;
}

// ===========================================================
// 🧠 Variant helpers (frontend)
// ===========================================================
function normVariant(v) {
  return String(v || "normal").toLowerCase().trim() === "shiny" ? "shiny" : "normal";
}

function toTeamObj(entry) {
  if (typeof entry === "number") {
    return Number.isInteger(entry) ? { id: entry, variant: "normal" } : null;
  }
  if (typeof entry === "string") {
    const n = Number(entry);
    return Number.isInteger(n) ? { id: n, variant: "normal" } : null;
  }
  if (entry && typeof entry === "object") {
    const pid = Number(entry.id);
    if (!Number.isInteger(pid)) return null;

    // legacy compatibility: entry.shiny / entry.isShiny
    const legacyIsShiny =
      entry.variant == null && (entry.shiny === true || entry.isShiny === true);

    const slot = { id: pid, variant: legacyIsShiny ? "shiny" : normVariant(entry.variant) };
    // Mega Evolution: a slot may carry its Mega form (validated server-side).
    if (typeof entry.mega === "string" && /^mega-[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.mega)) slot.mega = entry.mega;
    return slot;
  }
  return null;
}

// Keep { id, variant } and at most ONE Mega slot (the first) — team rule.
function withMega(slot, megaTaken) {
  const out = { id: Number(slot.id), variant: normVariant(slot.variant) };
  if (slot.mega && !megaTaken.value) { out.mega = slot.mega; megaTaken.value = true; }
  return out;
}

// TEAM RULE: 1 per Pokémon ID (ignore variant for uniqueness)
function teamKey(slot) {
  return String(Number(slot.id));
}

function ownsVariant(pid, variant) {
  const entry = userData.pokemon?.[pid];
  if (!entry) return false;
  return Number(entry?.[normVariant(variant)] ?? 0) > 0;
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

  // dedupe by Pokémon ID, keep order, clamp to 6
  const seen = new Set();
  const deduped = [];
  const megaTaken = { value: false };
  for (const slot of mapped) {
    const k = teamKey(slot);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(withMega(slot, megaTaken));
    if (deduped.length >= 6) break;
  }
  return deduped;
}

// ===========================================================
// 🌐 API Utilities (COOKIE-SESSION SAFE + HARDENED)
// ===========================================================
async function apiJSON(url, opts = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...opts,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    // allow non-json
  }

  if (!res.ok) {
    const msg =
      data?.error ||
      data?.message ||
      (res.status === 403 ? EXPIRED_MESSAGE : `Request failed (${res.status})`);

    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// Global action lock + processing overlay
let actionInProgress = false;
async function withActionLock(fn) {
  if (actionInProgress) return;
  actionInProgress = true;
  window.showProcessing?.();
  try {
    return await fn();
  } finally {
    window.hideProcessing?.();
    actionInProgress = false;
  }
}

async function fetchUserData() {
  const params = new URLSearchParams({ id: userId });

  const data = await apiJSON(`/api/user-pokemon?${params}`);
  userData = data || {};

  userData.items ??= {};
  userData.items.evolution_stone ??= 0;
  userData.items.shiny_dust ??= 0;

  userData.pokemon ??= {};
  userData.currentTeam ??= [];

  return userData;
}

async function saveTeam() {
  const body = { id: userId, team: selectedTeam };
  return await apiJSON("/api/set-pokemon-team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// One request id per confirmation dialog: a double click or a retry after a
// network error sends the same id, and the server applies the action once.
// One request id per dialog AND copy choice (switching the copy is a different action).
function requestIds() {
  const ids = new Map();
  return (key) => { if (!ids.has(key)) ids.set(key, newRequestId()); return ids.get(key); };
}

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// copy: { uid, rev, confirmTrained } of the chosen copy (docs/adr/0001), or null.
// rev is sent only for a trained copy (the server checks it).
const copyFields = (copy) => (copy?.uid ? { uid: copy.uid, ...(copy.rev != null ? { rev: copy.rev } : {}), ...(copy.confirmTrained ? { confirmTrained: true } : {}) } : {});

async function evolvePokemon(baseId, targetId, variant, requestId, copy = null) {
  const body = { id: userId, baseId, targetId, variant: normVariant(variant), requestId, ...copyFields(copy) };
  return await apiJSON("/api/pokemon/evolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function donatePokemon(pokeId, variant, requestId, copy = null) {
  const body = { id: userId, pokeId, variant: normVariant(variant), requestId, ...copyFields(copy) };
  return await apiJSON("/api/pokemon/donate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function donateBulk(mode, items, requestId) {
  const body = { id: userId, mode, items, requestId };
  return await apiJSON("/api/pokemon/donate-bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function convertPokemonToShiny(pokeId, requestId, copy = null) {
  const body = { id: userId, pokeId, requestId, ...copyFields(copy) };
  return await apiJSON("/api/pokemon/convert-to-shiny", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

function updateDustTimer() {
  const el = document.getElementById("dustStatus");
  if (!el || !userData) return;
  const earned = userData.nonShinyDustEarnedThisWeek ?? 0;
  const countdown = formatCountdown(getNextMondayUTC().getTime() - Date.now());
  el.textContent = `${earned}/8 shiny dust from donations this week. Resets in ${countdown}`;
}

function updateHUD() {
  const stones = userData.items?.evolution_stone ?? 0;
  const dust = userData.items?.shiny_dust ?? 0;
  const cc = userData.cc ?? 0;
  const tp = userData.tp ?? 0;
  const rank = getRankFromTP(tp);

  const stoneEl = document.getElementById("stoneCount");
  const dustEl = document.getElementById("dustCount");
  const ccEl = document.getElementById("ccCount");
  const tpEl = document.getElementById("tpCount");
  const rankEl = document.getElementById("rankLabel");

  if (stoneEl) stoneEl.textContent = stones;
  if (dustEl) dustEl.textContent = dust;
  if (ccEl) ccEl.textContent = Number(cc).toLocaleString("en-US");
  if (tpEl) tpEl.textContent = Number(tp).toLocaleString("en-US");
  if (rankEl) rankEl.textContent = rank;

  const badgeRow = document.getElementById("badgeRow");
  if (badgeRow) {
    const earned = new Set(earnedBadgeKeys(userData));
    badgeRow.replaceChildren(...GYM_BADGES.map((b) => {
      const img = document.createElement("img");
      img.src = b.image;
      img.alt = b.badge;
      img.title = b.badge;
      img.className = earned.has(b.key) ? "earned" : "unearned";
      return img;
    }));
  }

  updateDustTimer();
}

function refreshStats(newData, prevData) {
  const stonesBefore = prevData.items?.evolution_stone ?? 0;
  const stonesAfter = newData.items?.evolution_stone ?? 0;

  const dustBefore = prevData.items?.shiny_dust ?? 0;
  const dustAfter = newData.items?.shiny_dust ?? 0;

  const ccBefore = prevData.cc ?? 0;
  const ccAfter = newData.cc ?? 0;

  if (dustAfter > dustBefore) flashCounter("dustCount", "#f5c84c");
  if (dustAfter < dustBefore) flashCounter("dustCount", "#ff5a6a");

  if (stonesAfter < stonesBefore) flashCounter("stoneCount", "#ff5a6a");
  if (ccAfter > ccBefore) flashCounter("ccCount", "#3fd46c");
  if ((newData.tp ?? 0) > (prevData.tp ?? 0)) flashCounter("tpCount", "#4f8cff");

  updateHUD();
}

// ===========================================================
// 🧩 Mode Switching
// ===========================================================
function setMode(mode) {
  currentMode = mode;

  if (mode !== "donate") {
    multiSelectOn = false;
    multiSelected.clear();
  }

  document.querySelectorAll("#modeToggle .mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
    btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode));
  });

  // Owned / missing toggles only make sense in Browse (other modes show owned only).
  const tg = document.querySelector(".toggle-group");
  if (tg) tg.style.display = "flex"; // only "✨ Shiny only" is left; it filters the box in every mode

  // Show dust cap only in donate mode
  const dustEl = document.getElementById("dustStatus");
  if (dustEl) {
    dustEl.style.display = mode === "donate" ? "block" : "none";
    if (mode === "donate") updateDustTimer();
  }

  renderPokemonGrid();
  updateTeamCounter();
  megaUI?.onModeChange?.(mode);
}

// ===========================================================
// 🗺️ Collection filters: region chips (live regions, with Pokédex counts)
// and "Shiny only". Mega forms never count: regions hold species only.
// ===========================================================
function initCollectionFilters() {
  const host = document.getElementById("regionChips");
  if (host) {
    const chip = (value, label, count) =>
      `<button type="button" class="region-chip" data-region="${value}" aria-pressed="${regionFilter === value}">${label}${count ? ` <small>${count}</small>` : ""}</button>`;
    const draw = () => {
      host.innerHTML = chip("", "All", "") + regions.map((r) => chip(r.name, r.name, `${countRegistered(r, userData.pokedex)}/${r.ids.length}`)).join("");
    };
    draw();
    host.addEventListener("click", (e) => {
      const b = e.target.closest("[data-region]");
      if (!b) return;
      regionFilter = b.dataset.region;
      draw();
      renderPokemonGrid();
    });
  }
  const shinyBtn = document.getElementById("shinyOnlyToggle");
  shinyBtn?.addEventListener("click", () => {
    shinyOnly = !shinyOnly;
    shinyBtn.setAttribute("aria-pressed", String(shinyOnly));
    shinyBtn.classList.toggle("active", shinyOnly);
    renderPokemonGrid();
  });
}

/** What the detail drawer (detail.js) may use: data and this page's existing action flows. */
function detailContext() {
  return {
    userId,
    apiJSON,
    pokemonData,
    userData,
    typeName: (tid) => TYPE_MAP[tid],
    ownedCounts,
    evolve: (id) => openEvolutionModal(id),
    donate: (id, variant) => openDonationConfirmModal(id, variant),
    convert: (id) => openConvertModal(id),
    canEvolve: (id) => isEvolutionEligibleAnyVariant(id),
  };
}

// ===========================================================
// 🌟 Toggle Buttons (Owned/Unowned only — shiny removed)
// ===========================================================
function initToggles() {
  const ownedBtn = document.getElementById("ownedToggle");
  const unownedBtn = document.getElementById("unownedToggle");

  // If HTML still has shinyToggle, hide it safely.
  const shinyBtn = document.getElementById("shinyToggle");
  if (shinyBtn) shinyBtn.style.display = "none";

  function syncPressed() {
    ownedBtn?.setAttribute("aria-pressed", String(showOwnedOnly));
    unownedBtn?.setAttribute("aria-pressed", String(showUnownedOnly));
  }

  if (ownedBtn) {
    ownedBtn.addEventListener("click", () => {
      showOwnedOnly = !showOwnedOnly;
      if (showOwnedOnly) showUnownedOnly = false;
      ownedBtn.classList.toggle("active", showOwnedOnly);
      if (unownedBtn) unownedBtn.classList.remove("active");
      syncPressed();
      renderPokemonGrid();
    });
  }

  if (unownedBtn) {
    unownedBtn.addEventListener("click", () => {
      showUnownedOnly = !showUnownedOnly;
      if (showUnownedOnly) showOwnedOnly = false;
      unownedBtn.classList.toggle("active", showUnownedOnly);
      if (ownedBtn) ownedBtn.classList.remove("active");
      syncPressed();
      renderPokemonGrid();
    });
  }

  // Default to owned active in (Change) Team mode so users don't just see a wall of grayed-out unowned Pokémon.
  if (currentMode === "team" && ownedBtn) {
    showOwnedOnly = true;
    ownedBtn.classList.add("active");
  }
  syncPressed();
}

// ===========================================================
// ✅ Team selection helpers (variant-safe, 1 per Pokémon ID)
// ===========================================================
function findTeamIndex(pid) {
  const n = Number(pid);
  return selectedTeam.findIndex((s) => Number(s.id) === n);
}

function clampTeamTo6Unique() {
  const seen = new Set();
  const next = [];
  const megaTaken = { value: false };
  for (const slot of selectedTeam) {
    const k = teamKey(slot);
    if (seen.has(k)) continue;
    seen.add(k);
    next.push(withMega(slot, megaTaken));
    if (next.length >= 6) break;
  }
  selectedTeam = next;
}

// ===========================================================
// 🎴 Pokémon Grid Renderer (HARDENED)
// ===========================================================
// ===========================================================
// ✨ Which variant each card shows (and which one actions use)
// In-memory only. Default: the Team's variant if it's on the Team,
// shiny if that's the only one owned, otherwise normal. A choice made
// with the card's toggle sticks while that variant is still owned.
// ===========================================================
const viewVariant = new Map(); // Pokémon ID -> "normal" | "shiny"

function defaultVariant(id) {
  const owned = ownedCounts(id);
  const slot = selectedTeam[findTeamIndex(id)];
  if (slot && ownsVariant(id, slot.variant)) return normVariant(slot.variant);
  return owned.shiny > 0 && owned.normal <= 0 ? "shiny" : "normal";
}

function variantShown(id) {
  const chosen = viewVariant.get(Number(id));
  return chosen && ownsVariant(id, chosen) ? chosen : defaultVariant(id);
}

function spriteFor(id, variant) {
  return `/public/sprites/pokemon/${normVariant(variant) === "shiny" ? "shiny" : "normal"}/${id}.gif`;
}

// Flip a card between its normal and shiny copy (only when both are owned).
// In Change Team mode, a Pokémon already on the Team switches its slot to
// that copy too (unsaved until Save Team, like every other Team edit).
function toggleCardVariant(id) {
  const pid = Number(id);
  const next = variantShown(pid) === "shiny" ? "normal" : "shiny";
  if (!ownsVariant(pid, next)) return;
  viewVariant.set(pid, next);
  const idx = findTeamIndex(pid);
  if (currentMode === "team" && idx >= 0) {
    // A Mega is unlocked per line (normal/shiny): it stays on the slot only
    // if the same form is unlocked on the copy switched to.
    const prev = selectedTeam[idx];
    const slot = { id: pid, variant: next };
    if (prev?.mega && megaUI?.isMegaUnlockedOn?.(pid, next, prev.mega)) slot.mega = prev.mega;
    selectedTeam[idx] = slot;
  }
  renderPokemonGrid();
  updateTeamCounter();
  megaUI?.render?.(); // the Mega section's Team line follows the edit
  // Keep keyboard focus on the toggle after the re-render.
  document.querySelector(`.pokemon-card[data-id="${pid}"] .variant-toggle`)?.focus({ preventScroll: true });
}

// Highest value among the owned variants of a species (null if none owned).
// `map` is userData.levels or userData.powers ({ "25:normal": 16 }).
function bestOwned(map, id) {
  const owned = ownedCounts(id);
  const vals = [];
  if (owned.normal > 0) vals.push(Number(map?.[`${id}:normal`]));
  if (owned.shiny > 0) vals.push(Number(map?.[`${id}:shiny`]));
  const known = vals.filter(Number.isFinite);
  return known.length ? Math.max(...known) : null;
}
const bestLevel = (id) => bestOwned(userData.levels, id);
// Power = six-stat total at Level, computed by the server with the same
// functions as /showteam's Team Power (GET /api/user-pokemon `powers`).
const bestPower = (id) => bestOwned(userData.powers, id);
const SORT_KEYS = { level: bestLevel, power: bestPower };

// Renders the grid, then the shiny backdrops (the Discord cards' motes + stars).
function renderPokemonGrid() {
  renderPokemonGridCards();
  const grid = document.getElementById("pokemonGrid");
  if (grid) scanFx(grid);
}

// ===========================================================
// 📦 The box (docs/adr/0001): one tile per copy you own right now. Every
// copy is its own Pokémon with its own Level. Tapping a tile opens the
// current mode's action with that copy preselected in "Which one?".
// ===========================================================
const boxRows = () => (Array.isArray(userData.copies) ? userData.copies : []);
// Copies out on an Expedition (Quests): shown, locked, never offered to an action.
const awayRows = () => {
  if (Number.isFinite(userData.serverNow) && !userData.serverNowApplied) { awaySkew = userData.serverNow - Date.now(); userData.serverNowApplied = true; }
  return Array.isArray(userData.awayCopies) ? userData.awayCopies : [];
};
const escAway = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
// "Returns in: 1:02:03", or a note to claim once it's back. Ticks every second (below).
let awaySkew = 0; // server clock minus this device's (set from userData.serverNow)
function returnsIn(at) {
  const secs = Math.max(0, Math.ceil((at - (Date.now() + awaySkew)) / 1000));
  if (secs === 0) return "Back! Claim it on the Quests page";
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), sec = secs % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `Returns in: ${h ? `${h}:${pad(m)}` : m}:${pad(sec)}`;
}
setInterval(() => {
  for (const t of document.querySelectorAll(".expedition-timer[data-ends]")) t.textContent = returnsIn(Number(t.dataset.ends));
}, 1000);

function boxTileLocked(c, tier) {
  if (currentMode === "evolve") return !isEvolutionEligibleAnyVariant(c.id);
  if (currentMode === "donate") return c.teams > 0;
  if (currentMode === "convert") {
    const cost = dustCostForTier(tier);
    // Converting needs Dust, a normal copy, and no shiny of it owned yet (same rule as before).
    return c.shiny || cost <= 0 || (userData.items?.shiny_dust ?? 0) < cost || ownedCounts(c.id).shiny > 0;
  }
  if (currentMode === "feed") return boxRows().filter((r) => r[1] === c.id && r[2] === (c.shiny ? 1 : 0)).length < 2;
  return false;
}

function renderBoxTiles(container) {
  const search = (document.getElementById("search")?.value || "").toLowerCase().trim();
  const rarityFilter = (document.getElementById("rarityFilter")?.value || "").toLowerCase();
  const typeFilter = (document.getElementById("typeFilter")?.value || "").toLowerCase();
  const sortOrder = document.getElementById("sortOrder")?.value || "dex";

  const tiles = [];
  const rows = [...boxRows(), ...awayRows().map((r) => [...r.slice(0, 8), { endsAt: r[8], mission: r[9] }])];
  for (const [uid, id, shiny, level, at, trained, teams, , away] of rows) {
    const p = pokemonData[id];
    if (!p) continue;
    const tier = tierOf(p);
    if (search && !nameMatches(search, id, p.storedName ?? p.name)) continue;
    if (rarityFilter && tier !== rarityFilter) continue;
    if (typeFilter && !(p.types ?? []).map((t) => TYPE_MAP[t]).includes(typeFilter)) continue;
    if (regionFilter && p.region !== regionFilter) continue;
    if (shinyOnly && !shiny) continue;
    tiles.push({ uid, id, shiny: !!shiny, level, at, trained: !!trained, teams, p, tier, away: away ?? null });
  }

  const byDex = (a, b) => a.id - b.id || b.level - a.level || a.uid.localeCompare(b.uid);
  const sorts = {
    "level-desc": (a, b) => b.level - a.level || byDex(a, b),
    "level-asc": (a, b) => a.level - b.level || byDex(a, b),
    newest: (a, b) => (b.at || 0) - (a.at || 0) || byDex(a, b),
    name: (a, b) => String(a.p.name).localeCompare(String(b.p.name)) || byDex(a, b),
    "power-desc": (a, b) => (bestPower(b.id) ?? 0) - (bestPower(a.id) ?? 0) || byDex(a, b),
    "power-asc": (a, b) => (bestPower(a.id) ?? 0) - (bestPower(b.id) ?? 0) || byDex(a, b),
  };
  tiles.sort(sorts[sortOrder] ?? byDex);

  const tile = (c) => {
    const locked = !!c.away || boxTileLocked(c, c.tier);
    const name = c.p.name || `#${c.id}`;
    const onTeams = teamNames(c.teams);
    const el = document.createElement("div");
    el.className = `pokemon-card owned box-tile${c.shiny ? " shiny-view" : ""}${locked ? " locked" : ""}${c.away ? " on-expedition" : ""}`;
    el.dataset.id = c.id;
    el.dataset.uid = c.uid;
    const stone = (src, n) => `<div class="evolve-cost" style="bottom:6px;right:6px;"><img src="${src}" style="width:16px;height:16px;vertical-align:middle;image-rendering:pixelated;" alt="">${n}</div>`;
    let badge = "";
    if (currentMode === "donate") badge = `<div class="donate-value" title="Donation value in CC"><img src="/public/sprites/items/cc_coin.png" alt="">${fmtCC(getDonationValue(c.tier, c.shiny))}</div>`;
    if (currentMode === "convert" && dustCostForTier(c.tier) > 0) badge = stone("/public/sprites/items/shiny_dust.png", dustCostForTier(c.tier));
    if (currentMode === "evolve" && minEvolutionCostFor(c.id) > 0) badge = stone("/public/sprites/items/evolution_stone.png", minEvolutionCostFor(c.id));
    const teamBadge = onTeams.length
      ? `<div class="team-badges">${onTeams.map((t) => `<span class="mem mem-${t[0].toLowerCase()}" title="On your ${t} team">${t[0]}</span>`).join("")}</div>`
      : "";
    el.innerHTML = `
      <div class="sprite-wrapper"${c.shiny ? ` data-fx="shiny" data-fx-seed="${c.id}"` : ""}>
        <img src="${spriteFor(c.id, c.shiny ? "shiny" : "normal")}" class="poke-sprite" alt="" loading="lazy">
        ${teamBadge}
        ${c.trained ? `<div class="count-label bottom-left" title="Has TM-trained moves">★ TM</div>` : ""}
        ${locked ? `<div class="lock-overlay">${LOCK_ICON}</div>` : ""}
        ${c.away ? "" : badge}
        ${c.away ? `<div class="expedition-badge" title="On an Expedition to ${escAway(c.away.mission)}">🧭 On Expedition</div>` : ""}
      </div>
      <div class="dex-no">#${String(c.id).padStart(4, "0")}</div>
      <div class="pokemon-name">${c.shiny ? "✨ " : ""}${name}</div>
      <div class="poke-levels"><span class="poke-level${c.shiny ? " shiny" : ""}">Lv ${c.level}</span></div>
      <div class="pokemon-tier"><span class="cc-tier" data-tier="${c.tier}">${capitalize(c.tier)}</span></div>
      ${c.away ? `<div class="expedition-timer" data-ends="${Number(c.away.endsAt)}" aria-live="off">${returnsIn(c.away.endsAt)}</div>` : ""}`;
    const states = [`Level ${c.level}`];
    if (c.shiny) states.push("shiny");
    if (c.trained) states.push("TM-trained");
    if (onTeams.length) states.push(`on ${onTeams.join(" and ")} team`);
    if (c.away) states.push(`on an Expedition to ${c.away.mission}, ${returnsIn(c.away.endsAt)}`);
    else if (locked) states.push("unavailable in this mode");
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.dataset.ccActivate = "1";
    el.setAttribute("aria-label", `#${c.id} ${name}, ${states.join(", ")}`);
    if (locked) el.setAttribute("aria-disabled", "true");
    el.addEventListener("click", () => (c.away ? showAway(c) : onBoxTileClick(c, locked)));
    el.querySelector(".poke-sprite").addEventListener("error", (e) => { e.currentTarget.src = "/public/sprites/items/pokeball.png"; }, { once: true });
    return el;
  };

  container.innerHTML = "";
  if (!tiles.length) {
    container.innerHTML = boxRows().length
      ? `<p class="empty-msg">No Pokémon match your filters.</p>`
      : `<p class="empty-msg">Your box is empty. Pokémon you catch land here, and everything you have ever caught stays in your <a href="/public/pokedex/?id=${encodeURIComponent(userId)}">Pokédex</a>.</p>`;
    return;
  }
  if (sortOrder !== "dex") { container.append(...tiles.map(tile)); return; }
  const byRegion = new Map();
  for (const c of tiles) {
    if (!byRegion.has(c.p.region)) byRegion.set(c.p.region, []);
    byRegion.get(c.p.region).push(c);
  }
  for (const region of regions) {
    const list = byRegion.get(region.name);
    if (!list) continue;
    const header = document.createElement("h2");
    header.className = "region-header";
    header.innerHTML = `${region.name} <span class="region-count">${list.length}<span class="sr-only"> Pokémon</span></span>`;
    container.append(header, ...list.map(tile));
  }
}

function showAway(c) {
  const name = c.p?.name || `#${c.id}`;
  showMessage({
    title: `${c.shiny ? "✨ " : ""}${name} is on an Expedition`,
    message: `Gone to ${c.away.mission}. ${returnsIn(c.away.endsAt)}. It can't be fed, evolved, donated, gifted, taught a TM or put on a Team until you claim the Expedition on the Quests page.`,
  });
}

function onBoxTileClick(c, locked) {
  pendingCopyUid = c.uid;
  viewVariant.set(c.id, c.shiny ? "shiny" : "normal");
  if (locked) {
    if (currentMode === "donate" || currentMode === "feed") {
      const msg = currentMode === "feed" && !c.teams
        ? `You need another ${c.shiny ? "shiny " : ""}${c.p.name} to feed this one.`
        : `This ${c.p.name} is on your ${teamNames(c.teams).join(" and ")} team. Take it off the team on the Teams page first.`;
      return showMessage({ title: "Not available", message: msg });
    }
    return showBlockedActionModal(c.id);
  }
  if (currentMode === "browse") return openDetail(c.id, detailContext());
  if (currentMode === "evolve") return openEvolutionModal(c.id);
  if (currentMode === "donate") return openDonationConfirmModal(c.id, c.shiny ? "shiny" : "normal");
  if (currentMode === "convert") return openConvertModal(c.id);
  if (currentMode === "feed") return openFeedModal(c);
}

// 🍖 Feed: another copy of the same Pokémon + Variant gives this one EXP
// and is used up (POST /api/pokemon/feed). The fed copy can't be on a team.
function openFeedModal(target) {
  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.style.cssText = "background:var(--card);border:2px solid var(--cc-blue);border-radius:14px;padding:1.5rem;text-align:center;max-width:460px;width:92%;";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", `Feed ${target.p.name}`);
  modal.innerHTML = `
    <h2 style="margin:0 0 6px;">Feed ${target.shiny ? "✨ " : ""}${target.p.name} (Lv ${target.level})</h2>
    <p style="margin:0;color:var(--cc-text-muted);">Give it another ${target.p.name}. The one you feed is used up and this one gains EXP. Your Pokédex keeps ${target.p.name} either way.</p>
    <div class="cc-copyslot"></div>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:12px;">
      <button class="cancel-btn cc-btn" type="button">Cancel</button>
      <button class="confirm-btn cc-btn cc-btn--primary" type="button">Feed</button>
    </div>`;
  overlay.append(modal);
  const confirmEl = modal.querySelector(".confirm-btn");
  modal.querySelector(".cancel-btn").addEventListener("click", () => closeOverlay(overlay));
  let picker = null;
  const sync = () => { confirmEl.disabled = !picker?.get().ok; };
  picker = mountCopyChoice(modal.querySelector(".cc-copyslot"), {
    userData, pokeId: target.id, variant: target.shiny ? "shiny" : "normal", name: target.p.name, mode: "feed", exclude: target.uid, onChange: sync,
  });
  sync();
  const requestId = newRequestId();
  confirmEl.addEventListener("click", () => {
    const from = picker.get();
    if (!from.ok) return;
    withActionLock(async () => {
      confirmEl.disabled = true;
      try {
        const res = await apiJSON("/api/pokemon/feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: userId, from: from.uid, to: target.uid, requestId, ...(from.rev != null ? { rev: from.rev } : {}) }),
        });
        closeOverlay(overlay);
        const prev = userData;
        await fetchUserData();
        refreshStats(userData, prev);
        renderPokemonGrid();
        const f = res?.fed;
        toast(f && f.toLevel > f.fromLevel ? `${target.p.name} grew to Lv ${f.toLevel}!` : `${target.p.name} gained ${Number(f?.gained ?? 0).toLocaleString("en-US")} EXP.`);
      } catch (err) {
        confirmEl.disabled = false;
        showActionError(err, "Couldn't feed");
      }
    });
  });
}

function renderPokemonGridCards() {
  const container = document.getElementById("pokemonGrid");
  if (!container) return;
  container.innerHTML = "";

  // Drop picks that stopped being selectable after a refresh.
  for (const pid of multiSelected) if (multiSelectBlock(pid)) multiSelected.delete(pid);
  // Runs before the box view returns: it is what shows the Donate
  // Duplicates / Multi-select row in Donate mode.
  updateBulkUI();

  // Every mode but the old team picker and Donate's multi-select is the box.
  if (currentMode !== "team" && !(currentMode === "donate" && multiSelectOn)) return renderBoxTiles(container);

  const inMultiSelect = currentMode === "donate" && multiSelectOn;

  const searchEl = document.getElementById("search");
  const rarityEl = document.getElementById("rarityFilter");
  const typeEl = document.getElementById("typeFilter");

  const search = (searchEl?.value || "").toLowerCase().trim();
  const rarityFilter = (rarityEl?.value || "").toLowerCase();
  const typeFilter = (typeEl?.value || "").toLowerCase();

  const sortOrder = document.getElementById("sortOrder")?.value || "dex";

  const ids = Object.keys(pokemonData).map(Number).sort((a, b) => a - b);
  const cardsByRegion = {};
  const sortable = []; // [{ id, card }] for the non-Pokédex sort orders
  let shown = 0;

  for (const id of ids) {
    const p = pokemonData[id];
    if (!p) continue;

    const name = p.name || `#${id}`;
    const tier = tierOf(p);
    const types = Array.isArray(p.types) ? p.types : [];

    // Matches the display name and the stored name (e.g. "Mr. Mime" and "Mr-mime").
    if (search && !nameMatches(search, id, p.storedName ?? p.name)) continue;
    if (rarityFilter && tier !== rarityFilter) continue;

    if (typeFilter) {
      const typeNames = types.map((tid) => TYPE_MAP[tid]).filter(Boolean);
      if (!typeNames.includes(typeFilter)) continue;
    }

    const owned = ownedCounts(id);
    const isOwnedAny = owned.any > 0;
    if (regionFilter && p.region !== regionFilter) continue;
    if (shinyOnly && owned.shiny <= 0) continue;

    // Mode filtering
    if (currentMode === "evolve" || currentMode === "donate" || currentMode === "convert") {
      if (!isOwnedAny) continue;
    } else {
      if (showOwnedOnly && !isOwnedAny) continue;
      if (showUnownedOnly && isOwnedAny) continue;
    }

    // Lock state (UI hint only; server is authority)
    let locked = false;

    if (currentMode === "team") {
      locked = !isOwnedAny;
    } else if (currentMode === "evolve") {
      locked = !isEvolutionEligibleAnyVariant(id);
    } else if (currentMode === "donate") {
      locked = !isOwnedAny || (inMultiSelect && multiSelectBlock(id) !== null);
    } else if (currentMode === "convert") {
      const dust = userData.items?.shiny_dust ?? 0;
      const cost = dustCostForTier(tier);
      locked = owned.normal <= 0 || owned.shiny > 0 || dust < cost || cost <= 0;
    }

    // Sprite: grayscale means "unowned" only. Owned cards show the copy
    // chosen with the toggle (shiny by default when it's the only one owned);
    // a locked owned card is dimmed instead of grayed out.
    const shownVariant = isOwnedAny ? variantShown(id) : "normal";
    const hasBoth = owned.normal > 0 && owned.shiny > 0;
    const spritePath = isOwnedAny
      ? spriteFor(id, shownVariant)
      : `/public/sprites/pokemon/grayscale/${id}.gif`;

    const card = document.createElement("div");
    card.className = `pokemon-card ${isOwnedAny ? "owned" : "unowned"}`;
    if (shownVariant === "shiny") card.classList.add("shiny-view");
    if (hasBoth) card.classList.add("has-toggle");
    if (locked) card.classList.add("locked");
    const multiPicked = inMultiSelect && multiSelected.has(id);
    if (multiPicked) card.classList.add("multi-selected");
    card.dataset.id = id;

    // Selected state + team badge
    const teamIdx = findTeamIndex(id);
    if (currentMode === "team" && teamIdx >= 0) card.classList.add("selected");

    // Type chips: text label on the type color (never color alone).
    const typeIcons = types
      .map((typeId) => TYPE_MAP[typeId])
      .filter(Boolean)
      .map((t) => `<span class="cc-type" data-type="${t}">${t}</span>`)
      .join("");

    // Badges
    let badgeHTML = "";

    // Donate badge: show accurate options (no shiny-bait)
    if (currentMode === "donate") {
      const normalVal = owned.normal > 0 ? getDonationValue(tier, false) : null;
      const shinyVal = owned.shiny > 0 ? getDonationValue(tier, true) : null;

      const coin = `<img src="/public/sprites/items/cc_coin.png" alt="">`;
      if (normalVal != null && shinyVal != null) {
        badgeHTML = `
          <div class="donate-value" title="Donation value in CC (normal · shiny)">
            ${coin}${fmtCC(normalVal)} · ✨${fmtCC(shinyVal)}
          </div>`;
      } else {
        const val = shinyVal ?? normalVal ?? 0;
        badgeHTML = `
          <div class="donate-value" title="Donation value in CC">
            ${coin}${fmtCC(val)}${shinyVal != null ? " ✨" : ""}
          </div>`;
      }
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

    if (currentMode === "convert") {
      const cost = dustCostForTier(tier);
      if (cost > 0) {
        badgeHTML = `
          <div class="evolve-cost" style="bottom:6px; right:6px; opacity:${locked ? 0.6 : 1};">
            <img src="/public/sprites/items/shiny_dust.png"
                 style="width:16px;height:16px;vertical-align:middle;image-rendering:pixelated;">
            ${cost}
          </div>`;
      }
    }

    // Count label (show both normal and shiny counts when owned)
    let countHTML = "";
    let levelHTML = "";
    if (owned.any > 0) {
      // Normal count bottom-left, shiny count bottom-right (lifted above a
      // mode badge, which also sits bottom-right).
      if (owned.normal > 0) countHTML += `<div class="count-label bottom-left" title="Normal copies">×${owned.normal}</div>`;
      if (owned.shiny > 0) {
        countHTML += `<div class="count-label shiny-count bottom-right${badgeHTML ? " lifted" : ""}" title="Shiny copies">✨×${owned.shiny}</div>`;
      }

      // Level tag per owned variant, under the name (like the battle screen)
      const lv = (variant) => userData.levels?.[`${id}:${variant}`] ?? "?";
      const tags = [];
      const viewing = (v) => (hasBoth && shownVariant === v ? " is-viewing" : "");
      if (owned.normal > 0) tags.push(`<span class="poke-level${viewing("normal")}">Lv ${lv("normal")}</span>`);
      if (owned.shiny > 0) tags.push(`<span class="poke-level shiny${viewing("shiny")}">✨ Lv ${lv("shiny")}</span>`);
      levelHTML = `<div class="poke-levels">${tags.join("")}</div>`;
      // While sorting by Power, show the number being sorted on.
      const power = sortOrder.startsWith("power") ? bestPower(id) : null;
      if (power != null) levelHTML += `<div class="poke-power" title="Power: total of all six stats at its Level (highest owned copy)">Power <b>${power.toLocaleString("en-US")}</b></div>`;
    }

    // Team badges: C = Casual team slot, R = Ranked team slot (read-only; teams are edited on the Teams page).
    const slotOf = (raw) => (Array.isArray(raw) ? raw : []).findIndex((s) => Number(s?.id) === id);
    const dIdx = slotOf(userData.currentTeam), bIdx = slotOf(userData.battleTeam);
    const teamBadgeHTML = dIdx >= 0 || bIdx >= 0
      ? `<div class="team-badges">${dIdx >= 0 ? `<span class="mem mem-d" title="Casual team, slot ${dIdx + 1}">C${dIdx + 1}</span>` : ""}${bIdx >= 0 ? `<span class="mem mem-b" title="Ranked team, slot ${bIdx + 1}">R${bIdx + 1}</span>` : ""}</div>`
      : "";

    card.innerHTML = `
      <div class="sprite-wrapper"${shownVariant === "shiny" ? ` data-fx="shiny" data-fx-seed="${id}"` : ""}>
        <img src="${spritePath}" class="poke-sprite" alt="" loading="lazy">
        ${teamBadgeHTML}
        ${
          hasBoth
            ? `<button type="button" class="variant-toggle" aria-pressed="${shownVariant === "shiny"}"
                 aria-label="${shownVariant === "shiny" ? `Showing shiny ${name}. Show normal` : `Showing normal ${name}. Show shiny`}"
                 title="${shownVariant === "shiny" ? "Shiny shown — tap for normal" : "Normal shown — tap for shiny"}">${SPARKLE_ICON}</button>`
            : ""
        }
        ${locked ? `<div class="lock-overlay">${LOCK_ICON}</div>` : ""}
        ${multiPicked ? `<div class="multi-check" aria-hidden="true">✓</div>` : ""}
        ${countHTML}
        ${badgeHTML}
      </div>
      <div class="dex-no">#${String(id).padStart(4, "0")}</div>
      <div class="pokemon-name">${name}</div>
      ${levelHTML}
      <div class="type-icons">${typeIcons}</div>
      <div class="pokemon-tier">
        <span class="cc-tier" data-tier="${tier}">${capitalize(tier)}</span>
      </div>
    `;

    // Keyboard + screen reader: the card is the control.
    const states = [];
    if (dIdx >= 0) states.push(`Casual team slot ${dIdx + 1}`);
    if (bIdx >= 0) states.push(`Ranked team slot ${bIdx + 1}`);
    if (multiPicked) states.push("selected");
    if (shownVariant === "shiny") states.push("shiny");
    if (!isOwnedAny) states.push("not owned");
    else if (locked) states.push("unavailable in this mode");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.dataset.ccActivate = "1";
    card.setAttribute("aria-label", `#${id} ${name}${states.length ? `, ${states.join(", ")}` : ""}`);
    if (locked) card.setAttribute("aria-disabled", "true");
    if (currentMode === "team" || inMultiSelect) card.setAttribute("aria-pressed", String(inMultiSelect ? multiPicked : teamIdx >= 0));

    card.addEventListener("click", () => {
      if (locked) return showBlockedActionModal(id);
      onPokemonClick(id);
    });

    // The ✨ toggle only changes the copy shown (and used); it never
    // triggers the card's own action.
    card.querySelector(".variant-toggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCardVariant(id);
    });
    // Missing shiny art never silently falls back to the normal sprite.
    card.querySelector(".poke-sprite").addEventListener("error", (e) => {
      e.currentTarget.src = "/public/sprites/items/pokeball.png";
    }, { once: true });

    (cardsByRegion[p.region] ??= []).push(card);
    sortable.push({ id, card });
    shown++;
  }

  // Level / name sorts: one flat list (region headers only make sense in Dex order).
  if (sortOrder !== "dex") {
    const byName = (a, b) => String(pokemonData[a.id].name).localeCompare(String(pokemonData[b.id].name));
    const [field, way] = sortOrder.split("-");
    if (SORT_KEYS[field]) {
      const key = SORT_KEYS[field];
      const dir = way === "desc" ? -1 : 1;
      sortable.sort((a, b) => {
        const la = key(a.id), lb = key(b.id);
        // Unowned (no Level) always last; ties fall back to Dex #.
        if (la == null || lb == null) return (la == null) - (lb == null) || a.id - b.id;
        return dir * (la - lb) || a.id - b.id;
      });
    } else if (sortOrder === "name") {
      sortable.sort(byName);
    }
    container.append(...sortable.map((s) => s.card));
    if (shown === 0) container.innerHTML = `<p class="empty-msg">No Pokémon match your filters.</p>`;
    return;
  }

  // Only regions with a visible card get a header. The count is full-region
  // Pokédex completion, so it ignores the mode and filters above.
  for (const region of regions) {
    const cards = cardsByRegion[region.name];
    if (!cards) continue;
    const header = document.createElement("h2");
    header.className = "region-header";
    header.innerHTML = `${region.name} <span class="region-count">${countRegistered(region, userData.pokedex)}/${region.ids.length}<span class="sr-only"> caught</span></span>`;
    container.append(header, ...cards);
  }

  if (shown === 0) {
    container.innerHTML = `<p class="empty-msg">No Pokémon match your filters.</p>`;
  }
}

// ===========================================================
// 🖱️ Click Handler
// ===========================================================
function onPokemonClick(id) {
  if (currentMode === "browse") openDetail(id, detailContext());
  else if (currentMode === "team") toggleTeamSelection(id);
  else if (currentMode === "evolve") openEvolutionModal(id);
  else if (currentMode === "donate") multiSelectOn ? toggleMultiSelected(id) : openDonationModal(id);
  else if (currentMode === "convert") openConvertModal(id);
}

// ===========================================================
// ⭐ Team Selection (1 per Pokémon ID, variant chosen when needed)
// ===========================================================
function toggleTeamSelection(id) {
  const pid = Number(id);
  const owned = ownedCounts(pid);
  if (owned.any <= 0) return;

  // If already selected -> remove it
  const existingIdx = findTeamIndex(pid);
  if (existingIdx >= 0) {
    selectedTeam.splice(existingIdx, 1);
    clampTeamTo6Unique();
    renderPokemonGrid();
    updateTeamCounter();
    return;
  }

  // Adding new slot
  if (selectedTeam.length >= 6) {
    toast("Your Team is full (6 Pokémon). Tap a Team member to remove it first.", { tone: "error" });
    return;
  }

  // If only one variant owned -> add automatically
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

  // Owns both -> add the copy the card is showing (chosen with its ✨ toggle).
  const variant = variantShown(pid);
  // TEAM RULE: ensure only one slot for this Pokémon
  selectedTeam = selectedTeam.filter((s) => Number(s.id) !== pid);
  selectedTeam.push({ id: pid, variant });
  viewVariant.set(pid, variant);
  clampTeamTo6Unique();
  renderPokemonGrid();
  updateTeamCounter();
}

// Team preview sprite: the Mega's sprite for a Mega slot, else the base one.
function teamSlotSprite(slot) {
  const id = Number(slot.id);
  const v = normVariant(slot.variant);
  const mega = slot.mega ? megaUI?.megaSprite?.(slot) : null;
  return mega || (v === "shiny" ? `/public/sprites/pokemon/shiny/${id}.gif` : `/public/sprites/pokemon/normal/${id}.gif`);
}

// ===========================================================
// 🧬 Mega Evolution (Phase M1) — mega.js renders nothing unless the
// server reports Mega Evolution enabled (GET /api/mega).
// ===========================================================
let megaUI = null;
async function initMegaUI() {
  try {
    const mod = await import("/public/picker-pokemon/mega.js");
    const ui = await mod.initMega({
      userId,
      apiJSON,
      withActionLock,
      createConfirmModal,
      getMode: () => currentMode,
      getTeam: () => selectedTeam, // the saved Casual team (read-only here)
      // No setTeam: teams are edited on the Teams page, so the Mega cards link there.
      refreshUser: async () => {
        await fetchUserData();
        updateHUD();
      },
    });
    megaUI = ui?.enabled ? ui : null;
  } catch (err) {
    console.warn("Mega Evolution UI unavailable:", err?.message || err);
    megaUI = null;
  }
}

function updateTeamCounter() {
  const counter = document.getElementById("teamCounter");
  if (counter) counter.textContent = `${selectedTeam.length}/6 selected`;
}

// ===========================================================
// ⏳ Weekly Pack Countdown
// ===========================================================
function startWeeklyPackCountdown() {
  const el = document.getElementById("weeklyCountdown");
  if (!el) return;

  function getNextResetUTC() {
    // Reset is Sunday 00:00 UTC
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDate = now.getUTCDate();
    const utcDay = now.getUTCDay(); // 0=Sun

    const todayMidnightUTC = new Date(Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0));
    let daysUntilSunday = (7 - utcDay) % 7;
    if (utcDay === 0 && now.getTime() >= todayMidnightUTC.getTime()) {
      daysUntilSunday = 7;
    }
    return new Date(todayMidnightUTC.getTime() + daysUntilSunday * 24 * 60 * 60 * 1000);
  }

  function fmt(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");

    return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
  }

  function tick() {
    const next = getNextResetUTC();
    const diff = next.getTime() - Date.now();
    el.textContent = diff <= 0 ? "⏳ Resetting now..." : `⏳ Resets in: ${fmt(diff)} (UTC)`;
  }

  tick();
  window.__weeklyCountdownInterval && clearInterval(window.__weeklyCountdownInterval);
  window.__weeklyCountdownInterval = setInterval(tick, 1000);
}

// ===========================================================
// 🚀 Initialization (COOKIE-SESSION SAFE)
// ===========================================================
async function init() {
  try {
    const params = new URLSearchParams(window.location.search);
    userId = params.get("id");

    if (!userId) {
      // The shell shows the "open from /dashboard" banner.
      setGridMessage("");
      return;
    }

    // Load Pokemon data
    const pokeRes = await fetch("/public/pokemonData.json", { credentials: "same-origin" });
    if (!pokeRes.ok) throw new Error("Couldn't load the Pokédex. Please refresh the page.");
    pokemonData = await pokeRes.json();
    // Display names for the 24 slug-named species (display only; the
    // stored name is kept for search and is never sent to the server).
    for (const [id, p] of Object.entries(pokemonData)) {
      p.storedName = p.name;
      p.name = displaySpeciesName(id, p.name);
    }

    // Load user data (cookie session; backend will 403 if invalid)
    try {
      await fetchUserData();
    } catch (err) {
      setGridMessage("");
      if (err?.status === 403) showExpired();
      else showBanner(err?.message || "Couldn't load your Pokémon. Please try again.", { title: "Couldn't load your Pokémon" });
      return;
    }

    // Generation controls: hide species of unreleased generations unless the
    // player already owns them, and never offer an unreleased evolution.
    pokemonData = await limitToReleasedGenerations(pokemonData, userData?.pokemon || {});
    regions = getRegions(pokemonData);

    // Normalize team to 1-per-id
    selectedTeam = normalizeTeam(userData.currentTeam);
    clampTeamTo6Unique();

    updateHUD();
    updateTeamCounter();
    initStickyHUD();
    setInterval(updateDustTimer, 30_000);
    initToggles();
    initCollectionFilters();
    setMode(currentMode);
    startWeeklyPackCountdown();
    initMegaUI(); // no-op unless Mega Evolution is enabled server-side

    // Deep link (Teams page "Open in Collection"): ?pokemon=6&variant=shiny
    // opens that Pokémon's details on that copy.
    const linked = Number(params.get("pokemon"));
    if (Number.isInteger(linked) && pokemonData[linked]) {
      openDetail(linked, detailContext(), { variant: params.get("variant") === "shiny" ? "shiny" : "normal" });
    }

    // Filters
    document.getElementById("search")?.addEventListener("input", renderPokemonGrid);
    document.getElementById("rarityFilter")?.addEventListener("change", renderPokemonGrid);
    document.getElementById("typeFilter")?.addEventListener("change", renderPokemonGrid);
    document.getElementById("sortOrder")?.addEventListener("change", renderPokemonGrid);

    // Mode buttons
    document.querySelectorAll("#modeToggle .mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });

    // Bulk donate (Donate mode)
    document.getElementById("donateDuplicatesBtn")?.addEventListener("click", openDonateDuplicatesModal);
    document.getElementById("multiSelectToggle")?.addEventListener("click", () => {
      multiSelectOn = !multiSelectOn;
      multiSelected.clear();
      renderPokemonGrid();
    });
    document.getElementById("multiSelectClear")?.addEventListener("click", () => {
      multiSelected.clear();
      renderPokemonGrid();
    });
    document.getElementById("multiSelectDonate")?.addEventListener("click", openMultiSelectDonateModal);

    // Save button (server-authoritative refetch + normalize)
    const saveBtn = document.getElementById("saveTeamBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        if (selectedTeam.length === 0) {
          toast("Select at least one Pokémon for your Team.", { tone: "error" });
          return;
        }

        const previewHTML = selectedTeam
          .map((slot) => {
            const sprite = teamSlotSprite(slot);
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
            await withActionLock(async () => {
              try {
                const prev = structuredClone(userData);

                const res = await saveTeam();
                if (!res?.success) throw new Error(res?.error || "Save failed");

                // ✅ server-authoritative refresh (handles ghost clean / normalization)
                await fetchUserData();
                selectedTeam = normalizeTeam(userData.currentTeam);
                clampTeamTo6Unique();
                megaUI?.render?.();

                refreshStats(userData, prev);
                renderPokemonGrid();
                updateTeamCounter();

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
                    const sprite = teamSlotSprite(slot);
                    return `<img src="${sprite}" style="width:64px;height:64px;image-rendering:pixelated;">`;
                  })
                  .join("");

                confirmBox.innerHTML = `
                  <h2 style="color: var(--brand);">✅ Team Saved!</h2>
                  <p style="margin:0.5rem 0 1rem;color:var(--cc-text-muted);">
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
              } catch (err) {
                showActionError(err, "Couldn't save your Team");
              } finally {
                closeOverlay(overlay);
              }
            });
          },
        });
      });
    }
  } catch (err) {
    console.error("Init failed:", err);
    setGridMessage("");
    showBanner(err?.message || "Something went wrong. Please refresh the page.", { title: "Couldn't load this page" });
  }
}

function setGridMessage(text) {
  const grid = document.getElementById("pokemonGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (text) {
    const p = document.createElement("p");
    p.className = "cc-empty";
    p.textContent = text;
    grid.append(p);
  }
}

window.addEventListener("DOMContentLoaded", init);

// Back from the Shop or Trainer page can restore this page from the
// back/forward cache with its old state. Multi-select ends when the
// player leaves the page, so turn it off on restore.
window.addEventListener("pageshow", (e) => {
  if (!e.persisted || !multiSelectOn) return;
  multiSelectOn = false;
  multiSelected.clear();
  renderPokemonGrid();
});

// ===========================================================
// 🧩 Modal System
// ===========================================================
function createOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  document.body.appendChild(overlay);
  return overlay;
}

function closeOverlay(overlay) {
  if (overlay) overlay.remove();
}

// ===========================================================
// 💾 Confirmation Modal (used for Save Team)
// ===========================================================
function createConfirmModal({ title, message, onConfirm, onCancel, confirmLabel = "Confirm Save" }) {
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
    <p style="margin-bottom: 1rem; color:var(--cc-text-muted);">${message}</p>
    <div style="display: flex; gap: 1rem; justify-content: center;">
      <button class="cancel-btn"
        style="background: var(--cc-surface-raised); color: var(--cc-text); border: none;
               padding: 10px 20px; border-radius: 8px; cursor: pointer;">
        Cancel
      </button>
      <button class="confirm-btn"
        style="background: var(--brand); color: var(--bg); border: none;
               padding: 10px 20px; border-radius: 8px; cursor: pointer;
               font-weight: 700;">
        ${confirmLabel}
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
// 🚫 Blocked Action Modal (mode-aware)
// ===========================================================
function showBlockedActionModal(pokeId) {
  const p = pokemonData[pokeId];
  if (!p) return;

  const overlay = createOverlay();

  let title = "⚠️ Action Unavailable";
  let message = "You can't do that right now.";
  let borderColor = "var(--brand)";

  const owned = ownedCounts(pokeId);
  const stones = userData.items?.evolution_stone ?? 0;

  if (currentMode === "team") {
    title = "🔒 Not Owned Yet";
    message = `You don't own ${p.name} yet.`;
    borderColor = "var(--border)";
  }

  if (currentMode === "evolve") {
    borderColor = "var(--cc-red)";
    const evos = getEvoList(p);

    if (!evos.length) {
      title = "🧬 No Evolutions";
      message = `${p.name} doesn't have an evolution in this bot yet.`;
    } else if (owned.any <= 0) {
      title = "🔒 Not Owned";
      message = `You need to own ${p.name} before evolving it.`;
    } else {
      const minCost = minEvolutionCostFor(pokeId);
      if (minCost <= 0) {
        title = "🧬 Evolution Not Available";
        message = `Evolution data for ${p.name} is missing costs right now.`;
      } else if (stones < minCost) {
        title = "🪨 Not Enough Stones";
        message = `You need at least ${minCost} evolution stones to evolve ${p.name}.\nYou currently have ${stones}.`;
      } else {
        title = "⚠️ Evolution Blocked";
        message = `You can't evolve ${p.name} right now.`;
      }
    }
  }

  if (currentMode === "donate") {
    title = "🔒 Not Owned";
    message = `You don't own ${p.name}, so you can't donate it.`;
    borderColor = "var(--cc-gold)";

    const block = multiSelectOn ? multiSelectBlock(pokeId) : null;
    if (block) ({ title, message } = block);
  }

  if (currentMode === "convert") {
    title = "✨ Convert Unavailable";
    borderColor = "var(--cc-gold)";

    const dust = userData.items?.shiny_dust ?? 0;
    const cost = dustCostForTier(tierOf(p));

    if (owned.normal <= 0) message = `You need to own a NORMAL ${p.name} to convert it.`;
    else if (owned.shiny > 0) message = `You already own a shiny ${p.name}.`;
    else if (cost <= 0) message = `Convert cost for ${tierOf(p)} is not configured.`;
    else if (dust < cost) message = `Not enough Shiny Dust.\nCost: ${cost}\nYou have: ${dust}`;
    else message = `You can't convert ${p.name} right now.`;
  }

  const sprite =
    owned.any > 0
      ? `/public/sprites/pokemon/normal/${pokeId}.gif`
      : `/public/sprites/pokemon/grayscale/${pokeId}.gif`;

  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card);
    border: 2px solid ${borderColor};
    border-radius: 14px;
    padding: 2rem;
    text-align: center;
    max-width: 460px;
    width: 92%;
  `;

  modal.innerHTML = `
    <h2 style="margin:0 0 0.75rem;color:${borderColor};">${title}</h2>
    <img src="${sprite}" style="width:96px;height:96px;image-rendering:pixelated;margin:0.5rem 0 0.75rem;">
    <p style="white-space:pre-line;color:var(--cc-text-muted);font-weight:650;margin:0 0 1.25rem;">${message}</p>
    <button class="ok-btn" style="background:${borderColor};color:var(--bg);border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-weight:800;">
      OK
    </button>
  `;

  modal.querySelector(".ok-btn").addEventListener("click", () => closeOverlay(overlay));
  overlay.appendChild(modal);
}

// ===========================================================
// ✨ Convert Modal + Confirm
// ===========================================================
function openConvertModal(pokeId) {
  const p = pokemonData[pokeId];
  if (!p) return;

  const owned = ownedCounts(pokeId);
  const t = tierOf(p);
  const cost = dustCostForTier(t);
  const dust = userData.items?.shiny_dust ?? 0;

  if (owned.normal <= 0 || owned.shiny > 0 || dust < cost || cost <= 0) {
    return showBlockedActionModal(pokeId);
  }

  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card); border: 2px solid var(--cc-gold);
    border-radius: 14px; padding: 2rem; text-align: center;
    max-width: 460px; width: 92%;
  `;

  const normalSprite = `/public/sprites/pokemon/normal/${pokeId}.gif`;
  const shinySprite = `/public/sprites/pokemon/shiny/${pokeId}.gif`;

  modal.innerHTML = `
    <h2 style="color:var(--cc-gold);">✨ Convert to Shiny?</h2>
    <p style="color:var(--cc-text-muted);font-weight:800;margin:0.25rem 0 0.75rem;">${p.name}</p>

    <div style="display:flex;gap:14px;justify-content:center;align-items:center;margin:0.75rem 0 1rem;flex-wrap:wrap;">
      <div style="padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--cc-surface-sunken);">
        <div style="color:var(--cc-text-muted);font-weight:700;margin-bottom:6px;">Normal</div>
        <img src="${normalSprite}" style="width:96px;height:96px;image-rendering:pixelated;">
      </div>

      <div style="font-size:26px;opacity:0.85;">➡️</div>

      <div style="padding:10px;border:1px solid var(--cc-gold);border-radius:12px;background:var(--cc-gold-soft);">
        <div style="color:var(--cc-gold);font-weight:900;margin-bottom:6px;">✨ Shiny</div>
        <img src="${shinySprite}" style="width:96px;height:96px;image-rendering:pixelated;">
      </div>
    </div>

    <p style="color:var(--cc-text-muted);margin:0 0 0.5rem;font-weight:800;">
      Cost: <span style="color:var(--cc-gold);font-weight:900;">${cost}</span> Shiny Dust<br>
      You have: <span style="color:var(--cc-text);font-weight:900;">${dust}</span>
    </p>

    <div class="cc-copyslot"></div>
    <div style="display:flex;gap:1rem;justify-content:center;margin-top:1rem;">
      <button class="cancel-btn" style="background: var(--cc-surface-raised); color: var(--cc-text); border: none; padding: 10px 20px; border-radius: 10px; cursor: pointer; font-weight:800;">Cancel</button>
      <button class="confirm-btn" style="background:var(--cc-gold);color:var(--bg);border:none;padding:10px 20px;border-radius:10px;cursor:pointer;font-weight:900;">Confirm</button>
    </div>
  `;

  modal.querySelector(".cancel-btn").addEventListener("click", () => closeOverlay(overlay));
  const idFor = requestIds();
  const confirmEl = modal.querySelector(".confirm-btn");
  const picker = mountCopyChoice(modal.querySelector(".cc-copyslot"), {
    userData, pokeId, variant: "normal", name: p.name, mode: "convert", preselect: pendingCopyUid,
    onChange: () => { confirmEl.disabled = !picker.get().ok; },
  });
  confirmEl.disabled = !picker.get().ok;
  confirmEl.addEventListener("click", () => {
    const copy = picker.get();
    if (!copy.ok) return;
    withActionLock(() => handleConvertConfirm(pokeId, cost, overlay, idFor(copy.uid ?? "untrained"), copy));
  });

  overlay.appendChild(modal);
}

async function handleConvertConfirm(pokeId, cost, overlay, requestId, copy = null) {
  try {
    const p = pokemonData[pokeId];

    const prev = structuredClone(userData);

    const res = await convertPokemonToShiny(pokeId, requestId, copy);
    if (!res?.success) throw new Error(res?.error || "Convert failed");

    // If this Pokémon was on the team, keep it but flip variant to shiny (optional UX)
    const idx = findTeamIndex(pokeId);
    if (idx >= 0) selectedTeam[idx].variant = "shiny";

    // ✅ authoritative refresh
    await fetchUserData();
    selectedTeam = normalizeTeam(userData.currentTeam);
    clampTeamTo6Unique();

    const modal2 = createOverlay();
    const successModal = document.createElement("div");
    successModal.style.cssText = `
      background: var(--card); border: 2px solid var(--cc-gold);
      border-radius: 14px; padding: 2rem; text-align: center;
      max-width: 420px; width: 92%;
    `;

    const shinySprite = `/public/sprites/pokemon/shiny/${pokeId}.gif`;

    successModal.innerHTML = `
      <h2 style="color:var(--cc-gold);">✨ Conversion Complete!</h2>
      <p style="color:var(--cc-text-muted);font-weight:800;margin:0.25rem 0 0.75rem;">
        ${p.name} is now shiny!
      </p>

      <img src="${shinySprite}" style="width:120px;height:120px;image-rendering:pixelated;margin:0.75rem 0 0.75rem;">

      <p style="color:var(--cc-red);font-weight:900;margin:0.25rem 0;">
        -${res.dustSpent ?? cost} Shiny Dust
      </p>

      <button class="ok-btn" style="background:var(--cc-gold);color:var(--bg);border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-weight:900;">OK</button>
    `;

    successModal.querySelector(".ok-btn").addEventListener("click", () => closeOverlay(modal2));
    modal2.appendChild(successModal);

    refreshStats(userData, prev);
    renderPokemonGrid();
    updateTeamCounter();
    closeOverlay(overlay);
  } catch (err) {
    closeOverlay(overlay);
    showActionError(err, "Couldn't convert");
    return;
    closeOverlay(overlay);
  }
}

// ===========================================================
// 🧬 Evolution Modal (variant inside modal)
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

  // Start on the copy the card shows (its ✨ toggle); the modal can still switch.
  let chosenVariant = variantShown(baseId);

  const baseSpriteFor = (v) =>
    v === "shiny"
      ? `/public/sprites/pokemon/shiny/${baseId}.gif`
      : `/public/sprites/pokemon/normal/${baseId}.gif`;

  modal.innerHTML = `
    <h2 style="color: var(--brand);">🧬 Choose Evolution</h2>

    <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin:0.75rem 0 0.25rem;">
      <button class="variant-btn v-normal" style="padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--cc-text);font-weight:800;cursor:pointer;">
        Normal (${owned.normal})
      </button>
      <button class="variant-btn v-shiny" style="padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--cc-text);font-weight:900;cursor:pointer;">
        ✨ Shiny (${owned.shiny})
      </button>
    </div>

    <div style="display: flex; align-items: center; justify-content: center; gap: 1rem; margin: 0.75rem 0 1rem;">
      <img class="base-sprite" src="${baseSpriteFor(chosenVariant)}" style="width: 96px; height: 96px; image-rendering: pixelated;">
      <span style="font-size: 2rem;">➡️</span>
    </div>

    <div class="evo-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr)); gap: 1rem; margin: 1rem 0;"></div>

    <div style="display: flex; gap: 1rem; justify-content: center;">
      <button class="cancel-btn" style="background: var(--cc-surface-raised); color: var(--cc-text); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">Cancel</button>
      <button class="confirm-btn" disabled style="background: var(--brand); color: var(--bg); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 700;">Evolve</button>
    </div>

    <p class="hint" style="margin-top:0.75rem;color:var(--cc-text-muted);font-weight:600;"></p>
  `;

  const btnNormal = modal.querySelector(".v-normal");
  const btnShiny = modal.querySelector(".v-shiny");
  const baseSpriteEl = modal.querySelector(".base-sprite");
  const hintEl = modal.querySelector(".hint");
  const grid = modal.querySelector(".evo-grid");
  const confirmBtn = modal.querySelector(".confirm-btn");

  let selectedTarget = null;
  const evoRequestIds = new Map();
  let picker = { needed: false, get: () => ({ ok: true, uid: null }) };
  const requestIdFor = (targetId, v, uid) => {
    const k = `${targetId}:${v}:${uid ?? "untrained"}`;
    if (!evoRequestIds.has(k)) evoRequestIds.set(k, newRequestId());
    return evoRequestIds.get(k);
  };

  function selectTarget(card, targetId) {
    grid.querySelectorAll(".evo-card").forEach((c) => (c.style.borderColor = "var(--border)"));
    card.style.borderColor = "var(--brand)";
    selectedTarget = targetId;
    confirmBtn.disabled = false;
  }

  function renderEvoTargets() {
    grid.innerHTML = "";
    selectedTarget = null;
    confirmBtn.disabled = true;
    const choices = [];

    const stones = userData.items?.evolution_stone ?? 0;
    const dust = userData.items?.shiny_dust ?? 0;

    evoList.forEach((targetId) => {
      const target = pokemonData[targetId];
      if (!target) return;

      const sprite =
        chosenVariant === "shiny"
          ? `/public/sprites/pokemon/shiny/${targetId}.gif`
          : `/public/sprites/pokemon/normal/${targetId}.gif`;

      const stoneCost = getEvolutionCost(base, target);
      const enoughStones = stones >= stoneCost && stoneCost > 0;

      // shiny dust only when evolving shiny variant
      const dustReq =
        chosenVariant === "shiny" ? shinyEvolveDustCost(tierOf(base), tierOf(target)) : 0;

      const enoughDust = dust >= dustReq;
      const ownsThisVariant = ownsVariant(baseId, chosenVariant);

      const allowed = enoughStones && ownsThisVariant && enoughDust;

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

      const dustRow =
        chosenVariant === "shiny" && dustReq > 0
          ? `
            <div style="margin-top:6px;color:var(--cc-gold);font-weight:900;">
              <img src="/public/sprites/items/shiny_dust.png"
                   style="width:16px;height:16px;vertical-align:middle;image-rendering:pixelated;">
              ${dustReq}
              <span style="color:var(--cc-text-muted);font-weight:800;">(you have ${dust})</span>
            </div>
          `
          : "";

      card.innerHTML = `
        <img src="${sprite}" style="width:80px;height:80px;image-rendering:pixelated;">
        <div style="font-weight:600;margin-top:0.5rem;">${target.name}</div>
        <div style="color:var(--cc-text-muted);text-transform:capitalize;">${tierOf(target)}</div>

        <div style="margin-top:0.5rem;color:var(--brand);font-weight:800;">
          <img src="/public/sprites/items/evolution_stone.png"
               style="width:16px;height:16px;vertical-align:middle;image-rendering:pixelated;">
          ${stoneCost}
          <span style="color:var(--cc-text-muted);font-weight:800;">(you have ${stones})</span>
        </div>

        ${dustRow}
      `;

      if (allowed) {
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.dataset.ccActivate = "1";
        card.setAttribute("aria-label", `Evolve into ${target.name}`);
        card.addEventListener("click", () => selectTarget(card, targetId));
        choices.push([card, targetId]);
      }

      grid.appendChild(card);
    });

    // Only one evolution, and it's affordable: select it so Evolve is one tap.
    if (grid.children.length === 1 && choices.length === 1) selectTarget(...choices[0]);
  }

  function setVariantAndRender(v) {
    chosenVariant = normVariant(v);

    const isN = chosenVariant === "normal";
    btnNormal.style.borderColor = isN ? "var(--brand)" : "var(--border)";
    btnNormal.style.boxShadow = isN ? "0 0 10px #4f8cff55" : "none";
    btnShiny.style.borderColor = !isN ? "var(--cc-gold)" : "var(--border)";
    btnShiny.style.boxShadow = !isN ? "0 0 10px var(--cc-gold-soft)" : "none";

    if (baseSpriteEl) baseSpriteEl.src = baseSpriteFor(chosenVariant);

    if (!ownsVariant(baseId, chosenVariant)) {
      hintEl.textContent = `You don't own a ${chosenVariant} ${base.name}.`;
      hintEl.style.color = "var(--cc-red)";
      confirmBtn.disabled = true;
    } else {
      hintEl.textContent = `Evolving ${chosenVariant === "shiny" ? "✨ shiny " : ""}${base.name}.`;
      hintEl.style.color = "#aaa";
    }

    renderEvoTargets();
    // TM system (T5): which copy evolves, when this variant has trained copies.
    let slot = modal.querySelector(".cc-copyslot");
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "cc-copyslot";
      confirmBtn.parentElement.before(slot);
    }
    picker = ownsVariant(baseId, chosenVariant)
      ? mountCopyChoice(slot, { userData, pokeId: baseId, variant: chosenVariant, name: base.name, mode: "evolve", preselect: pendingCopyUid })
      : mountCopyChoice(slot, { userData, pokeId: -1, variant: chosenVariant, name: base.name, mode: "evolve" });
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

  setVariantAndRender(chosenVariant);

  modal.querySelector(".cancel-btn").addEventListener("click", () => closeOverlay(overlay));
  confirmBtn.addEventListener("click", () => {
    if (!selectedTarget) return;
    const copy = picker.get();
    if (!copy.ok) { hintEl.textContent = copy.reason; hintEl.style.color = "var(--cc-red)"; return; }
    withActionLock(() => handleEvolutionConfirm(baseId, selectedTarget, chosenVariant, overlay, requestIdFor(selectedTarget, chosenVariant, copy.uid), copy));
  });

  overlay.appendChild(modal);
}

async function handleEvolutionConfirm(baseId, targetId, variant, overlay, requestId, copy = null) {
  try {
    const base = pokemonData[baseId];
    const target = pokemonData[targetId];

    const prev = structuredClone(userData);

    const res = await evolvePokemon(baseId, targetId, variant, requestId, copy);
    if (!res?.success) throw new Error(res?.error || "Evolution failed");

    // If this Pokémon was on team, remove it (UI convenience)
    const idx = findTeamIndex(baseId);
    if (idx >= 0) selectedTeam.splice(idx, 1);

    const modal2 = createOverlay();
    const successModal = document.createElement("div");
    successModal.style.cssText = `
      background: var(--card); border: 2px solid var(--brand);
      border-radius: 14px; padding: 2rem; text-align: center;
      max-width: 420px; width: 92%;
    `;

    const targetSprite =
      normVariant(variant) === "shiny"
        ? `/public/sprites/pokemon/shiny/${targetId}.gif`
        : `/public/sprites/pokemon/normal/${targetId}.gif`;

    successModal.innerHTML = `
      <h2 style="color: var(--brand);">✨ Evolution Complete!</h2>
      <p>${base.name} evolved into ${target.name}!</p>
      <p style="color:var(--cc-text-muted);font-weight:700;margin:0.25rem 0 0.75rem;">
        Variant: ${normVariant(variant) === "shiny" ? "✨ Shiny" : "Normal"}
      </p>
      <img src="${targetSprite}" style="width: 120px; height: 120px; image-rendering: pixelated; margin: 1rem 0;">
      <button class="ok-btn" style="background: var(--brand); color: var(--bg); border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-weight: 700;">OK</button>
    `;

    successModal.querySelector(".ok-btn").addEventListener("click", () => closeOverlay(modal2));
    modal2.appendChild(successModal);

    // ✅ authoritative refresh
    await fetchUserData();
    selectedTeam = normalizeTeam(userData.currentTeam);
    clampTeamTo6Unique();

    refreshStats(userData, prev);
    renderPokemonGrid();
    updateTeamCounter();
    closeOverlay(overlay);
  } catch (err) {
    closeOverlay(overlay);
    showActionError(err, "Couldn't evolve");
    return;
    closeOverlay(overlay);
  }
}

// ===========================================================
// 💝 Donation Modal (variant chosen if both)
// ===========================================================
function openDonationModal(pokeId) {
  const p = pokemonData[pokeId];
  if (!p) return;

  const owned = ownedCounts(pokeId);
  if (owned.any <= 0) return;

  // Donate the copy the card shows (its ✨ toggle). The confirm dialog
  // names the variant and shows its sprite before anything is sent.
  openDonationConfirmModal(pokeId, variantShown(pokeId));
}

function openDonationConfirmModal(pokeId, variant) {
  const p = pokemonData[pokeId];
  if (!p) return;

  const v = normVariant(variant);
  const overlay = createOverlay();

  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card); border: 2px solid var(--cc-gold);
    border-radius: 14px; padding: 2rem; text-align: center;
    max-width: 440px; width: 92%;
  `;

  const sprite =
    v === "shiny"
      ? `/public/sprites/pokemon/shiny/${pokeId}.gif`
      : `/public/sprites/pokemon/normal/${pokeId}.gif`;

  const ccValue = getDonationValue(tierOf(p), v === "shiny");
  const dustPreview =
    v === "shiny" ? SHINY_DUST_REWARD[String(tierOf(p)).toLowerCase()] ?? 0 : 0;

  modal.innerHTML = `
    <h2 style="color: var(--cc-gold);">💝 Donate ${v === "shiny" ? "✨ " : ""}${p.name}?</h2>
    <img src="${sprite}" style="width: 96px; height: 96px; image-rendering: pixelated; margin: 1rem 0;">
    <p style="margin-top:-0.25rem;color:var(--cc-text-muted);font-weight:700;">
      Variant: ${v === "shiny" ? "✨ Shiny" : "Normal"}
    </p>
    ${ownedCounts(pokeId).normal > 0 && ownedCounts(pokeId).shiny > 0 ? `<p style="color:var(--cc-text-faint);font-size:0.85rem;margin-top:-0.25rem;">You own both. To donate the ${v === "shiny" ? "normal" : "shiny"} one instead, cancel and tap ✨ on the card.</p>` : ""}
    <p>You'll receive <b style="color: var(--cc-gold);">💰 ${ccValue} CC</b></p>
    ${
      dustPreview > 0
        ? `<p style="color:var(--cc-gold);font-weight:900;margin-top:-6px;">✨ +${dustPreview} Shiny Dust</p>`
        : ""
    }
    <div class="cc-copyslot"></div>
    <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 1rem;">
      <button class="cancel-btn" style="background: var(--cc-surface-raised); color: var(--cc-text); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">Cancel</button>
      <button class="confirm-btn" style="background: var(--cc-gold); color: var(--bg); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 700;">Confirm</button>
    </div>
  `;

  const cancelEl = modal.querySelector(".cancel-btn");
  cancelEl.addEventListener("click", () => closeOverlay(overlay));
  const idFor = requestIds();
  const confirmEl = modal.querySelector(".confirm-btn");
  // TM system (T5): which copy, and the TM warning for a trained one (D-T10).
  const syncButtons = () => {
    const c = picker.get();
    confirmEl.disabled = !c.ok;
    confirmEl.style.opacity = c.ok ? "1" : "0.5";
    confirmEl.textContent = c.copy?.trained ? `Donate trained ${p.name}` : "Confirm";
    cancelEl.textContent = c.copy?.trained ? "Keep it" : "Cancel";
  };
  const picker = mountCopyChoice(modal.querySelector(".cc-copyslot"), {
    userData, pokeId, variant: v, name: p.name, mode: "donate", onChange: syncButtons, preselect: pendingCopyUid,
  });
  syncButtons();
  confirmEl.addEventListener("click", () => {
    const copy = picker.get();
    if (!copy.ok) return;
    withActionLock(() => handleDonationConfirm(pokeId, v, overlay, idFor(copy.uid ?? "untrained"), copy));
  });

  overlay.appendChild(modal);
}

async function handleDonationConfirm(pokeId, variant, overlay, requestId, copy = null) {
  try {
    const p = pokemonData[pokeId];
    const v = normVariant(variant);

    const prev = structuredClone(userData);

    const res = await donatePokemon(pokeId, v, requestId, copy);
    if (!res?.success) throw new Error(res?.error || "Donation failed");

    // If this Pokémon is on team, remove it (since counts changed)
    const idx = findTeamIndex(pokeId);
    if (idx >= 0) selectedTeam.splice(idx, 1);

    const modal2 = createOverlay();
    const successModal = document.createElement("div");
    successModal.style.cssText = `
      background: var(--card); border: 2px solid var(--cc-gold);
      border-radius: 14px; padding: 2rem; text-align: center;
      max-width: 420px; width: 92%;
    `;

    const sprite =
      v === "shiny"
        ? `/public/sprites/pokemon/shiny/${pokeId}.gif`
        : `/public/sprites/pokemon/normal/${pokeId}.gif`;

    successModal.innerHTML = `
      <h2 style="color: var(--cc-gold);">💰 Donation Complete!</h2>
      <p>You donated ${v === "shiny" ? "✨ " : ""}${p.name}!</p>
      <p style="color:var(--cc-text-muted);font-weight:700;margin:0.25rem 0 0.75rem;">
        Variant: ${v === "shiny" ? "✨ Shiny" : "Normal"}
      </p>
      <img src="${sprite}" style="width: 96px; height: 96px; image-rendering: pixelated; margin: 1rem 0;">
      <p style="color: var(--cc-gold); font-weight: 800;">Received ${res.gainedCC} CC!</p>

      ${
        (res.shinyDustGained ?? 0) > 0
          ? `<p style="color:var(--cc-gold);font-weight:900;">✨ +${res.shinyDustGained} Shiny Dust</p>`
          : ""
      }

      <button class="ok-btn" style="
        background: var(--cc-gold);
        color: var(--bg);
        border: none;
        padding: 10px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 700;
      ">OK</button>
    `;

    successModal.querySelector(".ok-btn").addEventListener("click", () => closeOverlay(modal2));
    modal2.appendChild(successModal);

    // ✅ authoritative refresh
    await fetchUserData();
    selectedTeam = normalizeTeam(userData.currentTeam);
    clampTeamTo6Unique();

    refreshStats(userData, prev);
    renderPokemonGrid();
    updateTeamCounter();
    closeOverlay(overlay);
  } catch (err) {
    closeOverlay(overlay);
    showActionError(err, "Couldn't donate");
    return;
    closeOverlay(overlay);
  }
}

// ===========================================================
// 🧹 Bulk Donate — Donate Duplicates + Multi-select
// Server re-checks every row (utils/bulkDonate.js); these are UI hints.
// ===========================================================

// Rules live in bulkRules.js (tested); these bind them to page state.
function onlyVariant(pid) {
  return bulkRules.onlyVariant(userData.pokemon, pid);
}

function duplicateRows() {
  return bulkRules.duplicateRows(userData.pokemon, pokemonData, userData.trained, userData.copies);
}

function multiSelectRows() {
  return [...multiSelected].map((pid) => ({ pokeId: pid, variant: onlyVariant(pid), count: 1 }));
}

// The server checks the SAVED Team. selectedTeam also holds unsaved
// Change Team edits, so it can't be used for these locks.
function multiSelectBlock(pid) {
  const savedTeam = (userData.currentTeam || []).map(toTeamObj).filter(Boolean);
  return bulkRules.multiSelectBlock(pid, { pokemon: userData.pokemon, pokemonData, savedTeam, trained: userData.trained });
}

function bulkTotals(rows) {
  let cc = 0;
  let dust = 0;
  let copies = 0;
  for (const r of rows) {
    const tier = tierOf(pokemonData[r.pokeId]);
    const shiny = r.variant === "shiny";
    cc += getDonationValue(tier, shiny) * r.count;
    // Only shiny dust is guaranteed; random dust from normals is a surprise on the result.
    if (shiny) dust += (SHINY_DUST_REWARD[tier] ?? 0) * r.count;
    copies += r.count;
  }
  return { cc, dust, copies };
}

const fmtCC = (n) => Number(n || 0).toLocaleString("en-US");

// Called from renderPokemonGrid, which runs after every state change.
function updateBulkUI() {
  const row = document.getElementById("bulkDonateRow");
  if (row) row.style.display = currentMode === "donate" ? "flex" : "none";

  const dupBtn = document.getElementById("donateDuplicatesBtn");
  if (dupBtn) {
    const { copies } = bulkTotals(duplicateRows());
    dupBtn.textContent = `Donate Duplicates (${copies})`;
    dupBtn.disabled = copies === 0;
  }

  const toggle = document.getElementById("multiSelectToggle");
  if (toggle) {
    toggle.classList.toggle("active", multiSelectOn);
    toggle.setAttribute("aria-pressed", String(multiSelectOn));
  }

  const bar = document.getElementById("multiSelectBar");
  if (bar) bar.style.display = multiSelectOn ? "flex" : "none";
  document.body.classList.toggle("multi-select-on", multiSelectOn);

  const summary = document.getElementById("multiSelectSummary");
  if (summary) {
    const { cc } = bulkTotals(multiSelectRows());
    summary.textContent = `${multiSelected.size} selected · ${fmtCC(cc)} CC`;
  }
  const donateBtn = document.getElementById("multiSelectDonate");
  if (donateBtn) donateBtn.disabled = multiSelected.size === 0;
}

function toggleMultiSelected(id) {
  const pid = Number(id);
  if (multiSelected.has(pid)) multiSelected.delete(pid);
  else multiSelected.add(pid);
  renderPokemonGrid();
}

function openDonateDuplicatesModal() {
  const rows = duplicateRows();
  if (!rows.length) return;
  const pickable = rows.some((r) => r.copies);
  openBulkConfirmModal({
    mode: "duplicates",
    rows,
    title: (picked) => {
      const { copies } = bulkTotals(picked);
      return `🧹 Donate ${copies} duplicate${copies === 1 ? "" : "s"}?`;
    },
    subtitle: pickable
      ? "You'll keep your best copy of each, plus anything on a team or with TM moves. Tap a Pokémon to keep it too."
      : "You'll keep your best copy of each, plus anything on a team or with TM moves.",
  });
}

function openMultiSelectDonateModal() {
  const rows = multiSelectRows();
  if (!rows.length) return;
  openBulkConfirmModal({
    mode: "multiselect",
    rows,
    title: `💝 Donate ${rows.length} Pokémon?`,
    subtitle: rows.length === 1 ? "This is your only copy." : "These are your only copies.",
  });
}

// Rows that name their copies (Donate Duplicates) show one tile per copy
// with its Level; tapping a tile keeps that copy. `title` may be a function
// of the rows still picked.
function openBulkConfirmModal({ mode, rows, title, subtitle }) {
  const perCopy = rows.some((r) => r.copies);
  const picked = new Set(rows.flatMap((r) => r.uids ?? []));
  const current = () => (perCopy ? bulkRules.pickedRows(rows, picked) : rows);
  const titleText = () => (typeof title === "function" ? title(current()) : title);
  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card); border: 2px solid var(--cc-gold);
    border-radius: 14px; padding: 1.5rem; text-align: center;
    max-width: 560px; width: 92%; max-height: 90vh;
    display: flex; flex-direction: column;
  `;

  const sprite = (r, name) =>
    `<img src="/public/sprites/pokemon/${r.variant === "shiny" ? "shiny" : "normal"}/${r.pokeId}.gif" alt="${name}">`;
  const tiles = rows
    .map((r) => {
      const name = pokemonData[r.pokeId]?.name || `#${r.pokeId}`;
      const shiny = r.variant === "shiny";
      if (!r.copies) {
        return `
        <div class="bulk-tile${shiny ? " shiny" : ""}">
          ${sprite(r, name)}
          <div class="bulk-tile-name">${name}</div>
          <div class="bulk-tile-count">${shiny ? "✨ " : ""}−${r.count}</div>
        </div>`;
      }
      return r.copies
        .map((c) => `
        <button type="button" class="bulk-tile bulk-copy${shiny ? " shiny" : ""}" data-uid="${c.uid}" aria-pressed="true"
          aria-label="${shiny ? "Shiny " : ""}${name}, Level ${c.level}">
          ${sprite(r, name)}
          <div class="bulk-tile-name">${shiny ? "✨ " : ""}${name}</div>
          <div class="bulk-tile-level">Lv ${c.level}</div>
          <div class="bulk-tile-count"></div>
        </button>`)
        .join("");
    })
    .join("");

  modal.innerHTML = `
    <h2 class="bulk-title" style="color:var(--cc-gold);margin:0 0 0.25rem;"></h2>
    <p style="color:var(--cc-text-muted);margin:0 0 0.75rem;font-weight:600;">${subtitle}</p>
    <div class="bulk-grid">${tiles}</div>
    <p class="bulk-cc" style="color:var(--cc-gold);font-weight:800;margin:0.75rem 0 0;"></p>
    <p class="bulk-dust" style="color:var(--cc-gold);font-weight:900;margin:0.25rem 0 0;"></p>
    <div style="display:flex;gap:1rem;justify-content:center;margin-top:1rem;">
      <button class="cancel-btn" style="background: var(--cc-surface-raised); color: var(--cc-text); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">Cancel</button>
      <button class="confirm-btn" style="background: var(--cc-gold); color: var(--bg); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 700;">Confirm</button>
    </div>
  `;

  const confirmBtn = modal.querySelector(".confirm-btn");
  const update = () => {
    const now = current();
    const { cc, dust, copies } = bulkTotals(now);
    modal.querySelector(".bulk-title").textContent = titleText();
    modal.querySelector(".bulk-cc").textContent = `💰 +${fmtCC(cc)} CC`;
    const dustEl = modal.querySelector(".bulk-dust");
    dustEl.textContent = dust > 0 ? `✨ +${dust} Shiny Dust` : "";
    dustEl.style.display = dust > 0 ? "" : "none";
    confirmBtn.disabled = copies === 0;
    confirmBtn.style.opacity = copies === 0 ? "0.45" : "";
    modal.querySelectorAll(".bulk-copy").forEach((el) => {
      const on = picked.has(el.dataset.uid);
      el.setAttribute("aria-pressed", String(on));
      el.classList.toggle("kept", !on);
      el.querySelector(".bulk-tile-count").textContent = on ? "Donate" : "Keep";
    });
  };
  modal.querySelectorAll(".bulk-copy").forEach((el) =>
    el.addEventListener("click", () => {
      const uid = el.dataset.uid;
      if (picked.has(uid)) picked.delete(uid);
      else picked.add(uid);
      update();
    })
  );
  update();

  modal.querySelector(".cancel-btn").addEventListener("click", () => closeOverlay(overlay));
  // One id per payload: unticking a copy changes the request, so it gets a
  // new id instead of conflicting with an earlier attempt.
  const ids = new Map();
  confirmBtn.addEventListener("click", () => {
    // Send only what the server reads; the copy list is for this dialog.
    const send = current().map(({ copies, ...r }) => r);
    if (!send.length) return;
    const key = JSON.stringify(send);
    if (!ids.has(key)) ids.set(key, newRequestId());
    withActionLock(() => handleBulkDonate(mode, send, overlay, ids.get(key)));
  });

  overlay.appendChild(modal);
}

async function handleBulkDonate(mode, rows, overlay, requestId) {
  const prev = structuredClone(userData);
  let res;

  try {
    res = await donateBulk(mode, rows, requestId);
    if (!res?.success) throw new Error(res?.error || "Donation failed");
  } catch (err) {
    closeOverlay(overlay);
    await refreshAfterBulk(prev);
    // err.status means the server answered and rejected the whole batch.
    // No status means the request may never have arrived, or arrived and
    // the reply was lost, so don't claim nothing happened.
    return err?.status
      ? showBulkErrorModal("Nothing was donated.", err.message)
      : showBulkErrorModal(
          "Couldn't reach the server.",
          "Your collection has been refreshed. Check it before trying again."
        );
  }

  closeOverlay(overlay);
  if (mode === "multiselect") multiSelected.clear();
  showBulkResultModal(res);
  await refreshAfterBulk(prev);
}

// Server-authoritative refresh, same steps as the single-donate flow.
async function refreshAfterBulk(prev) {
  try {
    await fetchUserData();
    selectedTeam = normalizeTeam(userData.currentTeam);
    clampTeamTo6Unique();
    refreshStats(userData, prev);
    renderPokemonGrid();
    updateTeamCounter();
  } catch (err) {
    console.error("refreshAfterBulk failed:", err);
  }
}

function showBulkResultModal(res) {
  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card); border: 2px solid var(--cc-gold);
    border-radius: 14px; padding: 2rem; text-align: center;
    max-width: 420px; width: 92%;
  `;

  modal.innerHTML = `
    <h2 style="color: var(--cc-gold);">💰 Donation Complete!</h2>
    <p>You donated ${res.donatedCopies} Pokémon for ${fmtCC(res.gainedCC)} CC.</p>
    ${
      (res.shinyDustGained ?? 0) > 0
        ? `<p style="color:var(--cc-gold);font-weight:900;">✨ +${res.shinyDustGained} Shiny Dust</p>`
        : ""
    }
    <button class="ok-btn" style="background: var(--cc-gold); color: var(--bg); border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-weight: 700;">OK</button>
  `;

  modal.querySelector(".ok-btn").addEventListener("click", () => closeOverlay(overlay));
  overlay.appendChild(modal);
}

function showBulkErrorModal(title, message) {
  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: var(--card); border: 2px solid var(--cc-red);
    border-radius: 14px; padding: 2rem; text-align: center;
    max-width: 420px; width: 92%;
  `;

  const h2 = document.createElement("h2");
  h2.style.cssText = "color:var(--cc-red);margin:0 0 0.75rem;";
  h2.textContent = title;

  const p = document.createElement("p");
  p.style.cssText = "color:var(--cc-text-muted);font-weight:650;margin:0 0 1.25rem;";
  p.textContent = message; // server text: keep it out of innerHTML

  const ok = document.createElement("button");
  ok.textContent = "OK";
  ok.style.cssText =
    "background:var(--cc-red);color:var(--bg);border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-weight:800;";
  ok.addEventListener("click", () => closeOverlay(overlay));

  modal.append(h2, p, ok);
  overlay.appendChild(modal);
}

// Navigation lives in /public/shared/shell.js (real links with ?id=).
