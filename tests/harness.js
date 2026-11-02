// ==========================================================
// tests/harness.js
// Shared assert helpers for the battle tests. Same ✅/❌ output as
// the older per-file harnesses; not a test file itself (run-tests.js
// only runs *.test.js).
// ==========================================================

let run = 0;
let passed = 0;
let failed = 0;

export function section(name) {
  console.log(`\n${name}`);
}

export function assertTrue(condition, message) {
  run++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

export function assertEqual(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assertTrue(ok, message);
  if (!ok) {
    console.error(`     Expected: ${JSON.stringify(expected)}`);
    console.error(`     Actual: ${JSON.stringify(actual)}`);
  }
}

export function assertBetween(value, lo, hi, message) {
  const ok = value >= lo && value <= hi;
  assertTrue(ok, `${message} (got ${value}, want ${lo}–${hi})`);
}

export function finish() {
  console.log(`\n${passed}/${run} passed`);
  if (failed > 0) process.exit(1);
}
