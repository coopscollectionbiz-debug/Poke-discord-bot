// ==========================================================
// /addcurrency — Add TP or CC to a user's account
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { ensureUserData } from "../utils/trainerDataHelper.js";

export default {
  data: new SlashCommandBuilder()
    .setName("addcurrency")
    .setDescription("Add TP or CC to a user's account.")
    .addUserOption(option => option.setName("user").setDescription("The target user").setRequired(true))
    .addStringOption(option =>
      option.setName("type").setDescription("tp or cc").addChoices(
        { name: "TP", value: "tp" },
        { name: "CC", value: "cc" }
      ).setRequired(true)
    )
    .addIntegerOption(option => option.setName("amount").setDescription("The amount to add.").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, { content: "⛔ You do not have permission to use this command.", ephemeral: true });
    }

    const targetUser = interaction.options.getUser("user");
    const type = interaction.options.getString("type");
    const amount = interaction.options.getInteger("amount");
    const userData = ensureUserData(trainerData, targetUser.id, targetUser.username);

    if (type === "tp") userData.tp += amount;
    else if (type === "cc") userData.cc = (userData.cc || 0) + amount;
    else return safeReply(interaction, { content: "⛔ Invalid currency type. Must be either 'tp' or 'cc'.", ephemeral: true });

    await saveTrainerDataLocal(trainerData);
    await saveDataToDiscord(trainerData);

    return safeReply(interaction, { content: `✅ Added ${amount} ${type.toUpperCase()} to **${targetUser.username}**.`, ephemeral: true });
  }
};
