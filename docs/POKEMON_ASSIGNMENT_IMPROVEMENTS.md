# Pokemon Assignment Onboarding Improvements

## Overview
This document describes the improvements made to ensure Pokemon are correctly assigned and persisted during the onboarding process.

## Issues Addressed

### 1. Pokemon Data Structure Validation
The schema validator expected simple integer counts for Pokemon, but the application uses a richer data structure with `{ normal: count, shiny: count }` to track both regular and shiny variants separately.

### 2. Missing Logging During Onboarding
The onboarding process lacked detailed logging, making it difficult to debug when Pokemon assignments failed.

### 3. DisplayedPokemon Array Support
The `displayedPokemon` array validation only supported string IDs, but the application uses numeric Pokemon IDs.

## Improvements Made

### 1. Updated Schema Validation

#### Pokemon Collection Validation (`validatePokemonCollection`)
- **Now Supports**: Both new format `{ normal: count, shiny: count }` and legacy integer format
- **Auto-Migration**: Automatically converts legacy integer counts to new format
- **Validation**: Ensures both `normal` and `shiny` counts are non-negative integers
- **Example**:
  ```javascript
  // New format (preferred)
  pokemon: {
    "25": { normal: 3, shiny: 1 },  // 3 regular Pikachu, 1 shiny
    "6": { normal: 2, shiny: 0 }     // 2 regular Charizard
  }
  
  // Legacy format (auto-converted)
  pokemon: {
    "25": 3  // Converts to { normal: 3, shiny: 0 }
  }
  ```

#### DisplayedPokemon Array Validation (`validateDisplayedPokemon`)
- **Now Supports**: String IDs, numeric IDs, and object structures
- **Example**:
  ```javascript
  // All valid formats
  displayedPokemon: [1, 25, 6]           // Numeric IDs
  displayedPokemon: ["1", "25", "6"]     // String IDs
  displayedPokemon: [1, "pikachu", 25]   // Mixed
  ```

### 2. Enhanced Onboarding Logging

#### Starter Selection (`starterSelection` in trainercard.js)
Added detailed logging to track:
- User ID and selected Pokemon ID
- Whether Pokemon is shiny or normal
- Pokemon assignment to user's collection
- DisplayedPokemon array update
- Data save operation

**Example Log Output**:
```
🌱 User 123456789 selected starter Pokemon ID: 1 (normal)
✅ Pokemon assigned - user.pokemon[1]: { normal: 1, shiny: 0 }
✅ displayedPokemon set: [ 1 ]
💾 Saving trainer data for user 123456789 after starter selection...
✅ Trainer data saved successfully
```

#### Trainer Selection (`trainerSelection` in trainercard.js)
Added similar logging for trainer selection:
- User ID and selected trainer ID
- Trainer assignment verification
- Data save confirmation

**Example Log Output**:
```
🧍 User 123456789 selected trainer: youngster-gen4.png
✅ Trainer assigned - user.trainers[youngster-gen4.png]: true
✅ displayedTrainer set: youngster-gen4.png
💾 Saving trainer data for user 123456789 after trainer selection...
✅ Trainer data saved successfully after trainer selection
```

### 3. Data Repair Helper Updates

Updated `repairTrainerData` in `utils/trainerDataHelper.js` to:
- Handle both numeric and object Pokemon counts
- Convert legacy format to new format automatically
- Validate normal/shiny counts are non-negative integers
- Log all conversions and repairs

## Testing

### Automated Tests

Added comprehensive test suite in `test-onboarding-flow.js`:

#### Starter Selection Tests
- ✅ Assigns normal Pokemon correctly
- ✅ Assigns shiny Pokemon correctly  
- ✅ Pokemon data survives sanitization

#### Trainer Selection Tests
- ✅ Assigns trainer correctly
- ✅ Trainer data survives sanitization

#### Complete Onboarding Tests
- ✅ Assigns both Pokemon and trainer
- ✅ Data persists through save/load cycle
- ✅ Multiple users can complete onboarding

