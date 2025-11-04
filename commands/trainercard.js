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
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { rollForShiny } from "../shinyOdds.js";
import { spritePaths } from "../spriteconfig.js";
import { loadPokemonData, loadTrainerSprites, getAllPokemon } from "../utils/dataLoader.js";
import { getRank, getRankTiers } from "../utils/rankSystem.js";
import { ensureUserData } from "../utils/trainerDataHelper.js";

// ================================
// TYPE MAP
// ================================
const typeMap = {
  1: "Normal", 2: "Fighting", 3: "Flying", 4: "Poison", 5: "Ground",
  6: "Rock", 7: "Bug", 8: "Ghost", 9: "Steel", 10: "Fire",
  11: "Water", 12: "Grass", 13: "Electric", 14: "Psychic",
  15: "Ice", 16: "Dragon", 17: "Dark"
};

// ================================
// CANVAS RENDERER
// ================================
async function renderTrainerCard(userData, username, avatarURL) {
  const canvas = createCanvas(900, 500);
  const ctx = canvas.getContext("2d");
  
  // Load data using cached helpers
  const allPokemon = await getAllPokemon();
  const pokemonData = await loadPokemonData();
  const rankTiers = getRankTiers();

  // === BACKGROUND ===
  const gradient = ctx.createLinearGradient(0, 0, 0, 500);
  gradient.addColorStop(0, "#fafafa");
  gradient.addColorStop(1, "#e8e8e8");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 900, 500);

  // === HEADER BAR ===
  ctx.fillStyle = "#222";
  ctx.fillRect(0, 0, 900, 60);
  ctx.font = "bold 28px Sans";
  ctx.fillStyle = "#ffcb05";
  ctx.fillText(`${username}'s Trainer Card`, 30, 40);

  // === USER AVATAR (draw AFTER header) ===
  if (avatarURL) {
    try {
      const avatarImg = await loadImage(avatarURL);
      const size = 64;
      const x = 900 - size - 30;
      const y = -13;
      ctx.lineWidth = 4;

      ctx.save();
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatarImg, x, y, size, size);
      ctx.restore();

      // Outline ring
      ctx.strokeStyle = "#ffcb05";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2 + 1, 0, Math.PI * 2);
      ctx.stroke();
    } catch (err) {
      console.warn("⚠️ Avatar load failed:", err.message);
    }
  }

  // === TRAINER SPRITE ===
  const trainerX = 60, trainerY = 120;
  if (userData.displayedTrainer) {
    try {
      const trainerURL = `${spritePaths.trainers}${userData.displayedTrainer}`;
      const trainerImg = await loadImage(trainerURL);
      const scale = Math.min(200 / trainerImg.width, 250 / trainerImg.height);
      const w = trainerImg.width * scale;
      const h = trainerImg.height * scale;
      ctx.drawImage(trainerImg, trainerX + (200 - w) / 2, trainerY, w, h);
    } catch {
      ctx.fillStyle = "#888";
      ctx.fillText("Trainer Missing", trainerX, trainerY + 120);
    }
  } else {
    ctx.fillStyle = "#888";
    ctx.fillText("No Trainer Selected", trainerX, trainerY + 120);
  }

  // === POKÉMON GRID ===
  const gridStartX = 330;
  const gridStartY = 140;
  const slot = 110;
  const gap = 15;
  const displayed = userData.displayedPokemon?.slice(0, 6) || [];

  for (let i = 0; i < 6; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = gridStartX + col * (slot + gap);
    const y = gridStartY + row * (slot + gap);
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, slot, slot);

    const id = displayed[i];
    if (!id) continue;

    try {
      const record = userData.pokemon?.[id] || userData.ownedPokemon?.[id];
      const isShiny = record?.shiny > 0;
      const base = isShiny ? spritePaths.shiny : spritePaths.pokemon;
      const img = await loadImage(`${base}${id}.gif`);

      const scale = Math.min(slot * 0.9 / img.width, slot * 0.9 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const offsetX = (slot - w) / 2;
      const offsetY = (slot - h) / 2;
      ctx.drawImage(img, x + offsetX, y + offsetY, w, h);
    } catch {
      ctx.fillStyle = "#aaa";
      ctx.font = "bold 20px Sans";
      ctx.fillText("?", x + slot / 2 - 6, y + slot / 2 + 8);
    }
  }

  // === STATS BOX ===
  const rank = getRank(userData.tp);
  const pokemonOwned = Object.keys(userData.pokemon || {}).length;
  const shinyCount = Object.values(userData.pokemon || {}).filter((p) => p.shiny > 0).length;
  const trainerCount = Object.keys(userData.trainers || {}).length;

  const statsX = 60;
  const statsY = 410;

  ctx.fillStyle = "#333";
  ctx.font = "bold 20px Sans";
  ctx.fillText(`Rank: ${rank}`, statsX, statsY);
  ctx.font = "18px Sans";
  ctx.fillText(`TP: ${userData.tp} | CC: ${userData.cc || 0}`, statsX, statsY + 25);
  ctx.fillText(
    `Pokémon: ${pokemonOwned} | Shiny: ${shinyCount} | Trainers: ${trainerCount}`,
    statsX,
    statsY + 50
  );

  // === BORDER ===
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, 900, 500);

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

  // Group starters by primary type
  const grouped = {};
  for (const p of starters) {
    const primaryType = p.types?.[0];
    if (!grouped[primaryType]) grouped[primaryType] = [];
    grouped[primaryType].push(p);
  }

  // Sort type groups (Grass, Fire, Water order)
  const typeOrder = [12, 10, 11];
  const sortedTypes = Object.keys(grouped)
    .map(Number)
    .sort((a, b) => (typeOrder.indexOf(a) + 1 || 99) - (typeOrder.indexOf(b) + 1 || 99));

  // Utility to build a page embed + buttons
  const buildPage = (index) => {
    const typeId = sortedTypes[index];
    const typeName = typeMap[typeId];
    const typeStarters = grouped[typeId];
    const spriteUrl = `${spritePaths.types}${typeId}.png`;

    const embed = new EmbedBuilder()
      .setTitle(`🌱 Choose Your Starter Pokémon`)
      .setDescription(
        `**Type:** ${typeName}\n\n${typeStarters
          .map((p) => {
            const types = p.types?.map((id) => typeMap[id]).join("/") || "Unknown";
            return `• **${p.name}** (${types})`;
          })
          .join("\n")}`
      )
      .setColor(0x43b581)
      .setThumbnail(spriteUrl)
      .setFooter({
        text: `Page ${index + 1} / ${sortedTypes.length} (${typeName} starters)`
      });

    // Create buttons for each Pokémon (max 5 per row)
    const pokemonRow = new ActionRowBuilder().addComponents(
      typeStarters.map((p) =>
        new ButtonBuilder()
          .setCustomId(`starter_${p.id}`)
          .setLabel(p.name)
          .setStyle(ButtonStyle.Primary)
      )
    );

    // Navigation row
    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("prev_page")
        .setEmoji("⬅️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index === 0),
      new ButtonBuilder()
        .setCustomId("next_page")
        .setEmoji("➡️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index === sortedTypes.length - 1)
    );

    return { embed, components: [pokemonRow, navRow] };
  };

  // Start with first page (Grass)
  let pageIndex = 0;
  const { embed, components } = buildPage(pageIndex);
  // Send the starter selection embed safely
if (interaction.deferred || interaction.replied) {
  await interaction.followUp({ embeds: [embed], components, ephemeral: true });
} else {
  await interaction.reply({ embeds: [embed], components, ephemeral: true });
}

  const collector = interaction.channel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000 // 1 min before timeout
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id)
      return i.reply({ content: "Not your onboarding!", ephemeral: true });

    // Navigation buttons
    if (i.customId === "next_page" || i.customId === "prev_page") {
      pageIndex += i.customId === "next_page" ? 1 : -1;
      const { embed: newEmbed, components: newRows } = buildPage(pageIndex);
      await i.update({ embeds: [newEmbed], components: newRows });
      return;
    }

    // Starter selection
    if (i.customId.startsWith("starter_")) {
      const starterId = parseInt(i.customId.split("_")[1]);
      const isShiny = rollForShiny();

      user.pokemon[starterId] = { normal: isShiny ? 0 : 1, shiny: isShiny ? 1 : 0 };
      user.displayedPokemon = [starterId];

      await i.update({
        content: `✅ You chose **${
          allPokemon.find((p) => p.id === starterId).name
        }**${isShiny ? " ✨" : ""} as your starter!`,
        embeds: [],
        components: []
      });

      await saveDataToDiscord(trainerData);
      collector.stop();

      await trainerSelection(i, user, trainerData, saveDataToDiscord);
    }
  });

  collector.on("end", async () => {
    try {
      await interaction.editReply({ components: [] });
    } catch {}
  });
}



