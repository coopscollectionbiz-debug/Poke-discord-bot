// ==========================================================
// /quest: the Daily board in Discord (Quests, Phase 1).
// A private summary of today's tasks, the chest and the weekly bonus, with
// Claim buttons and a link to the Quests page. Claims use the same locked,
// requestId-guarded service as the dashboard (services/questsApi.js).
// While QUESTS_ENABLED is off the command registers as admin-only and
// answers "not open yet".
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } from "discord.js";
import { randomUUID } from "node:crypto";
import { ensureQuests, questView, questsEnabled } from "../services/quests.js";
import { createQuestHandlers } from "../services/questsApi.js";
import { lockUser } from "../utils/userLocks.js";
import { saveAndAck } from "../utils/saveManager.js";
import { getAcquirablePokemon } from "../utils/dataLoader.js";
import { logEvent } from "../utils/eventLog.js";
import { generateToken } from "../utils/dashboardAuth.js";
import { publicBaseUrl } from "../utils/publicUrl.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

const COLLECT_MS = 5 * 60 * 1000;

const builder = new SlashCommandBuilder()
  .setName("quest")
  .setDescription("Your Daily board: today's tasks, the chest and the weekly bonus");
// Admin-only until Quests open (re-register commands when the flag flips).
if (!questsEnabled()) builder.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export function questEmbed(v) {
  const lines = v.tasks.map((t) => `${t.claimed ? "✅" : t.done ? "🎉" : "▫️"} **${t.label}**: ${t.progress}/${t.target}${t.claimed ? " (claimed)" : ` · ${t.cc} CC`}`);
  const claimed = v.tasks.filter((t) => t.claimed).length;
  const chest = v.chest.claimed ? "🎁 Chest opened today." : v.chest.ready ? "🎁 The chest is ready." : `🎁 Chest: claim all 3 tasks (${claimed}/3).`;
  const week = v.week.claimed ? "🏆 Weekly bonus claimed." : `🏆 Weekly bonus: ${Math.min(v.week.done, v.week.need)}/${v.week.need} tasks (${v.week.reward}).`;
  return new EmbedBuilder()
    .setColor(0xf5c84c)
    .setTitle("🗺️ Daily board")
    .setDescription([...lines, "", chest, week, "", `New tasks <t:${Math.floor(v.resetsAt / 1000)}:R>.`].join("\n"));
}

export function questButtons(v, nonce, link) {
  const claims = [
    ...v.tasks.filter((t) => t.done && !t.claimed).map((t) => new ButtonBuilder().setCustomId(`quest:${nonce}:task:${t.id}`).setLabel(`Claim ${t.cc} CC`).setStyle(ButtonStyle.Success)),
    ...(v.chest.ready ? [new ButtonBuilder().setCustomId(`quest:${nonce}:chest`).setLabel("Open the chest").setStyle(ButtonStyle.Primary)] : []),
    ...(v.week.ready ? [new ButtonBuilder().setCustomId(`quest:${nonce}:weekly`).setLabel("Throw the Great Ball").setStyle(ButtonStyle.Primary)] : []),
  ].slice(0, 4);
  const row = new ActionRowBuilder().addComponents(...claims, new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Quests").setURL(link));
  return [row];
}

export default {
  data: builder,

  async execute(interaction, trainerData, _a, _b, _c, _d, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!questsEnabled()) return interaction.editReply({ content: "Quests aren't open yet." });

    const userId = interaction.user.id;
    await ensureUserInitialized(userId, interaction.user.username, trainerData, client);
    const handlers = createQuestHandlers({ getTrainerData: () => trainerData, lockUser, save: saveAndAck, loadPool: getAcquirablePokemon, logEvent });
    const link = `${publicBaseUrl()}/auth/dashboard?id=${userId}&code=${generateToken(userId, interaction.channelId)}&page=quests`;
    const nonce = randomUUID().slice(0, 8);

    const current = () => lockUser(userId, async () => {
      const u = trainerData[userId];
      ensureQuests(u, userId);
      return questView(u);
    });
    const show = (v, note = null) => interaction.editReply({ content: note ?? undefined, embeds: [questEmbed(v)], components: questButtons(v, nonce, link) });

    const msg = await show(await current());
    const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === userId && i.customId.startsWith(`quest:${nonce}:`), time: COLLECT_MS });
    collector.on("collect", async (i) => {
      await i.deferUpdate().catch(() => {});
      const what = i.customId.slice(`quest:${nonce}:`.length);
      const { body } = await handlers.claim({ body: { id: userId, what, requestId: `discord-${nonce}-${what.replace(":", "-")}` }, isAuthorized: () => true });
      const p = body.pokemon;
      const note = !body.success ? `⚠️ ${body.error}` : p ? `${p.shiny ? "✨ A shiny " : ""}**${p.name}** joined your Collection!` : `+${body.cc} CC`;
      await show(body.board ?? (await current()), body.saveNotice ? `${note} ${body.saveNotice}` : note).catch(() => {});
    });
    collector.on("end", () => {
      current().then((v) => interaction.editReply({ embeds: [questEmbed(v)], components: questButtons({ ...v, tasks: v.tasks.map((t) => ({ ...t, done: false })), chest: { ...v.chest, ready: false }, week: { ...v.week, ready: false } }, nonce, link) })).catch(() => {});
    });
  },
};
