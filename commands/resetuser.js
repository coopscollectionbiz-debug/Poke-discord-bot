// ==========================================================
// /resetuser — Reset onboarding, Pokémon, and trainers for a user (TP preserved)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { createSuccessEmbed } from "../utils/embedBuilders.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetuser")
    .setDescription("Reset onboarding, Pokémon, and trainers for a user (TP preserved).")
    .addUserOption(option => option.setName("user").setDescription("The user to reset").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, { content: "⛔ You do not have permission to use this command.", ephemeral: true });
    }

    const targetUser = interaction.options.getUser("user");
    if (!trainerData[targetUser.id]) {
      return safeReply(interaction, { content: `⛔ ${targetUser.username} does not have a trainer profile.`, ephemeral: true });
    }

    const targetData = trainerData[targetUser.id];
    const preservedTP = targetData.tp ?? 0;

    targetData.onboardingComplete = false;
    targetData.onboardingDate = null;
    targetData.pokemon = {};
    targetData.trainers = {};
    targetData.displayedPokemon = [];
    targetData.displayedTrainer = null;
    targetData.tp = preservedTP;

    try {
      await saveTrainerDataLocal(trainerData);
      await saveDataToDiscord(trainerData);
    } catch (err) {
      console.error("❌ resetuser save error:", err);
    }

    return safeReply(interaction, {
      embeds: [createSuccessEmbed("🔄 User Reset", `Trainer profile for **${targetUser.username}** has been reset. TP preserved.`)],
      ephemeral: true
    });
  }
};
