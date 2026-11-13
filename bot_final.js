// ==========================================================
// 🤖 Coop’s Collection Discord Bot
// ==========================================================
// Includes:
//  • Rank Buffs & Weighted Acquisition
//  • Shiny Pokémon Logic (applies to all acquisitions)
//  • Epic+ & Shiny Broadcast via broadcastReward
//  • Passive Message / Reaction Rewards (deterministic reward architecture)
//  • PokéBeach News (every 2 hours, link-only posting)
//  • Autosave / Graceful Shutdown / Express Health Endpoint
// ==========================================================

import { pokemonSpriteUrl } from "./utils/sprites.js";
import { liveGenerations } from "./utils/speciesCatalog.js";
import { MAX_DEX } from "./config/generations.js";
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");
import fs from "fs/promises";
import * as fsSync from "fs";
import fetch from "node-fetch";

import {
  Client,
  GatewayIntentBits,
  Collection,
  AttachmentBuilder,
  EmbedBuilder,
} from "discord.js";
import { REST, Routes } from "discord.js";
import dotenv from "dotenv";
dotenv.config();
import { getPokemonDataCached } from "./utils/pokemonDataCache.js";
import crypto from "crypto";

// 🌐 EXPRESS — canonical static setup
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { getPokemonCached } from "./utils/pokemonCache.js";
import { bulkDonate, donateOne } from "./utils/bulkDonate.js";
import { pruneEmptyLine, normalizeCustomPokemon, carryCopyUids, trainedSummary } from "./services/ownership.js";
import { normalizeBox, allCopies, slotsHolding, mergeDex } from "./services/box.js";
import { normalizeShowcase, prepareShowcaseSelection } from "./services/showcaseTeam.js";

// Compact per-copy rows for the dashboard (see the /api/user payload).
const TEAM_BIT = { displayedPokemon: 1, battleTeam: 2, showcaseTeam: 4 };
function copyRows(u) {
  return allCopies(u).map((c) => [
    c.uid, c.id, c.variant === "shiny" ? 1 : 0, c.level, c.at ?? 0, c.trained ? 1 : 0,
    slotsHolding(u, c.uid).reduce((m, s) => m | (TEAM_BIT[s.field] ?? 0), 0),
    c.exp, // exact EXP: Donate Duplicates keeps the same best copy the server does
  ]);
}

// Local saver — writes trainerData.json (in TRAINERDATA_DIR) & marks dirty
import {
  enqueueSave,
  shutdownFlush,
  saveTrainerDataLocal,
  requireLoadBeforeWrite,
  markLoaded,
  getDirtyVersion,
  isWriteBlocked,
  fenceWrites,
  getSaveHealth,
} from "./utils/saveQueue.js";
import { readLocalCandidates, readFileCandidate, setSeqAtLeast, nextSeq, dataDir, getEpoch, setEpoch, getSeq } from "./persistence/localStore.js";
import { fetchDiscordCandidates, fetchDiscordMessageCandidate, uploadBackup, verifyUpload, newestChannelEpoch, listBackupPage } from "./persistence/discordBackups.js";
import { runDexBackfill, readState as readDexScanState, writeState as writeDexScanState } from "./services/dexBackfill.js";
import { loadBestSnapshot, describe as describeSnapshot } from "./persistence/loader.js";
import { normalizeTrainers, auditTrainerData, grantTrainer } from "./services/assets.js";
import { getQuantity, grantItem, consumeItem, consumeItems, normalizeInventory, runInventoryTransaction, REQUEST_ID_PATTERN } from "./services/inventory.js";
import { handleInventoryRequest } from "./services/inventoryApi.js";
import { tmShopView, buyTms } from "./services/tmShop.js";
import { auraView, equipAura, buyAura, auraArtDir, normalizeAuras, syncTierAuras } from "./services/auras.js";
import { trainerTier } from "./utils/render/trainerTier.js";
import { teachOptions, teachTm } from "./services/tmTeaching.js";
import { createGameplayHandlers } from "./services/gameplay.js";
import { normalizeProgression, retroEvaluate, trackProgress } from "./progression/achievements.js";
import { createAchievementHandlers } from "./services/achievementsApi.js";
import { createMegaHandlers } from "./services/megaApi.js";
import { createHeldItemHandlers } from "./services/heldItemsApi.js";
import { normalizeEquipment, reconcileTeamEquipment, equipmentRev } from "./services/heldItems.js";
import { normalizeMegaUnlocks } from "./services/megaUnlocks.js";
import { normalizeDisplayedTeam, prepareTeamSelection } from "./services/megaTeam.js";
import { normalizeBattleTeam, prepareBattleTeamSelection, hasBattleTeam } from "./services/battleTeam.js";
import { normalizeNotices, peekNotices, clearNotices, NOTICE_KINDS } from "./services/notices.js";
import { consolidateUserTrainers } from "./services/trainerConsolidation.js";
import { pokemonDetail } from "./services/pokemonDetail.js";
import { parseTeamCopy, applyTeamCopy } from "./services/teamCopy.js";
import { rankBattleRatings } from "./commands/leaderboard.js";
import { rankedRecord } from "./utils/battle/rewards.js";
import { saveMoveset, TEAM_TYPES } from "./services/movesets.js";
import { generateToken, validateToken, getChannelIdForToken, requireDashboardSession, requireAdminSession, adminSessionOf, activateAdminSession, activateDashboardSession, ADMIN_MAX_MS, DASHBOARD_MAX_MS, pruneExpiredTokens } from "./utils/dashboardAuth.js";
import { rarityColors } from "./utils/rarityPalette.js";

import {
  normVariant,
  toTeamObj,
  isDisplayedVariant,
  tierKey,
  DONATION_CC_BY_TIER,
  DUST_REWARD_BY_TIER,
  SHINY_CRAFT_COST_BY_TIER,
  craftCostForTier,
  shinyEvolveDustCost,
  NON_SHINY_DUST_WEEKLY_CAP,
  getISOWeekKeyUTC,
  ensureWeeklyReset,
} from "./utils/economyRules.js";

import { saveAndAck, SAVE_DELAYED_NOTE, saveAckFields, promptSave } from "./utils/saveManager.js";
import { liveEffects, loadLiveEvents } from "./services/liveEvents.js";
import { playerView, createOptInHandler, postDueAnnouncements } from "./services/liveEventsPlayer.js";
import { discountedPrice, scaleChance, hasCatchEffects } from "./utils/liveEventRules.js";

// Nothing may be written to disk until player data has been loaded.
requireLoadBeforeWrite();

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
  // do NOT exit; avoid login loops / temp bans
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  // do NOT exit; if you want, set a flag and let your health watchdog decide later
});


let isSaving = false;

function withTimeout(promise, ms, label = "op") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

//Save stuck failsafe
setInterval(() => {
  if (isSaving) {
    console.warn("⚠️ isSaving stuck — forcing unlock (failsafe)");
    isSaving = false;
  }
}, 5 * 60 * 1000);


// (variant helpers, tier constants and dust/craft costs moved to
// utils/economyRules.js so route handlers can be tested; values unchanged)

// ==========================================================
// ✨ NON-SHINY → DUST (Probability Rolls by Tier)
// - Used when donating NORMAL variants for Shiny Dust
// - Each entry is an independent roll (can stack)
// ==========================================================
const NON_SHINY_DUST_CHANCE_BY_TIER = {
  common: [
    { chance: 0.97, dust: 0 },
    { chance: 0.03, dust: 1 },        // EV = 0.03
  ],

  uncommon: [
    { chance: 0.94, dust: 0 },
    { chance: 0.06, dust: 1 },        // EV = 0.06
  ],

  rare: [
    { chance: 0.88, dust: 0 },
    { chance: 0.10, dust: 1 },
    { chance: 0.02, dust: 2 },        // EV = 0.14
  ],

  epic: [
    { chance: 0.70, dust: 0 },
    { chance: 0.22, dust: 1 },
    { chance: 0.08, dust: 2 },        // EV = 0.38
  ],

  legendary: [
    { chance: 0.65, dust: 0 },
    { chance: 0.25, dust: 2 },
    { chance: 0.10, dust: 3 },        // EV = 0.80
  ],

  mythic: [
    { chance: 0.53, dust: 0 },
    { chance: 0.35, dust: 3 },
    { chance: 0.12, dust: 5 },        // EV = 1.65
  ],
};

// ==========================================================
// 🎲 Weighted Roll Helper (used by donate API)
// ==========================================================
// Donation rewards (single + bulk share one table; utils/bulkDonate.js).
function donationEconomy() {
  return {
    ccByTier: DONATION_CC_BY_TIER,
    shinyDustByTier: DUST_REWARD_BY_TIER,
    normalDustChanceByTier: NON_SHINY_DUST_CHANCE_BY_TIER,
    normalDustWeeklyCap: NON_SHINY_DUST_WEEKLY_CAP,
    rollDust: rollWeightedDust,
  };
}

function rollWeightedDust(table = []) {
  let r = Math.random();
  for (const entry of table) {
    r -= Number(entry.chance) || 0;
    if (r <= 0) return Number(entry.dust) || 0;
  }
  return 0; // safety fallback
}

// ----- item helpers: thin wrappers over services/inventory.js (Release B) -----
// Same semantics as before for valid amounts; zero/negative amounts are a
// no-op (as before), and a refused grant is logged instead of corrupting data.
function getItem(user, key) {
  return getQuantity(user, key);
}
function addItem(user, key, amount) {
  const add = Math.floor(Number(amount) || 0);
  if (add <= 0) return getQuantity(user, key);
  const r = grantItem(user, key, add);
  if (!r.ok) console.warn(`⚠️ addItem(${key}, ${add}) refused: ${r.error}`);
  return getQuantity(user, key);
}
function spendItem(user, key, amount) {
  const cost = Math.floor(Number(amount) || 0);
  if (cost <= 0) return true;
  return consumeItem(user, key, cost).ok;
}

// (craftCostForTier, shinyEvolveDustCost, weekly dust cap and
// ensureWeeklyReset moved to utils/economyRules.js; Release B qualification)

const COMMAND_TIMEOUT_MS = 25_000;

// ==========================================================
// 🧵 ROLE UPDATE QUEUE (reduces REST spam)
// - Coalesces many TP changes into one role update per user.
// - Only hits REST when rank actually changes.
// ==========================================================
const ROLE_FLUSH_INTERVAL_MS = 3000; // flush every 3s
const MEMBER_CACHE_TTL_MS = 60_000;  // reuse fetched members for 60s

const pendingRoleUpdates = new Map(); // userId -> { guildId, channel, tp }
const memberCache = new Map();        // key `${guildId}:${userId}` -> { member, ts }

async function getMemberCached(guild, userId) {
  const key = `${guild.id}:${userId}`;
  const cached = memberCache.get(key);
  const now = Date.now();

  if (cached && now - cached.ts < MEMBER_CACHE_TTL_MS) {
    return cached.member;
  }

  // Prefer cache first (no REST)
  let member = guild.members.cache.get(userId);
  if (!member) {
    // This is REST — but now it happens at most once per TTL per user
    member = await guild.members.fetch(userId);
  }

  memberCache.set(key, { member, ts: now });
  return member;
}

function queueRoleUpdate({ guild, userId, tp, channel }) {
  if (!guild || !userId) return;
  const existing = pendingRoleUpdates.get(userId);

  // Keep the latest TP and most recent channel ref
  pendingRoleUpdates.set(userId, {
    guildId: guild.id,
    guild,
    userId,
    tp,
    channel: channel || existing?.channel || null,
  });
}

// Flush loop (logic + readiness guard live in utils/passiveChat.js).
// Closures read isReady/trainerData lazily, so their later declaration is fine.
setInterval(
  createRoleFlush({
    isReady: () => isReady,
    pending: pendingRoleUpdates,
    getTrainerData: () => trainerData,
    getRank,
    getMember: getMemberCached,
    updateUserRole,
  }),
  ROLE_FLUSH_INTERVAL_MS
);

// ==========================================================
// 🔧 SCHEMA NORMALIZATION
// ==========================================================
function normalizeUserSchema(id, user) {

  if (!user || typeof user !== "object") user = {};

  // ==========================================================
  // 1️⃣ CORE FIELDS
  // ==========================================================
  user.id = user.id || id;

  user.tp = Number.isFinite(user.tp) ? user.tp : 0;
  user.cc = Number.isFinite(user.cc) ? user.cc : 0;

  // ==========================================================
  // 2️⃣ POKÉMON INVENTORY (must be { id: {normal, shiny} })
  // ==========================================================
  if (!user.pokemon || typeof user.pokemon !== "object" || Array.isArray(user.pokemon)) {
    user.pokemon = {};
  }

  // Repair individual Pokémon entries
  for (const [pid, entry] of Object.entries(user.pokemon)) {
    if (!entry || typeof entry !== "object") {
      user.pokemon[pid] = { normal: 0, shiny: 0 };
      continue;
    }
    entry.normal = Number.isFinite(entry.normal) ? entry.normal : 0;
    entry.shiny = Number.isFinite(entry.shiny) ? entry.shiny : 0;

    // Auto-delete empty shells (never a line that still has a customized
    // copy record: services/ownership.js)
    pruneEmptyLine(user, pid);
  }

  // ==========================================================
  // 3️⃣ TRAINERS (array of filenames)
  // backwards compatible with old object maps
  // ==========================================================
  // Shared with utils/userSchema.js so every path produces the same shape:
  // strings only, trimmed, de-duplicated; legacy object maps become arrays.
  normalizeTrainers(user);
  // Generation consolidation: folded game versions (twins-gen3…) become their
  // group's sprite (twins.png), granted if not already owned; displayed
  // trainer follows; one notice (services/trainerConsolidation.js). No-op once done.
  consolidateUserTrainers(user);

  // ==========================================================
// 4️⃣ DISPLAYED TEAM (canonical)
// NEW FORMAT: [{ id: Number, variant: "normal"|"shiny" }]
// Backwards compatible with legacy [Number, Number, ...]
// ==========================================================
// Mega Evolution (Phase M1): repair megaUnlocks first (no-op for players
// without it), then normalize the team. services/megaTeam.js holds the same
// team code that used to be inline here, plus keeping a valid Mega slot.
// TM system (T1): customized-copy records first (quarantine, invariant I-1),
// so the team normalizers below keep only valid copy uids. No-op without them.
normalizeAuras(user); // Auras: repairs auras if present…
syncTierAuras(user); // …and stores the tier Aura of every Epic+ trainer owned (the launch backfill; a no-op after)
normalizeCustomPokemon(user);
normalizeMegaUnlocks(user);
normalizeDisplayedTeam(user);
// Battle team (ranked/wager): same cleaning; never created here (missing = not set).
// Also trims a team that went over the one-mythic limit after a re-tier and
// stores a one-time notice (services/battleTeam.js trimBattleTeamMythics).
normalizeNotices(user);
normalizeBattleTeam(user);
// Individual copies + Pokédex (services/box.js, docs/adr/0001): migrates
// counts into copies on first run, reconciles after a rollback, and points
// every team slot at one specific copy.
normalizeBox(user);
// Showcase team (services/showcaseTeam.js): filled once from the Casual team
// at launch; afterwards each slot keeps its own copy.
normalizeShowcase(user);
// Held items: team equipment follows the cleaned teams (assignments of
// Pokémon no longer on a team, Mega slots and unowned items are dropped;
// unlocks are never touched). Never creates the field.
normalizeEquipment(user);


  // ==========================================================
  // 5️⃣ DISPLAYED TRAINER
  // ==========================================================
  if (typeof user.displayedTrainer !== "string") {
    user.displayedTrainer = null;
  } else {
    user.displayedTrainer = user.displayedTrainer.trim();
    if (!user.trainers.includes(user.displayedTrainer)) {
      // user no longer owns this trainer → unequip
      user.displayedTrainer = null;
    }
  }

  // ==========================================================
  // 6️⃣ DATE FIELDS (daily, recruit, quest, weeklyPack)
  // ==========================================================
  user.lastDaily =
    typeof user.lastDaily === "number" || typeof user.lastDaily === "string"
      ? user.lastDaily
      : 0;

  user.lastRecruit =
    typeof user.lastRecruit === "number" ? user.lastRecruit : 0;

  user.lastQuest =
    typeof user.lastQuest === "number" ? user.lastQuest : 0;

  // weeklyPack: deprecated field kept for safe rollout
  if (user.lastWeeklyPack === undefined) user.lastWeeklyPack = null;
  // weeklyPack: claimed flag (reset by ensureWeeklyReset)
  user.weeklyPackClaimed = !!user.weeklyPackClaimed;

  // ==========================================================
  // 7️⃣ ONBOARDING FLOW
  // ==========================================================
  user.onboardingComplete = !!user.onboardingComplete;
  user.onboardingDate =
    typeof user.onboardingDate === "string" || typeof user.onboardingDate === "number"
      ? user.onboardingDate
      : null;

  user.starterPokemon =
    typeof user.starterPokemon === "number" ||
    typeof user.starterPokemon === "string" ||
    user.starterPokemon === null
      ? user.starterPokemon
      : null;

  // ==========================================================
// 8️⃣ ITEMS (future-safe map)
// ==========================================================
// Release B: shared, idempotent normalizer. Same result as before for valid
// data (non-negative integers, evolution_stone always present), but values
// that can't be kept are recorded in user.itemsLegacy instead of being
// silently deleted.
normalizeInventory(user);
// Release C: achievement fields (idempotent; invalid values set aside).
normalizeProgression(user);

// ==========================================================
// 🧾 NON-SHINY DUST WEEKLY CAP TRACKING (normalize + roll week)
// ==========================================================
ensureWeeklyReset(user);

  // ==========================================================
  // 9️⃣ PURCHASES
  // ==========================================================
  if (!Array.isArray(user.purchases)) {
    user.purchases = [];
  }

  // ==========================================================
  // 🔟 LUCK SYSTEM
  // ==========================================================
  user.luck = Number.isFinite(user.luck) ? user.luck : 0;
  user.luckTimestamp = Number.isFinite(user.luckTimestamp)
    ? user.luckTimestamp
    : 0;

  return user;
}


