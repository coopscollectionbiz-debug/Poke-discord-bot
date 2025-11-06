// ==========================================================
// run-tests.js
// Test runner for Coop's Collection Discord Bot
// ==========================================================

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runTestFile(testFile) {
  return new Promise((resolve, reject) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Running: ${testFile}`);
    console.log("=".repeat(60));

    const child = spawn("node", [testFile], {
      cwd: __dirname,
      stdio: "inherit",
      env: process.env
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(testFile);
      } else {
        reject(new Error(`${testFile} failed with code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

async function findTestFiles() {
  const testsDir = join(__dirname, "tests");
  try {
    const files = await fs.readdir(testsDir);
    return files
      .filter(f => f.endsWith(".test.js"))
      .map(f => join(testsDir, f));
  } catch (err) {
    console.warn("No tests directory found or error reading tests:", err.message);
    return [];
  }
}

async function main() {
  console.log("🧪 Coop's Collection Bot - Test Runner\n");

  const testFiles = await findTestFiles();

  if (testFiles.length === 0) {
    console.log("⚠️  No test files found in tests/ directory");
    process.exit(0);
  }

  console.log(`Found ${testFiles.length} test file(s):\n`);
  testFiles.forEach(f => console.log(`  - ${f}`));

  const results = {
    passed: [],
    failed: []
  };

  for (const testFile of testFiles) {
    try {
      await runTestFile(testFile);
      results.passed.push(testFile);
    } catch (err) {
      console.error(`\n❌ ${testFile} failed:`, err.message);
      results.failed.push(testFile);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 Test Summary");
  console.log("=".repeat(60));
  console.log(`✅ Passed: ${results.passed.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  console.log(`📝 Total:  ${testFiles.length}\n`);

  if (results.failed.length > 0) {
    console.log("Failed tests:");
    results.failed.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("✅ All tests passed!\n");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
