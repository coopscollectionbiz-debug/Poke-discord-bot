// ==========================================================
// tests/customCopies.test.js — TM system phase T1: customized copies in
// teams, movesets, battles and the Pokémon detail view.
//
// Nothing creates customized copies yet (teaching is phase T4), so the
// records here are built by hand. The first section proves that players
// without them are completely unaffected.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { normalizeCustomPokemon, slotCopyUid, plainCount } from "../services/ownership.js";
import { prepareTeamSelection, normalizeDisplayedTeam } from "../services/megaTeam.js";
import { normalizeBattleTeam } from "../services/battleTeam.js";
import { learnableMoves, chosenMoves, validateMoveset, setMoveset, tmMovesFor } from "../services/movesets.js";
import { buildTeam, buildBattleTeam } from "../utils/battle/runBattle.js";
import { simulateBattle } from "../utils/battle/sim.js";
import { pokemonDetail } from "../services/pokemonDetail.js";
import { validateUserSchema } from "../utils/userSchema.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const B = "c_BBBBBBBBBB", C = "c_CCCCCCCCCC";
const rec = (uid, speciesId, variant, tmMoves, extra = {}) => ({ uid, speciesId, variant, tmMoves, rev: 1, history: [], createdAt: 1, ...extra });

function player() {
  return {
    pokemon: { 6: { normal: 3, shiny: 0 }, 25: { normal: 1, shiny: 0 } },
    training: { "6:normal": { exp: 50 ** 3 }, "25:normal": { exp: 30 ** 3 } },
    customPokemon: {
      [B]: rec(B, 6, "normal", ["thunderpunch"], { createdAt: 1 }),
      [C]: rec(C, 6, "normal", ["dragonclaw"], { createdAt: 2 }),
    },
    displayedPokemon: [{ id: 6, variant: "normal", uid: B }, { id: 25, variant: "normal" }],
    movesets: { display: { [`u:${B}`]: ["thunderpunch", "flamethrower"] }, battle: {} },
  };
}

section("players without customized copies are unaffected");
{
  const u = { pokemon: { 6: { normal: 2, shiny: 0 } }, displayedPokemon: [{ id: 6, variant: "normal" }], movesets: { display: { "6:normal": ["flamethrower"] } } };
  const before = clone(u);
  assertEqual(normalizeCustomPokemon(u), { changed: false, quarantined: 0, suspended: 0, restored: 0 }, "normalizer reports no change");
  assertEqual(u, before, "record byte-identical; customPokemon never created");
  assertEqual(tmMovesFor(u, 6, "normal"), [], "a plain line has no TM moves");
  assertTrue(learnableMoves(u, 6, "normal").every((m) => m.source === "level"), "learnable moves are level-up only");
  const team = buildTeam(u);
  assertEqual(Object.keys(team[0]).sort(), ["level", "name", "speciesId", "variant"], "battle members carry no new fields (no uid)");
  assertEqual(prepareTeamSelection(u, [{ id: 6, variant: "normal" }]).team, [{ id: 6, variant: "normal" }], "team selection unchanged");
}

