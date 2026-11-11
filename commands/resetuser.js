// ==========================================================
// 🔄 /resetuser – Admin Command
// Resets a user's daily timer, onboarding state, and data safely
// while keeping TP and CC intact.
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { saveAndAck, withSaveNote } from "../utils/saveManager.js";
import { lockUser } from "../utils/userLocks.js";
import { clearTrainers } from "../services/assets.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetuser")
    .setDescription("Admin: Reset a user’s daily timer, onboarding, and data safely.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The user to reset")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const target = interaction.options.getUser("user");
      const id = target.id;

      await lockUser(id, async () => {
      if (!trainerData[id]) {
        await interaction.editReply(`❌ No data found for **${target.username}**.`);
        return;
      }

      const targetData = trainerData[id];

      // ======================================================
      // 🧭 Preserve Currency, Reset Everything Else
      // ======================================================
      const tp = targetData.tp ?? 0;
      const cc = targetData.cc ?? 0;

      // ✅ Reset daily timer
      targetData.lastDaily = 0;
      targetData.daily = { lastUsed: null, streak: 0, rewards: [] };

      // ✅ Full wipe of Pokémon & Trainer data
      targetData.pokemon = {};
      clearTrainers(targetData);
      targetData.displayedPokemon = [];
      targetData.displayedTrainer = null;
      // Battle team, chosen movesets and the casual record go too. The
      // ranked record (battle) is kept, as before this change.
      delete targetData.battleTeam;
      delete targetData.movesets;
      delete targetData.casual;

      // ✅ Full onboarding reset
      targetData.onboardingComplete = false;
      targetData.onboardingStep = 0;
      targetData.starterSelected = null;
      targetData.starterConfirmed = false;
      targetData.introComplete = false;

      // ✅ Clear transient session data
      delete targetData.sessionActive;
      delete targetData.sessionStart;
      delete targetData.currentReward;

      // ✅ Reapply preserved currencies
      targetData.tp = tp;
      targetData.cc = cc;

      // 💾 Save updated user data
      const ack = await saveAndAck(trainerData);

      // ✅ Confirmation (with a delay note if the disk didn't confirm)
      await interaction.editReply(withSaveNote(
        `✅ Successfully reset **${target.username}**!\n` +
          `- Daily timer cleared\n` +
          `- Pokémon & Trainer data wiped\n` +
          `- Onboarding fully reset\n` +
          `- TP: ${tp}\n` +
          `- CC: ${cc}`,
        ack
      ));

      console.log(`✅ /resetuser: ${target.username} reset successfully.`);
      });

    } catch (err) {
      console.error("❌ /resetuser error:", err);
      try {
        await interaction.editReply(`❌ Error resetting user: ${err.message}`);
      } catch {
        console.error("❌ Failed to send error reply:", err.message);
      }
    }
  },
};
