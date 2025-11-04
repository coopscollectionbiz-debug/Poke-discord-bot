# Schema Validation Quick Reference

## Quick Commands

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:validation   # Schema validation tests
npm run test:migration    # Migration tests
npm run test:helper       # Helper function tests

# Repair corrupted data
npm run repair
```

## Common Use Cases

### 1. Ensure User Exists

```javascript
import { ensureUserData } from './utils/trainerDataHelper.js';

// Basic usage (validates by default)
const user = ensureUserData(trainerData, userId, username);

// Without validation (faster)
const user = ensureUserData(trainerData, userId, username, { validate: false });
```

### 2. Validate Data Before Saving

```javascript
import { sanitizeBeforeSave } from './utils/trainerDataHelper.js';

// Always sanitize before saving
const cleanData = sanitizeBeforeSave(trainerData);
await saveToFile(cleanData);
```

### 3. Load and Validate Data

```javascript
import { normalizeAllUsers } from './utils/trainerDataHelper.js';
import { migrateTrainerData, checkMigrationNeeded } from './utils/schemaMigration.js';

// Load data
let data = await loadFromFile();

// Check if migration needed
const check = checkMigrationNeeded(data);
if (check.needed) {
  const result = migrateTrainerData(data);
  data = result.migratedData;
}

// Normalize and validate
data = normalizeAllUsers(data, { validate: true, repair: true });
```

### 4. Deep Repair Malformed Data

```javascript
import { repairTrainerData } from './utils/trainerDataHelper.js';

const result = repairTrainerData(trainerData);
const cleanData = result.repairedData;
console.log(`Repaired ${result.stats.repairedUsers} users`);
```

### 5. Validate Specific Collections

```javascript
import { 
  validatePokemonCollection,
  validateTrainersCollection 
} from './utils/schemaValidator.js';

// Validate pokemon
const pokemonResult = validatePokemonCollection(user.pokemon, userId);
if (!pokemonResult.valid) {
  user.pokemon = pokemonResult.correctedData;
}

// Validate trainers
const trainersResult = validateTrainersCollection(user.trainers, userId);
if (!trainersResult.valid) {
  user.trainers = trainersResult.correctedData;
}
```

## Schema Version

**Current Version:** 1

### Check Schema Version

```javascript
import { getSchemaVersion } from './utils/schemaMigration.js';

const version = getSchemaVersion(userData);
console.log(`User schema version: ${version}`);
```

### Migrate User Data

```javascript
import { migrateUserData } from './utils/schemaMigration.js';

const migrated = migrateUserData(userData, userId);
```

## User Data Structure

```javascript
{
  id: "123456789",              // Discord user ID (string)
  name: "Username",             // Discord username (string)
  tp: 0,                        // Trainer Points (number, min: 0)
  cc: 0,                        // Coop Coins (number, min: 0)
  rank: "Novice Trainer",       // Rank name (string)
  pokemon: {                    // Pokemon collection (object)
    "pikachu": 3,               //   pokemonId: count
    "charizard": 1
  },
  trainers: {                   // Trainers collection (object)
    "Ace Trainer": true,        //   trainerName: owned
    "Youngster": false
  },
  displayedPokemon: [           // Displayed pokemon (array)
    "pikachu"
  ],
  displayedTrainer: null,       // Displayed trainer (any, optional)
  lastDaily: 0,                 // Last daily claim timestamp (number)
  schemaVersion: 1              // Schema version (number, optional)
}
```

## Validation Rules

### Numbers
- Must be finite
- Must meet min/max constraints
- Negative values corrected to minimum

### Strings
- Must not be empty for required fields
- Control characters removed
- Length limits enforced

### Objects
- Must be plain objects (not arrays or null)
- Missing required objects replaced with `{}`

### Arrays
- Must be actual arrays
- Invalid entries filtered out
- Missing arrays replaced with `[]`

## Error Handling

### Validation Errors

Errors are automatically corrected:
- Missing fields → default values
- Invalid types → default values
- Out of range → min/max values
- Null required fields → default values

### Migration Errors

If migration fails:
- User data replaced with defaults
- Error logged with user ID
- Processing continues for other users

## Performance Tips

### For Single User Access
```javascript
// Use validation for safety
ensureUserData(trainerData, userId, username, { validate: true });
```

### For Batch Operations
```javascript
// Skip validation for performance
for (const userId of userIds) {
  ensureUserData(trainerData, userId, 'User', { validate: false });
}

// Validate all at once after
normalizeAllUsers(trainerData, { validate: true });
```

### For Loading Data
```javascript
// Full validation with repair on load
normalizeAllUsers(data, { 
  validate: true, 
  migrate: true, 
  repair: true 
});
```

### For Saving Data
```javascript
// Always sanitize before save
const clean = sanitizeBeforeSave(data);
```

## Logging Levels

### Quiet Mode
```javascript
// Minimal logging (default)
ensureUserData(trainerData, userId, username);
```

### Debug Mode
```javascript
// Detailed logging
ensureUserData(trainerData, userId, username, { debug: true });
```

### Validation Reports
```javascript
import { validateTrainerData, logValidationResults } from './utils/schemaValidator.js';

const result = validateTrainerData(trainerData);
logValidationResults(result, 'my-operation');
```

## Common Issues

### Issue: User data keeps resetting
**Solution:** Ensure you're saving the returned user object:
```javascript
// ✅ Correct
const user = ensureUserData(trainerData, userId, username);
user.tp += 10;

// ❌ Wrong
ensureUserData(trainerData, userId, username);
trainerData[userId].tp += 10; // May not exist
```

### Issue: Negative values not being caught
**Solution:** Use validation:
```javascript
// ✅ Correct
const user = ensureUserData(trainerData, userId, username, { validate: true });

// ❌ Wrong  
const user = ensureUserData(trainerData, userId, username, { validate: false });
user.tp = -100; // Won't be caught until save
```

### Issue: Migration not running
**Solution:** Check migration explicitly:
```javascript
import { checkMigrationNeeded, migrateTrainerData } from './utils/schemaMigration.js';

const check = checkMigrationNeeded(trainerData);
if (check.needed) {
  const result = migrateTrainerData(trainerData);
  trainerData = result.migratedData;
}
```

### Issue: Tests failing after changes
**Solution:** 
1. Run tests: `npm test`
2. Check error messages
3. Update schema if needed
4. Add new tests for new features

## Integration Checklist

When adding new features that modify user data:

- [ ] Update `USER_SCHEMA` in `schemaValidator.js` if adding fields
- [ ] Create migration if schema version changes
- [ ] Add validation for new fields
- [ ] Add tests for new functionality
- [ ] Update documentation
- [ ] Run repair script on test data
- [ ] Test with production-like data

## Resources

- [Full Documentation](./SCHEMA_VALIDATION.md)
- [Testing Guide](./TESTING.md)
- [Schema Validator Code](../utils/schemaValidator.js)
- [Migration Code](../utils/schemaMigration.js)
- [Helper Functions](../utils/trainerDataHelper.js)
