// ==========================================================
// test-schema-migration.js
// Unit tests for schema migration system
// Run with: node test-schema-migration.js
// ==========================================================

import assert from 'assert';
import {
  getSchemaVersion,
  migrateUserData,
  migrateTrainerData,
  checkMigrationNeeded
} from './utils/schemaMigration.js';
import { createDefaultUserData, CURRENT_SCHEMA_VERSION } from './utils/schemaValidator.js';

let testsPassed = 0;
let testsFailed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`✅ ${description}`);
    testsPassed++;
  } catch (error) {
    console.error(`❌ ${description}`);
    console.error(`   Error: ${error.message}`);
    testsFailed++;
  }
}

console.log('\n🧪 Running Schema Migration Tests\n');
console.log('='.repeat(60));

// ========== getSchemaVersion Tests ==========
console.log('\n📋 getSchemaVersion Tests:');

test('getSchemaVersion: returns version from data', () => {
  const userData = { schemaVersion: 1 };
  assert.strictEqual(getSchemaVersion(userData), 1);
});

test('getSchemaVersion: returns 0 for legacy data without version', () => {
  const userData = { id: '12345', name: 'Test' };
  assert.strictEqual(getSchemaVersion(userData), 0);
});

test('getSchemaVersion: returns 0 for null', () => {
  assert.strictEqual(getSchemaVersion(null), 0);
});

// ========== migrateUserData Tests ==========
console.log('\n📋 migrateUserData Tests:');

test('migrateUserData: migrates legacy data to v1', () => {
  const legacyData = {
    id: '12345',
    name: 'TestUser',
    tp: 100,
    cc: 50
  };
  const migrated = migrateUserData(legacyData, '12345');
  assert.strictEqual(migrated.schemaVersion, 1);
  assert.strictEqual(migrated.id, '12345');
  assert.strictEqual(migrated.tp, 100);
  assert.deepStrictEqual(migrated.pokemon, {});
  assert.deepStrictEqual(migrated.trainers, {});
});

test('migrateUserData: preserves existing valid data', () => {
  const userData = createDefaultUserData('12345', 'TestUser');
  userData.tp = 500;
  userData.pokemon = { 'pikachu': 3 };
  const migrated = migrateUserData(userData, '12345');
  assert.strictEqual(migrated.tp, 500);
  assert.deepStrictEqual(migrated.pokemon, { 'pikachu': 3 });
});

test('migrateUserData: handles missing fields', () => {
  const partialData = {
    id: '12345'
  };
  const migrated = migrateUserData(partialData, '12345');
  assert.strictEqual(migrated.name, 'Trainer');
  assert.strictEqual(migrated.tp, 0);
  assert.strictEqual(migrated.cc, 0);
});

test('migrateUserData: up-to-date data unchanged', () => {
  const currentData = createDefaultUserData('12345', 'TestUser');
  const migrated = migrateUserData(currentData, '12345');
  assert.strictEqual(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepStrictEqual(migrated, currentData);
});

// ========== migrateTrainerData Tests ==========
console.log('\n📋 migrateTrainerData Tests:');

test('migrateTrainerData: migrates multiple users', () => {
  const trainerData = {
    '12345': { id: '12345', name: 'User1', tp: 100 }, // legacy
    '67890': createDefaultUserData('67890', 'User2')  // current
  };
  const result = migrateTrainerData(trainerData);
  assert.strictEqual(result.stats.totalUsers, 2);
  assert.strictEqual(result.stats.migratedUsers, 1);
  assert.strictEqual(result.stats.upToDateUsers, 1);
  assert.strictEqual(result.migratedData['12345'].schemaVersion, CURRENT_SCHEMA_VERSION);
});

test('migrateTrainerData: handles empty object', () => {
  const result = migrateTrainerData({});
  assert.strictEqual(result.stats.totalUsers, 0);
  assert.strictEqual(result.stats.migratedUsers, 0);
});

test('migrateTrainerData: tracks version distribution', () => {
  const trainerData = {
    '12345': { id: '12345' }, // v0
    '67890': createDefaultUserData('67890', 'User2') // v1
  };
  const result = migrateTrainerData(trainerData);
  assert.strictEqual(result.stats.versionDistribution[0], 1);
  assert.strictEqual(result.stats.versionDistribution[CURRENT_SCHEMA_VERSION], 1);
});

// ========== checkMigrationNeeded Tests ==========
console.log('\n📋 checkMigrationNeeded Tests:');

test('checkMigrationNeeded: detects migration need', () => {
  const trainerData = {
    '12345': { id: '12345' }, // legacy, needs migration
    '67890': createDefaultUserData('67890', 'User2')
  };
  const result = checkMigrationNeeded(trainerData);
  assert.strictEqual(result.needed, true);
  assert.strictEqual(result.stats.needsMigration, 1);
});

test('checkMigrationNeeded: no migration needed for current data', () => {
  const trainerData = {
    '12345': createDefaultUserData('12345', 'User1'),
    '67890': createDefaultUserData('67890', 'User2')
  };
  const result = checkMigrationNeeded(trainerData);
  assert.strictEqual(result.needed, false);
  assert.strictEqual(result.stats.needsMigration, 0);
});

test('checkMigrationNeeded: handles empty object', () => {
  const result = checkMigrationNeeded({});
  assert.strictEqual(result.needed, false);
  assert.strictEqual(result.stats.totalUsers, 0);
});

// ========== Summary ==========
console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary:');
console.log(`   ✅ Passed: ${testsPassed}`);
console.log(`   ❌ Failed: ${testsFailed}`);
console.log(`   Total: ${testsPassed + testsFailed}`);
console.log('='.repeat(60));

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!\n');
  process.exit(0);
}
