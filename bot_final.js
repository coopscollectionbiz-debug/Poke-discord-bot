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

// Local saver — writes trainerData.json to disk & marks dirty
import {
  enqueueSave,
  shutdownFlush,
  saveTrainerDataLocal
} from "./utils/saveQueue.js";

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
  // do NOT exit; avoid login loops / temp bans
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  // do NOT exit; if you want, set a flag and let your health watchdog decide later
});


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


// ==========================================================
// 🧠 Pokémon Variant + Items Helpers (GLOBAL, SINGLE SOURCE)
// ==========================================================
function normVariant(v) {
  return String(v || "normal").toLowerCase() === "shiny" ? "shiny" : "normal";
}

function toTeamObj(entry) {
  if (typeof entry === "number") return { id: entry, variant: "normal" };
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

function isDisplayedVariant(user, pokeId, variant) {
  const teamRaw = Array.isArray(user.displayedPokemon) ? user.displayedPokemon : [];
  const team = teamRaw.map(toTeamObj).filter(Boolean);
  const pid = Number(pokeId);
  const v = normVariant(variant);
  return team.some((t) => t.id === pid && t.variant === v);
}

// ==========================================================
// ✨ SHINY DUST ECONOMY (Single Source of Truth)
// ==========================================================
function tierKey(t) {
  return String(t || "common").toLowerCase();
}

const DUST_REWARD_BY_TIER = {
  common: 4,
  uncommon: 7,
  rare: 12,
  epic: 18,
  legendary: 22,
  mythic: 30,
};

const SHINY_CRAFT_COST_BY_TIER = {
  common: 15,
  uncommon: 25,
  rare: 40,
  epic: 60,
  legendary: 80,
  mythic: 120,
};

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
function rollWeightedDust(table = []) {
  let r = Math.random();
  for (const entry of table) {
    r -= Number(entry.chance) || 0;
    if (r <= 0) return Number(entry.dust) || 0;
  }
  return 0; // safety fallback
}

// ----- item helpers (map-safe; no schema churn) -----
function getItem(user, key) {
  const v = user?.items?.[key];
  return Number.isFinite(v) ? v : 0;
}
function addItem(user, key, amount) {
  user.items ??= {};
  const add = Math.max(0, Math.floor(Number(amount) || 0));
  user.items[key] = getItem(user, key) + add;
  return user.items[key];
}
function spendItem(user, key, amount) {
  user.items ??= {};
  const cost = Math.max(0, Math.floor(Number(amount) || 0));
  if (getItem(user, key) < cost) return false;
  user.items[key] = getItem(user, key) - cost;
  return true;
}

// Craft cost for converting normal -> shiny by tier
function craftCostForTier(tier) {
  return SHINY_CRAFT_COST_BY_TIER[tierKey(tier)] ?? 0;
}

// Shiny evolve dust uses the "difference" rule
function shinyEvolveDustCost(baseTier, targetTier) {
  return Math.max(0, craftCostForTier(targetTier) - craftCostForTier(baseTier));
}

// ==========================================================
// 🗓️ NON-SHINY DUST WEEKLY CAP (UTC ISO WEEK)
// ==========================================================
// ==========================================================
// 🗓️ NON-SHINY DUST WEEKLY CAP (UTC ISO WEEK)
// ==========================================================
const NON_SHINY_DUST_WEEKLY_CAP = 8;

function getISOWeekKeyUTC(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sun=0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function ensureNonShinyDustWeek(u) {
  const key = getISOWeekKeyUTC();

  // sanitize fields
  if (typeof u.nonShinyDustWeekKey !== "string") u.nonShinyDustWeekKey = "";
  u.nonShinyDustEarnedThisWeek = Number.isFinite(u.nonShinyDustEarnedThisWeek)
    ? Math.max(0, Math.floor(u.nonShinyDustEarnedThisWeek))
    : 0;

  // roll week if changed
  if (u.nonShinyDustWeekKey !== key) {
    u.nonShinyDustWeekKey = key;
    u.nonShinyDustEarnedThisWeek = 0;
  }

  // clamp to cap
  if (u.nonShinyDustEarnedThisWeek > NON_SHINY_DUST_WEEKLY_CAP) {
    u.nonShinyDustEarnedThisWeek = NON_SHINY_DUST_WEEKLY_CAP;
  }
}

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

// Flush loop
setInterval(async () => {
  if (!pendingRoleUpdates.size) return;

  // Snapshot & clear quickly so we don't block incoming events
  const batch = [...pendingRoleUpdates.values()];
  pendingRoleUpdates.clear();

  for (const job of batch) {
    try {
      const userObj = trainerData[job.userId];
      if (!userObj) continue;

      // If you store rank, use it. If not, compare computed rank.
      const oldRank = userObj.rank || getRank(userObj.tp || 0);
      const newRank = getRank(job.tp || 0);

      // Nothing changed? Skip ALL REST.
      if (oldRank === newRank) continue;

      // Update stored rank (optional, but helps future comparisons)
      userObj.rank = newRank;

      const member = await getMemberCached(job.guild, job.userId);
      await updateUserRole(member, job.tp, job.channel || null);
    } catch (err) {
      console.warn("⚠️ role queue flush failed:", err?.message || err);
    }
  }
}, ROLE_FLUSH_INTERVAL_MS);

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

    // Auto-delete empty shells
    if (entry.normal <= 0 && entry.shiny <= 0) {
      delete user.pokemon[pid];
    }
  }

  // ==========================================================
  // 3️⃣ TRAINERS (array of filenames)
  // backwards compatible with old object maps
  // ==========================================================
  if (Array.isArray(user.trainers)) {
    // Ensure all entries are strings
    user.trainers = user.trainers
      .filter(t => typeof t === "string")
      .map(t => t.trim());
  } else if (user.trainers && typeof user.trainers === "object") {
    // legacy: { "file.png": 1, "other.png": 1 }
    user.trainers = Object.keys(user.trainers);
  } else {
    user.trainers = [];
  }

  // Remove duplicates
  user.trainers = [...new Set(user.trainers)];

  // ==========================================================
// 4️⃣ DISPLAYED TEAM (canonical)
// NEW FORMAT: [{ id: Number, variant: "normal"|"shiny" }]
// Backwards compatible with legacy [Number, Number, ...]
// ==========================================================
if (!Array.isArray(user.displayedPokemon)) {
  user.displayedPokemon = [];
}

// Convert legacy [243,245] => [{id:243, variant:"normal"}, ...]
if (user.displayedPokemon.length && typeof user.displayedPokemon[0] !== "object") {
  user.displayedPokemon = user.displayedPokemon
    .map((pid) => ({ id: Number(pid), variant: "normal" }))
    .filter((t) => Number.isInteger(t.id));
}

// Normalize + remove ghosts (must own that specific variant)
user.displayedPokemon = user.displayedPokemon
  .map((t) => ({
    id: Number(t?.id),
    variant: t?.variant === "shiny" ? "shiny" : "normal",
  }))
  .filter((t) => Number.isInteger(t.id))
  .filter((t) => {
    const owned = user.pokemon?.[t.id];
    if (!owned) return false;
    return Number(owned?.[t.variant] || 0) > 0;
  });


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

  // weeklyPack: must be ISO string or null
  if (
    typeof user.lastWeeklyPack === "string" &&
    !isNaN(new Date(user.lastWeeklyPack))
  ) {
    // valid
  } else {
    user.lastWeeklyPack = null;
  }

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
if (!user.items || typeof user.items !== "object" || Array.isArray(user.items)) {
  user.items = {};
}

// sanitize all item values to non-negative integers
for (const [k, v] of Object.entries(user.items)) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    delete user.items[k];
    continue;
  }
  user.items[k] = Math.max(0, Math.floor(n));
}

