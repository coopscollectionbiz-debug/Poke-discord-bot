// ===========================================================
// 🐾 /dashboard
// ===========================================================
// Opens secure web-based Pokémon & Trainer Dashboard.
// Sends ephemeral confirmation in Discord.
// ===========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { generateToken } from "../bot_final.js";

export default {
  data: new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Open your Pokémon & Trainer Management Dashboard."),

  async execute(interaction) {
    try {
      const userId = interaction.user.id;
      const channelId = interaction.channelId;

      // 🔐 Generate a 10-minute access token
      const token = generateToken(userId, channelId);

      // Base URL (supports Render auto-URL or fallback)
      const baseUrl =
        process.env.RENDER_EXTERNAL_URL ||
        "https://coopscollection-bot.onrender.com";

      // Default starting page → Pokémon picker
      const pickerUrl = `${baseUrl}/public/picker-pokemon/?id=${userId}&token=${token}`;

      // 🟡 Ephemeral confirmation embed
      const embed = new EmbedBuilder()
        .setTitle("🌟 Dashboard Opened!")
        .setDescription(
          `Manage your Pokémon team and Trainer from the dashboard:\n\n🔗 [Open Dashboard](${pickerUrl})\n\nYour link expires in **10 minutes**.`
        )
        .setColor(0x00ff9d)
        .setFooter({ text: "Coop’s Collection — Dashboard Access" })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });

      console.log(`🎫 Dashboard token generated for ${interaction.user.username}`);
    } catch (err) {
      console.error("❌ /dashboard failed:", err);

      // SAFE version — never call reply() here!
      try {
        await interaction.followUp({
          content: "❌ Something went wrong generating your dashboard link.",
          ephemeral: true,
        });
      } catch (e) {
        console.error("❌ followUp also failed inside /dashboard:", e);
      }
    }
  },
};
