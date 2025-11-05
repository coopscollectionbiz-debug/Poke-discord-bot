// ==========================================================
// test-onboarding-flow.js
// Unit tests for onboarding flow (starter and trainer selection)
// Run with: node test-onboarding-flow.js
// ==========================================================

import assert from 'assert';
import { ensureUserData, sanitizeBeforeSave } from './utils/trainerDataHelper.js';
import { createDefaultUserData } from './utils/schemaValidator.js';

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

console.log('\n🧪 Running Onboarding Flow Tests\n');
console.log('='.repeat(60));

// ========== Starter Selection Tests ==========
console.log('\n📋 Starter Selection Tests:');

test('Starter selection: assigns pokemon correctly', () => {
  const trainerData = {};
  const userId = '12345';
  const user = ensureUserData(trainerData, userId, 'TestUser');
  
  // Simulate selecting starter (Bulbasaur, ID 1)
  const starterId = 1;
  const isShiny = false;
  
  user.pokemon[starterId] = { normal: isShiny ? 0 : 1, shiny: isShiny ? 1 : 0 };
  user.displayedPokemon = [starterId];
  
  assert.strictEqual(user.displayedPokemon.length, 1);
  assert.strictEqual(user.displayedPokemon[0], starterId);
  assert.deepStrictEqual(user.pokemon[starterId], { normal: 1, shiny: 0 });
});

test('Starter selection: assigns shiny pokemon correctly', () => {
  const trainerData = {};
  const userId = '12345';
  const user = ensureUserData(trainerData, userId, 'TestUser');
  
  // Simulate selecting shiny starter (Charmander, ID 4)
  const starterId = 4;
  const isShiny = true;
  
  user.pokemon[starterId] = { normal: isShiny ? 0 : 1, shiny: isShiny ? 1 : 0 };
  user.displayedPokemon = [starterId];
  
  assert.strictEqual(user.displayedPokemon.length, 1);
  assert.strictEqual(user.displayedPokemon[0], starterId);
  assert.deepStrictEqual(user.pokemon[starterId], { normal: 0, shiny: 1 });
});

test('Starter selection: pokemon survives sanitization', () => {
  const trainerData = {};
  const userId = '12345';
  const user = ensureUserData(trainerData, userId, 'TestUser');
  
  // Assign starter
  const starterId = 7;
  user.pokemon[starterId] = { normal: 1, shiny: 0 };
  user.displayedPokemon = [starterId];
  
  // Sanitize the data (as would happen before saving)
  const sanitized = sanitizeBeforeSave(trainerData);
  
  assert(sanitized[userId]);
  assert.deepStrictEqual(sanitized[userId].pokemon[starterId], { normal: 1, shiny: 0 });
  assert.deepStrictEqual(sanitized[userId].displayedPokemon, [starterId]);
});

// ========== Trainer Selection Tests ==========
console.log('\n📋 Trainer Selection Tests:');

test('Trainer selection: assigns trainer correctly', () => {
  const trainerData = {};
  const userId = '12345';
  const user = ensureUserData(trainerData, userId, 'TestUser');
  
  // Simulate selecting trainer
  const trainerId = 'youngster-gen4.png';
  
  user.trainers[trainerId] = true;
  user.displayedTrainer = trainerId;
  
  assert.strictEqual(user.displayedTrainer, trainerId);
  assert.strictEqual(user.trainers[trainerId], true);
});

test('Trainer selection: trainer survives sanitization', () => {
  const trainerData = {};
  const userId = '12345';
  const user = ensureUserData(trainerData, userId, 'TestUser');
  
  // Assign trainer
  const trainerId = 'lass-gen4.png';
  user.trainers[trainerId] = true;
  user.displayedTrainer = trainerId;
  
  // Sanitize the data (as would happen before saving)
  const sanitized = sanitizeBeforeSave(trainerData);
  
  assert(sanitized[userId]);
  assert.strictEqual(sanitized[userId].trainers[trainerId], true);
  assert.strictEqual(sanitized[userId].displayedTrainer, trainerId);
});

// ========== Complete Onboarding Flow Tests ==========
console.log('\n📋 Complete Onboarding Flow Tests:');

test('Complete onboarding: assigns both pokemon and trainer', () => {
  const trainerData = {};
  const userId = '12345';
  const user = ensureUserData(trainerData, userId, 'TestUser');
  
  // Step 1: Select starter
  const starterId = 152; // Chikorita
  user.pokemon[starterId] = { normal: 1, shiny: 0 };
  user.displayedPokemon = [starterId];
  
  // Step 2: Select trainer
  const trainerId = 'youngster-gen4.png';
  user.trainers[trainerId] = true;
  user.displayedTrainer = trainerId;
  
  // Verify both are assigned
  assert.strictEqual(user.displayedPokemon.length, 1);
  assert.strictEqual(user.displayedPokemon[0], starterId);
  assert.deepStrictEqual(user.pokemon[starterId], { normal: 1, shiny: 0 });
  assert.strictEqual(user.displayedTrainer, trainerId);
  assert.strictEqual(user.trainers[trainerId], true);
});