// keep this ONE legacy guarantee if you want stones to always show up
user.items.evolution_stone = Number.isFinite(user.items.evolution_stone)
  ? user.items.evolution_stone
  : 0;

// ==========================================================
// 🧾 NON-SHINY DUST WEEKLY CAP TRACKING (normalize + roll week)
// ==========================================================
ensureNonShinyDustWeek(user);

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
  if (!validateToken(id, code)) return res.status(403).send("Invalid or expired link.");

  res.cookie("dashboard_session", code, {
    httpOnly: true,
    secure: isProd,
    sameSite: "Lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });

  res.redirect(`/public/picker-pokemon?id=${encodeURIComponent(id)}`);
});

// ==========================================================
// 🎯 Trainer Tier Costs
// ==========================================================
export const TRAINER_COSTS = {
  common: 2500,
  uncommon: 7500,
  rare: 15000,
  epic: 35000,
  legendary: 75000,
  mythic: 150000,
};


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

// ✅ Explicit index routes
app.get("/public/picker", (_, res) =>
  res.sendFile(path.join(staticPath, "picker", "index.html"))
);
app.get("/public/picker-pokemon", (_, res) =>
  res.sendFile(path.join(staticPath, "picker-pokemon", "index.html"))
);

// ✅ Shop page (new canonical)
app.get("/public/dashboardshop", (_, res) =>
  res.sendFile(path.join(staticPath, "dashboardshop", "index.html"))
);

// ✅ Backward compat alias
app.get("/public/dashboardstore", (_, res) =>
  res.sendFile(path.join(staticPath, "dashboardshop", "index.html"))
);



// ==========================================================
// 🎨 Color Palette (Matches CSS theme)
// ==========================================================
export const rarityColors = {
  common: 0x9ca3af,     // gray
  uncommon: 0x10b981,   // green
  rare: 0x3b82f6,       // blue
  epic: 0xa855f7,       // purple
  legendary: 0xfacc15,  // gold
  mythic: 0xef4444,     // red
  shiny: 0xffd700,      // shiny gold highlight
  success: 0x00ff9d,    // used for confirmations
};

// ==========================================================
// 📦 Internal Utilities
// ==========================================================
import { getRank, getRankTiers } from "./utils/rankSystem.js";
import { safeReply } from "./utils/safeReply.js";
import { reloadUserFromDiscord, ensureUserInitialized } from "./utils/userInitializer.js";
import { getAllPokemon, getAllTrainers } from "./utils/dataLoader.js";
import {
  selectRandomPokemonForUser,
} from "./utils/weightedRandom.js";
import { rollForShiny } from "./shinyOdds.js";
import { rarityEmojis, spritePaths } from "./spriteconfig.js";
import { loadTrainerSprites } from "./utils/dataLoader.js";
import { updateUserRole } from "./utils/updateUserRole.js";
import { broadcastReward } from "./utils/broadcastReward.js";
import {
  createPokemonRewardEmbed,
} from "./utils/embedBuilders.js";
import { sanitizeTrainerData } from "./utils/sanitizeTrainerData.js";

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
// We'll keep all active tokens in memory for 10 minutes
const activeTokens = new Map();

// ✅ Token garbage collection (prevents memory growth)
// Runs every 5 minutes and deletes expired tokens
setInterval(() => {
  const now = Date.now();
  let removed = 0;

  for (const [token, entry] of activeTokens.entries()) {
    if (!entry || typeof entry.expires !== "number" || now > entry.expires) {
      activeTokens.delete(token);
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`🧹 Token GC removed ${removed} expired token(s)`);
  }
}, 5 * 60 * 1000);


/**
 * Generate a secure token linked to both the user and the channel
 * @param {string} userId - The Discord user ID
 * @param {string} channelId - The Discord channel ID where /changetrainer was used
 */
function generateToken(userId, channelId) {
  // ✅ strong, unguessable, URL-safe
  const token = crypto.randomBytes(18).toString("base64url");
  activeTokens.set(token, {
    id: userId,
    channelId,
    expires: Date.now() + 10 * 60 * 1000,
  });
  return token;
}

