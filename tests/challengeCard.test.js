// ==========================================================
// tests/challengeCard.test.js
// The /challenge VS card: the facts it shows for a Gym, the Elite Four,
// Blue and Red, that it never carries the exact CC loss (the same image is
// posted in public), and that the pieces land where the layout says.
// Synthetic data only.
// ==========================================================

import fs from "fs";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { challengeCardView, renderChallengeCard, cardSlots, cardAltText, prizeLines, CHALLENGE_CARD_SIZE } from "../utils/render/challengeCard.js";
import { previewChallenge } from "../utils/challenge/runChallenge.js";
import { createNewUser } from "../utils/userSchema.js";
import { COLOR } from "../utils/render/tokens.js";

const dims = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];
const clone = (o) => JSON.parse(JSON.stringify(o));

function player({ won = {}, trainer = "acerola-masters.png", team = [6, 94, 445] } = {}) {
  const u = createNewUser("A", "A");
  for (const sid of team) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    (u.training ??= {})[`${sid}:normal`] = { exp: 30 ** 3 };
  }
  u.displayedPokemon = team.map((id) => ({ id, variant: "normal" }));
  u.displayedTrainer = trainer;
  u.cc = 12345;
  u.challenge = { won, day: null, attempts: 0 };
  return u;
}
const view = (key, user = player()) => challengeCardView(key, previewChallenge(user, key), user, { displayName: "Ash" });
const allGyms = Object.fromEntries(["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"].map((k) => [k, "2026-11-01"]));

// Pixels: the sum of R+G+B at (x, y), and how many pixels differ inside a box.
const pixels = async (png) => {
  const img = await loadImage(png);
  const ctx = createCanvas(img.width, img.height).getContext("2d");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
};
const brightness = (im, x, y) => { const i = (Math.round(y) * im.width + Math.round(x)) * 4; return im.data[i] + im.data[i + 1] + im.data[i + 2]; };
function differing(a, b, { x, y, w, h }) {
  let n = 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    const k = (j * a.width + i) * 4;
    if (Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]) > 30) n++;
  }
  return n;
}

section("A Gym");
{
  const user = player({ won: { brock: "2026-11-01", misty: "2026-11-02" } });
  const before = clone(user);
  const v = view("surge", user);
  assertEqual([v.kind, v.eyebrow, v.title, v.type], ["gym", "GYM LEADER", "Lt. Surge", "Electric"], "who and what type");
  assertEqual(v.opponents.map((o) => o.trainerFile), ["ltsurge-gen3.png"], "the leader's sprite");
  assertEqual(v.badge, { file: "thunder.png", name: "Thunder Badge", earned: false }, "the Badge on the line");
  assertEqual(v.partySize, 6, "the leader's party size (Poké Balls, not the Team)");
  assertEqual(v.win, "Lt. Surge sprite, 4,000 CC, 1 stone, and 10 Dust", "the prize");
  assertEqual(v.rematch, false, "a first try");
  assertEqual([v.player.name, v.player.trainerFile, v.player.team.map((s) => s.id)], ["Ash", "acerola-masters.png", [6, 94, 445]],
    "the challenger, their trainer and their battle Team");
  assertEqual(v.player.badges.map((b) => (b.earned ? b.file : "-")), ["boulder.png", "cascade.png", "-", "-", "-", "-", "-", "-"],
    "the challenger's Badges in Gym order");
  assertEqual(user, before, "never mutates the record");
}

section("Never the exact loss");
{
  const v = view("brock");
  const text = JSON.stringify(v);
  assertTrue(!("loss" in v) && !text.includes("1,234") && !text.includes("1234") && !text.includes("12,345") && !text.includes("12345"),
    "no loss amount or balance: the same image goes in public");
}

section("A rematch");
{
  const v = view("brock", player({ won: { brock: "2026-11-01" } }));
  assertEqual([v.rematch, v.win, v.badge.earned], [true, null, true], "EXP only, and the Badge already earned");
}

section("The Elite Four, Blue and Red");
{
  const e4 = view("elite4", player({ won: allGyms }));
  assertEqual([e4.kind, e4.eyebrow, e4.title, e4.type, e4.badge], ["elite4", "ELITE FOUR", "The Elite Four", null, null], "a run, with no Badge");
  assertEqual(e4.opponents.map((o) => [o.name, o.type]), [["Lorelei", "Ice"], ["Bruno", "Fighting"], ["Agatha", "Ghost"], ["Lance", "Dragon"]],
    "all four, each with their type");
  const blue = view("blue", player({ won: { ...allGyms, elite4: "d" } }));
  assertEqual([blue.kind, blue.eyebrow, blue.title, blue.type, blue.badge, blue.accent], ["champion", "CHAMPION", "Blue", null, null, COLOR.red],
    "no type: the opponent's red");
  const red = view("red");
  assertEqual([red.eyebrow, red.title, red.badge], ["POKÉMON TRAINER", "Red", null], "Red");
}

