// ==========================================================
// tests/movesetSaveRoute.test.js: saving moves for a team slot's copy.
//
// Regression (2026-11-12): POST /api/pokemon/moveset checked the slot's uid
// with slotCopyUid() only, which knows TM copies (customPokemon) and not box
// copies (user.box). Since the Pokédex / Collection split every team slot
// holds a box uid, so every save from the Teams page failed with "That
// Pokémon copy no longer exists".
// ==========================================================

import fs from "node:fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { addCopy, normalizeBox } from "../services/box.js";
import { normalizeCustomPokemon } from "../services/ownership.js";
import { learnableMoves, saveMoveset, chosenMoves } from "../services/movesets.js";
import { expForLevel } from "../utils/training.js";

// Entei on the Battle team, Lv 48, held as a box copy (no TM record).
const u = { pokemon: {} };
const entei = addCopy(u, 244, "normal", { exp: expForLevel(48) }).uid;
u.battleTeam = [{ id: 244, variant: "normal", uid: entei }];
const four = learnableMoves(u, 244, "normal", { uid: entei }).slice(-4).map((m) => m.id);

section("a box copy's moves save on the Battle team");
{
  assertEqual(four.length, 4, "Entei Lv 48 knows at least four moves");
  const r = saveMoveset(u, { team: "battle", pokeId: 244, variant: "normal", moves: four, uid: entei });
  assertTrue(r.ok, `saved (got ${r.error ?? "ok"})`);
  assertEqual(r.uid, entei, "stored for that copy");
  assertEqual(chosenMoves(u, "battle", 244, "normal", { uid: entei }), four, "the copy's own moves are read back");
  assertTrue(Array.isArray(u.movesets.battle[`u:${entei}`]), "kept under u:<uid>");
}

section("the same on the Display team, and back to automatic moves");
{
  const r = saveMoveset(u, { team: "display", pokeId: 244, variant: "normal", moves: four.slice(0, 2), uid: entei });
  assertTrue(r.ok, "display save works");
  const clear = saveMoveset(u, { team: "display", pokeId: 244, variant: "normal", moves: null, uid: entei });
  assertTrue(clear.ok && clear.moves == null, "null clears the choice");
}

section("a uid that names no copy is still refused");
{
  const r = saveMoveset(u, { team: "battle", pokeId: 244, variant: "normal", moves: four, uid: "c_ZZZZZZZZZZ" });
  assertEqual(r.code, "unknown_copy", "unknown uid → unknown_copy");
  const wrongLine = saveMoveset(u, { team: "battle", pokeId: 4, variant: "normal", moves: four, uid: entei });
  assertTrue(!wrongLine.ok, "another species' uid is refused");
}

section("a slot holding a stale uid is repaired at load, then saves");
{
  const p = { pokemon: {} };
  const keep = addCopy(p, 244, "normal", { exp: expForLevel(30) }).uid;
  p.battleTeam = [{ id: 244, variant: "normal", uid: "c_GoneGone00" }];
  normalizeCustomPokemon(p);
  normalizeBox(p);
  const slotUid = p.battleTeam[0].uid;
  assertEqual(slotUid, keep, "the slot points at a copy the player owns again");
  const mv = learnableMoves(p, 244, "normal", { uid: slotUid }).slice(-1).map((m) => m.id);
  assertTrue(saveMoveset(p, { team: "battle", pokeId: 244, variant: "normal", moves: mv, uid: slotUid }).ok, "and its moves save");
}

section("the dashboard route goes through saveMoveset");
{
  const src = fs.readFileSync(new URL("../bot_final.js", import.meta.url), "utf8");
  const route = src.slice(src.indexOf('app.post("/api/pokemon/moveset"'), src.indexOf("// 💿 Teach a TM"));
  assertTrue(route.includes("saveMoveset(u,"), "route calls saveMoveset");
  assertTrue(!route.includes("slotCopyUid("), "route no longer checks TM copies only");
}

finish();