/**
 * Validate that a token belongs to a specific user and isn't expired
 */
function validateToken(userId, token) {
  const entry = activeTokens.get(token);
  if (!entry) return false;
  if (entry.id !== userId) return false;
  if (Date.now() > entry.expires) {
    activeTokens.delete(token);
    return false;
  }
  return true;
}

/**
 * Retrieve the channel ID stored with a token
 */
function getChannelIdForToken(token) {
  const entry = activeTokens.get(token);
  return entry ? entry.channelId : null;
}

function requireDashboardSession(req, userId) {
  const sessionToken = req.cookies?.dashboard_session;
  if (!sessionToken) return false;
  return validateToken(String(userId), sessionToken);
}

// Export if using ES modules
export { generateToken, validateToken, getChannelIdForToken };


let trainerData = {};
let discordSaveCount = 0;
let commandSaveQueue = null;
let isReady = false;
let isSaving = false;
let shuttingDown = false;
const startTime = Date.now();
// Cooldowns
const rewardCooldowns = new Map();    // ✅ ONLY for random encounter rewards
const reactionCooldowns = new Map();  // ✅ ONLY for reaction TP throttling
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
async function loadTrainerData() {
  const LOAD_TIMEOUT_MS = 25_000;

  const withTimeout = (p, ms, label) =>
    Promise.race([
      p,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout: ${label} after ${ms}ms`)), ms)
      ),
    ]);

  console.log("📦 Loading trainer data from Discord...");

  let loaded = {};

  try {
    const storageChannel = await withTimeout(
      client.channels.fetch(process.env.STORAGE_CHANNEL_ID),
      10_000,
      "channels.fetch(STORAGE_CHANNEL_ID)"
    );

    const messages = await withTimeout(
      storageChannel.messages.fetch({ limit: 50 }),
      10_000,
      "messages.fetch(limit=50)"
    );

    const backups = messages
      .filter((m) => {
        const att = m.attachments.first();
        if (!att) return false;
        const name = String(att.name || "");
        // Accept both trainerData.json and trainerData*.json
        return name.toLowerCase().startsWith("trainerdata") && name.toLowerCase().endsWith(".json");
      })
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    if (backups.size > 0) {
      const att = backups.first().attachments.first();

      const res = await withTimeout(
        fetch(att.url),
        LOAD_TIMEOUT_MS,
        "fetch(backup attachment)"
      );

      const text = await withTimeout(res.text(), LOAD_TIMEOUT_MS, "res.text()");
      loaded = JSON.parse(text);

      console.log(`✅ Loaded ${Object.keys(loaded).length} users`);
    } else {
      console.log("⚠️ No backups found in storage channel.");
    }
  } catch (err) {
    console.error("❌ Discord load failed:", err?.message || err);
  }

  if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
    for (const [id, user] of Object.entries(loaded)) normalizeUserSchema(id, user);
    return loaded;
  }

  return {};
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

    // ✅ IMPORTANT: compact JSON (much faster + smaller)
    const jsonString = JSON.stringify(data);
    const payload = Buffer.from(jsonString, "utf8");
    const file = new AttachmentBuilder(payload, { name: "trainerData.json" });

    await withTimeout(
      channel.send({ files: [file] }),
      SAVE_TIMEOUT_MS,
      "channel.send(trainerData.json)"
    );

    lastDiscordOk = Date.now();
    discordSaveCount++;
    console.log(`✅ Discord backup #${discordSaveCount} (${Math.round(payload.length / 1024)} KB)`);
  } catch (err) {
    console.error("❌ Discord save failed:", err?.message || err);
  } finally {
    isSaving = false;
  }
}

// ==========================================================
// 🎁 DETERMINISTIC RANDOM REWARD SYSTEM (ATOMIC PER-USER LOCK)
// ==========================================================
async function tryGiveRandomReward(userObj, interactionUser, msgOrInteraction) {
  const userId = interactionUser.id;

  await lockUser(userId, async () => {
    console.log("⚙️ tryGiveRandomReward executed for", interactionUser.username);

    // =============================
    // ⏳ COOLDOWN
    // =============================
    const now = Date.now();
    const last = rewardCooldowns.get(userId) || 0;
    if (now - last < REWARD_COOLDOWN) return;
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

    // Final chance
    const finalChance = Math.min(MAX_CHANCE, BASE_CHANCE + userObj.luck);

    // Reward fails → keep pity meter, exit
    if (Math.random() >= finalChance) {
      return;
    }

    // Reward occurred → reset pity meter
    userObj.luck = 0;

    // =============================
    // 🎲 ALWAYS POKÉMON (no trainers)
    // =============================
    const allPokemon = await getAllPokemon();

    let reward;
    let isShiny = false;

    try {
      reward = selectRandomPokemonForUser(allPokemon, userObj, "pokeball");
      isShiny = rollForShiny(userObj.tp || 0);

      userObj.pokemon ??= {};
      userObj.pokemon[reward.id] ??= { normal: 0, shiny: 0 };

      if (isShiny) userObj.pokemon[reward.id].shiny++;
      else userObj.pokemon[reward.id].normal++;

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
    await enqueueSave(trainerData);

    // =============================
    // 🖼️ SPRITE
    // =============================
    let spriteUrl = isShiny
      ? `${spritePaths.shiny}${reward.id}.gif`
      : `${spritePaths.pokemon}${reward.id}.gif`;

    // =============================
    // 📣 PUBLIC ANNOUNCEMENT
    // =============================
    const embed = createPokemonRewardEmbed(reward, isShiny, spriteUrl);

    try {
      const announcement =
        `🎉 <@${userId}> caught **${isShiny ? "✨ shiny " : ""}${reward.name}**!`;

      await msgOrInteraction.channel.send({
        content: announcement,
        embeds: [embed]
      });
    } catch (err) {
      console.warn("⚠️ Public announcement failed:", err.message);
    }

    // =============================
    // 🌐 GLOBAL BROADCAST
    // =============================
    try {
      await broadcastReward(client, {
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
      });
    } catch (err) {
      console.error("❌ broadcastReward failed:", err.message);
    }

    console.log(`✅ Reward granted to ${interactionUser.username}`);
  });
}


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
// 🕒 15-MINUTE DISCORD BACKUP (FIRST RUN AFTER 15 MINUTES)
// ==========================================================
const discordBackupInterval = setInterval(async () => {
  if (shuttingDown) return;
  if (!client.isReady() || !isReady) return;
  if (isSaving) return;

  console.log("💾 15-minute interval — saving trainerData to Discord...");
  try {
    await saveDataToDiscord(trainerData);
    console.log("✅ Discord backup complete (15-minute interval)");
  } catch (err) {
    console.error("❌ Interval Discord save failed:", err?.message || err);
  }
}, 15 * 60 * 1000);

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
    await Promise.race([
      shutdownFlush(10_000),
      new Promise(res => setTimeout(res, 8000)),
    ]);

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
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const username = message.author.username;
  trainerData[userId] = normalizeUserSchema(userId, trainerData[userId]);

  // Prevent spam with cooldown
  const now = Date.now();
  if (userCooldowns.has(userId) && now - userCooldowns.get(userId) < MESSAGE_COOLDOWN) return;
  userCooldowns.set(userId, now);

  // Ensure user data exists
  trainerData[userId] ??= {
    id: userId,
    tp: 0,
    cc: 0,
    pokemon: {},
    trainers: [],
    displayedTrainer: null,
    displayedPokemon: [],
    onboardingComplete: false,
    onboardingDate: null,
    starterPokemon: null,
    lastDaily: 0,
    lastRecruit: 0,
    lastQuest: 0,
    lastWeeklyPack: null,
    items: {},
    purchases: [],
    luck: 0,
    luckTimestamp: 0,
  };

  const userObj = trainerData[userId];

  // 🪙 Give base TP for chatting
  userObj.tp += MESSAGE_TP_GAIN;

  // 💰 Chance to earn CC
  if (Math.random() < MESSAGE_CC_CHANCE) {
    userObj.cc ??= 0;
    userObj.cc += MESSAGE_CC_GAIN;

    try {
      await message.react("💰").catch(() => {});
    } catch {}
  }

  // 🔥 fire-and-forget save (safe, debounced) — SAVE AFTER MUTATIONS
  enqueueSave(trainerData);

  queueRoleUpdate({
    guild: message.guild,
    userId,
    tp: userObj.tp,
    channel: message.channel,
  });

  setImmediate(() => {
    tryGiveRandomReward(userObj, message.author, message).catch((e) =>
      console.warn("⚠️ tryGiveRandomReward failed:", e?.message || e)
    );
  });
});

