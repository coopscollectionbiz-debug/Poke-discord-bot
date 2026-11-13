// ===========================================================
// 🐾 /dashboard
// ===========================================================
// Opens secure web-based Pokémon & Trainer Dashboard.
// Sends ephemeral confirmation in Discord.
// ===========================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { generateToken } from "../utils/dashboardAuth.js";
import { publicBaseUrl } from "../utils/publicUrl.js";

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

      // Base URL: PUBLIC_URL → Fly app URL (utils/publicUrl.js); no Render fallback.
      const baseUrl = publicBaseUrl();

      // Default starting page → Pokémon picker
      const pickerUrl = `${baseUrl}/auth/dashboard?id=${userId}&code=${token}`;

      // 🟡 Ephemeral confirmation embed
      const embed = new EmbedBuilder()
        .setTitle("🌟 Dashboard Opened!")
        .setDescription(
          `Manage your Pokémon team and Trainer from the dashboard:\n\n🔗 [Open Dashboard](${pickerUrl})\n\nThe link works for 10 minutes. Once open, the session lasts 30 minutes after your last action, up to 4 hours.`
        )
        .setColor(0x00ff9d)
        .setFooter({ text: "Coop’s Collection — Dashboard Access" })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });

      console.log(`🎫 Dashboard token generated for ${interaction.user.username}`);
    } catch (err) {
      console.error("❌ /dashboard failed:", err);

      // SAFE version — never call reply() here!
      try {
        await interaction.followUp({
          content: "❌ Something went wrong generating your dashboard link.",
          flags: MessageFlags.Ephemeral,
        });
      } catch (e) {
        console.error("❌ followUp also failed inside /dashboard:", e);
      }
    }
  },
};
