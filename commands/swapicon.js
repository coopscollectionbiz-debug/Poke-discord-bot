// ==========================================================
// /swapicon.js — User Command
// Toggle between default and female role variant
// ==========================================================
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getRank } from "../utils/rankSystem.js";

export default {
  data: new SlashCommandBuilder()
    .setName("swapicon")
    .setDescription("Swap between your default and female rank icon."),

  async execute(interaction, trainerData) {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const user = trainerData[interaction.user.id];

    if (!user) {
      return interaction.editReply("⚠️ You don't have trainer data yet. Try `/trainercard` first.");
    }

    const tp = user.tp || 0;
    const baseRank = getRank(tp);
    const femaleRank = `${baseRank} (F)`;

    const baseRole = guild.roles.cache.find(r => r.name === baseRank);
    const femaleRole = guild.roles.cache.find(r => r.name === femaleRank);

    if (!baseRole || !femaleRole) {
      return interaction.editReply("⚠️ One or both of your rank roles are missing from the server setup.");
    }

    const member = await guild.members.fetch(interaction.user.id);
    const hasBase = member.roles.cache.has(baseRole.id);
    const hasFemale = member.roles.cache.has(femaleRole.id);

    try {
      if (hasBase) {
        await member.roles.remove(baseRole);
        await member.roles.add(femaleRole);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🌸 Role Icon Swapped!")
              .setDescription(`You are now using the **Female Icon** for **${baseRank}**.`)
              .setColor(0xff69b4)
              .setTimestamp()
          ]
        });
      } else if (hasFemale) {
        await member.roles.remove(femaleRole);
        await member.roles.add(baseRole);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("💪 Role Icon Swapped!")
              .setDescription(`You are now using the **Default Icon** for **${baseRank}**.`)
              .setColor(0x5865f2)
              .setTimestamp()
          ]
        });
      } else {
        // No rank currently, assign default
        await member.roles.add(baseRole);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅ Role Assigned")
              .setDescription(`You were missing a rank — **${baseRank}** has been applied.`)
              .setColor(0x43b581)
              .setTimestamp()
          ]
        });
      }
    } catch (err) {
      console.error("❌ swapicon failed:", err);
      await interaction.editReply("❌ Something went wrong while swapping roles.");
    }
  }
};