// ==========================================================
// 🔒 PER-USER WRITE LOCK MANAGER (Option A)
// Prevents lost Pokémon, lost Trainers, and overwrite collisions
// ==========================================================

import { lockUser } from "./utils/userLocks.js";
import { createMessageHandler, createRoleFlush } from "./utils/passiveChat.js";
import { createEncounterService, isEncounterButton } from "./utils/encounter/service.js";
import { grantCatch, levelsForUser } from "./utils/training.js";
import { refundAllPending } from "./utils/battle/wager.js";
import { closeAllRematches } from "./utils/battle/rematch.js";
import { finishAllOpenRuns, challengeLogEntry, hideOpenRun, challengeProgress } from "./utils/challenge/runChallenge.js";
import { recordFight, challengeRecord } from "./utils/fightRecordBuild.js";
import { fightRecords } from "./utils/fightRecords.js";
import { createFightRecordHandlers } from "./services/fightRecordsApi.js";
import { showRunResult, challengeNames } from "./utils/battle/playback.js";
import { powersFromLevels } from "./utils/battle/power.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const staticPath = path.join(__dirname, "public");

// 🌐 Cookie Parser
import cookieParser from "cookie-parser";
app.use(cookieParser());

const isProd = process.env.NODE_ENV === "production";

app.get("/auth/dashboard", (req, res) => {
  const { id, code } = req.query;

  if (!id || !code) return res.status(400).send("Missing id/code");
  // expectedType "dashboard" prevents admin tokens from being burned
  // on the player flow, and vice versa below.
  if (!validateToken(id, code, "dashboard")) return res.status(403).send("Invalid or expired link.");
  // From here the session slides (30 min after each use, 4 h at most).
  activateDashboardSession(code);

  res.cookie("dashboard_session", code, {
    httpOnly: true,
    secure: isProd,
    sameSite: "Lax",
    path: "/",
    maxAge: DASHBOARD_MAX_MS,
  });

  res.redirect(`/public/overview?id=${encodeURIComponent(id)}`); // the dashboard home
});

// ==========================================================
// 🔐 /auth/admin — mirrors /auth/dashboard for admin sessions
// ==========================================================
// Expects an admin-typed token from /admindashboard slash command.
// Sets a separate admin_session cookie so player and admin
// sessions can coexist in the same browser without stepping on
// each other.
app.get("/auth/admin", (req, res) => {
  const { id, code } = req.query;

  if (!id || !code) return res.status(400).send("Missing id/code");
  if (!validateToken(id, code, "admin")) return res.status(403).send("Invalid or expired admin link.");
  // From here the session slides (30 min after each use, 4 h at most).
  activateAdminSession(code);

  res.cookie("admin_session", code, {
    httpOnly: true,
    secure: isProd,
    sameSite: "Lax",
    path: "/",
    maxAge: ADMIN_MAX_MS,
  });

  res.redirect("/public/admindashboard");
});

// ==========================================================
// 🎯 Trainer Tier Costs (in utils/trainerCosts.js, which /challenge shares)
// ==========================================================
import { TRAINER_COSTS } from "./utils/trainerCosts.js";
export { TRAINER_COSTS };


// ✅ Serve all /public assets with correct MIME headers
app.use(
  "/public",
  express.static(staticPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".js")) res.type("application/javascript");
      if (filePath.endsWith(".css")) res.type("text/css");
      if (filePath.endsWith(".json")) res.type("application/json");
      if (filePath.endsWith(".png")) res.type("image/png");
      if (filePath.endsWith(".gif")) res.type("image/gif");
    },
  })
);

// Aura art (assets/auras/<id>/aura.json + spritesheets), for the dashboard's Auras tab.
app.use("/auras-art", express.static(auraArtDir(), { index: false, dotfiles: "deny", extensions: false }));

// ✅ Sprite credits (generated by tools/generate-credits.mjs)
app.get(["/credits", "/public/credits"], (_, res) =>
  res.sendFile(path.join(staticPath, "credits", "index.html"))
);

// ✅ Explicit index routes
app.get("/public/picker", (_, res) =>
  res.sendFile(path.join(staticPath, "picker", "index.html"))
);
app.get("/public/picker-pokemon", (_, res) =>
  res.sendFile(path.join(staticPath, "picker-pokemon", "index.html"))
);
app.get("/public/pokedex", (_, res) =>
  res.sendFile(path.join(staticPath, "pokedex", "index.html"))
);
app.get("/public/overview", (_, res) =>
  res.sendFile(path.join(staticPath, "overview", "index.html"))
);
app.get("/public/teams", (_, res) =>
  res.sendFile(path.join(staticPath, "teams", "index.html"))
);

// ✅ Shop page (new canonical)
app.get("/public/dashboardshop", (_, res) =>
  res.sendFile(path.join(staticPath, "dashboardshop", "index.html"))
);
app.get("/public/bag", (_, res) =>
  res.sendFile(path.join(staticPath, "bag", "index.html"))
);
app.get("/public/achievements", (_, res) =>
  res.sendFile(path.join(staticPath, "achievements", "index.html"))
);

// ✅ Backward compat alias
app.get("/public/dashboardstore", (_, res) =>
  res.sendFile(path.join(staticPath, "dashboardshop", "index.html"))
);

// ✅ Admin dashboard — the UI itself doesn't gate, but every
// /api/admin/* endpoint checks requireAdminSession. This is just
// the static shell; the frontend JS fails gracefully (redirects
// to Discord instructions) if the API calls return 403.
app.get("/public/admindashboard", (_, res) =>
  res.sendFile(path.join(staticPath, "admindashboard", "index.html"))
);

// ==========================================================
// 🛡️ Mount admin API (routes/admindashboard.js)
// ==========================================================
// getTrainerData returns the live binding via closure so the
// router always sees the current in-memory state (trainerData
// gets reassigned during load / reload).
// requireAdminSession is declared below as a function
// declaration, so hoisting makes it available here.
mountAdminDashboard(app, {
  getTrainerData: () => trainerData,
  requireAdminSession,
  adminSessionOf,
  lockUser,
  save: saveAndAck,
  // Same gate as the player /api writes below (D8 + A2 circuit breaker).
  writeBlocked: () =>
    !isReady
      ? "The bot is starting up or restarting. Try again in a moment."
      : getSaveHealth().degraded
        ? "Saving is temporarily unavailable. Try again shortly."
        : null,
  syncRole: syncRankRole,
});

// Rank role after an admin TP change. Uses the bot's server (GUILD_ID).
async function syncRankRole(userId, tp) {
  const guild = client.guilds.cache.get(process.env.GUILD_ID) ?? client.guilds.cache.first();
  if (!guild) return { ok: false, reason: "The bot isn't in a server." };
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, reason: "They aren't in the server." };
  if (!member.manageable) return { ok: false, reason: "The bot's role is below theirs." };
  await updateUserRole(member, tp);
  return { ok: true };
}



// ==========================================================
// 🎨 Color Palette (Matches CSS theme)
// ==========================================================
// rarityColors lives in utils/rarityPalette.js (moved verbatim).
export { rarityColors };

// ==========================================================
// 📦 Internal Utilities
// ==========================================================
import { getRank, getRankTiers } from "./utils/rankSystem.js";
import { safeReply } from "./utils/safeReply.js";
import { reloadUserFromDiscord, ensureUserInitialized } from "./utils/userInitializer.js";
import { getAllPokemon, getAllTrainers, getAcquirablePokemon } from "./utils/dataLoader.js";
import {
  selectRandomPokemonForUser,
} from "./utils/weightedRandom.js";
import { rollForShiny } from "./shinyOdds.js";
import { rarityEmojis, spritePaths } from "./spriteconfig.js";
import { loadTrainerSprites } from "./utils/dataLoader.js";
import { updateUserRole } from "./utils/updateUserRole.js";
import { broadcastReward } from "./utils/broadcastReward.js";
import { catchAnnouncement } from "./utils/render/catchMessage.js";
import {
  createPokemonRewardEmbed,
} from "./utils/embedBuilders.js";
import { sanitizeTrainerData } from "./utils/sanitizeTrainerData.js";
// ==========================================================
// 📜 Event log — analytics-only, never throws
// ==========================================================
import {
  logEvent,
  pruneEvents,
  shutdown as shutdownEventLog,
} from "./utils/eventLog.js";
import { mountAdminDashboard } from "./routes/admindashboard.js";
import { startLoopLagMonitor } from "./utils/loopLag.js";
import { getRenderPool, renderPoolStatus } from "./utils/render/renderPool.js";

// ==========================================================
// ⚙️ Global Constants
// ==========================================================
const TRAINERDATA_PATH = "./trainerData.json";

const PORT = process.env.PORT || 10000;
const MESSAGE_TP_GAIN = 2;
const MESSAGE_CC_CHANCE = 0.02;
const MESSAGE_CC_GAIN = 100;
const MESSAGE_COOLDOWN = 7000;
const MESSAGE_REWARD_CHANCE = 0.01;
const REACTION_REWARD_CHANCE = 0.01;
const REWARD_COOLDOWN = 7000;
const RARE_TIERS = ["rare", "epic", "legendary", "mythic"];



// ===========================================================
// 🛡️ TOKEN MANAGEMENT (10-min access tokens for picker)
// ===========================================================
// Active tokens are kept in utils/dashboardAuth.js (10-minute lifetime).

// ✅ Garbage collection — prevents memory growth on long-running process
// Runs every 5 minutes: cleans expired tokens, stale cooldowns, and cached members
setInterval(() => {
  const now = Date.now();
  let removed = 0;

  removed += pruneExpiredTokens(now);

  for (const [k, ts] of userCooldowns) if (now - ts > 60_000) { userCooldowns.delete(k); removed++; }
  for (const [k, ts] of rewardCooldowns) if (now - ts > 60_000) { rewardCooldowns.delete(k); removed++; }
  for (const [k, { ts }] of memberCache) if (now - ts > 2 * MEMBER_CACHE_TTL_MS) { memberCache.delete(k); removed++; }

  if (removed > 0) {
    console.log(`🧹 GC removed ${removed} expired entry(s)`);
  }
}, 5 * 60 * 1000);


// Token functions live in utils/dashboardAuth.js (moved verbatim) so
// commands can import them without importing bot_final.js.
export { generateToken, validateToken, getChannelIdForToken, requireAdminSession };


let trainerData = {};
let discordSaveCount = 0;
let commandSaveQueue = null;
let isReady = false;
let shuttingDown = false;
const startTime = Date.now();
// Cooldowns
const rewardCooldowns = new Map();    // ✅ ONLY for random encounter rewards
const userCooldowns = new Map();      // ✅ message TP throttling
const RANK_TIERS = getRankTiers();

// ==========================================================
// 🤖 Discord Client Setup
// ==========================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});
client.commands = new Collection();

client.on("debug", (m) => {
  // discord.js can be noisy; filter to gateway-ish lines
  if (
    m.includes("Gateway") ||
    m.includes("WS") ||
    m.includes("Shard") ||
    m.includes("IDENTIFY") ||
    m.includes("RESUME")
  ) {
    console.log("🧪 discord.js debug:", m);
  }
});

// ==========================================================
// 🔐 Discord Login Throttle (Gateway Safety)
// ==========================================================
let lastLoginAttempt = 0;
let loginInProgress = false;

const LOGIN_COOLDOWN = 60_000; // 60 seconds

