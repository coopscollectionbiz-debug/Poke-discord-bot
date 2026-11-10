// ==========================================================
// tests/encounterCard.test.js
// The Trainer encounter card (docs/superpowers/specs/2026-11-10-trainer-
// encounters-design.md, Discord UX): the facts it shows, that it never
// shows a Level (disguises hold), its alt text, the games' "!" over the
// Trainer, and that the pieces land where the layout says. Synthetic data.
// ==========================================================

import fs from "fs";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { encounterCardView, encounterAltText, encounterSlots, renderEncounterCard, ENCOUNTER_CARD_SIZE } from "../utils/render/encounterCard.js";
import { ALERT_BUBBLE } from "../utils/render/primitives.js";
import { rollTrainer } from "../utils/encounter/generate.js";
import { createNewUser } from "../utils/userSchema.js";
import { buildTeam } from "../utils/battle/runBattle.js";

const dims = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];
const pixels = async (png) => {
  const img = await loadImage(png);
  const ctx = createCanvas(img.width, img.height).getContext("2d");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
};
const rgb = (im, x, y) => { const i = (Math.round(y) * im.width + Math.round(x)) * 4; return [im.data[i], im.data[i + 1], im.data[i + 2]]; };
function differing(a, b, { x, y, w, h }) {
  let n = 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    const [p, q] = [rgb(a, i, j), rgb(b, i, j)];
    if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 30) n++;
  }
  return n;
}
const isGold = ([r, g, b]) => r > 200 && g > 160 && b < 120;

function player({ trainer = "acerola-masters.png", team = [6, 94, 445] } = {}) {
  const u = createNewUser("A", "A");
  for (const sid of team) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    (u.training ??= {})[`${sid}:normal`] = { exp: 30 ** 3 };
  }
  u.displayedPokemon = team.map((id) => ({ id, variant: "normal" }));
  u.displayedTrainer = trainer;
  return u;
}
const card = (user) => buildTeam(user).map(({ speciesId, variant }) => ({ speciesId, variant }));
const youngster = { ...rollTrainer({ team: [{ level: 30 }], seed: 1 }), classKey: "youngster", title: "Youngster", name: "Joey", spriteFile: "youngster-gen3.png" };
const view = (trainer = youngster, user = player()) => encounterCardView({ trainer, team: card(user), user, displayName: "Ash" });

section("What the card shows");
{
  const user = player();
  const before = JSON.stringify(user);
  const v = view(youngster, user);
  assertEqual(v.heading, "Youngster Joey challenged Ash!", "the games' wording");
  assertEqual(v.line, youngster.lines.intro, "the Trainer's line");
  assertEqual([v.trainer.trainerFile, v.trainer.partySize, v.prize], ["youngster-gen3.png", youngster.party.length, youngster.prize],
    "the sprite, the party as a count, and the Prize money");
  assertEqual([v.player.name, v.player.trainerFile, v.player.team.map((s) => s.id)], ["Ash", "acerola-masters.png", [6, 94, 445]],
    "the player, their trainer and the Team that will fight");
  assertTrue(!/level/i.test(JSON.stringify(v)), "no Levels anywhere: disguises hold");
  assertEqual(JSON.stringify(user), before, "never mutates the record");
}

section("Alt text");
assertEqual(encounterAltText(view()), `Youngster Joey challenged Ash! "${youngster.lines.intro}" Win or lose: ${youngster.prize.toLocaleString("en-US")} CC.`,
  "what the card shows, in words");
assertTrue(encounterAltText(view({ ...youngster, prize: 4000 })).endsWith("Win or lose: 4,000 CC."), "thousands get a comma");

section("The !");
assertTrue(ALERT_BUBBLE.length === 16 && ALERT_BUBBLE.every((r) => r.length === 16 && /^[.owx]+$/.test(r)), "a 16 × 16 pixel grid");
assertTrue(ALERT_BUBBLE.every((r) => r === [...r].reverse().join("")), "symmetric, like the games' bubble");
assertTrue(ALERT_BUBBLE.join("").includes("x"), "with the mark in it");

section("Render");
{
  const { w, h } = ENCOUNTER_CARD_SIZE;
  const v = view();
  const cases = {
    under: v,
    ace: view({ ...youngster, classKey: "acetrainerf", title: "Ace Trainer", name: "Nora", spriteFile: "acetrainerf-gen3.png", prize: 1350 }),
    noTrainerNoTeam: view(youngster, player({ trainer: null, team: [] })),
    longNames: encounterCardView({
      trainer: { ...youngster, classKey: "rocketgrunt", title: "Team Rocket Grunt", name: "Janice", spriteFile: "teamrocketgruntm-gen3.png" },
      team: card(player()), user: player(), displayName: "A really very extremely long display name",
    }),
  };
  const out = {};
  for (const [name, c] of Object.entries(cases)) {
    out[name] = await renderEncounterCard(c);
    assertEqual(dims(out[name]), [w, h], `renders: ${name}`);
  }
  if (process.env.ENCOUNTER_CARD_OUT) for (const [name, png] of Object.entries(out)) fs.writeFileSync(`${process.env.ENCOUNTER_CARD_OUT}/encounter-card-${name}.png`, png);

  const px = await pixels(out.under);
  const slots = await encounterSlots(v);
  const k = slots.bubble.size / 16;
  const cell = (row, col) => rgb(px, slots.bubble.x + col * k + k / 2, slots.bubble.y + row * k + k / 2);
  assertTrue(cell(2, 3).every((c) => c > 230), "the ! bubble is white where the grid says");
  assertTrue(cell(4, 7).every((c) => c < 80), "with a dark mark");
  assertTrue(slots.bubble.y + slots.bubble.size <= slots.trainer.top && slots.trainer.top - (slots.bubble.y + slots.bubble.size) < 16,
    "just above the Trainer's head");
  const tall = await encounterSlots(cases.longNames);
  assertTrue(tall.bubble.y >= 0, "never off the top, even for a tall sprite");

  const noTrainer = await pixels(await renderEncounterCard({ ...v, trainer: { ...v.trainer, trainerFile: null } }));
  assertTrue(differing(px, noTrainer, slots.trainer.box) > 1000, "the Trainer stands in their box");
  const noPlayer = await pixels(await renderEncounterCard({ ...v, player: { ...v.player, trainerFile: null } }));
  assertTrue(differing(px, noPlayer, slots.player.box) > 1000, "the player stands in theirs");

  let gold = 0;
  const s = slots.stakes;
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if (isGold(rgb(px, x, y))) gold++;
  assertTrue(gold > 200, "the Prize money is gold in the stakes block");
  const tb = slots.textBox;
  assertTrue(rgb(px, tb.x + 12, tb.y + tb.h / 2).every((c) => c > 230), "the text box is the games' light box");
  assertTrue(tb.x + tb.w <= s.x && s.x + s.w <= w && tb.y + tb.h <= h, "text box and stakes side by side, inside the card");
}

finish();
