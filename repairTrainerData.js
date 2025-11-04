#!/usr/bin/env node
// ==========================================================
// repairTrainerData.js
// One-time script to clean and repair corrupted trainerData.json
// ==========================================================

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  validateTrainerData, 
  logValidationResults 
} from './utils/schemaValidator.js';
import { 
  migrateTrainerData, 
  logMigrationResults,
  createMigrationBackup 
} from './utils/schemaMigration.js';
import { 
  repairTrainerData,
  sanitizeBeforeSave 
} from './utils/trainerDataHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRAINERDATA_PATH = path.join(__dirname, 'trainerData.json');
const BACKUP_PATH = path.join(__dirname, `trainerData.backup.${Date.now()}.json`);

/**
 * Main repair function
 */
async function main() {
  console.log('🔧 TrainerData Repair Script');
  console.log('='.repeat(60));
  console.log(`Source: ${TRAINERDATA_PATH}`);
  console.log(`Backup: ${BACKUP_PATH}`);
  console.log('='.repeat(60));

  let trainerData;

  // Step 1: Load existing data
  console.log('\n📂 Step 1: Loading trainer data...');
  try {
    const raw = await fs.readFile(TRAINERDATA_PATH, 'utf8');
    trainerData = JSON.parse(raw);
    console.log(`✅ Loaded ${Object.keys(trainerData).length} user records`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('❌ trainerData.json not found');
      console.log('💡 This script should be run in the bot directory where trainerData.json exists');
      process.exit(1);
    } else if (error instanceof SyntaxError) {
      console.error('❌ trainerData.json contains invalid JSON');
      console.log('💡 Manual intervention may be required to fix JSON syntax errors');
      process.exit(1);
    }
    throw error;
  }

  // Step 2: Create backup
  console.log('\n💾 Step 2: Creating backup...');
  try {
    await fs.writeFile(BACKUP_PATH, JSON.stringify(trainerData, null, 2));
    console.log(`✅ Backup created: ${BACKUP_PATH}`);
  } catch (error) {
    console.error('❌ Failed to create backup:', error.message);
    console.log('⚠️ Aborting to prevent data loss');
    process.exit(1);
  }

  // Step 3: Initial validation
  console.log('\n🔍 Step 3: Running initial validation...');
  const initialValidation = validateTrainerData(trainerData);
  logValidationResults(initialValidation, 'initial');

  const initialErrors = initialValidation.errors.length;
  const initialStats = initialValidation.stats;

  // Step 4: Migration
  console.log('\n🔄 Step 4: Running schema migrations...');
  const migrationResult = migrateTrainerData(trainerData);
  logMigrationResults(migrationResult.stats);
  trainerData = migrationResult.migratedData;

  // Step 5: Repair
  console.log('\n🔧 Step 5: Running deep repair...');
  const repairResult = repairTrainerData(trainerData);
  console.log(`\n📊 Repair Statistics:`);
  console.log(`  Total Users: ${repairResult.stats.totalUsers}`);
  console.log(`  Repaired: ${repairResult.stats.repairedUsers}`);
  console.log(`  Unrepairable: ${repairResult.stats.unreparableUsers}`);
  
  if (repairResult.stats.issuesFixed.length > 0) {
    console.log(`\n🔧 Issues Fixed (first 20):`);
    repairResult.stats.issuesFixed.slice(0, 20).forEach(issue => {
      console.log(`  - ${issue}`);
    });
    if (repairResult.stats.issuesFixed.length > 20) {
      console.log(`  ... and ${repairResult.stats.issuesFixed.length - 20} more`);
    }
  }

  trainerData = repairResult.repairedData;

  // Step 6: Final validation
  console.log('\n✅ Step 6: Running final validation...');
  const finalValidation = validateTrainerData(trainerData);
  logValidationResults(finalValidation, 'final');

  // Step 7: Sanitize before save
  console.log('\n🧹 Step 7: Final sanitization...');
  const sanitized = sanitizeBeforeSave(trainerData);

  // Step 8: Save repaired data
  console.log('\n💾 Step 8: Saving repaired data...');
  try {
    await fs.writeFile(
      TRAINERDATA_PATH, 
      JSON.stringify(sanitized, null, 2)
    );
    console.log(`✅ Repaired data saved to ${TRAINERDATA_PATH}`);
  } catch (error) {
    console.error('❌ Failed to save repaired data:', error.message);
    console.log(`⚠️ Your backup is safe at: ${BACKUP_PATH}`);
    process.exit(1);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 REPAIR SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Users: ${initialStats.totalUsers}`);
  console.log(`Initial Errors: ${initialErrors}`);
  console.log(`Final Errors: ${finalValidation.errors.length}`);
  console.log(`Errors Fixed: ${initialErrors - finalValidation.errors.length}`);
  console.log(`Users Migrated: ${migrationResult.stats.migratedUsers}`);
  console.log(`Users Repaired: ${repairResult.stats.repairedUsers}`);
  
  if (finalValidation.valid) {
    console.log('\n✅ SUCCESS: All data is now valid!');
  } else {
    console.log('\n⚠️ WARNING: Some issues remain, but data has been improved');
    console.log(`Remaining errors: ${finalValidation.errors.length}`);
  }
  
  console.log(`\n💾 Backup location: ${BACKUP_PATH}`);
  console.log('='.repeat(60));
}

// Run the script
main().catch(error => {
  console.error('\n❌ FATAL ERROR:', error);
  process.exit(1);
});