async function safeLogin() {
  // Prevent concurrent login attempts
  if (loginInProgress) {
    console.warn("⏳ safeLogin called while login already in progress — skipping");
    return;
  }

  loginInProgress = true;

  try {
    const now = Date.now();

    // Enforce gateway cooldown
    if (now - lastLoginAttempt < LOGIN_COOLDOWN) {
      const wait = LOGIN_COOLDOWN - (now - lastLoginAttempt);
      console.warn(`⏳ Login throttled. Waiting ${Math.ceil(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
    }

    lastLoginAttempt = Date.now();

    console.log("🔑 Attempting Discord login...");
    await client.login(process.env.BOT_TOKEN);

  } catch (err) {
    console.error("❌ Discord login failed:", err?.message || err);
    throw err; // let loginLoop decide backoff strategy
  } finally {
    loginInProgress = false;
  }
}

// ==========================================================
// 🛰️ DISCORD TELEMETRY (SINGLE SOURCE OF TRUTH)
// ==========================================================
let lastDiscordOk = Date.now();
let lastGatewayOk = Date.now();
let lastInteractionAtMs = null;
let hasBeenReadyOnce = false;

// Shard lifecycle events
client.on("shardReady", (id) => console.log("🟢 shardReady", { id }));

client.on("shardResume", (id) => {
  console.log("🟢 shardResume", { id });
  lastGatewayOk = Date.now();
});

client.on("shardReconnecting", (id) => console.log("🟡 shardReconnecting", { id }));

client.on("shardDisconnect", (event, id) => {
  console.log("🔴 shardDisconnect", {
    id,
    code: event?.code,
    reason: event?.reason,
  });
});

client.on("shardError", (e) => console.error("❌ shardError:", e?.message || e));
client.on("error", (e) => console.error("❌ Discord client error:", e?.message || e));

// True gateway heartbeat (raw packets)
client.on("raw", () => {
  lastGatewayOk = Date.now();
});

// Optional: ws debug (log-only)
client.ws.on("debug", (m) => {
  if (
    m.includes("Connecting") ||
    m.includes("Connected") ||
    m.includes("Identifying") ||
    m.includes("Resuming") ||
    m.includes("Closed") ||
    m.includes("Heartbeat")
  ) {
    console.log("🧪 ws debug:", m);
  }
});

// ✅ Readiness: 200 only once player data is loaded and commands are served.
// (Use /healthz for liveness; never restart the bot on a failing /readyz —
// that risks Discord login loops.)
let loadBlockedReason = null;
let loadedFrom = null;
let supersededReason = null;
const backupStatus = { lastAttemptAt: null, lastVerified: null, lastVerifiedAt: null, lastSeq: null };

// A2: another process took over the data (higher epoch). Fence all writes
// and stay NOT READY; do not exit (a restart would take a new epoch and
// fence the other process in turn).
function supersede(reason) {
  if (supersededReason) return;
  supersededReason = reason;
  isReady = false;
  fenceWrites(reason);
  console.error(`⛔ SUPERSEDED: ${reason}. Not ready; no further writes from this process.`);
}

// Main-thread stalls, logged each minute and summed up on /readyz. The
// render threads start now rather than on the first image, so the first
// card after a restart doesn't also wait for them to load.
const loopLag = startLoopLagMonitor();
getRenderPool();

app.get("/readyz", (_, res) => {
  const save = getSaveHealth();
  const body = {
    ready: isReady,
    loadedFrom,
    loadBlockedReason,
    superseded: supersededReason,
    epoch: getEpoch(),
    seq: getSeq(),
    dataDir: dataDir(),
    durableVolume: process.env.LOCAL_IS_DURABLE === "1",
    localSave: { degraded: save.degraded, consecutiveFailures: save.consecutiveFailures, lastWriteAt: save.lastWriteAt, pendingChanges: save.pendingChanges },
    discordBackup: backupStatus,
    loopLag: loopLag.status(),
    renderThreads: renderPoolStatus(),
  };
  res.status(isReady ? 200 : 503).json(body);
});

// ✅ Health endpoint (uses unified vars)
app.get("/healthz", (_, res) => {
  res.json({
    appReadyFlag: isReady,
    discordJsReady: !!client.readyAt,
    wsPing: client.ws?.ping ?? null,
    uptime: Math.floor(process.uptime()),
    lastDiscordOkAgeSec: Math.round((Date.now() - lastDiscordOk) / 1000),
    lastGatewayOkAgeSec: Math.round((Date.now() - lastGatewayOk) / 1000), // ✅ add
    lastInteractionAt: lastInteractionAtMs ? new Date(lastInteractionAtMs).toISOString() : null,
  });
});

// ----------------------------------------------------------
// 🚨 RESTART ONLY IF BOTH REST + GATEWAY LOOK DEAD
// ----------------------------------------------------------
setInterval(() => {
  if (!hasBeenReadyOnce) return;

  const restAgeMs = Date.now() - lastDiscordOk;
  const gatewayAgeMs = Date.now() - lastGatewayOk;

  // REST dead for 60m AND gateway dead for 30m => truly unhealthy
  if (restAgeMs > 60 * 60_000 && gatewayAgeMs > 30 * 60_000) {
    console.error(
      `❌ Discord unhealthy — REST ${Math.round(restAgeMs / 1000)}s, Gateway ${Math.round(gatewayAgeMs / 1000)}s — exiting`
    );
    process.exit(1);
  }
}, 60_000);

// ==========================================================
// 💾 Trainer Data Load & Save
// ==========================================================
// Picks the newest valid snapshot (local current/previous, or the newest
// bot-posted Discord backups) — see persistence/loader.js. Returns
// { ok, data, chosen } or { ok:false, blocked }.
async function loadTrainerData() {
  const channelId = process.env.STORAGE_CHANNEL_ID;
  console.log(`📦 Loading trainer data (local dir: ${dataDir()}, plus Discord backups)...`);

  const result = await loadBestSnapshot({
    readLocalCandidates,
    fetchDiscordCandidates: () => fetchDiscordCandidates(client, channelId),
    readFileCandidate: (file) => readFileCandidate(file, null, "restore-file"),
    fetchDiscordMessageCandidate: (id) => fetchDiscordMessageCandidate(client, channelId, id),
  });

  for (const r of result.rejected || []) console.warn(`  ↳ ${describeSnapshot({ ok: false, ...r })}`);
  if (!result.ok) {
    console.error(`⛔ Player data NOT loaded: ${result.blocked}`);
    return { ok: false, blocked: result.blocked };
  }

  const { chosen } = result;
  console.log(`✅ Loaded ${chosen.userCount} users from ${describeSnapshot(chosen)}${result.restored ? " (OPERATOR RESTORE)" : ""}`);
  setSeqAtLeast(result.maxSeq);
  // A2 fencing: take an epoch above every epoch seen, so this process's
  // snapshots sort newest and any older process still running gets fenced.
  setEpoch((result.maxEpoch || 0) + 1);
  console.log(`🔑 Writer epoch ${getEpoch()}${result.localOnly ? " (booted from the local volume; Discord unreachable)" : ""}`);
  const data = chosen.data;
  const trimmedBefore = new Map(Object.entries(data).map(([id, u]) => [id, peekNotices(u, NOTICE_KINDS.BATTLE_TEAM_TRIM).length]));
  const consolidatedBefore = new Map(Object.entries(data).map(([id, u]) => [id, peekNotices(u, NOTICE_KINDS.TRAINER_CONSOLIDATION).length]));
  for (const [id, user] of Object.entries(data)) normalizeUserSchema(id, user);
  {
    // Generation consolidation (normalizeUserSchema → consolidateUserTrainers): count players changed this boot.
    const n = Object.entries(data).filter(([id, u]) => peekNotices(u, NOTICE_KINDS.TRAINER_CONSOLIDATION).length > (consolidatedBefore.get(id) || 0)).length;
    console.log(`🧩 Trainer collections consolidated (folded game versions → one sprite): ${n}`);
  }
  {
    // Battle teams over the one-mythic limit after a re-tier are trimmed by
    // normalizeUserSchema → normalizeBattleTeam; count them for the boot log.
    const trimmed = Object.entries(data).filter(([id, u]) => peekNotices(u, NOTICE_KINDS.BATTLE_TEAM_TRIM).length > (trimmedBefore.get(id) || 0)).length;
    console.log(`⚔️ Battle teams trimmed to one mythic-tier Pokémon: ${trimmed}`);
  }
  // Pokédex backfill (docs/adr/0001): species from historical snapshots,
  // built offline by tools/build-pokedex-backfill.mjs. Union only, so it is
  // safe to leave set or to run again. The file holds player ids: it lives
  // on the data volume, never in the repository.
  if (process.env.POKEDEX_BACKFILL_FILE) {
    try {
      const raw = JSON.parse(fsSync.readFileSync(process.env.POKEDEX_BACKFILL_FILE, "utf8"));
      let players = 0, entries = 0;
      for (const [id, masks] of Object.entries(raw?.users ?? {})) {
        if (!data[id]) continue;
        const n = mergeDex(data[id], masks);
        if (n) { players++; entries += n; }
      }
      console.log(`📖 Pokédex backfill: ${entries} species added for ${players} player(s)`);
    } catch (err) {
      console.error("⚠️ Pokédex backfill not applied:", err?.message || err);
    }
  }
  // Release C: retroactive achievement recognition (idempotent, once per
  // catalog revision per player; recognition only, no rewards).
  {
    const t0 = Date.now();
    let players = 0, unlocks = 0;
    for (const user of Object.values(data)) {
      const n = retroEvaluate(user).length;
      if (n) { players++; unlocks += n; }
    }
    console.log(`🏅 Achievements: ${unlocks} retroactive unlock(s) for ${players} player(s) in ${Date.now() - t0} ms`);
  }
  return { ok: true, data, chosen };
}

async function saveDataToDiscord(data, { force = false } = {}) {
  if (shuttingDown && !force) {
    console.log("⚠️ Skipping Discord save — shutting down");
    return;
  }

  if (isSaving && !force) {
    console.log("⏳ Save already running — skip");
    return;
  }

  isSaving = true;

  const SAVE_TIMEOUT_MS = 25_000;

  const withTimeout = (p, ms, label) =>
    Promise.race([
      p,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout: ${label} after ${ms}ms`)), ms)
      ),
    ]);

  try {
    if (!client.isReady()) {
      console.log("⚠️ Discord not ready — skipping backup");
      return;
    }

    // Never upload before player data is loaded (or empty data): a shutdown
    // during startup used to post {} as the newest backup.
    if (isWriteBlocked() || !data || typeof data !== "object" || !Object.keys(data).length) {
      console.log("⚠️ Player data not loaded — skipping Discord backup");
      return;
    }

    let channel;
    try {
      channel =
        client.channels.cache.get(process.env.STORAGE_CHANNEL_ID) ??
        (await withTimeout(
          client.channels.fetch(process.env.STORAGE_CHANNEL_ID),
          10_000,
          "channels.fetch(STORAGE_CHANNEL_ID)"
        ));
    } catch (e) {
      console.log("⚠️ Backup channel fetch failed — skipping", e?.message || e);
      return;
    }

    if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
      console.log("⚠️ Backup channel unusable — skipping");
      return;
    }

    // Compact JSON attachment (unchanged format) + metadata in the message
    // text (seq/users/sha256/savedAt) — see persistence/discordBackups.js.
    // A2 fencing: if a backup with a HIGHER epoch exists, another process
    // has taken over the data. Stop writing for good (and stay not ready)
    // instead of overwriting its newer state.
    const channelEpoch = await newestChannelEpoch(client, process.env.STORAGE_CHANNEL_ID);
    if (getEpoch() != null && channelEpoch > getEpoch()) {
      supersede(`backup with epoch ${channelEpoch} found; this process has epoch ${getEpoch()}`);
      return;
    }

    const version = getDirtyVersion();
    const { meta, message } = await uploadBackup(channel, data, { seq: nextSeq(), epoch: getEpoch(), timeoutMs: SAVE_TIMEOUT_MS });

    // A2: confirm Discord stored exactly what we sent before counting it.
    const check = await verifyUpload(message, meta);
    backupStatus.lastAttemptAt = Date.now();
    backupStatus.lastVerified = check.ok;
    if (!check.ok) {
      console.error(`❌ Discord backup NOT verified (${check.reason}); will upload again next interval`);
      return;
    }
    lastUploadedDirtyVersion = version;
    backupStatus.lastVerifiedAt = Date.now();
    backupStatus.lastSeq = meta.seq;

    lastDiscordOk = Date.now();
    discordSaveCount++;
    console.log(`✅ Discord backup #${discordSaveCount} verified (${Math.round(meta.bytes / 1024)} KB, ${meta.userCount} users, seq ${meta.seq}, epoch ${meta.epoch})`);
  } catch (err) {
    console.error("❌ Discord save failed:", err?.message || err);
    throw err;  // let callers know it failed
  } finally {
    isSaving = false;
  }
}

// ==========================================================
// 🎁 DETERMINISTIC RANDOM REWARD SYSTEM (ATOMIC PER-USER LOCK)
// ==========================================================
// Resolves to "cooldown", "missed" (a Trainer encounter may roll next), or
// "caught"; undefined when the reward couldn't be picked.
async function tryGiveRandomReward(userObj, interactionUser, msgOrInteraction) {
  const userId = interactionUser.id;

  // The lock covers the roll, the grant and the save. The card is drawn and
  // posted after it's released, so a slow render or Discord upload never
  // holds up the player's next command; the save is a prompt one, so the card
  // still appears only once the catch is on disk.
  const granted = await lockUser(userId, async () => {
    console.log("⚙️ tryGiveRandomReward executed for", interactionUser.username);

    // =============================
    // ⏳ COOLDOWN
    // =============================
    const now = Date.now();
    const last = rewardCooldowns.get(userId) || 0;
    if (now - last < REWARD_COOLDOWN) return "cooldown";
    rewardCooldowns.set(userId, now);

    // =============================
    // 🎯 PITY SYSTEM (no shiny impact)
    // =============================
    userObj.luck ??= 0;

    const BASE_CHANCE = MESSAGE_REWARD_CHANCE;  // 0.01
    const MAX_CHANCE = 0.05;                    // 5%
    const PITY_INCREMENT = 0.003;               // +0.3%

    // Increase pity every call
    userObj.luck = Math.min(MAX_CHANCE, userObj.luck + PITY_INCREMENT);

    // Final chance (a Live event may multiply it; never above 100 %)
    const liveFx = liveEffects();
    const finalChance = scaleChance(Math.min(MAX_CHANCE, BASE_CHANCE + userObj.luck), liveFx.catchRate);

    // Reward fails → keep pity meter, exit
    if (Math.random() >= finalChance) {
      return "missed";
    }

    // Reward occurred → reset pity meter
    userObj.luck = 0;

    // =============================
    // 🎲 ALWAYS POKÉMON (no trainers)
    // =============================
    const allPokemon = await getAcquirablePokemon(); // live generations only

    let reward;
    let isShiny = false;
    let caught = null;

    try {
      reward = selectRandomPokemonForUser(allPokemon, userObj, "pokeball", { fx: liveFx });
      isShiny = rollForShiny(userObj.tp || 0);

      caught = grantCatch(userObj, reward.id, isShiny ? "shiny" : "normal"); // { level, isNew, expGained } for the card

      console.log(
        `🎁 Pokemon reward → ${isShiny ? "✨ shiny " : ""}${reward.name} (${reward.tier})`
      );
    } catch (err) {
      console.error("❌ Reward selection failed:", err);
      return;
    }

    // =============================
    // 💾 SAVE (atomic)
    // =============================
    await promptSave(trainerData);

    return { reward, isShiny, caught, eventNames: hasCatchEffects(liveFx) ? liveFx.catchEvents : [] };
  });
  // "cooldown", "missed" or undefined (reward selection failed): nothing to post.
  if (!granted || typeof granted !== "object") return granted;
  const { reward, isShiny, caught, eventNames } = granted;

  // =============================
  // 🖼️ SPRITE
  // =============================
  let spriteUrl = pokemonSpriteUrl(reward.id, isShiny);

  // =============================
  // 📣 PUBLIC ANNOUNCEMENT
  // =============================
  // The catch card (utils/render/catchMessage.js); the old embed if it can't render.
  const { message: announcement, broadcast } = await catchAnnouncement({
    user: userObj,
    catcher: interactionUser,
    pokemonId: reward.id,
    shiny: isShiny,
    catchResult: caught,
    eventNames,
    fallback: () => ({
      content: `🎉 <@${userId}> caught **${isShiny ? "✨ shiny " : ""}${reward.name}**!`,
      embeds: [createPokemonRewardEmbed(reward, isShiny, spriteUrl)],
    }),
  });

  try {
    await msgOrInteraction.channel.send(announcement);
  } catch (err) {
    console.warn("⚠️ Public announcement failed:", err.message);
  }

  // =============================
  // 🌐 GLOBAL BROADCAST (fire-and-forget — don't hold the lock)
  // =============================
  broadcastReward(client, {
    user: interactionUser,
    type: "pokemon",
    item: {
      id: reward.id,
      name: reward.name,
      rarity: reward.tier || "common",
      spriteFile: `${reward.id}.gif`
    },
    shiny: isShiny,
    source: "random encounter",
    image: broadcast?.image ?? null, // the same catch card, under a no-ping caption
    caption: broadcast?.caption ?? null,
  }).catch(err => console.error("❌ broadcastReward failed:", err.message));

  console.log(`✅ Reward granted to ${interactionUser.username}`);
  return "caught";
}

