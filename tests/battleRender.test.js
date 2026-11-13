// ==========================================================
// tests/battleRender.test.js
// Which turns playback shows, turn narration, layout, and the animated GIF.
// ==========================================================

import fs from "fs";
import { performance } from "perf_hooks";
import { GifReader } from "omggif";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import {
  pickFrameTurns, renderBattleFrame, tileCenter, turnText, wrapLines, loadSprite, spritePlayer, ANIMATION, FRAME_WIDTH,
  LAYOUT, portraitBox, AWARD, idleLoops, ROW_TOP,
} from "../utils/battle/render.js";
import { simulateFull } from "../utils/battle/showdown/simulate.js";
import { turnTimeline, marksAt, activeAt } from "../utils/battle/timeline.js";
import { STATUS_COLORS, CHIP_COLORS } from "../utils/battle/fx.js";
import { STEP_MS, TRAINER_LOOP_MS } from "../utils/render/spriteLoops.js";

section("Frame turns");
assertEqual(pickFrameTurns(20, 4), [5, 10, 15, 20], "evenly spaced, last is the final turn");
assertEqual(pickFrameTurns(2, 4), [1, 2], "short battles don't repeat frames");
assertEqual(pickFrameTurns(7, 4), [2, 4, 5, 7], "uneven lengths still end on the final turn");
assertEqual(pickFrameTurns(9, 12), [1, 2, 3, 4, 5, 6, 7, 8, 9], "battles up to 12 turns show every turn");
assertEqual(pickFrameTurns(49, 12).length, 12, "longer battles are capped at 12 updates");

section("Centered rows");
assertTrue([1, 2, 5, 6].every((n) => tileCenter(n, 0) + tileCenter(n, n - 1) === LAYOUT.left + LAYOUT.right),
  "every row is centered between the trainer's portrait and the row's edge");

section("Turn text");
const mon = (speciesId, level, name, variant = "normal") => ({ speciesId, level, variant, name });
const sides = [
  { name: "Ash", members: [mon(6, 36, "Charizard"), mon(25, 20, "Pikachu", "shiny"), mon(1, 5, "Bulbasaur"), mon(150, 40, "Mewtwo"), mon(9999, 1, "Missingno"), mon(19, 3, "Rattata")] },
  { name: "Gary", members: [mon(9, 36, "Blastoise")] },
];
const hit = (o = {}) => ({
  side: 0, slot: 0, targetSlot: 0, move: "Flamethrower", damage: 10, crit: false, eff: 1, missed: false, hpAfter: 0.5, fainted: false, ...o,
});
assertEqual(turnText(hit(), sides), ["Charizard used Flamethrower!", ""], "a plain hit");
assertEqual(turnText(hit({ crit: true, eff: 2, hpAfter: 0, fainted: true }), sides),
  ["Charizard used Flamethrower!", "A critical hit! It's super effective! Blastoise fainted!"], "crit, effectiveness, and faint");
assertEqual(turnText(hit({ eff: 0.5 }), sides)[1], "It's not very effective...", "resisted");
assertEqual(turnText(hit({ eff: 0, damage: 0 }), sides)[1], "It doesn't affect Blastoise...", "immune");
assertEqual(turnText(hit({ missed: true, damage: 0 }), sides)[1], "Charizard's attack missed!", "a miss");
assertEqual(turnText(hit({ move: "Bullet Seed", hits: 3 }), sides), ["Charizard used Bullet Seed!", "Hit 3 times!"], "a multi-hit move says how many times it hit");
assertEqual(turnText(hit({ hits: 1, eff: 2, hpAfter: 0, fainted: true }), sides)[1], "It's super effective! Hit 1 time! Blastoise fainted!", "a multi-hit move that knocks out on the first hit");
assertEqual(turnText(hit({ move: "Giga Drain", drain: 12, userHpAfter: 0.6 }), sides)[1], "Blastoise had its energy drained!", "drain");
assertEqual(turnText(hit({ move: "Flare Blitz", crit: true, hpAfter: 0, fainted: true, recoil: 9, userHpAfter: 0, userFainted: true }), sides)[1],
  "A critical hit! Charizard was damaged by the recoil! Blastoise fainted! Charizard fainted!", "recoil, then both faint");
assertEqual(turnText(hit({ move: "High Jump Kick", missed: true, damage: 0, crash: 60, userHpAfter: 0.5 }), sides)[1],
  "Charizard's attack missed! Charizard kept going and crashed!", "a crash after a miss");
assertEqual(turnText(hit({ eff: 0, damage: 0, crash: 60, userHpAfter: 0, userFainted: true }), sides)[1],
  "It doesn't affect Blastoise... Charizard kept going and crashed! Charizard fainted!", "kicking an immune target can make the user faint");

