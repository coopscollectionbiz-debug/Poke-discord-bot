#!/usr/bin/env node
// ==========================================================
// test-button-handlers.js
// Integration tests for trainer card button handlers
// ==========================================================

import { handleTrainerCardButtons } from './commands/trainercard.js';

console.log('🧪 Running Button Handler Tests\n');
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
// Test Setup: Mock trainer data and interaction objects
// ============================================================

const mockTrainerData = {
  'user123': {
    id: 'user123',
    name: 'TestUser',
    tp: 100,
    cc: 50,
    rank: 'Bronze Trainer',
    pokemon: {
      '1': { normal: 1, shiny: 0 },
      '4': { normal: 0, shiny: 1 },
      '7': { normal: 1, shiny: 0 },
      '25': { normal: 2, shiny: 0 }
    },
    trainers: {
      'youngster-gen4.png': true,
      'lass-gen4.png': true,
      'acetrainer-gen4.png': true
    },
    displayedPokemon: ['1', '4', '7'],
    displayedTrainer: 'youngster-gen4.png',
    lastDaily: 0,
    schemaVersion: 1
  }
};

// Mock interaction object for testing
function createMockInteraction(customId, userId = 'user123') {
  return {
    customId,
    user: {
      id: userId,
      username: 'TestUser',
      displayAvatarURL: () => 'https://example.com/avatar.png'
    },
    isButton: () => true,
    reply: async (options) => {
      // Track that reply was called
      return { success: true, options };
    },
    update: async (options) => {
      // Track that update was called
      return { success: true, options };
    },
    followUp: async (options) => {
      return { success: true, options };
    },
    deferred: false,
    replied: false,
    message: {
      components: []
    },
    channel: {
      createMessageComponentCollector: (options) => {
        // Return a mock collector
        return {
          on: (event, handler) => {},
          stop: () => {}
        };
      },
      send: async (options) => {
        return { success: true };
      }
    }
  };
}

// ============================================================
// Test Suite 1: Button Handler Function Signature
// ============================================================

console.log('\n📋 Function Signature Tests:');

try {
  assert(
    typeof handleTrainerCardButtons === 'function',
    'handleTrainerCardButtons is a function'
  );

  assert(
    handleTrainerCardButtons.length >= 2,
    'handleTrainerCardButtons accepts at least 2 parameters'
  );
} catch (error) {
  console.log(`❌ Function signature test failed: ${error.message}`);
  testsFailed++;
}

// ============================================================
// Test Suite 2: Button Handler Validation
// ============================================================

console.log('\n📋 Handler Validation Tests:');

// Test: Handler rejects unknown user
try {
  const interaction = createMockInteraction('refresh_card', 'unknownUser');
  let replyCalled = false;
  interaction.reply = async (options) => {
    replyCalled = true;
    assert(
      options.content.includes('Could not find'),
      'Handler shows error for unknown user'
    );
    return { success: true };
  };

  await handleTrainerCardButtons(interaction, mockTrainerData, async () => {});
  
  assert(
    replyCalled,
    'Handler calls reply for unknown user'
  );
} catch (error) {
  console.log(`❌ Unknown user test failed: ${error.message}`);
  testsFailed++;
}

// ============================================================
// Test Suite 3: Refresh Card Handler
// ============================================================

console.log('\n📋 Refresh Card Tests:');

try {
  const interaction = createMockInteraction('refresh_card');
  let updateCalled = false;
  
  interaction.update = async (options) => {
    updateCalled = true;
    assert(
      options.embeds && options.embeds.length > 0,
      'Refresh card returns embed'
    );
    assert(
      options.files && options.files.length > 0,
      'Refresh card returns attachment'
    );
    return { success: true };
  };

  await handleTrainerCardButtons(interaction, mockTrainerData, async () => {});
  
  assert(
    updateCalled,
    'Refresh card calls update'
  );
} catch (error) {
  console.log(`❌ Refresh card test failed: ${error.message}`);
  testsFailed++;
}

// ============================================================
// Test Suite 4: Share Public Handler
// ============================================================

console.log('\n📋 Share Public Tests:');

try {
  const interaction = createMockInteraction('share_public');
  let replyCalled = false;
  let channelSendCalled = false;
  
  interaction.reply = async (options) => {
    replyCalled = true;
    assert(
      options.content.includes('Shared publicly'),
      'Share public confirms action'
    );
    return { success: true };
  };

  interaction.channel.send = async (options) => {
    channelSendCalled = true;
    assert(
      options.embeds && options.embeds.length > 0,
      'Share public sends embed to channel'
    );
    assert(
      options.files && options.files.length > 0,
      'Share public sends attachment to channel'
    );
    return { success: true };
  };

  await handleTrainerCardButtons(interaction, mockTrainerData, async () => {});
  
  assert(
    replyCalled,
    'Share public calls reply'
  );
  
  assert(
    channelSendCalled,
    'Share public sends to channel'
  );
} catch (error) {
  console.log(`❌ Share public test failed: ${error.message}`);
  testsFailed++;
}

