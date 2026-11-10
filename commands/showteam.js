// commands/showteam.js
// ==========================================================
// /showteam — the player's battle Team as one image (the approved refined
// A/B layout, utils/render/showteamRefined.js), with two controls:
//   • "Inspect a Team member…" (anyone): an ephemeral single-Pokémon card
//   • "Manage Team" (owner only): an ephemeral dashboard link
// Read-only: nothing here writes the Team or any other player data. Team
// changes stay on the dashboard's POST /api/set-pokemon-team.
// ==========================================================

import crypto from "crypto";
import {
  SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
} from "discord.js";

import { ensureUserInitialized } from "../utils/userInitializer.js";
import { cardImage, cardGifGate } from "../utils/render/stage.js";
import { buildTeamView } from "../utils/render/teamView.js";
import { renderShowteam } from "../utils/render/showteam.js";
import { renderInspectCard } from "../utils/render/inspectCard.js";
import { generateToken } from "../utils/dashboardAuth.js";
import { publicBaseUrl } from "../utils/publicUrl.js";

export const LAYOUT = "refined";
export const COLLECTOR_MS = 10 * 60 * 1000;
const TIER_NAME = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };

/**
 * The Team image: an animated GIF when a slot on the shared card gate is
 * free (and neither SHOWTEAM_ANIMATED nor CARDS_ANIMATED is "0"), otherwise
 * a PNG. A failed GIF falls back to the PNG. `render` is injectable for tests.
 */
export function renderTeamImage(view, { gate = cardGifGate, env = process.env, render = renderShowteam } = {}) {
  return cardImage((animate) => render(view, { layout: LAYOUT, animate }), "team", { gate, env, flag: "SHOWTEAM_ANIMATED" });
}

/** The select menu + button under the image (none for an empty Team). */
export function buildShowteamComponents(view, { nonce, disabled = false }) {
  if (!view.slots.length) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`showteam:${nonce}:inspect`)
    .setPlaceholder("Inspect a Team member…")
    .setDisabled(disabled)
    .addOptions(view.slots.map((s) => ({
      label: `${s.slot} · ${s.shiny ? "Shiny " : ""}${s.name} (Lv ${s.level})`.slice(0, 100),
      description: `${s.types.join(" / ") || "Unknown type"} · ${TIER_NAME[s.tier] ?? "Common"}${s.slot === 1 ? " · Lead" : ""}`.slice(0, 100),
      value: String(s.slot),
    })));
  const manage = new ButtonBuilder()
    .setCustomId(`showteam:${nonce}:manage`)
    .setLabel("Manage Team")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);
  return [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(manage)];
}

/**
 * What a component click should do. Pure, for tests.
 * → { action: "inspect", slot } | { action: "manage" } | { action: "deny", reason } | null (not ours)
 */
export function routeShowteamInteraction({ customId, userId, values }, { nonce, ownerId, ownerName, slotCount }) {
  const [prefix, n, what] = String(customId ?? "").split(":");
  if (prefix !== "showteam" || n !== nonce) return null;
  if (what === "inspect") {
    const slot = Number(values?.[0]);
    return Number.isInteger(slot) && slot >= 1 && slot <= slotCount ? { action: "inspect", slot } : null;
  }
  if (what === "manage") {
    return userId === ownerId
      ? { action: "manage" }
      : { action: "deny", reason: `This is ${ownerName}'s Team. Use /showteam to show yours, or /dashboard to manage it.` };
  }
  return null;
}

/** The owner's one-time dashboard link (same token flow as /dashboard). */
export function manageReply(ownerId, channelId) {
  const token = generateToken(ownerId, channelId);
  const url = `${publicBaseUrl()}/auth/dashboard?id=${encodeURIComponent(ownerId)}&code=${token}`;
  return {
    content: "Change your Team on the dashboard. This link is just for you and expires in **10 minutes**.",
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open dashboard").setURL(url))],
    flags: MessageFlags.Ephemeral,
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName("showteam")
    .setDescription("Show your trainer + full team as a canvas card."),

  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, _lockUser, _enqueueSave, client) {
    await interaction.deferReply(); // public, as before

    const ownerId = interaction.user.id;
    const user = await ensureUserInitialized(ownerId, interaction.user.username, trainerData, client);

    const member = interaction.guild
      ? await interaction.guild.members.fetch(ownerId).catch(() => null)
      : null;
    const displayName = member?.displayName || interaction.user.username;

    const view = buildTeamView(user, { displayName });
    const image = await renderTeamImage(view);
    const nonce = crypto.randomBytes(6).toString("hex");

    await interaction.editReply({
      files: [new AttachmentBuilder(image.buffer, { name: image.name })],
      components: buildShowteamComponents(view, { nonce }),
    });
    if (!view.slots.length) return;

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: COLLECTOR_MS });
    collector.on("collect", async (i) => {
      const r = routeShowteamInteraction(
        { customId: i.customId, userId: i.user.id, values: i.values },
        { nonce, ownerId, ownerName: displayName, slotCount: view.slots.length },
      );
      if (!r) return;
      try {
        if (r.action === "deny") return await i.reply({ content: r.reason, flags: MessageFlags.Ephemeral });
        if (r.action === "manage") return await i.reply(manageReply(ownerId, i.channelId));
        // Inspect: the slot exactly as shown in this image.
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const slot = view.slots[r.slot - 1];
        const card = await cardImage((animate) => renderInspectCard(slot, { owner: displayName, animate }), "pokemon");
        await i.editReply({ files: [new AttachmentBuilder(card.buffer, { name: card.name })] });
      } catch (err) {
        console.warn("⚠️ /showteam component failed:", err?.message || err);
        const msg = { content: "Something went wrong. Please try again.", flags: MessageFlags.Ephemeral };
        await (i.deferred || i.replied ? i.editReply({ content: msg.content }) : i.reply(msg)).catch(() => {});
      }
    });
    collector.on("end", async () => {
      await interaction.editReply({ components: buildShowteamComponents(view, { nonce, disabled: true }) }).catch(() => {});
    });
  },
};
