// ==========================================================
// tests/moveChoice.test.js
// The private move prompt, driven with stub Discord objects: when it asks,
// what each answer stores, several questions in one message, a Pokémon
// that changed since the prompt, timeouts, failures, and /daily sending it.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { MessageFlags } from "discord.js";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { offerMoveChoices, mergeLessons } from "../utils/moveChoice.js";
import { addExp, expForLevel, getMoveset, moveLesson, trainingKey } from "../utils/training.js";
import { lockUser } from "../utils/userLocks.js";
import { SAVE_DELAYED_NOTE } from "../utils/saveManager.js";
import { createNewUser } from "../utils/userSchema.js";

// /daily logs events under TRAINERDATA_DIR; keep them out of the repo.
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "move-choice-"));
process.env.TRAINERDATA_DIR = dataDir;
const { execute: daily } = await import("../commands/daily.js");

// A player whose Pokémon sit at `level` with no choice made.
const player = (...pokemon) => {
  const user = { pokemon: {}, training: {} };
  for (const [id, level, variant = "normal"] of pokemon) {
    user.pokemon[id] = { normal: 0, shiny: 0, [variant]: 1 };
    user.training[trainingKey(id, variant)] = { exp: expForLevel(level) };
  }
  return user;
};

// Levels a Pokémon up the way a battle or catch does, returning its lesson.
const levelUp = (user, id, toLevel, variant = "normal") => {
  const { fromLevel } = addExp(user, id, variant, expForLevel(toLevel) - user.training[trainingKey(id, variant)].exp);
  return moveLesson(user, id, variant, fromLevel, toLevel);
};

function harness({ followUpFails = false, saved = true } = {}) {
  const log = { followUps: [], edits: [], saves: 0 };
  let collector = null;
  const message = {
    id: "prompt",
    createMessageComponentCollector(opts) {
      collector = {
        opts, h: {}, ended: null,
        on(e, f) { this.h[e] = f; },
        stop(reason) { this.ended ??= Promise.resolve(this.h.end?.([], reason)); },
      };
      return collector;
    },
  };
  const interaction = {
    followUp: async (o) => {
      if (followUpFails) throw new Error("Invalid Webhook Token");
      log.followUps.push(o);
      return message;
    },
    editReply: async (o) => { log.edits.push({ via: "command", ...o }); },
  };
  const trainerData = {};
  const offer = (user, lessons) => {
    trainerData.A = user;
    return offerMoveChoices(interaction, {
      trainerData, userId: "A", lessons, lockUser, save: async () => { log.saves++; return saved; },
    });
  };
  const buttons = () => (log.edits.findLast((e) => e.components?.length) ?? log.followUps[0]).components[0].components.map((b) => b.data);
  // Clicks the button with this label on the question showing now.
  const click = (label, userId = "A") => {
    const button = buttons().find((b) => b.label === label);
    return collector.h.collect({
      user: { id: userId },
      customId: button.custom_id,
      deferUpdate: async () => {},
      editReply: async (o) => { log.edits.push({ via: "click", ...o }); },
    });
  };
  const shown = () => (log.edits.at(-1) ?? log.followUps[0]).content;
  return { log, offer, click, buttons, shown, collector: () => collector };
}

section("When it asks");
{
  const t = harness();
  const roomy = player([107, 15]); // Hitmonchan Lv 15 knows 3 moves
  await t.offer(roomy, [null, levelUp(player([107, 10]), 107, 11)]);
  assertEqual(t.log.followUps.length, 0, "no lessons, or a move with room to spare: no prompt");

  const full = harness();
  const user = player([4, 33]);
  await full.offer(user, [levelUp(user, 4, 34)]);
  const [prompt] = full.log.followUps;
  assertEqual(prompt.flags, MessageFlags.Ephemeral, "a full Moveset learning a new move gets a private prompt");
  assertEqual(prompt.content, "Charmander learned **Slash** and forgot **Scratch**.\nForget a different move instead?", "it says what already happened, then asks");
  assertEqual(full.buttons().map((b) => b.label), ["Scratch", "Ember", "Fire Fang", "Flame Burst", "✖ Don't learn"], "one button per move, then Don't learn");
  assertEqual(getMoveset(user, 4, "normal"), ["ember", "firefang", "flameburst", "slash"], "until answered, the default stands");
  const { filter, time } = full.collector().opts;
  const id = full.buttons()[0].custom_id;
  assertTrue(filter({ user: { id: "A" }, customId: id }) && !filter({ user: { id: "B" }, customId: id }), "only the player's clicks count");
  assertTrue(!filter({ user: { id: "A" }, customId: "movechoice:other-prompt:0:0" }), "clicks on another prompt don't count");
  assertEqual(time, 10 * 60 * 1000, "buttons stay live for 10 minutes");
  assertTrue(full.buttons().every((b) => b.custom_id.length <= 100), "custom ids fit Discord's 100 characters");
}

