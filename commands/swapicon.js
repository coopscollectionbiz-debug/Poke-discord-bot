// ==========================================================
// /swapicon — Toggle between default & female rank icon (v3.0)
// Race-Safe • Schema-Safe • Role-Safe
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { getRank } from "../utils/rankSystem.js";
import { lockUser } from "../utils/userLocks.js";

export default {
  data: new SlashCommandBuilder()
    .setName("swapicon")
    .setDescription("Swap between your default and female rank icon."),

  async execute(interaction, trainerData) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const guild = interaction.guild;

    // ======================================================
    // 🔒 Race-safe: lock user during role swap
    // ======================================================
    return lockUser(userId, async () => {
      let user = trainerData[userId];

      if (!user) {
        return safeReply(interaction, {
          content: "⚠️ You don't have trainer data yet. Use `/trainercard` first.",
          ephemeral: true
        });
      }

      // Always normalize before reading schema
      user = normalizeUserSchema(userId, user);
      trainerData[userId] = user;

      const tp = user.tp ?? 0;
      const baseRank = getRank(tp);
      const femaleRank = `${baseRank} (F)`;

      // Fetch roles
      const baseRole = guild.roles.cache.find(r => r.name === baseRank);
      const femaleRole = guild.roles.cache.find(r => r.name === femaleRank);

      if (!baseRole || !femaleRole) {
        return safeReply(interaction, {
          content: "⚠️ Your rank roles are missing. Please notify an admin.",
          ephemeral: true
        });
      }

      const member = await guild.members.fetch(userId);
      const hasBase = member.roles.cache.has(baseRole.id);
      const hasFemale = member.roles.cache.has(femaleRole.id);

      try {
        // ======================================================
        // CASE 1: Currently default → swap to female
        // ======================================================
        if (hasBase) {
          await member.roles.remove(baseRole);
          await member.roles.add(femaleRole);

          return safeReply(interaction, {
            embeds: [
              new EmbedBuilder()
                .setTitle("🌸 Icon Swapped!")
                .setDescription(`You are now using the **Female Icon** for **${baseRank}**.`)
                .setColor(0xff69b4)
                .setTimestamp()
            ],
            ephemeral: true
          });
        }

        // ======================================================
        // CASE 2: Currently female → swap to default
        // ======================================================
        if (hasFemale) {
          await member.roles.remove(femaleRole);
          await member.roles.add(baseRole);

          return safeReply(interaction, {
            embeds: [
              new EmbedBuilder()
                .setTitle("💪 Icon Swapped!")
                .setDescription(`You are now using the **Default Icon** for **${baseRank}**.`)
                .setColor(0x5865f2)
                .setTimestamp()
            ],
            ephemeral: true
          });
        }

        // ======================================================
        // CASE 3: User has neither role (rank changed recently)
        // ======================================================
        await member.roles.add(baseRole);

        return safeReply(interaction, {
          embeds: [
            new EmbedBuilder()
              .setTitle("🔧 Rank Icon Restored")
              .setDescription(`You were missing a rank icon — **${baseRank}** has been assigned.`)
              .setColor(0x43b581)
              .setTimestamp()
          ],
          ephemeral: true
        });

      } catch (err) {
        console.error("❌ swapicon failed:", err);
        return safeReply(interaction, {
          content: "❌ Something went wrong while swapping your icons.",
          ephemeral: true
        });
      }
    }); // end lockUser
  }
};
