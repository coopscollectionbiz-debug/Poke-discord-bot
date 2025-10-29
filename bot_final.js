// -----------------------------
// 🧩 MODULE IMPORTS
// -----------------------------
import fs from 'fs';
import path, { dirname, join } from 'path';
import http from 'http';
import zlib from 'zlib';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { Client, GatewayIntentBits, Collection, EmbedBuilder } from 'discord.js';

// -----------------------------
// ⚙️ INITIALIZATION
// -----------------------------
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataPath = join(__dirname, 'data');

// Create data directory if not exists
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });

// -----------------------------
// 🌐 KEEP RENDER ACTIVE
// -----------------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running!');
}).listen(PORT, () => console.log(`✅ Server listening on port ${PORT}`));

// -----------------------------
// 🤖 DISCORD CLIENT
// -----------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// -----------------------------
// 💾 DATA HANDLING
// -----------------------------
const trainerDataPath = join(dataPath, 'trainerData.json');
let trainerData = {};

try {
  if (fs.existsSync(trainerDataPath)) {
    trainerData = JSON.parse(fs.readFileSync(trainerDataPath));
  }
} catch (err) {
  console.error('Error loading trainerData:', err);
}

function saveTrainerData() {
  try {
    fs.writeFileSync(trainerDataPath, JSON.stringify(trainerData, null, 2));
    console.log('✅ Trainer data saved');
  } catch (err) {
    console.error('Error saving trainerData:', err);
  }
}

// Autosave every 15 minutes
setInterval(saveTrainerData, 15 * 60 * 1000);

// -----------------------------
// 🪙 ECONOMY CONFIG
// -----------------------------
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

function getRank(tp) {
  let role = RANKS[0].roleName;
  for (const r of RANKS) if (tp >= r.tp) role = r.roleName;
  return role;
}

// -----------------------------
// 💬 MESSAGE EVENT — TP + AFFILIATE
// -----------------------------
const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot || !msg.guild) return;

    const userId = msg.author.id;
    const now = Date.now();
    if (!trainerData[userId]) trainerData[userId] = { tp: 0, cc: 0 };

    // Passive TP gain every 5 seconds
    if (!trainerData[userId].lastTP || now - trainerData[userId].lastTP >= 5000) {
      trainerData[userId].tp += 1;
      trainerData[userId].lastTP = now;
    }

    // Update user role
    const rank = getRank(trainerData[userId].tp);
    const guildMember = await msg.guild.members.fetch(userId);
    const role = msg.guild.roles.cache.find(r => r.name === rank);
    if (role && !guildMember.roles.cache.has(role.id)) {
      await guildMember.roles.add(role);
    }

    // AFFILIATE CONVERSION
    const urls = msg.content.match(URL_REGEX);
    if (!urls) return;

    const converted = [];
    for (const url of urls) {
      let affiliateUrl = url;

      // Amazon affiliate
      if (url.includes('amazon.com') || url.includes('amzn.to')) {
        affiliateUrl = url.includes('?tag=')
          ? url.replace(/(\?|&)tag=[^&]+/, `$1tag=coopscolle02b-20`)
          : url.includes('?')
          ? `${url}&tag=coopscolle02b-20`
          : `${url}?tag=coopscolle02b-20`;
      }

      // eBay affiliate
      if (url.includes('ebay.com')) {
        affiliateUrl = url.includes('?mkevt')
          ? url
          : `${url}${url.includes('?') ? '&' : '?'}mkcid=1&mkrid=2390378`;
      }

      if (affiliateUrl !== url) converted.push(affiliateUrl);
    }

    if (converted.length) {
      const embed = new EmbedBuilder()
        .setColor(0xffcc00)
        .setTitle('Affiliate-Safe Link Conversion')
        .setDescription(
          `${converted.map(u => `• ${u}`).join('\n')}\n\n_Your original message was replaced with affiliate-safe links. Coop may be compensated for purchases made through these links._`
        )
        .setFooter({ text: `Coop's Collection Bot • ${new Date().toLocaleTimeString()}` });

      await msg.delete();
      await msg.channel.send({ embeds: [embed] });
      console.log(`[Affiliate] Converted message from ${msg.author.tag}`);
    }

  } catch (err) {
    console.error('Message handler error:', err);
  }
});

// -----------------------------
// 📰 POKÉBEACH SCRAPER
// -----------------------------
const POKEBEACH_URL = 'https://www.pokebeach.com/';
const TARGET_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID;

async function fetchPokebeachArticles() {
  try {
    const res = await fetch(POKEBEACH_URL);
    const html = await res.text();
    const $ = cheerio.load(html);

    const articles = [];
    $('article').each((i, el) => {
      const title = $(el).find('h2 a').text();
      const link = $(el).find('h2 a').attr('href');
      if (title && link) articles.push({ title, link });
    });

    if (!articles.length) return;

    const channel = await client.channels.fetch(TARGET_CHANNEL_ID);
    const latest = articles.slice(0, 3)
      .map(a => `📰 [${a.title}](${a.link})`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Latest from PokéBeach')
      .setDescription(latest)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    console.log('✅ PokéBeach update posted!');
  } catch (err) {
    console.error('Error scraping PokéBeach:', err);
  }
}

// Run every 6 hours
cron.schedule('0 */6 * * *', fetchPokebeachArticles);

// -----------------------------
// 🤖 BOT LOGIN
// -----------------------------
client.once('ready', () => {
  console.log(`✨ Logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);
