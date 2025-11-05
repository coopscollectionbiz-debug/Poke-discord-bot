import fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import express from "express";
import fetch from "node-fetch";
import { Client, GatewayIntentBits, Collection, AttachmentBuilder, PermissionsBitField } from "discord.js";
import { REST, Routes } from "discord.js";
import dotenv from "dotenv";
dotenv.config();
import { getRank, getRankTiers } from "./utils/rankSystem.js";
import { safeReply } from "./utils/safeReply.js";

const TRAINERDATA_PATH = "./trainerData.json";
const AUTOSAVE_INTERVAL = 1000 * 60 * 3;
const PORT = process.env.PORT || 10000;
let discordSaveCount = 0;
let commandSaveQueue = null;

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
  try {
    await fs.writeFile(TRAINERDATA_PATH, JSON.stringify(data, null, 2));
    console.log(`💾 Local: ${Object.keys(data).length} users`);
  } catch (err) {
    console.error("❌ Local save failed:", err.message);
  }
}

async function saveDataToDiscord(data) {
  try {
    const storageChannel = await client.channels.fetch(process.env.STORAGE_CHANNEL_ID);
    const buffer = Buffer.from(JSON.stringify(data, null, 2));
    const file = new AttachmentBuilder(buffer, { name: `trainerData-${new Date().toISOString()}.json` });
    await storageChannel.send({ content: `📦 #${++discordSaveCount}`, files: [file] });
    console.log(`✅ Discord #${discordSaveCount}`);
  } catch (err) {
    console.error("❌ Discord save failed:", err.message);
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
// 📩 MESSAGE HANDLER — Passive XP/TP system
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

  // 🕒 TP cooldown
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

async function loadCommands() {
  const commandsPath = path.resolve("./commands");
  const files = (await fs.readdir(commandsPath)).filter(f => f.endsWith(".js"));
  for (const file of files) {
  try {
    const imported = await import(`./commands/${file}`);
    const command = imported.default || imported;
    if (!command?.data?.name) continue;
    client.commands.set(command.data.name, command);
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

function debouncedDiscordSave() {
  if (commandSaveQueue) clearTimeout(commandSaveQueue);
  commandSaveQueue = setTimeout(async () => {
    await saveDataToDiscord(trainerData);
    commandSaveQueue = null;
  }, 10000);
}

setInterval(() => saveDataToDiscord(trainerData), AUTOSAVE_INTERVAL);
process.on("SIGINT", async () => { await saveDataToDiscord(trainerData); process.exit(0); });
process.on("SIGTERM", async () => { await saveDataToDiscord(trainerData); process.exit(0); });

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
        await newsChannel.send(`📰 ${url}`);
        await fs.writeFile("./lastArticle.txt", url);
      }
    }
  } catch {}
}
setInterval(checkPokeBeach, 1000 * 60 * 60 * 6);

client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (/https?:\/\/(amzn\.to|www\.ebay\.com\/itm)/i.test(msg.content)) {
    await msg.delete().catch(() => {});
    await msg.channel.send(`🔗 ${msg.content.replace(/amzn\.to/gi, "amazon.com").replace(/ebay\.com\/itm/gi, "ebay.com/itm")}`);
  }
});

let trainerData = {};
client.once("ready", async () => {
  console.log(`✅ ${client.user.tag}`);
  trainerData = await loadTrainerData();
  await loadCommands();
  checkPokeBeach();
  await saveDataToDiscord(trainerData);
});

import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const staticPath = path.join(process.cwd(), "public");
app.use("/public", express.static(staticPath));
app.get("/", (_, res) => res.send("Bot running"));
app.listen(PORT, () => console.log(`✅ Port ${PORT}`));
client.login(process.env.BOT_TOKEN);
// Enhanced schema normalization with onboarding tracking

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

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    return await safeReply(interaction, { content: "❌ Unknown command.", ephemeral: true });
  }

  try {
    await command.execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord);
    await saveTrainerDataLocal(trainerData);
    debouncedDiscordSave();
  } catch (error) {
    console.error(`❌ ${interaction.commandName}:`, error.message);
    await safeReply(interaction, {
      content: `❌ Error while executing \`${interaction.commandName}\`. Please try again.`,
      ephemeral: true,
    });
  }
});