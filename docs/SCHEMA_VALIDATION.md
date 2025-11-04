# Schema Validation & Data Integrity System

## Overview

This system provides comprehensive validation, migration, and repair capabilities for the `trainerData.json` file, ensuring data integrity and consistency across the Coop's Collection Discord Bot.

## Components

### 1. Schema Validator (`utils/schemaValidator.js`)

The core validation module that defines the data schema and provides validation functions.

#### Key Functions:

- **`validateField(value, schema, fieldName)`**: Validates a single field against its schema definition
- **`validateUserSchema(userData, userId)`**: Validates an entire user data object
- **`validatePokemonCollection(pokemon, userId)`**: Validates the pokemon collection
- **`validateTrainersCollection(trainers, userId)`**: Validates the trainers collection
- **`validateTrainerData(trainerData)`**: Validates the entire trainerData object
- **`createDefaultUserData(userId, username)`**: Creates a default user data object
- **`logValidationResults(validationResult, context)`**: Logs validation results

#### Schema Definition:

```javascript
{
  id: string (required),
  name: string (required, default: 'Trainer'),
  tp: number (required, min: 0, default: 0),
  cc: number (required, min: 0, default: 0),
  rank: string (required, default: 'Novice Trainer'),
  pokemon: object (required, default: {}),
  trainers: object (required, default: {}),
  displayedPokemon: array (required, default: []),
  displayedTrainer: any (optional, default: null),
  lastDaily: number (required, min: 0, default: 0),
  schemaVersion: number (optional, default: 1)
}
```

### 2. Schema Migration (`utils/schemaMigration.js`)

Handles schema versioning and migrations between versions.

#### Key Functions:

- **`getSchemaVersion(userData)`**: Gets the schema version of user data
- **`migrateUserData(userData, userId)`**: Migrates a user's data to the current schema version
- **`migrateTrainerData(trainerData)`**: Migrates entire trainerData object
- **`checkMigrationNeeded(trainerData)`**: Checks if migration is needed
- **`logMigrationResults(stats)`**: Logs migration statistics

#### Current Schema Version: 1

Migration from version 0 to version 1 ensures all required fields exist with appropriate defaults.

### 3. Trainer Data Helper (`utils/trainerDataHelper.js`)

Enhanced helper functions with validation and repair capabilities.

#### Key Functions:

- **`initializeUserSchema(userId, username)`**: Creates a new user with default values
- **`ensureUserData(trainerData, userId, username, options)`**: Ensures user exists with valid schema
  - Options: `{ validate: boolean, migrate: boolean, debug: boolean }`
- **`normalizeAllUsers(trainerData, options)`**: Normalizes all users in trainerData
  - Options: `{ validate: boolean, migrate: boolean, repair: boolean }`
- **`sanitizeBeforeSave(trainerData)`**: Sanitizes data before saving
- **`repairTrainerData(trainerData)`**: Deep repair of malformed data

### 4. Data Repair Script (`repairTrainerData.js`)

One-time script to clean and repair corrupted trainerData.json.

#### Usage:

```bash
npm run repair
# or
node repairTrainerData.js
```

#### What it does:

1. Loads existing trainerData.json
2. Creates a timestamped backup
3. Runs initial validation
4. Performs schema migrations
5. Executes deep repair
6. Runs final validation
7. Saves repaired data
8. Provides detailed statistics

### 5. Data Cleanup Script (`cleanupTrainerData.js`)

One-time script to remove deprecated fields from trainerData.json.

#### Usage:

```bash
npm run cleanup
# or
node cleanupTrainerData.js
```

#### What it does:

1. Loads existing trainerData.json
2. Creates a timestamped backup
3. Removes deprecated fields not in the current schema:
   - `lastClaim` (deprecated)
   - `questProgress` (deprecated)
   - `coins` (deprecated)
   - `guildId` (deprecated)
   - `trainer` (deprecated)
   - Any other unknown fields
4. Keeps only valid schema fields:
   - `id`, `name`, `tp`, `cc`, `rank`
   - `pokemon`, `trainers`, `displayedPokemon`
   - `displayedTrainer`, `lastDaily`, `schemaVersion`
5. Logs all removed fields for review
6. Saves cleaned data back to trainerData.json

#### When to use:

- After schema changes to remove old fields
- To reduce file size and improve performance
- To clean up after deprecated features are removed
- When warned about unknown fields during validation

**Note**: The cleanup script is destructive. Always review the backup file if you need to restore any data.

## Integration

### Bot Initialization

The bot now validates and migrates data on load:

```javascript
// In bot_final.js loadTrainerData()
const migrationCheck = checkMigrationNeeded(loaded);
if (migrationCheck.needed) {
  const migrationResult = migrateTrainerData(loaded);
  logMigrationResults(migrationResult.stats);
  loaded = migrationResult.migratedData;
}

const validation = validateTrainerData(loaded);
logValidationResults(validation, 'load');
```

