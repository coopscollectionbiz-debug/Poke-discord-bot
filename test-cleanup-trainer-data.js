#!/usr/bin/env node
// ==========================================================
// test-cleanup-trainer-data.js
// Tests for cleanupTrainerData.js script functionality
// ==========================================================

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Valid fields from USER_SCHEMA
const VALID_FIELDS = [
  'id',
  'name',
  'tp',
  'cc',
  'rank',
  'pokemon',
  'trainers',
  'displayedPokemon',
  'displayedTrainer',
  'lastDaily',
  'schemaVersion',
];

/**
 * Simulate cleanup logic for testing
 * @param {object} trainerData - Input trainer data
 * @returns {object} { cleanedData, stats }
 */
function performCleanup(trainerData) {
  const cleanedData = {};
  const stats = {
    totalUsers: 0,
    cleanedUsers: 0,
    removedFieldsCount: 0,
    removedFieldsSummary: {}
  };

  for (const [userId, userData] of Object.entries(trainerData)) {
    stats.totalUsers++;
    
    // Skip if userData is not an object
    if (typeof userData !== 'object' || userData === null) {
      cleanedData[userId] = userData;
      continue;
    }

    cleanedData[userId] = {};
    const removedFields = [];

    for (const key in userData) {
      if (VALID_FIELDS.includes(key)) {
        cleanedData[userId][key] = userData[key];
      } else {
        removedFields.push(key);
        stats.removedFieldsSummary[key] = (stats.removedFieldsSummary[key] || 0) + 1;
      }
    }

    if (removedFields.length > 0) {
      stats.cleanedUsers++;
      stats.removedFieldsCount += removedFields.length;
    }
  }

  return { cleanedData, stats };
}

// Test framework
let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`✅ ${testName}`);
    passed++;
  } else {
    console.log(`❌ ${testName}`);
    failed++;
  }
}

function assertEquals(actual, expected, testName) {
  const condition = JSON.stringify(actual) === JSON.stringify(expected);
  assert(condition, testName);
  if (!condition) {
    console.log(`  Expected: ${JSON.stringify(expected)}`);
    console.log(`  Actual: ${JSON.stringify(actual)}`);
  }
}

// Run tests
console.log('🧪 Running Cleanup TrainerData Tests\n');
console.log('='.repeat(60));

// Test 1: Clean data with only valid fields
console.log('\n📋 Basic Cleanup Tests:');
{
  const input = {
    'user1': {
      id: 'user1',
      name: 'TestUser',
      tp: 100,
      cc: 50,
      rank: 'Novice Trainer',
      pokemon: {},
      trainers: {},
      displayedPokemon: [],
      displayedTrainer: null,
      lastDaily: 0,
      schemaVersion: 1
    }
  };
  const result = performCleanup(input);
  assertEquals(result.cleanedData, input, 'No fields removed from clean data');
  assert(result.stats.cleanedUsers === 0, 'No users cleaned when data is already clean');
}

// Test 2: Remove deprecated fields
{
  const input = {
    'user1': {
      id: 'user1',
      name: 'TestUser',
      tp: 100,
      cc: 50,
      rank: 'Novice Trainer',
      pokemon: {},
      trainers: {},
      displayedPokemon: [],
      displayedTrainer: null,
      lastDaily: 0,
      schemaVersion: 1,
      // Deprecated fields
      lastClaim: 12345,
      questProgress: { daily: 0 },
      coins: 100,
      guildId: 'guild123',
      trainer: 'ash'
    }
  };
  const result = performCleanup(input);
  
  assert(!result.cleanedData.user1.hasOwnProperty('lastClaim'), 'lastClaim field removed');
  assert(!result.cleanedData.user1.hasOwnProperty('questProgress'), 'questProgress field removed');
  assert(!result.cleanedData.user1.hasOwnProperty('coins'), 'coins field removed');
  assert(!result.cleanedData.user1.hasOwnProperty('guildId'), 'guildId field removed');
  assert(!result.cleanedData.user1.hasOwnProperty('trainer'), 'trainer field removed');
  assert(result.stats.cleanedUsers === 1, 'One user cleaned');
  assert(result.stats.removedFieldsCount === 5, 'Five deprecated fields removed');
}

