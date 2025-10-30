import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import fetch from 'node-fetch';
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Collection,
  PermissionsBitField
} from 'discord.js';
import { v4 as uuidv4 } from 'uuid'; // install with: npm install uuid

// ---- Config ----
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
const STORAGE_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID;
const NEWS_CHANNEL_ID = process.env.NEWS_CHANNEL_ID;
const AMAZON_TAG = 'coopscolle02b-20';
const EBAY_ID = '2390378';

let trainerData = {};

// ---- Updated Save and Load Functionality ----

// Save data to Discord channel
async function saveDataToDiscord() {
  if (!STORAGE_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(STORAGE_CHANNEL_ID);
    if (!channel) return;

    // Clean up old backups before saving new one
    await deleteOldBackups(channel);

    const jsonString = JSON.stringify(trainerData, null, 2);
    const buffer = Buffer.from(jsonString, 'utf-8');
    const attachment = new AttachmentBuilder(buffer, { name: 'trainerData.json' });

    await channel.send({
      content: `💾 Data backup - ${new Date().toLocaleString()}`,
      files: [attachment]
    });

    console.log('✅ Trainer data backed up to Discord.');
  } catch (error) {
    console.error('❌ Error saving data to Discord:', error);
  }
}

// Delete old backups in Discord channel
async function deleteOldBackups(channel) {
  let lastId;
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const messages = await channel.messages.fetch(options);
    const backupMsgs = Array.from(messages.values()).filter((m) =>
      m.attachments.some((att) => att.name === 'trainerData.json')
    );
    for (const msg of backupMsgs) {
      await msg.delete().catch(() => {});
    }
    if (messages.size < 100) break;
    lastId = messages.last()?.id;
    if (!lastId) break;
  }
}

// Load data from Discord channel
async function loadTrainerData() {
  if (STORAGE_CHANNEL_ID) {
    try {
      const channel = await client.channels.fetch(STORAGE_CHANNEL_ID);
      if (channel) {
        console.log('📥 Loading data from Discord...');
        const messages = await channel.messages.fetch({ limit: 100 });

        // Find the most recent trainerData.json file
        for (const message of messages.values()) {
          if (message.attachments.size > 0) {
            const attachment = message.attachments.find((att) => att.name === 'trainerData.json');
            if (attachment) {
              const response = await fetch(attachment.url);
              const data = await response.json();
              trainerData = data;
              console.log(
                `✅ Loaded trainerData.json from Discord (${Object.keys(trainerData).length} users)`
              );
              return;
            }
          }
        }

        console.log('⚠️ No trainerData.json found in the storage channel.');
      }
    } catch (error) {
      console.error('❌ Error loading data from Discord:', error);
    }
  }
}

// ---- Other Features Remain Unchanged ----

// ---- Discord client ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ---- Affiliate links ----
async function expandShortenedUrl(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return response.url;
  } catch {
    return url;
  }
}

async function extractAmazonProductId(url) {
  let fullUrl = url;
  if (url.includes('amzn.to') || url.includes('amzn.com')) {
    fullUrl = await expandShortenedUrl(url);
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
  return `https://www.amazon.com/dp/${productId}?tag=${AMAZON_TAG}`;
}
function createEbayAffiliateLink(itemId) {
  return `https://www.ebay.com/itm/${itemId}?mkcid=1&mkrid=2390378`;
}

async function detectAndConvertLinks(messageContent) {
  const conversions = [];
  const amazonRegex = /(https?:\/\/[^\s]*amazon\.[^\s]+)/gi;
  const ebayRegex = /(https?:\/\/[^\s]*ebay\.[^\s]+)/gi;
  const amazonMatches = messageContent.matchAll(amazonRegex);
  for (const match of amazonMatches) {
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
  const ebayMatches = messageContent.matchAll(ebayRegex);
  for (const match of ebayMatches) {
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
  let textOnly = messageContent;
  textOnly = textOnly.replace(/(https?:\/\/[^\s]*amazon\.[^\s]+)/gi, '');
  textOnly = textOnly.replace(/(https?:\/\/[^\s]*ebay\.[^\s]+)/gi, '');
  textOnly = textOnly.replace(/\s+/g, ' ').trim();
  return textOnly;
}

// ---- Rank system ----
function getRank(tp) {
  let role = RANKS[0].roleName;
  for (const r of RANKS) if (tp >= r.tp) role = r.roleName;
  return role;
}
async function updateUserRole(member, newRankName) {
  const guild = member.guild;
  const allRankNames = RANKS.map((r) => r.roleName);
  await member.roles.remove(member.roles.cache.filter((role) => allRankNames.includes(role.name)));
  const role = guild.roles.cache.find((r) => r.name === newRankName);
  if (role) await member.roles.add(role);
}

// ---- Pokebeach news ----
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
      if (link && title && link.includes('/20') && title.length > 10 && !link.includes('#')) {
        articles.push({ title, link });
      }
    }
    if (articles.length === 0) return;
    const lastPostedKey = '_lastPokebeachArticle';
    const lastPostedUrl = trainerData[lastPostedKey];
    const newArticle = articles[0];
    if (newArticle.link !== lastPostedUrl) {
      const embed = new EmbedBuilder()
        .setColor(0x3B82F6)
        .setTitle(newArticle.title)
        .setURL(newArticle.link)
        .setDescription(`New PokéBeach article: [${newArticle.title}](${newArticle.link})`)
        .setTimestamp(new Date());
      await channel.send({ embeds: [embed] });
      trainerData[lastPostedKey] = newArticle.link;
      await saveDataToDiscord();
      console.log('✅ New PokéBeach article posted');
    }
  } catch (e) {
    console.error('❌ PokéBeach scraping error:', e);
  }
}
setInterval(scrapePokebeach, 6 * 60 * 60 * 1000);

