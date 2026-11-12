// ==========================================================
// tests/teamCopy.test.js — "Copy from Display/Battle team" on the Teams page
// (services/teamCopy.js). Synthetic players only.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { parseTeamCopy, applyTeamCopy } from "../services/teamCopy.js";
import { learnableMoves, chosenMoves, setMoveset } from "../services/movesets.js";

const exp = (lv) => ({ exp: lv ** 3 });
const player = () => ({
  pokemon: { 6: { normal: 1, shiny: 1 }, 4: { normal: 1, shiny: 0 }, 7: { normal: 1, shiny: 0 } },
  training: { "6:normal": exp(58), "6:shiny": exp(40), "4:normal": exp(20), "7:normal": exp(20) },
  displayedPokemon: [{ id: 6, variant: "normal" }, { id: 4, variant: "normal" }],
  battleTeam: [{ id: 7, variant: "normal" }],
});

section("parseTeamCopy: request validation");
{
  assertEqual(parseTeamCopy({}, "battle"), { ok: true, copy: null }, "no copyFrom → plain team save");
  assertEqual(parseTeamCopy({ copyFrom: null }, "battle"), { ok: true, copy: null }, "copyFrom null → plain team save");
  assertEqual(parseTeamCopy({ copyFrom: "display", copiedKeys: ["6:normal", "6:normal", "4:normal"] }, "battle"),
    { ok: true, copy: { from: "display", keys: ["6:normal", "4:normal"] } }, "valid copy, duplicate keys dropped");
  assertEqual(parseTeamCopy({ copyFrom: "battle", copiedKeys: ["6:normal"] }, "battle").code, "bad_copy", "copying a team onto itself is rejected");
  assertEqual(parseTeamCopy({ copyFrom: "ranked", copiedKeys: ["6:normal"] }, "battle").code, "bad_copy", "unknown source team is rejected");
  const bad = [undefined, [], ["6"], ["6:gold"], ["0:normal"], [6], Array(7).fill("6:normal")];
  for (const keys of bad) assertEqual(parseTeamCopy({ copyFrom: "display", copiedKeys: keys }, "battle").status, 400, `bad copiedKeys ${JSON.stringify(keys)} → 400`);
}

section("applyTeamCopy: moves follow the copied Pokémon");
{
  const u = player();
  const ids = learnableMoves(u, 6, "normal").map((m) => m.id);
  const ids4 = learnableMoves(u, 4, "normal").map((m) => m.id);
  const ids7 = learnableMoves(u, 7, "normal").map((m) => m.id);
  setMoveset(u, "display", 6, "normal", [ids[0], ids[1]]);
  setMoveset(u, "battle", 6, "normal", [ids[2]]);
  setMoveset(u, "battle", 4, "normal", [ids4[0]]); // display has automatic moves for 4
  setMoveset(u, "battle", 7, "normal", [ids7[0]]); // added by hand, not copied
  const saved = [{ id: 6, variant: "normal" }, { id: 4, variant: "normal" }, { id: 7, variant: "normal" }];
  const done = applyTeamCopy(u, { from: "display", to: "battle", keys: ["6:normal", "4:normal", "6:shiny"] }, saved);
  assertEqual(done, ["6:normal", "4:normal"], "only copied keys that are on the saved team");
  assertEqual(chosenMoves(u, "battle", 6, "normal"), [ids[0], ids[1]], "battle moves overwritten by display moves");
  assertEqual(chosenMoves(u, "battle", 4, "normal"), null, "automatic on the source → automatic on the target");
  assertEqual(chosenMoves(u, "battle", 7, "normal"), [ids7[0]], "a Pokémon added by hand keeps its own moves");
  assertEqual(chosenMoves(u, "display", 6, "normal"), [ids[0], ids[1]], "source team untouched");
  assertTrue(!("6:shiny" in (u.movesets.battle ?? {})), "key not on the team writes nothing");
}

finish();
