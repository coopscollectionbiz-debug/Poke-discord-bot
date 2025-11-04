// ==========================================================
// test-trainer-data-helper.js
// Unit tests for trainer data helper functions
// Run with: node test-trainer-data-helper.js
// ==========================================================

import assert from 'assert';
import {
  initializeUserSchema,
  ensureUserData,
  normalizeAllUsers,
  sanitizeBeforeSave,
  repairTrainerData
} from './utils/trainerDataHelper.js';
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

console.log('\n🧪 Running Trainer Data Helper Tests\n');
console.log('='.repeat(60));

// ========== initializeUserSchema Tests ==========
console.log('\n📋 initializeUserSchema Tests:');

test('initializeUserSchema: creates valid schema', () => {
  const data = initializeUserSchema('12345', 'TestUser');
  assert.strictEqual(data.id, '12345');
  assert.strictEqual(data.name, 'TestUser');
  assert.strictEqual(data.tp, 0);
  assert.strictEqual(data.cc, 0);
  assert.strictEqual(data.schemaVersion, CURRENT_SCHEMA_VERSION);
});

test('initializeUserSchema: uses default name', () => {
  const data = initializeUserSchema('12345');
  assert.strictEqual(data.name, 'Trainer');
});

// ========== ensureUserData Tests ==========
console.log('\n📋 ensureUserData Tests:');

test('ensureUserData: creates new user if missing', () => {
  const trainerData = {};
  const user = ensureUserData(trainerData, '12345', 'TestUser');
  assert.strictEqual(user.id, '12345');
  assert.strictEqual(user.name, 'TestUser');
  assert.strictEqual(trainerData['12345'], user);
});

test('ensureUserData: normalizes existing user', () => {
  const trainerData = {
    '12345': { id: '12345', name: 'ExistingName', tp: 100 }
  };
  const user = ensureUserData(trainerData, '12345', 'TestUser', { validate: false });
  assert.strictEqual(user.tp, 100);
  assert.strictEqual(user.name, 'ExistingName'); // Preserves existing name
  assert.strictEqual(user.cc, 0);
});

test('ensureUserData: validates and repairs user data', () => {
  const trainerData = {
    '12345': { id: '12345', tp: -100, cc: 50 }
  };
  const user = ensureUserData(trainerData, '12345', 'TestUser', { validate: true });
  assert.strictEqual(user.tp, 0); // negative corrected to min (0)
  assert.strictEqual(user.cc, 50);
});

test('ensureUserData: migrates old schema', () => {
  const trainerData = {
    '12345': { id: '12345', name: 'Test', tp: 100 } // no schemaVersion
  };
  const user = ensureUserData(trainerData, '12345', 'TestUser', { migrate: true });
  assert.strictEqual(user.schemaVersion, CURRENT_SCHEMA_VERSION);
});

// ========== normalizeAllUsers Tests ==========
console.log('\n📋 normalizeAllUsers Tests:');

test('normalizeAllUsers: normalizes all users', () => {
  const trainerData = {
    '12345': { id: '12345', tp: 100 },
    '67890': { id: '67890', cc: 50 }
  };
  const normalized = normalizeAllUsers(trainerData, { validate: false });
  assert.strictEqual(normalized['12345'].tp, 100);
  assert.strictEqual(normalized['12345'].cc, 0);
  assert.strictEqual(normalized['67890'].cc, 50);
  assert.strictEqual(normalized['67890'].tp, 0);
});

test('normalizeAllUsers: validates all users', () => {
  const trainerData = {
    '12345': createDefaultUserData('12345', 'User1'),
    '67890': { id: '67890', tp: -50 }
  };
  const normalized = normalizeAllUsers(trainerData, { validate: true, repair: true });
  assert.strictEqual(normalized['67890'].tp, 0);
});

test('normalizeAllUsers: handles empty object', () => {
  const normalized = normalizeAllUsers({});
  assert.deepStrictEqual(normalized, {});
});

test('normalizeAllUsers: handles invalid user data', () => {
  const trainerData = {
    '12345': null,
    '67890': 'not an object'
  };
  const normalized = normalizeAllUsers(trainerData, { validate: true });
  assert.strictEqual(normalized['12345'].id, '12345');
  assert.strictEqual(normalized['67890'].id, '67890');
});

// ========== sanitizeBeforeSave Tests ==========
console.log('\n📋 sanitizeBeforeSave Tests:');

test('sanitizeBeforeSave: returns sanitized data', () => {
  const trainerData = {
    '12345': createDefaultUserData('12345', 'User1'),
    '67890': { id: '67890', tp: -100 }
  };
  const sanitized = sanitizeBeforeSave(trainerData);
  assert.strictEqual(sanitized['12345'].id, '12345');
  assert.strictEqual(sanitized['67890'].tp, 0);
});

test('sanitizeBeforeSave: preserves valid data', () => {
  const trainerData = {
    '12345': createDefaultUserData('12345', 'User1')
  };
  trainerData['12345'].tp = 500;
  const sanitized = sanitizeBeforeSave(trainerData);
  assert.strictEqual(sanitized['12345'].tp, 500);
});

// ========== repairTrainerData Tests ==========
console.log('\n📋 repairTrainerData Tests:');

test('repairTrainerData: repairs malformed data', () => {
  const trainerData = {
    '12345': createDefaultUserData('12345', 'User1'),
    '67890': { id: '67890', tp: -100, pokemon: { 'pikachu': -5 } }
  };
  const result = repairTrainerData(trainerData);
  assert.strictEqual(result.repairedData['67890'].tp, 0);
  assert.strictEqual(result.repairedData['67890'].pokemon.pikachu, 0);
  assert(result.stats.repairedUsers > 0);
});

test('repairTrainerData: handles null user data', () => {
  const trainerData = {
    '12345': null
  };
  const result = repairTrainerData(trainerData);
  assert.strictEqual(result.repairedData['12345'].id, '12345');
  assert.strictEqual(result.stats.repairedUsers, 1);
});

test('repairTrainerData: fixes pokemon counts', () => {
  const trainerData = {
    '12345': createDefaultUserData('12345', 'User1')
  };
  trainerData['12345'].pokemon = { 'pikachu': -10, 'charizard': 3.5 };
  const result = repairTrainerData(trainerData);
  assert.strictEqual(result.repairedData['12345'].pokemon.pikachu, 0);
  assert.strictEqual(result.repairedData['12345'].pokemon.charizard, 3);
});

test('repairTrainerData: fixes trainer values', () => {
  const trainerData = {
    '12345': createDefaultUserData('12345', 'User1')
  };
  trainerData['12345'].trainers = { 'Ace Trainer': 'yes' };
  const result = repairTrainerData(trainerData);
  assert.strictEqual(result.repairedData['12345'].trainers['Ace Trainer'], true);
});

test('repairTrainerData: fixes displayedPokemon array', () => {
  const trainerData = {
    '12345': createDefaultUserData('12345', 'User1')
  };
  trainerData['12345'].displayedPokemon = 'not an array';
  const result = repairTrainerData(trainerData);
  assert(Array.isArray(result.repairedData['12345'].displayedPokemon));
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
