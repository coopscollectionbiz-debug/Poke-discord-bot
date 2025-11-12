// ==========================================================
// /addinventory — Expanded Admin Command (v2.2)
// ==========================================================
// Supports:
//  • Pokémon (normal / shiny)
//  • Trainers
//  • Shop Items (Evolution Stone, etc.)
// ❌ Starter Pack intentionally excluded
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { findPokemonByName, getFlattenedTrainers } from "../utils/dataLoader.js";
import { getTrainerKey, findTrainerByQuery } from "../utils/trainerFileHandler.js";
import { atomicSave } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

// ==========================================================
// 🪙 Grantable Items (match /shop)
// ==========================================================
const SHOP_ITEMS = {
  evolution_stone: {
    id: "evolution_stone",
    name: "Evolution Stone",
    emoji: "<:evolution_stone:1437892171381473551>",
  },
  // ❌ Starter Pack purposely excluded from this list
};

export default {
  data: new SlashCommandBuilder()
    .setName("addinventory")
    .setDescription("Add a Pokémon, Trainer, or Item to a user's inventory (Admin only).")
    .addUserOption(option =>
      option.setName("user").setDescription("Target user").setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("type")
        .setDescription("Type to add")
        .addChoices(
          { name: "Pokémon", value: "pokemon" },
          { name: "Trainer", value: "trainer" },
          { name: "Item", value: "item" }
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("Name of the Pokémon, Trainer, or Item")
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName("shiny").setDescription("Add as shiny (for Pokémon only)")
    )
    .addIntegerOption(option =>
      option.setName("quantity").setDescription("Quantity to add (default 1)")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    await interaction.deferReply({ ephemeral: true });

    // 🔒 Permission check
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, {
        content: "⛔ You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser("user");
    const type = interaction.options.getString("type");
    const name = interaction.options.getString("name");
    const shiny = interaction.options.getBoolean("shiny") || false;
    const quantity = interaction.options.getInteger("quantity") || 1;
    const userData = await ensureUserInitialized(targetUser.id, targetUser.username, trainerData, client);

    try {
      // ======================================================
      // 🟢 Pokémon
      // ======================================================
      if (type === "pokemon") {
        const pokemon = await findPokemonByName(name);
        if (!pokemon)
          return safeReply(interaction, { content: `⛔ Pokémon "${name}" not found.`, ephemeral: true });

        if (!userData.pokemon[pokemon.id]) userData.pokemon[pokemon.id] = { normal: 0, shiny: 0 };
        if (shiny) userData.pokemon[pokemon.id].shiny += quantity;
        else userData.pokemon[pokemon.id].normal += quantity;

        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

        return safeReply(interaction, {
          content: `✅ Added **${quantity}× ${shiny ? "Shiny " : ""}${pokemon.name}** to **${targetUser.username}**.`,
          ephemeral: true,
        });
      }

      // ======================================================
      // 🔵 Trainer
      // ======================================================
      if (type === "trainer") {
        const allTrainers = await getFlattenedTrainers();
        const trainer = findTrainerByQuery(allTrainers, name);
        if (!trainer)
          return safeReply(interaction, { content: `⛔ Trainer "${name}" not found.`, ephemeral: true });

        const trainerKey = getTrainerKey(trainer);
        userData.trainers[trainerKey] = true;

        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

        return safeReply(interaction, {
          content: `✅ Added **${trainer.name}** to **${targetUser.username}**.`,
          ephemeral: true,
        });
      }

      // ======================================================
      // 🟣 Item (Shop-based)
      // ======================================================
      if (type === "item") {
        const key = name.toLowerCase().replace(/\s+/g, "_");
        const item = SHOP_ITEMS[key];
        if (!item)
          return safeReply(interaction, {
            content: `⛔ Item "${name}" not recognized or not grantable.`,
            ephemeral: true,
          });

        userData.items ??= {};
        userData.items[item.id] ??= 0;
        userData.items[item.id] += quantity;

        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

        return safeReply(interaction, {
          content: `✅ Granted **${quantity}× ${item.emoji} ${item.name}** to **${targetUser.username}**.`,
          ephemeral: true,
        });
      }

      // ======================================================
      // 🚫 Invalid
      // ======================================================
      return safeReply(interaction, {
        content: "⛔ Invalid type. Must be 'pokemon', 'trainer', or 'item'.",
        ephemeral: true,
      });
    } catch (err) {
      console.error("❌ Add inventory error:", err);
      return safeReply(interaction, {
        content: `❌ Error: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
