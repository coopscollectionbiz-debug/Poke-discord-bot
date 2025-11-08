import { EmbedBuilder } from "discord.js";
import { getRank, getRankTiers } from "../utils/rankSystem.js";

const RANK_TIERS = getRankTiers();

export async function updateUserRole(member, tp, contextChannel = null) {
  try {
    const targetRole = getRank(tp);
    if (!targetRole) return;

    const guild = member.guild;
    const hasFemaleRole = member.roles.cache.some(r => r.name.endsWith(" (F)"));
    const roleName = hasFemaleRole ? `${targetRole} (F)` : targetRole;
    const newRole = guild.roles.cache.find(r => r.name === roleName);
    if (!newRole) return console.warn(`⚠️ Missing role: ${roleName}`);

    // 🛡️ Skip if already has this rank
    if (member.roles.cache.has(newRole.id)) return;

    // 🧹 Remove old ranks
    for (const tier of RANK_TIERS) {
      const base = guild.roles.cache.find(r => r.name === tier.roleName);
      const female = guild.roles.cache.find(r => r.name === `${tier.roleName} (F)`);
      if (base && member.roles.cache.has(base.id)) await member.roles.remove(base).catch(() => {});
      if (female && member.roles.cache.has(female.id)) await member.roles.remove(female).catch(() => {});
    }

    // 🏅 Add the new rank
    await member.roles.add(newRole).catch(() => {});

    // 🧾 Determine next rank info
    const currentIndex = RANK_TIERS.findIndex(r => r.roleName === targetRole);
    const nextRank = RANK_TIERS[currentIndex + 1];
    const nextRankInfo = nextRank
      ? `➡️ **Next Rank:** ${nextRank.roleName} (${nextRank.tpRequired.toLocaleString()} TP)`
      : "🏁 You’ve reached the **highest rank!**";

    // 🪩 Create the announcement embed
    const embed = new EmbedBuilder()
      .setTitle("🏆 Rank Up!")
      .setDescription(
        `**${member.user.username}** has advanced to **${roleName}**!\n` +
        `They’ve proven their skills through dedication and hard work.\n\n${nextRankInfo}`
      )
      .setColor(0xffcb05)
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .setFooter({ text: "Coop’s Collection — Trainer Progression" })
      .setTimestamp();

    // 🎉 Send embed + ping user in the same channel they leveled up
    if (contextChannel && contextChannel.send) {
      await contextChannel.send({
        content: `🎖️ Congratulations <@${member.id}>!`, // 👈 adds the ping
        embeds: [embed],
      }).catch(() => {});
    }

    console.log(`🏅 ${member.user.username} promoted to ${roleName}`);
  } catch (err) {
    console.error("❌ updateUserRole failed:", err.message);
  }
}
