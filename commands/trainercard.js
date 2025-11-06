// /commands/trainercard.js (COMPLETE VERSION)
// Coop's Collection Discord Bot — Trainer Card Command
// Canvas-based display: Trainer Sprite | Lead Pokemon | 5 Pokemon Grid
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
import { rollForShiny } from "../shinyOdds.js";
import { spritePaths } from "../spriteconfig.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { getRank } from "../utils/rankSystem.js";
import { validateUserSchema, createNewUser } from "../utils/userSchema.js";
import { safeReply } from "../utils/safeReply.js";
import { createSafeCollector } from "../utils/safeCollector.js";
import { createCanvas, loadImage } from "canvas";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";

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

    // ✅ Use unified schema
    if (!user) {
      user = trainerData[userId] = createNewUser(userId, username);
    } else {
      user = validateUserSchema(user, userId, username);
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
// UTILITY: Check if path is URL or local file
// ===========================================================
function isUrl(str) {
  return str.startsWith('http://') || str.startsWith('https://');
}

// ===========================================================
// UTILITY: Download URL sprites to temp directory
// ===========================================================
async function downloadSpriteToTemp(url, filename) {
  const tempPath = path.resolve(`./temp/${filename}`);
  
  // Return if already cached
  if (fs.existsSync(tempPath)) {
    console.log(`📦 Using cached sprite: ${filename}`);
    return tempPath;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const buffer = await response.buffer();
    fs.writeFileSync(tempPath, buffer);
    console.log(`⬇️  Downloaded sprite: ${filename} (${buffer.length} bytes)`);
    return tempPath;
  } catch (err) {
    console.error(`❌ Failed to download sprite: ${err.message}`);
    throw err;
  }
}

// ===========================================================
// UTILITY: Download multiple URL sprites and return local paths
// ===========================================================
async function downloadSpritesToTemp(urls, baseName) {
  const localPaths = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const pokemonId = url.split('/').pop().replace('.gif', '').replace('.png', '');
    const filename = `${baseName}_${i}_${pokemonId}.gif`;
    
    const localPath = await downloadSpriteToTemp(url, filename);
    localPaths.push(localPath);
  }
  return localPaths;
}

// ===========================================================
// UTILITY: Create team grid canvas (Pokemon 2-6)
// ===========================================================
async function createTeamGrid(team, spritePaths) {
  try {
    const canvas = createCanvas(240, 220);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, 240, 220);
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 240, 220);

    // Grid layout: 2x2 + 1 centered
    const positions = [
      { x: 10, y: 10, size: 100 },    // Pokemon 2 (top-left)
      { x: 130, y: 10, size: 100 },   // Pokemon 3 (top-right)
      { x: 10, y: 120, size: 100 },   // Pokemon 4 (bottom-left)
      { x: 130, y: 120, size: 100 },  // Pokemon 5 (bottom-right)
      { x: 70, y: 110, size: 100 }    // Pokemon 6 (centered bottom)
    ];

    // Draw each Pokemon
    for (let i = 0; i < Math.min(team.length, 5); i++) {
      const pokemon = team[i];
      if (!pokemon) continue;

      const pos = positions[i];

      try {
        const imgUrl = `${spritePaths.pokemon}${pokemon.id}.gif`;
        const img = await loadImage(imgUrl);

        // Draw semi-transparent background
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.fillRect(pos.x, pos.y, pos.size, pos.size);
        ctx.strokeStyle = "#ccc";
        ctx.strokeRect(pos.x, pos.y, pos.size, pos.size);

        // Draw Pokemon sprite centered
        const spriteSize = 80;
        const offsetX = (pos.size - spriteSize) / 2;
        const offsetY = (pos.size - spriteSize) / 2;
        ctx.drawImage(img, pos.x + offsetX, pos.y + offsetY, spriteSize, spriteSize);

        // Draw Pokemon name
        ctx.fillStyle = "#333";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "center";
        ctx.fillText(pokemon.name.substring(0, 10), pos.x + pos.size / 2, pos.y + pos.size + 12);
      } catch (err) {
        console.warn(`Failed to load image for ${pokemon.name}:`, err.message);
        // Draw placeholder
        ctx.fillStyle = "#ccc";
        ctx.fillRect(pos.x + 30, pos.y + 30, 40, 40);
        ctx.fillStyle = "#999";
        ctx.font = "10px Arial";
        ctx.textAlign = "center";
        ctx.fillText("?", pos.x + pos.size / 2, pos.y + pos.size / 2);
      }
    }

    return canvas.toBuffer("image/png");
  } catch (error) {
    console.error("Failed to create team grid:", error);
    throw error;
  }
}

