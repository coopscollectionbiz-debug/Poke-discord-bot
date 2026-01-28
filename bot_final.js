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

import fs from "fs/promises";
import * as fsSync from "fs";
import fetch from "node-fetch";
import { decode } from "html-entities";
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
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});


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
  // must be array of Pokémon IDs the user owns
  // ==========================================================
  if (!Array.isArray(user.displayedPokemon)) {
    user.displayedPokemon = [];
  }

  // Auto-clean ghost Pokémon
  user.displayedPokemon = user.displayedPokemon
    .filter(id => {
      const owned = user.pokemon[id];
      return owned && (owned.normal > 0 || owned.shiny > 0);
    })
    .map(id => Number(id));

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
  // 8️⃣ ITEMS (future safe)
  // ==========================================================
  if (!user.items || typeof user.items !== "object" || Array.isArray(user.items)) {
    user.items = {};
  }

  // Always ensure evolution_stone exists
  user.items.evolution_stone = Number.isFinite(user.items.evolution_stone)
    ? user.items.evolution_stone
    : 0;

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

app.get("/public/dashboardstore", (_, res) =>
  res.sendFile(path.join(staticPath, "dashboardstore", "index.html"))
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
const POKEBEACH_CHECK_INTERVAL = 1000 * 60 * 120;
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

/**
 * Generate a secure token linked to both the user and the channel
 * @param {string} userId - The Discord user ID
 * @param {string} channelId - The Discord channel ID where /changetrainer was used
 */
function generateToken(userId, channelId) {
  const token = Math.random().toString(36).substring(2, 12);
  activeTokens.set(token, {
    id: userId,
    channelId,
    expires: Date.now() + 10 * 60 * 1000 // 10 min expiration
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
const rewardCooldowns = new Map();
const userCooldowns = new Map();
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

// ==========================================================
// 🛰️ DISCORD CONNECTION / INTERACTION DEBUG
// ==========================================================
client.on("ready", () => {
  console.log("🟢 Discord READY (event)");
});

client.on("error", (e) => console.error("❌ Discord client error:", e));
client.on("shardError", (e) => console.error("❌ Discord shardError:", e));

client.on("shardDisconnect", (event, id) => {
  console.error("🔴 shardDisconnect", { id, code: event?.code, reason: event?.reason });
});
client.on("shardReconnecting", (id) => console.log("🟡 shardReconnecting", { id }));
client.on("shardResume", (id) => console.log("🟢 shardResume", { id }));
client.on("shardError", (e) => console.error("❌ shardError", e));

// ==========================================================
// 🩺 DISCORD HEALTH + INTERACTION WATCHDOG (FINAL + UNIFIED)
// ==========================================================

// Tracks last successful Discord REST call
let lastDiscordOk = Date.now();

// Tracks whether the bot has ever fully connected
let hasBeenReadyOnce = false;

// Tracks last time an interaction event was received (ms)
let lastInteractionAtMs = null;

// Mark when the gateway is truly ready at least once
client.once("ready", () => {
  hasBeenReadyOnce = true;
  console.log("🧠 hasBeenReadyOnce = true");
});

// Track incoming interactions (slash commands, buttons, etc)
client.on("interactionCreate", () => {
  lastInteractionAtMs = Date.now();
});

// 🚨 If we never reach Discord ready within 5 minutes, restart the instance.
setTimeout(() => {
  if (!hasBeenReadyOnce) {
    console.error("❌ Startup watchdog: never reached Discord READY — exiting to restart");
    process.exit(1);
  }
}, 5 * 60_000);

// ✅ Health endpoint (uses unified vars)
app.get("/healthz", (_, res) => {
  res.json({
    appReadyFlag: isReady,
    discordJsReady: !!client.readyAt,
    wsPing: client.ws?.ping ?? null,
    uptime: Math.floor(process.uptime()),
    lastDiscordOkAgeSec: Math.round((Date.now() - lastDiscordOk) / 1000),
    lastInteractionAt: lastInteractionAtMs ? new Date(lastInteractionAtMs).toISOString() : null,
  });
});

// ----------------------------------------------------------
// 🔍 REST PROBE — proves outbound + auth + Discord API works
// ----------------------------------------------------------
setInterval(async () => {
  try {
    if (!client.user) return; // not logged in yet
    await client.user.fetch(true); // lightweight REST proof
    lastDiscordOk = Date.now();
  } catch (e) {
    console.error("❌ Discord REST probe failed:", e?.message || e);
  }
}, 60_000);

// ----------------------------------------------------------
// 🚨 RESTART IF DISCORD REST IS UNHEALTHY
// ----------------------------------------------------------
setInterval(() => {
  if (!hasBeenReadyOnce) return; // don't restart during initial boot

  const age = Date.now() - lastDiscordOk;
  if (age > 5 * 60_000) {
    console.error(`❌ Discord REST unhealthy for ${Math.round(age / 1000)}s — exiting`);
    process.exit(1);
  }
}, 60_000);

// ----------------------------------------------------------
// 🚨 RESTART IF INTERACTIONS STOP ARRIVING (ZOMBIE GATEWAY)
// ----------------------------------------------------------
setInterval(() => {
  if (!hasBeenReadyOnce) return;

  const ageMs = lastInteractionAtMs ? Date.now() - lastInteractionAtMs : Infinity;

  // If no interactions for 60 minutes, assume gateway is dead
  if (ageMs > 60 * 60 * 1000) {
    console.error("❌ No interactions received for 60 minutes — restarting");
    process.exit(1);
  }
}, 60_000);

// ==========================================================
// 💾 Trainer Data Load & Save
// ==========================================================
async function loadTrainerData() {
  console.log("📦 Loading trainer data from Discord...");
  let loaded = {};
  try {
    const storageChannel = await client.channels.fetch(process.env.STORAGE_CHANNEL_ID);
    const messages = await storageChannel.messages.fetch({ limit: 50 });
    const backups = messages
      .filter(
        (m) => m.attachments.size > 0 && m.attachments.first().name.startsWith("trainerData")
      )
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    if (backups.size > 0) {
      const res = await fetch(backups.first().attachments.first().url);
      loaded = JSON.parse(await res.text());
      console.log(`✅ Loaded ${Object.keys(loaded).length} users`);
    }
  } catch (err) {
    console.error("❌ Discord load failed:", err.message);
  }

  for (const [id, user] of Object.entries(loaded)) normalizeUserSchema(id, user);
  return loaded;
}

async function saveDataToDiscord(data, { force = false } = {}) {
  if (shuttingDown && !force) {
    console.log("⚠️ Skipping Discord save — shutting down");
    return;
  }
  if (isSaving) {
    console.log("⏳ Save already running — skip");
    return;
  }

  isSaving = true;

  try {
    if (!client.isReady()) {
      console.log("⚠️ Discord not ready — skipping backup");
      return;
    }

    let channel;
    try {
      channel =
        client.channels.cache.get(process.env.STORAGE_CHANNEL_ID) ??
        await client.channels.fetch(process.env.STORAGE_CHANNEL_ID);
    } catch {
      console.log("⚠️ Backup channel fetch failed — skipping");
      return;
    }

    if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
      console.log("⚠️ Backup channel unusable — skipping");
      return;
    }

    const payload = Buffer.from(JSON.stringify(data, null, 2));
    const file = new AttachmentBuilder(payload, { name: "trainerData.json" });

    await channel.send({ files: [file] });
    discordSaveCount++;
    console.log(`✅ Discord backup #${discordSaveCount}`);
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
// 🕒 15-MINUTE DISCORD BACKUP (ALWAYS RUNS)
// ==========================================================
const discordBackupInterval = setInterval(async () => {
  if (shuttingDown) return;

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
// 📰 POKÉBEACH RSS (Front Page News) — Link-only, every 2 hours
// ==========================================================
const POKEBEACH_RSS = "https://www.pokebeach.com/forums/forum/front-page-news.18/index.rss";

async function checkPokeBeach() {
  try {
    const newsChannel = await client.channels.fetch(process.env.NEWS_CHANNEL_ID);
    if (!newsChannel) return console.error("❌ NEWS_CHANNEL_ID invalid or missing.");

    console.log("📰 Checking PokéBeach RSS...");

    const res = await fetch(POKEBEACH_RSS, {
      redirect: "follow",
      headers: {
        // Make it look like a normal browser request (helps even for RSS sometimes)
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        "accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      console.error(`❌ PokéBeach RSS fetch failed: HTTP ${res.status}`);
      return;
    }

    const xml = await res.text();

    // Very simple RSS parse: pull <item> blocks, then <title> and <link>
    const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);

    const articles = [];
    for (const item of items) {
      const titleMatch = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i);
      const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i);

      const rawTitle = (titleMatch?.[1] || titleMatch?.[2] || "").trim();
      const rawLink = (linkMatch?.[1] || "").trim();

      const title = decode(rawTitle).replace(/<[^>]+>/g, "").trim();
      const link = rawLink;

      if (!title || !link) continue;
      // Keep only actual PokéBeach article links (not random forum links)
      if (!link.includes("pokebeach.com/20")) continue;

      articles.push({ title, link });
    }

    if (!articles.length) {
      console.log("⚠️ No articles found in RSS.");
      return;
    }

    // Check Discord for duplicates
    const history = await newsChannel.messages.fetch({ limit: 50 });
    const posted = new Set();
    for (const msg of history.values()) {
      const urls = msg.content.match(/https:\/\/www\.pokebeach\.com\/\d{4}\/[^\s]+/g);
      if (urls) urls.forEach((u) => posted.add(u));
    }

    const newArticles = articles.filter((a) => !posted.has(a.link));
    if (!newArticles.length) {
      console.log("✅ No new articles.");
      return;
    }

    console.log(`📢 Posting ${Math.min(3, newArticles.length)} new PokéBeach article(s)!`);
    for (const article of newArticles.slice(0, 3)) {
      await newsChannel.send(`${article.title}\n${article.link}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (err) {
    console.error("❌ PokéBeach check failed:", err.message);
  }
}


// ==========================================================
// 💬 Passive TP Gain from Messages
// ==========================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const username = message.author.username;

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
  lastWeeklyPack: null,       // ✅ REQUIRED
  items: { evolution_stone: 0 },
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
    await message.react("💰").catch(() => {}); // optional fun emoji indicator
  } catch {}
}

queueRoleUpdate({
  guild: message.guild,
  userId,
  tp: userObj.tp,
  channel: message.channel,
});

  // 🎲 3% chance for bonus Pokémon or Trainer
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

  // Prevent spam with cooldown
  const now = Date.now();
  if (rewardCooldowns.has(userId) && now - rewardCooldowns.get(userId) < REWARD_COOLDOWN) return;
  rewardCooldowns.set(userId, now);

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
  lastWeeklyPack: null,       // ✅ REQUIRED
  items: { evolution_stone: 0 },
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
// 🛍️ SHOP API — UPDATE USER (NOW ATOMIC SAFE)
// ==========================================================
app.post("/api/updateUser", express.json(), async (req, res) => {
  const { id, user } = req.body;

  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!requireDashboardSession(req, id))
    return res.status(403).json({ error: "Invalid or expired session" });

  if (!trainerData[id]) return res.status(404).json({ error: "User not found" });

  await lockUser(id, async () => {
    trainerData[id] = normalizeUserSchema(id, { ...trainerData[id], ...user });
    await enqueueSave(trainerData);
    res.json({ success: true });
  });
});

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
        if (interaction.replied || interaction.deferred) return;
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
  // ✅ Slash Commands
  // ----------------------------------------------------------
  if (interaction.isChatInputCommand()) {
    // ACK-only fallback (prevents infinite "thinking", does NOT overwrite command output)
    const fallbackTimer = setTimeout(async () => {
      try {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ ephemeral: true }).catch(() => {});
        }
      } catch {}
    }, 2500);

    try {
      if (!isReady) {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.reply({
            content: "⏳ Bot is starting up / reconnecting. Try again in ~10 seconds.",
            ephemeral: true,
          });
        }
        return;
      }

      const command = client.commands.get(interaction.commandName);
      if (!command) {
        console.warn(`❌ Unknown command: ${interaction.commandName} (loaded=${client.commands.size})`);
        if (!interaction.deferred && !interaction.replied) {
          await interaction.reply({ content: "❌ Unknown command.", ephemeral: true });
        } else if (interaction.deferred) {
          await interaction.editReply("❌ Unknown command.").catch(() => {});
        }
        return;
      }

      await command.execute(
        interaction,
        trainerData,
        saveTrainerDataLocal,
        saveDataToDiscord,
        lockUser,
        enqueueSave,
        client
      );
      return;
    } catch (err) {
      console.error("❌ Slash command crashed:", err?.stack || err);
      try {
        if (interaction.deferred) {
          await interaction.editReply("❌ Command crashed. Check Render logs.").catch(() => {});
        } else if (!interaction.replied) {
          await interaction.reply({
            content: "❌ Command crashed. Check Render logs.",
            ephemeral: true,
          }).catch(() => {});
        }
      } catch {}
      return;
    } finally {
      clearTimeout(fallbackTimer);
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
    if (id.startsWith("confirm_") || id.startsWith("cancel_") || id.startsWith("disabled_")) return;

    return;
  }
});

app.post("/api/claim-weekly", express.json(), async (req, res) => {
  const { id } = req.body;

  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!requireDashboardSession(req, id))
    return res.status(403).json({ error: "Invalid or expired session" });

  await lockUser(id, async () => {
    const user = trainerData[id];
    if (!user) return res.status(404).json({ error: "User not found" });

    const last = user.lastWeeklyPack ? new Date(user.lastWeeklyPack).getTime() : 0;
    const now = Date.now();
    const sevenDays = 604800000;

    if (now - last < sevenDays) {
      return res.status(400).json({ error: "Weekly pack already claimed." });
    }

    user.lastWeeklyPack = new Date().toISOString();
    await enqueueSave(trainerData);

    res.json({ success: true });
  });
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

  const owned = Array.isArray(user.trainers)
    ? user.trainers
    : Object.keys(user.trainers || {});

  res.json({
    owned,
    cc: user.cc ?? 0,
  });
});

// ===========================================================
// ✅ POST — Equip Trainer (Debounced Discord Save)
// ===========================================================
let lastTrainerSave = 0; // global throttle timestamp

app.post("/api/set-trainer", express.json(), async (req, res) => {
  try {
    const { id, name, file } = req.body;

    if (!id || !file)
      return res.status(400).json({ success: false, error: "Missing id/file" });

    if (!requireDashboardSession(req, id))
      return res.status(403).json({ success: false, error: "Invalid or expired session" });

    await lockUser(id, async () => {
      const user = trainerData[id];
      if (!user)
        return res.status(404).json({ success: false, error: "User not found" });

      user.displayedTrainer = file;
      trainerData[id] = user;

      await enqueueSave(trainerData);

      console.log(`✅ ${id} equipped trainer ${file}`);
      res.json({ success: true });
    });
  } catch (err) {
    console.error("❌ /api/set-trainer failed:", err.message);
    res.status(500).json({ success: false });
  }
});

// ===========================================================
// Purchase Trainer
// ===========================================================
app.post("/api/unlock-trainer", express.json(), async (req, res) => {
  const { id, file } = req.body;

  if (!id || !file) return res.status(400).json({ error: "Missing id/file" });
  if (!requireDashboardSession(req, id))
    return res.status(403).json({ error: "Invalid or expired session" });

  await lockUser(id, async () => {
    const user = trainerData[id];
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.trainers) user.trainers = [];
    if (user.trainers.includes(file))
      return res.status(400).json({ error: "Trainer already owned" });

    const { getFlattenedTrainers } = await import("./utils/dataLoader.js");
    const trainers = await getFlattenedTrainers();

    const trainer = trainers.find(
      (t) =>
        t.sprites &&
        t.sprites.some((s) => {
          const fname = (s.file || s).toLowerCase();
          return fname === file.toLowerCase();
        })
    );

    if (!trainer) return res.status(404).json({ error: "Trainer not found" });

    const tier = (trainer.tier || trainer.rarity || "common").toLowerCase();
    const cost = TRAINER_COSTS[tier];

    if (!cost) return res.status(400).json({ error: `Unknown trainer tier: ${tier}` });
    if ((user.cc ?? 0) < cost) return res.status(400).json({ error: `Requires ${cost} CC` });

    user.cc -= cost;
    user.trainers.push(file);

    await enqueueSave(trainerData);

    res.json({ success: true, file, cost, tier });
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
  if (!user)
    return res.status(404).json({ error: "User not found" });

  // --- ensure schema consistency (read-safe) ---
const items = user.items ?? { evolution_stone: 0 };
const cc = user.cc ?? 0;
const tp = user.tp ?? 0;
const rank = getRank(tp);
const pokemon = user.pokemon ?? {};
const currentTeam = user.displayedPokemon ?? [];

// flatten response for front-end
res.json({
  id: user.id,
  cc,
  tp,
  rank,
  items,
  pokemon,
  currentTeam,
});

});

// ✅ POST — set full Pokémon team (up to 6) — Ghost Pokémon Auto-Clean
app.post("/api/set-pokemon-team", express.json(), async (req, res) => {
  try {
    const { id, team } = req.body;

    if (!id || !Array.isArray(team))
      return res.status(400).json({ success: false, error: "Missing id/team" });

    if (!requireDashboardSession(req, id))
      return res.status(403).json({ success: false, error: "Invalid or expired session" });

    await lockUser(id, async () => {
      const user = trainerData[id];
      if (!user)
        return res.status(404).json({ success: false, error: "User not found" });

      const owns = (pid) => {
        const p = user.pokemon?.[pid];
        return !!p && (p.normal > 0 || p.shiny > 0);
      };

      user.displayedPokemon = (user.displayedPokemon || []).filter((pid) => owns(pid));

      const normalized = [...new Set(team.map((n) => Number(n)).filter((n) => Number.isInteger(n)))];

      if (normalized.length === 0 || normalized.length > 6)
        return res.status(400).json({ success: false, error: "Team must be 1–6 unique IDs" });

      const unowned = normalized.filter((pid) => !owns(pid));
      if (unowned.length)
        return res.status(400).json({
          success: false,
          error: `Unowned Pokémon: ${unowned.join(", ")}`,
        });

      user.displayedPokemon = normalized;
      trainerData[id] = user;

      await enqueueSave(trainerData);

      res.json({ success: true });
    });
  } catch (err) {
    console.error("❌ /api/set-pokemon-team:", err.message);
    res.status(500).json({ success: false });
  }
});

// ==========================================================
// 🧬 EVOLVE — Atomic Per-User Lock Version
// ==========================================================
app.post("/api/pokemon/evolve", express.json(), async (req, res) => {
  const { id, baseId, targetId, shiny } = req.body;

  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!requireDashboardSession(req, id))
    return res.status(403).json({ error: "Invalid or expired session" });

  if (!trainerData[id]) return res.status(404).json({ error: "User not found" });

  await lockUser(id, async () => {
    const user = trainerData[id];

    const pokemonData = JSON.parse(fsSync.readFileSync("public/pokemonData.json", "utf8"));
    const base = pokemonData[baseId];
    const target = pokemonData[targetId];

    if (!base || !target) return res.status(400).json({ error: "Invalid Pokémon IDs" });

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

    const currentTier = base.tier;
    const nextTier = target.tier;
    const key = `${currentTier}-${nextTier}`;

    const cost = COST_MAP[key] ?? 0;
    if (cost <= 0)
      return res.status(400).json({
        error: `Evolution path ${currentTier} ➝ ${nextTier} is not supported`,
      });

    if (!user.items || user.items.evolution_stone < cost)
      return res.status(400).json({ error: "Not enough Evolution Stones." });

    const variant = shiny ? "shiny" : "normal";

    if (!user.pokemon?.[baseId]?.[variant])
      return res.status(400).json({
        error: `You do not own a ${shiny ? "shiny " : ""}${base.name}.`,
      });

    user.items.evolution_stone -= cost;

    user.pokemon[baseId][variant] -= 1;
    if (user.pokemon[baseId].normal <= 0 && user.pokemon[baseId].shiny <= 0)
      delete user.pokemon[baseId];

    user.pokemon[targetId] ??= { normal: 0, shiny: 0 };
    user.pokemon[targetId][variant] += 1;

    await enqueueSave(trainerData);

    return res.json({
      success: true,
      evolved: { from: base.name, to: target.name, shiny, cost },
      stonesRemaining: user.items.evolution_stone,
    });
  });
});

// 💝 Donate Pokémon (normal + shiny supported, 5× CC for shiny)
app.post("/api/pokemon/donate", express.json(), async (req, res) => {
  const { id, pokeId, shiny } = req.body;

  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!requireDashboardSession(req, id))
    return res.status(403).json({ error: "Invalid or expired session" });

  await lockUser(id, async () => {
    const user = trainerData[id];
    if (!user) return res.status(404).json({ error: "User not found" });

    const pokemonData = JSON.parse(fsSync.readFileSync("public/pokemonData.json", "utf8"));
    const p = pokemonData[pokeId];
    if (!p) return res.status(400).json({ error: "Invalid Pokémon ID" });

    const ccMap = {
      common: 250,
      uncommon: 500,
      rare: 1000,
      epic: 2500,
      legendary: 5000,
      mythic: 10000,
    };

    const baseValue = ccMap[p.tier] ?? 0;
    const variant = shiny ? "shiny" : "normal";
    const owned = user.pokemon?.[pokeId]?.[variant] || 0;

    if (owned <= 0)
      return res.status(400).json({
        error: `You don’t own a ${shiny ? "shiny " : ""}${p.name} to donate.`,
      });

    const finalValue = shiny ? baseValue * 5 : baseValue;

    user.pokemon[pokeId][variant] -= 1;
    if (user.pokemon[pokeId].normal <= 0 && user.pokemon[pokeId].shiny <= 0)
      delete user.pokemon[pokeId];

    user.cc = (user.cc ?? 0) + finalValue;

    await enqueueSave(trainerData);

    res.json({
      success: true,
      donated: { name: p.name, shiny },
      gainedCC: finalValue,
      totalCC: user.cc,
    });
  });
});

 // ==========================================================
// 🤖 BOT READY EVENT
// ==========================================================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

 // ✅ Load local commands FIRST
  await loadLocalCommands();

// Register only if enabled
  if (process.env.REGISTER_COMMANDS === "true") {
    await registerCommands();
  }

  try {
    trainerData = await loadTrainerData();

    // ❗ ABSOLUTE SANITY CHECK — DO NOT PROCEED WITH EMPTY DATA
    if (
      !trainerData ||
      typeof trainerData !== "object" ||
      Array.isArray(trainerData) ||
      Object.keys(trainerData).length === 0
    ) {
      console.error("❌ FATAL: Loaded EMPTY or INVALID trainerData. Startup aborted.");
      process.exit(1); // ⛔ prevents wipe
    }

    // ❗ DO NOT SAVE HERE
    // trainerData = sanitizeTrainerData(trainerData);
    // await saveDataToDiscord(trainerData);

  } catch (err) {
    console.error("❌ Trainer data load failed:", err.message);
    console.error("❌ Startup aborted to prevent DATA LOSS.");
    process.exit(1); // ⛔ stops bot before it wipes JSON
  }

  // ==========================================================
  // 📰 INITIAL NEWS CHECK (commands are registered at boot now)
  // ==========================================================
  try {
    await checkPokeBeach();
  } catch (err) {
    console.error("❌ PokéBeach initial check failed:", err?.message || err);
  }

  // AFTER startup, normal saves happen via saveQueue
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
// 🚀 LAUNCH
// ==========================================================
console.log("🚀 About to login to Discord... BOT_TOKEN present?", !!process.env.BOT_TOKEN);

async function loginWithTimeout(ms = 60_000) {
  return Promise.race([
    client.login(process.env.BOT_TOKEN),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Discord login timeout after ${ms}ms`)), ms)
    ),
  ]);
}

loginWithTimeout(60_000)
  .then(() => console.log("✅ client.login() resolved"))
  .catch((err) => {
    console.error("❌ client.login failed/timeout:", err?.stack || err);
    process.exit(1);
  });

