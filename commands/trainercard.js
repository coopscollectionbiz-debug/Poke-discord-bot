// /trainercard.js
// Coop's Collection Discord Bot — Refactored with safeReply()
// ===========================================================

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
import { safeReply } from "../utils/safeReply.js";

// ===========================================================
// SLASH COMMAND
// ===========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("trainercard")
    .setDescription("View or create your Trainer Card!"),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    let user = trainerData[userId];

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

    if (!user.onboardingComplete) {
      return starterSelection(interaction, user, trainerData, saveDataToDiscord);
    }

    await showTrainerCard(interaction, user);
  }
};

// ===========================================================
// TYPE MAP
// ===========================================================
const typeMap = {
  1: "Normal", 2: "Fighting", 3: "Flying", 4: "Poison", 5: "Ground",
  6: "Rock", 7: "Bug", 8: "Ghost", 9: "Steel", 10: "Fire",
  11: "Water", 12: "Grass", 13: "Electric", 14: "Psychic",
  15: "Ice", 16: "Dragon", 17: "Dark"
};

// ===========================================================
// CANVAS RENDERER
// ===========================================================
async function renderTrainerCard(userData, username, avatarURL) {
  const canvas = createCanvas(900, 500);
  const ctx = canvas.getContext("2d");

  const allPokemon = await getAllPokemon();
  const rankTiers = getRankTiers();

  const gradient = ctx.createLinearGradient(0, 0, 0, 500);
  gradient.addColorStop(0, "#fafafa");
  gradient.addColorStop(1, "#e8e8e8");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 900, 500);

  ctx.fillStyle = "#222";
  ctx.fillRect(0, 0, 900, 60);
  ctx.font = "bold 28px Sans";
  ctx.fillStyle = "#ffcb05";
  ctx.fillText(`${username}'s Trainer Card`, 30, 40);

  if (avatarURL) {
    try {
      const avatarImg = await loadImage(avatarURL);
      const size = 64;
      const x = 900 - size - 30;
      const y = -13;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatarImg, x, y, size, size);
      ctx.restore();
      ctx.strokeStyle = "#ffcb05";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2 + 1, 0, Math.PI * 2);
      ctx.stroke();
    } catch (err) {
      console.warn("⚠️ Avatar load failed:", err.message);
    }
  }

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

  const rank = getRank(userData.tp);
  const pokemonOwned = Object.keys(userData.pokemon || {}).length;
  const shinyCount = Object.values(userData.pokemon || {}).filter((p) => p.shiny > 0).length;
  const trainerCount = Object.keys(userData.trainers || {}).length;

  ctx.fillStyle = "#333";
  ctx.font = "bold 20px Sans";
  ctx.fillText(`Rank: ${rank}`, 60, 410);
  ctx.font = "18px Sans";
  ctx.fillText(`TP: ${userData.tp} | CC: ${userData.cc || 0}`, 60, 435);
  ctx.fillText(`Pokémon: ${pokemonOwned} | Shiny: ${shinyCount} | Trainers: ${trainerCount}`, 60, 460);

  ctx.strokeStyle = "#333";
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, 900, 500);

  return canvas;
}

