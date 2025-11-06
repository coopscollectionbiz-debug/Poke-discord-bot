// ==========================================================
// utils/trainerFileHandler.js
// Standardized trainer file key handling
// ==========================================================

import { spritePaths } from "../spriteconfig.js";

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
  
  // Check if grayscale version should be used
  if (trainer.grayscale) {
    return `${spritePaths.trainersGray}${key}`;
  }
  
  return `${spritePaths.trainers}${key}`;
}

/**
 * Checks if a user owns a trainer
 * @param {Object} user - User object
 * @param {Object} trainer - Trainer object
 * @returns {boolean} Whether user owns the trainer
 */
export function isTrainerOwned(user, trainer) {
  if (!user?.trainers || !trainer) return false;
  
  const trainerKey = normalizeTrainerKey(getTrainerKey(trainer));
  
  return Object.keys(user.trainers).some(ownedKey => 
    normalizeTrainerKey(ownedKey) === trainerKey
  );
}

/**
 * Adds a trainer to a user's collection
 * @param {Object} user - User object
 * @param {Object} trainer - Trainer object
 */
export function addTrainer(user, trainer) {
  if (!user || !trainer) return;
  
  if (!user.trainers) {
    user.trainers = {};
  }
  
  const key = getTrainerKey(trainer);
  if (key) {
    user.trainers[key] = true;
  }
}

/**
 * Removes a trainer from a user's collection
 * @param {Object} user - User object
 * @param {Object} trainer - Trainer object
 */
export function removeTrainer(user, trainer) {
  if (!user?.trainers || !trainer) return;
  
  const key = getTrainerKey(trainer);
  if (key) {
    delete user.trainers[key];
  }
}

/**
 * Gets count of unique trainers owned by user
 * @param {Object} user - User object
 * @returns {number} Number of trainers owned
 */
export function getOwnedTrainerCount(user) {
  if (!user?.trainers) return 0;
  return Object.keys(user.trainers).length;
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
