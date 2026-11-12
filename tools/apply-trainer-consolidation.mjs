// ==========================================================
// tools/apply-trainer-consolidation.mjs
// Applies data/sprites/trainer-consolidation.json to the trainer registry
// (trainerSprites.json and its public copy): every folded file becomes
//   { "file": "twins-gen3.png", "disabled": true, "mergedInto": "twins.png" }
// so it is no longer offered (recruit, shop, picker) but its PNG still loads
// for any old link. Idempotent.
//
// Run: node tools/apply-trainer-consolidation.mjs [--check]
//   --check  exit 1 if a registry is not up to date; write nothing
// ==========================================================
import fs from "fs";
import { fileURLToPath } from "url";

const ROOT = new URL("..", import.meta.url);
const P = (p) => fileURLToPath(new URL(p, ROOT));
const CHECK = process.argv.includes("--check");
const { into } = JSON.parse(fs.readFileSync(P("data/sprites/trainer-consolidation.json"), "utf8"));

let stale = 0;
for (const rel of ["trainerSprites.json", "public/trainerSprites.json"]) {
  const raw = fs.readFileSync(P(rel), "utf8").replace(/\r\n/g, "\n");
  const reg = JSON.parse(raw);
  for (const entry of Object.values(reg)) {
    entry.sprites = entry.sprites.map((s) => {
      const file = typeof s === "string" ? s : s.file;
      // A file taken out of the map (an owner exception) goes back to being offered.
      if (!into[file]) return typeof s === "object" && s.mergedInto ? file : s;
      return { file, disabled: true, mergedInto: into[file] };
    });
  }
  const next = JSON.stringify(reg, null, 2) + (raw.endsWith("\n") ? "\n" : "");
  if (next === raw) continue;
  stale++;
  if (!CHECK) fs.writeFileSync(P(rel), next);
}
if (CHECK) {
  if (stale) { console.error(`❌ ${stale} trainer registry file(s) not consolidated; run node tools/apply-trainer-consolidation.mjs`); process.exit(1); }
  console.log("✅ trainer registry consolidation up to date");
} else console.log(`trainer consolidation: ${Object.keys(into).length} files folded; ${stale} registry file(s) written`);
