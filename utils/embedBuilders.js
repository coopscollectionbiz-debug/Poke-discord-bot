// ==========================================================
// embedBuilders.js
// Reusable embed and UI component builders
// ==========================================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";

/**
 * Create a standard success embed
 * @param {string} title - Embed title
 * @param {string} description - Embed description
 * @param {object} options - Additional options (color, thumbnail, footer, etc.)
 * @returns {EmbedBuilder} Success embed
 */
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

/**
 * Create a standard error embed
 * @param {string} message - Error message
 * @param {object} options - Additional options
 * @returns {EmbedBuilder} Error embed
 */
export function createErrorEmbed(message, options = {}) {
  const embed = new EmbedBuilder()
    .setTitle(options.title || "❌ Error")
    .setDescription(message)
    .setColor(options.color || 0xff0000)
    .setTimestamp();
  
  if (options.footer) embed.setFooter(options.footer);
  
  return embed;
}

/**
 * Create a warning embed
 * @param {string} message - Warning message
 * @param {object} options - Additional options
 * @returns {EmbedBuilder} Warning embed
 */
export function createWarningEmbed(message, options = {}) {
  const embed = new EmbedBuilder()
    .setTitle(options.title || "⚠️ Warning")
    .setDescription(message)
    .setColor(options.color || 0xffa500)
    .setTimestamp();
  
  if (options.footer) embed.setFooter(options.footer);
  
  return embed;
}

/**
 * Create an info embed
 * @param {string} title - Embed title
 * @param {string} description - Embed description
 * @param {object} options - Additional options
 * @returns {EmbedBuilder} Info embed
 */
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

/**
 * Create a Pokemon reward embed
 * @param {object} pokemon - Pokemon object
 * @param {boolean} isShiny - Whether Pokemon is shiny
 * @param {string} spriteUrl - Pokemon sprite URL
 * @param {object} options - Additional options
 * @returns {EmbedBuilder} Pokemon embed
 */
export function createPokemonRewardEmbed(pokemon, isShiny, spriteUrl, options = {}) {
  const title = options.title || (isShiny ? "✨ Shiny Pokémon!" : "🎁 Pokémon Reward!");
  const description = isShiny
    ? `✨ You obtained a **Shiny ${pokemon.name}!**`
    : `You obtained a **${pokemon.name}!**`;
  
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(options.description || description)
    .setColor(isShiny ? 0xffd700 : 0x00ae86)
    .setThumbnail(spriteUrl)
    .setFooter(options.footer || { text: "Keep collecting to complete your Pokédex!" })
    .setTimestamp();
}

/**
 * Create a Trainer reward embed
 * @param {object} trainer - Trainer object
 * @param {string} spriteUrl - Trainer sprite URL
 * @param {object} options - Additional options
 * @returns {EmbedBuilder} Trainer embed
 */
export function createTrainerRewardEmbed(trainer, spriteUrl, options = {}) {
  return new EmbedBuilder()
    .setTitle(options.title || "🎓 Trainer Reward!")
    .setDescription(options.description || `You unlocked **${trainer.name}**!`)
    .setColor(options.color || 0x5865f2)
    .setThumbnail(spriteUrl)
    .setFooter(options.footer || { text: "Equip it with /trainercard!" })
    .setTimestamp();
}

/**
 * Create a Pokedex entry embed
 * @param {object} pokemon - Pokemon object
 * @param {string} spriteUrl - Pokemon sprite URL
 * @param {object} typeMap - Type ID to name mapping
 * @param {object} options - Additional options
 * @returns {EmbedBuilder} Pokedex embed
 */
export function createPokedexEmbed(pokemon, spriteUrl, typeMap, options = {}) {
  const types = pokemon.types
    ? pokemon.types.map(id => typeMap[id] || "Unknown").join("/")
    : "Unknown";
  
  return new EmbedBuilder()
    .setTitle(`${pokemon.name} — #${pokemon.id}`)
    .setDescription(
      `🗒️ **Type:** ${types}\n⭐ **Rarity:** ${pokemon.tier || pokemon.rarity || "Unknown"}\n📘 **Description:** ${
        pokemon.flavor || pokemon.description || "No Pokédex entry available."
      }`
    )
    .setColor(options.color || 0xffcb05)
    .setThumbnail(spriteUrl)
    .setFooter(options.footer || { text: "Coop's Collection Pokédex" })
    .setTimestamp();
}

/**
 * Create a collection stats embed
 * @param {string} username - User's name
 * @param {object} stats - Collection statistics
 * @param {object} options - Additional options
 * @returns {EmbedBuilder} Stats embed
 */
export function createCollectionStatsEmbed(username, stats, options = {}) {
  const fields = [
    { name: "Total Pokémon", value: `${stats.totalPokemon || 0}`, inline: true },
    { name: "Shiny Pokémon", value: `${stats.shinyPokemon || 0}`, inline: true },
    { name: "Trainers", value: `${stats.totalTrainers || 0}`, inline: true }
  ];
  
  if (stats.tp !== undefined) {
    fields.push({ name: "TP (Trainer Points)", value: `${stats.tp.toLocaleString()}`, inline: true });
  }
  
  if (stats.cc !== undefined) {
    fields.push({ name: "CC (Collection Coins)", value: `${stats.cc.toLocaleString()}`, inline: true });
  }
  
  if (stats.rank) {
    fields.push({ name: "Rank", value: stats.rank, inline: true });
  }
  
  return new EmbedBuilder()
    .setTitle(`${username}'s Collection`)
    .setColor(options.color || 0x43b581)
    .addFields(fields)
    .setFooter(options.footer || { text: "Keep collecting to level up!" })
    .setTimestamp();
}

/**
 * Create a choice menu (select menu)
 * @param {string} customId - Custom ID for the menu
 * @param {string} placeholder - Placeholder text
 * @param {Array} options - Array of options {label, value, emoji?, description?}
 * @returns {StringSelectMenuBuilder} Select menu
 */
export function createChoiceMenu(customId, placeholder, options) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder);
  
  const menuOptions = options.map(opt => {
    const option = { label: opt.label, value: opt.value };
    if (opt.emoji) option.emoji = opt.emoji;
    if (opt.description) option.description = opt.description;
    return option;
  });
  
  menu.addOptions(menuOptions);
  return menu;
}

/**
 * Create a confirmation button row
 * @param {string} confirmId - Custom ID for confirm button
 * @param {string} cancelId - Custom ID for cancel button
 * @param {object} options - Button options (labels, styles)
 * @returns {ActionRowBuilder} Button row
 */
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

/**
 * Create a toggle button (e.g., for shiny/normal toggle)
 * @param {string} customId - Custom ID
 * @param {string} label - Button label
 * @param {object} options - Button options
 * @returns {ActionRowBuilder} Button row
 */
export function createToggleButton(customId, label, options = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(options.style || ButtonStyle.Primary)
  );
}

/**
 * Create a close button
 * @param {string} customId - Custom ID (default: "close")
 * @param {object} options - Button options
 * @returns {ButtonBuilder} Close button
 */
export function createCloseButton(customId = "close", options = {}) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(options.label || "❌ Close")
    .setStyle(options.style || ButtonStyle.Danger);
}

/**
 * Create an inspect button
 * @param {string} customId - Custom ID
 * @param {string} label - Button label
 * @returns {ButtonBuilder} Inspect button
 */
export function createInspectButton(customId, label) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(`🔍 ${label}`)
    .setStyle(ButtonStyle.Primary);
}
