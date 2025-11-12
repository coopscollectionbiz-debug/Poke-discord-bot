// ===========================================================
// 🎮 /dashboard
// ===========================================================
// Opens unified dashboard with Pokémon, Trainers, and Shop
// ===========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { generateToken } from "../bot_final.js";

export default {
  data: new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription(
      "Open your unified collection dashboard to manage Pokémon, Trainers, and Shop."
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      const userId = interaction.user.id;
      const channelId = interaction.channelId;

      // 🔒 Generate a 10-minute access token
      const token = generateToken(userId, channelId);

      // 🌐 Base URL (supports Render auto-URL or fallback)
      const baseUrl =
        process.env.RENDER_EXTERNAL_URL ||
        "https://coopscollection-bot.onrender.com";

      const dashboardUrl = `${baseUrl}/public/dashboard/?id=${userId}&token=${token}`;

      // 🎮 Ephemeral confirmation embed
      const embed = new EmbedBuilder()
        .setTitle("🎮 Dashboard Opened!")
        .setDescription(
          `Welcome to your **Collection Dashboard!**\n\n` +
            `**Features:**\n` +
            `🎾 **Pokémon Tab** — Manage your team, evolve, or donate\n` +
            `👤 **Trainers Tab** — Select your displayed trainer\n` +
            `🛒 **Shop Tab** — Purchase items with CC\n\n` +
            `🔗 [**Open Dashboard**](${dashboardUrl})\n\n` +
            `Your link expires in **10 minutes**.`
        )
        .setColor(0x00ff9d)
        .setFooter({ text: "🌟 Coop's Collection Dashboard" })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });

      console.log(`🎟️ Dashboard token generated for ${interaction.user.username}`);
    } catch (err) {
      console.error("❌ /dashboard failed:", err);
      await interaction.reply({
        content: "❌ Something went wrong generating your Dashboard link.",
        ephemeral: true,
      });
    }
  },
};
