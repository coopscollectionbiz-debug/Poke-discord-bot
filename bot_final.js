// ==========================================================
// 🤖 Coop's Collection Discord Bot — FINAL VERSION
// Fully commented, Node 22 compatible, and production ready
// ==========================================================

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

// ==========================================================
// 🌐 Basic Setup
// ==========================================================
const TRAINERDATA_PATH = "./trainerData.json";   // Local cache location
const AUTOSAVE_INTERVAL = 1000 * 60 * 30;        // Autosave every 30 minutes
const PORT = process.env.PORT || 10000;          // Render keep-alive port

// ==========================================================
// 🏅 TP Rank Ladder 
// ==========================================================
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

// Load trainer data from Discord storage channel and local file
async function loadTrainerData() {
  const storageChannel = await client.channels.fetch(process.env.STORAGE_CHANNEL_ID);
  const messages = await storageChannel.messages.fetch({ limit: 10 });
  const latest = messages.find(m => m.attachments.size > 0 && m.attachments.first().name === "trainerData.json");

  let loaded = {};
  if (latest) {
    const url = latest.attachments.first().url;
    const res = await fetch(url);
    loaded = await res.json();
    console.log(`✅ Found trainerData.json (${Object.keys(loaded).length} users) in storage channel.`);
  }

  try {
    const local = JSON.parse(await fs.readFile(TRAINERDATA_PATH, "utf8"));
    Object.assign(loaded, local);
  } catch {}

  // Normalize schema for all users
  for (const [id, u] of Object.entries(loaded)) {
    u.tp ??= 0;
    u.cc ??= 0;
    u.pokemon ??= {};
    u.trainers ??= {};
    u.trainer ??= null;
    u.displayedPokemon ??= [];
  }

  console.log(`✅ Trainer data loaded safely with merged schema (${Object.keys(loaded).length} users).`);
  return loaded;
}

// Save to local file
async function saveTrainerDataLocal(data) {
  await fs.writeFile(TRAINERDATA_PATH, JSON.stringify(data, null, 2));
}

// Save backup to Discord channel
async function saveDataToDiscord(data) {
  try {
    const storageChannel = await client.channels.fetch(process.env.STORAGE_CHANNEL_ID);
    const fileName = `trainerData-${new Date().toISOString().split("T")[0]}.json`;
    const buffer = Buffer.from(JSON.stringify(data, null, 2));
    const file = new AttachmentBuilder(buffer, { name: fileName });
    await storageChannel.send({ content: `📦 Backup ${fileName}`, files: [file] });
    console.log("✅ Trainer data backed up to Discord.");
  } catch (err) {
    console.error("❌ Error saving data to Discord:", err);
  }
}

// ==========================================================
// 🧮 Rank System
// ==========================================================

// Get the correct role name for a given TP total
function getRank(tp) {
  let current = null;
  for (const tier of RANK_TIERS) {
    if (tp >= tier.tp) current = tier.roleName;
  }
  return current;
}

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
// 🧠 Message Handler (TP gain)
// ==========================================================
client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;

  const id = msg.author.id;
  trainerData[id] ??= {
    tp: 0,
    cc: 0,
    pokemon: {},
    trainers: {},
    trainer: null,
    displayedPokemon: []
  };

  trainerData[id].tp += 1; // +1 TP per message

  try {
    const member = await msg.guild.members.fetch(id);
    await updateUserRole(member, trainerData[id].tp);
  } catch {}
});

// ==========================================================
// 🧩 Command Loader and Handler
// ==========================================================
async function loadCommands() {
  const commandsPath = path.resolve("./commands");
  const files = (await fs.readdir(commandsPath)).filter(f => f.endsWith(".js"));

  for (const file of files) {
    const command = (await import(`./commands/${file}`)).default;
    client.commands.set(command.data.name, command);
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
    await command.execute(interaction, trainerData, () => saveDataToDiscord(trainerData));
  } catch (err) {
    console.error("❌ Command error:", err);
    if (!interaction.replied)
      await interaction.reply({ content: "❌ There was an error executing that command.", flags: 64 });
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

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  trainerData = await loadTrainerData();
  await loadCommands();
  checkPokeBeach();
});

// ==========================================================
// 🌐 Express Keep-Alive (Render requirement)
// ==========================================================
const app = express();
app.get("/", (_, res) => res.send("Bot is running!"));
app.listen(PORT, () => console.log(`✅ Listening on port ${PORT}`));

// ==========================================================
// 🔐 Login
// ==========================================================
client.login(process.env.BOT_TOKEN);
