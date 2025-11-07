import fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import express from "express";
import fetch from "node-fetch";
import { decode } from "html-entities";
import { Client, GatewayIntentBits, Collection, AttachmentBuilder, PermissionsBitField } from "discord.js";
import { REST, Routes } from "discord.js";
import dotenv from "dotenv";
dotenv.config();
import { getRank, getRankTiers } from "./utils/rankSystem.js";
import { safeReply } from "./utils/safeReply.js";
import { handleTrainerCardButtons } from "./commands/trainercard.js";
import { enqueueSave, shutdownFlush } from "./utils/saveQueue.js";
import { reloadUserFromDiscord, ensureUserInitialized } from "./utils/userInitializer.js";

const TRAINERDATA_PATH = "./trainerData.json";
const AUTOSAVE_INTERVAL = 1000 * 60 * 3; // 3 minutes
const POKEBEACH_CHECK_INTERVAL = 1000 * 60 * 60 * 6; // 6 hours
const PORT = process.env.PORT || 10000;
let discordSaveCount = 0;
let commandSaveQueue = null;
let isReady = false;
let isSaving = false; // 🛡️ Global save lock to prevent race conditions
const startTime = Date.now();

const RANK_TIERS = getRankTiers();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]
});
client.commands = new Collection();

async function loadTrainerData() {
  console.log("📦 Loading from Discord...");
  let loaded = {};
  try {
    const storageChannel = await client.channels.fetch(process.env.STORAGE_CHANNEL_ID);
    const messages = await storageChannel.messages.fetch({ limit: 50 });
    const backups = messages.filter(m => m.attachments.size > 0 && m.attachments.first().name.startsWith("trainerData"))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    if (backups.size > 0) {
      const res = await fetch(backups.first().attachments.first().url);
      loaded = JSON.parse(await res.text());
      console.log(`✅ Loaded ${Object.keys(loaded).length} users`);
    }
  } catch (err) {
    console.error("❌ Discord load failed:", err.message);
  }
  for (const [id, user] of Object.entries(loaded)) {
    normalizeUserSchema(id, user);
  }
  return loaded;
}

async function saveTrainerDataLocal(data) {
  // Use the save queue for atomic writes
  try {
    await enqueueSave(data);
    console.log(`💾 Local save queued: ${Object.keys(data).length} users`);
  } catch (err) {
    console.error("❌ Local save failed:", err.message);
    throw err; // Re-throw so atomicSave can handle it
  }
}

async function saveDataToDiscord(data) {
  // 🛡️ Prevent concurrent saves - use global lock
  if (isSaving) {
    console.log("⏳ Save already in progress, queuing...");
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!isSaving) {
          clearInterval(checkInterval);
          resolve(saveDataToDiscord(data));
        }
      }, 100);
    });
  }

  isSaving = true;
  try {
    const storageChannel = await client.channels.fetch(process.env.STORAGE_CHANNEL_ID);
    const buffer = Buffer.from(JSON.stringify(data, null, 2));
    const file = new AttachmentBuilder(buffer, { name: `trainerData-${new Date().toISOString()}.json` });
    await storageChannel.send({ content: `📦 #${++discordSaveCount}`, files: [file] });
    console.log(`✅ Discord #${discordSaveCount}`);
  } catch (err) {
    console.error("❌ Discord save failed:", err.message);
  } finally {
    isSaving = false;
  }
}

async function updateUserRole(member, tp) {
  const targetRole = getRank(tp);
  if (!targetRole) return;
  const role = member.guild.roles.cache.find(r => r.name === targetRole);
  if (!role || member.roles.cache.has(role.id)) return;
  for (const t of RANK_TIERS) {
    const oldRole = member.guild.roles.cache.find(r => r.name === t.roleName);
    if (oldRole && member.roles.cache.has(oldRole.id)) await member.roles.remove(oldRole).catch(() => {});
  }
  await member.roles.add(role).catch(() => {});
}

// ===========================================================
// 📩 MESSAGE HANDLER – Passive XP/TP system + Link Replacements
// ===========================================================