// Trainer encounters (utils/encounter/service.js): open encounters live in
// memory; their buttons come through interactionCreate below.
const encounters = createEncounterService({ getTrainerData: () => trainerData, lockUser, enqueueSave });


// ==========================================================
// 📂 COMMAND LOADER (LOCAL ONLY - no REST)
// ==========================================================
async function loadLocalCommands() {
  const commandsPath = path.resolve("./commands");
  const files = (await fs.readdir(commandsPath)).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    try {
      const imported = await import(`./commands/${file}`);
      const command = imported.default || imported;

      if (!command?.data?.name || typeof command.execute !== "function") {
        console.warn(`⚠️ ${file}: invalid command export`);
        continue;
      }

      client.commands.set(command.data.name, command);
      console.log(`✅ Loaded: ${command.data.name}`);
    } catch (err) {
      console.error(`❌ ${file}:`, err?.stack || err);
    }
  }

  console.log(`📦 Local commands loaded: ${client.commands.size}`);
}

// ==========================================================
// 🌐 COMMAND REGISTRATION (REST) - ONLY WHEN ENABLED
// ==========================================================
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
  const commandsJSON = client.commands.map((c) => c.data.toJSON());

  console.log(`📡 Registering ${commandsJSON.length} commands (REST)...`);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commandsJSON }
  );
  console.log("✅ Commands registered");
}

// ==========================================================
// 💾 SAVE MANAGEMENT
// ==========================================================
function debouncedDiscordSave() {
  console.log("ℹ️ debouncedDiscordSave() called — no-op (Discord now saves every 15 minutes regardless).");
}

// ==========================================================
// 🕒 OFF-MACHINE DISCORD BACKUP — every 5 minutes, only when data changed
// (the local volume snapshot is the primary copy; this is for recovery)
// ==========================================================
const DISCORD_BACKUP_INTERVAL_MS = 5 * 60 * 1000;
let lastUploadedDirtyVersion = -1; // -1: upload at the first interval after start

const discordBackupInterval = setInterval(async () => {
  if (shuttingDown) return;
  if (!client.isReady() || !isReady) return;
  if (isSaving) return;
  if (getDirtyVersion() === lastUploadedDirtyVersion) return; // nothing changed

  console.log("💾 Backup interval — saving trainerData to Discord...");
  try {
    await saveDataToDiscord(trainerData);
  } catch (err) {
    console.error("❌ Interval Discord save failed:", err?.message || err);
  }
}, DISCORD_BACKUP_INTERVAL_MS);

// ==========================================================
// 🛑 GRACEFUL SHUTDOWN (Fixed — Final Backup Guaranteed)
// ==========================================================

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

 try { clearInterval(discordBackupInterval); } catch {}

  console.log(`\n🛑 Received ${signal}, shutting down...`);
  isReady = false;

  const hardTimeout = setTimeout(() => {
    console.log("⏲️ Hard shutdown timeout — forcing exit");
    process.exit(0);
  }, 25000);

  try {
    console.log("💾 Flushing pending local saves...");
    const localSaved = await Promise.race([
      shutdownFlush(10_000),
      new Promise(res => setTimeout(() => res(false), 8000)),
    ]);
    console.log(localSaved ? "✅ Local save flushed" : "⚠️ Local save NOT confirmed before shutdown");

    // Event log is append-only with no in-memory buffer, but we
    // call shutdown() as a hook in case buffering is added later.
    try { await shutdownEventLog(); } catch {}

    console.log("☁️ Uploading FINAL Discord backup (forced)...");
await Promise.race([
  saveDataToDiscord(trainerData, { force: true }),
  new Promise(res => setTimeout(res, 8000)),
]);


    console.log("🧹 Destroying Discord client...");
    await Promise.race([
      client.destroy(),
      new Promise(res => setTimeout(res, 2000)),
    ]);
  } catch (err) {
    console.error("❌ Shutdown error:", err?.message || err);
  } finally {
    clearTimeout(hardTimeout);
    process.exit(0);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ==========================================================
// 💬 Passive TP Gain from Messages
// ==========================================================
client.on(
  "messageCreate",
  createMessageHandler({
    isReady: () => isReady,
    getTrainerData: () => trainerData,
    normalizeUserSchema,
    cooldowns: userCooldowns,
    config: {
      cooldownMs: MESSAGE_COOLDOWN,
      tpGain: MESSAGE_TP_GAIN,
      ccChance: MESSAGE_CC_CHANCE,
      ccGain: MESSAGE_CC_GAIN,
    },
    enqueueSave,
    queueRoleUpdate,
    giveRandomReward: tryGiveRandomReward,
    spot: (message) => encounters.maybeSpot(message),
  })
);


// ==========================================================
// 📖 Pokédex status — which generations are released (no player data).
// The dashboard hides unreleased species unless the player owns them.
// ==========================================================
app.get("/api/pokedex-status", (req, res) => {
  res.json({ liveGenerations: liveGenerations(), maxDex: MAX_DEX });
});

// ==========================================================
// 🛍️ SHOP API — GET USER  (FINAL FIXED VERSION)
// ==========================================================
app.get("/api/user", (req, res) => {
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!requireDashboardSession(req, id))
    return res.status(403).json({ error: "Invalid or expired session" });

  const user = trainerData[id];
  if (!user) return res.status(404).json({ error: "User not found" });

  trainerData[id] = normalizeUserSchema(id, user);
  trainerData[id].rank = getRank(trainerData[id].tp);

  return res.json(hideOpenRun(trainerData[id]));
});

// ==========================================================
// 🎒 INVENTORY (Release B) — read-only, catalog-built rows only
// Never returns the raw player record; never mutates (no normalization or
// record creation on read). Same session check as every dashboard route.
// ==========================================================
app.get("/api/inventory", (req, res) => {
  const { status, body } = handleInventoryRequest({
    query: req.query,
    isAuthorized: (id) => requireDashboardSession(req, id),
    trainerData,
  });
  return res.status(status).json(body);
});


// ==========================================================
// 🛍️ SHOP API — UPDATE USER (HARDENED / WHITELISTED)
// ==========================================================
// D8: dashboard writes only while the bot is READY. Before player data has
// loaded, during a load retry, and once shutdown has begun (after the final
// flush), a write could act on incomplete data or be lost, so refuse it.
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (!isReady) {
    return res.status(503).json({ success: false, error: "The bot is starting up or restarting. Please try again in a moment." });
  }
  // A2 circuit breaker: while local saves keep failing, refuse new dashboard
  // changes instead of piling up unsaved state.
  if (getSaveHealth().degraded) {
    return res.status(503).json({ success: false, error: "Saving is temporarily unavailable. Your progress is safe; please try again shortly." });
  }
  return next();
});

// 🏅 ACHIEVEMENTS (Release C): read-only view + the one claim path.
const achievements = createAchievementHandlers({ getTrainerData: () => trainerData, lockUser, save: saveAndAck });
// Battle Records (services/fightRecordsApi.js): the player's own Fight records.
const fightRecordApi = createFightRecordHandlers({ store: fightRecords, isAuthorized: requireDashboardSession });
app.get("/api/fight-records", (req, res) => fightRecordApi.list(req, res));
app.get("/api/fight-records/:fightId", (req, res) => fightRecordApi.get(req, res));

