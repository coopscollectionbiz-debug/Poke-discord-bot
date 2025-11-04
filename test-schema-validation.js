// ==========================================================
// test-schema-validation.js
// Unit tests for schema validation system
// Run with: node test-schema-validation.js
// ==========================================================

import assert from 'assert';
import {
  validateField,
  validateUserSchema,
  createDefaultUserData,
  validatePokemonCollection,
  validateTrainersCollection,
  validateDisplayedPokemon,
  validateTrainerData,
  USER_SCHEMA,
  CURRENT_SCHEMA_VERSION
} from './utils/schemaValidator.js';

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

console.log('\n🧪 Running Schema Validation Tests\n');
console.log('='.repeat(60));

// ========== validateField Tests ==========
console.log('\n📋 validateField Tests:');

test('validateField: valid number field', () => {
  const result = validateField(100, { type: 'number', required: true, default: 0 }, 'tp');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.correctedValue, 100);
});

test('validateField: null required field uses default', () => {
  const result = validateField(null, { type: 'number', required: true, default: 0 }, 'tp');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.correctedValue, 0);
});

test('validateField: negative number below min', () => {
  const result = validateField(-10, { type: 'number', required: true, default: 0, min: 0 }, 'tp');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.correctedValue, 0);
});

test('validateField: valid string', () => {
  const result = validateField('Trainer', { type: 'string', required: true, default: 'Trainer' }, 'name');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.correctedValue, 'Trainer');
});

test('validateField: valid object', () => {
  const result = validateField({}, { type: 'object', required: true, default: {} }, 'pokemon');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.correctedValue, {});
});

test('validateField: valid array', () => {
  const result = validateField([], { type: 'array', required: true, default: [] }, 'displayedPokemon');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.correctedValue, []);
});

test('validateField: wrong type corrected', () => {
  const result = validateField('not a number', { type: 'number', required: true, default: 0 }, 'tp');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.correctedValue, 0);
});

// ========== createDefaultUserData Tests ==========
console.log('\n📋 createDefaultUserData Tests:');

test('createDefaultUserData: creates valid default data', () => {
  const data = createDefaultUserData('12345', 'TestUser');
  assert.strictEqual(data.id, '12345');
  assert.strictEqual(data.name, 'TestUser');
  assert.strictEqual(data.tp, 0);
  assert.strictEqual(data.cc, 0);
  assert.strictEqual(data.rank, 'Novice Trainer');
  assert.deepStrictEqual(data.pokemon, {});
  assert.deepStrictEqual(data.trainers, {});
  assert.deepStrictEqual(data.displayedPokemon, []);
  assert.strictEqual(data.displayedTrainer, null);
  assert.strictEqual(data.lastDaily, 0);
  assert.strictEqual(data.schemaVersion, CURRENT_SCHEMA_VERSION);
});

// ========== validateUserSchema Tests ==========
console.log('\n📋 validateUserSchema Tests:');

test('validateUserSchema: valid user data', () => {
  const userData = createDefaultUserData('12345', 'TestUser');
  const result = validateUserSchema(userData, '12345');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

test('validateUserSchema: missing required fields are corrected', () => {
  const userData = { id: '12345' };
  const result = validateUserSchema(userData, '12345');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.correctedData.name, 'Trainer');
  assert.strictEqual(result.correctedData.tp, 0);
  assert.strictEqual(result.correctedData.cc, 0);
});

test('validateUserSchema: invalid types are corrected', () => {
  const userData = {
    id: '12345',
    name: 'Test',
    tp: 'not a number',
    cc: 0,
    rank: 'Novice Trainer',
    pokemon: {},
    trainers: {},
    displayedPokemon: [],
    displayedTrainer: null,
    lastDaily: 0
  };
  const result = validateUserSchema(userData, '12345');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.correctedData.tp, 0);
});

test('validateUserSchema: negative numbers are corrected', () => {
  const userData = createDefaultUserData('12345', 'Test');
  userData.tp = -100;
  const result = validateUserSchema(userData, '12345');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.correctedData.tp, 0);
});

// ========== validatePokemonCollection Tests ==========
console.log('\n📋 validatePokemonCollection Tests:');

test('validatePokemonCollection: valid new format collection', () => {
  const pokemon = { 
    '25': { normal: 3, shiny: 1 }, 
    '6': { normal: 2, shiny: 0 } 
  };
  const result = validatePokemonCollection(pokemon, '12345');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.correctedData, pokemon);
});

