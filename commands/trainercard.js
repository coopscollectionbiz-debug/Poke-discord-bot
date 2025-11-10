// ==========================================================
// 🤖 Coop’s Collection Discord Bot — Trainer Card Command
// ==========================================================
// Canvas removed (no “Show Full Team”)
// Adds “Change Trainer” + “Change Pokémon” buttons
// Always ephemeral
// All logging & schema logic preserved
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType
} from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { rollForShiny } from "../shinyOdds.js";
import { spritePaths, rarityEmojis } from "../spriteconfig.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { getRank } from "../utils/rankSystem.js";
import { validateUserSchema, createNewUser } from "../utils/userSchema.js";
import { safeReply } from "../utils/safeReply.js";
import { createSafeCollector } from "../utils/safeCollector.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

// Load trainer sprites JSON
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const trainerSpritesPath = path.join(__dirname, "../trainerSprites.json");
const trainerSprites = JSON.parse(fs.readFileSync(trainerSpritesPath, "utf-8"));

// ===========================================================
// SLASH COMMAND
// ===========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("trainercard")
    .setDescription("View or create your Trainer Card!"),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.user.id;
    const username = interaction.user.username;

    console.log(`📋 User lookup for ${username}`);

    const user = await ensureUserInitialized(userId, username, trainerData, client);

    console.log(`📋 User state:`, {
      onboardingComplete: user.onboardingComplete,
      onboardingStage: user.onboardingStage
    });

    if (!user.onboardingComplete) {
      if (!user.onboardingStage || user.onboardingStage === "starter_selection") {
        console.log(`🎪 Showing starter selection`);
        return starterSelection(interaction, user, trainerData, saveDataToDiscord);
      } else if (user.onboardingStage === "trainer_selection") {
        console.log(`🧍 Showing trainer selection`);
        return trainerSelection(interaction, user, trainerData, saveDataToDiscord);
      }
    }

    console.log(`✅ Onboarding complete - showing trainer card`);
    await showTrainerCard(interaction, user);
  }
};

// ===========================================================
// TYPE MAP + STARTER SETUP
// ===========================================================
const typeMap = {
  1: "Normal", 2: "Fighting", 3: "Flying", 4: "Poison", 5: "Ground",
  6: "Rock", 7: "Bug", 8: "Ghost", 9: "Steel", 10: "Fire",
  11: "Water", 12: "Grass", 13: "Electric", 14: "Psychic",
  15: "Ice", 16: "Dragon", 17: "Dark"
};

const starterGenerations = [
  { name: "Kanto", ids: [1, 4, 7] },
  { name: "Johto", ids: [152, 155, 158] },
  { name: "Hoenn", ids: [252, 255, 258] },
  { name: "Sinnoh", ids: [387, 390, 393] },
  { name: "Unova", ids: [495, 498, 501] }
];

// ===========================================================
// 🧍 TRAINER INFO HELPER
// ===========================================================
function getTrainerInfo(trainerFilename) {
  if (!trainerFilename) return { name: "Unknown Trainer", rarity: "Unknown" };
  
  // Extract trainer type from filename (e.g., "youngster-gen4.png" -> "youngster")
  const trainerType = trainerFilename.split("-")[0].replace(".png", "");
  
  // Lookup in trainerSprites JSON
  const trainerExists = Object.keys(trainerSprites).find(key => key === trainerType);
  
  if (!trainerExists) return { name: "Unknown Trainer", rarity: "Unknown" };
  
  // Capitalize trainer name
  const capitalizedName = trainerType.charAt(0).toUpperCase() + trainerType.slice(1);
  
  // Determine rarity based on trainer type
  const rarityMap = {
    youngster: "Common",
    lass: "Common",
    acetrainer: "Uncommon",
    channeler: "Uncommon",
    champion: "Legendary",
    elite: "Epic",
    gym: "Epic"
  };
  
  const rarity = rarityMap[trainerType] || "Common";
  return { name: capitalizedName, rarity };
}

