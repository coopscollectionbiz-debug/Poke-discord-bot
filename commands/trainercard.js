// ================================
// /trainercard.js
// Coop's Collection Discord Bot
// ================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  ComponentType
} from "discord.js";
import fs from "fs/promises";
import fetch from "node-fetch";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { rollForShiny } from "../shinyOdds.js";

// ================================
// SAFE JSON LOADERS
// ================================
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);
const trainerSprites = JSON.parse(
  await fs.readFile(new URL("../trainerSprites.json", import.meta.url))
);

// ================================
// CONSTANTS
// ================================
const TRAINER_BASE_URL =
  "https://poke-discord-bot.onrender.com/public/sprites/trainers_2/";
const POKEMON_BASE_URL =
  "https://poke-discord-bot.onrender.com/public/sprites/pokemon/";
const TRAINER_DATA_PATH = new URL("../trainerData.json", import.meta.url);

// ================================
// RANK TIERS
// ================================
const rankTiers = [
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

// ================================
// HELPERS
// ================================
function getRank(tp) {
  let rank = "Novice Trainer";
  for (const tier of rankTiers) if (tp >= tier.tp) rank = tier.roleName;
  return rank;
}

async function saveTrainerData(trainerData) {
  try {
    await fs.writeFile(TRAINER_DATA_PATH, JSON.stringify(trainerData, null, 2));
    console.log("✅ Trainer data saved locally.");
  } catch (err) {
    console.error("❌ Error saving trainerData:", err);
  }
}

// ================================
// CANVAS RENDERER
// ================================
async function renderTrainerCard(userData, username) {
  const canvas = createCanvas(800, 450);
  const ctx = canvas.getContext("2d");

  // background
  ctx.fillStyle = "#f8f8f8";
  ctx.fillRect(0, 0, 800, 450);

  ctx.fillStyle = "#111";
  ctx.font = "bold 26px Sans";
  ctx.fillText(`${username}'s Trainer Card`, 40, 40);

  // trainer sprite
  if (userData.displayedTrainer) {
    try {
      const trainerURL = `${TRAINER_BASE_URL}${userData.displayedTrainer}`;
      const trainerImg = await loadImage(trainerURL);
      ctx.drawImage(trainerImg, 50, 100, 200, 250);
    } catch {
      ctx.fillText("Trainer Missing", 70, 250);
    }
  }

  // Pokémon grid (3x2)
  const gridX = 300, gridY = 100, size = 100, gap = 20;
  const displayed = userData.displayedPokemon?.slice(0, 6) || [];

  for (let i = 0; i < displayed.length; i++) {
    const id = displayed[i];
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = gridX + col * (size + gap);
    const y = gridY + row * (size + gap);

    try {
      const img = await loadImage(`${POKEMON_BASE_URL}${id}.gif`);
      ctx.drawImage(img, x, y, size, size);
    } catch {
      ctx.strokeStyle = "#999";
      ctx.strokeRect(x, y, size, size);
      ctx.fillText("?", x + 40, y + 60);
    }
  }

  // stats
  const rank = getRank(userData.tp);
  const pokemonOwned = Object.keys(userData.ownedPokemon || {}).length;
  const shinyCount = Object.values(userData.ownedPokemon || {}).filter(p => p.shiny).length;
  const trainerCount = Object.keys(userData.trainers || {}).length;

  ctx.fillStyle = "#000";
  ctx.font = "18px Sans";
  ctx.fillText(`Rank: ${rank}`, 40, 380);
  ctx.fillText(`TP: ${userData.tp} | Coins: ${userData.coins}`, 40, 405);
  ctx.fillText(
    `Pokémon: ${pokemonOwned} | Shiny: ${shinyCount} | Trainers: ${trainerCount}`,
    40,
    430
  );

  return canvas;
}

// ================================
// ONBOARDING HELPERS
// ================================
const starterIDs = [1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501];

async function starterSelection(interaction, user, trainerData) {
  const starters = pokemonData.filter(p => starterIDs.includes(p.id));

  const embed = new EmbedBuilder()
    .setTitle("🌱 Choose Your Starter Pokémon")
    .setDescription(
      starters.map(p => `**${p.name}** (${p.type.join("/")})`).join("\n")
    )
    .setColor(0x43b581);

  const buttons = starters.slice(0, 5).map(p =>
    new ButtonBuilder()
      .setCustomId(`starter_${p.id}`)
      .setLabel(p.name)
      .setStyle(ButtonStyle.Primary)
  );

  const row = new ActionRowBuilder().addComponents(buttons);
  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true
  });

  const collector = interaction.channel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30000
  });

  collector.on("collect", async i => {
    if (!i.customId.startsWith("starter_")) return;
    if (i.user.id !== interaction.user.id)
      return i.reply({ content: "Not your onboarding!", ephemeral: true });

    const starterId = parseInt(i.customId.split("_")[1]);
    const isShiny = rollForShiny();
    user.ownedPokemon[starterId] = { shiny: isShiny, count: 1 };
    user.displayedPokemon = [starterId];

    await i.update({
      content: `✅ You chose **${pokemonData.find(p => p.id === starterId).name}** ${
        isShiny ? "✨" : ""
      } as your starter!`,
      embeds: [],
      components: []
    });

    await saveTrainerData(trainerData);
    await trainerSelection(i, user, trainerData);
  });
}