test('validatePokemonCollection: legacy integer format converted', () => {
  const pokemon = { '25': 3, '6': 1 };
  const result = validatePokemonCollection(pokemon, '12345');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.correctedData, {
    '25': { normal: 3, shiny: 0 },
    '6': { normal: 1, shiny: 0 }
  });
});

test('validatePokemonCollection: negative counts corrected', () => {
  const pokemon = { '25': { normal: -5, shiny: 2 } };
  const result = validatePokemonCollection(pokemon, '12345');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.correctedData['25'].normal, 0);
  assert.strictEqual(result.correctedData['25'].shiny, 2);
});

test('validatePokemonCollection: non-integer counts corrected', () => {
  const pokemon = { '25': { normal: 3.5, shiny: 1 } };
  const result = validatePokemonCollection(pokemon, '12345');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.correctedData['25'].normal, 3);
  assert.strictEqual(result.correctedData['25'].shiny, 1);
});

test('validatePokemonCollection: invalid object returns empty', () => {
  const result = validatePokemonCollection(null, '12345');
  assert.strictEqual(result.valid, false);
  assert.deepStrictEqual(result.correctedData, {});
});

test('validatePokemonCollection: missing normal/shiny defaults to 0', () => {
  const pokemon = { '25': { normal: 2 } };
  const result = validatePokemonCollection(pokemon, '12345');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.correctedData, { '25': { normal: 2, shiny: 0 } });
});


// ========== validateTrainersCollection Tests ==========
console.log('\n📋 validateTrainersCollection Tests:');

test('validateTrainersCollection: valid boolean trainers', () => {
  const trainers = { 'Ace Trainer': true, 'Youngster': false };
  const result = validateTrainersCollection(trainers, '12345');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.correctedData, trainers);
});

test('validateTrainersCollection: valid object trainers', () => {
  const trainers = { 'Ace Trainer': { owned: true, variant: 'shiny' } };
  const result = validateTrainersCollection(trainers, '12345');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.correctedData, trainers);
});

test('validateTrainersCollection: invalid values corrected to boolean', () => {
  const trainers = { 'Ace Trainer': 'yes' };
  const result = validateTrainersCollection(trainers, '12345');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.correctedData['Ace Trainer'], true);
});

// ========== validateDisplayedPokemon Tests ==========
console.log('\n📋 validateDisplayedPokemon Tests:');

test('validateDisplayedPokemon: valid string array', () => {
  const displayed = ['pikachu', 'charizard'];
  const result = validateDisplayedPokemon(displayed, '12345');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.correctedData, displayed);
});

test('validateDisplayedPokemon: invalid entries filtered out', () => {
  const displayed = ['pikachu', null, '', 'charizard', undefined];
  const result = validateDisplayedPokemon(displayed, '12345');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.correctedData.length, 2);
  assert.deepStrictEqual(result.correctedData, ['pikachu', 'charizard']);
});

test('validateDisplayedPokemon: non-array returns empty', () => {
  const result = validateDisplayedPokemon('not an array', '12345');
  assert.strictEqual(result.valid, false);
  assert.deepStrictEqual(result.correctedData, []);
});

// ========== validateTrainerData Tests ==========
console.log('\n📋 validateTrainerData Tests:');

test('validateTrainerData: valid trainer data', () => {
  const trainerData = {
    '12345': createDefaultUserData('12345', 'User1'),
    '67890': createDefaultUserData('67890', 'User2')
  };
  const result = validateTrainerData(trainerData);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.stats.totalUsers, 2);
  assert.strictEqual(result.stats.validUsers, 2);
});

test('validateTrainerData: repairs malformed users', () => {
  const trainerData = {
    '12345': createDefaultUserData('12345', 'User1'),
    '67890': { id: '67890', tp: -100 } // malformed
  };
  const result = validateTrainerData(trainerData);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.stats.totalUsers, 2);
  assert.strictEqual(result.stats.repairedUsers, 1);
  assert.strictEqual(result.correctedData['67890'].tp, 0);
});

test('validateTrainerData: handles empty object', () => {
  const result = validateTrainerData({});
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.stats.totalUsers, 0);
});

test('validateTrainerData: handles invalid input', () => {
  const result = validateTrainerData(null);
  assert.strictEqual(result.valid, false);
  assert.deepStrictEqual(result.correctedData, {});
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
