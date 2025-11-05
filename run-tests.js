#!/usr/bin/env node
// ==========================================================
// run-tests.js
// Test runner for all schema validation tests
// ==========================================================

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tests = [
  'test-schema-validation.js',
  'test-schema-migration.js',
  'test-trainer-data-helper.js',
  'test-trainercard-dataloader.js',
  'test-cleanup-trainer-data.js',
  'test-button-handlers.js',
  'test-deprecated-fields.js',
  'test-onboarding-flow.js'
];

let totalPassed = 0;
let totalFailed = 0;

async function runTest(testFile) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${testFile}`);
    console.log('='.repeat(60));

    const testPath = join(__dirname, testFile);
    const child = spawn('node', [testPath], { stdio: 'inherit' });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ passed: true, file: testFile });
      } else {
        resolve({ passed: false, file: testFile });
      }
    });
  });
}

async function main() {
  console.log('🧪 Running All Schema Validation Tests\n');
  
  const results = [];
  
  for (const testFile of tests) {
    const result = await runTest(testFile);
    results.push(result);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Overall Test Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`\nTest Suites:`);
  results.forEach(r => {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} ${r.file}`);
  });
  
  console.log(`\n${passed} test suites passed, ${failed} failed`);
  console.log('='.repeat(60));
  
  if (failed > 0) {
    console.log('\n❌ Some tests failed\n');
    process.exit(1);
  } else {
    console.log('\n🎉 All test suites passed!\n');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