async function trainerSelection(interaction, user, trainerData, saveDataToDiscord) {
  const trainers = [
    {
      id: "youngster-gen4.png",
      name: "Youngster 👦",
      label: "Youngster",
      description: "A spirited young Pokémon Trainer full of energy.",
      color: 0x43b581
    },
    {
      id: "lass-gen4.png",
      name: "Lass 👧",
      label: "Lass",
      description: "A cheerful and stylish Trainer who loves cute Pokémon.",
      color: 0xff70a6
    }
  ];

  let index = 0;

  const renderTrainerEmbed = (page) => {
    const t = trainers[page];
    return new EmbedBuilder()
      .setTitle(`🧍 Choose Your Trainer Sprite`)
      .setDescription(`${t.description}\n\n**Trainer:** ${t.name}`)
      .setColor(t.color)
      .setImage(`${spritePaths.trainers}${t.id}`)
      .setFooter({ text: `Page ${page + 1}/${trainers.length}` });
  };

  const getButtons = (page) => {
    const buttons = [];

    // ⬅️ Back button
    if (page > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId("prev_trainer")
          .setLabel("⬅️ Back")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    // ➡️ Next button
    if (page < trainers.length - 1) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId("next_trainer")
          .setLabel("Next ➡️")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    // ✅ Confirm button
    buttons.push(
      new ButtonBuilder()
        .setCustomId("confirm_trainer")
        .setLabel(`✅ Confirm ${trainers[page].label}`)
        .setStyle(ButtonStyle.Success)
    );

    return new ActionRowBuilder().addComponents(buttons);
  };

  const embed = renderTrainerEmbed(index);
  const row = getButtons(index);

 if (interaction.deferred || interaction.replied) {
  await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
} else {
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

  const collector = interaction.channel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id)
      return i.reply({ content: "This isn’t your selection!", ephemeral: true });

    switch (i.customId) {
      case "next_trainer":
        index = Math.min(index + 1, trainers.length - 1);
        break;
      case "prev_trainer":
        index = Math.max(index - 1, 0);
        break;
      case "confirm_trainer": {
        const choice = trainers[index];
        user.trainers[choice.id] = true;
        user.displayedTrainer = choice.id;
        await saveDataToDiscord(trainerData);

        await i.update({
          content: `✅ You chose **${choice.label}** as your Trainer!`,
          embeds: [],
          components: []
        });

        collector.stop("confirmed");
        return await showTrainerCard(i, user);
      }
    }

    // Refresh page
    const newEmbed = renderTrainerEmbed(index);
    const newRow = getButtons(index);
    await i.update({ embeds: [newEmbed], components: [newRow] });
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "confirmed") {
      await interaction.editReply({ components: [] }).catch(() => {});
    }
  });
}
// ================================
// MAIN CARD DISPLAY
// ================================
async function showTrainerCard(interaction, user) {
  // ✅ Safe user reference
  const username = interaction?.user?.username || user.name || "Trainer";
  const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });
