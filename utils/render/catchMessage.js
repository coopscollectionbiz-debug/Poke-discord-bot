// ==========================================================
// utils/render/catchMessage.js
// The random-catch announcement: a one-line caption plus the catch card
// (utils/render/catchCard.js). Shiny and Rare-or-better catches animate,
// one GIF at a time; everything else, or a catch while a GIF is rendering,
// is a PNG. CATCH_ANIMATED=0 forces PNG. Callers fall back to the old embed
// when this throws.
// ==========================================================

import { AttachmentBuilder, escapeMarkdown } from "discord.js";
import { renderCatchCard, catchView } from "./catchCard.js";
import { createRenderGate } from "./renderGate.js";

const gifGate = createRenderGate(1);
const ANIMATED_TIERS = new Set(["rare", "epic", "legendary", "mythic"]);

/** Shiny and Rare-or-better catches get the animated card. */
export const shouldAnimate = (view) => view.shiny || ANIMATED_TIERS.has(view.tier);

/** { buffer, name } — a GIF when warranted and a slot is free, else a PNG. */
export async function renderCatchImage(view, { gate = gifGate, env = process.env, render = renderCatchCard } = {}) {
  const release = shouldAnimate(view) && env.CATCH_ANIMATED !== "0" ? gate.tryAcquire() : null;
  if (release) {
    try {
      return { buffer: await render(view, { animate: true }), name: "catch.gif" };
    } catch (err) {
      console.warn("⚠️ catch GIF render failed; sending PNG:", err?.message || err);
    } finally {
      release();
    }
  }
  return { buffer: await render(view), name: "catch.png" };
}

const what = (view) => (view.shiny ? `a ✨ shiny **${view.name}**` : `a wild **${view.name}**`);

/** The channel line under which the card is posted; it pings the catcher. */
export const catchCaption = (view, userId) => `🎉 <@${userId}> caught ${what(view)}!`;

/** The broadcast-channel line: the same words, no ping. */
export const broadcastCaption = (view, trainerName) => `**${escapeMarkdown(trainerName)}** caught ${what(view)}!`;

/**
 * Everything the random catch posts. Reads the catcher's record after
 * grantCatch and grantCatch's own result; never mutates either.
 * → { message, broadcast } where message is the channel payload (card, or
 *   the old embed with its old caption if rendering fails) and broadcast is
 *   { image, caption } for broadcastReward, or null to keep its embed.
 */
export async function catchAnnouncement({ user, catcher, pokemonId, shiny, catchResult, fallback, renderImage = renderCatchImage }) {
  const trainerName = catcher.globalName || catcher.username || "A trainer";
  try {
    const view = catchView(user, { id: pokemonId, variant: shiny ? "shiny" : "normal", catchResult, trainerName });
    const image = await renderImage(view);
    return {
      message: { content: catchCaption(view, catcher.id), files: [new AttachmentBuilder(image.buffer, { name: image.name })] },
      broadcast: { image, caption: broadcastCaption(view, trainerName) },
    };
  } catch (err) {
    console.warn("⚠️ catch card failed; sending the embed:", err?.message || err);
    return { message: fallback(), broadcast: null };
  }
}
