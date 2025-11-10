// ===========================================================
// 🎨 /changetrainer
// ===========================================================
// Opens secure web-based Trainer Picker.
// Now handles ephemeral confirmation directly in Discord.
// ===========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { generateToken } from "../bot_final.js";

export default {
  data: new SlashCommandBuilder()
    .setName("changetrainer")
    .setDescription("Open the Trainer Picker to change your displayed Trainer."),

  async execute(interaction) {
    try {
      const userId = interaction.user.id;
      const channelId = interaction.channelId;

      // 🔐 Generate secure 10-minute token
      const token = generateToken(userId, channelId);

      const baseUrl =
        process.env.RENDER_EXTERNAL_URL ||
        "https://coopscollection-bot.onrender.com";

      const pickerUrl = `${baseUrl}/public/picker/?id=${userId}&token=${token}`;

      // 🎨 Ephemeral confirmation message
      const embed = new EmbedBuilder()
        .setTitle("🎨 Trainer Picker Opened!")
        .setDescription(
          `Click the link below to select your new Trainer.\n\n🔗 [Open Trainer Picker](${pickerUrl})\n\nYour link expires in **10 minutes**.`
        )
        .setColor(0x00ff9d)
        .setFooter({ text: "🌟 Coop’s Collection Update" })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });

      console.log(`🎟️ Trainer token generated for ${interaction.user.username}`);
    } catch (err) {
      console.error("❌ /changetrainer failed:", err);
      await interaction.reply({
        content: "❌ Something went wrong generating your Trainer Picker link.",
        ephemeral: true,
      });
    }
  },
};