// ============================================================
// Test Suite 5: Change Trainer Handler
// ============================================================

console.log('\n📋 Change Trainer Tests:');

try {
  const interaction = createMockInteraction('change_trainer');
  let replyCalled = false;
  
  interaction.reply = async (options) => {
    replyCalled = true;
    assert(
      options.embeds && options.embeds.length > 0,
      'Change trainer shows embed'
    );
    assert(
      options.components && options.components.length > 0,
      'Change trainer shows buttons'
    );
    assert(
      options.ephemeral === true,
      'Change trainer reply is ephemeral'
    );
    return { success: true };
  };

  await handleTrainerCardButtons(interaction, mockTrainerData, async () => {});
  
  assert(
    replyCalled,
    'Change trainer calls reply'
  );
} catch (error) {
  console.log(`❌ Change trainer test failed: ${error.message}`);
  testsFailed++;
}

// ============================================================
// Test Suite 6: Change Pokémon Handler
// ============================================================

console.log('\n📋 Change Pokémon Tests:');

try {
  const interaction = createMockInteraction('change_pokemon');
  let replyCalled = false;
  
  interaction.reply = async (options) => {
    replyCalled = true;
    assert(
      options.embeds && options.embeds.length > 0,
      'Change pokemon shows embed'
    );
    assert(
      options.components && options.components.length > 0,
      'Change pokemon shows buttons'
    );
    assert(
      options.ephemeral === true,
      'Change pokemon reply is ephemeral'
    );
    return { success: true };
  };

  await handleTrainerCardButtons(interaction, mockTrainerData, async () => {});
  
  assert(
    replyCalled,
    'Change pokemon calls reply'
  );
} catch (error) {
  console.log(`❌ Change pokemon test failed: ${error.message}`);
  testsFailed++;
}

// ============================================================
// Test Suite 7: Unknown Button Handler
// ============================================================

console.log('\n📋 Unknown Button Tests:');

try {
  const interaction = createMockInteraction('unknown_button_id');
  let replyCalled = false;
  
  interaction.reply = async (options) => {
    replyCalled = true;
    assert(
      options.content.includes('Unknown'),
      'Unknown button shows error message'
    );
    return { success: true };
  };

  await handleTrainerCardButtons(interaction, mockTrainerData, async () => {});
  
  assert(
    replyCalled,
    'Unknown button calls reply'
  );
} catch (error) {
  console.log(`❌ Unknown button test failed: ${error.message}`);
  testsFailed++;
}

// ============================================================
// Test Suite 8: Edge Cases
// ============================================================

console.log('\n📋 Edge Case Tests:');

// Test: User with no trainers
try {
  const noTrainersData = {
    'user456': {
      id: 'user456',
      name: 'NewUser',
      tp: 0,
      cc: 0,
      rank: 'Novice Trainer',
      pokemon: {},
      trainers: {},
      displayedPokemon: [],
      displayedTrainer: null,
      lastDaily: 0,
      schemaVersion: 1
    }
  };

  const interaction = createMockInteraction('change_trainer', 'user456');
  let replyCalled = false;
  
  interaction.reply = async (options) => {
    replyCalled = true;
    assert(
      options.content.includes("don't have any trainers"),
      'Shows error when user has no trainers'
    );
    return { success: true };
  };

  await handleTrainerCardButtons(interaction, noTrainersData, async () => {});
  
  assert(
    replyCalled,
    'Handles user with no trainers gracefully'
  );
} catch (error) {
  console.log(`❌ No trainers test failed: ${error.message}`);
  testsFailed++;
}

// Test: User with no Pokémon
try {
  const noPokemonData = {
    'user789': {
      id: 'user789',
      name: 'NewUser2',
      tp: 0,
      cc: 0,
      rank: 'Novice Trainer',
      pokemon: {},
      trainers: { 'youngster-gen4.png': true },
      displayedPokemon: [],
      displayedTrainer: 'youngster-gen4.png',
      lastDaily: 0,
      schemaVersion: 1
    }
  };

  const interaction = createMockInteraction('change_pokemon', 'user789');
  let replyCalled = false;
  
  interaction.reply = async (options) => {
    replyCalled = true;
    assert(
      options.content.includes("don't have any Pokémon"),
      'Shows error when user has no Pokémon'
    );
    return { success: true };
  };

  await handleTrainerCardButtons(interaction, noPokemonData, async () => {});
  
  assert(
    replyCalled,
    'Handles user with no Pokémon gracefully'
  );
} catch (error) {
  console.log(`❌ No Pokémon test failed: ${error.message}`);
  testsFailed++;
}

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