// ==========================================================
// 💖 TP Gain from Reactions
// ==========================================================
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot || !reaction.message.guild) return;

  const userId = user.id;
  trainerData[userId] = normalizeUserSchema(userId, trainerData[userId]);

// Prevent spam with cooldown (✅ reactions use their own map)
const now = Date.now();
if (reactionCooldowns.has(userId) && now - reactionCooldowns.get(userId) < REWARD_COOLDOWN) return;
reactionCooldowns.set(userId, now);


  trainerData[userId] ??= {
    id: userId,
    tp: 0,
    cc: 0,
    pokemon: {},
    trainers: [],
    displayedTrainer: null,
    displayedPokemon: [],
    onboardingComplete: false,
    onboardingDate: null,
    starterPokemon: null,
    lastDaily: 0,
    lastRecruit: 0,
    lastQuest: 0,
    lastWeeklyPack: null,
    items: {},
    purchases: [],
    luck: 0,
    luckTimestamp: 0,
  };

  const userObj = trainerData[userId];

  // 🪙 Gain TP for reaction
  userObj.tp += MESSAGE_TP_GAIN;

  // 💰 Chance to earn CC
  if (Math.random() < MESSAGE_CC_CHANCE) {
    userObj.cc ??= 0;
    userObj.cc += MESSAGE_CC_GAIN;

    try {
      await reaction.message.react("💰").catch(() => {});
    } catch {}
  }

  // 🔥 fire-and-forget save (safe, debounced) — SAVE AFTER MUTATIONS
  enqueueSave(trainerData);

  queueRoleUpdate({
    guild: reaction.message.guild,
    userId,
    tp: userObj.tp,
    channel: reaction.message.channel,
  });

  // 3% chance for random reward
  setImmediate(() => {
    tryGiveRandomReward(userObj, user, reaction.message).catch((e) =>
      console.warn("⚠️ tryGiveRandomReward failed:", e?.message || e)
    );
  });
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

  return res.json(trainerData[id]);
});


