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


// ==========================================================
// 🔒 PER-USER WRITE LOCK MANAGER (Option A)
// Prevents lost Pokémon, lost Trainers, and overwrite collisions
// ==========================================================

const userLocks = new Map();

/**
 * Acquire a lock for a specific user.
 * Ensures only ONE write operation runs at a time per user.
 */
async function withUserLock(userId, fn) {
  const existing = userLocks.get(userId) || Promise.resolve();

  let release;
  const lock = new Promise(resolve => (release = resolve));

  userLocks.set(userId, existing.then(() => lock));

  try {
    return await fn();
  } finally {
    release();
    // Clean chain if this was the last pending lock
    if (userLocks.get(userId) === lock) {
      userLocks.delete(userId);
    }
  }
}

// Simple alias so all endpoints use the same API
function lockUser(userId, fn) {
  return withUserLock(userId, fn);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const staticPath = path.join(__dirname, "public");

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

app.get("/public/picker-shop", (_, res) =>
  res.sendFile(path.join(staticPath, "picker-shop", "index.html"))
);

// Health
app.get("/", (_, res) => res.send("Bot running"));
app.get("/healthz", (_, res) =>
  res.json({ ready: isReady, uptime: Math.floor((Date.now() - startTime) / 1000) })
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
  selectRandomTrainerForUser,
} from "./utils/weightedRandom.js";
import { rollForShiny } from "./shinyOdds.js";
import { rarityEmojis, spritePaths } from "./spriteconfig.js";
import { loadTrainerSprites } from "./utils/dataLoader.js";
import { updateUserRole } from "./utils/updateUserRole.js";
import { broadcastReward } from "./utils/broadcastReward.js";
import {
  createPokemonRewardEmbed,
  createTrainerRewardEmbed,
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
const MESSAGE_REWARD_CHANCE = 0.02;
const REACTION_REWARD_CHANCE = 0.02;
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

// Export if using ES modules
export { generateToken, validateToken, getChannelIdForToken };


let trainerData = {};
let discordSaveCount = 0;
let commandSaveQueue = null;
let isReady = false;
let isSaving = false;
const startTime = Date.now();
const rewardCooldowns = new Map();
const userCooldowns = new Map();
const RANK_TIERS = getRankTiers();

let dirty = false; // 🚨 tracks unsaved changes for 15-min backups
global.markDirty = () => {
  dirty = true;
};

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

async function saveDataToDiscord(data) {
  if (isSaving) {
    console.log("⏳ Save in progress – queued...");
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (!isSaving) {
          clearInterval(interval);
          resolve(saveDataToDiscord(data));
        }
      }, 100);
    });
  }

  isSaving = true;
  try {
    const storageChannel = await client.channels.fetch(process.env.STORAGE_CHANNEL_ID);
    const buffer = Buffer.from(JSON.stringify(data, null, 2));
    const file = new AttachmentBuilder(buffer, {
      name: `trainerData-${new Date().toISOString()}.json`,
    });
    await storageChannel.send({
      content: `📦 #${++discordSaveCount}`,
      files: [file],
    });
    console.log(`✅ Discord backup #${discordSaveCount}`);
  } catch (err) {
    console.error("❌ Discord save failed:", err.message);
  } finally {
    isSaving = false;
  }
}