section("Text box wrapping");
// When a hit's effects overflow the second line, its first sentences move up
// beside the move name, as the games' text boxes wrap.
assertEqual(wrapLines("Charizard used Flare Blitz!", "It's super effective!", (t) => t.length <= 30),
  ["Charizard used Flare Blitz!", "It's super effective!"], "effects that fit stay on the second line");
assertEqual(wrapLines("A used B!", "One! Two! Three is long! Four fainted!", (t) => t.length <= 30),
  ["A used B! One! Two!", "Three is long! Four fainted!"], "sentences move up until the rest fits");
assertEqual(wrapLines("X used Y!", "Mr. Mime fainted! Mime Jr. fainted!", (t) => t.length <= 30),
  ["X used Y! Mr. Mime fainted!", "Mime Jr. fainted!"], "names with periods stay whole");
assertEqual(wrapLines("X used Y!", "It doesn't affect Z... X kept going and crashed!", (t) => t.length <= 32),
  ["X used Y! It doesn't affect Z...", "X kept going and crashed!"], "a sentence can end in an ellipsis");

section("Render");
const decodeFrame = (reader, i) => { const px = new Uint8Array(reader.width * reader.height * 4); reader.decodeAndBlitFrameRGBA(i, px); return px; };
const attack = await renderBattleFrame({
  sides, hpBefore: [[1, 0.5, 0, 0.1, 1, 1], [0.25]], events: [hit({ crit: true, eff: 2, hpAfter: 0, fainted: true })], badge: "TURN 12", surgeSide: 1,
});
const reader = new GifReader(attack);
assertEqual(attack.subarray(0, 6).toString(), "GIF89a", "renders a GIF");
assertEqual(reader.width, FRAME_WIDTH, "full frame width");
// Discord ignores a long last-frame hold and loops each GIF once its regular
// frames run out (seen in a screen recording), so a turn must play long
// enough on 100 ms frames alone to still be showing when the next update lands.
const playedMs = (r) => Array.from({ length: r.numFrames() - 1 }, (_, i) => r.frameInfo(i).delay * 10).reduce((a, b) => a + b, 0);
assertTrue(playedMs(reader) >= ANIMATION.turnMs - ANIMATION.delayMs, "a one-attack turn plays for the full turn length");
const twoHits = new GifReader(await renderBattleFrame({ sides, hpBefore: [[1, 0.5, 0, 0.1, 1, 1], [0.9]], events: [hit({ side: 1, slot: 0, targetSlot: 0, hpAfter: 0.8 }), hit({ hpAfter: 0.4 })], badge: "TURN 3" }));
assertTrue(playedMs(twoHits) >= ANIMATION.turnMs - ANIMATION.delayMs, "a two-attack turn plays for the full turn length");
// Start and result images loop. POKEMON_LOOP_FIT=0: idleFrames of 100 ms per text screen.
const OFF = { POKEMON_LOOP_FIT: "0" };
const resultOpts = { sides, hpBefore: [[1, 1, 1, 1, 1, 1], [0]], screens: [["Ash defeated Gary!", ""], ["Charizard grew to Lv37!", ""]], winnerSide: 0, badge: "FINAL" };
const idleOff = new GifReader(await renderBattleFrame({ sides, hpBefore: [[1, 1, 1, 1, 1, 1], [1]], screens: [["The battle begins!", ""]], env: OFF }));
assertEqual([idleOff.numFrames(), idleOff.frameInfo(0).delay * 10], [ANIMATION.idleFrames, ANIMATION.delayMs], "POKEMON_LOOP_FIT=0: a start image is idleFrames of 100 ms");
const twoOff = new GifReader(await renderBattleFrame({ ...resultOpts, env: OFF }));
assertEqual(twoOff.numFrames(), 2 * ANIMATION.idleFrames, "POKEMON_LOOP_FIT=0: each text screen gets idleFrames");
// Fitted (the default): 50 ms steps over whole loops of the sprites, so the
// GIF's end meets its start with no jump; the screens split it evenly.
const idleGif = await renderBattleFrame({ sides, hpBefore: [[1, 1, 1, 1, 1, 1], [1]], screens: [["The battle begins!", ""]] });
const idle = new GifReader(idleGif);
const loopMs = (r) => { let t = 0; for (let i = 0; i < r.numFrames(); i++) t += r.frameInfo(i).delay * 10; return t; };
assertTrue(Array.from({ length: idle.numFrames() }, (_, i) => idle.frameInfo(i).delay * 10).every((d) => d === STEP_MS), "a fitted start image steps every 50 ms");
assertTrue(loopMs(idle) >= 2000 && loopMs(idle) <= 8000, `and loops its sprites' fitted loop, 2–8 s (${loopMs(idle)} ms)`);
const twoScreens = new GifReader(await renderBattleFrame(resultOpts));
assertTrue(loopMs(twoScreens) / 2 >= 1500, `a fitted result image gives each text screen at least 1.5 s (${loopMs(twoScreens) / 2} ms each)`);
assertEqual(twoScreens.frameInfo(0).delay * 10, STEP_MS, "and steps every 50 ms");
assertEqual(idleLoops(6000, 2), { loops: 1, total: 120 }, "two screens over a 6 s loop: 3 s each");
assertEqual(idleLoops(2400, 3), { loops: 3, total: 144 }, "three screens over a 2.4 s loop: three loops, 2.4 s each");
assertEqual(idleLoops(700, 1), { loops: 3, total: 42 }, "a short loop repeats until its screen has 1.5 s");
assertEqual(idleLoops(8000, 4).loops, 1, "a long loop splits four screens 2 s each");
// No seam: an image whose clock starts one GIF length later shows exactly the
// same first frame, so where the GIF wraps, every sprite, trainer and
// backdrop carries on as if it hadn't.
{
  const pk = (speciesId) => ({ speciesId, name: `#${speciesId}`, level: 50, variant: "normal" });
  const lone = [{ name: "A", members: [pk(193)] }, { name: "B", members: [pk(0)] }];
  const r = new GifReader(await renderBattleFrame({ sides: lone, hpBefore: [[1], [0]], winnerSide: 0, badge: "FINAL", screens: [["A won!", ""]] }));
  const yanma = await loadSprite("normal", 193);
  assertEqual(loopMs(r), Math.round(yanma.duration / STEP_MS) * STEP_MS * idleLoops(Math.round(yanma.duration / STEP_MS) * STEP_MS, 1).loops,
    "a lone sprite's result image plays whole cycles of it");
  const trained = new GifReader(await renderBattleFrame({ sides: lone, hpBefore: [[1], [0]], winnerSide: 0, badge: "FINAL", screens: [["A won!", ""]], trainers: ["cynthia-anime.png", null], tiers: ["mythic", null] }));
  assertEqual(loopMs(trained) % TRAINER_LOOP_MS, 0, `with an idling trainer and a tier backdrop, a whole number of 2.4 s loops (${loopMs(trained)} ms)`);
  const team = { sides: [{ name: "A", members: [494, 445, 134].map((id) => pk(id)) }, { name: "B", members: [pk(6), pk(150)] }], hpBefore: [[1, 0.5, 1], [1, 0]], winnerSide: 0, badge: "FINAL", screens: [["A won!", ""], ["#6 grew!", ""]], trainers: ["cynthia-anime.png", "alain.png"], tiers: ["mythic", "legendary"] };
  const first = await renderBattleFrame(team);
  const n = loopMs(new GifReader(first));
  assertTrue(Buffer.from(decodeFrame(new GifReader(first), 0)).equals(Buffer.from(decodeFrame(new GifReader(await renderBattleFrame({ ...team, clockMs: n })), 0))),
    `a result image with trainers, backdrops and sprites that all fit 7.2 s loops with no seam (${n} ms)`);
}
assertTrue(!Buffer.from(decodeFrame(idle, 0)).equals(Buffer.from(decodeFrame(idle, 10))), "sprites animate between frames");
// Frames after the first store only what changed (the rest is transparent and
// the previous frame shows through). Smaller files load faster, which shortens
// the blank flash Discord's mobile app shows while an updated image loads.
{
  const second = new Uint8Array(reader.width * reader.height * 4);
  reader.decodeAndBlitFrameRGBA(1, second);
  let drawn = 0;
  for (let p = 3; p < second.length; p += 4) if (second[p]) drawn++;
  assertTrue(drawn < second.length / 4 / 4, `a later frame stores only its changes (${Math.round((100 * drawn) / (second.length / 4))}% of pixels)`);
}
// A missing sprite (#9999) still renders the frame.
if (process.env.BATTLE_FRAME_OUT) fs.writeFileSync(process.env.BATTLE_FRAME_OUT, attack);

