// ===========================================================
// 🎨 /changetrainer
// ===========================================================
// Opens the secure web-based Trainer Picker for users to
// change their displayed Trainer.
// Uses 10-minute access tokens to prevent ID spoofing.
// ===========================================================

import { SlashCommandBuilder } from "discord.js";
import { generateToken as generateUserToken } from "../bot_final.js";

export default {
  data: new SlashCommandBuilder()
    .setName("changetrainer")
    .setDescription("Open the Trainer Picker to change your displayed Trainer."),

  async execute(interaction) {
    try {
      const userId = interaction.user.id;
      const token = generateUserToken(userId);

      // Base URL for your hosted bot/picker
      const baseUrl =
        process.env.RENDER_EXTERNAL_URL ||
        "https://coopscollection-bot.onrender.com";

      const pickerUrl = `${baseUrl}/public/picker/?id=${userId}&token=${token}`;

      await interaction.reply({
        content: `🎨 **Trainer Picker**\nClick below to choose your displayed Trainer!\n\n🔗 ${pickerUrl}\n\nYour link expires in **10 minutes** for security.`,
        ephemeral: true,
      });

      console.log(`🎟️ Token generated for ${interaction.user.username}`);
    } catch (err) {
      console.error("❌ /changetrainer failed:", err);
      await interaction.reply({
        content: "❌ Something went wrong generating your Trainer Picker link.",
        ephemeral: true,
      });
    }
  },
};