const canvas = await renderTrainerCard(user, username, avatarURL);

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
    new ButtonBuilder()
      .setCustomId("change_trainer")
      .setLabel("Change Trainer")
      .setEmoji("🧍")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("change_pokemon")
      .setLabel("Change Pokémon")
      .setEmoji("🧬")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("refresh_card")
      .setLabel("Refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("share_public")
      .setLabel("Share Public")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Success)
  );

  // ✅ If the previous interaction was ephemeral, reply safely
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({
      embeds: [embed],
      files: [attachment],
      components: [row],
      ephemeral: true
    });
  } else {
    await interaction.reply({
      embeds: [embed],
      files: [attachment],
      components: [row],
      ephemeral: true
    });
  }
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
  const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });
  const canvas = await renderTrainerCard(user, username, avatarURL);
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
  const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });
  const canvas = await renderTrainerCard(user, username, avatarURL);
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
    .setFooter({
      text: `Shared by ${username} • Coop’s Collection Bot`,
      iconURL: interaction.user.displayAvatarURL()
    })
    .setTimestamp();

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({
      content: "✅ Shared publicly!",
      ephemeral: true
    });
  } else {
    await interaction.reply({
      content: "✅ Shared publicly!",
      ephemeral: true
    });
  }

  await interaction.channel.send({ embeds: [publicEmbed], files: [attachment] });
  break;
}


    case "change_trainer": {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "🧍 Feature coming soon: choose from your owned trainer sprites.",
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: "🧍 Feature coming soon: choose from your owned trainer sprites.",
          ephemeral: true
        });
      }
      break;
    }

    case "change_pokemon": {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "🧬 Feature coming soon: choose which Pokémon appear on your card.",
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: "🧬 Feature coming soon: choose which Pokémon appear on your card.",
          ephemeral: true
        });
      }
      break;
    }

    default:
      await interaction.reply({
        content: "❌ Unknown button action.",
        ephemeral: true
      });
      break;
  }
}
