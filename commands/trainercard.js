// /commands/trainercard.js
// Coop's Collection Discord Bot — Trainer Card Command
// Canvas-based display: Trainer Sprite | Rank + TP | 2×3 Pokémon Grid
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
import { createCanvas, loadImage } from "canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { rollForShiny } from "../shinyOdds.js";
import { spritePaths } from "../spriteconfig.js";
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
  
  // Capitalize trainer name (e.g., "youngster" -> "Youngster")
  const capitalizedName = trainerType.charAt(0).toUpperCase() + trainerType.slice(1);
  
  // Determine rarity based on trainer type (can be customized)
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
        starters.forEach(starter => {
          allStarters.push(starter);
        });
        generationInfo.push({ name: gen.name, count: starters.length });
      }
    }

    if (allStarters.length === 0) {
      throw new Error("No starter pokemon found");
    }

    console.log(`🎪 Starter carousel loaded with ${allStarters.length} starters`);

    let currentIndex = 0;

    const buildCarousel = async (index) => {
      const pokemon = allStarters[index];
      
      let genName = "Unknown";
      let starterNumInGen = 0;
      let count = 0;

      for (let i = 0; i < starterGenerations.length; i++) {
        const gen = starterGenerations[i];
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
          `**${pokemon.name}** #${pokemon.id}\n\n` +
          `Generation: ${genName}\n` +
          `Starter ${starterNumInGen} of 3\n\n` +
          `**Pokemon ${index + 1} of ${allStarters.length}**`
        )
        .setImage(`${spritePaths.pokemon}${pokemon.id}.gif`)
        .setColor(0x43b581)
        .setFooter({ text: `Use the arrows to browse all starters` });

      if (pokemon.types?.[0]) {
        const typeIconUrl = `${spritePaths.types}${pokemon.types[0]}.png`;
        embed.setThumbnail(typeIconUrl);
      }

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("prev_starter")
          .setEmoji("⬅️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === 0),
        new ButtonBuilder()
          .setCustomId("select_starter")
          .setLabel(`✅ Choose ${pokemon.name}`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("next_starter")
          .setEmoji("➡️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === allStarters.length - 1)
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
        await i.deferUpdate().catch(err => {
          console.warn("Failed to defer update:", err.message);
        });
        
        collector.stop();

        const selectedPokemon = allStarters[currentIndex];
        user.selectedStarter = selectedPokemon.id;
        user.displayedPokemon = [selectedPokemon.id];
        user.onboardingStage = "trainer_selection";
        
        const isShiny = rollForShiny(user.tp || 0);
        user.pokemon[selectedPokemon.id] = { normal: isShiny ? 0 : 1, shiny: isShiny ? 1 : 0 };

        trainerData[interaction.user.id] = user;

        console.log(`✅ Starter selected: ${selectedPokemon.name}`);

        try {
          await saveDataToDiscord(trainerData);
          console.log(`✅ Starter selection saved`);
        } catch (err) {
          console.error("Failed to save after starter selection:", err.message);
        }

        trainerData[interaction.user.id] = user;

        try {
          await trainerSelection(interaction, user, trainerData, saveDataToDiscord);
        } catch (err) {
          console.error("Failed to show trainer selection:", err.message);
          await interaction.editReply({
            content: `✅ You chose **${selectedPokemon.name}**! Your adventure begins! 🚀`,
          });
        }

        return;
      }

      await i.deferUpdate().catch(err => {
        console.warn("Failed to defer update for navigation:", err.message);
      });
      
      if (i.customId === "next_starter") {
        currentIndex = Math.min(currentIndex + 1, allStarters.length - 1);
      } else if (i.customId === "prev_starter") {
        currentIndex = Math.max(currentIndex - 1, 0);
      }

      const { embed: e, buttons: b } = await buildCarousel(currentIndex);
      await i.editReply({ embeds: [e], components: [b] });
    });

    collector.on("end", async (_, reason) => {
      if (reason !== "user") {
        try {
          await interaction.editReply({ components: [] }).catch(() => {});
        } catch {}
      }
    });
  } catch (err) {
    console.error("starterSelection error:", err);
    await interaction.editReply({
      content: "❌ Failed to load starter selection."
    });
  }
}

