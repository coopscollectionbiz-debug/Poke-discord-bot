// /commands/trainercard.js
// Coop's Collection Discord Bot — Trainer Card Command
// Canvas-based display: Trainer Sprite | Lead Pokemon | 5 Pokemon Grid
// ===========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType
} from "discord.js";
import { rollForShiny } from "../shinyOdds.js";
import { spritePaths } from "../spriteconfig.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { getRank } from "../utils/rankSystem.js";
import { validateUserSchema, createNewUser } from "../utils/userSchema.js";
import { safeReply } from "../utils/safeReply.js";
import { createSafeCollector } from "../utils/safeCollector.js";


// ===========================================================
// SLASH COMMAND
// ===========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("trainercard")
    .setDescription("View or create your Trainer Card!"),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, reloadUserFromDiscord, ensureUserInitialized) {
    // ✅ Defer the interaction once at the start
    await interaction.deferReply({ flags: 64 });

    const userId = interaction.user.id;
    const username = interaction.user.username;

    console.log(`📋 User lookup for ${username}`);

    // ✅ Use shared helper to ensure user is properly initialized
    const user = await ensureUserInitialized(userId, username, trainerData, reloadUserFromDiscord);

    console.log(`📋 User state:`, {
      onboardingComplete: user.onboardingComplete,
      onboardingStage: user.onboardingStage
    });

    // ✅ Check onboarding progress
    if (!user.onboardingComplete) {
      if (!user.onboardingStage || user.onboardingStage === "starter_selection") {
        // Show starter selection
        console.log(`🎪 Showing starter selection`);
        return starterSelection(interaction, user, trainerData, saveDataToDiscord);
      } else if (user.onboardingStage === "trainer_selection") {
        // Show trainer selection
        console.log(`🧍 Showing trainer selection`);
        return trainerSelection(interaction, user, trainerData, saveDataToDiscord);
      }
    }

    // ✅ Onboarding complete - show trainer card
    console.log(`✅ Onboarding complete - showing trainer card`);
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

const starterGenerations = [
  { name: "Kanto", ids: [1, 4, 7] },           // Bulbasaur, Charmander, Squirtle
  { name: "Johto", ids: [152, 155, 158] },     // Chikorita, Cyndaquil, Totodile
  { name: "Hoenn", ids: [252, 255, 258] },     // Treecko, Torchic, Mudkip
  { name: "Sinnoh", ids: [387, 390, 393] },    // Turtwig, Chimchar, Piplup
  { name: "Unova", ids: [495, 498, 501] }      // Snivy, Tepig, Oshawott
];

// ===========================================================
// 🌿 STARTER SELECTION - TYPE SPRITE HEADER + ANIMATED GIF GRID
// ===========================================================

export async function starterSelection(interaction, user, trainerData, saveDataToDiscord) {
  try {
    const allPokemon = await getAllPokemon();
    
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

    const buildCarousel = async (index) => {
      const pokemon = allStarters[index];
      
      // Find which generation this starter belongs to
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

      // Add type icon as thumbnail
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

    const { embed, buttons } = await buildCarousel(currentIndex);
    const reply = await interaction.editReply({ embeds: [embed], components: [buttons] });

    // Create collector on the message
    const collector = reply.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      componentType: ComponentType.Button,
      time: 120000
    });

    collector.on("collect", async i => {
      if (i.customId === "select_starter") {
        // ✅ DEFER UPDATE
        await i.deferUpdate().catch(err => {
          console.warn("Failed to defer update:", err.message);
        });
        
        // ✅ STOP COLLECTOR
        collector.stop();

        const selectedPokemon = allStarters[currentIndex];
        user.selectedStarter = selectedPokemon.id;
        user.displayedPokemon = [selectedPokemon.id];
        user.onboardingStage = "trainer_selection";
        
        // Add to pokemon collection with shiny roll
        const isShiny = rollForShiny(user.tp);
        user.pokemon[selectedPokemon.id] = { normal: isShiny ? 0 : 1, shiny: isShiny ? 1 : 0 };

        // ✅ Ensure the user object in trainerData is updated
        trainerData[interaction.user.id] = user;

        console.log(`✅ Starter selected: ${selectedPokemon.name}`);
        console.log(`👤 Final user state before save:`, {
          selectedStarter: trainerData[interaction.user.id].selectedStarter,
          onboardingStage: trainerData[interaction.user.id].onboardingStage,
          displayedPokemon: trainerData[interaction.user.id].displayedPokemon
        });

        // ✅ Save data IMMEDIATELY and AWAIT completion
        try {
          await saveDataToDiscord(trainerData);
          console.log(`✅ Starter selection saved`);
        } catch (err) {
          console.error("Failed to save after starter selection:", err.message);
        }

        // ✅ Explicitly update memory copy again after save to prevent stale references
        trainerData[interaction.user.id] = user;
        console.log(`🔄 Memory copy updated after save`);

        // ✅ Show trainer selection next
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

      // For next/prev buttons, defer and update
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

    // Cleanup when collector ends
    collector.on("end", async (_, reason) => {
      if (reason !== "user") {
        try {
          await interaction.editReply({ components: [] }).catch(() => {});
        } catch {}
      }
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
      return safeReply(i, { content: "This isn't your selection!", flags: 64 });
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

        // ✅ Ensure the user object in trainerData is updated
        trainerData[interaction.user.id] = user;

        console.log(`✅ Trainer confirmed: ${choice.label}`);
        console.log(`👤 Final user state before save:`, {
          onboardingComplete: trainerData[interaction.user.id].onboardingComplete,
          onboardingStage: trainerData[interaction.user.id].onboardingStage,
          displayedTrainer: trainerData[interaction.user.id].displayedTrainer
        });

        // ✅ Save data IMMEDIATELY and AWAIT completion
        try {
          await saveDataToDiscord(trainerData);
          console.log(`✅ Trainer selection saved - onboarding complete`);
        } catch (err) {
          console.error("Failed to save after trainer selection:", err.message);
        }

        // ✅ Explicitly update memory copy again after save to prevent stale references
        trainerData[interaction.user.id] = user;
        console.log(`🔄 Memory copy updated after save`);

        await i.deferUpdate();
        await safeReply(i, { content: `✅ You chose **${choice.label}** as your Trainer!`, flags: 64 });
        collector.stop("confirmed");
        return await showTrainerCard(interaction, user);
      }
    }
    
    // Update for next/prev navigation
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
// 🧑 SHOW TRAINER CARD
// ===========================================================

export async function showTrainerCard(interaction, user) {
  try {
    const username = interaction?.user?.username || user.name || "Trainer";
    const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });

    console.log(`🎴 Showing trainer card for ${username}`);
    console.log(`👤 User data:`, {
      displayedTrainer: user.displayedTrainer,
      displayedPokemon: user.displayedPokemon,
      onboardingComplete: user.onboardingComplete,
      onboardingStage: user.onboardingStage
    });

    // === 1️⃣ Trainer Sprite =====================================================
    const trainerPath = user.displayedTrainer
      ? `${spritePaths.trainers}${user.displayedTrainer}`
      : null;

    console.log(`🧍 Trainer sprite URL:`, trainerPath);

    // === 2️⃣ Pokémon Info ====================================================
    const displayed = user.displayedPokemon?.slice(0, 6) || [];
    const allPokemon = await getAllPokemon();
    const pokemonInfo = displayed
      .map(id => allPokemon.find(p => p.id === id))
      .filter(Boolean);

    console.log(`🎮 Pokémon info:`, pokemonInfo.map(p => ({ name: p.name, id: p.id })));

    // === 3️⃣ Stats + Embed ====================================================
    const rank = getRank(user.tp);
    const pokemonOwned = Object.keys(user.pokemon || {}).length;
    const shinyCount = Object.values(user.pokemon || {}).filter(p => p.shiny > 0).length;
    const trainerCount = Object.keys(user.trainers || {}).length;

    const teamDisplay = pokemonInfo.length > 0 
      ? pokemonInfo.map((p, i) => `${i === 0 ? "⭐" : `${i + 1}.`} **${p.name}** (#${p.id})`).join("\n")
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

    // Add trainer thumbnail if available
    if (trainerPath) {
      embed.setThumbnail(trainerPath);
    }

    // === 4️⃣ Action Buttons ===================================================
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("change_trainer").setLabel("Change Trainer").setEmoji("🧍").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("change_pokemon").setLabel("Change Pokémon").setEmoji("🧬").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("refresh_card").setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("share_public").setLabel("Share Public").setEmoji("🌐").setStyle(ButtonStyle.Success)
    );

    // === 5️⃣ Reply ============================================================
    await safeReply(interaction, { embeds: [embed], components: [row], flags: 64 });
    console.log(`✅ Trainer card displayed`);

  } catch (err) {
    console.error("showTrainerCard error:", err);
    await safeReply(interaction, { content: "❌ Failed to show Trainer Card.", flags: 64 });
  }
}

// ===========================================================
// CHANGE TRAINER HANDLER
// ===========================================================
async function handleChangeTrainer(interaction, user, trainerData, saveDataToDiscord) {
  const ownedTrainers = Object.keys(user.trainers || {}).filter(t => user.trainers[t]);
  if (ownedTrainers.length === 0)
    return safeReply(interaction, { content: "❌ You don't have any trainers yet!", flags: 64 });

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
  const msg = await safeReply(interaction, { embeds: [embed], components, flags: 64 });

  // Fetch the reply to get message object for message-specific collector
  const message = await interaction.fetchReply().catch(() => msg);
  
  const collector = message
    ? message.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        componentType: ComponentType.Button,
        time: 60000
      })
    : interaction.channel.createMessageComponentCollector({
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
      await safeReply(i, { content: `✅ Trainer changed to **${selectedTrainer}**!`, flags: 64 });
      return collector.stop();
    }

    const { embed: e, components: c } = buildPage(pageIndex);
    await i.deferUpdate();
    await i.editReply({ embeds: [e], components: c });
  });

  collector.on("end", async () => {
    try { await safeReply(interaction, { content: "⏱️ Selection timed out.", flags: 64 }); } catch {}
  });
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
    return safeReply(interaction, { content: "❌ You don't have any Pokémon yet!", flags: 64 });

  const allPokemon = await getAllPokemon();
  const pokemonPerPage = 12;
  const pages = [];
  for (let i = 0; i < ownedPokemon.length; i += pokemonPerPage)
    pages.push(ownedPokemon.slice(i, i + pokemonPerPage));

  let pageIndex = 0;
  let selectedPokemon = [...(user.displayedPokemon || [])].map(id => String(id));

  const buildPage = index => {
    const pagePokemon = pages[index];
    const embed = new EmbedBuilder()
      .setTitle("🧬 Select Your Displayed Pokémon")
      .setDescription(
        `Choose up to 6 Pokémon.\n\nSelected (${selectedPokemon.length}/6): ${
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
    for (let i = 0; i < buttons.length; i += 5)
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));

    if (pages.length > 1) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("pokemon_prev_page").setLabel("⬅️").setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
          new ButtonBuilder().setCustomId("pokemon_next_page").setLabel("➡️").setStyle(ButtonStyle.Secondary).setDisabled(index === pages.length - 1)
        )
      );
    }

    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("pokemon_clear").setLabel("Clear").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("pokemon_save").setLabel("💾 Save").setStyle(ButtonStyle.Success)
      )
    );
    return { embed, components: rows };
  };

  const { embed, components } = buildPage(pageIndex);
  const msg = await safeReply(interaction, { embeds: [embed], components, flags: 64 });

  // Fetch the reply to get message object for message-specific collector
  const message = await interaction.fetchReply().catch(() => msg);
  
  const collector = message
    ? message.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        componentType: ComponentType.Button,
        time: 120000
      })
    : interaction.channel.createMessageComponentCollector({
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
    try { await safeReply(interaction, { content: "⏱️ Selection timed out.", flags: 64 }); } catch {}
  });
}

// ===========================================================
// BUTTON HANDLER
// ===========================================================
export async function handleTrainerCardButtons(interaction, trainerData, saveDataToDiscord) {
  const userId = interaction.user.id;
  const user = trainerData[userId];

  if (!user)
    return safeReply(interaction, { content: "❌ Could not find your trainer data.", flags: 64 });

  switch (interaction.customId) {
    case "refresh_card":
      return showTrainerCard(interaction, user);

    case "share_public":
      await safeReply(interaction, { content: "✅ Shared publicly!", flags: 64 });
      return showTrainerCard(interaction, user);

    case "change_trainer":
      return handleChangeTrainer(interaction, user, trainerData, saveDataToDiscord);

    case "change_pokemon":
      return handleChangePokemon(interaction, user, trainerData, saveDataToDiscord);

    default:
      await safeReply(interaction, { content: "❌ Unknown button action.", flags: 64 });
  }
}