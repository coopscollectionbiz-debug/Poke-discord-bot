#!/usr/bin/env node
// ==========================================================
// cleanupTrainerData.js
// One-time cleanup script to remove deprecated fields from trainerData.json
// ==========================================================

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { USER_SCHEMA } from './utils/schemaValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRAINERDATA_PATH = path.join(__dirname, 'trainerData.json');
const BACKUP_PATH = path.join(__dirname, `trainerData.backup.${Date.now()}.json`);

// Valid fields from USER_SCHEMA in utils/schemaValidator.js
// Dynamically generated to stay in sync with schema changes
const VALID_FIELDS = Object.keys(USER_SCHEMA);

/**
 * Main cleanup function
 */
async function cleanupTrainerData() {
  console.log('🔧 Starting trainerData cleanup...');
  console.log('='.repeat(60));
  
  let trainerData;

  // Step 1: Load trainerData.json
  console.log('\n📂 Loading trainerData.json...');
  try {
    const rawTrainerData = await fs.readFile(TRAINERDATA_PATH, 'utf8');
    trainerData = JSON.parse(rawTrainerData);
    console.log(`✅ Loaded ${Object.keys(trainerData).length} user records.`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('❌ trainerData.json not found');
      console.log('💡 This script should be run in the bot directory where trainerData.json exists');
      process.exit(1);
    } else if (err instanceof SyntaxError) {
      console.error('❌ trainerData.json contains invalid JSON');
      console.log('💡 Manual intervention may be required to fix JSON syntax errors');
      process.exit(1);
    }
    console.error('❌ Failed to load trainerData.json:', err.message);
    process.exit(1);
  }

  // Step 2: Create backup
  console.log('\n💾 Creating backup...');
  try {
    await fs.writeFile(BACKUP_PATH, JSON.stringify(trainerData, null, 2));
    console.log(`✅ Backup created: ${BACKUP_PATH}`);
  } catch (err) {
    console.error('❌ Failed to create backup:', err.message);
    console.log('⚠️ Aborting to prevent data loss');
    process.exit(1);
  }

  // Step 3: Clean up deprecated fields
  console.log('\n🧹 Cleaning up deprecated fields...');
  let cleanedCount = 0;
  let removedFieldsCount = 0;
  const removedFieldsSummary = {};

  for (const [userId, userData] of Object.entries(trainerData)) {
    // Skip if userData is not an object
    if (typeof userData !== 'object' || userData === null) {
      console.warn(`⚠️ User ${userId} has invalid data (not an object), skipping`);
      continue;
    }

    const removedFields = [];
    for (const key in userData) {
      if (!VALID_FIELDS.includes(key)) {
        removedFields.push(key);
        // Track field frequency for summary
        removedFieldsSummary[key] = (removedFieldsSummary[key] || 0) + 1;
        delete userData[key];
      }
    }
    
    if (removedFields.length > 0) {
      console.log(`⚠️ Cleaned user ${userId}: Removed fields -> ${removedFields.join(', ')}`);
      removedFieldsCount += removedFields.length;
      cleanedCount++;
    }
  }

  console.log(`\n✅ Cleanup complete: Cleaned ${cleanedCount} users, removed ${removedFieldsCount} deprecated fields.`);
  
  if (Object.keys(removedFieldsSummary).length > 0) {
    console.log('\n📊 Deprecated fields removed (field: count):');
    for (const [field, count] of Object.entries(removedFieldsSummary)) {
      console.log(`  - ${field}: ${count} users`);
    }
  }

  // Step 4: Save updated trainerData.json
  console.log('\n💾 Saving updated trainerData.json...');
  try {
    await fs.writeFile(TRAINERDATA_PATH, JSON.stringify(trainerData, null, 2));
    console.log('✅ trainerData.json updated successfully!');
  } catch (err) {
    console.error('❌ Failed to save updated trainerData.json:', err.message);
    console.log(`⚠️ Your backup is safe at: ${BACKUP_PATH}`);
    process.exit(1);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 CLEANUP SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Users: ${Object.keys(trainerData).length}`);
  console.log(`Users Cleaned: ${cleanedCount}`);
  console.log(`Deprecated Fields Removed: ${removedFieldsCount}`);
  console.log(`Backup Location: ${BACKUP_PATH}`);
  console.log('='.repeat(60));
  
  if (cleanedCount === 0) {
    console.log('\n✅ No deprecated fields found - data is already clean!');
  } else {
    console.log('\n✅ SUCCESS: Deprecated fields removed successfully!');
    console.log('💡 Review the backup file if you need to restore any data');
  }
}

// Run the script
cleanupTrainerData().catch((err) => {
  console.error('\n❌ Unexpected error during cleanup:', err.message);
  console.error(err.stack);
  process.exit(1);
});