// ===========================================================
// 🧍 TRAINER SELECTION
// ===========================================================
export async function trainerSelection(interaction, user, trainerData, saveDataToDiscord) {
  const trainers = [
    { id: "youngster-gen4.png", name: "Youngster 👦", label: "Youngster", description: "A spirited young Pokémon Trainer full of energy.", color: 0x43b581 },
    { id: "lass-gen4.png", name: "Lass 👧", label: "Lass", description: "A cheerful and stylish Trainer who loves cute Pokémon.", color: 0xff70a6 }
  ];
  
  let index = 0;
  
  const renderTrainerEmbed = page => {
    const t = trainers[page];
    const trainerImageUrl = `${spritePaths.trainers}${t.id}`;
    
    console.log(`🧍 Rendering trainer ${t.label} - URL: ${trainerImageUrl}`);
    
    return new EmbedBuilder()
      .setTitle("🧍 Choose Your Trainer Sprite")
      .setDescription(`${t.description}\n\n**Trainer:** ${t.name}`)
      .setColor(t.color)
      .setImage(trainerImageUrl)
      .setFooter({ text: `Page ${page + 1}/${trainers.length}` });
  };
  
  const getButtons = page => {
    const buttons = [];
    if (page > 0) {
      buttons.push(new ButtonBuilder().setCustomId("prev_trainer").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary));
    }
    if (page < trainers.length - 1) {
      buttons.push(new ButtonBuilder().setCustomId("next_trainer").setLabel("Next ➡️").setStyle(ButtonStyle.Secondary));
    }
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
  await interaction.editReply({ embeds: [embed], components: [row] });
  
  const reply = await interaction.fetchReply();
  const collector = reply.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    componentType: ComponentType.Button,
    time: 120000
  });
  
  collector.on("collect", async i => {
    if (i.user.id !== interaction.user.id) {
      return await i.reply({ content: "This isn't your selection!", ephemeral: true });
    }
    
    switch (i.customId) {
      case "next_trainer":
        index = Math.min(index + 1, trainers.length - 1);
        break;
      case "prev_trainer":
        index = Math.max(index - 1, 0);
        break;
      case "confirm_trainer": {
        const choice = trainers[index];
        user.trainers = user.trainers || {};
        user.trainers[choice.id] = true;
        user.displayedTrainer = choice.id;
        user.onboardingComplete = true;
        user.onboardingDate = Date.now();
        delete user.onboardingStage;

        trainerData[interaction.user.id] = user;

        console.log(`✅ Trainer confirmed: ${choice.label}`);

        try {
          await saveDataToDiscord(trainerData);
          console.log(`✅ Trainer selection saved - onboarding complete`);
        } catch (err) {
          console.error("Failed to save after trainer selection:", err.message);
        }

        trainerData[interaction.user.id] = user;

        await i.deferUpdate();
        await i.editReply({ content: `✅ You chose **${choice.label}** as your Trainer!` });
        collector.stop("confirmed");
        return await showTrainerCard(interaction, user);
      }
    }
    
    const newEmbed = renderTrainerEmbed(index);
    const newRow = getButtons(index);
    await i.deferUpdate();
    await i.editReply({ embeds: [newEmbed], components: [newRow] });
  });
  
  collector.on("end", async (_, reason) => {
    if (reason !== "confirmed") {
      try {
        await interaction.editReply({ components: [] }).catch(() => {});
      } catch {}
    }
  });
}

