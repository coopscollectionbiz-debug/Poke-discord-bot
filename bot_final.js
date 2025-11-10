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
import path from "path";
import express from "express";
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

// ==========================================================
// 📦 Internal Utilities
// ==========================================================
import { getRank, getRankTiers } from "./utils/rankSystem.js";
import { safeReply } from "./utils/safeReply.js";
import { handleTrainerCardButtons } from "./commands/trainercard.js";
import { enqueueSave, shutdownFlush } from "./utils/saveQueue.js";
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
const AUTOSAVE_INTERVAL = 1000 * 60 * 3;
const POKEBEACH_CHECK_INTERVAL = 1000 * 60 * 120;
const PORT = process.env.PORT || 10000;
const MESSAGE_TP_GAIN = 2;
const MESSAGE_CC_CHANCE = 0.03;
const MESSAGE_CC_GAIN = 50;
const MESSAGE_COOLDOWN = 5000;
const MESSAGE_REWARD_CHANCE = 0.03;
const REACTION_REWARD_CHANCE = 0.03;
const REWARD_COOLDOWN = 5000;
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

async function saveTrainerDataLocal(data) {
  try {
    await enqueueSave(data);
    console.log(`💾 Local save queued (${Object.keys(data).length} users)`);
  } catch (err) {
    console.error("❌ Local save failed:", err.message);
    throw err;
  }
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
// 🎁 DETERMINISTIC RANDOM REWARD SYSTEM
// ==========================================================

/**
 * Executes a random reward for a user.
 * NOTE: This function is now *deterministic* — it does NOT contain RNG gating.
 * All probability checks (3% chance, etc.) happen in the event layer (message/reaction/daily).
 */
async function tryGiveRandomReward(userObj, interactionUser, msgOrInteraction) {
  console.log("⚙️ tryGiveRandomReward executed for", interactionUser.username);

  // Cooldown only (no RNG here)
  const now = Date.now();
  const last = rewardCooldowns.get(interactionUser.id) || 0;
  if (now - last < REWARD_COOLDOWN) return;
  rewardCooldowns.set(interactionUser.id, now);

  // Load data pools
  const allPokemon = await getAllPokemon();
  const allTrainers = await getAllTrainers();

  let reward, isShiny = false, isPokemon = false;
  try {
    if (Math.random() < 0.5) {
      // 🟢 Pokémon reward
      isPokemon = true;
      reward = selectRandomPokemonForUser(allPokemon, userObj);
      isShiny = rollForShiny(userObj.tp || 0);

      userObj.pokemon ??= {};
      userObj.pokemon[reward.id] ??= { normal: 0, shiny: 0 };
      if (isShiny) userObj.pokemon[reward.id].shiny++;
      else userObj.pokemon[reward.id].normal++;
        } else {
      // 🔵 Trainer reward
      isPokemon = false;
     
// Dynamically re-import the newest weightedRandom on each call
const { selectRandomTrainerForUser } = await import("./utils/weightedRandom.js");
reward = selectRandomTrainerForUser(allTrainers, userObj);

      userObj.trainers ??= {};

      // ✅ Use filename / spriteFile / name instead of numeric ID
      const trainerKey = reward.spriteFile || reward.filename || `${reward.id}.png`;
      if (trainerKey) {
        userObj.trainers[trainerKey] = (userObj.trainers[trainerKey] || 0) + 1;
        console.log(`🎁 Trainer reward → ${reward.name} (${reward.tier}) key=${trainerKey}`);
      } else {
        console.warn("⚠️ Trainer reward missing identifier:", reward);
      }
    }

  } catch (err) {
    console.error("❌ Reward selection failed:", err);
    return;
  }

  await saveDataToDiscord(trainerData);

    // 🖼️ Sprite URL (trainer-safe)
  let spriteUrl;
  if (isPokemon) {
    spriteUrl = isShiny
      ? `${spritePaths.shiny}${reward.id}.gif`
      : `${spritePaths.pokemon}${reward.id}.gif`;
  } else {
    const baseId = String(reward.id || "")
      .replace(/^trainers?_2\//, "")
      .replace(/\.png$/i, "")
      .trim()
      .toLowerCase();

    const cleanFile = (reward.spriteFile || reward.filename || `${baseId}.png`)
      .replace(/^trainers?_2\//, "")
      .replace(/\s+/g, "")
      .replace(/\.png\.png$/i, ".png")
      .toLowerCase();

    spriteUrl = `${spritePaths.trainers}${cleanFile}`;
  }

  const embed = isPokemon
    ? createPokemonRewardEmbed(reward, isShiny, spriteUrl)
    : createTrainerRewardEmbed(reward, spriteUrl);

  // ✅ Simplified trainer handling — no buttons
  if (!isPokemon) {
    console.log(
      `🧢 Trainer acquired: ${reward.name} (${reward.tier || "common"}) — use /changetrainer to equip a different trainer.`
    );
  }

  // Announce in channel
  try {
    const announcement = isPokemon
      ? `🎉 <@${interactionUser.id}> caught **${isShiny ? "✨ shiny " : ""}${reward.name}**!`
      : `👥 <@${interactionUser.id}> recruited **${reward.name}** to their team!`;
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
        spriteFile: !isPokemon ? (reward.filename || reward.spriteFile) : null,
      },
      shiny: isShiny,
      source: "random encounter",
    });
  } catch (err) {
    console.error("❌ broadcastReward failed:", err.message);
  }

  console.log(`✅ Reward granted to ${interactionUser.username}`);
}

