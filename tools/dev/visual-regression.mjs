// ==========================================================
// tools/dev/visual-regression.mjs — the M3 no-Mega visual gate.
//
//   node tools/dev/visual-regression.mjs <engineRoot> <outDir> [off|on]
//
// Renders a fixed set of Discord images for fixture players WITHOUT any
// Mega (the same fixtures in every engine) through <engineRoot>'s own
// renderers, still and animated: /showteam (refined, also empty and
// fallback), trainer card, inspect card, EXP card, battle frames (start,
// turn, final with fainted and level-up), leaderboard, Pokédex card, catch
// card. (The dashboard is compared in a browser, see the M3 report.) Writes each output to outDir and
// prints {name: sha256} as JSON.
//
//   off: no Mega flags (production default)
//   on:  every Mega switch on (MEGA_EVOLUTION_ENABLED, MEGA_BATTLES_ENABLED)
//
// Compare two runs with tools/dev/visual-compare.mjs.
// ==========================================================

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pathToFileURL } from "url";

const [rootArg, outArg, mode = "off"] = process.argv.slice(2);
const root = path.resolve(rootArg);
const out = path.resolve(outArg);
for (const k of Object.keys(process.env)) if (k.startsWith("MEGA_")) delete process.env[k];
if (mode === "on") Object.assign(process.env, { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1" });
process.env.CARDS_ANIMATED = "1";
console.warn = () => {};
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { createNewUser } = await imp("utils/userSchema.js");
const { buildTeamView } = await imp("utils/render/teamView.js");
const { renderShowteam } = await imp("utils/render/showteam.js");
const { renderInspectCard } = await imp("utils/render/inspectCard.js");
const { trainerCardView, renderTrainerCard } = await imp("utils/render/trainerCard.js");
const { expView, renderExpCard } = await imp("utils/render/expCard.js");
const { renderBattleFrame } = await imp("utils/battle/render.js");
const { runBattle } = await imp("utils/battle/runBattle.js");
const { leaderboardView, renderLeaderboard } = await imp("utils/render/leaderboardCard.js");
const { rankBattleRatings } = await imp("commands/leaderboard.js");
const { pokedexView, renderPokedexCard } = await imp("utils/render/pokedexCard.js");
const { catchView, renderCatchCard } = await imp("utils/render/catchCard.js");

function player(id, name, team, { tp = 4100, rating = 1100 } = {}) {
  const u = createNewUser(id, name);
  u.tp = tp;
  u.cc = 900;
  u.training = {};
  u.battle = { rating, wins: 9, losses: 4 };
  for (const [species, variant, level] of team) {
    u.pokemon[species] ??= { normal: 0, shiny: 0 };
    u.pokemon[species][variant] += 1;
    u.training[`${species}:${variant}`] = { exp: level ** 3 + 5 * level };
  }
  u.displayedPokemon = team.map(([id, variant]) => ({ id, variant }));
  return u;
}
const A = player("200000000000000001", "Red", [[6, "normal", 55], [25, "shiny", 40], [150, "normal", 70], [9, "normal", 52], [143, "normal", 48], [94, "normal", 50]]);
const B = player("200000000000000002", "Blue", [[18, "normal", 50], [65, "normal", 53], [112, "normal", 49], [130, "shiny", 51]], { rating: 1180 });
const NONE = player("200000000000000003", "Leaf", [[1, "normal", 5], [4, "normal", 6]]);
NONE.displayedPokemon = []; // no Team: the fallback card
const EMPTY = player("200000000000000004", "Gold", []);
const data = { [A.id ?? "A"]: A };
const td = { A, B };

fs.mkdirSync(out, { recursive: true });
const result = {};
async function keep(name, buffer) {
  fs.writeFileSync(path.join(out, name), buffer);
  result[name] = crypto.createHash("sha256").update(buffer).digest("hex");
}

for (const [k, u] of Object.entries({ A, B, NONE, EMPTY })) {
  const view = buildTeamView(u, { displayName: k });
  await keep(`showteam-${k}.png`, await renderShowteam(view, { layout: "refined" }));
  await keep(`trainercard-${k}.png`, await renderTrainerCard(trainerCardView(u, { displayName: k, trainer: null })));
  if (view.slots[0]) await keep(`inspect-${k}.png`, await renderInspectCard(view.slots[0], { owner: k }));
}
await keep("showteam-A-animated.gif", await renderShowteam(buildTeamView(A, { displayName: "A" }), { layout: "refined", animate: true }));
await keep("trainercard-A-animated.gif", await renderTrainerCard(trainerCardView(A, { displayName: "A", trainer: null }), { animate: true }));
await keep("inspect-A-animated.gif", await renderInspectCard(buildTeamView(A, { displayName: "A" }).slots[1], { owner: "A", animate: true }));

const now = new Date(Date.UTC(2026, 10, 10, 12));
const battle = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", seed: 9001, now });
const sides = battle.sides.map((s) => ({ name: s.userId, members: s.members }));
const snaps = battle.result.snapshots;
await keep("battle-start.gif", await renderBattleFrame({ sides, hpBefore: snaps[0], screens: [["The battle begins!", `${sides[0].members[0].name} and ${sides[1].members[0].name} lead off.`]] }));
await keep("battle-turn1.gif", await renderBattleFrame({ sides, hpBefore: snaps[0], events: battle.result.log[0], badge: "TURN 1" }));
const last = battle.result.turns;
await keep("battle-final.gif", await renderBattleFrame({ sides, hpBefore: snaps[last], badge: "FINAL", winnerSide: battle.winnerId === "A" ? 0 : 1, screens: [["Result", ""]] }));
await keep("exp-A.png", await renderExpCard(expView(battle, "A", { A: "Red", B: "Blue" }, A)));
await keep("exp-A-animated.gif", await renderExpCard(expView(battle, "A", { A: "Red", B: "Blue" }, A), { animate: true }));

const board = rankBattleRatings(td, "A");
await keep("leaderboard.png", await renderLeaderboard(leaderboardView(board, td, "A")));
await keep("pokedex-6.png", await renderPokedexCard(pokedexView(6, A)));
await keep("pokedex-25-shiny.png", await renderPokedexCard(pokedexView(25, A), { shiny: true }));
await keep("catch-25.png", await renderCatchCard(catchView(A, { id: 25, variant: "normal", catchResult: { isNew: false }, trainerName: "Red" })));

void data;
console.log(JSON.stringify({ engine: path.basename(root), mode, outputs: result }, null, 1));