async function trainerSelection(interaction, user, trainerData) {
  const embed = new EmbedBuilder()
    .setTitle("🧍 Choose Your Trainer Sprite")
    .setDescription("Pick your trainer appearance!")
    .setColor(0x5865f2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("trainer_youngster")
      .setLabel("Youngster 👦")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("trainer_lass")
      .setLabel("Lass 👧")
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });

  const collector = interaction.channel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30000
  });

  collector.on("collect", async i => {
    if (!i.customId.startsWith("trainer_")) return;
    if (i.user.id !== interaction.user.id)
      return i.reply({ content: "Not your onboarding!", ephemeral: true });

    const choice = i.customId === "trainer_youngster" ? "youngster-gen4.png" : "lass-gen4.png";
    user.trainers[choice] = { count: 1 };
    user.displayedTrainer = choice;

    await saveTrainerData(trainerData);

    await i.update({
      content: `✅ You chose ${choice.replace(".png", "")} as your trainer!`,
      embeds: [],
      components: []
    });

    await showTrainerCard(i, user, trainerData);
  });
}

// ================================
// MAIN CARD DISPLAY
// ================================
async function showTrainerCard(interaction, user, trainerData) {
  const username = interaction.user.username;
  const canvas = await renderTrainerCard(user, username);
  const buffer = await canvas.encode("png");
  const attachment = new AttachmentBuilder(buffer, { name: "trainercard.png" });

  const rank = getRank(user.tp);
  const pokemonOwned = Object.keys(user.ownedPokemon || {}).length;
  const shinyCount = Object.values(user.ownedPokemon || {}).filter(p => p.shiny).length;
  const trainerCount = Object.keys(user.trainers || {}).length;

  const embed = new EmbedBuilder()
    .setTitle(`🧑 ${username}'s Trainer Card`)
    .setColor(0xffcb05)
    .setDescription(
      `🏆 **Rank:** ${rank}\n⭐ **TP:** ${user.tp}\n💰 **Coins:** ${user.coins}\n\n📊 **Progress:**\n• Pokémon Owned: ${pokemonOwned}\n• Shiny Pokémon: ${shinyCount} ✨\n• Trainers Recruited: ${trainerCount}`
    )
    .setImage("attachment://trainercard.png")
    .setFooter({
      text: "Coop’s Collection • View your card anytime with /trainercard"
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("change_trainer")
      .setLabel("Change Trainer Sprite")
      .setEmoji("🧍")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("change_pokemon")
      .setLabel("Change Displayed Pokémon")
      .setEmoji("🧬")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("refresh_card")
      .setLabel("Refresh Card")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("share_public")
      .setLabel("Share Publicly")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("close_card")
      .setLabel("Close")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.followUp({
    embeds: [embed],
    files: [attachment],
    components: [row],
    ephemeral: true
  });
}

// ================================
// SLASH COMMAND EXECUTION
// ================================
export const data = new SlashCommandBuilder()
  .setName("trainercard")
  .setDescription("View or create your Trainer Card!");

export async function execute(interaction, trainerData) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  let user = trainerData[userId];

  // initialize schema
  if (!user) {
    user = trainerData[userId] = {
      id: userId,
      name: username,
      coins: 0,
      tp: 0,
      rank: "Novice Trainer",
      trainers: {},
      ownedPokemon: {},
      displayedPokemon: [],
      displayedTrainer: null
    };
  }

  // onboarding condition
  if (!user.displayedTrainer || Object.keys(user.ownedPokemon || {}).length === 0)
    return starterSelection(interaction, user, trainerData);

  // show trainer card
  await showTrainerCard(interaction, user, trainerData);
}
