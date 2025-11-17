// ==========================================================
// 🤖 Coop's Collection — /luck Command
// Shows the user's Random Reward Pity / Luck Meter
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { rarityColors } from "../bot_final.js"; // Uses your existing palette

export default {
  data: new SlashCommandBuilder()
    .setName("luck")
    .setDescription("Shows your random reward luck meter (pity system)"),

  async execute(interaction, trainerData) {
    const userId = interaction.user.id;

    // Ensure user exists
    const user = trainerData[userId];
    if (!user) {
      return safeReply(interaction, {
        content: "❌ You haven't earned any progress yet. Try chatting to begin!",
        ephemeral: true,
      });
    }

    // Ensure fields exist (safety)
    user.luck ??= 0;
    user.luckTimestamp ??= 0;

    // ======================================================
    // 🧮 Compute Luck / Pity Values
    // ======================================================
    const baseChance = 0.02;   // 2%
    const cap = 0.12;          // 12%
    const luck = user.luck;
    const finalChance = Math.min(cap, baseChance + luck);

    const percent = Math.round(finalChance * 1000) / 10; // e.g., 4.3%
    const percentLuckOnly = Math.round(luck * 1000) / 10; // bonus only

    // ======================================================
    // ⏳ Calculate time since last increment or reset
    // ======================================================
    const now = Date.now();
    let timeMsg = "No activity yet";

    if (user.luckTimestamp > 0) {
      const diff = now - user.luckTimestamp;
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);

      if (mins > 0) timeMsg = `${mins}m ${secs}s ago`;
      else timeMsg = `${secs}s ago`;
    }

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
      .setColor(rarityColors.success)
      .setTitle("🍀 Your Luck Meter (Random Reward Pity)")
      .setDescription(
`Each time you chat or react and **don’t** get a random reward, your luck increases.
When you *do* get a reward → it resets to 0.  

**Final Chance:** \`${percent}%\`
**Bonus (pity) Alone:** \`${percentLuckOnly}%\`  
**Last Increased:** ${timeMsg}

**Meter:**  
\`${bar}\``
      )
      .setFooter({
        text: "Luck increases by +1% per failed attempt (up to 12%)"
      });

    await safeReply(interaction, { embeds: [embed], ephemeral: false });
  }
};