// ===========================================================
// 🧑 SHOW TRAINER CARD (EMBED + LEAD POKEMON SPRITE)
// ===========================================================
export async function showTrainerCard(interaction, user) {
  try {
    const username = interaction?.user?.username || user.name || "Trainer";
    const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });

    const trainerPath = user.displayedTrainer
      ? `${spritePaths.trainers}${user.displayedTrainer}`
      : null;

    let displayed = user.displayedPokemon?.slice(0, 6) || [];
    const allPokemon = await getAllPokemon();
    
    // 🆕 AUTO-FILL TEAM FIRST: If less than 6, add owned pokemon to empty slots
    if (displayed.length < 6) {
      const ownedPokemonIds = Object.keys(user.pokemon || {}).filter(id => {
        const p = user.pokemon[id];
        return (p?.normal > 0 || p?.shiny > 0) || (typeof p === "number" && p > 0);
      }).map(id => Number(id));

      // Add owned pokemon to fill empty slots
      for (const pokemonId of ownedPokemonIds) {
        if (displayed.length >= 6) break;
        if (!displayed.includes(pokemonId)) {
          displayed.push(pokemonId);
        }
      }

      // Save the auto-filled team
      if (displayed.length > (user.displayedPokemon?.length || 0)) {
        user.displayedPokemon = displayed;
        console.log(`➕ Auto-filled team: ${displayed.length}/6 pokemon`);
      }
    }

    // NOW calculate pokemonInfo from the auto-filled team
    const pokemonInfo = displayed
      .map(id => allPokemon.find(p => p.id === id))
      .filter(Boolean);

    // Display first pokemon sprite on the embed
    let leadPokemonImage = null;
    if (pokemonInfo.length > 0) {
      const leadPokemon = pokemonInfo[0];
      const hasShiny = user.pokemon[leadPokemon.id]?.shiny > 0;
      leadPokemonImage = hasShiny
        ? `${spritePaths.shiny}${leadPokemon.id}.gif`
        : `${spritePaths.pokemon}${leadPokemon.id}.gif`;
    }

    const rank = getRank(user.tp);
    const pokemonOwned = Object.keys(user.pokemon || {}).length;
    const shinyCount = Object.values(user.pokemon || {}).filter(p => p.shiny > 0).length;
    const trainerCount = Object.keys(user.trainers || {}).length;

    const teamDisplay = pokemonInfo.length > 0
      ? pokemonInfo.map((p, i) => {
          const shinyOwned = user.pokemon[p.id]?.shiny > 0;
          const shinyMark = shinyOwned ? "✨ " : "";
          return `${i + 1}. ${shinyMark}**${p.name}** (#${p.id})`;
        }).join("\n")
      : "No Pokémon selected";

    const embed = new EmbedBuilder()
      .setAuthor({ name: `${username}'s Trainer Card`, iconURL: avatarURL })
      .setColor(0xffcb05)
      .setDescription(
        `🏆 **Rank:** ${rank}\n⭐ **TP:** ${user.tp}\n💰 **CC:** ${user.cc || 0}\n\n` +
        `**Team:**\n${teamDisplay}\n\n` +
        `📊 **Pokémon Owned:** ${pokemonOwned}\n✨ **Shiny Pokémon:** ${shinyCount}\n🧍 **Trainers:** ${trainerCount}`
      )
      .setFooter({ text: "Coop's Collection • /trainercard" });

    if (trainerPath) embed.setThumbnail(trainerPath);

    // Add lead pokemon image
    if (leadPokemonImage) {
      embed.setImage(leadPokemonImage);
    }

    const showTeamRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("show_full_team")
        .setLabel("Show Full Team")
        .setEmoji("👥")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({
      embeds: [embed],
      components: [showTeamRow]
    });

  } catch (err) {
    console.error("showTrainerCard error:", err);
    await interaction.editReply({
      content: "❌ Failed to show Trainer Card."
    });
  }
}

