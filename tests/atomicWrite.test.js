// ==========================================================
// tests/atomicWrite.test.js
// Basic unit tests for atomicWrite functionality
// ==========================================================

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { atomicWrite, atomicWriteJson, isLocked } from "../utils/atomicWrite.js";

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
const testDir = path.join("/tmp", "atomicwrite-tests");
const testFile = path.join(testDir, "test.json");

async function setup() {
  await fs.mkdir(testDir, { recursive: true });
}

async function cleanup() {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Run tests
async function runTests() {
  console.log("🚀 Starting atomicWrite tests\n");
  console.log("=" .repeat(50));

  await setup();

  try {
    // Test 1: Basic atomicWrite
    await test("atomicWrite creates file with content", async () => {
      const content = "test content";
      await atomicWrite(testFile, content);
      
      const exists = await fs.access(testFile).then(() => true).catch(() => false);
      assertTrue(exists, "File should exist");
      
      const read = await fs.readFile(testFile, "utf8");
      assertEqual(read, content, "Content should match");
      
      await fs.unlink(testFile);
    });

    // Test 2: atomicWriteJson
    await test("atomicWriteJson writes valid JSON", async () => {
      const data = { name: "test", value: 42, nested: { key: "value" } };
      await atomicWriteJson(testFile, data);
      
      const exists = await fs.access(testFile).then(() => true).catch(() => false);
      assertTrue(exists, "File should exist");
      
      const read = JSON.parse(await fs.readFile(testFile, "utf8"));
      assertEqual(read, data, "JSON should match");
      
      await fs.unlink(testFile);
    });

    // Test 3: Overwrite existing file
    await test("atomicWriteJson overwrites existing file", async () => {
      const data1 = { version: 1 };
      const data2 = { version: 2, extra: "field" };
      
      await atomicWriteJson(testFile, data1);
      await atomicWriteJson(testFile, data2);
      
      const read = JSON.parse(await fs.readFile(testFile, "utf8"));
      assertEqual(read, data2, "Should have new content");
      
      await fs.unlink(testFile);
    });

    // Test 4: Lock detection
    await test("isLocked returns false for unlocked file", async () => {
      const locked = isLocked(testFile);
      assertEqual(locked, false, "File should not be locked initially");
    });

    // Test 5: Multiple writes succeed
    await test("Multiple sequential writes succeed", async () => {
      for (let i = 0; i < 5; i++) {
        await atomicWriteJson(testFile, { iteration: i });
      }
      
      const read = JSON.parse(await fs.readFile(testFile, "utf8"));
      assertEqual(read.iteration, 4, "Should have last iteration");
      
      await fs.unlink(testFile);
    });

    // Test 6: Handles nested directories
    await test("atomicWriteJson creates file in nested directory", async () => {
      const nestedFile = path.join(testDir, "subdir", "nested.json");
      await fs.mkdir(path.dirname(nestedFile), { recursive: true });
      
      const data = { nested: true };
      await atomicWriteJson(nestedFile, data);
      
      const exists = await fs.access(nestedFile).then(() => true).catch(() => false);
      assertTrue(exists, "Nested file should exist");
      
      const read = JSON.parse(await fs.readFile(nestedFile, "utf8"));
      assertEqual(read, data, "Nested JSON should match");
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