section("Answers");
{
  const t = harness();
  const user = player([4, 33]);
  await t.offer(user, [levelUp(user, 4, 34)]);
  await t.click("Flame Burst");
  assertEqual(user.training["4:normal"].moves, ["scratch", "ember", "firefang", "slash"], "forgetting a different move stores that Moveset");
  assertEqual(user.training["4:normal"].movesLevel, 34, "with the Level it was chosen at");
  assertEqual(t.log.saves, 1, "and saves");
  assertEqual(t.log.edits.at(-1), { via: "click", content: "Charmander forgot **Flame Burst** and learned **Slash**.", components: [] }, "the last answer leaves a summary and no buttons");
  assertEqual(t.collector().ended !== null, true, "the prompt stops listening");

  const d = harness();
  const skipper = player([4, 33]);
  await d.offer(skipper, [levelUp(skipper, 4, 34)]);
  await d.click("✖ Don't learn");
  assertEqual(getMoveset(skipper, 4, "normal"), ["scratch", "ember", "firefang", "flameburst"], "Don't learn keeps the old 4");
  assertEqual(d.shown(), "Charmander didn't learn **Slash**.", "and says so");
  addExp(skipper, 4, "normal", expForLevel(37) - expForLevel(34));
  assertEqual(getMoveset(skipper, 4, "normal"), ["ember", "firefang", "flameburst", "flamethrower"], "Slash isn't learned later; the next move is, the default way");

  const k = harness();
  const keeper = player([4, 33]);
  await k.offer(keeper, [levelUp(keeper, 4, 34)]);
  await k.click("Scratch");
  assertEqual(getMoveset(keeper, 4, "normal"), ["ember", "firefang", "flameburst", "slash"], "picking the oldest is the default");
}

section("Several questions in one message");
{
  const t = harness();
  const user = player([4, 33], [107, 15]);
  // Hitmonchan Lv 15 → 16 learns two moves: the first fills its 4th slot, the second asks.
  await t.offer(user, [levelUp(user, 4, 34), levelUp(user, 107, 16)]);
  assertEqual(t.log.followUps.length, 1, "one message");
  assertTrue(t.shown().startsWith("Charmander learned **Slash** and forgot **Scratch**. (1 of 2)"), "Team order, with a counter");
  await t.click("Ember");
  assertEqual(t.shown(), "Hitmonchan learned **Mach Punch** and forgot **Comet Punch**. (2 of 2)\nForget a different move instead?", "each answer shows the next question");
  assertEqual(t.buttons().map((b) => b.label).slice(0, 4), ["Comet Punch", "Revenge", "Pursuit", "Bullet Punch"], "the move that had room was learned without asking");
  await t.click("Pursuit");
  assertEqual(t.shown(), "Charmander forgot **Ember** and learned **Slash**.\nHitmonchan forgot **Pursuit** and learned **Mach Punch**.", "the summary lists every answer");
  assertEqual(getMoveset(user, 107, "normal"), ["cometpunch", "revenge", "bulletpunch", "machpunch"], "each Pokémon gets its own answer");

  // Two catches of the same species in one /daily: one Level-up, two moves.
  const twice = harness();
  const daily = player([4, 33]);
  const lessons = [levelUp(daily, 4, 34), levelUp(daily, 4, 37)];
  assertEqual(mergeLessons(lessons).length, 1, "lessons for the same species + Variant merge");
  await twice.offer(daily, lessons);
  assertTrue(twice.shown().startsWith("Charmander learned **Slash** and forgot **Scratch**. (1 of 2)"), "its first move is asked first");
  await twice.click("✖ Don't learn");
  assertEqual(twice.buttons().map((b) => b.label).slice(0, 4), ["Scratch", "Ember", "Fire Fang", "Flame Burst"], "the second question builds on the first answer");
  await twice.click("Ember");
  assertEqual(daily.training["4:normal"], { exp: expForLevel(37), moves: ["scratch", "firefang", "flameburst", "flamethrower"], movesLevel: 37 }, "both answers stored, at the latest Level");

  const shiny = harness();
  const s = player([4, 33, "shiny"]);
  await shiny.offer(s, [levelUp(s, 4, 34, "shiny")]);
  assertTrue(shiny.shown().startsWith("Shiny Charmander learned"), "a shiny is named as one");
}

section("A Pokémon that changed since the prompt");
{
  const t = harness();
  const user = player([4, 33]);
  await t.offer(user, [levelUp(user, 4, 34)]);
  addExp(user, 4, "normal", expForLevel(37) - expForLevel(34)); // another battle while the prompt was open
  await t.click("Flame Burst");
  assertEqual(user.training["4:normal"].moves, undefined, "nothing is stored");
  assertEqual(t.shown(), "Charmander has changed since this prompt, so its moves were left as they are.", "the player is told");
  assertEqual(t.log.saves, 0, "nothing to save");

  const gone = harness();
  const giver = player([4, 33]);
  await gone.offer(giver, [levelUp(giver, 4, 34)]);
  delete giver.training["4:normal"]; // gave away the last copy
  await gone.click("Ember");
  assertEqual(giver.training["4:normal"], undefined, "a Pokémon given away gets no record back");
}

