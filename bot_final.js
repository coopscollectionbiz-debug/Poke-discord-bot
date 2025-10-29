/**
 * CoopBot v1.4 — Passive TP Edition
 * Includes: autosave, PokéBeach, affiliate links, slash commands, and passive TP gain.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import cheerio from 'cheerio';
import cron from 'node-cron';
import { Client, GatewayIntentBits, Collection, EmbedBuilder } from 'discord.js';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ==================== AFFILIATE IDS ====================
const AFFILIATES = {
  amazonAffiliateTag: 'coopscolle02b-20',
  ebayAffiliateId: '2390378'


// -----------------------------
// 💾 PATHS & CONSTANTS
// -----------------------------
const dataPath = path.join(__dirname, 'data');
const trainerDataPath = path.join(dataPath, 'trainerData.json');
const storageChannelId = process.env.STORAGE_CHANNEL_ID || '1242750037109248093';
const pokebeachChannelId = '1432007350604271797';
const AUTOSAVE_INTERVAL = 15 * 60 * 1000; // 15 minutes
let trainerData = {};
const tpCooldowns = new Map(); // store userId -> lastTPtimestamp

// -----------------------------
// 🤖 CLIENT INIT
// -----------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});
client.commands = new Collection();

// -----------------------------
// 🧠 LOGGER
// -----------------------------
const log = {
  info: (msg) => console.log(`🟢 [INFO] ${msg}`),
  warn: (msg) => console.log(`🟡 [WARN] ${msg}`),
  error: (msg) => console.log(`🔴 [ERROR] ${msg}`)
};

// -----------------------------
// ⚙️ COMMAND LOADER
// -----------------------------
async function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const cmd = await import(`./commands/${file}`);
      client.commands.set(cmd.default.data.name, cmd.default);
      log.info(`Registered /${cmd.default.data.name}`);
    } catch (err) {
      log.error(`Failed to load command ${file}: ${err.message}`);
    }
  }
  log.info(`✅ ${client.commands.size} slash commands loaded.`);
}

// -----------------------------
// 💾 TRAINER DATA FUNCTIONS
// -----------------------------
function compressData(obj) {
  const json = JSON.stringify(obj);
  return zlib.deflateSync(json).toString('base64');
}
function decompressData(str) {
  try {
    const buf = Buffer.from(str, 'base64');
    return JSON.parse(zlib.inflateSync(buf).toString());
  } catch {
    return {};
  }
}

async function loadTrainerDataFromStorage() {
  try {
    const channel = await client.channels.fetch(storageChannelId);
    const messages = await channel.messages.fetch({ limit: 10 });
    const backup = messages
      .filter(m => m.author.id === client.user.id && m.content.startsWith('COMPRESSED_BACKUP:'))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
      .first();

    if (backup) {
      const encoded = backup.content.replace('COMPRESSED_BACKUP:', '').trim();
      trainerData = decompressData(encoded);
      log.info(`Loaded trainer data for ${Object.keys(trainerData).length} users.`);
    } else {
      log.warn('No previous backups found. Starting new trainerData.');
      trainerData = {};
    }
  } catch (err) {
    log.error(`Error loading trainer data: ${err.message}`);
    trainerData = {};
  }
}

async function autosaveTrainerData() {
  try {
    const channel = await client.channels.fetch(storageChannelId);
    const payload = compressData(trainerData);
    const formatted = `COMPRESSED_BACKUP:\n${payload}`;
    const messages = await channel.messages.fetch({ limit: 10 });
    const last = messages
      .filter(m => m.author.id === client.user.id && m.content.startsWith('COMPRESSED_BACKUP:'))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
      .first();
    if (last) await last.edit(formatted);
    else await channel.send(formatted);
    fs.writeFileSync(trainerDataPath, JSON.stringify(trainerData, null, 2));
    log.info(`Autosaved trainerData (${Object.keys(trainerData).length} users)`);
  } catch (err) {
    log.error(`Autosave failed: ${err.message}`);
  }
}

// -----------------------------
// 🏅 ROLE SYSTEM
// -----------------------------
function getRoleForTP(tp) {
  const tiers = [
    { min: 250000, role: 'Legend' },
    { min: 175000, role: 'Champion' },
    { min: 100000, role: 'Elite Four Member' },
    { min: 50000, role: 'Gym Leader' },
    { min: 25000, role: 'Master Trainer' },
    { min: 17500, role: 'Elite Trainer' },
    { min: 10000, role: 'Veteran Trainer' },
    { min: 7500, role: 'Expert Trainer' },
    { min: 5000, role: 'Advanced Trainer' },
    { min: 2500, role: 'Experienced Trainer' },
    { min: 1000, role: 'Skilled Trainer' },
    { min: 500, role: 'Junior Trainer' },
    { min: 0, role: 'Novice Trainer' }
  ];
  return tiers.find(t => tp >= t.min)?.role || 'Novice Trainer';
}

async function updateUserRole(msg, userId) {
  try {
    const member = await msg.guild.members.fetch(userId);
    const tp = trainerData[userId].tp || 0;
    const newRoleName = getRoleForTP(tp);
    const newRole = msg.guild.roles.cache.find(r => r.name === newRoleName);
    if (!newRole) return;

    const tierRoles = [
      'Novice Trainer', 'Junior Trainer', 'Skilled Trainer', 'Experienced Trainer',
      'Advanced Trainer', 'Expert Trainer', 'Veteran Trainer', 'Elite Trainer',
      'Master Trainer', 'Gym Leader', 'Elite Four Member', 'Champion', 'Legend'
    ];
    await member.roles.remove(member.roles.cache.filter(r => tierRoles.includes(r.name)));
    await member.roles.add(newRole);
  } catch (err) {
    // silently ignore if role sync fails (bot perms, missing role, etc.)
  }
}

// -----------------------------
// 💬 INTERACTIONS
// -----------------------------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, trainerData);
  } catch (err) {
    log.error(`Command ${interaction.commandName} failed: ${err.message}`);
    if (!interaction.replied)
      await interaction.reply({ content: '❌ Command error.', ephemeral: true });
  }
});

// -----------------------------
// 💬 MESSAGE EVENT — Passive TP gain + Affiliate conversion
// -----------------------------
const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

// === Affiliate Helper Functions ===
async function expandShortenedUrl(shortUrl) {
  try {
    const response = await fetch(shortUrl, { method: 'HEAD', redirect: 'follow' });
    return response.url;
  } catch (error) {
    console.error('Error expanding shortened URL:', error);
    return shortUrl;
  }
}

async function extractAmazonProductId(url) {
  let fullUrl = url;

  if (url.includes('amzn.to') || url.includes('amzn.com')) {
    console.log(`🔗 Expanding shortened URL: ${url}`);
    fullUrl = await expandShortenedUrl(url);
    console.log(`   → Expanded to: ${fullUrl}`);
  }

  const dpMatch = fullUrl.match(/\/dp\/([A-Z0-9]{10})/i);
  if (dpMatch) return dpMatch[1];

  const gpMatch = fullUrl.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  if (gpMatch) return gpMatch[1];

  return null;
}

function extractEbayItemId(url) {
  const itmMatch = url.match(/\/itm\/(\d+)/);
  if (itmMatch) return itmMatch[1];

  const itemMatch = url.match(/[?&]item=(\d+)/);
  if (itemMatch) return itemMatch[1];

  return null;
}

function createAmazonAffiliateLink(productId) {
  return `https://www.amazon.com/dp/${productId}?tag=${CONFIG.amazonAffiliateTag}`;
}

function createEbayAffiliateLink(itemId) {
  return `https://www.ebay.com/itm/${itemId}?mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=${CONFIG.ebayAffiliateId}&toolid=11800`;
}

async function detectAndConvertLinks(messageContent) {
  const conversions = [];

  const amazonRegex = /(https?:\/\/)?(www\.)?(amazon\.com|amzn\.to|amzn\.com)([^\s]*)/gi;
  for (const match of messageContent.matchAll(amazonRegex)) {
    const fullUrl = match[0];
    const productId = await extractAmazonProductId(fullUrl);
    if (productId) {
      conversions.push({
        type: 'Amazon',
        original: fullUrl,
        affiliate: createAmazonAffiliateLink(productId)
      });
    }
  }

  const ebayRegex = /(https?:\/\/)?(www\.)?ebay\.com([^\s]*)/gi;
  for (const match of messageContent.matchAll(ebayRegex)) {
    const fullUrl = match[0];
    const itemId = extractEbayItemId(fullUrl);
    if (itemId) {
      conversions.push({
        type: 'eBay',
        original: fullUrl,
        affiliate: createEbayAffiliateLink(itemId)
      });
    }
  }

  return conversions;
}

function extractNonLinkText(messageContent) {
  let textOnly = messageContent
    .replace(/(https?:\/\/)?(www\.)?(amazon\.com|amzn\.to|amzn\.com)([^\s]*)/gi, '')
    .replace(/(https?:\/\/)?(www\.)?ebay\.com([^\s]*)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return textOnly;
}

// === Discord Message Event ===
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot || !msg.guild) return;
    const userId = msg.author.id;

    // Passive TP Gain (+1 every 5 seconds)
    const now = Date.now();
    const last = tpCooldowns.get(userId) || 0;
    if (now - last >= 5000) {
      if (!trainerData[userId])
        trainerData[userId] = { tp: 0, cc: 0, pokemon: {}, trainers: {} };
      trainerData[userId].tp = (trainerData[userId].tp || 0) + 1;
      tpCooldowns.set(userId, now);
    }

    // Update role
    await updateUserRole(msg, userId);

    // Affiliate Conversion
    const conversions = await detectAndConvertLinks(msg.content);
    if (conversions.length) {
      const nonLinkText = extractNonLinkText(msg.content);
      const lines = conversions.map(c => `• ${c.affiliate}`).join('\n');

      const embed = new EmbedBuilder()
        .setColor(0xffcc00)
        .setTitle('Affiliate-Safe Link Conversion')
        .setDescription(`${nonLinkText}\n\n${lines}\n\n_Original message replaced with affiliate link(s). Coop may be compensated for purchases made through these links._`)
        .setFooter({ text: `Coop's Collection Bot • ${new Date().toLocaleTimeString()}` });

      await msg.delete();
      await msg.channel.send({ embeds: [embed] });
      log.info(`Affiliate link converted for ${msg.author.tag} in #${msg.channel.name}`);
    }
  } catch (err) {
    log.error(`Message event failed: ${err.message}`);
  }
});

// -----------------------------
// 📰 POKÉBEACH SCRAPER
// -----------------------------
const pokebeachStatePath = path.join(dataPath, 'pokebeachState.json');
function loadPokeBeachState() {
  try {
    if (fs.existsSync(pokebeachStatePath))
      return JSON.parse(fs.readFileSync(pokebeachStatePath, 'utf8'));
  } catch (e) { log.warn(`Could not read pokebeachState.json: ${e.message}`); }
  return { lastLink: '' };
}
function savePokeBeachState(state) {
  try { fs.writeFileSync(pokebeachStatePath, JSON.stringify(state, null, 2)); }
  catch (e) { log.error(`Failed saving pokebeachState.json: ${e.message}`); }
}

async function fetchPokeBeachAndPost() {
  const state = loadPokeBeachState();
  const lastLink = state.lastLink || '';
  try {
    log.info('Checking PokéBeach for updates...');
    const res = await fetch('https://www.pokebeach.com/');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const posts = [];
    $('article').each((_, el) => {
      const link = $(el).find('a').first().attr('href');
      const title = $(el).find('h2, h3').first().text().trim();
      const img = $(el).find('img').first().attr('src') || '';
      if (link && title) posts.push({ link, title, img });
    });

    if (!posts.length) return log.warn('No PokéBeach posts found.');
    const channel = await client.channels.fetch(pokebeachChannelId);
    if (!channel) return log.warn('PokéBeach channel not found.');

    const newPosts = [];
    for (const p of posts) {
      if (p.link === lastLink) break;
      newPosts.push(p);
    }
    if (!newPosts.length) return log.info('No new PokéBeach articles.');

    for (let i = newPosts.length - 1; i >= 0; i--) {
      const { link, title, img } = newPosts[i];
      const embed = new EmbedBuilder()
        .setColor(0x0070ff)
        .setTitle(title)
        .setURL(link)
        .setImage(img)
        .setFooter({ text: 'PokéBeach • CoopBot' })
        .setTimestamp();
      await channel.send({ embeds: [embed] });
      log.info(`Posted new article: ${title}`);
    }
    savePokeBeachState({ lastLink: newPosts[0]?.link || lastLink });
  } catch (err) {
    log.error(`PokéBeach fetch failed: ${err.message}`);
  }
}
cron.schedule('*/15 * * * *', fetchPokeBeachAndPost); // every 15 minutes

// -----------------------------
// 🧭 STARTUP
// -----------------------------
client.once('ready', async () => {
  log.info(`Bot logged in as ${client.user.tag}`);
  await loadCommands();
  await loadTrainerDataFromStorage();
  setInterval(() => autosaveTrainerData(), AUTOSAVE_INTERVAL);
  log.info(`Autosave every ${AUTOSAVE_INTERVAL / 60000} minutes initialized.`);
});

// -----------------------------
// 🌐 HEARTBEAT (Render)
// —-----------------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running!');
}).listen(PORT, () => log.info(`Render heartbeat active on port ${PORT}`));

// -----------------------------
// 🔐 LOGIN
// -----------------------------
client.login(process.env.BOT_TOKEN);
