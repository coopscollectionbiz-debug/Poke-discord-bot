import { EmbedBuilder, PermissionsBitField } from "discord.js";
import { getRank, getRankTiers } from "../utils/rankSystem.js";

const RANK_TIERS = getRankTiers();

// guildId -> { male: Map, female: Map, allRankRoleIds: Set }
const guildRankRoleCache = new Map();

// Simple per-member cooldown to avoid hammering roles.set in bursts
// key = `${guildId}:${userId}` -> nextAllowedAtMs
const roleSetCooldown = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
  return guildRankRoleCache.get(guild.id) || buildGuildRoleCache(guild);
}

function memberHasFemaleVariant(member, cache) {
  for (const roleId of cache.female.values()) {
    if (member.roles.cache.has(roleId)) return true;
  }
  return member.roles.cache.some((r) => r.name.endsWith(" (F)"));
}

function getCurrentRankRoleId(member, cache) {
  for (const roleId of cache.allRankRoleIds) {
    if (member.roles.cache.has(roleId)) return roleId;
  }
  return null;
}

function roleIdToName(guild, roleId) {
  return guild.roles.cache.get(roleId)?.name || null;
}

function extractRetryAfterMs(err) {
  // discord.js REST errors commonly include retry_after in err?.data or err?.rawError
  const ra =
    err?.retry_after ??
    err?.data?.retry_after ??
    err?.rawError?.retry_after ??
    err?.response?.data?.retry_after;

  if (typeof ra === "number") return Math.ceil(ra * 1000); // seconds -> ms
  return null;
}

export async function updateUserRole(member, tp, contextChannel = null) {
  try {
    const guild = member.guild;

    const baseRank = getRank(tp);
    if (!baseRank) return;

    // Quick permission/managed checks (prevents pointless REST)
    if (!member.manageable) {
      // Bot can’t edit this member (role hierarchy)
      return;
    }
    const me = guild.members.me;
    if (me && !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return;
    }

    // Cooldown guard to prevent bursts
    const cdKey = `${guild.id}:${member.id}`;
    const now = Date.now();
    const nextOk = roleSetCooldown.get(cdKey) || 0;
    if (now < nextOk) return;

    let cache = getGuildRoleCache(guild);

    const hasFemale = memberHasFemaleVariant(member, cache);
    let targetRoleId = hasFemale ? cache.female.get(baseRank) : cache.male.get(baseRank);

    // If missing role, rebuild cache ONCE and retry lookup (no recursion)
    if (!targetRoleId) {
      cache = buildGuildRoleCache(guild);
      targetRoleId = hasFemale ? cache.female.get(baseRank) : cache.male.get(baseRank);

      if (!targetRoleId) {
        console.warn(
          `⚠️ Missing rank role for "${baseRank}" (${hasFemale ? "female" : "male"}). ` +
          `Check role names exactly match: "${baseRank}" and/or "${baseRank} (F)".`
        );
        // Don’t keep trying every flush — wait 10 minutes before reattempting
        roleSetCooldown.set(cdKey, now + 10 * 60_000);
        return;
      }
    }

    const currentRankRoleId = getCurrentRankRoleId(member, cache);
    if (currentRankRoleId === targetRoleId) return;

    const keptRoleIds = member.roles.cache
      .filter((r) => !cache.allRankRoleIds.has(r.id))
      .map((r) => r.id);

    const nextRoleIds = [...keptRoleIds, targetRoleId];

    // Attempt role set with rate-limit aware backoff
    try {
      await member.roles.set(nextRoleIds);
    } catch (e) {
      const code = e?.code;
      const status = e?.status;

      // If we’re rate limited, back off for retry_after (or 2 minutes fallback)
      if (status === 429 || code === 429) {
        const raMs = extractRetryAfterMs(e) ?? 120_000;
        console.warn(`⏳ Rate limited on roles.set for ${member.id}. Backing off ${Math.round(raMs / 1000)}s.`);
        roleSetCooldown.set(cdKey, Date.now() + raMs);
        return;
      }

      // If permissions/hierarchy issues, back off longer and log
      if (status === 403 || code === 50013) {
        console.warn(`🚫 Cannot set roles for ${member.id} (403/50013). Check bot role hierarchy + Manage Roles.`);
        roleSetCooldown.set(cdKey, Date.now() + 30 * 60_000);
        return;
      }

      console.warn(`⚠️ roles.set failed for ${member.id}:`, e?.message || e);
      roleSetCooldown.set(cdKey, Date.now() + 5 * 60_000);
      return;
    }

    // If it succeeded, small cooldown to prevent immediate re-writes
    roleSetCooldown.set(cdKey, Date.now() + 15_000);

    const finalRoleName =
      roleIdToName(guild, targetRoleId) || (hasFemale ? `${baseRank} (F)` : baseRank);

    console.log(`🏅 ${member.user.username} → ${finalRoleName} (${tp} TP)`);

    // Promotion message (optional)
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

      await contextChannel.send({ embeds: [embed] }).catch((e) => {
        // Don’t treat send failures as fatal
        console.warn("⚠️ promotion embed send failed:", e?.message || e);
      });
    }
  } catch (err) {
    console.error("❌ updateUserRole failed:", err?.message || err);
  }
}
