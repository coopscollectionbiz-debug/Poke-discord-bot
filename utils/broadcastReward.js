// ==========================================================
// broadcastReward.js – Trainer & Pokémon broadcast system
// ==========================================================
import { EmbedBuilder } from "discord.js";
import fs from "fs";
import { spritePaths, rarityEmojis } from "../spriteconfig.js";

const lastBroadcast = new Map();
let trainerSpritesCache = null;

// ==========================================================
// 🔹 Lazy-load trainerSprites.json (only once per session)
// ==========================================================
function getTrainerSprites() {
  if (trainerSpritesCache) return trainerSpritesCache;
  try {
    const json = fs.readFileSync("./public/sprites/trainers_2/trainerSprites.json", "utf8");
    trainerSpritesCache = JSON.parse(json);
    console.log("📦 Trainer sprite data loaded for broadcasts.");
  } catch (err) {
    console.error("❌ Failed to load trainerSprites.json:", err.message);
    trainerSpritesCache = {};
  }
  return trainerSpritesCache;
}

// ==========================================================
// 🎉 broadcastReward()
// ==========================================================
export async function broadcastReward(
  client,
  { user, type, item, shiny = false, source = "random", channelId = null }
) {
  try {
    // 🧭 Anti-spam safeguard (5s)
    const last = lastBroadcast.get(user.id);
    if (last && Date.now() - last < 5000) return;
    lastBroadcast.set(user.id, Date.now());

    const broadcastChannelId =
      channelId || process.env.REWARD_CHANNEL_ID || "YOUR_DEFAULT_CHANNEL_ID";
    const channel = await client.channels.fetch(broadcastChannelId).catch(() => null);
    if (!channel) return;

    const rarity = (item.rarity || item.tier || "common").toLowerCase();
    const emoji = rarityEmojis?.[rarity] || "⚬";

    const title =
      type === "pokemon"
        ? shiny
          ? `${emoji} ✨ Shiny ${item.name} appeared!`
          : `${emoji} ${item.name} appeared!`
        : `${emoji} ${item.name} joined the adventure!`;

    // ======================================================
    // 🖼️ Sprite Resolution
    // ======================================================
    let spriteUrl;

    if (type === "pokemon") {
      spriteUrl = shiny
        ? `${spritePaths.shiny}${item.id}.gif`
        : `${spritePaths.pokemon}${item.id}.gif`;
    } else {
      const sprites = getTrainerSprites();
      const entry = sprites[item.id];
      const spriteFile = entry?.sprites?.[0] || `${item.id}.png`; // fallback
      spriteUrl = `${spritePaths.trainers}${spriteFile}`;
    }

    // ======================================================
    // 🧱 Embed Construction
    // ======================================================
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(
        [
          `🎉 **${user.username}** just obtained ${shiny ? "a ✨ **Shiny** " : "a **"}${item.name}**!`,
          `🔹 **Rarity:** ${emoji} ${rarity.toUpperCase()}`,
          type === "pokemon"
            ? "🌿 *A wild Pokémon appeared in the tall grass!*"
            : "🏫 *A new ally joins the adventure!*",
        ].join("\n")
      )
      .setColor(shiny ? 0xffd700 : 0x43b581)
      .setThumbnail(spriteUrl)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("❌ broadcastReward failed:", err);
  }
}