// ==========================================================
// 💬 Passive TP Gain from Messages (RNG Entry Point)
// ==========================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const now = Date.now();
  if (userCooldowns.has(userId) && now - userCooldowns.get(userId) < MESSAGE_COOLDOWN) return;
  userCooldowns.set(userId, now);

  trainerData[userId] ??= {
    id: userId,
    tp: 0,
    cc: 0,
    pokemon: {},
    trainers: {},
    displayedTrainer: null,
    onboardingComplete: false,
  };
  const userObj = trainerData[userId];

  userObj.tp += MESSAGE_TP_GAIN;
  if (Math.random() < MESSAGE_CC_CHANCE) {
    userObj.cc += MESSAGE_CC_GAIN;
    await message.react("💰").catch(() => {});
  }

  try {
    const member = await message.guild.members.fetch(userId);
    await updateUserRole(member, userObj.tp, message.channel);
  } catch (err) {
    console.warn("⚠️ Rank update failed:", err.message);
  }

  // ✅ Single RNG gate (true 3% chance overall)
  if (Math.random() < MESSAGE_REWARD_CHANCE) {
    console.log(`🎲 RNG PASSED for ${message.author.username}`);
    await tryGiveRandomReward(userObj, message.author, message);
  }

  if (Math.random() < 0.1) await saveDataToDiscord(trainerData);
});

