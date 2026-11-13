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
import { createExpeditionHandlers } from "../services/expeditionsApi.js";
import { ensureExpeditions, expeditionView, expeditionsEnabled } from "../services/expeditions.js";
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

export function questEmbed(v, exp = null) {
  const lines = v.tasks.map((t) => `${t.claimed ? "✅" : t.done ? "🎉" : "▫️"} **${t.label}**: ${t.progress}/${t.target}${t.claimed ? " (claimed)" : ` · ${t.cc} CC`}`);
  const claimed = v.tasks.filter((t) => t.claimed).length;
  const chest = v.chest.claimed ? "🎁 Chest opened today." : v.chest.ready ? "🎁 The chest is ready." : `🎁 Chest: claim all 3 tasks (${claimed}/3).`;
  const week = v.week.claimed ? "🏆 Weekly bonus claimed." : `🏆 Weekly bonus: ${Math.min(v.week.done, v.week.need)}/${v.week.need} tasks (${v.week.reward}).`;
  const embed = new EmbedBuilder()
    .setColor(0xf5c84c)
    .setTitle("🗺️ Daily board")
    .setDescription([...lines, "", chest, week, "", `New tasks <t:${Math.floor(v.resetsAt / 1000)}:R>.`].join("\n"));
  if (exp) {
    const runs = exp.running.map((r) => `${r.done ? "🏁" : "🧭"} **${r.mission.name}** (${r.party.map((p) => p.name).join(", ")}): ${r.done ? "back, ready to claim" : `returns <t:${Math.floor(r.endsAt / 1000)}:R>`}`);
    const free = exp.enabled ? exp.slots.max - exp.slots.used : 0;
    if (free > 0) runs.push(`${free} free slot${free > 1 ? "s" : ""}. Send a party from the Quests page.`);
    embed.addFields({ name: "Expeditions", value: runs.join("\n") || "None running." });
  }
  return embed;
}

export function questButtons(v, nonce, link, exp = null) {
  const claims = [
    ...v.tasks.filter((t) => t.done && !t.claimed).map((t) => new ButtonBuilder().setCustomId(`quest:${nonce}:task:${t.id}`).setLabel(`Claim ${t.cc} CC`).setStyle(ButtonStyle.Success)),
    ...(v.chest.ready ? [new ButtonBuilder().setCustomId(`quest:${nonce}:chest`).setLabel("Open the chest").setStyle(ButtonStyle.Primary)] : []),
    ...(v.week.ready ? [new ButtonBuilder().setCustomId(`quest:${nonce}:weekly`).setLabel("Throw the Great Ball").setStyle(ButtonStyle.Primary)] : []),
  ].slice(0, 4);
  const rows = [new ActionRowBuilder().addComponents(...claims, new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Quests").setURL(link))];
  const back = (exp?.running ?? []).filter((r) => r.done).slice(0, 5)
    .map((r) => new ButtonBuilder().setCustomId(`quest:${nonce}:exp:${r.id}`).setLabel(`Bring back: ${r.mission.name}`.slice(0, 80)).setStyle(ButtonStyle.Success));
  if (back.length) rows.push(new ActionRowBuilder().addComponents(...back));
  return rows;
}

function expeditionNote(b) {
  if (!b.success) return `⚠️ ${b.error}`;
  const bits = [`+${b.cc} CC`];
  if (b.items?.evolution_stone) bits.push(`+${b.items.evolution_stone} Evolution Stone`);
  if (b.items?.shiny_dust) bits.push(`+${b.items.shiny_dust} Shiny Dust`);
  for (const p of b.pokemon ?? []) bits.push(`${p.shiny ? "✨ " : ""}${p.name}`);
  if (b.tms?.length) bits.push(`+${b.tms.length} TM`);
  const head = b.expedition.success ? `🏁 **${b.expedition.mission.name}**: success!` : `🏁 **${b.expedition.mission.name}**: the party came back empty-handed.`;
  return `${head} ${bits.join(" · ")}. EXP: ${(b.exp ?? []).map((e) => `${e.name} +${e.gained}`).join(", ")}`;
}

export default {
  data: builder,

  async execute(interaction, trainerData, _a, _b, _c, _d, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!questsEnabled()) return interaction.editReply({ content: "Quests aren't open yet." });

    const userId = interaction.user.id;
    await ensureUserInitialized(userId, interaction.user.username, trainerData, client);
    const deps = { getTrainerData: () => trainerData, lockUser, save: saveAndAck, loadPool: getAcquirablePokemon, logEvent };
    const handlers = createQuestHandlers(deps);
    const expHandlers = createExpeditionHandlers(deps);
    const link = `${publicBaseUrl()}/auth/dashboard?id=${userId}&code=${generateToken(userId, interaction.channelId)}&page=quests`;
    const nonce = randomUUID().slice(0, 8);

    const current = () => lockUser(userId, async () => {
      const u = trainerData[userId];
      ensureQuests(u, userId);
      const board = questView(u);
      // Expeditions show while they're open, or while one is still out.
      const exp = expeditionsEnabled() || u.expeditions?.running?.length ? (ensureExpeditions(u), expeditionView(u)) : null;
      return { board, exp };
    });
    const show = ({ board, exp }, note = null, live = true) => interaction.editReply({
      content: note ?? undefined,
      embeds: [questEmbed(board, exp)],
      components: live ? questButtons(board, nonce, link, exp) : [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Quests").setURL(link))],
    });

    const msg = await show(await current());
    const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === userId && i.customId.startsWith(`quest:${nonce}:`), time: COLLECT_MS });
    collector.on("collect", async (i) => {
      await i.deferUpdate().catch(() => {});
      const what = i.customId.slice(`quest:${nonce}:`.length);
      const requestId = `discord-${nonce}-${what.replace(/:/g, "-")}`.slice(0, 64);
      let note;
      if (what.startsWith("exp:")) {
        const { body } = await expHandlers.claim({ body: { id: userId, expedition: what.slice(4), requestId }, isAuthorized: () => true });
        note = expeditionNote(body);
        if (body.saveNotice) note += ` ${body.saveNotice}`;
      } else {
        const { body } = await handlers.claim({ body: { id: userId, what, requestId }, isAuthorized: () => true });
        const p = body.pokemon;
        note = !body.success ? `⚠️ ${body.error}` : p ? `${p.shiny ? "✨ A shiny " : ""}**${p.name}** joined your Collection!` : `+${body.cc} CC`;
        if (body.saveNotice) note += ` ${body.saveNotice}`;
      }
      await show(await current(), note.slice(0, 1900)).catch(() => {});
    });
    collector.on("end", () => {
      current().then((v) => show(v, null, false)).catch(() => {});
    });
  },
};