section("Trainer portraits and the challenge theme");
{
  // Every replay shows each player's trainer at the left of their row
  // (/battle and /challenge alike). /challenge adds a theme: the opponent's
  // row tinted with their type, the Badge in the center pill, and on a first
  // win an award screen that presents the Badge.
  const trainers = ["acerola-masters.png", "brock-gen3.png"];
  const brock = { type: "Rock", badgeFile: "boulder.png" };
  const six = [[6, 25, 3, 150, 94, 130], [74, 95, 141, 139, 142, 76]].map((ids, i) => ({ name: i ? "Gym Leader Brock" : "Ash", members: ids.map((id) => mon(id, 50, `#${id}`)) }));
  const full = [[1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]];
  const composite = (r, k) => { const px = new Uint8Array(r.width * r.height * 4); for (let i = 0; i <= k; i++) r.decodeAndBlitFrameRGBA(i, px); return px; };
  const at = (px, x, y) => { const i = (Math.round(y) * FRAME_WIDTH + Math.round(x)) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  const bright = (px, x, y) => at(px, x, y).reduce((a, b) => a + b, 0);
  const changed = (a, b, { x, y, w, h }) => {
    let n = 0;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const k = (j * FRAME_WIDTH + i) * 4;
      if (Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]) > 40) n++;
    }
    return n;
  };
  const start = async (opts) => composite(new GifReader(await renderBattleFrame({ sides: six, hpBefore: full, screens: [["The battle begins!", ""]], ...opts })), 0);

  const centers = [0, 1, 2, 3, 4, 5].map((i) => tileCenter(6, i));
  assertTrue(centers.every((c, i) => i === 0 || c - centers[i - 1] === LAYOUT.tileW), "tiles are evenly spaced");
  assertTrue(centers[0] - 116 / 2 >= portraitBox(0).x + portraitBox(0).w && centers[5] + 116 / 2 <= FRAME_WIDTH - 12,
    "and every HP bar sits between the portrait and the row's edge");

  const bare = await start({});
  const battle = await start({ trainers });
  const challenge = await start({ trainers, theme: brock });
  assertTrue([0, 1].every((s) => changed(bare, battle, portraitBox(s)) > 600), "/battle: both trainers stand in their portraits");
  const missing = await start({ trainers: ["no-such-trainer.png", null] });
  assertEqual([0, 1].map((s) => changed(bare, missing, portraitBox(s))), [0, 0], "a missing or unset trainer leaves an empty portrait, not a broken frame");
  // A spot of the opponent's row with nothing drawn on it: the row's tint.
  const spot = [FRAME_WIDTH - 20, portraitBox(1).y + portraitBox(1).h - 4];
  // (Within a few levels: the GIF encoder dithers the row's gradient.)
  const near = (a, b, d = 4) => a.every((v, i) => Math.abs(v - b[i]) <= d);
  assertTrue(near(at(battle, ...spot), at(bare, ...spot)), "/battle keeps the opponent's neutral row (no tiers given)");
  const diff = at(challenge, ...spot).reduce((s, v, i) => s + Math.abs(v - at(battle, ...spot)[i]), 0);
  assertTrue(diff > 6, `/challenge tints it with the type (${at(challenge, ...spot)} vs ${at(battle, ...spot)})`);
  const whiteInPill = (px) => {
    let n = 0;
    for (let y = LAYOUT.pillY; y < LAYOUT.pillY + 34; y++) for (let x = FRAME_WIDTH / 2 - 120; x < FRAME_WIDTH / 2 + 120; x++) if (bright(px, x, y) > 700) n++;
    return n;
  };
  assertTrue(whiteInPill(challenge) > 60 && whiteInPill(battle) === 0, "the Boulder Badge sits in the center pill, for challenges only");

  // The result image: the result screen, then the award screen.
  const screens = [["Ash defeated Gym Leader Brock!", ""], ["Ash received the Boulder Badge!", ""]];
  const award = new GifReader(await renderBattleFrame({
    sides: six, hpBefore: [full[0], [0, 0, 0, 0, 0, 0]], badge: "FINAL", winnerSide: 0, screens, trainers, theme: { ...brock, award: { screen: 1, badgeFile: "boulder.png", title: "BOULDER BADGE" } },
  }));
  // Its screen starts halfway through (fitted: the frames split evenly).
  const awardAt = Math.ceil(award.numFrames() / 2);
  assertTrue(loopMs(award) / 2 >= 1500, `the award is its own text screen (${loopMs(award) / 2} ms)`);
  const before = composite(award, 5), during = composite(award, awardAt + 5);
  assertTrue(bright(during, AWARD.cx, AWARD.cy) > 600 && bright(before, AWARD.cx, AWARD.cy) < 600, "the Badge appears, large, only on its screen");
  assertTrue(bright(during, tileCenter(6, 0), 120) < bright(before, tileCenter(6, 0), 120),
    "the field dims behind it");
  const later = composite(award, awardAt + 10);
  assertTrue(changed(during, later, { x: AWARD.cx - AWARD.r - 30, y: AWARD.cy - AWARD.r - 30, w: 2 * AWARD.r + 60, h: 2 * AWARD.r + 60 }) > 20,
    "its sparkles twinkle");

  // Elite Four, Blue and Red have no Badge: a title instead.
  const titled = new GifReader(await renderBattleFrame({
    sides: six, hpBefore: [full[0], [0, 0, 0, 0, 0, 0]], badge: "FINAL", winnerSide: 0, screens, trainers, theme: { ...brock, badgeFile: null, award: { screen: 1, badgeFile: null, title: "ELITE FOUR CLEARED" } },
  }));
  const gold = (px) => {
    let n = 0;
    for (let y = AWARD.cy - 40; y < AWARD.cy + 40; y++) for (let x = 200; x < 700; x++) {
      const [r, g, b] = at(px, x, y);
      if (r > 220 && g > 170 && g < 230 && b < 120) n++;
    }
    return n;
  };
  const [goldDuring, goldBefore] = [gold(composite(titled, Math.ceil(titled.numFrames() / 2) + 5)), gold(composite(titled, 5))];
  // POKEMON_LOOP_FIT=0: the award still gets the second idleFrames.
  const awardOff = new GifReader(await renderBattleFrame({
    sides: six, hpBefore: [full[0], [0, 0, 0, 0, 0, 0]], badge: "FINAL", winnerSide: 0, screens, trainers, env: { POKEMON_LOOP_FIT: "0" }, theme: { ...brock, award: { screen: 1, badgeFile: "boulder.png", title: "BOULDER BADGE" } },
  }));
  assertEqual(awardOff.numFrames(), 2 * ANIMATION.idleFrames, "POKEMON_LOOP_FIT=0: the award screen is the second 2 s");
  assertTrue(bright(composite(awardOff, ANIMATION.idleFrames + 5), AWARD.cx, AWARD.cy) > 600 && bright(composite(awardOff, 5), AWARD.cx, AWARD.cy) < 600, "POKEMON_LOOP_FIT=0: the Badge shows only on its screen");
  assertTrue(goldDuring > goldBefore + 1500, `a gold title on the award screen (${goldDuring} gold pixels vs ${goldBefore})`);
  if (process.env.BATTLE_FRAME_OUT) {
    fs.writeFileSync(process.env.BATTLE_FRAME_OUT.replace(/\.gif$/, "-challenge-start.gif"), await renderBattleFrame({ sides: six, hpBefore: full, screens: [["The battle begins!", "#6 and #74 lead off."]], trainers, theme: brock }));
    fs.writeFileSync(process.env.BATTLE_FRAME_OUT.replace(/\.gif$/, "-challenge-award.gif"), await renderBattleFrame({
      sides: six, hpBefore: [full[0], [0, 0, 0, 0, 0, 0]], badge: "FINAL", winnerSide: 0, screens, trainers, theme: { ...brock, award: { screen: 1, badgeFile: "boulder.png", title: "BOULDER BADGE" } },
    }));
  }
}

