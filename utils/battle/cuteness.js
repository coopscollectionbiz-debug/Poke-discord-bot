// ==========================================================
// utils/battle/cuteness.js
// Cuteness (docs/superpowers/specs/2026-11-11-cuteness-design.md): each
// species' and Mega form's hand-written score from 0 to 10, a Team's
// average, and how much of the cute surge's chance it earns. The scores
// stay on the server: nothing a player can read includes them
// (tests/cuteness.test.js).
// ==========================================================

import fs from "fs";
import { CUTE } from "./tuning.js";

const DATA = JSON.parse(fs.readFileSync(new URL("../../data/battle/cuteness.json", import.meta.url), "utf8"));

/** A Team member's score. A slot fighting as a Mega (buildTeam sets megaForm only then) uses the Mega form's own score. */
export const memberCuteness = (m) => (m.megaForm ? DATA.megas[m.megaForm] : DATA.species[String(m.speciesId)]) ?? 0;

/** A Team's Cuteness: its members' average, so one Pokémon is the whole Team's. */
export const teamCuteness = (members) => (members.length ? members.reduce((t, m) => t + memberCuteness(m), 0) / members.length : 0);

/** 0 at CUTE.threshold or below, curving up to 1 at 10: fastest just above the threshold (CUTE in tuning.js says why). */
export const cuteFactor = (cuteness) => Math.min(1, Math.max(0, (cuteness - CUTE.threshold) / (10 - CUTE.threshold))) ** CUTE.curve;