// ===========================================================
// Cache for Pokemon data
// ===========================================================
let pokemonCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

async function getPokemonCached() {
  const now = Date.now();
  if (pokemonCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return pokemonCache;
  }
  console.log(`📦 Loading Pokemon data (cache miss or expired)`);
  pokemonCache = await getAllPokemon();
  cacheTimestamp = now;
  return pokemonCache;
}

// ===========================================================
// 🌿 STARTER SELECTION - CAROUSEL WITH ANIMATED GIFS
// ===========================================================

const starterGenerations = [
  { name: "Kanto", ids: [1, 4, 7] },           // Bulbasaur, Charmander, Squirtle
  { name: "Johto", ids: [152, 155, 158] },     // Chikorita, Cyndaquil, Totodile
  { name: "Hoenn", ids: [252, 255, 258] },     // Treecko, Torchic, Mudkip
  { name: "Sinnoh", ids: [387, 390, 393] },    // Turtwig, Chimchar, Piplup
  { name: "Unova", ids: [495, 498, 501] }      // Snivy, Tepig, Oshawott
];

export async function starterSelection(interaction, user, trainerData, saveDataToDiscord) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 });
    }
  } catch (deferError) {
    console.error(`❌ Failed to defer interaction:`, deferError.message);
    return safeReply(interaction, { 
      content: `❌ Error: Interaction expired. Please try again.`, 
      flags: 64 
    }).catch(() => {});
  }

  try {
    const allPokemon = await getPokemonCached();
    
    // Build all starters in a flat list
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

    const buildCarousel = (index) => {
      const pokemon = allStarters[index];
      const genInfo = generationInfo.find(g => {
        let genCount = 0;
        for (const gen of starterGenerations) {
          if (genCount + gen.ids.length > index) {
            return true;
          }
          genCount += gen.ids.length;
        }
        return false;
      });

      // Find which generation this starter belongs to
      let genName = "Unknown";
      let genIndex = 0;
      let starterNumInGen = 0;
      let count = 0;

      for (let i = 0; i < starterGenerations.length; i++) {
        const gen = starterGenerations[i];
        const validCount = gen.ids.filter(id => allPokemon.find(p => p.id === id)).length;
        
        if (count + validCount > index) {
          genName = gen.name;
          genIndex = i;
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

      // Add type icon as thumbnail (top right)
      if (pokemon.types?.[0]) {
        const typeIconUrl = `${spritePaths.types}${pokemon.types[0]}.png`;
        embed.setThumbnail(typeIconUrl);
      }

      // Navigation buttons
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

    const { embed, buttons } = buildCarousel(currentIndex);
    await interaction.editReply({ embeds: [embed], components: [buttons] });

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
      if (i.customId === "next_starter") {
        currentIndex = Math.min(currentIndex + 1, allStarters.length - 1);
      } else if (i.customId === "prev_starter") {
        currentIndex = Math.max(currentIndex - 1, 0);
      } else if (i.customId === "select_starter") {
        // ✅ STOP COLLECTOR FIRST (prevents timeout error from "end" event)
        collector.stop();

        const selectedPokemon = allStarters[currentIndex];
        user.selectedStarter = selectedPokemon.id;
        user.onboardingComplete = true;
        user.displayedPokemon = [selectedPokemon.id];

        // ✅ Reply IMMEDIATELY
        await safeReply(i, {
          content: `✅ You chose **${selectedPokemon.name}**! Your adventure begins! 🚀\n\nRun \`/pokedex ${selectedPokemon.id}\` to view your starter's Pokédex entry.`,
          flags: 64
        });

        // ✅ Save asynchronously AFTER reply
        saveDataToDiscord(trainerData).catch(err => 
          console.error("Failed to save after starter selection:", err.message)
        );

        return;
      }

      const { embed: e, buttons: b } = buildCarousel(currentIndex);
      await i.deferUpdate();
      await i.editReply({ embeds: [e], components: [b] });
    });
  } catch (err) {
    console.error("starterSelection error:", err);
    await safeReply(interaction, {
      content: "❌ Failed to load starter selection.",
      flags: 64
    });
  }
}