// ==========================================================
// 🛍️ SHOP API — UPDATE USER (HARDENED / WHITELISTED)
// ==========================================================
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
      // Normalize the existing record first (ensures schema is sane)
      const base = normalizeUserSchema(id, trainerData[id]);

      // Apply patch only (NO blind merge of arbitrary user fields)
      const next = normalizeUserSchema(id, { ...base, ...patch });

      // Server-authoritative fields
      next.rank = getRank(next.tp);

      trainerData[id] = next;
      await enqueueSave(trainerData);

      return res.json({ success: true });
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
app.post("/api/rewardPokemon", express.json(), async (req, res) => {
  try {
    const { id, source } = req.body;

    if (!id) return res.status(400).json({ success: false, error: "Missing id" });
    if (!requireDashboardSession(req, id))
      return res.status(403).json({ success: false, error: "Invalid or expired session" });

    if (!trainerData[id])
      return res.status(404).json({ success: false, error: "User not found" });

    // ======================================================
    // 🧱 COST MAP (canonical)
    // ======================================================
    const COST = {
      pokeball: 1000,
      greatball: 1500,
      ultraball: 3000,
    };

    if (!COST[source]) {
      return res.json({
        success: false,
        error: `Invalid Poké Ball type: ${source}`,
      });
    }

    // ======================================================
    // 🔒 ATOMIC USER LOCK
    // ======================================================
    await lockUser(id, async () => {
      const user = trainerData[id];

      // ----------------------------------------
      // 1️⃣ SERVER-SIDE CC CHECK
      // ----------------------------------------
      if ((user.cc ?? 0) < COST[source]) {
        return res.json({
          success: false,
          error: `Not enough CC — requires ${COST[source]} CC.`,
        });
      }

      // ----------------------------------------
      // 2️⃣ LOAD POKEMON POOL
      // ----------------------------------------
      const allPokemon = await getAllPokemon();
      if (!Array.isArray(allPokemon) || allPokemon.length === 0) {
        return res.json({
          success: false,
          error: "Pokémon pool unavailable.",
        });
      }

      // ----------------------------------------
      // 3️⃣ SELECT POKÉMON (ball + rank aware)
      // ----------------------------------------
      const reward = selectRandomPokemonForUser(allPokemon, user, source);
      if (!reward) {
        return res.json({
          success: false,
          error: "No Pokémon could be selected.",
        });
      }

      // ----------------------------------------
      // 4️⃣ SHINY ROLL
      // ----------------------------------------
      const shiny = rollForShiny(user.tp || 0);

      // ----------------------------------------
      // 5️⃣ APPLY CHARGES & ITEMS (Atomic)
      // ----------------------------------------
      user.cc -= COST[source];

      user.pokemon ??= {};
      user.pokemon[reward.id] ??= { normal: 0, shiny: 0 };

      if (shiny) user.pokemon[reward.id].shiny++;
      else user.pokemon[reward.id].normal++;

      // ----------------------------------------
      // 6️⃣ SAVE TRAINER DATA
      // ----------------------------------------
      await enqueueSave(trainerData);

// ----------------------------------------
// 7️⃣ BROADCAST IF RARE+
// ----------------------------------------
const rarity = reward.tier || reward.rarity || "common";
if (
  shiny ||
  ["rare", "epic", "legendary", "mythic"].includes(rarity.toLowerCase())
) {
  try {
    const discordUser =
      client.users.cache.get(id) || (await client.users.fetch(id));

    await broadcastReward(client, {
      user: discordUser,
      type: "pokemon",
      item: {
        id: reward.id,
        name: reward.name,
        rarity,
        spriteFile: `${reward.id}.gif`
      },
      shiny,
      source,
    });

  } catch (err) {
    console.warn("⚠️ Broadcast failed:", err.message);
  }
}

      // ----------------------------------------
      // 8️⃣ RESPOND TO FRONTEND WITH NEW CC & SPRITE
      // ----------------------------------------
      return res.json({
        success: true,
        pokemon: {
          id: reward.id,
          name: reward.name,
          rarity,
          shiny,
          sprite: shiny
            ? `${spritePaths.shiny}${reward.id}.gif`
            : `${spritePaths.pokemon}${reward.id}.gif`,
        },
        cc: user.cc,
      });
    });

  } catch (err) {
    console.error("❌ /api/rewardPokemon ERROR:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error while generating Pokémon reward.",
    });
  }
});


client.on("interactionCreate", async (interaction) => {
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
            await interaction.deferReply({ ephemeral: !!opts?.ephemeral }).catch(() => {});
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
        if (interaction.deferred || interaction.replied) return;
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

    const ms = Date.now() - startedAt;
    if (ms > 2500) {
      console.warn(`⏱️ Slow slash command: ${interaction.commandName} took ${ms}ms`);
    }

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
  // ✅ Buttons (ACK-only)
  // ----------------------------------------------------------
  if (interaction.isButton()) {
    const id = interaction.customId ?? "";

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => {});
    }

    // intentionally no-op buttons
    if (
      id.startsWith("confirm_") ||
      id.startsWith("cancel_") ||
      id.startsWith("disabled_")
    )
      return;

    return;
  }
});

// ==========================================================
// 🧰 WEEKLY PACK — Pokémon Only (Forced Rarity + Atomic Lock)
// ==========================================================
app.post("/api/weekly-pack", express.json(), async (req, res) => {
  const { id } = req.body;

  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!requireDashboardSession(req, id))
    return res.status(403).json({ error: "Invalid or expired session" });

  if (!trainerData[id]) return res.status(404).json({ error: "User not found" });

  await lockUser(id, async () => {
    const user = trainerData[id];

    const last = user.lastWeeklyPack ? new Date(user.lastWeeklyPack).getTime() : 0;
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    if (now - last < sevenDays) {
      return res.status(400).json({ error: "Weekly pack already claimed." });
    }

    // Set cooldown immediately
    user.lastWeeklyPack = new Date().toISOString();

    const results = [];
    const allPokemon = await getPokemonCached();

    const poolFor = (tier) => allPokemon.filter((p) => p.tier === tier);
    const pick = (tier) => {
      const pool = poolFor(tier);
      return pool[Math.floor(Math.random() * pool.length)];
    };

    async function givePokemon(tier) {
      const reward = pick(tier);
      if (!reward) return;

      const shiny = rollForShiny(user.tp || 0);

      user.pokemon ??= {};
      user.pokemon[reward.id] ??= { normal: 0, shiny: 0 };

      if (shiny) user.pokemon[reward.id].shiny++;
      else user.pokemon[reward.id].normal++;

      results.push({
        type: "pokemon",
        id: reward.id,
        name: reward.name,
        rarity: reward.tier,
        shiny,
        sprite: shiny
          ? `/public/sprites/pokemon/shiny/${reward.id}.gif`
          : `/public/sprites/pokemon/normal/${reward.id}.gif`,
      });
    }

    await givePokemon("common");
    await givePokemon("common");
    await givePokemon("common");
    await givePokemon("uncommon");
    await givePokemon("uncommon");
    await givePokemon("rare");

    await enqueueSave(trainerData);

    res.json({ success: true, rewards: results });
  });
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

      await enqueueSave(trainerData);

      console.log(`✅ ${id} equipped trainer ${canonicalFile}`);
      return res.json({ success: true, equipped: canonicalFile });
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
    const cost = TRAINER_COSTS[tier];
    if (!cost) return res.status(400).json({ success: false, error: `Unknown trainer tier: ${tier}` });

    if ((user.cc ?? 0) < cost) {
      return res.status(400).json({ success: false, error: `Requires ${cost} CC` });
    }

    user.cc -= cost;
    user.trainers.push(canonicalFile);

    await enqueueSave(trainerData);

    return res.json({
      success: true,
      file: canonicalFile,
      cost,
      tier,
      cc: user.cc,          // ✅ important for frontend
    });
  });
});