// ---- Command loading ----
const commands = new Collection();

async function loadCommands() {
  const commandsPath = path.join(process.cwd(), 'commands');
  const files = await fs.readdir(commandsPath);
  for (const file of files) {
    if (file.endsWith('.js')) {
      const { default: command } = await import(path.join(commandsPath, file));
      if (command.data.name === 'adminsave') {
        commands.set(command.data.name, {
          ...command,
          async execute(interaction, trainerData) {
            await command.execute(interaction, trainerData, saveDataToDiscord);
          }
        });
      } else {
        commands.set(command.data.name, command);
      }
    }
  }
}

// ---- Event listeners ----
client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  await loadTrainerData();
  await loadCommands();

  // Register all slash commands
  const restModule = await import('@discordjs/rest');
  const { REST } = restModule;
  const { Routes } = await import('discord-api-types/v10');
  const restClient = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

  try {
    const dataArray = Array.from(commands.values()).map((cmd) => cmd.data.toJSON());
    await restClient.put(Routes.applicationCommands(client.user.id), { body: dataArray });
    console.log(`✅ Registered ${commands.size} slash commands`);
  } catch (err) {
    console.error('❌ Error registering slash commands:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) {
    await interaction.reply({ content: '❌ Command not found.', ephemeral: true });
    return;
  }
  try {
    await command.execute(interaction, trainerData, saveDataToDiscord);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '❌ There was an error executing that command.',
        ephemeral: true
      });
    } else {
      await interaction.reply({ content: '❌ There was an error executing that command.', ephemeral: true });
    }
  }
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.guild) return;
  const linkConversions = await detectAndConvertLinks(msg.content);
  if (linkConversions.length > 0) {
    try {
      const nonLinkText = extractNonLinkText(msg.content);
      await msg.delete();
      let affiliateMessage = `**${msg.author.username}** shared:\n`;
      if (nonLinkText) affiliateMessage += `${nonLinkText}\n\n`;
      linkConversions.forEach((conversion) => {
        affiliateMessage += `${conversion.affiliate}\n`;
      });
      affiliateMessage += `\n_Original message replaced with affiliate link(s). Coop may be compensated for purchases made through these links._`;
      await msg.channel.send(affiliateMessage);
      console.log(`🔗 Converted ${linkConversions.length} ${linkConversions[0].type} link(s) from ${msg.author.tag}`);
      return;
    } catch (error) {
      console.error('Error converting affiliate link:', error);
      return;
    }
  }

  if (!trainerData[msg.author.id]) trainerData[msg.author.id] = { tp: 0, cc: 0 };
  trainerData[msg.author.id].tp += 1;

  const member = await msg.guild.members.fetch(msg.author.id);
  const rankName = getRank(trainerData[msg.author.id].tp);
  const hadRank = member.roles.cache.some((role) => role.name === rankName);
  await updateUserRole(member, rankName);
  // Only send rank up message if new rank is NOT "Novice Trainer"
  if (!hadRank && rankName !== 'Novice Trainer') {
    msg.channel.send(
      `🎉 Congratulations ${msg.author}! You've reached **${rankName}** rank with ${trainerData[msg.author.id].tp.toLocaleString()} TP!`
    );
  }
});

const gracefulShutdown = async () => {
  await saveDataToDiscord();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

import http from 'http';
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running!');
}).listen(PORT, () => console.log(`Server listening on port ${PORT}`));

client.login(process.env.BOT_TOKEN);