// ===========================================================
// ONBOARDING FLOW (refactored with safeReply)
// ===========================================================
async function starterSelection(interaction, user, trainerData, saveDataToDiscord) {
  try {
    const allPokemon = await getAllPokemon();
    const starters = allPokemon.filter(p => starterIDs.includes(p.id));
    const grouped = {};
    for (const p of starters) {
      const type = p.types?.[0];
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(p);
    }
    const typeOrder = [12, 10, 11];
    const sortedTypes = Object.keys(grouped).map(Number).sort(
      (a, b) => (typeOrder.indexOf(a) + 1 || 99) - (typeOrder.indexOf(b) + 1 || 99)
    );

    const buildPage = index => {
      const typeId = sortedTypes[index];
      const typeName = typeMap[typeId];
      const typeStarters = grouped[typeId];
      const spriteUrl = `${spritePaths.types}${typeId}.png`;
      const embed = new EmbedBuilder()
        .setTitle(`🌱 Choose Your Starter Pokémon`)
        .setDescription(
          `**Type:** ${typeName}\n\n${typeStarters.map(
            p => `• **${p.name}** (${p.types?.map(t => typeMap[t]).join("/")})`
          ).join("\n")}`
        )
        .setColor(0x43b581)
        .setThumbnail(spriteUrl)
        .setFooter({ text: `Page ${index + 1}/${sortedTypes.length}` });
      const row1 = new ActionRowBuilder().addComponents(
        typeStarters.map(p =>
          new ButtonBuilder()
            .setCustomId(`starter_${p.id}`)
            .setLabel(p.name)
            .setStyle(ButtonStyle.Primary)
        )
      );
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("prev_page").setEmoji("⬅️").setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId("next_page").setEmoji("➡️").setStyle(ButtonStyle.Secondary).setDisabled(index === sortedTypes.length - 1)
      );
      return { embed, components: [row1, row2] };
    };

    let page = 0;
    const { embed, components } = buildPage(page);
    await safeReply(interaction, { embeds: [embed], components, ephemeral: true });

    const collector = interaction.channel.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
    collector.on("collect", async i => {
      if (i.user.id !== interaction.user.id) return safeReply(i, { content: "Not your onboarding!", ephemeral: true });
      if (i.customId === "next_page" || i.customId === "prev_page") {
        page += i.customId === "next_page" ? 1 : -1;
        const { embed: e, components: c } = buildPage(page);
        return await safeReply(i, { embeds: [e], components: c, ephemeral: true });
      }
      if (i.customId.startsWith("starter_")) {
        const starterId = parseInt(i.customId.split("_")[1]);
        const isShiny = rollForShiny(user.tp);
        user.pokemon[starterId] = { normal: isShiny ? 0 : 1, shiny: isShiny ? 1 : 0 };
        user.displayedPokemon = [starterId];
        user.starterPokemon = starterId;
        await safeReply(i, { content: `✅ You chose **${allPokemon.find(p => p.id === starterId).name}**${isShiny ? " ✨" : ""} as your starter!`, ephemeral: true });
        await saveDataToDiscord(trainerData);
        collector.stop();
        return await trainerSelection(i, user, trainerData, saveDataToDiscord);
      }
    });
    collector.on("end", async () => {
      try { await safeReply(interaction, { components: [] }); } catch {}
    });
  } catch (e) {
    console.error("starterSelection failed:", e);
    await safeReply(interaction, { content: "❌ Failed to load starter Pokémon. Try again.", ephemeral: true });
  }
}

// ===========================================================
// TRAINER SELECTION (refactored with safeReply)
// ===========================================================
async function trainerSelection(interaction, user, trainerData, saveDataToDiscord) {
  const trainers = [
    { id: "youngster-gen4.png", name: "Youngster 👦", label: "Youngster", description: "A spirited young Pokémon Trainer full of energy.", color: 0x43b581 },
    { id: "lass-gen4.png", name: "Lass 👧", label: "Lass", description: "A cheerful and stylish Trainer who loves cute Pokémon.", color: 0xff70a6 }
  ];

  let index = 0;

  const renderTrainerEmbed = page => {
    const t = trainers[page];
    return new EmbedBuilder()
      .setTitle("🧍 Choose Your Trainer Sprite")
      .setDescription(`${t.description}\n\n**Trainer:** ${t.name}`)
      .setColor(t.color)
      .setImage(`${spritePaths.trainers}${t.id}`)
      .setFooter({ text: `Page ${page + 1}/${trainers.length}` });
  };

  const getButtons = page => {
    const buttons = [];
    if (page > 0) buttons.push(new ButtonBuilder().setCustomId("prev_trainer").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary));
    if (page < trainers.length - 1) buttons.push(new ButtonBuilder().setCustomId("next_trainer").setLabel("Next ➡️").setStyle(ButtonStyle.Secondary));
    buttons.push(new ButtonBuilder().setCustomId("confirm_trainer").setLabel(`✅ Confirm ${trainers[page].label}`).setStyle(ButtonStyle.Success));
    return new ActionRowBuilder().addComponents(buttons);
  };

  const embed = renderTrainerEmbed(index);
  const row = getButtons(index);
  await safeReply(interaction, { embeds: [embed], components: [row], ephemeral: true });

  const collector = interaction.channel.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
  collector.on("collect", async i => {
    if (i.user.id !== interaction.user.id) return safeReply(i, { content: "This isn’t your selection!", ephemeral: true });

    switch (i.customId) {
      case "next_trainer": index = Math.min(index + 1, trainers.length - 1); break;
      case "prev_trainer": index = Math.max(index - 1, 0); break;
      case "confirm_trainer": {
        const choice = trainers[index];
        user.trainers[choice.id] = 1;
        user.displayedTrainer = choice.id;
        user.onboardingComplete = true;
        user.onboardingDate = Date.now();
        await saveDataToDiscord(trainerData);
        await safeReply(i, { content: `✅ You chose **${choice.label}** as your Trainer!`, ephemeral: true });
        collector.stop("confirmed");
        return await showTrainerCard(i, user);
      }
    }

    const newEmbed = renderTrainerEmbed(index);
    const newRow = getButtons(index);
    await safeReply(i, { embeds: [newEmbed], components: [newRow], ephemeral: true });
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "confirmed") await safeReply(interaction, { components: [] });
  });
}