// ===========================================================
// SHOW TRAINER CARD
// ===========================================================
export async function showTrainerCard(interaction, user) {
  try {
    // For button interactions, defer the update instead of a new reply
    if (interaction.isButton?.()) {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
    } else {
      // For slash commands or other interactions
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: 64 });
      }
    }

    const allPokemon = await getPokemonCached();

    // Get displayed Pokemon
    const displayedIds = user.displayedPokemon || [];
    if (displayedIds.length === 0) {
      return safeReply(interaction, {
        content: "❌ No Pokémon selected! Use 🔄 Change Team to select.",
        flags: 64
      });
    }

    const displayedPokemon = displayedIds.slice(0, 6)
      .map(id => allPokemon.find(p => p.id === id))
      .filter(Boolean);

    if (displayedPokemon.length === 0) {
      return safeReply(interaction, {
        content: "❌ Could not load Pokémon data.",
        flags: 64
      });
    }

    console.log(`🎴 Generating trainer card for ${interaction.user.username}...`);

    // Create team grid canvas (Pokemon 2-6)
    const teamGridBuffer = await createTeamGrid(displayedPokemon.slice(1), spritePaths);
    const teamGridAttachment = new AttachmentBuilder(teamGridBuffer, {
      name: "team-grid.png"
    });

    // Get trainer sprite if exists
    let trainerImageUrl = null;
    if (user.displayedTrainer) {
      trainerImageUrl = `https://your-domain.com/sprites/trainers/${user.displayedTrainer}`;
    }

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle(`🧬 ${interaction.user.username}'s Trainer Card`)
      .setDescription(
        `**Lead Pokémon:** ${displayedPokemon[0].name} #${displayedPokemon[0].id}\n\n` +
        `**Team:**\n` +
        displayedPokemon.map((p, i) =>
          `${i === 0 ? "⭐" : `${i + 1}.`} **${p.name}** (#${p.id})`
        ).join("\n")
      )
      .setColor(0x667eea)
      .setImage("attachment://team-grid.png")
      .setFooter({ text: `Total: ${displayedPokemon.length} Pokémon` });

    if (trainerImageUrl) {
      embed.setThumbnail(trainerImageUrl);
    }

    // Buttons
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("change_pokemon")
        .setLabel("🔄 Change Team")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("change_trainer")
        .setLabel("👤 Change Trainer")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("refresh_card")
        .setLabel("🔃 Refresh")
        .setStyle(ButtonStyle.Secondary)
    );

    // Use editReply for button interactions, editReply for slash command interactions
    if (interaction.isButton?.()) {
      await interaction.editReply({
        embeds: [embed],
        files: [teamGridAttachment],
        components: [buttons]
      });
    } else {
      await safeReply(interaction, {
        embeds: [embed],
        files: [teamGridAttachment],
        components: [buttons],
        flags: 64
      });
    }

    console.log(`✅ Trainer card displayed`);

  } catch (err) {
    console.error("showTrainerCard error:", err);
    await safeReply(interaction, {
      content: `❌ Failed to load trainer card: ${err.message}`,
      flags: 64
    });
  }
}

