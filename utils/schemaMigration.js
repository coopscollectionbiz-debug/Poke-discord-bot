// ==========================================================
// schemaMigration.js
// Schema versioning and migration helpers
// ==========================================================

import { CURRENT_SCHEMA_VERSION, createDefaultUserData } from './schemaValidator.js';

/**
 * Migration functions for each schema version
 * Each migration should be idempotent and handle partial states
 */
const MIGRATIONS = {
  // Migration from version 0 (no version) to version 1
  0: (userData, userId) => {
    console.log(`📦 Migrating user ${userId} from v0 to v1`);
    
    // Ensure all required fields exist with defaults
    const migrated = {
      ...userData,
      id: userData.id || userId,
      name: userData.name || 'Trainer',
      tp: typeof userData.tp === 'number' ? userData.tp : 0,
      cc: typeof userData.cc === 'number' ? userData.cc : 0,
      rank: userData.rank || 'Novice Trainer',
      pokemon: typeof userData.pokemon === 'object' && !Array.isArray(userData.pokemon) 
        ? userData.pokemon 
        : {},
      trainers: typeof userData.trainers === 'object' && !Array.isArray(userData.trainers)
        ? userData.trainers
        : {},
      displayedPokemon: Array.isArray(userData.displayedPokemon)
        ? userData.displayedPokemon
        : [],
      displayedTrainer: userData.displayedTrainer ?? null,
      lastDaily: typeof userData.lastDaily === 'number' ? userData.lastDaily : 0,
      schemaVersion: 1
    };

    return migrated;
  }
  
  // Future migrations would be added here:
  // 1: (userData, userId) => { ... migrate from v1 to v2 ... },
  // 2: (userData, userId) => { ... migrate from v2 to v3 ... },
};

/**
 * Get the schema version of user data
 * @param {object} userData - User data object
 * @returns {number} Schema version (0 if not specified)
 */
export function getSchemaVersion(userData) {
  if (typeof userData?.schemaVersion === 'number') {
    return userData.schemaVersion;
  }
  return 0; // Legacy data without version
}

/**
 * Migrate user data to current schema version
 * @param {object} userData - User data to migrate
 * @param {string} userId - User ID for logging
 * @returns {object} Migrated user data
 */
export function migrateUserData(userData, userId = 'unknown') {
  let currentVersion = getSchemaVersion(userData);
  let migrated = { ...userData };

  // Apply migrations sequentially
  while (currentVersion < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS[currentVersion];
    
    if (!migration) {
      console.warn(`⚠️ No migration defined for version ${currentVersion}, using default data`);
      migrated = createDefaultUserData(userId, userData?.name);
      break;
    }

    try {
      migrated = migration(migrated, userId);
      currentVersion++;
    } catch (error) {
      console.error(`❌ Migration failed for user ${userId} at version ${currentVersion}:`, error);
      migrated = createDefaultUserData(userId, userData?.name);
      break;
    }
  }

  return migrated;
}

/**
 * Migrate entire trainer data object
 * @param {object} trainerData - Full trainer data object
 * @returns {object} { migratedData: object, stats: object }
 */
export function migrateTrainerData(trainerData) {
  const stats = {
    totalUsers: 0,
    migratedUsers: 0,
    upToDateUsers: 0,
    failedUsers: 0,
    versionDistribution: {}
  };

  const migratedData = {};

  if (typeof trainerData !== 'object' || trainerData === null) {
    console.error('❌ Invalid trainerData object for migration');
    return { migratedData: {}, stats };
  }

  for (const [userId, userData] of Object.entries(trainerData)) {
    stats.totalUsers++;
    
    const version = getSchemaVersion(userData);
    stats.versionDistribution[version] = (stats.versionDistribution[version] || 0) + 1;

    try {
      if (version < CURRENT_SCHEMA_VERSION) {
        migratedData[userId] = migrateUserData(userData, userId);
        stats.migratedUsers++;
      } else {
        migratedData[userId] = userData;
        stats.upToDateUsers++;
      }
    } catch (error) {
      console.error(`❌ Failed to migrate user ${userId}:`, error);
      migratedData[userId] = createDefaultUserData(userId, userData?.name);
      stats.failedUsers++;
    }
  }

  return { migratedData, stats };
}

/**
 * Check if migration is needed for trainer data
 * @param {object} trainerData - Full trainer data object
 * @returns {object} { needed: boolean, stats: object }
 */
export function checkMigrationNeeded(trainerData) {
  const stats = {
    totalUsers: 0,
    needsMigration: 0,
    versionDistribution: {}
  };

  if (typeof trainerData !== 'object' || trainerData === null) {
    return { needed: false, stats };
  }

  for (const userData of Object.values(trainerData)) {
    stats.totalUsers++;
    const version = getSchemaVersion(userData);
    stats.versionDistribution[version] = (stats.versionDistribution[version] || 0) + 1;

    if (version < CURRENT_SCHEMA_VERSION) {
      stats.needsMigration++;
    }
  }

  return { needed: stats.needsMigration > 0, stats };
}

/**
 * Log migration results
 * @param {object} stats - Migration statistics
 */
export function logMigrationResults(stats) {
  console.log(`\n📦 Schema Migration Report`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Total Users: ${stats.totalUsers}`);
  console.log(`✅ Up-to-date: ${stats.upToDateUsers}`);
  console.log(`🔄 Migrated: ${stats.migratedUsers}`);
  console.log(`❌ Failed: ${stats.failedUsers}`);
  
  console.log(`\n📊 Version Distribution:`);
  const versions = Object.keys(stats.versionDistribution).sort((a, b) => a - b);
  for (const version of versions) {
    const count = stats.versionDistribution[version];
    const label = version == CURRENT_SCHEMA_VERSION ? '(current)' : '';
    console.log(`  Version ${version}: ${count} users ${label}`);
  }
  
  console.log(`${'='.repeat(50)}\n`);
}

/**
 * Create a backup before migration
 * @param {object} trainerData - Data to backup
 * @returns {object} Deep copy of trainer data
 */
export function createMigrationBackup(trainerData) {
  return JSON.parse(JSON.stringify(trainerData));
}