// ===========================================================
// 🖼️ CANVAS RENDER FUNCTION (Show Full Team)
// ===========================================================
async function renderFullTeamCanvas(user, avatarURL, username) {
  const allPokemon = await getAllPokemon();
  const displayed = user.displayedPokemon?.slice(0, 6) || [];
  const pokemonInfo = displayed
    .map(id => allPokemon.find(p => p.id === id))
    .filter(Boolean);

  const trainerPath = user.displayedTrainer
    ? `${spritePaths.trainers}${user.displayedTrainer}`
    : null;

  const rank = getRank(user.tp);

  // Get trainer info from JSON
  const trainerInfo = getTrainerInfo(user.displayedTrainer);

  // Canvas layout: 900×500 (trainer area ~300px left, grid ~600px right)
  const width = 900;
  const height = 500;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background - Discord embed color for entire canvas
  ctx.fillStyle = "#2F3136";
  ctx.fillRect(0, 0, width, height);

  // LEFT SIDE: Trainer sprite (larger, centered horizontally and vertically in left 300px)
  if (trainerPath) {
    try {
      const trainerImg = await loadImage(trainerPath);
      const trainerScale = 2.5; // Increase trainer size
      const scaledWidth = trainerImg.width * trainerScale;
      const scaledHeight = trainerImg.height * trainerScale;
      const trainerX = 150 - scaledWidth / 2; // Center horizontally in 300px space
      const trainerY = 120 - scaledHeight / 2; // Moved closer to avatar
      ctx.drawImage(trainerImg, trainerX, trainerY, scaledWidth, scaledHeight);
    } catch (err) {
      console.warn("Trainer image load failed:", err.message);
    }
  }

  // Trainer name and rarity below sprite
  ctx.font = "bold 14px Arial";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(trainerInfo.name, 150, 200);

  ctx.font = "12px Arial";
  ctx.fillStyle = "#bdbdbd";
  ctx.fillText(trainerInfo.rarity, 150, 215);

  // CENTER-LEFT SIDE: Discord Avatar + Username (centered between trainer text and rank)
  const avatarX = 150; // Center of 300px left space
  const avatarY = 325; // Moved down closer to rank
  const avatarSize = 70; // Increased from 60

  if (avatarURL) {
    try {
      const avatarImg = await loadImage(avatarURL);
      
      // Draw circular avatar using clip path
      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, avatarSize / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(avatarImg, avatarX - avatarSize / 2, avatarY - avatarSize / 2, avatarSize, avatarSize);
      ctx.restore();
      
      // Draw circle border around avatar
      ctx.strokeStyle = "#ffcb05";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, avatarSize / 2, 0, Math.PI * 2);
      ctx.stroke();
    } catch (err) {
      console.warn("Avatar image load failed:", err.message);
    }
  }

  // Draw username below avatar
  ctx.font = "bold 15px Arial";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(username, avatarX, avatarY + 50);

  // Draw rank + TP below username (centered in left 300px space)
  ctx.font = "bold 24px Arial";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(`Rank: ${rank}`, 150, 430);

  ctx.font = "bold 24px Arial";
  ctx.fillStyle = "#ffcb05";
  ctx.fillText(`TP: ${user.tp}`, 150, 460);

  // RIGHT SIDE: Pokémon grid (2 rows × 3 cols) - CENTERED
  const gridWidth = 3 * 170 - 170; // Total width of 3 columns (340px)
  const availableWidth = 600; // Width from x=300 to x=900
  const gridStartX = 300 + (availableWidth - gridWidth) / 2; // Center horizontally
  const gridStartY = 125; // Moved down closer to bottom
  const colSpacing = 170;
  const rowSpacing = 200;

  for (let i = 0; i < pokemonInfo.length && i < 6; i++) {
    const p = pokemonInfo[i];
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = gridStartX + col * colSpacing;
    const y = gridStartY + row * rowSpacing;

    const hasShiny = user.pokemon[p.id]?.shiny > 0;
    const spriteURL = hasShiny
      ? `${spritePaths.shiny}${p.id}.gif`
      : `${spritePaths.pokemon}${p.id}.gif`;

    console.log(`Loading sprite for ${p.name} (ID: ${p.id}): ${spriteURL}`);

    try {
      const sprite = await loadImage(spriteURL);
      const spriteScale = 1.5; // Scale sprites up by 50%
      
      // Draw sprite at scaled size, centered with transparency
      ctx.drawImage(sprite, x - (sprite.width * spriteScale) / 2, y - (sprite.height * spriteScale) / 2, sprite.width * spriteScale, sprite.height * spriteScale);
    } catch (err) {
      console.warn(`Sprite failed for ${p?.name} (${p?.id}): ${err?.message}`);
      // Draw placeholder card instead of failing
      ctx.fillStyle = "#444444";
      ctx.fillRect(x - 35, y - 35, 70, 70);
      ctx.fillStyle = "#ffffff";
      ctx.font = "12px Arial";
      ctx.textAlign = "center";
      ctx.fillText("?", x, y + 2);
    }

    // Pokémon name with "Shiny" text label
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = hasShiny ? "#ffcb05" : "#ffffff";
    const shinyLabel = hasShiny ? "Shiny " : "";
    ctx.fillText(`${shinyLabel}${p.name}`, x, y + 60); // Moved closer to sprite

    // Tier (using the tier field from pokemon data)
    ctx.font = "13px Arial";
    ctx.fillStyle = "#bdbdbd";
    const tierDisplay = p.tier ? p.tier.charAt(0).toUpperCase() + p.tier.slice(1) : "Unknown";
    ctx.fillText(tierDisplay, x, y + 80); // Moved closer to sprite
  }

  return new AttachmentBuilder(canvas.toBuffer("image/png"), { name: "team_card.png" });
}

// ===========================================================
// BUTTON HANDLER
// ===========================================================
export async function handleTrainerCardButtons(interaction, trainerData, saveDataToDiscord) {
  const userId = interaction.user.id;
  const user = trainerData[userId];

  if (!user) {
    await interaction.reply({ content: "❌ Could not find your trainer data.", ephemeral: true });
    return;
  }

  if (interaction.customId === "show_full_team") {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });
      const username = interaction.user.username;
      const image = await renderFullTeamCanvas(user, avatarURL, username);
      await interaction.editReply({ content: "🖼️ **Full Team View**", files: [image] });
    } catch (err) {
      console.error("❌ renderFullTeamCanvas error:", err.message);
      await interaction.editReply({ content: `❌ Failed to render: ${err.message}` });
    }
  } else {
    await interaction.reply({ content: "❌ Unknown button action.", ephemeral: true });
  }
}