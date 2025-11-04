// ==========================================================
// schemaValidator.js
// Comprehensive schema validation and versioning system
// ==========================================================

/**
 * Current schema version
 * Increment this when making breaking changes to the schema
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Define the expected schema structure for user data
 */
export const USER_SCHEMA = {
  id: { type: 'string', required: true },
  name: { type: 'string', required: true, default: 'Trainer' },
  tp: { type: 'number', required: true, default: 0, min: 0 },
  cc: { type: 'number', required: true, default: 0, min: 0 },
  rank: { type: 'string', required: true, default: 'Novice Trainer' },
  pokemon: { type: 'object', required: true, default: {} },
  trainers: { type: 'object', required: true, default: {} },
  displayedPokemon: { type: 'array', required: true, default: [] },
  displayedTrainer: { type: 'any', required: false, default: null },
  lastDaily: { type: 'number', required: true, default: 0, min: 0 },
  schemaVersion: { type: 'number', required: false, default: CURRENT_SCHEMA_VERSION }
};

/**
 * Validate a single field against schema definition
 * @param {any} value - The value to validate
 * @param {object} schema - Schema definition for the field
 * @param {string} fieldName - Name of the field being validated
 * @returns {object} { valid: boolean, error: string|null, correctedValue: any }
 */
export function validateField(value, schema, fieldName) {
  const errors = [];
  let correctedValue = value;

  // Handle null/undefined values
  if (value === null || value === undefined) {
    if (schema.required) {
      errors.push(`Field '${fieldName}' is required but was ${value === null ? 'null' : 'undefined'}`);
      correctedValue = schema.default;
    } else {
      correctedValue = schema.default ?? null;
    }
    return { valid: errors.length === 0, error: errors.join('; '), correctedValue };
  }

  // Type validation
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (schema.type !== 'any' && actualType !== schema.type) {
    errors.push(`Field '${fieldName}' expected type '${schema.type}' but got '${actualType}'`);
    correctedValue = schema.default;
    return { valid: false, error: errors.join('; '), correctedValue };
  }

  // Number validations
  if (schema.type === 'number') {
    if (!Number.isFinite(correctedValue)) {
      errors.push(`Field '${fieldName}' must be a finite number`);
      correctedValue = schema.default ?? 0;
    } else {
      if (schema.min !== undefined && correctedValue < schema.min) {
        errors.push(`Field '${fieldName}' value ${correctedValue} is below minimum ${schema.min}`);
        correctedValue = schema.min;
      }
      if (schema.max !== undefined && correctedValue > schema.max) {
        errors.push(`Field '${fieldName}' value ${correctedValue} exceeds maximum ${schema.max}`);
        correctedValue = schema.max;
      }
    }
  }

  // String validations
  if (schema.type === 'string') {
    if (typeof correctedValue !== 'string') {
      errors.push(`Field '${fieldName}' must be a string`);
      correctedValue = String(schema.default ?? '');
    } else if (schema.minLength && correctedValue.length < schema.minLength) {
      errors.push(`Field '${fieldName}' length ${correctedValue.length} is below minimum ${schema.minLength}`);
      correctedValue = schema.default;
    }
  }

  // Object validation
  if (schema.type === 'object') {
    if (typeof correctedValue !== 'object' || Array.isArray(correctedValue) || correctedValue === null) {
      errors.push(`Field '${fieldName}' must be a plain object`);
      correctedValue = schema.default ?? {};
    }
  }

  // Array validation
  if (schema.type === 'array') {
    if (!Array.isArray(correctedValue)) {
      errors.push(`Field '${fieldName}' must be an array`);
      correctedValue = schema.default ?? [];
    }
  }

  return { valid: errors.length === 0, error: errors.length > 0 ? errors.join('; ') : null, correctedValue };
}

/**
 * Validate entire user data object against schema
 * @param {object} userData - User data to validate
 * @param {string} userId - User ID for logging
 * @returns {object} { valid: boolean, errors: array, correctedData: object }
 */