// ===========================================================
// MAIN CARD DISPLAY
// ===========================================================
async function showTrainerCard(interaction, user) {
  const username = interaction?.user?.username || user.name || "Trainer";
  const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });
  const canvas = await renderTrainerCard(user, username, avatarURL);
  const buffer = await canvas.encode("png");
  const attachment = new AttachmentBuilder(buffer, { name: "trainercard.png" });

  const rank = getRank(user.tp);
  const pokemonOwned = Object.keys(user.pokemon || {}).length;
  const shinyCount = Object.values(user.pokemon || {}).filter(p => p.shiny > 0).length;
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
    new ButtonBuilder().setCustomId("share_public").setLabel("Share Public").setEmoji("🌐").setStyle(ButtonStyle.Success)
  );

  await safeReply(interaction, { embeds: [embed], files: [attachment], components: [row], ephemeral: true });
}

// ===========================================================
// CHANGE TRAINER HANDLER
// ===========================================================
async function handleChangeTrainer(interaction, user, trainerData, saveDataToDiscord) {
  const ownedTrainers = Object.keys(user.trainers || {}).filter(t => user.trainers[t]);
  if (ownedTrainers.length === 0)
    return safeReply(interaction, { content: "❌ You don't have any trainers yet!", ephemeral: true });

  const trainersPerPage = 5;
  const pages = [];
  for (let i = 0; i < ownedTrainers.length; i += trainersPerPage)
    pages.push(ownedTrainers.slice(i, i + trainersPerPage));
  let pageIndex = 0;

  const buildPage = index => {
    const pageTrainers = pages[index];
    const embed = new EmbedBuilder()
      .setTitle("🧍 Select Your Displayed Trainer")
      .setDescription(
        `Choose which trainer appears on your card.\n\n${pageTrainers
          .map(t => `${t === user.displayedTrainer ? "✅" : "•"} **${t}**`)
          .join("\n")}`
      )
      .setColor(0x3498db)
      .setFooter({ text: `Page ${index + 1}/${pages.length}` });

    const trainerButtons = pageTrainers.map(t =>
      new ButtonBuilder()
        .setCustomId(`select_trainer_${t}`)
        .setLabel(t.replace(/\.png$/, "").substring(0, 80))
        .setStyle(t === user.displayedTrainer ? ButtonStyle.Success : ButtonStyle.Primary)
    );

    const rows = [new ActionRowBuilder().addComponents(trainerButtons)];
    if (pages.length > 1) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("trainer_prev_page").setLabel("⬅️").setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
          new ButtonBuilder().setCustomId("trainer_next_page").setLabel("➡️").setStyle(ButtonStyle.Secondary).setDisabled(index === pages.length - 1)
        )
      );
    }
    return { embed, components: rows };
  };

  const { embed, components } = buildPage(pageIndex);
  await safeReply(interaction, { embeds: [embed], components, ephemeral: true });

  const collector = interaction.channel.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    componentType: ComponentType.Button,
    time: 60000
  });

  collector.on("collect", async i => {
    if (i.customId === "trainer_next_page") pageIndex++;
    else if (i.customId === "trainer_prev_page") pageIndex--;
    else if (i.customId.startsWith("select_trainer_")) {
      const selectedTrainer = i.customId.replace("select_trainer_", "");
      user.displayedTrainer = selectedTrainer;
      await saveDataToDiscord(trainerData);
      await safeReply(i, { content: `✅ Trainer changed to **${selectedTrainer}**!`, ephemeral: true });
      return collector.stop();
    }
    const { embed: e, components: c } = buildPage(pageIndex);
    await safeReply(i, { embeds: [e], components: c, ephemeral: true });
  });

  collector.on("end", async () =>
    safeReply(interaction, { content: "⏱️ Selection timed out.", ephemeral: true })
  );
}

