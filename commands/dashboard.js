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
    .setDescription("Get a private link to your dashboard."),

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
          `🔗 [Open your dashboard](${pickerUrl})\n\nThis link is only for you and expires in **10 minutes**.`
        )
        .setColor(0x00ff9d)
        .setFooter({ text: "Your dashboard link" })
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
          content: "Something went wrong generating your dashboard link.",
          flags: MessageFlags.Ephemeral,
        });
      } catch (e) {
        console.error("❌ followUp also failed inside /dashboard:", e);
      }
    }
  },
};
