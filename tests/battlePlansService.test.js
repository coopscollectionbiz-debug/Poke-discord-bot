// ==========================================================
// tests/battlePlansService.test.js
// A player's Battle plans (services/battlePlans.js): stored per fighting
// Team, and readiness from the moves the Team really brings: who helps
// with what, or how to get ready. The cutover (services/fullSimCutover.js):
// nobody's moves change when the full sim turns on.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { getPlan, setPlan, teamPlanView } from "../services/battlePlans.js";
import { runCutover, cutoverMoves } from "../services/fullSimCutover.js";
import { chosenMoves, setMoveset, keepMovesOnLevelUp } from "../services/movesets.js";
import { buildTeam } from "../utils/battle/runBattle.js";
import { autoMoveset, movesLearned } from "../utils/battle/moveset.js";
import { getSpecies, getMove } from "../utils/battle/data.js";
import { createNewUser, validateUserSchema } from "../utils/userSchema.js";
import { pokemonDetail } from "../services/pokemonDetail.js";
import { normalizeBox, copiesOf } from "../services/box.js";
import { inspectSlots, inspectText } from "../commands/inspectpokemon.js";
import { renderInspectCard } from "../utils/render/inspectCard.js";

const ON = { FULL_SIM_ENABLED: "1" };
const OFF = {};
const withSwitch = (on, fn) => {
  const saved = process.env.FULL_SIM_ENABLED;
  if (on) process.env.FULL_SIM_ENABLED = "1"; else delete process.env.FULL_SIM_ENABLED;
  try { return fn(); } finally { if (saved === undefined) delete process.env.FULL_SIM_ENABLED; else process.env.FULL_SIM_ENABLED = saved; }
};
function player(id, speciesIds, level) {
  const u = createNewUser(id, `Trainer ${id}`);
  for (const sid of speciesIds) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    u.training ??= {};
    u.training[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  return u;
}

section("Plans per Team");
{
  const u = player("A", [25], 50);
  assertEqual([getPlan(u, "display"), getPlan(u, "battle")], ["allout", "allout"], "every Team starts on All-out attack");
  assertEqual(setPlan(u, "display", "speed").ok, true, "a player sets their Casual team's plan");
  assertEqual([getPlan(u, "display"), getPlan(u, "battle")], ["speed", "allout"], "each Team keeps its own");
  assertEqual([setPlan(u, "display", "nope").ok, setPlan(u, "showcase", "speed").ok], [false, false], "an unknown plan, or the Showcase team, is refused");
  const back = JSON.parse(JSON.stringify(u));
  validateUserSchema(back, "A", "Trainer A");
  assertEqual(back.battlePlans, { display: "speed" }, "plans survive a save and load");
}

section("Readiness");
withSwitch(true, () => {
  const u = player("A", [25, 143], 50);
  const view = teamPlanView(u, "display");
  assertEqual([view.plan, view.readiness.ready], ["allout", true], "All-out attack is ready");
  setPlan(u, "display", "status");
  const before = teamPlanView(u, "display");
  assertEqual(before.readiness.ready, false, "Status & stall isn't ready while nobody brings a status move");
  setMoveset(u, "display", 25, "normal", ["thunderwave", ...autoMoveset(25, 50).slice(0, 3)]);
  const after = teamPlanView(u, "display").readiness;
  assertEqual([after.ready, after.helpers.map((h) => [h.name, h.moves])], [true, [["Pikachu", ["thunderwave"]]]], "once the player takes it, the plan is ready, and says who brings what");
});

// A species whose last 4 attacks at Lv 40 differ between today's learnsets and the full sim's.
let changed = 25;
for (let id = 1; id <= 649; id++) {
  if (JSON.stringify(autoMoveset(id, 40, OFF)) !== JSON.stringify(autoMoveset(id, 40, ON))) { changed = id; break; }
}

section("Readiness says how to get the plan's move (review I6)");
withSwitch(true, () => {
  const [learnsAt] = getSpecies(16, ON).levelMoves.find(([, id]) => id === "tailwind"); // Pidgey
  const young = player("P", [16], learnsAt - 5);
  setPlan(young, "display", "speed");
  assertEqual(teamPlanView(young, "display").readiness.howTo, { name: "Pidgey", move: "tailwind", moveName: "Tailwind", level: learnsAt, known: false }, `a Pidgey below Lv ${learnsAt} learns Tailwind then`);
  const old = player("Q", [16], learnsAt + 2);
  setPlan(old, "display", "speed");
  assertEqual(teamPlanView(old, "display").readiness.howTo?.known, true, "one past it already knows Tailwind (it brings attacks only until picked)");
  const none = player("R", [129], 30); // Magikarp
  setPlan(none, "display", "speed");
  assertEqual(teamPlanView(none, "display").readiness.howTo, null, "and a Team where nobody learns one has no way to name");
  setPlan(young, "display", "allout");
  assertEqual(teamPlanView(young, "display").readiness.howTo, undefined, "a ready plan needs none");
  // Entei learns Calm Mind at Lv 18, but with only physical attacks the AI never plays it.
  const entei = player("E", [244], 50);
  setMoveset(entei, "display", 244, "normal", ["sacredfire", "crunch", "extremespeed", "firefang"]);
  setPlan(entei, "display", "setup");
  assertEqual(teamPlanView(entei, "display").readiness.howTo, null, "it never names a move the AI wouldn't play (Calm Mind on a physical Entei)");
  // With Lava Plume, the AI would play Calm Mind, but Entei hits harder with
  // Attack: what to add follows the Recommended tag (the stat it's better at).
  const plume = player("F", [244], 60); // Entei learns Lava Plume at Lv 54
  setMoveset(plume, "display", 244, "normal", ["sacredfire", "crunch", "extremespeed", "lavaplume"]);
  setPlan(plume, "display", "setup");
  assertEqual(teamPlanView(plume, "display").readiness.howTo, null, "nor one that raises the attacking stat it's worse at");
  const keldeo = player("K", [244, 647], 60);
  setMoveset(keldeo, "display", 244, "normal", ["sacredfire", "crunch", "extremespeed", "lavaplume"]);
  setPlan(keldeo, "display", "setup");
  assertEqual(teamPlanView(keldeo, "display").readiness.howTo?.move, "workup", "a Keldeo's Work Up, which raises its Special Attack, is named instead");
});

section("/inspectpokemon shows the ability its Team's plan picks (review I6)");
{
  const u = player("K", [230], 50); // Kingdra
  setPlan(u, "display", "weather");
  const kingdra = { id: 230, name: "Kingdra", tier: "rare", types: [11, 16], region: "Johto" };
  withSwitch(true, () => {
    assertEqual(inspectSlots(u, kingdra)[0].ability, "Swift Swim", "Weather picks Swift Swim for Kingdra");
    assertTrue(inspectText(u, kingdra).includes("Ability: Swift Swim"), "the text version says so too");
  });
  const card = await withSwitch(true, () => renderInspectCard(inspectSlots(u, kingdra)[0], { eyebrow: "YOUR POKÉMON" }));
  assertTrue(card.length > 0, "and the card draws with it");
  withSwitch(false, () => {
    assertEqual("ability" in inspectSlots(u, kingdra)[0], false, "with the switch off, no ability is shown, as today");
  });
}

section("Cutover: nobody's moves change");
{
  const u = player("A", [changed, 25], 40);
  const before = withSwitch(false, () => buildTeam(u).map((m) => m.moves ?? autoMoveset(m.speciesId, m.level)));
  assertTrue(JSON.stringify(before[0]) !== JSON.stringify(autoMoveset(changed, 40, ON)), `the new learnsets would change #${changed}'s moves`);
  withSwitch(true, () => {
    runCutover({ A: u });
    const recorded = JSON.stringify(u.fullSimMoves);
    runCutover({ A: u });
    assertEqual(JSON.stringify(u.fullSimMoves), recorded, "the cutover runs once");
    assertEqual(buildTeam(u).map((m) => m.moves), before, "a Team member with no picked Moveset fights with the same moves after the switch");
    assertEqual(pokemonDetail(u, changed).body.copies.normal.moves.map((m) => m.id), before[0], "and the dashboard shows those moves too");
    setMoveset(u, "display", changed, "normal", [before[0][0]]);
    assertEqual(buildTeam(u)[0].moves, [before[0][0]], "a picked Moveset takes the recorded moves' place");
  });
}

section("Cutover: a level-up never equips a newly learned move (master, 2026-11-12)");
{
  // A Pokémon and Level where its recorded moves aren't the full sim's
  // automatic ones, and the full sim teaches it a new move at the next Level.
  let sid = null, from = null;
  for (let id = 1; id <= 649 && sid === null; id++) {
    for (let lv = 20; lv < 80; lv++) {
      if (JSON.stringify(autoMoveset(id, lv, OFF)) === JSON.stringify(autoMoveset(id, lv, ON))) continue;
      if (!withSwitch(true, () => movesLearned(id, lv, lv + 1).length)) continue;
      [sid, from] = [id, lv];
      break;
    }
  }
  assertTrue(sid !== null, `found #${sid}: learns a move at Lv ${from + 1} on the full sim`);
  const u = player("C", [sid], from);
  withSwitch(true, () => {
    runCutover({ C: u });
    const before = buildTeam(u)[0].moves;
    u.training[`${sid}:normal`] = { exp: (from + 1) ** 3 };
    assertTrue(JSON.stringify(buildTeam(u)[0].moves) !== JSON.stringify(before), "unpinned, the Level-up would change its moves");
    keepMovesOnLevelUp(u, sid, "normal", { fromLevel: from, toLevel: from + 1 });
    assertEqual(buildTeam(u)[0].moves, before, `so the Lv ${from + 1} Pokémon keeps the moves it fought with at Lv ${from}, its recorded ones`);
  });
}

section("Cutover: each Team's Moveset is its own (review I1)");
{
  const u = player("B", [changed], 40);
  u.battleTeam = [...u.displayedPokemon];
  const RANKED = { team: u.battleTeam, movesetTeam: "battle", equipmentTeam: "battle" };
  const before = withSwitch(false, () => buildTeam(u, RANKED).map((m) => m.moves ?? autoMoveset(m.speciesId, m.level)));
  withSwitch(true, () => {
    runCutover({ B: u });
    setMoveset(u, "display", changed, "normal", [before[0][0]]);
    assertEqual(buildTeam(u, RANKED).map((m) => m.moves), before, "editing the Casual team's Moveset leaves the Ranked team's moves as they were");
    setMoveset(u, "display", changed, "normal", null);
    assertEqual(buildTeam(u).map((m) => m.moves), before, "and clearing the pick brings back the moves it had");
  });
}

section("Cutover: players who join with the switch on (review I2)");
withSwitch(true, () => {
  const u = player("C", [changed], 40); // created while the full sim is on
  const moves = () => buildTeam(u).map((m) => m.moves ?? autoMoveset(m.speciesId, m.level));
  const now = moves();
  runCutover({ C: u }); // the next restart
  assertEqual(moves(), now, "a player who joined with the full sim on keeps their moves at the next restart");
});

section("Cutover: a line's record never goes to a lower-Level copy");
{
  const u = player("E", [changed], 50); // a slot with no copy named: recorded under the line, at Lv 50
  withSwitch(true, () => runCutover({ E: u }));
  u.pokemon[changed].normal = 2;
  normalizeBox(u);
  const young = copiesOf(u, changed, "normal").at(-1);
  u.box[young.uid].exp = 10 ** 3;
  u.displayedPokemon = [{ id: changed, variant: "normal", uid: young.uid }];
  withSwitch(true, () => {
    assertEqual(buildTeam(u)[0].level, 10, "a Lv 10 copy of the line is on the Team");
    assertEqual(buildTeam(u)[0].moves, undefined, "it fights with its own automatic moves, not the Lv 50 record");
  });
}

section("Cutover: every screen shows the moves it fights with (review I3)");
{
  const u = player("D", [changed], 40);
  normalizeBox(u);
  const [copy] = copiesOf(u, changed, "normal");
  u.box[copy.uid].exp = 40 ** 3;
  u.displayedPokemon = [{ id: changed, variant: "normal", uid: copy.uid }];
  const before = withSwitch(false, () => buildTeam(u)[0].moves ?? autoMoveset(changed, 40));
  withSwitch(true, () => {
    runCutover({ D: u });
    assertEqual(buildTeam(u)[0].moves, before, "a named copy fights with its recorded moves");
    assertEqual(pokemonDetail(u, changed).body.copies.normal.moves.map((m) => m.id), before, "the dashboard's line view shows them");
    assertEqual(inspectSlots(u, { id: changed })[0].moves, before.map((id) => getMove(id, ON)?.name ?? id), "and so does /inspectpokemon");
  });
}
withSwitch(true, () => {
  // Attacks the new learnset teaches above the recorded Level are learned on top.
  const taught = getSpecies(25, ON).levelMoves.filter(([lv, id]) => lv > 20 && lv <= 60 && getMove(id, ON).category !== "Status");
  const [, newest] = taught.at(-1);
  const moves = cutoverMoves({ moves: ["a", "b", "c", "d"], level: 20 }, 25, 60);
  assertEqual([moves.length, moves.at(-1)], [4, newest], "newest attack in, oldest out, as the games do it");
  assertTrue(!moves.includes("a"), "the oldest recorded move is the first forgotten");
});

section("Picked moves are kept until edited");
withSwitch(true, () => {
  // A level-up attack Gen 5 teaches but the species' latest game doesn't.
  let found = null;
  for (let id = 1; id <= 649 && !found; id++) {
    const legacy = getSpecies(id, OFF).levelMoves.filter(([lv]) => lv <= 50).map(([, m]) => m);
    const now = new Set(getSpecies(id, ON).levelMoves.map(([, m]) => m));
    const gone = legacy.find((m) => !now.has(m));
    if (gone) found = { id, gone };
  }
  const u = player("A", [found.id], 50);
  setMoveset(u, "display", found.id, "normal", [found.gone]);
  assertEqual(chosenMoves(u, "display", found.id, "normal"), [found.gone], `a picked move the new learnset drops still fights (${getMove(found.gone, OFF).name} on #${found.id})`);
});

finish();
