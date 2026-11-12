// ==========================================================
// tests/adminCopies.test.js: admin changes on one named copy (docs/adr/0001).
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { parseChange, applyChange } from "../services/adminChanges.js";
import { addCopy, copyTraining, copiesOf, dexMask } from "../services/box.js";
import { expForLevel } from "../utils/training.js";

const u = { id: "1", pokemon: {} };
const a = addCopy(u, 6, "normal", { exp: expForLevel(60) }).uid;
const b = addCopy(u, 6, "normal", { exp: expForLevel(20) }).uid;
const t = addCopy(u, 6, "normal", { exp: expForLevel(30) }).uid;
u.customPokemon = { [t]: { uid: t, speciesId: 6, variant: "normal", rev: 4, tmMoves: ["dragonclaw"], history: [] } };

section("parsing");
{
  assertTrue(parseChange({ kind: "level", speciesId: 6, variant: "normal", level: 45, uid: b }).change.uid === b, "Set Level takes a uid");
  assertTrue(!parseChange({ kind: "level", speciesId: 6, variant: "normal", level: 45, uid: "nope" }).ok, "a malformed uid is refused");
  assertTrue(parseChange({ kind: "pokemon", op: "remove", speciesId: 6, variant: "normal", amount: 1, uid: b }).change.uid === b, "Remove takes a uid");
  assertTrue(!parseChange({ kind: "pokemon", op: "remove", speciesId: 6, variant: "normal", amount: 2, uid: b }).ok, "a named copy is removed alone (amount 1)");
}

section("Set Level on one copy");
{
  const r = applyChange(u, parseChange({ kind: "level", speciesId: 6, variant: "normal", level: 45, uid: b }).change);
  assertTrue(r.ok && r.before === "Lv 20" && r.after === "Lv 45", "the named copy goes 20 → 45");
  assertEqual([copyTraining(u, a).level, copyTraining(u, b).level], [60, 45], "the other copy is untouched");
}

section("Remove one copy");
{
  const r = applyChange(u, parseChange({ kind: "pokemon", op: "remove", speciesId: 6, variant: "normal", amount: 1, uid: a }).change);
  assertTrue(r.ok && !copiesOf(u, 6, "normal").some((c) => c.uid === a), "the Lv 60 copy is gone, by name");
  const r2 = applyChange(u, parseChange({ kind: "pokemon", op: "remove", speciesId: 6, variant: "normal", amount: 1, uid: t }).change);
  assertTrue(r2.ok && !u.customPokemon?.[t], "a named trained copy can be removed by an admin (its TM record goes too)");
  assertEqual(copiesOf(u, 6, "normal").map((c) => c.uid), [b], "one copy left");
  assertEqual(dexMask(u, 6), 1, "the Pokédex keeps Charizard");
  assertTrue(!applyChange(u, parseChange({ kind: "pokemon", op: "remove", speciesId: 6, variant: "normal", amount: 1, uid: a }).change).ok, "a copy that's already gone: refused");
}

finish();
