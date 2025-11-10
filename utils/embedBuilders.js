// ==========================================================
// embedBuilders.js
// Reusable embed and UI component builders
// ==========================================================

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import { rarityEmojis } from "../spriteconfig.js";
import { rarityColors } from "../utils/colors.js";

// ==========================================================
// 🧩 Helper: format tier text + emoji
// ==========================================================
function getTierDisplay(tier) {
  const t = String(tier || "common").toLowerCase();
  const emoji = rarityEmojis?.[t] || "❔";
  const formatted = t.charAt(0).toUpperCase() + t.slice(1);
  return `${emoji} ${formatted}`;
}

// ==========================================================
// 🟢 Standard Embeds
// ==========================================================
export function createSuccessEmbed(title, description, options = {}) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(options.color || rarityColors.success)
    .setTimestamp()
    .setThumbnail(options.thumbnail || null)
    .setImage(options.image || null)
    .setFooter(options.footer || null)
    .addFields(options.fields || []);
}

export function createErrorEmbed(message, options = {}) {
  return new EmbedBuilder()
    .setTitle(options.title || "❌ Error")
    .setDescription(message)
    .setColor(options.color || rarityColors.mythic) // red
    .setTimestamp()
    .setFooter(options.footer || null);
}

export function createWarningEmbed(message, options = {}) {
  return new EmbedBuilder()
    .setTitle(options.title || "⚠️ Warning")
    .setDescription(message)
    .setColor(options.color || rarityColors.warning) // yellow
    .setTimestamp()
    .setFooter(options.footer || null);
}

export function createInfoEmbed(title, description, options = {}) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(options.color || rarityColors.rare) // blue
    .setTimestamp()
    .setThumbnail(options.thumbnail || null)
    .setImage(options.image || null)
    .setFooter(options.footer || null)
    .addFields(options.fields || []);
}

// ==========================================================
// 🎁 Pokémon Reward Embed (Unified Style)
// ==========================================================
export function createPokemonRewardEmbed(pokemon, isShiny, spriteUrl, options = {}) {
  const tier = pokemon.tier || pokemon.rarity || "common";
  const tierDisplay = getTierDisplay(tier);
  const color = isShiny
    ? rarityColors.shiny
    : rarityColors[tier.toLowerCase()] || rarityColors.common;

  const displayName = String(pokemon.name || `#${pokemon.id}`)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

  const title = isShiny ? "✨ Shiny Pokémon!" : "🎁 Pokémon Reward!";
  const desc = isShiny
    ? `✨ You caught a **Shiny ${displayName}!**\n${tierDisplay} Tier`
    : `You caught **${displayName}!**\n${tierDisplay} Tier`;

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(color)
    .setThumbnail(spriteUrl)
    .setFooter({ text: "🌟 Coop’s Collection Reward" })
    .setTimestamp();
}

// ==========================================================
// 👥 Trainer Reward Embed (Unified Style)
// ==========================================================
export function createTrainerRewardEmbed(trainer, spriteUrl, options = {}) {
  const tier = trainer.tier || trainer.rarity || "common";
  const tierDisplay = getTierDisplay(tier);
  const color = rarityColors[tier.toLowerCase()] || rarityColors.common;

  const displayName = String(trainer.name || trainer.key || "Unknown Trainer")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

  const typeLabel = trainer.key
    ? trainer.key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Trainer";

  return new EmbedBuilder()
    .setTitle(`👥 ${displayName}`)
    .setDescription(
      `🎖️ **Rarity:** ${tierDisplay}\n🧢 **Trainer Type:** ${typeLabel}`
    )
    .setColor(color)
    .setThumbnail(spriteUrl)
    .setFooter({ text: "🌟 Coop’s Collection Reward" })
    .setTimestamp();
}

// ==========================================================
// 📘 Pokédex & Stats Embeds
// ==========================================================
export function createPokedexEmbed(pokemon, spriteUrl, typeMap, options = {}) {
  const types = pokemon.types
    ? pokemon.types.map((id) => typeMap[id] || "Unknown").join("/")
    : "Unknown";
  const tier = pokemon.tier || pokemon.rarity || "unknown";
  const tierDisplay = getTierDisplay(tier);

  return new EmbedBuilder()
    .setTitle(`${pokemon.name} — #${pokemon.id}`)
    .setDescription(
      `🗒️ **Type:** ${types}\n⭐ **Tier:** ${tierDisplay}\n📘 **Description:** ${
        pokemon.flavor || pokemon.description || "No Pokédex entry available."
      }`
    )
    .setColor(options.color || rarityColors.warning) // gold yellow
    .setThumbnail(spriteUrl)
    .setFooter(options.footer || { text: "Coop's Collection Pokédex" })
    .setTimestamp();
}

export function createCollectionStatsEmbed(username, stats, options = {}) {
  const fields = [
    { name: "Total Pokémon", value: `${stats.totalPokemon || 0}`, inline: true },
    { name: "Shiny Pokémon", value: `${stats.shinyPokemon || 0}`, inline: true },
    { name: "Trainers", value: `${stats.totalTrainers || 0}`, inline: true },
  ];

  if (stats.tp !== undefined)
    fields.push({ name: "TP (Trainer Points)", value: `${stats.tp.toLocaleString()}`, inline: true });
  if (stats.cc !== undefined)
    fields.push({ name: "CC (Collection Coins)", value: `${stats.cc.toLocaleString()}`, inline: true });
  if (stats.rank)
    fields.push({ name: "Rank", value: stats.rank, inline: true });

  return new EmbedBuilder()
    .setTitle(`${username}'s Collection`)
    .setColor(options.color || rarityColors.uncommon) // green success
    .addFields(fields)
    .setFooter(options.footer || { text: "Keep collecting to level up!" })
    .setTimestamp();
}

// ==========================================================
// 🔘 Buttons & Menus
// ==========================================================
export function createChoiceMenu(customId, placeholder, options) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder);

  menu.addOptions(
    options.map((opt) => ({
      label: opt.label,
      value: opt.value,
      emoji: opt.emoji,
      description: opt.description,
    }))
  );

  return menu;
}

export function createConfirmationButtons(confirmId, cancelId, options = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel(options.confirmLabel || "Confirm")
      .setStyle(options.confirmStyle || ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel(options.cancelLabel || "Cancel")
      .setStyle(options.cancelStyle || ButtonStyle.Secondary)
  );
}

export function createToggleButton(customId, label, options = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(options.style || ButtonStyle.Primary)
  );
}

export function createCloseButton(customId = "close", options = {}) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(options.label || "❌ Close")
    .setStyle(options.style || ButtonStyle.Danger);
}

export function createInspectButton(customId, label) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(`🔍 ${label}`)
    .setStyle(ButtonStyle.Primary);
}
