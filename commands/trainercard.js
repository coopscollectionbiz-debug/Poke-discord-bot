// /trainercard.js (COMPLETE VERSION - URL-AWARE)
// Coop's Collection Discord Bot — Full Implementation with safeReply()
// Handles both local files and remote URLs
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
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
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
    const pokemonId = url.split('/').pop().replace('.gif', '');
    const filename = `${baseName}_${i}_${pokemonId}.gif`;
    
    const localPath = await downloadSpriteToTemp(url, filename);
    localPaths.push(localPath);
  }
  return localPaths;
}

// ===========================================================
// 🌿 STARTER SELECTION
// ===========================================================

// 5 starters for each type (Grass, Fire, Water) - one from each generation
const starterIDs = [
  // Grass starters: Bulbasaur, Chikorita, Treecko, Turtwig, Snivy
  1, 152, 252, 387, 495,
  // Fire starters: Charmander, Cyndaquil, Torchic, Chimchar, Tepig
  4, 155, 255, 390, 498,
  // Water starters: Squirtle, Totodile, Mudkip, Piplup, Oshawott
  7, 158, 258, 393, 501
];

// Cache for Pokemon data to avoid repeated slow loads
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

export async function starterSelection(interaction, user, trainerData, saveDataToDiscord) {
  // ✅ CRITICAL: Defer BEFORE any async work - must happen within 3 seconds
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 }); // 64 = MessageFlags.Ephemeral
    }
  } catch (deferError) {
    console.error(`❌ Failed to defer interaction:`, deferError.message);
    return safeReply(interaction, { content: `❌ Error: Interaction expired. Please try again.`, flags: 64 }).catch(() => {});
  }

  try {
    const allPokemon = await getPokemonCached();
    const starters = allPokemon.filter(p => starterIDs.includes(Number(p.id)));

    if (!starters || starters.length === 0) {
      throw new Error("No starter pokemon found");
    }

    // Group starters by primary type
    const grouped = {};
    for (const p of starters) {
      const t = p.types?.[0];
      if (!t) continue;
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(p);
    }

    const order = [12, 10, 11]; // Grass, Fire, Water
    const sortedTypes = Object.keys(grouped)
      .map(Number)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));

    if (sortedTypes.length === 0) {
      throw new Error("No starter types found");
    }

    // ✅ Ensure temp directory exists
    const tempDir = path.resolve("./temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 🧩 Build each page dynamically
    const buildPage = async index => {
      try {
        const typeId = sortedTypes[index];
        const typeName = typeMap[typeId];
        const list = grouped[typeId];

        if (!list || list.length === 0) {
          throw new Error(`No pokemon for type ${typeId}`);
        }

        // ✅ Build GIF paths - handle both URLs and local paths
        const gifPaths = list.map(p => `${spritePaths.pokemon}${p.id}.gif`);
        const isUrlPath = isUrl(gifPaths[0]);
        
        console.log(`📸 Building page for ${typeName} with ${list.length} Pokemon: ${list.map(p => p.name).join(", ")}`);
        console.log(`🎬 GIF paths (${isUrlPath ? "URL" : "LOCAL"}): ${gifPaths.join(", ")}`);

        const output = path.resolve(`./temp/${typeName}_starters.gif`);
        let combinedGif = null;

        try {
          // If URLs, download to temp first
          let pathsToCompose = gifPaths;
          if (isUrlPath) {
            console.log(`⬇️  Downloading ${gifPaths.length} remote sprites to temp...`);
            pathsToCompose = await downloadSpritesToTemp(gifPaths, typeName);
            console.log(`✅ All sprites downloaded locally`);
            console.log(`📍 Paths to compose: ${pathsToCompose.join(", ")}`);
          }

          // Verify all files exist before composing
          const missingFiles = pathsToCompose.filter(p => !fs.existsSync(p));
          if (missingFiles.length > 0) {
            throw new Error(`Missing files: ${missingFiles.join(", ")}`);
          }

          // Now compose the GIFs (either local or downloaded)
          console.log(`⏳ Combining ${pathsToCompose.length} GIFs into: ${output}`);
          console.log(`🎬 GIF paths: ${pathsToCompose.map(p => `"${p}"`).join(" ")}`);
          await combineGifsHorizontal(pathsToCompose, output);
          
          if (fs.existsSync(output)) {
            const stats = fs.statSync(output);
            console.log(`✅ GIF composed successfully (${stats.size} bytes): ${output}`);
            combinedGif = new AttachmentBuilder(output, { name: `${typeName}_starters.gif` });
          } else {
            console.warn(`⚠️ GIF file not created at: ${output}`);
          }
        } catch (gifError) {
          console.error(`❌ GIF composition failed: ${gifError.message}`);
          console.error(`❌ Stack: ${gifError.stack}`);
          console.warn(`⚠️ Falling back to first image for ${typeName}`);
          combinedGif = null;
        }

        // Type sprite header (could be URL or local)
        const typeSprite = `${spritePaths.types}${typeId}.png`;

        const embed = new EmbedBuilder()
          .setTitle(`🌟 Choose Your Starter Pokémon`)
          .setDescription(
            `**Type:** ${typeName}\n\nClick the button for your starter!`
          )
          .setThumbnail(typeSprite)
          .setColor(0x43b581)
          .setFooter({ text: `Page ${index + 1}/${sortedTypes.length}` });

        // If we have a combined GIF file, use it; otherwise use first pokemon URL
        if (combinedGif) {
          embed.setImage(`attachment://${typeName}_starters.gif`);
        } else if (gifPaths.length > 0 && isUrl(gifPaths[0])) {
          embed.setImage(gifPaths[0]); // Use URL directly
        } else if (gifPaths.length > 0) {
          // Try to load as local file
          try {
            const localPath = gifPaths[0].replace(/^\/+/, './');
            if (fs.existsSync(localPath)) {
              const attachment = new AttachmentBuilder(localPath, { name: `${typeName}_sprite.gif` });
              return { 
                embed: embed.setImage(`attachment://${typeName}_sprite.gif`), 
                components: buildButtons(list, index, sortedTypes.length),
                files: [attachment]
              };
            }
          } catch (err) {
            console.warn(`⚠️ Failed to load local file: ${gifPaths[0]}`);
          }
        }

        return { 
          embed, 
          components: buildButtons(list, index, sortedTypes.length),
          files: combinedGif ? [combinedGif] : []
        };
      } catch (err) {
        console.error(`❌ buildPage error:`, err);
        throw err;
      }
    };

    const buildButtons = (list, index, totalPages) => {
      const rows = [];
      
      // Create all starter buttons
      const buttons = list.map(p =>
        new ButtonBuilder()
          .setCustomId(`starter_${p.id}`)
          .setLabel(p.name.substring(0, 20))
          .setStyle(ButtonStyle.Primary)
      );
      
      // ✅ Put ALL selection buttons on ONE row
      // Discord limit: max 5 buttons per row
      if (buttons.length > 0) {
        const selectionRow = new ActionRowBuilder().addComponents(buttons);
        rows.push(selectionRow);
      }

      // Add navigation row separately
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
          .setDisabled(index === totalPages - 1)
      );
      rows.push(navRow);

      return rows;
    };

    // ── Show first page ───────────────────────────────
    let page = 0;
    const { embed, components, files } = await buildPage(page);
    await interaction.editReply({ embeds: [embed], components, files });

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
      try {
        if (i.user.id !== interaction.user.id)
          return safeReply(i, { content: "Not your onboarding!", flags: 64 });

        if (i.customId === "next_page" || i.customId === "prev_page") {
          page += i.customId === "next_page" ? 1 : -1;
          const { embed: e, components: c, files: f } = await buildPage(page);
          await i.deferUpdate();
          await i.editReply({ embeds: [e], components: c, files: f });
        } else if (i.customId.startsWith("starter_")) {
          const pokemonId = Number(i.customId.replace("starter_", ""));
          const selectedPokemon = allPokemon.find(p => Number(p.id) === pokemonId);

          if (!selectedPokemon) {
            await i.deferUpdate();
            return await i.editReply({ content: "❌ Pokémon not found." });
          }

          user.starterPokemon = pokemonId;
          user.pokemon = user.pokemon || {};
          user.pokemon[pokemonId] = user.pokemon[pokemonId] || { normal: 0, shiny: 0 };

          const isShiny = rollForShiny();
          if (isShiny) {
            user.pokemon[pokemonId].shiny = (user.pokemon[pokemonId].shiny || 0) + 1;
          } else {
            user.pokemon[pokemonId].normal = (user.pokemon[pokemonId].normal || 0) + 1;
          }

          user.displayedPokemon = [pokemonId];
          
          await saveDataToDiscord(trainerData);
          await i.deferUpdate();

          // ✅ Show trainer selection instead of ending
          const successEmbed = new EmbedBuilder()
            .setTitle("🎉 Welcome, Trainer!")
            .setDescription(`You've chosen **${selectedPokemon.name}**!${isShiny ? " ✨ (Shiny!)" : ""}`)
            .setColor(0x43b581);

          await i.editReply({ embeds: [successEmbed], components: [] });
          collector.stop();
          return await trainerSelection(interaction, user, trainerData, saveDataToDiscord);
        }
      } catch (err) {
        console.error(`❌ starterSelection collector error:`, err);
        try {
          await i.deferUpdate().catch(() => {});
          await i.editReply({ content: "❌ An error occurred.", components: [] }).catch(() => {});
        } catch {}
      }
    });

    collector.on("end", () => {
      console.log("Starter selection timed out");
    });
  } catch (err) {
    console.error("❌ starterSelection error:", err);
    await safeReply(interaction, { content: `❌ Error during startup: ${err.message}`, flags: 64 });
  }
}

