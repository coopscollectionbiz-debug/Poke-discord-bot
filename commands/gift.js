// ==========================================================
// gift.js – Gift Coins, Pokémon, or Trainers to another user
// Coop's Collection Discord Bot (SafeReply Refactor + Trainer Key Standardization)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import {
  validateAmount,
  validateUserResources,
  validateNameQuery,
} from "../utils/validators.js";
import { findPokemonByName, getFlattenedTrainers } from "../utils/dataLoader.js";
import {
  createSuccessEmbed,
  createErrorEmbed,
} from "../utils/embedBuilders.js";
import { safeReply } from "../utils/safeReply.js";
import { getTrainerKey, findTrainerByQuery } from "../utils/trainerFileHandler.js";
import { atomicSave } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("gift")
    .setDescription("Gift CC, Pokémon, or Trainer to another player.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("The user you want to gift to.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("What do you want to send?")
        .setRequired(true)
        .addChoices(
          { name: "Collection Coins (CC)", value: "cc" },
          { name: "Pokémon", value: "pokemon" },
          { name: "Trainer", value: "trainer" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("item")
        .setDescription("Pokémon name or Trainer name (ignored for CC).")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("How many coins or Pokémon to send (ignored for trainer).")
        .setMinValue(1)
        .setRequired(false)
    ),

  // ==========================================================
  // ⚙️ Command Execution (SafeReply Refactor)
  // ==========================================================
  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const senderId = interaction.user.id;
    const receiver = interaction.options.getUser("target");
    const type = interaction.options.getString("type");
    const itemName = interaction.options.getString("item");
    const amount = interaction.options.getInteger("amount") || 1;

    // Basic validation
    if (!receiver)
      return safeReply(interaction, { content: "❌ Invalid user.", flags: MessageFlags.Ephemeral });

    if (receiver.id === senderId)
      return safeReply(interaction, {
        content: "⚠️ You can't gift yourself.",
        flags: MessageFlags.Ephemeral,
      });

    // Validate amount for CC/Pokemon
    if (type !== "trainer") {
      const amountValidation = validateAmount(amount, 1000000);
      if (!amountValidation.valid)
        return safeReply(interaction, {
          content: `❌ ${amountValidation.error}`,
          flags: MessageFlags.Ephemeral,
        });
    }

    // Ensure both users exist in trainerData
    const sender = await ensureUserInitialized(senderId, interaction.user.username, trainerData, client);
    const recipient = await ensureUserInitialized(receiver.id, receiver.username, trainerData, client);

    let description = "";

    try {
      // ==========================================================
      // 💰 TYPE: COINS (CC)
      // ==========================================================
      if (type === "cc") {
        const resourceCheck = validateUserResources(sender, "cc", amount);
        if (!resourceCheck.valid)
          return safeReply(interaction, {
            content: `❌ ${resourceCheck.error}`,
            flags: MessageFlags.Ephemeral,
          });

        sender.cc -= amount;
        recipient.cc += amount;
        description = `💰 ${interaction.user.username} sent **${amount.toLocaleString()} CC** to ${receiver.username}!`;
      }

      // ==========================================================
      // 🧬 TYPE: POKÉMON
      // ==========================================================
      else if (type === "pokemon") {
        if (!itemName)
          return safeReply(interaction, {
            content: "❌ You must specify which Pokémon to gift.",
            flags: MessageFlags.Ephemeral,
          });

        const nameValidation = validateNameQuery(itemName);
        if (!nameValidation.valid)
          return safeReply(interaction, {
            content: `❌ ${nameValidation.error}`,
            flags: MessageFlags.Ephemeral,
          });

        // ✅ Error handling on findPokemonByName
        let targetPokemon;
        try {
          targetPokemon = await findPokemonByName(nameValidation.sanitized);
        } catch (err) {
          console.error("❌ Error finding Pokémon:", err);
          return safeReply(interaction, {
            content: "❌ Error searching for Pokémon. Please try again.",
            flags: MessageFlags.Ephemeral,
          });
        }

        if (!targetPokemon)
          return safeReply(interaction, {
            content: `⚠️ Pokémon \"${itemName}\" not found.`,
            flags: MessageFlags.Ephemeral,
          });

        const key = targetPokemon.id.toString();
        const senderRecord = sender.pokemon[key];
        const senderCount = senderRecord ? (senderRecord.normal || 0) + (senderRecord.shiny || 0) : 0;

        if (senderCount < amount)
          return safeReply(interaction, {
            content: `❌ You don't own ${amount}× ${targetPokemon.name}.`,
            flags: MessageFlags.Ephemeral,
          });

        if (senderCount - amount === 0)
          return safeReply(interaction, {
            content: `⚠️ You can't gift your last ${targetPokemon.name}.`,
            flags: MessageFlags.Ephemeral,
          });

        if (!sender.pokemon[key]) sender.pokemon[key] = { normal: 0, shiny: 0 };
        if (!recipient.pokemon[key]) recipient.pokemon[key] = { normal: 0, shiny: 0 };

        sender.pokemon[key].normal = Math.max(0, (sender.pokemon[key].normal || 0) - amount);
        recipient.pokemon[key].normal = (recipient.pokemon[key].normal || 0) + amount;

        description = `🧬 ${interaction.user.username} sent **${amount}× ${targetPokemon.name}** to ${receiver.username}!`;
      }

      // ==========================================================
      // 🧑‍🏫 TYPE: TRAINER
      // ==========================================================
      else if (type === "trainer") {
        // ✅ Warn if amount specified for trainer
        if (amount && amount !== 1) {
          return safeReply(interaction, {
            content: "⚠️ Trainer gifts are always 1. Ignore the amount parameter.",
            flags: MessageFlags.Ephemeral,
          });
        }

        if (!itemName)
          return safeReply(interaction, {
            content: "❌ You must specify which Trainer to gift.",
            flags: MessageFlags.Ephemeral,
          });

        const nameValidation = validateNameQuery(itemName);
        if (!nameValidation.valid)
          return safeReply(interaction, {
            content: `❌ ${nameValidation.error}`,
            flags: MessageFlags.Ephemeral,
          });

        const flatTrainers = await getFlattenedTrainers();
        const targetTrainer = findTrainerByQuery(flatTrainers, nameValidation.sanitized);

        if (!targetTrainer)
          return safeReply(interaction, {
            content: `⚠️ Trainer \"${itemName}\" not found.`,
            flags: MessageFlags.Ephemeral,
          });

        // ✅ Use standardized trainer key handler
        const spriteKey = getTrainerKey(targetTrainer);
        if (!sender.trainers[spriteKey])
          return safeReply(interaction, {
            content: `❌ You don't own ${targetTrainer.name}.`,
            flags: MessageFlags.Ephemeral,
          });

        const senderTrainerCount = Object.keys(sender.trainers).length;
        if (senderTrainerCount <= 1)
          return safeReply(interaction, {
            content: `⚠️ You can't gift your only trainer sprite.`,
            flags: MessageFlags.Ephemeral,
          });

        delete sender.trainers[spriteKey];
        recipient.trainers[spriteKey] = true;

        description = `🧑‍🏫 ${interaction.user.username} sent the **${targetTrainer.name}** trainer sprite to ${receiver.username}!`;
      }

      // ==========================================================
      // ✅ Confirmation + Atomic Save
      // ==========================================================
      const embed = createSuccessEmbed("🎁 Gift Sent!", description, { color: 0x57f287 });
      await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });

      try {
        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
        console.log(`✅ Gift: ${interaction.user.username} → ${receiver.username} (${type}${itemName ? " - " + itemName : ""})`);
      } catch (err) {
        console.error("❌ Error saving gift transaction:", err);
      }
    } catch (err) {
      console.error("❌ Gift command error:", err);
      return safeReply(interaction, {
        content: `❌ An error occurred: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
