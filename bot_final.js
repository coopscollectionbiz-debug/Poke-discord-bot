// ==========================================================
// 🤖 Coop's Collection Discord Bot — FINAL VERSION
// Fully commented, Node 22 compatible, and production ready
// ==========================================================

import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from "fs/promises";
import path from "path";
import express from "express";
import fetch from "node-fetch";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Collection,
  AttachmentBuilder,
  PermissionsBitField
} from "discord.js";
import { REST, Routes } from "discord.js";
import dotenv from "dotenv";
dotenv.config();
import { handleTrainerCardButtons } from "./commands/trainercard.js";
import { normalizeAllUsers, ensureUserData } from "./utils/trainerDataHelper.js";
import { retryWithBackoff } from "./utils/errorHandler.js";
import { getRank, getRankTiers } from "./utils/rankSystem.js";

// ==========================================================
// 🌐 Basic Setup
// ==========================================================
const TRAINERDATA_PATH = "./trainerData.json";   // Local cache location
const AUTOSAVE_INTERVAL = 1000 * 60 * 30;        // Autosave every 30 minutes
const PORT = process.env.PORT || 10000;          // Render keep-alive port


// 🏅 TP Rank Ladder (exported from rankSystem for reuse)
// ==========================================================
const RANK_TIERS = getRankTiers();

// ==========================================================
// ⚙️ Discord Client Setup
// ==========================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});
client.commands = new Collection();

// ==========================================================
// 💾 Trainer Data Management (load / save / backup)
// ==========================================================

async function loadTrainerData() {
  console.log("📦 Loading trainer data...");

  return await retryWithBackoff(
    async () => {
      let loaded = {};

      try {
        // Attempt to load from Discord storage channel first
        const storageChannel = await client.channels.fetch(process.env.STORAGE_CHANNEL_ID);
        const messages = await storageChannel.messages.fetch({ limit: 10 });
        const latest = messages.find(
          (m) => m.attachments.size > 0 && m.attachments.first().name.startsWith("trainerData")
        );

        if (latest) {
          const url = latest.attachments.first().url;
          const res = await fetch(url);
          const jsonText = await res.text();
          loaded = JSON.parse(jsonText);
          console.log(`✅ Found trainerData.json (${Object.keys(loaded).length} users) in storage channel.`);
        } else {
          console.warn("⚠️ No trainerData found in storage channel, using local cache if available.");
        }
      } catch (err) {
        console.error("❌ Failed to fetch from Discord storage channel:", err.message);
      }

      // Try merging any local file data as a backup
      try {
        const localRaw = await fs.readFile(TRAINERDATA_PATH, "utf8");
        const local = JSON.parse(localRaw);
        Object.assign(loaded, local);
        console.log(`📂 Merged local trainerData cache (${Object.keys(local).length} users).`);
      } catch {
        console.warn("⚠️ No local trainerData.json found or parse error — starting fresh.");
      }

      // Normalize schema fields for all users using helper
      const normalized = normalizeAllUsers(loaded);

      console.log(`✅ Trainer data loaded safely with merged schema (${Object.keys(normalized).length} users).`);
      return normalized;
    },
    3,
    1000,
    "loadTrainerData"
  );
}


// Save to local file with retry logic
async function saveTrainerDataLocal(data) {
  return await retryWithBackoff(
    async () => {
      await fs.writeFile(TRAINERDATA_PATH, JSON.stringify(data, null, 2));
      console.log("✅ Trainer data saved locally.");
    },
    3,
    500,
    "saveTrainerDataLocal"
  );
}

// Save backup to Discord channel with retry logic
async function saveDataToDiscord(data) {
  return await retryWithBackoff(
    async () => {
      const storageChannel = await client.channels.fetch(process.env.STORAGE_CHANNEL_ID);
      const fileName = `trainerData-${new Date().toISOString().split("T")[0]}.json`;
      const buffer = Buffer.from(JSON.stringify(data, null, 2));
      const file = new AttachmentBuilder(buffer, { name: fileName });
      await storageChannel.send({ content: `📦 Backup ${fileName}`, files: [file] });
      console.log("✅ Trainer data backed up to Discord.");
    },
    2,
    2000,
    "saveDataToDiscord"
  ).catch((err) => {
    console.error("❌ Error saving data to Discord after retries:", err);
  });
}

// ==========================================================
// 🧮 Rank System (using centralized helper)
// ==========================================================

// Get the correct role name for a given TP total (from rankSystem helper)
// Already imported at the top

// Assign the correct rank to a Discord member (idempotent)
async function updateUserRole(member, tp) {
  const targetRole = getRank(tp);
  if (!targetRole) return;
  const role = member.guild.roles.cache.find(r => r.name === targetRole);
  if (!role) return;

  // Skip if user already has this role
  if (member.roles.cache.has(role.id)) return;

  // Remove old rank roles
  for (const t of RANK_TIERS) {
    const oldRole = member.guild.roles.cache.find(r => r.name === t.roleName);
    if (oldRole && member.roles.cache.has(oldRole.id)) {
      await member.roles.remove(oldRole).catch(() => {});
    }
  }

  // Add new rank role
  await member.roles.add(role).catch(() => {});
  console.log(`🏅 ${member.user.username} promoted to ${targetRole}`);
}

