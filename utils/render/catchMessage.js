// ==========================================================
// utils/render/catchMessage.js
// The catch announcement: a one-line caption plus the catch card
// (utils/render/catchCard.js). Every catch animates when its sprite does and
// a GIF slot is free (the shared card gate, utils/render/stage.js);
// otherwise it's a PNG. CATCH_ANIMATED=0 or CARDS_ANIMATED=0 forces PNG.
// Callers fall back to the old embed when this throws.
// ==========================================================

import { AttachmentBuilder, escapeMarkdown } from "discord.js";
import { catchView } from "./catchCard.js";
import { cardImage, cardGifGate } from "./stage.js";
import { threaded } from "./renderers.js";

/** { buffer, name } — the animated card when a slot is free, else a PNG. */
export function renderCatchImage(view, { gate = cardGifGate, pool, env = process.env, render = threaded.catch } = {}) {
  return cardImage((animate) => render(view, { animate }), "catch", { gate, pool, env, flag: "CATCH_ANIMATED" });
}

const what = (view) => (view.shiny ? `a ✨ shiny **${view.name}**` : view.sighting ? `**${view.name}**` : `a wild **${view.name}**`);

/** The channel line under which the card is posted; it pings the catcher. */
export const catchCaption = (view, userId) => `🎉 <@${userId}> caught ${what(view)}!`;

/** The Live event tag on a catch a Catch boost or limit shaped: " · 🎪 Kanto week". */
export const eventTag = (names) => (Array.isArray(names) && names.length ? ` · 🎪 ${names.join(" + ")}` : "");

/** The broadcast-channel line: the same words, no ping. */
export const broadcastCaption = (view, trainerName) => `**${escapeMarkdown(trainerName)}** caught ${what(view)}!`;

/**
 * Everything the random catch posts. Reads the catcher's record after
 * grantCatch and grantCatch's own result; never mutates either.
 * → { message, broadcast } where message is the channel payload (card, or
 *   the old embed with its old caption if rendering fails) and broadcast is
 *   { image, caption } for broadcastReward, or null to keep its embed.
 */
export async function catchAnnouncement({ user, catcher, pokemonId, shiny, catchResult, fallback, renderImage = renderCatchImage, eventNames = [] }) {
  const tag = eventTag(eventNames);
  const trainerName = catcher.globalName || catcher.username || "A trainer";
  try {
    const view = catchView(user, { id: pokemonId, variant: shiny ? "shiny" : "normal", catchResult, trainerName });
    const image = await renderImage(view);
    return {
      message: { content: catchCaption(view, catcher.id) + tag, files: [new AttachmentBuilder(image.buffer, { name: image.name })] },
      broadcast: { image, caption: broadcastCaption(view, trainerName) },
    };
  } catch (err) {
    console.warn("⚠️ catch card failed; sending the embed:", err?.message || err);
    const message = fallback();
    if (tag && typeof message?.content === "string") message.content += tag;
    return { message, broadcast: null };
  }
}
