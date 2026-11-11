// ==========================================================
// tests/animatedImports.test.js — the reviewed community animations that
// replaced static (rig) sprites: data/sprites/animated-imports.json, applied
// by tools/import-animated-sprites.mjs. Read-only checks.
// ==========================================================

import fs from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const DOC = read("../data/sprites/animated-imports.json");
const SPECIES = read("../data/sprites/sprites.json").species;
const MEGAS = read("../data/sprites/megas.json").forms;
const REPORT = read("../data/sprites/pokemon-idle-report.json");
const BLINKS = read("../data/sprites/pokemon-blinks.json");
const REVIEW = read("../data/sprites/pokemon-idle-review.json");
const { gifFrames } = await import("../tools/lib/spriteCodec.mjs");
const recOf = (e) => (e.target.startsWith("mega:") ? MEGAS[e.megaId] : SPECIES[String(e.dex)]);
const dirOf = (e) => (e.target.startsWith("mega:") ? "../public/sprites/pokemon/mega/" : "../public/sprites/pokemon/");

section("Import record");
assertEqual(DOC.entries.length, 170, "170 reviewed animations (109 species + 61 Megas)");
assertEqual(new Set(DOC.entries.map((e) => e.target)).size, DOC.entries.length, "one animation per Pokémon / Mega");
assertTrue(DOC.entries.every((e) => e.author && e.source && e.licence && e.shinyMethod), "every entry names its animator, source, terms and shiny method");
assertTrue(DOC.excluded.some((x) => x.target === "species:941"), "Kilowattrel is excluded with a reason (unrecoverable resample) and stays on the rig");

section("Files and manifests (tools/import-animated-sprites.mjs --check)");
let ok = true;
try { execFileSync(process.execPath, [fileURLToPath(new URL("../tools/import-animated-sprites.mjs", import.meta.url)), "--check"], { stdio: "pipe" }); } catch { ok = false; }
assertTrue(ok, "every GIF matches its recorded SHA-1, the manifests point at it as animated, and the grayscale is current");

section("Normal and shiny move together");
const bad = [];
for (const e of DOC.entries) {
  const N = gifFrames(fs.readFileSync(new URL(dirOf(e) + e.files.normal, import.meta.url)));
  const S = gifFrames(fs.readFileSync(new URL(dirOf(e) + e.files.shiny, import.meta.url)));
  if (N.frames.length < 2) bad.push(`${e.name} not animated`);
  if (N.width !== S.width || N.height !== S.height || N.frames.length !== S.frames.length || N.frames.some((f, i) => f.delayMs !== S.frames[i].delayMs)) bad.push(`${e.name} out of step`);
  if (N.width > 160 || N.height > 160 || N.width < 24 || N.height < 24) bad.push(`${e.name} size ${N.width}x${N.height}`);
  if (Buffer.compare(fs.readFileSync(new URL(dirOf(e) + e.files.normal, import.meta.url)), fs.readFileSync(new URL(dirOf(e) + e.files.shiny, import.meta.url))) === 0) bad.push(`${e.name} shiny = normal`);
}
assertEqual(bad, [], "every pair is animated, 24–160 px, distinct, and shares size, frame count and frame delays");

section("The rig steps aside");
const keys = new Set(DOC.entries.map((e) => e.target));
assertTrue(DOC.entries.every((e) => { const r = recOf(e); return r.normal.kind === "animated" && r.shiny.kind === "animated" && !r.normal.motion && !r.shiny.motion && !r.grayscale.motion; }), "imported sprites are animated art with no rig idle");
assertEqual(Object.keys(REPORT.rigs).filter((k) => keys.has(k)), [], "the rig report has no imported sprite");
assertEqual([...Object.keys(BLINKS.blinks), ...Object.keys(BLINKS.noBlink)].filter((k) => keys.has(k)), [], "pokemon-blinks.json lists no imported sprite");
assertEqual([...REVIEW.approved, ...Object.keys(REVIEW.faces), ...Object.keys(REVIEW.rigOff), ...Object.keys(REVIEW.noHead)].filter((k) => keys.has(k)), [], "pokemon-idle-review.json lists no imported sprite");

section("Credits");
const credits = fs.readFileSync(new URL("../public/credits/index.html", import.meta.url), "utf8");
assertTrue(credits.includes("<h2>Animated sprites</h2>"), "/credits has an Animated sprites section");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
assertEqual(DOC.entries.filter((e) => !credits.includes(`<td>${esc(e.name)}</td><td>${esc(e.author)}`)), [], "every imported animation is credited to its animator on /credits");

finish();