export function validateUserSchema(userData, userId = 'unknown') {
  const errors = [];
  const correctedData = { ...userData };

  // Ensure userData is an object
  if (typeof userData !== 'object' || userData === null || Array.isArray(userData)) {
    errors.push(`User data for ${userId} is not a valid object`);
    return { valid: false, errors, correctedData: createDefaultUserData(userId) };
  }

  // Validate each field in the schema
  for (const [fieldName, fieldSchema] of Object.entries(USER_SCHEMA)) {
    const result = validateField(userData[fieldName], fieldSchema, fieldName);
    
    if (!result.valid) {
      errors.push(result.error);
    }
    
    correctedData[fieldName] = result.correctedValue;
  }

  // Preserve schemaVersion if present, otherwise set to current
  correctedData.schemaVersion = userData.schemaVersion ?? CURRENT_SCHEMA_VERSION;

  // Remove unknown fields (optional - can be configured)
  const knownFields = [...Object.keys(USER_SCHEMA), 'schemaVersion'];
  for (const key of Object.keys(userData)) {
    if (!knownFields.includes(key)) {
      console.warn(`⚠️ Unknown field '${key}' found in user ${userId} data, preserving for backwards compatibility`);
      correctedData[key] = userData[key];
    }
  }

  return { valid: errors.length === 0, errors, correctedData };
}

/**
 * Create default user data
 * @param {string} userId - User ID
 * @param {string} username - Username
 * @returns {object} Default user data object
 */
export function createDefaultUserData(userId, username = 'Trainer') {
  const defaultData = { id: userId, name: username };
  
  for (const [fieldName, fieldSchema] of Object.entries(USER_SCHEMA)) {
    if (fieldName !== 'id' && fieldName !== 'name') {
      defaultData[fieldName] = fieldSchema.default;
    }
  }
  
  defaultData.schemaVersion = CURRENT_SCHEMA_VERSION;
  return defaultData;
}

/**
 * Validate pokemon collection data
 * @param {object} pokemon - Pokemon collection object
 * @param {string} userId - User ID for logging
 * @returns {object} { valid: boolean, errors: array, correctedData: object }
 */
export function validatePokemonCollection(pokemon, userId = 'unknown') {
  const errors = [];
  const correctedData = {};

  if (typeof pokemon !== 'object' || pokemon === null || Array.isArray(pokemon)) {
    errors.push(`Pokemon collection for user ${userId} is not a valid object`);
    return { valid: false, errors, correctedData: {} };
  }

  // Validate each pokemon entry
  for (const [pokemonId, count] of Object.entries(pokemon)) {
    if (typeof pokemonId !== 'string' || pokemonId.trim() === '') {
      errors.push(`Invalid pokemon ID: '${pokemonId}'`);
      continue;
    }

    if (!Number.isInteger(count) || count < 0) {
      errors.push(`Invalid count for pokemon '${pokemonId}': ${count}`);
      correctedData[pokemonId] = Math.max(0, parseInt(count) || 0);
    } else {
      correctedData[pokemonId] = count;
    }
  }

  return { valid: errors.length === 0, errors, correctedData };
}

/**
 * Validate trainers collection data
 * @param {object} trainers - Trainers collection object
 * @param {string} userId - User ID for logging
 * @returns {object} { valid: boolean, errors: array, correctedData: object }
 */
export function validateTrainersCollection(trainers, userId = 'unknown') {
  const errors = [];
  const correctedData = {};

  if (typeof trainers !== 'object' || trainers === null || Array.isArray(trainers)) {
    errors.push(`Trainers collection for user ${userId} is not a valid object`);
    return { valid: false, errors, correctedData: {} };
  }

  // Validate each trainer entry
  for (const [trainerName, owned] of Object.entries(trainers)) {
    if (typeof trainerName !== 'string' || trainerName.trim() === '') {
      errors.push(`Invalid trainer name: '${trainerName}'`);
      continue;
    }

    // Trainers should be boolean (owned/not owned) or can be an object with metadata
    if (typeof owned === 'boolean') {
      correctedData[trainerName] = owned;
    } else if (typeof owned === 'object' && owned !== null) {
      // Preserve object structure for trainer metadata
      correctedData[trainerName] = owned;
    } else {
      errors.push(`Invalid value for trainer '${trainerName}': ${owned}`);
      correctedData[trainerName] = Boolean(owned);
    }
  }

  return { valid: errors.length === 0, errors, correctedData };
}

/**
 * Validate displayed pokemon array
 * @param {array} displayedPokemon - Array of displayed pokemon
 * @param {string} userId - User ID for logging
 * @returns {object} { valid: boolean, errors: array, correctedData: array }
 */
export function validateDisplayedPokemon(displayedPokemon, userId = 'unknown') {
  const errors = [];
  const correctedData = [];

  if (!Array.isArray(displayedPokemon)) {
    errors.push(`DisplayedPokemon for user ${userId} is not an array`);
    return { valid: false, errors, correctedData: [] };
  }

  for (const pokemon of displayedPokemon) {
    if (typeof pokemon === 'string' && pokemon.trim() !== '') {
      correctedData.push(pokemon);
    } else if (typeof pokemon === 'object' && pokemon !== null) {
      // Support both string IDs and object structures
      correctedData.push(pokemon);
    } else {
      errors.push(`Invalid pokemon in displayedPokemon: ${JSON.stringify(pokemon)}`);
    }
  }

  return { valid: errors.length === 0, errors, correctedData };
}