// ==========================================================
// 🎁 DETERMINISTIC RANDOM REWARD SYSTEM (ATOMIC PER-USER LOCK)
// ==========================================================
async function tryGiveRandomReward(userObj, interactionUser, msgOrInteraction) {
  console.log("⚙️ tryGiveRandomReward executed for", interactionUser.username);

  // ========== ATOMIC PER-USER LOCK ==========
  const userId = interactionUser.id;
  if (!userLocks.has(userId)) {
    userLocks.set(userId, Promise.resolve());
  }

  const lock = userLocks.get(userId);

  const task = (async () => {
    // ⏳ Cooldown (no RNG gating)
    const now = Date.now();
    const last = rewardCooldowns.get(interactionUser.id) || 0;
    if (now - last < REWARD_COOLDOWN) return;
    rewardCooldowns.set(interactionUser.id, now);

    // ================================
    // 🎯 PITY SYSTEM (no shiny impact)
    // ================================
    userObj.luck ??= 0;

    const BASE_CHANCE = MESSAGE_REWARD_CHANCE;  // 0.02
    const MAX_CHANCE = 0.10;                    // 10%
    const PITY_INCREMENT = 0.005;               // +0.5%

    // Increase pity every call
    userObj.luck = Math.min(MAX_CHANCE, userObj.luck + PITY_INCREMENT);

    // Final chance
    const finalChance = Math.min(MAX_CHANCE, BASE_CHANCE + userObj.luck);

    // Reward fails → keep pity, exit
    if (Math.random() >= finalChance) {
      return;
    }

    // Guaranteed reward → reset pity
    userObj.luck = 0;

    // ============================
    // Load Pokémon + Trainer pools
    // ============================
    const allPokemon = await getAllPokemon();
    const { getFlattenedTrainers } = await import("./utils/dataLoader.js");
    const flatTrainers = await getFlattenedTrainers();

    let reward = null;
    let isShiny = false;
    let isPokemon = false;

    try {
      // ================================
      // 🎲 50/50 Pokémon vs Trainer
      // ================================
      if (Math.random() < 0.61) {
        isPokemon = true;
        reward = selectRandomPokemonForUser(allPokemon, userObj, "pokeball");
        isShiny = rollForShiny(userObj.tp || 0);

        userObj.pokemon ??= {};
        userObj.pokemon[reward.id] ??= { normal: 0, shiny: 0 };
        if (isShiny) userObj.pokemon[reward.id].shiny++;
        else userObj.pokemon[reward.id].normal++;

      } else {
        isPokemon = false;
        reward = selectRandomTrainerForUser(flatTrainers, userObj);

        // Name normalization
        reward.name =
          reward.name ||
          reward.displayName ||
          reward.groupName ||
          (reward.filename ? reward.filename.replace(".png", "") : "Trainer");

        reward.name = reward.name
          .replace(/_/g, " ")
          .replace(/\b\w/g, c => c.toUpperCase())
          .trim();

        reward.tier = reward.tier || reward.rarity || "common";

        // Trainer inventory increment
        userObj.trainers ??= {};
        const trainerKey =
          reward.spriteFile ||
          reward.filename ||
          `${reward.id}.png`;

        userObj.trainers[trainerKey] =
          (userObj.trainers[trainerKey] || 0) + 1;

        console.log(`🎁 Trainer reward → ${reward.name} (${reward.tier}) key=${trainerKey}`);
      }

    } catch (err) {
      console.error("❌ Reward selection failed:", err);
      return;
    }

    // Save
    await saveTrainerDataLocal(trainerData);

    // Sprite URL
    let spriteUrl;
    if (isPokemon) {
      spriteUrl = isShiny
        ? `${spritePaths.shiny}${reward.id}.gif`
        : `${spritePaths.pokemon}${reward.id}.gif`;
    } else {
      const cleanFile = (reward.filename || reward.spriteFile || `${reward.id}.png`)
        .replace(/^trainers?_2\//, "")
        .replace(/\s+/g, "")
        .toLowerCase();
      spriteUrl = `${spritePaths.trainers}${cleanFile}`;
    }

    // Embed
    const embed = isPokemon
      ? createPokemonRewardEmbed(reward, isShiny, spriteUrl)
      : createTrainerRewardEmbed(reward, spriteUrl);

    // Public announcement
    try {
      const announcement = isPokemon
        ? `🎉 <@${interactionUser.id}> caught **${isShiny ? "✨ shiny " : ""}${reward.name}**!`
        : `👥 <@${interactionUser.id}> recruited **${reward.name}**!`;
      await msgOrInteraction.channel.send({ content: announcement, embeds: [embed] });
    } catch (err) {
      console.warn("⚠️ Public reward announcement failed:", err.message);
    }

    // Global broadcast
    try {
      await broadcastReward(client, {
        user: interactionUser,
        type: isPokemon ? "pokemon" : "trainer",
        item: {
          id: reward.id,
          name: reward.name,
          rarity: reward.rarity || reward.tier || "common",
          spriteFile: !isPokemon ? reward.filename || reward.spriteFile : null,
        },
        shiny: isShiny,
        source: "random encounter",
      });
    } catch (err) {
      console.error("❌ broadcastReward failed:", err.message);
    }

    console.log(`✅ Reward granted to ${interactionUser.username}`);
  });

  // Chain lock
  const newLock = lock.then(task).catch(err => {
    console.error("❌ Atomic lock error in tryGiveRandomReward:", err);
  });

  userLocks.set(userId, newLock);
  return newLock;
}

// ==========================================================
// 📂 COMMAND LOADER
// ==========================================================
async function loadCommands() {
  const commandsPath = path.resolve("./commands");
  const files = (await fs.readdir(commandsPath)).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    try {
      const imported = await import(`./commands/${file}`);
      const command = imported.default || imported;
      if (!command?.data?.name) {
        console.warn(`⚠️ ${file}: invalid command data`);
        continue;
      }
      client.commands.set(command.data.name, command);
      console.log(`✅ Loaded: ${command.data.name}`);
    } catch (err) {
      console.error(`❌ ${file}:`, err.message);
    }
  }

  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
  const commandsJSON = client.commands.map((c) => c.data.toJSON());
  console.log(`📡 Registering ${commandsJSON.length} commands...`);

  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commandsJSON,
    });
    console.log("✅ Commands registered globally");
  } catch (err) {
    console.error("❌ Command registration failed:", err.message);
  }
}