// ==========================================================
// 🛍️ TRAINER SHOP — LIST ALL BUYABLE TRAINERS
// ==========================================================
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
    const { id } = req.body;

    if (!id) return res.status(400).json({ success: false, error: "Missing id" });
    if (!requireDashboardSession(req, id))
      return res.status(403).json({ success: false, error: "Invalid or expired session" });

    if (!trainerData[id])
      return res.status(404).json({ success: false, error: "User not found" });

    const COST = 5000; // must match frontend + your ITEM_COSTS

    await lockUser(id, async () => {
      // normalize for safety
      trainerData[id] = normalizeUserSchema(id, trainerData[id]);
      const user = trainerData[id];

      user.cc ??= 0;
      user.items ??= {};
      user.items.evolution_stone = Number.isFinite(user.items.evolution_stone)
        ? user.items.evolution_stone
        : 0;

      if (user.cc < COST) {
        return res.status(400).json({
          success: false,
          error: `Not enough CC — requires ${COST} CC.`,
          cc: user.cc,
        });
      }

      // ✅ atomic mutation
      user.cc -= COST;
      user.items.evolution_stone += 1;

      await enqueueSave(trainerData);

      return res.json({
        success: true,
        cc: user.cc,
        stones: user.items.evolution_stone,
      });
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

  // flatten response for front-end
  return res.json({
    id: u.id,
    cc,
    tp,
    rank,
    items,
    pokemon,
    currentTeam, // NEW FORMAT: [{ id: Number, variant: "normal" | "shiny" }]
  });
});


