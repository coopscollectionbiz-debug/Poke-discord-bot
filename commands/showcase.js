// commands/showcase.js
// ==========================================================
// /showcase: a player's Showcase team (CONTEXT.md "Showcase team") as one
// image, in /showteam's refined grid (layout A, chosen 2026-11-12). No Team
// power, rating or record: the Showcase never fights.
//   • your own /showcase posts publicly
//   • /showcase user:@someone answers privately
// Controls: "Inspect a Pokémon…" (anyone) and "Pick favorites" (owner:
// a private dashboard link). Read-only: the Showcase is edited on the
// dashboard's Teams page. Replaces /showteam (kept as an alias for now).
// ==========================================================

import crypto from "crypto";
import {
  SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
} from "discord.js";

import { ensureUserInitialized } from "../utils/userInitializer.js";
import { cardImage } from "../utils/render/stage.js";
import { buildShowcaseView } from "../utils/render/teamView.js";
import { threaded } from "../utils/render/renderers.js";
import { renderTeamImage, manageReply, COLLECTOR_MS } from "./showteam.js";

const TIER_NAME = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };

/** The select menu + button under the image. */
export function buildShowcaseComponents(view, { nonce, disabled = false, own = true }) {
  const rows = [];
  if (view.slots.length) {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`showcase:${nonce}:inspect`)
      .setPlaceholder("Inspect a Pokémon…")
      .setDisabled(disabled)
      .addOptions(view.slots.map((s) => ({
        label: `${s.slot} · ${s.shiny ? "Shiny " : ""}${s.name} (Lv ${s.level})`.slice(0, 100),
        description: `${s.mega ? "Mega · " : ""}${s.types.join(" / ") || "Unknown type"} · ${TIER_NAME[s.tier] ?? "Common"}`.slice(0, 100),
        value: String(s.slot),
      })))));
  }
  if (own) {
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(`showcase:${nonce}:manage`)
      .setLabel(view.slots.length ? "Change favorites" : "Pick favorites")
      .setStyle(view.slots.length ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(disabled)));
  }
  return rows;
}

/**
 * What a component click should do. Pure, for tests.
 * → { action: "inspect", slot } | { action: "manage" } | { action: "deny", reason } | null (not ours)
 */
export function routeShowcaseInteraction({ customId, userId, values }, { nonce, ownerId, ownerName, slotCount }) {
  const [prefix, n, what] = String(customId ?? "").split(":");
  if (prefix !== "showcase" || n !== nonce) return null;
  if (what === "inspect") {
    const slot = Number(values?.[0]);
    return Number.isInteger(slot) && slot >= 1 && slot <= slotCount ? { action: "inspect", slot } : null;
  }
  if (what === "manage") {
    return userId === ownerId
      ? { action: "manage" }
      : { action: "deny", reason: `This is ${ownerName}'s Showcase. Use /showcase to show yours.` };
  }
  return null;
}

export const data = new SlashCommandBuilder()
  .setName("showcase")
  .setDescription("Show your Showcase team: your favorite Pokémon.")
  .addUserOption((o) => o.setName("user").setDescription("See another player's Showcase (only you see it)").setRequired(false));

export async function runShowcase(interaction, trainerData, client) {
  const target = interaction.options?.getUser?.("user") ?? null;
  const own = !target || target.id === interaction.user.id;
  const ownerId = own ? interaction.user.id : target.id;
  await interaction.deferReply(own ? {} : { flags: MessageFlags.Ephemeral });

  const user = own
    ? await ensureUserInitialized(ownerId, interaction.user.username, trainerData, client)
    : trainerData[ownerId];
  if (!user) return interaction.editReply({ content: `${target.username} hasn't started playing yet.` });

  const member = interaction.guild ? await interaction.guild.members.fetch(ownerId).catch(() => null) : null;
  const displayName = member?.displayName || (own ? interaction.user.username : target.username);

  const view = buildShowcaseView(user, { displayName });
  const image = await renderTeamImage(view);
  const nonce = crypto.randomBytes(6).toString("hex");
  await interaction.editReply({
    files: [new AttachmentBuilder(image.buffer, { name: image.name })],
    components: buildShowcaseComponents(view, { nonce, own }),
  });

  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({ time: COLLECTOR_MS });
  collector.on("collect", async (i) => {
    const r = routeShowcaseInteraction(
      { customId: i.customId, userId: i.user.id, values: i.values },
      { nonce, ownerId, ownerName: displayName, slotCount: view.slots.length },
    );
    if (!r) return;
    try {
      if (r.action === "deny") return await i.reply({ content: r.reason, flags: MessageFlags.Ephemeral });
      if (r.action === "manage") return await i.reply(manageReply(ownerId, i.channelId));
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const slot = view.slots[r.slot - 1];
      const card = await cardImage((animate) => threaded.inspect(slot, { owner: displayName, animate }), "pokemon", { unique: true });
      await i.editReply({ files: [new AttachmentBuilder(card.buffer, { name: card.name })] });
    } catch (err) {
      console.warn("⚠️ /showcase component failed:", err?.message || err);
      const msg = { content: "Something went wrong. Please try again.", flags: MessageFlags.Ephemeral };
      await (i.deferred || i.replied ? i.editReply({ content: msg.content }) : i.reply(msg)).catch(() => {});
    }
  });
  collector.on("end", async () => {
    await interaction.editReply({ components: buildShowcaseComponents(view, { nonce, own, disabled: true }) }).catch(() => {});
  });
}

export default {
  data,
  async execute(interaction, trainerData, _saveLocal, _saveDiscord, _lockUser, _enqueueSave, client) {
    return runShowcase(interaction, trainerData, client);
  },
};
