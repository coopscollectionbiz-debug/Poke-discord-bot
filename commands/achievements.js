// ==========================================================
// /achievements — view progress and claim approved rewards (Release C)
//
// Ephemeral. Overview + category browser, 6 per page. Hidden achievements
// show as "???" until unlocked. A Claim button appears only when the page
// has a claimable (approved, unlocked, unclaimed) reward; claims use the
// same locked, once-only service as the dashboard. Every component carries
// a per-message nonce and only the invoking player can press it.
// ==========================================================

import crypto from "crypto";
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } from "discord.js";
import { achievementView } from "../progression/achievements.js";
import { CATEGORIES } from "../catalog/achievements.js";
import { createAchievementHandlers } from "../services/achievementsApi.js";
import { defaultRewardPolicy } from "../config/achievementRewards.js";
import { saveAndAck } from "../utils/saveManager.js";
import { lockUser as defaultLockUser } from "../utils/userLocks.js";
import { safeReply } from "../utils/safeReply.js";

export const ACHIEVEMENTS_PAGE_SIZE = 6;
const ALL = "all";
const isCategory = (c) => typeof c === "string" && Object.prototype.hasOwnProperty.call(CATEGORIES, c);

export function parseAchievementsCustomId(customId) {
  const m = /^ach:([a-f0-9]{8,32}):(cat|prev|next|claim)$/.exec(String(customId || ""));
  return m ? { nonce: m[1], action: m[2] } : null;
}

function bar(value, target) {
  const n = 8;
  const filled = target > 0 ? Math.min(n, Math.floor((value / target) * n)) : 0;
  return "▰".repeat(filled) + "▱".repeat(n - filled);
}

function rewardText(r) {
  if (!r.reward) return "";
  const parts = [];
  if (r.reward.cc) parts.push(`${r.reward.cc.toLocaleString("en-US")} CC`);
  for (const [k, v] of Object.entries(r.reward.items || {})) parts.push(`${v}× ${k.replace(/_/g, " ")}`);
  for (const k of ["title", "badge", "cosmetic"]) if (r.reward[k]) parts.push(k);
  if (!parts.length) return "";
  if (r.claimed) return `\n> 🎁 ${parts.join(", ")} · claimed`;
  return `\n> 🎁 ${parts.join(", ")} · ${r.reward.status === "available" ? (r.unlocked ? "**ready to claim**" : "available when unlocked") : "pending approval"}`;
}

/** Pure view builder (tested without Discord). */
export function buildAchievementsView(user, { category = ALL, page = 0, nonce, policy = defaultRewardPolicy, disabled = false } = {}) {
  const cat = category !== ALL && isCategory(category) ? category : ALL;
  const v = achievementView(user, { policy, category: cat === ALL ? null : cat });
  const rows = v.achievements;
  const pages = Math.max(1, Math.ceil(rows.length / ACHIEVEMENTS_PAGE_SIZE));
  const p = Math.max(0, Math.min(Number.isInteger(page) ? page : 0, pages - 1));
  const slice = rows.slice(p * ACHIEVEMENTS_PAGE_SIZE, (p + 1) * ACHIEVEMENTS_PAGE_SIZE);

  const lines = slice.map((r) => {
    const icon = r.unlocked ? "✅" : r.hidden ? "❔" : "🔒";
    const prog = r.progress && !r.unlocked ? `\n> ${bar(r.progress.value, r.progress.target)} ${r.progress.value.toLocaleString("en-US")}/${r.progress.target.toLocaleString("en-US")}` : "";
    const meta = r.ap == null ? r.tierName : `${r.tierName} · ${r.ap} AP`;
    return `${icon} **${r.name}** · ${meta}\n> ${r.description}${prog}${rewardText(r)}`;
  });
  const pct = (a, b) => (b > 0 ? Math.floor((100 * a) / b) : 0);
  const header =
    cat === ALL
      ? v.categories.map((c) => `${c.emoji} ${c.label}: **${c.unlocked}/${c.total}** (${pct(c.unlocked, c.total)}%)`).join("\n") + "\n\n"
      : "";
  const embed = new EmbedBuilder()
    .setColor(0xf5b301)
    .setTitle(`🏅 Achievements · ${v.ap.toLocaleString("en-US")} AP · ${v.unlocked}/${v.total} (${pct(v.unlocked, v.total)}%)`)
    .setDescription((header + (lines.join("\n\n") || "No achievements here.")).slice(0, 4000))
    .setFooter({ text: `${cat === ALL ? "All categories" : CATEGORIES[cat].label} · Page ${p + 1}/${pages} · Rewards marked "pending approval" can't be claimed yet` });

  const claimable = slice.filter((r) => r.claimable).map((r) => r.id);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`ach:${nonce}:cat`)
    .setPlaceholder("Choose a category")
    .setDisabled(disabled)
    .addOptions(
      [{ label: "All achievements", value: ALL, emoji: "🏅", default: cat === ALL }].concat(
        Object.entries(CATEGORIES)
          .sort((a, b) => a[1].order - b[1].order)
          .map(([key, c]) => ({ label: c.label, value: key, emoji: c.emoji, default: cat === key }))
      )
    );
  const buttons = [
    new ButtonBuilder().setCustomId(`ach:${nonce}:prev`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary).setDisabled(disabled || p === 0),
    new ButtonBuilder().setCustomId(`ach:${nonce}:next`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(disabled || p >= pages - 1),
  ];
  if (claimable.length) {
    buttons.push(new ButtonBuilder().setCustomId(`ach:${nonce}:claim`).setLabel(`Claim ${claimable.length} reward${claimable.length === 1 ? "" : "s"}`).setStyle(ButtonStyle.Success).setDisabled(disabled));
  }
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(...buttons)],
    page: p,
    pages,
    category: cat,
    claimable,
  };
}