// ===========================================================
// TRAINER SELECTION (after starter pokemon chosen)
// ===========================================================
async function trainerSelection(interaction, user, trainerData, saveDataToDiscord) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 });
    }

    const trainers = [
      { id: "youngster-gen4.png", name: "Youngster", emoji: "👦", color: 0x43b581 },
      { id: "rival-gen3.png", name: "Rival", emoji: "😤", color: 0xff6b6b },
      { id: "gym-leader.png", name: "Gym Leader", emoji: "💪", color: 0xffd700 }
    ];

    let index = 0;

    const renderEmbed = page => {
      const t = trainers[page];
      return new EmbedBuilder()
        .setTitle(`🧍 Choose Your Trainer Sprite`)
        .setDescription(`Select: ${t.emoji} **${t.name}**`)
        .setColor(t.color)
        .setThumbnail(`${spritePaths.trainers}${t.id}`)
        .setFooter({ text: `${page + 1}/${trainers.length}` });
    };

    const getButtons = page => {
      const btns = [];
      if (page > 0) {
        btns.push(new ButtonBuilder()
          .setCustomId("prev_trainer")
          .setEmoji("⬅️")
          .setStyle(ButtonStyle.Secondary));
      }
      btns.push(new ButtonBuilder()
        .setCustomId("confirm_trainer")
        .setLabel(`Select ${trainers[page].name}`)
        .setEmoji(trainers[page].emoji)
        .setStyle(ButtonStyle.Success));
      if (page < trainers.length - 1) {
        btns.push(new ButtonBuilder()
          .setCustomId("next_trainer")
          .setEmoji("➡️")
          .setStyle(ButtonStyle.Secondary));
      }
      return new ActionRowBuilder().addComponents(btns);
    };

    const embed = renderEmbed(index);
    const row = getButtons(index);
    await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = interaction.channel.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      componentType: ComponentType.Button,
      time: 60000
    });

    collector.on("collect", async i => {
      if (i.user.id !== interaction.user.id) {
        return safeReply(i, { content: "This isn't your selection!", flags: 64 });
      }

      if (i.customId === "next_trainer") {
        index = Math.min(index + 1, trainers.length - 1);
      } else if (i.customId === "prev_trainer") {
        index = Math.max(index - 1, 0);
      } else if (i.customId === "confirm_trainer") {
        const choice = trainers[index];
        user.trainers[choice.id] = true;
        user.displayedTrainer = choice.id;
        user.onboardingComplete = true;
        user.onboardingDate = new Date().toISOString();
        
        await saveDataToDiscord(trainerData);
        await safeReply(i, {
          content: `✅ You chose **${choice.name}** ${choice.emoji}!`,
          flags: 64
        });
        collector.stop("confirmed");
        return await showTrainerCard(i, user);
      }

      const newEmbed = renderEmbed(index);
      const newRow = getButtons(index);
      await i.deferUpdate();
      await i.editReply({ embeds: [newEmbed], components: [newRow] });
    });

    collector.on("end", async (_, reason) => {
      if (reason !== "confirmed") {
        try { await interaction.editReply({ components: [] }).catch(() => {}); } catch {}
      }
    });
  } catch (err) {
    console.error("❌ trainerSelection error:", err);
    await safeReply(interaction, {
      content: "❌ Failed to load trainer selection.",
      flags: 64
    });
  }
}

