// ==========================================================
// /addinventory — Expanded Admin Command (v3.0, Race-Safe)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { findPokemonByName, getFlattenedTrainers } from "../utils/dataLoader.js";
import { getTrainerKey, findTrainerByQuery } from "../utils/trainerFileHandler.js";
import { atomicSave } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { lockUser } from "../utils/userLocks.js";   // ⭐ Correct import

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
      option.setName("name").setDescription("Name of the Pokémon, Trainer, or Item").setRequired(true)
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
    client
  ) {

    await interaction.deferReply({ ephemeral: true });

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

    return lockUser(userId, async () => {
      let userData = await ensureUserInitialized(
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
          if (!pokemon)
            return safeReply(interaction, {
              content: `⛔ Pokémon "${name}" not found.`,
              ephemeral: true,
            });

          userData.pokemon ??= {};
          userData.pokemon[pokemon.id] ??= { normal: 0, shiny: 0 };

          if (shiny) userData.pokemon[pokemon.id].shiny += quantity;
          else userData.pokemon[pokemon.id].normal += quantity;
        }

        // ======================================================
        // 🔵 Trainer
        // ======================================================
        else if (type === "trainer") {
          const allTrainers = await getFlattenedTrainers();
          const trainer = findTrainerByQuery(allTrainers, name);
          if (!trainer)
            return safeReply(interaction, {
              content: `⛔ Trainer "${name}" not found.`,
              ephemeral: true,
            });

          const trainerKey = getTrainerKey(trainer);

          userData.trainers ??= [];

          if (!userData.trainers.includes(trainerKey)) {
            userData.trainers.push(trainerKey);
          }
        }

        // ======================================================
        // 🟣 Items  (⚠ Requires SHOP_ITEMS imported!)
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

          userData.items ??= {};
          userData.items[item.id] ??= 0;
          userData.items[item.id] += quantity;
        }

        else {
          return safeReply(interaction, {
            content: "⛔ Invalid type.",
            ephemeral: true,
          });
        }

        // Schema cleanup
        trainerData[userId] = normalizeUserSchema(userId, userData);

        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

        return safeReply(interaction, {
          content: `✅ Added inventory to **${targetUser.username}** successfully.`,
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