// ==========================================================
// 💾 SAVE MANAGEMENT
// ==========================================================
function debouncedDiscordSave() {
  // 🚫 No more debounced saves — only mark as dirty
  dirty = true;
  console.log("📝 debouncedDiscordSave() called — marked dirty (no immediate Discord backup)");
}

// ==========================================================
// 🕒 15-MINUTE DISCORD BACKUP (only if data changed)
// ==========================================================
setInterval(async () => {
  if (!dirty) {
    console.log("⏳ 15-minute save tick — no changes, skipping");
    return;
  }

  console.log("💾 15-minute interval — saving trainerData to Discord...");
  try {
    await saveDataToDiscord(trainerData);
    dirty = false; // 🔄 reset flag
    console.log("✅ Discord backup complete (15-minute interval)");
  } catch (err) {
    console.error("❌ Interval Discord save failed:", err.message);
  }
}, 15 * 60 * 1000);


// ==========================================================
// 🛑 GRACEFUL SHUTDOWN
// ==========================================================
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, shutting down...`);
  isReady = false;
  try {
    console.log("💾 Flushing pending saves...");
    const flushed = await shutdownFlush(10_000);
    if (!flushed) console.warn("⚠️ Some saves may not have completed");
    console.log("☁️ Final Discord backup...");
    await saveDataToDiscord(trainerData);
    console.log("✅ Shutdown complete");
    process.exit(0);
  } catch (err) {
    console.error("❌ Shutdown error:", err.message);
    process.exit(1);
  }
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ==========================================================
// 📰 POKÉBEACH SCRAPER (Simplified Link-Only, every 2 hours)
// ==========================================================
async function checkPokeBeach() {
  try {
    const newsChannel = await client.channels.fetch(process.env.NEWS_CHANNEL_ID);
    if (!newsChannel) return console.error("❌ NEWS_CHANNEL_ID invalid or missing.");

    console.log("📰 Checking PokéBeach...");
    const res = await fetch("https://www.pokebeach.com/");
    if (!res.ok) {
      console.error(`❌ Fetch failed: HTTP ${res.status}`);
      return;
    }

    const html = await res.text();
    const articles = [];
    const pattern =
      /<h[23][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;

    for (const match of html.matchAll(pattern)) {
      const link = match[1];
      const title = decode(match[2] || "").replace(/<[^>]+>/g, "").trim();
      if (link && title && link.includes("/20") && !link.includes("comment")) {
        articles.push({
          link: link.startsWith("http")
            ? link
            : `https://www.pokebeach.com${link}`,
          title,
        });
      }
    }

    if (!articles.length) {
      console.log("⚠️ No articles found.");
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

    console.log(`📢 Posting ${newArticles.length} new PokéBeach article(s)!`);
    for (const article of newArticles.slice(0, 3)) {
      await newsChannel.send(`${article.title}\n${article.link}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (err) {
    console.error("❌ PokéBeach check failed:", err.message);
  }
}
setInterval(checkPokeBeach, POKEBEACH_CHECK_INTERVAL);

// ==========================================================
// 🔧 SCHEMA NORMALIZATION
// ==========================================================
function normalizeUserSchema(id, user) {
  user.id ??= id;
  user.tp ??= 0;
  user.cc ??= 0;

  user.pokemon ??= {};
  user.trainers ??= {};

  user.displayedPokemon ??= [];
  user.displayedTrainer ??= null;

  user.lastDaily ??= 0;
  user.lastRecruit ??= 0;
  user.lastQuest ??= 0;
  if (!user.lastWeeklyPack || user.lastWeeklyPack === "0" || isNaN(new Date(user.lastWeeklyPack))) {
    user.lastWeeklyPack = null;
}

  user.onboardingComplete ??= false;
  user.onboardingDate ??= null;
  user.starterPokemon ??= null;

  user.items ??= { evolution_stone: 0 };
  user.purchases ??= [];

  user.luck ??= 0;           // user's pity meter  
  user.luckTimestamp ??= 0;  // last increment/decay tick  


  return user;
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
  trainers: {},
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

try {
  const member = await message.guild.members.fetch(userId);
  await updateUserRole(member, userObj.tp, message.channel);
} catch (err) {
  console.warn("⚠️ Rank update failed (messageCreate):", err.message);
}

  // 🎲 3% chance for bonus Pokémon or Trainer
  await tryGiveRandomReward(userObj, message.author, message);

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
  trainers: {},
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

  try {
    const member = await reaction.message.guild.members.fetch(userId);
    await updateUserRole(member, userObj.tp, reaction.message.channel);
  } catch (err) {
    console.warn("⚠️ Rank update failed (reaction):", err.message);
  }

  // 3% chance for random reward
 await tryGiveRandomReward(userObj, user, reaction.message);

});

// ==========================================================
// 🛍️ SHOP API — GET USER  (FINAL FIXED VERSION)
// ==========================================================
app.get("/api/user", (req, res) => {
  const { id, token } = req.query;

  if (!validateToken(id, token))
    return res.status(403).json({ error: "Invalid or expired token" });

 const user = trainerData[id];
if (!user)
  return res.status(404).json({ error: "User not found" });

// MUST reassign — otherwise missing fields never persist
trainerData[id] = normalizeUserSchema(id, user);

// Ensure rank is correct
trainerData[id].rank = getRank(trainerData[id].tp);

return res.json(trainerData[id]);

});


// ==========================================================
// 🛍️ SHOP API — UPDATE USER
// ==========================================================
app.post("/api/updateUser", express.json(), async (req, res) => {
  const { id, token, user } = req.body;

  if (!validateToken(id, token))
    return res.status(403).json({ error: "Invalid or expired token" });

  if (!trainerData[id])
    return res.status(404).json({ error: "User not found" });

  // Merge provided fields
  trainerData[id] = normalizeUserSchema(
  id,
  { ...trainerData[id], ...user }
);

  await saveTrainerDataLocal(trainerData);

  res.json({ success: true });
});

// ==========================================================
// 🛍️ SHOP API — POKÉMON REWARD (Ball-Aware + Atomic User Lock)
// ==========================================================
app.post("/api/rewardPokemon", express.json(), async (req, res) => {
  const { id, token, source } = req.body;

  if (!validateToken(id, token))
    return res.status(403).json({ error: "Invalid token" });

  if (!trainerData[id])
    return res.status(404).json({ error: "User not found" });

  await lockUser(id, async () => {
    const user = trainerData[id];
    const allPokemon = await getAllPokemon();

    // 🎯 Ball-aware selection
    const reward = selectRandomPokemonForUser(allPokemon, user, source);

    if (!reward) {
      return res.json({
        success: false,
        error: "No Pokémon could be selected."
      });
    }

    // ✨ Shiny roll
    const shiny = rollForShiny(user.tp || 0);

    // 🗃️ Safe atomic inventory update
    user.pokemon ??= {};
    user.pokemon[reward.id] ??= { normal: 0, shiny: 0 };

    if (shiny) user.pokemon[reward.id].shiny++;
    else user.pokemon[reward.id].normal++;

    await saveTrainerDataLocal(trainerData);

    res.json({
      success: true,
      pokemon: {
        id: reward.id,
        name: reward.name,
        rarity: reward.tier || reward.rarity || "common",
        shiny,
        sprite: shiny
          ? `/public/sprites/pokemon/shiny/${reward.id}.gif`
          : `/public/sprites/pokemon/normal/${reward.id}.gif`
      }
    });
  });
});

// ==========================================================
// 🛍️ SHOP API — TRAINER REWARD (FIXED + NORMALIZED)
// ==========================================================
app.post("/api/rewardTrainer", express.json(), async (req, res) => {
  const { id, token, tier } = req.body;

  await withUserLock(id, async () => {
    if (!validateToken(id, token))
      return res.status(403).json({ error: "Invalid token" });

    const user = trainerData[id];
    if (!user)
      return res.status(404).json({ error: "User not found" });

  const { getFlattenedTrainers } = await import("./utils/dataLoader.js");
  const flat = await getFlattenedTrainers();

  // Filter by tier
  const pool = flat.filter(t => (t.tier || t.rarity) === tier);
  if (!pool.length)
    return res.status(400).json({ error: `No trainers of tier ${tier}` });

  // Pick one
  const reward = pool[Math.floor(Math.random() * pool.length)];

  // ------------------------------
  // 🧼 NAME NORMALIZATION (FIXED)
  // ------------------------------
  let cleanedName =
    reward.name ||
    reward.displayName ||
    reward.groupName ||
    (reward.filename ? reward.filename.replace(".png", "") : "trainer");

  cleanedName = cleanedName
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());

  // ------------------------------
  // 🧼 FILE + SPRITE NORMALIZATION (FIXED)
  // ------------------------------
  let cleanedFile =
    reward.spriteFile ||
    reward.filename ||
    reward.file ||
    "";

  cleanedFile = cleanedFile
    .trim()
    .toLowerCase()
    .replace(/^trainers?_2\//, "")
    .replace(/\.png\.png$/, ".png")
    .replace(/\s+/g, "");

  const spriteUrl = `${spritePaths.trainers}${cleanedFile}`;

  // ------------------------------
  // 🧼 SAVE TO USER INVENTORY
  // ------------------------------
  user.trainers ??= {};
  user.trainers[cleanedFile] = (user.trainers[cleanedFile] || 0) + 1;

  await saveTrainerDataLocal(trainerData);

  // ------------------------------
  // ⭐ SEND FULL, CLEAN TRAINER OBJECT
  // ------------------------------
  res.json({
    success: true,
    trainer: {
      name: cleanedName,
      rarity: reward.tier || reward.rarity || "common",
      sprite: spriteUrl,
      file: cleanedFile
    }
  });
});
});

// ==========================================================
// ⚡ INTERACTION HANDLER (Slash Commands + Buttons)
// ==========================================================
client.on("interactionCreate", async (interaction) => {
  // 🧭 Slash Command Handling
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      return safeReply(interaction, { content: "❌ Unknown command.", ephemeral: true });
    }

    try {
      await command.execute(
  interaction,
  trainerData,
  saveTrainerDataLocal,
  saveDataToDiscord,
  client
);
      await saveTrainerDataLocal(trainerData);

    } catch (err) {
      console.error(`❌ ${interaction.commandName}:`, err.message);
      await safeReply(interaction, {
        content: `❌ Error executing \`${interaction.commandName}\`.`,
        ephemeral: true,
      });
    }
    return;
  }

