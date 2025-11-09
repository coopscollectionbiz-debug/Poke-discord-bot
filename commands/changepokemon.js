// ===========================================================
// 🐾 /changepokemon
// ===========================================================
// Opens the secure web-based Pokémon Picker for users to
// change their displayed Pokémon.
// Uses 10-minute access tokens to prevent ID spoofing.
// Matches /changetrainer structure exactly.
// ===========================================================

import { SlashCommandBuilder } from "discord.js";
import { generateToken as generateUserToken } from "../bot_final.js";

export default {
  data: new SlashCommandBuilder()
    .setName("changepokemon")
    .setDescription("Open the Pokémon Picker to change your displayed Pokémon."),

  async execute(interaction) {
    try {
      const userId = interaction.user.id;
      const channelId = interaction.channelId;

      // 🔐 Generate secure user token (same as /changetrainer)
      const token = generateUserToken(userId, channelId);

      // 🌐 Use the same base URL resolution as /changetrainer
      const baseUrl =
        process.env.RENDER_EXTERNAL_URL ||
        "https://coopscollection-bot.onrender.com";

      // 🧭 Pokémon picker path
      const pickerUrl = `${baseUrl}/public/picker-pokemon/?id=${userId}&token=${token}`;

      await interaction.reply({
        content: `🐾 **Pokémon Picker**\nClick below to choose which Pokémon appears on your Trainer Card!\n\n🔗 ${pickerUrl}\n\nYour link expires in **10 minutes** for security.`,
        ephemeral: true,
      });

      console.log(`🎟️ Pokémon token generated for ${interaction.user.username}`);
    } catch (err) {
      console.error("❌ /changepokemon failed:", err);
      await interaction.reply({
        content: "❌ Something went wrong generating your Pokémon Picker link.",
        ephemeral: true,
      });
    }
  },
};
