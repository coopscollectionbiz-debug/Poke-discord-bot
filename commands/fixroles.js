// ==========================================================
// /fixroles.js — Optimized & Rate-Limited
// ==========================================================
import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} from "discord.js";
import { getRank, getRankTiers } from "../utils/rankSystem.js";

export default {
  data: new SlashCommandBuilder()
    .setName("fixroles")
    .setDescription("Admin-only: Synchronize rank roles for all users (default, not female).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData) {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const rankTiers = getRankTiers();

    console.log("🧩 Fetching all guild members...");
    const members = await guild.members.fetch(); // one API call only
    console.log(`✅ Retrieved ${members.size} members.`);

    let updated = 0;
    let errors = 0;
    let processed = 0;

    // Iterate trainerData only for members that exist in the guild
    for (const [id, user] of Object.entries(trainerData)) {
      const member = members.get(id);
      if (!member) continue;

      const tp = user.tp || 0;
      const correctRoleName = getRank(tp);
      if (!correctRoleName) continue;

      // Remove both male/female variants
      for (const tier of rankTiers) {
        const base = guild.roles.cache.find(r => r.name === tier.roleName);
        const female = guild.roles.cache.find(r => r.name === `${tier.roleName} (F)`);
        if (base && member.roles.cache.has(base.id))
          await member.roles.remove(base).catch(() => { errors++; });
        if (female && member.roles.cache.has(female.id))
          await member.roles.remove(female).catch(() => { errors++; });
      }

      // Add correct default role
      const newRole = guild.roles.cache.find(r => r.name === correctRoleName);
      if (newRole && !member.roles.cache.has(newRole.id)) {
        await member.roles.add(newRole).catch(() => { errors++; });
        updated++;
      }

      processed++;
      if (processed % 20 === 0) {
        console.log(`Processed ${processed} members...`);
        // prevent hitting rate limits
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("🧩 Role Synchronization Complete")
      .setDescription(
        `✅ Updated **${updated}** members\n⚠️ Errors: **${errors}**\n🧠 Processed: **${processed}** total`
      )
      .setColor(0x43b581)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    console.log("✅ /fixroles complete");
  }
};