// ===========================================================
// CHANGE POKEMON HANDLER
// ===========================================================
async function handleChangePokemon(interaction, user, trainerData, saveDataToDiscord) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 });
    }

    const ownedPokemon = Object.keys(user.pokemon || {}).filter(id => {
      const p = user.pokemon[id];
      return (p?.normal > 0 || p?.shiny > 0) || (typeof p === "number" && p > 0);
    });
    
    if (ownedPokemon.length === 0) {
      return safeReply(interaction, { content: "❌ You don't have any Pokémon yet!", flags: 64 });
    }

    const allPokemon = await getPokemonCached();
    const pokemonPerPage = 12;
    const pages = [];
    for (let i = 0; i < ownedPokemon.length; i += pokemonPerPage) {
      pages.push(ownedPokemon.slice(i, i + pokemonPerPage));
    }

    let pageIndex = 0;
    let selectedPokemon = [...(user.displayedPokemon || [])].map(id => String(id));

    const buildPage = index => {
      const pagePokemon = pages[index];
      const embed = new EmbedBuilder()
        .setTitle("🧬 Select Your Displayed Pokémon")
        .setDescription(
          `Choose up to 6.\n\nSelected (${selectedPokemon.length}/6): ${
            selectedPokemon.map(id => allPokemon.find(p => String(p.id) === id)?.name).filter(Boolean).join(", ") || "None"
          }`
        )
        .setColor(0xe91e63)
        .setFooter({ text: `Page ${index + 1}/${pages.length}` });

      const buttons = pagePokemon.map(id => {
        const idStr = String(id);
        const name = allPokemon.find(p => String(p.id) === idStr)?.name || `#${id}`;
        const isSelected = selectedPokemon.includes(idStr);
        return new ButtonBuilder()
          .setCustomId(`toggle_pokemon_${idStr}`)
          .setLabel(name.substring(0, 80))
          .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Primary);
      });

      const rows = [];
      for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
      }

      if (pages.length > 1) {
        rows.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("pokemon_prev_page")
              .setLabel("⬅️")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(index === 0),
            new ButtonBuilder()
              .setCustomId("pokemon_next_page")
              .setLabel("➡️")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(index === pages.length - 1)
          )
        );
      }

      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("pokemon_clear")
            .setLabel("Clear")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("pokemon_save")
            .setLabel("💾 Save")
            .setStyle(ButtonStyle.Success)
        )
      );
      return { embed, components: rows };
    };

    const { embed, components } = buildPage(pageIndex);
    await interaction.editReply({ embeds: [embed], components });

    const collector = interaction.channel.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      componentType: ComponentType.Button,
      time: 120000
    });

    collector.on("collect", async i => {
      if (i.customId === "pokemon_next_page") {
        pageIndex++;
      } else if (i.customId === "pokemon_prev_page") {
        pageIndex--;
      } else if (i.customId.startsWith("toggle_pokemon_")) {
        const idStr = i.customId.replace("toggle_pokemon_", "");
        if (selectedPokemon.includes(idStr)) {
          selectedPokemon = selectedPokemon.filter(p => p !== idStr);
        } else if (selectedPokemon.length < 6) {
          selectedPokemon.push(idStr);
        } else {
          await i.deferUpdate();
          return await i.editReply({ content: "⚠️ Max 6 Pokémon." });
        }
      } else if (i.customId === "pokemon_clear") {
        selectedPokemon = [];
      } else if (i.customId === "pokemon_save") {
        user.displayedPokemon = selectedPokemon.map(id => Number(id));
        
        // ✅ Reply IMMEDIATELY
        await safeReply(i, { content: "✅ Pokémon updated!", flags: 64 });
        
        // ✅ Save asynchronously AFTER reply
        saveDataToDiscord(trainerData).catch(err => 
          console.error("Failed to save pokemon selection:", err.message)
        );
        
        return collector.stop();
      }

      const { embed: e, components: c } = buildPage(pageIndex);
      await i.deferUpdate();
      await i.editReply({ embeds: [e], components: c });
    });

    collector.on("end", async () => {
      try { await interaction.editReply({ components: [] }).catch(() => {}); } catch {}
    });
  } catch (err) {
    console.error("handleChangePokemon error:", err);
    await safeReply(interaction, { content: "❌ Failed to load pokemon selection.", flags: 64 });
  }
}

