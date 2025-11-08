// ==========================================================
// 🌟 utils/rareSightings.js
// Shared broadcast logic for Epic+ or Shiny Pokémon / Trainers
// ==========================================================

import { EmbedBuilder } from "discord.js";
import { rarityEmojis, spritePaths } from "../spriteconfig.js";

// Broadcast tiers (Epic+ always public)
const RARE_TIERS = ["rare", "epic", "legendary", "mythic"];

/**
 * Post an Epic+ Pokémon or Trainer — or any Shiny Pokémon — to the #rare-sightings channel
 * @param {object} client - Discord.js client
 * @param {object} reward - Pokémon or Trainer object (must include .name, .id/.filename, .tier/.rarity)
 * @param {object} user - Discord user object (for mention)
 * @param {boolean} isPokemon - True if this is a Pokémon reward
 * @param {boolean} isShiny - True if this Pokémon is shiny
 */
export async function postRareSightings(client, reward, user, isPokemon = false, isShiny = false) {
  try {
    const tier = (reward.tier || reward.rarity || "common").toLowerCase();
    const shouldBroadcast = RARE_TIERS.includes(tier) || (isPokemon && isShiny);
    if (!shouldBroadcast) return;

    const channelId = process.env.RARE_SIGHTINGS_CHANNEL_ID;
    if (!channelId) {
      console.warn("⚠️ RARE_SIGHTINGS_CHANNEL_ID not set in environment");
      return;
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      console.warn("⚠️ Rare Sightings channel not found or bot lacks permission");
      return;
    }

    const emoji = rarityEmojis[tier] || "⚬";
    const spriteUrl = isPokemon
      ? (isShiny
          ? `${spritePaths.shiny}${reward.id}.gif`
          : `${spritePaths.pokemon}${reward.id}.gif`)
      : `${spritePaths.trainers}${reward.id}.png`;

    const prefix = isPokemon
      ? `${emoji} ${isShiny ? "✨ Shiny " : ""}${reward.name}`
      : `${emoji} ${reward.name}`;

    const description = isPokemon
      ? `<@${user.id}> just discovered a ${isShiny ? "✨ **Shiny** " : ""}rare Pokémon!`
      : `<@${user.id}> encountered a rare Trainer!`;

    const embed = new EmbedBuilder()
      .setTitle(prefix)
      .setDescription(description)
      .setImage(spriteUrl)
      .setFooter({ text: `Tier: ${tier.toUpperCase()}` });

    await channel.send({ embeds: [embed] });
    console.log(`📣 Posted rare sighting: ${reward.name} (${isShiny ? "shiny " : ""}${tier})`);
  } catch (err) {
    console.error("❌ Failed to post rare sighting:", err.message);
  }
}