// ==========================================================
// 🧩 Button Interactions (v7.1)
// ==========================================================
if (interaction.isButton()) {
  const id = interaction.customId;

  // ✅ Allow Shop buttons (confirm/cancel/disabled)
  const allowedPrefixes = ["confirm_", "cancel_", "disabled_"];
  if (allowedPrefixes.some(prefix => id.startsWith(prefix))) {
    // Shop handles its own interactions
    return;
  }

  // ✅ Let all other buttons (like trainercard carousels) fall through
  return; // avoids “Unknown button interaction.”
}
});

app.post("/api/claim-weekly", express.json(), async (req, res) => {
  const { id, token } = req.body;

  if (!validateToken(id, token))
    return res.status(403).json({ error: "Invalid or expired token" });

  const user = trainerData[id];
  if (!user)
    return res.status(404).json({ error: "User not found" });

  // 🔥 HARD COOL DOWN CHECK
  const last = user.lastWeeklyPack ? new Date(user.lastWeeklyPack).getTime() : 0;
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  if (now - last < sevenDays) {
    return res.status(400).json({ error: "Weekly pack already claimed." });
  }

  // Set cooldown FIRST (prevents spam + refresh exploits)
  user.lastWeeklyPack = new Date().toISOString();

  await saveTrainerDataLocal(trainerData);


  res.json({ success: true });
});

