// ==========================================================
// tests/movesets.test.js — chosen movesets, per team (services/movesets.js)
// and how battles use them (utils/battle/runBattle.js + sim.js).
// Synthetic players only.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { learnableMoves, chosenMoves, validateMoveset, setMoveset, keepMovesOnLevelUp, MAX_MOVES } from "../services/movesets.js";
import { buildTeam, buildBattleTeam } from "../utils/battle/runBattle.js";
import { buildMon, memberMoves } from "../utils/battle/sim.js";
import { autoMoveset, movesLearned } from "../utils/battle/moveset.js";
import { getSpecies } from "../utils/battle/data.js";
import { pokemonDetail } from "../services/pokemonDetail.js";
import { battleInfo, inspectSlots } from "../commands/inspectpokemon.js";
import { getMove } from "../utils/battle/data.js";

const exp = (lv) => ({ exp: lv ** 3 });
const player = () => ({
  pokemon: { 6: { normal: 1, shiny: 0 }, 4: { normal: 1, shiny: 0 } },
  training: { "6:normal": exp(58), "4:normal": exp(2) },
  displayedPokemon: [{ id: 6, variant: "normal" }, { id: 4, variant: "normal" }],
  battleTeam: [{ id: 6, variant: "normal" }, { id: 4, variant: "normal" }],
});
const levelUpAt = (id, lv) => new Set(getSpecies(id).levelMoves.filter(([at]) => at <= lv).map(([, m]) => m));

section("what a copy may equip");
{
  const u = player();
  const l = learnableMoves(u, 6, "normal");
  assertEqual(new Set(l.map((m) => m.id)), levelUpAt(6, 58), "every level-up move learned by its real Level (58), nothing later");
  assertTrue(l.every((m) => m.source === "level" && m.learnedAt <= 58), "each with the Level it was learned");
  assertEqual(learnableMoves(u, 4, "normal").every((m) => m.learnedAt <= 2), true, "a Lv 2 Charmander only has Lv 1–2 moves");
}

section("validation: 1–4 distinct learned moves");
{
  const u = player();
  const ids = learnableMoves(u, 6, "normal").map((m) => m.id);
  assertTrue(validateMoveset(u, 6, "normal", ids.slice(0, MAX_MOVES)).ok, "four learned moves");
  assertTrue(validateMoveset(u, 6, "normal", ids.slice(0, 1)).ok, "one move");
  assertEqual(validateMoveset(u, 6, "normal", []).code, "bad_size", "none");
  assertEqual(validateMoveset(u, 6, "normal", ids.slice(0, 5).length === 5 ? ids.slice(0, 5) : [...ids, "x", "y", "z", "w"].slice(0, 5)).code, "bad_size", "five");
  assertEqual(validateMoveset(u, 6, "normal", [ids[0], ids[0]]).code, "duplicate", "duplicates");
  const later = getSpecies(4).levelMoves.find(([at]) => at > 2)[1];
  assertEqual(validateMoveset(u, 4, "normal", [later]).code, "not_learned", "a move learned after its Level");
  assertEqual(validateMoveset(u, 6, "shiny", [ids[0]]).code, "unowned", "a copy you don't own");
}

section("per team");
{
  const u = player();
  const ids = learnableMoves(u, 6, "normal").map((m) => m.id);
  setMoveset(u, "display", 6, "normal", [ids[0]]);
  setMoveset(u, "battle", 6, "normal", [ids[1], ids[2]]);
  assertEqual([chosenMoves(u, "display", 6, "normal"), chosenMoves(u, "battle", 6, "normal")], [[ids[0]], [ids[1], ids[2]]], "each team keeps its own moveset");
  setMoveset(u, "display", 6, "normal", null);
  assertEqual(chosenMoves(u, "display", 6, "normal"), null, "clearing → automatic moves");
  u.movesets.battle["6:normal"] = [ids[1], "notamove", ids[1]];
  assertEqual(chosenMoves(u, "battle", 6, "normal"), [ids[1]], "stored junk and duplicates are ignored at use time");
}

