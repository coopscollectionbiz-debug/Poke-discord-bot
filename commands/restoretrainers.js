// ==========================================================
// /restoretrainers — Admin Only
// Restores trainers + displayedTrainer from old backup
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import fs from "fs";

export default {
  data: new SlashCommandBuilder()
    .setName("restoretrainers")
    .setDescription("Restore trainer ownership from old backup (ADMIN ONLY).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal) {
    await interaction.deferReply({ ephemeral: true });

    const OLD_FILE = "./oldTrainerBackup.json";

    if (!fs.existsSync(OLD_FILE)) {
      return interaction.editReply("❌ oldTrainerBackup.json not found.");
    }

    const oldData = JSON.parse(fs.readFileSync(OLD_FILE, "utf8"));
    let restoredCount = 0;

    for (const [userId, user] of Object.entries(trainerData)) {
      const oldUser = oldData[userId];
      if (!oldUser) continue;

      // Restore trainers (object → array)
      if (oldUser.trainers && typeof oldUser.trainers === "object") {
        trainerData[userId].trainers = Object.keys(oldUser.trainers);
        restoredCount++;
      }

      // Restore displayed trainer
      if (oldUser.displayedTrainer) {
        trainerData[userId].displayedTrainer = oldUser.displayedTrainer;
      }
    }

    // Mark for save (your saveQueue handles this automatically)
    await saveTrainerDataLocal(trainerData);

    return interaction.editReply(
      `✅ Restored trainers for **${restoredCount} users**.\n` +
      `Trainer data will automatically sync to Discord on the next interval.`
    );
  }
};
