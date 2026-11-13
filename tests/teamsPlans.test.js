// ==========================================================
// tests/teamsPlans.test.js
// The Teams page's Battle plan row (public/teams/plans.js), DOM-free: the
// plan menu, the readiness line, which moves the Moveset editor marks
// as suggested, and the recommended moves it fills in.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { planRowHtml, readinessLine, suggestedFor, recommendedFor } from "../public/teams/plans.js";

const PLANS = [
  { id: "allout", name: "All-out attack", blurb: "Uses its strongest move every turn." },
  { id: "speed", name: "Speed control", blurb: "Sets Trick Room if its Team is slow, Tailwind if it's fast." },
];
const view = (plan, readiness, slots = []) => ({ plan, readiness, slots });
const state = (teams) => ({ enabled: true, plans: PLANS, teams });

section("Readiness line");
assertEqual(readinessLine(view("allout", { ready: true, helpers: 6, missing: [], missingNames: [] })), "", "All-out attack needs no line");
assertEqual(readinessLine(view("speed", { ready: true, helpers: 1, missing: [], missingNames: [] })), "Ready · 1 Pokémon helps", "a ready plan says how many Pokémon help");
assertEqual(readinessLine(view("speed", { ready: false, helpers: 0, missing: ["trickroom", "tailwind"], missingNames: ["Trick Room", "Tailwind"] })),
  "Plays as All-out attack until a Pokémon brings Trick Room or Tailwind. Nobody on this Team learns one by leveling up.", "a plan that can't run yet says what it plays as, what it needs, and that no one learns it");
const notReady = (howTo) => view("speed", { ready: false, helpers: 0, missing: ["trickroom", "tailwind"], missingNames: ["Trick Room", "Tailwind"], howTo });
assertEqual(readinessLine(notReady({ name: "Pidgey", move: "tailwind", moveName: "Tailwind", level: 41, known: false })),
  "Plays as All-out attack until a Pokémon brings Trick Room or Tailwind. Pidgey learns Tailwind at Lv 41.", "the soonest Team member to learn one, and at what Level (review I6)");
assertEqual(readinessLine(notReady({ name: "Pidgey", move: "tailwind", moveName: "Tailwind", level: 41, known: true })),
  "Plays as All-out attack until a Pokémon brings Trick Room or Tailwind. Pidgey already knows Tailwind, so add it to its Moveset.", "or the member that knows one already");

section("Plan row");
{
  const html = planRowHtml("display", state({ display: view("speed", { ready: false, helpers: 0, missing: ["trickroom"], missingNames: ["Trick Room"] }) }));
  assertTrue(html.includes("Battle plan") && html.includes('value="speed" selected'), "the row shows the Team's plan selected");
  assertTrue(html.includes("Sets Trick Room if its Team is slow"), "and what the plan does");
  assertTrue(html.includes("until a Pokémon brings Trick Room"), "and its readiness");
  assertEqual(planRowHtml("showcase", state({})), "", "the Showcase team has no row");
  assertEqual(planRowHtml("display", { enabled: false, plans: [], teams: {} }), "", "nor does any Team while the full sim is off");
}

section("Suggested moves");
{
  const s = state({ display: view("speed", { ready: false }, [{ speciesId: 437, variant: "normal", suggestions: ["trickroom"] }, { speciesId: 25, variant: "shiny", uid: "c_abc", suggestions: ["thunderwave"] }]) });
  assertEqual(suggestedFor(s, "display", { id: 437, variant: "normal" }), ["trickroom"], "the editor marks the slot's suggestions");
  assertEqual(suggestedFor(s, "display", { id: 25, variant: "shiny", uid: "c_abc" }), ["thunderwave"], "matched by copy when the slot names one");
  assertEqual(suggestedFor(s, "battle", { id: 437, variant: "normal" }), [], "another Team's suggestions don't leak in");
}

section("Recommended moves");
{
  const rec = (moves) => ({ moves, helper: moves[0] });
  const s = state({ display: view("speed", { ready: false }, [
    { speciesId: 437, variant: "normal", suggestions: [], recommended: rec(["trickroom", "flashcannon"]) },
    { speciesId: 25, variant: "shiny", uid: "c_abc", suggestions: [], recommended: rec(["thunderbolt"]) },
  ]) });
  assertEqual(recommendedFor(s, "display", { id: 437, variant: "normal" }), { moves: ["trickroom", "flashcannon"], planName: "Speed control" }, "the editor gets the slot's recommended moves and the plan they're for");
  assertEqual(recommendedFor(s, "display", { id: 25, variant: "shiny", uid: "c_abc" }).moves, ["thunderbolt"], "matched by copy when the slot names one");
  assertEqual(recommendedFor(s, "battle", { id: 437, variant: "normal" }), null, "another Team's don't leak in");
  assertEqual(recommendedFor({ enabled: false, plans: [], teams: {} }, "display", { id: 437, variant: "normal" }), null, "none while the full sim is off");
}

finish();
