// ==========================================================
// utils/trainerFileHandler.js
// Standardized trainer file key handling
// ==========================================================

import { spritePaths } from "../spriteconfig.js";
import { trainerImageUrl } from "./trainerAssets.js";
import { grantTrainer, revokeTrainer, trainerCount } from "../services/assets.js";

/**
 * Gets the standardized key for a trainer object
 * Handles multiple possible key formats
 * @param {Object} trainer - Trainer object
 * @returns {string} Standardized trainer key
 */
export function getTrainerKey(trainer) {
  if (!trainer) return null;
  
  // Try keys in priority order
  return trainer.filename || trainer.file || trainer.sprite || trainer.name || null;
}

/**
 * Normalizes a trainer key by removing .png extension
 * @param {string} key - Trainer key
 * @returns {string} Normalized key
 */
export function normalizeTrainerKey(key) {
  if (!key) return key;
  return key.replace(/\.png$/, '').trim();
}

/**
 * Gets the sprite URL for a trainer
 * @param {Object} trainer - Trainer object
 * @returns {string} Full sprite URL
 */
export function getTrainerSpriteUrl(trainer) {
  const key = getTrainerKey(trainer);
  if (!key) return null;
  
  // Check if trainer has custom URL
  if (trainer.url) {
    return trainer.url;
  }
  
  // Breathing idle GIF when available; static PNG (or grayscale) otherwise.
  return trainerImageUrl(key, { grayscale: !!trainer.grayscale });
}

/**
 * Checks if a user owns a trainer (ignores a trailing .png, case-insensitive).
 * Ownership itself lives in services/assets.js; these wrappers keep the old API.
 * @param {Object} user - User object
 * @param {Object} trainer - Trainer object
 * @returns {boolean} Whether user owns the trainer
 */
export function isTrainerOwned(user, trainer) {
  if (!user?.trainers || !trainer) return false;
  const want = normalizeTrainerKey(getTrainerKey(trainer))?.toLowerCase();
  const owned = Array.isArray(user.trainers) ? user.trainers : Object.keys(user.trainers);
  return owned.some((k) => normalizeTrainerKey(String(k)).toLowerCase() === want);
}

/**
 * Adds a trainer to a user's collection (user.trainers stays an array).
 * @param {Object} user - User object
 * @param {Object} trainer - Trainer object
 */
export function addTrainer(user, trainer) {
  const key = getTrainerKey(trainer);
  if (!user || !key) return;
  grantTrainer(user, key);
}

/**
 * Removes a trainer from a user's collection
 * @param {Object} user - User object
 * @param {Object} trainer - Trainer object
 */
export function removeTrainer(user, trainer) {
  const key = getTrainerKey(trainer);
  if (!user?.trainers || !key) return;
  revokeTrainer(user, key);
}

/**
 * Gets count of unique trainers owned by user
 * @param {Object} user - User object
 * @returns {number} Number of trainers owned
 */
export function getOwnedTrainerCount(user) {
  return trainerCount(user);
}

/**
 * Finds a trainer in a flat list by various criteria
 * @param {Array} trainers - Array of trainer objects
 * @param {string} query - Name, filename, or key to search
 * @returns {Object|null} Found trainer or null
 */
export function findTrainerByQuery(trainers, query) {
  if (!trainers || !query) return null;
  
  const normalizedQuery = query.toLowerCase().trim();
  
  return trainers.find(t => {
    const key = normalizeTrainerKey(getTrainerKey(t));
    const name = t.name?.toLowerCase().trim();
    
    return (
      key === normalizedQuery ||
      key === normalizeTrainerKey(normalizedQuery) ||
      name === normalizedQuery
    );
  }) || null;
}