section("Alt text");
// Discord reads an image's description to screen readers; it says what the card shows.
assertEqual(cardAltText(view("brock")),
  "Ash vs Gym Leader Brock (Rock). The Boulder Badge is on the line. Win: Brock sprite, 2,500 CC, 1 stone, and 5 Dust. Lose: 10% of CC.",
  "a Gym");
assertEqual(cardAltText(view("brock", player({ won: { brock: "d" } }))),
  "Ash vs Gym Leader Brock (Rock). Rematch. Win: EXP only. Lose: 10% of CC.", "a rematch");
assertEqual(cardAltText(view("elite4", player({ won: allGyms }))),
  "Ash vs the Elite Four: Lorelei, Bruno, Agatha, and Lance. Win: Lorelei sprite, Bruno sprite, Agatha sprite, Lance sprite, 30,000 CC, 4 stones, and 40 Dust. Lose: 10% of CC.",
  "the Elite Four");
assertEqual(cardAltText(view("red")).split(". ")[0], "Ash vs Pokémon Trainer Red", "Red");

section("The prize line");
{
  const ctx = createCanvas(10, 10).getContext("2d");
  const one = prizeLines(ctx, view("brock").win, 800);
  assertEqual([one.size, one.lines], [26, ["Brock sprite, 2,500 CC, 1 stone, and 5 Dust"]], "a Gym's prize fits one line at full size");
  const e4 = prizeLines(ctx, view("elite4", player({ won: allGyms })).win, 800);
  assertEqual(e4.size, 22, "a long prize goes no smaller than 22 px");
  assertTrue(e4.lines.length === 2 && e4.lines[0].endsWith(",") && e4.lines.join(" ") === view("elite4", player({ won: allGyms })).win,
    "and splits after a comma onto two lines, losing nothing");
  ctx.font = "800 22px sans-serif";
  assertTrue(e4.lines.every((l) => ctx.measureText(l).width <= 800 + 40), "both lines fit");
}

section("Render");
{
  const { w, h } = CHALLENGE_CARD_SIZE;
  const gym = view("brock");
  const cases = {
    gym,
    rematch: view("brock", player({ won: { brock: "d" } })),
    elite4: view("elite4", player({ won: allGyms })),
    blue: view("blue"),
    red: view("red"),
    noTrainerNoTeam: view("misty", player({ trainer: null, team: [] })),
    longName: { ...gym, player: { ...gym.player, name: "A really very extremely long display name" } },
  };
  const out = {};
  for (const [name, v] of Object.entries(cases)) {
    out[name] = await renderChallengeCard(v);
    assertEqual(dims(out[name]), [w, h], `renders: ${name}`);
  }
  if (process.env.CHALLENGE_CARD_OUT) for (const [name, png] of Object.entries(out)) fs.writeFileSync(`${process.env.CHALLENGE_CARD_OUT}/challenge-vs-${name}.png`, png);

  const gymPx = await pixels(out.gym);
  const m = cardSlots(gym).medallion;
  assertTrue(brightness(gymPx, m.cx, m.cy) > 600, "the Badge sits in the medallion (Boulder's center is white)");
  const bluePx = await pixels(out.blue);
  assertEqual(cardSlots(cases.blue).medallion, null, "Blue has no medallion");
  assertTrue(brightness(bluePx, m.cx, m.cy) < 400, "and nothing white where a Gym's Badge would be");

  const noLeader = await pixels(await renderChallengeCard({ ...gym, opponents: [{ ...gym.opponents[0], trainerFile: null }] }));
  const leader = cardSlots(gym).opponents[0].box;
  assertTrue(differing(gymPx, noLeader, leader) > 1000, "the leader stands in their box");
  const noPlayer = await pixels(await renderChallengeCard({ ...gym, player: { ...gym.player, trainerFile: null } }));
  assertTrue(differing(gymPx, noPlayer, cardSlots(gym).player.box) > 1000, "the challenger stands in theirs");

  const badges = cardSlots(gym).badges;
  assertEqual(badges.length, 8, "eight Badge slots for the challenger");
  const surge = await pixels(await renderChallengeCard(view("surge", player({ won: { brock: "d" } }))));
  const boulder = badges[0];
  assertTrue(brightness(surge, boulder.x + boulder.size / 2, boulder.y + boulder.size / 2) > 600, "an earned Badge is lit");
  assertTrue(brightness(gymPx, boulder.x + boulder.size / 2, boulder.y + boulder.size / 2) < 400, "one not earned yet is dim");

  const e4Px = await pixels(out.elite4);
  const boxes = cardSlots(cases.elite4).opponents.map((o) => o.box);
  assertEqual(boxes.length, 4, "four Elite Four boxes");
  assertTrue(boxes.every((b, i) => i === 0 || b.x >= boxes[i - 1].x + boxes[i - 1].w), "side by side, not overlapping");
  const noE4 = await pixels(await renderChallengeCard({ ...cases.elite4, opponents: cases.elite4.opponents.map((o) => ({ ...o, trainerFile: null })) }));
  assertTrue(boxes.every((b) => differing(e4Px, noE4, b) > 400), "each member stands in their box");
}

finish();
