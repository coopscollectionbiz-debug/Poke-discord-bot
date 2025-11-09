// ==========================================================
// broadcastReward.js — Multi-Tier Broadcast System
// ==========================================================
import { EmbedBuilder } from "discord.js";
import { spritePaths, rarityEmojis } from "../spriteconfig.js";

const lastBroadcast = new Map();

// ==========================================================
// 🎉 broadcastReward()
// ==========================================================
export async function broadcastReward(
  client,
  {
    user,
    type,              // "pokemon" or "trainer"
    item,              // object with { id, name, rarity/tier, spriteFile/filename }
    shiny = false,
    source = "random",
    originChannel = null, // message.channel or interaction.channel
  }
) {
  try {
    // 🧭 Anti-spam (5 s per user)
    const last = lastBroadcast.get(user.id);
    if (last && Date.now() - last < 5000) return;
    lastBroadcast.set(user.id, Date.now());

    // ======================================================
    // ⚙️ Channel resolution
    // ======================================================
    const GLOBAL_CHANNEL_ID = process.env.REWARD_CHANNEL_ID;
    const RARE_CHANNEL_ID   = process.env.RARE_SIGHTINGS_CHANNEL_ID;
    const localChannel      = originChannel || null;

    const globalChannel = await safeFetchChannel(client, GLOBAL_CHANNEL_ID);
    const rareChannel   = await safeFetchChannel(client, RARE_CHANNEL_ID);

    // ======================================================
    // 🧩 Rarity classification (Fixed)
    // ======================================================
    const rarity = (item.rarity || item.tier || "common").toString().toLowerCase();
    const emoji  = rarityEmojis?.[rarity] || "⚬";
    const rarityDisplay = `${emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)}`;
    const isRareTier = ["rare", "epic", "legendary", "mythic"].includes(rarity);

    // ======================================================
    // 🖼️ Sprite resolution
    // ======================================================
    let spriteUrl = "";
    let displayName = "";

    if (type === "pokemon") {
      displayName = shiny ? `✨ Shiny ${item.name}` : item.name;
      spriteUrl = shiny
        ? `${spritePaths.shiny}${item.id}.gif`
        : `${spritePaths.pokemon}${item.id}.gif`;
    } else {
      // ✅ Normalize trainer filename and display name
      const baseId = String(item.id || "")
        .replace(/^trainers?_2\//, "")
        .replace(/\.png$/i, "")
        .trim()
        .toLowerCase();

      const cleanFile = (item.spriteFile || item.filename || `${baseId}.png`)
        .replace(/^trainers?_2\//, "")
        .replace(/\s+/g, "")
        .replace(/\.png\.png$/i, ".png") // double extension safety
        .toLowerCase();

     // 🧼 Clean up any generic or numeric trainer names
if (
  item.name &&
  !/^trainer\s*\d+/i.test(item.name) &&
  !item.name.toLowerCase().startsWith("trainer ")
) {
  displayName = item.name;
} else {
  displayName = baseId
    .replace(/^trainers?_2\//, "")
    .replace(/\.png$/i, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}


      spriteUrl = `${spritePaths.trainers}${cleanFile}`;
    }

    // ======================================================
    // 🧱 Embed builder
    // ======================================================
    const title =
      type === "pokemon"
        ? shiny
          ? `${emoji} ✨ Shiny Pokémon Discovered!`
          : `${emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)} Pokémon Found!`
        : `${emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)} Trainer Recruited!`;

    const description =
      type === "pokemon"
        ? `**${user.username}** caught **${displayName}**!\n${rarityDisplay}\n🌿 *A wild Pokémon appeared in the tall grass!*`
        : `**${user.username}** recruited **${displayName}**!\n${rarityDisplay}\n🏫 *A new ally joins the adventure!*`;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(shiny ? 0xffd700 : type === "trainer" ? 0x5865f2 : 0x43b581)
      .setThumbnail(spriteUrl)
      .setFooter({ text: "🌟 Coop’s Collection Broadcast" })
      .setTimestamp();

    // ======================================================
    // 📡 Broadcast routing
    // ======================================================
    if (globalChannel) await globalChannel.send({ embeds: [embed] }).catch(() => {});
    if (rareChannel && (isRareTier || shiny))
      await rareChannel.send({ embeds: [embed] }).catch(() => {});
    if (
      localChannel &&
      localChannel.id !== globalChannel?.id &&
      localChannel.id !== rareChannel?.id
    )
      await localChannel.send({ embeds: [embed] }).catch(() => {});

    console.log(
      `📢 Broadcasted ${type} (${displayName}) [${rarity}${shiny ? "✨" : ""}] for ${user.username}`
    );
  } catch (err) {
    console.error("❌ broadcastReward failed:", err.message);
  }
}

// ==========================================================
// 🛡️ Helper
// ==========================================================
async function safeFetchChannel(client, id) {
  if (!id) return null;
  try {
    return await client.channels.fetch(id);
  } catch {
    return null;
  }
}