/**
 * Comprehensive validation of entire trainerData object
 * @param {object} trainerData - Full trainer data object
 * @returns {object} { valid: boolean, errors: array, correctedData: object, stats: object }
 */
export function validateTrainerData(trainerData) {
  const errors = [];
  const correctedData = {};
  const stats = {
    totalUsers: 0,
    validUsers: 0,
    repairedUsers: 0,
    invalidUsers: 0,
    fieldErrors: {}
  };

  if (typeof trainerData !== 'object' || trainerData === null || Array.isArray(trainerData)) {
    errors.push('TrainerData is not a valid object');
    return { valid: false, errors, correctedData: {}, stats };
  }

  // Validate each user
  for (const [userId, userData] of Object.entries(trainerData)) {
    stats.totalUsers++;
    
    const userValidation = validateUserSchema(userData, userId);
    correctedData[userId] = userValidation.correctedData;
    
    let userHasErrors = !userValidation.valid;
    
    if (!userValidation.valid) {
      // Track error types
      for (const error of userValidation.errors) {
        const fieldMatch = error.match(/Field '(\w+)'/);
        if (fieldMatch) {
          const fieldName = fieldMatch[1];
          stats.fieldErrors[fieldName] = (stats.fieldErrors[fieldName] || 0) + 1;
        }
      }
      
      errors.push(`User ${userId}: ${userValidation.errors.join('; ')}`);
    }

    // Additional nested validation
    if (correctedData[userId]) {
      // Validate pokemon collection
      const pokemonValidation = validatePokemonCollection(
        correctedData[userId].pokemon,
        userId
      );
      if (!pokemonValidation.valid) {
        correctedData[userId].pokemon = pokemonValidation.correctedData;
        errors.push(`User ${userId} pokemon: ${pokemonValidation.errors.join('; ')}`);
        userHasErrors = true;
      }

      // Validate trainers collection
      const trainersValidation = validateTrainersCollection(
        correctedData[userId].trainers,
        userId
      );
      if (!trainersValidation.valid) {
        correctedData[userId].trainers = trainersValidation.correctedData;
        errors.push(`User ${userId} trainers: ${trainersValidation.errors.join('; ')}`);
        userHasErrors = true;
      }

      // Validate displayed pokemon
      const displayedValidation = validateDisplayedPokemon(
        correctedData[userId].displayedPokemon,
        userId
      );
      if (!displayedValidation.valid) {
        correctedData[userId].displayedPokemon = displayedValidation.correctedData;
        errors.push(`User ${userId} displayedPokemon: ${displayedValidation.errors.join('; ')}`);
        userHasErrors = true;
      }
    }
    
    // Update stats based on whether user had errors
    if (userHasErrors) {
      stats.repairedUsers++;
    } else {
      stats.validUsers++;
    }
  }

  stats.invalidUsers = stats.totalUsers - stats.validUsers - stats.repairedUsers;

  return { 
    valid: errors.length === 0, 
    errors, 
    correctedData,
    stats
  };
}

/**
 * Log validation results
 * @param {object} validationResult - Result from validateTrainerData
 * @param {string} context - Context for logging (e.g., 'load', 'save')
 */
export function logValidationResults(validationResult, context = 'validation') {
  const { valid, errors, stats } = validationResult;
  
  console.log(`\n🔍 Schema Validation Report [${context}]`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Total Users: ${stats.totalUsers}`);
  console.log(`✅ Valid Users: ${stats.validUsers}`);
  console.log(`🔧 Repaired Users: ${stats.repairedUsers}`);
  console.log(`❌ Invalid Users: ${stats.invalidUsers}`);
  
  if (Object.keys(stats.fieldErrors).length > 0) {
    console.log(`\n⚠️ Field Error Summary:`);
    for (const [field, count] of Object.entries(stats.fieldErrors)) {
      console.log(`  - ${field}: ${count} users`);
    }
  }
  
  if (!valid && errors.length > 0) {
    console.log(`\n❌ Validation Errors (first 10):`);
    errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more errors`);
    }
  } else {
    console.log(`\n✅ All data validated successfully!`);
  }
  
  console.log(`${'='.repeat(50)}\n`);
}