const MESSAGE_TP_GAIN = 2;            // Base TP gained per message
const MESSAGE_CC_CHANCE = 0.005;      // % chance to gain CC
const MESSAGE_COOLDOWN = 10 * 1000;   // Cooldown per user

const userCooldowns = new Map();      // Track per-user message cooldowns

client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.guild) return;

  const id = msg.author.id;
  const now = Date.now();

  // 🔗 Auto-replace or block shortened affiliate links
  if (/https?:\/\/(amzn\.to|www\.ebay\.com\/itm)/i.test(msg.content)) {
    await msg.delete().catch(() => {});
    await msg.channel.send(
      `🔗 ${msg.content
        .replace(/amzn\.to/gi, "amazon.com")
        .replace(/ebay\.com\/itm/gi, "ebay.com/itm")}`
    );
    return;
  }

  // ⏱️ TP cooldown
  const lastMessageTime = userCooldowns.get(id) || 0;
  if (now - lastMessageTime < MESSAGE_COOLDOWN) return;
  userCooldowns.set(id, now);

  // 🧩 Ensure user data exists
  const user = (trainerData[id] = normalizeUserSchema(id, trainerData[id] || {}));

  // 🏆 Grant TP
  user.tp = (user.tp || 0) + MESSAGE_TP_GAIN;

  // 💰 Random CC reward
  if (Math.random() < MESSAGE_CC_CHANCE) {
    user.cc = (user.cc || 0) + 100;
    console.log(`💰 ${msg.author.username} found 100 Coop Coins!`);
  }

  // 🎖️ Update rank role
  try {
    const member = await msg.guild.members.fetch(id);
    await updateUserRole(member, user.tp);
  } catch (err) {
    console.warn(`⚠️ Role update failed for ${msg.author.username}: ${err.message}`);
  }

  // 💾 Debounced autosave
  debouncedDiscordSave();
});

// ===========================================================
// 📂 COMMAND LOADER
// ===========================================================

async function loadCommands() {
  const commandsPath = path.resolve("./commands");
  const files = (await fs.readdir(commandsPath)).filter(f => f.endsWith(".js"));
  
  for (const file of files) {
    try {
      const imported = await import(`./commands/${file}`);
      const command = imported.default || imported;
      if (!command?.data?.name) {
        console.warn(`⚠️ ${file}: No valid command data found`);
        continue;
      }
      client.commands.set(command.data.name, command);
      console.log(`✅ Loaded: ${command.data.name}`);
    } catch (err) {
      console.error(`❌ ${file}:`, err.message);
    }
  }

  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
  const commandsJSON = client.commands.map(c => c.data.toJSON());
  console.log(`📡 Registering ${commandsJSON.length} commands...`);

  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commandsJSON }
    );
    console.log(`✅ Successfully registered ${commandsJSON.length} commands`);
  } catch (err) {
    console.error("❌ Failed to register commands:", err.message);
  }
}

// ===========================================================
// 💾 SAVE DEBOUNCING
// ===========================================================

function debouncedDiscordSave() {
  if (commandSaveQueue) clearTimeout(commandSaveQueue);
  commandSaveQueue = setTimeout(async () => {
    await saveDataToDiscord(trainerData);
    commandSaveQueue = null;
  }, 10000);
}

setInterval(() => saveDataToDiscord(trainerData), AUTOSAVE_INTERVAL);

// ===========================================================
// 🛑 GRACEFUL SHUTDOWN
// ===========================================================