section("Sprite cache");
{
  // A battle's images share one cache, so each sprite is decoded once per battle, not once per image.
  const sprites = new Map();
  const turn = (hpBefore) => ({ sides, hpBefore, events: [hit({ side: 1, hpAfter: 0.4 })], badge: "TURN 2" });
  const cachedFirst = await renderBattleFrame({ ...turn([[1, 0.5, 0, 0.1, 1, 1], [0.9]]), sprites });
  assertTrue(sprites.has("normal/6") && sprites.has("shiny/25") && sprites.has("grayscale/1"), "sprites are cached by folder and species");
  const first = new Map(sprites);
  // Charizard has fainted by the next image: it needs its grayscale sprite, not the cached color one.
  const later = turn([[0, 0.5, 0, 0.1, 1, 1], [0.9]]);
  const cachedLater = await renderBattleFrame({ ...later, sprites });
  assertTrue([...first].every(([key, sprite]) => sprites.get(key) === sprite), "later images reuse the decoded sprites");
  assertTrue(sprites.has("grayscale/6"), "a newly fainted Pokémon gets its grayscale sprite");
  assertTrue(cachedFirst.equals(await renderBattleFrame(turn([[1, 0.5, 0, 0.1, 1, 1], [0.9]]))), "a cached image matches an uncached one");
  assertTrue(cachedLater.equals(await renderBattleFrame(later)), "a cached image after a faint matches an uncached one");
}

