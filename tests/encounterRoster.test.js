// ==========================================================
// tests/encounterRoster.test.js
// The Trainer classes met in Trainer encounters (docs/superpowers/specs/
// 2026-11-10-trainer-encounters-design.md): generic classes only, never a
// /challenge opponent, each with a sprite that exists, a type theme, a
// Prize money base, and lines. The copy follows the house rules.
// ==========================================================

import fs from "fs";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { TRAINER_CLASSES, ACE_KEYS, REGULAR_KEYS, classSprite, NAMES } from "../utils/encounter/roster.js";
import { LINES, OVER_INTRO, RAN, LOST_INTEREST, STALE_LINE, fill } from "../utils/encounter/lines.js";
import { CHALLENGES } from "../utils/challenge/roster.js";
import { TYPE_ID_TO_NAME } from "../utils/battle/data.js";
import { ENCOUNTER } from "../utils/battle/tuning.js";

section("Tuning");
assertEqual(
  [ENCOUNTER.chance, ENCOUNTER.gapMs, ENCOUNTER.perDay, ENCOUNTER.answerMs, ENCOUNTER.minLevel, ENCOUNTER.maxLevel, ENCOUNTER.partySize, ENCOUNTER.aceShare],
  [0.01, 30 * 60 * 1000, 8, 2 * 60 * 1000, 5, 100, [3, 6], 0.5],
  "the spec's values",
);
assertEqual(ENCOUNTER.tiers.map((t) => [t.key, t.share, t.band]), [["under", 0.7, [-15, -2]], ["even", 0.2, [-2, 2]], ["over", 0.1, [5, 15]]], "the tiers");
assertEqual(ENCOUNTER.surprise, { share: 0.03, band: [10, 25] }, "the surprise");

section("Classes");
assertEqual(Object.keys(TRAINER_CLASSES).length, 35, "35 classes");
assertEqual(ACE_KEYS, ["acetrainer", "acetrainerf"], "two Ace Trainer classes");
assertTrue(REGULAR_KEYS.length === 33 && REGULAR_KEYS.every((k) => !TRAINER_CLASSES[k].ace), "the rest are regular");
assertTrue(Object.entries(TRAINER_CLASSES).every(([k, c]) => c.key === k), "keyed by their own key");
const challengeKeys = new Set(Object.values(CHALLENGES).flatMap((c) => c.opponents.map((o) => o.trainerKey)));
assertTrue(Object.values(TRAINER_CLASSES).every((c) => !challengeKeys.has(c.spriteKey)), "never a /challenge opponent");
assertTrue(Object.keys(TRAINER_CLASSES).every((k) => fs.existsSync(new URL(`../public/sprites/trainers_2/${classSprite(k)}`, import.meta.url))),
  "every sprite file exists");
assertEqual(classSprite("youngster"), "youngster-gen3.png", "the first enabled sprite, like the leaders");
assertEqual(["gentleman", "lady", "richboy", "beauty"].map((k) => TRAINER_CLASSES[k].base), [40, 40, 40, 40], "wealthy classes pay 40");
assertEqual([TRAINER_CLASSES.acetrainer.base, TRAINER_CLASSES.acetrainerf.base, TRAINER_CLASSES.youngster.base], [30, 30, 10], "Ace Trainers 30, the rest 10");
assertEqual(Object.values(TRAINER_CLASSES).filter((c) => c.base === 10).length, 29, "29 classes at 10");
const typeNames = new Set(Object.values(TYPE_ID_TO_NAME));
assertTrue(Object.values(TRAINER_CLASSES).every((c) => c.types.every((t) => typeNames.has(t))), "themes are real type names");
assertTrue(Object.values(TRAINER_CLASSES).every((c) => c.ace ? c.types.length === 0 : c.types.length > 0), "Ace Trainers carry any type; everyone else has a theme");
assertTrue(Object.values(TRAINER_CLASSES).every((c) => c.gender === "m" || c.gender === "f"), "a gender for names");

section("Names and lines");
assertTrue(NAMES.m.length >= 30 && NAMES.f.length >= 30, "30+ names each");
assertTrue([...NAMES.m, ...NAMES.f].every((n) => /^[A-Z][a-z]+$/.test(n)) && new Set([...NAMES.m, ...NAMES.f]).size === NAMES.m.length + NAMES.f.length,
  "one capitalized word each, no repeats");
assertTrue(Object.values(TRAINER_CLASSES).every((c) => LINES[c.lines]), "every class has a line set");
assertTrue(Object.keys(LINES).every((k) => Object.values(TRAINER_CLASSES).some((c) => c.lines === k)), "every line set is used");
assertTrue(Object.values(LINES).every((s) => s.intro.length >= 3 && s.lost.length >= 1 && s.won.length >= 1), "3 intros and 1+ after-battle line each way");
assertTrue(OVER_INTRO.length >= 10 && RAN.length >= 4 && LOST_INTEREST.length >= 4, "the shared pools");
const said = [...Object.values(LINES).flatMap((s) => [...s.intro, ...s.lost, ...s.won]), ...OVER_INTRO];
const all = [...said, ...RAN, ...LOST_INTEREST, STALE_LINE];
assertTrue(all.every((l) => !/[—–]/.test(l)), "no em or en dashes in copy");
assertTrue(all.every((l) => !/[“”‘’]/.test(l)), "straight quotes only");
assertTrue(said.every((l) => l.length <= 64), "every line fits one line of the text box (64 characters)");
assertEqual(new Set(said).size, said.length, "no line repeats");
assertTrue(RAN.every((t) => t.includes("{player}") && t.includes("{trainer}")) && LOST_INTEREST.every((t) => t.includes("{trainer}")),
  "templates name who they're about");
assertEqual(fill("{player} ran away from {trainer}.", { player: "Ash", trainer: "Youngster Joey" }), "Ash ran away from Youngster Joey.", "fill");

finish();
