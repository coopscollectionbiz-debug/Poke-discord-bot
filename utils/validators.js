// ==========================================================
// validators.js
// Centralized input validation for slash commands
// ==========================================================

/**
 * Validate an amount parameter (positive integer)
 * @param {number} amount - Amount to validate
 * @param {number} max - Maximum allowed value (optional)
 * @returns {object} { valid: boolean, error: string|null }
 */
export function validateAmount(amount, max = null) {
  if (!Number.isInteger(amount)) {
    return { valid: false, error: "Amount must be a whole number." };
  }
  
  if (amount <= 0) {
    return { valid: false, error: "Amount must be greater than 0." };
  }
  
  if (max !== null && amount > max) {
    return { valid: false, error: `Amount cannot exceed ${max}.` };
  }
  
  return { valid: true, error: null };
}

/**
 * Validate a user ID
 * @param {string} userId - Discord user ID
 * @returns {object} { valid: boolean, error: string|null }
 */
export function validateUserId(userId) {
  if (!userId || typeof userId !== "string") {
    return { valid: false, error: "Invalid user ID." };
  }
  
  if (!/^\d+$/.test(userId)) {
    return { valid: false, error: "User ID must contain only digits." };
  }
  
  return { valid: true, error: null };
}

/**
 * Sanitize a string input (remove potentially dangerous characters)
 * @param {string} input - Input string
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized string
 */
export function sanitizeString(input, maxLength = 100) {
  if (!input || typeof input !== "string") {
    return "";
  }
  
  // Remove control characters and limit length
  return input
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate Pokemon/Trainer name query
 * @param {string} query - Search query
 * @returns {object} { valid: boolean, error: string|null, sanitized: string }
 */
export function validateNameQuery(query) {
  if (!query || typeof query !== "string") {
    return { valid: false, error: "Query must be a valid string.", sanitized: "" };
  }
  
  const sanitized = sanitizeString(query, 50);
  
  if (sanitized.length === 0) {
    return { valid: false, error: "Query cannot be empty.", sanitized: "" };
  }
  
  if (sanitized.length < 2) {
    return { valid: false, error: "Query must be at least 2 characters long.", sanitized };
  }
  
  return { valid: true, error: null, sanitized };
}

/**
 * Validate that user has sufficient resources
 * @param {object} user - User data object
 * @param {string} resourceType - Type of resource (cc, tp, pokemon, trainers)
 * @param {number|string} amount - Amount or item identifier
 * @returns {object} { valid: boolean, error: string|null }
 */
export function validateUserResources(user, resourceType, amount) {
  if (!user) {
    return { valid: false, error: "User data not found." };
  }
  
  switch (resourceType) {
    case "cc":
      if ((user.cc || 0) < amount) {
        return { valid: false, error: `Insufficient CC. You have ${user.cc || 0}, need ${amount}.` };
      }
      break;
      
    case "tp":
      if ((user.tp || 0) < amount) {
        return { valid: false, error: `Insufficient TP. You have ${user.tp || 0}, need ${amount}.` };
      }
      break;
      
    case "pokemon":
      const pokemonCount = user.pokemon?.[amount] || 0;
      if (pokemonCount === 0) {
        return { valid: false, error: "You don't own this Pokémon." };
      }
      break;
      
    case "trainer":
      if (!user.trainers?.[amount]) {
        return { valid: false, error: "You don't own this Trainer." };
      }
      break;
      
    default:
      return { valid: false, error: "Invalid resource type." };
  }
  
  return { valid: true, error: null };
}

/**
 * Validate cooldown
 * @param {number} lastUsed - Timestamp of last use
 * @param {number} cooldownMs - Cooldown duration in milliseconds
 * @returns {object} { valid: boolean, error: string|null, nextAvailable: Date|null }
 */
export function validateCooldown(lastUsed, cooldownMs) {
  const now = Date.now();
  const timeSinceUse = now - (lastUsed || 0);
  
  if (timeSinceUse < cooldownMs) {
    const nextAvailable = new Date(lastUsed + cooldownMs);
    return {
      valid: false,
      error: `⏰ You already claimed this!\nNext available: **${nextAvailable.toLocaleString()}**`,
      nextAvailable
    };
  }
  
  return { valid: true, error: null, nextAvailable: null };
}

/**
 * Validate that a user is not gifting to themselves
 * @param {string} senderId - Sender's user ID
 * @param {string} receiverId - Receiver's user ID
 * @returns {object} { valid: boolean, error: string|null }
 */
export function validateNotSelf(senderId, receiverId) {
  if (senderId === receiverId) {
    return { valid: false, error: "⚠️ You can't perform this action on yourself." };
  }
  return { valid: true, error: null };
}

/**
 * Validate rarity filter value
 * @param {string} rarity - Rarity value
 * @returns {object} { valid: boolean, error: string|null, sanitized: string }
 */
export function validateRarity(rarity) {
  const validRarities = ["all", "common", "uncommon", "rare", "epic", "legendary", "mythic"];
  const normalized = rarity?.toLowerCase() || "all";
  
  if (!validRarities.includes(normalized)) {
    return { 
      valid: false, 
      error: `Invalid rarity. Must be one of: ${validRarities.join(", ")}`,
      sanitized: "all"
    };
  }
  
  return { valid: true, error: null, sanitized: normalized };
}

/**
 * Validate ownership filter
 * @param {string} ownership - Ownership filter value
 * @returns {object} { valid: boolean, error: string|null, sanitized: string }
 */
export function validateOwnership(ownership) {
  const validValues = ["all", "owned", "unowned"];
  const normalized = ownership?.toLowerCase() || "owned";
  
  if (!validValues.includes(normalized)) {
    return {
      valid: false,
      error: `Invalid ownership filter. Must be one of: ${validValues.join(", ")}`,
      sanitized: "owned"
    };
  }
  
  return { valid: true, error: null, sanitized: normalized };
}

/**
 * Validate generation filter
 * @param {number} generation - Generation number
 * @param {number} maxGen - Maximum generation available
 * @returns {object} { valid: boolean, error: string|null }
 */
export function validateGeneration(generation, maxGen = 9) {
  if (!Number.isInteger(generation)) {
    return { valid: false, error: "Generation must be a whole number." };
  }
  
  if (generation < 1 || generation > maxGen) {
    return { valid: false, error: `Generation must be between 1 and ${maxGen}.` };
  }
  
  return { valid: true, error: null };
}