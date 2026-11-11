// ==========================================================
// 🤖 Coop's Collection — /luck Command (Ephemeral Version)
// Shows the user's Random Reward Luck Meter (Pity)
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
} from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { rarityColors } from "../utils/rarityPalette.js"; // color palette

export default {
  data: new SlashCommandBuilder()
    .setName("luck")
    .setDescription("Show your luck meter for random chat rewards"),

  async execute(interaction, trainerData) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const userId = interaction.user.id;

    // Ensure user exists
    const user = trainerData[userId];
    if (!user) {
      return safeReply(interaction, {
        content: "You haven't earned any progress yet. Try chatting to begin!",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Ensure fields exist
    user.luck ??= 0;

    // ======================================================
    // 🧮 Compute Luck / Pity Values
    // ======================================================
    const baseChance = 0.02;   // 2%
    const cap = 0.12;          // 12%
    const luck = user.luck;
    const finalChance = Math.min(cap, baseChance + luck);

    const percent = Math.round(finalChance * 1000) / 10;       // total %
    const percentLuckOnly = Math.round(luck * 1000) / 10;      // pity %

    // ======================================================
    // 🎛️ Bar Meter (10 segments)
    // ======================================================
    const segments = 10;
    const filled = Math.round((finalChance / cap) * segments);
    const bar = "█".repeat(filled) + "░".repeat(segments - filled);

    // ======================================================
    // 🎨 Embed
    // ======================================================
    const embed = new EmbedBuilder()
      .setColor(rarityColors.success ?? "#00ff9d")
      .setTitle("🍀 Your luck meter")
      .setDescription(
`Each time you chat or react and **don't** get a random reward, your luck increases.
When you *do* get a reward → your luck resets to 0.

**Final Chance:** \`${percent}%\`
**Bonus (pity) Only:** \`${percentLuckOnly}%\`

**Meter:**
\`${bar}\`
`
      );

    await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