section("Rendering lets other work run");
{
  // A 6v6 turn image takes about 0.4 s to draw and encode; the bot must keep
  // answering other commands meanwhile (Discord allows 3 s).
  const full = [[6, 25, 3, 150, 94, 130], [9, 143, 149, 65, 68, 248]].map((ids, i) => ({ name: i ? "Gary" : "Ash", members: ids.map((id) => mon(id, 50, `#${id}`)) }));
  let last = performance.now(), longest = 0;
  const tick = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; }, 5);
  await renderBattleFrame({ sides: full, hpBefore: [[1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]], events: [hit(), hit({ side: 1 })], badge: "TURN 1" });
  clearInterval(tick);
  longest = Math.max(longest, performance.now() - last);
  assertTrue(longest < 250, `the bot keeps running while an image renders (longest pause ${Math.round(longest)} ms)`);
}

section("Colors that only appear later");
{
  // Every bar starts green; Blastoise drops from 90% to 10% HP, so its bar
  // ends red, a color the first frame doesn't have.
  const r = new GifReader(await renderBattleFrame({ sides, hpBefore: [[1, 1, 1, 1, 1, 1], [0.9]], events: [hit({ hpAfter: 0.1 })], badge: "TURN 4" }));
  const end = new Uint8Array(r.width * r.height * 4);
  for (let i = 0; i < r.numFrames(); i++) r.decodeAndBlitFrameRGBA(i, end);
  // The fill of the HP bar under Gary's only Pokémon.
  const [red, green, blue] = end.subarray((375 * r.width + tileCenter(1, 0) - 26) * 4);
  const off = Math.abs(red - 0xef) + Math.abs(green - 0x4b) + Math.abs(blue - 0x4b);
  // A palette from the first frame alone came out 28 off (228, 72, 61).
  assertTrue(off < 15, `the low-HP bar shows its red (${red}, ${green}, ${blue})`);
}

