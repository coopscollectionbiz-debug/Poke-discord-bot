// ==========================================================
// tools/bench-displays.mjs — what each Discord display costs to make.
//   node tools/bench-displays.mjs
// Battle: a seeded 6v6 battle, rendered as playback would (start image,
// every picked turn, result), reporting each image's KB, ms and frame count.
// Catch: each CATCH_FIXTURES card as PNG and as GIF.
// Peak RSS is for the whole process (one fresh Node).
// ==========================================================

import { performance } from "perf_hooks";
import { GifReader } from "omggif";
import { simulateBattle } from "../utils/battle/sim.js";
import { renderBattleFrame, pickFrameTurns } from "../utils/battle/render.js";
import { PLAYBACK } from "../utils/battle/tuning.js";
import { catchView, renderCatchCard } from "../utils/render/catchCard.js";
import { CATCH_FIXTURES } from "../tests/fixtures/showteamFixtures.js";

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
console.table(rows);
const battle = rows.filter((r) => r.image.startsWith("battle"));
console.log(`battle: ${turns} turns, ${battle.length} images, ${battle.reduce((a, r) => a + r.kb, 0)} KB uploaded in total, ${battle.reduce((a, r) => a + r.ms, 0)} ms rendering`);
console.log(`peak RSS ${Math.round((process.resourceUsage().maxRSS * 1024) / 1048576)} MB`);