#### Edge Cases
- ✅ Multiple Pokemon can be added after onboarding
- ✅ DisplayedPokemon array can be changed

### Manual Testing Steps

1. **Test New User Onboarding**:
   ```
   1. Create new user account
   2. Run /trainercard command
   3. Select a starter Pokemon
   4. Select a trainer sprite
   5. Verify Pokemon appears in trainer card
   6. Restart bot
   7. Verify Pokemon and trainer are still present
   ```

2. **Test Shiny Pokemon**:
   ```
   1. Complete onboarding multiple times with different test accounts
   2. Verify that some users randomly receive shiny starters
   3. Check that shiny Pokemon are displayed with ✨ emoji
   4. Verify shiny count is tracked separately from normal count
   ```

3. **Test Data Persistence**:
   ```
   1. Complete onboarding for a test user
   2. Note the Pokemon ID and trainer selected
   3. Trigger a manual save (e.g., via /adminsave command)
   4. Restart the bot
   5. Use /trainercard to verify data is preserved
   ```

## Data Structure Examples

### Complete User Data After Onboarding
```javascript
{
  "123456789": {
    "id": "123456789",
    "name": "TestUser",
    "tp": 0,
    "cc": 0,
    "rank": "Novice Trainer",
    "pokemon": {
      "1": {           // Bulbasaur (starter)
        "normal": 1,   // 1 regular Bulbasaur
        "shiny": 0     // 0 shiny Bulbasaur
      }
    },
    "trainers": {
      "youngster-gen4.png": true
    },
    "displayedPokemon": [1],
    "displayedTrainer": "youngster-gen4.png",
    "lastDaily": 0,
    "schemaVersion": 1
  }
}
```

### User Data with Shiny Starter
```javascript
{
  "987654321": {
    "id": "987654321",
    "name": "LuckyUser",
    "pokemon": {
      "4": {           // Charmander (shiny starter)
        "normal": 0,   // 0 regular
        "shiny": 1     // 1 shiny ✨
      }
    },
    "displayedPokemon": [4],
    // ... other fields
  }
}
```

### User Data with Additional Pokemon
```javascript
{
  "555555555": {
    "id": "555555555",
    "name": "ActiveUser",
    "pokemon": {
      "1": { "normal": 1, "shiny": 0 },   // Starter
      "25": { "normal": 3, "shiny": 1 },  // Caught later
      "6": { "normal": 2, "shiny": 0 }    // Caught later
    },
    "displayedPokemon": [1],  // Still showing starter
    // ... other fields
  }
}
```

## Troubleshooting

### Pokemon Not Appearing After Onboarding

**Check Logs For**:
```
🌱 User [ID] selected starter Pokemon ID: [number]
✅ Pokemon assigned - user.pokemon[ID]: { normal: 1, shiny: 0 }
```

If these messages are missing, the button handler may not be triggering.

**Verify**:
1. Interaction collector is active
2. User clicked a Pokemon button (not navigation)
3. No errors during button click

### Pokemon Lost After Bot Restart

**Check Logs For**:
```
💾 Saving trainer data for user [ID] after starter selection...
✅ Trainer data saved successfully
```

If save message is missing, data was not persisted.

**Check Discord Storage**:
1. Verify STORAGE_CHANNEL_ID is set correctly
2. Check bot has proper permissions
3. Verify backup file exists in storage channel

### DisplayedPokemon Array Empty

**Possible Causes**:
1. Array was cleared during validation
2. Pokemon IDs in wrong format

**Solution**: Arrays now support numeric IDs, should be fixed by the updates.

## Related Files

- `/commands/trainercard.js` - Onboarding flow implementation
- `/utils/schemaValidator.js` - Data validation logic
- `/utils/trainerDataHelper.js` - Data repair and sanitization
- `/test-onboarding-flow.js` - Automated test suite
- `/bot_final.js` - Main bot file with save logic
