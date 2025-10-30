// ==========================================================
// 🤖 CoopBot Final Build (Render + Full Feature Integration)
// ==========================================================


import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import fetch from 'node-fetch';
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Collection,
  AttachmentBuilder,
  PermissionsBitField
} from 'discord.js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
dotenv.config();

process.on('uncaughtException', err => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', reason => console.error('Unhandled Rejection:', reason));

// ==========================================================
// 🧱 Express Keep-Alive Server (Render requirement)
// ==========================================================
const app = express();
app.use('/public', express.static(path.join(process.cwd(), 'public')));
app.get('/', (req, res) => res.send('Bot is running!'));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Listening on ${PORT}`));

// ==========================================================
// ⚙️ Config
// ==========================================================
const STORAGE_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID;
const NEWS_CHANNEL_ID = process.env.NEWS_CHANNEL_ID;
const AMAZON_TAG = 'coopscolle02b-20';
const EBAY_ID = '2390378';
const AUTOSAVE_INTERVAL = 30 * 60 * 1000; // 30 min
const BACKUP_LIMIT = 5;

// ---- TP-based Rank System ----
const RANKS = [
  { tp: 100, roleName: 'Novice Trainer' },
  { tp: 500, roleName: 'Junior Trainer' },
  { tp: 1000, roleName: 'Skilled Trainer' },
  { tp: 2500, roleName: 'Experienced Trainer' },
  { tp: 5000, roleName: 'Advanced Trainer' },
  { tp: 7500, roleName: 'Expert Trainer' },
  { tp: 10000, roleName: 'Veteran Trainer' },
  { tp: 17500, roleName: 'Elite Trainer' },
  { tp: 25000, roleName: 'Master Trainer' },
  { tp: 50000, roleName: 'Gym Leader' },
  { tp: 100000, roleName: 'Elite Four Member' },
  { tp: 175000, roleName: 'Champion' },
  { tp: 250000, roleName: 'Legend' }
];

function getRank(tp = 0) {
  let role = RANKS[0].roleName;
  for (const r of RANKS) if (tp >= r.tp) role = r.roleName;
  return role;
}

async function updateUserRole(member, newRankName) {
  const guild = member.guild;
  const allRanks = RANKS.map(r => r.roleName);
  await member.roles.remove(member.roles.cache.filter(role => allRanks.includes(role.name)));
  const role = guild.roles.cache.find(r => r.name === newRankName);
  if (role) await member.roles.add(role);
}

// ==========================================================
// 💾 Trainer Data + Backups
// ==========================================================
let trainerData = {};

async function saveTrainerDataLocal() {
  await fs.writeFile('trainerData.json', JSON.stringify(trainerData, null, 2));
}

async function deleteOldBackups(channel) {
  const msgs = await channel.messages.fetch({ limit: 50 });
  const backups = msgs.filter(m => m.author.id === client.user.id && m.attachments.size);
  const sorted = backups.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  for (const msg of sorted.map(m => m).slice(BACKUP_LIMIT - 1)) await msg.delete().catch(() => {});
}

async function saveDataToDiscord() {
  try {
    if (!STORAGE_CHANNEL_ID) return;
    const channel = await client.channels.fetch(STORAGE_CHANNEL_ID);
    if (!channel) return;
    await deleteOldBackups(channel);
    const buffer = Buffer.from(JSON.stringify(trainerData, null, 2));
    const attachment = new AttachmentBuilder(buffer, { name: 'trainerData.json' });
    await channel.send({
      content: `💾 Data backup — ${new Date().toLocaleString()}`,
      files: [attachment]
    });
    console.log('✅ Trainer data backed up to Discord.');
  } catch (e) {
    console.error('❌ Error saving data to Discord:', e);
  }
}

async function loadTrainerData() {
  try {
    if (!STORAGE_CHANNEL_ID) return;
    const channel = await client.channels.fetch(STORAGE_CHANNEL_ID);
    if (!channel) return;
    console.log('📥 Loading trainerData.json from Discord...');
    const messages = await channel.messages.fetch({ limit: 50 });
    for (const msg of messages.values()) {
      const att = msg.attachments.find(a => a.name === 'trainerData.json');
      if (att) {
        const res = await fetch(att.url);
        trainerData = await res.json();
        console.log(`✅ Loaded trainerData.json (${Object.keys(trainerData).length} users)`);
        return;
      }
    }
    console.log('⚠️ No trainerData.json found in storage channel.');
  } catch (e) {
    console.error('❌ Error loading trainerData.json:', e);
  }
}

// ==========================================================
// 🔗 Affiliate Link Conversion
// ==========================================================
async function expandShortenedUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.url;
  } catch {
    return url;
  }
}

async function extractAmazonProductId(url) {
  let full = url;
  if (url.includes('amzn.')) full = await expandShortenedUrl(url);
  const dp = full.match(/\/dp\/([A-Z0-9]{10})/i);
  if (dp) return dp[1];
  const gp = full.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  if (gp) return gp[1];
  return null;
}
function extractEbayItemId(url) {
  const itm = url.match(/\/itm\/(\d+)/);
  if (itm) return itm[1];
  const item = url.match(/[?&]item=(\d+)/);
  if (item) return item[1];
  return null;
}
function createAmazonAffiliateLink(id) {
  return `https://www.amazon.com/dp/${id}?tag=${AMAZON_TAG}`;
}
function createEbayAffiliateLink(id) {
  return `https://www.ebay.com/itm/${id}?mkcid=1&mkrid=${EBAY_ID}`;
}

