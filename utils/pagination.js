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
 * @param {object} options - Additional options (styles, labels)
 * @returns {ActionRowBuilder} Action row with navigation buttons
 */
export function createPaginationButtons(currentPage, totalPages, includeClose = true, options = {}) {
  const components = [
    new ButtonBuilder()
      .setCustomId("prev_page")
      .setLabel(options.prevLabel || "⬅️ Prev")
      .setStyle(options.prevStyle || ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId("next_page")
      .setLabel(options.nextLabel || "Next ➡️")
      .setStyle(options.nextStyle || ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  ];
  
  if (includeClose) {
    components.push(
      new ButtonBuilder()
        .setCustomId("close")
        .setLabel(options.closeLabel || "❌ Close")
        .setStyle(options.closeStyle || ButtonStyle.Danger)
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
  if (!Array.isArray(items) || items.length === 0) {
    return [[]];
  }
  
  const pages = [];
  for (let i = 0; i < items.length; i += itemsPerPage) {
    pages.push(items.slice(i, i + itemsPerPage));
  }
  return pages;
}

/**
 * Get a specific page from an array
 * @param {Array} items - Array to paginate
 * @param {number} pageIndex - Page index (0-based)
 * @param {number} itemsPerPage - Number of items per page
 * @returns {Array} Items for the specified page
 */
export function getPage(items, pageIndex, itemsPerPage = 10) {
  if (!Array.isArray(items)) {
    return [];
  }
  
  const start = pageIndex * itemsPerPage;
  const end = start + itemsPerPage;
  return items.slice(start, end);
}

/**
 * Calculate total pages needed for an array
 * @param {Array} items - Array to paginate
 * @param {number} itemsPerPage - Number of items per page
 * @returns {number} Total number of pages
 */
export function calculateTotalPages(items, itemsPerPage = 10) {
  if (!Array.isArray(items) || items.length === 0) {
    return 1;
  }
  return Math.ceil(items.length / itemsPerPage);
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

/**
 * Create a Pokemon-specific pagination helper
 * @param {Array} pokemonList - List of Pokemon to paginate
 * @param {number} itemsPerPage - Items per page (default 12 for Pokemon)
 * @returns {object} { pages, totalPages, getPage, handleNavigation }
 */
export function createPokemonPaginator(pokemonList, itemsPerPage = 12) {
  if (!Array.isArray(pokemonList)) {
    pokemonList = [];
  }

  const pages = paginateArray(pokemonList, itemsPerPage);
  const totalPages = pages.length || 1;

  return {
    pages,
    totalPages,
    itemsPerPage,
    
    /**
     * Get items for a specific page
     * @param {number} pageIndex - Page index
     * @returns {Array} Items for that page
     */
    getPage: (pageIndex) => {
      if (pageIndex < 0 || pageIndex >= totalPages) {
        return [];
      }
      return pages[pageIndex] || [];
    },

    /**
     * Navigate to a new page based on button interaction
     * @param {string} customId - Button custom ID
     * @param {number} currentPage - Current page
     * @returns {number|null} New page index or null if no change
     */
    handleNavigation: (customId, currentPage) => {
      if (customId === "prev_page" && currentPage > 0) {
        return currentPage - 1;
      }
      if (customId === "next_page" && currentPage < totalPages - 1) {
        return currentPage + 1;
      }
      return null;
    }
  };
}

/**
 * Format page info for embed footer
 * @param {number} currentPage - Current page (0-based)
 * @param {number} totalPages - Total pages
 * @param {number} totalItems - Total items
 * @returns {string} Formatted page info
 */
export function formatPageInfo(currentPage, totalPages, totalItems = null) {
  let info = `Page ${currentPage + 1}/${totalPages}`;
  if (totalItems) {
    info += ` • ${totalItems} total`;
  }
  return info;
}