section("normalizer: quarantine, invariant I-1, slot and moveset cleanup");
{
  const u = player();
  u.customPokemon.bad_key = { uid: "bad_key" };
  u.customPokemon.c_XXXXXXXXXX = rec("c_XXXXXXXXXX", 99999, "normal", []);
  u.customPokemon.c_YYYYYYYYYY = rec("c_YYYYYYYYYY", 6, "normal", ["a", "a"], { createdAt: 3 });
  const r = normalizeCustomPokemon(u);
  assertEqual(r.quarantined, 2, "malformed key and unknown species are quarantined");
  assertEqual(u.customPokemonLegacy.map((e) => e.reason).sort(), ["bad uid", "unknown species"], "with reasons, not deleted silently");
  assertEqual(u.customPokemon.c_YYYYYYYYYY.tmMoves, ["a"], "duplicate TM moves collapsed");
  assertEqual(r.suspended, 0, "3 Charizards, 3 records → none suspended");

  // Rollback scenario: old code donated a copy without knowing about records.
  u.pokemon[6].normal = 2;
  const r2 = normalizeCustomPokemon(u);
  assertEqual([r2.suspended, u.customPokemon.c_YYYYYYYYYY.suspended], [1, "invariant"], "the NEWEST excess record is suspended, not deleted");
  assertEqual([u.customPokemon[B].suspended, u.customPokemon[C].suspended], [undefined, undefined], "older records keep their copies");
  assertEqual(plainCount(u, 6, "normal"), 0, "suspended records don't count against copies");
  u.pokemon[6].normal = 3;
  const r3 = normalizeCustomPokemon(u);
  assertEqual([r3.restored, u.customPokemon.c_YYYYYYYYYY.suspended], [1, undefined], "restored when the copy count comes back");
  const again = clone(u);
  assertEqual(normalizeCustomPokemon(u).changed, false, "idempotent");
  assertEqual(u, again, "second run changes nothing");

  const v = player();
  v.displayedPokemon.push({ id: 25, variant: "normal", uid: C }); // C is a Charizard, not a Pikachu
  v.battleTeam = [{ id: 6, variant: "normal", uid: "c_ZZZZZZZZZZ" }];
  v.movesets.battle["u:c_ZZZZZZZZZZ"] = ["slash"];
  normalizeCustomPokemon(v);
  assertEqual([v.displayedPokemon[0].uid, v.displayedPokemon[2].uid, v.battleTeam[0].uid], [B, undefined, undefined], "slot uids kept only for a valid copy of that exact line");
  assertEqual(v.movesets.battle["u:c_ZZZZZZZZZZ"], undefined, "orphan per-copy movesets dropped");

  const w = { pokemon: {}, customPokemon: ["nope"] };
  normalizeCustomPokemon(w);
  assertEqual(["customPokemon" in w, w.customPokemonLegacy.length], [false, 1], "a non-object field is quarantined");
  const s = { pokemon: { 6: { normal: 1 } }, customPokemon: { [B]: rec(B, 6, "normal", []) } };
  validateUserSchema(s, "1", "x");
  assertTrue(!!s.customPokemon[B], "validateUserSchema runs the normalizer and keeps valid records");
}

section("teams: slots naming a copy");
{
  const u = player();
  assertEqual(slotCopyUid(u, { id: 6, variant: "normal", uid: B }), B, "valid copy accepted");
  assertEqual(slotCopyUid(u, { id: 6, variant: "shiny", uid: B }), null, "wrong variant refused");
  assertEqual(slotCopyUid(u, { id: 6, variant: "normal", uid: "__proto__" }), null, "forged uid refused");
  const ok = prepareTeamSelection(u, [{ id: 6, variant: "normal", uid: C }, { id: 25, variant: "normal" }]);
  assertEqual(ok.team, [{ id: 6, variant: "normal", uid: C }, { id: 25, variant: "normal" }], "dashboard team with a copy uid is accepted");
  assertEqual(prepareTeamSelection(u, [{ id: 25, variant: "normal", uid: C }]).code, "unknown_copy", "a copy of another line is refused");
  assertEqual(prepareTeamSelection(u, [{ id: 6, variant: "normal", uid: "c_NONEXISTEN" }]).code, "unknown_copy", "an unknown copy is refused");
  assertEqual(prepareTeamSelection(u, [{ id: 6, variant: "normal", uid: B }, { id: 6, variant: "normal", uid: C }]).team.length, 1, "a line still appears once per team");
  const t = player();
  t.displayedPokemon[0].uid = "c_ZZZZZZZZZZ";
  normalizeDisplayedTeam(t);
  assertEqual(t.displayedPokemon[0], { id: 6, variant: "normal" }, "Display normalizer drops an invalid uid, keeps the slot");
  t.battleTeam = [{ id: 6, variant: "normal", uid: C }];
  normalizeBattleTeam(t);
  assertEqual(t.battleTeam, [{ id: 6, variant: "normal", uid: C }], "Battle team normalizer keeps a valid uid");
}