section("The attacker's own HP");
{
  // Charizard, first on Ash's row, drains from 10% to 90% HP.
  const r = new GifReader(await renderBattleFrame({
    sides, hpBefore: [[0.1, 1, 1, 1, 1, 1], [0.9]], events: [hit({ move: "Giga Drain", hpAfter: 0.5, drain: 50, userHpAfter: 0.9 })], badge: "TURN 5",
  }));
  // A point 70% along Charizard's HP bar: empty at 10% HP, filled at 90%.
  const at = (px) => [...px.subarray((179 * r.width + tileCenter(6, 0) + 30) * 4, (179 * r.width + tileCenter(6, 0) + 30) * 4 + 3)];
  const first = new Uint8Array(r.width * r.height * 4);
  r.decodeAndBlitFrameRGBA(0, first);
  const end = new Uint8Array(r.width * r.height * 4);
  for (let i = 0; i < r.numFrames(); i++) r.decodeAndBlitFrameRGBA(i, end);
  const near = ([a, b, c], [x, y, z]) => Math.abs(a - x) + Math.abs(b - y) + Math.abs(c - z) < 15;
  assertTrue(near(at(first), [0x3a, 0x42, 0x56]), `Charizard's bar starts nearly empty (${at(first)})`);
  assertTrue(near(at(end), [0x3f, 0xd4, 0x6c]), `and ends green after draining (${at(end)})`);
  const attack = new Uint8Array(r.width * r.height * 4);
  for (let i = 0; i < ANIMATION.eventFrames; i++) r.decodeAndBlitFrameRGBA(i, attack);
  assertTrue(near(at(attack), [0x3f, 0xd4, 0x6c]), `it fills during the attack's own frames, not after (${at(attack)})`);
}
{
  const sprites = new Map();
  await renderBattleFrame({
    sides, hpBefore: [[1, 1, 1, 1, 1, 1], [0.9]], badge: "TURN 6", sprites,
    events: [hit({ move: "Flare Blitz", hpAfter: 0.5, recoil: 99, userHpAfter: 0, userFainted: true })],
  });
  assertTrue(sprites.has("grayscale/6"), "an attacker that faints from its own recoil turns gray");
}

section("Sprites decode as they play");
{
  // Bulbasaur's sprite clears parts of some frames (GIF disposal 2). Decoding
  // a frame only when an image reaches it must match decoding every frame up front.
  const sprite = await loadSprite("normal", 1);
  const { width, height, gif } = sprite;
  const full = [];
  const px = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < gif.numFrames(); i++) {
    gif.decodeAndBlitFrameRGBA(i, px);
    full.push(Buffer.from(px));
    const f = gif.frameInfo(i);
    if (f.disposal === 2) for (let y = f.y; y < f.y + f.height; y++) px.fill(0, (y * width + f.x) * 4, (y * width + f.x + f.width) * 4);
  }
  assertTrue(gif.numFrames() > 5 && [...Array(gif.numFrames()).keys()].some((i) => gif.frameInfo(i).disposal === 2), "fixture: the sprite has clearing frames");
  const play = spritePlayer(sprite);
  const shown = (ms) => Buffer.from(play(ms).getContext("2d").getImageData(0, 0, width, height).data);
  assertTrue(sprite.starts.every((ms, k) => shown(ms).equals(full[k])), "every frame matches a full decode");
  assertTrue(shown(sprite.starts[3]).equals(full[3]), "jumping back to an earlier frame");
  assertTrue(shown(sprite.duration + sprite.starts[5]).equals(full[5]), "the animation loops");
  assertTrue(!("frames" in sprite), "a cached sprite keeps its GIF file, not every decoded frame (about 5 MB for 12 sprites)");
}