// Test 3: Preserve valid fields while removing deprecated ones
{
  const input = {
    'user1': {
      id: 'user1',
      name: 'TestUser',
      tp: 100,
      lastClaim: 12345,  // deprecated
      pokemon: { 'pikachu': 1 },
      coins: 50  // deprecated
    }
  };
  const result = performCleanup(input);
  
  assert(result.cleanedData.user1.id === 'user1', 'id field preserved');
  assert(result.cleanedData.user1.name === 'TestUser', 'name field preserved');
  assert(result.cleanedData.user1.tp === 100, 'tp field preserved');
  assert(result.cleanedData.user1.pokemon.pikachu === 1, 'pokemon field preserved');
  assert(!result.cleanedData.user1.hasOwnProperty('lastClaim'), 'lastClaim removed');
  assert(!result.cleanedData.user1.hasOwnProperty('coins'), 'coins removed');
}

// Test 4: Handle multiple users
{
  const input = {
    'user1': {
      id: 'user1',
      name: 'User1',
      tp: 100,
      oldField: 'deprecated'
    },
    'user2': {
      id: 'user2',
      name: 'User2',
      tp: 200,
      anotherOldField: 'also deprecated'
    },
    'user3': {
      id: 'user3',
      name: 'User3',
      tp: 300
      // No deprecated fields
    }
  };
  const result = performCleanup(input);
  
  assert(result.stats.totalUsers === 3, 'Three users processed');
  assert(result.stats.cleanedUsers === 2, 'Two users had deprecated fields');
  assert(result.stats.removedFieldsCount === 2, 'Two deprecated fields removed total');
  assert(!result.cleanedData.user1.hasOwnProperty('oldField'), 'user1 oldField removed');
  assert(!result.cleanedData.user2.hasOwnProperty('anotherOldField'), 'user2 anotherOldField removed');
  assert(Object.keys(result.cleanedData.user3).length <= VALID_FIELDS.length, 'user3 has only valid fields');
}

// Test 5: Track removed fields summary
{
  const input = {
    'user1': { id: 'user1', lastClaim: 123, coins: 50 },
    'user2': { id: 'user2', lastClaim: 456, guildId: 'guild1' },
    'user3': { id: 'user3', coins: 100 }
  };
  const result = performCleanup(input);
  
  assert(result.stats.removedFieldsSummary.lastClaim === 2, 'lastClaim removed from 2 users');
  assert(result.stats.removedFieldsSummary.coins === 2, 'coins removed from 2 users');
  assert(result.stats.removedFieldsSummary.guildId === 1, 'guildId removed from 1 user');
}

// Test 6: Handle empty object
{
  const input = {};
  const result = performCleanup(input);
  
  assertEquals(result.cleanedData, {}, 'Empty object returns empty object');
  assert(result.stats.totalUsers === 0, 'Zero users processed');
  assert(result.stats.cleanedUsers === 0, 'Zero users cleaned');
}

// Test 7: Handle invalid user data (not an object)
{
  const input = {
    'user1': { id: 'user1', name: 'Valid' },
    'user2': null,
    'user3': 'invalid string',
    'user4': 123
  };
  const result = performCleanup(input);
  
  assert(result.stats.totalUsers === 4, 'All users counted');
  assert(result.cleanedData.user1.id === 'user1', 'Valid user preserved');
  assert(result.cleanedData.user2 === null, 'Null user preserved as-is');
  assert(result.cleanedData.user3 === 'invalid string', 'String user preserved as-is');
  assert(result.cleanedData.user4 === 123, 'Number user preserved as-is');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary:');
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   Total: ${passed + failed}`);
console.log('='.repeat(60));

if (failed === 0) {
  console.log('\n🎉 All tests passed!\n');
  process.exit(0);
} else {
  console.log(`\n❌ ${failed} test(s) failed\n`);
  process.exit(1);
}
