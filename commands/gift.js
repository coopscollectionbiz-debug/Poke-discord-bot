// ==========================================================
// gift.js – Gift Coins, Pokémon, or Trainers to another user
// Coop's Collection Discord Bot (SafeReply Refactor + Trainer Key Standardization)
// ==========================================================

import { SlashCommandBuilder } from "discord.js";
import { ensureUserData } from "../utils/trainerDataHelper.js";
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

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("gift")
    .setDescription("Gift CC, Pokémon, or Trainer to another player.")
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
  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    await interaction.deferReply({ ephemeral: true });

    const senderId = interaction.user.id;
    const receiver = interaction.options.getUser("target");
    const type = interaction.options.getString("type");
    const itemName = interaction.options.getString("item");
    const amount = interaction.options.getInteger("amount") || 1;

    // Basic validation
    if (!receiver)
      return safeReply(interaction, { content: "❌ Invalid user.", ephemeral: true });

    if (receiver.id === senderId)
      return safeReply(interaction, {
        content: "⚠️ You can't gift yourself.",
        ephemeral: true,
      });

    // Validate amount for CC/Pokemon
    if (type !== "trainer") {
      const amountValidation = validateAmount(amount, 1000000);
      if (!amountValidation.valid)
        return safeReply(interaction, {
          content: `❌ ${amountValidation.error}`,
          ephemeral: true,
        });
    }

    // Ensure both users exist in trainerData
    const sender = ensureUserData(trainerData, senderId, interaction.user.username);
    const recipient = ensureUserData(trainerData, receiver.id, receiver.username);

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
            ephemeral: true,
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
            ephemeral: true,
          });

        const nameValidation = validateNameQuery(itemName);
        if (!nameValidation.valid)
          return safeReply(interaction, {
            content: `❌ ${nameValidation.error}`,
            ephemeral: true,
          });

        // ✅ Error handling on findPokemonByName
        let targetPokemon;
        try {
          targetPokemon = await findPokemonByName(nameValidation.sanitized);
        } catch (err) {
          console.error("❌ Error finding Pokémon:", err);
          return safeReply(interaction, {
            content: "❌ Error searching for Pokémon. Please try again.",
            ephemeral: true,
          });
        }

        if (!targetPokemon)
          return safeReply(interaction, {
            content: `⚠️ Pokémon \"${itemName}\" not found.`,
            ephemeral: true,
          });

        const key = targetPokemon.id.toString();
        const senderRecord = sender.pokemon[key];
        const senderCount = senderRecord ? (senderRecord.normal || 0) + (senderRecord.shiny || 0) : 0;

        if (senderCount < amount)
          return safeReply(interaction, {
            content: `❌ You don't own ${amount}× ${targetPokemon.name}.`,
            ephemeral: true,
          });

        if (senderCount - amount === 0)
          return safeReply(interaction, {
            content: `⚠️ You can't gift your last ${targetPokemon.name}.`,
            ephemeral: true,
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
            ephemeral: true
          });
        }

        if (!itemName)
          return safeReply(interaction, {
            content: "❌ You must specify which Trainer to gift.",
            ephemeral: true,
          });

        const nameValidation = validateNameQuery(itemName);
        if (!nameValidation.valid)
          return safeReply(interaction, {
            content: `❌ ${nameValidation.error}`,
            ephemeral: true,
          });

        const flatTrainers = await getFlattenedTrainers();
        const targetTrainer = findTrainerByQuery(flatTrainers, nameValidation.sanitized);

        if (!targetTrainer)
          return safeReply(interaction, {
            content: `⚠️ Trainer \"${itemName}\" not found.`,
            ephemeral: true,
          });

        // ✅ Use standardized trainer key handler
        const spriteKey = getTrainerKey(targetTrainer);
        if (!sender.trainers[spriteKey])
          return safeReply(interaction, {
            content: `❌ You don't own ${targetTrainer.name}.`,
            ephemeral: true,
          });

        const senderTrainerCount = Object.keys(sender.trainers).length;
        if (senderTrainerCount <= 1)
          return safeReply(interaction, {
            content: `⚠️ You can't gift your only trainer sprite.`,
            ephemeral: true,
          });

        delete sender.trainers[spriteKey];
        recipient.trainers[spriteKey] = true;

        description = `🧑‍🏫 ${interaction.user.username} sent the **${targetTrainer.name}** trainer sprite to ${receiver.username}!`;
      }

      // ==========================================================
      // ✅ Confirmation + Atomic Save
      // ==========================================================
      const embed = createSuccessEmbed("🎁 Gift Sent!", description, { color: 0x57f287 });
      await safeReply(interaction, { embeds: [embed], ephemeral: true });

      try {
        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
        console.log(
          `✅ Gift: ${interaction.user.username} → ${receiver.username} (${type}${itemName ? " - " + itemName : ""})`
        );
      } catch (err) {
        console.error("❌ Error saving gift transaction:", err);
      }
    } catch (err) {
      console.error("❌ Gift command error:", err);
      return safeReply(interaction, {
        content: `❌ An error occurred: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