// ✅ POST — set full Pokémon team (up to 6) — Variant-safe + Ghost Auto-Clean
// NEW TEAM FORMAT (frontend -> backend):
// team = [{ id: 243, variant: "normal" }, { id: 245, variant: "shiny" }, ...]
// Back-compat accepted:
// team = [243,245,3]  (treated as normal variants)
// team = [{ id: 243 }, ...] (missing variant -> normal)
app.post("/api/set-pokemon-team", express.json(), async (req, res) => {
  try {
    const { id, team } = req.body;

    if (!id || !Array.isArray(team)) {
      return res.status(400).json({ success: false, error: "Missing id/team" });
    }

    if (!requireDashboardSession(req, id)) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid or expired session" });
    }

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


      const ownsVariant = (pid, variant) => {
        const p = u.pokemon?.[pid];
        if (!p) return false;
        return (p[variant] ?? 0) > 0;
      };

      // 1) Auto-clean existing displayedPokemon (remove ghost variant slots)
      u.displayedPokemon = Array.isArray(u.displayedPokemon) ? u.displayedPokemon : [];
      u.displayedPokemon = u.displayedPokemon
        .map(toTeamObj)
        .filter(Boolean)
        .filter((slot) => ownsVariant(slot.id, slot.variant));

      // 2) Parse incoming team
      const parsed = team.map(toTeamObj).filter(Boolean);

      // 3) Enforce constraints: 1–6 unique slots
      // Unique = (id + variant) pair. Allow same Pokémon in both variants if they own both.
      const dedupMap = new Map(); // key "id:variant" -> slot
      for (const slot of parsed) {
        const key = `${slot.id}:${slot.variant}`;
        if (!dedupMap.has(key)) dedupMap.set(key, slot);
      }
      const normalized = [...dedupMap.values()];

      if (normalized.length === 0 || normalized.length > 6) {
        return res.status(400).json({
          success: false,
          error: "Team must be 1–6 unique slots (unique = Pokémon + variant).",
        });
      }

      // 4) Validate ownership per variant (IMPORTANT for your new UI rules)
      const unowned = normalized.filter((slot) => !ownsVariant(slot.id, slot.variant));
      if (unowned.length) {
        const list = unowned.map((s) => `#${s.id} (${s.variant})`).join(", ");
        return res.status(400).json({
          success: false,
          error: `Unowned Pokémon slots: ${list}`,
        });
      }

      // 5) Save
      u.displayedPokemon = normalized;
      trainerData[id] = u;

      await enqueueSave(trainerData);

      return res.json({ success: true, currentTeam: u.displayedPokemon });
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
  const { id, baseId, targetId, shiny, variant } = req.body;

  if (!id) return res.status(400).json({ error: "Missing id" });
  if (baseId == null || targetId == null)
    return res.status(400).json({ error: "Missing baseId/targetId" });

  if (!requireDashboardSession(req, id)) {
    return res.status(403).json({ error: "Invalid or expired session" });
  }

  if (!trainerData[id]) return res.status(404).json({ error: "User not found" });

  await lockUser(id, async () => {
    // Normalize user so pokemon + displayedPokemon are consistent
    trainerData[id] = normalizeUserSchema(id, trainerData[id]);
    const user = trainerData[id];

    const pokemonData = await getPokemonDataCached();

    const bId = Number(baseId);
    const tId = Number(targetId);

    const base = pokemonData[bId];
    const target = pokemonData[tId];

    if (!base || !target) {
      return res.status(400).json({ error: "Invalid Pokémon IDs" });
    }

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
      "uncommon-mythic": 14,
      "rare-legendary": 8,
      "rare-mythic": 14,
      "epic-mythic": 12,
    };

    const currentTier = String(base.tier || "common").toLowerCase();
    const nextTier = String(target.tier || "common").toLowerCase();
    const key = `${currentTier}-${nextTier}`;

    const cost = COST_MAP[key] ?? 0;
    if (cost <= 0) {
      return res.status(400).json({
        error: `Evolution path ${currentTier} ➝ ${nextTier} is not supported`,
      });
    }

    if (!user.items || (user.items.evolution_stone ?? 0) < cost) {
      return res.status(400).json({ error: "Not enough Evolution Stones." });
    }

    // Determine variant (prefer explicit "variant", fall back to boolean "shiny")
    const chosenVariant =
      typeof variant === "string" ? normVariant(variant) : (shiny ? "shiny" : "normal");

const baseTier = tierKey(base.tier || "common");
const targetTier = tierKey(target.tier || "common");
const dustCost = chosenVariant === "shiny"
  ? shinyEvolveDustCost(baseTier, targetTier)
  : 0;


    // 🚫 NEW RULE: can't evolve if currently displayed on team (variant-aware)
    if (isDisplayedVariant(user, bId, chosenVariant)) {
      return res.status(400).json({
        error: `You can’t evolve your ${chosenVariant} ${base.name} because it’s currently displayed on your team. Remove it from your team first.`,
      });
    }

    const ownedCount = user.pokemon?.[bId]?.[chosenVariant] || 0;
    if (ownedCount <= 0) {
      return res.status(400).json({
        error: `You do not own a ${chosenVariant === "shiny" ? "shiny " : ""}${base.name}.`,
      });
    }

    // Spend stones
user.items.evolution_stone -= cost;

// Spend dust if shiny evolve
if (dustCost > 0) {
  const ok = spendItem(user, "shiny_dust", dustCost);
  if (!ok) {
    // refund stones (since we are mid-operation)
    user.items.evolution_stone += cost;
    return res.status(400).json({
      error: `Not enough Shiny Dust. Requires ${dustCost}.`,
      dustRequired: dustCost,
      dustAvailable: getItem(user, "shiny_dust"),
    });
  }
}

    // Remove 1 base
    user.pokemon ??= {};
    user.pokemon[bId] ??= { normal: 0, shiny: 0 };
    user.pokemon[bId][chosenVariant] -= 1;

    if ((user.pokemon[bId].normal ?? 0) <= 0 && (user.pokemon[bId].shiny ?? 0) <= 0) {
      delete user.pokemon[bId];
    }

    // Add 1 target (same variant)
    user.pokemon[tId] ??= { normal: 0, shiny: 0 };
    user.pokemon[tId][chosenVariant] += 1;

    await enqueueSave(trainerData);

    return res.json({
  success: true,
  evolved: {
    from: base.name,
    to: target.name,
    variant: chosenVariant,
    shiny: chosenVariant === "shiny",
    cost,                 // stones
    dustCost,             // NEW
  },
  stonesRemaining: user.items.evolution_stone,
  shinyDustRemaining: getItem(user, "shiny_dust"),
});

  });
});

// ==========================================================
// 💝 Donate Pokémon (normal + shiny supported, 5× CC for shiny)
// ✅ blocks donating a Pokémon variant if it's displayed
// ✅ awards shiny dust:
//    - shiny donation: fixed dust by tier
//    - non-shiny donation: probability-based dust by tier
// ==========================================================
app.post("/api/pokemon/donate", express.json(), async (req, res) => {
  const { id, pokeId, shiny, variant } = req.body;

  if (!id) return res.status(400).json({ error: "Missing id" });
  if (pokeId == null) return res.status(400).json({ error: "Missing pokeId" });

  if (!requireDashboardSession(req, id)) {
    return res.status(403).json({ error: "Invalid or expired session" });
  }

  await lockUser(id, async () => {
    const user = trainerData[id];
    if (!user) return res.status(404).json({ error: "User not found" });

    trainerData[id] = normalizeUserSchema(id, user);
    const u = trainerData[id];

    const pokemonData = await getPokemonDataCached();

    const pid = Number(pokeId);
    const p = pokemonData[pid];
    if (!p) return res.status(400).json({ error: "Invalid Pokémon ID" });

    const ccMap = {
      common: 250,
      uncommon: 500,
      rare: 1000,
      epic: 2500,
      legendary: 5000,
      mythic: 10000,
    };

    const baseValue = ccMap[String(p.tier || "common").toLowerCase()] ?? 0;

    const chosenVariant =
      typeof variant === "string"
        ? normVariant(variant)
        : (shiny ? "shiny" : "normal");

    if (isDisplayedVariant(u, pid, chosenVariant)) {
      return res.status(400).json({
        error: `You can’t donate your ${chosenVariant} ${p.name} because it’s currently displayed on your team. Remove it from your team first.`,
      });
    }

    const owned = u.pokemon?.[pid]?.[chosenVariant] || 0;
    if (owned <= 0) {
      return res.status(400).json({
        error: `You don’t own a ${chosenVariant === "shiny" ? "shiny " : ""}${p.name} to donate.`,
      });
    }

    // --------------------------
    // ✅ CC reward (unchanged)
    // --------------------------
    const finalValue = chosenVariant === "shiny" ? baseValue * 5 : baseValue;

    // --------------------------
    // ✅ Dust reward (NEW for non-shiny)
    // --------------------------
    const tier = tierKey(p.tier || "common");

    let dustReward = 0;

if (chosenVariant === "shiny") {
  // fixed dust for shiny donation (NOT capped here)
  dustReward = (DUST_REWARD_BY_TIER[tier] ?? 0);
} else {
  // ✅ weekly cap applies only to NON-SHINY dust
  ensureNonShinyDustWeek(u);

  const earned = u.nonShinyDustEarnedThisWeek ?? 0;
  const remaining = Math.max(0, NON_SHINY_DUST_WEEKLY_CAP - earned);

  if (remaining > 0) {
    const table = NON_SHINY_DUST_CHANCE_BY_TIER?.[tier] ?? [{ chance: 1, dust: 0 }];
    const rolled = rollWeightedDust(table);

    dustReward = Math.min(rolled, remaining);
    u.nonShinyDustEarnedThisWeek = earned + dustReward;
  } else {
    dustReward = 0;
  }
}

    // --------------------------
    // Apply donation
    // --------------------------
    u.pokemon ??= {};
    u.pokemon[pid] ??= { normal: 0, shiny: 0 };
    u.pokemon[pid][chosenVariant] -= 1;

    if ((u.pokemon[pid].normal ?? 0) <= 0 && (u.pokemon[pid].shiny ?? 0) <= 0) {
      delete u.pokemon[pid];
    }

    u.cc = (u.cc ?? 0) + finalValue;

    if (dustReward > 0) {
      addItem(u, "shiny_dust", dustReward);
    }

    await enqueueSave(trainerData);

    const nonShinyDustWeeklyRemaining =
  chosenVariant === "shiny"
    ? null
    : Math.max(0, NON_SHINY_DUST_WEEKLY_CAP - (u.nonShinyDustEarnedThisWeek ?? 0));

return res.json({
  success: true,
  donated: { id: pid, name: p.name, variant: chosenVariant },
  gainedCC: finalValue,
  totalCC: u.cc,
  shinyDustGained: dustReward,
  shinyDustTotal: getItem(u, "shiny_dust"),
  nonShinyDustWeeklyRemaining,
});

  });
});


