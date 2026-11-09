// ==========================================================
// /inventory — view your bag (Release B, read-only)
//
// Ephemeral. Browse by category, 10 items per page. Nothing here changes
// player data: no use/equip controls until those features are released.
// Every component carries a per-message nonce and only the player who ran
// the command can press it.
// ==========================================================

import crypto from "crypto";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  MessageFlags,
} from "discord.js";
import { listInventory } from "../services/inventory.js";
import { CATEGORIES } from "../catalog/items.js";
import { rarityEmojis } from "../spriteconfig.js";
import { safeReply } from "../utils/safeReply.js";

export const INVENTORY_PAGE_SIZE = 10;
const ALL = "all";
const COLOR = 0x5865f2;

const categoryChoices = Object.entries(CATEGORIES)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([value, c]) => ({ name: c.label, value }));

/** Parse "inv:<nonce>:<action>" (anything else → null). */
export function parseInventoryCustomId(customId) {
  const m = /^inv:([a-f0-9]{8,32}):(cat|prev|next)$/.exec(String(customId || ""));
  return m ? { nonce: m[1], action: m[2] } : null;
}

const isCategory = (c) => typeof c === "string" && Object.prototype.hasOwnProperty.call(CATEGORIES, c);

const clampPage = (page, pages) => Math.max(0, Math.min(Number.isInteger(page) ? page : 0, Math.max(0, pages - 1)));

/**
 * Pure view builder (tested without Discord).
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[], page: number, pages: number, total: number }}
 */
export function buildInventoryView(user, { category = ALL, page = 0, nonce, disabled = false } = {}) {
  const cat = category !== ALL && isCategory(category) ? category : ALL;
  const rows = listInventory(user, { category: cat === ALL ? null : cat });
  const pages = Math.max(1, Math.ceil(rows.length / INVENTORY_PAGE_SIZE));
  const p = clampPage(page, pages);
  const slice = rows.slice(p * INVENTORY_PAGE_SIZE, (p + 1) * INVENTORY_PAGE_SIZE);
  const catLabel = cat === ALL ? "All items" : `${CATEGORIES[cat].emoji} ${CATEGORIES[cat].label}`;

  const lines = slice.map((r) => {
    const emoji = CATEGORIES[r.category]?.emoji ?? "📦";
    const rarity = rarityEmojis?.[r.rarity] ?? "";
    const tag = !r.known ? " · *legacy item*" : r.status !== "active" ? " · *not usable yet*" : "";
    return `${emoji} **${r.name}** ×${r.quantity.toLocaleString()} ${rarity}${tag}\n> ${r.description}\n> _${r.usage}_`;
  });

  const description = rows.length
    ? lines.join("\n\n")
    : cat === ALL
      ? "Your bag is empty. Evolution Stones come from `/daily`, and Shiny Dust from donating Pokémon on the dashboard."
      : `You have no ${CATEGORIES[cat].label.toLowerCase()}.`;

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("🎒 Your Bag")
    .setDescription(description.slice(0, 4000))
    .setFooter({ text: `${catLabel} · Page ${p + 1}/${pages} · ${rows.length} item type${rows.length === 1 ? "" : "s"}` });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`inv:${nonce}:cat`)
    .setPlaceholder("Filter by category")
    .setDisabled(disabled)
    .addOptions(
      [{ label: "All items", value: ALL, emoji: "🎒", default: cat === ALL }].concat(
        categoryChoices.map((c) => ({ label: c.name, value: c.value, emoji: CATEGORIES[c.value].emoji, default: cat === c.value }))
      )
    );
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`inv:${nonce}:prev`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary).setDisabled(disabled || p === 0),
    new ButtonBuilder().setCustomId(`inv:${nonce}:next`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(disabled || p >= pages - 1)
  );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select), nav],
    page: p,
    pages,
    total: rows.length,
    category: cat,
  };
}

/**
 * Decide what a component press does. Pure: (state, interaction-ish) → result.
 * @returns {{ allowed:false, reason:string } | { allowed:true, state:{category,page} }}
 */
export function reduceInventoryInteraction(state, { userId, customId, values }, { ownerId, nonce }) {
  if (String(userId) !== String(ownerId)) return { allowed: false, reason: "This bag isn't yours. Use `/inventory` to see your own." };
  const parsed = parseInventoryCustomId(customId);
  if (!parsed || parsed.nonce !== nonce) return { allowed: false, reason: "That control is no longer valid. Run `/inventory` again." };
  if (parsed.action === "cat") {
    const v = Array.isArray(values) ? values[0] : null;
    if (v !== ALL && !isCategory(v)) return { allowed: false, reason: "Unknown category." };
    return { allowed: true, state: { category: v, page: 0 } };
  }
  return { allowed: true, state: { category: state.category, page: state.page + (parsed.action === "next" ? 1 : -1) } };
}

export default {
  data: new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("View your bag: items, quantities and what they're for.")
    .addStringOption((o) =>
      o.setName("category").setDescription("Show one category").setRequired(false).addChoices(...categoryChoices)
    ),

  async execute(interaction, trainerData) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ownerId = interaction.user.id;

    // Read-only: never create a record just to look at the bag.
    const user = trainerData[ownerId];
    if (!user) {
      return safeReply(interaction, {
        content: "You don't have a trainer profile yet. Use `/trainercard` to get started.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const nonce = crypto.randomBytes(6).toString("hex");
    let state = { category: interaction.options.getString("category") || ALL, page: 0 };
    const render = (disabled = false) => buildInventoryView(trainerData[ownerId] ?? user, { ...state, nonce, disabled });

    const first = render();
    state = { category: first.category, page: first.page };
    await interaction.editReply({ embeds: first.embeds, components: first.components });
    const message = await interaction.fetchReply();

    const collector = message.createMessageComponentCollector({ time: 120_000 });
    collector.on("collect", async (i) => {
      const r = reduceInventoryInteraction(state, { userId: i.user.id, customId: i.customId, values: i.values }, { ownerId, nonce });
      if (!r.allowed) {
        return i.reply({ content: r.reason, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      const view = buildInventoryView(trainerData[ownerId] ?? user, { ...r.state, nonce });
      state = { category: view.category, page: view.page };
      await i.update({ embeds: view.embeds, components: view.components }).catch(() => {});
    });
    collector.on("end", async () => {
      const done = render(true);
      await interaction.editReply({ embeds: done.embeds, components: done.components }).catch(() => {});
    });
  },
};

// Keep the component type import referenced for readers: only buttons and
// string selects are created above.
export const INVENTORY_COMPONENT_TYPES = [ComponentType.Button, ComponentType.StringSelect];
