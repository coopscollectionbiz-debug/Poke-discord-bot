import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { createSuccessEmbed } from "../utils/embedBuilders.js";
import { atomicSave } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetuser")
    .setDescription("Reset onboarding, Pokémon, and trainers for a user (TP preserved).")
    .addUserOption(option => option.setName("user").setDescription("The user to reset").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    // ✅ Defer reply immediately
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, { content: "⛔ You do not have permission to use this command.", ephemeral: true });
    }

    const targetUser = interaction.options.getUser("user");
    
    // ✅ Use ensureUserInitialized to get latest state
    const targetData = await ensureUserInitialized(targetUser.id, targetUser.username, trainerData, client);
    
    if (!targetData) {
      return safeReply(interaction, { content: `⛔ ${targetUser.username} does not have a trainer profile.`, ephemeral: true });
    }

    const preservedTP = targetData.tp ?? 0;

    // ✅ Reset fields
    targetData.onboardingComplete = false;
    targetData.onboardingDate = null;
    targetData.onboardingStage = "starter_selection";  // Reset to start
    targetData.selectedStarter = null;
    targetData.starterPokemon = null;
    targetData.pokemon = {};
    targetData.trainers = {};
    targetData.displayedPokemon = [];
    targetData.displayedTrainer = null;
    targetData.tp = preservedTP;

    // ✅ Update memory
    trainerData[targetUser.id] = targetData;

    try {
      // ✅ Use atomic save
      await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
      
      return safeReply(interaction, {
        embeds: [createSuccessEmbed("🔄 User Reset", `Trainer profile for **${targetUser.username}** has been reset.\n\n✅ TP preserved: ${preservedTP}\n✅ Onboarding reset to starter selection`)],
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