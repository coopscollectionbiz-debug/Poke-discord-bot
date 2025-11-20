// ==========================================================
// /addcurrency – Add TP or CC to a user's account (Safe, Locked)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { atomicSave } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

export default {
  data: new SlashCommandBuilder()
    .setName("addcurrency")
    .setDescription("Add TP or CC to a user's account.")
    .addUserOption(option =>
      option.setName("user").setDescription("The target user").setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("type")
        .setDescription("tp or cc")
        .addChoices(
          { name: "TP", value: "tp" },
          { name: "CC", value: "cc" }
        )
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("amount").setDescription("The amount to add.").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(
    interaction,
    trainerData,
    saveTrainerDataLocal,
    saveDataToDiscord,
    client,
    lockUser       // ⭐ comes from bot_final.js
  ) {

    await interaction.deferReply({ ephemeral: true });

    // Permission check
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, {
        content: "⛔ You do not have permission to use this command.",
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser("user");
    const type = interaction.options.getString("type");
    const amount = interaction.options.getInteger("amount");

    // Validation
    if (amount <= 0) {
      return safeReply(interaction, {
        content: "❌ Amount must be greater than 0.",
        ephemeral: true
      });
    }

    if (amount > 1_000_000) {
      return safeReply(interaction, {
        content: "❌ Amount exceeds maximum (1,000,000).",
        ephemeral: true
      });
    }

    // Ensure user exists
    const userData = await ensureUserInitialized(
      targetUser.id,
      targetUser.username,
      trainerData,
      client
    );

    // ============================================
    // 🔒 ATOMIC PER-USER LOCKED MUTATION
    // ============================================
    await lockUser(targetUser.id, async () => {
      if (type === "tp") {
        userData.tp = (userData.tp ?? 0) + amount;
      } else {
        userData.cc = (userData.cc ?? 0) + amount;
      }

      await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
    });

    return safeReply(interaction, {
      content: `✅ Added **${amount} ${type.toUpperCase()}** to **${targetUser.username}**.`,
      ephemeral: true
    });
  }
};