### Saving Data

Data is sanitized before every save:

```javascript
async function saveTrainerDataLocal(data) {
  const sanitized = sanitizeBeforeSave(data);
  await fs.writeFile(TRAINERDATA_PATH, JSON.stringify(sanitized, null, 2));
}
```

### Using ensureUserData

When accessing user data in commands:

```javascript
// Basic usage (with validation)
const user = ensureUserData(trainerData, userId, username);

// Without validation (for performance in loops)
const user = ensureUserData(trainerData, userId, username, { validate: false });

// With debug logging
const user = ensureUserData(trainerData, userId, username, { debug: true });
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:validation
npm run test:migration
npm run test:helper
npm run test:cleanup
```

### Test Coverage

- **test-schema-validation.js**: 26 tests for schema validation
- **test-schema-migration.js**: 13 tests for schema migration
- **test-trainer-data-helper.js**: 17 tests for helper functions
- **test-cleanup-trainer-data.js**: 32 tests for cleanup functionality

Total: **88 tests**

## Error Handling

### Validation Errors

When validation finds issues, it:
1. Logs detailed error messages
2. Attempts to correct the data automatically
3. Uses default values for missing/invalid fields
4. Tracks statistics about errors found

### Migration Errors

If migration fails for a user:
1. Falls back to creating default user data
2. Logs the error with user ID
3. Preserves the user's name if available
4. Continues processing other users

### Repair Logic

The repair system:
1. Migrates data to current schema version
2. Validates all fields
3. Corrects negative pokemon counts
4. Fixes invalid trainer values
5. Ensures displayedPokemon is an array
6. Provides detailed statistics

## Best Practices

### 1. Always Validate User Data

```javascript
// ✅ Good
const user = ensureUserData(trainerData, userId, username);

// ❌ Bad
const user = trainerData[userId] || {};
```

### 2. Sanitize Before Saving

```javascript
// ✅ Good
const sanitized = sanitizeBeforeSave(trainerData);
await save(sanitized);

// ❌ Bad
await save(trainerData);
```

### 3. Use Appropriate Options

```javascript
// For single user access (validate)
ensureUserData(trainerData, userId, username, { validate: true });

// For batch processing (skip validation for performance)
normalizeAllUsers(trainerData, { validate: false });

// For loading data (validate and repair)
normalizeAllUsers(trainerData, { validate: true, repair: true });
```

### 4. Handle Migration

Always check for and perform migrations when loading data:

```javascript
const migrationCheck = checkMigrationNeeded(trainerData);
if (migrationCheck.needed) {
  const result = migrateTrainerData(trainerData);
  trainerData = result.migratedData;
}
```

## Logging

### Validation Logging

```
🔍 Schema Validation Report [load]
==================================================
Total Users: 100
✅ Valid Users: 95
🔧 Repaired Users: 5
❌ Invalid Users: 0

⚠️ Field Error Summary:
  - tp: 3 users
  - pokemon: 2 users
==================================================
```

### Migration Logging

```
📦 Schema Migration Report
==================================================
Total Users: 100
✅ Up-to-date: 90
🔄 Migrated: 10
❌ Failed: 0

📊 Version Distribution:
  Version 0: 10 users
  Version 1: 90 users (current)
==================================================
```

## Future Schema Changes

### Adding a Migration

When making schema changes:

1. Increment `CURRENT_SCHEMA_VERSION` in `schemaValidator.js`
2. Add migration function in `schemaMigration.js`:

```javascript
const MIGRATIONS = {
  0: (userData, userId) => { /* v0 to v1 */ },
  1: (userData, userId) => { /* v1 to v2 */ },
  // New migration
  2: (userData, userId) => {
    console.log(`📦 Migrating user ${userId} from v2 to v3`);
    return {
      ...userData,
      newField: defaultValue,
      schemaVersion: 3
    };
  }
};
```

3. Update `USER_SCHEMA` in `schemaValidator.js`
4. Add tests for the new migration
5. Run repair script on production data

## Troubleshooting

### Data Won't Load

1. Check for JSON syntax errors
2. Run the repair script: `npm run repair`
3. Check logs for validation errors

### Users Missing Data

1. Check schema version with `getSchemaVersion()`
2. Run migration: `migrateTrainerData()`
3. Use `repairTrainerData()` for deep repair

### Tests Failing

1. Ensure Node.js version is 22.x
2. Check that all dependencies are installed
3. Review error messages for specific failures
4. Run individual test suites to isolate issues

## Performance Considerations

- **Validation** adds ~5-10ms overhead per user
- **Migration** is one-time per user when schema changes
- **Repair** is comprehensive but slow (run as needed, not on every load)

For performance-critical paths, use `{ validate: false }` option and rely on sanitization at save time.
