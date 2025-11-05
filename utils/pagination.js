// ==========================================================
// pagination.js
// Reusable pagination utilities for Discord embeds
// ==========================================================

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

/**
 * Create pagination buttons for embeds
 * @param {number} currentPage - Current page index (0-based)
 * @param {number} totalPages - Total number of pages
 * @param {boolean} includeClose - Whether to include a close button
 * @returns {ActionRowBuilder} Action row with navigation buttons
 */
export function createPaginationButtons(currentPage, totalPages, includeClose = true) {
  const components = [
    new ButtonBuilder()
      .setCustomId("prev_page")
      .setLabel("⬅️ Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId("next_page")
      .setLabel("Next ➡️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  ];
  
  if (includeClose) {
    components.push(
      new ButtonBuilder()
        .setCustomId("close")
        .setLabel("❌ Close")
        .setStyle(ButtonStyle.Danger)
    );
  }
  
  return new ActionRowBuilder().addComponents(components);
}

/**
 * Paginate an array into chunks
 * @param {Array} items - Array to paginate
 * @param {number} itemsPerPage - Number of items per page
 * @returns {Array<Array>} Array of page arrays
 */
export function paginateArray(items, itemsPerPage = 10) {
  const pages = [];
  for (let i = 0; i < items.length; i += itemsPerPage) {
    pages.push(items.slice(i, i + itemsPerPage));
  }
  return pages.length > 0 ? pages : [[]];
}

/**
 * Get a specific page from an array
 * @param {Array} items - Array to paginate
 * @param {number} pageIndex - Page index (0-based)
 * @param {number} itemsPerPage - Number of items per page
 * @returns {Array} Items for the specified page
 */
export function getPage(items, pageIndex, itemsPerPage = 10) {
  const start = pageIndex * itemsPerPage;
  return items.slice(start, start + itemsPerPage);
}

/**
 * Calculate total pages needed for an array
 * @param {Array} items - Array to paginate
 * @param {number} itemsPerPage - Number of items per page
 * @returns {number} Total number of pages
 */
export function calculateTotalPages(items, itemsPerPage = 10) {
  return Math.max(1, Math.ceil(items.length / itemsPerPage));
}

/**
 * Handle pagination button interactions
 * @param {object} interaction - Button interaction
 * @param {number} currentPage - Current page index
 * @param {number} totalPages - Total number of pages
 * @returns {number|null} New page index or null if no change
 */
export function handlePaginationInteraction(interaction, currentPage, totalPages) {
  const { customId } = interaction;
  
  if (customId === "prev_page" && currentPage > 0) {
    return currentPage - 1;
  }
  
  if (customId === "next_page" && currentPage < totalPages - 1) {
    return currentPage + 1;
  }
  
  return null;
}

/**
 * Create a pagination collector configuration
 * @param {string} userId - User ID who can interact with pagination
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {object} Collector configuration
 */
export function createCollectorConfig(userId, timeoutMs = 120000) {
  return {
    filter: (i) => i.user.id === userId,
    time: timeoutMs
  };
}
