// ==========================================================
// tests/showcaseTeam.test.js: the Showcase team (services/showcaseTeam.js).
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { normalizeShowcase, prepareShowcaseSelection } from "../services/showcaseTeam.js";
import { addCopy, normalizeBox, isOnTeam } from "../services/box.js";
import { removeCopies } from "../services/ownership.js";
import { validateUserSchema } from "../utils/userSchema.js";

const ids = (team) => team.map((s) => `${s.id}:${s.variant}`);

section("launch: filled once from the Casual team");
{
  const u = { pokemon: { 10: { normal: 2, shiny: 0 }, 25: { normal: 0, shiny: 1 } }, displayedPokemon: [{ id: 10, variant: "normal" }, { id: 25, variant: "shiny" }] };
  normalizeBox(u);
  assertTrue(normalizeShowcase(u).filled, "first run fills it");
  assertEqual(ids(u.showcaseTeam), ["10:normal", "25:shiny"], "a copy of the current team");
  assertTrue(u.showcaseTeam.every((s) => u.box[s.uid]), "each slot names a copy");
  u.showcaseTeam = [];
  assertTrue(!normalizeShowcase(u).filled && u.showcaseTeam.length === 0, "an emptied Showcase is never refilled");
}

section("repeats: one copy per slot");
{
  const u = { pokemon: {} };
  const a = addCopy(u, 10, "normal"), b = addCopy(u, 10, "normal");
  u.showcaseTeam = [{ id: 10, variant: "normal" }, { id: 10, variant: "normal" }, { id: 10, variant: "normal" }];
  normalizeShowcase(u);
  assertEqual(u.showcaseTeam.length, 2, "two Caterpie copies fill two slots; the third slot has no copy and goes");
  assertEqual(new Set(u.showcaseTeam.map((s) => s.uid)), new Set([a.uid, b.uid]), "two different copies");
  assertTrue(isOnTeam(u, a.uid) && isOnTeam(u, b.uid), "Showcase copies count as on a team");
  assertEqual(removeCopies(u, { id: 10, variant: "normal", n: 1 }).code, "on_team", "so they can't be donated");
  const before = JSON.stringify(u.showcaseTeam);
  normalizeShowcase(u);
  assertEqual(JSON.stringify(u.showcaseTeam), before, "idempotent");
}

section("saving from the dashboard");
{
  const u = { pokemon: {} };
  const a = addCopy(u, 10, "normal");
  addCopy(u, 10, "normal");
  addCopy(u, 25, "shiny");
  const ok = prepareShowcaseSelection(u, [{ id: 10, variant: "normal", uid: a.uid }, { id: 10, variant: "normal" }, { id: 25, variant: "shiny" }]);
  assertTrue(ok.ok && ok.team.length === 3 && ok.team[0].uid === a.uid && ok.team[1].uid !== a.uid, "repeats get different copies; a named copy is kept");
  assertEqual(prepareShowcaseSelection(u, [{ id: 10, variant: "normal" }, { id: 10, variant: "normal" }, { id: 10, variant: "normal" }]).code, "no_copy_left", "three Caterpie slots with two copies: refused");
  assertEqual(prepareShowcaseSelection(u, [{ id: 10, variant: "normal", uid: a.uid }, { id: 10, variant: "normal", uid: a.uid }]).code, "duplicate_copy", "one copy can't fill two slots");
  assertEqual(prepareShowcaseSelection(u, [{ id: 7, variant: "normal" }]).code, "unowned", "unowned refused");
  assertEqual(prepareShowcaseSelection(u, Array(7).fill({ id: 10, variant: "normal" })).code, "bad_size", "at most 6");
  assertTrue(prepareShowcaseSelection(u, []).ok, "an empty Showcase is allowed");
  assertEqual(prepareShowcaseSelection(u, [{ id: 10, variant: "normal", mega: "nope!" }]).code, "bad_mega", "malformed Mega refused");
}

section("live load path");
{
  const u = validateUserSchema({ id: "1", pokemon: { 4: { normal: 1, shiny: 0 } }, displayedPokemon: [{ id: 4, variant: "normal" }] }, "1", "A");
  assertEqual(ids(u.showcaseTeam), ["4:normal"], "validateUserSchema fills the Showcase at launch");
  assertEqual(u.showcaseTeam[0].uid, u.displayedPokemon[0].uid, "the same copy as the Casual slot (a copy may be on several teams)");
}

finish();
