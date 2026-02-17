// ==========================================================
// /addinventory — Expanded Admin Command (v3.3, Race-Safe)
// Includes: Confirmation of EXACT items added
// ✅ Adds support for Shiny Dust via Item path
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { findPokemonByName, getFlattenedTrainers } from "../utils/dataLoader.js";
import { getTrainerKey, findTrainerByQuery } from "../utils/trainerFileHandler.js";
import { atomicSave } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

function normalizeKey(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Permission validation
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, {
        content: "⛔ You do not have permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetUser = interaction.options.getUser("user");
    const type = interaction.options.getString("type");
    const name = interaction.options.getString("name");
    const shiny = interaction.options.getBoolean("shiny") || false;

    let quantity = interaction.options.getInteger("quantity") || 1;
    if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;

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
              flags: MessageFlags.Ephemeral,
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
              flags: MessageFlags.Ephemeral,
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
        // 🟣 Items (including Shiny Dust)
        // ======================================================
        else if (type === "item") {
          // Normalize & alias
          const raw = String(name || "").trim();
          const rawLower = raw.toLowerCase();

          const aliasMap = {
            "shiny dust": "shiny_dust",
            "shinydust": "shiny_dust",
            "shiny-dust": "shiny_dust",
            "shiny_dust": "shiny_dust",
          };

          const key = aliasMap[rawLower] || normalizeKey(raw);

          // ✅ Special-case: Shiny Dust as a balance on the user
          if (key === "shiny_dust") {
            user.shinyDust ??= 0;
            user.shinyDust += quantity;

            confirmationText = `**${quantity}× ✨ Shiny Dust**`;
          } else {
            if (!globalThis.SHOP_ITEMS || !globalThis.SHOP_ITEMS[key]) {
              return safeReply(interaction, {
                content: `⛔ Item "${name}" not recognized.`,
                flags: MessageFlags.Ephemeral,
              });
            }

            const item = globalThis.SHOP_ITEMS[key];

            // If your SHOP_ITEMS defines shiny dust as an item id, still route to shinyDust
            if (item?.id === "shiny_dust") {
              user.shinyDust ??= 0;
              user.shinyDust += quantity;
              confirmationText = `**${quantity}× ✨ ${item.name || "Shiny Dust"}**`;
            } else {
              user.items ??= {};
              user.items[item.id] ??= 0;
              user.items[item.id] += quantity;

              confirmationText = `**${quantity}× Item: ${item.name}**`;
            }
          }
        } else {
          return safeReply(interaction, {
            content: `⛔ Invalid type.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // ======================================================
        // 💾 SAVE — atomicSave handles both local & backup sync
        // ======================================================
        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

        // ======================================================
        // ✅ Confirmation reply
        // ======================================================
        return safeReply(interaction, {
          content: `✅ Added ${confirmationText} to **${targetUser.username}**.`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (err) {
        console.error("❌ Add inventory error:", err);
        return safeReply(interaction, {
          content: `❌ Error: ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    });
  },
};