// ==========================================================
// 💖 TP Gain from Reactions (RNG Entry Point)
// ==========================================================
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot || !reaction.message.guild) return;

  const userId = user.id;
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
    onboardingComplete: false,
  };
  const userObj = trainerData[userId];

  userObj.tp += MESSAGE_TP_GAIN;
  if (Math.random() < MESSAGE_CC_CHANCE) {
    userObj.cc += MESSAGE_CC_GAIN;
    await reaction.message.react("💰").catch(() => {});
  }

  try {
    const member = await reaction.message.guild.members.fetch(userId);
    await updateUserRole(member, userObj.tp, reaction.message.channel);
  } catch (err) {
    console.warn("⚠️ Rank update failed:", err.message);
  }

  // ✅ Single RNG gate (3% total)
  if (Math.random() < REACTION_REWARD_CHANCE) {
    console.log(`🎲 RNG PASSED (reaction) for ${user.username}`);
    await tryGiveRandomReward(userObj, user, reaction.message);
  }

  if (Math.random() < 0.1) await saveDataToDiscord(trainerData);
});

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
  if (commandSaveQueue) clearTimeout(commandSaveQueue);
  commandSaveQueue = setTimeout(async () => {
    await saveDataToDiscord(trainerData);
    commandSaveQueue = null;
  }, 10_000);
}
setInterval(() => saveDataToDiscord(trainerData), AUTOSAVE_INTERVAL);

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
  user.onboardingComplete ??= false;
  user.onboardingDate ??= null;
  user.starterPokemon ??= null;
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
    onboardingComplete: false,
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
  if (Math.random() < MESSAGE_REWARD_CHANCE) {
    await tryGiveRandomReward(userObj, message.author, message);
  }

  // Periodic autosave
  if (Math.random() < 0.1) await saveDataToDiscord(trainerData);
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
    onboardingComplete: false,
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
  if (Math.random() < REACTION_REWARD_CHANCE) {
    await tryGiveRandomReward(userObj, user, reaction.message);
  }

  if (Math.random() < 0.1) await saveDataToDiscord(trainerData);
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
      debouncedDiscordSave();
    } catch (err) {
      console.error(`❌ ${interaction.commandName}:`, err.message);
      await safeReply(interaction, {
        content: `❌ Error executing \`${interaction.commandName}\`.`,
        ephemeral: true,
      });
    }
    return;
  }

  // 🧩 Button Interactions
  if (interaction.isButton()) {
    // 🧱 Ignore onboarding button IDs handled inside trainercard.js
    const internalButtons = [
      "prev_starter", "next_starter", "select_starter",
      "prev_trainer", "next_trainer", "confirm_trainer"
    ];
    if (internalButtons.includes(interaction.customId)) return;

    try {
      // 🎴 Trainer Card Buttons
      if (
        interaction.customId.startsWith("show_full_team") ||
        interaction.customId.startsWith("refresh_card") ||
        interaction.customId.startsWith("share_public") ||
        interaction.customId.startsWith("change_trainer") ||
        interaction.customId.startsWith("change_pokemon")
      ) {
        await handleTrainerCardButtons(interaction, trainerData, saveDataToDiscord);
        await saveTrainerDataLocal(trainerData);
        debouncedDiscordSave();
        return;
      }

     // 🪶 Fallback for any obsolete equip buttons (now disabled)
if (
  interaction.customId.startsWith("equip_") ||
  interaction.customId === "skip_equip"
) {
  await safeReply(interaction, {
    content: "⚙️ Trainer equipping is now handled through `/changetrainer`.",
    ephemeral: true,
  });
  return;
}

      // 🪶 Unhandled fallback
      console.warn(`⚠️ Unhandled button: ${interaction.customId}`);
    } catch (err) {
      console.error(`❌ Button error (${interaction.customId}):`, err.message);
      await safeReply(interaction, {
        content: "❌ Error processing your button.",
        ephemeral: true,
      });
    }
  }
});


