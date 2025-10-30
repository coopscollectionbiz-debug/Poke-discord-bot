// ==========================================================
// 🤖 Coop's Collection Discord Bot — Final Version
// Fully commented, Node 22 ESM-compatible
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
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
dotenv.config();

// ==========================================================
// 🧩 Constants and globals
// ==========================================================
const TRAINERDATA_PATH = "./trainerData.json";     // local cache
const AUTOSAVE_INTERVAL = 1000 * 60 * 30;          // 30 min
const PORT = process.env.PORT || 10000;            // Render keep-alive
const RANK_ROLES = {
  0: "Beginner",
  1000: "Collector",
  5000: "Elite",
  10000: "Master",
  25000: "Legend"
};

// Discord client setup
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
// 💾 TRAINER DATA — Load / Save / Backup
// ==========================================================

// Load trainer data from Discord storage channel if available
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

  // local fallback
  try {
    const local = JSON.parse(await fs.readFile(TRAINERDATA_PATH, "utf8"));
    Object.assign(loaded, local);
  } catch {}

  // normalize schema
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

// Save trainer data locally
async function saveTrainerDataLocal(data) {
  await fs.writeFile(TRAINERDATA_PATH, JSON.stringify(data, null, 2));
}

// Upload backup to Discord channel
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
// 🧮 RANK / TP SYSTEM
// ==========================================================

// Determine role tier by TP
function getRank(tp) {
  const thresholds = Object.keys(RANK_ROLES).map(Number).sort((a, b) => a - b);
  let role = RANK_ROLES[0];
  for (const t of thresholds) if (tp >= t) role = RANK_ROLES[t];
  return role;
}

// Update Discord member role (idempotent)
async function updateUserRole(member, tp) {
  const newRank = getRank(tp);
  const role = member.guild.roles.cache.find(r => r.name === newRank);
  if (!role) return;
  if (member.roles.cache.has(role.id)) return; // already correct rank
  for (const r of Object.values(RANK_ROLES)) {
    const existing = member.guild.roles.cache.find(x => x.name === r);
    if (existing && member.roles.cache.has(existing.id)) await member.roles.remove(existing);
  }
  await member.roles.add(role);
  console.log(`🏅 ${member.user.username} promoted to ${newRank}`);
}

// ==========================================================
// ⚙️ COMMAND LOADER
// ==========================================================
async function loadCommands() {
  const commandsPath = path.resolve("./commands");
  const files = (await fs.readdir(commandsPath)).filter(f => f.endsWith(".js"));
  for (const f of files) {
    const cmd = (await import(`./commands/${f}`)).default;
    client.commands.set(cmd.data.name, cmd);
  }

  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: client.commands.map(c => c.data.toJSON())
  });
  console.log(`✅ Registered ${client.commands.size} slash commands.`);
}

// ==========================================================
// 🧠 MESSAGE XP / TP HANDLER
// ==========================================================
client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;
  const id = msg.author.id;
  trainerData[id] ??= { tp: 0, cc: 0, pokemon: {}, trainers: {}, trainer: null, displayedPokemon: [] };
  trainerData[id].tp += 1;

  // Update Discord role tier if needed
  try {
    const member = await msg.guild.members.fetch(id);
    await updateUserRole(member, trainerData[id].tp);
  } catch {}
});

// ==========================================================
// 🎮 SLASH COMMAND HANDLER
// ==========================================================
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
// 🕒 AUTOSAVE AND SHUTDOWN
// ==========================================================
async function autosave() {
  await saveTrainerDataLocal(trainerData);
  await saveDataToDiscord(trainerData);
}
setInterval(autosave, AUTOSAVE_INTERVAL);

process.on("SIGINT", async () => { console.log("💾 SIGINT → saving..."); await autosave(); process.exit(0); });
process.on("SIGTERM", async () => { console.log("💾 SIGTERM → saving..."); await autosave(); process.exit(0); });

// ==========================================================
// 📰 POKÉBEACH UPDATES
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
setInterval(checkPokeBeach, 1000 * 60 * 60 * 6); // every 6 hours

// ==========================================================
// 🔗 AFFILIATE LINK CLEANER
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
// 🚀 BOT STARTUP
// ==========================================================
let trainerData = {};
client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  trainerData = await loadTrainerData();
  await loadCommands();
  checkPokeBeach(); // run immediately
});

// ==========================================================
// 🌐 EXPRESS KEEP-ALIVE SERVER (Render requirement)
// ==========================================================
const app = express();
app.get("/", (_, res) => res.send("Bot is running!"));
app.listen(PORT, () => console.log(`✅ Listening on port ${PORT}`));

// ==========================================================
// 🔐 LOGIN
// ==========================================================
client.login(process.env.BOT_TOKEN);
