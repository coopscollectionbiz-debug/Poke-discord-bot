// ==========================================================
// tests/trainerConsolidation.test.js — generation consolidation of trainer
// sprites (data/sprites/trainer-consolidation.json, applied to the registry by
// tools/apply-trainer-consolidation.mjs) and the player migration
// (services/trainerConsolidation.js). Synthetic players only.
// ==========================================================

import fs from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const ROOT = new URL("../", import.meta.url);
const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, ROOT), "utf8"));
const { into } = read("data/sprites/trainer-consolidation.json");
const reg = read("trainerSprites.json");
const C = await import("../services/trainerConsolidation.js");
const N = await import("../services/notices.js");
const { grantTrainer } = await import("../services/assets.js");

const base = (f) => f.replace(/\.png$/, "").replace(/-.*$/, "");
const suffix = (f) => (f.replace(/\.png$/, "").match(/-(.+)$/) ?? [])[1] ?? "";
const entryOf = {}; for (const [k, e] of Object.entries(reg)) for (const s of e.sprites) entryOf[typeof s === "string" ? s : s.file] = { key: k, s };

section("Consolidation map and registry");
{
  const folded = Object.keys(into), targets = [...new Set(Object.values(into))];
  assertEqual(folded.length, 367, "367 game/generation versions fold (Beauty gen4dp, gen5bw2 and gen8 stay their own, owner exception)");
  assertEqual(targets.length, 149, "into 149 kept sprites");
  assertEqual(targets.filter((t) => into[t]), [], "no target is itself folded (no chains)");
  // Owner decision (2026-11-11): Brendan's Ruby/Sapphire and Emerald sprites are their own registry entries but game versions, so they fold into brendan.png.
  const CROSS = new Set(["brendan-rs.png", "brendan-e.png"]);
  assertEqual(folded.filter((f) => !CROSS.has(f) && entryOf[f]?.key !== entryOf[into[f]]?.key), [], "every other file folds within its own registry entry");
  assertEqual(folded.filter((f) => base(f) !== base(into[f])), [], "female variants never fold into male ones, or the reverse (same base name)");
  const GEN = /^(gen\d.*|rse|frlg|usum|lgpe)$/;
  assertEqual(folded.filter((f) => !CROSS.has(f) && suffix(f) && !GEN.test(suffix(f))), [], "only game/generation suffixes fold, never outfits");
  assertEqual(folded.filter((f) => !(typeof entryOf[f].s === "object" && entryOf[f].s.disabled && entryOf[f].s.mergedInto === into[f])), [], "every folded file is disabled with mergedInto in the registry");
  assertEqual(targets.filter((t) => typeof entryOf[t]?.s !== "string" && entryOf[t]?.s?.disabled), [], "every kept sprite is still offered");
  for (const f of ["steven-masters.png", "red-masters.png", "blue-masters.png", "acetrainerf.png", "beauty-gen4dp.png", "beauty-gen5bw2.png", "beauty-gen8.png", "brendan.png", "brendan-masters.png", "brendan-masters2.png", "brendan-contest.png", "elio-usum.png", "selene-usum.png"]) assertTrue(!into[f], `${f} does not fold (outfit, female variant or owner keeps every version)`);
  // Owner decisions for protagonists and rivals.
  const want = { "red-gen3.png": "red.png", "red-lgpe.png": "red.png", "blue-gen3.png": "blue.png", "blue-lgpe.png": "blue.png", "cheren.png": "cheren-gen5bw2.png", "dawn-gen4pt.png": "dawn.png", "lucas.png": "lucas-gen4pt.png", "may-gen3rs.png": "may.png", "wally.png": "wally-gen3.png", "blue-gen3champion.png": "blue.png", "blue-gen3two.png": "blue.png", "brendan-gen3.png": "brendan.png", "brendan-rs.png": "brendan.png", "brendan-e.png": "brendan.png" };
  assertEqual(Object.keys(want).filter((f) => into[f] !== want[f]), [], "protagonist/rival groups fold the way the owner chose");
  // New sprite and B2W2 art (frame 0 of the B2W2 animation, same 80×80 canvas).
  const pngSize = (rel) => { const b = fs.readFileSync(new URL(rel, ROOT)); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };
  assertTrue(reg.weirdlight?.tier === "Uncommon" && reg.weirdlight.sprites.includes("weirdlight.png"), "Weird Light (B2W2 Pokéstar Studios) is a new Uncommon trainer");
  // Their animations (data/sprites/trainer-animations.json) may need a slightly larger canvas.
  assertTrue(["weirdlight", "blue", "red", "lance", "misty"].every((n) => { const c = pngSize(`public/sprites/trainers_2/${n}.png`), [w, h] = c.split("x").map(Number); return w >= 80 && h >= 80 && w <= 96 && h <= 96 && pngSize(`public/sprites/trainers_2/grayscale/${n}.png`) === c; }), "new and B2W2-swapped sprites are 80×80 or a little larger, with matching grayscale copies");
  assertTrue(fs.existsSync(new URL("public/sprites/trainers_2/twins-gen3.png", ROOT)), "folded PNGs stay on disk, so old links still load");
  let selectable = 0; for (const e of Object.values(reg)) for (const s of e.sprites) if (typeof s === "string" || !s.disabled) selectable++;
  assertEqual(selectable, 905, "905 trainer sprites are offered (1,271 before: −367 folded, +1 Weird Light)");
  assertTrue(fs.readFileSync(new URL("trainerSprites.json", ROOT), "utf8").replace(/\r\n/g, "\n") === fs.readFileSync(new URL("public/trainerSprites.json", ROOT), "utf8").replace(/\r\n/g, "\n"), "the public registry copy matches");
  let check = "";
  try { check = execFileSync(process.execPath, [fileURLToPath(new URL("tools/apply-trainer-consolidation.mjs", ROOT)), "--check"], { encoding: "utf8" }); } catch (err) { check = String(err.stdout || err.message); }
  assertTrue(check.includes("up to date"), "tools/apply-trainer-consolidation.mjs --check passes");
}

