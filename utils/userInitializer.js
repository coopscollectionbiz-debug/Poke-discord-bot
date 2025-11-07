// userInitializer.js
// Shared user initialization and reload logic for all commands

import fetch from "node-fetch";
import { validateUserSchema, createNewUser } from "./userSchema.js";

/**
 * Reload a single user from Discord storage
 * @param {Object} client - Discord client
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User data or null if not found
 */
export async function reloadUserFromDiscord(client, userId) {
  try {
    const storageChannel = await client.channels.fetch(process.env.STORAGE_CHANNEL_ID);
    const messages = await storageChannel.messages.fetch({ limit: 50 });
    const backups = messages.filter(m => m.attachments.size > 0 && m.attachments.first().name.startsWith("trainerData"))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    
    if (backups.size > 0) {
      const res = await fetch(backups.first().attachments.first().url);
      const data = JSON.parse(await res.text());
      if (data[userId]) {
        console.log(`🔄 Reloaded user ${userId} from Discord`);
        return data[userId];
      }
    }
  } catch (err) {
    console.warn(`⚠️ Failed to reload user from Discord:`, err.message);
  }
  return null;
}

/**
 * Ensure user is properly initialized with latest data
 * Tries Discord first → Memory → Creates new
 * @param {string} userId - User ID
 * @param {string} username - Username
 * @param {Object} trainerData - In-memory trainer data object
 * @param {Object} client - Discord client for reload
 * @returns {Promise<Object>} Initialized user object
 */
export async function ensureUserInitialized(userId, username, trainerData, client) {
  // Check if in memory
  let user = trainerData[userId];

  // If not in memory, create new user
  if (!user) {
    console.log(`🆕 Creating new user ${userId}`);
    user = createNewUser(userId, username);
    trainerData[userId] = user;
    return user;
  }

  // If in memory, validate schema
  console.log(`✅ User ${userId} loaded from memory`);
  user = validateUserSchema(user, userId, username);
  trainerData[userId] = user;
  return user;
}