section("Sprite files");
{
  // The player handles GIF disposal 0-2. Disposal 3 (restore the previous
  // frame) would need a saved copy of each frame; no sprite uses it today.
  const bad = [];
  for (const folder of ["normal", "shiny", "grayscale"]) {
    const dir = new URL(`../public/sprites/pokemon/${folder}/`, import.meta.url);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".gif"))) {
      const r = new GifReader(fs.readFileSync(new URL(file, dir)));
      for (let i = 0; i < r.numFrames(); i++) if (r.frameInfo(i).disposal === 3) { bad.push(`${folder}/${file}`); break; }
    }
  }
  assertEqual(bad, [], "no sprite uses GIF disposal 3");
}

section("Battle FX");
{
  // A burn, a Swords Dance, and burn ticks until the burned Snorlax (at 20%) faints.
  const fxMon = (speciesId, name, moves, extra = {}) => ({ speciesId, variant: "normal", name, level: 50, moves, ...extra });
  const seq = (moves) => (req, b) => (req.forceSwitch ? null : moves[Math.min(b.turn, moves.length) - 1]);
  const teams = [[fxMon(94, "Gengar", ["willowisp", "splash"])], [fxMon(143, "Snorlax", ["swordsdance", "splash"], { hpFraction: 0.2 })]];
  const r = simulateFull({ sides: teams.map((members) => ({ members })), seed: 5, ai: [seq(["move 1", "move 2"]), seq(["move 1", "move 2"])] });
  const names = teams.map((s) => s.map((m) => m.name));
  const fxSides = [{ name: "Ash", members: teams[0] }, { name: "Gary", members: teams[1] }];
  const on = { ...process.env, BATTLE_FX: "1" };
  const turnGif = (t, o = {}) => renderBattleFrame({ sides: fxSides, hpBefore: r.snapshots[t - 1], timeline: turnTimeline(r, t, names), badge: `TURN ${t}`, env: on, ...o });
  // Every frame up to i, composited as a viewer sees it (each frame stores only what changed).
  const frameAt = (gif, i) => { const g = new GifReader(gif); const px = new Uint8Array(g.width * g.height * 4); for (let k = 0; k <= i; k++) g.decodeAndBlitFrameRGBA(k, px); return px; };
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const near = (px, i, c) => rgb(c).every((v, k) => Math.abs(px[i + k] - v) <= 12);
  const count = (px, [x0, y0, w, h], c) => { let n = 0; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (near(px, (y * FRAME_WIDTH + x) * 4, c)) n++; return n; };
  const cx = tileCenter(1, 0);
  const capsule = (s) => [cx - 58 + 3, ROW_TOP[s] + 158 + 3, 22, 8];
  const chipArea = (s) => [cx - LAYOUT.tileW / 2 + 4, ROW_TOP[s] + 28, LAYOUT.tileW / 2 + 2, 34];

  const off = { ...process.env, BATTLE_FX: "0" };
  const plain = await renderBattleFrame({ sides: fxSides, hpBefore: r.snapshots[0], events: r.log[0], active: activeAt(r, 1), badge: "TURN 1", env: off });
  const viaTimeline = await renderBattleFrame({ sides: fxSides, hpBefore: r.snapshots[0], timeline: turnTimeline(r, 1, names, { env: off }), badge: "TURN 1", env: off });
  assertTrue(Buffer.from(plain).equals(Buffer.from(viaTimeline)), "BATTLE_FX=0: a timeline of today's hits renders the same bytes as the events");

  const asleep = [[fxMon(143, "Snorlax", ["tackle"], { status: "slp" })], [fxMon(143, "Snorlax", ["tackle"], { status: "slp" })]];
  const r2 = simulateFull({ sides: asleep.map((members) => ({ members })), seed: 3 });
  const tl2 = turnTimeline(r2, 1, asleep.map((s) => s.map((m) => m.name)));
  const g2 = new GifReader(await renderBattleFrame({ sides: [{ name: "A", members: asleep[0] }, { name: "B", members: asleep[1] }], hpBefore: r2.snapshots[0], timeline: tl2, env: on }));
  assertEqual([g2.numFrames(), g2.frameInfo(g2.numFrames() - 1).delay * 10], [tl2.minFrames, ANIMATION.freezeMs], "a turn with beats and no hits is a turn image: its full length, then the freeze");

  const t2 = await turnGif(2);
  const f0 = frameAt(t2, 0);
  assertTrue(count(f0, capsule(1), STATUS_COLORS.brn) > 0.3 * 22 * 8, "the burned Snorlax's bar shows BRN in the burn's color");
  assertTrue(count(f0, capsule(0), "#f6b73c") > 0.3 * 22 * 8, "Gengar's bar keeps its HP label");
  assertTrue(count(f0, chipArea(1), CHIP_COLORS.up) > 10, "the Swords Dance chip shows at the fighting Snorlax's top-left");

  const megaSides = [fxSides[0], { name: "Gary", members: [{ ...teams[1][0], megaForm: "mega-charizard-x" }] }];
  const fm = frameAt(await turnGif(2, { sides: megaSides }), 0);
  const tag = [cx + LAYOUT.tileW / 2 - 8 - 56, ROW_TOP[1] + 30, 56, 18];
  assertTrue(count(fm, chipArea(1), CHIP_COLORS.up) > 10 && count(fm, tag, CHIP_COLORS.up) === 0, "on a Mega slot the chips stay clear of the MEGA tag");

  const tl1 = turnTimeline(r, 1, names);
  const t1 = await turnGif(1);
  const stats = tl1.segments.find((s) => s.kind === "beat" && s.fx === "stats");
  const last = new GifReader(t1).numFrames() - 1;
  assertTrue(!Buffer.from(frameAt(t1, stats.start + 4)).equals(Buffer.from(frameAt(t1, last))), "a beat's frames differ from the hold");
  const flames = tl1.segments.find((s) => s.kind === "beat" && s.fx === "brn");
  assertTrue(count(frameAt(t1, flames.start + 4), [cx - 70, ROW_TOP[1] + 20, 140, 120], "#ffd34d") > 5, "the flames' yellow survives the palette (a mid-beat frame is sampled)");

  const tick = turnTimeline(r, 2, names).segments.find((s) => s.kind === "beat" && s.fx === "brn");
  const bar = (px) => { let n = 0; const y = ROW_TOP[1] + 158 + 3 + 4; for (let x = cx - 58 + 28; x < cx + 58 - 3; x++) if (["#3fd46c", "#f5c431", "#ef4b4b"].some((c) => near(px, (y * FRAME_WIDTH + x) * 4, c))) n++; return n; };
  assertTrue(bar(frameAt(t2, tick.start + 5)) < bar(frameAt(t2, tick.start + 1)), "the HP bar drains during a burn tick");

  const tlLast = turnTimeline(r, r.turns, names);
  assertTrue(tlLast.segments.some((s) => s.kind === "beat" && s.ko), "the last turn ends on a burn knockout");
  const gLast = await turnGif(r.turns);
  const spriteArea = [cx - 34, ROW_TOP[1] + 60, 68, 66];
  const colored = (px) => { let n = 0; const [x0, y0, w, h] = spriteArea; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * FRAME_WIDTH + x) * 4; const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]); if (mx > 90 && (mx - mn) / mx > 0.3) n++; } return n; };
  assertTrue(colored(frameAt(gLast, new GifReader(gLast).numFrames() - 1)) < 5 && colored(frameAt(gLast, 0)) > 50, "a burn knockout grays the sprite");
  const final = frameAt(await renderBattleFrame({ sides: fxSides, hpBefore: r.snapshots[r.turns], badge: "FINAL", winnerSide: 0, marks: marksAt(r, r.turns), env: on }), 0);
  assertTrue(count(final, capsule(1), STATUS_COLORS.brn) === 0, "the result image shows no tag on the fainted Snorlax");

  const carried = [[fxMon(143, "Snorlax", ["splash"], { status: "brn" })], [fxMon(94, "Gengar", ["splash"])]];
  const r3 = simulateFull({ sides: carried.map((members) => ({ members })), seed: 1 });
  const start = frameAt(await renderBattleFrame({ sides: [{ name: "A", members: carried[0] }, { name: "B", members: carried[1] }], hpBefore: r3.snapshots[0], marks: marksAt(r3, 0), screens: [["The battle begins!", ""]], env: on }), 0);
  assertTrue(count(start, capsule(0), STATUS_COLORS.brn) > 0.3 * 22 * 8, "a burn carried into the fight shows on its start image");
}

finish();
