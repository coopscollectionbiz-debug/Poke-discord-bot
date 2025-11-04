#!/usr/bin/env node
// ==========================================================
// test-deprecated-fields.js
// Tests for deprecated field removal during migration and save
// ==========================================================

import { migrateUserData, stripDeprecatedFields } from './utils/schemaMigration.js';
import { sanitizeBeforeSave } from './utils/trainerDataHelper.js';

console.log('🧪 Running Deprecated Field Removal Tests\n');
console.log('='.repeat(60));

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`✅ ${testName}`);
    testsPassed++;
    return true;
  } else {
    console.log(`❌ ${testName}`);
    testsFailed++;
    return false;
  }
}

// ============================================================
// Test Suite 1: Migration Removes Deprecated Fields
// ============================================================

console.log('\n📋 Migration Deprecated Field Tests:');

const legacyUserData = {
  id: '12345',
  name: 'TestUser',
  tp: 100,
  cc: 50,
  coins: 999,              // deprecated
  questProgress: { q1: 5 }, // deprecated
  guildId: 'guild123',     // deprecated
  lastClaim: 1234567890,   // deprecated
  trainer: 'old.png',      // deprecated
  ownedPokemon: { '1': 1 }, // deprecated
  pokemon: { '25': { normal: 1, shiny: 0 } },
  trainers: { 'youngster.png': true },
  displayedPokemon: ['25'],
  displayedTrainer: 'youngster.png',
  rank: 'Bronze Trainer',
  lastDaily: 0
};

console.log('🔍 Original data has deprecated fields:', 
  'coins' in legacyUserData,
  'questProgress' in legacyUserData,
  'guildId' in legacyUserData
);

const migratedUser = migrateUserData(legacyUserData, '12345');

assert(
  !('coins' in migratedUser),
  'Migration removes coins field'
);

assert(
  !('questProgress' in migratedUser),
  'Migration removes questProgress field'
);

assert(
  !('guildId' in migratedUser),
  'Migration removes guildId field'
);

assert(
  !('lastClaim' in migratedUser),
  'Migration removes lastClaim field'
);

assert(
  !('trainer' in migratedUser),
  'Migration removes trainer field'
);

assert(
  !('ownedPokemon' in migratedUser),
  'Migration removes ownedPokemon field'
);

// Verify required fields are preserved
assert(
  migratedUser.id === '12345',
  'Migration preserves id field'
);

assert(
  migratedUser.tp === 100,
  'Migration preserves tp field'
);

assert(
  migratedUser.cc === 50,
  'Migration preserves cc field'
);

assert(
  migratedUser.pokemon && Object.keys(migratedUser.pokemon).length > 0,
  'Migration preserves pokemon field'
);

// ============================================================
// Test Suite 2: stripDeprecatedFields Function
// ============================================================

console.log('\n📋 stripDeprecatedFields Tests:');

const testTrainerData = {
  'user1': {
    id: 'user1',
    name: 'User1',
    tp: 50,
    cc: 25,
    coins: 100,  // deprecated
    pokemon: {},
    trainers: {},
    displayedPokemon: [],
    displayedTrainer: null,
    rank: 'Novice Trainer',
    lastDaily: 0,
    schemaVersion: 1
  },
  'user2': {
    id: 'user2',
    name: 'User2',
    tp: 75,
    cc: 30,
    questProgress: { test: 1 },  // deprecated
    guildId: 'g123',             // deprecated
    pokemon: {},
    trainers: {},
    displayedPokemon: [],
    displayedTrainer: null,
    rank: 'Bronze Trainer',
    lastDaily: 0,
    schemaVersion: 1
  }
};

const stripped = stripDeprecatedFields(testTrainerData);

assert(
  !('coins' in stripped.user1),
  'stripDeprecatedFields removes coins from user1'
);

assert(
  !('questProgress' in stripped.user2),
  'stripDeprecatedFields removes questProgress from user2'
);

assert(
  !('guildId' in stripped.user2),
  'stripDeprecatedFields removes guildId from user2'
);

assert(
  'tp' in stripped.user1,
  'stripDeprecatedFields preserves tp in user1'
);

assert(
  stripped.user1.tp === 50,
  'stripDeprecatedFields preserves tp value'
);

assert(
  'schemaVersion' in stripped.user1,
  'stripDeprecatedFields preserves schemaVersion'
);

