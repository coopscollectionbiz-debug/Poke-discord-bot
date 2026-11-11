// ==========================================================
// tools/bench-displays.mjs — what each Discord display costs to make.
//   node tools/bench-displays.mjs
// Battle: a seeded 6v6 battle, rendered as playback would (start image,
// every picked turn, result), reporting each image's KB, ms and frame count.
// Catch: each CATCH_FIXTURES card as PNG and as GIF.
// Cards: every slash-command card (the full late-game Team, an Epic trainer
// equipped so the trainer breathes), as PNG and as GIF.
// Peak RSS is for the whole process (one fresh Node).
// ==========================================================

import { performance } from "perf_hooks";
import { GifReader } from "omggif";
import { simulateBattle } from "../utils/battle/sim.js";
import { renderBattleFrame, pickFrameTurns } from "../utils/battle/render.js";
import { PLAYBACK } from "../utils/battle/tuning.js";
import { catchView, renderCatchCard } from "../utils/render/catchCard.js";
import { CATCH_FIXTURES, FIXTURES, BATTLE_FIXTURE, leaderboardWorld } from "../tests/fixtures/showteamFixtures.js";
import { buildTeamView } from "../utils/render/teamView.js";
import { renderShowteam } from "../utils/render/showteam.js";
import { trainerCardView, renderTrainerCard } from "../utils/render/trainerCard.js";
import { battleCardView, renderBattleCard } from "../utils/render/battleCard.js";
import { pokedexView, renderPokedexCard } from "../utils/render/pokedexCard.js";
import { renderInspectCard } from "../utils/render/inspectCard.js";
import { inspectSlots } from "../commands/inspectpokemon.js";
import { renderDailyCard } from "../utils/render/dailyCard.js";
import { expView, renderExpCard } from "../utils/render/expCard.js";
import { leaderboardView, renderLeaderboard } from "../utils/render/leaderboardCard.js";
import { rankBattleRatings } from "../commands/leaderboard.js";

const kb = (b) => Math.round(b.length / 1024);
const frames = (b) => (b.subarray(0, 3).toString() === "GIF" ? new GifReader(b).numFrames() : 1);
const time = async (fn) => { const t = performance.now(); const out = await fn(); return [out, Math.round(performance.now() - t)]; };

const mon = (speciesId, level, name, variant = "normal") => ({ speciesId, level, variant, name });
const battleSides = [
  { name: "Ash", members: [mon(6, 50, "Charizard"), mon(25, 50, "Pikachu", "shiny"), mon(3, 50, "Venusaur"), mon(130, 50, "Gyarados"), mon(94, 50, "Gengar"), mon(143, 50, "Snorlax")] },
  { name: "Gary", members: [mon(9, 50, "Blastoise"), mon(65, 50, "Alakazam"), mon(59, 50, "Arcanine"), mon(112, 50, "Rhydon"), mon(103, 50, "Exeggutor"), mon(18, 50, "Pidgeot", "shiny")] },
];
const result = simulateBattle({ sides: battleSides, seed: 12345 });
const { snapshots, log, turns } = result;
const sprites = new Map();
const rows = [];
const [start, startMs] = await time(() => renderBattleFrame({ sides: battleSides, hpBefore: snapshots[0], sprites, screens: [["The battle begins!", "Charizard and Blastoise lead off."]] }));
rows.push({ image: "battle start", kb: kb(start), ms: startMs, frames: frames(start) });
for (const turn of pickFrameTurns(turns, PLAYBACK.maxUpdates)) {
  const [buf, ms] = await time(() => renderBattleFrame({ sides: battleSides, hpBefore: snapshots[turn - 1], events: log[turn - 1], badge: `TURN ${turn}`, sprites }));
  rows.push({ image: `battle turn ${turn}`, kb: kb(buf), ms, frames: frames(buf) });
}
const [fin, finMs] = await time(() => renderBattleFrame({ sides: battleSides, hpBefore: snapshots[turns], badge: "FINAL", winnerSide: 0, sprites, screens: [["Ash defeated Gary!", ""], ["Charizard grew to Lv51!", ""]] }));
rows.push({ image: "battle result", kb: kb(fin), ms: finMs, frames: frames(fin) });

for (const [name, fx] of Object.entries(CATCH_FIXTURES)) {
  const v = catchView(fx.user, fx);
  const [png, pngMs] = await time(() => renderCatchCard(v));
  rows.push({ image: `catch ${name} png`, kb: kb(png), ms: pngMs, frames: 1 });
  const [gif, gifMs] = await time(() => renderCatchCard(v, { animate: true }));
  rows.push({ image: `catch ${name} gif`, kb: kb(gif), ms: gifMs, frames: frames(gif) });
}
const TRAINER = "acerola.png"; // Epic: breathes and blinks on animated cards
const player = { ...JSON.parse(JSON.stringify(FIXTURES.full.user)), tp: 8308, cc: 5400, displayedTrainer: TRAINER };
const trainer = { name: "Acerola", tier: "epic" };
const td = leaderboardWorld();
const dailyMon = (id, variant) => catchView(player, { id, variant, catchResult: { level: 5, isNew: true, expGained: 0 }, trainerName: "Coop" });
const cards = {
  "/showteam": (animate) => renderShowteam(buildTeamView(player, { displayName: "Coop", trainerFile: TRAINER }), { layout: "refined", animate }),
  "/trainercard /showcard": (animate) => renderTrainerCard(trainerCardView(player, { displayName: "Coop", trainer }), { animate }),
  "/showbattlecard": (animate) => renderBattleCard(battleCardView(player, { displayName: "Coop", trainer, board: rankBattleRatings(td, "p6") }), { animate }),
  "/pokedex": (animate) => renderPokedexCard(pokedexView(6, player), { animate }),
  "/inspectpokemon (shiny)": (animate) => renderInspectCard(inspectSlots(player, { id: 94 }).find((s) => s.variant === "shiny") ?? inspectSlots(player, { id: 94 })[0], { animate }),
  "/daily": (animate) => renderDailyCard({ pokemon: [dailyMon(399, "normal"), dailyMon(361, "shiny")], cc: 1000, tp: 100, stone: false, balance: { cc: 1, tp: 1 }, rankUp: null }, { animate }),
  "/battle EXP card": (animate) => renderExpCard(expView(BATTLE_FIXTURE.outcome, "A", BATTLE_FIXTURE.names, BATTLE_FIXTURE.users.A), { animate }),
  "/leaderboard": (animate) => renderLeaderboard(leaderboardView(rankBattleRatings(td, "p6"), td, "p6"), { animate }),
};
for (const [name, render] of Object.entries(cards)) {
  const [png, pngMs] = await time(() => render(false));
  rows.push({ image: `${name} png`, kb: kb(png), ms: pngMs, frames: 1, size: `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}` });
  const [gif, gifMs] = await time(() => render(true));
  rows.push({ image: `${name} gif`, kb: kb(gif), ms: gifMs, frames: frames(gif) });
}
console.table(rows);
const battle = rows.filter((r) => r.image.startsWith("battle"));
console.log(`battle: ${turns} turns, ${battle.length} images, ${battle.reduce((a, r) => a + r.kb, 0)} KB uploaded in total, ${battle.reduce((a, r) => a + r.ms, 0)} ms rendering`);
console.log(`peak RSS ${Math.round((process.resourceUsage().maxRSS * 1024) / 1048576)} MB`);
