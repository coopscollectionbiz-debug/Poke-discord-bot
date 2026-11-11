// ==========================================================
// /swapicon — Toggle between default & female rank icon (v7.0)
// Race-Safe • No normalizeUserSchema • Uses injected lockUser
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { getRank } from "../utils/rankSystem.js";

export default {
  data: new SlashCommandBuilder()
    .setName("swapicon")
    .setDescription("Swap between your default and female rank icon."),

  async execute(
    interaction,
    trainerData,
    saveTrainerDataLocal,   // unused but kept for signature consistency
    saveDataToDiscord,      // unused here
    lockUser,               // ⭐ injected by bot_final.js
    enqueueSave,            // unused here
    client                  // unused here
  ) {

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const userId = interaction.user.id;
    const guild = interaction.guild;

    // ======================================================
    // 🔒 Race-safe: lock user during rank icon swap
    // ======================================================
    return lockUser(userId, async () => {

      const user = trainerData[userId];

      if (!user) {
        return safeReply(interaction, {
          content: "You don't have trainer data yet. Use `/trainercard` first.",
          flags: MessageFlags.Ephemeral
        });
      }

      // Rank is based ONLY on TP now — schema is guaranteed by ensureUserInitialized
      const tp = user.tp ?? 0;
      const baseRank = getRank(tp);
      const femaleRank = `${baseRank} (F)`;

      // Look for roles
      const baseRole = guild.roles.cache.find(r => r.name === baseRank);
      const femaleRole = guild.roles.cache.find(r => r.name === femaleRank);

      if (!baseRole || !femaleRole) {
        return safeReply(interaction, {
          content: "Your rank roles are missing. Please notify an admin.",
          flags: MessageFlags.Ephemeral
        });
      }

      const member = await guild.members.fetch(userId);
      const hasBase = member.roles.cache.has(baseRole.id);
      const hasFemale = member.roles.cache.has(femaleRole.id);

      try {
        // ======================================================
        // CASE 1: Has base → swap to female icon
        // ======================================================
        if (hasBase) {
          await member.roles.remove(baseRole);
          await member.roles.add(femaleRole);

          return safeReply(interaction, {
            embeds: [
              new EmbedBuilder()
                .setTitle("🌸 Icon Swapped!")
                .setDescription(`You're now using the **female icon** for **${baseRank}**.`)
                .setColor(0xff69b4)
                .setTimestamp()
            ],
            flags: MessageFlags.Ephemeral
          });
        }

        // ======================================================
        // CASE 2: Has female → swap to default icon
        // ======================================================
        if (hasFemale) {
          await member.roles.remove(femaleRole);
          await member.roles.add(baseRole);

          return safeReply(interaction, {
            embeds: [
              new EmbedBuilder()
                .setTitle("💪 Icon Swapped!")
                .setDescription(`You're now using the **default icon** for **${baseRank}**.`)
                .setColor(0x5865f2)
                .setTimestamp()
            ],
            flags: MessageFlags.Ephemeral
          });
        }

        // ======================================================
        // CASE 3: Has neither → default fallback
        // ======================================================
        await member.roles.add(baseRole);

        return safeReply(interaction, {
          embeds: [
            new EmbedBuilder()
              .setTitle("🔧 Rank Icon Restored")
              .setDescription(`You had no rank icon, so you now have the **${baseRank}** icon.`)
              .setColor(0x43b581)
              .setTimestamp()
          ],
          flags: MessageFlags.Ephemeral
        });

      } catch (err) {
        console.error("❌ swapicon failed:", err);
        return safeReply(interaction, {
          content: "Something went wrong while swapping your icons.",
          flags: MessageFlags.Ephemeral
        });
      }
    });
  }
};
