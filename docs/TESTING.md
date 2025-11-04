# Testing Guide

## Overview

This project includes comprehensive unit tests for the schema validation, migration, and data integrity system.

## Test Suites

### 1. Schema Validation Tests (`test-schema-validation.js`)

Tests for the core validation functions.

**Coverage:**
- Field validation (7 tests)
- Default user data creation (1 test)
- User schema validation (4 tests)
- Pokemon collection validation (4 tests)
- Trainers collection validation (3 tests)
- Displayed pokemon validation (3 tests)
- Full trainer data validation (4 tests)

**Total: 26 tests**

### 2. Schema Migration Tests (`test-schema-migration.js`)

Tests for schema versioning and migration functions.

**Coverage:**
- Schema version detection (3 tests)
- User data migration (4 tests)
- Trainer data migration (3 tests)
- Migration detection (3 tests)

**Total: 13 tests**

### 3. Trainer Data Helper Tests (`test-trainer-data-helper.js`)

Tests for helper functions that manage trainer data.

**Coverage:**
- Schema initialization (2 tests)
- User data ensuring (4 tests)
- User normalization (4 tests)
- Data sanitization (2 tests)
- Data repair (5 tests)

**Total: 17 tests**

## Running Tests

### All Tests

```bash
npm test
```

### Individual Test Suites

```bash
# Schema validation tests only
npm run test:validation

# Schema migration tests only
npm run test:migration

# Helper function tests only
npm run test:helper
```

### Direct Execution

```bash
# Run specific test file
node test-schema-validation.js
node test-schema-migration.js
node test-trainer-data-helper.js

# Run all tests with custom runner
node run-tests.js
```

## Test Output

### Success

```
🧪 Running All Schema Validation Tests

============================================================
Running: test-schema-validation.js
============================================================

📋 validateField Tests:
✅ validateField: valid number field
✅ validateField: null required field uses default
...

============================================================
📊 Test Summary:
   ✅ Passed: 26
   ❌ Failed: 0
   Total: 26
============================================================

🎉 All tests passed!

============================================================
📊 Overall Test Summary
============================================================

Test Suites:
  ✅ test-schema-validation.js
  ✅ test-schema-migration.js
  ✅ test-trainer-data-helper.js

3 test suites passed, 0 failed
============================================================

🎉 All test suites passed!
```

### Failure

When tests fail, you'll see detailed error messages:

```
❌ validateField: negative number below min
   Error: Expected values to be strictly equal:
   -10 !== 0
```

## Writing New Tests

### Test Structure

```javascript
import assert from 'assert';
import { functionToTest } from './utils/module.js';

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

// Group related tests
console.log('\n📋 Feature Tests:');

test('should do something', () => {
  const result = functionToTest(input);
  assert.strictEqual(result, expected);
});

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary:');
console.log(`   ✅ Passed: ${testsPassed}`);
console.log(`   ❌ Failed: ${testsFailed}`);
console.log('='.repeat(60));

process.exit(testsFailed > 0 ? 1 : 0);
```

### Assertion Methods

Common assertions used in tests:

```javascript
// Equality
assert.strictEqual(actual, expected);
assert.deepStrictEqual(actualObject, expectedObject);

// Truthiness
assert(condition);
assert.ok(value);

// Type checks
assert.strictEqual(typeof value, 'string');
assert(Array.isArray(value));
```

### Adding a New Test Suite

1. Create `test-feature-name.js`
2. Import required modules
3. Write test functions
4. Add to `run-tests.js`:

```javascript
const tests = [
  'test-schema-validation.js',
  'test-schema-migration.js',
  'test-trainer-data-helper.js',
  'test-feature-name.js'  // Add new test
];
```

5. Add npm script to `package.json`:

```json
{
  "scripts": {
    "test:feature": "node test-feature-name.js"
  }
}
```

## Test Coverage

Current test coverage ensures:

- ✅ All validation functions work correctly
- ✅ Edge cases are handled (null, undefined, wrong types)
- ✅ Default values are applied correctly
- ✅ Migrations preserve existing data
- ✅ Repair logic fixes common issues
- ✅ Error messages are descriptive
- ✅ Statistics tracking is accurate

## Continuous Integration

Tests should be run:

- ✅ Before committing changes
- ✅ After adding new features
- ✅ When modifying validation logic
- ✅ Before deploying to production

## Debugging Failed Tests

### 1. Read the Error Message

```
❌ validateUserSchema: negative numbers are corrected
   Error: Expected values to be strictly equal:
   -100 !== 0
```

This tells you:
- Which test failed
- What was expected vs actual

### 2. Check the Test Code

Look at the specific test to understand what it's testing:

```javascript
test('validateUserSchema: negative numbers are corrected', () => {
  const userData = createDefaultUserData('12345', 'Test');
  userData.tp = -100;
  const result = validateUserSchema(userData, '12345');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.correctedData.tp, 0);  // This assertion failed
});
```

### 3. Add Debug Logging

```javascript
test('debug test', () => {
  const result = functionToTest(input);
  console.log('Result:', JSON.stringify(result, null, 2));
  assert.strictEqual(result.value, expected);
});
```

### 4. Run Individual Tests

```bash
node test-schema-validation.js
```

## Best Practices

### 1. Test One Thing at a Time

```javascript
// ✅ Good
test('validates positive numbers', () => {
  const result = validateField(100, numberSchema, 'field');
  assert.strictEqual(result.valid, true);
});

test('corrects negative numbers', () => {
  const result = validateField(-10, numberSchema, 'field');
  assert.strictEqual(result.correctedValue, 0);
});

// ❌ Bad
test('validates numbers', () => {
  // Testing multiple scenarios in one test
});
```

### 2. Use Descriptive Test Names

```javascript
// ✅ Good
test('validateField: negative number below min');

// ❌ Bad
test('test 1');
```

### 3. Test Edge Cases

```javascript
// Test normal cases
test('handles valid data', () => { ... });

// Test edge cases
test('handles null', () => { ... });
test('handles undefined', () => { ... });
test('handles empty object', () => { ... });
test('handles invalid type', () => { ... });
```

### 4. Keep Tests Independent

Each test should be able to run independently without relying on other tests.

```javascript
// ✅ Good
test('test 1', () => {
  const data = createTestData();
  // Test with data
});

test('test 2', () => {
  const data = createTestData();
  // Test with data
});

// ❌ Bad - tests depend on shared state
let sharedData;
test('test 1', () => {
  sharedData = createTestData();
});
test('test 2', () => {
  // Uses sharedData from test 1
});
```

## Performance

Tests run in approximately:
- Schema validation: ~200ms
- Schema migration: ~150ms
- Helper functions: ~250ms
- **Total: ~600ms**

## Future Improvements

Potential test enhancements:

- [ ] Add integration tests for bot commands
- [ ] Add performance benchmarks
- [ ] Add code coverage reporting
- [ ] Add automated test runs on PR
- [ ] Add stress tests with large datasets
- [ ] Add mutation testing

## Troubleshooting

### Tests Pass Locally But Fail in CI

- Check Node.js version (should be 22.x)
- Ensure all dependencies are installed
- Check for environment-specific issues

### Import Errors

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
```

**Solution:** Ensure `"type": "module"` is in `package.json`

### Assertion Errors

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal
```

**Solution:** Check that actual and expected values match exactly

## Support

For issues with tests:
1. Check this documentation
2. Review test code for examples
3. Check schema validation documentation
4. Open an issue with test output
