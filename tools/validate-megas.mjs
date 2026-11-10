// ==========================================================
// tools/validate-megas.mjs — release gate for the Mega Evolution data
// (catalogue, stones/items, sprites + SHA-256, ability manifest).
// Run: npm run validate:megas   (exit 1 on any problem)
// ==========================================================

import { megaProblems } from "./lib/megaValidation.mjs";

const problems = await megaProblems();
if (problems.length) {
  console.error(`❌ ${problems.length} Mega problem(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("✅ Mega catalogue, stones, sprites and ability manifest are valid.");
