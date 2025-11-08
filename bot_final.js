// ==========================================================
// 🤖 Coop’s Collection Discord Bot — FULL VERSION (Part 1 / 2)
// ==========================================================
// Includes:
//  • Rank Buffs & Weighted Acquisition
//  • Shiny Pokémon Logic (applies to all acquisitions)
//  • Epic+ & Shiny Broadcast via utils/rareSightings.js
//  • Passive Message / Reaction Rewards
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
import { postRareSightings } from "./utils/rareSightings.js";

// ==========================================================
// ⚙️ Global Constants
// ==========================================================
const TRAINERDATA_PATH = "./trainerData.json";
const AUTOSAVE_INTERVAL = 1000 * 60 * 3;      // 3 minutes
const POKEBEACH_CHECK_INTERVAL = 1000 * 60 * 120; // 2 hours
const PORT = process.env.PORT || 10000;
const MESSAGE_TP_GAIN = 2;
const MESSAGE_CC_CHANCE = 0.03;
const MESSAGE_COOLDOWN = 5000;
const MESSAGE_REWARD_CHANCE = 0.03;
const REACTION_REWARD_CHANCE = 0.03;
const REWARD_COOLDOWN = 5000;
const RARE_TIERS = ["epic", "legendary", "mythic"];

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
        (m) =>
          m.attachments.size > 0 &&
          m.attachments.first().name.startsWith("trainerData")
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
// 🧱 Rank Role Updater
// ==========================================================
async function updateUserRole(member, tp) {
  const targetRole = getRank(tp);
  if (!targetRole) return;
  const role = member.guild.roles.cache.find((r) => r.name === targetRole);
  if (!role || member.roles.cache.has(role.id)) return;

  for (const t of RANK_TIERS) {
    const old = member.guild.roles.cache.find((r) => r.name === t.roleName);
    if (old && member.roles.cache.has(old.id)) await member.roles.remove(old).catch(() => {});
  }
  await member.roles.add(role).catch(() => {});
}

// ==========================================================
// 🎁 Random Reward System (Message / Reaction / Daily Shared)
// ==========================================================
import { broadcastReward } from "./utils/broadcastReward.js"; // ✅ Add at top of file if missing