section("Clicks that don't count");
{
  const t = harness();
  const user = player([4, 33]);
  await t.offer(user, [levelUp(user, 4, 34)]);
  const first = t.buttons();
  const ember = first.find((b) => b.label === "Ember").custom_id;
  const fang = first.find((b) => b.label === "Fire Fang").custom_id;
  const clickId = (customId) => t.collector().h.collect({ user: { id: "A" }, customId, deferUpdate: async () => {}, editReply: async (o) => { t.log.edits.push(o); } });
  await Promise.all([clickId(ember), clickId(fang)]); // a double click
  assertEqual(getMoveset(user, 4, "normal"), ["scratch", "firefang", "flameburst", "slash"], "only the first click on a question counts");
  assertEqual(t.log.saves, 1, "and only it saves");
}

section("Time runs out");
{
  const t = harness();
  const user = player([4, 33], [107, 15]);
  await t.offer(user, [levelUp(user, 4, 34), levelUp(user, 107, 16)]);
  t.collector().stop("time");
  await t.collector().ended;
  const last = t.log.edits.at(-1);
  assertEqual(last.via, "command", "with no click, the command's own token edits the prompt");
  assertTrue(last.message?.id === "prompt", "it edits the prompt, not the command's reply");
  assertEqual(last.content, "Charmander learned **Slash** and forgot **Scratch**.\nHitmonchan learned **Mach Punch** and forgot **Comet Punch**.", "the buttons go and the defaults are listed");
  assertEqual([last.components, t.log.saves, user.training["4:normal"].moves], [[], 0, undefined], "the defaults were already in place: nothing stored or saved");

  const after = harness();
  const u = player([4, 33], [107, 15]);
  await after.offer(u, [levelUp(u, 4, 34), levelUp(u, 107, 16)]);
  await after.click("Ember");
  after.collector().stop("time");
  await after.collector().ended;
  assertEqual(after.log.edits.at(-1).via, "click", "after a click, the newest click's token edits it");
  assertEqual(after.shown(), "Charmander forgot **Ember** and learned **Slash**.\nHitmonchan learned **Mach Punch** and forgot **Comet Punch**.", "answers and defaults together");
}

section("Failures");
{
  const t = harness({ followUpFails: true });
  const user = player([4, 33]);
  let threw = false;
  await t.offer(user, [levelUp(user, 4, 34)]).catch(() => { threw = true; });
  assertTrue(!threw && !t.collector(), "a refused follow-up (expired token) doesn't throw or listen");
  assertEqual(getMoveset(user, 4, "normal"), ["ember", "firefang", "flameburst", "slash"], "the default stands");

  const slow = harness({ saved: false });
  const u = player([4, 33]);
  await slow.offer(u, [levelUp(u, 4, 34)]);
  await slow.click("Ember");
  assertEqual(slow.shown(), `Charmander forgot **Ember** and learned **Slash**.\n\n${SAVE_DELAYED_NOTE}`, "an unconfirmed save says so");
}

section("/daily asks about a move a duplicate taught");
{
  // With Math.random fixed at 0.99, /daily gives a new player two normal Bouffalant.
  const user = createNewUser("D", "Dawn");
  user.pokemon[626] = { normal: 1, shiny: 0 };
  user.training = { "626:normal": { exp: expForLevel(31) - 1 } }; // Lv 30, 4 moves, Head Charge at 31
  const sent = [];
  const interaction = {
    user: { id: "D", username: "Dawn" },
    async deferReply() { this.deferred = true; },
    async editReply(p) { sent.push({ kind: "reply", ...p }); },
    async reply(p) { sent.push({ kind: "reply", ...p }); },
    async followUp(p) { sent.push({ kind: "followUp", ...p }); return { id: "f", createMessageComponentCollector: () => ({ on() {} }) }; },
  };
  const realRandom = Math.random;
  const quiet = { log: console.log, warn: console.warn };
  Math.random = () => 0.99;
  console.log = console.warn = () => {};
  try {
    await daily(interaction, { D: user }, null, null, lockUser, null, null);
  } finally {
    Math.random = realRandom;
    Object.assign(console, quiet);
  }
  assertEqual(user.pokemon[626].normal, 3, "fixture: both picks were Bouffalant");
  assertEqual(sent.map((m) => m.kind), ["reply", "followUp"], "the rewards first, then one prompt for the two catches");
  assertEqual(sent[1].content, "Bouffalant learned **Head Charge** and forgot **Rage**.\nForget a different move instead?", "it asks about the move the catches taught");
  assertEqual(sent[1].flags, MessageFlags.Ephemeral, "privately");
}

await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
finish();
