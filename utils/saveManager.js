// ==========================================================
// utils/saveManager.js
// Atomic save operations for data consistency
// ==========================================================

/**
 * Performs atomic save to both local and Discord storage
 * Ensures data consistency across both backends
 * @param {Object} trainerData - Complete trainer data object
 * @param {Function} saveLocal - Function to save locally
 * @param {Function} saveDiscord - Function to save to Discord
 * @throws {Error} If local save fails (Discord failure is non-fatal)
 * @returns {Object} Result with status of both saves
 */
export async function atomicSave(trainerData, saveLocal, saveDiscord) {
  const result = {
    localSuccess: false,
    discordSuccess: false,
    errors: []
  };

  // Step 1: Save locally (required)
  try {
    if (typeof saveLocal === "function") {
      await saveLocal(trainerData);
      result.localSuccess = true;
    }
  } catch (err) {
    const errMsg = `❌ Local save failed: ${err.message}`;
    console.error(errMsg, err);
    result.errors.push(errMsg);
    throw new Error("Failed to save data locally. Changes not persisted.");
  }

  // Step 2: Save to Discord (optional but recommended)
  try {
    if (typeof saveDiscord === "function") {
      await saveDiscord(trainerData);
      result.discordSuccess = true;
    }
  } catch (err) {
    const errMsg = `⚠️ Discord backup save failed: ${err.message}`;
    console.warn(errMsg, err);
    result.errors.push(errMsg);
    // Don't throw - local save succeeded, Discord is just backup
  }

  return result;
}

/**
 * Performs atomic CC/TP transaction
 * @param {Object} user - User object
 * @param {string} type - "cc" or "tp"
 * @param {number} amount - Amount to add (can be negative)
 * @returns {Object} Transaction result
 */
export function performCurrencyTransaction(user, type, amount) {
  if (!user) throw new Error("Invalid user object");
  if (type !== "cc" && type !== "tp") throw new Error("Invalid currency type");
  if (!Number.isInteger(amount)) throw new Error("Amount must be an integer");
  if (amount === 0) throw new Error("Amount cannot be zero");

  const current = user[type] || 0;
  const newValue = current + amount;

  if (newValue < 0) {
    throw new Error(`Insufficient ${type.toUpperCase()}. Current: ${current}, Requested: ${amount}`);
  }

  user[type] = newValue;

  return {
    success: true,
    type,
    previousValue: current,
    newValue,
    change: amount
  };
}

/**
 * Performs atomic item transaction (Pokemon or Trainer)
 * @param {Object} sender - Sender user object
 * @param {Object} recipient - Recipient user object
 * @param {string} itemType - "pokemon" or "trainer"
 * @param {string} itemKey - Pokemon ID or trainer key
 * @param {number} amount - Number of items to transfer (1 for trainers)
 * @returns {Object} Transaction result
 */
export function performItemTransaction(sender, recipient, itemType, itemKey, amount = 1) {
  if (!sender || !recipient) throw new Error("Invalid user objects");
  if (itemType !== "pokemon" && itemType !== "trainer") throw new Error("Invalid item type");
  if (!itemKey) throw new Error("Invalid item key");
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Amount must be >= 1");

  if (itemType === "pokemon") {
    // Pokemon transaction
    if (!sender.pokemon[itemKey]) {
      throw new Error(`Sender doesn't own pokemon ${itemKey}`);
    }

    const senderData = sender.pokemon[itemKey];
    const available = (senderData.normal || 0) + (senderData.shiny || 0);

    if (available < amount) {
      throw new Error(`Insufficient pokemon. Have: ${available}, Need: ${amount}`);
    }

    if (available - amount === 0) {
      throw new Error("Cannot transfer your last pokemon");
    }

    // Perform transfer
    senderData.normal = Math.max(0, (senderData.normal || 0) - amount);

    if (!recipient.pokemon[itemKey]) {
      recipient.pokemon[itemKey] = { normal: 0, shiny: 0 };
    }
    recipient.pokemon[itemKey].normal = (recipient.pokemon[itemKey].normal || 0) + amount;

    return {
      success: true,
      type: "pokemon",
      itemKey,
      amount,
      senderRemaining: senderData.normal + (senderData.shiny || 0),
      recipientTotal: recipient.pokemon[itemKey].normal + (recipient.pokemon[itemKey].shiny || 0)
    };
  } else {
    // Trainer transaction
    if (!sender.trainers[itemKey]) {
      throw new Error(`Sender doesn't own trainer ${itemKey}`);
    }

    const senderTrainerCount = Object.keys(sender.trainers).length;
    if (senderTrainerCount <= 1) {
      throw new Error("Cannot transfer your only trainer sprite");
    }

    // Perform transfer
    delete sender.trainers[itemKey];
    if (!recipient.trainers) {
      recipient.trainers = {};
    }
    recipient.trainers[itemKey] = true;

    return {
      success: true,
      type: "trainer",
      itemKey,
      senderRemaining: Object.keys(sender.trainers).length,
      recipientTotal: Object.keys(recipient.trainers).length
    };
  }
}

/**
 * Validates a save operation can be performed
 * @param {Object} trainerData - Complete trainer data
 * @param {string} userId - User ID to validate
 * @returns {Object} Validation result
 */
export function validateSaveData(trainerData, userId) {
  const errors = [];

  if (!trainerData || typeof trainerData !== "object") {
    errors.push("Invalid trainer data object");
  }

  if (userId && !trainerData[userId]) {
    errors.push(`User ${userId} not found in trainer data`);
  }

  if (userId && trainerData[userId]) {
    const user = trainerData[userId];
    if (typeof user.cc !== "number") errors.push("Invalid CC value");
    if (typeof user.tp !== "number") errors.push("Invalid TP value");
    if (typeof user.pokemon !== "object") errors.push("Invalid pokemon data");
    if (typeof user.trainers !== "object") errors.push("Invalid trainers data");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