app.get("/api/achievements", (req, res) => {
  const { status, body } = achievements.view({ query: req.query, isAuthorized: (id) => requireDashboardSession(req, id) });
  return res.status(status).json(body);
});
app.post("/api/achievements/claim", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const { status, body } = await achievements.claim({ body: req.body || {}, isAuthorized: (id) => requireDashboardSession(req, id) });
    return res.status(status).json(body);
  } catch (err) {
    console.error("❌ /api/achievements/claim:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});


// 🧬 MEGA EVOLUTION (Phase M1): every endpoint is behind its own capability
// (config/features.js). With MEGA_EVOLUTION_ENABLED unset (production), the
// view answers { enabled: false } and the writes refuse with 403.
const mega = createMegaHandlers({ getTrainerData: () => trainerData, lockUser, save: saveAndAck });
app.get("/api/mega", (req, res) => {
  const { status, body } = mega.view({ query: req.query, isAuthorized: (id) => requireDashboardSession(req, id) });
  return res.status(status).json(body);
});
app.post("/api/mega/unlock", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const { status, body } = await mega.unlock({ body: req.body || {}, isAuthorized: (id) => requireDashboardSession(req, id) });
    return res.status(status).json(body);
  } catch (err) {
    console.error("❌ /api/mega/unlock:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});
app.post("/api/mega/preferred", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const { status, body } = await mega.preferred({ body: req.body || {}, isAuthorized: (id) => requireDashboardSession(req, id) });
    return res.status(status).json(body);
  } catch (err) {
    console.error("❌ /api/mega/preferred:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});
// Mega Shard shop: capability "rewards" (MEGA_REWARDS_ENABLED=1). Off: the
// view says { enabled: false } and both purchases refuse with 403.
app.get("/api/mega/shop", (req, res) => {
  const { status, body } = mega.shop({ query: req.query, isAuthorized: (id) => requireDashboardSession(req, id) });
  return res.status(status).json(body);
});
for (const [route, handler] of [["/api/mega/shop/buy-shards", "buyShards"], ["/api/mega/shop/buy-stone", "buyStone"]]) {
  app.post(route, express.json({ limit: "4kb" }), async (req, res) => {
    try {
      const { status, body } = await mega[handler]({ body: req.body || {}, isAuthorized: (id) => requireDashboardSession(req, id) });
      if (status === 200 && !body.replayed) logEvent(handler === "buyShards" ? "mega_shard_purchase" : "mega_stone_purchase", req.body.id, handler === "buyShards" ? { shards: body.bought, cost: body.cost } : { stoneId: body.stoneId, shards: body.price });
      return res.status(status).json(body);
    } catch (err) {
      console.error(`❌ ${route}:`, err?.message || err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  });
}

// ==========================================================
// 🧿 Held items (services/heldItemsApi.js). Dashboard-only management: no
// Discord command can equip or buy items. Gated by HELD_ITEMS_* flags
// (config/features.js); unset in production = the view says
// { enabled: false } and every write refuses with 403.
// ==========================================================
const heldItems = createHeldItemHandlers({ getTrainerData: () => trainerData, lockUser, save: saveAndAck, logEvent });
app.get("/api/held-items", (req, res) => {
  const { status, body } = heldItems.view({ query: req.query, isAuthorized: (id) => requireDashboardSession(req, id) });
  return res.status(status).json(body);
});
for (const [route, fn] of [["claim-starter", heldItems.claimStarter], ["equip", heldItems.equip], ["buy", heldItems.buy]]) {
  app.post(`/api/held-items/${route}`, express.json({ limit: "4kb" }), async (req, res) => {
    try {
      const { status, body } = await fn({ body: req.body || {}, isAuthorized: (id) => requireDashboardSession(req, id) });
      return res.status(status).json(body);
    } catch (err) {
      console.error(`❌ /api/held-items/${route}:`, err?.message || err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  });
}

// D14: dashboard replies say whether the change reached disk. On a failed
// write the change stays in memory and is retried; the reply carries a
// "saved with a delay" notice instead of an unqualified success.
// saveAckFields now lives in utils/saveManager.js (shared with route handlers).

app.post("/api/updateUser", express.json({ limit: "32kb" }), async (req, res) => {
  try {
    const { id, user } = req.body;

    if (!id) return res.status(400).json({ error: "Missing id" });
    if (!requireDashboardSession(req, id))
      return res.status(403).json({ error: "Invalid or expired session" });

    const current = trainerData[id];
    if (!current) return res.status(404).json({ error: "User not found" });

    // Must be a plain object
    if (!user || typeof user !== "object" || Array.isArray(user)) {
      return res.status(400).json({ error: "Invalid user payload" });
    }

    // Prevent prototype pollution attempts
    for (const k of Object.keys(user)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") {
        return res.status(400).json({ error: "Invalid key" });
      }
    }

    // --- build patch from a strict whitelist only ---
    const patch = {};

    // ✅ Allow only displayedTrainer (string)
    if (typeof user.displayedTrainer === "string") {
      patch.displayedTrainer = user.displayedTrainer.trim().slice(0, 64);
    }

    // ✅ Allow only displayedPokemon (team) with strict normalization
    if (Array.isArray(user.displayedPokemon)) {
      patch.displayedPokemon = normalizeDisplayedPokemon(user.displayedPokemon, 6);
    }

    // If nothing valid was provided, don't write
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    await lockUser(id, async () => {
      // D2: update the LIVE record in place. Replacing trainerData[id] with a
      // copy detached any reference still held elsewhere (open collectors,
      // wagers, battles), and their later CC/TP writes were lost.
      const user = normalizeUserSchema(id, trainerData[id]);

      // TM system: keep trained copies on their slots (this route's clients
      // never send `uid`); see services/ownership.js carryCopyUids.
      if (patch.displayedPokemon) patch.displayedPokemon = carryCopyUids(user, user.displayedPokemon, patch.displayedPokemon, req.body.user.displayedPokemon);

      // Apply patch only (NO blind merge of arbitrary user fields)
      Object.assign(user, patch);
      normalizeUserSchema(id, user);

      // Server-authoritative fields
      user.rank = getRank(user.tp);

      const saveAck = await saveAndAck(trainerData);

      return res.json({ ...saveAckFields(saveAck), success: true });
    });
  } catch (err) {
    console.error("updateUser error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// -------------------------
// Team normalization helper
// -------------------------
function normalizeDisplayedPokemon(rawTeam, maxSize = 6) {
  // Accepts entries like:
  //  - number: 25
  //  - string: "25"
  //  - object: { id: 25, variant: "normal"|"shiny" } (and legacy {id, shiny:true})
  const out = [];
  const seen = new Set();

  const normVariant = (v) => {
    const s = String(v ?? "normal").toLowerCase().trim();
    return s === "shiny" ? "shiny" : "normal";
  };

  const toTeamObj = (entry) => {
    if (typeof entry === "number") {
      return Number.isInteger(entry) ? { id: entry, variant: "normal" } : null;
    }
    if (typeof entry === "string") {
      const n = Number(entry);
      return Number.isInteger(n) ? { id: n, variant: "normal" } : null;
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const id = Number(entry.id);
      if (!Number.isInteger(id)) return null;

      const legacyIsShiny =
        entry.variant == null && (entry.shiny === true || entry.isShiny === true);

      return { id, variant: legacyIsShiny ? "shiny" : normVariant(entry.variant) };
    }
    return null;
  };

  for (const entry of Array.isArray(rawTeam) ? rawTeam : []) {
    const obj = toTeamObj(entry);
    if (!obj) continue;

    // Hard bounds (Pokédex id sanity); adjust if you have >1025 etc
    if (obj.id < 1 || obj.id > 2000) continue;

    // Prevent duplicate slots of same id+variant
    const key = `${obj.id}:${obj.variant}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(obj);
    if (out.length >= maxSize) break;
  }

  return out;
}

// ==========================================================
// 🛍️ SHOP API — POKÉMON REWARD (Atomic, CC-safe, Exploit-proof)
// ==========================================================
// Gameplay handlers live in services/gameplay.js (tested); the routes below
// only adapt HTTP. Prices, odds, costs and rewards are unchanged.
const gameplay = createGameplayHandlers({
  getTrainerData: () => trainerData,
  lockUser,
  save: saveAndAck,
  normalizeUserSchema,
  logEvent,
  onRareCatch: ({ userId, pokemon, source }) => {
    const discordUser = client.users.cache.get(userId);
    if (!discordUser) return;
    broadcastReward(client, {
      user: discordUser,
      type: "pokemon",
      item: { id: pokemon.id, name: pokemon.name, rarity: pokemon.rarity, spriteFile: `${pokemon.id}.gif` },
      shiny: pokemon.shiny,
      source,
    }).catch((err) => console.warn("⚠️ Broadcast failed:", err.message));
  },
});

app.post("/api/rewardPokemon", express.json(), async (req, res) => {
  try {
    const r = await gameplay.rewardPokemon({ body: req.body || {}, isAuthorized: (id) => requireDashboardSession(req, id) });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error("❌ /api/rewardPokemon:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ==========================================================
// 🎪 Live events (services/liveEventsPlayer.js): what's on, today's prices,
// and the player's "Use Live event" choice for Poké Balls and /recruit.
// ==========================================================
app.get("/api/live-events", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ ok: false, error: "Missing id" });
  if (!requireDashboardSession(req, id)) return res.status(403).json({ ok: false, error: "Invalid or expired session" });
  const user = trainerData[id];
  if (!user) return res.status(404).json({ ok: false, error: "User not found" });
  return res.json({ ok: true, ...playerView(user) });
});

const liveEventOptIn = createOptInHandler({ getTrainerData: () => trainerData, lockUser, save: saveAndAck });
app.post("/api/live-events/opt-in", express.json({ limit: "4kb" }), async (req, res) => {
  if (!isReady) return res.status(503).json({ ok: false, error: "The bot is starting up. Try again in a moment." });
  try {
    const r = await liveEventOptIn({ body: req.body || {}, isAuthorized: (id) => requireDashboardSession(req, id) });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error("❌ /api/live-events/opt-in:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});


client.on("interactionCreate", async (interaction) => {
  // Autocomplete (e.g. /pokedex name): answered at once from memory, never
  // logged per keystroke. A command without a handler answers nothing.
  if (interaction.isAutocomplete?.()) {
    const cmd = client.commands.get(interaction.commandName);
    try {
      if (cmd?.autocomplete) await cmd.autocomplete(interaction, trainerData ?? {});
      else await interaction.respond([]);
    } catch (e) {
      await interaction.respond([]).catch(() => {});
    }
    return;
  }

  // ✅ TELEMETRY (consolidated)
  lastInteractionAtMs = Date.now();

  const kind = interaction.isChatInputCommand()
    ? "slash"
    : interaction.isButton()
    ? "button"
    : "other";

  console.log(
    `⚡ interactionCreate (${kind}) guild=${interaction.guildId} user=${interaction.user?.id} name=${
      interaction.commandName || interaction.customId
    } deferred=${interaction.deferred} replied=${interaction.replied}`
  );

  // ----------------------------------------------------------
  // 🔧 Patch interaction methods to be "safe" (no-throw)
  // ----------------------------------------------------------
  try {
    const swallow = (e) => {
      const code = e?.code;
      const msg = String(e?.message || "");
      if (code === "InteractionAlreadyReplied") return true;
      if (code === 10062) return true; // Unknown interaction
      if (msg.includes("Unknown interaction")) return true;
      if (msg.includes("already been acknowledged")) return true;
      return false;
    };

    if (typeof interaction.deferReply === "function") {
      const _deferReply = interaction.deferReply.bind(interaction);
      interaction.deferReply = async (opts) => {
        if (interaction.deferred || interaction.replied) return;
        try { return await _deferReply(opts); }
        catch (e) { if (swallow(e)) return; throw e; }
      };
    }

    if (typeof interaction.reply === "function") {
  const _reply = interaction.reply.bind(interaction);
  interaction.reply = async (opts) => {
    if (interaction.replied) return;

    // ✅ If we already deferred, reply() must become editReply()
    if (interaction.deferred) {
      try { return await interaction.editReply(opts); }
      catch (e) { if (swallow(e)) return; throw e; }
    }

    try { return await _reply(opts); }
    catch (e) { if (swallow(e)) return; throw e; }
  };
}

    if (typeof interaction.editReply === "function") {
      const _editReply = interaction.editReply.bind(interaction);
      interaction.editReply = async (opts) => {
        if (!interaction.deferred && !interaction.replied) return;
        try { return await _editReply(opts); }
        catch (e) { if (swallow(e)) return; throw e; }
      };
    }

    if (typeof interaction.followUp === "function") {
      const _followUp = interaction.followUp.bind(interaction);
      interaction.followUp = async (opts) => {
        try {
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: opts?.ephemeral ? 64 : 0 }).catch(() => {});
          }
          return await _followUp(opts);
        } catch (e) {
          if (swallow(e)) return;
          throw e;
        }
      };
    }

    if (typeof interaction.deferUpdate === "function") {
      const _deferUpdate = interaction.deferUpdate.bind(interaction);
      interaction.deferUpdate = async () => {
        if (interaction.deferred || interaction.replied) return;
        try { return await _deferUpdate(); }
        catch (e) { if (swallow(e)) return; throw e; }
      };
    }

    if (typeof interaction.update === "function") {
      const _update = interaction.update.bind(interaction);
      interaction.update = async (opts) => {
        if (interaction.replied) return;
        if (interaction.deferred) {
          return interaction.editReply(opts).catch(() => {});
        }
        try { return await _update(opts); }
        catch (e) { if (swallow(e)) return; throw e; }
      };
    }
  } catch (patchErr) {
    console.warn("⚠️ interaction patch failed:", patchErr?.message || patchErr);
  }

// ----------------------------------------------------------
// ✅ Slash Commands (HARDENED: timeout guard)
// ----------------------------------------------------------
if (interaction.isChatInputCommand()) {
  // NOTE: Each command handles its own deferReply() to control
  // whether the response is public or ephemeral.

  const startedAt = Date.now();

  try {
    if (!isReady) {
      await interaction
        .reply({ content: "⏳ Bot is starting up / reconnecting. Try again in ~10 seconds.", flags: 64 })
        .catch(() => {});
      return;
    }

    // Last active: any slash command counts. Rides along with the next save.
    if (trainerData[interaction.user.id]) trainerData[interaction.user.id].lastActiveAt = Date.now();

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(
        `❌ Unknown command: ${interaction.commandName} (loaded=${client.commands.size})`
      );
      await interaction.reply({ content: "❌ Unknown command.", flags: 64 }).catch(() => {});
      return;
    }

    let timedOut = false;

    // Run command with timeout
    await Promise.race([
      (async () => {
        await command.execute(
          interaction,
          trainerData,
          saveTrainerDataLocal,
          saveDataToDiscord,
          lockUser,
          enqueueSave,
          client
        );
      })(),
      new Promise((_, reject) =>
        setTimeout(() => {
          timedOut = true;
          reject(new Error(`Command timeout after ${COMMAND_TIMEOUT_MS}ms`));
        }, COMMAND_TIMEOUT_MS)
      ),
    ]).catch(async (e) => {
      console.warn("⚠️ Slash command timed out:", e?.message || e);

      // Only edit if we have an open deferred reply to edit
      if (interaction.deferred && !interaction.replied) {
        await interaction
          .editReply("⏳ Still working… try again in a moment.")
          .catch(() => {});
      }
    });

    // If the command timed out, we already handled messaging
    if (timedOut) return;

    // Every command's total time, so card load times can be read from the
    // logs next to each card's "🖼️ card" render line (utils/render/stage.js).
    const ms = Date.now() - startedAt;
    if (ms > 2500) console.warn(`⏱️ Slow slash command: ${interaction.commandName} took ${ms}ms`);
    else console.log(`⏱️ ${interaction.commandName} took ${ms}ms`);

    // If command finished but never replied, close it cleanly
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply("✅ Done.").catch(() => {});
    }

    return;
  } catch (err) {
    console.error("❌ Slash command crashed:", err?.stack || err);
    await interaction.editReply("❌ Command crashed. Check Render logs.").catch(() => {});
    return;
  }
}

  // ----------------------------------------------------------
  // ✅ Buttons — only ACK known no-op buttons; let collectors handle the rest
  // ----------------------------------------------------------
  if (interaction.isButton()) {
    const id = interaction.customId ?? "";

    // Trainer encounter cards are plain channel messages with no collector, so
    // their clicks (even on a card from before a restart) are answered here.
    if (isEncounterButton(id)) {
      if (!isReady) {
        await interaction
          .reply({ content: "⏳ Bot is starting up / reconnecting. Try again in ~10 seconds.", flags: 64 })
          .catch(() => {});
        return;
      }
      await encounters.handleButton(interaction);
      return;
    }

    const noopButton =
      id.startsWith("confirm_") ||
      id.startsWith("cancel_") ||
      id.startsWith("disabled_");

    if (noopButton && !interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => {});
    }

    return;
  }
});

// ==========================================================
// 🧰 WEEKLY PACK — Pokémon Only (Forced Rarity + Atomic Lock)
// ==========================================================
app.post("/api/weekly-pack", express.json(), async (req, res) => {
  try {
    const r = await gameplay.weeklyPack({ body: req.body || {}, isAuthorized: (id) => requireDashboardSession(req, id) });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error("❌ /api/weekly-pack:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ===========================================================
// 🧩 TRAINER PICKER API ENDPOINT (Memory-based)
// ===========================================================
app.get("/api/user-trainers", (req, res) => {
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!requireDashboardSession(req, id))
    return res.status(403).json({ error: "Invalid or expired session" });

  const user = trainerData[id];
  if (!user) return res.status(404).json({ error: "User not found in memory" });

  // ✅ keep schema consistent
  trainerData[id] = normalizeUserSchema(id, user);
  const u = trainerData[id];

  const owned = Array.isArray(u.trainers) ? u.trainers : Object.keys(u.trainers || {});

  return res.json({
    owned,
    cc: u.cc ?? 0,
    equipped: u.displayedTrainer || null, // ✅ add this
  });
});


// ===========================================================
// ✅ POST — Equip Trainer (Debounced Discord Save)
// ===========================================================
let lastTrainerSave = 0; // global throttle timestamp

app.post("/api/set-trainer", express.json({ limit: "8kb" }), async (req, res) => {
  try {
    const { id, file } = req.body;

    if (!id || !file) {
      return res.status(400).json({ success: false, error: "Missing id/file" });
    }

    if (!requireDashboardSession(req, id)) {
      return res.status(403).json({ success: false, error: "Invalid or expired session" });
    }

    await lockUser(id, async () => {
      if (!trainerData[id]) {
        return res.status(404).json({ success: false, error: "User not found" });
      }

      trainerData[id] = normalizeUserSchema(id, trainerData[id]);
      const user = trainerData[id];

      const requested = String(file).trim().toLowerCase();

      // ✅ confirm file exists in trainer catalog AND get canonical filename
      const { getFlattenedTrainers } = await import("./utils/dataLoader.js");
      const trainers = await getFlattenedTrainers();

      const match = trainers.find((t) =>
        Array.isArray(t.sprites) &&
        t.sprites.some((s) => String(s.file || s).trim().toLowerCase() === requested)
      );
      if (!match) {
        return res.status(404).json({ success: false, error: "Trainer not found" });
      }

      const canonicalFile =
        match.sprites
          .map((s) => String(s.file || s).trim())
          .find((f) => f.toLowerCase() === requested) || String(file).trim();

      // ✅ ownership check (case-insensitive)
      const ownedLower = new Set((user.trainers || []).map((x) => String(x).trim().toLowerCase()));
      if (!ownedLower.has(canonicalFile.toLowerCase())) {
        return res.status(400).json({ success: false, error: "You do not own this trainer." });
      }

      user.displayedTrainer = canonicalFile;
      trainerData[id] = user;

      const saveAck = await saveAndAck(trainerData);

      console.log(`✅ ${id} equipped trainer ${canonicalFile}`);
      return res.json({ ...saveAckFields(saveAck), success: true, equipped: canonicalFile });
    });
  } catch (err) {
    console.error("❌ /api/set-trainer failed:", err?.message || err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// ===========================================================
// Purchase Trainer
// ===========================================================
app.post("/api/unlock-trainer", express.json({ limit: "16kb" }), async (req, res) => {
  const { id, file } = req.body;

  if (!id || !file) return res.status(400).json({ success: false, error: "Missing id/file" });
  if (!requireDashboardSession(req, id))
    return res.status(403).json({ success: false, error: "Invalid or expired session" });

  await lockUser(id, async () => {
    if (!trainerData[id]) return res.status(404).json({ success: false, error: "User not found" });

    // ✅ normalize user first
    trainerData[id] = normalizeUserSchema(id, trainerData[id]);
    const user = trainerData[id];

    const requested = String(file).trim().toLowerCase();

    // Pull canonical trainers list
    const { getFlattenedTrainers } = await import("./utils/dataLoader.js");
    const trainers = await getFlattenedTrainers();

    // Find exact matching sprite filename in your trainer data
    const match = trainers.find((t) =>
      Array.isArray(t.sprites) &&
      t.sprites.some((s) => String(s.file || s).trim().toLowerCase() === requested)
    );

    if (!match) return res.status(404).json({ success: false, error: "Trainer not found" });

    // Canonical filename (prevents weird casing / duplicates)
    const canonicalFile =
      match.sprites
        .map((s) => String(s.file || s).trim())
        .find((f) => f.toLowerCase() === requested) || String(file).trim();

    // Ensure array + de-dupe (case-insensitive)
    user.trainers = Array.isArray(user.trainers) ? user.trainers : [];
    const ownedLower = new Set(user.trainers.map((x) => String(x).trim().toLowerCase()));
    if (ownedLower.has(canonicalFile.toLowerCase())) {
      return res.status(400).json({ success: false, error: "Trainer already owned" });
    }

    const tier = String(match.tier || match.rarity || "common").toLowerCase();
    if (!TRAINER_COSTS[tier]) return res.status(400).json({ success: false, error: `Unknown trainer tier: ${tier}` });
    const cost = discountedPrice(liveEffects(), "trainers", TRAINER_COSTS[tier]); // a Live event's discount

    if ((user.cc ?? 0) < cost) {
      return res.status(400).json({ success: false, error: `Requires ${cost} CC` });
    }

    user.cc -= cost;
    grantTrainer(user, canonicalFile); // also unlocks the tier's Aura

    const saveAck = await saveAndAck(trainerData);

    return res.json({ ...saveAckFields(saveAck),
      success: true,
      file: canonicalFile,
      cost,
      tier,
      cc: user.cc,          // ✅ important for frontend
    });
  });
});

// ==========================================================
// ✨ Auras (services/auras.js): the dashboard's Auras tab
// ==========================================================
app.get("/api/auras", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!requireDashboardSession(req, id)) return res.status(403).json({ error: "Invalid or expired session" });
  const user = trainerData[id];
  if (!user) return res.status(404).json({ error: "User not found" });
  // Auto shows the displayed trainer's own tier backdrop (Epic+), so the tab can preview it.
  return res.json({ ...auraView(user), trainer: user.displayedTrainer ?? null, autoTier: trainerTier(user.displayedTrainer) });
});

// Body: { id, aura: "auto" | "none" | auraId }
app.post("/api/auras/equip", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const { id, aura } = req.body || {};
    if (!id || typeof aura !== "string") return res.status(400).json({ success: false, error: "Missing id/aura" });
    if (!requireDashboardSession(req, id)) return res.status(403).json({ success: false, error: "Invalid or expired session" });
    await lockUser(id, async () => {
      const user = trainerData[id];
      if (!user) return res.status(404).json({ success: false, error: "User not found" });
      const r = equipAura(user, aura);
      if (!r.ok) return res.status(r.status ?? 400).json({ success: false, error: r.error });
      const saveAck = r.changed ? await saveAndAck(trainerData) : null;
      return res.json({ ...(saveAck ? saveAckFields(saveAck) : {}), success: true, equipped: r.equipped });
    });
  } catch (err) {
    console.error("❌ /api/auras/equip:", err?.message || err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// Body: { id, aura, requestId? } — a repeated requestId returns the first result and never charges twice.
app.post("/api/shop/buy-aura", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const { id, aura, requestId = null } = req.body || {};
    if (!id || typeof aura !== "string") return res.status(400).json({ success: false, error: "Missing id/aura" });
    if (!requireDashboardSession(req, id)) return res.status(403).json({ success: false, error: "Invalid or expired session" });
    if (!trainerData[id]) return res.status(404).json({ success: false, error: "User not found" });
    if (requestId != null && !REQUEST_ID_PATTERN.test(String(requestId))) return res.status(400).json({ success: false, error: "Invalid request id" });
    const tx = await runInventoryTransaction({
      trainerData, userId: id, lock: lockUser, save: saveAndAck, requestId,
      payloadKey: `buy-aura:${aura.slice(0, 64)}`,
      mutate: (user) => buyAura(user, aura),
    });
    if (!tx.ok) {
      const { ok, status = 400, ...rest } = tx;
      return res.status(status).json({ success: false, ...rest });
    }
    if (!tx.replayed) logEvent("aura_purchase", id, { aura: tx.result.aura, cost: tx.result.cost, ccAfter: tx.result.cc });
    const { ok, ...result } = tx.result;
    return res.json({ ...saveAckFields(tx), success: true, replayed: !!tx.replayed, ...result });
  } catch (err) {
    console.error("❌ /api/shop/buy-aura:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ==========================================================
// 🛍️ TRAINER SHOP — LIST ALL BUYABLE TRAINERS
// ==========================================================
// ==========================================================
// 💿 TM shop (TM system phase T3; services/tmShop.js). Off unless
// TM_ENABLED is set. Prices come from the catalog, never the client.
// ==========================================================
app.get("/api/tms", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!requireDashboardSession(req, id)) return res.status(403).json({ error: "Invalid or expired session" });
  const user = trainerData[id];
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(tmShopView(user));
});

// Body: { id, item: "tm_<move>", qty: 1–10, requestId? } — a repeated
// requestId returns the first result and never charges twice.
app.post("/api/shop/buy-tm", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const { id, item, qty = 1, requestId = null } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: "Missing id" });
    if (!requireDashboardSession(req, id)) return res.status(403).json({ success: false, error: "Invalid or expired session" });
    if (!trainerData[id]) return res.status(404).json({ success: false, error: "User not found" });
    if (requestId != null && !REQUEST_ID_PATTERN.test(String(requestId))) return res.status(400).json({ success: false, error: "Invalid request id" });

    const tx = await runInventoryTransaction({
      trainerData,
      userId: id,
      lock: lockUser,
      save: saveAndAck,
      requestId,
      payloadKey: `buy-tm:${String(item).slice(0, 64)}:${Number(qty)}`,
      mutate: (user) => {
        normalizeUserSchema(id, user); // in place
        return buyTms(user, { item, qty: Number(qty) });
      },
    });
    if (!tx.ok) {
      const { ok, status = 400, ...rest } = tx;
      return res.status(status).json({ success: false, ...rest });
    }
    if (!tx.replayed) logEvent("tm_purchase", id, { item: tx.result.item, qty: tx.result.qty, cost: tx.result.cost, ccAfter: tx.result.cc });
    const { ok, ...result } = tx.result;
    return res.json({ ...saveAckFields(tx), success: true, replayed: !!tx.replayed, ...result });
  } catch (err) {
    console.error("❌ /api/shop/buy-tm:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.get("/api/shop-trainers", async (req, res) => {
  try {
    const { getFlattenedTrainers } = await import("./utils/dataLoader.js");
    const trainers = await getFlattenedTrainers();

    const list = trainers.map(t => {
      const tier = (t.tier || t.rarity || "common").toLowerCase();
      return {
        file: t.spriteFile || t.filename,
        name: t.name || t.displayName || t.groupName || "Trainer",
        tier,
        cost: TRAINER_COSTS[tier]
      };
    });

    res.json({ success: true, trainers: list });
  } catch (err) {
    console.error("❌ /api/shop-trainers failed:", err.message);
    res.status(500).json({ success: false });
  }
});

// ======================================================
// 🛒 SHOP — BUY EVOLUTION STONE (SERVER AUTHORITATIVE)
// POST /api/shop/buy-stone { id }
// Returns: { success:true, cc:<number>, stones:<number> }
// ======================================================
app.post("/api/shop/buy-stone", express.json(), async (req, res) => {
  try {
    const { id, requestId } = req.body || {};

    if (!id) return res.status(400).json({ success: false, error: "Missing id" });
    if (!requireDashboardSession(req, id))
      return res.status(403).json({ success: false, error: "Invalid or expired session" });

    if (!trainerData[id])
      return res.status(404).json({ success: false, error: "User not found" });
    if (requestId != null && !REQUEST_ID_PATTERN.test(String(requestId)))
      return res.status(400).json({ success: false, error: "Invalid request id" });

    const COST = 5000; // must match frontend (unchanged in Release B)

    // Release B: one locked, all-or-nothing transaction through the inventory
    // service. A repeated requestId (double click / retried request) returns
    // the first result instead of buying a second stone.
    const tx = await runInventoryTransaction({
      trainerData,
      userId: id,
      lock: lockUser,
      save: saveAndAck,
      requestId: requestId ?? null,
      payloadKey: "buy-stone:1",
      mutate: (user) => {
        normalizeUserSchema(id, user); // in place
        user.cc ??= 0;
        const price = discountedPrice(liveEffects(), "stones", COST); // a Live event's discount
        if (user.cc < price) {
          return { ok: false, error: `Not enough CC — requires ${price} CC.`, cc: user.cc, status: 400 };
        }
        const granted = grantItem(user, "evolution_stone", 1);
        if (!granted.ok) return { ok: false, error: granted.error, status: 400 };
        user.cc -= price;
        trackProgress(user, [{ type: "purchase" }]); // Release C
        return { ok: true, cc: user.cc, stones: granted.quantity };
      },
    });

    if (!tx.ok) {
      const { status = 400, error, cc } = tx;
      return res.status(status).json({ success: false, error, ...(cc != null ? { cc } : {}) });
    }

    if (!tx.replayed) {
      // 📜 Event log — tracks CC sink into the shop for analytics
      // on what players are spending on.
      logEvent("stone_purchase", id, { cost: COST, stonesAfter: tx.result.stones });
    }

    return res.json({
      ...saveAckFields({ saved: tx.saved, note: tx.note }),
      success: true,
      replayed: !!tx.replayed,
      cc: tx.result.cc,
      stones: tx.result.stones,
    });
  } catch (err) {
    console.error("❌ /api/shop/buy-stone:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});


// ===========================================================
// 🧩 POKÉMON PICKER API ENDPOINTS (Supports 6-Pokémon Teams)
// ===========================================================

// ✅ GET full user Pokémon data (for web picker)
app.get("/api/user-pokemon", (req, res) => {
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!requireDashboardSession(req, id))
    return res.status(403).json({ error: "Invalid or expired session" });

  const user = trainerData[id];
  if (!user) return res.status(404).json({ error: "User not found" });

  // --- ensure schema consistency (read-safe) ---
  // This will:
  // - normalize pokemon inventory {normal, shiny}
  // - convert legacy displayedPokemon [243,245] -> [{id:243,variant:"normal"},...]
  // - remove "ghost" displayed entries not owned for that variant
  trainerData[id] = normalizeUserSchema(id, user);

  const u = trainerData[id];

  const items = (u.items && typeof u.items === "object") ? u.items : {};
  const cc = u.cc ?? 0;
  const tp = u.tp ?? 0;
  const rank = getRank(tp);
  const pokemon = u.pokemon ?? {};
  const currentTeam = Array.isArray(u.displayedPokemon) ? u.displayedPokemon : [];
  // Battle team: null when the player has never set one.
  const battleTeam = hasBattleTeam(u) ? u.battleTeam : null;

  ensureWeeklyReset(u);
  const levels = levelsForUser(u); // { "6:normal": 23 } for every owned variant

  // flatten response for front-end
  return res.json({
    id: u.id,
    cc,
    tp,
    rank,
    items,
    pokemon,
    currentTeam, // NEW FORMAT: [{ id: Number, variant: "normal" | "shiny" }]
    battleTeam, // Battle team (ranked/wager), same shape; null = not set
    // Read-only records (B10): this season's ranked record with the same
    // leaderboard position as /leaderboard, and the casual (open battle) one.
    ranked: (() => {
      const r = rankedRecord(u);
      const board = rankBattleRatings(trainerData, id);
      return { ...r, position: board.you?.position ?? null, players: board.total, streak: r.wins + r.losses > 0 ? Number(u.stats?.winStreak) || 0 : 0 };
    })(),
    casual: { wins: u.casual?.wins ?? 0, losses: u.casual?.losses ?? 0, streak: u.casual?.streak ?? 0, bestStreak: u.casual?.bestStreak ?? 0 },
    challenge: challengeProgress(u), // the Badge row (/challenge)
    // Read-only: each owned variant's Level and Power (six-stat total, same as /showteam).
    levels,
    powers: powersFromLevels(levels), // { "6:normal": 410 }
    // TM system (T5): trained copies per line, for the copy choosers in
    // donate / evolve / shiny craft / Teams. { "6:normal": [{ uid, rev, tmMoves, teams }] }
    trained: trainedSummary(u),
    showcaseTeam: Array.isArray(u.showcaseTeam) ? u.showcaseTeam : [], // three-teams split
    // Pokédex (ever caught; never drops): { id: 1 normal | 2 shiny | 3 both }.
    pokedex: u.pokedex ?? {},
    // Collection: every copy, one entry each (docs/adr/0001), for the box grid.
    // [uid, id, shiny 0|1, level, caughtAt|0, trained 0|1, teams bitmask (1 casual, 2 ranked, 4 showcase), exp]
    copies: copyRows(u),
    nonShinyDustEarnedThisWeek: u.nonShinyDustEarnedThisWeek ?? 0,
    // One-time notices (services/notices.js); the Teams page shows the
    // Battle team ones and dismisses them via /api/dismiss-notices.
    notices: peekNotices(u, NOTICE_KINDS.BATTLE_TEAM_TRIM).map(({ id: nid, kind, text }) => ({ id: nid, kind, text })),
  });
});

// ✅ POST — dismiss one-time notices the dashboard has shown.
app.post("/api/dismiss-notices", express.json(), async (req, res) => {
  try {
    const { id, ids } = req.body ?? {};
    if (!id || !Array.isArray(ids) || !ids.every((x) => typeof x === "string")) {
      return res.status(400).json({ success: false, error: "Missing id/ids" });
    }
    if (!requireDashboardSession(req, id)) {
      return res.status(403).json({ success: false, error: "Invalid or expired session" });
    }
    await lockUser(id, async () => {
      const u = trainerData[id];
      if (!u) return res.status(404).json({ success: false, error: "User not found" });
      const removed = clearNotices(u, ids);
      const saveAck = removed ? await saveAndAck(trainerData) : null;
      return res.json({ ...(saveAck ? saveAckFields(saveAck) : {}), success: true, removed });
    });
  } catch (err) {
    console.error("❌ /api/dismiss-notices:", err?.message || err);
    return res.status(500).json({ success: false });
  }
});


// ✅ GET — one Pokémon's details for the Collection drawer (B2). Read-only:
// stats, moves and EXP from the same functions as the Discord cards.
app.get("/api/pokemon/detail", (req, res) => {
  const { id, species } = req.query;
  if (!id || species == null) return res.status(400).json({ error: "Missing id/species" });
  if (!requireDashboardSession(req, id)) return res.status(403).json({ error: "Invalid or expired session" });
  const user = trainerData[id];
  if (!user) return res.status(404).json({ error: "User not found" });
  const { status, body } = pokemonDetail(user, species);
  return res.status(status).json(body);
});

// ✅ POST — a copy's chosen moveset for one team (owner: separate per team).
// Body: { id, team: "display"|"battle", pokeId, variant, moves: [moveId…] | null }
// moves null → automatic moves again. 1–4 distinct moves it has learned
// (level-up at or below its real Level; TMs later). services/movesets.js.
app.post("/api/pokemon/moveset", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const { id, team, pokeId, variant, moves, uid = null } = req.body || {};
    if (!id || pokeId == null) return res.status(400).json({ success: false, error: "Missing id/pokeId" });
    if (!TEAM_TYPES.includes(team)) return res.status(400).json({ success: false, error: "Unknown team type" });
    if (!requireDashboardSession(req, id)) return res.status(403).json({ success: false, error: "Invalid or expired session" });
    await lockUser(id, async () => {
      const u = trainerData[id];
      if (!u) return res.status(404).json({ success: false, error: "User not found" });
      // uid: the slot's copy (box copy or TM copy); absent = the line's plain copies.
      const r = saveMoveset(u, { team, pokeId, variant, moves, uid });
      if (!r.ok) return res.status(r.status ?? 400).json({ success: false, error: r.error, code: r.code });
      const saveAck = await saveAndAck(trainerData);
      return res.json({ ...saveAckFields(saveAck), success: true, team, ...(r.uid && { uid: r.uid }), moves: r.moves });
    });
  } catch (err) {
    console.error("❌ /api/pokemon/moveset:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ==========================================================
// 💿 Teach a TM (TM system phase T4; services/tmTeaching.js). Off unless
// TM_ENABLED is set. The client sends ids and the moves it showed; the
// server re-checks everything and refuses (TM kept) if anything changed.
// ==========================================================
app.get("/api/pokemon/tm-options", (req, res) => {
  const { id, species, variant } = req.query;
  if (!id || species == null) return res.status(400).json({ error: "Missing id/species" });
  if (!requireDashboardSession(req, id)) return res.status(403).json({ error: "Invalid or expired session" });
  const user = trainerData[id];
  if (!user) return res.status(404).json({ error: "User not found" });
  const r = teachOptions(user, { speciesId: species, variant });
  if (!r.ok) { const { ok, status = 400, ...rest } = r; return res.status(status).json(rest); }
  const { ok, ...body } = r;
  return res.json(body);
});

// Body: { id, item, pokeId, variant, uid|null, rev, expect, equip, requestId? }
app.post("/api/pokemon/teach-tm", express.json({ limit: "8kb" }), async (req, res) => {
  try {
    const { id, item, pokeId, variant, uid = null, rev = null, expect = null, equip = null, requestId = null } = req.body || {};
    if (!id || pokeId == null || !item) return res.status(400).json({ success: false, error: "Missing id/pokeId/item" });
    if (!requireDashboardSession(req, id)) return res.status(403).json({ success: false, error: "Invalid or expired session" });
    if (!trainerData[id]) return res.status(404).json({ success: false, error: "User not found" });
    if (requestId != null && !REQUEST_ID_PATTERN.test(String(requestId))) return res.status(400).json({ success: false, error: "Invalid request id" });
    const tx = await runInventoryTransaction({
      trainerData,
      userId: id,
      lock: lockUser,
      save: saveAndAck,
      requestId,
      payloadKey: `teach-tm:${String(item).slice(0, 64)}:${Number(pokeId)}:${variant === "shiny" ? "shiny" : "normal"}:${uid ?? "untrained"}`,
      mutate: (user) => {
        normalizeUserSchema(id, user); // in place
        return teachTm(user, { item, pokeId, variant, uid, rev, expect, equip }, { requestId });
      },
    });
    if (!tx.ok) { const { ok, status = 400, ...rest } = tx; return res.status(status).json({ success: false, ...rest }); }
    if (!tx.replayed) logEvent("tm_taught", id, { item: tx.result.item, move: tx.result.move.id, pokemonId: Number(pokeId), variant: variant === "shiny" ? "shiny" : "normal", uid: tx.result.uid, created: tx.result.created });
    const { ok, ...result } = tx.result;
    return res.json({ ...saveAckFields(tx), success: true, replayed: !!tx.replayed, ...result });
  } catch (err) {
    console.error("❌ /api/pokemon/teach-tm:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ✅ POST — set full Pokémon team (up to 6) — Variant-safe + Ghost Auto-Clean
// teamType: "display" (default; user.displayedPokemon, as before) or
// "battle" (user.battleTeam; also at most one mythic-tier Pokémon,
// services/battleTeam.js). Old clients send no teamType and are unchanged.
// NEW TEAM FORMAT (frontend -> backend):
// team = [{ id: 243, variant: "normal" }, { id: 245, variant: "shiny" }, ...]
// Back-compat accepted:
// team = [243,245,3]  (treated as normal variants)
// team = [{ id: 243 }, ...] (missing variant -> normal)
app.post("/api/set-pokemon-team", express.json(), async (req, res) => {
  try {
    const { id, team } = req.body;
    const teamType = req.body?.teamType ?? "display";

    if (!id || !Array.isArray(team)) {
      return res.status(400).json({ success: false, error: "Missing id/team" });
    }
    if (teamType !== "display" && teamType !== "battle" && teamType !== "showcase") {
      return res.status(400).json({ success: false, error: "Unknown team type" });
    }
    if (!requireDashboardSession(req, id)) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid or expired session" });
    }
    // Showcase team (three-teams split): its own rules (repeats as separate
    // copies, any unlocked Megas, no moves or items), so its own short path.
    if (teamType === "showcase") {
      return await lockUser(id, async () => {
        const user = trainerData[id];
        if (!user) return res.status(404).json({ success: false, error: "User not found" });
        const u = normalizeUserSchema(id, user);
        const prepared = prepareShowcaseSelection(u, team);
        if (!prepared.ok) return res.status(prepared.status).json({ success: false, error: prepared.error, code: prepared.code });
        u.showcaseTeam = prepared.team;
        const saveAck = await saveAndAck(trainerData);
        return res.json({ ...saveAckFields(saveAck), success: true, teamType, showcaseTeam: u.showcaseTeam, currentTeam: u.displayedPokemon, battleTeam: hasBattleTeam(u) ? u.battleTeam : null });
      });
    }
    // Optional: this team was copied from the other one (Teams page "Copy
    // from …"); the copied Pokémon's moves come along in the same write.
    const copy = parseTeamCopy(req.body, teamType);
    if (!copy.ok) return res.status(copy.status).json({ success: false, error: copy.error, code: copy.code });

    await lockUser(id, async () => {
      const user = trainerData[id];
      if (!user) {
        return res
          .status(404)
          .json({ success: false, error: "User not found" });
      }

      // Normalize schema + migrate displayedPokemon to variant objects if needed
      trainerData[id] = normalizeUserSchema(id, user);
      const u = trainerData[id];


      // 1) Auto-clean existing displayedPokemon (remove ghost variant slots;
      //    keeps a valid Mega selection — services/megaTeam.js)
      normalizeDisplayedTeam(u);

      // 2–4) Parse, 1–6 unique (id + variant) slots, ownership per variant,
      //      and the Mega rules (one Mega, not with its own base, unlocked,
      //      MEGA_TEAMS capability) — services/megaTeam.js prepareTeamSelection.
      //      Battle team: the same rules plus at most one mythic-tier Pokémon.
      const prepared = teamType === "battle" ? prepareBattleTeamSelection(u, team) : prepareTeamSelection(u, team);
      if (!prepared.ok) {
        return res.status(prepared.status).json({ success: false, error: prepared.error, code: prepared.code });
      }
      // TM system: a slot sent without `uid` keeps the trained copy it held
      // (older clients don't know about trained copies); `uid: null` = untrained.
      const normalized = carryCopyUids(u, teamType === "battle" ? u.battleTeam : u.displayedPokemon, prepared.team, team);

      // 5) Save
      if (teamType === "battle") u.battleTeam = normalized;
      else u.displayedPokemon = normalized;
      const copiedMoves = copy.copy ? applyTeamCopy(u, { ...copy.copy, to: teamType }, normalized) : [];
      trainerData[id] = u;
      // Held items on this team follow it: a Pokémon that left the team, or
      // is now set to Mega Evolve, drops its assignment on THIS team only
      // (the unlock and every other team are untouched).
      const itemsCleared = reconcileTeamEquipment(u, teamType);

      const saveAck = await saveAndAck(trainerData);

      return res.json({
        ...saveAckFields(saveAck),
        success: true,
        teamType,
        currentTeam: u.displayedPokemon,
        battleTeam: hasBattleTeam(u) ? u.battleTeam : null,
        ...(itemsCleared.length ? { itemsCleared, equipmentRev: equipmentRev(u) } : {}),
        ...(copy.copy ? { copiedMoves } : {}),
      });
    });
  } catch (err) {
    console.error("❌ /api/set-pokemon-team:", err?.message || err);
    return res.status(500).json({ success: false });
  }
});


// ==========================================================
// 🧬 EVOLVE — Atomic Per-User Lock Version (variant-aware)
// ✅ Supports evolving normal OR shiny (via {shiny:true/false} OR {variant:"normal"|"shiny"})
// ✅ NEW: blocks evolving a Pokémon variant if it's currently displayed on the user's team
// ==========================================================
app.post("/api/pokemon/evolve", express.json(), async (req, res) => {
  try {
    const r = await gameplay.evolve({ body: req.body || {}, isAuthorized: (id) => requireDashboardSession(req, id) });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error("❌ /api/pokemon/evolve:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ==========================================================
// 💝 Donate Pokémon (normal + shiny supported, 5× CC for shiny)
// ✅ blocks donating a Pokémon variant if it's displayed
// ✅ awards shiny dust:
//    - shiny donation: fixed dust by tier
//    - non-shiny donation: probability-based dust by tier
// ==========================================================
// TM safety (phase T0): the copy is chosen by services/ownership.js through
// utils/bulkDonate.js donateOne(): always a plain copy; a copy with
// TM-trained moves is never picked automatically (refused instead).
// Optional client requestId: a repeat returns the first result and never
// donates twice (double click / retried request).
app.post("/api/pokemon/donate", express.json(), async (req, res) => {
  try {
    const { id, pokeId, shiny, variant, requestId = null, uid = null, rev = null, confirmTrained = false } = req.body || {};

    if (!id) return res.status(400).json({ error: "Missing id" });
    if (pokeId == null) return res.status(400).json({ error: "Missing pokeId" });

    if (!requireDashboardSession(req, id)) {
      return res.status(403).json({ error: "Invalid or expired session" });
    }
    if (!trainerData[id]) return res.status(404).json({ error: "User not found" });
    if (requestId != null && !REQUEST_ID_PATTERN.test(String(requestId))) {
      return res.status(400).json({ error: "Invalid request id" });
    }

    const chosenVariant = typeof variant === "string" ? normVariant(variant) : (shiny ? "shiny" : "normal");
    const pokemonData = await getPokemonDataCached(); // before the lock (A1 pattern)

    const tx = await runInventoryTransaction({
      trainerData,
      userId: id,
      lock: lockUser,
      save: saveAndAck,
      requestId,
      payloadKey: `donate:${Number(pokeId)}:${chosenVariant}:${uid ?? "untrained"}`,
      mutate: (u) => {
        normalizeUserSchema(id, u); // in place
        ensureWeeklyReset(u);
        const r = donateOne({
          user: u,
          pokeId,
          variant: chosenVariant,
          pokemonData,
          economy: donationEconomy(),
          isOnTeam: (pid, v) => isDisplayedVariant(u, pid, v),
          // T5: a named trained copy, with the TM warning confirmed
          uid: uid == null ? null : String(uid),
          rev,
          confirmTrained: confirmTrained === true,
        });
        if (r.error) return { ok: false, status: 400, error: r.error, ...(r.code && { code: r.code }), ...(r.protected && { protected: r.protected }) };
        trackProgress(u, [{ type: "donated" }]); // Release C
        const ev = r.event;
        return {
          ok: true,
          event: ev,
          donated: { id: ev.pokemonId, name: ev.pokemonName, variant: ev.variant },
          gainedCC: ev.ccGained,
          totalCC: u.cc,
          shinyDustGained: ev.dustGained,
          shinyDustTotal: getItem(u, "shiny_dust"),
          nonShinyDustWeeklyRemaining: ev.variant === "shiny" ? null : Math.max(0, NON_SHINY_DUST_WEEKLY_CAP - (u.nonShinyDustEarnedThisWeek ?? 0)),
        };
      },
    });
    if (!tx.ok) {
      const { ok, status = 400, ...rest } = tx;
      return res.status(status).json(rest);
    }

    // 📜 Event log — donations are half of the CC-flow picture (rolls
    // being the other half). Never logged twice for a replayed request.
    const { event, ok, ...body } = tx.result;
    if (!tx.replayed) logEvent("donate", id, event);

    return res.json({ ...saveAckFields(tx), success: true, replayed: !!tx.replayed, ...body });
  } catch (err) {
    console.error("❌ /api/pokemon/donate:", err?.message || err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ==========================================================
// 💝 Bulk Donate — Donate Duplicates + Multi-select
// Rules + rewards live in utils/bulkDonate.js (all-or-nothing).
// NOTE: unlike the single donate above, "duplicates" mode may donate
// extras of a Team variant. It always keeps 1 copy, so the Team slot
// stays valid. Multi-select still refuses Team members.
// ==========================================================
app.post("/api/pokemon/donate-bulk", express.json({ limit: "100kb" }), async (req, res) => {
  try {
    const { id, mode, items, requestId = null } = req.body || {};

    if (!id) return res.status(400).json({ error: "Missing id" });

    if (!requireDashboardSession(req, id)) {
      return res.status(403).json({ error: "Invalid or expired session" });
    }
    if (!trainerData[id]) return res.status(404).json({ error: "User not found" });
    if (requestId != null && !REQUEST_ID_PATTERN.test(String(requestId))) {
      return res.status(400).json({ error: "Invalid request id" });
    }

    const pokemonData = await getPokemonDataCached(); // before the lock (A1 pattern)
    // Same id + same list → replay; same id + different list → conflict.
    const payloadKey = `donate-bulk:${mode}:${crypto.createHash("sha256").update(JSON.stringify(items ?? null)).digest("hex").slice(0, 32)}`;

    const tx = await runInventoryTransaction({
      trainerData,
      userId: id,
      lock: lockUser,
      save: saveAndAck,
      requestId,
      payloadKey,
      mutate: (u) => {
        normalizeUserSchema(id, u); // in place
        ensureWeeklyReset(u); // dust cap must reflect the current week before rolling
        const result = bulkDonate({
          user: u,
          mode,
          items,
          pokemonData,
          economy: donationEconomy(),
          isOnTeam: (pid, variant) => isDisplayedVariant(u, pid, variant),
        });
        if (result.error) return { ok: false, status: 400, error: result.error };
        trackProgress(u, [{ type: "donated", n: result.donatedCopies }]); // Release C
        return { ok: true, ...result };
      },
    });
    if (!tx.ok) {
      const { ok, status = 400, ...rest } = tx;
      return res.status(status).json(rest);
    }

    // One event per copy, same shape as single donate, so admin analytics
    // count bulk donations without special-casing. logEvent never throws.
    if (!tx.replayed) for (const ev of tx.result.events) logEvent("donate", id, { ...ev, source: mode });

    return res.json({ ...saveAckFields(tx),
      success: true,
      replayed: !!tx.replayed,
      donatedCopies: tx.result.donatedCopies,
      gainedCC: tx.result.gainedCC,
      shinyDustGained: tx.result.shinyDustGained,
    });
  } catch (err) {
    console.error("❌ /api/pokemon/donate-bulk:", err?.message || err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


// ==========================================================
// ✨ Convert Normal -> Shiny (Atomic, variant-aware)
// Costs dust by tier of the Pokémon being converted.
// Blocks converting if the NORMAL variant is currently displayed.
// ==========================================================
app.post("/api/pokemon/feed", express.json(), async (req, res) => {
  try {
    const r = await gameplay.feed({ body: req.body || {}, isAuthorized: (id) => requireDashboardSession(req, id) });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error("❌ /api/pokemon/feed:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post("/api/pokemon/convert-to-shiny", express.json(), async (req, res) => {
  try {
    const r = await gameplay.convertToShiny({ body: req.body || {}, isAuthorized: (id) => requireDashboardSession(req, id) });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error("❌ /api/pokemon/convert-to-shiny:", err?.message || err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

 // ==========================================================
// 🤖 BOT READY EVENT
// ==========================================================
// ==========================================================
// ⚔️ Wager battles: refund Stakes left pending by a restart
// Offer buttons die with the old process, so every pending Stake is
// refunded once trainerData is loaded, and the offer message is edited.
// ==========================================================
async function refundPendingWagersOnStartup() {
  const refunded = refundAllPending(trainerData);
  if (!refunded.length) return;
  await enqueueSave(trainerData, { force: true });
  console.log(`⚔️ Refunded ${refunded.length} pending wager stake(s) after restart`);
  for (const { channelId, messageId } of refunded) {
    if (!channelId || !messageId) continue;
    try {
      const channel = await client.channels.fetch(channelId);
      const message = await channel.messages.fetch(messageId);
      await message.edit({ content: "Wager expired (bot restarted). Stake refunded.", embeds: [], components: [] });
    } catch {}
  }
}

// ==========================================================
// ⚔️ Rematch requests: close requests left open by a restart
// Their buttons die with the old process, so every open request is closed
// (blocking nobody) and its message edited.
// ==========================================================
async function closeRematchRequestsOnStartup() {
  const closed = closeAllRematches(trainerData);
  if (!closed.length) return;
  await enqueueSave(trainerData, { force: true });
  console.log(`⚔️ Closed ${closed.length} open rematch request(s) after restart`);
  for (const { channelId, messageId } of closed) {
    if (!channelId || !messageId) continue;
    try {
      const channel = await client.channels.fetch(channelId);
      const message = await channel.messages.fetch(messageId);
      await message.edit({ content: "Rematch request expired because the bot restarted.", components: [] });
    } catch {}
  }
}

// ==========================================================
// An Elite Four run waits on the player's record between fights, and the
// command playing it dies with the old process, so every open run is
// finished at startup with no Revives, and its replay message gets the result.
// ==========================================================
async function finishOpenRunsOnStartup() {
  const finished = finishAllOpenRuns(trainerData, new Date());
  if (!finished.length) return;
  await enqueueSave(trainerData, { force: true });
  console.log(`⚔️ Finished ${finished.length} open Elite Four run(s) after restart`);
  for (const { userId, outcome, channelId, messageId } of finished) {
    logEvent("challenge", userId, { ...challengeLogEntry(outcome), finished: "restart" });
    recordFight(() => challengeRecord(outcome, trainerData[userId]?.name, trainerData));
    if (!channelId || !messageId) continue;
    try {
      const channel = await client.channels.fetch(channelId);
      const message = await channel.messages.fetch(messageId);
      await showRunResult(message, outcome, challengeNames(outcome, trainerData[userId]?.name || "Trainer"),
        `⚔️ The bot restarted, so <@${userId}>'s Elite Four run finished without Revives.`);
    } catch {}
  }
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  hasBeenReadyOnce = true;
  lastGatewayOk = Date.now();
  isReady = false;

  // 🧹 Prune old events on startup, then schedule a daily prune.
  // Keeps the NDJSON log bounded without needing a separate worker.
  try { await pruneEvents(); } catch {}
  setInterval(() => {
    pruneEvents().catch(() => {});
  }, 24 * 60 * 60 * 1000);

  // 🎪 Live events: load the schedule, then post start/end announcements
  // every 30 s once the bot is ready (also posts boundaries passed while down).
  await loadLiveEvents();
  setInterval(() => {
    if (!isReady) return;
    postDueAnnouncements({
      send: async (channelId, embed) => {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased?.()) return false;
        await channel.send({ embeds: [embed] });
        return true;
      },
    }).catch((e) => console.warn("⚠️ Live event announcements failed:", e?.message || e));
  }, 30_000);

  // Load local commands FIRST
  try {
    await loadLocalCommands();
  } catch (e) {
    console.error("❌ loadLocalCommands failed:", e?.message || e);
  }

  // Register only if enabled (REST)
  if (process.env.REGISTER_COMMANDS === "true") {
    try {
      await registerCommands();
    } catch (e) {
      console.warn("⚠️ registerCommands failed (continuing):", e?.message || e);
    }
  }

  // Attempt load once
  async function attemptLoad() {
    let result;
    try {
      result = await loadTrainerData();
    } catch (e) {
      result = { ok: false, blocked: `load error: ${e?.message || e}` };
    }

    if (!result.ok) {
      loadBlockedReason = result.blocked || "unknown";
      return false;
    }

    trainerData = result.data;
    loadBlockedReason = null;
    loadedFrom = result.chosen.source;
    markLoaded(); // writes allowed from here on

    // Report-only integrity audit (counts by problem type; never IDs or values).
    try {
      const audit = auditTrainerData(trainerData);
      // Release B: how many records had item values set aside (itemsLegacy) by
      // the inventory normalizer — a count only, never ids or values.
      const legacyItems = Object.values(trainerData).filter((u) => Array.isArray(u?.itemsLegacy) && u.itemsLegacy.length).length;
      console.log(`🎒 Inventory: ${legacyItems} record(s) with set-aside item values (itemsLegacy)`);
      if (audit.usersWithProblems) {
        console.warn(`🩺 Data audit: ${audit.usersWithProblems}/${audit.users} records need attention`, audit.counts);
      } else {
        console.log(`🩺 Data audit: ${audit.users} records OK`);
      }
    } catch (e) {
      console.warn("⚠️ Data audit failed (ignored):", e?.message || e);
    }

    // Put the loaded snapshot on local disk right away if it didn't come
    // from there (first boot on a new volume, or Discord was newer).
    if (result.chosen.source !== "local") {
      enqueueSave(trainerData, { force: true }).then((saved) =>
        console.log(saved ? "💾 Loaded snapshot written to local storage" : "⚠️ Could not write loaded snapshot locally (will retry)")
      );
    }
    return true;
  }

  const ok = await attemptLoad();

  if (!ok) {
    // CRITICAL: do NOT exit (prevents relogin loops / temp bans)
    console.error("⛔ Startup: trainerData not available yet. Bot will stay ONLINE but NOT READY.");
    isReady = false;

    // Retry in background with backoff
  let retryMs = 60_000;            // 1 minute
const maxRetryMs = 30 * 60_000;  // 30 minutes

async function retryLoadLoop() {
  if (shuttingDown) return;

  console.log(`🔁 Retrying trainerData load... (${Math.round(retryMs / 1000)}s delay)`);
  const ok2 = await attemptLoad();

  if (ok2) {
    await refundPendingWagersOnStartup().catch((e) => console.warn("⚠️ wager refund failed:", e?.message || e));
    await closeRematchRequestsOnStartup().catch((e) => console.warn("⚠️ closing rematch requests failed:", e?.message || e));
    await finishOpenRunsOnStartup().catch((e) => console.warn("⚠️ finishing open runs failed:", e?.message || e));
    isReady = true;
    console.log("✨ Bot is now READY (trainerData loaded)!");
    startDexBackfill();
    return;
  }

  retryMs = Math.min(maxRetryMs, Math.floor(retryMs * 1.5));
  setTimeout(retryLoadLoop, retryMs);
}

// kick it off
setTimeout(retryLoadLoop, retryMs);

    return;
  }

  await refundPendingWagersOnStartup().catch((e) => console.warn("⚠️ wager refund failed:", e?.message || e));
  await closeRematchRequestsOnStartup().catch((e) => console.warn("⚠️ closing rematch requests failed:", e?.message || e));
  await finishOpenRunsOnStartup().catch((e) => console.warn("⚠️ finishing open runs failed:", e?.message || e));
  isReady = true;
  console.log("✨ Bot ready and accepting commands!");
  startDexBackfill();
});

// ==========================================================
// 📖 Pokédex backfill from the bot's own backup history (docs/adr/0001,
// services/dexBackfill.js). Runs once, in the background, after the bot is
// ready: reads the storage channel slowly (read-only) and adds every species
// a player ever had in a backup to their Pokédex. Resumes after a restart;
// POKEDEX_SCAN=off skips it.
// ==========================================================
let dexScanRunning = false;
function startDexBackfill() {
  if (dexScanRunning || process.env.POKEDEX_SCAN === "off" || !process.env.STORAGE_CHANNEL_ID) return;
  const dir = dataDir();
  const state = readDexScanState(dir);
  if (state?.done) return console.log(`📖 Pokédex scan: done earlier (${state.backups} backups, ${state.added} species for ${state.players} players)`);
  dexScanRunning = true;
  console.log(state?.cursor ? `📖 Pokédex scan: resuming (${state.backups} backups read so far)` : "📖 Pokédex scan: starting (reads the backup history in the background)");
  let lastLog = state?.backups ?? 0;
  runDexBackfill({
    listPage: (before) => listBackupPage(client, process.env.STORAGE_CHANNEL_ID, before),
    download: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },
    trainerData,
    state,
    saveState: (st) => {
      try { writeDexScanState(dir, st); } catch (e) { console.warn("⚠️ Pokédex scan state not saved:", e?.message || e); }
      if (st.backups - lastLog >= 100) { lastLog = st.backups; console.log(`📖 Pokédex scan: ${st.backups} backups read, ${st.added} species added for ${st.players} players`); }
    },
    onChanged: () => { enqueueSave(trainerData); },
    shouldStop: () => shuttingDown,
    pauseMs: 1000,
    log: (m) => console.warn(`📖 Pokédex scan: ${m}`),
  })
    .then((st) => console.log(st.done
      ? `📖 Pokédex scan finished: ${st.backups} backups read, ${st.skipped} skipped, ${st.added} species added for ${st.players} players, ${st.unlocks} achievements unlocked`
      : `📖 Pokédex scan paused at ${st.backups} backups; resumes next boot`))
    .catch((e) => console.warn("⚠️ Pokédex scan stopped (resumes next boot):", e?.message || e))
    .finally(() => { dexScanRunning = false; });
}

// ==========================================================
// 🚀 LAUNCH WEB SERVER
// ==========================================================
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Listening on port ${PORT}`)
);

// ==========================================================
// 🚀 LAUNCH (SMART LOGIN: HANDLE 429 "TEMP BLOCK" + NO READY WATCHDOG KILL)
// ==========================================================
console.log("🚀 About to login to Discord... BOT_TOKEN present?", !!process.env.BOT_TOKEN);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Returns { ok, status, blocked, retryAfterMs }
async function discordPreflight() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN missing");

  const url = "https://discord.com/api/v10/gateway/bot";
  const res = await fetch(url, {
    headers: {
      Authorization: `Bot ${token}`,
      "user-agent": "coops-bot-preflight",
      "accept": "application/json",
    },
  });

  const text = await res.text();

  // HTML detection — only match actual HTML pages, not JSON containing "cloudflare"
  const looksHtml =
    /<!doctype html/i.test(text) ||
    /<html/i.test(text);

  if (looksHtml) {
    const snippet = text.slice(0, 1500).replace(/\n/g, " ");
    console.warn(`⛔ Preflight got HTML (status ${res.status})`);
    console.warn(`⛔ Response: ${snippet}`);
    console.warn("⛔ Discord Cloudflare HTML block detected. Cooling off for 6 hours.");
    return {
      ok: false,
      status: res.status,
      blocked: true,
      retryAfterMs: 6 * 60 * 60 * 1000, // 6 hours
    };
  }

  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  console.log("🔑 preflight /gateway/bot status:", res.status);
  if (res.status !== 200) {
    const snippet = text.slice(0, 1500).replace(/\n/g, " ");
    console.warn(`⚠️ Preflight response: ${snippet}`);
  }

  // Token invalid/revoked
  if (res.status === 401 || res.status === 403) {
    throw new Error(`BOT_TOKEN invalid (status ${res.status})`);
  }

  // Discord temp-block / rate limit
  if (res.status === 429) {
    const retryAfterSec =
      (typeof json?.retry_after === "number" ? json.retry_after : null);

    const retryAfterMs =
      retryAfterSec != null
        ? clamp(Math.ceil(retryAfterSec * 1000), 60_000, 30 * 60_000)
        : 30 * 60_000; // safer fallback than 10m

    return {
      ok: false,
      status: 429,
      blocked: true,
      retryAfterMs,
    };
  }

  return { ok: res.ok, status: res.status, blocked: false, retryAfterMs: 0 };
}

async function loginOnceWithTimeout(timeoutMs = 180_000) {
  return Promise.race([
    safeLogin(), // ✅ use throttled login
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Discord login timeout after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

let loginCompleted = false;

// IMPORTANT: only enforce "must reach READY" AFTER login succeeds.
// (Otherwise you kill the process while Discord is 429-blocking you.)
function startReadyWatchdog() {
  setTimeout(() => {
    if (!loginCompleted) return; // still not logged in, don't kill
    if (!hasBeenReadyOnce) {
      console.error("❌ Startup watchdog: login completed but never reached Discord READY — exiting to restart");
      process.exit(1);
    }
  }, 5 * 60_000);
}

async function loginLoop() {
  let attempt = 0;

  while (!shuttingDown) {
    attempt++;

    // Always preflight before attempting login
    try {
      const pf = await discordPreflight();

      if (pf.blocked) {
        console.warn(
          `⛔ Discord API rate-limited / temp blocked (429). Sleeping ${Math.round(
            pf.retryAfterMs / 1000
          )}s before retry...`
        );
        await sleep(pf.retryAfterMs);
        continue; // do NOT attempt login while blocked
      }

      console.log("✅ Discord preflight OK — attempting login...");
    } catch (e) {
      const msg = e?.message || String(e);
      console.error("❌ Discord preflight failed:", msg);

      // If token is bad, retrying is pointless; wait longer but keep alive.
      if (msg.includes("BOT_TOKEN invalid")) {
        console.error("🚫 Fix BOT_TOKEN in Render env vars. Retrying in 10 minutes.");
        await sleep(10 * 60_000);
        continue;
      }

      // Network hiccup: backoff and retry
      const backoffMs = clamp(5_000 * attempt, 5_000, 120_000);
      console.log(`⏳ Preflight backoff ${Math.round(backoffMs / 1000)}s...`);
      await sleep(backoffMs);
      continue;
    }

    // Login attempt
    try {
      console.log(`🔌 Discord login attempt #${attempt}...`);
      await loginOnceWithTimeout(180_000);
      loginCompleted = true;
      console.log("✅ client.login() resolved");
      startReadyWatchdog(); // only now
      return;
    } catch (err) {
      console.error("❌ client.login failed/timeout:", err?.stack || err);

      // Backoff, but not too aggressive
      const backoffMs = clamp(10_000 * attempt, 10_000, 120_000);
      console.log(`⏳ Waiting ${Math.round(backoffMs / 1000)}s before retry...`);
      await sleep(backoffMs);
    }
  }
}

loginLoop().catch((e) => {
  console.error("❌ loginLoop crashed:", e?.stack || e);
  // keep process alive; Render will restart if needed
});
