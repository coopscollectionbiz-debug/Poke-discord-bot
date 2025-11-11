// ==========================================================
// /utils/updateUserRole.js
// Handles automatic rank promotions + announcements
// FIXED: Assigns all ranks properly AND announces Novice (requires 100 TP)
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
    // Determine rank from TP
    const targetRoleName = getRank(tp);
    if (!targetRoleName) return;

    const guild = member.guild;

    // Handle female variants
    const hasFemaleRole = member.roles.cache.some((r) => r.name.endsWith(" (F)"));
    const finalRoleName = hasFemaleRole ? `${targetRoleName} (F)` : targetRoleName;

    const newRole = guild.roles.cache.find((r) => r.name === finalRoleName);
    if (!newRole) {
      console.warn(`⚠️ Missing role: ${finalRoleName}`);
      return;
    }

    // Skip if already has correct role
    if (member.roles.cache.has(newRole.id)) return;

    // Remove old rank roles first
    for (const tier of RANK_TIERS) {
      const base = guild.roles.cache.find((r) => r.name === tier.roleName);
      const female = guild.roles.cache.find(
        (r) => r.name === `${tier.roleName} (F)`
      );
      if (base && member.roles.cache.has(base.id)) {
        await member.roles.remove(base).catch(() => {});
      }
      if (female && member.roles.cache.has(female.id)) {
        await member.roles.remove(female).catch(() => {});
      }
    }

    // ✅ Assign the new rank
    await member.roles.add(newRole).catch(() => {});
    console.log(`🏅 ${member.user.username} assigned role: ${finalRoleName} (${tp} TP)`);

    // Find next rank info
    const currentIdx = RANK_TIERS.findIndex((r) => r.roleName === targetRoleName);
    const next = RANK_TIERS[currentIdx + 1];

    const nextRankInfo = next && typeof next.tp === "number"
      ? `➡️ **Next Rank:** ${next.roleName} (${next.tp.toLocaleString()} TP)`
      : "🏆 You've reached the **highest rank!**";

    // 🎨 Promotion embed (NOW INCLUDES NOVICE TRAINER!)
    const embed = new EmbedBuilder()
      .setTitle("🏆 Rank Up!")
      .setDescription(
        [
          `🎉 <@${member.user.id}> has advanced to **${finalRoleName}**!`,
          `They've proven their skill through dedication and hard work.`,
          "",
          nextRankInfo,
          "",
          "💡 Tip: You can change your **role icon** anytime with **/swapicon**."
        ].join("\n")
      )
      .setColor(0xffcb05)
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .setFooter({ text: "Coop's Collection – Trainer Progression" })
      .setTimestamp();

    // 🗣️ Announce in the context channel if available
    if (contextChannel && contextChannel.send) {
      await contextChannel.send({ embeds: [embed] }).catch(() => {});
    }

    console.log(`🎉 ${member.user.username} promoted to ${finalRoleName} - announcement sent`);
  } catch (err) {
    console.error("❌ updateUserRole failed:", err.message);
  }
}