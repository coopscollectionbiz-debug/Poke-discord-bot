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
import { generateToken } from "../utils/dashboardAuth.js";
import { publicBaseUrl } from "../utils/publicUrl.js";
import { threaded } from "../utils/render/renderers.js";

export const LAYOUT = "refined";
export const COLLECTOR_MS = 10 * 60 * 1000;
const TIER_NAME = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };

/**
 * The Team image: an animated GIF (unless SHOWTEAM_ANIMATED or
 * CARDS_ANIMATED is "0") when a render thread frees up within 2 s, or, with
 * RENDER_THREADS=0, when a slot on the shared card gate is free; otherwise
 * a PNG. A failed GIF falls back to the PNG. `render`, `gate` and `pool`
 * are injectable for tests (cardImage in utils/render/stage.js).
 */
export function renderTeamImage(view, { gate = cardGifGate, pool, env = process.env, render = threaded.showteam } = {}) {
  return cardImage((animate) => render(view, { layout: LAYOUT, animate }), "team", { gate, pool, env, flag: "SHOWTEAM_ANIMATED" });
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
      description: `${s.mega ? "Mega · " : ""}${s.types.join(" / ") || "Unknown type"} · ${TIER_NAME[s.tier] ?? "Common"}${s.slot === 1 ? " · Lead" : ""}`.slice(0, 100),
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
    content: "Change your Showcase team on the dashboard. This link is just for you and expires in **10 minutes**.",
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open dashboard").setURL(url))],
    flags: MessageFlags.Ephemeral,
  };
}

// Three-teams split: /showteam is now an alias of /showcase (the Showcase
// team, which never fights). Kept registered for about two weeks so old
// habits still work; the helpers above stay for /showcase and the tests.
export default {
  data: new SlashCommandBuilder()
    .setName("showteam")
    .setDescription("Old name for /showcase: shows your Showcase team.")
    .addUserOption((o) => o.setName("user").setDescription("See another player's Showcase (only you see it)").setRequired(false)),

  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, _lockUser, _enqueueSave, client) {
    const { runShowcase } = await import("./showcase.js");
    return runShowcase(interaction, trainerData, client);
  },
};