// ===========================================================
// 🌿 STARTER SELECTION
// ===========================================================
export async function starterSelection(interaction, user, trainerData, saveDataToDiscord) {
  try {
    const allPokemon = await getAllPokemon();
    const allStarters = [];
    const generationInfo = [];

    for (const gen of starterGenerations) {
      const starters = gen.ids
        .map(id => allPokemon.find(p => p.id === id))
        .filter(Boolean);
      if (starters.length > 0) {
        starters.forEach(s => allStarters.push(s));
        generationInfo.push({ name: gen.name, count: starters.length });
      }
    }

    if (allStarters.length === 0) throw new Error("No starter Pokémon found");
    console.log(`🎪 Starter carousel loaded with ${allStarters.length} starters`);

    let currentIndex = 0;

    const buildCarousel = async (index) => {
      const pokemon = allStarters[index];
      let genName = "Unknown", starterNumInGen = 0, count = 0;

      for (const gen of starterGenerations) {
        const validCount = gen.ids.filter(id => allPokemon.find(p => p.id === id)).length;
        if (count + validCount > index) {
          genName = gen.name;
          starterNumInGen = index - count + 1;
          break;
        }
        count += validCount;
      }

      const embed = new EmbedBuilder()
        .setTitle(`🌟 Choose Your Starter`)
        .setDescription(
          `**${pokemon.name}** #${pokemon.id}\n\nGeneration: ${genName}\nStarter ${starterNumInGen} of 3\n\n**Pokémon ${index + 1} of ${allStarters.length}**`
        )
        .setImage(`${spritePaths.pokemon}${pokemon.id}.gif`)
        .setColor(0x5865f2)
        .setFooter({ text: `Use the arrows to browse all starters` });

      if (pokemon.types?.[0]) {
        const typeIconUrl = `${spritePaths.types}${pokemon.types[0]}.png`;
        embed.setThumbnail(typeIconUrl);
      }

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("prev_starter").setEmoji("⬅️").setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId("select_starter").setLabel(`✅ Choose ${pokemon.name}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("next_starter").setEmoji("➡️").setStyle(ButtonStyle.Secondary).setDisabled(index === allStarters.length - 1)
      );

      return { embed, buttons };
    };

    const { embed, buttons } = await buildCarousel(currentIndex);
    const reply = await interaction.editReply({ embeds: [embed], components: [buttons] });

    const collector = reply.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      componentType: ComponentType.Button,
      time: 120000
    });

    collector.on("collect", async i => {
      if (i.customId === "select_starter") {
        await i.deferUpdate().catch(() => {});
        collector.stop();

        const selected = allStarters[currentIndex];
        user.selectedStarter = selected.id;
        user.displayedPokemon = [selected.id];
        user.onboardingStage = "trainer_selection";

        const isShiny = rollForShiny(user.tp || 0);
        user.pokemon[selected.id] = { normal: isShiny ? 0 : 1, shiny: isShiny ? 1 : 0 };
        trainerData[interaction.user.id] = user;

        await saveDataToDiscord(trainerData).catch(err => console.error("Save failed:", err.message));
        console.log(`✅ Starter selected: ${selected.name}`);

        return trainerSelection(interaction, user, trainerData, saveDataToDiscord);
      }

      await i.deferUpdate().catch(() => {});
      if (i.customId === "next_starter") currentIndex = Math.min(currentIndex + 1, allStarters.length - 1);
      else if (i.customId === "prev_starter") currentIndex = Math.max(currentIndex - 1, 0);
      const { embed: e, buttons: b } = await buildCarousel(currentIndex);
      await i.editReply({ embeds: [e], components: [b] });
    });

    collector.on("end", async (_, reason) => {
      if (reason !== "user") await interaction.editReply({ components: [] }).catch(() => {});
    });
  } catch (err) {
    console.error("starterSelection error:", err);
    await interaction.editReply({ content: "❌ Failed to load starter selection." });
  }
}

// ===========================================================
// 🧍 TRAINER SELECTION
// ===========================================================
export async function trainerSelection(interaction, user, trainerData, saveDataToDiscord) {
  const trainers = [
    { id: "youngster-gen4.png", name: "Youngster 👦", label: "Youngster", description: "A spirited young Trainer full of energy.", color: 0x5865f2 },
    { id: "lass-gen4.png", name: "Lass 👧", label: "Lass", description: "A cheerful and stylish Trainer who loves cute Pokémon.", color: 0x5865f2 }
  ];
  
  let index = 0;
  const renderTrainerEmbed = page => {
    const t = trainers[page];
    const trainerImageUrl = `${spritePaths.trainers}${t.id}`;
    console.log(`🧍 Rendering trainer ${t.label} - ${trainerImageUrl}`);
    return new EmbedBuilder()
      .setTitle("🧍 Choose Your Trainer Sprite")
      .setDescription(`${t.description}\n\n**Trainer:** ${t.name}`)
      .setColor(t.color)
      .setImage(trainerImageUrl)
      .setFooter({ text: `Page ${page + 1}/${trainers.length}` });
  };

  const getButtons = page => {
    const btns = [];
    if (page > 0) btns.push(new ButtonBuilder().setCustomId("prev_trainer").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary));
    if (page < trainers.length - 1) btns.push(new ButtonBuilder().setCustomId("next_trainer").setLabel("Next ➡️").setStyle(ButtonStyle.Secondary));
    btns.push(new ButtonBuilder().setCustomId("confirm_trainer").setLabel(`✅ Confirm ${trainers[page].label}`).setStyle(ButtonStyle.Success));
    return new ActionRowBuilder().addComponents(btns);
  };

  const embed = renderTrainerEmbed(index);
  const row = getButtons(index);
  await interaction.editReply({ embeds: [embed], components: [row] });
  const reply = await interaction.fetchReply();
  const collector = reply.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    componentType: ComponentType.Button,
    time: 120000
  });

  collector.on("collect", async i => {
    if (i.user.id !== interaction.user.id)
      return i.reply({ content: "This isn't your selection!", ephemeral: true });

    switch (i.customId) {
      case "next_trainer":
        index = Math.min(index + 1, trainers.length - 1);
        break;
      case "prev_trainer":
        index = Math.max(index - 1, 0);
        break;
      case "confirm_trainer": {
        const choice = trainers[index];
        user.trainers ??= {};
        user.trainers[choice.id] = true;
        user.displayedTrainer = choice.id;
        user.onboardingComplete = true;
        user.onboardingDate = Date.now();
        delete user.onboardingStage;
        trainerData[interaction.user.id] = user;
        await saveDataToDiscord(trainerData).catch(err => console.error(err));
        console.log(`✅ Trainer confirmed: ${choice.label}`);
        await i.deferUpdate();
        await i.editReply({ content: `✅ You chose **${choice.label}** as your Trainer!` });
        collector.stop("confirmed");
        return showTrainerCard(interaction, user);
      }
    }
    const newEmbed = renderTrainerEmbed(index);
    const newRow = getButtons(index);
    await i.deferUpdate();
    await i.editReply({ embeds: [newEmbed], components: [newRow] });
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "confirmed") await interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ===========================================================
// 🧑 SHOW TRAINER CARD (Embed only, ephemeral)
// ===========================================================
export async function showTrainerCard(interaction, user) {
  try {
    const username = interaction?.user?.username || user.name || "Trainer";
    const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });
    const trainerPath = user.displayedTrainer ? `${spritePaths.trainers}${user.displayedTrainer}` : null;
    let displayed = user.displayedPokemon?.slice(0, 6) || [];
    const allPokemon = await getAllPokemon();

    // Auto-fill team with owned Pokémon if fewer than 6
    if (displayed.length < 6) {
      const ownedIds = Object.keys(user.pokemon || {}).filter(id => {
        const p = user.pokemon[id];
        return (p?.normal > 0 || p?.shiny > 0) || (typeof p === "number" && p > 0);
      }).map(id => Number(id));
      for (const pid of ownedIds) {
        if (displayed.length >= 6) break;
        if (!displayed.includes(pid)) displayed.push(pid);
      }
      if (displayed.length > (user.displayedPokemon?.length || 0)) {
        user.displayedPokemon = displayed;
        console.log(`➕ Auto-filled team: ${displayed.length}/6 Pokémon`);
      }
    }

    const pokemonInfo = displayed.map(id => allPokemon.find(p => p.id === id)).filter(Boolean);
    const rank = getRank(user.tp);
    const pokemonOwned = Object.keys(user.pokemon || {}).length;
    const shinyCount = Object.values(user.pokemon || {}).filter(p => p.shiny > 0).length;
    const trainerCount = Object.keys(user.trainers || {}).length;

    const teamDisplay = pokemonInfo.length
      ? pokemonInfo.map((p, i) => {
          const shinyOwned = user.pokemon[p.id]?.shiny > 0;
          const shinyMark = shinyOwned ? "✨ " : "";
          const tier = (p.tier || p.rarity || "common").toLowerCase();
          const emoji = rarityEmojis[tier] || "⚬";
          return `${i + 1}. ${shinyMark}**${p.name}** ${emoji}`;
        }).join("\n")
      : "No Pokémon selected.";

    const embed = new EmbedBuilder()
      .setAuthor({ name: `${username}'s Trainer Card`, iconURL: avatarURL })
      .setColor(0x5865f2)
      .setDescription(
        `🏆 **Rank:** ${rank}\n⭐ **TP:** ${user.tp}\n💰 **CC:** ${user.cc || 0}\n\n` +
        `📊 **Pokémon Owned:** ${pokemonOwned}\n✨ **Shiny Pokémon:** ${shinyCount}\n🧍 **Trainers:** ${trainerCount}\n\n` +
        `**Team:**\n${teamDisplay}`
      )
      .setFooter({ text: "Coop's Collection • /trainercard" });

    if (trainerPath) embed.setThumbnail(trainerPath);

    // Buttons: Change Trainer / Change Pokémon
    const changeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Change Trainer")
        .setEmoji("🧢")
        .setStyle(ButtonStyle.Primary)
        .setURL("https://coopscollection.com/changetrainer"), // direct link to picker
      new ButtonBuilder()
        .setLabel("Change Pokémon")
        .setEmoji("🐾")
        .setStyle(ButtonStyle.Primary)
        .setURL("https://coopscollection.com/changepokemon")
    );

    await interaction.editReply({ embeds: [embed], components: [changeRow] });
  } catch (err) {
    console.error("showTrainerCard error:", err);
    await interaction.editReply({ content: "❌ Failed to show Trainer Card." });
  }
}

// ===========================================================
// 🔘 BUTTON HANDLER (ephemeral only)
// ===========================================================
export async function handleTrainerCardButtons(interaction, trainerData, saveDataToDiscord) {
  const userId = interaction.user.id;
  const user = trainerData[userId];

  if (!user) {
    await interaction.reply({ content: "❌ Could not find your trainer data.", ephemeral: true });
    return;
  }

  const id = interaction.customId;
  console.log(`🔘 handleTrainerCardButtons: ${id}`);

  // These buttons now handled as external URLs (no internal actions)
  if (id === "show_full_team") {
    await interaction.reply({
      content: "🖼️ Full team view is now deprecated — use **/changepokemon** to edit your lineup.",
      ephemeral: true
    });
    return;
  }

  await interaction.reply({ content: "❌ Unknown or deprecated button action.", ephemeral: true });
}