async function tryGiveRandomReward(userObj, interactionUser, msgOrInteraction) {
  const now = Date.now();
  const last = rewardCooldowns.get(interactionUser.id) || 0;
  if (now - last < REWARD_COOLDOWN) return;
  if (Math.random() > MESSAGE_REWARD_CHANCE) return;
  rewardCooldowns.set(interactionUser.id, now);

  // Load data pools
  const allPokemon = await getAllPokemon();
  const allTrainers = await getAllTrainers();

  // Roll Pokémon or Trainer
  let reward, isShiny = false, isPokemon = false;
  if (Math.random() < 0.5) {
    isPokemon = true;
    reward = selectRandomPokemonForUser(allPokemon, userObj);
    isShiny = rollForShiny(userObj.tp || 0);
    userObj.pokemon ??= {};
    userObj.pokemon[reward.id] ??= { normal: 0, shiny: 0 };
    isShiny
      ? userObj.pokemon[reward.id].shiny++
      : userObj.pokemon[reward.id].normal++;
  } else {
  isPokemon = false;
  reward = selectRandomTrainerForUser(allTrainers, userObj);
  userObj.trainers ??= {};
  userObj.trainers[reward.id] = (userObj.trainers[reward.id] || 0) + 1;

  // 🧍 Equip Trainer Prompt (Global Integration)
  try {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = await import("discord.js");

    await msgOrInteraction.followUp({
      content: `🎉 You obtained **${reward.name}!**\nWould you like to equip them as your displayed Trainer?`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`equip_${reward.id}`)
            .setLabel("Equip Trainer")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("skip_equip")
            .setLabel("Skip")
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
      ephemeral: true,
    });

    const collector = msgOrInteraction.channel.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 15000,
      filter: (i) => i.user.id === interactionUser.id,
    });

    collector.on("collect", async (i) => {
      if (i.customId === `equip_${reward.id}`) {
        userObj.displayedTrainer = reward.id;
        await saveDataToDiscord(trainerData);
        await i.update({
          content: `✅ **${reward.name}** equipped as your displayed Trainer!`,
          components: [],
        });
      } else if (i.customId === "skip_equip") {
        await i.update({
          content: `⏭️ Trainer kept in your collection.`,
          components: [],
        });
      }
    });
  } catch (err) {
    console.warn("⚠️ Equip prompt failed:", err.message);
  }
}


  await saveDataToDiscord(trainerData);

  // 🎨 Embed for ephemeral/self-view
  const tier = (reward.tier || reward.rarity || "common").toLowerCase();
  const emoji = rarityEmojis[tier] || "⚬";
  const title = isPokemon
    ? `${emoji} ${isShiny ? "✨ " : ""}${reward.name}`
    : `${emoji} ${reward.name}`;
  const desc = isPokemon
    ? `You caught a ${isShiny ? "**shiny** " : ""}**${reward.name}** (${emoji} ${reward.tier || reward.rarity})!`
    : `You encountered **${reward.name}** (${emoji} ${reward.tier || reward.rarity})!`;

  const spriteUrl = isPokemon
    ? isShiny
      ? `${spritePaths.shiny}${reward.id}.gif`
      : `${spritePaths.pokemon}${reward.id}.gif`
    : `${spritePaths.trainers}${reward.id}.png`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setThumbnail(spriteUrl)
    .setFooter({ text: `Tier: ${emoji} ${reward.tier || reward.rarity}` });

  const isRare = RARE_TIERS.includes(tier) || isShiny;

  // 🪩 Send Ephemeral Result to Player
  try {
    if (msgOrInteraction?.reply) {
      await msgOrInteraction.reply({
        content: isRare
          ? `🎉 <@${interactionUser.id}> found a **${isShiny ? "✨ shiny " : ""}${reward.name}**!`
          : null,
        embeds: [embed],
        ephemeral: !isRare,
      });
    } else if (msgOrInteraction?.channel) {
      if (isRare) {
        await msgOrInteraction.channel.send({
          content: `🎉 <@${interactionUser.id}> found a **${isShiny ? "✨ shiny " : ""}${reward.name}**!`,
          embeds: [embed],
        });
      } else {
        await msgOrInteraction.reply?.({ embeds: [embed], ephemeral: true }).catch(() =>
          msgOrInteraction.channel.send({ embeds: [embed], ephemeral: true })
        );
      }
    }
  } catch (err) {
    console.warn("⚠️ Reward embed failed:", err.message);
  }

  // 🌟 Public Broadcast (Random Encounters Only)
  try {
    await broadcastReward(client, {
      user: interactionUser,
      type: isPokemon ? "pokemon" : "trainer",
      item: reward,
      shiny: isShiny,
      source: "random encounter", // marks it as random to skip /daily & /quest
    });
  } catch (err) {
    console.error("❌ broadcastReward failed:", err.message);
  }

  // 🌟 Rare Sightings Broadcast (still separate system)
  try {
    await postRareSightings(client, reward, interactionUser, isPokemon, isShiny);
  } catch (err) {
    console.error("❌ Rare Sightings broadcast failed:", err.message);
  }
}

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
// ⚡ INTERACTION HANDLER (Slash Commands + Buttons)
// ==========================================================
import { spritePaths, rarityEmojis } from "./spriteconfig.js"; // ensure both imported at top

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

      // 🧍 Equip Trainer Buttons (Global)
      if (interaction.customId.startsWith("equip_")) {
        const trainerId = interaction.customId.replace("equip_", "");
        const user = trainerData[interaction.user.id];

        if (!user) {
          await safeReply(interaction, {
            content: "⚠️ Could not find your trainer data.",
            ephemeral: true,
          });
          return;
        }

        // ✅ Assign the trainer
        user.displayedTrainer = trainerId;

        // ✅ Get sprite + tier data
        const spriteUrl = `${spritePaths.trainers}${trainerId}`;
        const trainerKey = trainerId.replace(".png", "");
        const tier = (trainerData?.tiers?.[trainerKey]?.tier || "common").toLowerCase();
        const emoji = rarityEmojis[tier] || "⚬";
        const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);

        try {
          await saveTrainerDataLocal(trainerData);
          await saveDataToDiscord(trainerData);

          const embed = new EmbedBuilder()
            .setTitle(`${emoji} ${tierName} Trainer Equipped!`)
            .setDescription(`✅ **${trainerKey}** is now your displayed Trainer!`)
            .setThumbnail(spriteUrl)
            .setColor(0x5865f2)
            .setFooter({ text: "You can view it anytime with /trainercard" })
            .setTimestamp();

          await interaction.update({
            content: "",
            embeds: [embed],
            components: [],
          });

          console.log(`🎓 ${interaction.user.username} equipped ${trainerId} (${tierName})`);
        } catch (err) {
          console.error("❌ Equip trainer failed:", err.message);
          await safeReply(interaction, {
            content: "❌ Failed to equip trainer. Please try again.",
            ephemeral: true,
          });
        }
        return;
      }

      // ⏭️ Skip equip button
      if (interaction.customId === "skip_equip") {
        await interaction.update({
          content: "⏭️ Trainer kept in your collection.",
          components: [],
          embeds: [],
        });
        return;
      }

      // 🪶 Fallback for anything unhandled
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
app.listen(PORT, () => console.log(`✅ Listening on port ${PORT}`));

// ==========================================================
// 🤖 BOT READY EVENT
// ==========================================================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    trainerData = await loadTrainerData();
  } catch (err) {
    console.error("❌ Trainer data load failed:", err.message);
    trainerData = {};
  }

  try {
    await loadCommands();
  } catch (err) {
    console.error("❌ Command registration failed:", err.message);
  }

  // Initial PokéBeach check
  try {
    await checkPokeBeach();
  } catch (err) {
    console.error("❌ PokéBeach initial check failed:", err.message);
  }

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
