// ==========================================================
// updateUserRole.js — Coop’s Collection
// Rank Auto-Assignment + Promotion Announcements (v5.0)
// REST-minimized • Coalesced role set update • Female-variant safe
// ==========================================================

import { EmbedBuilder } from "discord.js";
import { getRank, getRankTiers } from "../utils/rankSystem.js";

const RANK_TIERS = getRankTiers();

// ----------------------------------------------------------
// Cache rank role IDs per guild to avoid repeated name scans
// guildId -> { male: Map<rankName, roleId>, female: Map<rankName, roleId>, allRankRoleIds: Set<roleId> }
// ----------------------------------------------------------
const guildRankRoleCache = new Map();

function buildGuildRoleCache(guild) {
  const male = new Map();
  const female = new Map();
  const allRankRoleIds = new Set();

  for (const tier of RANK_TIERS) {
    const baseName = tier.roleName;

    const baseRole = guild.roles.cache.find((r) => r.name === baseName);
    if (baseRole) {
      male.set(baseName, baseRole.id);
      allRankRoleIds.add(baseRole.id);
    }

    const femaleRole = guild.roles.cache.find((r) => r.name === `${baseName} (F)`);
    if (femaleRole) {
      female.set(baseName, femaleRole.id);
      allRankRoleIds.add(femaleRole.id);
    }
  }

  const cache = { male, female, allRankRoleIds };
  guildRankRoleCache.set(guild.id, cache);
  return cache;
}

function getGuildRoleCache(guild) {
  // If roles changed (new roles / renamed), you can clear this map on demand.
  return guildRankRoleCache.get(guild.id) || buildGuildRoleCache(guild);
}

function memberHasFemaleVariant(member, cache) {
  // If they have ANY female rank role, treat as female variant
  for (const roleId of cache.female.values()) {
    if (member.roles.cache.has(roleId)) return true;
  }
  // Fallback: also detect by name if cache misses (rare)
  return member.roles.cache.some((r) => r.name.endsWith(" (F)"));
}

function getCurrentRankRoleId(member, cache) {
  // Find any rank role the member currently has (male or female)
  for (const roleId of cache.allRankRoleIds) {
    if (member.roles.cache.has(roleId)) return roleId;
  }
  return null;
}

function roleIdToName(guild, roleId) {
  return guild.roles.cache.get(roleId)?.name || null;
}

/**
 * Applies correct rank role to a user based on TP
 * and sends a promotion announcement if rank changes.
 *
 * REST minimized:
 * - No per-tier remove() calls
 * - ONE roles.set() call when a change is needed
 *
 * @param {GuildMember} member
 * @param {number} tp
 * @param {TextChannel} [contextChannel=null]
 */
export async function updateUserRole(member, tp, contextChannel = null) {
  try {
    const guild = member.guild;

    const baseRank = getRank(tp);
    if (!baseRank) return;

    const cache = getGuildRoleCache(guild);

    // Determine whether to use female variant
    const hasFemale = memberHasFemaleVariant(member, cache);

    const targetRoleId = hasFemale
      ? cache.female.get(baseRank)
      : cache.male.get(baseRank);

    if (!targetRoleId) {
      // Cache might be stale (roles renamed/added). Rebuild once and retry.
      const rebuilt = buildGuildRoleCache(guild);
      const retryRoleId = hasFemale
        ? rebuilt.female.get(baseRank)
        : rebuilt.male.get(baseRank);

      if (!retryRoleId) {
        console.warn(`⚠️ Missing role for rank: ${hasFemale ? `${baseRank} (F)` : baseRank}`);
        return;
      }
      // continue with retryRoleId
      return await updateUserRole(member, tp, contextChannel);
    }

    const currentRankRoleId = getCurrentRankRoleId(member, cache);

    // Already correct? bail (no REST, no announcement)
    if (currentRankRoleId === targetRoleId) return;

    // Build new roles array: keep all non-rank roles, replace rank role with target
    const keptRoleIds = member.roles.cache
      .filter((r) => !cache.allRankRoleIds.has(r.id))
      .map((r) => r.id);

    const nextRoleIds = [...keptRoleIds, targetRoleId];

    // ✅ ONE REST call: set final role set
    await member.roles.set(nextRoleIds).catch(() => {});

    const finalRoleName = roleIdToName(guild, targetRoleId) || (hasFemale ? `${baseRank} (F)` : baseRank);
    console.log(`🏅 ${member.user.username} → ${finalRoleName} (${tp} TP)`);

    // Promotion embed only if a channel was provided
    if (contextChannel && typeof contextChannel.send === "function") {
      const idx = RANK_TIERS.findIndex((t) => t.roleName === baseRank);
      const nextTier = RANK_TIERS[idx + 1];

      const nextRankInfo = nextTier
        ? `➡️ **Next Rank:** ${nextTier.roleName} (${nextTier.tp.toLocaleString()} TP)`
        : "🏆 You've reached the **highest rank!**";

      const embed = new EmbedBuilder()
        .setTitle("🏆 Rank Up!")
        .setDescription(
          [
            `🎉 <@${member.user.id}> has advanced to **${finalRoleName}**!`,
            `Their dedication and activity have earned them a promotion.`,
            "",
            nextRankInfo,
            "",
            "💡 **Tip:** You can toggle your rank icon anytime using **/swapicon**.",
          ].join("\n")
        )
        .setColor(0xffcb05)
        .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
        .setFooter({ text: "Coop's Collection – Trainer Progression" })
        .setTimestamp();

      await contextChannel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err) {
    console.error("❌ updateUserRole failed:", err);
  }
}