// ==========================================================
// ✨ Convert Normal -> Shiny (Atomic, variant-aware)
// Costs dust by tier of the Pokémon being converted.
// Blocks converting if the NORMAL variant is currently displayed.
// ==========================================================
app.post("/api/pokemon/convert-to-shiny", express.json(), async (req, res) => {
  const { id, pokeId } = req.body;

  if (!id) return res.status(400).json({ error: "Missing id" });
  if (pokeId == null) return res.status(400).json({ error: "Missing pokeId" });

  if (!requireDashboardSession(req, id)) {
    return res.status(403).json({ error: "Invalid or expired session" });
  }

  if (!trainerData[id]) return res.status(404).json({ error: "User not found" });

  await lockUser(id, async () => {
    trainerData[id] = normalizeUserSchema(id, trainerData[id]);
    const user = trainerData[id];

    const pokemonData = await getPokemonDataCached();

    const pid = Number(pokeId);
    const p = pokemonData[pid];
    if (!p) return res.status(400).json({ error: "Invalid Pokémon ID" });

    if (isDisplayedVariant(user, pid, "normal")) {
      return res.status(400).json({
        error: `You can’t convert ${p.name} to shiny because its normal variant is currently displayed on your team. Remove it from your team first.`,
      });
    }

    const tier = tierKey(p.tier || "common");
    const dustCost = SHINY_CRAFT_COST_BY_TIER[tier] ?? 0;

    user.pokemon ??= {};
    user.pokemon[pid] ??= { normal: 0, shiny: 0 };

    if ((user.pokemon[pid].normal ?? 0) <= 0) {
      return res.status(400).json({ error: `You do not own a normal ${p.name} to convert.` });
    }

    if (getItem(user, "shiny_dust") < dustCost) {
      return res.status(400).json({
        error: `Not enough Shiny Dust. Requires ${dustCost}.`,
        dustRequired: dustCost,
        dustAvailable: getItem(user, "shiny_dust"),
      });
    }

    const ok = spendItem(user, "shiny_dust", dustCost);
    if (!ok) return res.status(400).json({ error: "Not enough Shiny Dust." });

    user.pokemon[pid].normal -= 1;
    user.pokemon[pid].shiny += 1;

    if ((user.pokemon[pid].normal ?? 0) <= 0 && (user.pokemon[pid].shiny ?? 0) <= 0) {
      delete user.pokemon[pid];
    }

    await enqueueSave(trainerData);

    return res.json({
      success: true,
      converted: { id: pid, name: p.name },
      tier,
      dustCost,
      shinyDustRemaining: getItem(user, "shiny_dust"),
      counts: {
        normal: user.pokemon?.[pid]?.normal ?? 0,
        shiny: user.pokemon?.[pid]?.shiny ?? 0,
      },
    });
  });
});

 // ==========================================================
// 🤖 BOT READY EVENT
// ==========================================================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  hasBeenReadyOnce = true;
  lastGatewayOk = Date.now();
  isReady = false;

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
    const loaded = await loadTrainerData();
    const ok =
      loaded &&
      typeof loaded === "object" &&
      !Array.isArray(loaded) &&
      Object.keys(loaded).length > 0;

    if (ok) {
      trainerData = loaded;
      return true;
    }
    return false;
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
    isReady = true;
    console.log("✨ Bot is now READY (trainerData loaded)!");
    return;
  }

  retryMs = Math.min(maxRetryMs, Math.floor(retryMs * 1.5));
  setTimeout(retryLoadLoop, retryMs);
}

// kick it off
setTimeout(retryLoadLoop, retryMs);

    return;
  }


  isReady = true;
  console.log("✨ Bot ready and accepting commands!");
});

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

  // ✅ Cloudflare/HTML block detection (your logs show this exact case)
  const looksHtml =
    /<!doctype html/i.test(text) ||
    /<html/i.test(text) ||
    /cloudflare/i.test(text) ||
    /access denied/i.test(text);

  if (looksHtml) {
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

  while (true) {
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