section("movesets: TM moves belong to the copy, selections per copy and team");
{
  const u = player();
  assertEqual(tmMovesFor(u, 6, "normal", { uid: B }), ["thunderpunch"], "copy B's TM move");
  assertTrue(learnableMoves(u, 6, "normal", { uid: B }).some((m) => m.id === "thunderpunch" && m.source === "tm"), "B can equip Thunder Punch");
  assertTrue(!learnableMoves(u, 6, "normal", { uid: C }).some((m) => m.id === "thunderpunch"), "C cannot (it learned Dragon Claw)");
  assertTrue(!learnableMoves(u, 6, "normal").some((m) => m.source === "tm"), "plain Charizards have no TM moves");
  assertEqual(validateMoveset(u, 6, "normal", ["thunderpunch"]).code, "not_learned", "plain line can't equip B's TM move");
  assertEqual(validateMoveset(u, 6, "normal", ["thunderpunch"], { uid: C }).code, "not_learned", "C can't equip B's TM move");
  assertEqual(validateMoveset(u, 6, "normal", ["thunderpunch"], { uid: "c_ZZZZZZZZZZ" }).code, "unknown_copy", "unknown copy refused");
  const v = validateMoveset(u, 6, "normal", ["dragonclaw", "flamethrower"], { uid: C });
  assertTrue(v.ok, "C can equip its own TM move");
  setMoveset(u, "battle", 6, "normal", v.moves, { uid: v.uid });
  assertEqual(u.movesets.battle[`u:${C}`], ["dragonclaw", "flamethrower"], "stored under the copy's key");
  assertEqual(chosenMoves(u, "battle", 6, "normal", { uid: C }), ["dragonclaw", "flamethrower"], "C's Battle team moves");
  assertEqual(chosenMoves(u, "battle", 6, "normal"), null, "the plain line's Battle selection is unaffected");
  u.movesets.display["6:normal"] = ["flamethrower"];
  assertEqual(chosenMoves(u, "display", 6, "normal", { uid: C }), ["flamethrower"], "a copy without its own selection uses the line's");
  u.movesets.display["6:normal"] = ["thunderpunch"];
  assertEqual(chosenMoves(u, "display", 6, "normal"), null, "a TM move stored on the line key is ignored for plain copies");
}

section("battles use the copy's moves; snapshots keep them");
{
  const u = player();
  const team = buildTeam(u);
  assertEqual([team[0].uid, team[0].moves], [B, ["thunderpunch", "flamethrower"]], "Display slot naming B fights with B's moves");
  assertEqual(team[1].uid, undefined, "a plain slot carries no uid");
  u.battleTeam = [{ id: 6, variant: "normal", uid: C }];
  u.movesets.battle[`u:${C}`] = ["dragonclaw"];
  const ranked = buildBattleTeam(u);
  assertEqual([ranked[0].uid, ranked[0].moves, ranked[0].level], [C, ["dragonclaw"], 50], "ranked: C's TM move at Lv 50");
  const opp = buildTeam({ pokemon: { 25: { normal: 1 } }, displayedPokemon: [{ id: 25, variant: "normal" }] });
  const result = simulateBattle({ sides: [{ members: team }, { members: opp }], seed: 42 });
  assertTrue(result.winner === 0 || result.winner === 1, "a battle with a TM-trained member completes");
  const used = JSON.stringify(result).includes("Thunder Punch") || JSON.stringify(result).includes("Flamethrower");
  assertTrue(used, "the battle log uses the copy's chosen moves");
  u.displayedPokemon = [{ id: 6, variant: "normal" }];
  assertEqual(buildTeam(u)[0].moves, undefined, "removed from the team slot → the copy keeps its moves, the plain slot uses automatic moves");
  assertEqual(u.customPokemon[B].tmMoves, ["thunderpunch"], "TM moves stay on the copy after leaving a team");
}

section("Pokémon detail lists trained copies");
{
  const u = player();
  const d = pokemonDetail(u, 6).body.copies.normal;
  assertEqual([d.count, d.plain, d.trained.length], [3, 1, 2], "3 Charizards: 1 untrained, 2 trained");
  const b = d.trained.find((c) => c.uid === B);
  assertEqual([b.rev, b.tmMoves.map((m) => m.name), b.teams], [1, ["Thunder Punch"], { display: 1, battle: null }], "copy B: rev, TM moves, team slot");
  assertTrue(b.learnable.some((m) => m.id === "thunderpunch" && m.source === "tm"), "its learnable list includes its TM move");
  assertTrue(!d.learnable.some((m) => m.source === "tm"), "the line's (plain) learnable list does not");
  const plainOnly = pokemonDetail({ pokemon: { 25: { normal: 2 } } }, 25).body.copies.normal;
  assertEqual([plainOnly.plain, plainOnly.trained], [2, []], "no trained copies → plain = count, trained = []");
}

finish();
