// ==========================================================
// broadcastReward.js – Public reward announcement system (with rarity emojis)
// ==========================================================
import { EmbedBuilder } from "discord.js";
import { spritePaths, rarityEmojis } from "../spriteconfig.js";

const lastBroadcast = new Map();

/**
 * Broadcasts a public announcement when someone randomly acquires a Pokémon or Trainer.
 * @param {object} client - Discord client
 * @param {object} options
 * @param {object} options.user - Discord User object
 * @param {string} options.type - "pokemon" or "trainer"
 * @param {object} options.item - Pokémon or Trainer object
 * @param {boolean} [options.shiny=false] - Whether it’s shiny
 * @param {string} [options.source="random"] - "random", "reaction", etc.
 * @param {string|null} [options.channelId=null] - Override broadcast channel
 */
export async function broadcastReward(
  client,
  { user, type, item, shiny = false, source = "random", channelId = null }
) {
  try {
    // 🧭 5-second anti-spam cooldown per user
    const last = lastBroadcast.get(user.id);
    if (last && Date.now() - last < 5000) return;
    lastBroadcast.set(user.id, Date.now());

    const broadcastChannelId =
      channelId || process.env.REWARD_CHANNEL_ID || "YOUR_DEFAULT_CHANNEL_ID";
    const channel = await client.channels.fetch(broadcastChannelId).catch(() => null);
    if (!channel) return;

    // 🧩 Pull rarity + emoji
    const rarity = item.rarity?.toLowerCase() || "common";
    const emoji = rarityEmojis?.[rarity] || "⚪";
    const rarityLabel = `${emoji} ${rarity.toUpperCase()}`;

    // 🪩 Title logic
    const title =
      type === "pokemon"
        ? shiny
          ? `${emoji} ✨ Shiny ${item.name} appeared!`
          : `${emoji} ${item.name} appeared!`
        : `${emoji} ${item.name} joined the adventure!`;

    // 🖼️ Image selection
    const thumbnail =
      type === "pokemon"
        ? shiny
          ? `${spritePaths.shiny}${item.id}.gif`
          : `${spritePaths.pokemon}${item.id}.gif`
        : `${spritePaths.trainers}${item.filename || item.sprite || item.file}`;

    // 🧱 Embed build
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(
        [
          `🎉 **${user.username}** just obtained ${shiny ? "a ✨ **Shiny** " : "a **"}${item.name}**!`,
          `🔹 **Rarity:** ${rarityLabel}`,
          type === "pokemon"
            ? "🌿 *A wild Pokémon appeared in the tall grass!*"
            : "🏫 *A new ally joins the adventure!*",
        ].join("\n")
      )
      .setColor(shiny ? 0xffd700 : 0x43b581)
      .setThumbnail(thumbnail)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("❌ broadcastReward failed:", err);
  }
}
