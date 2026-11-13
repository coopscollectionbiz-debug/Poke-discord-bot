// ==========================================================
// tests/fullSimReplay.test.js
// Replaying full-sim fights: status, hazard, weather and stat changes are
// narrated on the hits both replayers already show (preNotes / notes), the
// Discord frames put the right Pokémon in front after a U-turn, and a
// full-sim replay gets about 20 updates.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { simulateFull } from "../utils/battle/showdown/simulate.js";
import { stepText } from "../utils/battle/narrate.js";
import { activeAt, updatesFor } from "../utils/battle/playback.js";
import { PLAYBACK, FULL_SIM } from "../utils/battle/tuning.js";
import { replaySteps } from "../public/battlerecords/records.js";
import { resultView } from "../utils/fightRecordBuild.js";
import { closeSimPool } from "../utils/battle/simPool.js";

const mon = (speciesId, name, level, moves, extra = {}) => ({ speciesId, variant: "normal", name, level, moves, ...extra });
const firstMoveThenSecond = (req, b) => (b.turn === 1 ? "move 1" : "move 2");
const notesOf = (r) => r.log.flat().flatMap((e) => [...(e.preNotes ?? []), ...(e.notes ?? [])]);

section("Narration");
{
  const r = simulateFull({
    sides: [{ members: [mon(213, "Shuckle", 60, ["toxic", "stealthrock"])] }, { members: [mon(16, "Pidgey", 20, ["gust"]), mon(19, "Rattata", 20, ["tackle"])] }],
    seed: 4, ai: [firstMoveThenSecond, () => "move 1"],
  });
  const text = notesOf(r).join(" ");
  assertTrue(/Pidgey was badly poisoned!/.test(text), "a status is narrated with the Pokémon's name");
  assertTrue(/hurt by poison/.test(text), "so is the poison damage at the end of a turn");
  assertTrue(/Pointed stones/.test(text), "and Stealth Rock going up");
}
{
  const r = simulateFull({ sides: [{ members: [mon(230, "Kingdra", 50, ["raindance", "surf"])] }, { members: [mon(143, "Snorlax", 50, ["bodyslam"])] }], seed: 2, ai: [firstMoveThenSecond, () => "move 1"] });
  assertTrue(notesOf(r).some((t) => t === "It started to rain!"), "weather starting is narrated");
}
assertEqual(stepText({ kind: "note", type: "boost", args: ["p1a: s0", "atk", "2"] }, [["Scizor"], ["Pidgey"]]), "Scizor's Attack rose sharply!", "a stat boost reads like the games");
assertEqual(stepText({ kind: "note", type: "message", args: ["anything"] }, [["A"], ["B"]]), null, "steps with nothing to say stay silent");

section("Who is in front");
{
  const r = simulateFull({
    sides: [{ members: [mon(212, "Scizor", 50, ["uturn"]), mon(143, "Snorlax", 50, ["bodyslam"])] }, { members: [mon(213, "Shuckle", 50, ["splash"])] }],
    seed: 3, ai: [() => "move 1", () => "move 1"],
  });
  assertEqual(activeAt(r, 1), [0, 0], "turn 1 starts with both leads in front");
  assertEqual(activeAt(r, 2)[0], 1, "after Scizor's U-turn, Snorlax is in front for turn 2");
  assertEqual(activeAt({ snapshots: [[[0, 1], [1]]] }, 1), [1, 0], "today's results: the first Pokémon with HP left");
}

section("Browser replay");
{
  const members = [[mon(212, "Scizor", 50, ["uturn"]), mon(143, "Snorlax", 50, ["toxic"])], [mon(213, "Shuckle", 50, ["splash"])]];
  const r = simulateFull({ sides: members.map((m) => ({ members: m })), seed: 3, ai: [() => "move 1", () => "move 1"] });
  const record = { sides: [{ id: "A", name: "Ash" }, { id: "B", name: "Gary" }], fights: [{ members, result: resultView(r) }] };
  const steps = replaySteps(record, "A");
  const turn2 = steps.find((s) => s.turn === 2);
  assertEqual(turn2.active[0], 1, "after a U-turn, the replay shows Snorlax in front from the next turn");
  assertTrue(steps.some((s) => /badly poisoned/.test(s.caption)), "status narration shows in the captions");
}

section("Updates");
assertEqual([updatesFor({ v: 2 }), updatesFor({})], [FULL_SIM.maxUpdates, PLAYBACK.maxUpdates], "full-sim replays get more updates than today's");
assertEqual(FULL_SIM.maxUpdates, 20, "about 20");

await closeSimPool();
finish();