// ==========================================================
// 🧰 WEEKLY PACK — Forced Rarity + Atomic User Lock
// ==========================================================
app.post("/api/weekly-pack", express.json(), async (req, res) => {
  const { id, token } = req.body;

  if (!validateToken(id, token))
    return res.status(403).json({ error: "Invalid or expired token" });

  if (!trainerData[id])
    return res.status(404).json({ error: "User not found" });

  await lockUser(id, async () => {
    const user = trainerData[id];

    const last = user.lastWeeklyPack ? new Date(user.lastWeeklyPack).getTime() : 0;
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    if (now - last < sevenDays) {
      return res.status(400).json({ error: "Weekly pack already claimed." });
    }

    // Lock cooldown immediately
    user.lastWeeklyPack = new Date().toISOString();

    const results = [];
    const allPokemon = await getPokemonCached();

    const poolFor = tier => allPokemon.filter(p => p.tier === tier);
    const pick = tier => {
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
          : `/public/sprites/pokemon/normal/${reward.id}.gif`
      });
    }

    async function giveTrainer(tier) {
      const { getFlattenedTrainers } = await import("./utils/dataLoader.js");
      const flat = await getFlattenedTrainers();

      const pool = flat.filter(t => (t.tier || t.rarity) === tier);
      if (!pool.length) return;

      const reward = pool[Math.floor(Math.random() * pool.length)];
      const file = (reward.spriteFile || reward.filename || reward.file || "")
        .trim()
        .toLowerCase()
        .replace(/^trainers?_2\//, "")
        .replace(/\.png\.png$/, ".png");

      const sprite = `${spritePaths.trainers}${file}`;

      let name =
        reward.name ||
        reward.displayName ||
        reward.groupName ||
        file.replace(".png", "");

      name = name
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());

      user.trainers ??= {};
      user.trainers[file] = (user.trainers[file] || 0) + 1;

      results.push({
        type: "trainer",
        name,
        rarity: tier,
        sprite,
        file
      });
    }

    // Apply forced rarity structure
    await givePokemon("common");
    await givePokemon("common");
    await givePokemon("common");
    await givePokemon("uncommon");
    await givePokemon("uncommon");
    await givePokemon("rare");

    await giveTrainer("common");
    await giveTrainer("common");
    await giveTrainer("common");
    await giveTrainer("uncommon");
    await giveTrainer("uncommon");
    await giveTrainer("rare");

    // One save at end
    await saveTrainerDataLocal(trainerData);

    res.json({
      success: true,
      rewards: results
    });
  });
});

