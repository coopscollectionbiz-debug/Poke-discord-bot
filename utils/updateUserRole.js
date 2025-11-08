// ==========================================================
// /utils/updateUserRole.js
// Handles automatic rank promotions + announcements
// ==========================================================

import { EmbedBuilder } from "discord.js";
import { getRank, getRankTiers } from "../utils/rankSystem.js";

const RANK_TIERS = getRankTiers();

/**
 * Updates a user's rank role and announces promotions
 * @param {GuildMember} member - The Discord guild member
 * @param {number} tp - Total trainer points
 * @param {TextChannel} [contextChannel=null] - Optional channel for announcements
 */
export async function updateUserRole(member, tp, contextChannel = null) {
  try {
    // ✅ Determine target rank based on TP
    const targetRole = getRank(tp);
    if (!targetRole) return;

    const guild = member.guild;

    // Handle female variants (if roles like “Novice Trainer (F)” exist)
    const hasFemaleRole = member.roles.cache.some((r) => r.name.endsWith(" (F)"));
    const roleName = hasFemaleRole ? `${targetRole} (F)` : targetRole;

    const newRole = guild.roles.cache.find((r) => r.name === roleName);
    if (!newRole) {
      console.warn(`⚠️ Missing role: ${roleName}`);
      return;
    }

    // Skip if user already has the correct rank
    if (member.roles.cache.has(newRole.id)) return;

    // Remove all old rank roles before applying new one
    for (const tier of RANK_TIERS) {
      const base = guild.roles.cache.find((r) => r.name === tier.roleName);
      const female = guild.roles.cache.find(
        (r) => r.name === `${tier.roleName} (F)`
      );
      if (base && member.roles.cache.has(base.id))
        await member.roles.remove(base).catch(() => {});
      if (female && member.roles.cache.has(female.id))
        await member.roles.remove(female).catch(() => {});
    }

    // ✅ Assign the new rank role
    await member.roles.add(newRole).catch(() => {});

    // Find next rank info for embed
    const currentIndex = RANK_TIERS.findIndex(
      (r) => r.roleName === targetRole
    );
    const nextRank = RANK_TIERS[currentIndex + 1];

    let nextRankInfo;
    if (nextRank && typeof nextRank.tp === "number") {
      nextRankInfo = `➡️ **Next Rank:** ${nextRank.roleName} (${nextRank.tp.toLocaleString()} TP)`;
    } else {
      nextRankInfo = "🏁 You’ve reached the **highest rank!**";
    }

    // 🎨 Build announcement embed
    const embed = new EmbedBuilder()
      .setTitle("🏆 Rank Up!")
      .setDescription(
        `🎉 <@${member.user.id}> has advanced to **${roleName}**!\n` +
          `They’ve proven their skill through dedication and hard work.\n\n${nextRankInfo}`
      )
      .setColor(0xffcb05)
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .setFooter({ text: "Coop’s Collection — Trainer Progression" })
      .setTimestamp();

    // 🗣️ Post announcement in the triggering channel (if available)
    if (contextChannel && contextChannel.send) {
      await contextChannel.send({ embeds: [embed] }).catch(() => {});
    }

    console.log(`🏅 ${member.user.username} promoted to ${roleName}`);
  } catch (err) {
    console.error("❌ updateUserRole failed:", err.message);
  }
}