// ==========================================================
// 🧠 Message Handler (TP gain) - Using helper for user data
// ==========================================================
client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;

  const id = msg.author.id;
  
  // Use helper to ensure user data exists
  ensureUserData(trainerData, id, msg.author.username);
  
  trainerData[id].tp += 1; // +1 TP per message

  try {
    const member = await msg.guild.members.fetch(id);
    await updateUserRole(member, trainerData[id].tp);
  } catch {}
});

// ==========================================================
// 🧩 Command Loader (Fixed for default exports + Logging)
// ==========================================================
async function loadCommands() {
  const commandsPath = path.resolve("./commands");
  const files = (await fs.readdir(commandsPath)).filter(f => f.endsWith(".js"));

  for (const file of files) {
    try {
      const imported = await import(`./commands/${file}`);
      const command = imported.default || imported; // ✅ Support default exports

      console.log("🧩 Checking", file, "->", command?.data?.name || "(missing data)");

      if (!command?.data?.name) {
        console.warn(`⚠️ Skipping ${file}: missing data.name`);
        continue;
      }

      client.commands.set(command.data.name, command);
    } catch (err) {
      console.error(`❌ Failed to load ${file}:`, err);
    }
  }

  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: client.commands.map(c => c.data.toJSON())
  });

  console.log(`✅ Registered ${client.commands.size} slash commands.`);
}


// Handle interactions (slash commands)
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
  await command.execute(interaction, trainerData, saveTrainerDataLocal)
} catch (error) {
  console.error(`❌ Command error:`, error);

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({
      content: "❌ An unexpected error occurred.",
      ephemeral: true
    }).catch(() => {});
  } else {
    await interaction.reply({
      content: "❌ An unexpected error occurred.",
      ephemeral: true
    }).catch(() => {});
  }
}
});

// ==========================================================
// 💾 Autosave + Shutdown Backup
// ==========================================================
async function autosave() {
  await saveTrainerDataLocal(trainerData);
  await saveDataToDiscord(trainerData);
}
setInterval(autosave, AUTOSAVE_INTERVAL);

process.on("SIGINT", async () => { console.log("💾 SIGINT → saving..."); await autosave(); process.exit(0); });
process.on("SIGTERM", async () => { console.log("💾 SIGTERM → saving..."); await autosave(); process.exit(0); });

// ==========================================================
// 📰 PokéBeach News Fetcher
// ==========================================================
async function checkPokeBeach() {
  try {
    const newsChannel = await client.channels.fetch(process.env.NEWS_CHANNEL_ID);
    const res = await fetch("https://www.pokebeach.com/");
    const html = await res.text();
    const match = html.match(/<a href="(https:\/\/www\.pokebeach\.com\/\d{4}\/[^"]+)"/);
    if (match) {
      const url = match[1];
      const last = await fs.readFile("./lastArticle.txt", "utf8").catch(() => "");
      if (last !== url) {
        await newsChannel.send(`📰 New PokéBeach Article:\n${url}`);
        await fs.writeFile("./lastArticle.txt", url);
      }
    }
  } catch (e) {
    console.error("⚠️ PokéBeach fetch failed:", e.message);
  }
}
setInterval(checkPokeBeach, 1000 * 60 * 60 * 6);

// ==========================================================
// 🔗 Affiliate Link Cleaner
// ==========================================================
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  const content = msg.content;
  if (/https?:\/\/(amzn\.to|www\.ebay\.com\/itm)/i.test(content)) {
    await msg.delete().catch(() => {});
    const cleaned = content
      .replace(/amzn\.to/gi, "amazon.com")
      .replace(/ebay\.com\/itm/gi, "ebay.com/itm");
    await msg.channel.send(`🔗 Affiliate-safe link:\n${cleaned}`);
  }
});

// ==========================================================
// 🚀 Startup Sequence
// ==========================================================
let trainerData = {};

  client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  trainerData = await loadTrainerData();
  await loadCommands();
  checkPokeBeach();
});

// ==========================================================
// 🌐 Express Keep-Alive + Static File Hosting
// ==========================================================
import { fileURLToPath } from "url";
import * as fsSync from "fs"; // ✅ Proper synchronous import for existsSync

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Create express app
const app = express();

// ✅ Serve static files from /public (Render safe)
const staticPath = path.join(process.cwd(), "public");
app.use("/public", express.static(staticPath));

console.log("📁 Serving static from:", staticPath);
console.log(
  "🔍 Test sprite exists:",
  fsSync.existsSync(path.join(staticPath, "sprites/pokemon/normal/1.gif"))
);

// ✅ Basic endpoint (Render health check)
app.get("/", (_, res) => res.send("Bot is running and serving static files!"));

// ✅ Start the Express server
app.listen(PORT, () => {
  console.log(`✅ Listening on port ${PORT}`);
});


// ==========================================================
// 🔐 Login
// ==========================================================
client.login(process.env.BOT_TOKEN);
