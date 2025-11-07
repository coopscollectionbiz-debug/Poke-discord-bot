// ==========================================================
// tests/saveQueue.test.js
// Integration tests for save queue functionality
// ==========================================================

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { enqueueSave, getQueueLength, shutdownFlush } from "../utils/saveQueue.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple test harness
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ✅ ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ ${message}`);
    console.error(`     Expected: ${JSON.stringify(expected)}`);
    console.error(`     Actual: ${JSON.stringify(actual)}`);
    testsFailed++;
  }
}

function assertTrue(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ ${message}`);
    testsFailed++;
  }
}

async function test(name, fn) {
  testsRun++;
  console.log(`\n🧪 Test ${testsRun}: ${name}`);
  try {
    await fn();
  } catch (err) {
    console.error(`  ❌ Test threw error: ${err.message}`);
    console.error(err.stack);
    testsFailed++;
  }
}

// Test setup
const testDir = path.join("/tmp", "savequeue-tests");
const testFile = path.join(testDir, "trainerData.json");

async function setup() {
  await fs.mkdir(testDir, { recursive: true });
  // Change to test directory so save queue uses it
  process.chdir(testDir);
}

async function cleanup() {
  try {
    // Change back to project root
    process.chdir(path.join(__dirname, ".."));
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Run tests
async function runTests() {
  console.log("🚀 Starting saveQueue integration tests\n");
  console.log("=" .repeat(50));

  await setup();

  try {
    // Test 1: Basic enqueue and save
    await test("enqueueSave writes data to file", async () => {
      const data = { user1: { tp: 100, cc: 50 } };
      
      await enqueueSave(data);
      
      // Wait for debounce to complete
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      const exists = await fs.access(testFile).then(() => true).catch(() => false);
      assertTrue(exists, "File should exist after save");
      
      if (exists) {
        const read = JSON.parse(await fs.readFile(testFile, "utf8"));
        assertEqual(read, data, "Saved data should match");
        await fs.unlink(testFile);
      }
    });

    // Test 2: Multiple rapid saves coalesce
    await test("Multiple rapid saves are coalesced", async () => {
      const data1 = { user1: { tp: 100 } };
      const data2 = { user1: { tp: 200 } };
      const data3 = { user1: { tp: 300 } };
      
      // Enqueue multiple saves rapidly
      enqueueSave(data1);
      enqueueSave(data2);
      await enqueueSave(data3);
      
      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      const read = JSON.parse(await fs.readFile(testFile, "utf8"));
      assertEqual(read.user1.tp, 300, "Should have latest value");
      
      await fs.unlink(testFile);
    });

    // Test 3: shutdownFlush completes pending saves
    await test("shutdownFlush completes pending saves", async () => {
      const data = { user1: { tp: 999 } };
      
      // Enqueue but don't wait for debounce
      enqueueSave(data);
      
      // Flush immediately
      const result = await shutdownFlush(5000);
      assertTrue(result, "Flush should complete successfully");
      
      const exists = await fs.access(testFile).then(() => true).catch(() => false);
      assertTrue(exists, "File should exist after flush");
      
      if (exists) {
        const read = JSON.parse(await fs.readFile(testFile, "utf8"));
        assertEqual(read.user1.tp, 999, "Flushed data should match");
      }
    });

  } finally {
    await cleanup();
  }

  console.log("\n" + "=".repeat(50));
  console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsRun} total`);
  
  if (testsFailed > 0) {
    console.log("\n❌ Some tests failed\n");
    process.exit(1);
  } else {
    console.log("\n✅ All tests passed!\n");
    process.exit(0);
  }
}

// Run tests
runTests().catch(err => {
  console.error("Fatal error running tests:", err);
  process.exit(1);
});
