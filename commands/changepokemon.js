// ===========================================================
// 🐾 /changepokemon
// ===========================================================
// Opens secure web-based Pokémon Picker.
// Now handles ephemeral confirmation directly in Discord.
// ===========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { generateToken } from "../bot_final.js";

export default {
  data: new SlashCommandBuilder()
    .setName("changepokemon")
    .setDescription("Open the Pokémon Picker to change your displayed Pokémon."),

  async execute(interaction) {
    try {
      const userId = interaction.user.id;
      const channelId = interaction.channelId;
      const token = generateToken(userId, channelId);

      const baseUrl =
        process.env.RENDER_EXTERNAL_URL ||
        "https://coopscollection-bot.onrender.com";

      const pickerUrl = `${baseUrl}/public/picker-pokemon/?id=${userId}&token=${token}`;

      const embed = new EmbedBuilder()
        .setTitle("🐾 Pokémon Picker Opened!")
        .setDescription(
          `Click the link below to choose your displayed Pokémon team.\n\n🔗 [Open Pokémon Picker](${pickerUrl})\n\nYour link expires in **10 minutes**.`
        )
        .setColor(0xffcb05)
        .setFooter({ text: "🌟 Coop’s Collection Update" })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
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