section("Player migration");
{
  // Owns only a folded version: gets the kept sprite.
  const a = { trainers: ["cynthia-gen4.png", "lass.png"], displayedTrainer: "cynthia-gen4.png" };
  const ra = C.consolidateUserTrainers(a, { now: 1 });
  assertEqual(a.trainers, ["cynthia.png", "lass.png"], "owner of cynthia-gen4 only now owns cynthia (unowned target is granted)");
  assertEqual(a.displayedTrainer, "cynthia.png", "a displayed folded trainer becomes its kept sprite");
  assertEqual(ra.granted, ["cynthia.png"], "reports the grant");
  const notes = N.peekNotices(a, N.NOTICE_KINDS.TRAINER_CONSOLIDATION);
  assertTrue(notes.length === 1 && /cynthia/.test(notes[0].text) && /displayed trainer is now cynthia/.test(notes[0].text), "one notice names the kept sprite and the displayed change");

  // Owns several versions and the target: collapses to one, nothing extra granted.
  const b = { trainers: ["twins-gen3.png", "twins-gen4.png", "twins.png", "youngster.png"], displayedTrainer: "youngster.png" };
  const rb = C.consolidateUserTrainers(b);
  assertEqual(b.trainers, ["twins.png", "youngster.png"], "several versions plus the kept sprite collapse to one copy");
  assertEqual(rb.granted, [], "nothing granted when the kept sprite was already owned");
  assertEqual(b.displayedTrainer, "youngster.png", "an unaffected displayed trainer is left alone");

  // Several versions, target not owned: granted exactly once.
  const c = { trainers: ["fisherman-gen3.png", "fisherman-gen4.png"] };
  C.consolidateUserTrainers(c);
  assertEqual(c.trainers, ["fisherman.png"], "two folded versions → one kept sprite, granted once");

  // Idempotent: a second pass changes nothing and adds no second notice.
  const before = JSON.stringify(a);
  const again = C.consolidateUserTrainers(a, { now: 2 });
  assertTrue(JSON.stringify(a) === before && again.removed.length === 0, "a second pass is a no-op (no second notice)");

  // Untouched players get no notice field at all.
  const d = { trainers: ["steven-masters.png", "acetrainerf.png"], displayedTrainer: "steven-masters.png" };
  C.consolidateUserTrainers(d);
  assertTrue(!("notices" in d) && d.trainers.length === 2, "players with nothing folded are untouched");

  // Case-insensitive, and a malformed record is ignored.
  const e = { trainers: ["Twins-Gen3.png"] };
  C.consolidateUserTrainers(e, { notice: false });
  assertEqual(e.trainers, ["twins.png"], "matching is case-insensitive");
  assertEqual(C.consolidateUserTrainers({ trainers: "nope" }).removed, [], "a malformed record is ignored");

  // New grants of a folded file land on the kept sprite.
  const g = { trainers: [] };
  grantTrainer(g, "twins-gen3.png");
  assertEqual(g.trainers, ["twins.png"], "grantTrainer of a folded file grants the kept sprite");
  assertEqual(grantTrainer(g, "twins-gen4.png"), false, "granting another folded version of an owned group is not new");
}

finish();
