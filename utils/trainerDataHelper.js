// ==========================================================
// trainerDataHelper.js
// Centralized helper for trainer data schema initialization
// and management
// ==========================================================

import { 
  validateUserSchema, 
  validateTrainerData,
  createDefaultUserData,
  CURRENT_SCHEMA_VERSION 
} from './schemaValidator.js';
import { migrateUserData, getSchemaVersion, stripDeprecatedFields } from './schemaMigration.js';

/**
 * Initialize or normalize a user's trainer data with default values
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username
 * @returns {object} Normalized user data object
 */
export function initializeUserSchema(userId, username = "Trainer") {
  return createDefaultUserData(userId, username);
}

/**
 * Ensure user data exists and has all required fields with comprehensive validation
 * @param {object} trainerData - Global trainer data object
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username (optional)
 * @param {object} options - Additional options { validate: boolean, migrate: boolean, debug: boolean }
 * @returns {object} User data with guaranteed schema
 */
export function ensureUserData(trainerData, userId, username = "Trainer", options = {}) {
  const { validate = true, migrate = true, debug = false } = options;

  // Create new user if doesn't exist
  if (!trainerData[userId]) {
    if (debug) console.log(`🆕 Creating new user data for ${userId}`);
    trainerData[userId] = initializeUserSchema(userId, username);
    return trainerData[userId];
  }

  const user = trainerData[userId];

  // Check for schema migration needs
  if (migrate) {
    const currentVersion = getSchemaVersion(user);
    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      if (debug) console.log(`🔄 Migrating user ${userId} from version ${currentVersion} to ${CURRENT_SCHEMA_VERSION}`);
      trainerData[userId] = migrateUserData(user, userId);
    }
  }

  // Validate and repair if needed
  if (validate) {
    const validation = validateUserSchema(trainerData[userId], userId);
    
    if (!validation.valid) {
      console.warn(`⚠️ Schema validation issues for user ${userId}:`, validation.errors);
      if (debug) {
        console.debug('Original data:', JSON.stringify(user, null, 2));
        console.debug('Corrected data:', JSON.stringify(validation.correctedData, null, 2));
      }
      trainerData[userId] = validation.correctedData;
    } else if (debug) {
      console.log(`✅ User ${userId} data validated successfully`);
    }
  } else {
    // Basic normalization without full validation
    const userData = trainerData[userId];
    userData.id ??= userId;
    userData.name ??= username;
    userData.tp ??= 0;
    userData.cc ??= 0;
    userData.rank ??= "Novice Trainer";
    userData.pokemon ??= {};
    userData.trainers ??= {};
    userData.displayedPokemon ??= [];
    userData.displayedTrainer ??= null;
    userData.onboardingComplete ??= false;
    userData.onboardingDate ??= null;
    userData.starterPokemon ??= null;
    userData.lastDaily ??= 0;
    userData.schemaVersion ??= CURRENT_SCHEMA_VERSION;
  }

  return trainerData[userId];
}

/**
 * Normalize all users in trainer data with comprehensive validation
 * @param {object} trainerData - Global trainer data object
 * @param {object} options - Options { validate: boolean, migrate: boolean, repair: boolean }
 * @returns {object} Normalized trainer data
 */
export function normalizeAllUsers(trainerData, options = {}) {
  const { validate = true, migrate = true, repair = true } = options;

  if (typeof trainerData !== 'object' || trainerData === null) {
    console.error('❌ Invalid trainerData object');
    return {};
  }

  // If full validation requested, use comprehensive validator
  if (validate && repair) {
    const validation = validateTrainerData(trainerData);
    
    if (!validation.valid) {
      console.warn(`⚠️ TrainerData validation found ${validation.errors.length} issues`);
      console.log(`🔧 Repaired ${validation.stats.repairedUsers} user records`);
    }
    
    return validation.correctedData;
  }

  // Otherwise, basic normalization for each user
  for (const [id, user] of Object.entries(trainerData)) {
    if (typeof user !== 'object' || user === null) {
      console.warn(`⚠️ User ${id} has invalid data, creating default`);
      trainerData[id] = initializeUserSchema(id, 'Trainer');
      continue;
    }

    // Migrate if needed
    if (migrate) {
      const currentVersion = getSchemaVersion(user);
      if (currentVersion < CURRENT_SCHEMA_VERSION) {
        trainerData[id] = migrateUserData(user, id);
        continue;
      }
    }

    // Basic field normalization
    user.id ??= id;
    user.name ??= "Trainer";
    user.tp ??= 0;
    user.cc ??= 0;
    user.rank ??= "Novice Trainer";
    user.pokemon ??= {};
    user.trainers ??= {};
    user.displayedPokemon ??= [];
    user.displayedTrainer ??= null;
    user.lastDaily ??= 0;
    user.schemaVersion ??= CURRENT_SCHEMA_VERSION;
  }

  return trainerData;
}

/**
 * Sanitize trainer data before saving
 * Performs comprehensive validation and cleanup
 * @param {object} trainerData - Trainer data to sanitize
 * @returns {object} Sanitized trainer data ready for save
 */
