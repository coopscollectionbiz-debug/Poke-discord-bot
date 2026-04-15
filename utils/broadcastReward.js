// ==========================================================
// 🎉 Coop's Collection — broadcastReward.js (v6.6)
// ==========================================================
//  • Multi-Tier Broadcast System
//  • Bypass cooldown for trusted sources (Starter Pack, Admin Grant)
//  • Clear channel fetch warnings
//  • Unified sprite resolution + clean embed handling
// ==========================================================

import { EmbedBuilder } from "discord.js";
import { spritePaths, rarityEmojis } from "../spriteconfig.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const trainerSprites = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../trainerSprites.json"), "utf8")
);

const lastBroadcast = new Map();

// ==========================================================
// 🎯 broadcastReward()
// ==========================================================
export async function broadcastReward(
  client,
  {
    user,
    type,              // "pokemon" or "trainer"
    item,              // { id, name, rarity/tier, spriteFile/filename }
    shiny = false,
    source = "random", // e.g. "Starter Pack", "Daily", "Admin Grant"
    originChannel = null,
  }
) {
  try {
    // ======================================================
    // 🧭 Anti-spam (5s cooldown) — bypass trusted sources
    // ======================================================
    const isBypassSource =
      ["starter pack", "starter_pack", "admin grant", "admin", "manual"].includes(
        source.toLowerCase?.() || ""
      );

    const last = lastBroadcast.get(user.id);
    if (!isBypassSource) {
      if (last && Date.now() - last < 5000) return;
      lastBroadcast.set(user.id, Date.now());
    }

    // ======================================================
    // ⚙️ Channel resolution
    // ======================================================
    const GLOBAL_CHANNEL_ID = process.env.REWARD_CHANNEL_ID;
    const RARE_CHANNEL_ID = process.env.RARE_SIGHTINGS_CHANNEL_ID;
    const localChannel = originChannel || null;

    const globalChannel = await safeFetchChannel(client, GLOBAL_CHANNEL_ID);
    const rareChannel = await safeFetchChannel(client, RARE_CHANNEL_ID);

    if (!globalChannel)
      console.warn("⚠️ [broadcastReward] Missing REWARD_CHANNEL_ID or invalid permissions.");
    if (!rareChannel)
      console.warn("⚠️ [broadcastReward] Missing RARE_SIGHTINGS_CHANNEL_ID or invalid permissions.");

    // ======================================================
    // 🧩 Rarity classification
    // ======================================================
    const rarity = (item.rarity || item.tier || "common").toString().toLowerCase();
    const emoji = rarityEmojis?.[rarity] || "⚬";
    const rarityDisplay = `${emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)}`;
    const isRareTier = ["rare", "epic", "legendary", "mythic"].includes(rarity);

    // ======================================================
    // 🎨 Color map — matched to CSS theme
    // ======================================================
    const rarityColors = {
      common: 0x9ca3af,
      uncommon: 0x10b981,
      rare: 0x3b82f6,
      epic: 0xa855f7,
      legendary: 0xfacc15,
      mythic: 0xef4444,
    };

    // ======================================================
    // 🖼️ Sprite resolution + readable name
    // ======================================================
    let spriteUrl = "";
    let displayName = "";

    if (type === "pokemon") {
      // 🟢 Pokémon
      displayName = shiny ? `✨ Shiny ${item.name}` : item.name;
      spriteUrl = shiny
        ? `${spritePaths.shiny}${item.id}.gif`
        : `${spritePaths.pokemon}${item.id}.gif`;
    } else {
      // 🔵 Trainer
      const base = spritePaths.trainers.endsWith("/")
        ? spritePaths.trainers
        : spritePaths.trainers + "/";

      let spriteFile =
        item.spriteFile ||
        item.filename ||
        item.sprites?.[0] ||
        (trainerSprites[item.id]?.sprites?.[0]) ||
        `${item.id}.png`;

      spriteFile = String(spriteFile)
        .replace(/^trainers?_2\//i, "")
        .replace(/^trainers?\//i, "")
        .replace(/^\//, "")
        .replace(/\s+/g, "")
        .trim()
        .toLowerCase();

      if (!spriteFile.match(/\.(png|jpg|jpeg|gif)$/i)) spriteFile += ".png";
      spriteFile = spriteFile.replace(/\.png\.png$/i, ".png");
      spriteUrl = `${base}${spriteFile}`;

      let nameSource =
        item.name ||
        item.displayName ||
        item.groupName ||
        item.id ||
        spriteFile.replace(".png", "");

      displayName =
        nameSource
          .replace(/[_-]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
          .trim() || "Trainer";

      console.log("🖼️ Trainer Sprite Construction:", {
        inputId: item.id,
        cleanedFile: spriteFile,
        finalUrl: spriteUrl,
        displayName,
      });
    }

    // ======================================================
// 🧱 Embed builder (FIXED USERNAME HANDLING)
// ======================================================

// Safely resolve username across all Discord account types
const nameSafe =
  user.globalName ||
  user.displayName ||
  user.username ||
  (user.tag ?? null) ||
  `User ${user.id}`;

const title =
  type === "pokemon"
    ? shiny
      ? `${emoji} ✨ Shiny Pokémon Discovered!`
      : `${emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)} Pokémon Found!`
    : `${emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)} Trainer Recruited!`;

const description =
  type === "pokemon"
    ? `**${nameSafe}** caught **${displayName}**!\n${rarityDisplay}\n🌿 *A wild Pokémon appeared!*`
    : `**${nameSafe}** recruited **${displayName}**!\n${rarityDisplay}\n🏫 *A new ally joins the adventure!*`;

const embed = new EmbedBuilder()
  .setTitle(title)
  .setDescription(description)
  .setColor(
    shiny ? 0xffd700 : rarityColors[rarity] || (type === "trainer" ? 0x5865f2 : 0x43b581)
  )
  .setThumbnail(spriteUrl)
  .setFooter({
    text: `🌟 Coop’s Collection Broadcast${isBypassSource ? " (Bypass)" : ""}`,
  })
  .setTimestamp();


    // ======================================================
    // 📡 Broadcast routing (with 5s timeout per send)
    // ======================================================
    const safeSend = (ch, payload) =>
      Promise.race([
        ch.send(payload),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("channel.send timeout")), 5_000)
        ),
      ]).catch(err => console.error("⚠️ Broadcast send failed:", err.message));

    if (globalChannel) await safeSend(globalChannel, { embeds: [embed] });
    if (rareChannel && (isRareTier || shiny))
      await safeSend(rareChannel, { embeds: [embed] });
    if (
      localChannel &&
      localChannel.id !== globalChannel?.id &&
      localChannel.id !== rareChannel?.id
    )
      await safeSend(localChannel, { embeds: [embed] });

    console.log(
      `📢 Broadcasted ${type} (${displayName}) [${rarity}${shiny ? "✨" : ""}] for ${user.username} | Source: ${source}`
    );
  } catch (err) {
    console.error("❌ broadcastReward failed:", err);
  }
}

// ==========================================================
// 🛡️ Helper
// ==========================================================
async function safeFetchChannel(client, id) {
  if (!id) return null;
  try {
    // Prefer cache to avoid REST calls; fall back to fetch with timeout
    const cached = client.channels.cache.get(id);
    if (cached) return cached;
    return await Promise.race([
      client.channels.fetch(id),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("channel fetch timeout")), 5_000)
      ),
    ]);
  } catch {
    return null;
  }
}
