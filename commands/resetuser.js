import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { createSuccessEmbed } from "../utils/embedBuilders.js";
import { atomicSave } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetuser")
    .setDescription("Reset onboarding, Pokémon, trainers, and /daily timer for a user (TP + CC preserved).")
    .addUserOption(option => 
      option
        .setName("user")
        .setDescription("The user to reset")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, { content: "⛔ You do not have permission to use this command.", ephemeral: true });
    }

    const targetUser = interaction.options.getUser("user");
    const targetData = await ensureUserInitialized(targetUser.id, targetUser.username, trainerData, client);

    if (!targetData) {
      return safeReply(interaction, { content: `⛔ ${targetUser.username} does not have a trainer profile.`, ephemeral: true });
    }

    // ✅ Preserve key currencies
    const preservedTP = targetData.tp ?? 0;
    const preservedCC = targetData.cc ?? 0;

    // ✅ Reset fields
    targetData.onboardingComplete = false;
    targetData.onboardingDate = null;
    targetData.onboardingStage = "starter_selection";
    targetData.selectedStarter = null;
    targetData.starterPokemon = null;
    targetData.pokemon = {};
    targetData.trainers = {};
    targetData.displayedPokemon = [];
    targetData.displayedTrainer = null;

    // ✅ Reset daily timer
    targetData.dailyLastUsed = null;
    targetData.dailyCooldown = null;

    // ✅ Reassign preserved values
    targetData.tp = preservedTP;
    targetData.cc = preservedCC;

    // ✅ Update memory
    trainerData[targetUser.id] = targetData;

    try {
      await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

      return safeReply(interaction, {
        embeds: [
          createSuccessEmbed(
            "🔄 User Reset",
            `Trainer profile for **${targetUser.username}** has been reset.\n\n` +
            `✅ TP preserved: ${preservedTP}\n` +
            `✅ CC preserved: ${preservedCC}\n` +
            `✅ /daily timer reset`
          )
        ],
        ephemeral: true
      });
    } catch (err) {
      console.error("❌ resetuser save error:", err);
      return safeReply(interaction, {
        content: `❌ Failed to reset user: ${err.message}`,
        ephemeral: true
      });
    }
  }
};