async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
  
  // Mark as not ready to stop accepting new commands
  isReady = false;
  
  try {
    // Flush any pending saves with 10s timeout
    console.log("💾 Flushing pending saves...");
    const flushed = await shutdownFlush(10000);
    
    if (!flushed) {
      console.warn("⚠️ Some saves may not have completed");
    }
    
    // Final Discord save
    console.log("☁️ Final Discord backup...");
    await saveDataToDiscord(trainerData);
    
    console.log("✅ Shutdown complete");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error during shutdown:", err.message);
    process.exit(1);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ===========================================================
// 🏖️ IMPROVED POKEBEACH NEWS SCRAPER (v2)
// Checks Discord message history to prevent duplicates on restart
// ===========================================================

async function checkPokeBeach() {
  try {
    const newsChannel = await client.channels.fetch(process.env.NEWS_CHANNEL_ID);
    if (!newsChannel) return console.error("❌ NEWS_CHANNEL_ID invalid or not found.");

    console.log("📰 Checking PokéBeach for new articles...");

    // 1️⃣ Fetch PokéBeach homepage
    const res = await fetch("https://www.pokebeach.com/", {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!res.ok) {
      console.error(`❌ Failed to fetch PokéBeach: HTTP ${res.status}`);
      return;
    }

    const html = await res.text();
    console.log(`   📊 Fetched ${html.length} characters`);

    // 2️⃣ Extract article URLs + titles using REGEX (targets H2/H3 headlines, not comments)
    const articles = [];
    
    // THIS REGEX IS KEY: Only matches links inside H2/H3 tags (where article titles are)
    // Comment links won't match because they're not in H2/H3 tags
    const pattern = /<h[23][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>[\s\S]*?<\/h[23]>/gi;
    const matches = html.matchAll(pattern);

    for (const match of matches) {
      const link = match[1];
      const titleHTML = match[2] || link.split('/').pop();
      const title = titleHTML.replace(/<[^>]*>/g, '').trim();

      // Filter out non-articles
     if (link && title && 
          link.includes('/20') &&
          title.length > 10 &&
          !link.includes('#') &&
          !link.includes('comment')) { // ← KEEP ONLY THESE

        // Decode HTML entities in title
        const decodedTitle = decode(title);

        articles.push({
          link: link.startsWith('http') ? link : `https://www.pokebeach.com${link}`,
          title: decodedTitle,
          image: null // Will be populated next
        });
      }
    }

    console.log(`   ✅ Found ${articles.length} articles`);

    if (articles.length === 0) {
      console.log("   ⚠️ No articles extracted");
      return;
    }

    // 3️⃣ Extract images for articles (with better filtering)
    console.log("   🖼️ Extracting article images...");
    
    for (const article of articles.slice(0, 10)) {
      // Find the article link in HTML and get surrounding context
      const linkIndex = html.indexOf(article.link);
      if (linkIndex === -1) continue;

      // Get 3000 chars around the article link
      const contextBefore = html.substring(Math.max(0, linkIndex - 1500), linkIndex);
      const contextAfter = html.substring(linkIndex, Math.min(html.length, linkIndex + 1500));
      const articleContext = contextBefore + contextAfter;

      // Look for images in the article context
      const imgPattern = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
      const imgMatches = [...articleContext.matchAll(imgPattern)];

      if (imgMatches.length > 0) {
        // Find the best image (first one that's not a logo/icon)
        for (const imgMatch of imgMatches) {
          const imgUrl = imgMatch[1];

          // Filter out: icons, logos, avatars, sprites, emojis, small images
          if (imgUrl && 
              !imgUrl.includes('icon') && 
              !imgUrl.includes('logo') &&
              !imgUrl.includes('avatar') &&
              !imgUrl.includes('sprite') &&
              !imgUrl.includes('emoji') &&
              !imgUrl.includes('smilie') &&
              !imgUrl.includes('favicon') &&
              (imgUrl.includes('.jpg') || imgUrl.includes('.png') || 
               imgUrl.includes('.webp') || imgUrl.includes('.jpeg'))) {
            
            article.image = imgUrl.startsWith('http') ? imgUrl : `https://www.pokebeach.com${imgUrl}`;
            break;
          }
        }
      }
    }

    const articlesWithImages = articles.filter(a => a.image).length;
    console.log(`   🖼️ Found images for ${articlesWithImages}/${articles.length} articles`);

    // 4️⃣ CHECK DISCORD MESSAGE HISTORY - This survives bot restarts!
    console.log("   📜 Checking Discord history for already-posted articles...");
    
    const recentMessages = await newsChannel.messages.fetch({ limit: 50 });
    const postedLinks = new Set();
    
    for (const msg of recentMessages.values()) {
      // Extract URLs from embed URLs
      if (msg.embeds.length > 0) {
        for (const embed of msg.embeds) {
          if (embed.url) {
            postedLinks.add(embed.url);
          }
        }
      }
      // Also check message content for PokeBeach links
      const linkMatches = msg.content.match(/https:\/\/www\.pokebeach\.com\/\d{4}\/[^\s]+/g) || [];
      linkMatches.forEach(link => postedLinks.add(link));
    }

    console.log(`   📋 Found ${postedLinks.size} already-posted links in Discord`);

    // 5️⃣ Filter out already-posted articles
    const newArticles = articles.filter(article => !postedLinks.has(article.link));

    if (newArticles.length === 0) {
      console.log("   ✅ No new articles (all already posted)");
      return;
    }

    console.log(`   📢 Found ${newArticles.length} new article(s)!`);

    // 6️⃣ Post the 3 most recent articles
    const articlesToPsot = newArticles.slice(0, 3);
    
    console.log(`   📢 Posting ${articlesToPsot.length} article(s)`);

    for (const article of articlesToPsot) {
      await newsChannel.send(article.link);
      
      console.log(`   ✅ Posted: ${article.title.substring(0, 60)}...`);
      
      // Small delay between posts
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (err) {
    console.error("❌ PokéBeach scrape failed:", err.message);
  }
}

setInterval(checkPokeBeach, POKEBEACH_CHECK_INTERVAL);

// ===========================================================
// 🔧 SCHEMA NORMALIZATION
// ===========================================================

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

// ===========================================================
// ⚡ INTERACTION HANDLER – Slash Commands + Buttons
// ===========================================================

client.on("interactionCreate", async (interaction) => {
  // Handle Slash Commands
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      return await safeReply(interaction, { content: "❌ Unknown command.", ephemeral: true });
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
    } catch (error) {
      console.error(`❌ ${interaction.commandName}:`, error.message);
      await safeReply(interaction, {
        content: `❌ Error while executing \`${interaction.commandName}\`. Please try again.`,
        ephemeral: true,
      });
    }
    return;
  }

  // Handle Button Interactions
  if (interaction.isButton()) {
    try {
      // Route trainercard buttons to the handler
      if (interaction.customId.startsWith("show_full_team") ||
          interaction.customId.startsWith("refresh_card") || 
          interaction.customId.startsWith("share_public") ||
          interaction.customId.startsWith("change_trainer") ||
          interaction.customId.startsWith("change_pokemon")) {
        await handleTrainerCardButtons(interaction, trainerData, saveDataToDiscord);
        await saveTrainerDataLocal(trainerData);
        debouncedDiscordSave();
        return;
      }

      console.warn(`⚠️ Unhandled button: ${interaction.customId}`);
    } catch (error) {
      console.error(`❌ Button interaction error (${interaction.customId}):`, error.message);
      await safeReply(interaction, {
        content: "❌ An error occurred processing your button. Please try again.",
        ephemeral: true,
      });
    }
  }
});

// ===========================================================
// 🌐 EXPRESS SERVER
// ===========================================================

import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const staticPath = path.join(process.cwd(), "public");
app.use("/public", express.static(staticPath));
app.get("/", (_, res) => res.send("Bot running"));
app.get("/healthz", (_, res) => {
  res.json({
    ready: isReady,
    uptime: Math.floor((Date.now() - startTime) / 1000)
  });
});
app.listen(PORT, () => console.log(`✅ Port ${PORT}`));

// ===========================================================
// 🤖 BOT READY
// ===========================================================

let trainerData = {};

client.once("ready", async () => {
  console.log(`✅ ${client.user.tag}`);
  
  try {
    trainerData = await loadTrainerData();
  } catch (err) {
    console.error("❌ Failed to load trainer data:", err.message);
    trainerData = {};
  }
  
  try {
    await loadCommands();
  } catch (err) {
    console.error("❌ Failed to load commands:", err.message);
  }
  
  // Initial PokéBeach check
  try {
    checkPokeBeach();
  } catch (err) {
    console.error("❌ Failed initial PokéBeach check:", err.message);
  }
  
  try {
    await saveDataToDiscord(trainerData);
  } catch (err) {
    console.error("❌ Failed initial Discord save:", err.message);
  }
  
  // Mark as ready
  isReady = true;
  console.log("✅ Bot ready and accepting commands");
});

client.login(process.env.BOT_TOKEN);