// ===========================================================
// CHANGE TRAINER HANDLER
// ===========================================================
async function handleChangeTrainer(interaction, user, trainerData, saveDataToDiscord) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 });
    }

    // Get available trainer sprites (placeholder - adjust based on your implementation)
    const trainerSprites = ["trainer1.png", "trainer2.png", "trainer3.png"];
    
    let pageIndex = 0;
    const trainersPerPage = 6;
    const pages = [];
    for (let i = 0; i < trainerSprites.length; i += trainersPerPage) {
      pages.push(trainerSprites.slice(i, i + trainersPerPage));
    }

    const buildPage = index => {
      const pageTrainers = pages[index];
      const embed = new EmbedBuilder()
        .setTitle("🧬 Select Your Trainer")
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
            new ButtonBuilder()
              .setCustomId("trainer_prev_page")
              .setLabel("⬅️")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(index === 0),
            new ButtonBuilder()
              .setCustomId("trainer_next_page")
              .setLabel("➡️")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(index === pages.length - 1)
          )
        );
      }
      return { embed, components: rows };
    };

    const { embed, components } = buildPage(pageIndex);
    await interaction.editReply({ embeds: [embed], components });

    const collector = interaction.channel.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      componentType: ComponentType.Button,
      time: 60000
    });

    collector.on("collect", async i => {
      if (i.customId === "trainer_next_page") {
        pageIndex++;
      } else if (i.customId === "trainer_prev_page") {
        pageIndex--;
      } else if (i.customId.startsWith("select_trainer_")) {
        const selectedTrainer = i.customId.replace("select_trainer_", "");
        user.displayedTrainer = selectedTrainer;
        
        // ✅ Reply IMMEDIATELY
        await safeReply(i, { content: `✅ Trainer changed!`, flags: 64 });
        
        // ✅ Save asynchronously AFTER reply
        saveDataToDiscord(trainerData).catch(err => 
          console.error("Failed to save trainer selection:", err.message)
        );
        
        return collector.stop();
      }

      const { embed: e, components: c } = buildPage(pageIndex);
      await i.deferUpdate();
      await i.editReply({ embeds: [e], components: c });
    });

    collector.on("end", async () => {
      try { await interaction.editReply({ components: [] }).catch(() => {}); } catch {}
    });
  } catch (err) {
    console.error("handleChangeTrainer error:", err);
    await safeReply(interaction, { content: "❌ Failed to load trainer selection.", flags: 64 });
  }
}

// ===========================================================
// BUTTON HANDLER
// ===========================================================
export async function handleTrainerCardButtons(interaction, trainerData, saveDataToDiscord) {
  const userId = interaction.user.id;
  const user = trainerData[userId];

  if (!user) {
    return safeReply(interaction, { content: "❌ Could not find your trainer data.", flags: 64 });
  }

  switch (interaction.customId) {
    case "refresh_card":
      return await showTrainerCard(interaction, user);

    case "change_trainer":
      return await handleChangeTrainer(interaction, user, trainerData, saveDataToDiscord);

    case "change_pokemon":
      return await handleChangePokemon(interaction, user, trainerData, saveDataToDiscord);

    default:
      await safeReply(interaction, { content: "❌ Unknown button action.", flags: 64 });
  }
}