/** Decide what a component press does (pure). */
export function reduceAchievementsInteraction(state, { userId, customId, values }, { ownerId, nonce }) {
  if (String(userId) !== String(ownerId)) return { allowed: false, reason: "These achievements aren't yours. Use `/achievements` to see your own." };
  const parsed = parseAchievementsCustomId(customId);
  if (!parsed || parsed.nonce !== nonce) return { allowed: false, reason: "That control is no longer valid. Run `/achievements` again." };
  if (parsed.action === "cat") {
    const v = Array.isArray(values) ? values[0] : null;
    if (v !== ALL && !isCategory(v)) return { allowed: false, reason: "Unknown category." };
    return { allowed: true, state: { category: v, page: 0 } };
  }
  if (parsed.action === "claim") return { allowed: true, claim: true, state };
  return { allowed: true, state: { ...state, page: state.page + (parsed.action === "next" ? 1 : -1) } };
}

/**
 * Claim every claimable reward on the current page via the shared service.
 * @returns {Promise<string>} a summary line for the player
 */
export async function claimPage(handlers, ownerId, ids) {
  const done = [];
  const failed = [];
  let delayed = false;
  for (const achievementId of ids) {
    const r = await handlers.claim({ body: { id: ownerId, achievementId }, isAuthorized: (id) => id === ownerId });
    if (r.status === 200) {
      done.push(achievementId);
      if (r.body.saved === false) delayed = true;
    } else failed.push(`${achievementId}: ${r.body.error}`);
  }
  let msg = done.length ? `🎁 Claimed ${done.length} reward${done.length === 1 ? "" : "s"}.` : "Nothing was claimed.";
  if (failed.length) msg += `\n${failed.join("\n")}`;
  if (delayed) msg += "\n⚠️ Saved with a delay: your rewards are kept and will be written shortly.";
  return msg;
}

export default {
  data: new SlashCommandBuilder().setName("achievements").setDescription("See your achievements, progress and rewards."),

  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, lockUser) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ownerId = interaction.user.id;
    if (!trainerData[ownerId]) {
      return safeReply(interaction, { content: "You don't have a trainer profile yet. Use `/trainercard` to get started.", flags: MessageFlags.Ephemeral });
    }
    const handlers = createAchievementHandlers({
      getTrainerData: () => trainerData,
      lockUser: typeof lockUser === "function" ? lockUser : defaultLockUser,
      save: saveAndAck,
    });
    const nonce = crypto.randomBytes(6).toString("hex");
    let state = { category: ALL, page: 0 };
    const render = (disabled = false) => buildAchievementsView(trainerData[ownerId], { ...state, nonce, disabled });

    const first = render();
    state = { category: first.category, page: first.page };
    await interaction.editReply({ embeds: first.embeds, components: first.components });
    const message = await interaction.fetchReply();

    const collector = message.createMessageComponentCollector({ time: 180_000 });
    let busy = false;
    collector.on("collect", async (i) => {
      const r = reduceAchievementsInteraction(state, { userId: i.user.id, customId: i.customId, values: i.values }, { ownerId, nonce });
      if (!r.allowed) return i.reply({ content: r.reason, flags: MessageFlags.Ephemeral }).catch(() => {});
      if (r.claim) {
        if (busy) return i.reply({ content: "Already claiming…", flags: MessageFlags.Ephemeral }).catch(() => {});
        busy = true;
        await i.deferUpdate().catch(() => {});
        const ids = buildAchievementsView(trainerData[ownerId], { ...state, nonce }).claimable;
        const summary = await claimPage(handlers, ownerId, ids);
        busy = false;
        const view = render();
        await interaction.editReply({ embeds: view.embeds, components: view.components }).catch(() => {});
        return i.followUp({ content: summary, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      const view = buildAchievementsView(trainerData[ownerId], { ...r.state, nonce });
      state = { category: view.category, page: view.page };
      await i.update({ embeds: view.embeds, components: view.components }).catch(() => {});
    });
    collector.on("end", async () => {
      const done = render(true);
      await interaction.editReply({ embeds: done.embeds, components: done.components }).catch(() => {});
    });
  },
};