// ===========================================================
// CHANGE POKEMON HANDLER
// ===========================================================
async function handleChangePokemon(interaction, user, trainerData, saveDataToDiscord) {
  const ownedPokemon = Object.keys(user.pokemon || {}).filter(id => {
    const p = user.pokemon[id];
    return (p?.normal > 0 || p?.shiny > 0) || (typeof p === "number" && p > 0);
  });
  if (ownedPokemon.length === 0)
    return safeReply(interaction, { content: "❌ You don't have any Pokémon yet!", ephemeral: true });

  const allPokemon = await getAllPokemon();
  const pokemonPerPage = 12;
  const pages = [];
  for (let i = 0; i < ownedPokemon.length; i += pokemonPerPage)
    pages.push(ownedPokemon.slice(i, i + pokemonPerPage));

  let pageIndex = 0;
  let selectedPokemon = [...(user.displayedPokemon || [])].slice(0, 6);

  const buildPage = index => {
    const pagePokemon = pages[index];
    const embed = new EmbedBuilder()
      .setTitle("🧬 Select Your Displayed Pokémon")
      .setDescription(
        `Choose up to 6 Pokémon.\n\nSelected (${selectedPokemon.length}/6): ${
          selectedPokemon.map(id => allPokemon.find(p => p.id == id)?.name).join(", ") || "None"
        }`
      )
      .setColor(0xe91e63)
      .setFooter({ text: `Page ${index + 1}/${pages.length}` });

    const buttons = pagePokemon.map(id => {
      const name = allPokemon.find(p => p.id == id)?.name || `#${id}`;
      const isSelected = selectedPokemon.includes(id);
      return new ButtonBuilder()
        .setCustomId(`toggle_pokemon_${id}`)
        .setLabel(name.substring(0, 80))
        .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Primary);
    });

    const rows = [];
    for (let i = 0; i < buttons.length; i += 5)
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("pokemon_clear").setLabel("Clear").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("pokemon_save").setLabel("💾 Save").setStyle(ButtonStyle.Success)
      )
    );
    return { embed, components: rows };
  };

  const { embed, components } = buildPage(pageIndex);
  await safeReply(interaction, { embeds: [embed], components, ephemeral: true });

  const collector = interaction.channel.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    componentType: ComponentType.Button,
    time: 120000
  });

  collector.on("collect", async i => {
    if (i.customId === "pokemon_next_page") pageIndex++;
    else if (i.customId === "pokemon_prev_page") pageIndex--;
    else if (i.customId.startsWith("toggle_pokemon_")) {
      const id = i.customId.replace("toggle_pokemon_", "");
      if (selectedPokemon.includes(id)) selectedPokemon = selectedPokemon.filter(p => p !== id);
      else if (selectedPokemon.length < 6) selectedPokemon.push(id);
      else return safeReply(i, { content: "⚠️ Max 6 Pokémon.", ephemeral: true });
    } else if (i.customId === "pokemon_clear") selectedPokemon = [];
    else if (i.customId === "pokemon_save") {
      user.displayedPokemon = selectedPokemon;
      await saveDataToDiscord(trainerData);
      await safeReply(i, { content: "✅ Pokémon updated!", ephemeral: true });
      return collector.stop();
    }
    const { embed: e, components: c } = buildPage(pageIndex);
    await safeReply(i, { embeds: [e], components: c, ephemeral: true });
  });

  collector.on("end", async () => safeReply(interaction, { content: "⏱️ Selection timed out.", ephemeral: true }));
}

// ===========================================================
// BUTTON HANDLER
// ===========================================================
export async function handleTrainerCardButtons(interaction, trainerData, saveDataToDiscord) {
  const userId = interaction.user.id;
  const user = trainerData[userId];
  const username = interaction.user.username;

  if (!user)
    return safeReply(interaction, { content: "❌ Could not find your trainer data.", ephemeral: true });

  switch (interaction.customId) {
    case "refresh_card": {
      const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });
      const canvas = await renderTrainerCard(user, username, avatarURL);
      const buffer = await canvas.encode("png");
      const attachment = new AttachmentBuilder(buffer, { name: "trainercard.png" });
      const embed = new EmbedBuilder()
        .setTitle(`🧑 ${username}'s Trainer Card`)
        .setColor(0xffcb05)
        .setDescription(`🏆 **Rank:** ${getRank(user.tp)}\n⭐ **TP:** ${user.tp}\n💰 **CC:** ${user.cc || 0}`)
        .setImage("attachment://trainercard.png");
      return safeReply(interaction, { embeds: [embed], files: [attachment], components: interaction.message.components });
    }

    case "share_public": {
      const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });
      const canvas = await renderTrainerCard(user, username, avatarURL);
      const buffer = await canvas.encode("png");
      const attachment = new AttachmentBuilder(buffer, { name: "trainercard.png" });
      const publicEmbed = new EmbedBuilder()
        .setTitle(`🌐 ${username}'s Trainer Card`)
        .setColor(0x00ae86)
        .setDescription(`🏆 **Rank:** ${getRank(user.tp)}\n⭐ **TP:** ${user.tp}\n💰 **CC:** ${user.cc || 0}`)
        .setImage("attachment://trainercard.png")
        .setFooter({ text: `Shared by ${username}`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();
      await safeReply(interaction, { content: "✅ Shared publicly!", ephemeral: true });
      await interaction.channel.send({ embeds: [publicEmbed], files: [attachment] });
      break;
    }

    case "change_trainer":
      return handleChangeTrainer(interaction, user, trainerData, saveDataToDiscord);

    case "change_pokemon":
      return handleChangePokemon(interaction, user, trainerData, saveDataToDiscord);

    default:
      await safeReply(interaction, { content: "❌ Unknown button action.", ephemeral: true });
  }
}


