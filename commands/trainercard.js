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
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { rollForShiny } from "../shinyOdds.js";
import { spritePaths } from "../spriteconfig.js";

// ================================
// SAFE JSON LOADERS
// ================================
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);
const trainerSprites = JSON.parse(
  await fs.readFile(new URL("../trainerSprites.json", import.meta.url))
);
const allPokemon = Object.values(pokemonData);

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

function getRank(tp) {
  let rank = "Novice Trainer";
  for (const tier of rankTiers) if (tp >= tier.tp) rank = tier.roleName;
  return rank;
}

// ================================
// CANVAS RENDERER
// ================================
async function renderTrainerCard(userData, username) {
  const canvas = createCanvas(800, 450);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#f9f9f9";
  ctx.fillRect(0, 0, 800, 450);

  ctx.fillStyle = "#111";
  ctx.font = "bold 26px Sans";
  ctx.fillText(`${username}'s Trainer Card`, 40, 40);

  // Trainer sprite
  if (userData.displayedTrainer) {
    try {
      const trainerURL = `${spritePaths.trainers}${userData.displayedTrainer}`;
      const trainerImg = await loadImage(trainerURL);
      ctx.drawImage(trainerImg, 50, 100, 200, 250);
    } catch {
      ctx.fillText("Trainer Missing", 80, 250);
    }
  } else {
    ctx.fillText("No Trainer Selected", 70, 250);
  }

  // Pokémon grid (3x2)
  const gridX = 300,
    gridY = 100,
    size = 100,
    gap = 20;
  const displayed = userData.displayedPokemon?.slice(0, 6) || [];

  for (let i = 0; i < displayed.length; i++) {
    const id = displayed[i];
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = gridX + col * (size + gap);
    const y = gridY + row * (size + gap);

    try {
      const record = userData.pokemon?.[id] || userData.ownedPokemon?.[id];
      const isShiny = record?.shiny > 0;
      const base = isShiny ? spritePaths.shiny : spritePaths.pokemon;
      const img = await loadImage(`${base}${id}.gif`);
      ctx.drawImage(img, x, y, size, size);
    } catch {
      ctx.strokeStyle = "#aaa";
      ctx.strokeRect(x, y, size, size);
      ctx.fillStyle = "#888";
      ctx.fillText("?", x + 40, y + 60);
    }
  }

  // Stats
  const rank = getRank(userData.tp);
  const pokemonOwned = Object.keys(userData.pokemon || userData.ownedPokemon || {}).length;
  const shinyCount = Object.values(userData.pokemon || userData.ownedPokemon || {}).filter(
    (p) => p.shiny > 0
  ).length;
  const trainerCount = Object.keys(userData.trainers || {}).length;

  ctx.fillStyle = "#000";
  ctx.font = "18px Sans";
  ctx.fillText(`Rank: ${rank}`, 40, 380);
  ctx.fillText(`TP: ${userData.tp} | CC: ${userData.cc || 0}`, 40, 405);
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
const starterIDs = [
  1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501
];

async function starterSelection(interaction, user, trainerData, saveDataToDiscord) {
  const starters = allPokemon.filter((p) => starterIDs.includes(p.id));

  const embed = new EmbedBuilder()
    .setTitle("🌱 Choose Your Starter Pokémon")
    .setDescription(
      starters.map((p) => `**${p.name}** (${p.type?.join("/")})`).join("\n")
    )
    .setColor(0x43b581);

  const row = new ActionRowBuilder().addComponents(
    starters.slice(0, 5).map((p) =>
      new ButtonBuilder()
        .setCustomId(`starter_${p.id}`)
        .setLabel(p.name)
        .setStyle(ButtonStyle.Primary)
    )
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

  const collector = interaction.channel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30000
  });

  collector.on("collect", async (i) => {
    if (!i.customId.startsWith("starter_")) return;
    if (i.user.id !== interaction.user.id)
      return i.reply({ content: "Not your onboarding!", ephemeral: true });

    const starterId = parseInt(i.customId.split("_")[1]);
    const isShiny = rollForShiny();

    user.pokemon[starterId] = { normal: isShiny ? 0 : 1, shiny: isShiny ? 1 : 0 };
    user.displayedPokemon = [starterId];

    await i.update({
      content: `✅ You chose **${allPokemon.find((p) => p.id === starterId).name}**${
        isShiny ? " ✨" : ""
      } as your starter!`,
      embeds: [],
      components: []
    });

    await saveDataToDiscord(trainerData);
    collector.stop();

    await trainerSelection(i, user, trainerData, saveDataToDiscord);
  });

  collector.on("end", async () => {
    if (!interaction.replied) {
      await interaction.editReply({ content: "⏰ Starter selection expired.", components: [] });
    }
  });
}

