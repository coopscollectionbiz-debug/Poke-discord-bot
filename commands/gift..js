// ==========================================================
// gift.js — Gift Coins, Pokémon, or Trainers to another user
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs/promises";

// ✅ Load live Pokémon + Trainer data safely (Render-safe JSON)
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);
const trainerSprites = JSON.parse(
  await fs.readFile(new URL("../trainerSprites.json", import.meta.url))
);

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

    if (!receiver) return interaction.editReply({ content: "❌ Invalid user." });
    if (receiver.id === senderId)
      return interaction.editReply({ content: "⚠️ You can’t gift yourself." });

    // Ensure both users exist in trainerData
    trainerData[senderId] ??= { tp: 0, cc: 0, pokemon: {}, trainers: {}, trainer: null, displayedPokemon: [] };
    trainerData[receiver.id] ??= { tp: 0, cc: 0, pokemon: {}, trainers: {}, trainer: null, displayedPokemon: [] };

    const sender = trainerData[senderId];
    const recipient = trainerData[receiver.id];
    let description = "";

    // ==========================================================
    // 💰 TYPE: COINS (CC)
    // ==========================================================
    if (type === "cc") {
      if (sender.cc < amount) {
        return interaction.editReply({
          content: `❌ You don’t have enough CC to send ${amount.toLocaleString()}.`
        });
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

      const targetPokemon = pokemonData.find(
        p => p.name.toLowerCase() === itemName.toLowerCase()
      );
      if (!targetPokemon) {
        return interaction.editReply({
          content: `⚠️ Pokémon "${itemName}" not found.`
        });
      }

      const key = targetPokemon.id.toString();
      const senderCount = sender.pokemon[key] || 0;

      // Validation: must own more than `amount`
      if (senderCount < amount) {
        return interaction.editReply({
          content: `❌ You don’t own ${amount}× ${targetPokemon.name}.`
        });
      }

      // ✅ Prevent gifting if it would reduce count to 0
      if (senderCount - amount === 0) {
        return interaction.editReply({
          content: `⚠️ You can’t gift your last ${targetPokemon.name}.`
        });
      }

      // Proceed with transfer
      sender.pokemon[key] = senderCount - amount;
      recipient.pokemon[key] = (recipient.pokemon[key] || 0) + amount;

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

      const targetTrainer = trainerSprites.find(
        t => t.name.toLowerCase() === itemName.toLowerCase()
      );
      if (!targetTrainer) {
        return interaction.editReply({
          content: `⚠️ Trainer "${itemName}" not found.`
        });
      }

      const spriteKey = targetTrainer.file;
      if (!sender.trainers[spriteKey]) {
        return interaction.editReply({
          content: `❌ You don’t own ${targetTrainer.name}.`
        });
      }

      // ✅ Prevent gifting if it’s the only one owned
      const senderTrainerCount = Object.keys(sender.trainers).length;
      if (senderTrainerCount <= 1) {
        return interaction.editReply({
          content: `⚠️ You can’t gift your only trainer sprite.`
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
