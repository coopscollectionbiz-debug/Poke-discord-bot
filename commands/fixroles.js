// ==========================================================
// /fixroles.js — Admin-Only Command
// Ensures all users have the correct rank role (default, not female)
// ==========================================================
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { getRank, getRankTiers } from "../utils/rankSystem.js";

export default {
  data: new SlashCommandBuilder()
    .setName("fixroles")
    .setDescription("Admin-only: Synchronize rank roles for all users.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData) {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const rankTiers = getRankTiers();

    let updated = 0;
    let errors = 0;

    for (const [id, user] of Object.entries(trainerData)) {
      const member = await guild.members.fetch(id).catch(() => null);
      if (!member) continue;

      const tp = user.tp || 0;
      const correctRoleName = getRank(tp);
      const correctFemale = `${correctRoleName} (F)`;

      // Remove all rank roles (both male/female)
      for (const tier of rankTiers) {
        const base = guild.roles.cache.find(r => r.name === tier.roleName);
        const female = guild.roles.cache.find(r => r.name === `${tier.roleName} (F)`);
        if (base && member.roles.cache.has(base.id)) await member.roles.remove(base).catch(() => {});
        if (female && member.roles.cache.has(female.id)) await member.roles.remove(female).catch(() => {});
      }

      // Add correct default role (non-F)
      const newRole = guild.roles.cache.find(r => r.name === correctRoleName);
      if (newRole) {
        await member.roles.add(newRole).catch(() => { errors++; });
        updated++;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("🧩 Role Synchronization Complete")
      .setDescription(`✅ Updated **${updated}** members\n⚠️ Errors: **${errors}**`)
      .setColor(0x43b581)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