async function trainerSelection(interaction, user, trainerData, saveDataToDiscord) {
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

  collector.on("collect", async (i) => {
    if (!i.customId.startsWith("trainer_")) return;
    if (i.user.id !== interaction.user.id)
      return i.reply({ content: "Not your onboarding!", ephemeral: true });

    const choice = i.customId === "trainer_youngster" ? "youngster-gen4.png" : "lass-gen4.png";
    user.trainers[choice] = true;
    user.displayedTrainer = choice;

    await saveDataToDiscord(trainerData);

    await i.update({
      content: `✅ You chose ${choice.replace(".png", "")} as your trainer!`,
      embeds: [],
      components: []
    });

    collector.stop();
    await showTrainerCard(i, user);
  });

  collector.on("end", async () => {
    await interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ================================
// MAIN CARD DISPLAY
// ================================
async function showTrainerCard(interaction, user) {
  const username = interaction.user.username;
  const canvas = await renderTrainerCard(user, username);
  const buffer = await canvas.encode("png");
  const attachment = new AttachmentBuilder(buffer, { name: "trainercard.png" });

  const rank = getRank(user.tp);
  const pokemonOwned = Object.keys(user.pokemon || {}).length;
  const shinyCount = Object.values(user.pokemon || {}).filter((p) => p.shiny > 0).length;
  const trainerCount = Object.keys(user.trainers || {}).length;

  const embed = new EmbedBuilder()
    .setTitle(`🧑 ${username}'s Trainer Card`)
    .setColor(0xffcb05)
    .setDescription(
      `🏆 **Rank:** ${rank}\n⭐ **TP:** ${user.tp}\n💰 **CC:** ${user.cc || 0}\n\n📊 **Progress:**\n• Pokémon Owned: ${pokemonOwned}\n• Shiny Pokémon: ${shinyCount} ✨\n• Trainers Recruited: ${trainerCount}`
    )
    .setImage("attachment://trainercard.png")
    .setFooter({ text: "Coop’s Collection • /trainercard" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("change_trainer").setLabel("Change Trainer").setEmoji("🧍").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("change_pokemon").setLabel("Change Pokémon").setEmoji("🧬").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("refresh_card").setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("share_public").setLabel("Share Public").setEmoji("🌐").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("close_card").setLabel("Close").setEmoji("❌").setStyle(ButtonStyle.Danger)
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

export async function execute(interaction, trainerData, saveDataToDiscord) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  let user = trainerData[userId];

  // Schema defaults
  if (!user) {
    user = trainerData[userId] = {
      id: userId,
      name: username,
      cc: 0,
      tp: 0,
      rank: "Novice Trainer",
      trainers: {},
      pokemon: {},
      displayedPokemon: [],
      displayedTrainer: null
    };
  }

  if (!user.displayedTrainer || Object.keys(user.pokemon || {}).length === 0) {
    return starterSelection(interaction, user, trainerData, saveDataToDiscord);
  }

  await showTrainerCard(interaction, user);
}

// ================================
// BUTTON HANDLER
// ================================
export async function handleTrainerCardButtons(interaction, trainerData) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const user = trainerData[userId];

  if (!user)
    return interaction.reply({
      content: "❌ Could not find your trainer data. Try /trainercard again.",
      ephemeral: true
    });

  switch (interaction.customId) {
    case "refresh_card": {
      const canvas = await renderTrainerCard(user, username);
      const buffer = await canvas.encode("png");
      const attachment = new AttachmentBuilder(buffer, { name: "trainercard.png" });
      const rank = getRank(user.tp);

      const embed = new EmbedBuilder()
        .setTitle(`🧑 ${username}'s Trainer Card`)
        .setColor(0xffcb05)
        .setDescription(
          `🏆 **Rank:** ${rank}\n⭐ **TP:** ${user.tp}\n💰 **CC:** ${user.cc || 0}`
        )
        .setImage("attachment://trainercard.png");

      return interaction.update({
        embeds: [embed],
        files: [attachment],
        components: interaction.message.components
      });
    }

    case "share_public": {
      const canvas = await renderTrainerCard(user, username);
      const buffer = await canvas.encode("png");
      const attachment = new AttachmentBuilder(buffer, { name: "trainercard.png" });
      const rank = getRank(user.tp);

      const publicEmbed = new EmbedBuilder()
        .setTitle(`🌐 ${username}'s Trainer Card`)
        .setColor(0x00ae86)
        .setDescription(
          `🏆 **Rank:** ${rank}\n⭐ **TP:** ${user.tp}\n💰 **CC:** ${user.cc || 0}`
        )
        .setImage("attachment://trainercard.png")
        .setFooter({ text: "Shared via Coop’s Collection Bot" });

      await interaction.reply({ content: "✅ Shared publicly!", ephemeral: true });
      await interaction.channel.send({ embeds: [publicEmbed], files: [attachment] });
      break;
    }

    case "change_trainer":
      return interaction.reply({
        content: "Feature coming soon: choose from your owned trainer sprites.",
        ephemeral: true
      });

    case "change_pokemon":
      return interaction.reply({
        content: "Feature coming soon: choose which Pokémon appear on your card.",
        ephemeral: true
      });

    case "close_card":
      await interaction.message.delete().catch(() => {});
      break;

    default:
      await interaction.reply({ content: "Unknown button action.", ephemeral: true });
  }
}