async function detectAndConvertLinks(content) {
  const conversions = [];
  const amazonMatches = content.matchAll(/https?:\/\/[^\s]*amazon\.[^\s]+/gi);
  for (const m of amazonMatches) {
    const id = await extractAmazonProductId(m[0]);
    if (id) conversions.push({ type: 'Amazon', affiliate: createAmazonAffiliateLink(id) });
  }
  const ebayMatches = content.matchAll(/https?:\/\/[^\s]*ebay\.[^\s]+/gi);
  for (const m of ebayMatches) {
    const id = extractEbayItemId(m[0]);
    if (id) conversions.push({ type: 'eBay', affiliate: createEbayAffiliateLink(id) });
  }
  return conversions;
}

// ==========================================================
// 📰 PokéBeach Scraper
// ==========================================================
async function scrapePokebeach() {
  if (!NEWS_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(NEWS_CHANNEL_ID);
    if (!channel) return;
    const res = await fetch('https://www.pokebeach.com/');
    const html = await res.text();
    const pattern = /<h[23][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>[\s\S]*?<\/h[23]>/gi;
    const matches = html.matchAll(pattern);
    const articles = [];
    for (const match of matches) {
      const link = match[1];
      const title = match[2].replace(/<[^>]*>/g, '').trim();
      if (link && title && link.includes('/20') && !link.includes('#'))
        articles.push({ title, link });
    }
    if (!articles.length) return;
    const lastKey = '_lastPokebeachArticle';
    const lastUrl = trainerData[lastKey];
    const newest = articles[0];
    if (newest.link !== lastUrl) {
  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle(newest.title)
    .setURL(newest.link)
    .setDescription(`New PokéBeach article: [${newest.title}](${newest.link})`)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  trainerData[lastKey] = newest.link;
  console.log('✅ New PokéBeach article posted.');
    }
  } catch (e) {
    console.error('❌ PokéBeach scraping error:', e);
  }
}
setInterval(scrapePokebeach, 6 * 60 * 60 * 1000);

// ==========================================================
// 🤖 Discord Client + Command Handling
// ==========================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});
const commands = new Collection();

async function loadCommands() {
  const folder = path.join(process.cwd(), 'commands');
  const files = await fs.readdir(folder);
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const { default: command } = await import(path.join(folder, file));
    commands.set(command.data.name, command);
  }
}

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  await loadTrainerData();
  await loadCommands();

  const { REST } = await import('@discordjs/rest');
  const { Routes } = await import('discord-api-types/v10');
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    const body = Array.from(commands.values()).map(c => c.data.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), { body });
    console.log(`✅ Registered ${commands.size} slash commands.`);
  } catch (e) {
    console.error('❌ Error registering commands:', e);
  }
});

// ==========================================================
// 🧠 Interaction + Message Logic
// ==========================================================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command)
    return interaction.reply({ content: '❌ Command not found.', ephemeral: true });
  try {
    await command.execute(interaction, trainerData, saveDataToDiscord);
  } catch (e) {
    console.error(e);
    if (interaction.replied || interaction.deferred)
      await interaction.followUp({ content: '❌ Error executing command.', ephemeral: true });
    else
      await interaction.reply({ content: '❌ Error executing command.', ephemeral: true });
  }
});

client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.guild) return;

  const conversions = await detectAndConvertLinks(msg.content);
  if (conversions.length) {
    try {
      await msg.delete();
      let out = `**${msg.author.username}** shared:\n`;
      for (const c of conversions) out += `${c.affiliate}\n`;
      out +=
        '\n_Original message replaced with affiliate link(s). Coop may be compensated for purchases made through these links._';
      await msg.channel.send(out);
      console.log(`🔗 Converted ${conversions.length} link(s) from ${msg.author.tag}`);
      return;
    } catch (e) {
      console.error('Link conversion error:', e);
    }
  }

  // ---- TP tracking ----
  if (!trainerData[msg.author.id]) trainerData[msg.author.id] = { tp: 0, cc: 0 };
  trainerData[msg.author.id].tp += 1;

  const member = await msg.guild.members.fetch(msg.author.id);
  const rank = getRank(trainerData[msg.author.id].tp);
  const alreadyHas = member.roles.cache.some(r => r.name === rank);
  await updateUserRole(member, rank);
  if (!alreadyHas && rank !== 'Novice Trainer') {
    msg.channel.send(
      `🎉 ${msg.author} reached **${rank}** rank with ${trainerData[msg.author.id].tp.toLocaleString()} TP!`
    );
  }
});

// ==========================================================
// 💾 Autosave + Graceful Shutdown
// ==========================================================
setInterval(() => saveDataToDiscord(), AUTOSAVE_INTERVAL);
process.on('SIGINT', async () => {
  await saveDataToDiscord();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await saveDataToDiscord();
  process.exit(0);
});

// ==========================================================
// 🚀 Login
// ==========================================================
client.login(process.env.BOT_TOKEN);