test('Complete onboarding: data persists through sanitization', () => {
  const trainerData = {};
  const userId = '12345';
  const user = ensureUserData(trainerData, userId, 'TestUser');
  
  // Complete onboarding
  const starterId = 155;
  const trainerId = 'lass-gen4.png';
  
  user.pokemon[starterId] = { normal: 1, shiny: 0 };
  user.displayedPokemon = [starterId];
  user.trainers[trainerId] = true;
  user.displayedTrainer = trainerId;
  
  // Sanitize
  const sanitized = sanitizeBeforeSave(trainerData);
  
  // Verify everything persists
  assert(sanitized[userId]);
  assert.deepStrictEqual(sanitized[userId].pokemon[starterId], { normal: 1, shiny: 0 });
  assert.deepStrictEqual(sanitized[userId].displayedPokemon, [starterId]);
  assert.strictEqual(sanitized[userId].trainers[trainerId], true);
  assert.strictEqual(sanitized[userId].displayedTrainer, trainerId);
});

test('Complete onboarding: multiple users can onboard', () => {
  const trainerData = {};
  
  // User 1
  const user1 = ensureUserData(trainerData, 'user1', 'Alice');
  user1.pokemon[1] = { normal: 1, shiny: 0 };
  user1.displayedPokemon = [1];
  user1.trainers['youngster-gen4.png'] = true;
  user1.displayedTrainer = 'youngster-gen4.png';
  
  // User 2
  const user2 = ensureUserData(trainerData, 'user2', 'Bob');
  user2.pokemon[4] = { normal: 0, shiny: 1 }; // shiny
  user2.displayedPokemon = [4];
  user2.trainers['lass-gen4.png'] = true;
  user2.displayedTrainer = 'lass-gen4.png';
  
  // Sanitize
  const sanitized = sanitizeBeforeSave(trainerData);
  
  // Verify both users
  assert.deepStrictEqual(sanitized.user1.pokemon[1], { normal: 1, shiny: 0 });
  assert.strictEqual(sanitized.user1.displayedTrainer, 'youngster-gen4.png');
  
  assert.deepStrictEqual(sanitized.user2.pokemon[4], { normal: 0, shiny: 1 });
  assert.strictEqual(sanitized.user2.displayedTrainer, 'lass-gen4.png');
});

// ========== Edge Cases ==========
console.log('\n📋 Edge Case Tests:');

test('Edge case: multiple pokemon can be added after onboarding', () => {
  const trainerData = {};
  const userId = '12345';
  const user = ensureUserData(trainerData, userId, 'TestUser');
  
  // Initial starter
  user.pokemon[1] = { normal: 1, shiny: 0 };
  user.displayedPokemon = [1];
  
  // Add more pokemon later
  user.pokemon[25] = { normal: 2, shiny: 1 };
  user.pokemon[6] = { normal: 1, shiny: 0 };
  
  // Only starter is displayed
  assert.strictEqual(user.displayedPokemon.length, 1);
  assert.strictEqual(user.displayedPokemon[0], 1);
  
  // But all pokemon are in collection
  assert(user.pokemon[1]);
  assert(user.pokemon[25]);
  assert(user.pokemon[6]);
});

test('Edge case: displayed pokemon can be changed', () => {
  const trainerData = {};
  const userId = '12345';
  const user = ensureUserData(trainerData, userId, 'TestUser');
  
  // Initial starter
  user.pokemon[1] = { normal: 1, shiny: 0 };
  user.displayedPokemon = [1];
  
  // Add another pokemon
  user.pokemon[25] = { normal: 1, shiny: 0 };
  
  // Change displayed pokemon
  user.displayedPokemon = [25];
  
  assert.deepStrictEqual(user.displayedPokemon, [25]);
});

// ========== Print Results ==========
console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary:');
console.log(`   ✅ Passed: ${testsPassed}`);
console.log(`   ❌ Failed: ${testsFailed}`);
console.log(`   Total: ${testsPassed + testsFailed}`);
console.log('='.repeat(60));

if (testsFailed === 0) {
  console.log('\n🎉 All tests passed!\n');
} else {
  console.log(`\n⚠️ ${testsFailed} test(s) failed\n`);
  process.exit(1);
}