section("battles use the team's moveset");
{
  const u = player();
  const ids = learnableMoves(u, 6, "normal").map((m) => m.id);
  setMoveset(u, "display", 6, "normal", [ids[0], ids[1]]);
  setMoveset(u, "battle", 6, "normal", [ids[2]]);
  const casual = buildTeam(u);
  const ranked = buildBattleTeam(u);
  assertEqual(casual[0].moves, [ids[0], ids[1]], "casual: Display team moveset");
  assertEqual(ranked[0].moves, [ids[2]], "ranked/wager: Battle team moveset");
  assertEqual(buildMon(casual[0]).moves.length, 2, "the fighter carries exactly those moves");
  assertTrue(!("moves" in casual[1]), "no moveset → no override");
  assertEqual(memberMoves(casual[1]), autoMoveset(4, 2), "casual without a moveset: automatic moves, unchanged");
  assertEqual(memberMoves(ranked[1]), autoMoveset(4, 2), "ranked without a moveset: automatic moves at its REAL Level (2), not Lv 50");
  assertTrue(memberMoves(ranked[1]).join() !== autoMoveset(4, 50).join(), "…which differ from Lv 50 moves");
}

section("detail payload for the editor");
{
  const u = player();
  const ids = learnableMoves(u, 6, "normal").map((m) => m.id);
  setMoveset(u, "battle", 6, "normal", [ids[0]]);
  const c = pokemonDetail(u, 6).body.copies.normal;
  assertEqual([c.movesets.display, c.movesets.battle.map((m) => m.id)], [null, [ids[0]]], "both teams' movesets");
  assertEqual(c.learnable.length, ids.length, "every learnable move, with names and types");
  assertTrue(c.moves.every((m) => m.id), "automatic moves carry ids");
}

section("/inspectpokemon shows the chosen moves");
{
  const u = player();
  const ids = learnableMoves(u, 6, "normal").map((m) => m.id);
  const name = (m) => getMove(m).name;
  assertTrue(battleInfo(u, 6).includes(`Moves: ${autoMoveset(6, 58).map(name).join(", ")}`), "no moveset: automatic moves");
  setMoveset(u, "display", 6, "normal", [ids[0], ids[1]]);
  setMoveset(u, "battle", 6, "normal", [ids[2]]);
  const text = battleInfo(u, 6);
  assertTrue(text.includes(`Moves: ${name(ids[0])}, ${name(ids[1])}`) && text.includes(`Battle team moves: ${name(ids[2])}`), "text: Display moves, plus the Battle team's");
  assertEqual(inspectSlots(u, { id: 6 })[0].moves, [name(ids[0]), name(ids[1])], "card: the Display team's moves");
}

section("a level-up never equips a newly learned move");
{
  // Charizard: find a Level step where a new move is learned.
  let from = 58;
  while (from < 99 && !movesLearned(6, from, from + 1).length) from++;
  const to = from + 1;
  const u = player();
  u.training["6:normal"] = exp(from);
  setMoveset(u, "battle", 6, "normal", autoMoveset(6, from).slice(0, 2)); // chosen on one team
  const before = autoMoveset(6, from);
  u.training["6:normal"] = exp(to);
  assertEqual(keepMovesOnLevelUp(u, 6, "normal", { fromLevel: from, toLevel: to }), ["display"], "only the team on automatic moves is pinned");
  assertEqual(chosenMoves(u, "display", 6, "normal"), before, "Display keeps the moves it had before the Level-up");
  assertEqual(chosenMoves(u, "battle", 6, "normal"), autoMoveset(6, from).slice(0, 2), "a chosen moveset is untouched");
  assertTrue(learnableMoves(u, 6, "normal").some((m) => movesLearned(6, from, to).includes(m.id)), "the new move is learned and can be equipped");
  assertEqual(keepMovesOnLevelUp(player(), 6, "normal", { fromLevel: 58, toLevel: 58 }), [], "no Level gained: nothing pinned");
}

finish();