// ===========================================================
// 🧩 TRAINER PICKER API ENDPOINT (Memory-based)
// ===========================================================
app.get("/api/user-trainers", (req, res) => {
  const { id, token } = req.query;
  if (!validateToken(id, token)) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }

  const user = trainerData[id];
  if (!user) {
    return res.status(404).json({ error: "User not found in memory" });
  }

  const owned =
    typeof user.trainers === "object"
      ? Object.keys(user.trainers)
      : Array.isArray(user.trainers)
      ? user.trainers
      : [];

  res.json({ owned });
});

// ===========================================================
// ✅ POST — Equip Trainer (Debounced Discord Save)
// ===========================================================
let lastTrainerSave = 0; // global throttle timestamp

app.post("/api/set-trainer", express.json(), async (req, res) => {
  try {
    const { id, token, name, file } = req.body;
    if (!id || !token || !file) {
      console.warn("⚠️ Missing fields in /api/set-trainer", req.body);
      return res.status(400).json({ success: false, error: "Missing id, token, or file" });
    }

    // ✅ Validate token
    if (!validateToken(id, token)) {
      console.warn("⚠️ Invalid or expired token for", id);
      return res.status(403).json({ success: false, error: "Invalid or expired token" });
    }

    // ✅ Ensure user exists
    const user = trainerData[id];
    if (!user) {
      console.warn("⚠️ User not found:", id);
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // ✅ Equip trainer locally
    user.displayedTrainer = file;
    trainerData[id] = user;
    await saveTrainerDataLocal(trainerData);

    console.log(`✅ ${id} equipped trainer ${file}`);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/set-trainer failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===========================================================
// 🧩 POKÉMON PICKER API ENDPOINTS (Supports 6-Pokémon Teams)
// ===========================================================

// ✅ GET full user Pokémon data (for web picker)
app.get("/api/user-pokemon", (req, res) => {
  const { id, token } = req.query;
  if (!validateToken(id, token))
    return res.status(403).json({ error: "Invalid or expired token" });

  const user = trainerData[id];
  if (!user)
    return res.status(404).json({ error: "User not found" });

  // --- ensure schema consistency ---
  user.items ??= { evolution_stone: 0 };
  user.cc ??= 0;
  user.tp ??= 0;
  user.rank = getRank(user.tp);   // always derive from TP
  user.pokemon ??= {};
  user.displayedPokemon ??= [];

  // flatten response for front-end
  res.json({
    id: user.id,
    cc: user.cc,
    tp: user.tp,
    rank: user.rank,
    items: user.items,
    pokemon: user.pokemon,
    currentTeam: user.displayedPokemon,
  });
});
// ✅ POST — set full Pokémon team (up to 6) — Debounced Discord Save
let lastTeamSave = 0; // global throttle timestamp

app.post("/api/set-pokemon-team", express.json(), async (req, res) => {
  try {
    const { id, token, team } = req.body;

    // Basic validation
    if (!id || !token || !Array.isArray(team)) {
      return res.status(400).json({ success: false, error: "Missing id, token, or team array" });
    }
    if (!validateToken(id, token)) {
      return res.status(403).json({ success: false, error: "Invalid or expired token" });
    }
    const user = trainerData[id];
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Normalize & validate team list (1–6 unique ints)
    const normalized = [...new Set(team.map(n => Number(n)).filter(n => Number.isInteger(n)))];
    if (normalized.length === 0 || normalized.length > 6) {
      return res.status(400).json({ success: false, error: "Team must contain 1–6 valid Pokémon IDs" });
    }

    // (Optional) ensure each chosen ID is actually owned
    const owns = (pid) => {
      const p = user.pokemon?.[pid];
      return !!p && ((typeof p === "number" && p > 0) || p.normal > 0 || p.shiny > 0);
    };
    const unowned = normalized.filter(pid => !owns(pid));
    if (unowned.length) {
      return res.status(400).json({ success: false, error: `You don't own: ${unowned.join(", ")}` });
    }

    // ✅ Schema-compliant write
    delete user.team; // no team field in schema
    user.displayedPokemon = normalized;                // <-- array of up to 6
    // lead is the first element; no separate field needed

    trainerData[id] = user;
    await saveTrainerDataLocal(trainerData);

    // Debounced Discord backup
    const now = Date.now();
    if (now - lastTeamSave > 60_000) {
      lastTeamSave = now;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/set-pokemon-team failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================
// 🧬 EVOLVE — Atomic Per-User Lock Version
// ==========================================================
app.post("/api/pokemon/evolve", express.json(), async (req, res) => {
  const { id, token, baseId, targetId, shiny } = req.body;

  if (!validateToken(id, token))
    return res.status(403).json({ error: "Invalid or expired token" });

  const user = trainerData[id];
  if (!user)
    return res.status(404).json({ error: "User not found" });

  // ======================================
  // ATOMIC LOCK START
  // ======================================
  if (!userLocks.has(id)) {
    userLocks.set(id, Promise.resolve());
  }
  const lock = userLocks.get(id);

  const task = async () => {
    const pokemonData = JSON.parse(
      fsSync.readFileSync("public/pokemonData.json", "utf8")
    );

    const base = pokemonData[baseId];
    const target = pokemonData[targetId];

    if (!base || !target)
      return res.status(400).json({ error: "Invalid Pokémon IDs" });

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

      "epic-mythic": 12
    };

    const currentTier = base.tier;
    const nextTier = target.tier;
    const key = `${currentTier}-${nextTier}`;

    const cost = COST_MAP[key] ?? 0;

    if (cost <= 0)
      return res.status(400).json({
        error: `Evolution path ${currentTier} ➝ ${nextTier} is not supported`
      });

    if (!user.items || user.items.evolution_stone < cost)
      return res.status(400).json({ error: "Not enough Evolution Stones." });

    const variant = shiny ? "shiny" : "normal";
    const owned = user.pokemon?.[baseId]?.[variant] || 0;

    if (owned <= 0)
      return res.status(400).json({
        error: `You do not own a ${shiny ? "shiny " : ""}${base.name}.`
      });

    // ======================
    // APPLY EVOLUTION
    // ======================
    user.items.evolution_stone -= cost;

    user.pokemon[baseId][variant] -= 1;
    if (user.pokemon[baseId].normal <= 0 && user.pokemon[baseId].shiny <= 0)
      delete user.pokemon[baseId];

    user.pokemon[targetId] ??= { normal: 0, shiny: 0 };
    user.pokemon[targetId][variant] += 1;

    await saveTrainerDataLocal(trainerData);

    return res.json({
      success: true,
      evolved: {
        from: base.name,
        to: target.name,
        shiny,
        cost
      },
      stonesRemaining: user.items.evolution_stone
    });
  };

  const newLock = lock.then(task).catch(err => {
    console.error("❌ evolve atomic lock error:", err);
  });

  userLocks.set(id, newLock);
  return newLock;
});

// 💝 Donate Pokémon (normal + shiny supported, 5× CC for shiny)
app.post("/api/pokemon/donate", express.json(), async (req, res) => {
  const { id, token, pokeId, shiny } = req.body;

  if (!validateToken(id, token))
    return res.status(403).json({ error: "Invalid or expired token" });

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

    await saveTrainerDataLocal(trainerData);

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

  try {
    trainerData = await loadTrainerData();
    trainerData = sanitizeTrainerData(trainerData); // 🧼 Clean it immediately
  } catch (err) {
    console.error("❌ Trainer data load failed:", err.message);
    trainerData = {};
  }

  // ==========================================================
  // 🧹 AUTO-CLEAN: Remove invalid or unowned displayedTrainer & displayedPokemon
  // ==========================================================
  try {
    // ---------- TRAINER CLEANUP ----------
    const trainerSpriteDir = path.join(process.cwd(), "public/sprites/trainers_2");
    const validTrainerFiles = new Set(
      fsSync
        .readdirSync(trainerSpriteDir)
        .filter(f => f.toLowerCase().endsWith(".png"))
        .map(f => f.toLowerCase())
    );

    let cleanedTrainers = 0;
    for (const [id, user] of Object.entries(trainerData)) {
      if (!user.displayedTrainer) continue;
      const normalized = user.displayedTrainer.toLowerCase().trim();
      const ownsTrainer =
        user.trainers &&
        Object.keys(user.trainers).some(t => t.toLowerCase().trim() === normalized);

      if (!validTrainerFiles.has(normalized) || !ownsTrainer) {
        console.warn(
          `⚠️ Removed invalid or unowned trainer for ${id}: ${user.displayedTrainer}`
        );
        delete user.displayedTrainer;
        cleanedTrainers++;
      }
    }

    // ---------- POKÉMON CLEANUP ----------
    const pokemonPath = path.join(process.cwd(), "public/pokemonData.json");
    let validPokemonIDs = new Set();
    try {
      const pokemonData = JSON.parse(fsSync.readFileSync(pokemonPath, "utf8"));
      validPokemonIDs = new Set(Object.keys(pokemonData).map(k => Number(k)));
    } catch (err) {
      console.warn("⚠️ Could not read pokemonData.json — skipping displayedPokemon validation.");
    }

    let cleanedPokemon = 0;
    for (const [id, user] of Object.entries(trainerData)) {
      if (!Array.isArray(user.displayedPokemon)) continue;
      const before = user.displayedPokemon.length;
      user.displayedPokemon = user.displayedPokemon.filter(pid => {
        const owned =
          user.pokemon?.[pid] &&
          ((typeof user.pokemon[pid] === "number" && user.pokemon[pid] > 0) ||
            user.pokemon[pid].normal > 0 ||
            user.pokemon[pid].shiny > 0);
        return validPokemonIDs.has(Number(pid)) && owned;
      });
      if (user.displayedPokemon.length < before) {
        cleanedPokemon++;
        console.warn(`⚠️ Removed invalid or unowned Pokémon for ${id}`);
      }
    }

    // ---------- SUMMARY ----------
    if (cleanedTrainers > 0 || cleanedPokemon > 0) {
      console.log(
        `🧹 Cleaned ${cleanedTrainers} invalid/unowned trainer(s) and ${cleanedPokemon} invalid/unowned Pokémon team(s)`
      );
      await saveDataToDiscord(trainerData);
    } else {
      console.log("✅ No invalid or unowned displayedTrainer/displayedPokemon entries found");
    }
  } catch (err) {
    console.error("❌ Auto-clean failed:", err.message);
  }

  // ==========================================================
  // 🧩 LOAD COMMANDS & INITIAL NEWS CHECK
  // ==========================================================
  try {
    await loadCommands();
  } catch (err) {
    console.error("❌ Command registration failed:", err.message);
  }

  try {
    await checkPokeBeach();
  } catch (err) {
    console.error("❌ PokéBeach initial check failed:", err.message);
  }

  // 🪣 Save immediately after cleaning
  try {
    await saveDataToDiscord(trainerData);
  } catch (err) {
    console.error("❌ Initial Discord save failed:", err.message);
  }

  isReady = true;
  console.log("✨ Bot ready and accepting commands!");
});

// ==========================================================
// 🚀 LAUNCH WEB SERVER
// ==========================================================
app.listen(PORT, () =>
  console.log(`✅ Listening on port ${PORT}`)
);

// ==========================================================
// 🚀 LAUNCH
// ==========================================================
client.login(process.env.BOT_TOKEN);