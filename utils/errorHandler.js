// ==========================================================
// errorHandler.js
// Enhanced error handling with retry logic and better messages
// ==========================================================

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delayMs - Initial delay in milliseconds
 * @param {string} operationName - Name of operation for logging
 * @returns {Promise<any>} Result of successful function call
 */
export async function retryWithBackoff(fn, maxRetries = 3, delayMs = 1000, operationName = "operation") {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ ${operationName} failed (attempt ${attempt}/${maxRetries}):`, error.message);
      
      if (attempt < maxRetries) {
        const waitTime = delayMs * Math.pow(2, attempt - 1);
        console.log(`⏳ Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  console.error(`❌ ${operationName} failed after ${maxRetries} attempts:`, lastError);
  throw lastError;
}

/**
 * Safely execute an async operation with error handling
 * @param {Function} fn - Async function to execute
 * @param {string} errorMessage - User-friendly error message
 * @param {any} fallbackValue - Value to return on error
 * @returns {Promise<any>} Result or fallback value
 */
export async function safeExecute(fn, errorMessage = "An error occurred", fallbackValue = null) {
  try {
    return await fn();
  } catch (error) {
    console.error(`❌ ${errorMessage}:`, error);
    return fallbackValue;
  }
}

/**
 * Create a standardized error response for interactions
 * @param {object} interaction - Discord interaction
 * @param {string} message - Error message
 * @param {boolean} ephemeral - Whether to make response ephemeral
 */
export async function replyWithError(interaction, message, ephemeral = true) {
  const content = `❌ ${message}`;
  
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, ephemeral });
    } else {
      await interaction.reply({ content, ephemeral });
    }
  } catch (error) {
    console.error("Failed to send error response:", error);
  }
}

/**
 * Handle command execution errors consistently
 * @param {Error} error - The error object
 * @param {object} interaction - Discord interaction
 * @param {string} commandName - Name of the command
 */
export async function handleCommandError(error, interaction, commandName = "command") {
  console.error(`❌ Error in ${commandName}:`, error);
  
  const userMessage = error.message.includes("Unknown") || error.message.includes("Invalid")
    ? error.message
    : "An unexpected error occurred. Please try again later.";
  
  await replyWithError(interaction, userMessage);
}