// ==========================================================
// 🌐 EXPRESS SERVER
// ==========================================================
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const staticPath = path.join(process.cwd(), "public");
app.use("/public", express.static(staticPath));
app.get("/", (_, res) => res.send("Bot running"));
app.get("/healthz", (_, res) =>
  res.json({ ready: isReady, uptime: Math.floor((Date.now() - startTime) / 1000) })
);

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

    // 🧠 Smart Discord backup throttle (1× per minute max)
    const now = Date.now();
    if (now - lastTrainerSave > 60_000) {
      lastTrainerSave = now;
      await saveDataToDiscord(trainerData).catch(err =>
        console.warn("⚠️ Debounced Discord save failed:", err.message)
      );
    } else {
      console.log("💾 Skipped Discord backup (debounced save)");
    }

    console.log(`✅ ${id} equipped trainer ${file}`);

    // =======================================================
    // 🧾 Send confirmation message to invoking Discord channel
    // =======================================================
    try {
      const channelId = getChannelIdForToken(token);
      if (channelId) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
          const embed = new EmbedBuilder()
            .setTitle("🎨 Trainer Equipped!")
            .setDescription(
              `✅ You equipped **${name || file.replace(".png", "")}** as your displayed Trainer!\nUse **/trainercard** to view your new look.`
            )
            .setColor(0x00ff9d)
            .setThumbnail(`${spritePaths.trainers}${file}`)
            .setFooter({ text: "🌟 Coop’s Collection Update" })
            .setTimestamp();

          await channel.send({
            content: `<@${id}>`,
            embeds: [embed],
          });
        }
      } else {
        console.warn(`⚠️ No channel found for token: ${token}`);
      }
    } catch (notifyErr) {
      console.warn("⚠️ Failed to send trainer confirmation:", notifyErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/set-trainer failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===========================================================
// 🧩 POKÉMON PICKER API ENDPOINTS (Supports 6-Pokémon Teams)
// ===========================================================

// ✅ GET owned Pokémon
app.get("/api/user-pokemon", (req, res) => {
  const { id, token } = req.query;
  if (!validateToken(id, token)) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }

  const user = trainerData[id];
  if (!user) return res.status(404).json({ error: "User not found" });

  // Owned Pokémon = any ID with normal or shiny copies
  const owned =
    typeof user.pokemon === "object"
      ? Object.keys(user.pokemon)
      : Array.isArray(user.pokemon)
      ? user.pokemon
      : [];

  // Previously displayed team (6 max)
  const currentTeam = Array.isArray(user.displayedPokemon)
    ? user.displayedPokemon
    : user.displayedPokemon
    ? [user.displayedPokemon]
    : [];

  res.json({ owned, currentTeam });
});

// ===========================================================
// ✅ POST — set full Pokémon team (up to 6) — Debounced Discord Save
// ===========================================================
let lastTeamSave = 0; // global throttle timestamp

app.post("/api/set-pokemon-team", express.json(), async (req, res) => {
  try {
    const { id, token, team } = req.body;
    if (!id || !token || !Array.isArray(team)) {
      console.warn("⚠️ Missing or invalid fields in /api/set-pokemon-team", req.body);
      return res.status(400).json({ success: false, error: "Missing id, token, or team array" });
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

    // ✅ Cap team length at 6
    if (team.length === 0 || team.length > 6) {
      return res.status(400).json({ success: false, error: "Team must be 1–6 Pokémon" });
    }

    // ===========================================================
    // 🧠 Schema Update — maintain both team + lead
    // ===========================================================
    user.team = team.map(String);
    user.displayedPokemon = team[0]; // first Pokémon is lead
    trainerData[id] = user;

    await saveTrainerDataLocal(trainerData);

    // 🧠 Smart Discord backup throttle (1× per minute max)
    const now = Date.now();
    if (now - lastTeamSave > 60_000) {
      lastTeamSave = now;
      await saveDataToDiscord(trainerData).catch(err =>
        console.warn("⚠️ Debounced Discord save failed:", err.message)
      );
    } else {
      console.log("💾 Skipped Discord backup (debounced save)");
    }

    console.log(`✅ ${id} saved team [${team.join(", ")}]`);

    // ===========================================================
    // 🧩 Readable embed (use Pokémon names from pokemonData.json)
    // ===========================================================
    try {
      const allPokemon = JSON.parse(
        fsSync.readFileSync("./public/pokemonData.json", "utf8")
      );
      const leadId = team[0];
      const leadInfo = allPokemon[leadId];
      const leadName = leadInfo?.name || `#${leadId}`;

      const channelId = getChannelIdForToken(token);
      if (channelId) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
          const embed = new EmbedBuilder()
            .setTitle("🐾 Pokémon Team Updated!")
            .setDescription(
              `✅ You set your Pokémon team!\n**${leadName}** is now your lead Pokémon.\nUse **/trainercard** to view your updated card.`
            )
            .setColor(0xffcb05)
            .setThumbnail(`${spritePaths.pokemon}${leadId}.gif`)
            .setFooter({ text: "🌟 Coop’s Collection Update" })
            .setTimestamp();

          await channel.send({
            content: `<@${id}>`,
            embeds: [embed],
          });
        }
      }
    } catch (notifyErr) {
      console.warn("⚠️ Failed to send team confirmation:", notifyErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/set-pokemon-team failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`✅ Listening on port ${PORT}`));

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
// 🚀 LAUNCH
// ==========================================================
client.login(process.env.BOT_TOKEN);