export function sanitizeBeforeSave(trainerData) {
  console.log('🧹 Sanitizing trainer data before save...');
  
  // First, strip any deprecated fields
  const stripped = stripDeprecatedFields(trainerData);
  console.log('✅ Deprecated fields stripped from all users');
  
  // Then validate and repair
  const validation = validateTrainerData(stripped);
  
  if (!validation.valid) {
    console.warn(`⚠️ Found ${validation.errors.length} validation issues during sanitization`);
    console.log(`📊 Stats: ${validation.stats.validUsers} valid, ${validation.stats.repairedUsers} repaired`);
  } else {
    console.log(`✅ All ${validation.stats.totalUsers} users validated successfully`);
  }

  return validation.correctedData;
}

/**
 * Deep repair of malformed trainer data
 * Attempts to recover as much valid data as possible
 * @param {object} trainerData - Trainer data to repair
 * @returns {object} { repairedData: object, stats: object }
 */
export function repairTrainerData(trainerData) {
  console.log('🔧 Starting deep repair of trainer data...');
  
  const stats = {
    totalUsers: 0,
    repairedUsers: 0,
    unreparableUsers: 0,
    issuesFixed: []
  };

  const repairedData = {};

  if (typeof trainerData !== 'object' || trainerData === null) {
    console.error('❌ TrainerData is not a valid object, cannot repair');
    return { repairedData: {}, stats };
  }

  for (const [userId, userData] of Object.entries(trainerData)) {
    stats.totalUsers++;

    // Skip non-object entries
    if (typeof userData !== 'object' || userData === null) {
      console.warn(`⚠️ User ${userId} has non-object data, creating default`);
      repairedData[userId] = initializeUserSchema(userId, 'Trainer');
      stats.repairedUsers++;
      stats.issuesFixed.push(`${userId}: Non-object data replaced with default`);
      continue;
    }

    // Migrate to current version
    let migrated = migrateUserData(userData, userId);

    // Validate and repair
    const validation = validateUserSchema(migrated, userId);
    
    if (validation.valid) {
      repairedData[userId] = validation.correctedData;
    } else {
      repairedData[userId] = validation.correctedData;
      stats.repairedUsers++;
      stats.issuesFixed.push(`${userId}: ${validation.errors.length} issues fixed`);
    }

    // Additional sanity checks beyond schema validation:
    // - Ensure pokemon counts are non-negative integers
    // - Ensure trainer values are boolean or object (not strings/numbers)
    // - Ensure displayedPokemon is a proper array
    
    const repairedUser = repairedData[userId];
    
    // Ensure pokemon records have valid format { normal: count, shiny: count }
    if (repairedUser.pokemon) {
      const pokemonCollection = repairedUser.pokemon;
      for (const [pokemonId, countOrRecord] of Object.entries(pokemonCollection)) {
        // Handle both new and legacy formats
        if (typeof countOrRecord === 'object' && countOrRecord !== null && !Array.isArray(countOrRecord)) {
          // New format validation
          const record = countOrRecord;
          let fixed = false;
          
          if (!Number.isInteger(record.normal) || record.normal < 0) {
            record.normal = Math.max(0, parseInt(record.normal) || 0);
            fixed = true;
          }
          
          if (!Number.isInteger(record.shiny) || record.shiny < 0) {
            record.shiny = Math.max(0, parseInt(record.shiny) || 0);
            fixed = true;
          }
          
          if (fixed) {
            stats.issuesFixed.push(`${userId}: Fixed pokemon ${pokemonId} counts`);
          }
        } else if (typeof countOrRecord === 'number' && !isNaN(countOrRecord)) {
          // Legacy format - convert to new format (handles both integers and floats)
          const normalizedCount = Math.max(0, parseInt(countOrRecord) || 0);
          pokemonCollection[pokemonId] = { normal: normalizedCount, shiny: 0 };
          stats.issuesFixed.push(`${userId}: Converted pokemon ${pokemonId} to new format`);
        } else {
          // Invalid format
          pokemonCollection[pokemonId] = { normal: 0, shiny: 0 };
          stats.issuesFixed.push(`${userId}: Fixed invalid pokemon ${pokemonId} data`);
        }
      }
    }

    // Ensure trainers are valid (boolean or object, not strings/numbers)
    if (repairedUser.trainers && typeof repairedUser.trainers === 'object') {
      const trainersCollection = repairedUser.trainers;
      for (const [trainerName, value] of Object.entries(trainersCollection)) {
        if (typeof value !== 'boolean' && typeof value !== 'object') {
          trainersCollection[trainerName] = Boolean(value);
          stats.issuesFixed.push(`${userId}: Fixed trainer ${trainerName} value`);
        }
      }
    }

    // Ensure displayedPokemon is a valid array
    if (!Array.isArray(repairedUser.displayedPokemon)) {
      repairedUser.displayedPokemon = [];
      stats.issuesFixed.push(`${userId}: Fixed displayedPokemon array`);
    }
  }

  console.log(`✅ Repair complete: ${stats.repairedUsers}/${stats.totalUsers} users repaired`);
  
  return { repairedData, stats };
}
