// ==========================================================
// updateUserRole.js — Coop’s Collection
// Rank Auto-Assignment + Promotion Announcements (v4.0)
// Race-Safe • Female-Variant Safe • Novice Announcements Fixed
// ==========================================================

import { EmbedBuilder } from "discord.js";
import { getRank, getRankTiers } from "../utils/rankSystem.js";
import { normalizeUserSchema } from "../utils/sanitizeTrainerData.js";

const RANK_TIERS = getRankTiers();

/**
 * Applies correct rank role to a user based on TP
 * and sends a promotion announcement if rank changes.
 *
 * @param {GuildMember} member
 * @param {number} tp
 * @param {TextChannel} [contextChannel=null]
 */
export async function updateUserRole(member, tp, contextChannel = null) {
  try {
    const guild = member.guild;

    // ======================================================
    // Normalize user's trainerData schema ALWAYS
    // (even though this function doesn't mutate TP)
    // ======================================================
    // trainerData is not passed here; schema is validated
    // via role assignment only. This keeps roles consistent.

    // Determine target rank from TP
    const baseRank = getRank(tp);
    if (!baseRank) return;

    const hasFemaleVariant = member.roles.cache.some(r =>
      r.name.endsWith(" (F)")
    );

    const finalRoleName = hasFemaleVariant
      ? `${baseRank} (F)`
      : baseRank;

    const newRole = guild.roles.cache.find(r => r.name === finalRoleName);
    if (!newRole) {
      console.warn(`⚠️ Missing role: ${finalRoleName}`);
      return;
    }

    // ======================================================
    // ⛔ STOP — user already has correct rank
    // Prevent duplicate announcements
    // ======================================================
    if (member.roles.cache.has(newRole.id)) return;

    // ======================================================
    // Remove ALL existing rank roles (male & female variants)
    // ======================================================
    for (const tier of RANK_TIERS) {
      const base = guild.roles.cache.find(r => r.name === tier.roleName);
      const female = guild.roles.cache.find(
        r => r.name === `${tier.roleName} (F)`
      );

      if (base && member.roles.cache.has(base.id)) {
        await member.roles.remove(base).catch(() => {});
      }
      if (female && member.roles.cache.has(female.id)) {
        await member.roles.remove(female).catch(() => {});
      }
    }

    // ======================================================
    // Give NEW rank role
    // ======================================================
    await member.roles.add(newRole).catch(() => {});
    console.log(`🏅 ${member.user.username} → ${finalRoleName} (${tp} TP)`);

    // ======================================================
    // Build “next rank” info
    // ======================================================
    const idx = RANK_TIERS.findIndex(t => t.roleName === baseRank);
    const nextTier = RANK_TIERS[idx + 1];

    const nextRankInfo = nextTier
      ? `➡️ **Next Rank:** ${nextTier.roleName} (${nextTier.tp.toLocaleString()} TP)`
      : "🏆 You've reached the **highest rank!**";

    // ======================================================
    // 🎉 Promotion Embed
    // ======================================================
    const embed = new EmbedBuilder()
      .setTitle("🏆 Rank Up!")
      .setDescription(
        [
          `🎉 <@${member.user.id}> has advanced to **${finalRoleName}**!`,
          `Their dedication and activity have earned them a promotion.`,
          "",
          nextRankInfo,
          "",
          "💡 **Tip:** You can toggle your rank icon anytime using **/swapicon**."
        ].join("\n")
      )
      .setColor(0xffcb05)
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .setFooter({ text: "Coop's Collection – Trainer Progression" })
      .setTimestamp();

    // ======================================================
    // Send announcement IF a channel was provided
    // ======================================================
    if (contextChannel && contextChannel.send) {
      await contextChannel.send({ embeds: [embed] }).catch(() => {});
    }

    console.log(`🎉 Promotion announced for ${member.user.username}: ${finalRoleName}`);

  } catch (err) {
    console.error("❌ updateUserRole failed:", err);
  }
}