// ============================================================
// Test Suite 3: sanitizeBeforeSave Integration
// ============================================================

console.log('\n📋 sanitizeBeforeSave Integration Tests:');

const dirtyData = {
  'user3': {
    id: 'user3',
    name: 'User3',
    tp: 100,
    cc: 50,
    coins: 500,           // deprecated
    lastClaim: 123456,    // deprecated
    pokemon: { '1': { normal: 1, shiny: 0 } },
    trainers: { 'trainer.png': true },
    displayedPokemon: ['1'],
    displayedTrainer: 'trainer.png',
    rank: 'Silver Trainer',
    lastDaily: 0,
    schemaVersion: 1
  }
};

const sanitized = sanitizeBeforeSave(dirtyData);

assert(
  !('coins' in sanitized.user3),
  'sanitizeBeforeSave removes coins field'
);

assert(
  !('lastClaim' in sanitized.user3),
  'sanitizeBeforeSave removes lastClaim field'
);

assert(
  sanitized.user3.tp === 100,
  'sanitizeBeforeSave preserves valid tp value'
);

assert(
  sanitized.user3.pokemon && '1' in sanitized.user3.pokemon,
  'sanitizeBeforeSave preserves pokemon collection'
);

// ============================================================
// Test Suite 4: Multiple Deprecated Fields
// ============================================================

console.log('\n📋 Multiple Deprecated Fields Tests:');

const userWithAllDeprecated = {
  id: 'user4',
  name: 'User4',
  tp: 150,
  cc: 75,
  coins: 1000,
  questProgress: { q1: 1, q2: 2 },
  guildId: 'g456',
  lastClaim: 987654321,
  trainer: 'oldtrainer.png',
  ownedPokemon: { '25': 2 },
  pokemon: { '7': { normal: 1, shiny: 0 } },
  trainers: { 'trainer.png': true },
  displayedPokemon: ['7'],
  displayedTrainer: 'trainer.png',
  rank: 'Gold Trainer',
  lastDaily: 0
};

const cleanedUser = migrateUserData(userWithAllDeprecated, 'user4');

const deprecatedFields = ['coins', 'questProgress', 'guildId', 'lastClaim', 'trainer', 'ownedPokemon'];
const remainingDeprecated = deprecatedFields.filter(field => field in cleanedUser);

assert(
  remainingDeprecated.length === 0,
  `All deprecated fields removed (found: ${remainingDeprecated.join(', ') || 'none'})`
);

assert(
  cleanedUser.tp === 150,
  'Valid field tp preserved with correct value'
);

assert(
  cleanedUser.pokemon && '7' in cleanedUser.pokemon,
  'Valid field pokemon preserved correctly'
);

// ============================================================
// Test Suite 5: Edge Cases
// ============================================================

console.log('\n📋 Edge Case Tests:');

// Test with null/undefined deprecated fields
const edgeCaseData = {
  id: 'user5',
  name: 'User5',
  tp: 25,
  cc: 10,
  coins: null,
  questProgress: undefined,
  pokemon: {},
  trainers: {},
  displayedPokemon: [],
  displayedTrainer: null,
  rank: 'Novice Trainer',
  lastDaily: 0
};

const edgeCaseResult = migrateUserData(edgeCaseData, 'user5');

assert(
  !('coins' in edgeCaseResult),
  'Migration removes deprecated field even when null'
);

assert(
  !('questProgress' in edgeCaseResult),
  'Migration removes deprecated field even when undefined'
);

// Test with empty object
const emptyStripped = stripDeprecatedFields({});

assert(
  typeof emptyStripped === 'object',
  'stripDeprecatedFields handles empty object'
);

assert(
  Object.keys(emptyStripped).length === 0,
  'stripDeprecatedFields returns empty object for empty input'
);

// ============================================================
// Summary
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary:');
console.log(`   ✅ Passed: ${testsPassed}`);
console.log(`   ❌ Failed: ${testsFailed}`);
console.log(`   Total: ${testsPassed + testsFailed}`);
console.log('='.repeat(60));

if (testsFailed === 0) {
  console.log('\n🎉 All tests passed!\n');
  process.exit(0);
} else {
  console.log(`\n❌ ${testsFailed} test(s) failed\n`);
  process.exit(1);
}
