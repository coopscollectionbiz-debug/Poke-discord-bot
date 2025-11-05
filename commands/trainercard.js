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
import path from "path";
import { combineGifsHorizontal } from "../utils/gifComposer.js";
import { createSafeCollector } from "../utils/safeCollector.js";


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
// 🌿 STARTER SELECTION — Type Sprite Header + Animated GIF Grid
// ===========================================================


const starterIDs = [
  1, 4, 7,
  152, 155, 158,
  252, 255, 258,
  387, 390, 393,
  495, 498, 501
];

export async function starterSelection(interaction, user, trainerData, saveDataToDiscord) {
  try {
    // ✅ Make sure we reply within 3s
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    const allPokemon = await getAllPokemon();
    const starters = allPokemon.filter(p => starterIDs.includes(Number(p.id)));

    // Group starters by primary type
    const grouped = {};
    for (const p of starters) {
      const t = p.types?.[0];
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(p);
    }

    const order = [12, 10, 11]; // Grass, Fire, Water
    const sortedTypes = Object.keys(grouped)
      .map(Number)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));

    // 🧩 Build each page dynamically
    const buildPage = async index => {
      const typeId = sortedTypes[index];
      const typeName = typeMap[typeId];
      const list = grouped[typeId];

      // Combine 5 GIFs horizontally
      const gifPaths = list.map(p => `${spritePaths.pokemon}${p.id}.gif`);
      const output = path.resolve(`./temp/${typeName}_starters.gif`);
      await combineGifsHorizontal(gifPaths, output);
      const combinedGif = new AttachmentBuilder(output, { name: `${typeName}_starters.gif` });

      // Type sprite header (static PNG)
      const typeSprite = `${spritePaths.types}${typeId}.png`;

      const embed = new EmbedBuilder()
        .setTitle(`🌟 Choose Your Starter Pokémon`)
        .setDescription(
          `**Type:** ${typeName}\nClick a button below to choose your Pokémon!`
        )
        .setThumbnail(typeSprite) // 🧩 replaces gradient header
        .setColor(0x43b581)
        .setImage(`attachment://${typeName}_starters.gif`)
        .setFooter({ text: `Page ${index + 1}/${sortedTypes.length}` });

      const row1 = new ActionRowBuilder().addComponents(
        list.map(p =>
          new ButtonBuilder()
            .setCustomId(`starter_${p.id}`)
            .setLabel(p.name)
            .setStyle(ButtonStyle.Primary)
        )
      );

      const row2 = new ActionRowBuilder().addComponents(
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

      return { embed, components: [row1, row2], files: [combinedGif] };
    };

    // ── Show first page ───────────────────────────────
    let page = 0;
    const { embed, components, files } = await buildPage(page);
    await safeReply(interaction, { embeds: [embed], components, files, ephemeral: true });

    // ── Collector for buttons ─────────────────────────
    const collector = createSafeCollector(
      interaction,
      { 
        filter: i => i.user.id === interaction.user.id,
        componentType: ComponentType.Button,
        time: 120000 
      },
      "trainercard"
    );

    collector.on("collect", async i => {
      if (i.user.id !== interaction.user.id)
        return safeReply(i, { content: "Not your onboarding!", ephemeral: true });

      if (i.customId === "next_page" || i.customId === "prev_page") {
        page += i.customId === "next_page" ? 1 : -1;
        const { embed: e, components: c, files: f } = await buildPage(page);
        return await safeReply(i, { embeds: [e], components: c, files: f, ephemeral: true });
      }

      if (i.customId.startsWith("starter_")) {
        const starterId = parseInt(i.customId.split("_")[1]);
        const isShiny = rollForShiny(user.tp);
        user.pokemon[starterId] = { normal: isShiny ? 0 : 1, shiny: isShiny ? 1 : 0 };
        user.displayedPokemon = [starterId];
        user.starterPokemon = starterId;
        await safeReply(i, {
          content: `✅ You chose **${allPokemon.find(p => p.id === starterId).name}**${isShiny ? " ✨" : ""} as your starter!`,
          ephemeral: true
        });
        await saveDataToDiscord(trainerData);
        collector.stop();
        return await trainerSelection(i, user, trainerData, saveDataToDiscord);
      }
    });

    collector.on("end", async () => {
      try { await safeReply(interaction, { components: [] }); } catch {}
    });
  } catch (err) {
    console.error("starterSelection error:", err);
    await safeReply(interaction, { content: "❌ Failed to load starter selection.", ephemeral: true });
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
    if (i.user.id !== interaction.user.id) return safeReply(i, { content: "This isn't your selection!", ephemeral: true });

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
// 🧑 SHOW TRAINER CARD — Animated Layout (Trainer + Pokémon GIFs)
// ===========================================================


export async function showTrainerCard(interaction, user) {
  try {
    const username = interaction?.user?.username || user.name || "Trainer";
    const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });

    // === 1️⃣ Trainer Sprite =================================================
    const trainerPath = user.displayedTrainer
      ? `${spritePaths.trainers}${user.displayedTrainer}`
      : `${spritePaths.trainers}default.png`;

    // === 2️⃣ Pokémon GIF Strip =============================================
    const displayed = user.displayedPokemon?.slice(0, 6) || [];
    const owned = displayed.filter(id => id && user.pokemon[id]);
    let combinedGifAttachment = null;

    if (owned.length > 0) {
      const gifPaths = owned.map(id => `${spritePaths.pokemon}${id}.gif`);
      const output = path.resolve(`./temp/${username}_team.gif`);
      await combineGifsHorizontal(gifPaths, output);
      combinedGifAttachment = new AttachmentBuilder(output, { name: "team.gif" });
    }

    // === 3️⃣ Stats + Embed ==================================================
    const rank = getRank(user.tp);
    const pokemonOwned = Object.keys(user.pokemon || {}).length;
    const shinyCount = Object.values(user.pokemon || {}).filter(p => p.shiny > 0).length;
    const trainerCount = Object.keys(user.trainers || {}).length;

    const embed = new EmbedBuilder()
      .setAuthor({ name: `${username}'s Trainer Card`, iconURL: avatarURL })
      .setColor(0xffcb05)
      .setDescription(
        `🏆 **Rank:** ${rank}\n⭐ **TP:** ${user.tp}\n💰 **CC:** ${user.cc || 0}\n\n` +
        `📊 **Pokémon Owned:** ${pokemonOwned}\n✨ **Shiny Pokémon:** ${shinyCount}\n🧍 **Trainers:** ${trainerCount}`
      )
      .setImage(`attachment://team.gif`)
      .setThumbnail(trainerPath)
      .setFooter({ text: "Coop's Collection • /trainercard" });

    // === 4️⃣ Action Buttons ================================================
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("change_trainer").setLabel("Change Trainer").setEmoji("🧍").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("change_pokemon").setLabel("Change Pokémon").setEmoji("🧬").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("refresh_card").setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("share_public").setLabel("Share Public").setEmoji("🌐").setStyle(ButtonStyle.Success)
    );

    // === 5️⃣ Reply ==========================================================
    const files = combinedGifAttachment ? [combinedGifAttachment] : [];
    await safeReply(interaction, { embeds: [embed], files, components: [row], ephemeral: true });

  } catch (err) {
    console.error("showTrainerCard error:", err);
    await safeReply(interaction, { content: "❌ Failed to show Trainer Card.", ephemeral: true });
  }
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
    case "refresh_card":
      return showTrainerCard(interaction, user);

    case "share_public":
      await safeReply(interaction, { content: "✅ Shared publicly!", ephemeral: true });
      return showTrainerCard(interaction, user);

    case "change_trainer":
      return handleChangeTrainer(interaction, user, trainerData, saveDataToDiscord);

    case "change_pokemon":
      return handleChangePokemon(interaction, user, trainerData, saveDataToDiscord);

    default:
      await safeReply(interaction, { content: "❌ Unknown button action.", ephemeral: true });
  }
}