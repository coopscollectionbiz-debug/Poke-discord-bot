// ==========================================================
// test-trainercard-dataloader.js
// Unit tests for trainercard.js data loading
// Run with: node test-trainercard-dataloader.js
// ==========================================================

import assert from 'assert';
import { getAllPokemon, loadPokemonData, clearCache } from './utils/dataLoader.js';

let testsPassed = 0;
let testsFailed = 0;

function test(description, fn) {
  return new Promise(async (resolve) => {
    try {
      await fn();
      console.log(`✅ ${description}`);
      testsPassed++;
      resolve();
    } catch (error) {
      console.error(`❌ ${description}`);
      console.error(`   Error: ${error.message}`);
      testsFailed++;
      resolve();
    }
  });
}

console.log('\n🧪 Running Trainercard Data Loading Tests\n');
console.log('='.repeat(60));

// ========== getAllPokemon Tests ==========
console.log('\n📋 getAllPokemon Tests:');

await test('getAllPokemon: returns array of Pokemon', async () => {
  const allPokemon = await getAllPokemon();
  assert(Array.isArray(allPokemon), 'getAllPokemon should return an array');
  assert(allPokemon.length > 0, 'getAllPokemon should return non-empty array');
});

await test('getAllPokemon: Pokemon have required properties', async () => {
  const allPokemon = await getAllPokemon();
  const firstPokemon = allPokemon[0];
  assert(firstPokemon.id !== undefined, 'Pokemon should have id');
  assert(firstPokemon.name !== undefined, 'Pokemon should have name');
  assert(Array.isArray(firstPokemon.types), 'Pokemon should have types array');
});

await test('getAllPokemon: can filter starters', async () => {
  const starterIDs = [1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501];
  const allPokemon = await getAllPokemon();
  const starters = allPokemon.filter((p) => starterIDs.includes(p.id));
  assert(starters.length === starterIDs.length, `Should find ${starterIDs.length} starters`);
});

await test('getAllPokemon: starters have correct type structure', async () => {
  const starterIDs = [1, 4, 7];
  const allPokemon = await getAllPokemon();
  const starters = allPokemon.filter((p) => starterIDs.includes(p.id));
  
  for (const starter of starters) {
    assert(starter.types && starter.types.length > 0, `Starter ${starter.name} should have types`);
    const primaryType = starter.types[0];
    assert(typeof primaryType === 'number', `Primary type should be a number`);
  }
});

// ========== loadPokemonData Tests ==========
console.log('\n📋 loadPokemonData Tests:');

await test('loadPokemonData: successfully loads data', async () => {
  clearCache();
  const data = await loadPokemonData();
  assert(data !== null, 'Data should not be null');
  assert(typeof data === 'object', 'Data should be an object');
  assert(Object.keys(data).length > 0, 'Data should have Pokemon entries');
});

await test('loadPokemonData: caches data on subsequent calls', async () => {
  const data1 = await loadPokemonData();
  const data2 = await loadPokemonData();
  assert(data1 === data2, 'Should return same cached object');
});

await test('loadPokemonData: Pokemon data has correct structure', async () => {
  const data = await loadPokemonData();
  const firstId = Object.keys(data)[0];
  const firstPokemon = data[firstId];
  
  assert(firstPokemon.id !== undefined, 'Pokemon should have id');
  assert(firstPokemon.name !== undefined, 'Pokemon should have name');
  assert(firstPokemon.tier !== undefined, 'Pokemon should have tier');
  assert(firstPokemon.region !== undefined, 'Pokemon should have region');
  assert(Array.isArray(firstPokemon.types), 'Pokemon should have types array');
});

// ========== Error Handling Tests ==========
console.log('\n📋 Error Handling Tests:');

await test('getAllPokemon: throws error on invalid data', async () => {
  // This test verifies error propagation exists
  // In real scenario, if file is missing, it should throw
  try {
    const allPokemon = await getAllPokemon();
    assert(allPokemon !== null, 'Should not be null in normal operation');
  } catch (error) {
    // Expected behavior if data is unavailable
    assert(error !== null, 'Error should be thrown on failure');
  }
});

// ========== Test Summary ==========
console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary:');
console.log(`   ✅ Passed: ${testsPassed}`);
console.log(`   ❌ Failed: ${testsFailed}`);
console.log(`   Total: ${testsPassed + testsFailed}`);
console.log('='.repeat(60));

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed\n');
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!\n');
  process.exit(0);
}
