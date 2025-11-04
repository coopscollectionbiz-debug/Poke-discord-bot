// ==========================================================
// gift.js — Gift Coins, Pokémon, or Trainers to another user
// Coop's Collection Discord Bot
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { ensureUserData } from "../utils/trainerDataHelper.js";
import { validateAmount, validateUserResources, validateNameQuery } from "../utils/validators.js";
import { findPokemonByName, getFlattenedTrainers } from "../utils/dataLoader.js";

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("gift")
    .setDescription("Gift CC, Pokémon, or Trainer to another player.")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("The user you want to gift to.")
        .setRequired(true)
    )
    .addStringOption(option =>
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
    .addStringOption(option =>
      option
        .setName("item")
        .setDescription("Pokémon name or Trainer name (ignored for CC).")
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("How many coins or Pokémon to send (ignored for trainer).")
        .setMinValue(1)
        .setRequired(false)
    ),

  // ==========================================================
  // ⚙️ Command Execution
  // ==========================================================
  async execute(interaction, trainerData, saveDataToDiscord) {
    await interaction.deferReply({ flags: 64 });

    const senderId = interaction.user.id;
    const receiver = interaction.options.getUser("target");
    const type = interaction.options.getString("type");
    const itemName = interaction.options.getString("item");
    const amount = interaction.options.getInteger("amount") || 1;

    // Basic validation
    if (!receiver) return interaction.editReply({ content: "❌ Invalid user." });
    if (receiver.id === senderId)
      return interaction.editReply({ content: "⚠️ You can't gift yourself." });

    // Validate amount for CC/Pokemon
    if (type !== "trainer") {
      const amountValidation = validateAmount(amount, 1000000);
      if (!amountValidation.valid) {
        return interaction.editReply({ content: `❌ ${amountValidation.error}` });
      }
    }

    // Ensure both users exist in trainerData using helper
    const sender = ensureUserData(trainerData, senderId, interaction.user.username);
    const recipient = ensureUserData(trainerData, receiver.id, receiver.username);
    
    let description = "";

    // ==========================================================
    // 💰 TYPE: COINS (CC)
    // ==========================================================
    if (type === "cc") {
      const resourceCheck = validateUserResources(sender, "cc", amount);
      if (!resourceCheck.valid) {
        return interaction.editReply({ content: `❌ ${resourceCheck.error}` });
      }

      sender.cc -= amount;
      recipient.cc += amount;
      description = `💰 ${interaction.user.username} sent **${amount.toLocaleString()} CC** to ${receiver.username}!`;
    }

    // ==========================================================
    // 🧬 TYPE: POKÉMON
    // ==========================================================
    else if (type === "pokemon") {
      if (!itemName) {
        return interaction.editReply({
          content: "❌ You must specify which Pokémon to gift."
        });
      }

      // Validate and sanitize name
      const nameValidation = validateNameQuery(itemName);
      if (!nameValidation.valid) {
        return interaction.editReply({ content: `❌ ${nameValidation.error}` });
      }

      const targetPokemon = await findPokemonByName(nameValidation.sanitized);
      if (!targetPokemon) {
        return interaction.editReply({
          content: `⚠️ Pokémon "${itemName}" not found.`
        });
      }

      const key = targetPokemon.id.toString();
      const senderRecord = sender.pokemon[key];
      const senderCount = senderRecord ? (senderRecord.normal || 0) + (senderRecord.shiny || 0) : 0;

      // Validation: must own more than `amount`
      if (senderCount < amount) {
        return interaction.editReply({
          content: `❌ You don't own ${amount}× ${targetPokemon.name}.`
        });
      }

      // ✅ Prevent gifting if it would reduce count to 0
      if (senderCount - amount === 0) {
        return interaction.editReply({
          content: `⚠️ You can't gift your last ${targetPokemon.name}.`
        });
      }

      // Proceed with transfer (normal variant)
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
      if (!itemName) {
        return interaction.editReply({
          content: "❌ You must specify which Trainer to gift."
        });
      }

      // Validate and sanitize name
      const nameValidation = validateNameQuery(itemName);
      if (!nameValidation.valid) {
        return interaction.editReply({ content: `❌ ${nameValidation.error}` });
      }

      const flatTrainers = await getFlattenedTrainers();
      const targetTrainer = flatTrainers.find(
        t => t.name.toLowerCase() === nameValidation.sanitized.toLowerCase()
      );
      
      if (!targetTrainer) {
        return interaction.editReply({
          content: `⚠️ Trainer "${itemName}" not found.`
        });
      }

      const spriteKey = targetTrainer.filename;
      if (!sender.trainers[spriteKey]) {
        return interaction.editReply({
          content: `❌ You don't own ${targetTrainer.name}.`
        });
      }

      // ✅ Prevent gifting if it's the only one owned
      const senderTrainerCount = Object.keys(sender.trainers).length;
      if (senderTrainerCount <= 1) {
        return interaction.editReply({
          content: `⚠️ You can't gift your only trainer sprite.`
        });
      }

      // Proceed with transfer
      delete sender.trainers[spriteKey];
      recipient.trainers[spriteKey] = true;

      description = `🧑‍🏫 ${interaction.user.username} sent the **${targetTrainer.name}** trainer sprite to ${receiver.username}!`;
    }

    // ==========================================================
    // ✅ Confirmation + Save
    // ==========================================================
    const embed = new EmbedBuilder()
      .setTitle("🎁 Gift Sent!")
      .setDescription(description)
      .setColor(0x57f287)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    try {
      await saveDataToDiscord(trainerData);
      console.log(
        `✅ Gift: ${interaction.user.username} → ${receiver.username} (${type}${itemName ? " - " + itemName : ""})`
      );
    } catch (err) {
      console.error("❌ Error saving gift transaction:", err);
    }
  }
};