// ===========================================================
// SHOW TRAINER CARD
// ===========================================================
export async function showTrainerCard(interaction, user) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 });
    }

    const username = interaction?.user?.username || user.name || "Trainer";
    const avatarURL = interaction.user?.displayAvatarURL({ extension: "png", size: 128 });

    // ✅ Ensure temp directory exists
    const tempDir = path.resolve("./temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // === 1️⃣ Trainer Sprite =================================================
    const trainerPath = user.displayedTrainer
      ? `${spritePaths.trainers}${user.displayedTrainer}`
      : `${spritePaths.trainers}default.png`;

    // === 2️⃣ Pokémon GIF Strip =============================================
    const displayed = user.displayedPokemon?.slice(0, 6) || [];
    const owned = displayed.filter(id => id && user.pokemon[id]);
    let combinedGifAttachment = null;

    if (owned.length > 0) {
      try {
        const gifPaths = owned.map(id => `${spritePaths.pokemon}${id}.gif`);
        const output = path.resolve(`./temp/${username}_team.gif`);
        const isUrlPath = isUrl(gifPaths[0]);
        
        // If URLs, download to temp first
        let pathsToCompose = gifPaths;
        if (isUrlPath) {
          console.log(`⬇️  Downloading ${gifPaths.length} team sprites to temp...`);
          pathsToCompose = await downloadSpritesToTemp(gifPaths, `${username}_team`);
        }

        // Compose the GIFs
        await combineGifsHorizontal(pathsToCompose, output);
        if (fs.existsSync(output)) {
          combinedGifAttachment = new AttachmentBuilder(output, { name: "team.gif" });
        }
      } catch (gifErr) {
        console.warn("⚠️ Failed to combine GIFs:", gifErr.message);
        // Continue without GIF - will show stats instead
      }
    }

    // === 3️⃣ Stats + Embed ==================================================
    const rank = getRank(user.tp || 0);
    const pokemonOwned = Object.keys(user.pokemon || {}).length;
    const shinyCount = Object.values(user.pokemon || {}).filter(p => p?.shiny > 0).length;
    const trainerCount = Object.keys(user.trainers || {}).length;

    const embed = new EmbedBuilder()
      .setAuthor({ name: `${username}'s Trainer Card`, iconURL: avatarURL })
      .setColor(0xffcb05)
      .setDescription(
        `🏆 **Rank:** ${rank?.title || "Beginner"}\n` +
        `⭐ **TP:** ${user.tp || 0}\n` +
        `💰 **CC:** ${user.cc || 0}\n\n` +
        `📊 **Pokémon:** ${pokemonOwned}\n` +
        `✨ **Shiny:** ${shinyCount}\n` +
        `🧍 **Trainers:** ${trainerCount}`
      )
      .setThumbnail(trainerPath)
      .setFooter({ text: "Coop's Collection • /trainercard" });

    // Only set image if we have a local GIF file
    if (combinedGifAttachment) {
      embed.setImage(`attachment://team.gif`);
    } else if (owned.length > 0) {
      // Show first pokemon if we have URLs
      const firstPokemonId = owned[0];
      const firstPokemonUrl = `${spritePaths.pokemon}${firstPokemonId}.gif`;
      if (isUrl(firstPokemonUrl)) {
        embed.setImage(firstPokemonUrl);
      }
    }

    // === 4️⃣ Action Buttons ================================================
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("change_trainer")
        .setLabel("Trainer")
        .setEmoji("🧍")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("change_pokemon")
        .setLabel("Pokémon")
        .setEmoji("🧬")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("refresh_card")
        .setLabel("Refresh")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary)
    );

    // === 5️⃣ Reply ==========================================================
    const files = combinedGifAttachment ? [combinedGifAttachment] : [];
    if (interaction.replied) {
      await interaction.editReply({ embeds: [embed], files, components: [row] });
    } else {
      await interaction.editReply({ embeds: [embed], files, components: [row] });
    }

  } catch (err) {
    console.error("showTrainerCard error:", err);
    await safeReply(interaction, { content: "❌ Failed to show Trainer Card.", flags: 64 });
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

    const ownedTrainers = Object.keys(user.trainers || {}).filter(t => user.trainers[t]);
    if (ownedTrainers.length === 0) {
      return safeReply(interaction, { content: "❌ You don't have any trainers yet!", flags: 64 });
    }

    const trainersPerPage = 5;
    const pages = [];
    for (let i = 0; i < ownedTrainers.length; i += trainersPerPage) {
      pages.push(ownedTrainers.slice(i, i + trainersPerPage));
    }
    let pageIndex = 0;

    const buildPage = index => {
      const pageTrainers = pages[index];
      const embed = new EmbedBuilder()
        .setTitle("🧍 Select Your Displayed Trainer")
        .setDescription(
          `${pageTrainers
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
        await saveDataToDiscord(trainerData);
        await safeReply(i, { content: `✅ Trainer changed!`, flags: 64 });
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
        await saveDataToDiscord(trainerData);
        await safeReply(i, { content: "✅ Pokémon updated!", flags: 64 });
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
      return showTrainerCard(interaction, user);

    case "change_trainer":
      return handleChangeTrainer(interaction, user, trainerData, saveDataToDiscord);

    case "change_pokemon":
      return handleChangePokemon(interaction, user, trainerData, saveDataToDiscord);

    default:
      await safeReply(interaction, { content: "❌ Unknown button action.", flags: 64 });
  }
}