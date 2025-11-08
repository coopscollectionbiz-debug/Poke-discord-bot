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
import { rarityEmojis } from "../spriteconfig.js"; // ✅ standardized import

// ==========================================================
// 🧩 Helper: format tier text + emoji
// ==========================================================
function getTierDisplay(tier) {
  const t = String(tier || "Common").toLowerCase();
  const emoji = rarityEmojis?.[t] || "❔";
  const formatted = t.charAt(0).toUpperCase() + t.slice(1);
  return `${emoji} ${formatted}`;
}

// ==========================================================
// 🟢 Standard Embeds
// ==========================================================
export function createSuccessEmbed(title, description, options = {}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(options.color || 0x00ae86)
    .setTimestamp();

  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.image) embed.setImage(options.image);
  if (options.footer) embed.setFooter(options.footer);
  if (options.fields) embed.addFields(options.fields);

  return embed;
}

export function createErrorEmbed(message, options = {}) {
  return new EmbedBuilder()
    .setTitle(options.title || "❌ Error")
    .setDescription(message)
    .setColor(options.color || 0xff0000)
    .setTimestamp()
    .setFooter(options.footer || null);
}

export function createWarningEmbed(message, options = {}) {
  return new EmbedBuilder()
    .setTitle(options.title || "⚠️ Warning")
    .setDescription(message)
    .setColor(options.color || 0xffa500)
    .setTimestamp()
    .setFooter(options.footer || null);
}

export function createInfoEmbed(title, description, options = {}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(options.color || 0x3498db)
    .setTimestamp();

  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.image) embed.setImage(options.image);
  if (options.footer) embed.setFooter(options.footer);
  if (options.fields) embed.addFields(options.fields);

  return embed;
}

// ==========================================================
// 🎁 Reward Embeds
// ==========================================================

/**
 * Pokémon Reward Embed
 */
export function createPokemonRewardEmbed(pokemon, isShiny, spriteUrl, options = {}) {
  const tier = pokemon.tier || pokemon.rarity || "Common";
  const tierDisplay = getTierDisplay(tier);

  const title = options.title || (isShiny ? "✨ Shiny Pokémon!" : "🎁 Pokémon Reward!");
  const description =
    options.description ||
    (isShiny
      ? `✨ You obtained a **Shiny ${pokemon.name}!**\n${tierDisplay} Tier`
      : `You obtained a **${pokemon.name}!**\n${tierDisplay} Tier`);

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(isShiny ? 0xffd700 : 0x00ae86)
    .setThumbnail(spriteUrl)
    .setFooter(options.footer || { text: "Keep collecting to complete your Pokédex!" })
    .setTimestamp();
}

/**
 * Trainer Reward Embed
 */
export function createTrainerRewardEmbed(trainer, spriteUrl, options = {}) {
  const tier = trainer.tier || trainer.rarity || "Common";
  const tierDisplay = getTierDisplay(tier);

  return new EmbedBuilder()
    .setTitle(options.title || "🎓 Trainer Reward!")
    .setDescription(
      options.description ||
        `You unlocked **${trainer.name || trainer.filename}!**\n${tierDisplay} Tier\nEquip it with \`/trainercard\`!`
    )
    .setColor(options.color || 0x5865f2)
    .setThumbnail(spriteUrl)
    .setFooter(options.footer || { text: "Keep training to collect them all!" })
    .setTimestamp();
}

// ==========================================================
// 📘 Pokédex & Stats Embeds
// ==========================================================
export function createPokedexEmbed(pokemon, spriteUrl, typeMap, options = {}) {
  const types = pokemon.types
    ? pokemon.types.map((id) => typeMap[id] || "Unknown").join("/")
    : "Unknown";
  const tier = pokemon.tier || pokemon.rarity || "Unknown";
  const tierDisplay = getTierDisplay(tier);

  return new EmbedBuilder()
    .setTitle(`${pokemon.name} — #${pokemon.id}`)
    .setDescription(
      `🗒️ **Type:** ${types}\n⭐ **Tier:** ${tierDisplay}\n📘 **Description:** ${
        pokemon.flavor || pokemon.description || "No Pokédex entry available."
      }`
    )
    .setColor(options.color || 0xffcb05)
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
    .setColor(options.color || 0x43b581)
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

  const menuOptions = options.map((opt) => {
    const option = { label: opt.label, value: opt.value };
    if (opt.emoji) option.emoji = opt.emoji;
    if (opt.description) option.description = opt.description;
    return option;
  });

  menu.addOptions(menuOptions);
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
