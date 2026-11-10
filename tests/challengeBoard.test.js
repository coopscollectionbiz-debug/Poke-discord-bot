// ==========================================================
// tests/challengeBoard.test.js
// The /challenge board as an image: the 8 Gyms with their leaders and
// Badges, and the Elite Four, Blue and Red as locked silhouettes, open, or
// cleared; challenges left today. Synthetic data only.
// ==========================================================

import fs from "fs";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { boardView, boardAltText, renderBoard, boardSlots, BOARD_SIZE } from "../utils/render/challengeBoard.js";
import { createNewUser } from "../utils/userSchema.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const GYMS = ["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"];
const dims = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];
const clone = (o) => JSON.parse(JSON.stringify(o));
function player(won = {}, attempts = 0) {
  const u = createNewUser("A", "A");
  u.challenge = { won, day: "2026-11-10", attempts };
  return u;
}
const allGyms = Object.fromEntries(GYMS.map((k) => [k, "2026-11-01"]));
const view = (user) => boardView(user, { displayName: "Ash", now: NOW });

section("What the board shows");
{
  const fresh = player();
  const before = clone(fresh);
  const v = view(fresh);
  assertEqual([v.name, v.badges, v.left, v.perDay], ["Ash", 0, 5, 5], "the player, their Badge count, and challenges left today");
  assertEqual(v.gyms.map((g) => g.leader), ["Brock", "Misty", "Lt. Surge", "Erika", "Koga", "Sabrina", "Blaine", "Giovanni"], "the 8 Gyms in order");
  assertEqual([v.gyms[0].type, v.gyms[0].trainerFile, v.gyms[0].badgeFile, v.gyms[0].earned], ["Rock", "brock-gen3.png", "boulder.png", false],
    "each with its type, leader sprite, and Badge");
  assertEqual([v.elite4.state, v.elite4.missing, v.blue.state, v.red.state], ["locked", 8, "locked", "open"], "the League locked, Red open");
  assertEqual(v.elite4.members.map((m) => m.name), ["Lorelei", "Bruno", "Agatha", "Lance"], "the four members");
  assertEqual(fresh, before, "never mutates the record");

  const seven = view(player(Object.fromEntries(GYMS.slice(0, 7).map((k) => [k, "d"])), 2));
  assertEqual([seven.badges, seven.elite4.missing, seven.left], [7, 1, 3], "Badges earned, the one still missing, and attempts used today");
  assertEqual(seven.gyms.map((g) => g.earned), [true, true, true, true, true, true, true, false], "earned Gyms are marked");
  const yesterday = player({}, 4);
  yesterday.challenge.day = "2026-11-09";
  assertEqual(view(yesterday).left, 5, "yesterday's attempts don't count");

  const open = view(player({ ...allGyms }));
  assertEqual([open.elite4.state, open.blue.state], ["open", "locked"], "8 Badges open the Elite Four");
  const cleared = view(player({ ...allGyms, elite4: "d" }));
  assertEqual([cleared.elite4.state, cleared.blue.state], ["cleared", "open"], "a cleared run opens Blue");
  const done = view(player({ ...allGyms, elite4: "d", blue: "d", red: "d" }));
  assertEqual([done.blue.state, done.red.state], ["cleared", "cleared"], "Blue and Red cleared");
  assertEqual(view(null).left, 5, "a player with no record sees a fresh board");
}

section("Alt text");
assertEqual(boardAltText(view(player({ brock: "d", misty: "d" }, 1))),
  "Ash's Kanto challenges: 2 of 8 Badges (Brock and Misty). Elite Four: locked, 6 more Badges. Blue: locked, clear the Elite Four first. Red: open. 4 of 5 challenges left today.",
  "a player partway through");
assertEqual(boardAltText(view(player({ ...allGyms, elite4: "d", red: "d" }))),
  "Ash's Kanto challenges: 8 of 8 Badges (Brock, Misty, Lt. Surge, Erika, Koga, Sabrina, Blaine, and Giovanni). Elite Four: cleared. Blue: open. Red: cleared. 5 of 5 challenges left today.",
  "a player near the end");
assertTrue(boardAltText(view(player({ ...allGyms }))).includes(" Elite Four: open. Blue: locked, clear the Elite Four first."), "an open run");

section("Render");
{
  const pixels = async (png) => {
    const img = await loadImage(png);
    const ctx = createCanvas(img.width, img.height).getContext("2d");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  };
  const bright = (im, x, y) => { const i = (Math.round(y) * im.width + Math.round(x)) * 4; return im.data[i] + im.data[i + 1] + im.data[i + 2]; };
  const mean = (im, { x, y, w, h }) => {
    let t = 0;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) t += bright(im, i, j);
    return t / (w * h);
  };
  const changed = (a, b, { x, y, w, h }) => {
    let n = 0;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (Math.abs(bright(a, i, j) - bright(b, i, j)) > 60) n++;
    return n;
  };
  const cases = {
    fresh: player(),
    partway: player({ brock: "d", misty: "d", surge: "d" }, 2),
    openRun: player({ ...allGyms }),
    champion: player({ ...allGyms, elite4: "d", blue: "d", red: "d" }),
  };
  const out = {};
  for (const [name, u] of Object.entries(cases)) {
    out[name] = await renderBoard(view(u));
    assertEqual(dims(out[name]), [BOARD_SIZE.w, BOARD_SIZE.h], `renders: ${name}`);
  }
  if (process.env.CHALLENGE_BOARD_OUT) for (const [name, png] of Object.entries(out)) fs.writeFileSync(`${process.env.CHALLENGE_BOARD_OUT}/challenge-board-${name}.png`, png);

  const slots = boardSlots();
  const [fresh, partway, openRun, champion] = await Promise.all([out.fresh, out.partway, out.openRun, out.champion].map(pixels));
  const boulder = slots.gyms[0].badge;
  const centerOf = (b) => [b.x + b.size / 2, b.y + b.size / 2];
  assertTrue(bright(partway, ...centerOf(boulder)) > 600 && bright(fresh, ...centerOf(boulder)) < 400, "an earned Badge is lit, one not earned is dim");
  assertTrue(slots.gyms.every((g, i) => i === 0 || g.x >= slots.gyms[i - 1].x + slots.gyms[i - 1].w), "Gym tiles sit side by side");
  assertTrue(slots.gyms.every((g) => changed(fresh, partway, g.sprite) < 200), "every leader shows in color either way: Gyms are always open");

  // Locked opponents are dark silhouettes; open ones are drawn in color.
  const blue = slots.blue.sprite;
  assertTrue(changed(fresh, champion, blue) > 800 && mean(fresh, blue) < mean(champion, blue),
    "a locked Blue is a dark silhouette, an open one is in color");
  assertTrue(slots.elite4.members.every((m) => changed(fresh, openRun, m) > 300 && mean(fresh, m) < mean(openRun, m)),
    "so are the Elite Four until all 8 Badges");
  assertTrue(changed(fresh, openRun, slots.red.sprite) < 200, "Red is open from the start");
}

finish();
