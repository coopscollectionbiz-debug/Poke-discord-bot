// ==========================================================
// /addinventory — Expanded Admin Command (v3.2, Race-Safe)
// Includes: Confirmation of EXACT items added
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { findPokemonByName, getFlattenedTrainers } from "../utils/dataLoader.js";
import { getTrainerKey, findTrainerByQuery } from "../utils/trainerFileHandler.js";
import { atomicSave } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

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
      option.setName("name").setDescription("Name of Pokémon, Trainer, or Item").setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName("shiny").setDescription("Add as shiny (Pokémon only)")
    )
    .addIntegerOption(option =>
      option.setName("quantity").setDescription("Quantity (default 1)")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(
    interaction,
    trainerData,
    saveTrainerDataLocal,
    saveDataToDiscord,
    lockUser,
    enqueueSave,
    client
  ) {
    await interaction.deferReply({ ephemeral: true });

    // Permission validation
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

    const userId = targetUser.id;

    // String for confirmation later
    let confirmationText = "";

    // ==========================================================
    // 🔒 ATOMIC USER LOCK
    // ==========================================================
    return lockUser(userId, async () => {
      let user = await ensureUserInitialized(
        userId,
        targetUser.username,
        trainerData,
        client
      );

      try {
        // ======================================================
        // 🟢 Pokémon
        // ======================================================
        if (type === "pokemon") {
          const pokemon = await findPokemonByName(name);
          if (!pokemon) {
            return safeReply(interaction, {
              content: `⛔ Pokémon "${name}" not found.`,
              ephemeral: true,
            });
          }

          user.pokemon ??= {};
          user.pokemon[pokemon.id] ??= { normal: 0, shiny: 0 };

          if (shiny) {
            user.pokemon[pokemon.id].shiny += quantity;
          } else {
            user.pokemon[pokemon.id].normal += quantity;
          }

          confirmationText = `**${quantity}× ${shiny ? "✨ Shiny " : ""}${pokemon.name}**`;
        }

        // ======================================================
        // 🔵 Trainer
        // ======================================================
        else if (type === "trainer") {
          const allTrainers = await getFlattenedTrainers();
          const trainer = findTrainerByQuery(allTrainers, name);

          if (!trainer) {
            return safeReply(interaction, {
              content: `⛔ Trainer "${name}" not found.`,
              ephemeral: true,
            });
          }

          const trainerKey = getTrainerKey(trainer);
          user.trainers ??= [];

          if (!user.trainers.includes(trainerKey)) {
            user.trainers.push(trainerKey);
          }

          confirmationText = `**Trainer: ${trainer.name}**`;
        }

        // ======================================================
        // 🟣 Items
        // ======================================================
        else if (type === "item") {
          const key = name.toLowerCase().replace(/\s+/g, "_");

          if (!globalThis.SHOP_ITEMS || !globalThis.SHOP_ITEMS[key]) {
            return safeReply(interaction, {
              content: `⛔ Item "${name}" not recognized.`,
              ephemeral: true,
            });
          }

          const item = globalThis.SHOP_ITEMS[key];

          user.items ??= {};
          user.items[item.id] ??= 0;
          user.items[item.id] += quantity;

          confirmationText = `**${quantity}× Item: ${item.name}**`;
        }

// 💾 SAVE — atomicSave handles both local & backup sync
// ======================================================
await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);



        // ======================================================
        // ✅ Confirmation reply
        // ======================================================
        return safeReply(interaction, {
          content: `✅ Added ${confirmationText} to **${targetUser.username}**.`,
          ephemeral: true,
        });

      } catch (err) {
        console.error("❌ Add inventory error:", err);
        return safeReply(interaction, {
          content: `❌ Error: ${err.message}`,
          ephemeral: true,
        });
      }
    });
  },
};
